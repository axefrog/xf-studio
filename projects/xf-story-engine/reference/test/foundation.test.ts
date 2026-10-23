import { describe, expect, test } from 'bun:test';
import { makeConfig } from '../src/config.ts';
import { coreDefs, mergeDefs } from '../src/core-schema.ts';
import { H, id, s } from '../src/id.ts';
import { ALL, contains, intersect, isEmpty, ivlRegion, setRegion, subtract, boxRegion } from '../src/region.ts';
import { coreRegistry } from '../src/registry.ts';
import { Schema, SchemaError, parseSlotPath } from '../src/schema.ts';
import type { DimensionDef, KindDef, SchemaDefs } from '../src/schema-types.ts';
import {
  checkValue, domainRegion, encodeValue, enumerateRegion, normalizeRegion, pointRegion, regionSize, toGridIndex,
} from '../src/value.ts';
import { Allowance, Budget, DefectLog, LimitExceeded, Worklist } from '../src/work.ts';
import { bytesToHex, i64Bytes } from '../src/id.ts';

describe('regions (spec 3.2)', () => {
  test('set intersection, emptiness and membership', () => {
    const a = setRegion(['b', 'a', 'c']);
    expect(a).toEqual({ r: 'set', values: ['a', 'b', 'c'] });
    const b = setRegion(['c', 'd']);
    expect(intersect(a, b)).toEqual({ r: 'set', values: ['c'] });
    expect(isEmpty(intersect(a, setRegion(['z'])))).toBe(true);
    expect(contains(a, 'b')).toBe(true);
    expect(contains(a, 'z')).toBe(false);
    expect(intersect(ALL, a)).toBe(a);
    expect(intersect(a, ALL)).toBe(a);
  });

  test('interval regions merge, intersect and subtract', () => {
    expect(ivlRegion([[5, 9], [1, 3], [2, 4]])).toEqual({ r: 'ivl', ivls: [[1, 4], [5, 9]] });
    const a = ivlRegion([[0, 10]]);
    const b = ivlRegion([[3, 5], [8, 12]]);
    expect(intersect(a, b)).toEqual({ r: 'ivl', ivls: [[3, 5], [8, 10]] });
    expect(subtract(a, b, 1)).toEqual({ r: 'ivl', ivls: [[0, 2], [6, 7]] });
    expect(contains(a, 10)).toBe(true);
    expect(contains(a, 11)).toBe(false);
    expect(isEmpty(ivlRegion([[3, 2]]))).toBe(true);
  });

  test('box intersection and subtraction rules', () => {
    const a = boxRegion([[[0, 4], [0, 4]]]);
    const b = boxRegion([[[2, 6], [3, 9]]]);
    expect(intersect(a, b)).toEqual({ r: 'box', boxes: [[[2, 4], [3, 4]]] });
    expect(contains(a, [1, 1])).toBe(true);
    expect(contains(a, [5, 1])).toBe(false);
    expect(() => intersect(setRegion(['a']), ivlRegion([[1, 2]]))).toThrow();
    expect(() => subtract(ALL, setRegion(['a']), 1)).toThrow();
    expect(subtract(setRegion(['a', 'b']), setRegion(['b']), 1)).toEqual({ r: 'set', values: ['a'] });
  });
});

