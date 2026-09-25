// Desktop device UI for preparing the 3D head preview from the player's own Cyberpunk 2077
// files. The host owns the work, paths, downloads and cache; this card only shows its state,
// offers the one next step (use the detected game folder, set up WolvenKit, get .NET, start,
// cancel or retry) and tells Studio when the head can load. WolvenKit is downloaded only after
// the person agrees in the consent dialog. It is separate from the welcome and About dialogs.
import { createBrowserInstallDetection } from "../src/browser-install-detection-device";
import { createBrowserPreviewPreparation, PREVIEW_READY_EVENT, PREVIEW_STATUS_EVENT, previewView, shouldAutoStart } from "../src/preview-preparation";
import { createBrowserWolvenKitSetup, wolvenKitConsent } from "../src/wolvenkit-setup";

const AUTOSTART_KEY = "xfs.preview.autostart";
const STYLE = `
#desktop-preview-card { position: fixed; z-index: 9990; left: 50%; bottom: 76px; transform: translateX(-50%);
  width: min(480px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px; display: grid; gap: 8px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  box-shadow: var(--shadow, 0 12px 34px #0008); font: 13px/1.5 "Segoe UI", sans-serif; }
#desktop-preview-card[hidden] { display: none; }
#desktop-preview-card h2, #desktop-wolvenkit-consent h2 { margin: 0; font: 600 16px/1.3 "Bahnschrift", "Segoe UI", sans-serif; }
#desktop-preview-card p { margin: 0; overflow-wrap: anywhere; }
#desktop-preview-step { color: var(--text-muted, #b9c0c7); font-size: 12px; }
#desktop-preview-progress { width: 100%; height: 6px; accent-color: var(--accent, #f2db52); }
.desktop-preview-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.desktop-preview-actions button, #desktop-wolvenkit-consent button { padding: 6px 12px; color: var(--text, #f0f2f2);
  background: var(--bg-raised, #111820); border: 1px solid var(--line-strong, #59616b); font: inherit; }
#desktop-preview-primary, #desktop-wolvenkit-confirm { background: var(--accent, #f2db52); color: var(--accent-ink, #1d2023); font-weight: 600; }
.desktop-preview-links { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.desktop-preview-links button { padding: 0; border: 0; background: none; color: var(--accent, #f2db52);
  text-decoration: underline; font: inherit; cursor: pointer; }
#desktop-wolvenkit-consent { width: min(560px, calc(100vw - 32px)); box-sizing: border-box; padding: 20px 22px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  font: 13px/1.5 "Segoe UI", sans-serif; }
#desktop-wolvenkit-consent::backdrop { background: #0009; }
#desktop-wolvenkit-consent dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 12px 0; }
#desktop-wolvenkit-consent dt { color: var(--text-muted, #b9c0c7); }
#desktop-wolvenkit-consent dd { margin: 0; }
#desktop-wolvenkit-runtime { padding: 8px 10px; border-left: 3px solid var(--accent, #f2db52); background: var(--bg-raised, #111820); }
#desktop-wolvenkit-runtime[hidden] { display: none; }
`;

/**
 * @param {{ capabilities: { previewAssets: string }, openSetup: () => void,
 *   useGameFolder: (path: string) => Promise<void>, useWolvenKit: (path: string) => Promise<void>,
 *   openLink: (link: string) => Promise<void> }} host
 */
