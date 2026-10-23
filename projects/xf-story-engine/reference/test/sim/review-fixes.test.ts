// The fixes of the independent review of the simulation layer (SIM-01 to SIM-15) and the rulings of S1 v0.3, one regression test each.
// Every test here fails on the code the review was made against.

import { describe, expect, test } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, id as hid, mintedId, s as hs } from '../../src/id.ts';
import type { Change, Id } from '../../src/types.ts';
import { Layer2, type Instance } from '../../src/seeding/layer2.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { L2Registry } from '../../src/seeding/registries.ts';
import type { FactsTable, Pack, Pred } from '../../src/seeding/types.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import type { DistrictIndex } from '../../src/sim/index-types.ts';
import type { ActsState } from '../../src/sim/proc-acts.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { Sim } from '../../src/sim/sim.ts';
import { NO_BOOSTS } from '../../src/sim/cast.ts';
import { lintKinds } from '../../src/sim/kinds.ts';
import { unionOf } from '../../src/sim/protection.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { MINI_ID, miniPack } from '../s2/mini.ts';
import { child, eventsState, inject, quietData, quietSim, seedOf, withSecondDistrict } from './helpers.ts';

const W = 600;
const cause = H(hs('fx'), hs('review-fixes'));
const FACTS: FactsTable = { q112_done: {}, x: {}, y: {}, flag: {} };

/** Every event Change the kernel emits from now on, in order. */
function watchEvents(sim: Sim): Id[] {
  const seen: Id[] = [];
  const emit = sim.k.emit.bind(sim.k);
  sim.k.emit = (change: Change, time?: number) => {
    if (change.c === 'event') seen.push(change.event);
    emit(change, time);
  };
  return seen;
}

describe('SIM-01: a closing condition sees every value a read passed through, those at one time included', () => {
  /** A festival at its maximum dwell ends in the window a crackdown arrives in; the feed and the events are given the same second. */
  function equalTimes(name: string) {
    const sim = Sim.create({
      worldSeed: seedOf(name), index: fx3Slice(), only: ['city.events'],
      data: quietData((d) => {
        d.events.offspring = [0, 0, 0, 0];
        for (const r of d.regimes) r.arrival = 0;
        const fest = d.regimes.find((r) => r.kind === 'festival')!;
        fest.plannedLength = fest.maxDwell;
      }),
    });
    const l2 = attachLayer2(sim, { port: new ScriptPort(), facts: FACTS, reg: new L2Registry() });
    const person = sim.k.root('npc', 'core:person');
    sim.k.addEdge({ type: 'core:located-in', from: person, to: sim.w.city, cause });
    sim.k.pin({ node: person, slot: 'age', value: 35, reason: 'authored', cause });
    const district = sim.w.districts[0]!.id;
    const fest = sim.data.regimes.find((r) => r.kind === 'festival')!;
    const w = 400;
    sim.startAt(w - 2);
    sim.setState('city.events', (st) => {
      (st as EventsState).regimes.push({
        id: H(hs('fixture-regime'), hid(district)), kind: 'festival', scope: district, start: (w - fest.maxDwell) * W, startW: w - fest.maxDwell, plannedLength: fest.plannedLength,
        maxDwell: fest.maxDwell, size: 3, effects: fest.effects, closes: fest.closes, priceShift: fest.priceShift,
      });
    });
    return { sim, l2, district, w };
  }

  const seedWith = (closes: Pred): Pack => miniPack({}, { windows: [{ id: 'w', opens: { city: { regimeIs: { scope: 'fx_d1', kind: 'festival' } }, is: ['yes'] } as never, closes: closes as never, onClose: 'withdraw' }] });

  function run(name: string, closes: Pred, patch: boolean) {
    const { sim, l2, w } = equalTimes(name);
    const pack = seedWith(closes);
    expect(l2.installPack(pack)).toEqual([]);
    sim.advance(1);
    expect(sim.reads.eval('regime', ['fx_d1'])).toBe('festival');
    const sown = l2.sow(pack.id, MINI_ID);
    expect(sown.ok, JSON.stringify(sown.findings)).toBe(true);
    const inst = l2.instance(sown.instance!)! as Instance;
    sim.k.settle();
    expect(inst.st.latches).toEqual([]);
    sim.data.regimes.find((r) => r.kind === 'crackdown')!.arrival = 5760;
    sim.advance(1);
    const T = w * W;
    if (patch) {
      // the crackdown starts in the second the festival ends: the two changes share a time, the end made first
      const batch = sim.k.evolution.states.get('city.events')!.outstanding.find((b) => b.ops.some((op) => op.op === 'mint-event' && op.spec.kind === 'regime-start'))!;
      for (const op of batch.ops) if (op.op === 'mint-event' && op.spec.kind === 'regime-start') op.spec.time = T;
      for (const win of (batch.digest as { changes: { windows: Array<{ items: Array<{ t: number; value: string }> }> } }).changes.windows) for (const it of win.items) if (it.value === 'crackdown') it.t = T;
    }
    sim.advance(1);
    sim.k.settle();
    return { sim, inst, T };
  }

  test('the read gives the transitions at one time in the order they were made, through the port layer 2 is handed', () => {
    const { sim, T } = run('R1-01a', { city: { regime: { scope: 'fx_d1' } }, is: ['none'] } as never, true);
    const port = sim.reads.port();
    const t = port.transitions('regime', ['fx_d1'], T - 1, T);
    expect(t).toEqual([{ t: T - 1, value: 'festival' }, { t: T, value: 'none' }, { t: T, value: 'crackdown' }]);
    // eval at that time alone answers the last of them, which is why a closing condition needs the rest
    expect(port.eval('regime', ['fx_d1'], T)).toBe('crackdown');
  });

  test('a window that closes on regime = none latches though the crackdown starts in the same second; a condition no value met does not', () => {
    const closed = run('R1-01b', { city: { regime: { scope: 'fx_d1' } }, is: ['none'] } as never, true);
    expect(closed.inst.st.latches).toEqual(['w']);
    // a condition that none of the values satisfied stays open: the walk through the values does not latch what was never true
    const other = run('R1-01c', { city: { regime: { scope: 'fx_d1' } }, is: ['lockdown'] } as never, true);
    expect(other.inst.st.latches).toEqual([]);
  });

  test('with the changes at different times the window latched before, and still does', () => {
    const { inst } = run('R1-01d', { city: { regime: { scope: 'fx_d1' } }, is: ['none'] } as never, false);
    expect(inst.st.latches).toEqual(['w']);
  });
});

