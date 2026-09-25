import type { AuthoringDocument } from "./authoring-document";
import type { RecipeAction } from "./recipe-actions";
import type { Layer } from "./recipe";
import { historyLabel } from "./history-labels";
import type { HistoryEntryId } from "./editor-actions";

/** `checkpoint` is the Undo entry this transaction added (undefined when the top entry already matched). */
type Transaction = { id: string; layer: Layer; baseline: string; checkpoint?: HistoryEntryId; labelled?: boolean };
/** `stale`: the transaction's layer was replaced or the edit targets another layer; nothing was applied. */
export type ControlEditOutcome = "changed" | "unchanged" | "stale";

/**
 * Groups continuous form edits into one Undo entry without depending on input events.
 * `dispatch` applies one already-validated recipe action and reports whether it changed
 * anything; the trusted core wires it to `RecipeActions`, so hosts never supply it.
 */
export class AuthoringControlEdits {
  private active?: Transaction;
  constructor(private document: AuthoringDocument,
    private dispatch: (action: RecipeAction) => boolean,
    private restoreUndo: () => void) {}
  begin(id: string, layerId: string | undefined) {
    if (this.active?.id === id && this.active.layer.id === layerId &&
      this.document.recipe.layers.includes(this.active.layer)) return true;
    if (this.active) this.commit(this.active.id);
    const layer = this.document.recipe.layers.find(item => item.id === layerId);
    if (!layer) return false;
    const baseline = JSON.stringify(this.document.recipe);
    this.active = { id, layer, baseline, checkpoint: this.document.checkpoint() };
    return true;
  }
  /**
   * Apply one edit inside transaction `id`, opening (and then closing) a one-edit transaction
   * when the control has none. A thrown dispatch error leaves the recipe unchanged; an
   * implicit transaction is still closed, an explicit one stays with its control.
   */
  edit(id: string, layerId: string | undefined, action: RecipeAction): ControlEditOutcome {
    const owned = this.active?.id === id;
    if (!owned && !this.begin(id, layerId)) return "stale";
    const active = this.active;
    if (!active || !this.document.recipe.layers.includes(active.layer) ||
      active.layer.id !== layerId || action.layerId !== layerId) {
      if (!owned) this.commit(id);
      return "stale";
    }
    try {
      const changed = this.dispatch(action);
      if (changed && !active.labelled && active.checkpoint !== undefined) {
        this.document.relabelCheckpoint(active.checkpoint, historyLabel(action)); active.labelled = true;
      }
      const current = this.document.recipe.layers.find(layer => layer.id === layerId);
      if (current) active.layer = current;
      return changed ? "changed" : "unchanged";
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
    if (active.checkpoint !== undefined && this.document.recipe.layers.includes(active.layer) &&
      JSON.stringify(this.document.recipe) === active.baseline)
      this.document.discardCheckpoint(active.checkpoint);
  }
}
