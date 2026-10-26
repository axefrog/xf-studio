# Agent diagnostic layers

**Status:** design, 27 October 2026. Holotable's primary producer at this stage is the Story Engine, and other XF agents use it too: it lets them draw what they reason about (control points, zones, fields, influences, steering targets) into a real view of the game world, as diagnostics. Its core purpose is the Story Engine's: to present what it simulates and generates directly against game data, live or in replay, so the maintainer can see and verify it during the game or afterwards. That means who and what was generated; what they're doing, saying, thinking and planning; how the dimensions of concern layer and intersect in a given context; and where quest lines are meant to play out. This page is the write route that makes agents producers, under the [layer contract](proposal.md#3-architecture-and-decoupling). It comes before the in-game overlay. The overlay then draws the same layers, through the same projection specs.

## What an agent does

1. **Publishes a layer:** one manifest, then items. Each item is a typed thing at a place and a time, never drawing instructions.
2. **Sees it at once** in the Studio's Holotable view, over the replay or the live game, toggled per layer, with every item answering "why" through its citation.
3. **Reads it back** through `holo_report` and the service's `session.report`, so an agent can check what it drew without a screenshot.

## The route

| Route | For | Notes |
|---|---|---|
| **Spool files** `local/holotable/layers/<producer>/<layer>.jsonl` | Any agent or script, with no connection needed | Append-only JSON lines: the first line is the manifest, every other line is an item or a retraction. The service watches the folder (polling at 1 Hz only while a view is shown) and reads only what's new. Spools persist, so a layer stays reviewable after the session. |
| **CLI** `bun projects/xf-holotable/tools/holo.ts publish <producer>/<layer> [file or stdin]` | Agents in a shell | Validates the batch before appending, and prints refusals in plain words. |
| **Service** `layers.publish` over the existing JSON-lines stdio | Clients already speaking to the service | The same validation; writes the same spool. |
| **MCP** `holotable_publish` | Agents in sessions with MCP | Later: a thin wrapper over `layers.publish`. |

Spool folders are ignored and private, like recordings. Content levels apply to them as to everything else (`structure` versus `full`).

## Schemas

**Manifest** (`xfh/layer-1`): `{ schema, producer, layer, title, description?, content: "structure"|"full", clock: "recording"|"wall", session?, run?, kinds: [...] }`.
- `producer` and `layer` are lowercase slugs, and their pair names the layer.
- `clock: "recording"` means item times are the recorder's QPC seconds, the same clock as V's samples, so items line up with a replay or the live feed. `"wall"` means ISO times. They convert through a wall-clock mapping when one exists: live, from `recorder.status`'s `start: { s, at }`; in replay, from the run manifest once it carries one (requested from the bridge as `recorder.manifest-wall-clock`). A wall-clock item for a recording with no mapping is refused, with: "This recording has no wall-clock time; publish with the recording clock instead."
- A layer bound to a `session`/`run` shows only with that recording. Without one, it shows with any recording.

**Item** (`xfh/item-1`): `{ id, kind, t?, until?, anchor, value?, label?, tone?, weight?, cite?, detail? }`.
- `id` is stable within the layer. Re-publishing an id replaces the item from that time on; `{ "retract": id, "t": …, "branch"?: … }` removes it. A retraction's branch wins over the manifest's branch, exactly as for items; it applies on every branch only when both are absent.
- `t` and `until` bound when the item exists. With neither, it exists for the whole recording.
- `anchor` is one of:
  - `{ at: [x,y,z] }`;
  - `{ entity: "<id>" }`, resolved through the recorder's `actors` channel (its actor handles and positions over time, read from recordings and from the live feed). An entity with no known position at a moment isn't drawn, and the layer's row says "N not placed" with the ids as its tooltip;
  - `{ path: [[x,y,z], …] }`;
  - `{ zone: { poly: [[x,y]…], zlo, zhi } }`;
  - `{ box: { min, max } }`;
  - `{ sphere: { at, r } }`;
  - `{ grid: { origin: [x,y,z], cell, cols, rows } }`;
  - `{ region: "<place id>" }`, a named district, subdistrict, venue or streaming cell, resolved through the world pack's places (the same ids the places research uses). A region with no known outline isn't drawn, and counts in "N not placed".
- `label` is short text, shown at the `full` content level, or always if the layer is `structure` and the label carries no story content. `detail` is longer text for the inspector.
- `tone` is one of `signal`, `accent`, `warning`, `danger`, `muted` (default `signal`), mapped to Studio tokens. Producers never choose colours.
- `weight` (0–1) scales emphasis: opacity and size.
- `cite` is a record id (`recorder:<run>:<seq>`, `event:<sid>:<seq>`, `se:<id>`, `agent:<producer>:<note>`). Required for every kind except `label`.

**Kinds (version 1)**, each with its projection spec:

| Kind | Anchor | Value | Drawn as |
|---|---|---|---|
| `point` | at or entity | none | a ring marker with an optional label |
| `path` | path | none | a polyline; weight sets its width |
| `zone` | zone, box or sphere | none | the outline at the base, a faint top, and a faint fill; weight sets the fill |
| `field` | grid | `scalars: number[]` (cols×rows) or `vectors: [dx,dy][]` | a heat grid (scalars: tone intensity per cell) or arrows (vectors: per cell, length by magnitude) |
| `influence` | at or entity (the source) | `to: anchor` | an arrow from source to target; weight sets thickness |
| `target` | at or entity | `from?: anchor` | a crosshair marker, with a dashed line from `from` when given |
| `label` | at or entity | none | text only |
| `actor` | at, entity, zone, box, sphere or region | `name`, `role?`, `facets?` | a person or thing someone generated: a diamond marker with its name. On an area anchor (a group on its territory, a coarse resident known only by district), the marker sits at the area's centre and the area's outline is drawn faintly in the actor's tone. Its `facets` are an ordered map of short named states (for example `doing`, `saying`, `thinking`, `planning`, `mood`, `goal`), shown in the inspector and as a one-line caption under the name (the first facet), at the `full` content level. Re-publishing the same `id` over time makes it a track that moves and changes. |

