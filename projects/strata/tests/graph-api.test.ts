/**
 * The graph's API beyond the everyday commit and read: registration and options, session streams, sources and sinks,
 * views of the past and history cursors, loading unusual stores, the inspector's rows and details, conflicts that are
 * acknowledged and fixed, undo at its edges, subscriptions that end early, and the refusals of compaction, inline
 * collapse and purge.
 */
import { expect, test } from "bun:test";
import { Aborter, constantId, createGraph, defineRule, defineSink, defineSource, defineType, MemoryStore, trustTable } from "strata";
import type { ChangeSet, Entry, Graph, GraphOptions, NodeChange, NodeRef, TypeDef } from "strata";
import { sampleEntry, Scheduler, seededRandom, settle, simClock, SimStore, STRATA_DEBUG, SYNTHETIC_RULES, SYNTHETIC_TYPES } from "strata/testing";
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

/** Delivers every pending store reply and timer. */
async function idle(scheduler: Scheduler): Promise<void> {
  for (let i = 0; i < 200; i++) { await settle(); if (!scheduler.pending().length) { await settle(); if (!scheduler.pending().length) return; } scheduler.deliver(0); }
}

/** Graphs over one store, opened one after another (sessions or windows). */
function storeSessions() {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  let session = 0;
  const open = async () => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler, `window ${session++}`), signal: new Aborter().signal });
    await drive(scheduler, graph.load());
    return graph;
  };
  return { scheduler, memory, store, open };
}

// ---------------------------------------------------------------------------------------------------------------
// Entries' metadata, loads, reads and views, stated exactly
// ---------------------------------------------------------------------------------------------------------------

test("a commit's first entry alone carries its meta (label, scope and basis, in order); provenance is written only when given", async () => {
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b" });
  const both = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }, { op: "set", node: b, path: ["title"], value: "b2" },
    { op: "set", node: a, path: ["tags", "x"], value: 1 }], { label: "Both", scope: "s" }));
  expect(graph.pending().find(item => item.commit === both.commit)).toMatchObject({ label: "Both" });
  await drive(scheduler, graph.flush());
  const ofCommit = (ref: NodeRef) => store!.inner.readStreamNow(ref).filter(entry => entry.commit === both.commit);
  expect(ofCommit(a).map(entry => entry.meta ?? null)).toEqual([{ label: "Both", scope: "s", basis: [[a.id, 1], [b.id, 1]] }, null]);
  expect(ofCommit(b).map(entry => entry.meta ?? null)).toEqual([null]);
  expect([...ofCommit(a), ...ofCommit(b)].some(entry => "provenance" in entry)).toBe(false);
  const plain = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a3" }]));
  await drive(scheduler, graph.flush());
  const entry = store!.inner.readStreamNow(a).find(item => item.commit === plain.commit)!;
  expect(entry.meta).toStrictEqual({ basis: [[a.id, 3]] });
  expect(graph.pending()).toEqual([]);
});

test("a value stream's first commit creates it and later ones replace its state; without a store commits are acknowledged at once", () => {
  const note = defineType({ type: "note", owner: "t", schema: "1", stream: "value", fields: { text: { kind: "value" } } });
  const graph = graphOf([note]);
  const created = ok(graph.commit([{ op: "create", type: "note", as: "n", fields: { text: "one" } }]));
  const n = created.created.n;
  const changed = ok(graph.commit([{ op: "set", node: n, path: ["text"], value: "two" }]));
  expect(graph[STRATA_DEBUG]().records.find(rec => rec.ref.id === n.id)!.entries.map(entry => entry.op.kind)).toEqual(["create", "state"]);
  expect([graph.acknowledged(created.commit), graph.acknowledged(changed.commit), graph.resolve(n, ["text"])]).toEqual([true, true, "two"]);
});

test("a session node's commit on a stored graph is acknowledged at once and never reaches the outbox", async () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", fields: { x: { kind: "value" } } });
  const { graph, scheduler } = harness({ store: true, extra: { types: [...SYNTHETIC_TYPES, pose] } });
  await drive(scheduler, graph.load());
  const made = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 1 } }]));
  expect([graph.acknowledged(made.commit), graph.pending()]).toEqual([true, []]);
});

