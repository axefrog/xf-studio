# Holotable live feed: milestone 6

The candidate adds a read-only live source to the headless service and the Studio module. It uses recorder observations already produced by the bridge, without starting a recorder or polling a game-thread query. Production discovery targets the confirmed 0.8.23 `recorder.status` contract; its in-game commissioning row RS1 is still required. This checkpoint is offline evidence, not game proof.

## Behaviour and boundaries

The first actionable row in Recordings is Live game when the bridge is reachable. Its meta says Recording now or Not recording. Watch is unavailable while the recorder is off, with the reason “The recorder is off. It runs during XF test sessions.” Watching replaces the action with a Watching state badge. On disconnect the row stays, with Watching and Reconnecting…; it hides only after watching stops while the bridge is unreachable. Opening a recorded run stops the live watch.

Following shows the newest received sample on a growing timeline. Pause and scrubbing leave following; Back to live resumes it. The readout begins “Live” while following and reports a lag over 2 s. Disconnection changes that prefix to “Reconnecting” without changing Pause, and reconnect restores Live automatically. The reconnect message wraps in the drawing's existing top-left notice slot, taking precedence over sample/camera notices. All transient messages stay inside the drawing, so its height and the controls never shift. The controls stay on one line: the readout shrinks with ellipsis and its full text as a title; Back to live retains its place at the end. Source/run/world changes reset the timeline instead of joining worlds. The recorder itself remains owned by the external test session.

These two interaction decisions replace the initial brief's conflicting lines: Watch cannot be enabled without an active recorder, and following uses the ordinary Pause button rather than a disabled Live button. The module uses existing Button, SliderWithValue, Segmented and RecordList/badge patterns; no component-library or style-guide changes were made.

`live-bridge.ts` owns transport; `live.ts` owns cursors, validation, budgets, leases and backoff; `service.ts` owns loaded sessions and live geometry wants. The existing solid source now runs behind one worker adapter for both replay and live, so synchronous descriptor/sector assembly cannot hold up the JSON-lines process. The sector cache still owns shared decode jobs. The [project README](../../projects/xf-holotable/README.md) documents protocol and exact limits.

The source distinguishes three independent facts: bridge backlog (`state.more`), unread client deltas (`more`) and irrecoverable coverage gaps (`gaps`). Invalid envelopes publish nothing and do not advance the source cursor. Dropped budget batches advance the exact cursor and disclose the missing interval; trails break at the next valid sample. Structure responses strip full-content details at the service boundary.

## Verification

Focused offline tests cover recorded-run parity, opaque cursor preservation, backlog without a false gap, loss, reconnect, epoch changes, independent watchers, expiry, batch and response budgets, the exact discovery mapping, older bridges, session-event scoping, malformed-page atomicity and shapes that remain pending without delaying a poll. Client tests cover following, Pause, scrub, Back to live, hiding/showing, recorded-run switching and disclosure changes. The worker smoke test injects an explicitly empty installation; it reads no game data.

Verification on 27 October 2026, after the final 02:45 quiet-window cutoff:

| Check | Result |
| --- | --- |
| Studio Holotable module/live/solid tests, native streaming-sector tests, experiment layouts/startup, profile startup and Studio startup ordering | 65 passed; four opt-in real-sector/WolvenKit comparisons skipped |
| Complete `xf-holotable` test directory | 45 passed, including empty-recorder mapping, invalid V samples, worker lifetime and withdrawing old geometry before a new world's first V sample |
| Studio and headless Holotable TypeScript | Both passed |
| Architecture import boundary, Studio UI boundary and component ratchet | 46 passed |
| Repository links and private paths | Zero findings; new untracked candidate files were additionally scanned with the same checker functions because standard checks enumerate tracked files |
| Fake-backed browser captures | All 16 variants passed after the four design-review fixes: four live states × two themes × narrow/wide; retained Watching/Reconnecting row, correct prefix, notice inside the drawing, unchanged drawing height, one-line controls, readout title/ellipsis and V markers checked. Each disconnected variant also verifies automatic return to Live and hiding the row after opening a recording while unreachable. |
| Diff whitespace | Passed |

