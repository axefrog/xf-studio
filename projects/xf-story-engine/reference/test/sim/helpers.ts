// Fixtures for the simulation layer's tests: worlds over the fixture slice FX-3 and the Kabuki stand-in (S1 14).

import { hrec } from '../../src/canon.ts';
import { H, memberId, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { type S1Data, defaultData } from '../../src/sim/data.ts';
import type { Per4 } from '../../src/sim/data.ts';
import type { WorldIndex } from '../../src/sim/index-types.ts';
import { districtIdOf, fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { World } from '../../src/sim/world.ts';
import { Sim } from '../../src/sim/sim.ts';
import type { PendingChild } from '../../src/sim/occ.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { itemTime } from '../../src/summary.ts';

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


export const eventsState = (sim: Sim): EventsState => sim.k.evolution.states.get('city.events')!.state as EventsState;

/** Walk the ring: every occurrence with its window and time, events by their descriptor and items by their summary. */
export function occurrences(sim: Sim): Array<{ id: Id; kind: string; w: number; time: number; gen: number; chain: Id[]; parent?: Id }> {
  const out: Array<{ id: Id; kind: string; w: number; time: number; gen: number; chain: Id[]; parent?: Id }> = [];
  for (const e of eventsState(sim).ring) {
    if (e.event) {
      out.push({ id: e.id, kind: e.kind, w: e.w, time: e.event.time, gen: e.event.gen, chain: e.event.chain, ...(e.event.parent !== undefined ? { parent: e.event.parent } : {}) });
    } else if (e.meta && e.count !== undefined) {
      for (let j = 0; j < e.count; j++) {
        const m = e.meta[j];
        if (!m) continue;
        out.push({ id: sim.k.summaries.itemId(e.id, j), kind: e.kind, w: e.w, time: itemTime(e.id, j, e.w * W, W), gen: m.gen, chain: m.chain, ...(m.parent !== undefined ? { parent: m.parent } : {}) });
      }
    }
  }
  return out;
}


/** A second simulated district out of the rest of the city: the same totals, so no other district's opportunity changes. */
export function withSecondDistrict(): WorldIndex {
  const ix = structuredClone(fx3Slice());
  const d1 = Object.values(ix.districts)[0]!;
  const id2 = districtIdOf('fx_d2');
  const cells2 = [0, 1, 2].map((i) => memberId(id2, 'cells', i));
  const map = new Map(d1.cellIds.map((c, i) => [c, cells2[i]!]));
  const d2 = { ...structuredClone(d1), id: id2, key: 'fx_d2', cellIds: cells2 };
  ix.districts[id2] = d2;
  for (const c of d1.cellIds) {
    const cc = structuredClone(ix.cells[c]!);
    const mapIds = (xs: Id[]): Id[] => xs.map((x) => map.get(x)!).sort();
    ix.cells[map.get(c)!] = { ...cc, id: map.get(c)!, district: id2, adj1: mapIds(cc.adj1), adj2: mapIds(cc.adj2) };
  }
  // the new district's effective opportunity (the cells' A, less what the game covers, times the propensity) leaves the rest
  for (const k of Object.keys(ix.rest.totalA)) {
    ix.rest.totalA[k] = ix.rest.totalA[k]!.map((x, p) => x - d1.cellIds.reduce((acc, c) => acc + ix.cells[c]!.A[k]![p]! * (1 - ix.cells[c]!.gameCoverage[k]!) * ix.cells[c]!.F[k]!, 0)) as Per4;
  }
  ix.names = { ...ix.names, fx_d2: id2 };
  const { hash: _h, ...rest } = ix;
  void _h;
  ix.hash = H(s('world-index'), hrec(rest as unknown as Record<string, unknown>));
  return ix;
}
