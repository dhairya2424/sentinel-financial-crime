"""S1–S5 (docs/10 §6, docs/06 §7): each planted scenario is detected by the live pipeline with band medium or higher.
S4 passes on R-PROFILE_FLOW or R-CIRC; S5 on R-DORMANT or R-OFFHOURS (as the alert's rule or an attached factor)."""

import pytest

from tests.scenarios.harness import MEDIUM_PLUS, SCENARIO_IDS

EXPECTED = {"S1": {"R-CIRC"}, "S2": {"R-STRUCT"}, "S3": {"R-PROFILE_ROLE"}, "S4": {"R-PROFILE_FLOW", "R-CIRC"}, "S5": {"R-DORMANT", "R-OFFHOURS"}}


@pytest.mark.parametrize("sid", SCENARIO_IDS)
def test_scenario_is_detected(suspicious, sid):
    result = suspicious[sid]
    assert result.error is None, result.error
    assert result.detected, f"{sid}: no matching alert within 10s; alerts seen: {result.alerts}"
    assert result.rule_hit in EXPECTED[sid], (sid, result.rule_hit)
    assert result.band in MEDIUM_PLUS, (sid, result.band)
    assert result.latency_ms is not None and result.latency_ms <= 10_000, (sid, result.latency_ms)


def test_each_scenario_raises_one_alert(suspicious):
    """Every event of a scenario re-finds the same situation from its own angle; dedup keeps it one alert."""
    counts = {sid: len(r.alerts) for sid, r in suspicious.items()}
    assert counts == {sid: 1 for sid in SCENARIO_IDS}, counts


def test_s1_is_high_or_critical_and_s4_critical(suspicious):
    """docs/06 §7 expected bands: S1 high/critical, S4 critical (edit and loop connected)."""
    assert suspicious["S1"].band in ("high", "critical")
    assert suspicious["S4"].band == "critical"
