"""Build the detection window for one ingested event from PostgreSQL (docs/02 §3, step 3b-3c).

Rules only see the affected entities' sliding window, never the whole tenant, which keeps detection
O(affected). The window is widened just enough for every rule to see what it needs:
- R-CIRC: loops of up to six accounts, so accounts within five transfer hops of the event are included.
- R-STRUCT: every outgoing transfer of the affected customers, across all their accounts.
- R-PROFILE_*: employee actions within 48h, and the entitlements held when each action happened.
- Baselines and last activity are counted from the stored transactions themselves. The accounts table's
  baseline columns are ignored: no write path maintains them, and a value left there by an old seed would
  let invented history inflate a real alert.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.detection.base import AccountProfile, ActionRecord, ActionWindow, EmployeeProfile, RuleContext, TransferRecord, TransferWindow
from app.detection.config import load_rule_configs
from app.graph.service import graph_service
from app.models import AccessRight, Account, Customer, Employee, EmployeeAction, EmployeeSession, Tenant, Transaction

TRANSFER_WINDOW = timedelta(hours=72)
ACTION_WINDOW = timedelta(hours=48)
BASELINE_SPAN = timedelta(days=30)
MAX_HOPS = 5
MAX_ACCOUNTS = 300

EVENT_MODELS: dict[str, Any] = {
    "transaction": Transaction,
    "employee_action": EmployeeAction,
    "session": EmployeeSession,
    "access_right": AccessRight,
}


@dataclass
class Affected:
    accounts: set[str] = field(default_factory=set)
    customers: set[str] = field(default_factory=set)
    employees: set[str] = field(default_factory=set)

    def ids(self) -> list[str]:
        return sorted(self.accounts | self.customers | self.employees)


@dataclass
class EventContext:
    kind: str
    row: Any
    ts: datetime
    affected: Affected
    ctx: RuleContext
    labels: dict[str, str] = field(default_factory=dict)


def event_time(kind: str, row: Any) -> datetime:
    if kind == "transaction":
        return row.value_ts
    if kind == "employee_action":
        return row.event_ts
    if kind == "session":
        return row.started_at
    return row.revoked_at or row.granted_at


async def _holders(db: AsyncSession, tenant_id: str, accounts: set[str]) -> dict[str, str]:
    if not accounts:
        return {}
    rows = await db.execute(select(Account.id, Account.customer_id).where(Account.tenant_id == tenant_id, Account.id.in_(accounts)))
    return dict(rows.all())


async def _accounts_of(db: AsyncSession, tenant_id: str, customers: set[str]) -> set[str]:
    if not customers:
        return set()
    return set(await db.scalars(select(Account.id).where(Account.tenant_id == tenant_id, Account.customer_id.in_(customers))))


def _transfer_neighbourhood(tenant_id: str, seeds: set[str]) -> set[str]:
    """Accounts within MAX_HOPS transfer hops (either direction) of the seeds in the in-memory graph."""
    if not graph_service.loaded(tenant_id):
        return set(seeds)
    g = graph_service.graph(tenant_id)
    seen = {s for s in seeds if s in g}
    frontier = list(seen)
    for _ in range(MAX_HOPS):
        nxt = []
        for node in frontier:
            for u, v, data in [*g.out_edges(node, data=True), *g.in_edges(node, data=True)]:
                if data.get("type") != "TRANSFER":
                    continue
                other = v if u == node else u
                if other not in seen:
                    seen.add(other)
                    nxt.append(other)
                    if len(seen) >= MAX_ACCOUNTS:
                        return seen | seeds
        frontier = nxt
    return seen | seeds


async def _affected(db: AsyncSession, tenant_id: str, kind: str, row: Any) -> Affected:
    a = Affected()
    if kind == "transaction":
        a.accounts |= {x for x in (row.from_account_id, row.to_account_id) if x}
    else:
        a.employees.add(row.employee_id)
        if kind == "employee_action":
            if row.target_type == "customer":
                a.customers.add(row.target_id)
            elif row.target_type == "account":
                a.accounts.add(row.target_id)
            elif row.target_type == "transaction":
                tx = await db.get(Transaction, row.target_id)
                if tx is not None and tx.tenant_id == tenant_id:
                    a.accounts |= {x for x in (tx.from_account_id, tx.to_account_id) if x}
    a.customers |= set((await _holders(db, tenant_id, a.accounts)).values())
    return a


async def _action_rows(db: AsyncSession, tenant_id: str, start: datetime, end: datetime, *scopes) -> list[EmployeeAction]:
    clauses = [c for c in scopes if c is not None]
    if not clauses:
        return []
    stmt = select(EmployeeAction).where(
        EmployeeAction.tenant_id == tenant_id,
        EmployeeAction.event_ts >= start,
        EmployeeAction.event_ts <= end,
        or_(*clauses),
    )
    return list(await db.scalars(stmt))


async def build_context(db: AsyncSession, tenant_id: str, kind: str, event_id: str) -> EventContext | None:
    """None when the event row is missing or belongs to another tenant (a stale or foreign stream entry)."""
    model = EVENT_MODELS[kind]
    row = await db.get(model, event_id)
    if row is None or row.tenant_id != tenant_id:
        return None
    t = event_time(kind, row)
    affected = await _affected(db, tenant_id, kind, row)

    # Employees' own recent actions point at the customers whose money flow R-PROFILE_FLOW must see.
    a_start, a_end = t - ACTION_WINDOW, t + ACTION_WINDOW
    own_actions = await _action_rows(db, tenant_id, a_start, a_end, EmployeeAction.employee_id.in_(affected.employees) if affected.employees else None)
    customers = set(affected.customers)
    targeted_accounts = {x.target_id for x in own_actions if x.target_type == "account"}
    customers |= {x.target_id for x in own_actions if x.target_type == "customer"}
    customers |= set((await _holders(db, tenant_id, targeted_accounts)).values())

    seeds = affected.accounts | targeted_accounts | await _accounts_of(db, tenant_id, customers)
    accounts = _transfer_neighbourhood(tenant_id, seeds) | await _accounts_of(db, tenant_id, customers)

    t_start, t_end = t - TRANSFER_WINDOW, t + TRANSFER_WINDOW
    tx_rows = (
        list(
            await db.scalars(
                select(Transaction).where(
                    Transaction.tenant_id == tenant_id,
                    Transaction.status == "completed",
                    Transaction.value_ts >= t_start,
                    Transaction.value_ts <= t_end,
                    or_(Transaction.from_account_id.in_(accounts), Transaction.to_account_id.in_(accounts)),
                )
            )
        )
        if accounts
        else []
    )
    transfers = sorted(
        (TransferRecord(x.id, x.from_account_id, x.to_account_id, x.amount, x.value_ts, x.channel) for x in tx_rows),
        key=lambda r: r.ts,
    )
    window_accounts = {a for r in transfers for a in (r.from_acct, r.to_acct) if a} | seeds
    holder_of = await _holders(db, tenant_id, window_accounts)

    # Actions on the affected customers, their accounts, or transfers in the window.
    tx_ids = [r.tx_id for r in transfers]
    targeted = await _action_rows(
        db,
        tenant_id,
        a_start,
        a_end,
        and_(EmployeeAction.target_type == "customer", EmployeeAction.target_id.in_(customers)) if customers else None,
        and_(EmployeeAction.target_type == "account", EmployeeAction.target_id.in_(window_accounts)) if window_accounts else None,
        and_(EmployeeAction.target_type == "transaction", EmployeeAction.target_id.in_(tx_ids)) if tx_ids else None,
    )
    action_rows = {x.id: x for x in [*own_actions, *targeted]}.values()
    sender_of = {r.tx_id: holder_of.get(r.from_acct) if r.from_acct else None for r in transfers}

    def customer_for(x: EmployeeAction) -> str | None:
        if x.target_type == "customer":
            return x.target_id
        if x.target_type == "account":
            return holder_of.get(x.target_id)
        if x.target_type == "transaction":
            return sender_of.get(x.target_id)
        return None

    actions = sorted(
        (ActionRecord(x.id, x.employee_id, x.action_type, x.target_type, x.target_id, x.event_ts, customer_for(x)) for x in action_rows),
        key=lambda r: r.ts,
    )
    employees = await _employee_profiles(db, tenant_id, {x.employee_id for x in actions} | affected.employees, t)
    profiles = await _account_profiles(db, tenant_id, window_accounts, holder_of, t_start)

    tenant = await db.get(Tenant, tenant_id)
    ctx = RuleContext(
        tenant_id=tenant_id,
        configs=await load_rule_configs(db, tenant_id),
        transfers=TransferWindow(transfers, profiles),
        actions=ActionWindow(actions, employees),
        timezone=tenant.timezone if tenant and tenant.timezone else "Asia/Kolkata",
    )
    affected.customers |= customers
    return EventContext(kind, row, t, affected, ctx, await _account_labels(db, tenant_id, window_accounts))


async def _employee_profiles(db: AsyncSession, tenant_id: str, ids: set[str], at: datetime) -> dict[str, EmployeeProfile]:
    if not ids:
        return {}
    staff = (await db.execute(select(Employee.id, Employee.name, Employee.role).where(Employee.tenant_id == tenant_id, Employee.id.in_(ids)))).all()
    rights = await db.scalars(select(AccessRight).where(AccessRight.tenant_id == tenant_id, AccessRight.employee_id.in_(ids)))
    active: defaultdict[str, set[str]] = defaultdict(set)
    revoked: defaultdict[str, dict[str, datetime]] = defaultdict(dict)
    for r in rights:
        if r.granted_at > at:
            continue
        if r.revoked_at is None or r.revoked_at > at:
            active[r.employee_id].add(r.entitlement)
        else:
            prev = revoked[r.employee_id].get(r.entitlement)
            revoked[r.employee_id][r.entitlement] = max(prev, r.revoked_at) if prev else r.revoked_at
    return {
        eid: EmployeeProfile(eid, name, role, frozenset(active[eid]), {k: v for k, v in revoked[eid].items() if k not in active[eid]})
        for eid, name, role in staff
    }


async def _account_profiles(
    db: AsyncSession, tenant_id: str, accounts: set[str], holder_of: dict[str, str], window_start: datetime
) -> dict[str, AccountProfile]:
    if not accounts:
        return {}
    base = select(Transaction.from_account_id, func.count(), func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.tenant_id == tenant_id,
        Transaction.status == "completed",
        Transaction.from_account_id.in_(accounts),
        Transaction.value_ts >= window_start - BASELINE_SPAN,
        Transaction.value_ts < window_start,
    )
    live = {acct: (n, amt) for acct, n, amt in (await db.execute(base.group_by(Transaction.from_account_id))).all()}
    last_rows = await db.execute(
        select(Account.id, func.max(Transaction.value_ts))
        .join(Transaction, or_(Transaction.from_account_id == Account.id, Transaction.to_account_id == Account.id))
        .where(Account.tenant_id == tenant_id, Account.id.in_(accounts), Transaction.tenant_id == tenant_id, Transaction.value_ts < window_start)
        .group_by(Account.id)
    )
    last = dict(last_rows.all())
    profiles = {}
    for acct in accounts:
        n, amt = live.get(acct, (0, Decimal(0)))
        profiles[acct] = AccountProfile(acct, holder_of.get(acct), n, Decimal(amt), last.get(acct))
    return profiles


async def _account_labels(db: AsyncSession, tenant_id: str, accounts: set[str]) -> dict[str, str]:
    """How an investigator recognises each account: its masked number and holder, e.g. "XXXXXXXX0011 (Asha Verma)"."""
    if not accounts:
        return {}
    rows = await db.execute(
        select(Account.id, Account.account_no_masked, Customer.name)
        .join(Customer, Customer.id == Account.customer_id)
        .where(Account.tenant_id == tenant_id, Account.id.in_(accounts))
    )
    return {acct: f"{masked} ({holder})" for acct, masked, holder in rows.all()}
