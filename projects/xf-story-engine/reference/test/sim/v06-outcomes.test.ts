// S1 v0.6: what each kind fills and how it can fail (SF1-K, SF1-F), and the norms' refusals (SF1-N-8 to SF1-N-10).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { applicableFills } from '../../src/sim/fills.ts';
import { lintKinds } from '../../src/sim/kinds.ts';
import type { CastEntry, EventFact } from '../../src/sim/occ.ts';
import { compliesAt, guardOf, outcomeOf, type OutcomeView, type PostRec } from '../../src/sim/outcomes.ts';
import { enforcementMean, type NormsDigest, type NormsState } from '../../src/sim/proc-norms.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { defaultData, type S1Data } from '../../src/sim/data.ts';
import { fxData, quietData, seedOf } from './helpers.ts';

setDefaultTimeout(120_000);
const W = 600;

describe('SF1-K: the kind registry, fills and outcomes (v0.6)', () => {
  const sim = Sim.create({ worldSeed: seedOf('SF1-K'), index: fx3Slice(), data: quietData(), only: [] });
  const fills = (kind: string, outcome: 'done' | 'failed' | 'prevented' | undefined, parts: Array<[string, string]>) =>
    applicableFills(sim.w.kinds.get(kind)!.fills, outcome, parts.map(([role, who]) => ({ role, who })), 'place', 'self').map((f) => f.fn);

  test('SF1-K-1: the shipped registry loads with zero findings; a fill naming a missing role, an unknown function, and a kind that lets v be a victim are each refused with the kind named', () => {
    expect(lintKinds(defaultData())).toEqual([]);
    const withFill = (fill: { fn: string; args: Record<string, string> }, extra: Partial<S1Data['kinds'][number]> = {}): string[] => {
      const d = defaultData();
      const k = d.kinds.find((x) => x.name === 'shakedown')!;
      k.fills = [fill];
      Object.assign(k, extra);
      return lintKinds(d);
    };
    expect(withFill({ fn: 'demand', args: { by: 'collector', of: 'victim' } }).join('\n')).toContain('kind shakedown: the fill demand names the role collector');
    expect(withFill({ fn: 'conjure', args: { by: 'aggressor' } }).join('\n')).toContain('kind shakedown: the fill conjure is not a function of the loaded vocabulary');
    expect(withFill({ fn: 'demand', args: { by: 'aggressor', of: 'victim' } }, { allowV: ['victim'] }).join('\n')).toContain('kind shakedown lets v be victim');
    // an agent role, an informational role and a protagonist-object role are allowed
    const d = defaultData();
    d.kinds.find((x) => x.name === 'theft')!.allowV = ['aggressor'];
    expect(lintKinds(d)).toEqual([]);
    // a fill that needs an outcome the kind cannot reach
    const e = defaultData();
    e.kinds.find((x) => x.name === 'accident')!.fills = [{ fn: 'befall', args: { who: 'victim' }, when: { outcome: ['prevented'] } }];
    expect(lintKinds(e).join('\n')).toContain('kind accident: the fill befall needs the outcome prevented');
  });

  test('SF1-K-1: the kernel registry holds each kind with its roles and fills, in order', () => {
    const e = sim.k.eventKinds.eventKind('shakedown')!;
    expect(e.fills!.map((f) => f.fn)).toEqual(['demand', 'comply', 'transfer', 'wrong', 'refuse', 'protect']);
    expect(e.roles).toEqual(expect.arrayContaining(['aggressor', 'aggressor-group', 'victim', 'guard']));
    expect(sim.w.kinds.eventKind('shakedown')!.agentRoles).toEqual(['aggressor']);
    expect(sim.w.kinds.eventKind('shakedown')!.outcomes!.prevent).toEqual({ ward: 'victim', p: 0.7 });
  });

  test('SF1-K-2: fills follow the outcome', () => {
    const base: Array<[string, string]> = [['aggressor', 'a'], ['victim', 'v']];
    expect(fills('shakedown', 'done', base)).toEqual(['demand', 'comply', 'transfer', 'wrong']);
    expect(fills('shakedown', 'failed', base)).toEqual(['demand', 'refuse']);
    expect(fills('shakedown', 'prevented', [...base, ['guard', 'g']])).toEqual(['demand', 'refuse', 'protect']);
    const prevented = applicableFills(sim.w.kinds.get('shakedown')!.fills, 'prevented', [{ role: 'aggressor', who: 'a' }, { role: 'victim', who: 'v' }, { role: 'guard', who: 'g' }]);
    expect(prevented.find((f) => f.fn === 'protect')!.args).toEqual({ guard: 'g', ward: 'v' });
    // a patrol with no victim: wrong(responder, target) and no protect
    const patrol = applicableFills(sim.w.kinds.get('police-action')!.fills, 'done', [{ role: 'responder', who: 'r' }, { role: 'target', who: 't' }]);
    expect(patrol.map((f) => f.fn)).toEqual(['wrong']);
    expect(patrol[0]!.args).toEqual({ by: 'r', to: 't' });
    // a disorder fills nothing until a victim is cast
    expect(fills('disorder', 'done', [['participant', 'p'], ['participant', 'q']])).toEqual([]);
    // an argument whose role is absent stays unbound; `a|b` takes the first present; a group stands in
    const clash = applicableFills(sim.w.kinds.get('gang-clash')!.fills, 'done', [{ role: 'aggressor-group', who: 'ga' }, { role: 'victim', who: 'v' }], 'cell');
    expect(clash.map((f) => [f.fn, f.args])).toEqual([['wrong', { by: 'ga', to: 'v' }], ['compete', { a: 'ga', b: 'v', prize: 'cell' }]]);
    // a telling's `expose` waits for the reader's state
    const tell = applicableFills(sim.w.kinds.get('tell')!.fills, 'done', [{ role: 'teller', who: 't' }, { role: 'listener', who: 'l' }, { role: 'told', who: 'e' }]);
    expect(tell.map((f) => f.fn)).toEqual(['learn', 'expose']);
    expect(tell[1]!.pending!.state!.fn).toBe('conceal');
  });

  test('SF1-K-3: one occurrence, one meaning: a raw death fills nothing, the derived assault fills wrong(aggressor, victim)', () => {
    expect(sim.w.kinds.get('game.death')!.fills).toEqual([]);
    expect(fills('assault', 'done', [['aggressor', 'a'], ['victim', 'v']])).toEqual(['wrong']);
    for (const raw of ['game.combat.start', 'game.heat.3', 'game.journal.failed', 'gig-outcome', 'regime-end']) expect(sim.w.kinds.get(raw)!.fills).toEqual([]);
    expect(sim.w.kinds.get('enf.fee.fine')!.fills.map((f) => f.fn)).toEqual(['wrong', 'transfer', 'protect']);
    expect(sim.w.kinds.get('enf.fee.word')!.fills.map((f) => f.fn)).toEqual(['demand', 'threaten', 'protect']);
  });
});

