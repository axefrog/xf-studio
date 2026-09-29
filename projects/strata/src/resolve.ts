/**
 * Resolution: the effective value of node N at path p is N's own value, else each feed covering p in order, else the
 * base, else the type's default. Map keys are the union of the keys found at every step. Results are memoised per
 * (node, path) for one point in time and invalidated by propagation.
 */
import type { Json } from "./json";
import { defaultAt, kindAt } from "./define";
import type { TypeSpec } from "./define";
import { covers, isTombstone, keyPath, pathKey, startsWith } from "./paths";
import type { FieldKind, Layer, NodeRef, NodeState, Origin, Path } from "./types";

/** What a resolver reads: states at one point in time. */
export interface StateReader {
  /** The node's state at this reader's time, or null when it doesn't exist then (missing, purged, retracted). */
  state(ref: NodeRef): NodeState | null;
  def(type: string): TypeSpec | undefined;
  /** A resolver for a pinned layer's point, or null when that history isn't available. */
  pinned(layer: Layer): Resolver | null;
  /** The type's defaults, memoised by the reader. */
  defaults(type: string): Readonly<Record<string, unknown>> | undefined;
}

export type Resolved = { readonly has: boolean; readonly value?: Json; readonly origin: Origin };
const ABSENT: Resolved = Object.freeze({ has: false, origin: Object.freeze({ via: "absent" as const }) });

const ownerOf = (resolved: Resolved): NodeRef | "default" =>
  resolved.origin.via === "own" ? resolved.origin.node : resolved.origin.via === "feed" || resolved.origin.via === "base" ? resolved.origin.owner : "default";

/** Feeds in order, then the base. */
export const layerOrder = (layers: readonly Layer[]): Layer[] =>
  [...layers.filter(layer => layer.role === "feed"), ...layers.filter(layer => layer.role === "base")];

export class Resolver {
  private leaves = new Map<string, Map<string, Resolved>>();
  private keys = new Map<string, Map<string, readonly string[]>>();
  private visiting = new Set<string>();
  /** How many times resolution has met a layer cycle: a result that met one depends on where it started. */
  private cycleHits = 0;
  constructor(readonly reader: StateReader) {}

  /** Drops what is memoised for a node. */
  invalidate(id: string): void { this.leaves.delete(id); this.keys.delete(id); }
  clear(): void { this.leaves.clear(); this.keys.clear(); }
  /** Whether anything is memoised for a node (tests use it to check invalidation). */
  memoised(id: string): ReadonlyMap<string, Resolved> | undefined { return this.leaves.get(id); }

  private layerResolver(layer: Layer): Resolver | null { return layer.at ? this.reader.pinned(layer) : this; }

  /** The effective value at a leaf path. */
  leaf(ref: NodeRef, path: Path): Resolved {
    const key = pathKey(path);
    let memo = this.leaves.get(ref.id);
    const hit = memo?.get(key);
    if (hit) return hit;
    const guard = `${ref.id}\u0000${key}`;
    // A layer cycle that reached memory (another window's commit): the repeated layer yields nothing (SPEC §12.5).
    if (this.visiting.has(guard)) { this.cycleHits++; return ABSENT; }
    this.visiting.add(guard);
    const hits = this.cycleHits;
    let result: Resolved;
    try { result = this.compute(ref, path, key); } finally { this.visiting.delete(guard); }
    // A result that met a cycle is not memoised: read from another node of the cycle, the answer differs, and the
    // order of reads must never change an answer.
    if (this.cycleHits !== hits) return result;
    if (!memo) this.leaves.set(ref.id, memo = new Map());
    memo.set(key, result);
    return result;
  }

  private compute(ref: NodeRef, path: Path, key: string): Resolved {
    const state = this.reader.state(ref);
    if (!state) return ABSENT;
    const def = this.reader.def(ref.type);
    const at = def && kindAt(def, path);
    if (!def || !at || !at.leaf) return ABSENT;
    const own = state.own[key];
    if (own !== undefined) return isTombstone(own) ? ABSENT : { has: true, value: own, origin: { via: "own", node: ref } };
    if (at.spec.inherit !== false) for (const layer of layerOrder(state.layers)) {
      if (layer.role === "feed" && !covers(layer.paths, path)) continue;
      const source = this.layerResolver(layer);
      const found = source?.leaf(layer.from, path);
      if (found?.has) return { has: true, value: found.value, origin: { via: layer.role, layer: layer.from, owner: ownerOf(found) } };
    }
    const fallback = defaultAt(this.reader.defaults(ref.type), path);
    return fallback === undefined ? ABSENT : { has: true, value: fallback as Json, origin: { via: "default" } };
  }

