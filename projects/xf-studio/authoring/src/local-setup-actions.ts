import type { LocalSetupFields, LocalSetupView } from "./local-settings-server";

/**
 * `setup.update` changes only the named fields: it waits for any request in flight, reads the saved
 * setup if it isn't loaded yet, and saves the named fields over the saved ones (so a detected game
 * folder or WolvenKit never overwrites another view's unrelated field).
 */
export type LocalSetupAction = { kind: "setup.refresh" } | { kind: "setup.save"; fields: LocalSetupFields } |
  { kind: "setup.update"; fields: Partial<LocalSetupFields> } | { kind: "setup.restorePrevious" } |
  { kind: "setup.pickFolder"; field: FolderField };
/** The folders a person may choose with the host's own folder picker (UI-83). */
export type FolderField = "gameRoot" | "mo2Root" | "manualModRoot";
export const FOLDER_FIELDS: readonly FolderField[] = ["gameRoot", "mo2Root", "manualModRoot"];
/** The host's native folder picker: the folder chosen, or null when the person cancelled. */
export type FolderPicker = (field: FolderField) => Promise<string | null>;
export type LocalSetupState = { view?: LocalSetupView; busy: boolean; error?: string;
  /** Whether this host has a native folder picker (`setup.pickFolder`); a view offers Browse… only then. */
  canPickFolder: boolean };
export type LocalSetupOutcome = { ok: true } | { ok: false; code: string; message: string };
const CANCELLED: LocalSetupOutcome = { ok: false, code: "cancelled", message: "No folder was chosen, so nothing changed." };
export type LocalSetupTransport = (method: "GET" | "PATCH" | "POST", body?: unknown) => Promise<{
  ok: boolean; status: number; data: LocalSetupView | { code: string; error: string };
}>;

export class LocalSetupActions {
  private state: LocalSetupState;
  private listeners = new Set<() => void>();
  private refreshQueued = false;
  /**
   * @param pickFolder the host's native folder picker (the desktop app's); without one, `setup.pickFolder` says to choose a
   *   folder XF Studio found or type it.
   */
  constructor(private transport: LocalSetupTransport, private readonly pickFolder: FolderPicker | null = null) {
    this.state = { busy: false, canPickFolder: !!pickFolder };
  }
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
    if (action.kind === "setup.pickFolder") {
      if (!FOLDER_FIELDS.includes(action.field)) return { available: false, reason: "That setting isn't a folder." };
      if (!this.pickFolder) return { available: false, reason: "Choose a folder XF Studio found, or type the folder." };
    }
    if (action.kind === "setup.update" || action.kind === "setup.pickFolder") return this.state.view?.source === "backup"
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
    if (action.kind === "setup.pickFolder") {
      // The picked folder is saved at once, like a folder chosen from the ones XF Studio found (one setup form, UI-03).
      const allowed = this.capability(action);
      if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
      let chosen: string | null;
      try { chosen = await this.pickFolder!(action.field); }
      catch { return { ok: false, code: "picker_failed", message: "The folder picker couldn't open. Type the folder instead." }; }
      return chosen ? this.update({ [action.field]: chosen }) : CANCELLED;
    }
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
      this.publish({ view: response.data as LocalSetupView, busy: false, canPickFolder: this.state.canPickFolder });
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
