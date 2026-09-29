import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models import Account, Customer, Employee, EmployeeAction, Transaction

from .conftest import TENANT_A, TENANT_B


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@pytest.fixture(scope="module")
def loop(client, world) -> dict:
    now = datetime.now(UTC).replace(microsecond=0)
    a, b, c = world.account, world.other_account, f"{world.account}_c"
    legs = [
        (f"{world.tx}_g1", a, b, now - timedelta(hours=3)),
        (f"{world.tx}_g2", b, c, now - timedelta(hours=2)),
        (f"{world.tx}_g3", c, a, now - timedelta(hours=1)),
    ]
    events = [
        {"kind": "transaction", "id": tx, "from_account_id": s, "to_account_id": d, "amount": "210000.00", "channel": "neft", "value_ts": iso(ts)}
        for tx, s, d, ts in legs
    ]
    events.append(
        {
            "kind": "employee_action",
            "id": f"{world.action}_g",
            "employee_id": world.employee,
            "action_type": "limit.change",
            "target_type": "account",
            "target_id": a,
            "before_state": {"daily_transfer_limit": 100000},
            "after_state": {"daily_transfer_limit": 900000},
            "event_ts": iso(now - timedelta(hours=4)),
        }
    )
    r = client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A))
    assert r.status_code == 202 and r.json()["accepted"] == 4, r.text
    return {"a": a, "b": b, "c": c, "legs": [tx for tx, *_ in legs]}


def test_cycles_endpoint_finds_the_planted_loop_live(client, world, loop):
    """T-GRPH-02 through the API: ingest updates the graph immediately and the loop comes back with its legs."""
    r = client.get(f"/v1/graph/cycles?node_id={loop['a']}&window_hours=72", headers=world.bearer(TENANT_A))
    assert r.status_code == 200, r.text
    assert r.json() == {"cycles": [[loop["a"], loop["b"], loop["c"]]], "legs": [loop["legs"]]}
    short = client.get(f"/v1/graph/cycles?node_id={loop['a']}&window_hours=1", headers=world.bearer(TENANT_A)).json()
    assert short["cycles"] == []


def test_neighbors_returns_reactflow_shape_with_edge_filter(client, world, loop):
    headers = world.bearer(TENANT_A)
    body = client.get(f"/v1/graph/neighbors?node_id={world.customer}&depth=2", headers=headers).json()
    ids = {n["id"] for n in body["nodes"]}
    assert {world.customer, loop["a"], loop["b"], loop["c"], world.employee} <= ids
    node = next(n for n in body["nodes"] if n["id"] == loop["a"])
    assert set(node) >= {"id", "type", "label", "risk", "degree"} and node["type"] == "account"
    types = {e["type"] for e in body["edges"]}
    assert {"ACCOUNT_HOLDER", "TRANSFER", "PROFILE_CHANGE"} <= types
    transfer = next(e for e in body["edges"] if e["id"] == loop["legs"][0])
    assert transfer["source"] == loop["a"] and transfer["props"]["amount"] == "210000.00"

    filtered = client.get(f"/v1/graph/neighbors?node_id={loop['a']}&depth=1&edge_types=TRANSFER", headers=headers).json()
    assert {e["type"] for e in filtered["edges"]} == {"TRANSFER"}
    assert client.get(f"/v1/graph/neighbors?node_id={loop['a']}&edge_types=WIRE", headers=headers).status_code == 422
    assert client.get(f"/v1/graph/neighbors?node_id={loop['a']}&depth=3", headers=headers).status_code == 422


def test_search_and_entity_summary(client, world, loop):
    headers = world.bearer(TENANT_A, "viewer")
    hits = client.get("/v1/graph/search?q=integration", headers=headers).json()
    assert {(h["type"], h["id"]) for h in hits} >= {("customer", world.customer), ("employee", world.employee)}
    by_id = client.get(f"/v1/graph/search?q={world.account}&types=account", headers=headers).json()
    assert by_id[0]["id"] == world.account and by_id[0]["detail"] == "Integration Customer"
    assert client.get("/v1/graph/search?q=x&types=planet", headers=headers).status_code == 422

    summary = client.get(f"/v1/graph/entity/{world.customer}", headers=headers).json()
    assert summary["type"] == "customer" and summary["label"] == "Integration Customer"
    assert summary["links"]["timeline"] == f"/timeline/customer/{world.customer}"
    assert summary["stats"]["accounts"] == 1 and summary["stats"]["degree"] >= 1
    assert summary["stats"]["transfer_count_30d"] == 2
    account = client.get(f"/v1/graph/entity/{loop['a']}", headers=headers).json()
    assert account["type"] == "account" and account["stats"]["sum_amount_30d"] == "420000.00"


def test_t_grph_06_foreign_tenant_gets_404(client, world, loop):
    """T-GRPH-06 through the API: tenant B cannot see tenant A's nodes."""
    headers = world.bearer(TENANT_B)
    assert client.get(f"/v1/graph/neighbors?node_id={loop['a']}", headers=headers).status_code == 404
    assert client.get(f"/v1/graph/cycles?node_id={loop['a']}", headers=headers).status_code == 404
    assert client.get(f"/v1/graph/entity/{world.customer}", headers=headers).status_code == 404
    assert client.get("/v1/graph/search?q=integration", headers=headers).json() == []


async def _sql_counts(tenant: str) -> dict[str, int]:
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    async with own.connect() as db:
        transfers = await db.scalar(
            select(func.count()).where(
                Transaction.tenant_id == tenant,
                Transaction.status == "completed",
                Transaction.from_account_id.is_not(None),
                Transaction.to_account_id.is_not(None),
            )
        )
        holders = await db.scalar(select(func.count()).select_from(Account).where(Account.tenant_id == tenant))
        profile = await db.scalar(
            select(func.count()).where(
                EmployeeAction.tenant_id == tenant,
                EmployeeAction.action_type.in_(["profile.edit", "beneficiary.add", "limit.change"]),
                EmployeeAction.target_type.in_(["customer", "account"]),
            )
        )
        on_tx = await db.scalar(select(func.count()).where(EmployeeAction.tenant_id == tenant, EmployeeAction.target_type == "transaction"))
        nodes = sum(
            [
                await db.scalar(select(func.count()).select_from(Customer).where(Customer.tenant_id == tenant)),
                holders,
                await db.scalar(select(func.count()).select_from(Employee).where(Employee.tenant_id == tenant)),
            ]
        )
    await own.dispose()
    return {"TRANSFER": transfers, "ACCOUNT_HOLDER": holders, "PROFILE_CHANGE": profile, "EMPLOYEE_ACTION": on_tx, "nodes": nodes}


def test_t_grph_01_rebuild_matches_sql_counts(client, world, loop):
    """T-GRPH-01 on the database: an admin rebuild's per-type counts equal the SQL counts."""
    assert client.post("/v1/graph/rebuild", headers=world.bearer(TENANT_A)).status_code == 403
    r = client.post("/v1/graph/rebuild", headers=world.bearer(TENANT_A, "admin"))
    assert r.status_code == 200, r.text
    stats = r.json()
    expected = asyncio.run(_sql_counts(TENANT_A))
    for edge_type in ("TRANSFER", "ACCOUNT_HOLDER", "PROFILE_CHANGE", "EMPLOYEE_ACTION"):
        assert stats["edges"][edge_type] == expected[edge_type], edge_type
    assert stats["nodes"] == expected["nodes"]
    assert client.get(f"/v1/graph/cycles?node_id={loop['a']}", headers=world.bearer(TENANT_A)).json()["legs"] == [loop["legs"]]
