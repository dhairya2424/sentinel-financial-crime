# 13 — Architecture Decision Records (ADRs)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Format:** Nygard-style, status ∈ {Accepted, Superseded by ADR-xxx, Deprecated}
**Change rule:** a new ADR is required before contradicting an Accepted decision (aligns with docs/07 Change Control).

---

## ADR-001: PostgreSQL + in-memory NetworkX instead of a graph database

**Status:** Accepted | **Date:** v1 planning

**Context:** The money-flow graph needs 2-hop neighbor queries, cycle detection (R-CIRC), and incremental updates from a live event stream. A dedicated graph DB (Neo4j, Nebula) offers richer traversal but adds a service, ops burden, and a second source of truth.

**Decision:** PostgreSQL remains the source of truth for all entities. A Graph Service holds per-tenant `networkx.MultiDiGraph` adjacency in process memory, rebuilt at startup (≤30s budget) and updated incrementally from pipeline events.

**Consequences:**
- ✅ One datastore to migrate, back up, and secure; cycles via `networkx.simple_cycles` limited to len 3–6 are trivial at ≤100k edges.
- ✅ Startup rebuild is the single repair path for graph drift (Runbook INC-3).
- ❌ Graph state not shared across API replicas — v1 runs a single API process; multi-replica requires sticky routing or moving adjacency to Redis (see ADR-006).
- **Rejected alternative:** Neo4j — richer traversal not needed at scale; dual-write consistency risk.

---

## ADR-002: Rule-based detection with factor decomposition (no ML score in v1)

**Status:** Accepted | **Date:** v1 planning

**Context:** The problem statement (PRD §1.1) demands *explainable, evidence-backed alerts* and EO-2/EO-5 forbid an opaque single score / score-only views — an opaque model score conflicts with PRD C4/C5 and regulator-challenge expectations.

**Decision:** v1 detects with deterministic rules (R-CIRC, R-STRUCT, R-PROFILE, supporting) emitting named factors with weights and raw values; composite score = Σ contributions with a server-side invariant. ML explicitly listed as non-goal (PRD §3).

**Consequences:**
- ✅ Every alert explains itself; unit tests assert exact scores; tuning is auditable via `rules` versioning.
- ✅ Demo can walk factor math live (docs/12 §3).
- ❌ Novel typologies beyond rule coverage missed until rules added.
- **Future path:** ML outputs may enter as *additional factors* with their own explanation strings — never as a replacement for decomposition.

---

## ADR-003: Rule-based banding thresholds frozen: low <40, medium 40–69, high 70–84, critical ≥85

**Status:** Accepted | **Date:** v1 planning (supersedes PRD F-08 draft "40–69 / 60–84" ambiguity — PRD defers to TRD)

**Context:** PRD F-08 initially sketched overlapping drafts; UI colors, filter chips, and scenario pass criteria all need one normative mapping.

**Decision:** Single mapping in `risk/explain.py` per docs/02 §4; documented in docs/09 §3. Changing bands is a Change-Control event (docs/07).

**Consequences:** frontend RiskBadge, metrics S1–5 expectations, and tests (T-RISK-01) all bind to these edges.

---

## ADR-004: Evidence snapshots frozen at alert time (copy-on-detect)

**Status:** Accepted | **Date:** v1 planning

**Context:** Evidence must survive source-row updates and support export after case closure. Live joins would show *current* state, not the state that triggered the alert.

**Decision:** On alert persist (same DB transaction), copy each evidence source row JSON into `alert_evidence.snapshot`. Exports and EvidencePanel read snapshots only.

**Consequences:**
- ✅ Tamper-evidence story (with case digest); panel renders even if source mutated; export stable.
- ❌ Storage duplication — acceptable; retention per docs/08 §8.
- ❌ Snapshot schema must track source migrations — migration checklist item.

---

## ADR-005: Redis Streams + pub/sub as the event bus (not Kafka)

**Status:** Accepted | **Date:** v1 planning

**Context:** Pipeline needs durable buffer, consumer-group semantics, and WS fan-out. Kafka is the industry default but requires cluster ops disproportionate to v1 scale.

**Decision:** Ingest XADDs to `events` stream; pipeline uses consumer group; alert/dashboard fan-out via pub/sub channels. An `EventBus` interface keeps the door open for Kafka.

**Consequences:**
- ✅ Already-required Redis doubles as bus; at-least-once + idempotent alert dedup (`dedup_key`) handles replays.
- ❌ Streams lose data if Redis volume destroyed and not AOF-persisted — PG remains source of truth; replay via re-ingest (Runbook §6).
- **Rejected:** Kafka (ops), in-proc queue only (loses events on restart).

---

## ADR-006: Single-node API process for v1 (stateful graph + consumer colocated)

