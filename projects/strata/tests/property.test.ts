/**
 * Property tests against the brute-force reference model (design §9, G1): random graphs of the synthetic types, up to
 * 200 nodes, fork chains 8 deep, several feeds per node, map tombstones. After every random operation: every effective
 * value equals the naive resolver's, the change set names exactly the (node, path) pairs whose effective value changed,
 * and undo folds every node back exactly while the stream only grows (then redo returns).
 */
import { expect, test } from "bun:test";
import { Aborter, canonical, constantId, pathKey } from "strata";
import type { ChangeSet, Edit, FieldKind, NodeRef, TypeSpec } from "strata";
import { checkConflictIndex, checkResolution, headStates, prng, referenceModel, replayTo, STRATA_DEBUG, SYNTHETIC_TYPES } from "strata/testing";
import { harness } from "./helpers";
import { ITEM, GROUP } from "../src/testing/synthetic";

const byType = new Map(SYNTHETIC_TYPES.map(def => [def.type, def]));

function leaves(def: TypeSpec, value: Record<string, unknown> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (path: string[], kind: FieldKind, item: unknown) => {
    if (item === undefined) return;
    if (kind.kind === "map") { for (const [key, inner] of Object.entries(item as object)) walk([...path, key], kind.of, inner); return; }
    out.set(pathKey(path), canonical(item));
  };
  for (const [field, spec] of Object.entries(def.fields)) walk([field], spec, value?.[field]);
  return out;
}

const SEEDS = 6, STEPS = 250, MAX_NODES = 200;

