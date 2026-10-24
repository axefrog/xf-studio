import { expect, test } from 'bun:test';
import { quietFrame } from '../../src/procedural/data.ts';
import { world, complete, pattern, event, kit, type World } from './helpers.ts';

function transfer(w: World, name: string, key: string): World {
  const fresh = world(name);
  for (const [k, v] of w.k.persistence.chain) fresh.k.persistence.chain.set(k, structuredClone(v));
  fresh.k.newEpoch();
  fresh.k.persistence.load(key);
  return fresh;
}
for (const [name, k] of [
  ['SF3-27', 1],
  ['SF3-27-edge', 836],
] as const)
  test(`${name} fresh reload just before a due slot preserves the complete sow`, () => {
    const prepare = () => {
      const w = world(name);
      w.k.settings.set({ tempo: 'restless' });
      complete(w);
      const slot = w.l3.keys.slot(k, 4500);
      if (k === 836) expect(slot.time % 4500).toBe(4498);
      w.l2.baseTotal = slot.time - 1;
      w.l3.state.slots.open.next = k;
      w.l3.advancePlay(0);
      return w;
    };
    const plain = prepare();
    plain.l3.advancePlay(1);
    const saved = prepare();
    saved.k.persistence.save('before-slot');
    const loaded = transfer(saved, name, 'before-slot');
    loaded.l3.advancePlay(1);
    expect(loaded.l3.state).toEqual(plain.l3.state);
    expect(loaded.l2.all().map((i) => i.st.source)).toEqual(plain.l2.all().map((i) => i.st.source));
    expect(loaded.l2.all().map((i) => i.id)).toEqual(plain.l2.all().map((i) => i.id));
    expect(loaded.l3.director.phase).toBe('settling');
    expect(loaded.l3.log.some((l) => l.rule === 'slot-lapsed')).toBe(false);
  });
