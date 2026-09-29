/**
 * Automatic database backups (profiles and graph design §7.4): the library is the only home of the work, so it is
 * copied without asking, once each day the Studio runs and before every migration, keeping seven daily and four
 * weekly copies in a `backups` folder beside it. A purge reaches the backups too (decision Q7). Restoring swaps a copy
 * in after keeping the current file. SQLite's `VACUUM INTO` makes each copy: consistent, compact, and free of
 * deleted pages.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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

  private copy(target: string): string {
    mkdirSync(this.folder, { recursive: true });
    if (existsSync(target)) rmSync(target);
    const db = new Database(this.library, { readonly: true });
    try { db.query("VACUUM INTO ?").run(target); } finally { db.close(); }
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

  /** A copy taken before a migration (kept until removed). */
  beforeMigration(label: string): string {
    return this.copy(this.name("pre-migration", isoDay(this.now()), `.${label.replace(/[^a-z0-9-]/gi, "-")}`));
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
   * couldn't be purged (locked, unreadable) it throws afterwards, naming them, so the store keeps the purge pending
   * and tries again later.
   */
  purge(node: string): void {
    const failed: string[] = [];
    for (const item of this.list()) {
      try { purgeFile(item.file, [node]); } catch { failed.push(basename(item.file)); }
    }
    if (failed.length) throw new Error(`Some backups couldn't be purged yet: ${failed.join(", ")}.`);
  }

  /**
   * Restores a copy: the current library is kept as a pre-restore copy first. Refused while any other connection has
   * the library open (the host closes its stores first and restarts them afterwards): the last connection to close
   * removes the write-ahead log, so a log left after this one closes means another is still open. Purges still pending
   * in the current library are applied to the restored one, so a restore never brings a purged node back.
   */
  restore(file: string): string {
    if (!this.list().some(item => item.file === file)) throw new Error("That isn't one of this library's backups.");
    let pending: string[] = [];
    if (existsSync(this.library)) {
      const db = new Database(this.library);
      try {
        const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name));
        if (tables.has("purge_pending")) pending = (db.query("SELECT node FROM purge_pending").all() as { node: string }[]).map(row => row.node);
      } finally { db.close(); }
      if (existsSync(`${this.library}-wal`)) throw new Error("Close the Studio's other windows before restoring a backup.");
    }
    const kept = existsSync(this.library) ? this.copy(this.name("pre-restore", isoDay(this.now()), `.${this.now()}`)) : "";
    // Only this process's read-only copy connection can have left these, and it is closed.
    for (const suffix of ["-wal", "-shm"]) rmSync(`${this.library}${suffix}`, { force: true });
    copyFileSync(file, this.library);
    if (pending.length) purgeFile(this.library, pending);
    return kept;
  }
}

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