**Status:** Accepted | **Date:** v1 planning

**Context:** In-memory graph (ADR-001) and stream consumer are process-local state. Horizontal scaling would duplicate consumers and fragment graph state.

**Decision:** One API/worker process in v1; scale vertically. Horizontal path documented: move adjacency to Redis Graph-ish structures or rebuild-per-shard, partition stream by `tenant_id`.

**Consequences:** NFR-04 (50 users) is the design target; multi-replica is explicitly post-v1 (Runbook §9).

---

## ADR-007: Bilingual alert codes — R-PROFILE split into R-PROFILE_ROLE / R-PROFILE_FLOW

**Status:** Accepted | **Date:** P3-A implementation

**Context:** PRD C3 describes two insider patterns (role mismatch vs edit-then-flow) with different reviewers' mental models and different evidence sets.

**Decision:** One module `r_profile.py`, two alertable rule codes, shared factors catalog entry (docs/09 §4).

**Consequences:** inbox filters and scenario expectations (S3 vs S4) can target each precisely.

---

## ADR-008: Export digest excludes `generated_at`

**Status:** Accepted | **Date:** P4-A

**Context:** Tamper-evidence digest must be stable across repeated exports of unchanged case data; timestamps would always differ.

**Decision:** SHA-256 over canonical JSON (sort_keys) of case/alerts/evidence/graph/timeline/notes/audit — excluding `generated_at` and the digest field itself. Recorded on `cases.export_digest`.

**Consequences:** T-INT-15 asserts re-export digest equality; regenerated exports after note-add legitimately change digest.

---

## ADR-009: Frontend EvidencePanel has no dismiss API by construction

**Status:** Accepted | **Date:** P3-C

**Context:** PRD C4 requires evidence never be hideable; a prop like `showEvidence` would let future code create score-only views.

**Decision:** `EvidencePanel` exposes no visibility props; always mounted in AlertDetail; Vitest asserts testid presence in all states and absence of dismiss elements (T-FE-01..05).

**Consequences:** UI refactor that mounts AlertDetail without panel must update tests — intentional friction.

---

## ADR-010: ID strategy — human-readable prefixed ULIDs

**Status:** Accepted | **Date:** P0

**Context:** Evidence exports, judge demos, and support logs read better with typed ids than bare UUIDs.

**Decision:** `cust_`, `acct_`, `tx_`, `emp_`, `act_`, `alert_`, `case_` + time-sortable ULID body (docs/05 §1). Idempotent ingest keys are client-supplied event ids.

**Consequences:** type inference in graph routes by prefix; sortability aids cursor pagination.

---

## ADR-011: Tenant mismatch returns 404 (not 403) on reads

**Status:** Accepted | **Date:** P1

**Context:** 403 confirms existence of a resource to a foreign tenant — an info oracle.

**Decision:** All tenant-scoped reads return 404 when the row belongs to another tenant (docs/05 §7, T-AUTH-05). 403 reserved for role failures within the correct tenant.

**Consequences:** debugging cross-tenant bugs needs server logs, not response codes — accepted trade.

---

## ADR-012: Demo credentials with fixed password in repo seeds

**Status:** Superseded by ADR-013 (password value only) | **Date:** P0 | **Review before any shared deployment**

**Context:** Judges and teammates need zero-friction login.

**Decision:** `app.seed.users` creates `*@demo.dev` / `Demo!2345` under `tenant_demo`; flagged in Runbook §1 as dev/demo only; production path requires password policy + secret-provisioned users (docs/08 §3).

**Consequences:** gitleaks does not flag bcrypt hashes; compose `ENV=production` refuses default JWT secret — combo prevents accidental prod reuse.

---

## ADR-013: Auth libraries and a policy-compliant demo password

**Status:** Accepted | **Date:** 2026-09-27 (P0-A build) | **Supersedes:** ADR-012 password value; TRD §2 auth row

**Context:** Building P0-A exposed three problems. (1) `passlib` has been unmaintained since 2020 and crashes on `bcrypt` 5, so it only worked by pinning `bcrypt==4.0.1`. (2) `python-jose` is thinly maintained with a CVE history; PyJWT is the actively maintained choice and FastAPI's own docs use it. (3) ADR-012's `Demo!2345` is 9 characters, violating the docs/08 §3 policy (≥10 chars) that must hold "at seeding", which would force a policy bypass in code.

