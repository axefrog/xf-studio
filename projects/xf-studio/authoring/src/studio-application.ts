import type { AuthoringDocument } from "./authoring-document";
import type { AuthoringControlEdits } from "./authoring-control-edits";
import type { AuthoringGestures, GestureSource } from "./authoring-gestures";
import type { CollectionAction } from "./collection-actions";
import type { CollectionRequest, CollectionService } from "./collection-service";
import { layerCapability, type LayerAction } from "./editor-actions";
import type { MotionAction, MotionActions } from "./motion-actions";
import type { PreviewAction, PreviewActions } from "./preview-actions";
import type { QualityAction, PreviewQualityActions } from "./preview-quality-actions";
import type { Layer, Point, WarpField } from "./recipe";
import type { GestureEdit, RecipeAction, RecipeActions } from "./recipe-actions";
import type { SavedAppearanceAction, SavedAppearanceActions, SavedAppearanceState } from "./saved-appearance-actions";
import { ACTION_DESCRIPTORS, GESTURE_DESCRIPTORS, REQUEST_DESCRIPTORS,
  type ValueSchema } from "./studio-action-descriptors";
import { contextCandidates, contextScope, geometryHit,
  type StudioBoundContext, type StudioContextHit } from "./studio-context-targets";
import { finishCatalogue, glitterModelCatalogue } from "./finish-catalogue";

export type StudioAction = { kind: "recipe.undo" } | RecipeAction | LayerAction | Exclude<CollectionAction, { kind: "collection.saved" }> | PreviewAction |
  MotionAction | QualityAction | SavedAppearanceAction;
export type StudioTarget = { kind: "collection" } | { kind: "preset"; id: string } |
  { kind: "layer"; id: string } | { kind: "point"; layerId: string; index: number } |
  { kind: "field"; layerId: string; id: string } | { kind: "viewport" } | { kind: "file" } | { kind: "workspace" };
export type StudioReasonCode = "missing_target" | "busy" | "limit" | "invalid_value" |
  "incompatible_mode" | "asset_unavailable" | "not_ready" | "unavailable" | "needs_input";
export type StudioCapability = { available: boolean; reason?: string; code?: StudioReasonCode };
export type StudioActionInfo = { action: StudioAction; capability: StudioCapability;
  undo: "none" | "recipe" | "transaction" | "recovery"; async: false };
export type StudioGestureProposal =
  | { kind: "shape.replace"; next: Layer }
  | { kind: "point.replace"; index: number; next: Partial<Point> }
  | { kind: "field.replace"; fieldId: string; next: Partial<WarpField> }
  | { kind: "path.replacePoints"; points: Point[] };

type Services = { document: AuthoringDocument; recipe: RecipeActions;
  layer: (action: LayerAction) => void; undo: () => boolean;
  gestures: AuthoringGestures; controls: AuthoringControlEdits;
  collection?: CollectionService; preview?: PreviewActions; motion?: MotionActions;
  quality?: PreviewQualityActions; savedV?: SavedAppearanceActions };
const selection = new Set<StudioAction["kind"]>(["layer.select", "point.select", "field.select"]);
const recipeKinds = new Set<StudioAction["kind"]>([
  "layer.select", "point.select", "point.remove", "path.edit", "field.select", "field.add",
  "field.remove", "field.clear", "field.setReach", "pigment.edit", "softness.edit",
  "layer.setColor", "layer.setOpacity", "layer.setSymmetry", "layer.setFinish",
  "glitter.selectModel", "glitter.setClassic", "glitter.setIrregular", "glitter.setDirect"]);
const collectionKinds = new Set<StudioAction["kind"]>([
  "preset.edit", "preset.select", "preset.expand", "collection.rename", "collection.filesOpen",
  "collection.open", "collection.undoOpen", "collection.importRecipe"]);
const recovery = new Set<StudioAction["kind"]>(["collection.undoOpen"]);

