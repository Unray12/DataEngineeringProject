"""Benchmark #5: recovery and replay, no loss and no duplicates (AGENTS.md, FR3.3).

While the simulator keeps sending, the script stops the streaming job, waits ``--outage``
seconds so a backlog builds up in Kafka, then starts the job again on the same checkpoint.
Three scenarios: ``sigkill`` kills the container a few seconds into a micro-batch (offsets planned,
nothing written); ``sigkill-after-bronze`` kills it the moment the batch's bronze MERGE is committed
(Cassandra and alerts not yet written, so the restart re-runs a half-written batch); ``stop`` is a
normal ``docker compose stop``. ``docker kill`` runs no shutdown hook, like a crash.

Kafka is the ground truth. Every message between the offsets taken before the outage and after
the simulator stops must be accounted for exactly once:

* its (partition, offset) is in ``bronze.sensor_readings`` or ``ops.quarantine``, or
* it is a re-sent duplicate whose key ``(device_id, metric, measured_at)`` is already in bronze.

A message that is in none of them is lost. A bronze key, or a quarantine offset, stored twice is a
duplicate. The near real-time table ``readings_by_field_24h`` must hold every bronze reading that the
dashboard shows (flags ``ok`` and ``implausible_jump``).

Run from the host (it kills containers): ``just bench-replay``.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime, timedelta

import host
from common import run, trino_connection, write_results

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
# Bronze keeps microseconds, Cassandra milliseconds: compare whole milliseconds, truncated on both sides.
EPOCH_MS = "date_diff('millisecond', TIMESTAMP '1970-01-01 00:00:00 UTC', measured_at)"


def ms(value: datetime) -> int:
    return (value.replace(tzinfo=value.tzinfo or UTC) - EPOCH) // timedelta(milliseconds=1)


def parse_ts(text: str) -> int | None:
    try:
        return ms(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except (AttributeError, ValueError):
        return None


def wait_mid_batch(since: datetime, delay_s: float, interval_s: int = 30) -> int:
    """Sleep until ``delay_s`` into the next micro-batch and return its id.

    A processing-time trigger starts batches on multiples of the interval (epoch-aligned), right
    after the previous batch when that one overran.
    """
    last = host.wait_for_batch(since)
    next_start = -(-last.logged_at.timestamp() // interval_s) * interval_s
    time.sleep(max(0.0, next_start - time.time()) + delay_s)
    return max(b.batch_id for b in host.stream_batches(since)) + 1


def scenario(name: str, args: argparse.Namespace, trino) -> list[object]:
    print(f"[{name}] warming up")
    host.stop_stream()
    host.start_simulator()
    started = host.start_stream()
    host.wait_for_batch(started)
    time.sleep(args.settle)

    start = host.kafka_end_offsets()
    time.sleep(args.before)
    if name == "sigkill":
        # Early in a batch: the offsets of the batch are planned, nothing is written yet.
        wait_mid_batch(started, args.kill_delay)
        host.kill_stream()
    elif name == "sigkill-after-bronze":
        # Late in a batch: bronze already committed, the Cassandra writes and alerts not yet done.
        planned = max(b.batch_id for b in host.stream_batches(started)) + 1
        while not run(
            trino, f"SELECT count(*) FROM lakehouse.bronze.sensor_readings WHERE batch_id = {planned}"
        )[0][0]:
            time.sleep(0.2)
        host.kill_stream()
    else:
        host.compose("stop", host.STREAM)
    stopped = host.kafka_end_offsets()
    last_done = max(b.batch_id for b in host.stream_batches(started))  # read the log before removing it
    host.compose("rm", "-f", host.STREAM)
    # What the interrupted batch left behind before the restart:
    partial = run(
        trino, f"SELECT count(*) FROM lakehouse.bronze.sensor_readings WHERE batch_id = {last_done + 1}"
    )[0][0]
    print(
        f"[{name}] down after batch {last_done}; {partial} rows of batch {last_done + 1} in bronze; outage {args.outage}s"
    )
    time.sleep(args.outage)

    backlog_end = host.kafka_end_offsets()
    restarted = host.start_stream()
    host.wait_for_batch(restarted)
    first = min(host.stream_batches(restarted), key=lambda b: b.batch_id)
    time.sleep(args.after)

    host.stop_simulator()
    end = host.kafka_end_offsets()
    stop_at = datetime.now(UTC)
    # Two complete batches that started after the last message: everything sent is processed.
    while sum(b.logged_at - timedelta(seconds=b.seconds) > stop_at for b in host.stream_batches(stop_at)) < 2:
        time.sleep(5)

    messages = host.kafka_messages(start, end)
    window = host.offset_filter(start, end)
    bronze_by_offset = {
        (q, o): key
        for q, o, *key in run(
            trino,
            f"SELECT source_partition, source_offset, device_id, metric, {EPOCH_MS}, quality_flag "
            f"FROM lakehouse.bronze.sensor_readings WHERE {window}",
        )
    }
    quarantine = {
        (q, o)
        for q, o in run(
            trino, f"SELECT source_partition, source_offset FROM lakehouse.ops.quarantine WHERE {window}"
        )
    }
    times = [parse_ts(json.loads(v).get("reading_ts", "")) for _, _, v in messages if _json(v)]
    low, high = min(t for t in times if t), max(t for t in times if t)
    bronze_keys = {
        (d, m, t)
        for d, m, t in run(
            trino,
            f"SELECT device_id, metric, {EPOCH_MS} FROM lakehouse.bronze.sensor_readings "
            f"WHERE measured_at BETWEEN from_unixtime({low / 1000 - 3600}) AND from_unixtime({high / 1000 + 3600})",
        )
    }

    lost, by_key = 0, 0
    for q, o, value in messages:
        if (q, o) in bronze_by_offset or (q, o) in quarantine:
            continue
        event = _json(value) or {}
        key = (event.get("device_id"), event.get("metric"), parse_ts(event.get("reading_ts", "")))
        if key in bronze_keys:
            by_key += 1  # a re-sent duplicate collapsed onto the reading that was already stored
        else:
            lost += 1

    dup_keys = run(
        trino,
        "SELECT count(*) FROM (SELECT device_id, metric, measured_at FROM lakehouse.bronze.sensor_readings "
        "GROUP BY 1, 2, 3 HAVING count(*) > 1)",
    )[0][0]
    dup_offsets = run(
        trino,
        "SELECT count(*) FROM (SELECT source_partition, source_offset FROM lakehouse.ops.quarantine "
        "GROUP BY 1, 2 HAVING count(*) > 1)",
    )[0][0]
    shown = {
        (_field(d), m, t) for d, m, t, flag in bronze_by_offset.values() if flag in ("ok", "implausible_jump")
    }
    cassandra = cassandra_keys(low, high)
    missing = len(shown - cassandra)

    print(
        f"[{name}] {len(messages)} messages: lost={lost}, duplicate keys={dup_keys}, cassandra missing={missing}"
    )
    return [
        name,
        args.outage,
        len(messages),
        sum(backlog_end[q] - stopped[q] for q in end),
        last_done,
        partial,
        first.batch_id,
        "yes" if first.batch_id == last_done + 1 else "no",
        round((first.logged_at - restarted).total_seconds(), 1),
        first.events,
        first.seconds,
        len(bronze_by_offset),
        len(quarantine),
        by_key,
        lost,
        dup_keys,
        dup_offsets,
        len(shown),
        missing,
    ]


def _json(value: bytes) -> dict | None:
    try:
        event = json.loads(value)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


DEVICE_FIELD = {d["device_id"]: d["field_id"] for d in host.reference()["devices"]}


def _field(device_id: str) -> str | None:
    return DEVICE_FIELD.get(device_id)


def cassandra_keys(low_ms: int, high_ms: int) -> set[tuple[str, str, int]]:
    session = host.cassandra_session()
    query = session.prepare(
        "SELECT measured_at FROM readings_by_field_24h WHERE field_id = ? AND metric = ? AND bucket IN ?"
    )
    buckets = list(range(low_ms // 3_600_000, high_ms // 3_600_000 + 1))
    keys = set()
    for field_id, metric in host.field_metrics():
        for row in session.execute(query, (field_id, metric, buckets)):
            keys.add((field_id, metric, ms(row.measured_at)))
    session.cluster.shutdown()
    return keys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenarios", default="sigkill,sigkill-after-bronze,stop")
    parser.add_argument(
        "--settle", type=int, default=120, help="seconds after the first batch before the test"
    )
    parser.add_argument(
        "--before", type=int, default=60, help="seconds of normal processing before the outage"
    )
    parser.add_argument("--outage", type=int, default=180, help="seconds the job stays down")
    parser.add_argument(
        "--after", type=int, default=90, help="seconds of normal processing after the restart"
    )
    parser.add_argument("--kill-delay", type=float, default=2.0, help="seconds into a batch before SIGKILL")
    args = parser.parse_args()
    host.detect_hardware()
    trino = trino_connection()
    rows: list[list[object]] = []
    try:
        for name in args.scenarios.split(","):
            rows.append(scenario(name, args, trino))
            save(args, rows)  # after every scenario, so a later failure keeps the finished ones
    finally:
        host.stop_simulator()
        if not host.container(host.STREAM):
            host.start_stream()


def save(args: argparse.Namespace, rows: list[list[object]]) -> None:
    write_results(
        "replay.csv",
        {
            "benchmark": "#5 recovery and replay",
            "load": "simulator defaults (24 devices every 5 s, fault rate 0.05, duplicates included)",
            "trigger": "30s",
            "outage_s": args.outage,
            "scenarios": f"sigkill = docker kill -s KILL {args.kill_delay}s into a batch; sigkill-after-bronze = "
            "KILL as soon as the batch's bronze MERGE is committed; stop = docker compose stop",
            "ground_truth": "every Kafka message between the offsets before the outage and after the simulator stops",
            "checkpoint": "HDFS /checkpoints (unchanged across the restart)",
        },
        [
            "scenario",
            "outage_s",
            "kafka_messages",
            "backlog_messages",
            "last_completed_batch",
            "next_batch_rows_in_bronze_before_restart",
            "first_batch_after_restart",
            "resumed_at_next_batch",
            "restart_to_first_batch_s",
            "first_batch_events",
            "first_batch_s",
            "bronze_rows",
            "quarantine_rows",
            "duplicates_collapsed",
            "lost",
            "duplicate_keys_bronze",
            "duplicate_offsets_quarantine",
            "dashboard_readings",
            "missing_in_cassandra",
        ],
        rows,
    )


if __name__ == "__main__":
    main()
