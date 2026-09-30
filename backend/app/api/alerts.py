from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Numeric, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.api.graph import _ensure_graph
from app.auth.deps import CurrentUser, get_current_user, not_found, require_role
from app.db import get_db
from app.graph.service import graph_service
from app.models import Alert, AlertEvidence, Case, CaseAlert
from app.services.timeline import decode_cursor, encode_cursor

router = APIRouter(prefix="/alerts", tags=["alerts"])
act_role = require_role("admin", "manager", "investigator")

BANDS = {"low", "medium", "high", "critical"}
STATUSES = {"open", "acknowledged", "linked_to_case", "resolved", "closed_confirmed", "closed_false_positive"}
LINKABLE = {"open", "acknowledged", "linked_to_case"}
GRAPH_NODE_CAP = 50


class AlertRow(BaseModel):
    id: str
    rule_code: str
    title: str
    risk_band: str
    risk_score: int
    status: str
    entity_ids: list[str]
    primary_entity: str | None
    amount_total: str | None = None
    detected_at: datetime
    occurrence_count: int


class AlertPage(BaseModel):
    items: list[AlertRow]
    next_cursor: str | None


class Evidence(BaseModel):
    evidence_type: str
    ref_id: str
    snapshot: dict[str, Any]
    captured_at: datetime


class AlertDetail(AlertRow):
    rule_version: int
    explanation: str
    risk_factors: list[dict[str, Any]]
    window_start: datetime
    window_end: datetime
    updated_at: datetime
    evidence: list[Evidence]
    linked_case_id: str | None


class LinkCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: str


def _csv(value: str | None, allowed: set[str], name: str) -> list[str]:
    if not value:
        return []
    items = [v.strip() for v in value.split(",") if v.strip()]
    unknown = [v for v in items if v not in allowed]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"unknown {name}: {', '.join(unknown)}")
    return items


def _amount_total():
    return (
        select(func.sum(AlertEvidence.snapshot["amount"].astext.cast(Numeric(18, 2))))
        .where(AlertEvidence.alert_id == Alert.id, AlertEvidence.evidence_type == "transaction")
        .correlate(Alert)
        .scalar_subquery()
    )


def _row(alert: Alert, amount: Decimal | None) -> dict[str, Any]:
    return {
        "id": alert.id,
        "rule_code": alert.rule_code,
        "title": alert.title,
        "risk_band": alert.risk_band,
        "risk_score": alert.risk_score,
        "status": alert.status,
        "entity_ids": list(alert.entity_ids),
        "primary_entity": alert.entity_ids[0] if alert.entity_ids else None,
        "amount_total": str(amount) if amount is not None else None,
        "detected_at": alert.detected_at,
        "occurrence_count": alert.occurrence_count,
    }


async def _owned(db: AsyncSession, tenant_id: str, alert_id: str, lock: bool = False) -> Alert:
    stmt = select(Alert).where(Alert.id == alert_id, Alert.tenant_id == tenant_id)
    alert = await db.scalar(stmt.with_for_update() if lock else stmt)
    if alert is None:
        raise not_found("alert")
    return alert


@router.get("", response_model=AlertPage)
async def list_alerts(
    band: str | None = None,
    rule: str | None = None,
    status_: str | None = Query(None, alias="status"),
    entity: str | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlertPage:
    clauses = [Alert.tenant_id == user.tenant_id]
    if bands := _csv(band, BANDS, "band"):
        clauses.append(Alert.risk_band.in_(bands))
    if rule:
        clauses.append(Alert.rule_code.in_([r.strip() for r in rule.split(",") if r.strip()]))
    if statuses := _csv(status_, STATUSES, "status"):
        clauses.append(Alert.status.in_(statuses))
    if entity:
        clauses.append(Alert.entity_ids.contains([entity]))
    if from_:
        clauses.append(Alert.detected_at >= from_)
    if to:
        clauses.append(Alert.detected_at <= to)
    if cursor:
        try:
            ts, ref = decode_cursor(cursor)
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid cursor") from None
        clauses.append(or_(Alert.detected_at < ts, and_(Alert.detected_at == ts, Alert.id < ref)))
    rows = (await db.execute(select(Alert, _amount_total()).where(*clauses).order_by(Alert.detected_at.desc(), Alert.id.desc()).limit(limit + 1))).all()
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1][0].detected_at, page[-1][0].id) if len(rows) > limit else None
    return AlertPage(items=[AlertRow(**_row(a, amt)) for a, amt in page], next_cursor=next_cursor)


