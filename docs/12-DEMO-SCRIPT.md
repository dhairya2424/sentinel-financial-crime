# 12 — Demo Script (Judge-Facing)

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Duration:** 5 minutes core + 2 minutes buffer | **Presenter:** 1 driver + 1 narrator
**Setup:** complete Runbook §10 demo-day checklist before judges arrive.

---

## 0. Opening Line (20s)

> "Suspicious transfers and unusual employee activity usually sit with separate teams — and the connections between insider privilege misuse and financial crime go missing. Sentinel is one investigation platform: employees, access rights, customers, and transactions in a single money-flow graph and timeline, with explainable, evidence-backed alerts — no opaque scores."

**On screen:** `/login` → sign in as `investigator@demo.dev` (already filled) → Dashboard.

## 1. The Problem in One Screen (30s)

Show Dashboard: KPI cards (open cases, critical 24h, FP rate), "Live" badge pulsing.

Narrator: *"Everything you'll see is live — WebSocket-fed, sub-5-second from transaction to alert."*

## 2. Live Plant → Real-Time Alert (60s) ★ wow moment

| Step | Action | Say |
|---|---|---|
| 1 | Open second terminal, run `python -m app.seed.suspicious --only S1` | "I'm planting a classic circular scheme now — ₹6 lakh looping through three accounts in four hours." |
| 2 | Stay on Alert Inbox (`/alerts`) — do NOT refresh | "Watch the inbox…" |
| 3 | New `R-CIRC` row appears with highlight | "…alert arrived in under 5 seconds with no page reload. Detection window, not batch overnight." |

**If alert is slow/missed (venue risk):** fall back — pre-open the S1 alert from earlier seed (`/alerts?rule=R-CIRC`), narrate as "here's what just fired in our pre-seeded run."

## 3. Explainability Tour (75s) ★ mandatory outcome

Click the R-CIRC alert (or pre-opened one). Point at **each block** in order (docs/03 §7):

1. **Explanation prose** — "₹4.2L moved in a loop: A-1 → A-7 → A-9 → A-1…"
2. **Risk factors table** — "Not one number: four weighted factors. Amount vs p95 = 4.2× contributes 35%, temporal proximity 25%… they sum to the composite — the band is derived, never hidden."
3. **Evidence panel (right)** — "Mandatory. It cannot be dismissed — try to find a score-only view; there isn't one in the product." Click a transaction row → raw JSON drawer.
4. **Inline mini-graph** — cycle edges amber with `Cycle ×3` badge.
5. **Acknowledge** — status flips, audited.

> Judge line: *"Regulators ask 'why' — this panel is the answer, attached to every alert by design."*

## 4. Insider → Money Connection (75s) ★ core problem statement

Open the R-PROFILE alert (from S3/S4 seed) or navigate: **employee chip → Timeline**.

| Beat | Show | Say |
|---|---|---|
| a | Timeline of employee `emp_*`: 03:12 off-hours login, 03:14 `limit.change`, then approvals — each row has the **actor chip** | "This is what AML never sees today: the employee's night-shift profile edit, timestamped." |
| b | Click target customer chip → **Graph Explorer** (`?node=cust_*`) | "Follow the money from that customer…" |
| c | Toggle **Highlight cycles** | "…to the loop the edit enabled. Two teams' data, one investigation surface." |
| d | Side panel shows employee-access edges + risk ring | "Access rights, actions, and transfers — same graph." |

## 5. Case Assignment + Evidence Export (60s)

1. From alert → **[→Case]** → checkbox *group linked alerts by shared entities* → create.
2. Case detail: add note, set **In Review** (show valid-transition dropdown).
3. **Switch browser profile to `manager@demo.dev`** (or second window) → case card **moves live** on assign → assign to investigator → first window updates via WS without refresh.
4. Close as False Positive? No — keep open; click **Export JSON** → open file → scroll to `risk_factors`, `evidence`, `graph_snapshot`, `digest_sha256`.

