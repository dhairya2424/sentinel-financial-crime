# 14 — Architecture & Components (PPT Source File)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Purpose:** Single source for building the judge-facing slide deck. Every slide maps to normative docs (TRD/PRD/ADR) — copy bullets verbatim, do not invent numbers.
**Deck size:** 16 core slides + 6 appendix slides (~12–15 min talk, or 8 min + Q&A).

---

## How to use this file

| Section | Use for |
|---|---|
| §1 Deck outline | Slide order, titles, one-line takeaway per slide |
| §2 Slide-by-slide content | Bullets, diagram, speaker notes — paste into PowerPoint/Google Slides |
| §3 Component inventories | "What we built" reference slides (backend / frontend / data / infra) |
| §4 Appendix material | ADR table, metrics, stack, effort split — backup for Q&A |
| §5 Visual assets (ASCII/Mermaid) | Rebuild diagrams natively in the deck (do not screenshot ASCII) |

---

## 1. Deck outline (16 core slides)

| # | Slide title | Takeaway (the one sentence judges remember) | Primary visual |
|---|---|---|---|
| 1 | Sentinel — Title | Financial crime and insider risk in **one** investigation platform | Logo + tagline |
| 2 | The Problem | Two teams, two tools, zero connection between insider misuse and money laundering | Split-screen diagram |
| 3 | Who It's For | 4 personas: investigator, insider-risk analyst, compliance lead, admin | Persona cards |
| 4 | Solution in One Screen | Graph + timeline + explainable alert + case, on a single money-flow story | Screenshot collage |
| 5 | System Architecture | 2-tier app (React ↔ FastAPI) over PostgreSQL + Redis, one event bus | Architecture diagram |
| 6 | Component Map | Frontend pages ↔ backend services ↔ data stores, 1:1 contract | Component grid |
| 7 | Real-Time Pipeline | Ingest → persist → graph update → detect → alert broadcast in **≤5 s p95** | Horizontal flow |
| 8 | The Money-Flow Graph | Employees, access, customers, transactions as one typed graph | Graph diagram |
| 9 | Detection Engine | 3 primary + 3 supporting rules, deterministic and testable | Rule table |
| 10 | Explainability (no black box) | Every score decomposes into weighted factors that sum to 100 | Factor bar chart |
| 11 | Mandatory Evidence Panel | You cannot see a score without evidence — by construction | UI screenshot |
| 12 | Insider → Money Link | Employee profile edit → downstream circular flow, one click | Flow screenshot |
| 13 | Case & Evidence Export | Assign → investigate → export signed JSON/HTML bundle | Case flow |
| 14 | Accuracy & Performance | ≥90% detection, ≤10% false positives, ≤5 s latency | Metrics scoreboard |
| 15 | Architecture Decisions | Why no Neo4j, no Kafka, no ML — deliberate trade-offs | ADR table |
| 16 | Roadmap / Close | What's built, what scales next, the ask | Timeline |

---

## 2. Slide-by-slide content

### Slide 1 — Sentinel (title)
- **Headline:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
- **Sub:** Link employees, access rights, customers and transactions into one explainable investigation graph.
- **Footer:** PCCOE Hackathon | Team + track
- **Notes:** 5-second hook: *"Suspicious transfers and insider misuse are reviewed by two different teams. We put them on the same graph."*

### Slide 2 — The Problem
- Suspicious money transfers and unusual employee activity are reviewed by **separate teams, in separate tools**.
- Connections hide in the gap: insider privilege misuse ↔ financial crime.
- Result: circular transfers, transaction splitting (structuring), profile mismatches go unlinked.
- **Ask:** an investigation platform that links employees, access rights, customers and transactions with **explainable, evidence-backed alerts** — never an opaque score.
- **Visual:** two boxes with a broken link between them; a third box "Sentinel" bridging them.
- **Notes:** Verbatim problem statement lives in `README.md` / PRD §1.1 — quote it, judges check.

### Slide 3 — Personas
| Persona | Role | What they need |
|---|---|---|
| Priya | AML Investigator | Money-flow graph, structuring detection, evidence export |
| Rahul | Insider Risk Analyst | Activity timeline, access rights, profile-mismatch alerts |
| Sneha | Compliance Lead | Case queue, assignment, dashboard, audit |
| Dev | Platform Admin | Ingestion health, rule config, provisioning |
- **Visual:** 4 cards with icon + one need each.
- **Notes:** Persona table is PRD §4 — pick Priya and Rahul as the story protagonists for slides 11–12.

