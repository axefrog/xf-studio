/**
 * Automatic database backups (profiles and graph design §7.4): the library is the only home of the work, so it is
 * copied without asking, once each day the Studio runs and before every migration, keeping seven daily and four
 * weekly copies in a `backups` folder beside it. A purge reaches the backups too (decision Q7). Restoring swaps a copy
 * in after keeping the current file. SQLite's `VACUUM INTO` makes each copy: consistent, compact, and free of
 * deleted pages.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { NODE_ROWS } from "./sqlite-store";

export type BackupKind = "daily" | "pre-migration" | "pre-restore";
export type Backup = { readonly file: string; readonly kind: BackupKind; readonly day: string; readonly bytes: number; readonly nodes: number; readonly entries: number };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
/** The ISO week of a day, as `YYYY-Www` (weekly copies keep one per week). */
function isoWeek(day: string): string {
  const [, y, m, d] = DAY.exec(day)!.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export class LibraryBackups {
  readonly folder: string;
  private readonly stem: string;
  constructor(readonly library: string, private readonly now: () => number) {
    this.folder = join(dirname(library), "backups");
    this.stem = basename(library).replace(/\.sqlite$/, "");
  }

  private name(kind: BackupKind, day: string, suffix = ""): string { return join(this.folder, `${this.stem}.${kind}.${day}${suffix}.sqlite`); }

  /**
   * A consistent copy of the library at `target`, written beside it first and renamed into place, so a copy is never seen half-made. Made
   * through `through` when given (a connection the caller holds), else through a read-only connection of its own.
   */
  private copy(target: string, through?: Database): string {
    mkdirSync(this.folder, { recursive: true });
    const staging = `${target}.${process.pid}.tmp`;
    rmSync(staging, { force: true });
    const db = through ?? new Database(this.library, { readonly: true });
    try { db.query("VACUUM INTO ?").run(staging); } finally { if (!through) db.close(); }
    try {
      if (existsSync(target)) rmSync(target);
      renameSync(staging, target);
    } catch (error) { rmSync(staging, { force: true }); throw error; }
    return target;
  }

  /** Today's daily copy, if there isn't one yet, then retention. Returns the file made, if any. */
  daily(): string | undefined {
    if (!existsSync(this.library)) return undefined;
    const target = this.name("daily", isoDay(this.now()));
    if (existsSync(target)) return undefined;
    this.copy(target);
    this.prune();
    return target;
  }

  /**
   * A copy taken before a migration, one per migration (CORE-144): a copy already taken today for the same migration is kept as it is (a
   * window opened while another migrated, or an open whose migration failed after its copy, would otherwise replace it, perhaps with an
   * already migrated library), and a new day's copy for a migration that still hasn't run replaces the older ones. Pre-migration copies
   * of other migrations are kept until removed. Returns the copy.
   */
  beforeMigration(label: string): string {
    const suffix = `.${label.replace(/[^a-z0-9-]/gi, "-")}`;
    const target = this.name("pre-migration", isoDay(this.now()), suffix);
    if (existsSync(target)) return target;
    this.copy(target);
    for (const item of this.list())
      if (item.kind === "pre-migration" && item.file !== target && basename(item.file).endsWith(`${suffix}.sqlite`)) rmSync(item.file, { force: true });
    return target;
  }

  /**
   * Keeps the seven newest daily copies and, among older ones, the newest copy of each of the four newest weeks;
   * removes the other daily copies. Pre-migration and pre-restore copies are kept until removed deliberately.
   */
  prune(): void {
    const daily = this.list().filter(item => item.kind === "daily").sort((a, b) => a.day < b.day ? 1 : -1);
    const keep = new Set(daily.slice(0, 7).map(item => item.file));
    const weeks = new Set<string>();
    for (const item of daily.slice(7)) {
      const week = isoWeek(item.day);
      if (weeks.has(week) || weeks.size >= 4) continue;
      weeks.add(week);
      keep.add(item.file);
    }
    for (const item of daily) if (!keep.has(item.file)) rmSync(item.file, { force: true });
  }

  /** Every copy, newest first, with its counts. */
  list(): Backup[] {
    if (!existsSync(this.folder)) return [];
    const pattern = new RegExp(`^${this.stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(daily|pre-migration|pre-restore)\\.(\\d{4}-\\d{2}-\\d{2})(?:\\..*)?\\.sqlite$`);
    return readdirSync(this.folder).flatMap(name => {
      const match = pattern.exec(name);
      if (!match) return [];
      const file = join(this.folder, name);
      let nodes = 0, entries = 0;
      try {
        const db = new Database(file, { readonly: true });
        try {
          nodes = (db.query("SELECT COUNT(*) AS n FROM node_index").get() as { n: number }).n;
          entries = (db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
        } catch { /* a copy from before the graph tables */ } finally { db.close(); }
      } catch { /* unreadable: listed without counts */ }
      return [{ file, kind: match[1] as BackupKind, day: match[2], bytes: statSync(file).size, nodes, entries }];
    }).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : a.file < b.file ? 1 : -1);
  }

  /**
   * Removes a purged node's rows from every copy, and their freed pages with them. Every copy is tried; if any
   * couldn't be purged (locked) it throws afterwards, naming them, so the store keeps the purge pending and tries
   * again later. A copy SQLite can't read at all is removed instead.
   */
  purge(node: string): void {
    const failed: string[] = [];
    for (const item of this.list()) {
      // A copy this process already purged of the node, unchanged since, isn't opened again on a retry.
      const key = `${node}|${item.file}|${item.bytes}|${fileTime(item.file)}`;
      if (this.purged.has(key)) continue;
      try { purgeFile(item.file, [node]); this.purged.add(`${node}|${item.file}|${statSync(item.file).size}|${fileTime(item.file)}`); }
      catch (error) {
        // A copy SQLite can never read (not a database, damaged) can't serve a restore and can't be purged, so it would keep the purge
        // pending forever (CORE-145): it is removed, which purges it. A locked copy is tried again later.
        const code = (error as { code?: unknown })?.code;
        if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT") { try { rmSync(item.file); continue; } catch { /* In use: later. */ } }
        failed.push(basename(item.file));
      }
    }
    if (failed.length) throw new Error(`Some backups couldn't be purged yet: ${failed.join(", ")}.`);
  }
  /** Copies purged of a node by this process (node, file, size and time), skipped when a pending purge is retried. */
  private readonly purged = new Set<string>();

  /**
   * Restores a copy: the current library is kept as a pre-restore copy first. Refused while any other connection has
   * the library open (the host closes its stores first and restarts them afterwards): the last connection to close
   * removes the write-ahead log, so a log left after this one closes means another is still open. Purges still pending
   * in the current library are applied to the restored one before it replaces the library, so a restore never brings a
   * purged node back.
   */
  restore(file: string): string {
    if (!this.list().some(item => item.file === file)) throw new Error("That isn't one of this library's backups.");
    const refuse = () => new Error("Close the Studio's other windows before restoring a backup.");
    // Another connection keeps the write-ahead log after ours closes (the last one to close removes it).
    const busy = () => existsSync(`${this.library}-wal`);
    let pending: string[] = [], kept = "";
    if (existsSync(this.library)) {
      // One connection reads the pending purges and makes the pre-restore copy, so nothing of ours is left open or behind.
      const db = new Database(this.library);
      try {
        const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name));
        if (tables.has("purge_pending")) pending = (db.query("SELECT node FROM purge_pending").all() as { node: string }[]).map(row => row.node);
        kept = this.copy(this.name("pre-restore", isoDay(this.now()), `.${this.now()}`), db);
      } finally { db.close(); }
      if (busy()) throw refuse();
    }
    // The restored copy is made beside the library, pending purges applied to it, and renamed over it in one step (CORE-145): a window
    // that opened the library meanwhile made its write-ahead log (checked again just before), and on Windows the rename itself is refused
    // while any connection has the file open, so nobody's open library is replaced under them.
    const staged = `${this.library}.${process.pid}.restoring`;
    try {
      copyFileSync(file, staged);
      if (pending.length) purgeFile(staged, pending);
      for (const suffix of ["-wal", "-shm"]) rmSync(`${staged}${suffix}`, { force: true });
      if (busy()) throw refuse();
      try { rmSync(`${this.library}-shm`, { force: true }); renameSync(staged, this.library); } catch { throw refuse(); }
    } finally { rmSync(staged, { force: true }); }
    return kept;
  }
}

const fileTime = (file: string): number => { try { return statSync(file).mtimeMs; } catch { return 0; } };

/** Removes nodes' rows from one SQLite file (a backup, or a restored library), and their freed pages with them. */
function purgeFile(file: string, nodes: readonly string[]): void {
  const db = new Database(file);
  try {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA secure_delete=ON;");
    const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name));
    let removed = 0;
    for (const node of nodes) for (const table of NODE_ROWS) if (tables.has(table)) removed += db.query(`DELETE FROM ${table} WHERE node = ?`).run(node).changes;
    if (removed) db.exec("VACUUM;");
  } finally { db.close(); }
}
