---
version: 1
slug: "frontend-src-pages-graphexplorer-tsx"
primary_target: "frontend/src/pages/GraphExplorer.tsx"
related_targets: ["frontend/src/graph/nodes.tsx","frontend/src/graph/edges.ts"]
---

Scope: Graph Explorer screen (/graph?node&depth) and its node/edge components, inside the established Sentinel world (DESIGN.md). Visitor mode: Operate.
Audience and job: investigators following money and employee activity around one entity (PRD A1–A3); judges watching the demo find a planted loop.
Constraints: DESIGN.md tokens and rules; edge types and filter labels are the docs/09 enums verbatim; docs/03 §5 edge styles; nodes carry aria-label `${type} ${label}` and open on Enter; no invented records.

## Direction contract

THESIS: A full-height money-flow canvas with the entity beside it, and a second lens on the same data that answers the insider question directly: who touched what. It refuses the hairball where every repeated edit is its own line.

OWN-WORLD: Sentinel's solid panels and 1px hairlines on a dotted canvas ground. Customers as rounded rects, accounts as hexagons with masked numbers in mono, employees as pills with initials. Edges per docs/03: TRANSFER solid slate with arrow, ACCOUNT_HOLDER dashed hairline, EMPLOYEE_ACCESS dotted sky, PROFILE_CHANGE amber and heavier, EMPLOYEE_ACTION evidence violet. Repeated edges of one type between two nodes are one bundle with a mono ×N count. Selection is a sky ring, never a fill. Cycles: amber legs with a "Cycle" badge while everything else dims.

STORY: The investigator searches an entity, sees its 2-hop money and people around it, filters edge types instantly, double-clicks to expand, toggles cycles to find a loop, and reads who touched which customer in the grid tab, then jumps to the timeline.

FIRST VIEWPORT: Header with h1 "Graph Explorer" and the entity search. A toolbar row: 1-hop | 2-hop, Force | Rings, five enum-labelled edge toggles, and Highlight cycles at the right. Below, a full-height ReactFlow canvas (dotted background, zoom/fit controls) beside a 320px panel with tabs Entity | Who touched what.

FORM: Side panel (position 1 on my ordered list, dealt second) fused with Who touched what (position 7, dealt third) as a panel tab, at the user's request "2 with 3's grid". Seed key 36086659. Code-led (no image generation). Signature interaction: Highlight cycles fetches the loops through the focus accounts, merges any missing loop nodes into view, and dims everything except the amber legs with Cycle badges. Motion: 150ms opacity on dim and highlight only; the force layout settles before first paint.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
