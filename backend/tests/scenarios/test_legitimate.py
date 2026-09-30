"""L1–L20 (docs/10 §6, NFR-06): the benign corpus of 200 customers over 90 days, run through the pipeline, flags at
most 10% of customers with an alert of band medium or higher. LEGIT_TOLERANCE overrides the 0.10 limit."""

import os

from tests.scenarios.metrics_runner import legit_settings, offender_lines


def test_false_positive_rate_within_tolerance(legitimate):
    tolerance = float(os.environ.get("LEGIT_TOLERANCE", "0.10"))
    assert legitimate.customers == legit_settings()["customers"]
    assert legitimate.events > 10_000, "the corpus is the full 90-day one"
    assert legitimate.rate <= tolerance, "\n".join(
        [f"false_positive_rate {legitimate.rate:.1%} > {tolerance:.0%} ({legitimate.flagged}/{legitimate.customers}); top offenders:", *offender_lines(legitimate)]
    )
