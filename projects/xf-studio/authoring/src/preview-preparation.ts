/**
 * Renderer-side actions for preparing the 3D preview from the player's game files. The host
 * owns the work and every path; this module only reads its state, asks it to start, cancel or
 * prepare again, polls while it runs (through the shared polled host state, which keeps retrying
 * with backoff if contact is lost mid-run), and turns the state into plain-language view facts.
 * The preview setup service (`preview-setup.ts`) follows these actions for the card and the head.
 */
import { PolledHostState, type HostConnection, type HostTimers } from "./host-state-poller";
import { wolvenKitCard, type WolvenKitCardAction, type WolvenKitLink, type WolvenKitSetupState } from "./wolvenkit-setup";

export type PreviewPhase = "ready" | "idle" | "needs-setup" | "preparing" | "failed" | "blocked";
export type PreviewState = {
  schema: "xfs/preview-core-state-1";
  phase: PreviewPhase;
  message: string;
  code: string | null;
  needs: ("game" | "wolvenkit")[];
  progress: { index: number; total: number; label: string } | null;
  lastDurationSeconds: number | null;
  canPrepare: boolean;
  canCancel: boolean;
};
/** `preview.rebuild` discards the prepared files and prepares them again (a damaged preview). */
export type PreviewAction = { kind: "preview.refresh" } | { kind: "preview.prepare" } | { kind: "preview.cancel" } | { kind: "preview.rebuild" };
export type PreviewTransport = (action: "refresh" | "prepare" | "cancel" | "rebuild") => Promise<{ ok: boolean; data: unknown }>;
export type PreviewOutcome = { ok: true } | { ok: false; message: string };

export function isPreviewState(value: unknown): value is PreviewState {
  const state = value as PreviewState;
  return !!state && state.schema === "xfs/preview-core-state-1" &&
    ["ready", "idle", "needs-setup", "preparing", "failed", "blocked"].includes(state.phase) &&
    typeof state.message === "string" && Array.isArray(state.needs) && typeof state.canPrepare === "boolean" && typeof state.canCancel === "boolean";
}

export type PreviewCardAction = "prepare" | "cancel" | "setup" | "use-game" | "retry" | WolvenKitCardAction;
export type PreviewView = {
  title: string;
  body: string;
  /** 0–1 while preparing or downloading, null otherwise. */
  progress: number | null;
  step: string | null;
  primary: { label: string; action: PreviewCardAction } | null;
  secondary: { label: string; action: PreviewCardAction } | null;
  /** Official pages the card offers (opened by the host). */
  links: { label: string; link: WolvenKitLink }[];
  /** Show the card at all (hidden when the preview is ready). */
  visible: boolean;
  /** One short sentence for the head viewport while the preview is unavailable. */
  viewport: string;
};

/**
 * Pure: the plain-language card for one host state, plus an optional detected game folder and the
 * WolvenKit setup state. While the preview waits only for WolvenKit, WolvenKit's own card is shown.
 * `gameNote` explains a copy detection found but can't use (for example the Xbox app's) when no folder was found.
 */
export function previewView(state: PreviewState, detectedGame: string | null = null, wolvenKit: WolvenKitSetupState | null = null,
  setupPlace = "Build setup", gameNote: string | null = null): PreviewView {
  if (state.phase === "needs-setup" && !state.needs.includes("game") && state.needs.includes("wolvenkit") && wolvenKit && wolvenKit.phase !== "ready") {
    const card = wolvenKitCard(wolvenKit, setupPlace);
    return { title: card.title, body: card.body, progress: card.progress, step: card.step, primary: card.primary, secondary: card.secondary,
      links: card.links, visible: card.visible, viewport: card.viewport };
  }
  const view = previewCard(state, detectedGame, gameNote);
  return { secondary: null, links: [], ...view, viewport: viewportMessage(state) };
}

function viewportMessage(state: PreviewState): string {
  switch (state.phase) {
    case "ready": return "";
    case "preparing": return "Preparing the 3D preview from your Cyberpunk 2077 files…";
    case "needs-setup": return state.needs.includes("game") ? "The 3D preview needs your Cyberpunk 2077 game folder."
      : "The 3D preview needs WolvenKit.";
    case "blocked": return "The 3D preview can't be built for this game version yet.";
    case "failed": return state.code === "preview_cancelled" ? "The 3D preview wasn't prepared. You can start it again at any time."
      : "The 3D preview couldn't be prepared. Try again from the card below.";
    case "idle": return "The 3D preview can be prepared from your Cyberpunk 2077 files.";
  }
}

