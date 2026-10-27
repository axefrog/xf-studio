# XF Holotable

Holotable is a headless model of recorder observations and agent diagnostic layers, projected in the Studio's Holotable panels. It opens completed recorder runs, follows active runs through observer endpoints, and accepts private local layer spools; it never writes to the game. Offline world geometry is an estimate, not proof of the game's loaded state. See the [proposal](../../research/live-world-view/proposal.md), [W0 geometry checkpoint](../../research/live-world-view/w0-sector-reader.md), [live checkpoint](../../research/live-world-view/live-checkpoint.md) and [agent-layer contract](../../research/live-world-view/agent-layers.md).

The service speaks JSON lines over stdin/stdout and opens no port. The Studio host starts it on demand. [recording.ts](src/recording.ts) and [live.ts](src/live.ts) produce the same `Session`; the client controls its own moment, layers and disclosure level. Geometry preparation runs in one worker shared by replay and live requests, with the existing sector cache and decode pool behind it.

## Live protocol

| Method | Input | Result |
| --- | --- | --- |
| `live.status` | `{contentConsumer?}` | Bridge availability, whether the recorder is active, and feed state; discovery is cached for 5 s. An active content consumer renews its lease on this existing poll. |
| `live.watch` | none | `{watch}`: an independent client lease |
| `live.poll` | `{watch, since?, level?}` | Bounded new V/camera/actor/event/gap rows, session metadata, feed state and the next `since` cursor |
| `live.stop` | `{watch}` | Releases that client's lease |
| `world.content.demand` | `{consumer, wanted}` | Acquires/renews a 10 s content lease or releases it; the final release/expiry starts 30 s idle eviction. |
| `world.around` | `{watch, since?}` or `{dir, center?, margin?, content?, contentConsumer?}` / `{watch, center, margin?, content?, contentConsumer?}` | Without a live centre: `{version, world, pending, cold}`, cached geometry with request/2 s idle demand. With an explicit centre: a world region around that point, for any source. |

The first poll, or a changed session/run/world, returns `reset:true`. A client replaces its tracks before appending that response. The `since` cursor indexes the five append-only tracks in that epoch. `more` on this response means the client has more retained rows to consume; `state.more` means the bridge itself has unread pages. Neither is a gap. A disclosure-level change clears and refetches only events from index zero; V, camera, actor and gap cursors stay in place. Hiding and showing retains the committed cursor, avoiding a full history reload.

Polls deliver gaps before sample tracks and stop before advancing to another track if the current one does not fit, so a known break cannot arrive after its samples. On reset the client moves paused/scrubbed time to the new start, follows the newest sample when following, and removes selections absent from the new session.

`live-bridge.ts` is the only bridge mapping. It creates `CommandApi({readOnly:true})`, calls the bridge-thread `recorder.status` contract introduced for 0.8.23, and reads `game.catchup` with the complete opaque cursor, `now:false` and `detail:true`. No recorder start, emergency control, digest or game-thread query is exposed. An older bridge's unknown-command answer keeps the Live game row hidden. Discovery and achieved live performance still need runtime row RS1.

Before the first run, discovery has `active:false`, `channels:[]`, the established `session`, and null for all other result fields. The adapter and fake use that same payload. `start.s` is the recorder's QPC seconds, shared with samples and the manifest; derived ISO `start.at` is wall time for display only and never sets the timeline. The confirmed contract is built as bridge `fdb214bc` on `claude/bridge-0823`, pending main for 0.8.23.

## Recorded people, incidents and coverage

The shared replay/live adapter preserves the recorder's actual actor fields as
`actors: ActorSample[]`: `{t, who, valid, entity?, position?, yaw?, command_state?, prepared?}`.
It keeps invalid observations (`valid:false`, no `position`) for counting and path breaks.
The current actor sampler does **not** emit `record`, `affiliation` or `crowd`; those fields
are not invented or borrowed from incident participants. These are the selected recorder
handles, not a census of everyone around V. People is a base Show toggle, off initially,
after Camera: 3 px muted dots, fading trails over the last five seconds, and command state
in the existing inspector. Stale/invalid samples are not drawn as current; trails break on
invalid observations, entity changes, sample gaps and known recorder gaps.
When a failed actors-channel read has no `data.actors`, the adapter retains an
actor-scoped invalid gap (`channel:"actors"`, `from = to = failure time`), counts the
source row as dropped/invalid, and invalidates every earlier actor position until
that person is observed again. These point invalidations break People trails without
breaking V's trail. A false row validity with an actor list still preserves its valid
and invalid per-person observations, as the native sampler does.
Live sequence/transport loss also publishes actor-scoped intervals before affected
actor deltas, independently of whether any valid V sample has arrived.