### Slide 4 — Solution in one screen
- **Unified activity timeline** — every action on an entity, with the employee who did it.
- **Interactive money-flow graph** — 1-hop/2-hop expand, cycle highlight.
- **Explainable alerts** — risk band + factor breakdown + evidence rows.
- **Case management** — assign, notes, status, tamper-evident export.
- **Live** — WebSocket pushes new alerts to every open client.
- **Visual:** 2×2 screenshot collage (timeline / graph / alert+evidence / case).
- **Notes:** If screenshots aren't ready, use the UI spec wireframes in `docs/03-UIUX-DESIGN.md`.

### Slide 5 — System architecture
- Diagram: `Slide 9 / §5.1` below.
- Bullets:
  - **Frontend** React 18 + TS + Vite; graph on ReactFlow, state in Zustand, REST + WebSocket.
  - **Backend** FastAPI (Python 3.11), async routers, JWT auth, tenant-scoped repositories.
  - **PostgreSQL 15** — source of truth: 18 tables, JSONB evidence, recursive CTEs.
  - **Redis 7** — event bus (Streams) + WebSocket pub/sub + pipeline counters.
  - **Graph in memory** — NetworkX adjacency map, rebuilt on startup, updated per event.
- **Notes:** One line to remember: *"Postgres is truth, Redis is the bus, NetworkX is the speed layer."*

### Slide 6 — Component map
- Diagram: `Slide 6 / §5.2` below (three columns: UI | Services | Data).
- Bullets: 9 pages, 8 backend service modules, 18 tables — full inventory in §3.
- **Notes:** Emphasise 1:1 mapping: every UI surface has an API and a table behind it; no demo-only mock endpoints.

### Slide 7 — Real-time pipeline
- Diagram: `Slide 7 / §5.3` below.
- Steps and budgets:
  1. Validate + persist batch (≤500) — **50–150 ms**
  2. Publish to Redis Stream — **5 ms**
  3. Worker: graph update → affected-entity scope → rules on sliding window → evidence bundle — **60–350 ms**
  4. Publish alert → WS hub fan-out — **15 ms**
- **Contract:** ingest → alert on every connected client **≤ 5 s p95, ≤ 2 s median (NFR-01)**.
- Sliding window = only the affected entity's 24–72 h → detection is O(affected), not O(total).
- Dedup key: `rule_id + entity_ids + floor(ts/window)` → repeat hits increment `occurrence_count`, no alert spam.
- **Notes:** This is the "wow" slide — plant a transaction live and watch the alert arrive.

### Slide 8 — The money-flow graph
- **Nodes:** `customer`, `account`, `employee`.
- **Edges:** `TRANSFER`, `ACCOUNT_HOLDER`, `EMPLOYEE_ACCESS`, `PROFILE_CHANGE`, `EMPLOYEE_ACTION`.
- Rebuild from Postgres ≤30 s for 100k rows; incremental on every event.
- Queries: 2-hop neighbors, subgraph, cycle extraction, shortest path — served as ReactFlow-ready JSON with risk overlays computed server-side.
- **Performance:** 2-hop query ≤500 ms p95 (NFR-02); in-memory adjacency makes it ~ms.
- **Visual:** `Slide 8 / §5.4` — employee → access → account → transfer loop.
- **Notes:** EO-1 evidence: one graph answers "who touched this money, and when?"

### Slide 9 — Detection engine
| Code | Pattern | Trigger in one line | Band contribution |
|---|---|---|---|
| R-CIRC | Circular transfer | cycle 3–6 accounts ≤72 h, ≥₹5L total | primary |
| R-STRUCT | Structuring / splitting | ≥3 transfers just under ₹50k threshold in 24 h vs baseline | primary |
| R-PROFILE_ROLE | Insider role mismatch | action outside permitted roles/entitlements | primary |
| R-PROFILE_FLOW | Edit-then-flow | profile edit → customer transfer within 48 h | primary |
| R-VELOCITY | Velocity spike | >5× trailing 7-day baseline | +0–40 |
| R-OFFHOURS | Off-hours action | 00:00–05:00 tenant time | +0–25 |
| R-DORMANT | Dormant reactivation | 90-day idle → near-threshold transfer in 48 h | +0–45 |
- Rule-based by design (ADR-002): deterministic, testable, tunable by admin — no black-box ML in v1.
- **Notes:** Supporting rules attach to any primary alert on the same entities; standalone only when composite ≥60.

