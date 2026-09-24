import type { AuthoringDocument } from "./authoring-document";
import { UNKNOWN_HISTORY_LABEL, type HistoryLabel } from "./history-labels";
import { parseRecipe, type Recipe } from "./recipe";

export type HistoryState = {
  /** The change the next Undo reverts. */
  undo?: HistoryLabel;
  /** The change the next Redo re-applies. */
  redo?: HistoryLabel;
  depth: number;
  redoDepth: number;
};

/**
 * User-level recipe Undo/Redo over the document's bounded Undo history.
 *
 * `revert` is the internal path for a cancelled gesture or form transaction and never
 * creates a Redo entry. Redo entries are session-only (not persisted) and stay valid only
 * while the recipe is exactly the one the last Undo/Redo produced: any other edit, preset
 * switch or restore discards them, as in a conventional editor.
 */
export class AuthoringHistory {
  private redoStack: { encoded: string; label: HistoryLabel }[] = [];
  private expected?: { revision: number; encoded: string };
  constructor(private document: AuthoringDocument, private resetStack: (previous: Recipe) => void) {
    document.subscribe(change => { if (change === "restore") this.clearRedo(); });
  }
  /** Restore the latest checkpoint without recording Redo (gesture/control cancellation). */
  revert(): boolean {
    const next = this.document.undoRecipe();
    if (!next) return false;
    const previous = this.document.recipe;
    const activeId = previous.layers[this.document.active]?.id;
    this.document.replaceRecipe(next, next.layers.findIndex(layer => layer.id === activeId));
    this.resetStack(previous);
    return true;
  }
  undo(): boolean {
    if (!this.document.canUndo) return false;
    const label = this.document.historyLabel() ?? { ...UNKNOWN_HISTORY_LABEL };
    const current = JSON.stringify(this.document.recipe);
    if (!this.redoValid()) this.clearRedo();
    if (!this.revert()) return false;
    this.redoStack.push({ encoded: current, label });
    this.expect();
    return true;
  }
  redo(): boolean {
    if (!this.redoValid()) { this.clearRedo(); return false; }
    const entry = this.redoStack.pop()!;
    const previous = this.document.recipe;
    const activeId = previous.layers[this.document.active]?.id;
    const next = parseRecipe(JSON.parse(entry.encoded));
    this.document.checkpoint(undefined, entry.label);
    this.document.replaceRecipe(next, next.layers.findIndex(layer => layer.id === activeId));
    this.resetStack(previous);
    this.expect();
    return true;
  }
  canRedo(): boolean {
    if (this.redoValid()) return true;
    this.clearRedo();
    return false;
  }
  state(): HistoryState {
    const redo = this.canRedo() ? this.redoStack.at(-1)?.label : undefined;
    return { undo: this.document.canUndo ? this.document.historyLabel() : undefined,
      redo: redo && { ...redo }, depth: this.document.undoDepth, redoDepth: this.redoStack.length };
  }
  private expect() {
    this.expected = { revision: this.document.geometryVersion.revision, encoded: JSON.stringify(this.document.recipe) };
  }
  private redoValid() {
    const expected = this.expected;
    if (!this.redoStack.length || !expected) return false;
    const revision = this.document.geometryVersion.revision;
    if (revision === expected.revision) return true;
    // A cancelled gesture republishes geometry without changing content; keep Redo then.
    if (JSON.stringify(this.document.recipe) !== expected.encoded) return false;
    expected.revision = revision;
    return true;
  }
  private clearRedo() { this.redoStack = []; this.expected = undefined; }
}