`EventKind` includes **`"incident"`**. Each row from the native `incidents` channel becomes:

```ts
{
  id: string, kind: "incident", t: number, seq: number,
  at?: [number, number, number], summary: "Incident observation",
  level: "full", cite: `recorder:${session}:${run}:${seq}`,
  incident?: Incident // present at full; absent at structure
}
```

`incident` is the explicitly typed native payload in [model.ts](src/model.ts), not a JSON
string or untyped `data` bag. Its exact field groups (optional unless stated) are:

- Required `event`: `witness.report | witness.gap | witness.unwitnessed | incident.coverage`.
- Identity/classification: `schema`, `incident` (native id), `kind` (native report kind),
  `world`, `state`, `v_involved`. `kind` is absent where the native receipt has none.
- `participants`: `{entity, record?, affiliation?, roles, is_v, crowd, nearest_m, who?, position?}[]`;
  `participants_dropped`. These belong to the report, not the actor track.
- `place`: `{position, first, last, district_v}`; `when`:
  `{start_sim_s, end_sim_s, duration_s, start_game_s?, end_game_s?}`. Game times may be null.
- `declared`: `{id, kind, roles: Record<string,string>, at, ttl_s}`.
- `perceived`: `{witnessed, modes, saw, heard, told, sight?}`. `saw` is null or
  `{n, first_sim_s, nearest_m, via}`; `heard` is null or
  `{n, first_sim_s, nearest_m, radius_m}`; `told` is `{supported, note}`.
  `sight` (also an optional top-level field) is
  `{samples, in_range, in_view, blocked, unchecked, view_unavailable, actors_missing}`.
- Report evidence/state: `confidence`, `evidence: Record<string,number>`, `evidence_score`,
  `observations`, `closed` (nullable), `reported`, `report_pending`, `report_gap`,
  `continues` (nullable), `merged`, `passive`, `truncated`, `delayed`.
- Gap/unwitnessed receipts: `reason`, `closed_by`, `modes`, `queue_limit`, `note`.
- Coverage receipt: `valid`, `open`, `kept_closed`, `observed`, `accepted`, `dropped_rate`,
  `dropped_invalid`, `reports`, `reports_queued`, `reports_delayed`, `pending_reports`,
  `report_gaps`, `tap_admitted`, `tap_dropped_cap`, `tap_dropped_weak`, `tap_dropped_repeat`,
  `evicted_open`, `declared_open`, `declared_unwitnessed`, `sight_samples`,
  `sight_dropped_rate`, `told_supported`, and numeric `declared` count on coverage receipts.

`at` copies `incident.place.position`, falling back to `incident.declared.at` only when
present; receipts without a place remain unplaced. All story-bearing payload, including
declared ids/roles and participant records, stays inside `incident` and is removed at
structure level. The existing inspector shows the native kind at full and `incident` at
structure. There are no separate death/combat/crime recorder channels in this bridge;
if such classifications arrive in `incident.kind`, they are retained there.

`meta.channels` now returns **`ChannelCoverage[]`**:
`{name: string, read: number, kept: number, dropped: number, reasons: Record<string,number>}`
for every declared channel, including zero-row and unmapped channels. Counts are source
rows, not output items: `read = kept + dropped`, and `reasons` partitions `dropped`.
A mapped row producing observations (including invalid actor entries or a valid empty
actor list) is kept. Reasons are `"not mapped"` for unsupported channels, `"invalid"` for
invalid source rows, `"no mapped content"` for filtered/duplicate or malformed mapped
payloads, and `"batch budget"` for a dropped over-budget live page. Counts describe rows
actually read; unavailable chunks and transport loss remain separately disclosed by gaps,
`meta.problems` and `meta.dropped`. Manifest string lists remain readable; the adapter also
accepts counted entries and starts fresh counters for each read. Studio accepts either
metadata list form. Live cursors add `actors`; old cursors without it start that track at
zero, and existing poll byte/row budgets apply across all five tracks.

People evaluation binary-searches the last observation at the requested moment before
walking the five-second window, avoiding a scan of future samples during early scrubbing.
Gap snapshots are indexed once into sorted, merged intervals and channel invalidation
times; subsequent frames binary-search and inspect only intervals overlapping that
window. Nested/overlapping gaps and future history are covered by counted-access
regressions, without a timing threshold. Hiding People clears a selected person;
showing the layer again does not restore the selection.

