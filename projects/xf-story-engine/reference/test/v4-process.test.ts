// The kernel's process additions (S0 section 20, V4-35 to V4-49): a process's own state, other processes' digests,
// demanded(tier), the operation set, window-keyed draws, matchStrength, backdated events, publish-item, silent
// restatement and persisted digests. Each test is named by the addition it checks.

import { describe, expect, test } from 'bun:test';
import { coreDefs, mergeDefs } from '../src/core-schema.ts';
import { H, id as hid, i as hi, rand, s as hs } from '../src/id.ts';
import { Kernel, contributionId } from '../src/kernel.ts';
import { coreRegistry } from '../src/registry.ts';
import { rootId } from '../src/id.ts';
import type { ProcessCtx, ProcessDef, ProcessOp } from '../src/evolution.ts';
import type { Change, Id } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxSeed, kind, slot } from './helpers.ts';

const W = 600;
const cause = H(hs('cause'), hs('v4-process'));

const pinDefs = defsOf(
  [dim('fx:n', { t: 'int', min: 0, max: 1_000_000 }), dim('fx:big', { t: 'int', min: 0, max: 100_000 }), dim('fx:cls', { t: 'enum', values: ['adult', 'minor', 'none'] })],
  [kind('fx:cell', [slot('n', 'fx:n', { mode: 'assigned', temporal: { window: W } })], { extends: ['core:place'] })],
);

const worldKernel = (name: string, extra = pinDefs, config = {}) => coreKernel(name, extra, config);

describe('V4-35: a process reads and replaces its own state, with its batch', () => {
  const counter = (log: Array<number | undefined>): ProcessDef => ({
    id: 'counter', tier: 0, period: 1,
    init: () => ({ n: 100 }),
    run(ctx, k) {
      const own = ctx.own<{ n: number }>();
      log.push(own?.n);
      return { ops: [], state: { n: (own?.n ?? 0) + 1 } };
    },
  });

  test('own() is the init state before any batch has applied, then the state as of the snapshot', () => {
    const log: Array<number | undefined> = [];
    const k = worldKernel('V4-35a');
    k.evolution.register(counter(log));
    k.tick({ to: 4 * W });
    // The run at boundary b sees the state the run at b - 1 returned: applied at b, before the snapshot.
    expect(log).toEqual([100, 101, 102, 103, 104]);
  });

  test('the state is applied atomically with the batch at the end of its span, and a period-2 process sees it at its next run', () => {
    const seen: Array<{ k: number; own: unknown }> = [];
    const k = worldKernel('V4-35b');
    k.evolution.register({
      id: 'slow', tier: 0, period: 2,
      run(ctx, kk) {
        seen.push({ k: kk, own: ctx.own() });
        return { ops: [], state: { at: kk } };
      },
    });
    k.tick({ to: 6 * W });
    expect(seen).toEqual([{ k: 0, own: undefined }, { k: 2, own: { at: 0 } }, { k: 4, own: { at: 2 } }, { k: 6, own: { at: 4 } }]);
    // Until its span ends the new state is held in the outstanding batch, not applied.
    expect(k.evolution.stateOf('slow').state).toEqual({ at: 4 });
    expect(k.evolution.stateOf('slow').outstanding.map((b) => b.state)).toEqual([{ at: 6 }]);
  });

  test('own() is a copy: editing it changes nothing', () => {
    const k = worldKernel('V4-35c');
    let first = true;
    k.evolution.register({
      id: 'p', tier: 0, period: 1,
      run(ctx) {
        const own = ctx.own<{ list: number[] }>() ?? { list: [] };
        if (!first) own.list.push(99);
        first = false;
        return { ops: [], state: { list: [1] } };
      },
    });
    k.tick({ to: 3 * W });
    expect(k.evolution.stateOf('p').state).toEqual({ list: [1] });
  });

  test('a save and a load restore the state, and the outstanding batch applies without a run', () => {
    let runs = 0;
    const make = (): Kernel => {
      const k = worldKernel('V4-35d');
      k.evolution.register({
        id: 'p', tier: 0, period: 1,
        run(ctx, kk) {
          runs++;
          return { ops: [], state: { k: kk, prev: ctx.own() }, digest: { through: kk } };
        },
      });
      return k;
    };
    const k = make();
    k.tick({ to: 3 * W });
    k.persistence.save('A');
    const stateBefore = structuredClone(k.evolution.stateOf('p'));
    const runsAtSave = runs;
    k.tick({ to: 6 * W });
    k.persistence.load('A');
    expect(k.evolution.stateOf('p')).toEqual(stateBefore);
    expect(runs).toBeGreaterThan(runsAtSave);
    const runsAfterLoad = runs;
    // The outstanding batch (the run of window 3) applies at boundary 4 without running again: the next run is window 4's.
    k.tick({ to: 4 * W });
    expect(runs).toBe(runsAfterLoad + 1);
    expect((k.evolution.stateOf('p').state as { k: number }).k).toBe(3);
    expect(k.evolution.digestOf<object>('p')).toEqual({ through: 3 });
  });
});

