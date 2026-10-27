# Holotable as a friendly world map

**Status:** implemented candidate, 27 October 2026. Synthetic tests and isolated headless captures cover the presentation; independent code and UI review remain with the coordinator. The hover card waits for a library component.

Holotable is diagnostics, but it's held to a game world map's friendliness. Picture a holographic centrepiece that colleagues stand around, point at and drill into. It should be useful at a glance and dead simple to look closer at. Anything confusing, and any friction between what it offers and what a glance gives you, defeats its purpose. Producers own their content's wording (labels, details, glyphs). This page covers the presentation: what the view, the inspector and the layer list do with that content.

## At a glance

- **Legend.** A compact key sits in the view's lower left, generated from what is on the map now: one row per visible glyph family or kind, with its plate and a count ("People 12", "Events 3", "Places 5"). Nothing is listed that isn't there. Known glyphs use their family; kind fallbacks merge actors into People, zones into Areas, paths into Routes, fields into Fields and point/target/label items into Markers. Unmarked relation/influence lines are omitted. The fixed order is People, Groups, Events, Story, Places, Areas, Routes, Markers, Fields, Diagnostics, Things, Direction. It folds to a single "Key" button, and the fold is remembered per view. It reads over the shapes the way the scale bar does.
- **Clusters at distance.** When plates overlap on screen, they merge into one count plate ("5"), drawn in the dominant family's tone. Clicking it, or zooming in, separates them; a click on a cluster zooms in until it splits. This is how a world map stays readable when zoomed out, and it replaces most label culling at overview distances.
- **District names.** At overview distances, district names sit on the map as quiet labels. Below about 300 m they fade out.
- **Quiet stretches say so.** When nothing in the visible layers changes for a while, the readout says, for example, "Quiet until Day 2 · 14:30", and you can click it to jump there (the next-change action).

## Pointing at things

