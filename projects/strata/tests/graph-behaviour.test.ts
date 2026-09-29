/**
 * Graph behaviour the mutation measurements found untested: retries and loads, pins and views at points (across
 * snapshots, collapses, syncs, acknowledgements that move positions, and rollbacks), change sets and subscriptions,
 * the edits that change nothing, conflicts and fixes, recovery, compaction and purges, the inspector, and the pure
 * pieces under them (resolution, read models, entry references, the keep set, roll-ups and upcasting).
 */
import { expect, test } from "bun:test";
import { Aborter, createGraph, defineRule, defineSink, defineSource, defineType, MemoryStore } from "strata";
import { Scheduler, seededRandom, settle, simClock, SimStore, STRATA_DEBUG, SYNTHETIC_TYPES } from "strata/testing";
import { GROUP, ITEM, SYNTHETIC_RULES as SYNTHETIC_RULES_FOR_TESTS } from "../src/testing/synthetic";
import { entryReferences, keepSet, nodeReferences, rollupDeltaStream } from "../src/compaction";
import { fold, upcast } from "../src/fold";
import { pathKey } from "strata";
import { create, drive, harness, ok } from "./helpers";

function sessions(extra: Record<string, unknown> = {}) {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const open = async (options: Record<string, unknown> = {}) => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock: simClock(scheduler), random: seededRandom(`f${session++}`) },
      signal: new Aborter().signal, ...extra, ...options });
    await drive(scheduler, graph.load());
    return graph;
  };
  return { scheduler, memory, store, open };
}

test("a failed append is retried 250 ms after it failed, by default", async () => {
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  store!.failNext = 1;
  create(graph, ITEM, { title: "a" });
  await drive(scheduler, graph.flush());
  expect(scheduler.log.map(line => line.split(" ").slice(0, 3).join(" "))).toEqual(["3 store load", "6 store append", "256 timer after", "259 store append"]);
});

test("a load writes a snapshot only for a node whose acknowledged entries since its last snapshot reach the interval", async () => {
  const { scheduler, memory, open } = sessions({ snapshotEvery: 3 });
  let graph = await open();
  const a = create(graph, ITEM, { title: "a1" });
  for (let i = 2; i <= 4; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  expect(memory.loadNow().nodes.find(node => node.ref.id === a.id)?.snapshot?.seq).toBe(4);
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a5" }]));
  await drive(scheduler, graph.flush());
  graph = await open();
  while (scheduler.deliver(0)) await settle();
  expect(memory.loadNow().nodes.find(node => node.ref.id === a.id)?.snapshot?.seq).toBe(4);
  expect(graph.resolve(a, ["title"])).toBe("a5");
});

test("a load folds a stored tail in entry order, whatever order the store returns it in", async () => {
  const { scheduler, store, open } = sessions();
  let graph = await open();
  const a = create(graph, ITEM, { title: "a1" });
  for (let i = 2; i <= 5; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  await drive(scheduler, graph.flush());
  const load = store.load.bind(store);
  store.load = async () => { const stored = await load(); return { ...stored, nodes: stored.nodes.map(node => ({ ...node, tail: [...node.tail].reverse() })) }; };
  graph = await open();
  expect(graph.resolve(a, ["title"])).toBe("a5");
  expect((await drive(scheduler, graph.history(a))).map(entry => entry.seq)).toEqual([1, 2, 3, 4, 5]);
});

test("a new pin needs the history of the sources its live layers read at the pinned point, and only when that point is before what is loaded", async () => {
  const { scheduler, open } = sessions({ snapshotEvery: 2 });
  let graph = await open();
  const b = create(graph, ITEM, { title: "b1" });
  for (let i = 2; i <= 5; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  // A follows B live from its creation; B moves on after A's first entry.
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b } }])).created.a;
  for (let i = 6; i <= 8; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  // One commit changes B and then A: A's entry is after B's snapshot position.
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "b9" }, { op: "set", node: a, path: ["tags", "k"], value: 1 }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  await drive(scheduler, graph.loadHistory(a));
  // At A's second entry, B is read at its snapshot: nothing more is needed.
  const late = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 2 } }])).created.p;
  expect(graph.resolve(late, ["title"])).toBe("b9");
  // At A's first entry, B is read before its snapshot.
  const refused = graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }]);
  expect(refused.ok ? "ok" : refused.reason).toBe("unloaded");
  await drive(scheduler, graph.loadHistory(b));
  const early = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 1 } }])).created.p;
  expect(graph.resolve(early, ["title"])).toBe("b5");
});

test("an entry held only by the snapshot a node loaded from has that snapshot's position", async () => {
  const { scheduler, open } = sessions({ snapshotEvery: 1 });
  let graph = await open();
  create(graph, ITEM, { title: "x" });
  const a = create(graph, ITEM, { title: "a" });
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  const pos = graph.posOf({ node: a, seq: 1 });
  graph = await open();
  expect(graph.posOf({ node: a, seq: 1 })).toBe(pos!);
  expect(pos).toBeGreaterThan(0);
});

test("a view at a constant's entry is at the start of the graph", async () => {
  const { graph } = harness();
  const x = create(graph, ITEM, { title: "x" });
  const starter = graph.list(ITEM).find(ref => ref.id !== x.id)!;
  const view = await graph.at({ node: starter, seq: 0 });
  expect([view.position, view.exists(x)]).toEqual([0, false]);
});

test("a view at an entry sees its whole commit when a node created earlier is changed later in that commit", async () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a1" });
  const b = create(graph, ITEM, { title: "b1" });
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "b2" }, { op: "set", node: a, path: ["title"], value: "a2" }]));
  const view = await graph.at({ node: b, seq: 2 });
  expect([view.resolve(a, ["title"]), view.resolve(b, ["title"])]).toEqual(["a2", "b2"]);
});

test("a view at an entry sees the rest of its commit inside a stream collapsed since", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const y = create(graph, ITEM, { title: "y1" });
  const x = create(graph, ITEM, { title: "x1" });
  create(graph, GROUP, { label: "h", members: { x } });
  ok(graph.commit([{ op: "set", node: y, path: ["title"], value: "y2" }, { op: "set", node: x, path: ["title"], value: "x2" }]));
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  ok(graph.commit([{ op: "set", node: y, path: ["title"], value: "y3" }]));
  const view = await drive(scheduler, graph.at({ node: y, seq: 2 }));
  expect([view.resolve(y, ["title"]), view.resolve(x, ["title"])]).toEqual(["y2", "x2"]);
  // Read as another type, the collapsed node isn't there.
  expect([view.exists(x), view.exists({ type: GROUP, id: x.id })]).toEqual([true, false]);
});

for (const subscribed of [false, true]) test(`a change set names each node's bookkeeping changes: created, name, layers, trashed, retracted, purged (${subscribed ? "with" : "without"} a subscriber)`, async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const life = new Aborter();
  const seen: string[] = [];
  if (subscribed) graph.subscribeAll(set => seen.push(set.cause), { signal: life.signal });
  const metaOf = (result: { ok: boolean; changes?: { nodes: readonly { node: { id: string }; meta: readonly string[] }[] } }) =>
    Object.fromEntries((result.changes?.nodes ?? []).map(item => [item.node.id, item.meta]));
  const made = ok(graph.commit([{ op: "create", type: ITEM, as: "b", fields: { title: "b" } }, { op: "create", type: ITEM, as: "a", fields: { title: "a" } }]));
  const { a, b } = made.created;
  expect(metaOf(made)).toEqual({ [a.id]: ["created"], [b.id]: ["created"] });
  expect(metaOf(ok(graph.commit([{ op: "rename", node: a, name: "A" }])))).toEqual({ [a.id]: ["name"] });
  expect(metaOf(ok(graph.commit([{ op: "rebase", node: a, base: b }])))[a.id]).toContain("layers");
  expect(metaOf(ok(graph.commit([{ op: "trash", node: b }])))).toEqual({ [b.id]: ["trashed"] });
  expect(metaOf(ok(graph.commit([{ op: "detach", node: a }])))[a.id]).toContain("layers");
  expect(metaOf(ok(graph.commit([{ op: "restore", node: b }])))).toEqual({ [b.id]: ["trashed"] });
  const c = ok(graph.commit([{ op: "create", type: ITEM, as: "c" }], { scope: "s" })).created.c;
  expect(metaOf(graph.undo("s"))).toEqual({ [c.id]: ["retracted"] });
  await drive(scheduler, graph.flush());
  const purges: Record<string, readonly string[]>[] = [];
  graph.subscribeAll(set => purges.push(Object.fromEntries(set.nodes.map(item => [item.node.id, item.meta]))), { signal: life.signal });
  expect(await drive(scheduler, graph.purge(b, { force: true }))).toEqual({ ok: true });
  expect(purges.at(-1)?.[b.id]).toEqual(["purged"]);
  if (subscribed) expect(seen.length).toBeGreaterThan(0);
  life.abort();
});

test("a node's subscription reports its own bookkeeping changes, in order, from creation to retraction and purge", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const life = new Aborter();
  const b = create(graph, ITEM, { title: "b" });
  const a = { type: ITEM, id: "a" };
  const seen: (readonly string[])[] = [];
  graph.subscribe(a, change => seen.push(change.meta), { signal: life.signal });
  ok(graph.commit([{ op: "create", type: ITEM, id: "a", fields: { title: "a" } }]));
  const both = ok(graph.commit([{ op: "rename", node: a, name: "A" }, { op: "rebase", node: a, base: b }, { op: "trash", node: a }]));
  expect(both.changes.nodes.find(item => item.node.id === a.id)?.meta).toEqual(["name", "layers", "trashed"]);
  ok(graph.commit([{ op: "restore", node: a }, { op: "detach", node: a }]));
  const c = { type: ITEM, id: "c" };
  const cs: (readonly string[])[] = [];
  graph.subscribe(c, change => cs.push(change.meta), { signal: life.signal });
  ok(graph.commit([{ op: "create", type: ITEM, id: "c" }], { scope: "s" }));
  graph.undo("s");
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.purge(a, { force: true }))).toEqual({ ok: true });
  expect(seen).toEqual([["created"], ["name", "layers", "trashed"], ["layers", "trashed"], ["purged"]]);
  expect(cs).toEqual([["created"], ["retracted"]]);
  life.abort();
});

test("without a subscriber, a commit's change set holds only bookkeeping, in node order; a subscriber never hears a change set with nothing in it", () => {
  const { graph } = harness();
  const made = ok(graph.commit(Array.from({ length: 6 }, (_, i) => ({ op: "create", type: ITEM, as: `n${i}` }) as never)));
  const ids = made.changes.nodes.map(item => item.node.id);
  expect(ids).toEqual(Object.values(made.created).map(ref => ref.id).sort());
  const first = made.created.n0;
  expect(ok(graph.commit([{ op: "set", node: first, path: ["title"], value: "x" }])).changes.nodes).toEqual([]);
  const life = new Aborter();
  const heard: number[] = [];
  graph.subscribeAll(set => heard.push(set.nodes.length), { signal: life.signal });
  ok(graph.commit([{ op: "tag", node: first, label: "t" }]));
  ok(graph.commit([{ op: "set", node: first, path: ["title"], value: "y" }]));
  expect(heard).toEqual([1]);
  life.abort();
  // Bookkeeping in its fixed order, with nothing demanded.
  const [second, third] = [made.created.n1, made.created.n2];
  const all = ok(graph.commit([{ op: "rename", node: second, name: "S" }, { op: "rebase", node: second, base: third }, { op: "trash", node: second }]));
  expect(all.changes.nodes.map(item => item.meta)).toEqual([["name", "layers", "trashed"]]);
});

test("a change set lists the nodes a commit reached through their sources in node order", () => {
  const { graph } = harness();
  const source = create(graph, ITEM, { title: "s" });
  const forks = Array.from({ length: 7 }, () => ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: source } }])).created.f);
  const life = new Aborter();
  const sets: string[][] = [];
  graph.subscribeAll(set => sets.push(set.nodes.map(item => item.node.id)), { signal: life.signal });
  ok(graph.commit([{ op: "set", node: source, path: ["title"], value: "t" }]));
  expect(sets).toEqual([[source, ...forks].map(ref => ref.id).sort()]);
  life.abort();
});

