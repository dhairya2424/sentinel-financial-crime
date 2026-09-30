# 01 — Product Requirements Document (PRD)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Status:** Approved for build | **Owner:** Hackathon Team
**Normative source:** problem statement + expected outcomes in §1.1–§1.2 are verbatim from the challenge brief; if any other doc paraphrases them differently, §1.1–§1.4 win.

---

## 1. Problem Statement

### 1.1 Normative statement (verbatim — source of truth)

> Suspicious money transfers and unusual employee activity are often reviewed by separate teams, which can hide connections between insider privilege misuse and financial crime. Build an investigation platform linking **employees, access rights, customers, and transactions** to surface unusual patterns such as **circular transfers, transaction splitting to avoid attention, or profile mismatches** with **explainable, evidence-backed alerts**.

### 1.2 Expected outcomes (verbatim — source of truth)

| ID | Expected outcome (verbatim) |
|---|---|
| **EO-1** | Builds a money-flow graph and activity timeline linking employee actions to account and transaction changes. |
| **EO-2** | Produces explainable risk levels for connected anomalies rather than an opaque single score. |
| **EO-3** | Supports case assignment and an evidence export for reviewers. |
| **EO-4** | Is tested on both suspicious and legitimate scenarios for detection accuracy and false positive rate. |
| **EO-5** | Includes a mandatory evidence/explanation panel alongside every alert, not just a score. |

### 1.3 Analysis

Banks and fintechs run two parallel review functions that rarely talk to each other (the "separate teams" problem above):

1. **Financial crime / AML teams** — review suspicious money transfers (circular flows, transaction splitting to avoid attention / structuring, rapid pass-through).
2. **Insider risk / access governance teams** — review unusual employee activity (off-hours access, privilege escalation, data changes to customer accounts).

Because these reviews happen in separate tools with separate data, connections between **insider privilege misuse and financial crime** are hidden:

- An employee who **modified a customer's profile** (e.g., changed limits, added a beneficiary) and then **that customer executes suspicious transfers** is invisible.
- An employee with **excessive access rights** performing transactions **outside their role** (e.g., an ops analyst moving funds) is invisible.
- Transaction splitting to avoid attention (amounts just under thresholds) looks like ordinary low-value transfers unless correlated across accounts and time.

**Consequence:** Regulatory penalties, undetected fraud rings, insider abuse. Regulators (RBI, FinCEN, FATF) increasingly demand *explainable* monitoring — a single opaque risk score is not defensible.

### 1.4 Expected-outcome traceability (normative — every EO must be provable)

| EO | Verbatim outcome | Delivered by (requirements) | Proven by |
|---|---|---|---|
| **EO-1** | Money-flow graph + activity timeline linking employee actions to account and transaction changes | G1, G2; stories A1–A3, B1–B2; F-05, F-06; graph model docs/05 §4 (EMPLOYEE_ACCESS, PROFILE_CHANGE, EMPLOYEE_ACTION edges); timeline actor chips (B2) | T-GRPH-01..06, T-INT-09, T-FE-08..11; demo docs/12 §4 |
| **EO-2** | Explainable risk levels for connected anomalies, not an opaque single score | G6; stories C5; F-08; risk/explain factor aggregation across hits on shared entities (`aggregate_factors` max-merge — connected anomalies); bands per ADR-003 | T-RISK-01..05; invariant Σcontrib=score (docs/05 §7); demo docs/12 §3 |
| **EO-3** | Case assignment and an evidence export for reviewers | G4; stories D1–D3; F-10, F-11; export JSON+HTML w/ SHA-256 digest | T-INT-11..16, T-INT-18; demo docs/12 §5 |
| **EO-4** | Tested on suspicious and legitimate scenarios for detection accuracy and false positive rate | F-12; NFR-05 (≥90% detection), NFR-06 (≤10% FP) | S1–S5 + L1–L20 corpus, metrics runner (docs/10 §6); demo docs/12 §6 |
| **EO-5** | Mandatory evidence/explanation panel alongside every alert, not just a score | C4; F-09; EvidencePanel always-mounted contract (ADR-009); server requires explanation + risk_factors non-null | T-FE-01..05; threat T6 (docs/08 §2); demo docs/12 §3 block 3 |

**Rule:** no phase gate may close if any EO row lacks its "Proven by" evidence. README Hackathon Mapping and PRD §8 must stay consistent with this table.

## 2. Vision

A single platform where an investigator opens one screen and sees **who did what, to whom, with what access, and how money moved** — with every alert carrying a mandatory, evidence-backed explanation panel (rule name, contributing factors, linked entities, raw evidence records) and connected anomalies aggregated into **risk bands (Low / Medium / High / Critical) with per-factor breakdown**, not one black-box number.

