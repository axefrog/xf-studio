// M3 run 2: V is told of the incidents that open near it (`RunExtra.witness`). S1 opens an incident into people only where something is looking,
// and S3 asks two things of an offer that S1's record does not carry on its own near V: V takes part in a stage's event (gate 5) and the last event
// has a recorded cause (gate 3). With the driver standing in for the game's report of what V saw, the second stage of an offer pattern (a `tell`
// event, naming the incident as its cause and as a subject, with V as its listener) is in the record, and the offer is sown. Without it, no offer is.
//
// Three things are pinned here:
//   - the report is passive: S1's whole record (ties, regard, beliefs, the record's histories) is the same with it and without it, outside the report
//     itself (a `disclosure`, which the first version minted, was not: it made a tie and warmth);
//   - the report is of one incident: a pattern's second stage completes only on the report of an incident of its own kind among its own people, so a
//     report of another incident of the same victim does not complete it;
//   - the real run: the told incidents leave a second stage in the record, and the offers sown carry a V-link and a cause. The two 108-window runs are
//     `S1_FULL=1`; the default is one shorter run.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { mintedId } from '../../src/id.ts';
import { Run, WINDOW, policies, witnessReport } from '../../src/m3/driver.ts';
import { OFFER_PACK } from '../../src/m3/kits.ts';
import { offerKitPack, offerPatterns } from '../../src/m3/offers.ts';
import { run2World } from '../../src/m3/run2.ts';
import { stateById } from '../../src/m3/states.ts';
import type { ReplayLine } from '../../src/sim/port.ts';
import { WIDE_NAMES } from '../../src/sim/names.ts';
import type { Id } from '../../src/types.ts';

setDefaultTimeout(600_000);
const FULL = process.env.S1_FULL === '1';
const early = stateById('S-early-quiet');
const wide = (d: import('../../src/sim/data.ts').S1Data): void => { d.people.names = WIDE_NAMES; };

/** Named adult residents of the district, in a fixed order. */
function residents(r: Run, n: number): Id[] {
  const sim = r.w.sim;
  const out: Id[] = [];
  for (const c of sim.w.districts[0]!.cellIds) {
    for (const x of sim.people.residentsOfBlock(c)) {
      const v = sim.people.view(x);
      if (v && v.aband >= 1 && r.nameOf(x)) out.push(x);
      if (out.length >= n) return out;
    }
  }
  return out;
}

/** The Id the replay port gives the `n`th raw event of time `t`. */
const rawId = (r: Run, t: number, n = 0): Id => mintedId(r.w.sim.w.port, r.w.sim.w.port, `raw/${t}/${n}`);
const place = (r: Run): Id => r.w.sim.w.index.names!['g1']!;

