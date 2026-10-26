import { expect, test } from 'bun:test';
import { graphWorld, emit, simple } from './graph-fixture.ts';
import { telling, offering, nudging, live } from './graph-kits.ts';
import { rankCandidates } from '../../src/procedural/sower.ts';
import { sowableFindings } from '../../src/procedural/lint.ts';
import { H, s } from '../../src/id.ts';

test('SF3-46: a live ready juncture offers with bound actor, target, cause and growsFrom; no V-link waits', () => {
  const p = simple(); delete p.junctures.second.realise;
  const w = graphWorld('offer', [p]); offering(w); const first = live(w);
  w.l2.baseTotal = 4000;
  const rows = w.l3.sower.collect(w.l3.counts), row = rows.find((r) => r.candidate.kind === 'realise')!;
  expect(row).toBeDefined(); expect(row.kits[0].overlay).toEqual({ roles: { npc: { identity: w.b }, other: { identity: w.a }, cause: { identity: first.id } }, growsFrom: { instance: w.l3.state.pool[0].id, juncture: 'second' } });
  const twin = graphWorld('offer-unmet', [p]); offering(twin); emit(twin, 'wrong', 1); twin.l2.baseTotal = 4000; twin.l3.refresh();
  expect(twin.l3.sower.collect(twin.l3.counts).some((r) => r.candidate.kind === 'realise')).toBe(false);
});

test('SF3-47/67: debt blocks realising; surface and explain kits bind both actual fillers', () => {
  const p = simple(); delete p.junctures.second.realise;
  p.junctures.third = { fn: 'repay', args: { debtor: '?a', creditor: '?b' } };
  p.edges.push({ from: 'first', to: 'third', link: 'because' });
  p.outcomes = { done: { reached: ['second', 'third'], kind: 'resolved' } };
  const w = graphWorld('debt-gate', [p]); telling(w); offering(w); const first = live(w);
  const e = w.l3.state.pool[0], f = { ref: { event: first.id }, id: first.id, fn: 'repay', at: 2, args: { debtor: w.a, creditor: w.b }, source: 'found' as const };
  const second = emit(w, 'generic', 2, { causes: [first.id] }), third = emit(w, 'generic', 3, { causes: [first.id] });
  e.graph!.junctures.second = { state: 'matched', filler: { ...f, id: second.id, ref: { event: second.id }, fn: 'help' } };
  e.graph!.junctures.third = { state: 'matched', filler: { ...f, id: third.id, ref: { event: third.id } } };
  e.graph!.junctures.fourth = { state: 'ready', readySince: 3 };
  p.junctures.fourth = { fn: 'help', args: { by: '?b', to: '?a' } };
  w.l3.sifter.patterns.get(p.id)!.graph!.junctures.fourth = p.junctures.fourth;
  w.l2.baseTotal = 4000; w.l3.refresh();
  expect(w.l3.ledger.debt(e)).toBe(2);
  const rows = w.l3.sower.collect(w.l3.counts);
  expect(rows.filter((r) => r.candidate.kind === 'surface')).toHaveLength(2);
  expect(rows.some((r) => r.candidate.kind === 'realise')).toBe(false);
  expect(w.l3.log.some((l) => l.rule === 'gate-11')).toBe(true);
  const overlay = rows.find((r) => r.candidate.kind === 'surface')!.kits[0].overlay!;
  expect(overlay.roles!.source.identity).toBe(first.id);
  // These are the ordinary receipts S2 writes when the telling reaches the protagonist.
  const receipt = (channel: string) => ({ delivery: H(s(channel)), seed: w.a, template: 'fixture', grade: 'presented' as const, channels: [channel], cites: [first.id, second.id, third.id], cue: {}, at: 3, playTotal: 0 });
  w.l2.global.receipts.push(receipt('message')); w.l3.refresh();
  expect(w.l3.ledger.debt(e)).toBe(0);
  w.l3.sifter.patterns.get(p.id)!.graph!.edges[0].shown = 'must';
  expect(w.l3.ledger.debt(e)).toBe(1);
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.kind === 'explain')).toBe(false); // visual kit cannot supply the second modality
  w.l2.global.receipts.push(receipt('call')); w.l3.refresh(); expect(w.l3.ledger.debt(e)).toBe(0);
});

test('SF3-48: escalation without pull is refused before ranking', () => {
  const p = simple({ escalation: ['second'] }); delete p.junctures.second.realise;
  const w = graphWorld('escalation', [p]); offering(w); live(w); w.l2.baseTotal = 4000;
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.kind === 'realise')).toBe(false);
  expect(w.l3.log.find((l) => l.rule === 'gate-12')?.data.condition).toBe('pull');
});

