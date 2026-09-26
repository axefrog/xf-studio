/**
 * The 3D preview setup service: one DOM-free application service that owns the first-run path
 * from "nothing set up" to an interactive head. It follows the host's preparation and WolvenKit
 * setup ports, finds the game folder, starts preparation by itself on first contact (unless the
 * person cancelled a run), loads the head once the preview is ready, and maps every state and
 * failure to plain wording with one next step. The presentation reads its detached snapshot and
 * dispatches its typed actions through `StudioPresentationPort.previewSetup`; it never talks to
 * the host services directly. Hosts supply the head loader, the links, their setup form and the
 * automatic-start preference (kept in the workspace).
 */
import { NO_3D_PREVIEW_IN_ALPHA } from "./alpha-availability";
import { headLoadFailureCode, type HeadLoadFailureCode } from "./head-load-error";
import type { HostConnection } from "./host-state-poller";
import { gameDetectionNote, type InstallDetectionActions } from "./install-detection-actions";
import type { LocalSetupActions } from "./local-setup-actions";
import { PREVIEW_SETUP_DESCRIPTORS } from "./studio-action-descriptors";
import { previewView, shouldAutoStart, type PreviewCardAction, type PreviewPreparationActions, type PreviewState } from "./preview-preparation";
import { wolvenKitCard, wolvenKitConsent, wolvenKitLinkUrl, type WolvenKitLink, type WolvenKitSetupActions, type WolvenKitSetupState } from "./wolvenkit-setup";

export type PreviewSetupAction =
  | { kind: "previewSetup.show" } | { kind: "previewSetup.dismiss" } | { kind: "previewSetup.refresh" }
  | { kind: "previewSetup.openSetup" } | { kind: "previewSetup.openLink"; link: WolvenKitLink }
  | { kind: "previewSetup.prepare" } | { kind: "previewSetup.cancel" } | { kind: "previewSetup.prepareAgain" }
  | { kind: "previewSetup.useDetectedGame" }
  | { kind: "previewSetup.consent" } | { kind: "previewSetup.consentClose" }
  | { kind: "previewSetup.installWolvenKit"; version: string } | { kind: "previewSetup.cancelDownload" }
  | { kind: "previewSetup.useDetectedWolvenKit" } | { kind: "previewSetup.recheckRuntime" }
  | { kind: "previewSetup.retryHead" };
export type PreviewSetupButton = { label: string; action: PreviewSetupAction };
export type PreviewSetupCapability = { available: boolean; reason?: string };
export type PreviewSetupOutcome = { ok: true } | { ok: false; message: string };

/**
 * The head viewport's state. `checking`/`loading`/`preparing` show progress, `unavailable` is
 * neutral (something is still needed), `failed` is an error with a way forward.
 */
export type PreviewHeadPhase = "checking" | "unavailable" | "preparing" | "loading" | "ready" | "failed";
export type PreviewHeadView = { phase: PreviewHeadPhase; code: string | null; message: string; progress: number | null;
  /** The one next step, offered in the head pane whenever the card isn't showing it. */
  next: PreviewSetupButton | null };
export type PreviewSetupCard = {
  open: boolean; title: string; body: string; progress: number | null; step: string | null;
  /** A plain note about the last step that didn't work, or lost contact with the host. */
  notice: string | null;
  primary: PreviewSetupButton | null; secondary: PreviewSetupButton | null;
  links: { label: string; link: WolvenKitLink }[];
  /** "Not now" is offered unless work is running (the card then shows its progress). */
  canDismiss: boolean;
  busy: boolean;
};
export type PreviewSetupConsent = {
  title: string; intro: string; facts: { label: string; value: string }[]; runtimeNote: string | null;
  links: { label: string; link: WolvenKitLink }[];
  confirm: PreviewSetupButton; own: PreviewSetupButton; later: PreviewSetupButton;
};
export type PreviewSetupSnapshot = {
  card: PreviewSetupCard;
  /** The WolvenKit download consent, while it is open. */
  consent: PreviewSetupConsent | null;
  head: PreviewHeadView;
  /**
   * Counts requests to open setup on a host with no setup form of its own; the Studio then reveals
   * its own Game & tools section.
   */
  setupRequests: number;
  /** Counts requests to show the card (from the head pane or a menu); the card takes focus only then. */
  showRequests: number;
  autostart: boolean;
  /**
   * The one next step towards WolvenKit, for anything that needs it while the card isn't showing it (the V's details or the creator's
   * labels waiting for WolvenKit; NATIVE-46, NATIVE-47): WolvenKit's own next step (its download consent, the WolvenKit found on this
   * computer, .NET, or where it is set), or where it is set when WolvenKit's own state doesn't know it is missing. Null while it downloads
   * or installs.
   */
  wolvenKitStep: PreviewSetupButton | null;
};

