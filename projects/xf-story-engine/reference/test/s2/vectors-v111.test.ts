import { expect, test } from 'bun:test';
import { scene } from './v111-fixture.ts';
import { r1World } from './drive.ts';
import { r1Pack, R1_PACK, R1_ID } from './r1.ts';
import { r2Pack } from '../../src/m3/r2.ts';
import { implicitPattern } from '../../src/seeding/seed-patterns.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { library, vocabulary } from '../s3/library.ts';
import { GraphWorld } from '../../src/procedural/graph-world.ts';
import { kernelView } from '../../src/procedural/views.ts';
import { H, s, mintedId } from '../../src/id.ts';
import { PackIndex } from '../../src/seeding/packs.ts';
import { makeWorld, settle, setFact } from './world.ts';
import { miniPack } from './mini.ts';
import { playUntil, delivery, show } from './drive.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';
import type { ProcessDef } from '../../src/evolution.ts';

const installPatterns = (w: ReturnType<typeof makeWorld>) => { w.l2.reg.vocabulary = vocabulary; for (const p of library) w.l2.reg.patterns.set(p.id, p); };

test('SF-65: R2 prime pins asked, paid and the failed-shakedown refusal, with real outcome-conditioned fills', () => {
  const w = makeWorld('R2-prime-lint'); installPatterns(w); const pack = r2Pack(), seed = pack.seeds[0];
  seed.roles.incident = { kind: 'core:event' };
  const offer = pack.fragments.find((f) => f.offer)!; offer.offer!.asker = 'stallholder';
  w.k.eventKinds.register({ name: 'shakedown', producers: ['s2'], roles: ['aggressor', 'victim'], fills: [
    { fn: 'comply', args: { who: 'victim', to: 'aggressor' }, when: { outcome: ['done'] } },
    { fn: 'refuse', args: { who: 'victim', to: 'aggressor' }, when: { outcome: ['failed'] } }] });
  const event = (outcome: 'done' | 'failed') => ({ event: { kind: 'shakedown', outcome, participants: [{ who: 'stallholder', role: 'victim' }, { who: 'collector', role: 'aggressor' }] } });
  seed.beats.paid.leaves = [event('done')]; seed.beats['standup-scene'].leaves = [event('failed')];
  seed.realises = [{ pattern: 'xf.composite:squeeze', juncture: 'asked', by: 'ask', binds: { '?wk': 'stallholder', '?p': 'v' } },
    { pattern: 'xf.composite:squeeze', juncture: 'paid', by: 'paid', binds: { '?wk': 'stallholder', '?col': 'collector' } },
    { pattern: 'xf.composite:squeeze', juncture: 'refused', by: 'standup-scene', binds: { '?wk': 'stallholder', '?col': 'collector' } }];
  const check = () => lintV111(resolvePreds(seed), w.l2.lintContext(new PackIndex(pack))).filter((f) => f.code === 'L-138');
  expect(check()).toEqual([]); seed.beats['standup-scene'].leaves = [event('done')]; expect(check()).toHaveLength(1);
  seed.beats['standup-scene'].leaves = [event('failed')];
  const graph = implicitPattern(resolvePreds(seed), (r) => new PackIndex(pack).fragment(r), w.l2.reg.patterns, vocabulary, (k) => w.k.eventKinds.eventKind(k));
  expect(Object.fromEntries(['ask', 'paid', 'standup-scene'].map((key) => [key, graph.junctures[key].fn]))).toEqual({ ask: 'ask', paid: 'comply', 'standup-scene': 'refuse' });
  expect(graph.abstraction).toBeGreaterThan(0);
  const played = scene('failed-shakedown-played', (w, p) => {
    installPatterns(w);
    for (const [name, values] of [['core:event-kind', ['shakedown']], ['core:participant-role', ['aggressor', 'victim']]] as Array<[string, string[]]>) {
      const dim = w.k.schema.dims.get(name)!; if (dim.value.t === 'enum') dim.value.values.push(...values);
    }
    w.k.eventKinds.register({ name: 'shakedown', producers: ['s2'], roles: ['aggressor', 'victim'], fills: [
      { fn: 'comply', args: { who: 'victim', to: 'aggressor' }, when: { outcome: ['done'] } },
      { fn: 'refuse', args: { who: 'victim', to: 'aggressor' }, when: { outcome: ['failed'] } }] });
    p.seeds[0].beats.finish.leaves = [{ event: { kind: 'shakedown', outcome: 'failed', participants: [{ who: 'npc', role: 'victim' }, { who: 'recipient', role: 'aggressor' }] } }];
    p.seeds[0].realises = [{ pattern: 'xf.composite:squeeze', juncture: 'refused', by: 'finish', binds: { '?wk': 'npc', '?col': 'recipient' } }];
  });
  played.w.l2.respond(played.d.id, { kind: 'action', id: 'go' });
  expect(playUntil(played.w, () => {
    for (const d of played.inst.st.deliveries.filter((d) => d.what === 'reply' && d.state === 'released')) { show(played.w, d); played.w.l2.contentCompleted(d.id); }
    for (const d of played.inst.st.deliveries.filter((d) => d.beat === 'finish' && d.state === 'queued')) played.w.l2.pull(d.id);
    return !!delivery(played.inst, 'finish');
  }, 300)).toBe(true);
  const finish = delivery(played.inst, 'finish')!; show(played.w, finish); played.w.l2.contentCompleted(finish.id);
  const minted = played.inst.st.record.find((r) => r.kind === 'minted' && r.data.path === 'beat/finish/leaves/0')!.data.event as string;
  const world = new GraphWorld(played.w.k, played.w.l2, kernelView(played.w.k, played.w.l2, { names: () => [], eventKind: () => undefined }), vocabulary);
  expect(world.eventFills(world.view.event(minted)!).map((f) => f.fn)).toEqual(['refuse']);
  expect(played.w.l2.beatFunction(played.inst.id, 'finish')).toEqual({ fn: 'refuse', args: { who: played.asker, to: played.recipient } });
});

