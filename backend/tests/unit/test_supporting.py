from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.detection.base import AccountProfile, ActionRecord, ActionWindow, TransferWindow
from app.detection.engine import merge_hits_with_supporting
from app.detection.supporting import dormant_signals, offhours_signals, velocity_signals
from app.risk.explain import aggregate_factors
from tests.unit.fixtures_detection import CONFIGS, T0, h, profiles, tx

IST = ZoneInfo("Asia/Kolkata")


def test_t_supp_01_velocity_ten_times_baseline_caps_at_040():
    """T-SUPP-01: ~10× the account's hourly baseline → account_velocity factor at its 0.40 cap."""
    txs = [tx(f"tx_v{i}", "acct_V", f"acct_{i}", 5000, T0 + h(i)) for i in range(10)]
    window = TransferWindow(txs, profiles(AccountProfile("acct_V", "cust_V", baseline_30d_count=72)))
    signals = velocity_signals(window, CONFIGS["R-VELOCITY"])
    velocity = next(s for s in signals if "acct_V" in s.entity_ids)
    assert velocity.code == "R-VELOCITY"
    assert velocity.factor.name == "account_velocity"
    assert velocity.factor.weight == 0.40
    assert velocity.factor.contribution == 0.40


def test_velocity_below_trigger_is_silent():
    txs = [tx(f"tx_v{i}", "acct_V", "acct_W", 5000, T0 + h(i)) for i in range(3)]
    window = TransferWindow(txs, profiles(AccountProfile("acct_V", baseline_30d_count=3000)))
    assert velocity_signals(window, CONFIGS["R-VELOCITY"]) == []


def action_at(hour: int, minute: int = 0) -> ActionRecord:
    ts = datetime(2026, 9, 22, hour, minute, tzinfo=IST).astimezone(UTC)
    return ActionRecord("act_9", "emp_9", "login", "system", "sys", ts, customer_id="cust_D")


def test_t_supp_02_offhours_action_caps_at_025():
    """T-SUPP-02: an action at 02:00 tenant time → employee_off_hours factor at its 0.25 cap."""
    signals = offhours_signals(ActionWindow([action_at(2)]), CONFIGS["R-OFFHOURS"], IST)
    assert len(signals) == 1
    assert signals[0].factor.contribution == 0.25
    assert signals[0].factor.raw_value == "02:00 within 00:00-05:00"
    assert offhours_signals(ActionWindow([action_at(10)]), CONFIGS["R-OFFHOURS"], IST) == []


def dormant_window() -> TransferWindow:
    return TransferWindow(
        [tx("tx_d1", "acct_D", "acct_Q", 90000, T0)],
        profiles(AccountProfile("acct_D", "cust_D", last_activity_at=T0 - timedelta(days=90))),
    )


def test_t_supp_03_dormant_reactivation_caps_at_045_and_goes_standalone_at_60():
    """T-SUPP-03: 90 days idle + ₹90k → dormancy_gap at 0.45. Alone that is below 60, so no standalone alert;
    with an off-hours login on the same customer the composite reaches 70 and a standalone alert is raised."""
    dormant = dormant_signals(dormant_window(), CONFIGS["R-DORMANT"])
    assert len(dormant) == 1
    assert dormant[0].factor.contribution == 0.45
    assert dormant[0].factor.raw_value == "90 days idle"

    assert merge_hits_with_supporting([], dormant) == []

    offhours = offhours_signals(ActionWindow([action_at(2)]), CONFIGS["R-OFFHOURS"], IST)
    standalone = merge_hits_with_supporting([], [*dormant, *offhours])
    assert len(standalone) == 1
    alert = standalone[0]
    assert alert.pattern_code == "R-DORMANT"
    assert aggregate_factors([alert])[:2] == (70, "high")
    assert {"acct_D", "cust_D", "emp_9"} <= set(alert.entity_ids)
