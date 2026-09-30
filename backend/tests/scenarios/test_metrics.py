"""The metrics gate (docs/10 §2, §6): detection_rate >= 90%, false_positive_rate <= 10%, alert latency p95 <= 5000 ms."""

import os

import pytest

from tests.scenarios.metrics_runner import report


@pytest.mark.metrics
def test_scenario_metrics_pass(suspicious, legitimate):
    text, ok = report(list(suspicious.values()), legitimate, float(os.environ.get("LEGIT_TOLERANCE", "0.10")))
    assert ok, "\n" + text