  /** The keys present at a map path (union across layers, tombstones and empty submaps removed), sorted. */
  mapKeys(ref: NodeRef, path: Path): readonly string[] {
    const key = pathKey(path);
    let memo = this.keys.get(ref.id);
    const hit = memo?.get(key);
    if (hit) return hit;
    const guard = `${ref.id}\u0001${key}`;
    if (this.visiting.has(guard)) { this.cycleHits++; return []; }
    this.visiting.add(guard);
    const hits = this.cycleHits;
    let result: readonly string[];
    try { result = this.computeKeys(ref, path); } finally { this.visiting.delete(guard); }
    if (this.cycleHits !== hits) return result;
    if (!memo) this.keys.set(ref.id, memo = new Map());
    memo.set(key, result);
    return result;
  }

  private candidateKeys(ref: NodeRef, path: Path, into: Set<string>): void {
    const state = this.reader.state(ref);
    if (!state) return;
    const def = this.reader.def(ref.type);
    const at = def && kindAt(def, path);
    if (!def || !at || at.leaf) return;
    for (const ownKey of Object.keys(state.own)) {
      const ownPath = keyPath(ownKey);
      if (ownPath.length > path.length && startsWith(ownPath, path)) into.add(ownPath[path.length]);
    }
    if (at.spec.inherit !== false) for (const layer of state.layers) {
      const source = this.layerResolver(layer);
      if (!source) continue;
      for (const child of source.mapKeys(layer.from, path)) {
        const childPath = [...path, child];
        if (layer.role === "base" || layer.paths === "*" ||
          layer.paths.some(mask => startsWith(childPath, mask) || startsWith(mask, childPath))) into.add(child);
      }
    }
    const fallback = defaultAt(this.reader.defaults(ref.type), path);
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) for (const child of Object.keys(fallback)) into.add(child);
  }

  private computeKeys(ref: NodeRef, path: Path): readonly string[] {
    const def = this.reader.def(ref.type);
    const at = def && kindAt(def, path);
    if (!def || !at || at.leaf) return [];
    const candidates = new Set<string>();
    this.candidateKeys(ref, path, candidates);
    const inner = (at.kind as Extract<FieldKind, { kind: "map" }>).of;
    return [...candidates].sort().filter(child => inner.kind === "map"
      ? this.mapKeys(ref, [...path, child]).length > 0 : this.leaf(ref, [...path, child]).has);
  }

  /** The effective value at any path: a leaf's value, or a map path as an object of its present keys. */
  value(ref: NodeRef, path: Path): unknown {
    const def = this.reader.def(ref.type);
    const at = def && kindAt(def, path);
    if (!at) return undefined;
    if (at.leaf) return this.leaf(ref, path).value;
    const out: Record<string, unknown> = {};
    for (const child of this.mapKeys(ref, path)) out[child] = this.value(ref, [...path, child]);
    return out;
  }

  /** The node's whole effective value, by field; undefined for a node that doesn't exist at this time. */
  effective(ref: NodeRef): Readonly<Record<string, unknown>> | undefined {
    const def = this.reader.def(ref.type);
    if (!def || !this.reader.state(ref)) return undefined;
    const out: Record<string, unknown> = {};
    for (const field of Object.keys(def.fields)) {
      const value = this.value(ref, [field]);
      if (value !== undefined) out[field] = value;
    }
    return out;
  }

  /** Every present leaf path of the node, sorted by path key. */
  leafPaths(ref: NodeRef): Path[] {
    const def = this.reader.def(ref.type);
    if (!def || !this.reader.state(ref)) return [];
    const out: Path[] = [];
    const walk = (path: Path, kind: FieldKind) => {
      if (kind.kind !== "map") { if (this.leaf(ref, path).has) out.push(path); return; }
      for (const child of this.mapKeys(ref, path)) walk([...path, child], kind.of);
    };
    for (const [field, spec] of Object.entries(def.fields)) walk([field], spec);
    return out;
  }
}
