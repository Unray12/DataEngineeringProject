"""HTTP ingest service: devices and gateways POST readings, the service publishes them to Kafka.

It checks nothing about the payload. Validation happens in the streaming job, which keeps bad records
in quarantine together with their Kafka offset, so nothing is dropped silently at the edge.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any

from confluent_kafka import Producer
from fastapi import Body, FastAPI, HTTPException, Response

log = logging.getLogger("ingest")

producer: Producer | None = None


def _bootstrap() -> str:
    return os.environ.get("KAFKA_BOOTSTRAP", "kafka:29092")


def _topic() -> str:
    return os.environ.get("KAFKA_SENSOR_TOPIC", "sensor.readings.v1")


def _create_producer() -> Producer:
    return Producer(
        {
            "bootstrap.servers": _bootstrap(),
            "client.id": "agri-ingest",
            "acks": "all",
            # Idempotent producer: a network retry must not duplicate an event.
            "enable.idempotence": True,
            "linger.ms": 10,
            "compression.type": "snappy",
        }
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global producer
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(name)s - %(message)s",
        stream=sys.stdout,
    )
    producer = _create_producer()
    log.info("ingest service ready: bootstrap=%s topic=%s", _bootstrap(), _topic())
    yield
    if producer is not None:
        producer.flush(10)


app = FastAPI(title="Agriculture ingest service", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "topic": _topic()}


@app.post("/v1/readings", status_code=202)
def publish(response: Response, payload: Any = Body(...)) -> dict[str, int]:
    """Accept one event or a list of events and publish them to Kafka.

    Returns 202 when at least one event was handed to the broker, 422 when the
    envelope itself was unusable. Nothing else is validated here:
    schema errors are recorded downstream with full lineage.
    """
    if producer is None:
        raise HTTPException(status_code=503, detail="producer not initialised")
    events = payload if isinstance(payload, list) else [payload]
    if not events:
        raise HTTPException(status_code=422, detail="empty payload")

    accepted = 0
    rejected = 0
    errors: list[str] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            rejected += 1
            continue
        key = str(event.get("device_id") or event.get("event_id") or index)
        try:
            _produce(key, event, errors)
            accepted += 1
        except BufferError:
            producer.flush(5)
            _produce(key, event, errors)
            accepted += 1

    remaining = producer.flush(10)
    if remaining or errors:
        # Tell the client so it can retry; at-least-once is what Kafka is for.
        raise HTTPException(
            status_code=503,
            detail=f"broker did not confirm {remaining} message(s): {errors[:3]}",
        )
    if accepted == 0:
        response.status_code = 422
    return {"accepted": accepted, "rejected": rejected}


def _produce(key: str, event: dict[str, Any], errors: list[str]) -> None:
    producer.produce(
        _topic(),
        key=key.encode("utf-8"),
        value=json.dumps(event, separators=(",", ":")).encode("utf-8"),
        on_delivery=lambda err, msg: errors.append(str(err)) if err else None,
    )
