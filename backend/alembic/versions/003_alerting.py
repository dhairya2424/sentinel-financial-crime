"""003_alerting: rules, alerts, alert_evidence

Revision ID: 003_alerting
Revises: 002_domain
"""
from alembic import op

revision = "003_alerting"
down_revision = "002_domain"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE rules (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  params         JSONB NOT NULL DEFAULT '{}',
  weights        JSONB NOT NULL DEFAULT '{}',
  version        INT NOT NULL DEFAULT 1,
  updated_by     TEXT REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version)
);

CREATE TABLE alerts (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id),
  rule_code        TEXT NOT NULL,
  rule_version     INT NOT NULL,
  title            TEXT NOT NULL,
  explanation      TEXT NOT NULL,
  risk_score       INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_band        TEXT NOT NULL CHECK (risk_band IN ('low','medium','high','critical')),
  risk_factors     JSONB NOT NULL,
  entity_ids       TEXT[] NOT NULL,
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  dedup_key        TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','acknowledged','linked_to_case','resolved','closed_confirmed','closed_false_positive')),
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedup_key)
);
CREATE INDEX idx_alerts_inbox  ON alerts (tenant_id, status, detected_at DESC);
CREATE INDEX idx_alerts_band   ON alerts (tenant_id, risk_band, detected_at DESC);
CREATE INDEX idx_alerts_entity ON alerts USING GIN (entity_ids);

CREATE TABLE alert_evidence (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  alert_id     TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('transaction','employee_action','access_right','session')),
  ref_id       TEXT NOT NULL,
  snapshot     JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, evidence_type, ref_id)
);
CREATE INDEX idx_ev_alert ON alert_evidence (alert_id);
"""


def _run(sql: str) -> None:
    for stmt in sql.split(";"):
        if stmt.strip():
            op.execute(stmt)


def upgrade() -> None:
    _run(DDL)


def downgrade() -> None:
    _run("DROP TABLE alert_evidence; DROP TABLE alerts; DROP TABLE rules;")
