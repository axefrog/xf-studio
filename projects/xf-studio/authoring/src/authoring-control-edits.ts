import type { AuthoringDocument } from "./authoring-document";
import type { RecipeAction } from "./engines/layered-makeup/recipe-actions";
import type { Layer } from "./engines/layered-makeup/recipe";
import { historyLabel, type HistoryLabel } from "./history-labels";
import type { HistoryEntryId } from "./editor-actions";
import { CONTROL_TRANSACTION, HistoryTransaction } from "./platform/core/history-transaction";

/** `transaction` is the platform's Undo transaction this control's run of edits records into. */
type Transaction = { id: string; layer: Layer; transaction?: HistoryTransaction<HistoryEntryId> };
/** `stale`: the transaction's layer was replaced or the edit targets another layer; nothing was applied. */
export type ControlEditOutcome = "changed" | "unchanged" | "stale";

/**
 * Groups continuous form edits into one Undo entry without depending on input events, through the
 * platform's `HistoryTransaction`: a commit whose content is back where it began leaves no entry, and
 * cancel (Escape) restores the start only when the content differs. `dispatch` applies one
 * already-validated recipe action and reports whether it changed anything; the trusted core wires it
 * to the registered apply, so hosts never supply it.
 */
export class AuthoringControlEdits {
  private active?: Transaction;
  constructor(private document: AuthoringDocument,
    private dispatch: (action: RecipeAction) => boolean,
    /** Restores a cancelled transaction's start: `step` is its own checkpoint, undefined when the top step held the start. */
    private restoreUndo: (step: HistoryEntryId | undefined) => void,
    /** The Undo step's name for an edit: the trusted core passes the registered spec's `label`. */
    private label: (action: RecipeAction) => HistoryLabel = historyLabel) {}
  begin(id: string, layerId: string | undefined) {
    if (this.active?.id === id && this.active.layer.id === layerId &&
      this.document.recipe.layers.includes(this.active.layer)) return true;
    if (this.active) this.commit(this.active.id);
    const layer = this.document.recipe.layers.find(item => item.id === layerId);
    if (!layer) return false;
    // Each edit replaces the layer object; the transaction follows the current one.
    const active: Transaction = { id, layer };
    active.transaction = HistoryTransaction.open(this.document.transactionHost(this.restoreUndo), CONTROL_TRANSACTION,
      () => this.document.recipe.layers.includes(active.layer));
    this.active = active;
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
      active.transaction!.applied(changed, () => this.label(action));
      const current = this.document.recipe.layers.find(layer => layer.id === layerId);
      if (current) active.layer = current;
      return changed ? "changed" : "unchanged";
    }
    finally { if (!owned) this.commit(id); }
  }
  commit(id: string) {
    if (this.active?.id !== id) return;
    const active = this.active; this.active = undefined;
    active.transaction!.commit();
  }
  cancel(id: string) {
    if (this.active?.id !== id) return;
    const active = this.active; this.active = undefined;
    active.transaction!.cancel();
  }
  snapshot() { return this.active ? { id: this.active.id, layerId: this.active.layer.id } : undefined; }
}
