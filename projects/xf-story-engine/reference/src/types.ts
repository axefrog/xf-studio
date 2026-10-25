// Shared plain types for the Story Engine kernel reference model (spec S0 v3).
// Everything here is plain data: no classes, no behaviour.

/** 128 bits written as 32 lowercase hexadecimal characters (spec 1.1). */
export type Id = string;

/** Signed count of game seconds since the lineage epoch (spec 9.1). A JS number holds it exactly up to 2^53. */
export type GameTime = number;

export type DimId = string;
export type KindId = string;
export type EdgeTypeId = string;
export type DriveId = string;

/** "key", "key[i]", "key#count" (spec 3.1). */
export type SlotPath = string;
/** A slot path, plus "@w<k>" for simulated temporal slots (spec 3.1). */
export type SlotKey = string;

/**
 * A value in memory. The representation depends on the dimension's value type:
 * - enum, enum-by, text: the string;
 * - int: the integer;
 * - real, cyclic: the grid point itself (min + i * quantum, or i * quantum); the canonical encoding uses the grid index;
 * - vec: an array of grid points (multiples of the quantum);
 * - ref, node: the Id.
 */
export type Value = string | number | number[];

/** Regions (spec 3.2). Intervals and boxes are closed and snapped to the grid. */
export type Region =
  | { r: 'all' }
  | { r: 'set'; values: string[] }
  | { r: 'ivl'; ivls: Array<[number, number]> }
  | { r: 'box'; boxes: Array<Array<[number, number]>> };

export type Layer = 'observation' | 'game' | 'authored' | 'seeding' | 'simulation' | 'procedural';

export type PinReason = 'observed' | 'game' | 'authored' | 'committed';

export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

export type ResolveStatus = 'ok' | 'contradiction' | 'unavailable' | 'failed' | 'cycle';

export interface ResolveResult {
  value?: Value;
  status: ResolveStatus;
}

export interface FnRef {
  name: string;
  version: number;
  params?: Record<string, unknown>;
}

export type Effect =
  | 'harm' | 'kill' | 'help' | 'protect' | 'rescue' | 'take' | 'give' | 'expose' | 'conceal' | 'move' | 'meet';

export const EFFECTS: readonly Effect[] = [
  'harm', 'kill', 'help', 'protect', 'rescue', 'take', 'give', 'expose', 'conceal', 'move', 'meet',
];

export interface SpatialRegionSphere { center: number[]; radius: number }
export interface SpatialRegionBox { min: number[]; max: number[] }
export type SpatialRegion = SpatialRegionSphere | SpatialRegionBox;

export type QueryScope =
  | { under: Id }
  | { nodes: Id[] }
  | { region: SpatialRegion }
  | { roots: Id[] };

export interface Predicate {
  /**
   * Slot path from the candidate node. Segments are separated by "/". A segment is a slot path
   * ("key", "key[i]", "key#count"), "^" for the owner, or one of the special forms:
   * "" or "." (the node itself), "@role", "@effect", "@edge", "@self".
   * A final segment may end in ":bucket" to test the dimension's bucket keys.
   */
  path: string;
  op: 'in' | 'not-in' | 'range' | 'eq' | 'field-at-least' | 'field-at-most' | 'has-edge' | 'lacks-edge';
  arg: Value | Value[] | Region | { edge: EdgeTypeId; to?: Id | Selector };
}

export interface Selector {
  kind?: KindId;
  slot: SlotPath | '*';
  scope?: { under: Id } | { nodes: Id[] } | { region: SpatialRegion };
  where?: Predicate[];
}

export type Form =
  | { f: 'const'; value: Value }
  | { f: 'set'; region: Region; allow: boolean }
  | { f: 'table'; weights: Record<string, number> }
  | {
      f: 'field';
      base: SlotPath;
      points: Array<{ at: number[]; value: number; radius: number; falloff: 'linear' | 'smoothstep' | 'bump' }>;
      combine: 'sum' | 'max';
      map: FnRef;
    }
  | { f: 'rule'; when: Predicate[]; then: Form }
  | { f: 'derive'; fn: FnRef; inputs: SlotPath[] };

