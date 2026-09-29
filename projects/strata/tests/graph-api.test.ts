/**
 * The graph's API beyond the everyday commit and read: registration and options, session streams, sources and sinks,
 * views of the past and history cursors, loading unusual stores, the inspector's rows and details, conflicts that are
 * acknowledged and fixed, undo at its edges, subscriptions that end early, and the refusals of compaction, inline
 * collapse and purge.
 */
import { expect, test } from "bun:test";
import { Aborter, constantId, createGraph, defineRule, defineSink, defineSource, defineType, MemoryStore, trustTable } from "strata";
import type { ChangeSet, Entry, Graph, GraphOptions, NodeChange, NodeRef, TypeDef } from "strata";
import { sampleEntry, Scheduler, seededRandom, settle, simClock, SimStore, SYNTHETIC_RULES, SYNTHETIC_TYPES } from "strata/testing";
import { GROUP, ITEM } from "../src/testing/synthetic";
import { create, drive, harness, ok } from "./helpers";

const sources = (scheduler = new Scheduler(), seed = "api") => ({ clock: simClock(scheduler), random: seededRandom(seed) });
const graphOf = (types: readonly TypeDef[], extra: Partial<GraphOptions> = {}) => createGraph({ types, sources: sources(), ...extra });

// ---------------------------------------------------------------------------------------------------------------
// Registration and options
// ---------------------------------------------------------------------------------------------------------------

test("a graph needs clock and random sources, and registers each type and rule once", () => {
  expect(() => createGraph({ types: [], sources: {} as never })).toThrow("clock and random");
  expect(() => createGraph({ types: [], sources: { clock: simClock(new Scheduler()) } as never })).toThrow("clock and random");
  expect(() => graphOf([...SYNTHETIC_TYPES, SYNTHETIC_TYPES[0]])).toThrow("registered twice");
  expect(() => graphOf(SYNTHETIC_TYPES, { rules: [SYNTHETIC_RULES[0], SYNTHETIC_RULES[0]] })).toThrow("registered twice");
});

test("the graph runs as its actor: members in the process tree, its frame, its trust per frame, and its bound sources", () => {
  const input = defineSource<{ key: string }>("keyboard"), missing = defineSource("absent");
  const bound = { poll: () => "k" };
  const graph = createGraph({ types: SYNTHETIC_TYPES, sources: { ...sources(), keyboard: bound }, actor: "studio", members: ["a", "b"],
    trust: frame => frame === "studio" ? trustTable({ "*": ["game"] }) : trustTable({}) });
  expect(graph.frame).toBe("studio");
  expect(graph.env.processTree().children.find(item => item.actor === "studio")?.members).toEqual(["a", "b"]);
  const claims = [{ actor: "game", value: 1, asOf: 1 }];
  expect(graph.trust("hair", claims).value).toBe(1);
  expect(graph.trust("hair", claims, "elsewhere").value).toBeUndefined();
  expect(graph.source(input)).toBe(bound as never);
  expect(() => graph.source(missing)).toThrow("not bound");
  const plain = createGraph({ types: SYNTHETIC_TYPES, sources: sources(), trust: trustTable({ "*": ["game"] }) });
  expect(plain.trust("hair", claims, "any").value).toBe(1);
  expect(plain.typeOf(ITEM)?.type).toBe(ITEM);
  expect(plain.seqOf({ type: ITEM, id: "nobody" })).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// Session streams, sources and sinks
// ---------------------------------------------------------------------------------------------------------------

test("a source with a ring records its events as a session stream that keeps only its ring; one without a ring records nothing", async () => {
  const graph = graphOf(SYNTHETIC_TYPES);
  const ticks = defineSource<number>("ticks", { ring: 3 }), quiet = defineSource<number>("quiet");
  for (let i = 1; i <= 5; i++) graph.record(ticks, i);
  graph.record(quiet, 1);
  const node = graph.sourceNode(ticks);
  expect(graph.ring(node).map(entry => entry.seq)).toEqual([3, 4, 5]);
  expect(graph.resolve(node, ["value"])).toBe(5);
  expect(graph.ring(graph.sourceNode(quiet))).toEqual([]);
  expect(graph.canUndo(`source:ticks`)).toBe(false);
  // Its early history is folded into the ring's base: a view at the base reads it; before the ring there is nothing to read.
  expect((await graph.at(2)).resolve(node, ["value"])).toBe(2);
  expect((await graph.at(1)).exists(node)).toBe(false);
});

test("session types keep a bounded ring and reach sinks at once; stored types reach sinks when the store acknowledges them", async () => {
  const session = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", ring: 2, fields: { x: { kind: "value" } } });
  const stored = defineType({ type: "note", owner: "t", schema: "1", fields: { x: { kind: "value" } } });
  const scheduler = new Scheduler(), store = new SimStore(new MemoryStore(), scheduler);
  const everything: Entry[] = [], notes: Entry[] = [], none: Entry[] = [];
  const graph = createGraph({ types: [session, stored], store, sources: sources(scheduler), signal: new Aborter().signal, sinks: [
    { def: defineSink("all", "*"), sink: { accept: entries => everything.push(...entries) } },
    { def: defineSink("notes", ["note"]), sink: { accept: entries => notes.push(...entries) } },
    { def: defineSink("never", ["other"]), sink: { accept: entries => none.push(...entries) } },
  ] });
  await drive(scheduler, graph.load());
  const pose = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 0 } }])).created.p;
  for (let i = 1; i <= 3; i++) ok(graph.commit([{ op: "set", node: pose, path: ["x"], value: i }]));
  expect(everything.map(entry => entry.node.type)).toEqual(["pose", "pose", "pose", "pose"]);
  expect(graph.ring(pose).map(entry => entry.seq)).toEqual([3, 4]);
  expect(graph.resolve(pose, ["x"])).toBe(3);
  ok(graph.commit([{ op: "create", type: "note", as: "n", fields: { x: 1 } }]));
  expect(notes).toEqual([]);
  await drive(scheduler, graph.flush());
  expect(notes.map(entry => entry.node.type)).toEqual(["note"]);
  expect(none).toEqual([]);
  // A session node is never stored or snapshotted, and its ring isn't compacted.
  expect(await drive(scheduler, graph.snapshotAll())).toBe(1);
  const compacted = await drive(scheduler, graph.compact(pose));
  expect(compacted.ok ? "" : compacted.reason).toBe("missing");
  expect(await graph.changeCounter()).toBeGreaterThan(0);
  expect(await graphOf([]).changeCounter()).toBe(0);
});

