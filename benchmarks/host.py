"""Helpers for the benchmarks that drive the stack from the host (#1 trigger, #5 replay, #6 web).

Benchmarks #2-#4 only query Trino and Cassandra, so they run inside the ``api`` image. #1 and
#5 also stop, start and kill the streaming container and sample ``docker stats``, which only the
host can do, so they run with ``uv run`` and reach the services through their published ports.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Published ports (docker-compose.yml); the in-container defaults in common.py do not apply here.
os.environ.setdefault("BENCH_RESULTS_DIR", str(ROOT / "benchmarks" / "results"))
os.environ.setdefault("TRINO_HOST", "localhost")
os.environ.setdefault("TRINO_PORT_INTERNAL", os.environ.get("TRINO_PORT", "8080"))

COMPOSE = ["docker", "compose", "--profile", "core", "--profile", "processing", "--profile", "serving"]
STREAM = "spark-stream"
SIMULATOR = "simulator"
BATCH_LINE = re.compile(r"^(\S+ \S+) .*batch (\d+): events=(\d+) .* in ([\d.]+)s$")


def _sh(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def detect_hardware() -> None:
    """Fill the BENCH_HOST_* variables that ``common.host_config`` records (same values as ``just _bench``)."""

    def sysctl(key: str) -> str:
        try:
            return _sh("sysctl", "-n", key)
        except (OSError, subprocess.CalledProcessError):
            return ""

    os.environ.setdefault("BENCH_HOST_CPU", sysctl("machdep.cpu.brand_string") or os.uname().machine)
    os.environ.setdefault("BENCH_HOST_CORES", sysctl("hw.ncpu") or str(os.cpu_count()))
    memsize = sysctl("hw.memsize")
    os.environ.setdefault("BENCH_HOST_RAM_GB", str(int(memsize) // 1073741824) if memsize else "unknown")
    try:
        total = int(_sh("docker", "info", "--format", "{{.MemTotal}}"))
        os.environ.setdefault("BENCH_DOCKER_MEM_GB", f"{total / 1073741824:.2f}GiB")
    except (OSError, subprocess.CalledProcessError, ValueError):
        os.environ.setdefault("BENCH_DOCKER_MEM_GB", "unknown")


def compose(*args: str, env: dict[str, str] | None = None) -> None:
    subprocess.run([*COMPOSE, *args], check=True, cwd=ROOT, env={**os.environ, **(env or {})})


def container(service: str) -> str:
    return subprocess.run(
        [*COMPOSE, "ps", "-q", service], check=True, capture_output=True, text=True, cwd=ROOT
    ).stdout.strip()


def start_stream(trigger: str = "") -> datetime:
    """Start the streaming job detached (empty trigger = the 30 s default); returns the start time."""
    started = datetime.now(UTC)
    compose("up", "-d", "--no-deps", STREAM, env={"TRIGGER_INTERVAL": trigger, "MAX_OFFSETS_PER_TRIGGER": ""})
    return started


def stop_stream() -> None:
    compose("stop", STREAM)
    compose("rm", "-f", STREAM)


def kill_stream() -> None:
    """SIGKILL: no shutdown hook runs, like a crashed container. The container is kept for its logs."""
    subprocess.run(["docker", "kill", "--signal", "KILL", container(STREAM)], check=True, capture_output=True)


def start_simulator(env: dict[str, str] | None = None) -> None:
    compose("up", "-d", "--no-deps", SIMULATOR, env={"SIM_DURATION_SECONDS": "0", **(env or {})})


def stop_simulator() -> None:
    compose("stop", SIMULATOR)
    compose("rm", "-f", SIMULATOR)


@dataclass
class Batch:
    logged_at: datetime
    batch_id: int
    events: int
    seconds: float


def stream_batches(since: datetime) -> list[Batch]:
    """Micro-batches the streaming job logged since ``since`` (pipeline.py logs one line per batch)."""
    out = subprocess.run(
        [*COMPOSE, "logs", "--no-log-prefix", "--since", since.strftime("%Y-%m-%dT%H:%M:%SZ"), STREAM],
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    ).stdout
    batches = []
    for line in out.splitlines():
        match = BATCH_LINE.match(line.strip())
        if match:
            stamp, batch_id, events, seconds = match.groups()
            logged = datetime.strptime(stamp.split(",")[0], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
            batches.append(Batch(logged, int(batch_id), int(events), float(seconds)))
    return batches


def wait_for_batch(since: datetime, after_id: int = -1, timeout_s: float = 900) -> Batch:
    """Block until the job logs a batch with an id above ``after_id``."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        batches = [b for b in stream_batches(since) if b.batch_id > after_id]
        if batches:
            return batches[-1]
        time.sleep(3)
    raise TimeoutError(f"{STREAM} logged no micro-batch within {timeout_s:.0f}s")


