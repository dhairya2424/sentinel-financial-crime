---
name: Sentinel
description: An investigation console for insider risk and financial crime, built as a live instrument.
colors:
  canvas: "#f6f8fa"
  panel: "#ffffff"
  raised: "#eef2f6"
  line: "#e1e7ed"
  line-strong: "#c9d3dd"
  fg: "#0f172a"
  fg-muted: "#475569"
  fg-subtle: "#5b6878"
  accent: "#0369a1"
  accent-fill: "#0369a1"
  accent-fill-hover: "#075985"
  on-accent: "#ffffff"
  selected: "#e4eff7"
  band-low: "#15803d"
  band-medium: "#a16207"
  band-high: "#c2410c"
  band-critical: "#b91c1c"
  warn-bg: "#fef6dc"
  warn-line: "#ebcb6b"
  warn-fg: "#713f12"
  ok: "#0f766e"
  danger: "#be123c"
  ev: "#6d28d9"
  change: "#b7791f"
  cycle: "#b45309"
  canvas-dark: "#0b0f14"
  panel-dark: "#111823"
  raised-dark: "#1a2332"
  line-dark: "#1f2a3b"
  line-strong-dark: "#243044"
  fg-dark: "#f1f5f9"
  fg-muted-dark: "#94a3b8"
  fg-subtle-dark: "#7d8ca1"
  accent-dark: "#38bdf8"
  accent-fill-dark: "#0ea5e9"
  accent-fill-hover-dark: "#38bdf8"
  on-accent-dark: "#0b0f14"
  selected-dark: "#1a2332"
  band-low-dark: "#22c55e"
  band-medium-dark: "#eab308"
  band-high-dark: "#f97316"
  band-critical-dark: "#ef4444"
  warn-bg-dark: "#2a2410"
  warn-line-dark: "#4a3d12"
  warn-fg-dark: "#fde68a"
  ok-dark: "#2dd4bf"
  danger-dark: "#fb7185"
  ev-dark: "#a78bfa"
  change-dark: "#a9873a"
  cycle-dark: "#f59e0b"
typography:
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title-small:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'cv11', 'ss01'"
  control:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.333
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.333
    fontFeature: "'tnum'"
  mono-readout:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
rounded:
  sm: "4px"
  md: "6px"
  card: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  topbar: "52px"
  status-strip: "28px"
  rail-collapsed: "64px"
  rail-expanded: "160px"
  graph-panel: "320px"
  graph-canvas-min: "460px"
  add-rail: "196px"
  add-log: "300px"
components:
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-fill-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.raised}"
  input-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  input-search:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "32px"
    width: "360px"
  nav-item:
    textColor: "{colors.fg-muted}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  nav-item-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
  nav-item-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  tenant-chip:
    textColor: "{colors.fg-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  status-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    typography: "{typography.mono-readout}"
    padding: "0 16px"
    height: "28px"
  status-strip-stale:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-fg}"
  connection-banner:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-fg}"
    typography: "{typography.control}"
    padding: "8px 16px"
  risk-badge-critical:
    textColor: "{colors.band-critical}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
  entity-chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 8px 0 3px"
    height: "24px"
  entity-chip-hover:
    backgroundColor: "{colors.raised}"
  toggle-chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-subtle}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  toggle-chip-hover:
    backgroundColor: "{colors.raised}"
  toggle-chip-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  lane-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  lane-row-dimmed:
    textColor: "{colors.fg-subtle}"
  delay-tag:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
  inspector:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "16px"
    width: "340px"
  density-bar:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "8px 12px 6px"
  segmented-option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    typography: "{typography.control}"
    padding: "0 10px"
    height: "32px"
  segmented-option-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  edge-type-toggle:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-subtle}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    height: "32px"
  edge-type-toggle-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  graph-canvas:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.card}"
  graph-canvas-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    typography: "{typography.label}"
    padding: "4px 6px 4px 12px"
  zoom-button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.md}"
    size: "28px"
  zoom-button-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
  graph-panel-tab:
    textColor: "{colors.fg-muted}"
    typography: "{typography.control}"
    padding: "0 10px"
    height: "40px"
  graph-panel-tab-active:
    textColor: "{colors.fg}"
  node-customer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "7px"
    padding: "6px 12px"
  node-account:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    height: "30px"
    width: "108px"
  node-employee:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 12px 0 4px"
    height: "28px"
  node-transaction:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.sm}"
    padding: "2px 4px"
  node-dimmed:
    textColor: "{colors.fg-subtle}"
  cycle-badge:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-fg}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  touch-cell:
    height: "24px"
    width: "30px"
  touch-cell-selected:
    backgroundColor: "{colors.selected}"
  rail-item:
    textColor: "{colors.fg-muted}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  rail-item-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
  rail-item-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  form-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "20px"
  button-secondary-form:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "40px"
  form-segmented-option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg-muted}"
    typography: "{typography.control}"
    padding: "0 10px"
    height: "40px"
  form-segmented-option-on:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.fg}"
  picker-option:
    textColor: "{colors.fg}"
    typography: "{typography.control}"
    padding: "6px 12px"
  picker-option-active:
    backgroundColor: "{colors.selected}"
  log-state-saved:
    textColor: "{colors.ok}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
  log-state-rejected:
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
  log-state-neutral:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
  drop-zone:
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "24px 16px"
  drop-zone-dragging:
    backgroundColor: "{colors.selected}"
---

# Design System: Sentinel

## Overview

**Creative North Star: "The Live Instrument"**

Sentinel's shell is an instrument panel, not a frame. Its surfaces are quiet and solid so that the one thing that must never be quiet, the truth about whether the data is live, can get loud when it changes. A permanent status readout pinned to the foot of the content column reports connection and backend health in mono. When the API is lost, the readout and a banner flip to the warning family and a retry countdown appears. When the API comes back, both settle again in 200ms.

