/**
 * The standard invariants, as functions returning problem strings (empty when they hold). Each problem starts with
 * its invariant's ID: `stale`, `conflicts`, `structure`, `snapshot`, `cut`, `undo`, `lost-work`, `preempt`.
 */
import { canonical, equal } from "../json";
import type { TypeSpec } from "../define";
import { fold } from "../fold";
import type { Graph } from "../graph";
import type { MemoryStore } from "../store";
import type { Entry, FieldKind, Layer, NodeRef, NodeState } from "../types";
import { referenceModel, replayTo } from "./reference";
import type { StatesAt } from "./reference";

const short = (value: unknown) => { const text = canonical(value); return text.length > 300 ? `${text.slice(0, 300)}…` : text; };

/** Head states as the graph holds them (for the reference model). */
export function headStates(graph: Graph): StatesAt {
  const states = new Map<string, { ref: NodeRef; head: NodeState | null }>();
  for (const rec of graph.debugState().records) states.set(rec.ref.id, { ref: rec.ref, head: rec.head });
  return ref => { const item = states.get(ref.id); return item && item.ref.type === ref.type && item.head && !item.head.retracted ? item.head : null; };
}

/** States at a pinned layer's point, replayed from the graph's in-memory entries. */
function pinnedFrom(graph: Graph, types: readonly TypeSpec[]): (layer: Layer) => StatesAt | null {
  const cache = new Map<number, StatesAt>();
  const entries = graph.debugState().records.flatMap(rec => rec.base.seq > 0 ? [] : rec.entries);
  return layer => {
    const pos = layer.at ? graph.posOf(layer.at) : undefined;
    if (pos === undefined) return null;
    let states = cache.get(pos);
    if (!states) {
      const replayed = replayTo(types, entries, pos);
      states = ref => { const item = replayed.get(ref.id); return item && item.ref.type === ref.type && item.state && !item.state.retracted ? item.state : null; };
      cache.set(pos, states);
    }
    return states;
  };
}

/** Invariant 1: no stale derived value. Every memoised effective value equals the reference model's fresh answer. */
export function checkResolution(graph: Graph, types: readonly TypeSpec[]): string[] {
  const problems: string[] = [];
  const model = referenceModel(types, pinnedFrom(graph, types));
  const states = headStates(graph);
  for (const ref of graph.list()) {
    const actual = graph.resolve(ref), expected = model.effective(states, ref);
    if (!equal(actual, expected)) problems.push(`stale: ${ref.type} ${ref.id.slice(0, 8)} resolves ${short(actual)}, expected ${short(expected)}`);
  }
  return problems;
}

/** Invariant 3: the conflict index equals a full evaluation of every rule. */
export function checkConflictIndex(graph: Graph): string[] {
  const index = graph.conflictIndex().map(item => [item.id, item.sentence, item.severity]);
  const full = graph.evaluateAll().map(item => [item.id, item.sentence, item.severity]);
  return equal(index, full) ? [] : [`conflicts: index ${short(index)} differs from a full evaluation ${short(full)}`];
}

/** Invariant 6: structure. Layer edges acyclic; unique fields unique; stored streams gap-free (unless compacted) and monotonic; references typed. */
export function checkStructure(graph: Graph, types: readonly TypeSpec[], store?: MemoryStore): string[] {
  const problems: string[] = [];
  const records = graph.debugState().records.filter(rec => rec.head && !rec.head.retracted);
  const byId = new Map(records.map(rec => [rec.ref.id, rec]));
  for (const rec of records) {
    const seen = new Set<string>(), stack = rec.head!.layers.map(layer => layer.from.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (id === rec.ref.id) { problems.push(`structure: layer cycle through ${rec.ref.id.slice(0, 8)}`); break; }
      if (seen.has(id)) continue;
      seen.add(id);
      for (const layer of byId.get(id)?.head?.layers ?? []) stack.push(layer.from.id);
    }
  }
  const byType = new Map(types.map(def => [def.type, def]));
  const unique = new Map<string, string>();
  for (const rec of records) {
    const def = byType.get(rec.ref.type);
    if (!def) continue;
    for (const [field, spec] of Object.entries(def.fields)) {
      if (!spec.unique) continue;
      const value = rec.head!.own[JSON.stringify([field])];
      if (value === undefined || value === null) continue;
      const key = `${rec.ref.type}/${field}/${canonical(value)}`;
      if (unique.has(key)) problems.push(`structure: ${field} ${short(value)} held by two nodes`);
      unique.set(key, rec.ref.id);
    }
    for (const item of graph.references(rec.ref)) {
      const spec = def.fields[item.path[0]];
      let kind: FieldKind = spec;
      while (kind.kind === "map") kind = kind.of;
      if ((kind.kind === "ref" || kind.kind === "refs") && ![kind.to].flat().includes(item.target.type))
        problems.push(`structure: ${rec.ref.id.slice(0, 8)} references a ${item.target.type} where ${short(kind.to)} is accepted`);
    }
  }
  if (store) {
    const compacted = new Set(store.compactions.map(item => item.node.id));
    const streams = new Map<string, number[]>();
    for (const entry of store.allEntries()) { const list = streams.get(entry.node.id) ?? []; list.push(entry.seq); streams.set(entry.node.id, list); }
    for (const [id, seqs] of streams) {
      for (let i = 0; i < seqs.length; i++) {
        if (i > 0 && seqs[i] <= seqs[i - 1]) problems.push(`structure: stream ${id.slice(0, 8)} is not monotonic`);
        if (!compacted.has(id) && seqs[i] !== i + 1) { problems.push(`structure: stream ${id.slice(0, 8)} has a gap at ${i + 1}`); break; }
      }
    }
  }
  return problems;
}

