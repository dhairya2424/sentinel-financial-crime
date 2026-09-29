import base64
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.detection.base import format_inr
from app.models import Account, Customer, Employee, EmployeeAction, EmployeeSession, Transaction
from app.schemas.ingest import AccessRightEvent, EmployeeActionEvent, SessionEvent, TransactionEvent
from app.services.ingest import UnknownReference, check_references

EntityType = Literal["customer", "account", "employee"]
Direction = Literal["in", "out", "internal"]
ALL_CATEGORIES: frozenset[str] = frozenset({"transaction", "profile_change", "access_login", "approval"})

ACTION_CATEGORY = {
    "login": "access_login",
    "logout": "access_login",
    "export.data": "access_login",
    "profile.edit": "profile_change",
    "beneficiary.add": "profile_change",
    "limit.change": "profile_change",
    "tx.approve": "approval",
}
SESSION_LABEL = {"success": "Session started", "fail": "Failed sign-in", "lockout": "Account locked out"}
PROFILE_FIELDS = {
    "mobile": "mobile number",
    "email": "email",
    "address": "address",
    "nominee": "nominee",
    "kyc_document": "KYC document",
    "daily_transfer_limit": "daily transfer limit",
    "limit": "limit",
}
ACRONYMS = {"UPI", "POS", "ATM", "RTGS", "NEFT", "IMPS", "SIP", "EMI", "EPFO", "IRCTC", "MSEDCL", "KPIT", "HP", "JIO", "FD"}


@dataclass
class TimelineItem:
    ts: datetime
    category: str
    title: str
    actor: dict[str, str] | None
    value: str | None
    target: str | None
    event_kind: str
    ref_id: str
    direction: Direction | None = None
    target_label: str | None = None


@dataclass
class EntitySummary:
    type: EntityType
    id: str
    label: str
    detail: str | None


