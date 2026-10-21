/**
 * Automatic library backups: the library file is the only home of the person's work, so it is copied without asking once
 * each day the Studio runs, keeping seven daily and four weekly copies in a `backups` folder beside it. Restoring swaps a
 * copy in after keeping the current file. SQLite's `VACUUM INTO` makes each copy: consistent, compact, and free of deleted
 * pages. Durability of the live file itself is `library-durability.ts`'s job.
 */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Clock } from "../core/clock";

export type BackupKind = "daily" | "pre-restore" | "pre-migration";
export type Backup = { readonly file: string; readonly kind: BackupKind; readonly day: string; readonly bytes: number };

/** How long after the host starts the first daily check runs (it never competes with startup), and how often it repeats. */
export const FIRST_BACKUP_DELAY_MS = 2_000;
export const BACKUP_CHECK_MS = 60 * 60 * 1000;

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
   * A copy taken before migration `id` changes existing rows (library-database.ts), through the migrating connection, before its
   * transaction starts. Named `<stem>.pre-migration.<day>.<id>.sqlite` and kept until removed deliberately. Throws when the copy
   * fails, so the migration doesn't run.
   */
  beforeMigration(id: string, through: Database): string {
    if (!/^[a-z0-9-]+$/.test(id)) throw Error("A migration ID names its backup, so it is lowercase letters, digits and dashes.");
    return this.copy(this.name("pre-migration", isoDay(this.now()), `.${id}`), through);
  }

  /**
   * Keeps taking the daily copy for as long as `signal` lives: the first check `FIRST_BACKUP_DELAY_MS` from now, then one
   * every `BACKUP_CHECK_MS`, so a Studio left running takes a copy each day. A failed copy never stops the Studio; it is
   * tried again at the next check.
   */
  keepDaily(clock: Clock, signal: AbortSignal): void {
    const check = () => { try { this.daily(); } catch { /* tried again at the next check */ } };
    const every = () => clock.after(BACKUP_CHECK_MS, () => { check(); every(); }, signal);
    clock.after(FIRST_BACKUP_DELAY_MS, () => { check(); every(); }, signal);
  }

  /**
   * Keeps the seven newest daily copies and, among older ones, the newest copy of each of the four newest weeks;
   * removes the other daily copies. Pre-restore and pre-migration copies are kept until removed deliberately.
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

  /** Every copy, newest first. */
  list(): Backup[] {
    if (!existsSync(this.folder)) return [];
    const pattern = new RegExp(`^${this.stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(daily|pre-restore|pre-migration)\\.(\\d{4}-\\d{2}-\\d{2})(?:\\..*)?\\.sqlite$`);
    return readdirSync(this.folder).flatMap(name => {
      const match = pattern.exec(name);
      if (!match) return [];
      const file = join(this.folder, name);
      return [{ file, kind: match[1] as BackupKind, day: match[2], bytes: statSync(file).size }];
    }).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : a.file < b.file ? 1 : -1);
  }

  /**
   * Restores a copy: the current library is kept as a pre-restore copy first. Refused while any other connection has
   * the library open (the host closes its stores first and restarts them afterwards): the last connection to close
   * removes the write-ahead log, so a log left after this one closes means another is still open.
   */
  restore(file: string): string {
    if (!this.list().some(item => item.file === file)) throw new Error("That isn't one of this library's backups.");
    const refuse = () => new Error("Close the Studio's other windows before restoring a backup.");
    // Another connection keeps the write-ahead log after ours closes (the last one to close removes it).
    const busy = () => existsSync(`${this.library}-wal`);
    let kept = "";
    if (existsSync(this.library)) {
      // One connection makes the pre-restore copy, so nothing of ours is left open or behind.
      const db = new Database(this.library);
      try { kept = this.copy(this.name("pre-restore", isoDay(this.now()), `.${this.now()}`), db); } finally { db.close(); }
      if (busy()) throw refuse();
    }
    // The restored copy is made beside the library and renamed over it in one step: a Studio that opened the library meanwhile made
    // its write-ahead log (checked again just before), and on Windows the rename itself is refused while any connection has the file
    // open, so nobody's open library is replaced under them.
    const staged = `${this.library}.${process.pid}.restoring`;
    try {
      copyFileSync(file, staged);
      for (const suffix of ["-wal", "-shm"]) rmSync(`${staged}${suffix}`, { force: true });
      if (busy()) throw refuse();
      try { rmSync(`${this.library}-shm`, { force: true }); renameSync(staged, this.library); } catch { throw refuse(); }
    } finally { rmSync(staged, { force: true }); }
    return kept;
  }
}
