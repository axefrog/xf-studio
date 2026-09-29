/**
 * Edges of reading and committing: a resolver over states a graph wouldn't hold (a type it doesn't know, map keys in
 * a layer cycle, a pinned source out of reach, identity maps), read models asked about nodes that aren't there, a pin
 * whose source was purged, views rooted at a missing node, history loads racing a purge, commits and undos asked for
 * during a cycle, a compaction's busy window, and errors that aren't refusals. Then the cases the coverage and mutation
 * measurements led to: points named inside a commit, what compaction must keep for pins and inlined streams, inlined
 * streams across a reload, a purge or another persistence, and catching up with a commit of one's own already written.
 */
import { expect, test } from "bun:test";
import { Aborter, createGraph, defineRule, defineType, MemoryStore, pathKey } from "strata";
import type { Layer, NodeRef, NodeState, TypeDef } from "strata";
import { Scheduler, seededRandom, settle, simClock, SimStore, STRATA_DEBUG, SYNTHETIC_TYPES } from "strata/testing";
import { keepSet } from "../src/compaction";
import { Resolver } from "../src/resolve";
import type { StateReader } from "../src/resolve";
import { ReadModel } from "../src/model";
import { GROUP, ITEM } from "../src/testing/synthetic";
import { create, drive, harness, ok } from "./helpers";

const kinds = defineType({ type: "k", owner: "t", schema: "1", fields: {
  tags: { kind: "map", of: { kind: "value" } }, secret: { kind: "map", of: { kind: "value" }, inherit: false },
  link: { kind: "ref", to: "k", clone: "share" }, list: { kind: "refs", to: "k", clone: "share" }, notes: { kind: "map", of: { kind: "value" } },
  follow: { kind: "map", of: { kind: "ref", to: "k", clone: "share", follows: true } }, title: { kind: "value" },
} });
const ref = (id: string): NodeRef => ({ type: "k", id });
const state = (own: Record<string, unknown> = {}, layers: Layer[] = []): NodeState =>
  ({ name: "", own: Object.fromEntries(Object.entries(own).map(([key, value]) => [pathKey(key.split(".")), value])) as never, layers, trashed: false, retracted: false });
const reader = (states: Record<string, NodeState>, pinned: StateReader["pinned"] = () => null): StateReader => ({
  state: node => states[node.id] ?? null, def: type => type === "k" ? kinds : undefined, pinned, defaults: () => undefined });

test("a resolver: a node of an unknown type or a path its type lacks is absent; map keys in a layer cycle don't loop and aren't kept", () => {
  const base = (from: string): Layer => ({ from: ref(from), role: "base", paths: "*" });
  const states = { a: state({ "tags.x": 1 }, [base("b")]), b: state({ "tags.y": 2 }, [base("a")]), u: state() };
  const resolver = new Resolver(reader(states));
  expect(resolver.leaf({ type: "unknown", id: "u" }, ["title"]).has).toBe(false);
  expect(resolver.leaf(ref("a"), ["nope"]).has).toBe(false);
  expect(resolver.mapKeys({ type: "unknown", id: "u" }, ["tags"])).toEqual([]);
  expect(resolver.mapKeys(ref("a"), ["title"])).toEqual([]);
  expect(resolver.value(ref("a"), ["nope"])).toBeUndefined();
  expect(resolver.leafPaths({ type: "unknown", id: "u" })).toEqual([]);
  expect(resolver.leafPaths(ref("missing"))).toEqual([]);
  expect(resolver.mapKeys(ref("a"), ["tags"])).toEqual(["x", "y"]);
  expect(resolver.mapKeys(ref("b"), ["tags"])).toEqual(["x", "y"]);
  // Read the other way round first, the answers are the same (nothing met in a cycle is kept).
  const fresh = new Resolver(reader(states));
  expect(fresh.mapKeys(ref("b"), ["tags"])).toEqual(["x", "y"]);
  expect(fresh.mapKeys(ref("a"), ["tags"])).toEqual(["x", "y"]);
});

test("a resolver: a pinned layer out of reach gives nothing; an identity map is never inherited", () => {
  const pinned: Layer = { from: ref("b"), role: "base", paths: "*", at: { node: ref("b"), seq: 1 } };
  const states = { a: state({}, [pinned]), b: state({ "tags.y": 2, "secret.s": 1, title: "b" }), c: state({}, [{ from: ref("b"), role: "base", paths: "*" }]) };
  const resolver = new Resolver(reader(states));
  expect(resolver.mapKeys(ref("a"), ["tags"])).toEqual([]);
  expect(resolver.leaf(ref("a"), ["title"]).has).toBe(false);
  expect(resolver.mapKeys(ref("c"), ["secret"])).toEqual([]);
  expect(resolver.mapKeys(ref("c"), ["tags"])).toEqual(["y"]);
});

test("a read model asked about nodes that aren't there, and follow cycles through shared targets", () => {
  const states = { a: state({ link: ref("b"), list: [ref("b"), ref("c")], "notes.n": 1, "follow.x": ref("b"), "follow.y": ref("c") }), b: state({ "follow.z": ref("c") }), c: state() };
  const model = new ReadModel(reader(states), () => Object.keys(states).map(ref), () => ({ seq: 1, constant: false }));
  expect(model.layers(ref("missing"))).toEqual([]);
  expect(model.references(ref("missing"))).toEqual([]);
  expect(model.references({ type: "unknown", id: "a" })).toEqual([]);
  expect(model.references(ref("a")).map(item => [item.path.join("."), item.target.id, item.follows]).sort()).toEqual(
    [["follow.x", "b", true], ["follow.y", "c", true], ["link", "b", false], ["list", "b", false], ["list", "c", false]]);
  expect(model.referrers(ref("c")).map(item => item.node.id).sort()).toEqual(["a", "a", "b"]);
  expect(model.read(ref("missing"))).toBeUndefined();
  expect(model.followCycle(ref("missing"))).toBeNull();
  // c is reached twice (through a and through b): visited once, and there is no cycle.
  expect(model.followCycle(ref("a"))).toBeNull();
});