test('SF3-28 saves inside a tick or an open sow transaction are refused', () => {
  const w = world('save-boundary');
  expect(() => w.l3.advancePlay(0, quietFrame, () => w.k.persistence.save('mid-tick'))).toThrow('tick boundary');
  const batch = w.k.stage();
  expect(() => batch.write(() => w.k.persistence.save('mid-sow'))).toThrow('staged batch');
  batch.discard();
  expect(w.k.persistence.chain.size).toBe(0);
});
test('SF3-21 save/load between every pair of stages preserves event facts and occurrence IDs', () => {
  const p = pattern({
    stages: [pattern().stages[0], { kind: 'act', who: [{ role: 'actor', as: '?a' }] }, pattern().stages[1]],
  });
  const run = (crash: number) => {
    const w = world('multi-stage', { patterns: [p] });
    let first = '';
    for (let i = 0; i < 3; i++) {
      const e =
        i === 0
          ? event(w, 'first', 'insult', 100)
          : i === 1
            ? event(w, 'middle', 'act', 200)
            : event(w, 'last', 'assault', 300, { effects: [{ on: w.b, effect: 'harm' }], causes: [first] });
      if (i === 0) first = e.id;
      w.l3.sifter.onEvent(p, e);
      w.l3.flush();
      if (i === crash) {
        w.k.persistence.save('stage');
        w.k.persistence.load('stage');
      }
    }
    return w.l3.state;
  };
  const baseline = run(-1);
  for (let crash = 0; crash < 3; crash++) expect(run(crash)).toEqual(baseline);
});
test('buffer retention preserves people and transitive non-canon causes across forgetting', () => {
  const w = world('retained-closure'),
    cause = event(w, 'cause', 'act', 1),
    first = event(w, 'first', 'insult', 100, { causes: [cause.id] });
  w.l3.sifter.onEvent(pattern(), first);
  w.l3.flush();
  const roots = w.k.retention.seeds.get(w.l3.keys.record)!.nodes;
  expect(roots).toEqual([first.id]);
  const marked = w.k.retention.marked();
  expect(marked.has(cause.id)).toBe(true);
  expect(marked.has(w.a)).toBe(true);
  w.k.retention.scheduleSweep();
  w.k.settle();
  expect(w.l3.kv.event(cause.id)?.kind).toBe('act');
});
test('summary item reconstruction preserves the live descriptor dependency', () => {
  const w = world('summary-evidence'),
    summary = w.k.summaries.mintSummary({
      creator: w.a,
      cause: w.a,
      name: 'summary',
      kind: 'insult',
      from: 0,
      length: 600,
      scope: w.city,
      count: 1,
    });
  const item = w.k.summaries.materialise(summary, 0),
    h = w.k.store.header(item)!;
  expect(h.origin.by).toBe('minted');
  if (h.origin.by !== 'minted') throw new Error('item origin');
  const time = w.k.value(item, 'time') as number;
  w.k.events.restoreEvent(
    {
      creator: h.origin.creator,
      cause: h.origin.cause,
      name: h.origin.name,
      time,
      kind: 'insult',
      participants: [
        { who: w.a, role: 'actor' },
        { who: w.b, role: 'target' },
      ],
    },
    { descriptor: summary, materialisation: 'scene.acts' },
  );
  const first = w.l3.kv.event(item)!;
  w.l3.sifter.onEvent(pattern(), first);
  w.l3.flush();
  w.k.persistence.save('summary');
  w.k.persistence.load('summary');
  expect(w.l3.kv.event(item)?.participants).toEqual(first.participants);
  w.k.pin({ node: summary, slot: 'from', value: 600, reason: 'observed', cause: w.b });
  expect(w.k.value(item, 'time')).toBe(time + 600);
});
test('SF3-7 a real witnessed arc outcome sets a persisted opening lock', () => {
  const w = world('arc-lock', { patterns: [], seeds: [kit({ level: 'arc', sowable: undefined })] });
  w.k.settings.set({ tempo: 'off' });
  expect(w.l2.sow('xf.fixture', 'xf.fixture:rumour-kit').ok).toBe(true);
  w.k.settle();
  w.l2.arbiter.session = 'normal';
  w.l3.advancePlay(100);
  const inst = w.l2.all()[0],
    d = inst.st.deliveries.find((d) => d.state === 'released')!;
  expect(d).toBeDefined();
  w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: 100 });
  w.l2.contentCompleted(d.id);
  w.k.settle();
  expect(inst.st.closed?.witnessed).toBe(true);
  w.l3.advancePlay(101);
  expect(w.l3.state.openLockUntil).toBe(1301);
  expect(w.l3.director.noPushUntil).toBe(401);
  w.k.persistence.save('arc');
  w.k.persistence.load('arc');
  expect(w.l3.state.openLockUntil).toBe(1301);
  expect(w.l3.director.noPushUntil).toBe(0);
});
test('small kernel tick budgets resume chronological sift work without changing the saved pool', () => {
  const run = (budget: number) => {
    const w = world('sift-budget');
    for (let i = 0; i < 8; i++) {
      const actor = w.k.root('actor' + i, 'core:person');
      event(w, 'insult' + i, 'insult', 0, {
        participants: [
          { who: actor, role: 'actor' },
          { who: w.b, role: 'target' },
        ],
      });
    }
    w.k.settle({ to: 600, budget });
    w.l3.flush();
    return w.l3.state;
  };
  expect(run(1)).toEqual(run(100000));
});
test('S3 tick sees S2 play-clock wakeups at the due second, before its slot is resolved', () => {
  const w = world('play-wakeup-order', {
    patterns: [],
    seeds: [
      kit({
        windows: [
          { id: 'w', opens: { since: { state: 'sown' }, atLeast: { clock: 'play', s: 1 } }, onClose: 'withdraw' },
        ],
      }),
    ],
  });
  expect(w.l2.sow('xf.fixture', 'xf.fixture:rumour-kit').ok).toBe(true);
  w.k.settle();
  const inst = w.l2.all()[0],
    states: Array<[number, string]> = [],
    tick = w.l3.tick.bind(w.l3);
  w.l3.tick = (frame) => {
    states.push([w.l2.arbiter.play, inst.st.state]);
    tick(frame);
  };
  w.l3.advancePlay(1);
  expect(states).toContainEqual([0, 'waiting']);
  expect(states).toContainEqual([1, 'cast']);
});