def encode_cursor(ts: datetime, ref_id: str) -> str:
    return base64.urlsafe_b64encode(f"{ts.isoformat()}|{ref_id}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        ts, ref_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(ts), ref_id
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("invalid cursor") from exc


def _words(text: str) -> list[str]:
    return [w if w in ACRONYMS else w[:1].upper() + w[1:].lower() for w in text.split()]


def _title_case(text: str) -> str:
    return " ".join(_words(text))


def _sentence(text: str) -> str:
    return " ".join(w if i == 0 or w in ACRONYMS else w.lower() for i, w in enumerate(_words(text)))


def transaction_title(narration: str | None, counterparty: str | None, direction: Direction, channel: str | None) -> str:
    """Readable title from the bank narration; falls back to direction and channel when there is none."""
    text = (narration or "").strip().upper()
    if text.startswith("SALARY"):
        return f"Salary credit · {counterparty}" if counterparty else "Salary credit"
    if text.startswith("PENSION"):
        return "Pension credit"
    if text.startswith("UPI COLLECT"):
        return "UPI collection"
    if text.startswith("UPI "):
        return f"UPI payment · {_title_case(text[4:])}"
    if text.startswith("POS "):
        return f"Card payment · {_title_case(text[4:])}"
    if text.startswith("ATM"):
        return "ATM cash withdrawal"
    if text.startswith("TRANSFER TO"):
        if direction == "in":
            return "Incoming transfer"
        return f"Transfer to {counterparty}" if counterparty else _sentence(text)
    if text.startswith("RTGS "):
        return f"RTGS · {_sentence(text[5:])}"
    if text:
        return _sentence(text)
    via = (channel or "bank").upper()
    return {"in": f"Incoming {via} credit", "out": f"Outgoing {via} debit", "internal": "Transfer between own accounts"}[direction]


def _money(value: Any) -> str | None:
    try:
        return format_inr(Decimal(str(value)))
    except (InvalidOperation, ValueError):
        return None


def action_title(action_type: str, before: dict | None, after: dict | None, tx_amount: Decimal | None) -> str:
    after = after or {}
    if action_type == "profile.edit":
        fields = [PROFILE_FIELDS.get(k, k.replace("_", " ")) for k in after] or ["details"]
        return f"Edited profile · {', '.join(fields)}"
    if action_type == "beneficiary.add":
        added = after.get("added")
        name = added.get("name") if isinstance(added, dict) else None
        return f"Added beneficiary · {name}" if name else "Added beneficiary"
    if action_type == "limit.change":
        new = next((after[k] for k in ("daily_transfer_limit", "limit") if k in after), None)
        amount = _money(new) if new is not None else None
        return f"Changed transfer limit to {amount}" if amount else "Changed transfer limit"
    if action_type == "tx.approve":
        amount = format_inr(tx_amount) if tx_amount is not None else _money(after.get("amount"))
        return f"Approved transfer of {amount}" if amount else "Approved transfer"
    return {"export.data": "Exported data", "login": "Logged in", "logout": "Logged out"}.get(action_type, action_type)


async def describe_entity(db: AsyncSession, tenant_id: str, entity_type: EntityType, entity_id: str) -> EntitySummary | None:
    """Header summary for the timeline; None when the entity is missing or belongs to another tenant (ADR-011)."""
    if entity_type == "customer":
        row = await db.scalar(select(Customer).where(Customer.id == entity_id, Customer.tenant_id == tenant_id))
        if row is None:
            return None
        detail = " · ".join(filter(None, [row.external_ref, row.segment, (row.meta or {}).get("branch")]))
        return EntitySummary("customer", row.id, row.name, detail or None)
    if entity_type == "account":
        found = (
            await db.execute(
                select(Account, Customer.name)
                .join(Customer, Customer.id == Account.customer_id)
                .where(Account.id == entity_id, Account.tenant_id == tenant_id)
            )
        ).first()
        if found is None:
            return None
        acct, holder = found
        return EntitySummary("account", acct.id, acct.account_no_masked, f"{acct.type} · held by {holder}")
    row = await db.scalar(select(Employee).where(Employee.id == entity_id, Employee.tenant_id == tenant_id))
    if row is None:
        return None
    detail = " · ".join(filter(None, [row.role.replace("_", " "), row.department, (row.meta or {}).get("branch")]))
    return EntitySummary("employee", row.id, row.name, detail or None)


async def _target_labels(db: AsyncSession, tenant_id: str, actions: list[EmployeeAction]) -> dict[str, str]:
    """Readable names for action targets: customer name, or masked account number plus holder."""
    customers = {a.target_id for a in actions if a.target_type == "customer"}
    accounts = {a.target_id for a in actions if a.target_type == "account"}
    labels: dict[str, str] = {}
    if customers:
        rows = await db.execute(select(Customer.id, Customer.name).where(Customer.tenant_id == tenant_id, Customer.id.in_(customers)))
        labels.update({cid: name for cid, name in rows.all()})
    if accounts:
        rows = await db.execute(
            select(Account.id, Account.account_no_masked, Customer.name)
            .join(Customer, Customer.id == Account.customer_id)
            .where(Account.tenant_id == tenant_id, Account.id.in_(accounts))
        )
        labels.update({aid: f"{masked} · {holder}" for aid, masked, holder in rows.all()})
    return labels


def _window(column, id_column, start: datetime | None, end: datetime | None, after: tuple[datetime, str] | None) -> list:
    clauses = []
    if start:
        clauses.append(column >= start)
    if end:
        clauses.append(column <= end)
    if after:
        ts, ref = after
        clauses.append(or_(column < ts, and_(column == ts, id_column < ref)))
    return clauses


async def build_timeline(
    db: AsyncSession,
    tenant_id: str,
    entity_type: EntityType,
    entity_id: str,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    categories: set[str] | None = None,
    limit: int = 100,
    cursor: str | None = None,
) -> tuple[list[TimelineItem], str | None]:
    """Merge transactions, employee actions and sessions for one entity, newest first, with keyset pagination."""
    cats = set(categories or ALL_CATEGORIES) & ALL_CATEGORIES
    after = decode_cursor(cursor) if cursor else None
    fetch = limit + 1
    items: list[TimelineItem] = []

    accounts: list[str] = []
    if entity_type == "customer":
        accounts = list(await db.scalars(select(Account.id).where(Account.tenant_id == tenant_id, Account.customer_id == entity_id)))
    elif entity_type == "account":
        accounts = [entity_id]

    if accounts and "transaction" in cats:
        stmt = (
            select(Transaction)
            .where(
                Transaction.tenant_id == tenant_id,
                or_(Transaction.from_account_id.in_(accounts), Transaction.to_account_id.in_(accounts)),
                *_window(Transaction.value_ts, Transaction.id, start, end, after),
            )
            .order_by(Transaction.value_ts.desc(), Transaction.id.desc())
            .limit(fetch)
        )
        for tx in await db.scalars(stmt):
            outgoing = tx.from_account_id in accounts
            incoming = tx.to_account_id in accounts
            direction: Direction = "internal" if outgoing and incoming else "out" if outgoing else "in"
            counterparty_account = None if direction == "internal" else tx.to_account_id if outgoing else tx.from_account_id
            raw = tx.raw or {}
            title = transaction_title(raw.get("narration"), raw.get("counterparty"), direction, tx.channel)
            items.append(
                TimelineItem(tx.value_ts, "transaction", title, None, str(tx.amount), counterparty_account, "transaction", tx.id, direction)
            )

    action_types = [a for a, c in ACTION_CATEGORY.items() if c in cats]
    if action_types:
        if entity_type == "employee":
            scope = EmployeeAction.employee_id == entity_id
        else:
            tx_ids = select(Transaction.id).where(
                Transaction.tenant_id == tenant_id,
                or_(Transaction.from_account_id.in_(accounts), Transaction.to_account_id.in_(accounts)),
            )
            targets = [and_(EmployeeAction.target_type == "transaction", EmployeeAction.target_id.in_(tx_ids))]
            if accounts:
                targets.append(and_(EmployeeAction.target_type == "account", EmployeeAction.target_id.in_(accounts)))
            if entity_type == "customer":
                targets.append(and_(EmployeeAction.target_type == "customer", EmployeeAction.target_id == entity_id))
            scope = or_(*targets)
        stmt = (
            select(EmployeeAction, Employee.name, Transaction.amount)
            .join(Employee, Employee.id == EmployeeAction.employee_id)
            .outerjoin(
                Transaction,
                and_(
                    EmployeeAction.target_type == "transaction",
                    Transaction.id == EmployeeAction.target_id,
                    Transaction.tenant_id == tenant_id,
                ),
            )
            .where(
                EmployeeAction.tenant_id == tenant_id,
                EmployeeAction.action_type.in_(action_types),
                scope,
                *_window(EmployeeAction.event_ts, EmployeeAction.id, start, end, after),
            )
            .order_by(EmployeeAction.event_ts.desc(), EmployeeAction.id.desc())
            .limit(fetch)
        )
        rows = (await db.execute(stmt)).all()
        labels = await _target_labels(db, tenant_id, [act for act, _, _ in rows])
        for act, name, tx_amount in rows:
            items.append(
                TimelineItem(
                    act.event_ts,
                    ACTION_CATEGORY[act.action_type],
                    action_title(act.action_type, act.before_state, act.after_state, tx_amount),
                    {"id": act.employee_id, "name": name},
                    None,
                    act.target_id,
                    "employee_action",
                    act.id,
                    target_label=labels.get(act.target_id),
                )
            )

    if entity_type == "employee" and "access_login" in cats:
        stmt = (
            select(EmployeeSession, Employee.name)
            .join(Employee, Employee.id == EmployeeSession.employee_id)
            .where(
                EmployeeSession.tenant_id == tenant_id,
                EmployeeSession.employee_id == entity_id,
                *_window(EmployeeSession.started_at, EmployeeSession.id, start, end, after),
            )
            .order_by(EmployeeSession.started_at.desc(), EmployeeSession.id.desc())
            .limit(fetch)
        )
        for sess, name in (await db.execute(stmt)).all():
            where = f" from {sess.ip_address}" if sess.ip_address else ""
            items.append(
                TimelineItem(
                    sess.started_at,
                    "access_login",
                    f"{SESSION_LABEL.get(sess.outcome, 'Session')}{where}",
                    {"id": sess.employee_id, "name": name},
                    None,
                    sess.device,
                    "session",
                    sess.id,
                )
            )

    items.sort(key=lambda i: (i.ts, i.ref_id), reverse=True)
    page = items[:limit]
    next_cursor = encode_cursor(page[-1].ts, page[-1].ref_id) if len(items) > limit and page else None
    return page, next_cursor


@dataclass
class Preview:
    """How an event that has not been saved yet will read on the Timeline, and from whose Timeline."""

    viewpoint: EntitySummary | None
    item: TimelineItem | None
    problem: str | None = None
    note: str | None = None


async def _holder(db: AsyncSession, tenant_id: str, account_id: str | None) -> str | None:
    if not account_id:
        return None
    return await db.scalar(select(Account.customer_id).where(Account.id == account_id, Account.tenant_id == tenant_id))


async def preview_item(
    db: AsyncSession, tenant_id: str, event: TransactionEvent | EmployeeActionEvent | AccessRightEvent | SessionEvent
) -> Preview:
    """Render an unsaved ingest event exactly as build_timeline would, from the customer (or employee) whose
    Timeline it lands on first. Nothing is written. Unknown references come back as `problem`, worded as ingest words them."""
    try:
        await check_references(db, tenant_id, event)
    except UnknownReference as exc:
        return Preview(None, None, problem=str(exc))

    if isinstance(event, AccessRightEvent):
        note = "Access rights don't appear on the Timeline. They show on the Graph as access edges once the employee uses them."
        return Preview(await describe_entity(db, tenant_id, "employee", event.employee_id), None, note=note)

    if isinstance(event, SessionEvent):
        name = await db.scalar(select(Employee.name).where(Employee.id == event.employee_id))
        where = f" from {event.ip_address}" if event.ip_address else ""
        item = TimelineItem(
            event.started_at, "access_login", f"{SESSION_LABEL.get(event.outcome, 'Session')}{where}",
            {"id": event.employee_id, "name": name or event.employee_id}, None, event.device, "session", event.id,
        )
        return Preview(await describe_entity(db, tenant_id, "employee", event.employee_id), item)

    if isinstance(event, TransactionEvent):
        own = event.from_account_id or event.to_account_id
        customer = await _holder(db, tenant_id, own)
        other_holder = await _holder(db, tenant_id, event.to_account_id if event.from_account_id else None)
        outgoing = event.from_account_id is not None
        direction: Direction = "internal" if outgoing and other_holder == customer else "out" if outgoing else "in"
        counterparty = None if direction == "internal" else event.to_account_id if outgoing else event.from_account_id
        raw = event.raw or {}
        title = transaction_title(raw.get("narration"), raw.get("counterparty"), direction, event.channel)
        item = TimelineItem(event.value_ts, "transaction", title, None, str(event.amount), counterparty, "transaction", event.id, direction)
        return Preview(await describe_entity(db, tenant_id, "customer", customer) if customer else None, item)

    name = await db.scalar(select(Employee.name).where(Employee.id == event.employee_id))
    tx_amount = None
    customer = None
    if event.target_type == "customer":
        customer = event.target_id
    elif event.target_type == "account":
        customer = await _holder(db, tenant_id, event.target_id)
    elif event.target_type == "transaction":
        tx = await db.scalar(select(Transaction).where(Transaction.id == event.target_id, Transaction.tenant_id == tenant_id))
        if tx is not None:
            tx_amount = tx.amount
            customer = await _holder(db, tenant_id, tx.from_account_id or tx.to_account_id)
    action = EmployeeAction(target_type=event.target_type, target_id=event.target_id)
    labels = await _target_labels(db, tenant_id, [action])
    item = TimelineItem(
        event.event_ts, ACTION_CATEGORY.get(event.action_type, "profile_change"),
        action_title(event.action_type, event.before_state, event.after_state, tx_amount),
        {"id": event.employee_id, "name": name or event.employee_id}, None, event.target_id, "employee_action", event.id,
        target_label=labels.get(event.target_id),
    )
    viewpoint = (
        await describe_entity(db, tenant_id, "customer", customer)
        if customer and ACTION_CATEGORY.get(event.action_type) != "access_login"
        else await describe_entity(db, tenant_id, "employee", event.employee_id)
    )
    return Preview(viewpoint, item)
