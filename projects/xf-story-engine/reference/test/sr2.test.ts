// Regression tests for the findings of the second independent review (SR2-01 to SR2-08). Each test is
// named with its finding's ID and failed before the fix. SR2-08 (the digest) is tested in digest.test.ts.

import { describe, expect, test } from 'bun:test';
import { STUB_POLICY, type Belief } from '../src/beliefs.ts';
import { coreDefs, mergeDefs } from '../src/core-schema.ts';
import { H, s } from '../src/id.ts';
import { Kernel } from '../src/kernel.ts';
import type { GamePort, Pack } from '../src/persistence.ts';
import { coreRegistry } from '../src/registry.ts';
import type { Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, fxSeed, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));
const INFERRED: Belief['source'] = { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] };

/** A memorable belief, so the believer survives a save and a load and is due its tick hooks. */
function believe(k: Kernel, who: Id): void {
  k.beliefs.set({ believer: who, subject: who, path: 'age', value: 30, confidence: 1, evidence: [], source: INFERRED, formed: 0, refreshed: 0, memorable: true });
}

// ---------------------------------------------------------------------------------------------------

describe('SR2-01 a resumed tick keeps the phase order', () => {
  /** A group whose two members' memberships both expire at 600, each member with a drive that inherits the group's concern. */
  function expiring(name: string) {
    const k = coreKernel(name);
    const G = k.root('G', 'core:group');
    const L = k.root('L', 'core:person');
    k.addEdge({ type: 'core:member-of', from: L, to: G, attrs: { role: 'leader', strength: 1 }, cause });
    const concern = k.groups.decide(L, G, { op: 'open', spec: { level: 'concern', origin: fid('G-honour'), payload: { drive: 'honour' }, weight: 0.9 } });
    const drives = ['M1', 'M2'].map((nm, n) => {
      const m = k.root(nm, 'core:person');
      k.addEdge({ type: 'core:member-of', from: m, to: G, attrs: { role: 'member', strength: 0.75 }, valid: { to: 600 }, cause });
      return k.frames.open({ actor: m, level: 'drive', origin: fid(`M${n}`), payload: { drive: 'honour' }, weight: 0.5, cause });
    });
    believe(k, L);
    k.settle();
    k.dispatcher.drain();
    expect(drives.every((d) => k.frames.frame(d.id)!.parents.map((p) => p.frame).join() === concern.id)).toBe(true);
    return { k, L, drives };
  }

  const advance = (k: Kernel, budget: number | undefined): void => {
    if (budget === undefined) k.tick({ to: 600 });
    else k.settle({ to: 600, budget });
  };

  test('SR2-01: a belief hook sees both expiries applied and no work pending, whatever the budget', () => {
    const seen = (budget: number | undefined) => {
      const { k, drives } = expiring('SR2-01');
      const log: Array<{ parents: number[]; idle: boolean }> = [];
      k.beliefs.policy = {
        ...STUB_POLICY,
        onTick: (kk, _who, at) => {
          if (at === 600) log.push({ parents: drives.map((d) => kk.frames.frame(d.id)!.parents.length), idle: kk.frames.worklist.isEmpty && kk.dispatcher.idle });
        },
      };
      advance(k, budget);
      return log;
    };
    const whole = seen(undefined);
    expect(whole).toEqual([{ parents: [0, 0], idle: true }]);
    expect(seen(1)).toEqual(whole);
    expect(seen(3)).toEqual(whole);
  });

  test('SR2-01: once the hooks of a boundary have begun they finish before the work they queued starts', () => {
    const seen = (budget: number | undefined) => {
      const k = coreKernel('SR2-01b');
      const a = k.root('a', 'core:person');
      const b = k.root('b', 'core:person');
      for (const who of [a, b]) believe(k, who);
      k.settle();
      const log: number[] = [];
      let n = 0;
      k.beliefs.policy = {
        ...STUB_POLICY,
        onTick: (kk, _who, at) => {
          if (at !== 600) return;
          log.push(kk.pending.length); // changes the earlier hooks of this boundary queued and nothing has dispatched yet
          kk.pin({ node: a, slot: 'age', value: 20 + n++, reason: 'authored', cause });
        },
      };
      advance(k, budget);
      return log;
    };
    const whole = seen(undefined);
    expect(whole).toEqual([0, 1]);
    expect(seen(1)).toEqual(whole);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-02 a load re-syncs inheritance at the saved time and keeps it correct through the catch-up', () => {
  const port: GamePort = { now: () => 2400, readMirrored: () => [] };

  /** M inherits the group's concern until 1800; a process pin on N lands at 1200. The world is saved at 600. */
  function crew(name: string) {
    const k = coreKernel(name);
    const G = k.root('G', 'core:group');
    const L = k.root('L', 'core:person');
    const M = k.root('M', 'core:person');
    const N = k.root('N', 'core:person');
    k.frames.demandRoots.add(M);
    k.addEdge({ type: 'core:member-of', from: L, to: G, attrs: { role: 'leader', strength: 1 }, cause });
    k.addEdge({ type: 'core:member-of', from: M, to: G, attrs: { role: 'member', strength: 0.75 }, valid: { to: 1800 }, cause });
    const concern = k.groups.decide(L, G, {
      op: 'open',
      spec: { level: 'concern', origin: fid('G-honour'), payload: { drive: 'honour' }, weight: 0.9, own: { wants: [{ slot: '*', scope: { nodes: [N] } }] } },
    });
    const drive = k.frames.open({ actor: M, level: 'drive', origin: fid('M-honour'), payload: { drive: 'honour' }, weight: 0.5, cause });
    k.evolution.register({ id: 'p', tier: 0, period: 1, run: (_c, b) => (b === 1 ? [{ op: 'pin', node: N, slot: 'age', value: 40 }] : []) });
    believe(k, L);
    k.settle({ to: 600 });
    k.dispatcher.drain();
    expect(k.frames.frame(drive.id)!.parents.map((p) => p.frame)).toEqual([concern.id]);
    const trail: Array<[number, number]> = [];
    k.beliefs.policy = { ...STUB_POLICY, onTick: (kk, _who, at) => { trail.push([at, kk.frames.frame(drive.id)!.parents.length]); } };
    return { k, M, drive, trail };
  }

  test('SR2-02: after a load the member hears of a pin applied at 1200 and loses the parent at 1800, as without a load', () => {
    const control = crew('SR2-02');
    control.k.settle({ to: 2400 });
    const expected = control.k.dispatcher.drain().filter((r) => r.actor === control.M).map((r) => [r.type, r.r]);
    expect(expected).toHaveLength(1);
    expect(control.trail).toEqual([[1200, 1], [1800, 0], [2400, 0]]);

    const w = crew('SR2-02');
    w.k.persistence.save('A');
    w.k.persistence.load('A', port);
    // The load re-synced at the saved time, 600: the membership is in force there, so the parent stays.
    expect(w.k.now).toBe(2400);
    expect(w.k.frames.frame(w.drive.id)!.parents).toHaveLength(1);
    w.k.settle({ to: 2400 });
    expect(w.trail).toEqual(control.trail);
    expect(w.k.dispatcher.drain().filter((r) => r.actor === w.M).map((r) => [r.type, r.r])).toEqual(expected);
    expect(w.k.frames.frame(w.drive.id)!.parents).toEqual([]);
  });

  test('SR2-02: the catch-up gives the same frames however it is split into ticks', () => {
    const run = (tos: number[]) => {
      const w = crew('SR2-02p');
      w.k.persistence.save('A');
      w.k.persistence.load('A', port);
      for (const to of tos) w.k.settle({ to });
      return { trail: w.trail, parents: w.k.frames.frame(w.drive.id)!.parents };
    };
    const one = run([2400]);
    expect(one.trail).toEqual([[1200, 1], [1800, 0], [2400, 0]]);
    expect(run([1200, 1800, 2400])).toEqual(one);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-03 retention follows Ids that are keys of a table form', () => {
  const defs = defsOf(
    [dim('fx:target-ref', { t: 'ref', kind: 'fx:target', candidates: { find: 'fx:target', scope: { nodes: ['root:t1'] }, must: [], max: 8 } })],
    [kind('fx:target', []), kind('fx:holder', [slot('r', 'fx:target-ref')])],
  );

  test('SR2-03: a node named only by the weights of an outstanding table form, nested forms included, survives save and load', () => {
    const k = fxKernel('SR2-03', defs);
    const holder = k.root('holder', 'fx:holder');
    const X = k.mint(holder, cause, 'x', 'fx:target');
    const Y = k.mint(holder, cause, 'y', 'fx:target');
    const Z = k.mint(holder, cause, 'z', 'fx:target');
    const target = { slot: 'r', scope: { nodes: [holder] } };
    k.evolution.register({
      id: 'maker', tier: 0, period: 4,
      run: () => [
        { op: 'contribute', target, mode: 'weight', form: { f: 'table', weights: { [X]: 3 } } },
        { op: 'contribute', target, mode: 'weight', form: { f: 'rule', when: [], then: { f: 'table', weights: { [Y]: 2 } } } },
      ],
    });
    k.tick({ to: 0 });
    expect(k.evolution.stateOf('maker').outstanding).toHaveLength(1);
    expect(k.retention.isRetained(X)).toBe(true);
    expect(k.retention.isRetained(Y)).toBe(true);
    expect(k.retention.isRetained(Z)).toBe(false);
    k.persistence.save('A');
    k.persistence.load('A');
    expect(k.store.header(X)).toBeDefined();
    expect(k.store.header(Y)).toBeDefined();
    expect(k.store.header(Z)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-04 a change to the outstanding batches invalidates retention', () => {
  const defs = defsOf([dim('fx:abc', { t: 'enum', values: ['a', 'b', 'c'] })], [kind('fx:node', [slot('n', 'fx:abc', { mode: 'assigned' })])]);

  test('SR2-04: a batch that names an unretained node, queued after the cache was warm, keeps it through save and load', () => {
    const k = fxKernel('SR2-04', defs);
    const holder = k.root('holder', 'fx:node');
    const X = k.mint(holder, cause, 'x', 'fx:node');
    k.evolution.register({ id: 'later', tier: 0, period: 1, run: (_c, b) => (b === 0 ? [{ op: 'pin', node: X, slot: 'n', value: 'a' }] : []) });
    expect(k.retention.isRetained(X)).toBe(false); // warms the cache: nothing names X yet
    const revision = k.revision;
    k.tick({ to: 0 });
    expect(k.evolution.stateOf('later').outstanding).toHaveLength(1);
    expect(k.revision).toBeGreaterThan(revision); // the roots changed, so the revision did
    expect(k.retention.isRetained(X)).toBe(true);
    k.persistence.save('A');
    k.persistence.load('A');
    expect(k.store.header(X)).toBeDefined();
    // The batch still applies after the load.
    k.tick({ to: 600 });
    expect(k.value(X, 'n')).toBe('a');
  });

  test('SR2-04: applying a batch changes the revision too, so a node only it named is released', () => {
    const k = fxKernel('SR2-04b', defs);
    const holder = k.root('holder', 'fx:node');
    const X = k.mint(holder, cause, 'x', 'fx:node');
    // The operation is refused when it applies (no such slot), so nothing else ever names X.
    k.evolution.register({ id: 'refused', tier: 0, period: 1, run: (_c, b) => (b === 0 ? [{ op: 'pin', node: X, slot: 'nope', value: 'a' }] : []) });
    k.tick({ to: 0 });
    expect(k.retention.isRetained(X)).toBe(true);
    const revision = k.revision;
    k.tick({ to: 600 });
    expect(k.defects.ofKind('op-refused')).toHaveLength(1);
    expect(k.revision).toBeGreaterThan(revision);
    expect(k.retention.isRetained(X)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-05 matching reads of a temporal slot see the change\'s own value', () => {
  const defs = defsOf(
    [dim('fx:wx', { t: 'enum', values: ['clear', 'rain', 'fog'] }, { buckets: { name: 'bucket-map', version: 1, params: { map: { rain: 'wet', fog: 'wet', clear: 'dry' } } } })],
    [kind('fx:weather', [slot('weather', 'fx:wx', { temporal: { window: 600 } })], { extends: ['core:thing'] })],
  );
  const LOW = '00000000000000000000000000000001';
  const HIGH = 'ffffffffffffffffffffffffffffff01';

  function watcher(name: string, path: string, op: 'eq' | 'in', arg: string | string[], selectorSlot = 'weather') {
    const k = coreKernel(name, defs);
    const v = k.root('v', 'core:person');
    k.frames.demandRoots.add(v);
    const w = k.root('w', 'fx:weather');
    k.frames.open({ actor: v, level: 'concern', origin: fid('watch'), weight: 1, cause, own: { reactsTo: [{ kind: 'core:thing', slot: selectorSlot, where: [{ path, op, arg }] }] } });
    k.settle();
    k.dispatcher.drain();
    return { k, v, w };
  }

  // An interest in `weather` hears of changes to any window of it, and so does an interest in every slot.
  for (const selectorSlot of ['weather', '*']) {
    test(`SR2-05: queued pins on a window are each matched against their own new value (interest slot ${selectorSlot})`, () => {
      const { k, v, w } = watcher('SR2-05', 'weather', 'eq', 'rain', selectorSlot);
      k.now = 100;
      k.pin({ node: w, slot: 'weather@w0', value: 'rain', reason: 'authored', cause, id: HIGH });
      k.now = 200;
      k.pin({ node: w, slot: 'weather@w0', value: 'clear', reason: 'authored', cause, id: LOW });
      // The world's value for the window is clear, so a matcher reading the world sees neither change as rain.
      expect(k.value(w, 'weather', 100)).toBe('clear');
      k.tick({ to: 600 });
      const out = k.dispatcher.drain().filter((r) => r.actor === v);
      expect(out).toHaveLength(1);
      expect(out[0]!.change).toMatchObject({ c: 'pin', slot: 'weather@w0', new: 'rain' });
    });
  }

  test('SR2-05: a bucket predicate follows the same rule, and a withdrawal is matched against the value it removed', () => {
    const { k, v, w } = watcher('SR2-05b', 'weather:bucket', 'in', ['wet']);
    const rain = k.pin({ node: w, slot: 'weather@w0', value: 'rain', reason: 'committed', cause, id: HIGH });
    k.pin({ node: w, slot: 'weather@w0', value: 'clear', reason: 'authored', cause: H(s('other')), id: LOW });
    k.withdrawPin(rain.id, cause);
    expect(k.value(w, 'weather')).toBe('clear');
    k.settle();
    const out = k.dispatcher.drain().filter((r) => r.actor === v);
    expect(out.map((r) => (r.change.c === 'pin' ? r.change.reason : r.change.c))).toEqual(['committed', 'withdrawn']);
  });

  test('SR2-05: only reads that fall in the changed window see the change\'s value', () => {
    const { k, v, w } = watcher('SR2-05c', 'weather', 'eq', 'rain');
    k.now = 100;
    // A pin on window 1, made during window 0: a read at the change's time is a read of window 0, which says clear.
    k.pin({ node: w, slot: 'weather@w0', value: 'clear', reason: 'authored', cause, id: LOW });
    k.pin({ node: w, slot: 'weather@w1', value: 'rain', reason: 'authored', cause, id: HIGH });
    k.tick({ to: 600 });
    expect(k.dispatcher.drain().filter((r) => r.actor === v)).toHaveLength(0);
    // Made during window 1, the same pin is a change to what the world says then.
    k.now = 700;
    k.pin({ node: w, slot: 'weather@w1', value: 'rain', reason: 'committed', cause });
    k.tick({ to: 1200 });
    expect(k.dispatcher.drain().filter((r) => r.actor === v)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-06 installing a pack into a read-only world changes nothing', () => {
  const readOnly = (name: string): Kernel => {
    const k = coreKernel(name);
    const rec = k.persistence.save('A');
    rec.meta.versions.push('derive:vanished@3');
    expect(k.persistence.load('A').readOnly).toBe(true);
    return k;
  };
  const installed = (k: Kernel): Map<string, string> => (k.persistence as unknown as { installed: Map<string, string> }).installed;

  test('SR2-06: an empty pack and a pack with contributions are refused before either pack map changes', () => {
    const k = readOnly('SR2-06');
    const a = k.root('a', 'core:person');
    const empty: Pack = { id: 'empty', version: '1.0.0', contributions: [] };
    const full: Pack = {
      id: 'full', version: '1.0.0',
      contributions: [{ layer: 'authored', target: { slot: 'age', scope: { nodes: [a] } }, form: { f: 'const', value: 30 }, mode: 'constrain' }],
    };
    const revision = k.revision;
    expect(() => k.persistence.installPack(empty)).toThrow(/read-only/);
    expect(() => k.persistence.installPack(full)).toThrow(/read-only/);
    expect(k.persistence.packs.size).toBe(0);
    expect(installed(k).size).toBe(0);
    expect(k.revision).toBe(revision);
    expect(k.store.allContributions()).toHaveLength(0);
    // A later load lifts the restriction, and no pack leaked into what it saves.
    expect(k.persistence.load('A').readOnly).toBe(true); // (the save's own record still names the missing function)
    k.persistence.chain.get('A')!.meta.versions.pop();
    expect(k.persistence.load('A').readOnly).toBe(false);
    expect(k.persistence.save('B').meta.packs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('SR2-07 a summary whose kind failed fails the item and the query that reads it', () => {
  const extra = defsOf(
    [dim('fx:skind', { t: 'enum', values: ['a', 'b', 'c'] }, { prior: { name: 'bad', version: 1 } })],
    [
      kind('fx:summary', [
        slot('kind', 'fx:skind'),
        slot('from', 'core:time', { mode: 'assigned', tier: 1 }),
        slot('length', 'core:duration', { mode: 'assigned', tier: 1 }),
        slot('scope', 'core:place-ref', { mode: 'assigned', tier: 1 }),
        slot('count', 'core:count-255', { mode: 'assigned', tier: 1 }),
      ], { extends: ['core:thing'], facets: ['summary'] }),
    ],
  );

  test('SR2-07: the item\'s kind is failed, not unavailable, and a query that requires it is failed, not an empty success', () => {
    const registry = coreRegistry();
    registry.register('prior', 'bad', 1, (_dim, F) => F.map(() => -1)); // not a positive weight
    const k = Kernel.create({ defs: mergeDefs(coreDefs(600), extra), worldSeed: fxSeed('SR2-07'), registry });
    const city = k.root('city', 'core:place');
    const plaza = k.root('plaza', 'core:place');
    k.addEdge({ type: 'core:located-in', from: plaza, to: city, cause });
    const S = k.mint(city, cause, 'S', 'fx:summary');
    for (const [sl, value] of [['from', 0], ['length', 1000], ['scope', city], ['count', 2]] as const) {
      k.pin({ node: S, slot: sl, value, reason: 'committed', cause, silent: true });
    }
    const item = k.summaries.materialise(S, 0);
    expect(k.resolve(S, 'kind').status).toBe('failed');
    expect(k.resolve(item, 'kind').status).toBe('failed');
    expect(k.resolve(item, 'time').status).toBe('ok');
    const out = k.query({ find: 'core:event', scope: { under: city }, at: 500, must: [{ path: 'kind', op: 'eq', arg: 'a' }], limit: 'all' });
    expect(out.status).toBe('failed');
    // A query that does not read the kind still finds the items.
    const plain = k.query({ find: 'core:event', scope: { under: city }, at: 500, must: [], limit: 'all' });
    expect(plain.status === 'ok' && plain.items.length).toBe(2);
  });
});
