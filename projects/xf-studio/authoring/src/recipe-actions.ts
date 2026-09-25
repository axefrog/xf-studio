import { convertToBezier, moveTangent, setPointMode, type PathCommand } from "./bezier-path";
import { insertPathPoint } from "./path-edit";
import { transformLayer } from "./shape-transform";
import { isDirectGlint } from "./direct-glint-settings";
import type { FieldSelection } from "./field-selection";
import { canonicalFinish, defaultFlakes, isIrregular, type Flakes } from "./finish";
import { glitterModel, glitterModels, selectGlitterModel, validGlitterSettings, validShiftSettings,
  type GlitterChoices, type GlitterModel } from "./glitter-model";
import { editPigment, type PigmentCommand } from "./pigment-edit";
import { hasGameOptics } from "./finish-export";
import { clamp, DEFAULT_SHIFT, MAX_FIELDS, parseRecipe, type GameOptics, type Layer, type Point, type Recipe, type WarpField } from "./recipe";
import { requiredRecipeSchema } from "./recipe-schema";
import { editSoftness, type SoftnessCommand } from "./softness-edit";
import { refuse, type ValidationIssue } from "./validation-issues";

export type RecipeActionState = { recipe: Recipe; active: number; selected: number; fieldSelection: FieldSelection };
export type RecipeAction =
  | { kind: "layer.select"; layerId: string }
  | { kind: "point.select" | "point.remove"; layerId: string; index: number }
  | { kind: "path.edit"; layerId: string; command: PathCommand }
  | { kind: "field.select" | "field.add" | "field.remove" | "field.clear"; layerId: string; fieldId?: string }
  | { kind: "field.setReach"; layerId: string; fieldId: string; radius: number }
  | { kind: "pigment.edit"; layerId: string; command: PigmentCommand }
  | { kind: "softness.edit"; layerId: string; command: SoftnessCommand }
  | { kind: "layer.setColor"; layerId: string; color: string }
  | { kind: "layer.setOpacity"; layerId: string; opacity: number }
  | { kind: "layer.setSymmetry"; layerId: string; symmetry: boolean }
  | { kind: "layer.setFinish"; layerId: string; finish: Layer["finish"] }
  /** Switch a Glossy, Shimmer or Colour-shifting layer from its earlier browser study to the game-matched model. */
  | { kind: "layer.useGameOptics"; layerId: string }
  | { kind: "layer.setShift"; layerId: string; key: "color" | "strength"; value: number | string }
  | { kind: "glitter.selectModel"; layerId: string; model: GlitterModel }
  | { kind: "glitter.setClassic"; layerId: string; key: "cells" | "density" | "tilt"; value: number }
  | { kind: "glitter.setIrregular"; layerId: string; key: "count" | "radius" | "spread" | "tilt" | "color"; value: number | string }
  | { kind: "glitter.setDirect"; layerId: string; key: "density" | "fineShare" | "strength" | "color"; value: number | string }
  // Coordinate commands (audit A-5): canonical (unmirrored) UV, one Undo each, parser-validated.
  | { kind: "point.move"; layerId: string; index: number; u: number; v: number }
  | { kind: "point.insert"; layerId: string; u: number; v: number }
  | { kind: "point.setTangent"; layerId: string; index: number; side: "in" | "out"; du: number; dv: number }
  | { kind: "shape.transform"; layerId: string; command: ShapeCommand; pivotIndex?: number }
  | { kind: "field.setOrigin"; layerId: string; fieldId: string; u: number; v: number }
  | { kind: "field.setVector"; layerId: string; fieldId: string; du: number; dv: number };
/** Every recipe action kind. Typed as a record over the union so the compiler rejects a missing
 * or unknown kind; the application routes and labels recipe actions from this list. */
const RECIPE_ACTION_KIND_TABLE: Record<RecipeAction["kind"], true> = {
  "layer.select": true, "point.select": true, "point.remove": true, "path.edit": true, "field.select": true,
  "field.add": true, "field.remove": true, "field.clear": true, "field.setReach": true, "pigment.edit": true,
  "softness.edit": true, "layer.setColor": true, "layer.setOpacity": true, "layer.setSymmetry": true,
  "layer.setFinish": true, "layer.useGameOptics": true, "layer.setShift": true, "glitter.selectModel": true,
  "glitter.setClassic": true, "glitter.setIrregular": true, "glitter.setDirect": true, "point.move": true,
  "point.insert": true, "point.setTangent": true, "shape.transform": true, "field.setOrigin": true, "field.setVector": true,
};
export const RECIPE_ACTION_KINDS: ReadonlySet<string> = new Set(Object.keys(RECIPE_ACTION_KIND_TABLE));
/** Whole-shape transform about a contour point (the selected point unless `pivotIndex` is given). */
export type ShapeCommand = { kind: "translate"; du: number; dv: number } | { kind: "rotate"; radians: number } |
  { kind: "scale"; factor: number };