export type PreviewSetupPort = {
  preparation: PreviewPreparationActions;
  wolvenKit: WolvenKitSetupActions;
  detection: Pick<InstallDetectionActions, "dispatch" | "snapshot">;
  localSetup: Pick<LocalSetupActions, "dispatch" | "snapshot" | "subscribe" | "requestRefresh">;
  /** Opens one named official page in the person's browser; rejects with plain wording. */
  openLink(link: WolvenKitLink): Promise<void>;
  /** The host's own setup form (the desktop's Build setup); without it the Studio's Game & tools is used. */
  openHostSetup?: () => void;
  /** Where the game folder and WolvenKit are set, in the host's words ("Build setup", "Game & tools"). */
  setupPlace: string;
  /** May the preview start preparing by itself? Kept in the workspace. */
  autostart: { get(): boolean; set(on: boolean): void };
  /** Loads the 3D head from the prepared preview; throws a `HeadLoadError` (or any error). */
  loadHead(): Promise<void>;
};

const HEAD_FAILURES: Record<HeadLoadFailureCode, { message: string; next: "retry" | "prepare-again" }> = {
  webgl_unavailable: { next: "retry", message: "The 3D preview needs WebGL 2, which isn't available in this window. Update your graphics driver, " +
    "or if you're using Remote Desktop, open XF Studio on the computer itself. The UV editor, library and Check keep working." },
  preview_damaged: { next: "prepare-again", message: "The prepared 3D preview files are damaged. Prepare them again from your Cyberpunk 2077 files; it usually takes under a minute." },
  preview_unreachable: { next: "retry", message: "The 3D preview files couldn't be loaded just now. Try again." },
  head_load_failed: { next: "retry", message: "The 3D preview couldn't be loaded. Try again." },
};
const REPEATED_FAILURE = "The 3D preview still couldn't be loaded. Prepare it again from your Cyberpunk 2077 files.";
const BUSY = "XF Studio is still working on the last step.";

/** Views and host requests that are effects: they wait for (and block) each other. */
const EFFECTS = new Set<PreviewSetupAction["kind"]>(["previewSetup.refresh", "previewSetup.prepare", "previewSetup.cancel",
  "previewSetup.prepareAgain", "previewSetup.useDetectedGame", "previewSetup.installWolvenKit", "previewSetup.cancelDownload",
  "previewSetup.useDetectedWolvenKit", "previewSetup.recheckRuntime", "previewSetup.retryHead"]);

