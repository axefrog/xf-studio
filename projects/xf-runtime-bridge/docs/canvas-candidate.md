# Canvas candidate evidence

The earlier unversioned canvas candidate and all five independent-review corrections to `fc667085` passed the offline verification recorded below. The current A–C continuation (display attempt pacing/deferred view saves, the Lua snapshot, and screen furniture in radar-only mode) passes its recovery clean build and full offline checks, recorded separately below. Changes remain uncommitted for coordinator review. No deployment, game session, visual approval or version change is claimed.

## A–C recovery checkpoint (28 October 2026)

Re-read the surviving diff after power loss. Display attempts retain their separate 16/s, burst-24 allowance; view changes apply in memory and defer disk writes. The cached Lua snapshot reads existing owners only, and screen-anchored furniture draws once in either mode while respecting its layer view mask.

Recovery corrections preserve invalid recorder-channel validity for every inner actor and flush the final view only after listener/background shutdown. Native regressions cover invalid snapshot actors and failed-save retry/error recovery. The Lua harness now exercises JSON-null sentinel conversion as well as separate table copies and a derived canvas feed.

| Check after recovery | Result and limit |
|---|---|
| Targeted canvas/catalogue/recording tools tests | 33 passed, 0 failed; 4,704 assertions; 14.60 s; existing executable only, so this does not verify the latest C++ corrections |
| Strengthened Lua snapshot harness | 1 passed, 0 failed; 21 assertions; 0.96 s; existing native snapshot with a null-clock crossing fixture |
| Tools typecheck and capabilities | Passed; 169 capability items, 64 changelog lines; registry current |
| Lua lint and generated MCP reference | Passed |
| Root Markdown links | 0 broken links/source paths in 481 Markdown files |
| Root private paths and diff whitespace | 0 private-path findings; `git diff --check` passed |
| Clean native build | Release `--clean-first` passed; peak 1.3 GB; guard limit 6 GB and default floor 4 GB, no trip or floor override |
| Native unit checks | 2,839 passed (1,265 named plus 1,574 grouped), including 869 canvas and 120 recording checks; 3,000 parser mutations; 8.27 s |
| Client self-test | All 1,356 checks passed; 35.81 s; peak 0.3 GB |
| Full tools suite on the clean executable | 1,128 passed / 4 opt-in screen skips / 0 failed; 1,132 tests across 70 files, 23,639 assertions; 329.77 s (330.34 s guarded job); peak 0.9 GB |
| Redscript/native declarations | Fallback, Codeware, writes/probes, Equipment-EX/TweakXL and combined variants passed; all four native package sets passed. Existing redundant-cast and Codeware return-path warnings remain warnings. |
| Theme/glyph and fact-preset generation | Current |

Recovery offline budgets (256 samples): 64 KiB parsing/4,096-vertex expansion p99 **0.458 ms**, maximum **1.549 ms**; 16,384-vertex projection/culling p99 **0.484 ms**, maximum **0.991 ms**. These are offline CPU figures, not in-game render or frame-time evidence.

Checks ran serially under the 6 GB memory guard with default floor 4 GB throughout, without a guard trip. The initial check-runner invocation failed to locate the relative native executable before any unit tests ran; using its absolute path corrected the runner, after which every check passed. Earlier native/full-suite figures below belong to the prior candidate. Runtime SN1–SN8 and visual approval remain unrun.

## Review corrections

- **Radar accounting:** admission and drawing reserve two endpoints per solid line segment, including shared corners, plus polygon fill points. A 64-segment circle reserves 128 endpoints. The full-frame regression admits four producers with 32 long-gap dashed circles each at the 16,384 cap, then projects/dashes every segment at 640 px / 1 m: exactly 16,384 endpoints are emitted, with dash downgrade and no solid culling. The former 64-circles-per-producer counterexample is refused.
- **Rate histories:** accepted timestamps survive clear, disconnect and visibility/world reset for their one-second window, independently of drawing and seq records. Metadata bounds the union of drawing/seq and live rate keys to 1,024; pruning reclaims expired rate-only keys. Tests cover both alternating-feed/clear bypasses, handoff and bounded name churn.
- **Key persistence:** the plugin uses the tested `PersistKeys` adapter, which requires `ReadFileExact` before replacement. Missing, locked and oversized-read failures leave config and backups untouched; a successful save preserves unrelated settings. Live rebinding with `saved:false` follows the existing stop-key behavior.
- **Lua arrays:** recursive serialization preserves all schema arrays, including empty panel lines and nested point vectors, while retaining empty objects and quoted text. The regression uses the real ECMAScript JSON encoder over Fengari values rather than a canned encoding stub. It does not claim CET runtime execution.
- **Refusal order:** the raw byte ceiling precedes parsing as the clarified safety prerequisite, then items, vertices, layers, metadata and rates. Multi-cap tests cover that order, including global item overflow when bounded expansion stops early at the vertex cap. An older rate test's backwards injected clock was made chronological.

