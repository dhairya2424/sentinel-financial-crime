"""Turn rule hits into alerts: group, dedup, freeze evidence (ADR-004), describe the change for publishing.

Hits that share an entity describe one situation, so they become one alert whose risk is the max-merged
factor set (docs/02 §4.5). The alert is keyed by rule + sorted entities + the rule window floor (docs/02 §3).
Re-detecting evidence the alert already holds changes nothing, so replays and nearby unrelated events never
inflate `occurrence_count`; only new evidence counts as a new occurrence.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.detection.base import EvidenceRef, Factor, Hit, RuleConfig
from app.detection.engine import ORDER
from app.ids import new_id
from app.models import AccessRight, Alert, AlertEvidence, EmployeeAction, EmployeeSession, Transaction
from app.risk.explain import aggregate_factors, compose_explanation
from app.serialize import row_to_dict

ACTIVE_STATUSES = ("open", "acknowledged")
EVIDENCE_MODELS: dict[str, Any] = {
    "transaction": Transaction,
    "employee_action": EmployeeAction,
    "access_right": AccessRight,
    "session": EmployeeSession,
}
WINDOW_PARAMS = ("window_hours", "correlation_window_hours", "revocation_window_hours")


@dataclass
class AlertChange:
    alert: Alert
    created: bool


def rule_window_hours(code: str, configs: dict[str, RuleConfig]) -> int:
    params = configs[code].params if code in configs else {}
    return int(next((params[p] for p in WINDOW_PARAMS if p in params), 24))


def floor_ts(ts: datetime, hours: int) -> datetime:
    step = hours * 3600
    return datetime.fromtimestamp(int(ts.timestamp()) // step * step, tz=UTC)


def group_hits(hits: list[Hit]) -> list[list[Hit]]:
    """Connected components of hits by shared entity ids."""
    groups: list[tuple[set[str], list[Hit]]] = []
    for hit in hits:
        entities = set(hit.entity_ids)
        joined = [g for g in groups if g[0] & entities]
        merged_entities, merged_hits = entities, [hit]
        for g in joined:
            merged_entities |= g[0]
            merged_hits = [*g[1], *merged_hits]
            groups.remove(g)
        groups.append((merged_entities, merged_hits))
    return [g[1] for g in groups]


def _primary(group: list[Hit]) -> Hit:
    return max(group, key=lambda h: (h.score, -ORDER.index(h.pattern_code) if h.pattern_code in ORDER else -99))


def _unique_refs(group: list[Hit]) -> list[EvidenceRef]:
    seen: dict[EvidenceRef, None] = {}
    for hit in group:
        for ref in hit.evidence_refs:
            seen.setdefault(ref, None)
    return list(seen)


def _factors_from_json(items: list[dict]) -> list[Factor]:
    return [Factor(str(f["name"]), str(f["raw_value"]), float(f["weight"]), float(f["contribution"]), bool(f.get("imputed", False))) for f in items]


def _as_hit(factors: list[Factor], template: Hit) -> Hit:
    return Hit(template.pattern_code, template.title, template.entity_ids, factors, [], template.window_start, template.window_end, "")


async def _snapshots(db: AsyncSession, tenant_id: str, refs: list[EvidenceRef]) -> list[tuple[str, str, dict]]:
    """Frozen copies of each evidence source row. A ref whose row is gone cannot be evidenced and is dropped."""
    by_type: dict[str, list[str]] = {}
    for kind, ref in refs:
        by_type.setdefault(kind, []).append(ref)
    out = []
    for kind, ids in by_type.items():
        model = EVIDENCE_MODELS[kind]
        rows = {r.id: r for r in await db.scalars(select(model).where(model.tenant_id == tenant_id, model.id.in_(ids)))}
        out.extend((kind, ref, row_to_dict(rows[ref])) for ref in ids if ref in rows)
    return out


async def _add_evidence(db: AsyncSession, tenant_id: str, alert_id: str, refs: list[EvidenceRef]) -> int:
    snaps = await _snapshots(db, tenant_id, refs)
    if not snaps:
        return 0
    stmt = (
        insert(AlertEvidence)
        .values([{"id": new_id("ev"), "tenant_id": tenant_id, "alert_id": alert_id, "evidence_type": k, "ref_id": r, "snapshot": s} for k, r, s in snaps])
        .on_conflict_do_nothing(constraint="alert_evidence_alert_id_evidence_type_ref_id_key")
    )
    return (await db.execute(stmt)).rowcount or 0


async def _find_existing(
    db: AsyncSession, tenant_id: str, codes: list[str], key: str, entity_ids: list[str], refs: list[EvidenceRef], start: datetime, hours: int
) -> Alert | None:
    alert = await db.scalar(select(Alert).where(Alert.tenant_id == tenant_id, Alert.dedup_key == key).with_for_update())
    if alert is not None:
        return alert
    # The same situation is still the same alert while it is active: across a window-floor boundary, and when another
    # event sees it from a different angle (the approval's view adds the login, the loop's view adds the teller).
    # Hits that share an entity within one rule window extend that alert when they carry one of its rules or re-find
    # evidence it already holds.
    holds_evidence = select(AlertEvidence.alert_id).where(AlertEvidence.tenant_id == tenant_id, AlertEvidence.ref_id.in_([r for _, r in refs]))
    return await db.scalar(
        select(Alert)
        .where(
            Alert.tenant_id == tenant_id,
            or_(Alert.rule_code.in_(codes), Alert.id.in_(holds_evidence)),
            Alert.entity_ids.overlap(entity_ids),
            Alert.status.in_(ACTIVE_STATUSES),
            Alert.window_end >= start - timedelta(hours=hours),
        )
        .order_by((Alert.entity_ids == entity_ids).desc(), Alert.detected_at.desc())
        .limit(1)
        .with_for_update()
    )


async def persist_group(db: AsyncSession, tenant_id: str, group: list[Hit], configs: dict[str, RuleConfig]) -> AlertChange | None:
    """Create or extend the alert for one group of hits inside the caller's transaction. None when nothing changed."""
    primary = _primary(group)
    code = primary.pattern_code
    entity_ids = sorted({e for h in group for e in h.entity_ids})
    refs = _unique_refs(group)
    start = min(h.window_start for h in group)
    end = max(h.window_end for h in group)
    hours = rule_window_hours(code, configs)
    key = f"{code}:{','.join(entity_ids)}:{floor_ts(end, hours).isoformat()}"
    now = datetime.now(UTC)

    codes = sorted({h.pattern_code for h in group})
    existing = await _find_existing(db, tenant_id, codes, key, entity_ids, refs, start, hours)
    if existing is None:
        score, band, factors = aggregate_factors(group)
        alert_id = new_id("alert")
        inserted = await db.execute(
            insert(Alert)
            .values(
                id=alert_id,
                tenant_id=tenant_id,
                rule_code=code,
                rule_version=configs[code].version if code in configs else 0,
                title=primary.title,
                explanation=compose_explanation(group),
                risk_score=score,
                risk_band=band,
                risk_factors=[f.as_dict() for f in factors],
                entity_ids=entity_ids,
                window_start=start,
                window_end=end,
                dedup_key=key,
                detected_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(constraint="alerts_tenant_id_dedup_key_key")
            .returning(Alert.id)
        )
        if inserted.scalar() is not None:
            await _add_evidence(db, tenant_id, alert_id, refs)
            return AlertChange(await db.get(Alert, alert_id), created=True)
        existing = await _find_existing(db, tenant_id, codes, key, entity_ids, refs, start, hours)
        if existing is None:
            return None

    if existing.status not in ACTIVE_STATUSES:
        return None
    held = set((await db.execute(select(AlertEvidence.evidence_type, AlertEvidence.ref_id).where(AlertEvidence.alert_id == existing.id))).all())
    fresh = [r for r in refs if r not in held]
    if not fresh or await _add_evidence(db, tenant_id, existing.id, fresh) == 0:
        return None
    score, band, factors = aggregate_factors([_as_hit(_factors_from_json(existing.risk_factors), primary), *group])
    existing.occurrence_count += 1
    existing.entity_ids = sorted(set(existing.entity_ids) | set(entity_ids))
    existing.window_start = min(existing.window_start, start)
    existing.window_end = max(existing.window_end, end)
    existing.risk_score, existing.risk_band = score, band
    existing.risk_factors = [f.as_dict() for f in factors]
    existing.explanation = compose_explanation(group)
    existing.updated_at = now
    await db.flush()
    return AlertChange(existing, created=False)


def alert_message(tenant_id: str, change: AlertChange) -> dict[str, Any]:
    a = change.alert
    return {
        "channel": f"alerts:{tenant_id}",
        "type": "alert.created" if change.created else "alert.updated",
        "data": {
            "id": a.id,
            "rule_code": a.rule_code,
            "title": a.title,
            "risk_band": a.risk_band,
            "risk_score": a.risk_score,
            "entity_ids": list(a.entity_ids),
            "detected_at": a.detected_at.isoformat(),
            "occurrence_count": a.occurrence_count,
        },
    }
