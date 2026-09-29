---
version: 1
slug: "frontend-src-components-appshell-tsx"
primary_target: "frontend/src/components/AppShell.tsx"
related_targets: ["frontend/src/pages/Login.tsx"]
---

Scope: Sentinel app shell (AppShell sidebar + topbar + status strip), Login, and P0 placeholder pages. Visitor mode: Operate.
Audience and job: investigators on long triage sessions in lit offices; judges watching a projected demo. Task: sign in, move between the six areas, always know whether the data on screen is live.
Constraints: docs/03 hues and Inter + JetBrains Mono are brand commitments; light and dark from one token set, following the OS, switch in the avatar menu; logo is a slot until the team supplies the file; no invented metrics.

## Direction contract

THESIS: The shell is a live instrument, not a frame. It refuses the admin-template default where "live" is a decorative dot: connection and backend health are a permanent, quiet readout that turns loud only when the truth changes.

OWN-WORLD: Solid surfaces in two themes (cool near-white #F6F8FA / white panels, or docs/03 #0B0F14 / #111823), 1px hairlines, no glass, no gradients, no glow. Sky-blue accent only for the current location, focus and the primary action. Risk colours appear only as risk. Mono is reserved for ids, tenants, counts and the status readout.

STORY: The investigator understands where they are (active nav, page title), trusts what they see (status strip), and acts fast (⌘K search focus, ⌘B rail collapse, two-click nav).

FIRST VIEWPORT: 160px labelled sidebar left (logo slot + wordmark, six areas, Admin only for admins); 52px topbar with a 360px search field (⌘K), tenant chip, avatar menu at right; content column with an h1 and the phase placeholder; a 28px status strip pinned to the bottom of the content column reading connection, API/DB/Redis health and last check time. Login: centred form with the same strip at the bottom of the screen.

FORM: Live console, position 2 on the ordered list, with the Workbench's ⌘B collapse borrowed. Seed key f8f457bd. Signature interaction: losing the API flips the strip to the warning state and drops a banner saying the data may be stale, with a retry countdown; restoring it settles back in 200ms. Motion grammar: 150–200ms exponential ease-out for state changes only; no page-load choreography; reduced motion disables the live pulse.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