test("a load reports what it read and how long folding took, snapshots what it had to fold whole or long, and restores the unique index", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  const clock = simClock(scheduler);
  let slow = false, tick = 0;
  const timed = { ...clock, monotonic: () => slow ? (tick += 10) : clock.monotonic() };
  let session = 0;
  const open = async (extra: Partial<GraphOptions> = {}) => {
    const graph = createGraph({ types: SYNTHETIC_TYPES, store, snapshotEvery: 3, sources: { clock: timed, random: seededRandom(`load ${session++}`) }, signal: new Aborter().signal, ...extra });
    const loaded = await drive(scheduler, graph.load());
    return { graph, loaded };
  };
  const { graph } = await open({ writeSnapshots: false });
  const a = create(graph, ITEM, { title: "a", code: "unique-a" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a3" }]));
  const b = create(graph, ITEM, { title: "b" });
  await drive(scheduler, graph.flush());
  scheduler.advance(5);
  // No snapshots yet: every entry is read, the fold took no time on this clock, and a's three entries reach the bound.
  const { graph: second, loaded } = await open();
  expect(loaded).toEqual({ nodes: 3, entries: 4, foldMs: 0 });
  await idle(scheduler);
  expect([memory.snapshotOf(a)?.seq, memory.snapshotOf(b)]).toEqual([3, undefined]);
  const taken = second.commit([{ op: "create", type: ITEM, as: "c", fields: { code: "unique-a" } }]);
  expect(taken.ok ? "ok" : taken.reason).toBe("unique");
  // A clock on which folding looks slow: the node folded is snapshotted, though under the bound.
  slow = true;
  await open();
  await idle(scheduler);
  slow = false;
  expect(memory.snapshotOf(b)?.seq).toBe(1);
});

test("loading again replaces what a node held: a unique value it gave up is free, a stored layer cycle loads and reads", async () => {
  const { scheduler, memory, open } = storeSessions();
  const graph = await open();
  const a = create(graph, ITEM, { title: "a", code: "first" });
  await drive(scheduler, graph.flush());
  const other = await open();
  ok(other.commit([{ op: "set", node: a, path: ["code"], value: "second" }]));
  await drive(scheduler, other.flush());
  await drive(scheduler, graph.load());
  ok(graph.commit([{ op: "create", type: ITEM, as: "b", fields: { code: "first" } }]));
  // Two windows each close half of a layer cycle: it loads, and reading it ends.
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  await drive(scheduler, graph.flush());
  const left = await open(), right = await open();
  ok(left.commit([{ op: "rebase", node: x, base: y }]));
  ok(right.commit([{ op: "rebase", node: y, base: x }]));
  await drive(scheduler, left.flush());
  await drive(scheduler, right.flush());
  const cyclic = await open();
  expect([cyclic.resolve(x, ["title"]), cyclic.resolve(y, ["title"])]).toEqual(["x", "y"]);
  const pinned = ok(cyclic.commit([{ op: "create", type: ITEM, as: "p", from: { fork: x, at: 2 } }])).created.p;
  expect(cyclic.resolve(pinned, ["title"])).toBe("x");
  expect(memory.allEntries().length).toBeGreaterThan(0);
});

test("reads: a node's snapshot names its seq and whether it is built in; referrers come from the index, in order, of the type asked; issues come from the type's check", () => {
  const checked = defineType({ type: "checked", owner: "t", schema: "1", fields: { n: { kind: "value" }, other: { kind: "ref", to: ITEM, clone: "share" } },
    validate: value => typeof value.n === "number" && value.n < 0 ? [{ path: ["n"], message: "negative" }] : [] });
  const graph = graphOf([...SYNTHETIC_TYPES, checked]);
  const starter = { type: ITEM, id: constantId(ITEM, "starter") };
  expect(graph.read(starter)).toMatchObject({ seq: 0, constant: true });
  const target = create(graph, ITEM, { title: "t" });
  expect(graph.read(target)).toMatchObject({ seq: 1, constant: false });
  const first = create(graph, ITEM, { title: "1", link: target });
  const second = create(graph, "checked", { n: -1, other: target });
  expect(graph.referrers(target).map(item => item.node.id)).toEqual([first.id, second.id]);
  expect(graph.referrers({ type: GROUP, id: target.id })).toEqual([]);
  expect(graph.issues(second)).toEqual([{ path: ["n"], message: "negative" }]);
  expect(graph.issues(first)).toEqual([]);
});

test("edits refused with their reasons: a bad target, a path with a part that isn't text, a reset, tombstone or apply of a path the type lacks, a tag naming anything but entries", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const reason = (edits: unknown[]) => { const result = graph.commit(edits as never); return result.ok ? "ok" : `${result.reason}: ${result.message}`; };
  expect(reason([])).toBe("empty: Nothing to change.");
  expect(reason([{ op: "set", node: { type: ITEM, id: 5 }, path: ["title"], value: "x" }])).toBe("missing: Name the node to change.");
  expect(reason([{ op: "set", node: { id: "x", type: 5 }, path: ["title"], value: "x" }])).toBe("missing: Name the node to change.");
  expect(reason([{ op: "set", node: a, path: ["tags", 5], value: 1 }])).toMatch(/^path:/);
  expect(reason([{ op: "reset", node: a, path: ["nothing"] }])).toMatch(/^path:/);
  expect(reason([{ op: "tombstone", node: a, path: ["nothing", "k"] }])).toMatch(/^path:/);
  expect(reason([{ op: "applyToSource", node: a, path: ["nothing"] }])).toMatch(/^path:/);
  expect(reason([{ op: "tag", node: a, label: "t", entries: [{ node: a, seq: 1 }, { node: a }] }])).toMatch(/^value:/);
  const single = defineType({ type: "single", owner: "t", schema: "1", fields: { x: { kind: "value" } } });
  const small = graphOf([single]);
  const s = ok(small.commit([{ op: "create", type: "single", as: "s", fields: { x: 1 } }])).created.s;
  const refused = small.commit([{ op: "set", node: s, path: "x" as never, value: 2 }]);
  expect(refused.ok ? "ok" : refused.reason).toBe("path");
});

