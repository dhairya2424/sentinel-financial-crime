from app.detection.base import AccountProfile, TransferWindow
from app.detection.r_struct import detect_structuring
from app.risk.explain import aggregate_factors
from tests.unit.fixtures_detection import CONFIGS, T0, h, profiles, tx

CFG = CONFIGS["R-STRUCT"]


def burst(n: int, amount: int, baseline_30d: int = 0, beneficiary: str = "acct_Y"):
    txs = [tx(f"tx_s{i}", "acct_X", beneficiary, amount, T0 + h(i)) for i in range(n)]
    return TransferWindow(txs, profiles(AccountProfile("acct_X", "cust_X", baseline_30d_count=baseline_30d)))


def test_t_struct_01_six_just_under_to_same_beneficiary():
    """T-STRUCT-01: 6× ₹48k → same beneficiary within 6h, no history → hit with all four factors, band high."""
    hits = detect_structuring(burst(6, 48000), CFG)
    assert len(hits) == 1
    hit = hits[0]
    assert hit.pattern_code == "R-STRUCT"
    assert {f.name for f in hit.factors} == {"sub_threshold_ratio", "velocity_vs_baseline", "total_amount", "destination_spread"}
    f = {x.name: x for x in hit.factors}
    assert f["sub_threshold_ratio"].raw_value == "6/6 in [40k,50k)"
    assert f["velocity_vs_baseline"].raw_value == "no prior history"
    assert f["total_amount"].raw_value == "₹2,88,000"
    assert f["destination_spread"].raw_value == "1 beneficiary"
    assert len(hit.evidence_refs) == 6
    assert hit.entity_ids[0] == "cust_X"
    assert "just under the ₹50,000 reporting threshold" in hit.explanation
    assert aggregate_factors(hits)[:2] == (74, "high")


def test_t_struct_02_only_two_no_hit():
    """T-STRUCT-02: only 2 just-under transfers → no hit."""
    assert detect_structuring(burst(2, 48000), CFG) == []


def test_t_struct_03_above_threshold_no_hit():
    """T-STRUCT-03: 3× ₹60k are above the threshold, not just under it → no hit."""
    assert detect_structuring(burst(3, 60000), CFG) == []


def test_t_struct_04_total_rule_at_band_floor():
    """T-STRUCT-04: 3× ₹40k = ₹1,20,000 ≥ 1.5 × ₹50k, and ₹40k sits on the inclusive band floor → hit."""
    hits = detect_structuring(burst(3, 40000), CFG)
    assert len(hits) == 1
    assert {f.name: f for f in hits[0].factors}["total_amount"].raw_value == "₹1,20,000"


def test_t_struct_05_high_baseline_not_three_times_no_hit():
    """T-STRUCT-05: a customer averaging 10 transfers/day (300/30d) sends 4 just-under transfers; 4 < 3×10 → no hit.
    docs/10 listed '10/30d'; that fixture contradicts the per-day baseline reading (see ADR-015), so it was corrected."""
    assert detect_structuring(burst(4, 45000, baseline_30d=300), CFG) == []


def test_low_baseline_customer_bursting_is_flagged():
    """ADR-015: 4 just-under transfers in a day against a 10/30d history (0.33/day) is 12× baseline → hit."""
    hits = detect_structuring(burst(4, 45000, baseline_30d=10), CFG)
    assert len(hits) == 1
    assert {f.name: f for f in hits[0].factors}["velocity_vs_baseline"].raw_value == "12.0x baseline"


def test_burst_straddling_midnight_is_caught():
    """Sliding 24h window: calendar-day buckets would split this burst and miss it."""
    start = T0.replace(hour=17, minute=0)
    txs = [tx(f"tx_m{i}", "acct_X", "acct_Y", 45000, start + h(i)) for i in range(3)]
    assert len(detect_structuring(TransferWindow(txs), CFG)) == 1
