---
version: 1
slug: "frontend-src-pages-alertinbox-tsx"
primary_target: "frontend/src/pages/AlertInbox.tsx"
related_targets: ["frontend/src/components/alert/AlertDetail.tsx","frontend/src/components/alert/EvidencePanel.tsx"]
---

# Alert Inbox (frontend/src/pages/AlertInbox.tsx)

Scope: /alerts and /alerts/:id, Operate mode, with AlertDetail and EvidencePanel (frontend/src/components/alert/*). Audience: investigators triaging alerts (Priya, Rahul in the PRD) and judges watching a live demo. Task: see new alerts arrive live, filter by band/rule/status/time/entity, open one, read why it scored what it did, check the evidence records, acknowledge or start a case. Constraints: docs/03 §4 (40/60 list/detail) and §7 (detail order); ADR-009 EvidencePanel always mounted, no visibility or dismiss API, all four states inside the panel; factor table shows name, raw_value, weight, contribution and a composite that sums to the score; never a score-only view; live arrival = highlight + toast, never steals the open alert (user choice).

## Direction contract
THESIS: An evidence ledger, not a score card: the alert reads as a claim with its proof laid out in columns (every evidence record's id, time, route and amount side by side), and the score is shown as the sum of its parts before it is shown as a number. Refuses the dashboard-card inbox and the big-number risk hero.
OWN-WORLD: Sentinel as documented: canvas/panel tones, 1px strong hairlines, sky only for the selected row, focus and the one primary action (Acknowledge); band colour only inside RiskBadge; mono for ids, amounts, times, counts and factor names; neutral ink steps for the composition segments and contribution bars; the weight drawn as a hairline track behind each bar; Evidence Violet only on the evidence icon; the mini graph reuses the graph's node forms and Cycle Amber legs.
STORY: A new alert slides into the top of the ledger with a one-time highlight and a toast. The investigator opens it, reads the plain-language explanation, sees in one bar how the score is composed, checks each factor's raw value against its weight, then scans the evidence table and opens any record's frozen JSON before acknowledging or starting a case.
FIRST VIEWPORT: h1 "Alert Inbox" with the live count; filter bar (band chips, rule select, status select, 24h/7d/30d, entity chip when filtered); list card 40% as a compact newest-first ledger (badge, title, entity, mono amount, time/occurrence); detail card 60%: header (badge, rule code, title, entity chips, total, detected, occurrence, status, Acknowledge + → Case), Explanation block, Risk factors (composition bar, then factor | raw value | weight | contribution with weight tracks, Composite, Band), Evidence ledger full width, then mini graph and evidence timeline side by side.
FORM: Evidence ledger (option 2) with the score-composition bar from Triage by band (option 1); surface seed key c198e98b.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
