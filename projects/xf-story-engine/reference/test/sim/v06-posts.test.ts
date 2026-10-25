// S1 v0.6 posts, duties and rung entries (S1 4.5, 5.2a, 7.10): SF1-Y-10 (posts are history), SF1-Y-11 (duty draws), SF1-Y-12 (carry-out goals end with their intention),
// SF1-Y-13 (guarding is history), SF1-Y-14 (duties per rung entry).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import type { ProcessOp } from '../../src/evolution.ts';
import type { Id } from '../../src/types.ts';
import type { Descriptor } from '../../src/sim/occ.ts';
import { outcomeOf } from '../../src/sim/outcomes.ts';
import { invCum } from '../../src/sim/arith.ts';
import type { GroupState } from '../../src/sim/proc-groups.ts';
import type { GoalsState } from '../../src/sim/proc-goals.ts';
import type { Sim } from '../../src/sim/sim.ts';
import { transfer } from './feed.ts';
import { adults, bigSim, gnode, goalSim, goalsApplied, plantGoal, W } from './goals-helpers.ts';
import { goalsDigest, groupDigest, startHunt } from './hunt-helpers.ts';
import { seedOf } from './helpers.ts';

setDefaultTimeout(240_000);

/** A window at least `from` whose first second is in the given period of the day. */
const windowIn = (sim: Sim, period: number, from: number): number => {
  for (let w = from; w < from + 1000; w++) if (sim.people.periodOf(w * W) === period) return w;
  throw new Error('no such window');
};

describe('SF1-Y-10: posts are history', () => {
  test('a guard posted at cell c, periods M and D, from w + 1 to w + 50: where is c with cause goal in M and D of those windows and the schedule\'s answer otherwise; an item cast at w + 4 and again at w + 200 is identical', () => {
    const sim = goalSim('SF1-Y-10');
    const base = goalSim('SF1-Y-10');
    const g = adults(sim, 0)[0]!;
    expect(adults(base, 0)[0]).toBe(g); // the same resident, resolved in the second world too
    const c = sim.w.districts[0]!.cellIds[0]!;
    const wItem = windowIn(sim, 1, 150);
    const w = wItem - 3;
    sim.setState('people.goals', (st) => {
      (st as GoalsState).posts.push({ person: g, cell: c, periods: [0, 1], from: w + 1, until: w + 50, goal: H(hs('guard-goal')) });
    });
    sim.startAt(w - 2);
    sim.advance(3);
    // inside the range, in M and D
    let inside = 0;
    for (let x = w + 1; x < w + 50; x++) {
      const t = x * W;
      const period = sim.people.periodOf(t);
      const got = sim.people.where(g, t);
      if (period === 0 || period === 1) {
        expect(got, `window ${x}`).toEqual({ cls: 'post', cell: c, cause: 'goal' });
        inside++;
      } else expect(got, `window ${x}`).toEqual(base.people.where(g, t));
    }
    expect(inside).toBeGreaterThan(0);
    expect(sim.people.where(g, (w + 60) * W)).toEqual(base.people.where(g, (w + 60) * W));
    // an item of window w + 3 opened at w + 4, and again at w + 200 (a reinstalled one): the same cast, because the post is still in the digest's history
    const d: Descriptor = { id: H(hs('item'), hs('Y-10')), kind: 'disorder', size: 1, w: w + 3, time: (w + 3) * W + 100, cell: c, gen: 0, chain: [], public: false, witnesses: 0 };
    const at4 = sim.casting.cast(d);
    const present4 = sim.people.presentAt(c, d.time);
    expect(present4).toContain(g);
    sim.advance(190);
    expect(sim.windowNow()).toBeGreaterThan(w + 190);
    expect(sim.people.presentAt(c, d.time)).toEqual(present4);
    expect(sim.casting.cast(d)).toEqual(at4);
    expect(at4).not.toBe('no-cast');
  });
});

