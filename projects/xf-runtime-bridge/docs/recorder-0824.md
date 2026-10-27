# Recorder 0.8.24 checkpoint

Source/offline candidate for Holotable and Story Engine shadow-mode consumers. No game, mod manager or asset tool was launched. No deployment was made. The [recorder guide](mcp.md#source-recorder-0814) is the field contract; the [concurrent-observer section](../README.md#concurrent-observers-0815-candidate) records the measured capacity decision. Runtime rows below remain unrun.

## Offline verification

The final required checks ran serially under the unchanged 6 GiB memory guard and 4 GiB free-memory floor. The clean Release build (`--clean-first --parallel 1`) passed at a reported peak 1.2 GiB. Native `--unit` passed 1,962 checks: 1,260 named plus 702 grouped, including 117 recorder checks and 13 new observer-pacing assertions. `bun tools/selftest.ts` passed 1,351 checks. The final `bun test tools` run passed 1,117 tests, skipped four opt-in on-screen tests and failed none (1,121 tests across 69 files, 322.98 s, reported peak 1.0 GiB). One earlier full run timed out in the existing CET/Fengari window-rendering test at its five-second deadline; the unchanged file passed all 15 tests on rerun, followed by the successful full suite. No timeout was widened. Three early builds were stopped at the machine-memory floor while using only 0.4-0.7 GiB; work waited for the coordinator's memory window. The final serial verification pass had no guard trip.

TypeScript and registry validation passed (169 items, 64 changelog lines; generated capability documentation current). The generated MCP reference matches its catalogue. Lua lint passed all four files. All five redscript variants passed, including the complete autonomous/Codeware/Equipment-EX/TweakXL set; native globals passed all four package sets. The world-object lint has no inline native-result findings. Root Markdown and private-path checks passed; the new untracked report/test files were checked separately because the root tools enumerate tracked files only.

Hygiene checks found zero broken links/source paths in 477 tracked Markdown files and zero private-path findings. The two new files passed separate privacy checks, including all six links in this report. `git diff --check` passed. The wrap-up footprint report showed 264.7 GiB free on C; this worktree was below its 0.5 GiB reporting threshold. No output above 5 GiB is retained for this task; the current local build and its writable SDK copy remain for coordinator review/rebuild.

## Evidence and limits

- Native unit fixtures cover start/manifest calibration agreement, chunk syncs, identity deduplication across V/actor channels and restart/world changes, the 2,048-entity cap and counted omissions, null/failed game-time reads, successful writer publication, reader non-publication, structured truncation and the complete 8 KiB event cap. Ordinary event data stays capped at 4 KiB.
- Client tests use the real named-pipe self-test host: writer observations reach reader `session.events` and detailed `game.catchup`, native manifests match live start discovery, and QPC/UTC mappings round trip through replay tooling. The self-test recorder now uses the real simulated session identity and native chunk writer, permitting representative replay reads.
- Read uncertainty brackets the UTC read with QPC; it does not claim accurate OS wall time. Start calibration is frozen; chunk syncs track subsequent offsets. The inverse mapper refuses a non-increasing UTC calibration sequence.
- Game time uses exactly the existing `XFWorld.Clock` / `XFWorld.SetTime` route (`TimeSystem.GetGameTime`, `GameTime.GetSeconds`). It is total game seconds, not simulation seconds or the photo-mode Environment slider. The native time-system implementation determines advancement during pause/photo mode; freeze behavior and the clock after photo-mode exit are not established offline. A load closes the recorder's current world before sampling again; a new run must be explicitly started after load, and its game clock must not be joined across saves by interpolation.
- Identity reads use only the V/selected puppet resolved in an existing sample. Display name is the character record's CName key, not a localisation or display-name native. Identity metadata is deduplicated by decimal entity id in the run/world; the counter beyond the cap counts attempts, including repeats. There is no nearby-population discovery or new game-thread polling.
- The default is six observers (hard maximum eight). The refusing limiter was `Dispatcher::TakeRateToken`, one global bucket across all pipe workers: default 20/s, burst 40, with readers required to leave 20 tokens for writers. Passive requests now use per-connection budgets (configured rate capped at 20/s, burst 40), plus a separate observer-only ceiling of 160/s and burst 320 that bounds reconnects. Connection identity is the endpoint plus accepted-connection generation, never PID; only fixed pool state is retained. Both direct game-thread reads and bridge-thread reads using `RunGameTask`/`RunRead` still consume the original shared allowance once per request before enqueue. Writer admission, queue priority, deadlines, endpoint backoff and emergency handling are unchanged.
- Three 20-round comparisons passed 60/60 and 120/120 catch-ups with no failures. Short-run writer latency varied on the shared machine; the 60-round persistent-reader confirmation passed 180/180 and 360/360, with writer mean/p95/max 22.902/34.426/195.754 ms versus 21.907/38.607/90.389 ms, and pipe CPU 218.750 versus 203.125 ms over about 59 seconds. The README records short-run variability and reproduction. This is offline evidence of comparable latency, not runtime commissioning.
- Registry follow-up for the coordinator: update `link.observers` to default six and describe independent passive budgets with the unchanged shared game-work gate; retain the offline/uncommissioned distinction. `recorder.actor-identity` was absent at this checkout. The capability registry itself remains untouched, as requested.

## Files changed

Paths below are relative to this project.

| File | Change |
|---|---|
| `native/src/core/Recording.hpp`, `native/src/core/Recording.cpp` | Frozen start calibration, per-chunk syncs and uncertainty; bounded identity admission and counters; null game-time fallback. |
| `redscript/XFRuntimeBridgeRecording.reds` | TimeSystem total seconds and character-record/puppet identity reads inside existing sample calls. |
| `tools/testing/recording-replay.ts` | Bidirectional QPC/UTC mapping, drift interpolation and ambiguous-inverse refusal. |
| `native/src/core/Dispatcher.hpp`, `native/src/core/Dispatcher.cpp` | Publish completed writer observations; per-connection observer pacing, aggregate safety ceiling and once-per-request shared game-work admission. |
| `native/src/core/Events.hpp`, `native/src/core/Events.cpp` | Whole-event 8 KiB observation cap and bounded structured-prefix truncation; ordinary cap preserved. |
| `native/src/core/Bridge.hpp`, `native/src/core/Bridge.cpp` | Supply writer connection generation, aggregate pipe-worker CPU diagnostics and endpoint/generation-owned reader budgets. |
| `native/src/core/PipeServer.hpp`, `native/src/core/PipeServer.cpp` | Worker thread id and Windows CPU-time readback; no added per-request measurement hook. |
| `native/src/selftest/Main.cpp` | Configurable reader slots and CPU metrics in the self-test host's existing info response. |
| `native/src/selftest/SimInput.hpp`, `native/src/selftest/SimInput.cpp` | Real simulated session identity and native private writer for representative client replay. |
| `native/src/core/Config.hpp`, `native/src/core/Config.cpp`, `native/config/config.ini` | Default six observers; one shared hard-cap constant for transport, parser and pacing ceiling. |
| `native/src/selftest/UnitTests.cpp` | Independent same-PID reader budgets, capped burst/refill, reconnect ceiling, writer limits, direct/multi-step game-read pacing and flood regressions. |
| `tools/test/multiclient.test.ts` | Default-six discovery and full-pool admission/reuse. |
| `native/src/selftest/UnitTestsRecording.cpp` | Record/event, null, once-per-entity, restart, caps and truncation fixtures. |
| `tools/selftest.ts` | Writer-to-observer publication checks through real clients. |
| `tools/test/recorder0824.test.ts` | Manifest round trips, observer/catch-up delivery, native finalisation and 3/6-reader measurement. |
| `tools/test/mcp-reference.test.ts` | Assert the frozen live-start calibration contract. |
| `tools/test/batch14.test.ts`, `tools/test/batch15.test.ts`, `tools/test/batch16.test.ts`, `tools/test/incidents0820.test.ts`, `tools/test/styling0822.test.ts` | Match current build/tool version assertions to 0.8.24. |
| `tools/api/catalogue060.ts` | Session-event publication fields and limits. |
| `tools/api/catalogueTesting.ts` | Recorder clock, game-time and identity field documentation. |
| `docs/mcp-reference.md` | Regenerated catalogue reference. |
| `README.md` | Current version, measured observer decision and complete autonomous lint inputs. |
| `docs/mcp.md` | Recorder fields, timing meanings, publication events and runtime limits. |
| `docs/recorder-0824.md` | This checkpoint, file report and prepared runtime rows. |
| `native/CMakeLists.txt`, `package.json`, `cet/xf_runtime_bridge/init.lua` | Declare 0.8.24. |
| `cet/xf_runtime_bridge/panel.lua` | Match the fallback version label to 0.8.24. |

## Prepared runtime rows

Use the coordinator's versioned 0.8.24 autonomous `-writes` candidate in the dedicated test profile, with an explicit safety save and the existing framework versions checked first. Retain the native manifest/chunks, command/session log and frame-time readings under a versioned private session directory. Record friction throughout; the maintainer runs the game.

| Id | Steps | Pass rule |
|---|---|---|
| R824-T | Record V for normal play, open/close Pause, enter photo mode, change its time-of-day slider, exit, then request a safety-save load. Start a new run after load. | Every written V row has numeric total `game_time_s` or explicit null; measure and report pause/photo-mode advancement, with no inferred samples during gaps. Run stops on load, next run has the new generation; compare its clock with `game.status.world_time_seconds`. Record photo-clock exit behavior as observed, never assume restoration. |
| R824-I | Record a spawned XF actor and an already selected crowd NPC by their returned handles; sample repeatedly, including an actor appearing in more than one selected context. Stop/drain, load and explicitly start again. | Exactly one `actor.identity` per sampled entity in each run/world, decimal entity joins samples/incidents/plan reports, character record and affiliation match a scene detail read, puppet crowd flag separates the two where the game reports it; no duplicate on repeat samples, no stale identity after load. |
| R824-O | Keep a read-only observer connected while the writer calls `world_probe`; also call `scene_read` and `world_district`. Read `session_events` and detailed `game_catchup` from that observer. | One event per successful writer call, with matching dotted command, cid and writer connection generation. Result matches the writer's answer unless explicitly truncated; whole serialized event is at most 8 KiB. An observer's own probe does not publish another event. |
| R824-M | Record a real run long enough to roll a native chunk, stop/drain, and retain its final manifest. Map sample source seconds to UTC and back, checking the command log's interval. | `start_at`/`start_sync` equal live `recorder_status.start`; each chunk has a finite QPC/UTC sync and nonnegative read uncertainty. UTC has millisecond precision; replay round trips within 1 ms. Any wall-clock discontinuity is reported; an ambiguous inverse is refused. |

Knowledge used: [game events](../../../knowledge/game-events.md), [runtime access](../../../knowledge/runtime-access.md), [world-object native-call rule](../../../knowledge/game-crashes.md#24-a-string-operator-with-a-null-operand-session-7), and [live-world performance and comparable-time requirements](../../../research/live-world-view/proposal.md). The old live-start derivation and absent recorder fields described in shared knowledge need coordinator reconciliation after this candidate is accepted; this change is project-scoped.
