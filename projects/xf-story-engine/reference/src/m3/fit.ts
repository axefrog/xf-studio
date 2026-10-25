// The fit report as a comparison key (D23, S23-S2-10: "Fitting is a service"). The authored seed fitted on a story state with
// sowing off and with sowing on must give the same verdict, windows, cast, draws and exits. Two parts of a report differ by
// construction and are left out of the key: the `fit` block that only layer 3's hook writes (the world terms it weighed), and the
// tempo the report names among its settings.

import { fitReport, type FitReport } from '../seeding/fit.ts';
import type { Run } from './driver.ts';
import { R2_ID, R2_PACK } from './r2.ts';

export interface FitKey {
  verdict: FitReport['verdict'];
  why: string[];
  windows: FitReport['windows'];
  cast: FitReport['cast'];
  draws: FitReport['draws'];
  exits: FitReport['exits'];
  timing: FitReport['timing'];
  declinePreview: FitReport['declinePreview'];
  cost: FitReport['cost'];
  findings: FitReport['findings'];
  content: Record<string, number>;
}

export function fitKey(r: FitReport): FitKey {
  return {
    verdict: r.verdict, why: r.why, windows: r.windows, cast: r.cast, draws: r.draws, exits: r.exits, timing: r.timing,
    declinePreview: r.declinePreview, cost: r.cost, findings: r.findings, content: r.settings.content,
  };
}

/** The fit report of R2 on a run's world as it stands now. */
export function fitOfR2(run: Run): FitReport {
  return fitReport(run.w.l2, R2_PACK, R2_ID);
}

/**
 * What an R2 play came to: who was cast, what was drawn, which fragment each beat selected, what was delivered (the words, in
 * order, with how V answered), and the state it left behind (the closure and what each beat ended as). The only things left out
 * are when each thing was released and the counters of the clock (`since`, `availableAt`, `finalAt`, `doneAt`), which layer 3's
 * pacing is allowed to move (SF3-36). A later release can change what a beat selects, because the world has moved on by then, so
 * the comparison reads the selected fragments and the delivered words and does not assume pacing leaves them alone.
 */
export function semanticOfR2(run: Run): Record<string, unknown> | undefined {
  const inst = run.instancesOf(R2_ID)[0];
  if (!inst) return undefined;
  return {
    id: inst.id,
    state: inst.st.state,
    roles: Object.fromEntries(Object.entries(inst.st.roles).map(([k, r]) => [k, r.cast])),
    draws: Object.fromEntries(Object.entries(inst.st.draws).map(([k, d]) => [k, d.value])),
    beats: Object.fromEntries(Object.entries(inst.st.beats).map(([k, b]) => [k, { state: b.state, fragment: b.fragment ?? null, response: b.response ?? null, releases: b.releases, offers: b.offers, attempt: b.attempt, skip: b.skip ?? null }])),
    facts: Object.fromEntries(Object.entries(inst.st.facts).map(([k, f]) => [k, f.n])),
    deliveries: inst.st.deliveries.map((d) => ({ what: d.what, beat: d.beat ?? null, fragment: d.fragment ?? null, state: d.state })),
    delivered: run.deliveries.filter((d) => d.template === R2_ID).map((d) => ({ what: d.what, beat: d.beat, channel: d.channel, words: d.words, names: d.names, answer: d.answer ?? null })),
    closure: inst.st.closed ? { status: inst.st.closed.status, witnessed: inst.st.closed.witnessed } : null,
  };
}

/** When R2's deliveries were released (game seconds), the one thing the play comparison leaves out. */
export function releaseTimesOfR2(run: Run): number[] {
  return run.deliveries.filter((d) => d.template === R2_ID).map((d) => d.game);
}

/** The top-level parts of two plays that differ (empty when they agree); `a` and `b` are `semanticOfR2` results. */
export function playDifference(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): string[] {
  if (!a || !b) return a === b ? [] : ['instance'];
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
