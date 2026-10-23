// Resolution (spec 5): constraint arbitration, weights and the flat Gumbel-max draw.
//
// `resolve(node, path, t)` is an outer operation: it gets one work allowance, a stack of the
// (node, slot) pairs being resolved (the cycle guard, spec 2.3) and a depth limit. Nested resolutions
// share the allowance. Exhausting any hard limit throws LimitExceeded, which the outer operation turns
// into `failed` plus a defect. Resolution never emits changes and never bumps the revision (I-13).

import { ln } from './fdlibm-log.ts';
import { H, i as hi, id as hid, rand, s as hs, val as hval } from './id.ts';
import type { Kernel } from './kernel.ts';
import {
  type Binding, type PredicateEnv, ReadViolation, evalAll, selectorMatches,
} from './predicate.ts';
import { ALL, intersect, isEmpty, subtract } from './region.ts';
import type { Schema, SlotInfo } from './schema.ts';
import type { Form } from './types.ts';
import {
  domainRegion, encodeValue, enumerateRegion, gridStep, normalizeRegion, pointRegion, regionSize, valueKey, valuesEqual,
} from './value.ts';
import { Allowance, LimitExceeded, failIfFailed } from './work.ts';
import type { ValueType } from './schema-types.ts';
import type {
  Contribution, GameTime, Id, Layer, NodeHeader, Pin, Region, ResolveResult, ResolveStatus, SlotPath, Value,
} from './types.ts';
import { CONTRADICTION_PRECEDENCE, PIN_PRECEDENCE, PRECEDENCE } from './types.ts';

// ---- operation context ----

export interface OpCtx {
  allowance: Allowance;
  stack: Set<string>;
  depth: number;
  /** The deepest nesting seen so far in the current subtree (used to record a cached result's height). */
  peak: number;
}

export function newOpCtx(limit: number): OpCtx {
  return { allowance: new Allowance(limit), stack: new Set(), depth: 0, peak: 0 };
}

// ---- trace records (spec 13) ----

export type ConstraintSource = 'pin' | 'contribution' | 'preimage' | 'structural' | 'descriptor';

export interface Constraint {
  id: Id;
  source: ConstraintSource;
  precedence: number;
  region: Region;
  /** A set contribution with allow: false: the region is removed from the feasible set. */
  negate: boolean;
  active: boolean;
  /** Pin reason or contribution layer, for display. */
  label: string;
}

export interface TraceFactor {
  /** The contribution Id, or "prior". */
  id: Id | 'prior';
  strength: number;
  /** The factor's name: the prior, a weight contribution, or a prior replacement. */
  kind: 'prior' | 'weight' | 'replaced-prior';
  /** The normalised factor at the winner and at the runner-up. */
  atWinner: number;
  atRunnerUp?: number;
}

export interface TraceScore {
  value: Value;
  /** ln P0hat + sum of strength * ln fhat. */
  score: number;
  /** The Gumbel noise g(v). */
  noise: number;
  /** score + g. */
  total: number;
}

export interface Trace {
  node: Id;
  slot: SlotPath;
  t: GameTime;
  window: number;
  mode: 'sampled' | 'assigned' | 'derived' | 'mirrored' | 'structural';
  status: ResolveStatus;
  value?: Value;
  /** The domain the arbitration started from. */
  domain?: Region;
  constraints: Constraint[];
  feasible?: Region;
  feasibleSize: number;
  factors: TraceFactor[];
  scores: TraceScore[];
  winner?: TraceScore;
  runnerUp?: TraceScore;
  /** The reading in effect, for a mirrored slot. */
  reading?: Id;
  notes: string[];
}

function emptyTrace(node: Id, slot: SlotPath, t: GameTime, window: number): Trace {
  return { node, slot, t, window, mode: 'sampled', status: 'ok', constraints: [], feasibleSize: 0, factors: [], scores: [], notes: [] };
}

// ---- helpers ----

const SEVERITY: Record<ResolveStatus, number> = { ok: 0, contradiction: 1, unavailable: 2, cycle: 3, failed: 4 };
export const worse = (a: ResolveStatus, b: ResolveStatus): ResolveStatus => (SEVERITY[b] > SEVERITY[a] ? b : a);

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const LAYER_PRECEDENCE: Record<Layer, number> = {
  observation: PRECEDENCE.observation,
  game: PRECEDENCE.game,
  authored: PRECEDENCE.authored,
  seeding: PRECEDENCE.seeding,
  simulation: PRECEDENCE.simulation,
  procedural: PRECEDENCE.procedural,
};

export const layerPrecedence = (l: Layer): number => LAYER_PRECEDENCE[l];

function splitWindow(raw: string): { path: SlotPath; window?: number } {
  const m = /^(.*)@w(-?\d+)$/.exec(raw);
  if (!m) return { path: raw };
  return { path: m[1]!, window: Number(m[2]) };
}

interface Res extends ResolveResult {}

interface CacheEntry {
  res: Res;
  cost: number;
  height: number;
}

/** The value a change carried for one slot of its subject: its new value, or the old one for a removal. */
export interface OwnValue {
  node: Id;
  slot: SlotPath;
  value: Value;
}

