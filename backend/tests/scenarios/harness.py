"""Scenario harness for NFR-05/06 and NFR-01 (docs/10 §6, §8): suspicious scenarios S1–S5 and the legitimate corpus L1–L20.

Every scenario runs in its own throwaway tenant, which is deleted afterwards, success or not, so nothing invented ever
reaches the default tenant. That tenant holds real, user-entered data plus the one planted demo loop, which
`python -m app.seed.suspicious --only S1` re-plants.

- Suspicious (S1–S5): customers, accounts, employees and access rights are registered through `/v1/entities` and
  `/v1/ingest/access-rights`, then the scenario's events go in through `POST /v1/ingest/events`, exactly as a bank's
  feed would send them. The real pipeline worker detects them. By default the app runs in this process (ASGI
  transport plus its own pipeline worker). With SCENARIO_API=http://host:port the requests go to a running API
  instead, and its worker does the detecting.
- Legitimate (L1–L20): the benign generator in `app.seed.legitimate` is bulk-loaded (about 20,000 events for 200
  customers over 90 days), the tenant graph is rebuilt, and every event is run through the pipeline's own
  `process_event`, as the worker would run it.

Metric definitions follow docs/10 §6 exactly:
- detection_rate = detected scenarios / 5. A scenario counts once, however many alerts it raises.
- false_positive_rate = distinct customers with at least one alert of band medium or higher / customers seeded.
- alert_latency = detected_at of the first matching alert − ingested_at of the scenario's last ingested event.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import delete, func, insert, select, text, update

from app.auth.jwt import create_access_token
from app.db import SessionLocal, engine
from app.graph.service import graph_service
from app.models import Account, Alert, Employee, EmployeeAction, Tenant, Transaction, User
from app.models.base import Base
from app.redis_client import redis
from app.seed.users import ensure_tenant

IST = ZoneInfo("Asia/Kolkata")
MEDIUM_PLUS = ("medium", "high", "critical")
DETECT_TIMEOUT_S = 10.0
SUPPORT_FACTORS = {"R-DORMANT": "dormancy_gap", "R-OFFHOURS": "employee_off_hours", "R-VELOCITY": "account_velocity"}
SCENARIO_IDS = ("S1", "S2", "S3", "S4", "S5")


def ist(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=IST)


def iso(ts: datetime) -> str:
    return ts.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass
class Planted:
    sid: str
    title: str
    tenant: str
    expected: tuple[str, ...]
    entities: set[str]
    event_ids: list[str] = field(default_factory=list)


@dataclass
class ScenarioResult:
    sid: str
    title: str
    expected: tuple[str, ...]
    detected: bool
    rule_hit: str | None = None
    band: str | None = None
    score: int | None = None
    latency_ms: float | None = None
    alert_id: str | None = None
    via: str | None = None
    alerts: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


@dataclass
class Offender:
    customer_id: str
    rule_code: str
    band: str
    score: int
    explanation: str
    entity_ids: list[str]


@dataclass
class LegitimateResult:
    customers: int
    flagged: int
    events: int
    alerts: int
    bands: dict[str, int]
    offenders: list[Offender]
    seconds: float

    @property
    def rate(self) -> float:
        return self.flagged / self.customers if self.customers else 0.0


class Api:
    """Registration and ingest calls for one throwaway tenant, as its admin user."""

    def __init__(self, client: httpx.AsyncClient, tenant: str) -> None:
        self.client = client
        self.tenant = tenant
        self.headers = {"Authorization": f"Bearer {create_access_token(f'usr_scn_{tenant}', tenant, 'admin')}"}
        self.refs = 0

    async def _post(self, path: str, body: dict[str, Any], expect: int) -> dict[str, Any]:
        resp = await self.client.post(path, json=body, headers=self.headers)
        if resp.status_code != expect:
            raise AssertionError(f"POST {path} -> {resp.status_code}: {resp.text[:400]}")
        return resp.json()

    def _ref(self, prefix: str) -> str:
        self.refs += 1
        return f"{prefix}-{self.tenant[-8:]}-{self.refs}".upper()

    async def customer(self, name: str) -> str:
        return (await self._post("/v1/entities/customers", {"name": name, "external_ref": self._ref("C")}, 201))["id"]

    async def account(self, customer_id: str, number: str, opened_at: datetime | None = None) -> str:
        body: dict[str, Any] = {"customer_id": customer_id, "account_number": number}
        if opened_at:
            body["opened_at"] = iso(opened_at)
        return (await self._post("/v1/entities/accounts", body, 201))["id"]

    async def employee(self, name: str, role: str) -> str:
        return (await self._post("/v1/entities/employees", {"name": name, "external_ref": self._ref("E"), "role": role}, 201))["id"]

    async def grant(self, employee_id: str, entitlement: str, granted_at: datetime) -> None:
        await self._post("/v1/ingest/access-rights", {"employee_id": employee_id, "entitlement": entitlement, "granted_at": iso(granted_at)}, 201)

    async def ingest(self, events: list[dict[str, Any]]) -> None:
        body = await self._post("/v1/ingest/events", {"events": events}, 202)
        if body["failed"] or body["accepted"] != len(events):
            raise AssertionError(f"ingest rejected events: {body}")


def transfer(event_id: str, src: str | None, dst: str | None, amount: int, ts: datetime, channel: str = "neft") -> dict[str, Any]:
    return {"kind": "transaction", "id": event_id, "from_account_id": src, "to_account_id": dst, "amount": f"{amount}.00", "channel": channel, "value_ts": iso(ts)}


def action(event_id: str, employee: str, kind: str, target_type: str, target_id: str, ts: datetime, **extra: Any) -> dict[str, Any]:
    return {"kind": "employee_action", "id": event_id, "employee_id": employee, "action_type": kind, "target_type": target_type, "target_id": target_id, "event_ts": iso(ts), **extra}


def _numbers(seed: int):
    n = 0
    while True:
        n += 1
        yield f"{70_000_000 + seed * 1000 + n}"


async def _loop_accounts(api: Api, numbers, names: tuple[str, ...], first: str | None = None) -> tuple[list[str], list[str]]:
    customers = [first] if first else []
    for name in names[len(customers) :]:
        customers.append(await api.customer(name))
    return customers, [await api.account(c, next(numbers)) for c in customers]


async def plant_s1(api: Api, key: str, day: date) -> Planted:
    """S1: three accounts pass ₹2,00,000 round a loop within 4 hours (₹6L total, over the ₹5L cycle minimum)."""
    customers, accounts = await _loop_accounts(api, _numbers(1), ("Meera Kulkarni", "Rohan Deshpande", "Sana Shaikh"))
    start = ist(day, 10, 5)
    ids = [f"tx_{key}_s1_{i}" for i in range(3)]
    legs = [(accounts[0], accounts[1], 0), (accounts[1], accounts[2], 95), (accounts[2], accounts[0], 205)]
    await api.ingest([transfer(ids[i], s, d, 200_000, start + timedelta(minutes=m)) for i, (s, d, m) in enumerate(legs)])
    return Planted("S1", "Circular ₹6L / 4h / 3 accounts", api.tenant, ("R-CIRC",), set(accounts) | set(customers), ids)


async def plant_s2(api: Api, key: str, day: date) -> Planted:
    """S2: a customer with no history sends six ₹48,000 UPI payments to one beneficiary within 6 hours (threshold ₹50,000)."""
    numbers = _numbers(2)
    sender, payee = await api.customer("Prakash Jadhav"), await api.customer("Nikhil Traders")
    src, dst = await api.account(sender, next(numbers)), await api.account(payee, next(numbers))
    start = ist(day, 11, 10)
    ids = [f"tx_{key}_s2_{i}" for i in range(6)]
    await api.ingest([transfer(ids[i], src, dst, 48_000, start + timedelta(minutes=62 * i), "upi") for i in range(6)])
    return Planted("S2", "6 × ₹48k structured to one beneficiary", api.tenant, ("R-STRUCT",), {sender, src}, ids)


async def plant_s3(api: Api, key: str, day: date) -> Planted:
    """S3: an analyst, entitled only to profile.edit, approves a ₹2,00,000 transfer (tx.approve needs teller/manager/finance_ops)."""
    numbers = _numbers(3)
    holder, payee = await api.customer("Farah Siddiqui"), await api.customer("Vikram Pawar")
    src, dst = await api.account(holder, next(numbers)), await api.account(payee, next(numbers))
    analyst = await api.employee("Tanvi Joshi", "analyst")
    await api.grant(analyst, "profile.edit", ist(day, 9) - timedelta(days=200))
    tx_id, act_id = f"tx_{key}_s3", f"act_{key}_s3"
    sent = ist(day, 14, 20)
    await api.ingest([
        transfer(tx_id, src, dst, 200_000, sent, "rtgs"),
        action(act_id, analyst, "tx.approve", "transaction", tx_id, sent + timedelta(minutes=4)),
    ])
    return Planted("S3", "analyst approves ₹2L without tx.approve", api.tenant, ("R-PROFILE_ROLE",), {analyst, holder, src}, [tx_id, act_id])


async def plant_s4(api: Api, key: str, day: date) -> Planted:
    """S4: a teller adds a beneficiary for customer X at 03:15; within 12 hours X's account runs a ₹6L three-account loop."""
    x = await api.customer("Deepak Chavan")
    _, accounts = await _loop_accounts(api, _numbers(4), ("Deepak Chavan", "Ishaan Mehta", "Kavya Nair"), first=x)
    teller = await api.employee("Suresh Patil", "teller")
    await api.grant(teller, "beneficiary.add", ist(day, 9) - timedelta(days=400))
    edit = ist(day, 3, 15)
    act_id = f"act_{key}_s4"
    ids = [f"tx_{key}_s4_{i}" for i in range(3)]
    legs = [(accounts[0], accounts[1], 7 * 60), (accounts[1], accounts[2], 8 * 60 + 30), (accounts[2], accounts[0], 10 * 60)]
    await api.ingest([
        action(act_id, teller, "beneficiary.add", "customer", x, edit, after_state={"beneficiary": accounts[1]}),
        *[transfer(ids[i], s, d, 200_000, edit + timedelta(minutes=m)) for i, (s, d, m) in enumerate(legs)],
    ])
    return Planted("S4", "03:15 beneficiary edit → circular flow", api.tenant, ("R-PROFILE_FLOW", "R-CIRC"), {x, accounts[0], teller}, [act_id, *ids])


