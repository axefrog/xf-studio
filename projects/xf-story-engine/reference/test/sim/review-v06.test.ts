// The findings of the independent review of S1 v0.6 (the second build): one fixture per finding, small and quick.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import type { Id } from '../../src/types.ts';
import { transfer } from './feed.ts';
import { isActOfV } from '../../src/sim/grievance.ts';
import { H, s as hs } from '../../src/id.ts';
import type { GroupDigest, GroupState } from '../../src/sim/proc-groups.ts';
import type { StateRule } from '../../src/sim/fillers.ts';
import type { GoalsState } from '../../src/sim/proc-goals.ts';
import type { NormsState } from '../../src/sim/proc-norms.ts';
import { adults, bigSim, fact, feedEvents, gnode, goalSim, goalsState, plantGoal, W } from './goals-helpers.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { quietData, seedOf } from './helpers.ts';
import { actsOf, goalsDigest, groupDigest, startHunt } from './hunt-helpers.ts';

setDefaultTimeout(120_000);

describe('review 2: derived caches do not survive a replacement load', () => {
  const make = (): Sim => goalSim('R-2');
  const wrongOf = (sim: Sim, x: Id, y: Id): Id => {
    const seed = sim.k.root('seed', 'core:seed');
    return sim.k.events.mintEvent({
      creator: seed, cause: seed, name: 'E', time: 9 * W + 10, kind: 'assault', place: sim.w.districts[0]!.cellIds[0]!,
      participants: [{ who: x, role: 'aggressor' }, { who: y, role: 'victim' }], effects: [{ on: y, effect: 'harm' }], witnesses: [], causes: [],
    });
  };

  test('a same-instance rewind and a load into a fresh engine take the same foreign event the same way, though the run passed its window before the rewind', () => {
    const ref = make();
    const [x, y] = adults(ref, 0).slice(3, 5) as [Id, Id];
    ref.startAt(5);
    ref.advance(3);
    ref.k.persistence.save('A');
    ref.advance(30);
    // the event is minted long after its window: the run that goes on sees it as too old
    wrongOf(ref, x, y);
    ref.advance(3);
    expect(goalsState(ref).goals.some((g) => g.owner === y)).toBe(false);
    // rewind in the same instance, and load the same save into a fresh engine; both then meet the event in its own window
    const fresh = transfer(ref, 'A', make, 4);
    ref.k.persistence.load('A');
    ref.k.newEpoch();
    // a load drops what the engine knew of its residents: a world that names two of them meets them again, as a fresh engine does
    adults(ref, 0);
    adults(fresh, 0);
    const e1 = wrongOf(ref, x, y);
    const e2 = wrongOf(fresh, x, y);
    expect(e1).toBe(e2);
    ref.advance(6);
    fresh.advance(6);
    const mine = (s: Sim) => goalsState(s).goals.filter((g) => g.source === e1);
    expect(mine(fresh).length).toBeGreaterThan(0);
    expect(mine(ref)).toEqual(mine(fresh));
    expect(goalsState(ref)).toEqual(goalsState(fresh));
  });
});

describe('review 3: a warning that is perceived is a transition of the intention against V', () => {
  test('none, then warned, then ranks exactly when the warning is observed, and `intentAgainst` answers each at its time', () => {
    const h = startHunt({ name: 'R-3', delay: 25, tweak: (d) => { d.goals.rate.warning = 500; d.groups.punish.climbP = 0; } });
    const { sim, GA } = h;
    const feed: Array<{ t: number; prev: string | null; value: string }> = [];
    const seen: string[] = [];
    for (let i = 0; i < 260; i++) {
      h.step(1);
      const v = sim.reads.eval('intentAgainst', [GA, sim.w.v]);
      if (seen[seen.length - 1] !== v) seen.push(v);
      for (const x of groupDigest(sim).changes.windows.flatMap((y) => y.items)) if (x.key === `against|${GA}` && !feed.some((f) => f.t === x.t && f.value === x.value)) feed.push({ t: x.t, prev: x.prev, value: x.value });
    }
    const acts = actsOf(sim).filter((a) => a.kind === 'warning');
    expect(acts.length).toBeGreaterThan(0);
    const first = acts[0]!;
    const T = sim.windowStart(first.w + 25);
    expect(feed.slice(0, 2).map((x) => `${x.prev}>${x.value}`)).toEqual(['none>warned', 'warned>ranks']);
    // the second is the boundary after the window in which the pin was made: before it `warned`, from it `ranks`
    const at = feed[1]!.t;
    expect(at).toBeGreaterThan(T - 1);
    expect(at).toBeLessThanOrEqual(T + 2 * W);
    expect(seen.slice(0, 3)).toEqual(['none', 'warned', 'ranks']);
  });
});