## 3. Goals & Non-Goals (v1)

### Goals
- G1: Unified money-flow graph (accounts, customers, employees as nodes; transfers/links as edges).
- G2: Unified activity timeline (every employee action — logins, profile edits, transaction approvals — correlated to account/transaction changes).
- G3: Detection engine with 3 mandatory pattern families + 3 supporting rules, each producing explainable risk.
- G4: Case management — assign, annotate, status-track, export evidence.
- G5: Real-time ingestion → detection → alert within seconds of an event.
- G6: Zero opaque scores — every risk number is decomposed into weighted, human-readable factors.

### Non-Goals (v1)
- ML model training on bank production data (rule-based + statistical scoring only; ML hook points defined for v2).
- Automated blocking/halting of transactions (advisory alerts only — flagged as v2).
- Regulatory report filing automation (e.g., SAR/STR generation) — export-only in v1.
- Mobile app.

## 4. Personas

| Persona | Role | Needs |
|---|---|---|
| **Priya — AML Investigator** | Reviews transaction alerts | Money-flow graph, structuring detection, evidence export, fast triage |
| **Rahul — Insider Risk Analyst** | Reviews employee behavior | Activity timeline, access-rights view, profile-mismatch alerts |
| **Sneha — Compliance Manager / Team Lead** | Assigns & supervises cases | Case queue, assignment, risk overview dashboard, audit of decisions |
| **Dev — Platform Admin (ops)** | Runs the platform | Tenant/user provisioning, ingestion health, rule configuration |

## 5. User Stories (with acceptance criteria)

### Epic A — Money-Flow Graph
- **A1:** As Priya, I can search any customer/account/employee by ID or name and see them as a node in an interactive graph.
  - *AC:* Search returns results < 500 ms (p95); node click opens side panel with entity summary + linked risk.
- **A2:** As Priya, I can expand a node to 1-hop/2-hop neighbors and filter edges by type (transfer, account-holder, employee-access, profile-change).
  - *AC:* Expansion is incremental (no full re-render); filters apply instantly client-side.
- **A3:** As Priya, I can see cycle-closed loops highlighted when the selected subgraph contains a circular transfer pattern.
  - *AC:* Edges participating in a detected cycle render in warning color with a "Cycle" badge.

### Epic B — Activity Timeline
- **B1:** As Rahul, I can open an employee or customer and see a unified chronological timeline of all actions affecting them.
  - *AC:* Timeline merges employee actions (login, profile edit, tx approval) and customer/account events, interleaved by timestamp, newest first.
- **B2:** As Rahul, I can see which employee performed a change on an account or transaction record directly on the timeline.
  - *AC:* Every account/transaction-change event shows actor (employee ID + name) if the action was performed by an employee session.

### Epic C — Detection & Explainable Alerts
- **C1:** As Priya, I receive alerts when a customer's transfers form a **circular flow** (money returns to origin within a window).
  - *AC:* Alert includes: pattern name, cycle path (ordered nodes), total amount, time window, evidence records (raw transactions), risk band + factor breakdown.
- **C2:** As Priya, I receive alerts when transfers are **structured/split to avoid attention** (transaction splitting to stay under a reporting threshold).
  - *AC:* Alert includes: threshold value, transaction list with amounts + timestamps, count vs. baseline behavior, evidence records. *(serves EO-4 pattern family)*
- **C3:** As Rahul, I receive alerts on **profile mismatches**: employee with access rights/role inconsistent with the action performed (e.g., employee outside finance executes high-value transfer approval; employee edits account then linked transfers follow).
  - *AC:* Alert includes: employee role/access list, the anomalous action, mismatch rationale, correlation to downstream transactions, evidence records.
- **C4:** As any reviewer, **every alert I open shows an evidence panel by default** — mandatory evidence/explanation panel alongside every alert, **not just a score**; I cannot view only a score. *(EO-5)*
  - *AC:* Evidence panel renders alongside/below the alert summary; the alert detail view has no "score-only" state; if evidence is missing the panel shows an explicit "Evidence unavailable — data retention issue" error state.
- **C5:** As Priya, I see a **factor breakdown** (weighted contributions: amount anomaly, velocity, linkage depth, temporal proximity, access anomaly) behind each risk band.
  - *AC:* Each factor shows its raw value, weight, and normalized contribution summing to the composite risk score.

### Epic D — Case Management
- **D1:** As Sneha, I can assign an alert (or a group of linked alerts) to an investigator as a **case** with priority.
  - *AC:* Assignment updates in real time on the assignee's queue (WebSocket); linked alerts grouped by shared entities option available.
