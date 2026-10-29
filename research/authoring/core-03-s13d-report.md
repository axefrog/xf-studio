# CORE-03 slice 13d report

Implemented from `6cfdbb86`, **uncommitted**. Recommendation: **CORE-03: Closed, pending the coordinator's browser gates** and independent review. The ledger deliberately retains CORE-03 as High until acceptance. **CORE-249 (Medium)** is claimed by the coordinator and tracks the retained R/D/B/P/S/G/V placement. No existing-feature bug was found or changed.

The coordinator accepted 13c3's real normal/empty mounted and partial-start resource proof on `6cfdbb86` (8 pass, 0 fail, per this slice's brief and coordination row). This report adds CPU/substitution evidence and new required browser assertions; it does not claim those new browser rows passed here.

## Changed files and release ownership

Authoring paths below are relative to `projects/xf-studio/authoring/`.

| Files | Change and abort owner |
|---|---|
| `src/features/eye-makeup/view/index.ts` | Existing view binding supplies status text and exact error-tooltip precedence. Stateless; no new subscription or release work. |
| `src/studio-ui/views/feature-view.ts` | Optional typed `status(frame)` on the existing binding/helper, alongside summary/readiness. No separate registry, catalogue, instance or resource owner. |
| `src/studio-ui/app.ts` | Pass bindings to the existing status bar; render the first supplied status, or hide/clear that same slot. The existing shell signal still stops updates and releases shell consumers. |
| `tests/features/synthetic-layers/index.ts` | Test-only codec, two layers, action, opaque editor and file contribution. The real editing owner aborts the editor's subscription, clears its cached snapshot and rejects retained editor/file reads. The portable contribution proves export; its import handler explicitly refuses and is outside this fixture's proof. |
| `tests/features/synthetic-layers/view.ts` | One panel using existing buttons and the generic feature facade; edit, platform Undo and offered file export. It owns only local DOM listeners, no global resource; normal panel disposal/DOM withdrawal ends it. |
| `tests/compose/synthetic-startup.ts` | The only synthetic registration/composition. Uses existing localhost verification lease/outbox adapters and the real `startStudio(host, { composition })`; no alternate bootstrap or makeup facade. Existing application/host signals own release. |
| `tests/core-status-parity.test.ts`, its snapshot | Frozen pre-edit footer structure/text/title parity, plus empty-composition read traps. No release owner. |
| `tests/core-substitution.test.ts`, its snapshot | Direct import enumeration, forbidden-edge controls, real core/editor/action/Undo/file and retained-read abort proof. Test disposes its application/core in `finally`. |
| `tests/core-substitution-browser.test.ts` | Two isolated CDP rows; same product startup, decoded-pixel paint gate, laid-out panels, empty/synthetic exclusions, synthetic edit/Undo/file bytes, same-page resource baseline and console checks. Page and disposable host end in `finally`. |
| `tests/core-retained-consumers.test.ts` | Audits all 77 direct consumers, 156 declared dependency edges, seven criteria and six projection groups. No new runtime owner. |
| `research/authoring/core-03-plan.md`, this report | Correct current proof table, 13d row/as-built note, results and handoff. |
| `research/authoring/core-03-s12-remaining-consumers.md`, `code-health.md` | Account for every retained row under CORE-249; proposed closure remains conditional. |
| `research/authoring/ui-architecture-boundary.md` | Record the optional status contract and remove stale mandatory-runtime/status-bar wording. No import allowance widens. |
| `research/backlog/README.md` | Update only CORE-03's state. `docs/status.md` has no CORE-03 status statement and is unchanged. |
| `knowledge/webgl-program-linking.md` | Distil optional status ownership and CPU proof limits; carry forward coordinator-reported 13c3 acceptance, distinguishing it from new unrun browser assertions. |

Release order is unchanged: settle/commit edits → protect pending outbox recovery → workspace permits retirement → withdraw shell consumers → release heads/runtimes → dispose shared viewport renderer/context → release profile/look editors → finish durable host handoff → stop the lease. Failed save/protection retains recovery and the lease. Shell teardown removes listeners/observers/timers/frames/controllers; facial/warm/update owners cancel their work through the existing signals. Accepted diagnostics keepalive and already accepted durable writes retain their existing separate lifetimes. The new status contribution owns no resource. Synthetic editor/cache/subscription release joins the existing look owner; synthetic file reads check that same signal.

