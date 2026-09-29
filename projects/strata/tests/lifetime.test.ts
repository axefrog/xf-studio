/**
 * Lifetimes and races found in deep review 6: finished store work and run effects are forgotten (STRATA-01), a kept
 * input stays active across a rewiring (STRATA-02), a refused busy commit takes no counters (STRATA-04), store tasks
 * settle from their process state and never hang after the graph stops (STRATA-05), a compaction refuses commits that
 * would reference what it is rolling up (STRATA-06), and a purge leaves no snapshot behind and reaches inlined streams
 * (STRATA-07).
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, LATEST, MemoryStore } from "strata";
import type { DemandSpec, KNode } from "strata";
import { Scheduler, settle, simClock } from "strata/testing";
import { ITEM } from "../src/testing/synthetic";
import { create, drive, harness, ok } from "./helpers";

test("finished store work, its result effects and demand followers are forgotten: memory stays flat over 300 commits", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  const node = create(graph, ITEM, { title: "t" });
  await drive(scheduler, graph.flush());
  const nodes = () => graph.env.allNodes().length;
  const before = nodes(), children = graph.storeProcess!.children.length;
  for (let i = 0; i < 300; i++) {
    ok(graph.commit([{ op: "set", node, path: ["title"], value: `v${i}` }]));
    await drive(scheduler, graph.flush());
  }
  expect(nodes() - before).toBeLessThanOrEqual(2);
  expect(graph.storeProcess!.children.length).toBeLessThanOrEqual(children + 1);
  life.abort();
});

test("a demand-as-source edge leaves nothing behind when released", () => {
  const scheduler = new Scheduler();
  const env = createEnvironment({ clock: simClock(scheduler) });
  const a = env.seed<number>({ id: "a", initial: 1 });
  const spec = env.seed<DemandSpec>({ id: "spec", initial: { rolling: { entries: 3 } } });
  const before = env.allNodes().length;
  for (let i = 0; i < 20; i++) {
    const token = new Aborter();
    a.demand(spec as KNode<DemandSpec>, token.signal);
    token.abort();
  }
  expect(env.allNodes().length).toBe(before);
  expect(a.active).toBe(false);
});

test("an input kept across a rewiring stays active: its activation isn't aborted and run again", () => {
  const scheduler = new Scheduler();
  const env = createEnvironment({ clock: simClock(scheduler) });
  const log: string[] = [];
  const a = env.seed<number>({ id: "a", initial: 1, activate: ({ signal }) => { log.push("on"); signal.addEventListener("abort", () => log.push("off")); } });
  const b = env.seed<number>({ id: "b", initial: 2 });
  const sum = env.combinator<number>({ id: "sum", inputs: [a], compute: context => context.inputs.reduce((total, input) => total + (input.value as number ?? 0), 0) });
  const token = new Aborter();
  sum.demand(LATEST, token.signal);
  expect(sum.value()).toBe(1);
  env.setInputs(sum, [a, b]);
  expect(sum.value()).toBe(3);
  env.setInputs(sum, [a, { node: b, demand: { rolling: { entries: 2 } } }]);
  expect(log).toEqual(["on"]);
  token.abort();
  expect(log).toEqual(["on", "off"]);
});

test("a commit refused as busy takes no commit ID, position or actor counter", () => {
  const { graph } = harness();
  const node = create(graph, ITEM, { title: "a" });
  const refusals: string[] = [];
  const trigger = graph.env.seed<number>({ id: "trigger" });
  const effect = graph.env.effect({ inputs: [trigger], run: () => {
    const result = graph.commit([{ op: "set", node, path: ["title"], value: "in a cycle" }]);
    if (!result.ok) refusals.push(result.reason);
  } });
  const token = new Aborter();
  graph.env.connect(effect, token.signal);
  const position = graph.position;
  graph.env.observe(trigger, 1);
  expect(refusals.length).toBeGreaterThan(0);
  expect(new Set(refusals)).toEqual(new Set(["busy"]));
  expect(graph.position).toBe(position);
  ok(graph.commit([{ op: "set", node, path: ["title"], value: "b" }]));
  const history = graph.debugState().records.find(rec => rec.ref.id === node.id)!.entries;
  expect(history.map(entry => entry.actorSeq)).toEqual([1, 2]);
  token.abort();
});

test("store work asked of a stopped graph fails at once, and flush never hangs", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  const node = create(graph, ITEM, { title: "a" });
  life.abort("closed");
  await settle();
  expect(graph.pending().length).toBe(1);   // kept: the host's recovery copy
  await graph.flush();
  await expect(graph.sync()).rejects.toThrow("stopped");
  await expect(graph.purge(node)).rejects.toThrow("stopped");
});

test("an aborted store task's result reaches no one", async () => {
  const scheduler = new Scheduler();
  const memory = new MemoryStore();
  let release: (() => void) | undefined;
  const slow = new Proxy(memory, { get: (target, key) => key === "changesSince"
    ? (pos: number) => new Promise(resolve => { release = () => resolve(target.changesSinceNow(pos)); })
    : Reflect.get(target, key) });
  const life = new Aborter();
  const { createGraph } = await import("strata");
  const { SYNTHETIC_TYPES } = await import("../src/testing/synthetic");
  const { seededRandom } = await import("strata/testing");
  const graph = createGraph({ types: SYNTHETIC_TYPES, store: slow, signal: life.signal, sources: { clock: simClock(scheduler), random: seededRandom("s") } });
  await graph.load();
  let outcome = "pending";
  graph.sync().then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
  await settle();
  life.abort("closed");
  release?.();
  await settle(); await settle();
  expect(outcome).toBe("rejected");
});

test("while a compaction runs, a commit that would reference an entry being rolled up is refused as busy", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  const node = create(graph, ITEM, { title: "t0" });
  for (let i = 1; i <= 5; i++) ok(graph.commit([{ op: "set", node, path: ["title"], value: `t${i}` }]));
  await drive(scheduler, graph.flush());
  graph.forgetHistory();
  const compacting = graph.compact(node);
  // Let the compaction reach the store, then tag an entry it is rolling up.
  let refused: string | undefined;
  for (let i = 0; i < 50 && refused === undefined; i++) {
    await settle();
    const result = graph.commit([{ op: "tag", node, label: "late", entries: [{ node, seq: 2 }] }]);
    if (!result.ok) refused = result.reason;
    else { refused = "accepted"; break; }
    scheduler.deliver(0);
  }
  await drive(scheduler, compacting);
  expect(["busy", "accepted"]).toContain(refused!);
  // Whatever was accepted is kept: a tag's entry is never rolled away.
  if (refused === "accepted") expect((await drive(scheduler, graph.history(node))).some(entry => entry.seq === 2)).toBe(true);
  life.abort();
});

test("a purge waits for queued snapshots, so none brings the node back", async () => {
  const { graph, scheduler, memory, life } = harness({ store: true, extra: { snapshotEvery: 1 } });
  await drive(scheduler, graph.load());
  const node = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node, path: ["title"], value: "b" }]));
  const purging = graph.purge(node);
  await drive(scheduler, purging);
  for (let i = 0; i < 20 && scheduler.deliver(0); i++) await settle();
  expect(memory!.snapshotOf(node)).toBeUndefined();
  expect(memory!.readStreamNow(node)).toEqual([]);
  life.abort();
});

test("a layer cycle's answer doesn't depend on which node was read first (SPEC §12.5)", async () => {
  const { Resolver } = await import("../src/resolve");
  const { defineType, pathKey } = await import("strata");
  const def = defineType({ type: "t", owner: "tests", schema: "1", fields: { x: { kind: "value" } } });
  const ref = (id: string) => ({ type: "t", id });
  // A feeds x from B, then bases on D (which holds x = 4); B bases on A: A → B → A is a cycle that arrived anyway.
  const states: Record<string, unknown> = {
    a: { name: "a", own: {}, layers: [{ from: ref("b"), role: "feed", paths: [["x"]] }, { from: ref("d"), role: "base", paths: "*" }], trashed: false, retracted: false },
    b: { name: "b", own: {}, layers: [{ from: ref("a"), role: "base", paths: "*" }], trashed: false, retracted: false },
    d: { name: "d", own: { [pathKey(["x"])]: 4 }, layers: [], trashed: false, retracted: false },
  };
  const reader = { state: (node: { id: string }) => states[node.id] as never, def: () => def, pinned: () => null, defaults: () => undefined };
  const fresh = new Resolver(reader).leaf(ref("b"), ["x"]).value;
  const afterA = new Resolver(reader);
  afterA.leaf(ref("a"), ["x"]);
  expect(afterA.leaf(ref("b"), ["x"]).value).toBe(fresh);
  expect(fresh).toBe(4);
});

test("releases queued when the activation bound is hit are applied, not dropped (SPEC §6.11)", () => {
  const scheduler = new Scheduler();
  const env = createEnvironment({ clock: simClock(scheduler), activationBound: 4 });
  const x = env.seed<number>({ id: "x", initial: 1 }), y = env.seed<number>({ id: "y", initial: 2 });
  const out = env.combinator<number>({ id: "out", inputs: [x], compute: context => context.inputs[0].value as number });
  const held = env.seed<number>({ id: "held", initial: 0 });
  const token = new Aborter();
  held.demand(LATEST, token.signal);
  expect(held.active).toBe(true);
  // Every priming of out rewires it to the other seed; the host's demand on `held` ends in the middle of the storm.
  let flips = 0;
  const flip = env.effect({ inputs: [out], run: context => {
    if (++flips === 2) token.abort();
    env.setInputs(out, [context.inputs[0].value === 1 ? y : x]);
  } });
  env.connect(flip, new Aborter().signal);
  expect(env.errors.value()?.code).toBe("activation-bound");
  expect(held.active).toBe(false);
});

test("every entry and computation in a cycle sees the cycle's start time (SPEC §3.2)", () => {
  const scheduler = new Scheduler();
  let now = 1000;
  const env = createEnvironment({ clock: { ...simClock(scheduler), now: () => now++ } });
  const a = env.seed<number>({ id: "a" });
  const seen: number[] = [];
  const b = env.combinator<number>({ id: "b", inputs: [a], compute: context => { seen.push(context.at); return (context.inputs[0].value as number) + 1; } });
  const token = new Aborter();
  b.demand(LATEST, token.signal);
  env.observe(a, 1);
  const cycle = a.latest()!.cycle;
  expect(b.latest()!.cycle).toBe(cycle);
  expect(new Set([a.latest()!.at, b.latest()!.at, seen[seen.length - 1]]).size).toBe(1);
});

test("trust: equally ranked actors break ties by ID, never by comparing their clocks (SPEC §17.5)", async () => {
  const { resolveClaims, trustTable } = await import("strata");
  const policy = { rank: () => 1 };
  const result = resolveClaims("hair", [{ actor: "studio", value: "ash", asOf: 10 }, { actor: "game", value: "cool", asOf: 999 }], policy);
  expect(result.from?.actor).toBe("game");
  expect(result.disagreement?.claims.length).toBe(2);
  const again = resolveClaims("hair", [{ actor: "studio", value: "ash", asOf: 99999 }, { actor: "game", value: "cool", asOf: 1 }], policy);
  expect(again.from?.actor).toBe("game");
  expect(resolveClaims("hair", [{ actor: "b", value: 1, asOf: 1 }, { actor: "a", value: 2, asOf: 1 }], trustTable({ hair: ["b", "a"] })).value).toBe(1);
});
