import { describe, expect, test } from 'bun:test';
import { H, id, rand, s, i, val } from '../src/id.ts';
import { ln } from '../src/fdlibm-log.ts';
import { encodeValue } from '../src/value.ts';
import { ivlRegion, setRegion } from '../src/region.ts';
import type { Contribution, Id } from '../src/types.ts';
import type { Kernel } from '../src/kernel.ts';
import { coreKernel, defsOf, dim, fxKernel, fxSeed, kind, slot } from './helpers.ts';

const lo = (n: number): Id => n.toString(16).padStart(32, '0');
const hi = (n: number): Id => 'f'.repeat(32 - n.toString(16).length) + n.toString(16);
const cause = H(s('test-cause'));

function setContribution(k: Kernel, node: Id, slotName: string, layer: Contribution['source']['layer'], values: string[], forceId?: Id) {
  const spec: Parameters<Kernel['contribute']>[0] = {
    source: { layer, origin: cause },
    target: { slot: slotName, scope: { nodes: [node] } },
    form: { f: 'set', region: setRegion(values), allow: true },
    mode: 'constrain',
  };
  if (forceId) spec.id = forceId;
  return k.contribute(spec);
}

const abcd = defsOf(
  [dim('fx:abcd', { t: 'enum', values: ['a', 'b', 'c', 'd'] })],
  [kind('fx:t', [slot('x', 'fx:abcd')])],
);

describe('F-1 arbitration (spec 5.2)', () => {
  test('F-1: precedence order decides which constraints are active', () => {
    const k = fxKernel('F-1', abcd);
    const n = k.root('n', 'fx:t');
    k.pin({ node: n, slot: 'x', region: setRegion(['a', 'b']), reason: 'observed', cause });
    setContribution(k, n, 'x', 'authored', ['b', 'c']);
    setContribution(k, n, 'x', 'seeding', ['c']);
    setContribution(k, n, 'x', 'simulation', ['a', 'b', 'c', 'd']);
    const tr = k.trace(n, 'x');
    const state = Object.fromEntries(tr.constraints.map((c) => [c.precedence, c.active]));
    expect(state).toEqual({ 600: true, 400: true, 300: false, 200: true });
    expect(tr.feasible).toEqual({ r: 'set', values: ['b'] });
    expect(tr.value).toBe('b');
    expect(tr.status).toBe('ok');
    expect(k.resolve(n, 'x')).toEqual({ value: 'b', status: 'ok' });
  });

  test('F-2: a second observation, rejected, makes the status a contradiction', () => {
    const k = fxKernel('F-2', abcd);
    const n = k.root('n', 'fx:t');
    k.pin({ node: n, slot: 'x', region: setRegion(['a', 'b']), reason: 'observed', cause, id: lo(1) });
    k.pin({ node: n, slot: 'x', region: setRegion(['c']), reason: 'observed', cause, id: hi(1) });
    setContribution(k, n, 'x', 'authored', ['b', 'c']);
    setContribution(k, n, 'x', 'seeding', ['c']);
    setContribution(k, n, 'x', 'simulation', ['a', 'b', 'c', 'd']);
    const tr = k.trace(n, 'x');
    const second = tr.constraints.find((c) => c.id === hi(1))!;
    expect(second.active).toBe(false);
    expect(tr.constraints.find((c) => c.id === lo(1))!.active).toBe(true);
    expect(tr.feasible).toEqual({ r: 'set', values: ['b'] });
    expect(k.resolve(n, 'x')).toEqual({ value: 'b', status: 'contradiction' });
  });

  test('lower Id first within a precedence level, whatever the order of writing', () => {
    const k = fxKernel('order', abcd);
    const n = k.root('n', 'fx:t');
    k.pin({ node: n, slot: 'x', value: 'c', reason: 'authored', cause, id: hi(2) });
    k.pin({ node: n, slot: 'x', value: 'd', reason: 'authored', cause, id: lo(2) });
    expect(k.resolve(n, 'x')).toEqual({ value: 'd', status: 'ok' });
  });

  test('a rejected constraint below 600 is not a contradiction', () => {
    const k = fxKernel('below600', abcd);
    const n = k.root('n', 'fx:t');
    k.pin({ node: n, slot: 'x', value: 'a', reason: 'game', cause });
    k.pin({ node: n, slot: 'x', value: 'b', reason: 'authored', cause });
    expect(k.resolve(n, 'x')).toEqual({ value: 'a', status: 'ok' });
  });

  test('a withdrawn pin no longer constrains; observed pins cannot be withdrawn; only the creator withdraws', () => {
    const k = fxKernel('withdraw', abcd);
    const n = k.root('n', 'fx:t');
    const who = H(s('process'));
    const p = k.pin({ node: n, slot: 'x', value: 'c', reason: 'committed', cause: who });
    expect(k.value(n, 'x')).toBe('c');
    expect(() => k.withdrawPin(p.id, cause)).toThrow();
    expect(k.withdrawPin(p.id, who)).toBe(true);
    expect(k.withdrawPin(p.id, who)).toBe(false);
    const free = k.value(n, 'x');
    expect(['a', 'b', 'c', 'd']).toContain(free as string);
    const o = k.pin({ node: n, slot: 'x', value: 'a', reason: 'observed', cause: who });
    expect(() => k.withdrawPin(o.id, who)).toThrow();
  });

  test('pin values are validated against the slot', () => {
    const k = fxKernel('validate', abcd);
    const n = k.root('n', 'fx:t');
    expect(() => k.pin({ node: n, slot: 'x', value: 'zzz', reason: 'authored', cause })).toThrow();
    expect(() => k.pin({ node: n, slot: 'nope', value: 'a', reason: 'authored', cause })).toThrow();
    expect(() => k.pin({ node: n, slot: 'x', reason: 'authored', cause })).toThrow();
    expect(() => k.pin({ node: n, slot: 'x', value: 'a', region: setRegion(['a']), reason: 'authored', cause })).toThrow();
  });
});

