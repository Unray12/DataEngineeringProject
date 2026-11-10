"""Shared helpers for the benchmark scripts (AGENTS.md: results record their configuration).

The scripts run inside the ``api`` image on the Compose network (``just bench-*``), so hosts
come from the environment like everywhere else in the project.
"""

from __future__ import annotations

import csv
import os
import platform
import statistics
import time
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from trino.dbapi import Connection, connect

RESULTS_DIR = Path(os.environ.get("BENCH_RESULTS_DIR", "/app/benchmarks/results"))

# One Spark micro-batch commit writes rows of a few consecutive days, so each partition
# collects many small files, the situation compaction is meant to fix.
DAYS = 30
FIRST_DAY = "2026-10-01"
METRICS = "ARRAY['soil_moisture','soil_temperature','air_temperature','relative_humidity','rainfall']"


def trino_connection(catalog: str = "lakehouse", schema: str = "bench") -> Connection:
    return connect(
        host=os.environ.get("TRINO_HOST", "trino"),
        port=int(os.environ.get("TRINO_PORT_INTERNAL", "8080")),
        user=os.environ.get("TRINO_USER", "agri"),
        catalog=catalog,
        schema=schema,
    )


def run(connection: Connection, sql: str) -> list[tuple[Any, ...]]:
    cursor = connection.cursor()
    cursor.execute(sql)
    return cursor.fetchall()


def millis(connection: Connection, sql: str) -> float:
    """Wall-clock time of one statement as the client sees it, in milliseconds."""
    started = time.perf_counter()
    run(connection, sql)
    return (time.perf_counter() - started) * 1000


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = q * (len(ordered) - 1)
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def summarize(values: list[float]) -> dict[str, float]:
    return {"p50": round(statistics.median(values), 1), "p95": round(percentile(values, 0.95), 1)}


def time_query(connection: Connection, sql: str, runs: int, warmup: int = 3) -> dict[str, float]:
    for _ in range(warmup):
        run(connection, sql)
    return summarize([millis(connection, sql) for _ in range(runs)])


def host_config() -> dict[str, str]:
    return {
        "date_utc": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        "host_cpu": os.environ.get("BENCH_HOST_CPU", platform.processor() or platform.machine()),
        "host_cores": os.environ.get("BENCH_HOST_CORES", str(os.cpu_count())),
        "host_ram_gb": os.environ.get("BENCH_HOST_RAM_GB", "unknown"),
        "docker_memory_gb": os.environ.get("BENCH_DOCKER_MEM_GB", "unknown"),
        "trino": "438 (single node, query.max-memory-per-node=1GB)",
        "iceberg": "1.7.1, Parquet/Snappy",
        "spark": "3.5.3 local[*]",
    }


def write_results(name: str, config: dict[str, Any], header: list[str], rows: Iterable[list[Any]]) -> Path:
    """CSV whose first lines (``# key: value``) hold the configuration."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / name
    with path.open("w", newline="", encoding="utf-8") as handle:
        for key, value in {**host_config(), **config}.items():
            handle.write(f"# {key}: {value}\n")
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    print(f"wrote {path}")
    return path


def ensure_bench_schema(connection: Connection) -> None:
    """The metastore's default warehouse is a local path; Trino needs the HDFS location spelled out."""
    run(
        connection,
        "CREATE SCHEMA IF NOT EXISTS lakehouse.bench WITH (location = 'hdfs://namenode:8020/warehouse/bench.db')",
    )


def column_sql(timestamp_type: str) -> str:
    return f"""
        event_id varchar, device_id varchar, field_id varchar, farm_id varchar, crop_code varchar,
        metric varchar, value double, unit varchar, measured_at {timestamp_type},
        ingested_at {timestamp_type}, is_late boolean, quality_flag varchar, source_topic varchar,
        source_partition integer, source_offset bigint, batch_id bigint"""


def commit_select(commit: int, rows: int, with_day: bool) -> str:
    """Synthetic readings of one micro-batch: the same schema as ``bronze.sensor_readings``."""
    at = (
        f"date_add('second', cast((n * 17) % 86400 as integer), "
        f"date_add('day', cast(({commit} + n % 3) % {DAYS} as integer), TIMESTAMP '{FIRST_DAY} 00:00:00'))"
    )
    day = f", cast({at} as date) as day" if with_day else ""
    return f"""
        SELECT concat('e', cast({commit} as varchar), '-', cast(n as varchar)) AS event_id,
               concat('F00', cast(1 + n % 8 as varchar), '-S0', cast(1 + n % 3 as varchar)) AS device_id,
               concat('F00', cast(1 + n % 8 as varchar)) AS field_id,
               concat('FM00', cast(1 + n % 4 as varchar)) AS farm_id,
               'RICE' AS crop_code,
               element_at({METRICS}, cast(1 + n % 5 as integer)) AS metric,
               cast(mod(n * 7919 + {commit} * 104729, 10000) as double) / 100 AS value,
               'u' AS unit,
               {at} AS measured_at,
               {at} AS ingested_at,
               false AS is_late,
               'ok' AS quality_flag,
               'sensor.readings.v1' AS source_topic,
               cast(n % 3 as integer) AS source_partition,
               cast({commit} * {rows} + n as bigint) AS source_offset,
               cast({commit} as bigint) AS batch_id{day}
        FROM UNNEST(sequence(1, {rows})) AS u(n)"""


def load_commits(
    connection: Connection,
    table: str,
    commits: int,
    rows: int,
    with_day: bool,
    progress: Callable[[int], None] | None = None,
) -> float:
    """Append ``commits`` batches of ``rows`` readings, one INSERT (one commit) each; returns seconds."""
    started = time.perf_counter()
    for commit in range(commits):
        run(connection, f"INSERT INTO {table} {commit_select(commit, rows, with_day)}")
        if progress and (commit + 1) % 40 == 0:
            progress(commit + 1)
    return time.perf_counter() - started


def window_filter(first: int, days: int, kind: str) -> str:
    """Predicate for ``days`` days starting at day offset ``first``.

    ``iceberg`` and ``timestamp`` filter on ``measured_at``; ``partition`` filters the explicit
    Hive partition column, which the query author has to know about.
    """
    start = f"date_add('day', {first}, DATE '{FIRST_DAY}')"
    end = f"date_add('day', {first + days}, DATE '{FIRST_DAY}')"
    if kind == "partition":
        return f"day >= {start} AND day < {end}"
    return f"measured_at >= cast({start} as timestamp) AND measured_at < cast({end} as timestamp)"
