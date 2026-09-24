import type { WorkspaceState } from "./workspace-state";

export type WorkspaceSaveStatus = { kind: "idle" | "saved" | "protected" | "unavailable"; message: string };
export type WorkspacePersistencePort = { setItem(key: string, value: string): void };

/** One explicit debounce/flush policy for the isolated workspace key. */
export class WorkspacePersistence {
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private status: WorkspaceSaveStatus = { kind: "idle", message: "" };
  private listeners = new Set<(status: WorkspaceSaveStatus) => void>();
  constructor(private options: { storage: WorkspacePersistencePort; key: string; writable: boolean;
    restoreError?: string; capture(): WorkspaceState; delayMs?: number }) {}
  subscribe(listener: (status: WorkspaceSaveStatus) => void) {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  snapshot() { return { ...this.status }; }
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
    try {
      this.options.storage.setItem(this.options.key, JSON.stringify(this.options.capture()));
      this.publish({ kind: "saved", message: "Workspace saved in this browser" });
    } catch {
      this.publish({ kind: "unavailable", message: "Browser storage unavailable — save a recipe" });
    }
  }
  private publish(status: WorkspaceSaveStatus) {
    this.status = status;
    for (const listener of this.listeners) listener(this.snapshot());
  }
}
