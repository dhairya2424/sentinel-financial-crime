# Sentinel — Financial Crime & Insider Risk Intelligence Platform

Sentinel links **employees, access rights, customers and transactions** into one money-flow graph and activity timeline. It raises **explainable, evidence-backed alerts** for circular transfers, structuring and profile mismatches: every alert carries weighted risk factors and a mandatory evidence panel, never an opaque single score.

> **Problem statement (verbatim).** Suspicious money transfers and unusual employee activity are often reviewed by separate teams, which can hide connections between insider privilege misuse and financial crime. Build an investigation platform linking **employees, access rights, customers, and transactions** to surface unusual patterns such as **circular transfers, transaction splitting to avoid attention, or profile mismatches** with **explainable, evidence-backed alerts**.

## Architecture

```
 Browser ── http://localhost ──►  web  (nginx: built React SPA; proxies /v1 and the /v1/ws upgrade)
                                   │
                                   ▼
                                  api  (FastAPI :8000, one process — ADR-006)
                                   ├─ REST: ingest, entities, timeline, graph, alerts, cases, export, rules, ops
                                   ├─ WS hub: alerts:{tenant} · cases:{tenant} · dashboard:{tenant}
                                   ├─ Graph service: in-memory NetworkX, rebuilt from PostgreSQL at start (ADR-001)
                                   └─ Pipeline worker: Redis Stream "events" → scoped-window rules → risk factors
                                        → alert + frozen evidence → pub/sub → WS   (p95 ≤ 5 s budget, 210 ms measured)
                          ┌────────┴─────────┐
                          ▼                  ▼
                   PostgreSQL 15        Redis 7
                   source of truth      Stream (at-least-once, dedup-safe) + pub/sub
```

Ingest commits to PostgreSQL, then publishes each event to the stream. The worker builds the affected entities' ±72 h window, runs the seven rules (R-CIRC, R-STRUCT, R-PROFILE_ROLE, R-PROFILE_FLOW + supporting R-VELOCITY, R-OFFHOURS, R-DORMANT) and persists an alert whose factor contributions sum to its score (docs/02 §3–§6).

## Quick start (one command)

**Prerequisites:** Docker Desktop (or Engine + compose plugin). For local development without Docker: Python 3.11+ (tested on 3.13) and Node 24.

```bash
cp backend/.env.example backend/.env      # optional for dev; set JWT_SECRET for anything shared
docker compose up --build -d              # postgres, redis, api (runs migrations), web
scripts/seed.sh                           # Windows: scripts\seed.ps1  — logins, rule defaults, the demo loop
```

Open **http://localhost** (the web port is `WEB_HOST_PORT`, default 80) and sign in. If 5432/6379/8000/80 are taken on your machine, set `PG_HOST_PORT`, `REDIS_HOST_PORT`, `API_HOST_PORT` or `WEB_HOST_PORT` in a root `.env` (docs/11 §2).

| Role | Email | Password | Tenant | Can |
|---|---|---|---|---|
| Investigator | `investigator@demo.dev` | `Demo!23456` | `tenant_demo` | work alerts and cases, add data |
| Manager | `manager@demo.dev` | `Demo!23456` | `tenant_demo` | assign cases to anyone |
| Admin | `admin@demo.dev` | `Demo!23456` | `tenant_demo` | rules, replay, users, graph rebuild |
| Viewer | `viewer@demo.dev` | `Demo!23456` | `tenant_demo` | read only |

The logins are for dev and demo only (ADR-013). The seeds refuse `ENV=production`.

**Data policy.** `tenant_demo` holds only data people entered (the **Add data** screen or `POST /v1/ingest/events`) plus one planted fixture: the demo loop, ₹2,40,000 × 3 legs round Karan Apte → Priya Khan → Nikhil Gokhale. Every synthetic scenario runs in throwaway tenants that are deleted afterwards (ADR-016).

