"""002_domain: customers, accounts, transactions, employees, access, sessions, actions

Revision ID: 002_domain
Revises: 001_core
"""
from alembic import op

revision = "002_domain"
down_revision = "001_core"
branch_labels = None
depends_on = None

DDL = """
CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  external_ref  TEXT NOT NULL,
  name          TEXT NOT NULL,
  kyc_status    TEXT NOT NULL DEFAULT 'verified',
  risk_rating   TEXT NOT NULL DEFAULT 'standard',
  segment       TEXT,
  profile_version INT NOT NULL DEFAULT 0,
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_ref)
);

CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  account_no_masked TEXT NOT NULL,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  opened_at         TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ,
  baseline_30d_count   INT NOT NULL DEFAULT 0,
  baseline_30d_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_no_masked)
);

CREATE TABLE transactions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  from_account_id TEXT REFERENCES accounts(id),
  to_account_id   TEXT REFERENCES accounts(id),
  amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency       CHAR(3) NOT NULL DEFAULT 'INR',
  direction      TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  channel        TEXT,
  reference_no   TEXT,
  status         TEXT NOT NULL DEFAULT 'completed',
  value_ts       TIMESTAMPTZ NOT NULL,
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_tx_window    ON transactions (tenant_id, from_account_id, value_ts DESC);
CREATE INDEX idx_tx_to_window ON transactions (tenant_id, to_account_id,   value_ts DESC);
CREATE INDEX idx_tx_ref       ON transactions (tenant_id, reference_no);

CREATE TABLE employees (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  external_ref   TEXT NOT NULL,
  name           TEXT NOT NULL,
  department     TEXT,
  role           TEXT NOT NULL,
  manager_id     TEXT REFERENCES employees(id),
  status         TEXT NOT NULL DEFAULT 'active',
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_ref)
);

CREATE TABLE access_rights (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  entitlement    TEXT NOT NULL,
  scope          TEXT,
  granted_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  granted_by     TEXT,
  source         TEXT NOT NULL DEFAULT 'iam'
);
CREATE INDEX idx_access_active ON access_rights (tenant_id, employee_id) WHERE revoked_at IS NULL;

CREATE TABLE employee_sessions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  ip_address     TEXT,
  device         TEXT,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  outcome        TEXT NOT NULL DEFAULT 'success'
);
CREATE INDEX idx_sess_emp ON employee_sessions (tenant_id, employee_id, started_at DESC);

CREATE TABLE employee_actions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  session_id     TEXT REFERENCES employee_sessions(id),
  action_type    TEXT NOT NULL,
  target_type    TEXT NOT NULL CHECK (target_type IN ('customer','account','transaction','employee','system')),
  target_id      TEXT NOT NULL,
  before_state   JSONB,
  after_state    JSONB,
  ip_address     TEXT,
  event_ts       TIMESTAMPTZ NOT NULL,
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_act_target ON employee_actions (tenant_id, target_type, target_id, event_ts DESC);
CREATE INDEX idx_act_emp    ON employee_actions (tenant_id, employee_id, event_ts DESC);
"""


def _run(sql: str) -> None:
    for stmt in sql.split(";"):
        if stmt.strip():
            op.execute(stmt)


def upgrade() -> None:
    _run(DDL)


def downgrade() -> None:
    _run("DROP TABLE employee_actions; DROP TABLE employee_sessions; DROP TABLE access_rights; "
        "DROP TABLE employees; DROP TABLE transactions; DROP TABLE accounts; DROP TABLE customers;")
