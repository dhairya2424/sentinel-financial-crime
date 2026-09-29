import pytest

from app.detection.base import AccountProfile, Factor, Hit, TransferWindow
from app.detection.engine import merge_hits_with_supporting
from app.detection.r_circ import detect_cycles
from app.detection.r_struct import detect_structuring
from app.detection.supporting import velocity_signals
from app.risk.explain import ExplainabilityError, aggregate_factors, assert_explainability, band_for, compose_explanation
from tests.unit.fixtures_detection import CONFIGS, T0, h, loop, profiles, tx


def hit_with(*factors: Factor, explanation: str = "x", code: str = "R-CIRC") -> Hit:
    return Hit(code, "t", ["acct_A"], list(factors), [], T0, T0, explanation)


@pytest.mark.parametrize(
    ("score", "band"),
    [(39, "low"), (40, "medium"), (69, "medium"), (70, "high"), (84, "high"), (85, "critical"), (0, "low"), (100, "critical")],
)
def test_t_risk_01_band_boundaries(score, band):
    """T-RISK-01: band edges exactly 40 / 70 / 85 (ADR-003)."""
    assert band_for(score) == band


def test_t_risk_02_max_merge_by_factor_name():
    """T-RISK-02: the same factor name in two hits keeps the larger contribution."""
    a = hit_with(Factor("temporal_proximity", "4h of 72h window", 0.25, 0.20), Factor("amount", "no baseline", 0.35, 0.175))
    b = hit_with(Factor("temporal_proximity", "12h between edit and flow", 0.25, 0.10))
    score, band, factors = aggregate_factors([a, b])
    merged = {f.name: f for f in factors}
    assert merged["temporal_proximity"].contribution == 0.20
    assert merged["temporal_proximity"].raw_value == "4h of 72h window"
    assert score == 38 and band == "low"


def test_t_risk_03_invariant_rejects_hand_broken_factors():
    """T-RISK-03: contributions that do not add up to the score raise ExplainabilityError."""
    broken = [Factor("amount", "4.2x p95", 0.35, 0.35), Factor("linkage_depth", "3 hops", 0.25, 0.25)]
    with pytest.raises(ExplainabilityError):
        assert_explainability(80, broken)
    with pytest.raises(ExplainabilityError):
        assert_explainability(0, [])
    assert_explainability(60, broken)


def test_t_risk_04_explanation_has_amounts_ids_and_rule_words():
    """T-RISK-04: composed explanation carries amounts, ids and rule words, strongest hit first."""
    circ = detect_cycles(TransferWindow(loop([200000] * 3, [0, 2, 4], ["acct_A", "acct_B", "acct_C"])), CONFIGS["R-CIRC"])
    struct = detect_structuring(
        TransferWindow([tx(f"tx_s{i}", "acct_A", "acct_Y", 45000, T0 + h(i)) for i in range(3)]), CONFIGS["R-STRUCT"]
    )
    text = compose_explanation([*struct, *circ])
    assert "₹6,00,000" in text and "₹1,35,000" in text
    assert "tx_1" in text and "tx_s0" in text
    assert "loop" in text and "reporting threshold" in text
    assert text.index("loop") < text.index("reporting threshold")
    assert " | " in text


def test_t_risk_05_supporting_factor_raises_score_and_band():
    """T-RISK-05: a velocity signal on a loop account lifts the R-CIRC alert from high to critical."""
    legs = loop([200000] * 3, [0, 2, 4], ["acct_A", "acct_B", "acct_C"])
    burst = [tx(f"tx_v{i}", "acct_A", "acct_Z", 1000, T0 + h(i * 0.4)) for i in range(10)]
    window = TransferWindow([*legs, *burst], profiles(AccountProfile("acct_A", baseline_30d_count=72)))
    hits = detect_cycles(TransferWindow(legs), CONFIGS["R-CIRC"])
    before = aggregate_factors(hits)
    merged = merge_hits_with_supporting(hits, velocity_signals(window, CONFIGS["R-VELOCITY"]))
    score, band, factors = aggregate_factors(merged)
    assert before[1] == "high" and band == "critical"
    assert score > before[0]
    assert abs(sum(f.contribution for f in factors) - score / 100) <= 0.011


def test_overflow_is_scaled_not_clamped_so_invariant_holds():
    """Connected anomalies can sum past 1.0; contributions are scaled so they still add up to 100."""
    a = hit_with(Factor("linkage_depth", "3 hops", 0.25, 0.25), Factor("amount", "30x p95", 0.35, 0.35))
    b = hit_with(Factor("access_anomaly", "analyst lacks tx.approve", 0.35, 0.35), Factor("action_sensitivity", "tx.approve", 0.25, 0.25))
    score, band, factors = aggregate_factors([a, b])
    assert (score, band) == (100, "critical")
    assert len(factors) == 4
    assert abs(sum(f.contribution for f in factors) - 1.0) <= 0.011
    assert factors[0].name in {"amount", "access_anomaly"}
