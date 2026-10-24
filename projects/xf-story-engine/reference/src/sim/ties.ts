// The tie function (S1 4.6): most ties between ordinary people are never stored. A tie is a symmetric keyed draw on a pair of
// residents of one district, driven by the foci they share (a household, a crew cell, a workplace, a market row) and by geography.
// Triadic closure needs no rule: shared foci give it. The tie function never reads a reputation ledger (S1-I-14).

import { H, id as hid, s as hs } from '../id.ts';
import type { Id } from '../types.ts';
import type { FocusDef } from './data.ts';
import type { IdentityKeys } from './keys.ts';
import type { People, ResidentView } from './people.ts';
import { ROLES } from './profile.ts';
import { recipeClasses } from './fit.ts';
import type { World } from './world.ts';

export type TieKind = 'kin' | 'crew' | 'colleague' | 'neighbour' | 'friend' | 'rival';
export interface TieResult {
  tied: boolean;
  kind: TieKind;
  layer: 1 | 2 | 3;
}

export interface Focus {
  type: FocusDef['type'];
  id: Id;
  def: FocusDef;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const WORK_ROLES: readonly string[] = ROLES.filter((r) => r !== 'student' && r !== 'unemployed' && r !== 'retired');

export class Ties {
  private distCache = new Map<Id, Map<Id, number>>();
  private orderCache = new Map<Id, Id[]>();

  constructor(private readonly w: World, private readonly people: People, private readonly keys: IdentityKeys) {}

  private get cfg() {
    return this.w.data.ties;
  }

  dropCaches(): void {
    this.distCache.clear();
    this.orderCache.clear();
  }

  // ---- the harmonic normaliser ----

  /** The nominal resident count of the district of a cell. */
  populationOf(cell: Id): number {
    const d = this.w.district(this.w.cell(cell).district);
    let n = 0;
    for (const c of d.cellIds) n += Math.round(d.rho * d.entry.total * this.w.cell(c).headShare);
    return n;
  }

  /** `HN = sum over r = 1 ... N of 1/r`, summed in order. `cGeo <= HN` is checked at load. */
  harmonic(n: number): number {
    const hit = this.harm.get(n);
    if (hit !== undefined) return hit;
    let h = 0;
    for (let r = 1; r <= n; r++) h = h + 1 / r;
    this.harm.set(n, h);
    return h;
  }
  private harm = new Map<number, number>();

  pGeoOfRank(cell: Id, rank: number): number {
    return this.cfg.cGeo / (this.harmonic(this.populationOf(cell)) * rank);
  }

  // ---- foci ----

  private classShare(cell: Id, test: (aff: string) => boolean): number {
    const d = this.w.district(this.w.cell(cell).district);
    let q = 0;
    for (const b of d.entry.byAff) if (test(b.aff)) q += b.q;
    return q / d.entry.total;
  }

  /** The foci a resident belongs to, in focus-id order. */
  fociOf(v: ResidentView): Focus[] {
    const out: Focus[] = [];
    const d = this.w.district(this.w.cell(v.cell).district);
    const head = Math.round(d.rho * d.entry.total * this.w.cell(v.cell).headShare);
    for (const def of this.cfg.foci) {
      if (def.type === 'household') {
        out.push({ type: 'household', id: H(hs('focus'), hs('household'), hid(v.cell), hid(v.household), hs('0')), def });
      } else if (def.type === 'crew') {
        const cls = recipeClasses(d);
        if (cls[v.affc] !== 'gang') continue;
        const gangShare = this.classShare(v.cell, (aff) => d.entry.byAff.find((b) => b.aff === aff)?.cls === 'gang');
        const n = Math.max(1, Math.round((head * gangShare) / (def.cell ?? 12)));
        const cell = Math.floor(this.keys.focus('crew', v.id) * n);
        out.push({ type: 'crew', id: H(hs('focus'), hs('crew'), hid(v.cell), hs('gang'), hs(String(cell))), def });
      } else if (def.type === 'work') {
        if (!WORK_ROLES.includes(v.role)) continue;
        const share = d.marginals.role[ROLES.indexOf(v.role)]! / d.marginals.role.reduce((a, b) => a + b, 0);
        const n = Math.max(1, Math.round((head * share) / (def.cell ?? 10)));
        const cell = Math.floor(this.keys.focus('work', v.id) * n);
        out.push({ type: 'work', id: H(hs('focus'), hs('work'), hid(v.cell), hs(v.role), hs(String(cell))), def });
      } else if (def.type === 'market') {
        if (v.role !== 'vendor' && v.role !== 'shopkeeper') continue;
        const b = this.w.cell(v.cell);
        if (!b.marketCell && !b.adj1.some((x) => this.w.cell(x).marketCell)) continue;
        const sum = d.marginals.role.reduce((a, c) => a + c, 0);
        const share = (d.marginals.role[0]! + d.marginals.role[1]!) / sum;
        const n = Math.max(1, Math.round((head * share) / (def.cell ?? 8)));
        const cell = Math.floor(this.keys.focus('market', v.id) * n);
        out.push({ type: 'market', id: H(hs('focus'), hs('market'), hid(v.cell), hs('market'), hs(String(cell))), def });
      }
    }
    return out.sort((x, y) => cmp(x.id, y.id));
  }

