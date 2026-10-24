import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { defaultData } from '../../src/procedural/data.ts';
import { patternFindings, sowableFindings } from '../../src/procedural/lint.ts';
import { castRole } from '../../src/seeding/cast.ts';
import { bound } from '../../src/seeding/doc.ts';
import { complete, event, kit, pattern, registry, world, type World } from './helpers.ts';
import type { Seed } from '../../src/seeding/types.ts';

const empty = { A: 0, L: 0, C: 0, S: 0 };
function sow(w: World): void {
  w.k.settings.set({ tempo: 'restless' });
  w.l2.baseTotal = w.l3.keys.slot(1, 4500).time;
  w.l3.state.slots.open.next = 1;
  w.l3.sower.resolve(empty);
  w.k.settle();
}
function reload(w: World, fresh: World, key: string): World {
  w.k.persistence.save(key);
  for (const [id, record] of w.k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(record));
  fresh.k.newEpoch();
  fresh.k.persistence.load(key);
  return fresh;
}

test('S3-01: handed-over story facts survive fresh reloads until the last S2 consumer ends', () => {
  const name = 'review-hand-over',
    p = pattern({ telling: { form: 'recap', binds: { subject: '?a', other: '?b', story: '?story' } } }),
    t = kit({ roles: { ...kit().roles, story: { kind: 'core:event', must: [{ path: 'kind', op: 'eq', arg: 'meta:story' }], onUnfilled: ['wait'] } } }),
    create = () => world(name, { patterns: [p], seeds: [t] });
  let w = create();
  const cause = event(w, 'earlier', 'act', 50),
    first = event(w, 'first', 'insult', 100, { causes: [cause.id] }),
    last = event(w, 'last', 'assault', 101, { causes: [first.id], effects: [{ on: w.b, effect: 'harm' }] });
  w.l3.sifter.onEvent(p, first);
  w.l3.sifter.onEvent(p, last);
  const story = w.l3.state.pool[0].story!;
  sow(w);
  const consumer1 = w.l2.all()[0]?.id;
  expect(consumer1).toBeDefined();
  const result = w.l2.sowRequest({ template: t.id, pack: 'xf.fixture', localName: 'second', decision: H(s('second-consumer')),
    overlay: { roles: { subject: { identity: w.a }, other: { identity: w.b }, story: { identity: story } } } });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('second consumer setup');
  const consumer2 = result.instance;
  w.l3.sifter.sweep(w.k.now);
  w.l3.flush();
  expect(w.l3.state.pool).toHaveLength(0);
  const facts = [story, first.id, last.id, cause.id].map((id) => w.l3.kv.event(id));
  w = reload(w, create(), 'hand-over');
  expect(facts.every(Boolean)).toBe(true);
  expect([story, first.id, last.id, cause.id].map((id) => w.l3.kv.event(id)), 'S3-01 semantic: hand-over event facts').toEqual(facts);
  expect(w.l3.state.evidence.map((e) => e.id).sort(), 'S3-01 semantic: descriptors cover the complete hand-over').toEqual([story, first.id, last.id, cause.id].sort());
  w.l2.withdraw(w.l2.instance(consumer1)!, 'consumer finished');
  w.k.settle();
  w = reload(w, create(), 'one-consumer');
  expect(w.l3.kv.event(first.id), 'remaining consumer retains facts').toEqual(facts[1]);
  w.l2.withdraw(w.l2.instance(consumer2)!, 'last consumer finished');
  w.k.settle();
  w.l3.flush();
  expect(w.l3.state.evidence, 'last consumer releases descriptors').toEqual([]);
  w.k.retention.scheduleSweep();
  w.k.settle();
  expect(w.k.store.header(first.id), 'last consumer releases event storage').toBeUndefined();
});

