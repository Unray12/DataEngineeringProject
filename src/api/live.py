"""Helpers for the near real-time endpoints (gaps in a series, outage counts), kept free of I/O for tests."""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any, Literal

from common.reference import CropTarget

TargetState = Literal["low", "ok", "high"]


def target_state(value: float, target: CropTarget | None) -> TargetState:
    """Where a reading sits against the crop's healthy range; ``ok`` when no range is set."""
    if target is None:
        return "ok"
    if target.min is not None and value < target.min:
        return "low"
    if target.max is not None and value > target.max:
        return "high"
    return "ok"


def gap_multiplier() -> float:
    """A silence longer than this many reporting intervals is a gap (the same rule as a device outage)."""
    return float(os.environ.get("DEVICE_OFFLINE_MULTIPLIER", "4.0"))


def _parse(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    return datetime.fromisoformat(str(value))


def find_gaps(
    points: list[dict[str, Any]],
    threshold_s: float,
    now: datetime,
) -> list[dict[str, str]]:
    """Periods with no data: between two readings further apart than ``threshold_s``,
    and from the newest reading to ``now`` when it is older than the threshold.

    ``points`` must be sorted by ``measured_at``. Nothing is interpolated.
    """
    gaps: list[dict[str, str]] = []
    previous: datetime | None = None
    for point in points:
        current = _parse(point["measured_at"])
        if previous is not None and (current - previous).total_seconds() > threshold_s:
            gaps.append({"start": previous.isoformat(), "end": current.isoformat()})
        previous = current
    if previous is not None and (now - previous).total_seconds() > threshold_s:
        gaps.append({"start": previous.isoformat(), "end": now.isoformat()})
    return gaps


OUTAGE_PREFIX = "device_offline:"


def outage_counts(alerts: list[dict[str, Any]], since: datetime) -> dict[str, int]:
    """Device outages per device since ``since``, counted from outage alerts.

    One outage alert is opened per silence episode (debounced), so this is the
    number of gaps in a device's reporting. The device comes from the alert, or from the
    condition code when the alert carries none.
    """
    counts: dict[str, int] = {}
    for alert in alerts:
        code = str(alert.get("condition_code") or "")
        if not code.startswith(OUTAGE_PREFIX):
            continue
        if _parse(alert["created_at"]) < since:
            continue
        device_id = alert.get("device_id") or code[len(OUTAGE_PREFIX) :]
        counts[device_id] = counts.get(device_id, 0) + 1
    return counts
