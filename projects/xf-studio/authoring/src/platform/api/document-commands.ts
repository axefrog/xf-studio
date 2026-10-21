/**
 * Owner commands (profiles design §2.1) and the outbox they go through (§2.2). Types only.
 *
 * - **A command** changes one or more library documents in one host transaction (`DocumentStorePort.transact`): every write names the
 *   revision it read (`base`), and either every write commits or none does and the answer is `stale` with the current documents.
 * - **Commands are idempotent by ID.** The transaction also writes a receipt (a `documents` row of kind `xfs-receipt`, ID the command's)
 *   holding the revisions it produced; the same ID sent again is answered from the receipt and never applied twice. A replay with no
 *   receipt whose every target already holds exactly the value written is acknowledged at the current revisions (the equal-value rule).
 *   A later command names receipts its page no longer needs in `forget`; the host purges receipts older than 7 days at start.
 * - **The outbox is the only way a document's local state reaches the library** (`platform/core/document-outbox.ts`): an owner's
 *   in-memory view of a document is its acknowledged value with its outbox entries applied on top.
 */

/** A document's address. */
export type DocumentRef = { readonly kind: string; readonly id: string };
/** A document's key in answers and the outbox: `<kind>/<id>`. */
export const documentKey = (ref: DocumentRef) => `${ref.kind}/${ref.id}`;

/** A stored tombstone (§1.4): the next revision of a deleted document, keeping its last value so a restore brings it back. */
export type Tombstone<T = unknown> = { readonly tombstone: true; readonly at: number; readonly value: T };
export const isTombstone = (value: unknown): value is Tombstone =>
  !!value && typeof value === "object" && !Array.isArray(value) && (value as { tombstone?: unknown }).tombstone === true;
export const tombstoneOf = <T>(value: T, at: number): Tombstone<T> => ({ tombstone: true, at, value });

/** One write of a command as the host takes it: `base` is the revision it read (0: the document doesn't exist yet). */
export type TransactWrite = {
  readonly kind: string;
  readonly id: string;
  readonly base: number;
  /** The value stored as the next revision (a `Tombstone` for a delete). */
  readonly value: unknown;
};
export type TransactRequest = {
  /** The command's own ID: a replay with the same ID is answered from its receipt, never applied twice. */
  readonly id: string;
  /** What the command is (`character.create`, `profile.addSubject`). */
  readonly command: string;
  readonly writes: readonly TransactWrite[];
  /** Earlier command IDs whose receipts this page no longer needs. */
  readonly forget?: readonly string[];
  /**
   * Immutable, content-addressed documents the command references (a decoded save a character names): checked inside the command's
   * transaction, so a cleanup that purged one meanwhile makes the answer `missing`, never a reference to nothing.
   */
  readonly requires?: readonly DocumentRef[];
};
/** A document as it is now, in a stale answer or a read (null: it doesn't exist). */
export type CurrentDocument = { readonly revision: number; readonly value: unknown } | null;
/** Each written document's revision after a command, keyed `<kind>/<id>`. */
export type CommandRevisions = Readonly<Record<string, number>>;
/**
 * A command's answer: committed, with every written document's revision (`replayed` when it was answered from a receipt or by the
 * equal-value rule); `stale` with the written documents as they are now (nothing was written); `missing` when a document it requires
 * isn't in the library; `superseded` when the page no longer holds its workspace (a newer lease generation, §2.3).
 */
export type TransactAnswer =
  | { readonly ok: true; readonly revisions: CommandRevisions; readonly replayed?: "receipt" | "equal";
    /**
     * A replay answered from its receipt, from the workspace that wrote it: each written document every later revision of which this
     * same workspace also wrote (its own receipts say so), as it is now. The page builds on these, never against them (§2.2).
     */
    readonly own?: Readonly<Record<string, { readonly revision: number; readonly value: unknown }>>;
    /**
     * A replay answered from its receipt: each written document still at the revision the command produced, with the value it holds,
     * which is what the command committed (a stored copy a crash left may be an older version of the same command).
     */
    readonly committed?: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: "stale"; readonly current: Readonly<Record<string, CurrentDocument>> }
  /** A document the command `requires` isn't in the library (purged): nothing was written; the page puts it again and resends. */
  | { readonly ok: false; readonly reason: "missing"; readonly missing: readonly string[] }
  | { readonly ok: false; readonly reason: "superseded" };

/**
 * A stored receipt: the command, the revisions it produced and, when the command carried a workspace lease, the workspace and lease
 * generation that wrote it (so a later replay can tell this workspace's own later revisions from another's).
 */
export type Receipt = { readonly command: string; readonly revisions: CommandRevisions; readonly workspace?: string; readonly generation?: number };
/** The `documents` kind command receipts are kept under (ID: the command's). */
export const RECEIPT_KIND = "xfs-receipt";
/** How long a receipt is kept when no later command forgets it. */
export const RECEIPT_TTL_MS = 7 * 24 * 3600_000;
/** Kinds the host keeps for itself: no command may write them (its own `xfs-` kinds, and the migration records, profiles design §8). */
export const isHostKind = (kind: string) => kind.startsWith("xfs-") || kind === "migration";
/** Most writes in one command, and most receipts one command forgets. */
export const COMMAND_LIMITS = { writes: 64, forget: 512 } as const;

/** A command ID: unique per command, so a replay is recognised (`<command>:<time>-<random>`). */
export const commandId = (command: string, random: () => number = Math.random) =>
  `${command}:${Date.now().toString(36)}-${Math.floor(random() * 2 ** 48).toString(36)}`;

/** A document as an owner reads it: its value, its revision, and whether it is a tombstone. */
export type HeldDocument<T = unknown> = { readonly id: string; readonly revision: number; readonly value: T; readonly deleted: boolean };
