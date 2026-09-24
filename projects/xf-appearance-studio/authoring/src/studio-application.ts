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
import type { SavedAppearanceAction, SavedAppearanceActions } from "./saved-appearance-actions";

export type StudioAction = RecipeAction | LayerAction | Exclude<CollectionAction, { kind: "collection.saved" }> | PreviewAction |
  MotionAction | QualityAction | SavedAppearanceAction;
export type StudioTarget = { kind: "collection" } | { kind: "preset"; id: string } |
  { kind: "layer"; id: string } | { kind: "point"; layerId: string; index: number } |
  { kind: "field"; layerId: string; id: string } | { kind: "viewport" };
export type StudioCapability = { available: boolean; reason?: string; code?: string };
export type StudioActionInfo = { action: StudioAction; capability: StudioCapability;
  undo: "none" | "recipe" | "transaction" | "recovery"; async: false };
export type StudioGestureProposal =
  | { kind: "shape.replace"; next: Layer }
  | { kind: "point.replace"; index: number; next: Partial<Point> }
  | { kind: "field.replace"; fieldId: string; next: Partial<WarpField> }
  | { kind: "path.replacePoints"; points: Point[] };

type Services = { document: AuthoringDocument; recipe: RecipeActions;
  layer: (action: LayerAction) => void; gestures: AuthoringGestures; controls: AuthoringControlEdits;
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
  private gesture?: { source: GestureSource; layer: Layer; points: Point[]; fields: Map<string, WarpField> };
  constructor(services: Services) { this.services = services; this.subscribeSources(); }
  attach(next: Partial<Omit<Services, "document" | "recipe" | "layer" | "gestures" | "controls">>) {
    this.services = { ...this.services, ...next }; this.subscribeSources(); this.notify();
  }
  private notify() { for (const listener of this.listeners) listener(); }
  private subscribeSources() {
    for (const unsub of this.unsubs) unsub();
    const s = this.services;
    this.unsubs = [s.document.subscribe(() => this.notify())];
    for (const source of [s.collection, s.preview, s.motion, s.quality, s.savedV])
      if (source) this.unsubs.push(source.subscribe(() => this.notify()));
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** Exact command IDs; nested preset/layer command variants retain their typed payloads. */
  actionKinds() { return [...recipeKinds, "layer.edit", "layer.setEnabled", ...collectionKinds,
    "camera.front", "camera.setFov", "camera.endFovGesture", "camera.restore",
    "preview.setExposure", "preview.setKeyAngle", "preview.setEyeShape", "preview.setPiercingPreview",
    "preview.setPiercings", "preview.setSurfaceControls", "preview.setWire", "preview.setNormals",
    "preview.setEyeOptics", "preview.setHair", "preview.setDetail",
    "motion.setIdle", "motion.setPaused", "motion.setContributions", "motion.setBlink", "motion.playBlink",
    "quality.set", "quality.rebuild", "savedV.load", "savedV.restore"] as const; }
  requestKinds() { return ["initialize", "refresh", "open", "save", "saveCopy", "exportCollection",
    "exportPlan", "import", "package"] as const; }
  snapshot() {
    const s = this.services;
    return structuredClone({ document: s.document.snapshot(), collection: s.collection?.view(),
      preview: s.preview?.snapshot(), motion: s.motion?.snapshot(),
      quality: s.quality?.snapshot(), savedV: s.savedV?.snapshot(),
      gesture: s.gestures.snapshot(), control: s.controls.snapshot() });
  }
  capability(action: StudioAction): StudioCapability {
    const s = this.services;
    if (recipeKinds.has(action.kind)) return s.recipe.capability(action as RecipeAction);
    if (action.kind === "layer.edit" || action.kind === "layer.setEnabled")
      return layerCapability(s.document.recipe, action);
    if (collectionKinds.has(action.kind)) return s.collection?.actionCapability(action as CollectionAction)
      ?? { available: false, code: "unavailable", reason: "Collection is still loading." };
    if (action.kind.startsWith("preview.") || action.kind.startsWith("camera."))
      return s.preview?.capability(action as PreviewAction) ?? missing("Preview is still loading.");
    if (action.kind.startsWith("motion."))
      return s.motion?.capability(action as MotionAction) ?? missing("Motion preview is still loading.");
    if (action.kind.startsWith("quality."))
      return s.quality?.capability(action as QualityAction) ?? missing("Preview quality is still loading.");
    return s.savedV?.capability(action as SavedAppearanceAction) ?? missing("Saved appearance preview is still loading.");
  }
  /** Candidate actions use the hit target, never the currently selected row. */
  actionsFor(target: StudioTarget): StudioActionInfo[] {
    const s = this.services, recipe = s.document.snapshot().recipe;
    let actions: StudioAction[] = [];
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
      if (recipeKinds.has(action.kind)) s.recipe.dispatch(action as RecipeAction, !selection.has(action.kind));
      else if (action.kind === "layer.edit" || action.kind === "layer.setEnabled") s.layer(action);
      else if (collectionKinds.has(action.kind)) s.collection!.dispatch(action as CollectionAction);
      else if (action.kind.startsWith("preview.") || action.kind.startsWith("camera.")) result = s.preview!.dispatch(action as PreviewAction);
      else if (action.kind.startsWith("motion.")) result = s.motion!.dispatch(action as MotionAction);
      else if (action.kind.startsWith("quality.")) result = s.quality!.dispatch(action as QualityAction);
      else result = s.savedV!.dispatch(action as SavedAppearanceAction);
      return { ok: true, result };
    } catch (error) { return { ok: false, code: "invalid", message: (error as Error).message }; }
  }
  controlBegin(id: string, layerId: string) {
    const begun = this.services.controls.begin(id, layerId); if (begun) this.notify(); return begun;
  }
  controlEdit(id: string, action: RecipeAction) { this.services.controls.edit(id, action.layerId, action); }
  controlCommit(id: string) { this.services.controls.commit(id); this.notify(); }
  controlCancel(id: string) { this.services.controls.cancel(id); this.notify(); }
  requestCapability(request: CollectionRequest) { return this.services.collection?.capability(request)
    ?? missing("Collection is still loading."); }
  async execute(request: CollectionRequest) { return this.services.collection?.execute(request)
    ?? { ok: false as const, code: "unavailable", message: "Collection is still loading." }; }
  beginGesture(source: GestureSource, layerId: string) {
    const layer = this.services.document.recipe.layers.find(item => item.id === layerId);
    if (!layer || !this.services.gestures.begin(source, layer)) return false;
    this.gesture = { source, layer, points: [...layer.points],
      fields: new Map(layer.fields.map(field => [field.id, field])) }; this.notify(); return true;
  }
  applyGesture(source: GestureSource, proposal: StudioGestureProposal) {
    const session = this.gesture;
    if (!session || session.source !== source) return false;
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
function missing(reason: string): StudioCapability { return { available: false, code: "unavailable", reason }; }
function undoPolicy(action: StudioAction): StudioActionInfo["undo"] {
  if (selection.has(action.kind) || action.kind.startsWith("preview.") ||
    action.kind.startsWith("camera.") || action.kind.startsWith("motion.") ||
    action.kind.startsWith("quality.") || action.kind.startsWith("savedV.")) return "none";
  if (action.kind === "preset.edit" && action.command.kind === "remove" ||
    recovery.has(action.kind) || action.kind === "collection.open") return "recovery";
  if (collectionKinds.has(action.kind)) return "none";
  return "recipe";
}