// ---------------------------------------------------------------------------------------------------------------
// Views of the past and cursors
// ---------------------------------------------------------------------------------------------------------------

test("a view can be taken at the head, a position, a commit or an entry, and reads everything as it was then", async () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "one" });
  const first = graph.position;
  const second = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "two" }]));
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: a } }])).created.f;
  const at = (await graph.at(first));
  expect(at.position).toBe(first);
  expect(at.resolve(a, ["title"])).toBe("one");
  expect(at.exists(fork)).toBe(false);
  expect(at.list(ITEM).some(ref => ref.id === fork.id)).toBe(false);
  expect(at.read(a)?.seq).toBe(1);
  expect(at.origin(a, ["title"])).toEqual({ via: "own", node: a });
  expect(at.references(a)).toEqual([]);
  expect(at.referrers(a)).toEqual([]);
  expect(at.derive(a, "summary")).toEqual({ ok: true, value: "one" });
  expect(at.conflicts()).toEqual([]);
  expect(at.issues(a)).toEqual([]);
  expect((await graph.at({ commit: second.commit })).resolve(a, ["title"])).toBe("two");
  expect((await graph.at({ node: a, seq: 1 })).resolve(a, ["title"])).toBe("one");
  const head = await graph.at("head");
  expect(head.resolve(fork, ["title"])).toBe("two");
  expect(head.referrers(a)).toEqual(graph.referrers(a));
  expect(head.conflicts()).toEqual(graph.conflicts());
  await expect(graph.at({ commit: "no such commit" })).rejects.toThrow("isn't in memory");
  await expect(graph.at({ node: a, seq: 9 })).rejects.toThrow("isn't in memory");
  // A view only of what some roots reach.
  expect((await graph.at(first, [a])).resolve(a, ["title"])).toBe("one");
  // Cursors: entries after a seq, and every entry in a range of positions.
  expect((await graph.after(a, 1)).map(entry => entry.seq)).toEqual([2]);
  expect((await graph.after({ type: ITEM, id: "nobody" }, 0))).toEqual([]);
  expect((await graph.range(first, graph.position)).map(entry => entry.node.id)).toEqual([a.id, fork.id]);
  expect(await graph.history({ type: ITEM, id: "nobody" })).toEqual([]);
  expect(graph.posOf({ node: { type: ITEM, id: constantId(ITEM, "starter") }, seq: 1 })).toBe(0);
  expect(graph.posOf({ node: { type: ITEM, id: "nobody" }, seq: 1 })).toBeUndefined();
  expect(graph.posOf({ node: a, seq: 5 })).toBeUndefined();
  // Views are cached per position; old ones are let go.
  for (let i = 0; i < 20; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `v${i}` }]));
  for (let pos = 1; pos < graph.position; pos++) expect((await graph.at(pos)).position).toBe(pos);
});

