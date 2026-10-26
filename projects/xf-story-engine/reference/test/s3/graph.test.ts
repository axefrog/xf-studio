import { expect, test } from 'bun:test';
import { graphWorld, graphPattern, emit, simple, perceive } from './graph-fixture.ts';
import { library } from './library.ts';
import { linkHolds } from '../../src/procedural/graph-links.ts';
import type { MatchedFiller } from '../../src/procedural/graph-types.ts';
import { H, s } from '../../src/id.ts';

test('SF3-39: a debt graph matches its past, call and settlement; foreclosure is final', () => {
  const w = graphWorld('debt', [graphPattern('debt')]);
  const favour = emit(w, 'favour', 1, { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }] });
  const e = w.l3.state.pool[0]; expect(e.graph!.junctures.owed.filler?.id).toBe(favour.id);
  const want = emit(w, 'wanted', 2, { participants: [{ who: w.a, role: 'actor' }, { who: favour.id, role: 'told' }], causes: [favour.id] });
  // A motive reads a durable served frame, never the later event's bare cause alone.
  const frame = H(s('debt-want'));
  w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: want.id, level: 'situation', weight: 1, parents: [], status: 'active', own: {}, payload: {}, focus: { nodes: [], tier: 0 } });
  const demand = emit(w, 'demand', 3, { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }, { who: favour.id, role: 'told' }], served: frame, causes: [want.id] });
  expect(e.graph!.junctures.called.filler?.id).toBe(demand.id);
  emit(w, 'payment', 4, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [demand.id] });
  expect(e.graph!.outcome?.name).toBe('settled');
  const story = e.story; emit(w, 'wrong', 5, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }] });
  expect(e.graph!.junctures.defaulted.state).toBe('foreclosed'); expect(e.story).toBe(story);
  expect(w.l3.kv.event(story!)?.data).toMatchObject({ pattern: e.pattern, instance: e.id, outcome: 'settled', kind: 'resolved', depth: 1 });
});

test('SF3-40/56: multi-function starts and layers; one occurrence starts once, including redelivery', () => {
  const a = simple({ id: 'xf.test:multi', entry: ['first', 'also'], junctures: {
    first: { fn: 'demand', args: { by: '?a', of: '?b' } }, also: { fn: 'wrong', args: { by: '?a', to: '?b' } },
    second: { fn: 'comply', args: { who: '?b', to: '?a' } } }, edges: [{ from: 'first', to: 'second', link: 'answers' }], outcomes: { done: { reached: ['second'], kind: 'resolved' } } });
  const w = graphWorld('multi', [a, simple()]);
  const event = emit(w, 'shakedown', 1); const e = w.l3.state.pool.find((e) => e.pattern === a.id)!;
  expect(e.graph!.junctures.second.filler?.id).toBe(event.id);
  expect(e.graph!.used[0].fns).toEqual(expect.arrayContaining(['wrong', 'demand', 'comply']));
  expect(e.graph!.layers).toHaveLength(1);
  const before = structuredClone(w.l3.state.pool);
  for (const p of w.l3.sifter.patterns.values()) w.l3.sifter.onEvent(p, event);
  expect(w.l3.state.pool).toEqual(before);
});

test('SF3-41/69: searchable relations bind in record order, fixed identities seed the search', () => {
  const p = simple(); p.roles['?a'].identity = { fixed: 'root:mara' };
  p.junctures.first.requires = [{ rel: 'member', args: ['?a', '?g'] }]; p.roles['?g'] = { kind: 'group' };
  const w = graphWorld('relation', [p]), group = w.k.root('crew', 'core:group');
  w.l2.reg.patternWorld = { stateRules: () => [], relationSearch: (_, args) => ({ tuples: [{ id: group, args: { who: args.who, group } }], truncated: true }) };
  emit(w, 'wrong', 1, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }] }); expect(w.l3.state.pool).toHaveLength(0);
  emit(w, 'wrong', 2); expect(w.l3.state.pool[0].bindings['?g']).toBe(group);
  expect(w.l3.log.some((l) => l.rule === 'query-truncated')).toBe(true);
});

test('SF3-42: bounded causes at one and three hops; a fourth hop is a near miss', () => {
  for (const hops of [1, 3, 4]) {
    const w = graphWorld('hops' + hops, [simple()]); let prior = emit(w, 'wrong', 1);
    const e = w.l3.state.pool[0];
    for (let n = 1; n < hops; n++) prior = emit(w, 'generic', n + 1, { causes: [prior.id] });
    emit(w, 'helped', hops + 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [prior.id] });
    expect(!!e.graph!.outcome).toBe(hops <= 3);
    if (hops === 4) expect(w.l3.log.some((l) => l.rule === 'near-miss')).toBe(true);
  }
});

