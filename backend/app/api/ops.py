import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.auth.deps import CurrentUser, not_found, require_role
from app.db import engine, get_db
from app.models import IngestFailure
from app.pipeline import worker
from app.realtime import hub
from app.redis_client import redis
from app.schemas.ingest import Event
from app.services.ingest import MODELS, ingest_events

router = APIRouter(prefix="/ops", tags=["ops"])
log = logging.getLogger("sentinel.ops")
PING_TIMEOUT_S = 2.0
RATE_SCAN_CAP = 20_000
admin_role = require_role("admin")
EVENT = TypeAdapter(Event)


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    failure_id: str


class ReplayResult(BaseModel):
    failure_id: str
    stage: Literal["ingest", "pipeline"]
    event_id: str | None
    outcome: Literal["applied", "already_stored", "reprocessed"]
    alert_changes: int
    replayed_at: datetime


async def _ping_db() -> str:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return "ok"


async def _ping_redis() -> str:
    return "ok" if await redis.ping() else "fail"


async def _ingest_signals() -> dict[str, int | None]:
    """docs/11 §4: dead letters waiting for a replay, and the event stream's size, backlog and last-minute rate
    (every tenant; counts only, no tenant data)."""
    since = int(time.time() * 1000) - 60_000
    async with engine.connect() as conn:
        open_failures = await conn.scalar(select(func.count()).select_from(IngestFailure).where(IngestFailure.replayed_at.is_(None)))
    length = await redis.xlen(worker.STREAM)
    group = next((g for g in await redis.xinfo_groups(worker.STREAM) if g["name"] == worker.GROUP), None)
    recent = await redis.xrange(worker.STREAM, min=f"{since}-0", max="+", count=RATE_SCAN_CAP)
    return {
        "failures_open": int(open_failures or 0),
        "stream_length": int(length),
        "backlog": None if group is None else int(group.get("pending") or 0) + int(group.get("lag") or 0),
        "events_per_min": len(recent),
    }


async def _check(name: str, probe) -> str:
    try:
        return await asyncio.wait_for(probe(), PING_TIMEOUT_S)
    except Exception as exc:
        log.warning("health check %s failed: %s", name, exc)
        return "fail"


@router.get("/health")
async def health() -> dict[str, object]:
    db, rds = await asyncio.gather(_check("db", _ping_db), _check("redis", _ping_redis))
    try:
        ingest = await asyncio.wait_for(_ingest_signals(), PING_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - health must answer even when a store is down; db/redis already say which
        log.warning("health ingest signals unavailable: %s", exc)
        ingest = {"failures_open": None, "stream_length": None, "backlog": None, "events_per_min": None}
    return {"db": db, "redis": rds, "pipeline": worker.metrics.snapshot(), "ws_clients": hub.client_count(), "ingest": ingest}


async def _replay_ingest(db: AsyncSession, failure: IngestFailure, user: CurrentUser) -> tuple[str | None, str]:
    try:
        event = EVENT.validate_python(failure.payload)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"stored payload is not a valid event: {exc.errors()[0]['msg']}") from None
    result = await ingest_events(db, failure.tenant_id, [event], user.id, dead_letter=False)
    if result.failed:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"replay failed again: {result.errors[0][1]}")
    return event.id, "applied" if result.accepted else "already_stored"


async def _replay_pipeline(db: AsyncSession, failure: IngestFailure) -> tuple[str | None, int]:
    kind, event_id = failure.payload.get("kind"), failure.payload.get("id")
    if kind not in MODELS or not event_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="stored payload names no event to reprocess")
    row = await db.get(MODELS[kind], event_id)
    if row is None or row.tenant_id != failure.tenant_id:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"{kind} {event_id} is no longer stored")
    try:
        changes = await worker.process_event(failure.tenant_id, kind, event_id)
    except Exception as exc:  # noqa: BLE001 - the operator sees why the re-drive failed; the failure row stays open
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"reprocessing failed again: {type(exc).__name__}: {exc}"[:500]) from None
    return event_id, changes


@router.post("/replay-batch", response_model=ReplayResult)
async def replay(body: ReplayRequest, user: CurrentUser = Depends(admin_role), db: AsyncSession = Depends(get_db)) -> ReplayResult:
    """Re-drive one dead-lettered event: an ingest-stage failure goes back through the ingest path, a pipeline-stage
    failure is detected again on its stored row. The failure is marked replayed only when that succeeds."""
    failure = await db.get(IngestFailure, body.failure_id)
    if failure is None or failure.tenant_id != user.tenant_id:
        raise not_found("failure")
    if failure.replayed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"already replayed at {failure.replayed_at.isoformat()}")
    stage: Literal["ingest", "pipeline"] = "pipeline" if failure.payload.get("stage") == "pipeline" else "ingest"
    changes = 0
    if stage == "ingest":
        event_id, outcome = await _replay_ingest(db, failure, user)
    else:
        event_id, changes = await _replay_pipeline(db, failure)
        outcome = "reprocessed"
    failure = await db.scalar(select(IngestFailure).where(IngestFailure.id == body.failure_id).with_for_update())
    if failure.replayed_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"already replayed at {failure.replayed_at.isoformat()}")
    failure.replayed_at = datetime.now(UTC)
    audit.log(
        db,
        user.tenant_id,
        "ops.replay",
        actor_user=user.id,
        object_type="ingest_failure",
        object_id=failure.id,
        detail={"stage": stage, "event_id": event_id, "outcome": outcome, "alert_changes": changes},
    )
    await db.commit()
    return ReplayResult(
        failure_id=failure.id, stage=stage, event_id=event_id, outcome=outcome, alert_changes=changes, replayed_at=failure.replayed_at
    )