describe('review 4: a protect-members intention keeps its ward', () => {
  test('a seed\'s assault on a member of a group: the care pulse names the member, the intention that follows has them as its ward, and a member is given a guard post for them', () => {
    const sim = bigSim('R-4', (d) => { d.goals.attempts = 600; }, ['group.decide', 'people.goals']);
    const GB = gnode(sim, 'A2');
    sim.setState('group.decide', () => {});
    const g0 = sim.stateOf<GroupState>('group.decide')!.groups[GB]!;
    const head = adults(sim, 3, 'gang').find((r) => sim.people.view(r)!.aband >= 2 && !g0.seats.some((x) => x.holder === r))!;
    sim.setState('group.decide', (st) => {
      const gg = (st as GroupState).groups[GB]!;
      const seat = gg.seats[0]!;
      seat.holder = head; seat.since = 0; seat.succ = 0; seat.edged = false; seat.logged = true; delete seat.retry;
      for (const x of gg.seats) if (x.holder !== null) x.lean = 'care_of_members';
      // the group is cooling after an earlier intention while the wrong is taken, so that its pulse is what the next decision reads
      gg.intent = { state: 'cooling', until: 9 };
    });
    const holders = new Set(sim.stateOf<GroupState>('group.decide')!.groups[GB]!.seats.map((s) => s.holder));
    const member = adults(sim, 3, 'gang').find((r) => !holders.has(r))!;
    const civ = adults(sim, 0)[0]!;
    const seed = sim.k.root('seed-r4', 'core:seed');
    sim.startAt(5);
    sim.k.events.mintEvent({
      creator: seed, cause: seed, name: 'beating', time: 5 * W + 30, kind: 'assault', place: sim.w.districts[0]!.cellIds.find((c) => sim.w.cell(c).public === 'public')!,
      participants: [{ who: civ, role: 'aggressor' }, { who: member, role: 'victim' }], effects: [{ on: member, effect: 'harm' }], witnesses: [], causes: [],
    });
    let active: GroupDigest['groups'][string]['active'] = null;
    for (let i = 0; i < 400 && (active === null || active.name !== 'protect-members'); i++) {
      sim.advance(1);
      active = groupDigest(sim).groups[GB]!.active;
    }
    expect(active?.name).toBe('protect-members');
    expect(active?.ward).toBe(member);
    sim.advance(4);
    const guard = goalsDigest(sim).goals.filter((x) => x.duty === 'guard');
    expect(guard).toHaveLength(1);
    expect(guard[0]!).toMatchObject({ kind: 'carry-out', ward: member, acts: ['presence'], intent: { group: GB, name: 'protect-members' } });
    expect(guard[0]!.post!.cell).toBe(sim.people.placeOf(sim.people.view(member)!, 'work', 0, 0)!);
    expect(goalsDigest(sim).wards[member]?.length).toBeGreaterThan(0);
  });

  test('a ward who has died by the time the group decides is not named', () => {
    const sim = bigSim('R-4b', (d) => { d.goals.attempts = 600; }, ['group.decide', 'people.goals']);
    const GB = gnode(sim, 'A2');
    sim.setState('group.decide', () => {});
    const holders = new Set(sim.stateOf<GroupState>('group.decide')!.groups[GB]!.seats.map((s) => s.holder));
    const head = adults(sim, 3, 'gang').find((r) => sim.people.view(r)!.aband >= 2 && !holders.has(r))!;
    const member = adults(sim, 3, 'gang').find((r) => !holders.has(r) && r !== head)!;
    const civ = adults(sim, 0)[0]!;
    sim.setState('group.decide', (st) => {
      const gg = (st as GroupState).groups[GB]!;
      gg.pulse.care_of_members = { at: 0, sev: 1, latched: false, src: H(hs('fact-r4b')), ward: member, wrongdoer: civ };
      const seat = gg.seats[0]!;
      seat.holder = head; seat.since = 0; seat.succ = 0; seat.edged = false; seat.logged = true; delete seat.retry;
      for (const x of gg.seats) if (x.holder !== null) x.lean = 'care_of_members';
    });
    sim.k.pin({ node: member, slot: 'died', value: 0, reason: 'committed', cause: sim.w.port, at: 0 });
    sim.startAt(5);
    let active: GroupDigest['groups'][string]['active'] = null;
    for (let i = 0; i < 60 && active === null; i++) {
      sim.advance(1);
      active = groupDigest(sim).groups[GB]!.active;
    }
    expect(active?.name).toBe('protect-members');
    expect(active?.ward).toBeUndefined();
  });
});