The system is dense and desktop-first, built for investigators on long triage sessions in lit offices and for judges watching a projector. There are two themes from one token set: a cool near-white light theme for projectors and daylight, and the docs/03 near-black dark theme. The theme follows the OS, and a System/Light/Dark switch sits in the account menu. Components only ever read the semantic role tokens (canvas, panel, fg, accent...), never the raw docs/03 palette, so both themes stay exact.

Depth comes from tone and hairlines, not from light effects. Surfaces are solid, edges are 1px lines, and shadows exist only under things that float over the page. There is no glass, no gradient and no glow. Colour carries meaning or it is absent.

**Key Characteristics:**
- Two themes from one semantic token set, following the OS; light for projector demos.
- Solid surfaces separated by 1px hairlines; tonal steps (canvas, panel, raised) express depth.
- A single sky accent reserved for the current location, focus and the primary action.
- Health, problems, errors and risk each own a separate colour family and never borrow from each other.
- Inter for language, JetBrains Mono only for machine truth: ids, tenants, counts, kbd hints, the status readout.
- Motion only for state changes, 150–200ms ease-out; one live ping per completed health check.
- On the graph, a node's form names its kind and an edge's stroke names its relation; a relation repeated between two nodes is drawn once, with a count.
- Data entry draws each activity record as the real Timeline row it will become before it is saved, and every reference is picked from registered records.

## Colors

A cool slate neutral field with one sky-blue signal and four strictly segregated semantic families.

### Primary
- **Harbour Sky** (accent, accent-fill; dark: Signal Sky): the only accent. Marks the icon of the current nav item, the 2px focus outline and the input focus border, text links, the caret and the text selection tint, and fills the primary action (Sign in, or the save action of an Add data form). On Add data it also borders the import drop zone while a file is dragged over it, the drop target being where the file will go. The light theme uses a deepened sky so white text on it passes AA. The dark theme uses docs/03 brand-400 for marks and brand-500 for fills with near-black text on top.
- **Deep Harbour** (accent-fill-hover): the primary fill's hover state.
- **Selected Mist** (selected): a pale sky wash in light and a lifted surface in dark. It sits behind the active nav item and the checked theme option, and on the Timeline behind the selected event row, pressed category and range toggles, and the 48-hour window on the density bar. On Add data it marks the current record type in the rail, the chosen option of a segmented control, the active option in an entity picker, and the drop zone while a file is dragged over it. This is location, not decoration.

### Semantic families
- **Health Teal** (ok): connected, and a service reporting `ok`, shown by the live dot and the status readout. It also marks a stored write: the "saved" tag in the Add data log and the import results, and the check after an id is copied. Teal, not green, so health is never read as a risk band.
- **Warning Amber** (warn-bg, warn-line, warn-fg): anything a user should notice that is not an error. This covers a degraded or unreachable backend (the whole status strip and the connection banner), and the access-denied notice icon. It is a family: always use the tinted ground, amber hairline and dark or pale amber text together.
- **Error Rose** (danger): failures of an action. This covers the sign-in error text, the invalid-field border and the ErrorRetry icon. On Add data it covers a rejected record and the server's reason for it, a preview problem that blocks saving, a failed lookup, and file rows that need fixing. Rose, not red, so an error is never read as a critical risk.
- **Risk Bands** (band-low, band-medium, band-high, band-critical): green, yellow, orange and red from docs/03, darkened in light to pass AA. They are used only as risk.

### Graph relations
Three hues that exist only to draw relations on the Graph Explorer. They are strokes and marks, never grounds or text.
- **Evidence Violet** (ev): an employee acting on a transaction. It strokes the EMPLOYEE_ACTION edge and outlines the transaction node's diamond. It stays reserved for evidence, so it never marks anything other than a person's action on a record.
- **Change Ochre** (change): an employee changing a profile, beneficiary or limit. It strokes the PROFILE_CHANGE edge and fills the change squares in the touch grid. It is deliberately duller than the warn and cycle ambers, so an edit reads as a relation, not an alarm.
- **Cycle Amber** (cycle): the legs of a detected money loop, their arrowheads, and the track of the Highlight cycles switch when it is on. It appears only while cycles are highlighted, together with the warn-family "Cycle" badge that names each leg.

### Neutral
- **Cool Paper / Night Canvas** (canvas): the app background, and the ground of the search field.
- **White Panel / Slate Panel** (panel): the sidebar, topbar, status strip, cards and menus.
- **Raised Slate** (raised): hover grounds, the avatar, skeleton blocks and empty-state icon wells.
- **Hairline** (line): default 1px dividers between the shell regions and inside menus.
- **Strong Hairline** (line-strong): control borders, card borders, kbd outlines, dashed placeholders and scrollbar thumbs.
- **Ink** (fg), **Muted Ink** (fg-muted), **Subtle Ink** (fg-subtle): primary text, secondary text and inactive nav, then placeholders and tertiary hints. All three hold 4.5:1 on their panels.

### Named Rules
**The One Signal Rule.** The sky accent marks only where you are, what has focus, and the one primary action on a screen. If sky appears anywhere else, it is decoration and must go. The one inherited exception is the docs/03 §5 edge grammar: EMPLOYEE_ACCESS is a dotted sky stroke, and the touch grid's "access only" mark repeats it as a dotted sky ring.

**The Four Families Rule.** Health is teal (`ok`), problems are amber (warn family), errors are rose (`danger`), and risk is the four bands. The band colours appear only in RiskBadge through `lib/risk.ts`. Never use a band for health, never use `danger` for risk, and never use amber for a failed action. A detected loop is a problem to notice, so its "Cycle" badge takes the warn family and its legs take Cycle Amber.

**The Dim, Don't Dye Rule.** When one record reveals related ones (the transfers within 48 hours of an employee's change), the related rows keep their normal ink and every unrelated row of that kind drops its text and icon to subtle ink (`fg-subtle`). The relation is named by a mono delay tag ("+17h after"). Never introduce a colour family or an opacity fade to mark a link. On the graph a dimmed node does the same: its label drops to subtle ink and its border to the plain hairline (`line`), at full opacity. Edges have no ink to drop, so a dimmed edge recedes to 14% opacity.

