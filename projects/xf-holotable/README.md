# XF Holotable

Holotable is a headless, read-only model of recorder observations, projected in the Studio's Holotable panels. It opens completed recorder runs and can follow an active run through the runtime bridge's observer endpoints. Offline world geometry is an estimate, not proof of the game's loaded state. See the [proposal](../../research/live-world-view/proposal.md), [W0 geometry checkpoint](../../research/live-world-view/w0-sector-reader.md) and [live checkpoint](../../research/live-world-view/live-checkpoint.md).

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
