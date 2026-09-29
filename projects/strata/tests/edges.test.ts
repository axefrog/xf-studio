/**
 * Edges of reading and committing: a resolver over states a graph wouldn't hold (a type it doesn't know, map keys in
 * a layer cycle, a pinned source out of reach, identity maps), read models asked about nodes that aren't there, a pin
 * whose source was purged, views rooted at a missing node, history loads racing a purge, commits and undos asked for
 * during a cycle, a compaction's busy window, and errors that aren't refusals.
 */
import { expect, test } from "bun:test";
import { Aborter, createGraph, defineRule, defineType, pathKey } from "strata";
import type { Layer, NodeRef, NodeState, TypeDef } from "strata";
import { Scheduler, seededRandom, settle, simClock, SYNTHETIC_TYPES } from "strata/testing";
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