**Decision:** Use `PyJWT` for tokens and `bcrypt>=5` directly (cost 12) for hashing. The demo password becomes `Demo!23456`, so one password policy applies to every path with no exemption. Passwords over 72 bytes (bcrypt's hard limit) are rejected by the policy, and an overlong login attempt is a normal 401. Access and refresh tokens carry exactly the docs/08 §3 claims; refresh tokens are signed with a key derived from `JWT_SECRET`, so a refresh token can never be replayed as an access token. `app.seed.users` refuses to run when `ENV=production`.

**Consequences:** + no pinned-old dependencies, no bypass code path, token-type confusion impossible. − demo scripts must use the new password (Runbook §2 updated). Rejected: keeping passlib on old bcrypt (dead dependency), and exempting the seed from the policy (a bypass code path that could leak into prod).

---

## ADR-014: Frontend stack, light + dark themes, and a live status strip

**Status:** Accepted | **Date:** 2026-09-28 (P0-B build) | **Supersedes:** TRD §2 frontend rows; docs/03 §1.5 "dark-mode-first"

**Context:** The docs pinned React 18, Vite 5, Tailwind 3.4, Zustand 4 and Recharts 2, all a major version behind at build time, and described the UI as dark-mode-first. The primary users work long sessions in lit offices, and the demo runs on projectors, where dark interfaces wash out. The shell also needed a way to make docs/03 Principle 4 (real-time honesty) visible before any WebSocket exists.

**Decision:** Use React 19.3, Vite 8, Tailwind 4 (tokens as CSS `@theme` variables), React Router 8, Zustand 5, Recharts 3, Vitest 5 and ESLint 10. TypeScript is held at 6.0.x because typescript-eslint supports only `<6.1`. Ship light and dark themes from one semantic token layer: the docs/03 §2 palette is the dark theme (muted text lifted to #7D8CA1 for 4.5:1 on surface-900), and the light theme keeps the same hues darkened to pass AA on white. The theme follows the OS by default and has a System/Light/Dark switch in the account menu, applied before first paint. The shell adds a permanent status strip ("Live console" direction, chosen by the user from three rendered options) that reads real API/DB/Redis health from `/v1/ops/health`, plus a banner when the API is unreachable; event and pipeline figures join it in P3. The sidebar folds to a 64px rail below 1024px and on ⌘/Ctrl+B. Fonts are self-hosted (@fontsource) so the demo does not depend on external font servers.

**Consequences:** + current, supported dependencies; readable on projectors; connection state always visible. − two themes double visual QA. Rejected: dark-only (poor in bright rooms and on projectors); TypeScript 7 (breaks linting today).

---

## ADR-015: Detection refinements found while implementing P3-A

**Status:** Accepted | **Date:** 2026-09-28 (P3-A build) | **Refines:** TRD §4.1–4.5; fixes docs/10 T-STRUCT-05 fixture

**Context:** Implementing the rules exactly as written exposed ambiguities and one contradiction.

**Decision:**
1. **R-CIRC time order.** A loop counts only if one transfer per edge can be chosen so money moves A→B→C→A in time order (earliest-feasible legs, minimum span). Unordered legs cannot be a circular flow; accepting them inflates false positives.
2. **R-STRUCT sliding window + per-window baseline.** Bursts are evaluated in a sliding 24 h window per sending customer (calendar buckets are defeated by straddling midnight). "3× baseline count" compares against the customer's mean count per window (30-day count ÷ 30). Comparing against the raw 30-day count would make the rule blind for any active customer. docs/10 T-STRUCT-05 used 10/30d, which under this reading is a textbook burst (12×), so its fixture is now 300/30d.
3. **Action names follow docs/09.** The limit-change action is `limit.change` (the enum), not `profile.limit_change` as the P3-A prompt wrote.
4. **Overflow scaling.** Max-merged factors across connected hits can exceed 1.0; contributions are scaled proportionally (not clamped) so Σ contribution = score/100 always holds and no factor disappears.
5. **Factor normalisations** (all visible in raw values): linkage_depth 3→1.0 … 6→0.7 (a tighter loop returns funds faster); amount = log10(total/p95) of other window transfers, 'no baseline' 0.5 below 5 samples; account_velocity = log10(loop rate / 30-day hourly baseline); sub_threshold_ratio = in-band share of value; total_amount = (total/T − 1.5)/4.5; destination_spread = beneficiaries/5; role-mismatch temporal_proximity measures time since the entitlement was revoked ('no grant on record' 0.5).

**Consequences:** + fewer false positives on R-CIRC, no midnight evasion on R-STRUCT, and the invariant is provable for every alert. Planted S1/S2/S3 score High and S4 scores Critical, matching docs/06 §7. − factor normalisations are new tunables; they live in code and are covered by T-DET/T-STRUCT/T-PROF assertions.

---

## Template for new ADRs

```markdown
## ADR-0NN: <title>
**Status:** Proposed | Accepted | Superseded by ADR-0xx
**Date:** YYYY-MM-DD
**Context:** <forces and constraints>
**Decision:** <what we will do>
**Consequences:** <+/- and rejected alternatives>
```
