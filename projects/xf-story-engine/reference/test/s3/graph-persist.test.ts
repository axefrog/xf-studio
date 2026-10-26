import { expect, test } from 'bun:test';
import { graphWorld, simple, emit, perceive } from './graph-fixture.ts';
import { offering, live, nudging } from './graph-kits.ts';
import type { StateFill } from '../../src/sim/fillers.ts';
import { H, s } from '../../src/id.ts';
import { lcg } from '../sim/feed.ts';
import { linkHolds } from '../../src/procedural/graph-links.ts';
import { patternDocument } from '../../src/procedural/graph-types.ts';
import { event } from './helpers.ts';

test('SF3-62: durable state fillers copy their evidence and end time across a fresh load', () => {
  const p = simple(); p.junctures.want = { fn: 'want', args: { who: '?a', what: '?b' } };
  const make = () => {
    const w = graphWorld('durable-state', [p]);
    const frame = w.k.root('goal', 'core:thing');
    w.l2.reg.patternWorld = { stateRules: (fn) => fn !== 'want' ? [] : [{ id: 'fixture-want', fn, durable: true, changes: [],
      fromChange: () => [], endsBy: (c) => c.c === 'frame' && c.frame === frame && c.new === 'satisfied',
      search: (_a, node, at) => ({ fills: node === w.a ? [{ filler: { frame }, at: 0, args: { who: w.a, what: w.b }, causes: [w.k.root('ground', 'core:event')] }] : [], truncated: false }),
      holdsAt: () => 'yes' }] };
    return w;
  };
  const original = make(); emit(original, 'wrong', 1); original.l3.flush(); original.k.persistence.save('state');
  const fresh = make(); for (const [key, record] of original.k.persistence.chain) fresh.k.persistence.chain.set(key, structuredClone(record)); fresh.k.persistence.load('state');
  for (const w of [original, fresh]) {
    const e = w.l3.state.pool[0], filler = e.graph!.junctures.want.filler!;
    expect(filler.causes).toHaveLength(1); expect(filler.at).toBe(0);
    w.l3.sifter.graph.onChange(w.l3.sifter.patterns.get(p.id)!, { c: 'frame', frame: w.k.expandId('root:goal'), actor: w.a, level: 'goal', focus: [], old: 'active', new: 'satisfied' }, undefined, 3);
    expect(filler.until).toBe(3);
    expect(linkHolds(w.l3.sifter.graph.world, 'enables', filler, { ...filler, id: w.b, at: 2 }, p.junctures.second, w.l3.data.sifter)).toBe(true);
    expect(linkHolds(w.l3.sifter.graph.world, 'enables', filler, { ...filler, id: w.b, at: 3 }, p.junctures.second, w.l3.data.sifter)).toBe(false);
  }
  expect(fresh.l3.state.pool).toEqual(original.l3.state.pool);
});

test('SF3-58: schema 1 retains schedule and history but discards the obsolete cache', () => {
  const w = graphWorld('schema-one', [simple()]); live(w);
  w.l3.state.schema = 1; w.l3.state.slots.open.next = 7; w.l3.state.openLockUntil = 9000;
  w.l3.flush(); w.k.persistence.save('old'); w.k.persistence.load('old');
  expect(w.l3.state.pool).toEqual([]); expect(w.l3.state.buffer).toEqual([]); expect(w.l3.state.skeletons.ring).toEqual([]);
  expect(w.l3.state.slots.open.next).toBe(7); expect(w.l3.state.openLockUntil).toBe(9000);
});

test('SF3-66: an authored end realisation reaches the matcher through its subscribed frame', () => {
  const p = simple(); const w = graphWorld('seed-end', [p]); const first = live(w);
  const pack = offering(w); pack.seeds[0].realises = [{ pattern: p.id, juncture: 'second', by: 'end', binds: { '?b': 'npc', '?a': 'other' } }];
  pack.seeds[0].end = 'seedFact(stage) == 1';
  expect(w.l2.installPack(pack)).toEqual([]);
  const sow = w.l2.sow(pack.id, pack.seeds[0].id, { overlay: { roles: { npc: { identity: w.b }, other: { identity: w.a }, cause: { identity: first.id } } } }); expect(sow.ok).toBe(true);
  w.l2.arbiter.session = 'normal'; w.l3.advancePlay(105);
  const instance = w.l2.instance(sow.instance!)!, delivery = instance.st.deliveries.find((d) => d.what === 'offer')!;
  expect(delivery).toBeDefined(); expect(w.l2.respond(delivery.id, { kind: 'action', id: 'go' })).toBe(true);
  w.k.settle(); w.l3.sifter.boundary(600, 0);
  expect(w.l3.state.pool[0].graph!.junctures.second.filler?.fn).toBe('help');
  expect(w.l3.state.pool[0].graph!.outcome?.name).toBe('done');
});

