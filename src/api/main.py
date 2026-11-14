"""FastAPI service, the only data source of the web app.

Near real-time endpoints read Cassandra, analytical ones read the gold tables through Trino
(``analytics.py``). Master data comes from the reference file.
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.analytics import AnalyticsReader, AnalyticsUnavailable
from api.live import find_gaps, gap_multiplier, outage_counts, target_state
from common.reference import ReferenceData, load_reference
from streaming.alerts import ALLOWED_TRANSITIONS, STATUS_ACKNOWLEDGED, STATUS_OPEN, STATUS_RESOLVED
from streaming.cassandra_io import CassandraWriter

log = logging.getLogger("api")

writer: CassandraWriter | None = None
reference: ReferenceData | None = None
analytics: AnalyticsReader | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global writer, reference, analytics
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
    try:
        analytics = AnalyticsReader()
    except Exception as exc:
        analytics = None
        log.warning("analytical query path unavailable until Trino/dbt is ready: %s", exc)
    log.info(
        "api ready: %d farms, %d fields, %d devices",
        len(reference.farms),
        len(reference.fields),
        len(reference.devices),
    )
    yield
    if writer is not None:
        writer.close()
    if analytics is not None:
        analytics.close()


app = FastAPI(title="Agriculture Data Platform", version="0.1.0", lifespan=lifespan)

ANALYTICS_NOT_READY = "analytical tables are not ready; run the batch flow first"


@app.exception_handler(AnalyticsUnavailable)
def analytics_unavailable(_request: Request, exc: AnalyticsUnavailable) -> JSONResponse:
    log.warning("analytical query failed: %s", exc)
    return JSONResponse(status_code=503, content={"detail": ANALYTICS_NOT_READY})


def _ref() -> ReferenceData:
    if reference is None:
        raise HTTPException(status_code=503, detail="reference data not loaded")
    return reference


def _session():
    if writer is None:
        raise HTTPException(status_code=503, detail="cassandra not connected")
    return writer.session


def _analytics() -> AnalyticsReader:
    if analytics is None:
        raise HTTPException(status_code=503, detail=ANALYTICS_NOT_READY)
    return analytics


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC).isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _rows(rows) -> list[dict[str, Any]]:
    return [{key: _json_value(value) for key, value in row._asdict().items()} for row in rows]


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> dict[str, str]:
    try:
        _session().execute("SELECT release_version FROM system.local").one()
    except Exception as exc:  # reported as 503
        raise HTTPException(status_code=503, detail=f"cassandra unavailable: {exc}") from exc
    return {"status": "ready", "reference": _ref().path}


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


def _gap_counts(field_ids: set[str]) -> dict[str, int]:
    """Gaps (outage episodes) per device over the last 24 h, from the outage alerts of the given fields."""
    since = datetime.now(UTC) - timedelta(hours=24)
    counts: dict[str, int] = {}
    for field_id in field_ids:
        rows = _session().execute(
            "SELECT condition_code, device_id, created_at FROM alerts_by_field "
            "WHERE field_id = %s AND created_at >= %s",
            (field_id, since),
        )
        counts.update(outage_counts(_rows(rows), since))
    return counts


@app.get("/devices")
def list_devices() -> list[dict[str, Any]]:
    ref = _ref()
    gaps = _gap_counts({device.field_id for device in ref.devices.values()})
    rows = []
    for device in ref.devices.values():
        row = (
            _session().execute("SELECT * FROM device_status WHERE device_id = %s", (device.device_id,)).one()
        )
        rows.append(
            _rows([row])[0]
            if row is not None
            else {
                "device_id": device.device_id,
                "field_id": device.field_id,
                "status": "unknown",
                "last_seen": None,
                "battery_pct": device.battery_pct,
                "signal_quality": device.signal_quality,
                "gap_count_24h": 0,
            }
        )
    for row in rows:
        row["gap_count_24h"] = gaps.get(row["device_id"], 0)
    return rows


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
    ref = _ref()
    crop = ref.crop(ref.fields[field_id].crop_code)
    for row in metrics:
        row["state"] = target_state(row["value"], crop.target(row["metric"]) if crop else None)
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
    points = series[-limit:]
    # Silence longer than the device outage threshold is a gap; the shortest reporting
    # interval among the field's devices for this metric decides how sensitive it is.
    intervals = [d.reporting_interval_s for d in _ref().devices_of_field(field_id) if metric in d.metrics]
    threshold_s = max(min(intervals, default=30.0) * gap_multiplier(), 1.0)
    return {
        "field_id": field_id,
        "metric": metric,
        "unit": _ref().metrics[metric].unit,
        "hours": hours,
        "points": points,
        "gaps": find_gaps(points, threshold_s, now),
    }


@app.get("/devices/{device_id}/status")
def device_status(device_id: str) -> dict[str, Any]:
    _require_device(device_id)
    row = _session().execute("SELECT * FROM device_status WHERE device_id = %s", (device_id,)).one()
    if row is None:
        return {"device_id": device_id, "status": "unknown", "detail": "no readings received yet"}
    result = _rows([row])[0]
    result["gap_count_24h"] = _gap_counts({_ref().devices[device_id].field_id}).get(device_id, 0)
    return result


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


def _date(value: str | None, fallback_days: int = 7) -> str:
    if value:
        try:
            return datetime.fromisoformat(value).date().isoformat()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="dates must be ISO-8601") from exc
    return (datetime.now(UTC) - timedelta(days=fallback_days)).date().isoformat()


@app.get("/fields/{field_id}/indicators")
def field_indicators(
    field_id: str,
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    granularity: Literal["hourly", "daily"] = "daily",
    metric: str | None = Query(None, description="adds the crop target range of this metric to the response"),
) -> dict[str, Any]:
    _require_field(field_id)
    rows = _analytics().indicators(field_id, _date(start), _date(end, 0), granularity)
    return {"field_id": field_id, "rows": rows, "target": _target(field_id, metric)}


def _target(field_id: str, metric: str | None) -> dict[str, float] | None:
    """Target range of the field's crop for ``metric``, or ``None`` when it has none."""
    crop = _ref().crop(_ref().fields[field_id].crop_code)
    target = crop.target(metric) if crop and metric else None
    if target is None or target.min is None or target.max is None:
        return None
    return {"min": target.min, "max": target.max}


