// Predicate and selector evaluation (spec 4.2, 8.1, 10.5), shared by resolution (rule `when`, selector
// `where`, field bases), queries (`must`, `prefer`) and relevance matching (interest selectors).
//
// The evaluator is pure over a small environment. The environment decides what a read may touch: in
// resolution it enforces spec 2.3 (only the same node's earlier slots, and the slots of the owner
// chain); in queries and matching, paths may also cross node slots, never ref slots.

import type { Schema } from './schema.ts';
import type {
  Edge, EdgeTypeId, GameTime, Id, KindId, Predicate, Region, ResolveResult, Selector, SlotPath, SpatialRegion, Value,
} from './types.ts';
import { contains } from './region.ts';
import { valueKey } from './value.ts';

/** How a subject node relates to the change being matched (spec 10.5). */
export interface Binding {
  node: Id;
  slot?: SlotPath;
  role?: string;
  effect?: string;
  edge?: EdgeTypeId;
}

/** Thrown when a read breaks spec 2.3 in resolution. The caller treats the contribution as not applicable. */
export class ReadViolation extends Error {
  constructor(public readonly why: string) {
    super(why);
  }
}

export interface PredicateEnv {
  schema: Schema;
  /** The time the predicate is evaluated at. */
  t: GameTime;
  /** The resolved value of one slot of a node. */
  read(node: Id, path: SlotPath): ResolveResult;
  kindOf(node: Id): KindId | undefined;
  /** The owner of an owned value or member, if the node has one. */
  ownerOf(node: Id): Id | undefined;
  /** The node held by a node slot path ("name", "traits[2]") of `node`, or undefined when it does not exist (count too small). */
  child(node: Id, seg: SlotPath): Id | undefined;
  /** Edges leaving a node, as they stand (validity is checked here). */
  edgesFrom(node: Id): Edge[];
  /** Edges arriving at a node. */
  edgesTo(node: Id): Edge[];
  /** One unit of work per predicate tested. */
  charge(n?: number): void;
  /** Resolution mode: the slot being resolved. Reads are limited to earlier slots of this node and the owner chain. */
  restrict?: { node: Id; order: number };
  binding?: Binding;
  /** An edge to count as present even though it has ended (matching an `ended` change). */
  includeEdge?: Edge;
  /** Expand a scope Id written `root:<name>` to the real root Id. */
  expandId?(id: string): Id;
}

const SELF = '@self';

export function edgeActive(e: Edge, t: GameTime): boolean {
  return e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to);
}

function activeEdges(env: PredicateEnv, list: Edge[]): Edge[] {
  const out = list.filter((e) => edgeActive(e, env.t));
  if (env.includeEdge && list.includes(env.includeEdge) && !out.includes(env.includeEdge)) out.push(env.includeEdge);
  return out;
}

export function nodeEdgesFrom(env: PredicateEnv, node: Id): Edge[] {
  const out = activeEdges(env, env.edgesFrom(node));
  // A symmetric edge type also counts from its `to` end.
  for (const e of activeEdges(env, env.edgesTo(node))) {
    if (env.schema.edgeTypes.get(e.type)?.symmetric) out.push({ ...e, from: e.to, to: e.from });
  }
  return out;
}

type Target = { k: 'value'; value: Value; slot?: { dimBuckets?: (v: Value) => string[] } } | { k: 'node'; node: Id } | { k: 'missing' };

/** The chain of owners of a node, nearest first. */
export function ownerChain(env: PredicateEnv, node: Id): Id[] {
  const out: Id[] = [];
  let cur = env.ownerOf(node);
  while (cur !== undefined && !out.includes(cur)) {
    out.push(cur);
    cur = env.ownerOf(cur);
  }
  return out;
}

function checkRestricted(env: PredicateEnv, node: Id, segs: string[]): void {
  const r = env.restrict!;
  let upto = 0;
  while (segs[upto] === '^') upto++;
  const rest = segs.slice(upto);
  if (rest.length !== 1) throw new ReadViolation(`a resolution may read one slot, not "${segs.join('/')}"`);
  const last = rest[0]!;
  let cur = node;
  for (let n = 0; n < upto; n++) {
    const o = env.ownerOf(cur);
    if (o === undefined) throw new ReadViolation('the node has no owner');
    cur = o;
  }
  const kind = env.kindOf(cur);
  if (!kind) throw new ReadViolation('unknown node');
  const info = env.schema.slotInfo(kind, last);
  if (!info) throw new ReadViolation(`unknown slot "${last}"`);
  if (info.index !== undefined) throw new ReadViolation(`"${last}" addresses a member`);
  if (!info.isCount && (info.vt.t === 'ref' || info.vt.t === 'node')) throw new ReadViolation(`"${last}" is a ${info.vt.t} slot`);
  if (upto === 0 && !(info.order < r.order)) throw new ReadViolation(`"${last}" is not an earlier slot`);
}

