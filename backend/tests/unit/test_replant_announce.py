"""The S1 re-plant tells open inboxes which alerts it removed (docs/09 §3 `alert.removed`), so the loop is not listed twice."""

import asyncio
import json

from app.seed import suspicious


class FakeRedis:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []

    async def publish(self, channel: str, message: str) -> None:
        self.sent.append((channel, json.loads(message)))


def test_each_removed_alert_is_announced_on_the_tenant_alert_channel(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(suspicious, "redis", fake)
    asyncio.run(suspicious.announce_removed("tenant_demo", ["alert_a", "alert_b"]))
    assert fake.sent == [
        ("alerts:tenant_demo", {"channel": "alerts:tenant_demo", "type": "alert.removed", "data": {"id": "alert_a", "reason": "demo.replant"}}),
        ("alerts:tenant_demo", {"channel": "alerts:tenant_demo", "type": "alert.removed", "data": {"id": "alert_b", "reason": "demo.replant"}}),
    ]


def test_nothing_is_announced_when_nothing_was_removed(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(suspicious, "redis", fake)
    asyncio.run(suspicious.announce_removed("tenant_demo", []))
    assert fake.sent == []