export type EffectiveMode = 'sampled' | 'assigned' | 'derived' | 'mirrored';

export class Resolver {
  private cache = new Map<string, CacheEntry>();
  private cacheRevision = -1;
  private cacheNow = Number.NaN;

  constructor(private readonly k: Kernel) {}

  private get schema(): Schema {
    return this.k.schema;
  }

  // ---- public API ----

  /** Forget every cached result (closing a node, spec 7.2). */
  clearCache(): void {
    this.cache.clear();
  }

  /** An outer resolution (spec 5). Hard limits turn into `failed` plus a defect. */
  resolve(node: Id, path: SlotPath, t: GameTime): ResolveResult {
    const ctx = newOpCtx(this.k.config.allowance);
    try {
      return this.resolveWithin(ctx, node, path, t);
    } catch (e) {
      if (e instanceof LimitExceeded) {
        this.k.defects.record({ kind: 'limit', detail: e.message, node, slot: path });
        return { status: 'failed' };
      }
      throw e;
    }
  }

  /** The complete, deterministic account of a resolution (spec 13). Bypasses the cache for the slot itself. */
  trace(node: Id, path: SlotPath, t: GameTime): Trace {
    const ctx = newOpCtx(this.k.config.allowance);
    const { path: plain, window: explicitK } = splitWindow(path);
    const header = this.k.store.header(node);
    const tr = emptyTrace(node, plain, t, 0);
    if (!header) {
      tr.status = 'unavailable';
      tr.notes.push('unknown node');
      return tr;
    }
    try {
      ctx.stack.add(`${node}|${path}`);
      ctx.depth = 1;
      ctx.peak = 1;
      const res = this.compute(ctx, header, plain, t, explicitK, tr);
      tr.status = res.status;
      if (res.value !== undefined) tr.value = res.value;
    } catch (e) {
      if (e instanceof LimitExceeded) {
        this.k.defects.record({ kind: 'limit', detail: e.message, node, slot: path });
        tr.status = 'failed';
        tr.notes.push(e.message);
      } else throw e;
    }
    return tr;
  }

  /** Resolution inside another outer operation (a query, a matcher): shares its allowance. */
  resolveWithin(ctx: OpCtx, node: Id, rawPath: SlotPath, t: GameTime): Res {
    // A cached result is valid for the same revision and the same engine time: retention, and through it the
    // structural constraints, depends on the time (SPEC-NOTES 53).
    if (this.cacheRevision !== this.k.revision || this.cacheNow !== this.k.now) {
      this.cache.clear();
      this.cacheRevision = this.k.revision;
      this.cacheNow = this.k.now;
    }
    const stackKey = `${node}|${rawPath}`;
    if (ctx.stack.has(stackKey)) {
      this.k.defects.record({ kind: 'cycle', detail: `re-entered (${node}, ${rawPath})`, node, slot: rawPath });
      return { status: 'cycle' };
    }
    const cacheKey = `${node}|${rawPath}|${t}`;
    const hit = this.cache.get(cacheKey);
    if (hit) {
      if (ctx.depth + hit.height > this.k.config.maxDepth) throw new LimitExceeded(`dependency depth ${this.k.config.maxDepth}`);
      ctx.allowance.spend(hit.cost);
      if (ctx.depth + hit.height > ctx.peak) ctx.peak = ctx.depth + hit.height;
      return hit.res;
    }
    if (ctx.depth >= this.k.config.maxDepth) throw new LimitExceeded(`dependency depth ${this.k.config.maxDepth}`);
    const header = this.k.store.header(node);
    if (!header) return { status: 'unavailable' };
    const { path, window: explicitK } = splitWindow(rawPath);

    const usedBefore = ctx.allowance.used;
    const savedPeak = ctx.peak;
    ctx.depth++;
    ctx.peak = ctx.depth;
    ctx.stack.add(stackKey);
    let res: Res;
    try {
      res = this.compute(ctx, header, path, t, explicitK);
    } finally {
      ctx.stack.delete(stackKey);
      ctx.depth--;
    }
    const height = ctx.peak - ctx.depth;
    ctx.peak = Math.max(savedPeak, ctx.peak);
    if (res.status !== 'cycle') {
      this.cache.set(cacheKey, { res, cost: ctx.allowance.used - usedBefore, height });
    }
    this.mirrorIntoNode(header.id, rawPath, res, t);
    return res;
  }

  private mirrorIntoNode(node: Id, rawPath: string, res: Res, t: GameTime): void {
    const n = this.k.store.ensureNode(node, this.k.now);
    n.touched = this.k.now;
    const entry: { s: 'resolved'; value?: Value; status: ResolveStatus; revision: number; at: GameTime } = {
      s: 'resolved', status: res.status, revision: this.k.revision, at: t,
    };
    if (res.value !== undefined) entry.value = res.value;
    n.slots.set(rawPath, entry);
  }

  // ---- environment for predicates ----