  /** The probability that two members of a focus are tied: its share, or `min(1, k / (n - 1))` for its expected size `n`. */
  pFocus(f: Focus): number {
    if (f.def.share !== undefined) return f.def.share;
    const n = f.def.cell ?? 10;
    return Math.min(1, (f.def.k ?? 0) / (n - 1));
  }

  sharedFoci(a: ResidentView, b: ResidentView): Focus[] {
    const bf = new Set(this.fociOf(b).map((f) => f.id));
    return this.fociOf(a).filter((f) => bf.has(f.id));
  }

  // ---- geography ----

  private blockDistances(block: Id): Map<Id, number> {
    const hit = this.distCache.get(block);
    if (hit) return hit;
    const dist = new Map<Id, number>([[block, 0]]);
    const queue = [block];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const x of this.w.cell(cur).adj1) {
        if (this.w.cell(x).kind !== 'grid' || dist.has(x)) continue;
        dist.set(x, dist.get(cur)! + 1);
        queue.push(x);
      }
    }
    this.distCache.set(block, dist);
    return dist;
  }

  /** The blocks in a's walking order: its own, then the others by `(graph distance, block Id)`. */
  walkingBlocks(block: Id): Id[] {
    const hit = this.orderCache.get(block);
    if (hit) return hit;
    const d = this.w.district(this.w.cell(block).district);
    const dist = this.blockDistances(block);
    const blocks = d.cellIds.filter((c) => this.w.cell(c).kind === 'grid');
    const order = blocks.sort((x, y) => (dist.get(x) ?? 1e9) - (dist.get(y) ?? 1e9) || cmp(x, y));
    this.orderCache.set(block, order);
    return order;
  }

  ordinalOf(v: ResidentView): number {
    return this.people.blockInfo(v.cell).prefix[v.hIndex]! + v.j;
  }

  /** `1 +` the number of residents who come before `b` in `a`'s walking order (S1 4.6). */
  rankOf(a: ResidentView, b: ResidentView): number {
    let before = 0;
    const own = this.people.residentCount(a.cell);
    const oa = this.ordinalOf(a);
    const ob = this.ordinalOf(b);
    if (b.cell === a.cell) return 1 + (((ob - oa - 1) % own) + own) % own;
    before += own - 1;
    for (const B of this.walkingBlocks(a.cell)) {
      if (B === a.cell) continue;
      const nB = this.people.residentCount(B);
      if (B === b.cell) {
        const anchor = Math.floor(this.keys.rankAnchor(a.id, B) * nB);
        return 1 + before + ((((ob - anchor) % nB) + nB) % nB);
      }
      before += nB;
    }
    return 1 + before;
  }

  // ---- the tie ----

  /** The probability that two residents are tied: `1 - (1 - pg)(1 - pFoci)`, `pg` made symmetric (S1 4.6). */
  tieP(a: ResidentView, b: ResidentView): { p: number; shared: Focus[] } {
    const shared = this.sharedFoci(a, b);
    let q = 1;
    for (const f of shared) q = q * (1 - this.pFocus(f));
    const pg = 0.5 * (this.pGeoOfRank(a.cell, this.rankOf(a, b)) + this.pGeoOfRank(b.cell, this.rankOf(b, a)));
    return { p: 1 - (1 - pg) * q, shared };
  }

  /** Symmetric: `tie(a, b) = tie(b, a)`. */
  tie(aId: Id, bId: Id): TieResult | undefined {
    const a = this.people.view(aId);
    const b = this.people.view(bId);
    if (!a || !b || aId === bId) return undefined;
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
    const { p, shared } = this.tieP(a, b);
    const types = new Set(shared.map((f) => f.type));
    const kind: TieKind = types.has('household') ? 'kin' : types.has('crew') ? 'crew' : types.has('work') ? 'colleague' : 'neighbour';
    const layer: 1 | 2 | 3 = types.has('household') ? 1 : shared.length > 0 ? 2 : 3;
    return { tied: this.keys.tie(lo, hi) < p, kind, layer };
  }

  /**
   * `neighbours(a, layer, cap)` (S1 4.6): a's ties up to a layer, inner first (household, then the foci by focus id and ordinal, then
   * outward by walking order), skipping duplicates, cut at the layer's cap. Each tie test costs 50 allowance units, each roster member
   * 1, the call 5,000 at most; `units` reports what it used.
   */
  neighbours(aId: Id, layer: 1 | 2 | 3 | 4): { ids: Id[]; units: number } {
    const a = this.people.view(aId);
    if (!a) return { ids: [], units: 0 };
    const cap = this.cfg.layerCaps[layer];
    const out: Id[] = [];
    let units = 0;
    const seen = new Set<Id>([aId]);
    const take = (id: Id): boolean => {
      if (seen.has(id)) return true;
      seen.add(id);
      out.push(id);
      return out.length < cap;
    };
    const budget = (n: number): boolean => {
      units += n;
      return units <= this.cfg.unitsPerCall;
    };
    // layer 1: the household
    const hh = this.people.blockInfo(a.cell).households[a.hIndex]!;
    for (let j = 0; j < this.people.blockInfo(a.cell).sizes[a.hIndex]!; j++) {
      const m = this.people.residentId(hh, j);
      this.w.k.address(hh, `m${j}`);
      if (!budget(this.cfg.unitsPerMember)) return { ids: out, units };
      if (m !== aId && !take(m)) return { ids: out, units };
    }
    if (layer >= 2) {
      // layer 2: the other foci, by focus id then ordinal, among the residents of the block and its neighbours that share one
      const mine = this.fociOf(a);
      for (const f of mine) {
        if (f.type === 'household') continue;
        for (const B of this.people.neighbourBlocks(a.cell)) {
          for (const r of this.people.residentsOfBlock(B)) {
            if (!budget(this.cfg.unitsPerMember)) return { ids: out, units };
            if (seen.has(r)) continue;
            const v = this.people.view(r);
            if (!v || !this.fociOf(v).some((x) => x.id === f.id)) continue;
            if (!budget(this.cfg.unitsPerTie)) return { ids: out, units };
            if (this.tie(aId, r)?.tied && !take(r)) return { ids: out, units };
          }
        }
      }
    }
    if (layer >= 3) {
      // layer 3: geography, outward by walking order
      for (const B of this.walkingBlocks(a.cell)) {
        const nB = this.people.residentCount(B);
        const anchor = B === a.cell ? this.ordinalOf(a) + 1 : Math.floor(this.keys.rankAnchor(aId, B) * nB);
        for (let n = 0; n < nB; n++) {
          const r = this.people.residentAt(B, (anchor + n) % nB);
          if (seen.has(r)) continue;
          if (!budget(this.cfg.unitsPerTie)) return { ids: out, units };
          if (this.tie(aId, r)?.tied && !take(r)) return { ids: out, units };
        }
      }
    }
    return { ids: out, units };
  }

  /** `bridge(p) = 1 - sum of s_f^2` over the shares of a person's expected contacts in each focus (S1 4.6). */
  bridge(aId: Id): number {
    const a = this.people.view(aId);
    if (!a) return 0;
    const contacts: number[] = [];
    for (const f of this.fociOf(a)) {
      const size = f.type === 'household' ? this.people.blockInfo(a.cell).sizes[a.hIndex]! : (f.def.cell ?? 10);
      contacts.push(this.pFocus(f) * (size - 1));
    }
    let total = 0;
    for (const c of contacts) total = total + c;
    if (!(total > 0)) return 0;
    let sq = 0;
    for (const c of contacts) sq = sq + (c / total) * (c / total);
    return 1 - sq;
  }

  /** The band `bridge(who)` answers (S1 9.1): low under 0.3, high from 0.6. */
  bridgeBand(aId: Id): 'low' | 'mid' | 'high' {
    const b = this.bridge(aId);
    return b < 0.3 ? 'low' : b >= 0.6 ? 'high' : 'mid';
  }
}

