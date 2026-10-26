import { expect, test } from 'bun:test';
import { graphWorld, graphPattern, emit, perceive, simple } from './graph-fixture.ts';
import { event, kit, pack, type World } from './helpers.ts';
import { telling, offering, live, nudging } from './graph-kits.ts';
import { H, s } from '../../src/id.ts';
import { rankCandidates } from '../../src/procedural/sower.ts';
import { fillerId } from '../../src/procedural/graph-world.ts';
import type { Pattern, PatternWorldPort } from '../../src/seeding/pattern-types.ts';
import type { StateFill } from '../../src/sim/fillers.ts';
import type { EventView } from '../../src/procedural/types.ts';
import { miniPack } from '../s2/mini.ts';
import { linkHolds } from '../../src/procedural/graph-links.ts';

const rules = (fn: string, rows: () => StateFill[]): ReturnType<PatternWorldPort['stateRules']> => [{ id: 'fixture:' + fn, fn, durable: true,
  changes: [], fromChange: () => [], endsBy: () => false,
  search: (arg, node, _at, limit) => ({ fills: rows().filter((r) => r.args[arg] === node).slice(0, limit), truncated: false }), holdsAt: () => 'yes' }];
function buffered(w: World, name: string, kind: string, at: number, extra: Partial<EventView> = {}) {
  w.k.now = at; return event(w, name, kind, at, extra);
}
function tell(w: World, candidate: ReturnType<World['l3']['sower']['collect']>[number], index = 0) {
  const k = candidate.kits[index], r = w.l2.sow(k.pack, k.template.id, { by: 'director', decision: w.l3.keys.decision(candidate.candidate.key), overlay: k.overlay });
  expect(r.ok, JSON.stringify(r.findings)).toBe(true);
  const inst = w.l2.instance(r.instance!)!;
  w.k.settle();
  for (const d of inst.st.deliveries.filter((d) => d.state === 'queued' && d.timing.class > 0)) w.l2.pull(d.id);
  for (let n = 0; n < 160 && !inst.st.deliveries.some((d) => d.state === 'released'); n++) { w.l2.advancePlay(w.l2.playBase + w.l2.arbiter.play + 1); w.k.settle(); }
  const d = inst.st.deliveries.find((d) => d.state === 'released')!; expect(d, JSON.stringify({ state: inst.st.state, roles: inst.st.roles, record: inst.st.record.slice(-5) })).toBeDefined();
  w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: w.l2.playTotal() }); w.l3.refresh();
  return { inst, d };
}

test('SF3-39(b): demand-first debt queries a real norm and goal and checks retrospective links', () => {
  const w = graphWorld('debt-query', [graphPattern('debt')]), norm = w.k.root('fee', 'core:group'), ground = emit(w, 'generic', 1);
  const frame = H(s('creditor-shortfall'));
  w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: ground.id, retain: true, level: 'goal', weight: 1, own: {}, payload: {}, focus: { nodes: [], tier: 0 } });
  const owed = { norm: { norm, who: w.b } }, owedId = fillerId(owed);
  w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'obligate' ? rules(fn, () => [{ filler: owed, at: 0, args: { debtor: w.b, creditor: w.a }, causes: [ground.id] }])
    : fn === 'want' ? rules(fn, () => [{ filler: { frame }, at: 1, args: { who: w.a, what: owedId }, causes: [ground.id] }]) : [] };
  const call = emit(w, 'demand', 2, { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }], served: frame });
  const e = w.l3.state.pool[0]; expect(e.graph!.junctures.called.filler?.id).toBe(call.id);
  expect(e.graph!.junctures.owed.filler?.id).toBe(owedId); expect(e.graph!.junctures.due.filler?.ref).toEqual({ frame });
  emit(w, 'payment', 3, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [call.id] });
  expect(e.graph!.outcome?.name).toBe('settled');
});

test('SF3-42/64: but needs a violating effect; a structured alternative logs its failed motive', () => {
  for (const violates of [false, true]) {
    const p = simple(); p.edges[0].link = 'but'; const w = graphWorld('but-' + violates, [p]);
    const frame = H(s('protect-interest'));
    w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: w.a, level: 'goal', retain: true, weight: 1,
      own: { protects: [{ slot: '*', scope: { nodes: [w.b] } }] }, payload: {}, focus: { nodes: [], tier: 0 } });
    emit(w, 'wrong', 1, { served: frame });
    emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], effects: [{ on: w.b, effect: violates ? 'harm' : 'give' }] });
    expect(!!w.l3.state.pool[0].graph!.outcome).toBe(violates);
  }
  for (const all of [false, true]) {
    const p = simple(); p.junctures.approach = { fn: 'repay', args: { debtor: '?a', creditor: '?b' } };
    p.junctures.second.join = { all: all ? ['first', 'approach'] : [], any: all ? [] : ['first', 'approach'] };
    p.edges.push({ from: 'approach', to: 'second', link: 'motive' });
    const w = graphWorld('structured-' + all, [p]), first = emit(w, 'wrong', 1); emit(w, 'payment', 2);
    emit(w, 'helped', 3, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
    expect(!!w.l3.state.pool[0].graph!.outcome).toBe(!all);
    if (!all) expect(w.l3.log.some((l) => l.rule === 'unborne' && l.data.from === 'approach')).toBe(true);
  }
});

