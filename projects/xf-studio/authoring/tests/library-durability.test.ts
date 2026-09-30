/**
 * The library files' durability (research/authoring/library-durability.md): every library connection runs WAL with
 * `synchronous=NORMAL`; a flush makes commits durable `quietMs` after the last write and at most `maxMs` after the first
 * under steady writing, at once when the file's lifetime ends (close and quit), and again later when it couldn't finish.
 * A process killed mid-write leaves a database that passes `integrity_check` and holds every save it acknowledged.
 */
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Scheduler, simClock } from "strata/testing";
import { checkpointLibrary, LIBRARY_FLUSH, LibraryDurability, useWriteAheadLog } from "../src/platform/graph-adapters/library-durability";
import { LookLibrary } from "../src/library-store";
import { CollectionLibrary } from "../src/collection-store";
import { PartPresetLibrary } from "../src/part-preset-store";
import { SqliteGraphStore } from "../src/platform/graph-adapters/sqlite-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { initialRecipe } from "./fixtures/eye-region";

const folders: string[] = [];
function library(): string { const dir = mkdtempSync(join(tmpdir(), "xfs-durability-")); folders.push(dir); return join(dir, "library.sqlite"); }
afterEach(() => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* closing */ } });

/** A durability on simulated time whose flushes are recorded (and fail while `fail` says so). */
function simulated(options: { fail?: () => boolean; throws?: () => boolean } = {}) {
  const scheduler = new Scheduler(), life = new AbortController(), flushes: number[] = [], reports: unknown[] = [];
  const durability = new LibraryDurability("sim.sqlite", { clock: simClock(scheduler), signal: life.signal, report: error => reports.push(error),
    sync: () => {
      flushes.push(scheduler.now);
      if (options.throws?.()) throw new Error("disk unavailable");
      return !options.fail?.();
    } });
  return { scheduler, life, flushes, reports, durability };
}

test("a flush runs quietMs after the last write, not before", () => {
  const { scheduler, flushes, durability } = simulated();
  expect(LIBRARY_FLUSH).toEqual({ quietMs: 2_000, maxMs: 5_000, retryMaxMs: 30_000 });
  durability.wrote();
  scheduler.advance(1_999);
  expect(flushes).toEqual([]);
  expect(durability.pending).toBe(true);
  scheduler.advance(1);
  expect(flushes).toEqual([2_000]);
  expect(durability.pending).toBe(false);
  // Nothing written since: no timer, no flush.
  expect(scheduler.pending()).toEqual([]);
  scheduler.advance(60_000);
  expect(flushes).toEqual([2_000]);
});

test("each write moves the flush later, up to maxMs after the first unflushed write", () => {
  const { scheduler, flushes, durability } = simulated();
  durability.wrote();
  scheduler.advance(1_500); durability.wrote();   // due 3,500
  scheduler.advance(1_500); durability.wrote();   // due 5,000 (first + max)
  scheduler.advance(1_900);
  expect(flushes).toEqual([]);
  scheduler.advance(100);
  expect(flushes).toEqual([5_000]);
  // One timer at a time, however many writes.
  for (let i = 0; i < 50; i++) durability.wrote();
  expect(scheduler.pending().length).toBe(1);
});

test("under steady writing a flush runs at least every maxMs, so nothing waits longer than that for the disk", () => {
  const { scheduler, flushes, durability } = simulated();
  let lastFlushed = 0, oldestUnflushed: number | undefined;
  for (let t = 0; t < 60_000; t += 250) {
    durability.wrote();
    oldestUnflushed ??= scheduler.now;
    const before = flushes.length;
    scheduler.advance(250);
    if (flushes.length > before) {
      expect(flushes.at(-1)! - oldestUnflushed).toBeLessThanOrEqual(LIBRARY_FLUSH.maxMs);
      lastFlushed = flushes.at(-1)!; oldestUnflushed = undefined;
    }
  }
  expect(flushes.length).toBe(12);
  for (let i = 1; i < flushes.length; i++) expect(flushes[i] - flushes[i - 1]).toBeLessThanOrEqual(LIBRARY_FLUSH.maxMs + 250);
  // The writing stops: whatever the last flush didn't cover is flushed quietMs after the last write.
  durability.wrote();
  scheduler.advance(LIBRARY_FLUSH.quietMs);
  expect(flushes.at(-1)).toBe(lastFlushed + LIBRARY_FLUSH.quietMs);
  expect(durability.pending).toBe(false);
});

