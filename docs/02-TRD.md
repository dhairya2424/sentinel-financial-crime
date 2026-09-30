# 02 — Technical Requirements Document (TRD)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Normative inputs:** PRD §1.1 problem statement + EO-1..EO-5 (docs/01 §1.2–1.4) — every subsystem below exists to make one or more EOs provable.

---

## 1. Architecture Overview

```
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│  Frontend (React + TS)       │        │  Backend (FastAPI, Python)      │
│  - Graph Explorer (ReactFlow)│◄──WS──►│  - API Gateway (REST + WS hub)  │
│  - Activity Timeline         │        │  - Ingest Service               │
│  - Alert Inbox / Evidence    │        │  - Graph Service (in-mem + PG)  │
│  - Case Manager              │        │  - Detection Engine (workers)   │
│  - Dashboard                 │        │  - Risk/Explainability Service  │
└──────────────┬───────────────┘        │  - Case Service                 │
               │ REST (HTTPS)           │  - Evidence Export Service      │
               ▼                        └───────┬──────────────┬──────────┘
┌──────────────────────────────┐        ┌───────▼─────┐  ┌─────▼──────────┐
│ PostgreSQL 15                │        │ Redis 7     │  │ Event Bus      │
│ (source of truth, full DDL   │        │ (WS pub/sub │  │ (Redis Streams │
│  in docs/05)                 │        │  + streams) │  │  or in-proc)   │
└──────────────────────────────┘        └─────────────┘  └────────────────┘
```

**Key decision — graph storage:** PostgreSQL is the source of truth. The Graph Service also maintains an **in-process adjacency map (NetworkX-backed)** rebuilt on startup and updated incrementally on each event, so 2-hop neighbor queries and cycle detection run at memory speed without a heavyweight graph DB. This is deliberate: a Neo4j dependency is unnecessary at hackathon scale and Redis Streams provides the real-time bus without Kafka ops overhead. The bus abstraction (`EventBus` interface) allows swapping to Kafka for production scale-out.

## 2. Technology Stack (exact, no assumptions)

| Layer | Technology | Version | Why |
|---|---|---|---|
| Backend API | FastAPI | ≥ 0.110 | Async, native WebSocket, Pydantic v2 validation |
| Language | Python | 3.11+ (built and tested on 3.13) | Ecosystem for analytics (pandas, networkx) |
| DB | PostgreSQL | 15 | JSONB for evidence, recursive CTEs, partitioning |
| DB driver | asyncpg via SQLAlchemy 2.0 async | latest | Async pooling |
| Migrations | Alembic | latest | Versioned DDL |
| Cache / bus | Redis | 7 | WS pub/sub, streams, pipeline counters |
| Graph lib | networkx | 3.x | In-memory adjacency, SCC/cycle algorithms |
| Frontend | React 19 + TypeScript | 19.3 / 6.0 | Component model, typed contracts (TS held at 6.0: typescript-eslint supports <6.1; ADR-014) |
| Build | Vite | 8.x | Fast dev server |
| Graph UI | ReactFlow (@xyflow/react) | 12 | Interactive node/edge graph, custom nodes |
| Charts | Recharts | 3.x | Timeline density, dashboard |
| State | Zustand | 5 | Lightweight store + WS event reducers |
| Styling | Tailwind CSS | 4.x | Design tokens as CSS `@theme` variables, light + dark (ADR-014) |
| Routing | React Router | 8.x | Data router, route guards |
| Auth | PyJWT + bcrypt | ≥ 2.10 / ≥ 5.0 | JWT + password hashing (ADR-013: replaces python-jose + passlib) |
| Testing | pytest + httpx (backend), Vitest + Testing Library (frontend) | — | API + unit tests |
| Deploy | Docker Compose (pg, redis, api, web) | — | One-command demo |

## 3. Real-Time Pipeline (ingest → alert)

**Contract:** an ingested event reaches all connected clients as a WebSocket broadcast within **5 s p95**.

```
POST /v1/ingest/events (batch ≤ 500)
  │
  1. Validate (Pydantic) + persist to PG (single tx, batch insert)     ~50–150 ms
  2. Publish to Redis Stream "events"                                  ~5 ms
  3. Pipeline worker (per event):
     a. Graph Service incremental update (add edge / update node meta) ~1–10 ms
     b. Determine affected entity set (customer, account, employee)    ~1 ms
     c. Run detection rules scoped to affected entities + sliding window ~50–300 ms
     d. On hit → build evidence bundle + risk factors → persist alert  ~30 ms
     e. Publish alert to Redis channel "alerts:{tenant}"               ~5 ms
  4. WS hub fans out to subscribed clients                             ~10 ms
```

