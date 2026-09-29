/**
 * The Studio's graph store (profiles and graph design G1): the SQLite adapter and the host transport pass XF Strata's
 * store conformance suite; a graph persists, reloads and purges through it; backups are taken daily, pruned, restorable
 * and purged; and a library with the graph tables still opens in every earlier XF Studio (user_version untouched).
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Aborter, createGraph } from "strata";
import type { GraphStore } from "strata";
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
      return new HostGraphStore("http://127.0.0.1/api/graph/store", (url, init) =>
        handler(new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: "http://127.0.0.1" } })));
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