@dataclass
class StatsSampler:
    """Samples ``docker stats`` of one service in the background (CPU %, memory MiB)."""

    service: str
    every_s: float = 5.0
    cpu: list[float] = field(default_factory=list)
    mem_mib: list[float] = field(default_factory=list)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def __enter__(self) -> StatsSampler:
        target = container(self.service)

        def loop() -> None:
            while not self._stop.is_set():
                try:
                    stats = json.loads(
                        _sh("docker", "stats", "--no-stream", "--format", "{{json .}}", target)
                    )
                    self.cpu.append(float(stats["CPUPerc"].rstrip("%")))
                    self.mem_mib.append(_mib(stats["MemUsage"].split("/")[0].strip()))
                except (subprocess.CalledProcessError, ValueError, KeyError, AttributeError):
                    pass
                self._stop.wait(self.every_s)

        self._thread = threading.Thread(target=loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join()


def _mib(text: str) -> float:
    number, unit = re.match(r"([\d.]+)\s*([A-Za-z]+)", text).groups()
    scale = {"B": 1 / 1048576, "KiB": 1 / 1024, "kB": 1 / 1024, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1024}
    return float(number) * scale[unit]


def _consumer(group: str):
    from confluent_kafka import Consumer

    return Consumer(
        {
            "bootstrap.servers": os.environ.get("KAFKA_BOOTSTRAP_HOST", "localhost:9092"),
            "group.id": group,
            "enable.auto.commit": False,
        }
    )


def topic() -> str:
    return os.environ.get("KAFKA_SENSOR_TOPIC", "sensor.readings.v1")


def kafka_end_offsets() -> dict[int, int]:
    """Log-end offset of every partition of the sensor topic."""
    from confluent_kafka import TopicPartition

    consumer = _consumer("bench-offsets")
    try:
        partitions = consumer.list_topics(topic(), timeout=10).topics[topic()].partitions
        return {
            p: consumer.get_watermark_offsets(TopicPartition(topic(), p), timeout=10)[1] for p in partitions
        }
    finally:
        consumer.close()


def kafka_start_offsets() -> dict[int, int]:
    """Oldest offset still held by Kafka (older segments are deleted after the retention period)."""
    from confluent_kafka import TopicPartition

    consumer = _consumer("bench-offsets")
    try:
        partitions = consumer.list_topics(topic(), timeout=10).topics[topic()].partitions
        return {
            p: consumer.get_watermark_offsets(TopicPartition(topic(), p), timeout=10)[0] for p in partitions
        }
    finally:
        consumer.close()


def kafka_offsets_at(when: datetime) -> dict[int, int]:
    """First offset of every partition whose Kafka timestamp is at or after ``when``."""
    from confluent_kafka import TopicPartition

    consumer = _consumer("bench-offsets")
    try:
        end = kafka_end_offsets()
        stamp = int(when.timestamp() * 1000)
        found = consumer.offsets_for_times([TopicPartition(topic(), p, stamp) for p in end], timeout=10)
        return {tp.partition: (tp.offset if tp.offset >= 0 else end[tp.partition]) for tp in found}
    finally:
        consumer.close()


def offset_filter(start: dict[int, int], end: dict[int, int]) -> str:
    """SQL predicate on the lineage columns for the offsets in [start, end)."""
    return " OR ".join(
        f"(source_partition = {q} AND source_offset >= {start[q]} AND source_offset < {end[q]})" for q in end
    )


def kafka_messages(start: dict[int, int], end: dict[int, int]) -> list[tuple[int, int, bytes]]:
    """Every message between two offset snapshots, as (partition, offset, value)."""
    from confluent_kafka import TopicPartition

    consumer = _consumer("bench-replay")
    wanted = sum(end[p] - start[p] for p in end)
    consumer.assign([TopicPartition(topic(), p, start[p]) for p in end if end[p] > start[p]])
    seen: dict[tuple[int, int], bytes] = {}
    try:
        while len(seen) < wanted:
            message = consumer.poll(10)
            if message is None:
                raise TimeoutError(f"read {len(seen)} of {wanted} messages")
            if message.error() or message.offset() >= end[message.partition()]:
                continue
            seen[(message.partition(), message.offset())] = message.value()
    finally:
        consumer.close()
    return [(p, o, v) for (p, o), v in sorted(seen.items())]


def cassandra_session():
    from cassandra.cluster import Cluster
    from cassandra.policies import WhiteListRoundRobinPolicy

    host = os.environ.get("CASSANDRA_HOST", "127.0.0.1")
    cluster = Cluster(
        [host],
        port=int(os.environ.get("CASSANDRA_PORT", "9042")),
        load_balancing_policy=WhiteListRoundRobinPolicy([host]),
    )
    return cluster.connect(os.environ.get("CASSANDRA_KEYSPACE", "agri"))


def reference() -> dict:
    return json.loads((ROOT / "reference" / "reference_data.json").read_text())


def field_metrics() -> list[tuple[str, str]]:
    """(field_id, metric) pairs some device reports: the partitions of readings_by_field_24h."""
    return sorted({(d["field_id"], m) for d in reference()["devices"] for m in d["metrics"]})
