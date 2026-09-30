"""NFR performance check (docs/10 §8): measures each budget against the real stack and prints a markdown table.

    python -m tests.perf.bench_nfr            # the API must be running on --api (default http://localhost:8000)

Everything runs in two throwaway tenants, which are deleted afterwards, success or not:
- tenant_perf: 20 three-account loops are registered and ingested through the public API. Each one is timed from the
  POST until its alert.created arrives on a real WebSocket. The alert list is then read 30 times.
- tenant_perf_bulk: 100,000 rows (2,500 customers, 7,500 accounts, 90,000 transfers) are bulk-inserted. The graph is
  rebuilt from PostgreSQL exactly as at API startup, then 200 two-hop neighbourhood reads run on the 10,000-node result.
The bulk rows are a load fixture only. They exist for the length of the run and never reach tenant_demo.
"""

import argparse
import asyncio
import json
import random
import sys
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import websockets
from sqlalchemy import delete, insert, update

from app.auth.jwt import create_access_token
from app.db import SessionLocal, engine
from app.graph.service import GraphService
from app.models import Account, Alert, AuditLog, Case, Customer, Employee, IngestFailure, Tenant, Transaction, User
from app.seed.users import ensure_tenant

PERF, BULK = "tenant_perf", "tenant_perf_bulk"
LOOPS, LIST_RUNS, HOPS_RUNS = 20, 30, 200
BULK_CUSTOMERS, BULK_ACCOUNTS, BULK_TRANSFERS = 2_500, 7_500, 90_000


def pct(samples: list[float], p: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(samples)
    return ordered[max(0, min(len(ordered) - 1, round(p / 100 * len(ordered) + 0.5) - 1))]


def row(check: str, samples: list[float], budget: str) -> str:
    return f"| {check} | {len(samples)} | {pct(samples, 50):.0f} | {pct(samples, 95):.0f} | {max(samples):.0f} | {budget} |"


async def _drop(*tenants: str) -> None:
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Employee).where(Employee.tenant_id.in_(tenants)).values(manager_id=None))
        for model in (Alert, Case, Transaction, Account, Customer, Employee, IngestFailure, AuditLog, User):
            await db.execute(delete(model).where(model.tenant_id.in_(tenants)))
        await db.execute(delete(Tenant).where(Tenant.id.in_(tenants)))


async def _perf_user() -> str:
    async with SessionLocal() as db, db.begin():
        await ensure_tenant(db, PERF)
        await db.execute(insert(User).values(id="usr_perf", tenant_id=PERF, email="perf@bench.dev", full_name="Perf Bench", role="investigator", password_hash="unused"))
    return create_access_token("usr_perf", PERF, "investigator")


async def _register_loops(api: httpx.AsyncClient) -> list[list[str]]:
    loops = []
    for i in range(LOOPS):
        accounts = []
        for j in range(3):
            cust = (await api.post("/v1/entities/customers", json={"name": f"Perf Holder {i}-{j}", "external_ref": f"PERF-{i}-{j}"})).raise_for_status().json()["id"]
            number = str(90_000_000 + i * 10 + j)
            accounts.append((await api.post("/v1/entities/accounts", json={"customer_id": cust, "account_number": number})).raise_for_status().json()["id"])
        loops.append(accounts)
    return loops


async def ingest_to_ws(base: str, token: str) -> list[float]:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(base_url=base, headers=headers, timeout=30) as api:
        loops = await _register_loops(api)
        ws_url = base.replace("http", "ws", 1) + f"/v1/ws?token={token}"
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({"op": "subscribe", "channels": [f"alerts:{PERF}"]}))
            while json.loads(await ws.recv()).get("type") != "subscribed":
                pass
            samples = []
            now = datetime.now(UTC).replace(microsecond=0)
            for i, (a, b, c) in enumerate(loops):
                legs = [(a, b, 3), (b, c, 2), (c, a, 1)]
                events = [
                    {"kind": "transaction", "id": f"tx_perf_{i}_{n}", "from_account_id": s, "to_account_id": d, "amount": "200000.00",
                     "channel": "neft", "value_ts": (now - timedelta(hours=h)).isoformat().replace("+00:00", "Z")}
                    for n, (s, d, h) in enumerate(legs)
                ]
                started = time.perf_counter()
                (await api.post("/v1/ingest/events", json={"events": events})).raise_for_status()
                while True:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                    if msg.get("type") == "alert.created" and a in msg["data"]["entity_ids"]:
                        samples.append((time.perf_counter() - started) * 1000)
                        break
        return samples


