/**
 * The live editing's port for eye makeup's registered behaviour (feature-module platform §1, §4):
 * it reads the `FeatureState` the module's capability and apply take (the recipe part and the
 * editor state, without copying) and publishes a result exactly as the recipe and layer services
 * always have (one checkpoint, the new state, its render effect). Every way of editing eye makeup
 * goes through it: dispatched actions, form controls (CORE-31) and gesture frames. DOM-free.
 */
import type { EditingDocument } from "./editing-document";
import type { EyeMakeupAction, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupResult, EyeMakeupState } from "./eye-makeup-model";
import type { FeatureActionSpec, GestureProvider } from "../../platform/api";
import type { Recipe } from "./recipe";
import type { LayeredMakeupRegion } from "./region";
import { remembers, type GestureEdit, type ReadonlyRecipeState, type RecipeAction, type RecipeActionEffect,
  type RecipeActionState } from "./recipe-actions";
import type { GlitterChoices, LayerChoices } from "./glitter-model";

/** Eye makeup's registered spec for one action kind (from the injected registry). */
export type EyeMakeupSpec = FeatureActionSpec<Recipe, EyeMakeupEditorState, EyeMakeupAction, string, EyeMakeupEffect>;
/** Eye makeup's registered gestures: one frame applied in place, returning the changed layer. */
export type EyeMakeupGestures = GestureProvider<Recipe, GestureEdit, { layerIndex: number; kind: GestureEdit["kind"] }>;

export type EyeMakeupPort = {
  /** Eye makeup's layered-makeup region (its models, mirror, textures and wording), from the composition. */
  readonly region: LayeredMakeupRegion;
  /** The current part and editor state; read-only, never a copy. */
  state(): EyeMakeupState;
  /**
   * Apply one action through its registered spec and publish the result: the IDs of new items
   * are assigned from the host's ID source first (so the applied action replays exactly), then
   * the pure apply runs. `record` adds an Undo checkpoint (the action's Undo policy is not `none`;
   * a form control's transaction owns its checkpoint and passes false). Throws when the
   * capability refuses; nothing then changes.
   */
  apply(spec: EyeMakeupSpec, action: EyeMakeupAction, record: boolean): EyeMakeupResult;
  /** Publish an applied result. `record` adds an Undo checkpoint for a change that is more than a selection. */
  commit(action: EyeMakeupAction, result: EyeMakeupResult, record: boolean): void;
  /** One gesture frame through the registered gestures; false when stale or unchanged. The gesture owns the Undo entry. */
  gesture(gestures: EyeMakeupGestures, edit: GestureEdit): boolean;
};

export function eyeMakeupPort(editing: EditingDocument,
  recipe: Pick<RecipeActions, "layerChoices" | "commit" | "publishGesture">,
  region: LayeredMakeupRegion,
  structureChanged: (previous: Recipe) => void = () => {},
  /** Where new items' IDs come from (the host's ID source). */
  newId: () => string = () => crypto.randomUUID()): EyeMakeupPort {
  const port: EyeMakeupPort = {
    region,
    state: () => ({ part: editing.recipe, editor: { active: editing.active, selected: editing.selected,
      fieldSelection: editing.fieldSelection,
      // Only Glitter-model and finish changes read these; project them on demand.
      get choices() { return recipe.layerChoices(); } } }),
    apply(spec, action, record) {
      const concrete = spec.assignIds?.(action, newId) ?? action;
      const result = spec.apply(port.state(), concrete);
      editing.withHistoryLabel(spec.label(concrete), () => port.commit(concrete, result, record));
      return result;
    },
    commit(action, result, record) {
      if (action.kind === "layer.edit" || action.kind === "layer.setEnabled") {
        // A layer-stack edit always changes the stack (its apply reports `changed`), so it checkpoints when recorded.
        if (record) editing.checkpoint();
        if (result.selectionChanged) editing.history.declareSelectionChange([editing.feature]);
        if (result.effect.kind === "structure") {
          const previous = editing.recipe;
          editing.replaceRecipe(result.part, result.editor.active);
          structureChanged(previous);
        } else if (result.effect.kind === "immediate") editing.publishLayer(result.part, result.effect.layerIndex);
        return;
      }
      if (!result.changed || result.effect.kind === "none" || result.effect.kind === "structure") return;
      const { active, selected, fieldSelection, choices } = result.editor;
      recipe.commit(action as RecipeAction, { recipe: result.part, active, selected, fieldSelection }, result.effect, choices, record,
        result.selectionChanged ? () => editing.history.declareSelectionChange([editing.feature]) : undefined);
    },
    gesture(gestures, edit) {
      const changed = gestures.apply(editing.recipe, edit);
      if (!changed) return false;
      recipe.publishGesture(changed.layerIndex, changed.kind);
      return true;
    },
  };
  return port;
}

