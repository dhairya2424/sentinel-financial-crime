# 05 — Backend Schema & API Contracts

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **DB:** PostgreSQL 15 | **Migrations:** Alembic | **API:** FastAPI, OpenAPI at `/docs`

---

## 1. Conventions

- All IDs: `TEXT` primary keys prefixed by type (`cust_`, `acct_`, `emp_`, `tx_`, `act_`, `alert_`, `case_`, `evt_`) — readable in evidence exports; generated app-side (ULID-style, time-sortable).
- All tables: `tenant_id TEXT NOT NULL` + FK to `tenants(id)`; **every query includes tenant predicate** (enforced in repository layer).
- All timestamps: `TIMESTAMPTZ` UTC. Money: `NUMERIC(18,2)`, currency column (default tenant base).
- Soft delete never used for audit tables; mutations append to `audit_log`.
- JSONB used only for evidence/raw payloads — everything queryable is a column.

## 2. Entity-Relationship Overview

```
tenants ─┬─ customers ──── accounts ──── transactions
         │      ▲              ▲              │
         │      │ account_holder              │ alerts (M:N via alert_evidence)
         │      └── employee_actions ─────────┤
         ├─ employees ─┬─ access_rights       │
         │             └─ employee_sessions   │
         ├─ alerts ── alert_evidence ── (ref → tx_/act_/acct_ rows)
         │     │
         │     └─ cases ── case_alerts ── case_notes
         ├─ rules (config, versioned)
         └─ audit_log, ingest_failures
```

## 3. Full DDL (PostgreSQL 15)

```sql
-- 001_core.sql
CREATE TABLE tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency CHAR(3) NOT NULL DEFAULT 'INR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  config        JSONB NOT NULL DEFAULT '{}',   -- reporting_threshold, off_hours, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (                            -- platform reviewers (not bank employees)
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,                  -- bcrypt
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','investigator','viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- 002_domain.sql
CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  external_ref  TEXT NOT NULL,                  -- source-system customer no
  name          TEXT NOT NULL,
  kyc_status    TEXT NOT NULL DEFAULT 'verified',
  risk_rating   TEXT NOT NULL DEFAULT 'standard',
  segment       TEXT,
  profile_version INT NOT NULL DEFAULT 0,       -- bump on every profile change (graph sync)
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_ref)
);

CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  account_no_masked TEXT NOT NULL,              -- store masked only (PCI-lite)
  type              TEXT NOT NULL,              -- savings|current|loan|...
  status            TEXT NOT NULL DEFAULT 'active',
  opened_at         TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ,
  baseline_30d_count   INT NOT NULL DEFAULT 0,  -- rolling stats for R-STRUCT
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
  channel        TEXT,                          -- upi|neft|rtgs|atm|pos|internal
  reference_no   TEXT,
  status         TEXT NOT NULL DEFAULT 'completed',
  value_ts       TIMESTAMPTZ NOT NULL,          -- business time (drives windows)
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_tx_window    ON transactions (tenant_id, from_account_id, value_ts DESC);
CREATE INDEX idx_tx_to_window ON transactions (tenant_id, to_account_id,   value_ts DESC);
CREATE INDEX idx_tx_ref       ON transactions (tenant_id, reference_no);

CREATE TABLE employees (                        -- the bank's employees (subjects of insider risk)
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  external_ref   TEXT NOT NULL,
  name           TEXT NOT NULL,
  department     TEXT,
  role           TEXT NOT NULL,                 -- teller|manager|finance_ops|analyst|admin_it|...
  manager_id     TEXT REFERENCES employees(id),
  status         TEXT NOT NULL DEFAULT 'active',
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_ref)
);

CREATE TABLE access_rights (                    -- point-in-time entitlements (R-PROFILE input)
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  entitlement    TEXT NOT NULL,                 -- tx.approve, profile.edit, limit.change...
  scope          TEXT,                          -- account|customer|* 
  granted_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,                   -- NULL = active
  granted_by     TEXT,                          -- employee id
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
  outcome        TEXT NOT NULL DEFAULT 'success' -- success|fail|lockout
);
CREATE INDEX idx_sess_emp ON employee_sessions (tenant_id, employee_id, started_at DESC);

CREATE TABLE employee_actions (                 -- the unified activity log (timeline + graph)
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  session_id     TEXT REFERENCES employee_sessions(id),
  action_type    TEXT NOT NULL,                 -- login, logout, profile.edit, tx.approve, limit.change, beneficiary.add, export.data...
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

-- 003_alerting.sql
CREATE TABLE rules (                            -- versioned rule config (F-13)
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  code           TEXT NOT NULL,                 -- R-CIRC, R-STRUCT, R-PROFILE_ROLE, ...
  name           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  params         JSONB NOT NULL DEFAULT '{}',   -- {window_hours:72, min_amount:500000,...}
  weights        JSONB NOT NULL DEFAULT '{}',   -- {amount:0.35, ...} sums to 1.0 (checked app-side)
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
  explanation      TEXT NOT NULL,               -- server-composed human string (mandatory)
  risk_score       INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_band        TEXT NOT NULL CHECK (risk_band IN ('low','medium','high','critical')),
  risk_factors     JSONB NOT NULL,              -- [{name, raw_value, weight, contribution}]
  entity_ids       TEXT[] NOT NULL,             -- customer/acct/emp ids (graph anchors)
  window_start     TIMESTAMPTZ NOT NULL,
  window_end       TIMESTAMPTZ NOT NULL,
  dedup_key        TEXT NOT NULL,               -- rule+entities+window floor
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

CREATE TABLE alert_evidence (                   -- evidence refs → real rows (C4)
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  alert_id     TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('transaction','employee_action','access_right','session')),
  ref_id       TEXT NOT NULL,                   -- tx_/act_/acct_ row id
  snapshot     JSONB NOT NULL,                  -- frozen copy (survives source mutation/deletion)
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, evidence_type, ref_id)
);
CREATE INDEX idx_ev_alert ON alert_evidence (alert_id);

-- 004_cases.sql
CREATE TABLE cases (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  case_number   TEXT NOT NULL,                  -- human ref e.g. CASE-2026-0042
  title         TEXT NOT NULL,
  description   TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_review','escalated','closed_confirmed','closed_false_positive')),
  assignee_id   TEXT REFERENCES users(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  closed_at     TIMESTAMPTZ,
  export_digest TEXT,                           -- sha256 of last export bundle
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

-- 005_ops.sql
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor_user  TEXT,                             -- NULL for system/pipeline
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('user','system','pipeline')),
  action      TEXT NOT NULL,                    -- alert.ack, case.assign, rule.update, login...
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
```

