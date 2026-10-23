// SF1-X: the production gate, the floors, V, the protected set and casting (S1 5.4, 6, 14.1).

import { describe, expect, test } from 'bun:test';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import { NO_BOOSTS } from '../../src/sim/cast.ts';
import { defaultData, type S1Data } from '../../src/sim/data.ts';
import type { CastEntry, Descriptor, Occurrence } from '../../src/sim/occ.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { Effect, Id } from '../../src/types.ts';
import { fxData, seedOf } from './helpers.ts';

const HOUR = 3600;
const FULL = process.env.S1_FULL === '1';
const DAY = 86400;

/** FX-3 with every incident rate raised, so a short run yields many occurrences. */
function busyData(factor: number, tweak: (d: S1Data) => void = () => {}): S1Data {
  return fxData((d) => {
    for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * factor) as [number, number, number, number];
    tweak(d);
  });
}

const busySim = (name: string, factor: number, tweak?: (d: S1Data) => void, only?: string[]): Sim =>
  Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: busyData(factor, tweak), ...(only ? { only } : {}) });

const settingsNow = (sim: Sim) => sim.k.settings.at(sim.k.now);

/** Every event of the store that the simulation minted for the city (its kinds, not the raw feed or the tellings). */
function cityEvents(sim: Sim): Id[] {
  return sim.k.store.idsOfKind('core:event').filter((e) => {
    const kind = sim.k.value(e, 'kind');
    return typeof kind === 'string' && sim.w.kinds.get(kind)?.family !== 'raw';
  });
}

const descriptor = (sim: Sim, name: string, kind: string, cell: Id, time: number, extra: Partial<Descriptor> = {}): Descriptor => ({
  id: H(hs('fixture-occ'), hs(name)), kind, size: 1, w: Math.floor(time / 600), time, cell, gen: 0, chain: [], public: false, witnesses: 0, ...extra,
});

/** A (cell, time) at which the wanted classes are present and the unwanted are not. */
function findMoment(sim: Sim, present: number[], absent: number[]): { cell: Id; time: number } {
  const d = sim.w.districts[0]!;
  for (let day = 0; day < 7; day++) {
    for (let h = 0; h < 24; h++) {
      for (const cell of d.cellIds) {
        const t = day * DAY + h * HOUR + 1800;
        const here = new Set(sim.people.presentAt(cell, t, sim.data.people.presentCap).map((r) => sim.people.view(r)!.affc));
        if (present.every((f) => here.has(f)) && absent.every((f) => !here.has(f))) return { cell, time: t };
      }
    }
  }
  throw new Error(`no moment with ${present} present and ${absent} absent`);
}

describe('SF1-X-1: a line', () => {
  test('harm.groups at ceiling 0: no count, no summary, no event and no pending child of a kind that lists it; the same run without the line has them', () => {
    const run = (line: boolean, windows: number) => {
      const sim = busySim(`SF1-X-1`, 40);
      if (line) sim.k.settings.set({ content: { ceiling: { 'harm.groups': 0 } } }, 0);
      sim.advance(windows);
      const clashes = [...sim.k.store.idsOfKind('core:event'), ...sim.k.store.idsOfKind('core:summary')].filter((e) => sim.k.value(e, 'kind') === 'gang-clash');
      const st = sim.stateOf<EventsState>('city.events')!;
      const pending = Object.values(st.calendar).flat().filter((c) => c.kind === 'gang-clash').length;
      const counted = (sim.digestOf<{ counts: { windows: Array<{ items: Array<{ kind: string }> }> } }>('city.events')?.counts.windows ?? []).flatMap((w) => w.items).filter((i) => i.kind === 'gang-clash').length;
      return { clashes: clashes.length, pending, counted, ring: st.ring.filter((e) => e.kind === 'gang-clash').length, occurrences: cityEvents(sim).length };
    };
    const open = run(false, 40);
    expect(open.occurrences).toBeGreaterThan(50);
    expect(open.ring).toBeGreaterThan(0);
    const closed = run(true, FULL ? 600 : 90);
    expect(closed.clashes).toBe(0);
    expect(closed.pending).toBe(0);
    expect(closed.counted).toBe(0);
    expect(closed.ring).toBe(0);
    expect(closed.occurrences).toBeGreaterThan(20);
  });

  test('a person with no age class is never in a victim, target or hostile role', () => {
    const sim = busySim('SF1-X-1b', 1, undefined, ['city.events']);
    const nobody = H(hs('no-class'), hi(1));
    for (const role of ['victim', 'target', 'hostile', 'aggressor']) {
      const o: Occurrence = { kind: 'assault', origin: 'sim', size: 1, window: 0, participants: [{ who: nobody, role }], effects: [], creator: sim.w.s1 };
      expect(sim.gate.produce(o, settingsNow(sim), 0)).toEqual({ ok: false, reason: 'floor-minor' });
    }
  });
});

