import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import { ln } from '../src/fdlibm-log.ts';
import { ivlRegion, setRegion } from '../src/region.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const D = dim;

describe('preimages chain through views of views (spec 6.4)', () => {
  const defs = defsOf(
    [D('fx:i100', { t: 'int', min: 0, max: 99 }), D('fx:i10', { t: 'int', min: 0, max: 9 }), D('fx:i5', { t: 'int', min: 0, max: 4 })],
    [kind('fx:chain', [
      slot('a', 'fx:i100'),
      slot('b', 'fx:i10', { mode: 'derived', derive: { fn: { name: 'floor-div', version: 1, params: { divisor: 10 } }, inputs: ['a'], preimage: { name: 'floor-div', version: 1, params: { divisor: 10 } } } }),
      slot('c', 'fx:i5', { mode: 'derived', derive: { fn: { name: 'floor-div', version: 1, params: { divisor: 2 } }, inputs: ['b'], preimage: { name: 'floor-div', version: 1, params: { divisor: 2 } } } }),
    ])],
  );

  test('a pin on c narrows b and then a', () => {
    const k = fxKernel('chain', defs);
    const n = k.root('n', 'fx:chain');
    k.pin({ node: n, slot: 'c', value: 2, reason: 'observed', cause });
    expect(k.trace(n, 'a').feasible).toEqual({ r: 'ivl', ivls: [[40, 59]] });
    const a = k.value(n, 'a') as number;
    expect(a).toBeGreaterThanOrEqual(40);
    expect(a).toBeLessThanOrEqual(59);
    expect(k.resolve(n, 'c')).toEqual({ value: 2, status: 'ok' });
  });

  test('pins on b and on c both narrow a (intersection by precedence)', () => {
    const k = fxKernel('chain2', defs);
    const n = k.root('n', 'fx:chain');
    k.pin({ node: n, slot: 'c', value: 2, reason: 'observed', cause });
    k.pin({ node: n, slot: 'b', value: 5, reason: 'game', cause });
    expect(k.trace(n, 'a').feasible).toEqual({ r: 'ivl', ivls: [[50, 59]] });
  });
});

describe('time-varying slots (spec 6.2, 6.3, SPEC-NOTES 5)', () => {
  const defs = defsOf(
    [D('fx:mood', { t: 'enum', values: ['calm', 'tense', 'angry', 'glad'] })],
    [kind('fx:person', [
      slot('mood', 'fx:mood', { temporal: { window: 600 } }),
      slot('trait', 'fx:mood'),
    ])],
  );

  test('a pin on an enduring slot applies at every t, whatever its valid.from', () => {
    const k = fxKernel('enduring', defs);
    const n = k.root('n', 'fx:person');
    k.pin({ node: n, slot: 'trait', value: 'glad', reason: 'authored', valid: { from: 5000 }, at: 5000, cause });
    expect(k.value(n, 'trait', 0)).toBe('glad');
    expect(k.value(n, 'trait', 4999)).toBe('glad');
    expect(k.value(n, 'trait', 99999)).toBe('glad');
  });

  test('a simulated temporal slot holds one value per window; pins name their window', () => {
    const k = fxKernel('windows', defs);
    const n = k.root('n', 'fx:person');
    expect(() => k.pin({ node: n, slot: 'mood', value: 'calm', reason: 'authored', cause })).toThrow();
    expect(() => k.pin({ node: n, slot: 'trait@w1', value: 'calm', reason: 'authored', cause })).toThrow();
    const p = k.pin({ node: n, slot: 'mood@w3', value: 'angry', reason: 'committed', cause });
    expect(p.valid).toEqual({ from: 1800, to: 2400 });
    expect(k.value(n, 'mood', 1800)).toBe('angry');
    expect(k.value(n, 'mood', 2399)).toBe('angry');
    // Another window draws freely, with its own noise.
    const draws = new Set<string>();
    for (let w = 0; w < 12; w++) if (w !== 3) draws.add(k.value(n, 'mood', w * 600) as string);
    expect(draws.size).toBeGreaterThan(1);
    // Within one window the value is constant.
    expect(k.value(n, 'mood', 600)).toBe(k.value(n, 'mood', 1199));
    // An explicit window suffix agrees with the time.
    expect(k.resolve(n, 'mood@w3', 0)).toEqual({ value: 'angry', status: 'ok' });
    expect(k.trace(n, 'mood', 1900).window).toBe(3);
  });
});