describe('review 5: a collector\'s successful shakedown pays the group', () => {
  const cashAfter = (over: { goal?: boolean; outcome?: 'done' | 'failed'; role?: string; own?: boolean }): number => {
    const sim = goalSim('R-5', (d) => { d.groups.groups[0]!.books.income = d.groups.groups[0]!.books.burn; }, ['group.decide']);
    const GA = gnode(sim, 'A1');
    const m = adults(sim, 2, 'gang')[0]!;
    const civ = adults(sim, 0)[0]!;
    sim.startAt(5);
    feedEvents(sim, 5, [fact(sim, {
      kind: 'shakedown', size: 1, w: 5, outcome: over.outcome ?? 'done', ...(over.goal === false ? {} : { goal: H(hs('goal-r5')) }),
      parties: [{ role: over.role ?? 'aggressor', who: over.own === false ? civ : m, ...(over.own === false ? {} : { group: GA }) }, { role: 'victim', who: civ }],
    })]);
    sim.advance(1);
    const st = sim.k.evolution.states.get('group.decide')!;
    return ((st.outstanding.at(-1)?.state ?? st.state) as GroupState).groups[GA]!.books.cash - sim.data.groups.groups[0]!.books.cash;
  };

  test('a done goal act by a member adds perShakedown; a failed one, one that is no goal act, and one by someone who is not a member add nothing', () => {
    const per = goalSim('R-5x').data.groups.groups[0]!.perShakedown;
    expect(per).toBeGreaterThan(0);
    expect(cashAfter({})).toBeCloseTo(per, 9);
    expect(cashAfter({ outcome: 'failed' })).toBeCloseTo(0, 9);
    expect(cashAfter({ goal: false })).toBeCloseTo(0, 9);
    expect(cashAfter({ own: false })).toBeCloseTo(0, 9);
  });
});

