import type { WorkspaceLeaseSnapshot } from "./workspace/workspace-lease";
import type { OutboxStatus } from "../platform/core/document-outbox";
import type { CharacterDetailStatus } from "../character/character-detail-actions";
import type { WorkspaceSaveStatus } from "./workspace/workspace-persistence";
import type { EditorSlot } from "./viewport-adapter";

/**
 * Read-only device facts a presentation needs to be truthful about the preview:
 * browser draft autosave, optional asset availability/provenance and per-layer
 * preview measurements. The composition root fills it from trusted adapters; a
 * view can only read detached copies. Nothing here changes recipes, SQLite or export.
 */
export type PreviewAssetStatus = {
  /** Head scene and its optional details have finished loading (or failed). */
  loaded: boolean;
  /** Skin, face details, eyes, brows, lashes, hair, piercings and body resolved from the player's own installation for the shown V. */
  characterDetails?: CharacterDetailStatus;
  eyeOptics?: { requested: boolean; active: boolean; reason: string; error?: string };
};
export type GlitterPreviewMeasurement = {
  layerId: string; size: number; maskCentres: number; regionRetained: number;
  coveredPixels: number; dense: boolean;
  /** False when the layer or preview tier changed after this measurement. */
  current: boolean;
};
/**
 * Latest human-readable message from an editor or preview adapter (limits, rejected insertions, timings): `source` is the editor's
 * slot (`uv`, the flat editor; `surface`, the main view's on-head editor), `preview`, or an own-default preservation notice.
 */
export type AdapterMessage = { id: number; source: EditorSlot | "preview" | "layout-default"; text: string };
export type PresentationStatus = {
  verification: boolean;
  workspace: WorkspaceSaveStatus;
  assets: PreviewAssetStatus;
  glitter: GlitterPreviewMeasurement[];
  message?: AdapterMessage;
  /** Whether this page holds its workspace (profiles design §2.3); absent where nothing else can hold it (fixtures). */
  lease?: WorkspaceLeaseSnapshot & {
    /** Profile projection: the older workspace has no migrated session this build can show yet. */
    readonly migrationPending?: boolean;
  };
  /** The outbox (profiles design §2.2): whether this window's latest changes are protected on this computer. Absent without one. */
  outbox?: OutboxView;
};

/** What the presentation shows of the outbox: the unprotected-changes warning, and how many changes wait or are in conflict. */
export type OutboxView = {
  /** Documents whose latest change isn't protected on this computer, once that warrants the warning (a failed write, or a long wait); else 0. */
  readonly unprotected: number;
  readonly unprotectedReason?: OutboxStatus["unprotectedReason"];
  /** Changes not yet in the library. */
  readonly pending: number;
  readonly conflicts: number;
  /** The library didn't answer the last send; changes are sent again shortly. */
  readonly failing: boolean;
  /**
   * Restoring changes from the last session (t-recovering): `shown` once it has taken over a second, `long` (offer a way on) after
   * `RECOVERY_NOTICE_MS`, `safe` when keeping on working is safe; `missing`: changes waiting for a save that is gone.
   */
  readonly recovering: { readonly shown: boolean; readonly long: boolean; readonly safe: boolean; readonly missing: number };
};
export const outboxView = (status: OutboxStatus): OutboxView =>
  ({ unprotected: status.unprotectedWarning ? status.unprotected.length : 0, unprotectedReason: status.unprotectedReason,
    pending: status.pending, conflicts: status.conflicts, failing: status.failing,
    recovering: { shown: status.recoveringShown, long: status.recoveringLong, safe: status.recoveringSafe, missing: status.missing.length } });

export function emptyPresentationStatus(verification = false): PresentationStatus {
  return { verification, workspace: { kind: "idle", message: "" },
    assets: { loaded: false }, glitter: [] };
}

/** Observable detached status; the trusted composition root calls `changed()`. */
export class PresentationStatusSource {
  private listeners = new Set<() => void>();
  constructor(private read: () => PresentationStatus) {}
  snapshot(): PresentationStatus { return structuredClone(this.read()); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  changed() { for (const listener of this.listeners) listener(); }
}
