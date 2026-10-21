/**
 * Owner commands (profiles design §2.1): related library documents change only through their owner's commands, each one host transaction
 * over every document it writes, checked against the revisions it read. A command has an ID; the same ID sent again is answered from
 * the first answer (its receipt) and never applied twice. Types only.
 *
 * Phase 1b writes through the existing document store one document at a time (`platform/core/document-commands.ts`); the host's
 * `transact`, receipts and the outbox (phase 1c) take over behind the same port.
 */

/** One write of a command: `base` is the revision it read (0: the document doesn't exist yet). */
export type CommandWrite =
  | { readonly kind: string; readonly id: string; readonly base: number; readonly value: unknown }
  /** Deleted: the next revision is a tombstone keeping the last value (§1.4), so a restore brings it back. */
  | { readonly kind: string; readonly id: string; readonly base: number; readonly tombstone: true; readonly value: unknown };

export type DocumentCommand = {
  /** The command's own ID: a replay with the same ID is answered, never applied twice. */
  readonly id: string;
  /** What the command is (`character.create`, `profile.addSubject`). */
  readonly command: string;
  readonly writes: readonly CommandWrite[];
  /** Earlier command IDs whose receipts are no longer needed. */
  readonly forget?: readonly string[];
};

/** A document's revision after a command, keyed `<kind>/<id>`. */
export type CommandRevisions = Readonly<Record<string, number>>;
export const commandKey = (kind: string, id: string) => `${kind}/${id}`;
/**
 * A command's answer: committed with every written document's revision; `stale` with the current revisions when a base no longer
 * matched (nothing was written); `superseded` when the page no longer holds its workspace.
 */
export type CommandAnswer =
  | { readonly ok: true; readonly revisions: CommandRevisions }
  | { readonly ok: false; readonly reason: "stale"; readonly current: CommandRevisions }
  | { readonly ok: false; readonly reason: "superseded" };

/** A stored tombstone (§1.4): the next revision of a deleted document. */
export type Tombstone<T = unknown> = { readonly tombstone: true; readonly at: number; readonly value: T };
export const isTombstone = (value: unknown): value is Tombstone =>
  !!value && typeof value === "object" && (value as { tombstone?: unknown }).tombstone === true;

/** A document as an owner reads it: its value, its revision, and whether it is a tombstone. */
export type HeldDocument<T = unknown> = { readonly id: string; readonly revision: number; readonly value: T; readonly deleted: boolean };

/** Where owners commit their commands and read their documents. */
export interface DocumentCommandPort {
  commit(command: DocumentCommand): Promise<CommandAnswer>;
  /** Every document of a kind, tombstones included (`deleted`). */
  list<T = unknown>(kind: string, signal?: AbortSignal): Promise<readonly HeldDocument<T>[]>;
}
