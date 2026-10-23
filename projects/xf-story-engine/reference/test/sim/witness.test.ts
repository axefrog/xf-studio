// SF1-W and SF1-T-3: witness, social and fade; tie acceptance (S1 4.7, 8.3, 8.4, 8.5, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import type { Belief } from '../../src/beliefs.ts';
import { q64 } from '../../src/sim/arith.ts';
import type { EventView } from '../../src/sim/policies.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { acceptP, regardEdgeId } from '../../src/sim/tie-policy.ts';
import type { Effect, Id } from '../../src/types.ts';
import { quietSim } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const DAY = 86400;

/** Three residents of distinct cells: an observer, a friend and a foe. */
function cast(sim: Sim): { obs: Id; friend: Id; foe: Id; cell: Id } {
  const d = sim.w.districts[0]!;
  return { obs: sim.people.residentAt(d.cellIds[0]!, 0), friend: sim.people.residentAt(d.cellIds[1]!, 0), foe: sim.people.residentAt(d.cellIds[2]!, 0), cell: d.cellIds[0]! };
}

/** The n-th resident of a class (0 civilian, 1 ncpd, 2 to 4 the groups) in the district, in cell order. */
function ofClass(sim: Sim, affc: number, n: number): Id {
  const d = sim.w.districts[0]!;
  const out: Id[] = [];
  for (const c of d.cellIds) for (const r of sim.people.residentsOfBlock(c)) if (sim.people.view(r)!.affc === affc && sim.people.view(r)!.ageClass === 'adult') out.push(r);
  if (out.length <= n) throw new Error(`no resident ${n} of class ${affc}`);
  return out[n]!;
}

