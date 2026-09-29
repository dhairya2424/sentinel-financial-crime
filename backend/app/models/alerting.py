from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import EMPTY_JSON, NOW, TS, Base


class Rule(Base):
    __tablename__ = "rules"
    __table_args__ = (UniqueConstraint("tenant_id", "code", "version", name="rules_tenant_id_code_version_key"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    weights: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=EMPTY_JSON)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="alerts_risk_score_check"),
        CheckConstraint("risk_band IN ('low','medium','high','critical')", name="alerts_risk_band_check"),
        CheckConstraint(
            "status IN ('open','acknowledged','linked_to_case','resolved','closed_confirmed','closed_false_positive')",
            name="alerts_status_check",
        ),
        UniqueConstraint("tenant_id", "dedup_key", name="alerts_tenant_id_dedup_key_key"),
        Index("idx_alerts_inbox", "tenant_id", "status", text("detected_at DESC")),
        Index("idx_alerts_band", "tenant_id", "risk_band", text("detected_at DESC")),
        Index("idx_alerts_entity", "entity_ids", postgresql_using="gin"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    rule_code: Mapped[str] = mapped_column(Text, nullable=False)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_band: Mapped[str] = mapped_column(Text, nullable=False)
    risk_factors: Mapped[list] = mapped_column(JSONB, nullable=False)
    entity_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    window_start: Mapped[datetime] = mapped_column(TS, nullable=False)
    window_end: Mapped[datetime] = mapped_column(TS, nullable=False)
    dedup_key: Mapped[str] = mapped_column(Text, nullable=False)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'open'"))
    detected_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)


class AlertEvidence(Base):
    __tablename__ = "alert_evidence"
    __table_args__ = (
        CheckConstraint(
            "evidence_type IN ('transaction','employee_action','access_right','session')",
            name="alert_evidence_evidence_type_check",
        ),
        UniqueConstraint("alert_id", "evidence_type", "ref_id", name="alert_evidence_alert_id_evidence_type_ref_id_key"),
        Index("idx_ev_alert", "alert_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False)
    evidence_type: Mapped[str] = mapped_column(Text, nullable=False)
    ref_id: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=NOW)
