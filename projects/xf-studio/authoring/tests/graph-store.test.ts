/**
 * The Studio's graph store (profiles and graph design G1): the SQLite adapter and the host transport pass XF Strata's
 * store conformance suite; a graph persists, reloads and purges through it; backups are taken daily, pruned, restorable
 * and purged; and a library with the graph tables still opens in every earlier XF Studio (user_version untouched).
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Aborter, createGraph } from "strata";
import type { Entry, GraphStore } from "strata";
import { STORE_CASES, Scheduler, seededRandom, settle, simClock } from "strata/testing";
import { SqliteGraphStore } from "../src/platform/graph-adapters/sqlite-store";
import { LibraryBackups } from "../src/platform/graph-adapters/backups";
import { createGraphHandler, GraphLibrary } from "../src/platform/graph-adapters/graph-host";
import { HostGraphStore } from "../src/platform/graph-adapters/browser-graph-store";
import { STUDIO_GRAPH_RULES, STUDIO_GRAPH_TYPES } from "../src/compose/graph";
import { POINTER } from "../src/platform/graph-types";
import { LookLibrary } from "../src/library-store";
import { CollectionLibrary } from "../src/collection-store";
import { PartPresetLibrary } from "../src/part-preset-store";
import { STUDIO_PARTS } from "../src/compose/studio-registry";
import { COLLECTION_FIXTURES, readFixture } from "./fixtures/capture-plan-golden";
import { alphaList } from "./fixtures/alpha-0.1.0/collection-list";
import { readRecipe } from "../src/recipe-schema";

const folders: string[] = [];
function folder(): string { const dir = mkdtempSync(join(tmpdir(), "xfs-graph-")); folders.push(dir); return dir; }
const cleanup = () => { for (const dir of folders.splice(0)) try { rmSync(dir, { recursive: true, force: true }); } catch { /* WAL files may still be closing */ } };
const DAY = 86_400_000, START = Date.UTC(2026, 8, 1, 9);

for (const item of STORE_CASES) test(`SQLite graph store: ${item.name}`, async () => {
  const stores: SqliteGraphStore[] = [];
  try { await item.run(async () => { const store = new SqliteGraphStore(join(folder(), "library.sqlite")); stores.push(store); return store; }); }
  finally { for (const store of stores) store.close(); cleanup(); }
});

for (const item of STORE_CASES) test(`host transport: ${item.name}`, async () => {
  const libraries: GraphLibrary[] = [];
  try {
    await item.run(async (): Promise<GraphStore> => {
      const library = new GraphLibrary(join(folder(), "library.sqlite"), { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES,
        clock: simClock(new Scheduler()), random: seededRandom("host") });
      libraries.push(library);
      const handler = createGraphHandler(library, "/api/graph");
      const page = new HostGraphStore("http://127.0.0.1/api/graph/store", (url, init) =>
        handler(new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: "http://127.0.0.1" } })));
      // Compaction and purge run only on the host, confirmed (CORE-127); everything else goes through the transport.
      const host = library.confirmedStore(async () => true);
      return { list: () => page.list(), load: () => page.load(), readStream: (...args) => page.readStream(...args),
        append: request => page.append(request), changesSince: pos => page.changesSince(pos), counter: () => page.counter(),
        putSnapshot: snapshot => page.putSnapshot(snapshot), dropSnapshots: node => page.dropSnapshots(node),
        compact: (node, entries, at) => host.compact(node, entries, at), purge: node => host.purge(node) };
    });
  } finally { for (const library of libraries) library.close(); cleanup(); }
});

