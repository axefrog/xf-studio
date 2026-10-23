// SF1-M: the mirror and reconciliation against the offline replay port (S1 7.3, 8.8, 14.1).

import { describe, expect, test } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, id as hid, mintedId, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import type { MirrorDigest, MirrorState } from '../../src/sim/proc-mirror.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { quietData, seedOf } from './helpers.ts';

const W = 600;
const mirrorProc = processCause('city.mirror');
const adult = { alive: 'yes', 'age-class': 'adult' } as const;

const person = (key: string, aff: string, extra: Record<string, string> = {}): ReplayLine => ({ t: 0, op: 'person', key, slots: { affiliation: aff, ...adult, ...extra } });
const derivedOf = (raw: Id): Id => mintedId(mirrorProc, raw, 'mir');
const rawId = (sim: Sim, t: number, n = 0): Id => mintedId(sim.w.port, sim.w.port, `raw/${t}/${n}`);

function mirrorSim(name: string, only = ['city.mirror']): { sim: Sim; port: ReplayPort } {
  const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(), only });
  return { sim, port: new ReplayPort(sim) };
}

const participantsOf = (sim: Sim, id: Id): Array<{ who: Id; role: string }> => {
  const out: Array<{ who: Id; role: string }> = [];
  for (let i = 0; i < (sim.k.value(id, 'participants#count') as number); i++) {
    const m = sim.k.address(id, `participants[${i}]`);
    out.push({ who: sim.k.value(m, 'who') as Id, role: sim.k.value(m, 'role') as string });
  }
  return out;
};
const effectsOf = (sim: Sim, id: Id): Array<{ on: Id; effect: string }> => {
  const out: Array<{ on: Id; effect: string }> = [];
  for (let i = 0; i < (sim.k.value(id, 'effects#count') as number); i++) {
    const m = sim.k.address(id, `effects[${i}]`);
    out.push({ on: sim.k.value(m, 'on') as Id, effect: sim.k.value(m, 'effect') as string });
  }
  return out;
};

describe('SF1-M-1 and SF1-M-2: the derivation table; creator, cause and time', () => {
  const { sim, port } = mirrorSim('SF1-M-1');
  const k = sim.k;
  port.submit([
    person('ga1', 'GA'), person('gb1', 'GB'), person('civ1', 'civilian'), person('cop1', 'ncpd'), person('civ2', 'civilian'),
    { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'fx_d1' },
    { t: 700, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'ga1', role: 'victim' }, { who: 'gb1', role: 'actor' }], effects: [{ on: 'ga1', effect: 'kill' }], witnesses: 1 },
    { t: 800, op: 'event', kind: 'game.death', place: 'c2', participants: [{ who: 'civ1', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'civ1', effect: 'kill' }], witnesses: 3 },
    { t: 900, op: 'event', kind: 'game.death', place: 'c2', participants: [{ who: 'civ2', role: 'victim' }], effects: [{ on: 'civ2', effect: 'kill' }], witnesses: 0 },
    { t: 1000, op: 'event', kind: 'game.heat.3', participants: [] },
    { t: 1100, op: 'event', kind: 'game.combat.start', place: 'c3', participants: [{ who: 'ga1', role: 'hostile' }, { who: 'civ1', role: 'hostile' }, { who: 'civ2', role: 'hostile' }] },
    { t: 1200, op: 'event', kind: 'game.combat.start', place: 'c3', participants: [{ who: 'cop1', role: 'hostile' }] },
    { t: 1300, op: 'event', kind: 'game.combat.start', place: 'c3', participants: [{ who: 'civ1', role: 'hostile' }] },
    { t: 1400, op: 'event', kind: 'game.combat.end', place: 'c3', participants: [] },
    { t: 1500, op: 'event', kind: 'game.district', participants: [] },
    { t: 1600, op: 'event', kind: 'game.heat.2', participants: [] },
    { t: 1700, op: 'event', kind: 'game.heat.4', participants: [] },
  ]);
  sim.advance(6);
  const dKind = (t: number): string | undefined => {
    const id = derivedOf(rawId(sim, t));
    return k.store.header(id) ? (k.value(id, 'kind') as string) : undefined;
  };
  const dSize = (t: number): number | undefined => {
    const f = sim.digestOf<MirrorDigest>('city.mirror')!.facts.windows.flatMap((w) => w.items).find((x) => x.id === derivedOf(rawId(sim, t)));
    return f?.size;
  };

  test('a death: gang clash when both are gang and different, size 2 for a group victim; else assault, size 2 with three witnesses', () => {
    expect(dKind(700)).toBe('gang-clash');
    expect(dSize(700)).toBe(2);
    expect(dKind(800)).toBe('assault');
    expect(dSize(800)).toBe(2);
    expect(dKind(900)).toBe('assault');
    expect(dSize(900)).toBe(1);
    const d = derivedOf(rawId(sim, 800));
    const civ = H(hs('game'), hs('civ1'));
    expect(participantsOf(sim, d)).toEqual([{ who: civ, role: 'victim' }, { who: sim.w.v, role: 'aggressor' }]);
    expect(effectsOf(sim, d)).toEqual([{ on: civ, effect: 'kill' }]);
    expect(k.value(d, 'witnesses#count')).toBe(3);
  });

  test('heat: a rise gives a police action (size 2 from stage 3) in V\'s district; a fall gives none and sets lastHeat', () => {
    expect(dKind(1000)).toBe('police-action');
    expect(dSize(1000)).toBe(2);
    expect(k.value(derivedOf(rawId(sim, 1000)), 'place')).toBe(sim.w.districts[0]!.id);
    expect(dKind(1600)).toBeUndefined();
    expect(dKind(1700)).toBe('police-action');
    expect(dSize(1700)).toBe(2);
  });

  test('combat start: a gang clash with a gang hostile, a police action with an ncpd hostile, else assault; size 2 from three hostiles; combat end and district give none', () => {
    expect(dKind(1100)).toBe('gang-clash');
    expect(dSize(1100)).toBe(2);
    expect(dKind(1200)).toBe('police-action');
    expect(dKind(1300)).toBe('assault');
    expect(dSize(1300)).toBe(1);
    expect(dKind(1400)).toBeUndefined();
    expect(dKind(1500)).toBeUndefined();
    expect(participantsOf(sim, derivedOf(rawId(sim, 1100))).map((p) => p.role)).toEqual(['hostile', 'hostile', 'hostile']);
    expect(effectsOf(sim, derivedOf(rawId(sim, 1100)))).toEqual([]);
  });

  test('SF1-M-2: creator proc(city.mirror), causes [raw], the raw time, the Id H(mint, proc, raw, "mir")', () => {
    const raw = rawId(sim, 800);
    const d = derivedOf(raw);
    expect(d).toBe(H(hs('mint'), hid(mirrorProc), hid(raw), hs('mir')));
    const h = k.store.header(d)!;
    expect(h.origin).toEqual({ by: 'minted', creator: mirrorProc, cause: raw, name: 'mir' });
    expect(k.value(d, 'causes#count')).toBe(1);
    expect(k.value(d, 'causes[0]')).toBe(raw);
    expect(k.value(d, 'time')).toBe(800);
    expect(k.value(raw, 'kind')).toBe('game.death');
    expect(sim.stateOf<MirrorState>('city.mirror')!.lastHeat).toBe(4);
  });
});

