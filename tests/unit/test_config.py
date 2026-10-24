"""Unit tests for stream configuration helpers (AGENTS.md trigger contract).

Spark 3.5's CalendarInterval parser rejects single-letter units, so the
human-friendly ``30s`` in ``.env`` must be normalised before it reaches
``withWatermark`` or the processing-time trigger.
"""

from __future__ import annotations

import pytest

from streaming.config import spark_interval


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("10s", "10 seconds"),
        ("30s", "30 seconds"),
        ("60s", "60 seconds"),
        ("5m", "5 minutes"),
        ("1h", "1 hours"),
        ("2d", "2 days"),
        ("500ms", "500 milliseconds"),
        ("30S", "30 seconds"),
        ("  30 s ", "30 seconds"),
    ],
)
def test_shorthand_is_normalised(raw: str, expected: str) -> None:
    assert spark_interval(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["30 seconds", "1 minute", "1 hour 30 minutes", "bogus"],
)
def test_already_valid_values_are_passed_through(raw: str) -> None:
    assert spark_interval(raw) == raw
