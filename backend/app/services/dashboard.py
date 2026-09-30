"""Risk overview for the Dashboard (PRD E1-E2): case and alert counts, false-positive rate, top entities, ingest health.

`feed()` runs inside the API: every 15 s it recomputes the metrics for each tenant someone is watching and publishes
`metrics.update` on `dashboard:{tenant}` when they changed.
"""

import asyncio
import json
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.alerts import _labels
from app.cases.service import CLOSED_STATES, OPEN_STATES, PRIORITIES
from app.db import SessionLocal
from app.models import Alert, Case, Tenant
from app.pipeline import worker
from app.redis_client import redis

log = logging.getLogger("sentinel.dashboard")
FEED_SECONDS = 15
TOP_ENTITIES = 5
RATE_WINDOW_MS = 60_000
RATE_SCAN_CAP = 20_000


async def _ingest(tenant_id: str) -> dict[str, Any]:
    """Events this tenant sent in the last minute (read off the stream, so every API process counts) and pipeline lag."""
    since = int(time.time() * 1000) - RATE_WINDOW_MS
    try:
        entries = await redis.xrange(worker.STREAM, min=f"{since}-0", max="+", count=RATE_SCAN_CAP)
        group = next((g for g in await redis.xinfo_groups(worker.STREAM) if g["name"] == worker.GROUP), None)
    except Exception:  # noqa: BLE001 - Redis down: say so rather than fail the whole overview
        return {"events_per_min": None, "lag_ms": None, "backlog": None}
    backlog = None if group is None else int(group.get("pending") or 0) + int(group.get("lag") or 0)
    return {
        "events_per_min": sum(1 for _, fields in entries if fields.get("tenant_id") == tenant_id),
        "lag_ms": worker.metrics.last_lag_ms,
        "backlog": backlog,
    }


async def metrics(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    now = datetime.now(UTC)
    by_priority = dict(
        (await db.execute(select(Case.priority, func.count()).where(Case.tenant_id == tenant_id, Case.status.in_(OPEN_STATES)).group_by(Case.priority))).all()
    )
    day = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(Alert.risk_band == "critical"),
                func.count().filter(Alert.risk_band == "high"),
            ).where(Alert.tenant_id == tenant_id, Alert.detected_at >= now - timedelta(hours=24))
        )
    ).one()
    closed, false_positive = (
        await db.execute(
            select(func.count(), func.count().filter(Case.status == "closed_false_positive")).where(
                Case.tenant_id == tenant_id, Case.status.in_(CLOSED_STATES), Case.closed_at >= now - timedelta(days=7)
            )
        )
    ).one()
    entity = func.unnest(Alert.entity_ids).label("entity_id")
    inner = select(entity).where(Alert.tenant_id == tenant_id, Alert.detected_at >= now - timedelta(days=30)).subquery()
    top = (
        await db.execute(
            select(inner.c.entity_id, func.count().label("n"))
            .group_by(inner.c.entity_id)
            .order_by(func.count().desc(), inner.c.entity_id)
            .limit(TOP_ENTITIES)
        )
    ).all()
    labels = await _labels(db, tenant_id, {e for e, _ in top})
    return {
        "open_cases": sum(by_priority.values()),
        "open_cases_by_priority": {p: by_priority.get(p, 0) for p in PRIORITIES},
        "critical_24h": day[1],
        "high_24h": day[2],
        "alerts_24h": day[0],
        "fp_rate_7d": round(false_positive / closed, 4) if closed else None,
        "closed_7d": closed,
        "top_entities": [
            {
                "entity_id": e,
                "alert_count": n,
                "type": labels[e].type if e in labels else None,
                "label": labels[e].label if e in labels else None,
            }
            for e, n in top
        ],
        "ingest": await _ingest(tenant_id),
    }


async def _watched_tenants() -> list[str]:
    async with SessionLocal() as db:
        tenants = list(await db.scalars(select(Tenant.id)))
    if not tenants:
        return []
    counts = await redis.pubsub_numsub(*[f"dashboard:{t}" for t in tenants])
    watched = {channel if isinstance(channel, str) else channel.decode() for channel, n in counts if n}
    return [t for t in tenants if f"dashboard:{t}" in watched]


async def feed() -> None:
    last: dict[str, str] = {}
    while True:
        await asyncio.sleep(FEED_SECONDS)
        try:
            for tenant_id in await _watched_tenants():
                async with SessionLocal() as db:
                    data = await metrics(db, tenant_id)
                body = json.dumps(data, sort_keys=True)
                if last.get(tenant_id) == body:
                    continue
                last[tenant_id] = body
                await redis.publish(f"dashboard:{tenant_id}", json.dumps({"channel": f"dashboard:{tenant_id}", "type": "metrics.update", "data": data}))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad tick must not stop the feed
            log.error("dashboard feed tick failed: %s", exc)


_task: asyncio.Task | None = None


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(feed(), name="dashboard-feed")


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
