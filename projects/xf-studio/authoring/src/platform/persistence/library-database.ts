/**
 * One owner per library file (research/authoring/library-durability.md "One owner"). A `LibraryDatabase` holds the file's
 * only connection, brings its schema up to date through a list of migrations when it opens, runs every store's writes as
 * immediate transactions, tells the file's durability once per committed write, and closes (flushing) once. The look,
 * collection, part-preset and document stores all take it; none opens the file itself.
 *
 * **Compatibility.** The published 0.1.0-alpha.2 opens the same file and refuses one whose `user_version` is above 2, and it
 * inserts into its tables positionally. So `user_version` is never raised above `RELEASED_LIBRARY_VERSION`, and no released
 * table is altered, renamed or dropped: later changes are new tables, recorded in the migration ledger
 * (`xfs_migrations`), which older builds never read.
 *
 * **Opening writes nothing unless a migration is pending.** A migration is pending when the ledger doesn't name it and its
 * own check (`applied`) finds the schema without it. Each pending migration runs in one immediate transaction with its
 * ledger row, so a crash leaves it either done or not started. The first migration that writes the ledger also records the
 * migrations it finds already applied (the backfill). Ledger IDs this build doesn't know (a newer build's) are allowed. A
 * migration that rewrites existing rows (`rewritesRows`) runs only after a consistent copy of the file was taken
 * (`LibraryBackups.beforeMigration`), inside the file's write lock and after checking again that the step is still pending, so
 * two openers never both migrate or overwrite each other's copy; if the copy fails, opening stops and nothing changes.
 */
import { Database } from "bun:sqlite";
import type { Clock } from "../core/clock";
import type { LibraryBackups } from "./backups";
import { LibraryDurability, useWriteAheadLog, type FlushTiming, type LibraryWrites } from "./library-durability";

/** The library's `user_version`: 2 since the first published release, and never raised (0.1.0-alpha.2 refuses anything above). */
export const RELEASED_LIBRARY_VERSION = 2;

/** One step of the library's schema. `applied` reads the schema; `apply` runs inside the migration's transaction. */
export type LibraryMigration = {
  readonly id: string;
  /** Whether the file already has this step (made by an earlier build, or before the ledger existed). */
  applied(db: Database): boolean;
  apply(db: Database): void;
  /** It changes or removes existing rows: a consistent copy of the file is taken first. */
  readonly rewritesRows?: true;
};

/** The file was written by a newer XF Studio (its `user_version` is above the released one). */
export class LibraryTooNewError extends Error {
  constructor() { super("This library needs a newer version of XF Studio."); this.name = "LibraryTooNewError"; }
}

export type LibraryDatabaseOptions = {
  /** Timers for the durability's flushes (the host clock; simulated in tests). */
  readonly clock: Clock;
  /** The host's lifetime: when it aborts, the durability flushes at once, and later writes flush as they happen. */
  readonly signal?: AbortSignal;
  readonly migrations: readonly LibraryMigration[];
  /** The file's backups: copies before a row-rewriting migration, and `restore`. Null: no copies (a scratch or test file). */
  readonly backups: LibraryBackups | null;
  /** A flush that failed (the first of a run; it is tried again). */
  readonly report?: (error: unknown) => void;
  /** Test seams: the flush schedule, or a stand-in told of each commit instead of the file's own durability. */
  readonly timing?: FlushTiming;
  readonly writes?: LibraryWrites;
};

const LEDGER = "xfs_migrations";
const MEMORY = ":memory:";