test("a fix refused for the blocking conflict it would add leaves its nodes' layers indexed as before", async () => {
  const rules = [
    defineRule({ id: "want-detach", owner: "t", subject: "*", severity: "warning", evaluate: (subject, context) =>
      context.resolve(subject, ["title"]) === "detach me" && context.layers(subject).length
        ? [{ sentence: "Detach it.", routes: [{ id: "detach", label: "Detach", consequence: "It stops following.", patch: [{ op: "detach", node: subject }] }] }] : [] }),
    defineRule({ id: "must-follow", owner: "t", subject: "*", severity: "blocking", blocks: ["*"], evaluate: (subject, context) =>
      context.resolve(subject, ["title"]) === "detach me" && !context.layers(subject).length ? [{ sentence: "It must follow something." }] : [] }),
  ];
  const { graph, scheduler } = harness({ store: true, extra: { rules } });
  await drive(scheduler, graph.load());
  const b = create(graph, ITEM, { title: "b" });
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b }, fields: { title: "detach me" } }])).created.a;
  const conflict = graph.conflicts().find(item => item.rule === "want-detach")!;
  const refused = graph.fix(conflict.id, "detach");
  expect(refused.ok ? "ok" : refused.reason).not.toBe("ok");
  expect(graph.read(a)?.layers.length).toBe(1);
  await drive(scheduler, graph.flush());
  const purge = await drive(scheduler, graph.purge(b));
  expect(purge.ok ? "ok" : purge.reason).toBe("dependents");
});

test("edits that change nothing are refused as empty: a reset of a field with no own value, a rename to the same name, a detach with no layers", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "rename", node: a, name: "A" }]));
  for (const edit of [{ op: "reset", node: a, path: ["tags", "zz"] }, { op: "rename", node: a, name: "A" }, { op: "detach", node: a }]) {
    const result = graph.commit([edit as never]);
    expect(result.ok ? "ok" : result.reason).toBe("empty");
  }
  const path = graph.commit([{ op: "set", node: a, path: ["tags", 5 as never], value: 1 }]);
  expect(path.ok ? "ok" : path.reason).toBe("path");
});

test("a commit names only the new nodes it was asked to name; a value stream's first entry holds its state", () => {
  const note = defineType({ type: "note", owner: "t", schema: "1", stream: "value", fields: { text: { kind: "value" } } });
  const { graph } = harness({ extra: { types: [...SYNTHETIC_TYPES, note] } });
  const a = create(graph, ITEM, { title: "a" });
  expect(ok(graph.commit([{ op: "create", type: ITEM }])).created).toEqual({});
  expect(ok(graph.commit([{ op: "create", type: ITEM, from: { clone: a } }])).created).toEqual({});
  const n = ok(graph.commit([{ op: "create", type: "note", as: "n", fields: { text: "one" } }])).created.n;
  expect(graph.resolve(n, ["text"])).toBe("one");
});

test("a commit asked for during a cycle is refused as busy before its edits are looked at", () => {
  const { graph } = harness();
  const life = new Aborter();
  const reasons: string[] = [];
  graph.subscribeAll(() => {
    for (const edits of [[], [{ op: "set", node: { type: ITEM, id: "nowhere" }, path: ["title"], value: 1 }]]) {
      const result = graph.commit(edits as never);
      reasons.push(result.ok ? "ok" : result.reason);
    }
  }, { signal: life.signal });
  create(graph, ITEM, { title: "a" });
  expect(reasons).toEqual(["busy", "busy"]);
  life.abort();
});

test("while a node is being collapsed, a commit touching it among others is refused as busy", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const y = create(graph, ITEM, { title: "y" });
  const x = create(graph, ITEM, { title: "x" });
  create(graph, GROUP, { label: "h", members: { x } });
  const collapsing = graph.collapseInline(x);
  const result = graph.commit([{ op: "set", node: y, path: ["title"], value: "y2" }, { op: "set", node: x, path: ["title"], value: "x2" }]);
  expect(result.ok ? "ok" : result.reason).toBe("busy");
  expect(await drive(scheduler, collapsing)).toMatchObject({ ok: true });
});

test("while a node is being collapsed, a commit that would reference it or pin one of its entries is refused as busy, and it still reads the same after", async () => {
  // Found by the simulation: a fork pinned to an entry of a node being collapsed was accepted, so the collapse moved a
  // stream that a second entry referenced, and the pin read nothing from it afterwards.
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x", tags: { k: 1 } });
  create(graph, GROUP, { label: "h", members: { x } });
  const collapsing = graph.collapseInline(x);
  const refused = [
    graph.commit([{ op: "create", type: ITEM, from: { fork: x, at: 1 } }]),
    graph.commit([{ op: "create", type: ITEM, fields: { title: "r", link: x } }]),
    graph.commit([{ op: "create", type: ITEM, fields: { title: "p", pin: { node: x, seq: 1 } } }]),
  ].map(result => result.ok ? "ok" : result.reason);
  expect(refused).toEqual(["busy", "busy", "busy"]);
  // Something that doesn't refer to it goes ahead.
  ok(graph.commit([{ op: "create", type: ITEM, fields: { title: "other" } }]));
  expect(await drive(scheduler, collapsing)).toMatchObject({ ok: true });
  expect(graph.resolve(x, ["title"])).toBe("x");
});

test("a deep clone creates its root first, then what it follows in the order it follows them", () => {
  const { graph } = harness();
  const t1 = create(graph, ITEM, { title: "t1" });
  const t2 = create(graph, ITEM, { title: "t2" });
  const root = create(graph, ITEM, { title: "r", link: t1, others: [t2] });
  const made = ok(graph.commit([{ op: "create", type: ITEM, as: "c", from: { clone: root, rules: { others: "follow" } } }]));
  const created = graph[STRATA_DEBUG]().records.filter(rec => rec.entries.some(entry => entry.commit === made.commit))
    .map(rec => [rec.entries[0].pos, graph.resolve(rec.ref, ["title"])] as const).sort((p, q) => p[0] - q[0]).map(item => item[1]);
  expect(created).toEqual(["r", "t1", "t2"]);
});

test("a view past a node's snapshot gives the node the snapshot's seq; before it, the seq of its last entry then", async () => {
  const { scheduler, open } = sessions({ snapshotEvery: 1 });
  let graph = await open();
  const a = create(graph, ITEM, { title: "a1" });
  for (let i = 2; i <= 3; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  const b = create(graph, ITEM, { title: "b" });
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "b2" }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  const snapshotAt = graph.posOf({ node: a, seq: 3 })!;
  graph = await open();
  expect((await drive(scheduler, graph.at(snapshotAt, [b]))).read(a)?.seq).toBe(3);
  expect((await drive(scheduler, graph.at({ node: b, seq: 1 }, [b]))).read(a)?.seq).toBe(3);
  const early = await drive(scheduler, graph.at(snapshotAt - 1));
  expect([early.read(a)?.seq, early.resolve(a, ["title"])]).toEqual([2, "a2"]);
});

test("a node reached twice in one change passes every path it gained on to its own dependents", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: a } }])).created.b;
  const d = ok(graph.commit([{ op: "create", type: ITEM, as: "d", from: { fork: b } }])).created.d;
  const e = ok(graph.commit([{ op: "create", type: ITEM, as: "e", layers: [{ from: d, role: "feed", paths: [["title"]] }] }])).created.e;
  expect([graph.resolve(d, ["title"]), graph.resolve(d, ["tags", "k"]), graph.resolve(e, ["title"])]).toEqual(["a", undefined, "a"]);
  // B is reached first as touched (its tags), then through A (its title).
  ok(graph.commit([{ op: "set", node: b, path: ["tags", "k"], value: 1 }, { op: "set", node: a, path: ["title"], value: "a2" }]));
  expect([graph.resolve(d, ["title"]), graph.resolve(d, ["tags", "k"]), graph.resolve(e, ["title"])]).toEqual(["a2", 1, "a2"]);
});

test("a field that isn't inherited isn't taken from a node's sources, nor are its map keys", () => {
  const kind = defineType({ type: "k", owner: "t", schema: "1", fields: { x: { kind: "value" }, y: { kind: "value", inherit: false },
    m: { kind: "map", of: { kind: "value" }, inherit: false } } });
  const { graph } = harness({ extra: { types: [kind] } });
  const s = ok(graph.commit([{ op: "create", type: "k", as: "s", fields: { x: 1, y: 1, m: { a: 1 } } }])).created.s;
  const f = ok(graph.commit([{ op: "create", type: "k", as: "f", from: { fork: s } }])).created.f;
  expect([graph.resolve(f, ["x"]), graph.resolve(f, ["y"]), graph.resolve(f, ["m"])]).toEqual([1, undefined, {}]);
});

test("a view read before a sync sees what the sync brought in below its point", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const y = create(theirs, ITEM, { title: "y1" });
  await drive(scheduler, theirs.flush());
  await drive(scheduler, mine.sync());
  ok(theirs.commit([{ op: "set", node: y, path: ["title"], value: "y2" }]));
  await drive(scheduler, theirs.flush());
  create(mine, ITEM, { title: "x" });
  await drive(scheduler, mine.flush());
  create(mine, ITEM, { title: "z" });
  await drive(scheduler, mine.flush());
  const point = (await drive(scheduler, mine.at("head"))).position - 1;
  expect((await drive(scheduler, mine.at(point))).resolve(y, ["title"])).toBe("y1");
  await drive(scheduler, mine.sync());
  expect((await drive(scheduler, mine.at(point))).resolve(y, ["title"])).toBe("y2");
});

test("a change is re-evaluated for everything that reaches it through a follows reference, even alongside references that don't follow", () => {
  const hop = (context: { resolve(ref: unknown, path?: unknown): unknown }, ref: unknown) => context.resolve(ref, ["link"]);
  const rules = [defineRule({ id: "bad-ahead", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) => {
    let at: unknown = hop(context, subject);
    for (let i = 0; i < 3 && at; i++) { if (context.resolve(at as never, ["title"]) === "bad") return [{ sentence: "Something ahead is bad." }]; at = hop(context, at); }
    return [];
  } })];
  const { graph } = harness({ extra: { rules } });
  const x = create(graph, ITEM, { title: "x" });
  const r = create(graph, ITEM, { title: "r", link: x, others: [x] });
  const q = create(graph, ITEM, { title: "q", link: r });
  expect(graph.conflicts()).toEqual([]);
  ok(graph.commit([{ op: "set", node: x, path: ["title"], value: "bad" }]));
  expect(graph.conflicts().flatMap(item => item.subjects.map(ref => ref.id)).sort()).toEqual([q.id, r.id].sort());
});

test("a session node past its ring keeps everything it holds acknowledged", () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", ring: 2, fields: { x: { kind: "value" } } });
  const { graph } = harness({ extra: { types: [...SYNTHETIC_TYPES, pose] } });
  const p = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 0 } }])).created.p;
  for (let i = 1; i <= 3; i++) ok(graph.commit([{ op: "set", node: p, path: ["x"], value: i }]));
  const rec = graph[STRATA_DEBUG]().records.find(item => item.ref.id === p.id)!;
  expect([rec.entries.length, rec.headSeq, rec.ackedSeq]).toEqual([2, 4, 4]);
});

test("loading again takes in another window's layer changes: what a node no longer takes values from can be purged", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const b = create(mine, ITEM, { title: "b" });
  const n = ok(mine.commit([{ op: "create", type: ITEM, as: "n", from: { fork: b } }])).created.n;
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.load());
  ok(theirs.commit([{ op: "detach", node: n }]));
  await drive(scheduler, theirs.flush());
  await drive(scheduler, mine.load());
  expect(mine.read(n)?.layers).toEqual([]);
  expect(await drive(scheduler, mine.purge(b))).toEqual({ ok: true });
});