**The Relations Stay on the Graph Rule.** Evidence Violet, Change Ochre and Cycle Amber appear only as graph strokes and marks, the swatches that name those edges, and the touch grid. Never use them for text, grounds, status or risk.

**The Unmeasured Is Outlined Rule.** A risk factor that could not be measured (`imputed: true`: no baseline, no prior history, no grant on record) holds a neutral default, and it must never look like a finding. Wherever it appears (composition bar segment, legend swatch, contribution bar), it is a dashed `fg-muted` outline on the canvas ground instead of a filled ink step. Its raw value is suffixed " · neutral default" in subtle ink, it sorts after the measured factors, and a note under the table states how many of the score's points are neutral defaults.

**The Role Token Rule.** Components use the semantic roles (`bg-panel`, `text-fg-muted`, `border-line`), never the raw docs/03 palette (`surface-900`, `brand-400`). The raw palette exists only to feed the dark theme.

## Typography

**Display Font:** none (the product has no display tier)
**Body Font:** Inter Variable (with Inter, system-ui, Segoe UI fallbacks), with `cv11` and `ss01` enabled
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Cascadia Mono, Consolas), tabular numerals

**Character:** a neutral, compact sans that recedes behind the data, set against a mono that means "this is exactly what the system said". Both are docs/03 brand commitments.

### Hierarchy
- **Headline** (600, 24px, tight tracking): the Sign in heading only.
- **Title** (600, 20px, tight tracking): the page h1 in the content column, which can be followed on the same baseline by a 13px meta line (a name, a mono id or tenant).
- **Title small** (600, 16px): the empty-state heading.
- **Body** (400, 14px, 1.5): the base size for all running text. Descriptions cap at 52ch.
- **Control** (13px): nav items, buttons, field labels (500), banners, section headings in side rails (600) and page meta.
- **Label** (12px, 500 to 600): risk badges, menu captions, hint popovers. Role and entity-type chips drop to 11px/500. The Add data rail's group labels are 12px/600 in subtle ink, in sentence case like every other label.
- **Mono** (12px; 13px for ids in page meta and the tenant field; 11.5px for the status readout; 10–10.5px for kbd hints): machine values only. On the graph that covers the edge-type enums, which are the docs/09 values verbatim (11px in the toolbar, 11.5px in the panel), masked account numbers (10.5px in a hexagon, 15px as a panel heading), short ids under node labels (10px), bundle counts and the stats values. On Add data it covers the rail counts and log times (11px), the log state tags (10.5px), the copyable short id, and fields that hold machine values (customer references, rupee amounts, bank narration, reference numbers) at 13px.

### Named Rules
**The Machine Truth Rule.** Mono is reserved for ids, tenants, emails and credentials shown as system values, counts and score ranges, kbd hints, and the status readout. Never set labels, headings or prose in mono.

**The No Display Rule.** The largest type in the product is the 24px sign-in headline. Hierarchy comes from weight (600 against 400) and ink level, not from scale.

## Layout

The app shell is a fixed three-part frame. On the left is a sidebar rail: 160px with labels at 1024px and up, and a 64px icon rail below that or when collapsed with ⌘B. The width animates over 200ms. To its right is a column holding a 52px topbar (a search field up to 360px with a ⌘K hint, then the tenant chip and avatar at the far right), an optional connection banner, a scrolling main region, and a 28px status strip pinned to the bottom. Login centres a 380px column in the viewport and keeps the same banner above it and the same strip at the bottom.

Page content sits in a column capped at 1152px (max-w-6xl), with 16px/24px padding that grows to 32px at 1024px and up, and 24px between blocks. The dashboard pairs a flexible main area with a 300px right rail at 1024px and up. Spacing runs on a 4px base, and the steps actually used are 2, 4, 6, 8, 10, 12, 16, 24 and 32px. Nav items and menu rows are 36px tall. Controls are 32px in the shell and 40px on the sign-in form.

The Timeline pairs a flexible lane column with a 340px sticky inspector at 1024px and up, and stacks the inspector below the lanes under that. The density bar spans the full width above both. The lane list is a three-column grid (left lane, a 64px centre time column between hairlines, right lane) that scrolls inside its card with a sticky 32px lane header and sticky day headers on the raised ground.

The Graph Explorer is a wide page. The h1 shares its baseline with an entity search capped at 384px on the right. Under it sits a toolbar, then a grid of a flexible canvas card and a 320px side panel with 12px between them at 1024px and up. The panel stacks below the canvas under that. Both are `calc(100dvh − 210px)` tall with a 460px floor, so the canvas fills the viewport at 1280×800. The toolbar holds, in one row at the target width: depth (1-hop | 2-hop), layout (Force | Rings), a 1px strong-hairline divider, the five edge-type toggles, and Highlight cycles pushed to the far right. It wraps rather than scrolls on narrower screens. The canvas card is a column: the flow canvas on the canvas ground with a 1px dot grid (22px pitch, strong hairline), then a strip under it on the panel ground behind a top hairline, holding the live note on the left and the zoom group on the right.

**The Clear Canvas Rule.** No persistent chrome sits on the graph canvas. Notes, counts, legends and zoom or fit controls live in the strip under it or in the toolbar above it. Only transient floaters may cover the canvas: the edge tooltip, the error toast, and the loading status on a 60% panel veil.

**The Near Fit Rule.** A new load or layout change frames only the focus and its direct neighbours (depth ≤ 1), with 40px top and bottom and 48px side padding, and never zooms past 1.15. The 2-hop rim sits beyond the frame and is reached by panning (zoom runs from 0.2 to 2). Expanding a node never refits. Turning on Highlight cycles reframes to the loop nodes over 200ms under the same cap.

The force layout pins the focus at the centre and pulls each hop onto a ring (165px, then 340px), stretched 1.5× horizontally to fill the wide canvas. It settles fully before the first paint, so nodes never drift into place. Rings places each hop evenly on its ring, ordered by kind and then name.

