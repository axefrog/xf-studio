# CORE-03: a feature-neutral editor, assessment and plan

[Code-health row CORE-03](code-health.md) (High) says the application, presentation shell and preview/editor adapters still need eye makeup's concrete document and facade. So a shell-only composition, or a second layered editor, needs changes outside the composition and feature folders. This page records where that coupling stands at main `d343c523` (27 October 2026, after profiles phase 3's service halves), and the plan to close it. Its open-work list sits beside the [UI architecture boundary](ui-architecture-boundary.md#open-work).

## Where it stands

**A composition without eye makeup does not mount.** In-memory constructor probes (no browser, nothing written) fail in startup order:

| Entry | Result |
|---|---|
| Cold workspace load, empty feature registry | `liveStarter()` dereferences the absent feature's part (`app/workspace/workspace-state.ts`); startup loads this before constructing authoring services |
| Preseeded workspace → trusted core | "The live feature eye-makeup is not a registered feature with gestures" (`app/trusted-authoring-core.ts`) |
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
| 4 | Editor construction registered per feature | `trusted-authoring-core.ts`, `look-edit-contexts.ts`, `profile-authoring.ts` | zero-feature core; synthetic editor; sharing, dirty retention, release | medium |
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