/**
 * Publishes eye makeup's recipe results to the live feature: the registered apply's results
 * (`commit`) and gesture frames (`publishGesture`), with the per-layer memory they use. It applies
 * nothing itself: every edit is dispatched through `app.dispatch`, form controls and gestures (CORE-44).
 */
export class RecipeActions {
  private listeners = new Set<(effect: RecipeActionEffect) => void>();
  constructor(private read: () => RecipeActionState, private write: (state: RecipeActionState, effect: RecipeActionEffect) => void,
    private history: { checkpoint(recipe: Recipe): void }, private choices: GlitterChoices, private presetId: () => string,
    private gestureChanged?: (layerIndex: number, kind: GestureEdit["kind"]) => void, private signal?: AbortSignal) {
    signal?.addEventListener("abort", () => this.listeners.clear(), { once: true });
  }
  snapshot(): ReadonlyRecipeState { return structuredClone(this.read()); }
  subscribe(listener: (effect: RecipeActionEffect) => void) { if (this.signal?.aborted) throw Error("This recipe editor has ended."); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /**
   * The current preset's per-layer memory (inactive Glitter models, Colour-shift settings),
   * keyed by layer ID: the editor state eye makeup's pure actions read. Not cloned; read-only.
   */
  layerChoices(): Readonly<Record<string, LayerChoices>> {
    if (this.signal?.aborted) throw Error("This recipe editor has ended.");
    const prefix = `${this.presetId()}/`, result: Record<string, LayerChoices> = {};
    for (const [key, choices] of Object.entries(this.choices)) if (key.startsWith(prefix)) result[key.slice(prefix.length)] = choices;
    return result;
  }
  /**
   * Publish a result computed by eye makeup's pure apply: one checkpoint when `record` and the result
   * is more than a selection, the per-layer memory written back for actions that use it, then the
   * state and its effect.
   */
  commit(action: RecipeAction, next: RecipeActionState, effect: RecipeActionEffect,
    choices: Readonly<Record<string, LayerChoices>>, record: boolean, selectionChanged?: () => void) {
    if (this.signal?.aborted) throw Error("This recipe editor has ended.");
    if (record && effect.kind !== "selection") this.history.checkpoint(this.read().recipe);
    selectionChanged?.();
    if (remembers(action.kind)) {
      const prefix = `${this.presetId()}/`;
      for (const [layerId, remembered] of Object.entries(choices)) this.choices[prefix + layerId] = remembered;
    }
    this.write(next, effect);
    for (const listener of this.listeners) listener(effect);
  }
  /**
   * Publish a gesture edit eye makeup's registered gesture provider applied in place: the changed
   * layer is scheduled for the preview, as every gesture frame always was.
   */
  publishGesture(layerIndex: number, kind: GestureEdit["kind"]) {
    if (this.signal?.aborted) throw Error("This recipe editor has ended.");
    this.gestureChanged?.(layerIndex, kind);
    const effect: RecipeActionEffect = { kind: "scheduled", layerIndex };
    for (const listener of this.listeners) listener(effect);
  }
}
