// Queries (spec 8): atomic, bounded and sound against one revision.
//
// The first implementation answers `maybe` for every compound region (spec 0.2, 8.2): traversal is
// complete, ordered by an upper bound on the preference score and then by Id, and candidates are
// checked exactly. A query that hits a hard limit returns `failed`, never a partial result.

import type { Kernel } from './kernel.ts';
import { type PredicateEnv, evalAll, evalPredicate, inSpatialRegion } from './predicate.ts';
import { type OpCtx, newOpCtx } from './resolve.ts';
import type { CandidateQuery } from './schema-types.ts';
import type { GameTime, Id, Query, QueryItem, QueryOutcome, QueryScope } from './types.ts';
import { LimitExceeded } from './work.ts';

interface Entry {
  id: Id;
  bound: number;
}

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Queries {
  private candCache = new Map<string, { ids: Id[]; cost: number }>();
  private candRevision = -1;

  constructor(private readonly k: Kernel) {}

  /** An outer query. Hard limits give `failed` and record a defect. */
  run(q: Query): QueryOutcome {
    const ctx = newOpCtx(this.k.config.allowance);
    try {
      return { status: 'ok', items: this.execute(ctx, q) };
    } catch (e) {
      if (e instanceof LimitExceeded) {
        this.k.defects.record({ kind: 'limit', detail: `query: ${e.message}` });
        return { status: 'failed', reason: e.message };
      }
      throw e;
    }
  }

  /** The candidate set of a ref (spec 2.4): the complete result, cut to the `max` lowest Ids. Throws LimitExceeded. */
  candidateSet(ctx: OpCtx, cq: CandidateQuery, t: GameTime): Id[] {
    if (this.candRevision !== this.k.revision) {
      this.candCache.clear();
      this.candRevision = this.k.revision;
    }
    const key = `${JSON.stringify(cq)}|${t}`;
    const hit = this.candCache.get(key);
    if (hit) {
      ctx.allowance.spend(hit.cost);
      return hit.ids;
    }
    const before = ctx.allowance.used;
    const items = this.execute(ctx, { find: cq.find, scope: cq.scope, at: t, must: cq.must, limit: 'all' });
    const ids = items.map((i) => i.id).sort(cmpId).slice(0, cq.max);
    this.candCache.set(key, { ids, cost: ctx.allowance.used - before });
    return ids;
  }

  private roots(scope: QueryScope): Id[] {
    if ('under' in scope) return [this.k.expandId(scope.under)];
    if ('roots' in scope) return scope.roots.map((r) => this.k.expandId(r));
    return [];
  }

  private children(env: PredicateEnv, node: Id): Id[] {
    const out = new Set<Id>();
    for (const e of this.k.store.edgesTo(node)) {
      if (e.type === 'core:located-in' && e.valid.from <= env.t && (e.valid.to === undefined || env.t < e.valid.to)) out.add(e.from);
    }
    for (const o of this.k.store.ownedOf(node)) out.add(o);
    return [...out].sort(cmpId);
  }

  private execute(ctx: OpCtx, q: Query): QueryItem[] {
    const cfg = this.k.config;
    const env = this.k.resolver.makeEnv(ctx, q.at);
    const prefer = q.prefer ?? [];
    const ub = prefer.reduce((a, p) => a + (p.weight > 0 ? p.weight : 0), 0);
    const findKinds = new Set(this.k.schema.kindsOf(q.find));
    const confirmed = new Map<Id, number>();
    const checked = new Set<Id>();
    let steps = 0;
    let exact = 0;

    const check = (id: Id): void => {
      if (checked.has(id)) return;
      checked.add(id);
      if (++exact > cfg.maxExactChecks) throw new LimitExceeded(`more than ${cfg.maxExactChecks} exact checks in a query`);
      ctx.allowance.spend(1);
      if (!evalAll(env, q.must, id)) return;
      let score = 0;
      for (const p of prefer) if (evalPredicate(env, p.p, id)) score += p.weight;
      confirmed.set(id, score);
    };
    const isCandidate = (id: Id): boolean => {
      const h = this.k.store.header(id);
      return h !== undefined && findKinds.has(h.kind);
    };

    const scope = q.scope;
    // The frontier: sorted by upper bound descending, then Id.
    const frontier: Entry[] = [];
    const seen = new Set<Id>();
    const push = (id: Id): void => {
      if (seen.has(id)) return;
      seen.add(id);
      let lo = 0;
      let hi = frontier.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const m = frontier[mid]!;
        if (m.bound > ub || (m.bound === ub && cmpId(m.id, id) < 0)) lo = mid + 1;
        else hi = mid;
      }
      frontier.splice(lo, 0, { id, bound: ub });
    };

    const descend = !('nodes' in scope) && !('region' in scope);
    if ('nodes' in scope) {
      for (const n of scope.nodes) push(this.k.expandId(n));
    } else if ('region' in scope) {
      // Region scopes scan every known node of the kind and test its position.
      for (const kind of findKinds) {
        for (const id of this.k.store.idsOfKind(kind)) {
          ctx.allowance.spend(1);
          const info = this.k.schema.slotInfo(kind, 'position');
          if (!info) continue;
          const pos = env.read(id, 'position');
          if (pos.value !== undefined && inSpatialRegion(pos.value, scope.region)) push(id);
        }
      }
    } else {
      for (const r of this.roots(scope)) if (this.k.store.header(r)) push(r);
    }

    // Summaries within scope: item descriptors enumerated as candidates under the same allowance (spec 8.3 step 9).
    const itemCandidates: Id[] = [];
    if (this.k.schema.isKind('core:event', q.find) || findKinds.has('core:event')) {
      itemCandidates.push(...this.k.summaries.itemCandidates(ctx, scope, q.at, this.roots(scope)));
    }
    for (const id of itemCandidates) {
      if (findKinds.has(this.k.store.header(id)?.kind ?? '')) check(id);
    }

    const nth = (n: number): number | undefined => {
      const scores = [...confirmed.entries()].sort((a, b) => b[1] - a[1] || cmpId(a[0], b[0])).map((e) => e[1]);
      return scores[n - 1];
    };

    while (frontier.length > 0) {
      if (q.limit !== 'all' && confirmed.size >= q.limit) {
        const nthScore = nth(q.limit)!;
        if (frontier.every((e) => e.bound < nthScore)) break;
      }
      const entry = frontier.shift()!;
      if (++steps > cfg.maxFrontierSteps) throw new LimitExceeded(`more than ${cfg.maxFrontierSteps} frontier steps in a query`);
      ctx.allowance.spend(1);
      if (isCandidate(entry.id)) check(entry.id);
      if (descend) for (const c of this.children(env, entry.id)) push(c);
    }

    const items = [...confirmed.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || cmpId(a.id, b.id));
    return q.limit === 'all' ? items : items.slice(0, q.limit);
  }
}