test("a graph persists through the SQLite store, reloads from snapshots and tails, and a purge leaves no row of the node", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const scheduler = new Scheduler();
  try {
    const store = new SqliteGraphStore(path);
    const life = new Aborter();
    const graph = createGraph({ types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, store, snapshotEvery: 3,
      sources: { clock: simClock(scheduler), random: seededRandom("persist") }, signal: life.signal });
    await graph.load();
    const made = graph.commit([{ op: "create", type: POINTER, as: "focus", name: "Focus" }, { op: "create", type: POINTER, as: "view", name: "View" }]);
    if (!made.ok) throw new Error(made.message);
    const { focus, view } = made.created;
    for (let i = 0; i < 5; i++) graph.commit([{ op: "set", node: view, path: ["path"], value: ["scene", `v${i}`] }]);
    graph.commit([{ op: "set", node: focus, path: ["target"], value: view }]);
    for (let i = 0; i < 20 && graph.pending().length; i++) await settle();
    expect(graph.pending()).toEqual([]);
    await graph.snapshotAll();
    const again = createGraph({ types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, store, sources: { clock: simClock(scheduler), random: seededRandom("again") } });
    await again.load();
    expect(again.resolve(view)).toEqual(graph.resolve(view));
    expect(again.resolve(focus, ["target"])).toEqual(view);
    // The referring pointer raises R2 once its target is purged (a `follows` reference only: `target` shares).
    expect((await again.purge(view)).ok).toBe(true);
    const db = new Database(path, { readonly: true });
    try {
      for (const table of ["events", "snapshots", "node_index", "compactions"]) expect((db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE node = ?`).get(view.id) as { n: number }).n).toBe(0);
    } finally { db.close(); }
    life.abort();
    store.close();
  } finally { cleanup(); }
});

test("daily backups: one a day, seven daily and four weekly kept, purged nodes removed from them, and restore keeps the current file", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  let now = START;
  try {
    const store = new SqliteGraphStore(path);
    await store.append({ commit: "c1", expect: [["n1", 0]], entries: [{ node: { type: POINTER, id: "n1" }, seq: 1, pos: 0, commit: "c1", actor: "local",
      actorSeq: 1, at: 1, schema: "1", op: { kind: "create", state: { name: "Kept", own: {}, layers: [], trashed: false, retracted: false } } }] });
    const backups = new LibraryBackups(path, () => now);
    expect(backups.daily()).toBeDefined();
    expect(backups.daily()).toBeUndefined();   // once a day
    for (let day = 1; day < 40; day++) { now = START + day * DAY; backups.daily(); }
    const daily = backups.list().filter(item => item.kind === "daily");
    expect(daily.length).toBe(11);   // seven daily, four weekly
    expect(daily[0].nodes).toBe(1);
    // Purging a node reaches every backup (decision Q7).
    backups.purge("n1");
    expect(backups.list().every(item => item.nodes === 0)).toBe(true);
    // Restore: the current library is kept first.
    store.close();
    const kept = backups.restore(daily[3].file);
    expect(existsSync(kept)).toBe(true);
    expect(readdirSync(join(dir, "backups")).some(name => name.includes("pre-restore"))).toBe(true);
  } finally { cleanup(); }
}, 30_000);   // Several backup and purge rounds on disk: about 5 s on CI's Windows runner, over bun's 5 s default.

/** G1's `events` table, as libraries made before the positions migration have it (CORE-128). */
const G1_EVENTS = `CREATE TABLE events (pos INTEGER PRIMARY KEY, node TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    commit_id TEXT NOT NULL, actor TEXT NOT NULL, actor_seq INTEGER NOT NULL, at INTEGER NOT NULL, schema TEXT NOT NULL,
    op TEXT NOT NULL, extra TEXT, UNIQUE (node, seq)); CREATE INDEX events_commit ON events (commit_id);`;

test("a G1 library migrates to never-reissued positions in place, keeping every entry, after a pre-migration backup", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  try {
    new LookLibrary(path).close();
    const g1 = new Database(path);
    g1.exec(`PRAGMA journal_mode=WAL; ${G1_EVENTS}`);
    g1.close();
    // The G1 store's rows: two nodes, A's entries the newest.
    const legacy = new Database(path);
    const insert = legacy.query("INSERT INTO events (node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra) VALUES (?, 'pointer', ?, ?, 'local', ?, 1, '1', ?, NULL)");
    const create = JSON.stringify({ kind: "create", state: { name: "n", own: {}, layers: [], trashed: false, retracted: false } });
    insert.run("b", 1, "c1", 1, create); insert.run("a", 1, "c2", 2, create); insert.run("a", 2, "c2", 3, JSON.stringify({ kind: "rename", name: "m" }));
    legacy.exec(`CREATE TABLE node_index (node TEXT PRIMARY KEY, type TEXT NOT NULL, head_seq INTEGER NOT NULL, name TEXT NOT NULL, trashed INTEGER NOT NULL);
      INSERT INTO node_index VALUES ('b', 'pointer', 1, 'n', 0), ('a', 'pointer', 2, 'm', 0);`);
    const before = legacy.query("SELECT * FROM events ORDER BY pos").all();
    const version = (legacy.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    legacy.close();
    const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: simClock(new Scheduler()), random: seededRandom("m") });
    try {
      expect(library.store.migrationError).toBeUndefined();
      expect(library.backups.list().map(item => item.kind)).toEqual(["pre-migration"]);
      expect(library.backups.list()[0].entries).toBe(3);
      const db = new Database(path, { readonly: true });
      try {
        expect((db.query("SELECT sql FROM sqlite_master WHERE name = 'events'").get() as { sql: string }).sql).toContain("AUTOINCREMENT");
        expect(db.query("SELECT * FROM events ORDER BY pos").all()).toEqual(before);
        expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(version);
      } finally { db.close(); }
      // The purge-then-append case that reissued a position before.
      await library.store.purge({ type: POINTER, id: "a" });
      const result = await library.store.append({ commit: "c3", expect: [["b", 1]], entries: [{ node: { type: POINTER, id: "b" }, seq: 2, pos: 0, commit: "c3",
        actor: "local", actorSeq: 4, at: 2, schema: "1", op: { kind: "rename", name: "o" } }] });
      expect(result.ok && result.positions).toEqual([4]);
      expect((await library.store.changesSince(3)).entries.map(entry => entry.commit)).toEqual(["c3"]);
    } finally { library.close(); }
    // Opening again doesn't migrate (or back up) twice.
    const again = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: simClock(new Scheduler()), random: seededRandom("m") });
    expect(again.backups.list().length).toBe(1);
    again.close();
  } finally { cleanup(); }
});

test("a purge whose backups are locked stays pending and finishes later; the purge itself succeeds", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  let now = START;
  const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: { ...simClock(new Scheduler()), now: () => now }, random: seededRandom("p") });
  try {
    const node = { type: POINTER, id: "n1" };
    await library.store.append({ commit: "c1", expect: [["n1", 0]], entries: [{ node, seq: 1, pos: 0, commit: "c1", actor: "local",
      actorSeq: 1, at: 1, schema: "1", op: { kind: "create", state: { name: "Kept", own: {}, layers: [], trashed: false, retracted: false } } }] });
    library.dailyBackup();
    now += DAY;
    library.dailyBackup();
    const copies = library.backups.list();
    expect(copies.length).toBe(2);
    // Hold a write lock on one copy: purging it fails for now.
    const lock = new Database(copies[0].file);
    lock.exec("BEGIN EXCLUSIVE");
    try {
      await library.store.purge(node);
      expect(library.store.pendingPurges()).toEqual(["n1"]);
      expect((await library.store.readStream(node)).length).toBe(0);
      expect(library.backups.list().find(item => item.file === copies[1].file)!.nodes).toBe(0);
    } finally { lock.exec("ROLLBACK"); lock.close(); }
    expect(library.store.retryPurges()).toEqual([]);
    expect(library.backups.list().every(item => item.nodes === 0)).toBe(true);
  } finally { library.close(); cleanup(); }
}, 30_000);   // Several backup and purge rounds on disk: about 5 s on CI's Windows runner, over bun's 5 s default.

test("restore is refused while another connection has the library open", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  try {
    const store = new SqliteGraphStore(path);
    const backups = new LibraryBackups(path, () => START);
    const copy = backups.daily()!;
    expect(() => backups.restore(copy)).toThrow("other windows");
    store.close();
    expect(existsSync(backups.restore(copy))).toBe(true);
  } finally { cleanup(); }
});

test("a running host keeps taking a daily backup, checking every hour", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const scheduler = new Scheduler();
  const clock = simClock(scheduler);
  const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock, random: seededRandom("d") });
  try {
    const started = clock.now();
    library.dailyBackup();
    expect(library.backups.list().length).toBe(1);
    for (let hour = 0; hour < 50; hour++) scheduler.advance(60 * 60 * 1000);
    const days = new Set(Array.from({ length: 51 }, (_, hour) => new Date(started + hour * 3_600_000).toISOString().slice(0, 10)));
    expect(library.backups.list().filter(item => item.kind === "daily").length).toBe(days.size);
  } finally { library.close(); cleanup(); }
});

test("the inspector's read graph never writes to the library, catches up without reloading, and answers a page opened at localhost", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: simClock(new Scheduler()), random: seededRandom("i") });
  try {
    const node = { type: POINTER, id: "00000000-0000-4000-8000-000000000001" };
    const entry = (seq: number): Entry => ({ node, seq, pos: 0, commit: `c${seq}`, actor: "local", actorSeq: seq, at: seq, schema: "1",
      op: seq === 1 ? { kind: "create", state: { name: "p", own: {}, layers: [], trashed: false, retracted: false } } : { kind: "rename", name: `p${seq}` } });
    for (let seq = 1; seq <= 210; seq++) await library.store.append({ commit: `c${seq}`, entries: [entry(seq)], expect: [[node.id, seq - 1]] });
    const handler = createGraphHandler(library, "/api/graph");
    const page = await (await handler(new Request("http://localhost:4317/api/graph/inspect?q=", { headers: { Origin: "http://localhost:4317" } }))).json() as { rows: { name: string }[] };
    expect(page.rows.map(row => row.name)).toEqual(["p210"]);
    const first = await library.graph();
    await library.store.append({ commit: "c211", entries: [entry(211)], expect: [[node.id, 210]] });
    expect(await library.graph()).toBe(first);
    expect(first.read(node)?.name).toBe("p211");
    const db = new Database(path, { readonly: true });
    try { expect((db.query("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }).n).toBe(0); } finally { db.close(); }
  } finally { library.close(); cleanup(); }
});

test("a library with the graph tables still opens in earlier XF Studio stores, user_version stays 2, and collections list as before", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  try {
    new LookLibrary(path).close();
    const collections = new CollectionLibrary(path, STUDIO_PARTS);
    for (const fixture of COLLECTION_FIXTURES) collections.save({ collection: STUDIO_PARTS.readCollection(readFixture(fixture)) });
    const before = collections.list();
    collections.close();
    const graphStore = new SqliteGraphStore(path);
    const graph = createGraph({ types: STUDIO_GRAPH_TYPES, store: graphStore, sources: { clock: simClock(new Scheduler()), random: seededRandom("compat") } });
    await graph.load();
    graph.commit([{ op: "create", type: POINTER, name: "p" }]);
    for (let i = 0; i < 20 && graph.pending().length; i++) await settle();
    graphStore.close();
    const db = new Database(path, { readonly: true });
    try {
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(2);
      // 0.1.0-alpha.1's own list query and reader, vendored from its tag, read the same collections.
      expect(alphaList(db, value => readRecipe(value)).map(item => [item.id, item.revision, item.count])).toEqual(before.map(item => [item.id, item.revision, item.count]));
    } finally { db.close(); }
    new LookLibrary(path).close();
    const reopened = new CollectionLibrary(path, STUDIO_PARTS);
    expect(reopened.list()).toEqual(before);
    reopened.close();
    new PartPresetLibrary(path, STUDIO_PARTS).close();
  } finally { cleanup(); }
});

test("the inspector feed pages rows through the host endpoint, and refuses other origins", async () => {
  const dir = folder();
  const library = new GraphLibrary(join(dir, "library.sqlite"), { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES,
    clock: simClock(new Scheduler()), random: seededRandom("feed") });
  try {
    const graph = createGraph({ types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, store: library.store, sources: { clock: simClock(new Scheduler()), random: seededRandom("w") } });
    await graph.load();
    const made = graph.commit([{ op: "create", type: POINTER, as: "a", name: "focus.view" }, { op: "create", type: POINTER, as: "b", name: "focus.v", fields: { from: { created: "a" }, path: ["scene"] } }]);
    if (!made.ok) throw new Error(made.message);
    for (let i = 0; i < 20 && graph.pending().length; i++) await settle();
    const handler = createGraphHandler(library, "/api/graph");
    const page = await (await handler(new Request("http://127.0.0.1/api/graph/inspect?q=type:pointer%20uses>0"))).json() as { rows: { name: string }[]; total: number };
    expect(page.rows.map(row => row.name)).toEqual(["focus.v"]);
    const detail = await (await handler(new Request(`http://127.0.0.1/api/graph/node?id=${made.created.a.id}`))).json() as { usedBy: unknown[] };
    expect(detail.usedBy.length).toBe(1);
    expect((await handler(new Request("http://127.0.0.1/api/graph/inspect", { headers: { Origin: "https://example.com" } }))).status).toBe(403);
    expect((await handler(new Request("http://127.0.0.1/api/graph/store", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "purge", args: [made.created.a] }) }))).status).toBe(403);
  } finally { library.close(); cleanup(); }
});

