"""Benchmark #4: effect of compaction on file count and query time.

Phase ``before`` loads many small commits into an Iceberg table and measures it. The recipe then
runs ``just compact`` (dbt macro, ``rewrite_data_files``) and phase ``after`` measures again, so the
compaction is the project's own mechanism and not a stand-in.

    just bench-compaction
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from common import (
    RESULTS_DIR,
    column_sql,
    ensure_bench_schema,
    load_commits,
    run,
    time_query,
    trino_connection,
    window_filter,
    write_results,
)

TABLE = "lakehouse.bench.sensor_compaction"
STATE = RESULTS_DIR / ".compaction_before.json"
QUERIES = {
    "a_one_day": "SELECT count(*) FROM {t} WHERE {w}",
    "b_week_by_field": "SELECT field_id, avg(value) FROM {t} WHERE {w} GROUP BY field_id",
}


def measure(connection, runs: int) -> dict[str, float]:
    files = run(
        connection, 'SELECT count(*), sum(file_size_in_bytes) FROM lakehouse.bench."sensor_compaction$files"'
    )[0]
    snapshots = run(connection, 'SELECT count(*) FROM lakehouse.bench."sensor_compaction$snapshots"')[0][0]
    result: dict[str, float] = {
        "files": int(files[0]),
        "avg_file_kib": round(files[1] / files[0] / 1024, 1),
        "snapshots": int(snapshots),
    }
    for name, template in QUERIES.items():
        days = 1 if name.startswith("a_") else 7
        timing = time_query(connection, template.format(t=TABLE, w=window_filter(10, days, "iceberg")), runs)
        result[f"{name}_p50"], result[f"{name}_p95"] = timing["p50"], timing["p95"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["before", "after"], required=True)
    parser.add_argument("--commits", type=int, default=240)
    parser.add_argument("--rows", type=int, default=5000)
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args()
    connection = trino_connection()

    if args.phase == "before":
        ensure_bench_schema(connection)
        run(connection, f"DROP TABLE IF EXISTS {TABLE}")
        run(
            connection,
            f"CREATE TABLE {TABLE} ({column_sql('timestamp(6)')}) WITH (partitioning = ARRAY['day(measured_at)'], format = 'PARQUET')",
        )
        seconds = load_commits(
            connection, TABLE, args.commits, args.rows, False, lambda n: print("commits", n, flush=True)
        )
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({**measure(connection, args.runs), "load_seconds": round(seconds, 1)}))
        return 0

    before = json.loads(STATE.read_text())
    after = measure(connection, args.runs)
    total = int(run(connection, f"SELECT count(*) FROM {TABLE}")[0][0])
    assert total == args.commits * args.rows, "compaction must not change the row count"
    rows = [
        ["data files", before["files"], after["files"], "files"],
        ["average file size", before["avg_file_kib"], after["avg_file_kib"], "KiB"],
        ["snapshots", before["snapshots"], after["snapshots"], "snapshots"],
    ]
    for name in QUERIES:
        rows.append([f"{name} p50", before[f"{name}_p50"], after[f"{name}_p50"], "ms"])
        rows.append([f"{name} p95", before[f"{name}_p95"], after[f"{name}_p95"], "ms"])
    rows.append(
        ["compaction run time (just compact)", "", float(os.environ.get("COMPACT_SECONDS", "nan")), "s"]
    )
    write_results(
        "compaction.csv",
        {
            "benchmark": "4 compaction",
            "commits": args.commits,
            "rows_per_commit": args.rows,
            "total_rows": total,
            "strategy": "rewrite_data_files binpack",
            "timed_runs_per_query": args.runs,
            "warmup_runs": 3,
        },
        ["item", "before", "after", "unit"],
        rows,
    )
    STATE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