  /**
   * A predicate environment bound to an operation. Pass `restrict` for resolution-mode reads (spec 2.3).
   * Pass `own` when matching a change: reading that one slot gives the change's own value (spec 10.5).
   */
  makeEnv(ctx: OpCtx, t: GameTime, restrict?: { node: Id; order: number }, binding?: Binding, own?: OwnValue): PredicateEnv {
    const store = this.k.store;
    /**
     * Whether a read of (n, p) at `t` is a read of the slot the change carried a value for. A read names the
     * slot by its path; a pin on window `k` of a simulated temporal slot carries `path@w<k>`, and a read of
     * `path` at `t` is a read of window `floor(t / window)`, so it is the changed slot when that is `k`
     * (SPEC-NOTES 57). A read that names the window itself matches the key exactly.
     */
    const readsOwn = (n: Id, p: SlotPath): boolean => {
      if (!own || n !== own.node) return false;
      if (p === own.slot) return true;
      const changed = splitWindow(own.slot);
      if (changed.window === undefined || p !== changed.path) return false;
      const h = store.header(n);
      const window = h ? this.schema.slotInfo(h.kind, changed.path)?.def.temporal?.window : undefined;
      return window !== undefined && Math.floor(t / window) === changed.window;
    };
    const env: PredicateEnv = {
      schema: this.schema,
      t,
      read: (n, p) => (own && readsOwn(n, p) ? { value: own.value, status: 'ok' } : this.resolveWithin(ctx, n, p, t)),
      kindOf: (n) => store.header(n)?.kind,
      ownerOf: (n) => this.ownerOf(n),
      child: (n, seg) => this.childOf(ctx, n, seg, t),
      edgesFrom: (n) => store.edgesFrom(n),
      edgesTo: (n) => store.edgesTo(n),
      charge: (n = 1) => ctx.allowance.spend(n),
      expandId: (idStr) => this.k.expandId(idStr),
    };
    if (restrict) env.restrict = restrict;
    if (binding) env.binding = binding;
    return env;
  }

  ownerOf(node: Id): Id | undefined {
    const h = this.k.store.header(node);
    if (!h) return undefined;
    return h.origin.by === 'value' || h.origin.by === 'member' ? h.origin.owner : undefined;
  }

  /** The node held by a node slot path of `node` ("name", "traits[2]"), or undefined if it does not exist. */
  childOf(ctx: OpCtx, node: Id, seg: SlotPath, t: GameTime): Id | undefined {
    const h = this.k.store.header(node);
    if (!h) return undefined;
    const info = this.schema.slotInfo(h.kind, seg);
    if (!info || !info.isNode) return undefined;
    if (info.index !== undefined) {
      const count = this.resolveWithin(ctx, node, `${info.def.key}#count`, t);
      failIfFailed(count.status, `${info.def.key}#count of ${node}`);
      if (count.value === undefined || typeof count.value !== 'number' || info.index >= count.value) return undefined;
    }
    return this.k.address(node, seg);
  }

  // ---- the core ----

  private compute(ctx: OpCtx, header: NodeHeader, path: SlotPath, t: GameTime, explicitK: number | undefined, tr?: Trace): Res {
    const node = header.id;
    const info = this.schema.slotInfo(header.kind, path);
    if (!info) {
      this.k.defects.record({ kind: 'unknown-slot', detail: `${header.kind} has no slot "${path}"`, node, slot: path });
      return { status: 'unavailable' };
    }
    // Addressing member i needs count > i at the time (SPEC-NOTES 10).
    if (info.index !== undefined) {
      const count = this.resolveWithin(ctx, node, `${info.def.key}#count`, t);
      if (count.value === undefined || typeof count.value !== 'number') return { status: count.status === 'ok' ? 'unavailable' : count.status };
      if (info.index >= count.value) return { status: 'unavailable' };
    }
    // Owned values and members are structural: the Id by formula, always ok (spec 2.4).
    if (info.isNode) return { value: this.k.address(node, path), status: 'ok' };

    const temporal = !info.isCount && info.index === undefined && info.def.temporal ? info.def.temporal.window : undefined;
    const window = temporal !== undefined ? (explicitK ?? Math.floor(t / temporal)) : 0;
    const tEff = temporal !== undefined && explicitK !== undefined ? explicitK * temporal : t;
    if (tr) tr.window = window;
    const mode = this.effectiveMode(header, info);
    if (tr) tr.mode = mode;
    switch (mode) {
      case 'derived':
        return this.computeDerived(ctx, header, info, path, tEff, tr);
      case 'mirrored':
        return this.computeMirrored(header, info, path, tEff, tr);
      default:
        return this.computeArbitrated(ctx, header, info, path, mode, window, temporal !== undefined, tEff, tr);
    }
  }

  /** The effective mode of a slot on a node (spec 2.2, 5.1). */
  effectiveMode(header: NodeHeader, info: SlotInfo): EffectiveMode {
    const def = info.def;
    const mirroredNode = header.origin.by === 'mirrored';
    if (info.isCount) {
      if (def.mode === 'assigned') return 'assigned';
      if (def.mode === 'mirrored' && mirroredNode) return 'mirrored';
      return 'sampled';
    }
    if (def.mode === 'mirrored' && mirroredNode) return 'mirrored';
    if (def.derive && (def.mode === 'derived' || def.mode === 'mirrored')) return 'derived';
    if (def.mode === 'derived') return 'derived';
    if (info.vt.t === 'vec' || info.vt.t === 'text') return 'assigned';
    if (def.mode === 'assigned') return 'assigned';
    return 'sampled';
  }

