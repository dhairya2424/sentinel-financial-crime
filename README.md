# Sentinel — Financial Crime & Insider Risk Intelligence Platform

## Problem Statement (verbatim)

> Suspicious money transfers and unusual employee activity are often reviewed by separate teams, which can hide connections between insider privilege misuse and financial crime. Build an investigation platform linking **employees, access rights, customers, and transactions** to surface unusual patterns such as **circular transfers, transaction splitting to avoid attention, or profile mismatches** with **explainable, evidence-backed alerts**.

An investigation platform that links **employees, access rights, customers, and transactions** into a single money-flow graph and activity timeline, surfacing unusual patterns (circular transfers, transaction splitting to avoid attention / structuring, profile mismatches) as **explainable, evidence-backed alerts** — never an opaque single score.

## Documentation Index

| # | Document | Purpose |
|---|----------|---------|
| 1 | [PRD — Product Requirements](docs/01-PRD.md) | Problem, personas, user stories, functional & non-functional requirements, success metrics |
| 2 | [TRD — Technical Requirements](docs/02-TRD.md) | Architecture, stack, detection engine algorithms, real-time pipeline, API design, performance budgets |
| 3 | [UI/UX Design Spec](docs/03-UIUX-DESIGN.md) | Design system, screen-by-screen specs, evidence panel, graph interaction, accessibility |
| 4 | [App Flow](docs/04-APP-FLOW.md) | End-to-end user journeys, screen transitions, WebSocket event flows, state machines |
| 5 | [Backend Schema](docs/05-BACKEND-SCHEMA.md) | Full PostgreSQL DDL, indexes, graph model, API contracts, WebSocket protocol |
| 6 | [Implementation Plan](docs/06-IMPLEMENTATION-PLAN.md) | Repo structure, milestone acceptance criteria, test matrix, risks |
| 7 | [Phase Build Plan](docs/07-PHASE-BUILD-PLAN.md) | Execution-level checklist + copy-paste Claude prompts (P0–P5), exit gates, repair template |
| 8 | [Security & Compliance](docs/08-SECURITY-AND-COMPLIANCE.md) | Threat model (STRIDE), RBAC matrix, audit actions, evidence/export security, retention |
| 9 | [Data Dictionary & Glossary](docs/09-DATA-DICTIONARY.md) | Domain terms, table/field reference, frozen enums, risk-factor catalog |
| 10 | [Test Strategy & Case Catalog](docs/10-TEST-STRATEGY.md) | Test pyramid, T-*/S-* case IDs, metric definitions, perf budgets, exit mapping |
| 11 | [Operations Runbook](docs/11-OPERATIONS-RUNBOOK.md) | Commands, health signals, incident playbooks (INC-1..7), backup, deploy, demo-day checklist |
| 12 | [Demo Script](docs/12-DEMO-SCRIPT.md) | 5-minute judge script, run-of-show, Q&A, failure fallbacks |
| 13 | [Architecture Decision Records](docs/13-ADR.md) | ADR-001..012: graph store, rules-not-ML, evidence snapshots, bus, digest, etc. |
| 14 | [Architecture & Components (PPT Source)](docs/14-ARCHITECTURE-AND-COMPONENTS.md) | 16-slide deck outline, per-slide bullets + speaker notes, component inventories, diagrams, Q&A appendix |
| 15 | [7-Slide PPT Deck (Submission Format)](docs/15-PPT-7-SLIDE-DECK.md) | Problem · Abstract · Idea Title · Technical Approach · Feasibility · Impact · References — paste-ready content |

## Expected Outcomes (verbatim) → Where Delivered

Full traceability: [PRD §1.2–1.4](docs/01-PRD.md).

| ID | Expected Outcome (verbatim) | Delivered In |
|---|---|---|
| EO-1 | Builds a money-flow graph and activity timeline linking employee actions to account and transaction changes | Graph service (`TRD §5`, `docs/05 §4`), Graph Explorer (`docs/03 §5`), Activity Timeline with actor chips (`docs/03 §6`, PRD B2) |
| EO-2 | Produces explainable risk levels for connected anomalies rather than an opaque single score | Detection engine: per-anomaly risk bands + factor aggregation across shared entities (`TRD §4/§6`, `risk/explain.py`), factor table UI (`docs/03 §7`) |
| EO-3 | Supports case assignment and an evidence export for reviewers | Case module + export endpoints, JSON+HTML with SHA-256 digest (`TRD §8`, `docs/03 §8`, `docs/05 §6`) |
| EO-4 | Is tested on both suspicious and legitimate scenarios for detection accuracy and false positive rate | S1–S5 + L1–L20 scenario suite, metrics report: detection ≥90%, FP ≤10% (`docs/10 §6`, `TRD §9`) |
| EO-5 | Includes a mandatory evidence/explanation panel alongside every alert, not just a score | EvidencePanel always mounted, no dismiss API, Vitest-guarded (`docs/03 §7`, ADR-009, T-FE-01..05) |

## Quick Start (after implementation)

```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Sign in with `investigator@demo.dev` / `Demo!23456`, tenant `tenant_demo` (see docs/11 §2 for all four roles). If native PostgreSQL/Redis services already use ports 5432/6379, follow the host-port override in docs/11 §2.

Demo data: `python -m app.seed --scenario mixed` loads 50 customers, 30 employees, ~4,000 transactions containing planted suspicious patterns.
