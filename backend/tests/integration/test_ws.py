"""T-INT-06/07: the WebSocket hub delivers alert.created within budget and keeps tenants apart."""

import time
from datetime import UTC, datetime, timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app.auth.jwt import create_access_token

from .conftest import TENANT_A, TENANT_B, poll


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def token(tenant: str, role: str = "investigator") -> str:
    return create_access_token(f"usr_itest_{role}", tenant, role)


def test_bad_token_is_closed_with_4401(client):
    with client.websocket_connect("/v1/ws?token=not-a-jwt") as ws, pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_text()
    assert closed.value.code == 4401


def test_first_message_auth_then_ping_pong(client):
    with client.websocket_connect("/v1/ws") as ws:
        ws.send_json({"op": "auth", "token": token(TENANT_A)})
        ws.send_json({"op": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_t_int_06_07_subscribe_receives_structuring_alert_and_rejects_foreign_channel(client, world):
    """T-INT-06: alert.created arrives < 5 s after ingest. T-INT-07: another tenant's channel is refused."""
    with client.websocket_connect(f"/v1/ws?token={token(TENANT_A)}") as ws:
        ws.send_json({"op": "subscribe", "channels": [f"alerts:{TENANT_A}", f"alerts:{TENANT_B}"]})
        assert ws.receive_json() == {"type": "error", "detail": "channel not allowed", "channels": [f"alerts:{TENANT_B}"]}
        assert ws.receive_json() == {"type": "subscribed", "channels": [f"alerts:{TENANT_A}"]}

        now = datetime.now(UTC).replace(microsecond=0)
        targets = [world.other_account, f"{world.account}_c", world.other_account]
        events = [
            {
                "kind": "transaction",
                "id": f"{world.tx}_s{i}",
                "from_account_id": world.account,
                "to_account_id": dest,
                "amount": amount,
                "channel": "upi",
                "value_ts": iso(now - timedelta(minutes=50 - 20 * i)),
            }
            for i, (dest, amount) in enumerate(zip(targets, ["45000.00", "47500.00", "48900.00"], strict=True))
        ]
        started = time.perf_counter()
        assert client.post("/v1/ingest/events", json={"events": events}, headers={"Authorization": f"Bearer {token(TENANT_A)}"}).json()["accepted"] == 3

        def find():
            items = client.get(
                "/v1/alerts", params={"rule": "R-STRUCT", "entity": world.account}, headers={"Authorization": f"Bearer {token(TENANT_A)}"}
            ).json()["items"]
            return items[0] if items else None

        row, _ = poll(find, timeout=5.0)
        message = None
        for _ in range(10):
            candidate = ws.receive_json()
            if candidate.get("type") == "alert.created" and candidate["data"]["id"] == row["id"]:
                message = candidate
                break
        elapsed = (time.perf_counter() - started) * 1000
        print(f"\nT-INT-06 ingest->ws latency: {elapsed:.0f} ms")
        assert message is not None and elapsed < 5000
        assert message["channel"] == f"alerts:{TENANT_A}"
        assert message["data"]["rule_code"] == "R-STRUCT" and message["data"]["risk_band"] in ("low", "medium", "high", "critical")
        assert world.account in message["data"]["entity_ids"]


def test_foreign_tenant_socket_never_sees_the_alert_channel(client, world):
    with client.websocket_connect(f"/v1/ws?token={token(TENANT_B)}") as ws:
        ws.send_json({"op": "subscribe", "channels": [f"alerts:{TENANT_A}"]})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"op": "ping"})
        assert ws.receive_json() == {"type": "pong"}
