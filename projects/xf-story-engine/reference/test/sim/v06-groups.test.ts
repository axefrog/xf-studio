// S1 v0.6: leaders, succession, the pulses by function, decisions as events (SF1-G-7 to SF1-G-10, SF1-G-13, SF1-G-15, SF1-G-16, SF1-F-3).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import type { Id } from '../../src/types.ts';
import type { EventFact } from '../../src/sim/occ.ts';
import { refusalShare, type G, type GroupState } from '../../src/sim/proc-groups.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { S1Data } from '../../src/sim/data.ts';
import { quietData, seedOf } from './helpers.ts';
import { bigSlice } from './goals-helpers.ts';

setDefaultTimeout(120_000);
const W = 600;
const GROUP_PROC = processCause('group.decide');

const groupSim = (name: string, tweak: (d: S1Data) => void = () => {}, only = ['group.decide'], index = fx3Slice()): Sim => Sim.create({ worldSeed: seedOf(name), index, data: quietData(tweak), only });
const gid = (sim: Sim, aff: 'A1' | 'A2'): Id => sim.w.group(sim.w.districts[0]!.id, aff);
const gstate = (sim: Sim, aff: 'A1' | 'A2'): G => sim.stateOf<GroupState>('group.decide')!.groups[gid(sim, aff)]!;
const gnow = (sim: Sim, aff: 'A1' | 'A2'): G => (sim.k.evolution.states.get('group.decide')!.outstanding.at(-1)?.state as GroupState | undefined)?.groups[gid(sim, aff)] ?? gstate(sim, aff);

/** Adult gang members aged 25 or more of a group of the district, in a fixed order. */
const members = (sim: Sim, aff: 'A1' | 'A2'): Id[] => {
  const want = aff === 'A1' ? 2 : 3;
  const out: Id[] = [];
  for (const cell of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
    const v = sim.people.view(r);
    if (v && v.affc === want && v.role === 'gang' && v.ageClass === 'adult' && v.aband >= 2) out.push(r);
  }
  return out;
};
const civilians = (sim: Sim): Id[] => {
  const out: Id[] = [];
  for (const cell of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
    const v = sim.people.view(r);
    if (v && v.affc === 0 && v.ageClass === 'adult') out.push(r);
  }
  return out;
};

/** Put the given people in the seats of a group, in order, with their leans, edges written. */
const seat = (sim: Sim, aff: 'A1' | 'A2', holders: Array<Id | null>, leans: string[] = []): void => {
  sim.setState('group.decide', (st) => {
    const g = (st as GroupState).groups[gid(sim, aff)]!;
    holders.forEach((h, i) => {
      const s = g.seats[i]!;
      s.holder = h;
      s.edged = true;
      s.succ = 0;
      delete s.retry;
      s.logged = true;
      if (h !== null) s.lean = leans[i] ?? Object.keys(sim.data.groups.groups.find((x) => x.aff === aff)!.ethos)[0]!;
      else delete s.lean;
    });
  });
};

const feed = (sim: Sim, w: number, facts: EventFact[], counts: Array<{ district: Id; kind: string; size: number; n: number }> = []): void => {
  sim.k.evolution.stateOf('city.events').digest = { v: 1, through: w, facts: { windows: [{ w, items: facts }] }, counts: { windows: [{ w, items: counts }] }, changes: { windows: [] } };
};

const fact = (sim: Sim, over: Partial<EventFact> & Pick<EventFact, 'kind' | 'parties'>): EventFact => ({
  id: H(hs('fact'), hs(over.kind), hs(JSON.stringify(over.parties))), size: 2, w: 5, time: 5 * W + 10, cell: sim.w.districts[0]!.cellIds[0]!, district: sim.w.districts[0]!.id,
  public: false, witnesses: 0, policeChild: false, creator: 'sim', outcome: 'done', ...over,
});

