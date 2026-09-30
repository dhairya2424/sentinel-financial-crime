"""Cases API (docs/05 §6 Cases). Reads are open to every role; changes follow the docs/08 §4 matrix."""

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.api.alerts import AlertRow
from app.auth.deps import CurrentUser, get_current_user, require_role
from app.cases import service
from app.db import get_db
from app.export.service import build_bundle, render_html
from app.models import Case

router = APIRouter(prefix="/cases", tags=["cases"])
act_role = require_role("admin", "manager", "investigator")

Status = Literal["open", "in_review", "escalated", "closed_confirmed", "closed_false_positive"]
Priority = Literal["low", "medium", "high", "critical"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
NoteBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CaseIn(_Body):
    title: Title
    priority: Priority | None = None
    description: LongText | None = None
    alert_ids: Annotated[list[str], Field(max_length=service.GROUP_CAP)] = []
    group_by_entities: bool = False


class CasePatch(_Body):
    status: Status | None = None
    priority: Priority | None = None
    description: LongText | None = None
    close_note: LongText | None = None


class AssignIn(_Body):
    assignee_id: str


class NoteIn(_Body):
    body: NoteBody


class CaseRow(BaseModel):
    id: str
    case_number: str
    title: str
    description: str | None
    priority: str
    status: str
    assignee_id: str | None
    assignee_name: str | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    export_digest: str | None
    alert_count: int = 0
    top_band: str | None = None


class CasePage(BaseModel):
    items: list[CaseRow]
    next_cursor: str | None


class Note(BaseModel):
    id: str
    author_id: str
    author_name: str | None
    body: str
    created_at: datetime


class AuditRow(BaseModel):
    id: int
    at: datetime
    actor_user: str | None
    actor_name: str | None
    actor_kind: str
    action: str
    object_type: str | None
    object_id: str | None
    detail: dict[str, Any]


class CaseDetail(CaseRow):
    created_by_name: str | None
    alerts: list[AlertRow]
    notes: list[Note]
    audit: list[AuditRow]


async def _detail(db: AsyncSession, tenant_id: str, case_id: str) -> CaseDetail:
    d = await service.get_case(db, tenant_id, case_id)
    return CaseDetail(**d, alert_count=len(d["alerts"]))


@router.post("", status_code=status.HTTP_201_CREATED, response_model=CaseDetail)
async def create_case(body: CaseIn, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> CaseDetail:
    case, alerts = await service.create_case(
        db, user, title=body.title, priority=body.priority, description=body.description or None, alert_ids=body.alert_ids, group_by_entities=body.group_by_entities
    )
    await service.announce(user.tenant_id, case, alerts)
    return await _detail(db, user.tenant_id, case.id)


@router.get("", response_model=CasePage)
async def list_cases(
    status_: str | None = Query(None, alias="status"),
    assignee: str | None = Query(None, description="a user id, `me`, or `none` for unassigned"),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CasePage:
    statuses = [s.strip() for s in (status_ or "").split(",") if s.strip()]
    unknown = [s for s in statuses if s not in service.TRANSITIONS]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"unknown status: {', '.join(unknown)}")
    items, next_cursor = await service.list_cases(
        db, user.tenant_id, statuses=statuses, assignee=user.id if assignee == "me" else assignee, cursor=cursor, limit=limit
    )
    return CasePage(items=[CaseRow(**i) for i in items], next_cursor=next_cursor)


@router.get("/{case_id}", response_model=CaseDetail)
async def get_case(case_id: str, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> CaseDetail:
    return await _detail(db, user.tenant_id, case_id)


@router.patch("/{case_id}", response_model=CaseDetail)
async def patch_case(case_id: str, body: CasePatch, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> CaseDetail:
    case, alerts = await service.patch_case(
        db, user, case_id, new_status=body.status, priority=body.priority, description=body.description, close_note=body.close_note
    )
    await service.announce(user.tenant_id, case, alerts)
    return await _detail(db, user.tenant_id, case.id)


@router.post("/{case_id}/assign", response_model=CaseDetail)
async def assign_case(case_id: str, body: AssignIn, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> CaseDetail:
    case = await service.assign_case(db, user, case_id, body.assignee_id)
    await service.announce(user.tenant_id, case)
    return await _detail(db, user.tenant_id, case.id)


@router.post("/{case_id}/notes", status_code=status.HTTP_201_CREATED, response_model=Note)
async def add_note(case_id: str, body: NoteIn, user: CurrentUser = Depends(act_role), db: AsyncSession = Depends(get_db)) -> Note:
    case, note = await service.add_note(db, user, case_id, body.body)
    await service.announce(user.tenant_id, case)
    return Note(**note)


@router.get("/{case_id}/export")
async def export_case(
    case_id: str,
    format_: Literal["json", "html"] = Query("json", alias="format"),
    user: CurrentUser = Depends(act_role),
    db: AsyncSession = Depends(get_db),
) -> Response:
    bundle = await build_bundle(db, user, case_id)
    digest = bundle["digest_sha256"]
    # Recording the digest is not a change to the case, so updated_at (and the queue order) stays put.
    await db.execute(update(Case).where(Case.id == case_id, Case.tenant_id == user.tenant_id).values(export_digest=digest))
    audit.log(
        db,
        user.tenant_id,
        "case.export",
        actor_user=user.id,
        object_type="case",
        object_id=case_id,
        detail={"format": format_, "digest_sha256": digest, "evidence_count": bundle["evidence_count"], "evidence_truncated": bundle["evidence_truncated"]},
    )
    await db.commit()
    name = f"sentinel-case-{bundle['case']['case_number']}.{format_}"
    headers = {"Content-Disposition": f'attachment; filename="{name}"', "X-Content-Type-Options": "nosniff", "X-Digest-SHA256": digest}
    if format_ == "html":
        return HTMLResponse(render_html(bundle), headers=headers)
    return Response(json.dumps(bundle, ensure_ascii=False, indent=2), media_type="application/json", headers=headers)
