from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from app.detection.base import EvidenceRef, Factor, Hit, RuleContext, unique
from app.detection.r_circ import CircularTransferRule
from app.detection.r_profile import EditThenFlowRule, RoleMismatchRule
from app.detection.r_struct import StructuringRule
from app.detection.supporting import SupportSignal, dormant_signals, offhours_signals, velocity_signals

TRANSFER_RULES = {"R-CIRC": CircularTransferRule(), "R-STRUCT": StructuringRule()}
ACTION_RULES = {"R-PROFILE_ROLE": RoleMismatchRule(), "R-PROFILE_FLOW": EditThenFlowRule()}

EVENT_RULES = {
    "transaction": ("R-CIRC", "R-STRUCT", "R-PROFILE_FLOW", "R-VELOCITY", "R-DORMANT"),
    "employee_action": ("R-PROFILE_ROLE", "R-PROFILE_FLOW", "R-OFFHOURS"),
    "access_right": ("R-PROFILE_ROLE",),
    "session": ("R-OFFHOURS",),
}
ORDER = ("R-CIRC", "R-STRUCT", "R-PROFILE_ROLE", "R-PROFILE_FLOW", "R-VELOCITY", "R-OFFHOURS", "R-DORMANT")
SUPPORT_TITLES = {
    "R-VELOCITY": "Unusual transfer velocity",
    "R-OFFHOURS": "Off-hours employee activity",
    "R-DORMANT": "Dormant account reactivated",
}


@dataclass
class DetectionResult:
    hits: list[Hit] = field(default_factory=list)
    signals: list[SupportSignal] = field(default_factory=list)


def select_rules(entity_ids: Iterable[str], events: Iterable[str]) -> list[str]:
    """Rules worth running for the event kinds touching these entities; nothing runs without entities."""
    if not list(entity_ids):
        return []
    wanted = {code for kind in events for code in EVENT_RULES.get(kind, ())}
    return [code for code in ORDER if code in wanted]


def run_rules(ctx: RuleContext, codes: Iterable[str]) -> DetectionResult:
    selected = {c for c in codes if ctx.config(c).enabled}
    result = DetectionResult()
    for code, rule in TRANSFER_RULES.items():
        if code in selected:
            found = rule.evaluate(ctx)
            result.hits.extend(found)
            ctx.flagged_tx_ids.update(ref for hit in found for kind, ref in hit.evidence_refs if kind == "transaction")
    for code, rule in ACTION_RULES.items():
        if code in selected:
            result.hits.extend(rule.evaluate(ctx))
    if "R-VELOCITY" in selected:
        result.signals.extend(velocity_signals(ctx.transfers, ctx.config("R-VELOCITY")))
    if "R-OFFHOURS" in selected:
        result.signals.extend(offhours_signals(ctx.actions, ctx.config("R-OFFHOURS"), ctx.tz))
    if "R-DORMANT" in selected:
        result.signals.extend(dormant_signals(ctx.transfers, ctx.config("R-DORMANT")))
    return result


def _with_factor(factors: list[Factor], extra: Factor) -> list[Factor]:
    merged = {f.name: f for f in factors}
    current = merged.get(extra.name)
    if current is None or extra.contribution > current.contribution:
        merged[extra.name] = extra
    return list(merged.values())


def _unique_refs(refs: Iterable[EvidenceRef]) -> list[EvidenceRef]:
    seen: dict[EvidenceRef, None] = {}
    for ref in refs:
        seen.setdefault(ref, None)
    return list(seen)


def merge_hits_with_supporting(hits: list[Hit], signals: list[SupportSignal], standalone_min_score: int = 60) -> list[Hit]:
    """Attach supporting factors to primary hits on shared entities. Signals that attach nowhere become
    a standalone alert only when their combined composite reaches the standalone minimum (default 60)."""
    attached: set[int] = set()
    for hit in hits:
        entities = set(hit.entity_ids)
        for i, signal in enumerate(signals):
            if entities & set(signal.entity_ids):
                hit.factors = _with_factor(hit.factors, signal.factor)
                hit.evidence_refs = _unique_refs([*hit.evidence_refs, *signal.evidence_refs])
                hit.explanation = f"{hit.explanation} {signal.explanation}"
                attached.add(i)

    groups: list[list[SupportSignal]] = []
    for i, signal in enumerate(signals):
        if i in attached:
            continue
        home = next((g for g in groups if any(set(s.entity_ids) & set(signal.entity_ids) for s in g)), None)
        if home is None:
            groups.append([signal])
        else:
            home.append(signal)

    standalone = []
    for group in groups:
        factors: list[Factor] = []
        for signal in group:
            factors = _with_factor(factors, signal.factor)
        if round(sum(f.contribution for f in factors) * 100) < standalone_min_score:
            continue
        lead = max(group, key=lambda s: s.factor.contribution)
        standalone.append(
            Hit(
                pattern_code=lead.code,
                title=SUPPORT_TITLES[lead.code],
                entity_ids=unique([e for s in group for e in s.entity_ids]),
                factors=factors,
                evidence_refs=_unique_refs(r for s in group for r in s.evidence_refs),
                window_start=min(s.window_start for s in group),
                window_end=max(s.window_end for s in group),
                explanation=" ".join(s.explanation for s in sorted(group, key=lambda s: -s.factor.contribution)),
            )
        )
    return [*hits, *standalone]


def detect(ctx: RuleContext, entity_ids: Iterable[str], events: Iterable[str]) -> list[Hit]:
    result = run_rules(ctx, select_rules(entity_ids, events))
    min_score = min(ctx.config(c).params.get("standalone_min_score", 60) for c in ("R-VELOCITY", "R-OFFHOURS", "R-DORMANT"))
    return merge_hits_with_supporting(result.hits, result.signals, min_score)