  // ---- reading dependencies ----

  /** Resolve a dependency path ("key", "key#count", "^/key") relative to a node (spec 2.3). */
  private readDep(ctx: OpCtx, node: Id, path: string, t: GameTime): Res {
    let cur = node;
    let rest = path;
    while (rest.startsWith('^/')) {
      const o = this.ownerOf(cur);
      if (o === undefined) {
        this.k.defects.record({ kind: 'no-owner', detail: `"${path}" read from a node without an owner`, node, slot: path });
        return { status: 'unavailable' };
      }
      cur = o;
      rest = rest.slice(2);
    }
    return this.resolveWithin(ctx, cur, rest, t);
  }

  // ---- derived slots ----

  private computeDerived(ctx: OpCtx, header: NodeHeader, info: SlotInfo, path: SlotPath, t: GameTime, tr?: Trace): Res {
    const def = info.def;
    const node = header.id;
    if (!def.derive) {
      this.k.defects.record({ kind: 'no-derive', detail: `derived slot "${path}" has no derive`, node, slot: path });
      return { status: 'unavailable' };
    }
    const inputs: Value[] = [];
    let status: ResolveStatus = 'ok';
    let missing: ResolveStatus | null = null;
    for (const inp of def.derive.inputs) {
      const r = this.readDep(ctx, node, inp, t);
      status = worse(status, r.status);
      if (r.value === undefined) missing = missing === null ? r.status : worse(missing, r.status);
      else inputs.push(r.value);
    }
    if (missing !== null) return { status: worse(status, missing === 'ok' ? 'unavailable' : missing) };
    ctx.allowance.spend(1);
    const fn = this.schema.registry.get('derive', def.derive.fn);
    const value = fn(inputs, def.derive.fn.params ?? {});
    // Pins on the derived slot (spec 5.1 step 1, SPEC-NOTES 7).
    const unaryNarrowed = def.derive.preimage !== undefined && def.derive.inputs.length === 1 && !def.derive.inputs[0]!.startsWith('^/');
    if (!unaryNarrowed) {
      for (const p of this.pinsInEffect(header, path, false, 0, t)) {
        const r = this.pinRegion(info.vt, p);
        if (!this.regionHasValue(r, value)) {
          status = worse(status, 'contradiction');
          if (tr) tr.notes.push(`pin ${p.id} is violated by the derived value`);
        }
      }
    }
    if (tr) tr.notes.push(`derived with ${def.derive.fn.name}@${def.derive.fn.version}`);
    return { value, status };
  }

  private regionHasValue(r: Region, v: Value): boolean {
    switch (r.r) {
      case 'all':
        return true;
      case 'set':
        return r.values.includes(v as string);
      case 'ivl':
        return typeof v === 'number' && r.ivls.some(([lo, hi]) => v >= lo && v <= hi);
      case 'box':
        return Array.isArray(v) && r.boxes.some((bx) => bx.every(([lo, hi], d) => v[d]! >= lo && v[d]! <= hi));
    }
  }

  // ---- mirrored slots of mirrored nodes ----

  private computeMirrored(header: NodeHeader, info: SlotInfo, path: SlotPath, t: GameTime, tr?: Trace): Res {
    const pins = this.k.store.livePinsOn(header.id, path);
    const covering = (p: Pin) => p.valid.from <= t && (p.valid.to === undefined || t < p.valid.to);
    const readings = pins.filter((p) => p.reason === 'game' && covering(p) && p.value !== undefined).sort((a, b) => cmpId(a.id, b.id));
    const reading = readings[readings.length - 1];
    if (!reading) {
      if (tr) tr.notes.push('no reading in effect');
      return { status: 'unavailable' };
    }
    if (tr) tr.reading = reading.id;
    let status: ResolveStatus = 'ok';
    for (const p of pins) {
      if (PIN_PRECEDENCE[p.reason] < CONTRADICTION_PRECEDENCE || !covering(p)) continue;
      const r = this.pinRegion(info.vt, p);
      if (!this.regionHasValue(r, reading.value!)) status = 'contradiction';
    }
    return { value: reading.value!, status };
  }

  // ---- constraints ----

  /** The pins that apply to (node, slot, window) at time t, under the interval rules of spec 6.2, 6.3 and SPEC-NOTES 5. */
  private pinsInEffect(header: NodeHeader, path: SlotPath, temporal: boolean, window: number, _t: GameTime): Pin[] {
    const key = temporal ? `${path}@w${window}` : path;
    // Enduring slots: every live pin applies at every t. Simulated temporal windows: the pins naming the window.
    return this.k.store.livePinsOn(header.id, key);
  }

  pinRegion(vt: ValueType, p: Pin): Region {
    if (p.region) return normalizeRegion(vt, p.region);
    return pointRegion(vt, p.value!);
  }

  private normalizeSafe(vt: ValueType, r: Region): Region {
    if (r.r === 'all' || r.r === 'set') return r;
    if (vt.t === 'enum' || vt.t === 'enum-by' || vt.t === 'text' || vt.t === 'ref' || vt.t === 'node') return r;
    return normalizeRegion(vt, r);
  }

