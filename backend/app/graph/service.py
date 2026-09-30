import logging
import time
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from itertools import chain
from typing import Any, Literal, NamedTuple

import networkx as nx
from sqlalchemy import Select, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.detection.base import TransferRecord
from app.detection.r_circ import ordered_legs
from app.models import AccessRight, Account, Customer, Employee, EmployeeAction, Tenant, Transaction

log = logging.getLogger("sentinel.graph")

NodeType = Literal["customer", "account", "employee", "transaction"]
EdgeType = Literal["TRANSFER", "ACCOUNT_HOLDER", "EMPLOYEE_ACCESS", "PROFILE_CHANGE", "EMPLOYEE_ACTION"]
EDGE_TYPES: tuple[EdgeType, ...] = ("TRANSFER", "ACCOUNT_HOLDER", "EMPLOYEE_ACCESS", "PROFILE_CHANGE", "EMPLOYEE_ACTION")
PROFILE_ACTIONS = frozenset({"profile.edit", "beneficiary.add", "limit.change"})
PREFIX_TYPES: dict[str, NodeType] = {"cust_": "customer", "acct_": "account", "emp_": "employee", "tx_": "transaction"}
CHUNK = 5000
MAX_NODES = 400
MAX_CYCLES = 20
CYCLE_MIN, CYCLE_MAX = 3, 6


def node_type_of(node_id: str) -> NodeType | None:
    return next((t for prefix, t in PREFIX_TYPES.items() if node_id.startswith(prefix)), None)


class CustomerRow(NamedTuple):
    id: str
    name: str
    external_ref: str


class AccountRow(NamedTuple):
    id: str
    customer_id: str
    masked: str
    kind: str
    opened_at: datetime | None


class EmployeeRow(NamedTuple):
    id: str
    name: str
    role: str


class TransactionRow(NamedTuple):
    id: str
    from_account: str | None
    to_account: str | None
    amount: Decimal
    ts: datetime
    channel: str | None


class RightRow(NamedTuple):
    id: str
    employee_id: str
    entitlement: str
    scope: str | None
    granted_at: datetime


class ActionRow(NamedTuple):
    id: str
    employee_id: str
    action_type: str
    target_type: str
    target_id: str
    ts: datetime


@dataclass
class GraphRows:
    customers: list[CustomerRow] = field(default_factory=list)
    accounts: list[AccountRow] = field(default_factory=list)
    employees: list[EmployeeRow] = field(default_factory=list)
    transactions: list[TransactionRow] = field(default_factory=list)
    rights: list[RightRow] = field(default_factory=list)
    actions: list[ActionRow] = field(default_factory=list)