test('SF-75: every R1 offer and exit is in the deterministic implicit graph and fit report', () => {
  const { w, inst } = r1World('implicit-R1'); installPatterns(w);
  const pack = new PackIndex(r1Pack()), c = inst.st.document;
  const derive = () => implicitPattern(c, (r) => pack.fragment(r), w.l2.reg.patterns, vocabulary, (k) => w.k.eventKinds.eventKind(k));
  const a = derive(); expect(derive()).toEqual(a);
  const offers = Object.entries(c.beats).filter(([, b]) => pack.fragment(typeof b.play === 'string' ? b.play : '')?.offer).map(([key]) => key);
  expect(offers.length).toBeGreaterThanOrEqual(3);
  for (const key of offers) { expect(a.junctures[key].fn).toBe('ask'); expect(w.l2.beatFunction(inst.id, key)?.fn).toBe('ask'); }
  for (const [key, b] of Object.entries(c.beats)) if (b.kind === 'exit') expect(a.outcomes[key]).toBeDefined();
  expect(w.l2.fit(R1_PACK, R1_ID).implicitPattern).toEqual(a);
});

test('SF-67: actual offers and all four answer paths have their exact registered fills', () => {
  for (const kind of ['action', 'refuse', 'decline', 'null'] as const) {
    const { w, inst, d, asker } = scene('real-fills-' + kind); installPatterns(w);
    expect(w.l2.respond(d.id, kind === 'action' ? { kind, id: 'go' } : kind === 'refuse' ? { kind: 'action', id: 'refuse' } : kind === 'decline' ? { kind, id: 'no' } : { kind })).toBe(true);
    const world = new GraphWorld(w.k, w.l2, kernelView(w.k, w.l2, { names: () => [], eventKind: () => undefined }), vocabulary);
    const offer = world.eventFills(world.view.event(d.offerEvent!)!).filter((f) => f.fn !== 'learn');
    expect(offer.map((f) => ({ fn: f.fn, args: f.args }))).toEqual([{ fn: 'ask', args: { by: asker, of: w.v } }]);
    const id = String(inst.st.record.find((r) => r.kind === 'response')!.data.event), fills = world.eventFills(world.view.event(id)!).filter((f) => f.fn !== 'learn');
    expect(fills.map((f) => f.fn).sort()).toEqual(kind === 'action' ? ['choose', 'comply'] : kind === 'refuse' ? ['choose', 'refuse'] : kind === 'decline' ? ['refuse'] : []);
    if (kind !== 'null') expect(fills.find((f) => f.fn !== 'choose')?.args).toEqual({ who: w.v, to: asker });
  }
});