  /** Constraints that narrow `info`'s input through the preimage of a unary view over it (spec 6.4). */
  private viewConstraints(header: NodeHeader, info: SlotInfo, path: SlotPath): Constraint[] {
    const out: Constraint[] = [];
    const rk = this.schema.kind(header.kind);
    for (const d of rk.slots) {
      if (!d.derive?.preimage || d.derive.inputs.length !== 1 || d.derive.inputs[0] !== path) continue;
      const dInfo = this.schema.slotInfo(header.kind, d.key);
      if (!dInfo) continue;
      const own: Constraint[] = [];
      for (const p of this.pinsInEffect(header, d.key, false, 0, 0)) {
        own.push({
          id: p.id, source: 'pin', precedence: PIN_PRECEDENCE[p.reason], region: this.pinRegion(dInfo.vt, p),
          negate: false, active: false, label: p.reason,
        });
      }
      own.push(...this.viewConstraints(header, dInfo, d.key));
      const fn = this.schema.registry.get('preimage', d.derive.preimage);
      for (const c of own) {
        if (c.negate) continue;
        const back = fn(c.region, [], d.derive.preimage.params ?? {});
        out.push({
          id: c.id, source: 'preimage', precedence: c.precedence, region: this.normalizeSafe(info.vt, back),
          negate: false, active: false, label: `${c.label} via ${d.key}`,
        });
      }
    }
    return out;
  }

  private applicableTo(c: Contribution, t: GameTime): boolean {
    return (c.valid.from === undefined || c.valid.from <= t) && (c.valid.to === undefined || t < c.valid.to);
  }

  private collectConstraints(
    ctx: OpCtx, header: NodeHeader, info: SlotInfo, path: SlotPath, temporal: boolean, window: number, t: GameTime,
    weights: Contribution[],
  ): Constraint[] {
    const node = header.id;
    const out: Constraint[] = [];
    // Pins.
    for (const p of this.pinsInEffect(header, path, temporal, window, t)) {
      out.push({
        id: p.id, source: 'pin', precedence: PIN_PRECEDENCE[p.reason], region: this.pinRegion(info.vt, p),
        negate: false, active: false, label: p.reason,
      });
    }
    // Contributions.
    const env = this.makeEnv(ctx, t, { node, order: info.order });
    let applicable = 0;
    for (const c of this.k.store.contributionCandidates(node)) {
      if (!this.applicableTo(c, t)) continue;
      let matches: boolean;
      try {
        matches = selectorMatches(env, c.target, node, path);
      } catch (e) {
        if (e instanceof ReadViolation) {
          this.k.defects.record({ kind: 'read-violation', detail: `contribution ${c.id}: ${e.why}`, node, slot: path });
          continue;
        }
        throw e;
      }
      if (!matches) continue;
      if (++applicable > this.k.config.maxApplicableContributions) {
        throw new LimitExceeded(`more than ${this.k.config.maxApplicableContributions} applicable contributions`);
      }
      ctx.allowance.spend(1);
      if (!(c.strength > 0) || !Number.isFinite(c.strength)) {
        this.k.defects.record({ kind: 'bad-strength', detail: `contribution ${c.id}`, node, slot: path });
        continue;
      }
      if (c.mode !== 'constrain') {
        weights.push(c);
        continue;
      }
      try {
        const r = this.constrainForm(ctx, node, info, path, c.form, t, env);
        if (r) {
          out.push({
            id: c.id, source: 'contribution', precedence: layerPrecedence(c.source.layer), region: r.region,
            negate: r.negate, active: false, label: c.source.layer,
          });
        }
      } catch (e) {
        if (e instanceof ReadViolation) {
          this.k.defects.record({ kind: 'read-violation', detail: `contribution ${c.id}: ${e.why}`, node, slot: path });
          continue;
        }
        throw e;
      }
    }
    // Derived views over this slot (spec 6.4).
    if (!info.isCount && info.index === undefined) out.push(...this.viewConstraints(header, info, path));
    // Structural constraints (spec 6.5).
    out.push(...this.structuralConstraints(header, info, path));
    // Summary item descriptors (spec 9.3), at the level of a simulation constraint.
    const desc = this.k.summaries.itemConstraint(ctx, header, path, t);
    if (desc !== undefined) {
      out.push({
        id: H(hs('descriptor'), hid(node), hs(path)), source: 'descriptor', precedence: PRECEDENCE.simulation,
        region: pointRegion(info.vt, desc), negate: false, active: false, label: 'summary item',
      });
    }
    out.sort((a, b) => b.precedence - a.precedence || cmpId(a.id, b.id));
    return out;
  }

  private structuralConstraints(header: NodeHeader, info: SlotInfo, path: SlotPath): Constraint[] {
    const out: Constraint[] = [];
    const vt = info.vt;
    if (vt.t !== 'int') return out;
    let lo: number | undefined;
    if (info.isCount) {
      const max = this.k.retention.maxRetainedMember(header.id, info.def.key);
      if (max !== undefined) lo = max + 1;
    } else if (path === 'count' && this.schema.hasFacet(header.kind, 'summary')) {
      const canon = this.k.summaries.canonOf(header.id);
      if (canon.length > 0) lo = Math.max(...canon) + 1;
    }
    if (lo !== undefined) {
      out.push({
        id: H(hs('structural'), hid(header.id), hs(path)), source: 'structural', precedence: PRECEDENCE.structural,
        region: { r: 'ivl', ivls: [[lo, vt.max]] }, negate: false, active: false, label: 'structural',
      });
    }
    return out;
  }

