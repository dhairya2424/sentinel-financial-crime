# 15 — 7-Slide PPT Deck (Submission Format)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Purpose:** The exact 7-slide deck required for submission. Each slide = paste-ready bullets + visual + speaker notes + source doc.
**Companion:** `docs/14-ARCHITECTURE-AND-COMPONENTS.md` holds the deeper architecture/component material and Q&A backup for these slides.
**Rule:** Numbers on slides come from PRD/TRD only — never invent metrics. Mark any unmeasured figure as "target".

---

## Deck at a glance

| # | Slide | One thing the judge must take away | Time |
|---|---|---|---|
| 1 | Problem Statement | Two review teams, two tools — the link between insider misuse and money laundering is invisible | 45 s |
| 2 | Abstract | One platform: graph + timeline + explainable alerts + case export, in one sentence | 45 s |
| 3 | Idea Title | **Sentinel** — the name and the one-line pitch | 15 s |
| 4 | Technical Approach | Postgres + Redis + NetworkX + FastAPI pipeline: ingest → detect → explain ≤5 s | 90 s |
| 5 | Feasibility & Viability | Built in 6 phases on commodity open-source stack; measurable pass/fail targets | 60 s |
| 6 | Impacts & Benefits | Faster triage, defensible explanations, insider↔crime link, audit-ready export | 60 s |
| 7 | Research & References | Normative brief + regulatory drivers + prior art + tech foundations | 30 s |

---

## Slide 1 — Problem Statement

**Key message:** Financial-crime review and insider-risk review sit in different tools, so the connection between them is never seen.

**Bullets (paste-ready):**

- Suspicious money transfers and unusual employee activity are reviewed by **separate teams in separate tools** — hiding the link between **insider privilege misuse and financial crime**.
- Three invisible patterns today:
  - an employee **edits a customer profile** (limit/beneficiary) and suspicious transfers follow;
  - an employee **acts outside their role/entitlements** and moves funds;
  - **structuring** — many transfers just under the reporting threshold look ordinary in isolation.
- Consequence: regulatory penalties, undetected fraud rings, insider abuse.
- Regulators (RBI, FinCEN, FATF) demand **explainable** monitoring — a single opaque risk score is not defensible.
- **Need:** an investigation platform linking **employees, access rights, customers and transactions** with **explainable, evidence-backed alerts**.

**Visual:** two side-by-side boxes — "AML / Financial Crime Team" and "Insider Risk Team" — with a broken link between them; Sentinel shown bridging both.

**Speaker notes (45 s):** Open with the verbatim brief (README / PRD §1.1), then land the three invisible patterns — the third one (structuring) is the one judges recognise instantly. Close on: *"The data already exists. The connection doesn't."*

**Source:** `README.md` Problem Statement · `docs/01-PRD.md §1.1–1.3`

---

## Slide 2 — Abstract

**Key message:** Sentinel unifies entities, detection and evidence in a single explainable investigation platform.

**Bullets (paste-ready):**

- **What:** An investigation platform that links **employees, access rights, customers and transactions** into one money-flow graph + activity timeline.
- **Detects:** circular transfers, transaction splitting (structuring), profile mismatches — plus velocity, off-hours and dormant-account supporting signals.
- **Explains:** every alert carries a risk band (**Low <40 · Medium 40–69 · High 70–84 · Critical ≥85**) decomposed into weighted factors **that sum to the score** — no black box.
- **Proves:** a **mandatory evidence panel** on every alert (raw rows snapshotted at detection, SHA-256 digested export); the panel cannot be dismissed.
- **Connects:** employee action → account change → money movement, on one graph, in one timeline, in real time (**≤5 s ingest → broadcast**).
- **Validates:** tested on suspicious **and** legitimate scenarios — **≥90% detection, ≤10% false positives** (target/NFR-05, NFR-06); measured 2026-09-30: **5/5 detected, 0/200 benign customers flagged, p95 210 ms** (docs/10 §6).
- **Outcome:** assign to a case, annotate, close, export a tamper-evident evidence bundle for reviewers.

