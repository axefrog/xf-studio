# Canvas candidate evidence

The unversioned canvas candidate is implemented and has passed the clean Release build and full offline checks. No deployment, game session, visual approval or version change is claimed. All changes remain uncommitted for coordinator review.

## Decisions and boundaries

- The runtime bridge coordinator decided to retain the observer refusal for `notify` and admit `display`, alongside existing reads and emergency controls. Display changes only XF drawing and needs no game-write permission.
- The coordinator approved generated vector geometry in place of the original icon-atlas proposal. SVG paths are flattened once by the theme generator; no runtime SVG parser, texture upload or new dependency is involved. The implementation follows [SVG's endpoint-arc algorithm](https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes).
- The real Studio theme slot is `XfCanvasPlate`, with effective alpha 0.7178. Chip and panel text uses `text`; tones mark edges. Plain labels retain their tone. The fallback plate has been removed.
- Counted vertices are **max(solid source vertices, expanded world-view vertices)** for each primitive. Source vertices are circle segments, polyline/polygon points, box edge endpoints and generated icon counts. Admission bounds every solid radar baseline. Only radar dashing can downgrade to solid; no radar budget culling or culling counter exists.
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
| Native `--unit` | 2,686 checks passed: 1,247 named plus 1,439 grouped, including 757 canvas checks; 3,000 deterministic parser mutations | <0.05 GB |
| `bun tools/selftest.ts` | All 1,332 checks passed | 0.3 GB |
| `bun test tools` | 1,121 passed / 4 opt-in on-screen skipped / 0 failed; 1,125 tests across 69 files, 23,372 assertions, 318.88 s | 1.0 GB |
| `bun run check` | TypeScript passed; 169 capabilities, 64 changelog lines; registry unchanged and current | 0.3 GB |
| Lua lint | All 5 Lua files passed | 0.1 GB |
| Theme, glyphs, fact presets and MCP reference | Generated data current | <0.05 GB each |
| Native declaration lint | All four package variants passed, 29 normal / 38 autonomous native globals | Included in redscript checks |
| Redscript, fallback | Passed against the fresh copied game bundle | 0.2 GB |
| Redscript, Codeware | Passed | 0.3 GB |
| Redscript, Codeware + probes + DM | Passed | 0.3 GB |
| Redscript, Codeware + Equipment-EX stub + TweakXL | Passed | 0.3 GB |
| Root Markdown links | 0 broken links/source paths across 479 Markdown files | <0.05 GB |
| Root private paths | 0 findings in tracked text files | <0.05 GB |
| New project files | 0 private-path/link findings across 18 untracked project files, including this report | <0.05 GB |
| `git diff --check` | Passed | — |

The full tools checks caught missing Canvas preloads in older CET harnesses, catalogue descriptions/undo/refusal wording and refusal-index wiring, and one outdated native-count assertion. These are corrected; the final full run above passed. The README's probes lint command also needed the existing DM script dependency (`XFDmIds`); the command now includes `--extra redscript-dm` and passes. Codeware runs retain the pre-existing redundant NPC casts and upstream Reflection return-path warnings, with no errors.

Earlier attempts were stopped by the unchanged machine-wide floor while the build held only 0.5–0.8 GB. No limit was raised and no unrelated process was stopped. After the coordinator supplied headroom, the clean build and final checks completed without a guard trip.

### Offline budgets

Each benchmark uses 256 samples from the final native unit run.

| Work | p99 | Maximum | Meaning |
|---|---|---|---|
| Parse/canonicalize/hash a 64 KiB padded batch expanding to 4,096 vertices | 0.4627 ms | 0.8656 ms | Below the 2 ms parser target |
| Project and near/viewport clip 16,384 vertices | 0.4926 ms | 1.4439 ms | Geometry only; excludes ImGui submission and GPU execution |

The cached projection scale removed repeated `tan` calls per endpoint. The complete render target remains a game commissioning check even though offline projection is below 0.5 ms p99. Camera acquisition (≤0.05 ms per tick) and paced anchor acquisition (≤0.15 ms per read) also require game evidence; synthetic service timings do not establish engine cost. Live state records camera, anchor, publication and render timings separately.

The built `build/Release/XFRuntimeBridge.dll` is an autonomous/engine-input-test candidate, SHA-256 `33a69a36b34b0f1875814f16b64bb849444899c3ea66df10a70371b8177c3354`. It has not been staged or deployed. The coordinator must review the source and identify the package/profile for the prepared session.

Disk checkpoint: this worktree remains below 5 GB and C has approximately 264.8 GB free. No large task-owned payload is retained outside its ignored build directory; final logs replace superseded development logs.

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

No contract decision remains unanswered. Independent coordinator code review, game commissioning (CV1–CV9) and Studio visual approval remain outstanding. The runtime coordinator owns the capability-registry update and integration version; neither was changed here.

Knowledge used: [runtime access](../../../knowledge/runtime-access.md), the [live-world-view proposal](../../../research/live-world-view/proposal.md), [glyph vocabulary](../../../research/live-world-view/glyphs.md) and [canvas contract](canvas.md). Camera/FOV and engine-bounds evidence remain incomplete as identified above. Canonicalization follows [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).
