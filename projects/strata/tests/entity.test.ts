/** The entity layer's named cases (design §9, G1): layering, references, clone, purge, undo, notifications. */
import { expect, test } from "bun:test";
import { Aborter, constantId, pathKey } from "strata";
import type { ChangeSet, NodeChange, NodeRef } from "strata";
import { create, harness, ok } from "./helpers";
import { ITEM, GROUP } from "../src/testing/synthetic";

const STARTER = { type: ITEM, id: constantId(ITEM, "starter") };

test("a fork follows its base until it overrides a value", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "base", tags: { x: 1 } });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: base } }])).created.f;
  expect(graph.resolve(fork, ["title"])).toBe("base");
  expect(graph.origin(fork, ["title"])).toEqual({ via: "base", layer: base, owner: base });
  ok(graph.commit([{ op: "set", node: base, path: ["title"], value: "base 2" }]));
  expect(graph.resolve(fork, ["title"])).toBe("base 2");
  ok(graph.commit([{ op: "set", node: fork, path: ["title"], value: "mine" }]));
  ok(graph.commit([{ op: "set", node: base, path: ["title"], value: "base 3" }]));
  expect(graph.resolve(fork, ["title"])).toBe("mine");
  expect(graph.origin(fork, ["title"])).toEqual({ via: "own", node: fork });
  // Identity is never shared: the fork has its own code.
  expect(graph.resolve(fork, ["code"])).not.toBe(graph.resolve(base, ["code"]));
  // The name defaults from the source but is the fork's own.
  expect(graph.read(fork)!.name).toBe(graph.read(base)!.name);
});

test("a feed takes only its paths, ahead of the base; map keys union across layers and tombstones remove one", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a", tags: { x: 1, y: 2 } });
  const b = create(graph, ITEM, { title: "b", tags: { y: 20, z: 30 } });
  const n = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: a } }])).created.n;
  ok(graph.commit([{ op: "feed", node: n, from: b, paths: [["tags", "y"]] }]));
  expect(graph.resolve(n, ["tags"])).toEqual({ base: 1, x: 1, y: 20 });
  expect(graph.resolve(n, ["title"])).toBe("a");
  ok(graph.commit([{ op: "tombstone", node: n, path: ["tags", "x"] }]));
  expect(graph.resolve(n, ["tags"])).toEqual({ base: 1, y: 20 });
  ok(graph.commit([{ op: "reset", node: n, path: ["tags", "x"] }]));
  expect(graph.resolve(n, ["tags", "x"])).toBe(1);
});

test("a three-level fork of a fork of a constant, and constants refuse edits", () => {
  const { graph } = harness();
  const one = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: STARTER } }])).created.n;
  const two = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: one } }])).created.n;
  const three = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: two } }])).created.n;
  ok(graph.commit([{ op: "set", node: two, path: ["tags", "b"], value: 22 }]));
  expect(graph.resolve(three, ["tags"])).toEqual({ a: 1, b: 22, base: 1 });
  expect(graph.origin(three, ["tags", "a"])).toEqual({ via: "base", layer: two, owner: STARTER });
  const refused = graph.commit([{ op: "set", node: STARTER, path: ["title"], value: "x" }]);
  expect(refused.ok ? "" : refused.reason).toBe("constant");
});

test("a layer cycle is refused with a plain reason; a reference cycle raises its conflict and blocks its action", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: a } }])).created.n;
  const refused = graph.commit([{ op: "rebase", node: a, base: b }]);
  expect(refused.ok ? "" : refused.reason).toBe("cycle");
  expect(refused.ok ? "" : refused.message).toContain("already takes values from");
  // (A fork's reset would inherit its base's link, so the circle is between independent nodes.)
  const c = create(graph, ITEM, { title: "c" });
  ok(graph.commit([{ op: "set", node: a, path: ["link"], value: c }]));
  ok(graph.commit([{ op: "set", node: c, path: ["link"], value: a }]));
  const cycle = graph.conflicts().find(item => item.rule === "follow-cycle")!;
  expect(cycle.severity).toBe("blocking");
  expect(cycle.subjects.map(item => item.id).sort()).toEqual([a.id, c.id].sort());
  expect(graph.derive(a, "summary")).toMatchObject({ ok: false, reason: "cycle" });
  const blocked = graph.commit([{ op: "set", node: a, path: ["title"], value: "x" }], { action: "item.edit" });
  expect(blocked.ok ? "" : blocked.reason).toBe("conflict");
  // A fix route breaks the circle, as one step on the graph's Undo stack.
  ok(graph.fix(cycle.id, "cut-0"));
  expect(graph.conflicts().some(item => item.rule === "follow-cycle")).toBe(false);
  expect(graph.undoLabels("graph")).toEqual(["Remove this link"]);
});