describe('the report of what V saw is passive: it changes nothing of S1\'s record', () => {
  /** A world with one theft near V, and then the given report of it (or none), settled for a few windows. */
  function world(report: 'none' | 'tell' | 'disclosure'): { r: Run; a: Id; b: Id } {
    const r = new Run({ name: 'witness-passive', layer3: false, packs: [], s1: wide }, early, policies.decline!);
    const [a, b] = residents(r, 2) as [Id, Id];
    r.runWindows(1);
    const t = r.windowNo * WINDOW + 1;
    r.w.replay.submit([{ t, op: 'event', kind: 'theft', place: 'g1', participants: [{ who: a, role: 'aggressor' }, { who: b, role: 'victim' }], effects: [{ on: b, effect: 'take' }] }]);
    r.runWindows(1);
    if (report !== 'none') {
      const line = witnessReport(r.windowNo * WINDOW + 1, place(r), rawId(r, t), b, [a]);
      r.w.replay.submit([{ ...line, kind: report } as ReplayLine]);
    }
    r.runWindows(4);
    return { r, a, b };
  }

  /** Everything S1 keeps about people and what they think: ties, regard and every other edge, the beliefs, and the record's histories. */
  function s1State(r: Run, report: Id): string {
    const { log: _log, seq: _seq, ord: _ord, ...record } = r.w.sim.record;
    // outside the report itself: the one thing a minted event brings is its own placement edge
    const edges = r.w.sim.k.store.allEdges().filter((e) => e.from !== report);
    return JSON.stringify({ edges, beliefs: r.w.sim.k.beliefs.entries(), record });
  }
  /** The report of `world()`: the second raw event of the run, one window after the incident. */
  const reportOf = (r: Run): Id => rawId(r, 601 + 600);

  const none = world('none');
  const tell = world('tell');
  const disclosure = world('disclosure');

  test('with the report or without it, the edges (ties and regard), the beliefs and the record are the same', () => {
    expect(s1State(tell.r, reportOf(tell.r))).toBe(s1State(none.r, reportOf(none.r)));
    // nothing was made for V: no regard of V by either person, no tie, no belief about V
    const v = none.r.w.sim.w.v;
    for (const w of [none, tell]) {
      for (const p of [w.a, w.b]) expect(w.r.w.sim.tiePolicy.regardOf(p, v)).toEqual({ warmth: 0, respect: 0, trustA: 0.5, trustB: 0.5, trustI: 0.5, evN: 0 });
      expect(w.r.w.sim.record.tieHistory).toEqual({});
    }
    // the report is in the record all the same: an event of its own kind, with V as its listener and the incident as its cause
    const ev = tell.r.w.sim.policies.viewEvent(reportOf(tell.r))!;
    expect(ev.kind).toBe('tell');
    expect(ev.participants.some((p) => p.who === v && p.role === 'listener')).toBe(true);
    expect(ev.causes).toEqual([rawId(tell.r, 601)]);
  });

  test('the test can see an effect: the same report as a disclosure (what the first version minted) does change S1\'s record', () => {
    const v = disclosure.r.w.sim.w.v;
    expect(disclosure.r.w.sim.tiePolicy.regardOf(disclosure.b, v).warmth).toBeGreaterThan(0);
    expect(Object.keys(disclosure.r.w.sim.record.tieHistory).length).toBeGreaterThan(0);
    expect(s1State(disclosure.r, reportOf(disclosure.r))).not.toBe(s1State(none.r, reportOf(none.r)));
  });
});

