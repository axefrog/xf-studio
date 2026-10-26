// What S1 exposes (S1 9.1): the registered reads that the seeding layer (S2) uses, and the registries for the procedural engine (S3).
// Each read is a pure function of S1 digests, the kernel and the S1 record at a time. It declares its dependencies and its invalidation, so
// that interests and wake-ups follow from them. None exposes a raw number, and each answers `maybe` until S1 has a reading for its scope.
//
// Historical evaluation: S2 evaluates a window's closing condition at each Change's occurrence time, so a value that changes and reverts
// inside one delivered batch must still be visible. Every read therefore publishes timestamped value transitions, with the initial value.

import type { GameTime, Id } from '../types.ts';
import type { Feed, Transition } from './occ.ts';
import type { EventsDigest } from './proc-events.ts';
import { BAND_NAMES, PRICE_NAMES } from './proc-events.ts';
import type { GroupDigest } from './proc-groups.ts';
import type { GoalsDigest } from './proc-goals.ts';
import { guardOf, groupOf } from './outcomes.ts';
import type { LedgerDigest } from './ledger.ts';
import type { NormsDigest } from './proc-norms.ts';
import type { SimReadPort } from '../seeding/registries.ts';
import type { Sim } from './sim.ts';

export interface ReadDeps {
  digests: string[];
  interests: Array<{ kind?: string; slot: string }>;
  time: boolean;
  roles: string[];
  /** Re-evaluate at every boundary, because the value depends on beliefs, which emit no Changes. */
  boundary?: boolean;
}

export interface ReadTransition {
  t: GameTime;
  value: string;
  /** Where the change stands among the changes of other reads made at the same time (the lower was made first); see `SimReadPort.transitions`. */
  ord?: number;
}

export interface S1Read {
  name: string;
  version: number;
  /** False for a read that is registered and always answers `maybe`: its phase is not built. */
  built: boolean;
  deps: ReadDeps;
  eval(args: unknown[], t: GameTime): string;
  transitions(args: unknown[], from: GameTime, to: GameTime): ReadTransition[];
}

const MAYBE = 'maybe';
const GAP_NAMES = ['aligned', 'gap', 'wide'] as const;
const GROUP_GAP_NAMES = ['low', 'mid', 'high'] as const;

/** The value of a keyed transition feed at `from`, and the changes in `(from, to]`; `maybe` when `from` is older than the feed (S1 9.1). */
export function feedTransitions(sim: Sim, feed: Feed<Transition> | undefined, key: string, current: string, from: GameTime, to: GameTime): ReadTransition[] {
  if (!feed || feed.windows.length === 0) return [{ t: from, value: MAYBE }];
  const W = sim.data.time.W;
  if (from < feed.windows[0]!.w * W) return [{ t: from, value: MAYBE }];
  const all = feed.windows.flatMap((win) => win.items.filter((tr) => tr.key === key));
  let initial = current;
  const firstAfter = all.find((x) => x.t > from);
  const lastBefore = [...all].reverse().find((x) => x.t <= from);
  if (lastBefore) initial = lastBefore.value;
  else if (firstAfter && firstAfter.prev !== null) initial = firstAfter.prev;
  return [{ t: from, value: initial }, ...all.filter((x) => x.t > from && x.t <= to).map((x) => ({ t: x.t, value: x.value, ord: x.ord }))];
}

export class Reads {
  readonly defs = new Map<string, S1Read>();

  constructor(private readonly sim: Sim) {
    this.build();
  }

  private get k() {
    return this.sim.k;
  }

  private dg<D>(id: string): D | undefined {
    // a read looks at a digest and keeps nothing of it
    return this.k.evolution.digestPeek<D>(id);
  }

  /** The district a scope names: a district, a cell of one, or the city. */
  districtOf(scope: unknown): Id | undefined {
    if (typeof scope !== 'string') return undefined;
    const names = this.sim.w.index.names;
    const id = names?.[scope] ?? scope;
    if (this.sim.w.index.districts[id]?.simulated) return id;
    const c = this.sim.w.index.cells[id];
    if (c) return c.district;
    if (id === this.sim.w.city) return this.sim.w.districts[0]?.id;
    return undefined;
  }

  private cellId(x: unknown): Id | undefined {
    if (typeof x !== 'string') return undefined;
    const id = this.sim.w.index.names?.[x] ?? x;
    return this.sim.w.index.cells[id] ? id : undefined;
  }