describe('values and grids (spec 2.1)', () => {
  const real: DimensionDef['value'] = { t: 'real', min: 0, max: 1, quantum: 1 / 64 };
  const cyc: DimensionDef['value'] = { t: 'cyclic', period: 1, quantum: 1 / 8 };
  const vec: DimensionDef['value'] = { t: 'vec', n: 3, quantum: 1 / 16 };

  test('real values are grid points and hash as grid indices', () => {
    expect(toGridIndex(real, 0.5)).toBe(32);
    expect(bytesToHex(encodeValue(real, 0.5))).toBe(bytesToHex(i64Bytes(32)));
    expect(checkValue(real, 0.5)).toBeNull();
    expect(checkValue(real, 0.501)).toBe('not on the grid');
    expect(checkValue(real, 1.5)).toBe('outside the range');
    expect(bytesToHex(encodeValue({ t: 'int', min: 0, max: 9 }, -3))).toBe(bytesToHex(i64Bytes(-3)));
  });

  test('canonical encodings per type', () => {
    expect(new TextDecoder().decode(encodeValue({ t: 'enum', values: ['a'] }, 'a'))).toBe('a');
    const someId = H(s('x'));
    expect(bytesToHex(encodeValue({ t: 'node', kind: 'k' }, someId))).toBe(someId);
    expect(encodeValue(vec, [0, 1 / 16, 2 / 16]).length).toBe(24);
    expect(checkValue(vec, [0, 0])).toContain('3-vector');
    expect(checkValue({ t: 'int', min: 1, max: 3 }, 4)).toContain('int');
    expect(checkValue({ t: 'ref', kind: 'k', candidates: { find: 'k', scope: { nodes: [] }, must: [], max: 1 } }, 'nope')).toBe('not an Id');
  });

  test('domains, sizes and enumeration', () => {
    expect(regionSize(real, domainRegion(real))).toBe(65);
    expect(regionSize({ t: 'int', min: 16, max: 90 }, domainRegion({ t: 'int', min: 16, max: 90 }))).toBe(75);
    expect(enumerateRegion(cyc, domainRegion(cyc))).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
    expect(regionSize(cyc, domainRegion(cyc))).toBe(8);
    expect(domainRegion({ t: 'enum-by', by: 'x', lists: {} }, ['q', 'p'])).toEqual({ r: 'set', values: ['p', 'q'] });
    expect(domainRegion(vec)).toEqual(ALL);
    expect(pointRegion({ t: 'int', min: 0, max: 9 }, 4)).toEqual({ r: 'ivl', ivls: [[4, 4]] });
    expect(pointRegion({ t: 'enum', values: ['a'] }, 'a')).toEqual({ r: 'set', values: ['a'] });
    expect(pointRegion(vec, [0, 0, 0])).toEqual({ r: 'box', boxes: [[[0, 0], [0, 0], [0, 0]]] });
    expect(() => enumerateRegion(vec, ALL)).toThrow();
  });

  test('normalizeRegion snaps inward and wraps cyclic intervals', () => {
    const snapped = normalizeRegion(real, ivlRegion([[0.1, 0.2]]));
    expect(snapped.r).toBe('ivl');
    for (const [lo, hi] of (snapped as { ivls: Array<[number, number]> }).ivls) {
      expect(lo).toBeGreaterThanOrEqual(0.1);
      expect(hi).toBeLessThanOrEqual(0.2);
      expect(Math.abs(lo * 64 - Math.round(lo * 64))).toBeLessThan(1e-9);
    }
    // 0.75 .. 0.25 wraps over 1.0.
    const wrapped = normalizeRegion(cyc, { r: 'ivl', ivls: [[0.75, 0.25]] });
    expect(wrapped).toEqual({ r: 'ivl', ivls: [[0, 0.25], [0.75, 0.875]] });
  });
});