- **Sliding window scope:** rules only evaluate the affected entity's window (e.g., last 24 h transactions of the involved accounts), not the whole dataset — this is what keeps detection O(affected) not O(total).
- **Dedup:** deterministic alert key = `rule_id + entity_ids(sorted) + floor(event_ts / window)`. Duplicate keys within an open alert increment `occurrence_count` and append evidence instead of creating new alerts. As built (P3-B): only *new* evidence counts as an occurrence, so a replay or an unrelated nearby event that re-finds the same pattern changes nothing; an active alert with the same rule and entities whose window is within one rule window is extended even when the window floor ticks over; hits that share an entity become one alert whose risk is the max-merged factor set.
- **Window building (P3-B):** the worker loads completed transfers within ±72 h of the event on the affected accounts, the holders' other accounts and accounts within five transfer hops (so R-CIRC sees loops up to six accounts), employee actions within ±48 h, and entitlements as held at the event time. 30-day baselines and last activity are counted live from the store, because ingest does not maintain the stored baseline columns.
- **Delivery:** at-least-once. A stream message is acknowledged after its outcome is durable; failures retry up to three deliveries, then land in `ingest_failures` (`payload.stage = "pipeline"`). Messages left pending by a dead consumer are reclaimed after 15 s. Each API process joins the `pipeline` group under its own consumer name.
- **Backpressure:** Redis Stream consumer groups; failed batches written to `ingest_failures` table with re-drive endpoint.
- **Clock:** all timestamps UTC (`timestamptz`); "off-hours" defined per tenant timezone config.

## 4. Detection Engine — Exact Algorithms

All rules emit: `pattern_code`, `entity_ids`, `risk_factors[]` (name, raw_value, weight, contribution 0–1), `evidence_refs[]`, `window`, `explanation` (human-readable string). Composite risk = Σ(contribution) mapped to bands: **Low <40, Medium 40–69, High 70–84, Critical ≥85** (score is 0–100).

### 4.1 R-CIRC — Circular Transfer Detection
- **Input:** transfers among accounts within `window` (default 72 h).
- **Algorithm:** build directed subgraph of involved accounts (edges = transfers). Run `networkx.simple_cycles` limited to cycles of length 3–6. For each cycle, compute `total_amount`, `time_span`, `min_edge_amount`.
- **Trigger:** cycle length ∈ [3,6] AND `time_span ≤ window` AND `total_amount ≥ tenant.min_cycle_amount` (default ₹500,000). Legs must be time-ordered so money can actually travel the loop (ADR-015).
- **Risk factors:** `linkage_depth` (cycle length, weight 0.25), `amount` (log-normalized vs. p95 of account history, 0.35), `temporal_proximity` (1 − span/window, 0.25), `account_velocity` (transfers/hour in window vs baseline, 0.15).
- **Explanation template:** "₹{total} moved in a loop across {n} accounts within {span}: A → B → C → A. Loop transfers: [ids]. Amount is {x}× the p95 for account A."

