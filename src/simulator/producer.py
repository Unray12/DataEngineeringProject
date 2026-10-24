"""Publishing helpers for the simulator.

The simulator sends readings to the ingest service over HTTP
(``http://ingest:8081/v1/readings``), matching the LoRaWAN gateway push model
documented in AGENTS.md. A direct-to-Kafka transport is kept for debugging the
broker in isolation; it is not part of the normal architecture.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
from confluent_kafka import Producer

from .config import ProducerConfig

HEALTH_PATH = "/health"
READINGS_PATH = "/v1/readings"


def _encode(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


# --------------------------------------------------------------------------------------
# Kafka transport (debug only)
# --------------------------------------------------------------------------------------


def build_producer(config: ProducerConfig) -> Producer:
    """Create an idempotent Kafka producer for the debug transport."""
    return Producer(
        {
            "bootstrap.servers": config.bootstrap_servers,
            "client.id": "agri-simulator",
            "acks": "all",
            "enable.idempotence": True,
            "linger.ms": 5,
            "compression.type": "snappy",
        }
    )


def publish(producer: Producer, topic: str, payload: dict[str, Any]) -> None:
    """Publish one payload; delivery errors are surfaced by the caller's flush."""
    producer.produce(topic, key=payload.get("device_id", ""), value=_encode(payload))


def wait_for_broker(config: ProducerConfig, timeout_s: float, interval_s: float = 3.0) -> bool:
    """Block until the Kafka broker metadata is reachable."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            producer = build_producer(config)
            producer.list_topics(timeout=5)
            return True
        except Exception:  # noqa: BLE001 - any broker error means "not ready yet"
            time.sleep(interval_s)
    return False


# --------------------------------------------------------------------------------------
# HTTP transport (through the ingest service, the normal path)
# --------------------------------------------------------------------------------------


def build_http_client(timeout_s: float) -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(timeout_s))


def wait_for_ingest(client: httpx.Client, base_url: str, timeout_s: float, interval_s: float = 2.0) -> bool:
    """Block until the ingest service answers ``GET /health``."""
    deadline = time.monotonic() + timeout_s
    url = base_url.rstrip("/") + HEALTH_PATH
    while time.monotonic() < deadline:
        try:
            if client.get(url).status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(interval_s)
    return False


def publish_http(
    client: httpx.Client,
    base_url: str,
    payloads: list[dict[str, Any]],
    retries: int = 3,
) -> tuple[int, int]:
    """Publish readings to the ingest service; return ``(accepted, failed)``.

    Documents are sent one by one so a single malformed record cannot poison the
    batch. A 4xx means the ingest service refused the envelope - count it and
    move on (FR3.2: the pipeline must keep running).
    """
    url = base_url.rstrip("/") + READINGS_PATH
    accepted = 0
    failed = 0
    for payload in payloads:
        resolved = False
        for attempt in range(retries):
            try:
                response = client.post(url, json=payload)
            except httpx.HTTPError:
                time.sleep(0.5 * (attempt + 1))
                continue
            if response.status_code in (200, 202):
                accepted += 1
                resolved = True
                break
            if 400 <= response.status_code < 500:
                failed += 1
                resolved = True
                break
            time.sleep(0.2 * (attempt + 1))
        if not resolved:
            failed += 1
    return accepted, failed
