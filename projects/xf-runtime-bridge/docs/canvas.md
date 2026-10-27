# The world-space canvas (`canvas@1`)

**Stage: built offline, not run in game.** The unversioned **canvas candidate** implements the bridge's drawing contract for [Holotable](../../../research/live-world-view/proposal.md), reviewed by XF · Holotable on 27 October. The bridge draws; producers decide what. [Candidate evidence and commissioning rows](canvas-candidate.md) distinguish offline checks from the game session still required. `heat` is not implemented: `features` is empty and heat batches refuse `unsupported_kind`. No release version has been assigned.

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

- **A new access class, `display`.** It changes only XF's own drawing, never the game. Besides reads, display is the only ordinary command class observers may use; the existing emergency control routes remain available. `notify` remains refused on observer connections. Display needs neither `allow_writes` nor a write class.
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
| `{ "entity": "<id>", "offset": [x, y, z]? }` | An entity's position, read in paced game-thread batches independently of the camera tick. The id is the decimal entity id the recorder and session events use. The offset is in world axes, not rotated with the entity. |
| `{ "screen": [u, v] }` | A point on the screen, 0–1 from the top left. Only `panel` and `label` take it. |

**Entity anchors have explicit states** (§11a requirement 5):

- `resolved` from a successful position read through its expected next refresh plus 0.25 s of grace;
- `holding` for up to 1 s after that freshness deadline, drawn at the last position and fading linearly to 40 % opacity;
- `lost` after that: not drawn, and counted in `canvas.state`.

A new world generation drops every mapping. `[overlay] canvas_anchor_hz` is an integer 1–20 (default 10); `canvas_anchors_per_read` is 4–32 (default 16). Reads are at most that rate, with no catch-up bursts after a slow tick. The wanted set is deduplicated and visited round-robin, oldest attempted first with producer-interleaved ties. At defaults, 64 anchors take four reads over a 0.4 s refresh cycle; expected refresh is `ceil(wanted anchors / anchors per read) / anchor Hz`. An anchor keeps its last position fully opaque between reads, including the 0.25 s grace. A failed lookup never extends its freshness. A never-resolved anchor is `lost`; successful recovery immediately restores `resolved`. State reporting and drawing evaluate the same deadlines even between publications.

## Primitives

All sizes are in world metres unless they end in `_px`. Pixel sizes are at 1x and scale with the overlay's DPI scale.