test('SF3-43/52: real story chains stop at depth four and reject their own lineage', () => {
  const root = simple({ id: 'xf.test:chain0' });
  // Aftermath keeps children available for their parent perception and thread projection.
  root.junctures.echo = { fn: 'repay', args: { debtor: '?a', creditor: '?b' }, optional: true };
  root.outcomes.done.aftermath = { junctures: ['echo'], days: 7 };
  const chain = Array.from({ length: 5 }, (_, n): Pattern => simple({ id: 'xf.test:chain' + (n + 1), family: 'shape', roles: { '?a': { kind: 'person' } },
    entry: ['story'], junctures: { story: { fn: 'story', args: { pattern: 'xf.test:chain' + n, outcome: 'done' }, binds: { a: '?a' } },
      echo: { fn: 'choose', args: { who: '?a' }, optional: true } }, edges: [],
    outcomes: { done: { reached: ['story'], kind: 'resolved', aftermath: { junctures: ['echo'], days: 7 } } }, show: { junctures: ['story'], edges: 0 } }));
  const self = simple({ id: 'xf.test:self', family: 'shape', roles: { '?a': { kind: 'person' } }, entry: ['story'],
    junctures: { story: { fn: 'story', args: { pattern: 'any', outcome: 'any' }, binds: { a: '?a' } } }, edges: [],
    outcomes: { done: { reached: ['story'], kind: 'resolved' } }, show: { junctures: ['story'], edges: 0 } });
  const w = graphWorld('five-chain', [root, ...chain]);
  const first = buffered(w, 'wrong', 'wrong', 1, { witnesses: [w.v] });
  buffered(w, 'help', 'helped', 2, { witnesses: [w.v], participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  w.k.settle({ to: 600 }); w.l3.refresh();
  expect(w.l3.state.pool.map((e) => e.graph!.depth).sort()).toEqual([1, 2, 3, 4]);
  const stories = w.l3.state.pool.map((e) => e.story!); expect(new Set(stories).size).toBe(4);
  for (const e of w.l3.state.pool) expect(w.l3.kv.event(e.story!)?.data).toMatchObject({ instance: e.id, depth: e.graph!.depth, outcome: 'done' });
  expect(w.l3.threadView.filter((t) => t.patterns?.length === 4)).toHaveLength(1);
  w.l3.installPatterns([self]);
  const ancestor = emit(w, 'meta:story', 601, { participants: [{ who: w.a, role: 'a' }], data: { pattern: self.id, instance: w.a, outcome: 'done', kind: 'resolved', depth: 1 } });
  emit(w, 'meta:story', 602, { participants: [{ who: w.a, role: 'a' }], causes: [ancestor.id], data: { pattern: root.id, instance: w.b, outcome: 'done', kind: 'resolved', depth: 2 } });
  expect(w.l3.state.pool.some((e) => e.pattern === self.id)).toBe(false);
});

test('SF3-44/63: a genuinely lagged process publishes before the horizon ends a story; aftermath has its own bound', () => {
  for (const late of [false, true]) {
    const p = simple({ within: { clock: 'game', days: 300 / 86400 } }); p.outcomes.done.aftermath = { junctures: ['tail'], days: 3 };
    p.junctures.tail = { fn: 'repay', args: { debtor: '?a', creditor: '?b' }, optional: true };
    const w = graphWorld('lagged-' + late, [p]);
    w.k.evolution.register({ id: 'lagged', tier: 0, period: 1, lag: 1, run: (_ctx, window) => window === 1 && late ? [{ op: 'mint-event', spec: {
      name: 'late-help', kind: 'helped', time: 800, participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id], witnesses: [w.v] } }] : [] });
    const first = buffered(w, 'start', 'wrong', 601, { witnesses: [w.v] });
    w.k.settle({ to: 1200 }); expect(w.l3.state.pool).toHaveLength(0); // horizon 600; no direct matcher injection
    w.k.settle({ to: 1800 });
    const e = w.l3.state.pool.find((e) => e.pattern === p.id)!; expect(e, JSON.stringify({ late, log: w.l3.log.slice(-6), buffer: w.l3.state.buffer, defects: w.k.defects })).toBeDefined();
    expect(e.graph!.outcome?.name).toBe(late ? 'done' : '@parked');
    if (late) {
      expect(e.graph!.state).toBe('aftermath'); expect(e.graph!.aftermathUntil).toBe(800 + 3 * 86400);
      const until = e.graph!.aftermathUntil!;
      w.l3.sifter.graph.boundary(until); expect(e.graph!.state).toBe('aftermath');
      w.l3.sifter.graph.boundary(until + 1); expect(e.graph!.state).toBe('resolved');
    }
  }
});

test('SF3-45: fine-tier strangers and group concerns pass their own relevance clauses', () => {
  for (const fine of [false, true]) {
    const w = graphWorld('fine-' + fine, [simple()]); w.l3.data.sifter.relevanceGate = true;
    w.l2.reg.sim = { builds: () => true, eval: () => fine ? 'open' : 'coarse', transitions: () => [], deps: () => ({ interests: [], boundary: false }) };
    emit(w, 'wrong', 1, { place: w.city }); expect(w.l3.state.pool.length).toBe(fine ? 1 : 0);
  }
  const p = simple({ scale: 'concern', roles: { '?a': { kind: 'group' }, '?b': { kind: 'group' } } }), w = graphWorld('group-relevance', [p]);
  w.l3.data.sifter.relevanceGate = true; const a = w.k.root('gang-a', 'core:group'), b = w.k.root('gang-b', 'core:group');
  emit(w, 'wrong', 1, { participants: [{ who: a, role: 'actor' }, { who: b, role: 'target' }] }); expect(w.l3.state.pool).toHaveLength(1);
});

test('SF3-47/67: actual surface and explain deliveries pay debt, with a second modality for must', () => {
  const p = simple(); delete p.junctures.second.realise;
  p.junctures.third = { fn: 'repay', args: { debtor: '?a', creditor: '?b' } };
  p.junctures.fourth = { fn: 'help', args: { by: '?b', to: '?a' } };
  p.edges.push({ from: 'first', to: 'third', link: 'because' }, { from: 'third', to: 'fourth', link: 'because' });
  p.outcomes = { done: { reached: ['fourth'], kind: 'resolved' } };
  const w = graphWorld('actual-explain', [p]); const visual = telling(w); offering(w);
  for (const role of Object.values(visual.seeds[0].roles)) role.claim = { span: 'seed', share: 'any' };
  expect(w.l2.installPack(visual)).toEqual([]);
  const audio = structuredClone(visual); audio.id = 'xf.audio'; audio.seeds[0].id = 'xf.audio:telling'; audio.fragments[0].channels = ['call'];
  audio.seeds[0].sowable = { ...visual.seeds[0].sowable as object, firstClass: w.l2.reg.channels.get('call')!.class };
  expect(w.l2.installPack(audio)).toEqual([]);
  const first = live(w); emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  emit(w, 'payment', 3, { causes: [first.id] }); w.l2.baseTotal = 4000; w.l3.refresh();
  const e = w.l3.state.pool[0]; expect(w.l3.ledger.debt(e)).toBe(2);
  let rows = w.l3.sower.collect(w.l3.counts); expect(rows.some((r) => r.candidate.kind === 'realise')).toBe(false);
  for (const key of ['second', 'third']) {
    const row = w.l3.sower.collect(w.l3.counts).find((r) => r.candidate.kind === 'surface' && r.candidate.juncture === key)!;
    expect(row.kits[0].overlay?.roles?.source.identity).toBe(first.id);
    tell(w, row, row.kits.findIndex((k) => k.pack === visual.id));
  }
  expect(w.l3.ledger.debt(e)).toBe(0);
  w.l3.sifter.patterns.get(p.id)!.graph!.edges[0].shown = 'must'; w.l3.refresh();
  expect(w.l3.ledger.debt(e)).toBe(1);
  rows = w.l3.sower.collect(w.l3.counts);
  const explanation = rows.find((r) => r.candidate.kind === 'explain' && r.candidate.edge === 0)!; expect(explanation, JSON.stringify(w.l3.log.slice(-12))).toBeDefined();
  expect(explanation.kits.every((k) => k.pack === audio.id)).toBe(true); tell(w, explanation);
  expect(w.l3.ledger.signs(e, 0)).toEqual(['told:audio', 'told:visual']); expect(w.l3.ledger.debt(e)).toBe(0);
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.kind === 'realise' && r.candidate.juncture === 'fourth')).toBe(true);
});

