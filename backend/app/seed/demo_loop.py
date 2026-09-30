"""Create the planted demo loop on a fresh database: the one deliberate fixture in a tenant that otherwise holds only
real, user-entered data (docs/12 §2).

    python -m app.seed.demo_loop            # idempotent: rows that already exist are left exactly as they are
    python -m app.seed.demo_loop --dry-run  # say what is missing, change nothing

Three customers each hold one savings account, and ₹2,40,000 moves round them in three NEFT legs two hours apart:
Karan Apte (XXXXXXXX1158) → Priya Khan (XXXXXXXX5082) → Nikhil Gokhale (XXXXXXXX8018) → Karan Apte. That is ₹7.2 lakh
within four hours, over the ₹5 lakh R-CIRC minimum. The customers and accounts are written with fixed ids so the
demo script and `app.seed.suspicious --only S1` find them. The transfers go through the ingest path, so they are
audited (`ingest.batch`) and published, and a running API's pipeline raises the R-CIRC alert.

A running API built its in-memory graph at startup, before these rows existed, so the seed then asks it to rebuild
the tenant graph (`POST /v1/graph/rebuild` as the seeded admin, API at SEED_API_URL, default http://127.0.0.1:8000).
Without that, Graph Explorer would not know the loop's holders. With no API running, startup builds it anyway.
"""

import argparse
import asyncio
import os
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from sqlalchemy import select

from app.auth.jwt import create_access_token
from app.config import get_settings
from app.db import SessionLocal, engine
from app.graph.service import graph_service
from app.models import Account, Customer, Transaction, User
from app.redis_client import redis
from app.schemas.ingest import TransactionEvent
from app.seed.users import DemoSeedRefused, ensure_tenant
from app.services.ingest import ingest_events

CUSTOMERS = [
    {"id": "cust_01fy9zww20m7mhbdry64d6z58a", "external_ref": "CIF100018", "name": "Karan Apte", "kyc_status": "verified", "risk_rating": "low", "segment": "salaried"},
    {"id": "cust_01j94nha205rmc7vsb3meas5v7", "external_ref": "CIF100027", "name": "Priya Khan", "kyc_status": "verified", "risk_rating": "standard", "segment": "senior"},
    {"id": "cust_01g8v9z1208ydqswynne6hrdcm", "external_ref": "CIF100036", "name": "Nikhil Gokhale", "kyc_status": "verified", "risk_rating": "standard", "segment": "salaried"},
]
ACCOUNTS = [
    {"id": "acct_01f0y4th20byjhmy804nrfee3a", "customer_id": CUSTOMERS[0]["id"], "account_no_masked": "XXXXXXXX1158", "type": "savings", "opened_at": datetime(2021, 3, 16, 18, 30, tzinfo=UTC)},
    {"id": "acct_01jxaz9q20fwwajcfd7sftytff", "customer_id": CUSTOMERS[1]["id"], "account_no_masked": "XXXXXXXX5082", "type": "savings", "opened_at": datetime(2025, 6, 9, 18, 30, tzinfo=UTC)},
    {"id": "acct_01dy8bgr20yd5qcp477nt46e1r", "customer_id": CUSTOMERS[2]["id"], "account_no_masked": "XXXXXXXX8018", "type": "savings", "opened_at": datetime(2020, 1, 10, 18, 30, tzinfo=UTC)},
]
AMOUNT = Decimal("240000.00")
LEGS = [
    ("tx_demo_loop_1", ACCOUNTS[0]["id"], ACCOUNTS[1]["id"], datetime(2026, 9, 28, 3, 37, 19, tzinfo=UTC)),
    ("tx_demo_loop_2", ACCOUNTS[1]["id"], ACCOUNTS[2]["id"], datetime(2026, 9, 28, 5, 37, 19, tzinfo=UTC)),
    ("tx_demo_loop_3", ACCOUNTS[2]["id"], ACCOUNTS[0]["id"], datetime(2026, 9, 28, 7, 37, 19, tzinfo=UTC)),
]


def legs() -> list[TransactionEvent]:
    return [
        TransactionEvent(kind="transaction", id=tx_id, from_account_id=src, to_account_id=dst, amount=AMOUNT, channel="neft", value_ts=ts,
                         raw={"narration": f"TRANSFER DEMO LOOP LEG {n}"})
        for n, (tx_id, src, dst, ts) in enumerate(LEGS, start=1)
    ]


async def seed(tenant_id: str, dry_run: bool) -> str:
    async with SessionLocal() as db:
        have_c = set(await db.scalars(select(Customer.id).where(Customer.id.in_([c["id"] for c in CUSTOMERS]))))
        have_a = set(await db.scalars(select(Account.id).where(Account.id.in_([a["id"] for a in ACCOUNTS]))))
        have_t = set(await db.scalars(select(Transaction.id).where(Transaction.id.in_([t[0] for t in LEGS]))))
        missing = f"{len(CUSTOMERS) - len(have_c)} customers, {len(ACCOUNTS) - len(have_a)} accounts, {len(LEGS) - len(have_t)} transfers"
        if dry_run:
            return f"DRY RUN, nothing changed: {tenant_id} is missing {missing}"
        await ensure_tenant(db, tenant_id)
        db.add_all(Customer(tenant_id=tenant_id, **c) for c in CUSTOMERS if c["id"] not in have_c)
        await db.flush()
        db.add_all(Account(tenant_id=tenant_id, **a) for a in ACCOUNTS if a["id"] not in have_a)
        await db.commit()
        result = await ingest_events(db, tenant_id, legs(), actor_user=None)
    if result.failed:
        raise SystemExit(f"loop transfers rejected: {result.errors}")
    return f"{tenant_id}: added {missing}; transfers accepted {len(result.accepted)}, already present {result.skipped}"


async def refresh_api_graph(tenant_id: str) -> str:
    """Ask a running API to rebuild this tenant's graph from PostgreSQL, as the tenant's admin."""
    async with SessionLocal() as db:
        admin = await db.scalar(select(User.id).where(User.tenant_id == tenant_id, User.role == "admin", User.is_active.is_(True)).limit(1))
    if admin is None:
        return "graph: no admin user to rebuild it with (run app.seed.users first); restart the API instead"
    url = os.environ.get("SEED_API_URL", "http://127.0.0.1:8000").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{url}/v1/graph/rebuild", headers={"Authorization": f"Bearer {create_access_token(admin, tenant_id, 'admin')}"})
    except httpx.HTTPError:
        return f"graph: no API at {url}; it builds the graph when it starts"
    if r.status_code != 200:
        return f"graph: rebuild at {url} answered {r.status_code}; restart the API instead"
    body = r.json()
    return f"graph: rebuilt in the running API ({body.get('nodes')} nodes)"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    if settings.ENV == "production":
        raise DemoSeedRefused("the demo loop is a planted fixture and is never seeded with ENV=production")

    async def run() -> str:
        try:
            summary = await seed(settings.TENANT_DEFAULT, args.dry_run)
            if args.dry_run:
                return summary
            return f"{summary}\n{await refresh_api_graph(settings.TENANT_DEFAULT)}"
        finally:
            graph_service.forget(settings.TENANT_DEFAULT)
            await redis.aclose()
            await engine.dispose()

    print(asyncio.run(run()))


if __name__ == "__main__":
    main()
