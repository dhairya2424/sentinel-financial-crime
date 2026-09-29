---
version: 1
slug: "frontend-src-pages-adddata-tsx"
primary_target: "frontend/src/pages/AddData.tsx"
related_targets: []
---

# Add data (frontend/src/pages/AddData.tsx)

Scope: the /add route, Operate mode. Audience: admins and investigators entering real records into a tenant — live in front of judges during the demo, and later from bank exports. Task: register customers, accounts and employees, then record transactions, employee actions, sessions and access rights, one at a time or by importing a CSV/JSON file, and keep entering. Constraints: every record is real (no sample rows rendered as data); unknown references are rejected by the backend with a reason that the UI shows verbatim; account numbers are masked server-side; viewer role cannot enter data. Backend: POST /v1/entities/{customers,accounts,employees}, POST /v1/ingest/events (errors[] per event), GET /v1/graph/search for pickers.

## Direction contract
THESIS: A workbench, not a wizard: every record type is one click away in a rail ordered the way a scenario is built (register people and accounts, then record what they did), and every activity record is previewed as the exact Timeline row it will become before it is saved. Refuses the generic tabbed settings form and the multi-step modal.
OWN-WORLD: Sentinel as documented: canvas/panel/raised tones, 1px strong hairlines, one sky accent for the current rail item, focus and the single primary action; teal saved and rose rejected states in mono; entity chips for people and accounts; the preview is a real lane row (left lane money and access, centre mono time, right lane people and actions) with the selected treatment.
STORY: The investigator sees what exists (rail counts), picks a record type, fills a plain form whose pickers only offer registered records, reads the preview row, saves, and watches the log confirm it with links to Graph and Timeline — or explain in plain words why it was refused.
FIRST VIEWPORT: h1 "Add data" with a one-line subtitle; below, three columns at 1280: 200px rail card (Register: Customer, Account, Employee with mono counts; Record activity: Transaction, Employee action, Session, Access right; Bulk: Import file), flexible form card (title, fields in two columns, preview lane row under the fields for activity records, Clear + primary action right-aligned at the foot), 320px "Saved this session" log card.
FORM: Workbench (option 3) with the Sentence builder's live Timeline preview (option 2) — structure 1 of 7 in my ordered list; surface seed key 55a86726.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