/** One read-only, target-aware entry point for a replaceable presentation. */
export class StudioApplication {
  private services: Services;
  private listeners = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private collectionRevision = 0;
  private previewUnavailable?: string;
  private gesture?: { source: GestureSource; layer: Layer; points: Point[]; fields: Map<string, WarpField> };
  constructor(services: Services) { this.services = services; this.subscribeSources(); }
  attach(next: Partial<Omit<Services, "document" | "recipe" | "layer" | "gestures" | "controls">>) {
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
    if (s.collection) this.unsubs.push(s.collection.subscribe(() => {
      this.collectionRevision++; this.notify();
    }));
    for (const source of [s.preview, s.motion, s.quality, s.savedV])
      if (source) this.unsubs.push(source.subscribe(() => this.notify()));
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** Exact command IDs; nested preset/layer command variants retain their typed payloads. */
  actionKinds() { return Object.keys(ACTION_DESCRIPTORS) as StudioAction["kind"][]; }
  requestKinds() { return Object.keys(REQUEST_DESCRIPTORS) as CollectionRequest["kind"][]; }
  actionDescriptors() { return structuredClone(ACTION_DESCRIPTORS); }
  requestDescriptors() { return structuredClone(REQUEST_DESCRIPTORS); }
  gestureDescriptors() { return structuredClone(GESTURE_DESCRIPTORS); }
  /** Full scope listing; payload-required entries must still be checked with capability(actualAction). */
  descriptorsFor(target: StudioTarget) {
    const targetCapability = this.targetCapability(target);
    return Object.entries(ACTION_DESCRIPTORS).filter(([, descriptor]) =>
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
    if (target.kind === "preset" && !s.collection?.view().draft?.collection.presets.some(preset => preset.id === target.id))
      return s.collection ? missingTarget("That preset no longer exists.") : missing("Collection is still loading.");
    if (target.kind === "collection" && !s.collection?.view().draft) return missing("Collection is still loading.");
    if ((target.kind === "collection" || target.kind === "preset") && s.collection?.view().busy)
      return { available: false, code: "busy", reason: "A collection request is in progress." };
    return { available: true };
  }
  /** Validate a concrete target/payload pair before a menu, shortcut or form dispatches it. */
  contextCapability(target: StudioTarget, action: StudioAction): StudioCapability {
    const descriptor = ACTION_DESCRIPTORS[action.kind];
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
    // A range limit is generic; when the domain can say why in the user's terms
    // (for example "already at the front"), show that instead.
    const explain = (issue: StudioCapability) => {
      if (issue.code !== "limit") return issue;
      const domain = this.capability(action);
      return !domain.available && domain.reason ? domain : issue;
    };
    for (const [name, schema] of Object.entries(descriptor.payload)) {
      const issue = fieldIssue(flattened[name], schema);
      if (issue) return explain(issue);
    }
    const variant = command?.kind ?? (typeof payload.key === "string" ? payload.key : undefined);
    const variantFields = variant && descriptor.variants?.[String(variant)]?.payload;
    if (variantFields) for (const [name, schema] of Object.entries(variantFields)) {
      const issue = fieldIssue(flattened[name], schema);
      if (issue) return explain(issue);
    }
    return this.capability(action);
  }
  /** Enumerated values and their live capability for a concrete target. */
  choicesFor(target: StudioTarget, kind: StudioAction["kind"], field: string,
    base: Record<string, unknown> = {}) {
    const schema = ACTION_DESCRIPTORS[kind].payload[field];
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
    const draft = this.services.collection?.view().draft;
    return Object.freeze({ hit: Object.freeze(structuredClone(hit)), collectionId: draft?.collection.id,
      selectedPresetId: draft?.selected,
      collectionRevision: this.collectionRevision,
      geometryRevision: this.services.document.geometryVersion.revision });
  }
  private boundContextCapability(context: StudioBoundContext): StudioCapability {
    const draft = this.services.collection?.view().draft;
    if (context.collectionRevision !== this.collectionRevision)
      return missingTarget("The collection changed after this menu opened.");
    if (context.collectionId !== draft?.collection.id)
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
        undo: undoPolicy(candidate.action) };
      let capability = bound;
      if (capability.available && (hit.kind === "point" || hit.kind === "tangent")) {
        if (candidate.id === "point.softness" &&
          this.services.document.recipe.layers.find(layer => layer.id === hit.layerId)?.softness.mode !== "boundary")
          capability = { available: false, code: "incompatible_mode",
            reason: "Enable point edge softness before editing an individual edge." };
      }
      return { ...candidate, capability, undo: ACTION_DESCRIPTORS[candidate.actionKind].undo };
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
      reason: "No standalone edit command applies to empty UV space." };
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
  dispatchContext(context: StudioBoundContext, action: StudioAction) {
    const allowed = this.boundActionCapability(context, action);
    return allowed.available ? this.dispatch(action) : { ok: false as const,
      code: allowed.code ?? "unavailable", message: allowed.reason ?? "Action unavailable." };
  }
  snapshot() {
    const s = this.services;
    return structuredClone({ document: s.document.snapshot(), collection: s.collection?.view(),
      preview: s.preview?.snapshot(), previewOptions: s.preview?.piercingOptions(), motion: s.motion?.snapshot(),
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
      motion: s.motion?.snapshot(), quality: s.quality?.snapshot(),
      savedV: { loaded: !!saved?.savedV, gameVersion: saved?.savedV?.gameVersion,
        result: saved?.result, suggestedEyeShape: saved?.suggestedEyeShape },
      gesture: s.gestures.snapshot(), control: s.controls.snapshot() });
  }
  /** Static finish and Glitter-model descriptors, including the compiler's export gate. */
  finishCatalogue() { return finishCatalogue(); }
  glitterModelCatalogue() { return glitterModelCatalogue(); }
  /** A saved-V adapter has already applied the morph; synchronize only the selector. */
  recordAppliedSavedAppearance(result: Readonly<Pick<SavedAppearanceState, "suggestedEyeShape">>) {
    if (result.suggestedEyeShape !== undefined) this.services.preview?.rememberEyeShape(result.suggestedEyeShape);
  }
  capability(action: StudioAction): StudioCapability {
    const s = this.services;
    if (this.previewUnavailable && (action.kind.startsWith("preview.") || action.kind.startsWith("camera.") ||
      action.kind.startsWith("motion.") || action.kind.startsWith("savedV.")))
      return { available: false, code: "asset_unavailable", reason: this.previewUnavailable };
    let raw: { available: boolean; reason?: string };
    if (action.kind === "recipe.undo") raw = s.document.canUndo ? { available: true } :
      { available: false, reason: "There is no recipe change to undo." };
    else if (recipeKinds.has(action.kind)) raw = s.recipe.capability(action as RecipeAction);
    else if (action.kind === "layer.edit" || action.kind === "layer.setEnabled")
      raw = layerCapability(s.document.recipe, action);
    else if (collectionKinds.has(action.kind)) raw = s.collection?.actionCapability(action as CollectionAction)
      ?? missing("Collection is still loading.");
    else if (action.kind.startsWith("preview.") || action.kind.startsWith("camera."))
      raw = s.preview?.capability(action as PreviewAction) ?? missing("Preview is still loading.");
    else if (action.kind.startsWith("motion."))
      raw = s.motion?.capability(action as MotionAction) ?? missing("Motion preview is still loading.");
    else if (action.kind.startsWith("quality."))
      raw = s.quality?.capability(action as QualityAction) ?? missing("Preview quality is still loading.");
    else raw = s.savedV?.capability(action as SavedAppearanceAction) ?? missing("Saved appearance preview is still loading.");
    return raw.available ? { available: true } : { ...raw, code: reasonCode(action, raw.reason ?? "") };
  }
  /** Candidate actions use the hit target, never the currently selected row. */
  actionsFor(target: StudioTarget): StudioActionInfo[] {
    const s = this.services, recipe = s.document.snapshot().recipe;
    let actions: StudioAction[] = [];
    if (target.kind === "workspace") actions = [{ kind: "recipe.undo" }];
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
      undo: undoPolicy(action), async: false }));
  }
  dispatch(action: StudioAction): { ok: true; result?: unknown } | { ok: false; code: string; message: string } {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Action unavailable." };
    try {
      const s = this.services;
      let result: unknown;
      if (action.kind === "recipe.undo") result = s.undo();
      else if (recipeKinds.has(action.kind)) s.recipe.dispatch(action as RecipeAction, !selection.has(action.kind));
      else if (action.kind === "layer.edit" || action.kind === "layer.setEnabled") s.layer(action);
      else if (collectionKinds.has(action.kind)) s.collection!.dispatch(action as CollectionAction);
      else if (action.kind.startsWith("preview.") || action.kind.startsWith("camera.")) result = s.preview!.dispatch(action as PreviewAction);
      else if (action.kind.startsWith("motion.")) result = s.motion!.dispatch(action as MotionAction);
      else if (action.kind.startsWith("quality.")) result = s.quality!.dispatch(action as QualityAction);
      else result = s.savedV!.dispatch(action as SavedAppearanceAction);
      return { ok: true, result };
    } catch (error) { return { ok: false, code: "invalid_value", message: (error as Error).message }; }
  }
  controlBegin(id: string, layerId: string) {
    const begun = this.services.controls.begin(id, layerId); if (begun) this.notify(); return begun;
  }
  controlEdit(id: string, action: RecipeAction) { this.services.controls.edit(id, action.layerId, action); }
  controlCommit(id: string) { this.services.controls.commit(id); this.notify(); }
  controlCancel(id: string) { this.services.controls.cancel(id); this.notify(); }
  requestCapability(request: CollectionRequest): StudioCapability {
    const raw = this.services.collection?.capability(request) ?? missing("Collection is still loading.");
    return raw.available ? { available: true } : { ...raw,
      code: raw.reason?.includes("in progress") ? "busy" : raw.reason?.includes("loading") ? "not_ready" :
        raw.reason?.includes("budget") ? "limit" : "invalid_value" };
  }
  async execute(request: CollectionRequest) { return this.services.collection?.execute(request)
    ?? { ok: false as const, code: "unavailable", message: "Collection is still loading." }; }
  canBeginGesture(source: GestureSource, layerId: string): StudioCapability {
    if (source === "surface" && this.previewUnavailable)
      return { available: false, code: "asset_unavailable", reason: this.previewUnavailable };
    if (this.gesture) return { available: false, code: "busy", reason: "Another gesture is active." };
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
    if (!layer || !this.services.gestures.begin(source, layer)) return false;
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
function fieldIssue(value: unknown, schema: ValueSchema): StudioCapability | undefined {
  if (value === undefined || value === null) return schema.required
    ? { available: false, code: "needs_input", reason: "This command needs a value." } : undefined;
  const good = schema.type === "enum" ? schema.values?.includes(value as string | number) :
    schema.type === "integer" ? Number.isInteger(value) :
    schema.type === "number" ? typeof value === "number" && Number.isFinite(value) :
    schema.type === "number|string" ? typeof value === "string" || typeof value === "number" && Number.isFinite(value) :
    schema.type === "string" ? typeof value === "string" :
    schema.type === "boolean" ? typeof value === "boolean" :
    schema.type === "bytes" ? value instanceof Uint8Array || value instanceof ArrayBuffer :
    typeof value === "object";
  if (!good) return { available: false, code: "invalid_value", reason: "The value has the wrong type or choice." };
  if (typeof value === "number" && (schema.min !== undefined && value < schema.min ||
    schema.max !== undefined && value > schema.max))
    return { available: false, code: "limit", reason: "The value is outside the supported range." };
  if (typeof value === "string" && (schema.minLength !== undefined && value.length < schema.minLength ||
    schema.maxLength !== undefined && value.length > schema.maxLength))
    return { available: false, code: "limit", reason: "The text length is outside the supported range." };
}
function missing(reason: string): StudioCapability { return { available: false, code: "not_ready", reason }; }
function missingTarget(reason: string): StudioCapability { return { available: false, code: "missing_target", reason }; }
function reasonCode(action: StudioAction, reason: string): StudioReasonCode {
  if (reason.includes("loading")) return "not_ready";
  if (reason.includes("in progress")) return "busy";
  if (reason.includes("no longer exists") || reason.includes("not found")) return "missing_target";
  if (reason.includes("supports up to") || reason.includes("at least") || reason.includes("larger than") ||
    reason.includes("budget")) return "limit";
  if (action.kind.startsWith("glitter.") && reason.includes("Select")) return "incompatible_mode";
  if ((action.kind === "preview.setHair" || action.kind === "preview.setDetail" ||
    action.kind === "preview.setPiercings" || action.kind.startsWith("motion.")) &&
    reason.includes("unavailable")) return "asset_unavailable";
  if (reason.includes("unavailable")) return "unavailable";
  return "invalid_value";
}
function undoPolicy(action: StudioAction): StudioActionInfo["undo"] {
  if (action.kind === "recipe.undo" || selection.has(action.kind) || action.kind.startsWith("preview.") ||
    action.kind.startsWith("camera.") || action.kind.startsWith("motion.") ||
    action.kind.startsWith("quality.") || action.kind.startsWith("savedV.")) return "none";
  if (action.kind === "preset.edit" && action.command.kind === "remove" ||
    recovery.has(action.kind) || action.kind === "collection.open") return "recovery";
  if (collectionKinds.has(action.kind)) return "none";
  return "recipe";
}