  /** A constrain-mode form as a region, or null when it adds nothing (spec 4.3). */
  private constrainForm(
    ctx: OpCtx, node: Id, info: SlotInfo, path: SlotPath, form: Form, t: GameTime, env: PredicateEnv,
  ): { region: Region; negate: boolean } | null {
    const vt = info.vt;
    switch (form.f) {
      case 'const': {
        return { region: pointRegion(vt, form.value), negate: false };
      }
      case 'set':
        return { region: this.normalizeSafe(vt, form.region), negate: !form.allow };
      case 'rule':
        if (!evalAll(env, form.when, node)) return null;
        return this.constrainForm(ctx, node, info, path, form.then, t, env);
      case 'derive': {
        const v = this.deriveFormValue(ctx, node, info, form, t, env);
        return v === undefined ? null : { region: pointRegion(vt, v), negate: false };
      }
      default:
        this.k.defects.record({ kind: 'form-mode', detail: `a ${form.f} form cannot constrain`, node, slot: path });
        return null;
    }
  }

  private deriveFormValue(ctx: OpCtx, node: Id, _info: SlotInfo, form: Extract<Form, { f: 'derive' }>, t: GameTime, env: PredicateEnv): Value | undefined {
    const inputs: Value[] = [];
    for (const p of form.inputs) {
      this.assertReadable(env, node, p);
      const r = this.readDep(ctx, node, p, t);
      failIfFailed(r.status, `${p} of ${node}`);
      if (r.value === undefined) return undefined;
      inputs.push(r.value);
    }
    ctx.allowance.spend(1);
    return this.schema.registry.get('derive', form.fn)(inputs, form.fn.params ?? {});
  }

  private assertReadable(env: PredicateEnv, node: Id, path: string): void {
    // Reuse the predicate environment's restriction check by following a dummy "has value" read.
    const segs = path.split('/');
    let upto = 0;
    while (segs[upto] === '^') upto++;
    const rest = segs.slice(upto);
    if (rest.length !== 1) throw new ReadViolation(`a resolution may read one slot, not "${path}"`);
    let cur = node;
    for (let n = 0; n < upto; n++) {
      const o = env.ownerOf(cur);
      if (o === undefined) throw new ReadViolation('the node has no owner');
      cur = o;
    }
    const kind = env.kindOf(cur);
    const info = kind ? env.schema.slotInfo(kind, rest[0]!) : null;
    if (!info) throw new ReadViolation(`unknown slot "${rest[0]}"`);
    if (info.index !== undefined) throw new ReadViolation(`"${rest[0]}" addresses a member`);
    if (!info.isCount && (info.vt.t === 'ref' || info.vt.t === 'node')) throw new ReadViolation(`"${rest[0]}" is a ${info.vt.t} slot`);
    if (upto === 0 && env.restrict && !(info.order < env.restrict.order)) throw new ReadViolation(`"${rest[0]}" is not an earlier slot`);
  }

  // ---- arbitration, weights and the draw ----