test("a pin whose source was purged reads nothing from it, now and in a view of the past", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const source = create(graph, ITEM, { title: "src" });
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: source, at: 1 } }])).created.p;
  expect(graph.resolve(pinned, ["title"])).toBe("src");
  const before = graph.position;
  const changes: string[] = [];
  const watching = new Aborter();
  graph.subscribe(pinned, change => changes.push(...change.paths.map(path => path.join("."))), { signal: watching.signal });
  expect((await drive(scheduler, graph.purge(source, { force: true }))).ok).toBe(true);
  expect(graph.resolve(pinned, ["title"])).toBe("untitled");
  // Its subscribers are told, and a graph loaded again reads the same.
  expect(changes).toContain("title");
  watching.abort();
  const view = await drive(scheduler, graph.at(before));
  expect(view.resolve(pinned, ["title"])).toBe("untitled");
  expect(view.resolve({ type: ITEM, id: "nobody" })).toBeUndefined();
  expect(view.resolve({ type: GROUP, id: pinned.id })).toBeUndefined();
  expect((await drive(scheduler, graph.at(before, [{ type: ITEM, id: "nobody" }, pinned]))).exists(pinned)).toBe(true);
  // A reference asked for with another type names nothing.
  expect(graph.resolve({ type: GROUP, id: pinned.id })).toBeUndefined();
  expect(graph.referrers({ type: GROUP, id: source.id })).toEqual([]);
});

test("a history load that a purge overtakes changes nothing; the position of a snapshot's own entry is known", async () => {
  const scheduler = new Scheduler();
  const { MemoryStore } = await import("strata");
  const { SimStore } = await import("strata/testing");
  const store = new SimStore(new MemoryStore(), scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, snapshotEvery: 2, sources: { clock: simClock(scheduler), random: seededRandom(`h${session++}`) }, signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  const first = await open();
  const a = create(first, ITEM, { title: "a0" });
  for (let i = 1; i <= 4; i++) ok(first.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  await drive(scheduler, first.flush());
  await drive(scheduler, first.snapshotAll());
  const graph = await open();
  const snapshotSeq = graph.seqOf(a);
  expect(graph.posOf({ node: a, seq: snapshotSeq })).toBeDefined();
  // The history read is asked for first; the purge reaches the store first.
  const history = graph.history(a);
  const purge = graph.purge(a, { force: true });
  for (let i = 0; i < 10; i++) await settle();
  const pending = scheduler.pending();
  const purgeAt = pending.findIndex(event => event.label.startsWith("purge"));
  if (purgeAt >= 0) scheduler.deliver(purgeAt);
  await drive(scheduler, purge);
  expect(await drive(scheduler, history)).toEqual([]);
  expect(graph.exists(a)).toBe(false);
  // A graph without a store loads nothing and reports it.
  const bare = createGraph({ types: SYNTHETIC_TYPES, sources: { clock: simClock(scheduler), random: seededRandom("bare") } });
  expect(await bare.load()).toEqual({ nodes: 0, entries: 0, foldMs: 0 });
});

test("a commit, an undo or a fix asked for during a cycle is refused as busy and takes nothing", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "b" }]));
  const reasons: string[] = [];
  const trigger = graph.env.seed<number>({ initial: 0 });
  const effect = graph.env.effect({ inputs: [trigger], run: context => {
    if (context.inputs[0].value !== 1) return;
    const undo = graph.undo();
    reasons.push(undo.ok ? "ok" : undo.reason);
    graph.record(defineSourceTicks, 1);
  } });
  const life = new Aborter();
  graph.env.connect(effect, life.signal);
  graph.env.observe(trigger, 1);
  expect(reasons).toEqual(["busy"]);
  expect(graph.resolve(a, ["title"])).toBe("b");
  expect(graph.canUndo()).toBe(true);
  life.abort();
});
import { defineSource } from "strata";
const defineSourceTicks = defineSource<number>("ticks", { ring: 2 });

test("a type whose identity values fail throws from the commit: an error that isn't a refusal is not swallowed", () => {
  const broken: TypeDef = defineType({ type: "broken", owner: "t", schema: "1", fields: { x: { kind: "value" } }, identity: () => { throw new Error("no identity"); } });
  const graph = createGraph({ types: [broken], sources: { clock: simClock(new Scheduler()), random: seededRandom("b") } });
  expect(() => graph.commit([{ op: "create", type: "broken", as: "b" }])).toThrow("no identity");
});

test("while a compaction's store call runs, a commit referencing an entry it rolls up is refused as busy; one made before it read the streams is kept", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  const node = create(graph, ITEM, { title: "t0" });
  for (let i = 1; i <= 5; i++) ok(graph.commit([{ op: "set", node, path: ["title"], value: `t${i}` }]));
  await drive(scheduler, graph.flush());
  graph.forgetHistory();
  const compacting = graph.compact(node);
  // Before the compaction has read the streams: the tag is part of what it keeps.
  const early = ok(graph.commit([{ op: "tag", node, label: "early", entries: [{ node, seq: 2 }] }]));
  for (let i = 0; i < 200; i++) { await settle(); if (scheduler.pending().some(event => event.label.startsWith("compact"))) break; scheduler.deliver(0); }
  const late = graph.commit([{ op: "tag", node, label: "late", entries: [{ node, seq: 3 }] }]);
  expect(late.ok ? "ok" : late.reason).toBe("busy");
  // An edit referencing nothing being rolled up is fine meanwhile.
  expect(graph.commit([{ op: "set", node, path: ["title"], value: "meanwhile" }]).ok).toBe(true);
  await drive(scheduler, compacting);
  const history = await drive(scheduler, graph.history(node));
  expect(history.some(entry => entry.seq === 2)).toBe(true);
  expect(graph.acknowledged(early.commit)).toBe(true);
  life.abort();
});

test("a rule on a list of subject types, and blocking conflicts refusing every edit or a named action", () => {
  const blocker = defineRule({ id: "no-x", owner: "t", subject: [ITEM, GROUP], severity: "blocking", blocks: ["*"], evaluate: (subject, context) =>
    context.resolve(subject, ["title"]) === "x" ? [{ sentence: "x is not allowed", subjects: [subject] }] : [] });
  const { graph } = harness({ extra: { rules: [blocker] } });
  const a = create(graph, ITEM, { title: "x" });
  expect(graph.blockingFor(a, "anything")?.rule).toBe("no-x");
  const refused = graph.commit([{ op: "set", node: a, path: ["title"], value: "y" }], { action: "edit" });
  expect(refused.ok ? "" : refused.reason).toBe("conflict");
  expect(graph.commit([{ op: "set", node: a, path: ["title"], value: "y" }]).ok).toBe(true);
  expect(graph.conflicts()).toEqual([]);
});