test("the page can't compact or purge (CORE-127): the transport refuses both, the page's store never asks, and the host runs them only once confirmed, after a backup", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: simClock(new Scheduler()), random: seededRandom("confirm") });
  try {
    const node = { type: POINTER, id: "n1" };
    const entry = (seq: number, commit: string): Entry => ({ node, seq, pos: 0, commit, actor: "local", actorSeq: seq, at: seq, schema: "1",
      op: seq === 1 ? { kind: "create", state: { name: "Kept", own: {}, layers: [], trashed: false, retracted: false } } : { kind: "rename", name: `R${seq}` } }) as Entry;
    await library.store.append({ commit: "c1", expect: [["n1", 0]], entries: [entry(1, "c1")] });
    await library.store.append({ commit: "c2", expect: [["n1", 1]], entries: [entry(2, "c2")] });
    const handler = createGraphHandler(library, "/api/graph");
    const post = (op: string, args: unknown[]) => handler(new Request("http://127.0.0.1/api/graph/store", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" }, body: JSON.stringify({ op, args }) }));
    // A same-origin page request, well formed in every other way, is refused for both.
    const purged = await post("purge", [node]);
    expect(purged.status).toBe(403);
    expect((await post("compact", [node, [entry(1, "c1")], 5])).status).toBe(403);
    expect((await library.store.readStream(node)).length).toBe(2);
    expect((await library.store.list()).map(row => row.ref.id)).toEqual(["n1"]);
    // The page's store refuses without sending anything.
    let sent = 0;
    const page = new HostGraphStore("http://127.0.0.1/api/graph/store", async (url, init) => { sent++; return handler(new Request(url, init)); });
    await expect(page.purge(node)).rejects.toThrow(/confirm/);
    await expect(page.compact(node, [entry(1, "c1")], 5)).rejects.toThrow(/confirm/);
    expect(sent).toBe(0);
    // The host's store: a no leaves everything as it was, and no backup is taken for it.
    const asked: string[] = [];
    const declined = library.confirmedStore(async request => { asked.push(`${request.op}:${request.node.id}`); return false; });
    await expect(declined.purge(node)).rejects.toThrow(/confirmation/);
    await expect(declined.compact(node, [entry(1, "c1")], 5)).rejects.toThrow(/confirmation/);
    expect(asked).toEqual(["purge:n1", "compact:n1"]);
    expect((await library.store.readStream(node)).length).toBe(2);
    expect(library.backups.list()).toEqual([]);
    // A yes: today's backup is taken first, then it runs.
    const confirmed = library.confirmedStore(async () => true);
    await confirmed.compact(node, [entry(1, "c1")], 5);
    expect(library.backups.list().map(item => item.kind)).toEqual(["daily"]);
    expect((await library.store.readStream(node)).length).toBe(2);   // entry 2 was after the compacted range
    await confirmed.purge(node);
    expect(await library.store.list()).toEqual([]);
  } finally { library.close(); cleanup(); }
});

