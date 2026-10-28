# CORE-03 slice 13a report

The optional registered compatibility projection is implemented from `34f34b65`. Changes are uncommitted for coordinator review. CORE-03 remains **High**; real shell startup/mount/release is outside this slice.

## Construction and consumers

The core accepts the neutral workspace/document, with no required `documents.live`, region or makeup bundle. The existing feature registration can contribute `authoring.create`; created projection values are held beside the existing opaque editors, not in another registry. Eye makeup registers `makeupAuthoring`, which creates exactly the previous document, geometry, presentation, recipe, eyeMakeup, gestures and controls bundle. It owns the one detached geometry cache. Its optional presentation reader and drawn-context follower use that same bundle.

Consumers changed:

- `trusted-authoring-core.ts` creates optional registered projections over the neutral document and supplies their compatibility services to the application.
- `profile-authoring.ts` does the same for the blocked base and each keyed look. Its root neutral document follows the drawn context; registered projection followers retain the previous root subscriptions. Same-look requesters share the original keyed projection and history.
- `trusted-studio-bootstrap.ts` supplies `core.lookDocument` to collection reads and requests the optional presentation through the existing registry. File reads already use that neutral document and stay there.
- The layered flat/surface and preview adapters obtain their existing geometry/presentation/source from the registered optional projection. A missing binding refuses explicitly. The structural preview-source input remains available to direct adapter callers/tests.
- Generic editor/preview lookup handles an absent primary feature. Startup only converts its existing released workspace through `lookWorkspace` before passing it to the neutral profile constructor; no startup policy/behavior moved there.

`tests/fixtures/makeup-core.ts` preserves released test vocabulary by normalizing legacy workspace input and exposing the real constructor's registered bundle. Existing makeup tests change imports, keeping their behavior assertions. The new zero/synthetic product gates import the production constructors directly and use neutral workspaces; they do not use that compatibility fixture.

## P3-v handoff

`profile-authoring.ts` changes the keyed attachment from a mandatory makeup bundle to `{ projections, projectionServices, app }` beside the neutral editing owner. The drawn application's fork receives that keyed attachment's original services. Root followers are registered by the projection owner; they wrap the existing per-look bundle and create no cache or writer.

The existing `PanelEditingContexts.bind()` spread therefore carries the bound neutral document and projection map into each child bootstrap unchanged. Its production source is untouched. A viewport test that previously supplied `{}` now supplies a real registered core. The profile fixture exposes both neutral production handles and a test-only compatibility view so the direct router regression uses the production handles.

No change to `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()`, `history.selectScope`, panel contributions, instance catalogue, IDs, component library or style-guide sources. The generated `public/style-guide.html` is unchanged.

## Gates

All heavy jobs use the full-path Python memory guard with a 4 GB limit, sequentially. Chrome is unavailable process-locally. Skips are not passes. No quiet window was relayed.

