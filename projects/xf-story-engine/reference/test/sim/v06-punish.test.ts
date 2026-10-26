// S1 v0.6 D-30 (S1 7.8.1, 8.9, 7.9, 6): a group's grievance against V, the intention it may start from it, its rungs and bounds, the gate, an encounter
// and the endings (SF1-D-1 to SF1-D-10).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { processCause } from '../../src/evolution.ts';
import type { Belief } from '../../src/beliefs.ts';
import { Gate, type GateEnv } from '../../src/sim/gate.ts';
import type { Occurrence } from '../../src/sim/occ.ts';
import { actsOf, goalsDigest, groupDigest, minted, procDraw, startHunt } from './hunt-helpers.ts';
import { bigSim, watchChanges, W } from './goals-helpers.ts';

setDefaultTimeout(180_000);
const FULL = process.env.S1_FULL === '1';

const against = (b: Belief[]): Belief[] => b.filter((x) => x.path === 'against');

describe('SF1-D-1: grounds from an act', () => {
  test('a GA member killed by V, 6 witnesses, public: GA believes it (observed, 0.9, sev 0.8125), a belief change, a grudge entry, a latched retribution-v pulse with the belief as source', () => {
    const h = startHunt({ name: 'SF1-D-1', delay: null });
    const changes = watchChanges(h.sim);
    h.step(10);
    const { sim, GA } = h;
    const beliefs = against(sim.k.beliefs.activeOf(GA));
    expect(beliefs).toHaveLength(1);
    const b = beliefs[0]!;
    expect(b).toMatchObject({ believer: GA, subject: sim.w.v, path: 'against', confidence: 0.9, memorable: true, salience: 3, source: { by: 'observed' } });
    // its value and evidence are the canonical origin: the raw death the mirror re-described
    const raw = sim.k.store.idsOfKind('core:event').find((x) => sim.k.value(x, 'kind') === 'game.death')!;
    expect(b.value).toBe(raw);
    expect(b.evidence).toEqual([raw]);
    expect(changes.some((c) => c.c === 'belief' && c.believer === GA && c.path === 'against' && c.op === 'set')).toBe(true);
    const entry = sim.record.grudges.find((e) => e.group === GA)!;
    expect(entry).toMatchObject({ belief: b.id, act: raw, sev: 0.8125, op: 'set', pub: true });
    // sev = q64(min(1, 0.6 x 1.5) x 0.9) = 0.8125, and U = 0.8 x sev at once
    const U = groupDigest(sim).groups[GA]!.U.retribution!;
    expect(U).toBeGreaterThan(0.64);
    expect(U).toBeLessThanOrEqual(0.8 * 0.8125);
    const st = sim.stateOf<{ groups: Record<Id, { pulse: Record<string, { src?: Id; latched: boolean }> }> }>('group.decide')!;
    expect(st.groups[GA]!.pulse['retribution-v']).toMatchObject({ latched: true, src: b.id });
  });

  test('the same act held twice makes one grievance; an act that fell on no member of the group makes none', () => {
    const h = startHunt({ name: 'SF1-D-1b', delay: null });
    h.step(10);
    expect(against(h.sim.k.beliefs.activeOf(h.GA))).toHaveLength(1);
    expect(h.sim.record.grudges.filter((e) => e.op === 'set')).toHaveLength(1);
    // the other group holds no grievance: V did nothing to its members
    const GB = h.sim.w.group(h.sim.w.districts[0]!.id, 'A2');
    expect(against(h.sim.k.beliefs.activeOf(GB))).toHaveLength(0);
  });
});

