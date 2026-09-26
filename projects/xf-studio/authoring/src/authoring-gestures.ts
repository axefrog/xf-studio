import type { AuthoringDocument } from "./authoring-document";
import type { GestureEdit } from "./engines/layered-makeup/recipe-actions";
import type { Layer } from "./engines/layered-makeup/recipe";
import { gestureHistoryLabel, type HistoryLabel } from "./history-labels";
import type { HistoryEntryId } from "./editor-actions";
import { GESTURE_TRANSACTION, HistoryTransaction } from "./platform/core/history-transaction";

import { MAIN_VIEW, type ViewId } from "./platform/api/view-graph";

/**
 * The view a gesture comes from (view-graph-design.md §3.8): a 3D view (`main`) or the flat editor's view (`uv`, eye makeup's UV
 * map, a module-registered flat view kind from P6). Callers may pass a bare view ID; the on-head editor's earlier name `surface`
 * means the main 3D view.
 */
export type GestureSource = { readonly view: ViewId };
export type GestureOrigin = GestureSource | ViewId;
/** The flat UV editor's view ID. */
export const FLAT_EDITOR_VIEW: ViewId = "uv";
export function gestureSource(origin: GestureOrigin): GestureSource {
  const view = typeof origin === "string" ? origin : origin.view;
  return { view: view === "surface" ? MAIN_VIEW : view };
}
/** Whether a gesture comes from a 3D view (it needs the 3D preview), rather than the flat editor. */
export const fromView3d = (origin: GestureOrigin) => gestureSource(origin).view !== FLAT_EDITOR_VIEW;
const sameSource = (a: GestureSource | undefined, b: GestureOrigin) => !!a && a.view === gestureSource(b).view;

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
  begin(origin: GestureOrigin, layer: Layer | undefined) {
    if (!layer || !this.document.recipe.layers.includes(layer)) return false;
    this.active = { source: gestureSource(origin), layer, transaction: HistoryTransaction.open(this.document.transactionHost(this.restoreUndo),
      GESTURE_TRANSACTION, () => this.document.recipe.layers.includes(layer)) };
    return true;
  }
  apply(source: GestureOrigin, action: GestureEdit) {
    const active = this.active;
    if (!active || !sameSource(active.source, source) || active.layer !== action.expectedLayer ||
      !this.document.recipe.layers.includes(active.layer)) return false;
    const changed = this.actions.applyGesture(action);
    active.transaction.applied(changed, () => this.label(action));
    return changed;
  }
  commit(source: GestureOrigin) {
    const active = this.active;
    if (active && sameSource(active.source, source)) {
      this.active = undefined;
      active.transaction.commit();
    }
  }
  cancel(source: GestureOrigin) {
    const active = this.active;
    if (!active || !sameSource(active.source, source)) return;
    this.active = undefined;
    active.transaction.cancel();
  }
  snapshot() { return this.active ? { source: this.active.source.view, layerId: this.active.layer.id,
    changed: this.active.transaction.changed } : undefined; }
}
