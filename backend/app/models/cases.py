from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import NOW, TS, Base


class Case(Base):
    __tablename__ = "cases"
    __table_args__ = (
        CheckConstraint("priority IN ('low','medium','high','critical')", name="cases_priority_check"),
        CheckConstraint(
            "status IN ('open','in_review','escalated','closed_confirmed','closed_false_positive')",
            name="cases_status_check",
        ),
        UniqueConstraint("tenant_id", "case_number", name="cases_tenant_id_case_number_key"),
        Index("idx_cases_queue", "tenant_id", "status", text("updated_at DESC")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    case_number: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'medium'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'open'"))
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(TS)
    export_digest: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class CaseAlert(Base):
    __tablename__ = "case_alerts"

    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), primary_key=True)
    linked_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    linked_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)


class CaseNote(Base):
    __tablename__ = "case_notes"
    __table_args__ = (Index("idx_notes_case", "case_id", "created_at"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