/** Contour point limit shared with pointer insertion. */
export const MAX_CONTOUR_POINTS = 24;

export type RecipeActionCapability = { available: boolean; reason?: string; issue?: ValidationIssue };
export type RecipeActionEffect = { kind: "selection" | "scheduled" | "immediate"; layerIndex: number };
export type GestureEdit =
  | { kind: "shape.replace"; layerId: string; expectedLayer: Layer; next: Layer }
  | { kind: "point.replace"; layerId: string; expectedLayer: Layer; index: number; expectedPoint: Point; next: Partial<Point> }
  | { kind: "field.replace"; layerId: string; expectedLayer: Layer; fieldId: string; expectedField: WarpField; next: Partial<WarpField> }
  | { kind: "path.replacePoints"; layerId: string; expectedLayer: Layer; points: Point[] };
type ReadonlyDeep<T> = T extends (infer U)[] ? readonly ReadonlyDeep<U>[] :
  T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;
export type ReadonlyRecipeState = ReadonlyDeep<RecipeActionState>;

/** Validate a gesture proposal before changing its live target, preserving point/field identity. */
export function applyGestureEdit(action: GestureEdit, schema: Recipe["schema"] = "xfs/recipe-7"): boolean {
  const layer = action.expectedLayer;
  const proposal = structuredClone(action.kind === "shape.replace" ? action.next : layer);
  let pointIndex = -1, fieldIndex = -1;
  if (action.kind === "point.replace") {
    pointIndex = action.index;
    if (layer.points[pointIndex] !== action.expectedPoint) return false;
    proposal.points[pointIndex] = { ...proposal.points[pointIndex], ...action.next };
  } else if (action.kind === "field.replace") {
    fieldIndex = layer.fields.findIndex(field => field.id === action.fieldId);
    if (fieldIndex < 0 || layer.fields[fieldIndex] !== action.expectedField) return false;
    proposal.fields[fieldIndex] = { ...proposal.fields[fieldIndex], ...action.next };
  } else if (action.kind === "path.replacePoints") proposal.points = action.points;
  const validated = parseRecipe({ schema, uv: "gltf-uv0-top-left", layers: [proposal] }).layers[0];
  if (JSON.stringify(validated) === JSON.stringify(layer)) return false;
  if (action.kind === "shape.replace") Object.assign(layer, validated);
  else if (action.kind === "point.replace") Object.assign(layer.points[pointIndex], validated.points[pointIndex]);
  else if (action.kind === "field.replace") Object.assign(layer.fields[fieldIndex], validated.fields[fieldIndex]);
  else layer.points = validated.points;
  return true;
}