test("a node's subscription hears what it follows only when asked to, and each report names only what changed then", () => {
  const { graph } = harness();
  const z = create(graph, ITEM, { title: "z" }), w = create(graph, ITEM, { title: "w" });
  const x = create(graph, ITEM, { title: "x", link: z }), y = create(graph, ITEM, { title: "y", link: w });
  const shared = create(graph, ITEM, { title: "shared" });
  const g = create(graph, GROUP, { label: "g" });
  const a = create(graph, ITEM, { title: "a" });
  const life = new Aborter();
  const plain: unknown[] = [], following: { paths: string[]; via: string[] }[] = [], grouped: string[][] = [];
  graph.subscribe(a, change => plain.push(change), { signal: life.signal });
  graph.subscribe(a, change => following.push({ paths: change.paths.map(path => path.join(".")), via: change.via.map(ref => ref.id) }), { signal: life.signal, follows: true });
  graph.subscribe(g, change => grouped.push(change.via.map(ref => ref.id)), { signal: life.signal, follows: true });
  const plainX: unknown[] = [];
  graph.subscribe(x, change => plainX.push(change), { signal: life.signal });
  // A starts to follow X (and through it Z); it shares Y's neighbour without following it.
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: x }, { op: "set", node: a, path: ["others"], value: [shared] }]));
  ok(graph.commit([{ op: "set", node: z, path: ["title"], value: "z2" }]));
  ok(graph.commit([{ op: "set", node: shared, path: ["title"], value: "s2" }]));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  expect([plain.length, plainX.length]).toEqual([2, 0]);
  expect(following).toEqual([{ paths: ["link", "others"], via: [] }, { paths: [], via: [z.id] }, { paths: ["title"], via: [] }]);
  // G follows X and Y, and through them Z and W: one change to both reports them in the order they are reached.
  ok(graph.commit([{ op: "set", node: g, path: ["members", "m1"], value: x }, { op: "set", node: g, path: ["members", "m2"], value: y }]));
  ok(graph.commit([{ op: "set", node: z, path: ["title"], value: "z3" }, { op: "set", node: w, path: ["title"], value: "w2" }]));
  expect(grouped.at(-1)).toEqual([w.id, z.id]);
  // No longer following anything, A hears nothing from Z.
  ok(graph.commit([{ op: "reset", node: a, path: ["link"] }]));
  const heard = following.length;
  ok(graph.commit([{ op: "set", node: z, path: ["title"], value: "z4" }]));
  expect(following.length).toBe(heard);
  expect(graph.referrers(x).map(item => item.node.id)).toEqual([g.id]);
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: shared }]));
  expect(graph.referrers(shared).map(item => [item.node.id, item.path.join(".")])).toEqual([[a.id, "link"], [a.id, "others"]]);
  life.abort();
});

test("follows references in a circle are each followed once", () => {
  const { graph } = harness();
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y", link: x });
  ok(graph.commit([{ op: "set", node: x, path: ["link"], value: y }]));
  const a = create(graph, ITEM, { title: "a", link: x });
  const life = new Aborter();
  const via: string[][] = [];
  graph.subscribe(a, change => via.push(change.via.map(ref => ref.id)), { signal: life.signal, follows: true });
  ok(graph.commit([{ op: "set", node: y, path: ["title"], value: "y2" }]));
  expect(via).toEqual([[y.id]]);
  life.abort();
});

test("a subscription asked for with a signal already aborted demands nothing and hears nothing", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const done = new Aborter();
  done.abort();
  const heard: unknown[] = [];
  graph.subscribeAll(set => heard.push(set), { signal: done.signal });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  expect([heard, graph.env.node(`effective:${a.id}`)?.active ?? false]).toEqual([[], false]);
});

test("a sink is handed only batches holding entries of its types", async () => {
  const calls: number[][] = [];
  const { graph, scheduler } = harness({ store: true, extra: { sinks: [{ def: defineSink("groups", [GROUP]), sink: { accept: entries => calls.push(entries.map(entry => entry.seq)) } }] } });
  await drive(scheduler, graph.load());
  create(graph, ITEM, { title: "a" });
  const g = create(graph, GROUP, { label: "g" });
  ok(graph.commit([{ op: "set", node: g, path: ["label"], value: "g2" }, { op: "rename", node: g, name: "G" }]));
  await drive(scheduler, graph.flush());
  expect(calls).toEqual([[1], [2, 3]]);
});

test("a store's failure reaches the caller with its own message", async () => {
  const { graph, store } = harness({ store: true });
  store!.load = () => Promise.reject(new Error("The disk is on fire."));
  await expect(graph.load()).rejects.toThrow("The disk is on fire.");
});

test("while a failed append waits to be retried, nothing more is sent; then the outbox is sent in order", async () => {
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  store!.failNext = 1;
  const a = create(graph, ITEM, { title: "a" });
  // The append fails; during the wait before its retry, another commit is made.
  scheduler.deliver(0);
  await settle();
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  await settle();
  await drive(scheduler, graph.flush());
  expect(scheduler.log.map(line => line.split(" ").slice(0, 3).join(" "))).toEqual(["3 store load", "6 store append", "256 timer after", "259 store append", "262 store append"]);
});

test("a graph whose life has ended sends nothing, and a flush doesn't wait for it", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  life.abort();
  const result = graph.commit([{ op: "create", type: ITEM, as: "a" }]);
  await drive(scheduler, graph.flush());
  expect([result.ok, scheduler.pending().length]).toEqual([true, 0]);
});

test("the reply to an append a sync dropped meanwhile sends what was committed since, and drops nothing more", async () => {
  const { scheduler, open } = sessions({ retryMs: 40, replyTimeoutMs: 200 });
  const mine = await open(), theirs = await open();
  const n = create(mine, ITEM, { title: "n" }), m = create(mine, ITEM, { title: "m" });
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  ok(theirs.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }]));
  await drive(scheduler, theirs.flush());
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  const stale = ok(mine.commit([{ op: "set", node: n, path: ["title"], value: "mine" }]));
  await settle();
  // The read comes back first: the commit in flight is dropped as stale.
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  const later = ok(mine.commit([{ op: "set", node: m, path: ["title"], value: "m2" }]));
  await drive(scheduler, syncing);
  for (let i = 0; i < 50 && scheduler.pending().length; i++) { scheduler.deliver(0); await settle(); }
  expect([mine.acknowledged(later.commit), mine.rejected().map(item => item.commit)]).toEqual([true, [stale.commit]]);
  expect(mine.resolve(m, ["title"])).toBe("m2");
});

test("an acknowledgement at positions another window took first moves the head there, tells the recovery copy, and snapshots at the interval", async () => {
  const { scheduler, memory, open } = sessions({ snapshotEvery: 2 });
  const mine = await open(), theirs = await open();
  create(theirs, ITEM, { title: "t1" });
  create(theirs, ITEM, { title: "t2" });
  await drive(scheduler, theirs.flush());
  const life = new Aborter();
  const pendingSeen: number[] = [];
  mine.subscribePending(pending => pendingSeen.push(pending.length), { signal: life.signal });
  const a = create(mine, ITEM, { title: "a1" });
  ok(mine.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  expect(mine.posOf({ node: a, seq: 2 })).toBe(2);
  expect((await drive(scheduler, mine.at(1))).resolve(a, ["title"])).toBe("a1");
  await drive(scheduler, mine.flush());
  // Views read before the acknowledgement are worked out again at the new positions.
  expect((await drive(scheduler, mine.at(1))).exists(a)).toBe(false);
  expect([mine.posOf({ node: a, seq: 1 }), mine.posOf({ node: a, seq: 2 }), (await drive(scheduler, mine.at("head"))).position]).toEqual([3, 4, 4]);
  expect(pendingSeen.at(-1)).toBe(0);
  while (scheduler.deliver(0)) await settle();
  expect(memory.loadNow().nodes.find(node => node.ref.id === a.id)?.snapshot?.seq).toBe(2);
  life.abort();
});

test("one append is in flight at a time: a commit made meanwhile waits its turn", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  create(graph, ITEM, { title: "a" });
  await settle();
  create(graph, ITEM, { title: "b" });
  await settle();
  expect(scheduler.pending().filter(event => event.label.startsWith("append")).length).toBe(1);
  const b = graph.list(ITEM).find(ref => graph.resolve(ref, ["title"]) === "b")!;
  // The first acknowledgement leaves the second commit's provisional position alone.
  scheduler.deliver(0);
  await settle();
  expect(graph.posOf({ node: b, seq: 1 })).toBe(2);
  await drive(scheduler, graph.flush());
  expect(scheduler.log.filter(line => line.includes("append")).length).toBe(2);
});

test("commits made while a sync's read is out, at positions the sync then fills, move above them as they are acknowledged", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const t = create(theirs, ITEM, { title: "t0" });
  await drive(scheduler, theirs.flush());
  await drive(scheduler, mine.sync());
  const m = create(mine, ITEM, { title: "m0" });
  await drive(scheduler, mine.flush());
  const head = mine.posOf({ node: m, seq: 1 })!;
  for (const title of ["t1", "t2"]) ok(theirs.commit([{ op: "set", node: t, path: ["title"], value: title }]));
  await drive(scheduler, theirs.flush());
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  for (const title of ["m1", "m2"]) ok(mine.commit([{ op: "set", node: m, path: ["title"], value: title }]));
  await settle();
  expect([mine.posOf({ node: m, seq: 2 }), mine.posOf({ node: m, seq: 3 })]).toEqual([head + 1, head + 2]);
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  await drive(scheduler, syncing);
  // The first commit is acknowledged above their entries; the second, still pending, moves above it.
  scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
  await settle();
  expect([mine.posOf({ node: m, seq: 2 }), mine.posOf({ node: m, seq: 3 }), mine.pending().flatMap(item => item.entries.map(entry => entry.pos))])
    .toEqual([head + 3, head + 4, [head + 4]]);
  await drive(scheduler, mine.flush());
  expect((await drive(scheduler, mine.range(0, head + 4))).map(entry => [entry.node.id === t.id ? "t" : "m", entry.pos]))
    .toEqual([["t", 1], ["m", 2], ["t", 3], ["t", 4], ["m", 5], ["m", 6]].map(([n, pos]) => [n, pos]));
});

// Recovery: a window's pending commits that never reached the store, re-applied by a later session.
async function recovery(extra: Record<string, unknown> = {}) {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const open = async () => {
    const life = new Aborter();
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock: simClock(scheduler), random: seededRandom(`r${session++}`) }, signal: life.signal, ...extra });
    await drive(scheduler, graph.load());
    return { graph, life };
  };
  /** Commits in a window that stops before anything it commits reaches the store; returns its recovery copy. */
  const unsent = async (commit: (graph: ReturnType<typeof createGraph>) => void) => {
    const { graph, life } = await open();
    commit(graph);
    const pending = graph.pending();
    life.abort();
    scheduler.drop();
    return pending;
  };
  return { scheduler, open, unsent };
}

test("recovery re-applies a commit whose basis still holds and tells subscribers; one whose basis moved on any of its nodes is rejected", async () => {
  const { scheduler, open, unsent } = await recovery();
  const { graph: first } = await open();
  const a = create(first, ITEM, { title: "a" }), b = create(first, ITEM, { title: "b" });
  await drive(scheduler, first.flush());
  const both = await unsent(graph => { ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a1" }, { op: "set", node: b, path: ["title"], value: "b1" }])); });
  const onlyA = await unsent(graph => { ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }])); });
  const { graph: theirs } = await open();
  ok(theirs.commit([{ op: "set", node: b, path: ["title"], value: "theirs" }]));
  await drive(scheduler, theirs.flush());
  const { graph } = await open();
  const life = new Aborter();
  const causes: string[] = [];
  graph.subscribeAll(set => causes.push(set.cause), { signal: life.signal });
  expect(graph.recover(both)).toEqual({ applied: 0, skipped: 0, rejected: 1 });
  expect(graph.recover(onlyA)).toEqual({ applied: 1, skipped: 0, rejected: 0 });
  expect([causes, graph.resolve(a, ["title"])]).toEqual([["recover"], "a2"]);
  await drive(scheduler, graph.flush());
  life.abort();
});