test("a graph loaded from snapshots loads history as a view, a pin, a cursor or a revert needs it", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let sessions = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler, `session ${sessions++}`), snapshotEvery: 2, signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  let graph = await open();
  const a = create(graph, ITEM, { title: "t1" }), b = create(graph, ITEM, { title: "b1" });
  for (let i = 2; i <= 4; i++) ok(graph.commit([{ op: "set", node: b, path: ["title"], value: `b${i}` }]));
  for (let i = 2; i <= 5; i++) ok(graph.commit([{ op: "set", node: a, path: ["title"], value: `t${i}` }]));
  const early = graph.position - 3;
  const pinned = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: a, at: 2 } }])).created.p;
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  // The pin's source history was loaded at load; the pinned fork reads the old value.
  expect(graph.resolve(pinned, ["title"])).toBe("t2");
  graph = await open();
  const record = () => graph.posOf({ node: a, seq: 1 });
  expect((await drive(scheduler, graph.after(a, 4))).map(entry => entry.seq)).toEqual([5]);
  expect((await drive(scheduler, graph.after(a, 1))).map(entry => entry.seq)).toEqual([2, 3, 4, 5]);
  expect(record()).toBeDefined();
  graph = await open();
  const view = await drive(scheduler, graph.at(early));
  expect(view.resolve(a, ["title"])).toBe("t2");
  graph = await open();
  expect((await drive(scheduler, graph.range(0, graph.position))).length).toBeGreaterThan(5);
  graph = await open();
  // B, pinned by nothing, loads from its snapshot alone: a revert or a pin into its history waits for it.
  const reverted = graph.commit([{ op: "revert", node: b, to: 2 }]);
  expect(reverted.ok ? "ok" : reverted.reason).toBe("unloaded");
  const late = graph.commit([{ op: "create", type: ITEM, as: "q", from: { fork: b, at: 1 } }]);
  expect(late.ok ? "ok" : late.reason).toBe("unloaded");
  await drive(scheduler, graph.loadHistory(b));
  expect(ok(graph.commit([{ op: "revert", node: b, to: 2 }])).ok).toBe(true);
  expect(graph.resolve(b, ["title"])).toBe("b2");
});

test("loading skips stored nodes of types this build doesn't know, refetches snapshots of an older schema, and snapshots slow folds", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  const a = { type: ITEM, id: "00000000-0000-4000-8000-00000000000a" }, u = { type: "future", id: "00000000-0000-4000-8000-00000000000f" };
  memory.appendNow({ commit: "c1", entries: [sampleEntry(a, 1, "c1"), sampleEntry(u, 1, "c1")], expect: [[a.id, 0], [u.id, 0]] });
  memory.appendNow({ commit: "c2", entries: [sampleEntry(a, 2, "c2")], expect: [[a.id, 1]] });
  memory.putSnapshotNow({ node: a, seq: 1, pos: 1, schema: "1", state: { name: "old", own: { [JSON.stringify(["name"])]: "old" }, layers: [], trashed: false, retracted: false } });
  const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler), snapshotFoldMs: -1, signal: new Aborter().signal });
  const loaded = await drive(scheduler, graph.load());
  expect(loaded.nodes).toBe(2);   // a and the type's constant
  expect(graph.list().some(ref => ref.id === u.id)).toBe(false);
  expect(graph.resolve(a, ["title"])).toBe("a2");
  await drive(scheduler, graph.flush());
  for (let i = 0; i < 20; i++) { scheduler.deliver(0); await settle(); }
  expect(memory.snapshotOf(a)?.schema).toBe("2");
  // A graph that writes no snapshots leaves the store as it is.
  const reader = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler), writeSnapshots: false, snapshotFoldMs: -1, signal: new Aborter().signal });
  memory.dropSnapshots(a);
  await drive(scheduler, reader.load());
  expect(await drive(scheduler, reader.snapshotAll())).toBe(0);
  expect(memory.snapshotOf(a)).toBeUndefined();
});

// ---------------------------------------------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------------------------------------------