describe('SF1-Y-13: guarding is history', () => {
  test('a guard of ward m, posted at m\'s work cell, who stood there when an item of m was drawn prevented: the same outcome and guard after the guard\'s goal ended, and after a save and a load', () => {
    const make = (): Sim => goalSim('SF1-Y-13');
    const sim = make();
    // a ward with a work cell, and a guard
    const ward = adults(sim, 0, 'vendor')[0] ?? adults(sim, 0)[0]!;
    const guard = adults(sim, 0).find((r) => r !== ward)!;
    const wv = sim.people.view(ward)!;
    const rows = sim.data.people.schedules[wv.archetype] ?? sim.data.people.schedules.resident!;
    const periods = [0, 1, 2, 3].filter((p) => rows[p]![1]! > 0);
    const workCell = sim.people.placeOf(wv, 'work', 0, 0)!;
    // the window in which the ward is at their work cell in a period of the post, a week into the run
    let w0 = -1;
    for (let x = 40; x < 1500; x++) {
      const t = (x + 10) * W + 100;
      if (periods.includes(sim.people.periodOf(t)) && sim.people.where(ward, t).cell === workCell && sim.people.where(ward, t).cls !== 'away') { w0 = x; break; }
    }
    expect(w0).toBeGreaterThan(0);
    sim.setState('people.goals', (st) => {
      (st as GoalsState).posts.push({ person: guard, cell: workCell, periods, from: w0 + 1, until: w0 + 51, goal: H(hs('guard-goal-13')), ward });
    });
    // an occurrence id whose keyed draw is below the shakedown's chance of prevention (0.7)
    let id: Id = '';
    for (let i = 0; ; i++) {
      id = H(hs('probe'), hs(String(i)));
      if (sim.ids.outcome(id) < 0.5) break;
    }
    const t = (w0 + 10) * W + 100;
    const d = { id, kind: 'shakedown', time: t };
    const cast = [{ role: 'aggressor', who: guard }, { role: 'victim', who: ward }];
    sim.startAt(w0 - 1);
    sim.advance(13);
    const at11 = outcomeOf(sim, d, cast, sim.outcomeView());
    expect(at11).toEqual({ outcome: 'prevented', guard });
    // the guard's goal has ended long since (its post ended at w0 + 51), and the history keeps the post a week after
    sim.advance(290);
    expect(sim.windowNow()).toBeGreaterThan(w0 + 300);
    const at300 = outcomeOf(sim, d, cast, sim.outcomeView());
    expect(at300).toEqual(at11);
    // saved at w + 300 and loaded into a fresh engine: the same
    sim.k.persistence.save('A');
    const fresh = transfer(sim, 'A', make, 9);
    adults(fresh, 0); // a cast resolves the block's residents first, as presentAt does
    const reloaded = outcomeOf(fresh, d, cast, fresh.outcomeView());
    expect(reloaded).toEqual(at11);
    // and after the week the post is kept for has passed, nothing guards the ward any more
    fresh.advance(1100);
    expect(outcomeOf(fresh, d, cast, fresh.outcomeView()).outcome).not.toBe('prevented');
    void goalsApplied;
  });
});

/** The ops one process published, as it runs. */
function captureOps(sim: Sim, id: string): ProcessOp[][] {
  const out: ProcessOp[][] = [];
  const def = sim.defs.get(id)!;
  const run = def.run.bind(def);
  def.run = (pctx, k) => {
    const res = run(pctx, k);
    out.push(Array.isArray(res) ? res : res.ops);
    return res;
  };
  return out;
}