test('SF3-54: a real parking closing sows once across reload and does not consume budgets', () => {
  const w = graphWorld('actual-close', [simple()]); live(w);
  const p = pack([kit({ id: 'xf.close:kit', roles: { story: { kind: 'core:event', must: [{ path: 'kind', op: 'eq', arg: 'meta:story' }] } }, sowable: { serves: ['recap'], firstClass: 0 } })]);
  p.id = 'xf.close'; p.fragments[0].roles = ['story']; expect(w.l2.installPack(p)).toEqual([]);
  const e = w.l3.state.pool[0]; w.k.now = 172802; w.l3.sifter.graph.boundary(w.k.now); expect(e.graph!.closing).toBe('needed');
  const before = structuredClone(w.l3.counts); w.l3.refresh(); const closing = e.graph!.seeds.find((s) => s.for === 'closing')!;
  expect(closing).toBeDefined(); w.k.settle(); expect(w.l2.instance(closing.seed)!.st.roles.story.cast).toBe(e.story);
  expect(w.l3.counts.L).toBe(before.L); expect(w.l3.counts.A).toBe(0); // parked pattern retired; the closing adds no budget
  w.k.settle(); w.l3.flush(); w.k.persistence.save('closed'); w.k.newEpoch(); w.k.persistence.load('closed'); w.l3.refresh();
  expect(w.l2.instance(closing.seed)!.st.document.growsFrom).toEqual({ instance: e.id, juncture: '@closing' });
  expect(w.l3.counts).toEqual({ A: 0, L: 0, C: 0, S: 0 });
  expect(w.l2.all().filter((i) => i.st.template.pack === p.id)).toHaveLength(1);
});