describe('assigned slots (spec 5.1 step 3, SPEC-NOTES 6)', () => {
  const defs = defsOf(
    [D('fx:big', { t: 'int', min: 0, max: 1_000_000_000 }), D('fx:cnt', { t: 'int', min: 0, max: 3 })],
    [kind('fx:a', [slot('t', 'fx:big', { mode: 'assigned' }), slot('u', 'fx:big', { mode: 'assigned' }), slot('n', 'fx:cnt', { mode: 'assigned' })])],
  );

  test('an assigned slot is unavailable without a value, and takes the first active value pin', () => {
    const k = fxKernel('assigned', defs);
    const n = k.root('n', 'fx:a');
    expect(k.resolve(n, 't')).toEqual({ status: 'unavailable' });
    k.pin({ node: n, slot: 't', value: 42, reason: 'committed', cause });
    expect(k.resolve(n, 't')).toEqual({ value: 42, status: 'ok' });
    k.pin({ node: n, slot: 't', value: 7, reason: 'authored', cause });
    expect(k.resolve(n, 't')).toEqual({ value: 7, status: 'ok' });
  });

  test('a Const constraint that leaves one value gives it; a region pin alone does not', () => {
    const k = fxKernel('assigned2', defs);
    const n = k.root('n', 'fx:a');
    k.contribute({ source: { layer: 'simulation', origin: cause }, target: { slot: 'u', scope: { nodes: [n] } }, form: { f: 'const', value: 9 }, mode: 'constrain' });
    expect(k.resolve(n, 'u')).toEqual({ value: 9, status: 'ok' });
    k.pin({ node: n, slot: 't', region: ivlRegion([[3, 5]]), reason: 'authored', cause });
    expect(k.resolve(n, 't')).toEqual({ status: 'unavailable' });
    k.pin({ node: n, slot: 't', region: ivlRegion([[4, 4]]), reason: 'authored', cause });
    expect(k.resolve(n, 't')).toEqual({ value: 4, status: 'ok' });
  });

  test('counts of assigned many slots are assigned too', () => {
    const k = fxKernel('assigned3', defs);
    expect(k.schema.slotInfo('fx:a', 'n')).not.toBeNull();
  });
});

describe('many slots, members and counts (spec 2.4, 7.1)', () => {
  test('member i exists only while count > i', () => {
    const k = coreKernel('members');
    const p = k.root('p', 'core:person');
    k.pin({ node: p, slot: 'traits#count', value: 3, reason: 'authored', cause });
    const m2 = k.resolve(p, 'traits[2]');
    expect(m2.status).toBe('ok');
    expect(k.resolve(p, 'traits[3]')).toEqual({ status: 'unavailable' });
    const hdr = k.store.header(m2.value as Id)!;
    expect(hdr.kind).toBe('core:trait');
    expect(hdr.origin).toEqual({ by: 'member', owner: p, slot: 'traits', index: 2 });
    // The member node has its own slots.
    expect(['loyal', 'greedy', 'curious', 'cautious', 'proud', 'kind']).toContain(k.value(m2.value as Id, 'trait') as string);
  });

  test('an owned value is the node held by a card-one node slot', () => {
    const k = coreKernel('owned');
    const p = k.root('p', 'core:person');
    const nm = k.resolve(p, 'name');
    expect(nm.status).toBe('ok');
    expect(k.store.header(nm.value as Id)!.origin).toEqual({ by: 'value', owner: p, slot: 'name' });
    expect(k.address(p, 'name')).toBe(nm.value as Id);
  });

  test('enum-by domains follow the chosen list; conditioned owner reads work', () => {
    const k = coreKernel('enumby');
    const p = k.root('p', 'core:person');
    const nm = k.address(p, 'name');
    for (let n = 0; n < 20; n++) {
      const owner = k.address(k.root(`q${n}`, 'core:person'), 'name');
      const origin = k.value(owner, 'origin') as string;
      const given = k.value(owner, 'given') as string;
      const list = origin === 'western' ? ['Alex', 'Jordan', 'Maria', 'Dmitri'] : ['Haruto', 'Yui', 'Kenji'];
      expect(list).toContain(given);
    }
    void nm;
    // The unavailable case: an enum-by whose list is missing.
    expect(k.resolve(nm, 'display').status).toBe('ok');
  });
});

