"""Device online/offline transition logic (FR3.5, FR8.2).

Pure functions: no Spark and no Cassandra, so the outage lifecycle - open a
gap on silence, close it when the device reports again - is unit-testable.
``pipeline.BatchProcessor._update_device_status`` calls :func:`transition`
once per device per micro-batch and only handles I/O around it.

All timestamps are timezone-aware UTC.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

STATUS_ONLINE = "online"
STATUS_OFFLINE = "offline"


def to_millis(value: datetime | None) -> datetime | None:
    """Truncate to millisecond precision.

    Gap rows are MERGEd on ``gap_start``, but the key round-trips through
    Cassandra ``device_status``, whose timestamps are millisecond-precision,
    while Iceberg stores microseconds. Without this the resume write
    (``.628000`` from Cassandra) never matches the open row (``.628762`` from
    the reading) and the MERGE inserts a twin instead of closing the gap.
    """
    if value is None:
        return None
    return value.replace(microsecond=(value.microsecond // 1000) * 1000)


@dataclass(frozen=True)
class StatusDecision:
    """Outcome of applying one micro-batch of observations to a device."""

    status: str | None  # "online" | "offline"; None = brand-new, skip the device
    last_seen: datetime | None
    gap_start: datetime | None  # state for the device_status row
    gap_end: datetime | None  # state for the device_status row
    offline: bool  # judged offline this batch (feeds the offline alert condition)
    went_offline: bool  # online -> offline edge: open a gap row
    resume_gap: tuple[datetime, datetime] | None  # offline -> online edge: close this gap


def transition(
    *,
    previous_status: str | None,
    previous_last_seen: datetime | None,
    previous_gap_start: datetime | None,
    previous_gap_end: datetime | None,
    batch_first_seen: datetime | None,
    batch_last_seen: datetime | None,
    now: datetime,
    offline_after_s: float,
) -> StatusDecision:
    """Apply one micro-batch of observations to a device's status.

    ``batch_first_seen``/``batch_last_seen`` are the readings for this device in
    this batch, or None when the batch contained none.

    Order matters: an offline -> online edge keys on ``previous_status`` (the
    readings branch below sets status to "online" as soon as any reading
    arrives, which would mask the transition), and it runs *before* the silence
    check so late/stale readings close the old gap first and the silence check
    can then reopen it at the newest known reading. That keeps gap rows
    consistent when historical data is replayed against wall-clock time.
    """
    last_seen = previous_last_seen
    gap_start = previous_gap_start
    gap_end = previous_gap_end
    status = previous_status
    was_offline = previous_status == STATUS_OFFLINE

    if batch_last_seen is not None:
        if last_seen is None or batch_last_seen > last_seen:
            last_seen = batch_last_seen
        status = STATUS_ONLINE
    elif last_seen is None:
        # Brand-new device that has never reported; nothing to judge yet.
        return StatusDecision(
            status=None,
            last_seen=None,
            gap_start=None,
            gap_end=None,
            offline=False,
            went_offline=False,
            resume_gap=None,
        )

    resume_gap: tuple[datetime, datetime] | None = None
    if was_offline and batch_last_seen is not None:
        # Transition offline -> online: close the gap (FR3.5).
        if gap_start is not None and batch_first_seen is not None and batch_first_seen >= gap_start:
            resume_gap = (gap_start, batch_first_seen)
            gap_end = batch_first_seen
        gap_start = None
        was_offline = False

    assert last_seen is not None  # both branches above guarantee it
    is_offline = (now - last_seen).total_seconds() > offline_after_s
    went_offline = False

    if is_offline and status != STATUS_OFFLINE:
        # Transition online -> offline: open a gap at the last reading.
        status = STATUS_OFFLINE
        gap_start = last_seen
        gap_end = None
        went_offline = True
    elif is_offline:
        pass  # already offline and still silent: the gap stays open

    return StatusDecision(
        status=status,
        last_seen=last_seen,
        gap_start=gap_start,
        gap_end=gap_end,
        offline=is_offline,
        went_offline=went_offline,
        resume_gap=resume_gap,
    )