export class PreviewSetupActions {
  private listeners = new Set<() => void>();
  private dismissed = false;
  private consentOpen = false;
  private busy = false;
  private notice: { text: string; key: string } | null = null;
  private detectedGame: string | null = null;
  /** Why a copy that detection recognised can't be used (for example the Xbox app's), shown when no folder was found. */
  private gameNote: string | null = null;
  private detection: "idle" | "looking" | "done" = "idle";
  private attempted: boolean;
  private lastWolvenKit: WolvenKitSetupState["phase"] | null = null;
  private announcedReady = false;
  private head: { phase: "waiting" | "loading" | "ready" | "failed"; code: HeadLoadFailureCode | null; failures: number } =
    { phase: "waiting", code: null, failures: 0 };
  private setupRequests = 0;
  private showRequests = 0;
  private setupRevision: number | undefined;
  /** Nothing is requested or loaded until the composition root starts the service. */
  private started = false;
  constructor(private readonly port: PreviewSetupPort) {
    this.attempted = !port.autostart.get();
    this.setupRevision = port.localSetup.snapshot().view?.revision;
    port.preparation.subscribe(() => this.preparationChanged());
    port.wolvenKit.subscribe(() => this.wolvenKitChanged());
    // A changed game folder or WolvenKit path may make the preview preparable (or stale).
    port.localSetup.subscribe(() => {
      const revision = port.localSetup.snapshot().view?.revision;
      if (revision === this.setupRevision) return;
      this.setupRevision = revision;
      if (this.started && this.head.phase !== "ready") void this.refresh();
    });
  }
  /** Read the host state and start preparing if nothing is missing. */
  start(): Promise<void> { this.started = true; return this.refresh(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  descriptors() { return structuredClone(PREVIEW_SETUP_DESCRIPTORS); }
  /** Coming back to the window after installing .NET elsewhere re-checks without a click. */
  windowFocused() {
    if (this.port.wolvenKit.snapshot()?.phase === "needs-runtime") void this.port.wolvenKit.dispatch({ kind: "wolvenkit.recheck" });
  }

  snapshot(): PreviewSetupSnapshot {
    const state = this.port.preparation.snapshot(), wolvenKit = this.port.wolvenKit.snapshot();
    const view = state ? previewView(state, this.detectedGame, wolvenKit, this.port.setupPlace, this.gameNote) : null;
    const looking = this.looking(state);
    const working = this.working(state, wolvenKit);
    const visible = !!view?.visible && this.head.phase !== "ready";
    const open = visible && (!this.dismissed || working);
    const card: PreviewSetupCard = {
      open, title: view?.title ?? "", body: view?.body ?? "", progress: view?.progress ?? null,
      step: looking ? "Looking for Cyberpunk 2077 on this computer…" : view?.step ?? null,
      notice: this.noticeText(state, wolvenKit),
      primary: looking || !view?.primary ? null : this.button(view.primary.label, view.primary.action, wolvenKit),
      secondary: view?.secondary ? this.button(view.secondary.label, view.secondary.action, wolvenKit) : null,
      links: view?.links ?? [], canDismiss: !working, busy: this.busy,
    };
    const consentView = this.consentOpen && wolvenKit ? wolvenKitConsent(wolvenKit) : null;
    const consent: PreviewSetupConsent | null = consentView && wolvenKit ? {
      title: consentView.title, intro: consentView.intro, facts: consentView.facts, runtimeNote: consentView.runtimeNote, links: consentView.links,
      confirm: { label: consentView.confirm, action: { kind: "previewSetup.installWolvenKit", version: wolvenKit.offer.version } },
      own: { label: "I already have WolvenKit", action: { kind: "previewSetup.openSetup" } },
      later: { label: "Not now", action: { kind: "previewSetup.consentClose" } },
    } : null;
    return structuredClone({ card, consent, head: this.headView(state, wolvenKit, view, card), setupRequests: this.setupRequests,
      showRequests: this.showRequests, autostart: this.port.autostart.get(), wolvenKitStep: this.wolvenKitStep(wolvenKit) });
  }

  capability(action: PreviewSetupAction): PreviewSetupCapability {
    if (this.busy && EFFECTS.has(action.kind)) return { available: false, reason: BUSY };
    const { preparation, wolvenKit } = this.port;
    switch (action.kind) {
      case "previewSetup.show": {
        const card = this.snapshot().card;
        if (this.head.phase === "ready") return { available: false, reason: "The 3D preview is ready." };
        if (card.open) return { available: false, reason: "The 3D preview setup is already showing." };
        return card.title ? { available: true } : { available: false, reason: "The 3D preview state is still loading." };
      }
      case "previewSetup.dismiss": {
        const card = this.snapshot().card;
        return !card.open ? { available: false, reason: "The 3D preview setup isn't showing." }
          : card.canDismiss ? { available: true } : { available: false, reason: "Cancel the running step first." };
      }
      case "previewSetup.refresh": case "previewSetup.openSetup": case "previewSetup.recheckRuntime": return { available: true };
      case "previewSetup.openLink": {
        const state = wolvenKit.snapshot();
        return state && wolvenKitLinkUrl(state, action.link) ? { available: true } : { available: false, reason: "That page isn't available yet." };
      }
      case "previewSetup.prepare": return preparation.capability({ kind: "preview.prepare" });
      case "previewSetup.cancel": return preparation.capability({ kind: "preview.cancel" });
      case "previewSetup.prepareAgain":
        // Only for a head that isn't showing: preparing again under a loaded head would load it twice.
        return this.head.phase === "ready" || this.head.phase === "loading" ? { available: false, reason: "The 3D preview is already showing." }
          : preparation.capability({ kind: "preview.rebuild" });
      case "previewSetup.useDetectedGame":
        return this.detectedGame ? { available: true } : { available: false, reason: "No Cyberpunk 2077 folder was found on this computer." };
      case "previewSetup.consent":
        return wolvenKit.snapshot() ? { available: true } : { available: false, reason: "WolvenKit's setup state is still loading." };
      case "previewSetup.consentClose": return this.consentOpen ? { available: true } : { available: false, reason: "Nothing is being asked." };
      case "previewSetup.installWolvenKit": return wolvenKit.capability({ kind: "wolvenkit.install", version: action.version });
      case "previewSetup.cancelDownload": return wolvenKit.capability({ kind: "wolvenkit.cancel" });
      case "previewSetup.useDetectedWolvenKit":
        return wolvenKit.snapshot()?.detected ? { available: true } : { available: false, reason: "No WolvenKit was found on this computer." };
      case "previewSetup.retryHead":
        return this.head.phase === "failed" ? { available: true } : { available: false, reason: "The 3D head isn't waiting to be loaded again." };
    }
  }

  async dispatch(action: PreviewSetupAction): Promise<PreviewSetupOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, message: allowed.reason! };
    const { preparation, wolvenKit, localSetup } = this.port;
    switch (action.kind) {
      case "previewSetup.show": this.dismissed = false; this.showRequests++; this.notify(); return { ok: true };
      case "previewSetup.dismiss": this.dismissed = true; this.consentOpen = false; this.notify(); return { ok: true };
      case "previewSetup.consent": this.consentOpen = true; this.notify(); return { ok: true };
      case "previewSetup.consentClose": this.consentOpen = false; this.notify(); return { ok: true };
      case "previewSetup.openSetup":
        this.consentOpen = false;
        if (this.port.openHostSetup) this.port.openHostSetup(); else this.setupRequests++;
        this.notify();
        return { ok: true };
      case "previewSetup.openLink":
        return this.run(async () => { await this.port.openLink(action.link); return { ok: true }; }, false);
      case "previewSetup.refresh": return this.run(async () => { await this.refresh(); return this.refreshOutcome(); });
      case "previewSetup.prepare":
        this.port.autostart.set(true); this.attempted = true;
        return this.run(() => preparation.dispatch({ kind: "preview.prepare" }));
      case "previewSetup.cancel":
        this.port.autostart.set(false);
        return this.run(() => preparation.dispatch({ kind: "preview.cancel" }));
      case "previewSetup.prepareAgain":
        this.port.autostart.set(true); this.attempted = true;
        return this.run(async () => {
          const outcome = await preparation.dispatch({ kind: "preview.rebuild" });
          // The head loads again once the fresh preview is ready.
          if (outcome.ok) { this.head = { ...this.head, phase: "waiting", code: null }; this.follow(); }
          return outcome;
        });
      case "previewSetup.useDetectedGame": {
        const folder = this.detectedGame!;
        return this.run(async () => this.saved(await localSetup.dispatch({ kind: "setup.update", fields: { gameRoot: folder } })));
      }
      case "previewSetup.installWolvenKit":
        this.consentOpen = false; this.dismissed = false; this.port.autostart.set(true);
        return this.run(() => wolvenKit.dispatch({ kind: "wolvenkit.install", version: action.version }));
      case "previewSetup.cancelDownload": return this.run(() => wolvenKit.dispatch({ kind: "wolvenkit.cancel" }));
      case "previewSetup.useDetectedWolvenKit": {
        const found = wolvenKit.snapshot()!.detected!;
        return this.run(async () => this.saved(await localSetup.dispatch({ kind: "setup.update", fields: { wolvenKitCli: found.path } })));
      }
      case "previewSetup.recheckRuntime":
        return this.run(async () => {
          const outcome = await wolvenKit.dispatch({ kind: "wolvenkit.recheck" });
          localSetup.requestRefresh();
          await this.refresh();
          return outcome;
        });
      case "previewSetup.retryHead":
        return this.run(async () => {
          this.head = { ...this.head, phase: "waiting", code: null };
          this.notify();
          // A fresh host read loads the head if the preview is still ready (or waits for it).
          const outcome = await preparation.dispatch({ kind: "preview.refresh" });
          this.follow();
          return outcome;
        });
    }
  }

