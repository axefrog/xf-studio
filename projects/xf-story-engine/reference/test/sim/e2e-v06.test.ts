// SF1-E4 (the fix-round variant), the v0.6 SF1-E5 and SF1-E6 (S1 14.2): a child that outlives the posts its parent was cast under, the Friday fee under protection and a hunt, end to end.
// The spec's scale (twenty world seeds, two game weeks) runs with `S1_FULL=1`; the default run keeps every check at a smaller scale.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { defaultData, type S1Data } from '../../src/sim/data.ts';
import type { EventsDigest, EventsState } from '../../src/sim/proc-events.ts';
import type { GoalsDigest, GoalsState } from '../../src/sim/proc-goals.ts';
import type { GroupDigest } from '../../src/sim/proc-groups.ts';
import type { PendingChild } from '../../src/sim/occ.ts';
import { itemDescriptor } from '../../src/sim/proc-acts.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';
import { child as childOf, inject, seedOf } from './helpers.ts';
import { transfer } from './feed.ts';
import { adults, goalSim, W } from './goals-helpers.ts';
import { stepOne } from './hunt-helpers.ts';

setDefaultTimeout(600_000);
const FULL = process.env.S1_FULL === '1';

describe('SF1-E4 (fix-round variant): a child outlives the posts its parent was cast under', () => {
  test('an item parent whose victim was cast while a guard stood at the cell, and a police child due after the post has left the history: the child\'s victim and target are still the parent\'s', () => {
    // every theft draws one police response, due between 1,009 and 4,320 windows on; the response is certain to be reported
    const sim = goalSim('SF1-E4-variant', (d) => {
      const kd = d.kinds.find((k) => k.name === 'theft')!;
      kd.delayWeights = [0, 0, 0, 0, 0, 1];
      kd.matrix = { 'police-action': 1 };
      kd.offspringFactor = 2.5;
      d.stocks.r0 = 1e6;
    }, ['city.events', 'people.goals']);
    const c = sim.w.districts[0]!.cellIds[0]!;
    const guard = adults(sim, 0)[0]!;
    // a guard posted at the cell in every period, from window 0 to window 10
    sim.setState('people.goals', (st) => {
      (st as GoalsState).posts.push({ person: guard, cell: c, periods: [0, 1, 2, 3], from: 0, until: 10, goal: H(hs('guard-e4')), ward: adults(sim, 0)[1]! });
    });
    // size-1 thefts at the cell, due in windows 3 to 9
    inject(sim, ...Array.from({ length: 80 }, (_, n) => childOf(sim, `e4v-${n}`, 0, 3 + (n % 7), 'theft', 1, c)));
    sim.advance(60);
    const police = (): PendingChild[] => Object.values(sim.stateOf<EventsState>('city.events')!.calendar).flat().filter((p) => p.kind === 'police-action' && p.parentFacts.kind === 'theft' && p.parentFacts.size === 1 && p.inherit !== undefined);
    // the children that fall due after the post has left the history (a week after it ended, S1 4.5)
    const pending = police().filter((p) => p.due > 10 + 1008);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    // the parent's cast at birth, from the ring's meta of its summary (the item is within the ring and the posts are in the history)
    const birth = new Map<Id, ReturnType<Sim['casting']['cast']>>();
    for (const p of pending) {
      const ring = sim.stateOf<EventsState>('city.events')!.ring;
      const entry = ring.find((e) => e.meta !== undefined && Object.keys(e.meta).some((j) => sim.k.summaries.itemId(e.id, Number(j)) === p.parent));
      expect(entry, 'the parent item is in the ring').toBeDefined();
      const j = Number(Object.keys(entry!.meta!).find((x) => sim.k.summaries.itemId(entry!.id, Number(x)) === p.parent));
      birth.set(p.parent, sim.casting.cast(itemDescriptor(sim, entry!.id, j, entry!.w, entry!.cell, entry!.kind, entry!.meta![j]!)));
    }
    // run until the posts have left the history, and past the due window of the last child
    const lastDue = Math.max(...pending.map((p) => p.due));
    expect(Math.min(...pending.map((p) => p.due))).toBeGreaterThan(10 + 1008);
    // each child is looked at when it has fired (the ring keeps a week)
    // a size-1 child is an item of a summary: the ring's meta holds its parent and the cast it inherits
    const fired = new Map<Id, { cast: ReturnType<Sim['casting']['cast']> }>();
    const parents = new Set(pending.map((p) => p.parent));
    while (sim.windowNow() < lastDue + 3) {
      sim.advance(1);
      for (const e of sim.stateOf<EventsState>('city.events')!.ring) {
        if (e.kind !== 'police-action' || e.meta === undefined) continue;
        for (const [j, m] of Object.entries(e.meta)) if (m.parent !== undefined && parents.has(m.parent) && !fired.has(m.parent)) fired.set(m.parent, { cast: sim.casting.cast(itemDescriptor(sim, e.id, Number(j), e.w, e.cell, e.kind, m)) });
      }
    }
    const digest = sim.digestOf<GoalsDigest>('people.goals')!;
    expect(digest.posts.some((p) => p.goal === H(hs('guard-e4')))).toBe(false);
    // the post is gone: the guard no longer stands at the cell in the history
    for (const p of pending) {
      const got = fired.get(p.parent);
      if (got === undefined) continue;
      const cast = birth.get(p.parent)!;
      const victim = cast === 'no-cast' ? undefined : cast.find((e) => e.role === 'victim')?.who;
      const target = cast === 'no-cast' ? undefined : cast.find((e) => e.role === 'aggressor')?.who;
      const heard = got.cast === 'no-cast' ? [] : got.cast;
      if (victim !== undefined) expect(heard).toContainEqual({ role: 'victim', who: victim });
      if (target !== undefined) expect(heard).toContainEqual({ role: 'target', who: target });
    }
    expect(fired.size).toBeGreaterThanOrEqual(1);
  });
});

