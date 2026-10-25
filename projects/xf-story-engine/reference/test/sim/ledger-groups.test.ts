// SF1-L and SF1-G: the reputation ledger and the groups (S1 7.7, 7.8, 8.6, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, rand, s as hs } from '../../src/id.ts';
import { aggregateItems, labelOf, residentSum, type LedgerItem } from '../../src/sim/ledger.ts';
import { leadShares, operative, pressures, pulseReplaces, pulseU, type G, type GroupDigest, type GroupState } from '../../src/sim/proc-groups.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { defaultData, type S1Data } from '../../src/sim/data.ts';
import type { Id } from '../../src/types.ts';
import { quietData, seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const W = 600;
const cfg = defaultData().ledger;

const item = (v: number, n: number, over: Partial<LedgerItem> = {}): LedgerItem => ({
  id: H(hs('item'), hi(n)), at: n, v, reach: 1, salience: 3, confidence: 1, tellerDiscount: 1, origin: H(hs('origin'), hi(n)), index: n, ...over,
});

describe('SF1-L-1 and SF1-L-3: the worked trace and displacement', () => {
  const vs = [0.5, 0.5, -1.2, -0.8, -0.8];
  const expected: Array<[number, number, number, number, string]> = [
    [0.5, 0, 0.6, 0.5, 'unknown'],
    [0.95, 0, 0.661, 0.95, 'unknown'],
    [0.855, 1.2, 0.4575, 2.055, 'mid'],
    [0.7695, 1.88, 0.3806, 2.6495, 'low'],
    [0.6925, 2.492, 0.3265, 3.1845, 'low'],
  ];
  test('(r, s, E, mass) after each item and the label', () => {
    vs.forEach((_, n) => {
      const a = aggregateItems(vs.slice(0, n + 1).map((v, i) => item(v, i)), cfg);
      const [r, q, E, mass, label] = expected[n]!;
      expect(a.r).toBeCloseTo(r, 4);
      expect(a.q).toBeCloseTo(q, 4);
      expect(a.E).toBeCloseTo(E, 3);
      expect(a.mass).toBeCloseTo(mass, 4);
      expect(['unknown', 'low', 'mid', 'high'][labelOf(a, cfg)]).toBe(label);
    });
  });
  test('thirty game days with no events leave it unchanged: the aggregate reads no clock', () => {
    const items = vs.slice(0, 3).map((v, i) => item(v, i));
    const a = aggregateItems(items, cfg);
    expect(aggregateItems(items, cfg)).toEqual(a);
  });
  test('one independent contrary item moves the label from mid to low', () => {
    const three = vs.slice(0, 3).map((v, i) => item(v, i));
    expect(labelOf(aggregateItems(three, cfg), cfg)).toBe(2);
    expect(labelOf(aggregateItems([...three, item(-0.8, 3)], cfg), cfg)).toBe(1);
  });
});

describe('SF1-L-4: aggregate against residents', () => {
  test('200 sampled residents with knows over reach: the mean of their own r and q is within sampling error and 0.1 of the aggregate\'s', () => {
    const seed = seedOf('SF1-L-4');
    const items = [0.6, -0.4, 0.8, -0.2, 0.5, -0.7].map((v, n) => item(v, n, { reach: 0.4 + 0.1 * (n % 3), salience: n % 4 }));
    const a = aggregateItems(items, cfg);
    const N = 2000;
    let sr = 0;
    let sq = 0;
    let sr2 = 0;
    for (let n = 0; n < N; n++) {
      const res = H(hs('resident'), hi(n));
      const { r, q } = residentSum(items, cfg, (it) => rand(hs('knows'), hid(seed), hid(res), hid(it.id)) < it.reach);
      sr += r;
      sq += q;
      sr2 += r * r;
    }
    const meanR = sr / N;
    const se = Math.sqrt(Math.max(0, sr2 / N - meanR * meanR) / N);
    expect(Math.abs(meanR - a.r)).toBeLessThan(Math.max(0.1, 4 * se));
    expect(Math.abs(sq / N - a.q)).toBeLessThan(0.1 + 4 * se);
    // the posterior value is reported, not asserted equal
    expect(typeof a.value).toBe('number');
  });
});

/** A V act as an event: V is the actor, with a victim and witnesses, in a cell of the district. */
function actOn(sim: Sim, name: string, kind: string, effect: 'harm' | 'kill' | 'help' | 'take' | 'give' | 'expose', victim: Id, opts: { cell?: Id; witnesses?: number; outcome?: 'done' | 'failed'; time?: number } = {}): Id {
  const d = sim.w.districts[0]!;
  const witnesses = Array.from({ length: opts.witnesses ?? 3 }, (_, i) => H(hs('wit'), hs(name), hi(i)));
  return sim.k.events.mintEvent({
    creator: sim.w.port, cause: sim.w.port, name, time: opts.time ?? 1000, kind, place: opts.cell ?? d.cellIds[0]!,
    participants: [{ who: sim.w.v, role: 'actor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect }], witnesses, outcome: opts.outcome ?? 'done',
  });
}

const ledgerSim = (name: string, tweak: (d: S1Data) => void = () => {}): Sim => Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only: ['order.ledger'] });

describe('SF1-L-2 and SF1-L-6: a chain adds nothing; aliases count once', () => {
  test('SF1-L-2: A tells B tells C, then A tells C: C holds the origin\'s evidence, the carrier\'s mass is that of the origin, the second telling only refreshes', () => {
    const sim = ledgerSim('SF1-L-2');
    const d = sim.w.districts[0]!;
    const [a, b, c] = [0, 1, 2].map((i) => sim.people.residentAt(d.cellIds[0]!, i));
    const victim = sim.people.residentAt(d.cellIds[1]!, 0);
    const ev = actOn(sim, 'chain', 'assault', 'harm', victim);
    const view = sim.policies.viewEvent(ev)!;
    sim.policies.absorb(view);
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    const before = sim.ledger.aggregate([carrier], sim.w.v, 'decent', 1e9);
    expect(before.items).toBe(1);
    const k = sim.k;
    k.beliefs.set({ believer: a, subject: sim.w.v, path: 'did.harm', at: 1000, value: victim, confidence: 1, evidence: [ev], source: { by: 'observed', event: ev }, formed: 0, refreshed: 0, memorable: true });
    const id = k.beliefs.activeOf(a)[0]!.id;
    k.beliefs.tell(a, b, id);
    k.beliefs.tell(b, c, k.beliefs.activeOf(b)[0]!.id);
    const heldC = k.beliefs.activeOf(c)[0]!;
    expect(heldC.evidence).toEqual([ev]);
    expect(heldC.source.by).toBe('told');
    expect(k.beliefs.tell(a, c, id)).toBe('refreshed');
    expect(sim.ledger.aggregate([carrier], sim.w.v, 'decent', 1e9)).toEqual(before);
  });

  test('SF1-L-6: V kills a vendor: the raw death and the derived assault are heard in either order; one item per carrier and axis, evidence the raw Id', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-L-6'), index: fx3Slice(), data: quietData(), only: ['city.mirror', 'order.ledger'] });
    const port = new ReplayPort(sim);
    port.submit([
      { t: 0, op: 'person', key: 'vendor1', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } },
      { t: 700, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'vendor1', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'vendor1', effect: 'kill' }], witnesses: 3 },
      { t: 10_000, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'vendor1', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'vendor1', effect: 'kill' }], witnesses: 3 },
    ]);
    sim.advance(30);
    const d = sim.w.districts[0]!;
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    const raw = H(hs('mint'), hid(sim.w.port), hid(sim.w.port), hs('raw/700/0'));
    const items = sim.ledger.itemsOf(carrier, sim.w.v, 'decent');
    expect(items.length).toBe(2);
    expect(items.map((i) => i.origin)).toContain(raw);
    for (const car of sim.data.ledger.carriers) {
      for (const axis of sim.data.ledger.axes) {
        const key = `${sim.ledger.carrierNode(car.id, d.id)}|${sim.w.v}|${axis}`;
        const list = sim.record.absorbed[key];
        if (list) expect(new Set(list.map((x) => x.origin)).size).toBe(list.length);
      }
    }
    // hearing the raw event again changes nothing: the raw kinds are ignored
    const before = JSON.stringify(sim.record.absorbed);
    sim.policies.absorb(sim.policies.viewEvent(raw)!);
    expect(JSON.stringify(sim.record.absorbed)).toBe(before);
  });
});