async def plant_s5(api: Api, key: str, day: date) -> Planted:
    """S5: an account idle for 120 days sends ₹90,000 at 02:00; the teller approving it logged in at 01:52 (off-hours).
    The approval is what ties the off-hours login to the dormant account: without an action on it, nothing links them."""
    numbers = _numbers(5)
    holder, payee = await api.customer("Lata Gaikwad"), await api.customer("Omkar Sawant")
    dormant = await api.account(holder, next(numbers), opened_at=ist(day, 9) - timedelta(days=2000))
    dst = await api.account(payee, next(numbers))
    teller = await api.employee("Ganesh More", "teller")
    await api.grant(teller, "tx.approve", ist(day, 9) - timedelta(days=365))
    await api.ingest([transfer(f"tx_{key}_s5_hist", None, dormant, 15_000, ist(day, 12) - timedelta(days=120))])
    login_at, sent = ist(day, 1, 52), ist(day, 2, 0)
    session, login, tx_id, approve = f"sess_{key}_s5", f"act_{key}_s5_login", f"tx_{key}_s5", f"act_{key}_s5_approve"
    await api.ingest([
        {"kind": "session", "id": session, "employee_id": teller, "ip_address": "10.4.8.21", "device": "branch-pc-07", "started_at": iso(login_at)},
        action(login, teller, "login", "system", "core-banking", login_at, session_id=session),
        transfer(tx_id, dormant, dst, 90_000, sent),
        action(approve, teller, "tx.approve", "transaction", tx_id, sent + timedelta(minutes=3), session_id=session),
    ])
    return Planted("S5", "dormant 120d + off-hours ₹90k", api.tenant, ("R-DORMANT", "R-OFFHOURS"), {holder, dormant, teller}, [login, tx_id, approve])


