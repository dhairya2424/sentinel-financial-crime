"""Remove every synthetic record from a tenant, keeping only the planted demo loop (tx_demo_loop_*).

What stays: the loop's transfers, the accounts they move between, and the customers who hold those accounts.
Users (logins), rules and the append-only audit log are never touched. Everything else in the domain tables is
deleted, so all further data comes from real entry (the Add data screen or POST /v1/ingest/events).

    python -m app.seed.reset_to_loop --dry-run
    python -m app.seed.reset_to_loop

Restart the API (or call admin POST /v1/graph/rebuild) afterwards so the in-memory graph matches.
"""

import argparse
import asyncio

from sqlalchemy import delete, select, update

from app.db import SessionLocal, engine
from app.models import AccessRight, Account, Customer, Employee, EmployeeAction, EmployeeSession, Transaction

LOOP_PREFIX = "tx_demo_loop_"


async def reset(tenant_id: str, dry_run: bool) -> dict[str, int]:
    async with SessionLocal() as db, db.begin():
        loop = (await db.execute(select(Transaction).where(Transaction.tenant_id == tenant_id, Transaction.id.like(f"{LOOP_PREFIX}%")))).scalars().all()
        if not loop:
            raise SystemExit(f"no {LOOP_PREFIX}* transactions in {tenant_id}; refusing to wipe without the loop to keep")
        keep_tx = {t.id for t in loop}
        keep_accounts = {a for t in loop for a in (t.from_account_id, t.to_account_id) if a}
        keep_customers = set(await db.scalars(select(Account.customer_id).where(Account.id.in_(keep_accounts))))

        plan = [
            (EmployeeAction, EmployeeAction.tenant_id == tenant_id),
            (EmployeeSession, EmployeeSession.tenant_id == tenant_id),
            (AccessRight, AccessRight.tenant_id == tenant_id),
            (Transaction, (Transaction.tenant_id == tenant_id) & Transaction.id.not_in(keep_tx)),
            (Account, (Account.tenant_id == tenant_id) & Account.id.not_in(keep_accounts)),
            (Customer, (Customer.tenant_id == tenant_id) & Customer.id.not_in(keep_customers)),
            (Employee, Employee.tenant_id == tenant_id),
        ]
        counts: dict[str, int] = {}
        for model, where in plan:
            if model is Employee:
                await db.execute(update(Employee).where(where).values(manager_id=None))
            counts[model.__tablename__] = (await db.execute(delete(model).where(where))).rowcount
        counts["kept_transactions"], counts["kept_accounts"], counts["kept_customers"] = len(keep_tx), len(keep_accounts), len(keep_customers)
        if dry_run:
            await db.rollback()
    await engine.dispose()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tenant", default="tenant_demo")
    parser.add_argument("--dry-run", action="store_true", help="report what would be deleted, change nothing")
    args = parser.parse_args()
    counts = asyncio.run(reset(args.tenant, args.dry_run))
    print(("DRY RUN, nothing changed: " if args.dry_run else "") + ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
