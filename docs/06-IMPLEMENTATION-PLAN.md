# 06 — Implementation Plan

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Timeline:** 6 phases, ~15–18 focused engineering days (hackathon-adaptable to 48h by cutting scope per §8)

---

## 1. Repository Structure

```
sentinel/
├── docker-compose.yml            # pg15, redis7, api, web
├── README.md
├── docs/
│   ├── 01-PRD.md … 06-IMPLEMENTATION-PLAN.md
├── backend/
│   ├── requirements.txt
│   ├── alembic/                  # migrations (001_core … 005_ops)
│   ├── app/
│   │   ├── main.py               # FastAPI app, router registration, CORS, startup
│   │   ├── config.py             # pydantic-settings (env)
│   │   ├── db.py                 # async engine/session, tenant-scoped repo helpers
│   │   ├── redis_client.py
│   │   ├── auth/                 # jwt, deps (require_role), password
│   │   ├── models/               # SQLAlchemy 2.0 ORM (1:1 with DDL)
│   │   ├── schemas/              # Pydantic v2 (API + ingest contracts)
│   │   ├── api/                  # routers: auth, ingest, graph, timeline, alerts, cases, rules, ops
│   │   ├── graph/service.py      # adjacency rebuild/update/neighbors/cycles (networkx)
│   │   ├── detection/
│   │   │   ├── base.py           # Rule protocol, RuleContext, Hit, Factor
│   │   │   ├── r_circ.py         # circular transfer
│   │   │   ├── r_struct.py       # structuring
│   │   │   ├── r_profile.py      # role-action + edit-then-flow
│   │   │   ├── supporting.py     # velocity, off-hours, dormant
│   │   │   └── engine.py         # select rules, run scoped windows, dedup
│   │   ├── risk/explain.py       # factor aggregation, banding, invariant check
│   │   ├── pipeline/worker.py    # stream consumer: graph update → detect → alert → publish
│   │   ├── realtime/hub.py       # WS hub, redis pub/sub fan-out, auth
│   │   ├── cases/service.py      # assignment, status machine, notes, audit
│   │   ├── export/service.py     # JSON bundle + HTML render + sha256
│   │   ├── audit.py
│   │   └── seed/                 # scenario generators (suspicious/legit/mixed)
│   └── tests/
│       ├── unit/test_r_circ.py, test_r_struct.py, test_r_profile.py, test_risk.py
│       ├── unit/test_graph.py
│       ├── integration/test_ingest_to_alert.py, test_tenant_isolation.py, test_cases_api.py
│       └── scenarios/test_suspicious.py, test_legitimate.py
└── frontend/
    ├── package.json, vite.config.ts, tailwind.config.ts, tsconfig.json
    └── src/
        ├── main.tsx, App.tsx (router + guards)
        ├── api/client.ts         # fetch wrapper, JWT refresh
        ├── api/types.ts          # generated/mirrored from OpenAPI
        ├── store/                # zustand: auth, alerts, cases, ws
        ├── ws/useSocket.ts       # connect/subscribe/reconnect (App Flow §6)
        ├── components/           # RiskBadge, EntityChip, EvidencePanel, Skeletons…
        ├── pages/                # Login, Dashboard, AlertInbox, AlertDetail,
        │                         # CaseManager, CaseDetail, GraphExplorer, Timeline, RulesAdmin
        └── graph/                # ReactFlow node/edge components, layout (d3-force / elk)
```

## 2. Phase Plan

### Phase 0 — Foundation (Day 1, ~0.5 day)
- [ ] docker-compose: postgres:15, redis:7 (+ healthchecks)
- [ ] FastAPI skeleton, config, CORS, `/docs`, health endpoint
- [ ] Alembic wired; migration `001_core` → `005_ops` from docs/05 §3 (exact DDL)
- [ ] JWT auth + `require_role` dependency; seed admin/investigator users
- [ ] Vite + React + Tailwind shell: router, guards, sidebar, login
- **Exit:** `docker compose up` → login works, tables exist, OpenAPI visible.

### Phase 1 — Ingest + Domain (Day 1–2)
- [ ] Pydantic ingest contracts + `POST /v1/ingest/events` (batch, idempotent, 202)
- [ ] Access-rights + session + employee_action endpoints
- [ ] Seed generators: customers, accounts, employees, access rights
- [ ] Timeline API (merged query, cursor pagination)
- [ ] Frontend: Timeline page with category filters + expandable rows
- **Exit:** seed script loads data; timeline renders employee action on customer with actor chip (PRD B1/B2).

