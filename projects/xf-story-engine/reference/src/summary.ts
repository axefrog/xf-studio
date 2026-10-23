// Summaries and their refinement (spec 9.3).
//
// A summary says "n events of one kind happened in a scope over a span". Item i is derivable from the
// summary alone: its Id, time and place are pure functions of (summary, i), so overlapping queries see
// the same items and nothing is counted twice. Materialising an item is silent cache population: it
// adds a header and bumps no revision. Only canon items persist (their fields become pins).

import { ln } from './fdlibm-log.ts';
import { H, i as hi, id as hid, mintedId, rand, s as hs } from './id.ts';
import type { Kernel } from './kernel.ts';
import { inSpatialRegion, isUnder } from './predicate.ts';
import { type OpCtx, newOpCtx } from './resolve.ts';
import type { GameTime, Id, NodeHeader, PinReason, QueryScope, SlotPath, Value } from './types.ts';
import { Budget, LimitExceeded, Worklist, failIfFailed } from './work.ts';

export interface SummarySpec {
  creator: Id;
  cause: Id;
  name: string;
  kind: string;
  from: GameTime;
  length: number;
  scope: Id;
  count?: number;
}

export interface SummaryRecord {
  summary: Id;
  canon: number[];
}

export interface ItemDescriptor {
  id: Id;
  index: number;
  time: GameTime;
  place?: Id;
}

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Summaries {
  private canon = new Map<Id, Set<number>>();
  private descCache = new Map<string, { d: ItemDescriptor | null; cost: number; height: number }>();
  private descRevision = -1;
  private descNow = Number.NaN;
  private warmList = new Worklist<{ summary: Id; next: number }>();

  constructor(private readonly k: Kernel) {}

  invalidate(): void {
    this.descCache.clear();
    this.descRevision = -1;
  }

  /** Mint a summary node and pin its fields `committed` by the cause (spec 9.3, SPEC-NOTES 31). */
  mintSummary(spec: SummarySpec): Id {
    const k = this.k;
    const nid = k.mint(spec.creator, spec.cause, spec.name, 'core:summary');
    const pin = (slot: SlotPath, value: Value): void => {
      k.pin({ node: nid, slot, value, reason: 'committed', cause: spec.cause, silent: true });
    };
    pin('kind', spec.kind);
    pin('from', spec.from);
    pin('length', spec.length);
    pin('scope', spec.scope);
    if (spec.count !== undefined) pin('count', spec.count);
    return nid;
  }

  // ---- canon ----

  canonOf(summary: Id): number[] {
    return [...(this.canon.get(summary) ?? [])].sort((a, b) => a - b);
  }

  summaries(): Id[] {
    const out: Id[] = [];
    for (const kindId of this.k.schema.kindIds()) {
      if (this.k.schema.hasFacet(kindId, 'summary')) out.push(...this.k.store.idsOfKind(kindId));
    }
    return out.sort(cmpId);
  }

  records(): SummaryRecord[] {
    return [...this.canon.entries()].sort((a, b) => cmpId(a[0], b[0])).map(([summary, set]) => ({ summary, canon: [...set].sort((a, b) => a - b) }));
  }

  setRecord(rec: SummaryRecord): void {
    this.canon.set(rec.summary, new Set(rec.canon));
  }

  /** The Id of item i of a summary. */
  itemId(summary: Id, i: number): Id {
    return mintedId(summary, summary, `item:${i}`);
  }

  /** Header the item (silent cache population: no revision bump, no change). */
  materialise(summary: Id, i: number): Id {
    return this.k.mintSilent(summary, summary, `item:${i}`, 'core:event');
  }

  /** Make item i canon: materialise it and pin its descriptor fields. Raises the structural floor of `count`. */
  makeItemCanon(summary: Id, i: number, reason: 'observed' | 'committed', cause: Id): Id {
    const k = this.k;
    k.assertWritable();
    const count = k.resolve(summary, 'count');
    if (typeof count.value !== 'number' || i < 0 || i >= count.value) throw new Error(`item ${i} does not exist`);
    const nid = this.materialise(summary, i);
    for (const slot of ['time', 'place', 'kind'] as const) {
      const r = k.resolve(nid, slot);
      if (r.value === undefined) continue;
      const spec: Parameters<Kernel['pin']>[0] = { node: nid, slot, value: r.value, reason: reason as PinReason, cause, silent: true };
      if (reason === 'observed') spec.evidence = nid;
      k.pin(spec);
    }
    const set = this.canon.get(summary) ?? new Set<number>();
    set.add(i);
    this.canon.set(summary, set);
    k.bump();
    return nid;
  }

  canonItemIds(): Id[] {
    const out: Id[] = [];
    for (const [s, set] of this.canon) for (const i of set) out.push(this.itemId(s, i));
    return out.sort(cmpId);
  }

  // ---- descriptors ----

  private itemOf(header: NodeHeader): { summary: Id; index: number } | null {
    const o = header.origin;
    if (o.by !== 'minted' || o.creator !== o.cause) return null;
    const m = /^item:(\d+)$/.exec(o.name);
    if (!m) return null;
    const sh = this.k.store.header(o.creator);
    if (!sh || !this.k.schema.hasFacet(sh.kind, 'summary')) return null;
    return { summary: o.creator, index: Number(m[1]) };
  }

  /** The descriptor of item i: its Id, time and place (spec 9.3). Undefined if the summary's fields are not all known. */
  descriptor(ctx: OpCtx, summary: Id, index: number, t: GameTime): ItemDescriptor | undefined {
    if (this.descRevision !== this.k.revision || this.descNow !== this.k.now) {
      this.descCache.clear();
      this.descRevision = this.k.revision;
      this.descNow = this.k.now;
    }
    const key = `${summary}|${index}|${t}`;
    const hit = this.descCache.get(key);
    if (hit !== undefined) {
      // A replay charges the recorded cost and counts the recorded depth (SPEC-NOTES 37).
      if (ctx.depth + hit.height > this.k.config.maxDepth) throw new LimitExceeded(`dependency depth ${this.k.config.maxDepth}`);
      ctx.allowance.spend(hit.cost);
      if (ctx.depth + hit.height > ctx.peak) ctx.peak = ctx.depth + hit.height;
      return hit.d ?? undefined;
    }
    const before = ctx.allowance.used;
    const savedPeak = ctx.peak;
    ctx.peak = ctx.depth;
    const finish = (d: ItemDescriptor | null): void => {
      const height = ctx.peak - ctx.depth;
      ctx.peak = Math.max(savedPeak, ctx.peak);
      this.descCache.set(key, { d, cost: ctx.allowance.used - before, height });
    };
    const rs = this.k.resolver;
    const read = (slot: string): Value | undefined => {
      const r = rs.resolveWithin(ctx, summary, slot, t);
      failIfFailed(r.status, `${slot} of ${summary}`);
      return r.value;
    };
    const from = read('from');
    const length = read('length');
    const scope = read('scope');
    if (typeof from !== 'number' || typeof length !== 'number' || typeof scope !== 'string') {
      finish(null);
      return undefined;
    }
    const time = from + Math.floor(rand(hs('item-t'), hid(summary), hi(index)) * length);
    const d: ItemDescriptor = { id: this.itemId(summary, index), index, time };
    // Strictly under the scope: the scope itself is excluded before the cut to the lowest Ids (SPEC-NOTES 31).
    const candidates = this.k.schema.hasKind('core:place')
      ? this.k.queries.candidateSet(ctx, { find: 'core:place', scope: { under: scope }, must: [{ path: '@self', op: 'not-in', arg: scope }], max: this.k.config.summaryPlaceMax }, t)
      : [];
    if (candidates.length > 0) {
      ctx.allowance.spend(candidates.length);
      let best = -1;
      let bestG = -Infinity;
      let bestTie = '';
      candidates.forEach((v, n) => {
        const g = -ln(-ln(rand(hs('item-p'), hid(summary), hi(index), hid(v))));
        const tie = H(hs('tie'), hs('item-p'), hid(summary), hi(index), hid(v));
        if (g > bestG || (g === bestG && tie < bestTie)) {
          best = n;
          bestG = g;
          bestTie = tie;
        }
      });
      d.place = candidates[best]!;
    } else if (this.k.config.itemScopePlace) {
      // A scope with no place strictly under it is itself the place of its items (V4-39).
      d.place = scope;
    }
    finish(d);
    return d;
  }

  /** The descriptor value for an item node's slot, or undefined if the node is not a summary item (spec 9.3). */
  itemConstraint(ctx: OpCtx, header: NodeHeader, path: SlotPath, t: GameTime): Value | undefined {
    if (path !== 'time' && path !== 'place' && path !== 'kind') return undefined;
    const it = this.itemOf(header);
    if (!it) return undefined;
    if (path === 'kind') {
      const r = this.k.resolver.resolveWithin(ctx, it.summary, 'kind', t);
      failIfFailed(r.status, `kind of ${it.summary}`);
      return r.value;
    }
    const d = this.descriptor(ctx, it.summary, it.index, t);
    if (!d) return undefined;
    return path === 'time' ? d.time : d.place;
  }

  // ---- queries (spec 8.3 step 9) ----

  /**
   * The items of every summary overlapping the scope, as materialised item Ids whose place falls inside
   * the scope. The query then checks each exactly. Charged to the query's allowance.
   */
  itemCandidates(ctx: OpCtx, scope: QueryScope, t: GameTime, roots: Id[]): Id[] {
    if ('nodes' in scope) return [];
    const env = this.k.resolver.makeEnv(ctx, t);
    const out: Id[] = [];
    for (const S of this.summaries()) {
      ctx.allowance.spend(1);
      const spr = this.k.resolver.resolveWithin(ctx, S, 'scope', t);
      failIfFailed(spr.status, `scope of ${S}`);
      const sp = spr.value;
      if (typeof sp !== 'string') continue;
      if ('region' in scope) {
        // Cannot judge overlap from the scope place alone; items are tested by their own place below.
      } else if (!roots.some((r) => isUnder(env, sp, r) || isUnder(env, r, sp))) continue;
      const cr = this.k.resolver.resolveWithin(ctx, S, 'count', t);
      failIfFailed(cr.status, `count of ${S}`);
      const count = cr.value;
      if (typeof count !== 'number') continue;
      for (let i = 0; i < count; i++) {
        ctx.allowance.spend(1);
        const d = this.descriptor(ctx, S, i, t);
        if (!d || d.place === undefined) continue;
        const inside = 'region' in scope
          ? (() => {
              const pr = this.k.resolver.resolveWithin(ctx, d.place!, 'position', t);
              failIfFailed(pr.status, `position of ${d.place}`);
              return pr.value !== undefined && inSpatialRegion(pr.value, scope.region);
            })()
          : roots.some((r) => isUnder(env, d.place!, r));
        if (inside) out.push(this.materialise(S, i));
      }
    }
    return out;
  }

  // ---- materialisation worklist (spec 10.7) ----

  /** Queue a summary's items to be materialised in the background. */
  queueMaterialise(summary: Id): void {
    this.warmList.push({ summary, next: 0 });
  }

  get pendingMaterialisation(): number {
    return this.warmList.length;
  }

  /** Run the materialisation worklist: one item per step, in order, resumable. */
  runMaterialisation(budget: Budget): number {
    return this.warmList.run(budget, (item) => {
      const ctx = newOpCtx(this.k.config.allowance);
      let count: Value | undefined;
      try {
        count = this.k.resolver.resolveWithin(ctx, item.summary, 'count', this.k.now).value;
      } catch (e) {
        if (!(e instanceof LimitExceeded)) throw e;
      }
      if (typeof count !== 'number' || item.next >= count) return { cost: 1, done: true };
      this.materialise(item.summary, item.next);
      item.next++;
      return { cost: 1, done: item.next >= count };
    });
  }

  /** A deep copy of the canon sets and the warm list, for a staged batch's discard (spec 14.2a). */
  capture(): unknown {
    return structuredClone({ canon: this.records(), warm: this.warmList.snapshot() });
  }

  restoreFrom(cap: unknown): void {
    const c = structuredClone(cap) as { canon: SummaryRecord[]; warm: Array<{ summary: Id; next: number }> };
    this.canon.clear();
    for (const r of c.canon) this.canon.set(r.summary, new Set(r.canon));
    this.warmList.restore(c.warm);
    this.invalidate();
  }

  clear(): void {
    this.canon.clear();
    this.descCache.clear();
    this.warmList.clear();
  }
}
