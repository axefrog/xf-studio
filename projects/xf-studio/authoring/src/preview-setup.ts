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
  | { kind: "previewSetup.retryHead" }
  /** How the person installs mods, asked on the first-run card when Mod Organizer 2 was found; saved with **Use this folder**. */
  | { kind: "previewSetup.chooseRoute"; route: InstallRoute };
/** How mods are installed: through a Mod Organizer 2 profile, or into the game folder (Vortex or by hand). */
export type InstallRoute = "mo2" | "direct";
/**
 * The first-run card's question (release-readiness-audit.md item 9): how the person installs mods, asked when Mod Organizer 2 was
 * found on this computer, so the install route and the framework check are right from the first run. Defaults first: the MO2
 * instance found is chosen until the person picks otherwise.
 */
export type PreviewSetupRouteQuestion = { label: string; options: { value: InstallRoute; label: string; title: string }[]; chosen: InstallRoute;
  /** The instance and profile the card saves with MO2, in words ("Cyberpunk MO2 · profile Main"). */
  detail: string };
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
  /** How mods are installed, asked beside **Use this folder** when Mod Organizer 2 was found; null otherwise. */
  route: PreviewSetupRouteQuestion | null;
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
   * its own Settings panel at Game.
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
  /** The host's own setup form (the desktop's Build setup); without it the Studio's Settings panel is used. */
  openHostSetup?: () => void;
  /** Where the game folder and WolvenKit are set, in the host's words ("Build setup", "Settings"). */
  setupPlace: string;
  /** May the preview start preparing by itself? Kept in the workspace. */
  autostart: { get(): boolean; set(on: boolean): void };
  /**
   * Did the person choose **Not now** on the card? Kept in the workspace, so a declined card stays declined across dialogs and
   * restarts (release-readiness-audit.md item 10); the head pane keeps offering the next step. Without it, for this session only.
   */
  declined?: { get(): boolean; set(on: boolean): void };
  /** Loads the 3D head from the prepared preview; throws a `HeadLoadError` (or any error). */
  loadHead(): Promise<void>;
};