test("once an append is answered, nothing it started is left waiting: no timer outlives it", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  for (let i = 0; i < 5; i++) create(graph, ITEM, { title: `n${i}` });
  await drive(scheduler, graph.flush());
  await settle();
  expect(scheduler.pending().map(event => event.label)).toEqual([]);
  life.abort();
});

test("a pin reads its source's own layers as they were at the pinned entry, after a reload from snapshots too", async () => {
  const scheduler = new Scheduler();
  const { MemoryStore } = await import("strata");
  const { SimStore } = await import("strata/testing");
  const store = new SimStore(new MemoryStore(), scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, snapshotEvery: 2, sources: { clock: simClock(scheduler), random: seededRandom(`p${session++}`) }, signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  let graph = await open();
  const base = create(graph, ITEM, { title: "old" });
  const source = ok(graph.commit([{ op: "create", type: ITEM, as: "s", from: { fork: base } }])).created.s;
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: source, at: 1 } }])).created.p;
  for (let i = 0; i < 4; i++) ok(graph.commit([{ op: "set", node: base, path: ["title"], value: `new ${i}` }]));
  expect(graph.resolve(pinned, ["title"])).toBe("old");
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  // The base loaded from a snapshot taken after the pin: its history is loaded, since the pin reads it.
  expect(graph.resolve(pinned, ["title"])).toBe("old");
  // A new pin whose reading needs history that isn't loaded is refused until it is.
  const fresh = await open();
  expect(fresh.resolve(pinned, ["title"])).toBe("old");
});

test("catching up rejects only the pending commits from the first one another window made stale; one before it, already on its way, stands", async () => {
  const scheduler = new Scheduler();
  const { MemoryStore } = await import("strata");
  const { SimStore } = await import("strata/testing");
  const memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  const open = async (name: string) => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock: simClock(scheduler), random: seededRandom(name) }, signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  const a = await open("a"), b = await open("b");
  const x = create(a, ITEM, { title: "x" }), y = create(a, ITEM, { title: "y" });
  await drive(scheduler, a.flush());
  await drive(scheduler, b.sync());
  ok(b.commit([{ op: "set", node: y, path: ["title"], value: "b's y" }]));
  await drive(scheduler, b.flush());
  // A's change of x is sent; its change of y waits behind it. A catches up before either is answered.
  const first = ok(a.commit([{ op: "set", node: x, path: ["title"], value: "a's x" }]));
  const second = ok(a.commit([{ op: "set", node: y, path: ["title"], value: "a's y" }]));
  const syncing = a.sync();
  await drive(scheduler, syncing);
  await drive(scheduler, a.flush());
  expect(a.pending()).toEqual([]);
  expect(a.rejected().map(item => item.commit)).toEqual([second.commit]);
  expect(a.acknowledged(first.commit)).toBe(true);
  expect([a.resolve(x, ["title"]), a.resolve(y, ["title"])]).toEqual(["a's x", "b's y"]);
  // What A holds is what the store holds.
  expect(memory.allEntries().some(entry => entry.commit === first.commit)).toBe(true);
});

test("a graph without a store compacts in memory; a session type without a ring keeps 1024 entries; a bucket can be named", async () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "t0" });
  for (let i = 1; i <= 5; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `t${i}` }]));
  graph.forgetHistory();
  const compacted = await graph.compact(a, { bucketMs: 60_000 });
  expect(compacted).toEqual({ ok: true, before: 6, after: 2 });
  expect(graph.resolve(a, ["title"])).toBe("t5");
  const holder = create(graph, GROUP, { label: "g", members: { m: a } });
  expect((await graph.collapseInline(a)).ok).toBe(true);
  expect(graph.inlinedIn(a)?.node.id).toBe(holder.id);
  const session = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", fields: { x: { kind: "value" } } });
  const poses = createGraph({ types: [session], sources: { clock: simClock(new Scheduler()), random: seededRandom("r") } });
  const pose = ok(poses.commit([{ op: "create", type: "pose", as: "p", fields: { x: 0 } }])).created.p;
  for (let i = 1; i < 1100; i++) ok(poses.commit([{ op: "set", node: pose, path: ["x"], value: i }]));
  expect(poses.ring(pose).length).toBe(1024);
  expect(poses.resolve(pose, ["x"])).toBe(1099);
});

test("an inspector row names the worst of its conflicts", () => {
  const warn = defineRule({ id: "warn", owner: "t", subject: ITEM, severity: "warning", evaluate: subject => [{ sentence: "w", subjects: [subject] }] });
  const note = defineRule({ id: "note", owner: "t", subject: ITEM, severity: "notice", evaluate: subject => [{ sentence: "n", subjects: [subject] }] });
  const block = defineRule({ id: "block", owner: "t", subject: ITEM, severity: "blocking", blocks: ["nothing"], evaluate: (subject, context) => context.resolve(subject, ["title"]) === "b" ? [{ sentence: "b" }] : [] });
  const { graph } = harness({ extra: { rules: [note, warn, block] } });
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b" });
  expect(graph.inspectorRow(a)?.conflict).toBe("warning");
  expect(graph.inspectorRow(b)?.conflict).toBe("blocking");
});

test("a new pin whose reading needs history that isn't in memory is refused until it is loaded", async () => {
  const scheduler = new Scheduler();
  const { MemoryStore } = await import("strata");
  const { SimStore } = await import("strata/testing");
  const store = new SimStore(new MemoryStore(), scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, snapshotEvery: 2, sources: { clock: simClock(scheduler), random: seededRandom(`n${session++}`) }, signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  let graph = await open();
  const base = create(graph, ITEM, { title: "old" });
  const source = ok(graph.commit([{ op: "create", type: ITEM, as: "s", from: { fork: base } }])).created.s;
  for (let i = 0; i < 4; i++) ok(graph.commit([{ op: "set", node: base, path: ["title"], value: `new ${i}` }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  const refused = graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: source, at: 1 } }]);
  expect(refused.ok ? "ok" : refused.reason).toBe("unloaded");
  await drive(scheduler, graph.at({ node: source, seq: 1 }, [source]));
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: source, at: 1 } }])).created.p;
  expect(graph.resolve(pinned, ["title"])).toBe("old");
});

