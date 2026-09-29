"""004_cases: cases, case_alerts, case_notes

Revision ID: 004_cases
Revises: 003_alerting
"""
from alembic import op

revision = "004_cases"
down_revision = "003_alerting"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE cases (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  case_number   TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_review','escalated','closed_confirmed','closed_false_positive')),
  assignee_id   TEXT REFERENCES users(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  closed_at     TIMESTAMPTZ,
  export_digest TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_number)
);
CREATE INDEX idx_cases_queue ON cases (tenant_id, status, updated_at DESC);

CREATE TABLE case_alerts (
  case_id  TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (case_id, alert_id)
);

CREATE TABLE case_notes (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_case ON case_notes (case_id, created_at);
"""


def _run(sql: str) -> None:
    for stmt in sql.split(";"):
        if stmt.strip():
            op.execute(stmt)


def upgrade() -> None:
    _run(DDL)


def downgrade() -> None:
    _run("DROP TABLE case_notes; DROP TABLE case_alerts; DROP TABLE cases;")
