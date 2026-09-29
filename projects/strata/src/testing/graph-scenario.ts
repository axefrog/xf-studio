/**
 * The standard simulation scenario for the entity layer: a graph over a simulated store, a second window writing to
 * the same store, store faults (refused writes, lost replies), crash-restart with the recovery copy, background and
 * requested jobs, and every standard invariant after every step (design §5.2).
 */
import { canonical, equal } from "../json";
import { Aborter } from "../kernel/abort";
import { createGraph, STRATA_DEBUG, STRATA_FAULTS } from "../graph";
import type { Faults, Graph, GraphOptions, PendingCommit } from "../graph";
import { MemoryStore } from "../store";
import type { Edit, NodeRef, NodeState } from "../types";
import { checkConflictIndex, checkConsistentCut, checkResolution, checkSnapshots, checkStructure } from "./invariants";
import { Scheduler, settle, simClock, SimJobs } from "./sim-sources";
import { seededRandom } from "../random";
import { SimStore } from "./sim-store";
import type { Scenario, SimAction } from "./simulate";
import { GROUP, ITEM, SYNTHETIC_RULES, SYNTHETIC_TYPES } from "./synthetic";

export type GraphWorld = {
  seed: string; scheduler: Scheduler; memory: MemoryStore; store: SimStore;
  graph: Graph; other: Graph; life: Aborter; otherLife: Aborter;
  recovery: readonly PendingCommit[];
  accepted: Set<string>; rejected: Set<string>;
  jobs: SimJobs;
  /** Per commit this session made: the stored state of every node before it, and the nodes it touched. */
  before: Map<string, Map<string, NodeState | null>>; touched: Map<string, string[]>;
  /** The last commit that changed each node (undo is exact only while it is the one undone). */
  lastWriter: Map<string, string>;
  problems: string[];
  restarts: number;
  faults?: Faults;
};

const MAX_NODES = 24;
const pickFrom = <T>(items: readonly T[], n: number): T | undefined => items.length ? items[n % items.length] : undefined;
/** A graph stopped by a crash fails the store work still asked of it (SPEC §9.4): expected here, and ignored. */
const stopped = (): undefined => undefined;
const stateOf = (graph: Graph, id: string) => graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === id)?.head ?? null;
const visible = (state: NodeState | null) => state && !state.retracted ? canonical([state.own, state.layers, state.name, state.trashed]) : null;

function makeGraph(world: Pick<GraphWorld, "scheduler" | "store">, seed: string, signal: Aborter, faults?: Faults): Graph {
  const options: GraphOptions = { types: SYNTHETIC_TYPES, rules: SYNTHETIC_RULES, store: world.store, signal: signal.signal,
    sources: { clock: simClock(world.scheduler), random: seededRandom(seed) }, snapshotEvery: 5, retryMs: 40, replyTimeoutMs: 400,
    ...(faults ? { [STRATA_FAULTS]: faults } : {}) };
  return createGraph(options);
}

/** Delivers scheduler events until the promise settles (setup, restart). */
async function drive<T>(scheduler: Scheduler, promise: Promise<T>): Promise<T> {
  let done = false;
  let result: T | undefined;
  promise.then(value => { done = true; result = value; });
  for (let i = 0; i < 5000 && !done; i++) { await settle(); if (!done) scheduler.deliver(0); }
  if (!done) throw new Error("setup didn't finish");
  return result as T;
}

function watch(world: GraphWorld): void {
  world.graph.subscribePending(pending => { world.recovery = pending; }, { signal: world.life.signal });
  world.graph.subscribeAll(set => { for (const change of set.nodes) world.lastWriter.set(change.node.id, set.commit); }, { signal: world.life.signal });
}