for (let seed = 1; seed <= SEEDS; seed++) test(`random operations agree with the reference model (seed ${seed})`, () => {
  const next = prng(`property-${seed}`);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const h = harness({ seed: `property-${seed}` });
  const graph = h.graph;
  const life = new Aborter();
  const sets: ChangeSet[] = [];
  graph.subscribeAll(set => sets.push(set), { signal: life.signal });
  // Pinned layers read their source replayed to the pinned entry's position, from every entry in memory.
  const snapshot = () => {
    const entries = graph[STRATA_DEBUG]().records.flatMap(rec => rec.entries);
    const model = referenceModel(SYNTHETIC_TYPES, layer => {
      const pos = layer.at ? graph.posOf(layer.at) : undefined;
      if (pos === undefined) return null;
      const replayed = replayTo(SYNTHETIC_TYPES, entries, pos);
      return ref => { const item = replayed.get(ref.id); return item && item.ref.type === ref.type && item.state && !item.state.retracted ? item.state : null; };
    });
    const states = headStates(graph), out = new Map<string, Map<string, string>>();
    for (const ref of graph.list()) if (!ref.id.startsWith("builtin:")) out.set(ref.id, leaves(byType.get(ref.type)!, model.effective(states, ref)));
    return out;
  };
  const stored = () => new Map(graph.list().map(ref => { const read = graph.read(ref)!; return [ref.id, canonical([read.own, read.layers, read.name, read.trashed])]; }));
  const depth = (ref: NodeRef): number => { const layers = graph.read(ref)?.layers ?? []; return layers.length ? 1 + Math.max(...layers.map(layer => depth(layer.from))) : 0; };
  let before = snapshot();
  const keys = ["a", "b", "c", "d"];
  for (let step = 0; step < STEPS; step++) {
    const items = graph.list(ITEM), groups = graph.list(GROUP);
    const live = items.filter(ref => !ref.id.startsWith("builtin:"));
    const roll = next();
    let edits: Edit[];
    if (!live.length || roll < 0.3 && live.length < MAX_NODES) {
      const source = pick(items);
      const shape = next();
      edits = [shape < 0.45 && depth(source) < 8 ? { op: "create", type: ITEM, from: { fork: source } }
        : shape < 0.55 && live.length ? { op: "create", type: ITEM, from: { clone: pick(live) } }
          : shape < 0.65 ? { op: "create", type: GROUP, fields: { label: "g", members: live.length ? { m: pick(live) } : {} } }
            : { op: "create", type: ITEM, fields: { title: `t${step}`, tags: { [pick(keys)]: step } } }];
    } else {
      const node = pick(live), other = pick(items);
      const kinds = ["title", "tag", "meta", "tombstone", "reset", "feed", "rebase", "detach", "trash", "rename", "link", "apply", "group",
        "revert", "put", "pinned", "list", "several"];
      switch (pick(kinds)) {
        case "title": edits = [{ op: "set", node, path: ["title"], value: `v${step}` }]; break;
        case "tag": edits = [{ op: "set", node, path: ["tags", pick(keys)], value: Math.floor(next() * 5) }]; break;
        case "meta": edits = [{ op: "set", node, path: ["meta", pick(keys), pick(keys)], value: step }]; break;
        case "tombstone": edits = [{ op: "tombstone", node, path: ["tags", pick(keys)] }]; break;
        case "reset": edits = [{ op: "reset", node, path: pick([["title"], ["tags", pick(keys)], ["link"]]) }]; break;
        case "feed": edits = [{ op: "feed", node, from: other, paths: pick([[["tags"]], [["tags", pick(keys)]], [["title"]], [["meta"]], "*"]) as "*" }]; break;
        case "rebase": edits = [{ op: "rebase", node, base: other }]; break;
        case "detach": edits = [{ op: "detach", node }]; break;
        case "trash": edits = [{ op: next() < 0.6 ? "trash" : "restore", node }]; break;
        case "rename": edits = [{ op: "rename", node, name: `n${step}` }]; break;
        case "link": edits = [{ op: "set", node, path: ["link"], value: pick(live) }]; break;
        case "apply": edits = [{ op: "applyToSource", node, path: pick([["title"], ["tags", pick(keys)]]) }]; break;
        case "revert": edits = [{ op: "revert", node, to: 1 + Math.floor(next() * Math.max(1, graph.seqOf(node))) }]; break;
        case "put": edits = [{ op: "put", node, fields: { title: `p${step}`, tags: { [pick(keys)]: step } } }]; break;
        // A feed pinned to an entry of its source: later changes to the source don't reach it.
        case "pinned": edits = other.id.startsWith("builtin:") ? [{ op: "rename", node, name: "y" }] : [{ op: "feed", node, from: other, paths: [["title"]], at: graph.seqOf(other) }]; break;
        case "list": edits = [{ op: "set", node, path: ["others"], value: [pick(live), ...(groups.length ? [pick(groups)] : [])] }]; break;
        // Several edits of several nodes in one commit.
        case "several": edits = [{ op: "set", node, path: ["title"], value: `s${step}` }, { op: "set", node: pick(live), path: ["tags", pick(keys)], value: step }, { op: "rename", node: pick(live), name: `r${step}` }]; break;
        default: edits = groups.length ? [{ op: "set", node: pick(groups), path: ["members", pick(keys)], value: node }] : [{ op: "rename", node, name: "x" }];
      }
    }
    const storedBefore = stored();
    sets.length = 0;
    const result = graph.commit(edits);
    if (!result.ok) { expect(typeof result.reason).toBe("string"); continue; }
    const after = snapshot();
    // Exactly the changed (node, path) pairs.
    const expected: string[] = [];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id) ?? new Map(), b = after.get(id) ?? new Map();
      for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key) !== b.get(key)) expected.push(`${id} ${key}`);
    }
    const reported = sets.flatMap(set => set.nodes.flatMap(change => change.paths.map(path => `${change.node.id} ${pathKey(path)}`)));
    expect(reported.sort()).toEqual(expected.sort());
    expect(checkResolution(graph, SYNTHETIC_TYPES)).toEqual([]);
    before = after;
    // Undo folds back exactly (the stream grows); redo returns.
    if (next() < 0.25) {
      const storedAfter = stored();
      const listed = graph.list();
      const total = () => listed.map(ref => graph.seqOf(ref)).reduce((x, y) => x + y, 0);
      const seqs = total();
      expect(graph.undo().ok).toBe(true);
      const undone = stored();
      for (const [id, value] of storedBefore) expect([id, undone.get(id)]).toEqual([id, value]);
      expect([...undone.keys()].filter(id => !storedBefore.has(id))).toEqual([]);
      expect(total()).toBeGreaterThan(seqs);
      expect(graph.redo().ok).toBe(true);
      expect(stored()).toEqual(storedAfter);
      before = snapshot();
    }
  }
  expect(checkConflictIndex(graph)).toEqual([]);
  expect(graph.list().length).toBeGreaterThan(20);
  void constantId;
  life.abort();
}, 60_000);