function previewCard(state: PreviewState, detectedGame: string | null,
  gameNote: string | null): Omit<PreviewView, "viewport" | "secondary" | "links"> {
  const hidden = { title: "", body: "", progress: null, step: null, primary: null, visible: false };
  switch (state.phase) {
    case "ready": return hidden;
    case "preparing": {
      const progress = state.progress ? Math.min(1, Math.max(0, (state.progress.index + 0.5) / state.progress.total)) : 0;
      return { title: "Preparing the 3D preview from your Cyberpunk 2077 files…", body: "This usually takes under a minute. You can keep designing on the UV map meanwhile.",
        progress, step: state.progress ? `Step ${state.progress.index + 1} of ${state.progress.total}: ${state.progress.label}` : null,
        primary: { label: "Cancel", action: "cancel" }, visible: true };
    }
    case "needs-setup":
      if (state.needs.includes("game"))
        return detectedGame
          ? { title: "Turn on the 3D preview", body: `We found Cyberpunk 2077 at ${detectedGame}. XF Studio builds the 3D head from your own game files and changes nothing in your game.`,
            progress: null, step: null, primary: { label: "Use this folder", action: "use-game" }, visible: true }
          : { title: "Turn on the 3D preview", body: gameNote ?? state.message, progress: null, step: null, primary: { label: "Choose game folder", action: "setup" }, visible: true };
      return { title: "The 3D preview needs WolvenKit", body: state.message, progress: null, step: null, primary: { label: "Set up WolvenKit…", action: "wolvenkit-consent" }, visible: true };
    case "blocked":
      return { title: "The 3D preview can't be built for this game version", body: state.message, progress: null, step: null,
        primary: { label: "Try again", action: "retry" }, visible: true };
    case "failed":
      return { title: state.code === "preview_cancelled" ? "3D preview not prepared" : "The 3D preview couldn't be prepared", body: state.message,
        progress: null, step: null, primary: { label: "Try again", action: "retry" }, visible: true };
    case "idle":
      return { title: "Turn on the 3D preview", body: state.message, progress: null, step: null, primary: { label: "Prepare 3D preview", action: "prepare" }, visible: true };
  }
}

/** Should the renderer start preparing without a click? Only on first contact, when nothing is blocked or failed. */
export const shouldAutoStart = (state: PreviewState, alreadyAttempted: boolean) => state.phase === "idle" && state.canPrepare && !alreadyAttempted;

export class PreviewPreparationActions {
  private readonly host: PolledHostState<PreviewState, "refresh" | "prepare" | "cancel" | "rebuild">;
  constructor(transport: PreviewTransport, pollMs = 700, timers?: HostTimers) {
    this.host = new PolledHostState<PreviewState, "refresh" | "prepare" | "cancel" | "rebuild">({ transport, isState: isPreviewState, working: state => state.phase === "preparing",
      refresh: "refresh", pollMs, timers, messages: {
        invalid: "The 3D preview state is unavailable. Restart XF Studio and try again.",
        unreachable: "XF Studio couldn't reach its 3D preview service. Restart XF Studio and try again." } });
  }
  snapshot(): PreviewState | null { return this.host.snapshot(); }
  /** Contact with the host's preparation service (failed polls are retried while it works). */
  connection(): HostConnection { return this.host.connection(); }
  subscribe(listener: () => void) { return this.host.subscribe(listener); }
  capability(action: PreviewAction): { available: boolean; reason?: string } {
    if (action.kind === "preview.refresh") return { available: true };
    const state = this.host.snapshot();
    if (!state) return { available: false, reason: "The 3D preview state is still loading." };
    if (action.kind === "preview.prepare") return state.canPrepare ? { available: true } : { available: false, reason: state.message };
    if (action.kind === "preview.rebuild") return state.phase === "ready" || state.canPrepare ? { available: true }
      : { available: false, reason: state.phase === "preparing" ? "The 3D preview is being prepared." : state.message };
    return state.canCancel ? { available: true } : { available: false, reason: "Nothing is being prepared." };
  }
  async dispatch(action: PreviewAction): Promise<PreviewOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, message: allowed.reason! };
    return this.host.request(action.kind.slice("preview.".length) as "refresh" | "prepare" | "cancel" | "rebuild");
  }
  dispose() { this.host.dispose(); }
}

/** `endpoint` is the host's preparation service: `/api/preview-core` on localhost, `/api/desktop/preview` on desktop. */
export function createBrowserPreviewPreparation(endpoint: string) {
  return new PreviewPreparationActions(async action => {
    const response = action === "refresh" ? await fetch(endpoint, { cache: "no-store" }) : await fetch(endpoint, { method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    return { ok: response.ok, data: await response.json() };
  });
}