  private computeArbitrated(
    ctx: OpCtx, header: NodeHeader, info: SlotInfo, path: SlotPath, mode: 'sampled' | 'assigned', window: number,
    temporal: boolean, t: GameTime, tr?: Trace,
  ): Res {
    const node = header.id;
    const vt = info.vt;
    const weightContribs: Contribution[] = [];
    // The domain.
    let domain: Region;
    let inheritedStatus: ResolveStatus = 'ok';
    if (vt.t === 'enum-by') {
      const by = this.readDep(ctx, node, vt.by, t);
      if (by.value === undefined) return { status: by.status === 'ok' ? 'unavailable' : by.status };
      const list = vt.lists[valueKey(by.value)];
      if (!list) {
        this.k.defects.record({ kind: 'no-list', detail: `enum-by has no list for "${valueKey(by.value)}"`, node, slot: path });
        return { status: 'unavailable' };
      }
      domain = domainRegion(vt, list);
      if (by.status === 'failed' || by.status === 'cycle' || by.status === 'unavailable') inheritedStatus = by.status;
    } else domain = domainRegion(vt);
    if (tr) tr.domain = domain;

    const constraints = this.collectConstraints(ctx, header, info, path, temporal, window, t, weightContribs);
    // Arbitration (spec 5.2).
    let F = domain;
    let contradiction = false;
    for (const c of constraints) {
      let next: Region | null = null;
      try {
        if (c.negate) {
          const base = F.r === 'all' && vt.t === 'ref' ? this.candidateRegion(ctx, vt, node, t) : F;
          next = base.r === 'all' ? null : subtract(base, c.region, vt.t === 'int' || vt.t === 'real' || vt.t === 'cyclic' ? gridStep(vt) : 1);
        } else next = intersect(F, c.region);
      } catch (e) {
        if (e instanceof LimitExceeded) throw e;
        this.k.defects.record({ kind: 'constraint-type', detail: `constraint ${c.id}: ${(e as Error).message}`, node, slot: path });
        next = null;
      }
      if (next !== null && !isEmpty(next)) {
        F = this.normalizeSafe(vt, next);
        c.active = true;
      } else {
        c.active = false;
        if (c.precedence >= CONTRADICTION_PRECEDENCE) contradiction = true;
      }
    }
    if (tr) {
      tr.constraints = constraints;
      tr.feasible = F;
    }
    const status: ResolveStatus = contradiction ? 'contradiction' : 'ok';
    if (inheritedStatus !== 'ok') return { status: inheritedStatus };

    if (mode === 'assigned') {
      const size = regionSize(vt, F);
      if (tr) tr.feasibleSize = size === Infinity ? -1 : size;
      if (size === 1) {
        const v = enumerateRegion(vt, F)[0]!;
        return { value: v, status };
      }
      return { status: 'unavailable' };
    }

    // Sampled: the draw. A ref slot whose constraints leave it unbounded draws among the candidates.
    if (F.r === 'all') {
      if (vt.t === 'ref') {
        F = this.candidateRegion(ctx, vt, node, t);
        if (isEmpty(F)) return { status: 'unavailable' };
      } else {
        this.k.defects.record({ kind: 'unbounded', detail: `a ${vt.t} slot cannot be drawn`, node, slot: path });
        return { status: 'failed' };
      }
    }
    const size = regionSize(vt, F);
    if (tr) tr.feasibleSize = size;
    if (size > this.k.config.nEnum) {
      this.k.defects.record({ kind: 'domain-too-large', detail: `${size} feasible values exceed N_enum`, node, slot: path });
      return { status: 'failed' };
    }
    ctx.allowance.spend(size);
    const values = enumerateRegion(vt, F);
    if (values.length === 0) return { status: 'unavailable' };
    if (values.length === 1) {
      if (tr) {
        tr.scores = [{ value: values[0]!, score: 0, noise: 0, total: 0 }];
        tr.winner = tr.scores[0]!;
      }
      return { value: values[0]!, status };
    }
    const drawn = this.draw(ctx, header, info, path, vt, window, t, values, weightContribs, tr);
    if (drawn === null) return { status: 'failed' };
    return { value: drawn, status };
  }

  /** The candidate set of a ref slot as a set region (spec 2.4). */
  private candidateRegion(ctx: OpCtx, vt: ValueType, node: Id, t: GameTime): Region {
    if (vt.t !== 'ref') return ALL;
    const ids = this.k.queries.candidateSet(ctx, vt.candidates, t);
    return { r: 'set', values: ids };
  }

  private draw(
    ctx: OpCtx, header: NodeHeader, info: SlotInfo, path: SlotPath, vt: ValueType, window: number, t: GameTime,
    values: Value[], weights: Contribution[], tr?: Trace,
  ): Value | null {
    const node = header.id;
    const def = info.def;
    const eps = this.k.config.epsilon;
    const env = this.makeEnv(ctx, t, { node, order: info.order });
    // The prior.
    let prior: number[];
    if (def.conditioned && !info.isCount) {
      const ins: Value[] = [];
      for (const p of def.conditioned.inputs) {
        const r = this.readDep(ctx, node, p, t);
        if (r.value === undefined) return null;
        ins.push(r.value);
      }
      prior = this.schema.registry.get('conditioned', def.conditioned.fn)(ins, values, def.conditioned.fn.params ?? {});
    } else {
      prior = this.schema.registry.get('prior', info.dim.prior)(info.dim, values, info.dim.prior.params ?? {});
    }
    const sortedByPrec = [...weights].sort((a, b) => layerPrecedence(b.source.layer) - layerPrecedence(a.source.layer) || cmpId(a.id, b.id));
    let priorId: Id | 'prior' = 'prior';
    let priorKind: TraceFactor['kind'] = 'prior';
    let priorStrength = 1;
    for (const c of sortedByPrec) {
      if (c.mode !== 'replace-prior') continue;
      const f = this.weightVector(ctx, node, info, path, c.form, values, vt, t, env, eps);
      if (f) {
        prior = f;
        priorId = c.id;
        priorKind = 'replaced-prior';
        priorStrength = 1;
        break;
      }
    }
    if (!this.validWeights(prior, values.length)) {
      this.k.defects.record({ kind: 'bad-weights', detail: 'the prior is not a positive finite vector over F', node, slot: path });
      return null;
    }
    // Weight contributions in Id order.
    const factors: Array<{ id: Id; strength: number; vec: number[] }> = [];
    for (const c of [...weights].sort((a, b) => cmpId(a.id, b.id))) {
      if (c.mode !== 'weight') continue;
      const vec = this.weightVector(ctx, node, info, path, c.form, values, vt, t, env, eps);
      if (vec) factors.push({ id: c.id, strength: c.strength, vec });
    }
    const norm = (vec: number[]): number[] => {
      let max = 0;
      for (const x of vec) if (x > max) max = x;
      return vec.map((x) => x / max);
    };
    const prior0 = norm(prior);
    const normFactors = factors.map((f) => ({ ...f, hat: norm(f.vec) }));
    // Scores and noise.
    const scores: number[] = [];
    const noise: number[] = [];
    const totals: number[] = [];
    const seed = this.k.worldSeed;
    for (let n = 0; n < values.length; n++) {
      let score = priorStrength * ln(prior0[n]!);
      for (const f of normFactors) score += f.strength * ln(f.hat[n]!);
      const u = rand(hs('g'), hid(seed), hid(node), hs(path), hi(window), hval(encodeValue(vt, values[n]!)));
      const g = -ln(-ln(u));
      scores.push(score);
      noise.push(g);
      totals.push(score + g);
    }
    // argmax, exact ties to the lower tie hash.
    const tieOf = (n: number): Id => H(hs('tie'), hid(seed), hid(node), hs(path), hi(window), hval(encodeValue(vt, values[n]!)));
    let best = 0;
    let second = -1;
    const beats = (a: number, b: number): boolean => totals[a]! > totals[b]! || (totals[a]! === totals[b]! && tieOf(a) < tieOf(b));
    for (let n = 1; n < values.length; n++) {
      if (Number.isNaN(totals[n]!)) {
        this.k.defects.record({ kind: 'nan', detail: 'a score is not a number', node, slot: path });
        return null;
      }
      if (beats(n, best)) {
        second = best;
        best = n;
      } else if (second < 0 || beats(n, second)) second = n;
    }
    if (tr) {
      tr.scores = values.map((v, n) => ({ value: v, score: scores[n]!, noise: noise[n]!, total: totals[n]! }));
      tr.winner = tr.scores[best]!;
      if (second >= 0) tr.runnerUp = tr.scores[second]!;
      const mk = (id: Id | 'prior', strength: number, kind: TraceFactor['kind'], hat: number[]): TraceFactor => {
        const f: TraceFactor = { id, strength, kind, atWinner: hat[best]! };
        if (second >= 0) f.atRunnerUp = hat[second]!;
        return f;
      };
      tr.factors = [mk(priorId, priorStrength, priorKind, prior0), ...normFactors.map((f) => mk(f.id, f.strength, 'weight', f.hat))];
    }
    return values[best]!;
  }

