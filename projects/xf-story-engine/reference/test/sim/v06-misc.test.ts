// S1 v0.6: the pinned keys and mint names (SF1-H-9), news that travels (SF1-W-8), a promise's outcome (SF1-L-9), the v0.6 reads (SF1-R-4).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, mintedId, rand, s as hs } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import type { Id } from '../../src/types.ts';
import { processKeys } from '../../src/sim/keys.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { quietData, quietSim, seedOf } from './helpers.ts';

setDefaultTimeout(120_000);

describe('SF1-H-9: the keys and mint names of v0.6, pinned', () => {
  const sim = quietSim('SF1-H-9');
  const seed = sim.k.worldSeed;
  const group = H(hs('group'));
  const holder = H(hs('holder'));
  const occ = H(hs('occ'));

  test('each identity draw is toUnit(H("rng", tag, worldSeed, ...)) over the typed tuple of S1 1.5', () => {
    expect(sim.ids.outcome(occ)).toBe(rand(hs('outcome'), hid(seed), hid(occ)));
    expect(sim.ids.seatB(group, 2, 1, 3)).toBe(rand(hs('seat-b'), hid(seed), hid(group), hi(2), hi(1), hi(3)));
    expect(sim.ids.seatR(group, 2, 1, 3)).toBe(rand(hs('seat-r'), hid(seed), hid(group), hi(2), hi(1), hi(3)));
    expect(sim.ids.lean(holder, group)).toBe(rand(hs('lean'), hid(seed), hid(holder), hid(group)));
    // distinct tags and arguments give distinct draws
    expect(sim.ids.seatB(group, 2, 1, 3)).not.toBe(sim.ids.seatR(group, 2, 1, 3));
    expect(sim.ids.seatB(group, 2, 1, 3)).not.toBe(sim.ids.seatB(group, 2, 1, 4));
  });

  test('a process draw is keyed by the window being computed: rand("proc", worldSeed, "group.decide", w, "decide-t", group)', () => {
    const keys = processKeys((w, ...key) => rand(hs('proc'), hid(seed), hs('group.decide'), hi(w), ...key));
    expect(keys.decideT(7, group)).toBe(rand(hs('proc'), hid(seed), hs('group.decide'), hi(7), hs('decide-t'), hid(group)));
  });

  test('the lifecycle events are minted under H("mint", proc("group.decide"), group, name)', () => {
    const proc = processCause('group.decide');
    for (const name of ['decide/collect-fee/5', 'relent/collect-fee/149', 'succession/0/12', 'succession/1/12']) expect(mintedId(proc, group, name)).toBe(H(hs('mint'), hid(proc), hid(group), hs(name)));
    expect(mintedId(proc, group, 'succession/0/12')).not.toBe(mintedId(proc, group, 'succession/1/12'));
  });
});

describe('SF1-W-8: news travels', () => {
  test('a promise forms a memorable did.promise belief about its promiser valued by the promise; a telling of it names it as `told` and keeps the teller\'s evidence', () => {
    const sim = quietSim('SF1-W-8', (data) => { data.minds.tellBase = 1e9; });
    const d = sim.w.districts[0]!;
    const people: Id[] = [];
    for (const c of d.cellIds) for (const r of sim.people.residentsOfBlock(c)) if (sim.people.view(r)!.affc === 0 && sim.people.view(r)!.ageClass === 'adult') people.push(r);
    const [a, b, w, z] = people as [Id, Id, Id, Id];
    const k = sim.k;
    // w is focal (it holds a frame of its own), so S1 forms beliefs for it
    k.frames.open({ actor: w, level: 'concern', origin: H(hs('w-frame')), weight: 1, cause: sim.w.city, focus: { nodes: [w], tier: 3 }, own: { reactsTo: [{ kind: 'core:event', slot: '*' }] } });
    k.settle();
    const seed = k.root('kit-seed', 'core:seed');
    const promise = k.events.mintEvent({
      creator: seed, cause: seed, name: 'a-promise', time: 1000, kind: 'promise', place: d.cellIds[0]!,
      participants: [{ who: a, role: 'promiser' }, { who: b, role: 'promisee' }], effects: [], witnesses: [w], causes: [],
    });
    k.settle();
    const belief = k.beliefs.activeOf(w).find((x) => x.path === 'did.promise');
    expect(belief).toBeDefined();
    expect(belief!.subject).toBe(a);
    expect(belief!.value).toBe(promise);
    expect(belief!.memorable).toBe(true);
    expect(belief!.evidence).toEqual([promise]);
    // z cares about the promisee, so the promise matters to z (the telling's score is the listener's protective relevance, S1 8.4)
    k.frames.open({ actor: z, level: 'concern', origin: H(hs('z-frame')), weight: 1, cause: sim.w.city, own: { protects: [{ slot: '*', scope: { nodes: [b] } }] } });
    k.settle();
    sim.tiePolicy.materialise(w, z);
    // w tells z
    expect(sim.policies.encounter(w, z, 10)).toBe(true);
    const tell = k.store.idsOfKind('core:event').filter((x) => k.value(x, 'kind') === 'tell').pop()!;
    const view = sim.policies.viewEvent(tell)!;
    expect(view.participants).toContainEqual({ who: promise, role: 'told' });
    expect(view.participants).toContainEqual({ who: a, role: 'subject' });
    expect(view.effects).toEqual([]);
    const heard = k.beliefs.activeOf(z).find((x) => x.path === 'did.promise')!;
    expect(heard.evidence).toEqual([promise]);
    expect(heard.source).toMatchObject({ by: 'told', teller: w });
    // the kind's fills: learn(listener, told), and expose only where the reader finds the thing was concealed
    const fills = sim.w.kinds.get('tell')!.fills;
    expect(fills.map((f) => f.fn)).toEqual(['learn', 'expose']);
  });
});