describe('SF1-G-7: pulses by function', () => {
  const run = (name: string, make: (sim: Sim, p: { ga1: Id; ga2: Id; gb: Id; civ: Id; GA: Id; GB: Id }) => EventFact[]) => {
    const sim = groupSim(name);
    const ga = members(sim, 'A1');
    const gb = members(sim, 'A2');
    const civ = civilians(sim)[0]!;
    const p = { ga1: ga[0]!, ga2: ga[1]!, gb: gb[0]!, civ, GA: gid(sim, 'A1'), GB: gid(sim, 'A2') };
    // two seats of each group are held by others, so the victim is not a seat holder unless a case says so
    seat(sim, 'A1', [ga[2] ?? null, null, null]);
    seat(sim, 'A2', [gb[2] ?? null, null]);
    sim.startAt(5);
    feed(sim, 5, make(sim, p));
    sim.advance(1);
    return { sim, p, GA: gnow(sim, 'A1'), GB: gnow(sim, 'A2') };
  };
  const pair = (a: Id, ga: Id | undefined, v: Id, gv: Id | undefined) => [{ role: 'aggressor', who: a, ...(ga ? { group: ga } : {}) }, { role: 'victim', who: v, ...(gv ? { group: gv } : {}) }];

  test('(a) a size-2 shakedown by a GA member of a GB member, done: care of members, a latched retribution naming GA, no reputation unless public', () => {
    const { sim, p, GB, GA } = run('SF1-G-7a', (s, x) => [fact(s, { kind: 'shakedown', parties: pair(x.ga1, x.GA, x.gb, x.GB), effects: [{ on: x.gb, effect: 'take' }] })]);
    expect(GB.pulse.care_of_members).toMatchObject({ sev: 0.36, latched: false, src: expect.any(String) });
    expect(GB.pulse.retribution).toMatchObject({ sev: 0.36, latched: true, rival: 2, wrongdoer: p.ga1, ward: p.gb });
    expect(GB.pulse.reputation).toBeUndefined();
    expect(GA.pulse).toEqual({});
    void sim;
  });

  test('(a) public: a reputation pulse too', () => {
    const { GB } = run('SF1-G-7a2', (s, x) => [fact(s, { kind: 'shakedown', public: true, witnesses: 6, parties: pair(x.ga1, x.GA, x.gb, x.GB), effects: [{ on: x.gb, effect: 'take' }] })]);
    expect(GB.pulse.reputation).toMatchObject({ sev: 0.36 });
  });

  test('(b) an enforcement beating of a GB member by a GA enforcer: the same pulses with sev 0.3', () => {
    const { GB } = run('SF1-G-7b', (s, x) => [fact(s, {
      kind: 'enf.fee.beating', size: 1, creator: 'norms', parties: [{ role: 'enforcer', who: x.ga1, group: x.GA }, { role: 'target', who: x.gb, group: x.GB }], effects: [{ on: x.gb, effect: 'harm' }],
    })]);
    expect(GB.pulse.care_of_members).toMatchObject({ sev: 0.3 });
    expect(GB.pulse.retribution).toMatchObject({ sev: 0.3, latched: true, rival: 2 });
  });

  test('(c) a GA member against another GA member: nothing for GA; (d) a failed shakedown fills no wrong: nothing', () => {
    const c = run('SF1-G-7c', (s, x) => [fact(s, { kind: 'assault', parties: pair(x.ga1, x.GA, x.ga2, x.GA), effects: [{ on: x.ga2, effect: 'harm' }] })]);
    expect(c.GA.pulse).toEqual({});
    expect(c.GB.pulse).toEqual({});
    const d = run('SF1-G-7d', (s, x) => [fact(s, { kind: 'shakedown', outcome: 'failed', parties: pair(x.ga1, x.GA, x.gb, x.GB), effects: [] })]);
    expect(d.GB.pulse).toEqual({});
    const e = run('SF1-G-7d2', (s, x) => [fact(s, { kind: 'assault', outcome: 'prevented', parties: pair(x.ga1, x.GA, x.gb, x.GB), effects: [{ on: x.gb, effect: 'protect' }] })]);
    expect(e.GB.pulse).toEqual({});
  });

  test('(e) a size-2 assault by v on a GB member: GB cares, no retribution (V reaches a group through its own belief)', () => {
    const { GB, sim } = run('SF1-G-7e', (s, x) => [fact(s, { kind: 'assault', parties: pair(s.w.v, undefined, x.gb, x.GB), effects: [{ on: x.gb, effect: 'harm' }] })]);
    expect(GB.pulse.care_of_members).toMatchObject({ sev: 0.6 });
    expect(GB.pulse.retribution).toBeUndefined();
    void sim;
  });

  test('a broken obligation (a wrong with no effect on the one wronged) weighs 0.5', () => {
    const { GB } = run('SF1-G-7f', (s, x) => [fact(s, { kind: 'assault', size: 1, parties: pair(x.ga1, x.GA, x.gb, x.GB), effects: [] })]);
    expect(GB.pulse.care_of_members).toMatchObject({ sev: 0.3 * 0.5 });
  });

  test('harm to a seat holder weighs leaderSev and always gives a reputation pulse', () => {
    const sim = groupSim('SF1-G-7g');
    const ga = members(sim, 'A1');
    const gb = members(sim, 'A2');
    seat(sim, 'A2', [gb[0]!, null]);
    sim.startAt(5);
    feed(sim, 5, [fact(sim, { kind: 'assault', parties: pair(ga[0]!, gid(sim, 'A1'), gb[0]!, gid(sim, 'A2')), effects: [{ on: gb[0]!, effect: 'harm' }] })]);
    sim.advance(1);
    const GB = gnow(sim, 'A2');
    expect(GB.pulse.care_of_members!.sev).toBeCloseTo(0.6 * 1 * 1.5, 12);
    expect(GB.pulse.reputation!.sev).toBeCloseTo(0.9, 12);
  });

  test('a public refusal of the fee is a defiance: a reputation pulse of severity 0.6 for the group that enforces it', () => {
    const { GA } = run('SF1-G-7h', (s, x) => [fact(s, { kind: 'shakedown', size: 1, outcome: 'failed', public: true, witnesses: 6, parties: pair(x.ga1, x.GA, x.civ, undefined), effects: [] })]);
    expect(GA.pulse.reputation).toMatchObject({ sev: 0.6, latched: false });
  });

  test('a released retribution: GB retaliating by a clash releases the latched pulse toward GA', () => {
    const sim = groupSim('SF1-G-7i');
    const ga = members(sim, 'A1');
    const gb = members(sim, 'A2');
    sim.setState('group.decide', (st) => { (st as GroupState).groups[gid(sim, 'A2')]!.pulse.retribution = { at: 0, sev: 0.6, latched: true, rival: 2 }; });
    sim.startAt(5);
    feed(sim, 5, [fact(sim, { kind: 'gang-clash', size: 2, parties: [{ role: 'aggressor', who: gb[0]!, group: gid(sim, 'A2') }, { role: 'victim', who: ga[0]!, group: gid(sim, 'A1') }], effects: [{ on: ga[0]!, effect: 'harm' }] })]);
    sim.advance(1);
    expect(gnow(sim, 'A2').pulse.retribution!.releasedAt).toBe(5 * W + 10);
  });
});