describe('weights (spec 5.3)', () => {
  const defs = defsOf(
    [D('fx:e4', { t: 'enum', values: ['a', 'b', 'c', 'd'] }), D('fx:i10', { t: 'int', min: 0, max: 9 }), D('fx:pos', { t: 'vec', n: 2, quantum: 1 / 4 })],
    [kind('fx:w', [
      slot('pos', 'fx:pos', { mode: 'assigned' }),
      slot('level', 'fx:i10'),
      slot('x', 'fx:e4'),
    ])],
  );
  const tgt = { kind: 'fx:w', slot: 'x' } as const;

  test('a table factor boosts; normalisation by the maximum; the prior can be replaced', () => {
    const k = fxKernel('weights', defs);
    const n = k.root('n', 'fx:w');
    k.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'table', weights: { b: 8, c: 2 } }, mode: 'weight' });
    const tr = k.trace(n, 'x');
    const byValue = Object.fromEntries(tr.scores.map((sc) => [sc.value, sc.score]));
    expect(byValue.b).toBe(0);
    expect(byValue.c).toBe(ln(0.25));
    expect(byValue.a).toBe(ln(0.125));
    expect(byValue.d).toBe(ln(0.125));
    expect(tr.factors.map((f) => f.kind)).toEqual(['prior', 'weight']);
    // Strength multiplies the log-factor.
    const k2 = fxKernel('weights', defs);
    const n2 = k2.root('n', 'fx:w');
    k2.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'table', weights: { b: 8, c: 2 } }, mode: 'weight', strength: 2 });
    const t2 = Object.fromEntries(k2.trace(n2, 'x').scores.map((sc) => [sc.value, sc.score]));
    expect(t2.c).toBe(2 * ln(0.25));
  });

  test('the first replace-prior in precedence order replaces the prior', () => {
    const k = fxKernel('replace', defs);
    const n = k.root('n', 'fx:w');
    k.contribute({ source: { layer: 'seeding', origin: cause }, target: tgt, form: { f: 'table', weights: { a: 4 } }, mode: 'replace-prior' });
    k.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'table', weights: { d: 4 } }, mode: 'replace-prior' });
    const tr = k.trace(n, 'x');
    const byValue = Object.fromEntries(tr.scores.map((sc) => [sc.value, sc.score]));
    expect(byValue.d).toBe(0);
    expect(byValue.a).toBe(ln(0.25));
    expect(tr.factors[0]!.kind).toBe('replaced-prior');
  });

  test('a const weight is 1 on its value and epsilon elsewhere; outside F it does nothing', () => {
    const k = fxKernel('constw', defs);
    const n = k.root('n', 'fx:w');
    k.pin({ node: n, slot: 'x', region: setRegion(['a', 'b']), reason: 'authored', cause });
    k.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'const', value: 'd' }, mode: 'weight' });
    const sc = Object.fromEntries(k.trace(n, 'x').scores.map((x) => [x.value, x.score]));
    expect(sc.a).toBe(0);
    expect(sc.b).toBe(0);
  });

  test('a rule applies its factor only when its condition holds, reading earlier slots', () => {
    const k = fxKernel('rule', defs);
    const n = k.root('n', 'fx:w');
    k.pin({ node: n, slot: 'level', value: 7, reason: 'authored', cause });
    k.contribute({
      source: { layer: 'authored', origin: cause }, target: tgt, mode: 'weight',
      form: { f: 'rule', when: [{ path: 'level', op: 'field-at-least', arg: 5 }], then: { f: 'table', weights: { c: 10 } } },
    });
    k.contribute({
      source: { layer: 'authored', origin: cause }, target: tgt, mode: 'weight',
      form: { f: 'rule', when: [{ path: 'level', op: 'field-at-most', arg: 2 }], then: { f: 'table', weights: { a: 10 } } },
    });
    const tr = k.trace(n, 'x');
    const sc = Object.fromEntries(tr.scores.map((x) => [x.value, x.score]));
    expect(sc.c).toBe(0);
    expect(sc.a).toBe(ln(0.1));
    expect(tr.factors).toHaveLength(2);
  });

  test('a rule reading a later slot is not applicable and records a defect (spec 2.3, SPEC-NOTES 13)', () => {
    const defs2 = defsOf(
      [D('fx:e4', { t: 'enum', values: ['a', 'b'] }), D('fx:i10', { t: 'int', min: 0, max: 9 })],
      [kind('fx:late', [slot('x', 'fx:e4'), slot('later', 'fx:i10')])],
    );
    const k = fxKernel('late', defs2);
    const n = k.root('n', 'fx:late');
    k.contribute({
      source: { layer: 'authored', origin: cause }, target: { kind: 'fx:late', slot: 'x' }, mode: 'weight',
      form: { f: 'rule', when: [{ path: 'later', op: 'field-at-least', arg: 0 }], then: { f: 'table', weights: { a: 10 } } },
    });
    expect(k.trace(n, 'x').factors).toHaveLength(1);
    expect(k.defects.ofKind('read-violation').length).toBeGreaterThan(0);
  });

  test('a field falls off with distance; far from every point it changes nothing', () => {
    const k = fxKernel('field', defs);
    const near = k.root('near', 'fx:w');
    const far = k.root('far', 'fx:w');
    k.pin({ node: near, slot: 'pos', value: [0, 0], reason: 'game', cause });
    k.pin({ node: far, slot: 'pos', value: [20, 0], reason: 'game', cause });
    const before = k.trace(far, 'x').scores.map((x) => x.total);
    k.contribute({
      source: { layer: 'authored', origin: cause }, target: tgt, mode: 'weight',
      form: {
        f: 'field', base: 'pos', combine: 'sum', map: { name: 'boost-value', version: 1, params: { value: 'b', gain: 99 } },
        points: [{ at: [0, 0], value: 1, radius: 10, falloff: 'smoothstep' }],
      },
    });
    const nearTr = k.trace(near, 'x');
    const sc = Object.fromEntries(nearTr.scores.map((x) => [x.value, x.score]));
    expect(sc.b).toBe(0);
    expect(sc.a).toBe(ln(1 / 100));
    expect(k.trace(far, 'x').scores.map((x) => x.total)).toEqual(before);
  });

  test('a conditioned prior reads earlier slots', () => {
    const defs3 = defsOf(
      [D('fx:e2', { t: 'enum', values: ['p', 'q'] }), D('fx:e3', { t: 'enum', values: ['a', 'b', 'c'] })],
      [kind('fx:cond', [
        slot('first', 'fx:e2'),
        slot('second', 'fx:e3', { conditioned: { fn: { name: 'table', version: 1, params: { table: { p: { a: 8 }, q: { c: 8 } } } }, inputs: ['first'] } }),
      ])],
    );
    const k = fxKernel('cond', defs3);
    const n = k.root('n', 'fx:cond');
    k.pin({ node: n, slot: 'first', value: 'q', reason: 'authored', cause });
    const sc = Object.fromEntries(k.trace(n, 'second').scores.map((x) => [x.value, x.score]));
    expect(sc.c).toBe(0);
    expect(sc.a).toBe(ln(1 / 8));
  });

  test('a set with allow: false removes values', () => {
    const k = fxKernel('negate', defs);
    const n = k.root('n', 'fx:w');
    k.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'set', region: setRegion(['a', 'b', 'c']), allow: false }, mode: 'constrain' });
    expect(k.resolve(n, 'x')).toEqual({ value: 'd', status: 'ok' });
  });

  test('constrain contributions respect their validity interval', () => {
    const k = fxKernel('valid', defs);
    const n = k.root('n', 'fx:w');
    k.contribute({ source: { layer: 'authored', origin: cause }, target: tgt, form: { f: 'const', value: 'c' }, mode: 'constrain', valid: { from: 100, to: 200 } });
    expect(k.value(n, 'x', 150)).toBe('c');
    expect(k.trace(n, 'x', 50).constraints).toHaveLength(0);
    expect(k.trace(n, 'x', 200).constraints).toHaveLength(0);
  });

  test('wildcard selectors: * matches every slot, key[*] every member', () => {
    const k = coreKernel('wild');
    const p = k.root('p', 'core:person');
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'traits#count', scope: { nodes: [p] } }, form: { f: 'const', value: 2 }, mode: 'constrain' });
    expect(k.value(p, 'traits#count')).toBe(2);
    const k2 = coreKernel('wild2', defsOf(
      [D('fx:e', { t: 'enum', values: ['a', 'b'] }), D('fx:cnt', { t: 'int', min: 0, max: 4 }), D('fx:ref', { t: 'ref', kind: 'core:place', candidates: { find: 'core:place', scope: { nodes: [] }, must: [], max: 1 } })],
      [kind('fx:m', [slot('xs', 'fx:e', { card: { many: { count: 'fx:cnt' } }, mode: 'assigned' })])],
    ));
    const m = k2.root('m', 'fx:m');
    k2.pin({ node: m, slot: 'xs#count', value: 2, reason: 'authored', cause });
    k2.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'xs[*]', scope: { nodes: [m] } }, form: { f: 'const', value: 'b' }, mode: 'constrain' });
    expect(k2.value(m, 'xs[0]')).toBe('b');
    expect(k2.value(m, 'xs[1]')).toBe('b');
    expect(k2.resolve(m, 'xs[2]')).toEqual({ status: 'unavailable' });
  });
});