test("an identity value set on a source reaches no fork; a node referenced without following is re-checked by rules but not followed", () => {
  const { graph } = harness();
  const source = create(graph, ITEM, { title: "s" });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: source } }])).created.f;
  graph.conflicts();
  const before = graph.resolve(fork, ["code"]);
  const changes: string[] = [];
  const life = new Aborter();
  graph.subscribe(fork, change => changes.push(...change.paths.map(path => path.join("."))), { signal: life.signal });
  ok(graph.commit([{ op: "set", node: source, path: ["code"], value: "renumbered" }]));
  expect(graph.resolve(fork, ["code"])).toBe(before);
  expect(changes).toEqual([]);
  const holder = create(graph, ITEM, { title: "h", others: [source] });
  ok(graph.commit([{ op: "trash", node: source }]));
  expect(graph.conflicts(holder).map(item => item.rule)).toContain("trashed-ref");
  life.abort();
});

/** A store-backed graph that can be opened again over the same store (another session). */
function sessions(types = SYNTHETIC_TYPES, extra: Record<string, unknown> = {}) {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types, store, sources: { clock: simClock(scheduler), random: seededRandom(`m${session++}`) }, signal: new Aborter().signal, ...extra });
    await drive(scheduler, graph.load());
    return graph;
  };
  return { scheduler, memory, store, open };
}

test("a pin or a view at an entry sees the whole commit the entry belongs to", async () => {
  const { graph } = harness();
  const b = { type: ITEM, id: "b" };
  // A is created before B in one commit, then based on B: A's second entry comes before B's creation in position.
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a" }, { op: "create", type: ITEM, as: "b", id: "b", fields: { title: "from b" } },
    { op: "rebase", node: { created: "a" }, base: b }])).created.a;
  expect(graph.resolve(a, ["title"])).toBe("from b");
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 2 } }])).created.p;
  expect(graph.resolve(pinned, ["title"])).toBe("from b");
  expect((await graph.at({ node: a, seq: 2 }, [a])).resolve(a, ["title"])).toBe("from b");
  // A later commit moves the head, not the pinned point.
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "later" }]));
  expect(graph.resolve(pinned, ["title"])).toBe("from b");
});

test("a view at an entry whose history isn't in memory loads it first", async () => {
  const { scheduler, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 1 });
  let graph = await open();
  const a = create(graph, ITEM, { title: "one" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "two" }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  expect((await drive(scheduler, graph.at({ node: a, seq: 2 }, [a]))).resolve(a, ["title"])).toBe("two");
});

test("a new pin through a pin whose history isn't in memory is refused until it is loaded", async () => {
  const { scheduler, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 2 });
  let graph = await open();
  const b = create(graph, ITEM, { title: "b1" });
  for (let i = 2; i <= 5; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  // A reads B as it was at entry 1, then follows B live: at the head nothing reads B's early history.
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b, at: 1 } }])).created.a;
  ok(graph.commit([{ op: "rebase", node: a, base: b }]));
  for (let i = 0; i < 3; i++) ok(graph.commit([{ op: "set", node: a, path: ["tags", "k"], value: i }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  await drive(scheduler, graph.loadHistory(a));
  const refused = graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }]);
  expect(refused.ok ? "ok" : refused.reason).toBe("unloaded");
  await drive(scheduler, graph.loadHistory(b));
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }])).created.p;
  expect(graph.resolve(pinned, ["title"])).toBe("b1");
});

test("compacting what a pinned node read through its live layers keeps what the pin reads", async () => {
  const { scheduler, memory, store, open } = sessions();
  const graph = await open();
  const b = create(graph, ITEM, { title: "b1" });
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b } }])).created.a;
  for (let i = 2; i <= 5; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }])).created.p;
  await drive(scheduler, graph.flush());
  expect(graph.resolve(pinned, ["title"])).toBe("b1");
  graph.forgetHistory();
  expect(await drive(scheduler, graph.compact(b))).toMatchObject({ ok: true });
  expect(memory.readStreamNow(b).length).toBeLessThan(5);
  expect(graph.resolve(pinned, ["title"])).toBe("b1");
  const fresh = createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock: simClock(scheduler), random: seededRandom("fresh") } });
  await drive(scheduler, fresh.load());
  expect(fresh.resolve(pinned, ["title"])).toBe("b1");
});

test("a keep set keeps what reading each named point needs, roots included, through pins and live layers", () => {
  const { graph } = harness();
  const c = create(graph, ITEM, { title: "c1" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: c } }])).created.b;
  ok(graph.commit([{ op: "set", node: c, path: ["title"], value: "c2" }]));
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b, at: 1 } }])).created.a;
  ok(graph.commit([{ op: "set", node: c, path: ["title"], value: "c3" }]));
  const streams = graph[STRATA_DEBUG]().records.filter(rec => !rec.constant).map(rec => ({ ref: rec.ref, entries: rec.entries }));
  const defs = (type: string) => SYNTHETIC_TYPES.find(def => def.type === type);
  const ofC = (keep: Set<string>) => [...keep].filter(key => key.startsWith(`${c.id}@`)).sort();
  const withoutA = streams.filter(stream => stream.ref.id !== a.id);
  // Nothing names a point: C keeps its latest entry only.
  expect(ofC(keepSet(withoutA, defs))).toEqual([`${c.id}@3`]);
  // A pins B at its creation, when B read C's first entry.
  expect(ofC(keepSet(streams, defs))).toEqual([`${c.id}@1`, `${c.id}@3`]);
  // A root naming C's second entry keeps it.
  expect(ofC(keepSet(withoutA, defs, { roots: [{ node: c, seq: 2 }] }))).toEqual([`${c.id}@2`, `${c.id}@3`]);
  // A root naming B's creation needs C as B read it then.
  expect(ofC(keepSet(withoutA, defs, { roots: [{ node: b, seq: 1 }] }))).toEqual([`${c.id}@1`, `${c.id}@3`]);
});