Add data (`/add`) is a three-column workbench at 1024px and up: a 196px record-type rail, a flexible form card and a 300px "Saved this session" log, 16px apart and top-aligned. The rail and the log are sticky 16px from the top, and the log caps at `calc(100dvh − 140px)` and scrolls inside. Below 1024px the three stack, and the rail becomes a wrapped row of its 36px items inside the same hairline card, with the group labels kept for screen readers only. Inside the form card (16px padding, 20px at 1024px and up) blocks sit 16px apart. Fields pair in two columns 12px apart from 640px and stack below that. The footer is a top hairline with 16px above its right-aligned buttons.

Breakpoints are Tailwind's defaults. At 640px the kbd hints and the strip's "checked" time appear. At 768px the tenant chip and the version appear. At 1024px the sidebar labels, the collapse control, the right rail and wider padding appear. The product targets 1280×800. The layout below 640px is kept usable during an outage (the banner wraps and the strip drops secondary fields), but a full mobile layout is not yet designed.

## Elevation & Depth

The system is flat and tonal. Depth is conveyed by the canvas, panel and raised steps and by 1px hairlines between regions: the sidebar's right edge, the topbar's bottom edge and the strip's top edge. Nothing at rest casts a shadow. Only elements that float above the page get a shadow, and it is an offset-and-blur drop with a negative spread. It is slate-tinted in light and pure black at higher opacity in dark.

### Shadow Vocabulary
- **Float** (`--shadow-float`, Tailwind `shadow-float`: `0 10px 28px -6px rgb(15 23 42 / 0.18)`; dark `0 10px 28px -6px rgb(0 0 0 / 0.6)`): the account menu, the search hint popover, the density-bar tooltip, and on the graph the entity search results, the edge tooltip, the error toast and the loading status. One token, theme-aware. Graph nodes and the canvas never cast one.
- **Skip link** (`--shadow-card: 0 1px 3px rgb(0 0 0 / 0.4)`): the skip-to-content link when it gains focus.

### Named Rules
**The Only Floaters Cast Rule.** A shadow means "this is above the page". Cards, panels, banners and the status strip never cast one. They sit in the page and separate by hairline and tone.

## Shapes

The corners are small and consistent. Controls, nav items, chips, badges and skeleton blocks use gently rounded 6px corners. Cards, notices and the account menu use 8px. Kbd hints, role chips and small icon buttons use 4px. Only the avatar, the live dot and the empty-state icon well are circles. Every border is 1px.

**The Form Names the Kind Rule.** On the graph, each entity kind has one silhouette. A customer is a rounded rectangle (7px), an account is a hexagon with pointed sides, an employee is a pill, and a transaction is a small diamond. Colour never tells the kinds apart. Borders are 1px, and 1.5px on the focus entity.

**The Dashed Slot Rule.** A dashed strong hairline means a slot: a place reserved for something that is not here yet. It is used for phase placeholder panels, for the logo slot until the team's file arrives, and for the import drop zone, which is a slot waiting for a file. Solid borders are for things that exist, so what a chosen file holds is drawn in solid hairlines; the zone itself stays dashed because it still accepts another file. The graph's edge dashes are a separate grammar and do not carry this meaning.

## Components

