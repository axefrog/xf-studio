# XF Studio feature-module platform

**Status:** accepted design, 25 September 2026; implementation per §8, with step 1 (registry and routing) and step 2 (the look/part document model) built on 26 September. It answers the [code-health](code-health.md) finding CORE-03 (High) and the related findings PIPE-12, CORE-08, CORE-09, CORE-02, UI-02, UI-05 and UI-11. The [architecture contract](architecture-contract.md) still governs. Code paths are relative to `projects/xf-studio/authoring/src/` unless a link says otherwise.

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
| `eye-artistry/recipe-1`, `xfs/recipe-2`…`11` files | eye-makeup `lift` → unchanged `parseRecipe` → part-1 (→ part-2 from step 3) | new preset with an eye-makeup part | nothing until the user saves |
| `xfas/collection-1` (files, SQLite rows, drafts) | platform reader wraps each `preset.recipe` as an eye-makeup part envelope | `xfs/collection-2` | a new SQLite revision only on explicit save; old rows never rewritten. Rows and exported files use the **oldest schema that holds the content exactly** (see [step 2 decisions](#step-2-status)) |
| SQLite v2 | unchanged tables; the JSON rows describe their own schema | — | no DDL change |
| `xfas/workspace-1` (editor, histories, recovery drafts) | histories become eye-makeup part history; editor memory becomes eye-makeup editor state; `glitterChoices` becomes eye makeup's feature memory | `xfs/workspace-2` | same key; desktop keeps `workspace.v1.bak` |

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
- **Read model.** The History panel already reads `authoring.historyTimeline()` (`HistorySnapshot`: opaque step IDs, `HistoryLabel`s, optional times, `done`/`undone` state, current index, redo count, `trimmed`, `startId`) and jumps with `history.jumpTo {entryId}`. Neither exposes recipes, so the look history publishes the same shape: one step per `HistoryEntry` (a look transaction is one step), `trimmed` from `trimmedBefore`. It may add optional fields such as the touched features, never rename or remove the current ones.

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

**Built so far** (`scene.ts` is not split yet): render on demand in `src/render-scheduler.ts`, with the scene's `requestRender` and `onFrame` as the future port's `requestFrame` and `onFrame`; the skin placement adapter in `src/head-skin-placement.ts`, which returns limit codes (`src/detail-limits.ts`) that the presentation words; and the scene's evidence projections in `src/scene-evidence.ts`.

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

## 6a. Guidance: tours, spotlights and help (v1 built)

A data-driven guidance system serves first-run onboarding, on-demand "show me how" tours and per-release "what's new" tours.

**Status (v1, `claude/guidance`, 25 September).** Built as presentation modules in [`src/studio-ui/guidance/`](../../projects/xf-studio/authoring/src/studio-ui/guidance/) with one-line registration hooks in the panels and the shell. The design below still describes where it goes next; v1 differs only where noted.

- **Anchors** ([`anchors.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/anchors.ts)): a typed catalogue of control anchors (`header.save`, `header.package`, `header.history`, `header.help`, `header.palette`, `layers.add`, `layers.list`, `uv.canvas`, `head.view`, `finish.color`, `finish.picker`, `presets.list`, `history.list`, `package.check`), each naming its owning panel, plus one `panel.<id>` anchor per panel. `AnchorRegistry` lives on `StudioRuntime`; panels register elements as they build them. Rectangles are cut to what their scrolling panels show.
- **Runner** ([`engine.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/engine.ts)): `GuidanceService`, a DOM-free presentation service with a typed snapshot and the actions `guidance.startTour`, `guidance.next`, `guidance.back`, `guidance.skip` and `guidance.finish` (`GUIDANCE_DESCRIPTORS`: scope `guidance`, effect `view`, no Undo). `advanceWhen` is evaluated against read-only facts relative to the step's start (`layer.added`, `recipe.edited`, `finish.changed`, `color.changed`, `preset.added`, `lighting.changed`), panel visibility, capabilities, or `any` of these.
- **Buttons** carry a `TourCommand` dispatched through the ordinary validated paths: `studio` (`rt.dispatch`), `studio.activeLayer` (the same, with the active layer's ID filled in when pressed), `file` (`rt.file`), `previewSetup`, and `panel` (the existing dock reveal). Their availability is the port's own capability, and an unavailable button's reason is written in the card.
- **Missing anchors.** A hidden control whose panel is showing lights the panel. A closed or background panel is offered ("Show History" or "Skip this step"). An anchor with no panel is skipped in the direction of travel; a tour with nothing showable completes.
- **Overlay** ([`overlay.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/overlay.ts), [`placement.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/placement.ts)): one fixed spotlight whose shadow is `--guidance-scrim` (it lightens the rest of the UI in the light theme and dims it in the dark theme), tracked every frame and never taking layout space. The callout is a non-modal labelled dialog with custom buttons and a markdown-lite content area ([`content.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/content.ts); `[[key:<binding>]]` chips come from the binding catalogue). Esc skips (also outside the card, unless a gesture, menu, dialog or text field has it), → and Enter go on, ← goes back. Focus moves into the card only on a person's own navigation and returns afterwards; each step is announced.
- **Content** ([`tours.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/tours.ts)): *Getting started* (8 steps) and *What's new in 0.1.0-alpha.1* (4 steps; its creator-lighting step says that feature arrived after that version). Onboarding is offered once after the welcome screen, never over an open dialog or a 3D preview card that is asking for something, and never in `?verify=1` unless a harness calls `xfStudioShell.guidance.offerOnboarding()`. How each tour ended, or that the offer was declined, is kept in `UIPreferences.tours` (`tours.record`), so it is workspace- and verification-scoped.
- **Help view** ([`help-panel.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/help-panel.ts), [`help-topics.ts`](../../projects/xf-studio/authoring/src/studio-ui/guidance/help-topics.ts)): a dock panel, closed by default, that opens beside the inspectors. One search covers tours, help topics and the keyboard and mouse reference (`helpReference()` over `bindingReference()`). Named links open the public knowledge pages and the issue tracker through `port.links`; hosts resolve `ProjectLink` names, so the view never sends a URL. F1 (`shell.help`), the header's Help button and the palette open it.
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
| 1 | `platform/api` types, `Registry`, system families; the eye-makeup core module registers the existing tables moved as-is; `StudioApplication` derives kind sets and Undo policy from the registry, routes by owner with an exhaustive check, removes both fallbacks, returns structured codes. *Done 26 Sep (`claude/platform-step1`); see [step 1 status](#step-1-status).* | golden registry/descriptor snapshot equals the pre-change one; application tests unchanged | 3 | CORE-08, CORE-15, part of CORE-03 |
| 2 | Look/part model, `collection-2` reader/writer, eye-makeup part-1 codec; `CollectionSession`/`CollectionService`/store on parts; canonical comparison in `save()` and baselines; `workspace-2` with per-feature editor memory. *Done 26 Sep (`claude/platform-step2`); see [step 2 status](#step-2-status).* | parity gates (§2); SQLite fixture; workspace-1 fixtures restore identical state | 5 | CORE-03 (data), CORE-05 |
| 3 | Part-2 with the per-layer model registry; `selectGlitterModel` stops touching the schema; minimal-schema recipe export | parity gates; every Glitter fixture renders identically | 2 | CORE-09 |
| 4 | `LookHistory` (part and look entries, chunk store, Redo), generic gesture and control transactions, `fitWorkspace` budgets | existing Undo/Redo/gesture/control tests; size benchmark under budget; reload keeps ≥10 steps | 4 | CORE-02, part of CORE-11 |
| 5 | Presentation `features()`/`feature(id)`; eye-makeup panels move to `features/eye-makeup/view`; layout, panel meta and activity sources from contributions; `recipe.undo` → `history.undo`; `git mv` of eye-makeup files into `features/eye-makeup` and `engines/layered-makeup` (import rewrites only) | studio-ui logic and boundary tests; style guide rebuilt; `?verify=1` with a saved dock layout restored | 5 | CORE-03 (routing), UI-10 |
| 6 | One composition root used by every host | Done 25 Sep (`claude/retire-legacy`): `studio-startup.ts`, started by `studio-main` and the desktop bootstrap; `main.ts` and `port-smoke` retired; bootstrap and boundary tests | 2 | UI-05 |
| 7 | Scene-host split, `FeatureRenderer`, `CharacterContextService`, `DetailLoader`, material adapters; eye makeup's renderer wraps `makeup-stack`; brows, lashes, hair and piercings render through resolved components. *Partly ahead (claude/render-resolver, 25 Sep): brows, lashes and hair already load from the resolver's character record through per-template material adapters (`character-detail-loader.ts`, `character-material-adapters.ts`, `character-detail-actions.ts`), inside today's `scene.ts`; the scene-host split, piercings and eye makeup's renderer remain.* | `?verify=1` Ready at 1K/2K; makeup screenshot parity; dispose leak test; idle frame-on-demand test | 7 | UI-02, UI-11, PIPE-11 (preview) |
| 8 | `FeatureExporter`/`FeatureVerifier`, product planner, `runProductBuild` for both hosts, `local-package-2`, transport reading version 1 and 2, package-plan actions and panel | default-product Build **byte-identical** archive members and identical plan; two-product synthetic test with a stub exporter; namespace-duplication refusal test | 6 | PIPE-12, PIPE-09, PIPE-03 |
| 9 | Strict boundary tests (§7); update the contract, invariants, catalogue and pipeline guide (with visual diagram review) | link check; diagrams inspected | 2 | — |

### Step 1 status

Built on 26 September in `claude/platform-step1`. Behaviour, action IDs, serialized formats and the presentation port are unchanged.

**What exists.**

- `src/platform/api/`: the action types (`ActionDescriptor`, `ActionSpec`, `ActionTable`, `UndoPolicy`), `ReasonCode`, `Capability` and `ValidationIssue`, the owner types (`SystemFamily`, `FeatureModule`, `ActionHandler`) and small pure helpers (`actionTable`, `coded`, `refusal`, `undoPolicyOf`, `featureId`, `familyId`). The legacy `studio-action-descriptors.ts` and `validation-issues.ts` re-export these types.
- `src/platform/core/registry.ts`: `Registry` refuses a duplicate owner or a kind owned twice. It gives kinds (all, or one owner's), descriptors in registration order, Undo policy (variant first), a total `route(kind)` and entries with qualified IDs.
- `src/features/eye-makeup/index.ts`: module #1, registering the 29 recipe and layer actions with their existing descriptors.
- `src/compose/system-families.ts`: history, collection, preview (camera and viewing), motion, quality and saved V.
- `src/compose/studio-registry.ts`: the composition list `STUDIO_OWNERS`, `StudioOwnerActions` and `STUDIO_REGISTRY`.
- `StudioApplication` takes the registry (default `STUDIO_REGISTRY`) and binds one handler per owner. It has no kind sets, prefix checks, fallbacks or message matching.

**Decisions** (open details in §1 and §4, settled the simplest way):

- **Spec contents.** A step-1 `ActionSpec` holds only the existing descriptor: scope, payload, variants, effect and Undo policy. The other fields join in later steps: `label` with the look history (step 4); `units`, `limits` and `consequence` with the presentation facade (step 5). Until then they stay in `history-labels.ts`, `action-limits.ts` and `action-consequences.ts`.
- **Capability and dispatch are handlers, not pure spec functions yet.** They depend on part and editor state, which arrives in step 2. Meanwhile the application binds an `ActionHandler` per owner over today's services. The handler map is a mapped type over `StudioOwnerActions`, so a registered owner without a handler does not compile, and the constructor also refuses a registry whose owners differ from the handlers. When step 2 lands, the eye-makeup handler becomes the module's `capability` and `apply`.
- **Family policy replaces prefixes.** A system family declares `needsScene` (refused with `asset_unavailable` while the scene cannot load: preview, motion, saved V) and `thrown` (the code for an exception after the gate: `unavailable` for preview, motion and quality). History's busy check is keyed by the owner.
- **IDs.** `featureId()` and `familyId()` keep the literal type and accept lower camel or kebab case (`eye-makeup`, `savedV`). A qualified ID is `<owner>/<kind>` (`eye-makeup/layer.setColor`, `history/recipe.undo`). Commands keep their flat, grandfathered kinds. The `{ kind: "feature" }` envelope waits for module #2, because no current action needs it.
- **Undo policy name.** The policy stays `recipe` rather than `part` until the look history (step 4), so the golden snapshot and the port keep their values.
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
- `src/compose/studio-registry.ts`: `STUDIO_PARTS` (the part registry of the composed features) and `LIVE_FEATURE`, the feature the one live editor document edits until the look history (step 4).
- Collections: `collection-workspace.ts` holds drafts of looks with memory by look and feature, reads workspace-1 drafts (`readCollectionWorkspaceV1`) and workspace-2 drafts (`parseCollectionWorkspace`) and writes the latter. `CollectionSession`, `CollectionActions`, `CollectionService` and the SQLite `CollectionLibrary` work on looks; the eye-makeup package pipeline takes `eyeMakeupCollection(looks)`, its collection-1 view, and `parseCollection` reads either schema.
- Workspace: `workspace-state.ts` reads workspace-1 and workspace-2 and writes workspace-2 (`serializeWorkspace`); `workspace-budget.ts` trims every feature's history alike before serializing; the desktop store writes the serialized form and keeps the `.bak`.
- `StudioApplication`'s eye-makeup handler runs the registered spec's `capability` and `apply` over `EyeMakeupPort` (`authoring-eye-makeup.ts`), which reads the live document without copying and publishes the result exactly as the recipe and layer services always have (one checkpoint, the state, the render effect).

**Decisions** (open details in §2, settled here):

- **In memory, a look's registered parts are `{ schema: current, body: parsed }`.** A parsed part must be plain data, so the in-memory look and its stored form have the same shape; `readPart` normalizes every read.
- **Writers use the oldest schema that holds the content exactly.** A SQLite row or an exported collection file is `xfas/collection-1` when every look holds exactly eye makeup's part in a form part-1 holds (`downgrade`); otherwise `xfs/collection-2`. So a library and an exported file of eye-makeup looks stay readable by the released 0.1.0-alpha.1, which was checked by running that release's own readers on the new outputs: it reads the collection-1 export, lists and reads a library holding new rows and saves on top of them, refuses a collection-2 file without writing, and treats a workspace-2 as unreadable and protected. The collection-2 writer is exercised as soon as a look has a part the old format cannot hold (tests use an unregistered feature). The workspace always writes version 2: per-feature editor memory is its reason to exist.
- **Glitter and Colour-shift memory is feature-wide.** Workspace-1's `glitterChoices` (keyed `<preset>/<layer>`) becomes `features["eye-makeup"].choices` verbatim, so settings of a preset that is not loaded come back if its collection is opened again. The pure action state gets the current look's entries keyed by layer (`EyeMakeupEditorState.choices`), and the port writes changed entries back under the preset. So `FeatureModule` has `editor` (per look: active layer, selection, warp selection) and optional `memory` (feature-wide), and the action state's `E` is built by the host from both.
- **Stored workspace-2.** `look` holds the loose editor (parts and memory by feature) only when no collection draft exists, since the selected look restores the editor; `features` holds each feature's workspace memory; each draft stores `memory[preset][feature] = { editor, partSchema, history, historyTrimmed? }`, with removed presets and recovery drafts alike. History entries are part bodies of `partSchema`; the look history of step 4 replaces them. View state (UV view, camera, preferences, preview setup, saved V) is unchanged.
- **The in-memory `WorkspaceState` keeps the live document's fields** (`recipe`, `active`, `selected`, `history`, `fieldSelection`, `glitterChoices`) as the one live eye-makeup document, which step 4 replaces; entries of unregistered features ride in `otherFeatures`. Only `serializeWorkspace` output is ever stored.
- **Canonical comparison** is `canonicalJson(serialize(parse(part)))` (keys sorted), in the store's `save()` and in `CollectionService` baselines; the baseline also keeps the raw JSON so the common unchanged case costs one stringify.
- **A newer part schema of a registered feature is refused on read** ("saved by a newer version of XF Studio"), so a workspace holding one stays protected and a library row holding one is never overwritten; collection lists read identity only (`readIdentity`) and still list it. Keeping such parts verbatim and read-only, like unregistered features, can come with the first real part-2.
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

**Step 3 needs:**

- `xfs/eye-makeup-part-2` with the per-layer model registry; `part.accepts` gains part-2, `current` moves to it, and `downgrade(part, part-1)` returns the recipe when every layer's model part-1 can hold, so the minimal writers keep producing collection-1 for the alpha.
- `selectGlitterModel` and `applyRecipeAction` stop touching `recipe.schema`; the eye-makeup codec parses part-1 bodies into part-2.
- The minimal recipe export for "Export recipe".
- Decide whether a newer part schema of a registered feature is kept read-only instead of refused.

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