test('SF3-59/new properties: generated incidents agree unswept, swept and with replacement loads', () => {
  const full = process.env.S1_FULL === '1';
  for (const snapshot of [false, true]) for (let seed = 1; seed <= (full ? 12 : 4); seed++) {
    const p = simple({ once: undefined, outcomes: { done: { reached: ['second'], after: { clock: 'game', days: .01 }, kind: 'resolved', aftermath: { junctures: ['tail'], days: 10 } } } });
    p.junctures.want = { fn: 'want', args: { who: '?a', what: '?b' } };
    p.junctures.blame = { fn: 'blame', args: { who: '?b', of: '?a', for: 'first' } };
    p.junctures.tail = { fn: 'repay', args: { debtor: '?a', creditor: '?b' }, optional: true };
    p.edges.push({ from: 'want', to: 'second', link: 'enables' });
    const make = (swept = true) => {
      const w = graphWorld(`graph-property-${seed}-${snapshot}`, [p]); w.k.config.snapshotEvery = snapshot ? 1 : 10000;
      if (!swept) { w.k.retention.scheduleSweep = () => 0; w.l3.sifter.sweep = () => {}; }
      const base = event(w, 'ground', 'generic', 0, { witnesses: [w.v] }); w.k.events.makeCanon(base.id, 'observed', w.v);
      const frame = H(s('property-goal'));
      w.k.frames.open({ id: frame, actor: w.a, origin: w.a, cause: base.id, level: 'goal', retain: true, weight: 1, own: {}, payload: { goal: { effects: [{ on: w.b, effect: 'give' }] } }, focus: { nodes: [], tier: 0 } });
      const rows = (fn: string): StateFill[] => fn === 'want' ? w.k.frames.framesOf(w.a).filter((f) => f.id === frame && ['active', 'blocked'].includes(f.status)).map((f) => ({ filler: { frame }, at: f.opened, args: { who: w.a, what: w.b }, causes: [f.cause] }))
        : w.k.beliefs.activeOf(w.b).filter((b) => b.path === 'did.take').map((b) => ({ filler: { belief: b.id }, at: b.at ?? 0, args: { who: w.b, of: w.a, for: b.evidence[0] }, causes: b.evidence }));
      w.l2.reg.patternWorld = { stateRules: (fn) => ['want', 'blame'].includes(fn) ? [{ id: fn, fn, durable: true,
        changes: [{ slot: '*', scope: { nodes: [w.a, w.b] } }],
        fromChange: (c) => c.c === 'frame' && fn === 'want' || c.c === 'belief' && fn === 'blame' ? rows(fn) : [],
        endsBy: (c, f) => c.c === 'frame' && 'frame' in f && c.frame === f.frame && c.new === 'satisfied'
          || c.c === 'belief' && 'belief' in f && c.belief === f.belief && c.op === 'dropped',
        search: (arg, node, _at, limit) => ({ fills: rows(fn).filter((r) => r.args[arg] === node).slice(0, limit), truncated: false }), holdsAt: () => rows(fn).length ? 'yes' : 'no' }] : [] };
      w.l3.sifter.syncFrames();
      const pack = nudging(w); pack.seeds[0].unattended.after.s = 1_000_000;
      expect(w.l2.installPack(pack)).toEqual([]);
      const nudge = w.l2.sow(pack.id, pack.seeds[0].id, { by: 'director', decision: H(s('property-nudge')),
        overlay: { roles: { npc: { identity: w.b }, other: { identity: w.a }, cause: { identity: base.id } } } }); expect(nudge.ok).toBe(true);
      w.l2.advancePlay(1); w.k.settle();
      expect(w.l2.instance(nudge.instance!)!.st.state).toBe('running');
      expect(w.k.frames.framesOf(w.b).some((f) => f.payload.goal?.effects?.some((e) => e.on === w.a && e.effect === 'give'))).toBe(true);
      w.l3.state.nudges.push({ instance: nudge.instance!, sownAt: 0 });
      return { ...w, ground: base.id };
    };
    let worlds = [make(false), make(), make()]; const random = lcg(seed);
    for (let step = 0; step < (full ? 10 : 4); step++) {
      const t = step * 4000 + 1, show = step === 0 || random() > .3;
      let helped = '';
      for (const w of worlds) {
        w.k.settle({ to: t });
        w.k.frames.setStatus(H(s('property-goal')), 'active', w.ground);
        const first = event(w, 'wrong-' + step, 'wrong', t, show ? { witnesses: [w.v] } : {});
        w.k.settle({ to: t + 600 });
        w.k.beliefs.set({ believer: w.b, subject: w.a, path: 'did.take', value: w.b, confidence: 1, evidence: [first.id], source: { by: 'observed', event: first.id }, at: w.k.now, formed: w.k.now, refreshed: w.k.now, memorable: true });
        w.k.frames.setStatus(H(s('property-goal')), 'blocked', w.ground);
        event(w, 'near-miss-' + step, 'helped', w.k.now, step % 2 ? { participants: [{ who: w.a, role: 'actor' }, { who: w.b, role: 'target' }], causes: [first.id] }
          : { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [] });
        helped = event(w, 'help-' + step, 'helped', w.k.now, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [first.id] }).id;
        w.k.settle(); w.l3.flush();
        expect(w.l3.state.buffer.some((b) => !!b.change)).toBe(true);
        expect(w.l3.state.nudges).toHaveLength(1);
        expect(w.l2.instance(w.l3.state.nudges[0].instance)!.st.state).toBe('running');
      }
      worlds[2].k.persistence.save('buffer-' + step);
      const saved = structuredClone(worlds[2].l3.state);
      let fresh = make(); for (const [id, record] of worlds[2].k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(record)); fresh.k.persistence.load('buffer-' + step); worlds[2] = fresh;
      expect(fresh.l3.state).toEqual(saved);
      const nodes = new Set(fresh.l3.state.pool.flatMap((e) => [
        ...e.stages.map((s) => s.event), ...(e.story ? [e.story] : []),
        ...Object.values(e.graph!.junctures).flatMap((j) => !j.filler ? [] : 'event' in j.filler.ref ? [j.filler.id] : j.filler.causes ?? []),
      ]));
      for (const b of fresh.l3.state.buffer) if (!b.change && !b.dilemma) nodes.add(b.event.id);
      expect(fresh.k.retention.seeds.get(fresh.l3.keys.record)!.nodes, JSON.stringify([...nodes].map((n) => [n, fresh.l3.kv.kind(n), fresh.l3.kv.event(n)?.kind]))).toEqual([...nodes].sort());
      for (const w of worlds) {
        w.k.settle({ to: t + 1200 });
        const e = w.l3.state.pool.find((e) => e.graph!.junctures.first.filler?.at === t)!;
        expect(e).toBeDefined(); expect(e.graph!.junctures.want.filler?.causes).toHaveLength(1); expect(e.graph!.junctures.blame.filler).toBeDefined();
        expect(e.graph!.junctures.second.filler?.id).toBe(helped);
        const belief = w.k.beliefs.activeOf(w.b).find((b) => b.path === 'did.take')!;
        w.k.frames.setStatus(H(s('property-goal')), 'satisfied', w.ground); w.k.beliefs.drop(w.b, belief.id);
        w.k.settle({ to: t + 1800 });
        expect(e.graph!.junctures.want.filler?.until).toBe(t + 1200); expect(e.graph!.junctures.blame.filler?.until).toBe(t + 1200);
        w.k.settle({ to: t + 2400 }); w.l3.refresh(); w.l3.flush();
        expect(w.l3.state.pool.some((e) => !e.graph!.retired)).toBe(true); expect(w.l3.state.skeletons.ring.length).toBeGreaterThan(0);
      }
      worlds[1].l3.sifter.sweep(t + 2400); worlds[1].l3.flush(); worlds[1].k.retention.scheduleSweep(); worlds[1].k.settle();
      worlds[2].l3.sifter.sweep(t + 2400); worlds[2].l3.flush(); worlds[2].k.persistence.save('step-' + step);
      fresh = make(); for (const [id, record] of worlds[2].k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(record)); fresh.k.persistence.load('step-' + step); worlds[2] = fresh;
      const observe = (w: typeof worlds[number]) => ({ pool: w.l3.state.pool.filter((e) => !e.graph!.retired), skeletons: w.l3.state.skeletons,
        tombstones: w.l3.state.tombstones, candidates: w.l3.sower.collect(w.l3.counts), slots: w.l3.state.slots });
      expect(observe(worlds[1]), `sweep ${seed}/${step}`).toEqual(observe(worlds[0]));
      expect(observe(worlds[2]), `reload ${seed}/${step}`).toEqual(observe(worlds[0]));
    }
  }
}, process.env.S1_FULL === '1' ? 180_000 : 30_000);
