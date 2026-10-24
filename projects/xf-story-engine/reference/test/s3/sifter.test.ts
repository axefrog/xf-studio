import { expect, test } from 'bun:test';
import { defaultData } from '../../src/procedural/data.ts';
import { patternFindings, sowableFindings } from '../../src/procedural/lint.ts';
import { world, event, pattern, kit, complete } from './helpers.ts';

test('SF3-13 every pattern load check has an isolated failure and passing twin', () => {
  const w = world('SF3-13'),
    p = pattern();
  expect(patternFindings(p, w.l2, w.l3.kv, w.l3.data)).toEqual([]);
  const bad = [
    pattern({ stages: [{ kind: 'unknown' }] }),
    pattern({ telling: { ...p.telling, binds: { subject: '?missing' } } }),
    pattern({ stages: [] }),
    pattern({ within: 0 }),
    pattern({ stages: [{ kind: 'insult' }] }),
    pattern({ telling: { ...p.telling, kit: 'missing' } }),
    { ...p, keep: 1 },
    pattern({ once: ['?later'], roles: { ...p.roles, '?later': { kind: 'core:person' } } }),
  ];
  bad.forEach((p, i) =>
    expect(patternFindings(p as never, w.l2, w.l3.kv, w.l3.data).some((f) => f.code === `S3-L-${i + 1}`)).toBe(true),
  );
});
test('SF3-14 sowable checks reject bad declarations without removing pack sowing', () => {
  const w = world('SF3-14');
  const bad = [
    kit({ maturity: 'sketch' }),
    kit({ level: 'arc' }),
    kit({ sowable: { serves: ['offer'], firstClass: 0 } }),
    kit({ sowable: { serves: ['rumour'], firstClass: 2 } }),
    kit({ roles: { subject: { kind: 'core:person', identity: w.a } } }),
  ];
  bad.forEach((t, i) => {
    const kv = { ...w.l3.kv, isSpine: (id: string) => id === w.a };
    expect(sowableFindings(t, w.l2, kv, w.l3.data, 'xf.fixture').some((f) => f.code === `S3-K-${i + 1}`)).toBe(true);
  });
});
test('SF3-15/16 completed matches mint inert stories and distinguish incidents', () => {
  const w = world('SF3-15');
  complete(w);
  const first = structuredClone(w.l3.state.pool[0]);
  expect(first.complete).toBe(true);
  expect(first.stages).toHaveLength(2);
  expect(w.l3.state.tombstones[0].until).toBe(1301);
  const story = w.l3.kv.event(first.story!)!;
  expect(story.creator).toBe(w.l3.keys.director);
  expect(story.effects).toEqual([]);
  expect(story.witnesses).toEqual([]);
  expect(story.causes).toEqual(first.stages.map((s) => s.event));
  complete(w, 200);
  expect(w.l3.state.pool).toHaveLength(1);
  complete(w, 1400);
  expect(w.l3.state.pool).toHaveLength(2);
  expect(w.l3.state.pool[1].id).not.toBe(first.id);
  expect(w.l3.state.pool[1].story).not.toBe(first.story);
});
test('SF3-15 unless kills before advancement and writes a tombstone', () => {
  const w = world('unless'),
    p = pattern();
  w.l3.sifter.onEvent(p, event(w, 'i', 'insult', 100));
  w.l3.sifter.onEvent(p, event(w, 'ap', 'apology', 110));
  expect(w.l3.state.pool).toHaveLength(0);
  expect(w.l3.state.tombstones[0].until).toBe(1310);
});
test('SF3-17 one emission never advances twice and two patterns do not collapse', () => {
  const p = pattern({
    stages: [
      { kind: 'insult', who: [{ role: 'actor', as: '?a' }] },
      { kind: 'insult', who: [{ role: 'actor', as: '?a' }] },
    ],
    once: undefined,
    telling: { form: 'rumour', binds: { subject: '?a' } },
  });
  const w = world('SF3-17', { patterns: [p, { ...p, id: 'other' }] });
  const first = event(w, 'one', 'insult', 10);
  w.k.settle({ to: 600 });
  expect(w.l3.state.pool).toHaveLength(2);
  expect(w.l3.state.pool.every((e) => e.stages.length === 1)).toBe(true);
  const work = w.l3.sifter.work;
  for (const p of w.l3.sifter.patterns.values()) w.l3.sifter.onEvent(p, first);
  expect(w.l3.state.pool.every((e) => e.stages.length === 1)).toBe(true);
  expect(w.l3.sifter.work - work).toBe(4);
  event(w, 'two', 'insult', 610);
  w.k.settle({ to: 1200 });
  expect(w.l3.state.pool.filter((e) => e.complete)).toHaveLength(2);
});
test('SF3-18 deadlines are checked on use, including equality without a sweep', () => {
  for (const dt of [600, 601]) {
    const w = world('deadline' + dt),
      p = pattern();
    const a = event(w, 'a', 'insult', 100);
    w.l3.sifter.onEvent(p, a);
    w.l3.sifter.onEvent(
      p,
      event(w, 'b', 'assault', 100 + dt, { effects: [{ on: w.b, effect: 'harm' }], causes: [a.id] }),
    );
    expect(w.l3.state.pool.some((e) => e.complete)).toBe(dt === 600);
    if (dt === 601) expect(w.l3.state.tombstones[0].until).toBe(1900);
  }
});
test('SF3-19 bounded pool evicts oldest incomplete; completed entries are not victims', () => {
  const data = defaultData();
  data.sifter.poolPerPattern = 2;
  data.sifter.poolTotal = 2;
  const w = world('SF3-19', { data, patterns: [pattern({ once: undefined })] }),
    p = pattern({ once: undefined });
  complete(w);
  const original = w.l3.state.pool[0].id;
  for (let n = 0; n < 3; n++) {
    const node = w.k.root('new' + n, 'core:person');
    w.l3.sifter.onEvent(
      p,
      event(w, 'open' + n, 'insult', 200 + n, {
        participants: [
          { who: node, role: 'actor' },
          { who: w.b, role: 'target' },
        ],
      }),
    );
  }
  expect(w.l3.state.pool).toHaveLength(2);
  expect(w.l3.state.pool[0].id).toBe(original);
  expect(w.l3.log.filter((l) => l.rule === 'pool-full')).toHaveLength(2);
});
test('SF3-21 pool and buffer evidence are retained and reconstructed silently after load', () => {
  const w = world('SF3-21'),
    p = pattern(),
    first = event(w, 'i', 'insult', 100);
  w.l3.sifter.onEvent(p, first);
  w.l3.flush();
  const before = structuredClone(w.l3.state);
  w.k.persistence.save('pool');
  w.k.persistence.load('pool', { now: () => w.k.now, readMirrored: () => [] });
  expect(w.l3.state).toEqual(before);
  expect(w.l3.kv.event(first.id)?.participants).toEqual(first.participants);
  expect(w.k.dispatcher.drain().filter((r) => r.change.c === 'event')).toEqual([]);
  w.l3.sifter.onEvent(
    p,
    event(w, 'last', 'assault', 200, { effects: [{ on: w.b, effect: 'harm' }], causes: [first.id] }),
  );
  expect(w.l3.state.pool[0].complete).toBe(true);
});
test('SF3-38 chronological buffer reorders out-of-order publication and survives a save', () => {
  const w = world('SF3-38');
  w.k.evolution.register({ id: 'delayed', tier: 0, period: 1, lag: 1, run: () => [] });
  const first = event(w, 'late', 'insult', 100),
    last = event(w, 'early', 'assault', 200, { effects: [{ on: w.b, effect: 'harm' }], causes: [first.id] });
  const st = w.l3.state;
  st.buffer = [
    { pattern: pattern().id, version: 1, event: last },
    { pattern: pattern().id, version: 1, event: first },
  ];
  w.l3.flush();
  w.k.persistence.save('buffer');
  w.k.persistence.load('buffer', { now: () => w.k.now, readMirrored: () => [] });
  expect(w.l3.state.buffer).toHaveLength(2);
  w.k.settle({ to: 600 });
  expect(w.l3.state.pool).toHaveLength(0);
  w.k.settle({ to: 1200 });
  expect(w.l3.state.pool[0].complete).toBe(true);
  expect(w.l3.state.pool[0].stages.map((s) => s.event)).toEqual([first.id, last.id]);
});