describe('SF1-M-1, the journal rows: a finished or failed entry gives a gig-outcome and raises its district\'s counters', () => {
  test('finished: done, family gig; failed: failed, family hustle; the derived event cites the entry and is size 1', () => {
    const { sim, port } = mirrorSim('SF1-M-1j');
    const district = sim.w.districts[0]!.id;
    port.submit([
      { t: 0, op: 'reading', node: 'journal:g1', slot: 'family', value: 'gig' },
      { t: 0, op: 'reading', node: 'journal:g1', slot: 'district', value: district },
      { t: 0, op: 'reading', node: 'journal:h1', slot: 'family', value: 'hustle' },
      { t: 0, op: 'reading', node: 'journal:h1', slot: 'district', value: district },
      { t: 700, op: 'event', kind: 'game.journal.finished', participants: [{ who: 'journal:g1', role: 'entry' }] },
      { t: 800, op: 'event', kind: 'game.journal.failed', participants: [{ who: 'journal:h1', role: 'entry' }] },
    ]);
    sim.advance(5);
    const ok = derivedOf(rawId(sim, 700));
    const bad = derivedOf(rawId(sim, 800));
    expect(sim.k.value(ok, 'kind')).toBe('gig-outcome');
    expect(sim.k.value(ok, 'outcome')).toBe('done');
    expect(sim.k.value(bad, 'kind')).toBe('gig-outcome');
    expect(sim.k.value(bad, 'outcome')).toBe('failed');
    expect(participantsOf(sim, ok)).toEqual([{ who: port.node('journal:g1'), role: 'entry' }]);
    const facts = sim.digestOf<MirrorDigest>('city.mirror')!.facts.windows.flatMap((w) => w.items);
    expect(facts.find((f) => f.id === ok)!.size).toBe(1);
    expect(sim.stateOf<MirrorState>('city.mirror')!.counters[district]).toEqual({ gig: 1, hustle: 1, failed: 1 });
    // a derived event never refused by the gate and drawing no offspring: the mirror feeds only the facts
    expect(sim.record.log.filter((e) => e.kind === 'gate').length).toBe(0);
  });
});

