/**
 * Renderer-side actions for setting up WolvenKit CLI, the tool XF Studio uses to read game files.
 * The host owns the download, every path and URL; this module reads its state, asks it to
 * download (only after the person agreed in the consent dialog), cancel or check again, polls while
 * it works, and turns the state into plain-language view facts for the card and consent dialog.
 */
import { EYE_MAKEUP_MOD } from "./mod-branding";

export type WolvenKitSetupPhase = "ready" | "available" | "downloading" | "installing" | "needs-runtime" | "failed" | "custom-missing" | "unsupported";
export type WolvenKitSetupState = {
  schema: "xfs/wolvenkit-setup-1";
  phase: WolvenKitSetupPhase;
  message: string;
  code: string | null;
  source: "custom" | "managed" | null;
  version: string | null;
  offer: { version: string; downloadBytes: number; installedBytes: number; downloadSize: string; installedSize: string;
    from: string; publisher: string; licence: { name: string; spdx: string; url: string }; releasePage: string };
  runtime: { name: string; installed: boolean; installerUrl: string; pageUrl: string } | null;
  progress: { receivedBytes: number; totalBytes: number } | null;
  step: string | null;
  detected: { path: string; version: string } | null;
  canInstall: boolean;
  canCancel: boolean;
};
export type WolvenKitSetupAction = { kind: "wolvenkit.refresh" } | { kind: "wolvenkit.install"; version: string } |
  { kind: "wolvenkit.cancel" } | { kind: "wolvenkit.recheck" };
export type WolvenKitTransport = (request: { action: "refresh" } | { action: "install"; version: string } | { action: "cancel" } | { action: "recheck" }) =>
  Promise<{ ok: boolean; data: unknown }>;
export type WolvenKitOutcome = { ok: true } | { ok: false; message: string };
/** Official pages the card may open; the host maps each to its URL. */
export type WolvenKitLink = "wolvenkit-licence" | "wolvenkit-release" | "runtime-installer" | "runtime-page";
export type WolvenKitCardAction = "wolvenkit-consent" | "wolvenkit-retry" | "wolvenkit-cancel" | "wolvenkit-use-detected" |
  "runtime-install" | "runtime-recheck" | "setup";

const PHASES: readonly WolvenKitSetupPhase[] = ["ready", "available", "downloading", "installing", "needs-runtime", "failed", "custom-missing", "unsupported"];
export function isWolvenKitSetupState(value: unknown): value is WolvenKitSetupState {
  const state = value as WolvenKitSetupState;
  return !!state && state.schema === "xfs/wolvenkit-setup-1" && PHASES.includes(state.phase) && typeof state.message === "string" &&
    typeof state.canInstall === "boolean" && typeof state.canCancel === "boolean" && !!state.offer && typeof state.offer.version === "string";
}

export type WolvenKitCard = {
  title: string;
  body: string;
  /** 0–1 while downloading; null otherwise. */
  progress: number | null;
  step: string | null;
  primary: { label: string; action: WolvenKitCardAction } | null;
  secondary: { label: string; action: WolvenKitCardAction } | null;
  links: { label: string; link: WolvenKitLink }[];
  /** One short sentence for the head viewport. */
  viewport: string;
  visible: boolean;
};

/** Pure: the card for one WolvenKit state. Hidden when WolvenKit is ready. */
export function wolvenKitCard(state: WolvenKitSetupState): WolvenKitCard {
  const card = (patch: Partial<WolvenKitCard> & Pick<WolvenKitCard, "title" | "body">): WolvenKitCard =>
    ({ progress: null, step: null, primary: null, secondary: null, links: [], viewport: "The 3D preview needs WolvenKit.", visible: true, ...patch });
  const own = { label: "I already have WolvenKit", action: "setup" } as const;
  switch (state.phase) {
    case "ready": return card({ title: "", body: "", viewport: "", visible: false });
    case "available":
      return card({ title: state.code === "wolvenkit_damaged" ? "WolvenKit needs repairing" : "The 3D preview needs WolvenKit", body: state.message,
        primary: { label: state.code === "wolvenkit_damaged" ? "Download WolvenKit again…" : "Set up WolvenKit…", action: "wolvenkit-consent" },
        secondary: state.detected ? { label: `Use WolvenKit ${state.detected.version} from this computer`, action: "wolvenkit-use-detected" } : own });
    case "downloading": {
      const progress = state.progress && state.progress.totalBytes > 0 ? Math.min(1, state.progress.receivedBytes / state.progress.totalBytes) : 0;
      return card({ title: `Downloading WolvenKit ${state.offer.version}…`, progress, step: state.step,
        body: `From ${state.offer.from}. You can keep designing on the UV map meanwhile.`,
        primary: { label: "Cancel", action: "wolvenkit-cancel" }, viewport: "Downloading WolvenKit for the 3D preview…" });
    }
    case "installing":
      return card({ title: `Setting up WolvenKit ${state.offer.version}…`, body: "Checking the download against the official release and unpacking it.",
        progress: 1, step: state.step, primary: { label: "Cancel", action: "wolvenkit-cancel" }, viewport: "Setting up WolvenKit for the 3D preview…" });
    case "needs-runtime": {
      const name = state.runtime?.name ?? "Microsoft .NET";
      return card({ title: `WolvenKit needs Microsoft ${name.replace(/ Runtime$/, "")}`,
        body: `${state.message} Your browser downloads Microsoft's installer (about 30 MB); run it and allow it when Windows asks.`,
        primary: { label: `Get ${name} from Microsoft`, action: "runtime-install" }, secondary: { label: "Check again", action: "runtime-recheck" },
        links: [{ label: "Microsoft's .NET download page", link: "runtime-page" }], viewport: `The 3D preview needs Microsoft's ${name}.` });
    }
    case "failed":
      return card({ title: state.code === "wolvenkit_cancelled" ? "WolvenKit wasn't downloaded" : "WolvenKit couldn't be set up", body: state.message,
        primary: { label: `Download again (${state.offer.downloadSize})`, action: "wolvenkit-retry" }, secondary: own });
    case "custom-missing":
      return card({ title: "WolvenKit can't be found", body: state.message, primary: { label: "Open Build setup", action: "setup" } });
    case "unsupported":
      return card({ title: "The 3D preview needs WolvenKit", body: state.message, primary: { label: "Open setup", action: "setup" } });
  }
}

