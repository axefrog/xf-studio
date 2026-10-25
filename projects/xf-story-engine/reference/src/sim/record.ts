// The S1 record (S1 2.2, 2.3): event-driven state that has no schedule of its own lives in one `SeedRecord` under `s1`, with `actor`
// unset (S0 14.1, V4-46). It holds the absorbed origins and the dirty list of the reputation ledger, the divergence log, the soft
// exclusions of a retract, and the decision log. A policy updates it at relevance-dispatch time; a process's log entries reach it
// through the kernel's `record` operation. It is saved with the other states and restored on load.
//
// It also holds the history that a save would otherwise lose and that a regenerated occurrence reads: the spans of protection (SIM-04),
// the facts of the events behind memorable beliefs (SIM-03) and the intervals of materialised ties (SIM-07, SIM-11). Each is written
// when the game is saved (`Sim.flush`), from what the kernel holds at that moment.

import type { Effect, GameTime, Id } from '../types.ts';
import type { EventProvenance } from '../events.ts';
import type { LogDraft, LogEntry } from './occ.ts';

export interface S1Record {
  v: 1;
  /** By "carrier|subject|axis": the canonical evidence already counted and its ledger index (-1 once evicted); at most 64. */
  absorbed: Record<string, Array<{ origin: Id; index: number }>>;
  /** Standings to re-evaluate at the next ledger run. */
  dirty: Array<{ carrier: Id; subject: Id; axis: string; seq: number }>;
  /** By "believer|subject": transitions of the `divergence` read, at most 8. */
  divLog: Record<string, Array<{ t: GameTime; value: 'none' | 'small' | 'large'; ord: number }>>;
  /** The next ordinal across process publications, divergence and tie validity changes (S2 4.2). */
  ord: number;
  /** Tie validity boundaries, retained as long as their intervals (and the coverage floor) are answerable. */
  tieLog: Record<Id, Array<{ t: GameTime; value: 'yes' | 'no'; ord: number }>>;
  /** By "believer|subject": the time before which the retained transitions say nothing, once the oldest has been dropped (SIM-08). */
  divFloor: Record<string, GameTime>;
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
  /** Materialised ties: the history and the counts of each (S1 4.7), by tie edge Id. */
  tieHistory: Record<Id, TieRecord>;
  /**
   * The spans in which a node was protected by a cast, an observation or a quest link, as their union in order. The kernel drops an ended
   * edge and an old reading when it saves; an occurrence that regenerates reads the protected set as of its own time, so the spans are kept
   * for as long as an occurrence can regenerate (SIM-04).
   */
  protect: Record<Id, Span[]>;
  /**
   * The facts of the events behind memorable beliefs, by the event's Id: what a load would leave as a bare header. They are put back
   * silently when a save is loaded (SIM-03).
   */
  evidence: Record<Id, EvidenceFacts>;
  /** v0.6 (S1 8.9): what groups came to believe of V's acts, in order, for `group.decide` to read after its cursor; at most 256. */
  grudges: GrudgeEntry[];
  grudgeSeq: number;
  /** v0.6 (S1 8.10): the role goals seeds gave people, in order, for `people.goals` to read after its cursor; at most 256. */
  roleGoals: RoleGoalEntry[];
  roleGoalSeq: number;
}

/** A grievance of a group against V (S1 8.9): set from an act of V's, or cleared or settled. */
export interface GrudgeEntry {
  seq: number;
  group: Id;
  belief: Id;
  act: Id;
  sev: number;
  op: 'set' | 'cleared' | 'settled';
  /** The act's time for a set entry, the time the record changed for the others. */
  at: GameTime;
  /** Whether the act was public (a hazard input, S1 7.8.1). */
  pub?: boolean;
  /** For a grievance told to a member of the group (S1 8.9 rule 2): who told, and the belief that grounds it, so rule 3 can clear it. */
  via?: { teller: Id; belief: Id };
}

/** A goal a seed's role frame gave a cast person (S1 8.10). */
export interface RoleGoalEntry {
  seq: number;
  frame: Id;
  owner: Id;
  seed: Id;
  effects: Array<{ on: unknown; effect: string }>;
  weight: number;
  op: 'open' | 'end';
  at: GameTime;
}

/** A stretch of game time, from `from` to `to` (open when `to` is absent). */
export interface Span {
  from: GameTime;
  to?: GameTime;
}

/** An event as it was minted: enough to mint it again under its own Id. */
export interface EvidenceFacts {
  provenance?: EventProvenance;
  creator: Id;
  cause: Id;
  name: string;
  time: GameTime;
  kind: string;
  place?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  witnesses: Id[];
  causes: Id[];
  outcome?: 'done' | 'failed' | 'prevented';
  served?: Id;
}

export interface TieRecord {
  /** At most 32, newest last. */
  entries: Array<{ event: Id; salience: number; reason: string; kind: string; at: GameTime }>;
  hours: number;
  disclosures: number;
  favours: number;
  /** The last loss of each trust component, for a repair to restore. */
  lastLoss: { trustA: number; trustB: number; trustI: number };
  /** The intervals in which the tie was materialised and then ended, oldest first; the live (or last) interval is the edge's (SIM-07). */
  spans?: Array<{ from: GameTime; to: GameTime }>;
  /** Once the oldest intervals were dropped: the end of the newest one dropped. Before it, a time no kept interval covers is not known (R2-09). */
  spanFloor?: GameTime;
}

export function emptyRecord(): S1Record {
  return { v: 1, absorbed: {}, dirty: [], divLog: {}, ord: 0, tieLog: {}, divFloor: {}, softExcluded: [], log: [], seq: 0, dirtySeq: 0, tells: [], tieHistory: {}, protect: {}, evidence: {}, grudges: [], grudgeSeq: 0, roleGoals: [], roleGoalSeq: 0 };
}

/** A record as a save holds it, with every field a newer version added filled in. */
export function recordFrom(saved: unknown): S1Record {
  return { ...emptyRecord(), ...(structuredClone(saved) as Partial<S1Record>) };
}

/** Append a log entry to the record, keeping the ring bounded (S1 2.3). */
export function appendLog(rec: S1Record, draft: LogDraft, max: number): void {
  rec.log.push({ ...draft, seq: rec.seq++ });
  while (rec.log.length > max) rec.log.shift();
}