/** Follow a predicate path from a node to a value or a node. */
function follow(env: PredicateEnv, node: Id, rawPath: string): { target: Target; bucket: boolean } {
  let path = rawPath;
  let bucket = false;
  if (path.endsWith(':bucket')) {
    bucket = true;
    path = path.slice(0, -':bucket'.length);
  }
  if (path === SELF) return { target: { k: 'value', value: node }, bucket };
  if (path === '@role') return { target: env.binding?.role === undefined ? { k: 'missing' } : { k: 'value', value: env.binding.role }, bucket };
  if (path === '@effect') return { target: env.binding?.effect === undefined ? { k: 'missing' } : { k: 'value', value: env.binding.effect }, bucket };
  if (path === '@edge') return { target: env.binding?.edge === undefined ? { k: 'missing' } : { k: 'value', value: env.binding.edge }, bucket };
  if (path === '' || path === '.') return { target: { k: 'node', node }, bucket };
  const segs = path.split('/');
  if (env.restrict) checkRestricted(env, node, segs);
  let cur = node;
  for (let n = 0; n < segs.length; n++) {
    const seg = segs[n]!;
    const isLast = n === segs.length - 1;
    if (seg === '^') {
      const o = env.ownerOf(cur);
      if (o === undefined) return { target: { k: 'missing' }, bucket };
      cur = o;
      if (isLast) return { target: { k: 'node', node: cur }, bucket };
      continue;
    }
    if (isLast) {
      const r = env.read(cur, seg);
      if (r.value === undefined || (r.status !== 'ok' && r.status !== 'contradiction')) return { target: { k: 'missing' }, bucket };
      return { target: { k: 'value', value: r.value }, bucket };
    }
    const next = env.child(cur, seg);
    if (next === undefined) return { target: { k: 'missing' }, bucket };
    cur = next;
  }
  return { target: { k: 'node', node: cur }, bucket };
}

function bucketKeys(env: PredicateEnv, node: Id, path: string, value: Value): string[] {
  // The dimension of the final slot decides the bucket function.
  const segs = path.slice(0, -':bucket'.length).split('/');
  let cur = node;
  for (let n = 0; n < segs.length - 1; n++) {
    const seg = segs[n]!;
    if (seg === '^') {
      const o = env.ownerOf(cur);
      if (o === undefined) return [];
      cur = o;
    } else {
      const next = env.child(cur, seg);
      if (next === undefined) return [];
      cur = next;
    }
  }
  const kind = env.kindOf(cur);
  if (!kind) return [];
  const info = env.schema.slotInfo(kind, segs[segs.length - 1]!);
  const fn = info?.dim.buckets;
  if (!fn) return [];
  return env.schema.registry.get('buckets', fn)(value, fn.params ?? {});
}

function asList(arg: Predicate['arg']): Value[] | Region {
  if (Array.isArray(arg)) return arg as Value[];
  if (typeof arg === 'object' && arg !== null && 'r' in arg) return arg as Region;
  return [arg as Value];
}

function inArg(v: Value, arg: Predicate['arg']): boolean {
  const list = asList(arg);
  if (Array.isArray(list)) return list.some((x) => valueKey(x) === valueKey(v));
  return contains(list, v);
}

/** Evaluate one predicate on a node. Consumes one work unit. */
export function evalPredicate(env: PredicateEnv, p: Predicate, node: Id): boolean {
  env.charge(1);
  if (p.op === 'has-edge' || p.op === 'lacks-edge') {
    const { target } = follow(env, node, p.path);
    const subject = target.k === 'node' ? target.node : target.k === 'value' && typeof target.value === 'string' ? target.value : undefined;
    if (subject === undefined) return p.op === 'lacks-edge';
    const spec = p.arg as { edge: EdgeTypeId; to?: Id | Selector };
    const edges = nodeEdgesFrom(env, subject).filter((e) => e.type === spec.edge);
    let found = false;
    for (const e of edges) {
      if (spec.to === undefined) {
        found = true;
      } else if (typeof spec.to === 'string') {
        found = e.to === (env.expandId ? env.expandId(spec.to) : spec.to);
      } else {
        found = selectorMatches(env, spec.to, e.to, null);
      }
      if (found) break;
    }
    return p.op === 'has-edge' ? found : !found;
  }
  const { target, bucket } = follow(env, node, p.path);
  if (target.k === 'missing') return false;
  const v: Value = target.k === 'node' ? target.node : target.value;
  if (bucket) {
    const keys = bucketKeys(env, node, p.path, v);
    switch (p.op) {
      case 'in':
      case 'eq':
        return keys.some((k) => inArg(k, p.arg));
      case 'not-in':
        return !keys.some((k) => inArg(k, p.arg));
      default:
        return false;
    }
  }
  switch (p.op) {
    case 'in':
      return inArg(v, p.arg);
    case 'not-in':
      return !inArg(v, p.arg);
    case 'eq':
      return valueKey(v) === valueKey(p.arg as Value);
    case 'range': {
      const a = p.arg;
      if (typeof v !== 'number') return false;
      if (Array.isArray(a)) return v >= (a[0] as number) && v <= (a[1] as number);
      if (typeof a === 'object' && a !== null && 'r' in a) return contains(a as Region, v);
      return false;
    }
    case 'field-at-least':
      return typeof v === 'number' && typeof p.arg === 'number' && v >= p.arg;
    case 'field-at-most':
      return typeof v === 'number' && typeof p.arg === 'number' && v <= p.arg;
  }
  return false;
}