export function recipeActionCapability(state: RecipeActionState, action: RecipeAction): RecipeActionCapability {
  const layer = state.recipe.layers.find(l => l.id === action.layerId);
  if (!layer) return { available: false, reason: "That layer no longer exists." };
  if (action.kind.startsWith("glitter.") && action.kind !== "glitter.setClassic" && layer.finish !== "glitter")
    return refuse({ code: "mode", field: "finish", message: "Select a Glitter layer first." });
  if ((action.kind === "point.move" || action.kind === "point.setTangent") &&
      (!Number.isInteger(action.index) || !layer.points[action.index]))
    return { available: false, reason: "That control point no longer exists." };
  if (action.kind === "point.setTangent" && (layer.pathMode !== "bezier" || !layer.points[action.index]?.handles))
    return refuse({ code: "mode", field: "pathMode", message: "Enable Bézier handles before editing a tangent." });
  if (action.kind === "point.insert" && layer.points.length >= MAX_CONTOUR_POINTS)
    return refuse({ code: "range", field: "points", message: `A contour supports up to ${MAX_CONTOUR_POINTS} points.` });
  if (action.kind === "shape.transform") {
    const pivot = action.pivotIndex ?? (state.recipe.layers[state.active]?.id === layer.id ? state.selected : 0);
    if (!Number.isInteger(pivot) || !layer.points[pivot])
      return refuse({ code: "range", field: "pivotIndex", message: "The pivot point no longer exists." });
  }
  if ((action.kind === "point.select" || action.kind === "point.remove") &&
      (!Number.isInteger(action.index) || !layer.points[action.index]))
    return { available: false, reason: "That control point no longer exists." };
  if (action.kind === "point.remove" && layer.points.length <= 3)
    return refuse({ code: "range", field: "points", message: "A closed contour needs at least three points." });
  if (action.kind === "field.add" && layer.fields.length >= MAX_FIELDS)
    return refuse({ code: "range", field: "fields", message: `A layer supports up to ${MAX_FIELDS} warp controls.` });
  if ((action.kind === "field.select" || action.kind === "field.remove" || action.kind === "field.setOrigin" ||
       action.kind === "field.setVector" || action.kind === "field.clear" || action.kind === "field.setReach") &&
      !layer.fields.some(field => field.id === action.fieldId))
    return { available: false, reason: "That warp control no longer exists." };
  if (action.kind === "glitter.setIrregular" && !isIrregular(layer.flakes))
    return refuse({ code: "mode", field: "model", message: "Select the irregular Glitter model first." });
  if (action.kind === "glitter.setDirect" && !isDirectGlint(layer.flakes))
    return refuse({ code: "mode", field: "model", message: "Select a direct-light Glitter model first." });
  if (action.kind === "glitter.setClassic" && (isIrregular(layer.flakes) || isDirectGlint(layer.flakes)))
    return refuse({ code: "mode", field: "model", message: "Select a classic flake model first." });
  if (action.kind === "layer.useGameOptics" && !hasGameOptics(layer.finish))
    return refuse({ code: "mode", field: "finish", message: "Only Glossy, Shimmer and Colour-shifting have a game-matched model." });
  if (action.kind === "layer.useGameOptics" && layer.optics)
    return refuse({ code: "mode", field: "optics", message: "This layer already uses the game-matched model." });
  if (action.kind === "layer.setShift" && !(layer.finish === "iridescent" && layer.optics?.shift))
    return refuse({ code: "mode", field: "optics", message: "Select a game-matched Colour-shifting layer first." });
  if (action.kind === "glitter.selectModel" && !glitterModels.includes(action.model))
    return refuse({ code: "format", field: "model", message: "Unknown Glitter model." });
  return { available: true };
}

const gameOptics = (finish: Layer["finish"], shift: GameOptics["shift"] = DEFAULT_SHIFT): GameOptics =>
  finish === "iridescent" ? { model: "game-matched-1", shift: { ...shift! } } : { model: "game-matched-1" };
/** Actions that read or write per-layer editor memory (inactive Glitter models, Colour-shift settings). */
const remembers = (kind: RecipeAction["kind"]) => kind === "glitter.selectModel" || kind === "layer.setFinish";