test("a deep clone is independent and remaps references inside what it copied", () => {
  const { graph } = harness();
  const leaf = create(graph, ITEM, { title: "leaf" });
  const shared = create(graph, ITEM, { title: "shared" });
  const root = create(graph, ITEM, { title: "root", link: leaf, others: [shared] });
  const copy = ok(graph.commit([{ op: "create", type: ITEM, as: "c", from: { clone: root } }])).created.c;
  const copiedLeaf = graph.resolve(copy, ["link"]) as NodeRef;
  expect(copiedLeaf.id).not.toBe(leaf.id);
  expect(graph.resolve(copiedLeaf, ["title"])).toBe("leaf");
  expect(graph.resolve(copy, ["others"])).toEqual([shared]);
  expect(graph.read(copy)!.layers).toEqual([]);
  ok(graph.commit([{ op: "set", node: root, path: ["title"], value: "changed" }]));
  ok(graph.commit([{ op: "set", node: leaf, path: ["title"], value: "changed" }]));
  expect(graph.resolve(copy, ["title"])).toBe("root");
  expect(graph.resolve(copiedLeaf, ["title"])).toBe("leaf");
});

test("purging a layer source is refused until its dependents are detached, which keeps their values", async () => {
  const { graph } = harness();
  const source = create(graph, ITEM, { title: "source", tags: { k: 1 } });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: source } }])).created.f;
  const refused = await graph.purge(source);
  expect(refused).toMatchObject({ ok: false, reason: "dependents", dependents: [fork] });
  const before = graph.resolve(fork);
  ok(graph.commit([{ op: "detach", node: fork }]));
  expect(graph.resolve(fork)).toEqual(before);
  expect(await graph.purge(source)).toEqual({ ok: true });
  expect(graph.exists(source)).toBe(false);
  expect(graph.resolve(fork)).toEqual(before);
});

test("twenty nodes following one node each get one notification per commit", () => {
  const { graph } = harness();
  const target = create(graph, ITEM, { title: "t" });
  const referrers = Array.from({ length: 20 }, (_, i) => create(graph, ITEM, { title: `r${i}`, link: target }));
  const counts = new Map<string, number>();
  const life = new Aborter();
  for (const ref of referrers) graph.subscribe(ref, change => {
    counts.set(ref.id, (counts.get(ref.id) ?? 0) + 1);
    expect(change.via).toEqual([target]);
  }, { signal: life.signal, follows: true });
  ok(graph.commit([{ op: "set", node: target, path: ["title"], value: "t2" }, { op: "set", node: target, path: ["tags", "q"], value: 1 }]));
  expect([...counts.values()]).toEqual(Array(20).fill(1));
  life.abort();
  ok(graph.commit([{ op: "set", node: target, path: ["title"], value: "t3" }]));
  expect([...counts.values()]).toEqual(Array(20).fill(1));
});

test("a subscription reports exactly the changed paths, once per commit, until its signal aborts", () => {
  const { graph } = harness();
  const base = create(graph, ITEM, { title: "b", tags: { x: 1 } });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: base } }])).created.f;
  const seen: NodeChange[] = [];
  const life = new Aborter();
  graph.subscribe(fork, change => seen.push(change), { signal: life.signal });
  ok(graph.commit([{ op: "set", node: base, path: ["tags", "x"], value: 2 }, { op: "set", node: base, path: ["tags", "y"], value: 3 }]));
  ok(graph.commit([{ op: "set", node: fork, path: ["tags", "x"], value: 2 }]));   // same effective value: no report
  ok(graph.commit([{ op: "rename", node: fork, name: "renamed" }]));
  expect(seen.map(change => [change.paths.map(pathKey), change.meta])).toEqual([
    [[pathKey(["tags", "x"]), pathKey(["tags", "y"])], []],
    [[], ["name"]],
  ]);
  life.abort();
});