describe('SF1-X-2: the floors', () => {
  const sim = busySim('SF1-X-2', 1, undefined, ['city.events']);
  const adults = (n: number): Id[] => {
    const out: Id[] = [];
    for (const c of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(c)) if (sim.people.view(r)!.ageClass === 'adult') out.push(r);
    return out.slice(0, n);
  };
  const minors = (): Id[] => {
    const out: Id[] = [];
    for (const c of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(c)) if (sim.people.view(r)!.ageClass === 'minor') out.push(r);
    return out;
  };
  const occ = (participants: Occurrence['participants'], extra: Partial<Occurrence> = {}): Occurrence => ({ kind: 'assault', origin: 'sim', size: 1, window: 0, participants, effects: [], creator: sim.w.s1, ...extra });

  test('only adult persons fill aggressor, victim, target and hostile; a minor is refused in each', () => {
    const [a] = adults(1);
    const [m] = minors();
    expect(m).toBeDefined();
    for (const role of ['aggressor', 'victim', 'target', 'hostile']) {
      expect(sim.gate.produce(occ([{ who: a!, role }]), settingsNow(sim), 0)).toEqual({ ok: true });
      expect(sim.gate.produce(occ([{ who: m!, role }]), settingsNow(sim), 0)).toEqual({ ok: false, reason: 'floor-minor' });
    }
    // a minor may be a bystander or a participant
    expect(sim.gate.produce(occ([{ who: m!, role: 'participant' }]), settingsNow(sim), 0)).toEqual({ ok: true });
  });

  test('a missing class is minor; a person marked real is refused; a sexual tag is refused', () => {
    const [a] = adults(1);
    const stranger = H(hs('stranger'), hi(2));
    expect(sim.gate.ageClassOf(stranger, 0)).toBe('minor');
    expect(sim.gate.produce(occ([{ who: stranger, role: 'victim' }]), settingsNow(sim), 0)).toEqual({ ok: false, reason: 'floor-minor' });
    sim.gate.real.add(a!);
    expect(sim.gate.produce(occ([{ who: a!, role: 'target' }]), settingsNow(sim), 0)).toEqual({ ok: false, reason: 'floor-real' });
    sim.gate.real.delete(a!);
    expect(sim.gate.produce(occ([{ who: a!, role: 'target' }], { tags: ['sex.act'] }), settingsNow(sim), 0)).toEqual({ ok: false, reason: 'sex-tag' });
  });

  test('a pin that gave a minor an adult age is gone when it is withdrawn and when its window has passed: the floor reads what the kernel resolves (Sol 1)', () => {
    const s = busySim('SF1-X-2c', 1, undefined, ['city.events']);
    const firstMinor = (): Id => {
      for (const c of s.w.districts[0]!.cellIds) for (const r of s.people.residentsOfBlock(c)) if (s.people.view(r)!.ageClass === 'minor') return r;
      throw new Error('no minor');
    };
    const gateOf = (who: Id) => s.gate.produce({ kind: 'assault', origin: 'sim', size: 1, window: 0, participants: [{ who, role: 'victim' }], effects: [], creator: s.w.s1 }, settingsNow(s), s.k.now);
    const minor = firstMinor();
    const cause = H(hs('age-pin'));
    expect(gateOf(minor)).toEqual({ ok: false, reason: 'floor-minor' });
    // withdrawal: the view is cached while the pin holds, and must not outlive it
    const pin = s.k.pin({ node: minor, slot: 'age', value: 35, reason: 'authored', cause });
    expect(s.people.view(minor)!.age).toBe(35);
    expect(gateOf(minor)).toEqual({ ok: true });
    expect(s.k.withdrawPin(pin.id, cause)).toBe(true);
    expect(s.k.value(minor, 'age')).toBeLessThan(18);
    expect(s.people.view(minor)!.ageClass).toBe('minor');
    expect(gateOf(minor)).toEqual({ ok: false, reason: 'floor-minor' });
    // a contribution with a window: it holds for the first window only, and one that is ended stops at once
    const give = (value: number, to?: number) => s.k.contribute({
      source: { layer: 'authored', origin: cause }, target: { slot: 'age', scope: { nodes: [minor] } }, form: { f: 'const', value }, mode: 'constrain',
      valid: to === undefined ? {} : { from: 0, to },
    });
    give(40, 600);
    expect(s.people.view(minor)!.age).toBe(40);
    s.advance(2);
    expect(s.k.now).toBeGreaterThanOrEqual(1200);
    expect(s.k.value(minor, 'age')).toBeLessThan(18);
    expect(s.people.view(minor)!.ageClass).toBe('minor');
    expect(gateOf(minor)).toEqual({ ok: false, reason: 'floor-minor' });
    const open = give(41);
    expect(s.people.view(minor)!.age).toBe(41);
    s.k.endContribution(open.id);
    expect(s.people.view(minor)!.ageClass).toBe('minor');
    expect(gateOf(minor)).toEqual({ ok: false, reason: 'floor-minor' });
    // clearing the caches changes nothing
    s.people.dropCaches();
    expect(s.people.view(minor)!.ageClass).toBe('minor');
  });

  test('a <role>-group participant never fills a floor role', () => {
    const group = sim.w.group(sim.w.districts[0]!.id, 'A1');
    for (const role of ['aggressor-group', 'victim-group', 'target-group', 'hostile-group']) {
      expect(sim.gate.produce(occ([{ who: group, role }]), settingsNow(sim), 0)).toEqual({ ok: true });
    }
  });

  test('a mirrored person reads its class from the game: adult passes, anything else is minor', () => {
    const adult = sim.k.mirrored('npc-adult', 'xf:person');
    const child = sim.k.mirrored('npc-child', 'xf:person');
    const unknown = sim.k.mirrored('npc-unknown', 'xf:person');
    sim.k.reading(adult, 'age-class', 'adult');
    sim.k.reading(child, 'age-class', 'minor');
    sim.k.settle();
    expect(sim.gate.produce(occ([{ who: adult, role: 'victim' }]), settingsNow(sim), sim.k.now)).toEqual({ ok: true });
    expect(sim.gate.produce(occ([{ who: child, role: 'victim' }]), settingsNow(sim), sim.k.now)).toEqual({ ok: false, reason: 'floor-minor' });
    expect(sim.gate.produce(occ([{ who: unknown, role: 'victim' }]), settingsNow(sim), sim.k.now)).toEqual({ ok: false, reason: 'floor-minor' });
  });

  test('a content class at ceiling 0 refuses every kind that lists it, first', () => {
    const lined = busySim('SF1-X-2b', 1, undefined, ['city.events']);
    lined.k.settings.set({ content: { ceiling: { 'harm.groups': 0 } } }, 0);
    const o: Occurrence = { kind: 'gang-clash', origin: 'sim', size: 2, window: 0, participants: [], effects: [], creator: lined.w.s1 };
    expect(lined.gate.produce(o, lined.k.settings.at(0), 0)).toEqual({ ok: false, reason: 'excluded' });
    expect(lined.gate.produce({ ...o, kind: 'theft' }, lined.k.settings.at(0), 0)).toEqual({ ok: true });
  });
});