test("inspector rows count references both ways, name the layering, the chain depth and the worst conflict, and sort by type, name and ID", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "base" });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", name: "fork", from: { fork: base } }])).created.f;
  const fed = create(graph, ITEM, { title: "fed" }, { name: "fed" });
  ok(graph.commit([{ op: "feed", node: fed, from: base, paths: [["tags"]] }]));
  const both = ok(graph.commit([{ op: "create", type: ITEM, as: "b", name: "both", from: { fork: fork } }])).created.b;
  ok(graph.commit([{ op: "feed", node: both, from: fed, paths: "*", at: 1 }]));
  const gone = create(graph, ITEM, { title: "gone" }, { name: "gone" });
  const orphan = create(graph, ITEM, { title: "orphan", link: gone }, { name: "orphan" });
  ok(graph.commit([{ op: "trash", node: gone }]));
  const group = create(graph, GROUP, { label: "g", members: { m: base } }, { name: "group" });
  const rows = graph.inspect().rows;
  const row = (ref: NodeRef) => rows.find(item => item.ref.id === ref.id)!;
  expect([row(base).layer, row(fork).layer, row(fed).layer, row(both).layer]).toEqual([null, "fork", "fed", "fork+fed"]);
  expect([row(base).depth, row(fork).depth, row(both).depth]).toEqual([0, 1, 2]);
  expect([row(base).used, row(orphan).uses, row(gone).trashed]).toEqual([1, 1, true]);
  expect(row(orphan).conflict).toBe("warning");
  expect(row(base).conflict).toBeNull();
  expect(rows.findIndex(item => item.ref.id === group.id)).toBe(0);
  expect(rows.filter(item => item.ref.type === ITEM).map(item => item.name)).toEqual([...rows.filter(item => item.ref.type === ITEM).map(item => item.name)].sort());
  expect(graph.inspect("is:fed").rows.map(item => item.name).sort()).toEqual(["both", "fed"]);
  expect(graph.inspect("", 0, 2).next).toBe(2);
  const detail = graph.inspectNode(both)!;
  expect(detail.basedOn).toEqual([{ from: both, to: fork, kind: "base" }]);
  expect(detail.feedsFrom).toEqual([{ from: both, to: fed, kind: "feed", pinned: 1 }]);
  expect(graph.inspectNode(fed)!.fedInto).toEqual([{ from: both, to: fed, kind: "feed", pinned: 1 }]);
  expect(graph.inspectNode(base)!.usedBy.map(edge => edge.from.id)).toEqual([group.id]);
  expect(graph.inspectNode(orphan)!.uses.map(edge => edge.to.id)).toEqual([gone.id]);
  expect(graph.inspectNode(orphan)!.conflicts.length).toBe(1);
  expect(graph.inspectNode({ type: ITEM, id: "nobody" })).toBeUndefined();
  expect(graph.inspectorRow({ type: ITEM, id: "nobody" })).toBeUndefined();
  // Purged sources leave no row, and a node purged from under a fork reads as orphaned layering.
  expect(graph.inspect("id:builtin").rows.every(item => item.constant)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------
// Conflicts, acknowledgement and fixes
// ---------------------------------------------------------------------------------------------------------------

test("a warning can be left until something it involves changes; a blocking conflict or an unknown one can't be acknowledged", () => {
  const { graph } = harness();
  const target = create(graph, ITEM, { title: "t" });
  const holder = create(graph, ITEM, { title: "h", link: target });
  ok(graph.commit([{ op: "trash", node: target }]));
  const [warning] = graph.conflicts(holder);
  expect(warning.severity).toBe("warning");
  expect(graph.acknowledge(warning.id)).toEqual({ ok: true });
  expect(graph.conflicts(holder)).toEqual([]);
  expect(graph.conflicts(holder, { acknowledged: true }).map(item => item.id)).toEqual([warning.id]);
  ok(graph.commit([{ op: "rename", node: holder, name: "renamed" }]));
  expect(graph.conflicts(holder).map(item => item.id)).toEqual([warning.id]);
  expect(graph.acknowledge("no such conflict")).toEqual({ ok: false });
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b", link: a });
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: b }]));
  const blocking = graph.conflicts().find(item => item.severity === "blocking")!;
  expect(graph.acknowledge(blocking.id)).toEqual({ ok: false });
  expect(graph.blockingFor(a, "item.edit")?.id).toBe(blocking.id);
  expect(graph.blockingFor(a, "other.action")).toBeUndefined();
  expect(graph.blockingFor(target, "item.edit")).toBeUndefined();
  // Worst first.
  expect(graph.conflicts().map(item => item.severity)[0]).toBe("blocking");
});