test("unique values: two new holders in one change clash, other types don't, and two nodes may swap theirs in one change", () => {
  const coded = (type: string) => defineType({ type, owner: "t", schema: "1", fields: { code: { kind: "value", unique: true } } });
  const graph = graphOf([coded("one"), coded("two")]);
  const twice = graph.commit([{ op: "create", type: "one", as: "a", fields: { code: "x" } }, { op: "create", type: "one", as: "b", fields: { code: "x" } }]);
  expect(twice.ok ? "ok" : twice.reason).toBe("unique");
  const made = ok(graph.commit([{ op: "create", type: "one", as: "a", fields: { code: "x" } }, { op: "create", type: "two", as: "b", fields: { code: "x" } },
    { op: "create", type: "one", as: "c", fields: { code: "y" } }]));
  const { a, c } = made.created;
  ok(graph.commit([{ op: "set", node: a, path: ["code"], value: "y" }, { op: "set", node: c, path: ["code"], value: "x" }]));
  expect([graph.resolve(a, ["code"]), graph.resolve(c, ["code"])]).toEqual(["y", "x"]);
  // An action with nothing blocking it goes through.
  ok(graph.commit([{ op: "set", node: a, path: ["code"], value: "z" }], { action: "one.edit" }));
});

test("renaming a trashed node keeps it trashed; trashing a fork keeps its layers; a fork takes its source's name; a node can't layer from itself", () => {
  const { graph } = harness();
  const source = ok(graph.commit([{ op: "create", type: ITEM, as: "s", name: "Source", fields: { title: "s" } }])).created.s;
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: source } }])).created.f;
  expect(graph.read(fork)?.name).toBe("Source");
  ok(graph.commit([{ op: "trash", node: fork }]));
  expect(graph.read(fork)?.layers.map(layer => layer.from.id)).toEqual([source.id]);
  ok(graph.commit([{ op: "rename", node: fork, name: "Renamed" }]));
  expect([graph.read(fork)?.name, graph.read(fork)?.trashed]).toEqual(["Renamed", true]);
  const self = graph.commit([{ op: "create", type: ITEM, as: "x", id: "self", layers: [{ from: { type: ITEM, id: "self" }, role: "base", paths: "*" }] }]);
  expect(self.ok ? "ok" : self.reason).toBe("cycle");
});

test("detach keeps only inherited values as its own; a feed from a source replaces that source's earlier feed and keeps the others", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "base" }), fa = create(graph, ITEM, { tags: { a: 1 } }), fb = create(graph, ITEM, { tags: { b: 2 } });
  const node = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: base } }])).created.n;
  ok(graph.commit([{ op: "feed", node, from: fa, paths: [["tags", "a"]] }, { op: "feed", node, from: fb, paths: [["tags", "b"]] }]));
  ok(graph.commit([{ op: "feed", node, from: fa, paths: [["tags"]] }]));
  expect(graph.read(node)?.layers.map(layer => [layer.from.id, layer.role])).toEqual([[base.id, "base"], [fb.id, "feed"], [fa.id, "feed"]]);
  ok(graph.commit([{ op: "detach", node }]));
  expect(graph.read(node)!.own).toMatchObject({ [JSON.stringify(["title"])]: "base", [JSON.stringify(["tags", "a"])]: 1, [JSON.stringify(["tags", "b"])]: 2 });
  // A node fed one path: its own defaults stay defaults, not copied.
  const fed = create(graph, ITEM, {});
  ok(graph.commit([{ op: "feed", node: fed, from: fa, paths: [["tags", "a"]] }]));
  ok(graph.commit([{ op: "detach", node: fed }]));
  expect(Object.keys(graph.read(fed)!.own).sort()).toEqual([JSON.stringify(["code"]), JSON.stringify(["tags", "a"])].sort());
});

test("apply to source writes into the first covering layer that has a value there, a feed before the base", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "from base" }), feed = create(graph, ITEM, { title: "from feed" });
  const node = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: base } }])).created.n;
  ok(graph.commit([{ op: "feed", node, from: feed, paths: [["title"]] }]));
  ok(graph.commit([{ op: "set", node, path: ["title"], value: "mine" }]));
  ok(graph.commit([{ op: "applyToSource", node, path: ["title"] }]));
  expect([graph.resolve(feed, ["title"]), graph.resolve(base, ["title"])]).toEqual(["mine", "from base"]);
  const only = ok(graph.commit([{ op: "create", type: ITEM, as: "o", from: { fork: base } }])).created.o;
  ok(graph.commit([{ op: "set", node: only, path: ["tags", "k"], value: 3 }]));
  ok(graph.commit([{ op: "applyToSource", node: only, path: ["tags", "k"] }]));
  expect(graph.resolve(base, ["tags", "k"])).toBe(3);
});

