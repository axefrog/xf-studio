// SF1-R: the registered reads for S2 (S1 9.1, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { canonicalKey } from '../../src/canon.ts';
import { H, id as hid, s as hs } from '../../src/id.ts';
import type { EventsDigest } from '../../src/sim/proc-events.ts';
import type { NormsDigest } from '../../src/sim/proc-norms.ts';
import type { GroupDigest, GroupState } from '../../src/sim/proc-groups.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import type { Id } from '../../src/types.ts';
import { child, fxData, inject, quietData, quietSim, seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const W = 600;

const UNBUILT = ['heatRank', 'tension', 'reach', 'protected', 'contract'];

describe('SF1-R-1: the reads', () => {
  const make = () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-R-1'), index: fx3Slice(), data: quietData() });
    const d = sim.w.districts[0]!;
    const people = d.cellIds.map((c) => sim.people.residentAt(c, 0));
    const axis = sim.data.ledger.axes[0]!;
    const calls: Array<[string, unknown[]]> = [
      ['band', [d.cellIds[0]]], ['regime', ['fx_d1']], ['regimeIs', ['fx_d1', 'festival']], ['priceLevel', ['fx_d1']], ['refuge', ['fx_d1']],
      ['presence', ['fx_d1', 'GA']], ['label', ['kabuki', 'v', axis]], ['bridge', [people[0]]], ['normGap', ['fee', 'fx_d1']],
      ['tied', [people[0], people[1]]], ['divergence', [people[0], people[1]]], ['depth', [people[0]]], ['groupGap', [sim.w.group(d.id, 'A1')]],
      ['heatRank', ['fx_d1']], ['tension', [people[0], people[1]]], ['reach', ['fx_d1', 'x']], ['protected', [people[0]]], ['contract', ['c']],
    ];
    return { sim, calls };
  };

  test('before the first processed boundary the process reads answer maybe; after it they answer; the unbuilt reads stay maybe; no read exposes a number', () => {
    const { sim, calls } = make();
    const before = new Map(calls.map(([n, a]) => [n, sim.reads.eval(n, a)]));
    for (const n of ['band', 'regime', 'regimeIs', 'priceLevel', 'refuge', 'label', 'normGap', 'groupGap']) expect(before.get(n)).toBe('maybe');
    sim.advance(3);
    const after = new Map(calls.map(([n, a]) => [n, sim.reads.eval(n, a)]));
    const allowed: Record<string, string[]> = {
      band: ['quiet', 'elevated', 'hot', 'flashpoint'], regime: ['none', 'festival', 'crackdown', 'disorder', 'blackout'], regimeIs: ['yes', 'no'],
      priceLevel: ['low', 'fair', 'high', 'extreme'], refuge: ['yes', 'poor', 'no', 'maybe'], presence: ['none', 'low', 'mid', 'high'],
      label: ['unknown', 'low', 'mid', 'high'], bridge: ['low', 'mid', 'high'], normGap: ['aligned', 'gap', 'wide'], tied: ['yes', 'no'],
      divergence: ['none', 'small', 'large'], depth: ['open', 'closed'], groupGap: ['low', 'mid', 'high'],
    };
    for (const [n] of calls) {
      const v = after.get(n)!;
      if (UNBUILT.includes(n)) {
        expect(v).toBe('maybe');
        continue;
      }
      expect(allowed[n], n).toBeDefined();
      if (n !== 'regime') expect(allowed[n], `${n} = ${v}`).toContain(v);
      expect(Number.isNaN(Number(v)), `${n} exposes a number: ${v}`).toBe(true);
    }
    expect(after.get('band')).toBe('quiet');
    expect(after.get('regime')).toBe('none');
    expect(after.get('presence')).toBe('high');
    expect(after.get('depth')).toBe('closed');
  });

  test('an unknown read name answers maybe', () => {
    const { sim } = make();
    expect(sim.reads.eval('nothing', [])).toBe('maybe');
    expect(sim.reads.transitions('nothing', [], 0, 10)).toEqual([{ t: 0, value: 'maybe' }]);
  });

  test('every read declares its dependencies; the divergence read re-evaluates at every boundary', () => {
    const { sim } = make();
    for (const [name, def] of sim.reads.defs) {
      expect(def.name).toBe(name);
      expect(def.version).toBe(1);
      expect(def.deps).toBeDefined();
    }
    expect(sim.reads.defs.get('divergence')!.deps.boundary).toBe(true);
    expect(sim.reads.defs.get('refuge')!.deps.interests).toEqual(expect.arrayContaining([{ kind: 'xf:service', slot: 'status' }, { kind: 'xf:cell', slot: 'band' }]));
    expect(sim.reads.defs.get('groupGap')!.deps.interests).toEqual([{ kind: 'xf:group', slot: 'group-gap' }]);
  });
});

