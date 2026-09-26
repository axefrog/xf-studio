/**
 * The live document's port for eye makeup's registered behaviour (feature-module platform §1, §4):
 * it reads the `FeatureState` the module's capability and apply take (the recipe part and the
 * editor state, without copying) and publishes a result exactly as the recipe and layer services
 * always have (one checkpoint, the new state, its render effect). Every way of editing eye makeup
 * goes through it: dispatched actions, form controls (CORE-31) and gesture frames. DOM-free.
 */
import type { AuthoringDocument } from "./authoring-document";
import type { EyeMakeupAction, EyeMakeupEditorState, EyeMakeupEffect, EyeMakeupResult, EyeMakeupState } from "./eye-makeup-model";
import type { FeatureActionSpec, GestureProvider } from "./platform/api";
import type { Recipe } from "./engines/layered-makeup/recipe";
import type { GestureEdit, RecipeAction, RecipeActions } from "./engines/layered-makeup/recipe-actions";

/** Eye makeup's registered spec for one action kind (from the injected registry). */
export type EyeMakeupSpec = FeatureActionSpec<Recipe, EyeMakeupEditorState, EyeMakeupAction, string, EyeMakeupEffect>;
/** Eye makeup's registered gestures: one frame applied in place, returning the changed layer. */
export type EyeMakeupGestures = GestureProvider<Recipe, GestureEdit, { layerIndex: number; kind: GestureEdit["kind"] }>;

export type EyeMakeupPort = {
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

export function eyeMakeupPort(document: AuthoringDocument,
  recipe: Pick<RecipeActions, "layerChoices" | "commit" | "publishGesture">,
  structureChanged: (previous: Recipe) => void = () => {},
  /** Where new items' IDs come from (the host's ID source). */
  newId: () => string = () => crypto.randomUUID()): EyeMakeupPort {
  const port: EyeMakeupPort = {
    state: () => ({ part: document.recipe, editor: { active: document.active, selected: document.selected,
      fieldSelection: document.fieldSelection,
      // Only Glitter-model and finish changes read these; project them on demand.
      get choices() { return recipe.layerChoices(); } } }),
    apply(spec, action, record) {
      const concrete = spec.assignIds?.(action, newId) ?? action;
      const result = spec.apply(port.state(), concrete);
      port.commit(concrete, result, record);
      return result;
    },
    commit(action, result, record) {
      if (action.kind === "layer.edit" || action.kind === "layer.setEnabled") {
        // A layer-stack edit always changes the stack (its apply reports `changed`), so it checkpoints when recorded.
        if (record) document.checkpoint();
        if (result.effect.kind === "structure") {
          const previous = document.recipe;
          document.replaceRecipe(result.part, result.editor.active);
          structureChanged(previous);
        } else if (result.effect.kind === "immediate") document.publishLayer(result.part, result.effect.layerIndex);
        return;
      }
      if (!result.changed || result.effect.kind === "none" || result.effect.kind === "structure") return;
      const { active, selected, fieldSelection, choices } = result.editor;
      recipe.commit(action as RecipeAction, { recipe: result.part, active, selected, fieldSelection }, result.effect, choices, record);
    },
    gesture(gestures, edit) {
      const changed = gestures.apply(document.recipe, edit);
      if (!changed) return false;
      recipe.publishGesture(changed.layerIndex, changed.kind);
      return true;
    },
  };
  return port;
}