describe('review 6: V is recognised by the roles a kind declares', () => {
  test('a promiser or a protagonist is V acting; an undeclared role such as `actor` on an assault is not, in the grievance and in the watch', () => {
    const sim = goalSim('R-6', undefined, ['city.events', 'city.mirror', 'group.decide', 'people.goals']);
    const cell = sim.w.districts[0]!.cellIds[0]!;
    const [a, b] = adults(sim, 0) as [Id, Id];
    const mint = (name: string, kind: string, participants: Array<{ who: Id; role: string }>): Id =>
      sim.k.events.mintEvent({ creator: sim.w.port, cause: sim.w.port, name, time: 100, kind, place: cell, participants, effects: [], witnesses: [], causes: [] });
    const promise = mint('p', 'promise', [{ who: sim.w.v, role: 'promiser' }, { who: a, role: 'promisee' }]);
    const response = mint('r', 'response', [{ who: sim.w.v, role: 'protagonist' }, { who: a, role: 'asker' }]);
    const wrongRole = mint('x', 'assault', [{ who: sim.w.v, role: 'actor' }, { who: b, role: 'victim' }]);
    const asker = mint('y', 'promise', [{ who: sim.w.v, role: 'promisee' }, { who: a, role: 'promiser' }]);
    expect(isActOfV(sim.policies, sim.policies.viewEvent(promise)!)).toBe(true);
    expect(isActOfV(sim.policies, sim.policies.viewEvent(response)!)).toBe(true);
    expect(isActOfV(sim.policies, sim.policies.viewEvent(wrongRole)!)).toBe(false);
    expect(isActOfV(sim.policies, sim.policies.viewEvent(asker)!)).toBe(false);
    // the watch listens for every declared agent role, and for no other
    const roles = sim.w.kinds.allAgentRoles();
    for (const r of ['aggressor', 'promiser', 'protagonist', 'warner', 'creditor', 'enforcer']) expect(roles).toContain(r);
    for (const r of ['actor', 'victim', 'promisee']) expect(roles).not.toContain(r);
    const watch = sim.k.frames.frame(sim.policies.watch)!;
    const mine = (watch.own.reactsTo ?? []).find((i) => i.scope && 'nodes' in i.scope && i.scope.nodes.includes(sim.w.v) && i.where?.some((x) => x.path === '@role' && x.op === 'in'))!;
    expect((mine.where![0]!.arg as string[]).sort()).toEqual(roles);
  });
});

const ruleOf = (sim: Sim, id: string): StateRule => sim.stateRules.find((r) => r.id === id)!;

describe('review 8: leads is one record, the xf:leads edge', () => {
  test('a search gives the edge itself, holdsAt takes that Id and its recorded interval, and an ended seat stops being led', () => {
    const sim = bigSim('SF1-ended-seats', undefined, ['group.decide']);
    sim.advance(5);
    const GA = gnode(sim, 'A1');
    const live = sim.k.store.edgesTo(GA).filter((e) => e.type === 'xf:leads' && e.valid.to === undefined);
    expect(live.length).toBeGreaterThan(0);
    const leads = ruleOf(sim, 'leads.seat');
    const now = sim.k.now;
    const found = leads.search('group', GA, now, sim, 10).fills;
    expect(found.map((f) => (f.filler as { edge: Id }).edge).sort()).toEqual(live.map((e) => e.id).sort());
    for (const f of found) {
      expect(String((f.filler as { edge: Id }).edge).startsWith('seat:')).toBe(false);
      expect(leads.holdsAt(f.filler, now, sim)).toBe('yes');
      // the interval is the edge's own: before its start it did not hold
      const e = sim.k.store.edges.get((f.filler as { edge: Id }).edge)!;
      expect(f.at).toBe(e.valid.from);
      if (e.valid.from > 0) expect(leads.holdsAt(f.filler, e.valid.from - 1, sim)).toBe('no');
    }
    // the same edges come from a change that adds them
    const edge = live[0]!;
    expect(leads.fromChange({ c: 'edge', edge, ended: false } as never, sim).map((f) => f.filler)).toEqual([{ edge: edge.id }]);
    // the holders die: the edges end, and the rule no longer finds them from then on, though it still answers for the time they held
    for (const e of live) sim.k.pin({ node: e.from, slot: 'died', value: sim.k.now, reason: 'committed', cause: sim.w.port, at: sim.k.now });
    const diedAt = sim.k.now;
    sim.advance(4);
    for (const e of live) {
      const ended = sim.k.store.edges.get(e.id)!;
      expect(ended.valid.to).toBeDefined();
      expect(leads.holdsAt({ edge: e.id }, diedAt - 1, sim)).toBe('yes');
      expect(leads.holdsAt({ edge: e.id }, ended.valid.to!, sim)).toBe('no');
      expect(leads.endsBy({ c: 'edge', edge: ended, ended: true } as never, { edge: e.id }, sim)).toBe(true);
    }
    expect(leads.search('group', GA, sim.k.now, sim, 10).fills.map((f) => (f.filler as { edge: Id }).edge)).not.toContain(live[0]!.id);
    // a search at a time they held still finds them
    expect(leads.search('group', GA, diedAt - 1, sim, 10).fills.map((f) => (f.filler as { edge: Id }).edge)).toContain(live[0]!.id);
  });
});