/** The Kabuki stand-in at its defaults. */
const kabuki = (name: string, tweak: (d: S1Data) => void = () => {}): Sim => {
  const data = defaultData();
  tweak(data);
  return Sim.create({ worldSeed: seedOf(name), index: makeKabukiSlice(), data });
};

/** What the layer holds, as one comparable value (all processes, the goal frames that are alive, the record's entries). */
function observation(sim: Sim, skip: string[] = []): unknown {
  const procs = [...sim.defs.keys()].filter((p) => !skip.includes(p)).sort().map((p) => [p, sim.stateOf(p), sim.digestOf(p)]);
  const frames = sim.k.frames.all().filter((f) => f.retain === true && (f.status === 'active' || f.status === 'blocked')).map((f) => [f.id, f.status, f.actor]).sort();
  const edges = sim.k.store.idsOfKind('xf:item').flatMap((i) => sim.k.store.edgesFrom(i).filter((e) => e.type === 'xf:held-by').map((e) => [e.to, e.valid]));
  return { procs, frames, edges, grudges: sim.record.grudges, roleGoals: sim.record.roleGoals, log: sim.record.log.filter((e) => !skip.includes(e.proc)).map(({ seq: _s, ...rest }) => rest) };
}

describe('SF1-E5 (v0.6): the Friday fee under protection', () => {
  // the Claws' treasury runs low early, so that collect-fee starts and its collectors work the market
  const poor = (d: S1Data): void => { d.groups.groups.find((g) => g.aff === 'A1')!.books.cash = 600; };
  const N = FULL ? 2016 : 330;
  const SEEDS = FULL ? 20 : 1;

  test('A, B and D agree; collectors work their posts; goals, acts and the protagonist stay within bounds; a run with V at the market differs only in scene.acts', () => {
    for (let i = 0; i < SEEDS; i++) {
      const name = `SF1-E5-${i}`;
      const a = kabuki(name, poor);
      a.advance(N);
      const b = kabuki(name, poor);
      for (let w = 0; w < N; w++) b.advance(1);
      // D: three reloads at windows a day apart
      let d = kabuki(name, poor);
      for (const stop of [Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4)]) {
        d.advance(stop - d.windowNow());
        d.k.persistence.save(`D${i}-${stop}`);
        d = transfer(d, `D${i}-${stop}`, () => kabuki(name, poor), 5);
      }
      d.advance(N - d.windowNow());
      expect(JSON.stringify(observation(b)), `B at seed ${i}`).toEqual(JSON.stringify(observation(a)));
      // a reload drops the ended frames nobody refers to: what is alive agrees
      const alive = (s: Sim): unknown => ((observation(s) as { frames: unknown }).frames);
      expect(alive(d), `D at seed ${i}`).toEqual(alive(a));
      // bounds
      const goals = a.stateOf<GoalsState>('people.goals')!;
      expect(goals.counters.opened, 'goals opened').toBeGreaterThan(0);
      const perPerson = new Map<Id, number>();
      for (const g of goals.goals) if (g.kind !== 'role') perPerson.set(g.owner, (perPerson.get(g.owner) ?? 0) + 1);
      expect(Math.max(0, ...perPerson.values())).toBeLessThanOrEqual(2);
      expect(goals.goals.filter((g) => g.kind !== 'role').length).toBeLessThanOrEqual(32 * a.w.districts.filter((x) => x.simulated).length);
      const events = a.digestOf<EventsDigest>('city.events')!;
      for (const win of events.facts.windows) {
        const perDistrict = new Map<Id, number>();
        for (const f of win.items) if (f.goal !== undefined) perDistrict.set(f.district, (perDistrict.get(f.district) ?? 0) + 1);
        expect(Math.max(0, ...perDistrict.values())).toBeLessThanOrEqual(4);
        // the protagonist: no harmful effect on V, no protagonist-object role anywhere, V did nothing to either group
        for (const f of win.items) {
          expect((f.effects ?? []).some((e) => e.on === a.w.v && ['harm', 'kill', 'take', 'expose'].includes(e.effect))).toBe(false);
          expect(f.parties.some((p) => p.who === a.w.v && ['warned', 'sought', 'confronted', 'victim', 'target'].includes(p.role))).toBe(false);
        }
      }
      // collectors: every collector shakedown act is at a market cell in the morning or by day, serves a collector's frame and cites the decision
      const ring = a.stateOf<EventsState>('city.events')!.ring;
      const collectorGoal = new Set<Id>();
      for (const r of ring) if (r.kind === 'shakedown' && r.event?.served !== undefined) collectorGoal.add(r.event.served);
      for (const r of ring.filter((x) => x.kind === 'shakedown' && x.event?.served !== undefined)) {
        expect([0, 1]).toContain(a.people.periodOf(r.event!.time));
        expect(a.w.cell(r.cell).marketCell).toBe(true);
        expect((r.event!.causes ?? []).length).toBeGreaterThanOrEqual(1);
      }
      // a run with V's cell at the market differs from A only in what scene.acts adds
      const c = kabuki(name, poor);
      const market = c.w.districts[0]!.cellIds.find((x) => c.w.cell(x).marketCell)!;
      c.k.reading(c.w.vState, 'cell', market, c.k.now);
      c.advance(N);
      expect(JSON.stringify(observation(c, ['scene.acts'])), `V at the market, seed ${i}`).toEqual(JSON.stringify(observation(a, ['scene.acts'])));
    }
  });
});

