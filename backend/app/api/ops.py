import asyncio
import logging

from fastapi import APIRouter
from sqlalchemy import text

from app.db import engine
from app.pipeline import worker
from app.realtime import hub
from app.redis_client import redis

router = APIRouter(prefix="/ops", tags=["ops"])
log = logging.getLogger("sentinel.ops")
PING_TIMEOUT_S = 2.0


async def _ping_db() -> str:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return "ok"


async def _ping_redis() -> str:
    return "ok" if await redis.ping() else "fail"


async def _check(name: str, probe) -> str:
    try:
        return await asyncio.wait_for(probe(), PING_TIMEOUT_S)
    except Exception as exc:
        log.warning("health check %s failed: %s", name, exc)
        return "fail"


@router.get("/health")
async def health() -> dict[str, object]:
    db, rds = await asyncio.gather(_check("db", _ping_db), _check("redis", _ping_redis))
    return {"db": db, "redis": rds, "pipeline": worker.metrics.snapshot(), "ws_clients": hub.client_count()}