describe('review 9: each function reads the goal states it means', () => {
  test('a blocked goal is wanted and owed but not pursued or threatening; a guard whose post ended no longer protects, though it did then', () => {
    const sim = goalSim('R-9', undefined, ['city.events', 'group.decide', 'people.goals']);
    const [o, t, h, g] = adults(sim, 0) as [Id, Id, Id, Id];
    const blocked = plantGoal(sim, { owner: o, target: t, motive: 0.5, state: 'blocked', blocked: 'target-protected' });
    const collect = plantGoal(sim, { owner: h, kind: 'collect', target: t, acts: ['call-in'], motive: 0.5, state: 'blocked', blocked: 'target-protected' });
    const cell = sim.w.districts[0]!.cellIds[0]!;
    const guard = plantGoal(sim, { owner: g, kind: 'carry-out', duty: 'guard', ward: o, acts: ['presence'], motive: 0.4, post: { cell, periods: [0, 1] } });
    sim.startAt(5);
    sim.advance(3);
    // the goals the process blocks are those whose target is protected or whose owner is cast: this fixture states the blocking itself, in the digest the rules read
    for (const x of (sim.k.evolution.states.get('people.goals')!.digest as { goals: Array<{ id: Id; state: string }> }).goals) if (x.id === blocked.id || x.id === collect.id) x.state = 'blocked';
    expect(ruleOf(sim, 'want.goal').search('who', o, 100, sim, 5).fills.map((f) => f.filler)).toContainEqual({ frame: blocked.id });
    expect(ruleOf(sim, 'pursue.goal').search('who', o, 100, sim, 5).fills).toHaveLength(0);
    expect(ruleOf(sim, 'threaten.goal').search('to', t, 100, sim, 5).fills).toHaveLength(0);
    expect(ruleOf(sim, 'want.goal').holdsAt({ frame: blocked.id }, sim.k.now, sim)).toBe('yes');
    expect(ruleOf(sim, 'pursue.goal').holdsAt({ frame: blocked.id }, sim.k.now, sim)).toBe('no');
    expect(ruleOf(sim, 'obligate.collect').search('debtor', t, 100, sim, 5).fills.map((f) => f.args)).toEqual([{ debtor: t, creditor: h }]);
    void collect;
    // the guard stands for a while, then its post ends
    const protect = ruleOf(sim, 'protect.goal');
    expect(protect.search('ward', o, 100, sim, 5).fills.map((f) => f.args)).toEqual([{ guard: g, ward: o }]);
    sim.setState('people.goals', (st) => {
      for (const p of (st as GoalsState).posts) if (p.goal === guard.id) p.until = 6;
    });
    sim.advance(3);
    const ended = 6 * W;
    expect(protect.search('ward', o, ended - 1, sim, 5).fills.map((f) => f.args)).toEqual([{ guard: g, ward: o }]);
    expect(protect.search('ward', o, ended, sim, 5).fills).toHaveLength(0);
    expect(protect.holdsAt({ frame: guard.id }, ended - 1, sim)).toBe('yes');
    expect(protect.holdsAt({ frame: guard.id }, ended + W, sim)).toBe('no');
  });
});

