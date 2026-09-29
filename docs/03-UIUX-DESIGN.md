# 03 — UI/UX Design Specification

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Framework:** React 19 + TypeScript + Tailwind CSS 4 (ADR-014) | **Graph:** ReactFlow 12

---

## 1. Design Principles

1. **Evidence first, score second.** Every alert view opens with pattern name, explanation, and evidence records. The composite risk band is a badge — never the primary content. The evidence panel has no dismiss/hide control — mandatory evidence/explanation panel alongside every alert, **not just a score** (PRD C4 / EO-5).
2. **Investigator speed.** Two clicks max from inbox to graph context. Keyboard shortcuts for triage (A=acknowledge, C=assign case, ←→=next/prev alert).
3. **Linked everything.** Any entity (employee, customer, account, transaction) is a clickable chip that navigates to the graph node + side panel in context.
4. **Real-time honesty.** Live indicators (pulsing dot, "last event" timestamp) show WS state; degraded connection shows explicit banner — never silently stale data.
5. **Density with hierarchy.** Light and dark themes from one token set, following the OS with a switch in the account menu (ADR-014): investigators work in lit offices and demos run on projectors, where dark interfaces wash out. The §2 palette is the dark theme; the light theme keeps its hues, darkened to pass AA on white. critical info uses color + icon + text (never color alone — WCAG AA).

## 2. Design Tokens

```css
/* tailwind.config.ts theme extend */
colors: {
  surface:  { 950:'#0B0F14', 900:'#111823', 800:'#1A2332', 700:'#243044' },
  ink:      { 100:'#F1F5F9', 300:'#94A3B8', 500:'#64748B' },
  brand:    { 400:'#38BDF8', 500:'#0EA5E9', 600:'#0284C7' },
  risk:     { low:'#22C55E', medium:'#EAB308', high:'#F97316', critical:'#EF4444' },
  evidence: '#A78BFA'
}
radius: { card: '8px' }, boxShadow: { card: '0 1px 3px rgb(0 0 0 / .4)' }
font:   { sans: ['Inter','system-ui'], mono: ['JetBrains Mono','monospace'] } /* mono for IDs/amounts */
```

| Token | Value | Usage |
|---|---|---|
| `risk.low` / `.medium` / `.high` / `.critical` | #22C55E / #EAB308 / #F97316 / #EF4444 | Risk badges, node rings, chart series |
| `evidence` | #A78BFA | Evidence panel accent, evidence links |
| Spacing scale | 4px base (Tailwind default) | Consistent 16/24px card padding |
| Type scale | 12 / 14 / 16 / 20 / 24 px | 12=meta, 14=body default, 20=card title |

## 3. Shell Layout (all screens)

```
┌────────┬──────────────────────────────────────────────────┐
│        │ Topbar: [Search ⌘K] [WS ● live] [Tenant] [Avatar]│
│  Nav   ├──────────────────────────────────────────────────┤
│ Sidebar│                                                  │
│  160px │  <page content>                                  │
│        │                                                  │
│ 64px   │                                                  │
│ icons  │                                                  │
│  ▸ Dashboard    (E1)                                      │
│  ▸ Alert Inbox  (Epic C)                                  │
│  ▸ Case Manager (Epic D)                                  │
│  ▸ Graph Explorer (Epic A)                                │
│  ▸ Timeline     (Epic B)                                  │
│  ▸ Admin/Rules  (F-13, role-gated)                        │
└────────┴──────────────────────────────────────────────────┘
```

- Sidebar collapses to 64px icon rail below 1024px; full collapse on mobile (v1 desktop-first, minimum 1280×800 supported).
- Global search (⌘K): fuzzy search across customers, accounts, employees, transactions → navigates to entity.

## 4. Screen: Alert Inbox (Epic C)

| Zone | Content |
|---|---|
| Filters bar | Risk band chips (Low/Med/High/Critical multi-select), rule code select, time range (24h/7d/30d), status (open/acked), assignee |
| Alert list (left 40%) | Row: [risk badge] [pattern name] [primary entity] [₹amount] [time ago] [occurrence count]. Selected row: brand left-border. Real-time new alerts prepend with brief highlight animation. |
| Alert detail (right 60%) | `AlertDetail` component — **see §7** (mandatory evidence panel) |

Empty state: "No alerts match filters" + illustration. Loading: 6 skeleton rows.

