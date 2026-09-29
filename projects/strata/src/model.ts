/**
 * A read model over states at one point in time: resolution, references, derivations and rule contexts. The graph's
 * head uses one (with its reverse indexes); `graph.at(T)` gives another for a past point.
 */
import { freeze } from "./json";
import type { DeriveContext, RuleContext, TypeSpec } from "./define";
import { Resolver } from "./resolve";
import type { StateReader } from "./resolve";
import type { FieldKind, Layer, NodeRef, NodeState, NodeType, OwnValues, Path } from "./types";

/** A node as the graph publishes it: detached (frozen) data. */
export type NodeSnapshot = {
  readonly ref: NodeRef; readonly name: string; readonly seq: number; readonly constant: boolean; readonly trashed: boolean;
  /** What the node sets itself (by path key) and its layers: the research view. */
  readonly own: OwnValues; readonly layers: readonly Layer[];
  /** The effective value, by field (map fields as objects of their present keys). */
  readonly value: Readonly<Record<string, unknown>>;
};

export type DeriveResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: "missing" | "cycle" | "unknown"; readonly cycle?: readonly NodeRef[] };

export type Reference = { readonly path: Path; readonly target: NodeRef; readonly follows: boolean };
export type Referrer = { readonly node: NodeRef; readonly path: Path; readonly follows: boolean };

class CycleError extends Error { constructor(readonly cycle: NodeRef[]) { super("derivation cycle"); } }

export class ReadModel {
  readonly resolver: Resolver;
  private derived = new Map<string, Map<string, DeriveResult>>();
  private deriving: { id: string; name: string; ref: NodeRef }[] = [];

  constructor(readonly reader: StateReader, private ids: () => Iterable<NodeRef>, private meta: (ref: NodeRef) => { seq: number; constant: boolean }) {
    this.resolver = new Resolver(reader);
  }

  def(type: NodeType): TypeSpec | undefined { return this.reader.def(type); }
  state(ref: NodeRef): NodeState | null { return this.reader.state(ref); }
  exists(ref: NodeRef): boolean { return !!this.reader.state(ref); }
  trashed(ref: NodeRef): boolean { return !!this.reader.state(ref)?.trashed; }
  layers(ref: NodeRef): readonly Layer[] { return this.reader.state(ref)?.layers ?? []; }

  /** Every node that exists at this point, of one type or all. */
  nodes(type?: NodeType): NodeRef[] {
    const out: NodeRef[] = [];
    for (const ref of this.ids()) if ((!type || ref.type === type) && this.reader.state(ref)) out.push(ref);
    return out;
  }

  resolve(ref: NodeRef, path?: Path): unknown {
    return path ? this.resolver.value(ref, path) : this.resolver.effective(ref);
  }

  read(ref: NodeRef): NodeSnapshot | undefined {
    const state = this.reader.state(ref);
    const value = state && this.resolver.effective(ref);
    if (!state || !value) return undefined;
    const { seq, constant } = this.meta(ref);
    return freeze({ ref: { type: ref.type, id: ref.id }, name: state.name, seq, constant, trashed: state.trashed, own: state.own,
      layers: state.layers, value: freeze(value) });
  }

  /** The references a node holds: the effective values of its ref, refs and map-of-ref fields. */
  references(ref: NodeRef): Reference[] {
    const def = this.reader.def(ref.type);
    if (!def || !this.reader.state(ref)) return [];
    const out: Reference[] = [];
    const walk = (path: Path, kind: FieldKind) => {
      if (kind.kind === "map") { for (const key of this.resolver.mapKeys(ref, path)) walk([...path, key], kind.of); return; }
      if (kind.kind !== "ref" && kind.kind !== "refs") return;
      const value = this.resolver.leaf(ref, path).value;
      const targets = kind.kind === "ref" ? [value] : Array.isArray(value) ? value : [];
      for (const target of targets) if (target && typeof target === "object" && typeof (target as NodeRef).id === "string")
        out.push({ path, target: target as NodeRef, follows: !!kind.follows });
    };
    for (const [field, spec] of Object.entries(def.fields)) if (hasRefs(spec)) walk([field], spec);
    return out;
  }

