// SF1-R: the registered reads for S2 (S1 9.1, 14.1).

import { describe, expect, test } from 'bun:test';
import { canonicalKey } from '../../src/canon.ts';
import { H, id as hid, s as hs } from '../../src/id.ts';
import type { EventsDigest } from '../../src/sim/proc-events.ts';
import type { NormsDigest } from '../../src/sim/proc-norms.ts';
import type { GroupDigest, GroupState } from '../../src/sim/proc-groups.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import type { Id } from '../../src/types.ts';
import { child, fxData, inject, quietData, quietSim, seedOf } from './helpers.ts';

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

  test('a believer\'s memorable belief about a subject\'s affiliation is set: divergence is re-evaluated at the next boundary and its log gains an entry', () => {
    const sim = quietSim('SF1-R-3c');
    const d = sim.w.districts[0]!;
    const believer = sim.people.residentAt(d.cellIds[0]!, 0);
    const subject = sim.k.mirrored('npc', 'xf:person');
    sim.k.reading(subject, 'affiliation', 'civilian');
    sim.advance(1);
    expect(sim.reads.eval('divergence', [believer, subject])).toBe('none');
    const E = H(hs('ev'), hid(subject));
    sim.k.beliefs.set({ believer, subject, path: 'affiliation', at: sim.k.now, value: 'TygerClaws', confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: sim.k.now, refreshed: sim.k.now, memorable: true });
    // the belief emits no Change: the read says so at once, and the log learns of it at the boundary
    expect(sim.reads.eval('divergence', [believer, subject])).toBe('large');
    const before = (sim.record.divLog[`${believer}|${subject}`] ?? []).length;
    sim.advance(1);
    const log = sim.record.divLog[`${believer}|${subject}`]!;
    expect(log.length).toBe(before + 1);
    expect(log[log.length - 1]!.value).toBe('large');
    const t0 = sim.k.now - 2 * W;
    const tr = sim.reads.transitions('divergence', [believer, subject], t0, sim.k.now);
    expect(tr[0]).toEqual({ t: t0, value: 'none' });
    expect(tr[tr.length - 1]!.value).toBe('large');
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
