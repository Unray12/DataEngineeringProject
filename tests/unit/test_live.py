"""Unit tests for the near real-time helpers: target state and gap detection (BR2, BR3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from api.live import find_gaps, outage_counts, target_state
from common.reference import CropTarget

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
TARGET = CropTarget(metric="soil_moisture", min=30.0, max=60.0)


def point(seconds_ago: float) -> dict[str, str]:
    return {"measured_at": (NOW - timedelta(seconds=seconds_ago)).isoformat()}


def test_target_state_low_ok_high() -> None:
    assert target_state(29.9, TARGET) == "low"
    assert target_state(30.0, TARGET) == "ok"
    assert target_state(60.0, TARGET) == "ok"
    assert target_state(60.1, TARGET) == "high"


def test_target_state_without_a_range_is_ok() -> None:
    assert target_state(999.0, None) == "ok"
    assert target_state(5.0, CropTarget(metric="rainfall")) == "ok"


def test_target_state_with_one_sided_range() -> None:
    assert target_state(5.0, CropTarget(metric="m", min=10.0)) == "low"
    assert target_state(500.0, CropTarget(metric="m", min=10.0)) == "ok"
    assert target_state(500.0, CropTarget(metric="m", max=100.0)) == "high"


def test_no_gaps_when_readings_keep_arriving() -> None:
    points = [point(s) for s in (30, 25, 20, 15, 10, 5, 1)]
    assert find_gaps(points, threshold_s=20.0, now=NOW) == []


def test_gap_between_two_readings() -> None:
    points = [point(100), point(95), point(40), point(35)]
    gaps = find_gaps(points, threshold_s=20.0, now=NOW - timedelta(seconds=30))
    assert gaps == [{"start": point(95)["measured_at"], "end": point(40)["measured_at"]}]


def test_open_gap_from_the_newest_reading_to_now() -> None:
    points = [point(120), point(115)]
    gaps = find_gaps(points, threshold_s=20.0, now=NOW)
    assert gaps == [{"start": point(115)["measured_at"], "end": NOW.isoformat()}]


def test_gap_end_is_after_start_and_nothing_for_an_empty_series() -> None:
    assert find_gaps([], threshold_s=20.0, now=NOW) == []
    for gap in find_gaps([point(300), point(100)], threshold_s=20.0, now=NOW):
        assert datetime.fromisoformat(gap["start"]) < datetime.fromisoformat(gap["end"])


def test_accepts_datetime_values_from_cassandra() -> None:
    points = [{"measured_at": NOW - timedelta(seconds=100)}, {"measured_at": NOW - timedelta(seconds=10)}]
    assert len(find_gaps(points, threshold_s=20.0, now=NOW)) == 1


def alert(code: str, seconds_ago: float, device_id: str | None = None) -> dict[str, object]:
    return {
        "condition_code": code,
        "device_id": device_id,
        "created_at": (NOW - timedelta(seconds=seconds_ago)).isoformat(),
    }


def test_outage_counts_per_device_in_the_window() -> None:
    since = NOW - timedelta(hours=24)
    alerts = [
        alert("device_offline:F001-S01", 600, "F001-S01"),
        alert("device_offline:F001-S01", 7200, "F001-S01"),
        alert("device_offline:F001-S02", 100),  # device taken from the code
        alert("device_offline:F001-S01", 25 * 3600, "F001-S01"),  # older than 24 h
        alert("heat_stress", 50, "F001-S01"),  # not an outage
    ]
    assert outage_counts(alerts, since) == {"F001-S01": 2, "F001-S02": 1}


def test_outage_counts_empty() -> None:
    assert outage_counts([], NOW - timedelta(hours=24)) == {}


def test_attach_lineage_groups_records_per_device() -> None:
    from api.analytics import attach_lineage

    devices = [{"device_id": "A", "total": 3}, {"device_id": "B", "total": 0}]
    lineage = [
        {
            "device_id": "A",
            "batch_id": 2,
            "topic": "t",
            "partition": 0,
            "offset": 9,
            "ingested_at": "2026-01-01T00:00:02Z",
        },
        {
            "device_id": "A",
            "batch_id": 1,
            "topic": "t",
            "partition": 0,
            "offset": 4,
            "ingested_at": "2026-01-01T00:00:01Z",
        },
    ]
    result = attach_lineage(devices, lineage)
    assert [entry["batch_id"] for entry in result[0]["lineage"]] == [2, 1]
    assert "device_id" not in result[0]["lineage"][0]
    assert result[1]["lineage"] == []
    assert result[0]["total"] == 3
