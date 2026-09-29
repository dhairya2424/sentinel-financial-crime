from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, get_current_user, not_found
from app.db import get_db
from app.models import AccessRight, EmployeeAction, EmployeeSession, Transaction
from app.schemas.ingest import Event
from app.serialize import row_to_dict
from app.services.timeline import ALL_CATEGORIES, EntityType, TimelineItem, build_timeline, describe_entity, preview_item

router = APIRouter(prefix="/timeline", tags=["timeline"])

RAW_MODELS = {
    "transaction": Transaction,
    "employee_action": EmployeeAction,
    "session": EmployeeSession,
    "access_right": AccessRight,
}


class Actor(BaseModel):
    id: str
    name: str


class TimelineItemOut(BaseModel):
    ts: datetime
    category: str
    title: str
    actor: Actor | None
    value: str | None
    target: str | None
    event_kind: str
    ref_id: str
    direction: Literal["in", "out", "internal"] | None = None
    target_label: str | None = None


class EntityOut(BaseModel):
    type: EntityType
    id: str
    label: str
    detail: str | None


class TimelinePage(BaseModel):
    entity: EntityOut
    items: list[TimelineItemOut]
    next_cursor: str | None


class PreviewIn(BaseModel):
    event: Event


class PreviewOut(BaseModel):
    viewpoint: EntityOut | None
    item: TimelineItemOut | None
    problem: str | None
    note: str | None


def item_out(i: TimelineItem) -> TimelineItemOut:
    return TimelineItemOut(**{**i.__dict__, "actor": Actor(**i.actor) if i.actor else None})


class RawRecord(BaseModel):
    kind: str
    source_table: str
    record: dict


@router.post("/preview", response_model=PreviewOut)
async def preview(body: PreviewIn, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> PreviewOut:
    """The Timeline row an unsaved event would produce. Read-only: nothing is persisted."""
    p = await preview_item(db, user.tenant_id, body.event)
    return PreviewOut(
        viewpoint=EntityOut(**p.viewpoint.__dict__) if p.viewpoint else None,
        item=item_out(p.item) if p.item else None,
        problem=p.problem,
        note=p.note,
    )


@router.get("/raw/{kind}/{ref_id}", response_model=RawRecord)
async def raw_record(
    kind: Literal["transaction", "employee_action", "session", "access_right"],
    ref_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RawRecord:
    model = RAW_MODELS[kind]
    row = await db.scalar(select(model).where(model.id == ref_id, model.tenant_id == user.tenant_id))
    if row is None:
        raise not_found(kind)
    return RawRecord(kind=kind, source_table=model.__tablename__, record=row_to_dict(row))


@router.get("/{entity_type}/{entity_id}", response_model=TimelinePage)
async def timeline(
    entity_type: EntityType,
    entity_id: str,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    categories: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TimelinePage:
    entity = await describe_entity(db, user.tenant_id, entity_type, entity_id)
    if entity is None:
        raise not_found(entity_type)
    wanted = {c.strip() for c in categories.split(",") if c.strip()} if categories else set(ALL_CATEGORIES)
    unknown = wanted - ALL_CATEGORIES
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"unknown categories: {', '.join(sorted(unknown))}")
    try:
        items, next_cursor = await build_timeline(
            db, user.tenant_id, entity_type, entity_id, start=from_, end=to, categories=wanted, limit=limit, cursor=cursor
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from None
    return TimelinePage(
        entity=EntityOut(**entity.__dict__),
        items=[item_out(i) for i in items],
        next_cursor=next_cursor,
    )