describe('SF1-D-3: start', () => {
  test('at restless: the hazard is 0.02 x 1.5 x 1.5 = 0.045 a window; the start is a decide.punish with V as its object, rung 1, expiring 1,009 windows on; one warn duty posted at the death\'s cell by day and evening; its first act is a warning the gate passes', () => {
    const h = startHunt({ name: 'SF1-D-3', delay: null });
    const { sim, GA } = h;
    let started: number | undefined;
    const idleWindows: number[] = [];
    for (let i = 0; i < 400 && started === undefined; i++) {
      const before = groupDigest(sim)?.groups[GA];
      if (before?.intent === 'idle' && before.seats[0]!.holder !== null && (before.U.retribution ?? 0) > 0.3) idleWindows.push(sim.windowNow());
      h.step(1);
      if (groupDigest(sim).groups[GA]!.active?.name === 'punish') started = sim.windowNow() - 1;
    }
    expect(started).toBeDefined();
    const w0 = started!;
    // the hazard draw: below 0.045 in the window it started in, and at or above it in every window before (while the pulse was held)
    const draw = (w: number): number => procDraw(sim, 'group.decide', w, hs('punish'), hid(GA));
    expect(draw(w0)).toBeLessThan(0.045);
    const before = idleWindows.filter((w) => w !== w0);
    for (const w of before) expect(draw(w)).toBeGreaterThanOrEqual(0.045);
    const decision = H(hs('mint'), hid(processCause('group.decide')), hid(GA), hs(`decide/punish/${w0}`));
    const active = groupDigest(sim).groups[GA]!.active!;
    expect(active).toMatchObject({ name: 'punish', id: decision, rung: 1, entry: 1, since: w0 + 1, until: w0 + 1 + 1008 });
    expect(sim.k.value(decision, 'kind')).toBe('decide.punish');
    const view = sim.policies.viewEvent(decision)!;
    expect(view.participants).toContainEqual({ who: sim.w.v, role: 'object' });
    expect(view.participants.some((p) => p.role === 'decider')).toBe(true);
    // a `warn` duty, posted at the death's cell, in the day and the evening
    h.step(4);
    const warn = goalsDigest(sim).goals.filter((g) => g.duty === 'warn');
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ kind: 'carry-out', acts: ['warning'], target: sim.w.v, punish: { group: GA, intent: decision, rung: 1 }, post: { cell: h.cell, periods: [1, 2] } });
    expect(sim.k.frames.frame(warn[0]!.id)!.payload.goal!.effects).toEqual([{ on: sim.w.v, effect: 'meet' }]);
    // the first act with V as its object is a warning
    let acts = actsOf(sim);
    for (let i = 0; i < 200 && acts.length === 0; i++) {
      h.step(1);
      acts = actsOf(sim);
    }
    expect(acts[0]!.kind).toBe('warning');
    expect(acts[0]!.punish).toMatchObject({ group: GA, intent: decision, rung: 1 });
    expect(acts[0]!.causes).toContain(decision);
    const ev = sim.policies.viewEvent(acts[0]!.id)!;
    expect(ev.participants).toContainEqual({ who: sim.w.v, role: 'warned' });
    expect(ev.effects).toEqual([]);
  });
});

