import type { WorkspaceSaveStatus } from "./workspace-persistence";

/**
 * Read-only device facts a presentation needs to be truthful about the preview:
 * browser draft autosave, optional asset availability/provenance and per-layer
 * preview measurements. The composition root fills it from trusted adapters; a
 * view can only read detached copies. Nothing here changes recipes, SQLite or export.
 */
export type PreviewAssetStatus = {
  /** Head scene and its optional details have finished loading (or failed). */
  loaded: boolean;
  detailErrors: string[];
  browMaterial?: "saved-double-diffuse" | "provisional";
  lashColor?: "saved-hair-profile" | "provisional";
  /** Which installed hair-profile provider the lash colour uses (explicit, from the local manifest). */
  lashProfileLabel?: string;
  hairError?: string;
  piercingError?: string;
  prcError?: string;
  prcAvailable: boolean;
  eyeOptics?: { requested: boolean; active: boolean; reason: string; error?: string };
};
export type GlitterPreviewMeasurement = {
  layerId: string; size: number; maskCentres: number; regionRetained: number;
  coveredPixels: number; dense: boolean;
  /** False when the layer or preview tier changed after this measurement. */
  current: boolean;
};
/** Latest human-readable message from an editor or preview adapter (limits, rejected insertions, timings). */
export type AdapterMessage = { id: number; source: "uv" | "surface" | "preview"; text: string };
export type PresentationStatus = {
  verification: boolean;
  workspace: WorkspaceSaveStatus;
  assets: PreviewAssetStatus;
  glitter: GlitterPreviewMeasurement[];
  message?: AdapterMessage;
};

export function emptyPresentationStatus(verification = false): PresentationStatus {
  return { verification, workspace: { kind: "idle", message: "" },
    assets: { loaded: false, detailErrors: [], prcAvailable: false }, glitter: [] };
}

/** Observable detached status; the trusted composition root calls `changed()`. */
export class PresentationStatusSource {
  private listeners = new Set<() => void>();
  constructor(private read: () => PresentationStatus) {}
  snapshot(): PresentationStatus { return structuredClone(this.read()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  changed() { for (const listener of this.listeners) listener(); }
}
