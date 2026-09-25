/**
 * The live document's port for eye makeup's pure actions (feature-module platform §1, §4): it
 * reads the `FeatureState` the module's capability and apply take (the recipe part and the
 * editor state, without copying) and publishes a result exactly as the recipe and layer
 * services always have (one checkpoint, the new state, its render effect). DOM-free.
 */
import type { AuthoringDocument } from "./authoring-document";
import type { EyeMakeupAction, EyeMakeupResult, EyeMakeupState } from "./compose/studio-registry";
import type { Recipe } from "./recipe";
import type { RecipeAction, RecipeActions } from "./recipe-actions";

export type EyeMakeupPort = {
  /** The current part and editor state; read-only, never a copy. */
  state(): EyeMakeupState;
  /** Publish an applied result. `record` adds an Undo checkpoint for a recipe action that is more than a selection. */
  commit(action: EyeMakeupAction, result: EyeMakeupResult, record: boolean): void;
};

export function eyeMakeupPort(document: AuthoringDocument, recipe: Pick<RecipeActions, "layerChoices" | "commit">,
  structureChanged: (previous: Recipe) => void = () => {}): EyeMakeupPort {
  return {
    state: () => ({ part: document.recipe, editor: { active: document.active, selected: document.selected,
      fieldSelection: document.fieldSelection,
      // Only Glitter-model and finish changes read these; project them on demand.
      get choices() { return recipe.layerChoices(); } } }),
    commit(action, result, record) {
      if (action.kind === "layer.edit" || action.kind === "layer.setEnabled") {
        // Layer-stack edits always checkpoint, as AuthoringLayerActions does.
        document.checkpoint();
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
  };
}
