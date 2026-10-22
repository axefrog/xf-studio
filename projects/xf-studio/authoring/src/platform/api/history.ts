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

/**
 * Undo, Redo and a jump. Undo and Redo may name the history scope they step (`scope`: `look:<collection>/<look>`, `character:<id>`),
 * as a focused panel's own Undo does (the 3D view steps the look it shows); without one they step the focused scope, the editing context.
 */
/** A move through one history scope's steps, as the scope carries it out. */
export type HistoryMove = { kind: "history.undo" } | { kind: "history.redo" } | { kind: "history.jumpTo"; entryId: string };
/**
 * Undo, Redo or a jump as an action: the move and the history scope it acts on (profiles design §3.6, §3.7). The input layer names the
 * scope (the editing context, or a focused 3D view's look); nothing defaults it.
 */
export type HistoryCommand = HistoryMove & { scope: string };
export type HistoryState = { undo?: HistoryLabel; redo?: HistoryLabel; depth: number; redoDepth: number };
export type HistoryStep = HistoryLabel & { id: string; at?: number; state: "done" | "undone" };
export type HistorySnapshot = { startId: string; steps: HistoryStep[]; current: number; redoCount: number; trimmed: boolean; documentLabel?: string };
export type HistoryParticipant = { id: string; dispatch(action: HistoryMove): boolean };
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

/** The oldest kept state of a timeline (the look's); not a step of its own. */
export const HISTORY_START_ID = "start";
/** How many Undo or Redo steps reach a timeline entry. */
export type HistoryJumpPlan = { direction: "undo" | "redo" | "none"; count: number };

/**
 * A history scope's name in the history service: `look` (the selected look, persisted), `view` (the View and lighting
 * history) and `doc:<id>` (an experiment's document, such as `doc:hair:<groom>`). Session-only except the look's.
 */
export type HistoryScopeId = string;
/** Why a scope applies values: an Undo, a Redo, or a cancelled transaction's revert (which never creates Redo). */
export type HistoryCause = "undo" | "redo" | "revert";

/**
 * What a history scope records and restores: values by key (the look: features' parts; the view graph: node IDs and
 * `structure`; a document: its ID). The service owns the steps, Redo validity and transactions; the target owns its state.
 */
export interface HistoryTarget {
  /** The value of `key` as it is now; undefined when there is none (a part the look lacks, a node that does not exist). */
  read(key: string): unknown | undefined;
  /**
   * Show `values` (undefined: remove), published once. False when they cannot be applied consistently (CORE-94): the scope then
   * drops its steps, since they could never apply again, and nothing changes.
   */
  apply(values: Readonly<Record<string, unknown | undefined>>, cause: HistoryCause): boolean;
  /**
   * A cheap token that changes whenever the content may have: while it is what the last Undo or Redo left, Redo stays valid
   * without comparing content. Without it, Redo validity compares the fingerprint every time.
   */
  revision?(): unknown;
  /**
   * Called once a move has settled (Redo validity included), after `apply`: a target that publishes its change from here hands
   * subscribers the history state as it stands.
   */
  settled?(): void;
  /**
   * The content under `keys` (all, when omitted). Redo is valid only while it is what the last Undo or Redo left (CORE-46): a
   * change that records no step hides Redo, which would overwrite it. A transaction compares it to tell an empty one. Targets
   * without one keep Redo until a new step is recorded.
   */
  fingerprint?(keys?: readonly string[]): string;
}
