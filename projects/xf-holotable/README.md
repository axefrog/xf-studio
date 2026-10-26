# XF Holotable

Holotable is a headless model of recorder observations and agent diagnostic layers, projected in the Studio's Holotable panels. It opens completed recorder runs, follows active runs through observer endpoints, and accepts private local layer spools; it never writes to the game. Offline world geometry is an estimate, not proof of the game's loaded state. See the [proposal](../../research/live-world-view/proposal.md), [W0 geometry checkpoint](../../research/live-world-view/w0-sector-reader.md), [live checkpoint](../../research/live-world-view/live-checkpoint.md) and [agent-layer contract](../../research/live-world-view/agent-layers.md).

The service speaks JSON lines over stdin/stdout and opens no port. The Studio host starts it on demand. [recording.ts](src/recording.ts) and [live.ts](src/live.ts) produce the same `Session`; the client controls its own moment, layers and disclosure level. Geometry preparation runs in one worker shared by replay and live requests, with the existing sector cache and decode pool behind it.

## Live protocol

| Method | Input | Result |
| --- | --- | --- |
| `live.status` | none | Bridge availability, whether the recorder is active, and feed state; discovery is cached for 5 s |
| `live.watch` | none | `{watch}`: an independent client lease |
| `live.poll` | `{watch, since?, level?}` | Bounded new V/camera/event/gap rows, session metadata, feed state and the next `since` cursor |
| `live.stop` | `{watch}` | Releases that client's lease |
| `world.around` | `{watch, since?}` | `{version, world, pending, cold}`; cached geometry only, never waits for preparation |

The first poll, or a changed session/run/world, returns `reset:true`. A client replaces its tracks before appending that response. The `since` cursor indexes the four append-only tracks in that epoch. `more` on this response means the client has more retained rows to consume; `state.more` means the bridge itself has unread pages. Neither is a gap. A disclosure-level change clears and refetches only events from index zero; V, camera and gap cursors stay in place. Hiding and showing retains the committed cursor, avoiding a full history reload.

Polls deliver gaps before sample tracks and stop before advancing to another track if the current one does not fit, so a known break cannot arrive after its samples. On reset the client moves paused/scrubbed time to the new start, follows the newest sample when following, and removes selections absent from the new session.

`live-bridge.ts` is the only bridge mapping. It creates `CommandApi({readOnly:true})`, calls the bridge-thread `recorder.status` contract introduced for 0.8.23, and reads `game.catchup` with the complete opaque cursor, `now:false` and `detail:true`. No recorder start, emergency control, digest or game-thread query is exposed. An older bridge's unknown-command answer keeps the Live game row hidden. Discovery and achieved live performance still need runtime row RS1.

Before the first run, discovery has `active:false`, `channels:[]`, the established `session`, and null for all other result fields. The adapter and fake use that same payload. `start.s` is the recorder's QPC seconds, shared with samples and the manifest; derived ISO `start.at` is wall time for display only and never sets the timeline. The confirmed contract is built as bridge `fdb214bc` on `claude/bridge-0823`, pending main for 0.8.23.

## Bounds and lifetime

- At most one catch-up call per second, with no concurrent read; empty reads back off to 2, 4 and 5 s. Reconnect and status discovery run at most every 5 s while wanted.
- A stopped recorder's current run is drained under the same catch-up budgets until `more:false`, including a final tail check if its last active page reported no backlog. Only then does it wait without further catch-up calls. A different stopped run is never opened automatically.
- One source page admits at most 8 MiB of serialized result and 3,072 source/event rows. Over-budget batches advance the exact returned cursor and count as loss, anchored as a gap between the surrounding valid V samples. Backlog does not count as loss.
- A client poll returns at most 256 rows and 256 KiB of row payload, plus bounded metadata. The Studio drains at most four polls per second. The bridge cursor and credentials stay in the headless process.
- A watch expires after 15 s without a client poll. Hiding the view releases it immediately; the last watcher cancels source and geometry wants. The in-memory session stops admitting data after 64 MiB of accepted source results. It remains visible with a reason.
- Discovery combines its requester's cancellation signal with the source's signal; cancelled late results cannot update the discovery cache.
- Live geometry extends after V moves at least 100 m beyond the prepared path's sample coverage. It requests the accumulated path with a 250 m margin; the existing solid adapter uses its 350 m collision radius. A pending region never blocks a live poll. The worker adapter bounds a preparation request to 45 s.

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

Spools live at `local/holotable/layers/<producer>/<layer>.jsonl`, overridable with `HOLOTABLE_LAYERS`. Publishing budgets persist across CLI processes through tiny private rate/refusal sidecars; an exclusive per-layer lock serializes writers. Each layer allows 5,000 distinct item ids, 16 MiB, and two batches per second. A raw malformed line is counted without losing good rows; an unfinished line waits for its newline. Replacement and retraction retain ids in that accounting. Ingestion yields in 4 ms slices; a running hash detects consumed-prefix rewrites as well as truncation and rotation. Publishing, ingestion and read-only validation share the same line and field checks. CLI file/stdin input stops reading at the 16 MiB cap. `validate <file.jsonl | folder>` is read-only, reports file/line/reason, checks set consistency and budgets, and exits nonzero on any refusal.

The shared projection table is exported by [layers.ts](src/layers.ts) and returned by queries; the Studio canvas interpreter consumes its draw rules and label templates. Agent data gets the first rendering slice; collision preparation and drawing resume within the remaining frame allowance (8 ms steady state, up to 12 ms during cold preparation). The next MCP wrapper remains out of scope.

Use `bun test tests/layers.test.ts` for validation, clocks, retraction, spools and CLI/service integration. Studio's targeted tests include `holotable-agents.test.ts` and `holotable-solid-budget.test.ts`. `bun tools/capture-layers.ts <run-4 folder> <world-pack.json> <cached regions folder>` creates the isolated light/dark, 300/480 px evidence set under `local/holotable/evidence/agent-layers/`; its content is synthetic and its base observations and geometry stay private.

Layers-only sets open independently of optional solid context. Their context request is a 350 m region around the camera's orbit target, refreshed in the background after a move of more than 150 m; recorder runs retain their path-based regions. Failed opens retain a title/reason and a Try again action in the view. Structure queries strip story fields regardless of the publisher's content declaration.

`bun tools/capture-story-layers.ts <layers folder> <world-pack.json>` verifies the private real Story Engine spool with the normal solid worker and captures days 1 and 4, light/dark, wide, under `local/holotable/evidence/story-layers/`.
