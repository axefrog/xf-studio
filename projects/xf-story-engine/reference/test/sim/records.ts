// The canonical records the end-to-end fixtures compare (S1 14.2): the state a save would hold, section by section, and the S1 record.

import { canonicalKey } from '../../src/canon.ts';
import type { Sim } from '../../src/sim/sim.ts';

export type Sections = Record<string, string>;

/**
 * The canonical encoding of everything a save of this sim would hold, one entry per section: headers, pins, edges, contributions,
 * memorable beliefs, canon, summaries, frames, seeds (which hold the S1 record), settings, and each process's state, digest and
 * outstanding batch. Two sims whose futures are the same have the same sections.
 *
 * `endedEdges: true` leaves out the *ended seat and holder edges* (`HISTORY_EDGE_TYPES`) and no other: the view is what the next save would hold *from the last save
 * on*, so a run that was saved holds, in the view, an ended edge it had saved while live, and one that never was does not, though a save of it writes the edge (it
 * changed since the base). The past of those two types is compared by the reads, both ways (`sameHistoricalEdges`); an ended edge of any other type is compared like
 * the rest (SPEC-NOTES).
 */
export const HISTORY_EDGE_TYPES: readonly string[] = ['xf:leads', 'xf:held-by'];

export function recordOf(sim: Sim, skip: { processes?: string[]; logProcs?: string[]; endedEdges?: boolean } = {}): Sections {
  sim.flush();
  const data = sim.k.persistence.currentView().toData();
  const out: Sections = {};
  for (const key of ['headers', 'pins', 'edges', 'contributions', 'beliefs', 'canon', 'materialisations', 'summaries', 'frames', 'seeds', 'settings'] as const) {
    out[key] = canonicalKey(key === 'edges' && skip.endedEdges ? (data.edges ?? []).filter((e) => e.valid.to === undefined || e.valid.to > sim.k.now || !HISTORY_EDGE_TYPES.includes(e.type)) : data[key] ?? []);
  }
  for (const p of data.processes) if (!skip.processes?.includes(p.id)) out[`process:${p.id}`] = canonicalKey(p);
  const record = structuredClone(sim.record);
  if (skip.logProcs) {
    // the log's numbers are one count over every process, so the entries left are renumbered in their order and the count follows: what is
    // compared is what the other processes wrote and in which order, not how many lines the skipped ones wrote between them
    record.log = record.log.filter((e) => !skip.logProcs!.includes(e.proc));
    record.log.forEach((e, n) => { e.seq = n; });
    record.seq = record.log.length;
  }
  out['s1-record'] = canonicalKey(record);
  return out;
}

/**
 * The past of the seat and holder edges of two runs answered alike, both ways: every such edge either store holds, ended ones included, gives the same `leads` or
 * `holds` transitions in both. Returns the edges whose reads differ (empty when the histories agree).
 */
export function sameHistoricalEdges(a: Sim, b: Sim): Array<{ type: string; id: string; owner: string }> {
  const bad: Array<{ type: string; id: string; owner: string }> = [];
  const read = (sim: Sim, e: { type: string; from: string; to: string }): unknown => (e.type === 'xf:leads' ? sim.reads.transitions('leads', [e.from, e.to], 0, sim.k.now) : sim.reads.transitions('holds', [e.to, e.from], 0, sim.k.now));
  for (const [x, y, owner] of [[a, b, 'first'], [b, a, 'second']] as const) {
    for (const e of x.k.store.allEdges().filter((z) => HISTORY_EDGE_TYPES.includes(z.type))) {
      if (JSON.stringify(read(a, e)) !== JSON.stringify(read(b, e))) bad.push({ type: e.type, id: e.id, owner });
    }
    void y;
  }
  return bad;
}

/** The names of the sections that differ. */
export function differing(a: Sections, b: Sections): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/** The lines of `a`'s pretty-printed JSON that `b` does not have: a readable account of what differs. */
export function linesOnlyIn(a: unknown, b: unknown, max = 12): string {
  const lb = new Set(JSON.stringify(b, null, 1).split('\n'));
  return JSON.stringify(JSON.stringify(a, null, 1).split('\n').filter((l) => !lb.has(l)).slice(0, max));
}