### Phase 2 — Graph Service (Day 2–3)
- [ ] NetworkX service: rebuild from PG, incremental update, `neighbors(depth)`, edge filters
- [ ] Graph REST endpoints (ReactFlow shape) + entity search + entity summary
- [ ] Frontend: ReactFlow canvas, node types, side panel, expand, URL state, edge tooltips
- [ ] Unit tests: rebuild correctness, 2-hop query, cycle extraction on synthetic graphs
- **Exit:** search customer → graph shows transfers + holder + employee-access edges; expand works.

### Phase 3 — Detection + Real-Time (Day 3–5) ★ core
- [ ] Rule protocol + risk/explain module (factor aggregation, banding, **sum invariant**)
- [ ] Implement R-CIRC, R-STRUCT, R-PROFILE (both sub-rules), supporting rules — per docs/02 §4
- [ ] Alerts persistence: dedup_key upsert, evidence snapshot capture (alert_evidence)
- [ ] Redis Stream consumer worker + WS hub + channels (docs/05 §5)
- [ ] Alert list/detail APIs; evidence retrieval with snapshots
- [ ] Frontend: Alert Inbox (filters, live prepend), **AlertDetail with mandatory EvidencePanel + factor table** (docs/03 §7) + Vitest test asserting panel present in all states
- [ ] Unit tests per rule (positive/negative controls); integration test ingest→alert≤5s
- **Exit:** planted cycle fires alert ≤5 s with correct factors; evidence panel test green; score invariant enforced.

### Phase 4 — Cases + Export (Day 5–6)
- [ ] Case API: create (alert_ids + group_by_entities), status machine + closure note validation, assign, notes, audit
- [ ] Export service: JSON bundle + sha256 digest recorded; HTML printable template
- [ ] Frontend: Case Manager (list/kanban), Case detail (assign, notes, status, export buttons)
- [ ] Dashboard page with WS-driven metrics
- [ ] Integration tests: assignment broadcast, closure validation, export digest stable
- **Exit:** end-to-end journey A + C demoable (docs/04 §2, §4).

### Phase 5 — Scenarios, Hardening, Demo (Day 6–8)
- [x] Scenario suites: 5 suspicious + legitimate 200-customer dataset (docs/06 §7) — in throwaway tenants (ADR-016)
- [x] Metrics runner: detection rate, false-positive rate → printed report (`tests/scenarios/metrics_runner.py`)
- [x] Tenant isolation test, role enforcement tests, audit completeness
- [~] Rules admin: `GET/PUT /v1/rules` versioning done; the `/admin/rules` page is a placeholder (PRD F-13, Should)
- [x] Ops health (events/min, backlog, lag, open failures, latency p95) in `GET /v1/ops/health`; failed batch replay `POST /v1/ops/replay-batch`
- [x] Perf pass: 2-hop p95, alert latency p95 measured and logged (docs/10 §8)
- [x] Demo script + one-liners: `docker compose up --build`, `scripts/seed.sh`, `scripts/replay-suspicious.sh`
- **Exit:** all NFR-05/06 targets met; demo runbook works on clean machine.

## 3. Milestone Acceptance Criteria

| Milestone | Criteria |
|---|---|
| M0 Foundation | compose up, login, migrations, OpenAPI |
| M1 Data | ingest 4 kinds; timeline shows actor on target changes |
| M2 Graph | interactive graph w/ risk rings; cycle highlight toggle |
| M3 Detection | 3 primary rules live; evidence panel mandatory test; ≤5 s alert |
| M4 Cases | assign/notes/close+note validation; export JSON+HTML w/ digest |
| M5 Quality | scenario report ≥90% detection, ≤10% FP; isolation tests pass |

## 4. Environment & Config (no assumptions left)

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://sentinel:sentinel@localhost:5432/sentinel` | compose sets same |
| `REDIS_URL` | `redis://localhost:6379/0` | |
| `JWT_SECRET` | *required, no default in prod* | dev fallback only when `ENV=dev` |
| `JWT_ACCESS_MIN` | `30` | |
| `TENANT_DEFAULT` | `tenant_demo` | seeded |
| `REPORTING_THRESHOLD` | `50000` | per-tenant override in `tenants.config` |
| `CYCLE_MIN_AMOUNT` | `500000` | R-CIRC param (rules table overrides) |
| `ENV` | `dev` | `dev` \| `demo` \| `staging` \| `production`; anything but `dev` requires `JWT_SECRET` |
| `JWT_REFRESH_HOURS` | `12` | refresh token lifetime |
| `VITE_API_URL` (frontend, build time) | `http://localhost:8000` | `""` = same-origin (the docker web image, behind nginx) |
| `VITE_WS_URL` (frontend, build time) | derived | unset/empty: from `VITE_API_URL` (http→ws), or from the page when same-origin |
| `PG_HOST_PORT` / `REDIS_HOST_PORT` / `API_HOST_PORT` / `WEB_HOST_PORT` (root `.env`, compose) | `5432` / `6379` / `8000` / `80` | host ports only; containers talk on the compose network |
| `SEED_API_URL` (seed) | `http://127.0.0.1:8000` | the API `app.seed.demo_loop` asks to rebuild its graph |
| `SCENARIO_API`, `LEGIT_CUSTOMERS`, `LEGIT_DAYS`, `LEGIT_TOLERANCE` (tests) | unset / `200` / `90` / `0.10` | scenario harness: run through a live API; corpus size; FP limit |

