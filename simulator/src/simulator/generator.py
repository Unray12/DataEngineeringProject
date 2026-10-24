"""Device state and payload generation.

Devices, fields, farms and metric targets come from the shared reference data
(``reference/reference_data.json``), so the simulator, the streaming job and the
API agree on ids and thresholds. Each device reports every metric declared for
it in the reference data, at its own reporting interval.

Values are a bounded random walk around a per-metric baseline, so the stream
looks like real telemetry (slow drift, small noise) rather than white noise.
"""

from __future__ import annotations

import hashlib
import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common.reference import ReferenceData

from .config import FaultConfig, GeneratorConfig

MALFORMED_VARIANTS = ("malformed_json", "missing_field", "invalid_timestamp", "malformed_value")

# Typical starting point and noise amplitude per metric. Kept here (not in the
# reference data) because it describes how the *simulator* behaves, not the
# physical limits of the sensor.
METRIC_BASELINE: dict[str, float] = {
    "soil_moisture": 48.0,
    "soil_temperature": 24.0,
    "air_temperature": 29.0,
    "relative_humidity": 72.0,
    "rainfall": 0.2,
}
METRIC_NOISE: dict[str, float] = {
    "soil_moisture": 0.8,
    "soil_temperature": 0.25,
    "air_temperature": 0.4,
    "relative_humidity": 1.2,
    "rainfall": 0.1,
}


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")


@dataclass
class DeviceState:
    """Mutable state for one simulated LoRaWAN sensor."""

    device_id: str
    farm_id: str
    field_id: str
    interval_s: float
    battery_pct: float
    signal_quality: float
    metrics: list[str]
    last_sent: float = 0.0
    asleep_until: float = 0.0
    fault_scheduled_at: float | None = None
    pending_duplicate: dict[str, Any] | None = None