describe('review 10: a seed\'s goal to harm an item is aimed at whoever holds it', () => {
  function household(sim: Sim, n: number): Id[] {
    for (const cell of sim.w.districts[0]!.cellIds) {
      for (const r of sim.people.residentsOfBlock(cell)) {
        const ref = sim.people.refOf(r)!;
        if (ref.j !== 0) continue;
        const size = sim.people.blockInfo(ref.cell).sizes[ref.hIndex]!;
        const ad = Array.from({ length: size }, (_, j) => sim.people.residentId(ref.household, j)).filter((m) => sim.people.view(m)!.ageClass === 'adult' && sim.people.view(m)!.affc === 0);
        if (ad.length >= n) return ad;
      }
    }
    throw new Error('no household');
  }
  function together(sim: Sim, people: Id[], from: number): number {
    for (let w = from; w < from + 3000; w++) {
      const wh = people.map((p) => sim.people.where(p, w * W));
      if (wh.every((x) => x.cls !== 'away' && x.cell !== undefined && x.cell === wh[0]!.cell)) return w;
    }
    throw new Error('never together');
  }

  test('the goal keeps the item; its assaults all have the holder as victim and never anyone else; nothing is drawn when no one holds it', () => {
    const sim = goalSim('R-10', (d) => { d.goals.rate.assault = 1e6; }, ['city.events', 'people.goals']);
    const [h, o] = household(sim, 2) as [Id, Id];
    const bystanders = adults(sim, 0).filter((x) => x !== h && x !== o);
    const seed = sim.k.root('seed-r10', 'core:seed');
    const it = sim.k.root('item-r10', 'xf:item');
    sim.k.addEdge({ type: 'xf:held-by', from: it, to: h, cause: seed, valid: { from: 0 } });
    const role = sim.k.frames.open({ actor: seed, level: 'concern', origin: seed, weight: 1, cause: seed });
    const goal = sim.k.frames.open({ id: H(hs('role-goal'), hs('r10')), actor: o, level: 'goal', origin: seed, weight: 0.75, cause: seed, parents: [{ frame: role.id, weight: 1 }], payload: { goal: { effects: [{ on: it, effect: 'harm' }] } } });
    sim.k.settle();
    sim.startAt(together(sim, [h, o], 6) - 2);
    sim.advance(1);
    const g = (goalsState(sim).goals).find((x) => x.id === goal.id)!;
    expect(g).toMatchObject({ kind: 'role', owner: o, acts: ['assault'], item: it });
    expect(g.target).toBeUndefined();
    for (let i = 0; i < 40; i++) sim.advance(1);
    const acts = (sim.stateOf<{ ring: Array<{ id: Id; kind: string; event?: { served?: Id } }> }>('city.events')?.ring ?? []).filter((r) => r.event?.served === goal.id);
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) {
      const view = sim.policies.viewEvent(a.id)!;
      expect(view.kind).toBe('assault');
      expect(view.participants).toContainEqual({ who: o, role: 'aggressor' });
      expect(view.participants).toContainEqual({ who: h, role: 'victim' });
      expect(view.participants.some((p) => bystanders.includes(p.who))).toBe(false);
    }
  });
});

