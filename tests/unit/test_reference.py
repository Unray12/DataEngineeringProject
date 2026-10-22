"""Unit tests for the shared reference-data loader (FR1.1, FR1.2, FR5.2)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from common.reference import load_reference

REPO_ROOT = Path(__file__).resolve().parents[2]
REFERENCE_PATH = REPO_ROOT / "reference" / "reference_data.json"


@pytest.fixture(scope="module")
def reference():
    return load_reference(str(REFERENCE_PATH))


def test_hierarchy_is_consistent(reference) -> None:
    # Every field belongs to a known farm and every device to a known field
    # (the loader validates this, so a broken file raises instead of mis-resolving).
    assert reference.farms
    for field in reference.fields.values():
        assert field.farm_id in reference.farms
        assert field.crop_code in reference.crops
    for device in reference.devices.values():
        assert device.field_id in reference.fields
        assert device.metrics
        for metric in device.metrics:
            assert metric in reference.metrics


def test_device_field_farm_resolution(reference) -> None:
    device = reference.devices["F001-S01"]
    field = reference.field(device.field_id)
    assert field is not None
    assert field.farm_id == "FM001"


def test_devices_of_field(reference) -> None:
    devices = reference.devices_of_field("F001")
    assert {device.device_id for device in devices} == {"F001-S01", "F001-S02", "F001-S03"}


def test_metric_specs_have_ranges(reference) -> None:
    moisture = reference.metric_spec("soil_moisture")
    assert moisture is not None
    assert moisture.min == 0.0 and moisture.max == 100.0
    assert moisture.max_jump > 0
    assert moisture.in_range(50.0)
    assert not moisture.in_range(150.0)


def test_offline_threshold_is_a_multiple_of_the_reporting_interval(reference) -> None:
    device = reference.devices["F001-S01"]
    # reporting_interval_s=5, multiplier=4 -> 20s of silence means offline.
    assert reference.offline_after_s(device, 4.0) == 20.0


def test_crop_targets(reference) -> None:
    rice = reference.crop("RICE")
    assert rice is not None
    target = rice.target("soil_moisture")
    assert target is not None and target.alert_below == 32.0
    # A metric the crop has no target for returns None (no alert rule).
    assert rice.target("rainfall") is None


def test_loader_rejects_unknown_device_field(tmp_path: Path) -> None:
    broken = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    broken["devices"][0]["field_id"] = "NOPE"
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(broken), encoding="utf-8")
    with pytest.raises(ValueError, match="unknown field"):
        load_reference(str(path))
