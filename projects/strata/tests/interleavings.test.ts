/**
 * The store driver's interleavings, cell by cell. Each row leaves one piece of store work outstanding; each column
 * then does one thing while it is; the scheduler then delivers everything left (in order, and in three seeded random
 * orders), and every cell must end in the same kind of state: no work lost, nothing pending, the store well formed
 * (streams gap-free unless compacted, snapshots equal to folds), the graph resolving exactly what a fresh graph loaded
 * from the store resolves, every host promise settled, and no store process, result effect or listener left behind.
 *
 * | Outstanding \ then          | commit A | commit V | other window commits A | sync | compact A | purge V | snapshot all | undo | crash, restart, recover | graph stops |
 * |-----------------------------|----------|----------|------------------------|------|-----------|---------|--------------|------|-------------------------|-------------|
 * | append in flight            | ✓        | ✓        | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | append reply lost (timeout) | ✓        | ✓        | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | append failed, retry timer  | ✓        | ✓        | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | snapshot write in flight    | ✓        | ✓        | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | compaction of A in flight   | ✓        | ✓        | ✓                      | ✓    | ✓ (busy)  | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | purge of V in flight        | ✓        | ✓ (V)    | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 * | sync in flight              | ✓        | ✓        | ✓                      | ✓    | ✓         | ✓       | ✓            | ✓    | ✓                       | ✓           |
 *
 * A is a node with history, V a node nothing layers from (the purge victim), B a third node another window writes.
 * Cells with a rule of their own (the busy compaction, a commit to a node being purged, a purge racing a snapshot)
 * check it as well.
 */
import { expect, test } from "bun:test";
import { Aborter, createGraph, MemoryStore } from "strata";
import type { CommitResult, Edit, Graph, NodeRef, PendingCommit } from "strata";
import { checkResolution, checkSnapshots, checkStructure, prng, Scheduler, seededRandom, settle, simClock, SimStore, STRATA_DEBUG } from "strata/testing";
import { ITEM, SYNTHETIC_RULES, SYNTHETIC_TYPES } from "../src/testing/synthetic";

type Tracked = { promise: Promise<unknown>; settled: boolean; label: string };
type Ctx = {
  scheduler: Scheduler; memory: MemoryStore; store: SimStore; order: () => number;
  graph: Graph; other: Graph; life: Aborter; otherLife: Aborter; recovery: readonly PendingCommit[]; otherRecovery: readonly PendingCommit[];
  a: NodeRef; b: NodeRef; v: NodeRef;
  accepted: Map<string, string[]>; rejected: Set<string>;
  /** Nodes a purge was asked for (it may or may not have reached the store), and those whose purge reported success. */
  purged: Set<string>; purgedOk: Set<string>;
  tracked: Tracked[]; stopped: boolean; restarts: number; baseline: number; notes: string[];
};

function makeGraph(ctx: Pick<Ctx, "scheduler" | "store">, name: string, life: Aborter): Graph {
  return createGraph({ types: SYNTHETIC_TYPES, rules: SYNTHETIC_RULES, store: ctx.store, signal: life.signal,
    sources: { clock: simClock(ctx.scheduler), random: seededRandom(name) }, snapshotEvery: 3, retryMs: 40, replyTimeoutMs: 200 });
}

/** Delivers one pending event (chosen by the cell's order) and lets promise reactions run. */
async function deliver(ctx: Ctx): Promise<boolean> {
  const pending = ctx.scheduler.pending();
  if (!pending.length) { await settle(); return false; }
  ctx.scheduler.deliver(ctx.order());
  await settle();
  return true;
}
async function quiesce(ctx: Ctx): Promise<void> {
  for (let i = 0; i < 4000; i++) if (!await deliver(ctx) && !ctx.scheduler.pending().length) { await settle(); if (!ctx.scheduler.pending().length) return; }
  throw new Error("the store work never finished");
}
/** Delivers in order until an event with this label is pending (the store call is then in flight). */
async function until(ctx: Ctx, label: RegExp): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (ctx.scheduler.pending().some(event => label.test(event.label))) return;
    ctx.scheduler.deliver(0);
    await settle();
  }
  throw new Error(`nothing labelled ${label} became pending`);
}
function track(ctx: Ctx, label: string, promise: Promise<unknown>): void {
  const item: Tracked = { promise, settled: false, label };
  promise.then(() => { item.settled = true; }, () => { item.settled = true; });
  ctx.tracked.push(item);
}
function commit(ctx: Ctx, graph: Graph, edits: Edit[]): CommitResult {
  const before = new Map(graph[STRATA_DEBUG]().records.map(rec => [rec.ref.id, rec.headSeq]));
  const result = graph.commit(edits);
  if (result.ok) ctx.accepted.set(result.commit, graph[STRATA_DEBUG]().records.filter(rec => rec.headSeq !== before.get(rec.ref.id)).map(rec => rec.ref.id));
  return result;
}
const set = (node: NodeRef, value: string): Edit => ({ op: "set", node, path: ["title"], value });