export interface Contribution {
  id: Id;
  source: { layer: Layer; origin: Id | string };
  target: Selector;
  form: Form;
  mode: 'constrain' | 'weight' | 'replace-prior';
  strength: number;
  valid: { from?: GameTime; to?: GameTime };
}

export interface Pin {
  id: Id;
  node: Id;
  slot: SlotPath;
  value?: Value;
  region?: Region;
  reason: PinReason;
  valid: { from: GameTime; to?: GameTime };
  at: GameTime;
  cause: Id;
  evidence?: Id;
}

export interface Edge {
  id: Id;
  type: EdgeTypeId;
  from: Id;
  to: Id;
  attrs: Record<string, Value>;
  data?: Record<string, unknown>;
  valid: { from: GameTime; to?: GameTime };
  cause: Id;
}

export type NodeOrigin =
  | { by: 'root'; name: string }
  | { by: 'value'; owner: Id; slot: string }
  | { by: 'member'; owner: Id; slot: string; index: number }
  | { by: 'minted'; creator: Id; cause: Id; name: string }
  | { by: 'mirrored'; gameKey: string };

export interface NodeHeader {
  id: Id;
  kind: KindId;
  origin: NodeOrigin;
}

export type SlotState =
  | { s: 'open' }
  | { s: 'resolved'; value?: Value; status: ResolveStatus; revision: number; at: GameTime };

export interface Node extends NodeHeader {
  slots: Map<SlotKey, SlotState>;
  touched: GameTime;
}

export const PRECEDENCE = {
  structural: 700,
  observation: 600,
  game: 500,
  authored: 400,
  seeding: 300,
  simulation: 200,
  procedural: 100,
} as const;

export const PIN_PRECEDENCE: Record<PinReason, number> = {
  observed: 600,
  game: 500,
  authored: 400,
  committed: 300,
};

/** A constraint at or above this precedence, when rejected, makes the status `contradiction` (spec 5.2). */
export const CONTRADICTION_PRECEDENCE = 600;

// ---- queries (spec 8.1) ----

export interface Query {
  find: KindId;
  scope: QueryScope;
  at: GameTime;
  must: Predicate[];
  prefer?: Array<{ p: Predicate; weight: number }>;
  limit: number | 'all';
}

export interface QueryItem {
  id: Id;
  score: number;
}

export type QueryOutcome =
  | { status: 'ok'; items: QueryItem[] }
  | { status: 'failed'; reason: string };

// ---- changes (spec 10.5) ----

export type Change =
  | { c: 'pin'; node: Id; slot: SlotPath; old?: Value | Region; new: Value | Region; reason: string; at?: GameTime }
  | { c: 'edge'; edge: Edge; ended: boolean }
  | {
      c: 'event'; event: Id; kind: string; place?: Id;
      participants: Array<{ who: Id; role: string }>; effects: Array<{ on: Id; effect: Effect }>;
      /** v4.17 (V4-51), under `eventChangeFields`: what the event was minted with, so a reader can apply an outcome-conditioned fill from the change alone. */
      outcome?: 'done' | 'failed' | 'prevented'; served?: Id; data?: Record<string, Value>;
    }
  | { c: 'minted'; node: Id; kind: KindId }
  | { c: 'contribution'; contribution: Contribution; ended: boolean }
  | { c: 'reading'; node: Id; slot: SlotPath; old?: Value; new: Value; at?: GameTime }
  /** A frame's status changed (v4, V4-4). Weight and parent changes produce none. */
  | { c: 'frame'; frame: Id; actor: Id; level: string; focus: Id[]; old: string; new: string }
  /** A memorable belief set, revised or dropped (v4.17, V4-52, under `beliefChanges`). `evidence` is the belief's originating events. */
  | {
      c: 'belief'; belief: Id; believer: Id; subject: Id; path: SlotPath; at?: GameTime;
      op: 'set' | 'revised' | 'dropped'; by: 'observed' | 'told' | 'inferred'; evidence: Id[];
    };

/** A change as queued: stamped with the time it was made, the revision it produced, and the epoch it was made in. */
export interface PendingChange {
  change: Change;
  time: GameTime;
  revision: number;
  epoch: Id;
}
