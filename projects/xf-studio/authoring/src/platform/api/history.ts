/**
 * The look history's data (feature-module platform §3): one linear Undo history per look, across its
 * parts. Each step records only the parts it touched, as they were before it, split into content
 * chunks (the part codec's `chunks`) that the look stores once. Types only.
 */

/** What one Undo step did, for menus, tooltips and the History panel ("Undo Opacity"). Session-only. */
export type HistoryLabel = {
  label: string;
  /** The action (or gesture) kind that made the step, for example `layer.setOpacity`. */
  actionKind: string;
  /** The item the step changed inside its feature's part (for eye makeup, the layer), when there is one. */
  layerId?: string;
};

export type HistoryCommand = { kind: "history.undo" } | { kind: "history.redo" } | { kind: "history.jumpTo"; entryId: string };
export type HistoryState = { undo?: HistoryLabel; redo?: HistoryLabel; depth: number; redoDepth: number };
export type HistoryStep = HistoryLabel & { id: string; at?: number; state: "done" | "undone" };
export type HistorySnapshot = { startId: string; steps: HistoryStep[]; current: number; redoCount: number; trimmed: boolean; documentLabel?: string };
export type HistoryParticipant = { id: string; dispatch(action: HistoryCommand): boolean };
/**
 * The Undo history of separately stored documents (an experiment's documents, scoped by ID such as `hair:<id>`), beside the
 * look history. Each document's history is linear and isolated; global Undo and Redo reach the selected one. A step keeps
 * the document's value after it (and the history its value before the first step), so moving through the history hands
 * back the value to restore. Session only, like the look history's labels and Redo.
 */
export type DocumentHistory = {
  selected(): string | null;
  focus(id: string | null): void;
  snapshot(id: string): HistorySnapshot;
  /** Records a step after the current one (dropping the redo branch), with the document's value before and after it. */
  record(id: string, documentLabel: string, entry: HistoryLabel & { id: string }, change: { readonly before: unknown; readonly after: unknown }): void;
  /** Moves to step `current` (-1: before the first step) and returns the document's value there; undefined when it has no history. */
  move(id: string, current: number): unknown;
  /** Calls `listener` after every change (selection, a step recorded or moved); returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

/** The label of a step whose label was not kept (restored from a saved workspace). */
export const UNKNOWN_HISTORY_LABEL: HistoryLabel = Object.freeze({ label: "Earlier change", actionKind: "unknown" });

/** Opaque identity of one Undo step, unique for the whole session (also across looks and restores). */
export type HistoryEntryId = number & { readonly __historyEntry: unique symbol };

/** A content chunk's address in a look's chunk store: derived from its text, unique within the store. */
export type ChunkId = string;

/**
 * `part`: an action, form control or gesture changed one feature's part. `look`: one transaction
 * changed several parts at once (for example "Apply character from save" or "Reset look").
 */
export type HistoryScope = "part" | "look";

export const LOOK_HISTORY_1 = "xfs/look-history-1";

/**
 * One kept step as the look history stores it: the parts it touched, each as the chunk list of its
 * body before the step, or `null` when the look did not have that part yet.
 */
export type StoredLookEntry = { scope: HistoryScope; before: Readonly<Record<string, readonly ChunkId[] | null>> };

/**
 * A look's history as plain data (in memory and in `xfs/look-history-1`): kept steps oldest first
 * and the chunks they use, each stored once as its JSON value. Labels, times and Redo are
 * session-only, as they always were. `trimmed` is present (true) only when older steps were dropped.
 */
export type LookHistoryData = {
  schema: typeof LOOK_HISTORY_1;
  entries: StoredLookEntry[];
  chunks: Record<ChunkId, unknown>;
  trimmed?: true;
};

/** Undo steps kept per look; a new step beyond it drops the oldest (and says older steps were not kept). */
export const HISTORY_LIMIT = 80;

/**
 * How the look history reads parts (a part registry answers for every feature): `chunks` splits a
 * parsed part body into stable content chunks and `join` rebuilds the parsed body from them.
 */
export interface HistoryParts {
  chunks(feature: string, body: unknown): readonly unknown[];
  join(feature: string, chunks: readonly unknown[]): unknown;
}