describe('V4-36 and V4-42: a process reads other processes\' digests as of the snapshot', () => {
  test('a reader sees the digest of the previous window, never one made in its own boundary; hooks read the same', () => {
    const k = worldKernel('V4-36');
    const seen: Array<unknown> = [];
    k.evolution.register({ id: 'a-producer', tier: 0, period: 1, run: (_c, kk) => ({ ops: [], digest: { w: kk } }) });
    k.evolution.register({ id: 'b-reader', tier: 0, period: 1, run: (ctx) => { seen.push(ctx.digest('a-producer')); return []; } });
    k.tick({ to: 3 * W });
    expect(seen).toEqual([undefined, { w: 0 }, { w: 1 }, { w: 2 }]);
    // V4-42: the same value is readable outside a run, as of the last applied boundary.
    expect(k.evolution.digestOf<object>('a-producer')).toEqual({ w: 2 });
    expect(k.evolution.digestOf<object>('nobody')).toBeUndefined();
  });

  test('the answer is a copy', () => {
    const k = worldKernel('V4-36b');
    k.evolution.register({ id: 'p', tier: 0, period: 1, run: (_c, kk) => ({ ops: [], digest: { list: [kk] } }) });
    k.tick({ to: 2 * W });
    const d = k.evolution.digestOf<{ list: number[] }>('p')!;
    d.list.push(7);
    expect(k.evolution.digestOf<object>('p')).toEqual({ list: [1] });
  });
});

describe('V4-37: demanded(tier)', () => {
  test('a fine-tier process sees the nodes demand reaches at its tier or finer, with their claims, in Id order', () => {
    const k = coreKernel('V4-37', pinDefs);
    const v = k.vId;
    k.root('v', 'core:person');
    const a = k.root('cellA', 'fx:cell');
    const b = k.root('cellB', 'fx:cell');
    const c = k.root('cellC', 'fx:cell');
    k.frames.demandRoots.add(v);
    k.frames.open({ id: H(hs('f'), hid(a)), actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [a], tier: 3 }, cause });
    k.frames.open({ id: H(hs('f'), hid(b)), actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [b], tier: 4 }, cause });
    k.frames.open({ id: H(hs('f'), hid(c)), actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [c], tier: 2 }, cause });
    const got: Record<number, Array<{ node: Id; tier: number; claim: number }>> = {};
    const probe = (ctx: ProcessCtx): ProcessOp[] => { got[3] = ctx.demanded(3); got[4] = ctx.demanded(4); got[2] = ctx.demanded(2); return []; };
    k.evolution.register({ id: 'scene', tier: 3, period: 1, run: probe });
    k.tick({ to: W });
    expect(got[3]!.map((d) => d.node).sort()).toEqual([a, b].sort());
    expect(got[4]!.map((d) => d.node)).toEqual([b]);
    expect(got[2]!.map((d) => d.node).sort()).toEqual([a, b, c].sort());
    const ids = got[3]!.map((d) => d.node);
    expect(ids).toEqual([...ids].sort());
    expect(got[4]![0]!.tier).toBe(4);
    expect(got[4]![0]!.claim).toBe(k.frames.claim(b));
    expect(got[4]![0]!.claim).toBeGreaterThan(0);
  });

  test('a node the demand does not reach is not listed, and a closed frame withdraws its node', () => {
    const k = coreKernel('V4-37b', pinDefs);
    const v = k.vId;
    k.root('v', 'core:person');
    const a = k.root('cellA', 'fx:cell');
    k.frames.demandRoots.add(v);
    const f = k.frames.open({ actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [a], tier: 3 }, cause });
    expect(k.frames.demanded(3).map((d) => d.node)).toEqual([a]);
    expect(k.frames.demanded(4)).toEqual([]);
    k.frames.setStatus(f.id, 'abandoned', cause);
    expect(k.frames.demanded(3)).toEqual([]);
  });
});

