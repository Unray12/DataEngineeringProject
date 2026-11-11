"""Trino read adapter for the analytical serving path.

The API owns this connection so browsers never access Trino or Iceberg
directly. Queries are deliberately limited to the dbt gold tables.
"""

from __future__ import annotations

import os
from typing import Any

from trino.dbapi import Connection, connect

# ISO-8601 UTC, so the browser can parse an hourly bucket without guessing the format.
HOUR_BUCKET = "format_datetime(hour_start, 'yyyy-MM-dd''T''HH:mm:ss''Z''')"


class AnalyticsReader:
    def __init__(self) -> None:
        self.connection: Connection = connect(
            host=os.environ.get("TRINO_HOST", "trino"),
            port=int(os.environ.get("TRINO_PORT_INTERNAL", "8080")),
            user=os.environ.get("TRINO_USER", "agri"),
            catalog=os.environ.get("TRINO_CATALOG", "lakehouse"),
            schema=os.environ.get("TRINO_SCHEMA", "gold"),
        )

    def close(self) -> None:
        self.connection.close()

    def query(self, sql: str, parameters: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        cursor = self.connection.cursor()
        cursor.execute(sql, parameters)
        columns = [description[0] for description in cursor.description]
        return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]

    def indicators(self, field_id: str, start: str, end: str, granularity: str) -> list[dict[str, Any]]:
        """Indicators per day (``field_indicators``) or per hour (``field_hourly``) (FR5.1, FR5.3)."""
        if granularity == "hourly":
            return self.query(
                f"""
                SELECT {HOUR_BUCKET} AS bucket, metric, min_value AS min, max_value AS max,
                       avg_value AS avg, reading_count AS count,
                       CASE WHEN targeted_count > 0
                            THEN cast(in_range_count AS double) * 100 / targeted_count
                       END AS time_in_range_pct,
                       CASE WHEN metric = 'soil_moisture' AND avg_value < target_min
                            THEN cast(1 AS integer) ELSE cast(0 AS integer)
                       END AS hours_below_target
                FROM field_hourly
                WHERE field_id = ? AND day >= CAST(? AS date) AND day <= CAST(? AS date)
                ORDER BY hour_start, metric
                """,
                (field_id, start, end),
            )
        return self.query(
            """
            SELECT cast(day AS varchar) AS bucket, metric, min_value AS min, max_value AS max,
                   avg_value AS avg, valid_count AS count, time_in_range_pct, hours_below_target
            FROM field_indicators
            WHERE field_id = ? AND day >= CAST(? AS date) AND day <= CAST(? AS date)
            ORDER BY day, metric
            """,
            (field_id, start, end),
        )

    def history(
        self, field_id: str, start: str, end: str, metric: str, granularity: str
    ) -> list[dict[str, Any]]:
        """Per-field history of one metric, daily or hourly (FR6.3).

        ``count`` is the number of validated readings behind ``avg``, the weight a client needs to
        average several buckets (``field_hourly`` holds validated readings only).
        """
        table, bucket, order, count = (
            ("field_hourly", HOUR_BUCKET, "hour_start", "reading_count")
            if granularity == "hourly"
            else ("field_daily", "cast(day AS varchar)", "day", "valid_count")
        )
        return self.query(
            f"""
            SELECT {bucket} AS bucket, metric, min_value AS min, max_value AS max,
                   avg_value AS avg, {count} AS count
            FROM {table}
            WHERE field_id = ? AND metric = ? AND day >= CAST(? AS date) AND day <= CAST(? AS date)
            ORDER BY {order}
            """,
            (field_id, metric, start, end),
        )

    def summary(self, start: str, end: str) -> list[dict[str, Any]]:
        return self.query(
            """
            SELECT metric, min(min_value) AS min, max(max_value) AS max,
                   avg(avg_value) AS avg, sum(reading_count) AS count
            FROM field_daily
            WHERE day >= CAST(? AS date) AND day <= CAST(? AS date)
            GROUP BY metric ORDER BY metric
            """,
            (start, end),
        )

    def compare(self, field_ids: list[str], metric: str, start: str, end: str) -> list[dict[str, Any]]:
        placeholders = ", ".join("?" for _ in field_ids)
        return self.query(
            f"""
            SELECT field_id, avg(avg_value) AS avg, min(min_value) AS min,
                   max(max_value) AS max, sum(reading_count) AS count
            FROM field_daily
            WHERE field_id IN ({placeholders}) AND metric = ?
              AND day >= CAST(? AS date) AND day <= CAST(? AS date)
            GROUP BY field_id ORDER BY avg DESC
            """,
            (*field_ids, metric, start, end),
        )

    def quality_summary(self, start: str, end: str) -> list[dict[str, Any]]:
        return self.query(
            """
            SELECT cast(day AS varchar) AS date, valid, duplicate, out_of_range, quarantined
            FROM quality_daily
            WHERE day >= CAST(? AS date) AND day <= CAST(? AS date)
            ORDER BY day
            """,
            (start, end),
        )

    def quality_devices(self) -> list[dict[str, Any]]:
        """Per-device quality counts plus the lineage of each device's newest readings."""
        devices = self.query(
            """
            WITH silver AS (
                SELECT device_id, count(*) AS total,
                       sum(CASE WHEN quality_flag = 'ok' THEN 1 ELSE 0 END) AS valid,
                       sum(CASE WHEN quality_flag <> 'ok' THEN 1 ELSE 0 END) AS flagged,
                       max(batch_id) AS last_batch_id
                FROM lakehouse.silver.sensor_readings
                GROUP BY device_id
            ),
            counters AS (
                SELECT device_id, sum(duplicate) AS duplicate, sum(out_of_range) AS out_of_range
                FROM lakehouse.ops.quality_counters
                GROUP BY device_id
            ),
            quarantined AS (
                SELECT device_id, count(*) AS quarantined
                FROM lakehouse.ops.quarantine
                GROUP BY device_id
            )
            SELECT s.device_id, s.total, s.valid, s.flagged, s.last_batch_id,
                   coalesce(c.duplicate, 0) AS duplicate,
                   coalesce(c.out_of_range, 0) AS out_of_range,
                   coalesce(q.quarantined, 0) AS quarantined
            FROM silver s
            LEFT JOIN counters c ON c.device_id = s.device_id
            LEFT JOIN quarantined q ON q.device_id = s.device_id
            ORDER BY s.device_id
            """
        )
        lineage = self.query(
            """
            SELECT device_id, batch_id, source_topic AS topic, source_partition AS partition,
                   source_offset AS "offset", ingested_at
            FROM (
                SELECT *, row_number() OVER (PARTITION BY device_id ORDER BY ingested_at DESC) AS rn
                FROM lakehouse.silver.sensor_readings
            )
            WHERE rn <= 3
            ORDER BY device_id, ingested_at DESC
            """
        )
        return attach_lineage(devices, lineage)


def attach_lineage(devices: list[dict[str, Any]], lineage: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add a ``lineage`` list (newest first) to every device row; devices without records get ``[]``."""
    by_device: dict[str, list[dict[str, Any]]] = {}
    for row in lineage:
        entry = {key: value for key, value in row.items() if key != "device_id"}
        by_device.setdefault(row["device_id"], []).append(entry)
    return [{**device, "lineage": by_device.get(device["device_id"], [])} for device in devices]
