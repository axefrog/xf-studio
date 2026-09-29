/**
 * The standard invariants, as functions returning problem strings (empty when they hold). Each problem starts with
 * its invariant's ID: `stale`, `conflicts`, `structure`, `snapshot`, `cut`, `undo`, `lost-work`, `preempt`, `tables`.
 */
import { canonical, equal } from "../json";
import type { TypeSpec } from "../define";
import { fold } from "../fold";
import { STRATA_DEBUG } from "../graph";
import type { Graph } from "../graph";
import type { KernelTables } from "../kernel/kernel";
import type { MemoryStore } from "../store";
import type { Entry, FieldKind, Layer, NodeRef, NodeState } from "../types";
import { referenceModel, replayTo } from "./reference";
import type { StatesAt } from "./reference";

const short = (value: unknown) => { const text = canonical(value); return text.length > 300 ? `${text.slice(0, 300)}…` : text; };

/** Streams collapsed into the graph's entries: each is read from its host entry's copy. */
function collapsedStreams(graph: Graph): Map<string, { ref: NodeRef; entries: readonly Entry[] }> {
  const out = new Map<string, { ref: NodeRef; entries: readonly Entry[] }>();
  for (const rec of graph[STRATA_DEBUG]().records) for (const entry of rec.entries) for (const inner of entry.inlined ?? []) out.set(inner.node.id, { ref: inner.node, entries: inner.entries });
  return out;
}

/** Head states as the graph holds them (for the reference model), collapsed nodes folded from their host entries. */
export function headStates(graph: Graph): StatesAt {
  const states = new Map<string, { ref: NodeRef; head: NodeState | null }>();
  for (const [id, stream] of collapsedStreams(graph)) states.set(id, { ref: stream.ref, head: fold(null, stream.entries) });
  for (const rec of graph[STRATA_DEBUG]().records) states.set(rec.ref.id, { ref: rec.ref, head: rec.head });
  return ref => { const item = states.get(ref.id); return item && item.ref.type === ref.type && item.head && !item.head.retracted ? item.head : null; };
}