describe('SF1-M-3: a raw death; save before and after; exempt from the gate and admission', () => {
  test('one derived event with the raw event as cause, even for a minor victim, identical after a reload', () => {
    const lines: ReplayLine[] = [
      person('kid', 'civilian', { 'age-class': 'minor' }), person('civ', 'civilian'),
      { t: 700, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'kid', role: 'victim' }, { who: 'civ', role: 'actor' }], effects: [{ on: 'kid', effect: 'kill' }], witnesses: 2 },
    ];
    const run = (saveEarly: boolean) => {
      const { sim, port } = mirrorSim('SF1-M-3');
      port.submit(lines);
      if (saveEarly) {
        sim.advance(1);
        sim.k.persistence.save('A');
        sim.advance(2);
        sim.k.persistence.load('A');
        // after a load the game's feed starts again from a fresh port: the queue and the readings are not part of the save, so the
        // game restates what it knows now (stamped at the loaded time) and sends what has not happened yet
        const loadedAt = sim.windowStart(1);
        new ReplayPort(sim).submit(lines.map((l) => (l.t < loadedAt ? { ...l, t: loadedAt } : l)));
      }
      sim.advance(5);
      return sim;
    };
    const a = run(false);
    const b = run(true);
    const id = derivedOf(rawId(a, 700));
    for (const sim of [a, b]) {
      expect(sim.k.store.header(id)).toBeDefined();
      expect(sim.k.value(id, 'kind')).toBe('assault');
      expect(sim.record.log.filter((e) => e.kind === 'gate').length).toBe(0);
      expect(sim.k.store.idsOfKind('core:event').filter((x) => sim.k.store.header(x)?.origin.by === 'minted' && (sim.k.store.header(x)!.origin as { creator: Id }).creator === mirrorProc).length).toBe(1);
    }
    expect(b.k.value(id, 'time')).toBe(a.k.value(id, 'time'));
    expect(b.k.value(id, 'kind')).toBe(a.k.value(id, 'kind'));
    expect(b.stateOf<MirrorState>('city.mirror')!.seen).toEqual(a.stateOf<MirrorState>('city.mirror')!.seen);
  });
});

describe('SF1-M-6 and SF1-M-7: the cap and late raw events', () => {
  test('20 raw deaths in one window: 12 derived events, 8 cap-hit logged, the raw events remain', () => {
    const { sim, port } = mirrorSim('SF1-M-6');
    const lines: ReplayLine[] = [person('victim', 'civilian'), person('killer', 'civilian')];
    for (let i = 0; i < 20; i++) lines.push({ t: 700 + i, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'victim', role: 'victim' }, { who: 'killer', role: 'actor' }], effects: [{ on: 'victim', effect: 'kill' }] });
    port.submit(lines);
    sim.advance(3);
    const derived = sim.k.store.idsOfKind('core:event').filter((x) => (sim.k.store.header(x)?.origin as { creator?: Id } | undefined)?.creator === mirrorProc);
    expect(derived.length).toBe(12);
    expect(sim.record.log.filter((e) => e.reason === 'cap-hit').length).toBe(8);
    const raws = sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'game.death');
    expect(raws.length).toBe(20);
  });

  test('a raw event stamped three windows before it is applied is processed once and late-raw is logged', () => {
    const { sim, port } = mirrorSim('SF1-M-7');
    port.submit([person('victim', 'civilian'), person('killer', 'civilian')]);
    sim.advance(5);
    port.submit([{ t: 2 * W + 10, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'victim', role: 'victim' }, { who: 'killer', role: 'actor' }], effects: [{ on: 'victim', effect: 'kill' }] }]);
    sim.advance(4);
    expect(sim.record.log.filter((e) => e.reason === 'late-raw').length).toBe(1);
    const derived = derivedOf(rawId(sim, 2 * W + 10));
    expect(sim.k.store.header(derived)).toBeDefined();
    expect(sim.stateOf<MirrorState>('city.mirror')!.seen.filter((x) => x === rawId(sim, 2 * W + 10)).length).toBe(1);
  });
});