### Slide 10 — Explainability, not a score
- Every alert carries `risk_factors[]`: **name, raw value, weight, contribution**.
- Contributions **sum to the composite score** — server asserts `Σ contribution ≈ risk_score/100` before persist.
- Bands frozen: **Low <40 · Medium 40–69 · High 70–84 · Critical ≥85** (ADR-003).
- Example row: `amount = 4.2× p95, weight 0.35 → +35` · `temporal_proximity = 94% of window, weight 0.25 → +23.5`.
- Human-readable explanation template generated per rule.
- **Visual:** horizontal stacked bar of contributions = total score.
- **Notes:** EO-2 — invite a judge to try to find a single opaque number in the UI; they can't.

### Slide 11 — Mandatory evidence panel
- Evidence panel is **always mounted** on alert detail; there is **no dismiss API** (ADR-009), enforced by Vitest tests T-FE-01..05.
- Evidence rows are **snapshotted at detection time** (copy-on-detect, ADR-004) — later data edits can't rewrite history.
- Missing evidence renders an explicit **"Evidence unavailable — data retention issue"** state, never score-only.
- Export bundles are SHA-256 digested and recorded in the DB (tamper-evidence).
- **Visual:** screenshot of AlertDetail with panel highlighted.
- **Notes:** EO-5 — this is the slide that separates us from "yet another risk score".

### Slide 12 — Connecting insider activity to money flow
- Story: employee adds beneficiary at 03:15 → customer's circular transfer fires 12 h later.
- Same graph, same timeline, one alert: R-PROFILE_FLOW + R-CIRC correlated on `customer_id`.
- Timeline shows actor chips (employee ID + name) on every account/transaction change.
- Filter: graph edge `PROFILE_CHANGE` + `TRANSFER` in one view.
- **Visual:** before/after screenshots or a 3-node chain diagram.
- **Notes:** EO-1 + problem statement in one demo beat — script it in `docs/12-DEMO-SCRIPT.md` §4.

### Slide 13 — Case & evidence export
- Alert → case (or group linked alerts by shared entities) → assign → notes → status machine:
  `Open → In Review → Escalated → Closed-Confirmed / Closed-False-Positive` (closure note mandatory).
- Export: JSON bundle = case + alerts + evidence records + graph snapshot + timeline excerpt + decision audit.
- SHA-256 digest recorded in DB; HTML printable report from the same bundle; ≤5 s for ≤500 evidence records.
- Every state change written to append-only `audit_log` (NFR-07: 100% coverage).
- **Visual:** linear flow with the four artifacts listed.

### Slide 14 — Accuracy & performance scoreboard
| Metric | Target | Where proven |
|---|---|---|
| Detection on planted scenarios | **≥ 90%** (NFR-05) | S1–S5 suite |
| False positives on legitimate corpus | **≤ 10%** (NFR-06) | L1–L20 suite |
| Ingest → broadcast latency | **≤ 5 s p95 / ≤ 2 s median** (NFR-01) | integration test |
| 2-hop graph query | **≤ 500 ms p95** (NFR-02) | perf harness |
| Dashboard/search API | **≤ 300 ms p95** (NFR-03) | perf harness |
| Concurrent users | **50** (NFR-04) | load smoke |
| Audit completeness | **100%** (NFR-07) | spot-check test |
- **Notes:** If metrics aren't run yet, show the harness command (`pytest tests/scenarios --metrics`) and mark numbers "measured on seed `--scenario mixed`" only when true.

### Slide 15 — Architecture decisions (why this, not that)
| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Graph store | Postgres + in-memory NetworkX | Neo4j | Hackathon scale; one less ops surface; ≤30 s rebuild (ADR-001) |
| Detection | Rules + factor decomposition | ML score | Explainability mandated; testable; admin-tunable (ADR-002) |
| Event bus | Redis Streams + pub/sub | Kafka | No broker ops; `EventBus` interface swaps to Kafka later (ADR-005) |
| Process model | Single-node API + colocated worker | Microservices | Stateful graph colocated; stateless API still restart-safe (ADR-006) |
| Evidence | Snapshot at detection | Live joins | Tamper-proof, reproducible exports (ADR-004) |
| Evidence UI | No dismiss API | User-dismissible | Panel cannot be turned off (ADR-009) |
- **Notes:** Full list ADR-001..012 in `docs/13-ADR.md`.

