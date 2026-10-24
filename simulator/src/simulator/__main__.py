"""Entry point: ``python -m simulator``.

Builds one simulated sensor per device in the reference data and pushes readings
through the HTTP ingest service (the normal path) or straight to Kafka
(``SIM_TRANSPORT=kafka``, for debugging the broker in isolation).
"""

from __future__ import annotations

import logging
import random
import signal
import sys
import time
from collections import Counter
from collections.abc import Callable
from typing import Any

from common.reference import load_reference

from .config import SimulatorConfig
from .generator import ReadingGenerator, read_fixture, stamp_fixture
from .producer import (
    build_http_client,
    build_producer,
    publish,
    publish_http,
    wait_for_broker,
    wait_for_ingest,
)

log = logging.getLogger("simulator")
_running = True

Emit = Callable[[list[dict[str, Any]]], tuple[int, int]]


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(name)s - %(message)s",
        stream=sys.stdout,
    )


def _handle_signal(signum, frame) -> None:  # noqa: ARG001
    global _running
    _running = False
    log.info("shutdown signal received, finishing current tick")


def build_generator(cfg: SimulatorConfig) -> ReadingGenerator:
    """Create a reading generator whose devices mirror the reference data."""
    reference = load_reference(cfg.reference_path)
    generator = ReadingGenerator(
        config=cfg.generator_config(),
        faults=cfg.fault_config(),
        reference=reference,
    )
    for device in reference.devices.values():
        field = reference.field(device.field_id)
        generator.register_device(
            device_id=device.device_id,
            farm_id=field.farm_id if field else "",
            field_id=device.field_id,
            interval_s=device.reporting_interval_s,
            battery_pct=device.battery_pct,
            signal_quality=device.signal_quality,
            metrics=list(device.metrics),
        )
    return generator


def _run_http(cfg: SimulatorConfig, generator: ReadingGenerator) -> int:
    producer_cfg = cfg.producer_config()
    client = build_http_client(producer_cfg.http_timeout_s)
    if not wait_for_ingest(client, cfg.ingest_url, producer_cfg.ready_timeout_s):
        log.error("ingest service at %s did not become available", cfg.ingest_url)
        return 1
    log.info("pushing to %s at %.1f ticks/s", cfg.ingest_url, cfg.rate_hz)
    try:
        _loop(generator, cfg, lambda payloads: publish_http(client, cfg.ingest_url, payloads))
    finally:
        client.close()
    return 0


def _run_kafka(cfg: SimulatorConfig, generator: ReadingGenerator) -> int:
    producer_cfg = cfg.producer_config()
    if not wait_for_broker(producer_cfg, producer_cfg.ready_timeout_s):
        log.error("broker at %s did not become available", producer_cfg.bootstrap_servers)
        return 1
    producer = build_producer(producer_cfg)
    log.info("producing to kafka %s topic %s", producer_cfg.bootstrap_servers, producer_cfg.topic)
    try:
        _loop(generator, cfg, lambda payloads: _publish_kafka(producer, producer_cfg.topic, payloads))
    finally:
        producer.flush(30)
    return 0


def _publish_kafka(producer, topic: str, payloads: list[dict[str, Any]]) -> tuple[int, int]:
    for payload in payloads:
        publish(producer, topic, payload)
    return len(payloads), 0


def _run_fixture(cfg: SimulatorConfig, producer) -> int:
    log.info("replaying fixture %s", cfg.fixture)
    records = stamp_fixture(read_fixture(cfg.fixture), time.time())
    for record in records:
        publish(producer, cfg.topic, record)
    log.info("published %d fixture records", len(records))
    return 0


def _loop(generator: ReadingGenerator, cfg: SimulatorConfig, emit: Emit) -> None:
    tick = cfg.generator_config().tick_s
    started = time.monotonic()
    ticks = 0
    total = 0
    failures = 0
    faults: Counter[str] = Counter()
    last_report = started

    while _running:
        loop_started = time.monotonic()
        if cfg.duration_seconds and loop_started - started >= cfg.duration_seconds:
            break
        # reading_ts must be absolute wall-clock (UTC epoch), so the generator is
        # fed time.time(); loop_started (monotonic) stays the clock for timing.
        payloads = generator.next_payloads(time.time())
        if payloads:
            accepted, failed = emit(payloads)
            total += accepted
            failures += failed
            for payload in payloads:
                faults[payload.get("simulated_fault") or "none"] += 1
        ticks += 1

        now = time.monotonic()
        if now - last_report >= 15.0:
            last_report = now
            log.info("sent=%d failed=%d over %.0fs faults=%s", total, failures, now - started, dict(faults))
        sleep_for = tick - (time.monotonic() - loop_started)
        if sleep_for > 0:
            time.sleep(sleep_for)

    log.info(
        "stopped: sent=%d failed=%d in %d ticks over %.1fs faults=%s",
        total,
        failures,
        ticks,
        time.monotonic() - started,
        dict(faults),
    )


def main() -> int:
    _configure_logging()
    cfg = SimulatorConfig()
    try:
        cfg.validate()
    except ValueError as exc:
        log.error("invalid configuration: %s", exc)
        return 2

    random.seed(cfg.seed)
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    if cfg.transport == "kafka" and cfg.fixture:
        return _run_fixture(cfg, build_producer(cfg.producer_config()))

    generator = build_generator(cfg)
    log.info("simulating %d device(s) from %s", len(generator.devices), cfg.reference_path)
    if cfg.transport == "http":
        return _run_http(cfg, generator)
    return _run_kafka(cfg, generator)


if __name__ == "__main__":
    raise SystemExit(main())