test('SF3-50/51/52: computed features, non-cross layers and ring-derived prediction scores', () => {
  const p = simple({ id: 'xf.test:features' }); p.junctures.second = { fn: 'protect', args: { guard: '?b', ward: '?a' } };
  p.junctures.third = { fn: 'help', args: { by: '?b', to: '?a' } };
  p.edges.push({ from: 'second', to: 'third', link: 'because' });
  p.outcomes = { done: { reached: ['third'], kind: 'resolved' }, wait: { reached: ['first'], after: { clock: 'game', days: 1 }, kind: 'parked' } };
  const q = simple({ id: 'xf.test:layer2' }), r = simple({ id: 'xf.test:layer3' });
  q.junctures.second.fn = r.junctures.second.fn = 'repay'; q.junctures.second.args = r.junctures.second.args = { debtor: '?b', creditor: '?a' };
  const w = graphWorld('computed-features', [p, q, r]); offering(w); const first = live(w); w.l2.baseTotal = 4000;
  expect(w.l3.threadView.filter((t) => t.patterns?.length)).toHaveLength(3);
  expect(w.l3.state.pool.every((e) => e.graph!.layers.every((l) => !l.cross))).toBe(true);
  emit(w, 'guarded', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id], witnesses: [w.v], effects: [{ on: w.a, effect: 'harm' }, { on: w.a, effect: 'expose' }] });
  w.l3.refresh(); expect(w.l3.threadView.filter((t) => t.patterns?.length)).toHaveLength(1);
  const e = w.l3.state.pool.find((e) => e.pattern === p.id)!, thread = w.l3.threadView.find((t) => t.patterns?.includes(e.id))!;
  expect(thread.tokens?.filter((t) => t.startsWith('wrong('))).toHaveLength(1);
  const row = w.l3.sower.collect(w.l3.counts).find((r) => r.candidate.entry === e.id && r.candidate.kind === 'realise')!;
  expect(row.candidate.features).toMatchObject({ F3: 2, F6: 1, F13: 2, F14: 1, F15: 2, F16: 0 });
  expect(w.l3.data.sower.featureWeights.F14).toBe(2);
  // Three other real threads acquire the predicted path; no ring values are injected.
  const one = simple({ id: 'xf.test:repeat' }); one.junctures.mid = { fn: 'protect', args: { guard: '?b', ward: '?a' } };
  one.edges = [{ from: 'first', to: 'mid', link: 'because' }, { from: 'mid', to: 'second', link: 'because' }];
  w.l3.installPatterns([one]);
  for (let n = 0; n < 3; n++) {
    const t = 10 + n * 3, wrong = emit(w, 'wrong', t, { witnesses: [w.v] });
    const guard = emit(w, 'guarded', t + 1, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [wrong.id], witnesses: [w.v] });
    emit(w, 'helped', t + 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [guard.id], witnesses: [w.v] });
    w.l3.refresh(); w.l3.sifter.graph.boundary(t + 2);
  }
  // Compare a fresh ready instance against the completed prefixes, using the same actual masks and links.
  const fresh = simple({ id: 'xf.test:predict' }); fresh.junctures.mid = structuredClone(one.junctures.mid); fresh.edges = structuredClone(one.edges);
  delete fresh.junctures.second.realise; w.l3.installPatterns([fresh]);
  const start = emit(w, 'wrong', 30, { witnesses: [w.v] }); emit(w, 'guarded', 31, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [start.id], witnesses: [w.v] }); w.l3.refresh();
  const predicted = w.l3.sower.collect(w.l3.counts).find((r) => r.candidate.pattern === fresh.id && r.candidate.kind === 'realise')!.candidate;
  expect(predicted.skeletonMatches).toBeGreaterThanOrEqual(3);
  const ranked = rankCandidates([predicted], [], w.l3.data)[0]; expect(ranked.score - w.l3.data.sower.lambda * ranked.composite).toBe(-1.5);
});

