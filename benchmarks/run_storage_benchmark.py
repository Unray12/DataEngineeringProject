"""Benchmark #3: Iceberg against plain Hive/Parquet on the same data.

Both tables get the same synthetic readings through the same number of small commits (the way
the streaming job writes), then the same three queries are timed. Afterwards four behaviours
that only a table format provides are tried for real: replaying a batch, reading an earlier
state, adding a column and renaming one.

    just bench-storage
"""

from __future__ import annotations

import argparse
import sys

from common import (
    column_sql,
    commit_select,
    ensure_bench_schema,
    load_commits,
    run,
    time_query,
    trino_connection,
    window_filter,
    write_results,
)

ICEBERG = "lakehouse.bench.sensor_iceberg"
HIVE = "hive.bench_parquet.sensor_parquet"
COLUMNS = (
    "event_id, device_id, field_id, farm_id, crop_code, metric, value, unit, measured_at, ingested_at, "
    "is_late, quality_flag, source_topic, source_partition, source_offset, batch_id"
)


def attempt(connection, sql: str) -> str:
    try:
        run(connection, sql)
        return "ok"
    except Exception as error:  # the message is the evidence
        return f"error: {str(error).splitlines()[0][:70]}"


def timed(
    connection, template: str, table: str, first: int, days: int, kind: str, runs: int
) -> dict[str, float]:
    where = window_filter(first + 7, days, kind) if days else ""
    return time_query(connection, template.format(t=table, w=where), runs)


