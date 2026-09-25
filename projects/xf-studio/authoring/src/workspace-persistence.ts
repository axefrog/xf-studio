import type { DocumentModel } from "./collection-workspace";
import { fitWorkspace, WORKSPACE_STORAGE_BUDGET } from "./workspace-budget";
import type { WorkspaceState } from "./workspace-state";

/**
 * Browser autosave state for the presentation.
 * - `saved`: the latest draft is stored.
 * - `nearly-full`: stored, but only by dropping older Undo steps or recovery copies.
 * - `full`: browser storage refused the draft; recent changes are not autosaved.
 * - `repaired`: stored, after damaged recovery entries were dropped at restore.
 * - `protected`: the stored workspace could not be read, so it is never overwritten.
 * - `unavailable`: browser storage cannot be used at all.
 */
export type WorkspaceSaveStatus = {
  kind: "idle" | "saved" | "nearly-full" | "full" | "repaired" | "protected" | "unavailable";
  message: string;
};
export type WorkspacePersistencePort = { setItem(key: string, value: string): void };

export const SAVE_MESSAGES = {
  saved: "Workspace saved",
  nearlyFull: "Draft autosaved, but workspace storage is nearly full, so older Undo steps were not kept. Save to library to keep a revision.",
  full: "Workspace storage is full, so recent changes are not being autosaved. Save to library or export your collection to keep them.",
  unavailable: "Autosave is unavailable. Save to library or export a recipe to keep your work.",
} as const;

/** One explicit debounce/flush policy for the isolated workspace key. */
export class WorkspacePersistence {
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private status: WorkspaceSaveStatus = { kind: "idle", message: "" };
  private listeners = new Set<(status: WorkspaceSaveStatus) => void>();
  /** The exact text last written; an unchanged workspace is never rewritten. */
  private written?: string;
  private lastSize = 0;
  constructor(private options: { storage: WorkspacePersistencePort; key: string; writable: boolean;
    restoreError?: string; restoreWarning?: string; capture(): WorkspaceState; delayMs?: number; budget?: number;
    /** The document model the stored form is written with (injected by the composition root). */
    model: DocumentModel }) {}
  subscribe(listener: (status: WorkspaceSaveStatus) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  snapshot() { return { ...this.status }; }
  /** Encoded length (UTF-16 code units) of the last stored workspace, for diagnostics and tests. */
  storedSize() { return this.lastSize; }
  activate() { this.active = true; }
  request() {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.delayMs ?? 180);
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.active) return;
    if (!this.options.writable) {
      this.publish({ kind: "protected", message: `${this.options.restoreError ?? "Workspace could not be restored"}. Original storage kept; export your recipe before closing.` });
      return;
    }
    let state: WorkspaceState;
    try { state = this.options.capture(); }
    catch { this.publish({ kind: "unavailable", message: SAVE_MESSAGES.unavailable }); return; }
    // Write the least-trimmed form that fits the budget (`fitWorkspace`). If the browser still refuses
    // it (other keys share the quota), fit a smaller budget before reporting that autosave stopped.
    let quota = false, budget = this.options.budget ?? WORKSPACE_STORAGE_BUDGET;
    for (let attempt = 0; attempt < 12; attempt++) {
      const fitted = fitWorkspace(state, this.options.model, budget);
      // Unchanged content is not rewritten, so status or view refreshes cannot cause writes.
      if (fitted.encoded === this.written) return;
      try {
        this.options.storage.setItem(this.options.key, fitted.encoded);
      } catch (error) {
        if (!isQuotaError(error)) { this.publish({ kind: "unavailable", message: SAVE_MESSAGES.unavailable }); return; }
        quota = true;
        if (fitted.minimal) break;
        budget = Math.min(budget, Math.floor(fitted.size * 0.75));
        continue;
      }
      this.written = fitted.encoded; this.lastSize = fitted.size;
      this.publish(fitted.trimmed || fitted.overBudget
        ? { kind: "nearly-full", message: SAVE_MESSAGES.nearlyFull }
        : this.options.restoreWarning ? { kind: "repaired", message: `Draft autosaved. ${this.options.restoreWarning}` }
        : { kind: "saved", message: SAVE_MESSAGES.saved });
      return;
    }
    if (quota) this.publish({ kind: "full", message: SAVE_MESSAGES.full });
  }
  /** Publish only real changes, so a listener that reacts to status cannot loop. */
  private publish(status: WorkspaceSaveStatus) {
    if (status.kind === this.status.kind && status.message === this.status.message) return;
    this.status = status;
    for (const listener of this.listeners) listener(this.snapshot());
  }
}

function isQuotaError(error: unknown) {
  const e = error as { name?: string; code?: number } | undefined;
  return e?.name === "QuotaExceededError" || e?.name === "NS_ERROR_DOM_QUOTA_REACHED" || e?.code === 22 || e?.code === 1014;
}
