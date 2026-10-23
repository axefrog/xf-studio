/**
 * Spike prototype (S1, S3): the host side of owner commands over the real library owner (`LibraryDatabase`) and its
 * `documents` table. Evidence code, not production: see ../README.md.
 *
 * `transact` is one immediate transaction. It is idempotent by command ID: the command's **receipt**
 * (`xfs-receipt/<command id>`, a `documents` row written in the same transaction) answers a replay with the revisions the
 * command produced, so a committed command whose acknowledgement was lost is acknowledged again, never reported as a
 * conflict. A window forgets receipts it no longer needs by naming them in a later command (`forget`); the host purges
 * receipts older than `RECEIPT_TTL_MS` at start. A replay whose receipt is gone, but whose every write already holds
 * exactly the replayed value, is also acknowledged (`replayed: "equal"`).
 */
import type { Database } from "bun:sqlite";
import type { LibraryDatabase } from "../../../projects/xf-studio/authoring/src/platform/persistence/library-database";

export type Ref = { readonly kind: string; readonly id: string };
export const refKey = (ref: Ref) => `${ref.kind}/${ref.id}`;
export type HostWrite = { kind: string; id: string; base: number; value?: unknown; tombstone?: true };
export type TransactRequest = { id: string; command: string; writes: HostWrite[]; forget?: string[]; generation?: number };
export type Current = Record<string, { revision: number; value: unknown } | null>;
export type TransactResult =
  | { ok: true; revisions: Record<string, number>; replayed?: "receipt" | "equal" }
  | { ok: false; reason: "stale"; current: Current }
  | { ok: false; reason: "fenced" };

export const RECEIPT = "xfs-receipt";
export const RECEIPT_TTL_MS = 7 * 24 * 3600_000;

type Row = { revision: number; value: string };
const rowOf = (db: Database, kind: string, id: string) =>
  db.query("SELECT revision, value FROM documents WHERE kind = ? AND id = ?").get(kind, id) as Row | null;
const textOf = (write: HostWrite) => JSON.stringify(write.tombstone ? { tombstone: true, value: write.value ?? null } : write.value);

export type HostHooks = {
  /** Runs inside the transaction after every write was applied and before it commits (a kill here rolls back). */
  beforeCommit?(request: TransactRequest): void;
};

export class SpikeHost {
  /** The lease generation commands must carry (host fencing, §2.3); 0 disables the check. */
  generation = 0;
  constructor(readonly db: LibraryDatabase, private readonly hooks: HostHooks = {}, private readonly now: () => number = Date.now) {}

  transact(request: TransactRequest): TransactResult {
    if (this.generation && request.generation !== this.generation) return { ok: false, reason: "fenced" };
    return this.db.write(db => {
      for (const id of request.forget ?? []) db.query("DELETE FROM documents WHERE kind = ? AND id = ?").run(RECEIPT, id);
      const receipt = rowOf(db, RECEIPT, request.id);
      if (receipt) return { ok: true, revisions: (JSON.parse(receipt.value) as { revisions: Record<string, number> }).revisions, replayed: "receipt" };
      const rows = request.writes.map(write => rowOf(db, write.kind, write.id));
      if (request.writes.some((write, i) => (rows[i]?.revision ?? 0) !== write.base)) {
        // Lost acknowledgement whose receipt was purged or forgotten: every write already holds this exact value.
        if (request.writes.every((write, i) => rows[i] && rows[i]!.value === textOf(write)))
          return { ok: true, revisions: Object.fromEntries(request.writes.map((write, i) => [refKey(write), rows[i]!.revision])), replayed: "equal" };
        return { ok: false, reason: "stale", current: Object.fromEntries(request.writes.map((write, i) =>
          [refKey(write), rows[i] ? { revision: rows[i]!.revision, value: JSON.parse(rows[i]!.value) } : null])) };
      }
      const at = this.now(), revisions: Record<string, number> = {};
      request.writes.forEach((write, i) => {
        const revision = write.base + 1, text = textOf(write);
        if (rows[i]) db.query("UPDATE documents SET revision = ?, value = ?, updated_at = ? WHERE kind = ? AND id = ?").run(revision, text, at, write.kind, write.id);
        else db.query("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?)").run(write.kind, write.id, revision, text, at, at);
        revisions[refKey(write)] = revision;
      });
      db.query("INSERT INTO documents VALUES (?, ?, 1, ?, ?, ?)").run(RECEIPT, request.id, JSON.stringify({ revisions, at }), at, at);
      this.hooks.beforeCommit?.(request);
      return { ok: true, revisions };
    });
  }

  /** Current revisions of `refs` (0 for a missing document): the §2.2 revision check, one read. */
  revisions(refs: Ref[]): Record<string, number> {
    return this.db.read(db => Object.fromEntries(refs.map(ref => [refKey(ref), rowOf(db, ref.kind, ref.id)?.revision ?? 0])));
  }

  get(ref: Ref): { revision: number; value: unknown } | null {
    const row = this.db.read(db => rowOf(db, ref.kind, ref.id));
    return row ? { revision: row.revision, value: JSON.parse(row.value) } : null;
  }

  /** Receipts older than the TTL, in one transaction (host start). */
  purgeReceipts(olderThan = RECEIPT_TTL_MS): number {
    const cutoff = this.now() - olderThan;
    return this.db.write(db => db.query("DELETE FROM documents WHERE kind = ? AND updated_at < ?").run(RECEIPT, cutoff).changes);
  }
}
