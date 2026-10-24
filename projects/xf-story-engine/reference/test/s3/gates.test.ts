import { expect, test } from 'bun:test';
import { complete, event, kit, pattern, registry, world, type World } from './helpers.ts';
import { defaultData } from '../../src/procedural/data.ts';

const empty = { A: 0, L: 0, C: 0, S: 0 };
test('SF3-15 Order against kin: effect sets, unless, and the missing initiating effect', () => {
  const p = pattern({
    roles: { '?m': { kind: 'core:person' }, '?x': { kind: 'core:person' } },
    stages: [
      {
        kind: 'order-given',
        who: [
          { role: 'actor', as: '?m' },
          { role: 'target', as: '?x' },
        ],
        effects: [{ on: '?x', effect: 'kill' }],
      },
      {
        kind: { tag: 'act' },
        who: [{ role: 'actor', as: '?m' }],
        effects: [{ on: '?x', effect: ['harm', 'kill', 'protect', 'rescue', 'expose'] }],
      },
    ],
    unless: [{ between: [0, 1], clause: { kind: 'order-withdrawn', who: [{ role: 'target', as: '?m' }] } }],
    once: ['?m', '?x'],
    telling: { form: 'rumour', binds: { subject: '?m', other: '?x' } },
  });
  for (const mode of ['complete', 'killed', 'missing']) {
    const w = world('order-' + mode, { patterns: [p] });
    w.l3.sifter.onEvent(
      p,
      event(w, 'order', 'order-given', 10, { effects: mode === 'missing' ? [] : [{ on: w.b, effect: 'kill' }] }),
    );
    if (mode === 'killed')
      w.l3.sifter.onEvent(
        p,
        event(w, 'withdraw', 'order-withdrawn', 20, { participants: [{ who: w.a, role: 'target' }] }),
      );
    w.l3.sifter.onEvent(p, event(w, 'act', 'act', 30, { effects: [{ on: w.b, effect: 'protect' }] }));
    expect(w.l3.state.pool.some((e) => e.complete)).toBe(mode === 'complete');
    expect(w.l3.state.tombstones.length > 0).toBe(mode !== 'missing');
  }
});
test('SF3-20 contributions and director meta events cannot feed the sifter', () => {
  const w = world('SF3-20');
  complete(w);
  w.k.settle();
  const before = structuredClone(w.l3.state.pool),
    work = w.l3.sifter.work;
  w.k.contribute({
    source: { layer: 'procedural', origin: w.a },
    target: { kind: 'core:person', slot: 'age' },
    form: { f: 'const', value: 25 },
    mode: 'constrain',
  });
  w.k.settle();
  expect(w.l3.state.pool).toEqual(before);
  expect(w.l3.sifter.work).toBe(work);
  expect(
    w.l3
      .installPatterns([pattern({ stages: [{ kind: 'meta:story', who: [{ role: 'actor', as: '?a' }] }] })])
      .some((f) => f.code === 'S3-L-7'),
  ).toBe(true);
});
test('SF3-22 each of ten gates refuses before scoring; a passing twin remains eligible', () => {
  for (let gate = 1; gate <= 10; gate++) {
    const spine = new Set<string>(),
      offer = gate === 5,
      p = pattern({
        ...(offer ? { telling: { form: 'offer' as const, binds: { subject: '?a', other: '?b' } } } : {}),
        ...(gate === 3 ? { stages: [pattern().stages[0], { ...pattern().stages[1], effects: undefined }] } : {}),
      });
    const w = world('gate-' + gate, {
      patterns: [p],
      seeds: [kit({ ...(offer ? { sowable: { serves: ['offer'], firstClass: 0 }, closing: 'pack:closing' } : {}) })],
      s3: { registry: { ...registry, isSpine: (n) => spine.has(n) } },
    });
    if (gate === 3) {
      const first = event(w, 'i', 'insult', 100);
      w.l3.sifter.onEvent(p, first);
      w.l3.sifter.onEvent(p, event(w, 'a', 'assault', 101, { causes: [first.id] }));
      w.l3.flush();
    } else complete(w);
    const e = w.l3.state.pool[0],
      t = w.l2.packs.get('xf.fixture')!.pack.seeds[0];
    switch (gate) {
      case 1:
        w.k.now = e.lastTime + w.l3.data.sifter.candidateTtl + 1;
        break;
      case 2:
        t.sowable = undefined;
        break;
      case 4:
        w.k.store.removeHeader(w.a);
        w.k.store.removeHeader(w.b);
        break;
      case 6:
        (t.sowable as { firstClass: number }).firstClass = 2;
        w.l2.packs.get('xf.fixture')!.fragments.get('rumour')!.channels = ['message'];
        break;
      case 7:
        w.k.settings.set({ storyExclusions: [{ kind: 'tag', value: 'report' }] });
        break;
      case 8:
        (t.sowable as { climactic: boolean }).climactic = true;
        break;
      case 9:
        spine.add(w.a);
        break;
      case 10:
        e.cooldownUntil = 1;
        break;
    }
    expect(w.l3.sower.collect({ ...empty, C: gate === 8 ? 1 : 0 })).toEqual([]);
    expect(
      w.l3.log.some((l) => l.rule === `gate-${gate}`),
      JSON.stringify({ gate, rules: w.l3.log.map((l) => l.rule) }),
    ).toBe(true);
  }
  const good = world('passing-gates');
  complete(good);
  expect(good.l3.sower.collect(empty)).toHaveLength(1);
});
test('SF3-23 a rumour is texture without V-link; an offer requires a met person', () => {
  const w = world('SF3-23', {
    patterns: [pattern({ telling: { form: 'offer', binds: { subject: '?a', other: '?b' } } })],
    seeds: [kit({ sowable: { serves: ['offer'], firstClass: 0 }, closing: 'pack:closing' })],
  });
  complete(w);
  expect(w.l3.sower.collect(empty)).toEqual([]);
  const seen = event(w, 'met', 'act', 0, { witnesses: [w.v] });
  w.k.events.makeCanon(seen.id, 'observed', w.v);
  expect(w.l3.sower.collect(empty)).toHaveLength(1);
});
function due(w: World, k: number) {
  w.k.settings.set({ tempo: 'restless' });
  w.l2.baseTotal = w.l3.keys.slot(k, 4500).time;
  w.l3.state.slots.open.next = k;
  w.l3.sower.resolve(empty);
  w.l3.flush();
}
test('SF3-25 three distinct kits: success on third adds no refusal; three refused slots drop with a tombstone', () => {
  const seeds = [0, 1, 2].map((i) => kit({ id: 'xf.fixture:kit' + i })),
    w = world('three-kits', { seeds });
  complete(w);
  const original = w.l2.sowRequest.bind(w.l2),
    calls: string[] = [];
  w.l2.sowRequest = (req) => {
    calls.push(req.template);
    return calls.length < 3 ? { ok: false, findings: [] } : original(req);
  };
  due(w, 1);
  expect(new Set(calls).size).toBe(3);
  expect(w.l3.state.pool[0].refusals).toBe(0);
  expect(w.l3.state.pending).toHaveLength(1);
  const refused = world('refusal-cap', { seeds });
  complete(refused);
  const entry = refused.l3.state.pool[0];
  refused.l2.sowRequest = () => ({ ok: false, findings: [] });
  for (let n = 1; n <= 3; n++) {
    due(refused, n * 2 - 1);
    if (n < 3) expect(entry.refusals).toBe(n);
  }
  expect(refused.l3.state.pool).toEqual([]);
  expect(refused.l3.state.tombstones).toHaveLength(1);
});
test('SF3-18 tombstone equality and completed-candidate equality need no sweep', () => {
  const w = world('deadline-equalities');
  complete(w);
  const e = w.l3.state.pool[0],
    until = w.l3.state.tombstones[0].until;
  w.l3.sifter.onEvent(pattern(), event(w, 'equal', 'insult', until));
  expect(w.l3.state.pool).toHaveLength(1);
  w.l3.sifter.onEvent(pattern(), event(w, 'after', 'insult', until + 1));
  expect(w.l3.state.pool).toHaveLength(2);
  w.k.now = e.lastTime + w.l3.data.sifter.candidateTtl;
  expect(w.l3.sower.collect(empty)).toHaveLength(1);
  w.k.now++;
  expect(w.l3.sower.collect(empty)).toHaveLength(0);
});
test('SF3-19 default 32/256 limits and completed-only pool refusal', () => {
  const patterns = Array.from({ length: 9 }, (_, i) => pattern({ id: 'p' + i, once: undefined })),
    w = world('default-pool-bounds', { patterns });
  let index = 0;
  for (const p of patterns)
    for (let i = 0; i < (p.id === 'p8' ? 1 : 32); i++) {
      const actor = w.k.root('actor' + index, 'core:person');
      w.l3.sifter.onEvent(
        p,
        event(w, 'entry' + index++, 'insult', i, {
          participants: [
            { who: actor, role: 'actor' },
            { who: w.b, role: 'target' },
          ],
        }),
      );
    }
  expect(w.l3.state.pool).toHaveLength(256);
  expect(w.l3.state.pool.every((e) => e.seq !== 0)).toBe(true);
  expect(patterns.every((p) => w.l3.state.pool.filter((e) => e.pattern === p.id).length <= 32)).toBe(true);
  const data = defaultData();
  data.sifter.poolTotal = data.sifter.poolPerPattern = 2;
  const full = world('complete-pool-full', { data, patterns: [pattern({ once: undefined })] });
  complete(full, 100);
  complete(full, 200);
  complete(full, 300);
  expect(full.l3.state.pool).toHaveLength(2);
  expect(full.l3.state.pool.every((e) => e.complete)).toBe(true);
  expect(full.l3.log.some((l) => l.rule === 'pool-full' && l.data.evicted === undefined)).toBe(true);
});