describe('SF1-G-8: seats', () => {
  test('every holder is a living adult GA member of role gang aged 25 or more in one seat only, with an xf:leads edge caused by the group; identical in a fresh engine and after a reload; a seat nobody can take is vacant and logged', () => {
    const a = groupSim('SF1-G-8');
    const b = groupSim('SF1-G-8');
    a.advance(3);
    b.advance(3);
    for (const aff of ['A1', 'A2'] as const) {
      const g = gstate(a, aff);
      const group = gid(a, aff);
      expect(g.seats.length).toBe(aff === 'A1' ? 3 : 2);
      const held = g.seats.filter((s) => s.holder !== null).map((s) => s.holder!);
      expect(new Set(held).size).toBe(held.length);
      for (const h of held) {
        const v = a.people.view(h)!;
        expect(v.affc).toBe(aff === 'A1' ? 2 : 3);
        expect(v.role).toBe('gang');
        expect(v.ageClass).toBe('adult');
        expect(v.aband).toBeGreaterThanOrEqual(2);
        expect(a.people.alive(h, 0)).toBe(true);
        const edge = [...a.k.store.allEdges()].find((e) => e.type === 'xf:leads' && e.from === h);
        expect(edge).toBeDefined();
        expect(edge!.to).toBe(group);
        expect(edge!.cause).toBe(group);
        expect(edge!.id).toBe(H(hs('edge'), hs('xf:leads'), hid(h), hid(group), hi(0)));
        expect(edge!.attrs.seat).toBe(g.seats.find((s) => s.holder === h)!.seat);
      }
      for (const s of g.seats) if (s.holder === null) expect(a.record.log.some((l) => l.reason === 'seat-vacant' && l.key === `${group}|${s.seat}`)).toBe(true);
      expect(gstate(b, aff).seats).toEqual(g.seats);
    }
    // a reload: the seats come back as they were, and a fresh engine loading the save reaches the same state
    a.k.persistence.save('A');
    const c = groupSim('SF1-G-8');
    for (const [id, rec] of a.k.persistence.chain) c.k.persistence.chain.set(id, structuredClone(rec));
    c.k.newEpoch();
    c.k.persistence.load('A');
    expect(gstate(c, 'A1').seats).toEqual(gstate(a, 'A1').seats);
    expect(gstate(c, 'A2').seats).toEqual(gstate(a, 'A2').seats);
    // the edges are saved and loaded: a holder's edge is still there
    const h = gstate(a, 'A1').seats.find((s) => s.holder !== null)!.holder!;
    expect([...c.k.store.allEdges()].some((e) => e.type === 'xf:leads' && e.from === h)).toBe(true);
    // each holder leans towards one of the carried drives
    for (const s of gstate(a, 'A1').seats) if (s.holder !== null) expect(Object.keys(a.data.groups.groups[0]!.ethos)).toContain(s.lean!);
  });

  test('a leader\'s leaning is drawn once from the ethos and is the same for the same person in the same group', () => {
    const sim = groupSim('SF1-G-8b');
    const h = members(sim, 'A1')[0]!;
    const draw = sim.ids.lean(h, gid(sim, 'A1'));
    expect(draw).toBe(sim.ids.lean(h, gid(sim, 'A1')));
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
  });
});