test("the host sources: a clock whose timers end with their signal, and unique random IDs per session", async () => {
  const { hostClock, hostRandom } = await import("../src/platform/graph-adapters/host-sources");
  const clock = hostClock();
  let ran = 0;
  const stop = new Aborter();
  clock.after(1, () => ran++);
  clock.after(1, () => ran += 10, stop.signal);
  stop.abort();
  await new Promise(resolve => clock.after(20, () => resolve(null)));
  expect(ran).toBe(1);
  const ids = new Set([hostRandom(), hostRandom()].flatMap(random => Array.from({ length: 50 }, () => random.stream("ids").uuid())));
  expect(ids.size).toBe(100);
  expect([...ids].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
});

test("a library whose positions migration failed still works: it reads, loads and appends as G1 did (CORE-143)", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  try {
    new LookLibrary(path).close();
    const g1 = new Database(path);
    g1.exec(`PRAGMA journal_mode=WAL; ${G1_EVENTS}`);
    g1.close();
    const store = new SqliteGraphStore(path, { beforeMigration: () => { throw new Error("no backup could be taken"); } });
    try {
      expect(store.migrationError).toBe("no backup could be taken");
      expect(await store.changesSince(0)).toEqual({ head: 0, entries: [] });
      expect((await store.load()).head).toBe(0);
      const result = await store.append({ commit: "c1", expect: [["n1", 0]], entries: [{ node: { type: POINTER, id: "n1" }, seq: 1, pos: 0, commit: "c1",
        actor: "local", actorSeq: 1, at: 1, schema: "1", op: { kind: "create", state: { name: "n", own: {}, layers: [], trashed: false, retracted: false } } }] });
      expect(result.ok && result.positions).toEqual([1]);
      expect((await store.changesSince(0)).head).toBe(1);
      expect((await store.load()).head).toBe(1);
    } finally { store.close(); }
  } finally { cleanup(); }
});