/** Runs something that may commit on the main window, recording what undo must restore. */
function track(world: GraphWorld, run: () => import("../types").CommitResult): import("../types").CommitResult {
  const graph = world.graph;
  const before = new Map(graph[STRATA_DEBUG]().records.map(rec => [rec.ref.id, rec.head]));
  const seqs = new Map(graph[STRATA_DEBUG]().records.map(rec => [rec.ref.id, rec.headSeq]));
  const result = run();
  if (!result.ok) {
    if (!result.reason) world.problems.push(`refusal: a refusal without a reason code`);
    return result;
  }
  world.accepted.add(result.commit);
  world.before.set(result.commit, before);
  world.touched.set(result.commit, graph[STRATA_DEBUG]().records.filter(rec => rec.headSeq !== (seqs.get(rec.ref.id) ?? 0)).map(rec => rec.ref.id));
  for (const id of world.touched.get(result.commit)!) world.lastWriter.set(id, result.commit);
  return result;
}

function commit(world: GraphWorld, edits: Edit[], options: { action?: string } = {}): void {
  track(world, () => world.graph.commit(edits, options));
}

function checkUndo(world: GraphWorld, scope = "default"): void {
  const graph = world.graph;
  const top = graph.undoStack(scope).at(-1);
  if (!top) return;
  const before = world.before.get(top), touched = world.touched.get(top) ?? [];
  const exact = touched.every(id => world.lastWriter.get(id) === top);
  const seqs = touched.map(id => graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === id)?.headSeq ?? 0);
  const result = track(world, () => graph.undo(scope));
  if (!result.ok) { if (result.reason !== "empty" && result.reason !== "unloaded") world.problems.push(`undo: refused ${result.reason}`); return; }
  touched.forEach((id, i) => {
    const seq = graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === id)?.headSeq ?? 0;
    if (seq < seqs[i]) world.problems.push(`undo: the stream of ${id.slice(0, 8)} shrank`);
    if (exact && before && visible(stateOf(graph, id)) !== visible(before.get(id) ?? null))
      world.problems.push(`undo: ${id.slice(0, 8)} didn't fold back to its state before the commit`);
  });
}