test('SF3-53: the complete stub S1 hunt uses the real hunted and settlement library and leaves the intention alone', () => {
  const hunt = graphPattern('hunted'), settlement = graphPattern('settlement'), w = graphWorld('full-hunted', [hunt, settlement]);
  const group = w.k.root('hunters', 'core:group'), intention = H(s('punish-record'));
  const act = buffered(w, 'V-act', 'wrong', 1, { participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }], witnesses: [w.b] });
  w.k.now = 2;
  w.k.beliefs.set({ believer: group, subject: w.v, path: 'against', value: 1, confidence: 1, evidence: [act.id], source: { by: 'observed', event: act.id }, formed: 2, refreshed: 2, at: 2, memorable: true });
  let decision: EventView | undefined;
  const rows = (fn: string): StateFill[] => fn === 'blame' ? w.k.beliefs.activeOf(group).filter((b) => b.memorable).map((b) => ({ filler: { belief: b.id }, args: { who: group, of: w.v, for: act.id }, at: 2, causes: b.evidence }))
    : fn === 'pursue' ? w.k.frames.framesOf(group).filter((f) => f.id === intention && f.status === 'active').map(() => ({ filler: { frame: intention }, args: { who: group, target: w.v }, at: 3, causes: [decision!.id] })) : [];
  w.l2.reg.patternWorld = { stateRules: (fn) => ['blame', 'pursue'].includes(fn) ? [{ ...rules(fn, () => rows(fn))[0], changes: [{ slot: '*', scope: { nodes: [group] } }],
    fromChange: (c) => c.c === 'belief' && fn === 'blame' || c.c === 'frame' && fn === 'pursue' ? rows(fn) : [] }] : [],
    relation: (name, args) => name === 'member' && [w.a, w.b].includes(args[0]) && args[1] === group ? 'yes' : 'maybe' };
  w.l3.sifter.syncFrames();
  decision = buffered(w, 'punish', 'decide.punish', 3, { participants: [{ who: group, role: 'actor' }, { who: w.v, role: 'target' }], causes: [act.id] });
  expect(w.l3.kv.event(decision.id)?.kind).toBe('decide.punish');
  w.k.addEdge({ type: 'core:member-of', from: w.a, to: group, attrs: { role: 'leader' }, cause: decision.id });
  w.k.groups.decide(w.a, group, { op: 'open', spec: { id: intention, origin: group, level: 'goal', retain: true, weight: 1, own: {}, payload: { goal: { effects: [{ on: w.v, effect: 'harm' }] } }, focus: { nodes: [], tier: 0 } } });
  const price = buffered(w, 'price', 'price', 4, { participants: [{ who: w.b, role: 'actor' }, { who: w.v, role: 'target' }], causes: [decision.id] });
  buffered(w, 'premature-confront', 'confront', 5, { participants: [{ who: w.b, role: 'actor' }, { who: w.v, role: 'target' }], causes: [decision.id] });
  w.k.settle();
  const queued = w.l3.state.buffer.find((b) => b.event.id === decision!.id)!;
  expect(queued).toBeDefined(); expect(w.l3.sifter.graph.world.eventFills(queued.event).find((f) => f.fn === 'decide')?.args, JSON.stringify(queued)).toEqual({ group, what: w.v });
  w.k.settle({ to: 600 }); w.l3.refresh();
  const e = w.l3.state.pool.find((e) => e.pattern === hunt.id)!; expect(e).toBeDefined();
  expect(e.graph!.junctures.hunting.filler?.ref).toEqual({ frame: intention }); expect(e.graph!.junctures.warned.filler).toBeUndefined(); expect(e.graph!.junctures.caught.filler).toBeUndefined();
  perceive(w, group); // the delivered warning identifies the group, without revealing its decision
  const warning = buffered(w, 'warning', 'warning', 601, { participants: [{ who: w.a, role: 'actor' }, { who: w.v, role: 'target' }], causes: [decision.id], witnesses: [w.v] });
  w.k.settle({ to: 1200 }); w.l3.refresh();
  telling(w); w.l2.baseTotal = 4000;
  const surface = w.l3.sower.collect(w.l3.counts).find((r) => r.candidate.entry === e.id && r.candidate.kind === 'surface' && r.candidate.juncture === 'decided')!;
  expect(surface).toBeDefined(); expect(surface.candidate.features.F16).toBe(1); expect(w.l2.exposure(act.id)?.grade).toBe('confirmed');
  expect(surface.candidate.features.F16).toBe(Math.max(...w.l3.sower.collect(w.l3.counts).map((r) => r.candidate.features.F16 ?? 0)));
  tell(w, surface); expect(e.graph!.junctures.decided.perceived).toBeDefined();
  const confrontation = buffered(w, 'caught', 'confront', 1201, { participants: [{ who: w.b, role: 'actor' }, { who: w.v, role: 'target' }], causes: [warning.id, decision.id], witnesses: [w.v] });
  w.k.settle({ to: 1800 }); w.l3.refresh();
  expect(e.bindings, JSON.stringify({ g: e.graph, log: w.l3.log.slice(-12), buffer: w.l3.state.buffer })).toMatchObject({ '?q': w.v, '?h': group, '?j': act.id, '?w': w.a, '?m': w.b });
  expect(e.graph!.junctures.decided.filler?.id).toBe(decision.id); expect(e.graph!.junctures.warned.filler?.id).toBe(warning.id);
  expect(e.graph!.junctures.warned.filler?.id).not.toBe(price.id); expect(e.graph!.junctures.caught.filler?.id).toBe(confrontation.id);
  expect(e.graph!.junctures.sheltered.filler).toBeUndefined(); expect(e.graph!.outcome?.name).toBe('caught');
  const offer = miniPack({ id: 'xf.redress' }), seed = offer.seeds[0]; seed.id = 'xf.redress:offer';
  seed.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }]; seed.roles.npc.kind = 'core:group'; seed.roles.cause = { kind: 'core:event', optional: true };
  seed.sowable = { serves: ['offer'], firstClass: 2, fills: [{ fn: 'repay', args: { debtor: 'v', creditor: 'npc' }, cause: 'cause' }] }; offer.fragments[0].offer!.asker = 'npc';
  expect(w.l2.installPack(offer)).toEqual([]); nudging(w); telling(w); w.l2.baseTotal = 4000; w.l3.refresh();
  const before = structuredClone(w.k.frames.frame(intention)), candidates = w.l3.sower.collect(w.l3.counts);
  expect(candidates.some((r) => r.candidate.pattern === hunt.id && r.candidate.kind === 'realise')).toBe(false);
  const wayOut = candidates.find((r) => r.candidate.pattern === settlement.id && r.candidate.juncture === 'terms' && r.candidate.realisation === 'offer');
  expect(wayOut, JSON.stringify({ pool: w.l3.state.pool, log: w.l3.log.slice(-12) })).toBeDefined(); expect(wayOut!.kits[0].overlay?.roles?.npc.identity).toBe(group);
  expect(candidates.some((r) => r.candidate.realisation === 'nudge')).toBe(false);
  expect(w.k.frames.frame(intention)).toEqual(before); expect(w.k.frames.framesOf(w.v)).toEqual([]);
});