describe('SF1-Y-11: duty draws', () => {
  /** The spec's draw of a member for a slot (S1 7.10), with the eligibility the test hands it. */
  function expectedMember(sim: Sim, decision: Id, rung: number, entry: number, duty: string, slot: number, f: number, ok: (r: Id) => boolean, attempts = 24): Id | undefined {
    const dist = sim.w.districts[0]!;
    const weights = dist.cellIds.map((c) => sim.people.residentCount(c) * sim.casting.classPresence(c, f));
    for (let a = 0; a < attempts; a++) {
      const block = dist.cellIds[invCum(weights, sim.ids.dutyB(decision, rung, entry, duty, slot, a))]!;
      const n = sim.people.residentCount(block);
      if (n === 0) continue;
      const r = sim.people.residentAt(block, Math.floor(sim.ids.dutyR(decision, rung, entry, duty, slot, a) * n));
      if (ok(r)) return r;
    }
    return undefined;
  }

  /** A world where group A1 has an active retaliation against a member `x` of A2, the wrongdoer, ward `wd`. */
  function retaliation(name: string, tweak: (d: import('../../src/sim/data.ts').S1Data) => void = () => {}) {
    const sim = bigSim(name, tweak, ['group.decide', 'people.goals']);
    const GA = gnode(sim, 'A1');
    sim.setState('group.decide', () => {});
    const g = sim.stateOf<GroupState>('group.decide')!.groups[GA]!;
    const holders = new Set(g.seats.map((s) => s.holder));
    const x = adults(sim, 3, 'gang').find((r) => !holders.has(r))!;
    const wd = adults(sim, 2).find((r) => !holders.has(r))!;
    const decision = H(hs('mint'), hs('retal-decision'), hs(name));
    sim.setState('group.decide', (st) => {
      const gg = (st as GroupState).groups[GA]!;
      gg.intent = { state: 'active', id: decision, name: 'retaliate', drive: 'retribution', since: 0, expires: 100000, rival: 3, wrongdoer: x, ward: wd, motive: 0.5 } as never;
      // keep it going: the group's pressure is not what this fixture studies
      gg.pulse.retribution = { at: 0, sev: 1, latched: true, rival: 3, src: H(hs('src')), ward: wd, wrongdoer: x };
    });
    sim.startAt(2);
    return { sim, GA, decision, x, holders, wd };
  }

  test('the member of a strike is drawn by duty-b and duty-r keyed by the decision, is never a seat holder, and the target is the wrongdoer', () => {
    const { sim, GA, decision, x, holders } = retaliation('SF1-Y-11');
    sim.advance(4);
    const duty = goalsDigest(sim).goals.filter((g) => g.duty === 'strike');
    expect(duty).toHaveLength(1);
    expect(duty[0]!).toMatchObject({ kind: 'carry-out', target: x, acts: ['assault'], intent: { group: GA, decision, name: 'retaliate', entry: 1 } });
    expect(duty[0]!.intent!.rung).toBeUndefined();
    const own = duty[0]!.owner;
    expect(holders.has(own)).toBe(false);
    const v = sim.people.view(own)!;
    expect(v.affc).toBe(2);
    expect(v.role).toBe('gang');
    // the first attempt that finds an eligible member, by the draws the spec keys
    const exp = expectedMember(sim, decision, 0, 1, 'strike', 0, 2, (r) => {
      const rv = sim.people.view(r)!;
      return rv.ageClass === 'adult' && rv.affc === 2 && rv.role === 'gang' && !holders.has(r) && sim.people.alive(r, 0);
    }, sim.data.goals.attempts);
    expect(own).toBe(exp!);
    expect(duty[0]!.post!.cell).toBe(sim.people.placeOf(sim.people.view(x)!, 'work', 0, 0)!);
  });

  test('a strike is never given to a member tied at layer 1 to its target; a punish duty passes over a member with a materialised tie to V', () => {
    const { sim, decision, x } = retaliation('SF1-Y-11b');
    // the first member the draws find is the target\'s kin, so another is drawn
    const first = expectedMember(sim, decision, 0, 1, 'strike', 0, 2, (r) => sim.people.view(r)!.ageClass === 'adult' && sim.people.view(r)!.role === 'gang' && sim.people.alive(r, 0), sim.data.goals.attempts);
    expect(first).toBeDefined();
    const tie = sim.ties.tie.bind(sim.ties);
    sim.ties.tie = (a, b) => ((a === first && b === x) || (a === x && b === first) ? { tied: true, kind: 'kin', layer: 1 } : tie(a, b));
    sim.advance(4);
    const duty = goalsDigest(sim).goals.filter((g) => g.duty === 'strike');
    expect(duty).toHaveLength(1);
    expect(duty[0]!.owner).not.toBe(first);
  });

  test('24 failed attempts leave the slot unfilled, logged duty-unfilled', () => {
        // with no spare capacity anywhere (perPerson 0), no member can be given a duty: every draw fails
    const sim = goalSim('SF1-Y-11c', (d) => { d.goals.perPerson = 0; }, ['group.decide', 'people.goals']);
    const GA = gnode(sim, 'A1');
    sim.setState('group.decide', () => {});
    const decision = H(hs('mint'), hs('collect-decision'));
    sim.setState('group.decide', (st) => {
      const gg = (st as GroupState).groups[GA]!;
      gg.intent = { state: 'active', id: decision, name: 'collect-fee', drive: 'treasury', since: 0, expires: 100000, motive: 0.5 } as never;
      // an empty treasury keeps the intention going
      gg.books.cash = 0;
    });
    sim.startAt(2);
    sim.advance(5);
    const unfilled = sim.record.log.filter((e) => e.reason === 'duty-unfilled');
    const filled = goalsDigest(sim).goals.filter((g) => g.duty === 'collect');
    expect(filled.length + unfilled.length).toBe(2);
    expect(unfilled.length).toBe(2);
    expect(filled).toHaveLength(0);
    expect(sim.stateOf<GoalsState>('people.goals')!.counters.unfilled).toBe(unfilled.length);
  });
});