describe('SF1-G-9, SF1-G-15 and SF1-G-16: removal, succession, interregnum, the bar', () => {
  const world = (name: string, tweak: (d: S1Data) => void = () => {}, index = fx3Slice()) => {
    const sim = groupSim(name, (d) => { d.groups.canonSeats = [{ gameKey: 'canon-head', seat: 0, aff: 'A1' }]; tweak(d); }, ['group.decide'], index);
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'canon-head', slots: { affiliation: 'GA', alive: 'yes', 'age-class': 'adult' } }]);
    sim.advance(2);
    // the game's person is a member of the Claws (a first reading writes no membership: the pack or the harness does)
    const head = port.node('canon-head');
    sim.k.addEdge({ type: 'core:member-of', from: head, to: gid(sim, 'A1'), attrs: { role: 'member' }, cause: gid(sim, 'A1'), valid: { from: 0 } });
    sim.advance(3);
    return { sim, port, head };
  };
  const eventsOf = (sim: Sim, kind: string): Id[] => [...sim.k.store.idsOfKind('core:event')].filter((e) => sim.k.value(e, 'kind') === kind).sort();

  test('a canon head takes the seat; its death removes it: the edge ends, seat 1 moves up with a succession (successor, late), seat 1 is drawn anew, an interregnum starts, discipline is halved and boosts rise', () => {
    const { sim, port, head } = world('SF1-G-9');
    const ga = members(sim, 'A1');
    const group = gid(sim, 'A1');
    const gb = members(sim, 'A2');
    expect(gstate(sim, 'A1').seats[0]!.holder).toBe(head);
    expect(eventsOf(sim, 'succession').length).toBeGreaterThanOrEqual(1);
    seat(sim, 'A1', [head, ga[0]!, null], ['treasury', 'reputation', 'treasury']);
    sim.advance(1);
    // the game says the head is dead; the derived assault with effect kill is consumed in the run of this window
    const w0 = sim.windowNow();
    port.submit([{ t: w0 * W + 1, op: 'person', key: 'canon-head', slots: { alive: 'no' } }]);
    const kill = fact(sim, { kind: 'assault', time: (w0 + 1) * W + 20, w: w0 + 1, parties: [{ role: 'aggressor', who: gb[0]!, group: gid(sim, 'A2') }, { role: 'victim', who: head, group }], effects: [{ on: head, effect: 'kill' }] });
    feed(sim, w0 + 1, [kill]);
    sim.advance(3);
    const g = gnow(sim, 'A1');
    expect(g.seats[0]!.holder).toBe(ga[0]!);
    expect(g.seats[0]!.since).toBeGreaterThan(w0);
    expect(g.interregnum).toBeDefined();
    expect(g.interregnum!.until).toBeGreaterThan(w0);
    // the head's edge ended
    const ended = [...sim.k.store.allEdges()].find((e) => e.type === 'xf:leads' && e.from === head)!;
    expect(ended.valid.to).toBeDefined();
    // a succession for the new head names the late head, as the old head is dead
    const succ = eventsOf(sim, 'succession').map((e) => sim.policies.viewEvent(e)!).filter((e) => e.participants.some((p) => p.role === 'late' && p.who === head));
    expect(succ.length).toBe(1);
    expect(succ[0]!.participants).toContainEqual({ who: ga[0]!, role: 'successor' });
    expect(succ[0]!.causes).toContain(kill.id);
    expect(succ[0]!.id).toBe(H(hs('mint'), hid(GROUP_PROC), hid(group), hs(`succession/0/${g.seats[0]!.since - 1}`)));
    // the group's pulses use leaderSev: min(1, 0.6 x 1.5 x 1.5) = 1, and a latched retribution names GB. The Claws carry no care of members, so that pulse is ignored (SPEC-NOTES)
    expect(g.pulse.care_of_members).toBeUndefined();
    expect(g.pulse.retribution).toMatchObject({ latched: true, rival: 3, sev: 1 });
    expect(g.pulse.reputation).toMatchObject({ sev: 1 });
    // discipline: the digest says so for order.norms, and the assault and theft boost rises by 0.3
    const dg = sim.digestOf<{ groups: Record<Id, { interregnum: boolean }>; boost: Record<Id, Record<number, Record<string, number>>> }>('group.decide')!;
    expect(dg.groups[group]!.interregnum).toBe(true);
    expect(dg.boost[sim.w.districts[0]!.id]![2]!.assault).toBeCloseTo(0.3, 12);
    expect(dg.boost[sim.w.districts[0]!.id]![2]!.theft).toBeCloseTo(0.3, 12);
    // no intention starts while it lasts, logged once
    expect(g.intent.state === 'none' || g.intent.state === 'idle').toBe(true);
    sim.advance(10);
    expect(sim.record.log.filter((l) => l.reason === 'intent-leaderless' && l.key === group).length).toBe(1);
  });

  test('review 15: each new holder edge cites its own succession event, and a seat drawn a window after the removal keeps the removal as the cause of its succession', () => {
    const { sim, port, head } = world('SF1-G-9r', () => {}, bigSlice());
    const ga = members(sim, 'A1');
    const group = gid(sim, 'A1');
    const gb = members(sim, 'A2');
    seat(sim, 'A1', [head, ga[0]!, null], ['treasury', 'reputation', 'treasury']);
    sim.advance(1);
    const w0 = sim.windowNow();
    port.submit([{ t: w0 * W + 1, op: 'person', key: 'canon-head', slots: { alive: 'no' } }]);
    const kill = fact(sim, { kind: 'assault', time: (w0 + 1) * W + 20, w: w0 + 1, parties: [{ role: 'aggressor', who: gb[0]!, group: gid(sim, 'A2') }, { role: 'victim', who: head, group }], effects: [{ on: head, effect: 'kill' }] });
    feed(sim, w0 + 1, [kill]);
    sim.advance(8);
    const succ = eventsOf(sim, 'succession').map((e) => ({ id: e, v: sim.policies.viewEvent(e)! }));
    // the promoted head's succession and the draw for the seat it left both answer the removal, whichever window the second came in
    const late = succ.filter((x) => x.v.participants.some((p) => p.role === 'late' && p.who === head));
    expect(late).toHaveLength(1);
    const later = succ.filter((x) => x.id !== late[0]!.id);
    expect(later.length).toBeGreaterThan(0);
    for (const x of [...late, ...later.slice(0, 1)]) expect(x.v.causes).toContain(kill.id);
    // each new holder's edge cites the succession that placed them, not the group
    const edges = [...sim.k.store.allEdges()].filter((e) => e.type === 'xf:leads' && e.to === group && e.valid.from > 0);
    const sp = new Set(succ.map((x) => x.id));
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(sp.has(e.cause), `edge of ${e.from} cites ${e.cause}`).toBe(true);
    // a holder placed at initialisation has no succession: its edge cites the group
    expect([...sim.k.store.allEdges()].some((e) => e.type === 'xf:leads' && e.to === group && e.cause === group)).toBe(true);
  });

  test('an arrest removes a lieutenant and bars them: no draw picks them before the bar ends, and a succession names the predecessor', () => {
    const { sim } = world('SF1-G-16', (d) => { d.groups.arrestBar = 30; });
    const ga = members(sim, 'A1');
    const group = gid(sim, 'A1');
    expect(ga.length).toBeGreaterThan(2);
    seat(sim, 'A1', [ga[0]!, ga[1]!, null]);
    sim.advance(1);
    const w1 = sim.windowNow();
    sim.startAt(w1);
    const arrest = fact(sim, { kind: 'police-action', outcome: 'done', size: 2, time: w1 * W + 5, w: w1, parties: [{ role: 'responder', who: civilians(sim)[0]! }, { role: 'target', who: ga[1]!, group }] });
    feed(sim, w1, [arrest]);
    sim.advance(2);
    const g = gnow(sim, 'A1');
    expect(g.seats[1]!.holder).not.toBe(ga[1]!);
    expect(g.barred.some((b) => b.person === ga[1]! && b.cause === arrest.id)).toBe(true);
    expect(g.interregnum).toBeUndefined();
    const until = g.barred.find((b) => b.person === ga[1]!)!.until;
    expect(until).toBe(g.barred.find((b) => b.person === ga[1]!)!.until);
    // no seat is drawn to a barred person while the bar lasts
    sim.advance(until - sim.windowNow() - 1);
    for (const s of gnow(sim, 'A1').seats) expect(s.holder).not.toBe(ga[1]!);
    sim.advance(3);
    expect(gnow(sim, 'A1').barred.some((b) => b.person === ga[1]!)).toBe(false);
  });
});

