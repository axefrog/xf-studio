import type { AuthoringDocument } from "./authoring-document";
import type { AuthoringControlEdits } from "./authoring-control-edits";
import type { AuthoringGestures, GestureSource } from "./authoring-gestures";
import { historyTimeline, type AuthoringHistory, type HistoryAction, type HistorySnapshot, type HistoryState } from "./authoring-history";
import { actionLimits, type FieldLimit } from "./action-limits";
import { nameIssue } from "./validation-issues";
import { consequenceOf, type Consequence, type ConsequenceSubject } from "./action-consequences";
import { RECIPE_HISTORY_LIMIT } from "./editor-actions";
import { REMOVED_PRESET_LIMIT } from "./collection-workspace";
import { CollectionServiceError, type CollectionRequest, type CollectionService } from "./collection-service";
import type { CollectionStudioAction } from "./collection-actions";
import type { MotionAction, MotionActions } from "./motion-actions";
import type { PreviewAction, PreviewActions } from "./preview-actions";
import type { PreviewQualityActions, QualityAction } from "./preview-quality-actions";
import type { Layer, Point, Recipe, WarpField } from "./recipe";
import { RECIPE_ACTION_KINDS, type GestureEdit, type RecipeAction } from "./recipe-actions";
import type { EyeMakeupPort, EyeMakeupSpec } from "./authoring-eye-makeup";
import type { EyeMakeupAction } from "./eye-makeup-model";
import type { SavedAppearanceAction, SavedAppearanceActions, SavedAppearanceState } from "./saved-appearance-actions";
import { actionRegistry, type ActionDescriptor, type FileDescriptor, type RequestDescriptor,
  type ValueSchema } from "./studio-action-descriptors";
import { coded, refusal, undoPolicyOf, type ActionDescriptor as PlatformDescriptor, type ActionHandler, type AsyncActionHandler,
  type Capability, type FeatureActionSpec, type FeatureModule, type HistoryEntryId, type HistoryLabel, type ReasonCode, type UndoPolicy,
  type ValidationIssue } from "./platform/api";
import type { AnyOwner, Registry } from "./platform/core/registry";
import { CONTROL_TRANSACTION, HistoryTransaction, type TransactionHost } from "./platform/core/history-transaction";
import type { StudioFileAction, StudioFileOperations, StudioFileOutcome } from "./studio-file-operations";
import { contextCandidates, contextScope, geometryHit,
  type StudioBoundContext, type StudioContextHit } from "./studio-context-targets";
import { finishCatalogue, glitterModelCatalogue } from "./finish-catalogue";
import { layerExport, planPresetExport, type LayerExport } from "./finish-export";

/**
 * Each owner this application binds a handler for, with its action union, keyed by owner ID. The
 * composition list (`compose/studio-registry.ts`) must register exactly these owners: it checks
 * this map at compile time, and the constructor checks the injected registry at run time.
 */
export type StudioOwnerActions = {
  history: HistoryAction;
  "eye-makeup": EyeMakeupAction;
  collection: CollectionStudioAction;
  preview: PreviewAction;
  motion: MotionAction;
  quality: QualityAction;
  savedV: SavedAppearanceAction;
};
export type StudioOwnerId = keyof StudioOwnerActions;
/**
 * Each asynchronous family this application binds a handler for (CORE-36): the collection library's
 * requests and the file workflows. The composition list registers exactly these beside the owners above.
 */
export type StudioOwnerRequests = {
  library: CollectionRequest;
  files: StudioFileAction;
};
export type StudioRequestOwnerId = keyof StudioOwnerRequests;
/** Every action a presentation may dispatch: the union of the registered owners' actions. */
export type StudioAction = StudioOwnerActions[StudioOwnerId];
/** A layer's export status within its preset. `blockedBy` says whether its own finish ("layer")
 * or the rest of the preset ("preset") keeps it out of the mod. */
export type LayerExportStatus = Extract<LayerExport, { exportable: true }> |
  { exportable: false; reason: string; blockedBy: "layer" | "preset" };
export type StudioTarget = { kind: "collection" } | { kind: "preset"; id: string } |
  { kind: "layer"; id: string } | { kind: "point"; layerId: string; index: number } |
  { kind: "field"; layerId: string; id: string } | { kind: "viewport" } | { kind: "file" } | { kind: "workspace" };
/** The platform's reason codes and capability shape (`platform/api`). */
export type StudioReasonCode = ReasonCode;
export type StudioCapability = Capability;
/** Every synchronous action entry point (dispatch, context dispatch, form control edits) returns this. */
export type StudioDispatchResult = { ok: true; result?: unknown } | { ok: false; code: string; message: string };
export type StudioActionInfo = { action: StudioAction; capability: StudioCapability;
  undo: UndoPolicy; async: false };
export type StudioGestureProposal =
  | { kind: "shape.replace"; next: Layer }
  | { kind: "point.replace"; index: number; next: Partial<Point> }
  | { kind: "field.replace"; fieldId: string; next: Partial<WarpField> }
  | { kind: "path.replacePoints"; points: Point[] };

type Handlers = { readonly [O in StudioOwnerId]: ActionHandler<StudioOwnerActions[O]> };
type AsyncHandlers = {
  readonly library: AsyncActionHandler<CollectionRequest, Awaited<ReturnType<CollectionService["execute"]>>>;
  readonly files: AsyncActionHandler<StudioFileAction, StudioFileOutcome>;
};
type Services = { document: AuthoringDocument;
  /** Eye makeup's live part and editor state, and where its pure action results are published. */
  eyeMakeup: EyeMakeupPort; undo: () => boolean;
  /** Where new items' IDs come from for the other features' actions (default: random UUIDs). */
  newId?: () => string;
  /** Optional user-level history with Redo and labels; hosts without it offer Undo only. */
  history?: AuthoringHistory;
  gestures: AuthoringGestures; controls: AuthoringControlEdits;
  collection?: CollectionService; files?: StudioFileOperations; preview?: PreviewActions; motion?: MotionActions;
  quality?: PreviewQualityActions; savedV?: SavedAppearanceActions };