test('SF3-43/55: story chaining is inert and bounded; shapes never realise', () => {
  const p = simple(), closure = simple({ id: 'xf.test:closure', family: 'shape', roles: { '?a': { kind: 'person' } }, entry: ['story'],
    junctures: { story: { fn: 'story', args: { pattern: p.id, outcome: 'done' }, binds: { a: '?a' } } }, edges: [], outcomes: { done: { reached: ['story'], kind: 'resolved' } }, show: { junctures: ['story'], edges: 0 } });
  const w = graphWorld('story', [p, closure]);
  const first = emit(w, 'wrong', 1); emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  w.l3.sifter.boundary(600, 0);
  const c = w.l3.state.pool.find((e) => e.pattern === closure.id);
  // The shape has already retired once its one outcome is fixed, but its story is retained by the log.
  const complete = w.l3.log.find((l) => l.rule === 'match-complete' && l.data.instance !== w.l3.state.pool[0]?.id);
  expect(c?.graph!.depth ?? (complete ? 2 : 0)).toBe(2);
  expect(w.l3.sower.collect(w.l3.counts).some((c) => c.candidate.pattern === closure.id && c.candidate.kind === 'realise')).toBe(false);
});

test('SF3-44/63: outcome clocks and deadlines wait for the publication horizon; sweep is storage only', () => {
  const p = simple({ outcomes: { timeout: { reached: ['first'], after: { clock: 'game', days: 2 }, kind: 'parked' } } });
  const w = graphWorld('horizon', [p]); emit(w, 'wrong', 0);
  const e = w.l3.state.pool[0]; w.l3.sifter.graph.boundary(172799); expect(e.graph!.outcome).toBeUndefined();
  w.l3.sifter.sweep(999999); expect(e.graph!.outcome).toBeUndefined();
  w.l3.sifter.graph.boundary(172800); expect(e.graph!.outcome?.name).toBe('timeout');
  const twin = graphWorld('late-fill', [simple()]); const first = emit(twin, 'wrong', 0);
  twin.l3.sifter.graph.boundary(172800); expect(twin.l3.state.pool[0].graph!.state).toBe('forming');
  emit(twin, 'helped', 172800, { participants: [{ who: twin.b, role: 'actor' }, { who: twin.a, role: 'target' }], causes: [first.id] });
  expect(twin.l3.state.pool[0].graph!.outcome?.name).toBe('done');
});

test('SF3-45: relevance admits known people and ignores coarse strangers', () => {
  const w = graphWorld('relevance', [simple()]); w.l3.data.sifter.relevanceGate = true;
  emit(w, 'wrong', 1); expect(w.l3.state.pool).toHaveLength(0);
  perceive(w); emit(w, 'wrong', 2); expect(w.l3.state.pool).toHaveLength(1);
});

test('SF3-58/62/65: copied state evidence and protagonist targets survive fresh reloads', () => {
  const w = graphWorld('state-save', [simple()]); emit(w, 'wrong', 1, { witnesses: [w.v] }); w.l3.refresh();
  const e = w.l3.state.pool[0], before = structuredClone(e.graph!.junctures.first.perceived);
  expect(before).toBeDefined(); w.l3.flush(); w.k.persistence.save('graph');
  w.k.persistence.load('graph');
  expect(w.l3.state.pool[0].graph!.junctures.first.perceived).toEqual(before);
  expect(w.l3.state.schema).toBe(2); expect(w.l3.state.skeletons.ring).toHaveLength(1);
});

test('SF3-61: pending junctures match immediately and clear pending without dropping their seed', () => {
  const w = graphWorld('pending', [simple()]); const first = emit(w, 'wrong', 1);
  const e = w.l3.state.pool[0]; e.graph!.junctures.second.state = 'pending'; e.graph!.junctures.second.pending = w.a;
  e.graph!.seeds.push({ seed: w.a, for: 'second' });
  emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  expect(String(e.graph!.junctures.second.state)).toBe('matched'); expect(e.graph!.junctures.second.pending).toBeUndefined(); expect(e.graph!.seeds).toHaveLength(1);
});

test('SF3-64: any joins accept one borne link while all joins reject a missing source', () => {
  for (const join of ['any', 'all'] as const) {
    const p = simple(); p.junctures.missing = { fn: 'repay', args: { debtor: '?a', creditor: '?b' } }; p.junctures.second.join = join;
    p.edges.push({ from: 'missing', to: 'second', link: 'because' });
    const w = graphWorld('join-' + join, [p]), first = emit(w, 'wrong', 1);
    emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
    expect(!!w.l3.state.pool[0].graph!.outcome).toBe(join === 'any');
  }
});

test('SF3-70: the whole composite library loads with rule-derived warnings', () => {
  const w = graphWorld('library'); const findings = w.l3.installPatterns(library);
  expect(findings.filter((f) => f.level === 'error')).toEqual([]);
  expect(findings.filter((f) => f.code === 'L-145')).toHaveLength(22);
  expect(w.l3.sifter.patterns.size).toBe(29);
});

