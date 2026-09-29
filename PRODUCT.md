# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Confirmed by the user: current best versions rather than the docs' pins. React 19 + TypeScript, Vite 7,
Tailwind CSS 4, React Router 7, Zustand 5, Recharts 3, lucide-react; ReactFlow (@xyflow/react) 12 arrives
in P2. Backend is FastAPI + PostgreSQL 15 + Redis 7 (built in P0-A). Desktop-first, minimum 1280×800.

## Users
Primary (confirmed): bank and fintech investigators — AML / financial-crime analysts and insider-risk /
access-governance reviewers — working long, dense sessions triaging alerts, following money and employee
activity, and building cases. Platform roles: admin, manager, investigator, viewer.
Secondary: hackathon judges watching a 5-minute live demo (docs/12). They should see a credible working
tool, not a pitch page.

## Product Purpose
Sentinel is one investigation platform linking employees, access rights, customers and transactions, so
the connection between insider privilege misuse and financial crime stops falling between two teams. It
surfaces circular transfers, transaction splitting (structuring) and profile mismatches as explainable,
evidence-backed alerts. Success: an investigator goes from alert to "who did what, to whom, with what
access, and how the money moved" in two clicks, and can defend the decision to a regulator.

## Positioning
Insider activity and money movement in the same graph and timeline, with every alert carrying a
mandatory evidence and explanation panel: risk is always decomposed into weighted, human-readable
factors, never an opaque single score.

## Operating Context
Triage in an Alert Inbox, pivot to a Graph Explorer and Activity Timeline, then assign and export cases.
Live WebSocket updates (alerts arrive within about 5 s of an event). Regulators such as RBI, FinCEN and
FATF expect explainable monitoring. Judges see it on a laptop or projector during a timed demo.

## Capabilities and Constraints
- Frozen vocabulary (docs/09): risk bands low / medium / high / critical; rule codes R-CIRC, R-STRUCT,
  R-PROFILE_ROLE, R-PROFILE_FLOW, R-VELOCITY, R-OFFHOURS, R-DORMANT; id prefixes cust_/acct_/emp_/tx_/act_.
- The evidence panel can never be hidden or dismissed (ADR-009).
- The viewer role is read-only; the UI may hide mutations, but the backend is authoritative.
- Routes (docs/04 §1): /login, /, /alerts, /alerts/:id, /cases, /cases/:id, /graph, /timeline/:type/:id, /add (admin and investigator),
  /admin/rules (admin only).
- Undecided: the full mobile layout (v1 is desktop-first).

## Brand Commitments
Name: Sentinel (final). The team will provide a logo file; leave a slot for it and never invent a
substitute mark. docs/03 §2 holds the team's colour and type tokens: dark surfaces, a sky-blue brand
accent, risk colours, a violet evidence accent, Inter + JetBrains Mono.

## Evidence on Hand
Real data only (confirmed by the user): records are entered through the Add data screen or the ingest
API. The single deliberate fixture is the planted demo loop in tenant_demo (tx_demo_loop_1..3 across
XXXXXXXX1158 → 5082 → 8018 and their three holders), kept so the cycle detection can be shown. The
synthetic corpus was removed; never add seed or placeholder records, testimonials or metrics.
Detection and false-positive numbers come only from the scenario metrics runner (docs/10 §6).

## Product Principles
1. Evidence first, score second: the explanation and the records lead; the band is a label.
2. Investigator speed: two clicks from any alert to its graph and timeline context.
3. Linked everything: every entity is a chip that navigates to its context.
4. Real-time honesty: live state is always visible, and stale data is never shown silently.

## Accessibility & Inclusion
WCAG 2.1 AA contrast; colour is never the only signal (risk shows icon + text + colour); visible 2px
focus rings; keyboard triage; prefers-reduced-motion respected (docs/03 §12).