@dataclass
class ReadingGenerator:
    """Generate realistic payloads for every registered device."""

    config: GeneratorConfig
    faults: FaultConfig
    reference: ReferenceData
    devices: list[DeviceState] = field(default_factory=list)
    _baselines: dict[tuple[str, str], float] = field(default_factory=dict)

    # ----------------------------------------------------------------------------------
    # Device registration
    # ----------------------------------------------------------------------------------

    def register_device(
        self,
        device_id: str,
        farm_id: str,
        field_id: str,
        interval_s: float,
        battery_pct: float,
        signal_quality: float,
        metrics: list[str],
    ) -> DeviceState:
        device = DeviceState(
            device_id=device_id,
            farm_id=farm_id,
            field_id=field_id,
            interval_s=interval_s,
            battery_pct=battery_pct,
            signal_quality=signal_quality,
            metrics=list(metrics),
        )
        self.devices.append(device)
        return device

    # ----------------------------------------------------------------------------------
    # Fault injection (FR4.1/BR4, FR8.2)
    # ----------------------------------------------------------------------------------

    def schedule_fault(self, device_id: str, at: float) -> None:
        """Make the next reading of a device carry a fault."""
        for device in self.devices:
            if device.device_id == device_id:
                device.fault_scheduled_at = at
                return

    def inject_gap(self, device_id: str, now: float, duration_s: float | None = None) -> None:
        """Make a device go silent (battery pull / gateway outage)."""
        duration = duration_s if duration_s is not None else self.faults.gap_seconds_max
        for device in self.devices:
            if device.device_id == device_id:
                device.asleep_until = now + duration
                return

    def _maybe_schedule_fault(self, now: float) -> None:
        if self.faults.rate <= 0 or not self.devices:
            return
        if random.random() >= self.faults.rate:
            return
        device = random.choice(self.devices)
        device.fault_scheduled_at = now + random.uniform(0.0, device.interval_s)

    def _maybe_sleep_device(self, now: float) -> None:
        if self.faults.gap_rate <= 0 or not self.devices:
            return
        if random.random() >= self.faults.gap_rate:
            return
        device = random.choice(self.devices)
        duration = random.uniform(self.faults.gap_seconds_min, self.faults.gap_seconds_max)
        device.asleep_until = now + duration

    # ----------------------------------------------------------------------------------
    # Payload generation
    # ----------------------------------------------------------------------------------

    def next_payloads(self, now: float) -> list[dict[str, Any]]:
        """Return every payload due at ``now`` (one per due device metric)."""
        self._maybe_schedule_fault(now)
        self._maybe_sleep_device(now)

        payloads: list[dict[str, Any]] = []
        for device in self.devices:
            if now < device.asleep_until:
                continue
            if device.last_sent and now - device.last_sent < device.interval_s:
                continue
            device.last_sent = now
            fault = self._consume_fault(device, now)
            for metric in device.metrics:
                payloads.append(self._payload(device, metric, now, fault))
        self._decay_batteries()
        return payloads

    def _consume_fault(self, device: DeviceState, now: float) -> str | None:
        if device.fault_scheduled_at is not None and now >= device.fault_scheduled_at:
            device.fault_scheduled_at = None
            return random.choice(self.faults.enabled)
        return None

    def _decay_batteries(self) -> None:
        for device in self.devices:
            drain = self.config.battery_drain_pct_per_hour * (device.interval_s / 3600.0)
            device.battery_pct = max(0.0, device.battery_pct - drain)
            jitter = random.gauss(0, self.config.signal_jitter)
            device.signal_quality = min(1.0, max(0.0, device.signal_quality + jitter))

    def _baseline(self, device: DeviceState, metric: str) -> float:
        key = (device.device_id, metric)
        if key not in self._baselines:
            seed = int(hashlib.sha256(f"{device.device_id}:{metric}".encode()).hexdigest(), 16) % 1000
            offset = (seed / 1000.0 - 0.5) * 2 * METRIC_NOISE.get(metric, 1.0) * 5
            self._baselines[key] = METRIC_BASELINE.get(metric, 1.0) + offset
        return self._baselines[key]

    def _walk(self, device: DeviceState, metric: str) -> float:
        key = (device.device_id, metric)
        spec = self.reference.metrics[metric]
        step = random.gauss(0, METRIC_NOISE.get(metric, 1.0) * 0.5)
        value = min(spec.max, max(spec.min, self._baselines.get(key, self._baseline(device, metric)) + step))
        self._baselines[key] = value
        return value

    def _payload(
        self,
        device: DeviceState,
        metric: str,
        now: float,
        fault: str | None,
    ) -> dict[str, Any]:
        spec = self.reference.metrics[metric]
        base = self._walk(device, metric)
        value: Any = round(base + random.gauss(0, METRIC_NOISE.get(metric, 0.5)), 3)

        if fault == "null_value":
            value = None
        elif fault == "out_of_range":
            value = round(spec.max + random.uniform(5, 50), 3)
        elif fault == "implausible_jump":
            value = round(base + spec.max_jump * random.uniform(3, 10), 3)

        payload: dict[str, Any] = {
            "event_id": str(uuid.uuid4()),
            "device_id": device.device_id,
            "metric": metric,
            "value": value,
            "reading_ts": _utc_iso(now),
            "battery_pct": round(device.battery_pct, 1),
            "signal_quality": round(device.signal_quality, 3),
            "farm_id": device.farm_id,
            "field_id": device.field_id,
            "simulated_fault": fault,
        }

        if fault == "duplicate":
            if device.pending_duplicate is not None:
                payload = device.pending_duplicate
                device.pending_duplicate = None
            else:
                device.pending_duplicate = payload
        elif fault == "unknown_device":
            payload["device_id"] = f"{device.device_id}-UNKNOWN"
        elif fault == "unexpected_metric":
            payload["metric"] = f"{metric}_typo"
        elif fault == "malformed":
            payload = self._malform(payload, random.choice(MALFORMED_VARIANTS))
        return payload

    @staticmethod
    def _malform(payload: dict[str, Any], variant: str) -> dict[str, Any]:
        if variant == "malformed_json":
            payload["_malformed_json"] = "not-json{{{"
        elif variant == "missing_field":
            payload.pop("reading_ts", None)
        elif variant == "invalid_timestamp":
            payload["reading_ts"] = "not-a-timestamp"
        else:  # malformed_value
            payload["value"] = "not-a-number"
        return payload


# --------------------------------------------------------------------------------------
# Fixture replay (kept for offline tests and benchmarks)
# --------------------------------------------------------------------------------------


def read_fixture(path: str) -> list[dict[str, Any]]:
    """Read fixture JSON Lines into a list of documents."""
    records: list[dict[str, Any]] = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def stamp_fixture(records: list[dict[str, Any]], start_ts: float) -> list[dict[str, Any]]:
    """Rewrite fixture timestamps to a monotonic sequence from ``start_ts``."""
    stamped: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        record = dict(record)
        record["reading_ts"] = _utc_iso(start_ts + index)
        stamped.append(record)
    return stamped