*As built (P5-B):* `REPORTING_THRESHOLD` and `CYCLE_MIN_AMOUNT` are written into a tenant's `config` when the seed first creates it; rule versions in the `rules` table override them afterwards. `PIPELINE_CONCURRENCY` was removed: the worker is one ordered consumer per API process (ADR-006), since concurrent detection on one tenant could race the cross-event dedup (ADR-017).

## 5. Team Role Split (4-person team)

| Role | Owns |
|---|---|
| Backend-A | Ingest, domain APIs, timeline, seed |
| Backend-B | Graph service, detection engine, risk/explain, pipeline worker |
| Frontend | Shell, graph explorer, alert inbox/detail, cases, dashboard |
| QA/Ops | Docker, migrations, scenario suites, metrics, demo runbook, docs |

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Detection false positives hurt demo | Legitimate scenario suite run daily; tune thresholds before demo; document FP rationale |
| Graph rebuild slow on large seed | Chunked reads; only rebuild on cold start; incremental path covered by tests |
| WS flakiness on venue wifi | Reconnect/backoff + visible banner; REST refetch on resubscribe |
| Evidence missing (snapshot skipped) | Snapshot at alert creation from source rows in same tx; error state in panel |
| Scope creep (ML, auto-block) | Explicit non-goals (PRD §2); rule-based only in v1 |

## 7. Test Matrix & Metrics Harness

```bash
# backend
pytest tests/unit -q                 # rules, risk, graph
pytest tests/integration -q          # ingest→alert, tenant isolation, cases, export
pytest tests/scenarios -q --metrics  # prints: detection_rate, false_positive_rate
# frontend
npm run test                          # Vitest incl. evidence-panel-mandatory test
npm run typecheck && npm run lint
```

**Scenario fixtures (planted):**
| # | Scenario | Expected rule | Expected band |
|---|---|---|---|
| S1 | 3-account circular flow ₹6L in 4h | R-CIRC | high/critical |
| S2 | 6× transfers ₹48k to same beneficiary in 6h (threshold ₹50k) | R-STRUCT | high |
| S3 | Employee `analyst` approves ₹2L tx (entitlement missing) | R-PROFILE_ROLE | high |
| S4 | Employee adds beneficiary 03:15 → customer circular flow next 12h | R-PROFILE_FLOW (+R-CIRC) | critical |
| S5 | Off-hours login + dormant account ₹90k transfer | R-OFFHOURS + R-DORMANT | medium+ |
| L1–L20 | Normal payroll, ATM, slow savings flows | none expected | — |

**Targets:** detection ≥ 90% (NFR-05); legitimate FP ≤ 10% (NFR-06); ingest→broadcast ≤5 s p95 (NFR-01).

## 8. 48-Hour Hackathon Cut (if time-boxed)

Keep: M0, M1 (timeline), M2 (graph), M3 (R-CIRC + R-STRUCT + R-PROFILE + evidence panel), M4 (basic case + JSON export), S1–S4 fixtures.
Cut: rules admin UI, HTML export (keep JSON), replay-batch, dashboard charts (static counts), multi-tenant beyond seeded tenant, supporting rules (attach later).
**Never cut:** evidence panel, factor breakdown, explainability invariant, scenario metrics.

## 9. Definition of Done (global)

- **All five expected outcomes (EO-1…EO-5, PRD §1.2) demoable end-to-end** with their PRD §1.4 "Proven by" evidence green:
  - [ ] EO-1 graph + timeline linking employee actions to account/transaction changes
  - [ ] EO-2 explainable risk bands for connected anomalies (factor breakdown, no opaque score)
  - [ ] EO-3 case assignment + evidence export for reviewers
  - [ ] EO-4 suspicious + legitimate scenario metrics (detection ≥90%, FP ≤10%)
  - [ ] EO-5 mandatory evidence/explanation panel on every alert (not just a score)
- All PRD "Must" requirements demoable end-to-end.
- `pytest` + `npm run test` + typecheck/lint green in CI (GitHub Actions).
- Scenario report shows NFR-05/06 met.
- No secrets committed; `.env.example` provided; `docker compose up` from clean clone works.
- Docs 01–06 consistent with implemented behavior (updated if implementation diverged).
