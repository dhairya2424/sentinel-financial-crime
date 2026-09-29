from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app import audit
from app.auth.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.detection.base import format_inr
from app.graph.service import AccountRow, CustomerRow, EmployeeRow, graph_service
from app.ids import new_id
from app.models import AccessRight, Account, Customer, Employee, EmployeeAction, EmployeeSession, Transaction

router = APIRouter(prefix="/entities", tags=["entities"])
register_role = require_role("admin", "investigator")

Name = Annotated[str, Field(min_length=2, max_length=120)]
Ref = Annotated[str, Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_\-/.]+$")]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CustomerIn(_Body):
    name: Name
    external_ref: Ref
    kyc_status: Literal["verified", "pending", "rejected"] = "verified"
    risk_rating: Literal["low", "standard", "high"] = "standard"
    segment: Annotated[str, Field(max_length=40)] | None = None


class AccountIn(_Body):
    customer_id: Annotated[str, Field(pattern=r"^cust_[A-Za-z0-9_\-]+$", max_length=64)]
    account_number: Annotated[str, Field(pattern=r"^[0-9]{6,20}$")]
    type: Literal["savings", "current", "salary", "loan", "fixed_deposit"] = "savings"
    opened_at: AwareDatetime | None = None


class EmployeeIn(_Body):
    name: Name
    external_ref: Ref
    role: Annotated[str, Field(min_length=2, max_length=40)]
    department: Annotated[str, Field(max_length=60)] | None = None
    manager_id: Annotated[str, Field(pattern=r"^emp_[A-Za-z0-9_\-]+$", max_length=64)] | None = None


class Registered(BaseModel):
    id: str
    label: str
    type: Literal["customer", "account", "employee"]


def mask_account_number(number: str) -> str:
    """docs/08: account numbers are stored masked only. The full number never leaves this function."""
    return "X" * (len(number) - 4) + number[-4:]


async def _conflict_if(db: AsyncSession, stmt: Select, detail: str) -> None:
    if await db.scalar(stmt) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=detail)


@router.post("/customers", status_code=status.HTTP_201_CREATED, response_model=Registered)
async def register_customer(body: CustomerIn, user: CurrentUser = Depends(register_role), db: AsyncSession = Depends(get_db)) -> Registered:
    t = user.tenant_id
    await _conflict_if(
        db,
        select(Customer.id).where(Customer.tenant_id == t, Customer.external_ref == body.external_ref),
        f"a customer with reference {body.external_ref} already exists",
    )
    row_id = new_id("cust")
    db.add(Customer(id=row_id, tenant_id=t, **body.model_dump()))
    audit.log(db, t, "entity.create", actor_user=user.id, object_type="customer", object_id=row_id)
    await db.commit()
    graph_service.apply_entity(t, CustomerRow(row_id, body.name, body.external_ref))
    return Registered(id=row_id, label=body.name, type="customer")


@router.post("/accounts", status_code=status.HTTP_201_CREATED, response_model=Registered)
async def register_account(body: AccountIn, user: CurrentUser = Depends(register_role), db: AsyncSession = Depends(get_db)) -> Registered:
    t = user.tenant_id
    owner = await db.get(Customer, body.customer_id)
    if owner is None or owner.tenant_id != t:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"customer {body.customer_id} is not registered")
    masked = mask_account_number(body.account_number)
    await _conflict_if(
        db,
        select(Account.id).where(Account.tenant_id == t, Account.account_no_masked == masked),
        f"an account ending {body.account_number[-4:]} with the same length is already registered",
    )
    row_id = new_id("acct")
    db.add(Account(id=row_id, tenant_id=t, customer_id=body.customer_id, account_no_masked=masked, type=body.type, opened_at=body.opened_at))
    audit.log(db, t, "entity.create", actor_user=user.id, object_type="account", object_id=row_id, detail={"customer_id": body.customer_id})
    await db.commit()
    graph_service.apply_entity(t, AccountRow(row_id, body.customer_id, masked, body.type, body.opened_at))
    return Registered(id=row_id, label=masked, type="account")


@router.post("/employees", status_code=status.HTTP_201_CREATED, response_model=Registered)
async def register_employee(body: EmployeeIn, user: CurrentUser = Depends(register_role), db: AsyncSession = Depends(get_db)) -> Registered:
    t = user.tenant_id
    if body.manager_id:
        manager = await db.get(Employee, body.manager_id)
        if manager is None or manager.tenant_id != t:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"employee {body.manager_id} is not registered")
    await _conflict_if(
        db,
        select(Employee.id).where(Employee.tenant_id == t, Employee.external_ref == body.external_ref),
        f"an employee with code {body.external_ref} already exists",
    )
    row_id = new_id("emp")
    db.add(Employee(id=row_id, tenant_id=t, **body.model_dump()))
    audit.log(db, t, "entity.create", actor_user=user.id, object_type="employee", object_id=row_id)
    await db.commit()
    graph_service.apply_entity(t, EmployeeRow(row_id, body.name, body.role))
    return Registered(id=row_id, label=body.name, type="employee")


