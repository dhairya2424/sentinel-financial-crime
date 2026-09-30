"""WebSocket hub (docs/05 §5): tenant-scoped channels fed by Redis pub/sub.

The tenant always comes from the verified JWT, never from what the client sends (docs/08 §2 T9): a request
for another tenant's channel is answered with an error and nothing is subscribed.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth.deps import ROLES
from app.auth.jwt import TokenError, decode
from app.redis_client import redis

router = APIRouter(tags=["realtime"])
log = logging.getLogger("sentinel.ws")

HEARTBEAT_S = 25
AUTH_TIMEOUT_S = 5
CLOSE_UNAUTHORIZED = 4401
CHANNEL_KINDS = ("alerts", "cases", "dashboard")

_clients: set[WebSocket] = set()


def client_count() -> int:
    return len(_clients)


def _claims(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        claims = decode(token, "access")
    except TokenError:
        return None
    return claims if claims.get("role") in ROLES else None


async def _authenticate(ws: WebSocket, token: str | None) -> dict[str, Any] | None:
    if token:
        return _claims(token)
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_S))
    except (TimeoutError, ValueError, WebSocketDisconnect):
        return None
    return _claims(first.get("token")) if isinstance(first, dict) and first.get("op") == "auth" else None


async def _send(ws: WebSocket, message: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(message))


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str | None = None) -> None:
    await ws.accept()
    claims = await _authenticate(ws, token)
    if claims is None:
        await ws.close(code=CLOSE_UNAUTHORIZED, reason="unauthorized")
        return
    tenant = claims["tenant_id"]
    allowed = {f"{kind}:{tenant}" for kind in CHANNEL_KINDS}
    pubsub = redis.pubsub()
    _clients.add(ws)

    async def forward() -> None:
        while True:
            if not pubsub.subscribed:
                await asyncio.sleep(0.2)
                continue
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                await ws.send_text(message["data"])

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            await _send(ws, {"type": "heartbeat", "ts": time.time()})

    tasks = [asyncio.create_task(forward()), asyncio.create_task(heartbeat())]
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except ValueError:
                await _send(ws, {"type": "error", "detail": "messages must be JSON"})
                continue
            op = msg.get("op") if isinstance(msg, dict) else None
            if op == "ping":
                await _send(ws, {"type": "pong"})
            elif op in ("subscribe", "unsubscribe"):
                channels = [c for c in msg.get("channels", []) if isinstance(c, str)]
                denied = [c for c in channels if c not in allowed]
                granted = [c for c in channels if c in allowed]
                if denied:
                    await _send(ws, {"type": "error", "detail": "channel not allowed", "channels": denied})
                if granted and op == "subscribe":
                    await pubsub.subscribe(*granted)
                elif granted:
                    await pubsub.unsubscribe(*granted)
                if granted:
                    await _send(ws, {"type": f"{op}d", "channels": granted})
            elif op != "auth":
                await _send(ws, {"type": "error", "detail": f"unknown op {op!r}"})
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        _clients.discard(ws)
        with contextlib.suppress(Exception):
            await pubsub.aclose()
