from datetime import datetime

from sqlalchemy import CHAR, Boolean, CheckConstraint, ForeignKey, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import EMPTY_JSON, Base, created_at


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    base_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, server_default=text("'INR'"))
    timezone: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'Asia/Kolkata'"))
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    created_at: Mapped[datetime] = created_at()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('admin','manager','investigator','viewer')", name="users_role_check"),
        UniqueConstraint("tenant_id", "email", name="users_tenant_id_email_key"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = created_at()
