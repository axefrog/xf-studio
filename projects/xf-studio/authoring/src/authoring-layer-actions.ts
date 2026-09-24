import type { AuthoringDocument } from "./authoring-document";
import { applyLayerAction, layerCapability, type LayerAction } from "./editor-actions";

/** Domain transaction for stack edits; the port owns only renderer resource resets. */
export class AuthoringLayerActions {
  constructor(private readonly document: AuthoringDocument,
    private readonly structureChanged: () => void) {}
  capability(action: LayerAction) { return layerCapability(this.document.recipe, action); }
  dispatch(action: LayerAction) {
    const available = this.capability(action);
    if (!available.available) throw Error(available.reason);
    const next = applyLayerAction(this.document.recipe,
      this.document.recipe.layers[this.document.active]?.id, action);
    this.document.checkpoint();
    if (next.structure) {
      this.document.replaceRecipe(next.recipe, next.active);
      this.structureChanged();
    } else this.document.publishLayer(next.recipe, next.changed);
  }
}
