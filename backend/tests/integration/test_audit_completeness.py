"""T-INT-18 full (NFR-07, docs/08 §5): one journey through every audited action leaves every mandatory audit row,
each with the acting user. demo.replant is proven in test_demo_replant.py."""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.auth.passwords import hash_password
from app.config import get_settings
from app.ids import new_id
from app.models import AuditLog, IngestFailure, Rule, User

from .conftest import TENANT_A
from .test_cases_api import _insert_alerts

MANDATORY = {
    "login", "login_failed", "ingest.batch", "alert.ack", "alert.link", "case.create", "case.assign", "case.note",
    "case.status", "case.export", "rule.update", "ops.replay", "graph.rebuild", "entity.create", "case.update",
}
PASSWORD = "Audit!Trail2026"
EMAIL = "audit.journey@itest.dev"


async def _db(work):
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    try:
        async with AsyncSession(own) as db, db.begin():
            return await work(db)
    finally:
        await own.dispose()


def test_t_int_18_every_mandatory_action_is_audited_with_its_actor(client, world):
    started = datetime.now(UTC) - timedelta(seconds=1)

    async def login_user(db: AsyncSession) -> None:
        await db.execute(
            insert(User)
            .values(id="usr_itest_audit", tenant_id=TENANT_A, email=EMAIL, full_name="Audit Journey", role="investigator", password_hash=hash_password(PASSWORD))
            .on_conflict_do_nothing()
        )

    asyncio.run(_db(login_user))
    asyncio.run(_db(lambda db: db.execute(delete(Rule).where(Rule.tenant_id == TENANT_A))))
    assert client.post("/v1/auth/login", json={"email": EMAIL, "tenant_id": TENANT_A, "password": "wrong-password-1"}).status_code == 401
    login = client.post("/v1/auth/login", json={"email": EMAIL, "tenant_id": TENANT_A, "password": PASSWORD})
    assert login.status_code == 200, login.text
    me = {"Authorization": f"Bearer {login.json()['access_token']}"}
    admin, manager = world.bearer(TENANT_A, "admin"), world.bearer(TENANT_A, "manager")

    payee = client.post("/v1/entities/customers", json={"name": "Audit Payee", "external_ref": f"AUD-{world.suffix}"}, headers=me)
    assert payee.status_code == 201, payee.text
    event = {"kind": "transaction", "id": f"{world.tx}_audit", "from_account_id": world.account, "to_account_id": world.other_account,
             "amount": "700.00", "value_ts": "2026-09-25T10:00:00Z"}
    assert client.post("/v1/ingest/events", json={"events": [event]}, headers=me).status_code == 202

    ack_id, link_id = new_id("alert"), new_id("alert")
    asyncio.run(_insert_alerts([(ack_id, [world.account], "high", 74), (link_id, [world.other_account], "high", 74)]))
    assert client.post(f"/v1/alerts/{ack_id}/acknowledge", headers=me).status_code == 200
    case = client.post("/v1/cases", json={"title": "Audit journey"}, headers=me).json()
    assert client.post(f"/v1/alerts/{link_id}/link-case", json={"case_id": case["id"]}, headers=me).status_code == 200
    assert client.post(f"/v1/cases/{case['id']}/assign", json={"assignee_id": "usr_itest_audit"}, headers=manager).status_code == 200
    assert client.post(f"/v1/cases/{case['id']}/notes", json={"body": "Called the account holder."}, headers=me).status_code == 201
    assert client.patch(f"/v1/cases/{case['id']}", json={"priority": "critical"}, headers=me).status_code == 200
    closed = client.patch(f"/v1/cases/{case['id']}", json={"status": "closed_confirmed", "close_note": "Layering confirmed with the branch."}, headers=me)
    assert closed.status_code == 200, closed.text
    assert client.get(f"/v1/cases/{case['id']}/export?format=json", headers=me).status_code == 200

    weights = {"linkage_depth": 0.3, "amount": 0.3, "temporal_proximity": 0.25, "account_velocity": 0.15}
    assert client.put("/v1/rules/R-CIRC", json={"weights": weights}, headers=admin).status_code == 200
    failure_id = new_id("fail")

    async def park(db: AsyncSession) -> None:
        db.add(IngestFailure(id=failure_id, tenant_id=TENANT_A, payload={"stage": "pipeline", "tenant_id": TENANT_A, "kind": "transaction", "id": event["id"]},
                             error="RuntimeError: simulated"))

    asyncio.run(_db(park))
    assert client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=admin).status_code == 200
    assert client.post("/v1/graph/rebuild", headers=admin).status_code == 200

    async def trail(db: AsyncSession) -> dict[str, tuple[str | None, dict]]:
        rows = (await db.execute(select(AuditLog.action, AuditLog.actor_user, AuditLog.detail).where(AuditLog.tenant_id == TENANT_A, AuditLog.created_at >= started))).all()
        return {action: (actor, detail) for action, actor, detail in rows}

    by_action = asyncio.run(_db(trail))
    assert MANDATORY <= set(by_action), f"missing audit actions: {sorted(MANDATORY - set(by_action))}"
    for action in MANDATORY - {"login_failed"}:
        assert by_action[action][0], f"{action} has no actor"
    assert by_action["login_failed"][0] is None and by_action["login_failed"][1]["email"] == EMAIL
    assert by_action["case.update"][1], "case.update records from/to"
    asyncio.run(_db(lambda db: db.execute(delete(Rule).where(Rule.tenant_id == TENANT_A))))
