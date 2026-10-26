/**
 * What the Holotable module reads, in its own terms (the feature rule: a module's core imports only its folder and `platform/api`).
 * Structural subsets of the headless service's answers (projects/xf-holotable/src/model.ts, protocol `xfh/service-1`), which the host
 * passes through unchanged.
 */
export type Vec3 = readonly [number, number, number];
export type ContentLevel = "structure" | "full";

export interface HoloRun { readonly session: string; readonly run: number; readonly dir: string; readonly start: number; readonly end: number; readonly bytes: number; readonly complete: boolean }

export interface HoloVSample {
  readonly t: number; readonly seq: number; readonly position: Vec3; readonly yaw: number; readonly speed: number;
  readonly health: number; readonly healthMax: number; readonly inCombat: boolean; readonly vehicle: boolean; readonly busy: string;
}
export interface HoloCameraSample { readonly t: number; readonly seq: number; readonly position: Vec3; readonly forward: Vec3; readonly up: Vec3; readonly fov: number; readonly aspect: number }
export interface HoloEvent {
  readonly id: string; readonly kind: string; readonly t: number; readonly seq: number; readonly at?: Vec3;
  readonly summary: string; readonly detail?: string; readonly level: ContentLevel; readonly cite: string;
}
export interface HoloGap { readonly from: number; readonly to: number; readonly reason: "sequence" | "time" }
export interface HoloSession {
  readonly meta: {
    readonly session: string; readonly run: number; readonly start: number; readonly end: number; readonly channels: readonly string[];
    /** The sampled span (V's first and last samples): what replay covers. */
    readonly from: number; readonly to: number;
    readonly complete: boolean; readonly dropped: number; readonly missedDeadlines: number; readonly largestGapS: number; readonly coverage: string;
  };
  readonly v: readonly HoloVSample[];
  readonly camera: readonly HoloCameraSample[];
  readonly events: readonly HoloEvent[];
  readonly gaps: readonly HoloGap[];
}
export interface HoloArea { readonly id: string; readonly name: string; readonly kind: "district" | "venue"; readonly poly: readonly (readonly [number, number])[]; readonly zlo: number; readonly zhi: number }
export interface HoloCell { readonly level: number; readonly category: string; readonly min: Vec3; readonly max: Vec3 }
export interface HoloWorld { readonly provenance: { readonly game: string; readonly source: string } | null; readonly areas: readonly HoloArea[]; readonly cells: readonly HoloCell[] }

/** The host's Holotable endpoint: one service method per request. */
export type HoloTransport = (method: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<{ ok: boolean; status: number; data: unknown }>;