| Gate | Result |
|---|---|
| Baseline capture on unchanged `34f34b65` production | 2 pass, 0 fail, 2 snapshots, 13 assertions; 0.0 GB reported peak. The first attempt used an invalid fixture scope and was corrected before production edits |
| Authoring check | Pass, all four TypeScript projects, including after the last fixture changes; final peak 1.6 GB |
| Targeted compatibility | Original run: 924 pass, 3 skip, 1 outdated viewport-fixture failure; 87 files, 16 snapshots, 99,209 assertions, 1.6 GB peak. Corrected viewport plus new boundary and product gates: 50 pass, 0 fail, 4 files, 2 snapshots, 570 assertions, 0.4 GB peak. Scene/guide fixture follow-up: 5 pass, 0 fail, 2 files, 1 snapshot, 22 assertions, 0.0 GB reported peak. Unique final focused coverage: **931 pass, 3 skip, 0 unresolved fail across 89 files**, 17 matching snapshots |
| New product construction/parity | 6 pass, 0 fail, 2 files, 2 snapshots, 77 assertions; zero/synthetic real core, base/keyed profiles and trusted bootstrap; normal document/history/geometry and A/B/A identity |
| Style-guide build/test | Build succeeds; generated HTML unchanged. 10 pass, 0 fail, 65 assertions; 0.0 GB reported peak |
| Desktop-local check/tests | Check passes with the matching Electrobun devkit, 1.0 GB peak. Tests: 133 pass, 11 skip, 0 fail; 20 files, 910 assertions, 0.7 GB peak |
| 038 quick harness | 11 pass, 0 fail; 4 files, 46 assertions; 146.26 s; 1.7 GB peak |
| Five suite batches | **4,528 pass, 185 skip, 0 fail across 531 tracked files**, withholding latency. Per-batch pass/fail/skip: **978/0/17, 925/0/18, 957/0/13, 973/0/3, 695/0/134**. Peaks **1.1/3.5/2.4/1.6/1.2 GB**. One complete run; no batch rerun or memory floor/limit kill |
| Executed authoring union before last latency | The two new untracked test files are outside the batching script's `git ls-files` enumeration. Add their 6 separately verified passes exactly once: **4,534 pass, 185 skip, 0 fail across 533 executed files** |
| Repository checks | 0 broken links/source paths across 500 tracked Markdown files; 0 tracked-text privacy findings; all 6 new files have 0 privacy/whitespace/link/source findings; `git diff --check` clean |
| Latency, fresh process last | **1 pass, 0 fail, 5 assertions**; GetSystemTimes CPU **34.9%**. Edit/drag/store p95 **1.08/0.59/0.33 ms**, all under the unchanged 4 ms budgets; 16 layers, 80 Undo steps; 0.4 GB peak |
| Final executed authoring union | **4,535 pass, 185 skip, 0 fail across 534 files**, including the two new files and the separately withheld latency file exactly once |
| Footprint/cleanup | Checkpoint: 218.9 GB free on C; wrap-up: **216.5 GB free**. No task payload above 5 GB. Automatic approval review rejected scratch deletion as “blocked by policy”; 304,654 bytes and an empty folder remain, with zero junctions/reparse points |

The five environment-sensitive Inno Setup install-outcome cases skip because the pinned compiler is absent: installed-facts/closing-error success; outcome exit codes/headings/next steps; output phases/closing-error names; installed-build/uninstall-entry identity; Microsoft Store private versus real local AppData. The sixth Windows physical-path lookup also skips. The other five desktop skips are optional native/packaging/installed-refresh oracles.

The final test-only sweep found two more adapter doubles using the old bundle shape. `scene-editors.test.ts` now supplies its same geometry/presentation doubles in the registered projection slot; `surface-guide-materials.test.ts` supplies a real registered core. They were corrected before their full-suite partitions ran. All five cases and the existing surface-wiring snapshot pass separately afterward. No production change or assertion relaxation followed the focused run.

The latency observation measures offline service work, not paint or GPU latency. All owned gate processes have ended. No port, game, mod-manager setup or framework installation was touched; no subagents were started.

## Frozen parity evidence

No existing golden is updated. The new two-snapshot file was captured before production edits on `34f34b65`, then matched without snapshot updates. Its 296,494 bytes use lossless JSON-to-lines serialization.

| Snapshot | SHA-256 | What it covers |
|---|---|---|
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Real product document/history/geometry states across gesture/Undo/Redo; detached recipe/layer/point/field/array identity; keyed same-look sharing and different-look isolation; exact history scope object; drawn A/B/A state and revoked old gesture |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Released portable bytes/names/refusals, collections/compiler plan, Check/Build payloads and real partial omissions |
| `core-viewport-parity.test.ts.snap` | `4218497cc20c45418ec064011858c7dc7ba98acb9c1469c33813f031a973aa61` | Bound UV navigation, selection, independent gesture commit/Escape and release; existing surface-wiring parity runs alongside it |
| `core-preview-parity.test.ts.snap` | `9f511a4a541a265fb32fe79d0d321091f6a425b150e9c6ecc0a696f279c9b08d` | Prepared files/manifest/cache keys, worker pixel hashes, presentation/publication and warm/superseded preview behavior |
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Context candidates/popovers, hints, cursors and rendered labels |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Contributed guidance/Help text, anchors and controller behavior |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install defaults and identities, canonical data and compatibility wording |

These are offline service/adapter results. No browser, GPU, game or mounted-empty-shell result is claimed.

## Remaining slices and coordinator checks

- **13b:** inject the composition into the same real `start(host)` path; make region/starter wiring optional and preserve verification isolation. Return its AbortSignal-driven lifetime handle.
- **13c:** coordinated owner release, including partial/failed startup; no late publications and observed resource counts returning to baseline.
- **13d:** real zero-feature mount/paint/dispose and synthetic panel/editor/Undo/file substitution, with mechanically enumerated feature/composition-only integration and retained-consumer accounting. CORE-03 closes only after those gates and coordinator browser evidence.

