/**
 * The library files' durability (research/authoring/library-durability.md). Every connection to a library file runs
 * SQLite's write-ahead log with `synchronous=NORMAL`, so a commit no longer waits for the disk; a flush then makes the
 * commits durable within a few seconds of the last one. Guarantee: the file is never corrupted, an app crash or kill
 * loses nothing, and a power cut or OS crash loses at most the commits of the last few seconds.
 *
 * What SQLite documents (sqlite.org/pragma.html#pragma_synchronous, wal.html), and this relies on:
 * - "WAL mode is safe from corruption with synchronous=NORMAL"; a commit made since the log was last synced "might roll
 *   back following a power loss or system crash", and "Transactions are durable across application crashes regardless
 *   of the synchronous setting or journal mode".
 * - With NORMAL, "the checkpoint is the only operation to issue an I/O barrier or sync": the WAL is synced before a
 *   checkpoint copies it into the database and the database is synced after a completed checkpoint.
 * - `wal_checkpoint(PASSIVE)` never waits for readers or writers and never calls the busy handler; it returns the log's
 *   frame count and how many were checkpointed. When the two are equal every committed frame reached the disk.
 * - NORMAL is not safe in rollback-journal mode on older file systems, so it is set only once the file is confirmed in
 *   WAL mode (a file that can't enter WAL keeps SQLite's default, FULL, which syncs every commit).
 */
import { Database } from "bun:sqlite";
import type { AbortSignalLike, Clock } from "strata";

/** A store tells its library file's durability that it committed a write. */
export interface LibraryWrites { wrote(): void }

/**
 * Puts a library connection in WAL mode (persistent in the file; a no-op when it already is) and, once WAL is confirmed,
 * `synchronous=NORMAL`. Returns whether the file is in WAL mode. `synchronous` is per connection, so every connection
 * that writes a library file calls this.
 */
export function useWriteAheadLog(db: Database): boolean {
  const { journal_mode: mode } = db.query("PRAGMA journal_mode=WAL").get() as { journal_mode: string };
  const wal = mode.toLowerCase() === "wal";
  db.exec(`PRAGMA synchronous=${wal ? "NORMAL" : "FULL"};`);
  return wal;
}

/**
 * Makes every commit to a library file durable: a passive checkpoint through a short-lived connection of its own (so
 * none is left open to hold the log, see `LibraryBackups.restore`). True when every committed frame reached the disk,
 * false when a reader kept some in the log (the caller tries again). A file not in WAL mode syncs on every commit.
 */
export function checkpointLibrary(path: string): boolean {
  const db = new Database(path, { readwrite: true, create: false, strict: true });
  try {
    // NORMAL: the checkpoint syncs the log before copying it and the database after (the pragma's documented behaviour).
    db.exec("PRAGMA synchronous=NORMAL;");
    const row = db.query("PRAGMA wal_checkpoint(PASSIVE)").get() as { busy: number; log: number; checkpointed: number };
    return row.log < 0 || row.checkpointed === row.log;
  } finally { db.close(); }
}

/** When a flush runs: `quietMs` after the last write, and no later than `maxMs` after the first write it covers. */
export type FlushTiming = { readonly quietMs: number; readonly maxMs: number; readonly retryMaxMs: number };
/** The library's timing: a power cut loses at most about 5 s of commits (plus the flush's own time). */
export const LIBRARY_FLUSH: FlushTiming = { quietMs: 2_000, maxMs: 5_000, retryMaxMs: 30_000 };

export type LibraryDurabilityOptions = {
  /** Timers (the host clock; simulated in tests). */
  readonly clock: Clock;
  /** The file's open lifetime: when it aborts, a last flush runs at once, and every later write flushes as it happens. */
  readonly signal: AbortSignalLike;
  readonly timing?: FlushTiming;
  /** A flush that failed, the first of a run of failures (it is tried again later). */
  readonly report?: (error: unknown) => void;
  /** Makes the committed writes durable; true once every one is (default: `checkpointLibrary` on the file). */
  readonly sync?: () => boolean;
};

/**
 * One library file's flush schedule. Stores call `wrote()` after each commit; a flush runs `quietMs` after the last
 * write, or `maxMs` after the first unflushed one under steady writing, and at once when the file's lifetime ends (the
 * host's close and quit). A flush that didn't cover everything (a reader held the log) or failed is tried again, backing
 * off up to `retryMaxMs`.
 */
export class LibraryDurability implements LibraryWrites {
  private readonly timing: FlushTiming;
  /** Monotonic times of the first and last writes not yet flushed (undefined when everything is durable). */
  private first?: number;
  private last?: number;
  /** After a flush that didn't finish: not again before this time. */
  private retryAt?: number;
  private failures = 0;
  private reported = false;
  private armed = false;
  constructor(readonly path: string, private readonly options: LibraryDurabilityOptions) {
    this.timing = options.timing ?? LIBRARY_FLUSH;
    options.signal.addEventListener("abort", () => { this.flush(); }, { once: true });
  }

  /** Whether some commit may not have reached the disk yet. */
  get pending(): boolean { return this.first !== undefined; }

  wrote(): void {
    const now = this.options.clock.monotonic();
    this.first ??= now;
    this.last = now;
    if (this.options.signal.aborted) { this.flush(); return; }
    this.arm(now);
  }

  /** Makes every commit so far durable now. True when it did; otherwise another flush is scheduled. */
  flush(): boolean {
    if (this.first === undefined) return true;
    let done = false;
    try { done = (this.options.sync ?? (() => checkpointLibrary(this.path)))(); }
    // Reported once per run of failures (retries back off, so a lasting fault doesn't fill the log).
    catch (error) { if (!this.reported) { this.reported = true; this.options.report?.(error); } }
    const now = this.options.clock.monotonic();
    if (done) { this.first = this.last = this.retryAt = undefined; this.failures = 0; this.reported = false; return true; }
    this.failures++;
    this.retryAt = now + Math.min(this.timing.quietMs * 2 ** (this.failures - 1), this.timing.retryMaxMs);
    if (!this.options.signal.aborted) this.arm(now);
    return false;
  }

  /** When the pending writes are due to be flushed. */
  private due(): number {
    const due = Math.min(this.last! + this.timing.quietMs, this.first! + this.timing.maxMs);
    return this.retryAt === undefined ? due : Math.max(due, this.retryAt);
  }

  /** One timer at a time: when it fires early (later writes moved the due time), it waits again for the rest. */
  private arm(now: number): void {
    if (this.armed) return;
    this.armed = true;
    this.options.clock.after(Math.max(0, this.due() - now), () => {
      this.armed = false;
      if (this.first === undefined) return;
      const at = this.options.clock.monotonic();
      if (at < this.due()) this.arm(at);
      else this.flush();
    }, this.options.signal);
  }
}