async function drive<T>(ctx: Ctx, promise: Promise<T>): Promise<T> {
  let done = false, value: T | undefined;
  promise.then(result => { done = true; value = result; });
  for (let i = 0; i < 2000 && !done; i++) { await settle(); if (!done) ctx.scheduler.deliver(0); }
  if (!done) throw new Error("setup didn't finish");
  return value as T;
}

async function open(ctx: Ctx): Promise<void> {
  ctx.life = new Aborter(); ctx.otherLife = new Aborter();
  ctx.graph = makeGraph(ctx, `main:${ctx.restarts}`, ctx.life);
  ctx.other = makeGraph(ctx, `other:${ctx.restarts}`, ctx.otherLife);
  await drive(ctx, ctx.graph.load());
  await drive(ctx, ctx.other.load());
  ctx.graph.subscribePending(pending => { ctx.recovery = pending; }, { signal: ctx.life.signal });
  ctx.other.subscribePending(pending => { ctx.otherRecovery = pending; }, { signal: ctx.otherLife.signal });
}

async function setup(seed: string): Promise<Ctx> {
  const scheduler = new Scheduler(), memory = new MemoryStore();
  const store = new SimStore(memory, scheduler);
  const next = prng(seed);
  const ctx = { scheduler, memory, store, order: seed === "in-order" ? () => 0 : () => Math.floor(next() * 1000), recovery: [], otherRecovery: [],
    accepted: new Map(), rejected: new Set(), purged: new Set(), purgedOk: new Set(), tracked: [], stopped: false, restarts: 0, baseline: 0, notes: [] } as unknown as Ctx;
  await open(ctx);
  const created = (label: string) => { const result = commit(ctx, ctx.graph, [{ op: "create", type: ITEM, as: "n", fields: { title: label } }]); if (!result.ok) throw new Error(result.reason); return result.created.n; };
  ctx.a = created("a"); ctx.b = created("b"); ctx.v = created("v");
  for (let i = 0; i < 4; i++) commit(ctx, ctx.graph, [set(ctx.a, `a${i}`)]);
  await drive(ctx, ctx.graph.flush());
  await drive(ctx, ctx.other.sync());
  ctx.baseline = ctx.graph.env.allNodes().length;
  return ctx;
}

const OUTSTANDING: Record<string, (ctx: Ctx) => Promise<void>> = {
  "an append in flight": async ctx => { commit(ctx, ctx.graph, [set(ctx.a, "in flight")]); await until(ctx, /^append/); },
  "an append whose reply was lost": async ctx => {
    ctx.store.loseNext = 1;
    commit(ctx, ctx.graph, [set(ctx.a, "lost reply")]);
    await until(ctx, /^append/);
    ctx.scheduler.deliver(0);
    await settle();
  },
  "an append that failed, waiting to retry": async ctx => {
    ctx.store.failNext = 1;
    commit(ctx, ctx.graph, [set(ctx.a, "retry")]);
    await until(ctx, /^append/);
    ctx.scheduler.deliver(0);
    await settle();
  },
  "a snapshot write in flight": async ctx => {
    commit(ctx, ctx.graph, [set(ctx.b, "snap")]);
    track(ctx, "snapshot all (outstanding)", ctx.graph.snapshotAll());
    await until(ctx, /^snapshot/);
  },
  "a compaction of A in flight": async ctx => { track(ctx, "compact A (outstanding)", ctx.graph.compact(ctx.a)); await until(ctx, /^compact/); },
  "a purge of V in flight": async ctx => {
    ctx.purged.add(ctx.v.id);
    track(ctx, "purge V (outstanding)", ctx.graph.purge(ctx.v).then(result => { if (result.ok) ctx.purgedOk.add(ctx.v.id); return result; }));
    await until(ctx, /^purge/);
  },
  "a sync in flight": async ctx => {
    commit(ctx, ctx.other, [set(ctx.b, "from the other window")]);
    track(ctx, "sync (outstanding)", ctx.graph.sync());
    await until(ctx, /^changes/);
  },
};

async function crash(ctx: Ctx): Promise<void> {
  for (const item of [...ctx.graph.rejected(), ...ctx.other.rejected()]) ctx.rejected.add(item.commit);
  const recovery = ctx.recovery, otherRecovery = ctx.otherRecovery;
  ctx.life.abort("crash"); ctx.otherLife.abort("crash");
  ctx.scheduler.drop();
  await settle();
  ctx.restarts++;
  await open(ctx);
  ctx.graph.recover(recovery);
  ctx.other.recover(otherRecovery);
  ctx.baseline = -1;
}

