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

/** What an R2 play came to, apart from when it was released (pacing may move that, SF3-36). */
export function semanticOfR2(run: Run): Record<string, unknown> | undefined {
  const inst = run.instancesOf(R2_ID)[0];
  if (!inst) return undefined;
  return {
    id: inst.id,
    state: inst.st.state,
    roles: Object.fromEntries(Object.entries(inst.st.roles).map(([k, r]) => [k, r.cast])),
    draws: Object.fromEntries(Object.entries(inst.st.draws).map(([k, d]) => [k, d.value])),
    offers: inst.st.deliveries.filter((d) => d.what === 'offer').map((d) => d.id),
    answers: run.deliveries.filter((d) => d.template === R2_ID && d.answer).map((d) => d.answer),
    beats: Object.fromEntries(Object.entries(inst.st.beats).map(([k, b]) => [k, b.state])),
    closure: inst.st.closed ? { status: inst.st.closed.status } : null,
  };
}