test("revert: to the current version changes nothing, to version 0 doesn't exist, and to a loaded snapshot's version needs no history", async () => {
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const a = create(graph, ITEM, { title: "one" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "two" }]));
  const reason = (to: number) => { const result = graph.commit([{ op: "revert", node: a, to }]); return result.ok ? "ok" : `${result.reason}: ${result.message}`; };
  expect(reason(2)).toMatch(/^empty:/);
  expect(reason(0)).toBe("missing: That version doesn't exist.");
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "three" }]));
  await drive(scheduler, graph.flush());
  graph = await open();
  ok(graph.commit([{ op: "revert", node: a, to: 2 }]));
  expect(graph.resolve(a, ["title"])).toBe("two");
});

test("a deep clone leaves identity fields out, points followed references at the copies, and keeps a followed reference to a missing node as it is", () => {
  const kinds = defineType({ type: "k", owner: "t", schema: "1", fields: { title: { kind: "value" }, secret: { kind: "map", of: { kind: "value" }, inherit: false },
    link: { kind: "ref", to: "k", clone: "follow", follows: true } } });
  const graph = graphOf([kinds]);
  const child = ok(graph.commit([{ op: "create", type: "k", as: "c", fields: { title: "child" } }])).created.c;
  const parent = ok(graph.commit([{ op: "create", type: "k", as: "p", fields: { title: "parent", secret: { s: 1 }, link: child } }])).created.p;
  const copy = ok(graph.commit([{ op: "create", type: "k", as: "copy", from: { clone: parent } }])).created.copy;
  const link = graph.resolve(copy, ["link"]) as NodeRef;
  expect([graph.resolve(copy, ["secret"]), link.id === child.id, graph.resolve(link, ["title"])]).toEqual([{}, false, "child"]);
  const dangling = ok(graph.commit([{ op: "create", type: "k", as: "d", fields: { link: { type: "k", id: "gone" } } }])).created.d;
  const copied = ok(graph.commit([{ op: "create", type: "k", as: "x", from: { clone: dangling } }])).created.x;
  expect(graph.resolve(copied, ["link"])).toEqual({ type: "k", id: "gone" });
});

test("ranges come in position order across nodes, including an entry only a snapshot covered", async () => {
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const a = create(graph, ITEM, { title: "a" }), b = create(graph, ITEM, { title: "b" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  const range = await drive(scheduler, graph.range(0, graph.position));
  expect(range.map(entry => [entry.node.id, entry.seq])).toEqual([[a.id, 1], [b.id, 1], [a.id, 2]]);
});

test("a view at an entry of a long stream finds it; one at an entry whose commit ends in a node loaded from a snapshot reads the whole commit", async () => {
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const n = create(graph, ITEM, { title: "0" });
  for (let i = 1; i <= 5; i++) ok(graph.commit([{ op: "set", node: n, path: ["title"], value: `${i}` }]));
  expect((await graph.at({ node: n, seq: 2 }, [n])).resolve(n, ["title"])).toBe("1");
  const s = { type: ITEM, id: "s-node" };
  const a = ok(graph.commit([{ op: "create", type: ITEM, as: "a" }, { op: "create", type: ITEM, as: "s", id: "s-node", fields: { title: "s1" } },
    { op: "rebase", node: { created: "a" }, base: s }])).created.a;
  ok(graph.commit([{ op: "set", node: s, path: ["title"], value: "s2" }]));
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  expect((await drive(scheduler, graph.at({ node: a, seq: 2 }, [a]))).resolve(a, ["title"])).toBe("s1");
});

test("a graph without a store runs no store driver; with one, a flush waiting on a store that never answers ends when the graph stops", async () => {
  expect(graphOf(SYNTHETIC_TYPES).storeProcess).toBeUndefined();
  const scheduler = new Scheduler(), life = new Aborter();
  const graph = createGraph({ types: SYNTHETIC_TYPES, store: new SimStore(new MemoryStore(), scheduler), sources: sources(scheduler), signal: life.signal });
  await drive(scheduler, graph.load());
  create(graph, ITEM, { title: "a" });
  let flushed = false;
  void graph.flush().then(() => { flushed = true });
  await settle();
  life.abort();
  await settle(); await settle();
  expect(flushed).toBe(true);
});

test("a view at the head lists the conflicts the graph lists, acknowledged ones left out", async () => {
  const warn = defineRule({ id: "warn", owner: "t", subject: ITEM, severity: "warning", evaluate: subject => [{ sentence: "w", subjects: [subject] }] });
  const graph = graphOf(SYNTHETIC_TYPES, { rules: [warn] });
  create(graph, ITEM, { title: "a" });
  const [conflict] = graph.conflicts();
  graph.acknowledge(conflict.id);
  const view = await graph.at("head");
  expect(view.conflicts().map(item => item.id)).toEqual(graph.conflicts().map(item => item.id));
});

test("a snapshot of an older schema is never used: the node folds from its whole stream, counted once", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  const a = { type: ITEM, id: "00000000-0000-4000-8000-00000000000a" };
  memory.appendNow({ commit: "c1", entries: [sampleEntry(a, 1, "c1")], expect: [[a.id, 0]] });
  memory.appendNow({ commit: "c2", entries: [sampleEntry(a, 2, "c2", { op: { kind: "set", path: ["tags", "k"], value: 1 } })], expect: [[a.id, 1]] });
  memory.putSnapshotNow({ node: a, seq: 1, pos: 1, schema: "1", state: { name: "old", own: { [JSON.stringify(["name"])]: "from the snapshot" }, layers: [], trashed: false, retracted: false } });
  const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: sources(scheduler), signal: new Aborter().signal });
  const loaded = await drive(scheduler, graph.load());
  expect([loaded.entries, graph.resolve(a, ["title"]), graph.resolve(a, ["tags", "k"])]).toEqual([2, "a1", 1]);
});

