import type { AuthoringDocument } from "./authoring-document";
import type { GestureEdit, RecipeActions } from "./recipe-actions";
import type { Layer } from "./recipe";
import { gestureHistoryLabel } from "./history-labels";
import type { HistoryEntryId } from "./editor-actions";

export type GestureSource = "uv" | "surface";

/** Owns the Undo transaction; input adapters own coordinate and stale-pointer checks. */
export class AuthoringGestures {
  /** `checkpoint` is the Undo entry this gesture added (undefined when the top entry already matched). */
  private active?: { source: GestureSource; layer: Layer; changed: boolean;
    checkpoint?: HistoryEntryId; baseline: string };
  constructor(private document: AuthoringDocument, private actions: Pick<RecipeActions, "applyGesture">,
    private restoreUndo: () => void) {}
  begin(source: GestureSource, layer: Layer | undefined) {
    if (!layer || !this.document.recipe.layers.includes(layer)) return false;
    const baseline = JSON.stringify(this.document.recipe);
    const checkpoint = this.document.checkpoint();
    this.active = { source, layer, changed: false, checkpoint, baseline };
    return true;
  }
  apply(source: GestureSource, action: GestureEdit) {
    const active = this.active;
    if (!active || active.source !== source || active.layer !== action.expectedLayer ||
      !this.document.recipe.layers.includes(active.layer)) return false;
    const changed = this.actions.applyGesture(action);
    if (changed && !active.changed && active.checkpoint !== undefined)
      this.document.relabelCheckpoint(active.checkpoint, gestureHistoryLabel(action));
    if (changed) active.changed = true;
    return changed;
  }
  commit(source: GestureSource) {
    if (this.active?.source === source) {
      const active = this.active; this.active = undefined;
      this.discardEmpty(active);
    }
  }
  cancel(source: GestureSource) {
    const active = this.active;
    if (!active || active.source !== source) return;
    this.active = undefined;
    if (active.changed && this.document.recipe.layers.includes(active.layer)) this.restoreUndo();
    else this.discardEmpty(active);
  }
  private discardEmpty(active: NonNullable<AuthoringGestures["active"]>) {
    if (active.checkpoint !== undefined && !active.changed && this.document.recipe.layers.includes(active.layer) &&
      JSON.stringify(this.document.recipe) === active.baseline) this.document.discardCheckpoint(active.checkpoint);
  }
  snapshot() { return this.active ? { source: this.active.source, layerId: this.active.layer.id,
    changed: this.active.changed } : undefined; }
}
