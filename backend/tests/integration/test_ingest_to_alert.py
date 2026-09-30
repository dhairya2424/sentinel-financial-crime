"""T-INT-05 and the Alerts API: a planted loop is ingested, detected, persisted with frozen evidence and served."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.ids import new_id
from app.models import Case

from .conftest import TENANT_A, TENANT_B, poll


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@pytest.fixture(scope="module")
def planted(client, world) -> dict:
    now = datetime.now(UTC).replace(microsecond=0)
    a, b, c = world.account, world.other_account, f"{world.account}_c"
    legs = [
        (f"{world.tx}_l1", a, b, now - timedelta(hours=3)),
        (f"{world.tx}_l2", b, c, now - timedelta(hours=2)),
        (f"{world.tx}_l3", c, a, now - timedelta(hours=1)),
    ]
    events = [
        {"kind": "transaction", "id": tx, "from_account_id": s, "to_account_id": d, "amount": "210000.00", "channel": "neft", "value_ts": iso(ts)}
        for tx, s, d, ts in legs
    ]
    r = client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A))
    assert r.status_code == 202 and r.json()["accepted"] == 3, r.text

    def fetch():
        items = client.get("/v1/alerts", params={"rule": "R-CIRC", "entity": a}, headers=world.bearer(TENANT_A)).json()["items"]
        return items[0] if items else None

    row, elapsed = poll(fetch, timeout=5.0)
    print(f"\nT-INT-05 ingest->alert latency: {elapsed:.0f} ms")
    return {"row": row, "elapsed": elapsed, "legs": [tx for tx, *_ in legs], "accounts": [a, b, c]}


def test_t_int_05_planted_cycle_raises_rcirc_alert_within_budget(client, world, planted):
    """T-INT-05: planted 3-cycle -> R-CIRC alert <= 5000 ms; band high/critical; >= 3 transaction snapshots."""
    assert planted["elapsed"] < 5000
    row = planted["row"]
    assert row["rule_code"] == "R-CIRC" and row["status"] == "open" and row["occurrence_count"] == 1
    assert row["amount_total"] == "630000.00"
    detail = client.get(f"/v1/alerts/{row['id']}", headers=world.bearer(TENANT_A)).json()
    assert detail["risk_band"] in ("high", "critical")
    assert "loop" in detail["explanation"]
    assert f"XXXXIT{world.suffix} (Integration Customer)" in detail["explanation"] and world.account not in detail["explanation"]
    snaps = [e for e in detail["evidence"] if e["evidence_type"] == "transaction"]
    assert sorted(e["ref_id"] for e in snaps) == sorted(planted["legs"])
    assert all(e["snapshot"]["amount"] == "210000.00" and e["snapshot"]["id"] == e["ref_id"] for e in snaps)
    total = sum(f["contribution"] for f in detail["risk_factors"])
    assert abs(total - detail["risk_score"] / 100) <= 0.011
    assert set(planted["accounts"]) <= set(detail["entity_ids"])


def test_alert_list_filters_and_tenant_isolation(client, world, planted):
    alert_id = planted["row"]["id"]
    h = world.bearer(TENANT_A, "viewer")
    assert alert_id in [i["id"] for i in client.get("/v1/alerts", params={"band": "high,critical"}, headers=h).json()["items"]]
    assert client.get("/v1/alerts", params={"band": "low"}, headers=h).json()["items"] == []
    assert client.get("/v1/alerts", params={"band": "extreme"}, headers=h).status_code == 422
    assert client.get(f"/v1/alerts/{alert_id}", headers=world.bearer(TENANT_B)).status_code == 404
    assert alert_id not in [i["id"] for i in client.get("/v1/alerts", headers=world.bearer(TENANT_B)).json()["items"]]


def test_alert_graph_holds_the_loop(client, world, planted):
    body = client.get(f"/v1/alerts/{planted['row']['id']}/graph", headers=world.bearer(TENANT_A, "viewer")).json()
    ids = {n["id"] for n in body["nodes"]}
    assert set(planted["accounts"]) <= ids
    assert {e["id"] for e in body["edges"] if e["type"] == "TRANSFER"} >= set(planted["legs"])


async def _make_case(case_id: str) -> None:
    # A private NullPool engine: the app's pool belongs to the TestClient's event loop.
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    async with AsyncSession(own) as db, db.begin():
        db.add(Case(id=case_id, tenant_id=TENANT_A, case_number=f"CASE-IT-{case_id[-6:]}", title="Integration case", created_by="usr_itest_investigator"))
    await own.dispose()


def test_acknowledge_and_link_follow_the_lifecycle(client, world, planted):
    alert_id = planted["row"]["id"]
    assert client.post(f"/v1/alerts/{alert_id}/acknowledge", headers=world.bearer(TENANT_A, "viewer")).status_code == 403
    r = client.post(f"/v1/alerts/{alert_id}/acknowledge", headers=world.bearer(TENANT_A))
    assert r.status_code == 200 and r.json()["status"] == "acknowledged"
    again = client.post(f"/v1/alerts/{alert_id}/acknowledge", headers=world.bearer(TENANT_A))
    assert again.status_code == 409

    missing = client.post(f"/v1/alerts/{alert_id}/link-case", json={"case_id": "case_nope"}, headers=world.bearer(TENANT_A))
    assert missing.status_code == 404
    case_id = new_id("case")
    asyncio.run(_make_case(case_id))
    linked = client.post(f"/v1/alerts/{alert_id}/link-case", json={"case_id": case_id}, headers=world.bearer(TENANT_A))
    assert linked.status_code == 200, linked.text
    assert linked.json()["status"] == "linked_to_case" and linked.json()["linked_case_id"] == case_id
