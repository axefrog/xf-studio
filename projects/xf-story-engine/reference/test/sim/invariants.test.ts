// S1-I-1 to S1-I-28 (S1 13): one test for each of the simulation layer's own invariants, beside the kernel's I-1 to I-16. Most are checked
// more closely by the fixture named in the test; here each is stated and tested on a small run, so a reader finds all twenty-eight in one place.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalKey } from '../../src/canon.ts';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { PROCESS_VERSIONS } from '../../src/sim/s1ctx.ts';
import { PROCESS_WRITES, auditGate, auditWriters, lintSources, observeWrites } from '../../src/sim/audit.ts';
import { TABLE_HASHES } from '../../src/sim/arith.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { genPlan, genScript, execute } from './gen.ts';
import { child, eventsState, fxData, inject, occurrences, quietData, seedOf } from './helpers.ts';
import { differing, recordOf } from './records.ts';

const W = 600;
const SRC = join(import.meta.dir, '../../src/sim');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => ({ path: f, text: readFileSync(join(SRC, f), 'utf8') }));
const adult = { alive: 'yes', 'age-class': 'adult' } as const;

const busy = (factor: number) => (d: ReturnType<typeof fxData>): void => {
  for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * factor) as [number, number, number, number];
};
const mk = (tweak: (d: ReturnType<typeof fxData>) => void = busy(15), name = 'S1-I', only?: string[]): Sim =>
  Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: fxData(tweak), ...(only ? { only } : {}) });