export function mountPreviewPreparation(host) {
  if (host.capabilities.previewAssets === "ready") return;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const card = document.createElement("section");
  card.id = "desktop-preview-card";
  card.setAttribute("aria-label", "3D preview");
  card.hidden = true;
  card.innerHTML = '<h2 id="desktop-preview-title"></h2><p id="desktop-preview-body"></p>' +
    '<progress id="desktop-preview-progress" max="1" hidden></progress><p id="desktop-preview-step" role="status" aria-live="polite"></p>' +
    '<div class="desktop-preview-links" id="desktop-preview-links"></div>' +
    '<div class="desktop-preview-actions"><button type="button" id="desktop-preview-later">Not now</button>' +
    '<button type="button" id="desktop-preview-secondary" hidden></button><button type="button" id="desktop-preview-primary"></button></div>';
  const consent = document.createElement("dialog");
  consent.id = "desktop-wolvenkit-consent";
  consent.setAttribute("aria-labelledby", "desktop-wolvenkit-title");
  consent.innerHTML = '<h2 id="desktop-wolvenkit-title"></h2><p id="desktop-wolvenkit-intro"></p><dl id="desktop-wolvenkit-facts"></dl>' +
    '<p id="desktop-wolvenkit-runtime" hidden></p><div class="desktop-preview-links" id="desktop-wolvenkit-links"></div>' +
    '<div class="desktop-preview-actions"><button type="button" id="desktop-wolvenkit-own">I already have WolvenKit</button>' +
    '<button type="button" id="desktop-wolvenkit-later">Not now</button><button type="button" id="desktop-wolvenkit-confirm"></button></div>';
  document.body.append(card, consent);
  const $ = (root, id) => root.querySelector(`#${id}`);
  const title = $(card, "desktop-preview-title"), body = $(card, "desktop-preview-body");
  const bar = $(card, "desktop-preview-progress"), step = $(card, "desktop-preview-step"), links = $(card, "desktop-preview-links");
  const primary = $(card, "desktop-preview-primary"), secondary = $(card, "desktop-preview-secondary"), later = $(card, "desktop-preview-later");
  const actions = createBrowserPreviewPreparation();
  const wolvenKit = createBrowserWolvenKitSetup("/api/desktop/wolvenkit");
  const detection = createBrowserInstallDetection();
  let detectedGame = null, detectionTried = false, dismissed = false, announcedReady = false, lastStatus = "", lastWolvenKit = null;
  const autostart = () => { try { return localStorage.getItem(AUTOSTART_KEY) !== "off"; } catch { return true; } };
  const setAutostart = on => { try { on ? localStorage.removeItem(AUTOSTART_KEY) : localStorage.setItem(AUTOSTART_KEY, "off"); } catch { /* Convenience only. */ } };
  let attempted = !autostart();

  async function detectGame() {
    if (detectionTried) return;
    detectionTried = true;
    const outcome = await detection.dispatch({ kind: "detect.gameInstalls" });
    const candidates = outcome.ok ? detection.snapshot().games?.candidates ?? [] : [];
    detectedGame = candidates.length === 1 ? candidates[0].root : null;
    render();
  }

  function linkButtons(root, items) {
    root.replaceChildren(...items.map(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => void host.openLink(item.link).catch(error => { step.textContent = error.message; }));
      return button;
    }));
  }

  function render() {
    const state = actions.snapshot();
    if (!state) return;
    if (state.phase === "ready") {
      card.hidden = true;
      if (!announcedReady) {
        announcedReady = true;
        document.documentElement.dataset.desktopPreviewAssets = "ready";
        window.dispatchEvent(new Event(PREVIEW_READY_EVENT));
      }
      return;
    }
    if (state.phase === "needs-setup" && state.needs.includes("game")) void detectGame();
    const view = previewView(state, detectedGame, wolvenKit.snapshot());
    const status = view.viewport;
    if (status !== lastStatus) {
      lastStatus = status;
      // Studio may subscribe later than the first report; it reads the latest status from here.
      document.documentElement.dataset.desktopPreviewStatus = status;
      window.dispatchEvent(new CustomEvent(PREVIEW_STATUS_EVENT, { detail: { message: status } }));
    }
    const busy = state.phase === "preparing" || ["downloading", "installing"].includes(wolvenKit.snapshot()?.phase);
    card.hidden = !view.visible || (dismissed && !busy);
    title.textContent = view.title;
    body.textContent = view.body;
    bar.hidden = view.progress === null;
    if (view.progress !== null) bar.value = view.progress;
    step.textContent = view.step ?? "";
    primary.hidden = !view.primary;
    primary.textContent = view.primary?.label ?? "";
    primary.dataset.action = view.primary?.action ?? "";
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
    $(consent, "desktop-wolvenkit-title").textContent = view.title;
    $(consent, "desktop-wolvenkit-intro").textContent = view.intro;
    $(consent, "desktop-wolvenkit-facts").replaceChildren(...view.facts.flatMap(fact => [
      Object.assign(document.createElement("dt"), { textContent: fact.label }),
      Object.assign(document.createElement("dd"), { textContent: fact.value })]));
    const runtime = $(consent, "desktop-wolvenkit-runtime");
    runtime.hidden = !view.runtimeNote;
    runtime.textContent = view.runtimeNote ?? "";
    linkButtons($(consent, "desktop-wolvenkit-links"), view.links);
    const confirm = $(consent, "desktop-wolvenkit-confirm");
    confirm.textContent = view.confirm;
    confirm.dataset.version = state.offer.version;
    consent.showModal();
    confirm.focus();
  }

  async function install(version) {
    setAutostart(true); dismissed = false;
    const outcome = await wolvenKit.dispatch({ kind: "wolvenkit.install", version });
    if (!outcome.ok) step.textContent = outcome.message;
  }

  async function run(action) {
    primary.disabled = secondary.disabled = true;
    try {
      if (action === "cancel") { setAutostart(false); await actions.dispatch({ kind: "preview.cancel" }); }
      else if (action === "setup") host.openSetup();
      else if (action === "use-game" && detectedGame) {
        await host.useGameFolder(detectedGame);
        await refreshAll();
      } else if (action === "prepare" || action === "retry") {
        setAutostart(true); attempted = true;
        const outcome = await actions.dispatch({ kind: "preview.prepare" });
        if (!outcome.ok) step.textContent = outcome.message;
      } else if (action === "wolvenkit-consent") openConsent();
      else if (action === "wolvenkit-retry") await install(wolvenKit.snapshot()?.offer.version);
      else if (action === "wolvenkit-cancel") await wolvenKit.dispatch({ kind: "wolvenkit.cancel" });
      else if (action === "wolvenkit-use-detected") {
        const found = wolvenKit.snapshot()?.detected;
        if (found) { await host.useWolvenKit(found.path); await refreshAll(); }
      } else if (action === "runtime-install") await host.openLink("runtime-installer");
      else if (action === "runtime-recheck") { await wolvenKit.dispatch({ kind: "wolvenkit.recheck" }); await refreshAll(); }
    } catch (error) { step.textContent = error?.message || "That didn't work. Try again."; }
    finally { primary.disabled = secondary.disabled = false; render(); }
  }
  async function maybeStart() {
    const state = actions.snapshot();
    if (state && shouldAutoStart(state, attempted)) {
      attempted = true;
      await actions.dispatch({ kind: "preview.prepare" });
    }
  }
  async function refreshAll() {
    await wolvenKit.dispatch({ kind: "wolvenkit.refresh" });
    await actions.dispatch({ kind: "preview.refresh" });
    await maybeStart();
  }
  primary.addEventListener("click", () => void run(primary.dataset.action));
  secondary.addEventListener("click", () => void run(secondary.dataset.action));
  later.addEventListener("click", () => { dismissed = true; card.hidden = true; });
  $(consent, "desktop-wolvenkit-later").addEventListener("click", () => consent.close());
  $(consent, "desktop-wolvenkit-own").addEventListener("click", () => { consent.close(); host.openSetup(); });
  $(consent, "desktop-wolvenkit-confirm").addEventListener("click", event => {
    consent.close();
    void install(event.currentTarget.dataset.version).finally(render);
  });
  actions.subscribe(render);
  wolvenKit.subscribe(() => {
    const phase = wolvenKit.snapshot()?.phase ?? null;
    // Once WolvenKit is ready (downloaded, or .NET installed), the preview can start.
    if (phase === "ready" && lastWolvenKit !== null && lastWolvenKit !== "ready") void actions.dispatch({ kind: "preview.refresh" }).then(maybeStart);
    lastWolvenKit = phase;
    render();
  });
  // After installing .NET in another window, coming back re-checks without a click.
  window.addEventListener("focus", () => { if (wolvenKit.snapshot()?.phase === "needs-runtime") void wolvenKit.dispatch({ kind: "wolvenkit.recheck" }); });
  // Build setup is where the game folder and a user's own WolvenKit live; re-check when it closes.
  document.getElementById("desktop-setup")?.addEventListener("close", () => void refreshAll());
  void refreshAll();
}