  // ---- Following the host ----
  private async refresh() {
    await this.port.wolvenKit.dispatch({ kind: "wolvenkit.refresh" });
    await this.port.preparation.dispatch({ kind: "preview.refresh" });
    await this.maybeStart();
  }
  private refreshOutcome(): PreviewSetupOutcome {
    const contact = this.port.preparation.connection();
    return contact.failures ? { ok: false, message: contact.message ?? "XF Studio couldn't reach its 3D preview service." } : { ok: true };
  }
  private async maybeStart() {
    if (!this.started) return;
    const state = this.port.preparation.snapshot();
    if (state && shouldAutoStart(state, this.attempted)) {
      this.attempted = true;
      await this.port.preparation.dispatch({ kind: "preview.prepare" });
    }
  }
  /** A detected folder or WolvenKit was saved; the host now reads it. */
  private async saved(outcome: { ok: true } | { ok: false; message: string }): Promise<PreviewSetupOutcome> {
    if (!outcome.ok) return { ok: false, message: outcome.message };
    await this.refresh();
    return { ok: true };
  }
  private preparationChanged() {
    const state = this.port.preparation.snapshot();
    if (state?.phase === "ready" && !this.announcedReady) { this.announcedReady = true; this.port.localSetup.requestRefresh(); }
    // Nothing is looked for or started before the composition root starts the service (PREV-23).
    if (this.started && this.looking(state) && this.detection === "idle") void this.detectGame();
    // A head that failed to load waits for the next ready preview once the host moves on,
    // for example after the game folder changed (PREV-24).
    if (state && state.phase !== "ready" && this.head.phase === "failed") this.head = { phase: "waiting", code: null, failures: 0 };
    this.follow();
    this.notify();
  }
  private wolvenKitChanged() {
    const phase = this.port.wolvenKit.snapshot()?.phase ?? null;
    // Once WolvenKit is ready (downloaded, or .NET installed), the preview can start.
    if (this.started && phase === "ready" && this.lastWolvenKit !== null && this.lastWolvenKit !== "ready")
      void this.port.preparation.dispatch({ kind: "preview.refresh" }).then(() => this.maybeStart());
    // Build availability depends on WolvenKit too.
    if (phase !== this.lastWolvenKit && this.lastWolvenKit !== null) this.port.localSetup.requestRefresh();
    this.lastWolvenKit = phase;
    this.notify();
  }
  /** The head loads as soon as the preview is ready; a failure is kept (not latched) until a retry. */
  private follow() {
    if (!this.started || this.head.phase !== "waiting" || this.port.preparation.snapshot()?.phase !== "ready") return;
    this.head = { ...this.head, phase: "loading", code: null };
    this.notify();
    void this.port.loadHead().then(() => { this.head = { phase: "ready", code: null, failures: 0 }; },
      error => { this.head = { phase: "failed", code: headLoadFailureCode(error), failures: this.head.failures + 1 }; })
      .finally(() => this.notify());
  }
  private async detectGame() {
    this.detection = "looking";
    try {
      const outcome = await this.port.detection.dispatch({ kind: "detect.gameInstalls" });
      const games = outcome.ok ? this.port.detection.snapshot().games : undefined;
      const candidates = games?.candidates ?? [];
      this.detectedGame = candidates.length === 1 ? candidates[0]!.root : null;
      this.gameNote = gameDetectionNote(games);
    } catch { this.detectedGame = null; this.gameNote = null; }
    finally { this.detection = "done"; this.notify(); }
  }

