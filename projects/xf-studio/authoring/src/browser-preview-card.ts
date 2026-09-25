/**
 * Device card for preparing the 3D head preview from the player's own Cyberpunk 2077 files,
 * shown on both hosts while the preview isn't ready. The host owns the work, paths, downloads
 * and cache; this card only shows the preparation and WolvenKit setup state and offers the one
 * next step (use the detected game folder, set up WolvenKit, get .NET, start, cancel or retry).
 * WolvenKit is downloaded only after the person agrees in the consent dialog. The card starts
 * preparation by itself on first contact when nothing is missing, unless the viewer cancelled a
 * run. The Studio composition root follows the same preparation actions to load the head.
 */
import type { InstallDetectionActions } from "./install-detection-actions";
import { previewView, shouldAutoStart, type PreviewPreparationActions } from "./preview-preparation";
import { wolvenKitConsent, type WolvenKitLink, type WolvenKitSetupActions } from "./wolvenkit-setup";

const AUTOSTART_KEY = "xfs.preview.autostart";
const STYLE = `
#preview-card { position: fixed; z-index: 9990; left: 50%; bottom: 76px; transform: translateX(-50%);
  width: min(480px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px; display: grid; gap: 8px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  box-shadow: var(--shadow, 0 12px 34px #0008); font: 13px/1.5 "Segoe UI", sans-serif; }
#preview-card[hidden] { display: none; }
#preview-card h2, #wolvenkit-consent h2 { margin: 0; font: 600 16px/1.3 "Bahnschrift", "Segoe UI", sans-serif; }
#preview-card p { margin: 0; overflow-wrap: anywhere; }
#preview-card-step { color: var(--text-muted, #b9c0c7); font-size: 12px; }
#preview-card-progress { width: 100%; height: 6px; accent-color: var(--accent, #f2db52); }
.preview-card-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.preview-card-actions button, #wolvenkit-consent button { padding: 6px 12px; color: var(--text, #f0f2f2);
  background: var(--bg-raised, #111820); border: 1px solid var(--line-strong, #59616b); font: inherit; }
#preview-card-primary, #wolvenkit-consent #wolvenkit-consent-confirm { background: var(--accent, #f2db52);
  color: var(--accent-ink, #1d2023); font-weight: 600; }
.preview-card-links { display: flex; flex-wrap: wrap; gap: 4px 14px; }
#preview-card .preview-card-links button, #wolvenkit-consent .preview-card-links button { padding: 0; border: 0;
  background: none; color: var(--accent, #f2db52); text-decoration: underline; font: inherit; cursor: pointer; }
#wolvenkit-consent .preview-card-links { margin-bottom: 12px; }
#wolvenkit-consent { width: min(560px, calc(100vw - 32px)); box-sizing: border-box; padding: 20px 22px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  font: 13px/1.5 "Segoe UI", sans-serif; }
#wolvenkit-consent::backdrop { background: #0009; }
#wolvenkit-consent dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 12px 0; }
#wolvenkit-consent dt { color: var(--text-muted, #b9c0c7); }
#wolvenkit-consent dd { margin: 0; }
#wolvenkit-consent-runtime { padding: 8px 10px; border-left: 3px solid var(--accent, #f2db52); background: var(--bg-raised, #111820); }
#wolvenkit-consent-runtime[hidden] { display: none; }
`;

export type PreviewCardOptions = {
  document: Document;
  /** Per-viewer convenience only (the automatic-start preference); may be unavailable. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  actions: PreviewPreparationActions;
  wolvenKit: WolvenKitSetupActions;
  detection: Pick<InstallDetectionActions, "dispatch" | "snapshot">;
  /** Where the game folder and a person's own WolvenKit are set, in the host's own words. */
  setupPlace: string;
  /** Opens the host's setup form; without it the card names `setupPlace` instead. */
  openSetup?: () => void;
  /** Saves a detected game folder through the host's settings. */
  useGameFolder(path: string): Promise<void>;
  /** Saves a detected WolvenKit CLI through the host's settings. */
  useWolvenKit(path: string): Promise<void>;
  /** Opens one named official page (licence, release, .NET installer) in the person's browser. */
  openLink(link: WolvenKitLink): Promise<void>;
  /** The host's setup changed here (game folder, WolvenKit, preview ready); settings views re-read it. */
  onSetupChanged?: () => void;
};