describe('review 11: external enforcement answers a refusal', () => {
  const run = (outcome: 'done' | 'failed' | undefined, sameTarget = true): { pending: number; signal: boolean } => {
    const sim = Sim.create({ worldSeed: seedOf('R-11'), index: fx3Slice(), data: quietData((d) => { d.norms.norms.forEach((n) => { n.enforcePerDay = 0; }); d.norms.answerRate = 0; }), only: ['order.norms'] });
    const d = sim.w.districts[0]!;
    const residents: Array<{ id: Id; role: string; affc: number }> = [];
    for (const cell of Object.keys(sim.w.index.cells)) for (const r of sim.people.residentsOfBlock(cell)) {
      const v = sim.people.view(r);
      if (v && v.ageClass === 'adult') residents.push({ id: r, role: v.role, affc: v.affc });
    }
    const refuser = residents.find((r) => r.role === 'vendor' || r.role === 'shopkeeper')!.id;
    const other = residents.find((r) => r.id !== refuser && r.role !== 'gang')!.id;
    const collector = residents.find((r) => r.affc === 2 && r.role === 'gang')!.id;
    const group = sim.w.group(d.id, 'A1');
    const cell = d.cellIds[0]!;
    const key = `${d.id}|fee`;
    sim.startAt(5);
    sim.k.evolution.stateOf('city.events').digest = { v: 1, through: 5, facts: { windows: [{ w: 5, items: [{
      id: H(hs('refusal-r11'), hs(String(outcome))), kind: 'shakedown', size: 1, w: 5, time: 5 * W, cell, district: d.id, public: true, witnesses: 6, policeChild: false, creator: 'sim',
      outcome: 'failed', parties: [{ role: 'aggressor', who: collector, group }, { role: 'victim', who: refuser }],
    }] }] }, counts: { windows: [] }, changes: { windows: [] } };
    sim.advance(1);
    expect(sim.stateOf<NormsState>('order.norms')!.slots[key]!.pending).toHaveLength(1);
    // a seed's enforcement of the norm, in a later window, on the refuser (or on someone else)
    const seed = sim.k.root('seed-r11', 'core:seed');
    const rung = sim.data.norms.norms.find((n) => n.id === 'fee')!.ladder[0]!.rung;
    sim.k.events.mintEvent({
      creator: seed, cause: seed, name: 'enforced', time: 6 * W + 10, kind: `enf.fee.${rung}`, place: cell,
      participants: [{ who: collector, role: 'enforcer' }, { who: sameTarget ? refuser : other, role: 'target' }], effects: [], witnesses: [], causes: [],
      ...(outcome ? { outcome } : {}),
    });
    sim.advance(1 + 160);
    const slot = sim.stateOf<NormsState>('order.norms')!.slots[key]!;
    return { pending: slot.pending?.length ?? 0, signal: sim.record.log.some((l) => l.reason === 'refusal-signal') };
  };

  test('a done enforcement of the refuser discharges the pending refusal, so no unanswered-refusal signal follows; a failed one, or one of someone else, does not', () => {
    expect(run('done')).toEqual({ pending: 0, signal: false });
    expect(run(undefined)).toEqual({ pending: 0, signal: false });
    expect(run('failed')).toEqual({ pending: 0, signal: true });
    expect(run('done', false)).toEqual({ pending: 0, signal: true });
  });
});

describe('review 12: the foreign-event index is bounded by the windows that can still take its entries', () => {
  test('a foreign event is minted every window for 80 windows: the index never holds more than the last seven windows\' worth, and each is taken exactly once', () => {
    const sim = goalSim('R-12');
    const [x, y] = adults(sim, 0).slice(3, 5) as [Id, Id];
    const seed = sim.k.root('seed-r12', 'core:seed');
    const cell = sim.w.districts[0]!.cellIds[0]!;
    sim.startAt(5);
    let biggest = 0;
    const ids: Id[] = [];
    for (let i = 0; i < 80; i++) {
      ids.push(sim.k.events.mintEvent({
        creator: seed, cause: seed, name: `e${i}`, time: sim.k.now + 10, kind: 'assault', place: cell,
        participants: [{ who: x, role: 'aggressor' }, { who: y, role: 'victim' }], effects: [{ on: y, effect: 'harm' }], witnesses: [], causes: [],
      }));
      sim.advance(1);
      biggest = Math.max(biggest, sim.foreign.size);
    }
    expect(biggest).toBeLessThanOrEqual(8);
    expect(biggest).toBeGreaterThan(1);
    // every one was taken once (the process's `seen` list holds them; it keeps at most `seenMax`)
    const seen = (sim.stateOf<GoalsState>('people.goals')?.seen ?? []);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.every((i) => ids.includes(i))).toBe(true);
    expect(seen.length).toBeGreaterThan(60);
    expect(seen.length).toBeLessThanOrEqual(sim.data.goals.seenMax);
  });
});
