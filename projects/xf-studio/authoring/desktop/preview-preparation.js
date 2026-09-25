// Desktop device UI for preparing the 3D head preview from the player's own Cyberpunk 2077
// files. The host owns the work, paths and cache; this card only shows its state, offers the
// one next step (use the detected game folder, open Build setup, start, cancel or retry) and
// tells Studio when the head can load. It is separate from the welcome and About dialogs.
import { createBrowserInstallDetection } from "../src/browser-install-detection-device";
import { createBrowserPreviewPreparation, PREVIEW_READY_EVENT, PREVIEW_STATUS_EVENT, previewView, shouldAutoStart } from "../src/preview-preparation";

const AUTOSTART_KEY = "xfs.preview.autostart";
const STYLE = `
#desktop-preview-card { position: fixed; z-index: 9990; left: 50%; bottom: 76px; transform: translateX(-50%);
  width: min(460px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px; display: grid; gap: 8px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  box-shadow: var(--shadow, 0 12px 34px #0008); font: 13px/1.5 "Segoe UI", sans-serif; }
#desktop-preview-card[hidden] { display: none; }
#desktop-preview-card h2 { margin: 0; font: 600 16px/1.3 "Bahnschrift", "Segoe UI", sans-serif; }
#desktop-preview-card p { margin: 0; overflow-wrap: anywhere; }
#desktop-preview-step { color: var(--text-muted, #b9c0c7); font-size: 12px; }
#desktop-preview-progress { width: 100%; height: 6px; accent-color: var(--accent, #f2db52); }
.desktop-preview-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.desktop-preview-actions button { padding: 6px 12px; color: var(--text, #f0f2f2); background: var(--bg-raised, #111820);
  border: 1px solid var(--line-strong, #59616b); font: inherit; }
#desktop-preview-primary { background: var(--accent, #f2db52); color: var(--accent-ink, #1d2023); font-weight: 600; }
`;

/**
 * @param {{ capabilities: { previewAssets: string }, openSetup: () => void,
 *   useGameFolder: (path: string) => Promise<void> }} host
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
    '<div class="desktop-preview-actions"><button type="button" id="desktop-preview-later">Not now</button>' +
    '<button type="button" id="desktop-preview-primary"></button></div>';
  document.body.append(card);
  const title = card.querySelector("#desktop-preview-title"), body = card.querySelector("#desktop-preview-body");
  const bar = card.querySelector("#desktop-preview-progress"), step = card.querySelector("#desktop-preview-step");
  const primary = card.querySelector("#desktop-preview-primary"), later = card.querySelector("#desktop-preview-later");
  const actions = createBrowserPreviewPreparation();
  const detection = createBrowserInstallDetection();
  let detectedGame = null, detectionTried = false, dismissed = false, announcedReady = false, lastStatus = "";
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
    const view = previewView(state, detectedGame);
    const status = view.viewport;
    if (status !== lastStatus) {
      lastStatus = status;
      // Studio may subscribe later than the first report; it reads the latest status from here.
      document.documentElement.dataset.desktopPreviewStatus = status;
      window.dispatchEvent(new CustomEvent(PREVIEW_STATUS_EVENT, { detail: { message: status } }));
    }
    card.hidden = !view.visible || (dismissed && state.phase !== "preparing");
    title.textContent = view.title;
    body.textContent = view.body;
    bar.hidden = view.progress === null;
    if (view.progress !== null) bar.value = view.progress;
    step.textContent = view.step ?? "";
    primary.hidden = !view.primary;
    primary.textContent = view.primary?.label ?? "";
    primary.dataset.action = view.primary?.action ?? "";
    later.hidden = state.phase === "preparing";
  }

  async function run(action) {
    primary.disabled = true;
    try {
      if (action === "cancel") { setAutostart(false); await actions.dispatch({ kind: "preview.cancel" }); }
      else if (action === "setup") host.openSetup();
      else if (action === "use-game" && detectedGame) {
        await host.useGameFolder(detectedGame);
        await actions.dispatch({ kind: "preview.refresh" });
        await maybeStart();
      } else if (action === "prepare" || action === "retry") {
        setAutostart(true); attempted = true;
        const outcome = await actions.dispatch({ kind: "preview.prepare" });
        if (!outcome.ok) step.textContent = outcome.message;
      }
    } catch (error) { step.textContent = error?.message || "That didn't work. Try again."; }
    finally { primary.disabled = false; render(); }
  }
  async function maybeStart() {
    const state = actions.snapshot();
    if (state && shouldAutoStart(state, attempted)) {
      attempted = true;
      await actions.dispatch({ kind: "preview.prepare" });
    }
  }
  primary.addEventListener("click", () => void run(primary.dataset.action));
  later.addEventListener("click", () => { dismissed = true; card.hidden = true; });
  actions.subscribe(render);
  // Build setup is where the game folder and WolvenKit live; re-check when it closes.
  document.getElementById("desktop-setup")?.addEventListener("close", () => void actions.dispatch({ kind: "preview.refresh" }).then(maybeStart));
  void actions.dispatch({ kind: "preview.refresh" }).then(maybeStart);
}