test("recovery rejects a commit naming an entry its node no longer has, and keeps one naming an entry it makes itself or the node's latest", async () => {
  const { scheduler, open, unsent } = await recovery();
  const { graph: first } = await open();
  const a = create(first, ITEM, { title: "a" }), gone = create(first, ITEM, { title: "gone" });
  await drive(scheduler, first.flush());
  const pinsGone = await unsent(graph => { create(graph, ITEM, { title: "p", pin: { node: gone, seq: 1 } }); });
  const pinsOwn = await unsent(graph => { ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }, { op: "create", type: ITEM, fields: { pin: { node: a, seq: 2 } } }])); });
  const pinsLatest = await unsent(graph => { create(graph, ITEM, { title: "q", pin: { node: a, seq: 1 } }); });
  const { graph: theirs } = await open();
  expect(await drive(scheduler, theirs.purge(gone, { force: true }))).toEqual({ ok: true });
  const { graph } = await open();
  expect([graph.recover(pinsGone), graph.recover(pinsLatest), graph.recover(pinsOwn)])
    .toEqual([{ applied: 0, skipped: 0, rejected: 1 }, { applied: 1, skipped: 0, rejected: 0 }, { applied: 1, skipped: 0, rejected: 0 }]);
});

test("recovery rejects a commit whose new layers take values from a node that is gone", async () => {
  const { scheduler, open, unsent } = await recovery();
  const { graph: first } = await open();
  const s = create(first, ITEM, { title: "s" }), n = create(first, ITEM, { title: "n" });
  await drive(scheduler, first.flush());
  const pending = await unsent(graph => {
    ok(graph.commit([{ op: "create", type: ITEM, from: { fork: s } }]));
    ok(graph.commit([{ op: "create", type: ITEM, layers: [{ from: s, role: "feed", paths: [["title"]] }] }]));
    ok(graph.commit([{ op: "rebase", node: n, base: s }]));
  });
  const { graph: theirs } = await open();
  expect(await drive(scheduler, theirs.purge(s, { force: true }))).toEqual({ ok: true });
  const { graph } = await open();
  expect(graph.recover(pending)).toEqual({ applied: 0, skipped: 0, rejected: 3 });
});

test("recovery skips an entry of a type this build doesn't know", async () => {
  const { open } = await recovery();
  const { graph } = await open();
  const ghost = { type: "ghost", id: "g1" };
  const entry = { node: ghost, seq: 1, pos: 1, commit: "c-ghost", actor: "local", actorSeq: 1, at: 0, schema: "1", op: { kind: "create", state: { name: "", own: {}, layers: [], trashed: false, retracted: false } }, meta: { basis: [] } };
  expect(graph.recover([{ commit: "c-ghost", entries: [entry as never], expect: [["g1", 0]] }])).toEqual({ applied: 1, skipped: 0, rejected: 0 });
  expect(graph.read(ghost)).toBeUndefined();
});

test("a sync that drops pending commits undoes them whole: in order, their new nodes gone and their unique values free, and says so", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const n = create(mine, ITEM, { title: "n" }), other = create(mine, ITEM, { title: "other" });
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  const theirCommit = ok(theirs.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }])).commit;
  await drive(scheduler, theirs.flush());
  const life = new Aborter();
  const sets: { cause: string; commit: string; meta: Record<string, readonly string[]> }[] = [];
  mine.subscribeAll(set => sets.push({ cause: set.cause, commit: set.commit, meta: Object.fromEntries(set.nodes.map(item => [item.node.id, item.meta])) }), { signal: life.signal });
  const pendingSeen: number[] = [];
  mine.subscribePending(pending => pendingSeen.push(pending.length), { signal: life.signal });
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  const first = ok(mine.commit([{ op: "set", node: other, path: ["title"], value: "o2" }, { op: "set", node: n, path: ["title"], value: "mine" }]));
  const second = ok(mine.commit([{ op: "create", type: ITEM, as: "k", fields: { code: "unique-k" } }]));
  const k = second.created.k;
  await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  await drive(scheduler, syncing);
  expect(mine.rejected().map(item => item.commit)).toEqual([first.commit, second.commit]);
  expect([mine.acknowledged(theirCommit), sets.some(set => set.cause === "sync" && set.commit === `sync:${theirCommit}`)]).toEqual([true, true]);
  expect([mine.read(k), mine.pending().length, pendingSeen.at(-1)]).toEqual([undefined, 0, 0]);
  expect(sets.find(set => set.cause === "rollback")?.meta[k.id]).toEqual(["purged"]);
  // Its ID is free again.
  ok(mine.commit([{ op: "create", type: ITEM, id: k.id }]));
  expect(mine.undoStack()).not.toContain(second.commit);
  ok(mine.commit([{ op: "create", type: ITEM, fields: { code: "unique-k" } }]));
  life.abort();
});

test("recovery sends back, unapplied, a commit that a snapshot covers on any of its nodes", async () => {
  const { scheduler, open } = await recovery({ snapshotEvery: 3 });
  const { graph: first, life } = await open();
  const a = create(first, ITEM, { title: "a" }), b = create(first, ITEM, { title: "b" });
  await drive(scheduler, first.flush());
  // The commit reaches the store, but its window stops before the reply.
  const both = ok(first.commit([{ op: "set", node: a, path: ["title"], value: "a1" }, { op: "set", node: b, path: ["title"], value: "b1" }]));
  const copy = first.pending();
  for (let i = 0; i < 10 && !scheduler.pending().some(event => event.label.startsWith("append")); i++) await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
  life.abort();
  scheduler.drop();
  // Another window moves A past a snapshot; B keeps its tail.
  const { graph: theirs } = await open();
  for (let i = 2; i <= 3; i++) ok(theirs.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  await drive(scheduler, theirs.flush());
  while (scheduler.deliver(0)) await settle();
  const { graph } = await open();
  expect(graph.recover(copy)).toEqual({ applied: 1, skipped: 0, rejected: 0 });
  await drive(scheduler, graph.flush());
  expect([graph.acknowledged(both.commit), graph.rejected()]).toEqual([true, []]);
});

test("a sync takes in a node another window compacted past what this graph had read by reading its stream again", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const x = create(mine, ITEM, { title: "x1" }), y = create(mine, ITEM, { title: "y1" });
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  for (let i = 2; i <= 4; i++) ok(theirs.commit([{ op: "set", node: x, path: ["tags", `k${i}`], value: i }]));
  ok(theirs.commit([{ op: "set", node: y, path: ["title"], value: "y2" }]));
  await drive(scheduler, theirs.flush());
  theirs.forgetHistory();
  expect(await drive(scheduler, theirs.compact(x, { bucketMs: 60_000 }))).toMatchObject({ ok: true, before: 4, after: 2 });
  const life = new Aborter();
  const changed: string[][] = [];
  mine.subscribeAll(set => changed.push(set.nodes.map(item => item.node.id).sort()), { signal: life.signal });
  expect(await drive(scheduler, mine.sync())).toMatchObject({ applied: expect.any(Number) });
  expect([mine.resolve(x, ["tags", "k4"]), mine.resolve(x, ["tags", "k2"]), mine.resolve(y, ["title"])]).toEqual([4, 2, "y2"]);
  expect((await drive(scheduler, mine.history(x))).map(entry => entry.seq)).toEqual((await drive(scheduler, theirs.history(x))).map(entry => entry.seq));
  expect(changed.flat()).toContain(x.id);
  ok(mine.commit([{ op: "set", node: x, path: ["title"], value: "x2" }]));
  await drive(scheduler, mine.flush());
  expect(mine.rejected()).toEqual([]);
  life.abort();
});

test("a sync on a graph without a store applies nothing; with pending commits it waits for them first", async () => {
  expect(await harness().graph.sync()).toEqual({ applied: 0 });
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  store!.failNext = 1;
  create(graph, ITEM, { title: "a" });
  await drive(scheduler, graph.sync());
  expect(graph.pending()).toEqual([]);
});

test("snapshots: a second pass writes nothing new, a pass waits for pending commits, and a failed write is tried again", async () => {
  const { graph, scheduler, store } = harness({ store: true, extra: { snapshotEvery: 1000 } });
  await drive(scheduler, graph.load());
  create(graph, ITEM, { title: "a" });
  expect(await drive(scheduler, graph.snapshotAll())).toBe(1);
  expect(await drive(scheduler, graph.snapshotAll())).toBe(0);
  const put = store!.putSnapshot.bind(store);
  let failures = 1;
  store!.putSnapshot = snapshot => failures-- > 0 ? Promise.reject(new Error("full")) : put(snapshot);
  create(graph, ITEM, { title: "b" });
  expect(await drive(scheduler, graph.snapshotAll())).toBe(1);
  while (scheduler.deliver(0)) await settle();
  expect(await drive(scheduler, graph.snapshotAll())).toBe(1);
});

// A session view pinned to this window's own pending entries: its point moves when the store places them, and goes
// when a sync drops them.
const pinView = defineType({ type: "pinview", owner: "t", schema: "1", persistence: "session", compatible: [ITEM], fields: { title: { kind: "value" }, note: { kind: "value" } } });

test("a pin to a pending entry reads its point anew when the store places the entry above another window's entries", async () => {
  const { scheduler, open } = sessions({ types: [...SYNTHETIC_TYPES, pinView] });
  const mine = await open(), theirs = await open();
  const t = create(mine, ITEM, { title: "t0" });
  const m = ok(mine.commit([{ op: "create", type: ITEM, as: "m", from: { fork: t } }])).created.m;
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  for (const title of ["t1", "t2"]) ok(theirs.commit([{ op: "set", node: t, path: ["title"], value: title }]));
  await drive(scheduler, theirs.flush());
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  ok(mine.commit([{ op: "set", node: m, path: ["tags", "k"], value: 1 }]));
  await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  await drive(scheduler, syncing);
  const v = ok(mine.commit([{ op: "create", type: "pinview", as: "v", layers: [{ from: m, role: "base", paths: "*", at: { node: m, seq: 2 } }] }])).created.v;
  expect(mine.resolve(v, ["title"])).toBe("t1");
  await drive(scheduler, mine.flush());
  expect(mine.resolve(v, ["title"])).toBe("t2");
});

test("a pin to a pending entry that a sync drops reads nothing there any more", async () => {
  const { scheduler, open } = sessions({ types: [...SYNTHETIC_TYPES, pinView] });
  const mine = await open(), theirs = await open();
  const n = create(mine, ITEM, { title: "n" });
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  ok(theirs.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }]));
  await drive(scheduler, theirs.flush());
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  ok(mine.commit([{ op: "set", node: n, path: ["title"], value: "mine" }]));
  const v = ok(mine.commit([{ op: "create", type: "pinview", as: "v", layers: [{ from: n, role: "base", paths: "*", at: { node: n, seq: 2 } }] }])).created.v;
  expect(mine.resolve(v, ["title"])).toBe("mine");
  await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  await drive(scheduler, syncing);
  expect(mine.resolve(v, ["title"])).toBe("theirs");
});

test("a pin to a pending entry the store refuses as stale reads nothing there any more", async () => {
  const { scheduler, open } = sessions({ types: [...SYNTHETIC_TYPES, pinView] });
  const mine = await open(), theirs = await open();
  const n = create(mine, ITEM, { title: "n" });
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  ok(theirs.commit([{ op: "set", node: n, path: ["title"], value: "theirs" }]));
  await drive(scheduler, theirs.flush());
  ok(mine.commit([{ op: "set", node: n, path: ["title"], value: "mine" }]));
  const v = ok(mine.commit([{ op: "create", type: "pinview", as: "v", layers: [{ from: n, role: "base", paths: "*", at: { node: n, seq: 2 } }] }])).created.v;
  expect(mine.resolve(v, ["title"])).toBe("mine");
  await drive(scheduler, mine.flush());
  expect([mine.rejected().length, mine.resolve(v, ["title"])]).toEqual([1, undefined]);
});

