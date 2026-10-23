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

/** The value of a keyed transition feed at `from`, and the changes in `(from, to]`; `maybe` when `from` is older than the feed (S1 9.1). */
export function feedTransitions(sim: Sim, feed: Feed<Transition> | undefined, key: string, current: string, from: GameTime, to: GameTime): ReadTransition[] {
  if (!feed || feed.windows.length === 0) return [{ t: from, value: MAYBE }];
  const W = sim.data.time.W;
  if (from < feed.windows[0]!.w * W) return [{ t: from, value: MAYBE }];
  const all: Transition[] = [];
  for (const win of feed.windows) for (const tr of win.items) if (tr.key === key) all.push(tr);
  let initial = current;
  const firstAfter = all.find((x) => x.t > from);
  const lastBefore = [...all].reverse().find((x) => x.t <= from);
  if (lastBefore) initial = lastBefore.value;
  else if (firstAfter && firstAfter.prev !== null) initial = firstAfter.prev;
  return [{ t: from, value: initial }, ...all.filter((x) => x.t > from && x.t <= to).map((x) => ({ t: x.t, value: x.value }))];
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
    return this.k.evolution.digestOf<D>(id);
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

  transitions(name: string, args: unknown[], from: GameTime, to: GameTime): ReadTransition[] {
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
    this.add({
      name, version: 1, deps,
      eval: (args) => current(args),
      transitions: (args, from, to) => {
        const kk = key(args);
        const cur = current(args);
        if (kk === undefined || cur === MAYBE) return [{ t: from, value: MAYBE }];
        return feedTransitions(this.sim, feed(this.dg(digestId) as never), kk, cur, from, to);
      },
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
      eval: (a) => { const r = regimeNow(a); return r === MAYBE ? MAYBE : r === a[1] ? 'yes' : 'no'; },
      transitions: (a, from, to) => this.transitions('regime', [a[0]], from, to).map((x) => ({ t: x.t, value: x.value === MAYBE ? MAYBE : x.value === a[1] ? 'yes' : 'no' })),
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

    // label(audience, subject, axis)
    const labelNode = (a: unknown[]): Id | undefined => {
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

    // tied(a, b, type)
    this.add({
      name: 'tied', version: 1, deps: { digests: [], interests: [{ slot: '*' }], time: true, roles: ['a', 'b'] },
      eval: (a) => (typeof a[0] === 'string' && typeof a[1] === 'string' ? this.tied(a[0], a[1]) : MAYBE),
      transitions: (a, from, to) => {
        if (typeof a[0] !== 'string' || typeof a[1] !== 'string') return [{ t: from, value: MAYBE }];
        const e = sim.tiePolicy.edge(a[0], a[1]) ?? [...sim.k.store.edgesFrom(a[0]), ...sim.k.store.edgesTo(a[0])].find((x) => x.type === 'xf:tie' && (x.from === a[1] || x.to === a[1]));
        if (!e) return [{ t: from, value: this.tied(a[0], a[1]) }];
        const out: ReadTransition[] = [{ t: from, value: e.valid.from <= from && (e.valid.to === undefined || from < e.valid.to) ? 'yes' : 'no' }];
        if (e.valid.from > from && e.valid.from <= to) out.push({ t: e.valid.from, value: 'yes' });
        if (e.valid.to !== undefined && e.valid.to > from && e.valid.to <= to) out.push({ t: e.valid.to, value: 'no' });
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

    // groupGap(group)
    this.fed('groupGap', { ...ev('group.decide'), interests: [{ kind: 'xf:group', slot: 'group-gap' }] }, 'group.decide',
      (a) => (typeof a[0] === 'string' ? `group-gap|${a[0]}` : undefined),
      (a) => { const dg = this.dg<GroupDigest>('group.decide'); const g = typeof a[0] === 'string' ? dg?.groups[a[0]] : undefined; return g ? (g.D < sim.data.groups.gapBands.low ? 'low' : g.D < sim.data.groups.gapBands.mid ? 'mid' : 'high') : MAYBE; },
      (d: GroupDigest) => d?.changes);
  }

  /** What layer 2 asks of these reads (S2 2.16, 2.17, 4.1): which it may call, the answer, and what each depends on. */
  port(): SimReadPort {
    return {
      builds: (name) => this.defs.get(name)?.built === true,
      eval: (name, args, t) => this.eval(name, args, t),
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

  // ---- registries for S3 (S1 9.2) ----

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