describe('the report is of one incident: the second stage matches that kind of incident among those people', () => {
  /**
   * Incidents near V among named residents a1, a2 (aggressors), b (a victim of both thefts and of an accident) and c, then the reports given.
   * Returns, for each pattern, the entries the sifter completed (by the bindings it matched).
   */
  function play(reports: (r: Run, ids: { a1: Id; a2: Id; b: Id; c: Id; theft1: Id; theft2: Id; accident: Id }) => ReplayLine[]) {
    const r = new Run({ name: 'witness-overlap', layer3: true, tempo: 'steady', packs: [offerKitPack()], patterns: offerPatterns(), s1: wide }, early, policies.decline!);
    const [a1, a2, b, c] = residents(r, 4) as [Id, Id, Id, Id];
    r.runWindows(1);
    const t = r.windowNo * WINDOW + 1;
    // three incidents of the same victim: two thefts by different people, and an accident, in one window
    r.w.replay.submit([
      { t, op: 'event', kind: 'theft', place: 'g1', participants: [{ who: a1, role: 'aggressor' }, { who: b, role: 'victim' }], effects: [{ on: b, effect: 'take' }] },
      { t, op: 'event', kind: 'theft', place: 'g1', participants: [{ who: a2, role: 'aggressor' }, { who: b, role: 'victim' }], effects: [{ on: b, effect: 'take' }] },
      { t, op: 'event', kind: 'accident', place: 'g1', participants: [{ who: b, role: 'victim' }], effects: [{ on: b, effect: 'harm' }] },
    ]);
    const ids = { a1, a2, b, c, theft1: rawId(r, t, 0), theft2: rawId(r, t, 1), accident: rawId(r, t, 2) };
    r.runWindows(2);
    const l3 = r.w.l3!;
    // all three are open matches, none complete
    const open = (): Array<{ pattern: string; who: Id | undefined; subject: Id | undefined; complete: boolean; stages: number }> =>
      l3.state.pool.filter((e) => e.pattern.startsWith('xf.m3b:')).map((e) => ({ pattern: e.pattern.split(':')[1]!, who: e.bindings['?v'] ?? e.bindings['?s'], subject: e.bindings['?a'], complete: e.complete, stages: e.stages.length }));
    expect(open().filter((e) => e.who === b && !e.complete).map((e) => `${e.pattern}/${e.subject ?? '-'}`).sort())
      .toEqual([`accident-errand/-`, `goods-back/${a1}`, `goods-back/${a2}`].sort());
    r.w.replay.submit(reports(r, ids));
    r.runWindows(6);
    // what the sifter completed (a completed entry may since have been sown, so the log is the record of it)
    const done = l3.log.filter((l) => l.kind === 'match' && l.rule === 'match-complete').map((l) => l.data as { pattern: string; bindings: Record<string, Id> });
    return { r, ids, done, open };
  }
  const at = (r: Run, k = 0): number => r.windowNo * WINDOW + 1 + k;
  const completed = (done: Array<{ pattern: string; bindings: Record<string, Id> }>, pattern: string): Array<Id | undefined> =>
    done.filter((d) => d.pattern === `xf.m3b:${pattern}`).map((d) => d.bindings['?a']).sort();

  test('no report, no completion', () => {
    const { done } = play(() => []);
    expect(done.filter((d) => d.pattern.startsWith('xf.m3b:'))).toEqual([]);
  });

  test('the report of the accident completes the accident and not the theft of the same victim', () => {
    const { done } = play((r, x) => [witnessReport(at(r), place(r), x.accident, x.b, [])]);
    expect(done.map((d) => d.pattern).filter((p) => p.startsWith('xf.m3b:'))).toEqual(['xf.m3b:accident-errand']);
  });

  test('the report of the theft by one person completes that theft only, not the other theft of the same victim, not the accident', () => {
    const { done, ids } = play((r, x) => [witnessReport(at(r), place(r), x.theft2, x.b, [x.a2])]);
    expect(done.map((d) => d.pattern).filter((p) => p.startsWith('xf.m3b:'))).toEqual(['xf.m3b:goods-back']);
    expect(completed(done, 'goods-back')).toEqual([ids.a2]);
  });

  test('a report that names the victim and the other person but the wrong kind of incident does not complete the theft', () => {
    // the right people (a1 and b) but the accident as the incident: no theft pattern accepts it
    const { done } = play((r, x) => [witnessReport(at(r), place(r), x.accident, x.b, [x.a1])]);
    expect(completed(done, 'goods-back')).toEqual([]);
  });

  test('a report that names the right kind of incident but another aggressor does not complete the theft', () => {
    // theft 1 is a1's; the report says a2 took part, so it cannot complete a1's theft (it does complete a2's, which is its own)
    const { done, ids } = play((r, x) => [witnessReport(at(r), place(r), x.theft1, x.b, [x.a2])]);
    expect(completed(done, 'goods-back')).toEqual([ids.a2]);
  });

  test('a report by someone who was not the victim completes nothing', () => {
    const { done } = play((r, x) => [witnessReport(at(r), place(r), x.theft1, x.c, [x.a1])]);
    expect(completed(done, 'goods-back')).toEqual([]);
  });

  test('both reports complete both, each its own: the thefts are two matches', () => {
    const { done, ids } = play((r, x) => [witnessReport(at(r), place(r), x.theft1, x.b, [x.a1]), witnessReport(at(r, 1), place(r), x.theft2, x.b, [x.a2]), witnessReport(at(r, 2), place(r), x.accident, x.b, [])]);
    expect(completed(done, 'goods-back')).toEqual([ids.a1, ids.a2].sort());
    expect(completed(done, 'accident-errand')).toHaveLength(1);
  });
});