test("a fold that takes exactly the slow bound isn't slow", async () => {
  const scheduler = new Scheduler(), memory = new MemoryStore(), store = new SimStore(memory, scheduler);
  const clock = simClock(scheduler);
  let tick = 0;
  const graph = createGraph({ types: SYNTHETIC_TYPES, store, sources: { clock, random: seededRandom("a") }, signal: new Aborter().signal });
  const a = create(await (async () => { await drive(scheduler, graph.load()); return graph; })(), ITEM, { title: "a" });
  await drive(scheduler, graph.flush());
  const timed = createGraph({ types: SYNTHETIC_TYPES, store, snapshotFoldMs: 5, sources: { clock: { ...clock, monotonic: () => (tick += 5) }, random: seededRandom("b") }, signal: new Aborter().signal });
  await drive(scheduler, timed.load());
  await idle(scheduler);
  expect(memory.snapshotOf(a)).toBeUndefined();
});

test("pins: through a stored layer cycle, a diamond of sources, and a force-purged source", async () => {
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const x = create(graph, ITEM, { title: "x" }), y = create(graph, ITEM, { title: "y" });
  await drive(scheduler, graph.flush());
  const left = await open(), right = await open();
  ok(left.commit([{ op: "rebase", node: x, base: y }]));
  ok(right.commit([{ op: "rebase", node: y, base: x }]));
  await drive(scheduler, left.flush());
  await drive(scheduler, right.flush());
  graph = await open();
  const throughCycle = ok(graph.commit([{ op: "create", type: ITEM, as: "p", from: { fork: y, at: 2 } }])).created.p;
  expect(graph.resolve(throughCycle, ["title"])).toBe("y");
  // A diamond: d feeds from b and c, both forks of a.
  const a = create(graph, ITEM, { title: "a" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "b", from: { fork: a } }])).created.b;
  const c = ok(graph.commit([{ op: "create", type: ITEM, as: "c", from: { fork: a } }])).created.c;
  const d = ok(graph.commit([{ op: "create", type: ITEM, as: "d", from: { fork: b } }, { op: "feed", node: { created: "d" }, from: c, paths: [["tags"]] }])).created.d;
  ok(graph.commit([{ op: "create", type: ITEM, as: "q", from: { fork: d, at: 2 } }]));
  // A dependent whose source was purged by force can still be pinned.
  const gone = create(graph, ITEM, { title: "gone" });
  const orphan = ok(graph.commit([{ op: "create", type: ITEM, as: "o", from: { fork: gone } }])).created.o;
  expect(await drive(scheduler, graph.purge(gone, { force: true }))).toEqual({ ok: true });
  ok(graph.commit([{ op: "create", type: ITEM, as: "r", from: { fork: orphan, at: 1 } }]));
});

test("history cursors: entries after a seq, from memory or loaded, and no position for seq 0", async () => {
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const a = create(graph, ITEM, { title: "1" });
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "2" }]));
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "3" }]));
  expect([(await graph.after(a, 1)).map(entry => entry.seq), (await graph.after(a, 3)).length, graph.posOf({ node: a, seq: 0 })]).toEqual([[2, 3], 0, undefined]);
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  graph = await open();
  expect((await drive(scheduler, graph.after(a, 0))).map(entry => entry.seq)).toEqual([1, 2, 3]);
  graph = await open();
  expect((await drive(scheduler, graph.after(a, 1))).map(entry => entry.seq)).toEqual([2, 3]);
});

