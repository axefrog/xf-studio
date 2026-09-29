/**
 * The Studio's graph store: XF Strata's `GraphStore` over the library's SQLite file (profiles and graph design §7.3).
 * Its tables are new and additive (`CREATE TABLE IF NOT EXISTS`): no released table is altered and `user_version` is
 * left as it is, so every earlier XF Studio opens the same library. It passes the engine's store conformance suite.
 *
 * Positions are never reissued (SPEC §19.3): `events.pos` is `AUTOINCREMENT`, so SQLite remembers the greatest
 * position ever assigned (in `sqlite_sequence`) and a purge of the newest rows can't hand their positions out again.
 * A library made before that (G1) is migrated in place when it opens (`migratePositions`), after a backup.
 */
import { Database } from "bun:sqlite";
import type { AppendRequest, AppendResult, Entry, GraphStore, NodeIndexRow, NodeRef, Op, Snapshot, StoredNode } from "strata";

/** The graph's `events` table. */
const EVENTS_TABLE = `(pos INTEGER PRIMARY KEY AUTOINCREMENT, node TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    commit_id TEXT NOT NULL, actor TEXT NOT NULL, actor_seq INTEGER NOT NULL, at INTEGER NOT NULL, schema TEXT NOT NULL,
    op TEXT NOT NULL, extra TEXT, UNIQUE (node, seq))`;
const EVENTS_COLUMNS = "pos, node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra";

/**
 * The graph's tables. `events.extra` holds an entry's commit metadata, provenance and inlined streams;
 * `purge_pending` lists purges whose follow-up (the log checkpoint and the backups) hasn't finished yet.
 */
export const GRAPH_TABLES = `
  CREATE TABLE IF NOT EXISTS library_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events ${EVENTS_TABLE};
  CREATE INDEX IF NOT EXISTS events_commit ON events (commit_id);
  CREATE TABLE IF NOT EXISTS snapshots (node TEXT PRIMARY KEY, type TEXT NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
    schema TEXT NOT NULL, value TEXT NOT NULL, made_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS compactions (node TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS node_index (node TEXT PRIMARY KEY, type TEXT NOT NULL, head_seq INTEGER NOT NULL, name TEXT NOT NULL,
    trashed INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS export_ids (id TEXT PRIMARY KEY, kind TEXT NOT NULL, node TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS save_backups (save TEXT NOT NULL, taken_at INTEGER NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS purge_pending (node TEXT PRIMARY KEY, at INTEGER NOT NULL);`;

/** The rows that name a node, in every graph table (purge removes them all, here and in backups). */
export const NODE_ROWS = ["events", "snapshots", "compactions", "node_index", "export_ids"] as const;

/** Whether the library's `events` table still reuses positions (G1's `pos INTEGER PRIMARY KEY`). */
function reusesPositions(db: Database): boolean {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'").get() as { sql: string } | null;
  return !!row && !/\bAUTOINCREMENT\b/i.test(row.sql);
}

/**
 * Rebuilds a G1 `events` table with `AUTOINCREMENT` positions, keeping every row and its position, in one immediate
 * transaction (a failure or crash leaves the old table as it was). `sqlite_sequence` starts at the greatest stored
 * position: positions a G1 purge already freed can't be recovered, but none is reissued from then on. `before` runs
 * first, once a migration is known to be needed (the host takes a backup). Returns whether it migrated.
 */
export function migratePositions(db: Database, before?: () => void): boolean {
  if (!reusesPositions(db)) return false;
  before?.();
  return db.transaction((): boolean => {
    if (!reusesPositions(db)) return false;   // another connection migrated it meanwhile
    const count = (table: string) => (db.query(`SELECT COUNT(*) AS n, COALESCE(MAX(pos), 0) AS top FROM ${table}`).get() as { n: number; top: number });
    const old = count("events");
    db.exec(`DROP TABLE IF EXISTS events_migrating; CREATE TABLE events_migrating ${EVENTS_TABLE};
      INSERT INTO events_migrating (${EVENTS_COLUMNS}) SELECT ${EVENTS_COLUMNS} FROM events ORDER BY pos;`);
    const copied = count("events_migrating");
    if (copied.n !== old.n || copied.top !== old.top) throw new Error(`The graph's entries couldn't be migrated (${copied.n} of ${old.n} copied).`);
    db.exec(`DROP TABLE events; ALTER TABLE events_migrating RENAME TO events;
      CREATE INDEX IF NOT EXISTS events_commit ON events (commit_id);`);
    return true;
  }).immediate();
}

