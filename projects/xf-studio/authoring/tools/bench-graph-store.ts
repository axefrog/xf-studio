/**
 * The graph's load budget on the Studio's SQLite store (profiles and graph design §2.8): 10,000 nodes over one million
 * entries, each with a snapshot near its head, load (read and fold) in under 300 ms. Builds a throwaway library in the
 * temp folder, then measures the store's load, the engine's fold, a first read and a commit. Run it under the memory
 * guard: `python tools/memory_guard.py --limit 6 -- bun tools/bench-graph-store.ts [nodes] [entries per node]`.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Aborter, createGraph, pathKey } from "strata";
import { SqliteGraphStore } from "../src/platform/graph-adapters/sqlite-store";
import { hostClock, hostRandom } from "../src/platform/graph-adapters/host-sources";
import { POINTER } from "../src/platform/graph-types";
import { STUDIO_GRAPH_RULES, STUDIO_GRAPH_TYPES } from "../src/compose/graph";

const nodes = Number(process.argv[2] ?? 10_000), perNode = Number(process.argv[3] ?? 100);
const dir = mkdtempSync(join(tmpdir(), "xfs-graph-bench-"));
const path = join(dir, "library.sqlite");
try {
  const built = performance.now();
  new SqliteGraphStore(path).close();
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;");
  const insert = db.query("INSERT INTO events (node, type, seq, commit_id, actor, actor_seq, at, schema, op, extra) VALUES (?, ?, ?, ?, 'bench', ?, ?, '1', ?, NULL) RETURNING pos");
  const index = db.query("INSERT INTO node_index VALUES (?, ?, ?, ?, 0)");
  const snapshot = db.query("INSERT INTO snapshots VALUES (?, ?, ?, ?, '1', ?, 0)");
  let counter = 0;
  db.transaction(() => {
    for (let n = 0; n < nodes; n++) {
      const id = `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
      const at = perNode - 1 - (n % 10);
      let snapshotPos = 0;
      for (let seq = 1; seq <= perNode; seq++) {
        const op = seq === 1 ? { kind: "create", state: { name: `p${n}`, own: {}, layers: [], trashed: false, retracted: false } }
          : { kind: "set", path: ["path"], value: [`s${seq}`] };
        const row = insert.get(id, POINTER, seq, `c${n}-${seq}`, ++counter, seq, JSON.stringify(op)) as { pos: number };
        if (seq === at) snapshotPos = row.pos;
      }
      index.run(id, POINTER, perNode, `p${n}`);
      snapshot.run(id, POINTER, at, snapshotPos, JSON.stringify({ name: `p${n}`, own: { [pathKey(["path"])]: [`s${at}`] }, layers: [], trashed: false, retracted: false }));
    }
  })();
  db.close();
  const buildMs = performance.now() - built;
  const store = new SqliteGraphStore(path);
  const clock = hostClock();
  const life = new Aborter();
  const graph = createGraph({ types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, store, sources: { clock, random: hostRandom() }, signal: life.signal });
  const started = performance.now();
  const loaded = await graph.load();
  const loadMs = performance.now() - started;
  const first = performance.now();
  graph.resolve({ type: POINTER, id: `00000000-0000-4000-8000-${(nodes - 1).toString().padStart(12, "0")}` });
  const firstReadMs = performance.now() - first;
  const commit = performance.now();
  graph.commit([{ op: "set", node: { type: POINTER, id: "00000000-0000-4000-8000-000000000000" }, path: ["path"], value: ["x"] }]);
  const commitMs = performance.now() - commit;
  await graph.flush();
  console.log({ nodes, entries: nodes * perNode, fileMB: +(statSync(path).size / 1e6).toFixed(1), buildMs: Math.round(buildMs),
    loadMs: +loadMs.toFixed(1), foldMs: +loaded.foldMs.toFixed(1), tailEntries: loaded.entries, firstReadMs: +firstReadMs.toFixed(2), commitMs: +commitMs.toFixed(2) });
  life.abort();
  store.close();
} finally { rmSync(dir, { recursive: true, force: true }); }
