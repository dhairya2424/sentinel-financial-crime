"""005_ops: audit_log, ingest_failures, graph_edges view

Revision ID: 005_ops
Revises: 004_cases
"""
from alembic import op

revision = "005_ops"
down_revision = "004_cases"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor_user  TEXT,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user','system','pipeline')),
  action      TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_obj  ON audit_log (tenant_id, object_type, object_id);
CREATE INDEX idx_audit_time ON audit_log (tenant_id, created_at DESC);

CREATE TABLE ingest_failures (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  payload     JSONB NOT NULL,
  error       TEXT NOT NULL,
  failed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ
);

CREATE VIEW graph_edges AS
SELECT tenant_id, 'TRANSFER' AS edge_type,
       from_account_id AS src, to_account_id AS dst,
       jsonb_build_object('amount', amount, 'ts', value_ts, 'tx_id', id) AS props
FROM transactions
WHERE status = 'completed'
UNION ALL
SELECT tenant_id, 'ACCOUNT_HOLDER', customer_id, id,
       jsonb_build_object('since', opened_at) FROM accounts
UNION ALL
SELECT tenant_id, 'EMPLOYEE_ACCESS', employee_id, employee_id,
       jsonb_build_object('entitlement', entitlement) FROM access_rights
WHERE revoked_at IS NULL;
"""


def _run(sql: str) -> None:
    for stmt in sql.split(";"):
        if stmt.strip():
            op.execute(stmt)


def upgrade() -> None:
    _run(DDL)


def downgrade() -> None:
    _run("DROP VIEW graph_edges; DROP TABLE ingest_failures; DROP TABLE audit_log;")