### Slide 16 — What's built & what's next
- **Built (v1):** ingest, timeline, graph explorer, 3+3 detection rules, explainable alerts with evidence panel, case manager, signed export, scenario metrics, JWT + tenant isolation + audit.
- **Next:** Kafka-backed bus for horizontal scale-out, multi-tenant onboarding, historical baselining, rules versioning UI, streaming graph layout.
- **Ask:** [team/track/what you need from judges]
- **Visual:** two-column "Now / Next" timeline.

---

## 3. Component inventories (reference slides)

### 3.1 Backend service components (`backend/app/`)

| Component | Path | Responsibility | Key contract |
|---|---|---|---|
| API app / router registry | `main.py` | CORS, lifespan, health, OpenAPI | `/docs`, `/v1/ops/health` |
| Config | `config.py` | pydantic-settings from env | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` |
| DB layer | `db.py` | async engine/session, tenant-scoped repo helpers | tenant predicate on every query |
| Auth | `auth/` | JWT issue/refresh, bcrypt, `require_role` | 30 min access / 12 h refresh |
| Domain models | `models/` | SQLAlchemy 2.0 ORM, 1:1 with DDL | 18 tables |
| API contracts | `schemas/` | Pydantic v2 request/response | OpenAPI-generated types |
| Routers | `api/` | auth, ingest, graph, timeline, alerts, cases, rules, ops | §3.4 |
| **Graph Service** | `graph/service.py` | adjacency rebuild, incremental update, neighbors, cycles | networkx 3.x |
| **Detection Engine** | `detection/engine.py` + `r_circ/r_struct/r_profile/supporting` | scoped rule execution, dedup | emits factors + evidence refs |
| Rule protocol | `detection/base.py` | `Rule`, `RuleContext`, `Hit`, `Factor` | uniform rule interface |
| **Risk/Explain** | `risk/explain.py` | factor aggregation, banding, Σ invariant | pure functions, unit-tested |
| **Pipeline Worker** | `pipeline/worker.py` | stream consumer: graph → detect → alert → publish | ≤5 s end-to-end |
| **WS Hub** | `realtime/hub.py` | channel auth, Redis pub/sub fan-out | `alerts:{tenant}`, `cases:{tenant}`, `dashboard:{tenant}` |
| Case Service | `cases/service.py` | assignment, status machine, notes, audit | closure note validation |
| Export Service | `export/service.py` | JSON bundle, HTML render, SHA-256 | digest stored in DB |
| Audit | `audit.py` | append-only state-change log | 100% coverage |
| Seed | `seed/` | scenario generators: suspicious / legit / mixed | 50 customers, 30 employees, ~4,000 txns |

### 3.2 Frontend components (`frontend/src/`)

| Layer | Items |
|---|---|
| Pages (9) | `Login`, `Dashboard`, `AlertInbox`, `AlertDetail`, `CaseManager`, `CaseDetail`, `GraphExplorer`, `Timeline`, `RulesAdmin` |
| Shared components | `RiskBadge`, `EntityChip`, `EvidencePanel`, `Toasts`, `Skeleton`, `ConfirmDialog` |
| Graph module | ReactFlow node/edge types, side panel, expand controls, edge tooltips, cycle badge, layout |
| State (Zustand) | `auth`, `alerts`, `cases`, `ws` — WS events reduce into stores |
| API layer | `api/client.ts` (fetch + JWT refresh), `api/types.ts` (mirrors OpenAPI) |
| Realtime | `ws/useSocket.ts` — connect, subscribe, exponential reconnect, resubscribe refetch |
| Design system | Tailwind tokens: 4 risk colors, spacing scale, AA contrast, focus ring, `prefers-reduced-motion` |

### 3.3 Data components (PostgreSQL 15 — 18 tables)

| Group | Tables |
|---|---|
| Tenancy & identity | `tenants`, `users` |
| Financial domain | `customers`, `accounts`, `transactions` |
| Insider domain | `employees`, `access_rights`, `employee_sessions`, `employee_actions` |
| Detection & alerts | `rules`, `alerts`, `alert_evidence` |
| Casework | `cases`, `case_alerts`, `case_notes` |
| Ops & governance | `audit_log`, `ingest_failures` (+ optional graph view) |

### 3.4 API surface (REST + WS)

| Area | Endpoints |
|---|---|
| Auth | `POST /v1/auth/login`, `POST /v1/auth/refresh`, `GET /v1/auth/me` |
| Ingest | `POST /v1/ingest/events` (batch ≤500), `POST /v1/ingest/access-rights` |
| Graph | `GET /v1/graph/entity/{id}`, `/neighbors`, `/search` |
| Timeline | `GET /v1/timeline/{entity_type}/{id}` |
| Alerts | `GET /v1/alerts`, `GET /v1/alerts/{id}`, `POST .../acknowledge`, `POST .../link-case` |
| Cases | `POST/GET /v1/cases`, `PATCH /v1/cases/{id}`, `.../assign`, `.../notes`, `.../export?format=json\|html` |
| Rules / Ops | `GET /v1/rules`, `PUT /v1/rules/{code}`, `GET /v1/ops/health`, `POST /v1/ops/replay-batch` |
| WebSocket | `/v1/ws?token=<jwt>` → channels `alerts:{tenant}`, `cases:{tenant}`, `dashboard:{tenant}` |

### 3.5 Infrastructure components (`docker-compose.yml`)

| Service | Image | Port | Health |
|---|---|---|---|
| `db` | postgres:15 | 5432 | `pg_isready` |
| `cache` | redis:7 | 6379 | `redis-cli ping` |
| `api` | python 3.11 + uvicorn | 8000 | `/v1/ops/health` |
| `web` | node + vite (dev) / nginx (demo) | 5173 / 80 | `/` |

---

## 4. Appendix / Q&A material

- **Stack table:** TRD §2 (FastAPI ≥0.110, Python 3.11, PostgreSQL 15, asyncpg/SQLAlchemy 2.0, Alembic, Redis 7, networkx 3.x, React 18 + TS 5.x, Vite 5, ReactFlow 12, Recharts 2, Zustand 4, Tailwind 3.4, PyJWT + bcrypt (ADR-013), pytest + Vitest, Docker Compose).
- **Security slide backup:** JWT + bcrypt, `require_role` RBAC, `tenant_id` on every table (cross-tenant read → 404, ADR-011), parameterized SQL, append-only audit, no secrets in repo, STRIDE threat model in `docs/08`.
- **Testing slide backup:** unit (rules, risk, graph) → integration (ingest→alert, tenant isolation, cases, export) → scenario (S1–S5, L1–L20) → frontend (evidence panel mandatory). Coverage gates in `docs/10`.
- **Effort split:** Backend-A (ingest, domain, timeline, seed) · Backend-B (graph, detection, risk, pipeline) · Frontend (shell, graph, alerts, cases, dashboard) · QA/Ops (docker, migrations, scenarios, metrics, demo).
- **Risk answers:** false positives → daily legitimate-suite run + threshold tuning; venue wifi → WS reconnect + REST refetch fallback; missing evidence → snapshot in same tx + explicit error state; scope creep → non-goals (no ML, no auto-block) in PRD §3.
- **48-hour cut:** keep M0–M4 + S1–S4; never cut evidence panel, factor breakdown, explainability invariant, scenario metrics (`docs/06 §8`).

---

## 5. Visual assets (rebuild natively in the deck)

### Slide 5 / §5.1 — System architecture

```
                 ┌───────────────────────────────────────────────┐
                 │  FRONTEND — React 18 + TypeScript (Vite)      │
                 │  GraphExplorer · Timeline · AlertInbox/Detail │
                 │  CaseManager · Dashboard · RulesAdmin         │
                 └───────────────┬───────────────┬───────────────┘
                          REST (HTTPS)      WebSocket /v1/ws
                                 │               │
                 ┌───────────────▼───────────────▼───────────────┐
                 │  BACKEND — FastAPI (Python 3.11)              │
                 │  Auth │ Ingest │ Graph │ Detection │ Risk     │
                 │  Cases │ Export │ WS Hub │ Ops                │
                 │           Pipeline Worker (consumer)          │
                 └──────┬────────────────┬───────────────┬───────┘
                        │                │               │
              ┌─────────▼──────┐  ┌──────▼──────┐  ┌─────▼──────────┐
              │ PostgreSQL 15  │  │ Redis 7     │  │ NetworkX       │
              │ source of truth│  │ Streams +   │  │ in-memory      │
              │ 18 tables      │  │ pub/sub bus │  │ adjacency map  │
              └────────────────┘  └─────────────┘  └────────────────┘