describe('V told of an incident near it (the real run)', () => {
  const play = (witness: boolean, windows: number): Run => {
    const { opts, notes } = run2World('p3f', 'E', 'restless');
    const r = new Run(opts, early, policies.decline!, { walk: true, witness, notes });
    r.runWindows(windows);
    return r;
  };
  // the default is one run that is long enough for two offers to be told; `S1_FULL=1` plays the 108 windows of the first version, with and without the report
  const windows = FULL ? 108 : 84;
  const on = play(true, windows);

  test('the offer tier completes, and its second stage is a report caused by the incident, naming it, with V as its listener', () => {
    expect(on.witnessed).toBeGreaterThanOrEqual(2);
    const l3 = on.w.l3!;
    const done = l3.state.pool.filter((e) => e.pattern.startsWith('xf.m3b:') && e.stages.length === 2);
    const sown = on.deliveries.filter((d) => d.what === 'offer' && d.template.startsWith(OFFER_PACK));
    expect(sown.length + done.length).toBeGreaterThanOrEqual(1);
    // every told incident left a second stage in the record: a report with V in it, caused by the incident that opened the match
    for (const e of done) {
      const first = l3.kv.event(e.stages[0]!.event)!;
      const second = l3.kv.event(e.stages[1]!.event)!;
      expect(second.kind).toBe('tell');
      expect(second.participants.some((p) => p.who === on.w.sim.w.v && p.role === 'listener')).toBe(true);
      expect(second.participants.some((p) => p.who === first.id && p.role === 'subject')).toBe(true);
      expect(second.causes).toEqual([first.id]);
      expect(second.time).toBeGreaterThanOrEqual(first.time);
    }
  });

  test('the offers that were sown carry a V-link and a cause in the record (gates 5 and 3 were passed, not assumed)', () => {
    const sowed = on.w.l3!.log.filter((l) => l.kind === 'sow' && l.rule === 'sow' && String((l.data as { kit?: string }).kit).startsWith(OFFER_PACK));
    expect(sowed.length).toBeGreaterThanOrEqual(1);
    for (const l of sowed) {
      const f = (l.data as { features: Record<string, number> }).features;
      expect(f.F5).toBeGreaterThanOrEqual(2);
      expect(l.chain.length).toBe(2);
    }
  });

  test('the told incidents opened no tie to V and no regard: the report is not a disclosure', () => {
    const v = on.w.sim.w.v;
    expect(on.witnessed).toBeGreaterThanOrEqual(1);
    for (const e of on.w.sim.k.store.allEdges()) expect(e.to === v && e.type === 'xf:regard' ? e : undefined).toBeUndefined();
    expect(on.w.sim.record.tieHistory).toEqual({});
  });

  (FULL ? test : test.skip)('without the report no offer is sown: the engine\'s own gates refuse an offer about people V was not told of (S1_FULL=1)', () => {
    const off = play(false, windows);
    expect(off.witnessed).toBe(0);
    expect(off.deliveries.filter((d) => d.what === 'offer' && d.template.startsWith(OFFER_PACK))).toEqual([]);
    expect(off.w.l3!.state.pool.some((e) => e.pattern.startsWith('xf.m3b:') && e.stages.length === 2)).toBe(false);
  });

  (FULL ? test : test.skip)('the driver changes nothing else: both worlds opened the same incidents (S1_FULL=1)', () => {
    const off = play(false, windows);
    const kinds = (r: Run): string[] => r.w.l3!.state.pool.filter((e) => e.pattern.startsWith('xf.m3:') && e.complete).map((e) => e.pattern).sort();
    expect(kinds(on).length).toBeGreaterThan(0);
    expect(kinds(off).length).toBeGreaterThan(0);
  });
});
