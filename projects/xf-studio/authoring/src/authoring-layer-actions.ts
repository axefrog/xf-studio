import type { AuthoringDocument } from "./authoring-document";
import { applyLayerAction, layerCapability, type LayerAction } from "./editor-actions";
import type { Recipe } from "./recipe";

/** Domain transaction for stack edits; the preview port reconciles renderer resources. */
export class AuthoringLayerActions {
  constructor(private readonly document: AuthoringDocument,
    private readonly structureChanged: (previous: Recipe) => void) {}
  capability(action: LayerAction) { return layerCapability(this.document.recipe, action); }
  dispatch(action: LayerAction) {
    const available = this.capability(action);
    if (!available.available) throw Error(available.reason);
    const previous = this.document.recipe;
    const next = applyLayerAction(previous,
      this.document.recipe.layers[this.document.active]?.id, action);
    this.document.checkpoint();
    if (next.structure) {
      this.document.replaceRecipe(next.recipe, next.active);
      this.structureChanged(previous);
    } else this.document.publishLayer(next.recipe, next.changed);
  }
}
