from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.auth.deps import CurrentUser, get_current_user, not_found, require_role
from app.db import get_db
from app.graph.service import EDGE_TYPES, RebuildStats, graph_service, node_type_of
from app.models import Account, Customer, Employee, EmployeeAction, Transaction

router = APIRouter(prefix="/graph", tags=["graph"])

SEARCH_TYPES = ("customer", "account", "employee")
EntityType = Literal["customer", "account", "employee", "transaction"]


class SearchHit(BaseModel):
    type: EntityType
    id: str
    label: str
    detail: str | None = None
    risk_band: str = "low"


class EntitySummary(BaseModel):
    type: EntityType
    id: str
    label: str
    detail: str | None
    risk_band: str
    stats: dict[str, Any]
    links: dict[str, str | None]


class GraphNode(BaseModel):
    id: str
    type: str
    label: str
    risk: str
    degree: int
    depth: int | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    props: dict[str, Any]


class Neighborhood(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool = False


class Cycles(BaseModel):
    cycles: list[list[str]]
    legs: list[list[str]]


class RebuildOut(BaseModel):
    tenant_id: str
    nodes: int
    edges: dict[str, int]
    ms: float


def _csv(value: str | None, allowed: tuple[str, ...], name: str) -> set[str] | None:
    if not value:
        return None
    wanted = {v.strip() for v in value.split(",") if v.strip()}
    unknown = wanted - set(allowed)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"unknown {name}: {', '.join(sorted(unknown))}")
    return wanted


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def _ensure_graph(db: AsyncSession, tenant_id: str) -> None:
    if not graph_service.loaded(tenant_id):
        await graph_service.rebuild(db, tenant_id)


