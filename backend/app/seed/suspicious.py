"""Plant a known suspicious scenario live, so the demo can watch it being detected (docs/12 §2).

    python -m app.seed.suspicious --only S1 --dry-run   # say what would happen, change nothing
    python -m app.seed.suspicious --only S1

S1 is the planted demo loop (`tx_demo_loop_*`): three transfers that move money round three accounts within hours.
It is the only scenario that exists. Since the synthetic corpus was removed, tenants hold only data people entered,
plus this one planted loop, so planting S1 invents nothing. It removes the alert the loop raised earlier (unless a
case holds it) and sends the loop's transfers down the event stream again. The live pipeline then detects the loop
from scratch, and a new R-CIRC alert reaches the Alert Inbox over the WebSocket. The command waits for that alert and
prints how long detection took.

The pipeline worker runs inside the API process, so the API must be up.

S2–S5 are never planted here: their customers, accounts and staff would be invented records in a tenant that holds
real data. They run as verification fixtures in throwaway tenants that are deleted afterwards:

    python -m tests.scenarios.metrics_runner --only S2,S3,S4,S5 --skip-legit
    SCENARIO_API=http://localhost:8000 python -m tests.scenarios.metrics_runner --skip-legit   # through the running API
"""

import argparse
import asyncio
import time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import SessionLocal, engine
from app.models import Alert, AlertEvidence, CaseAlert, Transaction
from app.redis_client import redis
from app.services.ingest import publish

SCENARIOS = {"S1": ("tx_demo_loop_", "R-CIRC", "circular transfer: the planted demo loop")}
WAIT_SECONDS = 10.0


class ReplantRefused(Exception):
    """The scenario cannot be planted as things stand; the message says why and what to do."""


async def clear_for_replant(db: AsyncSession, tenant_id: str, scenario: str, prefix: str | None = None) -> tuple[list[str], list[str]]:
    """Remove the alerts the scenario's transfers raised before; return (removed alert ids, transfer ids to replay)."""
    default_prefix, rule, _ = SCENARIOS[scenario]
    prefix = prefix or default_prefix
    txs = list(await db.scalars(select(Transaction.id).where(Transaction.tenant_id == tenant_id, Transaction.id.like(f"{prefix}%")).order_by(Transaction.id)))
    if not txs:
        raise ReplantRefused(f"no {prefix}* transfers in {tenant_id}: {scenario} has nothing to plant")
    raised = (
        select(AlertEvidence.alert_id)
        .join(Alert, Alert.id == AlertEvidence.alert_id)
        .where(Alert.tenant_id == tenant_id, Alert.rule_code == rule, AlertEvidence.evidence_type == "transaction", AlertEvidence.ref_id.in_(txs))
    )
    alert_ids = sorted(set(await db.scalars(raised)))
    held = list(await db.scalars(select(CaseAlert.alert_id).where(CaseAlert.alert_id.in_(alert_ids))))
    if held:
        raise ReplantRefused(f"alert {', '.join(held)} is linked to a case; unlink it or plant on another tenant")
    if alert_ids:
        await db.execute(delete(Alert).where(Alert.id.in_(alert_ids)))
    audit.log(db, tenant_id, "demo.replant", actor_kind="system", object_type="scenario", object_id=scenario, detail={"removed_alerts": alert_ids, "events": txs})
    return alert_ids, txs


async def _raised(tenant_id: str, rule: str, txs: list[str]) -> str | None:
    async with SessionLocal() as db:
        return await db.scalar(
            select(Alert.id)
            .join(AlertEvidence, AlertEvidence.alert_id == Alert.id)
            .where(Alert.tenant_id == tenant_id, Alert.rule_code == rule, AlertEvidence.ref_id.in_(txs))
            .limit(1)
        )


async def plant(tenant_id: str, scenario: str, dry_run: bool = False) -> None:
    _, rule, label = SCENARIOS[scenario]
    try:
        async with SessionLocal() as db:
            tx = await db.begin()
            try:
                removed, txs = await clear_for_replant(db, tenant_id, scenario)
            except BaseException:
                await tx.rollback()
                raise
            if dry_run:
                await tx.rollback()
                print(f"DRY RUN, nothing changed: {scenario} would remove alert(s) {removed or 'none'} and publish {', '.join(txs)}")
                return
            await tx.commit()
        print(f"{scenario} ({label}): removed {len(removed)} earlier alert(s); publishing {len(txs)} transfers")
        started = time.perf_counter()
        await publish(tenant_id, [("transaction", tx) for tx in txs])
        while (alert_id := await _raised(tenant_id, rule, txs)) is None:
            if time.perf_counter() - started > WAIT_SECONDS:
                raise SystemExit(f"no {rule} alert after {WAIT_SECONDS:.0f}s: is the API (and its pipeline worker) running?")
            await asyncio.sleep(0.05)
        print(f"{rule} alert {alert_id} raised {(time.perf_counter() - started) * 1000:.0f} ms after publish")
    finally:
        await redis.aclose()
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", required=True, help="the scenario to plant (S1; S2–S5 run in throwaway tenants, see above)")
    parser.add_argument("--tenant", default="tenant_demo")
    parser.add_argument("--dry-run", action="store_true", help="report what would be removed and published, change nothing")
    args = parser.parse_args()
    wanted = [x.strip().upper() for x in args.only.split(",") if x.strip()]
    elsewhere = [x for x in wanted if x not in SCENARIOS]
    if elsewhere:
        raise SystemExit(
            f"{', '.join(elsewhere)} would invent customers, accounts and staff in {args.tenant}, so it is not planted here. "
            f"Run it in a throwaway tenant instead: python -m tests.scenarios.metrics_runner --only {','.join(elsewhere)} --skip-legit"
        )
    try:
        for scenario in wanted:
            asyncio.run(plant(args.tenant, scenario, args.dry_run))
    except ReplantRefused as exc:
        raise SystemExit(f"Refusing to plant: {exc}") from None


if __name__ == "__main__":
    main()