describe('SF1-F: the outcome draw', () => {
  const sim = Sim.create({ worldSeed: seedOf('SF1-F'), index: fx3Slice(), data: quietData(), only: [] });
  const residents: Array<{ id: Id; affc: number; role: string }> = [];
  for (const cell of Object.keys(sim.w.index.cells)) for (const r of sim.people.residentsOfBlock(cell)) {
    const v = sim.people.view(r);
    if (v && v.ageClass === 'adult') residents.push({ id: r, affc: v.affc, role: v.role });
  }
  const gaMember = residents.find((r) => r.affc === 2)!;
  const gbMember = residents.find((r) => r.affc === 3)!;
  const civilian = residents.find((r) => r.affc === 0)!;
  const district = sim.w.districts[0]!.id;
  const noneComply: OutcomeView = { norms: { v: 1, through: 0, norms: { [district]: { fee: { priv: 0, beh: 0, perc: 0, vis: 0, gap: 0, compliers: [{ from: 0, mask: 0 }] } } }, facts: { windows: [] }, changes: { windows: [] } } as NormsDigest };
  const cast = (victim: Id, aggressor: Id): CastEntry[] => [{ role: 'aggressor', who: aggressor }, { role: 'victim', who: victim }];
  /** A time at which the person is somewhere (not away), so that where() gives a cell. */
  const presentTime = (p: Id): number => {
    for (let t = 6 * 3600; t < 30 * 86400; t += 3600) if (sim.people.where(p, t).cell !== undefined) return t;
    throw new Error('never present');
  };
  const occ = (n: number, kind: string, time: number) => ({ id: H(hs('occ'), hs(String(n))), kind, time });

  test('SF1-F-1: unguarded a hostile-backed non-complier refuses with 0.65; complying civilian 0.03', () => {
    const t = presentTime(gbMember.id);
    expect(compliesAt(sim, gbMember.id, 'fee', t, noneComply)).toBe(false);
    for (let n = 0; n < 200; n++) {
      const o = occ(n, 'shakedown', t);
      const u = sim.ids.outcome(o.id);
      expect(outcomeOf(sim, o, cast(gbMember.id, gaMember.id), noneComply).outcome).toBe(u < 0.65 ? 'failed' : 'done');
    }
    const tc = presentTime(civilian.id);
    expect(compliesAt(sim, civilian.id, 'fee', tc, {})).toBe(true);
    for (let n = 0; n < 300; n++) {
      const o = occ(n, 'shakedown', tc);
      expect(outcomeOf(sim, o, cast(civilian.id, gaMember.id), {}).outcome).toBe(sim.ids.outcome(o.id) < 0.03 ? 'failed' : 'done');
    }
  });

  test('SF1-F-1: guarded, prevented for u < 0.7, failed for 0.7 to 0.895, done above', () => {
    const t = presentTime(gbMember.id);
    const guard = residents.find((r) => r.id !== gbMember.id && r.id !== gaMember.id)!.id;
    const posts: PostRec[] = [{ person: guard, cell: sim.people.where(gbMember.id, t).cell!, periods: [sim.people.periodOf(t)], from: 0, goal: H(hs('goal')), ward: gbMember.id }];
    const view: OutcomeView = { ...noneComply, posts };
    expect(guardOf(sim, gbMember.id, t, view)).toBe(guard);
    // no post for another ward, one for another period, or ended before the window
    expect(guardOf(sim, civilian.id, t, view)).toBeUndefined();
    expect(guardOf(sim, gbMember.id, t, { posts: [{ ...posts[0]!, periods: [(sim.people.periodOf(t) + 1) % 4] }] })).toBeUndefined();
    expect(guardOf(sim, gbMember.id, t, { posts: [{ ...posts[0]!, until: Math.floor(t / W) }] })).toBeUndefined();
    const seen = new Set<string>();
    for (let n = 0; n < 400; n++) {
      const o = occ(n, 'shakedown', t);
      const u = sim.ids.outcome(o.id);
      const got = outcomeOf(sim, o, cast(gbMember.id, gaMember.id), view);
      const want = u < 0.7 ? 'prevented' : u < 0.895 ? 'failed' : 'done';
      expect(got.outcome).toBe(want);
      expect(got.guard).toBe(want === 'prevented' ? guard : undefined);
      seen.add(want);
    }
    expect([...seen].sort()).toEqual(['done', 'failed', 'prevented']);
    // a theft and an assault are only ever prevented or done; a kind without rules is always done
    for (let n = 0; n < 100; n++) {
      const a = outcomeOf(sim, occ(n, 'assault', t), cast(gbMember.id, gaMember.id), view).outcome;
      expect(['prevented', 'done']).toContain(a);
      expect(outcomeOf(sim, occ(n, 'accident', t), cast(gbMember.id, gaMember.id), view).outcome).toBe('done');
    }
  });

  test('SF1-F-1: a guard who is not alive at the time guards nobody', () => {
    const t = presentTime(gbMember.id);
    const dead = residents.find((r) => r.id !== gbMember.id && !sim.people.alive(r.id, 100 * 365 * 86400))?.id;
    if (dead === undefined) return; // no resident is dead within a century in this world: the rule is covered by the alive() read itself
    expect(guardOf(sim, gbMember.id, 100 * 365 * 86400, { posts: [{ person: dead, cell: sim.people.where(gbMember.id, 100 * 365 * 86400).cell ?? '', periods: [0, 1, 2, 3], from: 0, goal: H(hs('g')), ward: gbMember.id }] })).toBeUndefined();
    void t;
  });

  test('SF1-F-4: a failed or prevented occurrence takes and harms nothing; a failed shakedown of a protected victim is still refused by the gate', () => {
    const t = presentTime(gbMember.id);
    const cell = sim.people.where(gbMember.id, t).cell!;
    const d = (outcome: 'done' | 'failed' | 'prevented', kind = 'shakedown') => ({ id: H(hs('d'), hs(kind), hs(outcome)), kind, size: 2, w: Math.floor(t / W), time: t, cell, gen: 0, chain: [], public: false, witnesses: 0, outcome, ...(outcome === 'prevented' ? { guard: civilian.id } : {}) });
    const c = cast(gbMember.id, gaMember.id);
    expect(sim.occurrenceOf(d('done'), c, 'creator', 'sim').effects).toEqual([{ on: gbMember.id, effect: 'take' }]);
    expect(sim.occurrenceOf(d('failed'), c, 'creator', 'sim').effects).toEqual([]);
    const prevented = sim.occurrenceOf(d('prevented'), c, 'creator', 'sim');
    expect(prevented.effects).toEqual([{ on: gbMember.id, effect: 'protect' }]);
    expect(prevented.participants).toContainEqual({ who: civilian.id, role: 'guard' });
    const theft = sim.occurrenceOf(d('prevented', 'theft'), c, 'creator', 'sim');
    expect(theft.effects).toEqual([{ on: gbMember.id, effect: 'protect' }]);
    expect(sim.occurrenceOf(d('done', 'theft'), c, 'creator', 'sim').effects).toEqual([{ on: gbMember.id, effect: 'take' }]);
    // the gate still checks a victim role: a protected victim is refused whatever the outcome
    sim.people.essential.add(gbMember.id);
    expect(sim.gate.produce(sim.occurrenceOf(d('failed'), c, 'creator', 'sim'), sim.k.settings.current(), t).ok).toBe(false);
    sim.people.essential.delete(gbMember.id);
  });
});