describe('SF1-R-2: transitions', () => {
  test('band(c) over a window in which it rose: the initial value first, then the new one at the start of the next window; a start older than 8 windows answers maybe', () => {
    const sim = quietSim('SF1-R-2', (d) => { d.events.offspring = [0, 0, 0, 0]; });
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    const w = 200;
    sim.startAt(w);
    inject(sim, child(sim, 'rise', 0, w, 'accident', 2, c1));
    sim.advance(3);
    const from = w * W;
    expect(sim.reads.transitions('band', [c1], from, (w + 3) * W)).toEqual([{ t: from, value: 'quiet' }, { t: (w + 1) * W, value: 'elevated' }]);
    expect(sim.reads.eval('band', [c1])).toBe('elevated');
    // the answer is the value at `from` when there is no change after it
    expect(sim.reads.transitions('band', [c1], (w + 2) * W, (w + 3) * W)).toEqual([{ t: (w + 2) * W, value: 'elevated' }]);
    sim.advance(20);
    expect(sim.reads.transitions('band', [c1], from, (w + 23) * W)).toEqual([{ t: from, value: 'maybe' }]);
  });

  test('eval at a past time is the value the transitions give at that time, including a change that reverts, and maybe outside what they cover (Sol 12)', () => {
    const sim = quietSim('SF1-R-2e', (d) => {
      d.events.offspring = [0, 0, 0, 0];
      // the heat of the accident is gone after three windows and a band may change after two, so the band rises and falls back
      d.events.heatAge = [{ upTo: 3, weight: 1.0 }, { upTo: 1008, weight: 0.01 }];
      d.events.bandMinDwell = 2;
    });
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    const w = 200;
    sim.startAt(w);
    inject(sim, child(sim, 'rise', 0, w, 'accident', 2, c1));
    const port = sim.reads.port();
    // what the read said as the world went by, boundary by boundary; each is asked again later, while the feed still covers it
    const seen: Array<{ t: number; value: string }> = [];
    for (let i = 0; i < 12; i++) {
      sim.advance(1);
      seen.push({ t: sim.k.now, value: sim.reads.eval('band', [c1]) });
      for (const x of seen) {
        if (sim.k.now - x.t > 6 * W) continue;
        expect(sim.reads.eval('band', [c1], x.t), `at ${x.t} from ${sim.k.now}`).toBe(x.value);
        expect(port.eval('band', [c1], x.t)).toBe(x.value);
      }
    }
    const values = seen.map((x) => x.value);
    expect(values.indexOf('elevated')).toBe(0);
    expect(values.at(-1)).toBe('quiet');
    // between boundaries the value is the one in force: it rose at the first boundary and fell at the fifth
    const fell = seen.find((x) => x.value === 'quiet')!;
    expect(fell.t).toBe((w + 5) * W);
    expect(sim.reads.eval('band', [c1], fell.t - 1)).toBe('elevated');
    expect(sim.reads.eval('band', [c1], fell.t)).toBe('quiet');
    // regimeIs is answered from the same history, and a time older than the feed, or before any reading, is maybe
    expect(sim.reads.eval('regimeIs', ['fx_d1', 'festival'], fell.t)).toBe('no');
    expect(sim.reads.eval('band', [c1], 0)).toBe('maybe');
    expect(sim.reads.eval('band', [c1], seen[0]!.t)).toBe('maybe');
  });

  test('normGap over a window in which it fell: the same shape', () => {
    const sim = Sim.create({
      worldSeed: seedOf('SF1-R-2n'), index: fx3Slice(), only: ['order.norms'],
      data: quietData((d) => { for (const n of d.norms.norms) { n.enforcePerDay = 0; n.priv0 = 0.8; n.beh0 = 0.8; n.perc0 = 0.2; n.visBase = 0.8; } }),
    });
    const district = sim.w.districts[0]!.id;
    let fall: { w: number; from: string; to: string } | undefined;
    let last = 'aligned';
    for (let w = 0; w < 120 && !fall; w++) {
      sim.advance(1);
      const dg = sim.digestOf<NormsDigest>('order.norms')!;
      for (const win of dg.changes.windows) {
        for (const ch of win.items) {
          if (ch.key === `gap|fee|${district}` && ch.value === 'aligned' && ch.prev !== 'aligned') fall = { w: win.w, from: ch.prev!, to: ch.value };
          if (ch.key === `gap|fee|${district}`) last = ch.value;
        }
      }
    }
    expect(fall).toBeDefined();
    const w = fall!.w;
    const t = sim.reads.transitions('normGap', ['fee', 'fx_d1'], w * W, (w + 2) * W);
    expect(t).toEqual([{ t: w * W, value: fall!.from }, { t: (w + 1) * W, value: 'aligned' }]);
    expect(last).toBe('aligned');
  });
});