`bun tools/capture-live.ts --model` captures synthetic People-on views in light/dark at
narrow/wide widths, beside the library Toggle pattern, under ignored
`local/holotable/evidence/model/`, using its own headless browser and `?verify=1` workspace.

## Offline world content

`bun tools/build-world-content.ts --slice kabuki` builds the private `xfh/world-content-1` file at `local/holotable/world/kabuki.content.json` from the configured vanilla game and the existing world pack. One publication owner replaces the slice and its private `xfh/world-index-1` catalogue entry under the same cross-process lock, revalidating cache hits and preserving newer same-slice publications; `--list` prints it without game configuration and explicitly reports deleted slice files. A shared source fingerprint invalidates sibling slices when any non-slice input changes. It prints coverage and elapsed milliseconds; `--pack`, `--game` and `--out` override inputs/output directory. No game session or live bridge is used. Run installed-game builds under the repository memory guard (4 GiB).

The file joins communities and their entry records/phases to retained AI spots, reduces referenced workspots to verified root idle names and tags, and reads population spawners and cooked map pins (with journal variants). Place assignment uses the smallest containing world-pack outline and its Z band. Default/persistent/enabled-by-default sector ranges are included; this does not claim every community entry is active. Missing geometry, schedules, activity names and other unverified fields are omitted and counted. Kabuki keeps 663 communities, 7,534 spots, 166 spawners and 268 pins. Reader `w1.3` also retains the original pin `variant` for Technical details.

Show offers **Places of interest**, **Gathering spots** and **Communities**, off by default below Solid shapes. The service selects prepared slices through the reader's shared slice table and overlapping world-pack places. Existing AbortSignal-owned world-context leases request nearby content only while a base layer is on (`content:true` on explicit-region `world.around`). Files cache in memory by size/mtime/ctime. Missing files produce “Not built yet” and “World content for this district hasn't been prepared”; views never trigger archive generation.

POIs use one kind-to-Places glyph table, with raw unknown variants labelled Place. Spots are muted 3 px dots without labels or plates, capped at 2,000 nearest the view centre; overlapping dots retain their density and never form count plates. The legend calls them Gathering spots, after Places; communities have no legend row. Communities have no inferred outlines: labels sit at the centroid of linked spots in view, read “Community · N spots”, and fade between 100 and 200 m of camera distance. Community size order is cached per content response and prepared cooperatively. Labels are culled against text and plates in that order, stopping after 12 placements or 64 attempts, with resumable layout; Show counts linked communities even when labels fade. Cards show readable summaries, worded phases or a plain time-phase count for codes, and distinct related spot chips only for spots in the current response (at most 12). Distant links appear as a plain “N more further away” line, with raw values under Technical. Numeric character TweakDBIDs are not names: until the reader resolves them, the community summary says “N character types” and Technical holds Character records. Base content never enters playback effects, change histories or Quiet until. Parsed file caching follows renewable content demand from view leases. The existing five-second status poll carries the consumer identity only while a view wants a base layer; content region reads also renew it. A consumer expires after ten seconds without renewal. The final release or expiry starts a 30-second idle eviction; a healthy remaining consumer keeps it warm and a quick reacquire cancels eviction. One shared expiry timer serves all consumers; no per-view renewal timer is added. Show counts/availability come from the explicitly bound view, using the same binding as Focus. Counts retain the last completed frame through selection redraws and reset on an explicit scene clear. Focus and cluster membership do not inherit the spot drawing cap.