test("a sync bringing in entries below a point a pin already read makes the pin read them, whatever other layers it has", async () => {
  const { scheduler, open } = sessions({ types: [...SYNTHETIC_TYPES, pinView] });
  const mine = await open(), theirs = await open();
  const t = create(mine, ITEM, { title: "t0" });
  const x = create(mine, ITEM, { title: "x" });
  const m = ok(mine.commit([{ op: "create", type: ITEM, as: "m", from: { fork: t } }])).created.m;
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  const theirCommit = ok(theirs.commit([{ op: "set", node: t, path: ["title"], value: "t1" }])).commit;
  await drive(scheduler, theirs.flush());
  // Acknowledged above their entry, which this graph hasn't read yet.
  ok(mine.commit([{ op: "set", node: m, path: ["tags", "k"], value: 1 }]));
  await drive(scheduler, mine.flush());
  const v = ok(mine.commit([{ op: "create", type: "pinview", as: "v", layers: [
    { from: m, role: "base", paths: "*", at: { node: m, seq: 2 } }, { from: x, role: "feed", paths: [["note"]] }] }])).created.v;
  expect(mine.resolve(v, ["title"])).toBe("t0");
  const life = new Aborter();
  const labels: string[] = [];
  mine.subscribeAll(set => { if (set.nodes.some(item => item.node.id === v.id)) labels.push(set.commit); }, { signal: life.signal });
  await drive(scheduler, mine.sync());
  expect([mine.resolve(v, ["title"]), labels]).toEqual(["t1", [`sync-pins:${theirCommit}`]]);
  life.abort();
});

test("a pending commit whose entries straddle the store's head moves above it whole", async () => {
  const { scheduler, open } = sessions();
  const mine = await open(), theirs = await open();
  const t = create(theirs, ITEM, { title: "t0" });
  await drive(scheduler, theirs.flush());
  await drive(scheduler, mine.sync());
  const m = create(mine, ITEM, { title: "m0" });
  await drive(scheduler, mine.flush());
  ok(theirs.commit([{ op: "set", node: t, path: ["title"], value: "t1" }]));
  await drive(scheduler, theirs.flush());
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) { scheduler.deliver(0); await settle(); }
  ok(mine.commit([{ op: "set", node: m, path: ["title"], value: "m1" }]));
  ok(mine.commit([{ op: "set", node: m, path: ["title"], value: "m2" }, { op: "set", node: m, path: ["tags", "k"], value: 1 }]));
  await settle();
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await settle();
  await drive(scheduler, syncing);
  scheduler.deliver(scheduler.pending().findIndex(event => event.label.startsWith("append")));
  await settle();
  // The second commit's first entry was at the head the acknowledgement reached, its second above it: both move.
  expect([2, 3, 4].map(seq => mine.posOf({ node: m, seq }))).toEqual([4, 6, 7]);
});

test("a pending commit a sync's head overtook moves above it at the next acknowledgement, and pins to it read their new point", async () => {
  const { scheduler, store, open } = sessions({ types: [...SYNTHETIC_TYPES, pinView], retryMs: 40, replyTimeoutMs: 200 });
  const mine = await open(), theirs = await open();
  const t = create(mine, ITEM, { title: "t0" });
  const m = ok(mine.commit([{ op: "create", type: ITEM, as: "m", from: { fork: t } }])).created.m;
  await drive(scheduler, mine.flush());
  await drive(scheduler, theirs.sync());
  const appendOf = (commit: string) => scheduler.pending().findIndex(event => event.label === `append ${commit.slice(0, 8)}`);
  // Mine's read goes out first; then its first commit is written at the position it gave it, but the reply is lost.
  const syncing = mine.sync();
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "changes"); i++) await settle();
  store.loseNext = 1;
  const first = ok(mine.commit([{ op: "set", node: m, path: ["tags", "a"], value: 1 }])).commit;
  ok(mine.commit([{ op: "set", node: m, path: ["tags", "b"], value: 1 }]));
  await settle();
  scheduler.deliver(appendOf(first));
  await settle();
  // Theirs writes two entries next, where mine placed its second commit; mine's read then brings them in.
  for (const title of ["t1", "t2"]) {
    const commit = ok(theirs.commit([{ op: "set", node: t, path: ["title"], value: title }])).commit;
    await settle();
    scheduler.deliver(appendOf(commit));
    await settle();
  }
  scheduler.deliver(scheduler.pending().findIndex(event => event.label === "changes"));
  await drive(scheduler, syncing);
  const v = ok(mine.commit([{ op: "create", type: "pinview", as: "v", layers: [{ from: m, role: "base", paths: "*", at: { node: m, seq: 3 } }] }])).created.v;
  expect([mine.posOf({ node: m, seq: 2 }), mine.posOf({ node: m, seq: 3 }), mine.resolve(v, ["title"])]).toEqual([3, 4, "t1"]);
  // The first commit's retry is answered as a duplicate at its own position: the second moves above their entries.
  for (let i = 0; i < 50 && !mine.acknowledged(first); i++) { scheduler.deliver(0); await settle(); }
  expect([mine.posOf({ node: m, seq: 2 }), mine.posOf({ node: m, seq: 3 }), mine.resolve(v, ["title"])]).toEqual([3, 7, "t2"]);
});

test("an undo names every entry of the step it reverses, in order; a redo leaves nothing more to redo", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }, { op: "set", node: a, path: ["tags", "k"], value: 1 }]));
  ok(graph.undo());
  const entries = graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === a.id)!.entries;
  const undo = entries.at(-1)!.op as unknown as { kind: string; reverses: { seq: number }[] };
  expect([undo.kind, undo.reverses.map(item => item.seq)]).toEqual(["compensate", [2, 3]]);
  ok(graph.redo());
  const again = graph.redo();
  expect(again.ok ? "ok" : again.reason).toBe("nothing-to-undo");
});

test("a step whose first entry a session node's ring has dropped can't be undone", () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", ring: 2, fields: { x: { kind: "value" } } });
  const { graph } = harness({ extra: { types: [...SYNTHETIC_TYPES, pose] } });
  const p = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 0 } }], { scope: "s" })).created.p;
  for (let i = 1; i <= 3; i++) ok(graph.commit([{ op: "set", node: p, path: ["x"], value: i }], { scope: "s" }));
  // Undoing the last step adds an entry, and the ring keeps two: the step before now starts in the ring's base.
  ok(graph.undo("s"));
  const second = graph.undo("s");
  expect([second.ok ? "ok" : second.reason, graph.resolve(p, ["x"])]).toEqual(["unloaded", 2]);
});

test("conflicts: one conflict however its subjects are listed, kept while any subject still reports it; keys tell a rule's conflicts apart; rules see only their types; gone nodes report nothing", () => {
  const rules = [
    defineRule({ id: "pair", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) => {
      const partner = context.resolve(subject, ["link"]) as { type: string; id: string } | undefined;
      return context.resolve(subject, ["title"]) === "pair" && partner ? [{ subjects: [subject, partner], sentence: "A pair." }] : [];
    } }),
    defineRule({ id: "two", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) =>
      context.resolve(subject, ["title"]) === "two" ? [{ key: "a", sentence: "One." }, { key: "b", sentence: "Two." }] : [] }),
    defineRule({ id: "groups", owner: "t", subject: [GROUP], severity: "notice" as never, evaluate: () => [{ sentence: "A group." }] }),
  ];
  const { graph } = harness({ extra: { rules } });
  const ids = Array.from({ length: 6 }, (_, i) => create(graph, ITEM, { title: `n${i}` }));
  // Each pair lists itself first, so the two members list the subjects in opposite orders.
  const [a, b] = ids;
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: b }, { op: "set", node: b, path: ["link"], value: a },
    { op: "set", node: a, path: ["title"], value: "pair" }, { op: "set", node: b, path: ["title"], value: "pair" }]));
  const byRule = (rule: string) => graph.conflicts().filter(item => item.rule === rule);
  expect(byRule("pair").length).toBe(1);
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "solo" }]));
  expect(byRule("pair").length).toBe(1);
  ok(graph.commit([{ op: "set", node: ids[2], path: ["title"], value: "two" }]));
  expect(byRule("two").length).toBe(2);
  expect(byRule("groups").length).toBe(0);
  ok(graph.commit([{ op: "create", type: GROUP, as: "g" }], { scope: "s" }));
  expect(byRule("groups").length).toBe(1);
  ok(graph.undo("s"));
  expect(byRule("groups").length).toBe(0);
});

test("a conflict reported by two subjects stays while either still reports it", () => {
  const rules = [defineRule({ id: "with", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) => {
    const title = String(context.resolve(subject, ["title"]));
    return title.startsWith("with:") ? [{ subjects: [subject, { type: ITEM, id: title.slice(5) }], sentence: "Named together." }] : [];
  } })];
  const { graph } = harness({ extra: { rules } });
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `with:${b.id}` }, { op: "set", node: b, path: ["title"], value: `with:${a.id}` }]));
  expect(graph.conflicts().length).toBe(1);
  ok(graph.commit([{ op: "set", node: a, path: ["tags", "k"], value: 1 }]));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "solo" }]));
  expect(graph.conflicts().length).toBe(1);
  expect(graph.conflicts(b).length).toBe(1);
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "solo" }]));
  expect(graph.conflicts().length).toBe(0);
});

test("conflicts come worst first, then by ID; a blocking conflict refuses the actions it blocks; a fix is judged only by the blocking conflicts it adds", () => {
  let leaveId = "?";
  const rules = [
    defineRule({ id: "many", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) =>
      context.resolve(subject, ["title"]) === "many" ? Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, sentence: `Warning ${i}.`,
        routes: [{ id: "leave", label: "Leave it", consequence: "", patch: [{ op: "acknowledge", conflict: leaveId } as never] },
          { id: "warn", label: "Warn", consequence: "", patch: [{ op: "set", node: subject, path: ["tags", "warn"], value: 1 }] }] })) : [] }),
    defineRule({ id: "warned", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) =>
      context.resolve(subject, ["tags", "warn"]) === 1 ? [{ sentence: "Warned." }] : [] }),
    ...SYNTHETIC_RULES_FOR_TESTS,
  ];
  const { graph } = harness({ extra: { rules } });
  const a = create(graph, ITEM, { title: "many" });
  // A fresh graph fixes a conflict it hasn't listed yet.
  const first = graph.evaluateAll().find(item => item.rule === "many")!;
  // Two nodes following each other: a blocking conflict on both.
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y", link: x });
  ok(graph.commit([{ op: "set", node: x, path: ["link"], value: y }]));
  const listed = graph.conflicts();
  expect(listed.map(item => item.severity)).toEqual(["blocking", ...Array(6).fill("warning")]);
  const warnings = listed.filter(item => item.rule === "many").map(item => item.id);
  expect(warnings).toEqual([...warnings].sort());
  const blocked = graph.commit([{ op: "set", node: x, path: ["title"], value: "x2" }], { action: "item.edit" });
  expect(blocked.ok ? "ok" : blocked.reason).toBe("conflict");
  expect([graph.blockingFor(x, "item.edit")?.rule, graph.blockingFor(x, "other"), graph.blockingFor(a, "item.edit")]).toEqual(["follow-cycle", undefined, undefined]);
  // A fix that adds only a warning goes through while an older blocking conflict stands.
  expect(graph.fix(first.id, "warn").ok).toBe(true);
  expect(graph.conflicts(a).some(item => item.rule === "warned")).toBe(true);
  // A route that acknowledges its conflict quiets it.
  const target = graph.conflicts(a).find(item => item.rule === "many")!;
  leaveId = target.id;
  ok(graph.commit([{ op: "set", node: a, path: ["tags", "touch"], value: 1 }]));
  const left = graph.fix(target.id, "leave");
  expect(left.ok ? "ok" : left.reason).toBe("empty");
  expect(graph.conflicts(a).some(item => item.id === target.id)).toBe(false);
});

test("a source is recorded only when it keeps a ring: created under its name, then set", () => {
  const { graph } = harness();
  const ringless = defineSource<number>("plain"), kept = defineSource<number>("kept", { ring: 4 });
  graph.record(ringless, 1);
  graph.record(kept, 1);
  graph.record(kept, 2);
  expect([graph.ring(graph.sourceNode(ringless)), graph.read(graph.sourceNode(ringless))]).toEqual([[], undefined]);
  expect(graph.ring(graph.sourceNode(kept)).map(entry => entry.op.kind)).toEqual(["create", "state"]);
  expect(graph.read(graph.sourceNode(kept))?.name).toBe("kept");
});