export type WolvenKitConsent = {
  title: string;
  intro: string;
  facts: { label: string; value: string }[];
  /** Said up front when the .NET runtime is missing too. */
  runtimeNote: string | null;
  confirm: string;
  links: { label: string; link: WolvenKitLink }[];
};

/** Pure: what the person agrees to before anything is downloaded. */
export function wolvenKitConsent(state: WolvenKitSetupState): WolvenKitConsent {
  const offer = state.offer;
  return {
    title: `Download WolvenKit ${offer.version}?`,
    intro: "XF Studio uses WolvenKit CLI to read your Cyberpunk 2077 files. It reads them only; nothing in your game changes.",
    facts: [
      { label: "What it is", value: `WolvenKit CLI ${offer.version}, the free, open-source modding tool made by ${offer.publisher}. It isn't part of XF Studio.` },
      { label: "Why", value: `It builds the 3D head preview from your own game files and packs your ${EYE_MAKEUP_MOD.modName} mod files.` },
      { label: "Size", value: `${offer.downloadSize} to download, ${offer.installedSize} once unpacked.` },
      { label: "From", value: `${offer.from}. XF Studio checks the download against the release's published fingerprint before using it.` },
      { label: "Where it goes", value: "XF Studio's own data folder. Nothing is installed in Windows or in your game." },
      { label: "Licence", value: `${offer.licence.name} (${offer.licence.spdx}): free software you may use, share and change.` },
    ],
    runtimeNote: state.runtime && !state.runtime.installed
      ? `WolvenKit also needs Microsoft's free ${state.runtime.name}, which isn't on this computer yet. XF Studio shows you how to get it after the download.`
      : null,
    confirm: `Download (${offer.downloadSize})`,
    links: [{ label: "Read the licence", link: "wolvenkit-licence" }, { label: "WolvenKit release page", link: "wolvenkit-release" }],
  };
}

/** Pure: the official URL for a link, taken from the host's own state. */
export function wolvenKitLinkUrl(state: WolvenKitSetupState, link: WolvenKitLink): string | null {
  switch (link) {
    case "wolvenkit-licence": return state.offer.licence.url;
    case "wolvenkit-release": return state.offer.releasePage;
    case "runtime-installer": return state.runtime?.installerUrl ?? null;
    case "runtime-page": return state.runtime?.pageUrl ?? null;
  }
}

export class WolvenKitSetupActions {
  private state: WolvenKitSetupState | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly transport: WolvenKitTransport, private readonly pollMs = 500) {}
  snapshot(): WolvenKitSetupState | null { return this.state && structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(state: WolvenKitSetupState) {
    this.state = state;
    for (const listener of this.listeners) listener();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (state.phase === "downloading" || state.phase === "installing")
      this.timer = setTimeout(() => { this.timer = null; void this.dispatch({ kind: "wolvenkit.refresh" }); }, this.pollMs);
  }
  capability(action: WolvenKitSetupAction): { available: boolean; reason?: string } {
    if (action.kind === "wolvenkit.refresh" || action.kind === "wolvenkit.recheck") return { available: true };
    if (!this.state) return { available: false, reason: "WolvenKit's setup state is still loading." };
    if (action.kind === "wolvenkit.install") {
      if (!this.state.canInstall) return { available: false, reason: this.state.message };
      return action.version === this.state.offer.version ? { available: true }
        : { available: false, reason: "That WolvenKit version isn't the one XF Studio offers." };
    }
    return this.state.canCancel ? { available: true } : { available: false, reason: "Nothing is being downloaded." };
  }
  async dispatch(action: WolvenKitSetupAction): Promise<WolvenKitOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, message: allowed.reason! };
    try {
      const request = action.kind === "wolvenkit.install" ? { action: "install" as const, version: action.version }
        : { action: action.kind === "wolvenkit.refresh" ? "refresh" as const : action.kind === "wolvenkit.cancel" ? "cancel" as const : "recheck" as const };
      const response = await this.transport(request);
      if (!isWolvenKitSetupState(response.data)) return { ok: false, message: "WolvenKit's setup state is unavailable. Restart XF Studio and try again." };
      this.publish(response.data);
      return response.ok ? { ok: true } : { ok: false, message: response.data.message };
    } catch {
      return { ok: false, message: "XF Studio couldn't reach its WolvenKit setup. Restart XF Studio and try again." };
    }
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}

export function createBrowserWolvenKitSetup(endpoint: string) {
  return new WolvenKitSetupActions(async request => {
    const response = request.action === "refresh" ? await fetch(endpoint, { cache: "no-store" }) : await fetch(endpoint, { method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    return { ok: response.ok, data: await response.json() };
  });
}