describe('F-3 timeline of readings (spec 6.3)', () => {
  const defs = defsOf(
    [dim('fx:wx', { t: 'enum', values: ['clear', 'rain', 'fog'] })],
    [kind('fx:weather', [slot('weather', 'fx:wx', { mode: 'mirrored' })])],
  );

  test('F-3: consecutive observed intervals, no contradiction', () => {
    const k = fxKernel('F-3', defs);
    const w = k.mirrored('weather/city', 'fx:weather');
    k.reading(w, 'weather', 'rain', 1000);
    const o1 = k.observeReading(w, 'weather', 1000, cause)!;
    k.reading(w, 'weather', 'clear', 2000);
    const o2 = k.observeReading(w, 'weather', 2000, cause)!;
    expect(k.resolve(w, 'weather', 1500)).toEqual({ value: 'rain', status: 'ok' });
    expect(k.resolve(w, 'weather', 2500)).toEqual({ value: 'clear', status: 'ok' });
    expect(k.resolve(w, 'weather', 999)).toEqual({ status: 'unavailable' });
    expect(k.store.pin(o1.id)!.valid).toEqual({ from: 1000, to: 2000 });
    expect(k.store.pin(o2.id)!.valid).toEqual({ from: 2000 });
    expect(k.store.pinsOn(w, 'weather').filter((p) => p.reason === 'observed')).toHaveLength(2);
  });

  test('a reading inserted out of order cuts the earlier reading and the observation over it', () => {
    const k = fxKernel('F-3b', defs);
    const w = k.mirrored('weather/city', 'fx:weather');
    k.reading(w, 'weather', 'rain', 1000);
    const o = k.observeReading(w, 'weather', 1000, cause)!;
    k.reading(w, 'weather', 'fog', 3000);
    expect(k.store.pin(o.id)!.valid.to).toBe(3000);
    k.reading(w, 'weather', 'clear', 2000);
    expect(k.store.pin(o.id)!.valid.to).toBe(2000);
    expect(k.value(w, 'weather', 2500)).toBe('clear');
    expect(k.value(w, 'weather', 3500)).toBe('fog');
  });

  test('equal timestamps: the last by Id wins', () => {
    const k = fxKernel('F-3c', defs);
    const w = k.mirrored('weather/city', 'fx:weather');
    const a = k.reading(w, 'weather', 'rain', 1000);
    const b = k.reading(w, 'weather', 'fog', 1000);
    const winner = a.id > b.id ? 'rain' : 'fog';
    expect(k.value(w, 'weather', 1500)).toBe(winner);
  });

  test('an observation that disagrees with the reading in effect is a contradiction', () => {
    const k = fxKernel('F-3d', defs);
    const w = k.mirrored('weather/city', 'fx:weather');
    k.reading(w, 'weather', 'rain', 1000);
    k.pin({ node: w, slot: 'weather', value: 'fog', reason: 'observed', valid: { from: 1000 }, cause });
    expect(k.resolve(w, 'weather', 1200)).toEqual({ value: 'rain', status: 'contradiction' });
  });

  test('only a mirrored node has readings', () => {
    const k = fxKernel('F-3e', defs);
    const n = k.root('w', 'fx:weather');
    expect(() => k.reading(n, 'weather', 'rain', 1)).toThrow();
    const noReading = k.resolve(n, 'weather');
    expect(['clear', 'rain', 'fog']).toContain(noReading.value as string);
  });
});

