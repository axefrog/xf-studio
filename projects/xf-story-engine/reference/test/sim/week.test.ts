// The template-written week (S1 14.3): the record of a Kabuki week written out by a fixed template, the same under a reload.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { defaultData } from '../../src/sim/data.ts';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';
import { clockOf, weekLines, weekText } from '../../src/sim/week.ts';
import { restate, transfer } from './feed.ts';
import { seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
// the spec's week with two reloads takes longer than two minutes at S1_FULL scale
setDefaultTimeout(process.env.S1_FULL === '1' ? 900_000 : 120_000);

const W = 600;
const FULL = process.env.S1_FULL === '1';
const N = FULL ? 1008 : 96;
const adult = { alive: 'yes', 'age-class': 'adult' } as const;
const index = makeKabukiSlice();

const script: ReplayLine[] = [
  { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'wat_kab' },
  { t: 0, op: 'reading', node: 'v', slot: 'cell', value: 'g1' },
  { t: 0, op: 'person', key: 'claw', slots: { affiliation: 'TygerClaws', ...adult } },
  { t: 0, op: 'person', key: 'mox', slots: { affiliation: 'TheMox', ...adult } },
  { t: 0, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', ...adult } },
  { t: 40 * W + 100, op: 'event', kind: 'game.combat.start', place: 'g3', participants: [{ who: 'claw', role: 'hostile' }, { who: 'mox', role: 'hostile' }] },
  { t: 50 * W + 100, op: 'event', kind: 'game.death', place: 'g2', participants: [{ who: 'vendor', role: 'victim' }, { who: 'claw', role: 'actor' }], effects: [{ on: 'vendor', effect: 'kill' }], witnesses: 4 },
  { t: 60 * W + 100, op: 'event', kind: 'enf.fee.word', place: 'g2', participants: [{ who: 'claw', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: 6 },
];

const make = (): Sim => Sim.create({ worldSeed: seedOf('SF1-WEEK'), index, data: defaultData() });

/** Step the world a window at a time and write each window as it applies; `reloads` are boundaries at which the world is saved and loaded into a fresh process. */
function week(reloads: number[]): { lines: string[]; sim: Sim } {
  let sim = make();
  new ReplayPort(sim).submit(script);
  const lines: string[] = [];
  for (let w = 0; w < N; w++) {
    sim.advance(1);
    lines.push(...weekText(sim, w, w));
    if (reloads.includes(w + 1)) {
      sim.k.persistence.save(`wk${w + 1}`);
      sim = transfer(sim, `wk${w + 1}`, make, 4);
      restate(sim, script);
    }
  }
  return { lines, sim };
}

describe('the template-written week', () => {
  const a = week([]);

  test('every line is a time and a sentence of the template, in time order inside a window; the week has events, counts, changes and what the game did', () => {
    expect(a.lines.length).toBeGreaterThan(30);
    for (const l of a.lines) expect(l).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d {2}\S/);
    const text = a.lines.join('\n');
    expect(text).toContain('incident');
    expect(text).toMatch(/the heat of \S+ went from quiet to elevated/);
    expect(text).toContain("from the game's game.death");
    expect(text).toContain("from the game's game.combat.start");
    expect(text).toContain('the game reported enf.fee.word at g2 with 6 watching');
    expect(text).toMatch(/what (TygerClaws|TheMox) says and does went from/);
    if (FULL) expect(text).toMatch(/because of (a|an earlier) /);
    expect(text).toContain('with no cause in the record');
  });

  test('the same words from a run that loaded in the middle', () => {
    // the first run is the baseline and is not run again: one reload comparison is the whole of the check
    const b = week(FULL ? [100, 200] : [45, 75]);
    expect(b.lines).toEqual(a.lines);
  }, FULL ? 1_800_000 : 60_000); // a week run is well over bun's 5 s default on a loaded machine, and a full week with two reloads is minutes

  if (FULL) test('an additional uninterrupted week independently reproduces every baseline line', () => {
    expect(N).toBe(1008);
    expect(week([]).lines).toEqual(a.lines);
  }, 1_800_000);

  test('a window is written once its outputs have applied, and writing it does not change the world', () => {
    const sim = make();
    new ReplayPort(sim).submit(script);
    sim.advance(60);
    const before = JSON.stringify(sim.stateOf('city.events'));
    const w = sim.windowNow() - 1;
    const one = weekLines(sim, w);
    expect(weekLines(sim, w)).toEqual(one);
    expect(JSON.stringify(sim.stateOf('city.events'))).toBe(before);
    for (let i = 1; i < one.length; i++) expect(one[i]!.t).toBeGreaterThanOrEqual(one[i - 1]!.t);
    expect(clockOf(sim, 0)).toBe('Mon 00:00');
  });
});