  eval(name: string, args: unknown[], t: GameTime = this.k.now): string {
    const d = this.defs.get(name);
    return d ? d.eval(args, t) : MAYBE;
  }

  /** A read and whether the coarse tiers are catching up, in which case it answers as of the last processed boundary (S1 10.2). */
  read(name: string, args: unknown[], t: GameTime = this.k.now): { value: string; catchingUp: boolean } {
    return { value: this.eval(name, args, t), catchingUp: this.sim.catchingUp };
  }

  /** The value at `from` and every change in `(from, to]` (S1 9.1): each a time and a value. */
  transitions(name: string, args: unknown[], from: GameTime, to: GameTime): Array<{ t: GameTime; value: string }> {
    return this.transitionsOrd(name, args, from, to).map((x) => ({ t: x.t, value: x.value }));
  }

  /** The same, each change with its place among the changes of other reads made at the same time: what layer 2 is handed (155). */
  transitionsOrd(name: string, args: unknown[], from: GameTime, to: GameTime): ReadTransition[] {
    const d = this.defs.get(name);
    return d ? d.transitions(args, from, to) : [{ t: from, value: MAYBE }];
  }

  private add(def: Omit<S1Read, 'built'> & { built?: boolean }): void {
    this.defs.set(def.name, { built: true, ...def });
  }

  private single(name: string, deps: ReadDeps, f: (args: unknown[], t: GameTime) => string): void {
    this.add({ name, version: 1, deps, eval: f, transitions: (args, from) => [{ t: from, value: f(args, from) }] });
  }

  /** A read whose phase is not built: registered, and `maybe` until it is (S1 9.1). */
  private unbuilt(name: string, deps: ReadDeps): void {
    this.add({ name, version: 1, built: false, deps, eval: () => MAYBE, transitions: (_a, from) => [{ t: from, value: MAYBE }] });
  }

  private fed(name: string, deps: ReadDeps, digestId: string, key: (args: unknown[]) => string | undefined, current: (args: unknown[]) => string, feed: (d: never) => Feed<Transition> | undefined): void {
    const transitions = (args: unknown[], from: GameTime, to: GameTime): ReadTransition[] => {
      const kk = key(args);
      const cur = current(args);
      if (kk === undefined || cur === MAYBE) return [{ t: from, value: MAYBE }];
      return feedTransitions(this.sim, feed(this.dg(digestId) as never), kk, cur, from, to);
    };
    this.add({
      name, version: 1, deps,
      // S2 evaluates a closing condition at the time of each Change it delivers: the value at a past time is the one the transitions give, `maybe` outside what they cover
      eval: (args, t) => (t >= this.k.now ? current(args) : transitions(args, t, t)[0]!.value),
      transitions,
    });
  }