describe('SF1-D-4: no climb unperceived', () => {
  const fast = (d: import('../../src/sim/data.ts').S1Data): void => { d.goals.rate.warning = 500; d.goals.rate.price = 500; d.goals.rate.search = 500; };

  test('with no observed pin the intention stays at rung 1 and harms no one, and ends expired with a relent.punish', () => {
    const h = startHunt({ name: 'SF1-D-4a', delay: null, tweak: (d) => { fast(d); d.groups.punish.tempo.restless.duration = FULL ? 400 : 120; } });
    h.step(FULL ? 520 : 240);
    const { sim, GA } = h;
    const acts = actsOf(sim);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => a.kind === 'warning')).toBe(true);
    expect(minted(sim, 'confront')).toHaveLength(0);
    // it expired: a relent.punish with V as the object, and the cooling of 288 windows
    const relent = minted(sim, 'relent.punish');
    expect(relent).toHaveLength(1);
    expect(sim.policies.viewEvent(relent[0]!)!.participants).toContainEqual({ who: sim.w.v, role: 'object' });
    expect(sim.record.log.some((e) => e.reason === 'intent-end' && e.key?.endsWith('|punish|expired'))).toBe(true);
    expect(groupDigest(sim).against[GA]).toBeNull();
  });

  test('with the warning observed, after the dwell a climb is possible each window with chance 0.05 x 1.5; rung 2 opens a price warner and one searcher', () => {
    const h = startHunt({ name: 'SF1-D-4b', delay: 20, tweak: (d) => { fast(d); d.groups.punish.climbP = 1 / 0.075 * 0.5; } });
    const { sim, GA } = h;
    h.step(FULL ? 400 : 240);
    const a = groupDigest(sim).groups[GA]!.active;
    expect(a?.rung).toBeGreaterThanOrEqual(2);
    const kinds = new Set(actsOf(sim).map((x) => x.kind));
    expect(kinds.has('warning')).toBe(true);
    expect(kinds.has('price')).toBe(true);
    // no price or search before a warning of the intention was observed
    const warning = actsOf(sim).find((x) => x.kind === 'warning')!;
    const firstHarm = actsOf(sim).find((x) => x.kind === 'price' || x.kind === 'search')!;
    expect(firstHarm.w).toBeGreaterThanOrEqual(warning.w + 20);
    const duties = goalsDigest(sim).goals.map((g) => g.duty).sort();
    expect(duties).toContain('search');
  });
});

describe('SF1-D-5: reach follows tempo', () => {
  const quick = (d: import('../../src/sim/data.ts').S1Data): void => {
    d.goals.rate.warning = 500; d.goals.rate.price = 500; d.goals.rate.search = 500;
    d.groups.punish.rungDwell = 10; d.groups.punish.climbP = 100;
  };

  test('off never starts; calm never above rung 1; steady never above rung 2', () => {
    const rungsOf = (tempo: 'off' | 'calm' | 'steady'): { started: boolean; max: number } => {
      const h = startHunt({ name: `SF1-D-5-${tempo}`, tempo, delay: 5, tweak: quick });
      let max = 0;
      let started = false;
      for (let i = 0; i < (FULL ? 700 : 240); i++) {
        h.step(1);
        const a = groupDigest(h.sim).groups[h.GA]!.active;
        if (a?.name === 'punish') {
          started = true;
          max = Math.max(max, a.rung ?? 0);
        }
      }
      return { started, max };
    };
    expect(rungsOf('off')).toEqual({ started: false, max: 0 });
    expect(rungsOf('calm').max).toBe(1);
    expect(rungsOf('steady').max).toBe(2);
  });

  test('a rung-3 intention drops to rung 1 when tempo falls to calm (the search duties end), and ends `setting` at off', () => {
    const h = startHunt({ name: 'SF1-D-5-drop', delay: 5, tweak: quick });
    const { sim, GA } = h;
    for (let i = 0; i < 600 && (groupDigest(sim)?.groups[GA]!.active?.rung ?? 0) < 3; i++) h.step(1);
    expect(groupDigest(sim).groups[GA]!.active?.rung).toBe(3);
    expect(goalsDigest(sim).goals.some((g) => g.duty === 'search')).toBe(true);
    const entry = groupDigest(sim).groups[GA]!.active!.entry!;
    sim.k.settings.set({ tempo: 'calm' });
    h.step(3);
    const dropped = groupDigest(sim).groups[GA]!.active!;
    expect(dropped.rung).toBe(1);
    expect(dropped.entry).toBe(entry + 1);
    expect(goalsDigest(sim).goals.some((g) => g.duty === 'search')).toBe(false);
    sim.k.settings.set({ tempo: 'off' });
    h.step(3);
    expect(groupDigest(sim).groups[GA]!.active).toBeNull();
    expect(sim.record.log.some((e) => e.reason === 'intent-end' && e.key?.endsWith('|punish|setting'))).toBe(true);
    expect(minted(sim, 'relent.punish')).toHaveLength(1);
  });
});

