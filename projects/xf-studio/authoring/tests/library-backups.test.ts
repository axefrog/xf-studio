/**
 * The library's automatic backups (`platform/persistence/backups.ts`): one a day, seven daily and four weekly kept, taken
 * by a running host every day it runs, and restorable (keeping the current file) only while no other window has it open.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKUP_CHECK_MS, FIRST_BACKUP_DELAY_MS, LibraryBackups } from "../src/platform/persistence/backups";
import { openTestLibrary } from "./fixtures/library-file";
import { ManualClock } from "./fixtures/platform-doubles";
import { tempDir } from "./temp-dir";

const folders: string[] = [];
function folder(): string { const dir = tempDir("xfs-backups-"); folders.push(dir); return dir; }
afterEach(() => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing */ } });
const DAY = 86_400_000, START = Date.UTC(2026, 8, 1, 9);

/** A library file holding one document. */
function libraryWith(path: string, value: unknown): void {
  const file = openTestLibrary(path), store = file.documents;
  try { store.put("sample", "a", value, store.get("sample", "a")?.revision ?? 0); } finally { file.close(); }
}

test("daily backups: one a day, seven daily and four weekly kept, and restore keeps the current file", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  let now = START;
  libraryWith(path, "kept");
  const backups = new LibraryBackups(path, () => now);
  expect(backups.daily()).toBeDefined();
  expect(backups.daily()).toBeUndefined();   // once a day
  for (let day = 1; day < 40; day++) { now = START + day * DAY; backups.daily(); }
  const daily = backups.list().filter(item => item.kind === "daily");
  expect(daily.length).toBe(11);   // seven daily, four weekly
  expect(daily.every(item => item.bytes > 0)).toBe(true);
  libraryWith(path, "changed since");
  const kept = backups.restore(daily[3].file);
  expect(existsSync(kept)).toBe(true);
  expect(readdirSync(join(dir, "backups")).some(name => name.includes("pre-restore"))).toBe(true);
  const restored = openTestLibrary(path);
  try { expect(restored.documents.get("sample", "a")?.value).toBe("kept"); } finally { restored.close(); }
  expect(readdirSync(join(dir, "backups")).some(name => name.endsWith(".tmp"))).toBe(false);
}, 30_000);   // Several backup rounds on disk: a few seconds on CI's Windows runner.

test("restore is refused while another connection has the library open", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  libraryWith(path, "kept");
  const store = openTestLibrary(path);
  const backups = new LibraryBackups(path, () => START);
  const copy = backups.daily()!;
  expect(() => backups.restore(copy)).toThrow("other windows");
  store.close();
  expect(existsSync(backups.restore(copy))).toBe(true);
  expect(() => backups.restore(join(dir, "elsewhere.sqlite"))).toThrow("isn't one of this library's backups");
});

test("a restore is made beside the library and renamed over it, refused if another window opened it meanwhile", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  libraryWith(path, "kept");
  const backups = new LibraryBackups(path, () => START);
  const copy = backups.daily()!;
  // A window opens the library while the restore prepares its copy (after the restore's first check).
  let window: Database | null = null;
  const original = Database.prototype.close;
  Database.prototype.close = function (this: Database, ...args: Parameters<typeof original>) {
    const result = original.apply(this, args);
    if (!window) { window = new Database(path); window.exec("PRAGMA journal_mode=WAL; SELECT 1;"); }
    return result;
  };
  try { expect(() => backups.restore(copy)).toThrow("other windows"); }
  finally { Database.prototype.close = original; (window as Database | null)?.close(); }
  // Nothing staged is left behind; with the window closed the restore goes ahead.
  expect(readdirSync(dir).filter(name => name.includes("restoring"))).toEqual([]);
  expect(existsSync(backups.restore(copy))).toBe(true);
});

test("a running host takes its first backup a moment after starting, then keeps taking one each day, checking every hour", () => {
  const dir = folder(), path = join(dir, "library.sqlite"), clock = new ManualClock(START), life = new AbortController();
  libraryWith(path, "kept");
  const backups = new LibraryBackups(path, () => clock.now());
  backups.keepDaily(clock, life.signal);
  expect(backups.list()).toEqual([]);   // never during startup
  clock.advance(FIRST_BACKUP_DELAY_MS);
  expect(backups.list().length).toBe(1);
  for (let hour = 0; hour < 50; hour++) clock.advance(BACKUP_CHECK_MS);
  const days = new Set(Array.from({ length: 51 }, (_, hour) => new Date(START + FIRST_BACKUP_DELAY_MS + hour * BACKUP_CHECK_MS).toISOString().slice(0, 10)));
  expect(backups.list().filter(item => item.kind === "daily").length).toBe(days.size);
  life.abort();
  expect(clock.pending()).toEqual([]);   // the checks end with the library's lifetime
});