void Layer2;
void ReplayPort;
void child;
void eventsState;
void inject;
void watchEvents;

// ---- helpers for the reload scenarios ----

/** An authored `protects` frame of `actor` over harm to `friend`: authored frames come from their seeds, which a load restates. */
function protect(sim: Sim, actor: Id, friend: Id): void {
  sim.k.frames.open({
    actor, level: 'concern', origin: H(hs('fixture-frame'), hs('protect'), hid(actor)), weight: 1, cause: sim.w.city,
    own: { protects: [{ slot: '*', scope: { nodes: [friend] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] },
  });
  sim.k.settle();
}

describe('SIM-02: the occurrence a load forgot is restored, not published again', () => {
  test('an outage of size 3 in the ring: after a save and a load its header is gone, remint gives the same Id and fields and publishes nothing', () => {
    const sim = Sim.create({ worldSeed: seedOf('R1-02'), index: fx3Slice(), only: ['city.events'], data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }) });
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    sim.startAt(100);
    inject(sim, child(sim, 'outage', 0, 101, 'outage', 3, c1));
    const emitted = watchEvents(sim);
    sim.advance(3);
    const entry = eventsState(sim).ring.find((e) => e.event !== undefined && e.kind === 'outage')!;
    expect(entry).toBeDefined();
    const id = entry.id;
    expect(emitted.filter((e) => e === id)).toEqual([id]);
    const fields = (): unknown[] => ['time', 'place', 'kind', 'participants#count', 'effects#count'].map((slot) => sim.k.value(id, slot));
    const before = fields();
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    // the load keeps the headers a root holds: nothing holds this event, so it is gone and an ordinary mint would be a new occurrence
    expect(sim.k.store.header(id)).toBeUndefined();
    const announced = emitted.length;
    expect(sim.remint(id)).toBe(id);
    expect(emitted.length).toBe(announced);
    expect(fields()).toEqual(before);
    // and a header that survived is restored just the same
    sim.k.persistence.save('B');
    sim.k.persistence.load('B');
    expect(sim.remint(id)).toBe(id);
    expect(emitted.length).toBe(announced);
    expect(fields()).toEqual(before);
  });
});

