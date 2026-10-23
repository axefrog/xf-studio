import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Relevance } from '../src/relevance.ts';
import type { Id } from '../src/types.ts';
import { Budget } from '../src/work.ts';
import { coreKernel, defsOf, dim, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));
const fid = (name: string): Id => H(s('origin'), s(name));

const weatherDefs = defsOf(
  [dim('fx:wx', { t: 'enum', values: ['clear', 'drizzle', 'downpour', 'fog'] }, { buckets: { name: 'bucket-map', version: 1, params: { map: { drizzle: 'rain', downpour: 'rain', clear: 'dry', fog: 'dry' } } } })],
  [kind('fx:weather', [slot('weather', 'fx:wx', { mode: 'mirrored' })], { extends: ['core:thing'] })],
);

function run(k: Kernel): Relevance[] {
  k.settle();
  return k.dispatcher.drain();
}

describe('C-a to C-d relevance calibration (spec 10.5, 16.2)', () => {
  test('C-a: a bucket match on a reading gives r = 0.5 x 0.6 x 0.3 = 0.09, above theta_react', () => {
    const k = coreKernel('C-a', weatherDefs);
    const ped = k.root('ped', 'core:person');
    const w = k.mirrored('weather', 'fx:weather');
    const drive = k.frames.open({ actor: ped, level: 'drive', origin: fid('comfort'), payload: { drive: 'comfort' }, weight: 0.5, cause });
    const sit = k.frames.open({
      actor: ped, level: 'situation', origin: fid('comfort'), weight: 1, parents: [{ frame: drive.id, weight: 1 }],
      own: { reactsTo: [{ slot: '*', where: [{ path: 'weather:bucket', op: 'in', arg: ['rain'] }] }] }, cause,
    });
    k.settle();
    k.dispatcher.drain();
    k.now = 1000;
    k.reading(w, 'weather', 'clear', 900);
    expect(run(k)).toHaveLength(0);
    k.reading(w, 'weather', 'downpour', 1000);
    const out = run(k);
    expect(out).toHaveLength(1);
    expect(out[0]!.r).toBeCloseTo(0.09, 12);
    expect(out[0]).toMatchObject({ actor: ped, frame: sit.id, type: 'reactsTo' });
    expect(out[0]!.r).toBeGreaterThanOrEqual(k.config.thetaReact);
  });

  /** The vendor's world: stall, a Tyger Claw collector, a customer, a friend of V. */
  function vendorWorld(name: string) {
    const k = coreKernel(name, weatherDefs);
    const vendor = k.root('vendor', 'core:person');
    const stall = k.root('stall', 'core:place');
    const elsewhere = k.root('elsewhere', 'core:place');
    const claws = k.root('tyger-claws', 'core:group');
    const collector = k.root('collector', 'core:person');
    const customer = k.root('customer', 'core:person');
    const v = k.root('v', 'core:person');
    const friend = k.root('friend', 'core:person');
    k.frames.demandRoots.add(v);
    k.addEdge({ type: 'core:member-of', from: collector, to: claws, attrs: { role: 'member', strength: 0.75 }, cause });
    const money = k.frames.open({ actor: vendor, level: 'drive', origin: fid('money'), payload: { drive: 'money' }, weight: 0.8, cause });
    const concern = k.frames.open({
      actor: vendor, level: 'concern', origin: fid('protection-payment'), weight: 0.9, parents: [{ frame: money.id, weight: 1 }],
      own: {
        threatenedBy: [
          { kind: 'core:person', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'collector' }, { path: '', op: 'has-edge', arg: { edge: 'core:member-of', to: claws } }] },
          { kind: 'core:place', slot: '*', scope: { nodes: [stall] }, where: [{ path: '@role', op: 'eq', arg: 'place' }] },
        ],
      },
      cause,
    });
    const work = k.frames.open({
      actor: vendor, level: 'concern', origin: fid('work'), weight: 0.6,
      own: { wants: [{ kind: 'core:person', slot: '*', where: [{ path: '@role', op: 'eq', arg: 'customer' }] }] }, cause,
    });
    const vFrame = k.frames.open({
      actor: v, level: 'concern', origin: fid('friend'), weight: 1,
      own: { protects: [{ slot: '*', scope: { nodes: [friend] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] }, cause,
    });
    k.settle();
    k.dispatcher.drain();
    return { k, vendor, stall, elsewhere, collector, customer, v, friend, concern, work, vFrame, money };
  }

  test('C-b: the stall binding gives 0.72 and the collector binding 0.36; the greatest is emitted', () => {
    const w = vendorWorld('C-b');
    w.k.events.mintEvent({
      creator: w.vendor, cause, name: 'e1', time: 10, kind: 'robbery', place: w.stall,
      participants: [{ who: w.collector, role: 'collector' }],
    });
    const out = run(w.k).filter((r) => r.actor === w.vendor && r.type === 'threatenedBy');
    expect(out).toHaveLength(1);
    expect(out[0]!.r).toBeCloseTo(0.72, 12);
    expect(out[0]!.frame).toBe(w.concern.id);

    w.k.events.mintEvent({
      creator: w.vendor, cause, name: 'e2', time: 20, kind: 'robbery', place: w.elsewhere,
      participants: [{ who: w.collector, role: 'collector' }],
    });
    const out2 = run(w.k).filter((r) => r.actor === w.vendor && r.type === 'threatenedBy');
    expect(out2).toHaveLength(1);
    expect(out2[0]!.r).toBeCloseTo(0.36, 12);
    expect(out2[0]!.r).toBeGreaterThanOrEqual(w.k.config.thetaReact);
    expect(out2[0]!.r).toBeLessThan(out[0]!.r);
  });

  test('C-c: a customer arrives; r = 0.6 x 1.0 x 0.5 = 0.30', () => {
    const w = vendorWorld('C-c');
    w.k.events.mintEvent({
      creator: w.vendor, cause, name: 'sale', time: 10, kind: 'arrival', place: w.stall,
      participants: [{ who: w.customer, role: 'customer' }],
    });
    const out = run(w.k).filter((r) => r.type === 'wants');
    expect(out).toHaveLength(1);
    expect(out[0]!.r).toBeCloseTo(0.3, 12);
    expect(out[0]!.frame).toBe(w.work.id);
  });

  test('C-d: harm to V\'s friend gives r = 1.0, the greatest of all', () => {
    const w = vendorWorld('C-d');
    w.k.events.mintEvent({
      creator: w.vendor, cause, name: 'attack', time: 10, kind: 'assault', place: w.stall,
      participants: [{ who: w.collector, role: 'collector' }, { who: w.customer, role: 'customer' }],
      effects: [{ on: w.friend, effect: 'harm' }],
    });
    const out = run(w.k);
    const protects = out.filter((r) => r.type === 'protects');
    expect(protects).toHaveLength(1);
    expect(protects[0]!.r).toBe(1);
    expect(protects[0]!.actor).toBe(w.v);
    const others = out.filter((r) => r.type !== 'protects');
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(o.r).toBeLessThan(1);
    // Demand roots come first in the emission order.
    expect(out[0]!.actor).toBe(w.v);
  });

  test('an event whose participant lacks the membership does not match the collector interest', () => {
    const w = vendorWorld('C-b2');
    w.k.events.mintEvent({
      creator: w.vendor, cause, name: 'e3', time: 10, kind: 'robbery', place: w.elsewhere,
      participants: [{ who: w.customer, role: 'collector' }],
    });
    expect(run(w.k).filter((r) => r.type === 'threatenedBy')).toHaveLength(0);
  });
});