describe('SF1-G-10 and SF1-G-15: decisions are events', () => {
  test('collect-fee: one decide event naming the group and its decider, the intention\'s id is its Id; one relent at the end caused by the decision; the ids are the mint names', () => {
    const sim = groupSim('SF1-G-10', (d) => { d.groups.groups[0]!.books.income = 0; });
    const ga = members(sim, 'A1');
    seat(sim, 'A1', [ga[0]!, ga[1]!, ga[2] ?? null], ['reputation', 'treasury', 'cohesion']);
    const group = gid(sim, 'A1');
    let started = -1;
    for (let w = 0; w < 12 * 144 && started < 0; w++) {
      sim.advance(1);
      if (gnow(sim, 'A1').intent.state === 'active') started = sim.windowNow();
    }
    expect(started).toBeGreaterThan(0);
    // the decision event is minted by the batch that starts the intention: it applies at the next boundary
    sim.advance(2);
    const g = gnow(sim, 'A1');
    expect(g.intent.state).toBe('active');
    const act = g.intent as Extract<G['intent'], { state: 'active' }>;
    const decisions = [...sim.k.store.idsOfKind('core:event')].filter((e) => sim.k.value(e, 'kind') === 'decide.collect-fee');
    expect(decisions).toEqual([act.id]);
    const dec = sim.policies.viewEvent(act.id)!;
    // the decider is the holder of the lowest seat leaning treasury, here seat 1 (the head leans reputation)
    expect(dec.participants).toEqual([{ who: group, role: 'group' }, { who: ga[1]!, role: 'decider' }]);
    expect(dec.place).toBe(sim.w.districts[0]!.id);
    expect(dec.outcome).toBe('done');
    const decideW = act.since - 1;
    expect(act.id).toBe(H(hs('mint'), hid(GROUP_PROC), hid(group), hs(`decide/collect-fee/${decideW}`)));
    expect(dec.time).toBeGreaterThanOrEqual(decideW * W);
    expect(dec.time).toBeLessThan((decideW + 1) * W);
    // the end: expires 144 windows later, a relent caused by the decision
    sim.advance(act.expires - sim.windowNow() + 2);
    const relents = [...sim.k.store.idsOfKind('core:event')].filter((e) => sim.k.value(e, 'kind') === 'relent.collect-fee');
    expect(relents.length).toBe(1);
    const rel = sim.policies.viewEvent(relents[0]!)!;
    expect(rel.causes).toEqual([act.id]);
    expect(rel.participants).toEqual(dec.participants);
    expect(relents[0]).toBe(H(hs('mint'), hid(GROUP_PROC), hid(group), hs(`relent/collect-fee/${act.expires - 1}`)));
    expect(sim.k.value(relents[0]!, 'kind')).toBe('relent.collect-fee');
    // the same run again gives the same ids
    const again = groupSim('SF1-G-10', (d) => { d.groups.groups[0]!.books.income = 0; });
    seat(again, 'A1', [ga[0]!, ga[1]!, ga[2] ?? null], ['reputation', 'treasury', 'cohesion']);
    again.advance(sim.windowNow());
    expect([...again.k.store.idsOfKind('core:event')].filter((e) => String(again.k.value(e, 'kind')).startsWith('decide.')).sort()).toEqual([act.id]);
  });
});