**Bound panel and capture release:** no implementation changes. `panels.bindings`, `panels.setBinding`, `authoring.historyScopes()`, `history.selectScope`, P3-v contribution/instance catalogue implementations and IDs, startup/release ordering and all 3/11 import allowances remain unchanged. Existing viewport/product parity still checks bound contexts, captured identities and A/B/A behavior.

## Substitution enumeration

The existing boundary scanner covers static and type-only imports, re-exports, dynamic/require forms and modules loaded by URL. The test scans `src/` and `tests/`, resolves direct edges and freezes every edge entering/leaving the synthetic feature/composition. Computed integration imports are refused. Only the two evidence tests may import those artifacts from outside; integration may not pull in another test helper or makeup/feature implementation. Injected production-importer, makeup-dependency and extra-helper edges must fail.

Final output:

```json
{"integration":["tests/compose/synthetic-startup.ts","tests/features/synthetic-layers/index.ts","tests/features/synthetic-layers/view.ts"],"productionImporters":[],"edges":23}
```

The full 23-edge list is in [the import snapshot](../../projects/xf-studio/authoring/tests/__snapshots__/core-substitution.test.ts.snap). Of these, 17 point at existing source ports/helpers, three connect the integration artifacts and three come from the evidence tests. This is a direct-import integration boundary, not a claim that shared source has no transitive makeup imports or that the browser bundle contains no makeup code.

## Status-bar parity and compatibility

Before any production edit, the new test extracted the real private `statusBar` implementation from unchanged `6cfdbb86`, transpiled it and exercised it with the light DOM and real DOM/progress helpers. It captured 24 combinations: Ready/Updating/error × 256/512/1K/2K × head absent/ready, plus two error-tooltip precedence cases. Restoring/activity inputs are fixed because their code did not change. Current output matches that frozen snapshot without updating it. The test compares the footer tree, tags, attributes/classes, hidden flags, text and tooltip bytes. Empty bindings additionally trap readiness/viewport reads and require a hidden, empty badge.

Every `studio-ui` edit is listed above: `app.ts` and `views/feature-view.ts` only. There is no CSS, component, style-guide or panel-catalogue edit. The same footer slot, position, classes, text and title remain for the normal composition. Actual pixel/layout comparison in both themes at narrow/wide sizes remains coordinator-owned.

SHA-256 below uses Git-normalized LF bytes. All eight pre-existing snapshot files are unchanged against `6cfdbb86` (17 frozen snapshots); two new files add status parity and the import graph.