describe('SF1-D-6: the gate (S1 6 step 3)', () => {
  // the gate reads the snapshot's intentions, the belief a grievance rests on and the observed pins: a stand-in for a world where
  // the intention `I` of group `G` is active at rung 2 and its warning `wn` was seen
  const G = H(hs('G')), I = H(hs('I')), wn = H(hs('warning')), other = H(hs('other-intent'));
  const sim0 = bigSim('SF1-D-6', undefined, ['city.events']);
  const h = { sim: sim0 };
  const v = h.sim.w.v;
  const gate = new Gate(h.sim.w, h.sim.people);
  const settings = (tempo: 'calm' | 'steady' | 'restless' | 'off' = 'restless') => ({ ...h.sim.k.settings.current(), tempo });
  const mk = (over: Partial<Occurrence>): Occurrence => ({ kind: 'search', origin: 'sim', size: 1, window: 5, participants: [{ who: H(hs('searcher')), role: 'searcher' }, { who: v, role: 'sought' }], effects: [], creator: H(hs('c')), ...over });
  const env = (observed: boolean, rung: 1 | 2 | 3 = 2): GateEnv => ({
    intent: (g) => (g === G ? { id: I, rung, grounds: H(hs('grounds')), warnings: [wn] } : undefined),
    held: () => true,
    observedAt: (n) => (observed && n === wn ? 100 : undefined),
  });
  const punish = (intent = I, rung: 1 | 2 | 3 = 2) => ({ group: G, intent, rung });

  test('a search with sought V and no punish; one with punish but no observed warning; a warning naming an intention not active; a confront at rung 2 are v-object; an assault with V as victim is v-target', () => {
    const real = h.sim.w.districts[0]!.cellIds[0]!;
    // adult searchers: the floors pass, so the V clauses are what is tested
    const adult = (n: number): Id => h.sim.people.residentAt(real, n);
    const people = Array.from({ length: 10 }, (_, i) => adult(i)).filter((r) => h.sim.people.view(r)!.ageClass === 'adult');
    const s = (kind: string, role: string, extra: Partial<Occurrence> = {}): Occurrence => mk({ kind, participants: [{ who: people[0]!, role: kind === 'confront' ? 'confronter' : kind === 'warning' || kind === 'price' ? 'warner' : 'searcher' }, { who: v, role }], ...extra });
    expect(gate.produce(s('search', 'sought'), settings(), 2000, env(true))).toEqual({ ok: false, reason: 'v-object' });
    expect(gate.produce(s('search', 'sought', { punish: punish() }), settings(), 2000, env(false))).toEqual({ ok: false, reason: 'v-object' });
    expect(gate.produce(s('warning', 'warned', { punish: punish(other, 1) }), settings(), 2000, env(true, 1))).toEqual({ ok: false, reason: 'v-object' });
    expect(gate.produce(s('confront', 'confronted', { punish: punish(I, 3) }), settings(), 2000, env(true, 2))).toEqual({ ok: false, reason: 'v-object' });
    expect(gate.produce(mk({ kind: 'assault', participants: [{ who: people[0]!, role: 'aggressor' }, { who: v, role: 'victim' }], effects: [{ on: v, effect: 'harm' }] }), settings(), 2000, env(true))).toEqual({ ok: false, reason: 'v-target' });
    // and the same acts pass when every condition holds: the intention active at that rung, its warning seen, tempo within reach
    expect(gate.produce(s('search', 'sought', { punish: punish() }), settings('restless'), 2000, env(true))).toEqual({ ok: true });
    expect(gate.produce(s('warning', 'warned', { punish: punish(I, 1) }), settings('calm'), 2000, env(false, 1))).toEqual({ ok: true });
    // tempo off, or the rung above the cap tempo sets, refuses them
    expect(gate.produce(s('search', 'sought', { punish: punish() }), settings('off'), 2000, env(true))).toEqual({ ok: false, reason: 'v-object' });
    expect(gate.produce(s('search', 'sought', { punish: punish() }), settings('calm'), 2000, env(true))).toEqual({ ok: false, reason: 'v-object' });
  });
});
