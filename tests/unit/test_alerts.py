"""Unit tests for the alert state machine (FR8.1, FR8.4, FR8.5)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from common.reference import CropTarget
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
    threshold_conditions,
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


TEMPERATURE = CropTarget(metric="air_temperature", min=10.0, max=38.0, alert_below=5.0, alert_above=38.0)


def temperature(avg_value: float) -> dict[str, Condition]:
    conditions = threshold_conditions(
        field_id="F001",
        metric="air_temperature",
        unit="degC",
        avg_value=avg_value,
        target=TEMPERATURE,
        crop_code="RICE",
        device_id="F001-S02",
    )
    return {condition.condition_code: condition for condition in conditions}


def test_threshold_conditions_observe_both_bounds() -> None:
    hot = temperature(40.0)
    assert set(hot) == {"low_air_temperature", "heat_stress"}
    assert hot["heat_stress"].breaching and hot["heat_stress"].severity == "critical"
    assert not hot["low_air_temperature"].breaching

    soil = threshold_conditions(
        field_id="F001",
        metric="soil_moisture",
        unit="%",
        avg_value=29.5,
        target=CropTarget(metric="soil_moisture", min=30.0, max=60.0, alert_below=32.0),
        crop_code="RICE",
        device_id="F001-S01",
    )
    assert [(c.condition_code, c.breaching) for c in soil] == [("low_soil_moisture", True)]


def test_heat_stress_alert_resolves_when_the_temperature_drops() -> None:
    state = AlertState(field_id="F001", condition_code="heat_stress")
    evaluate(temperature(40.0)["heat_stress"], state, NOW, CFG)
    assert evaluate(temperature(41.0)["heat_stress"], state, NOW + timedelta(seconds=30), CFG).emit_alert
    open_alert(state, uuid.uuid4(), NOW + timedelta(seconds=30))

    decision = evaluate(temperature(30.0)["heat_stress"], state, NOW + timedelta(seconds=60), CFG)
    assert decision.resolve_alert is True
    assert state.debounce_count == 0