`bun tools/capture-w1-layers.ts` owns an isolated headless browser and ephemeral server, serves the real private Kabuki file/world pack, prepares real W0 solids offline and deletes its temporary geometry cache. Evidence stays ignored under `local/holotable/evidence/w1-layers/`. It captures light/dark at 300/850 px and records a synthetic orbit; `--baseline` measures the same orbit with W1 off without replacing captures. `--design-fixes` refreshes only the overview, close and community cards. The [W1 drawing measurement](../../research/live-world-view/w1-world-content.md#w1-plus-w0-drawing-measurement) reports both timings and continuation rates, which remain high during camera motion. No game session is required.

The assembled file keys on all ordered vanilla archive stamps, the world pack, slice, reader versions and policy; an unchanged rerun avoids archive indexes. Content sectors reuse W0's worker and SQLite owner with an isolated content codec. Prepared slices share a 256 MiB estimated parsed-size cache; unclaimed slices evict least recently used first, live consumer claims are protected, and an oversized region refuses with a reason before parsing. Windows metadata enumeration avoids per-file REDmod stats; the preceding review measured an 81 ms cached Kabuki run (cold: 10,990 ms, individual shared-machine samples), before the subsequent publication checks. Rebuild validation reselects the preferred TweakDB as well as checking captured stamps, so a newly appearing expansion blob invalidates a fallback build. Synthetic tests are in `tests/world-content.test.ts`. The [W1 contract and mapping](../../research/live-world-view/w1-world-content.md) and [world knowledge](../../knowledge/world-and-streaming.md#141-w1-world-content-field-mapping) state the source fields, omission counts and evidence limits. This candidate awaits the dispatching chat's independent review and integration.

## Bounds and lifetime

- At most one catch-up call per second, with no concurrent read; empty reads back off to 2, 4 and 5 s. Reconnect and status discovery run at most every 5 s while wanted.
- A stopped recorder's current run is drained under the same catch-up budgets until `more:false`, including a final tail check if its last active page reported no backlog. Only then does it wait without further catch-up calls. A different stopped run is never opened automatically.
- One source page admits at most 8 MiB of serialized result and 3,072 source/event rows. Over-budget batches advance the exact returned cursor and count as loss, anchored as a gap between the surrounding valid V samples. Backlog does not count as loss.
- A client poll returns at most 256 rows and 256 KiB of row payload, plus bounded metadata. The Studio drains at most four polls per second. The bridge cursor and credentials stay in the headless process.
- A watch expires after 15 s without a client poll. Hiding the view releases it immediately; the last watcher cancels source and geometry wants. The in-memory session stops admitting data after 64 MiB of accepted source results. It remains visible with a reason.
- Discovery combines its requester's cancellation signal with the source's signal; cancelled late results cannot update the discovery cache.
- Legacy live geometry starts only after a `world.around {watch, since?}` request; the latest request AbortSignal or 2 s without another geometry request ends that watch's demand. The final demand cancels pending work and drops the retained region. Live source updates and Details-only polling cause no solid work by themselves. While a caller is active, geometry extends after V moves at least 100 m beyond the prepared path's sample coverage. It requests the accumulated path with a 250 m margin; the existing solid adapter uses its 350 m collision radius. A pending region never blocks a live poll. The worker adapter bounds a preparation request to 45 s.

## Checks

Use `bun test tests/live.test.ts` for source/service fakes and `bun test tests/solid-worker-port.test.ts` for worker lifetime without an installation. The Studio tests are `tests/holotable-live.test.ts` and `tests/holotable-module.test.ts` under `projects/xf-studio/authoring`.

`bun tools/capture-live.ts` runs the real panels and client service over the fake headless source in a `?verify=1` fixture. It captures watching, behind, connection lost and Back to live in both themes at two widths, beside the library Record list pattern. Outputs default to ignored `local/holotable/evidence/live/`. It launches an isolated headless browser; respect machine quiet windows and run it under the repository's memory guard. It never calls the game or a bridge MCP tool.

## How an agent draws a layer

From the repository root, publish a manifest followed by typed items as JSON lines. This example creates a layers-only game-clock set, visible in Recordings as **Example context**:

```powershell
@'
{"schema":"xfh/layer-1","producer":"demo","layer":"context","title":"Generated people","content":"full","clock":"game","kinds":["actor","relation"],"standalone":{"set":"example","title":"Example context","from":0,"to":86400,"clock":"game"}}
{"id":"fixer","kind":"actor","t":0,"anchor":{"at":[0,0,10]},"value":{"name":"Example fixer","role":"generated fixer","facets":{"doing":"waiting","planning":"meet the courier"}},"cite":"agent:demo:fixer"}
{"id":"courier","kind":"actor","t":0,"anchor":{"at":[20,0,10]},"value":{"name":"Example courier","role":"generated courier"},"cite":"agent:demo:courier"}
{"id":"tie","kind":"relation","t":0,"anchor":{"item":"fixer"},"value":{"to":{"item":"courier"},"type":"waiting for","strength":0.6},"cite":"agent:demo:tie"}
'@ | bun projects/xf-holotable/tools/holo.ts publish demo/context

bun projects/xf-holotable/tools/holo.ts validate local/holotable/layers/demo/context.jsonl
bun projects/xf-holotable/tools/holo.ts report layers:demo/example --at 3600 --position 0,0,10
```

Publish the manifest once. Later batches contain items or retractions only. Re-publishing an id replaces it from its `t`; `{ "retract":"fixer", "t":7200, "branch":"save-a" }` removes it only on that branch. Items and retractions inherit the manifest's branch unless they supply their own; a retraction applies everywhere only when neither has a branch. Unbranched items are shared. References resolve as `producer/layer/id`, `layer/id` in this producer, or `id` in this layer. Point, target, label, actor and influence anchors accept `{ "item":"places/cell" }` to follow a published item's current place, including a schematic zone's centre. Missing/cyclic references and unknown entity/region anchors are counted as **not placed**, never guessed.

To draw over a recording instead, omit `standalone`, use `clock:"recording"`, and publish QPC seconds matching its samples; optionally bind `session` and `run`. ISO `wall` times need the run's wall-clock mapping. Recording `game` times need V's `game_time_s` or manifest `game_time_samples:[{source_s,game_s}]`; absent mappings are refused. Standalone game seconds are native. Every manifest in a producer/set must agree on `from`, `to` and `clock`.

Story content starts **on** in Studio. The Story content switch requests `structure` at the service boundary: actor names become roles, relation types disappear, and facets and details are removed. Reports default to structure at the protocol boundary unless `level:"full"` is requested; the CLI defaults to full and accepts `--structure`. Use `--branch <name>` on a standalone report. Recordings have no branch identity today and show only unbranched records.

| Method | Input | Result |
| --- | --- | --- |
| `layers.publish` | `{layer:"producer/layer", lines:[manifestOrItemOrRetraction, ...]}` | Accepted/refused counts and plain reasons; writes the same spool as the CLI |
| `layers.watch` | none | `{watch}`; starts 1 Hz incremental spool reads |
| `layers.poll` | `{watch, dir?, liveWatch?, t, level?, hidden?, position?, branch?}` | Layer rows, evaluated items, projection specs and grouped What's here results |
| `layers.renew` / `layers.stop` | `{watch}` | Renews/releases the 15 s lease; no watcher means no folder polling |
| `layers.at` | `{dir?, liveWatch?, t, level?, hidden?, position?, branch?}` | One explicit read without a watch |
| `session.report` | Same query, including `position` and `hidden` | Bounded text read-back (128 near items), with omissions and coverage stated |

Spools live at `local/holotable/layers/<producer>/<layer>.jsonl`, overridable with `HOLOTABLE_LAYERS`. Publishing budgets persist across CLI processes through tiny private rate/refusal sidecars; an exclusive per-layer lock serializes writers. Each layer allows 5,000 distinct item ids, 16 MiB, and two batches per second. A raw malformed line is counted without losing good rows; an unfinished line waits for its newline. Replacement and retraction retain ids in that accounting. Ingestion yields in 4 ms slices; a running hash detects consumed-prefix rewrites as well as truncation and rotation. Publishing, ingestion and read-only validation share the same line and field checks. Optional manifest `producer_title` (1–80 characters) and `facet_titles` (up to 16 entries, keys 1–40 and titles 1–60 characters) refuse control characters and survive `structure` queries. Studio uses the producer title, falling back to its id; facet titles label the inspector’s Technical properties, with sentence-case keys as the fallback. Item `detail` allows LF line breaks, normalizes CRLF pairs to LF, refuses other control characters, and stays within 4,000 normalized characters and 40 lines at its existing content level. CLI file/stdin input stops reading at the 16 MiB cap. `validate <file.jsonl | folder>` is read-only, reports file/line/reason, checks set consistency and budgets, and exits nonzero on any refusal.

Standalone publication also serializes admission by producer/set, across spool owners and processes, holding `.set-<set>.publish.lock` in the producer folder through the consistency check and append. Waiting is cancellable and bounded to five seconds; abandoned lock files older than 30 seconds can be reclaimed, while an active owner's lock is preserved. Locks release in `finally`.

The shared projection table is exported by [layers.ts](src/layers.ts) and returned by queries; the Studio canvas interpreter consumes its draw rules and label templates. Agent preparation and paint always retain a finite responsiveness guard, including motion/refinement (at most 6.5 ms; ordinary resting work uses 4 ms). Points, paths, zones, labels and relations keep their geometry; unselected offscreen items are conservatively culled before the 256-item cap, which prefers selection then nearest to the view target, and frame accounting discloses eligible/processed/omitted items and ordering. Every field item keeps its footprint while its scalar/vector cells use mean aggregation into at most 8×8 cells during motion. Coarse paint resumes within a main-canvas generation without painting any cell twice; clear, projection and LOD changes reset its cursor. At rest all original cells return progressively; a cache of at most eight raster surfaces preserves field progress across fade revisions. Scene clear and disposal release the surfaces.

Context solids adapt toward a 5.5 ms total drawing cost (32–900 shapes, ranked by projected extent), gathering spots keep a stable hash quarter of the normal nearest-dot set, and community labels retain their 12-label limit. Show and legend counts describe full map membership before thinning: 2,000 eligible spots stay 2,000 during motion, and partial redraws retain the last complete counts. Theme/canvas/DPR cost estimates include canvas clear/fill/stroke and deduct non-solid costs before allocating solids. Orbit, pan, zoom, focus and following all participate. After 125 ms without a camera change, progressive selection restores detail with a shared 150 ms fade, instant for reduced motion. Repaint revisions track painted opacity and force the final opaque frame even when the deadline passes or reduced motion changes. Retained detail stays opaque; playback effects keep their separate clock. `pending` reports unfinished work at the chosen detail level; `moving` and `fading` independently request more frames. The next MCP wrapper remains out of scope.

The preceding `038a3bf7` measurements in the [motion performance checkpoint](../../research/backlog/performance.md#holotable-complete-scenes-during-camera-motion) use four synthetic 128×128 fields alongside real Kabuki W1, cached W0 solids and twelve markers. At 850 px p95 falls from **124.4/114.5 ms** light/dark (`bcd665e0`) to **6.4/6.4 ms**; 300 px measures **5.6/7.0 ms**. All four restore full detail in **282–289 ms**, including the final opaque paint, and retain 2,000 in Show/legend. Complete motion frames are 180/180 except dark 850 px (179/180): its finite guard yields once during labels after processing all 16 agent items and all 256 coarse cells. Thus that run misses the 100% complete-scene target; timing remains machine/content dependent. Run `bun tools/capture-motion.ts --dense --pack <world-pack.json> --regions <W0-cache/regions>` under the memory guard, adding `--width 300` for narrow evidence or `--stage before --baseline-ref bcd665e0` for the reviewed implementation. The read-only cache, owned headless browser/server and isolated `?verify=1` produce ignored `dense-before/after` measurements and light/dark orbit/rest captures under `local/holotable/evidence/motion/`. Tests cover painted fade completion/reduced-motion switching, bounded dense-field work, resumed raster paint across fade revisions, full non-field geometry, selected/nearest priority, stable counts and preserved effects. Coordinator re-review remains pending.

Use `bun test tests/layers.test.ts` for validation, clocks, retraction, spools and CLI/service integration. Studio's targeted tests include `holotable-agents.test.ts` and `holotable-solid-budget.test.ts`. `bun tools/capture-layers.ts <run-4 folder> <world-pack.json> <cached regions folder>` creates the isolated light/dark, 300/480 px evidence set under `local/holotable/evidence/agent-layers/`; its content is synthetic and its base observations and geometry stay private.

Layers-only sets open independently of optional solid context. Visible views request a 350 m region around their own orbit target, refreshed in the background after a move of more than 150 m or debounced 250 ms after a pan. Recorder and live views use the same explicit-centre route; calls without a centre retain their path-based or cached-live behaviour. Per-view AbortSignal leases share matching reads and the existing sector cache. Their service-owned union is capped at 12,000 unique solids, fairly split across ready leases; releasing a view drops its unshared geometry and frees its quota. Live updates refresh through that owner; keeping Details visible cannot refetch or republish geometry after the last world view releases its lease. Failed opens retain a title/reason and a Try again action in the view. Structure queries strip story fields regardless of the publisher's content declaration.

`bun tools/capture-story-layers.ts <layers folder> <world-pack.json>` verifies the private real Story Engine spool with the normal solid worker and captures days 1 and 4, light/dark, wide, under `local/holotable/evidence/story-layers/`.


## Playback and glyph plates

All Studio Holotable views share one playback clock. Recordings and live replay offer 1×, 4× (default), 16×; game-clock sets offer 1×, 1 min/s, 10 min/s (default), 1 h/s. The last choice is remembered separately for each clock family in the workspace's experiment-owned `holotable-view-state/playback` document. Following live stays at 1×; pause or scrub to replay at the remembered speed, and use Back to live to follow again.

Previous/Next change (`[` / `]` while the Holotable view has focus) jump across visible agent layers' appearances, replacements, effective expirations and retractions, then pause. Hidden layers and other branches do not count. Ends are included; unavailable directions do nothing. The Details layer row's target menu can scope stepping to that layer (`holo.change.scope`); a dismissible mixed-case muted scope chip after the step buttons shows its title. Scope is shared, not persisted, and clears on hiding/removing the layer or opening a new set. At narrow widths its title ellipsises after the readout and before the other controls collapse. Each projected layer carries sorted numeric `changes`, and each item a publication `version`, without story text. Reused histories invalidate on spool append or clock/span/branch changes.

Items accept optional `glyph` and `badge` lowercase slugs up to 40 characters through the same validate/publish/spool/service boundary, retained at structure level. [The vocabulary and rendering contract](../../research/live-world-view/glyphs.md) specifies 18 px plates, 22 px selection and 6 px state badges. Exact icon, family icon and kind marker fallbacks use one table; known names without icons are not unknown. Unknown names are accepted, draw the ordinary kind marker and are counted with their names in the layer row.

During playback, a canvas paint-to-paint diff gives newly painted or changed-version markers a 300 ms ring. Both frames must be complete, with at most 512 actually drawn markers; a budget hit or dense frame resets the baseline. Not-placed, culled, offscreen and hidden markers never animate. Retractions fade only a tiny plate/default-marker snapshot at the last painted position; paths and zones vanish immediately. Snapshots contain only structural marker data, world point and fan offset (including the 12 px marker fan-out), with no item, label, story data or geometry. Following reprojects effects without restarting their age. Multiple answers before paint compare with the last painted frame; unseen transitions produce no effects. The service carries no effect deltas or async revision diff. Seek, step, open, preset and layer toggles reset the baseline; reduced motion removes both effects. At most 512 effects are held and the overlay visits at most 256 per frame in its 1 ms slice. All `holo.*` actions register in the shared action registry only while the experiment is enabled; captured facades refuse after withdrawal even when an off/on cycle reuses the same service instance. Presentations release registration listeners when their AbortSignal ends.

`bun tools/capture-playback.ts` produces synthetic, asset-free light/dark captures at 300, 460 and 850 px, beside the component patterns, all speed options in the library menu at 300 px (checked current choice, immediate application), half-time pulse/fade frames, panned views and a second item selected at 300 px under ignored `local/holotable/evidence/playback/`. Pass `--effects-only` to refresh only the pulse and half-time retraction captures, or `--retraction-only` for just the latter. It starts and closes its own headless browser and loopback fixture server, and uses an isolated `?verify=1` workspace. Tests include `tests/layers.test.ts` and the Studio's `tests/holotable-playback.test.ts`. The candidate still needs the coordinator's independent code and UI reviews before integration.


Right-drag and middle-drag pan the view with any modifiers, grabbing the ground at the orbit target's height. Left-drag orbits, wheel zooms and left click picks; right click is inert and the browser context menu is suppressed. Orbit's XY pan offset follows V and resets on a preset or fit on open. The full world/set extent bounds pan to one extra orbit distance; without a pack, the observed recording span is the known bound. `holotable-pan.test.ts` covers geometry and lease fairness/cancellation, and the browser fixture exercises both pan buttons under every modifier combination. The viewpoint remains presentation-local.

Item Detail and event Said values retain authored line breaks (`white-space: pre-line`) and wrap long lines. Other property rows retain their existing rendering. The capture fixture verifies the scope chip, its clear button and named step tooltips, the row target-menu route, and both multiline detail surfaces.

Ordinary labels avoid neighbouring glyph plates using a bounded screen-space index built during marker drawing. The selected label always shows and wins. The scope chip keeps roughly six mixed-case characters before view presets give way; its clear icon matches the compact step controls. Unknown-glyph counts use singular/plural wording.


## Friendly world-map presentation

The [friendly-map contract](../../research/live-world-view/friendly.md) is implemented as a candidate awaiting the coordinator's independent reviews. It adds a card inspector (summary, human time, involved items, cause lines, remembered Technical), projected count clusters, per-view 300 ms focus and an eight-entry Back stack, a canvas key with per-view folding, overview district names, a clickable Quiet-until readout, plain layer counts and expandable producer notes. Focus on this layer joins the layer row's target menu. The hover card is deferred because the existing library has no point-anchored, nonfocusable multiline tooltip.

`holo.view.focus` accepts an explicit `view` and one of `id`, `layer` or `position`; `holo.view.back` accepts `view`. The existing `holo.focus {position}` still only requests world context. View adapters register by panel instance and withdraw when hidden or disposed. Details uses only the view its platform binding resolves; without a bound view Focus and Back are unavailable. Esc does not act in text fields, dialogs or menus. During orbit or pan, Escape restores the press viewpoint and releases capture without picking or changing history; otherwise it goes Back. Empty-ground double-clicks never reuse an earlier pick to focus. Camera history is local to each view and resets on opening; Technical and Key preferences share the existing experiment-owned `holotable-view-state/playback` document with playback choices.

Projected plates use a conservative 6 px occupancy grid (at most 16 cells per plate), cooperative 64-entry preparation slices and bounded cluster painting. The selected marker remains separate with its ring and a stage-coloured label halo. A count plate that overlaps the selected ring moves outward by the smallest screen-space distance that clears the ring plus 2 px, leaving its members and world focus centre unchanged. Clustered members retain target from-lines, actor volume outlines and geometry picking; only plates, labels and effects are suppressed. A cluster click searches at most 24 zoom levels to the first split; exact co-location keeps the existing close fan-out up to 12, otherwise an “N at this spot” inspector list offers the exact cluster members as item chips, including distinct nearby positions at minimum zoom. The key consumes counts already collected by the painted frame, merges kind fallbacks into the requested families, and keeps a fixed category order and family tone independent of item tone, selection or hover. The selected name and caption jointly try right, left, above and below against the plate grid before falling back right (at most eight grid probes). Details uses only its platform-resolved view binding for Focus; an absent binding never falls back to another view, and Focus/Back explain “Open a Holotable view first”. The service facade supplies the next visible-change moment. Quiet until and its jump always consider every visible layer, while the step buttons retain their scope. Quiet until hugs its text at the readout’s right edge while retaining narrow-width ellipsis through layout classes and the component label API.

Layer answers add structural `total`: distinct authored ids across time on the current/shared branch. Replacements and retractions do not inflate it. The layer list shows placed, enabled items “on the map now”, with “of N in this set” when different. Unknown glyphs, refusals, unplaced items and other-branch diagnostics appear under Producer notes. Raw times, citation, kind, ids, clock and titled facets live under Technical.

`bun tools/capture-friendly.ts` owns an isolated headless browser and ephemeral synthetic fixture at `?verify=1`. It writes 28 light/dark 300/850 px captures and interaction results under ignored `local/holotable/evidence/friendly/`, alongside component patterns. Use `--review-only` to refresh just the eight overview and selected-label captures with readout geometry assertions, or `--selected-only` to refresh only `dark-300-selected-label-focus.png`. `--layout-only` checks the four theme/width layouts without replacing captures. `--design-fixes` refreshes only the overview, close and community cards. `--input-only` runs navigation acceptance without captures and writes `navigation-acceptance.json`: mid-orbit/mid-pan Escape restores angles and a nonzero pan offset, releases capture, dispatches no pick/navigation action, preserves stack depth, and Escape without a drag returns after focus. Direct and Chromium two-click empty-ground double-clicks after an earlier pick must focus nothing. The read-only measured frame supplies the orbit and stack depth for exact assertions. The fixture checks double-click focus, Back/Esc, the quiet jump, Technical, counts, district names and the layer-focus menu. `holotable-friendly.test.ts` and the canvas tests in Studio cover pure and presentation behavior; `tests/layers.test.ts` covers structural totals. This is offline evidence; the coordinator still supplies independent code and UI review before integration.


World-content reader `w1.6` stores shared metadata in `records[id]` for every community/spawner reference: full `name`, localized `displayName`, affiliation id/name/title, coarse `role` (`archetypeName`) and Boolean `crowd`. Kabuki has 504 records (395 person, 99 vehicle, ten other). Gender, capacity and posture are omitted and counted. Cards read the table with unchanged output/captures. The slice catalogue includes bounds, per-collection counts, distinct records and bytes. The reader resolves full record names from installed REDmod declarations and POI `title`s from verified journal/TweakDB display keys through the game's English onscreens. Kabuki coverage is 1,949/1,958 entry names and 238/268 pin titles; unresolved fields stay absent. Cards separate people from vehicles and use shared resolved affiliation titles (578/663 communities), with localized or cleaned people labels; POI cards use their selected titles while POI map labels keep their kind. [The W1 contract](../../research/live-world-view/w1-world-content.md#readable-names-checkpoint) records sources, cache identities, limits and timings. Run `bun tools/capture-w1-layers.ts --names` for the isolated light/dark 300/850 px card captures.