Coordinator `?verify=1` checks for the normal composition:

1. Cold start/paint and restore current/legacy workspace and collection data. Compare the existing layout in light/dark at narrow/wide sizes; no visible change is intended.
2. Bind two UV/3D/inspector panels to different looks, then two to the same look. Check independent versus shared edits, selection, field selection, controls, point/tangent/field/shape gestures, one-step Undo and Escape without Redo.
3. Keep A alive through a second panel, switch the drawn context A/B/A while a gesture/control/menu/file operation is captured, and verify old continuations cannot edit a different/replaced target. Confirm `historyScopes()` identity, explicit History scope selection and panel bindings.
4. Recipe/collection import/export, selected-layer mask, Check/Build and partial omission wording; root mask capability must follow A/B/A. Reload and verify saved identities/content.
5. Close/reopen a bound panel, release/reacquire looks and rehost a viewport; check that the surviving same-look panel remains live, with no stale selection, hints or guides. Preserve warm-head preview reuse.

Chrome/GPU rows potentially affected by the optional-source handoff: WebGL scene-host/render parity; initial preparation/first draw; preview/raster masks and guide identity; A/B/A and warm S2 returns; cancellation, release and context restoration. Run the standard WebGL set, both dock-strip geometry tests, tree-view geometry and layout-tabs timing. The dock/component/catalogue implementations are untouched, so those are regression checks. Browser captures, independent review and any visual PASS remain coordinator-owned; no game test is required for this slice.

## Footprint and cleanup

All unique parity evidence and gate accounting are in the candidate snapshot, plan and this report. Automatic approval review rejected the verified-target PowerShell deletion as **“blocked by policy”** before the command ran. No alternate deletion or approval escalation was attempted. The coordinator can remove these worktree-relative paths; together they contain **304,654 bytes**, zero junctions/reparse points and no private/game payload:

- `local/core-03-s13a/`: gate logs and targeted file enumeration, 297,150 bytes.
- `projects/xf-studio/authoring/local/core-03-s13a/`: empty directory created for the initial capture.
- `local/core-03-s13a-edits.py`: 1,636 bytes.
- `local/core-03-s13a-gates.ps1`: 2,198 bytes.
- `local/core-03-s13a-latency.py`: 1,220 bytes.
- `local/core-03-s13a-records.py`: 2,450 bytes.

## Changed files

73 files, including this report:

