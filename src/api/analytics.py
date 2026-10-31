"""Trino read adapter for the analytical serving path.

The API owns this connection so browsers never access Trino or Iceberg
directly. Queries are deliberately limited to the dbt gold tables.
"""

from __future__ import annotations

import os
from typing import Any

from trino.dbapi import Connection, connect


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
        return self.query(
            f"""
            SELECT cast(day AS varchar) AS bucket, metric, min_value AS min, max_value AS max,
                   avg_value AS avg, reading_count AS count, data_quality_pct AS time_in_range_pct,
                   cast(0 AS double) AS hours_below_target
            FROM field_indicators
            WHERE field_id = ? AND day >= CAST(? AS date) AND day <= CAST(? AS date)
            ORDER BY day, metric
            """,
            (field_id, start, end),
        )

    def history(self, field_id: str, start: str, end: str, metric: str, granularity: str) -> list[dict[str, Any]]:
        return self.query(
            """
            SELECT cast(day AS varchar) AS bucket, metric, min_value AS min, max_value AS max,
                   avg_value AS avg, reading_count AS count
            FROM field_daily
            WHERE field_id = ? AND metric = ? AND day >= CAST(? AS date) AND day <= CAST(? AS date)
            ORDER BY day
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
        return self.query(
            """
            SELECT device_id, count(*) AS total,
                   sum(CASE WHEN quality_flag = 'ok' THEN 1 ELSE 0 END) AS valid,
                   sum(CASE WHEN quality_flag <> 'ok' THEN 1 ELSE 0 END) AS flagged,
                   max(batch_id) AS last_batch_id
            FROM lakehouse.silver.sensor_readings
            GROUP BY device_id ORDER BY device_id
            """
        )