| Snapshot | SHA-256 | Coverage |
|---|---|---|
| `core-status-parity.test.ts.snap` | `f7c3478f3f4adfda0a48e47269339911a1b69ffd27e4b7bb635383c29d13994c` | New 102,771-byte footer baseline captured before production edits. |
| `core-substitution.test.ts.snap` | `5d5eae6d9b9492811ee168f727d1c843d4e0c1e1bb7d124d5874c6e4188b8c86` | New direct import graph; includes the browser bundle's URL-loaded composition. |
| `core-context-parity.test.ts.snap` | `ce159a33b48fc3cd9639135b4524525746a2225589ad3f3b50719a00d76e2814` | Menus, hints, states and popovers. |
| `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Released file bytes/names/refusals and Check/Build partial-export payloads. |
| `core-guidance-parity.test.ts.snap` | `4d946713a250079eeed320adfddfb315c979b0ff462eca24651bb99bed6379ec` | Guidance, Help, onboarding, navigation and dismissal. |
| `core-placement-parity.test.ts.snap` | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/framework/install identities and helper bytes. |
| `core-preview-parity.test.ts.snap` | `d08aafdc22af193b07683329670dd8bdc6cd0fc0b81adc60eaec9e0f298ed342` | Preparation identities, raster and preview/warm behavior. |
| `core-product-parity.test.ts.snap` | `97afc5de336b0760c6699f4f904e1052f6ed91cb5d4440fb6e40472b2eef29ec` | Document/history/geometry, keyed sharing, A/B/A and captured runs. |
| `core-startup-parity.test.ts.snap` | `38072be50b2cf4d466af6bada1b57629357a50e03999347db9ecf932e1e4c2c9` | Normal registry/defaults/catalogue/bindings/workspace/starter data. |
| `core-viewport-parity.test.ts.snap` | `053a596936ce05af98fd1c0b9ac81233fd89152d9a0e8c0bb3bfc511b39d226b` | Bound UV navigation, selection, gestures/cancel/release. |

Unchanged `public/studio.css`: `1e21fe7b3a1423636e810829e237b59b0ea80713df8f8a7959afc7c790aa80e0`. No recipe/schema, SQLite, cache key, raster arithmetic, compiler, Check/Build filter, manifest or pipeline stage changes; no pipeline diagram or rendering gate is needed for this slice.

## Retained-consumer outcome

**77/77 direct consumers and 156/156 declared dependency edges exist; all seven criteria have reasons/removal criteria and owners; all six projection groups remain accounted for.** Each consumer's outcome is “retained, explicitly owned, no required neutral mount/substitution/release dependency.” The runtime construction/registration and abort proofs establish that distinction; pending browser rows must confirm it at the mounted boundary.

The entry-by-entry table below references the exact reasons/removal criteria in [the ledger](core-03-s12-remaining-consumers.md): R preserves released schemas; D replaces static descriptors with registry reads; B injects shared product data/hints (UI owns its specimens); P injects/moves the planner/export/migration group together; S injects neutral head/prerequisite metadata without changing cache/settings identity; G migrates concrete mutation/history/facade constructors through registered ports; V migrates structural device/source ports while preserving UV/gesture/cache/raster identity. No retained item gains a new lifetime or registry.

| Consumer (under authoring source) | Criterion / owner | Declared imports audited |
|---|---|---|
| `app/authoring/makeup-application.ts` | G; CORE-249 | 1 / pass |
| `app/authoring/makeup-document.ts` | G, R; CORE-249 | 2 / pass |
| `app/authoring/makeup-files.ts` | P, R; CORE-249 | 4 / pass |
| `app/studio-action-descriptors.ts` | D; CORE-249 | 1 / pass |
| `app/studio-application.ts` | G, V; CORE-249 | 3 / pass |
| `app/studio-presentation.ts` | V; CORE-249 | 1 / pass |
| `app/trusted-studio-bootstrap.ts` | V; CORE-249 | 1 / pass |
| `app/viewport-attachment.ts` | V; CORE-249 | 1 / pass |
| `app/workspace/makeup-workspace.ts` | R; CORE-249 | 1 / pass |
| `app/workspace/workspace-state.ts` | V; CORE-249 | 2 / pass |
| `compose/studio-registry.ts` | S; CORE-249 | 3 / pass |
| `compose/system-families.ts` | V; CORE-249 | 1 / pass |
| `features/expressions/view/sets.ts` | B; CORE-249 | 1 / pass |
| `features/eye-makeup/export/index.ts` | P, R, S; CORE-249 | 10 / pass |
| `features/eye-makeup/export/plate-input.ts` | P, S; CORE-249 | 6 / pass |
| `features/eye-makeup/export-info.ts` | B; CORE-249 | 1 / pass |
| `features/eye-makeup/index.ts` | D, R; CORE-249 | 2 / pass |
| `features/eye-makeup/part.ts` | R; CORE-249 | 1 / pass |
| `features/eye-makeup/product.ts` | B, R; CORE-249 | 2 / pass |
| `features/eye-makeup/region.ts` | R; CORE-249 | 1 / pass |
| `host/package-server.ts` | S; CORE-249 | 2 / pass |
| `installation/framework-fixtures.ts` | B; CORE-249 | 1 / pass |
| `legacy/eye-makeup/browser/browser-preview-device.ts` | V; CORE-249 | 4 / pass |
| `legacy/eye-makeup/browser/raster-worker.ts` | V; CORE-249 | 1 / pass |
| `legacy/eye-makeup/browser/surface-editor.ts` | V; CORE-249 | 4 / pass |
| `legacy/eye-makeup/browser/surface-tangent.ts` | V; CORE-249 | 1 / pass |
| `legacy/eye-makeup/browser/uv-editor.ts` | V; CORE-249 | 3 / pass |
| `legacy/eye-makeup/editor-actions.ts` | R; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/export-diagnostics.ts` | P; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/glitter-route.ts` | P; CORE-249 | 2 / pass |
| `legacy/eye-makeup/export/glitter-studio-flakes.ts` | P; CORE-249 | 2 / pass |
| `legacy/eye-makeup/export/host/archive-inventory-fs.ts` | P; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/host/native-resource-tools.ts` | P; CORE-249 | 2 / pass |
| `legacy/eye-makeup/export/host/package-bake.ts` | P, R; CORE-249 | 4 / pass |
| `legacy/eye-makeup/export/host/package-resource-builder.ts` | P; CORE-249 | 7 / pass |
| `legacy/eye-makeup/export/host/plate-uv-footprint-io.ts` | P; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/host/verifier-wolvenkit.ts` | P; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/package-action.ts` | P, S; CORE-249 | 2 / pass |
| `legacy/eye-makeup/export/package-filter.ts` | P; CORE-249 | 4 / pass |
| `legacy/eye-makeup/export/package-resources.ts` | P; CORE-249 | 1 / pass |
| `legacy/eye-makeup/export/preset-collection.ts` | B, P, R; CORE-249 | 5 / pass |
| `legacy/eye-makeup/plate/eye-plate-cut.ts` | S; CORE-249 | 1 / pass |
| `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-249 | 2 / pass |
| `legacy/eye-makeup/plate/eye-plate-verify.ts` | S; CORE-249 | 1 / pass |
| `legacy/eye-makeup/plate/host/eye-plate-cache.ts` | S; CORE-249 | 1 / pass |
| `legacy/eye-makeup/plate/host/eye-plate-head-resolver.ts` | S; CORE-249 | 2 / pass |
| `legacy/eye-makeup/plate/host/eye-plate-prerequisite.ts` | B, P, S; CORE-249 | 8 / pass |
| `legacy/eye-makeup/plate/host/eye-plate-service.ts` | B, P, S; CORE-249 | 10 / pass |
| `legacy/eye-makeup/plate/host/eye-plate-wolvenkit.ts` | S; CORE-249 | 1 / pass |
| `legacy/eye-makeup/preview/authoring-preview-coordinator.ts` | V; CORE-249 | 4 / pass |
| `legacy/eye-makeup/preview/authoring-preview-policy.ts` | V; CORE-249 | 1 / pass |
| `legacy/eye-makeup/preview/authoring-render-scheduler.ts` | V; CORE-249 | 1 / pass |
| `legacy/eye-makeup/preview/preview-quality-actions.ts` | V; CORE-249 | 1 / pass |
| `library/browser/collection-transport.ts` | P; CORE-249 | 1 / pass |
| `library/host/library-migrations.ts` | P; CORE-249 | 1 / pass |
| `library/host/library-store.ts` | R; CORE-249 | 1 / pass |
| `library/part-presets.ts` | P; CORE-249 | 1 / pass |
| `preview/browser/editor-adapters.ts` | V; CORE-249 | 1 / pass |
| `preview/browser/layered-editor-adapters.ts` | V; CORE-249 | 3 / pass |
| `preview/browser/layered-preview-capability.ts` | V; CORE-249 | 3 / pass |
| `preview/browser/layered-preview-wiring.ts` | V; CORE-249 | 1 / pass |
| `preview/browser/panel-uv.ts` | V; CORE-249 | 1 / pass |
| `preview/browser/preview-capabilities.ts` | V; CORE-249 | 1 / pass |
| `preview/host/preview-core-service.ts` | S; CORE-249 | 1 / pass |
| `preview/preview-capabilities.ts` | S; CORE-249 | 1 / pass |
| `preview/preview-core-assemble.ts` | S; CORE-249 | 1 / pass |
| `preview/preview-core-recipe.ts` | S; CORE-249 | 1 / pass |
| `setup/host/local-settings-server.ts` | S; CORE-249 | 1 / pass |
| `setup/local-settings.ts` | S; CORE-249 | 1 / pass |
| `showroom/host/build.ts` | R; CORE-249 | 1 / pass |
| `showroom/resources.ts` | B; CORE-249 | 1 / pass |
| `studio-ui/guidance/help-topics.ts` | B; CORE-249 | 1 / pass |
| `studio-ui/guidance/tours.ts` | B; CORE-249 | 1 / pass |
| `studio-ui/panels/collection.ts` | B; CORE-249 | 1 / pass |
| `studio-ui/panels/preview.ts` | V; CORE-249 | 1 / pass |
| `studio-ui/style-guide/components.ts` | B; UI track | 1 / pass |
| `studio-ui/style-guide/library-demo.ts` | B; UI track | 1 / pass |

All six projection groups remain with CORE-249: composition → optional registered `makeup-view`; that view → its sole document/geometry/presentation cache; released application/library/workspace adapters → `makeup-document`; presentation/facade forwarding → `AuthoringPresentation`; flat/surface adapters → the optional registered projection; preview capability → its structural `PreviewLayerSource`. Their concrete removal criteria remain in the ledger. There is no second cache, history or state owner.

CORE-249 is **Medium**, owned by XF · Studio (UI track for the two specimens): migrate each R/D/B/P/S/G/V group through the existing ports, preserve its released compatibility and identity baselines, then remove/relocate the one implementation. CORE-03 remains High only until the integrated browser/review acceptance gates pass.

## Gates

Every completed Bun process ran alone under the requested 4 GB memory guard, using full-path Python. No typecheck, full suite/batches, desktop gate, 038, style-guide build or latency gate ran. No guard limit/floor kill occurred.

| Gate/run | Result |
|---|---|
| Pre-edit status capture | 1 pass, 0 fail, one new snapshot, one assertion, 82 ms, reported peak 0.0 GB. |
| Status after production edit | 1 pass, 0 fail, one matching snapshot, one assertion, 64 ms, 0.0 GB. |
| Initial core/status proof | 4 pass, 0 fail, two snapshots (one new graph), 22 assertions, 2.26 s, 0.3 GB. |
| Interrupted development run | Ledger-update script used the wrong cwd and failed before editing; ledger test consequently failed (old owner), status tests passed 2. Chrome discovery was mistakenly left enabled; the browser row began but was interrupted with Ctrl+C. No browser result, completed-run count or peak is claimed. |
| Corrected four-file run | 5 pass, 2 Chrome skips, 0 fail, two snapshots, 211 assertions, 1.78 s, 0.3 GB. |
| Complete permitted 20-file gate | **92 pass, 9 skip, 0 fail; 19 snapshots, 1,150 assertions, 23.86 s, 0.6 GB.** Includes mandatory boundaries/bootstrap/view contributions, eight original parity files, new status/substitution/ledger files and all startup CPU/browser files. |
| Stronger scanner follow-up | 1 pass, 1 expected-development snapshot failure: the reused scanner additionally found the browser composition URL edge. One graph snapshot failed; 20 assertions, 1.79 s, 0.3 GB. No old parity snapshot was updated. |
| Graph correction/browser-skip follow-up | 2 pass, 2 Chrome skips, 0 fail, one graph snapshot, 20 assertions, 2.12 s, 0.3 GB. |
| Final bounded-import negative controls | 2 pass, 0 fail, one graph snapshot, 24 assertions, 1.72 s, 0.2 GB. Corrected Windows path normalization and refused any extra test-helper integration. |
| Final distinct-test accounting | **92 pass, 9 skip, no unresolved failure across 20 files.** Follow-ups replace the earlier graph proof and add no distinct tests. |
| Link/private-path/whitespace | 0 broken links/source paths across 505 tracked Markdown files; 0 tracked-text privacy findings; 0 link/source, privacy or trailing-whitespace findings across all 19 changed/new files (10 new), including this report; clean `git diff --check`. |
| Footprint | C: 287.8 GB free at checkpoint, 286.9 GB at wrap-up; no task payload above 5 GB. |

Eight skips are Chrome rows: old normal/empty mount, four existing resource rows and two new substitution rows. One skip is the optional private reference raster oracle. Skips are not passes. After the interrupted attempt, Chrome discovery was explicitly disabled process-locally for CPU gates. The memory guard's kill-on-close job bounded its children; recorded Bun owner PID 70864 has ended. No maintained port, game or MO2 was touched.

## Coordinator browser and GPU gates

From `projects/xf-studio/authoring/`, with Chrome available and any local missing-Chrome override cleared, run sequentially:

```powershell
$env:XFS_REQUIRE_ORACLES = '1'
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 4 -- bun test tests/core-substitution-browser.test.ts tests/core-startup-browser.test.ts
& "$env:LOCALAPPDATA/Python/pythoncore-3.14-64/python.exe" ../../../tools/memory_guard.py --limit 7 -- bun test tests/core-startup-resources.test.ts
```

The existing resource file has its own 7 GB coordinator step, per the accepted 13c3 coordination row. The new asset-free rows need no game settings. `XFS_REQUIRE_ORACLES=1` makes a missing browser fail through the existing oracle policy. All servers use an ephemeral port and disposable data; printed output supplies each concrete URL:

- `http://127.0.0.1:<port>/?verify=1&composition=empty`
- `http://127.0.0.1:<port>/?verify=1&composition=synthetic`
- `http://127.0.0.1:<port>/?verify=1&composition=normal`