describe('V4-38: the process operation set', () => {
  test('frames, observation, belief set and drop, and telling are applied with the batch, in order', () => {
    const k = coreKernel('V4-38', pinDefs);
    const alice = k.root('alice', 'core:person');
    const bob = k.root('bob', 'core:person');
    const place = k.root('place', 'fx:cell');
    const frameId = H(hs('frame'), hs('fx'));
    const beliefId = H(hs('belief'), hs('fx'));
    let step = 0;
    const log: string[] = [];
    k.evolution.register({
      id: 'acts', tier: 0, period: 1,
      run() {
        step++;
        if (step === 1) {
          return [
            { op: 'frame-open', frame: { id: frameId, actor: alice, level: 'situation', origin: alice, weight: 0.5, focus: { nodes: [place], tier: 2 }, cause } },
            { op: 'belief-set', belief: { id: beliefId, believer: alice, subject: place, path: 'kind', value: 'x', confidence: 0.9, evidence: [place], source: { by: 'observed', event: place }, formed: 0, refreshed: 0, memorable: true } },
          ];
        }
        if (step === 2) {
          log.push(`frame ${k.frames.frame(frameId)?.weight}`);
          return [
            { op: 'frame-weight', frame: frameId, weight: 0.8, cause },
            { op: 'frame-interests', frame: frameId, own: { wants: [{ slot: '*', scope: { nodes: [bob] } }] }, cause },
            { op: 'tell', teller: alice, listener: bob, belief: beliefId, event: place, operator: null },
            { op: 'frame-status', frame: frameId, status: 'blocked', cause },
          ];
        }
        if (step === 3) {
          return [
            { op: 'belief-drop', believer: alice, belief: beliefId },
            { op: 'observe', observer: alice, node: place, slot: 'public', at: 0 },
          ];
        }
        return [];
      },
    });
    k.tick({ to: 2 * W });
    const f = k.frames.frame(frameId)!;
    expect(f.weight).toBe(0.8);
    expect(f.status).toBe('blocked');
    expect(f.own.wants.length).toBe(1);
    expect(k.beliefs.get(bob, place, 'kind')?.source).toEqual({ by: 'told', teller: alice, event: place });
    k.tick({ to: 4 * W });
    expect(k.beliefs.get(alice, place, 'kind')).toBeUndefined();
    const pins = k.store.pinsOn(place, 'public').filter((p) => p.reason === 'observed');
    expect(pins.length).toBe(1);
    expect(pins[0]!.cause).toBe(alice);
    expect(log).toEqual(['frame 0.5']);
  });

  test('a process op that is refused is a defect, never an exception, and the rest of the batch applies', () => {
    const k = coreKernel('V4-38b', pinDefs);
    const p = k.root('p', 'core:person');
    let first = true;
    k.evolution.register({
      id: 'bad', tier: 0, period: 1,
      run() {
        if (!first) return [];
        first = false;
        return [{ op: 'frame-status', frame: H(hs('nope')), status: 'abandoned', cause }, { op: 'observe', observer: p, node: p, slot: 'age', at: 0 }];
      },
    });
    k.tick({ to: 2 * W });
    expect(k.defects.ofKind('op-refused').length > 0).toBe(true);
  });

  test('a minted event takes the creator and cause a process names, which fix its identity', () => {
    const k = coreKernel('V4-38c', pinDefs);
    const place = k.root('place', 'fx:cell');
    const raw = H(hs('raw'));
    const me = H(hs('creator'));
    let done = false;
    k.evolution.register({
      id: 'mint', tier: 0, period: 1,
      run() {
        if (done) return [];
        done = true;
        return [{ op: 'mint-event', spec: { creator: me, cause: raw, name: 'mir', time: 10, kind: 'generic', place } }];
      },
    });
    k.tick({ to: 2 * W });
    expect(k.store.header(H(hs('mint'), hid(me), hid(raw), hs('mir')))?.kind).toBe('core:event');
  });
});