describe('SIM-03: a memorable belief keeps the facts of its source event through a load, and after the ring has forgotten it', () => {
  /** A teller with a memorable belief about a harm done to a friend of the listener, whose protects frame makes it worth telling. */
  function teller(name: string) {
    const sim = quietSim(name, (d) => { d.minds.tellBase = 1e9; d.events.offspring = [0, 0, 0, 0]; });
    new ReplayPort(sim).submit([{ t: 0, op: 'person', key: 'mv', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } }]);
    sim.advance(1);
    const d = sim.w.districts[0]!;
    const who = sim.people.residentAt(d.cellIds[0]!, 0);
    const listener = sim.people.residentAt(d.cellIds[1]!, 0);
    const victim = sim.people.residentAt(d.cellIds[2]!, 0);
    const mv = new ReplayPort(sim).node('mv');
    sim.spine.add(mv);
    protect(sim, listener, victim);
    const k = sim.k;
    const E = k.events.mintEvent({
      creator: sim.w.port, cause: sim.w.port, name: 'src', time: 1000, kind: 'assault', place: d.cellIds[0]!,
      participants: [{ who: mv, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [who],
    });
    const b = { believer: who, subject: mv, path: 'did.harm', at: 1000, value: victim, confidence: 1, evidence: [E], source: { by: 'observed' as const, event: E }, formed: k.now, refreshed: k.now, memorable: true };
    k.beliefs.set(b);
    const belief = () => k.beliefs.activeOf(who).find((x) => x.path === 'did.harm')!;
    const reload = (key: string): void => {
      k.persistence.save(key);
      k.persistence.load(key);
      protect(sim, listener, victim);
    };
    return { sim, who, listener, E, belief, reload, mv };
  }

  test('after a load the telling score reads the event as it did, with nobody minting the event again', () => {
    const { sim, who, listener, E, belief, reload } = teller('R1-03a');
    const view = sim.policies.viewEvent(E)!;
    const score = sim.policies.tellScore(belief(), who, listener);
    expect(score).toBeGreaterThan(0);
    reload('A');
    expect(sim.policies.viewEvent(E)).toEqual(view);
    expect(sim.policies.tellScore(belief(), who, listener)).toBe(score);
  });

  test('the telling decisions of a loaded run are those of the run that never loaded', () => {
    const run = (reload: boolean): string[] => {
      const t = teller('R1-03b');
      if (reload) t.reload('A');
      for (let w = 1; w <= 12; w++) t.sim.policies.encounter(t.who, t.listener, w);
      return t.sim.record.log.filter((e) => e.proc === 'social').map((e) => `${e.reason}|${e.key}`);
    };
    const straight = run(false);
    expect(straight.length).toBeGreaterThan(0);
    expect(run(true)).toEqual(straight);
  });

  test('the event stays readable when the ring has long forgotten it: a week and more later, through two more loads', () => {
    const { sim, who, listener, E, belief, reload } = teller('R1-03c');
    const view = sim.policies.viewEvent(E)!;
    const score = sim.policies.tellScore(belief(), who, listener);
    reload('A');
    sim.advance(1100);
    expect(eventsState(sim).ring.every((e) => sim.windowNow() - e.w < 1008)).toBe(true);
    reload('B');
    expect(sim.policies.viewEvent(E)).toEqual(view);
    expect(sim.policies.tellScore(belief(), who, listener)).toBe(score);
  });

  test('restoring the events of a loaded save announces none of them', () => {
    const { sim, E, reload } = teller('R1-03d');
    const emitted = watchEvents(sim);
    reload('A');
    expect(emitted).toEqual([]);
    expect(sim.policies.viewEvent(E)).toBeDefined();
  });
});

describe('SIM-04: the protected set of a past time survives a save, so a regenerated occurrence casts the same people', () => {
  /** An assault at a moment with many people present, with the victim the cast draws; the same for the same world seed. */
  function moment(name: string) {
    const sim = quietSim(name, (d) => { d.events.offspring = [0, 0, 0, 0]; });
    for (let day = 0; day < 6; day++) {
      for (const cell of sim.w.districts[0]!.cellIds) {
        for (const hour of [9, 12, 15, 18]) {
          const time = day * 86400 + hour * 3600 + 30;
          const id = H(hs('r1-04'), hs(name), hid(cell), hs(String(time)));
          const d = { id, kind: 'assault', size: 1, w: Math.floor(time / W), time, cell, gen: 0, chain: [] as Id[], public: false, witnesses: 0, sides: sim.casting.drawSides(id, cell, 'assault', NO_BOOSTS) };
          const cast = sim.casting.cast(d);
          if (cast === 'no-cast') continue;
          const victim = cast.find((e) => e.role === 'victim')?.who;
          if (victim !== undefined && sim.people.presentAt(cell, time).length >= 5) return { sim, d, victim };
        }
      }
    }
    throw new Error('no moment');
  }

  /** A cast edge of a live seed over the victim, live for 300 s around the moment, then ended; the world runs on to well after it. */
  function protectedThenOver(name: string) {
    const m = moment(name);
    const { sim, d, victim } = m;
    const seed = sim.k.root(`live-seed-${name}`, 'core:seed');
    sim.k.retention.setSeed({ id: seed, state: {}, nodes: [victim] });
    const edge = sim.k.addEdge({ type: 'core:cast', from: seed, to: victim, data: { role: 'target' }, cause: seed, valid: { from: d.time - 1 } });
    sim.k.endEdge(edge.id, d.time + 300);
    sim.advance(Math.ceil((d.time + 3600) / W) - sim.windowNow());
    expect(sim.k.now).toBeGreaterThan(d.time + 300);
    return m;
  }

  test('a cast edge that ended before the save still protects at the time it was live, and a regenerated cast does not choose the person', () => {
    const { sim, d, victim } = protectedThenOver('R1-04a');
    expect(sim.people.protectedAt(victim, d.time)).toBe(true);
    expect(sim.people.protectedAt(victim, d.time + 400)).toBe(false);
    const cast = sim.casting.cast(d);
    expect(cast).not.toBe('no-cast');
    expect((cast as Array<{ role: string; who?: Id }>).find((e) => e.role === 'victim')?.who).not.toBe(victim);
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    // the load dropped the ended edge; the record kept the span
    expect(sim.k.store.edgesTo(victim).filter((e) => e.type === 'core:cast')).toEqual([]);
    expect(sim.people.protectedAt(victim, d.time)).toBe(true);
    expect(sim.people.protectedAt(victim, d.time + 400)).toBe(false);
    expect(sim.casting.cast(d)).toEqual(cast);
    // and so does the next save, with nothing live
    sim.k.persistence.save('B');
    sim.k.persistence.load('B');
    expect(sim.people.protectedAt(victim, d.time)).toBe(true);
  });

  test('where a protected resident was is read from the same history: present at the time of the protection, before and after a load', () => {
    const { sim, victim, d } = protectedThenOver('R1-04b');
    const before = sim.people.where(victim, d.time);
    expect(before.cause).toBe('protected-present');
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    expect(sim.people.where(victim, d.time)).toEqual(before);
  });

  test('a person the game called quest-linked for a while was protected then, and is still said to have been after a load', () => {
    const sim = quietSim('R1-04c');
    const port = new ReplayPort(sim);
    port.submit([
      { t: 0, op: 'person', key: 'q', slots: { affiliation: 'civilian', alive: 'yes', 'quest-linked': 'yes' } },
      { t: 700, op: 'person', key: 'q', slots: { 'quest-linked': 'no' } },
    ]);
    sim.advance(4);
    const q = port.node('q');
    expect(sim.people.protectedAt(q, 100)).toBe(true);
    expect(sim.people.protectedAt(q, 900)).toBe(false);
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    expect(sim.people.protectedAt(q, 100)).toBe(true);
    expect(sim.people.protectedAt(q, 900)).toBe(false);
  });

  test('the record of the spans is the union of them, so a game that restates a reading after a load does not change it', () => {
    expect(unionOf([{ from: 10, to: 20 }, { from: 15, to: 30 }, { from: 30, to: 40 }, { from: 100 }, { from: 150, to: 160 }, { from: 5, to: 5 }])).toEqual([{ from: 10, to: 40 }, { from: 100 }]);
    expect(unionOf([{ from: 0 }, { from: 7, to: 9 }])).toEqual([{ from: 0 }]);
  });
});

describe('SIM-05: what is cached of a resident depends on every rule that reaches it', () => {
  const adultOf = (sim: Sim): Id => sim.people.residentsOfBlock(sim.w.districts[0]!.cellIds[0]!).find((r) => sim.people.view(r)!.ageClass === 'adult' && sim.people.view(r)!.age > 25)!;
  const kindWide = (sim: Sim, valid: { from?: number; to?: number } = {}): void => {
    sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { kind: 'xf:resident', slot: 'age' }, form: { f: 'const', value: 17 }, mode: 'constrain', valid });
  };

  test('an authored kind-wide age constraint reaches a resident whose view was warm, and the gate is told the age class the kernel resolves', () => {
    const sim = quietSim('R1-05a');
    const r = adultOf(sim);
    const warm = sim.people.view(r)!;
    expect(warm.ageClass).toBe('adult');
    expect(sim.gate.ageClassOf(r, 0)).toBe('adult');
    kindWide(sim);
    expect(sim.k.value(r, 'age')).toBe(17);
    expect(sim.k.value(r, 'age-class')).toBe('minor');
    expect(sim.people.view(r)!.age).toBe(17);
    expect(sim.people.view(r)!.ageClass).toBe('minor');
    expect(sim.gate.ageClassOf(r, 0)).toBe('minor');
    // the cache off gives the same
    sim.people.cacheOn = false;
    expect(sim.people.view(r)!.age).toBe(17);
  });

  test('a world that shares its memo with a pristine one does not take the pristine views once a rule over the kind is added', () => {
    const a = quietSim('R1-05b');
    const b = quietSim('R1-05b');
    const r = adultOf(a);
    expect(a.people.view(r)!.ageClass).toBe('adult');
    b.people.residentsOfBlock(b.w.districts[0]!.cellIds[0]!);
    kindWide(b);
    expect(b.people.view(r)!.age).toBe(17);
    expect(b.people.view(r)!.ageClass).toBe('minor');
    // the pristine world is unchanged by the other
    expect(a.people.view(r)!.ageClass).toBe('adult');
  });

  test('a rule that opens and closes at times of its own is seen at those times, with nothing else changed', () => {
    const sim = quietSim('R1-05c');
    const r = adultOf(sim);
    const was = sim.people.view(r)!.age;
    kindWide(sim, { from: 1000, to: 2200 });
    expect(sim.people.view(r)!.age).toBe(was);
    sim.advance(2); // 1200
    expect(sim.people.view(r)!.age).toBe(17);
    sim.advance(1); // 1800
    expect(sim.people.view(r)!.age).toBe(17);
    sim.advance(2); // 3000
    expect(sim.people.view(r)!.age).toBe(was);
  });

  test('a rule ended explicitly stops reaching the resident', () => {
    const sim = quietSim('R1-05d');
    const r = adultOf(sim);
    const was = sim.people.view(r)!.age;
    sim.advance(1);
    const c = sim.k.contribute({ source: { layer: 'authored', origin: cause }, target: { kind: 'xf:resident', slot: 'age' }, form: { f: 'const', value: 17 }, mode: 'constrain' });
    expect(sim.people.view(r)!.age).toBe(17);
    sim.advance(1);
    sim.k.endContribution(c.id, sim.k.now);
    expect(sim.people.view(r)!.age).toBe(was);
  });
});