  // ---- View facts ----
  private looking(state: PreviewState | null) {
    return state?.phase === "needs-setup" && state.needs.includes("game") && this.detection !== "done";
  }
  private working(state: PreviewState | null, wolvenKit: WolvenKitSetupState | null) {
    return state?.phase === "preparing" || wolvenKit?.phase === "downloading" || wolvenKit?.phase === "installing";
  }
  private phaseKey() {
    return `${this.port.preparation.snapshot()?.phase}|${this.port.wolvenKit.snapshot()?.phase}`;
  }
  private noticeText(state: PreviewState | null, wolvenKit: WolvenKitSetupState | null): string | null {
    const contact = [this.port.preparation.connection(), this.port.wolvenKit.connection()].find(item => item.failures > 0);
    if (contact) return contactNotice(contact);
    // A step's own failure stays until the next step, or until the host moves on.
    if (this.notice && this.notice.key === `${state?.phase}|${wolvenKit?.phase}`) return this.notice.text;
    return null;
  }
  private wolvenKitStep(wolvenKit: WolvenKitSetupState | null): PreviewSetupButton | null {
    if (!wolvenKit || wolvenKit.phase === "downloading" || wolvenKit.phase === "installing") return null;
    const setup: PreviewSetupButton = { label: `Open ${this.port.setupPlace}`, action: { kind: "previewSetup.openSetup" } };
    if (wolvenKit.phase === "ready") return setup;
    const primary = wolvenKitCard(wolvenKit, this.port.setupPlace).primary;
    return primary ? this.button(primary.label, primary.action, wolvenKit) : setup;
  }
  private button(label: string, action: PreviewCardAction, wolvenKit: WolvenKitSetupState | null): PreviewSetupButton {
    return { label, action: cardAction(action, wolvenKit) };
  }
  private headView(state: PreviewState | null, wolvenKit: WolvenKitSetupState | null,
    view: ReturnType<typeof previewView> | null, card: PreviewSetupCard): PreviewHeadView {
    const head = (phase: PreviewHeadPhase, message: string, next: PreviewSetupButton | null = null, progress: number | null = null,
      code: string | null = null): PreviewHeadView => ({ phase, code, message, progress, next });
    if (this.head.phase === "ready") return head("ready", "");
    if (this.head.phase === "loading") return head("loading", "Loading the 3D head…");
    if (this.head.phase === "failed") {
      const code = this.head.code ?? "head_load_failed";
      const failure = HEAD_FAILURES[code], again = failure.next === "prepare-again" || (code === "head_load_failed" && this.head.failures > 1);
      return head("failed", again && code === "head_load_failed" ? REPEATED_FAILURE : failure.message,
        again ? { label: "Prepare again", action: { kind: "previewSetup.prepareAgain" } } : { label: "Try again", action: { kind: "previewSetup.retryHead" } },
        null, code);
    }
    if (!state || !view) {
      const contact = this.port.preparation.connection();
      return contact.failures && !contact.retrying
        ? head("unavailable", contact.message ?? NO_3D_PREVIEW_IN_ALPHA, { label: "Try again", action: { kind: "previewSetup.refresh" } })
        : head("checking", "Checking the 3D preview…");
    }
    if (state.phase === "ready") return head("loading", "Loading the 3D head…");
    const show: PreviewSetupButton = { label: "Set up 3D preview", action: { kind: "previewSetup.show" } };
    if (this.working(state, wolvenKit))
      return head("preparing", view.viewport, card.open ? null : { label: "Show progress", action: { kind: "previewSetup.show" } }, view.progress);
    if (state.phase === "failed" && state.code !== "preview_cancelled")
      return head("failed", view.viewport, card.open ? null : card.primary ?? show, null, state.code);
    return head("unavailable", view.viewport || NO_3D_PREVIEW_IN_ALPHA, card.open ? null : show, null, state.code);
  }