PLANTERS: dict[str, Callable[[Api, str, date], Awaitable[Planted]]] = {"S1": plant_s1, "S2": plant_s2, "S3": plant_s3, "S4": plant_s4, "S5": plant_s5}


async def _create_tenant(tenant: str) -> None:
    async with SessionLocal() as db, db.begin():
        await ensure_tenant(db, tenant)
        await db.execute(
            insert(User).values(id=f"usr_scn_{tenant}", tenant_id=tenant, email=f"admin@{tenant}.scenario", full_name="Scenario Admin", role="admin", password_hash="unused")
        )


async def drop_tenants(tenants: list[str]) -> None:
    """Delete every row the throwaway tenants own, children first, then the tenants themselves."""
    if not tenants:
        return
    async with SessionLocal() as db, db.begin():
        await db.execute(update(Employee).where(Employee.tenant_id.in_(tenants)).values(manager_id=None))
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "tenants" and "tenant_id" in table.c:
                await db.execute(delete(table).where(table.c.tenant_id.in_(tenants)))
        await db.execute(delete(Tenant).where(Tenant.id.in_(tenants)))
    for tenant in tenants:
        graph_service.forget(tenant)


async def _alerts(tenant: str) -> list[Alert]:
    async with SessionLocal() as db:
        return list(await db.scalars(select(Alert).where(Alert.tenant_id == tenant).order_by(Alert.detected_at)))