test('SF3-55: real grievance children become a perceived feud only with an answered offer', () => {
  const grief = graphPattern('grievance'), feud = graphPattern('feud'), w = graphWorld('real-feud', [grief, feud]);
  const row = (fn: string) => rules(fn, () => [w.a, w.b].flatMap((who) => w.k.beliefs.activeOf(who).filter((b) => b.path === 'against').map((b) => ({
    filler: { belief: b.id }, args: { who, of: b.subject, for: b.evidence[0] }, at: b.at ?? 0, causes: b.evidence }))));
  w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'blame' ? [{ ...row(fn)[0], changes: [{ slot: '*', scope: { nodes: [w.a, w.b] } }], fromChange: (c) => c.c === 'belief' ? row(fn)[0].search('who', c.believer, w.k.now, 8).fills : [] }] : [] };
  w.l3.sifter.syncFrames();
  const p = offering(w); p.seeds[0].end = 'no'; for (const r of Object.values(p.seeds[0].roles)) r.claim = { span: 'seed', share: 'any' };
  p.seeds[0].realises = [{ pattern: grief.id, juncture: 'avenged', by: 'end', binds: { '?wr': 'npc', '?by': 'other' } }];
  expect(w.l2.installPack(p)).toEqual([]);
  const keep = (a: string, b: string, cause: string) => {
    const r = w.l2.sow(p.id, p.seeds[0].id, { by: 'director', decision: H(s('feud-child'), s(a)), localName: a.slice(0, 8), overlay: { roles: { npc: { identity: a }, other: { identity: b }, cause: { identity: cause } } } });
    expect(r.ok).toBe(true); w.k.settle(); w.l3.refresh();
    const inst = w.l2.instance(r.instance!)!;
    expect(w.l3.state.pool.find((e) => e.pattern === grief.id && e.bindings['?wr'] === a)?.graph!.seeds.some((s) => s.seed === inst.id), JSON.stringify(inst.st)).toBe(true);
    return inst;
  };
  const wrong = emit(w, 'wrong', 1, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }] });
  const believe = (who: string, of: string, ground: string, at: number) => {
    w.k.now = at; const belief = w.k.beliefs.set({ believer: who, subject: of, path: 'against', value: 1, confidence: 1, evidence: [ground], source: { by: 'observed', event: ground }, formed: at, refreshed: at, at, memorable: true });
    w.k.settle(); w.l3.sifter.boundary(at, 0); return belief;
  };
  believe(w.a, w.b, wrong.id, 2); const seed = keep(w.a, w.b, wrong.id);
  const revenge = emit(w, 'wrong', 3, { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }], causes: [wrong.id] });
  believe(w.b, w.a, revenge.id, 4); keep(w.b, w.a, revenge.id);
  const counter = emit(w, 'wrong', 5, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [revenge.id] });
  w.l3.sifter.boundary(6, 0); w.l3.refresh();
  const f = w.l3.state.pool.find((e) => e.pattern === feud.id && e.graph!.junctures.opened.filler?.id === wrong.id)!;
  expect(f).toBeDefined(); expect(f.graph!.junctures.answered.filler?.fn, JSON.stringify({ pool: w.l3.state.pool, log: w.l3.log.slice(-12) })).toBe('story'); expect(f.graph!.junctures.countered.filler?.fn).toBe('story'); expect(f.graph!.state).toBe('forming');
  expect(f.graph!.junctures.answered.perceived).toBeUndefined(); expect(f.graph!.junctures.countered.perceived).toBeUndefined();
  const visual = telling(w); for (const role of Object.values(visual.seeds[0].roles)) role.claim = { span: 'seed', share: 'any' }; expect(w.l2.installPack(visual)).toEqual([]);
  const audio = structuredClone(visual); audio.id = 'xf.bark'; audio.seeds[0].id = 'xf.bark:telling'; audio.fragments[0].channels = ['bark']; expect(w.l2.installPack(audio)).toEqual([]);
  // Actual S2 deliveries supply both modalities to each child's must edge, with no pull.
  for (const [a, b] of [[wrong.id, revenge.id], [revenge.id, counter.id]]) for (const k of [visual, audio]) {
    const out = w.l2.sow(k.id, k.seeds[0].id, { by: 'director', decision: H(s('feud-tell'), s(k.id), s(a)), localName: a.slice(0, 8), overlay: { roles: { evidence: { identity: b }, source: { identity: a } } } }); expect(out.ok).toBe(true);
    w.k.settle(); const inst = w.l2.instance(out.instance!)!;
    for (let n = 0; n < 60 && !inst.st.deliveries.some((d) => d.state === 'released'); n++) w.l2.advancePlay(w.l2.arbiter.play + 1);
    const d = inst.st.deliveries.find((d) => d.state === 'released')!; expect(d, JSON.stringify({ pack: k.id, record: inst.st.record.slice(-4), deliveries: inst.st.deliveries })).toBeDefined(); w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: w.l2.playTotal() }); w.l3.refresh();
  }
  expect(f.graph!.junctures.answered.perceived).toBeDefined(); expect(f.graph!.junctures.countered.perceived).toBeDefined(); expect(f.graph!.state).toBe('forming');
  for (const d of seed.st.deliveries.filter((d) => d.what === 'offer' && d.state === 'queued')) w.l2.pull(d.id);
  for (let n = 0; n < 150 && !seed.st.deliveries.some((d) => d.what === 'offer' && d.state === 'released'); n++) w.l2.advancePlay(w.l2.arbiter.play + 1);
  const offer = seed.st.deliveries.find((d) => d.what === 'offer')!; expect(offer).toBeDefined(); expect(w.l2.respond(offer.id, { kind: 'action', id: 'go' }), JSON.stringify({ state: seed.st.state, offer, record: seed.st.record.slice(-8) })).toBe(true);
  w.l3.refresh(); expect(f.graph!.state).toBe('live'); expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.pattern === feud.id && r.candidate.kind === 'realise')).toBe(false);
});