describe('delivery to descendants (spec 10.5)', () => {
  test('a match is delivered to the declaring frame and each eligible descendant, scored through f', () => {
    const k = coreKernel('delivery', weatherDefs);
    const a = k.root('a', 'core:person');
    const target = k.root('t', 'core:person');
    const root = k.frames.open({
      actor: a, level: 'concern', origin: fid('r'), weight: 0.8,
      own: { wants: [{ kind: 'core:person', slot: '*', scope: { nodes: [target] } }] }, cause,
    });
    const child = k.frames.open({ actor: a, level: 'goal', origin: fid('c'), weight: 0.5, parents: [{ frame: root.id, weight: 0.5 }], cause });
    const grand = k.frames.open({ actor: a, level: 'step', origin: fid('g'), weight: 0.5, parents: [{ frame: child.id, weight: 1 }], cause });
    const done = k.frames.open({ actor: a, level: 'step', origin: fid('d'), weight: 0.9, parents: [{ frame: root.id, weight: 1 }], status: 'satisfied', cause });
    const other = k.frames.open({ actor: a, level: 'step', origin: fid('o'), weight: 1, cause });
    k.settle();
    k.dispatcher.drain();
    k.mint(a, cause, 'noise', 'core:person');
    k.pending.length = 0;
    k.pin({ node: target, slot: 'age', value: 40, reason: 'observed', cause });
    const out = run(k).filter((r) => r.type === 'wants');
    const byFrame = new Map(out.map((r) => [r.frame, r.r]));
    expect(byFrame.get(root.id)).toBeCloseTo(0.8 * 1 * 1, 12);
    expect(byFrame.get(child.id)).toBeCloseTo(0.5 * (0.5 * 0.8), 12);
    expect(byFrame.get(grand.id)).toBeCloseTo(0.5 * (1 * (0.5 * (0.5 * 0.8))), 12);
    expect(byFrame.has(done.id)).toBe(false);
    expect(byFrame.has(other.id)).toBe(false);
    expect(out.length).toBe(3);
  });

  test('pullVia counts only paths through f: a second parent that does not reach f is ignored', () => {
    const k = coreKernel('pullvia', weatherDefs);
    const a = k.root('a', 'core:person');
    const f = k.frames.open({ actor: a, level: 'concern', origin: fid('f'), weight: 0.5, cause });
    const big = k.frames.open({ actor: a, level: 'concern', origin: fid('big'), weight: 1, cause });
    const d = k.frames.open({ actor: a, level: 'goal', origin: fid('d'), weight: 1, parents: [{ frame: f.id, weight: 1 }, { frame: big.id, weight: 1 }], cause });
    expect(k.frames.pull(d.id)).toBe(1);
    expect(k.frames.pullVia(d.id, f.id)).toBe(0.5);
    expect(k.frames.pullVia(d.id, big.id)).toBe(1);
  });

  test('influence from one origin counts once, through its strongest path', () => {
    const k = coreKernel('strongest', weatherDefs);
    const a = k.root('a', 'core:person');
    const top = k.frames.open({ actor: a, level: 'drive', origin: fid('top'), weight: 1, cause });
    const left = k.frames.open({ actor: a, level: 'concern', origin: fid('l'), weight: 1, parents: [{ frame: top.id, weight: 0.2 }], cause });
    const right = k.frames.open({ actor: a, level: 'concern', origin: fid('r'), weight: 1, parents: [{ frame: top.id, weight: 0.6 }], cause });
    const bottom = k.frames.open({ actor: a, level: 'goal', origin: fid('b'), weight: 1, parents: [{ frame: left.id, weight: 1 }, { frame: right.id, weight: 1 }], cause });
    expect(k.frames.pull(bottom.id)).toBe(0.6);
  });
});