export function evalAll(env: PredicateEnv, ps: Predicate[] | undefined, node: Id): boolean {
  for (const p of ps ?? []) if (!evalPredicate(env, p, node)) return false;
  return true;
}

export function inSpatialRegion(pos: Value, region: SpatialRegion): boolean {
  if (!Array.isArray(pos)) return false;
  if ('radius' in region) {
    let d2 = 0;
    for (let i = 0; i < region.center.length; i++) {
      const d = (pos[i] ?? 0) - region.center[i]!;
      d2 += d * d;
    }
    return d2 <= region.radius * region.radius;
  }
  return region.min.every((lo, i) => (pos[i] ?? 0) >= lo && (pos[i] ?? 0) <= region.max[i]!);
}

/**
 * Whether `container` holds `node` (spec 4.2, SPEC-NOTES 14): the node is the Id, or the Id is in its
 * owner chain, or following valid `core:located-in` edges from the node or an owner-chain node reaches it.
 */
export function isUnder(env: PredicateEnv, node: Id, container: Id): boolean {
  const seen = new Set<Id>();
  const queue: Id[] = [node, ...ownerChain(env, node)];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === container) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of activeEdges(env, env.edgesFrom(cur))) {
      if (e.type === 'core:located-in') queue.push(e.to);
    }
    const o = env.ownerOf(cur);
    if (o !== undefined) queue.push(o);
  }
  return false;
}

function scopeContains(env: PredicateEnv, scope: NonNullable<Selector['scope']>, node: Id): boolean {
  env.charge(1);
  if ('nodes' in scope) {
    const ids = scope.nodes.map((n) => (env.expandId ? env.expandId(n) : n));
    return ids.includes(node);
  }
  if ('under' in scope) return isUnder(env, node, env.expandId ? env.expandId(scope.under) : scope.under);
  const r = env.read(node, 'position');
  if (r.value === undefined) return false;
  return inSpatialRegion(r.value, scope.region);
}

/**
 * Whether a selector matches a node, and (for a slot) the slot path. `slotPath` is null when the
 * selector is tested against a node only (for example a `has-edge` target). Checks, in order: kind,
 * slot, scope, `where`.
 */
export function selectorMatches(env: PredicateEnv, sel: Selector, node: Id, slotPath: SlotPath | null): boolean {
  if (sel.kind !== undefined) {
    const k = env.kindOf(node);
    if (!k || !env.schema.isKind(k, sel.kind)) return false;
  }
  if (slotPath !== null && sel.slot !== '*') {
    if (sel.slot.endsWith('[*]')) {
      if (!slotPath.startsWith(sel.slot.slice(0, -3) + '[')) return false;
    } else if (sel.slot !== slotPath) return false;
  }
  if (sel.scope && !scopeContains(env, sel.scope, node)) return false;
  return evalAll(env, sel.where, node);
}

/** Whether `sel` names `node` by Id: in `scope.nodes`, or by an `@self` test in `where` (spec 10.5, SPEC-NOTES 22). */
export function namesNode(env: PredicateEnv, sel: Selector, node: Id): boolean {
  if (sel.scope && 'nodes' in sel.scope) {
    const ids = sel.scope.nodes.map((n) => (env.expandId ? env.expandId(n) : n));
    if (ids.includes(node)) return true;
  }
  for (const p of sel.where ?? []) {
    if ((p.path === SELF || p.path === '' || p.path === '.') && (p.op === 'eq' || p.op === 'in')) {
      if (inArg(node, p.arg)) return true;
    }
  }
  return false;
}
