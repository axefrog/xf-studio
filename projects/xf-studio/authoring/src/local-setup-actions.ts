import type { LocalSetupFields, LocalSetupView } from "./local-settings-server";

export type LocalSetupAction = { kind: "setup.refresh" } | { kind: "setup.save"; fields: LocalSetupFields } |
  { kind: "setup.restorePrevious" };
export type LocalSetupState = { view?: LocalSetupView; busy: boolean; error?: string };
export type LocalSetupOutcome = { ok: true } | { ok: false; code: string; message: string };
export type LocalSetupTransport = (method: "GET" | "PATCH" | "POST", body?: unknown) => Promise<{
  ok: boolean; status: number; data: LocalSetupView | { code: string; error: string };
}>;

export class LocalSetupActions {
  private state: LocalSetupState = { busy: false };
  private listeners = new Set<() => void>();
  constructor(private transport: LocalSetupTransport) {}
  snapshot(): Readonly<LocalSetupState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /**
   * Resolves once no request is in flight. Several views share one instance (the desktop's Build
   * setup, the Studio's Game & tools form and the preview card), so a save waits for a refresh
   * another view started instead of being refused as busy.
   */
  idle(): Promise<void> {
    if (!this.state.busy) return Promise.resolve();
    return new Promise(resolve => {
      const off = this.subscribe(() => { if (!this.state.busy) { off(); resolve(); } });
    });
  }
  private publish(state: LocalSetupState) { this.state = state; for (const listener of this.listeners) listener(); }
  capability(action: LocalSetupAction): { available: boolean; reason?: string } {
    if (this.state.busy) return { available: false, reason: "Local setup is busy." };
    if (action.kind === "setup.refresh") return { available: true };
    if (!this.state.view) return { available: false, reason: "Load local setup first." };
    if (action.kind === "setup.save" && this.state.view.source === "backup")
      return { available: false, reason: "Restore the previous settings copy before editing." };
    if (action.kind === "setup.restorePrevious" && this.state.view.source !== "backup")
      return { available: false, reason: "No recovery is needed." };
    return { available: true };
  }
  async dispatch(action: LocalSetupAction): Promise<LocalSetupOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    this.publish({ ...this.state, busy: true, error: undefined });
    try {
      const method = action.kind === "setup.refresh" ? "GET" : action.kind === "setup.save" ? "PATCH" : "POST";
      const body = action.kind === "setup.save" ? { revision: this.state.view!.revision, fields: action.fields } :
        action.kind === "setup.restorePrevious" ? { action: "restorePrevious" } : undefined;
      const response = await this.transport(method, body);
      if (!response.ok) {
        const failure = response.data as { code: string; error: string };
        this.publish({ ...this.state, busy: false, error: failure.error });
        return { ok: false, code: failure.code, message: failure.error };
      }
      this.publish({ view: response.data as LocalSetupView, busy: false });
      return { ok: true };
    } catch {
      const message = "Could not reach local setup. Restart the studio server and retry.";
      this.publish({ ...this.state, busy: false, error: message });
      return { ok: false, code: "transport", message };
    }
  }
}
