// Fixtures for the simulation layer's tests: worlds over the fixture slice FX-3 and the Kabuki stand-in (S1 14).

import { H, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { type S1Data, defaultData } from '../../src/sim/data.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { World } from '../../src/sim/world.ts';
import { Sim } from '../../src/sim/sim.ts';
import type { PendingChild } from '../../src/sim/occ.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';

const W = 600;

export const seedOf = (name: string): Id => H(s('fixture'), s(name));

/** The unit-fixture data (S1 14): flat propensity, `cGeo` 4, defaults otherwise. */
export function fxData(tweak: (d: S1Data) => void = () => {}): S1Data {
  const d = defaultData();
  d.events.flatPropensity = true;
  d.ties.cGeo = 4;
  tweak(d);
  return d;
}

export function fxWorld(name: string, tweak?: (d: S1Data) => void): World {
  return World.create({ worldSeed: seedOf(name), index: fx3Slice(), data: fxData(tweak) });
}

let kabukiIndex: ReturnType<typeof makeKabukiSlice> | undefined;
export function kabukiWorld(name: string, tweak?: (d: S1Data) => void): World {
  kabukiIndex ??= makeKabukiSlice();
  const data = defaultData();
  tweak?.(data);
  return World.create({ worldSeed: seedOf(name), index: kabukiIndex, data });
}

/** FX-3 with no incidents of its own, so a fixture injects exactly what it studies. */
export function quietData(tweak: (d: S1Data) => void = () => {}): S1Data {
  return fxData((d) => {
    for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = [0, 0, 0, 0];
    for (const r of d.regimes) r.arrival = 0;
    tweak(d);
  });
}

export function quietSim(name: string, tweak?: (d: S1Data) => void, only = ['city.events']): Sim {
  return Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only });
}

export function child(sim: Sim, name: string, index: number, due: number, kind: string, size: number, cell: Id, extra: Partial<PendingChild> = {}): PendingChild {
  const parent = H(s('fixture-parent'), s(name));
  return {
    parent, index, due, kind, size, cell, modBirth: 1,
    parentFacts: { id: parent, kind: 'theft', size: 2, w: due - 1, time: (due - 1) * W, cell, gen: 0, chain: [] },
    ...extra,
  };
}

export function inject(sim: Sim, ...cs: PendingChild[]): void {
  const district = sim.w.districts[0]!.id;
  sim.setState('city.events', (st) => {
    const state = st as EventsState;
    state.calendar[district] = [...(state.calendar[district] ?? []), ...cs].sort((a, b) => a.due - b.due || (a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : 0) || a.index - b.index);
  });
}

