import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.auth.jwt import create_access_token
from app.db import SessionLocal, engine
from app.main import app
from app.models import Account, Customer, Employee, EmployeeAction, EmployeeSession, Transaction
from app.seed.users import ensure_tenant

TENANT_A = "tenant_itest_a"
TENANT_B = "tenant_itest_b"


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
        for model in (EmployeeAction, EmployeeSession, Transaction, Account, Customer, Employee):
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