test("fixes: a conflict or route that's gone is refused, a route that only acknowledges changes nothing, and a fix that would add a blocking conflict is undone", () => {
  const rule = defineRule({ id: "odd", owner: "t", subject: [ITEM], severity: "warning", evaluate: (subject, context) => {
    const title = context.resolve(subject, ["title"]);
    return title === "odd" ? [{ sentence: "odd", kind: "disagreement", routes: [
      { id: "leave", label: "Leave it", consequence: "", patch: [{ op: "acknowledge", conflict: "?" } as never] },
      { id: "loop", label: "Make a loop", consequence: "", patch: [{ op: "set", node: subject, path: ["link"], value: subject }] },
      { id: "even", label: "Even", consequence: "", patch: [{ op: "set", node: subject, path: ["title"], value: "even" }] },
    ] }] : [];
  } });
  const everywhere = defineRule({ id: "count", owner: "t", subject: "*", scope: "global", severity: "notice", evaluate: (_subject, context) =>
    context.nodes(GROUP).length > 1 ? [{ sentence: "many groups", key: "groups" }] : [] });
  const { graph } = harness({ extra: { rules: [...SYNTHETIC_RULES, rule, everywhere] } });
  const node = create(graph, ITEM, { title: "odd" });
  const conflict = graph.conflicts(node).find(item => item.rule === "odd")!;
  expect(conflict.kind).toBe("disagreement");
  expect(graph.fix("gone", "even").ok).toBe(false);
  const noRoute = graph.fix(conflict.id, "none");
  expect(noRoute.ok ? "" : noRoute.reason).toBe("missing");
  const leave = graph.fix(conflict.id, "leave");
  expect(leave.ok ? "" : leave.reason).toBe("empty");
  const loop = graph.fix(conflict.id, "loop");
  expect(loop.ok ? "" : loop.reason).toBe("conflict");
  expect(graph.resolve(node, ["link"])).toBeUndefined();
  expect(graph.fix(conflict.id, "even").ok).toBe(true);
  expect(graph.undoLabels("graph")).toEqual(["Even"]);
  // A global rule is evaluated for every node, whatever changed.
  create(graph, GROUP, { label: "one" });
  expect(graph.conflicts().some(item => item.rule === "count")).toBe(false);
  create(graph, GROUP, { label: "two" });
  // Every node is its subject, so every node has one.
  expect(graph.conflicts().filter(item => item.rule === "count").length).toBe(graph.list().length);
  expect(graph.conflictIndex()).toEqual(graph.evaluateAll());
});

// ---------------------------------------------------------------------------------------------------------------
// Undo at its edges
// ---------------------------------------------------------------------------------------------------------------

test("undo stacks by scope: labels, defaults, forgetting one scope, and a step whose history has left the ring", () => {
  const session = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", ring: 1, fields: { x: { kind: "value" } } });
  const graph = graphOf([...SYNTHETIC_TYPES, session]);
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "b" }], { label: "Retitle" }));
  ok(graph.commit([{ op: "rename", node: a, name: "named" }], { scope: "names" }));
  expect(graph.undoLabels()).toEqual(["", "Retitle"]);
  expect(graph.undoStack().length).toBe(2);
  expect(graph.undoStack("names").length).toBe(1);
  expect(graph.canRedo()).toBe(false);
  graph.forgetHistory("names");
  expect(graph.canUndo("names")).toBe(false);
  expect(graph.canUndo()).toBe(true);
  expect(graph.undoLabels("nowhere")).toEqual([]);
  const pose = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 1 } }], { scope: "poses" })).created.p;
  ok(graph.commit([{ op: "set", node: pose, path: ["x"], value: 2 }], { scope: "poses" }));
  ok(graph.commit([{ op: "set", node: pose, path: ["x"], value: 3 }], { scope: "poses" }));
  expect(ok(graph.undo("poses")).ok).toBe(true);
  const early = graph.undo("poses");
  expect(early.ok ? "" : early.reason).toBe("unloaded");
  graph.forgetHistory();
  expect(graph.canUndo()).toBe(false);
});

test("undoing a creation retracts the node, and redo brings it back; a redo that no longer changes anything is refused and kept", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  ok(graph.undo());
  expect(graph.exists(a)).toBe(false);
  ok(graph.redo());
  expect(graph.exists(a)).toBe(true);
  ok(graph.commit([{ op: "trash", node: a }]));
  ok(graph.undo());
  expect(graph.read(a)?.trashed).toBe(false);
  // The trash was undone; a trash in another scope makes redoing it change nothing: refused, and kept.
  ok(graph.commit([{ op: "trash", node: a }], { scope: "other" }));
  const redo = graph.redo();
  expect(redo.ok ? "" : redo.reason).toBe("empty");
  expect(graph.canRedo()).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------------------------------------------

test("subscriptions whose token already ended never start; everything-subscriptions share one demand until the last ends", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const done = new Aborter();
  done.abort();
  const seen: unknown[] = [];
  graph.subscribe(a, change => seen.push(change), { signal: done.signal });
  graph.subscribeAll(set => seen.push(set), { signal: done.signal });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "b" }]));
  expect(seen).toEqual([]);
  const first = new Aborter(), second = new Aborter();
  const sets: ChangeSet[] = [];
  graph.subscribeAll(set => sets.push(set), { signal: first.signal });
  graph.subscribeAll(set => sets.push(set), { signal: second.signal });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "c" }]));
  expect(sets.length).toBe(2);
  first.abort();
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "d" }]));
  expect(sets.length).toBe(3);
  second.abort();
  const nodes = graph.env.allNodes().length;
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "e" }]));
  expect(sets.length).toBe(3);
  expect(graph.env.allNodes().length).toBe(nodes);
});

