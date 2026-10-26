import { expect, test } from 'bun:test';
import { graphWorld, simple, emit, perceive } from './graph-fixture.ts';
import { event } from './helpers.ts';
import { offering, live } from './graph-kits.ts';
import { H, s } from '../../src/id.ts';
import { fillerId } from '../../src/procedural/graph-world.ts';
import { sowableFindings } from '../../src/procedural/lint.ts';

test('review 3: a short witnessed story leaves its skeleton through the real buffered boundary and reload', () => {
  const w = graphWorld('buffered-short-story', [simple()]);
  w.k.now = 1;
  const a = event(w, 'first', 'wrong', 1, { witnesses: [w.v] });
  w.k.now = 2;
  event(w, 'last', 'helped', 2, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [a.id], witnesses: [w.v] });
  w.k.settle({ to: 600 }); w.l3.refresh();
  expect(w.l3.log.some((l) => l.rule === 'match-complete')).toBe(true);
  expect(w.l3.state.skeletons.ring).toHaveLength(1);
  expect(w.l3.state.skeletons.ring[0].tokens.length).toBeGreaterThanOrEqual(2);
  const before = structuredClone(w.l3.state.skeletons); w.k.persistence.save('short'); w.k.persistence.load('short');
  expect(w.l3.state.skeletons).toEqual(before);
});

test('review 6: an unless-only kind cancels through its actual subscribed event stream', () => {
  const p = simple({ unless: [{ between: ['first', 'second'], juncture: { fn: 'protect', args: { guard: '?a', ward: '?b' } } }] });
  const w = graphWorld('cancel-subscription', [p]);
  event(w, 'first', 'wrong', 1, { witnesses: [w.v] }); w.k.settle({ to: 600 });
  expect(w.l3.state.pool).toHaveLength(1);
  event(w, 'cancel', 'guarded', 601); w.k.settle({ to: 1200 });
  expect(w.l3.state.pool.every((e) => !['forming', 'live'].includes(e.graph!.state))).toBe(true);
  expect(w.l3.log.some((l) => l.rule === 'match-complete' && l.data.outcome === '@parked')).toBe(true);
});

test('review 6: an unless-only state rule hears its real belief change', () => {
  const p = simple({ unless: [{ between: ['first', 'second'], juncture: { fn: 'blame', args: { who: '?a', of: '?b', for: 'any' } } }] });
  const w = graphWorld('state-cancellation', [p]);
  w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'blame' ? [{ id: 'cancel-belief', fn, durable: true,
    changes: [{ slot: '*', scope: { nodes: [w.a] } }], fromChange: (c) => c.c === 'belief' ? [{ filler: { belief: c.belief }, at: 601, args: { who: w.a, of: w.b, for: w.b }, causes: [] }] : [],
    endsBy: () => false, search: () => ({ fills: [], truncated: false }), holdsAt: () => 'yes' }] : [] };
  w.l3.sifter.syncFrames(); w.k.now = 1; event(w, 'first', 'wrong', 1, { witnesses: [w.v] }); w.k.settle({ to: 600 });
  expect(w.l3.state.pool).toHaveLength(1); w.k.now = 601;
  w.k.beliefs.set({ believer: w.a, subject: w.b, path: 'against', value: 1, confidence: 1, evidence: [], source: { by: 'inferred', rule: { name: 'cancel', version: 1 }, from: [] }, at: 601, formed: 601, refreshed: 601, memorable: true });
  w.k.settle({ to: 1200 }); expect(w.l3.log.some((l) => l.rule === 'match-complete' && l.data.outcome === '@parked')).toBe(true);
});

test('review 11: a null response still contributes its canonical occurrence token', () => {
  const w = graphWorld('null-token', [simple()]); const p = offering(w); live(w);
  const out = w.l2.sow(p.id, p.seeds[0].id, { by: 'director', decision: H(s('null-choice')), overlay: { roles: { npc: { identity: w.a }, other: { identity: w.b }, cause: { identity: w.l3.state.pool[0].stages[0].event } } } }); expect(out.ok).toBe(true);
  w.k.settle(); const inst = w.l2.instance(out.instance!)!;
  for (const d of inst.st.deliveries) w.l2.pull(d.id); w.l2.advancePlay(1);
  const d = inst.st.deliveries.find((d) => d.what === 'offer')!; expect(w.l2.respond(d.id, { kind: 'null' })).toBe(true); w.l3.refresh();
  const t = w.l3.threadView.find((t) => t.instances.includes(inst.id))!;
  expect(t.tokens).toHaveLength(2); // one ask occurrence and one response occurrence, even with no realised function
});

test('review 7: one durable goal cannot fill two want junctures of one instance', () => {
  const p = simple(); p.junctures.x = { fn: 'want', args: { who: '?a', what: '?b' } }; p.junctures.y = structuredClone(p.junctures.x);
  const w = graphWorld('state-consumption', [p]), frame = H(s('want'));
  w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: w.a, level: 'goal', retain: true, weight: 1, own: {}, payload: { goal: { effects: [{ on: w.b, effect: 'give' }] } }, focus: { nodes: [], tier: 0 } });
  w.l2.reg.patternWorld = { stateRules: (fn) => fn === 'want' ? [{ id: 'want', fn, durable: true, changes: [], fromChange: () => [], endsBy: () => false, holdsAt: () => 'yes',
    search: () => ({ fills: [{ filler: { frame }, at: 0, args: { who: w.a, what: w.b }, causes: [] }], truncated: false }) }] : [] };
  emit(w, 'wrong', 1); const g = w.l3.state.pool[0].graph!;
  expect([g.junctures.x, g.junctures.y].filter((j) => !!j.filler)).toHaveLength(1);
  expect(g.used.find((u) => u.occurrence === fillerId({ frame }))?.fns).toEqual(['want']);
});

