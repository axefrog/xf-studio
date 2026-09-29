/**
 * The brute-force reference model: resolution written the naive way (no memo, no indexes, a different formulation)
 * so property tests and the simulation can check the engine's memoised, incremental answers against it. Each node's
 * effective value is built bottom-up as a set of present leaves: the type's defaults, overridden by the base's leaves,
 * then by each feed's covered leaves (last feed first, so the first listed wins), then by the node's own values, where
 * a tombstone removes the key.
 */
import type { Json } from "../json";
import type { TypeSpec } from "../define";
import { fold } from "../fold";
import { covers, isTombstone, keyPath, pathKey } from "../paths";
import type { Entry, FieldKind, Layer, NodeRef, NodeState, Path } from "../types";

/** States of every node at one point: null when a node doesn't exist then. */
export type StatesAt = (ref: NodeRef) => NodeState | null;

export type ReferenceModel = {
  /** A node's present leaves at a point, by path key. */
  leaves(states: StatesAt, ref: NodeRef): Map<string, Json>;
  /** A node's effective value (map fields as objects of present keys), or undefined when it doesn't exist. */
  effective(states: StatesAt, ref: NodeRef): Record<string, unknown> | undefined;
};

/**
 * Builds the reference model. `pinned(layer)` gives the states at a pinned layer's point (or null when unknown).
 */
export function referenceModel(types: readonly TypeSpec[], pinned: (layer: Layer) => StatesAt | null): ReferenceModel {
  const byType = new Map(types.map(def => [def.type, def]));

  function defaultLeaves(def: TypeSpec): Map<string, Json> {
    const out = new Map<string, Json>();
    const defaults = def.defaults?.() ?? {};
    const walk = (path: string[], kind: FieldKind, value: unknown) => {
      if (value === undefined) return;
      if (kind.kind === "map") {
        if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) walk([...path, key], kind.of, item);
        return;
      }
      out.set(pathKey(path), value as Json);
    };
    for (const [field, spec] of Object.entries(def.fields)) walk([field], spec, (defaults as Record<string, unknown>)[field]);
    return out;
  }

  function leaves(states: StatesAt, ref: NodeRef, depth = 0): Map<string, Json> {
    const def = byType.get(ref.type), state = states(ref);
    if (!def || !state || depth > 64) return new Map();
    const inheritable = (key: string) => def.fields[keyPath(key)[0]]?.inherit !== false;
    const out = defaultLeaves(def);
    const layerLeaves = (layer: Layer) => {
      const at = layer.at ? pinned(layer) : states;
      return at ? leaves(at, layer.from, depth + 1) : new Map<string, Json>();
    };
    const base = state.layers.find(layer => layer.role === "base");
    if (base) for (const [key, value] of layerLeaves(base)) if (inheritable(key)) out.set(key, value);
    const feeds = state.layers.filter(layer => layer.role === "feed");
    for (const feed of [...feeds].reverse())
      for (const [key, value] of layerLeaves(feed)) if (inheritable(key) && covers(feed.paths, keyPath(key))) out.set(key, value);
    for (const [key, value] of Object.entries(state.own)) {
      if (isTombstone(value)) out.delete(key); else out.set(key, value);
    }
    // Keep only leaves the type has (a default or source can't add a path the type lacks).
    for (const key of [...out.keys()]) if (!isLeaf(def, keyPath(key))) out.delete(key);
    return out;
  }

  function isLeaf(def: TypeSpec, path: Path): boolean {
    let kind: FieldKind | undefined = def.fields[path[0]];
    for (let i = 1; kind && i < path.length; i++) kind = kind.kind === "map" ? kind.of : undefined;
    return !!kind && kind.kind !== "map";
  }

  function effective(states: StatesAt, ref: NodeRef): Record<string, unknown> | undefined {
    const def = byType.get(ref.type);
    if (!def || !states(ref)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(def.fields)) if (spec.kind === "map") out[field] = {};
    for (const [key, value] of [...leaves(states, ref)].sort(([a], [b]) => a < b ? -1 : 1)) {
      const path = keyPath(key);
      let target = out;
      for (let i = 0; i < path.length - 1; i++) {
        target[path[i]] ??= {};
        target = target[path[i]] as Record<string, unknown>;
      }
      target[path[path.length - 1]] = value;
    }
    return out;
  }

  return { leaves, effective };
}

/** Replays entries from empty: every node's state at position `pos` (a from-empty fold, for the consistent-cut check). */
export function replayTo(types: readonly TypeSpec[], entries: readonly Entry[], pos: number): Map<string, { ref: NodeRef; state: NodeState | null }> {
  const byType = new Map(types.map(def => [def.type, def]));
  const streams = new Map<string, { ref: NodeRef; entries: Entry[] }>();
  // Streams collapsed into an entry are replayed from its copy, by their own positions.
  for (const entry of entries.flatMap(item => [item, ...(item.inlined ?? []).flatMap(inner => inner.entries)])) {
    if (entry.pos > pos) continue;
    let stream = streams.get(entry.node.id);
    if (!stream) streams.set(entry.node.id, stream = { ref: entry.node, entries: [] });
    stream.entries.push(entry);
  }
  const out = new Map<string, { ref: NodeRef; state: NodeState | null }>();
  for (const [id, stream] of streams) out.set(id, { ref: stream.ref, state: fold(null, stream.entries.sort((a, b) => a.seq - b.seq), byType.get(stream.ref.type)) });
  return out;
}