- **Hover card — deferred.** The current help and reason tips require a control anchor; point-anchored menus and popovers take focus. None supplies a nonfocusable, multiline tooltip anchored to a canvas point without a library change. The coordinator has requested that component from the UI track. The intended interaction remains: hovering a plate for 250 ms shows a small card beside it: the title, one line of summary (the item's first detail line), when it happens, and its badge in words ("Blocked"). Moving away dismisses it. It never takes focus and never shifts layout. A click selects the item, which pins it in the inspector.
- **Selection is visible from afar.** The selected plate grows and takes the ring, as now. Its relations draw as thin lines to the other end, with that end's plate brightened.

## Drilling in

- **Double-click focuses.** Double-clicking a plate, or a cluster, moves smoothly (300 ms, instant with reduced motion) to frame it and selects it. The `Esc` key, or a "Back" button in the view's corner, returns to the previous viewpoint. The view keeps a short stack of up to 8 viewpoints.
- **Inspector as a card, not a property dump:**
  - The **title** comes first, in the panel's heading style, with the glyph plate beside it.
  - Then the **summary**: the detail text with its line breaks, as sentences.
  - Then **when** in human terms: "Day 2 · 14:30, for 3 h", "Throughout", or "From Day 1 · 09:00". Raw seconds appear only under Technical.
  - Then **who and what is involved**: relation chips naming the far end, as now. Clicking one selects that item and focuses the view on it.
  - Then **why**: the producer's why chain (detail lines that start with a cause), when present.
  - The **Technical** expander is closed by default and holds the kind, ids, citation, clock, facets and raw times. The expander remembers its state.
- **Facets read as properties.** Facet keys show in sentence case ("Gang affiliation"), not as raw keys. Producers may supply a `facet_titles` map in the manifest; otherwise underscores and dashes become spaces.

## The layer list

- **Titles, not ids.** A producer's row shows its `producer_title` (a new optional manifest field, for example "Story Engine"), falling back to the producer id.
- **Counts in plain terms:** "8 on the map now" (visible and placed at this moment), with "of 31 in this set" when that's different.
- **Diagnostics stay quiet.** Unknown glyphs, refusals and unplaced items move into a muted "Producer notes" line under the layer, which expands to the details. They matter to producers, not to someone glancing at the map.
- The layer row's menu keeps "Step through this layer", and gains "Focus on this layer", which frames all of that layer's placed items.

## Budgets

The frame allowance remains 8 ms steady. Cluster preparation shares the agent renderer's existing slice and resumes across frames: a conservative 6 px occupancy grid visits at most 16 cells per projected 18 px plate, with union/find rather than dense neighbour scans. Preparation yields every 64 entries, including coincident groups; cluster painting and member counts also yield. The key reads counts gathered while painting, without a second item traversal. Clustered markers never enter the effects baseline, and existing effects on them are suppressed. Selected markers stay outside clusters, retain their ring, and use the selection token with a stage-coloured text halo. A count plate overlapping that ring moves only on screen, away from its centre by the minimum distance needed to clear the ring plus 2 px; both centres remain independently pickable.

Cluster clicks search at most 24 smaller viewpoints, stopping at the first split or the 40 m minimum. Co-located groups of up to 12 retain their deterministic fan-out when close. Unseparated groups open the existing inspector list, headed “N at this spot”; each item is a selectable, focusing chip. Single cluster clicks wait 250 ms so a double-click produces one focus operation.

The new camera actions are `holo.view.focus` (`view` plus one of `id`, `layer` or `position`) and `holo.view.back` (`view`). The existing `holo.focus` context-fetch action is unchanged. Visible view adapters register by panel instance and release on hide/dispose. Details uses its pinned/follow-focus binding (`ctx.targets().view`); only an absent binding falls back to a focused registered Holotable view, resolved to an explicit id before dispatch. Camera stacks remain view-local; they reset on opening a set. Esc is scoped to Holotable and yields to text fields, dialogs and menus.

The experiment-owned `holotable-view-state/playback` document also remembers Technical once for Holotable and Key separately per view. Quiet stretches use visible-layer change times, avoid claiming quiet over intervening recorded sample/event changes, and jump through Next change. Same-day game times omit the day in the button; the full time and “Jump there” remain in its tooltip and accessible name. The button hugs its text and aligns to the readout’s right edge, leaving free space on its left. Its label ellipsises before the bar wraps at its measured minimum width.

The selected marker’s name and caption choose a side together: right, left, above, then below, taking the first block clear of neighbouring plates and count plates; when none is clear they fall back to the right. At most eight queries use the existing obstacle grid, independent of plate count.

The inspector separates detail lines beginning with `Cause`, `Because` or `Why:` into Why, preserving the remaining summary's line breaks. Recording times are elapsed `m:ss`/`h:mm:ss`; game times are `Day D · HH:MM`. Technical holds raw times and producer-provided facet titles, falling back to sentence case. Layer totals count distinct ids on the active or shared branch across time, including expired/future ids; current counts include only placed items in an enabled layer. Producer notes use the library's muted maker-level expander.

## Verification

`bun tools/capture-friendly.ts` in `projects/xf-holotable` builds the synthetic client, starts its own ephemeral loopback server and headless browser, requires `?verify=1`, and closes both. The ignored evidence folder is `local/holotable/evidence/friendly/`: 28 captures at 300/850 px × light/dark, with overview/clusters/key/districts/card, folded key, Technical open, producer notes, double-click focus/Back and Quiet until. Component patterns sit beside each capture. `--review-only` refreshes the eight overview/selected-label images and records the right-aligned, text-hugging readout measurements in `design-fixes-measurements.json`. These are offline presentation checks, not game evidence or an independent design PASS.

`holotable-friendly.test.ts` covers grid merge/split and bounded yields, viewpoint history and reduced motion, explicit routing and adapter release, Esc exclusions, human times, facet titles, card sections and remembered state, quiet stepping, district fading and the layer menu. `holotable-agent-canvas.test.ts` covers visible legend counts, cluster picking and effect suppression. The headless `layers.test.ts` verifies branch-aware totals at structure level. No game session is needed for this slice.

## Out of scope here

These are covered elsewhere:
- the glyph icons themselves (the UI track; see [glyphs](glyphs.md));
- the in-game overlay (canvas@1);
- content wording (each producer's own, for example the Story Engine's v1 readability pass).