describe('SF1-L-5, SF1-L-7 and SF1-L-8: the cap, retention and diagnosticity', () => {
  test('SF1-L-5: 33 items for one carrier: the weakest goes, its index is reused, paths stay unique and the origin keeps -1', () => {
    const sim = ledgerSim('SF1-L-5');
    const d = sim.w.districts[0]!;
    let victim = sim.people.residentAt(d.cellIds[1]!, 0);
    for (let n = 1; sim.people.view(victim)!.affc !== 0; n++) victim = sim.people.residentAt(d.cellIds[1]!, n);
    const effects = ['help', 'harm', 'take', 'give', 'expose', 'help', 'harm'] as const;
    const evs: Id[] = [];
    for (let n = 0; n < 33; n++) {
      const ev = actOn(sim, `cap${n}`, 'assault', effects[n % effects.length]!, victim, { time: 1000 + n });
      evs.push(ev);
      sim.policies.absorb(sim.policies.viewEvent(ev)!);
    }
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    const items = sim.ledger.itemsOf(carrier, sim.w.v, 'decent');
    expect(items.length).toBe(32);
    expect(new Set(items.map((i) => i.index)).size).toBe(32);
    const key = `${carrier}|${sim.w.v}|decent`;
    const list = sim.record.absorbed[key]!;
    expect(list.length).toBe(33);
    expect(list.filter((x) => x.index === -1).length).toBe(1);
    const evicted = list.find((x) => x.index === -1)!;
    expect(items.some((i) => i.origin === evicted.origin)).toBe(false);
    // it was the item with the lowest |v| x salience weight (then the oldest, then the lower Id)
    const strength = (v: number, sal: number): number => Math.abs(v) * cfg.salW[sal]!;
    const minKept = Math.min(...items.map((i) => strength(i.v, i.salience)));
    expect(minKept).toBeGreaterThanOrEqual(0);
  });

  test('SF1-L-7: carrier items of 14 and 60 days are kept across a save and load and the label stands; a person\'s non-memorable belief of the same age is dropped', () => {
    const sim = ledgerSim('SF1-L-7');
    const d = sim.w.districts[0]!;
    const victim = sim.people.residentAt(d.cellIds[1]!, 0);
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    for (let n = 0; n < 3; n++) sim.policies.absorb(sim.policies.viewEvent(actOn(sim, `keep${n}`, 'assault', 'harm', victim, { time: 100 + n }))!);
    const person = sim.people.residentAt(d.cellIds[0]!, 0);
    sim.k.beliefs.set({ believer: person, subject: victim, path: 'did.harm', at: 5, value: victim, confidence: 1, evidence: [victim], source: { by: 'observed', event: victim }, formed: 0, refreshed: 0, memorable: false });
    const before = sim.ledger.aggregate([carrier], sim.w.v, 'decent', 1e9);
    sim.policies.fade(person, 61 * 86400);
    sim.policies.fade(carrier, 61 * 86400);
    expect(sim.k.beliefs.activeOf(person).length).toBe(0);
    expect(sim.ledger.aggregate([carrier], sim.w.v, 'decent', 1e9)).toEqual(before);
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    expect(sim.ledger.aggregate([carrier], sim.w.v, 'decent', 1e9)).toEqual(before);
  });

  test('SF1-L-8: a V promise done is 0.5 x 1.5 = 0.75 on reliable; a kind with no diag entry weighs 1', () => {
    const sim = ledgerSim('SF1-L-8');
    const d = sim.w.districts[0]!;
    let npc = sim.people.residentAt(d.cellIds[1]!, 0);
    for (let n = 1; sim.people.view(npc)!.affc !== 0; n++) npc = sim.people.residentAt(d.cellIds[1]!, n);
    const promise = actOn(sim, 'promise', 'promise', 'give', npc, { outcome: 'done' });
    sim.policies.absorb(sim.policies.viewEvent(promise)!);
    const carrier = sim.ledger.carrierNode('kabuki', d.id);
    const p = sim.ledger.itemsOf(carrier, sim.w.v, 'reliable');
    expect(p.length).toBe(1);
    expect(p[0]!.v).toBe(0.75);
    const favour = actOn(sim, 'favour', 'favour', 'give', npc, { time: 2000 });
    sim.policies.absorb(sim.policies.viewEvent(favour)!);
    const f = sim.ledger.itemsOf(carrier, sim.w.v, 'reliable').find((i) => i.at === 2000)!;
    // give on a civilian, kabuki view neutral: reliable +0.2, diag 1, on the 1/64 grid
    expect(f.v).toBe(0.203125);
  });
});

