from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

import networkx as nx

from app.detection.base import (
    Hit,
    RuleConfig,
    RuleContext,
    TransferRecord,
    TransferWindow,
    format_duration,
    format_inr,
    make_factor,
    unique,
)

CODE = "R-CIRC"


def ordered_legs(
    cycle: list[str], edges: dict[tuple[str, str], list[TransferRecord]], window: timedelta
) -> list[TransferRecord] | None:
    """Pick one transfer per edge so money moves around the loop in time order, minimising the span."""
    best: list[TransferRecord] | None = None
    k = len(cycle)
    for start in range(k):
        nodes = cycle[start:] + cycle[:start]
        path = [(nodes[i], nodes[(i + 1) % k]) for i in range(k)]
        for first in edges[path[0]]:
            legs = [first]
            for edge in path[1:]:
                used = {x.tx_id for x in legs}
                nxt = next((t for t in edges[edge] if t.ts >= legs[-1].ts and t.tx_id not in used), None)
                if nxt is None:
                    break
                legs.append(nxt)
            if len(legs) != k or legs[-1].ts - legs[0].ts > window:
                continue
            if best is None or legs[-1].ts - legs[0].ts < best[-1].ts - best[0].ts:
                best = legs
    return best


def _amount_factor(total: Decimal, history: list[Decimal], cfg: RuleConfig) -> tuple[str, float, float | None]:
    if len(history) < cfg.params["history_min"]:
        return "no baseline", 0.5, None
    p95 = Decimal(str(statistics.quantiles([float(a) for a in history], n=20, method="inclusive")[18]))
    ratio = float(total / p95) if p95 > 0 else 10.0
    return f"{ratio:.1f}x p95", math.log10(ratio) if ratio > 1 else 0.0, ratio


def _velocity_factor(accounts: list[str], span: timedelta, window: TransferWindow) -> tuple[str, float]:
    baselines = [window.accounts[a].baseline_30d_count for a in accounts if a in window.accounts]
    mean_30d = sum(baselines) / len(baselines) if baselines else 0
    if mean_30d <= 0:
        return "no baseline", 0.5
    rate = 1 / max(span.total_seconds() / 3600, 1.0)
    baseline_rate = mean_30d / (30 * 24)
    ratio = rate / baseline_rate
    return f"{ratio:.1f}x baseline", math.log10(ratio) if ratio > 1 else 0.0


def detect_cycles(window: TransferWindow, cfg: RuleConfig) -> list[Hit]:
    p = cfg.params
    horizon = timedelta(hours=p["window_hours"])
    min_amount = Decimal(str(p["min_cycle_amount"]))
    edges: dict[tuple[str, str], list[TransferRecord]] = defaultdict(list)
    for t in window.transfers:
        if t.from_acct and t.to_acct and t.from_acct != t.to_acct:
            edges[(t.from_acct, t.to_acct)].append(t)
    for legs in edges.values():
        legs.sort(key=lambda t: t.ts)

    graph = nx.DiGraph(list(edges))
    hits: list[Hit] = []
    seen: set[frozenset[str]] = set()
    for cycle in nx.simple_cycles(graph, length_bound=p["max_length"]):
        if len(cycle) < p["min_length"]:
            continue
        legs = ordered_legs(cycle, edges, horizon)
        if legs is None:
            continue
        key = frozenset(t.tx_id for t in legs)
        total = sum((t.amount for t in legs), Decimal(0))
        if key in seen or total < min_amount:
            continue
        seen.add(key)
        hits.append(_build_hit(legs, total, window, cfg))
    return hits


def _build_hit(legs: list[TransferRecord], total: Decimal, window: TransferWindow, cfg: RuleConfig) -> Hit:
    w = cfg.weights
    k = len(legs)
    accounts = [t.from_acct for t in legs if t.from_acct]
    span = legs[-1].ts - legs[0].ts
    horizon_h = cfg.params["window_hours"]
    loop_ids = {t.tx_id for t in legs}
    history = [t.amount for t in window.transfers if t.tx_id not in loop_ids]

    amount_raw, amount_norm, ratio = _amount_factor(total, history, cfg)
    velocity_raw, velocity_norm = _velocity_factor(accounts, span, window)
    factors = [
        make_factor("linkage_depth", f"{k} hops", w["linkage_depth"], 1.0 - 0.1 * (k - 3)),
        make_factor("amount", amount_raw, w["amount"], amount_norm),
        make_factor(
            "temporal_proximity",
            f"{format_duration(span)} of {horizon_h}h window",
            w["temporal_proximity"],
            1.0 - span / timedelta(hours=horizon_h),
        ),
        make_factor("account_velocity", velocity_raw, w["account_velocity"], velocity_norm),
    ]
    route = " → ".join([*accounts, accounts[0]])
    comparison = (
        f" Amount is {ratio:.1f}× the p95 of other transfers in the window."
        if ratio is not None
        else " There is too little transfer history in the window to compare the amount against."
    )
    explanation = (
        f"{format_inr(total)} moved in a loop across {k} accounts within {format_duration(span)}: {route}. "
        f"Loop transfers: {', '.join(t.tx_id for t in legs)}.{comparison}"
    )
    return Hit(
        pattern_code=CODE,
        title=f"Circular transfer across {k} accounts",
        entity_ids=unique([*accounts, *(window.customer_of(a) for a in accounts)]),
        factors=factors,
        evidence_refs=[("transaction", t.tx_id) for t in legs],
        window_start=legs[0].ts,
        window_end=legs[-1].ts,
        explanation=explanation,
    )


class CircularTransferRule:
    code = CODE

    def evaluate(self, ctx: RuleContext) -> list[Hit]:
        return detect_cycles(ctx.transfers, ctx.config(CODE))