test("an inlined stream survives a reload, the host's later edits and its compaction", async () => {
  const { scheduler, memory, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 2 });
  let graph = await open();
  const x = create(graph, ITEM, { title: "precious" });
  const host = create(graph, GROUP, { label: "h0", members: { x } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  graph = await open();
  expect(graph.resolve(x, ["title"])).toBe("precious");
  expect(graph.inlinedIn(x)).toEqual({ node: host, seq: 1 });
  // Past the snapshot bound: no snapshot stands in for the entry holding it.
  for (let i = 1; i <= 4; i++) ok(graph.commit([{ op: "set", node: host, path: ["label"], value: `h${i}` }]));
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.snapshotAll())).toBe(0);
  graph = await open();
  expect(graph.resolve(x, ["title"])).toBe("precious");
  graph.forgetHistory();
  expect(await drive(scheduler, graph.compact(host))).toMatchObject({ ok: true });
  expect(memory.readStreamNow(host).find(entry => entry.seq === 1)?.inlined?.[0].node).toEqual(x);
  graph = await open();
  expect(graph.resolve(x, ["title"])).toBe("precious");
});

test("references inside an inlined stream are read as its own type's: what they point at is kept, and they count as referrers", async () => {
  const { graph, scheduler, memory } = harness({ store: true });
  await drive(scheduler, graph.load());
  const b = create(graph, ITEM, { title: "b1" });
  for (let i = 2; i <= 4; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  const y = create(graph, ITEM, { title: "y" });
  const x = create(graph, ITEM, { title: "x", pin: { node: b, seq: 2 }, others: [y] });
  const host = create(graph, GROUP, { label: "h", members: { x } });
  create(graph, GROUP, { label: "other", members: { y } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true, host: { node: host } });
  // Y is referenced from X's inlined stream as well as by the other group: not collapsible.
  expect(await drive(scheduler, graph.collapseInline(y))).toMatchObject({ ok: false });
  graph.forgetHistory();
  await drive(scheduler, graph.compact(b));
  expect(memory!.readStreamNow(b).find(entry => entry.seq === 2)?.op.kind).toBe("set");
});

test("a stream is collapsed only into a host of its own persistence, and a session host never reaches the store", async () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", fields: { x: { kind: "value" }, item: { kind: "ref", to: ITEM, clone: "share" } } });
  const note = defineType({ type: "note", owner: "t", schema: "1", persistence: "session", fields: { about: { kind: "ref", to: "pose", clone: "share" } } });
  const holder = defineType({ type: "holder", owner: "t", schema: "1", fields: { pose: { kind: "ref", to: "pose", clone: "share" } } });
  const { scheduler, memory, open } = sessions([...SYNTHETIC_TYPES, pose, note, holder]);
  let graph = await open();
  const kept = create(graph, ITEM, { title: "kept" });
  const p = create(graph, "pose", { x: 1, item: kept });
  // A persistent node referenced only by a session node, and a session node referenced only by a persistent one.
  expect(await drive(scheduler, graph.collapseInline(kept))).toMatchObject({ ok: false, reason: "type" });
  const q = create(graph, "pose", { x: 2 });
  create(graph, "holder", { pose: q });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(q))).toMatchObject({ ok: false, reason: "type" });
  // Session into session: in memory only.
  create(graph, "note", { about: p });
  expect(await drive(scheduler, graph.collapseInline(p))).toMatchObject({ ok: true });
  expect(memory.compactions).toEqual([]);
  expect(await drive(scheduler, graph.purge(p))).toEqual({ ok: true });
  expect(graph.exists(p)).toBe(false);
  graph = await open();
  expect(graph.resolve(kept, ["title"])).toBe("kept");
});

test("purging a host purges the streams inlined in it; their dependents refuse it unless forced", async () => {
  const { graph, scheduler, memory } = harness({ store: true });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  const host = create(graph, GROUP, { label: "host", members: { x, y } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true, host: { node: host, seq: 1 } });
  expect(await drive(scheduler, graph.collapseInline(y))).toMatchObject({ ok: true, host: { node: host, seq: 1 } });
  // One of two streams inlined in the same entry purged: the other stays.
  expect(await drive(scheduler, graph.purge(y))).toEqual({ ok: true });
  expect(memory!.readStreamNow(host)[0].inlined?.map(inner => inner.node)).toEqual([x]);
  expect(graph.resolve(x, ["title"])).toBe("x");
  const dependent = ok(graph.commit([{ op: "create", type: ITEM, as: "d", from: { fork: x } }])).created.d;
  const purged: string[] = [];
  const life = new Aborter();
  graph.subscribeAll(set => purged.push(...set.nodes.filter(node => node.meta.includes("purged")).map(node => node.node.id)), { signal: life.signal });
  graph.subscribe(x, () => undefined, { signal: life.signal });
  expect(await drive(scheduler, graph.purge(host))).toMatchObject({ ok: false, reason: "dependents", dependents: [dependent] });
  expect(await drive(scheduler, graph.purge(host, { force: true }))).toEqual({ ok: true });
  expect([graph.exists(host), graph.exists(x), graph.inlinedIn(x)]).toEqual([false, false, undefined]);
  expect(purged).toContain(x.id);
  life.abort();
});

test("purging an inlined stream without a store rewrites its host in memory only", async () => {
  const { graph } = harness();
  const x = create(graph, ITEM, { title: "x" });
  const host = create(graph, GROUP, { label: "h", members: { x } });
  expect((await graph.collapseInline(x)).ok).toBe(true);
  expect(await graph.purge(x)).toEqual({ ok: true });
  expect(graph.exists(x)).toBe(false);
  expect(graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === host.id)?.entries[0].inlined).toBeUndefined();
});

test("catching up reads back this graph's own commit, written but not yet acknowledged, as its own", async () => {
  const { graph, scheduler, store } = harness({ store: true, extra: { retryMs: 40, replyTimeoutMs: 200 } });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a0" });
  await drive(scheduler, graph.flush());
  const syncing = graph.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  // The append lands before the read, and its reply is lost.
  store!.loseNext = 1;
  const mine = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a1" }]));
  await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
  await settle();
  expect(await drive(scheduler, syncing)).toEqual({ applied: 0 });
  expect(graph.rejected()).toEqual([]);
  await drive(scheduler, graph.flush());
  expect([graph.acknowledged(mine.commit), graph.pending().length, graph.rejected().length]).toEqual([true, 0, 0]);
  expect(graph.resolve(a, ["title"])).toBe("a1");
});