### Graph view (derived, optional materialization)

```sql
-- Not required for runtime (in-memory adjacency), but useful for SQL-side exploration:
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
SELECT tenant_id, 'EMPLOYEE_ACCESS', employee_id, employee_id,  -- resolved at query time
       jsonb_build_object('entitlement', entitlement) FROM access_rights
WHERE revoked_at IS NULL;
-- EMPLOYEE_ACCESS/PROFILE_CHANGE edges resolved to target entity ids at query time by Graph Service.
```

## 4. Graph Model (service view)

| Node | Key | Source |
|---|---|---|
| customer | `cust_*` | `customers` |
| account | `acct_*` | `accounts` |
| employee | `emp_*` | `employees` |

| Edge | src → dst | Source | Props |
|---|---|---|---|
| TRANSFER | account → account | `transactions` | amount, ts, tx_id, channel |
| ACCOUNT_HOLDER | customer → account | `accounts` | since |
| EMPLOYEE_ACCESS | employee → customer/acct | `access_rights` | entitlement, granted_at |
| PROFILE_CHANGE | employee → customer/acct | `employee_actions` (action in edit set) | action, event_ts, act_id |
| EMPLOYEE_ACTION | employee → transaction | `employee_actions` (target_type=transaction) | action, event_ts, act_id |

Startup: batched rebuild (read in 5k chunks → NetworkX `MultiDiGraph`). Runtime: incremental add/update on pipeline events. Persisted graph = PG (source of truth); in-memory = cache.

## 5. WebSocket Protocol (`/v1/ws?token=<jwt>`)

**Client → server:** `{"op":"subscribe","channels":["alerts:tenant_x","dashboard:tenant_x","cases:tenant_x"]}`; `{"op":"unsubscribe",...}`; `{"op":"ping"}`.

**Server → client:**
```json
{"channel":"alerts:tenant_x","type":"alert.created",
 "data":{"id":"alert_...","rule_code":"R-CIRC","risk_band":"critical",
         "title":"...","entity_ids":[...],"detected_at":"..."}}
{"channel":"cases:tenant_x","type":"case.updated","data":{...}}
{"channel":"dashboard:tenant_x","type":"metrics.update","data":{"open_cases":12,"critical_24h":3}}
{"type":"pong"}
```
Auth: token in query or first-message auth; tenant scoping enforced from JWT (never from payload). Heartbeat 25 s; client reconnect with backoff (App Flow §6).