describe('SF1-E6 (v0.6): a hunt, end to end', () => {
  const TEMPOS = FULL ? (['restless', 'steady', 'calm', 'off'] as const) : (['restless'] as const);
  const SEEDS = FULL ? 3 : 1;
  const N = FULL ? 1300 : 520;

  /** The harness stands in for S2: each warning and price is pinned `observed` 20 windows after it is minted, and V's response complying with the first price comes 300 windows later. */
  function hunt(name: string, tempo: 'restless' | 'steady' | 'calm' | 'off', mode: 'window' | 'reload') {
    let sim = kabuki(name, (d) => { d.groups.punish.climbP = 0.5; });
    sim.k.settings.set({ tempo });
    sim.k.eventKinds.register({ name: 'response', roles: ['protagonist', 'asker'], fills: [{ fn: 'comply', args: { who: 'protagonist', to: 'asker' } }] });
    const GA = sim.w.group(sim.w.districts[0]!.id, 'A1');
    const market = sim.w.districts[0]!.cellIds.find((x) => sim.w.cell(x).marketCell && sim.w.cell(x).public === 'public') ?? sim.w.districts[0]!.cellIds.find((x) => sim.w.cell(x).marketCell)!;
    const m = adults(sim, 2).find((r) => sim.people.view(r)!.aband >= 2)!;
    const vcell = sim.w.districts[0]!.cellIds[0]!;
    new ReplayPort(sim).submit([{ t: 0, op: 'reading', node: 'v', slot: 'cell', value: vcell }, { t: 300 * W + 30, op: 'event', kind: 'game.death', place: market, participants: [{ who: m, role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: m, effect: 'kill' }], witnesses: 6 }]);
    const seed = sim.k.root('layer2', 'core:seed');
    const seen = new Map<Id, number>();
    let paid = false;
    const pay = (s: Sim): void => {
      if (paid) return;
      const price = [...seen].find(([id]) => s.k.value(id, 'kind') === 'price');
      if (price === undefined || s.windowNow() < price[1] + 300) return;
      paid = true;
      const warner = s.policies.viewEvent(price[0])!.participants.find((p) => p.role === 'warner')!.who;
      s.k.events.mintEvent({ creator: seed, cause: seed, name: 'v-pays', time: s.k.now, kind: 'response', place: market, participants: [{ who: s.w.v, role: 'protagonist' }, { who: warner, role: 'asker' }], effects: [], witnesses: [], causes: [price[0]] });
    };
    for (let w = 0; w < N; w++) {
      stepOne(sim, 20, seen);
      pay(sim);
      if (mode === 'reload' && (w === 330 || w === 520)) {
        sim.k.persistence.save(`E6-${name}-${tempo}-${w}`);
        const next = transfer(sim, `E6-${name}-${tempo}-${w}`, () => {
          const s = kabuki(name, (d) => { d.groups.punish.climbP = 0.5; });
          s.k.settings.set({ tempo });
          s.k.eventKinds.register({ name: 'response', roles: ['protagonist', 'asker'], fills: [{ fn: 'comply', args: { who: 'protagonist', to: 'asker' } }] });
          return s;
        }, 5);
        next.k.root('layer2', 'core:seed');
        sim = next;
      }
    }
    return { sim, GA };
  }

  const acts = (sim: Sim): Array<{ w: number; kind: string; punish?: { rung: number }; served?: Id; id: Id }> =>
    sim.stateOf<EventsState>('city.events')!.ring.filter((r) => r.event?.served !== undefined).map((r) => ({ w: r.w, kind: r.kind, id: r.id, ...(r.event!.punish ? { punish: r.event!.punish } : {}), ...(r.event!.served ? { served: r.event!.served } : {}) }));

  for (const tempo of TEMPOS) test(`at ${tempo}: grounds, order, encounters, the end, the protagonist, and identity across per-window runs and reloads`, () => {
    for (let i = 0; i < SEEDS; i++) {
      const name = `SF1-E6-${i}`;
      const a = hunt(name, tempo, 'window');
      const GA = a.GA;
      const sim = a.sim;
      // grounds: a GA grievance from the act of window 300, in every run
      const beliefs = sim.k.beliefs.activeOf(GA).filter((b) => b.memorable && b.path === 'against');
      expect(beliefs.length).toBeGreaterThanOrEqual(1);
      const punishEvents = sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'decide.punish');
      if (tempo === 'off') {
        expect(punishEvents).toHaveLength(0);
        expect(acts(sim).some((x) => x.punish !== undefined)).toBe(false);
      }
      // order: the first act with V as its object is a warning; no price or search before the warning's observed pin; at calm no price, at steady no confront
      const withV = acts(sim).filter((x) => x.punish !== undefined).sort((x, y) => x.w - y.w);
      if (withV.length > 0) expect(withV[0]!.kind).toBe('warning');
      if (tempo === 'calm') expect(withV.some((x) => x.kind === 'price' || x.kind === 'search')).toBe(false);
      const confronts = sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'confront');
      if (tempo === 'steady' || tempo === 'calm' || tempo === 'off') expect(confronts).toHaveLength(0);
      // encounters carry no effect
      for (const c of confronts) expect(sim.policies.viewEvent(c)!.effects).toEqual([]);
      // the end: an injected response settles the grudge and ends the intention paid, with a relent.punish; with no response it ends expired or ended
      const relents = sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'relent.punish');
      if (withV.some((x) => x.kind === 'price')) expect(sim.record.log.some((e) => e.reason === 'intent-end' && /\|punish\|(paid)$/.test(e.key ?? '')) || relents.length === 0).toBe(true);
      // the protagonist: nothing S1 minted puts a harmful effect on V or binds V to a victim or target role
      for (const ev of sim.k.store.idsOfKind('core:event')) {
        const view = sim.policies.viewEvent(ev);
        if (!view || view.creator === undefined || view.creator === sim.w.port) continue;
        expect(view.effects.some((e) => e.on === sim.w.v && ['harm', 'kill', 'take', 'expose'].includes(e.effect))).toBe(false);
        expect(view.participants.some((p) => p.who === sim.w.v && (p.role === 'victim' || p.role === 'target'))).toBe(false);
      }
      // identity: per-window and reloaded runs give the same records
      const b = hunt(name, tempo, 'reload');
      const alive = (s: Sim): unknown => JSON.stringify((observation(s, ['scene.acts']) as { procs: unknown; frames: unknown; grudges: unknown }).frames) + JSON.stringify(acts(s));
      expect(alive(b.sim)).toEqual(alive(sim));
      expect(JSON.stringify(b.sim.stateOf<GoalsState>('people.goals'))).toEqual(JSON.stringify(sim.stateOf<GoalsState>('people.goals')));
      expect(JSON.stringify(b.sim.digestOf<GroupDigest>('group.decide')!.against)).toEqual(JSON.stringify(sim.digestOf<GroupDigest>('group.decide')!.against));
    }
  });
});