**Row data from `GET /v1/alerts` (paginated, cursor).** WS event `alert.created` prepends optimistically.

## 5. Screen: Graph Explorer (Epic A)

- **Canvas:** ReactFlow. Node types: `customer` (rounded rect), `account` (hexagon), `employee` (pill with avatar initials). Node styling: fill by risk ring (none/low/med/high/critical), selected = brand ring + shadow.
- **Edge types:** `TRANSFER` (solid, arrow, tooltip: amount + ts), `ACCOUNT_HOLDER` (dashed thin), `EMPLOYEE_ACCESS` (dotted, brand color), `PROFILE_CHANGE` (warning color, thicker), `EMPLOYEE_ACTION` (evidence color).
- **Controls:** zoom/fit (ReactFlow defaults), toolbar: `1-hop | 2-hop` expand depth, edge-type toggles, layout (force / hierarchical), "highlight cycles" toggle (cycles from detection → edges amber + `Cycle` badge).
- **Interaction:** click node → right side panel (EntityCard: type, name, ids, risk badge, mini-stats, links: "View timeline", "Open in alerts"). Double-click → expand neighbors. Drag → pan.
- **URL state:** `?node=acc_123&depth=2` so investigation context is shareable.
- **Data:** `GET /v1/graph/neighbors?node_id&depth&edge_types` returns `{nodes, edges}` in ReactFlow shape with `risk` on nodes.
- **As built (P2-B, chosen by the team from three options):** a full-height canvas beside a 320px panel with two tabs. **Entity** is the EntityCard above, plus "Focus here" and connection counts by edge type. **Who touched what** is a grid of the customers and accounts in view against the employees in view: square size is the number of PROFILE_CHANGE edits, a dotted ring is access only, and hovering a cell lights up those edges. Repeated edges of one type between the same two nodes are drawn as one bundle with a ×N count; the tooltip shows the total amount or actions and the latest time. Risk rings appear only from medium upward, so an all-low graph carries no colour. Highlight cycles checks loops through the focus's accounts, adds any missing loop nodes, and dims everything except the amber legs, each with a "Cycle" badge. Edge-type filter labels are the docs/09 enum names verbatim. New colour tokens: `--change` (PROFILE_CHANGE amber) and `--cycle` (loop legs), both in light and dark.

## 6. Screen: Activity Timeline (Epic B)

- Vertical timeline for selected entity (customer | employee | account). Filter chips by event category: `Transaction | Profile change | Access/login | Approval`.
- Each event row: timestamp (mono), icon by category, title, actor chip (employee link if performed by employee session — **B2**), amount/value if transaction, → expand reveals raw record JSON.
- Density bar (top): Recharts bar chart of events/hour — brushing filters the list.
- Data: `GET /v1/timeline/{entity_type}/{id}?from&to&categories` → merged chronological list.
- **Layout as built (P1-B, chosen by the team from three options):** two lanes on one clock — Money | Time | People for customers and accounts, Access | Time | Actions for employees — with a 340px sticky inspector on the right. Clicking any event fills the inspector: when, amount, direction, channel, reference, status, from/to accounts, counterparty and narration for transactions; performer, action, target, session, IP and a before → after diff for employee actions; and the raw source record. Selecting an employee action marks the customer's transfers in the next 48 hours (the R-PROFILE_FLOW window) with a "+Nh after" tag and dims the other money rows. The density bar diverges (left lane above the axis, right lane below), uses hourly bins for ranges of 3 days or less and daily bins otherwise, and zooms to the dragged range.

## 7. AlertDetail — Mandatory Evidence Panel (C4, C5)

