/**
 * "Get the desktop app" for the localhost Studio (localhost-only UI; the desktop app itself has no such offer). The host reports,
 * read-only, whether the XF Studio desktop app is installed for this Windows user, whether this checkout has a locally built setup
 * program, and whether a release has been published; the view offers the one next step: open the app, run the setup built here
 * (only after the person confirms it, naming the exact file they were shown), or how to build it. The browser never sends a path:
 * the host decides which setup and which app, and refuses a setup that changed since it was shown.
 */
import { DESKTOP_APP_DESCRIPTORS } from "./studio-action-descriptors";

/** The desktop app's pinned identity (`electrobun.config.ts`): its install folder is `%LOCALAPPDATA%\<identity>\<channel>\`. */
export const DESKTOP_APP_IDENTITY = "dev.axefrog.xf-studio";
/** The one command that builds the setup program, run in the desktop folder of the checkout. */
export const DESKTOP_BUILD_COMMAND = "bun run build:installer";
/** Where it is run and where the setup lands, relative to the repository root. */
export const DESKTOP_BUILD_FOLDER = "projects/xf-studio/authoring/desktop";
export const DESKTOP_INSTALLER_FOLDER = `${DESKTOP_BUILD_FOLDER}/artifacts`;

export type DesktopAppStatus = {
  schema: "xfs/desktop-app-status-1";
  /** The desktop app is Windows-only; elsewhere only the build instructions are offered. */
  platform: "windows" | "other";
  /** The installed desktop app for this Windows user, when found (its uninstall entry or its install folder). */
  installed: {
    version: string | null;
    channel: string;
    /** Found through Windows' own list of installed apps, not only its folder. */
    registered: boolean;
    /** Whether its program was found, so it can be opened from here. */
    canOpen: boolean;
  } | null;
  /** The newest setup program built in this checkout, if any; `id` names exactly this file for the consent. */
  installer: { id: string; name: string; bytes: number; builtAt: string } | null;
  build: { command: string; folder: string; output: string };
  /** The published release, once there is one (the site's release status). */
  release: { tag: string; title: string } | null;
  /** Whether this Studio may start a setup or the app (not from a test workspace or a test copy); the reason when it can't. */
  launch: { allowed: true } | { allowed: false; reason: string };
};

export type DesktopAppAction = { kind: "desktopApp.refresh" } | { kind: "desktopApp.install"; installer: string } | { kind: "desktopApp.open" };
export type DesktopAppOutcome = { ok: true; message: string } | { ok: false; code: string; message: string };
export type DesktopAppState = {
  busy: DesktopAppAction["kind"] | null;
  status: DesktopAppStatus | null;
  /** The last plain failure or success of a launch, for the sheet. */
  outcome: { kind: DesktopAppAction["kind"]; ok: boolean; message: string } | null;
  error: string | null;
};
export type DesktopAppTransport = {
  status(): Promise<{ ok: boolean; status: number; data: unknown }>;
  launch(body: { action: "install"; installer: string } | { action: "open" }): Promise<{ ok: boolean; status: number; data: unknown }>;
};
type Capability = { available: boolean; code?: string; reason?: string };
const refusal = (code: string, reason: string): Capability => ({ available: false, code, reason });

const UNREACHABLE = "XF Studio couldn't check for the desktop app just now. Try again in a moment.";
export const isDesktopAppStatus = (value: unknown): value is DesktopAppStatus =>
  !!value && typeof value === "object" && (value as { schema?: unknown }).schema === "xfs/desktop-app-status-1";

export class DesktopAppActions {
  private state: DesktopAppState = { busy: null, status: null, outcome: null, error: null };
  private listeners = new Set<() => void>();
  /** @param transport the host's endpoint, or null where this host doesn't offer the desktop app (the desktop app itself). */
  constructor(private readonly transport: DesktopAppTransport | null) {}
  /** Whether this host offers the desktop app at all; a presentation shows nothing about it when it doesn't. */
  offered() { return this.transport !== null; }
  descriptors() { return structuredClone(DESKTOP_APP_DESCRIPTORS); }
  snapshot(): Readonly<DesktopAppState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(next: Partial<DesktopAppState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(); }

  capability(action: DesktopAppAction): Capability {
    if (!(action?.kind in DESKTOP_APP_DESCRIPTORS)) return refusal("invalid_value", "Unknown command.");
    if (!this.transport) return refusal("unavailable", "You're already in the XF Studio desktop app.");
    if (this.state.busy) return refusal("busy", this.state.busy === "desktopApp.refresh" ? "Checking for the desktop app. Wait a moment."
      : "Starting it now. Wait a moment.");
    if (action.kind === "desktopApp.refresh") return { available: true };
    const status = this.state.status;
    if (!status) return refusal("needs_input", "Checking for the desktop app first.");
    if (status.platform !== "windows") return refusal("unavailable", "The XF Studio desktop app is for Windows.");
    if (action.kind === "desktopApp.open") {
      if (!status.installed) return refusal("missing_target", "The desktop app isn't installed yet.");
      if (!status.installed.canOpen) return refusal("missing_target", "The desktop app's program is missing. Install it again to repair it.");
    } else {
      if (!status.installer) return refusal("missing_target", `Build the setup first: run ${DESKTOP_BUILD_COMMAND} in ${DESKTOP_BUILD_FOLDER}.`);
      if (typeof action.installer !== "string" || action.installer !== status.installer.id)
        return refusal("stale", "The setup changed since it was shown. Check again.");
    }
    if (!status.launch.allowed) return refusal("unavailable", status.launch.reason);
    return { available: true };
  }

  async dispatch(action: DesktopAppAction): Promise<DesktopAppOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
    this.publish({ busy: action.kind, error: null, ...(action.kind === "desktopApp.refresh" ? {} : { outcome: null }) });
    if (action.kind === "desktopApp.refresh") {
      try {
        const response = await this.transport!.status();
        if (!response.ok || !isDesktopAppStatus(response.data)) throw Error("unexpected");
        this.publish({ busy: null, status: response.data });
        return { ok: true, message: "" };
      } catch {
        this.publish({ busy: null, error: UNREACHABLE });
        return { ok: false, code: "transport", message: UNREACHABLE };
      }
    }
    let result: DesktopAppOutcome;
    try {
      const response = await this.transport!.launch(action.kind === "desktopApp.install" ? { action: "install", installer: action.installer } : { action: "open" });
      const data = (response.data ?? {}) as { message?: unknown; code?: unknown; error?: unknown };
      result = response.ok && typeof data.message === "string" ? { ok: true, message: data.message }
        : { ok: false, code: typeof data.code === "string" ? data.code : "launch_failed",
          message: typeof data.error === "string" ? data.error : "That didn't start. Try again." };
    } catch {
      result = { ok: false, code: "transport", message: "XF Studio couldn't reach its local server. Restart XF Studio and try again." };
    }
    this.publish({ busy: null, outcome: { kind: action.kind, ok: result.ok, message: result.message } });
    // A setup that changed or vanished: look again, so the sheet shows what is there now.
    if (!result.ok && (result.code === "stale" || result.code === "missing_target")) await this.dispatch({ kind: "desktopApp.refresh" });
    return result;
  }
}