export function mountPreviewCard(options: PreviewCardOptions) {
  const { document: doc, actions, wolvenKit } = options;
  const style = doc.createElement("style");
  style.textContent = STYLE;
  doc.head.append(style);
  const card = doc.createElement("section");
  card.id = "preview-card";
  card.setAttribute("aria-label", "3D preview");
  card.hidden = true;
  card.innerHTML = '<h2 id="preview-card-title"></h2><p id="preview-card-body"></p>' +
    '<progress id="preview-card-progress" max="1" hidden></progress><p id="preview-card-step" role="status" aria-live="polite"></p>' +
    '<div class="preview-card-links" id="preview-card-links"></div>' +
    '<div class="preview-card-actions"><button type="button" id="preview-card-later">Not now</button>' +
    '<button type="button" id="preview-card-secondary" hidden></button><button type="button" id="preview-card-primary"></button></div>';
  const consent = doc.createElement("dialog");
  consent.id = "wolvenkit-consent";
  consent.setAttribute("aria-labelledby", "wolvenkit-consent-title");
  consent.innerHTML = '<h2 id="wolvenkit-consent-title"></h2><p id="wolvenkit-consent-intro"></p><dl id="wolvenkit-consent-facts"></dl>' +
    '<p id="wolvenkit-consent-runtime" hidden></p><div class="preview-card-links" id="wolvenkit-consent-links"></div>' +
    '<div class="preview-card-actions"><button type="button" id="wolvenkit-consent-own">I already have WolvenKit</button>' +
    '<button type="button" id="wolvenkit-consent-later">Not now</button><button type="button" id="wolvenkit-consent-confirm"></button></div>';
  doc.body.append(card, consent);
  const part = <T extends HTMLElement>(root: HTMLElement, id: string) => root.querySelector(`#${id}`) as T;
  const title = part(card, "preview-card-title"), body = part(card, "preview-card-body");
  const bar = part<HTMLProgressElement>(card, "preview-card-progress"), step = part(card, "preview-card-step");
  const links = part(card, "preview-card-links");
  const primary = part<HTMLButtonElement>(card, "preview-card-primary"), secondary = part<HTMLButtonElement>(card, "preview-card-secondary");
  const later = part<HTMLButtonElement>(card, "preview-card-later");
  let detectedGame: string | null = null, detectionTried = false, detectionDone = false, dismissed = false, announcedReady = false;
  let lastWolvenKit: string | null = null;
  const setupChanged = () => options.onSetupChanged?.();
  const autostart = () => { try { return options.storage?.getItem(AUTOSTART_KEY) !== "off"; } catch { return true; } };
  const setAutostart = (on: boolean) => {
    try { if (on) options.storage?.removeItem(AUTOSTART_KEY); else options.storage?.setItem(AUTOSTART_KEY, "off"); }
    catch { /* Convenience only. */ }
  };
  let attempted = !autostart();

  async function detectGame() {
    if (detectionTried) return;
    detectionTried = true;
    try {
      const outcome = await options.detection.dispatch({ kind: "detect.gameInstalls" });
      const candidates = outcome.ok ? options.detection.snapshot().games?.candidates ?? [] : [];
      detectedGame = candidates.length === 1 ? candidates[0]!.root : null;
    } finally { detectionDone = true; render(); }
  }

  function linkButtons(root: HTMLElement, items: { label: string; link: WolvenKitLink }[]) {
    root.replaceChildren(...items.map(item => {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => void options.openLink(item.link).catch(error => { step.textContent = (error as Error).message; }));
      return button;
    }));
  }

  function render() {
    const state = actions.snapshot();
    if (!state) return;
    if (state.phase === "ready") {
      card.hidden = true;
      if (!announcedReady) { announcedReady = true; setupChanged(); }
      return;
    }
    const needsGame = state.phase === "needs-setup" && state.needs.includes("game");
    if (needsGame) void detectGame();
    const view = previewView(state, detectedGame, wolvenKit.snapshot());
    // Offer the next step only once game detection has answered, so it never flips under the pointer.
    const looking = needsGame && !detectionDone;
    const busy = state.phase === "preparing" || ["downloading", "installing"].includes(wolvenKit.snapshot()?.phase ?? "");
    card.hidden = !view.visible || (dismissed && !busy);
    title.textContent = view.title;
    body.textContent = view.body;
    bar.hidden = view.progress === null;
    if (view.progress !== null) bar.value = view.progress;
    // Without a host setup form, the Studio's own panel is where the paths go.
    const setupElsewhere = view.primary?.action === "setup" && !options.openSetup;
    step.textContent = looking ? "Looking for Cyberpunk 2077 on this computer…" : view.step ?? (setupElsewhere ? `Set it in ${options.setupPlace}.` : "");
    primary.hidden = !view.primary || setupElsewhere || looking;
    primary.textContent = view.primary?.label ?? "";
    primary.dataset.action = primary.hidden ? "" : view.primary?.action ?? "";
    secondary.hidden = !view.secondary;
    secondary.textContent = view.secondary?.label ?? "";
    secondary.dataset.action = view.secondary?.action ?? "";
    linkButtons(links, view.links);
    later.hidden = busy;
  }

  function openConsent() {
    const state = wolvenKit.snapshot();
    if (!state) return;
    const view = wolvenKitConsent(state);
    part(consent, "wolvenkit-consent-title").textContent = view.title;
    part(consent, "wolvenkit-consent-intro").textContent = view.intro;
    part(consent, "wolvenkit-consent-facts").replaceChildren(...view.facts.flatMap(fact => [
      Object.assign(doc.createElement("dt"), { textContent: fact.label }),
      Object.assign(doc.createElement("dd"), { textContent: fact.value })]));
    const runtime = part(consent, "wolvenkit-consent-runtime");
    runtime.hidden = !view.runtimeNote;
    runtime.textContent = view.runtimeNote ?? "";
    linkButtons(part(consent, "wolvenkit-consent-links"), view.links);
    const confirm = part<HTMLButtonElement>(consent, "wolvenkit-consent-confirm");
    confirm.textContent = view.confirm;
    confirm.dataset.version = state.offer.version;
    (consent as HTMLDialogElement).showModal();
    confirm.focus();
  }

  async function install(version: string | undefined) {
    if (!version) return;
    setAutostart(true); dismissed = false;
    const outcome = await wolvenKit.dispatch({ kind: "wolvenkit.install", version });
    if (!outcome.ok) step.textContent = outcome.message;
  }

  async function maybeStart() {
    const state = actions.snapshot();
    if (state && shouldAutoStart(state, attempted)) {
      attempted = true;
      await actions.dispatch({ kind: "preview.prepare" });
    }
  }
  /** Re-read the host state (for example after the game folder or WolvenKit changed) and start if it can. */
  async function refresh() {
    setupChanged();
    await wolvenKit.dispatch({ kind: "wolvenkit.refresh" });
    await actions.dispatch({ kind: "preview.refresh" });
    await maybeStart();
  }

  async function run(action: string | undefined) {
    primary.disabled = secondary.disabled = true;
    try {
      if (action === "cancel") { setAutostart(false); await actions.dispatch({ kind: "preview.cancel" }); }
      else if (action === "setup") options.openSetup?.();
      else if (action === "use-game" && detectedGame) { await options.useGameFolder(detectedGame); await refresh(); }
      else if (action === "prepare" || action === "retry") {
        setAutostart(true); attempted = true;
        const outcome = await actions.dispatch({ kind: "preview.prepare" });
        if (!outcome.ok) step.textContent = outcome.message;
      } else if (action === "wolvenkit-consent") openConsent();
      else if (action === "wolvenkit-retry") await install(wolvenKit.snapshot()?.offer.version);
      else if (action === "wolvenkit-cancel") await wolvenKit.dispatch({ kind: "wolvenkit.cancel" });
      else if (action === "wolvenkit-use-detected") {
        const found = wolvenKit.snapshot()?.detected;
        if (found) { await options.useWolvenKit(found.path); await refresh(); }
      } else if (action === "runtime-install") await options.openLink("runtime-installer");
      else if (action === "runtime-recheck") { await wolvenKit.dispatch({ kind: "wolvenkit.recheck" }); await refresh(); }
    } catch (error) { step.textContent = (error as Error)?.message || "That didn't work. Try again."; }
    finally { primary.disabled = secondary.disabled = false; render(); }
  }
  primary.addEventListener("click", () => void run(primary.dataset.action));
  secondary.addEventListener("click", () => void run(secondary.dataset.action));
  later.addEventListener("click", () => { dismissed = true; card.hidden = true; });
  part(consent, "wolvenkit-consent-later").addEventListener("click", () => (consent as HTMLDialogElement).close());
  const own = part<HTMLButtonElement>(consent, "wolvenkit-consent-own");
  own.hidden = !options.openSetup;
  own.addEventListener("click", () => { (consent as HTMLDialogElement).close(); options.openSetup?.(); });
  part(consent, "wolvenkit-consent-confirm").addEventListener("click", event => {
    (consent as HTMLDialogElement).close();
    void install((event.currentTarget as HTMLElement).dataset.version).finally(render);
  });
  actions.subscribe(render);
  wolvenKit.subscribe(() => {
    const phase = wolvenKit.snapshot()?.phase ?? null;
    // Once WolvenKit is ready (downloaded, or .NET installed), the preview can start.
    if (phase === "ready" && lastWolvenKit !== null && lastWolvenKit !== "ready") void actions.dispatch({ kind: "preview.refresh" }).then(maybeStart);
    if (phase !== lastWolvenKit && lastWolvenKit !== null) setupChanged();
    lastWolvenKit = phase;
    render();
  });
  // After installing .NET in another window, coming back re-checks without a click.
  doc.defaultView?.addEventListener("focus", () => {
    if (wolvenKit.snapshot()?.phase === "needs-runtime") void wolvenKit.dispatch({ kind: "wolvenkit.recheck" });
  });
  void refresh();
  return { refresh };
}