async def alert_list(base: str, token: str) -> list[float]:
    samples = []
    async with httpx.AsyncClient(base_url=base, headers={"Authorization": f"Bearer {token}"}, timeout=30) as api:
        await api.get("/v1/alerts")  # warm the connection, as a browser tab would be
        for _ in range(LIST_RUNS):
            started = time.perf_counter()
            (await api.get("/v1/alerts")).raise_for_status()
            samples.append((time.perf_counter() - started) * 1000)
    return samples


async def _bulk_rows() -> None:
    rnd = random.Random(7)
    customers = [{"id": f"cust_pb_{i}", "tenant_id": BULK, "external_ref": f"PB-{i}", "name": f"Bulk Holder {i}"} for i in range(BULK_CUSTOMERS)]
    accounts = [
        {"id": f"acct_pb_{i}", "tenant_id": BULK, "customer_id": f"cust_pb_{i % BULK_CUSTOMERS}", "account_no_masked": f"XXXXPB{i:06d}", "type": "savings"}
        for i in range(BULK_ACCOUNTS)
    ]
    start = datetime.now(UTC) - timedelta(days=30)
    transfers = []
    for i in range(BULK_TRANSFERS):
        s, d = rnd.sample(range(BULK_ACCOUNTS), 2)
        transfers.append({
            "id": f"tx_pb_{i}", "tenant_id": BULK, "from_account_id": f"acct_pb_{s}", "to_account_id": f"acct_pb_{d}",
            "amount": Decimal(rnd.randint(500, 90_000)), "direction": "debit", "channel": "upi", "value_ts": start + timedelta(seconds=rnd.randint(0, 30 * 86_400)),
        })
    async with SessionLocal() as db, db.begin():
        await ensure_tenant(db, BULK)
        for model, rows in ((Customer, customers), (Account, accounts), (Transaction, transfers)):
            for k in range(0, len(rows), 5_000):
                await db.execute(insert(model), rows[k : k + 5_000])


async def rebuild_and_hops() -> tuple[float, int, list[float]]:
    await _bulk_rows()
    gs = GraphService()
    async with SessionLocal() as db:
        stats = await gs.rebuild(db, BULK)
    rnd = random.Random(11)
    samples = []
    for _ in range(HOPS_RUNS):
        node = f"acct_pb_{rnd.randrange(BULK_ACCOUNTS)}"
        started = time.perf_counter()
        gs.neighbors(BULK, node, 2)
        samples.append((time.perf_counter() - started) * 1000)
    return stats.ms, stats.nodes, samples


async def main(base: str) -> None:
    await _drop(PERF, BULK)
    try:
        token = await _perf_user()
        ws = await ingest_to_ws(base, token)
        lists = await alert_list(base, token)
        rebuild_ms, nodes, hops = await rebuild_and_hops()
    finally:
        await _drop(PERF, BULK)
        await engine.dispose()
    print("| Check | n | p50 ms | p95 ms | max ms | Budget |")
    print("|---|---|---|---|---|---|")
    print(row("ingest → WS alert.created (3-leg loop, live API)", ws, "p95 ≤ 5000"))
    print(row(f"graph 2-hop, {nodes:,} nodes", hops, "p95 ≤ 500"))
    print(row("alert list API (GET /v1/alerts)", lists, "p95 ≤ 300"))
    print(f"| graph rebuild from PostgreSQL, {BULK_CUSTOMERS + BULK_ACCOUNTS + BULK_TRANSFERS:,} rows | 1 | {rebuild_ms:.0f} | {rebuild_ms:.0f} | {rebuild_ms:.0f} | ≤ 30000 |")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # the table uses → and ≤; Windows consoles default to cp1252
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://localhost:8000")
    asyncio.run(main(parser.parse_args().api.rstrip("/")))