def count(connection, table: str) -> int:
    return int(run(connection, f"SELECT count(*) FROM {table}")[0][0])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commits", type=int, default=240)
    parser.add_argument("--rows", type=int, default=5000, help="readings per commit")
    parser.add_argument("--runs", type=int, default=20, help="timed runs per query")
    args = parser.parse_args()
    connection = trino_connection()

    ensure_bench_schema(connection)
    run(
        connection,
        "CREATE SCHEMA IF NOT EXISTS hive.bench_parquet WITH (location = 'hdfs://namenode:8020/warehouse/bench_parquet')",
    )
    for table in (ICEBERG, HIVE):
        run(connection, f"DROP TABLE IF EXISTS {table}")
    run(
        connection,
        f"CREATE TABLE {ICEBERG} ({column_sql('timestamp(6)')}) WITH (partitioning = ARRAY['day(measured_at)'], format = 'PARQUET')",
    )
    run(
        connection,
        f"CREATE TABLE {HIVE} ({column_sql('timestamp(3)')}, day date) WITH (format = 'PARQUET', partitioned_by = ARRAY['day'])",
    )

    load_seconds = {
        "iceberg": load_commits(
            connection,
            ICEBERG,
            args.commits,
            args.rows,
            False,
            lambda n: print("iceberg commits", n, flush=True),
        ),
        "hive": load_commits(
            connection, HIVE, args.commits, args.rows, True, lambda n: print("hive commits", n, flush=True)
        ),
    }
    total = args.commits * args.rows
    assert count(connection, ICEBERG) == total and count(connection, HIVE) == total

    files_iceberg = run(
        connection, 'SELECT count(*), sum(file_size_in_bytes) FROM lakehouse.bench."sensor_iceberg$files"'
    )[0]
    files_hive = run(
        connection,
        f'SELECT count(*), sum(s) FROM (SELECT "$path" AS p, max("$file_size") AS s FROM {HIVE} GROUP BY 1)',
    )[0]

    queries = {
        "a_one_day": ("SELECT count(*) FROM {t} WHERE {w}", 3, 1),
        "b_week_by_field": ("SELECT field_id, avg(value) FROM {t} WHERE {w} GROUP BY field_id", 3, 7),
        "c_full_by_metric": ("SELECT metric, avg(value), count(*) FROM {t} GROUP BY metric", 0, 0),
    }
    rows_out: list[list[object]] = []
    for name, (template, first, days) in queries.items():
        ice = timed(connection, template, ICEBERG, first, days, "iceberg", args.runs)
        hive = timed(connection, template, HIVE, first, days, "partition", args.runs)
        rows_out.append([f"{name} p50", ice["p50"], hive["p50"], "ms"])
        rows_out.append([f"{name} p95", ice["p95"], hive["p95"], "ms"])
        if days:
            ts = timed(connection, template, HIVE, first, days, "timestamp", args.runs)
            rows_out.append([f"{name} p50 (Hive, filter on measured_at only)", "", ts["p50"], "ms"])

    rows_out += [
        ["data files after load", int(files_iceberg[0]), int(files_hive[0]), "files"],
        [
            "average file size",
            round(files_iceberg[1] / files_iceberg[0] / 1024, 1),
            round(files_hive[1] / files_hive[0] / 1024, 1),
            "KiB",
        ],
        [
            "load time (commits one by one)",
            round(load_seconds["iceberg"], 1),
            round(load_seconds["hive"], 1),
            "s",
        ],
    ]

    # Behaviour that needs a table format. Replay batch 0 (the job re-runs it after a crash).
    before_ice, before_hive = count(connection, ICEBERG), count(connection, HIVE)
    run(
        connection,
        f"MERGE INTO {ICEBERG} t USING ({commit_select(0, args.rows, False)}) s ON t.event_id = s.event_id "
        f"WHEN NOT MATCHED THEN INSERT ({COLUMNS}) VALUES ({', '.join('s.' + c.strip() for c in COLUMNS.split(','))})",
    )
    run(connection, f"INSERT INTO {HIVE} {commit_select(0, args.rows, True)}")
    rows_out.append(
        [
            "duplicate rows after replaying one batch",
            count(connection, ICEBERG) - before_ice,
            count(connection, HIVE) - before_hive,
            "rows",
        ]
    )

    snapshot = run(
        connection,
        'SELECT snapshot_id FROM lakehouse.bench."sensor_iceberg$snapshots" ORDER BY committed_at OFFSET 1 LIMIT 1',
    )[0][0]
    first_state = count(connection, f"{ICEBERG} FOR VERSION AS OF {snapshot}")
    rows_out.append(
        [
            "rows in the first snapshot (time travel)",
            first_state,
            attempt(connection, f"SELECT count(*) FROM {HIVE} FOR VERSION AS OF 1"),
            "rows",
        ]
    )
    rows_out.append(
        [
            "ADD COLUMN",
            attempt(connection, f"ALTER TABLE {ICEBERG} ADD COLUMN extra varchar"),
            attempt(connection, f"ALTER TABLE {HIVE} ADD COLUMN extra varchar"),
            "",
        ]
    )
    # Renaming a column that already holds data: Iceberg tracks columns by id, Hive/Parquet by name.
    rename = [
        attempt(connection, f"ALTER TABLE {table} RENAME COLUMN unit TO unit_name")
        for table in (ICEBERG, HIVE)
    ]
    rows_out.append(["RENAME COLUMN unit", rename[0], rename[1], ""])
    rows_out.append(
        [
            "rows still readable under the new name",
            run(connection, f"SELECT count(unit_name) FROM {ICEBERG}")[0][0] if rename[0] == "ok" else "n/a",
            run(connection, f"SELECT count(unit_name) FROM {HIVE}")[0][0] if rename[1] == "ok" else "n/a",
            "rows",
        ]
    )

    write_results(
        "storage.csv",
        {
            "benchmark": "3 Iceberg vs Hive/Parquet",
            "commits": args.commits,
            "rows_per_commit": args.rows,
            "total_rows": total,
            "days": 30,
            "timed_runs_per_query": args.runs,
            "warmup_runs": 3,
            "partitioning": "iceberg day(measured_at); hive column day",
        },
        ["item", "iceberg", "hive_parquet", "unit"],
        rows_out,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
