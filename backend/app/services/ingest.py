import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.graph.service import graph_service
from app.ids import new_id
from app.models import AccessRight, Account, Customer, Employee, EmployeeAction, EmployeeSession, IngestFailure, Transaction
from app.redis_client import redis
from app.schemas.ingest import AccessRightEvent, EmployeeActionEvent, SessionEvent, TransactionEvent, event_time

log = logging.getLogger("sentinel.ingest")

STREAM = "events"
STREAM_MAXLEN = 200_000
AnyEvent = TransactionEvent | EmployeeActionEvent | AccessRightEvent | SessionEvent
MODELS = {"transaction": Transaction, "employee_action": EmployeeAction, "access_right": AccessRight, "session": EmployeeSession}


class UnknownReference(ValueError):
    """An event names a customer, account, employee, session or transaction that is not registered in this tenant.
    The event is rejected rather than attached to an invented stand-in row: every row in the store is real. A row owned
    by another tenant is reported exactly like a missing one (ADR-011)."""


@dataclass
class IngestResult:
    batch_id: str
    accepted: list[tuple[str, str]] = field(default_factory=list)
    skipped: int = 0
    failed: int = 0
    skipped_ids: list[str] = field(default_factory=list)
    errors: list[tuple[str, str]] = field(default_factory=list)
    persist_ms: float = 0.0


async def _existing_ids(db: AsyncSession, events: list[AnyEvent]) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {kind: set() for kind in MODELS}
    for kind, model in MODELS.items():
        ids = [e.id for e in events if e.kind == kind]
        if ids:
            found[kind] = set(await db.scalars(select(model.id).where(model.id.in_(ids))))
    return found


TARGET_MODELS = {"customer": Customer, "account": Account, "employee": Employee, "transaction": Transaction}
NOUNS = {Customer: "customer", Account: "account", Employee: "employee", EmployeeSession: "session", Transaction: "transaction"}


async def _require(db: AsyncSession, tenant_id: str, model: type, row_id: str) -> Any:
    row = await db.get(model, row_id)
    if row is None or row.tenant_id != tenant_id:
        raise UnknownReference(f"{NOUNS[model]} {row_id} is not registered")
    return row


async def check_references(db: AsyncSession, tenant_id: str, event: AnyEvent) -> None:
    """Raise UnknownReference when the event names anything not registered in this tenant. Shared by ingest and preview."""
    if isinstance(event, TransactionEvent):
        for account_id in (a for a in (event.from_account_id, event.to_account_id) if a):
            await _require(db, tenant_id, Account, account_id)
        return
    await _require(db, tenant_id, Employee, event.employee_id)
    if isinstance(event, EmployeeActionEvent):
        if event.session_id:
            session = await _require(db, tenant_id, EmployeeSession, event.session_id)
            if session.employee_id != event.employee_id:
                raise UnknownReference(f"session {event.session_id} belongs to another employee")
        if event.target_type in TARGET_MODELS:
            await _require(db, tenant_id, TARGET_MODELS[event.target_type], event.target_id)


async def _persist(db: AsyncSession, tenant_id: str, event: AnyEvent) -> None:
    await check_references(db, tenant_id, event)
    if isinstance(event, TransactionEvent):
        touched = [a for a in (event.from_account_id, event.to_account_id) if a]
        db.add(Transaction(tenant_id=tenant_id, raw=event.raw or {}, **event.model_dump(exclude={"kind", "raw"})))
        await db.execute(
            update(Account)
            .where(Account.id.in_(touched))
            .values(last_activity_at=func.greatest(func.coalesce(Account.last_activity_at, event.value_ts), event.value_ts))
        )
    elif isinstance(event, EmployeeActionEvent):
        db.add(EmployeeAction(tenant_id=tenant_id, raw=event.raw or {}, **event.model_dump(exclude={"kind", "raw"})))
    elif isinstance(event, AccessRightEvent):
        db.add(AccessRight(tenant_id=tenant_id, **event.model_dump(exclude={"kind"})))
    else:
        db.add(EmployeeSession(tenant_id=tenant_id, **event.model_dump(exclude={"kind"})))
    await db.flush()


async def ingest_events(
    db: AsyncSession, tenant_id: str, events: list[AnyEvent], actor_user: str | None, *, dead_letter: bool = True
) -> IngestResult:
    """Persist valid events and dead-letter invalid ones in one transaction, then publish accepted ids.
    An ops replay passes dead_letter=False: the failure row it is replaying already holds the event."""
    started = time.perf_counter()
    result = IngestResult(batch_id=str(uuid.uuid4()))
    existing = await _existing_ids(db, events)
    seen: set[str] = set()
    for event in sorted(events, key=event_time):
        if event.id in existing[event.kind] or event.id in seen:
            result.skipped += 1
            result.skipped_ids.append(event.id)
            continue
        seen.add(event.id)
        try:
            async with db.begin_nested():
                await _persist(db, tenant_id, event)
            result.accepted.append((event.kind, event.id))
        except Exception as exc:  # noqa: BLE001 - every row failure is dead-lettered, never fatal to the batch
            result.failed += 1
            reason = str(exc).splitlines()[0][:500] if isinstance(exc, UnknownReference) else "the event could not be stored"
            result.errors.append((event.id, reason))
            if dead_letter:
                db.add(
                    IngestFailure(
                        id=new_id("fail"),
                        tenant_id=tenant_id,
                        payload=event.model_dump(mode="json"),
                        error=f"{type(exc).__name__}: {str(exc).splitlines()[0][:500]}",
                    )
                )
    audit.log(
        db,
        tenant_id,
        "ingest.batch",
        actor_user=actor_user,
        object_type="batch",
        object_id=result.batch_id,
        detail={"accepted": len(result.accepted), "skipped": result.skipped, "failed": result.failed},
    )
    await db.commit()
    result.persist_ms = round((time.perf_counter() - started) * 1000, 1)
    by_id = {e.id: e for e in events}
    for kind, event_id in result.accepted:
        graph_service.apply_event(tenant_id, kind, by_id[event_id].model_dump())
    await publish(tenant_id, result.accepted)
    log.info(
        '{"span":"ingest_persist_ms","ms":%s,"accepted":%d,"skipped":%d,"failed":%d}',
        result.persist_ms,
        len(result.accepted),
        result.skipped,
        result.failed,
    )
    return result


async def publish(tenant_id: str, accepted: list[tuple[str, str]]) -> None:
    if not accepted:
        return
    try:
        async with redis.pipeline(transaction=False) as pipe:
            for kind, event_id in accepted:
                pipe.xadd(
                    STREAM,
                    {"tenant_id": tenant_id, "kind": kind, "id": event_id, "ingested_at": str(time.time())},
                    maxlen=STREAM_MAXLEN,
                    approximate=True,
                )
            await pipe.execute()
    except Exception as exc:  # noqa: BLE001 - ingest stays 202; the ops replay path covers a missed publish
        log.error("stream publish failed for %d events: %s", len(accepted), exc)