class Summary(BaseModel):
    customers: int
    accounts: int
    employees: int
    transactions: int
    employee_actions: int
    sessions: int
    access_rights: int


class Option(BaseModel):
    id: str
    label: str
    detail: str | None = None


LookupType = Literal["customer", "account", "employee", "session", "transaction"]


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/summary", response_model=Summary)
async def summary(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> Summary:
    """How many records of each kind this tenant holds, for the Add data rail."""
    models = {
        "customers": Customer,
        "accounts": Account,
        "employees": Employee,
        "transactions": Transaction,
        "employee_actions": EmployeeAction,
        "sessions": EmployeeSession,
        "access_rights": AccessRight,
    }
    counts = {k: await db.scalar(select(func.count()).select_from(m).where(m.tenant_id == user.tenant_id)) or 0 for k, m in models.items()}
    return Summary(**counts)


@router.get("/lookup", response_model=list[Option])
async def lookup(
    type: LookupType,
    q: str = Query("", max_length=64),
    employee_id: str | None = None,
    limit: int = Query(20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Option]:
    """Registered records for the Add data pickers. An empty query returns the newest records first."""
    t, needle = user.tenant_id, q.strip()
    like = _like(needle)
    if type == "customer":
        stmt = select(Customer.id, Customer.name, Customer.external_ref).where(Customer.tenant_id == t)
        if needle:
            stmt = stmt.where(or_(Customer.name.ilike(like, escape="\\"), Customer.external_ref.ilike(like, escape="\\"), Customer.id == needle))
        rows = (await db.execute(stmt.order_by(Customer.created_at.desc()).limit(limit))).all()
        return [Option(id=i, label=name, detail=ref) for i, name, ref in rows]
    if type == "account":
        stmt = select(Account.id, Account.account_no_masked, Customer.name, Account.type).join(Customer, Customer.id == Account.customer_id)
        stmt = stmt.where(Account.tenant_id == t)
        if needle:
            stmt = stmt.where(or_(Account.account_no_masked.ilike(like, escape="\\"), Customer.name.ilike(like, escape="\\"), Account.id == needle))
        rows = (await db.execute(stmt.order_by(Account.updated_at.desc()).limit(limit))).all()
        return [Option(id=i, label=masked, detail=f"{holder} · {kind}") for i, masked, holder, kind in rows]
    if type == "employee":
        stmt = select(Employee.id, Employee.name, Employee.role, Employee.external_ref).where(Employee.tenant_id == t)
        if needle:
            stmt = stmt.where(or_(Employee.name.ilike(like, escape="\\"), Employee.external_ref.ilike(like, escape="\\"), Employee.id == needle))
        rows = (await db.execute(stmt.order_by(Employee.created_at.desc()).limit(limit))).all()
        return [Option(id=i, label=name, detail=f"{role} · {ref}") for i, name, role, ref in rows]
    if type == "session":
        stmt = select(EmployeeSession).where(EmployeeSession.tenant_id == t)
        if employee_id:
            stmt = stmt.where(EmployeeSession.employee_id == employee_id)
        rows = (await db.scalars(stmt.order_by(EmployeeSession.started_at.desc()).limit(limit))).all()
        return [
            Option(id=s.id, label=s.started_at.strftime("%d %b %Y, %H:%M UTC"), detail=" · ".join(filter(None, [s.outcome, s.ip_address, s.device])))
            for s in rows
        ]
    src, dst = aliased(Account), aliased(Account)
    stmt = (
        select(Transaction.id, Transaction.amount, Transaction.value_ts, src.account_no_masked, dst.account_no_masked)
        .outerjoin(src, src.id == Transaction.from_account_id)
        .outerjoin(dst, dst.id == Transaction.to_account_id)
        .where(Transaction.tenant_id == t)
    )
    if needle:
        stmt = stmt.where(or_(Transaction.id == needle, src.account_no_masked.ilike(like, escape="\\"), dst.account_no_masked.ilike(like, escape="\\")))
    rows = (await db.execute(stmt.order_by(Transaction.value_ts.desc()).limit(limit))).all()
    return [
        Option(id=i, label=f"{format_inr(amount)} · {frm or 'another bank'} → {to or 'another bank'}", detail=ts.strftime("%d %b %Y, %H:%M UTC"))
        for i, amount, ts, frm, to in rows
    ]
