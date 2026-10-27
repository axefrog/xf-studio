import type { DocumentModel } from "./collection-workspace";
import { fitWorkspace, WORKSPACE_STORAGE_BUDGET, type WorkspacePlan } from "./workspace-budget";
import type { WorkspaceState as LookWorkspaceState } from "./workspace-state";
import type { WorkspaceState as MakeupWorkspaceState } from "./makeup-workspace";
type WorkspaceState = LookWorkspaceState | MakeupWorkspaceState;

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
  nearlyFull: "Draft autosaved, but workspace storage is nearly full, so older Undo steps were not kept. Save version keeps a version you can return to.",
  full: "Workspace storage is full, so recent changes are not being autosaved. Save version or export your collection to keep them.",
  unavailable: "Autosave is unavailable. Save version or export a recipe to keep your work.",
} as const;

/** One explicit debounce/flush policy for the isolated workspace key. */
export class WorkspacePersistence {
  private active = false;
  /** Retired (the workspace was handed to another page): nothing is written again in this page's lifetime. */
  private retired = false;
  private timer?: ReturnType<typeof setTimeout>;
  private status: WorkspaceSaveStatus = { kind: "idle", message: "" };
  private listeners = new Set<(status: WorkspaceSaveStatus) => void>();
  /** The exact text last written; an unchanged workspace is never rewritten. */
  private written?: string;
  private lastSize = 0;
  /** The plan the last write fitted: the next budget search starts there (CORE-41). */
  private lastPlan?: WorkspacePlan;
  constructor(private options: { storage: WorkspacePersistencePort; key: string; writable: boolean;
    restoreError?: string; restoreWarning?: string; capture(): WorkspaceState; delayMs?: number; budget?: number;
    /** What else in the same storage counts against the budget now (the outbox's keys, profiles design §2.2). */
    reserved?: () => number;
    /** The document model the stored form is written with (injected by the composition root). */
    model: DocumentModel;
    /** Whether this page may write its workspace now (the workspace lease, profiles design §2.3); always, without one. */
    canWrite?: () => boolean }) {}
  subscribe(listener: (status: WorkspaceSaveStatus) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  snapshot() { return { ...this.status }; }
  /** Encoded length (UTF-16 code units) of the last stored workspace, for diagnostics and tests. */
  storedSize() { return this.lastSize; }
  activate() { if (!this.retired) this.active = true; }
  /**
   * After this page handed the workspace to another one (its last write already stored, profiles design §2.3): the debounce timer
   * stops, and nothing is written again in this page's lifetime.
   */
  retire() {
    clearTimeout(this.timer); this.timer = undefined;
    this.active = false; this.retired = true;
  }
  request() {
    if (!this.active || this.options.canWrite?.() === false) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.delayMs ?? 180);
  }
  /**
   * Writes the latest draft now. Answers whether it is stored: written (whole or trimmed to fit), unchanged since the last write, or
   * nothing to write; false when it couldn't be (storage full or unavailable, capture failed, or this page may not write).
   */
  flush(): boolean {
    clearTimeout(this.timer); this.timer = undefined;
    // A read-only page (another one holds the workspace) writes nothing; the lease says so in the page.
    if (this.options.canWrite?.() === false) return false;
    if (!this.active) return true;
    // A protected workspace (unreadable at restore) is never written by any page, so there is nothing of this one's to lose.
    if (!this.options.writable) {
      this.publish({ kind: "protected", message: `${this.options.restoreError ?? "Workspace could not be restored"}. Original storage kept; export your recipe before closing.` });
      return true;
    }
    let state: WorkspaceState;
    try { state = this.options.capture(); }
    catch { this.publish({ kind: "unavailable", message: SAVE_MESSAGES.unavailable }); return false; }
    // Write the least-trimmed form that fits the budget (`fitWorkspace`). If the browser still refuses
    // it (other keys share the quota), fit a smaller budget before reporting that autosave stopped.
    let quota = false, budget = Math.max(0, (this.options.budget ?? WORKSPACE_STORAGE_BUDGET) - (this.options.reserved?.() ?? 0));
    for (let attempt = 0; attempt < 12; attempt++) {
      const fitted = fitWorkspace(state, this.options.model, budget, this.lastPlan);
      // Unchanged content is not rewritten, so status or view refreshes cannot cause writes.
      if (fitted.encoded === this.written) return true;
      try {
        this.options.storage.setItem(this.options.key, fitted.encoded);
      } catch (error) {
        if (!isQuotaError(error)) { this.publish({ kind: "unavailable", message: SAVE_MESSAGES.unavailable }); return false; }
        quota = true;
        if (fitted.minimal) break;
        budget = Math.min(budget, Math.floor(fitted.size * 0.75));
        continue;
      }
      this.written = fitted.encoded; this.lastSize = fitted.size; this.lastPlan = fitted.plan;
      this.publish(fitted.trimmed || fitted.overBudget
        ? { kind: "nearly-full", message: SAVE_MESSAGES.nearlyFull }
        : this.options.restoreWarning ? { kind: "repaired", message: `Draft autosaved. ${this.options.restoreWarning}` }
        : { kind: "saved", message: SAVE_MESSAGES.saved });
      return true;
    }
    if (quota) this.publish({ kind: "full", message: SAVE_MESSAGES.full });
    return false;
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
