# CORE-03 slice 12 report

The scoped slice is implemented in the `core-03` worktree on `claude/core-03`, starting from `e5bc2c61`. Changes are uncommitted. CORE-03 stays **High**.

The coordinator authorised retaining still-consumed legacy recipe/planner/branding/descriptors, explicit released-format library/migration adapters and the one view projection. It required every allowance to shrink or stay unchanged, an exact consumer/removal ledger, and untouched guide specimen imports. That decision is recorded in the [as-built note](core-03-plan.md#slice-12-as-built-28-october-2026) and [UI boundary](ui-architecture-boundary.md#open-work).

## Inventory outcome

| Brief item | Result / home |
|---|---|
| Recipe/planner placement and registered `eyeMakeupCollection` planning | Retained by coordinator decision: `src/legacy/eye-makeup/recipe-schema.ts` and `export/preset-collection.ts`, still behind the registered `app/authoring/makeup-files.ts` file/export contribution. Released library/migration adapters remain explicit. |
| Branding/framework/install defaults | The feature contributes `src/features/eye-makeup/product.ts` through optional `FeatureModule.product`; `src/platform/api/product.ts` defines neutral data/helper contracts. Composition injects `STUDIO_PRODUCT` into both hosts, diagnostics, setup/presentation and diagnostic commands. Framework minimums and store text move out of shared installation policy into the retained compatibility branding data source. |
| Borrowed generic helpers | Descriptor builders: `src/platform/api/action-descriptor-kit.ts`; recursive canonical JSON: `src/platform/api/canonical-json.ts`; SHA-256: `src/formats/content-hash.ts`; depot regex: `src/game/depot-path-regex.ts`. Original definitions are removed. |
| Independent aliases | Delete `legacy/eye-makeup/history-labels.ts` and `eye-makeup-model.ts` under `src/`; use the existing `src/engines/layered-makeup/` owners. |
| Borrowed head/default placement | The plate recipe's head/source data and saved head-choice defaults remain shared by `src/preview/preview-core-recipe.ts`, preparation and setup. Criterion S in the consumer ledger requires one neutral metadata source plus registered prerequisite ports, preserving existing recipe/cache/settings identities. |
| Geometry/view projection | Retain exactly one `makeup-view.ts` / `makeup-document.ts`, `AuthoringGeometry`, `AuthoringPresentation` bundle. [The ledger](core-03-s12-remaining-consumers.md) lists all 77 retained direct legacy consumers plus exact projection consumers, reasons, owners and removal criteria. No second cache or registry. |

No saved schema/ID/key, SQLite migration, portable format, package identity/manifest, protected panel/history API, P3-v catalogue, component or guide source changes. The generated style guide changes and is left changed as required. The pipeline contract/diagrams are unchanged because no pipeline behavior or named source path changes.

## Allowances before and after

Paths below have prefix `legacy/eye-makeup/`.

| List | Before | After |
|---|---|---|
| Feature core | `recipe-schema`, `history-labels`, `eye-makeup-model`, `mod-branding`, `eye-makeup-descriptors` (5) | `recipe-schema`, `mod-branding`, `eye-makeup-descriptors` (3) |
| Exporter | `recipe-schema`, `export/package-filter`, `export/package-resources`, `export/host/package-resource-builder`, `export/host/package-build-wolvenkit`, `export/package-action`, `export/preset-collection`, `export/archive-inventory`, `plate/host/eye-plate-service`, `export/host/plate-uv-footprint-io`, `export/plate-reach` (11) | Same 11 entries |
| Presentation pure branding/hint values | `mod-branding`: `EYE_MAKEUP_MOD`, `MOD_NAME_HINT` | Unchanged |
| Other import/scene lists and patterns | Existing strict lists | Unchanged; no new entry/pattern/exception |

## Gate results

All heavy commands used the full-path Python memory guard with a 4 GB limit, sequentially. Chrome was marked unavailable process-locally. No skip is counted as a pass.

| Gate | Final result | Peak |
|---|---|---|
| Authoring check | Pass, including after the fixture correction | 1.7 GB |
| Focused boundary/bootstrap/view/framework/install | 171 pass, 0 fail; 13 files; 1,681 assertions; 2 snapshots | 0.5 GB |
| Library/migration/workspace/portable/collection/package/install compatibility | 438 pass, 0 fail; 49 files; 5,004 assertions; 4 snapshots | 1.7 GB |
| Final new parity/product/boundary | 47 pass, 0 fail; 3 files; 484 assertions; 2 snapshots | 0.3 GB |
| Additional file/preview/viewport/setup | 51 pass, 2 optional skips; two initial new-fixture assertions corrected, then all 5 new parity/product tests pass | 0.6 GB |
| Style-guide build / tests | Pass; generated HTML changed / 10 pass, 0 fail, 65 assertions | 0.0 GB |
| Desktop check / tests | Pass / 133 pass, 11 skip, 0 fail; 20 files; 910 assertions | 1.0 / 0.6 GB |
| 038 quick harness | 11 pass, 0 fail; 4 files; 46 assertions; 125.38 s | 1.7 GB |
| Browser build | All 5 entries pass, output confined to task scratch | 0.0 GB |
| Five batched suite partitions | 4,523 pass, 185 skip, 0 fail across 530 tracked files; only the corrected fifth partition repeated | 2.1 GB max |
| Links / private paths / whitespace | 0 tracked link/source findings across 498 Markdown files; 0 tracked privacy findings; 12 new files have 0 privacy, whitespace or link/source findings; `git diff --check` clean | — |
| Fresh-process last latency gate | 1 pass, 0 fail, 5 assertions; CPU 30.2%; edit/drag/store p95 1.30/0.64/0.39 ms against unchanged 4 ms budgets | 0.4 GB |

Inno Setup install-outcome skips, listed separately: (1) installed-facts/closing-error success classification; (2) exit codes/headings/next steps; (3) output phases/closing-error names; (4) installed-build/uninstall-entry identity; (5) Store-private versus real AppData. The sixth physical-path case also skips. The remaining five desktop skips are optional native/packaging/installed-refresh oracles.

The original fifth batch found 33 failures: the replacement-port key assertion needed its intentionally added `product` field, and the DOM harness's manually assembled port lacked that field. The shared production-style presentation fixture and DOM double now explicitly supply `STUDIO_PRODUCT`; the exact port-key assertion includes the additive data field. No production code or behavioral assertion changed for this correction. Both affected files pass **58 tests / 494 assertions**, peak 0.4 GB, and the authoring check passes again. Only the affected fifth partition is repeated; batches 1–4 remain valid.

The new test files are untracked, so the coordinator's `git ls-files` batching script does not enumerate them. Their 5 tests run separately in the final targeted gate; suite-union totals must add them exactly once.

Final partitions, pass/fail/skip: **975/0/17, 922/0/18, 945/0/13, 960/0/3, 721/0/134**. Peaks: **1.1/2.1/1.9/1.6/1.4 GB**. No floor or limit kill occurred. The unique executed authoring union is **4,528 pass, 185 skip, 0 fail across 532 files**, including the two new files; the final standalone latency observation repeats its already enumerated test and is reported separately.

## Parity and compatibility evidence

| Frozen snapshot | SHA-256 | Coverage |
|---|---|---|
| New `core-placement-parity.test.ts.snap`, captured from `e5bc2c61` before production edits | `27bb854c975e26d588d5cf6c3e92acea3b11ab3bd0a42ac25a024ca6058baa1d` | Product/current/legacy/predecessor identities; framework specimen states, minimum aggregation, exact verdict/store wording; diagnostic placement/modlist; canonical JSON/hash/undefined edge cases and depot regex escaping |
| Existing `core-file-export-parity.test.ts.snap` | `91776acef45b7c0cf506c7e213c6bb3c1585727f41442a0fb3532d8f5612a795` | Portable recipe bytes/names/outcomes/refusals; collection bytes/compiler plan/Check/Build requests and partial omissions |
| Existing `core-preview-parity.test.ts.snap` | `9f511a4a541a265fb32fe79d0d321091f6a425b150e9c6ecc0a696f279c9b08d` | Prepared files/manifest/cache identities; plain/directional/mottled worker pixels; preview publication, warm holds and supersession |
| Existing `core-viewport-parity.test.ts.snap` | `4218497cc20c45418ec064011858c7dc7ba98acb9c1469c33813f031a973aa61` | Bound UV navigation/selection, independent gestures and disposal; surface wiring baseline is also exercised |

No expected snapshot was regenerated from refactored production. Existing released-library/migration/workspace/portable/package tests retain their assertions; product-dependent fixtures now explicitly inject the same registered data. Synthetic tests prove alternate framework defaults/store text/legacy manifest identity, with empty compositions inheriting no makeup requirement. The optional private six-raster input is absent here and skips; no new GPU result is claimed.

The raw new baseline hash was `8372e143c299a904367f8109bc8574abc201a6c68931ff2fe032aa9f4dbf5dc0`. Its multiline modlist string had formatter-only trailing whitespace. The captured string was losslessly converted into lines (the final empty line included), yielding the normalized hash above; no output was recaptured from the refactor. The normalized parity/product gate passes 5 tests, two snapshots and 13 assertions.

## Remaining work and browser/GPU handoff

Slice 13 owes real zero-feature mount/paint/dispose in isolated `?verify=1` and synthetic layered-editor substitution without edits outside feature/composition. The retained consumer/projection ledger must be resolved or explicitly accounted for before closing CORE-03. The UI track owns the two guide specimen imports. Independent code/UI review remains with the coordinator.

Run the standard WebGL set, especially scene-host/preparation/cache/render parity, raster output, release/context restoration; both dock-strip geometry tests, tree-view geometry and layout-tabs timing. Compare Mod package default names/help, Settings framework help/verdicts, unsupported-store guidance and WolvenKit consent at light/dark and narrow/wide sizes. Exercise current/legacy restore, recipe/collection import/export/plan/Check/Build, differently bound looks and same-look sharing, A/B/A, gesture object identity and scoped Undo/Redo. Confirm saved identifiers, panel/history IDs and warm cache reuse. Installation/legacy-folder/predecessor/receipt recognition checks belong in disposable coordinator fixtures. No game test is needed.

## Footprint and cleanup

Checkpoint: 225.7 GB free on C; wrap-up: 223.0 GB free. No task payload exceeds 5 GB. All owned guarded test/build processes have ended. No ports, game, frameworks or real mod-manager setup were touched; no subagents were started.

Automatic approval review rejected the verified-target PowerShell scratch deletion as **“blocked by policy”** before the command ran. No alternate deletion or approval escalation was attempted. A subsequent read-only inventory confirms **31,673,493 bytes, zero junctions/reparse points**, retained for coordinator cleanup:

- `local/core-03-s12/` (44 entries: scripts, gate logs and regenerable browser-build output).
- `local/core-03-s12-profile-spikes.log`.
- Under `projects/xf-studio/authoring/local/`: `core-03-s12-additional.log`, `core-03-s12-check-final.log`, `core-03-s12-check.log`, `core-03-s12-compatibility.log`, `core-03-s12-desktop-check.log`, `core-03-s12-desktop-tests.log`, `core-03-s12-final-targeted.log`, `core-03-s12-normalized-parity.log`, `core-03-s12-targeted.log`, `core-03-s12-targeted2.log`, `core-03-s12-ui-correction.log`, `core-03-s12-ui-repro.log`.

All unique parity evidence and gate accounting are in tracked candidates or this report. The retained scratch contains no game assets or private reference input.

## Changed files

Exact repository-relative inventory (100 files; includes deleted/moved sources and this report):

- [knowledge/mod-loading.md](../../knowledge/mod-loading.md)
- [projects/xf-studio/authoring/desktop/server.ts](../../projects/xf-studio/authoring/desktop/server.ts)
- [projects/xf-studio/authoring/public/style-guide.html](../../projects/xf-studio/authoring/public/style-guide.html)
- [projects/xf-studio/authoring/server.ts](../../projects/xf-studio/authoring/server.ts)
- `projects/xf-studio/authoring/src/app/action-descriptor-kit.ts` (deleted; callers now use the existing engine owner or the moved neutral helper). <!-- historical-paths --><!-- /historical-paths -->
- [projects/xf-studio/authoring/src/app/authoring/makeup-application.ts](../../projects/xf-studio/authoring/src/app/authoring/makeup-application.ts)
- [projects/xf-studio/authoring/src/app/authoring/makeup-document.ts](../../projects/xf-studio/authoring/src/app/authoring/makeup-document.ts)
- [projects/xf-studio/authoring/src/app/studio-action-descriptors.ts](../../projects/xf-studio/authoring/src/app/studio-action-descriptors.ts)
- [projects/xf-studio/authoring/src/app/studio-application.ts](../../projects/xf-studio/authoring/src/app/studio-application.ts)
- [projects/xf-studio/authoring/src/app/studio-presentation.ts](../../projects/xf-studio/authoring/src/app/studio-presentation.ts)
- [projects/xf-studio/authoring/src/app/trusted-studio-bootstrap.ts](../../projects/xf-studio/authoring/src/app/trusted-studio-bootstrap.ts)
- [projects/xf-studio/authoring/src/character/choice-prefetch.ts](../../projects/xf-studio/authoring/src/character/choice-prefetch.ts)
- [projects/xf-studio/authoring/src/character/host/character-detail-host.ts](../../projects/xf-studio/authoring/src/character/host/character-detail-host.ts)
- [projects/xf-studio/authoring/src/character/host/choice-manifest.ts](../../projects/xf-studio/authoring/src/character/host/choice-manifest.ts)
- [projects/xf-studio/authoring/src/character/host/prepared-answers.ts](../../projects/xf-studio/authoring/src/character/host/prepared-answers.ts)
- [projects/xf-studio/authoring/src/compose/studio-registry.ts](../../projects/xf-studio/authoring/src/compose/studio-registry.ts)
- [projects/xf-studio/authoring/src/compose/studio-startup.ts](../../projects/xf-studio/authoring/src/compose/studio-startup.ts)
- [projects/xf-studio/authoring/src/diagnostics/host/host-report.ts](../../projects/xf-studio/authoring/src/diagnostics/host/host-report.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/core.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/core.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/index.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/index.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/limits.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/limits.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/product.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/product.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/view/actions.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/view/actions.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/view/commands.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/view/commands.ts)
- [projects/xf-studio/authoring/src/features/eye-makeup/view/layer-menu.ts](../../projects/xf-studio/authoring/src/features/eye-makeup/view/layer-menu.ts)
- [projects/xf-studio/authoring/src/formats/content-hash.ts](../../projects/xf-studio/authoring/src/formats/content-hash.ts)
- [projects/xf-studio/authoring/src/game/depot-path-regex.ts](../../projects/xf-studio/authoring/src/game/depot-path-regex.ts)
- [projects/xf-studio/authoring/src/game/host/game-asset-export-wolvenkit.ts](../../projects/xf-studio/authoring/src/game/host/game-asset-export-wolvenkit.ts)
- [projects/xf-studio/authoring/src/game/host/installation-registry.ts](../../projects/xf-studio/authoring/src/game/host/installation-registry.ts)
- [projects/xf-studio/authoring/src/game/host/installation-snapshot.ts](../../projects/xf-studio/authoring/src/game/host/installation-snapshot.ts)
- [projects/xf-studio/authoring/src/game/host/resolver-host.ts](../../projects/xf-studio/authoring/src/game/host/resolver-host.ts)
- [projects/xf-studio/authoring/src/installation/framework-catalogue.ts](../../projects/xf-studio/authoring/src/installation/framework-catalogue.ts)
- [projects/xf-studio/authoring/src/installation/framework-fixtures.ts](../../projects/xf-studio/authoring/src/installation/framework-fixtures.ts)
- [projects/xf-studio/authoring/src/installation/framework-status.ts](../../projects/xf-studio/authoring/src/installation/framework-status.ts)
- [projects/xf-studio/authoring/src/installation/framework-versions.ts](../../projects/xf-studio/authoring/src/installation/framework-versions.ts)
- [projects/xf-studio/authoring/src/installation/host/install-detection-server.ts](../../projects/xf-studio/authoring/src/installation/host/install-detection-server.ts)
- [projects/xf-studio/authoring/src/installation/host/mod-install-host.ts](../../projects/xf-studio/authoring/src/installation/host/mod-install-host.ts)
- [projects/xf-studio/authoring/src/installation/host/mod-install-transport.ts](../../projects/xf-studio/authoring/src/installation/host/mod-install-transport.ts)
- [projects/xf-studio/authoring/src/installation/host/runtime-diagnostic-promotion.ts](../../projects/xf-studio/authoring/src/installation/host/runtime-diagnostic-promotion.ts)
- [projects/xf-studio/authoring/src/installation/host/runtime-diagnostic-stage.ts](../../projects/xf-studio/authoring/src/installation/host/runtime-diagnostic-stage.ts)
- [projects/xf-studio/authoring/src/installation/install-detection.ts](../../projects/xf-studio/authoring/src/installation/install-detection.ts)
- [projects/xf-studio/authoring/src/legacy/eye-makeup/eye-makeup-descriptors.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/eye-makeup-descriptors.ts)
- `projects/xf-studio/authoring/src/legacy/eye-makeup/eye-makeup-model.ts` (deleted; callers now use the existing engine owner or the moved neutral helper). <!-- historical-paths --><!-- /historical-paths -->
- `projects/xf-studio/authoring/src/legacy/eye-makeup/history-labels.ts` (deleted; callers now use the existing engine owner or the moved neutral helper). <!-- historical-paths --><!-- /historical-paths -->
- [projects/xf-studio/authoring/src/legacy/eye-makeup/mod-branding.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/mod-branding.ts)
- [projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-recipe.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-recipe.ts)
- [projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-verify.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/eye-plate-verify.ts)
- [projects/xf-studio/authoring/src/legacy/eye-makeup/plate/host/eye-plate-service.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/host/eye-plate-service.ts)
- [projects/xf-studio/authoring/src/legacy/eye-makeup/plate/host/eye-plate-wolvenkit.ts](../../projects/xf-studio/authoring/src/legacy/eye-makeup/plate/host/eye-plate-wolvenkit.ts)
- [projects/xf-studio/authoring/src/platform/api/action-descriptor-kit.ts](../../projects/xf-studio/authoring/src/platform/api/action-descriptor-kit.ts)
- [projects/xf-studio/authoring/src/platform/api/canonical-json.ts](../../projects/xf-studio/authoring/src/platform/api/canonical-json.ts)
- [projects/xf-studio/authoring/src/platform/api/feature.ts](../../projects/xf-studio/authoring/src/platform/api/feature.ts)
- [projects/xf-studio/authoring/src/platform/api/product.ts](../../projects/xf-studio/authoring/src/platform/api/product.ts)
- [projects/xf-studio/authoring/src/preview/host/preview-core-service.ts](../../projects/xf-studio/authoring/src/preview/host/preview-core-service.ts)
- [projects/xf-studio/authoring/src/preview/preview-core-recipe.ts](../../projects/xf-studio/authoring/src/preview/preview-core-recipe.ts)
- [projects/xf-studio/authoring/src/preview/preview-setup.ts](../../projects/xf-studio/authoring/src/preview/preview-setup.ts)
- [projects/xf-studio/authoring/src/setup/wolvenkit-setup.ts](../../projects/xf-studio/authoring/src/setup/wolvenkit-setup.ts)
- [projects/xf-studio/authoring/src/studio-ui/panels/collection.ts](../../projects/xf-studio/authoring/src/studio-ui/panels/collection.ts)
- [projects/xf-studio/authoring/src/studio-ui/panels/framework-group.ts](../../projects/xf-studio/authoring/src/studio-ui/panels/framework-group.ts)
- [projects/xf-studio/authoring/tests/__snapshots__/core-placement-parity.test.ts.snap](../../projects/xf-studio/authoring/tests/__snapshots__/core-placement-parity.test.ts.snap)
- [projects/xf-studio/authoring/tests/architecture-import-boundary.test.ts](../../projects/xf-studio/authoring/tests/architecture-import-boundary.test.ts)
- [projects/xf-studio/authoring/tests/core-placement-parity.test.ts](../../projects/xf-studio/authoring/tests/core-placement-parity.test.ts)
- [projects/xf-studio/authoring/tests/core-product-defaults.test.ts](../../projects/xf-studio/authoring/tests/core-product-defaults.test.ts)
- [projects/xf-studio/authoring/tests/eye-plate.test.ts](../../projects/xf-studio/authoring/tests/eye-plate.test.ts)
- [projects/xf-studio/authoring/tests/feature-view-context.test.ts](../../projects/xf-studio/authoring/tests/feature-view-context.test.ts)
- [projects/xf-studio/authoring/tests/finish-actions.test.ts](../../projects/xf-studio/authoring/tests/finish-actions.test.ts)
- [projects/xf-studio/authoring/tests/fixtures/product-defaults.ts](../../projects/xf-studio/authoring/tests/fixtures/product-defaults.ts)
- [projects/xf-studio/authoring/tests/framework-status.test.ts](../../projects/xf-studio/authoring/tests/framework-status.test.ts)
- [projects/xf-studio/authoring/tests/framework-versions.test.ts](../../projects/xf-studio/authoring/tests/framework-versions.test.ts)
- [projects/xf-studio/authoring/tests/install-detection-actions.test.ts](../../projects/xf-studio/authoring/tests/install-detection-actions.test.ts)
- [projects/xf-studio/authoring/tests/install-detection.test.ts](../../projects/xf-studio/authoring/tests/install-detection.test.ts)
- [projects/xf-studio/authoring/tests/mo2-configured-folders.test.ts](../../projects/xf-studio/authoring/tests/mo2-configured-folders.test.ts)
- [projects/xf-studio/authoring/tests/mo2-modlist-rows.test.ts](../../projects/xf-studio/authoring/tests/mo2-modlist-rows.test.ts)
- [projects/xf-studio/authoring/tests/mod-branding.test.ts](../../projects/xf-studio/authoring/tests/mod-branding.test.ts)
- [projects/xf-studio/authoring/tests/mod-install-host.test.ts](../../projects/xf-studio/authoring/tests/mod-install-host.test.ts)
- [projects/xf-studio/authoring/tests/mod-install-transport.test.ts](../../projects/xf-studio/authoring/tests/mod-install-transport.test.ts)
- [projects/xf-studio/authoring/tests/mottle-actions.test.ts](../../projects/xf-studio/authoring/tests/mottle-actions.test.ts)
- [projects/xf-studio/authoring/tests/native-reader-oracle.test.ts](../../projects/xf-studio/authoring/tests/native-reader-oracle.test.ts)
- [projects/xf-studio/authoring/tests/preview-core-fixture.ts](../../projects/xf-studio/authoring/tests/preview-core-fixture.ts)
- [projects/xf-studio/authoring/tests/preview-setup.test.ts](../../projects/xf-studio/authoring/tests/preview-setup.test.ts)
- [projects/xf-studio/authoring/tests/registered-editing.test.ts](../../projects/xf-studio/authoring/tests/registered-editing.test.ts)
- [projects/xf-studio/authoring/tests/runtime-diagnostic-promotion.test.ts](../../projects/xf-studio/authoring/tests/runtime-diagnostic-promotion.test.ts)
- [projects/xf-studio/authoring/tests/runtime-diagnostic-stage.test.ts](../../projects/xf-studio/authoring/tests/runtime-diagnostic-stage.test.ts)
- [projects/xf-studio/authoring/tests/studio-presentation-fixture.ts](../../projects/xf-studio/authoring/tests/studio-presentation-fixture.ts)
- [projects/xf-studio/authoring/tests/studio-presentation.test.ts](../../projects/xf-studio/authoring/tests/studio-presentation.test.ts)
- [projects/xf-studio/authoring/tests/ui-polish-dom.test.ts](../../projects/xf-studio/authoring/tests/ui-polish-dom.test.ts)
- [projects/xf-studio/authoring/tests/wolvenkit-setup.test.ts](../../projects/xf-studio/authoring/tests/wolvenkit-setup.test.ts)
- [projects/xf-studio/authoring/tests/wolvenkit-uncook-oracle.test.ts](../../projects/xf-studio/authoring/tests/wolvenkit-uncook-oracle.test.ts)
- [projects/xf-studio/authoring/tools/framework-check.ts](../../projects/xf-studio/authoring/tools/framework-check.ts)
- [projects/xf-studio/authoring/tools/native-texture-oracle.ts](../../projects/xf-studio/authoring/tools/native-texture-oracle.ts)
- [projects/xf-studio/authoring/tools/runtime-diagnostic-promotion.ts](../../projects/xf-studio/authoring/tools/runtime-diagnostic-promotion.ts)
- [projects/xf-studio/authoring/tools/runtime-diagnostic.ts](../../projects/xf-studio/authoring/tools/runtime-diagnostic.ts)
- [projects/xf-studio/authoring/tools/setup-wolvenkit.ts](../../projects/xf-studio/authoring/tools/setup-wolvenkit.ts)
- [research/authoring/code-health.md](../../research/authoring/code-health.md)
- [research/authoring/core-03-plan.md](../../research/authoring/core-03-plan.md)
- [research/authoring/core-03-s12-remaining-consumers.md](../../research/authoring/core-03-s12-remaining-consumers.md)
- [research/authoring/core-03-s12-report.md](../../research/authoring/core-03-s12-report.md)
- [research/authoring/feature-module-platform.md](../../research/authoring/feature-module-platform.md)
- [research/authoring/ui-architecture-boundary.md](../../research/authoring/ui-architecture-boundary.md)
- [research/backlog/README.md](../../research/backlog/README.md)

**Knowledge used:** [knowledge index](../../knowledge/README.md), [character-customisation file chain](../../knowledge/cc-file-chain.md), [mod loading](../../knowledge/mod-loading.md) (updated with offline parity); CORE-03 plan/as-built notes, architecture/UI boundary, editor invariants, naming, Studio-to-mod pipeline and developer orientation. No page was contradicted and no new game/runtime finding was observed.