const HEAD_FAILURES: Record<HeadLoadFailureCode, { message: string; next: "retry" | "prepare-again" }> = {
  webgl_unavailable: { next: "retry", message: "The 3D view needs WebGL 2, which isn't available in this window. Update your graphics driver, " +
    "or if you're using Remote Desktop, open XF Studio on the computer itself. The UV editor, library and Check keep working." },
  preview_damaged: { next: "prepare-again", message: "The prepared 3D view files are damaged. Prepare them again from your Cyberpunk 2077 files; it usually takes under a minute." },
  preview_unreachable: { next: "retry", message: "The 3D view files couldn't be loaded just now. Try again." },
  body_unavailable: { next: "retry", message: "The masculine V's head couldn't be prepared from your Cyberpunk 2077 files. Try again." },
  head_load_failed: { next: "retry", message: "The 3D view couldn't be loaded. Try again." },
};
const REPEATED_FAILURE = "The 3D view still couldn't be loaded. Prepare it again from your Cyberpunk 2077 files.";
const BUSY = "XF Studio is still working on the last step.";
/** Whether two Windows folder paths name the same folder (case, slashes and a trailing separator aside). */
const folderKey = (path: string) => path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
const sameFolder = (a: string, b: string) => folderKey(a) === folderKey(b);
/** A folder's own name (the last part of its path). */
const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

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
  /** The Mod Organizer 2 instance found that manages Cyberpunk 2077, with its last-used profile, for the route question. */
  private detectedMo2: { root: string; name: string; profile: string | null } | null = null;
  /** The person's answer to the route question on the card, until **Use this folder** saves it. */
  private routeChoice: InstallRoute | null = null;
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
    this.dismissed = port.declined?.get() ?? false;
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
      route: !looking && view?.primary?.action === "use-game" ? this.routeQuestion() : null,
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
        if (this.head.phase === "ready") return { available: false, reason: "The 3D view is ready." };
        if (card.open) return { available: false, reason: "The 3D view setup is already showing." };
        return card.title ? { available: true } : { available: false, reason: "The 3D view state is still loading." };
      }
      case "previewSetup.dismiss": {
        const card = this.snapshot().card;
        return !card.open ? { available: false, reason: "The 3D view setup isn't showing." }
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
        return this.head.phase === "ready" || this.head.phase === "loading" ? { available: false, reason: "The 3D view is already showing." }
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
      case "previewSetup.chooseRoute":
        return this.snapshot().card.route ? { available: true } : { available: false, reason: "Nothing is being asked about how you install mods." };
    }
  }

  async dispatch(action: PreviewSetupAction): Promise<PreviewSetupOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, message: allowed.reason! };
    const { preparation, wolvenKit, localSetup } = this.port;
    switch (action.kind) {
      case "previewSetup.show": this.decline(false); this.showRequests++; this.notify(); return { ok: true };
      case "previewSetup.dismiss": this.decline(true); this.consentOpen = false; this.notify(); return { ok: true };
      case "previewSetup.chooseRoute": this.routeChoice = action.route; this.notify(); return { ok: true };
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
        // The folder, and how mods are installed when the card asked (the MO2 instance and profile it found, unless Settings already
        // names them), in one change, so the route and the framework check are right from the first run.
        const folder = this.detectedGame!, route = this.snapshot().card.route;
        const fields = !route ? { gameRoot: folder } : route.chosen === "direct" ? { gameRoot: folder, launchRoute: "direct" as const }
          : { gameRoot: folder, launchRoute: "mo2" as const, ...this.mo2Instance() };
        return this.run(async () => this.saved(await localSetup.dispatch({ kind: "setup.update", fields })));
      }
      case "previewSetup.installWolvenKit":
        this.consentOpen = false; this.decline(false); this.port.autostart.set(true);
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
    return contact.failures ? { ok: false, message: contact.message ?? "XF Studio couldn't reach its 3D view service." } : { ok: true };
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
  /**
   * The shown V changed body, so the head loads again with that body's core (browser-head-attachment.ts asks). A load already
   * under way is left alone; the head attachment asks again if the body still differs once it is ready.
   */
  reloadHead(): void {
    if (!this.started || this.head.phase === "loading") return;
    this.head = { phase: "waiting", code: null, failures: 0 };
    this.follow();
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
      // Mod Organizer 2, for the card's route question: the first instance that manages Cyberpunk 2077 (read only, quick).
      if (this.detectedGame) {
        const found = await this.port.detection.dispatch({ kind: "detect.mo2Instances" });
        const instance = found.ok ? this.port.detection.snapshot().mo2?.instances.find(item => item.managesCyberpunk) : undefined;
        this.detectedMo2 = instance ? { root: instance.root, name: instance.name,
          profile: instance.selectedProfile ?? instance.profiles[0] ?? null } : null;
      }
    } catch { this.detectedGame = null; this.gameNote = null; this.detectedMo2 = null; }
    finally { this.detection = "done"; this.notify(); }
  }
  /**
   * The Mod Organizer 2 instance **Use this folder** saves with the MO2 route: the one Settings names, else the one found. A profile
   * belongs to its instance (CORE-142): the found instance's profile fills in only for that instance, never for another root in Settings.
   */
  private mo2Instance(): { mo2Root: string; mo2ProfileId: string | null } {
    const found = this.detectedMo2!, fields = this.port.localSetup.snapshot().view?.fields;
    const own = fields?.mo2Root || null, profile = fields?.mo2ProfileId ?? null;
    if (own && !sameFolder(own, found.root)) return { mo2Root: own, mo2ProfileId: profile };
    return { mo2Root: own ?? found.root, mo2ProfileId: profile ?? found.profile };
  }
  /** The card's route question, while Mod Organizer 2 was found and the saved settings don't already name how mods are installed. */
  private routeQuestion(): PreviewSetupRouteQuestion | null {
    const mo2 = this.detectedMo2, fields = this.port.localSetup.snapshot().view?.fields;
    if (!mo2 || (fields?.launchRoute === "mo2" && fields.mo2Root)) return null;
    // It names the instance and profile **Use this folder** would save (Settings' own MO2 folder, when it names another one).
    const saved = this.mo2Instance(), other = !sameFolder(saved.mo2Root, mo2.root);
    const name = other ? folderName(saved.mo2Root) : mo2.name;
    return { label: "How do you install mods?", chosen: this.routeChoice ?? "mo2",
      detail: `${name}${saved.mo2ProfileId ? ` · profile ${saved.mo2ProfileId}` : ""}`,
      options: [{ value: "mo2", label: "Mod Organizer 2", title: `Your mods are managed in Mod Organizer 2 (${name})` },
        { value: "direct", label: "Vortex or by hand", title: "Your mods go into the game's own folder" }] };
  }
  /** Record the person's Not now (or taking it back), in the workspace when the host keeps it. */
  private decline(on: boolean) {
    this.dismissed = on;
    if (this.port.declined && this.port.declined.get() !== on) this.port.declined.set(on);
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
        : head("checking", "Checking the 3D view…");
    }
    if (state.phase === "ready") return head("loading", "Loading the 3D head…");
    const show: PreviewSetupButton = { label: "Set up 3D view", action: { kind: "previewSetup.show" } };
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
  if (!contact.retrying) return contact.message ?? "XF Studio couldn't reach its 3D view service. Try again.";
  return contact.failures > 1 ? `XF Studio lost contact with its 3D view service. Still trying (attempt ${contact.failures})…`
    : "XF Studio lost contact with its 3D view service. Trying again…";
}