The synthetic URL works **inside the test's CDP entry interception only**. The test bundles the test composition and replaces `/build/studio-main.js` before navigation; all HTML/host/root/shell machinery is real. Production selection intentionally has no synthetic route. The empty/normal URLs work on any disposable real host.

The new gate requires decoded shell pixels and visible controls (including the transparent-shell negative control), positive panel dimensions and first-contentful paint; no makeup worker/preparation request, mask/package operation or readiness label; synthetic edit 1→2 and Undo 2→1; registered export capability and exact restored file bytes/name; no console errors; and exact pre-load resource counts after abort in the retained page. File testing captures the real Blob/name at the browser download adapter and suppresses the native anchor download; native download UI is not claimed.

By hand, compare the **normal status bar** against `6cfdbb86` in light/dark, narrow/wide layouts, head absent/ready and texture ready/updating/error. Check text, tooltip precedence, spacing and no normal badge disappearance. In empty verification, check the vacant readiness slot, shell layout and disposal. Keep normal restored-workspace, differently bound/same-look panels, A/B/A, edits/Undo/Redo/file/export compatibility in the coordinator's usual acceptance flow; no new game session is required.

Run the coordinator's standard WebGL set and heavy gates from its shell, one process at a time. The directly affected rows are shell/status layout and startup mount/paint/disposal. Existing scene-host/render parity, renderer-device disposal/context restoration and raster/worker release remain regression checks; shaders, GPU resource algorithms, asset preparation implementation, bound panel/capture release and geometry are unchanged. Independent UI review and the four normal status captures remain coordinator-owned.