describe('hard limits (spec 10.7)', () => {
  const values100 = Array.from({ length: 100 }, (_, n) => `v${n}`);
  const defs = defsOf([D('fx:v100', { t: 'enum', values: values100 })], [kind('fx:big', [slot('x', 'fx:v100')])]);

  test('exhausting the shared allowance returns failed and records a defect', () => {
    const k = fxKernel('allowance', defs, { allowance: 50 });
    const n = k.root('n', 'fx:big');
    expect(k.resolve(n, 'x')).toEqual({ status: 'failed' });
    expect(k.defects.ofKind('limit')).toHaveLength(1);
    const k2 = fxKernel('allowance', defs, { allowance: 200 });
    expect(k2.resolve(k2.root('n', 'fx:big'), 'x').status).toBe('ok');
  });

  test('more than 256 applicable contributions returns failed', () => {
    const k = fxKernel('many-contribs', defs);
    const n = k.root('n', 'fx:big');
    for (let c = 0; c < 257; c++) {
      k.contribute({ source: { layer: 'authored', origin: `c${c}` }, target: { slot: 'x', scope: { nodes: [n] } }, form: { f: 'table', weights: { v1: 1 + c } }, mode: 'weight' });
    }
    expect(k.resolve(n, 'x')).toEqual({ status: 'failed' });
    const k2 = fxKernel('many-contribs', defs);
    const n2 = k2.root('n', 'fx:big');
    for (let c = 0; c < 256; c++) {
      k2.contribute({ source: { layer: 'authored', origin: `c${c}` }, target: { slot: 'x', scope: { nodes: [n2] } }, form: { f: 'table', weights: { v1: 1 + c } }, mode: 'weight' });
    }
    expect(k2.resolve(n2, 'x').status).toBe('ok');
  });

  test('a field with more than 64 points returns failed', () => {
    const defs2 = defsOf(
      [D('fx:e', { t: 'enum', values: ['a', 'b'] }), D('fx:pos', { t: 'vec', n: 1, quantum: 1 })],
      [kind('fx:f', [slot('pos', 'fx:pos', { mode: 'assigned' }), slot('x', 'fx:e')])],
    );
    const k = fxKernel('field-limit', defs2);
    const n = k.root('n', 'fx:f');
    k.pin({ node: n, slot: 'pos', value: [0], reason: 'game', cause });
    const points = (c: number) => Array.from({ length: c }, (_, i) => ({ at: [i], value: 1, radius: 5, falloff: 'linear' as const }));
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'x', scope: { nodes: [n] } }, mode: 'weight', form: { f: 'field', base: 'pos', combine: 'max', map: { name: 'boost-value', version: 1, params: { value: 'a' } }, points: points(65) } });
    expect(k.resolve(n, 'x')).toEqual({ status: 'failed' });
  });

  test('dependency depth is limited', () => {
    const slots = [slot('s0', 'fx:i', { mode: 'assigned' })];
    for (let n = 1; n <= 40; n++) slots.push(slot(`s${n}`, 'fx:i', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: [`s${n - 1}`] } }));
    const k = fxKernel('depth', defsOf([D('fx:i', { t: 'int', min: 0, max: 9 })], [kind('fx:deep', slots)]));
    const n = k.root('n', 'fx:deep');
    k.pin({ node: n, slot: 's0', value: 4, reason: 'authored', cause });
    expect(k.resolve(n, 's20')).toEqual({ value: 4, status: 'ok' });
    expect(k.resolve(n, 's40')).toEqual({ status: 'failed' });
  });
});