  private build(): void {
    const sim = this.sim;
    const none: ReadDeps = { digests: [], interests: [], time: false, roles: [] };
    const ev = (id = 'city.events'): ReadDeps => ({ digests: [id], interests: [], time: false, roles: [] });

    // band(cell)
    this.fed('band', { ...ev(), interests: [{ kind: 'xf:cell', slot: 'band' }] }, 'city.events',
      (a) => { const c = this.cellId(a[0]); return c ? `band|${c}` : undefined; },
      (a) => { const c = this.cellId(a[0]); const d = this.dg<EventsDigest>('city.events'); return c && d ? BAND_NAMES[d.bands[c]?.band ?? 0]! : MAYBE; },
      (d: EventsDigest) => d?.changes);

    this.unbuilt('heatRank', ev());
    this.unbuilt('tension', none);
    this.unbuilt('reach', none);
    this.unbuilt('protected', none);
    this.unbuilt('contract', none);

    // regime(scope) and regimeIs(scope, kind)
    const regimeNow = (a: unknown[]): string => {
      const d = this.districtOf(a[0]);
      const dg = this.dg<EventsDigest>('city.events');
      if (!d || !dg) return MAYBE;
      const live = dg.regimes.filter((r) => r.scope === d).sort((x, y) => y.size - x.size || x.start - y.start || (x.kind < y.kind ? -1 : 1));
      return live.length > 0 ? live[0]!.kind : 'none';
    };
    this.fed('regime', { ...ev(), interests: [{ kind: 'core:event', slot: '*' }] }, 'city.events', (a) => { const d = this.districtOf(a[0]); return d ? `regime|${d}` : undefined; }, regimeNow, (d: EventsDigest) => d?.changes);
    this.add({
      name: 'regimeIs', version: 1, deps: { ...ev(), interests: [{ kind: 'core:event', slot: '*' }] },
      eval: (a, t) => { const r = this.eval('regime', [a[0]], t); return r === MAYBE ? MAYBE : r === a[1] ? 'yes' : 'no'; },
      transitions: (a, from, to) => this.transitionsOrd('regime', [a[0]], from, to).map((x) => ({ ...x, value: x.value === MAYBE ? MAYBE : x.value === a[1] ? 'yes' : 'no' })),
    });

    // presence(leaf, faction): static
    this.single('presence', none, (a) => {
      const d = this.districtOf(a[0]);
      if (!d) return MAYBE;
      const dist = sim.w.district(d);
      const q = dist.entry.byAff.find((b) => b.aff === a[1])?.q ?? 0;
      const share = q / dist.entry.total;
      return q <= 0 ? 'none' : share < 0.02 ? 'low' : share < 0.08 ? 'mid' : 'high';
    });

    // priceLevel(district)
    this.fed('priceLevel', { ...ev(), interests: [{ kind: 'core:event', slot: '*' }] }, 'city.events', (a) => { const d = this.districtOf(a[0]); return d ? `price|${d}` : undefined; },
      (a) => { const d = this.districtOf(a[0]); const dg = this.dg<EventsDigest>('city.events'); return d && dg ? PRICE_NAMES[dg.price[d] ?? sim.w.district(d).priceAnchor]! : MAYBE; },
      (d: EventsDigest) => d?.changes);

    // refuge(leaf)
    this.fed('refuge', { ...ev(), interests: [{ kind: 'xf:service', slot: 'status' }, { kind: 'xf:cell', slot: 'band' }] }, 'city.events', (a) => { const d = this.districtOf(a[0]); return d ? `refuge|${d}` : undefined; },
      (a) => { const d = this.districtOf(a[0]); const dg = this.dg<EventsDigest>('city.events'); return d && dg ? dg.refuge[d] ?? MAYBE : MAYBE; },
      (d: EventsDigest) => d?.changes);

    // label(audience, subject, axis): the audience is a carrier's node (what a cast role resolves to, or an Id written in a seed), or the
    // name of a carrier in the pack's configuration, which stands for that carrier in the first simulated district
    const labelNode = (a: unknown[]): Id | undefined => {
      if (typeof a[0] !== 'string') return undefined;
      const node = sim.ledger.carriers().find((c) => c.node === a[0]);
      if (node) return node.node;
      const car = this.sim.data.ledger.carriers.find((c) => c.id === a[0]);
      const district = sim.w.districts[0]?.id;
      return car && district ? sim.ledger.carrierNode(car.id, district) : undefined;
    };
    this.fed('label', { ...ev('order.ledger'), interests: [{ kind: 'xf:standing', slot: '*' }] }, 'order.ledger',
      (a) => { const n = labelNode(a); return n ? `label|${n}|${String(a[2])}` : undefined; },
      (a) => { const n = labelNode(a); const dg = this.dg<LedgerDigest>('order.ledger'); return n && dg && (a[1] === 'v' || a[1] === sim.w.v) ? dg.labels[n]?.[String(a[2])]?.band ?? MAYBE : MAYBE; },
      (d: LedgerDigest) => d?.changes);

    // bridge(who)
    this.single('bridge', none, (a) => (typeof a[0] === 'string' && sim.people.view(a[0]) ? sim.ties.bridgeBand(a[0]) : MAYBE));

    // normGap(norm, scope)
    this.fed('normGap', { ...ev('order.norms'), interests: [{ kind: 'xf:district', slot: '*' }] }, 'order.norms',
      (a) => { const d = this.districtOf(a[1]); return d ? `gap|${String(a[0])}|${d}` : undefined; },
      (a) => { const d = this.districtOf(a[1]); const dg = this.dg<NormsDigest>('order.norms'); const g = d && dg ? dg.norms[d]?.[String(a[0])]?.gap : undefined; return g === undefined ? MAYBE : GAP_NAMES[g]!; },
      (d: NormsDigest) => d?.changes);

    // tied(a, b, type): built for the type `xf:tie` (S1 9.1); another type is not built, and answers `maybe`
    this.add({
      name: 'tied', version: 1, deps: { digests: [], interests: [{ slot: '*' }], time: true, roles: ['a', 'b'] },
      eval: (a, t) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? this.tiedAt(a[0], a[1], a[2], t) : MAYBE),
      transitions: (a, from, to) => {
        if (typeof a[0] !== 'string' || typeof a[1] !== 'string') return [{ t: from, value: MAYBE }];
        // the value changes where a materialised interval opens or closes (the implicit tie is a pure function of the pair, and never changes)
        const floor = sim.tiePolicy.coverageFloor(a[0], a[1]);
        const out: ReadTransition[] = [{ t: from, value: this.tiedAt(a[0], a[1], a[2], from) }];
        const logged = sim.tiePolicy.transitionsOf(a[0], a[1]).filter((x) => x.t > from && x.t <= to && (floor === undefined || x.t >= floor));
        const boundaries = logged.sort((x, y) => x.t - y.t || x.ord - y.ord);
        const implicit = sim.ties.tie(a[0], a[1]);
        for (const e of boundaries) {
          const value = a[2] !== undefined && a[2] !== 'xf:tie' ? MAYBE : implicit?.tied ? 'yes' : e.value === 'no' && implicit === undefined ? MAYBE : e.value;
          if (value !== out[out.length - 1]!.value) out.push({ t: e.t, value, ord: e.ord });
        }
        return out;
      },
    });