test('SF-76/78: unattended end realisation and every actual loose end retain growth metadata across reload', () => {
  const growth = { instance: H(s('unloaded-instance')), juncture: 'paid' };
  const { w, inst, d, asker } = scene('unattended-realisation', (w, p) => {
    installPatterns(w); const seed = p.seeds[0]; seed.growsFrom = growth;
    seed.roles.npc.goal = { effects: [{ on: 'recipient', effect: 'give' }] };
    seed.promises = [{ id: 'open-errand', opens: 'meet', paidBy: 'no' }];
    seed.end = 'seedFact(stage) == 9'; seed.unattended = { after: { clock: 'game', s: 0 }, outcome: [{ fact: 'stage', set: 9 }] };
    seed.realises = [{ pattern: 'xf.composite:debt', juncture: 'paid', by: 'unattended', binds: { '?d': 'v', '?c': 'npc' } },
      { pattern: 'xf.composite:debt', juncture: 'defaulted', by: 'end', binds: { '?d': 'v', '?c': 'npc' } }];
  });
  expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true); w.k.settle({ to: 600 });
  expect(inst.st.closed?.status).toBe('abandoned');
  expect(w.l2.realisedBy(inst.st.closed!.event)).toEqual([{ fn: 'repay', args: { debtor: w.v, creditor: asker } }]);
  const closure = inst.st.record.find((r) => r.kind === 'closure')!, ends = closure.data.looseEnds as Record<'facts' | 'casts' | 'promises', Array<Record<string, unknown>>>;
  for (const type of ['facts', 'casts', 'promises'] as const) { expect(ends[type].length).toBeGreaterThan(0); for (const entry of ends[type]) expect(entry).toMatchObject(growth); }
  expect(w.k.store.header(growth.instance)).toBeUndefined(); w.k.persistence.save('ends'); w.k.persistence.load('ends', w.gamePort);
  expect(w.l2.instance(inst.id)!.st.record.find((r) => r.kind === 'closure')).toEqual(closure);
});

test('SF-71/73: paraphrased text options are refused; an uncarried warning never authorises a climb', () => {
  const w = makeWorld('unspoken-warning'), p = miniPack();
  p.texts.push({ id: 'line', text: 'Exact words.', speaker: 'v' }); p.fragments[0].offer!.actions[0].say = { text: 'pack:line' }; p.fragments[0].offer!.actions[0].label = 'Different words.';
  expect(lintV111(resolvePreds(p.seeds[0]), w.l2.lintContext(new PackIndex(p))).some((f) => f.code === 'L-129')).toBe(true);
  const warning = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'uncarried', kind: 'warning', time: 0 });
  const ladder: ProcessDef = { id: 'stub.s1-ladder', tier: 0, period: 1, lag: 0, init: () => ({ rung: 1 }),
    run: (ctx) => ({ ops: [], state: { rung: ctx.observedAt(warning, ctx.windowStart) === undefined ? 1 : 2 } }) };
  w.k.evolution.register(ladder);
  for (let n = 1; n < 6; n++) w.k.settle({ to: n * 600 });
  expect(w.k.observedAt(warning, w.k.now)).toBeUndefined(); expect(w.k.evolution.ownOf<{ rung: number }>(ladder)?.rung).toBe(1);
  w.k.persistence.save('no-carrier'); w.k.persistence.load('no-carrier', w.gamePort); w.k.settle({ to: 4200 }); expect(w.k.evolution.ownOf<{ rung: number }>(ladder)?.rung).toBe(1);
});