## Footprint and cleanup

No task scratch was created under the worktree; no output above 5 GB is retained. The interrupted existing CDP harness created two temporary folders outside it. Automatic approval review rejected their cleanup command before execution as **“blocked by policy”**; no alternate deletion was attempted:

- `$env:TEMP/xfs-ui-chrome-Hxvk5l`: 6,906,649 bytes, zero reparse points.
- `$env:TEMP/xfs-ui-data-S9YGbF`: 468,548 bytes, zero reparse points.

Both markers name the ended test owner 70864. They hold no unique evidence; please remove them. All completed test/guard processes ended; the interrupted guard terminated its job. Final checks found no repository link, source-path, privacy or whitespace issue; C has 286.9 GB free. The remaining two folders total 7,375,197 bytes; no unique evidence or task output above 5 GB is retained.

**Knowledge used:** [knowledge index](../../knowledge/README.md), [WebGL ownership/program linking](../../knowledge/webgl-program-linking.md) (updated with source/CPU evidence and coordinator-reported 13c3 acceptance); CORE-03 plan/as-built reports and retained ledger; architecture contract, UI boundary, view-graph design, developer orientation, project READMEs/status/backlog. The old current proof table and WebGL release paragraph were incomplete after 13c3 acceptance and are corrected; no engine fact was contradicted.
