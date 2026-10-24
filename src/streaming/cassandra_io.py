"""Cassandra access for the streaming job (near real-time serving path).

The micro-batch driver writes through the Python driver: volumes are small
(demo scale), the writes are keyed exactly like the tables (query-first, see
``cassandra/schema.cql``), and every write is an idempotent upsert, so a
replayed batch updates rows in place (FR3.3). Reads are point lookups on the
same primary keys: previous latest value per (field, metric) for the jump
check, alert state for debounce/cooldown, and device status for outage
detection.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from cassandra.cluster import Cluster, Session
from cassandra.concurrent import execute_concurrent_with_args

log = logging.getLogger("streaming.cassandra")


def utc_naive(value: datetime | None) -> datetime | None:
    """Cassandra timestamps are tz-naive; the platform stores UTC only."""
    if value is None:
        return None
    return value.astimezone(UTC).replace(tzinfo=None)


def parse_contact_points(raw: str) -> tuple[list[str], int]:
    """'cassandra:9042,other:9042' -> (['cassandra', 'other'], 9042)."""
    hosts: list[str] = []
    port = 9042
    for point in raw.split(","):
        point = point.strip()
        if not point:
            continue
        if ":" in point:
            host, port_text = point.rsplit(":", 1)
            port = int(port_text)
        else:
            host = point
        hosts.append(host)
    return hosts, port


@dataclass(frozen=True)
class LatestRow:
    value: float | None
    measured_at: datetime | None
    quality_flag: str | None


@dataclass
class DeviceStatus:
    device_id: str
    field_id: str | None = None
    farm_id: str | None = None
    status: str | None = None
    last_seen: datetime | None = None
    reporting_interval_s: float | None = None
    battery_pct: float | None = None
    signal_quality: float | None = None
    low_battery: bool = False
    poor_signal: bool = False
    gap_start: datetime | None = None
    gap_end: datetime | None = None
    last_batch_id: int | None = None


class CassandraWriter:
    """One session plus the prepared statements the pipeline needs."""

    def __init__(self, contact_points: str, keyspace: str, wait_s: int = 180) -> None:
        hosts, port = parse_contact_points(contact_points)
        deadline = time.monotonic() + wait_s
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                self.cluster = Cluster(hosts, port=port)
                self.session: Session = self.cluster.connect(keyspace)
                break
            except Exception as exc:  # Cassandra may still be starting up
                last_error = exc
                log.info("waiting for Cassandra at %s: %s", contact_points, exc)
                time.sleep(5)
        else:
            raise RuntimeError(f"Cassandra at {contact_points} unreachable after {wait_s}s") from last_error
        self._prepare()

    def _prepare(self) -> None:
        s = self.session
        self.p_series = s.prepare(
            "INSERT INTO readings_by_field_24h "
            "(field_id, metric, bucket, measured_at, device_id, value, unit, "
            " ingested_at, quality_flag, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_latest = s.prepare(
            "INSERT INTO latest_by_field "
            "(field_id, metric, farm_id, device_id, value, unit, measured_at, "
            " ingested_at, quality_flag, batch_id, source_topic, source_partition, "
            " source_offset, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_device_status = s.prepare(
            "INSERT INTO device_status "
            "(device_id, field_id, farm_id, status, last_seen, reporting_interval_s, "
            " battery_pct, signal_quality, low_battery, poor_signal, gap_start, gap_end, "
            " last_batch_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_alert_insert = s.prepare(
            "INSERT INTO alerts_by_field "
            "(field_id, created_at, alert_id, status, condition_code, alert_type, severity, "
            " message, crop_code, device_id, metric, observed_value, threshold_value, batch_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_alert_status_insert = s.prepare(
            "INSERT INTO alerts_by_status "
            "(status, created_at, alert_id, field_id, condition_code, alert_type, severity, "
            " message, crop_code, device_id, metric, observed_value, threshold_value, batch_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_alert_by_id_insert = s.prepare(
            "INSERT INTO alert_by_id "
            "(alert_id, field_id, condition_code, created_at, status, severity, message, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        self.p_alert_ack = s.prepare(
            "UPDATE alerts_by_field SET status = 'acknowledged', acknowledged_at = ?, "
            "acknowledged_by = ? WHERE field_id = ? AND created_at = ? AND alert_id = ?"
        )
        self.p_alert_resolve = s.prepare(
            "UPDATE alerts_by_field SET status = 'resolved', resolved_at = ?, resolved_by = ?, "
            "resolution = ?, note = ? WHERE field_id = ? AND created_at = ? AND alert_id = ?"
        )
        self.p_alert_status_delete = s.prepare(
            "DELETE FROM alerts_by_status WHERE status = ? AND created_at = ? AND alert_id = ?"
        )
        self.p_alert_by_id_status = s.prepare(
            "UPDATE alert_by_id SET status = ?, updated_at = ? WHERE alert_id = ?"
        )
        self.p_alert_state = s.prepare(
            "INSERT INTO alert_state_by_field "
            "(field_id, condition_code, debounce_count, last_emitted_at, open_alert_id, "
            " open_created_at, open_status, last_observed_value, threshold_value, device_id, "
            " last_batch_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        # Prepared `IN ?` binding a list is the supported way to fetch several
        # partitions in one round trip (Cassandra 3.0+/driver 3.x). The plain
        # `IN (%s)` form is not expanded by the driver for unprepared strings.
        self.p_device_status_read = s.prepare("SELECT * FROM device_status WHERE device_id IN ?")

    def close(self) -> None:
        self.cluster.shutdown()

    # -- reads -------------------------------------------------------------

    def read_latest(self, field_id: str, metric: str) -> LatestRow | None:
        row = self.session.execute(
            "SELECT value, measured_at, quality_flag FROM latest_by_field "
            "WHERE field_id = %s AND metric = %s",
            (field_id, metric),
        ).one()
        if row is None:
            return None
        return LatestRow(row.value, row.measured_at, row.quality_flag)

    def read_alert_states(self, field_id: str) -> dict[str, dict[str, object]]:
        rows = self.session.execute(
            "SELECT * FROM alert_state_by_field WHERE field_id = %s",
            (field_id,),
        ).all()
        return {row.condition_code: row._asdict() for row in rows}

    def read_device_status(self, device_ids: list[str]) -> dict[str, DeviceStatus]:
        if not device_ids:
            return {}
        rows = self.session.execute(self.p_device_status_read, (device_ids,)).all()
        out: dict[str, DeviceStatus] = {}
        for row in rows:
            out[row.device_id] = DeviceStatus(
                device_id=row.device_id,
                field_id=row.field_id,
                farm_id=row.farm_id,
                status=row.status,
                last_seen=row.last_seen,
                reporting_interval_s=row.reporting_interval_s,
                battery_pct=row.battery_pct,
                signal_quality=row.signal_quality,
                low_battery=bool(row.low_battery),
                poor_signal=bool(row.poor_signal),
                gap_start=row.gap_start,
                gap_end=row.gap_end,
                last_batch_id=row.last_batch_id,
            )
        return out

    # -- writes ------------------------------------------------------------

    def write_series(self, rows: list[tuple]) -> None:
        """Insert last-24-hours rows; PK idempotency makes replays no-ops (FR3.3)."""
        if not rows:
            return
        execute_concurrent_with_args(self.session, self.p_series, rows, concurrency=32)

    def write_latest(self, rows: list[tuple]) -> None:
        if not rows:
            return
        execute_concurrent_with_args(self.session, self.p_latest, rows, concurrency=32)

    def write_device_status(self, status: DeviceStatus, batch_id: int, now: datetime) -> None:
        self.session.execute(
            self.p_device_status,
            (
                status.device_id,
                status.field_id,
                status.farm_id,
                status.status,
                utc_naive(status.last_seen),
                status.reporting_interval_s,
                status.battery_pct,
                status.signal_quality,
                status.low_battery,
                status.poor_signal,
                utc_naive(status.gap_start),
                utc_naive(status.gap_end),
                batch_id,
                utc_naive(now),
            ),
        )

    # -- alert lifecycle ---------------------------------------------------

    def open_alert(
        self,
        *,
        alert_id: uuid.UUID,
        created_at: datetime,
        field_id: str,
        condition_code: str,
        alert_type: str,
        severity: str,
        message: str,
        crop_code: str | None,
        device_id: str | None,
        metric: str | None,
        observed_value: float | None,
        threshold_value: float | None,
        batch_id: int,
    ) -> None:
        """Insert a new open alert in every serving table (FR8.3)."""
        created = utc_naive(created_at)
        args = (
            condition_code,
            alert_type,
            severity,
            message,
            crop_code,
            device_id,
            metric,
            observed_value,
            threshold_value,
            batch_id,
        )
        self.session.execute(self.p_alert_insert, (field_id, created, alert_id, "open", *args))
        self.session.execute(self.p_alert_status_insert, ("open", created, alert_id, field_id, *args))
        self.session.execute(
            self.p_alert_by_id_insert,
            (alert_id, field_id, condition_code, created, "open", severity, message, created),
        )

    def resolve_alert(
        self,
        *,
        alert_id: uuid.UUID,
        field_id: str,
        created_at: datetime,
        old_status: str,
        resolved_by: str,
        resolution: str,
        note: str | None = None,
        resolved_at: datetime | None = None,
    ) -> None:
        """Move an alert to 'resolved' across every serving table (FR8.4)."""
        when = utc_naive(resolved_at or datetime.now(UTC))
        created = utc_naive(created_at)
        row = self._alert_row(field_id, created, alert_id)
        self.session.execute(
            self.p_alert_resolve,
            (when, resolved_by, resolution, note, field_id, created, alert_id),
        )
        if old_status != "resolved":
            self.session.execute(self.p_alert_status_delete, (old_status, created, alert_id))
        if row is not None:
            self.session.execute(self.p_alert_status_insert, ("resolved", created, alert_id, field_id, *row))
        self.session.execute(self.p_alert_by_id_status, ("resolved", when, alert_id))

    def acknowledge_alert(
        self,
        *,
        alert_id: uuid.UUID,
        field_id: str,
        created_at: datetime,
        actor: str,
        acknowledged_at: datetime | None = None,
    ) -> None:
        when = utc_naive(acknowledged_at or datetime.now(UTC))
        created = utc_naive(created_at)
        row = self._alert_row(field_id, created, alert_id)
        self.session.execute(self.p_alert_ack, (when, actor, field_id, created, alert_id))
        if row is not None:
            self.session.execute(self.p_alert_status_delete, ("open", created, alert_id))
            self.session.execute(
                self.p_alert_status_insert,
                ("acknowledged", created, alert_id, field_id, *row),
            )
        self.session.execute(self.p_alert_by_id_status, ("acknowledged", when, alert_id))

    def _alert_row(self, field_id: str, created_at: datetime, alert_id: uuid.UUID) -> tuple | None:
        """The alerts_by_status payload columns of one alert, by primary key."""
        row = self.session.execute(
            "SELECT condition_code, alert_type, severity, message, crop_code, device_id, "
            "metric, observed_value, threshold_value, batch_id FROM alerts_by_field "
            "WHERE field_id = %s AND created_at = %s AND alert_id = %s",
            (field_id, created_at, alert_id),
        ).one()
        if row is None:
            return None
        return (
            row.condition_code,
            row.alert_type,
            row.severity,
            row.message,
            row.crop_code,
            row.device_id,
            row.metric,
            row.observed_value,
            row.threshold_value,
            row.batch_id,
        )

    def write_alert_state(
        self,
        *,
        field_id: str,
        condition_code: str,
        debounce_count: int,
        last_emitted_at: datetime | None,
        open_alert_id: uuid.UUID | None,
        open_created_at: datetime | None,
        open_status: str | None,
        last_observed_value: float | None,
        threshold_value: float | None,
        device_id: str | None,
        batch_id: int,
        now: datetime,
    ) -> None:
        """Full-row upsert of the per-condition alert state (FR8.5)."""
        self.session.execute(
            self.p_alert_state,
            (
                field_id,
                condition_code,
                debounce_count,
                utc_naive(last_emitted_at),
                open_alert_id,
                utc_naive(open_created_at),
                open_status,
                last_observed_value,
                threshold_value,
                device_id,
                batch_id,
                utc_naive(now),
            ),
        )