@router.get("/search", response_model=list[SearchHit])
async def search(
    q: str = Query(min_length=1, max_length=64),
    types: str | None = None,
    limit: int = Query(20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SearchHit]:
    wanted = _csv(types, SEARCH_TYPES, "types") or set(SEARCH_TYPES)
    pattern, needle, t = _like(q.strip()), q.strip().lower(), user.tenant_id
    hits: dict[str, SearchHit] = {}
    if "customer" in wanted:
        rows = await db.execute(
            select(Customer.id, Customer.name, Customer.external_ref)
            .where(Customer.tenant_id == t, or_(*(c.ilike(pattern, escape="\\") for c in (Customer.id, Customer.name, Customer.external_ref))))
            .limit(limit)
        )
        hits.update({cid: SearchHit(type="customer", id=cid, label=name, detail=ref) for cid, name, ref in rows.all()})
    if "account" in wanted:
        rows = await db.execute(
            select(Account.id, Account.account_no_masked, Customer.name)
            .join(Customer, Customer.id == Account.customer_id)
            .where(Account.tenant_id == t, or_(Account.id.ilike(pattern, escape="\\"), Account.account_no_masked.ilike(pattern, escape="\\")))
            .limit(limit)
        )
        hits.update({aid: SearchHit(type="account", id=aid, label=masked, detail=holder) for aid, masked, holder in rows.all()})
    if "employee" in wanted:
        rows = await db.execute(
            select(Employee.id, Employee.name, Employee.role)
            .where(Employee.tenant_id == t, or_(*(c.ilike(pattern, escape="\\") for c in (Employee.id, Employee.name, Employee.external_ref))))
            .limit(limit)
        )
        hits.update({eid: SearchHit(type="employee", id=eid, label=name, detail=role.replace("_", " ")) for eid, name, role in rows.all()})
    await _ensure_graph(db, t)
    for node_type, node_id, label in graph_service.search(t, q.strip(), wanted, limit):
        hits.setdefault(node_id, SearchHit(type=node_type, id=node_id, label=str(label)))

    def rank(hit: SearchHit) -> tuple[int, str]:
        label = hit.label.lower()
        exact = hit.id.lower() == needle or label == needle
        return (0 if exact else 1 if label.startswith(needle) else 2 if needle in label else 3, label)

    return sorted(hits.values(), key=rank)[:limit]


async def _entity(db: AsyncSession, tenant_id: str, entity_id: str) -> tuple[EntityType, str, str | None] | None:
    kind = node_type_of(entity_id)
    if kind in (None, "customer"):
        row = (await db.execute(select(Customer.name, Customer.external_ref).where(Customer.id == entity_id, Customer.tenant_id == tenant_id))).first()
        if row:
            return "customer", row[0], row[1]
    if kind in (None, "account"):
        row = (
            await db.execute(
                select(Account.account_no_masked, Customer.name)
                .join(Customer, Customer.id == Account.customer_id)
                .where(Account.id == entity_id, Account.tenant_id == tenant_id)
            )
        ).first()
        if row:
            return "account", row[0], f"held by {row[1]}"
    if kind in (None, "employee"):
        row = (await db.execute(select(Employee.name, Employee.role).where(Employee.id == entity_id, Employee.tenant_id == tenant_id))).first()
        if row:
            return "employee", row[0], row[1].replace("_", " ")
    if kind in (None, "transaction"):
        row = (
            await db.execute(select(Transaction.amount, Transaction.channel).where(Transaction.id == entity_id, Transaction.tenant_id == tenant_id))
        ).first()
        if row:
            return "transaction", f"₹{row[0]:,}", (row[1] or "").upper() or None
    return None


async def _money_stats(db: AsyncSession, tenant_id: str, accounts: list[str], since: datetime) -> dict[str, Any]:
    if not accounts:
        return {"transfer_count_30d": 0, "sum_amount_30d": "0.00"}
    count, total = (
        await db.execute(
            select(func.count(Transaction.id), func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.tenant_id == tenant_id,
                Transaction.status == "completed",
                Transaction.value_ts >= since,
                or_(Transaction.from_account_id.in_(accounts), Transaction.to_account_id.in_(accounts)),
            )
        )
    ).one()
    return {"transfer_count_30d": count, "sum_amount_30d": str(Decimal(total).quantize(Decimal("0.01")))}


@router.get("/entity/{entity_id}", response_model=EntitySummary)
async def entity(entity_id: str, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> EntitySummary:
    t = user.tenant_id
    found = await _entity(db, t, entity_id)
    if found is None:
        raise not_found("entity")
    kind, label, detail = found
    await _ensure_graph(db, t)
    degree = graph_service.graph(t).degree(entity_id) if graph_service.has_node(t, entity_id) else 0
    since = datetime.now(UTC) - timedelta(days=30)
    stats: dict[str, Any] = {"degree": degree}
    if kind == "customer":
        accounts = list(await db.scalars(select(Account.id).where(Account.tenant_id == t, Account.customer_id == entity_id)))
        stats |= {"accounts": len(accounts), **await _money_stats(db, t, accounts, since)}
    elif kind == "account":
        stats |= await _money_stats(db, t, [entity_id], since)
    elif kind == "employee":
        stats["action_count_30d"] = await db.scalar(
            select(func.count(EmployeeAction.id)).where(
                EmployeeAction.tenant_id == t, EmployeeAction.employee_id == entity_id, EmployeeAction.event_ts >= since
            )
        )
    links = {
        "timeline": f"/timeline/{kind}/{entity_id}" if kind != "transaction" else None,
        "graph": f"/graph?node={entity_id}",
        "alerts": f"/alerts?entity={entity_id}",
    }
    return EntitySummary(type=kind, id=entity_id, label=label, detail=detail, risk_band="low", stats=stats, links=links)


@router.get("/neighbors", response_model=Neighborhood)
async def neighbors(
    node_id: str,
    depth: int = Query(1, ge=1, le=2),
    edge_types: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    wanted = _csv(edge_types, EDGE_TYPES, "edge_types")
    await _ensure_graph(db, user.tenant_id)
    result = graph_service.neighbors(user.tenant_id, node_id, depth, wanted)
    if result is None:
        raise not_found("node")
    return result


@router.get("/cycles", response_model=Cycles)
async def cycles(
    node_id: str,
    window_hours: int = Query(72, ge=1, le=720),
    until: datetime | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[list[str]]]:
    if until is not None and until.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="until must include a timezone")
    await _ensure_graph(db, user.tenant_id)
    result = graph_service.cycles(user.tenant_id, node_id, window_hours, until)
    if result is None:
        raise not_found("node")
    return result


@router.post("/rebuild", response_model=RebuildOut)
async def rebuild(user: CurrentUser = Depends(require_role("admin")), db: AsyncSession = Depends(get_db)) -> RebuildStats:
    stats = await graph_service.rebuild(db, user.tenant_id)
    audit.log(db, user.tenant_id, "graph.rebuild", actor_user=user.id, object_type="graph", object_id=user.tenant_id, detail=stats.__dict__)
    await db.commit()
    return stats