test("a graph fixes a conflict before anything has listed its conflicts", () => {
  const rules = [defineRule({ id: "odd", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) =>
    context.resolve(subject, ["title"]) === "odd" ? [{ sentence: "Odd.", routes: [{ id: "even", label: "Even", consequence: "", patch: [{ op: "set", node: subject, path: ["title"], value: "even" }] }] }] : [] })];
  const { graph } = harness({ extra: { rules } });
  const a = create(graph, ITEM, { title: "odd" });
  const conflict = graph.evaluateAll().find(item => item.rule === "odd")!;
  expect(graph.fix(conflict.id, "even").ok).toBe(true);
  expect(graph.resolve(a, ["title"])).toBe("even");
});

test("compaction keeps what the Undo stacks can still reach, and what another window pins even before this one has read it", async () => {
  const { scheduler, memory, open } = sessions();
  const mine = await open();
  const a = create(mine, ITEM, { title: "a1" });
  for (let i = 2; i <= 4; i++) ok(mine.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  await drive(scheduler, mine.flush());
  expect(await drive(scheduler, mine.compact(a))).toMatchObject({ ok: true, before: 4, after: 4 });
  ok(mine.undo());
  expect(mine.resolve(a, ["title"])).toBe("a3");
  await drive(scheduler, mine.flush());
  const theirs = await open();
  ok(theirs.commit([{ op: "create", type: ITEM, fields: { pin: { node: a, seq: 2 } } }]));
  await drive(scheduler, theirs.flush());
  mine.forgetHistory();
  expect(await drive(scheduler, mine.compact(a))).toMatchObject({ ok: true });
  expect(memory.readStreamNow(a).map(entry => entry.seq)).toContain(2);
});

test("compaction reads every stream whole first: a pin held only in another node's snapshot keeps its entry", async () => {
  const { scheduler, memory, open } = sessions({ snapshotEvery: 1 });
  let graph = await open();
  const a = create(graph, ITEM, { title: "a1" });
  for (let i = 2; i <= 4; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }]));
  const p = create(graph, ITEM, { title: "p", pin: { node: a, seq: 2 } });
  ok(graph.commit([{ op: "set", node: p, path: ["title"], value: "p2" }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  expect(await drive(scheduler, graph.compact(a))).toMatchObject({ ok: true });
  expect(memory.readStreamNow(a).map(entry => entry.seq)).toContain(2);
});

test("after compaction, views are worked out again, a snapshot is due, and commits may name the entries that survive but not those rolled up meanwhile", async () => {
  const { graph, scheduler, memory } = harness({ store: true, extra: { snapshotEvery: 1000 } });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a1" });
  const one = create(graph, ITEM, { title: "one" });
  // Two seconds apart: one bucket of a minute, but not of a second.
  for (let i = 2; i <= 4; i++) { scheduler.advance(2000); ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `a${i}` }])); }
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph.forgetHistory();
  const middle = graph.posOf({ node: a, seq: 2 })!;
  expect((await drive(scheduler, graph.at(middle))).resolve(a, ["title"])).toBe("a2");
  const compacting = graph.compact(a, { bucketMs: 60_000 });
  for (let i = 0; i < 20 && !scheduler.pending().some(event => event.label === "compact"); i++) { scheduler.deliver(0); await settle(); }
  const survivor = ok(graph.commit([{ op: "create", type: ITEM, fields: { pin: { node: a, seq: 4 } } }]));
  const rolled = graph.commit([{ op: "create", type: ITEM, fields: { pin: { node: a, seq: 2 } } }]);
  expect([survivor.ok, rolled.ok ? "ok" : rolled.reason]).toEqual([true, "busy"]);
  expect(await drive(scheduler, compacting)).toMatchObject({ ok: true, before: 4, after: 2 });
  expect((await drive(scheduler, graph.at(middle))).resolve(a, ["title"])).not.toBe("a2");
  expect(await drive(scheduler, graph.compact(one))).toMatchObject({ ok: true, before: 1, after: 1 });
  await drive(scheduler, graph.snapshotAll());
  expect([a, one].map(ref => memory!.loadNow().nodes.find(node => node.ref.id === ref.id)?.snapshot?.seq)).toEqual([4, 1]);
});

test("collapse says which way the persistence differs, and one collapse into a host at a time", async () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", fields: { x: { kind: "value" } } });
  const holder = defineType({ type: "holder", owner: "t", schema: "1", fields: { pose: { kind: "ref", to: "pose", clone: "share" } } });
  const sholder = defineType({ type: "sholder", owner: "t", schema: "1", persistence: "session", fields: { item: { kind: "ref", to: ITEM, clone: "share" } } });
  const { graph, scheduler } = harness({ store: true, extra: { types: [...SYNTHETIC_TYPES, pose, holder, sholder] } });
  await drive(scheduler, graph.load());
  const p = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 1 } }])).created.p;
  ok(graph.commit([{ op: "create", type: "holder", fields: { pose: p } }]));
  const i = create(graph, ITEM, { title: "i" });
  ok(graph.commit([{ op: "create", type: "sholder", fields: { item: i } }]));
  await drive(scheduler, graph.flush());
  const messages = [await drive(scheduler, graph.collapseInline(p)), await drive(scheduler, graph.collapseInline(i))].map(result => result.ok ? "" : result.message);
  expect(messages).toEqual(["Only a node kept beyond this session refers to it: it can't move there.", "Only a node of this session refers to it: it can't move there."]);
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  create(graph, GROUP, { label: "h", members: { x, y } });
  await drive(scheduler, graph.flush());
  const first = graph.collapseInline(x), second = graph.collapseInline(y);
  const results = await drive(scheduler, Promise.all([first, second]));
  expect(results.map(result => result.ok ? "ok" : result.reason)).toEqual(["ok", "busy"]);
});

test("purging a collapsed node: pins that read it through their source's layers read it no more, views forget it, and subscribers hear it", async () => {
  const { graph, scheduler } = harness({ store: true, extra: { types: [...SYNTHETIC_TYPES, pinView] } });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x" });
  create(graph, GROUP, { label: "h", members: { x } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  const s = ok(graph.commit([{ op: "create", type: ITEM, as: "s", from: { fork: x } }])).created.s;
  const other = create(graph, ITEM, { title: "other" });
  const v = ok(graph.commit([{ op: "create", type: "pinview", as: "v", layers: [
    { from: s, role: "base", paths: "*", at: { node: s, seq: 1 } }, { from: other, role: "feed", paths: [["note"]] }] }])).created.v;
  ok(graph.commit([{ op: "set", node: s, path: ["tags", "k"], value: 1 }]));
  const past = graph.posOf({ node: s, seq: 1 })!;
  expect([graph.resolve(v, ["title"]), (await drive(scheduler, graph.at(past))).exists(x)]).toEqual(["x", true]);
  const life = new Aborter();
  const purged: string[] = [];
  const reached: string[] = [];
  graph.subscribeAll(set => purged.push(...set.nodes.filter(item => item.meta.includes("purged")).map(item => item.node.id)), { signal: life.signal });
  graph.subscribe(v, change => reached.push(change.paths.map(path => path.join(".")).join(",")), { signal: life.signal });
  expect(await drive(scheduler, graph.purge(x, { force: true }))).toEqual({ ok: true });
  expect([graph.resolve(v, ["title"]), (await drive(scheduler, graph.at(past))).exists(x), purged, reached]).toEqual(["untitled", false, [x.id], ["title"]]);
  life.abort();
});

test("a purge is refused while the node or its host is being purged, collapsed or collapsed into", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a" });
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  const h = create(graph, GROUP, { label: "h", members: { x, y } });
  await drive(scheduler, graph.flush());
  const reason = (result: { ok: boolean; reason?: string }) => result.ok ? "ok" : result.reason;
  const twice = await drive(scheduler, Promise.all([graph.purge(a), graph.purge(a)]));
  const whileCollapsing = await drive(scheduler, Promise.all([graph.collapseInline(x), graph.purge(x, { force: true })]));
  // Y's collapse reaches its store work: its host is then being written into.
  const collapsing = graph.collapseInline(y);
  for (let i = 0; i < 50 && !scheduler.pending().some(event => event.label === "compact"); i++) { scheduler.deliver(0); await settle(); }
  const intoHost = await graph.purge(h, { force: true });
  expect(await drive(scheduler, collapsing)).toMatchObject({ ok: true });
  // Collapsed, X can't be purged while its host is.
  const withHost = await drive(scheduler, Promise.all([graph.purge(h, { force: true }), graph.purge(x, { force: true })]));
  expect([twice.map(reason), reason(whileCollapsing[1]), reason(intoHost), withHost.map(reason)]).toEqual([["ok", "busy"], "busy", "busy", ["ok", "busy"]]);
});

test("purging a node frees its unique values, drops its Undo steps, refreshes pins that read it through layers however else they read, and names what went with it", async () => {
  const { graph, scheduler } = harness({ store: true, extra: { types: [...SYNTHETIC_TYPES, pinView] } });
  await drive(scheduler, graph.load());
  const gone = create(graph, ITEM, { title: "gone", code: "u-gone" });
  const inner = create(graph, ITEM, { title: "inner" });
  const b = create(graph, ITEM, { title: "b" });
  const s = ok(graph.commit([{ op: "create", type: ITEM, as: "s", from: { fork: gone } }])).created.s;
  const other = create(graph, ITEM, { title: "other" });
  const v = ok(graph.commit([{ op: "create", type: "pinview", as: "v", layers: [
    { from: s, role: "base", paths: "*", at: { node: s, seq: 1 } }, { from: other, role: "feed", paths: [["note"]] }] }])).created.v;
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "b2" }], { scope: "s" }));
  ok(graph.commit([{ op: "set", node: gone, path: ["tags", "k"], value: 1 }], { scope: "s" }));
  const host = create(graph, GROUP, { label: "host", members: { inner } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(inner))).toMatchObject({ ok: true });
  const past = graph.posOf({ node: b, seq: 2 })!;
  expect([graph.resolve(v, ["title"]), (await drive(scheduler, graph.at(past))).exists(gone)]).toEqual(["gone", true]);
  const life = new Aborter();
  const purged: string[] = [];
  const reached: string[] = [];
  graph.subscribeAll(set => purged.push(...set.nodes.filter(item => item.meta.includes("purged")).map(item => item.node.id)), { signal: life.signal });
  graph.subscribe(v, change => reached.push(change.paths.map(path => path.join(".")).join(",")), { signal: life.signal });
  expect(await drive(scheduler, graph.purge(gone, { force: true }))).toEqual({ ok: true });
  expect(reached).toEqual(["title"]);
  expect(await drive(scheduler, graph.purge(host, { force: true }))).toEqual({ ok: true });
  expect([graph.resolve(v, ["title"]), (await drive(scheduler, graph.at(past))).exists(gone), purged.sort()]).toEqual(["untitled", false, [gone.id, host.id, inner.id].sort()]);
  ok(graph.commit([{ op: "create", type: ITEM, fields: { code: "u-gone" } }]));
  ok(graph.undo("s"));
  expect(graph.resolve(b, ["title"])).toBe("b");
  life.abort();
});

test("inspector rows: depth by the longest chain of sources, use counts, orphaned references, the worst conflict on any of its subjects, and no row for a retracted node", async () => {
  const rules = [defineRule({ id: "pair", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) => {
    const partner = context.resolve(subject, ["link"]) as { type: string; id: string } | undefined;
    return context.resolve(subject, ["title"]) === "pair" && partner ? [{ subjects: [subject, partner], sentence: "A pair." }] : [];
  } })];
  const { graph, scheduler } = harness({ store: true, extra: { rules } });
  await drive(scheduler, graph.load());
  const c = create(graph, ITEM, { title: "c" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: c } }])).created.b;
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", from: { fork: b } }])).created.a;
  // Its base is the shorter chain, and it is visited first.
  const n = ok(graph.commit([{ op: "create", type: ITEM, as: "n", layers: [{ from: b, role: "base", paths: "*" }, { from: a, role: "feed", paths: [["title"]] }] }])).created.n;
  expect([c, b, a, n].map(ref => graph.inspectorRow(ref)?.depth)).toEqual([0, 1, 2, 3]);
  const gone = create(graph, ITEM, { title: "gone" }), kept = create(graph, ITEM, { title: "kept" });
  const holder = create(graph, ITEM, { title: "pair", link: kept, others: [gone, kept] });
  const fine = create(graph, ITEM, { title: "fine", link: kept });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.purge(gone))).toEqual({ ok: true });
  expect([graph.inspectorRow(holder)?.orphaned, graph.inspectorRow(kept)?.orphaned, graph.inspectorRow(kept)?.used, graph.inspectorRow(c)?.used]).toEqual([true, false, 2, 0]);
  expect([graph.inspectorRow(kept)?.conflict, graph.inspectorRow(fine)?.orphaned]).toEqual(["warning", false]);
  const r = ok(graph.commit([{ op: "create", type: ITEM, as: "r" }], { scope: "s" })).created.r;
  ok(graph.undo("s"));
  expect(graph.inspectorRow(r)).toBeUndefined();
});