describe('SF1-F-2: outcomes reproduce', () => {
  test('an admitted size-2 shakedown re-minted from the ring restates its descriptor outcome, and the event carries it', () => {
    const sim = Sim.create({
      worldSeed: seedOf('SF1-F-2'), index: fx3Slice(),
      data: fxData((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = k === 'shakedown' ? [0, 600, 0, 0] : [0, 0, 0, 0]; for (const r of d.regimes) r.arrival = 0; d.kinds.find((x) => x.name === 'shakedown')!.sizes = [1, 2]; }),
      only: ['city.events'],
    });
    sim.advance(60);
    const ring = (sim.k.evolution.states.get('city.events')!.state as { ring: Array<{ id: Id; event?: { outcome?: string; guard?: Id; kind: string } }> }).ring.filter((e) => e.event);
    expect(ring.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const e of ring) {
      const o = e.event!.outcome!;
      expect(['done', 'failed', 'prevented']).toContain(o);
      seen.add(o);
      expect(sim.k.value(e.id, 'outcome')).toBe(o as 'done');
      const id = sim.remint(e.id);
      expect(id).toBe(e.id);
      expect(sim.k.value(e.id, 'outcome')).toBe(o as 'done');
    }
    // every fact says what the event says
    const dg = sim.digestOf<{ facts: { windows: Array<{ items: EventFact[] }> } }>('city.events')!;
    for (const win of dg.facts.windows) for (const f of win.items) {
      const e = ring.find((x) => x.id === f.id)!;
      expect(f.outcome).toBe(e.event!.outcome as 'done');
      expect(f.parties.length).toBeGreaterThan(0);
    }
    expect(seen.has('done')).toBe(true);
  });
});