type EventRow = { pos: number; node: string; type: string; seq: number; commit_id: string; actor: string; actor_seq: number; at: number;
  schema: string; op: string; extra: string | null };

const toEntry = (row: EventRow): Entry => ({
  node: { type: row.type, id: row.node }, seq: row.seq, pos: row.pos, commit: row.commit_id, actor: row.actor, actorSeq: row.actor_seq,
  at: row.at, schema: row.schema, op: JSON.parse(row.op) as Op, ...(row.extra ? JSON.parse(row.extra) as Partial<Entry> : {}),
});

function extraOf(entry: Entry): string | null {
  const extra = { ...(entry.meta ? { meta: entry.meta } : {}), ...(entry.provenance ? { provenance: entry.provenance } : {}),
    ...(entry.inlined ? { inlined: entry.inlined } : {}) };
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

/** The name and trash state an op leaves, for the index (no folding of values needed). */
function indexAfter(previous: { name: string; trashed: boolean }, op: Op): { name: string; trashed: boolean } {
  switch (op.kind) {
    case "create": case "import": case "state": return { name: op.state.name, trashed: op.state.trashed };
    case "rename": return { ...previous, name: op.name };
    case "trash": return { ...previous, trashed: true };
    case "restore": return { ...previous, trashed: false };
    case "compensate": case "revert": return op.ops.reduce(indexAfter, previous);
    default: return previous;
  }
}

export type SqliteGraphStoreOptions = {
  /**
   * Removes a purged node from the backups as well (decision Q7). A throw leaves that purge pending: it is retried by
   * `retryPurges`, on the next purge and when the store next opens, until it succeeds.
   */
  readonly onPurge?: (node: string) => void;
  /** Called once a migration of the graph's tables is needed, before it changes the file (the host takes a backup). */
  readonly beforeMigration?: (label: string) => void;
  /** Wall time for the snapshots' `made_at` and pending purges (the host clock by default). */
  readonly now?: () => number;
};

export class SqliteGraphStore implements GraphStore {
  private readonly db: Database;
  /** Why the positions migration couldn't run when the store opened, if it couldn't (diagnostics). */
  readonly migrationError?: string;
  constructor(readonly path: string, private readonly options: SqliteGraphStoreOptions = {}) {
    this.db = new Database(path, { create: true, strict: true });
    // Purged rows are overwritten on disk, not merely unlinked (removal, not hiding).
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;");
    // A migration that can't run now (no backup could be taken, the file is busy) never stops the Studio: the
    // library keeps working as it is and the migration is tried again the next time it opens.
    try { migratePositions(this.db, () => options.beforeMigration?.("graph-positions")); }
    catch (error) { this.migrationError = error instanceof Error ? error.message : String(error); }
    this.db.exec(GRAPH_TABLES);
    this.retryPurges();
  }
  close(): void { this.db.close(); }

  private bump(): void {
    this.db.query("INSERT INTO library_info VALUES ('graph.counter', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
  }

  async list(): Promise<readonly NodeIndexRow[]> {
    return (this.db.query("SELECT node, type, head_seq, name, trashed FROM node_index ORDER BY rowid").all() as
      { node: string; type: string; head_seq: number; name: string; trashed: number }[])
      .map(row => ({ ref: { type: row.type, id: row.node }, headSeq: row.head_seq, name: row.name, trashed: !!row.trashed }));
  }

  async load(): Promise<{ readonly head: number; readonly nodes: readonly StoredNode[] }> {
    const snapshots = new Map((this.db.query("SELECT node, type, seq, pos, schema, value FROM snapshots").all() as
      { node: string; type: string; seq: number; pos: number; schema: string; value: string }[])
      .map(row => [row.node, { node: { type: row.type, id: row.node }, seq: row.seq, pos: row.pos, schema: row.schema, state: JSON.parse(row.value) } as Snapshot]));
    // Each node's tail after its snapshot, by an index range per node.
    const rows = this.db.query(`SELECT e.* FROM node_index n JOIN events e ON e.node = n.node
      AND e.seq > COALESCE((SELECT seq FROM snapshots s WHERE s.node = n.node), 0) ORDER BY n.rowid, e.seq`).all() as EventRow[];
    const tails = new Map<string, { ref: NodeRef; tail: Entry[] }>();
    for (const row of rows) {
      let item = tails.get(row.node);
      if (!item) tails.set(row.node, item = { ref: { type: row.type, id: row.node }, tail: [] });
      item.tail.push(toEntry(row));
    }
    const nodes: StoredNode[] = [];
    for (const row of this.db.query("SELECT node, type FROM node_index ORDER BY rowid").all() as { node: string; type: string }[]) {
      const snapshot = snapshots.get(row.node);
      nodes.push({ ref: { type: row.type, id: row.node }, ...(snapshot ? { snapshot } : {}), tail: tails.get(row.node)?.tail ?? [] });
    }
    return { head: this.head(), nodes };
  }

  /** Whether SQLite's `sqlite_sequence` exists (made with the first `AUTOINCREMENT` table; once made, it stays). */
  private sequence = false;
  /**
   * The greatest position ever assigned: it never decreases, even when the newest entries are purged (SPEC §19.3). A G1 library whose
   * migration couldn't run yet has no `sqlite_sequence` (CORE-143): its head is its greatest stored position, as G1 read it.
   */
  private head(): number {
    this.sequence ||= !!this.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get();
    const top = (this.db.query("SELECT COALESCE(MAX(pos), 0) AS top FROM events").get() as { top: number }).top;
    if (!this.sequence) return top;
    const seq = (this.db.query("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get() as { seq: number } | null)?.seq ?? 0;
    return Math.max(seq, top);
  }

  async readStream(node: NodeRef, afterSeq = 0): Promise<readonly Entry[]> {
    return (this.db.query("SELECT * FROM events WHERE node = ? AND seq > ? ORDER BY seq").all(node.id, afterSeq) as EventRow[]).map(toEntry);
  }

  async append(request: AppendRequest): Promise<AppendResult> {
    return this.db.transaction((): AppendResult => {
      const existing = this.db.query("SELECT pos FROM events WHERE commit_id = ? ORDER BY pos").all(request.commit) as { pos: number }[];
      if (existing.length) return { ok: true, positions: existing.map(row => row.pos), duplicate: true };
      const stale = request.expect.filter(([id, seq]) =>
        ((this.db.query("SELECT head_seq FROM node_index WHERE node = ?").get(id) as { head_seq: number } | null)?.head_seq ?? 0) !== seq).map(([id]) => id);
      if (stale.length) return { ok: false, reason: "stale", nodes: stale };
      const insert = this.db.query(`INSERT INTO events (node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING pos`);
      const positions: number[] = [];
      for (const entry of request.entries) {
        const row = insert.get(entry.node.id, entry.node.type, entry.seq, entry.commit, entry.actor, entry.actorSeq, entry.at, entry.schema,
          JSON.stringify(entry.op), extraOf(entry)) as { pos: number };
        positions.push(row.pos);
        this.indexEntry(entry);
      }
      this.bump();
      return { ok: true, positions };
    }).immediate();
  }

  private indexEntry(entry: Entry): void {
    const current = this.db.query("SELECT name, trashed FROM node_index WHERE node = ?").get(entry.node.id) as { name: string; trashed: number } | null;
    const next = indexAfter({ name: current?.name ?? "", trashed: !!current?.trashed }, entry.op);
    this.db.query(`INSERT INTO node_index VALUES (?, ?, ?, ?, ?) ON CONFLICT(node) DO UPDATE SET head_seq = excluded.head_seq,
      name = excluded.name, trashed = excluded.trashed`).run(entry.node.id, entry.node.type, entry.seq, next.name, next.trashed ? 1 : 0);
  }

  async changesSince(pos: number): Promise<{ readonly head: number; readonly entries: readonly Entry[] }> {
    return this.db.transaction(() => {
      const entries = (this.db.query("SELECT * FROM events WHERE pos > ? ORDER BY pos").all(pos) as EventRow[]).map(toEntry);
      return { head: this.head(), entries };
    }).deferred();
  }

  /** A counter every append, compaction and purge bumps, from every connection sharing the library. */
  async counter(): Promise<number> {
    const own = this.db.query("SELECT value FROM library_info WHERE key = 'graph.counter'").get() as { value: string } | null;
    return Number(own?.value ?? 0);
  }

  async putSnapshot(snapshot: Snapshot): Promise<void> {
    // A snapshot of a node that is no longer indexed (purged meanwhile) is not written: it would bring its data back.
    this.db.query(`INSERT INTO snapshots SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM node_index WHERE node = ?1)
      ON CONFLICT(node) DO UPDATE SET seq = excluded.seq, pos = excluded.pos,
      schema = excluded.schema, value = excluded.value, made_at = excluded.made_at WHERE excluded.seq >= snapshots.seq`)
      .run(snapshot.node.id, snapshot.node.type, snapshot.seq, snapshot.pos, snapshot.schema, JSON.stringify(snapshot.state),
        (this.options.now ?? Date.now)());
  }

  async dropSnapshots(node: NodeRef): Promise<void> { this.db.query("DELETE FROM snapshots WHERE node = ?").run(node.id); }

  async compact(node: NodeRef, entries: readonly Entry[], at: number): Promise<void> {
    const through = entries[entries.length - 1]?.seq ?? 0;
    this.db.transaction(() => {
      this.db.query("DELETE FROM events WHERE node = ? AND seq <= ?").run(node.id, through);
      const insert = this.db.query(`INSERT INTO events (pos, node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const entry of entries) insert.run(entry.pos, entry.node.id, entry.node.type, entry.seq, entry.commit, entry.actor, entry.actorSeq,
        entry.at, entry.schema, JSON.stringify(entry.op), extraOf(entry));
      this.db.query("INSERT INTO compactions VALUES (?, ?, ?)").run(node.id, through, at);
      this.db.query("DELETE FROM snapshots WHERE node = ?").run(node.id);
      this.bump();
    }).immediate();
  }

  /**
   * Removes the node's rows, then finishes the purge: the write-ahead log is folded into the (securely deleted) file
   * and the backups are purged. The removal commits with a pending record; a follow-up that can't finish now (a
   * reader holding the log, a locked backup) stays pending and is retried, and never fails the purge itself.
   */
  async purge(node: NodeRef): Promise<void> {
    this.db.transaction(() => {
      for (const table of NODE_ROWS) this.db.query(`DELETE FROM ${table} WHERE node = ?`).run(node.id);
      this.db.query("INSERT INTO purge_pending VALUES (?, ?) ON CONFLICT(node) DO NOTHING").run(node.id, (this.options.now ?? Date.now)());
      this.bump();
    }).immediate();
    this.retryPurges();
  }

  /** Purges whose log checkpoint or backups haven't finished yet. */
  pendingPurges(): readonly string[] {
    return (this.db.query("SELECT node FROM purge_pending ORDER BY at, node").all() as { node: string }[]).map(row => row.node);
  }

  /**
   * Finishes pending purges: checkpoints the write-ahead log into the file (a checkpoint another reader blocks leaves
   * them pending) and removes each node from the backups. Returns the nodes still pending.
   */
  retryPurges(): readonly string[] {
    const pending = this.pendingPurges();
    if (!pending.length) return pending;
    const checkpoint = this.db.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number } | null;
    if (checkpoint && checkpoint.busy !== 0) return pending;
    const finished: string[] = [];
    for (const node of pending) {
      try { this.options.onPurge?.(node); finished.push(node); } catch { /* a locked backup: retried later */ }
    }
    if (finished.length) {
      const remove = this.db.query("DELETE FROM purge_pending WHERE node = ?");
      this.db.transaction(() => { for (const node of finished) remove.run(node); })();
    }
    return this.pendingPurges();
  }
}