**Visual:** one horizontal strip — Ingest → Graph + Timeline → Detection → Explainable Alert → Case + Export (5 boxes, arrows).

**Speaker notes (45 s):** Read the "What/Detects/Explains/Proves" lines as one sentence: *"We unify the four entities, detect three typologies, explain every score, and make evidence unavoidable."*

**Source:** `docs/01-PRD.md §1.2, §2` · `docs/02-TRD.md §4.5` · `docs/13-ADR.md`

---

## Slide 3 — Idea Title

**Key message:** The name and the pitch, nothing else.

**Bullets (paste-ready):**

- **Sentinel**
- **Financial Crime & Insider Risk Intelligence Platform**
- Tagline: **"One graph. Every actor. Explainable alerts."**
- Sub-line: *Linking employees, access rights, customers and transactions — with evidence, never an opaque score.*
- Domain · Team · Track line: `[Domain: AML / Insider Risk] · [Team name] · [Track]`

**Visual:** Full-bleed dark slide, logo/wordmark centred, tagline beneath. Optional background: faint node-edge graph.

**Speaker notes (15 s):** Say the name, the tagline, and one bridging line into Slide 4: *"Here's how it actually works."*

**Source:** `README.md` title · `docs/01-PRD.md §2`

---

## Slide 4 — Technical Approach

**Key message:** One async pipeline on open-source infrastructure turns raw events into explained alerts in under five seconds.

**Bullets (paste-ready):**

- **Architecture:** React 18 + TypeScript (ReactFlow graph, Zustand, Tailwind) ↔ **FastAPI / Python 3.11** (REST + WebSocket) ↔ **PostgreSQL 15** (source of truth, 18 tables) + **Redis 7** (event bus, pub/sub).
- **Graph service:** nodes `customer | account | employee`; edges `TRANSFER, ACCOUNT_HOLDER, EMPLOYEE_ACCESS, PROFILE_CHANGE, EMPLOYEE_ACTION`; **NetworkX in-memory adjacency** rebuilt ≤30 s and updated per event → 2-hop queries ≤500 ms p95.
- **Pipeline:** validate + persist (≤500/batch) → Redis Stream → worker: graph update → scope to **affected entity's sliding window** (O(affected), not O(total)) → run rules → evidence bundle → WS broadcast.
- **Detection (rules, not ML):** R-CIRC circular flow (3–6 cycle ≤72 h, ≥₹5L) · R-STRUCT structuring (≥3 just-under-threshold in 24 h vs baseline) · R-PROFILE_ROLE role/entitlement mismatch · R-PROFILE_FLOW edit-then-flow within 48 h · supporting R-VELOCITY / R-OFFHOURS / R-DORMANT.
- **Explainability contract:** each alert = `risk_factors[{name, raw_value, weight, contribution}]` + human-readable explanation + `evidence_refs`; **server asserts Σcontribution ≈ score/100 before persist**.
- **Evidence & casework:** snapshot-at-detect rows, alert → case → assign/notes/status → JSON+HTML export with **SHA-256 digest** recorded in DB; append-only audit log.
- **Security:** JWT (30 min/12 h), bcrypt, `require_role` RBAC, `tenant_id` on every table (cross-tenant read → 404), parameterized SQL, no secrets in repo.
- **Latency budget:** **≤5 s p95 / ≤2 s median** ingest → alert on every connected client (NFR-01).

**Visual:** the pipeline diagram from `docs/14 §5.3` (rebuild natively):

```
POST /v1/ingest/events → [Validate + Postgres insert 50–150ms]
   → [Redis Stream 5ms] → [Worker: graph 1–10ms → scope 1ms → rules 50–300ms → evidence 30ms]
   → [alerts:{tenant} 5ms] → [WS hub fan-out 10ms] → all clients   ══ ≤5 s p95
```