test("a follows subscription rewires as the references it follows change, and names what it came through", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b" });
  const holder = create(graph, ITEM, { title: "h", link: a });
  const changes: NodeChange[] = [];
  const life = new Aborter();
  graph.subscribe(holder, change => changes.push(change), { signal: life.signal, follows: true });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  expect(changes.at(-1)?.via.map(ref => ref.id)).toEqual([a.id]);
  ok(graph.commit([{ op: "set", node: holder, path: ["link"], value: b }]));
  ok(graph.commit([{ op: "set", node: b, path: ["title"], value: "b2" }]));
  expect(changes.at(-1)?.via.map(ref => ref.id)).toEqual([b.id]);
  const count = changes.length;
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a3" }]));
  expect(changes.length).toBe(count);
  life.abort();
});

// ---------------------------------------------------------------------------------------------------------------
// Compaction, collapse and purge refusals
// ---------------------------------------------------------------------------------------------------------------

test("compaction, collapse and purge refuse what they can't do", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const starter = { type: ITEM, id: constantId(ITEM, "starter") };
  const nobody = { type: ITEM, id: "00000000-0000-4000-8000-0000000000ff" };
  for (const target of [starter, nobody]) {
    expect(((await drive(scheduler, graph.compact(target))) as { reason?: string }).reason).toBe("missing");
    expect(((await drive(scheduler, graph.collapseInline(target))) as { reason?: string }).reason).toBe("missing");
    expect(((await drive(scheduler, graph.purge(target))) as { reason?: string }).reason).toBe("missing");
  }
  const a = create(graph, ITEM, { title: "a" });
  // Nothing references it: it can't be collapsed.
  expect(((await drive(scheduler, graph.collapseInline(a))) as { reason?: string }).reason).toBe("dependents");
  // Two compactions of one node at once: the second is refused as busy.
  await drive(scheduler, graph.flush());
  const first = graph.compact(a), second = graph.compact(a);
  expect(((await drive(scheduler, second)) as { reason?: string }).reason).toBe("busy");
  expect((await drive(scheduler, first)).ok).toBe(true);
  // A node with nothing acknowledged yet compacts nothing.
  const fresh = create(graph, ITEM, { title: "fresh" });
  const compaction = graph.compact(fresh);
  await drive(scheduler, compaction);
});

test("purging an inlined node another node layers from is refused unless forced; its host keeps the other nodes inlined with it", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  const host = create(graph, GROUP, { label: "host" });
  ok(graph.commit([{ op: "set", node: host, path: ["members", "x"], value: x }]));
  ok(graph.commit([{ op: "set", node: host, path: ["members", "y"], value: y }]));
  await drive(scheduler, graph.flush());
  expect((await drive(scheduler, graph.collapseInline(x))).ok).toBe(true);
  const dependent = ok(graph.commit([{ op: "create", type: ITEM, as: "d", from: { fork: x } }])).created.d;
  expect(((await drive(scheduler, graph.purge(x))) as { reason?: string; dependents?: NodeRef[] }).dependents).toEqual([dependent]);
  expect((await drive(scheduler, graph.purge(x, { force: true }))).ok).toBe(true);
  expect(graph.exists(x)).toBe(false);
  expect(graph.resolve(y, ["title"])).toBe("y");
  expect(graph.inlinedIn(x)).toBeUndefined();
});

test("a commit before a stored graph loads is refused as unloaded", () => {
  const scheduler = new Scheduler();
  const graph = createGraph({ types: SYNTHETIC_TYPES, store: new SimStore(new MemoryStore(), scheduler), sources: sources(scheduler), signal: new Aborter().signal });
  const result = graph.commit([{ op: "create", type: ITEM, as: "a" }]);
  expect(result.ok ? "" : result.reason).toBe("unloaded");
});

