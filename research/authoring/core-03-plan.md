# CORE-03: a feature-neutral editor, assessment and plan

[Code-health row CORE-03](code-health.md) (High) says the application, presentation shell and preview/editor adapters still need eye makeup's concrete document and facade. So a shell-only composition, or a second layered editor, needs changes outside the composition and feature folders. This page records where that coupling stands at main `d343c523` (27 October 2026, after profiles phase 3's service halves), and the plan to close it. Its open-work list sits beside the [UI architecture boundary](ui-architecture-boundary.md#open-work).

## Where it stands

**A composition without eye makeup does not mount.** In-memory constructor probes (no browser, nothing written) fail in startup order:

| Entry | Result |
|---|---|
| Cold workspace load, empty feature registry | Resolved in slice 3: a writable sparse workspace loads without a recipe; the original `liveStarter()` dereference is gone |
| Preseeded workspace → trusted editing services | `createAuthoringEditing()` requires the unregistered live feature with gestures (`app/trusted-authoring-core.ts`); this probe stops before the application's separate handler gate |
| Application with eye makeup unregistered | registered owners don't match handlers: the extra handler is `"eye-makeup"` (`app/studio-application.ts`) |
| Shell runtime with no makeup facade | `finishCatalogue()` on an absent facade (`studio-ui/runtime.ts`) |

`view-contributions.test.ts` proves only that a shell-only *layout* can be derived; the trusted-bootstrap test still composes eye makeup.

**What phase 3 changed.** P3-ii put the concrete makeup machinery behind keyed look-edit contexts, shared per-look history and captured operations. P3-iii gave each bound UV panel its own adapter (the unused singleton hooks remain). P3-iv, P3-vi and P3-vii added generic binding candidates, recovery facts and history-scope projections. These are good seams for this work, but they multiplied correctly scoped consumers of the same concrete editor rather than removing it. The import-boundary test's five feature-core and eleven exporter legacy allowances are unchanged.

**Remaining couplings, by responsibility** (paths under `projects/xf-studio/authoring/src/`):

- **Look state:**
  - Workspace and collection drafts now hold registered parts/editor memory and shared history (slice 3). `makeup-workspace.ts` keeps the concrete editor's compatibility projection; UV/view preferences remain for their later slices.
  - `library/look-editor.ts` now reads/writes neutral document state, and `collection-application.ts` reads registered live parts. `makeup-look-editor.ts` adapts existing keyed construction until slice 4; `library/look-edit-contexts.ts`, `app/profiles/profile-authoring.ts` and `panel-editing-contexts.ts` still construct the concrete editing bundle.
  - `app/authoring/authoring-document.ts` now owns feature-neutral look state/history (slice 2). The transitional `makeup-document.ts` adapter, geometry, presentation, gestures and control edits still hold makeup types; their registered construction follows in slice 4.
- **Application and facade:**
  - `app/studio-application.ts`, `studio-context-targets.ts`, `studio-action-descriptors.ts`: an unconditional `"eye-makeup"` handler, target checks, catalogues and gestures.
  - `app/studio-presentation.ts`: the makeup facade is built in an ID branch.
- **Shell:**
  - `studio-ui/runtime.ts`, `input-hints.ts` and `target-menus.ts`: recipe and selection reads, menu labels, and toast Undo by geometry revision.
  - `studio-ui/guidance/*`: tours, help and anchors.
- **Viewport and input:** `app/viewport-attachment.ts`, `app/input-bindings.ts` and `studio-ui/views/feature-view.ts`: the concrete UV slot and makeup pointer targets.
- **Preview:**
  - `preview/browser/{panel-uv,browser-viewport-device,scene-editors,browser-head-attachment}.ts`, `preview/preview-core-*`, and the preview-core service and settings: legacy editors, and a head preparation that is also an eye-plate preparation.
  - The preview device is already region-injected and takes a `PreviewLayerSource`, which is reusable groundwork.
- **Files and export:** `app/{trusted-studio-bootstrap,studio-file-operations,accepted-studio-operation}.ts` and `app/browser/browser-file-device.ts`: portable recipe parsing, export and mask baking.
- **Legacy placement and product defaults** (not editor blockers):
  - collection planning through `eyeMakeupCollection`;
  - library store and migrations on concrete recipes, where released formats keep explicit adapters;
  - branding and framework defaults;
  - install recognition of makeup identities, which becomes product-provided compatibility data;
  - generic helpers (`canonicalJson`, `depotPathRegex`) borrowed from eye-plate modules.

## Plan

Thirteen slices of about 0.5–1 agent-day each, in dependency order. They reuse `PartRegistry`, `LiveFeatures`, `HistoryService` and the existing registration machinery; there are no parallel registries. Each slice re-runs the failure probes and passes its own zero-feature construction gate. None claims shell mounting until slice 13's positive test passes; a placeholder makeup facade never counts as proof.

| # | Slice | Main files | Gates | Risk to phase 3's remaining UI |
|---|---|---|---|---|
| 1 | Editor boundary and proof fixture | `platform/api/feature.ts`, editor API types, asset-free composition fixtures | today's failures captured; zero-feature and synthetic-editor cases specified | low |
| 2 | Look state and history apart from makeup state | `app/authoring/authoring-document.ts`, `platform/core/live-features.ts`, a makeup document adapter | part/history parity, cross-part Undo/Redo, no-feature document | medium (P3-vii scope identity) |
| 3 | No mandatory live-recipe workspace projection | `workspace-state.ts`, `collection-workspace.ts`, `look-editor.ts`, `collection-application.ts` | empty-registry cold load; workspace, collection and SQLite compatibility | medium (binding identities) |
| 4 | Editor construction registered per feature | `trusted-authoring-core.ts`, `look-edit-contexts.ts`, `profile-authoring.ts` | zero-feature editing services (without constructing the application); synthetic editor; sharing, dirty retention, release | medium |
| 5 | No special application or facade routing | `studio-application.ts`, `studio-presentation.ts`, `studio-action-descriptors.ts` | registry/handler equality without makeup; descriptor parity | **highest** (shared files) |
| 6 | Gestures and controls owned by the feature | `authoring-gestures.ts`, `authoring-control-edits.ts` | one Undo per gesture, Escape, stale-point refusal, A/B/A captures | medium |
| 7 | Context options contributed; no shell recipe reads | `studio-context-targets.ts`, `target-menus.ts`, `runtime.ts`, `input-hints.ts` | option parity; toast Undo by captured look history | medium (P3-v) |
| 8 | Guidance and help contributed | `studio-ui/guidance/*` | zero-feature guidance; anchors withdraw | low (UI review) |
| 9 | Flat and surface editor adapters registered | `viewport-attachment.ts`, `input-bindings.ts`, `preview/browser/{panel-uv,browser-viewport-device,scene-editors}.ts` | two independently bound editors; no fabricated UV slot | medium to high (P3-v) |
| 10 | Preview and raster capabilities registered | makeup preview modules, `browser-head-attachment.ts` | no makeup raster or worker without registration; raster reuse, cancellation and warm gates | high (renderer) |
| 11 | File and export projections and product metadata | bootstrap, file operations, accepted operations, browser file device, export bridge | operation matrix and freshness unchanged; Check/Build parity | medium (P3-v) |
| 12 | Legacy and scene placement exceptions reduced | `legacy/eye-makeup/*` moves, generic helpers | allowance lists shrink without wider patterns | low |
| 13 | Integrated mount and substitution proof | bootstrap and browser boundary tests, records | **a real shell without eye makeup mounts, paints and disposes** in `?verify=1`; a synthetic layered editor added with no edits outside feature/composition | integration gate |

**Estimate:** 10–14 agent-days to close, including validation and expected review fixes. Removing the whole five-subsystem scene exception is extra and not required.

**Sequencing.** Keep P3-iv's `panels.bindings` and `panels.setBinding`, P3-v's contribution and instance catalogue, and P3-vii's `authoring.historyScopes()` and `history.selectScope` stable throughout. Run the edits to `studio-application.ts`, `studio-presentation.ts`, the runtime, the menus and the palette one at a time, not alongside phase 3's presentation work. Slices 1–4 touch none of phase 3's presentation files and can start once phase 3 lands.

## Slice 1 as built (27 October 2026)

**Boundary and fixtures complete; CORE-03 remains High.** This slice changes no startup behavior and fixes none of the four failures. The production addition is the optional `FeatureModule.createEditor` factory, also visible through `AnyFeatureModule` and the existing `PartRegistry.feature()` lookup. Its public types live in `src/platform/api/editor.ts`:

- `FeatureEditorHost.look` fixes the collection/look destination for the editor's lifetime; `scope` names its existing shared `HistoryService` scope. Editors neither create nor close a second history.
- `snapshot()` supplies only that feature's detached part and editor memory (`FeatureEditorState`). The optional part preserves a sparse look; the codecs and authoritative state stay with the existing `PartRegistry` and `LiveFeatures` owners. Actions still use the registered action table.
- `subscribe()` announces edits, restores and selection changes until the host signal aborts. The look-context owner aborts `signal` before releasing state/history; the feature clears its own projection and refuses further reads. No parallel disposal or editor registry is introduced.
- `FeatureEditor<S>.snapshot()` returns the feature's detached, read-only plain-data projection. Core construction carries it opaquely; only feature code interprets `S`. There are no gesture, renderer, facade or export hooks ahead of their slices.

The asset-free [composition fixture](../../projects/xf-studio/authoring/tests/fixtures/editor-composition.ts) supplies an empty composition, a synthetic two-layer feature with its own codec, selection memory, registered value action and editor factory, and sparse collection seeds. It imports no makeup, renderer, browser, host or game assets. The [boundary tests](../../projects/xf-studio/authoring/tests/core-editor-boundary.test.ts) exercise the factory directly through `PartRegistry`, backed by `LiveFeatures` and the real `HistoryService`: absent-part projection, action/Undo/Redo observation, detached snapshots, abort cleanup and scope ownership. This fixture wiring is not a feature-neutral production core or shell-mount proof.

The [four failure probes](../../projects/xf-studio/authoring/tests/core-editor-failures.test.ts) assert the missing owner at the failing call. The workspace and shell probes observe the absent-feature lookup and assert `TypeError`, without matching Bun's generated message. The slice-4 probe calls `createAuthoringEditing()` with an injected history service, independently of slice 5's application-handler gate. Each fixing slice changes its expected failure to `null` in one line and supplies its positive gate:

| Probe | Slice expected to flip it |
|---|---|
| Empty-registry cold workspace: absent live feature's `part` | 3 |
| Preseeded workspace into editing services: unregistered live feature with gestures | 4 |
| Application without eye makeup: extra `eye-makeup` handler | 5 |
| Runtime without makeup facade: absent `finishCatalogue` | 7 |

Eleven named pending tests specify slices 2–4: no-feature document/restore, cross-part and absent-part Undo/Redo, makeup adapter parity (2); cold empty workspace, zero/synthetic workspace and SQLite round trips, released-format compatibility (3); no-feature construction, registered synthetic construction, same-look sharing versus separate-look isolation, requester release/abort and dirty retention/retry (4). Slice 13 still owns real mount/paint/dispose proof.

**Validation:** guarded `bun run check` passes; the new tests plus architecture-import-boundary, trusted-studio-bootstrap and view-contributions pass (49 pass, 11 todo, 0 fail; 519 assertions). The five guarded suite batches cover 513 tracked test files: 991/911/856/954/688 pass and 16/18/13/3/134 skip respectively, totaling 4,400 pass, 0 fail, 184 skip (highest successful-batch peak 2.4 GB under the 4 GB guard). The two added test files run separately: 6 pass, 11 todo, 0 fail. Initially, batch 2 reached two 120-second Chrome dock-geometry hook timeouts. That run was stopped and resumed from batch 2 with a process-local unavailable `CHROME` path, retaining the same file partitions and turning unavailable browser probes into skips. No memory floor/limit kill occurred. Link and private-path checks pass. These are observed offline constructor/type results, with no browser/GPU evidence: the coordinator still runs the WebGL tests, both dock-strip geometry tests, tree-view geometry, layout-tabs timing and an existing-composition startup/paint/dispose smoke check in an isolated verification workspace. No phase-3 presentation file or protected binding/history API changed.

## Slice 2 as built (28 October 2026)

**Feature-neutral look state/history complete; CORE-03 remains High.** `src/app/authoring/authoring-document.ts` imports no makeup or engine module. Its state consists of registered features' parsed parts/editor memory and the existing `LookHistoryData`. `LiveFeatures` is the sole state owner for every feature, including makeup; the document opens one target in the injected `HistoryService`, publishes detached snapshots and closes the scope/subscriptions when its `AbortSignal` ends. Empty compositions construct, snapshot and restore without a recipe or fabricated makeup editor. Opening/restoring an unseen context preserves the current editing context, and same-scope restore keeps the existing scope identity while replacing its history and Redo.

`LiveFeatures` prepares every touched part and selection before committing a multi-part load/replay. Invalid input changes no part, editor, timeline or subscription result. Replay hooks and notifications publish from `HistoryTarget.settled`, after the parts, history and Redo validity have committed; missing parts stay missing. Publication uses the platform's `notifyAll` policy: all observers run, then the first observer error is rethrown outside the history rollback boundary. The optional adapter replay hooks provide a pure selection rule and a settled notification, without another history owner or registry.

Abort revokes the target as well as unregistering its scope: retained scopes refuse replay and live-part reads, and document subscriptions and mutation methods reject further calls. Cleanup is installed before initial part loading or history replacement can publish synchronously; construction checks for abort after each publication and unwinds rather than returning a released document. Scope-changing restore also checks after closing its old scope, so a listener's abort cannot register a replacement. Seven review regressions cover throwing document/feature observers and replay hooks, retained history after abort, abort during both construction publications, and abort while restoring to another scope.

The old concrete document is now the explicit transitional `src/app/authoring/makeup-document.ts` adapter. It holds no second recipe or history: it projects its registered `FeatureDocument` into the existing recipe/selection API, translates legacy whole-recipe histories and maintains geometry/effect notifications, surviving-layer selection and preview resets. The trusted editing constructor passes its existing registered module. Other production consumers change only their import to this adapter; fixtures that used implicit makeup defaults supply the real module through `tests/fixtures/makeup-document.ts`. Workspace projections, application handlers, editor factories and shell coupling remain for their planned slices. Neither `authoring.historyScopes()` nor `history.selectScope` changes, and no phase-3 presentation file or import allowance is changed.

The three slice-2 pending gates are active in [look-document.test.ts](../../projects/xf-studio/authoring/tests/look-document.test.ts), with five additional refusal/lifetime/publication gates: sparse zero-feature construction/restore, cross-part Undo/Redo/jumps and persisted restoration, cancellation without Redo, makeup selection/history parity, atomic invalid replay/load refusal, shared-service scope/selection isolation, aborted/unknown-state refusal, and in-place publication invalidating Redo. Eight pending cases remain for slices 3–4. All four captured startup failures remain, expected to flip in slices 3, 4, 5 and 7 respectively; slice 4's probe covers editing services alone, independently of the application gate.

**Validation after slice-2 review:** guarded type checks pass, and 190 focused tests across 25 files pass (8 todo, 0 fail; 1,556 assertions), including all 15 look-document tests, the five workspace/session history parity goldens, byte-identical stored forms, scoped History navigation, the architecture boundary, trusted bootstrap and view contributions. The seven new regressions cover all three review findings; before the fixes, the first six reproduced the broken replay/lifetime behavior. The adapter's `others` view still filters the same owner without another map and exports non-primary snapshots before copying its own recipe once. The unchanged 16-layer/80-step latency gate measured edit/drag/store p95 of 2.68/1.80/0.48 ms (4 ms budget, Bun under the 4 GB guard, one shared-machine observation).

The fresh review-fix five-batch run covers 516 tracked test files, including look-document: 982/926/871/957/685 pass, 16/18/13/3/134 skip, totaling **4,421 pass, 0 fail, 184 skip**, with the same 8 todo. Peak private memory was 1.1/2.3/2.6/1.6/1.3 GB under the 4 GB guard. No floor or limit kill occurred in this fix round, so no retry was needed. Link and private-path checks pass. Chrome is unavailable in this sandbox and was marked unavailable process-locally from the start, so browser/GPU checks remain with the coordinator: WebGL probes, dock/tree geometry, layout-tab timing and an isolated verification-workspace flow through edits, gesture commit/cancel, Undo/Redo, look switches and reload. No game test is needed for this extraction. Slice 3's implementation is recorded below.

## Slice 3 as built (28 October 2026)

**Workspace state no longer requires a live recipe; CORE-03 remains High.** `workspace-state.ts` loads and stores every registered feature's parsed part/editor memory, the look's `LookHistoryData`, and codec-owned feature-wide preferences. Empty-registry cold load returns a writable sparse workspace with no recipe, point selection or fabricated feature. `DocumentModel.live` is optional: it only supplies an existing product's starting feature, whose own codecs supply its empty/starter part. Unknown parts, editor memory and feature-wide preferences remain carried; released workspace/collection schemas, the storage budget and SQLite rows are unchanged.

`collection-workspace.ts` reads and writes all registered states. A missing part remains absent, editor-only memory survives without adding a part, and a blank exported state clears stale registered editor memory. `look-editor.ts` reads/writes the neutral look document and shared history, preserving unknown entries and refusing locked looks. `CollectionApplication` reads parts and a revision from that same owner; its existing layer-count view asks the registered codec for the primitive fact. Part-content versions are distinct from editor/history revisions, so selection alone keeps package results current; explicit in-place part writes advance the content version. The service's optional legacy `readRecipe` input remains an explicit compatibility route, alongside the neutral `readParts` port.

`makeup-workspace.ts` and `makeup-look-editor.ts` are stateless adapters for callers that still construct the concrete makeup editor. Existing consumers and historical fixtures change their imports to these adapters; no state owner, registry or startup policy is added. The concrete document exposes its existing neutral owner for the library writer. `StudioComposition.documents` still requires the legacy live feature until slice 4, while the workspace/draft model does not. Existing view/UV preferences and editor construction are left to their planned slices. No new lifetime is introduced; the look owner and regression fixtures continue to use `AbortSignal`. No shell, dock, palette, CSS, binding API or History-scope API changes.

The cold-workspace captured probe deliberately expects `null` now. The other three still capture their own couplings: editing construction (4), application handler equality (5) and runtime facade access (7). The three slice-3 pending gates are active in `core-editor-boundary.test.ts`: writable empty cold load (also synthetic starting codecs), zero/synthetic loose and collection workspace round trips through a reopened SQLite file with stable IDs, unknown data and Undo, and released workspace/collection compatibility. Additional regressions cover editor-only memory/reset, neutral content versions and package freshness across selection versus in-place edits. The existing released-format/history goldens pass without updating their expected data.

Five pending cases remain, all for slice 4: zero-feature editing services, registered synthetic construction, same-look sharing versus separate-look isolation, requester release/final abort, and dirty retention/retry after persistence failure. No shell-mount or GPU claim is made here.

**Validation:** `bun run check` passes under the 4 GB guard (peak 1.7 GB). The focused run covers every touched test plus the architecture boundary, trusted bootstrap, view contributions, scoped History, transactions, collection/package and history parity gates: **593 pass, 5 todo, 0 fail** across 55 files, with 100,667 assertions (peak 1.1 GB). Existing expected goldens and timing budgets are unchanged. The 16-layer/80-step gate measured edit/drag/store p95 of 0.92/0.50/0.28 ms against the existing 4 ms budget (one Bun service observation, no paint/GPU).

The final fresh five-batch run covers 516 tracked test files: 987/932/873/957/685 pass and 16/18/13/3/134 skip, totaling **4,434 pass, 0 fail, 184 skip**, with 5 pending cases. Peak private memory was 1.0/2.4/2.4/1.6/1.3 GB under the 4 GB guard. No memory floor or limit kill occurred, so no floor retry was needed. An earlier development run was deliberately stopped after batch 1 to fix and regress the selection-versus-content revision distinction; all five final batches ran again from the start.

Link, private-path and whitespace checks pass. Chrome is unavailable in this sandbox and was marked unavailable process-locally. The coordinator still runs the GPU/browser set and an isolated `?verify=1` smoke flow: cold start, restore existing/legacy workspace and collections, selection and feature preferences, edits/Undo/Redo, look switches and reload, checking stable bindings and saved content. Empty-feature shell mount is still slice 13's gate; no game test is needed for this workspace slice. Slice 4 has not started.