test('S3-02: adding an overlapping frame root is monotone under either root order', () => {
  const w = world('review-root-order', { patterns: [] }), k = w.k;
  const person = k.mint(w.a, w.b, 'unrooted-person', 'core:person'),
    b = event(w, 'B', 'act', 1, { participants: [{ who: person, role: 'actor' }] }),
    a = event(w, 'A', 'act', 2, { causes: [b.id] });
  k.retention.setSeed({ id: H(s('pool-root')), state: {}, nodes: [a.id] });
  const baseline = new Set(k.retention.marked());
  expect(baseline.has(person)).toBe(true);
  k.frames.demandRoots.add(w.v);
  k.frames.open({ actor: w.v, origin: w.v, cause: w.v, level: 'goal', weight: 1, focus: { nodes: [b.id], tier: 1 } });
  const roots = k.retention.rootIds.bind(k.retention), orders: Set<string>[] = [];
  for (const reverse of [false, true]) {
    k.retention.rootIds = () => {
      const ids = roots().filter((id) => id !== b.id);
      return reverse ? [b.id, ...ids] : [...ids, b.id];
    };
    k.retention.invalidate();
    const marked = new Set(k.retention.marked());
    expect([...baseline].filter((id) => !marked.has(id)), 'S3-02 semantic: adding roots cannot remove retained nodes').toEqual([]);
    orders.push(marked);
  }
  expect([...orders[0]].sort()).toEqual([...orders[1]].sort());
  k.retention.scheduleSweep(); k.settle();
  expect(k.store.header(person)).toBeDefined();
});

test('S3-03: a closure saved before director consumption still locks future openings exactly once', () => {
  const name = 'review-pending-outcome',
    create = () => world(name, { patterns: [], seeds: [kit({ level: 'arc', sowable: undefined })] });
  const prepare = () => {
    const w = create();
    w.k.settings.set({ tempo: 'off' });
    expect(w.l2.sow('xf.fixture', kit().id).ok).toBe(true);
    w.k.settle(); w.l3.advancePlay(100);
    const inst = w.l2.all()[0], d = inst.st.deliveries.find((d) => d.state === 'released')!;
    expect(d).toBeDefined();
    w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: 100 });
    w.l2.contentCompleted(d.id); w.k.settle();
    expect(inst.st.closed?.witnessed).toBe(true);
    expect(w.l3.state.consumedOutcomes).toEqual([]);
    return w;
  };
  const plain = prepare(); plain.l3.advancePlay(101);
  let loaded = reload(prepare(), create(), 'before-consumption');
  loaded.l2.advancePlay(0); // Host's next director tick is at total 101 in both branches.
  loaded.l3.advancePlay(1);
  expect(loaded.l3.state.openLockUntil, 'S3-03 semantic: unconsumed closure restores arc lock').toBe(1301);
  expect(loaded.l3.state.consumedOutcomes).toEqual(plain.l3.state.consumedOutcomes);
  loaded = reload(loaded, create(), 'after-consumption');
  loaded.l3.advancePlay(1);
  expect(loaded.l3.state.openLockUntil, 'consumed closure cannot extend the lock again').toBe(1301);
  loaded.k.settings.set({ tempo: 'restless' });
  loaded.l3.data.schedule.slotGap = 1;
  loaded.l3.state.slots.open.next = loaded.l2.playTotal();
  loaded.l3.data.schedule.gentleFirst = 0;
  loaded.l3.sower.resolve(empty);
  expect(loaded.l3.log.at(-1)?.rule, 'restored lock affects eligibility').toBe('slot-locked');
});

function openRoleWorld(name: string) {
  const p = pattern({ telling: { form: 'recap', binds: { subject: '?a' } } });
  const w = world(name, { patterns: [p] });
  w.k.pin({ node: w.a, slot: 'age', value: 20, reason: 'authored', cause: w.a });
  w.k.pin({ node: w.b, slot: 'age', value: 42, reason: 'authored', cause: w.a });
  w.l2.packs.get('xf.fixture')!.pack.seeds[0].roles.other.must = [{ path: 'age', op: 'eq', arg: 42 }];
  return w;
}
for (const source of ['npc', 'spine'] as const) {
  function exclude(w: World) {
    if (source === 'npc') w.k.settings.set({ storyExclusions: [{ kind: 'npc', value: w.b }] });
    else w.l2.worldRegistry = { ...registry, isSpine: (id) => id === w.b };
  }
  test(`S3-04-${source}: an unbound role uses the shared authority in casting, recasting and preparation`, () => {
    const w = openRoleWorld('review-open-' + source);
    complete(w); exclude(w); sow(w);
    const inst = w.l2.all()[0];
    expect(inst).toBeDefined();
    expect(inst.st.roles.other.cast, `S3-04-${source} semantic: excluded open role cannot cast`).toBeUndefined();
    expect(w.l3.kv.isSpine(w.b)).toBe(source === 'spine');
    expect(castRole(w.l2, inst, 'other').node, 'recasting uses the same authority').toBeUndefined();

    const recast = openRoleWorld('review-recast-' + source);
    complete(recast); sow(recast);
    const tentative = recast.l2.all()[0];
    expect(tentative.st.roles.other.cast).toBe(recast.b);
    exclude(recast);
    recast.l2.queueReeval(tentative, 'recast after exclusion'); recast.k.settle();
    expect(tentative.st.roles.other.cast, `S3-04-${source} semantic: recasting rejects cached tentative cast`).toBeUndefined();

    const late = openRoleWorld('review-prepare-' + source);
    complete(late); sow(late);
    const pending = late.l2.all()[0];
    expect(pending.st.roles.other.cast).toBe(late.b);
    expect(pending.st.deliveries.some((d) => d.state === 'queued')).toBe(true);
    exclude(late);
    late.l3.advancePlay(1);
    expect(late.l2.arbiter.log, `S3-04-${source} semantic: preparation refuses newly excluded role`).toHaveLength(0);
    expect(pending.st.record.some((r) => r.kind === 'lost' && r.data.role === 'other')).toBe(true);
  });
}

