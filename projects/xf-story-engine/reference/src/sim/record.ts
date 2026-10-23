// The S1 record (S1 2.2, 2.3): event-driven state that has no schedule of its own lives in one `SeedRecord` under `s1`, with `actor`
// unset (S0 14.1, V4-46). It holds the absorbed origins and the dirty list of the reputation ledger, the divergence log, the soft
// exclusions of a retract, and the decision log. A policy updates it at relevance-dispatch time; a process's log entries reach it
// through the kernel's `record` operation. It is saved with the other states and restored on load.

import type { GameTime, Id } from '../types.ts';
import type { LogDraft, LogEntry } from './occ.ts';

export interface S1Record {
  v: 1;
  /** By "carrier|subject|axis": the canonical evidence already counted and its ledger index (-1 once evicted); at most 64. */
  absorbed: Record<string, Array<{ origin: Id; index: number }>>;
  /** Standings to re-evaluate at the next ledger run. */
  dirty: Array<{ carrier: Id; subject: Id; axis: string; seq: number }>;
  /** By "believer|subject": transitions of the `divergence` read, at most 8. */
  divLog: Record<string, Array<{ t: GameTime; value: 'none' | 'small' | 'large' }>>;
  /** Tie threads a retract has switched off. */
  softExcluded: Id[];
  /** A ring of at most `data.log.max` entries, oldest first. */
  log: LogEntry[];
  /** The next log sequence number. */
  seq: number;
  /** The next dirty sequence number. */
  dirtySeq: number;
  /** Tell volume: the windows of social events minted outside focus, for the hourly cap. */
  tells: number[];
  /** Materialised ties: the history of each (S1 4.7), by tie edge Id. */
  tieHistory: Record<Id, Array<{ event: Id; salience: number; reason: string; kind: string; at: GameTime }>>;
}

export function emptyRecord(): S1Record {
  return { v: 1, absorbed: {}, dirty: [], divLog: {}, softExcluded: [], log: [], seq: 0, dirtySeq: 0, tells: [], tieHistory: {} };
}

/** Append a log entry to the record, keeping the ring bounded (S1 2.3). */
export function appendLog(rec: S1Record, draft: LogDraft, max: number): void {
  rec.log.push({ ...draft, seq: rec.seq++ });
  while (rec.log.length > max) rec.log.shift();
}