describe('SF1-R-3: invalidation', () => {
  test('a leaf cell goes hot with every service unchanged: refuge changes at the band transition, written by the band pin', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-R-3a'), index: makeKabukiSlice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }), only: ['city.events'] });
    const g0 = sim.w.index.names!.g0!;
    const w = 200;
    sim.startAt(w);
    sim.advance(2);
    expect(sim.reads.eval('refuge', ['wat_kab'])).toBe('yes');
    inject(sim, child(sim, 'big', 0, w + 4, 'gang-clash', 4, g0, { sides: { a: 2, b: 3 } }), child(sim, 'big2', 0, w + 4, 'gang-clash', 4, g0, { sides: { a: 2, b: 3 } }));
    sim.advance(6);
    const pins = sim.k.store.allPins().filter((p) => p.node === g0 && p.slot.startsWith('band@w'));
    expect(pins.length).toBeGreaterThan(0);
    const dg = sim.digestOf<EventsDigest>('city.events')!;
    expect(dg.bands[g0]!.band).toBeGreaterThanOrEqual(2);
    expect(sim.reads.eval('band', [g0])).toMatch(/hot|flashpoint/);
    expect(sim.reads.eval('refuge', ['wat_kab'])).toBe('poor');
    // the lodging services refuge reads are unchanged: only the cell's band moved
    for (const v of ['v8', 'v9']) expect(dg.services[sim.k.address(sim.w.index.names![v]!, 'services[0]')] ?? 0).toBeLessThanOrEqual(1);
    const tr = sim.reads.transitions('refuge', ['wat_kab'], (w + 3) * W, (w + 8) * W);
    expect(tr[0]).toEqual({ t: (w + 3) * W, value: 'yes' });
    expect(tr[tr.length - 1]!.value).toBe('poor');
    expect(tr.length).toBe(2);
    // the pin and the transition are one change: the transition's time is the start of the window the pin takes effect in
    const rise = pins.map((p) => Number(p.slot.slice(6))).sort((x, y) => x - y)[0]!;
    expect(tr[1]!.t).toBe(rise * W);
  });

  test('a group\'s gap band changes: groupGap changes at the transition, written by the group-gap pin', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-R-3b'), index: fx3Slice(), data: quietData(), only: ['group.decide'] });
    const d = sim.w.districts[0]!;
    const g = sim.w.group(d.id, 'A1');
    sim.advance(2);
    const first = sim.reads.eval('groupGap', [g]);
    expect(['low', 'mid', 'high']).toContain(first);
    // raise the gap of the group: a large divergence of operative weights from the ethos
    const dgBefore = sim.digestOf<GroupDigest>('group.decide')!;
    expect(dgBefore.groups[g]).toBeDefined();
    sim.setState('group.decide', (st) => {
      const s = st as GroupState;
      s.groups[g]!.books = { cash: 0, burn: 300, income: 0 };
    });
    sim.advance(5);
    const pins = sim.k.store.allPins().filter((p) => p.node === g && p.slot.startsWith('group-gap@w'));
    expect(pins.length).toBeGreaterThan(0);
    const now = sim.reads.eval('groupGap', [g]);
    const tr = sim.reads.transitions('groupGap', [g], sim.k.now - 4 * W, sim.k.now);
    expect(tr[0]!.t).toBe(sim.k.now - 4 * W);
    expect(tr[tr.length - 1]!.value).toBe(now);
  });

  test('a believer\'s memorable belief about a subject\'s affiliation is set: the read says so at once and the log gains the entry at the time it was set; a boundary adds none', () => {
    const sim = quietSim('SF1-R-3c');
    const d = sim.w.districts[0]!;
    const believer = sim.people.residentAt(d.cellIds[0]!, 0);
    const subject = sim.k.mirrored('npc', 'xf:person');
    sim.k.reading(subject, 'affiliation', 'civilian');
    sim.advance(1);
    expect(sim.reads.eval('divergence', [believer, subject])).toBe('none');
    const E = H(hs('ev'), hid(subject));
    const key = `${believer}|${subject}`;
    const before = (sim.record.divLog[key] ?? []).length;
    const setAt = sim.k.now;
    sim.k.beliefs.set({ believer, subject, path: 'affiliation', at: setAt, value: 'TygerClaws', confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: setAt, refreshed: setAt, memorable: true });
    // the belief emits no Change: the read says so at once, and the log is told when the belief is set, whoever sets it (SIM-08)
    expect(sim.reads.eval('divergence', [believer, subject])).toBe('large');
    expect(sim.record.divLog[key]!.length).toBe(before + 1);
    expect(sim.record.divLog[key]![before]).toEqual({ t: setAt, value: 'large', ord: 0 });
    sim.advance(1);
    // the boundary finds nothing new to write
    expect(sim.record.divLog[key]!.length).toBe(before + 1);
    const t0 = setAt - 2 * W;
    const tr = sim.reads.transitions('divergence', [believer, subject], t0, sim.k.now);
    expect(tr[0]).toEqual({ t: t0, value: 'none' });
    expect(tr[tr.length - 1]).toEqual({ t: setAt, value: 'large' });
    // a belief that is dropped is a change of the log too, at the time it was dropped
    sim.k.beliefs.drop(believer, sim.k.beliefs.activeOf(believer).find((x) => x.path === 'affiliation')!.id);
    expect(sim.record.divLog[key]![before + 1]).toEqual({ t: sim.k.now, value: 'none', ord: 1 });
  });
});