test('S3-06-alternatives: an unselected excluded variant cannot veto the selected safe document', () => {
  const t = kit({ variation: { variants: [
    { id: 'safe', weight: 1, parts: { purpose: { tags: ['safe'], sentence: 'Allowed.' } } },
    { id: 'excluded', weight: 1, rare: 'no', parts: { purpose: { tags: ['excluded'], sentence: 'Excluded.' } } },
  ] } }), w = world('review-safe-alternative', { seeds: [t] });
  w.k.settings.set({ storyExclusions: [{ kind: 'tag', value: 'excluded' }] });
  complete(w); sow(w);
  expect(w.l2.all()).toHaveLength(1);
  expect(w.l2.all()[0].st.document.purpose.tags).toEqual(['safe']);
});
test('S3-04-alias: legacy NPC settings and their saved wire field derive from the typed authority', () => {
  const w = world('review-npc-alias');
  w.k.settings.set({ exclusions: [w.a] });
  expect(w.k.settings.current().storyExclusions).toEqual([{ kind: 'npc', value: w.a }]);
  w.k.settings.set({ storyExclusions: [{ kind: 'tag', value: 'report' }, { kind: 'npc', value: w.b }] });
  expect(w.k.settings.current().exclusions).toEqual([w.b]);
  expect(w.k.settings.all().at(-1)).toMatchObject({ exclusions: [w.b], storyExclusions: [{ kind: 'tag', value: 'report' }] });
  expect(() => w.k.settings.set({ exclusions: [w.a], storyExclusions: [{ kind: 'npc', value: w.b }] })).toThrow('derived alias');
  w.k.persistence.save('alias'); w.k.persistence.load('alias');
  expect(w.l2.directorExcludes(w.a)).toBe(false);
  expect(w.l2.directorExcludes(w.b)).toBe(true);
});

for (const cap of ['pattern', 'total', 'sown'] as const)
  test(`S3-05-${cap}: dead entries never consume admission capacity without a sweep`, () => {
    const run = (sweep: boolean) => {
      const data = defaultData(); data.sifter.candidateTtl = 1;
      data.sifter.poolPerPattern = cap === 'total' ? 2 : 1;
      data.sifter.poolTotal = cap === 'total' ? 1 : 2;
      const p = pattern({ once: undefined }), second = { ...p, id: 'second-pattern' },
        w = world('review-cap-' + cap, { data, patterns: [p, second] });
      complete(w);
      const old = w.l3.state.pool[0];
      if (cap === 'sown') {
        w.k.settings.set({ tempo: 'restless' });
        w.l2.baseTotal = w.l3.keys.slot(1, 4500).time;
        w.l3.state.slots.open.next = 1;
        w.l3.sower.resolve(empty);
        expect(old.seed).toBeDefined();
      }
      w.k.now = cap === 'sown' ? 101 : 104;
      if (sweep) w.l3.sifter.sweep(w.k.now);
      const e = event(w, 'new', 'insult', w.k.now);
      w.l3.sifter.onEvent(cap === 'total' ? second : p, e);
      expect(w.l3.state.pool.some((entry) => entry.stages[0].event === e.id), `S3-05-${cap} semantic: dead entry cannot block admission`).toBe(true);
      expect(w.l3.state.pool.some((entry) => entry.id === old.id), `S3-05-${cap} semantic: reclaimable entry no longer occupies storage`).toBe(false);
      return w.l3.state.pool.map((entry) => entry.id);
    };
    expect(run(false)).toEqual(run(true));
  });