test("one pre-migration copy per migration: a second open the same day keeps the first, a later day's replaces it (CORE-144)", () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  let now = START;
  try {
    new LookLibrary(path).close();
    const backups = new LibraryBackups(path, () => now);
    const first = backups.beforeMigration("graph-positions");
    const taken = statSync(first).mtimeMs;
    // Another window opening while the first migrates (or an open whose migration failed after its copy): the copy is kept as it is.
    expect(backups.beforeMigration("graph-positions")).toBe(first);
    expect(statSync(first).mtimeMs).toBe(taken);
    // A migration of another kind takes its own.
    backups.beforeMigration("other-migration");
    now += DAY;
    const later = backups.beforeMigration("graph-positions");
    expect(later).not.toBe(first);
    expect(backups.list().filter(item => item.kind === "pre-migration").map(item => basename(item.file)).sort())
      .toEqual([basename(later), "library.pre-migration.2026-09-01.other-migration.sqlite"].sort());
    expect(readdirSync(join(dir, "backups")).some(name => name.endsWith(".tmp"))).toBe(false);
  } finally { cleanup(); }
});

test("a backup SQLite can never read is removed by a purge instead of keeping it pending forever (CORE-145)", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: { ...simClock(new Scheduler()), now: () => START }, random: seededRandom("u") });
  try {
    const node = { type: POINTER, id: "n1" };
    await library.store.append({ commit: "c1", expect: [["n1", 0]], entries: [{ node, seq: 1, pos: 0, commit: "c1", actor: "local",
      actorSeq: 1, at: 1, schema: "1", op: { kind: "create", state: { name: "Kept", own: {}, layers: [], trashed: false, retracted: false } } }] });
    library.dailyBackup();
    const damaged = join(dir, "backups", "library.daily.2026-08-01.sqlite");
    writeFileSync(damaged, "this is not a database at all, and it never will be ....................................................................");
    await library.store.purge(node);
    expect(library.store.pendingPurges()).toEqual([]);
    expect(existsSync(damaged)).toBe(false);
    expect(library.backups.list().every(item => item.nodes === 0)).toBe(true);
  } finally { library.close(); cleanup(); }
});