- **D2:** As an investigator, I can change case status (Open → In Review → Escalated → Closed-Confirmed / Closed-False-Positive) and add disposition notes.
  - *AC:* Status changes are audited (who, when, from→to); notes are mandatory on closure.
- **D3:** As an investigator, I can **export case evidence** as a JSON bundle (and printable HTML report) containing all evidence records, graph snapshot, timeline, and decision history.
  - *AC:* Export generates within 5 s for cases with ≤ 500 evidence records; file includes case ID, timestamps, and generating user.

### Epic E — Dashboard & Operations
- **E1:** As Sneha, I see a risk overview: open cases by severity, alerts in last 24 h, top-linked entities, ingestion health.
  - *AC:* Dashboard refreshes in real time via WebSocket.
- **E2:** As Dev, I can view ingestion health (events/min, lag, failures) and re-play a failed batch.
  - *AC:* Health endpoint reflects actual pipeline counters; failed batches visible with re-drive action.

## 6. Functional Requirements Summary

| ID | Requirement | Priority |
|---|---|---|
| F-01 | Multi-tenant data isolation (tenant_id on every table, enforced at query layer) | Must |
| F-02 | JWT auth, role-based access (admin, manager, investigator, viewer) | Must |
| F-03 | Ingest endpoints for: transactions, employee activity events, access-rights changes, profile changes (batch + single) | Must |
| F-04 | Real-time pipeline: ingest → persist → graph update → detection → alert + WebSocket broadcast ≤ 5 s (p95) | Must |
| F-05 | Money-flow graph service (build, incremental update, neighbor query, cycle highlighting) | Must |
| F-06 | Unified activity timeline API (cross-entity merge) | Must |
| F-07 | Detection engine: circular transfer, structuring, profile mismatch + supporting rules (velocity, off-hours access, dormant reactivation) | Must |
| F-08 | Explainable risk model: factor extraction, weights, banding (Low <40, Medium 40–69, High 70–84, Critical ≥85 — bands finalized in TRD) | Must |
| F-09 | Alert lifecycle: open → acknowledged → linked-to-case → resolved; dedup of repeat alerts for same pattern/entity window | Must |
| F-10 | Case module with assignment, status, notes, audit trail | Must |
| F-11 | Evidence export: JSON + HTML | Must |
| F-12 | Scenario seeding for demo/testing (suspicious, legitimate, mixed datasets) | Must |
| F-13 | Rule configuration (thresholds, weights, windows) editable by admin; changes versioned | Should — *as built:* `GET/PUT /v1/rules` (validated, versioned, audited, loaded by detection); the `/admin/rules` screen is a placeholder |
| F-14 | Full audit log of platform actions | Must |

## 7. Non-Functional Requirements

| ID | NFR | Target |
|---|---|---|
| NFR-01 | Real-time latency (ingest → alert broadcast) | ≤ 5 s p95, ≤ 2 s median |
| NFR-02 | Graph neighbor query (2-hop) | ≤ 500 ms p95 for 10k-node neighborhood |
| NFR-03 | Dashboard/search API latency | ≤ 300 ms p95 |
| NFR-04 | Concurrent users | 50 without degradation (hackathon scale; design supports horizontal scale) |
| NFR-05 | Detection accuracy on seeded scenarios | ≥ 90% of planted suspicious patterns detected |
| NFR-06 | False positive rate on legitimate scenarios | ≤ 10% of legitimate entities alerted |
| NFR-07 | Audit completeness | 100% of state-changing actions logged |
| NFR-08 | Security | JWT expiry, tenant isolation, parameterized queries, no secrets in repo |
| NFR-09 | Availability | Single-node deploy acceptable for demo; stateless API design allows restart without data loss |

## 8. Success Metrics (Hackathon Judging Alignment)

Each metric proves one expected outcome (EO IDs per §1.2):

1. **EO-1 — Connection demo:** money-flow graph + activity timeline show employee profile-edit → downstream suspicious transfers correlation. *(Epic A/B; T-GRPH, T-INT-09)*
2. **EO-2 — Explainability demo:** open any alert → risk-band factor breakdown (weighted contributions summing to composite); zero opaque/single-score views. *(C5, F-08; T-RISK-\*)*
3. **EO-3 — Case demo:** assign → investigate → export evidence bundle (JSON+HTML, digest recorded). *(Epic D; T-INT-11..16)*
4. **EO-4 — Accuracy demo:** plant 5 suspicious scenarios → ≥90% detected with evidence; run legitimate corpus → FP ≤10% with rationale for any hits. *(NFR-05/06; S1–S5, L1–L20)*
5. **EO-5 — Mandatory panel demo:** every alert detail shows the evidence/explanation panel alongside the score — attempt to find a score-only view and fail. *(C4; T-FE-01..05)*
