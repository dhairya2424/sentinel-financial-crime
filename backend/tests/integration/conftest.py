import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert

from app.auth.jwt import create_access_token
from app.db import SessionLocal, engine
from app.main import app
from app.models import Account, Alert, Case, Customer, Employee, EmployeeAction, EmployeeSession, IngestFailure, Transaction, User
from app.seed.users import ensure_tenant

TENANT_A = "tenant_itest_a"
TENANT_B = "tenant_itest_b"
ROLES = ("admin", "manager", "investigator", "viewer")


def poll(fetch: Callable[[], Any], timeout: float = 5.0, interval: float = 0.05) -> tuple[Any, float]:
    """Call fetch until it returns something truthy; return it with the elapsed milliseconds, or fail at timeout."""
    started = time.perf_counter()
    while True:
        value = fetch()
        elapsed = (time.perf_counter() - started) * 1000
        if value:
            return value, elapsed
        if elapsed > timeout * 1000:
            raise AssertionError(f"nothing after {elapsed:.0f} ms")
        time.sleep(interval)


@dataclass(frozen=True)
class World:
    suffix: str
    customer: str
    account: str
    other_account: str
    employee: str
    tx: str
    action: str
    session: str

    def bearer(self, tenant: str, role: str = "investigator") -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(f'usr_itest_{role}', tenant, role)}"}


async def _build(world: World) -> None:
    async with SessionLocal() as db, db.begin():
        for tenant in (TENANT_A, TENANT_B):
            await ensure_tenant(db, tenant)
        for role in ROLES:
            await db.execute(
                insert(User)
                .values(id=f"usr_itest_{role}", tenant_id=TENANT_A, email=f"{role}@itest.dev", password_hash="unused", full_name=f"Itest {role}", role=role)
                .on_conflict_do_nothing()
            )
        db.add(Customer(id=world.customer, tenant_id=TENANT_A, external_ref=f"IT-{world.suffix}", name="Integration Customer"))
        await db.flush()
        payee = f"{world.customer}_payee"
        db.add(Customer(id=payee, tenant_id=TENANT_A, external_ref=f"IT-P-{world.suffix}", name="Integration Payee"))
        await db.flush()
        for account_id, owner, tail in ((world.account, world.customer, ""), (world.other_account, payee, "P"), (f"{world.account}_c", payee, "C")):
            db.add(
                Account(
                    id=account_id,
                    tenant_id=TENANT_A,
                    customer_id=owner,
                    account_no_masked=f"XXXXIT{world.suffix}{tail}",
                    type="savings",
                )
            )
        db.add(
            Employee(
                id=world.employee,
                tenant_id=TENANT_A,
                external_ref=f"IT-E-{world.suffix}",
                name="Integration Employee",
                role="manager",
            )
        )
        await db.flush()
        db.add(EmployeeSession(id=world.session, tenant_id=TENANT_A, employee_id=world.employee, started_at=datetime(2026, 9, 22, 10, tzinfo=UTC)))
    await engine.dispose()


async def _teardown() -> None:
    async with SessionLocal() as db, db.begin():
        for model in (Alert, Case, IngestFailure, EmployeeAction, EmployeeSession, Transaction, Account, Customer, Employee):
            await db.execute(delete(model).where(model.tenant_id.in_([TENANT_A, TENANT_B])))
    await engine.dispose()


@pytest.fixture(scope="module")
def world() -> World:
    s = uuid.uuid4().hex[:10]
    w = World(
        suffix=s,
        customer=f"cust_it_{s}",
        account=f"acct_it_{s}",
        other_account=f"acct_it_{s}_payee",
        employee=f"emp_it_{s}",
        tx=f"tx_it_{s}",
        action=f"act_it_{s}",
        session=f"sess_it_{s}",
    )
    asyncio.run(_teardown())
    asyncio.run(_build(w))
    yield w
    asyncio.run(_teardown())


@pytest.fixture(scope="module")
def client(world: World):
    with TestClient(app) as c:
        yield c
