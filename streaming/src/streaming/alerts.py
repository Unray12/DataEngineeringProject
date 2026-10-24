"""Alert evaluation rules for the micro-batch job (BR8).

Everything in this module is pure Python over plain dataclasses so the rules
can be unit-tested without Spark or Cassandra. The streaming job turns each
micro-batch into a list of :class:`Condition` observations (threshold breaches,
device outages, low battery, poor signal) and feeds them through
:func:`evaluate` together with the persisted :class:`AlertState` of that
condition, which is where FR8.4 (lifecycle) and FR8.5 (debounce + cooldown)
live:

* **debounce** - a condition must persist for ``debounce_batches``
  micro-batches before an alert is emitted, so a one-batch blip raises nothing.
* **cooldown** - after an emission, the same condition cannot emit again for
  ``cooldown_s``, so a persistent breach produces a bounded number of alerts.
* **lifecycle** - open -> acknowledged -> resolved. Threshold and outage alerts
  resolve automatically when the condition clears (``status='open'`` only: an
  acknowledged alert waits for the operator, FR8.4). The API performs the manual
  transitions.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_RESOLVED = "resolved"

# Allowed manual transitions for PATCH /alerts/{id} (FR8.4).
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
    (checkpoint + idempotent writes are what make replays safe, FR3.2/FR3.3).
    """
    state.last_observed_value = condition.observed_value
    state.threshold_value = condition.threshold_value
    state.device_id = condition.device_id

    if condition.breaching:
        state.debounce_count += 1
        # An alert is already open (or acknowledged): nothing more to emit, the
        # condition is being tracked (FR8.5 - no alert floods).
        if state.open_alert_id is not None:
            return Decision(emit_alert=False, resolve_alert=False)
        # Debounce: the condition must persist for N micro-batches.
        if state.debounce_count < cfg.debounce_batches:
            return Decision(emit_alert=False, resolve_alert=False)
        # Cooldown: one alert per condition per cooldown window.
        if state.last_emitted_at is not None:
            elapsed = (now - state.last_emitted_at).total_seconds()
            if elapsed < cfg.cooldown_s:
                return Decision(emit_alert=False, resolve_alert=False)
        return Decision(emit_alert=True, resolve_alert=False)

    # Condition cleared.
    state.debounce_count = 0
    # Auto-resolve only alerts nobody has acknowledged yet (FR8.4): an
    # acknowledged alert stays with the operator until they resolve it.
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