/** Invariant 7a: snapshot plus tail equals the full fold, for every stored snapshot. */
export function checkSnapshots(store: MemoryStore, types: readonly TypeSpec[]): string[] {
  const problems: string[] = [];
  const byType = new Map(types.map(def => [def.type, def]));
  const streams = new Map<string, Entry[]>();
  for (const entry of store.allEntries()) { const list = streams.get(entry.node.id) ?? []; list.push(entry); streams.set(entry.node.id, list); }
  for (const [id, entries] of streams) {
    const snapshot = store.snapshotOf(entries[0].node);
    if (!snapshot) continue;
    const def = byType.get(entries[0].node.type);
    const full = fold(null, entries.filter(entry => entry.seq <= snapshot.seq), def);
    if (!equal(full, snapshot.state)) problems.push(`snapshot: ${id.slice(0, 8)} snapshot at ${snapshot.seq} differs from the fold`);
    const head = fold(snapshot.state, entries.filter(entry => entry.seq > snapshot.seq), def);
    if (!equal(head, fold(null, entries, def))) problems.push(`snapshot: ${id.slice(0, 8)} snapshot plus tail differs from the full fold`);
  }
  return problems;
}

/**
 * Invariant 7b: a view at T is a consistent cut: `graph.at(T)` equals replaying every stream up to T from empty.
 * `entries` is every entry the graph has seen (the store's, when the graph is in sync with it).
 */
export async function checkConsistentCut(graph: Graph, types: readonly TypeSpec[], entries: readonly Entry[], pos: number): Promise<string[]> {
  const view = await graph.at(pos);
  const replayed = replayTo(types, entries, pos);
  const positions = new Map(entries.map(entry => [`${entry.node.id}@${entry.seq}`, entry.pos]));
  const cache = new Map<number, StatesAt>();
  const statesAt = (at: number): StatesAt => {
    let states = cache.get(at);
    if (!states) {
      const map = at === pos ? replayed : replayTo(types, entries, at);
      states = ref => { const item = map.get(ref.id); return item && item.ref.type === ref.type && item.state && !item.state.retracted ? item.state : null; };
      cache.set(at, states);
    }
    return states;
  };
  const model = referenceModel(types, layer => layer.at && positions.has(`${layer.at.node.id}@${layer.at.seq}`)
    ? statesAt(positions.get(`${layer.at.node.id}@${layer.at.seq}`)!) : null);
  const problems: string[] = [];
  const ids = new Set([...view.list().map(ref => ref.id), ...[...replayed.values()].filter(item => item.state && !item.state.retracted).map(item => item.ref.id)]);
  for (const id of ids) {
    const ref = replayed.get(id)?.ref ?? view.list().find(item => item.id === id)!;
    if (ref.id.startsWith("builtin:")) continue;
    const actual = view.resolve(ref), expected = model.effective(statesAt(pos), ref);
    if (!equal(actual, expected)) problems.push(`cut: at ${pos}, ${ref.id.slice(0, 8)} reads ${short(actual)}, a replay gives ${short(expected)}`);
  }
  return problems;
}