test("issues come from the type's validation of the effective value, now and in a view of the past", async () => {
  const checked = defineType({ type: "checked", owner: "t", schema: "1", fields: { n: { kind: "value" } },
    validate: value => typeof value.n === "number" && value.n < 0 ? [{ path: ["n"], message: "negative" }] : [] });
  const graph = graphOf([checked]);
  const node = ok(graph.commit([{ op: "create", type: "checked", as: "c", fields: { n: -1 } }])).created.c;
  const before = graph.position;
  ok(graph.commit([{ op: "set", node, path: ["n"], value: 1 }]));
  expect(graph.issues(node)).toEqual([]);
  expect((await graph.at(before)).issues(node)).toEqual([{ path: ["n"], message: "negative" }]);
  expect(graph.issues({ type: "checked", id: "nobody" })).toEqual([]);
  expect(graph.issues({ type: "unknown", id: "nobody" })).toEqual([]);
});

test("derivations: an unknown name, a missing node, a derivation cycle, and values memoised until something they read changes", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b", link: a });
  expect(graph.derive(a, "nope")).toEqual({ ok: false, reason: "unknown" });
  expect(graph.derive({ type: ITEM, id: "nobody" }, "summary")).toEqual({ ok: false, reason: "missing" });
  expect(graph.derive(b, "summary")).toEqual({ ok: true, value: "b > a" });
  expect(graph.derive(b, "summary")).toBe(graph.derive(b, "summary"));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  expect(graph.derive(b, "summary")).toEqual({ ok: true, value: "b > a2" });
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: b }]));
  const cycle = graph.derive(b, "summary");
  expect(cycle.ok).toBe(false);
  expect(!cycle.ok && cycle.reason).toBe("cycle");
});

test("recovery after a restart: a commit the store already has is skipped, one whose basis moved is rejected, the rest are applied again", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const lives: Aborter[] = [];
  const open = async () => {
    const life = new Aborter();
    lives.push(life);
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler, `recover ${session++}`), signal: life.signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  const first = await open();
  const a = create(first, ITEM, { title: "a" }), b = create(first, ITEM, { title: "b" });
  await drive(scheduler, first.flush());
  const stored = ok(first.commit([{ op: "set", node: a, path: ["title"], value: "stored" }]));
  await drive(scheduler, first.flush());
  const stale = ok(first.commit([{ op: "set", node: b, path: ["title"], value: "stale" }]));
  const fresh = ok(first.commit([{ op: "set", node: a, path: ["title"], value: "fresh" }]));
  const copy = first.pending();
  expect(copy.map(item => item.commit)).toEqual([stale.commit, fresh.commit]);
  // The window crashes: its appends never reach the store.
  lives[0].abort("crash");
  scheduler.drop();
  // Another window changes b before the restart.
  const other = await open();
  ok(other.commit([{ op: "set", node: b, path: ["title"], value: "theirs" }]));
  await drive(scheduler, other.flush());
  const second = await open();
  const recovery = [{ commit: stored.commit, entries: (await drive(scheduler, second.history(a))).filter(entry => entry.commit === stored.commit), expect: [[a.id, 1]] as [string, number][] }, ...copy];
  expect(second.recover(recovery)).toEqual({ applied: 1, skipped: 1, rejected: 1 });
  expect(second.acknowledged(stored.commit)).toBe(true);
  expect(second.rejected().map(item => item.commit)).toEqual([stale.commit]);
  await drive(scheduler, second.flush());
  expect(second.resolve(a, ["title"])).toBe("fresh");
  expect(second.resolve(b, ["title"])).toBe("theirs");
  second.clearRejected();
  expect(second.rejected()).toEqual([]);
});

test("a window that falls behind by more than one entry of a node loads that node's stream again when it catches up", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler, `behind ${session++}`), signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  const writer = await open();
  const a = create(writer, ITEM, { title: "a" });
  await drive(scheduler, writer.flush());
  const reader = await open();
  for (let i = 0; i < 3; i++) ok(writer.commit([{ op: "set", node: a, path: ["title"], value: `w${i}` }]));
  await drive(scheduler, writer.flush());
  // The reader's copy of the store's log misses the middle entry (as if compacted away before it read it).
  const log = memory.allEntries();
  const middle = log.find(entry => entry.node.id === a.id && entry.seq === 3)!;
  (memory as unknown as { log: Entry[] }).log = log.filter(entry => entry !== middle);
  expect((await drive(scheduler, reader.sync())).applied).toBe(2);
  expect(reader.resolve(a, ["title"])).toBe("w2");
  expect(reader.seqOf(a)).toBe(4);
});