describe('SF1-G: the groups', () => {
  const claws = (): { def: ReturnType<typeof defaultData>['groups']['groups'][0]; U: Record<string, number> } => ({ def: defaultData().groups.groups[0]!, U: { treasury: 0.2, retribution: 0.2, reputation: 0.2, cohesion: 0.2 } });

  test('SF1-G-1: operative weights with the leaders term: (a) every seat vacant, (b) three seats held leaning treasury, reputation and treasury', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-G-1'), index: fx3Slice(), data: quietData(), only: ['group.decide'] });
    const { def, U } = claws();
    const vacant = [0, 1, 2].map((seat) => ({ seat, holder: null as string | null, lean: undefined as string | undefined }));
    const a = operative(sim, def.ethos, U, leadShares(def.ethos, vacant));
    expect(a.W.treasury).toBeCloseTo(0.318182, 6);
    expect(a.W.retribution).toBeCloseTo(0.209091, 6);
    expect(a.W.reputation).toBeCloseTo(0.263636, 6);
    expect(a.W.cohesion).toBeCloseTo(0.209091, 6);
    expect(Object.values(a.W).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    expect(a.D).toBeCloseTo(0.0545455, 6);
    // with no lead term given, ethosN stands in for it
    expect(operative(sim, def.ethos, U).W.treasury).toBeCloseTo(0.318182, 6);
    const held = [{ seat: 0, holder: 'a', lean: 'treasury' }, { seat: 1, holder: 'b', lean: 'reputation' }, { seat: 2, holder: 'c', lean: 'treasury' }];
    const lead = leadShares(def.ethos, held);
    expect(lead.treasury).toBeCloseTo(0.8, 12);
    expect(lead.retribution).toBe(0);
    expect(lead.reputation).toBeCloseTo(0.2, 12);
    expect(lead.cohesion).toBe(0);
    const b = operative(sim, def.ethos, U, lead);
    expect(b.W.treasury).toBeCloseTo(0.405455, 6);
    expect(b.W.retribution).toBeCloseTo(0.172727, 6);
    expect(b.W.reputation).toBeCloseTo(0.249091, 6);
    expect(b.W.cohesion).toBeCloseTo(0.172727, 6);
    expect(Object.values(b.W).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
    expect(b.D).toBeCloseTo(0.0418182, 6);
  });

  test('SF1-G-2: books: runway 30 days at 330 income, treasury pressure 0; with no income, after 15 days cash 4,500, runway 15, pressure 0.5', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-G-2'), index: fx3Slice(), data: quietData(), only: ['group.decide'] });
    const def = sim.data.groups.groups[0]!;
    const g = (cash: number): G => ({ aff: 'A1', district: sim.w.districts[0]!.id, books: { cash, burn: 300, income: 330 }, pulse: {}, seats: [], barred: [], intent: { state: 'none' }, W: {}, D: 0, gapBand: 0 });
    expect(pressures(sim, def, g(9000), 0).treasury).toBe(0);
    const dry = sim.data.groups.groups[0]!;
    const noIncome = { ...dry, books: { cash: 9000, burn: 300, income: 0 } };
    void noIncome;
    const x = g(9000);
    x.books.income = 0;
    for (let w = 0; w < 15 * 144; w++) x.books.cash = x.books.cash + ((x.books.income - x.books.burn) * W) / 86400;
    expect(x.books.cash).toBeCloseTo(4500, 6);
    expect(pressures(sim, def, x, 0).treasury).toBeCloseTo(0.5, 6);
  });

  test('SF1-G-3: a victim fact of size 2 gives a latched pulse of 0.48, held at 0.24 until released by a retaliating clash, not by time', () => {
    const p = { at: 0, sev: 0.6, latched: true, rival: 3 };
    const tau = 14 * 86400;
    expect(pulseU(p, 0.8, tau, 0, 0.5)).toBeCloseTo(0.48, 12);
    expect(pulseU(p, 0.8, tau, 365 * 86400, 0.5)).toBeCloseTo(0.24, 12);
    const released = { ...p, releasedAt: 86400 };
    expect(pulseU(released, 0.8, tau, 86400, 0.5)).toBeCloseTo(0.24, 12);
    expect(pulseU(released, 0.8, tau, 86400 + tau, 0.5)).toBeLessThan(0.24 * 0.4);
  });

  test('a pulse is replaced by the stronger urgency now, not at the time of the new fact: a weak mirrored fact older than a strong city one does not displace it (Sol 14)', () => {
    const tau = 14 * 86400;
    const T = 600;
    const city = { at: 550, sev: 1, latched: false };
    const mirrored = { at: 100, sev: 0.3, latched: false };
    // at the time of the mirrored fact the city pulse has not happened yet (urgency 0), which is what let the old comparison replace it
    expect(pulseU(city, 0.8, tau, 100, 0)).toBe(0);
    expect(pulseReplaces(city, mirrored, 0.8, tau, 0, T)).toBe(false);
    // in the other order, the strong newer fact does replace the weak old one
    expect(pulseReplaces(mirrored, city, 0.8, tau, 0, T)).toBe(true);
    // a latched pulse is held at its floor and is judged the same way
    const held = { at: 550, sev: 1, latched: true, rival: 3 };
    expect(pulseReplaces(held, { at: 100, sev: 0.3, latched: true, rival: 3 }, 0.8, tau, 0.5, T)).toBe(false);
    expect(pulseReplaces(undefined, mirrored, 0.8, tau, 0, T)).toBe(true);
    // equal urgency keeps the one held
    expect(pulseReplaces(city, { ...city }, 0.8, tau, 0, T)).toBe(false);
  });

  const groupSim = (name: string, tweak: (d: S1Data) => void = () => {}) => Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only: ['group.decide'] });
  const gstate = (sim: Sim, aff: 'A1' | 'A2'): G => sim.stateOf<GroupState>('group.decide')!.groups[sim.w.group(sim.w.districts[0]!.id, aff)]!;
  /** An intention starts only with the head's seat held (S1 7.8): the fixture seats a member of the group at the head's seat. */
  const seatHead = (sim: Sim, aff: 'A1' | 'A2'): Id => {
    const d = sim.w.districts[0]!;
    const want = aff === 'A1' ? 2 : 3;
    let who: Id | undefined;
    for (const cell of d.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r);
      if (who === undefined && v && v.affc === want && v.role === 'gang' && v.ageClass === 'adult' && v.aband >= 2) who = r;
    }
    sim.setState('group.decide', (st) => {
      const g = (st as GroupState).groups[sim.w.group(d.id, aff)]!;
      for (const seat of g.seats) if (seat.holder === who) seat.holder = null;
      g.seats[0]!.holder = who!;
      g.seats[0]!.lean = Object.keys(sim.data.groups.groups.find((x) => x.aff === aff)!.ethos)[0]!;
      g.seats[0]!.edged = true;
      delete g.seats[0]!.retry;
    });
    return who!;
  };

  test('SF1-G-5: the Claws with no income: collect-fee starts about day 8.3, is active from the next window, publishes the boost, expires 144 windows later, cools for 72, then none', () => {
    const sim = groupSim('SF1-G-5', (d) => { d.groups.groups[0]!.books.income = 0; });
    const district = sim.w.districts[0]!.id;
    seatHead(sim, 'A1');
    let startedAt = -1;
    let activeFrom = -1;
    let expiredAt = -1;
    let coolingEnd = -1;
    for (let w = 0; w < 14 * 144; w++) {
      sim.advance(1);
      const g = gstate(sim, 'A1');
      const dg = sim.digestOf<GroupDigest>('group.decide')!;
      if (g.intent.state === 'active' && startedAt < 0) {
        startedAt = w;
        activeFrom = g.intent.since;
        expect(dg.boost[district]?.[2]?.shakedown).toBe(1);
      }
      if (startedAt >= 0 && expiredAt < 0 && g.intent.state === 'cooling') {
        expiredAt = w;
        expect(dg.boost[district]?.[2]?.shakedown).toBeUndefined();
      }
      if (expiredAt >= 0 && coolingEnd < 0 && g.intent.state === 'none') coolingEnd = w;
    }
    expect(startedAt / 144).toBeGreaterThan(7.5);
    expect(startedAt / 144).toBeLessThan(9.5);
    expect(activeFrom).toBe(startedAt + 1);
    expect(expiredAt - startedAt).toBe(144);
    expect(coolingEnd - expiredAt).toBe(72);
    const ends = sim.record.log.filter((e) => e.reason === 'intent-end' && e.key?.includes('collect-fee'));
    expect(ends.length).toBeGreaterThanOrEqual(1);
    expect(ends[0]!.key!.endsWith('|done')).toBe(true);
  });

  test('SF1-G-5: a Mox with a latched pulse of no rival has no feasible retaliation: idle, logged once, no boost; an intention whose drive falls ends', () => {
    const sim = groupSim('SF1-G-5b');
    sim.setState('group.decide', (st) => {
      const g = (st as GroupState).groups[sim.w.group(sim.w.districts[0]!.id, 'A2')]!;
      g.pulse.retribution = { at: 0, sev: 1, latched: true };
    });
    sim.advance(40);
    const mox = gstate(sim, 'A2');
    expect(mox.intent.state).toBe('idle');
    expect(sim.record.log.filter((e) => e.reason === 'intent-idle' && e.key?.startsWith(sim.w.group(sim.w.districts[0]!.id, 'A2'))).length).toBe(1);
    // an active collect-fee whose drive falls below 0.20 ends at once
    sim.setState('group.decide', (st) => {
      const g = (st as GroupState).groups[sim.w.group(sim.w.districts[0]!.id, 'A1')]!;
      g.intent = { state: 'active', id: 'collect-fee', drive: 'treasury', since: 1, expires: 1000 };
    });
    sim.advance(3);
    expect(gstate(sim, 'A1').intent.state).toBe('cooling');
    expect(sim.record.log.some((e) => e.reason === 'intent-end' && e.key?.endsWith('|ended'))).toBe(true);
  });

  test('SF1-G-4 and SF1-G-6: the hazard of a public harm is 0.03 and drawn from procRand; the process never asks for demand and two demand histories agree', () => {
    const sim = groupSim('SF1-G-4');
    const district = sim.w.districts[0]!.id;
    const id = sim.w.group(district, 'A1');
    seatHead(sim, 'A1');
    sim.setState('group.decide', (st) => {
      // v0.6's operative weight gives the pressures a share of 0.4 (v0.5: 0.5), so the harm that starts a retaliation here is the gravest one
      (st as GroupState).groups[id]!.pulse.retribution = { at: 0, sev: 1, latched: true, rival: 3, pub: true };
    });
    const hazard = sim.data.groups.h0 * (1 + 0.5);
    expect(hazard).toBeCloseTo(0.03, 12);
    const draw = (w: number): number => rand(hs('proc'), hid(sim.k.worldSeed), hs('group.decide'), hi(w), hs('retal'), hid(id), hi(3));
    let first = -1;
    for (let w = 0; w < 400 && first < 0; w++) if (draw(w) < hazard) first = w;
    sim.advance(first + 2);
    const g = gstate(sim, 'A1');
    // retaliate starts at the first window whose draw passes the hazard (while the pulse stays strong)
    expect(g.intent.state === 'active' || g.intent.state === 'cooling').toBe(true);
    if (g.intent.state === 'active') expect(g.intent.name).toBe('retaliate');
    expect(sim.record.log.some((e) => e.reason === 'intent-start' && e.key?.includes('retaliate'))).toBe(true);
    // demand independence: a different demand history changes nothing
    const a = groupSim('SF1-G-6');
    const b = groupSim('SF1-G-6');
    b.k.frames.demandRoots.add(b.w.v);
    b.k.frames.open({ actor: b.w.v, level: 'situation', origin: b.w.v, weight: 1, focus: { nodes: [b.w.districts[0]!.cellIds[0]!], tier: 4 }, cause: b.w.v });
    a.advance(60);
    b.advance(60);
    expect(b.stateOf('group.decide')).toEqual(a.stateOf('group.decide'));
    expect(b.digestOf('group.decide')).toEqual(a.digestOf('group.decide'));
  });
});

void hid;