@dataclass
class TenantGraph:
    """One tenant's adjacency. `tx_account` maps every completed transaction to its sending account so an
    approval on a one-sided transaction still resolves to the account the employee acted on."""

    g: nx.MultiDiGraph = field(default_factory=nx.MultiDiGraph)
    tx_account: dict[str, str | None] = field(default_factory=dict)
    rights: dict[str, dict[str, RightRow]] = field(default_factory=lambda: defaultdict(dict))
    acted: dict[str, dict[str, set[str]]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(set)))
    pending_approvals: dict[str, list[tuple[str, str]]] = field(default_factory=lambda: defaultdict(list))

    def ensure_node(self, node_id: str, **attrs: Any) -> None:
        if node_id in self.g:
            if attrs:
                self.g.nodes[node_id].update(attrs)
            return
        self.g.add_node(
            node_id,
            type=attrs.pop("type", None) or node_type_of(node_id) or "account",
            label=attrs.pop("label", None) or node_id,
            risk=attrs.pop("risk", "low"),
            extra=attrs.pop("extra", {}),
        )

    def add_customer(self, c: CustomerRow) -> None:
        self.ensure_node(c.id, type="customer", label=c.name, extra={"external_ref": c.external_ref})

    def add_account(self, a: AccountRow) -> None:
        self.ensure_node(a.id, type="account", label=a.masked, extra={"customer_id": a.customer_id, "account_type": a.kind})
        self.ensure_node(a.customer_id, type="customer")
        self.g.add_edge(a.customer_id, a.id, key=f"holder:{a.id}", type="ACCOUNT_HOLDER", since=a.opened_at)

    def add_employee(self, e: EmployeeRow) -> None:
        self.ensure_node(e.id, type="employee", label=e.name, extra={"role": e.role})

    def add_transaction(self, tx: TransactionRow) -> None:
        self.tx_account[tx.id] = tx.from_account
        if tx.from_account and tx.to_account and tx.from_account != tx.to_account:
            self.ensure_node(tx.from_account, type="account")
            self.ensure_node(tx.to_account, type="account")
            self.g.add_edge(
                tx.from_account, tx.to_account, key=tx.id, type="TRANSFER", amount=str(tx.amount), ts=tx.ts, tx_id=tx.id, channel=tx.channel
            )
        for employee_id, action_type in self.pending_approvals.pop(tx.id, []):
            if tx.from_account:
                self.acted[employee_id][action_type].add(tx.from_account)
                self.refresh_access(employee_id)

    def add_action(self, act: ActionRow) -> None:
        self.ensure_node(act.employee_id, type="employee")
        if act.target_type == "transaction":
            self.ensure_node(act.target_id, type="transaction")
            self.g.add_edge(act.employee_id, act.target_id, key=act.id, type="EMPLOYEE_ACTION", action=act.action_type, event_ts=act.ts, act_id=act.id)
            if act.target_id in self.tx_account:
                account = self.tx_account[act.target_id]
                if account:
                    self.acted[act.employee_id][act.action_type].add(account)
            else:
                self.pending_approvals[act.target_id].append((act.employee_id, act.action_type))
        elif act.target_type in ("customer", "account"):
            self.ensure_node(act.target_id, type=act.target_type)
            if act.action_type in PROFILE_ACTIONS:
                self.g.add_edge(
                    act.employee_id, act.target_id, key=act.id, type="PROFILE_CHANGE", action=act.action_type, event_ts=act.ts, act_id=act.id
                )
            self.acted[act.employee_id][act.action_type].add(act.target_id)

    def set_right(self, right: RightRow, revoked: bool) -> None:
        self.ensure_node(right.employee_id, type="employee")
        if revoked:
            self.rights[right.employee_id].pop(right.id, None)
        else:
            self.rights[right.employee_id][right.id] = right

    def resolve_access_targets(self, right: RightRow) -> set[str]:
        """An entitlement connects its holder to the entity its scope names (an account or customer id), plus every
        account or customer the employee has actually exercised that entitlement on. Broad scopes ('*', branch,
        global) are never fanned out to every account: only exercised access becomes an edge."""
        targets = set(self.acted[right.employee_id].get(right.entitlement, set()))
        if right.scope and node_type_of(right.scope) in ("customer", "account") and right.scope in self.g:
            targets.add(right.scope)
        return targets

    def refresh_access(self, employee_id: str) -> None:
        stale = [(u, v, k) for u, v, k, d in self.g.out_edges(employee_id, keys=True, data=True) if d["type"] == "EMPLOYEE_ACCESS"]
        self.g.remove_edges_from(stale)
        for right in self.rights[employee_id].values():
            for target in self.resolve_access_targets(right):
                self.g.add_edge(
                    employee_id,
                    target,
                    key=f"{right.id}>{target}",
                    type="EMPLOYEE_ACCESS",
                    entitlement=right.entitlement,
                    granted_at=right.granted_at,
                    right_id=right.id,
                )


def load(rows: GraphRows) -> TenantGraph:
    tg = TenantGraph()
    for c in rows.customers:
        tg.add_customer(c)
    for a in rows.accounts:
        tg.add_account(a)
    for e in rows.employees:
        tg.add_employee(e)
    for tx in rows.transactions:
        tg.add_transaction(tx)
    for act in rows.actions:
        tg.add_action(act)
    for right in rows.rights:
        tg.set_right(right, revoked=False)
    for employee_id in list(tg.rights):
        tg.refresh_access(employee_id)
    return tg


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def node_out(g: nx.MultiDiGraph, node_id: str, **more: Any) -> dict[str, Any]:
    data = g.nodes[node_id]
    return {"id": node_id, "type": data["type"], "label": data["label"], "risk": data["risk"], "degree": g.degree(node_id), **more}


def edge_out(u: str, v: str, key: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"id": key, "source": u, "target": v, "type": data["type"], "props": {k: _json(x) for k, x in data.items() if k != "type"}}


async def _chunked(db: AsyncSession, stmt: Select, key_col: Any) -> list[Any]:
    rows: list[Any] = []
    after: str | None = None
    while True:
        page = stmt.order_by(key_col).limit(CHUNK)
        if after is not None:
            page = page.where(key_col > after)
        batch = (await db.execute(page)).all()
        rows.extend(batch)
        if len(batch) < CHUNK:
            return rows
        after = batch[-1][0]


