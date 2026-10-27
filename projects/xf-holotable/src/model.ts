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
  gameTime?: number;
  position: Vec3; yaw: number; speed: number;
  health: number; healthMax: number; inCombat: boolean; vehicle: boolean; busy: string;
}

/** One sample of the active camera, from the recorder's `camera` channel. */
export interface CameraSample { t: number; seq: number; position: Vec3; forward: Vec3; up: Vec3; fov: number; aspect: number }

/** Actual actor-channel fields; absent source fields stay absent. Invalid observations are retained, never placed. */
export interface ActorSample {
  t: number; who: string; valid: boolean; entity?: string; position?: Vec3;
  yaw?: number; command_state?: string; prepared?: boolean;
}

/** Native incidents channel payload, without a free-JSON escape hatch. `event` discriminates
 * witness.report, witness.gap, witness.unwitnessed and incident.coverage. `kind` is the
 * report's native classification (absent on coverage/unwitnessed); declared.kind is the
 * engine's declared classification. Coverage.declared is a numeric count instead. Place is place.position, or declared.at when present.
 * TimelineEvent.kind is always "incident"; TimelineEvent.at and cite remain structural.
 * The whole incident field is full content and is absent in structure responses. */
export type Incident = IncidentReport | IncidentCoverage;
export interface IncidentReport {
  event: "witness.report" | "witness.gap" | "witness.unwitnessed";
  kind?: string; schema?: string; incident?: string; world?: number;
  state?: "open" | "closed"; v_involved?: boolean;
  participants?: { entity: string; record?: string; affiliation?: string | null; roles: string[]; is_v: boolean; crowd: boolean; nearest_m: number | null; who?: string; position?: Vec3 }[];
  participants_dropped?: number;
  place?: { position: Vec3; first: Vec3; last: Vec3; district_v: string };
  declared?: { id: string; kind: string; roles: Record<string, string>; at: Vec3; ttl_s: number };
  when?: { start_sim_s: number; end_sim_s: number; duration_s: number; start_game_s?: number | null; end_game_s?: number | null };
  perceived?: { witnessed: boolean; modes: string[];
    saw: { n: number; first_sim_s: number; nearest_m: number; via: string } | null;
    heard: { n: number; first_sim_s: number; nearest_m: number; radius_m: number } | null;
    told: { supported: boolean; note: string }; sight?: IncidentSight };
  confidence?: number; evidence?: Record<string, number>; evidence_score?: number; observations?: number;
  closed?: string | null; reported?: boolean; report_pending?: boolean; report_gap?: boolean;
  continues?: string | null; merged?: string[]; passive?: boolean; truncated?: boolean; delayed?: boolean;
  reason?: string; closed_by?: string; modes?: string[]; queue_limit?: number; note?: string; sight?: IncidentSight;
}
export interface IncidentCoverage {
  event: "incident.coverage"; kind?: never; declared?: number;
  valid?: boolean; passive?: boolean; open?: number; kept_closed?: number; observed?: number; accepted?: number;
  dropped_rate?: number; dropped_invalid?: number; reports?: number; reports_queued?: number;
  reports_delayed?: number; pending_reports?: number; report_gaps?: number; tap_admitted?: number;
  tap_dropped_cap?: number; tap_dropped_weak?: number; tap_dropped_repeat?: number; evicted_open?: number;
  declared_open?: number; declared_unwitnessed?: number; sight_samples?: number; sight_dropped_rate?: number;
  told_supported?: boolean;
}
export interface IncidentSight { samples: number; in_range: number; in_view: number; blocked: number; unchecked: number; view_unavailable: number; actors_missing: number }
/** Counts source rows, not output items. read = kept + dropped. reasons partitions dropped.
 * Counts cover rows actually read; absent chunks/transport loss remain meta.problems/gaps/dropped. */
export interface ChannelCoverage { name: string; read: number; kept: number; dropped: number; reasons: Record<string, number> }

export type EventKind =
  | "supervisor.set" | "supervisor.safe_position" | "supervisor.violation" | "supervisor.action" | "supervisor.cleared"
  | "placement.traffic" | "line" | "voice" | "face" | "contact" | "session" | "incident";

/** A point event on the timeline, anchored in the world where the record gives a place. */
export interface TimelineEvent {
  id: string; kind: EventKind; t: number; seq: number;
  at?: Vec3;
  /** Words safe at the `structure` level (kinds, counts, policies). */
  summary: string;
  /** Words only shown at `full` (dialogue text, speaker names). */
  detail?: string;
  /** Full incident payload, removed at the structure boundary. */
  incident?: Incident;
  level: ContentLevel;
  cite: Cite;
}

/** A stretch with no samples (a missed deadline, a drop, a sequence jump): absence is never proof. */
export interface Gap {
  from: number; to: number; reason: "sequence" | "time" | "invalid" | "missing"; fromSeq: number; toSeq: number;
  /** Absent means shared recorder loss; actor-only breaks must not invalidate V.
   * An invalid actor point revokes older positions until the person is reobserved. */
  channel?: "actors";
}

export interface SessionMeta {
  schema: "xfh/session-1";
  session: string; run: number; worldGeneration: number; pluginVersion: string;
  start: number; end: number; channels: ChannelCoverage[];
  /** ISO wall-clock reference at start, when the source supplies a mapping. */
  wallStart?: string;
  gameTimeSamples?: { source: number; game: number }[];
  standalone?: { set: string; title: string; clock: "wall" | "game" | "recording"; branches: string[]; extent?: { min: Vec3; max: Vec3 } };
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
  actors?: ActorSample[];
}

/** A district or venue outline with its vertical band, from offline game data. */
export interface Area { id: string; name: string; kind: "district" | "venue"; parent?: string; poly: [number, number][]; zlo: number; zhi: number; labelPoint?: Vec3 }

/** A streaming sector's box, a coarse "what the game streams here" cell. */
export interface Cell { id?: string; name?: string; labelPoint?: Vec3; level: number; category: string; min: Vec3; max: Vec3 }

/** A primitive in world metres. Axes retain the full actor-scale × local-pose transform, including nonuniform scales. */
export interface Solid {
  id: string; kind: "box" | "sphere" | "capsule";
  center: Vec3; axes: [Vec3, Vec3, Vec3];
  /** Box half extents; sphere radius in x; capsule radius in x, cylinder length in y (local Z axis). */
  size: Vec3;
}
export interface SolidRegion {
  solids: Solid[];
  solidInfo: {
    source: "vanilla"; readerVersion: number; available: boolean;
    sectors: number; counts: ShapeCounts; rawCounts: ShapeCounts; levels: Record<string, { sectors: number; counts: ShapeCounts }>;
    overlap: { shapes: number; crossLevelShapes: number; actors: number; completeActors: number; pairs: Record<string, number>;
      examples: { kept: string; removed: string; keptLevel: number; removedLevel: number; kind: string }[] };
    omittedMeshShapes: number; cut: number; cap: number;
    /** An offline default-variant estimate, never a claim about recorded live state. */
    variants: "defaults";
  };
}
export interface ShapeCounts { box: number; sphere: number; capsule: number; convexMesh: number; triangleMesh: number }

export interface WorldPack {
  schema: "xfh/world-pack-1";
  /** Which game data it was built from: offline geometry is an estimate of the live world. */
  provenance: { game: string; source: string; built: string };
  areas: Area[];
  cells: Cell[];
  solids?: Solid[];
  solidInfo?: SolidRegion["solidInfo"];
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
