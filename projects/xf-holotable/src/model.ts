// Holotable's model: plain, versioned data. Every view (the Studio's 3D view, the in-game overlay, the agent
// report) is a projection of these types; nothing here knows how it is drawn.

export type Vec3 = [number, number, number];

/** What a layer may show: `structure` never carries names, lines or story; `full` is for analysis. */
export type ContentLevel = "structure" | "full";

/** A citation to the record an item came from, so a selection can answer "why". */
export type Cite = `recorder:${string}:${number}:${number}` | `event:${string}:${number}` | `se:${string}:${string}`;

/** One sample of V, from the recorder's `v` channel. Times are QPC source seconds. */
export interface VSample {
  t: number; seq: number;
  position: Vec3; yaw: number; speed: number;
  health: number; healthMax: number; inCombat: boolean; vehicle: boolean; busy: string;
}

/** One sample of the active camera, from the recorder's `camera` channel. */
export interface CameraSample { t: number; seq: number; position: Vec3; forward: Vec3; up: Vec3; fov: number; aspect: number }

export type EventKind =
  | "supervisor.set" | "supervisor.safe_position" | "supervisor.violation" | "supervisor.action" | "supervisor.cleared"
  | "placement.traffic" | "line" | "voice" | "face" | "contact";

/** A point event on the timeline, anchored in the world where the record gives a place. */
export interface TimelineEvent {
  id: string; kind: EventKind; t: number; seq: number;
  at?: Vec3;
  /** Words safe at the `structure` level (kinds, counts, policies). */
  summary: string;
  /** Words only shown at `full` (dialogue text, speaker names). */
  detail?: string;
  level: ContentLevel;
  cite: Cite;
}

/** A stretch with no samples (a missed deadline, a drop, a sequence jump): absence is never proof. */
export interface Gap { from: number; to: number; reason: "sequence" | "time" | "invalid" | "missing"; fromSeq: number; toSeq: number }

export interface SessionMeta {
  schema: "xfh/session-1";
  session: string; run: number; worldGeneration: number; pluginVersion: string;
  start: number; end: number; channels: string[];
  /** The sampled span: V's first and last samples. The recorder arms before its first sample, so replay covers this, not start–end. */
  from: number; to: number;
  complete: boolean; dropped: number; missedDeadlines: number; largestGapS: number;
  /** What the recording cannot prove, from its own manifest. */
  coverage: string;
  /** Damage found while reading (a chunk the manifest lists is missing, an unfinished last row): the run is then not complete. */
  problems: string[];
}

export interface Session {
  meta: SessionMeta;
  v: VSample[];
  camera: CameraSample[];
  events: TimelineEvent[];
  gaps: Gap[];
}

/** A district or venue outline with its vertical band, from offline game data. */
export interface Area { id: string; name: string; kind: "district" | "venue"; parent?: string; poly: [number, number][]; zlo: number; zhi: number }

/** A streaming sector's box, a coarse "what the game streams here" cell. */
export interface Cell { level: number; category: string; min: Vec3; max: Vec3 }

export interface WorldPack {
  schema: "xfh/world-pack-1";
  /** Which game data it was built from: offline geometry is an estimate of the live world. */
  provenance: { game: string; source: string; built: string };
  areas: Area[];
  cells: Cell[];
}

/** The model evaluated at one moment: what every projection draws from. */
export interface Snapshot {
  t: number;
  level: ContentLevel;
  v?: VSample & { stale: boolean };
  camera?: CameraSample & { stale: boolean };
  /** The trail up to t, split at gaps so no projection draws through missing samples. */
  trail: Vec3[][];
  /** Events that happened up to t that carry a place, newest last. */
  placed: TimelineEvent[];
  /** Events in the last few seconds, for "now" emphasis. */
  recent: TimelineEvent[];
  inGap: boolean;
  district?: string;
}