describe('V4-39: items of a summary with no place under its scope take the scope as their place', () => {
  const build = (config = {}) => {
    const k = coreKernel('V4-39', pinDefs, config);
    const cell = k.root('cell', 'fx:cell');
    const sum = k.summaries.mintSummary({ creator: cause, cause, name: 'sum', kind: 'generic', from: 1000, length: W, scope: cell, count: 3 });
    return { k, cell, sum };
  };

  test('the place is the scope, and every item has it', () => {
    const { k, cell, sum } = build();
    for (let n = 0; n < 3; n++) expect(k.value(k.summaries.materialise(sum, n), 'place')).toBe(cell);
  });

  test('a scope with places strictly under it still draws among them, and never the scope', () => {
    const k = coreKernel('V4-39b', pinDefs);
    const district = k.root('district', 'fx:cell');
    const c1 = k.mint(district, district, 'c1', 'fx:cell');
    k.addEdge({ type: 'core:located-in', from: c1, to: district, cause });
    const sum = k.summaries.mintSummary({ creator: cause, cause, name: 'sum', kind: 'generic', from: 1000, length: W, scope: district, count: 2 });
    expect(k.value(k.summaries.materialise(sum, 0), 'place')).toBe(c1);
  });

  test('the old behaviour is switchable', () => {
    const { k, sum } = build({ itemScopePlace: false });
    expect(k.value(k.summaries.materialise(sum, 0), 'place')).toBeUndefined();
  });
});

describe('V4-40: an unavailable derive input reaches the derive as undefined; other statuses propagate', () => {
  const defs = defsOf(
    [dim('fx:a', { t: 'int', min: 0, max: 90 }), dim('fx:big', { t: 'int', min: 0, max: 100_000 }), dim('fx:cls', { t: 'enum', values: ['adult', 'minor', 'unknown'] }), dim('fx:out', { t: 'int', min: 0, max: 100_000 })],
    [kind('fx:thing', [
      slot('reading', 'fx:a', { mode: 'mirrored' }),
      slot('huge', 'fx:big', { mode: 'sampled' }),
      slot('cls', 'fx:cls', { mode: 'derived', derive: { fn: { name: 'cls-of', version: 1 }, inputs: ['reading'] } }),
      slot('after', 'fx:out', { mode: 'derived', derive: { fn: { name: 'echo', version: 1 }, inputs: ['huge'] } }),
    ])],
  );
  const kern = (): Kernel => {
    const registry = coreRegistry();
    registry.register('derive', 'cls-of', 1, (inputs) => (inputs[0] === undefined ? 'unknown' : (inputs[0] as number) >= 18 ? 'adult' : 'minor'));
    registry.register('derive', 'echo', 1, (inputs) => inputs[0]);
    return Kernel.create({ defs: mergeDefs(coreDefs(), defs), worldSeed: fxSeed('V4-40'), registry, validate: false });
  };

  test('an unavailable input is undefined to the derive, which may answer', () => {
    const k = kern();
    const t = k.mirrored('t', 'fx:thing');
    expect(k.resolve(t, 'reading', 0).status).toBe('unavailable');
    expect(k.resolve(t, 'cls', 0)).toEqual({ value: 'unknown', status: 'ok' });
  });

  test('a failed input propagates and the derive is not called', () => {
    const k = kern();
    const t = k.mirrored('t', 'fx:thing');
    expect(k.resolve(t, 'huge', 0).status).toBe('failed');
    expect(k.resolve(t, 'after', 0).status).toBe('failed');
  });

  test('the core derives stay strict: a derive that gets undefined and returns none is unavailable', () => {
    const k = coreKernel('V4-40c', pinDefs);
    const p = k.mirrored('p', 'core:person');
    // A mirrored person's age-class is its reading; with none it is unavailable, as before.
    expect(k.resolve(p, 'age-class', 0).status).toBe('unavailable');
  });
});

