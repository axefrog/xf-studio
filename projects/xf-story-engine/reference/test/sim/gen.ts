// Generated scripts and plans for the property tests (S1 14.3): named streams of one seed, call groupings, reload points, a shrinker.

import { expect } from 'bun:test';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import type { WorldIndex } from '../../src/sim/index-types.ts';
import { lcg, restate, transfer } from './feed.ts';
import { fxData, seedOf } from './helpers.ts';

const W = 600;

const adult = { alive: 'yes', 'age-class': 'adult' } as const;
const AFFS = ['civilian', 'civilian', 'GA', 'GB', 'ncpd', 'civilian'];
export const CELLS = ['c1', 'c2', 'c3'];

/** A generated external script: people, V's readings, raw deaths, combat, heat, and enforcement events, in named streams of one seed. */
export function genScript(seed: number, windows: number): ReplayLine[] {
  const rng = lcg(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const lines: ReplayLine[] = [
    { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'fx_d1' },
    { t: 0, op: 'reading', node: 'v', slot: 'cell', value: pick(CELLS) },
  ];
  const people = AFFS.map((aff, i) => ({ key: `p${i}`, aff }));
  for (const p of people) lines.push({ t: 0, op: 'person', key: p.key, slots: { affiliation: p.aff, ...adult } });
  for (let n = 0; n < 3; n++) lines.push({ t: Math.floor((6 + rng() * (windows - 12)) * W), op: 'reading', node: 'v', slot: 'cell', value: pick(CELLS) });
  const at = (): number => Math.floor((4 + rng() * (windows - 10)) * W + rng() * W);
  const count = Math.floor(windows / 7);
  for (let n = 0; n < count; n++) {
    const t = at();
    const kind = pick(['death', 'combat', 'heat', 'fee', 'uniforms']);
    const a = pick(people);
    const b = pick(people.filter((x) => x !== a));
    if (kind === 'death') {
      lines.push({ t, op: 'event', kind: 'game.death', place: pick(CELLS), participants: [{ who: b.key, role: 'victim' }, { who: rng() < 0.4 ? 'v' : a.key, role: 'actor' }], effects: [{ on: b.key, effect: 'kill' }], witnesses: Math.floor(rng() * 7) });
      if (rng() < 0.5) lines.push({ t, op: 'person', key: b.key, slots: { alive: 'no' } });
    } else if (kind === 'combat') {
      lines.push({ t, op: 'event', kind: 'game.combat.start', place: pick(CELLS), participants: [{ who: a.key, role: 'hostile' }, { who: b.key, role: 'hostile' }] });
    } else if (kind === 'heat') {
      lines.push({ t, op: 'event', kind: `game.heat.${1 + Math.floor(rng() * 4)}`, participants: [] });
    } else {
      lines.push({ t, op: 'event', kind: kind === 'fee' ? 'enf.fee.word' : 'enf.uniforms.word', place: pick(CELLS), participants: [{ who: a.key, role: 'enforcer' }, { who: b.key, role: 'target' }], witnesses: 2 + Math.floor(rng() * 8) });
    }
  }
  return lines;
}

export const make = (tweak: Parameters<typeof fxData>[0] = () => {}, index: WorldIndex = fx3Slice(), worldSeed = seedOf('properties')): Sim => Sim.create({ worldSeed, index, data: fxData(tweak) });

/** A plan: the call sizes that make up the windows and the boundaries at which the world is saved and loaded into a fresh process. */
export interface Plan {
  groups: number[];
  reloads: number[];
}

export function genPlan(seed: number, windows: number): Plan {
  const rng = lcg(seed ^ 0x9e3779b9);
  const groups: number[] = [];
  let left = windows;
  while (left > 0) {
    const g = Math.min(left, 1 + Math.floor(rng() * 30));
    groups.push(g);
    left -= g;
  }
  const reloads = Array.from({ length: Math.floor(rng() * 3) }, () => 1 + Math.floor(rng() * (windows - 2))).sort((a, b) => a - b);
  return { groups, reloads: [...new Set(reloads)] };
}

/** Run a script through a plan and give back the sim it ends with. */
export function execute(script: readonly ReplayLine[], plan: Plan, windows: number, mk: () => Sim = make): Sim {
  let sim = mk();
  new ReplayPort(sim).submit(script);
  const stops = new Set<number>(plan.reloads);
  let at = 0;
  for (const g of plan.groups) for (const target of [...new Set([...[...stops].filter((s) => s > at && s < at + g), at + g])].sort((a, b) => a - b)) {
    sim.advance(target - at);
    at = target;
    if (stops.has(target)) {
      sim.k.persistence.save(`s${target}`);
      sim = transfer(sim, `s${target}`, mk, 2 + (target % 5));
      restate(sim, script);
    }
  }
  expect(at).toBe(windows);
  return sim;
}

/** Shrink a failing script: drop lines while the failure stays. Returns the smallest script found. */
export function shrink(script: ReadonlyArray<ReplayLine>, fails: (s: ReplayLine[]) => boolean): ReplayLine[] {
  let cur = [...script];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = cur.length - 1; i >= 0; i--) {
      const without = [...cur.slice(0, i), ...cur.slice(i + 1)];
      if (fails(without)) cur = without;
    }
  }
  return cur;
}

