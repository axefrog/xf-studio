import type { AuthoringDocument } from "./authoring-document";
import type { GestureEdit } from "./engines/layered-makeup/recipe-actions";
import type { Layer } from "./engines/layered-makeup/recipe";
import { gestureHistoryLabel, type HistoryLabel } from "./history-labels";
import type { HistoryEntryId } from "./editor-actions";
import { GESTURE_TRANSACTION, HistoryTransaction } from "./platform/core/history-transaction";

export type GestureSource = "uv" | "surface";

/**
 * Owns a pointer gesture's Undo transaction through the platform's `HistoryTransaction` (one step,
 * named by the first frame that changed something; Escape restores the start and never creates
 * Redo); input adapters own coordinate and stale-pointer checks.
 */
export class AuthoringGestures {
  private active?: { source: GestureSource; layer: Layer; transaction: HistoryTransaction<HistoryEntryId> };
  /** `actions.applyGesture` applies one frame through the feature's registered gestures (the eye-makeup port). */
  constructor(private document: AuthoringDocument, private actions: { applyGesture(edit: GestureEdit): boolean },
    /** Restores a cancelled gesture's start: `step` is its own checkpoint, undefined when the top step held the start. */
    private restoreUndo: (step: HistoryEntryId | undefined) => void,
    /** The Undo step's name from a frame: the trusted core passes the registered gestures' `label`. */
    private label: (edit: GestureEdit) => HistoryLabel = gestureHistoryLabel) {}
  begin(source: GestureSource, layer: Layer | undefined) {
    if (!layer || !this.document.recipe.layers.includes(layer)) return false;
    this.active = { source, layer, transaction: HistoryTransaction.open(this.document.transactionHost(this.restoreUndo),
      GESTURE_TRANSACTION, () => this.document.recipe.layers.includes(layer)) };
    return true;
  }
  apply(source: GestureSource, action: GestureEdit) {
    const active = this.active;
    if (!active || active.source !== source || active.layer !== action.expectedLayer ||
      !this.document.recipe.layers.includes(active.layer)) return false;
    const changed = this.actions.applyGesture(action);
    active.transaction.applied(changed, () => this.label(action));
    return changed;
  }
  commit(source: GestureSource) {
    if (this.active?.source === source) {
      const active = this.active; this.active = undefined;
      active.transaction.commit();
    }
  }
  cancel(source: GestureSource) {
    const active = this.active;
    if (!active || active.source !== source) return;
    this.active = undefined;
    active.transaction.cancel();
  }
  snapshot() { return this.active ? { source: this.active.source, layerId: this.active.layer.id,
    changed: this.active.transaction.changed } : undefined; }
}
