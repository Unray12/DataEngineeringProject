"""Environment-driven configuration.

Every value comes from the environment (``.env`` -> Compose -> container), never
hard-coded, per the AGENTS.md conventions. Defaults mirror ``.env.example`` so
the simulator can also be run from a plain virtualenv.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_FAULTS = (
    "null_value",
    "out_of_range",
    "implausible_jump",
    "duplicate",
    "unknown_device",
    "unexpected_metric",
    "malformed",
)


def _env(key: str, default: str) -> str:
    value = os.environ.get(key)
    return default if value in (None, "") else value


def _env_int(key: str, default: int) -> int:
    value = os.environ.get(key)
    return default if value in (None, "") else int(value)


def _env_float(key: str, default: float) -> float:
    value = os.environ.get(key)
    return default if value in (None, "") else float(value)


def _env_list(key: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.environ.get(key)
    if value in (None, ""):
        return default
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class GeneratorConfig:
    """Pacing knobs for the value generator."""

    tick_s: float = 1.0
    duration_seconds: int = 0  # 0 == run until stopped
    seed: int = 42
    battery_drain_pct_per_hour: float = 1.5
    signal_jitter: float = 0.01


@dataclass(frozen=True)
class FaultConfig:
    """Fault injection knobs (FR4.1, FR8.2)."""

    enabled: tuple[str, ...] = DEFAULT_FAULTS
    rate: float = 0.05
    gap_rate: float = 0.002
    gap_seconds_min: float = 45.0
    gap_seconds_max: float = 90.0


@dataclass(frozen=True)
class ProducerConfig:
    """Where generated readings are sent."""

    transport: str = "http"
    ingest_url: str = "http://localhost:8081"
    bootstrap_servers: str = "localhost:9092"
    topic: str = "sensor.readings.v1"
    http_timeout_s: float = 5.0
    ready_timeout_s: float = 120.0


@dataclass(frozen=True)
class SimulatorConfig:
    """Top-level simulator configuration."""

    transport: str = field(default_factory=lambda: _env("SIM_TRANSPORT", "http"))
    ingest_url: str = field(default_factory=lambda: _env("INGEST_URL", "http://localhost:8081"))
    bootstrap_servers: str = field(default_factory=lambda: _env("KAFKA_BOOTSTRAP_HOST", "localhost:9092"))
    topic: str = field(default_factory=lambda: _env("KAFKA_SENSOR_TOPIC", "sensor.readings.v1"))
    reference_path: str = field(
        default_factory=lambda: _env("REFERENCE_DATA_PATH", "reference/reference_data.json")
    )
    rate_hz: float = field(default_factory=lambda: _env_float("SIM_RATE_HZ", 1.0))
    duration_seconds: int = field(default_factory=lambda: _env_int("SIM_DURATION_SECONDS", 0))
    seed: int = field(default_factory=lambda: _env_int("SIM_SEED", 42))
    battery_drain_pct_per_hour: float = field(
        default_factory=lambda: _env_float("SIM_BATTERY_DRAIN_PCT_PER_HOUR", 1.5)
    )
    signal_jitter: float = field(default_factory=lambda: _env_float("SIM_SIGNAL_JITTER", 0.01))
    fault_rate: float = field(default_factory=lambda: _env_float("SIM_FAULT_RATE", 0.05))
    fault_kinds: tuple[str, ...] = field(default_factory=lambda: _env_list("SIM_FAULTS", DEFAULT_FAULTS))
    gap_rate: float = field(default_factory=lambda: _env_float("SIM_GAP_RATE", 0.002))
    gap_seconds_min: float = field(default_factory=lambda: _env_float("SIM_GAP_SECONDS_MIN", 45.0))
    gap_seconds_max: float = field(default_factory=lambda: _env_float("SIM_GAP_SECONDS_MAX", 90.0))
    fixture: str = field(default_factory=lambda: _env("SIM_FIXTURE", ""))

    def validate(self) -> None:
        if self.rate_hz <= 0:
            raise ValueError("SIM_RATE_HZ must be > 0")
        if self.transport not in {"http", "kafka"}:
            raise ValueError("SIM_TRANSPORT must be 'http' or 'kafka'")
        if not 0.0 <= self.fault_rate <= 1.0:
            raise ValueError("SIM_FAULT_RATE must be within [0, 1]")
        if not 0.0 <= self.gap_rate <= 1.0:
            raise ValueError("SIM_GAP_RATE must be within [0, 1]")
        if self.gap_seconds_min <= 0 or self.gap_seconds_max < self.gap_seconds_min:
            raise ValueError("SIM_GAP_SECONDS_MIN/MAX must form a positive range")
        unknown = set(self.fault_kinds) - set(DEFAULT_FAULTS)
        if unknown:
            raise ValueError(f"SIM_FAULTS contains unknown kinds: {sorted(unknown)}")

    def generator_config(self) -> GeneratorConfig:
        return GeneratorConfig(
            tick_s=1.0 / self.rate_hz,
            duration_seconds=self.duration_seconds,
            seed=self.seed,
            battery_drain_pct_per_hour=self.battery_drain_pct_per_hour,
            signal_jitter=self.signal_jitter,
        )

    def fault_config(self) -> FaultConfig:
        return FaultConfig(
            enabled=self.fault_kinds,
            rate=self.fault_rate,
            gap_rate=self.gap_rate,
            gap_seconds_min=self.gap_seconds_min,
            gap_seconds_max=self.gap_seconds_max,
        )

    def producer_config(self) -> ProducerConfig:
        return ProducerConfig(
            transport=self.transport,
            ingest_url=self.ingest_url,
            bootstrap_servers=self.bootstrap_servers,
            topic=self.topic,
        )