/** Applies a single validated document/selection command without DOM or renderer access. */
export function applyRecipeAction(state: RecipeActionState, action: RecipeAction,
  choices: GlitterChoices = {}, presetId = "draft") {
  const capability = recipeActionCapability(state, action);
  if (!capability.available) throw Error(capability.reason);
  const index = state.recipe.layers.findIndex(layer => layer.id === action.layerId);
  const layer = state.recipe.layers[index];
  const next: RecipeActionState = { ...state, fieldSelection: { ...state.fieldSelection } };
  let changed: Layer = { ...layer };
  let effect: RecipeActionEffect["kind"] = "scheduled";
  const nextChoices = remembers(action.kind) ? structuredClone(choices) : choices;
  const unchanged = () => ({ state, choices, effect: { kind: "selection" as const, layerIndex: index }, changed: false });
  if (action.kind === "layer.select") {
    next.active = index; next.selected = 0; effect = "selection";
  } else if (action.kind === "point.select") {
    next.active = index; next.selected = action.index; effect = "selection";
  } else if (action.kind === "point.remove") {
    changed.points = layer.points.filter((_, i) => i !== action.index);
    if (state.active === index) next.selected = Math.min(state.selected, changed.points.length - 1);
    effect = "immediate";
  } else if (action.kind === "path.edit") {
    changed = action.command.kind === "enable-bezier" ? convertToBezier(layer) :
      setPointMode(layer, action.command.index, action.command.mode);
  } else if (action.kind === "field.select") {
    next.active = index; next.fieldSelection[layer.id] = action.fieldId!; effect = "selection";
  } else if (action.kind === "field.add") {
    const i = layer.fields.length, n = layer.points.length;
    const field: WarpField = { id: crypto.randomUUID(),
      u: clamp(layer.points.reduce((sum, point) => sum + point.u, 0) / n + .008 * i),
      v: clamp(layer.points.reduce((sum, point) => sum + point.v, 0) / n), du: 0, dv: 0, radius: .03 };
    changed.fields = [...layer.fields, field]; next.fieldSelection[layer.id] = field.id;
  } else if (action.kind === "field.remove") {
    const fieldIndex = layer.fields.findIndex(field => field.id === action.fieldId);
    changed.fields = layer.fields.filter(field => field.id !== action.fieldId);
    const neighbor = changed.fields[Math.min(fieldIndex, changed.fields.length - 1)];
    if (neighbor) next.fieldSelection[layer.id] = neighbor.id;
    else delete next.fieldSelection[layer.id];
  } else if (action.kind === "field.clear") {
    changed.fields = layer.fields.map(field => field.id === action.fieldId ? { ...field, du: 0, dv: 0 } : field);
  } else if (action.kind === "field.setReach") {
    changed.fields = layer.fields.map(field => field.id === action.fieldId ? { ...field, radius: clamp(action.radius, .005, .2) } : field);
  } else if (action.kind === "pigment.edit") changed = editPigment(layer, action.command);
  else if (action.kind === "softness.edit") changed = editSoftness(layer, action.command);
  else if (action.kind === "layer.setColor") changed.color = action.color;
  else if (action.kind === "layer.setOpacity") changed.opacity = action.opacity;
  else if (action.kind === "layer.setSymmetry") { changed.symmetry = action.symmetry; effect = "immediate"; }
  else if (action.kind === "layer.setFinish") {
    // Re-selecting the current finish keeps the layer exactly as it is (its optical model and
    // Colour-shift settings included) and records no Undo step; only layer.useGameOptics
    // moves an earlier-model layer to the game-matched model.
    if (canonicalFinish(action.finish) === canonicalFinish(layer.finish)) return unchanged();
    const key = `${presetId}/${layer.id}`, memory = { ...nextChoices[key] };
    if (layer.optics?.shift) memory.shift = { ...layer.optics.shift };
    if (action.finish !== "glitter" && (isIrregular(layer.flakes) || isDirectGlint(layer.flakes))) {
      // Leaving Glitter keeps the active model's settings for when that model is chosen again.
      const model = glitterModel(layer.flakes);
      if (validGlitterSettings(model, layer.flakes)) memory[model] = structuredClone(layer.flakes!);
      changed.flakes = defaultFlakes();
    }
    if (Object.keys(memory).length) nextChoices[key] = memory;
    changed.finish = action.finish; effect = "immediate";
    // Choosing a finish that has a game-matched model uses it; older layers keep theirs until switched.
    delete changed.optics;
    if (hasGameOptics(action.finish))
      changed.optics = gameOptics(action.finish, validShiftSettings(memory.shift) ? memory.shift : DEFAULT_SHIFT);
  } else if (action.kind === "layer.useGameOptics") {
    changed.optics = gameOptics(layer.finish); effect = "immediate";
  } else if (action.kind === "layer.setShift") {
    changed.optics = { ...layer.optics!, shift: { ...layer.optics!.shift!, [action.key]: action.value } };
  } else if (action.kind === "glitter.selectModel") {
    if (glitterModel(layer.flakes) === action.model) return unchanged();
    next.recipe = parseRecipe(selectGlitterModel(state.recipe, layer.id, action.model, nextChoices, presetId));
    changed = next.recipe.layers[index];
    effect = "immediate";
  } else if (action.kind === "glitter.setClassic") {
    changed.flakes = { ...(layer.flakes ?? defaultFlakes()) as Flakes, [action.key]: action.value };
  } else if (action.kind === "glitter.setIrregular") {
    changed.flakes = { ...layer.flakes!, [action.key]: action.value } as Layer["flakes"];
  } else if (action.kind === "glitter.setDirect") {
    changed.flakes = { ...layer.flakes!, [action.key]: action.value } as Layer["flakes"];
  } else if (action.kind === "point.move") {
    changed.points = layer.points.map((point, i) => i === action.index ? { ...point, u: action.u, v: action.v } : point);
  } else if (action.kind === "point.insert") {
    // Isotropic UV distance chooses the nearest section; Bézier paths split the exact cubic.
    const inserted = insertPathPoint(layer.points, { u: action.u, v: action.v }, { u: 1, v: 1 });
    if (!inserted) throw Error("No contour section could take a point there.");
    changed.points = inserted.points; next.active = index; next.selected = inserted.index; effect = "immediate";
  } else if (action.kind === "point.setTangent") {
    const point = layer.points[action.index];
    const moved = moveTangent(point, action.side, { u: point.u + action.du, v: point.v + action.dv });
    changed.points = layer.points.map((entry, i) => i === action.index ? moved : entry);
  } else if (action.kind === "shape.transform") {
    const pivotIndex = action.pivotIndex ?? (state.recipe.layers[state.active]?.id === layer.id ? state.selected : 0);
    const pivot = { u: layer.points[pivotIndex].u, v: layer.points[pivotIndex].v }, command = action.command;
    const transformed = transformLayer(layer, command.kind === "translate" ? command : { ...command, pivot });
    if (!transformed) throw Error("That transform would take the shape outside the supported range.");
    changed = transformed;
  } else if (action.kind === "field.setOrigin") {
    changed.fields = layer.fields.map(field => field.id === action.fieldId ? { ...field, u: action.u, v: action.v } : field);
  } else if (action.kind === "field.setVector") {
    changed.fields = layer.fields.map(field => field.id === action.fieldId ? { ...field, du: action.du, dv: action.dv } : field);
  }
  if (effect !== "selection") {
    const layers = next.recipe.layers.map((entry, i) => i === index ? changed : entry);
    // One schema rule for every edit: the recipe moves up to what all its layers need, never down.
    const validated = parseRecipe({ ...next.recipe, schema: requiredRecipeSchema({ schema: next.recipe.schema, layers }), layers });
    // Deferred layer renders use object identity; keep untouched layers' live identities.
    next.recipe = { ...validated, layers: state.recipe.layers.map((entry, i) => i === index ? validated.layers[i] : entry) };
  }
  const changedState = JSON.stringify(next) !== JSON.stringify(state);
  return { state: next, choices: nextChoices, effect: { kind: effect, layerIndex: index }, changed: changedState };
}