describe('SF1-M-4 and SF1-M-5: the game corrects what S1 assumed', () => {
  const build = (name: string) => {
    const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(), only: ['city.mirror'] });
    const port = new ReplayPort(sim);
    port.submit([person('mv', 'civilian', { 'quest-linked': 'no' }), person('other', 'civilian')]);
    sim.advance(2);
    const mv = port.node('mv');
    const k = sim.k;
    const d = sim.w.districts[0]!;
    k.frames.open({ actor: mv, level: 'goal', origin: mv, weight: 1, focus: { nodes: [d.cellIds[0]!], tier: 2 }, payload: { goal: { effects: [] } }, cause: mv });
    const circle = sim.w.circle(d.id);
    const member = k.addEdge({ type: 'core:member-of', from: mv, to: circle, cause: mv, attrs: { role: 'member', strength: 0.5, visibility: 'open', terms: 'standing' } });
    const tie = sim.tiePolicy.materialise(mv, sim.w.v);
    const other = port.node('other');
    k.beliefs.set({ believer: other, subject: mv, path: 'alive', value: 'yes', confidence: 1, evidence: [mv], source: { by: 'observed', event: mv }, formed: 0, refreshed: 0, memorable: true });
    return { sim, port, mv, member, tie, other };
  };

  test('SF1-M-4: the reading alive goes to no: the frames are abandoned, the membership and tie edges ended, the beliefs stand, one game-dead correction', () => {
    const { sim, port, mv, member, tie, other } = build('SF1-M-4');
    const k = sim.k;
    port.submit([{ t: sim.k.now + 10, op: 'reading', node: 'mv', slot: 'alive', value: 'no' }]);
    sim.advance(3);
    expect(k.frames.framesOf(mv).every((f) => f.status === 'abandoned')).toBe(true);
    expect(k.store.edges.get(member.id)!.valid.to).toBeDefined();
    expect(k.store.edges.get(tie.id)!.valid.to).toBeDefined();
    expect(k.beliefs.get(other, mv, 'alive')?.value).toBe('yes');
    expect(sim.record.log.filter((e) => e.reason === 'game-dead').length).toBe(1);
    expect(sim.reads.eval('divergence', [other, mv])).toBe('large');
  });

  test('SF1-M-5: loading a save from before the death with the game\'s state after it supersedes only what the game now contradicts', () => {
    const { sim, port, mv, member } = build('SF1-M-5');
    const k = sim.k;
    k.persistence.save('A');
    const beliefsBefore = k.beliefs.entries().length;
    k.persistence.load('A', { now: () => sim.k.now, readMirrored: () => [{ gameKey: 'mv', kind: 'xf:person', slot: 'alive', value: 'no' }] });
    expect(k.frames.framesOf(mv).every((f) => f.status === 'abandoned')).toBe(true);
    expect(k.store.edges.get(member.id)!.valid.to).toBeDefined();
    expect(k.beliefs.entries().length).toBe(beliefsBefore);
    expect(sim.record.log.filter((e) => e.reason === 'game-dead').length).toBe(1);
    // the same load again changes nothing more: nothing is left to supersede
    k.persistence.load('A', { now: () => sim.k.now, readMirrored: () => [{ gameKey: 'mv', kind: 'xf:person', slot: 'alive', value: 'no' }] });
    expect(sim.record.log.filter((e) => e.reason === 'game-dead').length).toBe(1);
    void port;
  });
});

describe('SF1-M-8: publication lag', () => {
  test('a raw death in window w and a simulated size-2 event 100 s later: the simulated one is published at the boundary ending w, the mirrored one at the boundary ending w + 1', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-M-8'), index: fx3Slice(), data: quietData(), only: ['city.events', 'city.mirror'] });
    const port = new ReplayPort(sim);
    const w = 10;
    const T = w * W + 100;
    sim.startAt(w);
    port.submit([
      person('victim', 'civilian'), person('killer', 'civilian'),
      { t: T, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'victim', role: 'victim' }, { who: 'killer', role: 'actor' }], effects: [{ on: 'victim', effect: 'kill' }], witnesses: 3 },
    ]);
    sim.setState('city.events', (st) => {
      const d = sim.w.districts[0]!;
      const cal = ((st as { calendar: Record<Id, unknown[]> }).calendar[d.id] ??= []);
      const parent = H(hs('lag-parent'));
      cal.push({ parent, index: 0, due: w, kind: 'accident', size: 2, cell: d.cellIds[0]!, modBirth: 1, parentFacts: { id: parent, kind: 'accident', size: 2, w: w - 1, time: (w - 1) * W, cell: d.cellIds[0]!, gen: 0, chain: [] } });
    });
    const simEvent = mintedId(processCause('city.events'), H(hs('lag-parent')), 'child/0');
    const mirrored = derivedOf(mintedId(sim.w.port, sim.w.port, `raw/${T}/0`));
    const seen: Record<string, number> = {};
    for (let b = w; b <= w + 4; b++) {
      sim.k.settle({ to: b * W + 1 });
      if (sim.k.store.header(simEvent) && seen.sim === undefined) seen.sim = b;
      if (sim.k.store.header(mirrored) && seen.mir === undefined) seen.mir = b;
    }
    // the run for window w applies at boundary w + 1; the mirror derives from raw events applied at its own window's start, one window later
    expect(seen.sim).toBe(w + 1);
    expect(seen.mir).toBe(w + 2);
  });
});
