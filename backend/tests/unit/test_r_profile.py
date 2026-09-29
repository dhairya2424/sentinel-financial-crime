from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from app.detection.base import ActionRecord, EmployeeProfile, TransferWindow
from app.detection.r_circ import detect_cycles
from app.detection.r_profile import evaluate_edit_then_flow, evaluate_role_mismatch
from app.risk.explain import aggregate_factors
from tests.unit.fixtures_detection import CONFIGS, h, loop, tx

IST = ZoneInfo("Asia/Kolkata")
ROLE = CONFIGS["R-PROFILE_ROLE"]
FLOW = CONFIGS["R-PROFILE_FLOW"]
MIDDAY = datetime(2026, 9, 22, 11, 0, tzinfo=IST).astimezone(UTC)
EDIT_0315 = datetime(2026, 9, 22, 3, 15, tzinfo=IST).astimezone(UTC)
CUSTOMER_ACCOUNTS = {"acct_A"}


def approve(ts=MIDDAY) -> ActionRecord:
    return ActionRecord("act_1", "emp_1", "tx.approve", "transaction", "tx_900", ts)


def edit(action_type: str, ts=EDIT_0315) -> ActionRecord:
    return ActionRecord("act_2", "emp_2", action_type, "customer", "cust_X", ts, customer_id="cust_X")


def factors(hit):
    return {f.name: f for f in hit.factors}


def test_t_prof_01_analyst_approves_transaction():
    """T-PROF-01: analyst performs tx.approve → hit; access_anomaly raw mentions analyst."""
    analyst = EmployeeProfile("emp_1", "Ravi Mehta", "analyst", frozenset({"profile.edit"}))
    hit = evaluate_role_mismatch(approve(), analyst, ROLE, IST)
    assert hit is not None and hit.pattern_code == "R-PROFILE_ROLE"
    f = factors(hit)
    assert "analyst" in f["access_anomaly"].raw_value
    assert f["access_anomaly"].contribution == 0.35
    assert f["action_sensitivity"].contribution == 0.25
    assert f["temporal_proximity"].raw_value == "no grant on record"
    assert f["employee_off_hours"].raw_value == "11:00 within 09:00-19:00"
    assert hit.evidence_refs == [("employee_action", "act_1"), ("transaction", "tx_900")]
    assert "outside permitted roles" in hit.explanation
    assert aggregate_factors([hit])[1] == "high"


def test_t_prof_02_finance_ops_with_entitlement_no_hit():
    """T-PROF-02: finance_ops with the tx.approve entitlement → no hit."""
    ops = EmployeeProfile("emp_1", "Neha Rao", "finance_ops", frozenset({"tx.approve"}))
    assert evaluate_role_mismatch(approve(), ops, ROLE, IST) is None


def test_t_prof_03_manager_with_revoked_entitlement():
    """T-PROF-03: manager's role allows tx.approve but the entitlement was revoked → hit on the entitlement branch."""
    manager = EmployeeProfile(
        "emp_1", "Arjun Shah", "manager", frozenset({"profile.edit"}), revoked_entitlements={"tx.approve": MIDDAY - h(2)}
    )
    hit = evaluate_role_mismatch(approve(), manager, ROLE, IST)
    assert hit is not None
    f = factors(hit)
    assert "revoked" in f["access_anomaly"].raw_value
    assert f["access_anomaly"].contribution == round(0.35 * 0.7, 4)
    assert f["temporal_proximity"].raw_value == "2h after entitlement revoked"
    assert f["temporal_proximity"].contribution == round(0.25 * (1 - 2 / 48), 4)
    assert "without an active 'tx.approve' entitlement" in hit.explanation


def circular_flow(start):
    transfers = loop([200000] * 3, [0, 1, 2], ["acct_A", "acct_B", "acct_C"], start=start)
    flagged = {ref for hit in detect_cycles(TransferWindow(transfers), CONFIGS["R-CIRC"]) for _, ref in hit.evidence_refs}
    return transfers, flagged


def test_t_prof_04_limit_change_then_circular_flow():
    """T-PROF-04: limit.change at 03:15 IST, then the customer's circular flow within 12h → hit, temporal_proximity > 0."""
    manager = EmployeeProfile("emp_2", "Arjun Shah", "manager", frozenset({"limit.change"}))
    transfers, flagged = circular_flow(EDIT_0315 + h(12))
    assert flagged
    hit = evaluate_edit_then_flow(edit("limit.change"), manager, transfers, CUSTOMER_ACCOUNTS, flagged, FLOW, IST)
    assert hit is not None and hit.pattern_code == "R-PROFILE_FLOW"
    f = factors(hit)
    assert f["temporal_proximity"].contribution > 0
    assert f["temporal_proximity"].raw_value == "12h between edit and first flagged transfer"
    assert f["employee_off_hours"].raw_value == "03:15 outside 09:00-19:00"
    assert f["employee_off_hours"].contribution == 0.15
    assert hit.evidence_refs[0] == ("employee_action", "act_2")
    assert ("transaction", "tx_1") in hit.evidence_refs
    assert "cust_X" in hit.entity_ids and "emp_2" in hit.entity_ids


def test_t_prof_05_edit_then_small_normal_transfer_no_hit():
    """T-PROF-05: profile.edit followed by an ordinary ₹1k transfer within 12h → no hit."""
    manager = EmployeeProfile("emp_2", "Arjun Shah", "manager", frozenset({"profile.edit"}))
    transfers = [tx("tx_7", "acct_A", "acct_Z", 1000, EDIT_0315 + h(12))]
    assert evaluate_edit_then_flow(edit("profile.edit"), manager, transfers, CUSTOMER_ACCOUNTS, set(), FLOW, IST) is None


def test_t_prof_06_circular_flow_after_window_no_hit():
    """T-PROF-06: the circular flow starts 60h after the edit, outside the 48h correlation window → no hit."""
    manager = EmployeeProfile("emp_2", "Arjun Shah", "manager", frozenset({"limit.change"}))
    transfers, flagged = circular_flow(EDIT_0315 + h(60))
    assert evaluate_edit_then_flow(edit("limit.change"), manager, transfers, CUSTOMER_ACCOUNTS, flagged, FLOW, IST) is None
