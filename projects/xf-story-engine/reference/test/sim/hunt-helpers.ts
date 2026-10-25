// A hunt in a small world (S1 7.8.1, D-30): a group of FX-3 has a member killed by V; the harness stands in for layer 2 (it pins a warning or a price
// `observed` after a delay, and can inject V's response), so the whole path from the grievance to the end can be studied window by window.

import { H, id as hid, i as hi, s as hs, rand } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import type { S1Data } from '../../src/sim/data.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import type { GroupDigest, GroupState } from '../../src/sim/proc-groups.ts';
import type { GoalsDigest } from '../../src/sim/proc-goals.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import type { Tempo } from '../../src/settings.ts';
import { adults, bigSim, gnode, W } from './goals-helpers.ts';

export const ALL = ['city.events', 'city.mirror', 'group.decide', 'people.goals', 'scene.acts'];

export interface Hunt {
  sim: Sim;
  GA: Id;
  /** The member of the group V killed, and the cell the killing happened in. */
  m: Id;
  cell: Id;
  /** Windows to step; after each the harness pins the warnings and prices it has seen `observed`, `delay` windows after they were minted (never when `delay` is null). */
  step(n: number): void;
  delay: number | null;
  /** The warnings and prices seen so far and the window each was minted in, for a second stepper that carries on from a save. */
  seen: Map<Id, number>;
}

/** One window of a hunt, and then the harness's part: each warning or price seen is pinned `observed` `delay` windows after it was minted (never when `delay` is null). */
export function stepOne(sim: Sim, delay: number | null, seen: Map<Id, number>): void {
  sim.advance(1);
  if (delay === null) return;
  for (const a of actsOf(sim)) if ((a.kind === 'warning' || a.kind === 'price') && !seen.has(a.id)) seen.set(a.id, a.w);
  const w = sim.windowNow();
  for (const [id, mintedAt] of seen) if (mintedAt + delay === w) sim.k.pin({ node: id, slot: 'outcome', value: 'done', reason: 'observed', at: sim.k.now, cause: H(hs('layer2')), evidence: id });
}

export interface HuntOptions {
  name: string;
  tempo?: Tempo;
  tweak?: (d: S1Data) => void;
  delay?: number | null;
  only?: string[];
  /** The window the killing happens in. */
  at?: number;
  /** The attempts of a duty's member draw (the spec's 24; a hunt fixture raises it so a duty is filled). */
  attempts?: number;
}

/** The goal acts of the ring, oldest first: window, Id, kind and what they cite. */
export function actsOf(sim: Sim): Array<{ w: number; id: Id; kind: string; served?: Id; punish?: { group: Id; intent: Id; rung: number }; causes?: Id[]; cell: Id }> {
  const st = sim.stateOf<EventsState>('city.events')!;
  return st.ring.filter((r) => r.event?.served !== undefined).map((r) => ({ w: r.w, id: r.id, kind: r.kind, served: r.event!.served, ...(r.event!.punish ? { punish: r.event!.punish } : {}), ...(r.event!.causes ? { causes: r.event!.causes } : {}), cell: r.cell }));
}

export function startHunt(o: HuntOptions): Hunt {
  // the draw of a member for a duty makes 24 attempts (S1 7.10) and a duty often goes unfilled in a small world; a hunt fixture lets it try on until it finds one, which changes no rule
  const sim = bigSim(o.name, (d) => { d.goals.attempts = o.attempts ?? 600; o.tweak?.(d); }, o.only ?? ALL);
  sim.k.settings.set({ tempo: o.tempo ?? 'restless' });
  const GA = gnode(sim, 'A1');
  sim.setState('group.decide', () => {});
  // the head's seat is held (the draw at t = 0 can fail in a small world, and no intention starts while it is vacant, S1 7.8)
  const g0 = sim.stateOf<GroupState>('group.decide')!.groups[GA]!;
  if (g0.seats[0]!.holder === null) {
    const head = adults(sim, 2, 'gang').find((r) => sim.people.view(r)!.aband >= 2 && !g0.seats.some((x) => x.holder === r))!;
    sim.setState('group.decide', (st) => {
      const seat = (st as GroupState).groups[GA]!.seats[0]!;
      seat.holder = head;
      seat.since = 0;
      seat.succ = 0;
      seat.lean = Object.keys(sim.data.groups.groups.find((x) => x.aff === 'A1')!.ethos)[0]!;
      seat.edged = false;
      seat.logged = true;
      delete seat.retry;
    });
  }
  // the leaders lean to retribution, so that a grievance weighs as much with the group as a hunt fixture needs (a leader's lean is a drawn trait, S1 7.8)
  sim.setState('group.decide', (st) => {
    for (const seat of (st as GroupState).groups[GA]!.seats) if (seat.holder !== null) seat.lean = 'retribution';
  });
  const holders = new Set(sim.stateOf<GroupState>('group.decide')!.groups[GA]!.seats.map((s) => s.holder));
  const m = adults(sim, 2, 'gang').find((r) => !holders.has(r))!;
  const cell = sim.w.districts[0]!.cellIds.find((c) => sim.w.cell(c).public === 'public')!;
  const at = o.at ?? 5;
  sim.startAt(at);
  new ReplayPort(sim).submit([{ t: at * W + 30, op: 'event', kind: 'game.death', place: cell, participants: [{ who: m, role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: m, effect: 'kill' }], witnesses: 6 }]);
  const seen = new Map<Id, number>();
  const delay = o.delay === undefined ? 20 : o.delay;
  const h: Hunt = {
    sim, GA, m, cell, delay, seen,
    step(n: number): void {
      for (let i = 0; i < n; i++) stepOne(sim, delay, seen);
    },
  };
  return h;
}

export const groupDigest = (sim: Sim): GroupDigest => sim.digestOf<GroupDigest>('group.decide')!;
export const goalsDigest = (sim: Sim): GoalsDigest => sim.digestOf<GoalsDigest>('people.goals')!;

/** The draw `procRand(w, tag, ...)` of a process, as the kernel keys it, for a fixture that predicts a decision. */
export const procDraw = (sim: Sim, process: string, w: number, ...key: Array<ReturnType<typeof hs> | ReturnType<typeof hid> | ReturnType<typeof hi>>): number => rand(hs('proc'), hid(sim.k.worldSeed), hs(process), hi(w), ...key);

/** The kinds of the events the harness's hunt minted, by window. */
export function minted(sim: Sim, kind: string): Id[] {
  return sim.k.store.idsOfKind('core:event').filter((x) => sim.k.value(x, 'kind') === kind).sort();
}