| Kind | Fields | Notes |
|---|---|---|
| `point` | `size_px` 2–16 (default 6) | A screen-sized dot. |
| `polyline` | `points` (2–256, absolute or anchor-relative per `relative`, default absolute), `closed`, `dash: [on, off]`, `width` | Dashes are split into segments by the host; every segment counts against the vertex cap. |
| `circle` | `radius_m`, `ground` (default true), `segments` 8–64 (default 32), `dash`, `width` | With `ground:true`, a polyline on XY at the anchor's height. `ground:false` is a camera-facing ring in the active camera's right/up plane at the anchor, with the same radius in metres. Both draw as the same top-down circle on the radar. |
| `polygon` | `points` (3–64, anchor-relative, Z ignored), `fill_opacity` 0–0.5, `width` | A filled shape flat on the ground at the anchor's height, for zones and territories. Its points count against the vertex cap. |
| `box` | `size: [x, y, z]`, `yaw_deg`, `dash`, `width` | A wire box centred on the anchor. |
| `bracket` | `pad_px` (default 6), `corner_px` (default 12) | Screen-space corner brackets around an entity, sized from its bounds where the game gives them and otherwise from a 0.6 × 1.9 m person-sized box. Entity anchors only. The bounds route is unproven until a session checks it. |
| `label` | `text` (at most 96 glyphs), `style: plain \| chip`, `leader` (default false), `offset_px` | `chip` draws on the canvas plate with a bevelled corner. Its text is always `text`; the item colour marks its edge. Text is limited to the overlay's glyph ranges, as on the XF box. |
| `icon` | `glyph` (a name), `size_px` 12–24 (default 16), `plate` (default false) | One of the Studio's icons at a world or entity anchor, on the canvas plate when `plate` is set. The vocabulary is Holotable's ([glyphs](../../../research/live-world-view/glyphs.md)), and the shapes are the Studio's icon path data (`studio-ui/icons.ts`). The theme generator flattens the Studio SVG paths to vector polylines and fill polygons at a fixed 0.08-unit tolerance in the original 16-unit icon box. Native drawing uses that generated geometry; there is no runtime SVG parsing or texture upload. Stroke dashes are expanded by the generator; a glyph over 256 source vertices fails generation. This vector route replaces the earlier atlas proposal by coordinator agreement. An unknown glyph draws as a `point`, and `canvas.state` counts it. |
| `heat` | `cell_m`, `cols` and `rows` (1–32 each), `values` (`cols × rows` numbers 0–1, row by row from the anchor's corner), `max_opacity` (default 0.4, at most 0.4) | A field drawn as ground quads at the anchor's height, each at `value × max_opacity`. Cells of 0 are skipped. Each drawn cell counts as 4 vertices. World view only. An optional feature of `canvas@1`: `canvas.state` lists `heat` in `features` when the build draws it, and a build without it refuses the item `unsupported_kind`. |
| `panel` | `rect: [u, v, w, h]` (screen fractions), `title`, `lines` (at most 12 of `{ text, tone }`) | A screen-space plate for a legend or readout. Screen anchors only; never on the radar. Text always uses `text`; line tones mark the leading edge. |

Every item also takes:

- `id`: unique within its layer, at most 64 characters;
- `color`: a [token](#styling);
- `opacity`: 0–1, default 1;
- `views`: narrows the batch's `views`;
- `priority`: 0–9, default 5. When the screen is crowded, labels of lower priority are culled first.

`width` is `hair`, `normal` or `bold` (1, 1.5 and 2.5 px).

**Dash units.** `dash: [on, off]` is in metres in the `world` view and in pixels on the radar, where the host redraws the same pattern at a fixed screen size so it stays legible at any range. Each value is 0.05–20. Dash phase continues across a polyline or circle, including clipped edges; box edges restart it. Radar dashes have a separate 16,384-vertex frame budget and at most 64 dash segments per source segment. The solid baseline is reserved first; expansions past either budget draw solid instead. `canvas.state.radar_dash_downgraded` counts these source segments on the latest drawn frame. A view change never refuses because of existing content. No radar geometry is culled to satisfy this budget.

## Styling

**Colour is by token only.** No RGB values cross the wire. The tokens come from the generated in-game theme table (`tools/overlay/theme.ts`, from the Studio's tokens), in dark and light, so the canvas follows the overlay's theme without producers knowing it.

| Token | Studio token | Meaning in the Studio's design system |
|---|---|---|
| `text`, `text-muted` (alias `muted`), `text-faint` | `--text`, `--text-muted`, `--text-faint` | Neutral labels and values. `muted` lets producers' tones map one to one. |
| `signal` | `--signal` | Live data and selection. |
| `accent` | `--accent` | Commitment and focus only. |
| `success`, `warning`, `danger` | the same names | States; always paired with words. |
| `line` | `--line-strong` | Neutral geometry. |

**The canvas plate** is the translucent backing behind chips, panels and the radar: the Studio's generated `XfCanvasPlate` slot, `--bg-overlay` alpha multiplied by 0.74 (effective alpha 0.7178 with the current token). The Studio owns this row; no fallback plate is needed. Text on a plate always uses `--text`, never muted or faint, because it must retain contrast over a bright scene. A chip's item colour marks its bevel, and each panel line's tone marks its leading edge; plain labels keep their requested colour.

Typography follows the XF box: Cascadia Mono, or Consolas where it is missing, for values and ids; Bahnschrift capitals for panel titles.

## Views: the world and the radar

- **`world`** projects each primitive into the scene. Data draws above geometry: the canvas never depth-tests against the world, as the proposal's design asks.
- **`radar`** is one canvas-owned screen panel: a bevelled plate with a corner, a size, a range in metres and a heading-up or north-up orientation. It transforms world primitives top-down around V and clips them to the plate. A producer sends each primitive once.
- **Labels and brackets stay world-only** unless their `views` lists `radar`. Panels are never on the radar.
- **Holotable's CET window sets the radar** through `canvas.view` ([below](#commands-events-and-the-lua-route)). The bridge stores the last setting in `canvas-view.json` beside its session file, so it survives a restart. Changes apply immediately; the bridge worker writes the last pending value at most once every two seconds and shutdown flushes it. The response says `pending`; `canvas.state.view_persistence` reports pending/error/last-save status. Defaults: `bottom_right`, `size_px: 240`, `range_m: 50`, `heading_up`, `opacity: 1`. Corners are `top_left`, `top_right`, `bottom_left`, `bottom_right`; size is 120–640 logical pixels, range 1–2,000 metres (centre to edge), opacity 0–1. `canvas.view` accepts a partial radar object and validates it atomically.

## Ownership, order and lifetime

These rules answer §11a requirements 2 and 8.

- **A producer name belongs to one connection at a time.** The first connection to feed `holotable` holds it. Another connection is refused `producer_in_use` until the holder disconnects, so two processes can't collide on a layer. CET modules hold names in their own namespace (`cet.<module>`) and never collide with pipe producers.
- **Disconnecting withdraws everything that connection drew,** at once.
- **Order is per (producer, layer).** A batch whose `seq` is not above the last accepted one is refused `stale_seq`, so a late batch can never restore an obsolete drawing.
- **Worlds.** A batch for a world generation other than the current one is refused `stale_world`. An accepted load request, a world detach/new game or the kill switch clears the whole canvas and bumps the generation. Generation is an invalidation token, not a count of detaches; a load request and its later detach can each advance it.
- **Time to live.** Each layer's snapshot disappears `ttl_s` after it was accepted unless a newer batch replaces it. Nothing on the canvas outlives its producer's attention.
- **Handover** (`session_handover`) leaves the canvas as it is. Producers that draw XF actors are expected to clear those layers when the session event says the actors were released.

## Caps and refusals

These caps bound each replacement snapshot and all retained producers. A batch over a cap is refused whole, with the cap named, and the previous snapshot stays.

The raw 64 KiB ceiling is checked before parsing as a memory-safety prerequisite. After strict parsing, cap refusals follow the order in this table: **items, vertices, layers, metadata, rates**. Within items/vertices, the per-producer cap precedes the total cap; within rates, the layer cap precedes the producer cap. Whole-batch refusal keeps the previous snapshot.

| Order | Cap | Limit | Refusal |
|---|---|---|---|
| 0, before parsing | Bytes per batch, as received | 64 KiB | `canvas_cap {cap: "bytes", limit, got}` |
| 1 | Items per producer (all its layers) | 256 | `canvas_cap {cap: "items", limit, got}` |
| 1 | Items across all producers | 1,024 | `canvas_cap {cap: "total_items", …}` |
| 2 | Vertices per producer | 4,096 | `canvas_cap {cap: "vertices", …}` |
| 2 | Vertices across all producers | 16,384 | `canvas_cap {cap: "total_vertices", …}` |
| Accounting for 2 | Counted vertices per primitive | max(solid geometry, expanded world geometry); line geometry uses two endpoints per segment, including shared corners, plus polygon fill points; icons use generated source vertices | Admission and radar expansion use the same endpoint unit; a 64-segment circle reserves 128 solid endpoints |
| 3 | Layers per producer | 16 | `canvas_cap {cap: "layers", …}` |
| 4 | Retained producer/layer keys, union of drawing/seq and live rate-history keys | 1,024 total, including empty/expired layers and cleared keys with a live one-second rate window | `canvas_cap {cap: "metadata", …}` |
| 5 | Batches per (producer, layer) | 4 per second | `rate {retry_after_ms}`; nothing is queued |
| 5 | Batches per producer, all layers | 16 per second | `rate {retry_after_ms}` |
| Scheduling, not refusal | Entity anchors per paced read | 16 by default; configurable 4–32 at 1–20 Hz (default 10 Hz) | Round-robin; freshness follows the expected cycle plus 0.25 s grace |

**Vertex counting:** for each primitive, count **max(solid geometry vertices, expanded world-view vertices)**. Solid circle, polyline, polygon and box outlines use two endpoints per segment, even where segments share a corner. Polygon fill reserves its point count as well; an icon reserves its generated count. Expanded world geometry uses the same endpoint/fill unit. Screen primitives reserve point/label 1, bracket 16 and panel 4; an unavailable icon reserves 1. The larger count is summed across items and layers. Thus even a long-gap dashed 64-segment circle reserves 128 solid radar endpoints at admission. The same 4,096/16,384 caps bound all solid radar content; only extra radar dash endpoints need the draw-time budget. No solid content is culled to meet that budget.

Expiry retains the owner and sequence record so late feeds remain `stale_seq`. Explicit `canvas.clear` releases drawing/sequence records, and disconnect/world reset releases the corresponding ownership records. **Rate histories are independent:** clear, disconnect and visibility/world resets do not erase accepted timestamps during their one-second window. Admission prunes expired rate histories and counts the union of retained layer keys against the metadata cap, so name churn cannot grow them unboundedly. Last refusal receipts are bounded to 1,024 records, including failed first feeds, and exposed in `last_refusals` as well as on admitted layers.

Malformed batches are refused `bad_batch` with the first JSON path at fault.

## Showing and hiding

**What each mode draws.** Both shown modes draw the radar and screen-anchored panels/labels as screen furniture. Radar-only mode hides only world/entity-projected primitives; radar-with-world-markers draws them too. Screen furniture is drawn once on the screen, outside the radar clip, and still needs the `world` bit in both its layer and item view masks. A radar-only view mask does not turn a panel into radar content. Hidden mode draws neither.

- **Two keys** go through the bridge's own key route, the same one as its stop key, and are rebindable in CET:
  - `canvas.toggle` shows and hides the canvas (default **Insert**);
  - `canvas.mode` switches between radar only and radar with world markers (default **Delete**).

  Both are toggles, never holds. The keys are `canvas_toggle` and `canvas_mode` under `[overlay]` in `config.ini`; `off` disables a key. CET can change and persist them with `XFBridge.Canvas.Keys({toggle="Insert", mode="Delete"})`. Persistence requires a successful exact read of the whole existing config; any read failure leaves it untouched and reports `saved:false` while the live binding lasts until exit. The CET binding parser refuses modifiers and duplicate active keys; if config.ini gives both actions the same active key, the mode key is disabled with a warning. The canvas starts hidden, in radar-only mode. Each is one bare key, so a player can press it mid-play without stopping. Modifiers are avoided because Ctrl and Shift are game keys on their own (crouch, sprint and dodge), so a Ctrl + Shift combination would make V crouch and sprint for a moment. The game's 2.31 default bindings use neither Insert nor Delete; they do use Home, which ruled it out. Among the 23 mods in the study library:
  - a HUD editor maps both keys, along with nearly every other key, as raw inputs for its own editor;
  - a photo-mode mod reads Delete only inside its text field.

  Neither conflicts during play. Page Up and Page Down were rejected because two of those mods use them. CET's overlay key is chosen by each player, so the load log warns if a canvas key matches it.

  `canvas.state` reports both bindings.
- **`canvas.visible {visible, mode}`** is a session event each time either changes, so producers can subscribe.
- **Hidden costs nothing.** While the canvas is hidden, `canvas.feed` answers `{accepted: false, dropped: "hidden"}` and keeps nothing. No camera snapshot is taken and no anchors are resolved. When it is shown again, the event carries `resend: true` and each producer sends a fresh snapshot. The canvas draws only what arrives after that.
- **Captures hide the canvas**, like the XF box, unless a capture asks for it (`capture.screenshot {overlay: "canvas"}`), so Holotable's own evidence can include it.

## Threads and cost

| Thread | Work | Budget (p99, at the caps) |
|---|---|---|
| Pipe | Parse and validate a batch into an immutable snapshot, expanding dashes and circles | 2 ms per 64 KB batch |
| Game camera, once per tick, only while shown | Minimal camera/V snapshot: position, camera basis and FOV, V position/yaw; host supplies viewport | 0.05 ms per tick, measured in game |
| Game anchors, paced separately, only while shown | Up to `canvas_anchors_per_read` direct entity lookups at most `canvas_anchor_hz` times per second; defaults 16 at 10 Hz | 0.15 ms per read, measured in game |
| Render, once per present | Take the newest snapshot (the host's triple buffer, never waiting), project, cull, draw | 0.5 ms |

- **The renderer makes no game calls.** Only the small camera/V read runs every game tick. Entity lookup, entity JSON construction and its parse run only on scheduled anchor reads. Both routes stop while hidden or capture/CET suppression is active. Core publication uses try-locks; rendering consumes the triple buffer without a canvas lock.
- **`canvas.state` reports each figure,** both shown and hidden (§11a requirement 4), so the budget is measured, not asserted. `anchor_reads` reports configured Hz, per-read bound, observed reads in the preceding second, total reads, expected refresh interval and grace. `costs.camera` and `costs.anchors` report independent per-tick/per-read timings; `costs.publication` separately reports snapshot publication. Each includes last, max, 256-sample p99 and total count. The camera/anchor budgets require CV game evidence.
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
| `canvas.state` | read | Visible and mode; key bindings; producers and, per layer, item and vertex counts, the last accepted seq and the last refusal (reason, cap and time), so a producer can show it in place; anchor states; unknown glyphs; cost figures; supported schemas (`["canvas@1"]`) and optional features (`[]` in this candidate). |
| `canvas.visible` | event | `{visible, mode, resend}`. |
| `canvas.fed`, `canvas.refused` | events | As [above](#what-the-canvas-records). |

**Display attempts and read headroom.** The display class is exempt from the general connection request budget and observer ceiling; these three commands do no game-thread work. Each connection has a separate **16 attempts/s, burst 24** token bucket. Every feed attempt (including invalid or hidden feeds), clear and view spends it before JSON DOM construction or canvas parsing: a bounded RPC envelope scan locates the method and authentication fields first. A depleted bucket returns canvas `rate {retry_after_ms}` without consuming read/writer credit or imposing reader transport backoff. Unauthenticated and malformed envelopes retain the normal security/refusal rules. CET uses the same attempt bucket per module (at most 64 live module histories, retired after two idle seconds). Feed's additional 4/s per-(producer, layer) and 16/s per-producer rates and cap-refusal order are unchanged.

Sixteen feeds/s, a one-page 1 Hz catch-up and 1 Hz `canvas.state` leave **15–16 of 20 general requests/s** free: catch-up consumes three native reads without its current digest and four with it; state consumes one. Extra replay pages spend general read credit. Notify remains refused on observers.

**Pipe CPU model.** The sustained heavy-parsing allowance is **16 attempts/s × measured 64 KiB parse p99**, per pipe connection; the initial 24-attempt burst costs **24 × parse p99**. This includes failed batches, so invalid-content spam cannot increase the admitted parse rate. The p99 is a measured planning figure, not a hard maximum; bounded envelope scanning, refusals, response encoding and logging are additional overhead. CET shares the attempt rate, with additional encode/decode and native-adapter cost measured in SN3. The native budget fixture prints parse p99/max for the candidate. Reader/writer isolation and the exact bucket counts have native and real-pipe regression coverage. Sixteen per-producer feeds and multiple producer names never bypass the connection attempt bucket.

**The Lua route.** Set `local XFBridge = GetMod("XF_Runtime_Bridge")`. `XFBridge.Canvas.ForModule(module)` returns `Feed(batch)`, `Clear(layer)`, `View(settings)` and `State()` bound to producer `cet.<module>`. Module names match `[a-z0-9_-]{1,24}`. The default `XFBridge.Canvas` binds to `cet.xf_runtime_bridge`. Both producer and current world are filled in by the native adapter, replacing supplied values. All routes share the native validation and caps; the digest is over that filled-in batch. The Lua serializer preserves every schema array, including empty `items`, panel `lines`, points, views and coordinate vectors, without rewriting producer text. Answers are `{ok, result}` or `{ok:false, error}`. `Keys(settings)` sets bare key bindings and saves them to `config.ini`; `Toggle()` and `Mode()` are the same transitions as the native keys. Call from CET's update, never its draw. Holotable feeds a few times a second. The read-only cached Lua snapshot is described below.

## Read-only Lua snapshot (`snapshot@1`)

**Source/offline candidate.** `GetMod("XF_Runtime_Bridge").Snapshot()` and `GetMod("XF_Runtime_Bridge").Canvas.ForModule("holotable").Snapshot()` return the same cached Lua table. Call in CET update, a few times a second. They need no desktop XF process or observer slot and never start a recorder. On native/unavailable failure they return `nil, error`. `canvas.snapshot` / MCP `canvas_snapshot` is a read-class pipe copy of the same cache, subject to normal read pacing.

**Boundary and scheduling.** The existing `XFBridge_Canvas` native carries action `snapshot`: native copies a bounded cache and encodes a JSON string; CET's JSON decoder turns it into a new Lua table, normalising JSON-null sentinels to nil. There is no new RTTI native, game call, script timer, nearby query, recorder lease or acknowledgement. The snapshot is at most **16,384 UTF-8 serialized bytes** (plus the small native reply envelope). At most 15 KiB of the cache is used at build, reserving 1 KiB for read-time ages and envelope overhead. Lists and identifier lengths also bound the copy/decode. Every caller reads its own copy.

The bridge's background worker rebuilds at most **4 Hz**, only while a Lua or pipe snapshot reader has read in the preceding **2 seconds**. Canvas visibility does not create demand: shown with no readers and hidden with no readers both stop rebuilding; a hidden canvas with an active snapshot reader may still rebuild. Reads only refresh the lease and copy the cache; the first read can return a cleared baseline while the worker catches up. Ages update on reads without reading source owners. View-file debounce uses the same background worker independently of snapshot demand.

Owner copies use try-locks; contention skips a rebuild and lets the old cache age rather than waiting on game work. Only the recorder's two latest existing V/actor payloads, its retained identity metadata, native incident bookkeeping and native supervisor holds are read. No history is replayed and no game calls are added. Identity metadata stays with its recorder run/world even after the identity event leaves the ring. The snapshot selects fields, never copies story text, lines, names, notes, display names, full command results or policy descriptions. Holotable owns content levels and projection rules.

The strict shape is:

| Field | Value and bound |
|---|---|
| `schema`, `world` | `snapshot@1`, current bridge world generation |
| `built_s`, `age_s` | QPC source seconds at build; nonnegative age of that cache at read |
| `game_time_s` | Latest recorder V game clock in total seconds, or null/nil; never sampled by this feature |
| `v` | null, or `{id, pos, yaw, in_vehicle, in_combat, state, age_s}`; unknown values are null |
| `actors` | At most 16 selected recorder actors, in recorder selection order: `{id, pos, yaw, identity, plan, state, age_s}` |
| `identity` | null, or `{record, affiliation, crowd}` from 0.8.24 `actor.identity`; affiliation is its record id, not text |
| `plan` | Always null; `sources.plan:"unavailable"`. The plan executor is tools-side `plan.ts`. Plan steps can arrive once plan reports become session events (Holotable want 9, Agreement 8), then feed this cache with no game calls; the field stays in the schema. |
| `state` | `resolved` through sample age 0.5 s, `stale` after 0.5 s through 2 s, `lost` after 2 s or an invalid sample/missing position/id; invalid actor-channel samples invalidate every inner actor, and handover marks actors lost explicitly |
| `incidents` | At most 16: `{id, kind, pos, participants, opened_s, closed_s, perceived}`. Open first, witnessed first, then newest incident id. Closed entries retained only through 60 wall seconds after closure. `perceived` is a boolean, not a perception probability. |
| `participants` | At most 8 entity ids (or native actor handles while unresolved) per incident |
| `holds` | At most 5 current-world supervisor goals: `{id, kind, radius_m, pos}`; optional values null |
| `recorder` | `{active, run, channels, gaps}`; at most 10 channel ids and 8 recent `{channel, from_s, to_s, reason}` gap records. Gaps cover missed sample deadlines, invalid samples and counted drops; they do not imply continuous physical-contact coverage. |
| `sources` | `{v, actors, incidents, holds, plan}`; V/actors say `recorder` or `recorder_stopped`; handover says `actors:"handover"`; other native lists say `native`; plan says `unavailable` |
| `limits` | Caps in force: `bytes`, `actors`, `incidents`, `participants`, `holds`, `gaps`, `rebuild_hz`, `reader_lease_s`, `stale_s`, `lost_s`, `identity_bytes` |
| `truncated` | Omission counts for `actors`, `incidents`, `participants`, `holds`, `gaps`. List caps apply first; if bytes still exceed the build bound, lowest-priority incidents are removed, then holds, actors and gap detail. V is retained. |
| `cleared` | Present as `load` or `killed` when cleared; lists are empty and V/time null. Load clears before the next read and remains explicit until fresh current-world data exists. Kill cannot invoke a provider or resurrect data. |

Identifiers are exact: entity/participant/hold ids are at most 32 UTF-8 bytes, incident id/kind 64, channels 16 and gap reasons 48. Record/affiliation ids keep the recorder source's 8 KiB field ceiling; the whole snapshot byte cap still applies and removes whole rows by priority. Missing or unrepresentable identifiers become null (a record that cannot be represented makes identity null), never a clipped prefix naming a different record. Recorder stopped means V and actors are absent and their sources explicitly say `recorder_stopped`; native incident and hold lifecycles remain separate. A pipe disconnect does not stop an active snapshot lease or restart a stopped recorder. Load/world changes are checked at read and publication, so an in-flight old build cannot overwrite the clear. Runtime cadence, crossing cost and appearance remain uncommissioned.

Proposed maintainer session rows (all **NOT RUN**):

| Row | Pass rule |
|---|---|
| SN1 | With desktop XF tools closed, call both Lua routes in CET update; same schema/world, separate table copies, no new game calls and no observer slot consumed. |
| SN2 | Start a recorder through its existing owner; V, selected actor positions/identity and total game clock agree with the recorder; `plan` is nil and `sources.plan` unavailable. Stopping it yields explicit stopped sources without restarting it. |
| SN3 | Read at 8 Hz shown and hidden: source rebuilds stay ≤4 Hz. Stop reads: rebuild count stops by 2 s; shown and hidden idle do no snapshot source work. Measure native copy/encode plus CET decode/interpreter cost. |
| SN4 | Create/close incidents and supervisor holds through existing routes: open/witnessed/newest priority, participant ids and holds agree; closed incidents disappear after 60 s. |
| SN5 | Pause source refresh: actors become stale after 0.5 s and lost after 2 s with increasing age, never current-looking; handover explicitly loses actors and withdraws incidents/holds. |
| SN6 | Load and kill while reading: immediate explicit clear with new world/reason, no old actors or in-flight resurrection; fresh current-world samples are required to replace the load baseline. |
| SN7 | Saturate list/byte limits: output ≤16 KiB, counts/omissions match, no story/display text, and a Lua batch derived from the snapshot feeds the canvas. |
| SN8 | At 16 display attempts/s plus 1 Hz catch-up and state, reads/writer remain responsive. Spam failed feeds, clear and view: display `rate` leaves read credit intact; view changes apply immediately, save only the latest setting ≤once/2 s and flush on shutdown. Verify legends in both display modes. |

**Candidate boundaries.** The camera route uses the same camera basis and FOV getters as `XFPlayer.CameraJson`, with a smaller payload omitting scene-only yaw/pitch/aspect fields, plus V's position/yaw and the host's back-buffer viewport. A separate paced route reads at most 32 direct entity positions (default 16); it does no nearby-NPC query or occlusion rays. Entity lookup returns a position only, so brackets use the documented 0.6 × 1.9 m fallback. FOV is interpreted as vertical, matching the existing scene model's fallback; alignment against the real camera and photo-mode drone remains a commissioning check. Hidden feeds are discarded before parsing, and no camera/entity read runs while hidden. Game publication uses try-locks and the host's triple buffer; the renderer reads no game objects and takes no canvas lock. It checks TTL and world/visibility generation again when drawing.

The pipe keeps its existing 64 KiB **envelope** limit; envelope overhead therefore reduces the maximum batch that can actually arrive on that transport. The parser's independent 64 KiB batch limit also covers Lua and the conformance/benchmark route. Timing states contain a 256-sample p99, last and maximum for parsing, camera acquisition, paced anchor acquisition, snapshot publication and canvas render submission. Hidden camera/entity/render work is zero; key polling and lifecycle bookkeeping are outside those figures. GPU execution, total frame time and frame-generation appearance are not implied by CPU submission figures.

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
