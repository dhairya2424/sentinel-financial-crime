from app.detection.base import AccountProfile, TransferWindow
from app.detection.r_circ import detect_cycles
from app.risk.explain import aggregate_factors
from tests.unit.fixtures_detection import CONFIGS, T0, h, loop, profiles, tx

CFG = CONFIGS["R-CIRC"]
ABC = ["acct_A", "acct_B", "acct_C"]


def factors(hit):
    return {f.name: f for f in hit.factors}


def test_t_det_01_planted_cycle_exact_math():
    """T-DET-01: A→B→C→A, ₹2L legs over 4h → 1 hit, 3 evidence tx, 'loop', exact factor math, band high."""
    window = TransferWindow(
        loop([200000] * 3, [0, 2, 4], ABC),
        profiles(AccountProfile("acct_A", "cust_1"), AccountProfile("acct_B", "cust_2"), AccountProfile("acct_C", "cust_3")),
    )
    hits = detect_cycles(window, CFG)
    assert len(hits) == 1
    hit = hits[0]
    assert hit.pattern_code == "R-CIRC"
    assert hit.evidence_refs == [("transaction", "tx_1"), ("transaction", "tx_2"), ("transaction", "tx_3")]
    assert hit.entity_ids == ["acct_A", "acct_B", "acct_C", "cust_1", "cust_2", "cust_3"]
    assert "loop" in hit.explanation and "₹6,00,000" in hit.explanation
    assert "acct_A → acct_B → acct_C → acct_A" in hit.explanation
    f = factors(hit)
    assert (f["linkage_depth"].raw_value, f["linkage_depth"].contribution) == ("3 hops", 0.25)
    assert (f["amount"].raw_value, f["amount"].contribution) == ("no baseline", 0.175)
    assert (f["temporal_proximity"].raw_value, f["temporal_proximity"].contribution) == ("4h of 72h window", round(0.25 * (1 - 4 / 72), 4))
    assert (f["account_velocity"].raw_value, f["account_velocity"].contribution) == ("no baseline", 0.075)
    assert aggregate_factors(hits)[:2] == (74, "high")
    assert {n: x.imputed for n, x in f.items()} == {"linkage_depth": False, "amount": True, "temporal_proximity": False, "account_velocity": True}
    assert all(x.imputed is False for x in aggregate_factors(hits)[2] if x.name in ("linkage_depth", "temporal_proximity"))


def test_t_det_02_same_edges_over_ten_days_no_hit():
    """T-DET-02: same loop spread over 10 days exceeds the 72h window → no hit."""
    assert detect_cycles(TransferWindow(loop([200000] * 3, [0, 120, 240], ABC)), CFG) == []


def test_t_det_03_two_cycle_no_hit():
    """T-DET-03: A→B→A only (length 2) → no hit."""
    window = TransferWindow([tx("tx_1", "acct_A", "acct_B", 300000, T0), tx("tx_2", "acct_B", "acct_A", 300000, T0 + h(1))])
    assert detect_cycles(window, CFG) == []


def test_t_det_04_total_below_minimum_no_hit():
    """T-DET-04: 3-cycle totalling ₹4L (< ₹5L minimum) → no hit."""
    assert detect_cycles(TransferWindow(loop([150000, 150000, 100000], [0, 1, 2], ABC)), CFG) == []


def test_t_det_05_six_cycle_hit():
    """T-DET-05: 6-cycle within window and minimum → hit with linkage_depth '6 hops'."""
    accounts = [f"acct_{c}" for c in "ABCDEF"]
    hits = detect_cycles(TransferWindow(loop([100000] * 6, [0, 2, 4, 6, 8, 10], accounts)), CFG)
    assert len(hits) == 1
    f = factors(hits[0])
    assert f["linkage_depth"].raw_value == "6 hops"
    assert f["linkage_depth"].contribution == round(0.25 * 0.7, 4)
    assert len(hits[0].evidence_refs) == 6


def test_cycle_must_follow_money_in_time_order():
    """Precision: legs whose timestamps cannot carry money around the loop are not a circular flow."""
    window = TransferWindow(
        [
            tx("tx_1", "acct_A", "acct_B", 200000, T0),
            tx("tx_2", "acct_B", "acct_C", 200000, T0 + h(4)),
            tx("tx_3", "acct_C", "acct_A", 200000, T0 + h(2)),
        ]
    )
    assert detect_cycles(window, CFG) == []


def test_amount_factor_uses_p95_of_window_history():
    """With enough history, the amount factor compares the loop total to the p95 of other transfers."""
    history = [tx(f"tx_h{i}", "acct_X", "acct_Y", 20000, T0 - h(20 - i)) for i in range(10)]
    hits = detect_cycles(TransferWindow([*history, *loop([200000] * 3, [0, 2, 4], ABC)]), CFG)
    f = factors(hits[0])
    assert f["amount"].raw_value == "30.0x p95"
    assert f["amount"].contribution == 0.35
    assert "30.0× the p95" in hits[0].explanation
    assert aggregate_factors(hits)[:2] == (91, "critical")


def test_velocity_factor_uses_account_baselines():
    window = TransferWindow(
        loop([200000] * 3, [0, 2, 4], ABC),
        profiles(*(AccountProfile(a, baseline_30d_count=72) for a in ABC)),
    )
    f = factors(detect_cycles(window, CFG)[0])
    assert f["account_velocity"].raw_value == "2.5x baseline"