**Without Docker:** `docker compose up -d postgres redis`, then run `cd backend && python -m venv .venv`, activate it, `pip install -r requirements.txt`, `alembic upgrade head`, `uvicorn app.main:app --reload --port 8000`. In `frontend`: `npm install && npm run dev` (http://localhost:5173). Seed with `scripts/seed.sh --local`.

## 5-minute demo (condensed from [docs/12](docs/12-DEMO-SCRIPT.md))

Before judges arrive, complete the [docs/11 §10 checklist](docs/11-OPERATIONS-RUNBOOK.md#10-demo-day-checklist-t-30-min). It includes recording the insider beat through **Add data**.

| T+ | Screen | Action | Proves |
|---|---|---|---|
| 0:00 | Login → Dashboard | sign in as investigator; KPI cards, green "Live" badge | — |
| 0:50 | Terminal + Alert Inbox | `docker compose exec api python -m app.seed.suspicious --only S1` — the R-CIRC row arrives with a toast, no reload (~0.1 s) | real-time detection |
| 1:50 | Alert detail | explanation → factor bar (25 + 23.6 + neutral defaults = 74, High) → evidence panel (cannot be dismissed) → mini-graph → Acknowledge | **EO-2**, **EO-5** |
| 3:05 | Timeline → Graph Explorer | the employee's actor chip → the customer they edited → *Highlight cycles* shows the loop | **EO-1** |
| 3:45 | Case → Export | create a case from the alert, a manager assigns it (the card moves live in the other window), Export JSON with `digest_sha256` | **EO-3** |
| 4:45 | Terminal | `scripts/replay-suspicious.sh` or the report below | **EO-4** |
| 5:30 | — | closing line | — |

## Accuracy (EO-4), measured

`pytest tests/scenarios -q --metrics` (in `backend/`) plants S1–S5 through the public API into throwaway tenants and runs the 200-customer, 90-day legitimate corpus through the pipeline:

```
detection_rate: 5/5 (100%)   [target >=90%] PASS
false_positive_rate: 0.0% (0/200 customers)   [target <=10%] PASS
alert_latency_p50_ms: 136 / p95_ms: 210   [target p95<=5000] PASS
```

The corpus takes about 20 minutes. `scripts/replay-suspicious.sh` runs S1–S5 alone against the running stack in seconds.

## Tests and quality gates ([docs/10](docs/10-TEST-STRATEGY.md) §2)

```bash
cd backend
pytest tests/unit -q                                          # rules, risk, graph, auth, config
pytest tests/integration -q                                   # T-INT-01..20, role matrix, tenant sweep, audit (Redis + PostgreSQL up)
pytest tests/scenarios -q --metrics                           # S1–S5 + L1–L20 report
coverage run --source=app/detection,app/risk -m pytest tests/unit -q && coverage report --fail-under=80
cd ../frontend
npm run typecheck && npm run lint && npm run test             # T-FE-01..15 incl. the evidence-panel guard
```

CI (`.github/workflows/ci.yml`) runs all of these, plus gitleaks, pip-audit and `npm audit --omit=dev`.

## Troubleshooting

| Symptom | Go to |
|---|---|
| API down, login fails | docs/11 **INC-1** — `docker compose logs api`, `docker compose restart api` |
| Alerts not appearing | **INC-2** — `GET /v1/ops/health`: `pipeline.processed`, `ingest.failures_open`; replay with `POST /v1/ops/replay-batch` |
| Graph empty or missing a new holder | **INC-3** — admin `POST /v1/graph/rebuild` (the seed does this) or restart api |
| "Reconnecting" banner | **INC-4** — nginx `/v1/ws` upgrade headers; token expiry |
| False-positive flood | **INC-5** — tune with `PUT /v1/rules/{code}`, never delete alerts |
| Slow detection | **INC-6** |
| Secret leaked | **INC-7** |

`docker compose down -v` resets the database **and deletes every record entered in it**. Take a backup first (docs/11 §6).

## Documentation

| # | Document | Purpose |
|---|---|---|
| 1 | [PRD](docs/01-PRD.md) | Problem, personas, stories, requirements, EO-1..EO-5 traceability |
| 2 | [TRD](docs/02-TRD.md) | Architecture, stack, detection algorithms, real-time pipeline, budgets |
| 3 | [UI/UX Design](docs/03-UIUX-DESIGN.md) | Design system, screen specs, evidence panel, graph interaction, accessibility |
| 4 | [App Flow](docs/04-APP-FLOW.md) | Journeys, routes, WebSocket flows, state machines |
| 5 | [Backend Schema](docs/05-BACKEND-SCHEMA.md) | DDL, API contracts (as built), WebSocket protocol, validation |
| 6 | [Implementation Plan](docs/06-IMPLEMENTATION-PLAN.md) | Repo structure, env vars, milestones, test matrix |
| 7 | [Phase Build Plan](docs/07-PHASE-BUILD-PLAN.md) | P0–P5 prompts, exit gates, **Reconciliation Log** |
| 8 | [Security & Compliance](docs/08-SECURITY-AND-COMPLIANCE.md) | STRIDE threats, RBAC matrix, audit actions, export security, CI gates |
| 9 | [Data Dictionary](docs/09-DATA-DICTIONARY.md) | Glossary, frozen enums, rule codes, risk-factor catalog |
| 10 | [Test Strategy](docs/10-TEST-STRATEGY.md) | Test IDs, metric definitions, measured results, exit mapping |
| 11 | [Operations Runbook](docs/11-OPERATIONS-RUNBOOK.md) | Commands, health signals, INC-1..7, backup, deploy, demo-day checklist |
| 12 | [Demo Script](docs/12-DEMO-SCRIPT.md) | 5-minute judge script, run-of-show, Q&A, fallbacks |
| 13 | [ADRs](docs/13-ADR.md) | ADR-001..017 |
| 14 | [Architecture & Components](docs/14-ARCHITECTURE-AND-COMPONENTS.md) | Slide-deck source: components, diagrams, Q&A appendix |
| 15 | [7-Slide Deck](docs/15-PPT-7-SLIDE-DECK.md) | Submission-format deck content |

## Expected outcomes → where they are delivered

| ID | Expected outcome (verbatim) | Delivered in | Proven by |
|---|---|---|---|
| EO-1 | Builds a money-flow graph and activity timeline linking employee actions to account and transaction changes | Graph service + Graph Explorer; Activity Timeline with actor chips | T-GRPH-*, T-INT-09, T-FE-08..11 |
| EO-2 | Produces explainable risk levels for connected anomalies rather than an opaque single score | factor aggregation across shared entities (`risk/explain.py`), factor bar + table | T-RISK-*, T-FE-06, S4 = critical |
| EO-3 | Supports case assignment and an evidence export for reviewers | case workflow, JSON/HTML export with SHA-256 digest | T-INT-11..16, T-FE-12/13 |
| EO-4 | Is tested on both suspicious and legitimate scenarios for detection accuracy and false positive rate | `tests/scenarios` metrics gate | S1–S5 5/5, L1–L20 0.0% |
| EO-5 | Includes a mandatory evidence/explanation panel alongside every alert, not just a score | EvidencePanel always mounted, no dismiss API (ADR-009) | T-FE-01..05 |
