// The findings of the independent review of S1 v0.6 (the second build): one fixture per finding, small and quick.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import type { Id } from '../../src/types.ts';
import { transfer } from './feed.ts';
import { H, s as hs } from '../../src/id.ts';
import type { GroupDigest, GroupState } from '../../src/sim/proc-groups.ts';
import { adults, bigSim, fact, feedEvents, gnode, goalSim, goalsState, W } from './goals-helpers.ts';
import type { Sim } from '../../src/sim/sim.ts';
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