def _match(alert: Alert, planted: Planted) -> str | None:
    """The expected code this alert proves: its own rule, or a supporting rule attached to it as a factor."""
    if alert.risk_band not in MEDIUM_PLUS or not planted.entities & set(alert.entity_ids):
        return None
    if alert.rule_code in planted.expected:
        return alert.rule_code
    names = {f.get("name") for f in alert.risk_factors or []}
    return next((code for code in planted.expected if SUPPORT_FACTORS.get(code) in names), None)


async def _last_ingested(planted: Planted) -> datetime:
    async with SessionLocal() as db:
        tx = await db.scalar(select(func.max(Transaction.ingested_at)).where(Transaction.tenant_id == planted.tenant, Transaction.id.in_(planted.event_ids)))
        act = await db.scalar(select(func.max(EmployeeAction.ingested_at)).where(EmployeeAction.tenant_id == planted.tenant, EmployeeAction.id.in_(planted.event_ids)))
    return max(t for t in (tx, act) if t is not None)


async def _await_detection(planted: Planted) -> ScenarioResult:
    deadline = time.perf_counter() + DETECT_TIMEOUT_S
    while not any(_match(a, planted) for a in await _alerts(planted.tenant)) and time.perf_counter() < deadline:
        await asyncio.sleep(0.1)
    await asyncio.sleep(0.3)  # let the rest of the batch settle so the band reported is the final one
    alerts = await _alerts(planted.tenant)
    hits = [(a, code) for a in alerts if (code := _match(a, planted))]
    summary = [{"id": a.id, "rule": a.rule_code, "band": a.risk_band, "score": a.risk_score, "entities": a.entity_ids} for a in alerts]
    result = ScenarioResult(planted.sid, planted.title, planted.expected, bool(hits), alerts=summary)
    if hits:
        first, code = min(hits, key=lambda h: h[0].detected_at)
        best = max((a for a, _ in hits), key=lambda a: a.risk_score)
        result.rule_hit, result.band, result.score, result.alert_id = code, best.risk_band, best.risk_score, first.id
        result.via = "rule" if first.rule_code == code else f"factor on {first.rule_code}"
        result.latency_ms = round((first.detected_at - await _last_ingested(planted)).total_seconds() * 1000, 1)
    return result


async def _foreign_consumers() -> list[str]:
    try:
        consumers = await redis.xinfo_consumers("events", "pipeline")
    except Exception:  # noqa: BLE001 - no stream or group yet means nobody else is consuming
        return []
    return [c["name"] for c in consumers if c["idle"] < 10_000]