const EVENTS: Record<string, (ctx: Ctx) => Promise<void> | void> = {
  "a commit to A": ctx => { commit(ctx, ctx.graph, [set(ctx.a, "then A")]); },
  "a commit to V": ctx => {
    const result = commit(ctx, ctx.graph, [set(ctx.v, "then V")]);
    if (result.ok && ctx.purged.has(ctx.v.id)) ctx.notes.push("committed to V while it was being purged");
  },
  "another window commits A": ctx => { commit(ctx, ctx.other, [set(ctx.a, "the other window's A")]); },
  "a sync": ctx => { track(ctx, "sync", ctx.graph.sync()); },
  "a compaction of A": ctx => {
    track(ctx, "compact A", ctx.graph.compact(ctx.a).then(result => {
      // Only one compaction of a node at a time.
      if (!result.ok && result.reason !== "busy") throw new Error(`compaction refused: ${result.reason}`);
      return result;
    }));
  },
  "a purge of V": ctx => {
    ctx.purged.add(ctx.v.id);
    track(ctx, "purge V", ctx.graph.purge(ctx.v).then(result => { if (result.ok) ctx.purgedOk.add(ctx.v.id); return result; }));
  },
  "a snapshot of everything": ctx => { track(ctx, "snapshot all", ctx.graph.snapshotAll()); },
  "an undo": ctx => {
    const result = ctx.graph.undo();
    if (result.ok) ctx.accepted.set(result.commit, []);
  },
  "a crash, a restart and recovery": crash,
  "the graph stops": ctx => { ctx.life.abort("stop"); ctx.otherLife.abort("stop"); ctx.stopped = true; },
};

async function finalChecks(ctx: Ctx): Promise<string[]> {
  const problems: string[] = [...ctx.notes.filter(note => note.startsWith("problem"))];
  const unsettled = ctx.tracked.filter(item => !item.settled).map(item => item.label);
  if (unsettled.length) problems.push(`hang: ${unsettled.join(", ")} never settled`);
  for (const item of [...ctx.graph.rejected(), ...ctx.other.rejected()]) ctx.rejected.add(item.commit);
  // No lost work: every accepted commit is stored, still pending (the recovery copy), rejected, or wholly on nodes
  // that were purged or whose history was compacted.
  const stored = new Set(ctx.memory.allEntries().map(entry => entry.commit));
  const pending = new Set([...ctx.graph.pending(), ...ctx.other.pending()].map(item => item.commit));
  const compacted = new Set(ctx.memory.compactions.map(item => item.node.id));
  const inStore = new Set(ctx.memory.allEntries().map(entry => entry.node.id));
  for (const [id, nodes] of ctx.accepted) {
    if (stored.has(id) || pending.has(id) || ctx.rejected.has(id)) continue;
    if (nodes.length && nodes.every(node => (ctx.purged.has(node) && !inStore.has(node)) || compacted.has(node))) continue;
    if (!nodes.length) continue;
    problems.push(`lost-work: commit ${id.slice(0, 8)} is neither stored, pending nor rejected`);
  }
  problems.push(...checkStructure(ctx.graph, SYNTHETIC_TYPES, ctx.memory), ...checkSnapshots(ctx.memory, SYNTHETIC_TYPES));
  if (ctx.stopped) {
    // A stopped graph keeps its pending commits as the recovery copy, and flush doesn't wait.
    let flushed = false;
    void ctx.graph.flush().then(() => { flushed = true; });
    await settle();
    if (!flushed) problems.push("hang: flush waited on a stopped graph");
    const recovery = new Set(ctx.recovery.map(item => item.commit));
    for (const item of ctx.graph.pending()) if (!recovery.has(item.commit)) problems.push(`recovery: pending ${item.commit.slice(0, 8)} is missing from the recovery copy`);
    return problems;
  }
  if (ctx.graph.pending().length || ctx.other.pending().length) problems.push(`pending: ${ctx.graph.pending().length + ctx.other.pending().length} commits still pending after everything was delivered`);
  problems.push(...checkResolution(ctx.graph, SYNTHETIC_TYPES));
  if (ctx.purgedOk.has(ctx.v.id) && inStore.has(ctx.v.id)) problems.push("purge: V's stream is back in the store after it was purged");
  // A process, result effect or listener left behind (after a restart, the new graph started later: no baseline).
  if (ctx.graph.storeProcess?.children.length) problems.push(`lifetime: ${ctx.graph.storeProcess.children.length} store processes still running`);
  if (ctx.baseline >= 0 && ctx.graph.env.allNodes().length !== ctx.baseline)
    problems.push(`lifetime: ${ctx.graph.env.allNodes().length - ctx.baseline} kernel nodes more than after setup`);
  // Consistency: once both windows have caught up, each resolves what a graph freshly loaded from the store does.
  for (const graph of [ctx.graph, ctx.other]) {
    const synced = graph.sync();
    await quiesce(ctx);
    await synced;
  }
  const load = async (name: string) => {
    const graph = makeGraph(ctx, name, new Aborter());
    const loading = graph.load();
    await quiesce(ctx);
    await loading;
    return graph;
  };
  const fresh = await load("fresh");
  // Sync reads entries, and a purge leaves none: a window holding a node another window purged loads again, as the
  // Studio's host does when the store's index no longer lists a node it holds.
  const listed = new Set(fresh.list().map(ref => ref.id));
  const other = ctx.other.list().some(ref => !ref.id.startsWith("builtin:") && !listed.has(ref.id)) ? await load("other reloaded") : ctx.other;
  for (const graph of [ctx.graph, other]) {
    const ids = (g: Graph) => g.list().map(ref => ref.id).sort();
    if (JSON.stringify(ids(graph)) !== JSON.stringify(ids(fresh))) problems.push(`consistency: ${graph === ctx.graph ? "this" : "the other"} window lists ${ids(graph).length} nodes, the store ${ids(fresh).length}`);
    for (const ref of fresh.list()) if (JSON.stringify(graph.resolve(ref)) !== JSON.stringify(fresh.resolve(ref)))
      problems.push(`consistency: ${graph === ctx.graph ? "this" : "the other"} window resolves ${ref.id.slice(0, 8)} as ${JSON.stringify(graph.resolve(ref))}, the store as ${JSON.stringify(fresh.resolve(ref))}`);
  }
  return problems;
}