describe('SIM-07 and SIM-11: a materialised tie that ended opens again under its Id, and the past of tied is not rewritten', () => {
  /** A pair with no implicit tie and a pair with one, among the residents of FX-3. */
  function pairs(sim: Sim): { loose: [Id, Id]; tied: [Id, Id] } {
    const all = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
    let loose: [Id, Id] | undefined;
    let tied: [Id, Id] | undefined;
    for (let i = 0; i < all.length && !(loose && tied); i++) {
      for (let j = i + 1; j < all.length && !(loose && tied); j++) {
        const t = sim.ties.tie(all[i]!, all[j]!);
        if (!t) continue;
        if (t.tied) tied ??= [all[i]!, all[j]!];
        else loose ??= [all[i]!, all[j]!];
      }
    }
    return { loose: loose!, tied: tied! };
  }
  const at = (sim: Sim, p: [Id, Id], t: number, type: unknown = 'xf:tie'): string => sim.reads.eval('tied', [p[0], p[1], type], t);

  test('materialise, end, materialise: the second tie is live under the same Id, and the intervals are kept for the reads of the past', () => {
    const sim = quietSim('R1-07a');
    const { loose } = pairs(sim);
    sim.advance(2); // 1200
    const first = sim.tiePolicy.materialise(loose[0], loose[1])!;
    expect(sim.tiePolicy.hasEdge(...loose)).toBe(true);
    sim.advance(2); // 2400
    sim.k.endEdge(first.id, sim.k.now);
    expect(sim.tiePolicy.hasEdge(...loose)).toBe(false);
    sim.advance(2); // 3600
    const second = sim.tiePolicy.materialise(loose[0], loose[1])!;
    expect(second.id).toBe(first.id);
    expect(sim.tiePolicy.hasEdge(...loose)).toBe(true);
    expect(second.valid).toEqual({ from: 3600 });
    expect(sim.tiePolicy.statusOf(...loose)).toBe('acquainted');
    sim.advance(2); // 4800
    expect(at(sim, loose, 600)).toBe('no');
    expect(at(sim, loose, 1500)).toBe('yes');
    expect(at(sim, loose, 2800)).toBe('no');
    expect(at(sim, loose, 4000)).toBe('yes');
    expect(at(sim, loose, 4800)).toBe('yes');
    // the transitions are those of the two intervals
    expect(sim.reads.transitions('tied', [loose[0], loose[1], 'xf:tie'], 0, 4800)).toEqual([
      { t: 0, value: 'no' }, { t: 1200, value: 'yes' }, { t: 2400, value: 'no' }, { t: 3600, value: 'yes' },
    ]);
  });

  test('after a save and a load the ended interval is still known, and a tie can be reopened again', () => {
    const sim = quietSim('R1-07b');
    const { loose } = pairs(sim);
    sim.advance(2);
    const first = sim.tiePolicy.materialise(loose[0], loose[1])!;
    sim.advance(2);
    sim.k.endEdge(first.id, sim.k.now);
    sim.advance(2);
    sim.k.persistence.save('A');
    sim.k.persistence.load('A');
    // the load dropped the ended edge
    expect(sim.k.store.edges.get(first.id)).toBeUndefined();
    pairs(sim); // the people are addressed again, as whatever asks about them does
    expect(at(sim, loose, 1500)).toBe('yes');
    expect(at(sim, loose, 3000)).toBe('no');
    const again = sim.tiePolicy.materialise(loose[0], loose[1])!;
    expect(again.id).toBe(first.id);
    expect(again.valid).toEqual({ from: sim.k.now });
    expect(at(sim, loose, 1500)).toBe('yes');
    expect(at(sim, loose, sim.k.now + 1)).toBe('yes');
    sim.advance(1);
    expect(at(sim, loose, 1500)).toBe('yes');
    expect(at(sim, loose, 3000)).toBe('no');
  });

  test('an implicit tie is not unmade in the past when it is materialised later, and a type other than xf:tie is not built', () => {
    const sim = quietSim('R1-11');
    const { tied } = pairs(sim);
    expect(at(sim, tied, 0)).toBe('yes');
    sim.advance(2);
    sim.tiePolicy.materialise(tied[0], tied[1]);
    expect(at(sim, tied, 0)).toBe('yes');
    expect(at(sim, tied, 600)).toBe('yes');
    expect(at(sim, tied, sim.k.now)).toBe('yes');
    expect(sim.reads.transitions('tied', [tied[0], tied[1], 'xf:tie'], 0, sim.k.now)).toEqual([{ t: 0, value: 'yes' }]);
    expect(at(sim, tied, 0, 'core:member-of')).toBe('maybe');
    expect(at(sim, tied, sim.k.now, 'core:member-of')).toBe('maybe');
    expect(sim.reads.transitions('tied', [tied[0], tied[1], 'core:member-of'], 0, sim.k.now)).toEqual([{ t: 0, value: 'maybe' }]);
  });
});