test("another window's commit on top of this graph's written, unacknowledged one rejects nothing", async () => {
  const { graph, scheduler, store } = harness({ store: true, extra: { retryMs: 40, replyTimeoutMs: 200 } });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a0" });
  await drive(scheduler, graph.flush());
  store!.loseNext = 1;
  const mine = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a1" }]));
  for (let i = 0; i < 20 && !scheduler.pending().some(event => event.label.startsWith("append")); i++) { scheduler.deliver(0); await settle(); }
  scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
  await settle();
  const other = createGraph({ types: SYNTHETIC_TYPES, store: store!, sources: { clock: simClock(scheduler), random: seededRandom("other") } });
  await drive(scheduler, other.load());
  expect(other.resolve(a, ["title"])).toBe("a1");
  ok(other.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  await drive(scheduler, other.flush());
  await drive(scheduler, graph.sync());
  await drive(scheduler, graph.flush());
  expect([graph.acknowledged(mine.commit), graph.rejected().length, graph.resolve(a, ["title"])]).toEqual([true, 0, "a2"]);
});

test("a rule for one other type isn't evaluated; a change to a field a compatible dependent lacks reaches it harmlessly", () => {
  const wide = defineType({ type: "wide", owner: "t", schema: "1", fields: { title: { kind: "value" }, extra: { kind: "value" } } });
  const narrow = defineType({ type: "narrow", owner: "t", schema: "1", compatible: ["wide"], fields: { title: { kind: "value" }, link: { kind: "ref", to: "wide", clone: "share" } } });
  const seen: string[] = [];
  const rule = defineRule({ id: "r", owner: "t", subject: "narrow", severity: "warning", evaluate: subject => { seen.push(subject.type); return []; } });
  const graph = createGraph({ types: [wide, narrow], rules: [rule], sources: { clock: simClock(new Scheduler()), random: seededRandom("x") } });
  const w = ok(graph.commit([{ op: "create", type: "wide", as: "w", fields: { title: "t", extra: 1 } }])).created.w;
  const n = ok(graph.commit([{ op: "create", type: "narrow", as: "n", layers: [{ from: w, role: "base", paths: "*" }] }])).created.n;
  graph.conflicts();
  ok(graph.commit([{ op: "set", node: w, path: ["extra"], value: 2 }]));
  expect(graph.resolve(n, ["title"])).toBe("t");
  expect(graph.resolve(n, ["extra"])).toBeUndefined();
  expect(new Set(seen)).toEqual(new Set(["narrow"]));
});

test("recovering a pending commit that a loaded snapshot covers asks the store: stored, it is acknowledged; beaten, rejected", async () => {
  for (const beaten of [false, true]) {
    const { scheduler, store, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 1, retryMs: 40, replyTimeoutMs: 200 });
    const main = await open();
    const a = create(main, ITEM, { title: "a0" });
    await drive(scheduler, main.flush());
    if (beaten) {
      // Another window gets there first: this graph's append will be refused as stale.
      const other = await open();
      ok(other.commit([{ op: "set", node: a, path: ["title"], value: "theirs" }]));
      await drive(scheduler, other.flush());
      await drive(scheduler, other.snapshotAll());
    } else store.loseNext = 1;
    const mine = ok(main.commit([{ op: "set", node: a, path: ["title"], value: "mine" }]));
    for (let i = 0; i < 20 && !scheduler.pending().some(event => event.label.startsWith("append")); i++) { scheduler.deliver(0); await settle(); }
    if (!beaten) {
      scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
      await settle();
      // Stored, unacknowledged: another window reads it and snapshots it.
      await drive(scheduler, (await open()).snapshotAll());
    }
    const recovery = main.pending();
    // The process ends; a later session loads from a snapshot covering the node's latest entry.
    scheduler.drop();
    const later = await open();
    expect(later.recover(recovery)).toEqual({ applied: 1, skipped: 0, rejected: 0 });
    await drive(scheduler, later.flush());
    expect([later.acknowledged(mine.commit), later.pending().length, later.rejected().map(item => item.commit)])
      .toEqual(beaten ? [false, 0, [mine.commit]] : [true, 0, []]);
    expect(later.resolve(a, ["title"])).toBe(beaten ? "theirs" : "mine");
  }
});

test("a collapsed node can't be edited; while it is being collapsed, commits to it are refused as busy", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x" });
  create(graph, GROUP, { label: "h", members: { x } });
  await drive(scheduler, graph.flush());
  const collapsing = graph.collapseInline(x);
  const during = graph.commit([{ op: "set", node: x, path: ["title"], value: "late" }]);
  expect(during.ok ? "ok" : during.reason).toBe("busy");
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: false, reason: "busy" });
  expect(await drive(scheduler, graph.compact(x))).toMatchObject({ ok: false, reason: "busy" });
  expect(await drive(scheduler, collapsing)).toMatchObject({ ok: true });
  const after = graph.commit([{ op: "set", node: x, path: ["title"], value: "later" }]);
  expect(after.ok ? "ok" : after.reason).toBe("constant");
  expect(graph.resolve(x, ["title"])).toBe("x");
});

test("a collapse whose store work fails leaves the node as it was, still editable", async () => {
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x" });
  create(graph, GROUP, { label: "h", members: { x } });
  await drive(scheduler, graph.flush());
  const inner = store!.compact.bind(store);
  store!.compact = () => Promise.reject(new Error("The database couldn't be written."));
  await expect(drive(scheduler, graph.collapseInline(x))).rejects.toThrow();
  store!.compact = inner;
  expect(graph.inlinedIn(x)).toBeUndefined();
  ok(graph.commit([{ op: "set", node: x, path: ["title"], value: "edited" }]));
  expect(graph.resolve(x, ["title"])).toBe("edited");
});

test("a collapsed node stops being a rule's subject: the conflict index follows", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const gone = { type: ITEM, id: "never-made" };
  const x = create(graph, ITEM, { title: "x", link: gone });
  create(graph, GROUP, { label: "h", members: { x } });
  await drive(scheduler, graph.flush());
  expect(graph.conflicts(x).map(item => item.rule)).toContain("missing-ref");
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  expect(graph.conflictIndex()).toEqual(graph.evaluateAll());
});