```

### Slide 6 / §5.2 — Component map

```
   UI (9 pages)                SERVICES (8 modules)            DATA (18 tables)
 ┌──────────────┐         ┌──────────────────────┐        ┌──────────────────┐
 │ Login        │──REST──▶│ Auth (JWT, RBAC)     │───────▶│ tenants, users   │
 │ Dashboard    │◀──WS────│ WS Hub               │        │ audit_log        │
 │ AlertInbox   │──REST──▶│ Alerts API           │◀──────▶│ alerts,          │
 │ AlertDetail  │         │ Detection Engine     │        │ alert_evidence   │
 │  └Evidence   │         │  R-CIRC R-STRUCT     │        │ rules            │
 │ CaseManager  │──REST──▶│  R-PROFILE ×2 +supp  │        │ cases, case_*    │
 │ CaseDetail   │         │ Risk/Explain (Σ=100) │        │ ingest_failures  │
 │ GraphExplorer│──REST──▶│ Graph Service        │◀──────▶│ customers        │
 │ Timeline     │──REST──▶│ Timeline / Ingest    │        │ accounts         │
 │ RulesAdmin   │──REST──▶│ Export (JSON+HTML)   │        │ transactions     │
 └──────────────┘         └──────────┬───────────┘        │ employees,       │
                                     │ Redis Streams       │ access_rights,   │
                              ┌──────▼───────────┐        │ employee_*       │
                              │ Pipeline Worker  │        └──────────────────┘
                              └──────────────────┘