describe('SIM-12: a save that needs a function that is gone opens read-only, and S1 writes nothing', () => {
  test('the load reports the compatibility and does not throw; reads still answer', () => {
    const sim = quietSim('R1-12', (d) => { d.events.offspring = [0, 0, 0, 0]; });
    sim.advance(3);
    const rec = sim.k.persistence.save('A');
    rec.meta.versions.push('derive:review-custom@1');
    const report = sim.k.persistence.load('A');
    expect(report.readOnly).toBe(true);
    expect(report.message).toContain('derive:review-custom@1');
    expect(sim.k.readOnly).not.toBeNull();
    expect(sim.reads.eval('regime', ['fx_d1'])).not.toBe('maybe');
    // another load, of a save that does not need it, opens the world again
    rec.meta.versions.pop();
    expect(sim.k.persistence.load('A').readOnly).toBe(false);
    sim.advance(1);
  });
});

describe('SIM-13: the evidence of one origin is counted once, whichever way the audience is written', () => {
  test('two carriers with the same origin at the same reach and opposite verdicts: the aggregate is the same for either order', () => {
    const sim = quietSim('R1-13');
    const d = sim.w.districts[0]!;
    const axis = sim.data.ledger.axes[0]!;
    const origin = H(hs('origin'), hs('r1-13'));
    const carriers = [sim.w.circle(d.id), sim.w.group(d.id, 'A1')];
    carriers.forEach((node, i) => {
      sim.k.beliefs.set({
        believer: node, subject: sim.w.v, path: `rep-${axis}[0]`, at: 1000, value: [i === 0 ? 1 : -1, 0.5], confidence: sim.data.ledger.confidence.witnessed, evidence: [origin],
        source: { by: 'observed', event: origin }, formed: 0, refreshed: 0, memorable: true,
      });
    });
    const forward = sim.ledger.aggregate(carriers, sim.w.v, axis, Infinity);
    const backward = sim.ledger.aggregate([...carriers].reverse(), sim.w.v, axis, Infinity);
    expect(backward).toEqual(forward);
    expect(forward.items).toBe(1);
    // the carrier of the smaller Id is the one counted
    const first = [...carriers].sort()[0]!;
    const only = sim.ledger.aggregate([first], sim.w.v, axis, Infinity);
    expect(forward.E).toBe(only.E);
  });
});