### Buttons
Quiet, compact and exact.
- **Shape:** gently rounded (6px).
- **Primary:** the sky fill with on-accent text, 40px tall, 600 weight. There is one per screen (Sign in; on Add data the form's save action, such as "Record transaction", or "Import N records"). A spinner and "Signing in" replace the label while pending, with a wait cursor at 70% opacity. On Add data the pending label is "Saving" or "Importing", and the button stays disabled (50% opacity, not-allowed cursor) until the form is complete.
- **Secondary:** a panel ground with a strong hairline, 32px tall, 13px/500, and a raised ground on hover. ErrorRetry uses it. On a form it matches the primary's 40px height with 14px padding (Clear).
- **Ghost:** rows and icon buttons with no border that take the raised ground on hover. This covers demo accounts, sign out, the password reveal and dismiss.
- **Warning action:** inside the amber banner, "Retry now" takes an amber hairline and a tinted hover, keeping to the warn family.
- **Transitions:** colours over 150ms. Focus uses the global 2px sky outline with a 2px offset.

### Chips
- **Tenant chip:** a hairline border with a building icon, mono 12px in muted ink.
- **Role / entity-type chip:** a strong hairline, 4px radius, 11px/500 muted.
- **Kbd hint:** a strong hairline, 4px radius, mono 10–10.5px.
- **Entity chip:** the one way to show a person, account, customer or transaction inline. A 24px pill with a strong hairline on the panel ground: an 18px raised disc holding the employee's initials (9px/600) or a 12px kind icon (landmark, arrows, user), then the 12px/500 label in ink and a mono 10.5px short id (`emp_…9934`) in subtle ink. Without a label it shows the full id in 11.5px mono ink. The full id is always in the native title. As a link it takes the raised ground on hover and underlines the label; transactions do not link.
- **Toggle chip:** category and time-range filters. 32px, 6px radius, 13px/500, with an optional 14px icon. Off, it has a hairline border on the panel ground in subtle ink (range toggles in muted ink) and a raised hover. On (`aria-pressed`), it takes the selected ground, a strong hairline and ink text. No sky.
- **Delay tag:** a mono 11px tag in muted ink on a strong hairline with a 4px radius, naming a relation in time ("+27h after").

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** panel.
- **Shadow Strategy:** none (see Elevation).
- **Border:** a strong 1px hairline. Dashed for phase placeholders.
- **Internal Padding:** 12px by 16px for notices. Empty states get 56px vertical padding.

### Inputs / Fields
- **Style:** a strong 1px hairline, 6px radius, 40px on forms (panel ground) and 32px for shell search (canvas ground, leading icon, trailing kbd hint).
- **Hover:** the border darkens to subtle ink.
- **Focus:** the border turns sky with a 2px sky ring at 30% opacity.
- **Error:** the border turns rose (`aria-invalid`), and a 13px rose message sits above the submit button.
- **Tenant field:** mono 13px, because a tenant is a machine value.
- **Label and marks:** a 13px/500 ink label sits 6px above the control. An optional field adds " (optional)" in 400 subtle ink; every unmarked field is required. Under the control goes either a 12px subtle hint or a 12px rose field error, never both.
- **Machine values:** references, rupee amounts, bank narration and reference numbers use the mono field (13px, tabular numerals).
- **Amounts:** rupee amounts group Indian-style as they are typed (1,85,000), keeping at most two decimals.
- **Account numbers:** the hint says only a masked copy is stored ("X for every digit but the last four"). Masking happens on the server, and the page only ever shows the masked number back.
- **Pair row:** two fields side by side, 12px apart, from 640px; stacked below.
- **Segmented (form):** the Graph Toolbar's radio group at form height: 40px, options divided by 1px hairlines, 10px padding, 13px. The chosen option takes the selected ground, 500 weight and ink, never sky; the others are muted ink on the panel ground with a raised hover. The focus outline is inset, and the group scrolls sideways rather than wrapping.

### Navigation
- **Sidebar item:** 36px, 13px, an 18px lucide icon plus the label, and muted ink at rest. Hover gives a raised ground and ink text. The active item gets the selected ground, 500 weight, ink text and a sky icon. In the collapsed rail the labels become screen-reader text and a native title gives the name.
- **Admin group:** shown only to admins, separated by a hairline.
- **Collapse control:** pinned to the rail's foot at 1024px and up, with a ⌘B hint.

### Lane List (signature)
Two lanes on one clock. Each row is the three-column lane grid with a hairline under it; the event sits in its lane, mirrored (icon on the outside edge, right-aligned) in the left lane, with the time in the centre column in mono 12px subtle ink. A row carries a 16px category icon in muted ink, the title (500 for people events, 400 for money), then a meta line of mono 12px amount, entity chips and a delay tag. Money in is ink and money out is muted ink. The whole cell is one button with an inset sky focus outline.
- **Hover:** a 60% raised ground.
- **Selected:** the selected ground, a 1px inset sky ring, a sky icon and a sky mono time.
- **Linked:** unchanged ink, plus a delay tag.
- **Dimmed:** unlinked money rows while a change is selected; title, icon and amount drop to subtle ink (see The Dim, Don't Dye Rule).
- **Static:** without a select handler (the Add data preview) the row is not a button and has no hover. The title clamps to two lines instead of truncating, so a long title is still read in full.

### Inspector
A 340px panel card (16px padding, 16px gaps) that sits sticky beside the lanes and scrolls on its own. The heading is the event title at 15px/600 with the 16px category icon inline in sky, since it describes the selected event. Below it is a definition list on a 104px term column: 13px terms in subtle ink, values in ink, machine values in mono and entities as entity chips. Optional sections follow under 12px/600 muted subheadings: "What changed" (old value struck through in subtle ink, an arrow, the new value at 500), the follow-through list (mono delay, title, mono amount in a hairline-divided 6px box), and the source record as mono 11.5px on the canvas ground in a hairline box. Loading uses skeleton lines; a failed record uses ErrorRetry.

### Density Bar
A diverging bar chart in a panel card, 64px of chart over a mono 11px axis line. The left lane's counts rise above a 1px strong-hairline axis in subtle ink (money, access) and the right lane's fall below it in ink (people, actions). The 48-hour window after a selected change is a selected-ground band behind the bars. Dragging across bars previews the range with a selected band and a sky edge, then zooms to it. The hover tooltip is a floater (strong hairline, 6px radius, float shadow) with the bin date and mono counts. A legend of 10px swatches names each lane in words. Bars do not animate.

### Status Strip (signature)
A 28px mono readout pinned below the content: a live dot plus the connection label, API/DB/Redis states, the time since the last check (or a retry countdown), and the app version at the right. Healthy, it sits on the panel ground in muted ink with a teal dot and teal `ok` values. Each completed check fires one expanding ping from the dot (1.2s, `cubic-bezier(0.16, 1, 0.3, 1)`), and the ping is skipped under reduced motion. When the backend is degraded or unreachable, the whole strip crossfades to the warn family over 200ms, and a service that is down shows as semibold, dotted-underlined "down" so colour is never the only signal.

### Connection Banner (signature)
It appears under the topbar only when the backend is degraded or unreachable. The amber ground, hairline and text carry a no-connection icon, a plain sentence saying data may be stale (naming the API host or the failed services), a mono "retrying in Ns" countdown and a "Retry now" action. It wraps on narrow screens.

### Risk Badge
The only place band colours appear. Each badge is an icon plus a text label plus colour: check, circle-alert, triangle and octagon for low, medium, high and critical. It uses the band colour as text, a 10% tint ground and a 30–35% inset ring, at 12px/600 with a 6px radius. Colour is never the only signal.

### Empty State and Skeleton
The empty state is a 44px circular raised icon well, a 16px/600 heading, a muted description capped at 52ch, and an optional link or action. Skeletons are raised blocks with a 6px radius, pulsing inside hairline panel rows that match the list rhythm, and they come with a screen-reader loading label.

### Graph Canvas (signature)
One money-flow drawing around one focus entity, on the canvas ground inside an 8px strong-hairline card. The strip under it (see The Clear Canvas Rule) carries an `aria-live` note in 12px muted ink. The note gives the hint ("Double-click a node to expand it. Hover an edge for its transactions."), the truncation notice at 400 nodes, or the loop count while cycles are on, and says so in words when there are none. The zoom group is three 28px square buttons (strong hairline, 6px radius, panel ground, 14px icons, raised ground and ink on hover) for zoom in, zoom out and fit. Double-clicking a node expands it by one hop behind an "Expanding …" status. Hovering an edge opens its tooltip. Double-clicking the canvas never zooms.
- **Selection:** a 2px sky outline 4px outside the node's form, the same ring used for keyboard focus. Never a fill.
- **Dimming:** while cycles are on, every node outside the loops dims. While a touch-grid cell is hovered, every node off its edges dims except the selected one. See The Dim, Don't Dye Rule.
- **Motion:** 150ms colour on nodes and 150ms ease-out opacity on edges when they dim or return, 150ms steps for zoom, and a 200ms fit. There is nothing else.

### Graph Nodes
Solid panel-ground forms (see The Form Names the Kind Rule). At rest the border is a strong hairline. The focus entity takes an ink border at 1.5px. A dimmed node takes the plain hairline and subtle ink.
- **Customer:** a rounded rectangle at least 96px wide, with 6px by 12px padding. The name is 12px/500 in ink, over a mono 10px short id in subtle ink.
- **Account:** a 108 by 30px hexagon, its 1px border drawn as a clipped ring. It holds the masked account number (`XXXXXXXX1158`) in mono 10.5px, with no other text.
- **Employee:** a 28px pill. A 20px raised disc holds the initials (9px/600, muted), then the name at 12px/500.
- **Transaction:** a 10px diamond outlined in Evidence Violet, then a mono 10px short id in muted ink. The full id is in the native title.
- **Handles** are invisible and never connectable. Each node's accessible name is `${type} ${label}`, and Enter opens it.

### Edge Grammar (signature)
Every relation of one type between the same two nodes is one bundle, drawn as one line. Parallel bundles between the same pair fan out as quadratic curves 18px apart, and endpoints stop 5px outside each node's box. TRANSFER lines are drawn above all others.

| Type | Stroke | Width | Dash | Arrow |
|---|---|---|---|---|
| TRANSFER | muted ink (`fg-muted`) | 1.75 | solid | subtle-ink triangle |
| ACCOUNT_HOLDER | strong hairline (`line-strong`) | 1 | 5 4 | none |
| EMPLOYEE_ACCESS | sky (`accent`) | 1.25 | 1.5 3.5 (dotted) | none |
| PROFILE_CHANGE | Change Ochre (`change`) | 1.75 | solid | none |
| EMPLOYEE_ACTION | Evidence Violet (`ev`) | 1.5 | solid | none |
| Cycle leg | Cycle Amber (`cycle`) | 3.25 | solid (dash dropped) | cycle-amber triangle |

- **Bundle weight:** width grows by 0.5 × log2(N), capped at 4 for TRANSFER and 2.5 for the rest.
- **Bundle count:** a bundle of more than one carries a mono ×N in muted ink at the curve's midpoint. It is counter-scaled so it reads at about 11px on screen at any zoom (clamped 9.5–20px). A 3px halo in the canvas colour knocks out the lines behind it. The halo is a legibility cut-out, not a glow.
- **Quiet edges:** when nothing is dimmed or hovered, PROFILE_CHANGE, EMPLOYEE_ACCESS and EMPLOYEE_ACTION bundles that touch neither the focus nor the selected node drop to width 1 at 28% opacity and lose their count. They return to full weight when either end is the focus or the selection, or when a touch-grid cell lights them.
- **Cycles:** with Highlight cycles on, each leg of a loop takes the cycle stroke and a "Cycle" badge at its midpoint (warn ground, warn hairline, warn ink, 600, 4px radius, counter-scaled to about 11px). Every other edge dims to 14% and every other node dims.
- **Tooltip:** a floater (strong hairline, 6px radius, float shadow) with the mono type and "from → to" in ink, then mono muted lines for the total amount over N transfers, the action counts (`VIEW ×3`), and the last timestamp.

### Graph Toolbar
- **Segmented control:** a radio group in one strong-hairline 6px box. Options are 32px, 13px/500, with 10px padding. The chosen option takes the selected ground and ink. The others are muted ink with a raised hover.
- **Edge-type toggle:** the toggle-chip pattern set as a machine value. It is 32px with a 6px radius and 6px padding, the enum in mono 11px/500 after a 14 by 8px swatch drawn in that edge's own stroke, width and dash. On (`aria-pressed`), it takes the selected ground, a strong hairline and ink. Off, it takes a hairline, the panel ground and subtle ink. The edge's plain-language description is in its title.
- **Highlight cycles:** a switch styled as a secondary button (32px, 13px/500). Its 26 by 14px track is strong hairline when off and Cycle Amber when on, with a panel-ground knob that slides 12px over 150ms. A spinner replaces the track while the loops load.

### Graph Side Panel
A 320px panel card with two tabs, Entity | Who touched what, on a 40px tab row over a hairline. Tabs are 13px/500 in muted ink. The active tab takes ink and a 2px sky underline, since it marks where you are. The left and right arrow keys switch tabs. Selecting a node on the canvas returns to Entity.
- **Entity:** a role chip for the kind, the name at 17px/600 (mono 15px for an account) with its RiskBadge, the full id in mono 11.5px subtle ink, and a 13px muted detail line. Stats follow as a definition list on a 128px term column (subtle-ink terms, mono ink values). Then come secondary actions with 14px icons (View timeline, Alerts, Focus here), and "Connections in view", a list of edge swatch, mono enum and mono count that follows the edge filters. Loading uses skeleton lines, and failure uses ErrorRetry.
- **Who touched what (touch matrix):** employees in view as columns, against the customers and accounts they changed or can access as rows. There are at most 14 rows, the focus first and then by touch count. Column heads are 22px raised initials discs (9.5px/600). Row heads are right-aligned 11px/500 muted labels up to 132px wide (mono 10.5px for accounts) that select the node on click. Cells are 30 by 24px with a hairline border. A profile change is a Change Ochre square (2px radius) sized 5px plus 2px per change, up to 16px. "Access only" is a 6px dotted sky ring. The selected row and column take the selected ground. Hovering a cell lights its edges on the canvas and dims everything else. A legend in words sits above the grid, and a key of initials with full names sits below. Every cell has a sentence for screen readers ("Vidya Rao on Karan Apte: 3 profile changes, has access").

### Logo Slot
`LOGO_SRC` in Logo.tsx is null until the team supplies a file. The slot renders a dashed 28px (36px on login) box beside the 15px/600 "Sentinel" wordmark. When a file exists it renders as an image in the same box.

### Record-Type Rail
The Add data rail: one hairline card (8px padding) holding three groups in the order a scenario is built: Register (Customer, Account, Employee), Record activity (Transaction, Employee action, Session, Access right) and Bulk (Import file). Items follow the sidebar-item grammar without icons: 36px, 13px, 10px padding, muted ink, a raised ground and ink on hover. The current type takes the selected ground, 500 weight and `aria-current="page"`, and it lives in the URL (`?type=`). Each registered or recorded type carries the tenant's count right-aligned in mono 11px subtle ink with en-IN grouping, read to screen readers as ", N saved". A count that failed to load is left out, never shown as zero. Group labels are 12px/600, sentence case, subtle ink at 1024px and up.

### Form Card
One record per card. The heading is 16px/600 with tight tracking, over a 13px muted sentence saying what the record is and what comes next. The fields follow in Pair rows, then, for activity records, the Timeline preview. Next comes an inline 13px rose error (`role="alert"`), which quotes the server's reason verbatim, above the footer. The footer is a top hairline with Clear (secondary, 40px) and the one primary action, right-aligned. The primary stays disabled until every required field is valid and the preview reports no problem. A successful save empties the form for the next record and refreshes the rail counts.

**The No Default Verdict Rule.** An assessment the bank makes (KYC status, risk rating) never has a default. Its select opens on a disabled "Choose the KYC status" / "Choose the bank's rating" option, and saving stays disabled until one is chosen. Only an operational field with a true common value (a transfer's status, "Completed") may start filled.

### Entity Picker
A combobox over registered records only; free text never becomes a reference. It is the 40px text field with room on the right for a 24px ghost × that clears it (a spinner while loading). It opens on focus or click and lists the newest records while empty. Typing searches names, references and masked numbers after 180ms. The list is a floater 4px below the field: strong hairline, 6px radius, panel ground, float shadow, up to 256px tall. Options are 13px rows (6px by 12px), and the active one takes the selected ground. An account option shows the holder in sans ink, the masked number in mono 12px muted ink, and the account type in 12px subtle ink at the right. Other kinds show the name and then a 12px muted detail. Closed, the field reads name-first, then only what tells records apart: "Rhea Kulkarni · …7788" for an account, "Tanvi Deshmukh · teller" for an employee. A failed lookup shows its message in rose inside the list. A dependent picker (an employee's sessions) is disabled and says "Choose the employee first" until its parent is set.

**The No Dead End Rule.** An empty picker says what is missing ("No customers registered yet.", or "No registered customer matches …") and, where the record can be registered here, offers "Register a customer" / "Register an employee" as a sky text link with a plus icon that opens that form.

### Timeline Preview (signature)
Under every activity form, the record is drawn as the Timeline row it will become, before it is saved. The server reads the unsaved event (debounced 250ms), and the page draws the answer with the Timeline's own lane row in its static, selected treatment. It sits inside an 8px strong-hairline card under the 32px lane header (left lane, "Time", right lane, named for the viewpoint's kind). The heading "Timeline preview" (13px/600) shares a line with a 12px subtle caption naming the viewpoint: "As it will appear on Rhea Kulkarni's Timeline", with the name in 500 muted ink. Until a row exists, a line of at least 58px says why in words:
- **Incomplete:** subtle ink, naming the missing required fields as a list ("Fill in the receiving account and the amount to see the row.").
- **Checking:** a spinner and "Checking the record against what's registered".
- **Problem:** a rose icon and rose "This can't be saved: …". Saving stays blocked.
- **Note:** an info icon and a muted note when the record has no Timeline row. Access rights are not on the Timeline, and the note says where they show instead.
- **Error:** a rose icon and a muted "The preview could not be drawn: …".

The whole block is `aria-live="polite"`.

**The Real Row Rule.** A preview is the real component fed by the server's reading of the real record, never a mock drawn to look like one. If the server cannot draw it, the card says so.

### Session Log
The 300px "Saved this session" card. A 44px header holds the 13px/600 heading, a mono 11px subtle count of saved and partly saved entries, and a ghost "Clear list" once there is anything to clear, with a hairline under it. Entries run newest first and are kept for the browser tab in session storage (up to 200). Empty, the card says what will appear there. Each entry is a hairline-divided row (14px by 10px): a mono 11px subtle time, the 13px ink summary, and a state tag at the right, mono 10.5px in a 4px-radius outline with no fill.
- **saved:** teal (`ok`) text and a 35% teal hairline.
- **partly saved:** muted ink and a strong hairline, for an import with rejected rows. Its reason is muted and points to the results table.
- **rejected:** rose text and a 35% rose hairline. The server's reason follows in 12px rose, verbatim.
- **already saved:** muted ink and a strong hairline, for a record the server had already stored.

Under the summary, aligned to its text, sit 12px/500 sky links, "Open in Graph" and "Open Timeline". For a registered customer, account or employee there is also a copy button with the mono short id (full id in its title) that shows a teal check and "copied" for 1.5s. The list is `aria-live="polite"`.

### Import Panel
The Bulk form card. Under its heading sits the drop zone (see The Dashed Slot Rule): an 8px-radius dashed strong hairline, 24px by 16px padding, around a centred 20px muted file icon, a 13px/500 ink line ("Choose a file, or drop it here") and a 12px subtle limit line (".csv or .json · up to 5,000 records"). The whole zone is the file input's label. It takes a 60% raised hover and shows the 2px sky focus outline when the hidden input has keyboard focus. While a file is dragged over it, its border turns sky and its ground selected. A parsed file shows a count line (mono count, the file name at 500, and a rose "N need fixing in the file"). Under it is a results table in a hairline card up to 288px tall, with a sticky raised header (Row, Record, Result at 12px/500 muted) and hairline rows. Each row has a mono subtle row number, the record summary and its own outcome: subtle "Ready" before import, mono teal "saved", muted "Already saved earlier", or the rose reason. The footer holds the primary "Import N records". Once the import has run, a muted note replaces it: "Import finished. Choose another file above to import more." A collapsible hairline section, "What the file should contain", lists the columns in mono.

### Alert Ledger (signature)
The Alert Inbox list: hairline rows in a card with RiskBadge, a 13px/500 title over a muted entity name (status as a mono outlined tag once it is not open), and a right-aligned mono amount over "time ago · ×N". The open row is marked by the Selected Mist ground alone, with no side stripe. The keyboard cursor follows an alert id, not a position, so a live arrival above it never moves it. Its 2px sky outline (60%) appears only after arrow-key use and never on the open row. A footer hint lists ↑ ↓ move, Enter open, A acknowledge, C case in kbd chips. A live arrival prepends with the one-shot `alert-fresh` highlight and raises a toast. It never replaces the open alert. Below `lg`, the detail opens as a full overlay with a "Back to alerts" link.

### Alert Detail
Stacked in one scrolling column:
1. The header: RiskBadge, mono rule code and title, then entity chips sorted customer → employee → account, then the meta line "Detected … · Total ₹… · occurrence ×N · status" beside Acknowledge and Case.
2. The explanation card.
3. The risk factors.
4. The always-mounted evidence ledger, headed by a muted file icon (Evidence Violet stays on the graph).
5. The graph snapshot.
6. The evidence timeline.

### Factor Composition
A 10px composition bar splits the score into one segment per factor. Measured factors take neutral ink steps, darkest for the largest contribution; the bar never uses a risk colour. The Unmeasured Is Outlined Rule applies. A mono legend follows, then the factor table (factor, raw value, weight, contribution bar over its outlined weight track), a Composite row "sum → score" and a Band row with RiskBadge. Below `sm`, the table becomes a two-line stacked list (name and points, then raw value, weight and bar), so Composite and Band stay visible at 390px without sideways scrolling.

### Graph Snapshot
A 320px read-only React Flow frame. It draws only the alert's own entities:
- The accounts sit on one loop circle stretched ×1.6 horizontally, in the order of the evidence legs.
- A holder sits under an account on the lower half of the loop and beside one on the upper half.
- The fit zoom runs from 0.5 to 1.2 and refits one frame after any resize, so no entity is ever cut off.
- The strip under it says "Loop legs in amber", counts the connected entities outside the alert, and links to the Graph Explorer.

### Evidence Timeline
The alert's evidence as lane rows from the primary entity's Timeline, with a note counting evidence found on other Timelines. When every row sits in one lane, the empty lane is dropped: the header reads Time | lane label, and rows read time, then card, left to right.

## Do's and Don'ts

### Do:
- **Do** read only the semantic role tokens in components, so light and dark stay exact from one set.
- **Do** use the sky accent only for the current location, focus and the primary action.
- **Do** show health in teal (`ok`), problems in the amber warn family, errors in rose (`danger`), and risk only through RiskBadge.
- **Do** pair every status colour with an icon or text (risk icon plus label, "down" in semibold with a dotted underline).
- **Do** set ids, tenants, counts, score ranges, kbd hints and the status readout in JetBrains Mono with tabular numerals.
- **Do** separate regions with 1px hairlines and tonal steps. Keep shadows to floating menus and hints (offset plus blur, negative spread).
- **Do** animate only state changes, at 150–200ms ease-out. Fire one live ping per completed health check, and let reduced motion cancel it.
- **Do** mark unbuilt areas with a dashed strong hairline and an honest "Arrives in Phase N" empty state.
- **Do** keep the logo a slot until the team's file arrives.
- **Do** show people, accounts, customers and transactions inline through the entity chip, with the full id in its title.
- **Do** mark related records by dimming the unrelated ones to subtle ink and tagging the related ones with a mono delay tag.
- **Do** draw each graph entity kind in its own form (customer rounded rectangle, account hexagon, employee pill, transaction diamond) and each relation in its docs/03 stroke.
- **Do** draw repeated relations of one type between two nodes as one bundle with a counter-scaled mono ×N.
- **Do** keep the graph canvas clear. Notes and zoom or fit controls go in the strip under it, and filters go in the one-row toolbar above it.
- **Do** frame only depth ≤ 1 on load, at no more than 1.15 zoom, and leave the rim to panning.
- **Do** mark an optional field "(optional)" in subtle ink, leave required fields unmarked, and keep the primary action disabled until the form is complete.
- **Do** make every reference a picker over registered records, and give an empty picker a "Register a/an <noun>" link.
- **Do** preview an activity record with the Timeline's own lane row, read by the server, and name whose Timeline it will appear on.
- **Do** group rupee amounts Indian-style as they are typed (1,85,000).
- **Do** show the server's rejection reason verbatim, in rose, inline and in the log.

### Don't:
- **Don't** use gradients, glass (backdrop blur) or glow shadows anywhere.
- **Don't** put a shadow on a card, panel, banner or the status strip.
- **Don't** use a band colour outside RiskBadge, or reuse `danger` or a band for health or connection state.
- **Don't** add kickers or eyebrow labels above headings. Headings stand alone, with meta on the same baseline.
- **Don't** add page-load choreography or looping ambient motion. The live ping runs once per check.
- **Don't** invent a logo mark, metrics or sample records to fill a slot.
- **Don't** set prose, labels or headings in mono.
- **Don't** mark a selected node with a fill. Selection is the 2px sky ring.
- **Don't** fade a graph node with opacity. Dim its ink and border.
- **Don't** use Evidence Violet, Change Ochre or Cycle Amber outside graph strokes, their swatches and the touch grid.
- **Don't** draw a neutral-default risk factor as a filled measurement. Outline it and say how many points it carries.
- **Don't** preselect an assessment (KYC status, risk rating). Start on a disabled "Choose…" option.
- **Don't** draw a mock preview row or offer sample picker options. If the server cannot draw the row, say so.
- **Don't** leave a finished action as a spent disabled button. Replace it with a note that says what happened and what to do next.