test('SF3-49: nudge eligibility waits for the world and excludes protagonist actors and the live cap', () => {
  const p = simple(); p.junctures.second.realise = [{ nudge: {} }];
  const w = graphWorld('nudge-gates', [p]); nudging(w); live(w);
  const e = w.l3.state.pool[0]; w.l3.data.sower.nudgeAfter = 10;
  w.k.now = 10; expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.realisation === 'nudge')).toBe(false);
  expect(e.graph!.junctures.second.readySince).toBe(1);
  w.k.now = 11;
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.realisation === 'nudge')).toBe(true);
  w.l3.state.nudges = Array.from({ length: w.l3.data.sower.maxNudges }, (_, n) => ({ instance: H(s('live-nudge-' + n)), sownAt: 0 }));
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.realisation === 'nudge')).toBe(false);
  w.l3.state.nudges = [];
  // Static illegality is checked even when a matching kit exists; S2 tests the silent start separately.
  e.bindings['?b'] = w.v; w.k.now = 11;
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.realisation === 'nudge')).toBe(false);
});

test('SF3-50/51: graph features and skeleton diversity are frozen, with a 32-thread ring', () => {
  const w = graphWorld('skeleton', [simple()]); live(w); const e = w.l3.state.pool[0];
  expect(w.l3.state.skeletons.ring).toHaveLength(1); expect(w.l3.threadView[0].tokens).toEqual(['wrong(K1,N1)']);
  const c = { key: w.a, entry: e.id, pattern: e.pattern, stage: 0, skeletonMatches: 3, features: { F3: 0, F5: 0, F6: 0, F11: 1, F13: 1, F14: 1, F15: 2, F16: 0 } };
  const ranked = rankCandidates([c], [], w.l3.data)[0]; expect(ranked.score).toBe(-1); // .5 neutral minus 1.5 skeleton penalty
  const ring = structuredClone(w.l3.state.skeletons); w.l3.refresh(); expect(w.l3.state.skeletons).toEqual(ring);
});

test('SF3-52: authored realising seeds join their instance and prevent duplicate realisation', () => {
  const p = simple(); delete p.junctures.second.realise;
  const w = graphWorld('authored-realising', [p]); const pack = offering(w); live(w); w.l2.baseTotal = 4000;
  const t = pack.seeds[0]; t.realises = [{ pattern: p.id, juncture: 'second', by: 'end', binds: { '?b': 'npc', '?a': 'other' } }];
  t.roles.npc.identity = w.b; t.roles.other.identity = w.a; t.roles.cause.identity = w.l3.state.pool[0].stages[0].event;
  expect(w.l2.installPack(pack)).toEqual([]);
  const sow = w.l2.sow(pack.id, t.id);
  expect(sow.ok).toBe(true); w.l2.advancePlay(1); w.k.settle(); w.l3.refresh();
  expect(w.l2.instance(sow.instance!)!.st.source.layer).toBe('authored');
  expect(w.l2.instance(sow.instance!)!.st.roles.npc.cast).toBe(w.b); expect(w.l2.instance(sow.instance!)!.st.roles.other.cast).toBe(w.a);
  const e = w.l3.state.pool[0]; expect(e.graph!.junctures.second.state).toBe('pending');
  expect(w.l3.threadView.some((t) => t.patterns?.includes(e.id) && t.instances.includes(sow.instance!))).toBe(true);
  expect(w.l3.sower.collect(w.l3.counts).some((r) => r.candidate.kind === 'realise')).toBe(false);
});

test('SF3-68: four unclassified beats are a plot; a small kit is still sowable', () => {
  const w = graphWorld('whole-plot'), pack = offering(w), t = pack.seeds[0];
  expect(sowableFindings(t, w.l2, w.l3.kv, w.l3.data, pack.id)).toEqual([]);
  t.beats.a = { play: 'pack:f-finish', links: [{ because: 'finish' }] };
  t.beats.b = { play: 'pack:f-finish', links: [{ because: 'a' }] };
  t.beats.c = { play: 'pack:f-finish', links: [{ because: 'b' }] };
  expect(sowableFindings(t, w.l2, w.l3.kv, w.l3.data, pack.id).some((f) => f.code === 'S3-K-6')).toBe(true);
});

test('SF3-49: a simulation act served by a nudge goal is an adaptation; an unstarted nudge expires', () => {
  const w = graphWorld('nudge-source', [simple()]), pack = nudging(w), first = live(w);
  const result = w.l2.sow(pack.id, pack.seeds[0].id, { overlay: { roles: { npc: { identity: w.b }, other: { identity: w.a }, cause: { identity: first.id } } } });
  expect(result.ok).toBe(true); w.l2.advancePlay(1); w.k.settle();
  const inst = w.l2.instance(result.instance!)!;
  expect(inst.st.state).toBe('running');
  const goal = w.k.frames.framesOf(w.b).find((f) => f.payload.goal?.effects?.some((e) => e.on === w.a && e.effect === 'give'))!;
  expect(goal).toBeDefined();
  emit(w, 'helped', 2, { served: goal.id, participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] });
  expect(w.l3.state.pool[0].graph!.junctures.second.filler?.source).toBe('nudged');
  expect(w.l3.log.some((l) => l.rule === 'adaptation')).toBe(true);
  const blocked = structuredClone(pack); blocked.id = 'xf.waiting'; blocked.seeds[0].id = 'xf.waiting:kit'; blocked.seeds[0].context = 'no';
  expect(w.l2.installPack(blocked)).toEqual([]);
  const waiting = w.l2.sow(blocked.id, blocked.seeds[0].id, { by: 'director', decision: H(s('waiting-nudge-decision')) }); expect(waiting.ok).toBe(true);
  w.l3.state.nudges.push({ instance: waiting.instance!, sownAt: 0 });
  w.l2.baseTotal = w.l3.data.sower.nudgeLifetime + 1; w.l3.refresh();
  expect(w.l2.instance(waiting.instance!)!.st.state).toBe('withdrawn');
  expect(w.l3.state.nudges.some((n) => n.instance === waiting.instance)).toBe(false);
});

