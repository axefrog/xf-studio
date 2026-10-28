# CORE-03 slice 12: retained consumers

The slice-12 coordinator decision keeps still-consumed recipe, planner, descriptor and branding placement, released library/migration adapters and the one compatibility projection. Data safety takes precedence over relocation. No allowance is widened. This is a removal ledger, not a new import exception. Paths below are relative to `projects/xf-studio/authoring/src/`; every row names its direct retained dependencies. Internal legacy links are included so the eventual move can be bounded.

| Criterion | Why it stays; concrete removal criterion | Owner |
|---|---|---|
| R | Released recipe/schema readers and explicit library/workspace/history adapters still consume this codec. Inject the same codec through the existing registered document/file ports, preserve the frozen released-file and migration baselines, then relocate the codec and its remaining adapters together. Do not copy the parser. | CORE-03 |
| D | The shared compatibility descriptor catalogue still spreads the makeup descriptors. Replace that static compatibility read with the existing registry's descriptors, preserve catalogue order/IDs and typed input vocabularies, then move the one table. | CORE-03 |
| B | Pure compatibility product data still supplies the planner, plate messages, registered guidance, shared neutral rename hint, showroom and framework specimens. Framework/install policy now receives the feature's contribution. Remove each remaining direct read by injecting the same product data or neutral hint; then move the single data module. The UI track owns the two guide specimen imports and must approve their replacement. | CORE-03; UI track for `studio-ui/style-guide/components.ts` and `studio-ui/style-guide/library-demo.ts` |
| P | The registered collection export bridge still wraps the released planner/filter and host package adapters; library migration reads the planner's released collection shape. Move the whole dependency group only after that migration has an explicit injected adapter and plate/build dependencies enter through the existing exporter/prerequisite ports. Preserve Check/Build omission, identity, manifest and verifier baselines. | CORE-03 |
| S | Plate derivation, preparation, head source and saved head-choice defaults still share the released plate recipe/record/host chain. Supply neutral head metadata and registered prerequisite ports without copying a second source or changing recipe/cache/settings identities; move the plate group with its host adapters only when all its external readers have migrated. | CORE-03 |
| G | Released mutation/history constructors and the application facade still use concrete layered editing interfaces. Route those reads/writes and legacy whole-recipe histories through registered editor/document adapters, preserving history IDs, selection and restore semantics, before removing the constructors. | CORE-03 |
| V | Registered flat/surface/preview devices still use released UV, quality, raster and structural preview types/adapters. Keep the one device/source owner; migrate to structural registered editor/source ports while preserving UV keys, gesture object identity, quality/cache identities and raster bytes, then move the adapters as a group. | CORE-03 |

## Direct consumers