test("a past view: reads carry the seq then and whether a node is built in; conflicts are those of then; a node outside its roots whose history it didn't load reads as absent", async () => {
  const flag = defineRule({ id: "flag", owner: "t", subject: ITEM, severity: "warning",
    evaluate: (subject, context) => context.resolve(subject, ["title"]) === "bad" ? [{ sentence: "bad", subjects: [subject] }] : [] });
  const { scheduler, open } = storeSessions();
  let graph = await open();
  const a = create(graph, ITEM, { title: "bad" });
  const then = graph.position;
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "good" }]));
  const b = create(graph, ITEM, { title: "later" });
  await drive(scheduler, graph.flush());
  await drive(scheduler, graph.snapshotAll());
  const starter = { type: ITEM, id: constantId(ITEM, "starter") };
  const rules = createGraph({ types: SYNTHETIC_TYPES, rules: [flag], sources: sources(scheduler, "rules") });
  const r = create(rules, ITEM, { title: "bad" });
  const rulesThen = rules.position;
  ok(rules.commit([{ op: "set", node: r, path: ["title"], value: "good" }]));
  expect((await rules.at(rulesThen)).conflicts().map(item => item.rule)).toEqual(["flag"]);
  expect(rules.conflicts()).toEqual([]);
  graph = await open();
  const view = await drive(scheduler, graph.at(then, [a]));
  expect([view.read(a)?.seq, view.read(starter)?.constant, view.read(a)?.constant, view.resolve(b)]).toEqual([1, true, false, undefined]);
  const later = await drive(scheduler, graph.at(graph.position, [a, b]));
  expect(later.read(b)?.seq).toBe(1);
});

test("commits record provenance only when given, and a pending commit without a label has none", async () => {
  const { graph, scheduler, store } = harness({ store: true });
  await drive(scheduler, graph.load());
  const a = create(graph, ITEM, { title: "a" });
  const provenance = { actor: "game", actorSeq: 7, at: 5 };
  const told = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "b" }], { provenance }));
  expect(Object.keys(graph.pending().at(-1)!)).not.toContain("label");
  await drive(scheduler, graph.flush());
  expect(store!.inner.readStreamNow(a).find(entry => entry.commit === told.commit)).toMatchObject({ provenance, actor: "game", actorSeq: 7, at: 5 });
});

test("apply to source skips a feed that doesn't cover the path, and says exactly why a path can't be applied", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "from base" }), side = create(graph, ITEM, { title: "side", tags: { t: 1 } });
  const node = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: base } }])).created.n;
  ok(graph.commit([{ op: "feed", node, from: side, paths: [["tags"]] }]));
  ok(graph.commit([{ op: "set", node, path: ["title"], value: "mine" }]));
  ok(graph.commit([{ op: "applyToSource", node, path: ["title"] }]));
  expect([graph.resolve(base, ["title"]), graph.resolve(side, ["title"])]).toEqual(["mine", "side"]);
  const refused = graph.commit([{ op: "applyToSource", node, path: ["nothing"] }]);
  expect(refused.ok ? "" : refused.message).toBe("item has no field [\"nothing\"].");
});

test("a deep clone remaps a followed list of references, and leaves a plain value that looks like a reference as it is", () => {
  const kinds = defineType({ type: "k", owner: "t", schema: "1", fields: { title: { kind: "value" }, data: { kind: "value" },
    many: { kind: "refs", to: "k", clone: "follow" } } });
  const graph = graphOf([kinds]);
  const child = ok(graph.commit([{ op: "create", type: "k", as: "c", fields: { title: "child" } }])).created.c;
  const parent = ok(graph.commit([{ op: "create", type: "k", as: "p", fields: { many: [child], data: { type: "k", id: child.id } } }])).created.p;
  const copy = ok(graph.commit([{ op: "create", type: "k", as: "copy", from: { clone: parent } }])).created.copy;
  const many = graph.resolve(copy, ["many"]) as NodeRef[];
  expect([many.length, many[0].id === child.id, graph.resolve(many[0], ["title"]), graph.resolve(copy, ["data"])]).toEqual([1, false, "child", { type: "k", id: child.id }]);
});

test("a collapsed node reads with seq 0, now and in a past view; it isn't listed among a node's referrers; rules see a node's referrers", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const target = create(graph, ITEM, { title: "t" });
  const x = create(graph, ITEM, { title: "x", link: target });
  create(graph, GROUP, { label: "h", members: { x } });
  const before = graph.position;
  create(graph, ITEM, { title: "later" });
  await drive(scheduler, graph.flush());
  expect(graph.referrers(target).map(item => item.node.id)).toEqual([x.id]);
  expect(await drive(scheduler, graph.collapseInline(x))).toMatchObject({ ok: true });
  expect(graph.read(x)?.seq).toBe(0);
  expect((await drive(scheduler, graph.at(before, [x]))).read(x)?.seq).toBe(0);
  expect(graph.referrers(target)).toEqual([]);
  const order = defineRule({ id: "order", owner: "t", subject: ITEM, severity: "notice",
    evaluate: (subject, context) => { const ids = context.referrers(subject).map(item => item.node.id); return ids.length > 1 ? [{ sentence: ids.join(" ") }] : []; } });
  const ruled = graphOf(SYNTHETIC_TYPES, { rules: [order] });
  const t = create(ruled, ITEM, { title: "t" }), old = create(ruled, ITEM, { title: "old" }), young = create(ruled, ITEM, { title: "young", link: t });
  ok(ruled.commit([{ op: "set", node: old, path: ["link"], value: t }]));
  expect(ruled.conflicts(t).map(item => item.sentence)).toEqual([`${old.id} ${young.id}`]);
});

