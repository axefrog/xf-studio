// The shared records of the simulation layer: the descriptor of an occurrence, the pending child, the ring entry, the typed fact of an
// event that the digests carry, the occurrence the gate sees, the cast, and the decision log (S1 2.2, 2.3, 5.4, 6, 7.2).

import type { Effect, GameTime, Id } from '../types.ts';

/** The one authoritative record of an occurrence: its identity, time and place are assigned once and never re-derived (S1 7.2). */
export interface Descriptor {
  id: Id;
  kind: string;
  size: number;
  w: number;
  time: GameTime;
  cell: Id;
  /** Affiliation-class indices, drawn once (S1 5.4). */
  sides?: { a?: number; b?: number };
  parent?: Id;
  gen: number;
  /** The ancestors, nearest first, at most `genMax`. */
  chain: Id[];
  public: boolean;
  witnesses: number;
  /**
   * The persons the occurrence inherits from its parent, by the child's role (a police response keeps the original victim and names the
   * original aggressor). They are fixed when the child is born, so firing it never needs the parent's own cast (SPEC-NOTES 111).
   */
  inherit?: Array<{ role: string; who: Id }>;
}

export interface PendingChild {
  parent: Id;
  index: number;
  due: number;
  kind: string;
  size: number;
  cell: Id;
  sides?: { a?: number; b?: number };
  modBirth: number;
  /** The parent's descriptor, so firing never needs the ring (S1 E-03). */
  parentFacts: Omit<Descriptor, 'public' | 'witnesses'>;
  /** What the child inherits of its parent's cast. */
  inherit?: Array<{ role: string; who: Id }>;
}

export interface RingEntry {
  id: Id;
  w: number;
  kind: string;
  cell: Id;
  /** An event: its descriptor. */
  event?: Omit<Descriptor, 'witnesses'>;
  /** A summary: its count. */
  count?: number;
  /** A summary: by item index. */
  meta?: Record<number, { parent?: Id; gen: number; chain: Id[]; sides?: { a?: number; b?: number }; inherit?: Array<{ role: string; who: Id }> }>;
}

/** The typed fact of one event, shared by the feeds of `city.events`, `city.mirror` and `order.norms` (S1 7.2). */
export interface EventFact {
  id: Id;
  kind: string;
  size: number;
  w: number;
  time: GameTime;
  cell: Id;
  district: Id;
  sides?: { a?: number; b?: number };
  public: boolean;
  witnesses: number;
  parent?: Id;
  parentSize?: number;
  /** The occurrence drew a police-action child (known at birth). */
  policeChild: boolean;
  creator: 'sim' | 'mirror' | 'norms';
  norm?: string;
  rung?: string;
  enforcer?: number;
}

export type CastEntry = { role: string; who: Id; group?: undefined } | { role: string; group: Id; who?: undefined };

export interface Occurrence {
  kind: string;
  /** A mirrored or replayed occurrence never reaches the gate. */
  origin: 'sim' | 'policy';
  size: number;
  window: number;
  cell?: Id;
  participants: Array<{ who: Id; role: string }>;
  effects: Array<{ on: Id; effect: Effect }>;
  creator: Id;
  tags?: string[];
}

export type GateReason = 'excluded' | 'floor-minor' | 'floor-real' | 'sex-tag' | 'v-target' | 'protected';
export type GateResult = { ok: true } | { ok: false; reason: GateReason };

export interface LogEntry {
  seq: number;
  /** The window being processed. */
  w: number;
  /** A process id or a policy name. */
  proc: string;
  kind: 'gate' | 'admission' | 'correction' | 'decision' | 'defect';
  /** The draw key, as text, for a keyed decision. */
  key?: string;
  reason: string;
  refs: Id[];
}

/** A log entry as a process writes it: the sequence number is the S1 record's to give. */
export type LogDraft = Omit<LogEntry, 'seq'>;

/** One state transition of a registered read, carried in a digest's `changes` feed (S1 2.2, 9.1). */
export interface Transition {
  key: string;
  t: GameTime;
  value: string;
  prev: string | null;
}

export interface Feed<T> {
  windows: Array<{ w: number; items: T[] }>;
}

export interface DigestBase {
  v: number;
  /** The last window the digest covers. */
  through: number;
}

/** Append a window's items to a feed, keeping the last `keep` windows. */
export function pushFeed<T>(feed: Feed<T> | undefined, w: number, items: T[], keep: number): Feed<T> {
  const windows = [...(feed?.windows ?? []), { w, items }];
  while (windows.length > keep) windows.shift();
  return { windows };
}

/** The items of the windows after a cursor, in order, and whether windows were lost to the bound (a `feed-gap`). */
export function feedAfter<T>(feed: Feed<T> | undefined, cursor: number): { items: T[]; through: number; gap: boolean } {
  if (!feed || feed.windows.length === 0) return { items: [], through: cursor, gap: false };
  const first = feed.windows[0]!.w;
  const gap = first > cursor + 1;
  const items: T[] = [];
  for (const win of feed.windows) if (win.w > cursor) items.push(...win.items);
  return { items, through: feed.windows[feed.windows.length - 1]!.w, gap };
}