describe('SIM-14: a told reason assimilates to what the listener expects of the actor’s group', () => {
  test('a harm attribution with the reasons {cruel, hostile} becomes the reasons of that act, not those of a meeting', () => {
    const sim = quietSim('R1-14', (d) => { d.minds.tellBase = 1e9; d.minds.wD = 0.5; });
    const d = sim.w.districts[0]!;
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'a', slots: { affiliation: d.affOrder[2]!, alive: 'yes', 'age-class': 'adult' } }]);
    sim.advance(1);
    const actor = port.node('a');
    const classOf = (affc: number): Id => d.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).find((r) => sim.people.view(r)!.affc === affc && sim.people.view(r)!.ageClass === 'adult')!;
    const victim = classOf(0);
    const E = sim.k.events.mintEvent({
      creator: sim.w.port, cause: sim.w.port, name: 'r1-14', time: 1000, kind: 'assault', place: d.cellIds[0]!,
      participants: [{ who: actor, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }],
    });
    const reason = {
      id: H(hs('belief'), hs('r1-14')), believer: classOf(0), subject: actor, path: 'reason', at: 1000, region: { r: 'set' as const, values: ['cruel', 'hostile'] }, confidence: 0.9,
      evidence: [E], source: { by: 'inferred' as const, rule: { name: 'attr', version: 1 }, from: [E] }, formed: 0, refreshed: 0, memorable: true,
    };
    const dispositional = ['cruel', 'hostile'];
    const situational = ['accidental', 'defending', 'pressured'];
    // a listener of the actor's own group excuses them; one of no group, or of another, expects the worst (attr@1 with wD 0.5, tilted by the attitude)
    const sameGroup = sim.policies.toldBelief(reason as never, classOf(2), 'assimilate');
    expect(sameGroup.region).toEqual({ r: 'set', values: situational });
    const civilian = sim.policies.toldBelief(reason as never, classOf(0), 'assimilate');
    expect(civilian.region).toEqual({ r: 'set', values: dispositional });
    // the other operators leave the reasons alone; a belief that is not about reasons is not bent
    expect(sim.policies.toldBelief(reason as never, classOf(2), 'sharpen').region).toBeUndefined();
    expect(sim.policies.toldBelief({ ...reason, path: 'did.harm', region: undefined } as never, classOf(2), 'assimilate').region).toBeUndefined();
    // a reason whose event cannot be read still names its own class
    const lost = { ...reason, evidence: [H(hs('gone'))], source: { by: 'inferred' as const, rule: { name: 'attr', version: 1 }, from: [H(hs('gone'))] } };
    expect(sim.policies.toldBelief(lost as never, classOf(2), 'assimilate').region).toEqual({ r: 'set', values: situational });
  });
});

describe('SIM-15: a kind outside the core is refused, not taken for a supported one', () => {
  test('a deferred routine kind with its own rate and shape row is named in the refusal', () => {
    const data = quietData();
    const theft = data.kinds.find((k) => k.name === 'theft')!;
    data.kinds.push({ ...structuredClone(theft), name: 'serve' });
    data.shape.rate.serve = [...data.shape.rate.theft!] as never;
    data.shape.kinds.serve = structuredClone(data.shape.kinds.theft!);
    const problems = lintKinds(data);
    expect(problems.some((p) => p.includes('serve') && p.includes('not supported yet'))).toBe(true);
    expect(() => Sim.create({ worldSeed: seedOf('R1-15'), index: fx3Slice(), data })).toThrow(/serve.*not supported yet/);
    // the supported kinds alone are clean
    expect(lintKinds(quietData())).toEqual([]);
  });
});