    // divergence(believer, subject)
    this.add({
      name: 'divergence', version: 1, deps: { digests: [], interests: [{ kind: 'xf:person', slot: 'alive' }, { kind: 'xf:person', slot: 'affiliation' }], time: false, roles: ['believer', 'subject'], boundary: true },
      eval: (a, t) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? sim.divergence.evaluate(a[0], a[1], t) : MAYBE),
      transitions: (a, from, to) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? sim.divergence.transitions(a[0], a[1], from, to) : [{ t: from, value: MAYBE }]),
    });

    // depth(node)
    this.single('depth', { digests: [], interests: [{ slot: '*' }], time: false, roles: ['node'] }, (a) => (typeof a[0] === 'string' ? (sim.k.frames.demandTier(a[0]) >= 3 ? 'open' : 'closed') : MAYBE));

    // leads(person, group) and holds(who, item) (S1 9.1, v0.6): whether an `xf:leads` or `xf:held-by` edge is valid at `t`, with the kernel's edge times as the transitions
    const edgeRead = (name: string, type: string, ends: (a: unknown[]) => { from: Id; to: Id } | undefined): void => {
      const intervals = (e: { from: Id; to: Id }): Array<{ from: GameTime; to?: GameTime }> => {
        this.k.persistence.recoverIfSaved(e.from, e.to);
        return this.k.store.edgesFrom(e.from).filter((x) => x.type === type && x.to === e.to).map((x) => ({ from: x.valid.from, ...(x.valid.to !== undefined ? { to: x.valid.to } : {}) }));
      };
      const at = (e: { from: Id; to: Id }, t: GameTime): string => (intervals(e).some((i) => i.from <= t && (i.to === undefined || t < i.to)) ? 'yes' : 'no');
      this.add({
        name, version: 1, deps: { digests: [], interests: [{ slot: '*' }], time: true, roles: ['a', 'b'] },
        eval: (a, t) => { const e = ends(a); return e ? at(e, t) : MAYBE; },
        transitions: (a, from, to) => {
          const e = ends(a);
          if (!e) return [{ t: from, value: MAYBE }];
          const out: ReadTransition[] = [{ t: from, value: at(e, from) }];
          const times = [...new Set(intervals(e).flatMap((i) => [i.from, ...(i.to !== undefined ? [i.to] : [])]))].filter((x) => x > from && x <= to).sort((x, y) => x - y);
          for (const x of times) {
            const v = at(e, x);
            if (v !== out[out.length - 1]!.value) out.push({ t: x, value: v });
          }
          return out;
        },
      });
    };
    edgeRead('leads', 'xf:leads', (a) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? { from: a[0], to: a[1] } : undefined));
    edgeRead('holds', 'xf:held-by', (a) => (typeof a[1] === 'string' && typeof a[0] === 'string' ? { from: a[1], to: a[0] } : undefined));
    // intentAgainst(group, subject) (S1 9.1, v0.6): `none`; `warned` (rung 1, its warning not yet perceived); `ranks`; `price`; `hunt`. Subject V only in the core
    const isV = (x: unknown): boolean => x === 'v' || x === sim.w.v;
    const againstNow = (a: unknown[]): string => {
      const dg = this.dg<GroupDigest>('group.decide');
      const g = typeof a[0] === 'string' ? dg?.groups[a[0]] : undefined;
      if (!dg || !g || !isV(a[1])) return MAYBE;
      const ag = dg.against[a[0] as string];
      if (!ag) return 'none';
      return ag.rung === 'ranks' && !ag.warned ? 'warned' : ag.rung;
    };
    this.fed('intentAgainst', { ...ev('group.decide'), interests: [{ kind: 'core:event', slot: '*' }], boundary: true }, 'group.decide',
      (a) => (typeof a[0] === 'string' && isV(a[1]) ? `against|${a[0]}` : undefined), againstNow, (d: GroupDigest) => d?.changes);

    // wants(person, kind?) (S1 9.1, v0.6): whether the person holds an active goal, of that kind if given; its transitions replay the goal feed
    const wantsAt = (person: string, kind: unknown, states: Map<string, string>, owners: Map<string, { owner: string; kind: string }>): string => {
      for (const [id, st] of states) {
        const o = owners.get(id);
        if (st === 'active' && o?.owner === person && (kind === undefined || o.kind === kind)) return 'yes';
      }
      return 'no';
    };
    const goalStates = (dg: GoalsDigest, t: GameTime): { states: Map<string, string>; owners: Map<string, { owner: string; kind: string }> } => {
      const owners = new Map<string, { owner: string; kind: string }>(Object.entries(dg.recent));
      const states = new Map<string, string>();
      for (const g of dg.goals) { owners.set(g.id, { owner: g.owner, kind: g.kind }); states.set(g.id, g.state); }
      // walk the feed backwards from the present to `t`: each transition after `t` gives back the state before it
      const items = dg.changes.windows.flatMap((win) => win.items).sort((x, y) => (x.ord ?? 0) - (y.ord ?? 0) || x.t - y.t);
      for (let i = items.length - 1; i >= 0; i--) {
        const tr = items[i]!;
        if (tr.t <= t) break;
        const id = tr.key.slice(5);
        if (tr.prev === null) states.delete(id);
        else states.set(id, tr.prev === 'open' ? 'active' : tr.prev);
      }
      return { states, owners };
    };
    this.add({
      name: 'wants', version: 1, deps: { ...ev('people.goals'), interests: [{ kind: 'core:person', slot: '*' }] },
      eval: (a, t) => {
        const dg = this.dg<GoalsDigest>('people.goals');
        if (!dg || typeof a[0] !== 'string') return MAYBE;
        const { states, owners } = goalStates(dg, t);
        return wantsAt(a[0], a[1], states, owners);
      },
      transitions: (a, from, to) => {
        const dg = this.dg<GoalsDigest>('people.goals');
        if (!dg || typeof a[0] !== 'string') return [{ t: from, value: MAYBE }];
        if (dg.changes.windows.length === 0 || from < dg.changes.windows[0]!.w * sim.data.time.W) return [{ t: from, value: MAYBE }];
        const first = goalStates(dg, from);
        const out: ReadTransition[] = [{ t: from, value: wantsAt(a[0], a[1], first.states, first.owners) }];
        const times = [...new Set(dg.changes.windows.flatMap((win) => win.items.filter((tr) => tr.t > from && tr.t <= to).map((tr) => tr.t)))].sort((x, y) => x - y);
        for (const t of times) {
          const s2 = goalStates(dg, t);
          const v = wantsAt(a[0], a[1], s2.states, s2.owners);
          if (v !== out[out.length - 1]!.value) out.push({ t, value: v });
        }
        return out;
      },
    });

    // guarded(person) (S1 9.1, v0.6): `guarded` of S1 7.10 at the time, from the post history alone; a post covers only some periods, so the read is re-evaluated at every boundary
    const guardedAt = (person: string, t: GameTime): string => {
      const dg = this.dg<GoalsDigest>('people.goals');
      if (!dg) return MAYBE;
      return guardOf(sim, person, t, { posts: dg.posts }) !== undefined ? 'yes' : 'no';
    };
    this.add({
      name: 'guarded', version: 1, deps: { ...ev('people.goals'), interests: [{ kind: 'core:person', slot: '*' }], boundary: true },
      eval: (a, t) => (typeof a[0] === 'string' ? guardedAt(a[0], t) : MAYBE),
      transitions: (a, from, to) => {
        if (typeof a[0] !== 'string') return [{ t: from, value: MAYBE }];
        const W = sim.data.time.W;
        const out: ReadTransition[] = [{ t: from, value: guardedAt(a[0], from) }];
        // the value can change where a post begins or ends or a period turns: all on window starts
        for (let t = (Math.floor(from / W) + 1) * W; t <= to && t - from <= 2016 * W; t += W) {
          const v = guardedAt(a[0], t);
          if (v !== out[out.length - 1]!.value) out.push({ t, value: v });
        }
        return out;
      },
    });

    // groupGap(group)
    this.fed('groupGap', { ...ev('group.decide'), interests: [{ kind: 'xf:group', slot: 'group-gap' }] }, 'group.decide',
      (a) => (typeof a[0] === 'string' ? `group-gap|${a[0]}` : undefined),
      // the band the group maintains, with its hysteresis, which is also what the transitions say (SIM-09)
      (a) => { const dg = this.dg<GroupDigest>('group.decide'); const g = typeof a[0] === 'string' ? dg?.groups[a[0]] : undefined; return g ? GROUP_GAP_NAMES[g.band] : MAYBE; },
      (d: GroupDigest) => d?.changes);
  }

  /** What layer 2 asks of these reads (S2 2.16, 2.17, 4.1): which it may call, the answer, and what each depends on. */
  port(): SimReadPort {
    return {
      builds: (name) => this.defs.get(name)?.built === true,
      eval: (name, args, t) => this.eval(name, args, t),
      transitions: (name, args, from, to) => this.transitionsOrd(name, args, from, to).map((x) => (x.ord === undefined ? { t: x.t, value: x.value } : { t: x.t, value: x.value, ord: x.ord })),
      deps: (name) => {
        const d = this.defs.get(name);
        return { interests: d ? d.deps.interests.map((i) => ({ ...i })) : [], boundary: d?.deps.boundary === true };
      },
    };
  }

  tied(a: Id, b: Id): string {
    if (this.sim.tiePolicy.hasEdge(a, b)) return 'yes';
    const t = this.sim.ties.tie(a, b);
    return t === undefined ? MAYBE : t.tied ? 'yes' : 'no';
  }

  /**
   * Whether two people were tied at `t` (S1 9.1): the implicit tie, a pure function of the pair that holds at any time, together with every
   * interval in which the tie was materialised, those that ended and were opened again among them (SIM-07, SIM-11). Only `xf:tie` is built.
   */
  tiedAt(a: Id, b: Id, type: unknown, t: GameTime): string {
    if (type !== undefined && type !== 'xf:tie') return MAYBE;
    if (t >= this.k.now) return this.tied(a, b);
    const implicit = this.sim.ties.tie(a, b);
    if (implicit?.tied) return 'yes';
    if (this.sim.tiePolicy.intervalsOf(a, b).some((s) => s.from <= t && (s.to === undefined || t < s.to))) return 'yes';
    // an interval may have been in a stretch whose record was dropped: the answer for those times is not known (R2-09)
    const floor = this.sim.tiePolicy.coverageFloor(a, b);
    if (floor !== undefined && t < floor) return MAYBE;
    return implicit === undefined ? MAYBE : 'no';
  }

  // ---- registries for S3 (S1 9.2) ----

  agentRoles(kind: string): string[] { return this.sim.w.kinds.agentRolesOf(kind).slice(); }
  areTied(a: Id, b: Id, at: GameTime): boolean { return this.tiedAt(a, b, 'xf:tie', at) === 'yes'; }
  intends(actor: Id, kind: string, at: GameTime): boolean {
    const group = groupOf(this.sim, actor, at);
    const active = group ? this.dg<GroupDigest>('group.decide')?.groups[group]?.active : undefined;
    return !!active && (this.sim.data.groups.intents.find((i) => i.id === active.name)?.boost[kind] ?? 0) > 0;
  }

  producers(kind: string): string[] {
    return this.sim.w.kinds.producers(kind);
  }
  eventKind(name: string): { tags: string[]; producers: string[] } | undefined {
    return this.sim.w.kinds.eventKind(name);
  }
  /** A canon character of the main story (S1 4.4), from the characters whose fate the game's final boards read. */
  isSpine(node: Id): boolean {
    return this.sim.spine.has(node);
  }
  /** The `aesthetic` feature table is S4's; in M3 every feature is `undefined`, so S3's `T_aes` is 0. */
  aesthetic(_node: Id, _feature: string): undefined {
    return undefined;
  }
}
