// Regression tests for the findings of the independent review (SR-01 to SR-14). Each test is named with
// its finding's ID and failed before the fix.

import { describe, expect, test } from 'bun:test';
import { canonicalBytes, canonicalEqual, canonicalKey, hrec, idsIn } from '../src/canon.ts';
import { H, bytesToHex, rootId, s } from '../src/id.ts';
import { type Belief, STUB_POLICY } from '../src/beliefs.ts';
import type { Kernel } from '../src/kernel.ts';
import { newOpCtx } from '../src/resolve.ts';
import type { CandidateQuery } from '../src/schema-types.ts';
import type { Form, Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, fxSeed, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));
const INFERRED: Belief['source'] = { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] };

/** Forget a registry function, to stand in for a newer build that no longer has it. */
function removeFunction(k: Kernel, key: string): void {
  (k.registry as unknown as { fns: Map<string, unknown> }).fns.delete(key);
}

// ---------------------------------------------------------------------------------------------------

describe('SR-01 retention follows the Id fields of frame interests', () => {
  test('SR-01: nodes named only by interest selectors are retained and survive save and load', () => {
    const k = coreKernel('SR-01');
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const victim = k.mint(v, cause, 'victim', 'core:person');
    const district = k.mint(v, cause, 'district', 'core:place');
    const witness = k.mint(v, cause, 'witness', 'core:person');
    const friend = k.mint(v, cause, 'friend', 'core:person');
    const rival = k.mint(v, cause, 'rival', 'core:person');
    k.frames.open({
      actor: v, level: 'concern', origin: fid('c'), weight: 1, cause,
      own: {
        protects: [{ slot: '*', scope: { nodes: [victim] } }],
        wants: [{ slot: '*', scope: { under: district } }],
        reactsTo: [{ slot: '*', where: [{ path: '@self', op: 'in', arg: [witness] }] }],
        threatenedBy: [{ slot: '*', where: [{ path: '', op: 'has-edge', arg: { edge: 'core:knows', to: friend } }] }],
        blockedBy: [{ slot: '*', where: [{ path: '', op: 'has-edge', arg: { edge: 'core:knows', to: { kind: 'core:person', slot: '*', scope: { nodes: [rival] } } } }] }],
      },
    });
    const named = [victim, district, witness, friend, rival];
    for (const id of named) expect(k.retention.isRetained(id), id).toBe(true);
    k.persistence.save('A');
    k.persistence.load('A');
    for (const id of named) expect(k.store.header(id), id).toBeDefined();
  });

  test('SR-01: an interest naming a city through root: is expanded, and a satisfied frame no longer retains', () => {
    const k = coreKernel('SR-01b');
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const city = k.root('city', 'core:place');
    const f = k.frames.open({ actor: v, level: 'concern', origin: fid('c'), weight: 1, cause, own: { wants: [{ slot: '*', scope: { under: 'root:city' } }] } });
    expect(k.retention.isRetained(city)).toBe(true);
    k.frames.setStatus(f.id, 'satisfied', cause);
    expect(k.retention.isRetained(city)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-02 a read-only load is neither ticked nor mutated', () => {
  const defs = defsOf(
    [dim('fx:n', { t: 'int', min: 0, max: 100 })],
    [kind('fx:c', [slot('n', 'fx:n', { mode: 'assigned', temporal: { window: 600 } })])],
  );

  test('SR-02: tick refuses, and the cursor and outstanding batches are left alone', () => {
    const k = fxKernel('SR-02', defs);
    const node = k.root('c', 'fx:c');
    k.pin({ node, slot: 'n@w0', value: 1, reason: 'authored', cause });
    k.evolution.register({ id: 'slow', tier: 0, period: 3, run: (_c, w) => [{ op: 'pin', node, slot: `n@w${w + 1}`, value: 10 + w }] });
    k.tick({ to: 600 });
    const rec = k.persistence.save('mid');
    rec.meta.versions.push('derive:vanished@3');
    const report = k.persistence.load('mid');
    expect(report.readOnly).toBe(true);
    const cursor = k.evolution.cursor;
    const outstanding = JSON.stringify(k.evolution.stateOf('slow').outstanding);
    expect(outstanding).not.toBe('[]');
    expect(() => k.tick({ to: 5000 })).toThrow(/read-only/);
    expect(() => k.settle({ to: 5000 })).toThrow(/read-only/);
    expect(k.evolution.cursor).toBe(cursor);
    expect(JSON.stringify(k.evolution.stateOf('slow').outstanding)).toBe(outstanding);
    expect(k.defects.ofKind('op-refused')).toHaveLength(0);
    // A new load clears the restriction, and the batch still applies at its boundary.
    rec.meta.versions.pop();
    expect(k.persistence.load('mid').readOnly).toBe(false);
    k.tick({ to: 2400 });
    expect(k.value(node, 'n', 600)).toBe(10);
  });

  test('SR-02: every public write is refused while read-only, and queued operations are not accepted', () => {
    const w = coreKernel('SR-02b');
    const a = w.root('a', 'core:person');
    const b = w.root('b', 'core:person');
    const edge = w.addEdge({ type: 'core:knows', from: a, to: b, cause });
    const contribution = w.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'age', scope: { nodes: [a] } }, form: { f: 'const', value: 30 }, mode: 'constrain' });
    const pin = w.pin({ node: a, slot: 'age', value: 31, reason: 'committed', cause });
    const rec = w.persistence.save('A');
    rec.meta.versions.push('derive:vanished@3');
    expect(w.persistence.load('A').readOnly).toBe(true);
    const revision = w.revision;
    expect(() => w.endEdge(edge.id)).toThrow(/read-only/);
    expect(() => w.updateEdge(edge.id, { data: { x: 1 } })).toThrow(/read-only/);
    expect(() => w.endContribution(contribution.id)).toThrow(/read-only/);
    expect(() => w.withdrawPin(pin.id, cause)).toThrow(/read-only/);
    expect(() => w.mint(a, cause, 'x', 'core:person')).toThrow(/read-only/);
    expect(() => w.events.mintEvent({ creator: a, cause, name: 'e', time: 1, kind: 'sale' })).toThrow(/read-only/);
    expect(() => w.beliefs.set({ believer: a, subject: b, path: 'age', value: 40, confidence: 1, evidence: [], source: INFERRED, formed: 0, refreshed: 0, memorable: true })).toThrow(/read-only/);
    expect(() => w.frames.open({ actor: a, level: 'concern', origin: fid('x'), weight: 1, cause })).toThrow(/read-only/);
    expect(() => w.retention.setSeed({ id: fid('seed'), state: null, nodes: [] })).toThrow(/read-only/);
    expect(() => w.persistence.save('B')).toThrow(/read-only/);
    expect(w.submit({ epoch: w.epoch, stamp: 5, op: { op: 'pin', spec: { node: a, slot: 'age', value: 20, reason: 'authored', cause } } })).toMatchObject({ accepted: false });
    expect(w.evolution.queued).toHaveLength(0);
    expect(w.revision).toBe(revision);
    // Reads keep working.
    expect(w.value(a, 'age')).toBe(30);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-03 belief work does not survive a replacement load', () => {
  test('SR-03: queued belief ticks of a discarded branch never run', () => {
    const k = coreKernel('SR-03');
    const a = k.root('a', 'core:person');
    const b = k.root('b', 'core:person');
    k.persistence.save('A');
    for (const who of [a, b]) {
      k.beliefs.set({ believer: who, subject: a, path: 'age', value: 30, confidence: 1, evidence: [], source: INFERRED, formed: 0, refreshed: 0, memorable: false });
    }
    const called: Id[] = [];
    k.beliefs.policy = { ...STUB_POLICY, onTick: (_k, who) => { called.push(who); } };
    k.tick({ to: 600, budget: 1 });
    expect(k.beliefs.pendingTicks).toBeGreaterThan(0);
    const before = called.length;
    k.persistence.load('A');
    expect(k.beliefs.pendingTicks).toBe(0);
    k.tick({ to: 1800 });
    expect(called).toHaveLength(before);
    k.beliefs.policy = STUB_POLICY;
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-04 generated identities do not depend on object construction order', () => {
  test('SR-04: canonical bytes sort keys, fix numbers and keep array order', () => {
    expect(canonicalKey({ b: 1, a: [2, { y: 1, x: 2 }] })).toBe(canonicalKey({ a: [2, { x: 2, y: 1 }], b: 1 }));
    expect(canonicalKey({ a: 1, b: undefined })).toBe(canonicalKey({ a: 1 }));
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
    // One numeric representation: an integer-valued number is an integer however it was written.
    expect(canonicalKey({ n: 2 })).toBe(canonicalKey({ n: 4 / 2 }));
    expect(canonicalKey(-0)).toBe(canonicalKey(0));
    expect(canonicalKey(0.5)).not.toBe(canonicalKey(1));
    expect(bytesToHex(canonicalBytes(1))).toBe('030100000000000000');
    expect(bytesToHex(canonicalBytes(0.5))).toBe('04000000000000e03f');
    expect(bytesToHex(canonicalBytes('é'))).toBe('0502000000c3a9');
    expect(bytesToHex(canonicalBytes({ b: true, a: null }))).toBe('0702000000' + '0100000061' + '00' + '0100000062' + '02');
    // A key's position follows the bytes of its UTF-8 (U+FB00 is ef ac 80, U+1F600 is f0 9f 98 80), not its UTF-16 units.
    expect(bytesToHex(canonicalBytes({ '\u{1F600}': 1, 'ﬀ': 2 }))).toBe(
      '0702000000' + '03000000' + 'efac80' + '030200000000000000' + '04000000' + 'f09f9880' + '030100000000000000',
    );
    expect(() => canonicalBytes({ a: Number.NaN })).toThrow();
    expect(() => canonicalBytes({ a: Infinity })).toThrow();
    expect(() => canonicalBytes({ a: () => 1 })).toThrow();
    expect(() => canonicalBytes(new Map())).toThrow();
    expect(canonicalEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(hrec({ x: 1 })).toEqual(hrec({ x: 1 }));
    expect(idsIn({ a: [fid('a'), 'x'], b: { c: fid('b') }, [fid('key')]: 1, d: 'root:city' }, () => fid('city'))).toEqual([fid('a'), fid('b'), fid('city')]);
  });

  const defs = defsOf(
    [dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })],
    [kind('fx:t', [slot('x', 'fx:abc')])],
  );

  test('SR-04: a contribution has one Id however its target, form and validity were written', () => {
    const k = fxKernel('SR-04', defs);
    const n = k.root('n', 'fx:t');
    const one = k.contribute({ source: { layer: 'authored', origin: 'o' }, target: { slot: 'x', scope: { nodes: [n] } }, form: { f: 'const', value: 'a' }, mode: 'constrain', valid: { from: 0, to: 9 } });
    const two = k.contribute({ source: { layer: 'authored', origin: 'o' }, target: { scope: { nodes: [n] }, slot: 'x' }, form: { value: 'a', f: 'const' }, mode: 'constrain', valid: { to: 9, from: 0 } });
    expect(two.id).toBe(one.id);
    expect(k.store.allContributions()).toHaveLength(1);
  });

  test('SR-04: reordering the keys of a form does not change which constraint wins', () => {
    for (const name of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) {
      const build = (reorder: boolean) => {
        const k = fxKernel(`SR-04-${name}`, defs);
        const n = k.root('n', 'fx:t');
        const target = { slot: 'x', scope: { nodes: [n] } };
        k.contribute({ source: { layer: 'authored', origin: 'one' }, target, form: reorder ? { value: 'a', f: 'const' } : { f: 'const', value: 'a' }, mode: 'constrain' });
        k.contribute({ source: { layer: 'authored', origin: 'two' }, target, form: { f: 'const', value: 'b' }, mode: 'constrain' });
        return { ids: k.store.allContributions().map((c) => c.id), value: k.resolve(n, 'x'), trace: k.trace(n, 'x').constraints.map((c) => c.id) };
      };
      expect(build(true)).toEqual(build(false));
    }
  });

  test('SR-04: pin regions, edge attributes, frame payloads and belief sources are identified canonically', () => {
    const k = coreKernel('SR-04c');
    const a = k.root('a', 'core:person');
    const b = k.root('b', 'core:group');
    const p1 = k.pin({ node: a, slot: 'age', region: { r: 'ivl', ivls: [[20, 30]] }, reason: 'authored', cause });
    const p2 = k.pin({ node: a, slot: 'age', region: JSON.parse('{"ivls":[[20,30]],"r":"ivl"}'), reason: 'authored', cause });
    expect(p2.id).toBe(p1.id);
    const e1 = k.addEdge({ type: 'core:member-of', from: a, to: b, attrs: { role: 'member', strength: 0.5 }, cause });
    const e2 = k.addEdge({ type: 'core:member-of', from: a, to: b, attrs: { strength: 0.5, role: 'member' }, cause });
    expect(e2.id).toBe(e1.id);
    const f1 = k.frames.open({ actor: a, level: 'goal', origin: fid('o'), weight: 1, payload: { goal: { effects: [{ on: b, effect: 'help' }] }, drive: 'honour' }, cause });
    const f2 = k.frames.open({ actor: a, level: 'goal', origin: fid('o'), weight: 1, payload: { drive: 'honour', goal: { effects: [{ effect: 'help', on: b }] } }, cause });
    expect(f2.id).toBe(f1.id);
    const beliefId = (source: Belief['source']): Id => {
      const w = coreKernel('SR-04d');
      const x = w.root('a', 'core:person');
      w.beliefs.set({ believer: x, subject: x, path: 'age', value: 30, confidence: 1, evidence: [], formed: 3, refreshed: 3, memorable: false, source });
      return w.beliefs.get(x, x, 'age')!.id;
    };
    expect(beliefId({ from: [], rule: { version: 1, name: 'r' }, by: 'inferred' })).toBe(beliefId({ by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }));
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-05 caches replay dependency height as well as cost', () => {
  test('SR-05: a candidate set computed elsewhere does not let a ref beat the depth limit', () => {
    const cq: CandidateQuery = { find: 'fx:chain', scope: { nodes: ['root:chainA'] }, must: [{ path: 'd', op: 'eq', arg: 1 }], max: 4 };
    const deriveFrom = (input: string) => ({ fn: { name: 'identity', version: 1 }, inputs: [input] });
    const defs = defsOf(
      [dim('fx:n', { t: 'int', min: 0, max: 3 }), dim('fx:chain-ref', { t: 'ref', kind: 'fx:chain', candidates: cq })],
      [
        kind('fx:chain', [
          slot('a', 'fx:n', { mode: 'assigned' }),
          slot('b', 'fx:n', { mode: 'derived', derive: deriveFrom('a') }),
          slot('c', 'fx:n', { mode: 'derived', derive: deriveFrom('b') }),
          slot('d', 'fx:n', { mode: 'derived', derive: deriveFrom('c') }),
        ]),
        kind('fx:holder', [slot('r', 'fx:chain-ref')]),
      ],
    );
    const k = fxKernel('SR-05', defs, { maxDepth: 4 });
    const chain = k.root('chainA', 'fx:chain');
    const holder = k.root('holder', 'fx:holder');
    k.pin({ node: chain, slot: 'a', value: 1, reason: 'authored', cause });
    const revision = k.revision;
    const cold = k.resolve(holder, 'r');
    expect(cold.status).toBe('failed');
    // Warm the candidate set independently, from the top level where the chain fits.
    expect(k.queries.candidateSet(newOpCtx(k.config.allowance), cq, k.now)).toEqual([chain]);
    expect(k.revision).toBe(revision);
    expect(k.resolve(holder, 'r')).toEqual(cold);
  });

  test('SR-05: a descriptor computed elsewhere does not let an item beat the depth limit', () => {
    const k = coreKernel('SR-05b', undefined, { maxDepth: 1 });
    const city = k.root('city', 'core:place');
    const S = k.summaries.mintSummary({ creator: city, cause, name: 's', kind: 'robbery', from: 0, length: 1000, scope: city, count: 3 });
    const item = k.summaries.materialise(S, 0);
    const cold = k.resolve(item, 'time');
    expect(cold.status).toBe('failed');
    const revision = k.revision;
    expect(k.summaries.descriptor(newOpCtx(k.config.allowance), S, 0, k.now)).toBeDefined();
    expect(k.revision).toBe(revision);
    expect(k.resolve(item, 'time')).toEqual(cold);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-06 a nested failure fails the outer operation', () => {
  const defs = defsOf(
    [
      dim('fx:target-ref', { t: 'ref', kind: 'fx:target', candidates: { find: 'fx:target', scope: { nodes: ['root:t1', 'root:t2', 'root:t3'] }, must: [], max: 8 } }),
      dim('fx:abc', { t: 'enum', values: ['a', 'b'] }),
    ],
    [kind('fx:target', []), kind('fx:holder', [slot('r', 'fx:target-ref'), slot('flag', 'fx:abc', { mode: 'assigned' })])],
  );

  test('SR-06: a query that requires a ref which failed is failed, not an empty success', () => {
    const k = fxKernel('SR-06', defs, { nEnum: 2 });
    const t1 = k.root('t1', 'fx:target');
    k.root('t2', 'fx:target');
    k.root('t3', 'fx:target');
    const holder = k.root('holder', 'fx:holder');
    expect(k.resolve(holder, 'r').status).toBe('failed');
    const out = k.query({ find: 'fx:holder', scope: { nodes: [holder] }, at: 0, must: [{ path: 'r', op: 'in', arg: [t1] }], limit: 'all' });
    expect(out.status).toBe('failed');
    // An ordinary unavailable value is still just a predicate that does not hold.
    const plain = k.query({ find: 'fx:holder', scope: { nodes: [holder] }, at: 0, must: [{ path: 'flag', op: 'eq', arg: 'a' }], limit: 'all' });
    expect(plain).toEqual({ status: 'ok', items: [] });
  });

  test('SR-06: a rule whose condition read a failed slot fails the resolution it belongs to', () => {
    const k = fxKernel('SR-06b', defsOf(
      [dim('fx:ten', { t: 'int', min: 0, max: 9 }), dim('fx:abc', { t: 'enum', values: ['a', 'b'] })],
      [kind('fx:holder', [slot('big', 'fx:ten'), slot('x', 'fx:abc')])],
    ), { nEnum: 2 }, { validate: false }); // (the loader would refuse a sampled domain over N_enum; a schema built under a larger limit reaches the failure at run time)
    const holder = k.root('holder', 'fx:holder');
    expect(k.resolve(holder, 'big').status).toBe('failed');
    k.contribute({
      source: { layer: 'authored', origin: 'o' }, target: { slot: 'x', scope: { nodes: [holder] } }, mode: 'constrain',
      form: { f: 'rule', when: [{ path: 'big', op: 'field-at-least', arg: 0 }], then: { f: 'const', value: 'a' } },
    });
    expect(k.resolve(holder, 'x').status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-07 compatibility covers the functions persisted records use', () => {
  const defs = defsOf(
    [dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] }), dim('fx:pos', { t: 'vec', n: 2, quantum: 1 / 4 })],
    [kind('fx:agent', [slot('pos', 'fx:pos', { mode: 'assigned' }), slot('kinda', 'fx:abc'), slot('other', 'fx:abc')])],
  );
  const field: Extract<Form, { f: 'field' }> = {
    f: 'field', base: 'pos', combine: 'sum', map: { name: 'boost-value', version: 1, params: { value: 'a', gain: 2 } },
    points: [{ at: [0, 0], value: 1, radius: 4, falloff: 'linear' }],
  };

  test('SR-07: a persisted field contribution names its field map, and losing it loads read-only', () => {
    const k = fxKernel('SR-07', defs);
    const n = k.root('n', 'fx:agent');
    k.pin({ node: n, slot: 'pos', value: [0, 0], reason: 'authored', cause });
    k.contribute({ source: { layer: 'authored', origin: 'o' }, target: { slot: 'kinda', scope: { nodes: [n] } }, form: field, mode: 'weight' });
    const rec = k.persistence.save('A');
    expect(rec.meta.versions).toContain('fieldmap:boost-value@1');
    removeFunction(k, 'fieldmap:boost-value@1');
    const report = k.persistence.load('A');
    expect(report.readOnly).toBe(true);
    expect(report.message).toContain('fieldmap:boost-value@1');
  });

  test('SR-07: nested forms count, and so do the forms of outstanding process batches and the conflict table', () => {
    const k = fxKernel('SR-07b', defs);
    const n = k.root('n', 'fx:agent');
    k.contribute({
      source: { layer: 'authored', origin: 'o' }, target: { slot: 'other', scope: { nodes: [n] } }, mode: 'constrain',
      form: { f: 'rule', when: [], then: { f: 'derive', fn: { name: 'identity', version: 1 }, inputs: ['kinda'] } },
    });
    k.evolution.register({
      id: 'maker', tier: 0, period: 4,
      run: () => [{ op: 'contribute', target: { slot: 'kinda', scope: { nodes: [n] } }, mode: 'weight', form: { f: 'rule', when: [], then: { ...field, map: { name: 'gradient', version: 1 } } } }],
    });
    k.tick({ to: 600 });
    const rec = k.persistence.save('A');
    expect(rec.meta.versions).toContain('derive:identity@1');
    expect(rec.meta.versions).toContain('fieldmap:gradient@1');
    expect(rec.meta.versions).toContain('conflict:first-table@1');
    removeFunction(k, 'fieldmap:gradient@1');
    expect(k.persistence.load('A').readOnly).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-08 matching evaluates the change\'s own values', () => {
  const defs = defsOf(
    [
      dim('fx:wx', { t: 'enum', values: ['clear', 'rain', 'fog'] }, { buckets: { name: 'bucket-map', version: 1, params: { map: { rain: 'wet', fog: 'wet', clear: 'dry' } } } }),
    ],
    [
      kind('fx:weather', [slot('weather', 'fx:wx')], { extends: ['core:thing'] }),
      kind('fx:sensor', [slot('weather', 'fx:wx', { mode: 'mirrored' })], { extends: ['core:thing'] }),
    ],
  );
  const LOW = '00000000000000000000000000000001';
  const HIGH = 'ffffffffffffffffffffffffffffff01';

  function watcher(name: string, selector: { slot: string; where: Array<{ path: string; op: 'eq' | 'in'; arg: string | string[] }> }) {
    const k = coreKernel(name, defs);
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const w = k.root('w', 'fx:weather');
    const sensor = k.mirrored('sensor', 'fx:sensor');
    k.frames.open({ actor: v, level: 'concern', origin: fid('watch'), weight: 1, cause, own: { reactsTo: [{ kind: 'core:thing', ...selector }] } });
    k.settle();
    k.dispatcher.drain();
    return { k, v, w, sensor };
  }

  test('SR-08: queued pins are each matched against their own new value', () => {
    const { k, v, w } = watcher('SR-08', { slot: 'weather', where: [{ path: 'weather', op: 'eq', arg: 'rain' }] });
    k.now = 100;
    k.pin({ node: w, slot: 'weather', value: 'rain', reason: 'authored', cause, id: HIGH });
    k.now = 200;
    k.pin({ node: w, slot: 'weather', value: 'clear', reason: 'authored', cause, id: LOW });
    // The world's value is clear (the lower Id wins the tie), so a matcher reading the world sees neither change as rain.
    expect(k.value(w, 'weather', 100)).toBe('clear');
    k.tick({ to: 600 });
    const out = k.dispatcher.drain().filter((r) => r.actor === v);
    expect(out).toHaveLength(1);
    expect(out[0]!.change).toMatchObject({ c: 'pin', new: 'rain' });
  });

  test('SR-08: a withdrawal is matched against the value it removed, and a bucket predicate follows the same rule', () => {
    const { k, v, w } = watcher('SR-08b', { slot: 'weather', where: [{ path: 'weather:bucket', op: 'in', arg: ['wet'] }] });
    const rain = k.pin({ node: w, slot: 'weather', value: 'rain', reason: 'committed', cause, id: HIGH });
    k.pin({ node: w, slot: 'weather', value: 'clear', reason: 'authored', cause: H(s('other')), id: LOW });
    k.withdrawPin(rain.id, cause);
    expect(k.value(w, 'weather')).toBe('clear');
    k.settle();
    const out = k.dispatcher.drain().filter((r) => r.actor === v);
    expect(out.map((r) => (r.change.c === 'pin' ? r.change.reason : r.change.c))).toEqual(['committed', 'withdrawn']);
  });

  test('SR-08: queued readings are matched against their own values at the change\'s time', () => {
    const { k, v, sensor } = watcher('SR-08c', { slot: 'weather', where: [{ path: 'weather', op: 'eq', arg: 'rain' }] });
    k.reading(sensor, 'weather', 'rain', 100);
    k.reading(sensor, 'weather', 'clear', 200);
    k.tick({ to: 600 });
    const out = k.dispatcher.drain().filter((r) => r.actor === v);
    expect(out).toHaveLength(1);
    expect(out[0]!.change).toMatchObject({ c: 'reading', new: 'rain' });
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-09 belief hooks run for every processed boundary', () => {
  function believers(name: string) {
    const k = coreKernel(name);
    const a = k.root('a', 'core:person');
    const b = k.root('b', 'core:person');
    for (const who of [a, b]) {
      k.beliefs.set({ believer: who, subject: a, path: 'age', value: 30, confidence: 1, evidence: [], source: INFERRED, formed: 0, refreshed: 0, memorable: false });
    }
    const calls: Array<[Id, number]> = [];
    k.beliefs.policy = { ...STUB_POLICY, onTick: (_k, who, at) => { calls.push([who, at]); } };
    return { k, calls, ids: [a, b].sort() };
  }

  test('SR-09: four boundaries in one tick call the hook as many times as four ticks do, in boundary order', () => {
    const one = believers('SR-09');
    one.k.tick({ to: 1800 });
    expect(one.calls).toEqual([0, 600, 1200, 1800].flatMap((at) => one.ids.map((id): [Id, number] => [id, at])));
    const many = believers('SR-09');
    for (const to of [0, 600, 1200, 1800]) many.k.tick({ to });
    expect(many.calls).toEqual(one.calls);
    // A small budget only slows it down.
    const slow = believers('SR-09');
    let r = slow.k.tick({ to: 1800, budget: 1 });
    for (let n = 0; n < 100 && !r.done; n++) r = slow.k.tick({ to: 1800, budget: 1 });
    expect(slow.calls).toEqual(one.calls);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-10 a change of interests rechecks the actor\'s existing goals', () => {
  function crew(name: string) {
    const k = coreKernel(name);
    const G = k.root('G', 'core:group');
    const L = k.root('L', 'core:person');
    const M = k.root('M', 'core:person');
    const X = k.root('X', 'core:person');
    k.addEdge({ type: 'core:member-of', from: L, to: G, attrs: { role: 'leader', strength: 1 }, cause });
    k.addEdge({ type: 'core:member-of', from: M, to: G, attrs: { role: 'member', strength: 0.75 }, cause });
    return { k, G, L, M, X };
  }

  test('SR-10: adding protects X to a concern after a kill-X goal exists emits the dilemma', () => {
    const { k, M, X } = crew('SR-10');
    const goal = k.frames.open({ actor: M, level: 'goal', origin: fid('g'), weight: 1, payload: { goal: { effects: [{ on: X, effect: 'kill' }] } }, cause });
    const concern = k.frames.open({ actor: M, level: 'concern', origin: fid('c'), weight: 1, cause });
    k.settle();
    expect(k.frames.drainDilemmas()).toHaveLength(0);
    k.frames.setInterests(concern.id, { protects: [{ slot: '*', scope: { nodes: [X] } }] }, cause);
    k.settle();
    const ds = k.frames.drainDilemmas();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ actor: M, frameA: goal.id, frameB: concern.id, target: X, effect: 'kill' });
  });

  test('SR-10: opening a frame with interests, or returning one to the interest set, rechecks too', () => {
    const { k, M, X } = crew('SR-10b');
    const goal = k.frames.open({ actor: M, level: 'goal', origin: fid('g'), weight: 1, payload: { goal: { effects: [{ on: X, effect: 'harm' }] } }, cause });
    k.settle();
    const protector = k.frames.open({ actor: M, level: 'concern', origin: fid('c'), weight: 1, own: { protects: [{ slot: '*', scope: { nodes: [X] } }] }, cause });
    k.settle();
    expect(k.frames.drainDilemmas().map((d) => [d.frameA, d.frameB])).toEqual([[goal.id, protector.id]]);
    // Abandoned frames drop out of the interest set; returning to it is a change of interests.
    k.frames.setStatus(protector.id, 'abandoned', cause);
    k.settle();
    expect(k.frames.drainDilemmas()).toHaveLength(0);
    k.frames.setStatus(protector.id, 'active', cause);
    k.settle();
    expect(k.frames.drainDilemmas().map((d) => [d.frameA, d.frameB])).toEqual([[goal.id, protector.id]]);
  });

  test('SR-10: an inherited interest counts: a group decision that adds protects X rechecks its members\' goals', () => {
    const { k, G, L, M, X } = crew('SR-10c');
    const concern = k.groups.decide(L, G, { op: 'open', spec: { level: 'concern', origin: fid('G-honour'), payload: { drive: 'honour' }, weight: 0.9 } });
    const drive = k.frames.open({ actor: M, level: 'drive', origin: fid('M-honour'), payload: { drive: 'honour' }, weight: 0.5, cause });
    const goal = k.frames.open({ actor: M, level: 'goal', origin: fid('M-goal'), weight: 1, payload: { goal: { effects: [{ on: X, effect: 'kill' }] } }, cause });
    k.settle();
    expect(k.frames.frame(drive.id)!.parents.map((p) => p.frame)).toEqual([concern.id]);
    expect(k.frames.drainDilemmas()).toHaveLength(0);
    k.groups.decide(L, G, { op: 'interests', frame: concern.id, own: { protects: [{ slot: '*', scope: { nodes: [X] } }] } });
    k.settle();
    const ds = k.frames.drainDilemmas();
    expect(ds.map((d) => [d.actor, d.frameA, d.frameB])).toEqual([[M, goal.id, drive.id]]);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-11 membership inheritance follows membership validity', () => {
  function world(name: string, valid: { from?: number; to?: number }) {
    const k = coreKernel(name);
    const G = k.root('G', 'core:group');
    const L = k.root('L', 'core:person');
    const M = k.root('M', 'core:person');
    const N = k.root('N', 'core:person');
    k.addEdge({ type: 'core:member-of', from: L, to: G, attrs: { role: 'leader', strength: 1 }, cause });
    k.addEdge({ type: 'core:member-of', from: M, to: G, attrs: { role: 'member', strength: 0.75 }, valid, cause });
    const concern = k.groups.decide(L, G, {
      op: 'open',
      spec: { level: 'concern', origin: fid('G-honour'), payload: { drive: 'honour' }, weight: 0.9, own: { wants: [{ slot: '*', scope: { nodes: [N] } }] } },
    });
    const drive = k.frames.open({ actor: M, level: 'drive', origin: fid('M-honour'), payload: { drive: 'honour' }, weight: 0.5, cause });
    k.settle();
    k.dispatcher.drain();
    return { k, G, L, M, N, concern, drive };
  }
  const state = (w: ReturnType<typeof world>) => ({ parents: w.k.frames.frame(w.drive.id)!.parents, pull: w.k.frames.pull(w.drive.id), cached: w.k.frames.cachedPull.get(w.drive.id) });

  test('SR-11: after a membership expires its inherited parent, pull and delivered interests go', () => {
    const w = world('SR-11', { to: 600 });
    expect(state(w).parents).toEqual([{ frame: w.concern.id, weight: 0.75, via: 'membership' }]);
    expect(state(w).pull).toBeCloseTo(0.5 * 0.75 * 0.9, 12);
    w.k.tick({ to: 1200 });
    expect(w.k.groups.memberships(w.M)).toHaveLength(0);
    expect(state(w)).toEqual({ parents: [], pull: 0.5, cached: 0.5 });
    // Nothing inherited reaches M any more: a change M's frame would only have heard of through the group.
    w.k.pin({ node: w.N, slot: 'age', value: 40, reason: 'authored', cause });
    w.k.settle();
    const out = w.k.dispatcher.drain();
    expect(out.filter((r) => r.actor === w.M)).toHaveLength(0);
    expect(out.filter((r) => r.actor === w.G)).toHaveLength(1);
  });

  test('SR-11: while the membership is in force the member does hear of it (the control)', () => {
    const w = world('SR-11c', { to: 600 });
    w.k.pin({ node: w.N, slot: 'age', value: 40, reason: 'authored', cause });
    w.k.settle();
    expect(w.k.dispatcher.drain().filter((r) => r.actor === w.M)).toHaveLength(1);
  });

  test('SR-11: crossings are partition independent, and a membership that starts later inherits when time reaches it', () => {
    const one = world('SR-11p', { from: 1000, to: 2500 });
    expect(state(one).parents).toEqual([]);
    const many = world('SR-11p', { from: 1000, to: 2500 });
    one.k.tick({ to: 1200 });
    for (const to of [300, 600, 900, 1200]) many.k.tick({ to });
    expect(state(one).parents).toEqual([{ frame: one.concern.id, weight: 0.75, via: 'membership' }]);
    expect(state(many)).toEqual(state(one));
    one.k.tick({ to: 3000 });
    for (const to of [1800, 2400, 3000]) many.k.tick({ to });
    expect(state(one)).toEqual({ parents: [], pull: 0.5, cached: 0.5 });
    expect(state(many)).toEqual(state(one));
  });

  test('SR-11: an expiry that falls between boundaries is seen when the advance ends', () => {
    const w = world('SR-11d', { to: 650 });
    w.k.tick({ to: 700 });
    expect(state(w).parents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-12 retention caches depend on time', () => {
  const defs = defsOf(
    [dim('fx:cnt', { t: 'int', min: 0, max: 30 }), dim('fx:lvl', { t: 'int', min: 0, max: 9 }), dim('fx:member', { t: 'node', kind: 'fx:mem' })],
    [
      kind('fx:mem', [slot('lvl', 'fx:lvl', { mode: 'assigned', temporal: { window: 600 } })], { extends: ['core:thing'] }),
      kind('fx:crowd', [slot('members', 'fx:member', { card: { many: { count: 'fx:cnt' } } })], { extends: ['core:thing'] }),
    ],
  );

  test('SR-12: a member held only by an expired temporal pin is released, with no write in between', () => {
    const k = coreKernel('SR-12', defs);
    const c = k.root('crowd', 'fx:crowd');
    const m5 = k.address(c, 'members[5]');
    k.pin({ node: m5, slot: 'lvl@w0', value: 1, reason: 'authored', cause });
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { slot: 'members#count', scope: { nodes: [c] } }, form: { f: 'const', value: 3 }, mode: 'constrain' });
    expect(k.retention.isRetained(m5)).toBe(true);
    expect(k.retention.maxRetainedMember(c, 'members')).toBe(5);
    expect(k.value(c, 'members#count', 0) as number).toBeGreaterThanOrEqual(6);
    const revision = k.revision;
    k.tick({ to: 1200 });
    expect(k.revision).toBe(revision);
    expect(k.retention.isRetained(m5)).toBe(false);
    expect(k.retention.maxRetainedMember(c, 'members')).toBeUndefined();
    expect(k.value(c, 'members#count', 0)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR-13 summary places exclude the scope before the cut', () => {
  test('SR-13: with a cap of one and the scope sorting first, the descendant is still found', () => {
    const seed = fxSeed('SR-13');
    let cityName = '';
    let placeName = '';
    for (let n = 0; n < 1000 && cityName === ''; n++) {
      if (rootId(seed, `city${n}`) < rootId(seed, `place${n}`)) {
        cityName = `city${n}`;
        placeName = `place${n}`;
      }
    }
    expect(cityName).not.toBe('');
    const k = coreKernel('SR-13', undefined, { summaryPlaceMax: 1 });
    const city = k.root(cityName, 'core:place');
    const place = k.root(placeName, 'core:place');
    k.addEdge({ type: 'core:located-in', from: place, to: city, cause });
    expect(city < place).toBe(true);
    const S = k.summaries.mintSummary({ creator: city, cause, name: 's', kind: 'robbery', from: 0, length: 1000, scope: city, count: 3 });
    for (let i = 0; i < 3; i++) {
      expect(k.resolve(k.summaries.materialise(S, i), 'place')).toEqual({ value: place, status: 'ok' });
    }
    const out = k.query({ find: 'core:event', scope: { under: city }, at: 500, must: [], limit: 'all' });
    expect(out.status === 'ok' && out.items.length).toBe(3);
  });
});