  // ---- Running steps ----
  private async run(work: () => Promise<PreviewSetupOutcome>, gate = true): Promise<PreviewSetupOutcome> {
    if (gate) this.busy = true;
    this.notice = null;
    this.notify();
    let outcome: PreviewSetupOutcome;
    try { outcome = await work(); }
    catch (error) { outcome = { ok: false, message: (error as Error)?.message || "That didn't work. Try again." }; }
    finally { if (gate) this.busy = false; }
    if (!outcome.ok) this.notice = { text: outcome.message, key: this.phaseKey() };
    this.notify();
    return outcome;
  }
  private notify() { for (const listener of this.listeners) listener(); }
}

/** Each card action from the pure view becomes one typed setup action. */
function cardAction(action: PreviewCardAction, wolvenKit: WolvenKitSetupState | null): PreviewSetupAction {
  switch (action) {
    case "prepare": case "retry": return { kind: "previewSetup.prepare" };
    case "cancel": return { kind: "previewSetup.cancel" };
    case "setup": return { kind: "previewSetup.openSetup" };
    case "use-game": return { kind: "previewSetup.useDetectedGame" };
    case "wolvenkit-consent": return { kind: "previewSetup.consent" };
    case "wolvenkit-retry": return { kind: "previewSetup.installWolvenKit", version: wolvenKit?.offer.version ?? "" };
    case "wolvenkit-cancel": return { kind: "previewSetup.cancelDownload" };
    case "wolvenkit-use-detected": return { kind: "previewSetup.useDetectedWolvenKit" };
    case "runtime-install": return { kind: "previewSetup.openLink", link: "runtime-installer" };
    case "runtime-recheck": return { kind: "previewSetup.recheckRuntime" };
  }
}

/** Plain wording for lost contact with the host's preview service. */
export function contactNotice(contact: HostConnection): string {
  if (!contact.retrying) return contact.message ?? "XF Studio couldn't reach its 3D preview service. Try again.";
  return contact.failures > 1 ? `XF Studio lost contact with its 3D preview service. Still trying (attempt ${contact.failures})…`
    : "XF Studio lost contact with its 3D preview service. Trying again…";
}