test('review 8 / SF3-69: fixed roles validate kind, must and V policy; preferred identities stay open', () => {
  for (const defect of ['V', 'kind', 'must', 'preferred', 'valid']) {
    const p = simple(); p.roles['?a'].identity = defect === 'V' ? 'v' : defect === 'preferred' ? { prefer: 'root:dex', strength: 2 } : 'root:mara';
    if (defect === 'kind') p.roles['?a'].kind = 'group';
    if (defect === 'must') p.roles['?a'].must = [{ rel: 'known-to-protagonist', args: ['?a'] }];
    const w = graphWorld('fixed-' + defect, [p]);
    emit(w, 'wrong', 1, { participants: [{ who: defect === 'V' ? w.v : w.a, role: 'actor' }, { who: w.b, role: 'target' }] });
    expect(w.l3.state.pool.length, defect).toBe(['valid', 'preferred'].includes(defect) ? 1 : 0);
  }
});

test('review 9 / SF3-41: relation search backtracks over the first eight of ten ordered records', () => {
  for (const searchable of [true, false]) {
    const p = simple(); p.roles['?g'] = { kind: 'group' };
    p.junctures.first.requires = [{ rel: 'member', args: ['?a', '?g'] }, { rel: 'known-to-protagonist', args: ['?g'] }];
    const w = graphWorld('search-backtrack-' + searchable, [p]);
    const groups = Array.from({ length: 10 }, (_, n) => w.k.root('g' + n, 'core:group')).sort(); perceive(w, groups[7]);
    let query = 0;
    w.l2.reg.patternWorld = { stateRules: () => [], relationSearch: (_name, args, _at, cap) => {
      query++; expect(cap).toBe(8); return { tuples: groups.slice(0, cap).map((g) => ({ id: g, args: { who: args.who, group: g } })), truncated: true };
    } };
    if (!searchable) w.l2.reg.vocabulary!.relations.member.searchFrom = ['group'];
    emit(w, 'wrong', 1);
    expect(query).toBe(searchable ? 1 : 0);
    if (searchable) { expect(w.l3.state.pool[0].bindings['?g']).toBe(groups[7]); expect(w.l3.log.some((l) => l.rule === 'query-truncated')).toBe(true); }
    else expect(w.l3.state.pool).toHaveLength(0);
  }
});

test('review 10/11/13: pulls keep their original times, cited offers remain tokens, and seedless threads are not live', () => {
  const p = simple(); delete p.junctures.second.realise;
  const w = graphWorld('immutable-pulls', [p]), pack = offering(w), first = live(w);
  expect(w.l3.threadView[0].live).toBe(false);
  const sow = w.l2.sow(pack.id, pack.seeds[0].id, { overlay: { growsFrom: { instance: w.l3.state.pool[0].id, juncture: 'second' },
    roles: { npc: { identity: w.b }, other: { identity: w.a }, cause: { identity: first.id } } } }); expect(sow.ok).toBe(true);
  w.l2.arbiter.session = 'normal'; w.l3.advancePlay(105);
  const inst = w.l2.instance(sow.instance!)!, d = inst.st.deliveries.find((d) => d.what === 'offer')!;
  expect(d).toBeDefined(); d.pull = true;
  w.k.now = 10; w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'confirmed', atPlay: 105 }); w.l3.refresh();
  const thread = () => w.l3.threadView.find((t) => t.instances.includes(inst.id))!;
  expect(thread().pullAt).toBe(10); expect(thread().tokens!.some((t) => t.startsWith('ask('))).toBe(true);
  w.k.now = 100; w.l3.refresh(); expect(thread().pullAt).toBe(10);
  expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true); w.l3.refresh(); expect(thread().pullAt).toBe(100);
  const act = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'own', kind: 'generic', time: 120, participants: [{ who: w.v, role: 'actor' }, { who: w.a, role: 'target' }] });
  w.k.events.makeCanon(act, 'observed', w.v); w.k.now = 130; w.l3.refresh(); expect(thread().pullAt).toBe(120);
  w.k.persistence.save('pull'); w.k.persistence.load('pull'); expect(thread().pullAt).toBe(120);
  // Terminal seeds with nothing pending leave the projection even when their history remains stored.
  const loaded = w.l2.instance(inst.id)!;
  loaded.st.state = 'resolved'; for (const d of loaded.st.deliveries) if (d.what === 'closing') d.state = 'answered'; w.l3.refresh();
  expect(w.l3.threadView.some((t) => t.instances.includes(inst.id))).toBe(false);
});

test('review 12: an offer remains exempt from plot length when realises changes its implicit function', () => {
  const w = graphWorld('offer-count'), pack = offering(w), seed = pack.seeds[0];
  seed.realises = [{ pattern: 'xf.composite:squeeze', juncture: 'asked', by: 'meet', binds: { '?wk': 'npc', '?p': 'v' } }];
  seed.beats.extra = { play: 'pack:f-finish', links: [{ because: 'finish' }] };
  expect(sowableFindings(seed, w.l2, w.l3.kv, w.l3.data, pack.id).some((f) => f.code === 'S3-K-6')).toBe(false);
});