describe('registry and core functions (spec 2.1)', () => {
  const reg = coreRegistry();
  const dim = {} as DimensionDef;

  test('priors, derivations and preimages', () => {
    expect(reg.get('prior', { name: 'uniform', version: 1 })(dim, ['a', 'b'], {})).toEqual([1, 1]);
    expect(reg.get('prior', { name: 'weights', version: 1 })(dim, ['a', 'b'], { weights: { a: 3 }, default: 2 })).toEqual([3, 2]);
    expect(() => reg.get('prior', { name: 'weights', version: 1 })(dim, ['a'], { weights: { a: 0 } })).toThrow();
    expect(reg.get('derive', { name: 'floor-div', version: 1 })([37], { divisor: 10 })).toBe(3);
    expect(reg.get('derive', { name: 'concat', version: 1 })(['Alex', 'Reyes'], { sep: ' ' })).toBe('Alex Reyes');
    expect(reg.get('preimage', { name: 'floor-div', version: 1 })(ivlRegion([[3, 3]]), [], { divisor: 10 })).toEqual(ivlRegion([[30, 39]]));
    expect(reg.get('conditioned', { name: 'table', version: 1 })(['x'], ['a', 'b'], { table: { x: { a: 5 } } })).toEqual([5, 1]);
    expect(reg.get('fieldmap', { name: 'boost-value', version: 1 })(0.5, ['a', 'b'], { gain: 2, value: 'a' })).toEqual([2, 1]);
    expect(reg.get('buckets', { name: 'bucket-map', version: 1 })('drizzle', { map: { drizzle: 'rain' } })).toEqual(['rain']);
  });

  test('the first conflict table (spec 10.8)', () => {
    const t = reg.get('conflict', { name: 'first-table', version: 1 });
    for (const e of ['harm', 'kill', 'take', 'expose'] as const) expect(t('protects', e, {})).toBe('violates');
    for (const e of ['help', 'protect', 'rescue', 'give', 'meet', 'move', 'conceal'] as const) expect(t('protects', e, {})).toBe('ok');
    expect(t('wants', 'conceal', {})).toBe('violates');
    expect(t('wants', 'take', {})).toBe('violates');
    expect(t('wants', 'harm', {})).toBe('ok');
    expect(t('reactsTo', 'kill', {})).toBe('ok');
  });

  test('registering twice is refused and unknown functions throw', () => {
    expect(() => coreRegistry().register('prior', 'uniform', 1, () => [])).toThrow();
    expect(() => reg.get('prior', { name: 'nope', version: 1 })).toThrow();
    expect(reg.list().length).toBeGreaterThan(10);
  });
});