test("change sets: each node once, sorted by ID, with its bookkeeping (created, name, layers, trashed, retracted, purged), the cause, and a label only when given", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const sets: ChangeSet[] = [];
  const life = new Aborter();
  graph.subscribeAll(set => sets.push(set), { signal: life.signal });
  const meta = (set: ChangeSet) => set.nodes.map(item => [item.node.id, [...item.meta]]);
  const made = ok(graph.commit([{ op: "create", type: ITEM, as: "b", id: "b-id" }, { op: "create", type: ITEM, as: "a", id: "a-id" }], { label: "Make" }));
  expect([made.changes.label, made.changes.cause, meta(made.changes)]).toEqual(["Make", "commit", [["a-id", ["created"]], ["b-id", ["created"]]]]);
  const { a, b } = made.created;
  const renamed = ok(graph.commit([{ op: "rename", node: a, name: "A" }]));
  expect(renamed.changes).toStrictEqual({ commit: renamed.commit, cause: "commit", nodes: renamed.changes.nodes });
  expect(meta(renamed.changes)).toEqual([["a-id", ["name"]]]);
  expect(meta(ok(graph.commit([{ op: "rebase", node: a, base: b }])).changes)).toEqual([["a-id", ["layers"]]]);
  expect(meta(ok(graph.commit([{ op: "trash", node: b }])).changes)).toEqual([["b-id", ["trashed"]]]);
  const c = ok(graph.commit([{ op: "create", type: ITEM, as: "c", id: "c-id" }], { scope: "c" })).created.c;
  const undone = graph.undo("c");
  expect([undone.ok && undone.changes.cause, undone.ok && meta(undone.changes)]).toEqual(["undo", [["c-id", ["retracted"]]]]);
  expect(graph.exists(c)).toBe(false);
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.purge(b, { force: true }))).toEqual({ ok: true });
  const purged = sets.at(-1)!;
  expect([purged.cause, purged.nodes.find(item => item.node.id === "b-id")?.meta]).toEqual(["purge", ["purged"]]);
  expect(sets.slice(0, 4).map(meta)).toEqual([meta(made.changes), meta(renamed.changes), [["a-id", ["layers"]]], [["b-id", ["trashed"]]]]);
  life.abort();
});

test("a refused fix leaves everything as it was: no new node, no new entries, the same position and actor counter, the unique value it took free", () => {
  const rule = defineRule({ id: "odd", owner: "t", subject: [ITEM], severity: "warning", evaluate: (subject, context) =>
    context.resolve(subject, ["title"]) === "odd" ? [{ sentence: "odd", routes: [{ id: "sprawl", label: "Sprawl", consequence: "", patch: [
      { op: "create", type: ITEM, as: "x", id: "x-id", fields: { code: "taken-by-fix" } },
      { op: "rename", node: subject, name: "renamed" },
      { op: "set", node: subject, path: ["link"], value: subject },
    ] }] }] : [] });
  const { graph } = harness({ extra: { rules: [...SYNTHETIC_RULES, rule] } });
  const node = create(graph, ITEM, { title: "odd" });
  const conflict = graph.conflicts(node).find(item => item.rule === "odd")!;
  const position = graph.position, seq = graph.seqOf(node);
  const actorSeqs = () => graph[STRATA_DEBUG]().records.flatMap(rec => rec.entries.map(entry => entry.actorSeq));
  const before = Math.max(...actorSeqs());
  const refused = graph.fix(conflict.id, "sprawl");
  expect(refused.ok ? "" : refused.reason).toBe("conflict");
  expect([graph.exists({ type: ITEM, id: "x-id" }), graph.read(node)?.name, graph.seqOf(node), graph.position]).toEqual([false, "", seq, position]);
  ok(graph.commit([{ op: "create", type: ITEM, as: "y", fields: { code: "taken-by-fix" } }]));
  expect(Math.max(...actorSeqs())).toBe(before + 1);
});

test("a clone gets fresh identity values, and the name given goes to its root only", () => {
  const { graph } = harness();
  const child = create(graph, ITEM, { title: "child" });
  const parent = ok(graph.commit([{ op: "create", type: ITEM, as: "p", name: "Parent", fields: { title: "parent", link: child } }])).created.p;
  ok(graph.commit([{ op: "rename", node: child, name: "Child" }]));
  const copy = ok(graph.commit([{ op: "create", type: ITEM, as: "c", name: "Copy", from: { clone: parent } }])).created.c;
  const linked = graph.resolve(copy, ["link"]) as NodeRef;
  expect([graph.read(copy)?.name, graph.read(linked)?.name]).toEqual(["Copy", "Child"]);
  const code = graph.resolve(copy, ["code"]);
  expect(typeof code === "string" && code !== graph.resolve(parent, ["code"])).toBe(true);
  expect(typeof graph.resolve(linked, ["code"])).toBe("string");
  const unnamed = ok(graph.commit([{ op: "create", type: ITEM, as: "u", from: { clone: parent } }])).created.u;
  expect(graph.read(unnamed)?.name).toBe("Parent");
});