async def run_suspicious(only: tuple[str, ...] = SCENARIO_IDS) -> list[ScenarioResult]:
    from app.pipeline import worker

    base = os.environ.get("SCENARIO_API")
    in_process = not base
    if in_process and (others := await _foreign_consumers()):
        raise RuntimeError(
            f"another pipeline worker is consuming the event stream ({', '.join(others)}); its in-memory graph would not see "
            "these tenants. Stop that API, or run against it with SCENARIO_API=http://localhost:8000."
        )
    key = uuid.uuid4().hex[:8]
    day = datetime.now(IST).date() - timedelta(days=1)
    tenants = {sid: f"tenant_scn_{sid.lower()}_{key}" for sid in only}
    results: list[ScenarioResult] = []
    if in_process:
        from app.main import app

        transport: httpx.AsyncBaseTransport = httpx.ASGITransport(app=app)
        worker.start()
    else:
        transport = httpx.AsyncHTTPTransport()
    try:
        async with httpx.AsyncClient(transport=transport, base_url=base or "http://scenario", timeout=30) as client:
            for sid in only:
                await _create_tenant(tenants[sid])
                try:
                    planted = await PLANTERS[sid](Api(client, tenants[sid]), key, day)
                    results.append(await _await_detection(planted))
                except Exception as exc:  # noqa: BLE001 - one broken scenario is reported as FAIL, the rest still run
                    results.append(ScenarioResult(sid, sid, (), False, error=f"{type(exc).__name__}: {exc}"))
    finally:
        if in_process:
            await worker.stop()
        await drop_tenants(list(tenants.values()))
        await redis.aclose()
        await engine.dispose()
    return results


async def run_legitimate(customers: int = 200, days: int = 90, employees: int = 30, seed: int = 42, concurrency: int = 8) -> LegitimateResult:
    from app.pipeline.worker import process_event
    from app.seed.legitimate import LegitimateGenerator, load

    started = time.perf_counter()
    tenant = f"tenant_scn_legit_{uuid.uuid4().hex[:8]}"
    corpus = LegitimateGenerator(tenant, customers, employees, days, seed, datetime.now(IST).date()).build()
    events = sorted(
        [("transaction", t["id"], t["value_ts"]) for t in corpus.transactions]
        + [("employee_action", a["id"], a["event_ts"]) for a in corpus.actions]
        + [("session", s["id"], s["started_at"]) for s in corpus.sessions]
        + [("access_right", r["id"], r["granted_at"]) for r in corpus.access_rights],
        key=lambda e: e[2],
    )
    try:
        await load(corpus, tenant)
        async with engine.connect() as conn:
            for table in ("transactions", "accounts", "employee_actions", "access_rights", "employee_sessions"):
                await conn.execute(text(f"ANALYZE {table}"))  # a bulk load leaves the planner with no statistics
        async with SessionLocal() as db:
            await graph_service.rebuild(db, tenant)
        gate = asyncio.Semaphore(concurrency)

        async def one(kind: str, event_id: str) -> None:
            async with gate:
                await process_event(tenant, kind, event_id)

        for i in range(0, len(events), 500):
            await asyncio.gather(*(one(kind, event_id) for kind, event_id, _ in events[i : i + 500]))

        async with SessionLocal() as db:
            alerts = list(await db.scalars(select(Alert).where(Alert.tenant_id == tenant)))
            holder = dict((await db.execute(select(Account.id, Account.customer_id).where(Account.tenant_id == tenant))).all())
        seeded = {c["id"] for c in corpus.customers}
        bands: dict[str, int] = {}
        offenders: dict[str, Offender] = {}
        for a in alerts:
            bands[a.risk_band] = bands.get(a.risk_band, 0) + 1
            if a.risk_band not in MEDIUM_PLUS:
                continue
            for entity in a.entity_ids:
                customer = holder.get(entity, entity)
                if customer in seeded and (customer not in offenders or a.risk_score > offenders[customer].score):
                    offenders[customer] = Offender(customer, a.rule_code, a.risk_band, a.risk_score, a.explanation, list(a.entity_ids))
        return LegitimateResult(
            customers=len(seeded),
            flagged=len(offenders),
            events=len(events),
            alerts=len(alerts),
            bands=bands,
            offenders=sorted(offenders.values(), key=lambda o: -o.score),
            seconds=round(time.perf_counter() - started, 1),
        )
    finally:
        await drop_tenants([tenant])
        await redis.aclose()
        await engine.dispose()