describe('SF1-L-9: an accepted offer moves no reputation', () => {
  const ledgerSim = (name: string): Sim => Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(), only: ['order.ledger'] });
  const promiseOf = (sim: Sim, name: string, outcome?: 'done' | 'failed'): Id => {
    const d = sim.w.districts[0]!;
    let npc = sim.people.residentAt(d.cellIds[1]!, 0);
    for (let n = 1; sim.people.view(npc)!.affc !== 0; n++) npc = sim.people.residentAt(d.cellIds[1]!, n);
    return sim.k.events.mintEvent({
      creator: sim.w.port, cause: sim.w.port, name, time: 1000, kind: 'promise', place: d.cellIds[1]!,
      participants: [{ who: sim.w.v, role: 'promiser' }, { who: npc, role: 'promisee' }], effects: [], causes: [],
      witnesses: Array.from({ length: 3 }, (_, i) => H(hs('wit'), hs(name), hi(i))),
      ...(outcome ? { outcome } : {}),
    });
  };
  const items = (sim: Sim): number => sim.ledger.itemsOf(sim.ledger.carrierNode('kabuki', sim.w.districts[0]!.id), sim.w.v, 'reliable').length;

  test('a promise with no outcome is not absorbed and moves no label; when its outcome is recorded it is absorbed once, 0.5 x 1.5 = 0.75 on reliable', () => {
    const sim = ledgerSim('SF1-L-9');
    const p = promiseOf(sim, 'accepted');
    sim.k.settle();
    expect(items(sim)).toBe(0);
    expect(sim.record.dirty.length).toBe(0);
    sim.policies.absorb(sim.policies.viewEvent(p)!);
    expect(items(sim)).toBe(0);
    // the record gives it an outcome
    sim.k.pin({ node: p, slot: 'outcome', value: 'done', reason: 'committed', cause: sim.w.port });
    sim.k.settle();
    const carrier = sim.ledger.carrierNode('kabuki', sim.w.districts[0]!.id);
    const got = sim.ledger.itemsOf(carrier, sim.w.v, 'reliable');
    expect(got.length).toBe(1);
    expect(got[0]!.v).toBe(0.75);
    expect(sim.record.dirty.length).toBeGreaterThan(0);
    // absorbed once: hearing it again adds nothing
    sim.policies.absorb(sim.policies.viewEvent(p)!);
    expect(items(sim)).toBe(1);
  });

  test('a promise whose outcome is recorded failed is -1.2 x 1.5 = -1.8, and a missing outcome is never read as done', () => {
    const sim = ledgerSim('SF1-L-9b');
    const p = promiseOf(sim, 'failed-promise', 'failed');
    sim.policies.absorb(sim.policies.viewEvent(p)!);
    const carrier = sim.ledger.carrierNode('kabuki', sim.w.districts[0]!.id);
    const got = sim.ledger.itemsOf(carrier, sim.w.v, 'reliable');
    expect(got.length).toBe(1);
    expect(got[0]!.v).toBe(-1.796875);
    const other = promiseOf(sim, 'no-outcome');
    void other;
    sim.policies.absorb(sim.policies.viewEvent(other)!);
    expect(items(sim)).toBe(1);
  });
});

describe('SF1-R-4: the v0.6 reads that are built', () => {
  test('leads follows the xf:leads edges and holds the xf:held-by edges, each with its initial value first and the kernel\'s edge times as transitions', () => {
    const sim = quietSim('SF1-R-4');
    const d = sim.w.districts[0]!;
    const k = sim.k;
    const group = sim.w.group(d.id, 'A1');
    const holder = sim.people.residentAt(d.cellIds[0]!, 0);
    const owner = sim.people.residentAt(d.cellIds[0]!, 1);
    const item = k.mint(sim.w.city, sim.w.city, 'item-1', 'xf:item');
    expect(sim.reads.eval('leads', [holder, group], 0)).toBe('no');
    const lead = k.addEdge({ type: 'xf:leads', from: holder, to: group, attrs: { seat: 0 }, cause: group, valid: { from: 1000 } });
    k.addEdge({ type: 'xf:held-by', from: item, to: owner, cause: sim.w.city, valid: { from: 500 } });
    k.now = 5000;
    expect(sim.reads.eval('leads', [holder, group], 5000)).toBe('yes');
    expect(sim.reads.eval('leads', [owner, group], 5000)).toBe('no');
    expect(sim.reads.transitions('leads', [holder, group], 0, 5000)).toEqual([{ t: 0, value: 'no' }, { t: 1000, value: 'yes' }]);
    k.endEdge(lead.id, 3000);
    expect(sim.reads.transitions('leads', [holder, group], 0, 5000)).toEqual([{ t: 0, value: 'no' }, { t: 1000, value: 'yes' }, { t: 3000, value: 'no' }]);
    expect(sim.reads.eval('holds', [owner, item], 5000)).toBe('yes');
    expect(sim.reads.eval('holds', [holder, item], 5000)).toBe('no');
    expect(sim.reads.transitions('holds', [owner, item], 0, 5000)).toEqual([{ t: 0, value: 'no' }, { t: 500, value: 'yes' }]);
    // the reads of the goals and the hunt are built with their processes; with no process run they have nothing to say (test/sim/v06-reads.test.ts answers them properly)
    for (const r of ['wants', 'guarded', 'intentAgainst']) {
      expect(sim.reads.defs.get(r)!.built).toBe(true);
      expect(sim.reads.eval(r, [holder])).toBe('maybe');
    }
  });
});