async def fetch_rows(db: AsyncSession, tenant_id: str) -> GraphRows:
    customers = await _chunked(
        db, select(Customer.id, Customer.name, Customer.external_ref).where(Customer.tenant_id == tenant_id), Customer.id
    )
    accounts = await _chunked(
        db,
        select(Account.id, Account.customer_id, Account.account_no_masked, Account.type, Account.opened_at).where(Account.tenant_id == tenant_id),
        Account.id,
    )
    employees = await _chunked(db, select(Employee.id, Employee.name, Employee.role).where(Employee.tenant_id == tenant_id), Employee.id)
    transactions = await _chunked(
        db,
        select(
            Transaction.id, Transaction.from_account_id, Transaction.to_account_id, Transaction.amount, Transaction.value_ts, Transaction.channel
        ).where(Transaction.tenant_id == tenant_id, Transaction.status == "completed"),
        Transaction.id,
    )
    rights = await _chunked(
        db,
        select(AccessRight.id, AccessRight.employee_id, AccessRight.entitlement, AccessRight.scope, AccessRight.granted_at).where(
            and_(AccessRight.tenant_id == tenant_id, AccessRight.revoked_at.is_(None))
        ),
        AccessRight.id,
    )
    actions = await _chunked(
        db,
        select(
            EmployeeAction.id,
            EmployeeAction.employee_id,
            EmployeeAction.action_type,
            EmployeeAction.target_type,
            EmployeeAction.target_id,
            EmployeeAction.event_ts,
        ).where(EmployeeAction.tenant_id == tenant_id),
        EmployeeAction.id,
    )
    return GraphRows(
        customers=[CustomerRow(*r) for r in customers],
        accounts=[AccountRow(*r) for r in accounts],
        employees=[EmployeeRow(*r) for r in employees],
        transactions=sorted((TransactionRow(*r) for r in transactions), key=lambda t: t.ts),
        rights=[RightRow(*r) for r in rights],
        actions=sorted((ActionRow(*r) for r in actions), key=lambda a: a.ts),
    )


@dataclass
class RebuildStats:
    tenant_id: str
    nodes: int
    edges: dict[str, int]
    ms: float