```

### Slide 7 / §5.3 — Real-time pipeline

```
 POST /v1/ingest/events (batch ≤ 500)
   │  1. Pydantic validate + Postgres batch insert          50–150 ms
   │  2. Publish to Redis Stream "events"                     ~5 ms
   ▼
 PIPELINE WORKER (per event)
   │  a. Graph Service incremental update (edge/node)         1–10 ms
   │  b. Resolve affected entities (customer/account/emp)      ~1 ms
   │  c. Run rules on affected sliding window (24–72 h)      50–300 ms
   │  d. Hit → evidence bundle + factors → persist alert      ~30 ms
   │  e. Publish to Redis channel "alerts:{tenant}"            ~5 ms
   ▼
 WS HUB fan-out to subscribed clients                          ~10 ms
   ─────────────────────────────────────────────────────────────────
   Contract: end-to-end ≤ 5 s p95, ≤ 2 s median (NFR-01)
```

### Slide 8 / §5.4 — Money-flow graph

```
                    EMPLOYEE_ACCESS (entitlement)
        ┌────────────────────────────────────────┐
        │                                        │
   ┌────▼─────┐  PROFILE_CHANGE  ┌──────────┐    │     ┌─────────────┐
 │ employee  │──────────────────▶│ customer │────┼────▶│   account   │
 │ (Rahul)   │  EMPLOYEE_ACTION  └──────────┘    │     └──────┬──────┘
 └───────────┘  (approve/edit)   ACCOUNT_HOLDER  │            │
                                    ▲            │            │ TRANSFER
                                    └────────────┘            ▼
                                       A ──▶ B ──▶ C ──▶ A   ◀── cycle detected
                                              (R-CIRC, ≤72 h, ≥₹5L)
```

### Slide 10 / §5.5 — Risk factor decomposition

```
  amount           ██████████████████░░░░  0.35 → 35.0
  temporal         ████████████░░░░░░░░░░  0.25 → 23.5
  linkage depth    █████████░░░░░░░░░░░░░  0.25 → 18.0
  velocity         ████░░░░░░░░░░░░░░░░░░  0.15 →  3.5
                                           ─────────────
  composite risk score                              80  → HIGH (70–84)
  invariant asserted server-side: Σ contribution ≈ risk_score / 100
```

### Slide 16 / §5.6 — Now / Next timeline

```
  v1 (built)                                  v2 (next)
  ├─ ingest + timeline                        ├─ Kafka-backed EventBus
  ├─ graph explorer (2-hop, cycles)           ├─ multi-tenant onboarding
  ├─ 3 primary + 3 supporting rules           ├─ historical baselining
  ├─ explainable alerts + evidence panel      ├─ rules versioning UI
  ├─ cases + signed export                    ├─ streaming graph layout
  └─ scenario metrics (≥90% / ≤10%)           └─ horizontal API scale-out
```

---

## 6. Traceability — which slide proves which outcome

| Slide | Expected outcome | Normative source |
|---|---|---|
| 8, 12 | EO-1 graph + timeline linking employee actions to money | TRD §5, PRD Epic A/B |
| 10 | EO-2 explainable risk bands, no opaque score | TRD §4.5/§6, PRD C5 |
| 13 | EO-3 case assignment + evidence export | TRD §8, PRD Epic D |
| 14 | EO-4 accuracy + false-positive metrics | TRD §9, docs/10 §6 |
| 11 | EO-5 mandatory evidence panel | ADR-009, PRD C4 |
