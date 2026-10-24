"""Loader for the platform's master data (BR1, FR1.1, FR1.2, FR5.2).

The reference data lives in a single JSON file (``reference/reference_data.json``)
and is the authority for:

* which farms, fields and devices exist and how they relate (FR1.1). The
  streaming job resolves ``farm_id``/``field_id`` from ``device_id`` here
  instead of trusting the event payload (FR1.2), and quarantines readings from
  devices that are not listed (BR1 acceptance criterion).
* the physically plausible range and the maximum plausible step change of
  every metric (FR4.2).
* the per-crop target ranges and alert thresholds (FR5.2, FR8.1).
* each device's nominal reporting interval, used to detect outages (FR8.2).

Everything is loaded once at startup and treated as immutable; changing the
file and restarting a service is how master data is updated.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_REFERENCE_PATH = "/app/reference/reference_data.json"


@dataclass(frozen=True)
class Farm:
    farm_id: str
    name: str
    location: str


@dataclass(frozen=True)
class Field:
    field_id: str
    farm_id: str
    name: str
    crop_code: str
    area_ha: float


@dataclass(frozen=True)
class Device:
    device_id: str
    field_id: str
    metrics: tuple[str, ...]
    reporting_interval_s: float
    battery_pct: float
    signal_quality: float


@dataclass(frozen=True)
class MetricSpec:
    metric: str
    unit: str
    min: float
    max: float
    max_jump: float
    description: str = ""

    def in_range(self, value: float) -> bool:
        return self.min <= value <= self.max


@dataclass(frozen=True)
class CropTarget:
    """Target range and alert thresholds for one metric of one crop (FR5.2)."""

    metric: str
    min: float | None = None
    max: float | None = None
    alert_below: float | None = None
    alert_above: float | None = None


@dataclass(frozen=True)
class Crop:
    crop_code: str
    name: str
    targets: dict[str, CropTarget]

    def target(self, metric: str) -> CropTarget | None:
        return self.targets.get(metric)


@dataclass(frozen=True)
class ReferenceData:
    farms: dict[str, Farm]
    fields: dict[str, Field]
    devices: dict[str, Device]
    metrics: dict[str, MetricSpec]
    crops: dict[str, Crop]
    path: str

    # -- lookups used by the streaming job and the API ---------------------

    def device(self, device_id: str) -> Device | None:
        return self.devices.get(device_id)

    def field(self, field_id: str) -> Field | None:
        return self.fields.get(field_id)

    def metric_spec(self, metric: str) -> MetricSpec | None:
        return self.metrics.get(metric)

    def crop(self, crop_code: str) -> Crop | None:
        return self.crops.get(crop_code)

    def devices_of_field(self, field_id: str) -> list[Device]:
        return [device for device in self.devices.values() if device.field_id == field_id]

    def fields_of_farm(self, farm_id: str) -> list[Field]:
        return [field for field in self.fields.values() if field.farm_id == farm_id]

    def offline_after_s(self, device: Device, multiplier: float) -> float:
        """Silence length (in seconds) after which the device counts as offline (FR8.2)."""
        return max(device.reporting_interval_s * multiplier, 1.0)


def load_reference(path: str | None = None) -> ReferenceData:
    """Load and validate the reference data.

    ``path`` defaults to the ``REFERENCE_DATA_PATH`` environment variable, which
    every service sets to the mounted ``reference/`` directory. No credentials
    and no hard-coded hosts: configuration comes from the environment (AGENTS.md).
    """
    resolved = path or os.environ.get("REFERENCE_DATA_PATH") or DEFAULT_REFERENCE_PATH
    raw: dict[str, Any] = json.loads(Path(resolved).read_text(encoding="utf-8"))

    farms = {
        row["farm_id"]: Farm(row["farm_id"], row.get("name", row["farm_id"]), row.get("location", ""))
        for row in raw["farms"]
    }
    fields = {
        row["field_id"]: Field(
            field_id=row["field_id"],
            farm_id=row["farm_id"],
            name=row.get("name", row["field_id"]),
            crop_code=row["crop_code"],
            area_ha=float(row.get("area_ha", 0.0)),
        )
        for row in raw["fields"]
    }
    devices = {
        row["device_id"]: Device(
            device_id=row["device_id"],
            field_id=row["field_id"],
            metrics=tuple(row["metrics"]),
            reporting_interval_s=float(row.get("reporting_interval_s", 30.0)),
            battery_pct=float(row.get("battery_pct", 100.0)),
            signal_quality=float(row.get("signal_quality", 1.0)),
        )
        for row in raw["devices"]
    }
    metrics = {
        row["metric"]: MetricSpec(
            metric=row["metric"],
            unit=row["unit"],
            min=float(row["min"]),
            max=float(row["max"]),
            max_jump=float(row["max_jump"]),
            description=row.get("description", ""),
        )
        for row in raw["metrics"]
    }
    crops: dict[str, Crop] = {}
    for row in raw["crops"]:
        targets = {
            metric: CropTarget(
                metric=metric,
                min=target.get("min"),
                max=target.get("max"),
                alert_below=target.get("alert_below"),
                alert_above=target.get("alert_above"),
            )
            for metric, target in row.get("targets", {}).items()
        }
        crops[row["crop_code"]] = Crop(row["crop_code"], row.get("name", row["crop_code"]), targets)

    reference = ReferenceData(
        farms=farms,
        fields=fields,
        devices=devices,
        metrics=metrics,
        crops=crops,
        path=resolved,
    )
    _validate(reference)
    return reference


def _validate(reference: ReferenceData) -> None:
    """Fail fast on inconsistent master data rather than mis-assigning readings."""
    errors: list[str] = []
    for field in reference.fields.values():
        if field.farm_id not in reference.farms:
            errors.append(f"field {field.field_id} references unknown farm {field.farm_id}")
        if field.crop_code not in reference.crops:
            errors.append(f"field {field.field_id} references unknown crop {field.crop_code}")
    for device in reference.devices.values():
        if device.field_id not in reference.fields:
            errors.append(f"device {device.device_id} references unknown field {device.field_id}")
        for metric in device.metrics:
            if metric not in reference.metrics:
                errors.append(f"device {device.device_id} reports unknown metric {metric}")
    for crop in reference.crops.values():
        for metric in crop.targets:
            if metric not in reference.metrics:
                errors.append(f"crop {crop.crop_code} has targets for unknown metric {metric}")
    if errors:
        raise ValueError("invalid reference data in " + reference.path + ":\n  " + "\n  ".join(errors))
