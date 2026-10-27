# Holotable as a friendly world map

**Status:** design, 27 October 2026. It follows the playback and glyphs round, after that lands.

Holotable is diagnostics, but it's held to a game world map's friendliness. Picture a holographic centrepiece that colleagues stand around, point at and drill into. It should be useful at a glance and dead simple to look closer at. Anything confusing, and any friction between what it offers and what a glance gives you, defeats its purpose. Producers own their content's wording (labels, details, glyphs). This page covers the presentation: what the view, the inspector and the layer list do with that content.

## At a glance

- **Legend.** A compact key sits in the view's lower left, generated from what is on the map now: one row per visible glyph family or kind, with its plate and a count ("People 12", "Events 3", "Places 5"). Nothing is listed that isn't there. It folds to a single "Key" button, and the fold is remembered per view. It reads over the shapes the way the scale bar does.
- **Clusters at distance.** When plates overlap on screen, they merge into one count plate ("5"), drawn in the dominant family's tone. Clicking it, or zooming in, separates them; a click on a cluster zooms in until it splits. This is how a world map stays readable when zoomed out, and it replaces most label culling at overview distances.
- **District names.** At overview distances, district names sit on the map as quiet labels. Below about 300 m they fade out.
- **Quiet stretches say so.** When nothing in the visible layers changes for a while, the readout says, for example, "Quiet until Day 2 · 14:30", and you can click it to jump there (the next-change action).

## Pointing at things

- **Hover card.** Hovering a plate for 250 ms shows a small card beside it: the title, one line of summary (the item's first detail line), when it happens, and its badge in words ("Blocked"). Moving away dismisses it. It never takes focus and never shifts layout. A click selects the item, which pins it in the inspector.
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

The legend, clusters and hover cards stay within the frame budget (8 ms steady). Clustering runs on the projected plates the frame already has, in a screen-space grid, which is linear in plates. The hover card is DOM, created once and repositioned.

## Out of scope here

These are covered elsewhere:
- the glyph icons themselves (the UI track; see [glyphs](glyphs.md));
- the in-game overlay (canvas@1);
- content wording (each producer's own, for example the Story Engine's v1 readability pass).
