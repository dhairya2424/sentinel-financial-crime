from __future__ import annotations

import math
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from app.detection.base import (
    Hit,
    RuleConfig,
    RuleContext,
    TransferRecord,
    TransferWindow,
    format_duration,
    format_inr,
    format_k,
    make_factor,
    unique,
)

CODE = "R-STRUCT"


def _baseline_30d(customer: str, window: TransferWindow) -> int:
    return sum(a.baseline_30d_count for a in window.accounts.values() if a.customer_id == customer)


def detect_structuring(window: TransferWindow, cfg: RuleConfig) -> list[Hit]:
    """Sliding 24h window per sending customer, so a burst cannot hide by straddling midnight.
    The baseline comparison uses the customer's average count per window (30-day count / 30 days)."""
    p = cfg.params
    threshold = Decimal(str(p["reporting_threshold"]))
    floor = threshold * Decimal(str(p["band_floor_ratio"]))
    horizon = timedelta(hours=p["window_hours"])
    min_total = threshold * Decimal(str(p["total_multiple"]))

    outgoing: dict[str, list[TransferRecord]] = defaultdict(list)
    for t in window.transfers:
        if t.from_acct:
            outgoing[window.customer_of(t.from_acct) or t.from_acct].append(t)

    hits: list[Hit] = []
    for customer, txs in outgoing.items():
        txs.sort(key=lambda t: t.ts)
        in_band = [t for t in txs if floor <= t.amount < threshold]
        baseline_30d = _baseline_30d(customer, window)
        expected = baseline_30d / 30 * (p["window_hours"] / 24)
        best: list[TransferRecord] | None = None
        for i, start in enumerate(in_band):
            group = [t for t in in_band[i:] if t.ts - start.ts <= horizon]
            total = sum((t.amount for t in group), Decimal(0))
            if len(group) < p["min_in_band"] or total < min_total:
                continue
            if baseline_30d > 0 and len(group) < p["baseline_multiple"] * expected:
                continue
            if best is None or (len(group), total) > (len(best), sum(t.amount for t in best)):
                best = group
        if best:
            window_all = [t for t in txs if best[0].ts <= t.ts <= best[0].ts + horizon]
            hits.append(_build_hit(customer, best, window_all, baseline_30d, expected, threshold, floor, cfg))
    return hits


def _build_hit(
    customer: str,
    group: list[TransferRecord],
    window_all: list[TransferRecord],
    baseline_30d: int,
    expected: float,
    threshold: Decimal,
    floor: Decimal,
    cfg: RuleConfig,
) -> Hit:
    w = cfg.weights
    n = len(group)
    total = sum((t.amount for t in group), Decimal(0))
    all_value = sum((t.amount for t in window_all), Decimal(0))
    beneficiaries = unique([t.to_acct for t in group])
    span = group[-1].ts - group[0].ts

    if baseline_30d > 0:
        ratio = n / max(expected, 1e-9)
        velocity = make_factor("velocity_vs_baseline", f"{ratio:.1f}x baseline", w["velocity_vs_baseline"], math.log10(ratio))
    else:
        velocity = make_factor("velocity_vs_baseline", "no prior history", w["velocity_vs_baseline"], 0.5, imputed=True)

    total_multiple = float(total / threshold)
    factors = [
        make_factor(
            "sub_threshold_ratio",
            f"{n}/{len(window_all)} in [{format_k(floor)},{format_k(threshold)})",
            w["sub_threshold_ratio"],
            float(total / all_value) if all_value else 1.0,
        ),
        velocity,
        make_factor("total_amount", format_inr(total), w["total_amount"], (total_multiple - 1.5) / 4.5),
        make_factor(
            "destination_spread",
            f"{len(beneficiaries)} beneficiar{'y' if len(beneficiaries) == 1 else 'ies'}",
            w["destination_spread"],
            len(beneficiaries) / 5,
        ),
    ]
    history = (
        f"Baseline for this customer is {baseline_30d} transfers/30 days."
        if baseline_30d
        else "This customer has no prior transfer history."
    )
    explanation = (
        f"{n} transfers of {format_inr(total)}, each just under the {format_inr(threshold)} reporting threshold, "
        f"within {format_duration(span)}. {history} Transfers: {', '.join(t.tx_id for t in group)}."
    )
    return Hit(
        pattern_code=CODE,
        title=f"Transaction structuring below {format_inr(threshold)}",
        entity_ids=unique([customer, *(t.from_acct for t in group), *beneficiaries]),
        factors=factors,
        evidence_refs=[("transaction", t.tx_id) for t in group],
        window_start=group[0].ts,
        window_end=group[-1].ts,
        explanation=explanation,
    )


class StructuringRule:
    code = CODE

    def evaluate(self, ctx: RuleContext) -> list[Hit]:
        return detect_structuring(ctx.transfers, ctx.config(CODE))