for (const kind of ['tag', 'class', 'verb', 'soft'] as const)
  test(`S3-06-${kind}: exclusions check the selected variant before atomic commit`, () => {
    const replacement: Partial<Seed> = kind === 'tag' ? { purpose: { tags: ['excluded-tag'], sentence: 'Excluded variant.' } } :
      kind === 'verb' ? { beats: { tell: { kind: 'texture', play: 'pack:excluded' } } } : { content: { envelope: { 'violence.gore': 1 } } };
    const t = kit({ variation: { variants: [{ id: 'replacement', weight: 1, parts: replacement }] } }),
      w = world('review-variant-' + kind, { seeds: [t], patterns: [] });
    const pack = w.l2.packs.get('xf.fixture')!.pack;
    pack.fragments.push({ ...structuredClone(pack.fragments[0]), id: 'excluded', features: { verb: 'excluded-verb' } });
    // Re-index the new fragment before it is compiled.
    expect(w.l2.installPack(pack).filter((f) => f.level === 'error')).toEqual([]);
    expect(w.l3.installPatterns([pattern()])).toEqual([]);
    if (kind === 'soft') w.k.settings.set({ content: { softExclusions: [{ class: 'violence.gore', level: 1 }] } });
    else w.k.settings.set({ storyExclusions: [{ kind, value: kind === 'tag' ? 'excluded-tag' : kind === 'class' ? 'violence.gore' : 'excluded-verb' }] });
    complete(w); sow(w);
    expect(w.l2.all(), `S3-06-${kind} semantic: excluded effective document cannot commit`).toHaveLength(0);
    expect(w.l3.state.pending).toEqual([]);
    expect(w.l3.state.recent).toEqual([]);
    expect(w.l3.state.pool[0].seed).toBeUndefined();
    expect(w.l3.log.some((e) => e.rule === 'sow-refused' && JSON.stringify(e.data.result).includes('S3-gate-7'))).toBe(true);
  });

test('S3-05-late: a late completion past its TTL cannot block a new occurrence in the same emission', () => {
  const data = defaultData(); data.sifter.candidateTtl = 1;
  data.sifter.poolPerPattern = data.sifter.poolTotal = 1;
  const p = pattern({ stages: [pattern().stages[0], pattern().stages[0]], once: undefined, unless: undefined }),
    w = world('review-late-completion', { data, patterns: [p] });
  w.k.now = 104;
  w.l3.sifter.onEvent(p, event(w, 'first', 'insult', 100));
  const next = event(w, 'second', 'insult', 101);
  w.l3.sifter.onEvent(p, next);
  expect(w.l3.state.pool.map((e) => ({ event: e.stages[0].event, complete: e.complete })),
    'S3-05-late semantic: expired completion cannot reserve capacity').toEqual([{ event: next.id, complete: false }]);
});

test('S3-07: closed telling and sowable fields refuse deferred capabilities explicitly', () => {
  const w = world('review-nested-later'), p = pattern(), t = kit();
  expect(patternFindings(p, w.l2, w.l3.kv, w.l3.data)).toEqual([]);
  expect(sowableFindings(t, w.l2, w.l3.kv, w.l3.data, 'xf.fixture')).toEqual([]);
  for (const key of ['atStage', 'tellings']) {
    const findings = patternFindings({ ...p, telling: { ...p.telling, [key]: 0 } }, w.l2, w.l3.kv, w.l3.data);
    expect(findings.some((f) => f.message.includes('not supported yet')), 'S3-07 semantic: deferred telling field refused').toBe(true);
  }
  for (const key of ['from', 'subject']) {
    const findings = sowableFindings({ ...t, sowable: { ...(t.sowable as object), [key]: key === 'from' ? ['looseEnd'] : 'person' } }, w.l2, w.l3.kv, w.l3.data, 'xf.fixture');
    expect(findings.some((f) => f.message.includes('not supported yet')), 'S3-07 semantic: deferred sowable field refused').toBe(true);
  }
  expect(bound(t.roles.subject.identity).status).toBe('open');
});