test('SF3-48: escalation needs legibility, an actor want, a sufficiently early portent and local scale', () => {
  for (const missing of ['none', 'legibility', 'want', 'portent', 'scale']) {
    const p = simple({ escalation: ['second'] }); delete p.junctures.second.realise;
    p.junctures.portent = { fn: 'threaten', args: { by: '?b', to: '?a' }, optional: true };
    const w = graphWorld('escalation-' + missing, [p]), pack = offering(w); live(w);
    w.l2.baseTotal = 4000;
    emit(w, 'confront', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], witnesses: [w.v] });
    w.l3.refresh();
    w.l2.baseTotal += missing === 'portent' ? 60 : 121; w.k.now = 4; w.l3.refresh();
    const e = w.l3.state.pool[0];
    w.l3.threadView.find((t) => t.patterns?.includes(e.id))!.pullAt = 3;
    w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'want' && missing !== 'want' ? [{ id: 'fixture-want', fn, durable: true, changes: [],
      fromChange: () => [], endsBy: () => false, holdsAt: () => 'yes',
      search: () => ({ fills: [{ filler: { event: e.graph!.junctures.first.filler!.id }, at: 1, args: { who: w.b, what: w.a }, causes: [] }], truncated: false }) }] : [] };
    if (missing === 'legibility') e.graph!.junctures.first.perceived = undefined;
    if (missing === 'scale') pack.seeds[0].stakeScale = 'district';
    const candidates = w.l3.sower.collect(w.l3.counts);
    expect(candidates.some((r) => r.candidate.kind === 'realise'), missing).toBe(missing === 'none');
    if (['legibility', 'want', 'portent'].includes(missing)) expect(w.l3.log.some((l) => l.rule === 'gate-12' && l.data.condition === missing), missing).toBe(true);
  }
});

test('graph sowing is atomic and a split graph record repairs without another instance', () => {
  const p = simple(); delete p.junctures.second.realise;
  const make = () => { const w = graphWorld('graph-atomic', [p]); offering(w); return w; };
  const w = make(); live(w); w.k.settings.set({ tempo: 'restless' });
  w.l3.state.slots.open.next = 1; w.l2.baseTotal = w.l3.keys.slot(1, w.l3.data.schedule.slotGap).time;
  w.l3.sower.resolve(w.l3.counts);
  const e = w.l3.state.pool[0], seed = e.graph!.junctures.second.pending!;
  expect(seed).toBeDefined(); expect(w.l2.all()).toHaveLength(1); expect(e.graph!.seeds[0].seed).toBe(seed);
  e.graph!.seeds = []; e.graph!.junctures.second = { state: 'ready', readySince: 1 }; w.l3.state.pending = [];
  w.l3.flush(); w.k.persistence.save('split');
  const fresh = make(); for (const [key, record] of w.k.persistence.chain) fresh.k.persistence.chain.set(key, structuredClone(record)); fresh.k.persistence.load('split');
  expect(fresh.l2.all()).toHaveLength(1); expect(fresh.l3.state.pool[0].graph!.junctures.second.pending).toBe(seed);
  expect(fresh.l3.log.some((l) => l.rule === 'sow-repaired')).toBe(true);
});

test('SF3-51: forty perceived threads keep the last 32 stance-free ring entries through reload', () => {
  const w = graphWorld('ring-cap', [simple()]); const ids: string[] = [];
  for (let n = 0; n < 40; n++) {
    const first = emit(w, 'wrong', n * 3 + 1, { witnesses: [w.v] });
    emit(w, 'helped', n * 3 + 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id], witnesses: [w.v] });
    ids.push(w.l3.state.pool.at(-1)!.id); w.l3.refresh();
    w.l3.sifter.graph.boundary(n * 3 + 3); w.l3.sifter.sweep(n * 3 + 3);
  }
  expect(w.l3.state.skeletons.ring).toHaveLength(32);
  expect(w.l3.state.skeletons.ring.map((r) => r.thread)).toEqual(ids.slice(-32));
  const before = structuredClone(w.l3.state.skeletons); w.l3.flush(); w.k.persistence.save('ring'); w.k.persistence.load('ring');
  expect(w.l3.state.skeletons).toEqual(before);
});
