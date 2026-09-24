import type { AuthoringDocument } from "./authoring-document";
import type { RecipeAction } from "./recipe-actions";
import type { Layer } from "./recipe";
import { historyLabel } from "./history-labels";

type Transaction = { id: string; layer: Layer; baseline: string; depth: number; created: boolean; labelled?: boolean };

/** Groups continuous form edits into one Undo entry without depending on input events. */
export class AuthoringControlEdits {
  private active?: Transaction;
  constructor(private document: AuthoringDocument,
    private dispatch: (action: RecipeAction) => void,
    private restoreUndo: () => void) {}
  begin(id: string, layerId: string | undefined) {
    if (this.active?.id === id && this.active.layer.id === layerId &&
      this.document.recipe.layers.includes(this.active.layer)) return true;
    if (this.active) this.commit(this.active.id);
    const layer = this.document.recipe.layers.find(item => item.id === layerId);
    if (!layer) return false;
    const baseline = JSON.stringify(this.document.recipe), before = this.document.undoDepth;
    this.document.checkpoint();
    this.active = { id, layer, baseline, depth: this.document.undoDepth,
      created: this.document.undoDepth > before };
    return true;
  }
  edit(id: string, layerId: string | undefined, action: RecipeAction) {
    const owned = this.active?.id === id;
    if (!owned && !this.begin(id, layerId)) return;
    if (!this.active || !this.document.recipe.layers.includes(this.active.layer) ||
      this.active.layer.id !== layerId || action.layerId !== layerId) {
      if (!owned) this.commit(id);
      return;
    }
    try {
      this.dispatch(action);
      if (this.active && !this.active.labelled && this.active.created) {
        this.document.relabelCheckpoint(this.active.depth, historyLabel(action)); this.active.labelled = true;
      }
      const current = this.document.recipe.layers.find(layer => layer.id === layerId);
      if (current) this.active.layer = current;
    }
    finally { if (!owned) this.commit(id); }
  }
  commit(id: string) {
    if (this.active?.id !== id) return;
    const active = this.active; this.active = undefined;
    this.discardEmpty(active);
  }
  cancel(id: string) {
    if (this.active?.id !== id) return;
    const active = this.active; this.active = undefined;
    if (this.document.recipe.layers.includes(active.layer) && JSON.stringify(this.document.recipe) !== active.baseline)
      this.restoreUndo();
    else this.discardEmpty(active);
  }
  snapshot() { return this.active ? { id: this.active.id, layerId: this.active.layer.id } : undefined; }
  private discardEmpty(active: Transaction) {
    if (active.created && this.document.recipe.layers.includes(active.layer) &&
      this.document.undoDepth === active.depth && JSON.stringify(this.document.recipe) === active.baseline)
      this.document.undoRecipe();
  }
}
