"""Data-correctness checks of the evaluation.

1. Fault detection. Kafka is the ground truth: every message carries the simulator's
   ``simulated_fault`` label. For each label the script counts the messages sent, then where they
   ended up (bronze with which quality flag, or quarantine with which reason). A re-sent duplicate
   is a message whose ``event_id`` was already sent; it must not add a second row to bronze.
2. Gold against silver. Every ``gold.field_daily`` row is recomputed from silver (statistics over
   ``quality_flag = 'ok'`` rows, counts over all non-null rows) and compared.
3. Implausible values in gold: ``field_daily`` min/max outside the physical range of the metric.

Run from the host after ``just batch-run``: ``just check-correctness``. Kafka keeps 7 days, so check 1
covers the offsets Kafka still holds, and bronze and quarantine are filtered to the same offsets.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime

import host
from common import run, trino_connection, write_results

EXPECTED = {
    "null_value": "flag null_value",
    "out_of_range": "flag out_of_range",
    "implausible_jump": "flag implausible_jump",
    "unknown_device": "quarantine unknown_device",
    "unexpected_metric": "quarantine unexpected_metric",
}
MALFORMED = {"quarantine missing_field", "quarantine invalid_timestamp", "quarantine malformed_value"}


def fault_rows(trino, since: datetime | None) -> list[list[object]]:
    start = host.kafka_offsets_at(since) if since else host.kafka_start_offsets()
    end = host.kafka_end_offsets()
    messages = host.kafka_messages(start, end)
    held = host.offset_filter(start, end)
    events = [(q, o, _json(v)) for q, o, v in messages]
    sent: Counter[str] = Counter()
    first_seen: set[str] = set()
    resent = 0
    for _, _, event in events:
        label = (event or {}).get("simulated_fault") or "none"
        event_id = (event or {}).get("event_id")
        if label == "duplicate" and event_id in first_seen:
            resent += 1
            continue
        first_seen.add(event_id)
        sent[label] += 1

    outcome: dict[str, Counter[str]] = {}
    for label, flag, n in run(
        trino,
        "SELECT coalesce(simulated_fault, 'none'), quality_flag, count(*) FROM lakehouse.bronze.sensor_readings "
        f"WHERE {held} GROUP BY 1, 2",
    ):
        outcome.setdefault(label, Counter())[f"flag {flag}"] += n
    for label, reason, n in run(
        trino,
        "SELECT coalesce(json_extract_scalar(raw_payload, '$.simulated_fault'), 'none'), reason, count(*) "
        f"FROM lakehouse.ops.quarantine WHERE {held} GROUP BY 1, 2",
    ):
        outcome.setdefault(label, Counter())[f"quarantine {reason}"] += n
    extra_rows = run(
        trino,
        f"SELECT count(*) - count(DISTINCT event_id) FROM lakehouse.bronze.sensor_readings WHERE {held}",
    )[0][0]
    flagged_in_batch = run(
        trino,
        "SELECT coalesce(sum(duplicate), 0) FROM lakehouse.ops.quality_counters WHERE batch_id >= "
        f"(SELECT min(batch_id) FROM lakehouse.bronze.sensor_readings WHERE {held})",
    )[0][0]

    rows = []
    for label in [*EXPECTED, "malformed", "duplicate (original)", "none"]:
        key = "duplicate" if label.startswith("duplicate") else label
        found = outcome.get(key, Counter())
        if label == "malformed":
            expected = sum(n for where, n in found.items() if where in MALFORMED)
        elif label in EXPECTED:
            expected = found[EXPECTED[label]]
        else:
            expected = found["flag ok"]
        rows.append(["fault", label, sent[key], sum(found.values()), expected, _describe(found)])
    rows.append(
        [
            "fault",
            "duplicate (re-sent)",
            resent,
            resent - extra_rows,
            resent - extra_rows,
            f"extra bronze rows per event_id: {extra_rows}; flagged duplicate within a batch: {flagged_in_batch}",
        ]
    )
    return rows


def reconcile_rows(trino) -> list[list[object]]:
    total, mismatched = run(
        trino,
        """WITH recomputed AS (
               SELECT field_id, metric, cast(date_trunc('day', measured_at) AS date) AS day,
                      min(CASE WHEN quality_flag = 'ok' THEN value END) AS min_value,
                      max(CASE WHEN quality_flag = 'ok' THEN value END) AS max_value,
                      avg(CASE WHEN quality_flag = 'ok' THEN value END) AS avg_value,
                      count(*) AS reading_count,
                      count_if(quality_flag = 'ok') AS valid_count
               FROM lakehouse.silver.sensor_readings
               WHERE value IS NOT NULL
               GROUP BY 1, 2, 3)
           SELECT count(*),
                  count_if(r.day IS NULL
                           OR g.reading_count <> r.reading_count OR g.valid_count <> r.valid_count
                           OR NOT (g.min_value IS NOT DISTINCT FROM r.min_value)
                           OR NOT (g.max_value IS NOT DISTINCT FROM r.max_value)
                           OR abs(coalesce(g.avg_value, 0) - coalesce(r.avg_value, 0)) > 1e-9
                           OR (g.avg_value IS NULL) <> (r.avg_value IS NULL))
           FROM lakehouse.gold.field_daily g
           LEFT JOIN recomputed r ON g.field_id = r.field_id AND g.metric = r.metric AND g.day = r.day""",
    )[0]
    missing = run(
        trino,
        """SELECT count(*) FROM (
               SELECT DISTINCT field_id, metric, cast(date_trunc('day', measured_at) AS date) AS day
               FROM lakehouse.silver.sensor_readings WHERE value IS NOT NULL) s
           LEFT JOIN lakehouse.gold.field_daily g
             ON s.field_id = g.field_id AND s.metric = g.metric AND s.day = g.day
           WHERE g.day IS NULL""",
    )[0][0]
    return [
        [
            "reconcile",
            "field_daily rows compared",
            total,
            mismatched,
            total - mismatched,
            "mismatched = any count, min, max or avg (1e-9) differs from silver",
        ],
        ["reconcile", "silver (field, metric, day) missing in gold", missing, missing, 0, "expected 0"],
    ]


def implausible_rows(trino) -> list[list[object]]:
    ranges = " ".join(
        f"WHEN '{m['metric']}' THEN min_value < {m['min']} OR max_value > {m['max']}"
        for m in host.reference()["metrics"]
    )
    total, outside = run(
        trino,
        f"SELECT count(*), count_if(CASE metric {ranges} ELSE false END) FROM lakehouse.gold.field_daily",
    )[0]
    flagged = run(
        trino,
        "SELECT count(*) FROM lakehouse.silver.sensor_readings WHERE quality_flag = 'out_of_range'",
    )[0][0]
    return [
        [
            "implausible",
            "field_daily rows outside the metric range",
            total,
            outside,
            total - outside,
            f"silver still holds {flagged} out_of_range readings; gold statistics exclude them",
        ],
    ]


def _json(value: bytes) -> dict | None:
    try:
        event = json.loads(value)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


def _describe(found: Counter[str]) -> str:
    return "; ".join(f"{where}: {n}" for where, n in found.most_common())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since", type=datetime.fromisoformat, help="UTC time; fault check covers later messages"
    )
    args = parser.parse_args()
    host.detect_hardware()
    trino = trino_connection()
    rows = [*fault_rows(trino, args.since), *reconcile_rows(trino), *implausible_rows(trino)]
    for row in rows:
        print(row)
    write_results(
        "correctness.csv",
        {
            "check": "section 5.2 data correctness",
            "ground_truth": "Kafka messages with their simulated_fault label: "
            + (
                f"sent since {args.since:%Y-%m-%d %H:%M} UTC"
                if args.since
                else "all still held (7-day retention)"
            ),
            "data": "all data collected so far, after just batch-run",
        },
        ["check", "item", "sent_or_rows", "found_or_mismatched", "as_expected", "detail"],
        rows,
    )


if __name__ == "__main__":
    main()
