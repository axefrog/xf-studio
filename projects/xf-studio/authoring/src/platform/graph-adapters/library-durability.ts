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
 *
 * The scheduled flush runs on a worker thread with its own short-lived connection (PIPE-137), so the host's thread never
 * waits for the disk's sync (170–220 ms on a slow drive); the last flush when the file's lifetime ends runs at once, on
 * the host's thread, so quitting still makes everything durable before the process ends.
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
    return checkpointDone(row);
  } finally { db.close(); }
}

/**
 * A checkpoint's row: done when every frame of the log was checkpointed, or the file isn't in WAL mode. `busy` (another
 * checkpoint, such as the worker's, held the lock) is never done, although SQLite then reports the log as -1 too.
 */
export const checkpointDone = (row: { busy: number; log: number; checkpointed: number }) =>
  row.busy === 0 && (row.log < 0 || row.checkpointed === row.log);

/**
 * The checkpoint worker's source: `checkpointLibrary` on its own thread and connection. Started from a Blob, so the
 * bundled desktop host needs no worker file of its own. It answers `{ id, done }` or `{ id, error }`.
 */
const CHECKPOINT_WORKER = `import { Database } from "bun:sqlite";
self.onmessage = event => {
  const { id, path } = event.data;
  let db;
  try {
    db = new Database(path, { readwrite: true, create: false, strict: true });
    db.exec("PRAGMA synchronous=NORMAL;");
    const row = db.query("PRAGMA wal_checkpoint(PASSIVE)").get();
    postMessage({ id, done: row.busy === 0 && (row.log < 0 || row.checkpointed === row.log) });
  } catch (error) { postMessage({ id, error: String(error && error.message || error) }); }
  finally { try { db?.close(); } catch {} }
};`;

/** Bun's worker, which can be kept from holding the process open. */
type BunWorker = Worker & { ref(): void; unref(): void };
type CheckpointWorker = { worker: BunWorker; next: number; waiting: Map<number, { resolve: (done: boolean) => void; reject: (error: Error) => void }> };
let checkpointWorker: CheckpointWorker | null = null;

/** `checkpointLibrary` on the process's one checkpoint worker, started when first needed and never keeping the process alive. */
export function checkpointInWorker(path: string): Promise<boolean> {
  if (!checkpointWorker) {
    const worker = new Worker(URL.createObjectURL(new Blob([CHECKPOINT_WORKER], { type: "application/javascript" }))) as BunWorker;
    const state: CheckpointWorker = { worker, next: 0, waiting: new Map() };
    const failAll = (error: Error) => {
      if (checkpointWorker === state) checkpointWorker = null;
      for (const pending of state.waiting.values()) pending.reject(error);
      state.waiting.clear();
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ id: number; done?: boolean; error?: string }>) => {
      const pending = state.waiting.get(event.data.id);
      if (!pending) return;
      state.waiting.delete(event.data.id);
      if (event.data.error !== undefined) pending.reject(new Error(event.data.error)); else pending.resolve(event.data.done === true);
      if (!state.waiting.size) worker.unref();
    };
    worker.onerror = event => failAll(new Error(event.message || "The library's checkpoint worker failed."));
    worker.unref();
    checkpointWorker = state;
  }
  const state = checkpointWorker;
  return new Promise<boolean>((resolve, reject) => {
    const id = state.next++;
    state.waiting.set(id, { resolve, reject });
    // Referenced while a checkpoint is out, so a quiet host still gets its answer.
    state.worker.ref();
    state.worker.postMessage({ id, path });
  });
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
  /** Makes the committed writes durable now, on this thread; true once every one is (default: `checkpointLibrary` on the file). */
  readonly sync?: () => boolean;
  /**
   * The same off this thread, for the scheduled flushes (default: `checkpointInWorker`; when only `sync` is given, `sync`).
   * The end of the lifetime and `flush()` always use `sync`.
   */
  readonly syncInBackground?: () => Promise<boolean>;
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
  /** A background flush on its way, and the first write made since it started (not covered by it). */
  private inFlight = false;
  private sinceStart?: number;
  private landed: Promise<void> = Promise.resolve();
  constructor(readonly path: string, private readonly options: LibraryDurabilityOptions) {
    this.timing = options.timing ?? LIBRARY_FLUSH;
    options.signal.addEventListener("abort", () => { this.finalFlush(); }, { once: true });
  }

  /** Whether some commit may not have reached the disk yet. */
  get pending(): boolean { return this.first !== undefined; }

  wrote(): void {
    const now = this.options.clock.monotonic();
    this.first ??= now;
    this.last = now;
    if (this.inFlight) this.sinceStart ??= now;
    if (this.options.signal.aborted) { this.flush(); return; }
    this.arm(now);
  }

  /** Makes every commit so far durable now, on this thread. True when it did; otherwise another flush is scheduled. */
  flush(): boolean {
    if (this.first === undefined) return true;
    let done = false, error: unknown;
    try { done = (this.options.sync ?? (() => checkpointLibrary(this.path)))(); } catch (caught) { error = caught ?? new Error("flush failed"); }
    // Everything so far is covered, including writes made while a background flush was out.
    if (done) this.sinceStart = undefined;
    return this.settle(done, error, false);
  }

  /** The end of the lifetime: flush now; while a background checkpoint holds the lock, wait for it briefly and try again. */
  private finalFlush(): void {
    const deadline = Date.now() + 2_000;
    while (!this.flush() && this.inFlight && Date.now() < deadline) Bun.sleepSync(20);
  }

  /** A scheduled flush, off this thread; its answer arrives later (`settle`), and one runs at a time. */
  private flushInBackground(): void {
    if (this.first === undefined || this.inFlight) return;
    const run = this.options.syncInBackground ?? (this.options.sync ? null : () => checkpointInWorker(this.path));
    if (!run) { this.flush(); return; }
    this.inFlight = true;
    this.sinceStart = undefined;
    let started: Promise<boolean>;
    try { started = run(); } catch (error) { started = Promise.reject(error); }
    this.landed = started.then(done => { this.inFlight = false; this.settle(done, undefined, true); },
      error => { this.inFlight = false; this.settle(false, error ?? new Error("flush failed"), true); });
  }

  /** Resolves once the background flush on its way (if any) has been recorded. */
  idle(): Promise<void> { return this.landed; }

  /** Record a flush's outcome: clear what it covered, or schedule a retry with back-off. */
  private settle(done: boolean, error: unknown, background: boolean): boolean {
    // Reported once per run of failures (retries back off, so a lasting fault doesn't fill the log).
    if (error !== undefined && !this.reported) { this.reported = true; this.options.report?.(error); }
    if (this.first === undefined) return true;   // a flush on this thread already covered it
    const now = this.options.clock.monotonic();
    if (done) {
      this.retryAt = undefined; this.failures = 0; this.reported = false;
      const later = background ? this.sinceStart : undefined;
      this.sinceStart = undefined;
      if (later === undefined) { this.first = this.last = undefined; return true; }
      // Writes made while it ran are still to flush, due from the first of them.
      this.first = later;
      if (!this.options.signal.aborted) this.arm(now); else this.flush();
      return true;
    }
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
      else this.flushInBackground();
    }, this.options.signal);
  }
}
