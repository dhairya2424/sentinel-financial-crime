"""T-INT-17 (rules admin) and T-INT-19 (ops replay), docs/10 §5; docs/05 §6 Rules & Ops."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.detection.config import DEFAULTS, load_rule_configs
from app.ids import new_id
from app.models import Account, AuditLog, IngestFailure, Rule, Transaction

from .conftest import TENANT_A, TENANT_B


def db_run(work: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async def go() -> Any:
        own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
        try:
            async with AsyncSession(own) as db, db.begin():
                return await work(db)
        finally:
            await own.dispose()

    return asyncio.run(go())


@pytest.fixture(scope="module", autouse=True)
def clean_rules():
    def wipe():
        return db_run(lambda db: db.execute(delete(Rule).where(Rule.tenant_id.in_([TENANT_A, TENANT_B]))))

    wipe()
    yield
    wipe()


def rules(client, world, tenant=TENANT_A, role="viewer") -> dict[str, dict]:
    r = client.get("/v1/rules", headers=world.bearer(tenant, role))
    assert r.status_code == 200, r.text
    return {row["code"]: row for row in r.json()}


def test_every_role_reads_the_rules_detection_uses(client, world):
    for role in ("viewer", "investigator", "manager", "admin"):
        listed = rules(client, world, role=role)
        assert list(listed) == list(DEFAULTS)
    circ = listed["R-CIRC"]
    assert circ["version"] == 0 and circ["kind"] == "primary" and circ["params"]["min_cycle_amount"] == 500000
    assert listed["R-DORMANT"]["kind"] == "supporting"


def test_t_int_17_weights_not_summing_to_one_are_rejected(client, world):
    """T-INT-17: weights must sum to 1.0 ±0.001 -> 422, and nothing is written."""
    admin = world.bearer(TENANT_A, "admin")
    bad = {"linkage_depth": 0.3, "amount": 0.35, "temporal_proximity": 0.25, "account_velocity": 0.15}
    r = client.put("/v1/rules/R-CIRC", json={"weights": bad}, headers=admin)
    assert r.status_code == 422 and "sum to 1.0" in r.text
    for body, needle in (
        ({"weights": {"amount": 1.0}}, "missing"),
        ({"weights": {**bad, "linkage_depth": 0.25, "made_up": 0.0}}, "unknown factor"),
        ({"params": {"window_hours": "72"}}, "must be int"),
        ({"params": {"no_such_param": 1}}, "unknown param"),
        ({"version": 9}, "extra"),
        ({}, "at least one"),
    ):
        r = client.put("/v1/rules/R-CIRC", json=body, headers=admin)
        assert r.status_code == 422 and needle in r.text, (body, r.text)
    assert client.put("/v1/rules/R-NOPE", json={"enabled": False}, headers=admin).status_code == 404
    assert rules(client, world)["R-CIRC"]["version"] == 0


def test_t_int_17_a_valid_update_adds_version_plus_one_that_detection_loads(client, world):
    """T-INT-17: success inserts version+1 (a new row, the old one kept), audits rule.update, and the detection
    config loader picks the latest version."""
    admin = world.bearer(TENANT_A, "admin")
    started = datetime.now(UTC) - timedelta(seconds=1)
    weights = {"sub_threshold_ratio": 0.4, "velocity_vs_baseline": 0.2, "total_amount": 0.25, "destination_spread": 0.15}
    first = client.put("/v1/rules/R-STRUCT", json={"weights": weights, "params": {"min_in_band": 4}}, headers=admin)
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 1 and first.json()["updated_by"] == "usr_itest_admin"
    second = client.put("/v1/rules/R-STRUCT", json={"enabled": False}, headers=admin)
    assert second.json()["version"] == 2 and second.json()["enabled"] is False
    assert second.json()["weights"] == weights and second.json()["params"]["min_in_band"] == 4
    same = client.put("/v1/rules/R-STRUCT", json={"enabled": False}, headers=admin)
    assert same.status_code == 200 and same.json()["version"] == 2, "a PUT that changes nothing adds no version"

    async def check(db: AsyncSession) -> None:
        versions = list(await db.scalars(select(Rule.version).where(Rule.tenant_id == TENANT_A, Rule.code == "R-STRUCT").order_by(Rule.version)))
        assert versions == [1, 2]
        loaded = (await load_rule_configs(db, TENANT_A))["R-STRUCT"]
        assert loaded.version == 2 and loaded.enabled is False and loaded.params["min_in_band"] == 4
        audits = list(
            await db.scalars(
                select(AuditLog)
                .where(AuditLog.tenant_id == TENANT_A, AuditLog.action == "rule.update", AuditLog.object_id == "R-STRUCT", AuditLog.created_at >= started)
                .order_by(AuditLog.id)
            )
        )
        assert len(audits) == 2
        assert audits[-1].detail["from_version"] == 1 and audits[-1].detail["changed"] == {"enabled": {"from": True, "to": False}}

    db_run(check)
    assert rules(client, world, TENANT_B)["R-STRUCT"]["version"] == 0, "another tenant's rules are untouched"
    client.put("/v1/rules/R-STRUCT", json={"enabled": True}, headers=admin)


@pytest.mark.parametrize("role", ["viewer", "investigator", "manager"])
def test_only_admin_writes_rules(client, world, role):
    r = client.put("/v1/rules/R-CIRC", json={"enabled": False}, headers=world.bearer(TENANT_A, role))
    assert r.status_code == 403


def _dead_letter(client, world, event_id: str, account_id: str) -> str:
    event = {"kind": "transaction", "id": event_id, "from_account_id": world.account, "to_account_id": account_id, "amount": "3100.00",
             "channel": "neft", "value_ts": (datetime.now(UTC) - timedelta(hours=2)).isoformat().replace("+00:00", "Z")}
    r = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A))
    assert r.status_code == 202 and r.json()["failed"] == 1, r.text

    async def find(db: AsyncSession) -> str:
        return await db.scalar(select(IngestFailure.id).where(IngestFailure.tenant_id == TENANT_A, IngestFailure.payload["id"].astext == event_id))

    return db_run(find)


def test_t_int_19_replay_applies_a_dead_lettered_event_once(client, world):
    """T-INT-19: an event rejected for an unknown account is replayed after the account is registered: the event is
    applied, replayed_at is set, ops.replay is audited, and a second replay is refused."""
    late = f"{world.account}_late"
    event_id = f"{world.tx}_replay"
    failure_id = _dead_letter(client, world, event_id, late)
    admin = world.bearer(TENANT_A, "admin")

    again = client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=admin)
    assert again.status_code == 409 and "not registered" in again.text

    async def register_late_account(db: AsyncSession) -> int:
        db.add(Account(id=late, tenant_id=TENANT_A, customer_id=world.customer, account_no_masked=f"XXXXLT{world.suffix}", type="current"))
        return await db.scalar(select(func.count()).select_from(IngestFailure).where(IngestFailure.payload["id"].astext == event_id))

    assert db_run(register_late_account) == 1, "a failed replay does not dead-letter the event a second time"

    r = client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stage"] == "ingest" and body["outcome"] == "applied" and body["event_id"] == event_id and body["replayed_at"]

    async def check(db: AsyncSession) -> None:
        assert (await db.get(Transaction, event_id)).to_account_id == late
        assert (await db.get(IngestFailure, failure_id)).replayed_at is not None
        audit = await db.scalar(select(AuditLog).where(AuditLog.action == "ops.replay", AuditLog.object_id == failure_id))
        assert audit.actor_user == "usr_itest_admin" and audit.detail["outcome"] == "applied"

    db_run(check)
    assert client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=admin).status_code == 409


def test_replay_reprocesses_a_pipeline_stage_failure(client, world):
    """A pipeline-stage failure (payload.stage = "pipeline") re-runs detection on the stored row."""
    event_id = f"{world.tx}_pipe"
    event = {"kind": "transaction", "id": event_id, "from_account_id": world.account, "to_account_id": world.other_account,
             "amount": "990.00", "value_ts": "2026-09-24T10:00:00Z"}
    assert client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A)).json()["accepted"] == 1
    failure_id = new_id("fail")

    async def park(db: AsyncSession) -> None:
        db.add(IngestFailure(id=failure_id, tenant_id=TENANT_A, payload={"stage": "pipeline", "tenant_id": TENANT_A, "kind": "transaction", "id": event_id},
                             error="RuntimeError: simulated"))

    db_run(park)
    r = client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=world.bearer(TENANT_A, "admin"))
    assert r.status_code == 200, r.text
    assert r.json()["stage"] == "pipeline" and r.json()["outcome"] == "reprocessed" and r.json()["alert_changes"] == 0


def test_replay_is_admin_only_and_tenant_scoped(client, world):
    failure_id = _dead_letter(client, world, f"{world.tx}_scoped", f"{world.account}_never")
    for role in ("viewer", "investigator", "manager"):
        assert client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=world.bearer(TENANT_A, role)).status_code == 403
    assert client.post("/v1/ops/replay-batch", json={"failure_id": failure_id}, headers=world.bearer(TENANT_B, "admin")).status_code == 404
    assert client.post("/v1/ops/replay-batch", json={"failure_id": "fail_missing"}, headers=world.bearer(TENANT_A, "admin")).status_code == 404
    assert client.post("/v1/ops/replay-batch", json={"failure_id": failure_id, "batch": 1}, headers=world.bearer(TENANT_A, "admin")).status_code == 422
