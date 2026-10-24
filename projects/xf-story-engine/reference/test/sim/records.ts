// The canonical records the end-to-end fixtures compare (S1 14.2): the state a save would hold, section by section, and the S1 record.

import { canonicalKey } from '../../src/canon.ts';
import type { Sim } from '../../src/sim/sim.ts';

export type Sections = Record<string, string>;

/**
 * The canonical encoding of everything a save of this sim would hold, one entry per section: headers, pins, edges, contributions,
 * memorable beliefs, canon, summaries, frames, seeds (which hold the S1 record), settings, and each process's state, digest and
 * outstanding batch. Two sims whose futures are the same have the same sections.
 */
export function recordOf(sim: Sim, skip: { processes?: string[]; logProcs?: string[] } = {}): Sections {
  sim.flush();
  const data = sim.k.persistence.currentView().toData();
  const out: Sections = {};
  for (const key of ['headers', 'pins', 'edges', 'contributions', 'beliefs', 'canon', 'summaries', 'frames', 'seeds', 'settings'] as const) {
    out[key] = canonicalKey(data[key] ?? []);
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

