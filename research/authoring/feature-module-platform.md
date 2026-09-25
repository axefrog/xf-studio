# XF Studio feature-module platform

**Status:** accepted design, 25 September 2026; implementation scheduled per §8. It answers the [code-health](code-health.md) finding CORE-03 (High) and the related findings PIPE-12, CORE-08, CORE-09, CORE-02, UI-02, UI-05 and UI-11. The [architecture contract](architecture-contract.md) still governs. Code paths are relative to `projects/xf-studio/authoring/src/` unless a link says otherwise.

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
| Scene host: renderer, camera, lights, frame loop, picking dispatch, dispose | Renderer for its parts; picking inside its own objects |
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
src/features/<id>/index.ts   FeatureModule (pure core)
src/features/<id>/view/      presentation contribution (studio-ui boundary rules)
src/features/<id>/render/    renderer contribution (Three allowed)
src/features/<id>/export/    exporter (host only)
src/features/<id>/verify/    independent verifier (host only; may not import export/ or engine compilers)
src/compose/             composition roots: core, browser devices, views, host exporters
```

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

- **Part 1.** `xfs/eye-makeup-part-1` is the current in-memory recipe, verbatim. It is the lossless target of `parseRecipe`.
- **Part 2.** `xfs/eye-makeup-part-2` drops the recipe-level model gate. Each layer's optical block is validated by a **model registry** keyed by its own model ID, so a new Glitter model registers an ID instead of bumping a schema.
- **Invariant.** "Version the model whenever appearance changes" now applies per layer model.
- **Structural changes.** A part-schema bump is reserved for structural changes.

### Migration on read, with no appearance change

| Input | Reader | In memory | Writes |
|---|---|---|---|
| `eye-artistry/recipe-1`, `xfs/recipe-2`…`10` files | eye-makeup `lift` → unchanged `parseRecipe` → part-1 → part-2 | new preset with an eye-makeup part | nothing until the user saves |
| `xfas/collection-1` (files, SQLite rows, drafts) | platform reader wraps each `preset.recipe` as an eye-makeup part envelope | `xfs/collection-2` | a new SQLite revision only on explicit save; old rows never rewritten |
| SQLite v2 | unchanged tables; the JSON rows describe their own schema | — | no DDL change |
| `xfas/workspace-1` (editor, histories, recovery drafts) | histories become eye-makeup part history; editor memory becomes eye-makeup editor state | `xfs/workspace-2` | same key; desktop keeps `workspace.v1.bak` |

Two defects must be avoided:

- **Revision churn.** `collection-store.ts` `save()` compares raw stored JSON with parsed values, so after the upgrade every unchanged preset would get a new revision on first save. Compare both sides as `serialize(parse(x))`, in the store and in the `CollectionService` baselines.
- **Downgrade.** Older builds can't read version 2. Protected storage refuses to overwrite an unreadable workspace, and desktop keeps a `.bak`. As a default, "Export recipe" for one eye-makeup part still writes the minimal `xfs/recipe-N`, so sharing with older builds still works.

**Parity gates** (required before each format step merges):

1. Every fixture schema (recipe-1…10, collection-1 and the reference 2K recipe where locally available) is read through the old and the new path. The results must match: byte-identical `raster()` masks at 512/1K/2K, identical `compileFlatPreset` output, identical `planCollection` identities.
2. A SQLite v2 fixture: list, get, save and save again. Old rows stay byte-unchanged, and unchanged presets keep their revision.

## 3. Undo, history and persistence budgets (CORE-02)

**Scope.** One linear history per **look**, across its parts. Ctrl+Z undoes the last change wherever it happened. Entries record only the parts they touched:

```ts
type HistoryEntry = { label?: HistoryLabel; scope: "part" | "look";
  before: Readonly<Record<string /* FeatureId */, readonly ChunkId[]>> };
