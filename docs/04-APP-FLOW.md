# 04 — Application Flow

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0

---

## 1. Screen Navigation Map

```
                         ┌──────────────┐
                         │  Login Screen│
                         └──────┬───────┘
              JWT stored in memory (Zustand) + refresh cookie
                                │
        ┌───────────┬───────────┼───────────┬────────────┬──────────┐
        ▼           ▼           ▼           ▼            ▼          ▼
   Dashboard   Alert Inbox  Case Mgr   Graph Explorer  Timeline   Admin/Rules
        │           │           │           │            │          │
        │      (row click) (card click) (node click) (entity      (admin only)
        │           │           │        ┌───┴───┐      select)
        │           ▼           ▼        ▼       ▼      │
        │     AlertDetail ◄────►│    SidePanel  Expand   │
        │     (evidence   CaseDetail    │      neighbors │
        │      panel ON)      │         ▼               │
        │        │            │    "View timeline" ──────┘
        │        │            │    "Open in alerts"
        │        ▼            ▼
        │   [→ Create/Link Case]  Export (JSON/HTML)
        └──── live WS updates from any screen ────┘
```

Routes (React Router):
| Route | Screen | Guard |
|---|---|---|
| `/login` | Login | public |
| `/` | Dashboard | auth |
| `/alerts` | Alert Inbox | auth |
| `/alerts/:id` | Alert Inbox + AlertDetail opened | auth |
| `/cases` | Case Manager list/kanban | auth |
| `/cases/:id` | Case detail | auth |
| `/graph` | Graph Explorer (URL state `?node=&depth=`) | auth |
| `/timeline/:type/:id` | Activity Timeline | auth |
| `/add?type=` | Add data: register customers, accounts, employees; record transactions, actions, sessions, access rights; import a CSV/JSON file | admin, investigator |
| `/admin/rules` | Rules admin | role=admin — *as built:* the route and its admin guard exist (T-FE-14) and show a placeholder screen; rule versions are read and changed through `GET/PUT /v1/rules` (docs/05 §6). PRD F-13 is a *Should*. |

## 2. User Journey A — Triage a Circular Transfer Alert (Priya)

```
1. Login (POST /v1/auth/login) → JWT + WS connect /v1/ws
2. Dashboard shows "Critical alerts 24h: 3" (pulsing, from WS)
3. Click card → /alerts?band=critical
4. List loads (GET /v1/alerts). Row: [CRITICAL] R-CIRC • C-1042 • ₹4.2L • 2m ago
5. Click row → /alerts/a-789
   → AlertDetail renders:
      - pattern name, explanation string (server-composed)
      - Risk factors table (raw/weight/contribution → band)
      - Evidence panel loads (GET /v1/alerts/a-789) — 5 tx records inline
      - Mini graph snapshot (ReactFlow, read-only) of A-1→A-7→A-9→A-1
      - Inline timeline of the 5 transactions
6. Click evidence TX tx-991 → raw record drawer (source: transactions table)
7. Click "Open in alerts" entity chip on node A-7 → graph expands (optional)
8. Click [Acknowledge] → POST /v1/alerts/a-789/acknowledge → status updates live
9. Click [→Case] → dialog: create new case (title prefilled, priority)
   → POST /v1/cases {alert_ids:[a-789]} → navigate /cases/c-42
```

## 3. User Journey B — Link Employee Action to Money Flow (Rahul)

```
1. From AlertDetail on R-PROFILE alert, click employee chip E-507
2. → /timeline/employee/E-507
   Timeline shows: 03:12 login (off-hours), 03:14 profile.limit_change on C-1042,
   03:40 tx.approve tx-999 (role mismatch badge on row)
3. Click event "profile.limit_change" → expand: actor, target, before/after JSON
4. Click target C-1042 chip → /graph?node=C-1042&depth=2
   Graph shows customer node (risk: critical ring), edges: transfers to A-7, A-9;
   edge PROFILE_CHANGE from E-507 highlighted
5. Toggle "highlight cycles" → cycle edges amber, "Cycle ×3" badge
6. Click [→Case] from alert → assign to self (D1) → case created with
   alert + linked alerts sharing C-1042 (server groups by shared entities)
```