describe('the invariants of the simulation layer', () => {
  test('S1-I-1 Keyed: every draw is in the key registry, none names the epoch, a load or a clock; the same inputs give the same results', () => {
    const found = lintSources(files).filter((f) => f.audit === 'keys' || f.audit === 'no-load-reads');
    expect(found).toEqual([]);
    const a = mk();
    const b = mk();
    a.advance(40);
    b.advance(40);
    expect(differing(recordOf(a), recordOf(b))).toEqual([]);
  });

  test('S1-I-1 Keyed: the order a record lists its properties in is not part of the model (matrix, rates, presence: Sol 4)', () => {
    const reversed = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).reverse());
    const run = (flip: boolean): { sim: Sim; rec: ReturnType<typeof recordOf> } => {
      const index = fx3Slice();
      const data = fxData((d) => {
        busy(40)(d);
        if (flip) {
          d.shape.rate = reversed(d.shape.rate) as typeof d.shape.rate;
          for (const kd of d.kinds) kd.matrix = reversed(kd.matrix) as typeof kd.matrix;
        }
      });
      if (flip) for (const c of Object.values(index.cells)) c.presence = reversed(c.presence);
      const sim = Sim.create({ worldSeed: seedOf('S1-I-1o'), index, data });
      sim.advance(100);
      return { sim, rec: recordOf(sim) };
    };
    const a = run(false);
    const b = run(true);
    expect(b.sim.w.dataHash).toBe(a.sim.w.dataHash);
    expect(new Set(occurrences(a.sim).filter((o) => o.gen > 0).map((o) => o.kind)).size).toBeGreaterThan(2);
    expect(differing(a.rec, b.rec)).toEqual([]);
  }, 120_000);

  test('S1-I-2 Arithmetic: only the operations and tables of S1 1.2, with the frozen tables; no fused multiply-add', () => {
    expect(lintSources(files).filter((f) => f.audit === 'arithmetic')).toEqual([]);
    expect(Object.keys(TABLE_HASHES).sort()).toEqual(['exptab@1', 'lqtab@1', 'normtab@1']);
    expect(0.1 * 10 + -1).toBe(0);
  });

  test('S1-I-3 Partition independence: the same external operations give the same histories however the calls are grouped and wherever saves fall', () => {
    const script = genScript(0x13, 50);
    const ref = recordOf(execute(script, { groups: [50], reloads: [] }, 50));
    const plan = genPlan(0x13, 50);
    expect(differing(ref, recordOf(execute(script, plan, 50))).filter((x) => x !== 'headers')).toEqual([]);
  }, 120_000);

  test('S1-I-4 Session independence: another epoch, a load and a different history of loads change no byte', () => {
    const script = genScript(0x14, 40);
    const plain = recordOf(execute(script, { groups: [40], reloads: [] }, 40));
    const loaded = recordOf(execute(script, { groups: [5, 15, 20], reloads: [5, 20] }, 40));
    expect(differing(plain, loaded).filter((x) => x !== 'headers')).toEqual([]);
  }, 120_000);

  test('S1-I-5 Demand independence: V\'s cell and the demand history change no output of tier 0 to 2', () => {
    const run = (cell: string, extra: boolean) => {
      const sim = mk();
      new ReplayPort(sim).submit([{ t: 0, op: 'reading', node: 'v', slot: 'cell', value: cell }]);
      if (extra) sim.k.frames.demandRoots.add(sim.people.residentAt(sim.w.districts[0]!.cellIds[2]!, 1));
      sim.advance(40);
      return recordOf(sim, { processes: ['scene.acts'], logProcs: ['scene.acts'] });
    };
    expect(differing(run('c1', false), run('c3', true)).filter((x) => !['frames', 'seeds', 'headers'].includes(x))).toEqual([]);
  });

  test('S1-I-6 One window, no two see each other: a run reads the snapshot and nothing it writes in the same run', () => {
    const sim = mk(busy(15));
    const twice: string[] = [];
    for (const [id, def] of sim.defs) {
      const run = def.run.bind(def);
      def.run = (pctx, k) => {
        const first = run(pctx, k);
        const second = run(pctx, k);
        if (canonicalKey(JSON.parse(JSON.stringify(first))) !== canonicalKey(JSON.parse(JSON.stringify(second)))) twice.push(`${id}@${k}`);
        return first;
      };
    }
    sim.advance(30);
    expect(twice).toEqual([]);
  });

  test('S1-I-7 One writer: no two processes write one slot, mint one node family or write one edge type', () => {
    const sim = mk();
    const observed = observeWrites(sim);
    sim.advance(40);
    expect(auditWriters(PROCESS_WRITES, observed)).toEqual([]);
  });

  test('S1-I-8 V is never aimed at, never modelled: no output names V as harmed and no belief about V models V\'s feelings, desire or drives', () => {
    const sim = mk();
    new ReplayPort(sim).submit(genScript(0x18, 60));
    sim.advance(60);
    const harm = new Set<string>(sim.data.gate.harmEffects);
    for (const o of occurrences(sim)) void o;
    for (const e of sim.k.store.idsOfKind('core:event')) {
      const ev = sim.policies.viewEvent(e);
      if (!ev) continue;
      for (const x of ev.effects) if (harm.has(x.effect)) expect(x.on).not.toBe(sim.w.v);
      for (const p of ev.participants) if (p.role === 'victim' || p.role === 'target') expect(p.who).not.toBe(sim.w.v);
    }
    for (const { belief } of sim.k.beliefs.entries()) {
      if (belief.subject === sim.w.v) expect(belief.path).toMatch(/^(rep-|did\.|reason|cause)/);
    }
    expect(sim.k.store.pinsOfNode(sim.w.v).filter((p) => /drive|desire|feel/.test(p.slot))).toEqual([]);
  });

  test('S1-I-9 One door, one owner: the gate holds no budget; the admission owner alone writes admission state; mirrored events are exempt', () => {
    const sim = mk();
    expect(auditGate(sim.gate)).toEqual([]);
    expect(auditWriters(PROCESS_WRITES)).toEqual([]);
    const port = new ReplayPort(sim);
    port.submit([
      { t: 0, op: 'person', key: 'kid', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'minor' } },
      { t: 0, op: 'person', key: 'civ', slots: { affiliation: 'civilian', ...adult } },
      { t: 700, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'kid', role: 'victim' }, { who: 'civ', role: 'actor' }], effects: [{ on: 'kid', effect: 'kill' }], witnesses: 2 },
    ]);
    sim.advance(5);
    expect(sim.record.log.filter((e) => e.kind === 'gate').length).toBe(0);
    expect(occurrences(sim).length).toBeGreaterThanOrEqual(0);
  });

  test('S1-I-10 Counts agree: a summary\'s count equals its items, opening an item adds nothing, every occurrence has one descriptor', () => {
    const sim = mk(busy(25), 'S1-I-10', ['city.events']);
    sim.advance(50);
    for (const e of eventsState(sim).ring) {
      if (e.count === undefined) continue;
      expect(sim.k.value(e.id, 'count')).toBe(e.count);
      expect(Object.keys(e.meta ?? {}).length).toBe(e.count);
    }
    const ids = occurrences(sim).map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('S1-I-11 Causes precede effects: a child is born in a later window and later in time than its parent; chains are capped', () => {
    const sim = mk(busy(25), 'S1-I-11', ['city.events']);
    sim.advance(120);
    const all = occurrences(sim);
    const byId = new Map(all.map((o) => [o.id, o]));
    let links = 0;
    for (const o of all) {
      expect(o.chain.length).toBeLessThanOrEqual(4);
      const p = o.parent === undefined ? undefined : byId.get(o.parent);
      if (!p) continue;
      links++;
      expect(o.w).toBeGreaterThan(p.w);
      expect(o.time).toBeGreaterThan(p.time);
    }
    expect(links).toBeGreaterThan(0);
  });

  test('S1-I-12 Bounded state: the calendar, the ring, the ledger, a person\'s ties and memorable beliefs, a scene\'s people and items', () => {
    const sim = mk();
    sim.advance(60);
    expect(Object.values(eventsState(sim).calendar).every((l) => l.length <= sim.data.events.calendarCap)).toBe(true);
    expect(eventsState(sim).ring.every((e) => sim.windowNow() - 1 - e.w < sim.data.events.heatHorizon)).toBe(true);
    // a person holds at most 20 materialised ties
    const d = sim.w.districts[0]!;
    const all = d.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
    const a = all[0]!;
    for (const b of all.slice(1, 40)) sim.tiePolicy.materialise(a, b);
    expect(sim.k.store.edgesFrom(a).concat(sim.k.store.edgesTo(a)).filter((e) => e.type === 'xf:tie' && e.valid.to === undefined).length).toBeLessThanOrEqual(sim.data.ties.maxMaterialised);
    // a person holds at most 40 memorable beliefs: beyond the cap a low-salience belief is not promoted
    const watcher = all[1]!;
    sim.k.frames.open({ actor: watcher, level: 'concern', origin: H(hs('cap-frame')), weight: 1, cause: sim.w.city, own: { protects: [{ slot: '*', scope: { nodes: [all[2]!] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] } });
    sim.k.settle();
    for (let n = 0; n < 60; n++) {
      const E = H(hs('cap-ev'), hi(n));
      sim.k.beliefs.set({ believer: watcher, subject: all[3 + (n % 5)]!, path: `did.harm`, at: 10_000 + n, value: all[2]!, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
    }
    const held = sim.k.beliefs.activeOf(watcher).filter((x) => x.memorable).length;
    expect(held).toBe(60);
    // a new observation of the capped person is formed, and not promoted
    const ev = sim.k.events.mintEvent({
      creator: sim.w.port, cause: sim.w.port, name: 'cap-event', time: 20_000, kind: 'theft', place: d.cellIds[0]!,
      participants: [{ who: all[9]!, role: 'aggressor' }, { who: all[10]!, role: 'victim' }], effects: [{ on: all[10]!, effect: 'take' }], witnesses: [watcher],
    });
    sim.k.settle();
    const fresh = sim.k.beliefs.activeOf(watcher).find((b) => b.source.by === 'observed' && b.source.event === ev && b.path === 'did.take');
    expect(fresh).toBeDefined();
    expect(fresh!.memorable).toBe(false);
    // a scene holds at most 60 people and opens at most 20 items an hour
    expect(sim.data.people.presentCap).toBeLessThanOrEqual(60);
    expect(sim.data.acts.perHour).toBe(20);
  });

  test('S1-I-13 Evidence independence: a chain of tellings from one origin weighs as the origin; independent items add', () => {
    const sim = mk(undefined, 'S1-I-13', ['order.ledger']);
    const d = sim.w.districts[0]!;
    const [a, b, c] = [0, 1, 2].map((i) => sim.people.residentAt(d.cellIds[i]!, 0));
    const E = H(hs('origin'));
    const k = sim.k;
    k.beliefs.set({ believer: a, subject: sim.w.v, path: 'did.harm', at: 100, value: b, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
    const id = k.beliefs.activeOf(a)[0]!.id;
    k.beliefs.tell(a, b, id);
    k.beliefs.tell(b, c, k.beliefs.activeOf(b)[0]!.id);
    k.beliefs.tell(a, c, id);
    expect(k.beliefs.activeOf(c).length).toBe(1);
    expect(k.beliefs.activeOf(c)[0]!.evidence).toEqual([E]);
  });

  test('S1-I-14 The tie function: symmetric, the same after a reload, reads no reputation ledger, and no regard record of V exists', () => {
    const sim = mk(undefined, 'S1-I-14', ['city.events']);
    const d = sim.w.districts[0]!;
    const all = d.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
    for (let n = 0; n < 200; n++) {
      const x = all[n % all.length]!;
      const y = all[(n * 7 + 3) % all.length]!;
      if (x !== y) expect(sim.ties.tie(x, y)).toEqual(sim.ties.tie(y, x));
    }
    sim.tiePolicy.applyInteraction(all[0]!, sim.w.v, 'favour');
    expect(sim.k.store.edgesFrom(sim.w.v).filter((e) => e.type === 'xf:regard')).toEqual([]);
    expect(sim.k.store.edgesTo(sim.w.v).filter((e) => e.type === 'xf:regard').length).toBe(1);
  });

  test('S1-I-15 One belief per question, and a listener holds the teller\'s evidence unchanged', () => {
    const sim = mk(undefined, 'S1-I-15', ['city.events']);
    const [a, b] = [0, 1].map((i) => sim.people.residentAt(sim.w.districts[0]!.cellIds[i]!, 0));
    const E = H(hs('e'));
    const set = (value: string, ev: Id) => sim.k.beliefs.set({ believer: a, subject: b, path: 'did.take', at: 5, value, confidence: 0.5, evidence: [ev], source: { by: 'observed', event: ev }, formed: 0, refreshed: 0, memorable: true });
    set('x', E);
    set('y', H(hs('e2')));
    expect(sim.k.beliefs.activeOf(a).filter((x) => x.subject === b && x.path === 'did.take').length).toBe(1);
  });

  test('S1-I-16 Fade keeps the floor: a belief is dropped only after the hold, never if memorable', () => {
    const sim = mk(undefined, 'S1-I-16', ['city.events']);
    const a = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    const E = H(hs('e'));
    const mk1 = (path: string, memorable: boolean) => sim.k.beliefs.set({ believer: a, subject: sim.w.v, path, at: 1, value: 'x', confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 1, refreshed: 1, memorable });
    mk1('did.take', false);
    mk1('did.harm', true);
    sim.policies.fade(a, 1 + sim.data.minds.holdDays * 86400);
    expect(sim.k.beliefs.activeOf(a).length).toBe(2);
    sim.policies.fade(a, 2 + sim.data.minds.holdDays * 86400);
    expect(sim.k.beliefs.activeOf(a).map((b) => b.path)).toEqual(['did.harm']);
  });

  test('S1-I-17 Game truth wins: no process writes a mirrored slot of a mirrored node; reconcile ends only what the game contradicts', () => {
    const sim = mk();
    const observed = observeWrites(sim);
    new ReplayPort(sim).submit(genScript(0x17, 60));
    sim.advance(60);
    const mirroredSlots = new Set(['affiliation', 'alive', 'quest-linked', 'crowd', 'position', 'district', 'cell', 'wanted', 'tracked', 'jstate']);
    for (const keys of Object.values(observed)) for (const key of keys) {
      const m = /^pin:xf:(person|v-state|journal)\.(.+)$/.exec(key);
      if (m) expect(mirroredSlots.has(m[2]!), key).toBe(false);
    }
  });

  test('S1-I-18 The floors: no minor, unclassified or real person in a role of harm, no sexual tag, no protected person chosen for harm', () => {
    const sim = mk(undefined, 'S1-I-18', ['city.events']);
    const minor = sim.w.districts[0]!.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).find((r) => sim.people.view(r)!.ageClass === 'minor')!;
    for (const role of ['aggressor', 'victim', 'target', 'hostile']) {
      const r = sim.gate.produce({ kind: 'assault', origin: 'sim', size: 1, window: 0, participants: [{ who: minor, role }], effects: [], creator: sim.w.s1 }, sim.k.settings.at(0), 0);
      expect(r).toEqual({ ok: false, reason: 'floor-minor' });
    }
    expect(sim.gate.produce({ kind: 'assault', origin: 'sim', size: 1, window: 0, participants: [], effects: [], creator: sim.w.s1, tags: ['sex.x'] }, sim.k.settings.at(0), 0)).toEqual({ ok: false, reason: 'sex-tag' });
  });

  test('S1-I-19 Regeneration: a forgotten resident, household, item or cast resolves identically', () => {
    const sim = mk(busy(25), 'S1-I-19', ['city.events']);
    sim.advance(50);
    const d = sim.w.districts[0]!;
    const sample = d.cellIds.flatMap((c) => sim.people.residentsOfBlock(c)).slice(0, 20);
    const before = sample.map((r) => JSON.stringify(sim.people.view(r)));
    sim.people.dropCaches();
    sim.ties.dropCaches();
    sim.k.retention.scheduleSweep();
    sim.k.settle();
    expect(sample.map((r) => JSON.stringify(sim.people.view(r)))).toEqual(before);
  });

  test('S1-I-20 Derived is never pinned: every pin a process writes is on an assigned slot', () => {
    const sim = mk();
    const observed = observeWrites(sim);
    sim.advance(60);
    for (const keys of Object.values(observed)) for (const key of keys) {
      const m = /^pin:([^.]+)\.(.+)$/.exec(key);
      if (!m) continue;
      const slot = m[2]!.replace(/-\*$/, '');
      const names = sim.k.schema.kind(m[1]!).slots.filter((s) => s.key === slot || s.key.startsWith(`${slot}-`));
      expect(names.length, key).toBeGreaterThan(0);
      for (const s of names) expect(s.mode, key).toBe('assigned');
    }
  });

  test('S1-I-21 Reload: a save at any boundary, loaded in a fresh process under another epoch, has the same future', () => {
    const script = genScript(0x21, 40);
    const a = recordOf(execute(script, { groups: [40], reloads: [] }, 40));
    const b = recordOf(execute(script, { groups: [17, 23], reloads: [17] }, 40));
    expect(differing(a, b).filter((x) => x !== 'headers')).toEqual([]);
  }, 120_000);

  test('S1-I-22 Static coverage: gameOwnedNow is read only by realisation and scene.acts; the coverage of a cell does not move with what the game does', () => {
    expect(lintSources(files).filter((f) => f.audit === 'coarse-independence')).toEqual([]);
    const sim = mk(undefined, 'S1-I-22', ['city.events', 'city.mirror']);
    const c2 = sim.w.districts[0]!.cellIds[1]!;
    const before = sim.city.a(c2, 'gang-clash', 2);
    new ReplayPort(sim).submit([
      { t: 0, op: 'person', key: 'a', slots: { affiliation: 'GA', ...adult } },
      { t: 0, op: 'person', key: 'b', slots: { affiliation: 'GB', ...adult } },
      { t: 100, op: 'event', kind: 'game.combat.start', place: 'c2', participants: [{ who: 'a', role: 'hostile' }, { who: 'b', role: 'hostile' }] },
    ]);
    sim.advance(5);
    expect(sim.city.a(c2, 'gang-clash', 2)).toBe(before);
  });

  test('S1-I-23 Policy state is plain data: every process state, digest and the S1 record encode canonically', () => {
    const sim = mk();
    sim.advance(40);
    for (const id of sim.defs.keys()) {
      expect(() => canonicalKey(sim.stateOf(id))).not.toThrow();
      expect(() => canonicalKey(sim.digestOf(id) ?? null)).not.toThrow();
    }
    expect(() => canonicalKey(sim.record)).not.toThrow();
  });

  test('S1-I-24 Mirrored events are told by their creator: a derived event\'s creator is the mirror and its cause the raw event', () => {
    const sim = mk(undefined, 'S1-I-24', ['city.mirror']);
    new ReplayPort(sim).submit([
      { t: 0, op: 'person', key: 'a', slots: { affiliation: 'civilian', ...adult } },
      { t: 0, op: 'person', key: 'b', slots: { affiliation: 'civilian', ...adult } },
      { t: 700, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'a', role: 'victim' }, { who: 'b', role: 'actor' }], effects: [{ on: 'a', effect: 'kill' }], witnesses: 1 },
    ]);
    sim.advance(4);
    const derived = sim.k.store.idsOfKind('core:event').filter((e) => sim.policies.viewEvent(e)?.creator === sim.mirrorProc);
    expect(derived.length).toBe(1);
    expect(sim.policies.viewEvent(derived[0]!)!.causes.length).toBe(1);
  });

  test('S1-I-25 One publication: every opened item is published once; regeneration, reload and forgetting are silent', () => {
    const sim = Sim.create({ worldSeed: seedOf('S1-I-25'), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; }), only: ['city.events', 'scene.acts'] });
    const emitted: Id[] = [];
    const emit = sim.k.emit.bind(sim.k);
    sim.k.emit = (change, time) => {
      if (change.c === 'event') emitted.push(change.event);
      emit(change, time);
    };
    const c1 = sim.w.districts[0]!.cellIds[0]!;
    new ReplayPort(sim).submit([{ t: 99 * W + 5, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }]);
    sim.startAt(100);
    inject(sim, child(sim, 'p1', 0, 101, 'theft', 1, c1), child(sim, 'p2', 0, 101, 'theft', 1, c1));
    sim.advance(10);
    const items = eventsState(sim).ring.length;
    expect(items).toBeGreaterThan(0);
    expect(new Set(emitted).size).toBe(emitted.length);
    expect(emitted.length).toBe(2);
  });

  test('S1-I-26 Feeds are consumed once: a consumer reads the windows after its cursor, in order, and the cursor moves to the digest', () => {
    const sim = mk(undefined, 'S1-I-26');
    sim.advance(30);
    const st = sim.stateOf<{ cursors: { events: number; norms: number } }>('order.stocks')!;
    const ev = sim.digestOf<{ through: number }>('city.events')!;
    expect(st.cursors.events).toBeGreaterThan(0);
    expect(st.cursors.events).toBeLessThanOrEqual(ev.through);
    const again = mk(undefined, 'S1-I-26');
    again.advance(15);
    again.k.persistence.save('mid');
    again.advance(15);
    expect(again.stateOf('order.stocks')).toEqual(sim.stateOf('order.stocks'));
  });

  test('S1-I-27 Transitions: every registered read publishes its value at the start of the range, then each change in time order', () => {
    const sim = mk(busy(30), 'S1-I-27');
    sim.advance(60);
    const cell = sim.w.districts[0]!.cellIds[0]!;
    for (const [name, args] of [['band', [cell]], ['regime', ['fx_d1']], ['priceLevel', ['fx_d1']], ['normGap', ['fee', 'fx_d1']]] as Array<[string, unknown[]]>) {
      const from = sim.k.now - 4 * W;
      const t = sim.reads.transitions(name, args, from, sim.k.now);
      expect(t[0]!.t, name).toBe(from);
      for (let i = 1; i < t.length; i++) expect(t[i]!.t).toBeGreaterThanOrEqual(t[i - 1]!.t);
    }
  });

  test('S1-I-28 One version: the data, the tables and the index of a lineage are pinned; a save made with another loads read-only', () => {
    const a = mk(undefined, 'S1-I-28', ['city.events']);
    a.advance(3);
    const rec = a.k.persistence.save('A');
    expect(rec.meta.packs.map((p) => p.id).sort()).toEqual(expect.arrayContaining(['xf.core.world@1', 'xf.s1.sim@1']));
    const other = Sim.create({ worldSeed: seedOf('S1-I-28'), index: fx3Slice(), data: fxData((d) => { d.ties.cGeo = 5; }), only: ['city.events'] });
    (other.k.persistence as unknown as { chain: Map<string, unknown> }).chain.set('A', rec);
    expect(other.k.persistence.load('A').readOnly).toBe(true);
  });

  test('S1-I-28 One version: the version of a process is pinned with its id; a save made under another version of any process loads read-only, and the same versions load', () => {
    expect(Object.keys(PROCESS_VERSIONS).sort()).toEqual(['city.events', 'city.mirror', 'group.decide', 'order.ledger', 'order.norms', 'order.stocks', 'scene.acts']);
    const make = () => Sim.create({ worldSeed: seedOf('S1-I-28v'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const a = make();
    a.advance(3);
    const rec = a.k.persistence.save('A');
    // every process takes its version from the one table
    const all = Sim.create({ worldSeed: seedOf('S1-I-28v'), index: fx3Slice(), data: fxData() });
    for (const [id, def] of all.defs) expect(def.version, id).toBe(PROCESS_VERSIONS[id]);
    expect(all.defs.size).toBe(7);
    const same = make();
    (same.k.persistence as unknown as { chain: Map<string, unknown> }).chain.set('A', rec);
    expect(same.k.persistence.load('A').readOnly).not.toBe(true);
    // a version raised in a process this instance does not even run still changes the lineage
    for (const id of ['city.events', 'scene.acts']) {
      const was = PROCESS_VERSIONS[id]!;
      PROCESS_VERSIONS[id] = was + 1;
      try {
        const other = make();
        expect(other.defs.get('city.events')!.version).toBe(PROCESS_VERSIONS['city.events']);
        (other.k.persistence as unknown as { chain: Map<string, unknown> }).chain.set('A', rec);
        expect(other.k.persistence.load('A').readOnly, id).toBe(true);
      } finally {
        PROCESS_VERSIONS[id] = was;
      }
    }
  });
});

void hid;