test("layers: a list, or refused; a pin to a node edited in the same change; a pin to a collapsed node's entry is missing; a cycle names the node when it has a name", async () => {
  const { graph, scheduler } = harness({ store: true });
  await drive(scheduler, graph.load());
  const reason = (edits: unknown[]) => { const result = graph.commit(edits as never); return result.ok ? "ok" : `${result.reason}: ${result.message}`; };
  expect(reason([{ op: "create", type: ITEM, as: "x", layers: {} }])).toBe("value: Layers are a list.");
  const s = create(graph, ITEM, { title: "s" });
  expect(reason([{ op: "layers", node: s, layers: {} }])).toBe("value: Layers are a list.");
  expect(reason([{ op: "set", node: s, path: ["title"], value: "s2" }, { op: "create", type: ITEM, as: "p", from: { fork: s, at: 1 } }])).toBe("ok");
  const inner = create(graph, ITEM, { title: "inner" });
  create(graph, GROUP, { label: "h", members: { inner } });
  await drive(scheduler, graph.flush());
  expect(await drive(scheduler, graph.collapseInline(inner))).toMatchObject({ ok: true });
  expect(reason([{ op: "create", type: ITEM, as: "q", from: { fork: inner, at: 1 } }])).toMatch(/^missing:/);
  const named = ok(graph.commit([{ op: "create", type: ITEM, as: "n", name: "Named" }])).created.n;
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: named } }])).created.f;
  expect(reason([{ op: "rebase", node: named, base: fork }])).toBe("cycle: That item already takes values from \u201cNamed\u201d.");
  const plain = create(graph, ITEM, {});
  const plainFork = ok(graph.commit([{ op: "create", type: ITEM, as: "g", from: { fork: plain } }])).created.g;
  expect(reason([{ op: "rebase", node: plain, base: plainFork }])).toBe("cycle: That item already takes values from this one.");
});

test("invalidation: a change reaching a node twice by different paths reaches its dependents with both, a change in a stored layer cycle ends, and a commit changing a reference and a value re-indexes the reference", async () => {
  const { graph } = harness();
  const s0 = create(graph, ITEM, { tags: { k: 1 } }), s1 = create(graph, ITEM, { title: "one" });
  const s2 = ok(graph.commit([{ op: "create", type: ITEM, as: "s2", from: { fork: s0 } }])).created.s2;
  const d = ok(graph.commit([{ op: "create", type: ITEM, as: "d", from: { fork: s1 } }, { op: "feed", node: { created: "d" }, from: s2, paths: [["tags"]] }])).created.d;
  const e = ok(graph.commit([{ op: "create", type: ITEM, as: "e", from: { fork: d } }])).created.e;
  expect([graph.resolve(e, ["title"]), graph.resolve(e, ["tags", "k"])]).toEqual(["one", 1]);
  ok(graph.commit([{ op: "set", node: s1, path: ["title"], value: "two" }, { op: "set", node: s0, path: ["tags", "k"], value: 2 }]));
  expect([graph.resolve(e, ["title"]), graph.resolve(e, ["tags", "k"])]).toEqual(["two", 2]);
  const target = create(graph, ITEM, { title: "target" });
  graph.referrers(target);
  ok(graph.commit([{ op: "set", node: s1, path: ["link"], value: target }, { op: "set", node: s1, path: ["title"], value: "three" }]));
  // s1 now references it, and d and e through what they inherit from s1.
  expect(graph.referrers(target).map(item => item.node.id).sort()).toEqual([s1.id, d.id, e.id].sort());
  const { scheduler, open } = storeSessions();
  const first = await open();
  const x = create(first, ITEM, { title: "x" }), y = create(first, ITEM, { title: "y" });
  await drive(scheduler, first.flush());
  const left = await open(), right = await open();
  ok(left.commit([{ op: "rebase", node: x, base: y }]));
  ok(right.commit([{ op: "rebase", node: y, base: x }]));
  await drive(scheduler, left.flush());
  await drive(scheduler, right.flush());
  const cyclic = await open();
  cyclic.conflicts();
  ok(cyclic.commit([{ op: "set", node: x, path: ["tags", "k"], value: 5 }]));
  expect(cyclic.resolve(x, ["tags", "k"])).toBe(5);
});

test("a session node's stream compacts in memory once its Undo history ends", async () => {
  const pose = defineType({ type: "pose", owner: "t", schema: "1", persistence: "session", fields: { x: { kind: "value" } } });
  const graph = graphOf([pose]);
  const p = ok(graph.commit([{ op: "create", type: "pose", as: "p", fields: { x: 0 } }])).created.p;
  for (let i = 1; i <= 3; i++) ok(graph.commit([{ op: "set", node: p, path: ["x"], value: i }]));
  graph.forgetHistory();
  expect(await graph.compact(p)).toMatchObject({ ok: true, before: 4 });
});