async def _detail(db: AsyncSession, alert: Alert) -> AlertDetail:
    evidence = (
        await db.scalars(select(AlertEvidence).where(AlertEvidence.alert_id == alert.id).order_by(AlertEvidence.evidence_type, AlertEvidence.ref_id))
    ).all()
    amount = sum((Decimal(str(e.snapshot["amount"])) for e in evidence if e.evidence_type == "transaction" and "amount" in e.snapshot), Decimal(0))
    linked = await db.scalar(select(CaseAlert.case_id).where(CaseAlert.alert_id == alert.id).order_by(CaseAlert.linked_at.desc()).limit(1))
    return AlertDetail(
        **_row(alert, amount if any(e.evidence_type == "transaction" for e in evidence) else None),
        rule_version=alert.rule_version,
        explanation=alert.explanation,
        risk_factors=list(alert.risk_factors),
        window_start=alert.window_start,
        window_end=alert.window_end,
        updated_at=alert.updated_at,
        evidence=[Evidence(evidence_type=e.evidence_type, ref_id=e.ref_id, snapshot=e.snapshot, captured_at=e.captured_at) for e in evidence],
        linked_case_id=linked,
    )


@router.get("/{alert_id}", response_model=AlertDetail)
async def get_alert(alert_id: str, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> AlertDetail:
    return await _detail(db, await _owned(db, user.tenant_id, alert_id))


@router.post("/{alert_id}/acknowledge", response_model=AlertDetail)
async def acknowledge(alert_id: str, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> AlertDetail:
    alert = await _owned(db, user.tenant_id, alert_id, lock=True)
    if alert.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"only an open alert can be acknowledged; this one is {alert.status}")
    alert.status, alert.updated_at = "acknowledged", func.now()
    audit.log(db, user.tenant_id, "alert.ack", actor_user=user.id, object_type="alert", object_id=alert.id, detail={"from": "open", "to": "acknowledged"})
    await db.commit()
    await db.refresh(alert)
    return await _detail(db, alert)


@router.post("/{alert_id}/link-case", response_model=AlertDetail)
async def link_case(alert_id: str, body: LinkCase, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> AlertDetail:
    alert = await _owned(db, user.tenant_id, alert_id, lock=True)
    case = await db.scalar(select(Case).where(Case.id == body.case_id, Case.tenant_id == user.tenant_id))
    if case is None:
        raise not_found("case")
    if alert.status not in LINKABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"a {alert.status} alert cannot be linked to a case")
    if case.status.startswith("closed"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="a closed case cannot take new alerts")
    exists = await db.scalar(select(CaseAlert.case_id).where(CaseAlert.case_id == case.id, CaseAlert.alert_id == alert.id))
    if exists is None:
        db.add(CaseAlert(case_id=case.id, alert_id=alert.id, linked_by=user.id))
    previous = alert.status
    alert.status, alert.updated_at = "linked_to_case", func.now()
    audit.log(
        db,
        user.tenant_id,
        "alert.link",
        actor_user=user.id,
        object_type="alert",
        object_id=alert.id,
        detail={"case_id": case.id, "from": previous, "to": "linked_to_case"},
    )
    await db.commit()
    await db.refresh(alert)
    return await _detail(db, alert)


@router.get("/{alert_id}/graph")
async def alert_graph(alert_id: str, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """The alert's entities plus their direct TRANSFER neighbours, capped at 50 nodes, as ReactFlow-ready JSON."""
    alert = await _owned(db, user.tenant_id, alert_id)
    await _ensure_graph(db, user.tenant_id)
    g = graph_service.graph(user.tenant_id)
    nodes = [e for e in alert.entity_ids if e in g]
    seen = set(nodes)
    for node in list(nodes):
        for u, v, data in [*g.out_edges(node, data=True), *g.in_edges(node, data=True)]:
            other = v if u == node else u
            if data.get("type") == "TRANSFER" and other not in seen and len(seen) < GRAPH_NODE_CAP:
                seen.add(other)
                nodes.append(other)
    return {**graph_service.subgraph(user.tenant_id, nodes), "truncated": len(seen) >= GRAPH_NODE_CAP}
