import { expect, test } from 'bun:test';
import { auditState } from '../../src/procedural/audit.ts';
import { defaultData, quietFrame } from '../../src/procedural/data.ts';
import { Director } from '../../src/procedural/director.ts';
import { world, event, pattern, complete } from './helpers.ts';
import { H, s } from '../../src/id.ts';

function rng(seed: number) {
  let n = seed;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
test('S3-I-1/5/13/18/19/22 generated incidents are deterministic under reloads and arbitrary sweeps', () => {
  const run = (reload: boolean, sweeps: boolean) => {
    const data = defaultData();
    data.sifter.candidateTtl = 900;
    data.sifter.poolPerPattern = data.sifter.poolTotal = 2;
    const p = pattern({ once: undefined }),
      w = world('generated-incidents', { patterns: [p], data });
    const random = rng(2718);
    const admissions: string[] = [];
    let sawExpiry = false;
    for (let i = 0; i < 50; i++) {
      const at = i * 800;
      w.k.now = at;
      const a = event(w, 'insult' + i, 'insult', at);
      w.l3.sifter.onEvent(p, a);
      if (w.l3.state.pool.some((e) => e.stages[0].event === a.id)) admissions.push(a.id);
      if (random() < 0.5) w.l3.sifter.onEvent(p, a);
      w.l3.flush();
      if (reload && i % 7 === 0) {
        const key = 'generated-' + i;
        w.k.persistence.save(key);
        w.k.persistence.load(key);
      }
      const b = event(w, 'assault' + i, 'assault', at + (random() < 0.75 ? 600 : 601), {
        causes: [a.id],
        effects: [{ on: w.b, effect: 'harm' }],
      });
      w.k.now = b.time;
      w.l3.sifter.onEvent(p, b);
      // Sweeps use the same game time at use; neither branch relies on sweeping for eligibility.
      w.k.now = at + 700;
      if (sweeps) w.l3.sifter.sweep(w.k.now);
      sawExpiry ||= w.l3.log.some((e) => e.rule === 'match-expired');
      w.l3.flush();
      expect(auditState(w.l3)).toEqual([]);
    }
    expect(w.k.now).toBeGreaterThan(data.sifter.candidateTtl);
    expect(sawExpiry).toBe(true);
    w.l3.sifter.sweep(w.k.now); // Compare reclaimed storage only after comparing admission decisions.
    return { admissions, pool: w.l3.state.pool
      .filter((e) => e.complete)
      .map((e) => ({ id: e.id, key: w.l3.keys.candidate(e.id, e.stages.length - 1), story: e.story })) };
  };
  expect(run(true, true)).toEqual(run(false, true));
  expect(run(false, false)).toEqual(run(false, true));
});
test('S3-I-7 arbitrary tempo walks always thin the same slot schedule', () => {
  const w = world('tempo-walk'),
    random = rng(42);
  w.l3.data.schedule.gentleFirst = 0;
  const tempos = ['off', 'calm', 'steady', 'restless'] as const;
  const resolve = (k: number, tempo: typeof tempos[number]) => {
    const slot = w.l3.keys.slot(k, 4500);
    w.k.settings.set({ tempo });
    w.l2.baseTotal = slot.time;
    w.l3.state.slots.open.next = k;
    w.l3.sower.resolve({ A: 0, L: 0, C: 0, S: 0 });
    expect(w.l3.state.slots.open.next).toBe(k + 1);
    expect(w.l3.keys.slot(k, 4500)).toEqual(slot);
    const rule = w.l3.log.at(-1)?.rule;
    expect(rule).toBe(slot.u < w.l3.data.schedule.theta[tempo] ? 'slot-empty' : 'slot-passed');
    return rule === 'slot-empty';
  };
  for (let k = 0; k < 128; k++) {
    const chosen = tempos[Math.floor(random() * tempos.length)];
    const walked = resolve(k, chosen), live = tempos.map((tempo) => resolve(k, tempo));
    expect(walked).toBe(live[tempos.indexOf(chosen)]);
    expect(live[0]).toBe(false);
    expect(live[3]).toBe(true);
    expect(!live[1] || live[2]).toBe(true);
  }
});
test('S3-I-3/5 phase arithmetic stays bounded under generated senses and release inputs', () => {
  const random = rng(34),
    d = new Director(defaultData(), () => {});
  for (let at = 0; at < 1000; at++) {
    d.tick(
      quietFrame(at, {
        health: random(),
        stims: Math.floor(random() * 20),
        hostileAwareNear: random() < 0.2,
        heatStage: Math.floor(random() * 6),
      }),
    );
    expect(d.A).toBeGreaterThanOrEqual(0);
    expect(d.A).toBeLessThanOrEqual(1);
    expect(d.N).toBeGreaterThanOrEqual(-1);
    expect(d.N).toBeLessThanOrEqual(1);
    expect(d.T).toBe(Math.max(d.A, d.N));
  }
});
test('S3-I-8/17 a declined or compacted decision index prevents another sow of the same occurrence', () => {
  const w = world('declined-occurrence');
  complete(w);
  const e = w.l3.state.pool[0],
    decision = w.l3.keys.decision(w.l3.keys.candidate(e.id, 1));
  w.l2.global.sownBy[decision] = [H(s('retired-instance'))];
  expect(w.l3.sower.collect({ A: 0, L: 0, C: 0, S: 0 })).toEqual([]);
  expect(w.l3.log.at(-1)?.rule).toBe('gate-10');
});
test('S3-I-9 bounded rings and pools under repeated independent incidents', () => {
  const data = defaultData();
  data.sifter.poolPerPattern = 3;
  data.sifter.poolTotal = 3;
  const w = world('bounds', { data, patterns: [pattern({ once: undefined })] }),
    p = pattern({ once: undefined });
  for (let i = 0; i < 50; i++) {
    const actor = w.k.root('actor' + i, 'core:person');
    w.l3.sifter.onEvent(
      p,
      event(w, 'new' + i, 'insult', i, {
        participants: [
          { who: actor, role: 'actor' },
          { who: w.b, role: 'target' },
        ],
      }),
    );
    w.l3.flush();
    expect(auditState(w.l3)).toEqual([]);
  }
  expect(w.l3.state.pool).toHaveLength(3);
});
