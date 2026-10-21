import type { DocumentModel } from "./collection-workspace";
import { fitWorkspace, WORKSPACE_STORAGE_BUDGET, type WorkspacePlan } from "./workspace-budget";
import type { WorkspaceState } from "./workspace-state";

/**
 * Autosave state for the presentation.
 * - `saved`: the latest draft is stored.
 * - `nearly-full`: stored, but only by dropping older Undo steps or recovery copies.
 * - `repaired`: stored, after damaged recovery entries were dropped at restore.
 * - `protected`: the stored workspace could not be read, so it is never overwritten.
 * - `unavailable`: the draft couldn't be stored (the host refused or couldn't be reached); the next change tries again.
 */
export type WorkspaceSaveStatus = {
  kind: "idle" | "saved" | "nearly-full" | "repaired" | "protected" | "unavailable";
  message: string;
};
/**
 * Where the draft goes: the host's workspace file (browser-workspace-device.ts `openHostWorkspace`), whose write may finish
 * later and rejects when it fails, or any synchronous store (tests).
 */
export type WorkspacePersistencePort = { setItem(key: string, value: string): unknown };

export const SAVE_MESSAGES = {
  saved: "Workspace saved",
  nearlyFull: "Draft autosaved, but workspace storage is nearly full, so older Undo steps were not kept. Save to library to keep a revision.",
  unavailable: "Autosave is unavailable. Save to library or export a recipe to keep your work.",
  failed: "Your latest changes couldn't be autosaved; XF Studio tries again with your next change. Save to library or export your collection to keep them.",
} as const;

/** One explicit debounce/flush policy for the isolated workspace key, writing the least-trimmed form that fits the budget. */
export class WorkspacePersistence {
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private status: WorkspaceSaveStatus = { kind: "idle", message: "" };
  private listeners = new Set<(status: WorkspaceSaveStatus) => void>();
  /** The exact text last written; an unchanged workspace is never rewritten. */
  private written?: string;
  private lastSize = 0;
  /** The plan the last write fitted: the next budget search starts there (CORE-41). */
  private lastPlan?: WorkspacePlan;
  /** Counts writes, so only the newest one's outcome is published. */
  private sequence = 0;
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
    const fitted = fitWorkspace(state, this.options.model, this.options.budget ?? WORKSPACE_STORAGE_BUDGET, this.lastPlan);
    // Unchanged content is not rewritten, so status or view refreshes cannot cause writes.
    if (fitted.encoded === this.written) return;
    const done: WorkspaceSaveStatus = fitted.trimmed || fitted.overBudget
      ? { kind: "nearly-full", message: SAVE_MESSAGES.nearlyFull }
      : this.options.restoreWarning ? { kind: "repaired", message: `Draft autosaved. ${this.options.restoreWarning}` }
      : { kind: "saved", message: SAVE_MESSAGES.saved };
    let result: unknown;
    try { result = this.options.storage.setItem(this.options.key, fitted.encoded); }
    catch { this.publish({ kind: "unavailable", message: SAVE_MESSAGES.unavailable }); return; }
    this.written = fitted.encoded; this.lastSize = fitted.size; this.lastPlan = fitted.plan;
    if (!(result instanceof Promise)) { this.publish(done); return; }
    // A host write: its outcome arrives later, and only the newest write's counts. A failed one is written again next time.
    const sequence = ++this.sequence;
    result.then(() => { if (sequence === this.sequence) this.publish(done); }, () => {
      if (sequence !== this.sequence) return;
      if (this.written === fitted.encoded) this.written = undefined;
      this.publish({ kind: "unavailable", message: SAVE_MESSAGES.failed });
    });
  }
  /** Publish only real changes, so a listener that reacts to status cannot loop. */
  private publish(status: WorkspaceSaveStatus) {
    if (status.kind === this.status.kind && status.message === this.status.message) return;
    this.status = status;
    for (const listener of this.listeners) listener(this.snapshot());
  }
}