const userVersion = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const hasTable = (db: Database, name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const ledgerHas = (db: Database, id: string) => hasTable(db, LEDGER) && !!db.query(`SELECT 1 FROM ${LEDGER} WHERE id = ?`).get(id);
const pending = (db: Database, migration: LibraryMigration) => !ledgerHas(db, migration.id) && !migration.applied(db);
const totalChanges = (db: Database) => (db.query("SELECT total_changes() AS n").get() as { n: number }).n;

/**
 * Opens one connection to `path` and brings it up to date. Returns the connection and whether a migration ran. A file
 * from a newer build is refused before anything is written; any failure closes the connection.
 */
function connect(path: string, options: LibraryDatabaseOptions): { db: Database; migrated: boolean } {
  const db = new Database(path, { create: true, strict: true });
  try {
    if (userVersion(db) > RELEASED_LIBRARY_VERSION) throw new LibraryTooNewError();
    // Other processes (tools, a second host) wait for a lock rather than failing at once.
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    useWriteAheadLog(db);
    let migrated = false;
    for (const migration of options.migrations) {
      if (!pending(db, migration)) continue;
      // The file's write lock first: another opener migrating at the same time waits here, then finds the step done.
      db.exec("BEGIN IMMEDIATE");
      let copy: string | undefined;
      // The step runs inside a savepoint of the owner's own, uniquely named: if it is still there afterwards, nothing the step
      // did escaped this transaction (no commit, no transaction of its own), so rolling back undoes all of it.
      const step = `xfs_step_${crypto.randomUUID().replaceAll("-", "")}`;
      /** The step's savepoint was released into the owner's transaction: what follows is the owner's own work. */
      let ours = false;
      try {
        if (!pending(db, migration)) { db.exec("COMMIT"); continue; }
        // The copy reads the file as committed, which this transaction hasn't changed yet; it runs on a connection of its own
        // (a copy can't be made inside a transaction) while the lock keeps every other writer out.
        if (migration.rewritesRows) copy = options.backups?.beforeMigration(migration.id);
        db.exec(`SAVEPOINT ${step}`);
        migration.apply(db);
        try { db.exec(`RELEASE ${step}`); ours = true; }
        catch { throw Error(`Migration ${migration.id} ended the library's transaction.`); }
        if (userVersion(db) > RELEASED_LIBRARY_VERSION) throw Error(`Migration ${migration.id} raised the library version.`);
        db.exec(`CREATE TABLE IF NOT EXISTS ${LEDGER} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
        // The backfill: steps made before the ledger existed are recorded the first time it is written.
        for (const other of options.migrations)
          if (other !== migration && other.applied(db)) db.query(`INSERT OR IGNORE INTO ${LEDGER} VALUES (?, 'before-ledger')`).run(other.id);
        db.query(`INSERT OR IGNORE INTO ${LEDGER} VALUES (?, ?)`).run(migration.id, new Date(options.clock.now()).toISOString());
        db.exec("COMMIT");
        migrated = true;
      } catch (error) {
        // Rolled back verifiably only while the owner's transaction is still the one it began: its savepoint (before the step
        // released it) or the step's work released into it. Otherwise the step committed something, and the copy is kept.
        let undone = false;
        if (db.inTransaction) {
          try { db.exec(`ROLLBACK TO ${step}`); undone = true; } catch { undone = ours; }
          db.exec("ROLLBACK");
        }
        // Undone: the file is what the copy holds, so a retry's copy would only repeat it.
        if (undone && copy) try { options.backups?.discardMigrationCopy(copy); } catch { /* Kept: a spare copy is harmless. */ }
        throw error;
      }
    }
    return { db, migrated };
  } catch (error) { db.close(); throw error; }
}

export class LibraryDatabase {
  private connection: Database | null;
  /** The file's lifetime: ends at `close`, or when the host's does. */
  private readonly life = new AbortController();
  /** The file's flush schedule (null for an in-memory file, or when a stand-in is told of the commits). */
  readonly durability: LibraryDurability | null;
  private readonly writes: LibraryWrites | null;
  /** How deep the current `write` is (nested writes are savepoints of the outermost). */
  private depth = 0;

  private constructor(readonly path: string, private readonly options: LibraryDatabaseOptions) {
    const { db, migrated } = connect(path, options);
    this.connection = db;
    options.signal?.addEventListener("abort", () => this.life.abort(), { once: true });
    if (options.signal?.aborted) this.life.abort();
    this.durability = options.writes || path === MEMORY ? null : new LibraryDurability(path, { clock: options.clock, signal: this.life.signal,
      timing: options.timing, report: options.report });
    this.writes = options.writes ?? this.durability;
    if (migrated) this.writes?.wrote();
  }

  /** Opens `path` (created when missing) and runs its pending migrations. Throws `LibraryTooNewError` for a newer build's file. */
  static open(path: string, options: LibraryDatabaseOptions): LibraryDatabase {
    return new LibraryDatabase(path, options);
  }

  private open(): Database {
    if (!this.connection) throw Error("The library is closed.");
    return this.connection;
  }

  /** Runs `query` on the file's connection. */
  read<T>(query: (db: Database) => T): T { return query(this.open()); }

  /**
   * Runs `change` in an immediate transaction: it commits when `change` returns and rolls back when it throws. A write inside
   * another write is a savepoint of it. The file's durability is told once, after the outermost commit, and only when the
   * transaction changed a row (a refused or no-op write reports nothing).
   */
  write<T>(change: (db: Database) => T): T {
    const db = this.open();
    if (this.depth > 0) {
      this.depth++;
      try { return db.transaction(() => change(db))(); } finally { this.depth--; }
    }
    const before = totalChanges(db);
    this.depth = 1;
    let result: T;
    try { result = db.transaction(() => change(db)).immediate(); } finally { this.depth = 0; }
    if (totalChanges(db) !== before) this.writes?.wrote();
    return result;
  }

  /**
   * Replaces the file with one of its backups: flushes, closes the connection, restores (`LibraryBackups.restore`, which keeps
   * the current file as a pre-restore copy first) and opens again, migrating the copy if it is older. Returns the pre-restore
   * copy. Refused (and the file reopened as it was) while another connection has the file open.
   */
  restore(backup: string): string {
    if (!this.options.backups) throw Error("This library keeps no backups.");
    if (this.depth > 0) throw Error("A backup can't be restored inside a write.");
    const db = this.open();
    this.durability?.flush();
    db.close();
    this.connection = null;
    try { return this.options.backups.restore(backup); }
    finally {
      const { db: reopened, migrated } = connect(this.path, this.options);
      this.connection = reopened;
      if (migrated) this.writes?.wrote();
    }
  }

  /** Flushes and closes the file. Idempotent. */
  close(): void {
    if (!this.connection) return;
    this.life.abort();
    this.connection.close();
    this.connection = null;
  }
}
