// M3 run 2: the wide name registry of S1's pack. The registry is pack data (src/sim/names.ts): origins with their own given and family names,
// weighted by affiliation class and district. These tests check the data, that the schema audit still holds with it, and what residents are
// then called: many more names than the kernel's own pool, origins that follow the weights, and nothing that is the name of a character in the
// game's own stories. The default pack (no registry) is untouched, so every run before this one still rebuilds.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { makeConfig } from '../../src/config.ts';
import { auditSchema } from '../../src/sim/audit.ts';
import { defaultData } from '../../src/sim/data.ts';
import { RESERVED_NAMES, WIDE_NAMES, allNames, nameProblems } from '../../src/sim/names.ts';
import { simDefs, worldRegistry } from '../../src/sim/world-schema.ts';
import { buildWorld } from '../../src/m3/world.ts';

setDefaultTimeout(300_000);

describe('the registry as data', () => {
  test('it is well formed: one plain capitalised word per name, positive weights, known origins', () => {
    expect(nameProblems(WIDE_NAMES)).toEqual([]);
  });

  test('it is wide: a dozen origins and hundreds of names, where the kernel pool has seven given and six family names', () => {
    expect(Object.keys(WIDE_NAMES.origins).length).toBeGreaterThanOrEqual(10);
    expect(allNames().length).toBeGreaterThan(300);
  });

  test('no pool holds a name of a character in the game\'s own stories', () => {
    const names = new Set(allNames().map((n) => n.toLowerCase()));
    for (const reserved of RESERVED_NAMES) expect(names.has(reserved.toLowerCase()), reserved).toBe(false);
  });

  test('a registry with a repeated name, a two-word name or a weight on an unknown origin is refused', () => {
    const bad = structuredClone(WIDE_NAMES);
    bad.origins.japanese!.given.push('Haruto');
    bad.origins.chinese!.family.push('Van Dyke');
    bad.byClass[2] = { nowhere: 2 };
    const problems = nameProblems(bad);
    expect(problems.some((p) => p.includes('repeats'))).toBe(true);
    expect(problems.some((p) => p.includes('Van Dyke'))).toBe(true);
    expect(problems.some((p) => p.includes('nowhere'))).toBe(true);
  });

  test('the default pack carries no registry, and its schema has the core\'s own name dimensions only', () => {
    expect(defaultData().people.names).toBeUndefined();
    const defs = simDefs(defaultData());
    expect(defs.dims.some((d) => d.id === 'xf:given-name')).toBe(false);
  });

  test('the schema audit holds with the registry: names are display, and nothing reads them', () => {
    const data = defaultData();
    data.people.names = WIDE_NAMES;
    const defs = simDefs(data);
    expect(defs.dims.some((d) => d.id === 'xf:given-name')).toBe(true);
    expect(auditSchema(defs, worldRegistry(), makeConfig({ wSim: data.time.W, allowance: 5_000_000 }))).toEqual([]);
  });
});

describe('what residents are called', () => {
  const w = buildWorld({ name: 'names-test', layer3: false, packs: [], s1: (d) => { d.people.names = WIDE_NAMES; } });
  const k = w.sim.k;
  const people: Array<{ name: string; given: string; family: string; origin: string; affc: number }> = [];
  for (const cell of w.sim.w.districts[0]!.cellIds) {
    for (const r of w.sim.people.residentsOfBlock(cell)) {
      const v = w.sim.people.view(r);
      const name = String(k.value(k.address(r, 'name'), 'display'));
      const [given, family] = name.split(' ') as [string, string];
      const origin = Object.entries(WIDE_NAMES.origins).find(([, l]) => l.given.includes(given) && l.family.includes(family))?.[0];
      if (v && origin) people.push({ name, given, family, origin, affc: v.affc });
    }
  }

  test('every resident\'s name is a given and a family name of one origin of the registry', () => {
    expect(people.length).toBeGreaterThan(2000);
  });

  test('the names are many: well over a hundred distinct given names, and the same full name is rare', () => {
    expect(new Set(people.map((p) => p.given)).size).toBeGreaterThan(100);
    expect(new Set(people.map((p) => p.name)).size / people.length).toBeGreaterThan(0.45);
  });

  test('every origin appears, and the weights tilt the draw: the Claws are mostly of Kabuki\'s own origin, more than civilians are', () => {
    const origins = new Set(people.map((p) => p.origin));
    expect(origins.size).toBe(Object.keys(WIDE_NAMES.origins).length);
    const share = (affc: number, origin: string): number => people.filter((p) => p.affc === affc && p.origin === origin).length / people.filter((p) => p.affc === affc).length;
    expect(share(2, 'japanese')).toBeGreaterThan(share(0, 'japanese'));
    expect(share(2, 'japanese')).toBeGreaterThan(0.4);
    expect(share(0, 'japanese')).toBeLessThan(0.45);
    expect(share(1, 'anglo')).toBeGreaterThan(share(2, 'anglo'));
  });

  test('the draw is keyed by the world: the same name gives the same names', () => {
    const again = buildWorld({ name: 'names-test', layer3: false, packs: [], s1: (d) => { d.people.names = WIDE_NAMES; } });
    const cell = again.sim.w.districts[0]!.cellIds[0]!;
    const a = w.sim.people.residentsOfBlock(w.sim.w.districts[0]!.cellIds[0]!).map((r) => String(k.value(k.address(r, 'name'), 'display')));
    const b = again.sim.people.residentsOfBlock(cell).map((r) => String(again.sim.k.value(again.sim.k.address(r, 'name'), 'display')));
    expect(b).toEqual(a);
  });
});
