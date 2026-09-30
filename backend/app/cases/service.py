"""Case management (PRD Epic D, docs/04 §6, docs/08 §4-§5).

A case gathers alerts for one investigation. Linking moves each alert to `linked_to_case`. Closing a case needs a
disposition note and carries the verdict to every linked alert. Every change is audited, then announced on
`cases:{tenant}` (and `alerts:{tenant}` for alerts whose status moved), so queues and the inbox update live.
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Integer, and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.api.alerts import _amount_total, _entities, _labels, _row
from app.auth.deps import CurrentUser, not_found
from app.ids import new_id
from app.models import Alert, AuditLog, Case, CaseAlert, CaseNote, User
from app.redis_client import redis
from app.services.timeline import decode_cursor, encode_cursor

OPEN_STATES = ("open", "in_review", "escalated")
CLOSED_STATES = ("closed_confirmed", "closed_false_positive")
PRIORITIES = ("low", "medium", "high", "critical")
# docs/04 §6: forward only; any open state may close, a closed case is final.
TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_review", *CLOSED_STATES},
    "in_review": {"escalated", *CLOSED_STATES},
    "escalated": set(CLOSED_STATES),
    "closed_confirmed": set(),
    "closed_false_positive": set(),
}
GROUPABLE = ("open", "acknowledged")
GROUP_CAP = 50
CLOSE_NOTE_MIN = 10
MANAGERS = ("manager", "admin")
BAND_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, detail=detail)


async def _case(db: AsyncSession, tenant_id: str, case_id: str, lock: bool = False) -> Case:
    stmt = select(Case).where(Case.id == case_id, Case.tenant_id == tenant_id)
    case = await db.scalar(stmt.with_for_update() if lock else stmt)
    if case is None:
        raise not_found("case")
    return case


def _require_involved(user: CurrentUser, case: Case, what: str) -> None:
    """docs/08 §4: investigators change only cases they opened or hold; managers and admins change any."""
    if user.role not in MANAGERS and user.id not in (case.created_by, case.assignee_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=f"only the case's creator, its assignee or a manager can {what}")


def _require_open(case: Case) -> None:
    if case.status in CLOSED_STATES:
        raise _conflict(f"case {case.case_number} is closed and can no longer change")


async def _next_number(db: AsyncSession, tenant_id: str) -> str:
    """CASE-<year>-<4-digit sequence per tenant and year>, serialised per tenant by a transaction advisory lock."""
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"case_number:{tenant_id}"))))
    prefix = f"CASE-{datetime.now(UTC).year}-"
    last = await db.scalar(
        select(func.max(func.cast(func.substr(Case.case_number, len(prefix) + 1), Integer))).where(
            Case.tenant_id == tenant_id, Case.case_number.like(f"{prefix}%")
        )
    )
    return f"{prefix}{(last or 0) + 1:04d}"


async def _alerts_to_link(db: AsyncSession, tenant_id: str, alert_ids: list[str], group: bool) -> list[Alert]:
    wanted = list(dict.fromkeys(alert_ids))
    found = {a.id: a for a in await db.scalars(select(Alert).where(Alert.tenant_id == tenant_id, Alert.id.in_(wanted)).with_for_update())}
    missing = [i for i in wanted if i not in found]
    if missing:
        raise not_found(f"alert {missing[0]}")
    blocked = [a for a in found.values() if a.status not in GROUPABLE]
    if blocked:
        a = blocked[0]
        raise _conflict(f"alert {a.id} is {a.status}; only open or acknowledged alerts can start a case")
    chosen = [found[i] for i in wanted]
    if group and chosen:
        entities = sorted({e for a in chosen for e in a.entity_ids})
        stmt = (
            select(Alert)
            .where(Alert.tenant_id == tenant_id, Alert.status.in_(GROUPABLE), Alert.entity_ids.overlap(entities), Alert.id.not_in(wanted))
            .order_by(Alert.detected_at.desc(), Alert.id.desc())
            .limit(max(0, GROUP_CAP - len(chosen)))
            .with_for_update()
        )
        chosen += list(await db.scalars(stmt))
    return chosen[:GROUP_CAP]


def case_message(tenant_id: str, case: Case) -> dict[str, Any]:
    return {
        "channel": f"cases:{tenant_id}",
        "type": "case.updated",
        "data": {"id": case.id, "status": case.status, "assignee_id": case.assignee_id, "updated_at": case.updated_at.isoformat()},
    }


def alert_status_message(tenant_id: str, alert: Alert) -> dict[str, Any]:
    """The alert.updated shape the pipeline sends (docs/05 §5), plus the new status, so the inbox needs no new type."""
    return {
        "channel": f"alerts:{tenant_id}",
        "type": "alert.updated",
        "data": {
            "id": alert.id,
            "rule_code": alert.rule_code,
            "title": alert.title,
            "risk_band": alert.risk_band,
            "risk_score": alert.risk_score,
            "status": alert.status,
            "entity_ids": list(alert.entity_ids),
            "detected_at": alert.detected_at.isoformat(),
            "occurrence_count": alert.occurrence_count,
        },
    }


async def announce(tenant_id: str, case: Case, alerts: list[Alert] | None = None) -> None:
    """Best effort after commit: a Redis hiccup must not turn a saved change into an error."""
    try:
        await redis.publish(f"cases:{tenant_id}", json.dumps(case_message(tenant_id, case)))
        for alert in alerts or []:
            await redis.publish(f"alerts:{tenant_id}", json.dumps(alert_status_message(tenant_id, alert)))
    except Exception:  # noqa: BLE001, S110 - the change is committed; clients also refetch on reconnect
        pass


async def create_case(
    db: AsyncSession,
    user: CurrentUser,
    *,
    title: str,
    priority: str | None = None,
    description: str | None = None,
    alert_ids: list[str] | None = None,
    group_by_entities: bool = False,
) -> tuple[Case, list[Alert]]:
    t = user.tenant_id
    alerts = await _alerts_to_link(db, t, alert_ids or [], group_by_entities)
    if priority is None:
        # Unset priority follows the most serious linked alert; a case with no alerts starts at medium.
        priority = PRIORITIES[max((BAND_RANK[a.risk_band] for a in alerts), default=BAND_RANK["medium"])]
    case = Case(
        id=new_id("case"),
        tenant_id=t,
        case_number=await _next_number(db, t),
        title=title,
        description=description,
        priority=priority,
        created_by=user.id,
    )
    db.add(case)
    await db.flush()
    for alert in alerts:
        db.add(CaseAlert(case_id=case.id, alert_id=alert.id, linked_by=user.id))
        audit.log(
            db, t, "alert.link", actor_user=user.id, object_type="alert", object_id=alert.id, detail={"case_id": case.id, "from": alert.status, "to": "linked_to_case"}
        )
        alert.status, alert.updated_at = "linked_to_case", func.now()
    audit.log(
        db,
        t,
        "case.create",
        actor_user=user.id,
        object_type="case",
        object_id=case.id,
        detail={"case_number": case.case_number, "priority": priority, "alert_ids": [a.id for a in alerts], "grouped": group_by_entities},
    )
    await db.commit()
    await db.refresh(case)
    for alert in alerts:
        await db.refresh(alert)
    return case, alerts


def case_row(case: Case) -> dict[str, Any]:
    return {
        "id": case.id,
        "case_number": case.case_number,
        "title": case.title,
        "description": case.description,
        "priority": case.priority,
        "status": case.status,
        "assignee_id": case.assignee_id,
        "created_by": case.created_by,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "closed_at": case.closed_at,
        "export_digest": case.export_digest,
    }


async def list_cases(
    db: AsyncSession, tenant_id: str, *, statuses: list[str], assignee: str | None, cursor: str | None, limit: int
) -> tuple[list[dict[str, Any]], str | None]:
    alert_count = select(func.count()).select_from(CaseAlert).where(CaseAlert.case_id == Case.id).correlate(Case).scalar_subquery()
    top_band = (
        select(func.max(func.array_position(text("ARRAY['low','medium','high','critical']"), Alert.risk_band)))
        .select_from(CaseAlert)
        .join(Alert, Alert.id == CaseAlert.alert_id)
        .where(CaseAlert.case_id == Case.id)
        .correlate(Case)
        .scalar_subquery()
    )
    clauses = [Case.tenant_id == tenant_id]
    if statuses:
        clauses.append(Case.status.in_(statuses))
    if assignee == "none":
        clauses.append(Case.assignee_id.is_(None))
    elif assignee:
        clauses.append(Case.assignee_id == assignee)
    if cursor:
        try:
            ts, ref = decode_cursor(cursor)
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid cursor") from None
        clauses.append(or_(Case.updated_at < ts, and_(Case.updated_at == ts, Case.id < ref)))
    stmt = (
        select(Case, alert_count, top_band, User.full_name)
        .outerjoin(User, User.id == Case.assignee_id)
        .where(*clauses)
        .order_by(Case.updated_at.desc(), Case.id.desc())
        .limit(limit + 1)
    )
    rows = (await db.execute(stmt)).all()
    page = rows[:limit]
    items = [{**case_row(c), "alert_count": n, "top_band": PRIORITIES[b - 1] if b else None, "assignee_name": name} for c, n, b, name in page]
    next_cursor = encode_cursor(page[-1][0].updated_at, page[-1][0].id) if len(rows) > limit else None
    return items, next_cursor


async def _names(db: AsyncSession, tenant_id: str, ids: set[str | None]) -> dict[str, str]:
    wanted = [i for i in ids if i]
    if not wanted:
        return {}
    return dict((await db.execute(select(User.id, User.full_name).where(User.tenant_id == tenant_id, User.id.in_(wanted)))).all())


async def linked_alerts(db: AsyncSession, tenant_id: str, case_id: str) -> list[Alert]:
    stmt = (
        select(Alert)
        .join(CaseAlert, CaseAlert.alert_id == Alert.id)
        .where(CaseAlert.case_id == case_id, Alert.tenant_id == tenant_id)
        .order_by(Alert.detected_at.desc(), Alert.id.desc())
    )
    return list(await db.scalars(stmt))


async def case_audit(db: AsyncSession, tenant_id: str, case_id: str, alert_ids: list[str], *, include_exports: bool = True) -> list[dict[str, Any]]:
    """The decision history: every audit row on the case and on its alerts, oldest first."""
    scope = or_(and_(AuditLog.object_type == "case", AuditLog.object_id == case_id), and_(AuditLog.object_type == "alert", AuditLog.object_id.in_(alert_ids)))
    clauses = [AuditLog.tenant_id == tenant_id, scope]
    if not include_exports:
        clauses.append(AuditLog.action != "case.export")
    rows = list(await db.scalars(select(AuditLog).where(*clauses).order_by(AuditLog.created_at, AuditLog.id)))
    names = await _names(db, tenant_id, {r.actor_user for r in rows})
    return [
        {
            "id": r.id,
            "at": r.created_at,
            "actor_user": r.actor_user,
            "actor_name": names.get(r.actor_user or ""),
            "actor_kind": r.actor_kind,
            "action": r.action,
            "object_type": r.object_type,
            "object_id": r.object_id,
            "detail": r.detail,
        }
        for r in rows
    ]


async def case_notes(db: AsyncSession, tenant_id: str, case_id: str) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(CaseNote, User.full_name)
            .outerjoin(User, User.id == CaseNote.author_id)
            .where(CaseNote.case_id == case_id, CaseNote.tenant_id == tenant_id)
            .order_by(CaseNote.created_at, CaseNote.id)
        )
    ).all()
    return [{"id": n.id, "author_id": n.author_id, "author_name": name, "body": n.body, "created_at": n.created_at} for n, name in rows]


async def get_case(db: AsyncSession, tenant_id: str, case_id: str) -> dict[str, Any]:
    case = await _case(db, tenant_id, case_id)
    alerts = await linked_alerts(db, tenant_id, case.id)
    amounts = dict((await db.execute(select(Alert.id, _amount_total()).where(Alert.id.in_([a.id for a in alerts])))).all()) if alerts else {}
    labels = await _labels(db, tenant_id, {e for a in alerts for e in a.entity_ids})
    names = await _names(db, tenant_id, {case.assignee_id, case.created_by})
    return {
        **case_row(case),
        "assignee_name": names.get(case.assignee_id or ""),
        "created_by_name": names.get(case.created_by),
        "alerts": [{**_row(a, amounts.get(a.id)), "entities": _entities(a, labels)} for a in alerts],
        "notes": await case_notes(db, tenant_id, case.id),
        "audit": await case_audit(db, tenant_id, case.id, [a.id for a in alerts]),
    }


async def patch_case(
    db: AsyncSession,
    user: CurrentUser,
    case_id: str,
    *,
    new_status: str | None,
    priority: str | None,
    description: str | None,
    close_note: str | None,
) -> tuple[Case, list[Alert]]:
    t = user.tenant_id
    case = await _case(db, t, case_id, lock=True)
    _require_involved(user, case, "change it")
    changes: dict[str, dict[str, Any]] = {}
    if priority is not None and priority != case.priority:
        changes["priority"] = {"from": case.priority, "to": priority}
    if description is not None and description != (case.description or ""):
        changes["description"] = {"from": case.description, "to": description}
    moving = new_status is not None and new_status != case.status
    if not changes and not moving:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="nothing to change: the case already has these values")
    _require_open(case)
    if moving and new_status not in TRANSITIONS[case.status]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"a case cannot move from {case.status} to {new_status}")
    closing = moving and new_status in CLOSED_STATES
    note = (close_note or "").strip()
    if closing and len(note) < CLOSE_NOTE_MIN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"close_note required (>={CLOSE_NOTE_MIN} chars)")
    if closing and case.status == "open" and user.role not in MANAGERS:
        # docs/04 §6: an investigator reviews before closing; closing straight from open is a manager's call.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="only a manager can close a case that was never reviewed; move it to in_review first")

    touched: list[Alert] = []
    if "priority" in changes:
        case.priority = priority  # type: ignore[assignment]
    if "description" in changes:
        case.description = description or None
    if changes:
        audit.log(db, t, "case.update", actor_user=user.id, object_type="case", object_id=case.id, detail=changes)
    if moving:
        previous = case.status
        case.status = new_status  # type: ignore[assignment]
        detail: dict[str, Any] = {"from": previous, "to": new_status}
        if closing:
            case.closed_at = func.now()
            note_row = CaseNote(id=new_id("note"), tenant_id=t, case_id=case.id, author_id=user.id, body=note)
            db.add(note_row)
            touched = await linked_alerts(db, t, case.id)
            for alert in touched:
                alert.status, alert.updated_at = new_status, func.now()
            detail |= {"close_note_id": note_row.id, "alert_ids": [a.id for a in touched]}
        audit.log(db, t, "case.status", actor_user=user.id, object_type="case", object_id=case.id, detail=detail)
    case.updated_at = func.now()
    await db.commit()
    await db.refresh(case)
    for alert in touched:
        await db.refresh(alert)
    return case, touched


async def assign_case(db: AsyncSession, user: CurrentUser, case_id: str, assignee_id: str) -> Case:
    t = user.tenant_id
    case = await _case(db, t, case_id, lock=True)
    if user.role not in MANAGERS and assignee_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="investigators can only assign a case to themselves")
    _require_open(case)
    assignee = await db.scalar(select(User).where(User.id == assignee_id, User.tenant_id == t))
    if assignee is None or not assignee.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="assignee must be an active user of this tenant")
    if assignee.role == "viewer":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="a viewer cannot work a case; choose an investigator, manager or admin")
    if assignee_id == case.assignee_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="the case is already assigned to this user")
    detail: dict[str, Any] = {"from": case.assignee_id, "to": assignee_id}
    case.assignee_id = assignee_id
    if case.status == "open":
        # docs/04 §6: assigning an open case puts it in review.
        case.status = "in_review"
        detail["status"] = {"from": "open", "to": "in_review"}
    case.updated_at = func.now()
    audit.log(db, t, "case.assign", actor_user=user.id, object_type="case", object_id=case.id, detail=detail)
    await db.commit()
    await db.refresh(case)
    return case


async def add_note(db: AsyncSession, user: CurrentUser, case_id: str, body: str) -> tuple[Case, dict[str, Any]]:
    t = user.tenant_id
    case = await _case(db, t, case_id, lock=True)
    _require_involved(user, case, "add notes")
    _require_open(case)
    note = CaseNote(id=new_id("note"), tenant_id=t, case_id=case.id, author_id=user.id, body=body)
    db.add(note)
    case.updated_at = func.now()
    await db.flush()
    audit.log(db, t, "case.note", actor_user=user.id, object_type="case", object_id=case.id, detail={"note_id": note.id, "length": len(body)})
    await db.commit()
    await db.refresh(case)
    await db.refresh(note)
    name = await db.scalar(select(User.full_name).where(User.id == user.id))
    return case, {"id": note.id, "author_id": note.author_id, "author_name": name, "body": note.body, "created_at": note.created_at}