describe('SF1-G-13: every wrong reaches the pulses once', () => {
  const kit = (sim: Sim, name: string, creator: Id, kind: string, aggressor: Id, victim: Id, effect: 'harm' | 'take', time: number): Id =>
    sim.k.events.mintEvent({
      creator, cause: creator, name, time, kind, place: sim.w.districts[0]!.cellIds[0]!,
      participants: [{ who: aggressor, role: kind.startsWith('enf.') ? 'enforcer' : 'aggressor' }, { who: victim, role: kind.startsWith('enf.') ? 'target' : 'victim' }],
      effects: [{ on: victim, effect }], witnesses: [], causes: [], outcome: 'done',
    });

  test('a kit\'s assault and a replayed enforcement, found by query in two successive windows, pulse once each, across a save and load', () => {
    const sim = groupSim('SF1-G-13');
    const ga = members(sim, 'A1');
    const gb = members(sim, 'A2');
    seat(sim, 'A2', [gb[2] ?? null, null]);
    const seed = sim.k.root('kit-seed', 'core:seed');
    const a = kit(sim, 'kit-assault', seed, 'assault', ga[0]!, gb[0]!, 'harm', 100);
    const b = kit(sim, 'replay-beating', sim.w.port, 'enf.fee.beating', ga[1]!, gb[1]!, 'harm', 200);
    sim.advance(3);
    const seen = (): Id[] => sim.stateOf<GroupState>('group.decide')!.seen;
    expect(seen().sort()).toEqual([a, b].sort());
    const pulse = gnow(sim, 'A2').pulse.care_of_members!;
    expect(pulse.at).toBeGreaterThanOrEqual(100);
    // a save and load between the windows neither drops nor repeats them
    sim.k.persistence.save('G13');
    const fresh = groupSim('SF1-G-13');
    for (const [id, rec] of sim.k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(rec));
    fresh.k.newEpoch();
    fresh.k.persistence.load('G13');
    fresh.advance(3);
    expect(fresh.stateOf<GroupState>('group.decide')!.seen.sort()).toEqual([a, b].sort());
    // a mirrored derivative or an event of S1's own processes is never taken by query: it arrives through the feeds
    expect(fresh.stateOf<GroupState>('group.decide')!.seen.length).toBe(2);
  });
});

