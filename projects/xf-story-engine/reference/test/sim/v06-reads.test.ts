// S1 v0.6 reads and state fillers (S1 9.1, 9.1a): wants, guarded, intentAgainst, leads and holds, and the state rules the story patterns are filled by (SF1-R-4, SF1-R-5).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import type { StateRule } from '../../src/sim/fillers.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { adults, goalSim, plantGoal, W } from './goals-helpers.ts';
import { groupDigest, startHunt } from './hunt-helpers.ts';

setDefaultTimeout(240_000);

const rule = (sim: Sim, id: string): StateRule => sim.stateRules.find((r) => r.id === id)!;

describe('SF1-R-4: wants, guarded and intentAgainst', () => {
  test('wants(person, kind?): yes while the person holds an active goal (of that kind if given), no otherwise; its transitions follow the goal feed', () => {
    const sim = goalSim('SF1-R-4a');
    const [o, t, other] = adults(sim, 0) as [Id, Id, Id];
    const g = plantGoal(sim, { owner: o, target: t, motive: 0.5, expires: 12 });
    sim.startAt(5);
    sim.advance(2);
    expect(sim.reads.eval('wants', [o])).toBe('yes');
    expect(sim.reads.eval('wants', [o, 'redress'])).toBe('yes');
    expect(sim.reads.eval('wants', [o, 'collect'])).toBe('no');
    expect(sim.reads.eval('wants', [other])).toBe('no');
    expect(sim.reads.port().builds('wants')).toBe(true);
    // the goal expires at window 12: the read turns no at that boundary, and its transitions say when
    sim.advance(12);
    expect(sim.reads.eval('wants', [o])).toBe('no');
    const from = 12 * W;
    const tr = sim.reads.transitions('wants', [o], from, sim.k.now);
    expect(tr[0]).toEqual({ t: from, value: 'yes' });
    expect(tr.at(-1)!.value).toBe('no');
    expect(tr.length).toBe(2);
    void g;
  });

  test('guarded(person): yes where a post of the history guards the person, at its cell and in its periods; re-evaluated at every boundary', () => {
    const sim = goalSim('SF1-R-4b');
    const [ward, guard] = adults(sim, 0) as [Id, Id];
    const wv = sim.people.view(ward)!;
    const rows = sim.data.people.schedules[wv.archetype] ?? sim.data.people.schedules.resident!;
    const periods = [0, 1, 2, 3].filter((p) => rows[p]![1]! > 0);
    const cell = sim.people.placeOf(wv, 'work', 0, 0)!;
    sim.setState('people.goals', (st) => {
      (st as { posts: unknown[] }).posts.push({ person: guard, cell, periods, from: 100, until: 300, goal: H(hs('guard-goal')), ward });
    });
    sim.startAt(98);
    sim.advance(3);
    const find = (want: boolean): number => {
      for (let w = 100; w < 300; w++) {
        const t = w * W + 10;
        const at = sim.people.where(ward, t);
        if ((periods.includes(sim.people.periodOf(t)) && at.cell === cell && at.cls !== 'away') === want) return t;
      }
      throw new Error('no such time');
    };
    expect(sim.reads.eval('guarded', [ward], find(true))).toBe('yes');
    expect(sim.reads.eval('guarded', [ward], find(false))).toBe('no');
    expect(sim.reads.eval('guarded', [ward], 400 * W)).toBe('no');
    // the transitions over some windows hold every change of the value, at window starts
    const tr = sim.reads.transitions('guarded', [ward], 100 * W, 160 * W);
    for (let i = 1; i < tr.length; i++) expect(tr[i]!.t % W).toBe(0);
    expect(sim.reads.port().deps('guarded').boundary).toBe(true);
  });

  test('intentAgainst(group, V): none, then warned (rung 1, the warning not yet perceived), ranks (perceived), price, hunt; V only in the core; boundary-evaluated', () => {
    const h = startHunt({ name: 'SF1-R-4c', delay: 3, tweak: (d) => { d.goals.rate.warning = 500; d.goals.rate.price = 500; d.goals.rate.search = 500; d.groups.punish.rungDwell = 150; d.groups.punish.climbP = 100; } });
    const { sim, GA } = h;
    expect(sim.reads.port().builds('intentAgainst')).toBe(true);
    expect(sim.reads.port().deps('intentAgainst').boundary).toBe(true);
    const seen: string[] = [];
    for (let i = 0; i < 1000; i++) {
      h.step(1);
      const v = sim.reads.eval('intentAgainst', [GA, sim.w.v]);
      if (seen[seen.length - 1] !== v) seen.push(v);
      if (v === 'hunt') break;
    }
    expect(seen).toEqual(['none', 'warned', 'ranks', 'price', 'hunt']);
    expect(sim.reads.eval('intentAgainst', [GA, adults(sim, 0)[0]!])).toBe('maybe');
    // the transitions of the feed give the value at a time and what came after
    const now = sim.k.now;
    const tr = sim.reads.transitions('intentAgainst', [GA, sim.w.v], now - 8 * W, now);
    expect(tr[0]!.t).toBe(now - 8 * W);
    expect(['none', 'warned', 'ranks', 'price', 'hunt']).toContain(tr[0]!.value);
    expect(groupDigest(sim).against[GA]!.rung).toBe('hunt');
  });
});