describe('the registries for S3 (S1 9.2) and catching up (S1 10.2)', () => {
  test('producers(kind) and eventKind(name) list the kinds with their producers and tags; isSpine joins a mirrored canon person; aesthetic is undefined', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-R-S3'), index: fx3Slice(), data: quietData(), only: ['city.events'] });
    expect(sim.reads.producers('theft')).toEqual(expect.arrayContaining(['city.events', 'city.mirror', 'scene.acts']));
    expect(sim.reads.producers('game.death')).toContain('port');
    expect(sim.reads.producers('tell')).toContain('social');
    expect(sim.reads.producers('nothing')).toEqual([]);
    expect(sim.reads.eventKind('assault')!.tags).toContain('personal-violence');
    expect(sim.reads.eventKind('nothing')).toBeUndefined();
    const canon = sim.k.mirrored('canon-person', 'xf:person');
    expect(sim.reads.isSpine(canon)).toBe(false);
    sim.spine.add(canon);
    expect(sim.reads.isSpine(canon)).toBe(true);
    expect(sim.reads.aesthetic(canon, 'hair')).toBeUndefined();
  });

  test('a jump is caught up boundary by boundary within a budget: reads answer as of the last processed boundary, flagged catchingUp, and the end is the same as one call', () => {
    const mk = () => Sim.create({ worldSeed: seedOf('SF1-R-catch'), index: fx3Slice(), data: fxData((d) => { for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 20) as [number, number, number, number]; }) });
    const a = mk();
    a.advance(40);
    const b = mk();
    let steps = 0;
    let flagged = 0;
    while (!b.catchUp(40, 3)) {
      steps++;
      expect(b.catchingUp).toBe(true);
      const r = b.reads.read('priceLevel', ['fx_d1']);
      expect(r.catchingUp).toBe(true);
      flagged++;
      expect(steps).toBeLessThan(2000);
    }
    expect(b.catchingUp).toBe(false);
    expect(b.reads.read('priceLevel', ['fx_d1']).catchingUp).toBe(false);
    expect(flagged).toBeGreaterThan(5);
    expect(b.windowNow()).toBe(40);
    expect(canonicalKey(b.stateOf('city.events'))).toBe(canonicalKey(a.stateOf('city.events')));
    expect(canonicalKey(b.digestOf('city.events'))).toBe(canonicalKey(a.digestOf('city.events')));
  });
});

void fxData;
void ({} as Id);