type LookHistory = { entries: HistoryEntry[]; chunks: Map<ChunkId, string>; trimmedBefore: boolean };
```

- **Part edits.** Actions, controls and gestures create `part` entries.
- **Look transactions.** `app.transaction(label, features, fn)` creates one `look` entry containing several parts. Examples: "Apply character from save", "Paste look", "Reset look".
- **Redo** keeps today's semantics: session-only, and valid only while the look is exactly what the last Undo produced. A gesture owns the transaction, forms can't begin inside a gesture, and Undo is refused while a transaction is open.

**Storage.** Each part is split by `codec.chunks()` into chunks stored once per look, addressed by content hash with collisions detected by comparing content. Eye makeup chunks one per layer plus a header. A gesture on one layer of a 32-layer look then costs one layer chunk per entry. A benchmark gate records the real saving at six presets × 80 steps.

**Budgets.** `fitWorkspace(state, budget) → { state, trimmed }` runs before every write. The UI can then say "Older steps were not kept".

| Store | Budget (default) | Trim order |
|---|---|---|
| Browser workspace (~5 MB localStorage quota) | 3 MB serialized | 1. recovery-draft histories (content kept); 2. non-selected preset histories, oldest first; 3. the selected preset's history, oldest first, keeping ≥10 steps |
| Desktop `workspace.json` | 16 MB cap, 12 MB for history | same order |
| A single part | `codec.maxBytes` (eye makeup: 2 MB) | refused at parse or edit time with a `limit` issue |

## 4. Routing and the registry-derived catalogue (CORE-03, CORE-08)

**Commands.** Platform families (collection/preset, history, camera/preview, motion, quality, saved-V, files, host detection) keep flat `kind` IDs, registered as *system families* in the same table shape as features. Feature commands use an envelope:

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

**Presentation port.** It gains `features()` and `feature(id)`, a typed facade with `view`, `capability`, `dispatch`, `limitsFor`, `choicesFor`, `control*` and gesture methods. Today's `port.editor` becomes the eye-makeup facade's `view()`.

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
| Folder collision with another XF product | name + " (collection name)" | rename |
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

## 7. Boundary enforcement

Add these to `tests/architecture-import-boundary.test.ts`, with a recursive walker:

1. `features/<a>/**` never imports `features/<b>/**`, `platform/core|scene|export/**`, `studio-ui/**`, `compose/**` or entry points. It may import `platform/api/**`, `engines/**`, pure shared libraries and its own folder.
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
| 1 | `platform/api` types, `Registry`, system families; the eye-makeup core module registers the existing tables moved as-is; `StudioApplication` derives kind sets and Undo policy from the registry, routes by owner with an exhaustive check, removes both fallbacks, returns structured codes | golden registry/descriptor snapshot equals the pre-change one; application tests unchanged | 3 | CORE-08, CORE-15, part of CORE-03 |
| 2 | Look/part model, `collection-2` reader/writer, eye-makeup part-1 codec; `CollectionSession`/`CollectionService`/store on parts; canonical comparison in `save()` and baselines; `workspace-2` with per-feature editor memory | parity gates (§2); SQLite fixture; workspace-1 fixtures restore identical state | 5 | CORE-03 (data), CORE-05 |
| 3 | Part-2 with the per-layer model registry; `selectGlitterModel` stops touching the schema; minimal-schema recipe export | parity gates; every Glitter fixture renders identically | 2 | CORE-09 |
| 4 | `LookHistory` (part and look entries, chunk store, Redo), generic gesture and control transactions, `fitWorkspace` budgets | existing Undo/Redo/gesture/control tests; size benchmark under budget; reload keeps ≥10 steps | 4 | CORE-02, part of CORE-11 |
| 5 | Presentation `features()`/`feature(id)`; eye-makeup panels move to `features/eye-makeup/view`; layout, panel meta and activity sources from contributions; `recipe.undo` → `history.undo`; `git mv` of eye-makeup files into `features/eye-makeup` and `engines/layered-makeup` (import rewrites only) | studio-ui logic and boundary tests; style guide rebuilt; `?verify=1` with a saved dock layout restored | 5 | CORE-03 (routing), UI-10 |
| 6 | One `compose/` root used by `studio-main` and `port-smoke`; legacy `main.ts` wraps it until retired | port-smoke acceptance; bootstrap tests | 2 | UI-05 |
| 7 | Scene-host split, `FeatureRenderer`, `CharacterContextService`, `DetailLoader`, material adapters; eye makeup's renderer wraps `makeup-stack`; brows, lashes, hair and piercings render through resolved components | `?verify=1` Ready at 1K/2K; makeup screenshot parity; dispose leak test; idle frame-on-demand test | 7 | UI-02, UI-11, PIPE-11 (preview) |
| 8 | `FeatureExporter`/`FeatureVerifier`, product planner, `runProductBuild` for both hosts, `local-package-2`, transport reading version 1 and 2, package-plan actions and panel | default-product Build **byte-identical** archive members and identical plan; two-product synthetic test with a stub exporter; namespace-duplication refusal test | 6 | PIPE-12, PIPE-09, PIPE-03 |
| 9 | Strict boundary tests (§7); update the contract, invariants, catalogue and pipeline guide (with visual diagram review) | link check; diagrams inspected | 2 | — |

**Parallelism.** Steps 1–4 are the format-changing core. Steps 5–6 and 7 can run in parallel after step 4. Step 8 needs only steps 1–2.

**Risks and mitigations:**

- **Merge conflicts with active worktrees:** the sequencing above, with file moves only in step 5 as a separate commit.
- **Appearance drift:** byte-parity gates, with no "close enough".
- **Stored-data churn:** canonical comparison, and budgets landing in step 4.
- **Performance:** no whole-look cloning; measure snapshot and capability cost against the current ~27 ms.
- **Presentation churn:** grandfathered IDs, and keeping the eye-makeup facade until the view moves.
- **Downgrade:** protected storage and the desktop `.bak`.

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

- a region config (UV bounds, mirror axis, starter shape);
- its own part schema;
- a renderer on the lips decal surface from the resolver;
- an exporter with the lips selector, default brand "XF Lip Artistry".

With the default plan, a collection containing both features builds one "XF Looks" mod with two selectors. Splitting lips out is a plan edit and a rebuild.

If either module needs a platform change beyond the composition list, the design has failed; record the gap in the [boundary assessment](ui-architecture-boundary.md).

## Decisions

Resolved with the maintainer on 25 September 2026:

- **Packaging:** merged by default, user-splittable.
- **Defaults:** sensible and overridable everywhere.
- **Selectors:** a custom selector only where best (eye makeup, because of the plate); otherwise contribute choices to vanilla option sets.
- **Brand prefix:** "XF " is a default name prefix, not an enforced rule. XF Studio is free and open source.
- **Timing:** the platform migration starts after the first alpha rather than gating it.