describe('V4-41: a process draw is keyed by the window being computed', () => {
  test('procRand(w) is the same draw whether the run starts at w or earlier', () => {
    const seed = fxSeed('V4-41');
    const one: number[] = [];
    const two: number[] = [];
    const k1 = Kernel.create({ defs: coreDefs(), worldSeed: seed });
    k1.evolution.register({ id: 'p', tier: 0, period: 1, run: (ctx, k) => { one[k] = ctx.rand(hs('x')); return []; } });
    k1.tick({ to: 6 * W });
    const k2 = Kernel.create({ defs: coreDefs(), worldSeed: seed });
    k2.evolution.register({
      id: 'p', tier: 0, period: 2,
      run: (ctx, k) => { two[k] = ctx.procRand(k, hs('x')); two[k + 1] = ctx.procRand(k + 1, hs('x')); return []; },
    });
    k2.tick({ to: 6 * W });
    for (let w = 0; w <= 6; w++) expect(two[w]).toBe(one[w]!);
    expect(one[3]).toBe(rand(hs('proc'), hid(seed), hs('p'), hi(3), hs('x')));
  });
});

describe('V4-43: the operation shapes and contributionId(spec)', () => {
  test('the Id is a pure function of what the contribution says, and contribute returns it', () => {
    const k = coreKernel('V4-43', pinDefs);
    const place = k.root('place', 'fx:cell');
    const spec = {
      source: { layer: 'simulation' as const, origin: 'proc' }, target: { slot: 'n', scope: { nodes: [place] } },
      form: { f: 'const' as const, value: 5 }, mode: 'constrain' as const,
    };
    const id1 = contributionId(spec);
    expect(id1).toBe(contributionId({ ...spec, strength: 1, valid: {} }));
    expect(k.contribute(spec).id).toBe(id1);
    k.newEpoch();
    expect(contributionId(spec)).toBe(id1);
    expect(contributionId({ ...spec, strength: 2 })).not.toBe(id1);
    expect(contributionId({ ...spec, source: { layer: 'simulation', origin: 'other' } })).not.toBe(id1);
  });
});

describe('V4-44: matchStrength(actor, change, types?)', () => {
  const setup = () => {
    const k = coreKernel('V4-44', pinDefs);
    const alice = k.root('alice', 'core:person');
    const bob = k.root('bob', 'core:person');
    const place = k.root('place', 'fx:cell');
    const f = k.frames.open({
      actor: alice, level: 'concern', origin: alice, weight: 0.8, focus: { nodes: [place], tier: 2 },
      own: { protects: [{ slot: '*', scope: { nodes: [bob] } }], reactsTo: [{ slot: '*', scope: { nodes: [place] } }] }, cause,
    });
    k.settle();
    return { k, alice, bob, place, f };
  };
  const event = (bob: Id, place: Id): Change => ({ c: 'event', event: H(hs('ev')), kind: 'assault', place, participants: [{ who: bob, role: 'victim' }], effects: [{ on: bob, effect: 'harm' }] });

  test('it is the greatest relevance the matching gives, as dispatch computes it, with no threshold', () => {
    const { k, alice, bob, place, f } = setup();
    const got: number[] = [];
    k.dispatcher.onRelevance((r) => { if (r.actor === alice) got.push(r.r); });
    const ch = event(bob, place);
    const m = k.matchStrength(alice, ch);
    // protects on bob by Id: 0.8 * 1.0 * 1.0 (pull 0.8, m 1.0, s 1.0); reactsTo place by Id: 0.8 * 0.6 * 1.0.
    expect(m).toBeCloseTo(0.8, 12);
    expect(k.matchStrength(alice, ch, ['reactsTo'])).toBeCloseTo(0.48, 12);
    expect(k.matchStrength(alice, ch, ['protects', 'threatenedBy'])).toBeCloseTo(0.8, 12);
    expect(k.matchStrength(alice, ch, ['wants'])).toBe(0);
    expect(f.weight).toBe(0.8);
    // A read makes no emission and bumps nothing.
    const rev = k.revision;
    k.matchStrength(alice, ch);
    expect(k.revision).toBe(rev);
    expect(k.pending.length).toBe(0);
    // Dispatch of the same change gives the same strengths.
    k.emit(ch);
    k.settle();
    expect(Math.max(...got)).toBeCloseTo(m, 12);
  });

  test('an actor with no eligible frame, or a change nothing matches, scores 0', () => {
    const { k, alice, bob, place, f } = setup();
    expect(k.matchStrength(bob, event(bob, place))).toBe(0);
    expect(k.matchStrength(alice, { c: 'minted', node: H(hs('other')), kind: 'core:event' })).toBe(0);
    k.frames.setStatus(f.id, 'abandoned', cause);
    k.settle();
    expect(k.matchStrength(alice, event(bob, place))).toBe(0);
  });
});