test("change sets: labels, node order, and only the latest 64 kept for commits made while a cycle ran", () => {
  const { graph } = harness();
  const nodes = Array.from({ length: 3 }, (_, i) => create(graph, ITEM, { title: `n${i}` }));
  const result = ok(graph.commit(nodes.map(node => ({ op: "set" as const, node, path: ["title"], value: "x" })), { label: "Retitle all" }));
  expect(result.changes.label).toBe("Retitle all");
  // Every node the commit touched, sorted by ID.
  const ids = result.changes.nodes.map(change => change.node.id);
  expect(ids).toEqual([...ids].sort());
  const sets: ChangeSet[] = [];
  const life = new Aborter();
  graph.subscribeAll(set => sets.push(set), { signal: life.signal });
  for (let i = 0; i < 70; i++) ok(graph.commit([{ op: "set", node: nodes[i % 3], path: ["title"], value: `v${i}` }]));
  expect(sets.length).toBe(70);
  expect(new Set(sets.map(set => set.commit)).size).toBe(70);
  life.abort();
});

test("the inspector's depth follows the longest layer chain, and a layer cycle that reached memory doesn't loop", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: a } }])).created.b;
  const c = ok(graph.commit([{ op: "create", type: ITEM, as: "c", from: { fork: b } }])).created.c;
  ok(graph.commit([{ op: "feed", node: c, from: a, paths: [["tags"]] }]));
  expect(graph.inspectorRow(c)?.depth).toBe(2);
  // Two nodes with the same name sort by ID; names sort before that.
  const twin1 = create(graph, ITEM, { title: "t" }, { name: "same" }), twin2 = create(graph, ITEM, { title: "t" }, { name: "same" });
  const rows = graph.inspect("name:same").rows.map(row => row.ref.id);
  expect(rows).toEqual([twin1.id, twin2.id].sort());
  expect(graph.inspect("name:same", 1).rows.length).toBe(1);
});

test("resolution of what isn't there: an unknown type, a path the type lacks, a missing layer source, and map keys in a layer cycle", async () => {
  const { graph } = harness();
  expect(graph.resolve({ type: "unknown", id: "x" })).toBeUndefined();
  expect(graph.resolve({ type: "unknown", id: "x" }, ["title"])).toBeUndefined();
  const a = create(graph, ITEM, { title: "a", tags: { k: 1 } });
  expect(graph.resolve(a, ["nope"])).toBeUndefined();
  expect(graph.resolve(a, ["tags"])).toEqual({ base: 1, k: 1 });
  expect(graph.origin(a, ["tags"])).toEqual({ via: "absent" });
  expect(graph.origin(a, ["nope"])).toEqual({ via: "absent" });
  // A fork whose base is purged reads its defaults (the base is gone).
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: a } }])).created.f;
  expect(graph.resolve(fork, ["tags"])).toEqual({ base: 1, k: 1 });
  expect((await graph.purge(a, { force: true })).ok).toBe(true);
  expect(graph.resolve(fork, ["tags"])).toEqual({ base: 1 });
  expect(graph.resolve(fork, ["title"])).toBe("untitled");
  expect(graph.read({ type: ITEM, id: "nobody" })).toBeUndefined();
  expect(graph.references({ type: ITEM, id: "nobody" })).toEqual([]);
});

test("a derivation that throws throws to its reader; derivations reading a missing node, and views of the past, answer from what they can see", async () => {
  const shaky = defineType({ type: "shaky", owner: "t", schema: "1", fields: { n: { kind: "value" }, next: { kind: "ref", to: "shaky", clone: "share", follows: true } },
    derive: {
      boom: () => { throw new Error("kaput"); },
      chain: context => { const next = context.resolve(context.node, ["next"]) as NodeRef | undefined; return next ? context.derived(next, "chain") ?? "end" : "end"; },
      both: context => [context.derived(context.node, "chain"), context.derived(context.node, "chain")],
    } });
  const graph = graphOf([shaky]);
  const a = ok(graph.commit([{ op: "create", type: "shaky", as: "a", fields: { n: 1 } }])).created.a;
  const b = ok(graph.commit([{ op: "create", type: "shaky", as: "b", fields: { n: 2, next: a } }])).created.b;
  expect(() => graph.derive(a, "boom")).toThrow("kaput");
  expect(graph.derive(b, "chain")).toEqual({ ok: true, value: "end" });
  expect(graph.derive(b, "both")).toEqual({ ok: true, value: ["end", "end"] });
  const before = graph.position;
  // b follows a gone node: the derivation it reads is missing and reads as nothing.
  ok(graph.commit([{ op: "set", node: b, path: ["next"], value: { type: "shaky", id: "00000000-0000-4000-8000-000000000000" } }]));
  expect(graph.derive(b, "chain")).toEqual({ ok: true, value: "end" });
  const past = await graph.at(before);
  expect(past.referrers(a).map(item => item.node.id)).toEqual([b.id]);
  expect(past.references(b).map(item => item.target.id)).toEqual([a.id]);
  expect(past.derive(b, "chain")).toEqual({ ok: true, value: "end" });
  expect(graph.referrers(a)).toEqual([]);
});