**Region as a fallback anchor.** `point`, `target`, `label` and `influence` (either end) also accept `{ region }` when a producer knows only the cell or district. The marker sits at the region's label point: the world pack's label point, else the outline's centroid. The region's outline isn't drawn for these kinds; selecting the marker highlights it faintly. Markers that share a region's label point fan out on a small ring (radius 12 px, placed deterministically by id), so none hides another. Above 12, they collapse into one count badge ("+N") that lists them in the inspector when selected. The inspector says "Placed by district: <name>" or "by cell", so a fallback never passes for a measured position.

**Facets on any item.** Every kind may carry `facets` too, as above. They are the "dimensions of concern" a producer wants seen together, kept as plain labelled text, not drawing.

| `relation` | `{ item: "<producer>/<layer>/<id>" }`, `{ item: "<layer>/<id>" }` within this producer, or `{ item: "<id>" }` within this layer (an actor, point, target or zone; a zone end uses its label point, else its centroid). Missing or ambiguous references count as not placed. | `to: { item }`, `type`, `strength?` (0–1), `mutual?` | an edge between the two items' current places: a gently curved line, its thickness set by strength and with an arrowhead unless mutual, and its `type` ("owes", "loyal to", "hunting", …) at the midpoint. An actor's inspector lists its relations. Together, relations draw the web of relationships among generated people and things. |

**Content.** Names, captions, facets, relation types, labels and details at the `full` content level are story content. **They're shown by default:** Holotable is for looking into the fishbowl, and seeing what's being simulated, story included, is the point. Hiding them is a player option: the **Story content** switch in the Show group, on by default, and switching it off drops to the `structure` level at the service boundary. At `structure`, an actor is a named role ("generated fixer") or just its kind, and a relation is an untyped edge.

## Bounds and refusals

- Per layer: at most 5,000 live items, 16 MB of spool, and 2 batches a second through the CLI or service. Fields: at most 128×128 cells.
- Labels are at most 160 characters; details 4,000. Facets have at most 16 entries, with keys up to 40 characters and values up to 500 (a complete dialogue line may be a facet). Paths and polygons have at most 4,096 vertices. A spool line is at most 1 MiB. Retractions require `t`.
- Anything malformed is refused with a counted, plain reason, and the layer's row in the view shows "N refused" with the first reason as its tooltip. One bad line never drops the layer.
- Drawing is clipped and distance-faded, beneath V and the trail but above the solid shapes, at most 8 ms a frame together in steady state. Cold preparation, including its resumed frames, may take up to 12 ms a frame. Agent data draws first, with about 4 ms for its work; solid preparation and drawing yield within the remaining allowance and resume next frame. Hidden views and superseded frames cancel continuations. Report cold completion frames and total preparation time separately.

## In the Studio

- Holotable Details gains an **Agent layers** group (the existing GroupSection). Layers are grouped by producer: one Toggle row per producer, which switches all of its layers, then one Toggle row per layer under it, titled with the layer's title, plus a muted "N items" meta line. A new layer appears switched on. A producer may publish many layers (for example one per district) and that stays cheap: budgets are per layer, and a hidden layer costs nothing to draw.
- Selecting an item shows its kind, label, facets, detail, time span and citation in the inspector, like an event.
- **What's here.** Selecting a place, by clicking the ground or a solid shape, lists in the inspector every item from every visible layer that covers that place at that moment: zones containing it, fields sampled there, actors and points within 15 m, and paths passing within 5 m. They're grouped by layer, nearest first. This is how the intersecting dimensions of a context are read together. The same query answers `session.report` with a position.
- Nothing about this flow needs a new component. If one does, it comes back to the design lead.

## Next slice (specified; built after this one)

- **The game clock.** `clock: "game"`: numeric game seconds from the game's epoch, native in standalone sets. Recording alignment reads V's `game_time_s` or manifest `game_time_samples: [{ source_s, game_s }]`, requested from the bridge. It is piecewise linear between mappings, with at most 30 source seconds of extrapolation; no mapping means a plain refusal, never an invented rate. Game-clock sets show `Day D · HH:MM` on the slider and readout (day 1 starts at 0).
- **Layers-only timelines.** `standalone: { set, title?, from, to, clock }`, without session or run. A producer's layers with the same explicit set slug form one Recordings row: the first manifest's standalone title, else its set name, then "layers only · <span>". All manifests in a set agree on from, to and clock; a disagreement is refused. Opening it gives a timeline over the offline world (districts and solid shapes around the layers' extent) with no V. The camera orbits the selection, or the extent's centre.
- **Branches.** An optional plain-text `branch` on the manifest or item; an item's wins. Unbranched items show on every branch. A layers-only set with several branches has a button-set choice above the slider; one branch has no choice. Recordings and live feeds have no branch identity today, so only unbranched items show there; the layer row reports "N on other branches", with branch names in its tooltip. A load never pretends continuity.

## Order

1. Spool, CLI and service write; Studio rendering over replay and live; read-back through the report (this milestone).
2. The next slice above, and the MCP wrapper.
3. The in-game overlay draws the same kinds through canvas@1 (milestone 7).
4. The Story Engine publishes its structure layers through this same route (milestone 8).