## 4. User Journey C — Case Assignment & Evidence Export (Sneha → Priya)

```
Manager (Sneha):
1. /cases → kanban. New case c-42 in Open.
2. Click card → case detail. Assignee select → Priya → POST /v1/cases/c-42/assign
3. WS case.updated broadcasts → Priya's kanban updates live (her column +1 card)

Investigator (Priya):
4. Open c-42 → review linked alerts, evidence panel per alert
5. Add note "Reviewed cycle, beneficiary analysis pending"
6. Change status Open → In Review (PATCH /v1/cases/c-42)
7. Conclude confirmed → status Escalated; note mandatory on final close:
   Close → validation requires note ≥ 10 chars → Closed-Confirmed
8. Export: click [Export JSON] → GET /v1/cases/c-42/export?format=json
   → download sentinel-case-c-42.json (bundle + SHA-256 recorded in DB)
   click [Export HTML] → printable report tab
```

## 5. System Event Flow (real-time, no UI)

```
External source / seed script
   POST /v1/ingest/events  (batch)
        │
        ▼
   [API] validate → PG insert (tx) → Redis Stream XADD events
        │ (respond 202 {accepted: n} immediately after persist)
        ▼
   [Pipeline worker] per event:
        ├─ GraphService.update(event)          (adjacency map)
        ├─ affected = entities(event)
        ├─ rules = select_rules(affected)
        ├─ for rule in rules: hit = rule.evaluate(window(affected))
        │      if hit:
        │        factors = risk_service.aggregate(...)
        │        alert = dedup_or_create(rule, entities, factors, evidence_refs)
        │        PG insert alert/evidence          ~
        │        Redis PUBLISH alerts:{tenant} {alert payload}
        ▼
   [WS Hub] receives pub → fan out to subscribed sockets
        ▼
   [Frontend] Zustand reducer:
        ├─ Alert Inbox: prepend row (highlight)
        ├─ Dashboard: bump counters
        └─ Toast "New CRITICAL alert: Circular Transfer"
```

**Ordering:** Redis Stream consumer group (single consumer per tenant partition) guarantees per-entity ordering; PG insert of event precedes publish so crash-recovery replays are idempotent (event id = client-supplied or hash).

## 6. State Machines

### Alert lifecycle
```
OPEN ──ack──► ACKNOWLEDGED ──link──► LINKED_TO_CASE
  │                                    │
  └──auto-resolve (rule window close)─►► RESOLVED
LINKED_TO_CASE ──case closed-confirmed──► CLOSED_CONFIRMED
LINKED_TO_CASE ──case closed-fp────────► CLOSED_FALSE_POSITIVE
```
Transitions API: `POST /v1/alerts/{id}/acknowledge`, `POST /v1/alerts/{id}/link-case {case_id}`, case status change propagates to linked alerts.

### Case lifecycle
```
OPEN ─assign──► IN_REVIEW ─escalate──► ESCALATED
  │                │                      │
  │                └──close(note)──┐       │
  └────close(note, manager)────────┴───────┴──► CLOSED_CONFIRMED
                                              └► CLOSED_FALSE_POSITIVE
```
Closure note mandatory (≥10 chars, client + server validation).

### WebSocket connection
```
CONNECTED ──error/timeout──► RECONNECTING (exp backoff 1s→30s, jitter)
RECONNECTING ──ok──► CONNECTED (resubscribe channels, refetch open views)
```
UI shows banner "Live updates paused — reconnecting…" during RECONNECTING.

## 7. Permission Flow

```
login → JWT {sub, role, tenant_id}
route guard: role ∈ {admin, manager, investigator, viewer}
  viewer: read-only (no ack/assign/close/export write)
  investigator: + ack, case create, notes, export
  manager: + assign, close case, rule edit? (no — admin only)
  admin: + rules edit, replay batch, user mgmt
Backend re-validates role on every mutation (never trust UI).
```