```
┌────────────────────────────────────────────────────────────┐
│ [HIGH]  R-CIRC — Circular Transfer Detection     ⋯ (menu)  │
│ Customer: C-1042 • Accounts: A-1, A-7, A-9   ₹4,20,000    │
│ Detected 2m ago • occurrence ×3 • [Acknowledge] [→Case]    │
├────────────────────────────────────────────────────────────┤
│ EXPLANATION (human string from engine)                     │
│ "₹4.2L moved in a loop across 3 accounts within 6h:        │
│  A-1 → A-7 → A-9 → A-1…"                                  │
├──────────────────────────────────────────────┬─────────────┤
│ RISK FACTORS (C5)                            │  EVIDENCE   │
│ ┌────────────────────────┬──────┬───────────┐ │  (mandatory│
│ │ factor                 │ raw  │ contrib.  │ │   panel —  │
│ ├────────────────────────┼──────┼───────────┤ │   NOT      │
│ │ amount                 │4.2×  │ ██████ 35 │ │   hideable)│
│ │ temporal_proximity     │94%   │ █████  25 │ │           │
│ │ linkage_depth          │3 hops│ ███    25 │ │ TX tx-991 │
│ │ account_velocity       │5.1×  │ █      15 │ │ TX tx-992 │
│ ├────────────────────────┼──────┼───────────┤ │ TX tx-993 │
│ │ COMPOSITE              │      │ 100 → 78 │ │ EMP act-5 │
│ │ BAND                   │      │  HIGH     │ │ ACC right │
│ └────────────────────────┴──────┴───────────┘ └───────────┤
│ INLINE GRAPH SNAPSHOT (3–5 node mini ReactFlow)            │
│ INLINE TIMELINE (evidence events)                          │
└────────────────────────────────────────────────────────────┘
```

**Rules (enforced in code + test):**
1. Evidence panel always rendered in AlertDetail; no state where it is unmounted (Vitest test asserts `getByTestId('evidence-panel')` present in all render states: loading→loaded, error shows "Evidence unavailable — retention issue" inside panel).
2. Risk factors table shows raw value, weight, contribution bar, and composite sum = band.
3. Evidence items are clickable → open raw record drawer (transaction JSON, employee action JSON) with source table name.
4. If `evidence_refs` empty → explicit error state inside panel (still no score-only view).

## 8. Screen: Case Manager (Epic D)

- **Kanban or list toggle:** columns Open → In Review → Escalated → Closed. Card: case id, title, priority, assignee avatar, linked alert count, age.
- **Case detail:** header (status dropdown, priority, assignee select — manager role), linked alerts list (each opens AlertDetail in modal/drawer), notes feed (author, ts, text), audit trail timeline, actions: `Add note`, `Close case` (note mandatory — validated), `Export evidence` (JSON / HTML buttons → download).
- **Assignment (D1):** assignee select → `POST /v1/cases/{id}/assign` → WS `case.updated` updates all viewers live.

## 9. Screen: Dashboard (E1)

- KPI cards: Open cases, Critical/High alerts (24h), False-positive rate (trailing 7d), Ingestion lag.
- Charts (Recharts): alerts by band over time (stacked area), top 5 linked entities (horizontal bar), ingestion events/min (line).
- "Live" badge driven by WS; every card subscribes to `dashboard:{tenant}` channel.

## 10. Screen: Admin / Rules (F-13, role=admin)

- Table of rules (code, name, enabled, thresholds, weights). Edit drawer → numeric inputs + validation → `PUT /v1/rules/{code}` (versioned). Show weight sliders summing to 1.0 enforced.

## 11. Components & States (global)

| Component | States |
|---|---|
| `RiskBadge` | low/medium/high/critical — icon + text + color |
| `EntityChip` | hover underline; click → navigate |
| `EvidencePanel` | loading (skeleton), loaded, error (retention), empty refs |
| `Toasts` | alert.created (top-right, non-blocking, click→inbox), connection lost/restored |
| `Skeleton` | list/detail placeholders |
| `ConfirmDialog` | destructive actions (close case, replay batch) |

## 12. Accessibility

- AA contrast on all text (verify with `npm run contrast`).
- Every icon-only button has `aria-label`; graph nodes have `aria-label` + keyboard focus (Enter opens panel).
- Focus ring visible (2px brand) on all interactive elements; modal focus trap; `prefers-reduced-motion` disables highlight animations.
- Color never sole indicator: risk badges include icon + text label.

## 13. Empty / Error / Loading Matrix

| Context | Loading | Empty | Error |
|---|---|---|---|
| Alert list | 6 skeleton rows | "No alerts match filters" + clear | Inline retry |
| Graph | Spinner over canvas | "Search an entity to start" | Toast + retry |
| Timeline | 8 skeleton rows | "No activity in range" | Inline retry |
| Evidence panel | Skeleton inside panel | empty refs state | **"Evidence unavailable" inside panel (never score-only)** |
| Export | Button spinner | — | Toast with reason |
