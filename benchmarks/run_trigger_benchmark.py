"""Benchmark #1: micro-batch trigger interval 10 s / 30 s / 60 s (AGENTS.md, Nhân's part of BR2/BR3).

For each interval the script restarts the streaming job, lets it settle, then measures a fixed
window of the normal simulator load:

* end-to-end latency: Cassandra ``writetime()`` of each reading minus its Kafka timestamp
  (``ingested_at``), i.e. from the moment the platform accepted the event until the near real-time
  dashboard can read it;
* outage-alert latency: write time of each ``device_offline`` alert minus the moment the device
  crossed the offline threshold (its last reading + 4 x 5 s), with the simulator forced to stay
  silent long enough (``--gap-min``) that every outage must alert;
* throughput and load: events per second, events and processing seconds per batch, CPU and
  memory of the Spark container (``docker stats``), and Iceberg commits/files written to bronze.

Run from the host (it starts and stops containers): ``just bench-trigger``.
"""

from __future__ import annotations

import argparse
import statistics
import time
from datetime import UTC, datetime, timedelta

import host
from common import percentile, run, trino_connection, write_results

OFFLINE_AFTER_S = 20  # DEVICE_OFFLINE_MULTIPLIER (4) x reporting interval (5 s)


def seconds(text: str) -> int:
    return int(text.rstrip("s"))


def p(values: list[float], q: float) -> float | str:
    return round(percentile(values, q), 2) if values else ""


