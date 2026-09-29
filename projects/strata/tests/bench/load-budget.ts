/**
 * The engine's budgets (design §2.5, §2.8): a node opens in under 20 ms; 10,000 nodes over one million entries fold
 * from snapshots in under 300 ms; a commit touching one node shared by 20 others takes under 2 ms with 10,000 nodes.
 * `bun run bench` prints the measurements (run it under the memory guard).
 */
import { Aborter, createGraph, MemoryStore, pathKey } from "strata";
import type { Entry, NodeRef, Snapshot } from "strata";
import { seededRandom, simClock, Scheduler, settle, SYNTHETIC_TYPES } from "strata/testing";

export type Budgets = { nodes: number; entries: number; buildMs: number; foldMs: number; loadMs: number; firstReadMs: number; commitMedianMs: number; commitP95Ms: number };

export async function measure(nodes = 10_000, perNode = 100): Promise<Budgets> {
  const built = performance.now();
  const memory = new MemoryStore();
  const random = seededRandom("bench").stream("bench");
  let counter = 0;
  for (let n = 0; n < nodes; n++) {
    const ref: NodeRef = { type: "item", id: `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}` };
    const entries: Entry[] = [];
    for (let seq = 1; seq <= perNode; seq++) entries.push({ node: ref, seq, pos: 0, commit: `c${n}-${seq}`, actor: "bench", actorSeq: ++counter, at: seq, schema: "2",
      op: seq === 1 ? { kind: "create", state: { name: `n${n}`, own: { [pathKey(["title"])]: "t" }, layers: [], trashed: false, retracted: false } }
        : { kind: "set", path: ["tags", `k${seq % 16}`], value: seq } });
    for (const entry of entries) memory.appendNow({ commit: entry.commit, entries: [entry], expect: [[ref.id, entry.seq - 1]] });
    // A snapshot a little before the head (as the close-time snapshot policy leaves it, plus a short tail).
    const at = perNode - 1 - Math.floor(random.next() * 10);
    const own: Record<string, unknown> = { [pathKey(["title"])]: "t" };
    for (let seq = 2; seq <= at; seq++) own[pathKey(["tags", `k${seq % 16}`])] = seq;
    const stored = memory.readStreamNow(ref);
    const snapshot: Snapshot = { node: ref, seq: at, pos: stored[at - 1].pos, schema: "2", state: { name: `n${n}`, own: own as never, layers: [], trashed: false, retracted: false } };
    memory.putSnapshotNow(snapshot);
  }
  const buildMs = performance.now() - built;
  const scheduler = new Scheduler();
  const graph = createGraph({ types: SYNTHETIC_TYPES, sources: { clock: { ...simClock(scheduler), monotonic: () => performance.now() }, random: seededRandom("bench") }, store: memory });
  const started = performance.now();
  const loading = graph.load();
  await settle();
  const loaded = await loading;
  const loadMs = performance.now() - started;
  const first = performance.now();
  graph.resolve({ type: "item", id: `00000000-0000-4000-8000-${(nodes - 1).toString().padStart(12, "0")}` });
  const firstReadMs = performance.now() - first;
  // One node shared by 20 forks, all subscribed.
  const shared: NodeRef = { type: "item", id: "00000000-0000-4000-8000-000000000000" };
  const life = new Aborter();
  for (let i = 0; i < 20; i++) {
    const result = graph.commit([{ op: "create", type: "item", as: "f", from: { fork: shared } }]);
    if (result.ok) graph.subscribe(result.created.f, () => undefined, { signal: life.signal });
  }
  graph.subscribe(shared, () => undefined, { signal: life.signal });
  const times: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    graph.commit([{ op: "set", node: shared, path: ["title"], value: `v${i}` }]);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  life.abort();
  return { nodes, entries: nodes * perNode, buildMs: Math.round(buildMs), foldMs: +loaded.foldMs.toFixed(1), loadMs: +loadMs.toFixed(1),
    firstReadMs: +firstReadMs.toFixed(2), commitMedianMs: +times[100].toFixed(3), commitP95Ms: +times[190].toFixed(3) };
}

if (import.meta.main) console.log(await measure(Number(process.argv[2] ?? 10_000), Number(process.argv[3] ?? 100)));