As built in P3-B: a missing or invalid token closes the socket with code `4401`. First-message auth is `{"op":"auth","token":"<jwt>"}` within 5 s. Subscribe/unsubscribe answer `{"type":"subscribed"|"unsubscribed","channels":[...]}` for the channels granted; a channel of another tenant (or any unknown channel) gets `{"type":"error","detail":"channel not allowed","channels":[...]}` and nothing is subscribed. The heartbeat is `{"type":"heartbeat","ts":<epoch s>}`. When new evidence extends an existing alert the hub sends `alert.updated` with the same `data` shape as `alert.created` (the `occurrence_count` rises); `data` also carries `risk_score` and `occurrence_count`.

## 6. REST API Contracts (canonical)

Base: `/v1` | Auth: `Authorization: Bearer <jwt>` | Errors: `{"detail": "...", "code": "..."}` with proper HTTP codes.

### Auth
| Method/Path | Body → Response |
|---|---|
| `POST /auth/login` | `{email,password,tenant_id}` → `{access_token, refresh_token, user}` |
| `POST /auth/refresh` | `{refresh_token}` → `{access_token}` |
| `GET /auth/me` | → `{id,email,role,tenant_id}` |

### Ingest
```
POST /ingest/events          (role: admin|system key)
  body: {events: [{kind: "transaction"|"employee_action"|"access_right"|"session",
                   ...payload}]}   max 500/batch
  → 202 {accepted: n, batch_id}
POST /ingest/access-rights   {employee_id, entitlement, scope, granted_at, revoked_at?} → 201
```
Event payload examples:
```json
{"kind":"transaction","id":"tx_01H...","from_account_id":"acct_1","to_account_id":"acct_2",
 "amount":"150000.00","direction":"debit","channel":"upi","value_ts":"2026-09-22T10:31:00Z"}

{"kind":"employee_action","id":"act_01H...","employee_id":"emp_507",
 "action_type":"profile.edit","target_type":"customer","target_id":"cust_1042",
 "before_state":{"limit":50000},"after_state":{"limit":500000},
 "event_ts":"2026-09-22T10:30:00Z","session_id":"sess_9"}
```

Ingest contract notes (as built after P2-B): every event must name records that are already registered in the tenant: accounts, employees, sessions (which must belong to the acting employee), and an action's customer, account or transaction target. An unknown or cross-tenant reference rejects that event (dead-lettered in `ingest_failures`) instead of creating an "(unresolved)" stand-in row, so every row in the store is real. A transfer to or from another bank leaves that side's account id empty. The 202 response adds `failed`, `errors: [{id, error}]` (for example `"account acct_x is not registered"`) and `skipped_ids` (duplicates already stored).

### Entities (registering real records)
| Method/Path | Body / Query → Response |
|---|---|
| `POST /entities/customers` (admin, investigator) | `{name, external_ref, kyc_status?, risk_rating?, segment?}` → 201 `{id, label, type}`; 409 on a duplicate `external_ref` |
| `POST /entities/accounts` (admin, investigator) | `{customer_id, account_number (6–20 digits), type, opened_at?}` → 201; the number is masked on the server (`X…1234`) and never stored whole (docs/08 §2); 422 if the customer is not registered; 409 on a duplicate masked number |
| `POST /entities/employees` (admin, investigator) | `{name, external_ref, role, department?, manager_id?}` → 201; 409 on a duplicate code |
| `GET /entities/summary` | → `{customers, accounts, employees, transactions, employee_actions, sessions, access_rights}` counts |
| `GET /entities/lookup` | `type=customer\|account\|employee\|session\|transaction`, `q?`, `employee_id?` → `[{id, label, detail}]`, newest first when `q` is empty; accounts match the masked number or the holder's name |

Registrations are audited as `entity.create` and added to the in-memory graph after commit.

### Graph
| Endpoint | Query/Path | Response |
|---|---|---|
| `GET /graph/search` | `q`, `types?` | `[{type,id,label,risk_band}]` top 20 |
| `GET /graph/entity/{id}` | — | entity summary + risk + counts |
| `GET /graph/neighbors` | `node_id`, `depth=1\|2`, `edge_types?csv` | `{nodes:[{id,type,label,risk,...}], edges:[{id,source,target,type,props}]}` (ReactFlow-ready) |
| `GET /graph/cycles` | `node_id`, `window_hours` | detected cycle paths `[[id,...]]` |
| `POST /graph/rebuild` | — (admin) | `{tenant_id, nodes, edges:{type:count}, ms}` — repair path (ADR-001, Runbook INC-3); audited as `graph.rebuild` |