describe('F-4 unary view (spec 6.4)', () => {
  test('F-4: a pin on age-band narrows age through the preimage; a later authored age is rejected', () => {
    const k = coreKernel('F-4');
    const p = k.root('p', 'core:person');
    k.pin({ node: p, slot: 'age-band', value: 3, reason: 'observed', cause });
    const tr = k.trace(p, 'age');
    expect(tr.feasible).toEqual({ r: 'ivl', ivls: [[30, 39]] });
    const age = k.value(p, 'age') as number;
    expect(age).toBeGreaterThanOrEqual(30);
    expect(age).toBeLessThanOrEqual(39);
    expect(k.resolve(p, 'age-band')).toEqual({ value: 3, status: 'ok' });
    const authored = k.pin({ node: p, slot: 'age', value: 45, reason: 'authored', cause });
    const tr2 = k.trace(p, 'age');
    expect(tr2.constraints.find((c) => c.id === authored.id)!.active).toBe(false);
    expect(tr2.status).toBe('ok');
    expect(k.resolve(p, 'age-band')).toEqual({ value: 3, status: 'ok' });
  });

  test('a violated observed pin on age is a contradiction that the view inherits (I-5)', () => {
    const k = coreKernel('F-4b');
    const p = k.root('p', 'core:person');
    k.pin({ node: p, slot: 'age-band', value: 3, reason: 'observed', cause, id: lo(1) });
    k.pin({ node: p, slot: 'age', value: 61, reason: 'observed', cause, id: hi(1) });
    expect(k.resolve(p, 'age').status).toBe('contradiction');
    const band = k.resolve(p, 'age-band');
    expect(band.value).toBe(3);
    expect(band.status).toBe('contradiction');
  });

  test('a pin on a view without a preimage is checked, at any precedence (SPEC-NOTES 7)', () => {
    const k = coreKernel('derive-check');
    const nm = k.address(k.root('p', 'core:person'), 'name');
    k.pin({ node: nm, slot: 'origin', value: 'western', reason: 'authored', cause });
    k.pin({ node: nm, slot: 'given', value: 'Alex', reason: 'authored', cause });
    k.pin({ node: nm, slot: 'family', value: 'Reyes', reason: 'authored', cause });
    expect(k.resolve(nm, 'display')).toEqual({ value: 'Alex Reyes', status: 'ok' });
    k.pin({ node: nm, slot: 'display', value: 'Someone Else', reason: 'committed', cause });
    expect(k.resolve(nm, 'display')).toEqual({ value: 'Alex Reyes', status: 'contradiction' });
  });
});

