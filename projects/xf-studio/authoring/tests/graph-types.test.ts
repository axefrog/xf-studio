/**
 * The Studio's G1 graph types and rules (profiles and graph design §2.6, §4.1): pointers resolve fixed targets and
 * follow paths; R1–R3 and L1–L2 are raised, fixed through `graph.fix` as one undoable Graph step, and refuse what they
 * block.
 */
import { expect, test } from "bun:test";
import { createGraph, MemoryStore } from "strata";
import type { Graph, NodeRef } from "strata";
import { Scheduler, seededRandom, settle, simClock } from "strata/testing";
import { STUDIO_GRAPH_RULES, STUDIO_GRAPH_TYPES } from "../src/compose/graph";
import { POINTER, resolvePointer } from "../src/platform/graph-types";

const graphOf = (store?: MemoryStore) => createGraph({ types: STUDIO_GRAPH_TYPES, rules: STUDIO_GRAPH_RULES, ...(store ? { store } : {}),
  sources: { clock: simClock(new Scheduler()), random: seededRandom("types") } });
function make(graph: Graph, fields: Record<string, unknown> = {}, name = "p"): NodeRef {
  const result = graph.commit([{ op: "create", type: POINTER, as: "p", name, fields }]);
  if (!result.ok) throw new Error(result.message);
  return result.created.p;
}
const rules = (graph: Graph, ref?: NodeRef) => graph.conflicts(ref).map(conflict => conflict.rule).sort();

test("a pointer resolves its fixed target, or its follow path from the pointer it follows", () => {
  const graph = graphOf();
  const view = make(graph, {}, "view"), scene = make(graph, {}, "scene"), v = make(graph, {}, "V");
  // Pointers stand in for the scene and V nodes G2 and G8 bring: `target` is the reference walked.
  graph.commit([{ op: "set", node: view, path: ["target"], value: scene }, { op: "set", node: scene, path: ["target"], value: v }]);
  const focusView = make(graph, { target: view }, "focus.view");
  const focusV = make(graph, { from: focusView, path: ["target"] }, "focus.v");
  expect(resolvePointer(graph, focusView)).toEqual(view);
  expect(resolvePointer(graph, focusV)).toEqual(scene);
  graph.commit([{ op: "set", node: focusView, path: ["target"], value: scene }]);
  expect(resolvePointer(graph, focusV)).toEqual(v);
  graph.commit([{ op: "trash", node: v }]);
  expect(resolvePointer(graph, focusV)).toEqual(v);   // a trashed node still exists
});

test("R1: a reference to a trashed node warns; restoring fixes it as one Graph step, which undoes", () => {
  const graph = graphOf();
  const target = make(graph, {}, "t"), pointer = make(graph, {}, "p");
  graph.commit([{ op: "set", node: pointer, path: ["target"], value: target }]);
  graph.commit([{ op: "trash", node: target }]);
  const conflict = graph.conflicts(pointer).find(item => item.rule === "R1")!;
  expect(conflict.severity).toBe("warning");
  expect(conflict.routes.map(route => route.id)).toEqual(["restore", `point-${pointer.id}`, "remove"]);
  expect(graph.fix(conflict.id, "restore").ok).toBe(true);
  expect(rules(graph)).toEqual([]);
  expect(graph.undo("graph").ok).toBe(true);
  expect(rules(graph)).toEqual(["R1"]);
});

test("R2: a followed reference to a node that no longer exists blocks derivations; R3: a circle of follows blocks too", async () => {
  const graph = graphOf();
  const a = make(graph, {}, "a"), b = make(graph, { from: a }, "b");
  expect((await graph.purge(a)).ok).toBe(true);
  expect(rules(graph, b)).toEqual(["R2"]);
  expect(graph.blockingFor(b, "derive")?.rule).toBe("R2");
  const c = make(graph, {}, "c"), d = make(graph, { from: c }, "d");
  graph.commit([{ op: "set", node: c, path: ["from"], value: d }]);
  const circle = graph.conflicts(c).find(item => item.rule === "R3")!;
  expect(circle.subjects.map(ref => ref.id).sort()).toEqual([c.id, d.id].sort());
  expect(graph.fix(circle.id, circle.routes[0].id).ok).toBe(true);
  expect(rules(graph, c)).toEqual([]);
});

test("L1: a trashed base warns (it still resolves); detaching keeps the values; L2: a feed of a path the type lacks is a notice", async () => {
  const graph = graphOf();
  const base = make(graph, { path: ["x"] }, "base");
  const fork = graph.commit([{ op: "create", type: POINTER, as: "f", from: { fork: base } }]);
  if (!fork.ok) throw new Error(fork.message);
  const f = fork.created.f;
  graph.commit([{ op: "trash", node: base }]);
  expect(graph.resolve(f, ["path"])).toEqual(["x"]);
  const warning = graph.conflicts(f).find(item => item.rule === "L1")!;
  expect(graph.fix(warning.id, "detach").ok).toBe(true);
  expect(graph.read(f)!.layers).toEqual([]);
  expect(graph.resolve(f, ["path"])).toEqual(["x"]);

  // A feed stored by an older type that had a `route` field (as a type migration would leave it).
  const memory = new MemoryStore();
  const node = (id: string, layers: unknown[]) => ({ node: { type: POINTER, id }, seq: 1, pos: 0, commit: id, actor: "local", actorSeq: 1, at: 1, schema: "1",
    op: { kind: "create", state: { name: id, own: {}, layers, trashed: false, retracted: false } } }) as never;
  const source = { type: POINTER, id: "00000000-0000-4000-8000-000000000001" };
  memory.appendNow({ commit: "a", expect: [[source.id, 0]], entries: [node(source.id, [])] });
  memory.appendNow({ commit: "b", expect: [["00000000-0000-4000-8000-000000000002", 0]],
    entries: [node("00000000-0000-4000-8000-000000000002", [{ from: source, role: "feed", paths: [["route"], ["path"]] }])] });
  const migrated = graphOf(memory);
  await migrated.load();
  await settle();
  const notice = migrated.conflicts().find(item => item.rule === "L2")!;
  expect(notice.severity).toBe("notice");
  expect(migrated.fix(notice.id, "drop-paths").ok).toBe(true);
  expect(migrated.conflicts().some(item => item.rule === "L2")).toBe(false);
});