describe('SF1-R-5: blame from both forms', () => {
  test('a focal witness who sees x assault y holds a did.harm belief: blame(who: w, of: x, for: the assault), never of: y; GA\'s grievance about V resting on act e: blame(who: GA, of: v, for: e)', () => {
    const sim = goalSim('SF1-R-5', undefined, ['city.events', 'city.mirror', 'group.decide', 'people.goals']);
    const [x, y, w] = adults(sim, 0) as [Id, Id, Id];
    const cell = sim.w.districts[0]!.cellIds[0]!;
    // w is focal (it holds a frame of its own) and protects y, so the harm it sees is memorable
    sim.k.frames.open({ actor: w, level: 'concern', origin: H(hs('w-frame')), weight: 1, cause: sim.w.city, focus: { nodes: [w], tier: 3 }, own: { reactsTo: [{ kind: 'core:event', slot: '*' }], protects: [{ slot: '*', scope: { nodes: [y] } }] } });
    sim.k.settle();
    const assault = sim.k.events.mintEvent({ creator: sim.w.port, cause: sim.w.port, name: 'assault-r5', time: 100, kind: 'assault', place: cell, participants: [{ who: x, role: 'aggressor' }, { who: y, role: 'victim' }], effects: [{ on: y, effect: 'harm' }], witnesses: [w], causes: [] });
    sim.k.settle();
    const blame = rule(sim, 'blame.belief');
    const fills = blame.search('who', w, 1000, sim, 8).fills;
    expect(fills.map((f) => f.args)).toEqual([{ who: w, of: x, for: assault }]);
    expect(fills.some((f) => f.args.of === y)).toBe(false);
    expect(blame.holdsAt(fills[0]!.filler, 1000, sim)).toBe('yes');
    // the group's grievance: the act V did, as the mirror re-described it
    const GA = sim.w.group(sim.w.districts[0]!.id, 'A1');
    const m = adults(sim, 2, 'gang')[0]!;
    sim.k.beliefs.set({ believer: GA, subject: sim.w.v, path: 'against', value: assault, confidence: 0.9, evidence: [assault], source: { by: 'observed', event: assault }, formed: 0, refreshed: 0, memorable: true, at: 100, salience: 3 });
    const g = blame.search('who', GA, 1000, sim, 8).fills;
    expect(g.map((f) => f.args)).toEqual([{ who: GA, of: sim.w.v, for: assault }]);
    void m;
  });
});