describe('V4-45: an event may be minted with a time earlier than the boundary that applies it', () => {
  test('its time is its own, and the change it makes is stamped with it', () => {
    const k = coreKernel('V4-45', pinDefs);
    const watcher = k.root('watcher', 'core:person');
    const place = k.root('place', 'fx:cell');
    k.frames.open({ actor: watcher, level: 'situation', origin: watcher, weight: 1, focus: { nodes: [place], tier: 2 }, own: { reactsTo: [{ kind: 'core:event', slot: '*' }] }, cause });
    const times: number[] = [];
    k.dispatcher.onRelevance((r) => times.push(r.time));
    let done = false;
    k.evolution.register({
      id: 'late', tier: 0, period: 1,
      run(_c, kk) {
        if (done || kk < 3) return [];
        done = true;
        return [{ op: 'mint-event', spec: { name: 'old', time: 100, kind: 'generic', place } }];
      },
    });
    k.tick({ to: 5 * W });
    const ev = H(hs('mint'), hid(H(hs('process'), hs('late'))), hid(H(hs('process'), hs('late'))), hs('old'));
    expect(k.value(ev, 'time')).toBe(100);
    expect(times).toEqual([100]);
  });
});

describe('V4-46: a SeedRecord with no actor retains only its own nodes', () => {
  test('it is no demand root and holds no frames; its nodes are kept, the Ids inside its state are not', () => {
    const k = coreKernel('V4-46', pinDefs);
    const keep = k.root('keep', 'fx:cell');
    const loose = k.root('loose', 'fx:cell');
    const rec = rootId(k.worldSeed, 's1');
    k.root('s1', 'core:thing');
    k.retention.setSeed({ id: rec, state: { mentions: loose }, nodes: [keep] });
    expect(k.frames.demandRoots.has(rec)).toBe(false);
    expect(k.retention.rootFrameIds().size).toBe(0);
    expect(k.retention.isRetained(keep)).toBe(true);
    expect(k.retention.isRetained(loose)).toBe(false);
  });
});