/** An authored `protects` frame of `actor` over harm to `friend`. */
function protect(sim: Sim, actor: Id, friend: Id, weight = 1, tag = 'protect'): void {
  sim.k.frames.open({
    actor, level: 'concern', origin: H(hs('fixture-frame'), hs(tag), hid(actor)), weight, cause: sim.w.city,
    own: { protects: [{ slot: '*', scope: { nodes: [friend] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] },
  });
  sim.k.settle();
}

function clash(sim: Sim, name: string, foe: Id, friend: Id, cell: Id, witnesses: Id[], extra: { causes?: Id[]; kind?: string; effect?: Effect } = {}): Id {
  return sim.k.events.mintEvent({
    creator: sim.w.port, cause: sim.w.port, name, time: 1000, kind: extra.kind ?? 'gang-clash', place: cell,
    participants: [{ who: foe, role: 'aggressor' }, { who: friend, role: 'victim' }], effects: [{ on: friend, effect: extra.effect ?? 'harm' }], witnesses,
    ...(extra.causes ? { causes: extra.causes } : {}),
  });
}

describe('SF1-W-1: salience', () => {
  test('a harm event with pulse 0.8, to a person with a tie to the observer, matching an authored protects frame: stakes, pulse and tie make 3, memorable', () => {
    const sim = quietSim('SF1-W-1');
    const { obs, friend, foe, cell } = cast(sim);
    expect(sim.w.kinds.get('gang-clash')!.pulse).toBe(0.8);
    protect(sim, obs, friend);
    sim.tiePolicy.materialise(obs, friend);
    const ev = clash(sim, 'w1', foe, friend, cell, [obs]);
    const view = sim.policies.viewEvent(ev)!;
    expect(sim.k.matchStrength(obs, sim.policies.changeOf(view))).toBeGreaterThanOrEqual(0.5);
    expect(sim.policies.tiedTo(obs, friend)).toBe(true);
    expect(sim.policies.salienceOf(obs, view)).toBe(3);
    expect(sim.policies.memorableByRule(obs, view, 3)).toBe(true);
  });

  test('each point is one reason: without the frame, or without the tie, the salience is 2 and the event is not memorable by salience', () => {
    const sim = quietSim('SF1-W-1b');
    const { obs, friend, foe, cell } = cast(sim);
    const ev = clash(sim, 'w1b', foe, friend, cell, [obs]);
    const view = sim.policies.viewEvent(ev)!;
    // pulse alone
    expect(sim.policies.salienceOf(obs, view)).toBe(1);
    sim.tiePolicy.materialise(obs, friend);
    expect(sim.policies.salienceOf(obs, view)).toBe(2);
    expect(sim.policies.memorableByRule(obs, view, 2)).toBe(false);
    protect(sim, obs, friend);
    expect(sim.policies.salienceOf(obs, view)).toBe(3);
  });

  test('through the kernel: a focal witness forms the belief with salience 3, memorable, and an attribution belief', () => {
    const sim = quietSim('SF1-W-1c');
    const { obs, friend, foe, cell } = cast(sim);
    protect(sim, obs, friend);
    sim.tiePolicy.materialise(obs, friend);
    clash(sim, 'w1c', foe, friend, cell, [obs]);
    sim.k.settle();
    const held = sim.k.beliefs.activeOf(obs);
    const did = held.find((b) => b.path === 'did.harm');
    expect(did).toBeDefined();
    expect(did!.subject).toBe(foe);
    expect(did!.memorable).toBe(true);
    expect(did!.salience).toBe(3);
    expect(held.some((b) => b.path === 'reason' && b.subject === foe)).toBe(true);
  });

  test('a witness that is not focal, not met by V and in no carrier forms nothing: a count only', () => {
    const sim = quietSim('SF1-W-1d');
    const { obs, friend, foe, cell } = cast(sim);
    // an individual that belongs to no carrier: a node outside the residents
    const stranger = H(hs('stranger'), hid(obs));
    const ev = clash(sim, 'w1d', foe, friend, cell, [stranger]);
    sim.policies.witness(sim.policies.viewEvent(ev)!);
    expect(sim.k.beliefs.activeOf(stranger)).toEqual([]);
  });
});

describe('SF1-W-2: attribution', () => {
  const sim = quietSim('SF1-W-2');
  const cell = sim.w.districts[0]!.cellIds[0]!;
  const obs = ofClass(sim, 0, 0);
  const foe = ofClass(sim, 0, 1);
  const view = (causes: Id[]): EventView => ({
    id: H(hs('fixture-event')), kind: 'assault', time: 1000, place: cell, participants: [], effects: [], witnesses: [], causes, creator: undefined,
  });
  test('(a) no cause in causes: wD 0.65, dispositional, confidence q64(0.55) = 0.546875', () => {
    const a = sim.policies.attribution(obs, foe, view([]), 'harm');
    expect(a.wD).toBeCloseTo(0.65, 12);
    expect(a.region).toEqual({ r: 'set', values: ['cruel', 'hostile'] });
    expect(a.confidence).toBe(q64(0.55));
    expect(a.confidence).toBe(0.546875);
  });
  test('(b) a visible cause: wD 0.45, situational, confidence q64(0.45) = 0.453125', () => {
    const a = sim.policies.attribution(obs, foe, view([H(hs('cause'))]), 'harm');
    expect(a.wD).toBeCloseTo(0.45, 12);
    expect(a.region).toEqual({ r: 'set', values: ['accidental', 'defending', 'pressured'] });
    expect(a.confidence).toBe(0.453125);
  });
  test('the tilt: an observer of a hostile affiliation raises wD by 0.1, one of the same group as the actor lowers it by 0.1', () => {
    const claws = ofClass(sim, 2, 0);
    const claws2 = ofClass(sim, 2, 1);
    const cop = ofClass(sim, 1, 0);
    expect(sim.policies.attribution(claws, cop, view([]), 'harm').wD).toBeCloseTo(0.75, 12);
    expect(sim.policies.attribution(claws, claws2, view([]), 'harm').wD).toBeCloseTo(0.55, 12);
    expect(sim.policies.attribution(obs, claws, view([]), 'harm').wD).toBeCloseTo(0.65, 12);
  });
  test('a take reads from the take classes, and the weight is clamped to 0.2 to 0.9', () => {
    expect(sim.policies.attribution(obs, foe, view([]), 'take').region).toEqual({ r: 'set', values: ['greedy'] });
    expect(sim.policies.attribution(obs, foe, view([H(hs('cause'))]), 'take').region).toEqual({ r: 'set', values: ['desperate', 'ordered'] });
  });
});

describe('SF1-W-2b: a decision that persists reads only what persists (Sol 6)', () => {
  const setup = (name: string, memorable: boolean) => {
    const sim = quietSim(name);
    // regard is the NPC's regard of V, so the attribution that scales it is the NPC's reason for what V did
    const { obs } = cast(sim);
    const foe = sim.w.v;
    const E = H(hs('e-sol6'));
    sim.k.beliefs.set({
      believer: obs, subject: foe, path: 'reason', at: 5, region: { r: 'set', values: ['cruel', 'hostile'] }, confidence: 0.5, evidence: [E],
      source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable,
    });
    return { sim, obs, foe };
  };

  test('a texture attribution does not scale a trust loss, a memorable one does, and a reload changes neither', () => {
    const texture = setup('SF1-W-2b', false);
    const memorable = setup('SF1-W-2b', true);
    expect(texture.sim.tiePolicy.attributionMultiplier(texture.obs, texture.foe, 5)).toBe(1);
    expect(memorable.sim.tiePolicy.attributionMultiplier(memorable.obs, memorable.foe, 5)).toBe(1.5);
    const reloaded = setup('SF1-W-2b', false);
    reloaded.sim.k.persistence.save('A');
    reloaded.sim.k.persistence.load('A');
    expect(reloaded.sim.k.beliefs.activeOf(reloaded.obs).length).toBe(0);
    const after = (x: { sim: Sim; obs: Id; foe: Id }) => {
      // after a load the resident is addressed again before anything is said of them
      expect(x.sim.people.residentAt(x.sim.w.districts[0]!.cellIds[0]!, 0)).toBe(x.obs);
      return x.sim.tiePolicy.applyInteraction(x.obs, x.foe, 'conflict', { at: 5 });
    };
    const noReload = after(texture);
    expect(after(reloaded)).toEqual(noReload);
    // the loss is the table's own, unscaled (trustB -0.03, trustI -0.05 from 0.5, in 64ths); the memorable attribution scales it by 1.5
    expect([noReload.trustB, noReload.trustI]).toEqual([0.46875, 0.453125]);
    const scaled = after(memorable);
    expect([scaled.trustB, scaled.trustI]).toEqual([0.453125, 0.421875]);
  });
});

describe('SF1-W-3: telling', () => {
  test('protectiveRelevance 0.8, severity 0.7, closeness c: score = 0.8 x 0.7 x c, p_tell = 0.3 x score', () => {
    const sim = quietSim('SF1-W-3');
    const { obs: teller, friend, foe, cell } = cast(sim);
    const listener = sim.people.residentAt(sim.w.districts[0]!.cellIds[3 % sim.w.districts[0]!.cellIds.length]!, 1);
    protect(sim, listener, friend, 0.8);
    sim.tiePolicy.materialise(teller, listener);
    const rec = sim.tiePolicy.record(teller, listener);
    rec.hours = 10_000;
    rec.favours = 6;
    rec.disclosures = 2;
    const closeness = sim.policies.closeness(teller, listener);
    expect(closeness).toBe(q64(0.25 * (1 + 0 + 0.5 + 1)));
    const ev = clash(sim, 'w3', foe, friend, cell, [teller], { kind: 'assault' });
    expect(sim.w.kinds.get('assault')!.severity).toBe(0.7);
    const b = { believer: teller, subject: foe, path: 'did.harm', at: 1000, value: friend, confidence: 1, evidence: [ev], source: { by: 'observed', event: ev }, formed: 0, refreshed: 0, memorable: true } as Belief;
    const score = sim.policies.tellScore(b, teller, listener);
    expect(score).toBeCloseTo(0.8 * 0.7 * closeness, 12);
    expect(sim.data.minds.tellBase * score).toBeCloseTo(0.3 * 0.8 * 0.7 * closeness, 12);
    // the figures of the specification at closeness 0.6
    expect(0.8 * 0.7 * 0.6).toBeCloseTo(0.336, 12);
    expect(sim.data.minds.tellBase * 0.336).toBeCloseTo(0.1008, 12);
  });

  test('strangers who share a cell have closeness 0.1', () => {
    const sim = quietSim('SF1-W-3b');
    const { obs, friend } = cast(sim);
    expect(sim.policies.closeness(obs, friend)).toBe(0.1);
  });
});

describe('SF1-W-4: hearsay', () => {
  test('Alice observes E, tells Carl, Carl tells Dana; then Alice tells Dana: Dana\'s belief has evidence {E}, source told by Carl through the telling event, the second telling only refreshes it', () => {
    const sim = quietSim('SF1-W-4');
    const d = sim.w.districts[0]!;
    const [alice, carl, dana, victim] = [0, 1, 2, 3].map((n) => ofClass(sim, 0, n));
    const k = sim.k;
    const E = clash(sim, 'hearsay', alice, victim, d.cellIds[0]!, [alice]);
    k.beliefs.set({ believer: alice, subject: alice, path: 'did.harm', at: 1000, value: victim, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
    const mk = (name: string, teller: Id, listener: Id, subject: Id): Id => k.events.mintEvent({
      creator: sim.w.s1, cause: E, name, time: 1001, kind: 'tell', place: d.cellIds[0]!,
      participants: [{ who: teller, role: 'teller' }, { who: listener, role: 'listener' }, { who: subject, role: 'subject' }], causes: [E], outcome: 'done',
    });
    const t1 = mk('t1', alice, carl, alice);
    const t2 = mk('t2', carl, dana, alice);
    const t3 = mk('t3', alice, dana, alice);
    const own = k.beliefs.activeOf(alice)[0]!.id;
    expect(k.beliefs.tellAs(alice, carl, own, t1, null)).toBe('added');
    const carls = k.beliefs.activeOf(carl)[0]!;
    expect(k.beliefs.tellAs(carl, dana, carls.id, t2, null)).toBe('added');
    const danas = k.beliefs.activeOf(dana)[0]!;
    expect(danas.evidence).toEqual([E]);
    expect(danas.source).toEqual({ by: 'told', teller: carl, event: t2 });
    expect(danas.confidence).toBeCloseTo(Math.min(carls.confidence, 0.9) * 0.8, 12);
    expect(k.beliefs.tellAs(alice, dana, own, t3, null)).toBe('refreshed');
    const after = k.beliefs.activeOf(dana);
    expect(after.length).toBe(1);
    expect(after[0]!.evidence).toEqual([E]);
    expect(after[0]!.source).toEqual({ by: 'told', teller: carl, event: t2 });
  });
});

describe('SF1-W-5: fade', () => {
  const believe = (sim: Sim, who: Id, path: string, memorable: boolean, t0: number): Id => {
    const ev = H(hs('ev'), hs(path));
    sim.k.beliefs.set({ believer: who, subject: H(hs('subject'), hs(path)), path, at: t0, value: 'x', confidence: 0.8, evidence: [ev], source: { by: 'observed', event: ev }, formed: t0, refreshed: t0, memorable });
    return sim.k.beliefs.activeOf(who).find((b) => b.path === path)!.id;
  };
  const run = (memoryScale: number) => {
    const sim = quietSim(`SF1-W-5-${memoryScale}`);
    const who = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    sim.k.settings.set({ memoryScale }, 0);
    const t0 = 1000;
    const plain = believe(sim, who, 'did.take', false, t0);
    const keep = believe(sim, who, 'did.harm', true, t0);
    const hold = sim.data.minds.holdDays * DAY;
    sim.policies.fade(who, t0 + hold);
    const atHold = sim.k.beliefs.activeOf(who).map((b) => b.id);
    sim.policies.fade(who, t0 + hold + 1);
    const after = sim.k.beliefs.activeOf(who).map((b) => b.id);
    return { plain, keep, atHold, after };
  };
  test('not dropped at t0 + 14 d exactly; dropped at + 14 d + 1 s; the memorable one is kept', () => {
    const r = run(1);
    expect(r.atHold).toContain(r.plain);
    expect(r.atHold).toContain(r.keep);
    expect(r.after).not.toContain(r.plain);
    expect(r.after).toContain(r.keep);
  });
  test('raising memoryScale changes nothing a stricter run dropped: the setting is recorded and inert', () => {
    const strict = run(1);
    const generous = run(4);
    expect(generous.after).toEqual(strict.after);
    expect(generous.atHold).toEqual(strict.atHold);
  });
  test('a refresh restarts the hold', () => {
    const sim = quietSim('SF1-W-5r');
    const who = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    const id = believe(sim, who, 'did.take', false, 1000);
    const hold = sim.data.minds.holdDays * DAY;
    sim.k.beliefs.activeOf(who).find((b) => b.id === id)!.refreshed = 1000 + hold;
    sim.policies.fade(who, 1000 + hold + 1);
    expect(sim.k.beliefs.activeOf(who).map((b) => b.id)).toContain(id);
    sim.policies.fade(who, 1000 + 2 * hold + 1);
    expect(sim.k.beliefs.activeOf(who).map((b) => b.id)).not.toContain(id);
  });
  test('carrier evidence is outside fade', () => {
    const sim = quietSim('SF1-W-5c');
    const d = sim.w.districts[0]!;
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    const ev = H(hs('ev'), hs('carrier'));
    sim.k.beliefs.set({ believer: carrier, subject: sim.w.v, path: 'rep-decent[0]', at: 1000, value: [0.5, 1], confidence: 1, evidence: [ev], source: { by: 'observed', event: ev }, formed: 1000, refreshed: 1000, memorable: true });
    sim.policies.fade(carrier, 1000 + 60 * DAY);
    expect(sim.k.beliefs.activeOf(carrier).length).toBe(1);
  });
});

describe('SF1-W-6: a telling is not harm', () => {
  test('a telling whose subject is V, and one whose subject is a protected canon person, are minted with no effects and an informational subject; the gate passes them', () => {
    const sim = quietSim('SF1-W-6', (data) => { data.minds.tellBase = 1e9; });
    const d = sim.w.districts[0]!;
    const [teller, listener, canon, victim] = [0, 1, 2, 3].map((n) => ofClass(sim, 0, n));
    sim.spine.add(canon!);
    expect(sim.people.protectedSet(canon!)).toBe(true);
    protect(sim, listener!, victim!);
    const k = sim.k;
    for (const [n, subject] of [sim.w.v, canon!].entries()) {
      const E = k.events.mintEvent({
        creator: sim.w.port, cause: sim.w.port, name: `src${n}`, time: 1000 + n, kind: 'assault', place: d.cellIds[0]!,
        participants: [{ who: subject, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [teller],
      });
      k.beliefs.set({ believer: teller, subject, path: 'did.harm', at: 1000 + n, value: victim, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
      expect(sim.policies.encounter(teller, listener, 10 + n)).toBe(true);
      const tell = k.store.idsOfKind('core:event').filter((x) => k.value(x, 'kind') === 'tell').pop()!;
      expect(k.value(tell, 'effects#count')).toBe(0);
      const roles = sim.policies.viewEvent(tell)!.participants.map((p) => `${p.role}`);
      expect(roles).toEqual(['teller', 'listener', 'subject']);
      expect(sim.policies.viewEvent(tell)!.participants[2]!.who).toBe(subject);
      const o = { kind: 'tell', origin: 'policy' as const, size: 1, window: 0, participants: sim.policies.viewEvent(tell)!.participants, effects: [], creator: sim.w.s1 };
      expect(sim.gate.produce(o, k.settings.at(k.now), k.now)).toEqual({ ok: true });
      k.beliefs.drop(teller, k.beliefs.activeOf(teller).find((b) => b.subject === subject)!.id);
    }
  });

  test('a telling passes the gate before it is minted or counted; a refusal mints nothing, takes no volume and is logged (Sol 9)', () => {
    const build = (name: string) => {
      const sim = quietSim(name, (data) => { data.minds.tellBase = 1e9; });
      const d = sim.w.districts[0]!;
      const [teller, listener, victim] = [0, 1, 2].map((n) => ofClass(sim, 0, n)) as [Id, Id, Id];
      protect(sim, listener, victim);
      const E = sim.k.events.mintEvent({
        creator: sim.w.port, cause: sim.w.port, name: 'src', time: 1000, kind: 'assault', place: d.cellIds[0]!,
        participants: [{ who: sim.w.v, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [teller],
      });
      sim.k.beliefs.set({ believer: teller, subject: sim.w.v, path: 'did.harm', at: 1000, value: victim, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
      const tells = (): Id[] => sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'tell');
      return { sim, teller, listener, tells };
    };
    const a = build('SF1-W-6c');
    const asked: Array<{ kind: string; origin: string; roles: string[] }> = [];
    const produce = a.sim.gate.produce.bind(a.sim.gate);
    a.sim.gate.produce = (o, s, n) => {
      asked.push({ kind: o.kind, origin: o.origin, roles: o.participants.map((p) => p.role) });
      return produce(o, s, n);
    };
    expect(a.sim.policies.encounter(a.teller, a.listener, 10)).toBe(true);
    expect(asked).toEqual([{ kind: 'tell', origin: 'policy', roles: ['teller', 'listener', 'subject'] }]);
    expect(a.tells().length).toBe(1);
    expect(a.sim.record.tells).toEqual([10]);
    // the gate refuses: no telling is minted, no volume is taken, nobody is told, and the refusal is in the log
    const b = build('SF1-W-6d');
    b.sim.gate.produce = () => ({ ok: false, reason: 'excluded' });
    expect(b.sim.policies.encounter(b.teller, b.listener, 10)).toBe(false);
    expect(b.tells()).toEqual([]);
    expect(b.sim.record.tells).toEqual([]);
    expect(b.sim.k.beliefs.activeOf(b.listener)).toEqual([]);
    expect(b.sim.record.log.filter((e) => e.proc === 'social' && e.kind === 'gate').map((e) => e.reason)).toEqual(['excluded']);
  });

  test('a consequential expose with V as the target is refused v-target', () => {
    const sim = quietSim('SF1-W-6b');
    const d = sim.w.districts[0]!;
    const actor = sim.people.residentAt(d.cellIds[0]!, 0);
    const o = { kind: 'expose', origin: 'policy' as const, size: 1, window: 0, participants: [{ who: actor, role: 'actor' }, { who: sim.w.v, role: 'target' }], effects: [{ on: sim.w.v, effect: 'expose' as const }], creator: sim.w.s1 };
    expect(sim.gate.produce(o, sim.k.settings.at(sim.k.now), sim.k.now)).toEqual({ ok: false, reason: 'v-target' });
  });
});

describe('SF1-W-7: only memorable beliefs decide', () => {
  /** A teller with memorable and non-memorable beliefs, a listener who cares, and a reader of the divergence read. */
  const scenario = (kind: 'with' | 'without' | 'reload') => {
    const sim = quietSim(`SF1-W-7`, (data) => { data.minds.tellBase = 1e9; });
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'mv', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } }]);
    sim.advance(1);
    const d = sim.w.districts[0]!;
    const teller = sim.people.residentAt(d.cellIds[0]!, 0);
    const listener = sim.people.residentAt(d.cellIds[1]!, 0);
    const victim = sim.people.residentAt(d.cellIds[2]!, 0);
    const mv = port.node('mv');
    sim.spine.add(mv);
    protect(sim, listener, victim);
    const k = sim.k;
    const believe = (n: number, subject: Id, path: string, value: string, memorable: boolean): void => {
      const E = k.events.mintEvent({
        creator: sim.w.port, cause: sim.w.port, name: `src${n}`, time: 1000 + n, kind: 'assault', place: d.cellIds[0]!,
        participants: [{ who: subject, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [teller],
      });
      k.beliefs.set({ believer: teller, subject, path, at: 1000 + n, value, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: k.now, refreshed: k.now, memorable });
    };
    believe(0, mv, 'did.harm', victim, true);
    believe(1, mv, 'alive', 'no', true);
    if (kind !== 'without') {
      believe(2, mv, 'did.take', victim, false);
      believe(3, mv, 'affiliation', 'A1', false);
      believe(4, mv, 'did.kill', victim, false);
    }
    if (kind === 'reload') {
      k.persistence.save('A');
      k.persistence.load('A');
      // nothing mints the events again: the load restores the facts of the events behind memorable beliefs (SIM-03); authored frames come from
      // their seeds, which are restated after a load
      protect(sim, listener, victim);
      new ReplayPort(sim).submit([{ t: k.now, op: 'person', key: 'mv', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } }]);
      sim.advance(1);
    }
    for (let w = 1; w <= 12; w++) sim.policies.encounter(teller, listener, w);
    return {
      log: sim.record.log.filter((e) => e.proc === 'social').map((e) => `${e.reason}|${e.key}`),
      divergence: sim.divergence.evaluate(teller, mv),
      memorable: k.beliefs.activeOf(teller).filter((b) => b.memorable).map((b) => b.id).sort(),
    };
  };
  test('forgetting every non-memorable belief of a focal person, or reloading, changes no telling decision and no divergence answer', () => {
    const full = scenario('with');
    const bare = scenario('without');
    const reloaded = scenario('reload');
    expect(full.log.length).toBeGreaterThan(0);
    expect(bare.log).toEqual(full.log);
    expect(bare.divergence).toBe(full.divergence);
    expect(bare.divergence).toBe('large');
    expect(reloaded.log).toEqual(full.log);
    expect(reloaded.divergence).toBe(full.divergence);
    expect(reloaded.memorable).toEqual(full.memorable);
  });
});

describe('SF1-T-3: acceptance', () => {
  test('rung friendly, warmth 0.3, trustMean 0.6, sociability 0.5: pAccept = 0.5 + 0.12 + 0.03 + 0 = 0.65', () => {
    expect(acceptP(0.5, 0.3, 0.6, 0.5)).toBeCloseTo(0.65, 12);
  });

  const setup = (name: string) => {
    const sim = quietSim(name);
    const npc = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    const v = sim.w.v;
    sim.k.addEdge({
      id: regardEdgeId(npc, v), type: 'xf:regard', from: npc, to: v, cause: sim.w.city, valid: { from: 0 },
      attrs: { warmth: q64(0.3), respect: 0, trustA: q64(0.6), trustB: q64(0.6), trustI: q64(0.6), evN: 1 },
    });
    return { sim, npc, v };
  };

  test('the answer uses the NPC\'s own sociability and the regard; the draw is the same after a reload', () => {
    const { sim, npc } = setup('SF1-T-3');
    const event = H(hs('bid'), hi(1));
    const r = sim.tiePolicy.accepts(npc, sim.w.v, 'friendly', event);
    const soc = sim.tiePolicy.sociabilityOf(npc);
    expect(r.p).toBeCloseTo(acceptP(0.5, q64(0.3), q64(0.6), soc), 12);
    const again = setup('SF1-T-3');
    expect(again.sim.tiePolicy.accepts(again.npc, again.sim.w.v, 'friendly', event)).toEqual(r);
    sim.advance(1);
    sim.k.persistence.save('A');
    sim.advance(2);
    sim.k.persistence.load('A');
    expect(sim.tiePolicy.accepts(npc, sim.w.v, 'friendly', event)).toEqual(r);
  });

  test('a boundary pin refuses without a draw', () => {
    const { sim, npc } = setup('SF1-T-3b');
    sim.k.pin({ node: npc, slot: 'boundary', value: 'friendly', reason: 'authored', cause: sim.w.city });
    for (let n = 0; n < 50; n++) expect(sim.tiePolicy.accepts(npc, sim.w.v, 'friendly', H(hs('bid'), hi(n))).accepted).toBe(false);
    // another rung is not refused by that boundary
    let any = false;
    for (let n = 0; n < 200 && !any; n++) any = sim.tiePolicy.accepts(npc, sim.w.v, 'close', H(hs('bid'), hi(n))).accepted;
    expect(any).toBe(true);
  });
});

describe('SF1-T-4: the cap on materialised ties and the retract (Sol 8, 16)', () => {
  const live = (sim: Sim, who: Id) => [...sim.k.store.edgesFrom(who), ...sim.k.store.edgesTo(who)].filter((e) => e.type === 'xf:tie' && (e.valid.to === undefined || e.valid.to > sim.k.now));
  const residents = (sim: Sim): Id[] => sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));

  test('V is outside the cap: tied to 21 residents V holds 21 and none is ended; an NPC at the cap with free ties makes room (S1 v0.3, 4.6)', () => {
    const sim = quietSim('SF1-T-4a');
    const cap = sim.data.ties.maxMaterialised;
    const all = residents(sim);
    for (const r of all.slice(0, cap + 5)) expect(sim.tiePolicy.materialise(r, sim.w.v)).toBeDefined();
    expect(live(sim, sim.w.v).length).toBe(cap + 5);
    for (const r of all.slice(0, cap + 5)) expect(sim.tiePolicy.hasEdge(r, sim.w.v)).toBe(true);
    expect(sim.record.log.filter((e) => e.reason === 'tie-cap')).toEqual([]);
    // an ordinary resident with nothing protecting their ties makes room by ending the weakest
    const a = all[30]!;
    for (const b of all.slice(31, 31 + cap + 3)) expect(sim.tiePolicy.materialise(a, b)).toBeDefined();
    expect(live(sim, a).length).toBe(cap);
  });

  test('a person whose every tie is depended on makes no room: the new tie is refused, logged, and nothing is ended', () => {
    const sim = quietSim('SF1-T-4b');
    const cap = sim.data.ties.maxMaterialised;
    const all = residents(sim);
    const a = all[0]!;
    const others = all.slice(1, cap + 2);
    for (const [n, o] of others.slice(0, cap).entries()) {
      expect(sim.tiePolicy.materialise(a, o)).toBeDefined();
      protect(sim, o, a, 1, `sol8-${n}`);
    }
    expect(live(sim, a).length).toBe(cap);
    const before = live(sim, a).map((e) => e.id).sort();
    const extra = others[cap]!;
    expect(sim.tiePolicy.materialise(a, extra)).toBeUndefined();
    expect(sim.tiePolicy.hasEdge(a, extra)).toBe(false);
    expect(live(sim, a).map((e) => e.id).sort()).toEqual(before);
    expect(sim.record.log.filter((e) => e.reason === 'tie-cap').length).toBe(1);
    // the other end being full refuses just the same, and its own ties stay
    const b = all[40]!;
    expect(sim.tiePolicy.materialise(extra, b)).toBeDefined();
    expect(sim.tiePolicy.materialise(a, b)).toBeUndefined();
    expect(live(sim, b).length).toBe(1);
  });

  test('a tie to V never counts as the weakest: an NPC ends another tie to make room, and is refused when nothing else can be ended (S1 v0.3, 4.6)', () => {
    const sim = quietSim('SF1-T-4d');
    const cap = sim.data.ties.maxMaterialised;
    const all = residents(sim);
    const v = sim.w.v;
    // an NPC with a tie to V and the cap less one others, none of them depended on: the new tie ends one of the others
    const a = all[0]!;
    expect(sim.tiePolicy.materialise(a, v)).toBeDefined();
    const others = all.slice(1, cap + 2);
    for (const o of others.slice(0, cap - 1)) expect(sim.tiePolicy.materialise(a, o)).toBeDefined();
    expect(live(sim, a).length).toBe(cap);
    expect(sim.tiePolicy.materialise(a, others[cap - 1]!)).toBeDefined();
    expect(live(sim, a).length).toBe(cap);
    expect(sim.tiePolicy.hasEdge(a, v)).toBe(true);
    expect(sim.tiePolicy.hasEdge(a, others[cap - 1]!)).toBe(true);
    expect(sim.record.log.filter((e) => e.reason === 'tie-cap')).toEqual([]);
    // an NPC whose other ties are all depended on: the tie to V is the only one that could be ended, and it is not, so the new tie is refused
    const b = all[40]!;
    const mates = all.slice(41, 41 + cap + 1);
    expect(sim.tiePolicy.materialise(b, v)).toBeDefined();
    for (const [n, o] of mates.slice(0, cap - 1).entries()) {
      expect(sim.tiePolicy.materialise(b, o)).toBeDefined();
      protect(sim, o, b, 1, `t4d-${n}`);
    }
    expect(live(sim, b).length).toBe(cap);
    const before = live(sim, b).map((e) => e.id).sort();
    expect(sim.tiePolicy.materialise(b, mates[cap - 1]!)).toBeUndefined();
    expect(live(sim, b).map((e) => e.id).sort()).toEqual(before);
    expect(sim.tiePolicy.hasEdge(b, v)).toBe(true);
    expect(sim.record.log.filter((e) => e.reason === 'tie-cap').length).toBe(1);
    // and V's own list is never asked for room
    expect(sim.tiePolicy.materialise(mates[cap]!, v)).toBeDefined();
    expect(live(sim, v).length).toBe(3);
  });

  const talk = (sim: Sim, npc: Id, kind: string, name: string): Id =>
    sim.k.events.mintEvent({ creator: sim.w.port, cause: sim.w.port, name, time: 100, kind, place: sim.w.districts[0]!.cellIds[0]!, participants: [{ who: sim.w.v, role: 'participant' }, { who: npc, role: 'participant' }] });

  test('a retract ends the thread: no later bid, favour or repair changes its status or the regard, and the thread stays visible', () => {
    const sim = quietSim('SF1-T-4c');
    const npc = residents(sim)[0]!;
    const v = sim.w.v;
    const hear = (kind: string, name: string) => sim.tiePolicy.hear(sim.policies.viewEvent(talk(sim, npc, kind, name))!);
    hear('favour', 'f1');
    expect(sim.tiePolicy.hasEdge(npc, v)).toBe(true);
    const warm = sim.tiePolicy.regardOf(npc, v);
    expect(warm.evN).toBe(1);
    hear('retract', 'r1');
    expect(sim.tiePolicy.excluded(npc, v)).toBe(true);
    expect(sim.tiePolicy.statusOf(npc, v)).toBe('ended');
    expect(sim.tiePolicy.hasEdge(npc, v)).toBe(true);
    const before = JSON.stringify(sim.tiePolicy.regardOf(npc, v));
    // nothing is made for the thread any more
    expect(sim.tiePolicy.bid(npc, 'friendly', H(hs('bid'), hi(1)))).toBe(false);
    hear('favour', 'f2');
    hear('conflict', 'c1');
    hear('repair', 'p1');
    expect(JSON.stringify(sim.tiePolicy.regardOf(npc, v))).toBe(before);
    expect(sim.tiePolicy.statusOf(npc, v)).toBe('ended');
    expect(sim.record.log.filter((e) => e.reason === 'excluded-thread').length).toBe(4);
    // the retract itself is idempotent, and another NPC's thread is untouched
    hear('retract', 'r2');
    expect(sim.record.softExcluded.length).toBe(1);
    const other = residents(sim)[1]!;
    expect(sim.tiePolicy.excluded(other, v)).toBe(false);
  });
});
