"""HTTP access layer for the agriculture platform (BR1, BR2, BR3, BR7, BR8).

The API is the **only** access layer the web app talks to (AGENTS.md). For now
it serves the near real-time path: master data from the shared reference file
and current state from Cassandra (``cassandra/schema.cql``). Intraday/daily
endpoints backed by Trino/gold are deferred until dbt builds those tables.
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import Body, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from common.reference import ReferenceData, load_reference
from streaming.alerts import ALLOWED_TRANSITIONS, STATUS_ACKNOWLEDGED, STATUS_OPEN, STATUS_RESOLVED
from streaming.cassandra_io import CassandraWriter

log = logging.getLogger("api")

writer: CassandraWriter | None = None
reference: ReferenceData | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global writer, reference
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(name)s - %(message)s",
        stream=sys.stdout,
    )
    reference = load_reference(os.environ.get("REFERENCE_DATA_PATH"))
    writer = CassandraWriter(
        os.environ.get("CASSANDRA_CONTACT_POINTS", "cassandra:9042"),
        os.environ.get("CASSANDRA_KEYSPACE", "agri"),
        int(os.environ.get("CASSANDRA_WAIT_S", "180")),
    )
    log.info(
        "api ready: %d farms, %d fields, %d devices",
        len(reference.farms),
        len(reference.fields),
        len(reference.devices),
    )
    yield
    if writer is not None:
        writer.close()


app = FastAPI(title="Agriculture Data Platform", version="0.1.0", lifespan=lifespan)


def _ref() -> ReferenceData:
    if reference is None:  # pragma: no cover - lifespan always runs
        raise HTTPException(status_code=503, detail="reference data not loaded")
    return reference


def _session():
    if writer is None:  # pragma: no cover - lifespan always runs
        raise HTTPException(status_code=503, detail="cassandra not connected")
    return writer.session


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC).isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _rows(rows) -> list[dict[str, Any]]:
    return [{key: _json_value(value) for key, value in row._asdict().items()} for row in rows]


# --------------------------------------------------------------------------------------
# health
# --------------------------------------------------------------------------------------


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    try:
        _session().execute("SELECT release_version FROM system.local").one()
    except Exception as exc:  # noqa: BLE001 - surfaced as 503
        raise HTTPException(status_code=503, detail=f"cassandra unavailable: {exc}") from exc
    return {"status": "ready", "reference": _ref().path}


# --------------------------------------------------------------------------------------
# master data (BR1, FR1.1)
# --------------------------------------------------------------------------------------


@app.get("/farms")
def list_farms() -> list[dict[str, Any]]:
    ref = _ref()
    return [
        {
            "farm_id": farm.farm_id,
            "name": farm.name,
            "location": farm.location,
            "field_count": len(ref.fields_of_farm(farm.farm_id)),
        }
        for farm in ref.farms.values()
    ]


@app.get("/farms/{farm_id}/fields")
def list_fields(farm_id: str) -> list[dict[str, Any]]:
    ref = _ref()
    if farm_id not in ref.farms:
        raise HTTPException(status_code=404, detail=f"unknown farm {farm_id}")
    return [
        {
            "field_id": field.field_id,
            "farm_id": field.farm_id,
            "name": field.name,
            "crop_code": field.crop_code,
            "area_ha": field.area_ha,
            "device_count": len(ref.devices_of_field(field.field_id)),
        }
        for field in sorted(ref.fields_of_farm(farm_id), key=lambda f: f.field_id)
    ]


# --------------------------------------------------------------------------------------
# near real-time readings (BR2, FR2.2, FR2.3)
# --------------------------------------------------------------------------------------


@app.get("/fields/{field_id}/latest")
def field_latest(field_id: str) -> dict[str, Any]:
    _require_field(field_id)
    rows = _session().execute(
        "SELECT metric, value, unit, device_id, farm_id, measured_at, ingested_at, "
        "quality_flag, batch_id, updated_at FROM latest_by_field WHERE field_id = %s",
        (field_id,),
    )
    metrics = _rows(rows)
    metrics.sort(key=lambda row: row["metric"])
    return {"field_id": field_id, "metrics": metrics}


@app.get("/fields/{field_id}/series")
def field_series(
    field_id: str,
    metric: str = Query(..., description="metric name, e.g. soil_moisture"),
    hours: int = Query(24, ge=1, le=48),
    limit: int = Query(1000, ge=1, le=5000),
) -> dict[str, Any]:
    _require_field(field_id)
    if metric not in _ref().metrics:
        raise HTTPException(status_code=404, detail=f"unknown metric {metric}")
    now = datetime.now(UTC)
    bucket_hi = int(now.timestamp() // 3600)
    bucket_lo = int((now - timedelta(hours=hours)).timestamp() // 3600)
    rows = _session().execute(
        "SELECT measured_at, value, unit, device_id, quality_flag, batch_id "
        "FROM readings_by_field_24h WHERE field_id = %s AND metric = %s "
        "AND bucket >= %s AND bucket <= %s",
        (field_id, metric, bucket_lo, bucket_hi),
    )
    series = _rows(rows)
    series.sort(key=lambda row: row["measured_at"])
    return {"field_id": field_id, "metric": metric, "hours": hours, "points": series[-limit:]}


@app.get("/devices/{device_id}/status")
def device_status(device_id: str) -> dict[str, Any]:
    _require_device(device_id)
    row = _session().execute("SELECT * FROM device_status WHERE device_id = %s", (device_id,)).one()
    if row is None:
        return {"device_id": device_id, "status": "unknown", "detail": "no readings received yet"}
    return _rows([row])[0]


# --------------------------------------------------------------------------------------
# alerts (BR8, FR8.3, FR8.4)
# --------------------------------------------------------------------------------------


@app.get("/fields/{field_id}/alerts")
def field_alerts(field_id: str, limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    _require_field(field_id)
    rows = _session().execute("SELECT * FROM alerts_by_field WHERE field_id = %s LIMIT %s", (field_id, limit))
    return _rows(rows)


@app.get("/alerts")
def list_alerts(
    status: str = Query(STATUS_OPEN, description="open | acknowledged | resolved"),
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    if status not in ALLOWED_TRANSITIONS:
        raise HTTPException(status_code=400, detail=f"invalid status {status}")
    rows = _session().execute("SELECT * FROM alerts_by_status WHERE status = %s LIMIT %s", (status, limit))
    return _rows(rows)


class AlertTransition(BaseModel):
    """Body of ``PATCH /alerts/{alert_id}`` (BR8 acceptance criterion)."""

    action: Literal["acknowledge", "resolve"]
    actor: str = Field(default="operator", min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=500)


@app.patch("/alerts/{alert_id}")
def transition_alert(alert_id: str, body: AlertTransition = Body(...)) -> dict[str, Any]:
    try:
        parsed_id = uuid.UUID(alert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="alert_id must be a UUID") from exc

    target = STATUS_ACKNOWLEDGED if body.action == "acknowledge" else STATUS_RESOLVED
    alert = (
        _session()
        .execute("SELECT field_id, created_at, status FROM alert_by_id WHERE alert_id = %s", (parsed_id,))
        .one()
    )
    if alert is None:
        raise HTTPException(status_code=404, detail=f"unknown alert {alert_id}")

    current = alert.status or STATUS_OPEN
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"cannot {body.action} an alert in status '{current}'")

    now = datetime.now(UTC)
    if body.action == "acknowledge":
        writer.acknowledge_alert(
            alert_id=parsed_id,
            field_id=alert.field_id,
            created_at=alert.created_at,
            actor=body.actor,
            acknowledged_at=now,
        )
    else:
        writer.resolve_alert(
            alert_id=parsed_id,
            field_id=alert.field_id,
            created_at=alert.created_at,
            old_status=current,
            resolved_by=body.actor,
            resolution="manual",
            note=body.note,
            resolved_at=now,
        )

    updated = _session().execute("SELECT * FROM alert_by_id WHERE alert_id = %s", (parsed_id,)).one()
    return _rows([updated])[0]


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------


def _require_field(field_id: str) -> None:
    if field_id not in _ref().fields:
        raise HTTPException(status_code=404, detail=f"unknown field {field_id}")


def _require_device(device_id: str) -> None:
    if device_id not in _ref().devices:
        raise HTTPException(status_code=404, detail=f"unknown device {device_id}")