test("a restore is made beside the library and renamed over it, refused if another window opened it meanwhile (CORE-145)", async () => {
  const dir = folder(), path = join(dir, "library.sqlite");
  try {
    // A purge left pending by a locked copy, so the restore applies it to the copy it restores.
    const library = new GraphLibrary(path, { types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, clock: { ...simClock(new Scheduler()), now: () => START }, random: seededRandom("r") });
    const node = { type: POINTER, id: "n1" };
    await library.store.append({ commit: "c1", expect: [["n1", 0]], entries: [{ node, seq: 1, pos: 0, commit: "c1", actor: "local",
      actorSeq: 1, at: 1, schema: "1", op: { kind: "create", state: { name: "Kept", own: {}, layers: [], trashed: false, retracted: false } } }] });
    const copy = library.backups.daily()!;
    const lock = new Database(copy);
    lock.exec("BEGIN EXCLUSIVE");
    await library.store.purge(node);
    lock.exec("ROLLBACK"); lock.close();
    library.close();
    const backups = new LibraryBackups(path, () => START);
    // A window opens the library while the restore prepares its copy (after the restore's first check).
    let window: Database | null = null;
    const original = Database.prototype.close;
    Database.prototype.close = function (this: Database, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      if (!window && (this as unknown as { filename: string }).filename.endsWith(".restoring")) { window = new Database(path); window.exec("PRAGMA journal_mode=WAL; SELECT 1;"); }
      return result;
    };
    try { expect(() => backups.restore(copy)).toThrow("other windows"); }
    finally { Database.prototype.close = original; (window as Database | null)?.close(); }
    // The window's library was left as it was; nothing staged is left behind; with the window closed the restore goes ahead.
    expect(readdirSync(dir).filter(name => name.includes("restoring"))).toEqual([]);
    expect(existsSync(backups.restore(copy))).toBe(true);
    const restored = new Database(path, { readonly: true });
    try { expect((restored.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(0); } finally { restored.close(); }
  } finally { cleanup(); }
});
