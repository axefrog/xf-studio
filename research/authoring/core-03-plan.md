# CORE-03: a feature-neutral editor, assessment and plan

[Code-health row CORE-03](code-health.md) (High) says the application, presentation shell and preview/editor adapters still need eye makeup's concrete document and facade. So a shell-only composition, or a second layered editor, needs changes outside the composition and feature folders. This page records where that coupling stands at main `d343c523` (27 October 2026, after profiles phase 3's service halves), and the plan to close it. Its open-work list sits beside the [UI architecture boundary](ui-architecture-boundary.md#open-work).

## Where it stands

**A composition without eye makeup does not mount.** In-memory constructor probes (no browser, nothing written) fail in startup order:

| Entry | Result |
|---|---|
| Cold workspace load, empty feature registry | `liveStarter()` dereferences the absent feature's part (`app/workspace/workspace-state.ts`); startup loads this before constructing authoring services |
| Preseeded workspace → trusted editing services | `createAuthoringEditing()` requires the unregistered live feature with gestures (`app/trusted-authoring-core.ts`); this probe stops before the application's separate handler gate |
| Application with eye makeup unregistered | registered owners don't match handlers: the extra handler is `"eye-makeup"` (`app/studio-application.ts`) |
| Shell runtime with no makeup facade | `finishCatalogue()` on an absent facade (`studio-ui/runtime.ts`) |

`view-contributions.test.ts` proves only that a shell-only *layout* can be derived; the trusted-bootstrap test still composes eye makeup.

**What phase 3 changed.** P3-ii put the concrete makeup machinery behind keyed look-edit contexts, shared per-look history and captured operations. P3-iii gave each bound UV panel its own adapter (the unused singleton hooks remain). P3-iv, P3-vi and P3-vii added generic binding candidates, recovery facts and history-scope projections. These are good seams for this work, but they multiplied correctly scoped consumers of the same concrete editor rather than removing it. The import-boundary test's five feature-core and eleven exporter legacy allowances are unchanged.

**Remaining couplings, by responsibility** (paths under `projects/xf-studio/authoring/src/`):

- **Look state:**
  - `app/workspace/workspace-state.ts`, `collection-workspace.ts`: working state is a `Recipe` with layer, point, field and UV selection.
  - `library/look-editor.ts`, `collection-application.ts`, `library/look-edit-contexts.ts`, `app/profiles/profile-authoring.ts`, `panel-editing-contexts.ts`: the same concrete editor bundle, built per keyed context.
  - `app/authoring/*`: document, geometry, presentation, gestures and control edits all hold makeup types.
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