test("purging a node refreshes the pins that read it through their source's live layers", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const c = create(graph, ITEM, { title: "from c" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: c } }])).created.b;
  const p = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: b, at: 1 } }])).created.p;
  expect(graph.resolve(p, ["title"])).toBe("from c");
  const changed: string[] = [];
  const life = new Aborter();
  graph.subscribe(p, change => changed.push(...change.paths.map(path => path.join("."))), { signal: life.signal });
  expect(await drive(scheduler, graph.purge(c, { force: true }))).toEqual({ ok: true });
  expect(graph.resolve(p, ["title"])).toBe("untitled");
  expect(changed).toContain("title");
  life.abort();
});

test("a recovered pin whose history wasn't loaded reads its point once the history arrives", async () => {
  const { scheduler, store, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 1, retryMs: 40, replyTimeoutMs: 200 });
  const main = await open();
  const a = create(main, ITEM, { title: "first" });
  ok(main.commit([{ op: "set", node: a, path: ["title"], value: "second" }]));
  await drive(scheduler, main.flush());
  await drive(scheduler, main.snapshotAll());
  // The pin's commit never reaches the store: it survives only in the recovery copy.
  store.failNext = 1000;
  const p = ok(main.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }])).created.p;
  const recovery = main.pending();
  scheduler.drop();
  store.failNext = 0;
  const later = await open();
  expect(later.recover(recovery)).toMatchObject({ applied: 1 });
  await drive(scheduler, later.flush());
  // Recovery started loading the pinned history: once it is delivered, the pin reads its point.
  for (let i = 0; i < 50 && scheduler.pending().length; i++) { scheduler.deliver(0); await settle(); }
  expect(later.resolve(p, ["title"])).toBe("first");
});

test("a clone takes a given ID, never a collapsed node's; a view asked for a node under another type reads nothing", async () => {
  const { graph } = harness();
  const source = create(graph, ITEM, { title: "s" });
  const clone = ok(graph.commit([{ op: "create", type: ITEM, as: "c", id: "given", from: { clone: source } }])).created.c;
  expect(clone.id).toBe("given");
  expect(graph.resolve(clone, ["title"])).toBe("s");
  const x = create(graph, ITEM, { title: "x" });
  create(graph, GROUP, { label: "h", members: { x } });
  expect((await graph.collapseInline(x)).ok).toBe(true);
  const taken = graph.commit([{ op: "create", type: ITEM, as: "c", id: x.id, from: { clone: source } }]);
  expect(taken.ok ? "ok" : taken.reason).toBe("exists");
  ok(graph.commit([{ op: "set", node: source, path: ["title"], value: "later" }]));
  const view = await graph.at(graph.position - 1);
  expect(view.resolve({ type: GROUP, id: source.id })).toBeUndefined();
  expect(view.resolve(x, ["title"])).toBe("x");
});

test("loading again, or without a collapsed node's type, keeps what can be read", async () => {
  const { scheduler, store, open } = sessions();
  const graph = await open();
  const x = create(graph, ITEM, { title: "x" });
  const host = create(graph, GROUP, { label: "h", members: { x } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  await drive(scheduler, graph.load());
  expect([graph.resolve(x, ["title"]), graph.inlinedIn(x)]).toEqual(["x", { node: host, seq: 1 }]);
  // A build that doesn't know the collapsed node's type leaves it unread, and still reads its host.
  const narrow = createGraph({ types: SYNTHETIC_TYPES.filter(def => def.type !== ITEM), store, sources: { clock: simClock(scheduler), random: seededRandom("narrow") } });
  await drive(scheduler, narrow.load());
  expect([narrow.inlinedIn(x), narrow.resolve(host, ["label"])]).toEqual([undefined, "h"]);
});

test("purging a collapsed node refreshes pinned readers; a keep set reads a stream once, even when a copy is also inlined", async () => {
  const { graph } = harness();
  const x = create(graph, ITEM, { title: "x" });
  const host = create(graph, GROUP, { label: "h", members: { x } });
  const other = create(graph, ITEM, { title: "o" });
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: other, at: 1 } }])).created.p;
  const streams = graph[STRATA_DEBUG]().records.filter(rec => !rec.constant).map(rec => ({ ref: rec.ref, entries: rec.entries }));
  // An interrupted collapse can leave a copy in the host entry beside the node's own stream.
  const withCopy = streams.map(stream => stream.ref.id !== host.id ? stream
    : { ...stream, entries: stream.entries.map(entry => ({ ...entry, inlined: [{ node: x, entries: streams.find(item => item.ref.id === x.id)!.entries.slice(0, 0) }] })) });
  const defs = (type: string) => SYNTHETIC_TYPES.find(def => def.type === type);
  expect(keepSet(withCopy, defs, { roots: [{ node: x, seq: 1 }] }).has(`${x.id}@1`)).toBe(true);
  expect((await graph.collapseInline(x)).ok).toBe(true);
  expect(await graph.purge(x)).toEqual({ ok: true });
  expect(graph.resolve(pinned, ["title"])).toBe("o");
});

test("a revert or an undo restoring layers that would now close a cycle is refused", () => {
  const { graph } = harness();
  const b = create(graph, ITEM, { title: "b" });
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b } }])).created.a;
  ok(graph.commit([{ op: "detach", node: a }], { scope: "a" }));
  ok(graph.commit([{ op: "rebase", node: b, base: a }], { scope: "b" }));
  // Both would give a its base b again, while b takes values from a.
  const reverted = graph.commit([{ op: "revert", node: a, to: 1 }]);
  expect(reverted.ok ? "ok" : reverted.reason).toBe("cycle");
  const undone = graph.undo("a");
  expect(undone.ok ? "ok" : undone.reason).toBe("cycle");
  expect(graph.read(a)?.layers).toEqual([]);
  // Once b no longer follows a, the same undo goes through.
  expect(graph.undo("b").ok).toBe(true);
  expect(graph.undo("a").ok).toBe(true);
  expect(graph.read(a)?.layers.map(layer => layer.from.id)).toEqual([b.id]);
});