const actions: SimAction<GraphWorld>[] = [
  { name: "create", weight: 3, run(world, [a, b, c]) {
    const graph = world.graph, items = graph.list(ITEM);
    if (graph.list().length >= MAX_NODES) return;
    const source = pickFrom(items, a)!;
    const shape = b % 5;
    commit(world, [shape === 0 ? { op: "create", type: ITEM, from: { fork: source } }
      : shape === 1 ? { op: "create", type: ITEM, from: { clone: source } }
        : shape === 2 ? { op: "create", type: GROUP, fields: { label: "g", members: { m: source } } }
          : { op: "create", type: ITEM, fields: { title: `t${c % 7}`, tags: { [`k${c % 3}`]: c % 5 } } }]);
  } },
  { name: "set", weight: 6, run(world, [a, b, c]) {
    const items = world.graph.list(ITEM).filter(ref => !ref.id.startsWith("builtin:"));
    const node = pickFrom(items, a);
    if (!node) return;
    const other = pickFrom(items, c);
    const paths: Edit[] = [
      { op: "set", node, path: ["title"], value: `v${c % 6}` },
      { op: "set", node, path: ["tags", `k${c % 3}`], value: c % 4 },
      { op: "set", node, path: ["meta", `m${c % 2}`, `k${c % 3}`], value: c % 3 },
      { op: "tombstone", node, path: ["tags", `k${c % 3}`] },
      { op: "reset", node, path: ["tags", `k${c % 3}`] },
      { op: "set", node, path: ["link"], value: other ?? null },
      { op: "rename", node, name: `n${c % 4}` },
    ];
    commit(world, [paths[b % paths.length]]);
  } },
  { name: "layer", weight: 2, run(world, [a, b, c]) {
    const items = world.graph.list(ITEM), live = items.filter(ref => !ref.id.startsWith("builtin:"));
    const node = pickFrom(live, a), source = pickFrom(items, c);
    if (!node || !source) return;
    const ops: Edit[] = [
      { op: "feed", node, from: source, paths: [[["tags"]], [["title"]], [["tags", `k${c % 3}`]], "*"][b % 4] as "*" },
      { op: "rebase", node, base: source },
      { op: "detach", node },
      { op: "applyToSource", node, path: [["title"], ["tags", `k${c % 3}`]][b % 2] },
    ];
    commit(world, [ops[b % ops.length]]);
  } },
  { name: "trash", run(world, [a, b]) {
    const node = pickFrom(world.graph.list().filter(ref => !ref.id.startsWith("builtin:")), a);
    if (node) commit(world, [{ op: b % 2 ? "trash" : "restore", node }]);
  } },
  { name: "tag-or-revert", run(world, [a, b]) {
    const node = pickFrom(world.graph.list(ITEM).filter(ref => !ref.id.startsWith("builtin:")), a);
    if (!node) return;
    const seq = world.graph.seqOf(node);
    commit(world, [b % 2 ? { op: "tag", node, label: "keep" } : { op: "revert", node, to: 1 + b % Math.max(1, seq) }]);
  } },
  { name: "undo", weight: 2, run(world) { checkUndo(world); } },
  { name: "redo", run(world) { track(world, () => world.graph.redo()); } },
  { name: "blocked", run(world, [a]) {
    // Every action a blocking conflict covers is refused with `conflict`.
    const blocking = world.graph.conflicts().filter(conflict => conflict.severity === "blocking");
    const conflict = pickFrom(blocking, a);
    if (!conflict) return;
    const result = world.graph.commit([{ op: "set", node: conflict.subjects[0], path: ["title"], value: "blocked?" }], { action: "item.edit" });
    if (result.ok || result.reason !== "conflict") world.problems.push(`conflicts: an action a blocking conflict covers was not refused`);
  } },
  { name: "fix", run(world, [a, b]) {
    const conflict = pickFrom(world.graph.conflicts(), a);
    const route = conflict && pickFrom(conflict.routes, b);
    if (!conflict || !route) return;
    track(world, () => world.graph.fix(conflict.id, route.id));
  } },
  { name: "other-window", weight: 2, run(world, [a, b]) {
    const node = pickFrom(world.other.list(ITEM).filter(ref => !ref.id.startsWith("builtin:")), a);
    if (node) world.other.commit([{ op: "set", node, path: ["tags", `o${b % 2}`], value: b % 5 }]);
    else world.other.commit([{ op: "create", type: ITEM, fields: { title: "from the other window" } }]);
  } },
  { name: "sync", weight: 2, run(world) { void world.graph.sync().catch(stopped); } },
  { name: "other-sync", run(world) { void world.other.sync().catch(stopped); } },
  { name: "store-fault", run(world, [a]) { if (a % 2) world.store.failNext++; else world.store.loseNext++; } },
  { name: "jobs", run(world, [a]) { void world.jobs.run({ kind: `job${a % 3}`, input: a, priority: a % 3 === 0 ? "user" : "background" }).catch(() => undefined); } },
  { name: "compact", weight: 0.3, run(world, [a]) {
    const node = pickFrom(world.graph.list(ITEM).filter(ref => !ref.id.startsWith("builtin:")), a);
    if (node) void world.graph.compact(node).catch(stopped);
  } },
];

async function start(seed: string, restarts: number, carry?: GraphWorld, faults?: Faults): Promise<GraphWorld> {
  const scheduler = carry?.scheduler ?? new Scheduler();
  const memory = carry?.memory ?? new MemoryStore();
  const store = carry?.store ?? new SimStore(memory, scheduler);
  const life = new Aborter(), otherLife = new Aborter();
  const graph = makeGraph({ scheduler, store }, `${seed}:main:${restarts}`, life, faults);
  const other = makeGraph({ scheduler, store }, `${seed}:other:${restarts}`, otherLife);
  await drive(scheduler, graph.load());
  await drive(scheduler, other.load());
  const world: GraphWorld = {
    seed, scheduler, memory, store, graph, other, life, otherLife, recovery: [], accepted: carry?.accepted ?? new Set(),
    rejected: carry?.rejected ?? new Set(), jobs: carry?.jobs ?? new SimJobs(scheduler, (_kind, input) => input, 1, 15),
    before: new Map(), touched: new Map(), lastWriter: new Map(), problems: [], restarts, faults,
  };
  watch(world);
  return world;
}