test('SF3-53/65: hunted binds the world grievance about V, never a protagonist mind or a shape realisation', () => {
  const p = graphPattern('hunted'), w = graphWorld('hunted-records', [p]);
  const group = w.k.root('hunters', 'core:group'), act = emit(w, 'wrong', 1, { participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }], witnesses: [w.b] });
  const belief = H(s('group-grudge'));
  w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'blame' ? [{ id: 'fixture-blame', fn, durable: true, changes: [],
    fromChange: (c) => c.c === 'belief' ? [{ filler: { belief }, args: { who: c.believer, of: c.subject, for: act.id }, at: 2, causes: [act.id] }] : [],
    endsBy: () => false, search: () => ({ fills: [], truncated: false }), holdsAt: () => 'yes' }] : [] };
  const change = { c: 'belief' as const, belief, believer: group, subject: w.v, path: 'against', op: 'set' as const, by: 'observed' as const, evidence: [act.id] };
  w.l3.sifter.graph.onChange(w.l3.sifter.patterns.get(p.id)!, change, undefined, 2);
  expect(w.l3.state.pool).toHaveLength(1); expect(w.l3.state.pool[0].bindings).toMatchObject({ '?h': group, '?q': w.v, '?j': act.id });
  const before = w.l3.state.pool.length;
  w.l3.sifter.graph.onChange(w.l3.sifter.patterns.get(p.id)!, { ...change, believer: w.v }, undefined, 3);
  expect(w.l3.state.pool).toHaveLength(before);
  w.l3.refresh(); expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.kind === 'realise')).toBe(false);
});

test('SF3-54: only a counted thread needs a parking closing; at off it expires once', () => {
  const w = graphWorld('closing', [simple()]); perceive(w); emit(w, 'wrong', 1, { witnesses: [w.v] }); w.l3.refresh();
  const e = w.l3.state.pool[0]; expect(w.l3.ledger.aware(e)).toBe(true);
  w.l3.sifter.graph.boundary(172802); expect(e.graph!.closing).toBe('needed');
  w.k.settings.set({ tempo: 'off' }); w.l3.refresh(); expect(e.graph!.closing).toBe('needed');
  w.k.now = 172801 + w.l3.data.sifter.candidateTtl + 1; w.l3.refresh(); expect(String(e.graph!.closing)).toBe('none');
  expect(w.l2.all()).toHaveLength(0);
});

test('SF3-65/67: V may learn as a witness; own acts use declared roles, including pack kinds', () => {
  const p = simple({ roles: { '?a': { kind: 'event' }, '?v': { kind: 'person', v: 'may' } }, entry: ['seen'],
    junctures: { seen: { fn: 'learn', args: { who: '?v', what: '?a' } } }, edges: [],
    outcomes: { done: { reached: ['seen'], kind: 'resolved' } }, show: { junctures: ['seen'], edges: 0 } });
  const w = graphWorld('learn-is-not-act', [p]);
  emit(w, 'wrong', 1, { witnesses: [w.v] });
  expect(w.l3.state.pool).toHaveLength(1);
  expect(w.l3.state.pool[0].bindings['?v']).toBe(w.v);
  const world = w.l3.sifter.graph.world;
  const own = emit(w, 'helped', 2, { participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }], witnesses: [w.b] });
  expect(world.acts(own, w.v)).toBe(true);
  expect(world.acts(own, w.a)).toBe(false);
  expect(world.relation('observed-act', [own.id, w.v], 2)).toBe('yes');
  w.l2.worldRegistry.agentRoles = () => ['target'];
  expect(world.acts(own, w.v)).toBe(false);
  expect(world.acts(own, w.a)).toBe(true);
});

test('SF3-42: a retained goal alone does not prove motive; durable evidence does', () => {
  const w = graphWorld('recorded-motive'), first = emit(w, 'wrong', 1);
  const frame = H(s('unserved-goal'));
  w.k.frames.open({ id: frame, actor: w.b, origin: w.b, cause: first.id, level: 'situation', retain: true,
    status: 'active', weight: 1, own: {}, payload: {}, focus: { nodes: [], tier: 0 } });
  const later = emit(w, 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  const before: MatchedFiller = { id: first.id, ref: { event: first.id }, fn: 'wrong', at: 1, args: { by: w.a, to: w.b }, source: 'found' };
  const after: MatchedFiller = { id: later.id, ref: { event: later.id }, fn: 'help', at: 2, args: { by: w.b, to: w.a }, source: 'found' };
  const j = { fn: 'help', args: { by: '?b', to: '?a' } };
  expect(linkHolds(w.l3.sifter.graph.world, 'motive', before, after, j, w.l3.data.sifter)).toBe(false);
  w.k.beliefs.set({ believer: w.b, subject: first.id, path: 'kind', value: 'wrong', confidence: 1, evidence: [first.id],
    source: { by: 'observed', event: first.id }, formed: 1, refreshed: 1, at: 1, memorable: true });
  expect(linkHolds(w.l3.sifter.graph.world, 'motive', before, after, j, w.l3.data.sifter)).toBe(true);
});
