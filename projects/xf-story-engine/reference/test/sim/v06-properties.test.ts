// S1 v0.6 property tests over generated scripts (S1 14.3): intentions against the protagonist under random acts, tempo walks and observation lags; leaders under random removals;
// a goal's source taken away; regeneration of posts and casts under forgetting.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, mintedId, s as hs } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import type { Id } from '../../src/types.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import type { GroupState } from '../../src/sim/proc-groups.ts';
import type { GoalsState } from '../../src/sim/proc-goals.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { lcg } from './feed.ts';
import { adults, bigSim, gnode, W } from './goals-helpers.ts';
import { actsOf, minted } from './hunt-helpers.ts';
import { fxData, seedOf } from './helpers.ts';

setDefaultTimeout(600_000);
const FULL = process.env.S1_FULL === '1';
const MAX_RUNG = { off: 0, calm: 1, steady: 2, restless: 3 } as const;
const HARM = ['harm', 'kill', 'take', 'expose'];

describe('goals and intentions under generated scripts (S1 14.3)', () => {
  const SEEDS = FULL ? 12 : 3;
  const N = FULL ? 1100 : 700;

  test('random acts of V against a group, a random walk of tempo, warnings observed at random lags or never: no price, search or confront ever precedes an observed warning of its intention, no rung exceeds the tempo in force, and no S1 output harms V', () => {
    for (let s = 0; s < SEEDS; s++) {
      const rng = lcg(1000 + s);
      const sim = bigSim(`SF1-prop-d30-${s}`, (d) => {
        d.goals.attempts = 600;
        d.goals.rate.warning = 40; d.goals.rate.price = 40; d.goals.rate.search = 40;
        d.groups.punish.rungDwell = 5 + Math.floor(rng() * 60);
        d.groups.punish.climbP = 0.2 + rng() * 5;
      }, ['city.events', 'city.mirror', 'group.decide', 'people.goals', 'scene.acts']);
      const GA = gnode(sim, 'A1');
      sim.k.settings.set({ tempo: (['restless', 'steady', 'calm'] as const)[Math.floor(rng() * 3)]! });
      sim.setState('group.decide', () => {});
      const g0 = sim.stateOf<GroupState>('group.decide')!.groups[GA]!;
      const holders = new Set(g0.seats.map((x) => x.holder));
      const gang = adults(sim, 2, 'gang').filter((r) => !holders.has(r));
      sim.setState('group.decide', (st) => {
        for (const seat of (st as GroupState).groups[GA]!.seats) if (seat.holder !== null) seat.lean = 'retribution';
      });
      const markets = sim.w.districts[0]!.cellIds.filter((c) => sim.w.cell(c).public === 'public');
      const port = new ReplayPort(sim);
      // V acts against the group at random windows: a death of one of its members
      const deaths = 1 + Math.floor(rng() * 3);
      const lines = Array.from({ length: deaths }, (_, i) => ({
        t: (8 + Math.floor(rng() * (N / 2))) * W + 30 + i, op: 'event' as const, kind: 'game.death', place: markets[Math.floor(rng() * markets.length)]!,
        participants: [{ who: gang[i]!, role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: gang[i]!, effect: 'kill' as const }], witnesses: 6,
      }));
      port.submit([{ t: 0, op: 'reading', node: 'v', slot: 'cell', value: markets[0]! }, ...lines]);
      const lags = new Map<Id, number | null>();
      const acts = new Map<Id, { w: number; kind: string; time: number; punish?: { intent: Id; rung: number } }>();
      const tempos: Array<{ w: number; t: keyof typeof MAX_RUNG }> = [];
      for (let w = 0; w < N; w++) {
        if (w % 90 === 45) {
          const t = (['off', 'calm', 'steady', 'restless'] as const)[Math.floor(rng() * 4)]!;
          sim.k.settings.set({ tempo: t });
          tempos.push({ w, t });
        }
        sim.advance(1);
        for (const a of actsOf(sim)) {
          if (acts.has(a.id)) continue;
          acts.set(a.id, { w: a.w, kind: a.kind, time: sim.policies.viewEvent(a.id)?.time ?? a.w * W, ...(a.punish ? { punish: { intent: a.punish.intent, rung: a.punish.rung } } : {}) });
          if (a.kind === 'warning' || a.kind === 'price') lags.set(a.id, rng() < 0.4 ? null : 1 + Math.floor(rng() * 60));
        }
        for (const [id, lag] of lags) {
          if (lag === null) continue;
          const at = acts.get(id)!.w + lag;
          if (at === sim.windowNow()) {
            if (!sim.k.persistence.restoreReferencedHeader(id)) sim.remint(id);
            sim.k.pin({ node: id, slot: 'outcome', value: 'done', reason: 'observed', at: sim.k.now, cause: H(hs('layer2')), evidence: id });
          }
        }
      }
      const all = [...acts.entries()];
      for (const [id, a] of all) {
        if (a.punish === undefined) continue;
        // within the reach the tempo in force sets
        const t = sim.k.settings.at(a.time).tempo as keyof typeof MAX_RUNG;
        expect(a.punish.rung, `${a.kind} at ${a.time} under ${t}`).toBeLessThanOrEqual(MAX_RUNG[t]);
        // a price, a search and a confront need an earlier warning or price of the intention that was observed by then
        if (a.kind !== 'warning') {
          const earlier = all.filter(([, b]) => b.punish?.intent === a.punish!.intent && (b.kind === 'warning' || b.kind === 'price') && b.time <= a.time);
          expect(earlier.some(([wid]) => sim.k.observedAt(wid, a.time) !== undefined), `${a.kind} ${id} before any observed warning`).toBe(true);
        }
      }
      // a confront needs the same, and its price
      for (const c of minted(sim, 'confront')) {
        const ev = sim.policies.viewEvent(c)!;
        expect(ev.effects).toEqual([]);
        const intent = ev.causes.find((x) => sim.policies.viewEvent(x)?.kind === 'decide.punish');
        expect(intent).toBeDefined();
        const warnings = all.filter(([, b]) => b.punish?.intent === intent && (b.kind === 'warning' || b.kind === 'price'));
        expect(warnings.some(([wid]) => sim.k.observedAt(wid, ev.time) !== undefined)).toBe(true);
        expect(MAX_RUNG[sim.k.settings.at(ev.time).tempo as keyof typeof MAX_RUNG]).toBeGreaterThanOrEqual(3);
      }
      // nothing S1 minted harms V or binds V to a victim or target role
      for (const e of sim.k.store.idsOfKind('core:event')) {
        const v = sim.policies.viewEvent(e);
        if (!v || v.creator === sim.w.port) continue;
        expect(v.effects.some((x) => x.on === sim.w.v && HARM.includes(x.effect))).toBe(false);
        expect(v.participants.some((x) => x.who === sim.w.v && (x.role === 'victim' || x.role === 'target'))).toBe(false);
      }
    }
  });

  test('random removals of seat holders: every seat\'s holders form one unbroken record of edges and successions', () => {
    for (let s = 0; s < (FULL ? 8 : 2); s++) {
      const rng = lcg(5000 + s);
      const sim = bigSim(`SF1-prop-seats-${s}`, (d) => { d.goals.attempts = 600; }, ['city.events', 'group.decide']);
      const GA = gnode(sim, 'A1');
      sim.setState('group.decide', () => {});
      for (let w = 0; w < (FULL ? 900 : 500); w++) {
        sim.advance(1);
        // at random windows, kill a current holder of a seat of the group (a death pin)
        if (rng() < 0.02) {
          const g = sim.stateOf<GroupState>('group.decide')!.groups[GA]!;
          const held = g.seats.filter((x) => x.holder !== null);
          if (held.length > 0) {
            const victim = held[Math.floor(rng() * held.length)]!.holder!;
            sim.k.pin({ node: victim, slot: 'died', value: sim.k.now, reason: 'committed', cause: sim.w.port, at: sim.k.now });
          }
        }
      }
      sim.advance(2);
      const edges = sim.k.store.allEdges().filter((e) => e.type === 'xf:leads' && e.to === GA);
      const bySeat = new Map<number, typeof edges>();
      for (const e of edges) {
        const seat = Number((e.attrs as { seat?: number } | undefined)?.seat);
        bySeat.set(seat, [...(bySeat.get(seat) ?? []), e]);
      }
      const successions = sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === 'succession').map((x) => sim.policies.viewEvent(x)!);
      for (const [seat, list] of bySeat) {
        const sorted = [...list].sort((a, b) => a.valid.from - b.valid.from);
        // at most one holder at a time: an edge ends no later than the next one starts
        for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]!.valid.to, `seat ${seat}`).toBeDefined();
        for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]!.valid.to!).toBeLessThanOrEqual(sorted[i]!.valid.from);
        // every holder after the first came by a succession naming them
        for (const e of sorted.slice(1)) expect(successions.some((ev) => ev.participants.some((p) => p.role === 'successor' && p.who === e.from)), `a succession for ${e.from}`).toBe(true);
      }
      void mintedId; void hid; void processCause;
    }
  });
});