test("the inspector lists rows by type, then name, then ID", () => {
  const { graph } = harness();
  create(graph, GROUP, { label: "zz" });
  ok(graph.commit([{ op: "rename", node: graph.list(GROUP)[0], name: "zz" }]));
  const same = Array.from({ length: 4 }, () => ok(graph.commit([{ op: "create", type: ITEM, name: "same" }])).created);
  void same;
  for (const name of ["m", "b", "y"]) ok(graph.commit([{ op: "create", type: ITEM, name }]));
  const rows = graph.inspect().rows.filter(row => !row.constant);
  const expected = [...rows].sort((p, q) => p.ref.type < q.ref.type ? -1 : p.ref.type > q.ref.type ? 1 : p.name < q.name ? -1 : p.name > q.name ? 1 : p.ref.id < q.ref.id ? -1 : 1);
  expect(rows.map(row => row.ref.id)).toEqual(expected.map(row => row.ref.id));
  expect(rows[0].ref.type).toBe(GROUP);
});

test("a node's detail lists the nodes fed from it in the order they were made, skips collapsed ones, and shows its acknowledged conflicts", async () => {
  const rules = [defineRule({ id: "odd", owner: "t", subject: ITEM, severity: "warning", evaluate: (subject, context) =>
    context.resolve(subject, ["title"]) === "odd" ? [{ sentence: "Odd." }] : [] })];
  const { graph, scheduler } = harness({ store: true, extra: { rules } });
  await drive(scheduler, graph.load());
  const s = create(graph, ITEM, { title: "odd" });
  const forks = [0, 1, 2].map(() => ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: s } }])).created.f);
  create(graph, GROUP, { label: "h", members: { f: forks[2] } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(forks[2]))).toMatchObject({ ok: true });
  const conflict = graph.conflicts(s)[0];
  expect(graph.acknowledge(conflict.id)).toEqual({ ok: true });
  const detail = graph.inspectNode(s)!;
  expect([detail.fedInto.map(edge => edge.from.id), detail.conflicts.map(item => item.id)]).toEqual([[forks[0].id, forks[1].id], [conflict.id]]);
});

test("a change reports its paths in path order, and entries are found by seq in long streams", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  for (let i = 0; i < 12; i++) ok(graph.commit([{ op: "set", node: a, path: ["tags", "n"], value: i }]));
  expect(Array.from({ length: 13 }, (_, i) => graph.posOf({ node: a, seq: i + 1 }))).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  const life = new Aborter();
  const paths: string[][] = [];
  graph.subscribe(a, change => paths.push(change.paths.map(path => path.join("."))), { signal: life.signal });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }, { op: "set", node: a, path: ["tags", "z"], value: 1 }, { op: "set", node: a, path: ["tags", "b"], value: 1 }]));
  expect(paths).toEqual([["tags.b", "tags.z", "title"]]);
  life.abort();
});

// Resolution, read models, entry references and upcasting.

test("a commit reads its own earlier edits when it builds later ones", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a1" });
  const made = ok(graph.commit([
    { op: "create", type: ITEM, as: "c1", from: { clone: a } },
    { op: "set", node: a, path: ["title"], value: "a2" }, { op: "set", node: a, path: ["tags", "k2"], value: 2 },
    { op: "create", type: ITEM, as: "c2", from: { clone: a } },
  ]));
  expect([graph.resolve(made.created.c1, ["title"]), graph.resolve(made.created.c2, ["title"]), graph.resolve(made.created.c2, ["tags"])])
    .toEqual(["a1", "a2", { base: 1, k2: 2 }]);
});

test("map keys: a feed with several masks takes each, an emptied submap and absent fields aren't listed, and a null default adds nothing", () => {
  const { graph: g2 } = harness();
  const src = create(g2, ITEM, { title: "src", meta: { x: { y: 1 } } });
  const fork = ok(g2.commit([{ op: "create", type: ITEM, as: "f", from: { fork: src } }])).created.f;
  ok(g2.commit([{ op: "tombstone", node: fork, path: ["meta", "x", "y"] }]));
  expect(g2.resolve(fork, ["meta"])).toEqual({});
  const kind = defineType({ type: "mk", owner: "t", schema: "1", fields: { m: { kind: "map", of: { kind: "value" } }, n: { kind: "map", of: { kind: "value" } } },
    defaults: () => ({ n: null }) });
  const { graph } = harness({ extra: { types: [...SYNTHETIC_TYPES, kind] } });
  const s = create(graph, ITEM, { title: "s", tags: { a: 1, b: 2, c: 3 } });
  const fed = ok(graph.commit([{ op: "create", type: ITEM, as: "f", layers: [{ from: s, role: "feed", paths: [["tags", "a"], ["tags", "b"]] }] }])).created.f;
  expect(graph.resolve(fed, ["tags"])).toEqual({ a: 1, b: 2, base: 1 });
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node: a, path: ["meta", "x", "y"], value: 1 }]));
  ok(graph.commit([{ op: "reset", node: a, path: ["meta", "x", "y"] }]));
  expect([graph.resolve(a, ["meta"]), Object.keys(graph.read(a)!.value).sort(), graph.read(a)!.value.title]).toEqual([{}, ["code", "meta", "tags", "title"], "a"]);
  const k = ok(graph.commit([{ op: "create", type: "mk", as: "k" }])).created.k;
  expect([graph.resolve(k, ["n"]), graph.resolve(k, ["n", "a"])]).toEqual([{}, undefined]);
});

test("a derivation cycle names the nodes on it, wherever it is read from", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b", link: a });
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: b }]));
  const ids = (result: ReturnType<typeof graph.derive>) => result.ok ? [] : (result.cycle ?? []).map(ref => ref.id);
  const loop = (list: string[]) => list.length === 3 && list[0] === list[2] && new Set(list).size === 2 && list.includes(a.id) && list.includes(b.id);
  // Entered at A, the cycle is named from A; read from B afterwards, it is the same cycle.
  expect([ids(graph.derive(a, "summary")), ids(graph.derive(b, "summary"))]).toEqual([[a.id, b.id, a.id], [a.id, b.id, a.id]]);
  const c = create(graph, ITEM, { title: "c", link: a });
  const fromC = graph.derive(c, "summary");
  expect([fromC.ok ? "ok" : fromC.reason, loop(ids(fromC))]).toEqual(["cycle", true]);
});

test("follow cycles go only through follows references to nodes that exist, from any of a node's references", () => {
  const rules = [defineRule({ id: "reaches-cycle", owner: "t", subject: GROUP, severity: "warning", evaluate: (subject, context) => {
    const cycle = context.followCycle(subject);
    return cycle ? [{ sentence: cycle.map(edge => `${edge.from.id}>${edge.to.id}`).join(" ") }] : [];
  } })];
  const { graph } = harness({ extra: { rules: [...SYNTHETIC_RULES_FOR_TESTS, ...rules] } });
  const p = create(graph, ITEM, { title: "p" }), q = create(graph, ITEM, { title: "q", others: [p], link: null as never });
  ok(graph.commit([{ op: "set", node: p, path: ["others"], value: [q] }]));
  expect(graph.conflicts().filter(item => item.rule === "follow-cycle")).toEqual([]);
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" }), z = create(graph, ITEM, { title: "z", link: y });
  ok(graph.commit([{ op: "set", node: y, path: ["link"], value: z }]));
  create(graph, GROUP, { label: "g", members: { m1: x, m2: y } });
  expect(graph.conflicts().filter(item => item.rule === "reaches-cycle").map(item => item.sentence)).toEqual([`${y.id}>${z.id} ${z.id}>${y.id}`]);
});

test("a view in the past lists a node's referrers in node order", async () => {
  const { graph } = harness();
  const t = create(graph, ITEM, { title: "t" });
  const r1 = create(graph, ITEM, { title: "r1", link: t }), r2 = create(graph, ITEM, { title: "r2", others: [t] });
  ok(graph.commit([{ op: "set", node: t, path: ["title"], value: "t2" }]));
  const view = await graph.at(graph.posOf({ node: r2, seq: 1 })!);
  expect(view.referrers(t).map(item => item.node.id)).toEqual(graph.list(ITEM).filter(ref => ref.id === r1.id || ref.id === r2.id).map(ref => ref.id));
});

test("a follow cycle names only the edges on it, not the dead ends tried before", () => {
  const hub = defineType({ type: "hub", owner: "t", schema: "1", fields: { next: { kind: "map", of: { kind: "ref", to: "hub", clone: "share", follows: true } } } });
  const { graph } = harness({ extra: { types: [...SYNTHETIC_TYPES, hub] } });
  const [h1, h2, h3] = [0, 1, 2].map(() => ok(graph.commit([{ op: "create", type: "hub", as: "h" }])).created.h);
  ok(graph.commit([{ op: "set", node: h1, path: ["next", "a"], value: h2 }, { op: "set", node: h1, path: ["next", "b"], value: h3 }, { op: "set", node: h3, path: ["next", "a"], value: h1 }]));
  const cycles = graph.conflicts().filter(item => item.rule === "follow-cycle");
  expect(cycles.map(item => item.routes.length)).toEqual([2]);
});

test("an entry's references come in a fixed order: pins in layers, entry fields, then what its inlined streams reference; old entries are read upcast", () => {
  const e = (id: string, seq: number) => ({ node: { type: ITEM, id }, seq });
  const two = defineType({ type: "two", owner: "t", schema: "2", fields: { p1: { kind: "entry" }, p2: { kind: "entry" }, r: { kind: "ref", to: ITEM, clone: "share" }, rs: { kind: "refs", to: [ITEM], clone: "share" } },
    upcasters: [{ from: "1", to: "2", set: (path, value) => path[0] === "old" ? { path: ["p2", ...path.slice(1)], value } : { path, value } }] });
  const defs = (type: string) => type === "two" ? two : type === ITEM ? SYNTHETIC_TYPES[0] : undefined;
  const base = { seq: 1, pos: 1, commit: "c", actor: "a", actorSeq: 1, at: 0, schema: "2" };
  const state = { name: "", trashed: false, retracted: false,
    own: { [pathKey(["p1"])]: e("p", 1), [pathKey(["p2"])]: e("q", 2), [pathKey(["r"])]: { type: ITEM, id: "r1" }, [pathKey(["rs"])]: [{ type: ITEM, id: "r2" }, { type: ITEM, id: "r3" }] },
    layers: [{ from: { type: "two", id: "s1" }, role: "feed", paths: [["p1"]], at: { node: { type: "two", id: "s1" }, seq: 2 } },
      { from: { type: "two", id: "s2" }, role: "base", paths: "*", at: { node: { type: "two", id: "s2" }, seq: 3 } }] };
  const inner = { ...base, node: { type: "two", id: "in" }, op: { kind: "set", path: ["p1"], value: e("z", 4) } };
  const entry = { ...base, node: { type: "two", id: "x" }, op: { kind: "create", state }, inlined: [{ node: { type: "two", id: "in" }, entries: [inner] }] };
  const ids = (refs: readonly { node: { id: string }; seq?: number }[]) => refs.map(ref => `${ref.node?.id ?? (ref as unknown as { id: string }).id}${ref.seq ? `@${ref.seq}` : ""}`);
  expect(ids(entryReferences(entry as never, two, undefined, defs))).toEqual(["s1@2", "s2@3", "p@1", "q@2", "z@4"]);
  const old = { ...base, schema: "1", node: { type: "two", id: "y" }, op: { kind: "set", path: ["old"], value: e("w", 5) } };
  expect(ids(entryReferences(old as never, two))).toEqual(["w@5"]);
  expect(nodeReferences(entry as never, two).map(ref => ref.id)).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
});