describe('SF1-Y-12: carry-out goals end with their intention', () => {
  test('collect-fee: two collect goals open in the window after the decision is published, each with a market post in M and D; their shakedowns served their frames and cite the decision; at the relent both end intent-end with it as cause', () => {
    const sim = bigSim('SF1-Y-12', (d) => { d.goals.rate.shakedown = 1e5; d.goals.attempts = 600; d.groups.intents.find((i) => i.id === 'collect-fee')!.duration = 200; }, ['city.events', 'group.decide', 'people.goals']);
    const GA = gnode(sim, 'A1');
    sim.setState('group.decide', () => {});
    sim.setState('group.decide', (st) => {
      const gg = (st as GroupState).groups[GA]!;
      gg.books.cash = 0;
    });
    const ops = captureOps(sim, 'people.goals');
    sim.startAt(2);
    let decision: Id | undefined;
    let startedAt = -1;
    for (let i = 0; i < 400 && decision === undefined; i++) {
      sim.advance(1);
      const a = groupDigest(sim)?.groups[GA]?.active;
      if (a?.name === 'collect-fee') {
        decision = a.id;
        startedAt = sim.windowNow();
      }
    }
    expect(decision).toBeDefined();
    sim.advance(3);
    const collect = goalsDigest(sim).goals.filter((g) => g.duty === 'collect');
    expect(collect).toHaveLength(2);
    for (const g of collect) {
      expect(g).toMatchObject({ kind: 'carry-out', acts: ['shakedown'], intent: { decision } });
      expect(g.post!.periods).toEqual([0, 1]);
      expect(sim.w.cell(g.post!.cell).marketCell).toBe(true);
    }
    // the goals opened in the window after the decision was published
    const opened = Object.values(sim.stateOf<GoalsState>('people.goals')!.posts).filter((p) => collect.some((g) => g.id === p.goal));
    expect(Math.min(...opened.map((p) => p.from))).toBeLessThanOrEqual(startedAt + 3);
    // run the intention out; its shakedowns happen at the posts, in the morning and by day
    sim.advance(260);
    const acts = (sim.stateOf<{ ring: Array<{ kind: string; w: number; cell: Id; event?: { served?: Id; causes?: Id[]; time: number } }> }>('city.events')?.ring ?? []).filter((r) => r.event?.served !== undefined && r.kind === 'shakedown');
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) {
      expect(collect.some((g) => g.id === a.event!.served)).toBe(true);
      expect(a.event!.causes).toContain(decision!);
      expect([0, 1]).toContain(sim.people.periodOf(a.event!.time));
      expect(sim.w.cell(a.cell).marketCell).toBe(true);
    }
    // at the relent both end intent-end, with the relent event as the cause of their frames' end
    const relent = H(hs('mint'), hs(processCause('group.decide')), hs(GA), hs(`relent/collect-fee/${endWindow(ops)}`));
    void relent;
    const statuses = ops.flat().filter((o) => o.op === 'frame-status' && collect.some((g) => g.id === o.frame));
    expect(statuses.length).toBe(2);
    for (const s of statuses) {
      expect(s).toMatchObject({ status: 'abandoned' });
      const cause = (s as { cause: Id }).cause;
      expect(sim.k.value(cause, 'kind')).toBe('relent.collect-fee');
    }
    expect(sim.record.log.filter((e) => e.reason === 'goal-end' && e.key?.endsWith('|intent-end')).length).toBeGreaterThanOrEqual(2);
  });
});
const endWindow = (ops: ProcessOp[][]): number => ops.length;