### 4.2 R-STRUCT — Transaction Structuring (Smurfing)
- **Input:** per (customer → destination) or per customer, transfers within `window` (default 24 h).
- **Algorithm:** group transactions by (customer, 24 h bucket). Compute `count`, `total`, `max_single`, share of transactions in band `[0.8×threshold, threshold)` (threshold default ₹50,000 reporting threshold). Compare against customer baseline (mean count/amount over prior 30 days).
- **Trigger:** ≥ 3 transactions in the just-under band within a sliding 24 h window AND total ≥ 1.5× threshold AND (count ≥ 3× the customer's mean count per window, i.e. 30-day count ÷ 30, OR no prior history) (ADR-015).
- **Risk factors:** `sub_threshold_ratio` (0.35), `velocity_vs_baseline` (0.25), `total_amount` (0.25), `destination_spread` (# distinct beneficiaries, 0.15).
- **Explanation template:** "{n} transfers of ₹{total}, each just under the ₹{threshold} reporting threshold, within {hours}. Baseline for this customer is {b} transfers/30 days."

### 4.3 R-PROFILE — Profile Mismatch (Insider)
Two sub-rules, both mandatory:
1. **Role-Action Mismatch:** employee performs action `tx.approve` / `profile.limit_change` while their `role` ∉ `allowed_roles[action]` (config map, e.g., tx.approve → [teller, manager, finance_ops]) OR their access rights lack the entitlement for the action.
2. **Edit-then-Flow Correlation:** employee edits a customer's profile (beneficiary add, limit change) AND the customer executes a triggered transfer (R-CIRC or R-STRUCT hit or ≥ 0.8× threshold transfer) within `correlation_window` (default 48 h). Matched via shared `customer_id`.
- **Trigger:** sub-rule 1 on mismatch; sub-rule 2 on both conditions.
- **Risk factors:** `access_anomaly` (0.35), `action_sensitivity` (action weight map, 0.25), `temporal_proximity` (0.25), `employee_off_hours` (action outside 09:00–19:00 tenant tz, 0.15).
- **Explanation template:** "Employee {emp} (role: {role}) performed '{action}' — outside permitted roles {allowed}. {Sub-rule 2:} The same customer's transfers of ₹{amt} followed within {hours}."

### 4.4 Supporting Rules
| Code | Trigger | Risk contribution |
|---|---|---|
| R-VELOCITY | account transfers/hour > 5× trailing 7-day baseline | 0–40 add-on factor, standalone alert if ≥ 60 |
| R-OFFHOURS | employee action between 00:00–05:00 tenant tz | 0–25 add-on |
| R-DORMANT | account inactive ≥ 90 days then ≥ 0.8× threshold transfer in 48 h | 0–45 add-on |

Supporting rules attach their factors to any primary alert on the same entities (increasing the band) and raise standalone alerts only when composite ≥ 60.

### 4.5 Explainability Contract (non-negotiable)
Every alert persisted with:
```json
{
  "risk_score": 78, "risk_band": "HIGH",
  "risk_factors": [
    {"name":"amount","raw_value":"4.2x p95","weight":0.35,"contribution":0.35},
    {"name":"temporal_proximity","raw_value":"94% of window","weight":0.25,"contribution":0.235}
  ],
  "explanation": "…", "evidence_refs": ["tx:..","action:..","access:.."]
}
```
Factors' contributions sum to the composite score; UI renders raw value + weight + contribution per factor. When connected hits max-merge to a sum above 1.0, contributions are scaled proportionally so the invariant holds at 100 (ADR-015). Server asserts the invariant `Σ contribution ≈ risk_score/100` before persist (docs/05 §7).

## 5. Graph Service

- **Nodes:** `customer`, `account`, `employee` (typed). **Edges:** `TRANSFER` (amount, ts), `ACCOUNT_HOLDER` (customer↔account), `EMPLOYEE_ACCESS` (employee↔account/customer, entitlement), `PROFILE_CHANGE` (employee↔customer/account, action, ts), `EMPLOYEE_ACTION` (employee↔tx).
- **Maintenance:** startup rebuild from PG (≤ 30 s for 100k rows via batched queries); incremental on each pipeline event.
- **Queries:** `neighbors(node_id, depth ≤ 2, edge_filters)`, `subgraph(node_ids)`, `cycles_in(subgraph)`, `shortest_path(a,b)`.
- **Serving:** graph endpoints return ReactFlow-ready node/edge JSON with risk overlays computed server-side.

## 6. Risk/Explainability Service

Pure functions over detection output: factor aggregation when multiple rules hit shared entities (max-contribution merge per factor name), band mapping, explanation composition. No persistence. Unit-testable in isolation.

## 7. API Surface (summary — full contracts in docs/05 §6)

| Area | Endpoints |
|---|---|
| Auth | `POST /v1/auth/login`, `POST /v1/auth/refresh`, `GET /v1/auth/me` |
| Ingest | `POST /v1/ingest/events` (batch), `POST /v1/ingest/access-rights` |
| Graph | `GET /v1/graph/entity/{id}`, `GET /v1/graph/neighbors`, `GET /v1/graph/search` |
| Timeline | `GET /v1/timeline/{entity_type}/{id}` |
| Alerts | `GET /v1/alerts`, `GET /v1/alerts/{id}`, `POST /v1/alerts/{id}/acknowledge`, `POST /v1/alerts/{id}/link-case` |
| Cases | `POST /v1/cases`, `GET /v1/cases`, `PATCH /v1/cases/{id}`, `POST /v1/cases/{id}/assign`, `POST /v1/cases/{id}/notes`, `GET /v1/cases/{id}/export?format=json|html` |
| Rules | `GET /v1/rules`, `PUT /v1/rules/{code}` (admin) |
| Ops | `GET /v1/ops/health`, `POST /v1/ops/replay-batch` |
| WS | `/v1/ws` — channels: `alerts:{tenant}`, `cases:{tenant}`, `dashboard:{tenant}` |

## 8. Case & Evidence Export

- Export JSON bundle: case + alerts (full) + evidence records + graph snapshot (subgraph of case entities) + timeline excerpt + decision audit. Signed with SHA-256 digest recorded in DB for tamper-evidence.
- HTML report: server-rendered printable template from the same bundle.

## 9. Testing & Validation Strategy

| Suite | What | Tooling | Pass criteria |
|---|---|---|---|
| Unit: detection | Each rule against synthetic windows (known cycles, structured sets, mismatches) | pytest | 100% of planted triggers detected; no trigger on negative controls |
| Unit: risk | Factor aggregation, band mapping | pytest | Exact score assertions |
| Integration: pipeline | Ingest batch → assert alert + WS broadcast latency | pytest + httpx + redis testcontainer | ≤ 5 s p95 |
| Scenario: suspicious | 5 scripted scenarios (circular, structuring, profile mismatch ×2, combined) | seeded PG + runner | ≥ 90% detected (NFR-05) |
| Scenario: legitimate | 200 normal customers, 3 months activity | seeded PG + runner | ≤ 10% false alert (NFR-06) |
| Frontend | Component tests (evidence panel renders, graph interactions) | Vitest | Evidence panel mandatory-state test |

## 10. Security & Compliance

- JWT (30 min access, 12 h refresh), bcrypt passwords, role checks as FastAPI dependencies.
- Tenant isolation: `tenant_id` on all tables; every repository query includes tenant predicate; integration test asserts cross-tenant read fails.
- All SQL parameterized (SQLAlchemy); input validation via Pydantic.
- Audit log append-only table for all state changes.
- No secrets in code: `.env` + `docker-compose` env vars; `.env` git-ignored.