/** States at a pinned layer's point, replayed from the graph's in-memory entries. */
function pinnedFrom(graph: Graph, types: readonly TypeSpec[]): (layer: Layer) => StatesAt | null {
  const cache = new Map<number, StatesAt>();
  const byType = new Map(types.map(def => [def.type, def]));
  const records = new Map(graph[STRATA_DEBUG]().records.map(rec => [rec.ref.id, rec]));
  // A pinned layer reads the point its entry names: the greatest position of the entry's commit.
  const collapsed = collapsedStreams(graph);
  const ends = new Map<string, number>();
  for (const entries of [...[...records.values()].map(rec => rec.entries), ...[...collapsed.values()].map(stream => stream.entries)])
    for (const entry of entries) ends.set(entry.commit, Math.max(ends.get(entry.commit) ?? -1, entry.pos));
  return layer => {
    const at = layer.at, pinned = at && records.get(at.node.id);
    if (!at || !pinned) return null;
    const entry = pinned.constant ? undefined : pinned.entries.find(item => item.seq === at.seq);
    const pos = pinned.constant ? 0 : entry ? ends.get(entry.commit)! : undefined;
    if (pos === undefined) return null;
    let states = cache.get(pos);
    if (!states) {
      // Each stream folded from empty (or from the snapshot it was loaded from, when that is no later) up to the point.
      states = ref => {
        const rec = records.get(ref.id), stream = collapsed.get(ref.id);
        if (!rec && stream && stream.ref.type === ref.type) {
          const state = fold(null, stream.entries.filter(entry => entry.pos <= pos), byType.get(ref.type));
          return state && !state.retracted ? state : null;
        }
        if (!rec || rec.ref.type !== ref.type) return null;
        if (rec.constant) return rec.head;
        if (rec.base.seq > 0 && rec.base.pos > pos) return null;
        const state = fold(rec.base.state, rec.entries.filter(entry => entry.pos <= pos), byType.get(ref.type));
        return state && !state.retracted ? state : null;
      };
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
  const records = graph[STRATA_DEBUG]().records.filter(rec => rec.head && !rec.head.retracted);
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
      if ((kind.kind === "ref" || kind.kind === "refs") && kind.to !== "*" && ![kind.to].flat().includes(item.target.type))
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
  // A pin reads the point its entry names: the greatest position of the entry's commit.
  const all = entries.flatMap(item => [item, ...(item.inlined ?? []).flatMap(inner => inner.entries)]);
  const ends = new Map<string, number>();
  for (const entry of all) ends.set(entry.commit, Math.max(ends.get(entry.commit) ?? -1, entry.pos));
  const positions = new Map(all.map(entry => [`${entry.node.id}@${entry.seq}`, ends.get(entry.commit)!]));
  // Constants have no stream: they are the same at every point.
  const constants = new Map(graph[STRATA_DEBUG]().records.filter(rec => rec.constant).map(rec => [rec.ref.id, rec.head]));
  const cache = new Map<number, StatesAt>();
  const statesAt = (at: number): StatesAt => {
    let states = cache.get(at);
    if (!states) {
      const map = at === pos ? replayed : replayTo(types, entries, at);
      states = ref => {
        if (constants.has(ref.id)) return constants.get(ref.id) ?? null;
        const item = map.get(ref.id);
        return item && item.ref.type === ref.type && item.state && !item.state.retracted ? item.state : null;
      };
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

/** The caps on the graph's caches: views of the past, and change sets assembled for a commit made during a cycle. */
const CACHE_CAPS = { timeModels: 16, assembled: 64 } as const;

/**
 * `tables`: every internal table of the graph and its kernel is bounded by the live set. Rows that belong to nothing
 * live (a finished run's scope, an empty or gone row in an index, a conflict's producer or acknowledgement after the
 * conflict, a commit record off the Undo and Redo stacks, a gone node's kernel nodes that nothing wires in) are
 * leaks; the caches stay within their caps. `settled`: nothing is in flight either (no queued change, no compaction,
 * purge or flush waiting).
 */
export function checkTables(graph: Graph, options: { readonly settled?: boolean } = {}): string[] {
  const t = graph[STRATA_DEBUG]().tables();
  const problems = kernelTableProblems(t.kernel, options);
  const zero: Record<string, number> = {
    "empty layer-dependent sets": t.emptyLayerSets, "gone layer dependents": t.goneDependents, "empty referrer sets": t.emptyReferrerSets,
    "referrers with no references out": t.strayReferrers, "gone nodes' references out": t.goneRefsOut, "gone nodes' unique values": t.goneUnique,
    "orphan conflict producers": t.orphanProducers, "orphan produced sets": t.orphanProduced, "acknowledgements of gone conflicts": t.orphanAcknowledgements,
    "commit records off the Undo and Redo stacks": t.commitsOffStacks, "gone nodes' kernel nodes": t.goneMachinery, "purged references": t.purgedRefs,
  };
  if (options.settled) Object.assign(zero, {
    "collapses": t.collapsing + t.collapsingInto, "purges": t.purging, "compactions": t.compacting,
    "slow folds": t.slowFolds, "unassembled reports": t.reports, "flush waiters": t.flushWaiters,
  });
  for (const [what, count] of Object.entries(zero)) if (count) problems.push(`tables: ${count} ${what}`);
  for (const [cache, cap] of Object.entries(CACHE_CAPS)) if (t[cache as keyof typeof CACHE_CAPS] > cap) problems.push(`tables: ${t[cache as keyof typeof CACHE_CAPS]} ${cache}, over the cap of ${cap}`);
  return problems;
}

/** `tables` for a kernel: no finished run keeps its scope, no scope keeps a forgotten node or a disconnected effect, no forgotten node keeps demand. */
export function kernelTableProblems(t: KernelTables, options: { readonly settled?: boolean } = {}): string[] {
  const zero: Record<string, number> = {
    "finished runs' scopes": t.finishedScopes, "forgotten nodes in run scopes": t.forgottenInScopes,
    "disconnected effects in run scopes": t.strayEffects, "demand edges from forgotten nodes": t.staleDemands,
  };
  if (options.settled) Object.assign(zero, {
    "queued changes": t.pendingChanges, "queued observations": t.pendingObservations, "buffered observations": t.transactionBuffer, "primed nodes": t.primed,
  });
  return Object.entries(zero).filter(([, count]) => count).map(([what, count]) => `tables: ${count} ${what}`);
}
