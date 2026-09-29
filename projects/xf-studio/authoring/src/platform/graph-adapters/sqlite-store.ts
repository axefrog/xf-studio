/**
 * The Studio's graph store: XF Strata's `GraphStore` over the library's SQLite file (profiles and graph design §7.3).
 * Its tables are new and additive (`CREATE TABLE IF NOT EXISTS`): no released table is altered and `user_version` is
 * left as it is, so every earlier XF Studio opens the same library. It passes the engine's store conformance suite.
 */
import { Database } from "bun:sqlite";
import type { AppendRequest, AppendResult, Entry, GraphStore, NodeIndexRow, NodeRef, Op, Snapshot, StoredNode } from "strata";

/** The graph's tables. `events.extra` holds an entry's commit metadata, provenance and inlined streams. */
export const GRAPH_TABLES = `
  CREATE TABLE IF NOT EXISTS library_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (pos INTEGER PRIMARY KEY, node TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    commit_id TEXT NOT NULL, actor TEXT NOT NULL, actor_seq INTEGER NOT NULL, at INTEGER NOT NULL, schema TEXT NOT NULL,
    op TEXT NOT NULL, extra TEXT, UNIQUE (node, seq));
  CREATE INDEX IF NOT EXISTS events_commit ON events (commit_id);
  CREATE TABLE IF NOT EXISTS snapshots (node TEXT PRIMARY KEY, type TEXT NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
    schema TEXT NOT NULL, value TEXT NOT NULL, made_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS compactions (node TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS node_index (node TEXT PRIMARY KEY, type TEXT NOT NULL, head_seq INTEGER NOT NULL, name TEXT NOT NULL,
    trashed INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS export_ids (id TEXT PRIMARY KEY, kind TEXT NOT NULL, node TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS save_backups (save TEXT NOT NULL, taken_at INTEGER NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL);`;

/** The rows that name a node, in every graph table (purge removes them all, here and in backups). */
export const NODE_ROWS = ["events", "snapshots", "compactions", "node_index", "export_ids"] as const;

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
  /** Called after a purge with the node's ID, to remove it from the backups as well (decision Q7). */
  readonly onPurge?: (node: string) => void;
  /** Wall time for the snapshots' `made_at` (the host clock by default). */
  readonly now?: () => number;
};

export class SqliteGraphStore implements GraphStore {
  private readonly db: Database;
  constructor(readonly path: string, private readonly options: SqliteGraphStoreOptions = {}) {
    this.db = new Database(path, { create: true, strict: true });
    // Purged rows are overwritten on disk, not merely unlinked (removal, not hiding).
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;");
    this.db.exec(GRAPH_TABLES);
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

  private head(): number {
    return (this.db.query("SELECT COALESCE(MAX(pos), 0) AS head FROM events").get() as { head: number }).head;
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
    const entries = (this.db.query("SELECT * FROM events WHERE pos > ? ORDER BY pos").all(pos) as EventRow[]).map(toEntry);
    return { head: this.head(), entries };
  }

  /** A counter every append, compaction and purge bumps, from every connection sharing the library. */
  async counter(): Promise<number> {
    const own = this.db.query("SELECT value FROM library_info WHERE key = 'graph.counter'").get() as { value: string } | null;
    return Number(own?.value ?? 0);
  }

  async putSnapshot(snapshot: Snapshot): Promise<void> {
    this.db.query(`INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(node) DO UPDATE SET seq = excluded.seq, pos = excluded.pos,
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

  async purge(node: NodeRef): Promise<void> {
    this.db.transaction(() => {
      for (const table of NODE_ROWS) this.db.query(`DELETE FROM ${table} WHERE node = ?`).run(node.id);
      this.bump();
    }).immediate();
    // The write-ahead log may still hold the removed pages: fold it into the (securely deleted) file now.
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.options.onPurge?.(node.id);
  }
}