  private validWeights(w: number[], n: number): boolean {
    return w.length === n && w.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0);
  }

  /** A weight-mode form as strictly positive factors over `values`, or null if it does not apply. */
  private weightVector(
    ctx: OpCtx, node: Id, info: SlotInfo, path: SlotPath, form: Form, values: Value[], vt: ValueType, t: GameTime,
    env: PredicateEnv, eps: number,
  ): number[] | null {
    const bad = (why: string): null => {
      this.k.defects.record({ kind: 'bad-form', detail: why, node, slot: path });
      return null;
    };
    try {
      switch (form.f) {
        case 'const':
          return values.map((v) => (valuesEqual(v, form.value) ? 1 : eps));
        case 'table': {
          const out = values.map((v) => form.weights[valueKey(v)] ?? 1);
          return this.validWeights(out, values.length) ? out : bad('a table weight is not strictly positive');
        }
        case 'set':
          return bad('a set cannot weigh; use a table');
        case 'rule':
          if (!evalAll(env, form.when, node)) return null;
          return this.weightVector(ctx, node, info, path, form.then, values, vt, t, env, eps);
        case 'derive': {
          const v = this.deriveFormValue(ctx, node, info, form, t, env);
          return v === undefined ? null : values.map((x) => (valuesEqual(x, v) ? 1 : eps));
        }
        case 'field': {
          if (form.points.length > this.k.config.maxFieldPoints) {
            throw new LimitExceeded(`a field with ${form.points.length} points (limit ${this.k.config.maxFieldPoints})`);
          }
          this.assertReadable(env, node, form.base);
          const base = this.readDep(ctx, node, form.base, t);
          failIfFailed(base.status, `${form.base} of ${node}`);
          if (!Array.isArray(base.value)) return null;
          let acc = form.combine === 'sum' ? 0 : -Infinity;
          for (const p of form.points) {
            ctx.allowance.spend(1);
            if (!(p.radius > 0)) return bad('a field radius must be positive');
            let d2 = 0;
            for (let d = 0; d < base.value.length; d++) {
              const diff = base.value[d]! - (p.at[d] ?? 0);
              d2 += diff * diff;
            }
            const dist = Math.sqrt(d2);
            let shape = 0;
            if (dist < p.radius) {
              const x = dist / p.radius;
              shape = p.falloff === 'linear' ? 1 - x : p.falloff === 'smoothstep' ? 1 - 3 * x * x + 2 * x * x * x : (1 - x * x) * (1 - x * x);
            }
            const contribution = p.value * shape;
            acc = form.combine === 'sum' ? acc + contribution : Math.max(acc, contribution);
          }
          if (acc === -Infinity) acc = 0;
          const out = this.schema.registry.get('fieldmap', form.map)(acc, values, form.map.params ?? {});
          return this.validWeights(out, values.length) ? out : bad('a field map did not give strictly positive weights');
        }
      }
    } catch (e) {
      if (e instanceof ReadViolation) {
        this.k.defects.record({ kind: 'read-violation', detail: e.why, node, slot: path });
        return null;
      }
      throw e;
    }
  }
}
