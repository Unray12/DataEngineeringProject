"""Alert rules for the streaming job, as plain functions so they can be unit-tested without Spark.

Each batch turns into a list of ``Condition`` observations (a threshold breach, a silent device, low
battery, ...). ``evaluate`` combines one with the stored ``AlertState`` of that condition:

* debounce: the condition must hold for ``debounce_batches`` batches before an alert opens;
* cooldown: after an alert, the same condition stays quiet for ``cooldown_s``;
* lifecycle: open -> acknowledged -> resolved. An open alert resolves itself when the condition
  clears; once acknowledged, only the operator (through the API) can resolve it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from common.reference import CropTarget

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_RESOLVED = "resolved"

# Allowed manual transitions for PATCH /alerts/{id}.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    STATUS_OPEN: {STATUS_ACKNOWLEDGED, STATUS_RESOLVED},
    STATUS_ACKNOWLEDGED: {STATUS_RESOLVED},
    STATUS_RESOLVED: set(),
}


@dataclass
class AlertState:
    """Persisted per-(field, condition) state (table alert_state_by_field)."""

    field_id: str
    condition_code: str
    debounce_count: int = 0
    last_emitted_at: datetime | None = None
    open_alert_id: uuid.UUID | None = None
    open_created_at: datetime | None = None
    open_status: str | None = None
    last_observed_value: float | None = None
    threshold_value: float | None = None
    device_id: str | None = None
    last_batch_id: int | None = None


@dataclass(frozen=True)
class Condition:
    """One observation of one condition inside a micro-batch."""

    field_id: str
    condition_code: str
    alert_type: str
    severity: str  # info | warning | critical
    breaching: bool
    message: str
    metric: str | None = None
    device_id: str | None = None
    crop_code: str | None = None
    observed_value: float | None = None
    threshold_value: float | None = None


def threshold_conditions(
    *,
    field_id: str,
    metric: str,
    unit: str,
    avg_value: float,
    target: CropTarget,
    crop_code: str,
    device_id: str | None,
) -> list[Condition]:
    """The low and the high threshold condition of one field and metric for one batch.

    Both are returned whether they breach or not: a condition that is not observed in a batch keeps
    its debounce counter and its open alert, so it would never reset or resolve.
    """
    title = metric.replace("_", " ").title()
    conditions: list[Condition] = []
    if target.alert_below is not None:
        conditions.append(
            Condition(
                field_id=field_id,
                condition_code=f"low_{metric}",
                alert_type="low soil moisture" if metric == "soil_moisture" else f"low {metric}",
                severity="warning",
                breaching=avg_value < target.alert_below,
                message=(
                    f"{title} below the target range in {field_id}: "
                    f"{avg_value:.1f} {unit} < {target.alert_below:.1f} {unit}"
                ),
                metric=metric,
                device_id=device_id,
                crop_code=crop_code,
                observed_value=avg_value,
                threshold_value=target.alert_below,
            )
        )
    if target.alert_above is not None:
        heat = metric == "air_temperature"
        conditions.append(
            Condition(
                field_id=field_id,
                condition_code="heat_stress" if heat else f"high_{metric}",
                alert_type="heat stress" if heat else f"high {metric}",
                severity="critical",
                breaching=avg_value > target.alert_above,
                message=(
                    f"{title} above the target range in {field_id}: "
                    f"{avg_value:.1f} {unit} > {target.alert_above:.1f} {unit}"
                ),
                metric=metric,
                device_id=device_id,
                crop_code=crop_code,
                observed_value=avg_value,
                threshold_value=target.alert_above,
            )
        )
    return conditions


@dataclass(frozen=True)
class Decision:
    """What the job must do for one condition in this micro-batch."""

    emit_alert: bool
    resolve_alert: bool


@dataclass(frozen=True)
class AlertConfig:
    debounce_batches: int = 2
    cooldown_s: int = 300


def evaluate(condition: Condition, state: AlertState, now: datetime, cfg: AlertConfig) -> Decision:
    """Advance the state machine of one condition and say what to do.

    ``state`` is updated in place and must be written back to Cassandra by the
    caller regardless of the decision, so the debounce counter survives restarts
    (a re-run batch then rewrites the same state).
    """
    state.last_observed_value = condition.observed_value
    state.threshold_value = condition.threshold_value
    state.device_id = condition.device_id

    if condition.breaching:
        state.debounce_count += 1
        # Already open or acknowledged: one alert per episode.
        if state.open_alert_id is not None:
            return Decision(emit_alert=False, resolve_alert=False)
        if state.debounce_count < cfg.debounce_batches:
            return Decision(emit_alert=False, resolve_alert=False)
        if state.last_emitted_at is not None:
            elapsed = (now - state.last_emitted_at).total_seconds()
            if elapsed < cfg.cooldown_s:
                return Decision(emit_alert=False, resolve_alert=False)
        return Decision(emit_alert=True, resolve_alert=False)

    state.debounce_count = 0
    # Only unacknowledged alerts resolve themselves; an acknowledged one waits for the operator.
    if state.open_alert_id is not None and state.open_status == STATUS_OPEN:
        return Decision(emit_alert=False, resolve_alert=True)
    return Decision(emit_alert=False, resolve_alert=False)


def open_alert(state: AlertState, alert_id: uuid.UUID, created_at: datetime) -> None:
    """Record that an alert was emitted and is now open."""
    state.open_alert_id = alert_id
    state.open_created_at = created_at
    state.open_status = STATUS_OPEN
    state.last_emitted_at = created_at


def resolve_open_alert(state: AlertState) -> None:
    """Clear the open alert of a condition after an automatic resolve."""
    state.open_alert_id = None
    state.open_created_at = None
    state.open_status = None


def new_alert_id() -> uuid.UUID:
    return uuid.uuid4()