| Consumer | Retained dependencies | Criterion / owner |
|---|---|---|
| `app/authoring/makeup-application.ts` | `legacy/eye-makeup/authoring-eye-makeup.ts` | G; CORE-03 |
| `app/authoring/makeup-document.ts` | `legacy/eye-makeup/editor-actions.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | G, R; CORE-03 |
| `app/authoring/makeup-files.ts` | `legacy/eye-makeup/export/package-action.ts`<br>`legacy/eye-makeup/export/package-filter.ts`<br>`legacy/eye-makeup/export/preset-collection.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | P, R; CORE-03 |
| `app/studio-action-descriptors.ts` | `legacy/eye-makeup/eye-makeup-descriptors.ts` | D; CORE-03 |
| `app/studio-application.ts` | `legacy/eye-makeup/authoring-eye-makeup.ts`<br>`legacy/eye-makeup/editor-actions.ts`<br>`legacy/eye-makeup/preview/preview-quality-actions.ts` | G, V; CORE-03 |
| `app/studio-presentation.ts` | `legacy/eye-makeup/preview/authoring-preview-coordinator.ts` | V; CORE-03 |
| `app/trusted-studio-bootstrap.ts` | `legacy/eye-makeup/preview/authoring-preview-coordinator.ts` | V; CORE-03 |
| `app/viewport-attachment.ts` | `legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `app/workspace/makeup-workspace.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `app/workspace/workspace-state.ts` | `legacy/eye-makeup/preview/preview-quality.ts`<br>`legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `compose/studio-registry.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts`<br>`legacy/eye-makeup/plate/eye-plate-recipe-pma.json`<br>`legacy/eye-makeup/plate/eye-plate-recipe.json` | S; CORE-03 |
| `compose/system-families.ts` | `legacy/eye-makeup/preview/preview-quality-actions.ts` | V; CORE-03 |
| `features/expressions/view/sets.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `features/eye-makeup/export/index.ts` | `legacy/eye-makeup/export/archive-inventory.ts`<br>`legacy/eye-makeup/export/host/package-build-wolvenkit.ts`<br>`legacy/eye-makeup/export/host/package-resource-builder.ts`<br>`legacy/eye-makeup/export/package-action.ts`<br>`legacy/eye-makeup/export/package-filter.ts`<br>`legacy/eye-makeup/export/package-resources.ts`<br>`legacy/eye-makeup/export/plate-reach.ts`<br>`legacy/eye-makeup/export/preset-collection.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-service.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | P, R, S; CORE-03 |
| `features/eye-makeup/export/plate-input.ts` | `legacy/eye-makeup/export/host/package-build-wolvenkit.ts`<br>`legacy/eye-makeup/export/host/package-resource-builder.ts`<br>`legacy/eye-makeup/export/host/plate-uv-footprint-io.ts`<br>`legacy/eye-makeup/export/package-action.ts`<br>`legacy/eye-makeup/export/plate-reach.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-service.ts` | P, S; CORE-03 |
| `features/eye-makeup/export-info.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `features/eye-makeup/index.ts` | `legacy/eye-makeup/eye-makeup-descriptors.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | D, R; CORE-03 |
| `features/eye-makeup/part.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `features/eye-makeup/product.ts` | `legacy/eye-makeup/mod-branding.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | B, R; CORE-03 |
| `features/eye-makeup/region.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `host/package-server.ts` | `legacy/eye-makeup/plate/host/eye-plate-prerequisite.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-service.ts` | S; CORE-03 |
| `installation/framework-fixtures.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `legacy/eye-makeup/browser/browser-preview-device.ts` | `legacy/eye-makeup/browser/raster-client.ts`<br>`legacy/eye-makeup/preview/authoring-preview-coordinator.ts`<br>`legacy/eye-makeup/preview/authoring-render-scheduler.ts`<br>`legacy/eye-makeup/preview/preview-quality.ts` | V; CORE-03 |
| `legacy/eye-makeup/browser/raster-worker.ts` | `legacy/eye-makeup/browser/raster-task-yield.ts` | V; CORE-03 |
| `legacy/eye-makeup/browser/surface-editor.ts` | `legacy/eye-makeup/browser/surface-map.ts`<br>`legacy/eye-makeup/browser/surface-occlusion.ts`<br>`legacy/eye-makeup/browser/surface-tangent.ts`<br>`legacy/eye-makeup/gesture-cancel.ts` | V; CORE-03 |
| `legacy/eye-makeup/browser/surface-tangent.ts` | `legacy/eye-makeup/browser/surface-map.ts` | V; CORE-03 |
| `legacy/eye-makeup/browser/uv-editor.ts` | `legacy/eye-makeup/browser/canvas-resolution.ts`<br>`legacy/eye-makeup/gesture-cancel.ts`<br>`legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `legacy/eye-makeup/editor-actions.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `legacy/eye-makeup/export/export-diagnostics.ts` | `legacy/eye-makeup/export/plate-lift.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/glitter-route.ts` | `legacy/eye-makeup/export/export-diagnostics.ts`<br>`legacy/eye-makeup/export/glitter-region.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/glitter-studio-flakes.ts` | `legacy/eye-makeup/export/export-diagnostics.ts`<br>`legacy/eye-makeup/export/glitter-region.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/host/archive-inventory-fs.ts` | `legacy/eye-makeup/export/archive-inventory.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/host/native-resource-tools.ts` | `legacy/eye-makeup/export/host/package-build-wolvenkit.ts`<br>`legacy/eye-makeup/export/host/packaged-build-tools.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/host/package-bake.ts` | `legacy/eye-makeup/export/glitter-route.ts`<br>`legacy/eye-makeup/export/plate-reach.ts`<br>`legacy/eye-makeup/export/preset-collection.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | P, R; CORE-03 |
| `legacy/eye-makeup/export/host/package-resource-builder.ts` | `legacy/eye-makeup/export/archive-inventory.ts`<br>`legacy/eye-makeup/export/host/archive-inventory-fs.ts`<br>`legacy/eye-makeup/export/host/package-bake.ts`<br>`legacy/eye-makeup/export/host/package-build-wolvenkit.ts`<br>`legacy/eye-makeup/export/package-resources.ts`<br>`legacy/eye-makeup/export/plate-lift.ts`<br>`legacy/eye-makeup/export/preset-collection.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/host/plate-uv-footprint-io.ts` | `legacy/eye-makeup/export/plate-reach.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/host/verifier-wolvenkit.ts` | `legacy/eye-makeup/export/host/package-build-wolvenkit.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/package-action.ts` | `legacy/eye-makeup/export/export-diagnostics.ts`<br>`legacy/eye-makeup/plate/eye-plate-head-source.ts` | P, S; CORE-03 |
| `legacy/eye-makeup/export/package-filter.ts` | `legacy/eye-makeup/export/export-diagnostics.ts`<br>`legacy/eye-makeup/export/package-action.ts`<br>`legacy/eye-makeup/export/plate-reach.ts`<br>`legacy/eye-makeup/export/preset-collection.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/package-resources.ts` | `legacy/eye-makeup/export/preset-collection.ts` | P; CORE-03 |
| `legacy/eye-makeup/export/preset-collection.ts` | `legacy/eye-makeup/export/export-diagnostics.ts`<br>`legacy/eye-makeup/export/glitter-region.ts`<br>`legacy/eye-makeup/export/plate-lift.ts`<br>`legacy/eye-makeup/mod-branding.ts`<br>`legacy/eye-makeup/recipe-schema.ts` | B, P, R; CORE-03 |
| `legacy/eye-makeup/plate/eye-plate-cut.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `legacy/eye-makeup/plate/eye-plate-recipe.ts` | `legacy/eye-makeup/plate/eye-plate-recipe-pma.json`<br>`legacy/eye-makeup/plate/eye-plate-recipe.json` | S; CORE-03 |
| `legacy/eye-makeup/plate/eye-plate-verify.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `legacy/eye-makeup/plate/host/eye-plate-cache.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `legacy/eye-makeup/plate/host/eye-plate-head-resolver.ts` | `legacy/eye-makeup/plate/eye-plate-head-source.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-service.ts` | S; CORE-03 |
| `legacy/eye-makeup/plate/host/eye-plate-prerequisite.ts` | `legacy/eye-makeup/export/host/package-resource-builder.ts`<br>`legacy/eye-makeup/export/host/plate-uv-footprint-io.ts`<br>`legacy/eye-makeup/mod-branding.ts`<br>`legacy/eye-makeup/plate/eye-plate-head-choice.ts`<br>`legacy/eye-makeup/plate/eye-plate-recipe.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-head-resolver.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-service.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-wolvenkit.ts` | B, P, S; CORE-03 |
| `legacy/eye-makeup/plate/host/eye-plate-service.ts` | `legacy/eye-makeup/export/host/plate-uv-footprint-io.ts`<br>`legacy/eye-makeup/export/package-action.ts`<br>`legacy/eye-makeup/export/plate-reach.ts`<br>`legacy/eye-makeup/mod-branding.ts`<br>`legacy/eye-makeup/plate/eye-plate-cut.ts`<br>`legacy/eye-makeup/plate/eye-plate-head-choice.ts`<br>`legacy/eye-makeup/plate/eye-plate-head-source.ts`<br>`legacy/eye-makeup/plate/eye-plate-recipe.ts`<br>`legacy/eye-makeup/plate/eye-plate-verify.ts`<br>`legacy/eye-makeup/plate/host/eye-plate-cache.ts` | B, P, S; CORE-03 |
| `legacy/eye-makeup/plate/host/eye-plate-wolvenkit.ts` | `legacy/eye-makeup/plate/host/eye-plate-service.ts` | S; CORE-03 |
| `legacy/eye-makeup/preview/authoring-preview-coordinator.ts` | `legacy/eye-makeup/preview/authoring-preview-policy.ts`<br>`legacy/eye-makeup/preview/preview-layer-change.ts`<br>`legacy/eye-makeup/preview/preview-quality.ts`<br>`legacy/eye-makeup/preview/preview-quality-actions.ts` | V; CORE-03 |
| `legacy/eye-makeup/preview/authoring-preview-policy.ts` | `legacy/eye-makeup/preview/preview-quality.ts` | V; CORE-03 |
| `legacy/eye-makeup/preview/authoring-render-scheduler.ts` | `legacy/eye-makeup/preview/layer-render-queue.ts` | V; CORE-03 |
| `legacy/eye-makeup/preview/preview-quality-actions.ts` | `legacy/eye-makeup/preview/preview-quality.ts` | V; CORE-03 |
| `library/browser/collection-transport.ts` | `legacy/eye-makeup/export/package-action.ts` | P; CORE-03 |
| `library/host/library-migrations.ts` | `legacy/eye-makeup/export/preset-collection.ts` | P; CORE-03 |
| `library/host/library-store.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `library/part-presets.ts` | `legacy/eye-makeup/export/package-action.ts` | P; CORE-03 |
| `preview/browser/editor-adapters.ts` | `legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `preview/browser/layered-editor-adapters.ts` | `legacy/eye-makeup/browser/surface-editor.ts`<br>`legacy/eye-makeup/browser/uv-editor.ts`<br>`legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `preview/browser/layered-preview-capability.ts` | `legacy/eye-makeup/browser/browser-preview-device.ts`<br>`legacy/eye-makeup/glitter-measurements.ts`<br>`legacy/eye-makeup/preview/authoring-render-scheduler.ts` | V; CORE-03 |
| `preview/browser/layered-preview-wiring.ts` | `legacy/eye-makeup/browser/browser-preview-device.ts` | V; CORE-03 |
| `preview/browser/panel-uv.ts` | `legacy/eye-makeup/uv-view.ts` | V; CORE-03 |
| `preview/browser/preview-capabilities.ts` | `legacy/eye-makeup/browser/browser-preview-device.ts` | V; CORE-03 |
| `preview/host/preview-core-service.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `preview/preview-capabilities.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `preview/preview-core-assemble.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `preview/preview-core-recipe.ts` | `legacy/eye-makeup/plate/eye-plate-recipe.ts` | S; CORE-03 |
| `setup/host/local-settings-server.ts` | `legacy/eye-makeup/plate/eye-plate-head-choice.ts` | S; CORE-03 |
| `setup/local-settings.ts` | `legacy/eye-makeup/plate/eye-plate-head-choice.ts` | S; CORE-03 |
| `showroom/host/build.ts` | `legacy/eye-makeup/recipe-schema.ts` | R; CORE-03 |
| `showroom/resources.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `studio-ui/guidance/help-topics.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `studio-ui/guidance/tours.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `studio-ui/panels/collection.ts` | `legacy/eye-makeup/mod-branding.ts` | B; CORE-03 |
| `studio-ui/panels/preview.ts` | `legacy/eye-makeup/preview/preview-quality.ts` | V; CORE-03 |
| `studio-ui/style-guide/components.ts` | `legacy/eye-makeup/mod-branding.ts` | B; UI track |
| `studio-ui/style-guide/library-demo.ts` | `legacy/eye-makeup/mod-branding.ts` | B; UI track |