/** The entity-layer scenario. `faults` injects a bug (the harness must find it). */
export function graphScenario(faults?: Faults): Scenario<GraphWorld> {
  return {
    name: faults ? "graph-with-fault" : "graph",
    setup: seed => start(seed, 0, undefined, faults),
    actions,
    deliver: (world, pick) => { world.scheduler.deliver(pick); },
    advance: (world, ms) => { world.scheduler.advance(ms); },
    async crash(world) {
      // Everything in memory is lost; in-flight events vanish with the process. The store and the recovery copy stay.
      for (const item of [...world.graph.rejected(), ...world.other.rejected()]) world.rejected.add(item.commit);
      const recovery = world.recovery;
      world.life.abort("crash"); world.otherLife.abort("crash");
      world.scheduler.drop();
      const next = await start(world.seed, world.restarts + 1, world, world.faults);
      next.graph.recover(recovery);
      for (const item of next.graph.rejected()) next.rejected.add(item.commit);
      // After a restart the effective state is the stored one plus the recovered pending work.
      for (const rec of next.graph[STRATA_DEBUG]().records) {
        if (rec.constant) continue;
        const stored = world.memory.readStreamNow(rec.ref);
        if (stored.length && rec.base.seq === 0 && !equal(rec.entries.slice(0, stored.length).map(entry => entry.seq), stored.map(entry => entry.seq)))
          next.problems.push(`lost-work: ${rec.ref.id.slice(0, 8)} reloaded different entries than the store holds`);
      }
      return next;
    },
    async check(world, step) {
      const problems = [...world.problems];
      world.problems.length = 0;
      const graph = world.graph;
      problems.push(...checkResolution(graph, SYNTHETIC_TYPES));
      problems.push(...checkConflictIndex(graph));
      problems.push(...checkStructure(graph, SYNTHETIC_TYPES, world.memory));
      problems.push(...checkSnapshots(world.memory, SYNTHETIC_TYPES));
      // No lost work: every accepted commit is stored, pending (the recovery copy), or rejected (kept for the person).
      const stored = new Set(world.memory.allEntries().map(entry => entry.commit));
      const pending = new Set(graph.pending().map(item => item.commit));
      for (const item of graph.rejected()) world.rejected.add(item.commit);
      for (const commit of world.accepted) {
        if (stored.has(commit) || pending.has(commit) || world.rejected.has(commit)) continue;
        // A commit whose entries were all compacted away is stored in its rollup.
        if (world.memory.compactions.length) continue;
        problems.push(`lost-work: commit ${commit.slice(0, 8)} is neither stored, pending nor rejected`);
      }
      // The person's jobs start before background jobs queued earlier.
      for (const started of world.jobs.starts) if (started.priority === "background" && started.waitingUser > 0)
        problems.push(`preempt: a background job started while one of the person's jobs waited`);
      // A consistent cut, when the main window has everything the store has (no pending work, nothing unsynced).
      if (step % 5 === 0 && !graph.pending().length && graph[STRATA_DEBUG]().records.every(rec => rec.base.seq === 0)) {
        const entries = world.memory.allEntries();
        const known = new Set(graph[STRATA_DEBUG]().records.flatMap(rec => rec.entries.map(entry => entry.commit)));
        if (entries.length && entries.every(entry => known.has(entry.commit))) {
          const pos = entries[(step * 7) % entries.length].pos;
          problems.push(...await checkConsistentCut(graph, SYNTHETIC_TYPES, entries, pos));
        }
      }
      return problems;
    },
  };
}

export type { NodeRef };