describe('SIM-08: the divergence of a past time is what the log says, not what today’s beliefs say', () => {
  function world(name: string) {
    const sim = quietSim(name, (d) => { d.events.offspring = [0, 0, 0, 0]; });
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'mv', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } }]);
    sim.advance(2); // 1200
    const believer = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    const mv = port.node('mv');
    const believe = (value: string): void => {
      sim.k.beliefs.set({ believer, subject: mv, path: 'alive', at: sim.k.now, value, confidence: 1, evidence: [mv], source: { by: 'inferred', rule: { name: 'test', version: 1 }, from: [mv] }, formed: sim.k.now, refreshed: sim.k.now, memorable: true });
    };
    const read = (t: number): string => sim.reads.eval('divergence', [believer, mv], t);
    return { sim, believer, mv, believe, read };
  }

  test('a contradicting belief formed at 1200 changes the answer from 1200 on, and not the answers for the times before', () => {
    const { sim, believe, read } = world('R1-08a');
    expect(read(0)).toBe('none');
    believe('no');
    expect(read(sim.k.now)).toBe('large');
    sim.advance(3);
    expect(read(0)).toBe('none');
    expect(read(1199)).toBe('none');
    expect(read(1200)).toBe('large');
    expect(read(1500)).toBe('large');
    expect(read(sim.k.now)).toBe('large');
    // and the transitions say the same
    expect(sim.reads.transitions('divergence', [sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0), sim.k.store.idsOfKind('xf:person')[0]!], 0, sim.k.now)[0]).toEqual({ t: 0, value: 'none' });
  });

  test('the log is kept for eight transitions; before the oldest the answer is maybe', () => {
    const { sim, believer, mv, believe, read } = world('R1-08b');
    // the belief is formed and dropped by turns, once a window
    for (let n = 0; n < 12; n++) {
      if (n % 2 === 0) believe('no');
      else sim.k.beliefs.drop(believer, sim.k.beliefs.activeOf(believer).find((b) => b.path === 'alive')!.id);
      sim.advance(1);
    }
    const log = sim.record.divLog[`${believer}|${mv}`]!;
    expect(log.length).toBe(8);
    expect(read(0)).toBe('maybe');
    expect(read(log[0]!.t - 1)).toBe('maybe');
    expect(read(log[0]!.t)).toBe(log[0]!.value);
    expect(read(log[log.length - 1]!.t)).toBe(log[log.length - 1]!.value);
    expect(sim.reads.transitions('divergence', [believer, mv], 0, sim.k.now)[0]).toEqual({ t: 0, value: 'maybe' });
  });
});

describe('SIM-09: groupGap says what the group maintains, the same for now and for the transitions', () => {
  test('a group inside its hysteresis band keeps the band it had: the read, the digest and the transition agree', () => {
    const run = (tweak: (d: ReturnType<typeof quietData>) => void, init: 0 | 1 | 2) => {
      const sim = Sim.create({ worldSeed: seedOf('R1-09'), index: fx3Slice(), data: quietData(tweak), only: ['group.decide'] });
      const g = sim.w.group(sim.w.districts[0]!.id, 'A1');
      sim.setState('group.decide', (st) => { (st as { groups: Record<Id, { gapBand: number }> }).groups[g]!.gapBand = init; });
      sim.advance(3);
      return { sim, g };
    };
    // the divergence of the group in a quiet world, to put the thresholds around it
    const base = run(() => {}, 0);
    const D = base.sim.digestOf<{ groups: Record<Id, { D: number }> }>('group.decide')!.groups[base.g]!.D;
    expect(D).toBeGreaterThan(0);
    const { sim, g } = run((d) => { d.groups.gapBands = { ...d.groups.gapBands, mid: D + 0.01, leaveMid: D - 0.01, low: D - 0.05, leaveLow: D - 0.06 }; }, 2);
    const dg = sim.digestOf<{ groups: Record<Id, { D: number; band: number }> }>('group.decide')!;
    // D is under the threshold to enter the band `high`, over the one to leave it: the group stays in it
    expect(dg.groups[g]!.D).toBe(D);
    expect(dg.groups[g]!.band).toBe(2);
    expect(sim.reads.eval('groupGap', [g])).toBe('high');
    // and a group that was not in it does not enter
    const out = run((d) => { d.groups.gapBands = { ...d.groups.gapBands, mid: D + 0.01, leaveMid: D - 0.01, low: D - 0.05, leaveLow: D - 0.06 }; }, 1);
    expect(out.sim.reads.eval('groupGap', [out.g])).toBe('mid');
    // the value now is the last of the transitions
    const t = sim.reads.transitions('groupGap', [g], 0, sim.k.now);
    expect(t[t.length - 1]!.value).toBe(sim.reads.eval('groupGap', [g]));
  });
});

describe('SIM-10: a reputation read accepts the carrier’s node as well as its name', () => {
  test('label of the stallholders’ circle by node and by name give the same answer once the ledger has run', () => {
    const sim = quietSim('R1-10', (d) => { d.events.offspring = [0, 0, 0, 0]; }, ['city.events', 'order.ledger']);
    const axis = sim.data.ledger.axes[0]!;
    const node = sim.w.circle(sim.w.districts[0]!.id);
    expect(sim.reads.eval('label', [node, 'v', axis])).toBe('maybe');
    sim.advance(3);
    const byName = sim.reads.eval('label', ['stalls', 'v', axis]);
    expect(byName).not.toBe('maybe');
    expect(sim.reads.eval('label', [node, 'v', axis])).toBe(byName);
    expect(sim.reads.eval('label', [node, sim.w.v, axis])).toBe(byName);
    // the port layer 2 is handed answers the same, and the district itself is a carrier too
    expect(sim.reads.port().eval('label', [node, 'v', axis], sim.k.now)).toBe(byName);
    expect(sim.reads.eval('label', [sim.w.districts[0]!.id, 'v', axis])).not.toBe('maybe');
    expect(sim.reads.eval('label', ['nobody', 'v', axis])).toBe('maybe');
  });
});