describe('SF1-F-3: the books count refusals', () => {
  test('refusalShare at beh 0.875 is 0.07, and a window\'s lump sum is 0.93 of the old one', () => {
    expect(refusalShare(0.875, 0.35, 0.03)).toBeCloseTo(0.07, 12);
    const district = (sim: Sim) => sim.w.districts[0]!.id;
    const cash = (withRefusal: boolean): number => {
      const sim = groupSim('SF1-F-3', (d) => { d.groups.groups[0]!.books.income = d.groups.groups[0]!.books.burn; });
      sim.startAt(5);
      feed(sim, 5, [], [{ district: district(sim), kind: 'shakedown', size: 1, n: 10 }]);
      sim.k.evolution.stateOf('order.norms').digest = { v: 1, through: 4, norms: { [district(sim)]: { fee: { priv: 0, beh: 0.875, perc: 0, vis: 0, gap: 0 } } }, facts: { windows: [] }, changes: { windows: [] } };
      void withRefusal;
      sim.advance(1);
      return gnow(sim, 'A1').books.cash;
    };
    const sim = groupSim('SF1-F-3x');
    const lump = sim.data.groups.groups[0]!.perShakedown * sim.city.offenderShare(district(sim), 'shakedown', 2) * 10;
    expect(cash(true) - sim.data.groups.groups[0]!.books.cash).toBeCloseTo(lump * 0.93, 9);
  });
});
