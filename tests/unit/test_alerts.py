"""Unit tests for the alert state machine (FR8.1, FR8.4, FR8.5)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from streaming.alerts import (
    ALLOWED_TRANSITIONS,
    STATUS_ACKNOWLEDGED,
    STATUS_OPEN,
    STATUS_RESOLVED,
    AlertConfig,
    AlertState,
    Condition,
    evaluate,
    open_alert,
    resolve_open_alert,
)

CFG = AlertConfig(debounce_batches=2, cooldown_s=300)
NOW = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def breaching() -> Condition:
    return Condition(
        field_id="F001",
        condition_code="low_soil_moisture",
        alert_type="low soil moisture",
        severity="warning",
        breaching=True,
        message="soil moisture below target",
        metric="soil_moisture",
        observed_value=25.0,
        threshold_value=32.0,
    )


def clear() -> Condition:
    return Condition(
        field_id="F001",
        condition_code="low_soil_moisture",
        alert_type="low soil moisture",
        severity="warning",
        breaching=False,
        message="",
        metric="soil_moisture",
        observed_value=45.0,
        threshold_value=32.0,
    )


def test_debounce_defers_the_first_batches() -> None:
    state = AlertState(field_id="F001", condition_code="low_soil_moisture")
    first = evaluate(breaching(), state, NOW, CFG)
    assert first.emit_alert is False
    assert state.debounce_count == 1

    second = evaluate(breaching(), state, NOW + timedelta(seconds=30), CFG)
    assert second.emit_alert is True


def test_a_single_batch_blip_never_opens_an_alert() -> None:
    state = AlertState(field_id="F001", condition_code="low_soil_moisture")
    evaluate(breaching(), state, NOW, CFG)
    decision = evaluate(clear(), state, NOW + timedelta(seconds=30), CFG)
    assert decision.emit_alert is False
    assert decision.resolve_alert is False
    assert state.debounce_count == 0


def test_open_alert_is_not_re_emitted_while_breaching() -> None:
    state = AlertState(field_id="F001", condition_code="low_soil_moisture")
    evaluate(breaching(), state, NOW, CFG)
    decision = evaluate(breaching(), state, NOW + timedelta(seconds=30), CFG)
    assert decision.emit_alert is True
    open_alert(state, uuid.uuid4(), NOW + timedelta(seconds=30))

    again = evaluate(breaching(), state, NOW + timedelta(seconds=60), CFG)
    assert again.emit_alert is False
    assert again.resolve_alert is False


def test_condition_clears_resolves_an_open_alert() -> None:
    state = AlertState(field_id="F001", condition_code="low_soil_moisture")
    evaluate(breaching(), state, NOW, CFG)
    evaluate(breaching(), state, NOW + timedelta(seconds=30), CFG)
    open_alert(state, uuid.uuid4(), NOW + timedelta(seconds=30))

    decision = evaluate(clear(), state, NOW + timedelta(seconds=60), CFG)
    assert decision.resolve_alert is True
    resolve_open_alert(state)
    assert state.open_alert_id is None


def test_acknowledged_alert_is_not_auto_resolved() -> None:
    state = AlertState(field_id="F001", condition_code="low_soil_moisture")
    alert_id = uuid.uuid4()
    open_alert(state, alert_id, NOW)
    state.open_status = STATUS_ACKNOWLEDGED

    decision = evaluate(clear(), state, NOW + timedelta(seconds=60), CFG)
    assert decision.resolve_alert is False
    assert state.open_alert_id == alert_id


def test_cooldown_blocks_a_second_alert_too_soon() -> None:
    state = AlertState(
        field_id="F001",
        condition_code="low_soil_moisture",
        last_emitted_at=NOW,
    )
    # Debounce satisfied, no open alert, but the cooldown has not elapsed.
    decision = evaluate(breaching(), state, NOW + timedelta(seconds=30), CFG)
    assert decision.emit_alert is False
    assert state.debounce_count == 1
    decision = evaluate(breaching(), state, NOW + timedelta(seconds=60), CFG)
    assert decision.emit_alert is False

    # After the cooldown window a new alert may open again.
    later = evaluate(breaching(), state, NOW + timedelta(seconds=400), CFG)
    assert later.emit_alert is True


def test_allowed_transitions_lifecycle() -> None:
    assert ALLOWED_TRANSITIONS[STATUS_OPEN] == {STATUS_ACKNOWLEDGED, STATUS_RESOLVED}
    assert ALLOWED_TRANSITIONS[STATUS_ACKNOWLEDGED] == {STATUS_RESOLVED}
    assert ALLOWED_TRANSITIONS[STATUS_RESOLVED] == set()