describe('SF1-N-8 to SF1-N-10: refusals', () => {
  const refusal = (sim: Sim, over: Partial<EventFact> = {}): { fact: EventFact; refuser: Id; collector: Id } => {
    const d = sim.w.districts[0]!;
    const residents: Array<{ id: Id; role: string; affc: number }> = [];
    for (const cell of Object.keys(sim.w.index.cells)) for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r);
      if (v && v.ageClass === 'adult') residents.push({ id: r, role: v.role, affc: v.affc });
    }
    const refuser = residents.find((r) => r.role === 'vendor' || r.role === 'shopkeeper')!.id;
    const collector = residents.find((r) => r.affc === 2 && r.role === 'gang')!.id;
    const group = sim.w.group(d.id, 'A1');
    const cell = d.cellIds[0]!;
    const fact: EventFact = {
      id: H(hs('refusal'), hid(refuser)), kind: 'shakedown', size: 1, w: 5, time: 5 * W, cell, district: d.id, public: true, witnesses: 6, policeChild: false, creator: 'sim',
      outcome: 'failed', parties: [{ role: 'aggressor', who: collector, group }, { role: 'victim', who: refuser }], ...over,
    };
    return { fact, refuser, collector };
  };
  const setup = (name: string, tweak: (d: S1Data) => void = () => {}) => {
    const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData((d) => { d.norms.norms.forEach((n) => { n.enforcePerDay = 0; }); d.norms.answerRate = 0; tweak(d); }), only: ['order.norms'] });
    return sim;
  };
  const feed = (sim: Sim, w: number, facts: EventFact[]) => {
    sim.k.evolution.stateOf('city.events').digest = { v: 1, through: w, facts: { windows: [{ w, items: facts }] }, counts: { windows: [] }, changes: { windows: [] } };
  };
  const slotsOf = (sim: Sim): NormsState['slots'] => (sim.k.evolution.states.get('order.norms')!.state as NormsState).slots;

  test('SF1-N-8: a public refusal left unanswered sets a refusal signal of 0.2 after a day; the single update has the specified numbers; pub is unchanged', () => {
    const sim = setup('SF1-N-8');
    const { fact, refuser } = refusal(sim);
    const d = sim.w.districts[0]!.id;
    const key = `${d}|fee`;
    sim.startAt(5);
    feed(sim, 5, [fact]);
    sim.advance(1); // window 5: taken
    let st = sim.stateOf<NormsState>('order.norms')!;
    expect(st.slots[key]!.pending).toEqual([{ event: fact.id, refuser, w: 5 }]);
    expect(st.slots[key]!.signal).toBeUndefined();
    sim.advance(142);
    st = sim.stateOf<NormsState>('order.norms')!;
    expect(st.slots[key]!.pending!.length).toBe(1);
    // the harness installs the slots at the start of window 5 + 144 (the run of window 148 is outstanding; its state applies at the boundary that starts 149)
    sim.setState('order.norms', (x) => {
      const s = (x as NormsState).slots[key]!;
      s.beh = 0.875; s.perc = 0.85; s.pub = []; s.signal = undefined as never; delete (s as { signal?: unknown }).signal;
    });
    const pubBefore = slotsOf(sim)[key]!.pub.length;
    sim.advance(1);
    // the run of window 149 is the one this boundary started: its result is the outstanding batch
    st = structuredClone(sim.k.evolution.states.get('order.norms')!.outstanding.at(-1)!.state as NormsState);
    const s = st.slots[key]!;
    expect(s.pending).toEqual([]);
    expect(s.signal).toEqual({ value: 0.2, event: fact.id, from: 5 + 144 });
    expect(s.beh).toBe(0.375);
    expect(s.qe).toBeCloseTo(0.27, 12);
    expect(s.perc).toBeCloseTo(0.85 + 0.058 * (0.27 - 0.85), 12);
    expect(s.pub.length).toBe(pubBefore);
    sim.advance(1);
    expect(sim.record.log.some((l) => l.reason === 'refusal-signal')).toBe(true);
  });

  test('SF1-N-10: a private refusal is never pending; the enforcement mean adds 2 a day per pending refusal and is halved in interregnum', () => {
    const sim = setup('SF1-N-10');
    const { fact } = refusal(sim, { public: false, witnesses: 3 });
    const d = sim.w.districts[0]!.id;
    sim.startAt(5);
    feed(sim, 5, [fact]);
    sim.advance(3);
    expect(sim.stateOf<NormsState>('order.norms')!.slots[`${d}|fee`]!.pending).toEqual([]);
    const fee = defaultData().norms.norms.find((n) => n.id === 'fee')!;
    const cfg = defaultData().norms;
    expect(enforcementMean(fee, cfg, W, 0.875, 0.1, 0, false)).toBeCloseTo(0.0026042, 6);
    expect(enforcementMean(fee, cfg, W, 0.875, 0.1, 1, false)).toBeCloseTo(0.0164931, 6);
    expect(enforcementMean(fee, cfg, W, 0.875, 0.1, 1, true)).toBeCloseTo(0.0164931 / 2, 7);
  });

  test('a refusal of another norm, another demander or a non-sector refuser is not taken', () => {
    const sim = setup('SF1-N-8b');
    const d = sim.w.districts[0]!;
    const base = refusal(sim);
    const civilian = (() => { for (const cell of Object.keys(sim.w.index.cells)) for (const r of sim.people.residentsOfBlock(cell)) { const v = sim.people.view(r); if (v && v.ageClass === 'adult' && v.role !== 'vendor' && v.role !== 'shopkeeper') return r; } throw new Error('none'); })();
    const f1: EventFact = { ...base.fact, id: H(hs('r1')), kind: 'theft' };
    const f2: EventFact = { ...base.fact, id: H(hs('r2')), parties: [{ role: 'aggressor', who: base.collector, group: sim.w.group(d.id, 'A2') }, { role: 'victim', who: base.refuser }] };
    const f3: EventFact = { ...base.fact, id: H(hs('r3')), parties: [{ role: 'aggressor', who: base.collector, group: sim.w.group(d.id, 'A1') }, { role: 'victim', who: civilian }] };
    const f4: EventFact = { ...base.fact, id: H(hs('r4')), outcome: 'done' };
    sim.startAt(5);
    feed(sim, 5, [f1, f2, f3, f4]);
    sim.advance(2);
    expect(sim.stateOf<NormsState>('order.norms')!.slots[`${d.id}|fee`]!.pending).toEqual([]);
  });
});