## Decisions and boundaries

- The runtime bridge coordinator decided to retain the observer refusal for `notify` and admit `display`, alongside existing reads and emergency controls. Display changes only XF drawing and needs no game-write permission.
- The coordinator approved generated vector geometry in place of the original icon-atlas proposal. SVG paths are flattened once by the theme generator; no runtime SVG parser, texture upload or new dependency is involved. The implementation follows [SVG's endpoint-arc algorithm](https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes).
- The real Studio theme slot is `XfCanvasPlate`, with effective alpha 0.7178. Chip and panel text uses `text`; tones mark edges. Plain labels retain their tone. The fallback plate has been removed.
- Counted vertices are **max(solid source vertices, expanded world-view vertices)** for each primitive. Solid line geometry uses segment endpoint pairs (including shared corners), polygon fill points and generated icon counts; a 64-segment circle reserves 128 endpoints. Admission bounds every solid radar baseline. Only radar dashing can downgrade to solid; no radar budget culling or culling counter exists.
- `ground:false` circles use camera right/up at the anchor in world view. Both ground settings share the top-down radar circle. Regression cases cover yaw, a downward-looking camera and radar equivalence.
- Heat is omitted (`features: []`). Missing glyphs draw counted points. Brackets use the documented 0.6 × 1.9 m person fallback because the bounded entity adapter reads positions, not engine bounds. Camera FOV alignment remains a game check.
- Radar defaults are bottom-right, 240 logical pixels, 50 m centre-to-edge, heading-up, opacity 1. Size is bounded to 120–640 and range to 1–2,000 m. View settings persist independently of content; a view change cannot reject an admitted snapshot.
- CET uses `GetMod("XF_Runtime_Bridge").Canvas.ForModule(module)` with module names `[a-z0-9_-]{1,24}`; the native adapter supplies `cet.<module>` and the current world. The default module is `xf_runtime_bridge`.
- Camera/V reads run every tick using a minimal payload. Entity reads are independent: default 16 per read at most 10 Hz, configurable to 4–32 at 1–20 Hz. No catch-up bursts occur. A successful anchor remains resolved for its round-robin cycle plus 0.25 s grace, then holds/fades for one second before becoming lost. State reports the read rate and separate camera/anchor/publication costs.

## Changes by file

All paths below are relative to this project.

| Files | Change |
|---|---|
| `native/src/core/overlay/Canvas.hpp` | Canvas data model, service boundary, immutable frames, timing counters and projection API. |
| `native/src/core/overlay/CanvasParse.cpp` | Strict parsing, duplicate/depth checks, shape validation, bounded expansion and vertex accounting; RFC 8785 canonical JSON and SHA-256. |
| `native/src/core/overlay/CanvasProjection.cpp` | Camera projection, near/viewport clipping, camera-facing circles, radar transforms and bounded pixel dashes. |
| `native/src/core/overlay/Canvas.cpp` | Admission, ownership, TTL, sequence/world guards, rates, metadata bounds, events, persisted view, anchor scheduling/fade, state and command registration. |
| `native/src/core/overlay/CanvasGlyphs.inc` | Generated Studio glyph paths and explicit missing-name list. |
| `native/src/plugin/Canvas.hpp`, `native/src/plugin/Canvas.cpp` | Plugin adapter, one bounded game-thread snapshot, lifecycle withdrawal, CET native route and saved key rebinding. |
| `native/src/plugin/CanvasDraw.hpp`, `native/src/plugin/CanvasDraw.cpp` | ImGui background drawing for world/radar primitives, plates, labels, panels and generated glyphs; TTL/generation/fade checks and render timing. |
| `native/src/core/Dispatcher.hpp`, `native/src/core/Dispatcher.cpp` | Display access class, observer admission, connection identity, exact feed bytes and structured refusal details. |
| `native/src/core/PipeServer.hpp`, `native/src/core/PipeServer.cpp` | Unique connection identities and disconnect notification. |
| `native/src/core/Bridge.hpp`, `native/src/core/Bridge.cpp` | Dispatch connection wiring and composable disconnect/stop observers. |
| `native/src/core/Config.hpp`, `native/src/core/Config.cpp`, `native/config/config.ini` | Canvas enable/default bare keys, disabled-key support and duplicate-key warning; bounded anchor rate and per-read count. |
| `native/src/core/KillKey.hpp`, `native/src/core/KillKey.cpp` | Reuse the existing key watcher and generalize its INI setting replacement for canvas bindings. |
| `native/src/core/ScriptLayer.hpp`, `native/src/core/ScriptLayer.cpp` | World invalidation token shared by canvas and recorder; advance on accepted load, detach and kill. |
| `native/src/core/overlay/Host.hpp`, `native/src/core/overlay/Host.cpp` | Viewport snapshot and bounded canvas-only evidence-capture override. |
| `native/src/core/overlay/ThemeTable.inc` | Generated real `XfCanvasPlate` slot. |
| `native/src/plugin/Plugin.hpp` | Canvas owner, key watchers and adapter flags. |
| `native/src/plugin/Main.cpp` | Existing key-route polling and game-tick adapter wiring. |
| `native/src/plugin/Overlay.cpp` | Draw the canvas in the existing host; canvas-only captures omit the XF box. |
| `native/src/plugin/GameHandlers.cpp` | Register canvas, expose world generation and invalidate immediately when a load is requested. |
| `native/src/plugin/Natives.cpp` | CET canvas native and detach withdrawal. Native declarations total 29 normal / 38 autonomous. |
| `native/src/plugin/Handlers070.cpp` | Display-class capture suppression and canvas stop on overlay disable. |
| `native/src/plugin/HandlersRecording.cpp`, `native/src/plugin/HandlersInputChoices.cpp`, `native/src/plugin/HandlersIncidents.cpp`, `native/src/plugin/Supervisor.cpp` | Use the same world-generation token for recorder-related evidence. |
| `redscript/XFRuntimeBridgeCanvas.reds` | Separate minimal camera/V payload and paced anchor payload (default 16 direct lookups, hard maximum 32); no world query, ray or write. |
| `redscript/Natives.reds` | Canvas native declaration. |
| `cet/xf_runtime_bridge/canvas.lua`, `cet/xf_runtime_bridge/init.lua` | Module-bound public Canvas API, empty-array preservation and module export. |
| `cet/xf_runtime_bridge/theme.lua` | Generated real canvas plate slot. |
| `native/src/selftest/UnitTestsCanvas.cpp` | Shared fixtures, refusals/caps/rates, lifecycle, anchor fairness/fade, views, dash accounting, capture/key checks, bounded fuzzing and CPU benchmarks. |
| `native/src/selftest/UnitTests.cpp`, `native/src/selftest/UnitTestsOverlay.cpp` | Include canvas checks and update generated theme count. |
| `native/src/selftest/Main.cpp`, `native/src/selftest/Sim070.cpp` | Focused unit entry point and simulated canvas/lifecycle/capture routes for client tests. |
| `native/CMakeLists.txt` | Core, plugin and self-test source/fixture wiring. |
| `tools/api/catalogueCanvas.ts` | Four canvas commands and strict primitive schemas. |
| `tools/api/catalogue.ts` | Display permission, command inclusion and `capture.screenshot {overlay:"canvas"}`. |
| `tools/api/catalogue060.ts` | Existing capture-clear route accepts the explicit canvas evidence option. |
| `tools/api/catalogue080.ts`, `tools/api/errors.ts` | Derive the shared refusal index from canvas definitions and provide plain-language refusal guidance. |
| `tools/api/command-api.ts`, `tools/mcp/server.ts` | Display allowed on observer routes and exposed by read-only MCP. Notify remains refused. |
| `tools/overlay/canvas-glyphs.ts` | Studio SVG flattening, generated dash expansion, vocabulary lookup and 256-vertex glyph bound. |
| `tools/overlay/canvas-fixtures.ts`, `fixtures/canvas/conformance.json` | Shared fixed-camera, refusal and independent ECMAScript canonical/digest vectors. |
| `tools/overlay/theme.ts` | Generate/check glyph data with the existing theme output. |
| `tools/packaging.ts` | Include the Canvas Lua module in all package variants. |
| `tools/test/canvas.test.ts` | Shared vectors, TypeScript projection, SVG geometry, CET module binding, observer/MCP ownership and lifecycle tests. |
| `tools/test/mcp.test.ts` | Read-only tool list admits display. |
| `tools/test/catalogue.test.ts` | Include the core canvas registrations in access-class checks. |
| `tools/test/cet-bindings.test.ts`, `tools/test/batch21.test.ts` | Load the real Canvas module in existing CET harnesses. |
| `tools/test/styling0822.test.ts` | Generated theme counts with the canvas plate; existing CET harness loads the real Canvas module. |
| `tools/test/batch20.test.ts`, `tools/test/incidents0820.test.ts`, `tools/test/input-choices.test.ts`, `tools/test/redscript-natives.test.ts` | Update native-declaration expectations; existing CET harnesses load the real Canvas module. |
| `tools/docs/mcp-reference.ts`, `docs/mcp-reference.md` | Display-class explanation and regenerated command reference. |
| `README.md`, `docs/mcp.md`, `docs/canvas.md`, `docs/canvas-candidate.md` | Current candidate contract, entry points, evidence and commissioning limits. |

## Offline verification (28 October 2026)

The final checks ran serially under the unchanged 6 GB guard and 4 GB machine-wide floor. The clean Release build used `cmake --parallel 1`. No guard trip occurred in this final window.

| Check | Final result | Guarded peak |
|---|---|---|
| Clean Release build | Passed, including plugin and self-test; autonomous and engine-input test flags enabled | 1.3 GB |
| Native `--unit` | 2,708 checks passed: 1,247 named plus 1,461 grouped, including 779 canvas checks; 3,000 deterministic parser mutations | <0.05 GB |
| `bun tools/selftest.ts` | All 1,332 checks passed | 0.2 GB |
| `bun test tools` | 1,121 passed / 4 opt-in on-screen skipped / 0 failed; 1,125 tests across 69 files, 23,396 assertions, 313.95 s | 0.9 GB |
| `bun run check` | TypeScript passed; 169 capabilities, 64 changelog lines; registry unchanged and current | 0.3 GB |
| Lua lint | All 5 Lua files passed | <0.05 GB |
| Theme, glyphs, fact presets and MCP reference | Generated data current | <0.05 GB each |
| Native declaration lint | All four package variants passed, 29 normal / 38 autonomous native globals | Included in redscript checks |
| Redscript, fallback | Passed against the fresh copied game bundle | <0.05 GB |
| Redscript, Codeware | Passed | 0.2 GB |
| Redscript, Codeware + probes + DM | Passed | 0.3 GB |
| Redscript, Codeware + Equipment-EX stub + TweakXL | Passed | 0.3 GB |
| Root Markdown links | 0 broken links/source paths across 480 Markdown files | <0.05 GB |
| Root private paths | 0 findings in tracked text files | <0.05 GB |
| `git diff --check` | Passed | — |

Before the clean build, the targeted runs passed 779 canvas checks and 7 tools tests with 132 assertions. Full verification above passed serially. Codeware runs retain the pre-existing redundant NPC casts and upstream Reflection return-path warnings, with no errors. No limit was raised and no unrelated process was stopped.

### Offline budgets

Each benchmark uses 256 samples from the final native unit run.

| Work | p99 | Maximum | Meaning |
|---|---|---|---|
| Parse/canonicalize/hash a 64 KiB padded batch expanding to 4,096 vertices | 0.3025 ms | 0.3507 ms | Below the 2 ms parser target |
| Project and near/viewport clip 16,384 vertices | 0.2604 ms | 0.2772 ms | Geometry only; excludes ImGui submission and GPU execution |

The cached projection scale removed repeated `tan` calls per endpoint. The complete render target remains a game commissioning check even though offline projection is below 0.5 ms p99. Camera acquisition (≤0.05 ms per tick) and paced anchor acquisition (≤0.15 ms per read) also require game evidence; synthetic service timings do not establish engine cost. Live state records camera, anchor, publication and render timings separately.

The built `build/Release/XFRuntimeBridge.dll` is an autonomous/engine-input-test candidate, SHA-256 `b3c00c652ff692645ee1976940df4c329f02ef2ffb1bdb1ae942be9c8c54ddd4`. It has not been staged or deployed. The coordinator must review the source and identify the package/profile for the prepared session.

Disk checkpoint: this worktree remains below 5 GB and C has approximately 262.7 GB free. No large task-owned payload is retained outside its ignored build directory; final logs replace superseded development logs.

## Missing glyphs

`warning` is available (7 generated source vertices). These **63** vocabulary/family/badge names are absent from Studio `icons.ts` and draw counted points; they are requests for the UI track:

`accident`, `assault`, `blocked`, `civilian`, `clash`, `clinic`, `collector`, `confrontation`, `control-point`, `corp`, `courier`, `crackdown`, `crowd`, `cyberpsychosis`, `data`, `death`, `diagnostic`, `direction`, `disorder`, `done`, `event`, `festival`, `fixer`, `gang`, `gang-leader`, `gang-member`, `goal`, `group`, `hazard`, `held`, `hideout`, `item`, `juncture`, `market`, `matched`, `medic`, `merchant`, `money`, `netrunner`, `new`, `note`, `outage`, `pending`, `person`, `place`, `police`, `police-action`, `probe`, `ready`, `refuge`, `refused`, `rumour`, `scene`, `sensor`, `shakedown`, `sown`, `story`, `theft`, `thread`, `trade`, `vehicle`, `waypoint`, `weapon`.

## Prepared game session

All rows are **NOT RUN**. The runtime coordinator must identify the exact reviewed candidate DLL/package hash and the maintainer's isolated test profile before deployment. Capture the session ID, package hash, settings, frame dimensions, themes and versioned machine-readable state alongside each result. Keep a friction log throughout. The maintainer alone runs the game; independent Studio visual review remains required.

| Row | Pass rule |
|---|---|
| CV1 primitives and styling | Point, polyline, ground/camera-facing circle, polygon, box, label/chip, icon/fallback and panel draw correctly in light/dark at normal and enlarged scale. Camera-facing rings stay round from yaw/pitch/roll views; ground circles remain XY. Plates/text remain readable; no input is captured. Heat answers `unsupported_kind`. |
| CV2 brackets and camera alignment | XF actors get stable person-sized fallback brackets; world points and clipped segments align through ordinary and photo-mode cameras, including viewport changes. Record fallback rather than claiming engine bounds. |
| CV3 anchors | At defaults, 64 anchors refresh in four reads per 0.4 s cycle, never over 16 lookups per read or 10 reads/s. A despawn stays resolved through expected refresh plus 0.25 s, then holds/fades to 40% over one second and becomes lost. Reappearance resolves. Larger sets remain fair across producers; changed config bounds apply; slow ticks cause no catch-up bursts. |
| CV4 radar | North-up and heading-up map known offsets correctly; ground true/false circles coincide. Long-gap dashed circles remain complete when radar dashing downgrades at the cap; no content is removed to meet that budget. View settings persist on restart. |
| CV5 keys and visibility | Insert shows/hides and requires resend on show; Delete changes radar/world mode. CET/config rebind and `off` work, duplicate active keys are refused/disabled, kill clears immediately. Visibility events match each transition. |
| CV6 hidden work | Hide canvas, open CET and run an ordinary capture: no camera/entity acquisition or canvas render submission while suppressed; hidden counters remain unchanged. Key/lifecycle bookkeeping is recorded separately. |
| CV7 budgets | At admitted item/vertex/anchor caps, collect at least 256 active samples: pipe p99 ≤2 ms per 64 KiB, camera read ≤0.05 ms per tick, anchor read ≤0.15 ms per scheduled read and canvas render submission ≤0.5 ms. Verify reported anchor rate and separate timings; record publication and GPU/frame statistics separately. A CPU pass does not establish GPU cost. |
| CV8 world invalidation | An accepted load clears immediately before detach, late old-world feeds refuse, and a fresh-world resend works after attach. New game and kill also invalidate; disconnect withdraws only its owner's layers. |
| CV9 capture rule | Ordinary screenshot/sheet/burst evidence has no canvas. Explicit screenshot `overlay:"canvas"` includes canvas but omits the XF box. Kill and disabled overlay override the evidence flag; timeout restores normal draw rules. |

Styling choices copied from the XF box: 8 px screen margin, 8 × 2 px chip padding, 6 px panel vertical spacing and theme `BevelSmall` (4 px at 1×). Radar centre dot is 6 px; heading text and labels use the existing mono value font, titles the existing uppercase title font. These are review inputs, not a visual PASS.

## Open work

No contract decision remains unanswered. Independent coordinator code review, game commissioning (CV1–CV9, SN1–SN8) and Studio visual approval remain outstanding. The runtime coordinator owns the capability-registry update and integration version; neither was changed here.

Knowledge used: [runtime access](../../../knowledge/runtime-access.md), the [live-world-view proposal](../../../research/live-world-view/proposal.md), [glyph vocabulary](../../../research/live-world-view/glyphs.md) and [canvas contract](canvas.md). Camera/FOV and engine-bounds evidence remain incomplete as identified above. Canonicalization follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