/** One read-only, target-aware entry point for a replaceable presentation. */
export class StudioApplication {
  private services: Services;
  private listeners = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private collectionRevision = 0;
  private seenContent?: number;
  private previewUnavailable?: string;
  private gesture?: { source: GestureSource; layer: Layer; points: Point[]; fields: Map<string, WarpField> };
  /** The action registry: owners, descriptors, Undo policy and routes. */
  private readonly routes: Registry<AnyOwner>;
  /** One handler per registered owner: the compiler requires every owner in the composition list. */
  private readonly handlers: Handlers;
  /** One handler per asynchronous family (library requests, file workflows). */
  private readonly asyncHandlers: AsyncHandlers;
  /**
   * The other registered features' handlers: their pure capability and apply over their live
   * documents (`document.others`), bound generically, so a feature module needs no handler of its own.
   */
  private readonly featureHandlers = new Map<string, ActionHandler<{ kind: string }>>();
  /** The open look transaction (`transaction`): its actions record no steps of their own. */
  private look?: { features: readonly string[] };
  /** `registry` is the composition's action registry, injected by the composition roots (CORE-29). */
  constructor(services: Services, registry: Registry<AnyOwner>) {
    this.services = services; this.routes = registry; this.handlers = this.bindHandlers();
    this.asyncHandlers = this.bindAsyncHandlers();
    for (const owner of registry.owners())
      if (owner.owner === "feature" && !(owner.id in this.handlers)) {
        if (!services.document.others?.has(owner.id)) throw Error(`Feature ${owner.id} has no live document.`);
        this.featureHandlers.set(owner.id, this.featureHandler(owner.id));
      }
    // Exhaustive at run time too: an owner without a handler, or a handler without an owner, is a composition error.
    const owners = registry.owners().map(owner => owner.id).sort(),
      bound = [...Object.keys(this.handlers), ...Object.keys(this.asyncHandlers), ...this.featureHandlers.keys()].sort();
    if (owners.join() !== bound.join())
      throw Error(`Registered owners (${owners.join(", ")}) do not match the application's handlers (${bound.join(", ")}).`);
    this.subscribeSources();
  }
  attach(next: Partial<Omit<Services, "document" | "eyeMakeup" | "gestures" | "controls">>) {
    if (next.collection && next.collection !== this.services.collection) this.collectionRevision++;
    this.services = { ...this.services, ...next }; this.subscribeSources(); this.notify();
  }
  /** A device failure is terminal for this page load; edits and mask work remain available. */
  setPreviewUnavailable(reason: string) { this.previewUnavailable = reason; this.notify(); }
  private notify() { for (const listener of this.listeners) listener(); }
  private subscribeSources() {
    for (const unsub of this.unsubs) unsub();
    const s = this.services;
    this.unsubs = [s.document.subscribe(() => this.notify())];
    this.seenContent = s.collection?.contentVersion();
    // Save progress, busy flags and list refreshes must not invalidate an open menu (audit A-14).
    if (s.collection) this.unsubs.push(s.collection.subscribe(() => {
      const content = s.collection!.contentVersion();
      if (content !== this.seenContent) { this.seenContent = content; this.collectionRevision++; }
      this.notify();
    }));
    for (const source of [s.preview, s.motion, s.quality, s.savedV])
      if (source) this.unsubs.push(source.subscribe(() => this.notify()));
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** Exact command IDs; nested preset/layer command variants retain their typed payloads. */
  actionKinds() { return [...this.routes.kinds()] as StudioAction["kind"][]; }
  /** Library request kinds (the registered `library` family). */
  requestKinds() { return [...this.routes.kinds("library")] as CollectionRequest["kind"][]; }
  actionDescriptors() { return structuredClone(this.routes.descriptors()) as Record<StudioAction["kind"], ActionDescriptor>; }
  requestDescriptors() {
    return structuredClone(this.routes.asyncDescriptors("library")) as Record<CollectionRequest["kind"], RequestDescriptor>;
  }
  /** Gesture proposals: eye makeup's registered gestures (the session and its Undo transaction are the platform's). */
  gestureDescriptors() {
    const owner = this.routes.owner("eye-makeup") as FeatureModule | undefined;
    return structuredClone(owner?.gestures?.descriptors ?? {}) as Record<StudioGestureProposal["kind"], ActionDescriptor>;
  }
  /** File workflow IDs (the registered `files` family, run by `StudioFileOperations`). */
  fileKinds() { return [...this.routes.kinds("files")] as StudioFileAction["kind"][]; }
  fileDescriptors() {
    return structuredClone(this.routes.asyncDescriptors("files")) as Record<StudioFileAction["kind"], FileDescriptor>;
  }
  /** Every action, request, gesture proposal and file workflow ID with its family, scope and Undo policy. */
  registry() {
    return actionRegistry(this.routes.descriptors() as Record<string, ActionDescriptor>, { requests: this.routes.asyncDescriptors("library"),
      gestures: this.gestureDescriptors(), files: this.routes.asyncDescriptors("files") });
  }
  /** The registered feature modules in catalogue order, for the presentation's feature facades (step 5). */
  features(): { id: string; label: string; stage: FeatureModule["stage"] }[] {
    return this.routes.owners().flatMap(owner => owner.owner === "feature"
      ? [{ id: owner.id as string, label: owner.label, stage: (owner as FeatureModule).stage }] : []);
  }
  /** The owner of a synchronous action kind (a family or feature ID), or undefined for an unknown kind. */
  ownerOf(kind: string): string | undefined {
    const route = this.routes.route(kind);
    return route.ok ? route.owner.id : undefined;
  }
  /** A feature's live part and editor state for the selected look, detached (features beside the editor document). */
  featureState(feature: string): { part?: unknown; editor?: unknown } | undefined {
    return this.services.document.others?.document(feature)?.export();
  }
  /** Full scope listing; payload-required entries must still be checked with capability(actualAction). */
  descriptorsFor(target: StudioTarget) {
    const targetCapability = this.targetCapability(target);
    return Object.entries(this.routes.descriptors() as Record<string, ActionDescriptor>).filter(([, descriptor]) =>
      (descriptor.scope as readonly string[]).includes(target.kind)).map(([id, descriptor]) => ({
      id: id as StudioAction["kind"], ...structuredClone(descriptor),
      targetCapability, requiresInput: Object.values(descriptor.payload).some(field => field.from === "input"),
    }));
  }
  targetCapability(target: StudioTarget): StudioCapability {
    const s = this.services, recipe = s.document.recipe;
    if (target.kind === "layer" && !recipe.layers.some(layer => layer.id === target.id))
      return missingTarget("That layer no longer exists.");
    if (target.kind === "point" && !recipe.layers.find(layer => layer.id === target.layerId)?.points[target.index])
      return missingTarget("That control point no longer exists.");
    if (target.kind === "field" && !recipe.layers.find(layer => layer.id === target.layerId)?.fields.some(field => field.id === target.id))
      return missingTarget("That warp control no longer exists.");
    // Cheap reads: target checks never clone the draft (CORE-05).
    if (target.kind === "preset" && !s.collection?.hasPreset(target.id))
      return s.collection ? missingTarget("That preset no longer exists.") : missing("Collection is still loading.");
    if (target.kind === "collection" && !s.collection?.draftIdentity()) return missing("Collection is still loading.");
    if ((target.kind === "collection" || target.kind === "preset") && s.collection?.isBusy())
      return { available: false, code: "busy", reason: "A collection request is in progress." };
    return { available: true };
  }
  /** Validate a concrete target/payload pair before a menu, shortcut or form dispatches it. */
  contextCapability(target: StudioTarget, action: StudioAction): StudioCapability {
    const descriptor = this.routes.descriptor(action.kind);
    if (!descriptor) return unknownCommand();
    if (!(descriptor.scope as readonly string[]).includes(target.kind))
      return { available: false, code: "invalid_value", reason: "This command does not apply to that target." };
    const exists = this.targetCapability(target);
    if (!exists.available) return exists;
    const payload = action as unknown as Record<string, unknown>;
    const command = payload.command && typeof payload.command === "object"
      ? payload.command as Record<string, unknown> : undefined;
    const flattened = { ...payload, ...command };
    const targetId = target.kind === "layer" ? target.id : target.kind === "point" || target.kind === "field"
      ? target.layerId : target.kind === "preset" ? target.id : undefined;
    if (targetId && (typeof flattened.layerId === "string" && flattened.layerId !== targetId ||
      typeof flattened.id === "string" && flattened.id !== (target.kind === "field" ? target.id : targetId) ||
      typeof flattened.fieldId === "string" && target.kind === "field" && flattened.fieldId !== target.id ||
      typeof flattened.index === "number" && target.kind === "point" && flattened.index !== target.index))
      return { available: false, code: "missing_target", reason: "The command targets a different item." };
    // Payload types and ranges are checked by capability(), the same gate dispatch uses.
    return this.capability(action);
  }
  /** Current static and state-dependent input limits for an action on a concrete target (audit A-7). */
  limitsFor(target: StudioTarget, kind: StudioAction["kind"], variant?: string): Record<string, FieldLimit> {
    const limits = actionLimits(this.services.document.recipe, target, kind, variant);
    const presets = this.services.collection?.summary().draft?.presets.length;
    if (kind === "preset.edit" && variant === "move" && limits.to && presets !== undefined)
      limits.to = { ...limits.to, min: 0, max: Math.max(0, presets - 1) };
    return limits;
  }
  /** Enumerated values and their live capability for a concrete target. */
  choicesFor(target: StudioTarget, kind: StudioAction["kind"], field: string,
    base: Record<string, unknown> = {}) {
    const schema = this.routes.descriptor(kind)?.payload[field];
    if (!schema?.values) return [];
    const targetPayload = target.kind === "layer" ? { layerId: target.id, id: target.id } :
      target.kind === "point" ? { layerId: target.layerId, index: target.index } :
      target.kind === "field" ? { layerId: target.layerId, fieldId: target.id } :
      target.kind === "preset" ? { id: target.id } : {};
    return schema.values.map(value => {
      const action = { kind, ...targetPayload, ...base, [field]: value } as StudioAction;
      return { value, action, capability: this.contextCapability(target, action) };
    });
  }
  /** Bind an adapter's hit to this draft/geometry before offering existing commands. */
  contextFor(hit: StudioContextHit): StudioBoundContext {
    const draft = this.services.collection?.draftIdentity();
    return Object.freeze({ hit: Object.freeze(structuredClone(hit)), collectionId: draft?.collectionId,
      selectedPresetId: draft?.selected,
      collectionRevision: this.collectionRevision,
      geometryRevision: this.services.document.geometryVersion.revision });
  }
  private boundContextCapability(context: StudioBoundContext): StudioCapability {
    const draft = this.services.collection?.draftIdentity();
    if (context.collectionRevision !== this.collectionRevision)
      return missingTarget("The collection changed after this menu opened.");
    if (context.collectionId !== draft?.collectionId)
      return missingTarget("The collection changed after this menu opened.");
    if (context.hit.kind !== "collection" && context.hit.kind !== "preset" &&
      context.selectedPresetId !== draft?.selected)
      return missingTarget("The selected preset changed after this menu opened.");
    if (geometryHit(context.hit) && context.geometryRevision !== this.services.document.geometryVersion.revision)
      return missingTarget("The shape changed after this menu opened.");
    if (context.hit.kind === "tangent") {
      const hit = context.hit;
      const layer = this.services.document.recipe.layers.find(item => item.id === hit.layerId);
      if (layer?.pathMode !== "bezier" || !layer.points[hit.index]?.handles)
        return missingTarget("That Bézier tangent no longer exists.");
    }
    const target = contextScope(context.hit);
    if (!target) return { available: true };
    return this.targetCapability(target);
  }
  /** Input candidates carry an applicable/disabled reason but no forged placeholder action. */
  contextOptionsFor(context: StudioBoundContext) {
    const bound = this.boundContextCapability(context), target = contextScope(context.hit), hit = context.hit;
    return contextCandidates(context.hit, this.services.document.recipe).map(candidate => {
      if ("action" in candidate) return { ...candidate, requiresInput: false as const,
        capability: bound.available && target ? this.contextCapability(target, candidate.action) : bound,
        undo: this.routes.undoPolicy(candidate.action) };
      let capability = bound;
      if (capability.available && (hit.kind === "point" || hit.kind === "tangent")) {
        if (candidate.id === "point.softness" &&
          this.services.document.recipe.layers.find(layer => layer.id === hit.layerId)?.softness.mode !== "boundary")
          capability = { available: false, code: "incompatible_mode",
            reason: "Enable point edge softness before editing an individual edge." };
      }
      // The Undo policy of the variant the option edits, as dispatch records it (CORE-32).
      const variant = { kind: candidate.actionKind, command: { kind: candidate.variant } } as { kind: string };
      return { ...candidate, capability, undo: undoPolicyOf(this.routes.descriptor(candidate.actionKind)!, variant) };
    });
  }
  contextQuery(hit: StudioContextHit) {
    const context = this.contextFor(hit);
    return { context, targetCapability: this.boundContextCapability(context),
      options: this.contextOptionsFor(context) };
  }
  /** Query a completed input action, then recheck the same binding at invocation. */
  boundActionCapability(context: StudioBoundContext, action: StudioAction): StudioCapability {
    const bound = this.boundContextCapability(context);
    if (!bound.available) return bound;
    const target = contextScope(context.hit);
    if (!target) return { available: false, code: "invalid_value",
      reason: "No standalone edit command applies off the makeup." };
    const variant = "command" in action && action.command && typeof action.command === "object" &&
      "kind" in action.command ? action.command.kind : undefined;
    const candidate = contextCandidates(context.hit, this.services.document.recipe).find(item =>
      "action" in item ? item.action.kind === action.kind &&
        ("command" in item.action && item.action.command && typeof item.action.command === "object" &&
          "kind" in item.action.command ? item.action.command.kind : undefined) === variant :
        item.actionKind === action.kind && item.variant === variant);
    if (!candidate) return { available: false, code: "invalid_value",
      reason: "This command is not offered for that hit target." };
    return this.contextCapability(target, action);
  }
  dispatchContext(context: StudioBoundContext, action: StudioAction): StudioDispatchResult {
    const allowed = this.boundActionCapability(context, action);
    return allowed.available ? this.dispatch(action) : { ok: false as const,
      code: allowed.code ?? "unavailable", message: allowed.reason ?? "Action unavailable." };
  }
  snapshot() {
    const s = this.services;
    return structuredClone({ document: s.document.snapshot(), collection: s.collection?.view(),
      preview: s.preview?.snapshot(), previewOptions: s.preview?.piercingOptions(),
      eyeShapeOptions: s.preview?.eyeShapeOptions(), lighting: s.preview?.lightingStatus() ?? null, motion: s.motion?.snapshot(),
      quality: s.quality?.snapshot(), savedV: s.savedV?.snapshot(),
      gesture: s.gestures.snapshot(), control: s.controls.snapshot() });
  }
  /**
   * Preview/motion/quality/saved-V state without the document or collection draft.
   * `snapshot()` clones every Undo history; repainting views should use this instead.
   */
  previewState() {
    const s = this.services, saved = s.savedV?.snapshot();
    return structuredClone({ preview: s.preview?.snapshot(), previewOptions: s.preview?.piercingOptions(),
      eyeShapeOptions: s.preview?.eyeShapeOptions(), lighting: s.preview?.lightingStatus() ?? null,
      motion: s.motion?.snapshot(), quality: s.quality?.snapshot(),
      savedV: { loaded: !!saved?.savedV, gameVersion: saved?.savedV?.gameVersion,
        result: saved?.result, suggestedEyeShape: saved?.suggestedEyeShape },
      gesture: s.gestures.snapshot(), control: s.controls.snapshot() });
  }
  /** What an action, file workflow or library request replaces, writes or discards, and how to recover. */
  consequences(subject: ConsequenceSubject): Consequence {
    const jump = "action" in subject && subject.action.kind === "history.jumpTo"
      ? this.services.history?.plan(subject.action.entryId) : undefined;
    return consequenceOf(subject, { draft: this.services.collection?.summary().draft, history: this.history(),
      undoLimit: RECIPE_HISTORY_LIMIT, removedLimit: REMOVED_PRESET_LIMIT, jump });
  }
  /** What Undo and Redo would change next (labels are session-only; restored history reads "Earlier change"). */
  history(): HistoryState {
    const s = this.services;
    return s.history?.state() ?? { undo: s.document.canUndo ? s.document.historyLabel() : undefined,
      depth: s.document.undoDepth, redoDepth: 0 };
  }
  /**
   * Read-only timeline of the current preset's history (oldest first, redo-able steps after
   * the current one) for a history list. Labels and times are session-only; steps restored
   * from a saved workspace read "Earlier change". It exposes no recipes.
   */
  historyTimeline(): HistorySnapshot {
    return this.services.history?.snapshot() ?? historyTimeline(this.services.document);
  }
  /** Static finish and Glitter-model descriptors, including the compiler's export gate. */
  finishCatalogue() { return finishCatalogue(); }
  /**
   * Game-export status of one layer in the current preset, from the same preset-level plan
   * Check uses: a layer whose finish exports on its own can still be left out because of the
   * other layers (a Colour-shifting layer beside Matte). A hidden layer is judged as if shown.
   */
  layerExport(layerId: string): LayerExportStatus | undefined {
    const layers = this.services.document.recipe.layers, layer = layers.find(item => item.id === layerId);
    if (!layer) return undefined;
    const alone = layerExport(layer);
    if (!alone.exportable) return { ...alone, blockedBy: "layer" };
    const shown: Layer = { ...layer, enabled: true, opacity: layer.opacity > 0 ? layer.opacity : 1 };
    const plan = planPresetExport({ layers: layers.map(item => item === layer ? shown : item) });
    const excluded = plan.excluded.find(item => item.layer === shown);
    return excluded ? { exportable: false, reason: excluded.reason, blockedBy: "preset" } : alone;
  }
  glitterModelCatalogue() { return glitterModelCatalogue(); }
  /** A saved-V adapter has already applied the morph; synchronize only the selector. */
  recordAppliedSavedAppearance(result: Readonly<Pick<SavedAppearanceState, "suggestedEyeShape">>) {
    if (result.suggestedEyeShape !== undefined) this.services.preview?.rememberEyeShape(result.suggestedEyeShape);
  }
  capability(action: StudioAction): StudioCapability {
    const s = this.services, route = this.routes.route(action.kind);
    if (!route.ok) return unknownCommand();
    // With a loaded collection but no selected preset the editor shows an empty recipe no
    // preset owns; content written there would be discarded at the next preset switch.
    if (route.spec.descriptor.effect === "content" && this.unowned())
      return { available: false, code: "missing_target", reason: NO_PRESET };
    if (this.previewUnavailable && route.owner.owner === "system" && route.owner.needsScene)
      return { available: false, code: "asset_unavailable", reason: this.previewUnavailable };
    if (route.owner.id === "history" && (s.gestures.snapshot() || s.controls.snapshot()))
      return { available: false, code: "busy", reason: "Finish or cancel the current adjustment first (Esc)." };
    // A look transaction records the parts it names: nothing else may change while it runs.
    if (this.look && !this.look.features.includes(route.owner.id))
      return { available: false, code: "busy", reason: "Only the parts this change names can be edited while it is applied." };
    // Descriptor payload types and ranges gate every entry point, not only context menus.
    const payload = payloadIssue(route.spec.descriptor, action);
    if (payload && payload.code !== "limit") return payload;
    // The owning module decides, with a structured code (CORE-15).
    const domain = coded(this.handler(route.owner.id).capability(action));
    // A range limit is generic; when the domain can say why in the user's terms
    // (for example "already at the front"), show that instead.
    if (!domain.available) return domain;
    return payload ?? domain;
  }
  private handler(owner: string) {
    return (this.handlers[owner as StudioOwnerId] ?? this.featureHandlers.get(owner)) as ActionHandler<StudioAction>;
  }
  /**
   * A registered feature's handler over its live document: the spec's pure capability, then assign
   * IDs, apply, record one `part` step when the action's Undo policy asks for one (not inside a look
   * transaction, which records its own), and publish the result.
   */
  private featureHandler(feature: string): ActionHandler<{ kind: string }> {
    const app = this;
    const live = () => app.services.document.others?.document(feature);
    const specOf = (action: { kind: string }) => {
      const route = app.routes.route(action.kind);
      if (!route.ok || route.owner.id !== feature) throw Error(`${action.kind} is not an action of ${feature}.`);
      return route.spec as FeatureActionSpec<unknown, unknown, { kind: string }>;
    };
    return {
      capability: action => {
        const document = live();
        return document ? specOf(action).capability(document.state(), action) : refusal("not_ready", "This feature is still loading.");
      },
      dispatch: action => {
        const document = live()!, spec = specOf(action);
        const concrete = spec.assignIds?.(action, app.services.newId ?? (() => crypto.randomUUID())) ?? action;
        const result = spec.apply(document.state(), concrete);
        if (!result.changed) return result.effect;
        if (!app.look && app.routes.undoPolicy(concrete) !== "none") app.services.document.checkpointFeature(feature, spec.label(concrete));
        document.set(result.part, result.editor);
        app.services.document.partChanged();
        return result.effect;
      },
    };
  }
  /**
   * One Undo step over several parts of the look (feature-module platform §3): `fn` dispatches the
   * features' actions, which record no steps of their own, and the look history records one `look` step
   * named `label` for everything they changed. A transaction that changed nothing leaves no step; one
   * whose `fn` throws or reports a failure is reverted to its start without Redo. Refused inside a
   * gesture, a form-control adjustment or another transaction, and while no preset owns the editor.
   */
  transaction<T>(label: HistoryLabel, features: readonly string[], fn: () => T): StudioDispatchResult {
    const s = this.services;
    if (this.look || this.gesture || s.controls.snapshot())
      return { ok: false, code: "busy", message: "Finish or cancel the current adjustment first (Esc)." };
    if (this.unowned()) return { ok: false, code: "missing_target", message: NO_PRESET };
    const unknown = features.filter(feature => feature !== s.document.feature && !s.document.others?.has(feature));
    if (!features.length || unknown.length)
      return { ok: false, code: "invalid_value", message: `These parts can't be changed together here: ${unknown.join(", ") || "none named"}.` };
    const document = s.document, history = s.history;
    const host: TransactionHost<HistoryEntryId> = {
      checkpoint: () => document.checkpointLook(features, label), top: () => document.historyTop,
      relabel: (step, name) => document.relabelCheckpoint(step, name), discard: step => document.discardCheckpoint(step),
      revert: step => { if (history) history.revertTransaction(step); },
      content: () => document.contentKey(features),
    };
    const transaction = HistoryTransaction.open(host, CONTROL_TRANSACTION, () => true);
    this.look = { features };
    let result: T;
    try { result = fn(); }
    catch (error) {
      this.look = undefined; transaction.cancel(); this.notify();
      return { ok: false, ...failure(undefined, error) };
    }
    this.look = undefined;
    const failed = result && typeof result === "object" && (result as { ok?: unknown }).ok === false
      ? result as unknown as { code?: string; message?: string } : undefined;
    if (failed) { transaction.cancel(); this.notify();
      return { ok: false, code: failed.code ?? "invalid_value", message: failed.message ?? "The change could not be applied." }; }
    // A step the checkpoint could not add (the top step already held the start) takes the name when the change is kept.
    transaction.applied(true, () => label);
    transaction.commit(); this.notify();
    return { ok: true, result };
  }
  /** Eye makeup's registered spec for one of its actions: the module's pure capability and apply. */
  private eyeMakeupSpec(action: EyeMakeupAction) {
    const route = this.routes.route(action.kind);
    if (!route.ok || route.owner.owner !== "feature") throw Error(`${action.kind} is not a feature action.`);
    return route.spec as EyeMakeupSpec;
  }
  /**
   * Each owner's live behaviour. Eye makeup's is its module's pure capability and apply over
   * the live document's part and editor state, published through the document port; the
   * system families still bind their services. No kind falls through to another owner.
   */
  private bindHandlers(): Handlers {
    const app = this;
    // An action records an Undo entry by its Undo policy (its variant's first), never by its effect (CORE-32).
    // Inside a look transaction the transaction records the one step.
    const recorded = (action: StudioAction) => !this.look && this.routes.undoPolicy(action) !== "none";
    return {
      history: {
        capability: action => {
          const s = app.services;
          if (action.kind === "history.jumpTo") {
            const plan = s.history?.plan(action.entryId);
            return !s.history ? refusal("invalid_value", "History steps are not available in this host.") :
              !plan ? refusal("missing_target", "That history step no longer exists.") :
              plan.direction === "none" ? refusal("invalid_value", "This is already the current step.") : { available: true };
          }
          if (action.kind === "history.undo") return s.document.canUndo ? { available: true } :
            refusal("invalid_value", "There is no recipe change to undo.");
          return !s.history ? refusal("invalid_value", "Redo is not available in this host.") :
            s.history.canRedo() ? { available: true } : refusal("invalid_value", "There is no undone change to redo.");
        },
        dispatch: action => {
          const s = app.services;
          return action.kind === "history.jumpTo" ? s.history!.jumpTo(action.entryId) :
            action.kind === "history.undo" ? s.undo() : s.history!.redo();
        },
      },
      "eye-makeup": {
        capability: action => app.eyeMakeupSpec(action).capability(app.services.eyeMakeup.state(), action),
        dispatch: action => {
          const s = app.services, spec = app.eyeMakeupSpec(action);
          // The step is named by the registered spec (feature-module platform §3).
          s.document.withHistoryLabel(spec.label(action), () => s.eyeMakeup.apply(spec, action, recorded(action)));
          return undefined;
        },
      },
      collection: {
        capability: action => app.services.collection?.actionCapability(action) ?? missing("Collection is still loading."),
        dispatch: action => { app.services.collection!.dispatch(action); return undefined; },
      },
      preview: {
        capability: action => app.services.preview?.check(action) ?? missing("Preview is still loading."),
        dispatch: action => app.services.preview!.dispatch(action),
      },
      motion: {
        capability: action => app.services.motion?.capability(action) ?? missing("Motion preview is still loading."),
        dispatch: action => app.services.motion!.dispatch(action),
      },
      quality: {
        capability: action => app.services.quality?.capability(action) ?? missing("Preview quality is still loading."),
        dispatch: action => app.services.quality!.dispatch(action),
      },
      savedV: {
        capability: action => app.services.savedV?.capability(action) ?? missing("Saved appearance preview is still loading."),
        dispatch: action => app.services.savedV!.dispatch(action),
      },
    };
  }
  /**
   * The asynchronous families' live behaviour: library requests run on the collection service and file
   * workflows on the file operations, each attached by the composition root when it exists.
   */
  private bindAsyncHandlers(): AsyncHandlers {
    const app = this;
    return {
      library: {
        capability: request => coded(app.services.collection?.capability(request) ?? missing("Collection is still loading.")),
        execute: async request => app.services.collection?.execute(request)
          ?? { ok: false as const, code: "unavailable", message: "Collection is still loading." },
      },
      files: {
        capability: action => app.services.files?.capability(action) ?? missing("Files are still loading."),
        execute: async action => app.services.files?.execute(action)
          ?? { ok: false as const, code: "unavailable", message: "Files are still loading." },
      },
    };
  }
  /** The async family that owns `kind`, when it is `family`. */
  private ownsAsync(family: StudioRequestOwnerId, kind: string) {
    const route = this.routes.routeAsync(kind);
    return route.ok && route.owner.id === family;
  }
  /** Candidate actions use the hit target, never the currently selected row. */
  actionsFor(target: StudioTarget): StudioActionInfo[] {
    const s = this.services, recipe = s.document.snapshot().recipe;
    let actions: StudioAction[] = [];
    if (target.kind === "workspace") actions = [{ kind: "history.undo" }];
    if (target.kind === "collection") actions = [
      { kind: "preset.edit", command: { kind: "add" } }, { kind: "preset.edit", command: { kind: "restore" } },
      { kind: "collection.undoOpen" }];
    if (target.kind === "preset") actions = [
      { kind: "preset.select", id: target.id }, { kind: "preset.edit", command: { kind: "copy", id: target.id } },
      { kind: "preset.edit", command: { kind: "remove", id: target.id } }];
    if (target.kind === "layer") actions = [
      { kind: "layer.select", layerId: target.id },
      { kind: "layer.edit", command: { kind: "duplicate", id: target.id } },
      { kind: "layer.edit", command: { kind: "remove", id: target.id } },
      { kind: "layer.setEnabled", id: target.id,
        enabled: !recipe.layers.find(layer => layer.id === target.id)?.enabled }];
    if (target.kind === "point") actions = [
      { kind: "point.select", layerId: target.layerId, index: target.index },
      { kind: "point.remove", layerId: target.layerId, index: target.index }];
    if (target.kind === "field") actions = [
      { kind: "field.select", layerId: target.layerId, fieldId: target.id },
      { kind: "field.clear", layerId: target.layerId, fieldId: target.id },
      { kind: "field.remove", layerId: target.layerId, fieldId: target.id }];
    if (target.kind === "viewport") actions = [{ kind: "camera.front" }, { kind: "quality.rebuild" }];
    return actions.map(action => ({ action, capability: this.capability(action),
      undo: this.routes.undoPolicy(action), async: false }));
  }
  dispatch(action: StudioAction): StudioDispatchResult {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Action unavailable." };
    // capability() refuses unknown kinds, so the route is known here.
    const route = this.routes.route(action.kind);
    if (!route.ok) return { ok: false, code: "invalid_value", message: "Unknown command." };
    try { return { ok: true, result: this.handler(route.owner.id).dispatch(action) }; }
    catch (error) { return { ok: false, ...failure(route.owner.owner === "system" ? route.owner.thrown : undefined, error) }; }
  }
  /** A pointer gesture owns the Undo transaction while it runs; a form control cannot start inside it. */
  controlBegin(id: string, layerId: string) {
    if (this.gesture || this.look || this.unowned()) return false;
    const begun = this.services.controls.begin(id, layerId); if (begun) this.notify(); return begun;
  }
  /**
   * One continuous form edit inside the control's Undo transaction. It passes the same
   * capability gate as dispatch (target, payload ranges, domain rules) and returns a typed
   * result instead of throwing. A refused edit never opens a transaction; a failed edit
   * inside an open one leaves the recipe unchanged, and the control still commits or
   * cancels that transaction as usual.
   */
  controlEdit(id: string, action: RecipeAction): StudioDispatchResult {
    if (this.gesture) return { ok: false, code: "busy", message: "Finish or cancel the current gesture first (Esc)." };
    // Form controls adjust recipe content through AuthoringControlEdits, which takes recipe actions only.
    if (!RECIPE_ACTION_KINDS.has(action.kind) || this.routes.descriptor(action.kind)?.effect !== "content")
      return { ok: false, code: "invalid_value", message: "That command cannot be adjusted by a form control." };
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Action unavailable." };
    try {
      const outcome = this.services.controls.edit(id, action.layerId, action);
      if (outcome === "stale") return { ok: false, code: "missing_target",
        message: "That layer changed while you were adjusting it; the edit was not applied." };
      return { ok: true, result: outcome === "changed" };
    } catch (error) { return { ok: false, ...failure(undefined, error) }; }
  }
  controlCommit(id: string) { this.services.controls.commit(id); this.notify(); }
  controlCancel(id: string) { this.services.controls.cancel(id); this.notify(); }
  /** A library request's capability, routed by the registry to the `library` family. */
  requestCapability(request: CollectionRequest): StudioCapability {
    return this.ownsAsync("library", request.kind) ? this.asyncHandlers.library.capability(request) : unknownCommand();
  }
  async execute(request: CollectionRequest) {
    return this.ownsAsync("library", request.kind) ? this.asyncHandlers.library.execute(request)
      : { ok: false as const, code: "invalid_value", message: "Unknown command." };
  }
  /** A file workflow's capability, routed by the registry to the `files` family (the workflow's own answer). */
  fileCapability(action: StudioFileAction): { available: boolean; reason?: string; code?: ReasonCode } {
    return this.ownsAsync("files", action.kind) ? this.asyncHandlers.files.capability(action) : unknownCommand();
  }
  executeFile(action: StudioFileAction): Promise<StudioFileOutcome> {
    return this.ownsAsync("files", action.kind) ? this.asyncHandlers.files.execute(action)
      : Promise.resolve({ ok: false, code: "invalid_value", message: "Unknown command." });
  }
  /** True when a collection is loaded and no preset owns the editor recipe. */
  private unowned() {
    const owner = this.services.collection?.selectedPreset();
    return !!owner?.loaded && !owner.id;
  }
  canBeginGesture(source: GestureSource, layerId: string): StudioCapability {
    if (this.unowned()) return { available: false, code: "missing_target", reason: NO_PRESET };
    if (source === "surface" && this.previewUnavailable)
      return { available: false, code: "asset_unavailable", reason: this.previewUnavailable };
    if (this.gesture || this.look) return { available: false, code: "busy", reason: "Another gesture is active." };
    return this.targetCapability({ kind: "layer", id: layerId });
  }
  gestureCapability(source: GestureSource, target: { kind: "shape" | "path" } |
    { kind: "point"; index: number } | { kind: "field"; fieldId: string }): StudioCapability {
    const session = this.gesture;
    if (!session || session.source !== source) return { available: false, code: "not_ready",
      reason: "Begin a gesture on the target layer first." };
    if (!this.services.document.recipe.layers.includes(session.layer))
      return missingTarget("That gesture layer was replaced.");
    if (target.kind === "point" && (!session.points[target.index] ||
      session.layer.points[target.index] !== session.points[target.index]))
      return missingTarget("That control point was replaced.");
    if (target.kind === "field" && (!session.fields.has(target.fieldId) ||
      session.layer.fields.find(field => field.id === target.fieldId) !==
      session.fields.get(target.fieldId))) return missingTarget("That warp control was replaced.");
    return { available: true };
  }
  beginGesture(source: GestureSource, layerId: string) {
    if (!this.canBeginGesture(source, layerId).available) return false;
    const layer = this.services.document.recipe.layers.find(item => item.id === layerId);
    if (!layer) return false;
    // Finish an open form transaction first, so its later Escape cannot revert this gesture.
    const control = this.services.controls.snapshot();
    if (control) this.services.controls.commit(control.id);
    if (!this.services.gestures.begin(source, layer)) return false;
    this.gesture = { source, layer, points: [...layer.points],
      fields: new Map(layer.fields.map(field => [field.id, field])) }; this.notify(); return true;
  }
  applyGesture(source: GestureSource, proposal: StudioGestureProposal) {
    const session = this.gesture;
    if (!session || session.source !== source) return false;
    const target = proposal.kind === "point.replace" ? { kind: "point" as const, index: proposal.index } :
      proposal.kind === "field.replace" ? { kind: "field" as const, fieldId: proposal.fieldId } :
      proposal.kind === "path.replacePoints" ? { kind: "path" as const } : { kind: "shape" as const };
    if (!this.gestureCapability(source, target).available) return false;
    const base = { layerId: session.layer.id, expectedLayer: session.layer };
    const action: GestureEdit = proposal.kind === "shape.replace" ? { ...base, ...proposal } :
      proposal.kind === "point.replace" ? { ...base, ...proposal,
        expectedPoint: session.points[proposal.index] } :
      proposal.kind === "field.replace" ? { ...base, ...proposal,
        expectedField: session.fields.get(proposal.fieldId)! } : { ...base, ...proposal };
    if (proposal.kind === "point.replace" && !session.points[proposal.index] ||
      proposal.kind === "field.replace" && !session.fields.has(proposal.fieldId)) return false;
    return this.services.gestures.apply(source, action);
  }
  endGesture(source: GestureSource, cancel = false) {
    if (this.gesture?.source !== source) return;
    if (cancel) this.services.gestures.cancel(source); else this.services.gestures.commit(source);
    this.gesture = undefined; this.notify();
  }
}
/** Descriptor payload check for a concrete action: top-level fields, then its command/key variant. */
function payloadIssue(descriptor: PlatformDescriptor, action: StudioAction): StudioCapability | undefined {
  const payload = action as unknown as Record<string, unknown>;
  const command = payload.command && typeof payload.command === "object"
    ? payload.command as Record<string, unknown> : undefined;
  const flattened = { ...payload, ...command };
  for (const [name, schema] of Object.entries(descriptor.payload)) {
    const issue = fieldIssue(flattened[name], schema, name);
    if (issue) return issue;
  }
  const variant = command?.kind ?? (typeof payload.key === "string" ? payload.key : undefined);
  const variantFields = variant !== undefined ? descriptor.variants?.[String(variant)]?.payload : undefined;
  if (variantFields) for (const [name, schema] of Object.entries(variantFields)) {
    const issue = fieldIssue(flattened[name], schema, name);
    if (issue) return issue;
  }
}
/**
 * Classify an exception thrown after the capability gate passed, by where it came from:
 * a collection service error keeps its own code; a programming fault is "internal"; a
 * device-backed family (preview, camera, motion, quality) reports its declared `thrown`
 * code, "unavailable"; anything else is the domain rejecting the resulting content ("invalid_value").
 */
function failure(thrown: ReasonCode | undefined, error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CollectionServiceError) return { code: error.code, message };
  if (error instanceof TypeError || error instanceof ReferenceError)
    return { code: "internal", message: `That change could not be applied because of an internal error (${message}). Nothing was changed.` };
  return { code: thrown ?? "invalid_value", message };
}
function fieldIssue(value: unknown, schema: ValueSchema, field: string): StudioCapability | undefined {
  const refused = (code: StudioReasonCode, issue: ValidationIssue): StudioCapability =>
    ({ available: false, code, reason: issue.message, issue });
  if (value === undefined || value === null) return schema.required
    ? refused("needs_input", { code: "required", field, message: "This command needs a value." }) : undefined;
  const good = schema.type === "enum" ? schema.values?.includes(value as string | number) :
    schema.type === "integer" ? Number.isInteger(value) :
    schema.type === "number" ? typeof value === "number" && Number.isFinite(value) :
    schema.type === "number|string" ? typeof value === "string" || typeof value === "number" && Number.isFinite(value) :
    schema.type === "string" ? typeof value === "string" :
    schema.type === "boolean" ? typeof value === "boolean" :
    schema.type === "bytes" ? value instanceof Uint8Array || value instanceof ArrayBuffer :
    typeof value === "object";
  if (!good) return refused("invalid_value", { code: "format", field, message: "The value has the wrong type or choice." });
  if (typeof value === "number" && (schema.min !== undefined && value < schema.min ||
    schema.max !== undefined && value > schema.max))
    return refused("limit", { code: "range", field, message: "The value is outside the supported range." });
  if (typeof value === "string" && field === "name") {
    const issue = nameIssue(value, schema.maxLength ?? Number.POSITIVE_INFINITY, field);
    if (issue) return refused("invalid_value", issue);
  }
  if (typeof value === "string" && (schema.minLength !== undefined && value.length < schema.minLength ||
    schema.maxLength !== undefined && value.length > schema.maxLength))
    return refused("limit", { code: "range", field, message: "The text length is outside the supported range." });
}
const NO_PRESET = "Add or select a preset first; layers belong to a preset.";
function missing(reason: string): StudioCapability { return { available: false, code: "not_ready", reason }; }
function missingTarget(reason: string): StudioCapability { return { available: false, code: "missing_target", reason }; }
function unknownCommand(): StudioCapability { return { available: false, code: "invalid_value", reason: "Unknown command." }; }