Graph contract notes (as built in P2-A): search hits add `detail` (external ref, holder or role); neighbors nodes add `depth` (hops from the requested node) and the response adds `truncated` (node cap 400); cycles adds `legs` — the transaction ids of each loop in time order — and an optional `until` (ISO, with timezone) that ends the window (default now). A loop is returned only when its legs are time-ordered within the window, the same rule R-CIRC applies (ADR-015). EMPLOYEE_ACCESS edges connect an employee to the entity named by the right's scope (an account or customer id) and to every account or customer where the employee exercised that entitlement; broad scopes (`*`, branch, global) are never fanned out. Graph reads are open to every role per docs/08 §4. Accepted ingest events update the in-memory graph right after commit.

### Timeline
`GET /timeline/{entity_type}/{id}?from&to&categories=&limit&cursor`
→ `{entity:{type,id,label,detail}, items:[{ts, category, title, actor:{id,name}|null, value?, target?, event_kind, ref_id, direction?}], next_cursor}` — merged from `transactions` + `employee_actions` + sessions, ordered DESC. `event_kind` + `ref_id` replace `raw_ref`; `direction` (`in`|`out`|`internal`) is set on transaction items relative to the entity's accounts; `entity` is the header summary (404 when missing or cross-tenant, ADR-011). Titles are readable statement text built from the bank narration (e.g. "ATM cash withdrawal", "Approved transfer of ₹1,47,000").

`GET /timeline/raw/{kind}/{id}` (`kind` = `transaction`|`employee_action`|`session`|`access_right`) → `{kind, source_table, record}` — the full source row for the inspector's raw view; tenant-scoped, 404 otherwise.

`POST /timeline/preview` `{event}` (any ingest event) → `{viewpoint:{type,id,label,detail}|null, item|null, problem|null, note|null}` — the Timeline row an unsaved event would produce, built by the same title code as the Timeline, from the customer (or employee) whose Timeline it lands on. Nothing is written. `problem` carries the same unknown-reference wording ingest would reject with; access rights return a `note` because they do not appear on the Timeline.

### Alerts
| Endpoint | Notes |
|---|---|
| `GET /alerts?band=&rule=&status=&assignee=&from=&to=&cursor&limit=50` | list rows |
| `GET /alerts/{id}` | full: explanation, risk_factors, **evidence (snapshot rows)**, linked case |
| `POST /alerts/{id}/acknowledge` | → updated alert |
| `POST /alerts/{id}/link-case` | `{case_id}` |
| `GET /alerts/{id}/graph` | mini subgraph for inline snapshot |

Alerts contract notes (as built in P3-B): the list filters are `band`, `rule`, `status` (comma lists), `entity` (alerts whose `entity_ids` contain it), `from`/`to` on `detected_at`, keyset `cursor`, `limit` ≤ 200; `assignee` belongs to cases, not alerts. Rows are `{id, rule_code, title, risk_band, risk_score, status, entity_ids, primary_entity, amount_total, detected_at, occurrence_count}`, where `amount_total` sums the transaction evidence snapshots. The detail adds `rule_version, explanation, risk_factors, window_start, window_end, updated_at, evidence:[{evidence_type, ref_id, snapshot, captured_at}], linked_case_id`. Acknowledge works only from `open` (409 otherwise). Link-case accepts `open`, `acknowledged` or `linked_to_case` alerts and an existing, not-closed case of the same tenant (404 unknown case, 409 closed case); both are audited (`alert.ack`, `alert.link`, with from/to). The graph endpoint returns the alert's entities plus their direct TRANSFER neighbours, capped at 50 nodes, with `truncated`. Explanations name accounts by masked number and holder ("XXXXXXXX0011 (Asha Verma)"); ids stay in `entity_ids` and evidence. Rows and the detail also carry `entities: [{id, type, label}]` in `entity_ids` order (customer and employee names, masked account numbers), so the UI never shows a bare id for a person (added in P3-C).

### Cases
| Endpoint | Notes |
|---|---|
| `POST /cases` | `{title, priority?, alert_ids:[...], group_by_entities?:bool}` → case |
| `GET /cases?status=&assignee=&cursor` | queue |
| `GET /cases/{id}` | + linked alerts + notes + audit |
| `PATCH /cases/{id}` | `{status?, priority?, description?, close_note?}` — close requires note |
| `POST /cases/{id}/assign` | `{assignee_id}` (manager+) |
| `POST /cases/{id}/notes` | `{body}` |
| `GET /cases/{id}/export?format=json\|html` | JSON bundle (digest recorded) or HTML report |