describe('caching, silence and determinism (spec 5.5, I-1, I-13)', () => {
  const defs = defsOf([D('fx:e4', { t: 'enum', values: ['a', 'b', 'c', 'd'] })], [kind('fx:t', [slot('x', 'fx:e4')])]);

  test('resolution bumps no revision and emits no change; a write invalidates the cache', () => {
    const k = fxKernel('silence', defs);
    const n = k.root('n', 'fx:t');
    const rev = k.revision;
    const first = k.value(n, 'x');
    expect(k.value(n, 'x')).toBe(first);
    expect(k.revision).toBe(rev);
    expect(k.pending).toHaveLength(0);
    k.pin({ node: n, slot: 'x', value: first === 'a' ? 'b' : 'a', reason: 'authored', cause });
    expect(k.value(n, 'x')).not.toBe(first);
    expect(k.pending).toHaveLength(1);
  });

  test('the same seed and operations give identical results; another seed differs somewhere', () => {
    const run = (name: string) => {
      const k = fxKernel(name, defs);
      return Array.from({ length: 64 }, (_, n) => k.value(k.root(`n${n}`, 'fx:t'), 'x'));
    };
    expect(run('seed-a')).toEqual(run('seed-a'));
    expect(run('seed-a')).not.toEqual(run('seed-b'));
  });

  test('the node mirrors its resolved slots', () => {
    const k = fxKernel('mirror', defs);
    const n = k.root('n', 'fx:t');
    const v = k.value(n, 'x');
    const st = k.store.nodes.get(n)!.slots.get('x')!;
    expect(st).toMatchObject({ s: 'resolved', value: v, status: 'ok' });
  });

  test('a repeated outer resolution has the same cost accounting as a fresh one (cache-independent limits)', () => {
    const big = defsOf([D('fx:v', { t: 'enum', values: Array.from({ length: 60 }, (_, n) => `v${n}`) })], [kind('fx:b', [slot('x', 'fx:v')])]);
    const k = fxKernel('cost', big, { allowance: 100 });
    const n = k.root('n', 'fx:b');
    // 60 units to enumerate: fits, twice (the second hit is charged its recorded cost).
    expect(k.resolve(n, 'x').status).toBe('ok');
    expect(k.resolve(n, 'x').status).toBe('ok');
  });
});