describe('V4-47: publish-item', () => {
  const setup = () => {
    const k = coreKernel('V4-47', pinDefs);
    const watcher = k.root('watcher', 'core:person');
    const cell = k.root('cell', 'fx:cell');
    const victim = k.root('victim', 'core:person');
    k.frames.open({ actor: watcher, level: 'situation', origin: watcher, weight: 1, focus: { nodes: [cell], tier: 2 }, own: { reactsTo: [{ kind: 'core:event', slot: '*' }] }, cause });
    const sum = k.summaries.mintSummary({ creator: cause, cause, name: 'sum', kind: 'assault', from: 600, length: W, scope: cell, count: 2 });
    const item = k.summaries.materialise(sum, 0);
    const changes: Change[] = [];
    k.dispatcher.onRelevance((r) => changes.push(r.change));
    const fill = (silent: boolean): ProcessOp[] => [
      { op: 'contribute', target: { slot: 'participants#count', scope: { nodes: [item] } }, form: { f: 'const', value: 1 }, mode: 'constrain', silent },
      { op: 'contribute', target: { slot: 'who', scope: { nodes: [k.address(item, 'participants[0]')] } }, form: { f: 'const', value: victim }, mode: 'constrain', silent },
      { op: 'contribute', target: { slot: 'role', scope: { nodes: [k.address(item, 'participants[0]')] } }, form: { f: 'const', value: 'victim' }, mode: 'constrain', silent },
    ];
    return { k, item, cell, victim, changes, fill };
  };
  const run = (k: Kernel, ops: ProcessOp[], name: string): void => {
    let done = false;
    k.evolution.register({ id: name, tier: 3, period: 1, run: () => { if (done) return []; done = true; return ops; } });
    k.frames.demandRoots.add(k.vId);
  };

  test('the item is announced once as one event change, with the fields its contributions gave', () => {
    const { k, item, victim, changes, fill } = setup();
    k.root('v', 'core:person');
    k.frames.open({ actor: k.vId, level: 'situation', origin: k.vId, weight: 1, focus: { nodes: [item], tier: 3 }, cause });
    run(k, [...fill(true), { op: 'publish-item', item }, { op: 'publish-item', item }], 'open');
    k.tick({ to: 3 * W });
    const evs = changes.filter((c) => c.c === 'event');
    expect(evs.length).toBe(1);
    const ev = evs[0]! as Extract<Change, { c: 'event' }>;
    expect(ev.event).toBe(item);
    expect(ev.kind).toBe('assault');
    expect(ev.participants).toEqual([{ who: victim, role: 'victim' }]);
    // The silent contributions announced nothing of their own.
    expect(changes.filter((c) => c.c === 'contribution').length).toBe(0);
  });

  test('a node that is not a summary item is refused', () => {
    const k = coreKernel('V4-47b', pinDefs);
    const cell = k.root('cell', 'fx:cell');
    expect(() => k.events.publishItem(cell)).toThrow();
  });
});

describe('V4-48: restating a contribution already in effect is a silent no-op', () => {
  test('no new id, no change, no revision', () => {
    const k = coreKernel('V4-48', pinDefs);
    const place = k.root('place', 'fx:cell');
    const spec = {
      source: { layer: 'simulation' as const, origin: 'proc' }, target: { slot: 'n', scope: { nodes: [place] } },
      form: { f: 'const' as const, value: 4 }, mode: 'constrain' as const,
    };
    const c1 = k.contribute(spec);
    const rev = k.revision;
    const pending = k.pending.length;
    const c2 = k.contribute(spec);
    expect(c2.id).toBe(c1.id);
    expect(k.revision).toBe(rev);
    expect(k.pending.length).toBe(pending);
    // After a load the contribution is gone; restating it silently puts it back without a change.
    k.pending.length = 0;
    k.store.removeContribution(c1.id);
    k.contribute({ ...spec, silent: true });
    expect(k.pending.length).toBe(0);
    expect(k.store.contribution(c1.id)).toBeDefined();
  });
});

describe('V4-49: a process\'s last digest is persisted with its state', () => {
  test('reads of it are identical after a load, and a digest in an outstanding batch applies at its boundary', () => {
    const k = worldKernel('V4-49');
    k.evolution.register({ id: 'p', tier: 1, period: 1, run: (_c, kk) => ({ ops: [], state: { kk }, digest: { through: kk, list: [kk, kk + 1] } }) });
    k.tick({ to: 4 * W });
    const rec = k.persistence.save('A');
    const proc = rec.ops.find((o) => o.op === 'ProcessState' && o.state.id === 'p');
    expect(proc).toBeDefined();
    const before = k.evolution.digestOf('p');
    expect(before).toEqual({ through: 3, list: [3, 4] });
    k.tick({ to: 8 * W });
    k.persistence.load('A');
    expect(k.evolution.digestOf<object>('p')).toEqual(before);
    k.tick({ to: 5 * W });
    expect(k.evolution.digestOf<object>('p')).toEqual({ through: 4, list: [4, 5] });
  });
});