describe('SF1-X-3: V', () => {
  test('sampled events: V is never a victim or a target, and no harmful effect names V', () => {
    const sim = busySim('SF1-X-3', 40);
    sim.advance(100);
    const events = cityEvents(sim);
    expect(events.length).toBeGreaterThan(50);
    const harm = new Set<string>(sim.data.gate.harmEffects);
    for (const e of events) {
      const view = sim.policies.viewEvent(e)!;
      for (const p of view.participants) expect(p.who).not.toBe(sim.w.v);
      for (const ef of view.effects) if (harm.has(ef.effect)) expect(ef.on).not.toBe(sim.w.v);
    }
    // and sampled occurrences of every city kind, cast the way an admitted one or an opened item is
    const d0 = sim.w.districts[0]!;
    const kinds = ['theft', 'assault', 'gang-clash', 'shakedown', 'police-action', 'psycho-break', 'disorder', 'accident', 'commerce'] as const;
    let named = 0;
    for (let n = 0; n < (FULL ? 10_000 : 2_000); n++) {
      const cell = d0.cellIds[n % 3]!;
      const kind = kinds[n % kinds.length]!;
      const time = (n * 37 % 168) * HOUR + (n % 7) * 400;
      const id = H(hs('x3-sample'), hi(n));
      const d = descriptor(sim, `x3-${n}`, kind, cell, time, { id, sides: sim.casting.drawSides(id, cell, kind, NO_BOOSTS) });
      const cast = sim.casting.cast(d);
      if (cast === 'no-cast') continue;
      for (const e of cast) {
        if (e.who === undefined) continue;
        named++;
        if (e.who === sim.w.v) throw new Error(`V was cast in ${kind} as ${e.role}`);
      }
    }
    expect(named).toBeGreaterThan(FULL ? 5000 : 1000);
  }, 120_000);

  test('the gate refuses V as a victim or a target, and a harmful effect on V', () => {
    const sim = busySim('SF1-X-3b', 1, undefined, ['city.events']);
    const base: Occurrence = { kind: 'assault', origin: 'policy', size: 1, window: 0, participants: [], effects: [], creator: sim.w.s1 };
    for (const role of ['victim', 'target']) {
      expect(sim.gate.produce({ ...base, participants: [{ who: sim.w.v, role }] }, settingsNow(sim), 0)).toMatchObject({ ok: false });
    }
    for (const effect of ['harm', 'kill', 'take', 'expose'] as Effect[]) {
      expect(sim.gate.produce({ ...base, effects: [{ on: sim.w.v, effect }] }, settingsNow(sim), 0)).toEqual({ ok: false, reason: 'v-target' });
    }
    // V as an actor is an act, and a help effect on V is not harm
    expect(sim.gate.produce({ ...base, participants: [{ who: sim.w.v, role: 'actor' }], effects: [{ on: sim.w.v, effect: 'help' }] }, settingsNow(sim), 0)).toEqual({ ok: true });
  });
});