- `projects/xf-studio/authoring/src/app/authoring/feature-projections.ts`
- `projects/xf-studio/authoring/src/app/authoring/makeup-view.ts`
- `projects/xf-studio/authoring/src/app/profiles/profile-authoring.ts`
- `projects/xf-studio/authoring/src/app/trusted-authoring-core.ts`
- `projects/xf-studio/authoring/src/app/trusted-studio-bootstrap.ts`
- `projects/xf-studio/authoring/src/compose/studio-registry.ts`
- `projects/xf-studio/authoring/src/compose/studio-startup.ts`
- `projects/xf-studio/authoring/src/preview/browser/editor-adapters.ts`
- `projects/xf-studio/authoring/src/preview/browser/layered-editor-adapters.ts`
- `projects/xf-studio/authoring/src/preview/browser/layered-preview-capability.ts`
- `projects/xf-studio/authoring/src/preview/browser/preview-capabilities.ts`
- `projects/xf-studio/authoring/tests/__snapshots__/core-product-parity.test.ts.snap`
- `projects/xf-studio/authoring/tests/alpha-capability-reasons.test.ts`
- `projects/xf-studio/authoring/tests/application-actions.test.ts`
- `projects/xf-studio/authoring/tests/application-api-gaps.test.ts`
- `projects/xf-studio/authoring/tests/architecture-import-boundary.test.ts`
- `projects/xf-studio/authoring/tests/authoring-layer-actions.test.ts`
- `projects/xf-studio/authoring/tests/browser-viewport-device.test.ts`
- `projects/xf-studio/authoring/tests/character-switch.test.ts`
- `projects/xf-studio/authoring/tests/control-edit-validation.test.ts`
- `projects/xf-studio/authoring/tests/core-context-boundary.test.ts`
- `projects/xf-studio/authoring/tests/core-editing-transactions.test.ts`
- `projects/xf-studio/authoring/tests/core-editor-failures.test.ts`
- `projects/xf-studio/authoring/tests/core-product-construction.test.ts`
- `projects/xf-studio/authoring/tests/core-product-parity.test.ts`
- `projects/xf-studio/authoring/tests/easing-transitions.test.ts`
- `projects/xf-studio/authoring/tests/empty-choices.test.ts`
- `projects/xf-studio/authoring/tests/expressions-feature.test.ts`
- `projects/xf-studio/authoring/tests/feature-facades.test.ts`
- `projects/xf-studio/authoring/tests/finish-actions.test.ts`
- `projects/xf-studio/authoring/tests/fixtures/bench-look-history.ts`
- `projects/xf-studio/authoring/tests/fixtures/hair-feature.ts`
- `projects/xf-studio/authoring/tests/fixtures/history-parity.ts`
- `projects/xf-studio/authoring/tests/fixtures/look-history-parity.ts`
- `projects/xf-studio/authoring/tests/fixtures/makeup-core.ts`
- `projects/xf-studio/authoring/tests/fixtures/named-targets.ts`
- `projects/xf-studio/authoring/tests/fixtures/profile-context-studio.ts`
- `projects/xf-studio/authoring/tests/fixtures/profile-session-generator.ts`
- `projects/xf-studio/authoring/tests/fixtures/profile-studio.ts`
- `projects/xf-studio/authoring/tests/history-limit.test.ts`
- `projects/xf-studio/authoring/tests/history-service.test.ts`
- `projects/xf-studio/authoring/tests/history-timeline.test.ts`
- `projects/xf-studio/authoring/tests/lighting-preset.test.ts`
- `projects/xf-studio/authoring/tests/lighting-setups.test.ts`
- `projects/xf-studio/authoring/tests/look-history.test.ts`
- `projects/xf-studio/authoring/tests/look-model.test.ts`
- `projects/xf-studio/authoring/tests/look-transaction.test.ts`
- `projects/xf-studio/authoring/tests/mottle-actions.test.ts`
- `projects/xf-studio/authoring/tests/panel-bindings.test.ts`
- `projects/xf-studio/authoring/tests/per-view-editing.test.ts`
- `projects/xf-studio/authoring/tests/presentation-read-extensions.test.ts`
- `projects/xf-studio/authoring/tests/profile-sessions.test.ts`
- `projects/xf-studio/authoring/tests/profiles-multi-subject.test.ts`
- `projects/xf-studio/authoring/tests/profiles-no-default-boundary.test.ts`
- `projects/xf-studio/authoring/tests/profiles-targets-dispatch.test.ts`
- `projects/xf-studio/authoring/tests/registered-editing.test.ts`
- `projects/xf-studio/authoring/tests/registered-preview.test.ts`
- `projects/xf-studio/authoring/tests/scene-editors.test.ts`
- `projects/xf-studio/authoring/tests/studio-application.test.ts`
- `projects/xf-studio/authoring/tests/studio-registry.test.ts`
- `projects/xf-studio/authoring/tests/surface-guide-materials.test.ts`
- `projects/xf-studio/authoring/tests/trusted-preview-services.test.ts`
- `projects/xf-studio/authoring/tests/trusted-studio-bootstrap.test.ts`
- `projects/xf-studio/authoring/tests/view-modules.test.ts`
- `projects/xf-studio/authoring/tests/view-routes.test.ts`
- `projects/xf-studio/authoring/tests/workspace-lease.test.ts`
- `projects/xf-studio/authoring/tests/workspace-persistence.test.ts`
- `research/authoring/code-health.md`
- `research/authoring/core-03-plan.md`
- `research/authoring/core-03-s12-remaining-consumers.md`
- `research/authoring/core-03-s13a-report.md`
- `research/authoring/ui-architecture-boundary.md`
- `research/backlog/README.md`

**Knowledge used:** knowledge index; CORE-03 plan and all as-built notes, slice-12 report/consumer ledger; architecture contract and UI architecture boundary; view-graph design and editor invariants; developer orientation/test helpers; project status/backlog and project README. The plan/projection ledger's mandatory-construction statements are corrected by the observed offline gates. No game-engine knowledge page was contradicted or new game/runtime finding observed.
