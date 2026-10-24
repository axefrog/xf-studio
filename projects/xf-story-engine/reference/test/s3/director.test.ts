import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { defaultData, quietFrame } from '../../src/procedural/data.ts';
import { Director, counts, threads } from '../../src/procedural/director.ts';
import { aimHolds } from '../../src/procedural/fit.ts';
import { Keys } from '../../src/procedural/keys.ts';
import type { DeliveryView, HookCtx, InstanceView } from '../../src/procedural/types.ts';

const data = defaultData();
const ctx = (at = 0): HookCtx => ({ playClock: at, playTotal: at, jointLatched: false, attention: [] });
function delivery(over: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: H(s('d')),
    seed: H(s('seed')),
    authored: false,
    pull: false,
    submitted: 0,
    maxWaitPlay: 1000,
    timing: {
      kind: 'message',
      class: 2,
      purpose: 'introduce',
      importance: 'normal',
      tolerates: {},
      maxWait: { clock: 'play', s: 1000 },
      intensity: 0.2,
    },
    ...over,
  };
}
test('SF3-1 nested schedule, exact windows and thinning', () => {
  const keys = new Keys(H(s('fixture'), s('SF3-1')));
  let calm = 0,
    steady = 0;
  for (let k = 0; k < 1000; k++) {
    const { time, u } = keys.slot(k, 4500);
    expect(time).toBeGreaterThanOrEqual(k * 4500);
    expect(time).toBeLessThan((k + 1) * 4500);
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(1);
    if (u < 0.3125) {
      calm++;
      expect(u < 0.625).toBe(true);
    }
    if (u < 0.625) steady++;
  }
  expect(Math.abs(calm - 312.5)).toBeLessThan(74);
  expect(Math.abs(steady - 625)).toBeLessThan(77);
});
test('SF3-3 exact pacing transitions and arithmetic', () => {
  const d = new Director(data, () => {}),
    phases: Array<[number, string]> = [];
  for (let at = 0; at <= 215; at++) {
    const before = d.phase;
    d.tick(
      quietFrame(
        at,
        at >= 100 && at < 130
          ? { health: 0.5, downed: true, hostileAware: true, hostileAwareNear: true }
          : { health: at >= 130 ? 0.5 : 1 },
      ),
    );
    if (before !== d.phase) phases.push([at, d.phase]);
    if (at === 100) expect(d.A).toBeCloseTo(0.9, 14);
    if (at === 130) expect(d.A).toBeCloseTo(0.9 * data.pacing.decayA, 14);
  }
  expect(phases).toEqual([
    [90, 'build'],
    [100, 'peak'],
    [140, 'fade'],
    [170, 'rest'],
    [215, 'build'],
  ]);
  expect(d.A).toBeCloseTo(0.1234, 3);
  expect(d.R).toBe(45);
});
test('SF3-4 rest length clamps for short, medium and long episodes', () => {
  for (const [episode, R] of [
    [10, 45],
    [60, 90],
    [200, 180],
  ]) {
    const d = new Director(data, () => {});
    d.tick(quietFrame(0));
    for (let at = 1; at <= episode; at++) d.tick(quietFrame(at, { hostileAwareNear: true }));
    d.tick(quietFrame(episode + 1));
    d.phase = 'fade';
    d.tick(quietFrame(episode + 2));
    expect(String(d.phase)).toBe('rest');
    expect(d.R).toBe(R);
  }
});
test('SF3-5/6 hold priorities, authored relaxation and headroom', () => {
  const d = new Director(data, () => {});
  d.phase = 'rest';
  const base = delivery();
  expect(d.hold(ctx(), base)).toBe('phase-rest');
  expect(d.hold(ctx(), { ...base, pull: true })).toBeUndefined();
  expect(d.hold(ctx(), { ...base, timing: { ...base.timing, class: 0 } })).toBeUndefined();
  expect(d.hold(ctx(), { ...base, timing: { ...base.timing, purpose: 'close' } })).toBeUndefined();
  expect(d.hold(ctx(700), { ...base, authored: true })).toBeUndefined();
  expect(d.hold(ctx(700), base)).toBe('phase-rest');
  d.phase = 'peak';
  expect(d.hold(ctx(), base)).toBe('phase-peak');
  expect(d.hold(ctx(), { ...base, timing: { ...base.timing, intensity: -0.2 } })).toBeUndefined();
  d.phase = 'build';
  d.T = 0.65;
  expect(d.hold(ctx(), { ...base, timing: { ...base.timing, intensity: 0.4 } })).toBe('headroom');
  expect(d.hold(ctx(), base)).toBeUndefined();
});
test('SF3-7 witnessed climax locks and release intensity', () => {
  const d = new Director(data, () => {});
  expect(d.tick(quietFrame(1000), [{ level: 'arc' }])).toBe(true);
  expect(d.noPushUntil).toBe(1300);
  expect(d.noHighUntil).toBe(2200);
  d.phase = 'build';
  expect(d.hold(ctx(1299), delivery())).toBe('climax-rest');
  expect(d.hold(ctx(1300), delivery())).toBeUndefined();
  d.onRelease({ timing: { ...delivery().timing, intensity: 0.8 } });
  expect(d.N).toBe(0.8);
  d.onRelease({ timing: { ...delivery().timing, intensity: 0.8 } });
  expect(d.N).toBe(1);
});
test('SF3-8 lead aim boundaries and relaxation', () => {
  for (const urgency of [0, 0.4, 0.8]) {
    expect(aimHolds({ lead: 'early', urgency }, 0, 1000, false, data)).toBe(false);
    expect(aimHolds({ lead: 'late', urgency }, 0, 1000, false, data)).toBe(urgency < 0.7);
    expect(aimHolds({ lead: 'preferred', urgency }, 299, 1000, true, data)).toBe(urgency < 0.35);
    expect(aimHolds({ lead: 'preferred', urgency }, 300, 1000, true, data)).toBe(false);
  }
  expect(aimHolds({ lead: 'late', urgency: 0 }, 700, 1000, false, data)).toBe(false);
});
test('SF3-9 joints are single occurrences with explicit priority', () => {
  const d = new Director(data, () => {});
  d.tick(quietFrame(0, { moving: true, metresMoved: 150 }));
  for (let i = 1; i <= 3; i++) d.tick(quietFrame(i));
  expect(d.joint(ctx(3))).toBe('arrived');
  expect(d.joint(ctx(3), true)).toBeNull();
  d.tick(quietFrame(4, { jump: 'sleep', questCompleted: true }));
  expect(d.joint(ctx(4), true)).toBe('woke');
  d.tick(quietFrame(5, { questCompleted: true }));
  expect(d.joint(ctx(5), true)).toBe('finished');
  d.tick(quietFrame(6));
  expect(d.joint(ctx(6), true)).toBe('asked');
  d.tick(quietFrame(7, { jump: 'load' }));
  expect(d.joint(ctx(7), true)).toBeNull();
});
test('stim sliding window caps ten frames; health is not lost on first frame', () => {
  const d = new Director(data, () => {});
  d.tick(quietFrame(0, { health: 0.5, stims: 100 }));
  expect(d.A).toBe(0.15);
  for (let i = 1; i < 10; i++) d.tick(quietFrame(i, { health: 0.5, stims: 100 }));
  expect(d.A).toBeLessThan(0.15);
  d.tick(quietFrame(10, { health: 0.5, stims: 100 }));
  expect(d.A).toBeGreaterThan(0.15);
});
test('SF3-10 connected threads, closing-only membership and recency counts', () => {
  const make = (id: string, at?: number): InstanceView => ({
    id,
    template: { id: 't', version: 1 },
    level: 'gig',
    source: { by: 'director', layer: 'procedural' },
    sowSeq: 0,
    state: 'running',
    roles: {},
    beats: [],
    displays: at === undefined ? [] : [{ delivery: id, grade: 'presented', playTotal: at }],
    responses: [],
    draws: {},
    closingPending: false,
  });
  const now = 40000,
    A = make('a', now - 600),
    B = make('b', now - 10800),
    C = make('c', now - 36000),
    D = make('d'),
    E = make('e', now - 3600),
    F = make('f');
  A.source.by = B.source.by = 'pack';
  A.roles = C.roles = { anchor: { cast: 'person', anchor: true, committed: true } };
  B.growsFrom = { parent: 'e' };
  E.state = F.state = 'resolved';
  E.closingPending = true;
  E.beats = [{ key: 'end', kind: 'conclusion', state: 'running' }];
  const ts = threads([F, E, D, C, B, A], now, data);
  expect(ts.map((t) => [t.id, t.status])).toEqual([
    ['a', 'attended'],
    ['b', 'simmering'],
    ['d', 'unseen'],
  ]);
  expect(counts(ts)).toEqual({ A: 2, L: 1, C: 0, S: 1 });
  expect(threads(structuredClone([A, B, C, D, E, F]), now, data)).toEqual(ts);
});