class GraphService:
    """Per-tenant in-memory adjacency (ADR-001). PostgreSQL stays the source of truth; `rebuild` is the repair path."""

    def __init__(self) -> None:
        self._graphs: dict[str, TenantGraph] = {}

    def loaded(self, tenant_id: str) -> bool:
        return tenant_id in self._graphs

    def forget(self, tenant_id: str) -> None:
        """Drop a tenant's graph, for a tenant whose rows were deleted (throwaway test and benchmark tenants)."""
        self._graphs.pop(tenant_id, None)

    def graph(self, tenant_id: str) -> nx.MultiDiGraph:
        return self._tenant(tenant_id).g

    def _tenant(self, tenant_id: str) -> TenantGraph:
        return self._graphs.setdefault(tenant_id, TenantGraph())

    def load_rows(self, tenant_id: str, rows: GraphRows) -> RebuildStats:
        started = time.perf_counter()
        tg = load(rows)
        self._graphs[tenant_id] = tg
        return self._stats(tenant_id, tg, started)

    async def rebuild(self, db: AsyncSession, tenant_id: str) -> RebuildStats:
        started = time.perf_counter()
        tg = load(await fetch_rows(db, tenant_id))
        self._graphs[tenant_id] = tg
        return self._stats(tenant_id, tg, started)

    async def rebuild_all(self, db: AsyncSession) -> list[RebuildStats]:
        tenants = list(await db.scalars(select(Tenant.id)))
        return [await self.rebuild(db, tenant_id) for tenant_id in tenants]

    @staticmethod
    def _stats(tenant_id: str, tg: TenantGraph, started: float) -> RebuildStats:
        counts = {t: 0 for t in EDGE_TYPES}
        for _, _, d in tg.g.edges(data=True):
            counts[d["type"]] += 1
        return RebuildStats(tenant_id, tg.g.number_of_nodes(), counts, round((time.perf_counter() - started) * 1000, 1))

    def apply_event(self, tenant_id: str, kind: str, payload: dict[str, Any]) -> None:
        """Incremental update for one persisted ingest event. Edge keys are event ids, so re-applying is a no-op."""
        tg = self._tenant(tenant_id)
        if kind == "transaction":
            if payload.get("status", "completed") == "completed":
                tg.add_transaction(
                    TransactionRow(
                        payload["id"],
                        payload.get("from_account_id"),
                        payload.get("to_account_id"),
                        Decimal(str(payload["amount"])),
                        payload["value_ts"],
                        payload.get("channel"),
                    )
                )
        elif kind == "employee_action":
            tg.add_action(
                ActionRow(
                    payload["id"], payload["employee_id"], payload["action_type"], payload["target_type"], payload["target_id"], payload["event_ts"]
                )
            )
            tg.refresh_access(payload["employee_id"])
        elif kind == "access_right":
            right = RightRow(payload["id"], payload["employee_id"], payload["entitlement"], payload.get("scope"), payload["granted_at"])
            tg.set_right(right, revoked=payload.get("revoked_at") is not None)
            tg.refresh_access(right.employee_id)
        elif kind == "session":
            tg.ensure_node(payload["employee_id"], type="employee")

    def apply_entity(self, tenant_id: str, row: CustomerRow | AccountRow | EmployeeRow) -> None:
        """Add one newly registered customer, account or employee; re-applying the same row is a no-op."""
        tg = self._tenant(tenant_id)
        if isinstance(row, CustomerRow):
            tg.add_customer(row)
        elif isinstance(row, AccountRow):
            tg.add_account(row)
        else:
            tg.add_employee(row)

    def has_node(self, tenant_id: str, node_id: str) -> bool:
        return tenant_id in self._graphs and node_id in self._graphs[tenant_id].g

    def neighbors(
        self, tenant_id: str, node_id: str, depth: int, edge_types: Iterable[str] | None = None
    ) -> dict[str, Any] | None:
        if not self.has_node(tenant_id, node_id):
            return None
        g = self._graphs[tenant_id].g
        allowed = set(edge_types or EDGE_TYPES)
        seen: dict[str, int] = {node_id: 0}
        frontier = [node_id]
        truncated = False
        for level in range(1, depth + 1):
            nxt: list[str] = []
            for n in frontier:
                for u, v, d in chain(g.out_edges(n, data=True), g.in_edges(n, data=True)):
                    other = v if u == n else u
                    if d["type"] not in allowed or other in seen:
                        continue
                    if len(seen) >= MAX_NODES:
                        truncated = True
                        continue
                    seen[other] = level
                    nxt.append(other)
            frontier = nxt
        edges = [edge_out(u, v, k, d) for u, v, k, d in g.subgraph(seen).edges(keys=True, data=True) if d["type"] in allowed]
        return {"nodes": [node_out(g, n, depth=lvl) for n, lvl in seen.items()], "edges": edges, "truncated": truncated}

    def subgraph(self, tenant_id: str, node_ids: Iterable[str]) -> dict[str, Any]:
        if tenant_id not in self._graphs:
            return {"nodes": [], "edges": []}
        g = self._graphs[tenant_id].g
        present = [n for n in node_ids if n in g]
        return {
            "nodes": [node_out(g, n) for n in present],
            "edges": [edge_out(u, v, k, d) for u, v, k, d in g.subgraph(present).edges(keys=True, data=True)],
        }

    def cycles(
        self, tenant_id: str, node_id: str, window_hours: int, until: datetime | None = None
    ) -> dict[str, list[list[str]]] | None:
        """Loops of 3–6 accounts through `node_id` whose transfers fall in the window and happen in time order,
        so money could actually travel the loop (the same leg rule R-CIRC applies, ADR-015)."""
        if not self.has_node(tenant_id, node_id):
            return None
        g = self._graphs[tenant_id].g
        end = until or datetime.now(UTC)
        window = timedelta(hours=window_hours)
        start = end - window
        legs_by_edge: dict[tuple[str, str], list[TransferRecord]] = defaultdict(list)
        for u, v, k, d in g.edges(keys=True, data=True):
            if d["type"] == "TRANSFER" and start <= d["ts"] <= end:
                legs_by_edge[(u, v)].append(TransferRecord(k, u, v, Decimal(d["amount"]), d["ts"], d.get("channel")))
        for legs in legs_by_edge.values():
            legs.sort(key=lambda t: t.ts)
        dg = nx.DiGraph(list(legs_by_edge))
        if node_id not in dg:
            return {"cycles": [], "legs": []}
        component = next(c for c in nx.strongly_connected_components(dg) if node_id in c)
        cycles: list[list[str]] = []
        legs_out: list[list[str]] = []
        seen: set[frozenset[str]] = set()
        for cycle in nx.simple_cycles(dg.subgraph(component), length_bound=CYCLE_MAX):
            if len(cycle) < CYCLE_MIN or node_id not in cycle:
                continue
            legs = ordered_legs(cycle, legs_by_edge, window)
            if legs is None:
                continue
            key = frozenset(t.tx_id for t in legs)
            if key in seen:
                continue
            seen.add(key)
            order = [t.from_acct for t in legs]
            pivot = order.index(node_id)
            cycles.append(order[pivot:] + order[:pivot])
            legs_out.append([t.tx_id for t in legs])
            if len(cycles) >= MAX_CYCLES:
                break
        return {"cycles": cycles, "legs": legs_out}

    def search(self, tenant_id: str, q: str, types: set[str], limit: int) -> list[tuple[str, str, str]]:
        if tenant_id not in self._graphs:
            return []
        needle = q.lower()
        hits = []
        for node_id, d in self._graphs[tenant_id].g.nodes(data=True):
            if d["type"] in types and (needle in node_id.lower() or needle in str(d["label"]).lower()):
                hits.append((d["type"], node_id, d["label"]))
                if len(hits) >= limit:
                    break
        return hits


graph_service = GraphService()