All requested jobs used the memory guard: Studio scoped tests peaked at 0.5 GB under 3 GB; headless tests at 0.3 GB under 2 GB; captures at 0.7 GB under 2 GB. The guarded full Studio suite was stopped on the maintainer's instruction. Its dock/browser-hook timeouts are a known baseline blocker outside Holotable; XF · Studio owns the full suite when landing. No game or bridge MCP tools ran.

The 16 PNGs and `measurements.json` are private evidence in `local/holotable/evidence/live/`, named `<watching|behind|connection-lost|back-to-live>-<light|dark>-<narrow|wide>.png`. They show the actual panels beside the same-width RecordList library pattern. The view is 360/900 px and Recordings/reference 240/400 px. The drawing remains 402 px high and the controls 28 px high in every variant. Visual inspection checked readable states, theme contrast, the single controls line, marker/gap visibility, control labels and the wrapped disconnect message. The Play icon was removed from the library button so it does not contradict Pause. The four design-review FIX items on `3200f0c1` are addressed; these remain author checks, with independent code review and the design lead's re-review PASS required before integration.

Catch-up is limited to one call per second and 8 MiB/3,072 rows per admitted batch, with empty backoff at 2/4/5 s. Status and reconnect use 5 s. Client replies carry at most 256 rows/256 KiB of row payload; the UI drains at most four per second. Watches expire after 15 s without renewal; accepted source results stop at 64 MiB. Geometry requests run in the background with a 45 s deadline. These are client policy bounds; game cadence and cost remain unproven.

The disk-footprint report left about 302 GB free on C. This worktree was below the report's 0.5 GB threshold, with no task-owned payload over 5 GB. The coordinator committed the original candidate as `3200f0c1`; the design fixes build on it without another agent commit. The brief was left unchanged.

## File report

