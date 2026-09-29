from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import EMPTY_JSON, NOW, TS, Base


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint("actor_kind IN ('user','system','pipeline')", name="audit_log_actor_kind_check"),
        Index("idx_audit_obj", "tenant_id", "object_type", "object_id"),
        Index("idx_audit_time", "tenant_id", text("created_at DESC")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user: Mapped[str | None] = mapped_column(Text)
    actor_kind: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    object_type: Mapped[str | None] = mapped_column(Text)
    object_id: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class IngestFailure(Base):
    __tablename__ = "ingest_failures"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    error: Mapped[str] = mapped_column(Text, nullable=False)
    failed_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    replayed_at: Mapped[datetime | None] = mapped_column(TS)
