import type { AuthoringDocument } from "./authoring-document";
import type { HistoryEntryId } from "./editor-actions";
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

/** One change in a history timeline. */
export type HistoryStep = HistoryLabel & {
  /** Opaque, session-unique and stable while the step stays in the history (also across Undo/Redo). */
  id: string;
  /** When the change was made (epoch ms); absent for steps restored from a saved workspace. */
  at?: number;
  /** `done` steps are part of the current look; `undone` ones can be redone (session-only). */
  state: "done" | "undone";
};
/**
 * Read-only history of the current look, oldest first: every kept done step, then the
 * redo-able ones in the order Redo would re-apply them. It never contains recipes, so the
 * planned look-wide history (feature-module-platform §3) can publish the same shape.
 */
export type HistorySnapshot = {
  /** Jump target for the oldest kept state, before `steps[0]`. */
  startId: string;
  steps: HistoryStep[];
  /** Index in `steps` of the step the current look follows; -1 at the oldest kept state. */
  current: number;
  /** Number of undone steps after `current` (all of them redo-able). */
  redoCount: number;
  /** Older steps than the first kept one were dropped (history limit or saved-workspace budget). */
  trimmed: boolean;
};
/** The oldest kept state of every history; not a step of its own. */
export const HISTORY_START_ID = "start";

export type HistoryJumpPlan = { direction: "undo" | "redo" | "none"; count: number };

type RedoEntry = { encoded: string; label: HistoryLabel; id: HistoryEntryId; at?: number };
const stepId = (id: HistoryEntryId) => `step-${id}`;

/**
 * The one mapper from kept Undo entries (and redo-able steps, in Redo order) to a timeline.
 * A host without `AuthoringHistory` has no Redo and passes none.
 */
export function historyTimeline(document: Pick<AuthoringDocument, "historyEntries" | "historyTrimmed">,
  redo: readonly Pick<RedoEntry, "label" | "id" | "at">[] = []): HistorySnapshot {
  const done: HistoryStep[] = document.historyEntries().map(entry => ({
    ...(entry.label ?? UNKNOWN_HISTORY_LABEL), id: stepId(entry.id),
    ...(entry.at === undefined ? {} : { at: entry.at }), state: "done" }));
  const undone: HistoryStep[] = redo.map(entry => ({
    ...entry.label, id: stepId(entry.id), ...(entry.at === undefined ? {} : { at: entry.at }), state: "undone" }));
  return { startId: HISTORY_START_ID, steps: [...done, ...undone], current: done.length - 1,
    redoCount: undone.length, trimmed: document.historyTrimmed };
}

/**
 * User-level recipe Undo/Redo over the document's bounded Undo history.
 *
 * `revert` is the internal path for a cancelled gesture or form transaction and never
 * creates a Redo entry. Redo entries are session-only (not persisted) and stay valid only
 * while the recipe is exactly the one the last Undo/Redo produced: any other edit, preset
 * switch or restore discards them, as in a conventional editor. Undo and Redo keep each
 * step's identity, so a history list can jump to any step (`jumpTo`) as one atomic change.
 */