describe('counterfactual goals (S1 14.3)', () => {
  test('a goal\'s source taken from a script: its goal, frame and acts vanish, and every coarse output before its first act is unchanged', () => {
    const make = (name: string): Sim => Sim.create({
      worldSeed: seedOf(name), index: fx3Slice(),
      data: fxData((d) => {
        for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 6) as [number, number, number, number];
        d.goals.rate.assault = 400;
      }),
    });
    const name = 'SF1-counterfactual';
    const a = make(name);
    const b = make(name);
    // two civilians with no goal and no part in the story so far, and a seed's wrong done by one to the other at window 40
    const civs = adults(a, 0);
    adults(b, 0);
    const seed = a.k.root('script-seed', 'core:seed');
    b.k.root('script-seed', 'core:seed');
    for (let w = 0; w < 40; w++) { a.advance(1); b.advance(1); }
    const [x, y] = [civs[3]!, civs[4]!];
    const cell = a.w.districts[0]!.cellIds[0]!;
    const wrong = a.k.events.mintEvent({ creator: seed, cause: seed, name: 'the-wrong', time: a.k.now - 1, kind: 'assault', place: cell, participants: [{ who: x, role: 'aggressor' }, { who: y, role: 'victim' }], effects: [{ on: y, effect: 'harm' }], witnesses: [], causes: [] });
    let firstAct: number | undefined;
    const strip = (s: unknown): string => JSON.stringify(s);
    // the group process's record of the foreign events it has taken once (`seen`) is bookkeeping that names the wrong itself; what it decided is in `groups`
    const coarse = (s: Sim): string[] => ['city.events', 'group.decide', 'order.norms', 'order.stocks', 'order.ledger'].map((p) => strip(p === 'group.decide' ? (s.stateOf<GroupState>(p) as GroupState).groups : s.stateOf(p)));
    for (let w = 0; w < 600 && firstAct === undefined; w++) {
      a.advance(1);
      b.advance(1);
      const goal = (a.stateOf<GoalsState>('people.goals')?.goals ?? []).find((g) => g.source === wrong);
      const act = goal === undefined ? undefined : (a.stateOf<EventsState>('city.events')?.ring ?? []).find((r) => r.event?.served === goal.id);
      if (act) { firstAct = act.w; break; }
      // before the goal's first act, the coarse outputs are those of the world without the wrong
      expect(coarse(a)).toEqual(coarse(b));
    }
    const goal = (a.stateOf<GoalsState>('people.goals')?.goals ?? []).find((g) => g.source === wrong);
    const hadGoal = goal !== undefined || firstAct !== undefined;
    expect(hadGoal, 'the wrong opened a goal in the world that has it').toBe(true);
    expect((b.stateOf<GoalsState>('people.goals')?.goals ?? []).some((g) => g.owner === y && g.target === x && g.source === wrong)).toBe(false);
    expect((b.stateOf<EventsState>('city.events')?.ring ?? []).some((r) => r.event?.served !== undefined && r.event.fixed?.some((f) => f.who === y) && r.event.fixed.some((f) => f.who === x))).toBe(false);
    if (goal) expect(b.k.frames.frame(goal.id)).toBeUndefined();
  });
});