test("the keep set: roots and referenced entries themselves, and what reading each at its point needs through live and pinned layers", () => {
  const def = SYNTHETIC_TYPES[0];
  const defs = (type: string) => type === ITEM ? def : undefined;
  let pos = 0;
  const entry = (id: string, seq: number, commit: string, op: unknown) => ({ node: { type: ITEM, id }, seq, pos: ++pos, commit, actor: "a", actorSeq: pos, at: 0, schema: "2", op });
  const layers = (from: string, at?: { id: string; seq: number }) => [{ from: { type: ITEM, id: from }, role: "base", paths: "*", ...(at ? { at: { node: { type: ITEM, id: at.id }, seq: at.seq } } : {}) }];
  const create = (layerList: unknown[] = []) => ({ kind: "create", state: { name: "", own: {}, layers: layerList, trashed: false, retracted: false } });
  const set = (value: unknown) => ({ kind: "set", path: ["title"], value });
  const ref = (id: string, seq: number) => ({ node: { type: ITEM, id }, seq });
  const pin = (id: string, seq: number) => ({ kind: "set", path: ["pin"], value: ref(id, seq) });
  // T is S's live source; P pins S at its second entry and is itself pinned by R; P also names the first entry of a
  // two-entry commit on Q. Every stream moves on afterwards.
  const t = [entry("t", 1, "t1", create()), entry("t", 2, "t2", set("t2")), entry("t", 3, "t3", set("t3"))];
  const s = [entry("s", 1, "s1", create(layers("t"))), entry("s", 2, "s2", set("s2")), entry("s", 3, "s3", set("s3"))];
  const q = [entry("q", 1, "q1", create()), entry("q", 2, "q2", set("a")), entry("q", 3, "q2", set("b"))];
  const p = [entry("p", 1, "p1", create(layers("s", { id: "s", seq: 2 })))];
  s.push(entry("s", 4, "s4", set("s4"))); t.push(entry("t", 4, "t4", set("t4"))); q.push(entry("q", 4, "q4", set("c")));
  p.push(entry("p", 2, "p2", pin("q", 2)));
  const r = [entry("r", 1, "r1", create()), entry("r", 2, "r2", pin("p", 1))];
  const stream = (id: string, entries: unknown[]) => ({ ref: { type: ITEM, id }, entries });
  const streams = [stream("t", t), stream("s", s), stream("q", q), stream("p", p), stream("r", r)];
  expect([...keepSet(streams as never, defs)].sort()).toEqual(["p@1", "p@2", "q@2", "q@3", "q@4", "r@2", "s@2", "s@4", "t@3", "t@4"].sort());
  // A root in the middle of a commit is kept itself, with what reading it needs.
  expect([...keepSet([stream("q", q.slice(0, 3)), stream("q-end", [entry("q-end", 1, "e", create())])] as never, defs, { roots: [ref("q", 2)] })].sort())
    .toEqual(["q-end@1", "q@2", "q@3"]);
  // Names of what isn't there, and layers from streams it doesn't have, are passed over.
  // A node whose layers change reads its source only from the entry that names it on.
  const src = [entry("src", 1, "c1", create())];
  const a = [entry("a", 1, "a1", create()), entry("a", 2, "a2", { kind: "layers", layers: layers("src") })];
  const b = [entry("b", 1, "b1", create()), entry("b", 2, "b2", pin("a", 2))];
  src.push(entry("src", 2, "c2", set("later")));
  expect([...keepSet([stream("src", src), stream("a", a), stream("b", b)] as never, defs)].sort()).toEqual(["a@2", "b@2", "src@1", "src@2"]);
  const late = [entry("late", 1, "l1", create())];
  const lone = [entry("u", 1, "u1", { kind: "create", state: { name: "", own: {}, trashed: false, retracted: false,
    layers: [{ from: { type: ITEM, id: "absent" }, role: "feed", paths: [["title"]] }, { from: { type: ITEM, id: "late" }, role: "base", paths: "*" }] } }),
    entry("u", 2, "u2", pin("absent", 9)), entry("u", 3, "u3", pin("u", 1))];
  // Late's only entry comes after the point U is read at.
  late[0].pos = 1000;
  expect([...keepSet([stream("u", lone), stream("late", late)] as never, defs)].sort()).toEqual(["absent@9", "late@1", "u@1", "u@3"]);
});

test("an entry's node references: reference fields only, read upcast", () => {
  const kind = defineType({ type: "rk", owner: "t", schema: "2", fields: { r: { kind: "ref", to: ITEM, clone: "share" }, rs: { kind: "refs", to: [ITEM], clone: "share" }, v: { kind: "value" } },
    upcasters: [{ from: "1", to: "2", set: (path, value) => path[0] === "old" ? { path: ["r"], value } : { path, value } }] });
  const base = { node: { type: "rk", id: "x" }, seq: 1, pos: 1, commit: "c", actor: "a", actorSeq: 1, at: 0, schema: "2" };
  const ref = (id: string) => ({ type: ITEM, id });
  const created = { ...base, op: { kind: "create", state: { name: "", trashed: false, retracted: false, layers: [],
    own: { [pathKey(["r"])]: ref("r1"), [pathKey(["rs"])]: [ref("r2")], [pathKey(["v"])]: [ref("not-a-reference")] } } } };
  expect(nodeReferences(created as never, kind).map(item => item.id).sort()).toEqual(["r1", "r2"]);
  expect(nodeReferences({ ...created, op: { ...created.op, kind: "import" } } as never, kind).map(item => item.id).sort()).toEqual(["r1", "r2"]);
  expect(nodeReferences({ ...base, op: { kind: "set", path: ["v"], value: [ref("nope")] } } as never, kind)).toEqual([]);
  expect(nodeReferences({ ...base, op: { kind: "set", path: ["gone"], value: ref("nope") } } as never, kind)).toEqual([]);
  expect(nodeReferences({ ...base, schema: "1", op: { kind: "set", path: ["old"], value: ref("up") } } as never, kind).map(item => item.id)).toEqual(["up"]);
});

test("a rolled-up run is replaced before the kept entry that ends it, and folds to the same states", () => {
  const def = SYNTHETIC_TYPES[0];
  const entry = (seq: number, op: unknown) => ({ node: { type: ITEM, id: "x" }, seq, pos: seq, commit: `c${seq}`, actor: "a", actorSeq: seq, at: seq, schema: "2", op });
  const entries = [entry(1, { kind: "create", state: { name: "", own: {}, layers: [], trashed: false, retracted: false } }),
    entry(2, { kind: "set", path: ["title"], value: "two" }), entry(3, { kind: "set", path: ["tags", "k"], value: 3 }), entry(4, { kind: "set", path: ["title"], value: "four" })];
  const rolled = rollupDeltaStream(def, entries as never, new Set(["x@3"]));
  expect(rolled.map(item => [item.seq, item.op.kind])).toEqual([[2, "state"], [3, "set"], [4, "set"]]);
  expect(fold(null, rolled, def)).toEqual(fold(null, entries as never, def));
});

test("upcasting takes the first step from each schema, and a chain that never reaches the type's schema stops after 64 steps", () => {
  const rename = (from: string, to: string) => (path: readonly string[], value: unknown) => ({ path: path[0] === from ? [to, ...path.slice(1)] : [...path], value: value as never });
  const looping = defineType({ type: "loop", owner: "t", schema: "3", fields: { a: { kind: "value" }, b: { kind: "value" }, c: { kind: "value" } },
    upcasters: [{ from: "1", to: "2", set: rename("a", "b") }, { from: "1", to: "2", set: rename("a", "c") }, { from: "2", to: "1", set: rename("b", "a") }] });
  const entry = { node: { type: "loop", id: "x" }, seq: 1, pos: 1, commit: "c", actor: "a", actorSeq: 1, at: 0, schema: "1", op: { kind: "set", path: ["a"], value: 1 } };
  const once = upcast({ ...looping, upcasters: looping.upcasters!.slice(0, 2), schema: "2" } as never, entry as never);
  expect([once.op, upcast(looping, entry as never).op]).toEqual([{ kind: "set", path: ["b"], value: 1 }, { kind: "set", path: ["a"], value: 1 }]);
});

test("references are checked whole: every item of a list, and the exact type named", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const reason = (result: { ok: boolean; reason?: string }) => result.ok ? "ok" : result.reason;
  expect([
    reason(graph.commit([{ op: "set", node: a, path: ["others"], value: [a, 5] }])),
    reason(graph.commit([{ op: "set", node: a, path: ["link"], value: { type: "ite", id: a.id } }])),
  ]).toEqual(["value", "value"]);
});

test("the memory store: a repeated append is a duplicate, a snapshot at the same seq replaces the one there, and compaction is recorded and counted", () => {
  const memory = new MemoryStore();
  const node = { type: ITEM, id: "x" };
  const entry = (seq: number) => ({ node, seq, pos: 0, commit: `c${seq}`, actor: "a", actorSeq: seq, at: seq, schema: "2", op: { kind: "set", path: ["title"], value: `t${seq}` } });
  const first = memory.appendNow({ commit: "c1", entries: [entry(1) as never], expect: [["x", 0]] });
  expect([first, memory.appendNow({ commit: "c1", entries: [entry(1) as never], expect: [["x", 0]] })]).toEqual([{ ok: true, positions: [1] }, { ok: true, positions: [1], duplicate: true }]);
  memory.appendNow({ commit: "c2", entries: [entry(2) as never], expect: [["x", 1]] });
  memory.appendNow({ commit: "c3", entries: [entry(3) as never], expect: [["x", 2]] });
  const snapshot = (schema: string) => ({ node, seq: 2, pos: 2, schema, state: { name: "", own: {}, layers: [], trashed: false, retracted: false } });
  memory.putSnapshotNow(snapshot("1") as never);
  memory.putSnapshotNow(snapshot("2") as never);
  expect(memory.loadNow().nodes[0].snapshot?.schema).toBe("2");
  const counted = memory.changesSinceNow(0).head;
  let counter = 0;
  void memory.counter().then(value => { counter = value; });
  const stream = memory.readStreamNow(node);
  memory.compactNow(node, stream.slice(0, 1), 10);
  memory.compactNow(node, stream.slice(1, 2), 20);
  expect(memory.compactions.map(item => [item.seq, item.at])).toEqual([[1, 10], [2, 20]]);
  return memory.counter().then(after => { expect([counted, after - counter]).toEqual([3, 2]); });
});

test("within one commit: a no-op edit drops nothing done before it and doesn't stop what follows, a tag names the entry made before it, and an edit through a reference of another type finds nothing", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "x" }, { op: "set", node: a, path: ["title"], value: "x" }]));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "x" }, { op: "set", node: a, path: ["title"], value: "y" }]));
  const same = graph.commit([{ op: "set", node: a, path: ["title"], value: "y" }]);
  const f = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: a } }])).created.f;
  const sameLayers = graph.commit([{ op: "layers", node: f, layers: graph.read(f)!.layers }]);
  expect([graph.resolve(a, ["title"]), same.ok ? "ok" : same.reason, sameLayers.ok ? "ok" : sameLayers.reason]).toEqual(["y", "empty", "empty"]);
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "z" }, { op: "tag", node: a, label: "v" }]));
  const entries = graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === a.id)!.entries;
  const tag = entries.at(-1)!.op as unknown as { kind: string; entries: { seq: number }[] };
  expect([tag.kind, tag.entries.map(item => item.seq)]).toEqual(["tag", [entries.at(-2)!.seq]]);
  const wrong = graph.commit([{ op: "set", node: a, path: ["title"], value: "w" }, { op: "set", node: { type: GROUP, id: a.id }, path: ["label"], value: "l" }]);
  expect(wrong.ok ? "ok" : wrong.reason).toBe("missing");
});

test("a redo of a creation brings the node back as it was", () => {
  const { graph } = harness();
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a", fields: { title: "made" } }], { scope: "s" })).created.a;
  ok(graph.undo("s"));
  expect(graph.read(a)).toBeUndefined();
  ok(graph.redo("s"));
  expect(graph.resolve(a, ["title"])).toBe("made");
});
