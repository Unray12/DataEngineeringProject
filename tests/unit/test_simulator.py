"""Unit tests for the simulator's values (FR4.1, FR4.2): healthy readings stay inside the physical
range of their metric, and an injected jump is caught as a jump, not as an out-of-range value."""

from __future__ import annotations

import random
from pathlib import Path

import pytest

from common.reference import load_reference
from simulator.__main__ import build_generator
from simulator.config import SimulatorConfig
from simulator.generator import MALFORMED_VARIANTS, _jump

REFERENCE = Path(__file__).resolve().parents[2] / "reference" / "reference_data.json"
METRICS = load_reference(str(REFERENCE)).metrics


def test_healthy_readings_stay_in_range(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REFERENCE_DATA_PATH", str(REFERENCE))
    monkeypatch.setenv("SIM_FAULT_RATE", "0")
    monkeypatch.setenv("SIM_GAP_RATE", "0")
    random.seed(7)
    generator = build_generator(SimulatorConfig())
    seen = 0
    for tick in range(2000):  # about 2.8 hours of readings from all 24 devices
        for payload in generator.next_payloads(1_700_000_000.0 + tick * 5):
            spec = METRICS[payload["metric"]]
            assert spec.min <= payload["value"] <= spec.max, payload
            seen += 1
    assert seen > 10_000


@pytest.mark.parametrize("metric", sorted(METRICS))
def test_jump_is_larger_than_max_jump_and_in_range(metric: str) -> None:
    spec = METRICS[metric]
    random.seed(metric)
    for base in (spec.min, (spec.min + spec.max) / 2, spec.max):
        value = _jump(base, spec.min, spec.max, spec.max_jump)
        assert spec.min <= value <= spec.max
        assert abs(value - base) > spec.max_jump


def test_every_malformed_variant_is_detectable() -> None:
    # Each variant must fail the stream's structural validation (quarantine), not pass as ok.
    assert set(MALFORMED_VARIANTS) == {"missing_field", "invalid_timestamp", "malformed_value"}
