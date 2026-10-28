import type { EditingDocument } from "./editing-document";
import { RECIPE_ACTION_KINDS, type RecipeAction } from "./recipe-actions";
import type { Layer } from "./recipe";
import { historyLabel, type HistoryLabel } from "./history-labels";

const CONTROL_TRANSACTION = { empty: "same-content", revert: "content-differs" } as const;
type HistoryTransaction = ReturnType<EditingDocument["history"]["begin"]>;

/** `transaction` is the platform's Undo transaction this control's run of edits records into. */
type Transaction = { id: string; layer: Layer; transaction?: HistoryTransaction };
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
  private readonly invalidated = new Set<string>();
  constructor(private document: EditingDocument,
    private dispatch: (action: RecipeAction) => boolean,
    /** The Undo step's name for an edit: the trusted core passes the registered spec's `label`. */
    private label: (action: RecipeAction) => HistoryLabel = historyLabel, signal?: AbortSignal) {
    signal?.addEventListener("abort", () => { this.active = undefined; }, { once: true });
  }
  accepts(kind: string) { return RECIPE_ACTION_KINDS.has(kind); }
  begin(id: string, layerId: string | undefined) {
    if (this.active?.id === id && this.active.layer.id === layerId &&
      this.document.recipe.layers.includes(this.active.layer)) return true;
    if (this.active) this.commit(this.active.id);
    const layer = this.document.recipe.layers.find(item => item.id === layerId);
    if (!layer) return false;
    // Each edit replaces the layer object; the transaction follows the current one.
    const active: Transaction = { id, layer };
    active.transaction = this.document.history.begin([this.document.feature], CONTROL_TRANSACTION,
      { present: () => this.document.recipe.layers.includes(active.layer) });
    this.active = active;
    this.invalidated.delete(id);
    return true;
  }
  /**
   * Apply one edit inside transaction `id`, opening (and then closing) a one-edit transaction
   * when the control has none. A thrown dispatch error leaves the recipe unchanged; an
   * implicit transaction is still closed, an explicit one stays with its control.
   */
  edit(id: string, layerId: string | undefined, action: RecipeAction): ControlEditOutcome {
    if (this.invalidated.has(id)) return "stale";
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
  /** Revoke the captured run before settlement publishes; only an explicit begin may reuse its ID. */
  replacing() {
    if (!this.active) return;
    const { id } = this.active;
    this.invalidated.add(id);
    this.commit(id);
  }
  snapshot() { return this.active ? { id: this.active.id, layerId: this.active.layer.id } : undefined; }
}