test("a flush that couldn't finish is tried again, backing off, and a failure is reported once per run", () => {
  let failing = true, throwing = true;
  const { scheduler, flushes, reports, durability } = simulated({ fail: () => failing, throws: () => throwing });
  durability.wrote();
  scheduler.advance(2_000);
  expect(flushes).toEqual([2_000]);
  expect(reports.length).toBe(1);
  scheduler.advance(2_000);   // retry after quietMs
  scheduler.advance(4_000);   // then twice that
  expect(flushes).toEqual([2_000, 4_000, 8_000]);
  expect(reports.length).toBe(1);
  throwing = false;           // a reader holds the log: no error, still not finished
  scheduler.advance(8_000);
  expect(flushes).toEqual([2_000, 4_000, 8_000, 16_000]);
  failing = false;
  scheduler.advance(16_000);  // capped at retryMaxMs
  expect(flushes).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
  expect(durability.pending).toBe(false);
  // After a success the next write is back to the normal schedule, and a new failure is reported again.
  failing = throwing = true;
  durability.wrote();
  scheduler.advance(2_000);
  expect(flushes.at(-1)).toBe(34_000);
  expect(reports.length).toBe(2);
});

test("the end of the file's lifetime (close, quit) flushes at once, and later writes flush as they happen", () => {
  const { scheduler, life, flushes, durability } = simulated();
  durability.wrote();
  scheduler.advance(300);
  life.abort();
  expect(flushes).toEqual([300]);
  expect(scheduler.pending()).toEqual([]);
  durability.wrote();
  expect(flushes).toEqual([300, 300]);
  // Nothing pending: no flush at all.
  const idle = simulated();
  idle.life.abort();
  expect(idle.flushes).toEqual([]);
  expect(idle.durability.flush()).toBe(true);
});

const walState = (path: string) => {
  const db = new Database(path);
  try { return db.query("PRAGMA wal_checkpoint(NOOP)").get() as { log: number; checkpointed: number }; } finally { db.close(); }
};

