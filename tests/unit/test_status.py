"""Unit tests for the device outage lifecycle (FR3.5, FR8.2).

`transition` is the pure decision function behind
`BatchProcessor._update_device_status`; these tests replay outage sequences
against it without Spark or Cassandra.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from streaming.status import STATUS_OFFLINE, STATUS_ONLINE, StatusDecision, to_millis, transition

NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
THRESHOLD = 20.0  # reporting_interval_s=5 x offline_multiplier=4
LAST_READING = NOW - timedelta(seconds=60)


def online_with_readings() -> StatusDecision:
    return transition(
        previous_status=STATUS_ONLINE,
        previous_last_seen=LAST_READING,
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=NOW - timedelta(seconds=1),
        batch_last_seen=NOW,
        now=NOW,
        offline_after_s=THRESHOLD,
    )


def test_fresh_readings_keep_the_device_online() -> None:
    decision = online_with_readings()
    assert decision.status == STATUS_ONLINE
    assert decision.last_seen == NOW
    assert decision.offline is False
    assert decision.went_offline is False
    assert decision.resume_gap is None
    assert decision.gap_start is None


def test_silence_past_the_threshold_opens_a_gap() -> None:
    decision = transition(
        previous_status=STATUS_ONLINE,
        previous_last_seen=LAST_READING,
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=None,
        batch_last_seen=None,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_OFFLINE
    assert decision.offline is True
    assert decision.went_offline is True
    assert decision.gap_start == LAST_READING
    assert decision.gap_end is None


def test_silence_within_the_threshold_keeps_the_device_online() -> None:
    decision = transition(
        previous_status=STATUS_ONLINE,
        previous_last_seen=NOW - timedelta(seconds=10),
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=None,
        batch_last_seen=None,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_ONLINE
    assert decision.offline is False
    assert decision.went_offline is False


def test_staying_offline_never_reopens_the_same_gap() -> None:
    decision = transition(
        previous_status=STATUS_OFFLINE,
        previous_last_seen=LAST_READING,
        previous_gap_start=LAST_READING,
        previous_gap_end=None,
        batch_first_seen=None,
        batch_last_seen=None,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_OFFLINE
    assert decision.offline is True
    assert decision.went_offline is False  # no second gap row
    assert decision.resume_gap is None
    assert decision.gap_start == LAST_READING  # gap stays open


def test_readings_close_an_open_gap_and_count_as_resume() -> None:
    gap_start = NOW - timedelta(seconds=90)
    first_seen = NOW - timedelta(seconds=2)
    decision = transition(
        previous_status=STATUS_OFFLINE,
        previous_last_seen=gap_start,  # last reading was at the gap start
        previous_gap_start=gap_start,
        previous_gap_end=None,
        batch_first_seen=first_seen,
        batch_last_seen=NOW,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_ONLINE
    assert decision.offline is False
    assert decision.resume_gap == (gap_start, first_seen)
    assert decision.gap_start is None  # cleared on the status row
    assert decision.gap_end == first_seen


def test_stale_readings_still_open_a_gap() -> None:
    # Readings arrive, but they are older than the offline threshold: the
    # device is not reporting live data and must still be marked offline.
    stale = NOW - timedelta(seconds=120)
    decision = transition(
        previous_status=STATUS_ONLINE,
        previous_last_seen=stale - timedelta(seconds=60),
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=stale - timedelta(seconds=60),
        batch_last_seen=stale,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_OFFLINE
    assert decision.went_offline is True
    assert decision.gap_start == stale  # gap opens at the newest known reading


def test_readings_predating_the_gap_do_not_close_it() -> None:
    # Clock-skew guard: a first_seen before gap_start cannot be the resume.
    gap_start = NOW - timedelta(seconds=30)
    first_seen = NOW - timedelta(seconds=90)
    decision = transition(
        previous_status=STATUS_OFFLINE,
        previous_last_seen=gap_start,
        previous_gap_start=gap_start,
        previous_gap_end=None,
        batch_first_seen=first_seen,
        batch_last_seen=NOW,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_ONLINE
    assert decision.resume_gap is None
    assert decision.gap_start is None


def test_stale_readings_close_the_old_gap_then_reopen_one() -> None:
    # Replay / late-data case: readings arrive while the device is offline, but
    # they are themselves older than the threshold. The old gap closes at their
    # first appearance and a new one opens at the newest of them, so gap rows
    # stay consistent instead of leaving an orphaned open gap behind.
    gap_start = NOW - timedelta(seconds=300)
    first_seen = NOW - timedelta(seconds=250)
    last_seen = NOW - timedelta(seconds=240)
    decision = transition(
        previous_status=STATUS_OFFLINE,
        previous_last_seen=gap_start,
        previous_gap_start=gap_start,
        previous_gap_end=None,
        batch_first_seen=first_seen,
        batch_last_seen=last_seen,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.resume_gap == (gap_start, first_seen)
    assert decision.went_offline is True
    assert decision.status == STATUS_OFFLINE
    assert decision.gap_start == last_seen  # new gap opens at the newest reading
    assert decision.gap_end is None
    assert decision.offline is True


def test_to_millis_truncates_the_microsecond_part() -> None:
    # Regression: gap rows must MERGE on the same key Cassandra can store.
    value = datetime(2026, 1, 1, 12, 0, 45, 628_762, tzinfo=UTC)
    assert to_millis(value) == datetime(2026, 1, 1, 12, 0, 45, 628_000, tzinfo=UTC)
    assert to_millis(None) is None


def test_brand_new_device_without_readings_is_skipped() -> None:
    decision = transition(
        previous_status=None,
        previous_last_seen=None,
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=None,
        batch_last_seen=None,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status is None


def test_brand_new_device_with_readings_starts_online() -> None:
    decision = transition(
        previous_status=None,
        previous_last_seen=None,
        previous_gap_start=None,
        previous_gap_end=None,
        batch_first_seen=NOW - timedelta(seconds=2),
        batch_last_seen=NOW,
        now=NOW,
        offline_after_s=THRESHOLD,
    )
    assert decision.status == STATUS_ONLINE
    assert decision.last_seen == NOW
    assert decision.went_offline is False
