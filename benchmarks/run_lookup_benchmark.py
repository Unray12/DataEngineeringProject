"""Benchmark #2: Cassandra against Trino-on-Iceberg for the same dashboard question.

Q0 latest values of one field, Q1 last 24 hours of one metric of one field. Q2 and Q3 are analytical
questions (30-day history, comparing all fields) that only the Trino path can answer without extra
tables. Each query is repeated from 1, 5 and 10 concurrent clients.

    just bench-lookups
"""

from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from cassandra.cluster import Cluster

from common import millis, run, summarize, trino_connection, write_results

FIELD, METRIC = "F001", "soil_moisture"
REPEATS, WARMUP, LEVELS = 100, 10, (1, 5, 10)


def concurrent(call, level: int) -> tuple[dict[str, float], float]:
    """Run ``call`` REPEATS times from ``level`` clients; per-call latency and queries per second."""
    for _ in range(WARMUP):
        call()
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=level) as pool:
        times = list(pool.map(lambda _: call(), range(REPEATS)))
    return summarize(times), REPEATS / (time.perf_counter() - started)


def main() -> int:
    points = os.environ.get("CASSANDRA_CONTACT_POINTS", "cassandra:9042").split(",")
    hosts = [point.split(":")[0] for point in points]
    port = int(points[0].split(":")[1]) if ":" in points[0] else 9042
    session = Cluster(hosts, port=port).connect(os.environ.get("CASSANDRA_KEYSPACE", "agri"))

    now = datetime.now(UTC)
    bucket_lo, bucket_hi = int((now - timedelta(hours=24)).timestamp() // 3600), int(now.timestamp() // 3600)
    # Cassandra reads whole hourly buckets, so Trino starts at the same bucket boundary and both
    # stores answer over exactly the same rows.
    window_start = f"from_unixtime({bucket_lo * 3600})"
    q0_cql = session.prepare("SELECT * FROM latest_by_field WHERE field_id = ?")
    q1_cql = session.prepare(
        "SELECT measured_at, value FROM readings_by_field_24h WHERE field_id = ? AND metric = ? AND bucket >= ? AND bucket <= ?"
    )

    def cassandra_q0() -> float:
        started = time.perf_counter()
        list(session.execute(q0_cql, (FIELD,)))
        return (time.perf_counter() - started) * 1000

    def cassandra_q1() -> float:
        started = time.perf_counter()
        list(session.execute(q1_cql, (FIELD, METRIC, bucket_lo, bucket_hi)))
        return (time.perf_counter() - started) * 1000

    def trino(sql: str):
        local = __import__("threading").local()

        def call() -> float:
            if not hasattr(local, "connection"):
                local.connection = trino_connection("lakehouse", "bronze")
            return millis(local.connection, sql)

        return call

    q0_trino = (
        "SELECT metric, max_by(value, measured_at) AS value, max(measured_at) AS measured_at "
        f"FROM lakehouse.bronze.sensor_readings WHERE field_id = '{FIELD}' "
        f"AND measured_at >= {window_start} GROUP BY metric"
    )
    q1_trino = (
        "SELECT measured_at, value FROM lakehouse.bronze.sensor_readings "
        f"WHERE field_id = '{FIELD}' AND metric = '{METRIC}' "
        f"AND measured_at >= {window_start} ORDER BY measured_at"
    )
    q2_trino = (
        f"SELECT day, avg_value FROM lakehouse.gold.field_daily WHERE field_id = '{FIELD}' AND metric = '{METRIC}' "
        "AND day >= current_date - INTERVAL '30' DAY ORDER BY day"
    )
    q3_trino = (
        "SELECT field_id, avg(avg_value), avg(time_in_range_pct), sum(hours_below_target) "
        f"FROM lakehouse.gold.field_indicators WHERE metric = '{METRIC}' "
        "AND day >= current_date - INTERVAL '30' DAY GROUP BY field_id ORDER BY 2 DESC"
    )

    probe = trino_connection("lakehouse", "bronze")
    sizes = {
        "cassandra readings_by_field_24h rows (field, metric)": len(
            list(session.execute(q1_cql, (FIELD, METRIC, bucket_lo, bucket_hi)))
        ),
        "trino bronze rows (field, metric, window)": len(run(probe, q1_trino)),
        "trino bronze rows (all, total)": run(probe, "SELECT count(*) FROM lakehouse.bronze.sensor_readings")[
            0
        ][0],
        "gold field_daily rows": run(probe, "SELECT count(*) FROM lakehouse.gold.field_daily")[0][0],
    }

    cassandra_rows = sizes["cassandra readings_by_field_24h rows (field, metric)"]
    trino_rows = sizes["trino bronze rows (field, metric, window)"]
    assert cassandra_rows == trino_rows, f"the stores hold different rows: {cassandra_rows} vs {trino_rows}"

    plan = [
        ("Q0 latest values of one field", "Cassandra", cassandra_q0),
        ("Q0 latest values of one field", "Trino", trino(q0_trino)),
        ("Q1 24 h series of one metric", "Cassandra", cassandra_q1),
        ("Q1 24 h series of one metric", "Trino", trino(q1_trino)),
        ("Q2 30-day daily history of one metric", "Trino", trino(q2_trino)),
        ("Q3 compare all fields, 30 days", "Trino", trino(q3_trino)),
    ]
    rows = []
    for name, store, call in plan:
        for level in LEVELS:
            stats, qps = concurrent(call, level)
            rows.append([name, store, level, stats["p50"], stats["p95"], round(qps, 1)])
            print(rows[-1], flush=True)

    write_results(
        "lookups.csv",
        {
            "benchmark": "2 Cassandra vs Trino-on-Iceberg",
            "field": FIELD,
            "metric": METRIC,
            "repeats": REPEATS,
            "warmup": WARMUP,
            "concurrency_levels": "/".join(map(str, LEVELS)),
            "cassandra": "5.0.3 single node, prepared statements",
            **sizes,
        },
        ["query", "store", "concurrency", "p50_ms", "p95_ms", "queries_per_s"],
        rows,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