def reading_latencies(session, t0: datetime, t1: datetime) -> list[float]:
    """Seconds from Kafka append to Cassandra write, for every reading ingested in [t0, t1)."""
    buckets = list(range(int(t0.timestamp()) // 3600 - 1, int(t1.timestamp()) // 3600 + 1))
    query = session.prepare(
        "SELECT ingested_at, writetime(value) AS written FROM readings_by_field_24h "
        "WHERE field_id = ? AND metric = ? AND bucket IN ?"
    )
    latencies = []
    for field_id, metric in host.field_metrics():
        for row in session.execute(query, (field_id, metric, buckets)):
            ingested = row.ingested_at.replace(tzinfo=UTC)
            if row.written is not None and t0 <= ingested < t1:
                latencies.append(row.written / 1e6 - ingested.timestamp())
    return latencies


def outage_alerts(session, trino, t0: datetime, t1: datetime) -> tuple[list[float], int]:
    """Latency of each outage alert for gaps that crossed the threshold in [t0, t1), and missed outages."""
    gaps = run(
        trino,
        f"""SELECT device_id, field_id, gap_start FROM lakehouse.ops.device_gaps
            WHERE gap_start >= TIMESTAMP '{t0:%Y-%m-%d %H:%M:%S} UTC' - INTERVAL '{OFFLINE_AFTER_S}' SECOND
              AND gap_start < TIMESTAMP '{t1:%Y-%m-%d %H:%M:%S} UTC' - INTERVAL '{OFFLINE_AFTER_S}' SECOND""",
    )
    query = session.prepare(
        "SELECT condition_code, created_at, writetime(alert_type) AS written FROM alerts_by_field "
        "WHERE field_id = ? AND created_at >= ?"
    )
    latencies, missed = [], 0
    for device_id, field_id, gap_start in gaps:
        threshold = gap_start.replace(tzinfo=UTC) + timedelta(seconds=OFFLINE_AFTER_S)
        written = [
            row.written / 1e6
            for row in session.execute(query, (field_id, threshold.replace(tzinfo=None)))
            if row.condition_code == f"device_offline:{device_id}"
        ]
        if written:
            latencies.append(min(written) - threshold.timestamp())
        else:
            missed += 1
    return latencies, missed


def bronze_commits(trino, t0: datetime, t1: datetime) -> tuple[int, int]:
    rows = run(
        trino,
        f"""SELECT count(*), coalesce(sum(cast(summary['added-data-files'] AS integer)), 0)
            FROM lakehouse.bronze."sensor_readings$snapshots"
            WHERE committed_at >= TIMESTAMP '{t0:%Y-%m-%d %H:%M:%S} UTC'
              AND committed_at < TIMESTAMP '{t1:%Y-%m-%d %H:%M:%S} UTC'""",
    )
    return rows[0][0], rows[0][1]


def measure(trigger: str, args: argparse.Namespace, session, trino) -> list[object]:
    interval = seconds(trigger)
    host.stop_stream()
    started = host.start_stream(trigger)
    first = host.wait_for_batch(started)
    print(
        f"[{trigger}] first batch {first.batch_id} after start took {first.seconds:.1f}s; settling {args.settle}s"
    )
    time.sleep(args.settle)

    offsets0, t0 = host.kafka_end_offsets(), datetime.now(UTC)
    with host.StatsSampler(host.STREAM) as stats:
        time.sleep(args.window)
    t1, offsets1 = datetime.now(UTC), host.kafka_end_offsets()

    # Readings and alerts of the window land within a few batches after t1.
    deadline = time.monotonic() + 3 * interval + 300
    while time.monotonic() < deadline:
        if any(
            b.logged_at - timedelta(seconds=b.seconds) > t1 + timedelta(seconds=2 * interval)
            for b in host.stream_batches(t1)
        ):
            break
        time.sleep(5)

    batches = [
        b
        for b in host.stream_batches(t0)
        if t0 <= b.logged_at - timedelta(seconds=b.seconds) and b.logged_at <= t1
    ]
    events = sum(offsets1[q] - offsets0[q] for q in offsets1)
    latencies = reading_latencies(session, t0, t1)
    alert_latencies, missed = outage_alerts(session, trino, t0, t1)
    commits, files = bronze_commits(trino, t0, t1)
    hours = args.window / 3600
    busy = sum(b.seconds for b in batches)
    print(
        f"[{trigger}] {len(batches)} batches, {events} events, {len(latencies)} readings timed, "
        f"{len(alert_latencies)} outage alerts ({missed} missed)"
    )
    return [
        interval,
        args.window,
        events,
        round(events / args.window, 2),
        len(batches),
        round(statistics.median([b.events for b in batches]), 1) if batches else "",
        p([b.seconds for b in batches], 0.5),
        p([b.seconds for b in batches], 0.95),
        round(100 * busy / args.window, 1),
        len(latencies),
        p(latencies, 0.5),
        p(latencies, 0.95),
        round(max(latencies), 2) if latencies else "",
        len(alert_latencies),
        p(alert_latencies, 0.5),
        round(max(alert_latencies), 2) if alert_latencies else "",
        missed,
        round(statistics.mean(stats.cpu), 1) if stats.cpu else "",
        p(stats.cpu, 0.95),
        round(max(stats.mem_mib)) if stats.mem_mib else "",
        round(commits / hours),
        round(files / hours),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--triggers", default="10s,30s,60s")
    parser.add_argument("--window", type=int, default=360, help="measured seconds per interval")
    parser.add_argument(
        "--settle", type=int, default=180, help="seconds after the first batch before measuring"
    )
    parser.add_argument("--gap-rate", default="0.015")
    parser.add_argument("--gap-min", default="180")
    parser.add_argument("--gap-max", default="240")
    args = parser.parse_args()
    host.detect_hardware()

    sim_env = {
        "SIM_GAP_RATE": args.gap_rate,
        "SIM_GAP_SECONDS_MIN": args.gap_min,
        "SIM_GAP_SECONDS_MAX": args.gap_max,
    }
    host.stop_simulator()
    host.start_simulator(sim_env)
    session, trino = host.cassandra_session(), trino_connection()
    try:
        rows = [measure(trigger, args, session, trino) for trigger in args.triggers.split(",")]
    finally:
        host.stop_simulator()
        host.stop_stream()
        host.start_stream()  # leave the job running at the default 30 s
    write_results(
        "trigger.csv",
        {
            "benchmark": "#1 micro-batch trigger interval",
            "load": "simulator, 24 devices every 5 s (about 8 events/s), default fault rate 0.05",
            "outages": f"SIM_GAP_RATE={args.gap_rate}, silent {args.gap_min}-{args.gap_max} s (longer than any debounce)",
            "window_s": args.window,
            "settle_s": args.settle,
            "max_offsets_per_trigger": 20000,
            "alerting": "ALERT_DEBOUNCE_BATCHES=2, offline after 20 s",
            "latency": "Cassandra writetime(value) - Kafka timestamp (ingested_at)",
            "alert_latency": "writetime(alert) - (last reading + 20 s)",
        },
        [
            "trigger_s",
            "window_s",
            "events",
            "events_per_s",
            "batches",
            "events_per_batch_p50",
            "batch_s_p50",
            "batch_s_p95",
            "busy_pct",
            "readings_timed",
            "latency_s_p50",
            "latency_s_p95",
            "latency_s_max",
            "outage_alerts",
            "alert_latency_s_p50",
            "alert_latency_s_max",
            "missed_outages",
            "cpu_pct_avg",
            "cpu_pct_p95",
            "mem_mib_max",
            "bronze_commits_per_h",
            "bronze_files_per_h",
        ],
        rows,
    )


if __name__ == "__main__":
    main()