test("every library store runs WAL with synchronous=NORMAL; a file that can't use WAL keeps FULL", () => {
  const path = library(), life = new AbortController();
  const durability = new LibraryDurability(path, { clock: simClock(new Scheduler()), signal: life.signal });
  const looks = new LookLibrary(path, durability), collections = new CollectionLibrary(path, STUDIO_PARTS, durability);
  const presets = new PartPresetLibrary(path, STUDIO_PARTS, undefined, durability), graph = new SqliteGraphStore(path, { writes: durability });
  const stores = [looks, collections, presets, graph] as unknown as { db: Database }[];
  try {
    for (const store of stores) {
      expect(store.db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(store.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 1 });
    }
  } finally { looks.close(); collections.close(); presets.close(); graph.close(); life.abort(); }
  const memory = new Database(":memory:");
  expect(useWriteAheadLog(memory)).toBe(false);
  expect(memory.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
  memory.close();
});

test("a library in rollback-journal mode moves to WAL when it opens, its rows intact", () => {
  const path = library(), recipe = initialRecipe();
  const first = new LookLibrary(path), saved = first.save({ name: "Before", recipe });
  first.close();
  const raw = new Database(path);
  expect(raw.query("PRAGMA journal_mode=DELETE").get()).toEqual({ journal_mode: "delete" });
  raw.close();
  const reopened = new LookLibrary(path);
  try {
    expect(reopened.get(saved.id).name).toBe("Before");
    const check = new Database(path, { readonly: true });
    expect(check.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(check.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    check.close();
  } finally { reopened.close(); }
});

test("a flush checkpoints every committed frame; a reader holding the log makes it report unfinished until it lets go", () => {
  const path = library(), scheduler = new Scheduler(), life = new AbortController();
  const durability = new LibraryDurability(path, { clock: simClock(scheduler), signal: life.signal });
  const looks = new LookLibrary(path, durability), recipe = initialRecipe();
  try {
    expect(durability.flush()).toBe(true);     // the schema
    looks.save({ name: "One", recipe });
    const before = walState(path);
    expect(before.checkpointed).toBeLessThan(before.log);
    expect(durability.pending).toBe(true);
    scheduler.advance(LIBRARY_FLUSH.quietMs);
    expect(durability.pending).toBe(false);
    const after = walState(path);
    expect(after.checkpointed).toBe(after.log);
    // A read transaction on the old snapshot keeps later frames from being checkpointed.
    const reader = new Database(path);
    reader.exec("BEGIN");
    reader.query("SELECT COUNT(*) FROM looks").get();
    looks.save({ name: "Two", recipe });
    expect(checkpointLibrary(path)).toBe(false);
    scheduler.advance(LIBRARY_FLUSH.quietMs);
    expect(durability.pending).toBe(true);     // tried, not finished: retried later
    reader.exec("COMMIT"); reader.close();
    scheduler.advance(LIBRARY_FLUSH.retryMaxMs);
    expect(durability.pending).toBe(false);
    const done = walState(path);
    expect(done.checkpointed).toBe(done.log);
  } finally { looks.close(); life.abort(); }
});

test("closing the library (the host's stop, on quit) flushes what the last seconds wrote", () => {
  const path = library(), scheduler = new Scheduler(), life = new AbortController();
  const durability = new LibraryDurability(path, { clock: simClock(scheduler), signal: life.signal });
  const looks = new LookLibrary(path, durability), collections = new CollectionLibrary(path, STUDIO_PARTS, durability);
  const presets = new PartPresetLibrary(path, STUDIO_PARTS, undefined, durability), graph = new SqliteGraphStore(path, { writes: durability });
  const holder = new Database(path);   // another connection (a second window, a tool) keeps the log after the stores close
  try {
    durability.flush();
    looks.save({ name: "Last", recipe: initialRecipe() });
    expect(durability.pending).toBe(true);
    const unsynced = walState(path);
    expect(unsynced.checkpointed).toBeLessThan(unsynced.log);
    looks.close(); collections.close(); presets.close(); graph.close();
    life.abort();
    expect(durability.pending).toBe(false);
    const synced = walState(path);
    expect(synced.checkpointed).toBe(synced.log);
  } finally { holder.close(); }
});

test("each store tells the durability of its commits", async () => {
  const path = library(), life = new AbortController();
  let writes = 0;
  const counter = { wrote: () => { writes++; } };
  const looks = new LookLibrary(path, counter), collections = new CollectionLibrary(path, STUDIO_PARTS, counter);
  const presets = new PartPresetLibrary(path, STUDIO_PARTS, undefined, counter), graph = new SqliteGraphStore(path, { writes: counter });
  try {
    let at = writes;
    const look = looks.save({ name: "A look", recipe: initialRecipe() });
    expect(writes).toBe(at + 1);
    at = writes;
    looks.save({ name: "Renamed", recipe: look.recipe, revision: 1 }, look.id);
    expect(writes).toBe(at + 1);
    at = writes;
    expect(() => looks.save({ name: "Stale", recipe: look.recipe, revision: 1 }, look.id)).toThrow();
    expect(writes).toBe(at);   // refused: nothing committed
    const list = collections.list();
    expect(Array.isArray(list)).toBe(true);
    at = writes;
    await graph.putSnapshot({ node: { type: "t", id: "n" }, seq: 1, pos: 1, schema: "1", state: { name: "n", own: {}, layers: [], trashed: false, retracted: false } });
    await graph.dropSnapshots({ type: "t", id: "n" });
    expect(writes).toBe(at + 2);
  } finally { looks.close(); collections.close(); presets.close(); graph.close(); life.abort(); }
});

test("a process killed while it saves leaves a valid database holding every save it acknowledged", async () => {
  const writer = resolve(import.meta.dir, "fixtures", "library-writer.ts");
  for (const [round, killAfter] of [[0, 15], [1, 40], [2, 90]] as const) {
    const path = library();
    const child = Bun.spawn([process.execPath, writer, path], { stdout: "pipe", stderr: "pipe", windowsHide: true });
    const acknowledged: string[] = [];
    const reader = child.stdout.getReader(), decoder = new TextDecoder();
    let text = "";
    try {
      while (acknowledged.length < killAfter) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the writer stopped: ${await new Response(child.stderr).text()}`);
        text += decoder.decode(value, { stream: true });
        const lines = text.split("\n");
        text = lines.pop()!;
        for (const line of lines) if (line.startsWith("look ")) acknowledged.push(line.split(" ")[2]);
      }
    } finally { child.kill("SIGKILL"); }
    await child.exited;
    // The killed writer left its log behind: opening the file recovers from it.
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    const db = new Database(path);
    try {
      expect(db.query("PRAGMA integrity_check").get(), `round ${round}`).toEqual({ integrity_check: "ok" });
      const ids = new Set((db.query("SELECT look_id FROM look_revisions").all() as { look_id: string }[]).map(row => row.look_id));
      for (const id of acknowledged) expect(ids.has(id), `round ${round}: acknowledged ${id}`).toBe(true);
    } finally { db.close(); }
    // The stores open it again and read every look.
    const reopened = new LookLibrary(path);
    try { expect(reopened.list().length).toBeGreaterThanOrEqual(acknowledged.length); } finally { reopened.close(); }
  }
}, 60_000);
