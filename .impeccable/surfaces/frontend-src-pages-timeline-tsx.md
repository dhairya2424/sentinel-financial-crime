---
version: 1
slug: "frontend-src-pages-timeline-tsx"
primary_target: "frontend/src/pages/Timeline.tsx"
related_targets: ["frontend/src/components/EntityChip.tsx"]
---

Scope: Activity Timeline screen (/timeline/:type/:id) and its EntityChip, inside the established Sentinel world (DESIGN.md). Visitor mode: Operate.
Audience and job: investigators reading one customer's, account's or employee's history to connect employee actions to money movement (PRD B1/B2); judges watching the demo.
Constraints: DESIGN.md tokens and rules; no invented records; actor chip on every profile_change/approval row (data-testid timeline-actor); raw source record reachable for every row; skeleton/empty/error per docs/03 §13.

## Direction contract

THESIS: The timeline is two lanes on one clock with an inspector beside them. It refuses the single undifferentiated feed where an employee's edit is one more row lost among card payments.

OWN-WORLD: Sentinel's solid panels, 1px hairlines, Inter plus JetBrains Mono for times, ids and amounts. Money in slate, people in ink. Sky accent only for the selected event and focus. No new colour family: linked rows are marked by dimming everything else plus a mono "+Nh after" tag.

STORY: The investigator sees money and people side by side, clicks any event, and reads everything about it in the inspector: when, what, amount, channel, reference, accounts, who did it, what changed, and the raw record. Selecting an employee action lights up the transfers in the next 48 hours.

FIRST VIEWPORT: Header with entity-type chip, entity name as h1, mono id and meta, "Open in graph" at the right. Category chips and the range readout on one row. A 64px diverging density bar (money above, people below; hourly bins for ranges of 3 days or less, daily otherwise) that is dragged to select a range. Below, a two-lane list (Money | Time | People; Access | Time | Actions for employees) with sticky day headers, and a 340px sticky inspector on the right.

FORM: Inspector (position 3 on my ordered list, dealt as the roll lead) fused with Two lanes (position 1) at the user's request "1 with 2's lanes", plus 2's diverging density bar and 48-hour correlation highlight. Seed key 0081a258. Code-led (no image generation). Signature interaction: selecting an employee action dims everything except the transfers that followed within the R-PROFILE_FLOW 48-hour window, each tagged with its delay. Motion: 150ms opacity and background transitions on selection only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