describe('SF1-Y-14: duties per rung entry', () => {
  test('rung 1 (entry 1), a climb to 2 (entry 2), tempo to calm (a drop to 1, entry 3), tempo back and a climb to 2 (entry 4): the warn duties of entries 1 and 2 have different Ids; entry 3 opens no warn and no other duty; entry 4 a fresh search and no second price; the entry is dropped after the relent', () => {
    const quick = (d: import('../../src/sim/data.ts').S1Data): void => {
      d.goals.rate.warning = 500; d.goals.rate.price = 500; d.goals.rate.search = 500; d.groups.punish.rungDwell = 6; d.groups.punish.climbP = 100;
    };
    const h = startHunt({ name: 'SF1-Y-14', delay: 4, tweak: quick });
    const { sim, GA } = h;
    const seen = new Map<Id, { duty?: string; rung?: number; entry?: number }>();
    const note = (): void => { for (const g of goalsDigest(sim)?.goals ?? []) if (g.intent) seen.set(g.id, { ...(g.duty ? { duty: g.duty } : {}), ...(g.intent.rung ? { rung: g.intent.rung } : {}), ...(g.intent.entry ? { entry: g.intent.entry } : {}) }); };
    const until = (cond: () => boolean, max = 700): void => { for (let i = 0; i < max && !cond(); i++) { h.step(1); note(); } };
    const act = (): { rung?: number; entry?: number } => groupDigest(sim)?.groups[GA]?.active ?? {};
    until(() => act().rung === 2);
    expect(act().entry).toBe(2);
    // a warn and a search were given at entry 2 (the price; and a searcher)
    until(() => [...seen.values()].some((x) => x.entry === 2 && x.duty === 'search'));
    sim.k.settings.set({ tempo: 'calm' });
    until(() => act().rung === 1);
    expect(act().entry).toBe(3);
    h.step(4);
    note();
    sim.k.settings.set({ tempo: 'restless' });
    until(() => act().rung === 2 && act().entry === 4);
    h.step(4);
    note();
    const byEntry = (e: number): Array<{ duty?: string }> => [...seen.values()].filter((x) => x.entry === e);
    expect(byEntry(1).map((x) => x.duty)).toEqual(['warn']);
    expect(byEntry(2).map((x) => x.duty).sort()).toEqual(['search', 'warn']);
    // the word stands: entry 3 (back at rung 1, where a warning was admitted) opens nothing; entry 4 gives a fresh search and no second price
    expect(byEntry(3)).toEqual([]);
    expect(byEntry(4).map((x) => x.duty)).toEqual(['search']);
    const ids = [...seen.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    // the intention relents and the entry goes
    const decision = groupDigest(sim).groups[GA]!.active!.id;
    expect(sim.stateOf<GoalsState>('people.goals')!.entries[decision]).toBe(4);
    sim.k.settings.set({ tempo: 'off' });
    h.step(4);
    expect(sim.stateOf<GoalsState>('people.goals')!.entries[decision]).toBeUndefined();
    void adults; void plantGoal; void seedOf;
  });
});