describe('F-5 coupling (spec 5.4, I-7)', () => {
  const values100 = Array.from({ length: 100 }, (_, n) => `v${String(n).padStart(2, '0')}`);
  const mk = (priorWeight: number) => {
    const prior = priorWeight === 1 ? { name: 'uniform', version: 1 } : { name: 'weights', version: 1, params: { default: priorWeight } };
    return defsOf([dim('fx:v100', { t: 'enum', values: values100 }, { prior })], [kind('fx:big', [slot('x', 'fx:v100')])]);
  };

  test('F-5: a table factor changes a result only when the boosted value becomes the winner', () => {
    const k = fxKernel('F-5', mk(1));
    const nodes: Id[] = [];
    for (let n = 0; n < 1000; n++) nodes.push(k.root(`n${n}`, 'fx:big'));
    const before = nodes.map((n) => k.value(n, 'x') as string);
    const traceBefore = k.trace(nodes[0]!, 'x');
    expect(traceBefore.scores).toHaveLength(100);
    k.contribute({
      source: { layer: 'authored', origin: cause }, target: { kind: 'fx:big', slot: 'x' },
      form: { f: 'table', weights: { v00: 4 } }, mode: 'weight',
    });
    let boosted = 0;
    nodes.forEach((n, idx) => {
      const tr = k.trace(n, 'x');
      const after = tr.value as string;
      const a = tr.scores.find((sc) => sc.value === 'v00')!;
      const others = tr.scores.filter((sc) => sc.value !== 'v00');
      // The updated score of v00 is 0 (its factor is the maximum); the others carry ln(1/4).
      expect(a.score).toBe(0);
      for (const o of others) expect(o.score).toBe(ln(0.25));
      const bestOther = others.reduce((m, o) => (o.total > m.total ? o : m));
      const aBeats = a.total > bestOther.total || (a.total === bestOther.total && false);
      if (aBeats) {
        expect(after).toBe('v00');
        boosted++;
      } else {
        expect(after).toBe(before[idx]!);
      }
      expect(k.value(n, 'x')).toBe(after);
    });
    expect(boosted).toBeGreaterThan(0);
    expect(boosted).toBeLessThan(1000);
  });

  test('F-5: multiplying every factor by 3 leaves every result unchanged', () => {
    const table1: Record<string, number> = {};
    const table3: Record<string, number> = {};
    for (const v of values100) {
      table1[v] = v === 'v00' ? 4 : 1;
      table3[v] = (v === 'v00' ? 4 : 1) * 3;
    }
    const run = (priorWeight: number, table: Record<string, number>) => {
      const k = fxKernel('F-5', mk(priorWeight));
      k.contribute({
        source: { layer: 'authored', origin: cause }, target: { kind: 'fx:big', slot: 'x' }, form: { f: 'table', weights: table }, mode: 'weight',
      });
      const out: string[] = [];
      for (let n = 0; n < 200; n++) out.push(k.value(k.root(`n${n}`, 'fx:big'), 'x') as string);
      return out;
    };
    expect(run(3, table3)).toEqual(run(1, table1));
  });

  test('the noise is the specified Gumbel of the specified hash', () => {
    const k = fxKernel('noise', mk(1));
    const n = k.root('n', 'fx:big');
    const tr = k.trace(n, 'x');
    const seed = fxSeed('noise');
    const vt = k.schema.dim('fx:v100').value;
    const sc = tr.scores[7]!;
    const u = rand(s('g'), id(seed), id(n), s('x'), i(0), val(encodeValue(vt, sc.value)));
    expect(sc.noise).toBe(-ln(-ln(u)));
    expect(Math.abs(sc.noise - -Math.log(-Math.log(u)))).toBeLessThan(1e-12);
    const best = tr.scores.reduce((m, o) => (o.total > m.total ? o : m));
    expect(tr.winner).toBe(best);
    expect(tr.value).toBe(best.value);
  });
});

describe('F-15 cycle guard (spec 2.3)', () => {
  test('F-15: a slot reading itself through a schema the loader missed returns cycle and records a defect', () => {
    const defs = defsOf(
      [dim('fx:n', { t: 'int', min: 0, max: 9 })],
      [kind('fx:loop', [
        slot('x', 'fx:n', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['y'] } }),
        slot('y', 'fx:n', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: ['x'] } }),
      ])],
    );
    const k = fxKernel('F-15', defs, undefined, { validate: false });
    // The loader rejects this schema; bypass it, as the fixture says.
    expect(() => fxKernel('F-15', defs)).toThrow();
    const n = k.root('n', 'fx:loop');
    const r = k.resolve(n, 'x');
    expect(r.status).toBe('cycle');
    expect(k.defects.ofKind('cycle').length).toBeGreaterThan(0);
  });
});
