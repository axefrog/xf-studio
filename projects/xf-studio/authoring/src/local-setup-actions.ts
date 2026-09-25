import type { LocalSetupFields, LocalSetupView } from "./local-settings-server";

/**
 * `setup.update` changes only the named fields: it waits for any request in flight, reads the saved
 * setup if it isn't loaded yet, and saves the named fields over the saved ones (so a detected game
 * folder or WolvenKit never overwrites another view's unrelated field).
 */
export type LocalSetupAction = { kind: "setup.refresh" } | { kind: "setup.save"; fields: LocalSetupFields } |
  { kind: "setup.update"; fields: Partial<LocalSetupFields> } | { kind: "setup.restorePrevious" };
export type LocalSetupState = { view?: LocalSetupView; busy: boolean; error?: string };
export type LocalSetupOutcome = { ok: true } | { ok: false; code: string; message: string };
export type LocalSetupTransport = (method: "GET" | "PATCH" | "POST", body?: unknown) => Promise<{
  ok: boolean; status: number; data: LocalSetupView | { code: string; error: string };
}>;

export class LocalSetupActions {
  private state: LocalSetupState = { busy: false };
  private listeners = new Set<() => void>();
  private refreshQueued = false;
  constructor(private transport: LocalSetupTransport) {}
  snapshot(): Readonly<LocalSetupState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /**
   * Resolves once no request is in flight. Several views share one instance (the desktop's Build
   * setup, the Studio's Game & tools form and the preview setup), so a save waits for a refresh
   * another view started instead of being refused as busy.
   */
  idle(): Promise<void> {
    if (!this.state.busy) return Promise.resolve();
    return new Promise(resolve => {
      const off = this.subscribe(() => { if (!this.state.busy) { off(); resolve(); } });
    });
  }
  /**
   * The host's setup changed outside the setup views (a game folder or WolvenKit chosen, WolvenKit
   * downloaded, the preview prepared): re-read it so Build availability follows. A change reported
   * while a request is in flight is re-read as soon as it finishes, so no change is missed.
   */
  requestRefresh(): void {
    if (this.state.busy) { this.refreshQueued = true; return; }
    this.refreshQueued = false;
    void this.dispatch({ kind: "setup.refresh" });
  }
  private publish(state: LocalSetupState) {
    this.state = state;
    for (const listener of this.listeners) listener();
    if (this.refreshQueued && !this.state.busy) this.requestRefresh();
  }
  capability(action: LocalSetupAction): { available: boolean; reason?: string } {
    if (action.kind === "setup.update") return this.state.view?.source === "backup"
      ? { available: false, reason: "Restore the previous settings copy before editing." } : { available: true };
    if (this.state.busy) return { available: false, reason: "Your settings are being saved or loaded. Try again in a moment." };
    if (action.kind === "setup.refresh") return { available: true };
    if (!this.state.view) return { available: false, reason: "Your settings are still loading." };
    if (action.kind === "setup.save" && this.state.view.source === "backup")
      return { available: false, reason: "Restore the previous settings copy before editing." };
    if (action.kind === "setup.restorePrevious" && this.state.view.source !== "backup")
      return { available: false, reason: "No recovery is needed." };
    return { available: true };
  }
  async dispatch(action: LocalSetupAction): Promise<LocalSetupOutcome> {
    if (action.kind === "setup.update") return this.update(action.fields);
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
      const message = "XF Studio couldn't reach your saved settings. Restart XF Studio and try again.";
      this.publish({ ...this.state, busy: false, error: message });
      return { ok: false, code: "transport", message };
    }
  }
  private async update(fields: Partial<LocalSetupFields>): Promise<LocalSetupOutcome> {
    await this.idle();
    if (!this.state.view) {
      const loaded = await this.dispatch({ kind: "setup.refresh" });
      if (!loaded.ok) return loaded;
      await this.idle();
    }
    const view = this.state.view;
    if (!view) return { ok: false, code: "unavailable", message: "That setting couldn't be saved. Try again." };
    return this.dispatch({ kind: "setup.save", fields: { ...view.fields, ...fields } });
  }
}