describe('dispatch is a budgeted, resumable worklist (spec 10.7, I-10)', () => {
  function crowd() {
    const k = coreKernel('budget', weatherDefs);
    const a = k.root('a', 'core:person');
    const t = k.root('t', 'core:person');
    for (let n = 0; n < 6; n++) {
      k.frames.open({ actor: a, level: 'concern', origin: fid(`c${n}`), weight: 0.9, own: { wants: [{ kind: 'core:person', slot: '*', scope: { nodes: [t] } }] }, cause });
    }
    k.settle();
    k.dispatcher.drain();
    return { k, t };
  }

  test('a small budget resumes where it stopped and ends with the same emissions as an unlimited one', () => {
    const slow = crowd();
    slow.k.pin({ node: slow.t, slot: 'age', value: 30, reason: 'observed', cause });
    const stepsPerTick: number[] = [];
    let guard = 0;
    for (;;) {
      slow.k.frames.runWorklist(new Budget(1000));
      stepsPerTick.push(slow.k.dispatcher.run(new Budget(2)));
      if (slow.k.dispatcher.idle || ++guard > 50) break;
    }
    expect(stepsPerTick.filter((n) => n > 0).length).toBeGreaterThan(1);
    const fast = crowd();
    fast.k.pin({ node: fast.t, slot: 'age', value: 30, reason: 'observed', cause });
    fast.k.settle();
    const norm = (rs: Relevance[]) => rs.map((r) => [r.type, r.r, r.change.c]);
    expect(norm(slow.k.dispatcher.drain())).toEqual(norm(fast.k.dispatcher.drain()));
  });

  test('dispatch waits until the frame worklist is empty', () => {
    const { k, t } = crowd();
    k.pin({ node: t, slot: 'age', value: 30, reason: 'observed', cause });
    const a = k.root('a', 'core:person');
    k.frames.open({ actor: a, level: 'goal', origin: fid('late'), weight: 1, cause });
    expect(k.frames.worklist.isEmpty).toBe(false);
    expect(k.dispatcher.run(new Budget(1000))).toBe(0);
    expect(k.pending.length).toBeGreaterThan(0);
    k.frames.runWorklist(new Budget(1000));
    expect(k.dispatcher.run(new Budget(1000))).toBeGreaterThan(0);
  });

  test('a stale-epoch change is dropped, and resolution and cache fills emit nothing (I-13)', () => {
    const { k, t } = crowd();
    k.value(t, 'age');
    k.value(t, 'name');
    k.query({ find: 'core:person', scope: { nodes: [t] }, at: 0, must: [], limit: 'all' });
    expect(k.pending).toHaveLength(0);
    k.pin({ node: t, slot: 'age', value: 30, reason: 'observed', cause });
    k.newEpoch();
    k.settle();
    expect(k.dispatcher.drain()).toHaveLength(0);
  });
});