describe('SF1-X-4: the protected set', () => {
  /** A resident cast by a live seed from time `from`. */
  function protectedFrom(name: string, from: number) {
    const sim = busySim(name, 1, undefined, ['city.events']);
    const moment = findMoment(sim, [0, 2], []);
    const present = sim.people.presentAt(moment.cell, moment.time, sim.data.people.presentCap).filter((r) => sim.people.view(r)!.affc === 0 && sim.people.view(r)!.ageClass === 'adult');
    const r = present[0]!;
    const seed = sim.k.root(`live-seed-${name}`, 'core:seed');
    sim.k.retention.setSeed({ id: seed, state: {}, nodes: [r] });
    sim.k.addEdge({ type: 'core:cast', from: seed, to: r, data: { role: 'target' }, cause: seed, valid: { from } });
    return { sim, r, moment };
  }

  test('a cast edge protects from its start: protectedAt uses the time asked, and the gate uses the set now', () => {
    const { sim, r } = protectedFrom('SF1-X-4', 5000);
    expect(sim.people.protectedAt(r, 4999)).toBe(false);
    expect(sim.people.protectedAt(r, 5000)).toBe(true);
    sim.k.now = 6000;
    expect(sim.people.protectedSet(r)).toBe(true);
    const o: Occurrence = { kind: 'assault', origin: 'sim', size: 1, window: 10, participants: [{ who: r, role: 'victim' }], effects: [{ on: r, effect: 'harm' }], creator: sim.w.s1 };
    expect(sim.gate.produce(o, settingsNow(sim), 6000)).toEqual({ ok: false, reason: 'protected' });
    // a help effect is not harm
    expect(sim.gate.produce({ ...o, participants: [{ who: r, role: 'participant' }], effects: [{ on: r, effect: 'help' }] }, settingsNow(sim), 6000)).toEqual({ ok: true });
  });

  test('a person observed later was not present earlier: where and who is present at a past time read the protected set as of that time (Sol 7)', () => {
    const sim = busySim('SF1-X-4c', 1, (d) => { d.people.absentP = 1; }, ['city.events']);
    const cell = sim.w.districts[0]!.cellIds[0]!;
    const residents = sim.people.residentsOfBlock(cell).slice(0, 2);
    expect(sim.people.presentAt(cell, 0)).toEqual([]);
    for (const r of residents) expect(sim.people.where(r, 0).cause).not.toBe('protected-present');
    // V observes both at time 1200
    for (const r of residents) sim.k.pin({ node: r, slot: 'age', value: sim.k.value(r, 'age') as number, reason: 'observed', at: 1200, cause: H(hs('observer')), evidence: r });
    sim.k.now = 1300;
    expect(sim.people.presentAt(cell, 0)).toEqual([]);
    for (const r of residents) {
      expect(sim.people.where(r, 0).cls).toBe('away');
      expect(sim.people.where(r, 1100).cls).toBe('away');
      expect(sim.people.where(r, 1300).cause).toBe('protected-present');
      expect(sim.people.where(r, 1300).cls).not.toBe('away');
    }
  });

  test('casting never chooses the protected person for a harm role, over many occurrences at the same place and hour', () => {
    const { sim, r, moment } = protectedFrom('SF1-X-4b', 0);
    // the same moment a week on: the protected person is present in the cell by the routine
    const t = moment.time;
    expect(sim.people.presentAt(moment.cell, t, sim.data.people.presentCap)).toContain(r);
    let chosenAsVictim = 0;
    let victims = 0;
    for (let n = 0; n < 400; n++) {
      const d = descriptor(sim, `x4-${n}`, 'assault', moment.cell, t, { sides: { a: 2 } });
      const cast = sim.casting.cast(d);
      if (cast === 'no-cast') continue;
      for (const e of cast) if (e.role === 'victim') { victims++; if (e.who === r) chosenAsVictim++; }
    }
    expect(victims).toBeGreaterThan(100);
    expect(chosenAsVictim).toBe(0);
    // the same person is chosen when unprotected, so the test is not vacuous
    const open = busySim('SF1-X-4b', 1, undefined, ['city.events']);
    let hits = 0;
    for (let n = 0; n < 400; n++) {
      const cast = open.casting.cast(descriptor(open, `x4-${n}`, 'assault', moment.cell, t, { sides: { a: 2 } }));
      if (cast !== 'no-cast') for (const e of cast) if (e.role === 'victim' && e.who === r) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  }, 120_000);

  test('a protected person is never away by where', () => {
    const { sim, r } = protectedFrom('SF1-X-4c', 0);
    for (let h = 0; h < 24 * 14; h++) {
      const w = sim.people.where(r, h * HOUR + 1800);
      expect(w.cls).not.toBe('away');
      expect(w.cause).toBe('protected-present');
    }
  });
});

describe('SF1-X-5: casting', () => {
  test('a police-action child of a theft: its victim and target are the parent\'s, re-cast by the same pure function', () => {
    const sim = busySim('SF1-X-5', 1, undefined, ['city.events']);
    const { cell, time } = findMoment(sim, [0, 2], []);
    const sides = sim.casting.drawSides(H(hs('x5-parent')), cell, 'theft', NO_BOOSTS);
    const parent = descriptor(sim, 'x5-parent', 'theft', cell, time, { size: 2, sides: sides.a === undefined ? { a: 2 } : sides });
    const parentCast = sim.casting.cast(parent);
    expect(parentCast).not.toBe('no-cast');
    expect(sim.casting.cast(parent)).toEqual(parentCast);
    const inherit = sim.inheritFor(parent);
    const victim = (parentCast as CastEntry[]).find((e) => e.role === 'victim')!.who!;
    const aggressor = (parentCast as CastEntry[]).find((e) => e.role === 'aggressor')!.who!;
    expect(inherit).toEqual([{ role: 'target', who: aggressor }, { role: 'victim', who: victim }]);
    const child = descriptor(sim, 'x5-child', 'police-action', cell, time + 700, { parent: parent.id, gen: 1, chain: [parent.id], inherit });
    const cast = sim.casting.cast(child);
    expect(cast).not.toBe('no-cast');
    const roles = (cast as CastEntry[]).filter((e) => e.role !== 'responder');
    expect(roles).toEqual([{ role: 'victim', who: victim }, { role: 'target', who: aggressor }]);
    // the child names nobody the parent did not
    expect(sim.casting.cast(child)).toEqual(cast);
  });

  test('a gang clash in a cell whose present residents contain no member of side B: side B is group involvement, never a person', () => {
    const sim = busySim('SF1-X-5b', 1, undefined, ['city.events']);
    const { cell, time } = findMoment(sim, [2], [3]);
    const d = descriptor(sim, 'x5-clash', 'gang-clash', cell, time, { size: 2, sides: { a: 2, b: 3 } });
    const cast = sim.casting.cast(d);
    expect(cast).not.toBe('no-cast');
    const entries = cast as CastEntry[];
    const aggressor = entries.find((e) => e.role === 'aggressor')!;
    expect(aggressor.who).toBeDefined();
    expect(sim.people.view(aggressor.who!)!.affc).toBe(2);
    const victim = entries.find((e) => e.role === 'victim-group')!;
    expect(victim.group).toBe(sim.w.group(sim.w.districts[0]!.id, 'A2'));
    expect(entries.some((e) => e.role === 'victim')).toBe(false);
  });

  test('a cell with no member of the required class gives no-cast, for a role that cannot be group involvement', () => {
    const sim = busySim('SF1-X-5c', 1, undefined, ['city.events']);
    const { cell, time } = findMoment(sim, [0], [2]);
    const d = descriptor(sim, 'x5-assault', 'assault', cell, time, { sides: { a: 2 } });
    expect(sim.casting.cast(d)).toBe('no-cast');
  });

  test('casting names nobody who is not present, alive, adult and unprotected in a floor or harm role', () => {
    const sim = busySim('SF1-X-5d', 1, undefined, ['city.events']);
    const d0 = sim.w.districts[0]!;
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const cell = d0.cellIds[n % 3]!;
      const time = (n % 168) * HOUR + 900;
      const kind = (['theft', 'assault', 'shakedown', 'psycho-break', 'accident'] as const)[n % 5]!;
      const d = descriptor(sim, `x5d-${n}`, kind, cell, time, { sides: sim.casting.drawSides(H(hs('x5d'), hi(n)), cell, kind, NO_BOOSTS) });
      const cast = sim.casting.cast(d);
      if (cast === 'no-cast') continue;
      const here = new Set(sim.people.presentAt(cell, time, sim.data.people.presentCap));
      for (const e of cast) {
        if (e.who === undefined) continue;
        checked++;
        expect(here.has(e.who)).toBe(true);
        const v = sim.people.view(e.who)!;
        expect(v.ageClass).toBe('adult');
        expect(sim.people.protectedAt(e.who, time)).toBe(false);
        expect(e.who).not.toBe(sim.w.v);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

void hid;
void defaultData;
