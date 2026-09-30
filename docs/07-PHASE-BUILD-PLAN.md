# 07 — Phase Build Plan (Execution-Level + Claude Prompts)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 2.1 | **Purpose:** Day-by-day build order with dependencies, exit gates — **plus copy-paste prompts for Claude, one session per section.**

---

## How to Use These Prompts

1. **One prompt = one Claude session.** Start a fresh session per phase (or per sub-section of large phases). Do not merge phases in one session — context drift causes broken assumptions.
2. **Every prompt is self-contained:** it names the exact docs to read, files to create, contracts to honor, and verification commands. Claude must read the referenced docs before writing code.
3. **Never skip an Exit Gate.** Run the verification commands yourself before feeding the next prompt.
4. **If a phase fails its gate**, use the [Repair Prompt Template](#repair-prompt-template) with the exact error output.
5. **Repo root:** the directory containing `docs/` (e.g., `sentinel/`). Backend at `backend/`, frontend at `frontend/`.

### Doc Map — which docs bind which phase

| Doc | Role in build | Consumed by |
|---|---|---|
| 01-PRD | **§1.1–1.4 normative problem statement + EO-1..EO-5 traceability**; Story ACs (A1–A3, B1–B2, C1–C5, D1–D3, E1–E2) | all phases; gates cite §1.4 Proven-by |
| 02-TRD | Architecture, algorithms (normative), pipeline budgets | P0, P2, P3 |
| 03-UIUX | Screen/component specs, EvidencePanel contract | P0-B, P1-B, P2-B, P3-C, P4-B |
| 04-APP-FLOW | Routes, journeys, state machines, WS lifecycle | all frontend prompts |
| 05-BACKEND-SCHEMA | DDL, API/WS contracts, validation invariants | all backend prompts |
| 06-IMPLEMENTATION-PLAN | Repo structure, env vars, scenario targets (S/L) | P0, P5-A |
| **08-SECURITY** | Threat model, **RBAC matrix (normative roles per route)**, audit action list, retention | P0-A (auth), P1-A (audit), P3-B (WS auth), P4-A (export sec), P5-A (hardening tests) |
| **09-DATA-DICTIONARY** | **Frozen enums, id prefixes, factor names, rule codes, timeline categories** | every prompt that names an enum/factor/id — treat as lookup table |
| **10-TEST-STRATEGY** | **Test IDs (T-DET/T-GRPH/T-INT/T-FE/S\*), metric definitions, exit→test mapping** | verification blocks name these IDs; gates assert them |
| **11-OPERATIONS-RUNBOOK** | Commands, health signals, INC playbacks, demo-day checklist | P5-B (packaging), incident use during any phase |
| **12-DEMO-SCRIPT** | Judge run-of-show, Q&A | P5-B (README demo section must match it) |
| **13-ADR** | Accepted decisions (graph store, bands, digest, 404-tenant, EvidencePanel design) | if a prompt seems to conflict with an ADR — **ADR wins**; cite in repair tasks |

### Session Preamble (prepend to EVERY prompt)

```
You are building "Sentinel", a Financial Crime & Insider Risk Intelligence Platform.
Repo root contains docs/01-PRD.md … docs/13-ADR.md.

MANDATORY first step: read these files fully before writing any code:
- docs/02-TRD.md (architecture, stack, algorithms)
- docs/05-BACKEND-SCHEMA.md (exact DDL, API contracts, WS protocol)
- docs/09-DATA-DICTIONARY.md (frozen enums, id prefixes, factor names, rule codes)
- the phase-specific docs listed in this prompt

Rules:
- Normative problem statement + expected outcomes EO-1..EO-5: docs/01-PRD.md
  §1.1–1.4 — every phase gate must leave all five EOs provable (their
  "Proven by" tests must exist and pass by Final Gate).
- Follow the docs EXACTLY — table names, endpoint paths, field names, risk factor
  names, and band boundaries are frozen contracts. Do not invent alternatives.
- Where docs disagree: ADR (docs/13) > Data Dictionary (docs/09) > phase prompt > other prose.
- Stack is fixed: Python 3.11 + FastAPI + SQLAlchemy 2.0 async + Alembic +
  PostgreSQL 15 + Redis 7 + networkx; React 18 + TS + Vite + Tailwind 3.4 +
  ReactFlow 12 + Zustand + Recharts + Vitest. Substitute a library only when the named one is
  unmaintained, insecure or broken on current versions — record it as an ADR and
  in the Reconciliation Log.
- Roles/RBAC: follow the matrix in docs/08 §4 — viewer never mutates; 404 for
  cross-tenant reads (ADR-011), 403 for role failures.
- Tests: name test functions per docs/10 test IDs where listed (e.g. T-DET-01
  in a docstring or test id param) so gates can cite them.
- No placeholders, no TODOs, no "left as exercise" — every file complete and runnable.
- No comments in code unless essential; no secrets in code (env vars only, see docs/06 §4).
- When done: run the Verification block and report actual output. If anything fails, fix it before reporting success.
```

---

## Phase Overview & Dependency Graph

```
P0 Foundation ──► P1 Ingest+Timeline ──► P2 Graph ──► P3 Detection+Realtime ──► P4 Cases+Export ──► P5 Scenarios+Hardening
```

| Phase | Duration | Depends on | Claude sessions | Key new docs consumed |
|---|---|---|---|---|
| P0 Foundation | 0.5–1 day | — | 2 (backend, frontend) | 08 (auth/RBAC), 09 (enums), 13 (ADR-010/011/012) |
| P1 Ingest + Timeline | 1–1.5 days | P0 | 2 (backend, frontend) | 08 (audit list), 09 (event enums), 10 (T-INT-01..10) |
| P2 Graph Service | 1–1.5 days | P0 | 2 (backend, frontend) | 09 (graph enums), 10 (T-GRPH), 13 (ADR-001) |
| P3 Detection + Realtime | 2 days | P1, P2 | 4 (risk+rules, pipeline+WS, alerts API, alerts UI) | 09 (factors/codes), 10 (T-DET/T-FE), 13 (ADR-002/003/004/005/007/009) |
| P4 Cases + Export | 1 day | P3 | 2 (backend, frontend) | 08 (export sec/roles), 10 (T-INT-11..16), 13 (ADR-008) |
| P5 Scenarios + Hardening | 1–1.5 days | P4 | 2 (tests+metrics, demo+docs) | 08 (threats/CI), 10 (metrics defs), 11 (runbook), 12 (demo), 13 (ADRs final) |

---

# Phase 0 — Foundation

## Prompt P0-A: Backend Foundation

```
<SESSION PREAMBLE above>

PHASE: P0-A — Backend Foundation
Docs to read: docs/02-TRD.md (§1–2, §10), docs/05-BACKEND-SCHEMA.md (§1–3, §6 auth),
docs/06-IMPLEMENTATION-PLAN.md (§1, §4), docs/08-SECURITY-AND-COMPLIANCE.md (§2–4 —
JWT claims §3, RBAC matrix §4 is normative for require_role), docs/13-ADR.md
(ADR-010 id prefixes, ADR-011 404-on-tenant-mismatch, ADR-012 demo creds),
docs/09-DATA-DICTIONARY.md (§2 id prefixes, §3 users.role enum)

Create exactly:
1. docker-compose.yml (repo root): services postgres:15-alpine (db `sentinel`,
   user/pass from env with dev defaults sentinel/sentinel, port 5432, named volume),
   redis:7-alpine (port 6379, healthcheck redis-cli ping). Healthchecks with retries.
   Do NOT add api/web services yet.
2. backend/requirements.txt: fastapi, uvicorn[standard], sqlalchemy[asyncio]>=2.0,
   asyncpg, alembic, pydantic>=2, pydantic-settings, redis>=5, networkx>=3,
   pyjwt, bcrypt>=5 (ADR-013), python-multipart, httpx2 (test),
   pytest, pytest-asyncio.
3. backend/app/config.py: pydantic-settings BaseSettings with env vars exactly as
   docs/06 §4 (DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_ACCESS_MIN=30,
   TENANT_DEFAULT=tenant_demo, ENV=dev). Refuse to boot if JWT_SECRET empty and ENV!=dev.
4. backend/app/db.py: async engine + async_sessionmaker + get_db dependency;
   helper `tenant_scope(stmt, tenant_id)` documenting that every repository query
   must filter tenant_id.
5. backend/app/models/: SQLAlchemy 2.0 ORM classes 1:1 for ALL tables in
   docs/05 §3 (tenants, users, customers, accounts, transactions, employees,
   access_rights, employee_sessions, employee_actions, rules, alerts,
   alert_evidence, cases, case_alerts, case_notes, audit_log, ingest_failures).
   Use mapped_column, String for TEXT ids, Numeric(18,2), DateTime(timezone=True),
   JSONB, ARRAY(String) for entity_ids, CheckConstraints as in DDL.
6. backend/alembic/: init + env.py wired to the async engine and models metadata.
   Migrations 001_core … 005_ops reproducing the DDL from docs/05 §3 EXACTLY
   (same table/column/index/constraint names). alembic upgrade head must work on
   a clean database.
7. backend/app/auth/: jwt.py (create_access_token/create_refresh_token, decode),
   deps.py (get_current_user, require_role(*roles) FastAPI dependency reading
   role+tenant_id from JWT — claims EXACTLY docs/08 §3: sub, tenant_id, role,
   exp, iat, iss=sentinel; no PII in claims), passwords.py (bcrypt hash/verify,
   cost>=12, seeded passwords >=10 chars per docs/08 §3).
   Access token TTL = JWT_ACCESS_MIN; refresh 12h.
   Cross-tenant resource access returns 404 not 403 (ADR-011).
8. backend/app/api/auth.py: POST /v1/auth/login {email,password,tenant_id} ->
   {access_token, refresh_token, user}, POST /v1/auth/refresh, GET /v1/auth/me.
   Register router with prefix /v1.
9. backend/app/api/ops.py: GET /v1/ops/health -> {db: ok|fail, redis: ok|fail}
   (actual pings, not hardcoded).
10. backend/app/main.py: create_app(), CORS allow_origins [http://localhost:5173],
    include routers, lifespan that logs "ready". Runs via
    `uvicorn app.main:app --reload --port 8000` from backend/.
11. backend/app/seed/__init__.py + users.py: seed tenant_demo and 4 users
    (admin@demo.dev / manager@ / investigator@ / viewer@, password Demo!23456 (ADR-013),
    roles admin/manager/investigator/viewer per docs/09 §3). Idempotent.
    Demo creds approved by ADR-012 (dev/demo only — mark module docstring-free
    but note in .env.example that ENV=production must rotate them).
    Runnable as `python -m app.seed.users` from backend/.
12. backend/tests/unit/test_auth.py: T-AUTH-01..05 per docs/10 §4 (valid JWT,
    expired, tampered signature, viewer 403 on mutate, foreign-tenant 404).

Verification (run these, show real output):
- docker compose up -d && docker compose ps   (both healthy)
- cd backend && alembic upgrade head           (tables match DDL)
- python -m app.seed.users
- pytest tests/unit/test_auth.py -q            (T-AUTH-01..05 pass — paste names)
- uvicorn app.main:app --port 8000 & then:
  curl POST /v1/auth/login with investigator creds -> 200 + tokens
  curl GET /v1/auth/me with token -> role=investigator
  curl GET /v1/ops/health -> {"db":"ok","redis":"ok"}
  curl POST /v1/auth/login as viewer then GET a role-gated route -> 403
Report the actual JSON responses.
```

## Prompt P0-B: Frontend Shell

```
<SESSION PREAMBLE above>

PHASE: P0-B — Frontend Shell
Precondition: P0-A done (auth endpoints live at http://localhost:8000).
Docs to read: docs/03-UIUX-DESIGN.md (§1–3, §11–13), docs/04-APP-FLOW.md (§1, §7),
docs/06-IMPLEMENTATION-PLAN.md (§1), docs/09-DATA-DICTIONARY.md (§3 role enum —
Role type must match exactly), docs/08-SECURITY-AND-COMPLIANCE.md (§4 — UI may
hide mutations for viewer, but backend is authoritative)

Create exactly (frontend/):
1. Vite + React 18 + TypeScript project. Dependencies: react-router-dom,
   zustand, tailwindcss@3.4, recharts (install now, use later). NO ReactFlow yet (P2).
2. tailwind.config.ts with design tokens EXACTLY from docs/03 §2 (surface, ink,
   brand, risk low/medium/high/critical, evidence #A78BFA, radius.card, fonts
   Inter + JetBrains Mono). Global CSS: dark background #0B0F14, font-size 14px base.
3. src/api/client.ts: typed fetch wrapper. Reads access token from Zustand,
   attaches Authorization header, on 401 tries POST /v1/auth/refresh once then
   retries, otherwise redirects to /login. API base URL from
   VITE_API_URL (default http://localhost:8000).
4. src/api/types.ts: User {id,email,role,tenant_id,full_name}; LoginResponse;
   Role = 'admin'|'manager'|'investigator'|'viewer' (EXACT docs/09 §3).
5. src/store/auth.ts: Zustand store {user, accessToken, setAuth, clear, isLoggedIn};
   refresh token in a httpOnly-style variable is fine for demo — store both tokens
   in memory + localStorage for demo persistence (document this choice).
6. src/pages/Login.tsx: email/password/tenant_id form (default tenant_id
   tenant_demo), calls login, on success navigates to /.
7. src/App.tsx + router: routes EXACTLY as docs/04 §1 table
   (/login, /, /alerts, /alerts/:id, /cases, /cases/:id, /graph,
   /timeline/:type/:id, /admin/rules). Placeholder pages for all except Login
   (placeholders = centered "Phase Pn — coming" with page title; admin route guarded
   by role===admin; all non-login routes guarded by auth or redirect /login).
8. src/components/AppShell.tsx: layout per docs/03 §3 — left sidebar 160px with
   nav items (Dashboard, Alert Inbox, Case Manager, Graph Explorer, Timeline,
   Admin/Rules) using lucide-react icons (add dep), collapses to 64px icon rail
   below 1024px. Topbar: search input (⌘K listener, visual only for now), tenant
   badge, avatar with logout menu. Active route highlighted.
9. src/components/RiskBadge.tsx: props {band: 'low'|'medium'|'high'|'critical'};
   icon + text + color per docs/03 §2 risk colors (color never sole indicator).
10. src/components/Skeleton.tsx, EmptyState.tsx, ErrorRetry.tsx per docs/03 §11.
11. npm scripts: dev, build, typecheck (tsc --noEmit), lint (eslint + TS rules),
    test (vitest).

Verification (run these, show output):
- npm run typecheck  (clean)
- npm run lint       (clean)
- npm run build      (succeeds)
- Manual: docker compose up + backend running -> npm run dev -> login as
  investigator@demo.dev lands on Dashboard shell; sidebar nav renders; hitting
  /admin/rules as investigator redirects; logging out returns to /login.
Report actual command outputs.
```

**Exit Gate P0:** P0-A and P0-B verification outputs green; `alembic upgrade head` on clean DB creates all 17 tables.

---

# Phase 1 — Ingest + Domain + Activity Timeline

## Prompt P1-A: Backend Ingest + Timeline

```
<SESSION PREAMBLE above>

PHASE: P1-A — Ingest + Domain + Timeline API
Precondition: P0 complete and gates passed.
Docs to read: docs/05-BACKEND-SCHEMA.md (§2 domain tables, §6 Ingest + Timeline
contracts), docs/02-TRD.md (§3 pipeline step 1–2), docs/06-IMPLEMENTATION-PLAN.md,
docs/09-DATA-DICTIONARY.md (§2 tables/fields, §3 enums incl. action_type,
channel, timeline categories §7, id prefixes §2), docs/08-SECURITY-AND-COMPLIANCE.md
(§5 audit action list — implement audit() covering login + ingest.batch now;
§4 RBAC: ingest = admin|investigator), docs/10-TEST-STRATEGY.md (verification
must implement T-INT-01..04, T-INT-09, T-INT-10-timeline, T-FE-08/09 via P1-B)

Create exactly:
1. backend/app/schemas/ingest.py: Pydantic v2 models, extra="forbid", for the 4
   event kinds EXACTLY as docs/05 §6 examples:
   - TransactionEvent {kind, id, from_account_id?, to_account_id?, amount (str
     decimal >0, ≤2dp), currency=INR, direction debit|credit, channel?, reference_no?,
     status=completed, value_ts (aware datetime), raw?}
   - EmployeeActionEvent {kind, id, employee_id, session_id?, action_type,
     target_type customer|account|transaction|employee|system, target_id,
     before_state?, after_state?, ip_address?, event_ts, raw?}
   - AccessRightEvent {kind, id, employee_id, entitlement, scope?, granted_at,
     revoked_at?, granted_by?, source=iam}
   - SessionEvent {kind, id, employee_id, ip_address?, device?, started_at,
     ended_at?, outcome=success|fail|lockout}
   Batch envelope: IngestBatch {events: list[... discriminated union on kind],
     max_length=500}.
2. Domain helpers to upsert referenced parents when events arrive (customer/
   account/employee stub rows if FK missing — allow stub with external_ref=id,
   name='(unresolved)' so ingest never fails on order).
3. backend/app/api/ingest.py:
   - POST /v1/ingest/events -> validate batch, single DB transaction:
     * idempotency: skip event whose id exists in last 7 days in its table
     * insert rows into transactions / employee_actions / access_rights /
       employee_sessions accordingly; bump accounts.baseline stats NOT yet (P5)
     * on row error: rollback nothing — insert valid rows, append failures to
       ingest_failures with payload+error
     * AFTER commit: XADD to Redis stream "events" (best-effort; if redis down,
       log — ingest still 202)
     * respond 202 {accepted, skipped, failed, batch_id (uuid)}
   - POST /v1/ingest/access-rights -> single grant, 201 (admin|investigator role)
   Role: ingest requires admin or investigator.
4. backend/app/api/timeline.py: GET /v1/timeline/{entity_type}/{entity_id}
   with query from?, to?, categories? (csv of transaction|profile_change|
   access_login|approval), limit=100, cursor?
   Returns {items: [TimelineItem], next_cursor}.
   TimelineItem {ts, category, title, actor: {id,name}|null, value?, target?,
   event_kind, ref_id}.
   Merge SQL: transactions involving accounts of the customer (or the account
   itself) -> category transaction, actor null;
   employee_actions targeting the entity (resolve: for customer include actions
   on its accounts + direct customer targets) -> category derived from
   action_type (login/logout -> access_login; tx.approve -> approval;
   profile.*/beneficiary.*/limit.* -> profile_change), actor = employee
   {id,name}; employee_sessions for employee entity -> access_login.
   Single UNION query ordered by ts DESC with cursor = base64(ts|id).
5. backend/app/audit.py: log(actor_user, action, object_type, object_id, detail)
   inserting into audit_log; call from ingest (action=ingest.batch, actor_kind=
   system) and auth login (action=login) + login_failed. Full mandatory action
   list is docs/08 §5 — implement the audit helper generically now so later
   phases only add call sites.
6. backend/app/seed/legitimate.py: generator runnable
   `python -m app.seed.legitimate --customers 50 --employees 30 --days 90`:
   - 50 customers + 1–2 accounts each, 30 employees across roles
     (teller/manager/finance_ops/analyst/admin_it) + access_rights matching role
     defaults (role->entitlement map in module, e.g. finance_ops: tx.approve,
     profile.edit; analyst: read.only)
   - ~4000 benign transactions: salary credits, ATM withdrawals, slow P2P,
     amounts log-normal, NO 3-cycles within 72h, NO 3+ just-under-50k bursts
   - employee sessions daily 09–19 local + routine profile edits
   - idempotent wipe-and-reload under tenant_demo
   - prints counts summary
7. Wire routers in main.py. Update ops health if needed.

Verification (run, show output — cite docs/10 test IDs):
- pytest backend/tests/unit/test_ingest_contract.py (= T-INT-01..04 contract
  part: rejects extra fields, rejects amount<=0, accepts both JSON examples
  from docs/05 §6),
  backend/tests/integration/test_tenant_isolation.py (T-INT-10 timeline scope:
  seed tenant X row, login tenant Y, GET timeline of X's entity -> 404 per
  ADR-011), test_timeline_merge.py (= T-INT-09: 1 tx + 1 employee profile.edit
  on same customer -> merged DESC order, actor set).
- python -m app.seed.legitimate ... -> summary counts
- curl ingest batch (use the two JSON examples from docs/05 §6) -> 202 accepted
- curl GET /v1/timeline/customer/<id> with investigator JWT -> merged items,
  show one item with actor populated.
Report actual outputs with the T-* IDs you covered.
```

## Prompt P1-B: Timeline UI

```
<SESSION PREAMBLE above>

PHASE: P1-B — Activity Timeline UI
Precondition: P1-A done (timeline endpoint live).
Docs to read: docs/03-UIUX-DESIGN.md (§6, §13), docs/04-APP-FLOW.md (§3 step 1–3),
docs/01-PRD.md (Epic B stories B1/B2), docs/09-DATA-DICTIONARY.md (§7 timeline
category mapping — icons/labels must match the four categories),
docs/10-TEST-STRATEGY.md (frontend cases T-FE-08, T-FE-09)

Create exactly (frontend/src):
1. src/api/timeline.ts: fetchTimeline(type, id, params) typed from backend
   OpenAPI (read backend schemas; mirror types in types.ts).
2. src/components/EntityChip.tsx: pill with mono id + label; hover underline;
   onClick navigates per prop (to timeline/graph/alerts). Used everywhere later.
3. src/pages/Timeline.tsx (route /timeline/:type/:id):
   - Header: entity type badge, mono id, link "Open in graph" -> /graph?node=<id>
   - Category filter chips (multi): Transaction, Profile change, Access/login,
     Approval — client-side filter on fetched data + refetch with categories param
   - Density bar: Recharts BarChart events per hour from items; brush selection
     filters list by time range
   - Vertical timeline list per docs/03 §6: timestamp (mono, local tz), category
     icon (lucide: ArrowLeftRight / UserCog / LogIn / BadgeCheck), title,
     value (₹ mono) for transactions, **actor EntityChip when actor != null
     (navigate to /timeline/employee/<id>)** — this satisfies PRD B2 and must be
     visible on every profile_change/approval row
   - Row click -> expand: pretty-printed raw JSON of the source record (fetch by
     ref_id endpoint or embed in item — add GET /v1/timeline/raw/{kind}/{id} to
     backend if needed, investigator+ role)
   - Loading: 8 skeleton rows; Empty: "No activity in range"; Error: ErrorRetry
4. Wire Timeline placeholder page from P0 to this component.
5. Vitest tests (src/pages/__tests__/Timeline.test.tsx) — IDs from docs/10 §7:
   - T-FE-08: renders items in descending ts order
   - T-FE-09: shows actor chip when actor present (data-testid="timeline-actor")
   - category chip filters the list
   - empty + error states render

Verification (show output):
- npm run typecheck && npm run lint && npm run test  (all green)
- Manual: seed legitimate data, open
  http://localhost:5173/timeline/customer/<id> -> interleaved tx + employee
  edits, actor chip visible on edit rows, density bar filters list.
Report actual outputs.
```

**Exit Gate P1:** Timeline shows merged events with employee actor chips; T-INT-09/10 + T-FE-08/09 green (docs/10 §8); legitimate seed loads.

---

# Phase 2 — Graph Service + Graph Explorer

## Prompt P2-A: Graph Backend

```
<SESSION PREAMBLE above>

PHASE: P2-A — Graph Service + API
Precondition: P0 complete (P1 strongly recommended; needs transactions/accounts/
employees/access_rights/employee_actions data).
Docs to read: docs/02-TRD.md (§5), docs/05-BACKEND-SCHEMA.md (§4 graph model,
§6 graph endpoints), docs/01-PRD.md (Epic A), docs/09-DATA-DICTIONARY.md (§3 graph
node/edge type enums, §2 id prefixes for type detection), docs/13-ADR.md
(ADR-001 Postgres+NetworkX — rebuild is the repair path), docs/10-TEST-STRATEGY.md
(unit cases T-GRPH-01..06)

Create exactly:
1. backend/app/graph/service.py — class GraphService (singleton, created at
   startup):
   - Internal structure: networkx.MultiDiGraph per tenant in memory
     (dict tenant_id -> graph). Node attrs: type (customer|account|employee),
     label, risk (placeholder 'low' until P3), extra.
     Edge attrs per docs/05 §4: TRANSFER {amount(str), ts, tx_id, channel};
     ACCOUNT_HOLDER {since}; EMPLOYEE_ACCESS {entitlement, granted_at};
     PROFILE_CHANGE {action, event_ts, act_id}; EMPLOYEE_ACTION {action, event_ts, act_id}.
     Edge keys unique (use act_id/tx_id as key).
   - rebuild(tenant_id): batched reads (chunks of 5000) from transactions
     (status=completed, from/to account), accounts->ACCOUNT_HOLDER,
     access_rights active->EMPLOYEE_ACCESS (employee -> target resolved: scope
     '*' connects employee to all accounts is too heavy — instead connect
     employee to accounts they have acted on OR if scope='account' to that id;
     document resolution rule in docstring-free code by factoring
     _resolve_access_targets()), employee_actions:
       action_type in profile.edit|beneficiary.add|limit.change -> PROFILE_CHANGE
       edge employee -> target_id
       target_type=transaction -> EMPLOYEE_ACTION edge employee -> tx node
       (create tx as node type 'transaction' ONLY for this edge type; transfer
       edges remain account->account)
   - apply_event(tenant_id, kind, payload): incremental add/updates for each
     of the 4 kinds; must be idempotent (re-adding same tx id = no dup edges).
   - neighbors(tenant_id, node_id, depth 1|2, edge_types: set|None) ->
     (nodes, edges) in ReactFlow shape: nodes [{id,type,label,risk,degree}],
     edges [{id, source, target, type, props}]. Returns only reachable within
     depth, filtered by edge_types.
   - cycles(tenant_id, node_id, window_hours) -> list of ordered node id lists:
     take 1-hop neighborhood subgraph of TRANSFER edges only within window
     (filter edge ts), run networkx.simple_cycles limited to lengthen 3..6,
     return paths containing node_id.
   - subgraph(tenant_id, node_ids) for export/mini-snapshots later.
2. Startup: in main lifespan, rebuild all tenants (log node/edge counts + ms).
3. backend/app/api/graph.py (investigator+ for search/read):
   - GET /v1/graph/search?q&types?=customer,account,employee&limit=20
     -> substring match on id/label/name across the three tables + in-memory
     node labels; each hit {type,id,label,risk_band:'low'}.
   - GET /v1/graph/entity/{id} -> detect type by id prefix (cust_/acct_/emp_)
     or table lookup scoped to tenant; return summary {type,id,label,risk_band,
     stats: {degree, transfer_count_30d?, sum_amount_30d?}, links:
     {timeline: /timeline/...}}.
   - GET /v1/graph/neighbors?node_id&depth=1|2&edge_types?=csv -> ReactFlow JSON.
   - GET /v1/graph/cycles?node_id&window_hours=72 -> {cycles: [[ids...]]}.
   - 404 if node not in tenant.
4. Unit tests backend/tests/unit/test_graph.py — name/param per docs/10 §4:
   - T-GRPH-01: rebuild on fixture graph matches SQL counts (nodes, edges per type)
   - T-GRPH-02: planted 3-account cycle A->B->C->A found by cycles() including requested node
   - T-GRPH-03: depth=2 returns 2-hop only
   - T-GRPH-04: edge_types filter excludes TRANSFER when asked
   - T-GRPH-05: apply_event twice for same tx -> edge count unchanged
   - T-GRPH-06: cross-tenant: rebuild tenant A data not visible querying tenant B

Verification (show output):
- pytest backend/tests/unit/test_graph.py -q  (all pass)
- With seeded data: curl GET /v1/graph/search?q=<customer name> with JWT -> hit
  curl GET /v1/graph/neighbors?node_id=acct_X&depth=2 -> nodes+edges JSON
  curl GET /v1/graph/cycles?node_id=acct_A (on a planted cycle fixture) -> cycle path
- Startup log shows rebuild duration < 30000 ms.
Report actual outputs.
```

## Prompt P2-B: Graph Explorer UI

```
<SESSION PREAMBLE above>

PHASE: P2-B — Graph Explorer UI
Precondition: P2-A done (neighbors/cycles endpoints live).
Docs to read: docs/03-UIUX-DESIGN.md (§5), docs/01-PRD.md (Epic A A1–A3),
docs/04-APP-FLOW.md (§3 step 4–5), docs/09-DATA-DICTIONARY.md (§3 edge type
enums — labels in filters must match exactly), docs/10-TEST-STRATEGY.md (T-FE-10,
T-FE-11)

Create exactly (frontend/src):
1. Add deps: @xyflow/react@12.
2. src/api/graph.ts: searchEntities, getEntity, getNeighbors, getCycles — typed.
3. src/graph/nodes.tsx — custom ReactFlow node components:
   - customerNode: rounded rect, name + mono id
   - accountNode: hexagon (CSS clip-path), masked id
   - employeeNode: pill with avatar initials + name
   All show risk ring color (placeholder palette from tokens; risk comes on node).
   aria-label = `${type} ${label}`; Enter key triggers onNodeClick equivalent.
4. src/graph/edges.ts — edge styles EXACTLY docs/03 §5: TRANSFER solid arrow +
   tooltip (amount ₹ mono + timestamp), ACCOUNT_HOLDER dashed thin,
   EMPLOYEE_ACCESS dotted brand, PROFILE_CHANGE warning color thicker,
   EMPLOYEE_ACTION evidence color. Cycle edges: amber + "Cycle" badge label.
5. src/pages/GraphExplorer.tsx (route /graph):
   - Reads URL params ?node&depth (docs/03 §5 URL state); if no node: EmptyState
     "Search an entity to start" + global search box (calls /graph/search,
     results list, select -> sets ?node).
   - ReactFlow canvas; controls (zoom, fit) default; Background minimal dots.
   - Toolbar: depth toggle 1-hop|2-hop (radio), edge-type checkbox filters
     (5 types), layout toggle: preset vs simple force simulation (implement
     lightweight force with d3-force OR react-flow's built-in — if adding
     d3-force dep, allowed), **Highlight cycles toggle** -> GET cycles, merge
     amber styling + badges onto edges in state (A3).
   - Click node -> right side panel EntityCard: type, label, mono id, RiskBadge,
     stat rows, EntityChip links: "View timeline" -> /timeline/...,
     "Alerts" -> /alerts?entity=<id> (query used in P3).
   - Double-click node -> fetch neighbors depth+1 relative and merge into
     current nodes/edges state (incremental, no full re-render — use ReactFlow
     nodes/edges state arrays keyed by id).
   - Loading: spinner overlay; error: toast + retry.
6. Reuse from GraphExplorer: none of Timeline internals — only EntityChip.
7. Vitest — IDs from docs/10 §7: T-FE-10 (node aria-label `${type} ${label}`);
   edge style map returns TRANSFER class; URL param parse test;
   T-FE-11 (cycle toggle calls getCycles — mock fetch).

Verification (show output):
- npm run typecheck && npm run lint && npm run test (green)
- Manual: seed data, /graph search customer -> graph renders transfer+holder+
  access edges; expand double-click; cycle toggle highlights planted loop with
  badges; side panel timeline link works.
Report actual outputs.
```

**Exit Gate P2:** Planted cycle visible with badges; 2-hop expand works; T-GRPH-01..06 + T-FE-10/11 green (docs/10 §8).

---

# Phase 3 — Detection + Real-Time + Evidence Panel ★ Core

Run the 4 prompts in order. **Do not start P3-C before P3-A/B gates pass.**

## Prompt P3-A: Risk Model + All Detection Rules (pure backend)

```
<SESSION PREAMBLE above>

PHASE: P3-A — Risk/Explainability + Detection Rules (no pipeline yet)
Docs to read: docs/02-TRD.md (§4 entire — algorithms are normative),
docs/05-BACKEND-SCHEMA.md (§3 alerts tables, §7 validation invariants),
docs/01-PRD.md (C1–C5), docs/09-DATA-DICTIONARY.md (§4 rule codes — use
R-PROFILE_ROLE / R-PROFILE_FLOW per ADR-007; §5 factor catalog — factor names
frozen; §3 band enum), docs/13-ADR.md (ADR-002 rules-not-ML, ADR-003 band
edges 40/70/85, ADR-007 profile split), docs/10-TEST-STRATEGY.md (§3 cases
T-DET-01..20, T-RISK-01..05 — implement exactly these scenarios)

Create exactly:
1. backend/app/detection/base.py:
   - @dataclass Factor {name: str, raw_value: str, weight: float, contribution: float}
   - @dataclass Hit {pattern_code, title, entity_ids: list[str], factors: list[Factor],
     evidence_refs: list[tuple[type, id]]  # ('transaction', tx_id), ('employee_action', act_id),
     window_start: datetime, window_end: datetime, explanation: str}
   - Protocol Rule {code: str; def evaluate(self, ctx: RuleContext) -> list[Hit]}
   - RuleContext: tenant_id, config (tenant.config + rules table params),
     db session access via injected query functions (decouple: engine passes
     pre-fetched windows — see engine in P3-B; here provide helper dataclasses
     TransferWindow, ActionWindow that rules accept for unit-testability).
2. backend/app/risk/explain.py:
   - aggregate_factors(hits: list[Hit]) -> (score:int 0..100, band:str,
     factors: list[Factor])  # merge by factor name keeping MAX contribution;
     composite = sum(contributions)*100 clamped; band EXACTLY:
     <40 low, 40..69 medium, 70..84 high, >=85 critical (docs/02 §4).
   - compose_explanation(hits) -> joins hit explanations with ' | ' (primary first).
   - assert_explainability(score, factors): abs(sum(contributions) - score/100)
     <= 0.011 else raise ExplainabilityError. MUST be called before any alert persist.
3. backend/app/detection/r_circ.py — R-CIRC exactly docs/02 §4.1:
   evaluate on TransferWindow (list of {tx_id, from_acct, to_acct, amount, ts}):
   build DiGraph, simple_cycles len 3..6, trigger when
   time_span<=window_hours AND total>=min_cycle_amount (param default 500000).
   Factors with weights 0.25/0.35/0.25/0.15 as specified (linkage_depth,
   amount, temporal_proximity, account_velocity); raw_value strings human-readable
   ('3 hops', '4.2x p95', '94% of window', '5.1x baseline').
   amount factor: log-normalize total vs p95 of amounts in window (if no
   history, raw_value 'no baseline', contribution = weight*0.5).
   evidence_refs = all tx ids in cycle. explanation per template.
   entity_ids = accounts in cycle + their customers (caller may pass resolver;
   if customer unknown, accounts only).
4. backend/app/detection/r_struct.py — R-STRUCT exactly docs/02 §4.2:
   group by customer (and optionally beneficiary), 24h bucket; just-under band
   [0.8*T, T) with T = reporting_threshold param default 50000;
   trigger: >=3 in band AND total>=1.5*T AND (count>=3*baseline_count OR
   baseline_count==0). Factors sub_threshold_ratio/velocity_vs_baseline/
   total_amount/destination_spread weights 0.35/0.25/0.25/0.15.
   evidence_refs = those tx ids.
5. backend/app/detection/r_profile.py — R-PROFILE both sub-rules docs/02 §4.3:
   - evaluate_role_mismatch(action: ActionRecord, employee: {id,name,role},
     active_entitlements: set[str], allowed_roles: dict[action_type, list[role]]
     — default map: tx.approve=[teller,manager,finance_ops],
     profile.limit_change=[manager,finance_ops], beneficiary.add=[teller,manager,finance_ops],
     profile.edit=[manager,finance_ops,analyst]) -> Hit on mismatch of role
     OR missing entitlement (entitlement = action_type itself or
     'tx.approve' etc — use mapping action->entitlement same string).
   - evaluate_edit_then_flow(edit: ActionRecord, downstream_transfers:
     list[TransferRecord] within correlation_window_hours=48, any of which also
     trips R-CIRC/R-STRUCT or amount >= 0.8*T) -> Hit with factors
     access_anomaly/action_sensitivity/temporal_proximity/employee_off_hours
     weights 0.35/0.25/0.25/0.15; employee_off_hours uses tenant timezone
     09:00–19:00 (param) -> raw '03:12 outside 09:00-19:00'.
   evidence_refs = edit action id + triggering tx ids.
6. backend/app/detection/supporting.py — R-VELOCITY, R-OFFHOURS, R-DORMANT per
   docs/02 §4.4: produce Factors (attach mode) with contribution caps (0.40/0.25/0.45
   of score scale) and standalone Hit only when composite>=60 (checked by engine later).
7. backend/app/detection/engine.py — select_rules(entity_ids, events) returns
   candidate rules; run_rules(ctx, rules) -> hits; merge_hits_with_supporting(...)
   attaches supporting factors to primary hits on shared entities.
   Load params/weights from rules table if row exists (tenant, code, latest
   version) else defaults from docs/06 §4 — write load_rule_config helper.
8. Rule default row seeder: python -m app.seed.rules inserts docs defaults
   (R-CIRC window 72h min 500000; R-STRUCT T 50000 window 24h; R-PROFILE
   correlation 48h; weights JSON per above) version=1 idempotent.
9. Tests backend/tests/unit/ — each test tagged with docs/10 §3 IDs in the
   function name or docstring (e.g. test_t_det_01_planted_cycle):
   - T-DET-01..05 (r_circ): planted A->B->C->A (amounts 200k each, 4h) -> 1 Hit,
     band contribution math exact; negative: same 3 txs spread over 10 days -> no Hit;
     2-cycle A->B->A alone -> no Hit (len<3); total<min -> no Hit; 6-cycle Hit.
   - T-STRUCT-01..05 (r_struct): 6 txs of 49000 in 6h to same beneficiary,
     baseline 0 -> Hit; 2 txs -> no Hit; 3 txs totaling >=1.5T -> Hit (assert
     trigger math); 3 txs of 60000 above threshold -> no Hit; high-baseline no
     3x count -> no Hit.
   - T-PROF-01..06 (r_profile): analyst tx.approve -> Hit; finance_ops with
     entitlement -> no Hit; manager role-ok but revoked entitlement -> Hit;
     edit 03:15 then circular in 12h -> edit_then_flow Hit temporal>0;
     edit then 1k tx -> no Hit; edit then circular after 60h -> no Hit.
   - T-SUPP-01..03 (supporting): 10x velocity -> factor cap 0.40; off-hours
     02:00 -> cap 0.25; dormant 90d+90k -> cap 0.45.
   - T-RISK-01..05 (risk): band boundaries 39/40/69/70/84/85; aggregation
     max-merge; ExplainabilityError when sum mismatched; explanation contains
     amounts and ids; supporting factors raise composite/band.
   All tests offline (no redis/db) using constructed dataclasses.

Verification (show output):
- pytest backend/tests/unit -q  (list counts: X passed)
- python -m app.seed.rules
Report actual pytest output lines.
```

**Gate P3-A:** T-DET-01..20 + T-RISK-01..05 all green per docs/10 §3; band edges match ADR-003; explainability invariant enforced.

## Prompt P3-B: Pipeline Worker + WebSocket Hub + Alerts API

```
<SESSION PREAMBLE above>

PHASE: P3-B — Real-time pipeline, WS hub, Alerts API
Precondition: P2-A graph service exists, P3-A rules exist (imports will reference them).
Docs to read: docs/02-TRD.md (§3, §7), docs/05-BACKEND-SCHEMA.md (§3 alerts DDL,
§5 WS protocol, §6 Alerts endpoints, §7 invariants), docs/04-APP-FLOW.md (§5),
docs/09-DATA-DICTIONARY.md (§3 alert status/band enums, §6 transitions),
docs/08-SECURITY-AND-COMPLIANCE.md (§3 WS token rules, §4 alert route roles,
§5 audit actions alert.ack/alert.link), docs/13-ADR.md (ADR-004 evidence
copy-on-detect, ADR-005 Redis Streams bus), docs/10-TEST-STRATEGY.md (§5
T-INT-05..08, §8 latency budgets)

Create exactly:
1. backend/app/pipeline/worker.py:
   - Consumer loop: redis XREADGROUP group `pipeline` consumer `w1` stream `events`
     (block 2000ms, count 50). Handle first-run XGROUP CREATE mkstream.
   - Per event: decode -> GraphService.apply_event(tenant, kind, payload).
   - Build RuleContext: for affected entities (event mentions account/customer/
     employee) fetch sliding windows from PG:
       transfers: all txs touching those accounts within max(rule windows)=72h
       actions: employee_actions targeting entities within 48h
       employee+entitlements if employee involved
   - Run engine rules -> hits. If no hits: ACK message, done.
   - If hits: aggregate risk via explain.factor (call assert_explainability),
     build dedup_key = f"{primary_code}:{','.join(sorted(entity_ids))}:{floor_ts(window_end, hours=rule_window)}",
     UPSERT alerts on (tenant_id, dedup_key): if exists -> occurrence_count+1,
     window_end = max(old,new), risk re-aggregated keeping MAX score row values,
     append any new evidence_refs; else INSERT alert row with explanation,
     risk_score, risk_band, risk_factors JSONB, entity_ids, status open,
     detected_at=now.
      FOR EACH evidence_ref: snapshot source row JSON into alert_evidence
      (INSERT ... ON CONFLICT DO NOTHING) IN THE SAME TX as alert — this is
      ADR-004 copy-on-detect; snapshots (not live joins) back the EvidencePanel
      and exports. Evidence types: transaction|employee_action|access_right|session.
   - After commit: PUBLISH to redis channel f"alerts:{tenant}" payload:
     {type:'alert.created', data:{id, rule_code, title, risk_band, risk_score,
     entity_ids, detected_at, occurrence_count}}.
   - XACK. On exception: log, XCLAIM-less retry via pending — simple: log +
     write ingest_failures equivalent (pipeline_failures) + XACK to avoid poison
     loop (document in code via behavior: max 3 retries using delivery count).
   - Metrics counters (dict): processed, alerts_created, errors, last_lag_ms —
     exposed via ops endpoint.
2. backend/app/realtime/hub.py:
   - FastAPI websocket route /v1/ws?token= (also accept first message {op:'auth',token}).
     Verify JWT -> tenant_id+role; reject otherwise (close 4401).
   - Protocol EXACTLY docs/05 §5: client {op:subscribe|unsubscribe|ping} channels
     f"alerts:{tenant}", f"cases:{tenant}", f"dashboard:{tenant}" — channel must
     match user's tenant (else error message, ignore).
   - Background task per connection: pubsub subscribe to subscribed channels;
     forward messages as JSON. Handle ping->pong. 25s heartbeat ping.
   - On startup: spawn worker asyncio task running the pipeline loop (single
     consumer is fine for demo; PIPELINE_CONCURRENCY env reserved).
3. backend/app/api/alerts.py (roles: viewer read; investigator+ ack/link):
   - GET /v1/alerts?band=&rule=&status=&entity=&from=&to=&cursor=&limit=50
     -> {items:[{id, rule_code, title, risk_band, risk_score, status,
     entity_ids, primary_entity, amount_total?, detected_at, occurrence_count}],
     next_cursor}. primary_entity = first entity id. amount_total = sum of
     evidence transaction snapshots if present (compute via join, cached column
     not required).
   - GET /v1/alerts/{id} -> full per docs/05 §6: explanation, risk_factors,
     window_start/end, status, entity_ids, evidence: [{evidence_type, ref_id,
     snapshot, captured_at}], linked_case_id (from case_alerts), detected_at.
   - POST /v1/alerts/{id}/acknowledge -> status acknowledged (only from open);
     audit log; returns updated.
   - POST /v1/alerts/{id}/link-case {case_id} -> case may not exist yet (P4):
     return 404 case not found for now — implement fully in P4 (create route
     stub raising 501 with detail 'P4' ONLY if case tables unused yet — prefer
     implementing the real link since DDL exists: validate case, insert
     case_alerts, set alert status linked_to_case, audit).
   - GET /v1/alerts/{id}/graph -> GraphService.subgraph(alert.entity_ids +
     1-hop TRANSFER neighbors capped 50 nodes) ReactFlow JSON for mini snapshot.
4. Timing instrumentation: helper time.perf_counter spans logged as JSON line:
   ingest_persist_ms (in ingest route), detect_ms, alert_persist_ms, ws_publish_ms;
   also overall event_ts->ws latency if event includes ingest time — use
   ingested_at from row.
5. backend/app/api/ops.py extend: GET /v1/ops/health adds
   {pipeline: {processed, alerts_created, errors, stream_lag_ms}, ws_clients: n}
   (read worker metrics + hub registry count).
6. Tests — implement as docs/10 §5 IDs:
   - T-INT-05 (test_ingest_to_alert.py): live pg+redis (compose): seed minimal
     fixture with planted 3-cycle via 3 ingest txs -> poll GET /v1/alerts until
     R-CIRC alert appears (timeout 5s) -> assert risk_band in (high, critical),
     explanation contains 'loop', evidence has >=3 transaction snapshots,
     risk_factors sum invariant via recompute. Measure wall time < 5000ms and print.
   - T-INT-06/07 (test_ws.py): connect ws with JWT, subscribe alerts:{tenant},
     ingest planted structuring fixture, receive alert.created <5s;
     wrong-tenant channel subscribe rejected (docs/08 §2 T9); ping->pong.
   - T-INT-08 (test_dedup.py): ingest 4th overlapping tx extending window ->
     occurrence_count becomes 2 (same alert id), evidence grows, no second row.

Verification (show output):
- docker compose up -d; alembic upgrade head; seed rules; start uvicorn
- pytest backend/tests/integration -q  (print measured latency line)
- Manual curl: ingest docs examples + planted cycle batch -> GET /alerts shows
  R-CIRC with band; GET /alerts/{id} shows factors + evidence array non-empty.
Report actual outputs including the latency number.
```

**Gate P3-B:** T-INT-05..08 green (docs/10 §5): alert ≤5s with evidence snapshots; WS receives broadcast; dedup works; p95 ≤5000ms (docs/10 §8).

## Prompt P3-C: Alert Inbox + Mandatory Evidence Panel UI

```
<SESSION PREAMBLE above>

PHASE: P3-C — Alert Inbox + AlertDetail Evidence Panel (PRD C4/C5 — critical path)
Precondition: P3-B alerts endpoints + WS live.
Docs to read: docs/03-UIUX-DESIGN.md (§4, §7, §11, §13) — §7 is normative for
EvidencePanel; docs/01-PRD.md (C1–C5); docs/04-APP-FLOW.md (§2),
docs/09-DATA-DICTIONARY.md (§3 rule codes for filter select, §4 rule names,
§5 factor display — render name/raw_value/weight/contribution exactly),
docs/13-ADR.md (ADR-009 EvidencePanel has no dismiss API by construction),
docs/10-TEST-STRATEGY.md (§7 T-FE-01..07; §2 coverage gate names)

Create exactly (frontend/src):
1. src/ws/useSocket.ts: connect ws://VITE_WS_URL/v1/ws?token=; expose
   useChannel(channel, onMessage); auto-reconnect exponential backoff 1s->30s
   jitter; connection status store {state:'connected'|'reconnecting'|'down'};
   AppShell shows banner "Live updates paused — reconnecting…" when not
   connected (docs/04 §6). On reconnect: re-subscribe + dispatch
   'ws.resync' event so open views refetch.
2. src/store/alerts.ts: Zustand {items, cursor, filters, prependAlert,
   setFilters, markAcknowledged}; selectors for counts by band (dashboard later).
3. src/api/alerts.ts: listAlerts, getAlert, acknowledgeAlert, getAlertGraph.
4. src/pages/AlertInbox.tsx (routes /alerts and /alerts/:id):
   - Layout 40/60 split docs/03 §4: list left, detail right (on /alerts/:id
     detail occupies right; on narrow screens detail becomes full overlay).
    - Filters bar: band chips multi, rule select (EXACT codes docs/09 §4:
      R-CIRC, R-STRUCT, R-PROFILE_ROLE, R-PROFILE_FLOW, R-VELOCITY, R-OFFHOURS,
      R-DORMANT), status select (docs/09 §3 alert status enum), time range
      24h/7d/30d. Wire query params to API.
   - List row: RiskBadge, pattern name (title), primary entity EntityChip,
     ₹ amount (amount_total if present), time-ago, occurrence ×N when >1.
     data-testid="alert-row". New alert.created from useChannel prepends with
     brief highlight (animate-pulse once; respect prefers-reduced-motion).
   - Keyboard: A acknowledges selected, C opens create-case dialog (dialog can
     say "Case module — P4" but must render), ←/→ move selection; navigate
     /alerts/:id on Enter.
   - Empty/Error per docs/03 §13.
5. src/components/alert/AlertDetail.tsx — layout EXACTLY docs/03 §7:
   Header: RiskBadge + rule_code + title; entity chips; ₹ total; detected time
   ago; occurrence; buttons [Acknowledge] (optimistic), [→Case] (dialog stub to P4).
   EXPLANATION block: server explanation text (prose, readable).
   Two-column: left RISK FACTORS table — columns factor | raw_value | weight |
   contribution with horizontal bar (width = contribution*100%), then COMPOSITE
   row (score) and BAND row with RiskBadge. Footer note: contributions sum to score.
   right EVIDENCE panel (component below).
   Below: INLINE GRAPH SNAPSHOT — mini ReactFlow (read-only, height 280px)
   using GET /alerts/{id}/graph, same node/edge components as GraphExplorer
   (import them — if P2 components not importable yet, extract shared
   src/graph/* during this task). INLINE TIMELINE: top 10 evidence-linked
   events (reuse Timeline in compact mode or fetch /timeline for primary entity
   limited=10).
6. src/components/alert/EvidencePanel.tsx — MANDATORY contract (docs/03 §7 +
   ADR-009: no visibility prop may ever exist on this component):
   - ALWAYS mounted when AlertDetail renders. No prop can unmount it. No close
     button. No "score only" mode exists in the component API (do not implement one).
   - Header "Evidence (N)" with evidence icon color #A78BFA.
   - Loading: skeleton INSIDE the panel.
   - Loaded: list grouped by evidence_type: transactions (mono id, ts, ₹amount,
     counterparty), employee_actions (mono id, action_type, target), sessions,
     access_rights. Click -> right drawer with pretty JSON snapshot +
     "source table: <type>" footer.
   - error: renders INSIDE panel: "Evidence unavailable — data retention issue"
     (alert still shows explanation + factors — never a bare score).
   - evidence empty []: renders "No evidence records attached — investigate
     data feed" state INSIDE panel.
   - data-testid="evidence-panel" on root ALWAYS in all states.
7. Vitest tests src/components/alert/__tests__/EvidencePanel.test.tsx +
   AlertDetail — IDs from docs/10 §7:
   - T-FE-01..04: evidence-panel present in loading, loaded, error, empty states
   - T-FE-05: NO rendered element data-testid="dismiss-evidence" or
     "hide-evidence" (regression guard per ADR-009)
   - T-FE-06: factor table renders raw_value + contribution for each factor;
     composite equals sum (spot-check text)
   - explanation block non-empty when API returns it
   - T-FE-07: acknowledge click calls API (mock); alert.created prepends row
8. Wire routes from P0 placeholders. Add /alerts?entity= filter support
   (filters by entity id) for graph deep-link from P2.

Verification (show output):
- npm run typecheck && npm run lint && npm run test  (paste EvidencePanel test names)
- Manual E2E: start stack, ingest planted cycle batch (or seed), alert appears
  in inbox via WS within seconds WITHOUT refresh, open it: explanation visible,
  factors sum shown, evidence rows click open raw tx JSON, mini graph shows
  cycle, acknowledge updates badge.
Report actual outputs + paste the 4 evidence-panel test results.
```

**Gate P3 (overall):** S1-style planted cycle demos live (docs/12 §2–3 must be walkable); T-FE-01..07 green; p95 latency documented per docs/10 §8.

---

# Phase 4 — Case Management + Evidence Export + Dashboard

## Prompt P4-A: Cases + Export Backend

```
<SESSION PREAMBLE above>

PHASE: P4-A — Case management + evidence export + dashboard metrics
Precondition: P3 complete (alerts have evidence).
Docs to read: docs/05-BACKEND-SCHEMA.md (§3 cases DDL, §6 Cases + export bundle),
docs/04-APP-FLOW.md (§4, §6 state machines), docs/01-PRD.md (Epic D, E1–E2),
docs/09-DATA-DICTIONARY.md (§3 case status/priority enums, §6 transitions),
docs/08-SECURITY-AND-COMPLIANCE.md (§4 case/export role rows, §5 audit actions
case.create/assign/note/status/export, §6 export security),
docs/13-ADR.md (ADR-008 digest excludes generated_at; ADR-004 snapshots feed
the bundle), docs/10-TEST-STRATEGY.md (§5 T-INT-11..16, §8 export budget)

Create exactly:
1. backend/app/cases/service.py:
   - create_case(tenant, user, {title, priority?, description?, alert_ids?,
     group_by_entities?}): if group_by_entities and alert_ids given -> expand
     alert_ids to all open alerts sharing any entity_ids (cap 50, newest first).
     case_number = CASE-<year>-<4-digit sequence per tenant>. Assign alerts:
     insert case_alerts, set those alerts status=linked_to_case. audit.
   - list_cases(filters status?, assignee?, cursor): counts linked alerts.
   - get_case: case + linked alerts (summary rows) + notes + audit trail rows
     for this case id (audit_log object_id=case id or alert ids).
   - patch_case: allowed transitions ONLY per docs/04 §6 state machine:
     open->in_review|closed_*; in_review->escalated|closed_*;
     escalated->closed_*; closed terminal. status closed_* REQUIRES close_note
     length>=10 else 422 detail 'close_note required (>=10 chars)'.
     On close: set closed_at; propagate to linked alerts:
     closed_confirmed -> alerts.status=closed_confirmed;
     closed_false_positive -> alerts.status=closed_false_positive. audit
     from->to. No-op patches 400.
   - assign_case: assignee must be active user same tenant; role manager|admin
     OR self-assign for investigator (allow investigator self-assign). audit.
   - add_note: body non-empty <=5000 chars. audit.
2. backend/app/api/cases.py implementing the service (routes docs/05 §6 Cases):
   POST /v1/cases, GET /v1/cases, GET /v1/cases/{id}, PATCH /v1/cases/{id},
   POST /v1/cases/{id}/assign, POST /v1/cases/{id}/notes.
   POST /v1/alerts/{id}/link-case now validates + links (complete P3 stub if any).
   Roles: viewer read-only (mutations 403).
3. backend/app/export/service.py + api route:
   GET /v1/cases/{id}/export?format=json|html (investigator+):
   - Build bundle EXACTLY shape docs/05 §6: case, generated_at, generated_by,
     alerts[] each with full fields + risk_factors + evidence[{type,ref_id,snapshot}],
     graph_snapshot via GraphService.subgraph(all entity ids + 1-hop, cap 300 nodes),
     timeline: last 200 merged items across case entities (reuse timeline query
     builder), notes, audit[], digest_sha256.
    - digest: sha256 of canonical JSON (sort_keys,separators) -> update
      cases.export_digest; include digest in body (of the canonical part).
      EXCLUDE generated_at and the digest field from the hashed payload
      (ADR-008) — re-export of unchanged data must produce identical digest.
   - json: Content-Disposition attachment filename=sentinel-case-<case_number>.json
    - html: Jinja2 or string.Template printable page (light inline CSS,
      @media print, **autoescape ON** per docs/08 §2 T8) with same sections +
      factor tables; investigation-friendly; Content-Disposition attachment
      + X-Content-Type-Options: nosniff (docs/08 §6).
   - Perf: if evidence rows >500, still succeed but note truncation flag
     evidence_truncated=true (target <5s for 500).
4. Dashboard metrics: GET /v1/dashboard/metrics ->
   {open_cases, critical_24h, high_24h, alerts_24h, fp_rate_7d
    (closed_false_positive / closed_total in 7d, null if none),
    top_entities: [{entity_id, alert_count} top5 by alerts last 30d],
    ingest: {events_per_min, lag_ms} from pipeline metrics}.
   Publish f"dashboard:{tenant}" every 15s from a background task:
   {type:'metrics.update', data: same payload} (skip if no change).
5. WS: on case mutation publish f"cases:{tenant}" {type:'case.updated', data:{id,status,assignee_id,updated_at}}.
6. Tests backend/tests/integration/test_cases_api.py — IDs from docs/10 §5:
   - T-INT-11: create from 2 alerts (group_by_entities variant with shared entity fixture)
   - T-INT-12: assign: investigator 403 assigning to other; manager 200; viewer 403
     (per docs/08 §4 matrix)
   - T-INT-13: close without note 422; close with note 200 + linked alert status updates
   - T-INT-14: invalid transition open->escalated 400
   - T-INT-15: export json: 200, digest length 64, bundle.alerts[0].evidence
     non-empty, graph_snapshot.nodes non-empty; second export same digest
     (stable — ADR-008).
   - T-INT-16: export html: text/html, contains case_number.
   - T-INT-18: audit_log rows exist for create/assign/note/close (docs/08 §5).

Verification (show output):
- pytest backend/tests/integration/test_cases_api.py -q
- curl full journey: create case from alert id -> assign (manager JWT) ->
  note -> close 422 without note -> close 200 -> GET export?format=json -> show
  keys + digest; GET export?format=html returns '<html'.
Report actual outputs.
```

## Prompt P4-B: Cases + Dashboard UI

```
<SESSION PREAMBLE above>

PHASE: P4-B — Case Manager + Dashboard UI
Precondition: P4-A done.
Docs to read: docs/03-UIUX-DESIGN.md (§8, §9), docs/04-APP-FLOW.md (§2 step 9, §4),
docs/01-PRD.md (D1–D3, E1), docs/09-DATA-DICTIONARY.md (§3 case status/priority
enums — dropdown options exactly these), docs/08-SECURITY-AND-COMPLIANCE.md (§4 —
viewer sees disabled mutations), docs/10-TEST-STRATEGY.md (T-FE-12..15)

Create exactly (frontend/src):
1. src/api/cases.ts + src/api/dashboard.ts typed.
2. src/store/cases.ts + useChannel('cases:'+tenant) to live-update rows.
3. src/pages/CaseManager.tsx (/cases): view toggle List|Kanban
   (persist choice localStorage). Kanban columns Open, In Review, Escalated,
   Closed (closed_* folded). Card: case_number, title, PriorityBadge, assignee
   avatar initials, linked alert count, age (created_at time-ago), RiskBadge of
   worst linked alert. Click -> /cases/:id. Filters: status, assignee (user list
   from GET /v1/users? — if endpoint missing, derive assignees from case list;
   do NOT invent backend routes — prefer adding GET /v1/users admin-only in P4-A
   only if you also add it backend-side in this session's backend edits).
4. src/pages/CaseDetail.tsx (/cases/:id):
   - Header: case_number mono, title, status dropdown (only valid transitions
     enabled per docs/04 §6 — disabled options with title tooltip 'invalid
     transition'), priority select, assignee select (manager+ or self),
     Export JSON + Export HTML buttons (spinner, trigger download via blob).
   - Close dialog: when selecting closed_*: mandatory note textarea >=10 chars
     (client validation + surface server 422), radio Confirmed|False Positive
     maps to status.
   - Linked alerts list: compact rows (RiskBadge, title, entities) -> click
     opens AlertDetail in modal drawer (reuses P3-C AlertDetail incl. EvidencePanel).
   - Notes feed: author, ts, body; add-note form (Enter submits, button too).
   - Audit trail: vertical list action + actor + from->to + ts (from case detail
     API audit field).
5. Create-case from AlertDetail [→Case] (replace P3 stub): dialog with title
   prefilled from alert, priority default from band (critical/high -> high),
   checkbox "Group linked alerts by shared entities" -> calls API -> navigates
   to new case. If alert already linked -> show current case link instead.
6. src/pages/Dashboard.tsx (/): KPI cards (Open cases, Critical 24h, High 24h,
   FP rate 7d) with RiskBadge colors; charts Recharts: stacked area alerts by
   band over 7d (fetch from /v1/alerts?from= with client bucketing by day —
   no new backend required), top_entities horizontal BarChart, events/min line
   from metrics. Live badge: connected WS state + 'updated Xs ago'. Subscribes
   dashboard channel -> refetch on metrics.update. Empty/loading/error states.
7. Roles: viewer -> hide/disable mutation buttons (still server-enforced).
8. Vitest — IDs from docs/10 §7: T-FE-12 (status dropdown disables invalid
   transitions per docs/04 §6); T-FE-13 (close dialog requires >=10 chars,
   mock 422); export button calls download (mock blob); evidence panel still
   present when alert opened inside case drawer (T-FE-01 regression).
   T-FE-14 also covered here if not done in P0-B: viewer redirected from
   /admin/rules.

Verification (show output):
- npm run typecheck && npm run lint && npm run test
- Manual E2E (paste results): create alert via planted S2 structuring ->
  [→Case] group -> assign to investigator (second browser as that user sees
  card move live) -> note -> close FP with note -> export JSON download opens
  with evidence arrays -> Dashboard counts move when new alert arrives.
Report actual outputs.
```

**Exit Gate P4:** Journey A + C (docs/04 §2/§4) fully demoable; T-INT-11..16/18 green; export digest recorded (ADR-008); role matrix rows for cases pass (docs/08 §4).

---

# Phase 5 — Scenarios, Metrics, Hardening, Demo

## Prompt P5-A: Scenario Suite + Metrics + Security Hardening

```
<SESSION PREAMBLE above>

PHASE: P5-A — Suspicious/legitimate scenario tests, metrics harness, hardening
Precondition: P0–P4 complete and gates passed.
Docs to read: docs/06-IMPLEMENTATION-PLAN.md §7 (fixture table S1–S5, L1–L20),
docs/10-TEST-STRATEGY.md (§6 scenario catalog + EXACT metric definitions,
§2 coverage gates, §8 perf budgets — normative for this prompt),
docs/01-PRD.md §7 NFRs, docs/02-TRD.md §9, docs/05-BACKEND-SCHEMA.md §7,
docs/08-SECURITY-AND-COMPLIANCE.md (§2 threats T3/T4/T7, §4 full role matrix,
§5 audit list, §9 supply chain — security tests below map to §11),
docs/09-DATA-DICTIONARY.md (§4 expected rule codes per scenario),
docs/13-ADR.md (any test conflict → ADR wins)

Create exactly:
1. backend/app/seed/suspicious.py — plants S1–S5 EXACTLY docs/06 §7:
   S1 circular: 3 accounts 200k/200k/200k legs within 4h (total 600k>=500k).
   S2 structuring: 6 x 48000 UPI to same beneficiary within 6h, fresh customer.
   S3 role mismatch: employee role=analist (use 'analyst') with NO tx.approve
   entitlement performs tx.approve action on a 200000 tx (record as
   employee_action targeting that tx).
   S4 edit-then-flow: employee adds beneficiary/limit change at 03:15 on cust X
   then within 12h cust X enters circular flow (reuse S1 pattern on X's accounts).
   S5 off-hours+dormant: dormant account (no tx 90d — set last_activity_at)
   receives/sends 90000 at 02:00 local with employee off-hours login same window.
   Flags: --only S1,S3 etc. Each scenario prints entity ids + expected rule codes.
2. backend/tests/scenarios/test_suspicious.py — scenario IDs S1..S5 per
   docs/10 §6: for each enabled scenario:
   run seed -> run pipeline to completion (poll alerts max 10s) ->
   ASSERT expected rule fired for the scenario's entities (S4 allows
   {R-PROFILE_FLOW, R-CIRC} union; S5 allows {R-DORMANT, R-OFFHOURS} union with
   >=1 primary) AND risk_band in (medium, high, critical) for primary rules.
   Collect per-scenario pass/fail.
3. backend/tests/scenarios/test_legitimate.py — L1..L20 corpus per docs/10 §6:
   seed legitimate (P1) with --customers 200 --days 90; run full pipeline;
   count DISTINCT customers with any alert band>=medium; assert rate <= 0.10
   (NFR-06). Metric formula EXACTLY docs/10 §6 (do not invent a different FP
   denominator). If over: print top 5 offenders with rule+explanation to aid
   tuning (docs/10 §6 triage protocol); allow env LEGIT_TOLERANCE override.
4. backend/tests/scenarios/metrics_runner.py (also pytest -m metrics):
   metric DEFINITIONS must match docs/10 §6 verbatim (detection_rate,
   false_positive_rate, alert_latency from last-event ingested_at to
   first matching detected_at). PRINTS a report:
   ================= SENTINEL SCENARIO REPORT =================
   detection_rate: 5/5 (100%)   [target >=90%] PASS/FAIL
   false_positive_rate: 3.5%    [target <=10%] PASS/FAIL
   alert_latency_p50_ms / p95_ms [target p95<=5000] PASS/FAIL
   per-scenario table S1..S5 (rule hit, band, latency)
   ============================================================
   Exit code !=0 if any FAIL (CI-friendly).
5. Security hardening tests — map 1:1 docs/08 §11 (write them as named checks):
   - T-INT-10 full sweep: for each read endpoint (alerts, cases, graph
     entity/neighbors, timeline, rules) seed two tenants, assert cross read 404
     (ADR-011; covers threats docs/08 §2 T2/T9).
   - Role matrix test: parametrize EVERY row of docs/08 §4 (viewer 403 on all
     ❌ mutations; investigator self-assign only; manager assign ✅; admin rules
     ✅) — covers T7.
   - Audit completeness: after journey, assert docs/08 §5 mandatory actions all
     present (login, ingest.batch, alert.ack, case.create, case.assign,
     case.note, case.status, case.export) — NFR-07.
   - Ingest abuse: batch of 501 -> 422; extra field -> 422 (T-INT-03/04 +
     threat T4).
6. Dependency security: add .gitleaks.toml minimal (docs/08 §9: gitleaks +
   pip-audit + npm audit noted in CI); ensure .env in .gitignore; JWT_SECRET
   no hardcoded default when ENV=production (test config raises — docs/06 §4).
7. Rules admin endpoints final: GET /v1/rules (all roles read),
   PUT /v1/rules/{code} {params, weights, enabled} admin-only: validate
   weights sum to 1.0 ±0.001 else 422; insert version+1 row; audit;
   GraphService/detection config loader picks latest version (already
   load_rule_config — verify it queries latest by version).
8. Ops replay: POST /v1/ops/replay-batch {failure_id} admin: re-runs
   ingest_failures payload through ingest path, marks replayed_at.

Verification (show output):
- pytest backend/tests/scenarios -q --metrics   (PASTE the full report block;
  PASS requires detection_rate>=90%, FP<=10%, p95<=5000 per docs/10 §6/§8)
- pytest backend/tests/integration -q           (T-INT-01..20 all green)
- python -m app.seed.suspicious --only S1,S2,S3,S4,S5 then start stack,
  confirm 5/5 alerts live in UI (or via curl list) with bands as expected
  (also satisfies docs/12 §2 prerequisites).
- Test ID coverage checklist: print which docs/10 IDs are now implemented
  (any missing listed as explicit gaps).
Report the metrics report verbatim + coverage checklist.
```

## Prompt P5-B: Demo Runbook + Docs Reconciliation + Final QA

```
<SESSION PREAMBLE above>

PHASE: P5-B — Demo packaging + final QA
Precondition: P5-A metrics PASS.
Docs to read: ALL docs/01–13 (reconcile against implemented reality).
Use actively: docs/11-OPERATIONS-RUNBOOK.md (§1 env, §2 commands, §4 health,
§7 deploy, §10 demo checklist), docs/12-DEMO-SCRIPT.md (README demo section
must mirror its run-of-show; keep Q&A answers consistent), docs/13-ADR.md
(append ADR-013+ only if implementation forced a real decision change),
docs/10-TEST-STRATEGY.md (§10 exit mapping as final gate checklist),
docs/08-SECURITY-AND-COMPLIANCE.md (§7 prod checklist note, §9 CI gates),
docs/09-DATA-DICTIONARY.md (spot-check enums still match code).

Tasks:
1. Complete backend/.env.example with EVERY var from docs/06 §4 + VITE_API_URL,
   VITE_WS_URL in frontend/.env.example. No real secrets. Mark ADR-012 demo
   creds rotation warning for ENV=production (docs/08 §3).
2. docker-compose.yml final: add api service (build ./backend, uvicorn
   app.main:app --host 0.0.0.0 --port 8000, depends_on healthy pg/redis,
   env_file) and web service (build ./frontend — multi-stage node->nginx,
   nginx proxies /v1 and /v1/ws to api:8000 with Upgrade headers per
   docs/11 INC-4, SPA fallback). One-command demo: `docker compose up --build`
   (Runbook §2/§7 must work verbatim).
3. README.md rewrite (repo root): what Sentinel is (2 sentences), architecture
   ASCII (from TRD), quickstart (prereqs, compose up, seed commands, default
   logins table), 5-minute demo section = condensed docs/12 run-of-show mapped
   to hackathon expected outcomes, full docs index (01–13 with one-line
   purposes from README current table), test commands (docs/10 §1 suite
   commands), troubleshooting (point to docs/11 §5 INC-1..7 + reset volume).
4. Seed one-liners: make targets or npm scripts:
   make seed (or scripts/seed.ps1 + seed.sh): users+rules+legitimate+mixed;
   scripts/replay-suspicious.ps1|sh for S1–S5 (Runbook §2).
5. Docs reconciliation pass — update docs where implementation diverged
   (endpoint names, factor weights, band edges, screen titles, enums).
   Sweep ALL docs 01–13 for stale claims (e.g. test IDs that were renamed,
   endpoints that moved). Log every doc change in a table at the bottom of
   docs/07 under "Reconciliation Log". If an implementation choice contradicts
   an Accepted ADR: either revert code to ADR or write a superseding
   ADR-013+ in docs/13 — state which per item.
6. Ops polish: verify /v1/ops/health returns every signal docs/11 §4 lists;
   seed a deliberate ingest failure once and confirm INC-2 replay path
   (POST /v1/ops/replay-batch) works end-to-end.
7. Final QA checklist run (execute, paste results) — assemble from
   docs/10 §10 exit mapping + docs/11 §10 demo checklist:
   - docker compose down -v && docker compose up --build  (clean machine sim)
   - seed + suspicious replay -> 5/5 alerts
   - metrics report PASS (docs/10 §6 thresholds)
   - npm run typecheck && npm run lint && npm run test
   - pytest -q (whole suite — count vs docs/10 IDs)
   - gitleaks detect --source . (or trufflehog) no findings; pip-audit +
     npm audit --production clean or documented exceptions (docs/08 §9)
   - evidence panel tests T-FE-01..05 listed green
   - docs/11 §10 demo-day checklist all checked
   - docs/12 script walkthrough rehearsed once (time it ≤5:30 core)
8. Git: create branch release/v1.0-demo, commit all (group logical commits:
   docs, backend-p0..p5, frontend-p0..p5, infra), do NOT push unless asked.

Verification: paste outputs of step 7 checklist + Reconciliation Log table.
```

**Final Gate (Definition of Done):** **EO-1..EO-5 all proven per docs/01 PRD §1.4** (each row's tests green + demo step walkable per docs/12 checklist); docs/10 §10 exit mapping fully checked with evidence (command output) in this file's Reconciliation Log or PR description; docs/06 §9 DoD items all pass; docs/11 §10 demo checklist green; docs/13 Accepted ADRs still match implementation (or superseded with new ADR numbers).

---

## Repair Prompt Template

Use when an Exit Gate fails. Fill the placeholders:

```
<SESSION PREAMBLE above>

REPAIR TASK for phase <Pn> in this repo.
Expected behavior (from docs/<doc> §<section>): <exact expected>
Actual behavior: <paste exact command output / error / failing test name>
Covering test ID (if any): <e.g. T-INT-05 per docs/10 §5>
Relevant ADR (if any): <e.g. ADR-008 — if code violates an Accepted ADR,
fix the CODE, not the ADR, unless you are consciously superseding it>
Already implemented: <list files you know exist — let Claude rediscover via read>
Do NOT rewrite unrelated phases. Diagnose root cause first (read the failing
code + the normative doc section), then make the minimal fix, then re-run:
<verification commands>
Report: root cause, files changed, verification output, docs touched (if any).
```

---

## Parallelization (2–3 humans or parallel Claude sessions)

```
Day 1:  A: P0-A, P1-A          B: P0-B               (P2-A can start after P0-A)
Day 2:  A: P1-A finish          B: P0-B finish         C: P2-A
Day 3:  A: P1-B                 B: P2-A finish         C: P2-B
Day 4:  A: P3-A                 B: P3-B (after A gate) C: wait/P3-C prep reading
Day 5:  A: P3-B finish          B: P3-A fixes          C: P3-C
Day 6:  A: P4-A                 B: export/dashboard    C: P4-B
Day 7:  All: P5-A metrics tuning
Day 8:  All: P5-B demo package
```
Parallel rule: two sessions must not edit the same file simultaneously (merge conflicts); split by backend/frontend or by module (detection/ vs cases/).

---

## Change Control

Any change to **DDL, ingest contracts, risk factor names, band boundaries, enums (docs/09), or endpoint paths** after Phase 1 freeze requires: update relevant docs → migration → affected tests → re-run phase gate → note in Reconciliation Log. Factor names and EvidencePanel contract (always mounted, data-testid, no dismiss — ADR-009) are frozen API for the UI. Accepted ADRs (docs/13) may only change by writing a superseding ADR.

---

## Reconciliation Log

Append rows during P5-B (and any doc-touching repair). Columns: Date | Doc | Section | Change | Why (code-fixed vs doc-fixed vs ADR superseded).

| Date | Doc | Section | Change | Why |
|---|---|---|---|---|
| 2026-09-27 | 02-TRD | §2 stack | Auth libs → PyJWT + bcrypt≥5; Python tested on 3.13 | ADR-013 (library change) |
| 2026-09-27 | 13-ADR | ADR-012/013 | Demo password `Demo!2345` → `Demo!23456`; ADR-013 added | ADR superseded — 9-char password violated docs/08 §3 |
| 2026-09-27 | 07-PHASE | Preamble, P0-A | requirements list, demo password, library substitution rule | doc-fixed to match ADR-013 |
| 2026-09-27 | 11-RUNBOOK | §2 | New demo password; host-port override for Windows port clash | doc-fixed (compose ports now `${PG_HOST_PORT:-5432}` / `${REDIS_HOST_PORT:-6379}`) |
| 2026-09-27 | 14-ARCH | stack bullet | python-jose + passlib → PyJWT + bcrypt | doc-fixed to match ADR-013 |
| 2026-09-28 | 02-TRD | §4.1, §4.2, §4.5 | R-CIRC time-ordered legs; R-STRUCT sliding window + per-window baseline; overflow scaling | ADR-015 |
| 2026-09-28 | 10-TEST | §3 T-STRUCT-05 | Fixture 10/30d → 300/30d (10/day) | ADR-015 — old fixture contradicted the baseline rule |
| 2026-09-28 | 13-ADR | ADR-015 | Added: detection refinements | new decision during P3-A |
| 2026-09-28 | 02-TRD | §2 stack | Frontend rows → React 19, Vite 8, Tailwind 4, Zustand 5, Recharts 3, React Router 8; TS 6.0 | ADR-014 (library change) |
| 2026-09-28 | 03-UIUX | header, §1.5 | Tailwind 4; light + dark themes replace dark-mode-first | ADR-014 (user direction: "not only dark mode") |
| 2026-09-28 | 13-ADR | ADR-014 | Added: frontend stack, themes, live status strip | new decision during P0-B |
| 2026-09-27 | 08-SECURITY | §4 (impl note) | "user mgmt" admin-only routes realised as `GET/POST /v1/users`, `GET /v1/users/{id}` | code addition within the existing RBAC row |
| 2026-09-28 | 05-BACKEND | §6 Timeline | Response adds `entity` header summary and item `direction`; `event_kind` + `ref_id` documented in place of `raw_ref`; raw-record endpoint documented | code addition (additive fields for the P1-B inspector and lanes) |
| 2026-09-28 | 03-UIUX | §6 | Timeline realised as two lanes + inspector with 48h correlation highlight; density bar bins hourly ≤3 days, else daily | doc-fixed to the layout chosen in P1-B; hourly-only bars are unreadable over 90 days |
| 2026-09-28 | 05-BACKEND | §6 Graph | `legs`, `until`, `depth`, `truncated`, search `detail`, `POST /graph/rebuild` (admin); EMPLOYEE_ACCESS resolution rule stated | code addition in P2-A |
| 2026-09-28 | 07-PHASE | P2-A prompt | Graph reads open to all roles (prompt said investigator+) | docs/08 §4 RBAC matrix is normative (viewer reads graph) |
| 2026-09-28 | 02-TRD | §3 step 3a | Ingest applies accepted events to the graph right after commit; P3-B's worker re-applies idempotently | code addition — graph stays current without waiting for P3-B |
| 2026-09-28 | 08-SECURITY | §5 | Audit action `graph.rebuild` added | new admin repair route |
| 2026-09-28 | 07-PHASE | P1-A step (ingest stubs) | Ingest no longer creates "(unresolved)" customer/account/employee/session stubs; an unknown reference rejects that event with a readable reason; one-sided transfers cover other banks | user direction: all data must be real, nothing dummy |
| 2026-09-28 | 05-BACKEND | §6 Ingest, Entities, Timeline | `errors[]` + `skipped_ids` on ingest; `/entities/*` registration and lookup; `POST /timeline/preview` | code addition for the Add data screen |
| 2026-09-28 | 08-SECURITY | §5 | Audit action `entity.create` added | new registration routes |
| 2026-09-28 | 04-FRONTEND | §1 routes | `/add` (Add data, admin + investigator) added beside the Timeline | new screen for entering real records |
| 2026-09-28 | seed data | tenant_demo | Synthetic corpus removed (`python -m app.seed.reset_to_loop`); only the planted `tx_demo_loop_*` loop, its 3 accounts and 3 holders remain | user direction: keep the demo loop, everything else real |
| 2026-09-30 | 05-BACKEND | §6 Alerts | `entities: [{id,type,label}]` on alert rows and detail | code addition in P3-C: rows and chips name people and accounts |
| 2026-09-30 | 03-UIUX | §4 | "assignee" filter omitted from the Alert Inbox | alerts have no assignee (cases do, P4) |
| 2026-09-30 | 03-UIUX | §7 | Evidence panel rendered as a full-width ledger below the risk factors (still always mounted); a score-composition bar above the factor table; the inline timeline reads the primary entity's Timeline only and counts evidence found elsewhere | user-chosen layout (options round: "evidence ledger" + "composition bar"); mixed viewpoints showed the same transfer as + and − |
| 2026-09-30 | 09-DATA-DICT | §5 risk_factors | `imputed` flag on each factor; neutral defaults shown as such in the UI | finish review: 25 of 74 demo points were neutral defaults drawn like measured evidence |
| 2026-09-30 | 03-UIUX | §4, §7 | Keyboard cursor by id with ↑ ↓; no open-row stripe; stacked factors below 640px; graph snapshot draws only the alert's entities; single-lane inline timeline | finish review fixes |
| 2026-09-30 | 07-PHASE | P3-C step 1 | WS URL derives from VITE_API_URL (http→ws) unless VITE_WS_URL is set; live arrival toasts app-wide and never replaces the open alert | one config value; user choice "highlight + toast" |
| 2026-09-30 | 09-DATA-DICT | §3 WS types | Added `alert.updated`, `heartbeat`, `subscribed`, `unsubscribed`, `error` | code addition in P3-B: an extended alert must reach the UI; acks and errors make the protocol observable |
| 2026-09-30 | 05-BACKEND | §5, §6 Alerts, Ops | WS close code 4401 and acks; alert list/detail shapes, ack only from open (409), link-case rules; ops health `pipeline` block | code addition in P3-B |
| 2026-09-30 | 02-TRD | §3 | Dedup counts only new evidence; window-boundary fallback; live baselines; delivery/retry rules | P3-B prompt counted every re-detection as an occurrence, which inflates counts on every nearby event |
| 2026-09-30 | 07-PHASE | P3-B step 1 | Pipeline failures reuse `ingest_failures` (`payload.stage="pipeline"`) instead of a new `pipeline_failures` table | one re-drive path for P5 ops.replay; no DDL change |
| 2026-09-28 | 03-UIUX | §5 | Graph Explorer realised as canvas + Entity / Who touched what tabs; parallel edges bundled with ×N; risk rings only medium+; cycle highlight dims the rest; tokens `--change`, `--cycle` | doc-fixed to the layout chosen in P2-B; 220 unbundled lines per 2-hop view were unreadable |
