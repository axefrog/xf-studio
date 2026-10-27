/**
 * What the Holotable module reads, in its own terms (the feature rule: a module's core imports only its folder and `platform/api`).
 * Structural subsets of the headless service's answers (projects/xf-holotable/src/model.ts, protocol `xfh/service-1`), which the host
 * passes through unchanged.
 */
export type Vec3 = readonly [number, number, number];
export type ContentLevel = "structure" | "full";

export interface HoloRun { readonly session: string; readonly run: number; readonly dir: string; readonly start: number; readonly end: number; readonly bytes: number; readonly complete: boolean; readonly title?: string; readonly standalone?: boolean; readonly clock?: string }

export interface HoloVSample {
  readonly t: number; readonly seq: number; readonly position: Vec3; readonly yaw: number; readonly speed: number;
  readonly health: number; readonly healthMax: number; readonly inCombat: boolean; readonly vehicle: boolean; readonly busy: string;
}
export interface HoloCameraSample { readonly t: number; readonly seq: number; readonly position: Vec3; readonly forward: Vec3; readonly up: Vec3; readonly fov: number; readonly aspect: number }
export interface HoloActorSample {
  readonly t: number; readonly who: string; readonly valid: boolean; readonly entity?: string; readonly position?: Vec3;
  readonly yaw?: number; readonly command_state?: string; readonly prepared?: boolean;
}
export interface HoloEvent {
  readonly id: string; readonly kind: string; readonly t: number; readonly seq: number; readonly at?: Vec3;
  readonly incident?: { readonly event: string; readonly kind?: string }; readonly summary: string; readonly detail?: string; readonly level: ContentLevel; readonly cite: string;
}
export interface HoloGap { readonly from: number; readonly to: number; readonly reason: "sequence" | "time" | "invalid" | "missing"; readonly channel?: "actors" }
export interface HoloSession {
  readonly meta: {
    readonly session: string; readonly run: number; readonly start: number; readonly end: number; readonly channels: readonly (string | { readonly name: string; readonly read: number; readonly kept: number; readonly dropped: number; readonly reasons: Readonly<Record<string, number>> })[];
    /** The sampled span (V's first and last samples): what replay covers. */
    readonly from: number; readonly to: number;
    readonly complete: boolean; readonly dropped: number; readonly missedDeadlines: number; readonly largestGapS: number; readonly coverage: string;
    /** Damage found while reading (missing chunks, an unfinished last row). */
    readonly problems: readonly string[];
    readonly standalone?: { readonly set: string; readonly title: string; readonly clock: "wall" | "game" | "recording"; readonly branches: readonly string[]; readonly extent?: { readonly min: Vec3; readonly max: Vec3 } };
  };
  readonly actors?: readonly HoloActorSample[];
  readonly v: readonly HoloVSample[];
  readonly camera: readonly HoloCameraSample[];
  readonly events: readonly HoloEvent[];
  readonly gaps: readonly HoloGap[];
}
export interface HoloArea { readonly id: string; readonly name: string; readonly kind: "district" | "venue"; readonly poly: readonly (readonly [number, number])[]; readonly zlo: number; readonly zhi: number }
export interface HoloCell { readonly level: number; readonly category: string; readonly min: Vec3; readonly max: Vec3 }
export interface HoloSolid {
  readonly id: string; readonly kind: "box" | "sphere" | "capsule"; readonly center: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3]; readonly size: Vec3;
}
export interface HoloPoi { readonly id: string; readonly place: string; readonly at: Vec3; readonly kind: string; readonly variant?: string; readonly record?: string; readonly journal?: string }
export interface HoloSpot { readonly id: string; readonly place: string; readonly at: Vec3; readonly yaw: number; readonly workspot?: { readonly path: string; readonly activity?: string; readonly tags: readonly string[] }; readonly communities: readonly string[] }
export interface HoloCommunity { readonly id: string; readonly place: string; readonly name?: string; readonly entries: readonly { readonly name: string; readonly record?: string; readonly phases: readonly { readonly name: string; readonly spots: readonly string[] }[] }[] }
export interface HoloContent { readonly available: boolean; readonly slices: readonly string[]; readonly pois: readonly HoloPoi[]; readonly spots: readonly HoloSpot[]; readonly communities: readonly HoloCommunity[] }
export interface HoloWorld {
  readonly content?: HoloContent;
  readonly extent?: { readonly min: Vec3; readonly max: Vec3 };
  readonly provenance: { readonly game: string; readonly source: string } | null; readonly areas: readonly HoloArea[]; readonly cells: readonly HoloCell[];
  readonly solids?: readonly HoloSolid[];
  readonly solidInfo?: { readonly available: boolean; readonly omittedMeshShapes: number; readonly cut: number; readonly cap: number };
}

/** The host's Holotable endpoint: one service method per request. */
export type HoloTransport = (method: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<{ ok: boolean; status: number; data: unknown }>;

export interface HoloLiveState {
  readonly available: boolean; readonly recording: boolean; readonly watching: boolean; readonly following: boolean;
  readonly phase: "idle" | "watching" | "waiting" | "disconnected" | "ended";
  readonly behindS: number; readonly more: boolean; readonly droppedBatches: number; readonly message: string;
}
export interface HoloLiveCursor { readonly epoch: number; readonly actors?: number; readonly v: number; readonly camera: number; readonly events: number; readonly gaps: number }
export interface HoloLiveUpdate {
  readonly since: HoloLiveCursor; readonly reset: boolean; readonly more: boolean; readonly state: Omit<HoloLiveState, "following">;
  readonly meta: HoloSession["meta"] | null;
  readonly actors?: HoloSession["actors"]; readonly v: HoloSession["v"]; readonly camera: HoloSession["camera"]; readonly events: HoloSession["events"]; readonly gaps: HoloSession["gaps"];
}