export class AuthoringHistory {
  private redoStack: RedoEntry[] = [];
  private expected?: { revision: number; encoded: string; top?: HistoryEntryId };
  constructor(private document: AuthoringDocument, private resetStack: (previous: Recipe) => void) {
    document.subscribe(change => { if (change === "restore") this.clearRedo(); });
  }
  /** Restore the latest checkpoint without recording Redo (gesture/control cancellation). */
  revert(): boolean {
    const next = this.document.undoRecipe();
    if (!next) return false;
    this.publish(next);
    return true;
  }
  undo(): boolean { return this.document.canUndo && this.move({ direction: "undo", count: 1 }); }
  redo(): boolean { return this.move({ direction: "redo", count: 1 }); }
  /**
   * Reads never discard Redo: an open gesture or form transaction makes it unavailable, and
   * cancelling that transaction (Escape) makes it available again. Only an edit that stays
   * in the history, a preset switch or a restore discards it (on the next Undo, jump or Redo).
   */
  canRedo(): boolean { return this.redoValid(); }
  state(): HistoryState {
    const valid = this.redoValid(), redo = valid ? this.redoStack.at(-1)?.label : undefined;
    return { undo: this.document.canUndo ? this.document.historyLabel() : undefined,
      redo: redo && { ...redo }, depth: this.document.undoDepth, redoDepth: valid ? this.redoStack.length : 0 };
  }
  /** Detached timeline of kept and redo-able steps; see `HistorySnapshot`. */
  snapshot(): HistorySnapshot {
    return historyTimeline(this.document, this.canRedo() ? [...this.redoStack].reverse() : []);
  }
  /** How many Undo or Redo steps reach `id`, or undefined when it is not a jump target now. */
  plan(id: string): HistoryJumpPlan | undefined {
    const timeline = this.snapshot();
    const index = id === timeline.startId ? -1 : timeline.steps.findIndex(step => step.id === id);
    if (index < 0 && id !== timeline.startId) return undefined;
    const delta = index - timeline.current;
    return { direction: delta < 0 ? "undo" : delta > 0 ? "redo" : "none", count: Math.abs(delta) };
  }
  /**
   * Go to the look right after step `id` (or the oldest kept state for the start ID) as one
   * change: the Undo/Redo steps between are applied to the history, and the document and
   * renderer resources are replaced once. Returns false when `id` is not a jump target.
   */
  jumpTo(id: string): boolean {
    const plan = this.plan(id);
    return !!plan && plan.direction !== "none" && this.move(plan);
  }
  private move(plan: HistoryJumpPlan): boolean {
    if (plan.direction === "undo") {
      if (this.document.undoDepth < plan.count) return false;
      if (!this.redoValid()) this.clearRedo();
      let after = JSON.stringify(this.document.recipe), next: Recipe | undefined;
      for (let i = 0; i < plan.count; i++) {
        const entry = this.document.undoEntry()!;
        this.redoStack.push({ encoded: after, label: entry.label ?? { ...UNKNOWN_HISTORY_LABEL }, id: entry.id,
          ...(entry.at === undefined ? {} : { at: entry.at }) });
        after = entry.encoded; next = entry.recipe;
      }
      if (!next) return false;
      this.publish(next);
    } else if (plan.direction === "redo") {
      if (!this.redoValid()) { this.clearRedo(); return false; }
      if (this.redoStack.length < plan.count) return false;
      let before = JSON.stringify(this.document.recipe), encoded = before;
      for (let i = 0; i < plan.count; i++) {
        const entry = this.redoStack.pop()!;
        this.document.reapplyHistory({ encoded: before, id: entry.id, label: entry.label,
          ...(entry.at === undefined ? {} : { at: entry.at }) });
        before = encoded = entry.encoded;
      }
      this.publish(parseRecipe(JSON.parse(encoded)));
    } else return false;
    this.expect();
    return true;
  }
  /** Replace the recipe once, keeping the active layer where it survives, and reset renderer resources. */
  private publish(next: Recipe) {
    const previous = this.document.recipe;
    const activeId = previous.layers[this.document.active]?.id;
    this.document.replaceRecipe(next, next.layers.findIndex(layer => layer.id === activeId));
    this.resetStack(previous);
  }
  private expect() {
    this.expected = { revision: this.document.geometryVersion.revision, encoded: JSON.stringify(this.document.recipe),
      top: this.document.historyTop };
  }
  private redoValid() {
    const expected = this.expected;
    if (!this.redoStack.length || !expected) return false;
    // Any entry added since (an edit, or an open transaction's checkpoint) hides Redo; a
    // cancelled transaction removes its own entry again, so Redo comes back.
    if (this.document.historyTop !== expected.top) return false;
    const revision = this.document.geometryVersion.revision;
    if (revision === expected.revision) return true;
    // A cancelled gesture republishes geometry without changing content; keep Redo then.
    if (JSON.stringify(this.document.recipe) !== expected.encoded) return false;
    expected.revision = revision;
    return true;
  }
  private clearRedo() { this.redoStack = []; this.expected = undefined; }
}
