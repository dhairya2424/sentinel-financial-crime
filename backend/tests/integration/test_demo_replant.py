"""Planting S1 live (docs/12 §2): the loop's earlier alert goes, and the live pipeline raises a new one from scratch."""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import pytest
import redis as redis_sync
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.ids import new_id
from app.models import AuditLog, Case
from app.seed.suspicious import ReplantRefused, clear_for_replant
from app.services.ingest import STREAM

from .conftest import TENANT_A, poll


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def _clear(prefix: str) -> tuple[list[str], list[str]]:
    # A private NullPool engine: the app's pool belongs to the TestClient's event loop.
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    try:
        async with AsyncSession(own) as db, db.begin():
            return await clear_for_replant(db, TENANT_A, "S1", prefix=prefix)
    finally:
        await own.dispose()


async def _audit(prefix: str) -> list[dict]:
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    try:
        async with AsyncSession(own) as db:
            rows = await db.scalars(select(AuditLog).where(AuditLog.tenant_id == TENANT_A, AuditLog.action == "demo.replant").order_by(AuditLog.id))
            return [r.detail for r in rows if any(e.startswith(prefix) for e in r.detail.get("events", []))]
    finally:
        await own.dispose()


async def _make_case(case_id: str) -> None:
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    async with AsyncSession(own) as db, db.begin():
        db.add(Case(id=case_id, tenant_id=TENANT_A, case_number=f"CASE-RP-{case_id[-6:]}", title="Replant case", created_by="usr_itest_investigator"))
    await own.dispose()


def _publish(txs: list[str]) -> None:
    """The same stream entries app.services.ingest.publish writes, sent from this thread's own connection."""
    client = redis_sync.Redis.from_url(get_settings().REDIS_URL, decode_responses=True)
    try:
        for tx in txs:
            client.xadd(STREAM, {"tenant_id": TENANT_A, "kind": "transaction", "id": tx, "ingested_at": str(time.time())})
    finally:
        client.close()


@pytest.fixture(scope="module")
def loop(client, world) -> dict:
    now = datetime.now(UTC).replace(microsecond=0)
    a, b, c = world.account, world.other_account, f"{world.account}_c"
    legs = [(f"{world.tx}_l1", a, b, now - timedelta(hours=3)), (f"{world.tx}_l2", b, c, now - timedelta(hours=2)), (f"{world.tx}_l3", c, a, now - timedelta(hours=1))]
    events = [
        {"kind": "transaction", "id": tx, "from_account_id": s, "to_account_id": d, "amount": "200000.00", "channel": "neft", "value_ts": iso(ts)}
        for tx, s, d, ts in legs
    ]
    assert client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A)).status_code == 202

    def fetch():
        items = client.get("/v1/alerts", params={"rule": "R-CIRC", "entity": a}, headers=world.bearer(TENANT_A)).json()["items"]
        return items[0] if items else None

    first, _ = poll(fetch)
    return {"first": first, "legs": sorted(tx for tx, *_ in legs), "fetch": fetch}


def test_planting_s1_replaces_the_earlier_alert_with_a_freshly_detected_one(client, world, loop):
    first = loop["first"]
    assert client.post(f"/v1/alerts/{first['id']}/acknowledge", headers=world.bearer(TENANT_A)).status_code == 200

    removed, txs = asyncio.run(_clear(world.tx))
    assert removed == [first["id"]] and txs == loop["legs"]
    assert client.get(f"/v1/alerts/{first['id']}", headers=world.bearer(TENANT_A)).status_code == 404
    assert asyncio.run(_audit(world.tx))[-1] == {"removed_alerts": [first["id"]], "events": loop["legs"]}

    _publish(txs)
    fresh, elapsed = poll(loop["fetch"])
    print(f"\nS1 replant publish->alert latency: {elapsed:.0f} ms")
    assert elapsed < 5000
    assert fresh["id"] != first["id"] and fresh["status"] == "open" and fresh["occurrence_count"] == 1
    detail = client.get(f"/v1/alerts/{fresh['id']}", headers=world.bearer(TENANT_A)).json()
    assert sorted(e["ref_id"] for e in detail["evidence"] if e["evidence_type"] == "transaction") == loop["legs"]


def test_an_alert_held_by_a_case_is_never_removed(client, world, loop):
    alert_id = loop["fetch"]()["id"]
    case_id = new_id("case")
    asyncio.run(_make_case(case_id))
    assert client.post(f"/v1/alerts/{alert_id}/link-case", json={"case_id": case_id}, headers=world.bearer(TENANT_A)).status_code == 200
    with pytest.raises(ReplantRefused, match="linked to a case"):
        asyncio.run(_clear(world.tx))
    assert client.get(f"/v1/alerts/{alert_id}", headers=world.bearer(TENANT_A)).status_code == 200


def test_a_scenario_with_no_transfers_is_refused(client, world):
    with pytest.raises(ReplantRefused, match="nothing to plant"):
        asyncio.run(_clear(f"{world.tx}_absent"))