/** Existing gesture adapters may still mutate the source state; reads always reflect the latest committed recipe. */
export class RecipeActions {
  private listeners = new Set<(effect: RecipeActionEffect) => void>();
  constructor(private read: () => RecipeActionState, private write: (state: RecipeActionState, effect: RecipeActionEffect) => void,
    private history: { checkpoint(recipe: Recipe): void }, private choices: GlitterChoices, private presetId: () => string,
    private gestureChanged?: (layerIndex: number, kind: GestureEdit["kind"]) => void) {}
  snapshot(): ReadonlyRecipeState { return structuredClone(this.read()); }
  capability(action: RecipeAction) { return recipeActionCapability(this.read(), action); }
  subscribe(listener: (effect: RecipeActionEffect) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispatch(action: RecipeAction, record = false) {
    const before = this.read(), result = applyRecipeAction(before, action, this.choices,
      remembers(action.kind) ? this.presetId() : "draft");
    if (!result.changed) return false;
    if (record && result.effect.kind !== "selection") this.history.checkpoint(before.recipe);
    if (remembers(action.kind)) Object.assign(this.choices, result.choices);
    this.write(result.state, result.effect);
    for (const listener of this.listeners) listener(result.effect);
    return true;
  }
  /** Pointer adapters calculate coordinates; the application validates and applies the result in place.
   * Stable target identities are required until pointer release so a stale gesture cannot edit a new preset. */
  applyGesture(action: GestureEdit): boolean {
    const state = this.read(), index = state.recipe.layers.findIndex(layer => layer.id === action.layerId);
    const layer = state.recipe.layers[index];
    if (!layer || layer !== action.expectedLayer) return false;
    if (!applyGestureEdit(action, state.recipe.schema)) return false;
    this.gestureChanged?.(index, action.kind);
    const effect: RecipeActionEffect = { kind: "scheduled", layerIndex: index };
    for (const listener of this.listeners) listener(effect);
    return true;
  }
}