## The one projection

| Exact consumer / retained projection | Why it stays; removal criterion | Owner |
|---|---|---|
| `app/trusted-authoring-core.ts`, `app/profiles/profile-authoring.ts` → `app/authoring/makeup-view.ts` | These compatibility constructors attach the one `makeup-document.ts`, `AuthoringGeometry` and `AuthoringPresentation` bundle to the neutral look and registered editor. Supply an optional registered projection/source in these constructors and in keyed/root attachments before removing this adapter. | CORE-03 |
| `app/authoring/makeup-view.ts` → `app/authoring/makeup-document.ts`, `app/authoring/authoring-geometry.ts`, `app/authoring/authoring-presentation.ts` | One detached geometry cache retains layer, point, field and array identity during captured gestures. Migrate the remaining facade and flat/surface/source consumers together; do not construct another cache. | CORE-03 |
| `app/studio-application.ts`, `library/makeup-look-editor.ts`, `app/workspace/makeup-workspace.ts`, `app/workspace/workspace-composer.ts` → `makeup-document.ts` | Concrete application compatibility and released saved-input/history adapters retain its API/type. Replace each with the neutral look/registered editing ports and explicit released adapters, preserving saved formats and scope identities. | CORE-03 |
| `app/studio-presentation.ts`, `app/authoring/makeup-application.ts` → `AuthoringPresentation` | The registered facade still forwards the detached cached view, selection and revision. Read the registered editor's one projection directly, without a second cache, before removing this forwarding type. | CORE-03 |
| `preview/browser/layered-editor-adapters.ts` → the core's geometry/presentation | Flat and surface picking/hooks use the same detached layer/point identities as the facade. Give both adapters the registered editor's structural read port and verify A/B/A, same-look sharing, stale-pointer refusal and Escape before retiring the compatibility bundle. | CORE-03 |
| `compose/studio-startup.ts` → `core.document` as `PreviewLayerSource`; `preview/browser/layered-preview-capability.ts` consumes that structural source | The preview factory is already structural, but production's source is still the same document. Bind the registered editor's structural publication source, including reset/effect/replay/abort behavior, before removing the document. | CORE-03 |

Slice 13 still owes real zero-feature shell mount/paint/dispose in an isolated `?verify=1` workspace and synthetic editor substitution without changes outside feature/composition. These retained consumers must be removed or explicitly accounted for before CORE-03 can close; no second editor, history owner, product registry or projection cache is authorised.