**Speaker notes (90 s):** Walk left-to-right on the diagram, spending time on one sentence only: *"rules run on the affected entity's window, not the whole dataset — that's why it's fast."* Then show the factor decomposition (one alert, 4 factors, summing to the score).

**Source:** `docs/02-TRD.md §1–§8` · `docs/05-BACKEND-SCHEMA.md` · `docs/14-ARCHITECTURE-AND-COMPONENTS.md §3, §5`

---

## Slide 5 — Feasibility & Viability

**Key message:** Commodity open-source stack, six phases, hard pass/fail targets — no exotic dependencies, no GPU, no broker ops.

**Bullets (paste-ready):**

- **Feasible with what exists:** pure open-source stack (FastAPI, PostgreSQL, Redis, NetworkX, React) — no graph database, no Kafka, no ML training, no cloud lock-in; runs as **4 Docker Compose services** on a laptop.
- **Build plan:** 6 phases (Foundation → Ingest/Timeline → Graph → Detection/Real-Time → Cases/Export → Scenarios/Hardening); a **48-hour cut** keeps M0–M4 + the evidence panel.
- **De-risked by design:**
  - Graph DB dropped → Postgres + in-memory adjacency, rebuild ≤30 s (ADR-001);
  - Kafka dropped → Redis Streams behind an `EventBus` interface, swappable later (ADR-005);
  - ML dropped → deterministic rules + factor decomposition, unit-testable (ADR-002).
- **Measurable exit criteria (viability):** detection **≥90%** on 5 planted scenarios · false positives **≤10%** on a 200-customer legitimate corpus · alert latency **≤5 s p95** · 2-hop query **≤500 ms p95** · **100%** of state changes audited.
- **Test evidence, not claims:** pytest unit (per rule, positive + negative controls) → integration (ingest→alert, tenant isolation) → scenario metrics runner → Vitest guard that the evidence panel is always present.
- **Operationally viable:** health endpoint, failed-batch replay, incident playbooks, one-command stack and seed (`docker compose up --build`, `scripts/seed.sh`) and demo runbook.
- **Team fit:** 4 roles (backend-ingest, backend-detection, frontend, QA/ops) map 1:1 to the phase plan.

**Visual:** three columns — *Stack feasibility* (logos: Python/Postgres/Redis/React) · *Build plan* (6-phase chevrons) · *Exit targets* (4 big numbers: ≥90% · ≤10% · ≤5 s · 100%).

**Speaker notes (60 s):** Lead with "nothing exotic" — judges fear unbuildable stacks. Then show the three ADR de-riskings as deliberate choices, and finish on the targets table: *"Every number here has a test that produces it."*

**Source:** `docs/06-IMPLEMENTATION-PLAN.md §2, §8` · `docs/10-TEST-STRATEGY.md` · `docs/13-ADR.md` · `docs/11-OPERATIONS-RUNBOOK.md`

---

## Slide 6 — Impacts & Benefits

**Key message:** Faster triage, defensible decisions, and — for the first time — the insider↔money connection in one screen.

**Bullets (paste-ready):**

- **For investigators (Priya):** one screen for graph, timeline, alert and evidence → triage in minutes instead of pivoting across tools; search <500 ms, 2-hop expand ≤500 ms.
- **For insider-risk analysts (Rahul):** every account/transaction change shows the **actor who made it**; profile-edit → downstream transfer correlation in a single view.
- **For compliance leads (Sneha):** case assignment, mandatory closure notes, full audit trail, and a **signed JSON/HTML evidence bundle** ready for SAR/STR-style review.
- **For regulators:** every score decomposable into weighted factors with frozen evidence (SHA-256) — **explainable by construction**, not explainable-after-the-fact.
- **For the business:** fewer false alarms (≤10% FP target) = less review waste; ≤5 s alerting = money still moveable before loss; dedup keys stop alert fatigue.
- **Organisational impact:** closes the gap between AML and insider-risk teams — one graph, one queue, one audit.
- **Open/extendable:** rule config is admin-tunable and versioned; `EventBus` interface allows Kafka scale-out; ML hook points defined for v2 (advisory-only, no auto-block in v1).