**Export JSON bundle shape:**
```json
{"case":{...},"generated_at":"...","generated_by":"user_id",
 "alerts":[{..., "risk_factors":[...], "evidence":[{type, ref_id, snapshot}]}],
 "graph_snapshot":{"nodes":[...],"edges":[...]},
 "timeline":[...],
 "notes":[...], "audit":[...],
 "digest_sha256":"..."}
```

Cases contract notes (as built in P4-A):
- **Create:** `alert_ids` (≤ 50) must be `open` or `acknowledged` alerts of the tenant (404 unknown, 409 otherwise). `group_by_entities` adds every other open/acknowledged alert sharing any entity, newest first, up to 50 in total. An unset `priority` follows the most serious linked alert's band (`medium` with no alerts). `case_number` is `CASE-<year>-<NNNN>`, a per-tenant sequence behind a transaction advisory lock.
- **Transitions (docs/04 §6):** `open→in_review|closed_*`, `in_review→escalated|closed_*`, `escalated→closed_*`; anything else is 400, a no-op PATCH is 400, and any change to a closed case (including notes and assignment) is 409.
- **Closing:** needs `close_note` ≥ 10 characters after trimming (422 `close_note required (>=10 chars)`). The note is stored as a case note, `closed_at` is set, and the verdict is copied to every linked alert.
- **Permissions:** investigators change only cases they created or are assigned (403 otherwise), and closing straight from `open` is manager/admin only. Assign takes an active, non-viewer user of the tenant; investigators may assign only themselves. Assigning an `open` case moves it to `in_review`.
- **Response shapes:** list rows add `alert_count`, `top_band`, `assignee_name`; `assignee=me|none|<user id>`; keyset cursor on `updated_at`. The detail adds `alerts` (alert rows), `notes` and `audit` (case and linked-alert rows, oldest first).
- **Live updates:** every change publishes `case.updated` `{id,status,assignee_id,updated_at}` on `cases:{tenant}`. Alerts whose status changed (linked or closed) also get `alert.updated` with `status` in `data`.
- **Export:**
  - Returns `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `X-Digest-SHA256`, and records `cases.export_digest` without touching `updated_at`.
  - The bundle also carries `evidence_count` and `evidence_truncated`, and `graph_snapshot.focus`/`truncated` (entities plus 1-hop, ≤ 300 nodes, sorted).
  - `timeline` holds ≤ 200 merged items, each with a `viewpoint`. `case` omits `export_digest`, and `audit` omits `case.export` rows, so re-exports stay stable.
  - Evidence is included in full up to 5,000 rows; `evidence_truncated` marks anything beyond that.
- **Dashboard (`GET /v1/dashboard/metrics`, all roles):** `{open_cases, open_cases_by_priority, critical_24h, high_24h, alerts_24h, fp_rate_7d (closed_false_positive ÷ cases closed in 7 d, null if none), closed_7d, top_entities:[{entity_id, alert_count, type, label}] (top 5, 30 d), ingest:{events_per_min (this tenant's stream entries in the last minute), lag_ms, backlog}}`. The same payload goes out as `metrics.update` on `dashboard:{tenant}` every 15 s while someone is subscribed, and only when it changed.

### Users (as built in P4-B)
`GET /v1/users/assignees` (any role): `[{id, full_name, role}]` for active non-viewer users of the caller's tenant, ordered by name; no emails. It feeds the assignee pickers, since `GET /v1/users` stays admin-only. CORS exposes `Content-Disposition` and `X-Digest-SHA256`, so the browser export can keep the server's file name and show the digest.

### Rules & Ops
```
GET  /rules                 → active versions
PUT  /rules/{code}          {params, weights, enabled} (admin) → version+1 (new row)
GET  /ops/health            {db, redis, ws_clients, pipeline:{processed, alerts_created, alerts_updated, errors, stream_lag_ms}}
                            (as built in P3-B; events_per_min and failed_batches arrive with the P5 ops work)
POST /ops/replay-batch      {batch_id or failure_id} (admin)
```

## 7. Validation Rules (server-side, Pydantic)

- Amounts: `> 0`, ≤ 2 decimals; timestamps ISO-8601 UTC; unknown fields rejected (`extra="forbid"`).
- `risk_factors.contribution` must sum to `risk_score/100` ± 0.01 (asserted before persist — **explainability invariant**).
- Rule `weights` must sum to 1.0 (±0.001) on PUT.
- Ingest idempotency: duplicate `id` in `events` within 7 days → skipped, counted in response.
- Tenant mismatch (JWT tenant ≠ resource tenant) → 404 (not 403 — no existence leak).