  /** Nodes referencing `ref` (scans every node; the graph's head overrides this with its index). */
  referrers(ref: NodeRef): readonly Referrer[] {
    const out: Referrer[] = [];
    for (const node of this.nodes()) for (const item of this.references(node))
      if (item.target.id === ref.id) out.push({ node, path: item.path, follows: item.follows });
    return out;
  }

  /** A circle of `follows` references reachable from `start`, as its edges, or null. */
  followCycle(start: NodeRef): { from: NodeRef; path: Path; to: NodeRef }[] | null {
    const onStack = new Map<string, number>(), done = new Set<string>();
    const stack: { from: NodeRef; path: Path; to: NodeRef }[] = [];
    const visit = (ref: NodeRef): { from: NodeRef; path: Path; to: NodeRef }[] | null => {
      onStack.set(ref.id, stack.length);
      for (const edge of this.references(ref)) {
        if (!edge.follows || !this.exists(edge.target)) continue;
        stack.push({ from: ref, path: edge.path, to: edge.target });
        const at = onStack.get(edge.target.id);
        if (at !== undefined) return stack.slice(at);
        if (!done.has(edge.target.id)) { const found = visit(edge.target); if (found) return found; }
        stack.pop();
      }
      onStack.delete(ref.id);
      done.add(ref.id);
      return null;
    };
    return this.exists(start) ? visit(start) : null;
  }

  /** A derived value, computed on demand and memoised; a circle of `follows` derivations is a cycle, not a loop. */
  derive(ref: NodeRef, name: string): DeriveResult {
    const memo = this.derived.get(ref.id)?.get(name);
    if (memo) return memo;
    const def = this.reader.def(ref.type), fn = def?.derive?.[name];
    if (!fn) return { ok: false, reason: "unknown" };
    if (!this.reader.state(ref)) return { ok: false, reason: "missing" };
    const at = this.deriving.findIndex(item => item.id === ref.id && item.name === name);
    if (at >= 0) throw new CycleError([...this.deriving.slice(at).map(item => item.ref), ref]);
    this.deriving.push({ id: ref.id, name, ref });
    let result: DeriveResult;
    try {
      const context: DeriveContext = {
        node: ref,
        resolve: (target, path) => this.resolve(target, path),
        exists: target => this.exists(target),
        derived: (target, inner) => {
          const found = this.derive(target, inner);
          if (!found.ok && found.reason === "cycle") throw new CycleError([...(found.cycle ?? [])]);
          return found.ok ? found.value : undefined;
        },
      };
      result = { ok: true, value: freeze(fn(context)) };
    } catch (error) {
      if (!(error instanceof CycleError)) throw error;
      result = { ok: false, reason: "cycle", cycle: error.cycle };
    } finally { this.deriving.pop(); }
    if (this.deriving.length === 0 || result.ok) {
      let memo2 = this.derived.get(ref.id);
      if (!memo2) this.derived.set(ref.id, memo2 = new Map());
      memo2.set(name, result);
    }
    return result;
  }

  clearDerived(): void { this.derived.clear(); }

  ruleContext(): RuleContext {
    return {
      resolve: (ref, path) => this.resolve(ref, path),
      exists: ref => this.exists(ref),
      trashed: ref => this.trashed(ref),
      layers: ref => this.layers(ref),
      referrers: ref => this.referrers(ref),
      references: ref => this.references(ref),
      followCycle: ref => this.followCycle(ref),
      nodes: type => this.nodes(type),
      typeOf: type => this.reader.def(type),
    };
  }
}

export const hasRefs = (kind: FieldKind): boolean => kind.kind === "ref" || kind.kind === "refs" || kind.kind === "map" && hasRefs(kind.of);
