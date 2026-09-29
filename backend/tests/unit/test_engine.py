from datetime import UTC, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.detection.base import AccountProfile, ActionRecord, ActionWindow, EmployeeProfile, RuleContext, TransferWindow
from app.detection.config import resolve_rule_configs
from app.detection.engine import detect, run_rules, select_rules
from app.risk.explain import aggregate_factors, compose_explanation
from tests.unit.fixtures_detection import h, loop, profiles

IST = ZoneInfo("Asia/Kolkata")
EDIT = datetime(2026, 9, 22, 3, 15, tzinfo=IST).astimezone(UTC)


def s4_context(configs=None) -> RuleContext:
    """docs/06 S4: an employee adds a beneficiary at 03:15, then the customer's accounts run a ₹6L loop within 12h."""
    accounts = ["acct_A", "acct_B", "acct_C"]
    return RuleContext(
        tenant_id="tenant_demo",
        configs=configs or resolve_rule_configs(),
        transfers=TransferWindow(
            loop([200000] * 3, [0, 1, 2], accounts, start=EDIT + h(12)),
            profiles(AccountProfile("acct_A", "cust_X"), AccountProfile("acct_B", "cust_B"), AccountProfile("acct_C", "cust_C")),
        ),
        actions=ActionWindow(
            [ActionRecord("act_1", "emp_7", "beneficiary.add", "customer", "cust_X", EDIT, customer_id="cust_X")],
            {"emp_7": EmployeeProfile("emp_7", "Kiran Das", "teller", frozenset({"beneficiary.add"}))},
        ),
    )


def test_select_rules_by_event_kind():
    assert select_rules(["acct_A"], ["transaction"]) == ["R-CIRC", "R-STRUCT", "R-PROFILE_FLOW", "R-VELOCITY", "R-DORMANT"]
    assert select_rules(["emp_1"], ["employee_action"]) == ["R-PROFILE_ROLE", "R-PROFILE_FLOW", "R-OFFHOURS"]
    assert select_rules([], ["transaction"]) == []


def test_s4_end_to_end_connected_anomalies_reach_critical():
    """R-CIRC flags the loop, R-PROFILE_FLOW links it to the 03:15 edit, R-OFFHOURS attaches, and the connected
    alert aggregates to critical (docs/06 S4 expectation)."""
    ctx = s4_context()
    hits = detect(ctx, ["acct_A", "emp_7"], ["transaction", "employee_action"])
    codes = {hit.pattern_code for hit in hits}
    assert {"R-CIRC", "R-PROFILE_FLOW"} <= codes
    flow = next(hit for hit in hits if hit.pattern_code == "R-PROFILE_FLOW")
    assert "12h between edit and first flagged transfer" in {f.raw_value for f in flow.factors}
    connected = [hit for hit in hits if hit.pattern_code in {"R-CIRC", "R-PROFILE_FLOW"}]
    score, band, factors = aggregate_factors(connected)
    assert band == "critical"
    assert abs(sum(f.contribution for f in factors) - score / 100) <= 0.011
    text = compose_explanation(connected)
    assert "loop" in text and "Kiran Das" in text


def test_disabled_rule_is_skipped():
    """A disabled R-CIRC produces no hits and flags nothing; R-PROFILE_FLOW still fires on its own amount branch."""
    configs = resolve_rule_configs([SimpleNamespace(code="R-CIRC", name=None, version=2, enabled=False, params={}, weights={})])
    ctx = s4_context(configs)
    result = run_rules(ctx, ["R-CIRC", "R-PROFILE_FLOW"])
    assert [hit.pattern_code for hit in result.hits] == ["R-PROFILE_FLOW"]
    assert ctx.flagged_tx_ids == set()


def test_rule_config_resolution_order():
    """Defaults, then tenant config, then the latest rules row per code."""
    rows = [
        SimpleNamespace(code="R-STRUCT", name="Structuring", version=1, enabled=True, params={"window_hours": 24}, weights={}),
        SimpleNamespace(code="R-STRUCT", name="Structuring", version=3, enabled=True, params={"min_in_band": 4}, weights={}),
    ]
    configs = resolve_rule_configs(rows, {"reporting_threshold": 40000})
    struct = configs["R-STRUCT"]
    assert struct.version == 3
    assert struct.params["min_in_band"] == 4
    assert struct.params["reporting_threshold"] == 40000
    assert configs["R-CIRC"].version == 0
    assert configs["R-CIRC"].params["min_cycle_amount"] == 500000
    assert abs(sum(configs["R-CIRC"].weights.values()) - 1.0) < 1e-9