describe('S1 10.2 (v0.3): the window V arrives in is covered', () => {
  const eventsProc = processCause('city.events');
  const summaryOf = (w: number, cell: Id, kind = 'theft'): Id => mintedId(eventsProc, eventsProc, `sum/${w}/${cell}/${kind}`);
  const make = (name: string) => Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }), only: ['city.events', 'scene.acts'] });
  const actsState = (sim: Sim): ActsState => sim.k.evolution.states.get('scene.acts')!.state as ActsState;

  test('a reading of V’s cell applied at boundary j puts the cell in the recorded focus of window j, and the items of that window are opened', () => {
    const sim = make('R1-109a');
    const [c1] = sim.w.districts[0]!.cellIds as [Id];
    const j = 100;
    // stamped in window j - 1, applied at boundary j: V stands in c1 from the window j on
    new ReplayPort(sim).submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(j);
    inject(sim, child(sim, 'first', 0, j, 'theft', 1, c1), child(sim, 'first', 1, j, 'theft', 1, c1));
    const focus = new Map<number, Id[]>();
    const def = sim.defs.get('scene.acts')!;
    const original = def.run.bind(def);
    def.run = (pctx, k) => {
      const res = original(pctx, k);
      const state = (Array.isArray(res) ? undefined : res.state) as ActsState | undefined;
      if (state?.prev) focus.set(k, [...state.prev.cells]);
      return res;
    };
    sim.advance(3);
    expect(focus.get(j)).toContain(c1);
    expect(sim.k.value(summaryOf(j, c1), 'count')).toBe(2);
    expect(actsState(sim).published.filter((p) => p.w === j).length).toBe(2);
    for (const p of actsState(sim).published) expect(sim.policies.viewEvent(p.item)!.participants.length).toBeGreaterThan(0);
  });

  test('the same in per-window calls and in one call: the order of a boundary does not depend on where the ticks fall', () => {
    const run = (calls: number[]) => {
      const sim = make('R1-109a');
      const [c1] = sim.w.districts[0]!.cellIds as [Id];
      const j = 100;
      new ReplayPort(sim).submit([{ t: (j - 1) * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
      sim.startAt(j);
      inject(sim, child(sim, 'first', 0, j, 'theft', 1, c1), child(sim, 'first', 1, j, 'theft', 1, c1));
      for (const n of calls) sim.advance(n);
      return JSON.stringify([actsState(sim).published.map((p) => [p.w, p.index]), actsState(sim).prev]);
    };
    expect(run([1, 1, 1])).toBe(run([3]));
    expect(JSON.parse(run([3]))[0].length).toBe(2);
  });
});

describe('S1 8.8 (v0.3): a changed affiliation joins the group of the person’s district', () => {
  function twoDistricts() {
    const ix = withSecondDistrict();
    const [first, second] = Object.values(ix.districts).filter((d) => d.simulated).sort((a, b) => (a.id < b.id ? -1 : 1)) as [DistrictIndex, DistrictIndex];
    first.polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    second.polygon = [[20, 0], [30, 0], [30, 10], [20, 10]];
    return { ix, first, second };
  }
  /** A person who becomes `GA`: placed at `position` (or nowhere), then moved. */
  function moved(name: string, position: [number, number, number] | undefined) {
    const { ix, first, second } = twoDistricts();
    const sim = Sim.create({ worldSeed: seedOf(name), index: ix, data: quietData(), only: ['city.events'] });
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'p', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult', ...(position ? { position } : {}) } }]);
    sim.advance(2);
    port.submit([{ t: sim.k.now + 5, op: 'person', key: 'p', slots: { affiliation: 'GA' } }]);
    sim.advance(2);
    const p = port.node('p');
    return { sim, first, second, held: sim.k.groups.memberships(p).map((e) => e.to) };
  }

  test('the group is the one of the district the mirrored position is in, when that district lists the affiliation', () => {
    const inSecond = moved('R1-136a', [25, 5, 0]);
    expect(inSecond.sim.w.districts.map((d) => d.id)).toEqual([inSecond.first.id, inSecond.second.id]);
    expect(inSecond.held).toEqual([inSecond.sim.w.group(inSecond.second.id, 'A1')]);
    const inFirst = moved('R1-136b', [5, 5, 0]);
    expect(inFirst.held).toEqual([inFirst.sim.w.group(inFirst.first.id, 'A1')]);
  });

  test('otherwise it is the group of the first simulated district, in Id order, that lists it: a position outside every district, or none', () => {
    for (const [name, position] of [['R1-136c', [100, 100, 0]], ['R1-136d', undefined]] as const) {
      const r = moved(name, position as [number, number, number] | undefined);
      expect(r.held).toEqual([r.sim.w.group(r.first.id, 'A1')]);
    }
  });

  test('a district that does not list the affiliation is passed over for the first that does', () => {
    const { ix, first, second } = twoDistricts();
    // the second district's gangs are others: the person standing in it joins the group of the first, which lists the affiliation
    second.affOrder = second.affOrder.map((a) => (a === 'GA' ? 'GC' : a));
    const sim = Sim.create({ worldSeed: seedOf('R1-136e'), index: ix, data: quietData(), only: ['city.events'] });
    const port = new ReplayPort(sim);
    port.submit([{ t: 0, op: 'person', key: 'p', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult', position: [25, 5, 0] } }]);
    sim.advance(2);
    port.submit([{ t: sim.k.now + 5, op: 'person', key: 'p', slots: { affiliation: 'GA' } }]);
    sim.advance(2);
    expect(sim.k.groups.memberships(port.node('p')).map((e) => e.to)).toEqual([sim.w.group(first.id, 'A1')]);
  });
});