test("subscribeAll's change sets name every changed node and path (the commit's result too)", () => {
  const { graph } = harness();
  const life = new Aborter();
  const sets: ChangeSet[] = [];
  graph.subscribeAll(set => sets.push(set), { signal: life.signal });
  const a = create(graph, ITEM, { title: "a" });
  const b = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: a } }])).created.n;
  const result = ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "a2" }]));
  const expected = [{ node: a, paths: [["title"]], meta: [], via: [] }, { node: b, paths: [["title"]], meta: [], via: [] }]
    .sort((x, y) => x.node.id < y.node.id ? -1 : 1);
  expect(result.changes.nodes).toEqual(expected);
  expect(sets.at(-1)!.nodes).toEqual(expected);
  life.abort();
});

test("undo appends compensations that fold back exactly; redo returns; the stream only grows", () => {
  const { graph } = harness();
  const a = create(graph, ITEM, { title: "a", tags: { x: 1 } });
  const before = graph.read(a)!;
  ok(graph.commit([{ op: "set", node: a, path: ["title"], value: "b" }, { op: "tombstone", node: a, path: ["tags", "x"] }, { op: "rename", node: a, name: "n" }]));
  const seq = graph.seqOf(a);
  ok(graph.undo());
  const undone = graph.read(a)!;
  expect([undone.own, undone.layers, undone.name]).toEqual([before.own, before.layers, before.name]);
  expect(graph.seqOf(a)).toBe(seq + 1);
  ok(graph.redo());
  expect(graph.resolve(a, ["title"])).toBe("b");
  // Undoing a creation retracts the node: it reads as absent.
  ok(graph.undo()); ok(graph.undo());
  expect(graph.exists(a)).toBe(false);
  ok(graph.redo());
  expect(graph.resolve(a, ["title"])).toBe("a");
});

test("apply to source, rebase and revert", () => {
  const { graph } = harness();
  const s1 = create(graph, ITEM, { title: "s1" });
  const s2 = create(graph, ITEM, { title: "s2" });
  const f = ok(graph.commit([{ op: "create", type: ITEM, as: "f", from: { fork: s1 } }])).created.f;
  ok(graph.commit([{ op: "set", node: f, path: ["tags", "k"], value: 5 }]));
  ok(graph.commit([{ op: "applyToSource", node: f, path: ["tags", "k"] }]));
  expect(graph.resolve(s1, ["tags", "k"])).toBe(5);
  expect(graph.origin(f, ["tags", "k"])).toMatchObject({ via: "base" });
  ok(graph.commit([{ op: "rebase", node: f, base: s2 }]));
  expect(graph.resolve(f, ["title"])).toBe("s2");
  const at = graph.seqOf(f);
  ok(graph.commit([{ op: "set", node: f, path: ["title"], value: "x" }, { op: "rename", node: f, name: "other" }]));
  ok(graph.commit([{ op: "revert", node: f, to: at }]));
  expect(graph.resolve(f, ["title"])).toBe("s2");
});

test("a group's map of references follows its members, and trash raises a warning that a fix restores", () => {
  const { graph } = harness();
  const item = create(graph, ITEM, { title: "m" });
  const group = create(graph, GROUP, { label: "g", members: { first: item } });
  ok(graph.commit([{ op: "trash", node: item }]));
  const warning = graph.conflicts(group).find(conflict => conflict.rule === "trashed-ref")!;
  expect(warning.severity).toBe("warning");
  ok(graph.fix(warning.id, "restore"));
  expect(graph.conflicts(group)).toEqual([]);
  expect(graph.inspectNode(item)!.usedBy.map(edge => edge.from.id)).toEqual([group.id]);
});

test("a type mismatch in a reference and a duplicate unique value are refused", () => {
  const { graph } = harness();
  const group = create(graph, GROUP, { label: "g" });
  const a = create(graph, ITEM, { title: "a" });
  const wrong = graph.commit([{ op: "set", node: a, path: ["link"], value: group }]);
  expect(wrong.ok ? "" : wrong.reason).toBe("value");
  const code = graph.resolve(a, ["code"]);
  const dup = graph.commit([{ op: "create", type: ITEM, fields: { code } }]);
  expect(dup.ok ? "" : dup.reason).toBe("unique");
});
