from datetime import datetime
from decimal import Decimal

from sqlalchemy import CHAR, CheckConstraint, ForeignKey, Index, Integer, Numeric, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import EMPTY_JSON, NOW, TS, Base, created_at


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("tenant_id", "external_ref", name="customers_tenant_id_external_ref_key"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    external_ref: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kyc_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'verified'"))
    risk_rating: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'standard'"))
    segment: Mapped[str | None] = mapped_column(Text)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("tenant_id", "account_no_masked", name="accounts_tenant_id_account_no_masked_key"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), nullable=False)
    account_no_masked: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    opened_at: Mapped[datetime | None] = mapped_column(TS)
    last_activity_at: Mapped[datetime | None] = mapped_column(TS)
    baseline_30d_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    baseline_30d_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="transactions_amount_check"),
        CheckConstraint("direction IN ('debit','credit')", name="transactions_direction_check"),
        Index("idx_tx_window", "tenant_id", "from_account_id", text("value_ts DESC")),
        Index("idx_tx_to_window", "tenant_id", "to_account_id", text("value_ts DESC")),
        Index("idx_tx_ref", "tenant_id", "reference_no"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    from_account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))
    to_account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, server_default=text("'INR'"))
    direction: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str | None] = mapped_column(Text)
    reference_no: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'completed'"))
    value_ts: Mapped[datetime] = mapped_column(TS, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (UniqueConstraint("tenant_id", "external_ref", name="employees_tenant_id_external_ref_key"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    external_ref: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    department: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class AccessRight(Base):
    __tablename__ = "access_rights"
    __table_args__ = (
        Index("idx_access_active", "tenant_id", "employee_id", postgresql_where=text("revoked_at IS NULL")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    entitlement: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str | None] = mapped_column(Text)
    granted_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)
    granted_by: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'iam'"))


class EmployeeSession(Base):
    __tablename__ = "employee_sessions"
    __table_args__ = (Index("idx_sess_emp", "tenant_id", "employee_id", text("started_at DESC")),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(Text)
    device: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(TS)
    outcome: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'success'"))


class EmployeeAction(Base):
    __tablename__ = "employee_actions"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('customer','account','transaction','employee','system')",
            name="employee_actions_target_type_check",
        ),
        Index("idx_act_target", "tenant_id", "target_type", "target_id", text("event_ts DESC")),
        Index("idx_act_emp", "tenant_id", "employee_id", text("event_ts DESC")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("employee_sessions.id"))
    action_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[str] = mapped_column(Text, nullable=False)
    before_state: Mapped[dict | None] = mapped_column(JSONB)
    after_state: Mapped[dict | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(Text)
    event_ts: Mapped[datetime] = mapped_column(TS, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
