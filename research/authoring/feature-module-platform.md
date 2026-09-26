# XF Studio feature-module platform

**Status:** accepted design, 25 September 2026; implementation per §8, with steps 1 (registry and routing), 2 (the look/part document model) and 3 (per-layer models) built on 26 September, the review of steps 1–3 fixed ([cleanup](#cleanup-after-steps-13)), step 4 (the look history, platform transactions and budgets) built on 26 September ([step 4 status](#step-4-status)), and step 5 (presentation facades, a live document per feature, view contributions, the Undo port, spec fields and per-look "not editable in this version", then the file moves into `engines/layered-makeup/`, `features/eye-makeup/view/` and `compose/`) built on 26 September ([step 5 status](#step-5-status)), step 7 (the scene host in `platform/scene/`, the scene port, feature renderers with eye makeup's as the first, and the platform's character renderer with the host's detail loader) built on 26 September ([step 7 status](#step-7-status)), and step 8 (the exporter and verifier contract, the product planner and package plan, the export host in `platform/export/` with `runProductBuild` for both hosts, `xfs/local-package-2`, eye makeup's exporter and verifier) built on 26 September ([step 8 status](#step-8-status)). It answers the [code-health](code-health.md) finding CORE-03 (High) and the related findings PIPE-12, CORE-08, CORE-09, CORE-02, UI-02, UI-05 and UI-11. The [architecture contract](architecture-contract.md) still governs. **More than one 3D view, and modules beyond eye makeup:** the [view graph and Studio modules design](view-graph-design.md) (27 September, design ready) extends §1, §4 and §5. Camera, lights, display and view tools become workspace graph nodes that views share or fork, and Studio modules (with or without a document part) contribute panels, view tools and scene kinds that a person shows or hides. Code paths are relative to `projects/xf-studio/authoring/src/` unless a link says otherwise.

**Why.** XF Studio is a platform. Eye makeup is its first feature module. Planned modules each get a dedicated effort:

- **Head and face first:** hairstyle design, lip makeup, cheek makeup, eye appearance and colour, piercings and earrings, eyebrows, character-creator controls and presets.
- **Then:** the rest of V's body and fashion.
- **Then:** world features.

Adding a feature must mean adding a module, not editing a dozen core files.

## 0. Summary

Today eye makeup *is* the application:

- **Routing.** `StudioApplication` routes by hard-coded kind sets and ends in fallbacks to the saved-V service. It guesses reason codes by matching message text.
- **History.** Undo holds whole `Recipe` snapshots.
- **Storage.** A collection is a list of presets, each holding one `Recipe` (`xfas/collection-1`). A layer's Glitter model decides the whole recipe's version (CORE-09).
- **Export.** Export is one product: `planCollection`, a verifier fixed to one selector and 105 morphs, `EYE_MAKEUP_MOD`, and `xfs/local-package-1`.

The design splits this into three parts:

1. **A platform.** It owns documents, history, persistence, routing, character context, the scene host and the export host, and knows nothing about layers, finishes or plates.
2. **Feature modules.** Each registers a *part* type and everything that operates on it. Eye makeup becomes module #1 with no change in appearance, stored data or exported bytes.
3. **One registry.** Descriptors, labels, Undo policy, consequences, limits, context targets, panels and exporters are all derived from it. There is no fallback routing.

**Acceptance test:** adding module #2 touches no platform file except the composition list (§9).

## 1. Platform versus feature modules

| Platform owns | A feature module registers |
|---|---|
| Look/collection document, part envelope, identity, revisions | Part codec: schemas, parse/migrate on read, serialize, empty/starter, summary, history chunking |
| Look-wide history (Undo/Redo), transactions, gesture sessions, persistence budgets | Actions: descriptor, capability, pure apply, history label, Undo policy, consequence override, limits/units |
| SQLite library, portable files, workspace persistence, recovery queue | Editor memory codec (active layer, selection) per preset |
| Routing, registry, catalogue, reason codes | Targets and context hits (existence checks, candidates) |
| Job scheduler (worker pool, fairness, cancellation) | Preview job policy on the scheduler (e.g. the layer queue) |
| Character context: resolver input, `ResolvedCharacter`, detail loading, material adapters | Resolver consumption (catalogue reads, character-input contribution, slots it supersedes) |
| Scene host: renderer, camera, lights, frame loop, picking dispatch, dispose (with the [view graph](view-graph-design.md): one GPU context and loop for every view; camera, lights, display and tools as graph nodes) | Renderer for its parts; picking inside its own objects; view tools, summaries and scene kinds of its Studio module |
| Export host: product plan, Check/Build/verify/promote, manifest, install transport | Exporter (eligibility, plan, inventory, `.xl` fragment, build) and an independent verifier |
| UI shell: docking, palette, menus, feedback, preferences | View contributions: panels, inspectors, extra commands, input bindings |

**Material adapters are platform renderer plugins, not feature modules.** They are keyed by the engine's material template path (`hair.mt`, `skin.mt`, the mesh-decal family, `metal_base.remt`). That follows the rule to interpret game files as the game does.

### Layout

```
src/platform/api/        public module API (types + small pure helpers) — the ONLY platform import allowed in features
src/platform/core/       document, history, registry, router, persistence, recovery, jobs, character context (DOM-free)
src/platform/scene/      scene host, detail loader, material adapters (browser/Three)
src/platform/export/     product planner, build/verify/promote host (node)
src/engines/<name>/      shared pure engines a feature may import (e.g. layered-makeup: recipe, raster, compiler)
src/engines/<name>/render/   the engine's renderer (Three allowed; e.g. layered-makeup's plate composite)
src/features/<id>/index.ts   FeatureModule (pure core)
src/features/<id>/view/      presentation contribution (studio-ui boundary rules)
src/features/<id>/render/    renderer contribution (Three allowed)
src/features/<id>/export/    exporter (host only)
src/features/<id>/verify/    independent verifier (host only; may not import export/ or engine compilers)
src/compose/             composition roots: core, browser devices, views, host exporters
```

**Built so far** (step 8): `platform/api` (with the scene port, `platform/api/scene.ts`, and the export contract, `platform/api/export.ts`), `platform/core` (with the product planner, `package-plan.ts`), `platform/scene` (the scene host, head rig, character renderer and feature-renderer registry), `platform/export` (the export host: product Check, the builder, the product verifier, the manifest reader and `runProductBuild`), `engines/layered-makeup` (with `render/`), `features/eye-makeup` (core, `view/`, `render/`, `export/` and `verify/`) and `compose/` (`studio-registry.ts`, `system-families.ts`, `views.ts`, `view-panels.ts`, `renderers.ts` and the host-only `exporters.ts`). Eye makeup's preview devices and most of its package pipeline modules still sit in `src/`, which its exporter wraps (see [step 5 status](#step-5-status), [step 7 status](#step-7-status) and [step 8 status](#step-8-status)).

**The engine holds no region of its own.** A feature hands the layered-makeup engine a `LayeredMakeupRegion` (`engines/layered-makeup/region.ts`): the layer models its layers may hold, the starter and new-layer contours, the mirror of symmetric layers (an axis and centre), fine Glitter's UV scope (its ID and regions, part of the exact cache key), the export texture grids (plate window, Glitter window, accent and head sides) and the words user-facing text uses for the area ("the eye UV area", "the lid"). Every engine read and edit takes it: `editLayers` and the layer actions, `applyRecipeAction` and gestures, shape transforms and hit tests, the raster (`coverage`, `raster`, `createRasterJob`, `rasterWindow`, `layerCoverageSampler`), the raster worker (each request carries the region's plain-data part), the preview's optical keys, the finish catalogues and the compiler. Eye makeup's region is `features/eye-makeup/region.ts` (`EYE_MAKEUP_REGION`, with its historical sample recipe `initialRecipe`); the composition passes it to the trusted core (`STUDIO_COMPOSITION.region`) and the preview and viewport devices (the UV and on-head editors), eye makeup's renderer passes its fine-Glitter scope to `makeup-stack`, and the export roots (the build tool, the localhost package route, the desktop build and Check worker) pass it to the package pipeline. The region reproduces exactly what the engine used to hard-code, so appearance and exported bytes are unchanged (CORE-75).

### Registration interfaces

Registration is split by runtime, so each bundle imports only what its boundary allows. All four parts are keyed by the same `FeatureId`. Registration is static and happens at composition time; there is no dynamic or remote plugin loading.

```ts
// platform/api/feature.ts
export type FeatureId = string & { readonly __feature: unique symbol };
export type Capability = { available: boolean; code?: ReasonCode; reason?: string; issue?: ValidationIssue };

export interface FeatureModule<P, E, A extends { kind: string }, T extends { kind: string }, H = never> {
  readonly id: FeatureId;                    // "eye-makeup"
  readonly api: 1;
  readonly label: string;                    // "Eye makeup"
  readonly stage: "stable" | "preview" | "dev";
  readonly part: PartCodec<P>;
  readonly editor: EditorCodec<E, P>;
  readonly actions: ActionTable<P, E, A, T>;
  readonly targets: TargetResolver<P, T>;
  readonly context?: ContextProvider<P, H, T, A>;
  readonly gestures?: GestureProvider<P, E, T>;
  readonly character?: CharacterContribution<P>;
  readonly catalogues?: Readonly<Record<string, readonly ChoiceInfo[]>>;  // finishes, glitter models (UI-10, CORE-08)
  readonly exports?: { exporterId: string };                              // host must register it (§6)
}

export interface PartCodec<P> {
  readonly current: string;                         // "xfs/eye-makeup-part-2"
  readonly accepts: readonly string[];              // every readable part schema, incl. lifted legacy ones
  parse(envelope: PartEnvelope): P;                 // validate + migrate on read; pure; throws ValidationError
  serialize(part: P): PartEnvelope;                 // always writes `current`
  lift?(file: unknown): P | undefined;              // bare legacy files, e.g. xfs/recipe-N
  empty(): P; starter(): P;
  summary(part: P): Readonly<Record<string, number | string | boolean>>;  // primitives only (CORE-05)
  chunks(part: P): readonly unknown[];              // stable content chunks for history dedupe (§3)
  join(chunks: readonly unknown[]): P;
  readonly maxBytes: number;
}

export type ActionSpec<P, E, A, T> = {
  descriptor: ActionDescriptor;                     // existing shape: scope, payload, variants, effect
  undo: "none" | "part" | "transaction" | "recovery";
  label(action: A): HistoryLabel;
  units?: Readonly<Record<string, LimitUnit>>;
  limits?(part: ReadonlyDeep<P>, target: T, variant?: string): Record<string, FieldLimit>;
  consequence?(action: A): Partial<Consequence>;    // otherwise derived from descriptor.effect
  capability(state: FeatureState<P, E>, action: A): Capability;   // structured codes, never message matching
  apply(state: FeatureState<P, E>, action: A): FeatureResult<P, E>;
};
export type ActionTable<P, E, A extends { kind: string }, T> =
  { readonly [K in A["kind"]]: ActionSpec<P, E, Extract<A, { kind: K }>, T> };   // compile-time exhaustive
export type FeatureState<P, E> = { readonly part: P; readonly editor: E };
export type FeatureResult<P, E> = { part: P; editor: E; effect: RenderEffect };  // effect is opaque to the platform

// view/, render/ and export/ entries (separate composition roots)
export interface FeatureView { feature: FeatureId; panels: PanelContribution[]; commands?: CommandContribution[];
  bindings?: InputBindingContribution[] }
export interface FeatureRendererFactory { feature: FeatureId; create(host: SceneHostPort): FeatureRenderer }
export interface FeatureExporterEntry { exporter: FeatureExporter<unknown>; verifier: FeatureVerifier }
```

**Gestures.** A `GestureProvider` opens a feature-owned session on a working copy, which keeps live layer identity for performance. The platform owns the transaction: one checkpoint, apply, commit or revert-cancel, and one Undo entry. Escape restores the start state and never creates Redo; this becomes platform policy.

## 2. Document model

```ts
export type PartEnvelope = { schema: string; body: unknown };
export type StoredPreset = { id: Uuid; name: string; revision: number;
  parts: Readonly<Record<string /* FeatureId */, PartEnvelope>> };
export type StoredCollection = { schema: "xfs/collection-2"; id: Uuid; name: string;
  presets: StoredPreset[]; packagePlan?: ModPackagePlan /* §6 */ };
// In memory: Look = { id, name, revision, parts: ReadonlyMap<FeatureId, unknown> } (parsed by each codec)
```

- **Looks are sparse.** A missing part means "this feature isn't part of this look", not an empty part.
- **Identity.** Preset and collection UUIDs are unchanged. The preset `revision` still increases when any part or the name changes.
- **Version per part.** Each part carries its own schema; there is no whole-look schema bump.
- **Unknown features.** Parts of unregistered features (e.g. from a newer build) are kept verbatim, shown as "not editable in this version", and never dropped on save.

### Versioning per part and per model (CORE-09)

No evaluator branches on `recipe.schema`, and each layer's `flakes` already names its optical model.

- **Part 1.** `xfs/eye-makeup-part-1` is a recipe file body: the recipe with the `xfs/recipe-N` schema that gates its layer models. It is what step-2 builds wrote, and what the minimal writers still write whenever a recipe schema holds the part.
- **Part 2** (current since step 3). `xfs/eye-makeup-part-2` is the in-memory recipe: no recipe-level schema. Each layer's optical block is validated by a **model registry** (`layer-models.ts`) keyed by its own model ID, so a new Glitter model registers an ID instead of bumping a schema. See [step 3 status](#step-3-status).
- **Invariant.** "Version the model whenever appearance changes" now applies per layer model.
- **Structural changes.** A part-schema bump is reserved for structural changes.

### Migration on read, with no appearance change

| Input | Reader | In memory | Writes |
|---|---|---|---|
| `eye-artistry/recipe-1`, `xfs/recipe-2`…`11` files | eye-makeup `lift` → `parseRecipe` (each file keeps its schema's gates) → part-2 | new preset with an eye-makeup part | nothing until the user saves |
| `xfas/collection-1` (files, SQLite rows, drafts) | platform reader wraps each `preset.recipe` as an eye-makeup part envelope | `xfs/collection-2` | a new SQLite revision only on explicit save; old rows never rewritten. Rows and exported files use the **oldest schema that holds the content exactly** (see [step 2 decisions](#step-2-status)); the library refuses a collection that needs `xfs/collection-2` ([cleanup](#cleanup-after-steps-13), CORE-30) |
| SQLite v2 | unchanged tables; the JSON rows describe their own schema | — | no DDL change |
| `xfas/workspace-1` (editor, histories, recovery drafts) | histories become eye-makeup part history; editor memory becomes eye-makeup editor state; `glitterChoices` becomes eye makeup's feature memory | `xfs/workspace-2` | same key; desktop keeps `workspace.v1.bak` |

Two defects must be avoided:

- **Revision churn.** `collection-store.ts` `save()` compares raw stored JSON with parsed values, so after the upgrade every unchanged preset would get a new revision on first save. Compare both sides as `serialize(parse(x))`, in the store and in the `CollectionService` baselines.
- **Downgrade.** Older builds can't read version 2. Protected storage refuses to overwrite an unreadable workspace, and desktop keeps a `.bak`. "Export recipe" for one eye-makeup part writes the oldest `xfs/recipe-N` that holds it, so sharing with older builds still works.

**Parity gates** (required before each format step merges):

1. Every fixture schema (recipe-1…10, collection-1 and the reference 2K recipe where locally available) is read through the old and the new path. The results must match: byte-identical `raster()` masks at 512/1K/2K, identical `compileFlatPreset` output, identical `planCollection` identities.
2. A SQLite v2 fixture: list, get, save and save again. Old rows stay byte-unchanged, and unchanged presets keep their revision.

## 3. Undo, history and persistence budgets (CORE-02)

**Scope.** One linear history per **look**, across its parts. Ctrl+Z undoes the last change wherever it happened. Entries record only the parts they touched:

```ts
// platform/api/history.ts (built in step 4)
type StoredLookEntry = { scope: "part" | "look";
  before: Readonly<Record<string /* FeatureId */, readonly ChunkId[] | null /* the look lacked the part */>> };
type LookHistoryData = { schema: "xfs/look-history-1"; entries: StoredLookEntry[];
  chunks: Record<ChunkId, unknown>; trimmed?: true };
// platform/core/look-history.ts: `LookHistory` adds session-only IDs, labels, times and Redo on top.
```

- **Part edits.** Actions, controls and gestures create `part` entries.
- **Look transactions.** One `look` entry containing several parts (`LookHistory.checkpoint(read, features, { scope: "look" })`). Examples: "Apply character from save", "Paste look", "Reset look". The app-level `app.transaction(label, features, fn)` records one over the named features' live documents ([step 5 status](#step-5-status)).
- **Redo** keeps today's semantics: session-only, and valid only while the look is exactly what the last Undo produced, across every part: a change that records no step (another feature's action with Undo policy `none`) hides it, while a selection, which leaves the content as it was, does not (CORE-46). A gesture owns the transaction, forms can't begin inside a gesture, and Undo is refused while a transaction is open.
- **Read model.** The History panel already reads `authoring.historyTimeline()` (`HistorySnapshot`: opaque step IDs, `HistoryLabel`s, optional times, `done`/`undone` state, current index, redo count, `trimmed`, `startId`) and jumps with `history.jumpTo {entryId}`. Neither exposes recipes, so the look history publishes the same shape: one step per `HistoryEntry` (a look transaction is one step), `trimmed` from `trimmedBefore`. It may add optional fields such as the touched features, never rename or remove the current ones.

**Storage.** Each part is split by `codec.chunks()` into chunks stored once per look, addressed by content hash with collisions detected by comparing content. Eye makeup chunks one per layer plus a header. A gesture on one layer of a 32-layer look then costs one layer chunk per entry. In memory every look's history is this chunked form; the stored workspace uses the oldest form that holds it (whole parts per feature while every step is a part step of one feature, `xfs/look-history-1` otherwise), unless whole parts do not fit the storage budget: then every history is stored in the look-level form before any step is dropped. At six presets × 80 steps of 16 layers the in-memory histories take 9% of the whole-recipe form ([step 4 status](#step-4-status)).

**Budgets.** `fitWorkspace(state, model, budget) → { encoded, plan, trimmed, overBudget, minimal }` runs before every write. The UI can then say "Older steps were not kept".

| Store | Budget (default) | Trim order |
|---|---|---|
| Browser workspace (~5 MB localStorage quota, shared by the normal and `?verify=1` keys) | 2,000,000 UTF-16 code units per key | always the standard policy (the selected look's full history, 5 steps of every other look, recovery drafts and removed presets without histories); then, only while over budget: 0. every history in the look-level form (nothing dropped; builds before step 4 open it read-only), unless that is not smaller; 1. recovery-draft histories (content kept; none under the standard policy); 2. non-selected preset histories, oldest first; 3. the selected preset's history, oldest first, keeping ≥10 steps; 4. recovery copies, then removed presets, oldest first; 5. only when the looks alone leave no room, the selected look's last steps |
| Desktop `workspace.json` | 16 MB cap, 12,000,000 code units for the fitted form | same order |
| A single part | `codec.maxBytes` (eye makeup: 2 MB) | refused at parse or edit time with a `limit` issue |

## 4. Routing and the registry-derived catalogue (CORE-03, CORE-08)

**Commands.** Platform families (collection/preset, history, camera/preview, motion, quality, saved-V, files, host detection) keep flat `kind` IDs, registered as *system families* in the same table shape as features. Library requests (`library`, run by `CollectionService.execute`) and file workflows (`files`, run by `StudioFileOperations`) are **asynchronous families** (`AsyncSystemFamily`, since step 4, CORE-36): the registry routes them by owner with `routeAsync` and keeps them out of the synchronous action table. Gesture proposals are the live feature's `gestures.descriptors`; the gesture session and its Undo transaction are the platform's (`HistoryTransaction`). Feature commands use an envelope:

```ts
export type StudioCommand = PlatformAction | { kind: "feature"; feature: FeatureId; action: { kind: string } };
// Qualified registry ID: "eye-makeup/layer.setColor"; platform: "collection/preset.edit", "history/undo".

dispatch(command: StudioCommand): DispatchOutcome {
  const route = this.registry.route(command);       // total function, no fallback
  if (!route.ok) return route;                      // { ok:false, code:"unknown_feature" | "unknown_action" }
  const allowed = this.capability(route);           // unowned-preset, busy-transaction and target checks, then spec.capability
  if (!allowed.available) return refuse(allowed);
  return route.owner.kind === "system" ? route.family.dispatch(route.action)
    : this.looks.applyFeature(route, { label: route.spec.label(route.action), undo: route.spec.undo });
}
```

**Targets and hits.**

- `StudioTarget` gains `{ kind: "part"; feature; target: T }`.
- Context hits become `{ kind: "part"; feature; hit: H }`, bound to a **per-part revision** (generalising `geometryRevision`).
- `contextCandidates` moves verbatim into the eye-makeup module's `ContextProvider`.

Everything below becomes derived from the registry:

| Today (hand-maintained) | Derived from |
|---|---|
| kind sets, `undoPolicy()`, `startsWith` routing | `spec.undo`, `descriptor.effect`, owner |
| `ACTION_DESCRIPTORS`, `actionRegistry()`, `descriptorsFor` | union of system and feature tables |
| `history-labels.ts` tables | `spec.label` |
| `action-consequences.ts` branches | generic rule from `effect`/`undo` plus `spec.consequence` |
| `action-limits.ts` units and Glitter special cases | `spec.units`, `spec.limits` |
| `reasonCode()` message-text matching | structured `Capability.code` |
| `layer.setFinish` enum literal vs `finishCatalogue()` | module `catalogues.finishes` feeds the descriptor's `values` |
| `studio-ui/runtime.ts` sources regex table; `PANEL_META`, `PANEL_IDS` | family/feature labels; `FeatureView.panels` |

**Presentation port.** It gains `features()` and `feature(id)`, a typed facade with `view`, `capability`, `dispatch`, `limitsFor`, `choicesFor`, `control*` and gesture methods. The port's former `editor` is the eye-makeup facade's `view()` (built in step 5; gestures still reach the application through the viewport devices).

**Grandfathered IDs.** Existing eye-makeup panel IDs and action kinds stay inside the `eye-makeup` namespace, so saved dock layouts and bindings survive. New features use `<feature>.<panel>` IDs.

## 5. Rendering (UI-02, UI-11)

**Scene host.** `scene.ts` is split. `platform/scene/scene-host.ts` owns the renderer, environment, camera and controls, lights, render-on-demand, resize and hidden-host rules, and a `dispose()` that frees everything, including after a failed load. Modules receive only:

```ts
export interface SceneHostPort {
  group(feature: FeatureId): THREE.Group;           // disposed with the renderer
  anchors(): { head: THREE.SkinnedMesh; surface(id: string): THREE.SkinnedMesh | undefined };
  character(): ReadonlyDeep<ResolvedCharacterView> | undefined; subscribeCharacter(cb: () => void): () => void;
  details: DetailLoader; jobs: JobPort; textures: TextureBudget;
  requestFrame(): void; onFrame(cb: (dt: number) => void): () => void;
}
export interface FeatureRenderer {
  sync(part: unknown | undefined, effect: RenderEffect | "reset", quality: PreviewQuality): void;
  readiness(): PartReadiness;
  pick?(ray: PickRay): unknown | undefined;         // feature hit H; the platform binds it (§4)
  readonly supersedes?: readonly ResolvedSlot[];     // resolved components this feature replaces while active
  dispose(): void;
}
```

**Built** (step 7; see [step 7 status](#step-7-status) for how the built port differs from the sketch above): `scene.ts` is gone. `platform/scene/scene-host.ts` owns the renderer, camera, controls, lights, display, stage, render on demand (`src/render-scheduler.ts`), resize, the device pixel ratio, context restores and disposal; `platform/scene/head-rig.ts` the core head, its surfaces, facial shapes and the rig motion; `platform/scene/character-renderer.ts` the V the character context resolved, loaded through the host's `DetailLoader`; `platform/scene/feature-renderers.ts` the registry that makes each feature's `SceneHostPort` (`platform/api/scene.ts`). Eye makeup's renderer (`features/eye-makeup/render/`) wraps `makeup-stack`; the composition lists it in `compose/renderers.ts`. The skin placement adapter (`src/head-skin-placement.ts`, limit codes in `src/detail-limits.ts`) and the evidence projections (`src/scene-evidence.ts`) are unchanged.

**Detail-loading port.** The resolver runs on the host, and devices load its output:

```ts
export interface DetailLoader {        // keyed by (depot hash, container fingerprint); ref-counted
  load(component: ResolvedComponent, signal: AbortSignal): Promise<LoadedDetail>;
  release(detail: LoadedDetail): void;
}
export interface MaterialAdapter { matches(template: DepotRef): boolean;
  create(chunk: ResolvedChunkMaterial, textures: TexturePort): THREE.Material }
```

- **`CharacterContextService`** (DOM-free) owns the character input: default, imported save, or a character part contributed by a module.
- **The host adapter** (the resolver host plus the generic game-file export adapter) serves `ResolvedCharacter` and a cached GLB per drawing component.
- **The platform's character renderer** loads every drawing, non-superseded component through `DetailLoader` and the adapter matching its material template. This replaces the exact-hash special cases for brows, lashes, hair, eyes and PRC.

**Lifecycle.** Host ready → create renderers → `sync` on each part change or preset switch (`"reset"` on preset switch or quality change) → `dispose` on teardown. Readiness aggregates per feature into `PreviewReadiness`. Raster arithmetic, cooperative cancellation and complete-bundle publication stay unchanged.

**One scene host is one viewport (corrections for more than one view).** The built host fuses one WebGL context, one scene, one camera and controls, one light rig and one subject, and the layers above it assume exactly one ([audit](view-graph-design.md#2-audit-where-the-code-assumes-one-viewport)). The [view graph design](view-graph-design.md) splits it into per-scene, per-view and per-rig runtimes under one context and one loop (its phase P3). Three consequences for this section:

- **Renderers are view-independent.** A feature renderer is created per *scene node*, not per view. It must never depend on the camera or the light rig that draws it. The port's `lighting()` and `subscribeLighting` assume one rig per scene; no renderer uses them, and they are removed in phase P1. Per-view differences, such as eye makeup's plate wireframe, reach a renderer only through an optional `viewTools` hook.
- **Surface controls and Plate wireframe are eye makeup's view tools.** They are not preview-family toggles: they become its `ViewToolContribution`s, and the head toolbar is derived rather than hard-coded.
- **The `viewport` target and the camera and preview actions gain a view.** `StudioTarget {kind: "viewport"}` and the camera and preview actions gain an optional view, which defaults to the focused view (§4).

## 6. Export: mod products and the package plan (PIPE-12)

### Feature exporter contract

```ts
export interface FeatureExporter<P, Plan extends FeaturePlan = FeaturePlan> {
  readonly id: string; readonly version: string;       // "eye-makeup/mesh-decal-flat-v1"
  readonly defaults: { brand: string; selectorLabel: string };        // "XF Eye Artistry"
  readonly requirements: readonly FrameworkRequirement[];             // { ArchiveXL: "1.27.3" }, { game: "2.31" }
  eligibility(presets: readonly LookPart<P>[]): { packaged: LookPart<P>[]; omissions: PackageOmission[] };
  plan(input: { collectionId: Uuid; presets: LookPart<P>[]; selectorLabel: string }): Plan;  // pure, deterministic
  inventory(plan: Plan): readonly PlannedResource[];
  xl(plan: Plan): XlFragment;
  prerequisites?(plan: Plan): readonly HostPrerequisite[];            // e.g. the derived eye plate
  build(plan: Plan, ctx: FeatureBuildContext): Promise<FeatureBuildRecord>;
}
export interface FeatureVerifier {            // imports nothing from export/ or engine compilers
  readonly exporterId: string;
  verify(plan: FeaturePlanJson, unpacked: UnpackedView, record: FeatureBuildRecordJson): FeatureVerification;
}
```

The eye-makeup exporter wraps today's code unchanged (preflight, plan, compiler, resource builder, verifier). Checks specific to the product move into `features/eye-makeup/verify/`.

### Package plan: merged by default, splittable by the user

```ts
export type ModPackagePlan = { schema: "xfs/package-plan-1"; products: ModProductPlan[] };
export type ModProductPlan = { id: Uuid; name?: string; features: FeatureId[];
  selectorLabels?: Partial<Record<string, string>> };
```

The plan is stored with the collection and edited through collection actions (`package.assign`, `package.rename`, `package.split`, `package.merge`). Every choice has a default the user can override:

| Choice | Default | Override |
|---|---|---|
| Which features ship together | **one product** holding every exportable feature | move any feature to another or a new product |
| Product identity | default product ID = collection ID; others new UUIDs | — |
| Archive/`.xl` file name | `xfs_c<collection>` for the default product (byte-identical to today); `xfs_m<product>` for others | never shown or edited |
| Mod name (MO2 folder, mod-manager entry) | one feature: that feature's brand ("XF Eye Artistry"); several: **"XF Looks"** | rename freely (the "XF " prefix is a default, not enforced) |
| Name stability | a derived name is **frozen into the plan at first successful Build**, so adding a feature later never silently renames an installed mod | explicit rename |
| Folder collision with another XF product | name + " (collection name)", or a number when that isn't a valid folder name | rename (never to another mod's name of the collection) |
| Selector label | per feature, the exporter's default, identical merged or split | per-feature label |
| New feature added later | joins the default product | move it |

### Selectors, identity and versioning

Selectors and resource identities are **feature-scoped and product-independent**. Merging or splitting changes only the archive, `.xl`, folder and manifest that carry them.

- **Selectors.** Each exporter chooses how its looks appear in the character creator: **its own selector** where that's genuinely best (eye makeup needs one because of its custom face plate), or **extra choices added to the matching vanilla option set** otherwise (for example lip makeup joining the vanilla lipstick choices). The choice is part of the exporter's defaults and is recorded in the plan and manifest. A merged `.archive.xl` lists every feature's customizations; a split one lists only its own.
- **Resources.** Eye makeup keeps its grandfathered depot root. New features use `…/<key>/<feature>/`.
- **Versioning.** Each feature plan records exporter ID/version, plan hash, source revisions and output hashes.

### Pipeline

1. **Check** runs per product: feature eligibility and plans, then product checks (depot-path and option-name collisions across features, `.xl` merge, and framework requirements taking the maximum per framework).
2. **Build** runs every exporter into one staging tree through one WolvenKit pack, then unbundles into an empty directory.
3. The **product verifier** requires the unpacked set to equal the union of feature inventories plus exactly one `.xl` equal to the merged fragments.
4. **Each feature verifier** runs on its subset, keeping the no-compiler-imports independence rule.
5. **Promote** writes `xfs/local-package-2`:

```ts
{ schema: "xfs/local-package-2", productId, modName, archive: "xfs_c….archive",
  features: [{ feature, exporter, exporterVersion, collectionId, namespace, selectorLabel, presets, omissions,
               planSha256, verification }], requirements, files, installed: false, gameRenderingVerified: false }
```

The install transport accepts both version 1 and version 2. One `runProductBuild` serves localhost and desktop (PIPE-03, PIPE-09).

### Moving a feature between mods without breaking saves

Saves store `.app` depot-path hash, definition and option name, none of which depends on the product, so a move is a repack. **A feature namespace may be present in only one installed XF mod.**

- **Moving:** Check reports the move, Build produces both products, and Install replaces and adds as one journaled operation. It refuses a state where a namespace is duplicated and offers "Replace both".
- **Renaming:** keeps the product ID and moves the folder in place. Archive names are ID-based, so load order is unaffected.

**Needs in-game proof** (add to the [validation card](../../docs/validation.md)):

- (a) one `.xl` registering two customizations resources shows both selectors, each switching independently;
- (b) a saved choice survives moving its feature to another archive or mod;
- (c) a saved choice survives a product or folder rename;
- (d) selector position changes after a move are cosmetic.

## 6a. Guidance: tours, spotlights and help (v1 built)

A data-driven guidance system serves first-run onboarding, on-demand "show me how" tours and per-release "what's new" tours.

**Status (v1, `claude/guidance`, 25 September).** Built as presentation modules in [`src/studio-ui/guidance/`](../../projects/xf-studio/authoring/src/studio-ui/guidance/) with one-line registration hooks in the panels and the shell. The design below still describes where it goes next; v1 differs only where noted.

- **Anchors** ([`anchors.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/anchors.ts)): a typed catalogue of control anchors (`header.save`, `header.package`, `header.history`, `header.help`, `header.palette`, `layers.add`, `layers.list`, `uv.canvas`, `head.view`, `finish.color`, `finish.picker`, `presets.list`, `history.list`, `package.check`), each naming its owning panel, plus one `panel.<id>` anchor per panel. `AnchorRegistry` lives on `StudioRuntime`; panels register elements as they build them. Rectangles are cut to what their scrolling panels show.
- **Runner** ([`engine.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/engine.ts)): `GuidanceService`, a DOM-free presentation service with a typed snapshot and the actions `guidance.startTour`, `guidance.next`, `guidance.back`, `guidance.skip` and `guidance.finish` (`GUIDANCE_DESCRIPTORS`: scope `guidance`, effect `view`, no Undo). `advanceWhen` is evaluated against read-only facts relative to the step's start (`layer.added`, `recipe.edited`, `finish.changed`, `color.changed`, `preset.added`, `lighting.changed`), panel visibility, capabilities, or `any` of these.
- **Buttons** carry a `TourCommand` dispatched through the ordinary validated paths: `studio` (`rt.dispatch`), `studio.activeLayer` (the same, with the active layer's ID filled in when pressed), `file` (`rt.file`), `previewSetup`, and `panel` (the existing dock reveal). Their availability is the port's own capability, and an unavailable button's reason is written in the card.
- **Missing anchors.** A hidden control whose panel is showing lights the panel. A closed or background panel is offered ("Show History" or "Skip this step"). An anchor with no panel is skipped in the direction of travel; a tour with nothing showable completes.
- **Overlay** ([`overlay.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/overlay.ts), [`placement.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/placement.ts)): one fixed spotlight whose shadow is `--guidance-scrim` (it lightens the rest of the UI in the light theme and dims it in the dark theme), tracked every frame and never taking layout space. The callout is a non-modal labelled dialog with custom buttons and a markdown-lite content area ([`content.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/content.ts); `[[key:<binding>]]` chips come from the binding catalogue). Esc skips (also outside the card, unless a gesture, menu, dialog or text field has it), → and Enter go on, ← goes back. Focus moves into the card only on a person's own navigation and returns afterwards; each step is announced.
- **Content** ([`tours.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/tours.ts)): *Getting started* (8 steps) and *What's new in 0.1.0-alpha.1* (4 steps; its creator-lighting step says that feature arrived after that version). Onboarding is offered once after the welcome screen, never over an open dialog or a 3D preview card that is asking for something, and never in `?verify=1` unless a harness calls `xfStudioShell.guidance.offerOnboarding()`. How each tour ended, or that the offer was declined, is kept in `UIPreferences.tours` (`tours.record`), so it is workspace- and verification-scoped. Starting a tour while another runs ends that one as skipped first. Text that says which finishes can go into a mod is never written into the data: a token is filled from the finish catalogue the port publishes ([`finish-text.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/finish-text.ts)).
- **Help view** ([`help-panel.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/help-panel.ts), [`help-topics.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/help-topics.ts)): a dock panel, closed by default, that opens beside the inspectors. One search covers tours, help topics and the keyboard and mouse reference (`helpReference()` over `bindingReference()`). Named links open the public knowledge pages and the issue tracker through `port.links`; hosts resolve `ProjectLink` names, so the view never sends a URL. F1 (`shell.help`), the header's Help button and the palette open it. F6 region cycling includes a visible tour card or onboarding offer.
- **Tests**: `tests/guidance.test.ts` checks tour data against the anchor, action, file, setup, panel and key registries; that every anchor is registered; the state machine and `advanceWhen`; missing anchors; the tour-progress preference; the guidance import boundary; the derived reference; key handling and dialog semantics; and placement. An isolated headless-Chrome `?verify=1` run completed the onboarding tour in dark, light and 520 px-wide windows (evidence in the ignored `evidence/screenshots/guidance/`).

**Deferred:** feature-module `tours` and `help` contributions (they wait for the §1 registries); showing a what's-new tour automatically after an update (needs the installed version from the host); localisation; a step that waits for a package Check result; and a DOM-level unit-test harness (focus and Esc were checked in headless Chrome and the browser pane).

- **Anchors.** Panels, controls and commands register stable named anchors (e.g. `uv.canvas`, `eye-makeup.finish.picker`, `layers.add`) through the same registry as panels and actions. Tours target anchors, never CSS selectors, so docking and layout changes don't break them. A missing anchor means the step is skipped, never a crash.
- **Tours as data.**

```ts
type TourStep = { anchor?: AnchorId; spotlight?: "anchor" | "none"; placement?: "auto" | Side;
  content: HelpContent;                 // markdown-lite, localisable later
  buttons: { label: string; action?: StudioCommand | "next" | "back" | "skip" | "finish" }[];
  advanceWhen?: AppCondition };          // typed event/capability predicate, e.g. { event: "layer.added" }
type Tour = { id: string; title: string; version?: string /* what's-new */; audience: "onboarding" | "howto" | "whats-new";
  steps: TourStep[] };
```

- **Contributions.** Feature modules contribute `tours` and `help` topics alongside panels and actions. The platform owns the spotlight overlay (theme-aware dimming or lightening), the callout component, the tour runner, the Help view, and progress kept in UI preferences.
- **Help view.** Searchable topics, the keyboard and mouse reference generated from input bindings, and the list of available tours. "What's new" tours are keyed to release versions and the changelog, shown once after an update and replayable from Help.
- **Actions.** Tour buttons dispatch ordinary typed actions ("Do it for me"), so tours never bypass validation or Undo.

## 7. Boundary enforcement

Add these to `tests/architecture-import-boundary.test.ts`, with a recursive walker:

1. `features/<a>/**` never imports `features/<b>/**`, `platform/core|scene|export/**`, `studio-ui/**`, `compose/**` or entry points. It may import `platform/api/**`, `engines/**`, pure shared libraries and its own folder.
1a. Only `compose/**` and the composition roots (the browser entry points `studio-main` and `studio-startup`; outside `src/`, the servers, desktop host, tools and tests) import `compose/**`. Every other module receives the registry, the part registry and the live feature as arguments, and no module outside the roots reaches `features/**` or `compose/**` even transitively (CORE-29).
2. `features/*/index.ts` and its core imports use no Three, DOM, `node:` or worker APIs. Only `render/` imports Three. Only `export/` and `verify/` import `node:` or tool ports.
3. `features/*/verify/**` imports neither `features/*/export/**` nor any engine compiler, raster or bake module.
4. `features/*/view/**` obeys the studio-ui boundary rules.
5. `platform/**` never imports `features/**` or `engines/**`. Only `compose/**` imports feature entries.
6. The browser bundle graph contains no `export/` or `verify/` module.
7. Registry completeness:
   - every action has a descriptor, label, Undo policy and numeric units, and appears in the catalogue and an activity source;
   - every exporting feature has an exporter and a verifier;
   - every panel has meta;
   - a golden `registry()` snapshot guards against ID churn.

**Enforced today** (`tests/architecture-import-boundary.test.ts`, `tests/studio-ui-boundary.test.ts`, `tests/studio-registry.test.ts`):

- Rules 1 and 1a. A feature's core imports only its allowlist: `platform/api`, engines (not their renderers), the pure helpers (`read-only`, `validation-issues`), its own folder and an explicit legacy list whose entries each name the step that removes them (`recipe-schema`, `history-labels`, `eye-makeup-model`, `eye-makeup-descriptors`; the list only shrinks, and a test fails when an entry is no longer imported). Its core never imports its view.
- No feature reaches `platform/core`, `platform/scene` or `platform/export`, even through other modules: a core by any import, types included; a view by the imports that load code. A core also never reaches Three, `node:`/`bun:`, a browser device, studio-ui, `compose/` or its own view, render or export folder, and it reads no page or host global (CORE-77).
- Rule 2 for Three and `node:`, rules 4 and 5.
- The engine rules: engines import only engines, `platform/api` and the pure helpers; only an engine's `render/` imports Three and the scene's shared materials; no other engine module reaches a renderer or Three, even through other modules; and the pure engine reads no page or host global: the window in any use but a property name, `self.`, `document.`, `globalThis`, storage, the navigator, `fetch`, `process.env` or `Bun.env`, scanned in code with comments and literals blanked (CORE-78). studio-ui and the platform import no engine.
- The view rules: views receive a `FeatureViewContext` over their facade, never the shell's runtime or the port, by type (UI-73); the import scan sees every import form (UI-74).
- The registry golden of rule 7.

The engine and feature rules run over a source tree, and a test runs them on the tree with the review's injected violations appended (a pure engine module importing its renderer, the page globals of CORE-78, a feature core importing a browser device, a trusted service, the DOM and Three, and a legacy module reaching the look history), each of which must fail. Since step 8 a feature's `export/` and `verify/` have their own rules (rules 2 and 3): the exporter imports only `platform/api`, engines (not renderers), its own core and exporter, Node and a shrinking legacy list of the `src/` pipeline modules it wraps; the verifier imports only `platform/api`, Node, its own folder and its core's export info, and reaches no exporter, engine or legacy pipeline module even transitively; only `platform/export` in the platform uses Node; the browser bundle reaches no exporter, verifier or export host (rule 6); and every exporting feature has an exporter and a verifier of the same ID in `compose/exporters.ts` (rule 7, `tests/studio-registry.test.ts`). Each is shown to fail on injected violations. See [file moves](#file-moves). Since step 7, rule 2 lets a feature's `render/` (only) import Three, and a renderer imports only `platform/api`, engines, Three and its own feature's core, never `platform/scene` ([step 7 status](#step-7-status)); `platform/api` and `platform/core` never import `platform/scene`, and `platform/scene` imports the platform, Three and a listed set of the scene's device modules (a [recorded exception](ui-architecture-boundary.md#open-work)). Since the step 7 cleanup these two rules are transitive, types included (CORE-86): everything the scene host reaches is a listed device or support module, never a feature, engine, `compose/`, studio-ui or application service, and a renderer reaches, beyond its feature's core, only `platform/api`, engines, Three and the scene's materials. `platform/api` names Three by type only (CORE-88), and the import scan reads template-literal specifiers and refuses any computed `import()` or `require()` (CORE-87).

## 8. Migration plan

Each step is behaviour-preserving and leaves `main` green: full authoring suite, typecheck, bundle build and the step's gates. Effort is in agent-days (estimates; agents usually move faster).

**Sequencing with in-flight work:**

| Step | Waits for | Because it shares these files |
|---|---|---|
| 1 | `claude/cleanup-core` | `studio-application`, `authoring-document`, `editor-actions` |
| 7 | `claude/preview-from-game` | `scene`, `studio-main` |
| 8 | `claude/finish-materials` and `claude/cleanup-pipeline` | `preset-collection`, `package-resources`, verifier |

This is a cleanup track, so the High-findings merge pause does not block it.

| # | Step | Gate | Effort | Closes |
|---|---|---|---|---|
| 1 | `platform/api` types, `Registry`, system families; the eye-makeup core module registers the existing tables moved as-is; `StudioApplication` derives kind sets and Undo policy from the registry, routes by owner with an exhaustive check, removes both fallbacks, returns structured codes. *Done 26 Sep (`claude/platform-step1`); see [step 1 status](#step-1-status).* | golden registry/descriptor snapshot equals the pre-change one; application tests unchanged | 3 | CORE-08, CORE-15, part of CORE-03 |
| 2 | Look/part model, `collection-2` reader/writer, eye-makeup part-1 codec; `CollectionSession`/`CollectionService`/store on parts; canonical comparison in `save()` and baselines; `workspace-2` with per-feature editor memory. *Done 26 Sep (`claude/platform-step2`); see [step 2 status](#step-2-status).* | parity gates (§2); SQLite fixture; workspace-1 fixtures restore identical state | 5 | CORE-03 (data), CORE-05 |
| 3 | Part-2 with the per-layer model registry; `selectGlitterModel` stops touching the schema; minimal-schema recipe export. *Done 26 Sep (`claude/platform-step3`); see [step 3 status](#step-3-status).* | parity gates; every Glitter fixture renders identically | 2 | CORE-09 |
| 4 | `LookHistory` (part and look entries, chunk store, Redo), generic gesture and control transactions, `fitWorkspace` budgets. *Done 26 Sep (`claude/platform-step4`); see [step 4 status](#step-4-status).* | existing Undo/Redo/gesture/control tests; size benchmark under budget; reload keeps ≥10 steps | 4 | CORE-02, part of CORE-11, CORE-36 |
| 5 | Presentation `features()`/`feature(id)`; eye-makeup panels move to `features/eye-makeup/view`; layout, panel meta and activity sources from contributions; `recipe.undo` → `history.undo`; `git mv` of eye-makeup files into `features/eye-makeup` and `engines/layered-makeup` (import rewrites only). *Done 26 Sep (`claude/platform-step5`; file moves in `claude/platform-step5-moves`); see [step 5 status](#step-5-status).* | studio-ui logic and boundary tests; style guide rebuilt; `?verify=1` with a saved dock layout restored | 5 | CORE-03 (routing), UI-10 |
| 6 | One composition root used by every host | Done 25 Sep (`claude/retire-legacy`): `studio-startup.ts`, started by `studio-main` and the desktop bootstrap; `main.ts` and `port-smoke` retired; bootstrap and boundary tests | 2 | UI-05 |
| 7 | Scene-host split, `FeatureRenderer`, `CharacterContextService`, `DetailLoader`, material adapters; eye makeup's renderer wraps `makeup-stack`; brows, lashes, hair and piercings render through resolved components. *Done 26 Sep (`claude/platform-step7`); see [step 7 status](#step-7-status). The resolved details came ahead of it (claude/render-resolver, claude/multilayer-piercings).* | `?verify=1` Ready at 1K/2K; makeup screenshot parity; dispose leak test; idle frame-on-demand test | 7 | UI-02, UI-11, PIPE-11 (preview) |
| 8 | `FeatureExporter`/`FeatureVerifier`, product planner, `runProductBuild` for both hosts, `local-package-2`, transport reading version 1 and 2, package-plan actions and panel. *Done 26 Sep (`claude/platform-step8`); see [step 8 status](#step-8-status).* | default-product Build **byte-identical** archive members and identical plan; two-product synthetic test with a stub exporter; namespace-duplication refusal test | 6 | PIPE-12, PIPE-09, PIPE-03 |
| 9 | Strict boundary tests (§7); update the contract, invariants, catalogue and pipeline guide (with visual diagram review) | link check; diagrams inspected | 2 | — |

### Step 1 status

Built on 26 September in `claude/platform-step1`. Behaviour, action IDs, serialized formats and the presentation port are unchanged.

**What exists.**

- `src/platform/api/`: the action types (`ActionDescriptor`, `ActionSpec`, `ActionTable`, `UndoPolicy`), `ReasonCode`, `Capability` and `ValidationIssue`, the owner types (`SystemFamily`, `FeatureModule`, `ActionHandler`) and small pure helpers (`actionTable`, `coded`, `refusal`, `undoPolicyOf`, `featureId`, `familyId`). The legacy `studio-action-descriptors.ts` and `validation-issues.ts` re-export these types.
- `src/platform/core/registry.ts`: `Registry` refuses a duplicate owner or a kind owned twice. It gives kinds (all, or one owner's), descriptors in registration order, Undo policy (variant first), a total `route(kind)` and entries with qualified IDs.
- `src/features/eye-makeup/index.ts`: module #1, registering the 29 recipe and layer actions with their existing descriptors.
- `src/compose/system-families.ts`: history, collection, preview (camera and viewing), motion, quality and saved V.
- `src/compose/studio-registry.ts`: the composition list `STUDIO_OWNERS`, `StudioOwnerActions` and `STUDIO_REGISTRY`.
- `StudioApplication` takes the registry (injected by the composition roots since the cleanup; it has no default) and binds one handler per owner. It has no kind sets, prefix checks, fallbacks or message matching. Its `StudioOwnerActions` map names the owners it binds; the composition list is checked against it at compile time.

**Decisions** (open details in §1 and §4, settled the simplest way):

- **Spec contents.** A step-1 `ActionSpec` holds only the existing descriptor: scope, payload, variants, effect and Undo policy. The other fields join in later steps: `label` with the look history (step 4, done: a feature spec's `label` names its Undo step); `units`, `limits` and `consequence` with the presentation facade (step 5). Until then they stay in `action-limits.ts` and `action-consequences.ts`.
- **Capability and dispatch are handlers, not pure spec functions yet.** They depend on part and editor state, which arrives in step 2. Meanwhile the application binds an `ActionHandler` per owner over today's services. The handler map is a mapped type over `StudioOwnerActions`, so a registered owner without a handler does not compile, and the constructor also refuses a registry whose owners differ from the handlers. When step 2 lands, the eye-makeup handler becomes the module's `capability` and `apply`.
- **Family policy replaces prefixes.** A system family declares `needsScene` (refused with `asset_unavailable` while the scene cannot load: preview, motion, saved V) and `thrown` (the code for an exception after the gate: `unavailable` for preview, motion and quality). History's busy check is keyed by the owner.
- **IDs.** `featureId()` and `familyId()` keep the literal type and accept lower camel or kebab case (`eye-makeup`, `savedV`). A qualified ID is `<owner>/<kind>` (`eye-makeup/layer.setColor`, `history/history.undo`; the history kinds were `recipe.undo`/`recipe.redo` until step 5). Commands keep their flat, grandfathered kinds. The `{ kind: "feature" }` envelope waits for module #2, because no current action needs it.
- **Undo policy name.** A feature action's policy is `part` (`UndoPolicy = "none" | "part" | "transaction" | "recovery"`). It was `recipe` until step 5, which renamed it with the presentation facade, since Undo had become a look history across parts.
- **Unknown kinds.** `route()` answers `unknown_action`. The application refuses with its existing `invalid_value` "Unknown command." (before, `capability()` threw on the missing descriptor). `StudioReasonCode` is unchanged.
- **Structured codes.** Each refusal in the recipe, layer, collection, preview, motion, quality and saved-V checks states its code; a validation issue implies one (`coded()`). The codes are the ones the old text matching produced, with two corrections to `asset_unavailable`, both idle or hair-asset failures whose text lacked "unavailable". Codes that read oddly but were kept are listed as CORE-26 in the [ledger](code-health.md). `CollectionActions.capability()` and `PreviewActions.capability()` keep their uncoded shape for existing callers, and the application reads their new coded `check()`. The quality assessment carries its own `code`.
- **Where things live until step 5.** The system families sit in `compose/` because their descriptors are still in `studio-action-descriptors.ts`; they move to `platform/core` when that table splits. The eye-makeup module imports its legacy `src/` files; the step-5 `git mv` turns those imports into own-folder and `engines/` imports.

**Boundary tests** (§7, as far as step 1 goes), in `tests/architecture-import-boundary.test.ts` and `tests/studio-registry.test.ts`:

- `platform/**` imports only `platform/**` and reads no browser globals.
- Features import the platform only through `platform/api`, never another feature, `compose/`, the UI, entry points, browser devices, Three or `node:`.
- Only `compose/**` imports features.
- Every action is owned exactly once, and the owners' union equals the descriptor table in order.
- The derived kind sets equal the previous hand-kept ones.
- The golden `tests/golden/studio-registry.json` equals the catalogue captured from the pre-change code.

**Cost.** Measured on the same machine against the pre-change code: no change within noise. Routing costs the same or less; a six-action capability sweep dropped from 0.67 to 0.57 µs. Figures are in the [ledger](code-health.md).

Step 2 built everything step 1 listed as its needs; see below.

### Step 2 status

Built on 26 September in `claude/platform-step2`. Appearance, exported archive members and the presentation port are unchanged; the stored workspace and new collection revisions change format as described here.

**What exists.**

- `src/platform/api/document.ts`: `PartEnvelope`, `PartCodec` (with `lift`, `downgrade`, `summary`, `maxBytes` and the `legacy` collection-1 claim), `EditorCodec`, `MemoryCodec`, `Look`/`LookCollection` (`xfs/collection-2`), `PartMemory`/`LookMemory`, `FeatureState`/`FeatureResult` and `canonicalJson`. `actions.ts` adds `FeatureActionSpec` and `featureActionTable`; `FeatureModule` now carries `part`, `editor` and `memory`.
- `src/platform/core/document.ts`: `PartRegistry`, the platform's document codec. It reads collection-1 and collection-2 (`readCollection`, `readPreset`, `readIdentity` for lists), writes collection-2 (`write`) or the minimal schema (`writeMinimal`, `writePresetMinimal`), compares canonically (`canonicalParts`) and reads and writes per-feature memory (`readMemory`, `readFeatureMemory`, `writeMemory`, `readFeatureWide`). Parts and memory of unregistered features are kept verbatim.
- `src/features/eye-makeup/`: `part.ts` (`xfs/eye-makeup-part-1`, the recipe verbatim through `parseRecipe`; the editor codec for active layer, selected point and warp selection; the feature memory for remembered Glitter and Colour-shift settings) and `core.ts` (pure `eyeMakeupCapability` and `applyEyeMakeup` over `FeatureState<Recipe, EyeMakeupEditorState>`). The registry's specs carry them for all 29 actions.
- `src/compose/studio-registry.ts`: `STUDIO_PARTS` (the part registry of the composed features) and `LIVE_FEATURE`, the feature the one live editor document edits until the presentation facades (step 5) give each feature its own. Since the cleanup they reach the collection, library and workspace code only as an injected `DocumentModel` (`STUDIO_DOCUMENTS`, `STUDIO_COMPOSITION`).
- Collections: `collection-workspace.ts` holds drafts of looks with memory by look and feature, reads workspace-1 drafts (`readCollectionWorkspaceV1`) and workspace-2 drafts (`parseCollectionWorkspace`) and writes the latter. `CollectionSession`, `CollectionActions`, `CollectionService` and the SQLite `CollectionLibrary` work on looks; the eye-makeup package pipeline takes `eyeMakeupCollection(looks)`, its collection-1 view, and `parseCollection` reads either schema.
- Workspace: `workspace-state.ts` reads workspace-1 and workspace-2 and writes workspace-2 (`serializeWorkspace`); `workspace-budget.ts` trims every feature's history alike before serializing; the desktop store writes the serialized form and keeps the `.bak`.
- `StudioApplication`'s eye-makeup handler runs the registered spec's `capability` and `apply` over `EyeMakeupPort` (`authoring-eye-makeup.ts`), which reads the live document without copying and publishes the result exactly as the recipe and layer services always have (one checkpoint, the state, the render effect).

**Decisions** (open details in §2, settled here):

- **In memory, a look's registered parts are `{ schema: current, body: parsed }`.** A parsed part must be plain data, so the in-memory look and its stored form have the same shape; `readPart` normalizes every read.
- **Writers use the oldest schema that holds the content exactly.** A SQLite row or an exported collection file is `xfas/collection-1` when every look holds exactly eye makeup's part in a form part-1 holds (`downgrade`); otherwise `xfs/collection-2`. So a library and an exported file of eye-makeup looks stay readable by the released 0.1.0-alpha.1, which was checked by running that release's own readers on the new outputs: it reads the collection-1 export, lists and reads a library holding new rows and saves on top of them, refuses a collection-2 file without writing, and treats a workspace-2 as unreadable and protected. **The alpha's limit is exact:** it lists the library only while the latest revision of *every* collection is collection-1 (one collection-2 row makes its whole list fail), and saves on a collection only while its latest row is. The library therefore never writes a collection-2 row: such a save is refused with a plain message (CORE-30, [cleanup](#cleanup-after-steps-13)); collection-2 stays the form of exported files and of the workspace. The workspace always writes version 2: per-feature editor memory is its reason to exist.
- **Glitter and Colour-shift memory is feature-wide.** Workspace-1's `glitterChoices` (keyed `<preset>/<layer>`) becomes `features["eye-makeup"].choices` verbatim, so settings of a preset that is not loaded come back if its collection is opened again. The pure action state gets the current look's entries keyed by layer (`EyeMakeupEditorState.choices`), and the port writes changed entries back under the preset. So `FeatureModule` has `editor` (per look: active layer, selection, warp selection) and optional `memory` (feature-wide), and the action state's `E` is built by the host from both.
- **Stored workspace-2.** `look` holds the loose editor (parts and memory by feature) only when no collection draft exists, since the selected look restores the editor; `features` holds each feature's workspace memory; each draft stores `memory[preset][feature] = { editor, partSchema, history, historyTrimmed? }`, with removed presets and recovery drafts alike. History entries are part bodies of `partSchema`; since step 4 this is the stored form of a look history that holds one feature's part steps (see [step 4 status](#step-4-status)). View state (UV view, camera, preferences, preview setup, saved V) is unchanged. The one later view field, the studio light rig (`preview.studioLights`), is written only when it differs from the original rig, so a workspace that never adjusts it keeps its stored bytes; earlier builds ignore it (and read a studio exposure outside their 0.5–2 range as 1.2), so it needs no version change.
- **The in-memory `WorkspaceState` keeps the live document's fields** (`recipe`, `active`, `selected`, `history`, `fieldSelection`, `glitterChoices`) as the one live eye-makeup document (since step 4 its `history` is the look's `LookHistoryData`); entries of unregistered features ride in `otherFeatures`. Only `serializeWorkspace` output is ever stored.
- **Canonical comparison** is `canonicalJson(serialize(parse(part)))` (keys sorted), in the store's `save()` and in `CollectionService` baselines; the baseline also keeps the raw JSON so the common unchanged case costs one stringify.
- **A newer part schema of a registered feature is refused on read** ("saved by a newer version of XF Studio"), so a workspace holding one stays protected and a library row holding one is never overwritten; collection lists read identity only (`readIdentity`) and still list it. Step 3 kept this rule, and the cleanup extended it to every place a part can sit (CORE-27; see [cleanup](#cleanup-after-steps-13)).
- **Sparse looks.** Stashing an empty recipe does not add an eye-makeup part to a look that had none; new presets still get one, as they always have.
- **Layer actions keep their checkpoint rule** (always checkpoint, as `AuthoringLayerActions` did), so their results report `changed: true`; recipe actions report the existing `changed` test.
- **CORE-05.** Target checks, context binding and request capability read the draft's identity (`hasPreset`, `draftIdentity`, `isBusy`, the summary) instead of cloning it, and the Glitter-model preset lookup reads the selected preset ID instead of snapshotting (which also stashed). The package request still takes a snapshot, because it must include unsaved edits.

**Parity gates** (tests in `tests/look-model.test.ts`; goldens captured from the step-1 code at `eb11d7f` by the scripts in `tests/fixtures/`):

- **Workspace-1:** four deterministic fixtures (every stored field, a loose editor, a large workspace of 6 × 12 layers with 80-step histories, 20 removed presets and four recovery drafts, and a damaged one) restore exactly the observable state the step-1 code restored: every preset's editor after switching, restored removed presets, recovery drafts, `historyTrimmed`, Glitter and shift memory, view state and warnings. The same holds after storing that state as workspace-2 at each of the four budget levels and restoring it.
- **Recipes and collections:** every recipe schema (1–11) and every committed collection fixture reads to the same recipes through the old and the new path; masks are byte-identical at 512, 1K and 2K; compiled maps are byte-identical; `parseCollection`, `planCollection` and the package filter keep the step-1 digests for collection-1 input, and give them again from the minimal and the collection-2 forms (diagnostic knobs aside, which only experiment files carry).
- **Real Build:** the four-preset fixture (Experiment 005's editor collection) built with WolvenKit 9.0.1 before the change and after it, from the file written by the new minimal writer and from its collection-2 form: all 16 unbundled archive members, all 12 DDS and the `.archive.xl` are byte-identical (the archive container's own hash varies from run to run, also between two post-change runs).
- **SQLite:** a library written by the step-1 stores (a v1 look library upgraded to v2, then saves) lists and reads unchanged; its rows are never rewritten; saving an unchanged collection adds no preset version (the step-1 store had bumped every migrated preset here); a change adds exactly one; reopening compares canonically.
- **Downgrade:** desktop keeps `workspace.v1.bak` (or `verification-workspace.v1.bak`) once, byte for byte, on the first version-2 save; a workspace from a newer build is never replaced; browser storage refuses to overwrite an unreadable or newer workspace, as before.

**Cost** (same machine, large fixture with 16-layer looks; median): restoring workspace-1 83 → 88 ms, restoring the stored form 19 → 28 ms (parts are parsed and size-checked on read), encoding 2.5 ms either way, stored size 2,258,391 → 2,262,080 code units (+0.2%). `snapshot()` 90 ms either way. CORE-05 reads: `targetCapability(preset)` 240 ms → 1 µs, `contextQuery(preset)` 1.56 s → 6 µs, `requestCapability(package)` 90 ms → 5 µs. Six eye-makeup `capability()` calls 1.3 → 1.7 µs; `dispatch(layer.setOpacity)` 200 → 205 µs (noise).

Step 3 built everything step 2 listed as its needs; see below.

### Step 3 status

Built on 26 September in `claude/platform-step3`. Appearance, exported archive members and the presentation port are unchanged. No action changes a schema any more; writers derive it.

**What exists.**

- `src/engines/layered-makeup/layer-models.ts`: the per-layer **model registry** (`LayerModelRegistry`) and the engine's models, each with its slot, stored ID and validator: classic flakes (stored without a `model` field), `irregular-planar-1`, `uv-cell-direct-1`/`-2`/`-3` and the `game-matched-1` optics with their Colour-shift settings. `check(layer, holds?)` validates a layer's optical blocks: with an older form's gate only the models it holds (same messages), without one every registered model, naming an unknown model ID as a newer build's.
- `src/engines/layered-makeup/recipe.ts`: the in-memory `Recipe` is `{ uv, layers }`, a feature's layered-makeup part (eye makeup's part-2 body). `parseRecipe(value, models)` reads in-memory recipes only; `readLayers(layers, models, forms, holds)` validates layers in any structural form the engine still reads (single or named warp fields, strength modes, Bézier paths, per-point softness).
- `src/recipe-schema.ts`: eye makeup's recipe-file lineage (CORE-76). `RECIPE_FILE_SCHEMAS` and each schema's structural forms and model gates; the eye-makeup registry `LAYER_MODELS` (`RecipeModelRegistry`, which adds each model's oldest recipe schema: classic flakes any, irregular 7, Direct 8, 9 and 10, game-matched 11; `minimalSchema(layers)` gives the oldest schema that holds them all, never below recipe-7); `RecipeFile`; `readRecipe` (a recipe file of any schema, migrating exactly as before, or an in-memory recipe); `parseRecipeFile` (files only, keeping their migrated schema: recipe-8…11 stay, older become recipe-7); `parseRecipePart` (part-2 bodies only); `recipeFile` (the oldest schema that holds a recipe), `readRecipeFile` (a file as it is, or an in-memory recipe given its oldest schema), `portableRecipe`/`readPortableRecipe` (what "Export recipe" writes and "Import recipe" reads) and `EYE_MAKEUP_PART_2`.
- `features/eye-makeup/part.ts`: `eyeMakeupPartCodec(models)`. `current` is part-2; `accepts` is `[part-1, part-2]`, oldest first; part-1 bodies parse into part-2; `downgrade(recipe, part-1)` returns the recipe file in its oldest schema, or nothing when a layer model has no recipe schema. `lift` reads recipe files and part files.
- `platform/core/document.ts`: `minimalPart` writes each part in the oldest schema its codec accepts that holds it (`accepts` is ordered oldest first; `downgrade` decides), and `writeMinimal`/`writePresetMinimal` use it for collection-2 too. Writers use a look's in-memory part body as it is instead of parsing it again, so the minimal writer's bytes equal step 2's for the same looks.
- `glitter-model.ts`, `recipe-actions.ts`, `shape-transform.ts`: `selectGlitterModel` changes only the layer; `applyRecipeAction`, gestures and shape transforms validate the edited recipe as part-2.
- The package pipeline's collection-1 view (`parseCollection`, `eyeMakeupCollection`) holds recipe files: a collection-1 input keeps each recipe's schema, and a look's part is written in its oldest schema. The legacy look library writes rows as recipe files in their oldest schema.

**Decisions:**

- **The in-memory recipe has no schema.** Rather than keep a derived `schema` field in memory, it was removed, so nothing can branch on it or pin it; the type checker found every former reader. A recipe file's schema exists only where one is read or written.
- **Pinned schemas are not kept.** Step 2's "never go below `recipe.schema`" rule existed only because the schema was recipe-wide. With per-layer models, a writer uses the oldest schema that holds every layer: removing the last game-matched layer writes recipe-7 again. No evaluator read the schema (checked in this code and in 0.1.0-alpha.1's), so this changes no appearance; it only lets older builds read more files. Of the committed fixtures, 16 presets stored as recipe-11 need only recipe-7 (the finish board, depth, UV-window and session-2 candidates): read directly from their files, the package pipeline keeps their schema and its step-1 digests exactly; through a look, they are written as recipe-7, identical apart from that tag.
- **Collection-1 input keeps its schema.** `parseCollection` of a collection-1 file keeps each recipe's migrated schema (`parseRecipeFile`), so Check and Build of a prepared file, and its packaged-collection hash, are unchanged.
- **Every recipe reader takes either form.** `parseRecipe` and part-1 bodies accept a recipe without a schema as part-2 (no build ever wrote one, but code and tests build collection-1 objects from in-memory recipes). Import recipe stays strict: a recipe file or a part file, as before.
- **A newer part schema, or an unknown layer model, stays refused on read** (the open step-2 question). Keeping a registered feature's newer part verbatim and read-only is safe only when the editor cannot edit that feature in that look: otherwise the first edit replaces the kept part with an empty recipe. That needs a per-look "not editable in this version" state in the document model and the presentation (step 5; step 4's decision is recorded in its status). Until then refusing is the only behaviour that cannot lose data: the workspace stays protected, library rows are never overwritten and lists still show the collection. Part-2 makes this rarer, because a new Glitter model now registers an ID instead of a part schema; an unknown ID in a part-2 body is named as coming from a newer version (`This look uses a finish model from a newer version of XF Studio (…)`). The step-3 code refused it only in the current draft; the cleanup makes the refusal typed and complete (CORE-27).
- **A model no recipe schema holds** (none exists yet) makes that look part-2 only: the minimal writers put it in collection-2 as part-2 while other looks' parts stay part-1, "Export recipe" writes the part itself (`{ schema: "xfs/eye-makeup-part-2", body }`, which "Import recipe" reads), and the eye-makeup package view refuses it until its exporter exists. Tests cover it with a synthetic registry.
- **The workspace stored part-2** in step 3. Since the cleanup its looks and Undo histories use the oldest part schema that holds them, as the collection writers do (CORE-27), so step-2 builds read what this build writes whenever the content allows.

**Parity gates** (tests in `tests/eye-makeup-part-2.test.ts`; `tests/golden/part-2-parity.json` captured from the step-2 code at `2dced39` by `tests/fixtures/capture-part-2-golden.ts`, with recipe schema tags removed before hashing):

- **Every recipe schema (1–11)** reads to the same layers; masks at 512, 1K and 2K, the preview's optical and mask texture keys, the export plan and the compiled maps are byte-identical. The recipe-N gates are checked exhaustively against the step-2 rule: 11 schemas × 4 finishes × 9 flake forms × 4 optics forms, each accepted or refused as before with the same message.
- **Glitter:** three fixtures and 27 edits (every model chosen on a layer beside game-matched Glossy and Colour-shift layers, an earlier-study Glossy switched to the game-matched model, all models side by side, model settings, finish changes away and back): after each step the recipe, the remembered settings, masks, preview keys, export plan and compiled maps match the step-2 code.
- **Collections:** the six committed fixtures, read directly, through the minimal writer and through collection-2, give the same content, plans, package identities and packaged collections; read directly they still match the step-1 digests exactly.
- **Workspace-1:** the four step-2 fixtures restore the same observable state (recipe tags aside) after restore and at each budget level; step 2 had matched the step-1 code exactly.
- **Round trips:** part-1 → part-2 → part-1 returns the recipe file in its oldest schema (byte-identical content, canonically; the same file when it was already minimal), and part-2 → part-1 → part-2 and part-2 → stored → part-2 are exact.
- **No new revisions:** a pinned recipe-11 part-1 row and its part-2 form compare equal; a library holding step-2 rows (collection-1 with pinned recipes, and collection-2 with part-1 bodies and a hair part) saves unchanged with no new preset version, an edit adds exactly one (written as part-1), and old rows stay byte-unchanged.
- **Real Build:** the four-preset fixture built with WolvenKit 9.0.1 before the change and after it, from the original file, from the new minimal writer's file and from its collection-2 (part-2) form: all 47 compared files are byte-identical (the 16 unbundled archive members, 12 DDS, 16 baked rasters, `plan.json`, `compiled.json` and the `.archive.xl`). The archive container's own hash varies from run to run. The packaged-collection hash of each input equals the step-2 code's for the same input.
- **Browser:** a `?verify=1` workspace seeded from the small workspace-1 fixture, on a private port and data folder: Glitter models switched through the model menu on a layer beside game-matched Glossy and Colour-shift layers (the neighbours kept their optics), Export recipe wrote recipe-11 and, after the neighbours became Matte, recipe-8; Export collection wrote collection-1 (recipe-11, 10 and 7) after Save a copy (the seeded draft's revision was not in the fresh library, which the app reported); the library rows were collection-1 and a second save added no preset version; after reload the recipe, models and 10 Undo steps came back and Undo restored the Colour-shift layer.

**Cost** (same machine; medians): `parseRecipe` of a 16-layer recipe 110 → 112 µs (file) and 113 → 113 µs (in memory); `applyRecipeAction(layer.setOpacity)` 161 → 163 µs; restoring the large workspace-1 fixture 74 → 70 ms, its stored form 23 → 23 ms; stored size 1,721,484 → 1,718,196 code units (no schema tag per recipe).

Step 4 built the look history on part-2 bodies and reads step-2 part-1 histories through `partSchema`; the per-look "not editable in this version" state moved to step 5 ([step 4 status](#step-4-status)).

### Cleanup after steps 1–3

The deep review of steps 1–3 (ledger findings CORE-27 to CORE-37) was fixed on 26 September in `claude/cleanup-platform`. Appearance, exported archive members and the presentation port are unchanged.

**Decisions.**

- **Newer data opens read-only; it is never dropped (CORE-27).** A part schema a feature does not accept, or a layer model this build does not register, throws the typed `NewerDataError` (`platform/api/document.ts`) wherever it sits: the current draft, recovery drafts, removed presets, a loose look or an Undo history (a `partSchema` this build lacks, or a newer model inside one entry). It is never skipped as damage. `loadWorkspace` then restores a **read-only view** (`NewerPolicy` `omit`): the current draft as stored, without the newer entries, with `writable: false` and a plain protected message, so autosave never writes and the stored workspace keeps everything. A newer current draft falls back to a fresh read-only draft, as a damaged one does. Keeping newer entries verbatim in a writable workspace was rejected for the reason recorded in step 3's decisions (the editor could overwrite them) until the per-look "not editable" state exists (step 5).
- **The desktop store follows the same rule.** `load()` returns the file whenever its current draft is readable (damaged or newer entries elsewhere are the renderer's to handle), so Start fresh never sets a good current draft aside; only a current draft this build cannot show is refused with `workspace_unreadable` and set aside on Start fresh. `save()` never replaces a file holding newer data (posting the unchanged text back is not a change).
- **Histories and workspace looks are written minimally.** `PartRegistry.writeMemory` writes each history in the oldest part schema that holds every entry (`accepts` oldest first, `downgrade` decides), and workspace drafts, removed presets and the loose look store their parts through `minimalLook`. Eye-makeup workspaces therefore store part-1 again. Step-2 code reads them: its own `loadWorkspace` (extracted from `2dced39`) restored the small, loose and large fixtures written by this build as writable, with the same recipes, histories, removed presets and recovery drafts (schema tags aside). Stored size 2,258,792 → 2,262,080 code units on the large fixture (+0.15%, a schema tag per entry).
- **Injection, not a service locator (CORE-29).** `collection-workspace.ts` defines `DocumentModel = { parts, live }`; the collection, library, workspace, persistence and desktop-store code take it as an argument, `StudioApplication` and `createTrustedAuthoringCore` take the registry (`StudioComposition`), and `CollectionLibrary` takes the part registry. The browser root (`studio-startup`), the localhost server and the desktop server pass `STUDIO_COMPOSITION`, `STUDIO_DOCUMENTS` or `STUDIO_PARTS`. Eye makeup's action and state types moved to `src/eye-makeup-model.ts`, the history and collection families' action types to their services, and `StudioOwnerActions` to `StudioApplication`; the composition list checks itself against it. The package pipeline reads a collection-2 file's eye-makeup parts with `parseEyeMakeupPart` (the codec's own reader, now in `recipe-schema.ts`), so it needs no registry.
- **Package freshness is a version key (CORE-28).** `lastPackageIsCurrent()` compares `[content counter, collection ID, saved revision, selected look, live editor revision]` with the key recorded when the request was made. It never snapshots, copies or stashes; an edit later undone still reads stale until the next Check. Reads never write the live editor into the draft: `CollectionSession.snapshot()` applies it to its copy.
- **One editing path (CORE-31).** Form controls apply through the registered `apply` and the eye-makeup port (`EyeMakeupPort.apply`, no checkpoint: the control transaction owns it), gesture frames through eye makeup's registered `gestures` provider (`GestureProvider`, `applyRecipeGesture`: in place, keeping live identity) and the port. `AuthoringLayerActions` is deleted; its tests dispatch through `app.dispatch`.
- **Undo by policy (CORE-32).** Eye-makeup dispatch records an entry when the action's Undo policy (variant first) is not `none`; context-menu input options report their variant's policy (`undoPolicyOf`). Every current descriptor already paired `selection` with `none`, so behaviour is unchanged.
- **Deterministic apply (CORE-33).** An action that creates an item carries its ID (`field.add` `fieldId`, `layer.edit` `add`/`duplicate` `newId`); a spec's optional `assignIds` fills missing ones from the host's ID source before apply (the port's `newId`, default random UUIDs; the trusted core accepts a deterministic one). The registered apply refuses an action without its ID instead of inventing one; an ID already in use is refused by capability. Descriptors are unchanged: the IDs are host-supplied.
- **Export is based on the eye-makeup view (CORE-34).** Package and build-plan capability need a look with eye makeup (or the selected look while the editor has layers). The view lists what it leaves out (`PresetCollection.omitted`: looks without eye makeup, other features' parts); the Studio sends it, the host reads it back, and Check, Build and the manifest report each entry (`preset` omissions with "It has no eye makeup.", a new `part` omission kind). The original preset count includes looks without eye makeup; the packaged copy and its hash never carry the list, so eye-makeup-only collections keep their digests.
- **One parse per part (CORE-35).** Stored parts are parsed once on restore (the look memory reads the parsed look instead of parsing it again), `canonicalParts` and `part()` use in-memory bodies as they are, a `CollectionSession` copies its workspace instead of re-parsing it (a JSON copy: the workspace is JSON data, and the copy is faster than `structuredClone`), preset edits validate only the collection's looks, and SQLite `save()` looks up the previous revision by number instead of reading and parsing it.
- **Tests and boundaries (CORE-37).** The boundary tests forbid `compose/` imports outside the roots and walk imports transitively; the browser-globals check also catches `globalThis`, `sessionStorage`, `navigator` and `fetch(`. A preferences fixture (`withPreferences`) carries a schema'd `uiPreferences` with a dock layout and tour progress (the plain fixtures keep the unschema'd preferences their golden digests were captured with). The purity test covers all 29 kinds.

**Tests:** `tests/newer-data.test.ts`, `tests/alpha-library.test.ts` (the release's `list()` vendored from `60a60e9` in `tests/fixtures/alpha-0.1.0/`), `tests/package-freshness.test.ts`, `tests/registered-editing.test.ts`, `tests/package-omitted-looks.test.ts`, `tests/workspace-preferences.test.ts`, the boundary tests and the desktop store's `.bak` refresh.

**Real Build:** the four-preset fixture (Experiment 005's editor collection) built with WolvenKit 9.0.1 by the code before the cleanup (`3252338`) from the original file, and after it from the original file, the minimal writer's file and its collection-2 form. In each after-build, 79 of the 107 compared files are byte-identical to the before-build: all 16 unbundled archive members, the `.archive.xl`, 12 input and 12 verifier DDS, 16 baked rasters, `plan.json`, `compiled.json` and the app and customization JSON. The other 28 are the packed archive container (its own hash varies from run to run), logs, and WolvenKit JSON exports that are identical once their `Header` (export time and temporary path) is removed. The manifests' packaged-collection hashes equal the old code's for each input, and the minimal writer's bytes are unchanged.

**Browser:** a `?verify=1` session on a private port with its own data, settings and cache folders, seeded with a copy of the large fixture's stored workspace: after a Check (6 of 6 presets, layer omissions reported), `files.snapshot()` cost 0.04 ms per call; an opacity edit made the result stale and a new Check current; a layer add took its ID from the host; a form-control transaction made one Undo entry. With the selected look's history marked as a newer part schema and the page reloaded, the current draft (17 layers) opened with the protected message, edits were not autosaved and the stored workspace stayed byte-identical. With the small fixture, Save a copy and Export collection wrote `xfas/collection-1` (recipe-11, 10 and 7) and the library listed it.

**Cost** (same machine, large fixture of 6 × 16 layers with 80-step histories; medians, before → after): package freshness per repaint 68–75 ms → 0.011 ms in Bun (0.04 ms per `files.snapshot()` in a `?verify=1` browser session after a Check); `CollectionService` construction 70 → 27 ms (604 part parses → 0); draft snapshot 150 → 59 ms; restoring the stored workspace 41 → 38 ms (169 → 137 part parses, each part once); restoring workspace-1 unchanged (~80 ms); encoding 3.0 → 2.5 ms; SQLite `save()` of an unchanged collection 11.6 → 8.1 ms.

### Step 4 status

Built on 26 September in `claude/platform-step4`. Every user-visible Undo, Redo and History behaviour is unchanged (labels, jumps, dimmed Redo steps, Escape, "Older steps were not kept", the 80-step limit), as is the stored workspace of every look this build makes.

**What exists.**

- `platform/api/history.ts`: `HistoryLabel`, `HistoryEntryId`, `ChunkId`, `StoredLookEntry`, `LookHistoryData` (`xfs/look-history-1`), `HISTORY_LIMIT` (80) and `HistoryParts`. `PartCodec` gains optional `chunks` and `join` (eye makeup: the recipe header with its layer count in place of the layers, then one chunk per layer; `recipeChunks`/`joinRecipe` in `recipe.ts`, exact key order). `platform/api/document.ts` names a look's own memory `LOOK_MEMORY` (`"@look"`, never a feature ID).
- `platform/core/chunk-store.ts`: the content-addressed store (a 53-bit hash of the JSON text plus its length; a collision is detected by comparing the text and resolved with a suffix), reference-counted.
- `platform/core/look-history.ts`: `LookHistory`. Part and look steps keep each touched part's chunks as it was before (`null`: the look lacked the part); session-unique IDs survive Undo and Redo; labels and times stay session-only; at the limit a new step displaces the oldest, and discarding or undoing that step brings it back; Undo and Redo of n steps move chunk references and build the parts once; the Redo list lives here and its validity stays the host's (`AuthoringHistory`). `data()`, `fromData`, `fromBodies`/`fromSteps` (whole parts), `trimLookHistory`, `pruneLookHistory` and `lookHistoryBodies`.
- `platform/core/history-transaction.ts`: `HistoryTransaction`, the platform's Undo transaction for continuous edits (one checkpoint, named by the first change, commit, empty transactions leave no trace, Escape restores without Redo), with the two policies `GESTURE_TRANSACTION` and `CONTROL_TRANSACTION`. `AuthoringGestures` and `AuthoringControlEdits` keep only their input rules (source, layer identity, staleness) and name steps through the registered `gestures.label` and spec `label`.
- `PartRegistry` answers `HistoryParts` for every feature, reads either stored form (`readMemory`, `readFeatureMemory`) and writes the oldest that holds the history (`writeMemory`); `lookHistory(memory)` and `withLookHistory(memory, data)` read and set a look's history.
- `AuthoringDocument` holds the look's `LookHistory` (the trusted core passes the part registry and the live feature); `export()` gives its `LookHistoryData`; whole recipes are still accepted. `RecipeHistory` stays as a one-recipe look history for tests and tools.
- In memory, every look's history is `LookHistoryData` in its memory (`LOOK_MEMORY`), in the collection draft, removed presets and recovery drafts; `WorkspaceState.history`, `EditorMemory.history` and `DocumentState.history` carry the same data (whole recipes accepted as input).
- `workspace-budget.ts`: `fitWorkspace`, `WorkspacePlan`, `STANDARD_PLAN`, `MIN_SELECTED_HISTORY` (10) and `encodeWorkspacePlan`; `WorkspacePersistence` writes what `fitWorkspace` fits and, after a quota refusal, fits a smaller budget before reporting `full`. The fixed levels (`encodeWorkspaceAt`) remain for tools and the step-2/3 goldens.
- CORE-36: `AsyncSystemFamily`, `AsyncDescriptor`, `asyncActionTable` and `AsyncActionHandler` in `platform/api`; `Registry.routeAsync` and `asyncDescriptors`; `LIBRARY_FAMILY` and `FILES_FAMILY` in the composition list; `StudioApplication` binds them (`StudioOwnerRequests`) and routes `requestCapability`/`execute` and `fileCapability`/`executeFile` through the registry, which also derives the request, gesture and file catalogues. The collection application and the presentation's `files` port route through it.

**Decisions.**

- **One history per look in memory; the oldest form that holds it on disk.** A look's history is one `LookHistoryData` in memory, so switching presets, copying drafts and autosave captures no longer repeat every step's whole recipe. The stored workspace keeps using whole parts per feature (`partSchema`, `history`) whenever every step is a part step of one registered feature that the look had before each step, which is every history this build makes. So every build since workspace-2 reads what this build writes, exactly as before: the standard stored form of every fixture is byte-identical to the previous code's. Anything else (look steps, several features, a part added by a step) is stored as `xfs/look-history-1` under `LOOK_MEMORY`, and each registered feature's memory then names that schema with a non-empty history, so a build before step 4 refuses it as newer data and opens the workspace read-only (CORE-27) instead of dropping it. Checked with that build's reader, vendored from `0885ba6` in `tests/fixtures/pre-step4/`. Since the [cleanup after step 4](#cleanup-after-step-4), a workspace whose whole parts do not fit its storage budget is stored in the look-level form too (CORE-39).
- **Addresses follow the raw JSON**, key order included, so the "an entry equal to the top one adds nothing" rule compares exactly what it compared before. A migrated recipe's first read can order keys differently from a later read of the same content, so equal content may have different addresses after a store and restore; tests compare histories by the recipes they restore.
- **Labels, times and Redo stay session-only**, as before: restored steps read "Earlier change", and a preset switch or restore discards Redo.
- **Budgets keep the standard policy** (the selected look's full history, 5 steps of the others, recovery drafts and removed presets without histories), then trim in the design's order ([§3](#3-undo-history-and-persistence-budgets-core-02)). The browser budget stays 2,000,000 code units per key rather than the 3 MB first planned, because the normal and `?verify=1` keys share one roughly 5-million quota. The floor of 10 steps gives way only when the looks alone leave no room for them; the previous fixed levels dropped the selected look's whole history at their smallest.
- **Transactions keep their differing rules** as policies: a gesture that changed something keeps its step even if it moved back and Escape reverts after any change; a form control back at its start leaves no step and Escape reverts only when the content differs.
- **Look transactions exist in the look history, not yet in the app.** `LookHistory` records, undoes, redoes and stores look steps (tested with a synthetic second feature). `app.transaction(label, features, fn)` needs the live document to hold more than eye makeup's part, which the presentation facades bring (step 5); no current action needs it.
- **Library requests and file workflows are registered families** (CORE-36). Their capability answers are unchanged (a file workflow's stays uncoded, as its callers compare it), and the synchronous `capability`/`dispatch` still refuse their kinds as unknown commands.
- **The per-look "not editable in this version" state is not built in step 4.** Keeping a newer part writable-but-locked touches every writer (library rows, exported files, the package view, dirty checks, stash), the application's capability gates and the desktop store, and changes what a person sees (a workspace that opened read-only becomes editable except for some looks), which needs the step-5 presentation to explain. The look history makes it a local change: a locked feature's memory and history are carried verbatim like an unregistered feature's. Until then CORE-27's read-only view stays the behaviour that cannot lose data.

**Parity gates** (tests in `tests/look-history-parity.test.ts`; `tests/golden/look-history-parity.json` captured from the code before the change at `0885ba6` by `tests/fixtures/capture-look-history-golden.ts`): for the small, loose, large, damaged and preferences workspace-1 fixtures, every look's history (each preset, each restored removed preset, each recovery draft) walked by Undo to the start, Redo back and two jumps; the standard stored form, byte for byte, and its restore walked the same way; and a scripted session run from the workspace-1 file and from its stored form (dispatched edits, a layer add with a host ID, form-control transactions committed, cancelled and empty, gestures committed, cancelled and empty, Undo refused inside both, Undo, Redo, a cancelled control hiding and restoring Redo, jumps to the start, the middle, the end and the current step, an edit discarding Redo, a preset add, Undo refused in the new preset, a switch back and Undo across the add, a remove, Undo after it, a restore and Undo in the restored preset, then a reload). Every observation matches. The existing Undo, Redo, gesture and control tests pass unchanged; the step-2 and step-3 goldens pass with histories compared as the recipes they restore.

**Budget gates** (`tests/look-history.test.ts`): six presets of 16 layers with 80 one-layer steps each take 1,022,022 code units of look history in memory against 11,326,500 as whole recipes (9%), and store in 1,986,974 at the standard level (budget 2,000,000). Under a budget that holds the looks and little else, a reload keeps at least 10 steps of the selected look and Undo walks all of them. A gesture on one layer of a 32-layer look adds one chunk per step.

**Browser:** a `?verify=1` session on a private port with its own data, settings and cache folders (none of the maintainer's), seeded with a copy of the small fixture's stored workspace: an Opacity slider edit and a point drag became "Opacity" and "Move point"; Ctrl+Z twice, Ctrl+Shift+Z and the Redo button stepped through them with the undone steps dimmed; History jumps to Start and back; the trimmed preset showed "Oldest kept version" and "Older steps were not kept"; a new preset had no steps until a layer was added; back in the first preset Undo continued across the add and after removing the new preset; restoring it brought back its step; after a reload the selected preset's step and the others' were there, stored as `xfs/eye-makeup-part-1` whole parts.

**Cost** (same machine, the large fixture with 6 × 16-layer looks and 80-step histories, `tests/fixtures/bench-look-history.ts` on both checkouts; medians, before → after): in-memory draft 2,250,819 → 551,846 code units; draft copy 5.3 → 1.3 ms; draft snapshot 32 → 2.5 ms; preset switch 3.6 → 1.0 ms; a 40-step jump and back 6.8 → 0.65 ms; Undo plus Redo 0.66 → 0.47 ms; restoring the stored workspace 26–28 → 24 ms; encoding 2.6–3.0 → 2.7 ms; stored size 2,262,080 either way. Recording a step costs a little more (chunks are hashed): `dispatch(layer.setOpacity)` 0.21 → 0.26 ms, a three-call gesture 0.086 → 0.115 ms.

### Cleanup after step 4

The review of steps 3 and 4 (ledger findings CORE-38 to CORE-44) was fixed on 26 September in `claude/cleanup-platform2`. The standard stored form of every fixture, the look-history parity golden, the registry golden and library bytes are unchanged; the 0.1.0-alpha.1 reader tests pass.

**Decisions.**

- **Export does not need a library save (CORE-38).** Export collection and Export compiler plan save the draft first only when the library takes it (its minimal form is `xfas/collection-1`); a collection the library refuses (CORE-30) is exported from its draft snapshot without a save, and the message says plainly that it wasn't saved to the library and why. `savesFirst` in the file descriptors keeps meaning "may write a library revision".
- **The storage budget switches form before it drops steps (CORE-39).** `fitWorkspace` tries the standard plan in whole parts, then the same plan with `lookLevel` (`PartRegistry.writeMemory(memory, { lookLevel })`: every history with steps as `xfs/look-history-1`), and only then trims in the §3 order, in the look-level form unless it is not smaller. A workspace whose whole parts fit is stored exactly as before, so normal fixtures stay byte-identical; a switched workspace opens read-only in builds before step 4, as any look-level history does. On the reviewer's heavy look (six presets of 32 layers with 24-point Bézier paths and 8 warps each, 80 steps) the 2,000,000-unit browser budget kept 4 of the selected look's 80 steps and now keeps all 80 (the other looks' 5 steps each go first). The desktop host writes a look-level workspace back in that form (`storesLookLevelHistory`) instead of re-expanding it to whole parts.
- **Searches start from the last fit (CORE-41).** Autosave passes the plan its previous write fitted; each stage then gallops from that value instead of bisecting its whole range, and finds the same plan as a cold search (tested for every pairing of seven budgets). The whole-part standard form is still encoded on every over-budget save, because it decides whether the form older builds read still fits; on the heavy look that one encoding is most of the remaining cost. The desktop store parses the previous file at most once per save, and not at all when it is the text the store last wrote or checked; the new text once.
- **Restoring a history hashes each distinct chunk once (CORE-40)**; further references retain it.
- **A de-duplicated checkpoint names the top step (CORE-42).** When the top step already holds the content (a gesture moved a point and back), a labelled checkpoint relabels that step, since it is the one that undoes the coming change; a transaction without its own step names it at commit when the change is kept. `HistoryTransaction.cancel()` takes off only the step its own checkpoint added: `TransactionHost.revert(step)` gets undefined when the top step held the start, restores that content and keeps the step (`AuthoringHistory.revertTransaction`).
- **Every import form is scanned (CORE-43).** The boundary test sees `import … from`, `export … from`, bare `import "…"`, dynamic `import("…")` and inline `import("…").T`; the dynamic and inline imports already in `src/` break no rule, so no exception was recorded.
- **One editing path, host IDs only (CORE-44).** `RecipeActions` keeps only publishing (`commit`, `publishGesture`, `snapshot`, `subscribe`, `layerChoices`); its `dispatch` and `capability` are gone and their tests dispatch through `app.dispatch`. `applyRecipeAction`'s `field.add` and `editLayers`' add and duplicate refuse a missing ID instead of inventing one, and `editPresets` takes a new look's ID in the command (`newId`), which `CollectionSession` fills from its host's ID source; capability refuses an ID in use.

**Cost** (same machine, medians, before → after). Heavy look above: stored-workspace fit 61 → 40 ms, an over-budget autosave 57 → 37 ms, `LookHistory.fromData` 24 → 1.8 ms, document restore 24 → 2.8 ms, preset switch 35 → 13 ms. Large fixture with 32 layers: autosave at 2,000,000 units 22.7 → 6.1 ms (now stored look-level, 933,465 units, nothing trimmed; before 1,988,983 with 39 of 80 steps), desktop save 164 → 67 ms, `fromData` 4.8 → 0.39 ms, preset switch 7.8 → 3.3 ms. With 16 layers: autosave 8.4 → 3.3 ms, desktop save 92 → 38 ms.

**Tests:** `tests/alpha-library.test.ts` (export with the real library), `tests/look-history.test.ts` (the form switch, the heavy look, the reload gate on the look-level floor, hinted and cold searches, the transaction and the move-and-back, opacity, Escape session), `tests/workspace-persistence.test.ts`, `desktop/tests/workspace-store.test.ts`, `tests/architecture-import-boundary.test.ts`, `tests/application-actions.test.ts`, `tests/layer-stack.test.ts`.

**Step 5 needs:**

- The presentation facades (`features()`, `feature(id)`) and a live document per feature, so `app.transaction(label, features, fn)` can record look steps over several parts.
- The per-look "not editable in this version" state, with its notice in the presentation (see the decision above).
- Renaming the Undo policy `recipe` to `part` with the port (golden snapshot and presentation values).

### Step 5 status

Built on 26 September in `claude/platform-step5`, with the file moves in `claude/platform-step5-moves` ([below](#file-moves)). Appearance, exported archive members, the look-history parity golden, every stored workspace and library row of the committed fixtures and the step-2/3 goldens are unchanged, and the 0.1.0-alpha.1 reader tests pass. The registry golden changes by exactly the Undo-port rename (below).

**What exists.**

- **Presentation facades** (`studio-presentation.ts`). `port.features()` lists the registered features (`{id, label, stage}`); `port.feature(id)` gives a typed facade over that feature's own kinds (`kinds`, `capability`, `dispatch`, `limitsFor`, `choicesFor`; another owner's kind is refused) and `editable()`. Eye makeup's facade (`EyeMakeupFacade`) adds `view()`, the port's former `editor` (removed), its form-control transactions and its catalogues; any other feature's `view()` is a detached `{part, editor}`. A feature's view reaches its facade only through the `FeatureViewContext` the shell builds for it (UI-73); the shell itself still reads eye makeup's through `StudioRuntime.eyeMakeup` and `Frame`, recorded couplings with owners and removal criteria in the [boundary assessment](ui-architecture-boundary.md#open-work).
- **A live document per feature** (`platform/core/live-features.ts`). Every registered feature beside the one the editor document edits has a `FeatureDocument` for the selected look. `AuthoringDocument` reads and restores them in the look history (`topLook`, `revertLook`, `undoLook`, `redoLook`; the recipe is republished only when a step touched it), and `contentKey()` is the recipe's JSON while eye makeup is alone. Collection stash and display, the dirty check, the loose look and workspace restore carry them (`liveFeatureStates`, `withLiveFeatures`); with eye makeup alone none of this adds a field.
- **Generic feature handlers and `app.transaction(label, features, fn)`** (`StudioApplication`). A registered feature without a bespoke handler runs its spec's `capability` and `apply` over its live document and records one `part` step by its Undo policy. A look transaction opens one `look` step over the named parts (the platform's `HistoryTransaction` with the form-control policy), runs `fn` with per-action steps suppressed, keeps nothing when nothing changed and reverts without Redo when `fn` throws or returns a failure. `fn` is synchronous: a body returning a promise or other thenable is refused and reverted, and its type (`NotThenable<T>`) rejects an async body (CORE-48). Undo, any other owner's action, gestures, form controls and a nested transaction are refused inside it.
- **View contributions.** The shell's view (`studio-ui/views/shell.ts`) and eye makeup's view (`features/eye-makeup/view/contribution.ts`) each list their panels (ID, title, icon, purpose, catalogue order, shell slot, where a closed panel opens, whether it repaints lazily) and activity sources; each view binds its panels to factories keyed exactly by its IDs (`SHELL_PANELS`, `EYE_MAKEUP_PANELS`). The composition list (`compose/views.ts`, data only, and `compose/view-panels.ts`) joins them, and the root hands `STUDIO_VIEW_COMPOSITION` to `mountStudio`. The panel list, meta, factory layouts, closed-panel homes, lazily repainted panels and activity sources derive from the composed catalogue (`rt.views`); the shell maps slots to tab groups per size class and drops slots nobody fills. The header's authoring category reads the registered features.
- **The Undo port.** `recipe.undo`/`recipe.redo` are `history.undo`/`history.redo`, and the `recipe` Undo policy is `part` (`UndoPolicy = "none" | "part" | "transaction" | "recovery"`).
- **Spec fields.** `ActionSpec.units`, the platform's `inputLimits`, a feature spec's `limits(state, target, variant, base)` and `consequence(action)` (`platform/api/actions.ts`); eye makeup registers them in `features/eye-makeup/limits.ts`, the system families their units in `compose/system-families.ts`. `action-limits.ts` is gone; `action-consequences.ts` keeps only the platform's generic rule and reads the action's registered effect and override.
- **Per-look "not editable in this version".** `NewerPolicy` `keep`: in a collection draft (current, recovery, removed presets) or an imported collection file, a look holding a newer build's data (a part schema or layer model this build does not know, in its parts or its Undo history) keeps its stored parts verbatim with `Look.locked` (the plain reason, never stored) and its stored memory whole under `KEPT_MEMORY`. A `locked` key in stored or imported data is never trusted: readers lock a look only when its data needs a newer build, and in-memory drafts are validated again with `rereadCollection`, which keeps a lock found this session (CORE-45). Facades say it with `locked()` (UI-53). See the decisions below.

**Decisions.**

- **The Undo-port rename and its golden change.** The history family's actions and the feature Undo policy were still named after the eye-makeup recipe; since step 4 Undo is a look history across parts, so the names say what they do. `tests/golden/studio-registry.json` differs from its step-1 capture by exactly 3 + 3 occurrences of the two kinds and 45 `"undo": "recipe"` values that became `"part"`; order, scopes, payloads, effects and every other policy are unchanged. No stored data names an action kind or policy (labels, times and Redo are session-only; bindings and tours are code), so no workspace, library or layout changes.
- **`port.editor` is removed** rather than kept as an alias: its one consumer is eye makeup's view, which now reads its facade, and two names for one view would be migration debt. `port.authoring` keeps its eye-makeup-specific methods (form controls, `layerExport`, the catalogues) for other callers and tests; eye makeup's view no longer uses `port.authoring` at all (UI-52, [file moves](#file-moves)).
- **Slots, not trees, in contributions.** A panel names a shell slot (`collection`, `stack`, `stage`, `canvas`, `inspect` or `closed`) and a catalogue order; the shell owns the arrangement (group IDs and ratios per size class). The derived layouts equal the hand-kept pre-step-5 trees exactly, and a customised pre-step-5 layout restores unchanged (`tests/view-contributions.test.ts`). Panel IDs are grandfathered (eye makeup's six and the shell's eleven); new features use `<feature>.<panel>`, so `parseTree` now accepts a dot and the dock's tab-focus lookups use attribute selectors.
- **The view composition list is in `compose/`.** Until the file moves it sat in `studio-ui/views/` as a recorded boundary exception; the moves met its removal criterion and the exception is gone ([boundary assessment](ui-architecture-boundary.md#open-work)).
- **Live documents are sparse and silent while eye makeup is alone.** A feature beside the editor document is absent from a look until it is edited; Undo back to before its first edit removes the part again. Feature-wide memory of such features is carried unchanged (no current feature needs it).
- **A locked look is kept, never edited or written from the editor.** Selecting it shows an empty editor; every feature action, gesture, form control, look transaction and recipe or mask export is refused with `unavailable` and the reason; collection edits (rename, copy, move, remove, restore) work, and a copy is locked too. Every writer puts it back exactly: the workspace (parts and memory as read), collection files (always `xfs/collection-2`, since `legacyPreset` never writes a locked look as collection-1), the budget (a removed preset or recovery draft holding a locked look is never dropped to fit, and recovery drafts keep such removed entries; over budget, locked looks in recovery drafts and removed presets are written without their kept memory before any draft is dropped, and as the last resort those in the current presets too, their parts still verbatim: CORE-47) and the desktop store (which now reads with `keep`). The library never takes it: Save is refused up front and the store refuses it with the same plain message, so older rows are never rewritten; Export collection exports the draft unsaved through the CORE-38 path. The mod export omits it with "It was made with a newer version of XF Studio."; it never counts as a look to package, so a collection with nothing else refuses Check, Build and Export plan with a plain reason (PIPE-44), and an exported plan names it and lists it under `omitted` (PIPE-45). The presentation shows the reason in Layers with "Get the latest version" (a new `project-releases` link), marks the look in the Presets list and names it in the viewport hint strip. Removing a locked look and later pushing it out of the 20-deep removal stack, or out of the four-deep recovery queue by opening other collections, still drops it as it would any look: those are the person's own actions. The open and import confirmation says when the draft it would discard holds such a look, and offers Export collection for that draft (CORE-49).
- **What stays read-only.** A newer part in the loose editor (no collection draft), a workspace-1 draft or a newer workspace schema keeps CORE-27's protected read-only view. Library rows holding a newer look still refuse to open (they list by identity), because the library store reads strictly.

**Tests.** `tests/look-transaction.test.ts` and `tests/feature-facades.test.ts` (a synthetic hair module, `tests/fixtures/hair-feature.ts`, composed beside eye makeup: generic handler, part and look steps, Undo/Redo/jumps across both parts, empty and failing transactions, refusals inside them, per-look hair parts through preset switches, the stored workspace and a build without hair); `tests/view-contributions.test.ts`; `tests/spec-fields.test.ts` (`tests/golden/spec-fields.json` captured from `a0aa2b1` before the move: every kind and variant on five targets and every consequence, in six editor states covering each limit branch); `tests/locked-looks.test.ts` and the rewritten CORE-27 cases in `tests/newer-data.test.ts` (each case now locks exactly one look, stays writable and round-trips byte for byte through autosave; the desktop store keeps it); the boundary, registry, studio-ui logic, history-panel and style-guide tests.

**Browser.** A `?verify=1` session on a private port with its own data, settings and cache folders (none of the maintainer's), after a fresh bundle build. The verification workspace's existing dock layout (saved in an earlier session) restored without a warning. History floated, Warp closed and Motion revealed, then a reload restored the saved layout exactly. An Opacity edit and a layer add became "Opacity" and "Add layer"; Ctrl+Z, Ctrl+Shift+Z, the header Undo button and a History-row jump stepped through them with undone steps dimmed. F1 opened Help beside the inspectors, and the Getting started tour revealed Layers, spotlighted Add layer, advanced and stopped on Escape. An imported collection holding a look from a newer build opened with that look locked: Layers showed the notice with "Get the latest version", the viewport hint named it, Save and recipe export were refused with the plain reasons, the other look stayed editable, and after a reload the look was still locked and its stored part unchanged. The step-5 panels (Head, UV map, Layers, History, Presets, Colour & finish, Help) were screenshot-checked in the compact layout.

**Cost** (same machine, the large fixture, a scratch benchmark run against `main` at `481c3ad` and this branch; medians, before → after): restoring the stored workspace 85–87 → 84–86 ms, `dispatch(layer.setOpacity)` 0.20–0.24 → 0.19–0.20 ms, six `capability()` calls 1.4 → 1.5 µs, `limitsFor(glitter.setIrregular)` 0.9 → 0.9 µs, Undo plus Redo 0.37–0.39 → 0.35–0.39 ms, a preset switch 2.2–2.3 → 2.1–2.2 ms, encoding the workspace 12.4–12.9 → 12.3–13.5 ms: all within run-to-run noise.

#### File moves

Done on 26 September in `claude/platform-step5-moves`, as two commits so history follows the files: a pure move (`git mv` plus import path rewrites, nothing else), then the view and its composition.

**What moved where.**

- **`engines/layered-makeup/`** (pure: no DOM, Three, `node:` or feature code): the recipe model and its edits (`recipe`, `recipe-actions`, `layer-models`, `layer-stack`, `field-selection`, `bezier-path`, `path-edit`, `shape-transform`, `pigment-edit`, `pigment-strength`, `softness-edit`), finishes (`finish`, `finish-catalogue`, `finish-export`, `flake-field`, `glitter-model`, `direct-glint-settings`), the raster (`raster-processor`, `makeup-dependencies`) and the compiler (`preset-compiler`, `flat-mip-chain`, `route-mip-chains`, `plate-uv-window`). This is what lip or cheek makeup would reuse (§9).
- **`engines/layered-makeup/render/`** (Three allowed): the plate composite renderer (`makeup-stack`, `plate-composite`, `plate-blend`, `fresnel-tint`, `direct-glint`), which eye makeup's future `FeatureRenderer` wraps (step 7).
- **`features/eye-makeup/view/`**: its contribution (`contribution.ts`), Layers (`layers.ts`), the inspectors (`inspector.ts`), the UV panel (`uv.ts`, split out of the shell's `viewports.ts`), its factories (`index.ts`) and its facade-only actions (`actions.ts`).
- **`compose/`**: the view composition list (`views.ts`, the catalogue, data only; `view-panels.ts`, the factories and `STUDIO_VIEW_COMPOSITION`).

**What stays in `src/`, and why.** A module may go into `features/` only if nothing outside the composition reaches it (the CORE-29 rule). These eye-makeup modules are still imported by application, host, preview or package code, so each stays until the importer that blocks it takes it through a port or moves itself. The layered-makeup region is not among them: eye makeup's is in `features/eye-makeup/region.ts`, and the engine and these modules receive it as an argument (CORE-75).

| Module | Destination | Blocking importers | Step |
|---|---|---|---|
| `eye-makeup-model` (action and state types) | `features/eye-makeup/` | `StudioApplication`, `studio-presentation`, `authoring-eye-makeup`, `eye-makeup-descriptors` | 9: the application and port take feature types from the registry |
| `eye-makeup-descriptors` (eye makeup's descriptors) | `features/eye-makeup/` | `studio-action-descriptors`, whose table the application, presentation, studio-ui runtime and guidance read | 9: descriptors are read only from the registry |
| `authoring-eye-makeup` (the live document's port, `RecipeActions`) | the platform's generic feature handlers (`platform/core/live-features`) | `StudioApplication`, `trusted-authoring-core` | 9: the authoring document edits parts generically |
| `history-labels` | `features/eye-makeup/` | `authoring-document`, `authoring-history`, `authoring-gestures`, `authoring-control-edits`, `editor-actions`, `trusted-authoring-core` | 9: steps are labelled through the registered specs |
| `editor-actions` (the recipe's history owner) | `platform/core/look-history` | `authoring-document`, `authoring-history`, `authoring-gestures`, `authoring-control-edits`, `StudioApplication`, `trusted-authoring-core` | 9: the authoring document holds a look history over parts only |
| `recipe-schema` (recipe-file lineage, eye makeup's model registry) | `features/eye-makeup/` (part codec and lineage) | `library-store`, `studio-file-operations`, `workspace-state`, `authoring-document`, `editor-actions`, `preset-collection`, `package-bake` | 9: the library and file operations read eye makeup's part through its codec (the exporter reaches it from `features/eye-makeup/export/`, a listed legacy import) |
| `eye-plate-recipe`, `-cut`, `-cache`, `-service` | `features/eye-makeup/export/` (plate preparation) and `render/` | preview core, `character-detail-host`, `installation-registry`, the package build and server | 7 and 8 |
| `plate-lift`, `plate-reach`, `plate-uv-footprint-io`, `export-diagnostics`, `glitter-route`, `glitter-region`, `preset-collection`, `package-*` (the pipeline) | `features/eye-makeup/export/` | `collection-service` (the build plan export and result messages), `collection-store`, `eye-plate-service`, `eye-plate-prerequisite`, the localhost and desktop adapters | 9: the export host runs eye makeup's exporter since step 8; these modules move once the collection service, store and plate prerequisite stop reading them ([step 8 status](#step-8-status)) |
| `mod-verifier/` | `features/eye-makeup/verify/` | — | Moved in step 8 |
| `raster-client`, `raster-worker`, `glitter-measurements`, `browser-preview-device` | `features/eye-makeup/render/` (preview jobs on the platform's scheduler) | `studio-startup`, `browser-head-attachment` | Step 7 follow-up (eye makeup's devices, [step 7 status](#step-7-status)) |
| `uv-editor`, `surface-editor` | `features/eye-makeup/view/` and `render/` (editors of its surfaces; they then take the region's mirror, CORE-82) | `browser-viewport-device` | Step 7 follow-up |

**Boundary rules added** (`tests/architecture-import-boundary.test.ts`, `tests/studio-ui-boundary.test.ts`):

- Engines import only engines, `platform/api` and two pure helpers (`read-only`, `validation-issues`); only an engine's `render/` imports Three and the scene's shared material modules (`skin`, `skin-material`, `face-decal-material`, `linear-display`, until `platform/scene`), and no other engine module reaches a renderer or Three even through other modules; the pure engine reads no page or host global (CORE-78). No engine imports a feature, studio-ui, `compose/` or `platform/core`.
- studio-ui imports no engine (feature data reaches it only through the port), and the platform imports none.
- A feature's core imports only its allowlist (the platform API, engines, pure helpers, its own folder and the listed legacy modules) and reaches no platform internals, device, Node or Three even through other modules (CORE-77); it never imports its own view. Only a feature's `view/` may use the shell's presentation toolkit, and it follows the studio-ui import rules (types only from the core, plus the documented allowlist; no composition root, trusted service, live document or `compose/`).
- A feature view acts only through its facade (UI-52): its panel factories receive a `FeatureViewContext` with the facade, feedback, anchors, links and a viewport slot, and no runtime or port (UI-73); platform actions go through the context's `platform`, which refuses the feature's own kinds.
- The existing rules still hold: only `compose/` and the roots reach a feature, even transitively.

**Identity.** The suite, typecheck, bundle build and style guide are unchanged (the rebuilt guide is byte-identical). A Build of the finish board (experiment 016, no diagnostic knobs, WolvenKit 9.0.1, the built-in plate) before the moves, after the engine move and after merging `main` (the view commit changes presentation code only): all 21 unbundled archive members, the `.archive.xl`, `plan.json`, `compiled.json`, the baked rasters and the DDS inputs are byte-identical to the build from the code before the moves (and, after the merge, to `main`'s); only WolvenKit's JSON headers (export times, paths) and the archive container differ from run to run.

**What remains of step 5:** eye makeup's input bindings as view contributions (`KEY_BINDINGS` is shell code; its palette entries and layer menu are already its view's), tours, help topics and control anchors as contributions (§6a; the tours and `CONTROL_ANCHORS` still name eye makeup's panels, and `SHELL_VIEW` names them as Help's home), the shell's `Frame`/`rt.editor` reads of eye makeup's view, moving `port.authoring`'s eye-makeup methods behind the facade for their remaining callers, and a presentation action that uses `app.transaction` (for example "Reset look" once module #2 exists). The [boundary assessment](ui-architecture-boundary.md#open-work) lists each remaining shell coupling with its owner and removal criterion. The eye-makeup modules listed above as staying in `src/` move with the steps the table names.

### Step 7 status

Built on 26 September in `claude/platform-step7`, as reviewable commits: the scene port and eye makeup's renderer, then the move and split of `scene.ts`, then the real-GPU tests. Appearance, draw order, frame requests, stored data, the registry golden and every exported byte are unchanged.

**What exists.**

- **The scene port** (`platform/api/scene.ts`, types and one helper; not re-exported from the api index, so a feature's core never sees Three). `SceneHostPort` gives a renderer:
  - `renderer`, for its offscreen passes and capabilities (the host alone draws the scene);
  - `anchors()`: the head and the core record's surfaces by node key (`plate` is the expanded eye plate), read-only to a feature: the surfaces are anchors the platform never draws, which a feature copies for its own meshes;
  - `attach(object, { beside, morphs, rig })`: onto the head rig; with `morphs` its meshes (meshes added later included) follow the V's facial shapes; with `rig` its bones join the idle and blink, bones added under it later (a GLB that loads after the attach) included, and removed ones leave; the detach also runs on disposal;
  - `renderBand`: the feature's own draw-order slots (its factory's `renderSlots`, allocated in composition order from 10);
  - `supersede(parts)`: the resolved parts the feature replaces from now on, whole slots or only named creator options' components;
  - `skin`: the drawn skin's `light()`, `underlay(surface)` read on the drawn head, and a change subscription (once per change);
  - `character()`/`subscribeCharacter` (the V drawn: record identity and drawn slots), `lighting()`/`subscribeLighting`;
  - `requestFrame`, `onFrame` and `onContextRestored`.

  `FeatureRenderer` has `beforeDraw`, `setNormals`, `setWireframe`, `evidence` and `dispose`, all optional but `dispose`; one that throws is reported and skipped. `RENDER_ORDER` names the draw-order bands (feature plates from 10 up to the eye shell at 99), and `invalidating` wraps a renderer's mutators so each call requests a frame.
- **The scene host** (`platform/scene/`, 1,022 lines in four modules; `scene.ts` was 758 lines and is gone).
  - `scene-host.ts` (340 lines) owns the WebGL renderer and its context, camera, controls and camera input, the studio rig and lighting presets with their display, the stage, render on demand, resize, the device pixel ratio, context restores and disposal. It hands its devices the same flat API as before, less the makeup calls.
  - `head-rig.ts` (255) is the head: the core head, the record's surfaces, the default skin and fallback eye, the facial shapes every deforming mesh follows, and the rig motion (the game idle with the eye gaze joints, and the blink) behind an injectable `MotionLoader`.
  - `character-renderer.ts` (307) is the platform's character renderer (below).
  - `feature-renderers.ts` is the registry. It makes each feature's port, allocates its draw-order band and creates the composed renderers in order. It fans out `beforeDraw` (on drawn frames only, where the makeup composite used to be prepared), the display toggles and context restores, each guarded so one renderer's throw is reported once and skipped. It owns what each renderer attached, joined to the rig, subscribed to and supersedes, and releases all of it (and the renderers made so far) when one fails to create.
  - The core head, motion and LUT loaders are injectable (`loadCore`, `loadMotion`, `loadLut`), which is how the GPU probe runs the real host on a synthetic head.
- **Eye makeup's renderer** (`features/eye-makeup/render/index.ts`, `EYE_MAKEUP_RENDERER`, listed in `compose/renderers.ts`) is `makeup-stack` on the record's `plate` surface:
  - its layers and lit plate are attached beside the plate through the port;
  - the skin light and underlay are read through `skin`, again on each skin change;
  - the composite is prepared in `beforeDraw` and redrawn after a context restore;
  - normals and wireframe apply to its own materials; it has its `evidence()` (the page's `plateBlend` evidence);
  - it asks for 32 draw-order slots (one per layer) and draws them in its band, 10 to 41.

  Its `layers` (the stack's mutators, each requesting a frame, and its two readers) and `surface` form a `LayeredMakeupSurface` (an engine type). The composition lists it as eye makeup's layered surface (`STUDIO_LAYERED_SURFACES`), and the root hands it to the preview device (`connectScene`) and the on-head editor (`mountSurface(surface, hooks)`), so neither device nor `browser-head-attachment` names the feature; the root finds it with the typed `scene.feature(EYE_MAKEUP_RENDERER)`. Nothing eye-specific is left in the host: no stack, plate underlay, layer API or plate pick. `makeup-stack` takes a placement (`attach` and the band's draw order) and has `dispose()`.
- **Character details** render through the platform's character renderer. The host's `DetailLoader` (`scene.details.load(record, …)`, binding the host's anisotropy and skin placement) loads each resolved component with the material adapter for its chunk's template (`character-material-adapters.ts`). `setCharacterDetails` places the V: skin placement, draw order, facial shapes, the idle rig, bakes, eye optics and limits. The character-detail device loads through `scene.details` instead of reaching into the scene's adapter context and renderer.
  - **What is the platform's:** which V and which creator choices (the character context, `character-context.ts`), and drawing whatever it resolves, slot by slot. The `body` slot (26 September, [body rendering](../../knowledge/body-rendering.md)) is one more slot the same way: its parts load through `scene.details`, never follow the facial shapes, carry their own shapes from the record, join the idle rig, and have their own visibility and whole-body view on the host (`setBody`, `frameBody`).
  - **What a feature would own later:** a part it authors (a brow feature's own brows, a lips feature's lips) is drawn by that feature's `FeatureRenderer`, which tells the port what it replaces (`supersede`: a whole slot, or only the components of named creator options) whenever that changes. The character renderer then draws those parts as if the V had none there: hidden and not baked, the core head's default skin for a skin, the core eye for eyes. No feature supersedes anything yet.
- **More than one plate.** A second feature adds its own surface through `attach`, in its own render-order band (`renderBand`) beside eye makeup's plate: with `morphs`, or sharing an anchor's influences as eye makeup's layers do. The host has no per-surface code. `tests/scene-feature-renderers.test.ts` composes a synthetic cheek-plate renderer beside eye makeup's, and the GPU probe draws both.

**How the built port differs from the §5 sketch, and why.**

- **`attach` instead of `group(feature)`.** Eye makeup's layers must share the plate's parent and facial influences exactly, and the host must know which meshes follow facial shapes.
- **No `details`, `jobs` or `textures` on the port yet.** No renderer loads resolved components or schedules jobs of its own. They join when a feature first needs them (the first feature that contributes a resolved part).
- **No `sync` or `readiness` on `FeatureRenderer` yet.** Eye makeup's layers still arrive from its preview device (raster worker, coordinator, complete-bundle publication), and its readiness from the coordinator, unchanged. They move behind the renderer when the preview job policy becomes the feature's (§1); until then the device drives `layers` directly.
- **Picking.** The on-head editor (`surface-editor.ts`, an eye-makeup device still in `src/`) picks on the renderer's `surface` itself; `FeatureRenderer.pick` was dropped in the step 7 cleanup (UI-77) and joins the port with its dispatch.

**Decisions.**

- **Surfaces by record node.** The host knows the core record's `plate` node only as a surface key. "Load a save" now checks that the head and every record surface carry the saved facial targets. It used to check the head and eye makeup's layer copies of the plate, which share the plate's targets, so the check is the same whenever a layer exists and stricter when none does; the plate is a head cut that keeps every head target.
- **No initial canvases.** The host no longer takes the layer canvases at creation: the preview device sets them on `connectScene`, as it always did right after. The study tools set them through the renderer's `layers`.
- **Dead bookkeeping dropped.** The scene pushed and spliced the V's meshes into the core mesh list after its evidence had already been taken; nothing read it.
- **One renderer list.** `compose/renderers.ts` is the composition's renderer list. The root (`studio-startup.ts`) hands it to the viewport device; tools and tests are roots too. The verification page keeps its `plateBlend` evidence key (from eye makeup's renderer) and adds `features` (every renderer's evidence).

**Boundary rules added** (`tests/architecture-import-boundary.test.ts`):

- A feature's `render/`, and no other part of a feature, may import Three. It imports only `platform/api`, engines, Three and its own feature's core, never `platform/scene`. A feature's core never imports its `render/`.
- `platform/api` and `platform/core` never import `platform/scene`, and only `platform/api/scene.ts` names Three (type-only).
- `platform/scene` imports the platform, Three and the listed scene device modules only (the [recorded exception](ui-architecture-boundary.md#open-work)), never a feature, engine, `compose/` or the UI.
- The trusted-service, resolver and preview-derivation rules now also refuse `platform/scene`, and the rendering-boundary test (no per-mod identifiers) covers the host, its modules and eye makeup's renderer.

**Gates.**

- **Makeup screenshot parity** (`tools/scene-parity.ts`; fixed camera, idle off, `?verify=1` on private ports, the reference MO2 profile). Board 1, Board 2, Board 3, Shimmer over Glossy and the bare head, under both lighting presets at 1K and 2K: 20 frames per build. After each code commit every frame is byte-identical to one of two captures of the base (`81bcac9`). The two base captures differ from each other in 4 pixels, by one step, on the first creator frame; the step-7 captures fall on one or the other.
- **Ready at 1K and 2K** with Shimmer over Glossy: 210 and 777 ms (base 214 and 841 ms).
- **Frame on demand and dispose leak on a real GPU** (`tests/webgl-scene-host.test.ts`: headless Chrome, the real host on a synthetic head with eye makeup's renderer and a synthetic second plate).
  - An idle viewport draws no frame in 400 ms. One request, a burst of ten and a layer change each draw one frame. The idle draws while it plays (19 frames in 300 ms) and not when paused or off. `beforeDraw` runs once per drawn frame.
  - `renderer.info.memory`: 7 geometries and 15 textures empty; 9/27 with V A, the same with V B and with A again; back to 7/15 with no V. Each V is a real character record loaded through the host's detail loader (eyes on `eye.mt`, a face decal on `mesh_decal.mt`). Makeup layers take it to 7/24, and clearing them returns it to 7/15. Disposal removes the canvas and every renderer.
- **Browser** (`?verify=1`, own port, disposable data, the reference MO2 profile), the same script against this branch and the base:
  - the default V, the reference save, save B (piercings off and on, then a forced WebGL context loss and restore), the reference save again and the default V again;
  - the five studio setups, the creator preset, idle play and pause, Play blink and a closed blink.

  After the restore every layered chunk baked again at the same size, the plate composite drew and the resolved eye stayed. The 14 still frames are identical to the base build's, or differ by one step in at most 2 pixels. `renderer.info.memory` over the switches is the same in both builds (19/67 → 25/89 → 29/98 → 25/88 → 20/67; the extra geometry and missing texture after the context restore happen in both). With the idle playing, the main-thread frame median was 5.8 ms (base 7.3 ms, single runs) at a 16.7 ms interval. There were no console errors.
- Every existing test passes (the source checks follow the split; two fake scenes now offer the host's detail loader), and the goldens are unchanged.

**What remains.**

- **Step 8** (done, [step 8 status](#step-8-status)): exporters and verifiers; `mod-verifier/` moved into `features/eye-makeup/verify/`, and eye makeup's exporter in `features/eye-makeup/export/` wraps the package pipeline still in `src/`.
- **Eye makeup's devices:** its preview device (`browser-preview-device.ts`), raster client and on-head editor are still at the top of `src/`, driven through the renderer's `layers` and `surface`.
- **Port additions on demand:** `sync`/`readiness` and the port's `details`, `jobs` and `textures` wait for a feature that needs them; picking through the port (`pick` and its dispatch) waits for a second pickable feature.
- **Step 9** moves the scene host's listed device modules under `platform/scene/`.

**Parallelism.** Steps 1–4 are the format-changing core. Steps 5–6 and 7 can run in parallel after step 4. Step 8 needs only steps 1–2.

**Risks and mitigations:**

- **Merge conflicts with active worktrees:** the sequencing above, with file moves only in step 5 as a separate commit.
- **Appearance drift:** byte-parity gates, with no "close enough".
- **Stored-data churn:** canonical comparison, and budgets landing in step 4.
- **Performance:** no whole-look cloning; measure snapshot and capability cost against the current ~27 ms.
- **Presentation churn:** grandfathered IDs, and keeping the eye-makeup facade until the view moves.
- **Downgrade:** protected storage and the desktop `.bak`.

### Cleanup after step 7

Done 26 September in `claude/cleanup-step7`, before module #2: every finding of the step 7 review (PREV-89..98, CORE-86..89, UI-76..77) and CORE-82; see the [code-health ledger](code-health.md#fixed-in-claudecleanup-step7). Makeup screenshot parity and every golden are unchanged.

- **Supersedes** are the port's `supersede(parts)`, per component (a slot, or named creator options) and changeable at any time; a superseded part draws as if the V had none.
- **Rig motion:** `attach(…, { rig: true })` joins a feature's own bones to the idle and blink.
- **Draw order:** each renderer asks for `renderSlots` and gets its own band; eye makeup keeps 10 to 41.
- **Surfaces** are the platform's read-only anchors from every record node; the makeup stack draws a geometry of its own over the plate's buffers.
- **Registry:** failed creations and forgotten subscriptions leave nothing behind; a throwing renderer is reported and skipped; renderers are looked up by factory, typed.
- **Boundaries** for the scene host and renderers are transitive, types included; computed imports are refused.
- **Layered wiring:** the composition lists layered surfaces by feature (`STUDIO_LAYERED_SURFACES`), the head attachment connects a list of them, and the startup names no feature. The remaining limit for a second layered feature is the core: the authoring core edits one live feature, so only that feature's surface has a layer source (the preview devices take any `PreviewLayerSource`). Giving each layered feature its own live document is core work for module #2, not wiring.
- **Editors** mirror across the region's mirror line (CORE-82).

### Step 8 status

Built on 26 September in `claude/platform-step8`. Mod export runs through the export host with eye makeup as its first exporter; a default Build produces byte-identical archive members and the identical plan (gate below). What changed for a person is small: Check and Build answer per mod, the Mod package panel lists the mods the collection builds and lets the person rename one, and localhost Check runs in the same 15-second worker as desktop.

**What exists.**

- **The export contract** (`platform/api/export.ts`, types and small pure helpers):
  - the package plan: `ModPackagePlan` (`xfs/package-plan-1`), `parsePackagePlan`, `PackagePlanConflict` (a feature in two mods, code `namespace_duplicated`), `modNameIssue` (a name Windows can use as a folder; the "XF " prefix is never required) and `MERGED_MOD_NAME` ("XF Looks");
  - ArchiveXL fragments: `XlFragment`, `mergeXlFragments` (refuses an entry declared twice) and `archiveXlText` (CRLF; one gender entry as a scalar, scopes as lists, so one feature's fragment is exactly the text every eye-makeup candidate has had);
  - `FeatureExporter` (`present`, `plan`, `preflight`, `checkInputs`, `protectedInputs`, `buildInputs`, `build`, `accept`), `FeatureVerifier`, `FeatureExporterEntry`, `ResourceTools`, `VerifierTools`, `UnpackedView`, `ExportRefusal` and `PrerequisiteStale`;
  - results: `FeatureCheck` (a feature's looks, omissions, experimental finishes, notes, requirements, packaged hash and its own `details`), `ProductCheck`, `PackageCheckResult` (`xfs/package-check-2`) and `PackageBuildResult` (`xfs/package-build-2`);
  - `FeatureModule.exports` (`ExportInfo`: exporter ID, brand, selector label, own or vanilla selector), the browser-safe defaults a presentation shows before any Check.
- **The product planner** (`platform/core/package-plan.ts`, pure): `planProducts` (default product ID = collection ID, archive `xfs_c<collection>`; other products `xfs_m<product>`; names from the plan, else one feature's brand, else "XF Looks"; two mods of one collection never share a folder name), `normalizePackagePlan` (only what differs from the default is stored), the plan edits behind the actions (`rename`, `assign`, `split`, `merge`) with `packagePlanEditIssue`, `copyPackagePlan` (every mod of a saved copy is its own) and `collectionProducts`. `PartRegistry.exporting()` lists the composed features that have an exporter.
- **The export host** (`platform/export/`, Node):
  - `product-check.ts`: `checkProducts` plans the products and runs each feature's eligibility and plan (and, for Check, its preflight), then the product checks: no depot path or namespace shared by two features, the `.xl` fragments merge, requirements take the highest version per framework. A feature with nothing to package is reported (`kind: "feature"`) and left out; parts of features without an exporter are reported once as `part` omissions.
  - `product-builder.ts`: `runProductCommand`, the builder both hosts run in a child process (the CLI `tools/build_collection_package.ts`, bundled on desktop). It keeps every gate `package-build-service.ts` had (private-root containment, stable source, cancellation) and adds the product steps: each feature builds into its product's one staging tree, a pre-pack gate requires the tree to be exactly the union of the features' files, one WolvenKit pack per product, the product verifier, each feature's verifier on its subset and the exporter's `accept`, and promotion of every product only after all of them verified.
  - `product-verifier.ts`: `verifyProductArchive` copies the archive into an empty folder, hashes and unbundles it, and requires the members to be exactly the features' files and the `.xl` exactly the merged declaration.
  - `manifest.ts`: the `xfs/local-package-2` type (product ID, mod name and its source, archive, collection hash, the product's own omissions, requirements, and per feature its exporter and version, namespace, brand, selector, looks, omissions, experimental finishes, packaged hash, plan hash, details and verification) and `readPackageManifest`, the one reader for versions 1 and 2 (PIPE-09), with `duplicatedNamespaces`.
  - `check-runner.ts` and `product-host.ts`: `PackageHostService` and `runProductBuild`, the one package service both hosts run (PIPE-03): request normalisation (diagnostic knobs dropped), Check in a fresh worker (`tools/package_check_worker.ts`) with a 15-second deadline and its answer compared with the host's own plan, Build's readiness, prerequisites (`HostPrerequisite`: Check plans on what the last preparation left; Build prepares it), one bounded builder run with a 40-minute deadline, the one retry after a stale prerequisite, one table of error codes and HTTP statuses, and the result gate (`verifyProductBuildResult`: the builder's answer must equal the host's own `checkProducts` result, and each candidate folder must hold exactly its manifest and the two files it names) in the stage root and again in the candidate store.
- **Eye makeup's exporter and verifier.** `features/eye-makeup/export-info.ts` (exporter `eye-makeup/mesh-decal`, brand and selector label from `mod-branding`, its own selector, prerequisite `eye-makeup/plate`); `features/eye-makeup/export/` (`EYE_MAKEUP_EXPORTER` over the unchanged filter, plan, 32-pixel compiler preflight and resource builder, which now writes into the staging tree and leaves packing to the host; `plate-input.ts` reads the packaged plate's provenance and UV footprint); `features/eye-makeup/verify/` (the former `src/mod-verifier/`, moved; `verifyEyeMakeupBuild` checks its subset of an unpacked product, `verifyBuild` keeps the standalone layout for tools and tests, and `EYE_MAKEUP_VERIFIER` adapts it). `compose/exporters.ts` lists them for the host roots.
- **Hosts.** `src/package-server.ts` is localhost's adapter and HTTP gate, `desktop/build.ts` (`desktopPackageAdapter`) and `desktop/package.ts` the desktop's; `src/eye-plate-prerequisite.ts` is eye makeup's plate as a prerequisite on both. `package-build-service.ts`, `package-preflight.ts`, `package-result-verifier.ts` and `desktop/check-runner.ts` are gone.
- **The package plan in the collection.** `LookCollection.packagePlan`, read and written by the document codec in either collection schema (only a non-default plan; `xfas/collection-1` carries it as an optional field that 0.1.0-alpha.1 ignores), kept in workspace drafts, counted as an unsaved collection change, and edited by the collection actions `package.rename` (`modName`; empty goes back to the default), `package.assign`, `package.split` and `package.merge`. The library summary lists the mods the draft would build (`CollectionService.summary().products`, kept out of the draft summary so its parity goldens are unchanged). The Mod package panel lists them with a menu offering only what applies: Rename, "Use the default name" once renamed, and moving or merging features once the collection holds more than one exportable feature.
- **The install transport** reads both manifest versions, records each installed archive's feature namespaces in its receipt, refuses a candidate whose feature namespace another target's receipt already holds, and refuses a product of another mod than the one it places.

**Decisions.**

- **The feature plan stays product-independent.** `plan.json` is eye makeup's plan exactly as before, including `modName: "XF Eye Artistry"` (its brand); the product's mod name lives in the manifest and the results. Merging or splitting changes only the archive, `.xl`, folder and manifest.
- **Exporters read the collection as it came.** The platform reads only identities, each look's feature keys and the plan; each exporter reads its own part from either schema. So a collection-1 file keeps its recipes' own schemas (the finish board's recipe-11 presets stay recipe-11), which is what keeps the plan and every byte identical.
- **The Studio sends its draft's stored form** (`writeMinimal`, collection-1 whenever every look is eye makeup, as before) with the plan, instead of eye makeup's view; a stored look whose eye makeup needs a newer build is left out with the existing reason.
- **One Check path.** Localhost ran Check through the CLI child with a 2-minute deadline; both hosts now use the worker with the desktop's 15-second deadline, and one code table (`package_check_timeout` 504, `package_build_busy` 409 and so on). The stale-plate retry became a generic stale-prerequisite retry (`package_prerequisite_stale` with the prerequisite's ID).
- **Nothing is written before the inputs are known good.** The builder checks the plate's provenance before it creates the build root (it used to create it first).
- **A derived mod name is not frozen into the plan at first Build yet.** Writing it would mark the draft changed after every first Build, against "your collection is unchanged"; with one exporting feature the name cannot change anyway. The planner honours a name in the plan, and the actions write one; freezing, or the host remembering built names, is decided when module #2 exports.
- **No per-feature selector label override yet.** Nothing needs it with one exporter, and the verifier would have to accept non-"XF" labels.
- **ArchiveXL lists.** A merged declaration writes a gender's several customization resources as a YAML list. ArchiveXL's reading of that form is untested in game (the §6 validation items).

**Gates.**

- **Byte identity.** The finish board (experiment 016, no diagnostic knobs) built by `main` at `2ab6a74` and by this branch with the same CLI arguments: WolvenKit 9.0.1, game 2.31, the built-in plate from one cache entry (key `d7563f9f…`), private build and dist roots. Compared by a scratch script (now re-runnable as `tools/compare-package-candidates.ts`, [cleanup after step 8](#cleanup-after-step-8)): a fresh WolvenKit `unbundle` of each promoted archive gives 21 members, all byte-identical; the `.archive.xl` is identical; the staging trees (21 files), the baked folder (23 files including `plan.json` `8d1fc912…` and `compiled.json`), the 17 DDS inputs and the app and customization JSON are identical; the plate's mesh and morph JSON are identical once WolvenKit's `Header` (export time) is removed. Only the archive container differs (its index records build times). The version-2 manifest records the same archive name and namespace, mod name, collection hash, packaged hash, looks and routes, omissions, experimental finishes, lifts, plate UV footprint and provenance, `.xl` hash, 21 verified files and limits as `main`'s version-1 manifest.
- **Two products** (`tests/product-export.test.ts`, a stub lips exporter beside eye makeup): merged by default into one "XF Looks" archive with one pack, one merged declaration and each verifier on its subset; split by the plan into two verified products (`xfs_c…` and `xfs_m…`) whose eye-makeup report equals the merged one.
- **Namespace duplication** is refused in the plan, at Check (two features claiming one namespace or depot path) and at install (a namespace another installed XF mod holds).
- **Check and Build agree:** the host's result gate requires the builder's answer to equal its own plan of the same snapshot, and Check with a prepared plate plans exactly as Build (`tests/product-builder.test.ts`).
- **Partial export** rules hold: omissions are listed per feature and product (whole looks decided once across features since the [cleanup after step 8](#cleanup-after-step-8)), a feature with nothing left is reported and the others still build, nothing usable left is refused.

**Tests:** `tests/product-plan.test.ts`, `tests/product-builder.test.ts` (the former build-service tests), `tests/product-export.test.ts`, `tests/product-host.test.ts`, `tests/package-plan-actions.test.ts`, `tests/package-server.test.ts`, `tests/package-plate.test.ts`, `tests/mod-install-transport.test.ts`, `desktop/tests/build.test.ts`, `desktop/tests/package-check.test.ts`, the boundary and registry tests, and the collection, file-operation and presentation tests on the new result shape (`tests/fixtures/package-results.ts`). The registry and spec-field goldens changed by exactly the four `package.*` kinds.

**Browser:** a `?verify=1` session on a private port and data folder: the Mod package panel listed "XF Eye Artistry · Eye makeup"; its menu offered only Rename; an invalid name was refused in place; "XF Night Looks" was applied, Check answered through the localhost worker with that mod name, the name survived a reload, and "Use the default name" restored "XF Eye Artistry". No console errors.

**What remains.**

- The eye-makeup pipeline modules in `src/` move into `features/eye-makeup/export/` once the collection service, store and plate prerequisite stop reading them (the exporter's legacy list names each).
- The name freeze and selector label overrides above; a UI for moving features waits for a second exporting feature (the actions and menus exist).
- The install transport still places one mod per transport (its MO2 folder); journaled "Replace both" for a move needs an installer, which the product does not have.
- In-game proof of a merged declaration ([§6](#moving-a-feature-between-mods-without-breaking-saves) items (a)–(d), on the [validation card](../../docs/validation.md)) when a second exporter exists.


### Cleanup after step 8

Done 26 September in `claude/cleanup-batch2`: the step 8 review's CORE-91 and PIPE-88..95; see the [code-health ledger](code-health.md). Package bytes are unchanged: nothing here touches a feature's plan, the resource builder, the pack or the verifier, and the ordinary-package golden (finish-board maps included) still matches. What changes is reporting, identities of a saved copy's split-off mods, and refusals.

- **Plans this build can't use** (CORE-91): `readPackagePlan` classifies a stored plan without throwing. A later `xfs/package-plan-N` schema, or a `xfs/package-plan-1` plan with any field this build doesn't know (such as the planned `selectorLabels`), is `newer`; anything else unreadable is `damaged`. The rule is deliberately "unknown field means newer": such a plan is kept whole rather than stripped of what this build doesn't understand. The document codec keeps it opaque (`KeptPackagePlan`, the stored value exactly) in the collection, the library form and workspace drafts write it back unchanged, and the collection opens and saves. `CollectionActions.packagePlanIssue()` and `CollectionService.summary().packagePlanIssue` carry the plain message, the Mod package panel shows it in place of the mods, every `package.*` action and the package request refuse with `unavailable`, and the export host refuses with `package_plan_newer` or `package_plan_damaged` (422). Save as copy keeps a kept plan as it is.
- **Omissions decided once** (PIPE-88): `checkProducts` decides whole-look omissions across every feature. A look is left out whole (a `preset` in the result's `omissions`) only when no feature packages anything of it, with the reason of the feature that reported it, else `NOTHING_PACKAGED_REASON`. A feature's own list keeps its layers and its part of a look another feature packages; eye makeup no longer reports a look without eye makeup, or the whole looks an older request's collection-1 view already left out (the host reads those from the request's `omitted`, parts included). `ProductCheck.omissions` holds each product's own share: its features left out whole and the whole-look and part omissions of the looks its features package or report; one no built product owns goes to the first product. The manifest's top-level `omissions` is that share (it used to copy the collection's into every product), and the result gate compares it. `resultOmissions` flattens a result for presentations, each feature's entries labelled when several features export.
- **Saved copies** (PIPE-89): `copyPackagePlan` replaces `renameCollectionId`: the copy's default mod takes the new collection ID and every split-off mod a fresh UUID, names and moves kept.
- **Mod names** (PIPE-90, PIPE-91): the candidate's mod name flows through the install transport (checked as a folder name), the diagnostic stage (its plan records `modName`) and promotion (its record names the mod); the transport refuses an MO2 folder of that name that it didn't create; staging and promotion refuse a build any installed mod already holds part of, found from the resources each installed `.archive.xl` declares rather than from one stage's receipts. The planner's clash suffix is validated as a mod name (a number when "(collection name)" isn't valid), and renaming a mod to another mod's name is refused.
- **All or nothing** (PIPE-92): the builder takes back promoted products when one can't be moved into place, and the host checks every destination in the candidate store before moving any and removes the moved ones on a failure.
- **Plain refusals** (PIPE-93): `PackagePlanConflict` names the feature by its label; `package_conflict` messages name features by label, with the namespace, depot path or ArchiveXL detail in `ExportRefusal.detail`, which the Check worker, the builder's log line and the host log carry and the page never shows.
- **Localhost setup** (PIPE-94): unreadable Local setup (settings and backup) lets localhost Check plan with the defaults, as desktop does, and answers Build with a JSON refusal (`package_setup_unreadable`, 503) in plain words; any other failure to make the adapter is a JSON refusal too.
- **Gates** (PIPE-95): the real eye-makeup verifier's merged branch is tested beside a second feature's members and declaration (`tests/mod-verifier.test.ts`); the export fixtures now hold single-feature looks; the result gate checks each feature's `planSha256` against the host's own plan; and `tools/compare-package-candidates.ts` is the re-runnable byte-identity gate (members after WolvenKit unbundling, `.archive.xl` bytes, manifests, and intermediate folder pairs with `--tree`).

## 9. How module #2 plugs in

**Character (CC controls and presets).** It validates parts that aren't exported and the resolver-consumer path.

- **Part.** `xfs/character-part-1` stores option state **by name**, never by index: `{ bodyGender, options: Record<optionName, { definition } | { region, target } | { choice: localizedName }> }`.
- **Actions.** `character/option.set`, `option.reset`, `importFromSave` (a look transaction).
- **Capability.** Validated against the merged character-creator catalogue; refused with `asset_unavailable` until it loads.
- **Rendering.** No renderer of its own. `characterInput(part)` feeds `CharacterContextService`, and the generic character renderer draws the result.
- **View.** One data-driven inspector grouped by creator groups, with no per-mod branches.
- **Export.** None yet; save write-back is a later export target.
- **Default.** Workspace-level preview context; "Include character in this look" stores the part.
- **Files touched outside `features/character/`:** only the `compose/` feature lists.

**Lip makeup** validates the export side. It imports `engines/layered-makeup` and supplies:

- a `LayeredMakeupRegion` (its layer models, starter and new-layer contours, mirror axis and centre, fine-Glitter scope, texture grids and wording), as eye makeup's `features/eye-makeup/region.ts` does;
- its own part schema;
- a renderer on the lips decal surface from the resolver, asking for its draw-order slots (`renderSlots`), listed in `STUDIO_LAYERED_SURFACES`, and superseding the V's own lips decal only (`supersede([{ slot: "face", options: [<the lips option>] }])`);
- an exporter with the lips selector, default brand "XF Lip Artistry".

With the default plan, a collection containing both features builds one "XF Looks" mod with two selectors. Splitting lips out is a plan edit and a rebuild.

If either module needs a platform change beyond the composition list, the design has failed; record the gap in the [boundary assessment](ui-architecture-boundary.md).

**Modules without a part.** Poses (V-centric, no document part) and World (not about V, with its own `location` scene kind) are Studio modules that register no feature module. They plug in through the [view graph design](view-graph-design.md#5-placeholder-modules)'s module manifest, view contributions, view tools and scene kinds, under the same acceptance rule: only the `compose/` lists change outside their folders.

## Decisions

Resolved with the maintainer on 25 September 2026:

- **Packaging:** merged by default, user-splittable.
- **Defaults:** sensible and overridable everywhere.
- **Selectors:** a custom selector only where best (eye makeup, because of the plate); otherwise contribute choices to vanilla option sets.
- **Brand prefix:** "XF " is a default name prefix, not an enforced rule. XF Studio is free and open source.
- **Timing:** the platform migration starts after the first alpha rather than gating it.