describe('S1 9.1a: the state rules', () => {
  test('hold: an item\'s holder edge, from the holder or the item; want, pursue, threaten, obligate and protect over goal frames; a group\'s intention and its object', () => {
    const sim = goalSim('SF1-R-fillers', undefined, ['city.events', 'group.decide', 'people.goals']);
    const [h, o, t] = adults(sim, 0) as [Id, Id, Id];
    const seed = sim.k.root('kit-r', 'core:seed');
    const item = sim.k.root('item-r', 'xf:item');
    const edge = sim.k.addEdge({ type: 'xf:held-by', from: item, to: h, cause: seed, valid: { from: 0 } });
    const redress = plantGoal(sim, { owner: o, target: t, motive: 0.5 });
    const collect = plantGoal(sim, { owner: h, kind: 'collect', target: t, acts: ['call-in'], motive: 0.5 });
    const guard = plantGoal(sim, { owner: t, kind: 'carry-out', duty: 'guard', ward: o, acts: ['presence'], motive: 0.4, post: { cell: sim.w.districts[0]!.cellIds[0]!, periods: [0, 1] } });
    sim.startAt(5);
    sim.advance(3);
    const hold = rule(sim, 'hold.held-by');
    expect(hold.search('who', h, 100, sim, 5).fills.map((f) => [f.args, f.filler])).toEqual([[{ who: h, what: item }, { edge: edge.id }]]);
    expect(hold.search('what', item, 100, sim, 5).fills).toHaveLength(1);
    expect(hold.holdsAt({ edge: edge.id }, 100, sim)).toBe('yes');
    expect(rule(sim, 'want.goal').search('who', o, 100, sim, 5).fills.map((f) => f.args)).toEqual([{ who: o, what: t }]);
    expect(rule(sim, 'want.goal').search('what', t, 100, sim, 5).fills.map((f) => f.args.who).sort()).toEqual([o, h].sort());
    expect(rule(sim, 'pursue.goal').search('who', o, 100, sim, 5).fills[0]!.args).toEqual({ who: o, target: t });
    expect(rule(sim, 'threaten.goal').search('to', t, 100, sim, 5).fills.map((f) => f.args.by)).toEqual([o]);
    expect(rule(sim, 'obligate.collect').search('debtor', t, 100, sim, 5).fills.map((f) => f.args)).toEqual([{ debtor: t, creditor: h }]);
    expect(rule(sim, 'protect.goal').search('ward', o, 100, sim, 5).fills.map((f) => f.args)).toEqual([{ guard: t, ward: o }]);
    expect(rule(sim, 'want.goal').holdsAt({ frame: redress.id }, 3000, sim)).toBe('yes');
    // a frame change that opens a goal makes its state true, and one that ends it ends the state
    const open = rule(sim, 'want.goal').fromChange({ c: 'frame', frame: redress.id, actor: o, level: 'goal', focus: [t], old: 'none', new: 'active' }, sim);
    expect(open.map((f) => f.filler)).toEqual([{ frame: redress.id }]);
    expect(rule(sim, 'want.goal').endsBy({ c: 'frame', frame: redress.id, actor: o, level: 'goal', focus: [t], old: 'active', new: 'satisfied' }, { frame: redress.id }, sim)).toBe(true);
    // the bound of a search
    const many = rule(sim, 'want.goal').search('what', t, 100, sim, 1);
    expect(many.fills).toHaveLength(1);
    expect(many.truncated).toBe(true);
    void collect; void guard;
    // a rule never names V as an owner
    for (const r of sim.stateRules) expect(r.durable).toBe(true);
  });

  test('a group\'s intention against V is a state: want and pursue with V as the object, from the group digest', () => {
    const h = startHunt({ name: 'SF1-R-fillers-hunt', delay: null });
    for (let i = 0; i < 400 && groupDigest(h.sim)?.groups[h.GA]?.active?.name !== 'punish'; i++) h.step(1);
    const a = groupDigest(h.sim).groups[h.GA]!.active!;
    const want = rule(h.sim, 'want.intent').search('who', h.GA, 100, h.sim, 5).fills;
    expect(want.map((f) => [f.args, f.filler])).toEqual([[{ who: h.GA, what: h.sim.w.v }, { intent: { group: h.GA, id: a.id } }]]);
    expect(want[0]!.causes).toContain(a.id);
    expect(rule(h.sim, 'pursue.intent').search('target', h.sim.w.v, 100, h.sim, 5).fills).toHaveLength(1);
    expect(rule(h.sim, 'want.intent').holdsAt({ intent: { group: h.GA, id: a.id } }, h.sim.k.now, h.sim)).toBe('yes');
  });
});
