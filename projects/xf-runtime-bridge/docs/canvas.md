# The world-space canvas (`canvas@1`)

**Stage: proposed, reviewed.** XF · Holotable approved it on 27 October with six changes, all folded in below. This is the bridge's schema for the in-game canvas that [Holotable](../../../research/live-world-view/proposal.md) asked for (its wants 10, 11 and 13; registry items `surfaces.canvas`, `surfaces.canvas-keys` and `link.display-feed`). It goes to XF · Holotable for review before anything is built. The outline was agreed on 26 October: **the bridge draws, producers decide what.** This page turns that outline into a contract and answers the phase 2 requirements (proposal §11a) that fall on the bridge.

## Contents

- [What the canvas is](#what-the-canvas-is)
- [Who may draw](#who-may-draw)
- [A batch](#a-batch)
- [Anchors](#anchors)
- [Primitives](#primitives)
- [Styling](#styling)
- [Views: the world and the radar](#views-the-world-and-the-radar)
- [Ownership, order and lifetime](#ownership-order-and-lifetime)
- [Caps and refusals](#caps-and-refusals)
- [Showing and hiding](#showing-and-hiding)
- [Threads and cost](#threads-and-cost)
- [What the canvas records](#what-the-canvas-records)
- [Commands, events and the Lua route](#commands-events-and-the-lua-route)
- [How it will be proven](#how-it-will-be-proven)
- [Settled in review](#settled-in-review)

## What the canvas is

A layer of plain primitives that the bridge's native overlay host draws over the game. It uses the same host that draws the XF box: Dear ImGui on the engine's present, click-through, themed from the Studio's tokens, aware of frame generation, hidden for captures and covered by the kill switch.

- **It never takes input.** The game plays normally underneath it.
- **It knows nothing about what it draws.** There are no item kinds, story content or content levels in the bridge. A producer turns its own model into primitives. The [publishing contract](#what-the-canvas-records) is how the canvas stays honest about what it showed.
- **It draws; it never reads the game per frame.** Once per game tick the bridge takes a camera snapshot and resolves a capped set of entity anchors. The render thread projects and draws from those snapshots.

## Who may draw

- **A new access class, `display`.** It changes only XF's own drawing, never the game, so it works from read-only connections, as `notify` (`ui.message`) already does. It needs neither `allow_writes` nor a write class.
- **Producers on the pipe** (the headless Holotable service, the Story Engine, agent tools) call `canvas.feed`.
- **CET modules** (Holotable's own in-game module) use the same batch shape through the Lua route ([below](#commands-events-and-the-lua-route)).
- **The kill switch clears and stops the canvas** like every other surface. `[overlay] canvas = false` in `config.ini` turns it off for good. Nothing is hooked beyond what the overlay host already hooks.

## A batch

A producer sends whole snapshots, one layer at a time. Each batch replaces everything that producer had on that layer, atomically. There are no deltas in `canvas@1`, so a dropped batch can never leave half a picture: the previous snapshot stays until a newer one arrives or its time to live runs out.

```json
{
  "schema": "canvas@1",
  "producer": "holotable",
  "layer": "actors",
  "world": 7,
  "seq": 1042,
  "ttl_s": 5,
  "views": ["world", "radar"],
  "items": [
    { "id": "a:3f1c", "kind": "bracket", "anchor": { "entity": "1234567890123" }, "color": "signal" },
    { "id": "a:3f1c/chip", "kind": "label", "anchor": { "entity": "1234567890123", "offset": [0, 0, 2.1] },
      "text": "ACTOR 2 · STEP 3", "style": "chip", "color": "signal" },
    { "id": "i:12", "kind": "circle", "anchor": { "world": [-1470.2, 1047.8, 24.1] }, "radius_m": 4,
      "ground": true, "dash": [0.6, 0.4], "color": "warning", "opacity": 0.8 }
  ]
}
```

| Field | Type | Rule |
|---|---|---|
| `schema` | `"canvas@1"` | Required. Unknown fields anywhere are refused, so a later schema's additions are explicit. |
| `producer` | name, `[a-z0-9_-]{1,32}` | The drawing's owner (see [ownership](#ownership-order-and-lifetime)). |
| `layer` | name, `[a-z0-9_.-]{1,48}` | At most 16 layers per producer. |
| `world` | integer | The world generation this batch was built for, as the recorder reports it today (`recorder.status`, `world_generation` on every sample). `game_status` gains the same field with the canvas. Pipe producers must send it, so `stale_world` can protect them. For CET producers the canvas fills it in. |
| `seq` | integer | Must rise for each (producer, layer). |
| `ttl_s` | 0.5–30, default 5 | The snapshot disappears unless refreshed within this time. |
| `views` | `world`, `radar`, or both | The default for its items; an item may narrow it. |
| `items` | array, up to the [caps](#caps-and-refusals) | An empty array clears the layer. |

## Anchors

Every item has exactly one anchor.

| Anchor | Meaning |
|---|---|
| `{ "world": [x, y, z] }` | A fixed world position, in the game's metres (Z up). |
| `{ "entity": "<id>", "offset": [x, y, z]? }` | An entity's position, resolved on the game thread each tick. The id is the decimal entity id the recorder and session events use. The offset is in world axes, not rotated with the entity. |
| `{ "screen": [u, v] }` | A point on the screen, 0–1 from the top left. Only `panel` and `label` take it. |

**Entity anchors have explicit states** (§11a requirement 5):

- `resolved` while the game gives a position this tick;
- `holding` for up to 1 s after it stops, drawn at the last position and fading linearly to 40 % opacity;
- `lost` after that: not drawn, and counted in `canvas.state`.

A new world generation drops every mapping. When more than 64 entity anchors compete, they are resolved round-robin across producers, and items still waiting are drawn as `holding` from their last position, so the oldest positions are always refreshed first.

## Primitives

All sizes are in world metres unless they end in `_px`. Pixel sizes are at 1x and scale with the overlay's DPI scale.

| Kind | Fields | Notes |
|---|---|---|
| `point` | `size_px` 2–16 (default 6) | A screen-sized dot. |
| `polyline` | `points` (2–256, absolute or anchor-relative per `relative`, default absolute), `closed`, `dash: [on, off]`, `width` | Dashes are split into segments by the host; every segment counts against the vertex cap. |
| `circle` | `radius_m`, `ground` (default true), `segments` 8–64 (default 32), `dash`, `width` | With `ground`, a polyline at the anchor's ground height, projected. |
| `polygon` | `points` (3–64, anchor-relative, Z ignored), `fill_opacity` 0–0.5, `width` | A filled shape flat on the ground at the anchor's height, for zones and territories. Its points count against the vertex cap. |
| `box` | `size: [x, y, z]`, `yaw_deg`, `dash`, `width` | A wire box centred on the anchor. |
| `bracket` | `pad_px` (default 6), `corner_px` (default 12) | Screen-space corner brackets around an entity, sized from its bounds where the game gives them and otherwise from a 0.6 × 1.9 m person-sized box. Entity anchors only. The bounds route is unproven until a session checks it. |
| `label` | `text` (at most 96 glyphs), `style: plain \| chip`, `leader` (default false), `offset_px` | `chip` draws on the canvas plate with a bevelled corner. Text is limited to the overlay's glyph ranges, as on the XF box. |
| `icon` | `glyph` (a name), `size_px` 12–24 (default 16), `plate` (default false) | One of the Studio's icons at a world or entity anchor, on the canvas plate when `plate` is set. The vocabulary is Holotable's ([glyphs](../../../research/live-world-view/glyphs.md)), and the shapes are the Studio's icon path data (`studio-ui/icons.ts`). The theme generator bakes them into the overlay's font atlas once at start, like the glyph ranges, so nothing is uploaded while drawing. An unknown glyph draws as a `point`, and `canvas.state` counts it. |
| `heat` | `cell_m`, `cols` and `rows` (1–32 each), `values` (`cols × rows` numbers 0–1, row by row from the anchor's corner), `max_opacity` (default 0.4, at most 0.4) | A field drawn as ground quads at the anchor's height, each at `value × max_opacity`. Cells of 0 are skipped. Each drawn cell counts as 4 vertices. World view only. An optional feature of `canvas@1`: `canvas.state` lists `heat` in `features` when the build draws it, and a build without it refuses the item `unsupported_kind`. |
| `panel` | `rect: [u, v, w, h]` (screen fractions), `title`, `lines` (at most 12 of `{ text, tone }`) | A screen-space plate for a legend or readout. Screen anchors only; never on the radar. |

Every item also takes:

- `id`: unique within its layer, at most 64 characters;
- `color`: a [token](#styling);
- `opacity`: 0–1, default 1;
- `views`: narrows the batch's `views`;
- `priority`: 0–9, default 5. When the screen is crowded, labels of lower priority are culled first.

`width` is `hair`, `normal` or `bold` (1, 1.5 and 2.5 px).

**Dash units.** `dash: [on, off]` is in metres in the `world` view and in pixels on the radar, where the host redraws the same pattern at a fixed screen size so it stays legible at any range. Each value is 0.05–20.

## Styling

**Colour is by token only.** No RGB values cross the wire. The tokens come from the generated in-game theme table (`tools/overlay/theme.ts`, from the Studio's tokens), in dark and light, so the canvas follows the overlay's theme without producers knowing it.

| Token | Studio token | Meaning in the Studio's design system |
|---|---|---|
| `text`, `text-muted` (alias `muted`), `text-faint` | `--text`, `--text-muted`, `--text-faint` | Neutral labels and values. `muted` lets producers' tones map one to one. |
| `signal` | `--signal` | Live data and selection. |
| `accent` | `--accent` | Commitment and focus only. |
| `success`, `warning`, `danger` | the same names | States; always paired with words. |
| `line` | `--line-strong` | Neutral geometry. |

**The canvas plate** is the translucent backing behind chips, panels and the radar. It is a new row in the in-game theme table, `CanvasPlate` (`--bg-overlay` at about 72 % opacity, where the XF box's plate is 97 %). The table is generated from the Studio's in-game theme (`in-game-theme.ts`), which belongs to the UI component track, so the row is requested from XF · Studio and reviewed there, not invented here. Producers never name the plate: chips, panels and the radar use it.

Typography follows the XF box: Cascadia Mono, or Consolas where it is missing, for values and ids; Bahnschrift capitals for panel titles.

## Views: the world and the radar

- **`world`** projects each primitive into the scene. Data draws above geometry: the canvas never depth-tests against the world, as the proposal's design asks.
- **`radar`** is one canvas-owned screen panel: a bevelled plate with a corner, a size, a range in metres and a heading-up or north-up orientation. It transforms world primitives top-down around V and clips them to the plate. A producer sends each primitive once.
- **Labels and brackets stay world-only** unless their `views` lists `radar`. Panels are never on the radar.
- **Holotable's CET window sets the radar** through `canvas.view` ([below](#commands-events-and-the-lua-route)). The bridge stores the last setting in its own state file, so it survives a restart.

## Ownership, order and lifetime

These rules answer §11a requirements 2 and 8.

- **A producer name belongs to one connection at a time.** The first connection to feed `holotable` holds it. Another connection is refused `producer_in_use` until the holder disconnects, so two processes can't collide on a layer. CET modules hold names in their own namespace (`cet.<module>`) and never collide with pipe producers.
- **Disconnecting withdraws everything that connection drew,** at once.
- **Order is per (producer, layer).** A batch whose `seq` is not above the last accepted one is refused `stale_seq`, so a late batch can never restore an obsolete drawing.
- **Worlds.** A batch for a world generation other than the current one is refused `stale_world`. A save load, a new game or the kill switch clears the whole canvas and bumps the generation.
- **Time to live.** Each layer's snapshot disappears `ttl_s` after it was accepted unless a newer batch replaces it. Nothing on the canvas outlives its producer's attention.
- **Handover** (`session_handover`) leaves the canvas as it is. Producers that draw XF actors are expected to clear those layers when the session event says the actors were released.

## Caps and refusals

The caps are the ones agreed on 26 October. A batch over a cap is refused whole, with the cap named, and the previous snapshot stays.

| Cap | Limit | Refusal |
|---|---|---|
| Items per producer (all its layers) | 256 | `canvas_cap {cap: "items", limit, got}` |
| Vertices per producer, after dashes and circle segments are expanded | 4,096 | `canvas_cap {cap: "vertices", …}` |
| Bytes per batch, as received | 64 KB | `canvas_cap {cap: "bytes", …}` |
| Items across all producers | 1,024 | `canvas_cap {cap: "total_items", …}` |
| Vertices across all producers | 16,384 | `canvas_cap {cap: "total_vertices", …}` |
| Entity anchors resolved per tick | 64 | Never refused: round-robin, with the rest `holding` |
| Batches per (producer, layer) | 4 per second | `rate {retry_after_ms}`; nothing is queued |
| Batches per producer, all layers | 16 per second | `rate {retry_after_ms}` |
| Layers per producer | 16 | `canvas_cap {cap: "layers", …}` |

Malformed batches are refused `bad_batch` with the first JSON path at fault.

## Showing and hiding

- **Two keys** go through the bridge's own key route, the same one as its stop key, and are rebindable in CET:
  - `canvas.toggle` shows and hides the canvas (default **Ctrl + Shift + Insert**);
  - `canvas.mode` switches between radar only and radar with world markers (default **Ctrl + Shift + Delete**).

  Both are toggles, never holds. The defaults follow the stop key's rule (Ctrl + Shift + End): the game's 2.31 default bindings use neither Insert nor Delete. Of the 23 mods in the study library, one HUD editor lists both bare in its key table and one photo-mode mod uses bare Delete inside a text field. None uses either with Ctrl + Shift. Page Up and Page Down were rejected because a photo-mode mod and a HUD mod use them bare. CET's overlay key is chosen by each player, so the load log warns if a canvas key matches it.

  `canvas.state` reports both bindings.
- **`canvas.visible {visible, mode}`** is a session event each time either changes, so producers can subscribe.
- **Hidden costs nothing.** While the canvas is hidden, `canvas.feed` answers `{accepted: false, dropped: "hidden"}` and keeps nothing. No camera snapshot is taken and no anchors are resolved. When it is shown again, the event carries `resend: true` and each producer sends a fresh snapshot. The canvas draws only what arrives after that.
- **Captures hide the canvas**, like the XF box, unless a capture asks for it (`capture.screenshot {overlay: "canvas"}`), so Holotable's own evidence can include it.

## Threads and cost

| Thread | Work | Budget (p99, at the caps) |
|---|---|---|
| Pipe | Parse and validate a batch into an immutable snapshot, expanding dashes and circles | 2 ms per 64 KB batch |
| Game, once per tick, only while shown | Camera snapshot (position, orientation, FOV, viewport) and up to 64 anchor positions | 0.15 ms |
| Render, once per present | Take the newest snapshot (the host's triple buffer, never waiting), project, cull, draw | 0.5 ms |

- **Nothing makes game calls per frame,** and no thread waits on another.
- **`canvas.state` reports each figure,** both shown and hidden (§11a requirement 4), so the budget is measured, not asserted.
- **Frame generation.** Generated frames get the canvas drawn from the newest real-frame camera, which the host already handles for the XF box. Whether markers swim visibly on generated frames is a session check, not an assumption.

## What the canvas records

§11a requirement 1 says nothing may appear in game that replay, the Studio view and agents can't see. The canvas can't check a producer's model, but it makes what it drew auditable.

- **Every accepted batch adds a bounded `canvas.fed` session event**, which the recorder keeps:
  - who and where: producer, layer, world, seq;
  - how much: the item count;
  - its digest: the SHA-256, in lowercase hex, of the batch's canonical JSON as received. Canonical means [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS): keys sorted, no whitespace, numbers in ECMAScript's shortest form. In TypeScript that is `JSON.stringify` with keys sorted at every level. The bridge's C++ follows the same rules, and the conformance fixtures include digest vectors, so both sides are checked to agree.

  The items themselves are not recorded.
- **Producers publish the matching items** to Holotable's model under the same seq and digest. A replay can then show every drawn batch beside its items, and flag one with no match.
- **Refusals add `canvas.refused` events,** with the reason, at most one per producer per second.

## Commands, events and the Lua route

| Name | Class | What it does |
|---|---|---|
| `canvas.feed` | display | A [batch](#a-batch). Answers `{accepted, items, vertices}` or a refusal. |
| `canvas.clear` | display | `{producer, layer?}`: clears one layer of the caller's own producer, or all of them. |
| `canvas.view` | display | `{radar: {corner, size_px, range_m, orientation, opacity}}`: the radar's settings. |
| `canvas.state` | read | Visible and mode; key bindings; producers and, per layer, item and vertex counts, the last accepted seq and the last refusal (reason, cap and time), so a producer can show it in place; anchor states; unknown glyphs; cost figures; supported schemas (`["canvas@1"]`) and optional features (`["heat"]`). |
| `canvas.visible` | event | `{visible, mode, resend}`. |
| `canvas.fed`, `canvas.refused` | events | As [above](#what-the-canvas-records). |

**The Lua route.** In CET, `XFBridge.Canvas.Feed(batch)`, `XFBridge.Canvas.Clear(layer)`, `XFBridge.Canvas.View(settings)` and `XFBridge.Canvas.State()` take the same shapes as Lua tables. They go through the same validation and caps, with the producer fixed to `cet.<module>`. Holotable's module calls them from CET's update, not its draw, a few times a second. The read-only snapshot it builds from (want 12, `surfaces.lua-snapshot`) is a separate item with its own page.

## How it will be proven

- **Offline.**
  - The self-test runs shared conformance fixtures: batches with the projected output expected for a fixed camera, refusals included.
  - The same fixtures are published for Holotable's TypeScript preview, so the Studio view and the game agree on geometry.
  - Fuzzed batches must never exceed the caps or crash the parser.
- **In game, one session.** Rows for:
  - every primitive in both themes;
  - entity brackets on XF actors;
  - the anchor states when an actor despawns;
  - the radar in both orientations;
  - the keys;
  - hidden cost;
  - the budgets at the caps;
  - a save load clearing the canvas;
  - the capture rule.

  Each row's verdict goes into the registry through `verdict`.

## Settled in review

XF · Holotable's answers (27 October):

1. **Snapshots and 256 items per producer are enough.** Holotable is the only pipe producer: the Story Engine publishes to Holotable, not to the canvas, and Holotable does its own level of detail near V. The rate is per layer (4 a second), with 16 a second per producer, so a dozen story layers at 1 Hz can each refresh.
2. **Offsets in world axes** are fine.
3. **Keys** are toggles, proposed [above](#showing-and-hiding).
4. **`world`** is explicit from pipe producers and filled in for CET producers.
5. **The digest** is SHA-256 over RFC 8785 canonical JSON, specified [above](#what-the-canvas-records).

The six changes it asked for are in: the `icon` primitive, dash units, 64-point polygons, the optional `heat` primitive, the `muted` tone and the per-layer refusal in `canvas.state`.