describe('schema loading (spec 2.3)', () => {
  const reg = coreRegistry();
  const uniform = { name: 'uniform', version: 1 };
  const D = (id: string, value: DimensionDef['value']): DimensionDef => ({ id, value, structure: 'none', prior: uniform });
  const base: SchemaDefs = {
    dims: [D('d:e', { t: 'enum', values: ['a', 'b'] }), D('d:n', { t: 'node', kind: 'k:leaf' }), D('d:cnt', { t: 'int', min: 0, max: 4 }), D('d:i', { t: 'int', min: 0, max: 9 })],
    kinds: [{ id: 'k:leaf', slots: [{ key: 'x', dim: 'd:e', card: 'one', mode: 'sampled', tier: 0 }] }],
    edgeTypes: [],
  };
  const withKind = (k: KindDef, extra: Partial<SchemaDefs> = {}): SchemaDefs => ({
    dims: [...base.dims, ...(extra.dims ?? [])],
    kinds: [...base.kinds, k, ...(extra.kinds ?? [])],
    edgeTypes: [],
  });
  const slot = (key: string, dim: string, over: Partial<KindDef['slots'][number]> = {}): KindDef['slots'][number] => ({ key, dim, card: 'one', mode: 'sampled', tier: 0, ...over });
  const rejects = (defs: SchemaDefs, text: string) => {
    try {
      Schema.load(defs, reg);
      throw new Error('expected a SchemaError');
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaError);
      expect((e as SchemaError).problems.join('\n')).toContain(text);
    }
  };

  test('the core schema loads clean and has the facets and slots of spec 2.6', () => {
    const schema = Schema.load(coreDefs(), reg);
    expect(schema.hasFacet('core:person', 'actor')).toBe(true);
    expect(schema.hasFacet('core:group', 'group')).toBe(true);
    expect(schema.hasFacet('core:event', 'event')).toBe(true);
    expect(schema.isKind('core:person', 'core:thing')).toBe(true);
    expect(schema.kindsOf('core:place')).toContain('core:place');
    const age = schema.slotInfo('core:person', 'age')!;
    expect(age.vt.t).toBe('int');
    const band = schema.slotInfo('core:person', 'age-band')!;
    expect(band.order).toBeGreaterThan(age.order);
    expect(schema.slotInfo('core:person', 'traits[2]')!.isNode).toBe(true);
    expect(schema.slotInfo('core:person', 'traits#count')!.isCount).toBe(true);
    expect(schema.slotInfo('core:person', 'traits')).toBeNull();
    expect(schema.slotInfo('core:person', 'age[1]')).toBeNull();
    expect(schema.slotInfo('core:person', 'nope')).toBeNull();
    expect(schema.functionVersions()).toContain('derive:floor-div@1');
    expect(parseSlotPath('traits[3]')).toEqual({ key: 'traits', index: 3, isCount: false });
    expect(parseSlotPath('Bad Path')).toBeNull();
  });

  test('merging definitions rejects duplicate ids', () => {
    expect(() => Schema.load(mergeDefs(coreDefs(), coreDefs()), reg)).toThrow(SchemaError);
  });

  test('rejects a later-slot read', () => {
    rejects(withKind({ id: 'k:a', slots: [slot('x', 'd:i', { derive: undefined, conditioned: { fn: { name: 'table', version: 1 }, inputs: ['y'] } }), slot('y', 'd:i')] }), 'not an earlier slot');
  });

  test('rejects a same-slot read', () => {
    rejects(withKind({ id: 'k:a', slots: [slot('x', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['x'] } })] }), 'not an earlier slot');
  });

  test('rejects reading the members of a many slot but allows its count', () => {
    const many = slot('m', 'd:e', { card: { many: { count: 'd:cnt' } } });
    rejects(withKind({ id: 'k:a', slots: [many, slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['m'] } })] }), 'only its count may be read');
    expect(() => Schema.load(withKind({ id: 'k:a', slots: [many, slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['m#count'] } })] }), reg)).not.toThrow();
  });

  test('rejects reading an owned value and reading a ref', () => {
    rejects(withKind({ id: 'k:a', slots: [slot('n', 'd:n'), slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['n'] } })] }), "owned values' slots");
    const refDim = D('d:ref', { t: 'ref', kind: 'k:leaf', candidates: { find: 'k:leaf', scope: { nodes: [] }, must: [], max: 3 } });
    rejects(withKind({ id: 'k:a', slots: [slot('r', 'd:ref'), slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['r'] } })] }, { dims: [refDim] }), 'refs are not resolution dependencies');
  });

  test('rejects an enum-by list longer than N_enum', () => {
    const big = D('d:big', { t: 'enum-by', by: 'x', lists: { a: Array.from({ length: 9 }, (_, n) => `v${n}`), b: ['q'] } });
    const defs = withKind({ id: 'k:a', slots: [slot('x', 'd:e'), slot('y', 'd:big')] }, { dims: [big] });
    expect(() => Schema.load(defs, reg, makeConfig({ nEnum: 8 }))).toThrow(SchemaError);
    expect(() => Schema.load(defs, reg, makeConfig({ nEnum: 9 }))).not.toThrow();
  });

  test('rejects an enum-by with a missing list, a sampled domain over N_enum, and a sampled vec', () => {
    const noList = D('d:nl', { t: 'enum-by', by: 'x', lists: { a: ['q'] } });
    rejects(withKind({ id: 'k:a', slots: [slot('x', 'd:e'), slot('y', 'd:nl')] }, { dims: [noList] }), 'no list for "b"');
    const huge = D('d:huge', { t: 'int', min: 0, max: 100000 });
    rejects(withKind({ id: 'k:a', slots: [slot('h', 'd:huge')] }, { dims: [huge] }), 'exceeds N_enum');
    expect(() => Schema.load(withKind({ id: 'k:a', slots: [slot('h', 'd:huge', { mode: 'assigned' })] }, { dims: [huge] }), reg)).not.toThrow();
    const v = D('d:vec', { t: 'vec', n: 2, quantum: 1 });
    rejects(withKind({ id: 'k:a', slots: [slot('p', 'd:vec')] }, { dims: [v] }), 'never drawn');
  });

  test('rejects an inheritance cycle, an unknown parent and an unknown function', () => {
    rejects({ ...base, kinds: [...base.kinds, { id: 'k:p', extends: ['k:q'], slots: [] }, { id: 'k:q', extends: ['k:p'], slots: [] }] }, 'inheritance cycle');
    rejects(withKind({ id: 'k:a', extends: ['k:missing'], slots: [] }), 'unknown kind k:missing');
    rejects(withKind({ id: 'k:a', slots: [slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'nope', version: 9 }, inputs: [] } })] }), 'unknown derive function');
  });

  test('rejects a preimage on a view with several inputs and a derived slot without derive', () => {
    rejects(withKind({ id: 'k:a', slots: [slot('p', 'd:i'), slot('q', 'd:i'), slot('z', 'd:i', { mode: 'derived', derive: { fn: { name: 'sum', version: 1 }, inputs: ['p', 'q'], preimage: { name: 'identity', version: 1 } } })] }), 'exactly one input');
    rejects(withKind({ id: 'k:a', slots: [slot('z', 'd:i', { mode: 'derived' })] }), 'needs derive');
  });

  test('rejects a candidate query that reads a ref slot or a temporal slot (spec 2.3)', () => {
    const refDim = (must: Array<{ path: string; op: 'field-at-least'; arg: number }>) =>
      D('d:rr', { t: 'ref', kind: 'k:leaf', candidates: { find: 'k:cand', scope: { nodes: [] }, must, max: 3 } });
    const cand = (extra: KindDef['slots']): KindDef => ({ id: 'k:cand', slots: [slot('level', 'd:i'), ...extra] });
    const ok = { dims: [...base.dims, refDim([{ path: 'level', op: 'field-at-least', arg: 1 }])], kinds: [...base.kinds, cand([])], edgeTypes: [] };
    expect(() => Schema.load(ok, reg)).not.toThrow();
    const temporal = { dims: [...base.dims, refDim([{ path: 'tmp', op: 'field-at-least', arg: 1 }])], kinds: [...base.kinds, cand([slot('tmp', 'd:i', { temporal: { window: 600 } })])], edgeTypes: [] };
    rejects(temporal, 'temporal slot');
    const viaRef = {
      dims: [...base.dims, D('d:r2', { t: 'ref', kind: 'k:leaf', candidates: { find: 'k:leaf', scope: { nodes: [] }, must: [], max: 1 } }), refDim([{ path: 'other', op: 'field-at-least', arg: 1 }])],
      kinds: [...base.kinds, cand([slot('other', 'd:r2')])], edgeTypes: [],
    };
    rejects(viaRef, 'ref slot');
  });

  test('inheritance puts inherited slots first and lets a kind override a key', () => {
    const defs = withKind({ id: 'k:child', extends: ['k:leaf'], slots: [slot('x', 'd:i'), slot('y', 'd:e')] });
    const schema = Schema.load(defs, reg);
    const k = schema.kind('k:child');
    expect(k.slots.map((x) => x.key)).toEqual(['x', 'y']);
    expect(k.slots[0]!.dim).toBe('d:i');
    expect(k.ancestors).toEqual(['k:child', 'k:leaf']);
  });

  test('validate:false installs an invalid schema (used by the cycle-guard fixture)', () => {
    const defs = withKind({ id: 'k:a', slots: [slot('x', 'd:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['x'] } })] });
    expect(() => Schema.load(defs, reg, makeConfig(), { validate: false })).not.toThrow();
  });
});

describe('work accounting (spec 10.7)', () => {
  test('the allowance throws when exhausted', () => {
    const a = new Allowance(5);
    a.spend(5);
    expect(() => a.spend(1)).toThrow(LimitExceeded);
  });

  test('a worklist stops on the budget, resumes where it stopped, and always takes its first step', () => {
    const wl = new Worklist<{ n: number; left: number }>();
    wl.push({ n: 1, left: 3 });
    wl.push({ n: 2, left: 1 });
    const step = (item: { n: number; left: number }) => {
      item.left--;
      return { cost: 10, done: item.left === 0 };
    };
    const b1 = new Budget(0);
    expect(wl.run(b1, step)).toBe(1); // the first step is always taken
    expect(wl.length).toBe(2);
    const b2 = new Budget(15);
    const steps = wl.run(b2, step);
    expect(steps).toBe(2); // 10, 10: stops once the remaining budget is spent
    expect(wl.length).toBe(1);
    wl.run(new Budget(1000), step);
    expect(wl.isEmpty).toBe(true);
  });

  test('defect log records and filters', () => {
    const d = new DefectLog();
    d.record({ kind: 'cycle', detail: 'x' });
    d.record({ kind: 'other', detail: 'y' });
    expect(d.ofKind('cycle')).toHaveLength(1);
    d.clear();
    expect(d.items).toHaveLength(0);
    expect(id(H(s('x'))).t).toBe('id');
  });
});
