"""Pipeline worker: Redis Stream `events` → graph update → detection → alert + evidence → pub/sub (docs/02 §3, ADR-005).

Delivery is at-least-once. A message is acknowledged only after its outcome is durable: processed, or recorded
in `ingest_failures` after MAX_DELIVERIES attempts so one poison event can never block the stream. Messages a
crashed or slow consumer left pending are reclaimed after RECLAIM_IDLE_MS. Alert dedup makes every replay
idempotent. Each process joins the `pipeline` group under its own consumer name, so two API processes share the
stream instead of colliding.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from dataclasses import asdict, dataclass
from typing import Any

from redis.exceptions import ResponseError
from sqlalchemy import inspect

from app.db import SessionLocal
from app.detection.engine import detect
from app.graph.service import graph_service
from app.ids import new_id
from app.models import IngestFailure
from app.pipeline.alerts import alert_message, group_hits, persist_group
from app.pipeline.context import build_context
from app.redis_client import redis

log = logging.getLogger("sentinel.pipeline")

STREAM = "events"
GROUP = "pipeline"
BLOCK_MS = 2000
BATCH = 50
MAX_DELIVERIES = 3
RECLAIM_IDLE_MS = 15_000
CONSUMER = f"w-{socket.gethostname()}-{os.getpid()}"


@dataclass
class Metrics:
    processed: int = 0
    alerts_created: int = 0
    alerts_updated: int = 0
    errors: int = 0
    last_lag_ms: float | None = None

    def snapshot(self) -> dict[str, Any]:
        return {**asdict(self), "stream_lag_ms": self.last_lag_ms}


metrics = Metrics()
_task: asyncio.Task | None = None


def readable(text: str, labels: dict[str, str]) -> str:
    """Name accounts the way investigators know them; ids stay in entity_ids and evidence for machines."""
    for account_id, label in labels.items():
        text = text.replace(account_id, label)
    return text


def _span(name: str, ms: float, **extra: Any) -> None:
    log.info(json.dumps({"span": name, "ms": round(ms, 1), **extra}))


async def ensure_group() -> None:
    try:
        await redis.xgroup_create(STREAM, GROUP, id="$", mkstream=True)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


async def process_event(tenant_id: str, kind: str, event_id: str, ingested_at: float | None = None) -> int:
    """Detect on one persisted event and persist/publish any alert changes. Returns the number of alert changes."""
    started = time.perf_counter()
    async with SessionLocal() as db:
        built = await build_context(db, tenant_id, kind, event_id)
        if built is None:
            return 0
        graph_service.apply_event(tenant_id, kind, {c.key: getattr(built.row, c.key) for c in inspect(built.row).mapper.column_attrs})
        hits = detect(built.ctx, built.affected.ids(), [kind])
        for hit in hits:
            hit.explanation = readable(hit.explanation, built.labels)
        detect_ms = (time.perf_counter() - started) * 1000
        _span("detect_ms", detect_ms, kind=kind, id=event_id, hits=len(hits))
        if not hits:
            return 0
        persist_started = time.perf_counter()
        changes = []
        for group in group_hits(hits):
            change = await persist_group(db, tenant_id, group, built.ctx.configs)
            if change is not None:
                changes.append(change)
        messages = [alert_message(tenant_id, c) for c in changes]
        await db.commit()
        _span("alert_persist_ms", (time.perf_counter() - persist_started) * 1000, alerts=len(changes))

    publish_started = time.perf_counter()
    for change, message in zip(changes, messages, strict=True):
        await redis.publish(f"alerts:{tenant_id}", json.dumps(message))
        if change.created:
            metrics.alerts_created += 1
        else:
            metrics.alerts_updated += 1
    _span("ws_publish_ms", (time.perf_counter() - publish_started) * 1000, published=len(messages))
    if ingested_at is not None and messages:
        _span("event_to_ws_ms", (time.time() - ingested_at) * 1000, id=event_id)
    return len(changes)


async def _record_failure(fields: dict[str, str], error: str) -> None:
    async with SessionLocal() as db:
        db.add(
            IngestFailure(
                id=new_id("fail"),
                tenant_id=fields.get("tenant_id", "unknown"),
                payload={"stage": "pipeline", **fields},
                error=error[:500],
            )
        )
        await db.commit()


async def _deliveries(message_id: str) -> int:
    pending = await redis.xpending_range(STREAM, GROUP, min=message_id, max=message_id, count=1)
    return int(pending[0]["times_delivered"]) if pending else 1


async def handle(message_id: str, fields: dict[str, str]) -> None:
    try:
        ingested = float(fields["ingested_at"]) if fields.get("ingested_at") else None
        if ingested is not None:
            metrics.last_lag_ms = round((time.time() - ingested) * 1000, 1)
        await process_event(fields["tenant_id"], fields["kind"], fields["id"], ingested)
        metrics.processed += 1
        await redis.xack(STREAM, GROUP, message_id)
    except Exception as exc:  # noqa: BLE001 - a failing event is retried, then parked; the loop never dies
        metrics.errors += 1
        attempts = await _deliveries(message_id)
        log.exception("pipeline event %s failed (delivery %d/%d)", fields.get("id"), attempts, MAX_DELIVERIES)
        if attempts >= MAX_DELIVERIES:
            await _record_failure(fields, f"{type(exc).__name__}: {exc}")
            await redis.xack(STREAM, GROUP, message_id)


async def run() -> None:
    await ensure_group()
    log.info("pipeline worker %s consuming %s/%s", CONSUMER, STREAM, GROUP)
    while True:
        try:
            claimed = await redis.xautoclaim(STREAM, GROUP, CONSUMER, min_idle_time=RECLAIM_IDLE_MS, start_id="0-0", count=BATCH)
            for message_id, fields in claimed[1]:
                if fields:
                    await handle(message_id, fields)
            batches = await redis.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, count=BATCH, block=BLOCK_MS)
            for _, entries in batches or []:
                for message_id, fields in entries:
                    await handle(message_id, fields)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - Redis outages must not kill the worker; back off and retry
            metrics.errors += 1
            log.error("pipeline loop error: %s", exc)
            await asyncio.sleep(2)


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(run(), name="pipeline-worker")


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