| File | Change |
| --- | --- |
| [live-bridge.ts](../../projects/xf-holotable/src/live-bridge.ts) | Read-only command adapter and the single 0.8.23 discovery mapping; no writer fallback. |
| [live.ts](../../projects/xf-holotable/src/live.ts) | Headless source, exact cursor, validation, loss, budgets, leases, backoff and bounded deltas. |
| [service.ts](../../projects/xf-holotable/src/service.ts) | Live methods, background path-region wants, cached geometry replies and shutdown. |
| [recording.ts](../../projects/xf-holotable/src/recording.ts) | Exposes the existing sample conversion for live/replay parity. |
| [model.ts](../../projects/xf-holotable/src/model.ts) | Adds the generic cited session-event kind. |
| [solid-source.ts](../../projects/xf-holotable/src/solid-source.ts) | Optional transport shutdown seam. |
| [solid-worker-port.ts](../../projects/xf-holotable/src/solid-worker-port.ts) | Lazy worker adapter, request cancellation and deadline. |
| [solid-worker.ts](../../projects/xf-holotable/src/solid-worker.ts) | One geometry owner behind that adapter for replay and live. |
| [Project README](../../projects/xf-holotable/README.md) | Protocol, limits, ownership and offline verification usage. |
| [live-fake.ts](../../projects/xf-holotable/tests/live-fake.ts) | Manual clock and fake retained-data bridge. |
| [live.test.ts](../../projects/xf-holotable/tests/live.test.ts) | Source, adapter and service failure/lifecycle tests using synthetic recorded rows. |
| [solid-worker-port.test.ts](../../projects/xf-holotable/tests/solid-worker-port.test.ts) | Worker smoke test with an explicitly empty installation. |
| [capture-live.ts](../../projects/xf-holotable/tools/capture-live.ts) | Bounded isolated capture runner, fake headless service and measurements. |
| [live-preview-client.ts](../../projects/xf-holotable/tools/live-preview-client.ts) | Real panel/facade/client composition beside the library reference in verification only. |
| [Studio types.ts](../../projects/xf-studio/authoring/src/features/holotable/types.ts) | Typed live state, update cursor and incremental result. |
| [Studio service.ts](../../projects/xf-studio/authoring/src/features/holotable/service.ts) | Watch/follow actions, visibility, bounded draining, replay transitions and disclosure cancellation. |
| [panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/panel.ts) | Pause, Back to live, growing timeline, lag and disconnect readouts. |
| [recordings-panel.ts](../../projects/xf-studio/authoring/src/features/holotable/view/recordings-panel.ts) | Live game row, disabled Watch reason and Watching badge. |
| [holotable-live.test.ts](../../projects/xf-studio/authoring/tests/holotable-live.test.ts) | Client visibility, follow/replay, lag and late-content-response tests. |
| [Runtime access knowledge](../../knowledge/runtime-access.md#source-recording-source) | Discovery contract, event-feed identity limits and evidence grades. |
| This checkpoint | Handoff, evidence limits and the maintainer's first live checklist. |

## First game session

The maintainer runs the game. Use one prepared session; do not alter the user's frameworks or mod organisation.

1. Pin the exact Holotable candidate revision, Studio build and bridge 0.8.23 candidate hash/profile in the evidence record (confirmed bridge build: `fdb214bc` on `claude/bridge-0823`, pending main). Confirm RS1 first: `recorder.status` is read-only, bridge-thread-only, with no lease or ack change. Before the first run it has `active:false`, `channels:[]`, the current `session`, and null for all other fields. Confirm `start.s` shares the samples' QPC timeline; derived ISO `start.at` is display only.
2. Show Holotable with the game absent, then launch through the existing dedicated XF test profile. Confirm the Live game row appears with Not recording and the exact disabled Watch reason. Verify no recorder starts just by showing Holotable.
3. Have the existing writer begin a bounded run with V and camera channels. Watch it, walk and turn V, and confirm first samples appear promptly while cold shapes fill independently. Record first-sample time, first-shape time, source age, request counts, source drops/missed deadlines and frame impact with the view shown and hidden.
4. Pause, scrub and replay the past; return with Back to live. Let a backlog build by hiding/stopping observation, then return. Confirm behind decreases as retained pages arrive; it must not create a gap merely for being behind. A real loss must break the trail.
5. Keep another writer active. Confirm Holotable uses an observer slot, does not change recorder ack or leases, and hides/releases its reader and geometry wants immediately when hidden. Confirm read exhaustion separately from a missing game if possible.
6. Load a save, stop/restart the recorder, use the bridge kill switch and reconnect it, then restart the game. Received evidence stays visible on a lost connection; only a new run/world resets it. The writer starts recording again explicitly. No bridge rearm or recorder start comes from Holotable.
7. Open a recorded run while watching. Confirm the reader stops and ordinary replay works. Close/hide the view; confirm no continuing catch-up/status reads. Retain a versioned machine-readable evidence record and light/dark captures for each failed state.
8. Keep the session friction log: every wait, manual step, missing observation, unclear state or integration inconvenience becomes follow-up work, even if it did not block a row.

## Known integration gap

Holotable's existing experiment-module actions do not reach the shared generated action catalogue. `holo.watch` and `holo.follow` use the same typed ModuleService route as the other `holo.*` actions. The coordinator instructed this milestone to leave shared registry files alone and raised the catalogue gap with the Studio owner.

Knowledge used: [runtime access](../../knowledge/runtime-access.md), [world and streaming](../../knowledge/world-and-streaming.md), [knowledge evidence rules](../../knowledge/README.md#rules-for-knowledge-pages), the [architecture contract](../authoring/architecture-contract.md), and the [Holotable proposal](proposal.md). Runtime access lacked recorder discovery; the candidate contract and offline limitations are now recorded there.
