"""Shared domain utilities used by more than one service.

Kept deliberately small: it currently holds the loader for the platform's
master data (``reference/reference_data.json``), which the simulator (what to
simulate), the streaming job (device/field resolution, validation ranges,
alert thresholds) and the API (farm -> field -> device hierarchy) all share.
One source of truth means a device added to the reference data automatically
appears everywhere without code changes (BR1 acceptance criterion).
"""

from __future__ import annotations

from common.reference import (  # noqa: F401  (re-exported for convenience)
    Crop,
    CropTarget,
    Device,
    Farm,
    Field,
    MetricSpec,
    ReferenceData,
    load_reference,
)