**Visual:** four persona cards (icon + role + one benefit line) on top; below, a single band: *"[Insider Risk] + [Financial Crime] → one investigation graph"*.

**Speaker notes (60 s):** Map each benefit to the persona who feels it, then land the regulatory line — *"we don't just claim explainability, the factor sum is asserted by the server before an alert can exist."*

**Source:** `docs/01-PRD.md §4, §5, §8` · `docs/08-SECURITY-AND-COMPLIANCE.md §10` · `docs/03-UIUX-DESIGN.md`

---

## Slide 7 — Research & References

**Key message:** Grounded in the challenge brief, regulatory expectations, established AML typologies and proven open-source foundations.

**Bullets (paste-ready):**

**A. Normative brief (primary source)**
1. Challenge problem statement + expected outcomes EO-1…EO-5 — `README.md`, `docs/01-PRD.md §1.1–1.4`.

**B. Regulatory & domain drivers** (background reading — cite by name, verify URLs before final submission)
2. FATF (Financial Action Task Force) — money-laundering typologies & guidance on new technologies in AML/CFT.
3. FinCEN (Financial Crimes Enforcement Network) — SAR/CTR reporting expectations and AML/CFT program guidance.
4. Reserve Bank of India — KYC Master Direction and risk-based supervision expectations.
5. OWASP — API Security Top 10 (2023) → drives authZ, tenant isolation, parameterized queries (`docs/08`).

**C. Prior art / problem framing**
6. Siloed AML vs. insider-risk monitoring as an industry-recognised blind spot (analyst/vendor literature on “insider-enabled money laundering”).
7. Explainability requirement in regulated decisioning — factors + evidence over single scores (aligned with our ADR-002/003).

**D. Technical foundations**
8. Martin Kleppmann, *Designing Data-Intensive Applications* (O’Reilly, 2017) — event streaming, storage/stream trade-offs (basis for ADR-005).
9. NetworkX documentation — cycle detection (`simple_cycles`), graph algorithms (basis for R-CIRC).
10. PostgreSQL 15 documentation — JSONB evidence, recursive CTEs; Redis documentation — Streams & pub/sub.
11. FastAPI documentation (async, WebSocket, OpenAPI) · React / ReactFlow documentation (interactive graph UI).

**E. Internal design corpus** (our own, available to judges)
12. `docs/01`–`docs/14`: PRD, TRD, UI/UX spec, app flow, backend schema, implementation plan, security/STRIDE, data dictionary, test strategy, runbook, demo script, ADRs, architecture/components.

**Visual:** 4-quadrant layout (Brief · Regulation · Prior art · Technology) with 2–3 short entries each; full numbered list in the speaker-notes/appendix.

**Speaker notes (30 s):** Don’t read the list. One line: *"Every choice on slide 4 traces to a numbered source here — the brief, FATF/FinCEN/RBI expectations, and the standard textbooks and docs for the stack."* Offer the full list as a handout/appendix.

**Source:** `README.md` · `docs/01-PRD.md §1.3` · `docs/08-SECURITY-AND-COMPLIANCE.md §10` · `docs/13-ADR.md`

---

## Pre-submission checklist

- [ ] All 7 slides present, in the required order (Problem → Abstract → Title → Technical → Feasibility → Impact → References).
- [ ] Slide 1 uses the **verbatim** problem statement wording.
- [ ] Every number on Slides 2/4/5 traces to PRD/TRD (or is labelled "target").
- [ ] Diagrams rebuilt natively in the deck (no ASCII screenshots).
- [ ] No secrets, real names of employers, or production data in screenshots.
- [ ] External references in Slide 7 verified (names + URLs) before submit.
- [ ] Demo fallback ready: `scripts/seed.sh` (recreates the demo loop) + `docs/12-DEMO-SCRIPT.md`.