> "Reviewer gets the whole decision trail — tamper-evident digest included — for the case file."

## 6. Accuracy Story (45s, may be slides instead)

Open terminal, run:

```bash
pytest tests/scenarios -q --metrics
```

Paste real output — expected shape:

```
detection_rate: 5/5 (100%)   [target >=90%] PASS
false_positive_rate: X%      [target <=10%] PASS
alert_latency_p95_ms: NNNN   [target <=5000] PASS
```

> "Five planted typologies caught, legitimate 90-day corpus kept quiet — accuracy and false-positive rate are part of the deliverable, not a claim."

## 7. Close (20s)

> "Sentinel: a money-flow graph and activity timeline that link insider privilege to financial crime, explainable risk bands with factor decomposition instead of a black box, case workflow with evidence export — and a test suite proving detection rate and false-positive rate."

## Expected-Outcome Checklist (say or show before/at close)

| ID | Outcome (verbatim) | Demonstrated at |
|---|---|---|
| EO-1 | Builds a money-flow graph and activity timeline linking employee actions to account and transaction changes | §4 (timeline actor chips → graph cycles) |
| EO-2 | Produces explainable risk levels for connected anomalies rather than an opaque single score | §3 block 2 (factor table sums to band) |
| EO-3 | Supports case assignment and an evidence export for reviewers | §5 (assign across sessions + export digest) |
| EO-4 | Is tested on both suspicious and legitimate scenarios for detection accuracy and false positive rate | §6 (metrics report PASS) |
| EO-5 | Includes a mandatory evidence/explanation panel alongside every alert, not just a score | §3 block 3 (panel cannot be dismissed) |

---

## Run-of-Show Table (driver cheat sheet)

| T+ | Screen | Key action | Narrator line |
|---|---|---|---|
| 0:00 | Login → Dashboard | login | problem framing |
| 0:20 | Dashboard | live badge | real-time claim |
| 0:50 | Terminal + /alerts | plant S1, watch WS | live detection wow |
| 1:50 | AlertDetail | walk 5 blocks | explainability mandatory |
| 3:05 | Timeline → Graph | insider link, cycles | connection outcome |
| 3:45 | Case → Export | assign across 2 sessions, export digest | workflow + evidence |
| 4:45 | Terminal | metrics report | accuracy + FP |
| 5:30 | Any | closing line | wrap |

## Q&A Prepared Answers

| Question | Answer |
|---|---|
| Why not an ML score? | Regulators must challenge decisions; we decompose into weighted factors with raw values (docs/02 §4.5) — v2 can add ML *as additional factors*, still decomposed. |
| How is this real-time? | Ingest commits to PG then Redis Stream; consumer runs scoped-window rules; WS fan-out — p95 ≤5s budgeted and tested (T-INT-05). |
| Graph DB? | Postgres source of truth + in-memory NetworkX adjacency — 2-hop <500ms at hackathon scale, no ops burden (ADR-001). |
| FP control? | Own-baseline normalization + legitimate corpus gate ≤10% in CI (docs/10 §6). |
| Insider vs AML teams? | Same alert can carry employee + customer entities; timeline merges both — that's the product thesis. |
| Evidence tampering? | Snapshots frozen at detection; export SHA-256 recorded on case (docs/08 §6). |

## Failure Modes & Fallbacks

| Risk | Fallback |
|---|---|
| Wi-Fi down | Everything is localhost — run entirely offline; show screenshots for export step if browser download blocked |
| WS banner shows reconnecting | Refresh once; narrate backoff design honestly if persists |
| S1 plant doesn't alert (bad seed state) | Pre-open alert from cold seed; run `--only S1` again after `docker compose restart api` |
| Demo laptop slow | Stop `npm run dev` HMR; use prebuilt `docker compose` web container |
| Judge wants depth | Have docs/ open at TRD §4 algorithms and test report ready |