test('SF-79: both unattended declaration paths and null/reoffer/action paths survive an intervening save', () => {
  const { w, inst, d } = scene('path-reoffer', (w, p) => {
    w.k.eventKinds.register({ name: 'collector-visit', producers: ['s2'], roles: ['collector'] });
    const e = { event: { kind: 'collector-visit', participants: [{ who: 'npc', role: 'collector' }] } };
    p.seeds[0].beats.meet.reoffer = { max: 2, when: 'yes' };
    p.fragments[0].offer!.nullPath.writes = [e]; p.fragments[0].offer!.actions[0].writes!.push(e);
    p.seeds[0].beats.finish.leaves!.push(e); p.fragments[1].leaves = [e];
    p.seeds[0].unattended.outcome.push(e); p.seeds[0].unattended.events = [e.event];
  });
  expect(w.l2.respond(d.id, { kind: 'null' })).toBe(true); settle(w);
  w.k.persistence.save('before-reoffer'); w.k.persistence.load('before-reoffer', w.gamePort);
  const loaded = w.l2.instance(inst.id)!;
  expect(playUntil(w, () => !!delivery(loaded, 'meet'), 300)).toBe(true);
  const again = delivery(loaded, 'meet')!; expect(again.n).toBe(1); expect(w.l2.respond(again.id, { kind: 'action', id: 'go' })).toBe(true);
  expect(playUntil(w, () => {
    for (const r of loaded.st.deliveries.filter((d) => d.what === 'reply' && d.state === 'released')) { show(w, r); w.l2.contentCompleted(r.id); }
    for (const r of loaded.st.deliveries.filter((d) => d.beat === 'finish' && d.state === 'queued')) w.l2.pull(r.id);
    return !!delivery(loaded, 'finish');
  }, 300)).toBe(true);
  const finish = delivery(loaded, 'finish')!; show(w, finish); w.l2.contentCompleted(finish.id); settle(w);
  const paths = loaded.st.record.filter((r) => r.kind === 'minted').map((r) => [String(r.data.path), String(r.data.event)]);
  for (const [path, id] of paths.filter(([path]) => !path.startsWith('promise/'))) expect(id).toBe(mintedId(inst.id, inst.id, 'event:' + path));
  expect(paths.map(([path]) => path)).toEqual(expect.arrayContaining(['offer/meet/0/null/writes/0', 'offer/meet/1/action/go/writes/1', 'beat/finish/leaves/1', 'beat/finish/fragment/0']));
  w.k.persistence.save('after-reoffer'); w.k.persistence.load('after-reoffer', w.gamePort);
  expect(w.l2.instance(inst.id)!.st.record.filter((r) => r.kind === 'minted').map((r) => [String(r.data.path), String(r.data.event)])).toEqual(paths);
  const twin = scene('path-unattended', (w, p) => {
    w.k.eventKinds.register({ name: 'collector-visit', producers: ['s2'], roles: ['collector'] }); const event = { kind: 'collector-visit', participants: [{ who: 'npc', role: 'collector' }] };
    p.seeds[0].unattended = { after: { clock: 'game', s: 0 }, outcome: [{ event }], events: [event] };
  });
  twin.w.l2.respond(twin.d.id, { kind: 'decline', id: 'no' }); twin.w.k.settle({ to: 600 });
  const records = twin.inst.st.record.filter((r) => r.kind === 'minted');
  expect(records.map((r) => r.data.path)).toEqual(['unattended/outcome/0', 'unattended/events/0']);
  expect(new Set(records.map((r) => r.data.event)).size).toBe(2);
  const accepted = scene('path-accepted-zero', (w, p) => {
    w.k.eventKinds.register({ name: 'collector-visit', producers: ['s2'], roles: ['collector'] });
    p.fragments[0].offer!.actions[0].writes!.push({ event: { kind: 'collector-visit', participants: [{ who: 'npc', role: 'collector' }] } });
    p.seeds[0].beats.meet.reoffer = { max: 2, when: 'yes' };
  });
  expect(accepted.w.l2.respond(accepted.d.id, { kind: 'action', id: 'go' })).toBe(true);
  const path = 'offer/meet/0/action/go/writes/1';
  expect(accepted.inst.st.record.find((r) => r.kind === 'minted' && r.data.path === path)?.data.event).toBe(mintedId(accepted.inst.id, accepted.inst.id, 'event:' + path));
  accepted.w.k.persistence.save('accepted-zero'); accepted.w.k.persistence.load('accepted-zero', accepted.w.gamePort);
  expect(accepted.w.l2.instance(accepted.inst.id)!.st.deliveries.filter((d) => d.what === 'offer').map((d) => d.n)).toEqual([0]);
});