const ORDERS = ["in-order", "order-1", "order-2", "order-3"];
for (const [row, outstanding] of Object.entries(OUTSTANDING)) for (const [column, event] of Object.entries(EVENTS)) {
  test(`with ${row}: ${column}`, async () => {
    const failures: string[] = [];
    for (const order of ORDERS) {
      const ctx = await setup(order);
      await outstanding(ctx);
      await event(ctx);
      await settle();
      await quiesce(ctx);
      const problems = await finalChecks(ctx);
      // Cells with a rule of their own.
      if (row.startsWith("a compaction") && column.startsWith("a compaction")) {
        const results = await Promise.all(ctx.tracked.filter(item => item.label.startsWith("compact")).map(item => item.promise.catch(() => null)));
        if (!results.some(result => (result as { reason?: string } | null)?.reason === "busy")) problems.push("compaction: a second compaction of A while one ran wasn't refused as busy");
      }
      if (row.startsWith("a purge") && column === "a commit to V" && !ctx.stopped && ctx.restarts === 0) {
        if (ctx.graph.list().some(ref => ref.id === ctx.v.id)) problems.push("purge: V is still listed after it was purged");
      }
      failures.push(...problems.map(problem => `${order}: ${problem}`));
      ctx.life.abort("end"); ctx.otherLife.abort("end");
    }
    expect(failures).toEqual([]);
  });
}

test("an acknowledgement of this window's own append never moves it past another window's entries it hasn't read", async () => {
  const scheduler = new Scheduler(), store = new SimStore(new MemoryStore(), scheduler);
  const open = (name: string) => createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock: simClock(scheduler), random: seededRandom(name) }, signal: new Aborter().signal });
  const ctx = { scheduler } as Ctx;
  const a = open("a"), b = open("b");
  await drive(ctx, a.load()); await drive(ctx, b.load());
  const made = a.commit([{ op: "create", type: ITEM, as: "n", fields: { title: "one" } }]);
  if (!made.ok) throw new Error(made.reason);
  const node = made.created.n;
  await drive(ctx, a.flush()); await drive(ctx, b.sync());
  // A's change takes position p; B's own commit takes p + 1 and is acknowledged before B catches up.
  a.commit([set(node, "from a")]);
  await drive(ctx, a.flush());
  b.commit([{ op: "create", type: ITEM, as: "m", fields: { title: "b's" } }]);
  await drive(ctx, b.flush());
  await drive(ctx, b.sync());
  expect(b.resolve(node, ["title"])).toBe("from a");
  // And B's next edit of that node isn't refused as stale.
  const edit = b.commit([set(node, "from b")]);
  await drive(ctx, b.flush());
  expect(edit.ok && b.acknowledged(edit.commit)).toBe(true);
});