@app.get("/fields/{field_id}/history")
def field_history(
    field_id: str,
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
    granularity: Literal["hourly", "daily"] = "daily",
    metric: str = Query("soil_moisture"),
) -> dict[str, Any]:
    _require_field(field_id)
    if metric not in _ref().metrics:
        raise HTTPException(status_code=400, detail=f"unknown metric {metric}")
    return {
        "field_id": field_id,
        "rows": _analytics().history(field_id, _date(start), _date(end, 0), metric, granularity),
    }


@app.get("/summary")
def analytical_summary(
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
) -> dict[str, Any]:
    return {"rows": _analytics().summary(_date(start), _date(end, 0))}


@app.get("/compare")
def analytical_compare(
    field_ids: str = Query(..., description="comma-separated field IDs"),
    metric: str = Query("soil_moisture"),
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
) -> dict[str, Any]:
    ids = [item.strip() for item in field_ids.split(",") if item.strip()]
    if not ids or any(item not in _ref().fields for item in ids):
        raise HTTPException(status_code=400, detail="field_ids must contain known fields")
    return {"rows": _analytics().compare(ids, metric, _date(start), _date(end, 0))}


@app.get("/quality/summary")
def quality_summary(
    start: str | None = Query(None, alias="from"),
    end: str | None = Query(None, alias="to"),
) -> dict[str, Any]:
    return {"rows": _analytics().quality_summary(_date(start), _date(end, 0))}


@app.get("/quality/devices")
def quality_devices() -> dict[str, Any]:
    return {"rows": _analytics().quality_devices()}


class AlertTransition(BaseModel):
    """Body of ``PATCH /alerts/{alert_id}``."""

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


def _require_field(field_id: str) -> None:
    if field_id not in _ref().fields:
        raise HTTPException(status_code=404, detail=f"unknown field {field_id}")


def _require_device(device_id: str) -> None:
    if device_id not in _ref().devices:
        raise HTTPException(status_code=404, detail=f"unknown device {device_id}")