test('story motive requires a constituent NPC motive as well as the causal path', () => {
  for (const variant of ['NPC', 'causal-only', 'V'] as const) {
    const w = graphWorld('story-motive-' + variant, [simple()]), actor = variant === 'V' ? w.v : w.b, first = emit(w, 'wrong', 1);
    if (variant !== 'causal-only') w.k.beliefs.set({ believer: actor, subject: first.id, path: 'kind', value: 'wrong', confidence: 1, evidence: [first.id], source: { by: 'observed', event: first.id }, at: 1, formed: 1, refreshed: 1, memorable: true });
    const next = emit(w, 'wrong', 2, { participants: [{ who: actor, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
    const story = emit(w, 'meta:story', 3, { causes: [next.id], data: { pattern: 'xf.test:other', instance: w.a, outcome: 'done', kind: 'resolved', depth: 1 } });
    const a = w.l3.sifter.graph.world.eventFills(first)[0], b = w.l3.sifter.graph.world.eventFills(story)[0];
    expect(linkHolds(w.l3.sifter.graph.world, 'motive', a, b, { fn: 'story', args: {} }, w.l3.data.sifter)).toBe(variant === 'NPC');
  }
});

test('settlement v2: NPC payment, V refusal and lapse work; cited responses belong to this instance', () => {
  for (const mode of ['valid', 'unrelated-cause', 'other-instance', 'lapse', 'NPC'] as const) {
    const p = graphPattern('settlement'), twin = structuredClone(p); twin.id = 'xf.test:settlement-twin';
    const w = graphWorld('settlement-' + mode, [p, twin]), debtor = mode === 'NPC' ? w.b : w.v;
    const act = emit(w, 'wrong', 1, { participants: [{ who: debtor, role: 'actor' }, { who: w.a, role: 'target' }] });
    w.k.now = 2;
    const belief = w.k.beliefs.set({ believer: w.a, subject: debtor, path: 'against', value: 1, confidence: 1, evidence: [act.id], source: { by: 'observed', event: act.id }, at: 2, formed: 2, refreshed: 2, memorable: true });
    w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'blame' ? [{ ...rules(fn, () => [{ filler: { belief }, at: 2, args: { who: w.a, of: debtor, for: act.id }, causes: [act.id] }])[0],
      changes: [{ slot: '*', scope: { nodes: [w.a] } }], fromChange: (c) => c.c === 'belief' ? [{ filler: { belief }, at: 2, args: { who: w.a, of: debtor, for: act.id }, causes: [act.id] }] : [] }] : [] };
    w.l3.sifter.syncFrames(); w.k.settle(); w.l3.sifter.boundary(3, 0); w.l3.refresh();
    const e = w.l3.state.pool.find((e) => e.pattern === p.id)!; expect(e).toBeDefined();
    if (mode === 'lapse') {
      w.l3.sifter.graph.boundary(2 + 21 * 86400); expect(e.graph!.outcome?.name).toBe('unanswered');
      expect(e.graph!.state).toBe('parked'); expect(p.outcomes.unanswered.next).toEqual(['xf.composite:loose-end']); continue;
    }
    if (mode === 'NPC') {
      w.k.beliefs.set({ believer: debtor, subject: w.a, path: 'owed', value: 1, confidence: 1, evidence: [e.graph!.junctures.dispute.filler!.id], source: { by: 'inferred', rule: { name: 'terms', version: 1 }, from: [belief] }, at: 2, formed: 2, refreshed: 2, memorable: true });
      emit(w, 'payment', 3, { participants: [{ who: debtor, role: 'actor' }, { who: w.a, role: 'target' }], causes: [act.id] });
      expect(e.graph!.outcome?.name).toBe('settled'); continue;
    }
    const offer = miniPack({ id: 'xf.settlement-offer' }), seed = offer.seeds[0]; seed.id = 'xf.settlement-offer:kit'; seed.end = 'no';
    seed.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }]; seed.roles.cause = { kind: 'core:event' }; offer.fragments[0].roles.push('cause'); offer.fragments[0].offer!.asker = 'npc';
    seed.realises = [{ pattern: mode === 'other-instance' ? twin.id : p.id, juncture: 'terms', by: 'end', binds: { '?a': 'npc', '?b': 'v' } }];
    expect(w.l2.installPack(offer)).toEqual([]);
    const cause = mode === 'unrelated-cause' ? emit(w, 'generic', 3).id : act.id;
    const out = w.l2.sow(offer.id, seed.id, { by: 'director', decision: H(s('redress')), overlay: { roles: { npc: { identity: w.a }, cause: { identity: cause } } } }); expect(out.ok).toBe(true);
    w.k.settle(); w.l3.refresh(); const inst = w.l2.instance(out.instance!)!;
    for (const d of inst.st.deliveries) w.l2.pull(d.id); w.l2.advancePlay(1);
    const d = inst.st.deliveries.find((d) => d.what === 'offer')!; expect(d.state).toBe('released'); expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    w.k.settle(); w.l3.sifter.boundary(600, 0);
    expect(e.graph!.outcome?.name).toBe(mode === 'valid' ? 'refused' : undefined);
    if (mode === 'valid') expect(p.outcomes.refused.next).toEqual(['xf.composite:grievance']);
  }
});

test('SF3-66: a real end realisation with mismatching casts cannot pay another debt', () => {
  for (const agrees of [false, true]) {
    const p = graphPattern('debt'), w = graphWorld('debt-end-' + agrees, [p]);
    const favour = emit(w, 'favour', 1), want = emit(w, 'wanted', 2, { participants: [{ who: w.a, role: 'actor' }, { who: favour.id, role: 'told' }], causes: [favour.id] });
    const frame = H(s('debt-frame')); w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: want.id, level: 'goal', retain: true, weight: 1, own: {}, payload: {}, focus: { nodes: [], tier: 0 } });
    const demand = emit(w, 'demand', 3, { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }, { who: favour.id, role: 'told' }], served: frame, causes: [want.id] });
    const e = w.l3.state.pool[0], seedPack = offering(w); seedPack.seeds[0].realises = [{ pattern: p.id, juncture: 'paid', by: 'end', binds: { '?d': 'npc', '?c': 'other' } }];
    seedPack.seeds[0].end = 'seedFact(stage) == 1'; for (const r of Object.values(seedPack.seeds[0].roles)) r.claim = { span: 'seed', share: 'any' };
    expect(w.l2.installPack(seedPack)).toEqual([]);
    const out = w.l2.sow(seedPack.id, seedPack.seeds[0].id, { by: 'director', decision: H(s('pay-debt')), overlay: { roles: { npc: { identity: agrees ? w.b : w.a }, other: { identity: agrees ? w.a : w.b }, cause: { identity: demand.id } } } }); expect(out.ok).toBe(true);
    w.k.settle(); const inst = w.l2.instance(out.instance!)!; for (const d of inst.st.deliveries) w.l2.pull(d.id); w.l2.advancePlay(1);
    const d = inst.st.deliveries.find((d) => d.what === 'offer')!; expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    w.k.settle(); w.l3.sifter.boundary(600, 0); expect(inst.st.closed).toBeDefined();
    expect(w.l2.realisedBy(inst.st.closed!.event)[0].fn).toBe('repay'); expect(e.graph!.outcome?.name).toBe(agrees ? 'settled' : undefined);
  }
});
