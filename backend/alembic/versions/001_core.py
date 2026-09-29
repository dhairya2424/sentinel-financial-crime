"""001_core: tenants, users

Revision ID: 001_core
Revises:
"""
from alembic import op

revision = "001_core"
down_revision = None
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  config        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','investigator','viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
"""


def _run(sql: str) -> None:
    for stmt in sql.split(";"):
        if stmt.strip():
            op.execute(stmt)


def upgrade() -> None:
    _run(DDL)


def downgrade() -> None:
    _run("DROP TABLE users; DROP TABLE tenants;")
