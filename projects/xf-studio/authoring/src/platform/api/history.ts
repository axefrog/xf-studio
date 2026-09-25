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