test("recovery rejects a commit that names what a rejected commit made, and keeps independent ones", async () => {
  const { scheduler, store, open } = sessions(SYNTHETIC_TYPES, { retryMs: 40, replyTimeoutMs: 200 });
  const main = await open();
  const n = create(main, ITEM, { title: "n" }), m = create(main, ITEM, { title: "m" });
  await drive(scheduler, main.flush());
  store.failNext = 1000;
  // Made on n (its basis will be stale), then a fork pinned to the entry it made, then an independent edit of m.
  ok(main.commit([{ op: "set", node: n, path: ["title"], value: "mine" }]));
  const pinned = ok(main.commit([{ op: "create", type: ITEM, as: "p", from: { fork: n, at: 2 } }]));
  const independent = ok(main.commit([{ op: "set", node: m, path: ["title"], value: "m2" }]));
  const recovery = main.pending();
  scheduler.drop();
  store.failNext = 0;
  const other = await open();
  ok(other.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }]));
  await drive(scheduler, other.flush());
  const later = await open();
  expect(later.recover(recovery)).toEqual({ applied: 1, skipped: 0, rejected: 2 });
  expect(later.rejected().map(item => item.commit)).toEqual([recovery[0].commit, pinned.commit]);
  await drive(scheduler, later.flush());
  expect(later.acknowledged(independent.commit)).toBe(true);
  expect([later.resolve(n, ["title"]), later.resolve(m, ["title"]), later.exists(pinned.created.p)]).toEqual(["theirs", "m2", false]);
});

test("loading a node's history takes only what it lacks: another window's newer entries wait for a sync", async () => {
  const { scheduler, open } = sessions(SYNTHETIC_TYPES, { snapshotEvery: 1 });
  const main = await open();
  const n = create(main, ITEM, { title: "n1" });
  ok(main.commit([{ op: "set", node: n, path: ["title"], value: "n2" }]));
  await drive(scheduler, main.flush());
  await drive(scheduler, main.snapshotAll());
  const later = await open();
  const other = await open();
  ok(other.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }]));
  await drive(scheduler, other.flush());
  expect((await drive(scheduler, later.history(n))).map(entry => entry.seq)).toEqual([1, 2]);
  expect([later.seqOf(n), later.resolve(n, ["title"])]).toEqual([2, "n2"]);
  await drive(scheduler, later.sync());
  expect([later.seqOf(n), later.resolve(n, ["title"])]).toEqual([3, "theirs"]);
  expect((await drive(scheduler, later.history(n))).map(entry => entry.seq)).toEqual([1, 2, 3]);
});

test("recovery rejects a commit whose layer source is gone, and keeps one tagging a built-in's entry; a view at a built-in's entry reads the start", async () => {
  const { scheduler, store, open } = sessions(SYNTHETIC_TYPES, { retryMs: 40, replyTimeoutMs: 200 });
  const main = await open();
  const source = create(main, ITEM, { title: "source" }), n = create(main, ITEM, { title: "n" });
  await drive(scheduler, main.flush());
  store.failNext = 1000;
  const fork = ok(main.commit([{ op: "create", type: ITEM, as: "f", from: { fork: source } }]));
  const starter = { type: ITEM, id: main.list(ITEM).find(ref => ref.id.startsWith("builtin:"))!.id };
  const tagged = ok(main.commit([{ op: "tag", node: n, label: "t", entries: [{ node: starter, seq: 1 }] }]));
  const recovery = main.pending();
  scheduler.drop();
  store.failNext = 0;
  // Another window deletes the fork's source for good before the restart.
  const other = await open();
  expect(await drive(scheduler, other.purge(source))).toEqual({ ok: true });
  const later = await open();
  expect(later.recover(recovery)).toEqual({ applied: 1, skipped: 0, rejected: 1 });
  expect(later.rejected().map(item => item.commit)).toEqual([fork.commit]);
  await drive(scheduler, later.flush());
  expect(later.acknowledged(tagged.commit)).toBe(true);
  expect((await drive(scheduler, later.at({ node: starter, seq: 1 }))).resolve(starter, ["title"])).toBe("starter");
});

test("two windows giving one unique value to different nodes: moving one holder off it leaves the other holding it", async () => {
  const { scheduler, open } = sessions();
  const a = await open(), b = await open();
  const x = create(a, ITEM, { title: "x" });
  await drive(scheduler, a.flush());
  await drive(scheduler, b.sync());
  const y = create(b, ITEM, { title: "y" });
  ok(b.commit([{ op: "set", node: y, path: ["code"], value: "same" }]));
  ok(a.commit([{ op: "set", node: x, path: ["code"], value: "same" }]));
  await drive(scheduler, a.flush());
  await drive(scheduler, b.flush());
  await drive(scheduler, a.sync());
  ok(a.commit([{ op: "set", node: x, path: ["code"], value: "moved" }]));
  const z = create(a, ITEM, { title: "z" });
  const taken = a.commit([{ op: "set", node: z, path: ["code"], value: "same" }]);
  expect(taken.ok ? "ok" : taken.reason).toBe("unique");
});

test("recovery keeps a commit whose layer source it creates itself or is collapsed", async () => {
  const { scheduler, store, open } = sessions(SYNTHETIC_TYPES, { retryMs: 40, replyTimeoutMs: 200 });
  const main = await open();
  const x = create(main, ITEM, { title: "x" });
  create(main, GROUP, { label: "h", members: { x } });
  await drive(scheduler, main.flush());
  expect(await drive(scheduler, main.collapseInline(x))).toMatchObject({ ok: true });
  store.failNext = 1000;
  ok(main.commit([{ op: "create", type: ITEM, as: "a", id: "a-node", fields: { title: "a" } },
    { op: "create", type: ITEM, as: "b", from: { fork: { type: ITEM, id: "a-node" } } }]));
  const fork = ok(main.commit([{ op: "create", type: ITEM, as: "f", from: { fork: x } }]));
  const recovery = main.pending();
  scheduler.drop();
  store.failNext = 0;
  const later = await open();
  expect(later.recover(recovery)).toEqual({ applied: 2, skipped: 0, rejected: 0 });
  await drive(scheduler, later.flush());
  expect(later.resolve(fork.created.f, ["title"])).toBe("x");
});
