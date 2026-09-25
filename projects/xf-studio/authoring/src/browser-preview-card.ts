/**
 * Device card for preparing the 3D head preview from the player's own Cyberpunk 2077 files,
 * shown on both hosts while the preview isn't ready. The host owns the work, paths and cache;
 * this card only shows the preparation state and offers the one next step (use the detected
 * game folder, open the host's setup, start, cancel or retry). It starts preparation by itself
 * on first contact when nothing is missing, unless the viewer cancelled a run. The Studio
 * composition root follows the same actions to load the head; the card never touches it.
 */
import type { InstallDetectionActions } from "./install-detection-actions";
import { previewView, shouldAutoStart, type PreviewPreparationActions } from "./preview-preparation";

const AUTOSTART_KEY = "xfs.preview.autostart";
const STYLE = `
#preview-card { position: fixed; z-index: 9990; left: 50%; bottom: 76px; transform: translateX(-50%);
  width: min(460px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px 18px; display: grid; gap: 8px;
  color: var(--text, #f0f2f2); background: var(--bg-panel, #20272f); border: 1px solid var(--line-strong, #59616b);
  box-shadow: var(--shadow, 0 12px 34px #0008); font: 13px/1.5 "Segoe UI", sans-serif; }
#preview-card[hidden] { display: none; }
#preview-card h2 { margin: 0; font: 600 16px/1.3 "Bahnschrift", "Segoe UI", sans-serif; }
#preview-card p { margin: 0; overflow-wrap: anywhere; }
#preview-card-step { color: var(--text-muted, #b9c0c7); font-size: 12px; }
#preview-card-progress { width: 100%; height: 6px; accent-color: var(--accent, #f2db52); }
.preview-card-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.preview-card-actions button { padding: 6px 12px; color: var(--text, #f0f2f2); background: var(--bg-raised, #111820);
  border: 1px solid var(--line-strong, #59616b); font: inherit; }
#preview-card-primary { background: var(--accent, #f2db52); color: var(--accent-ink, #1d2023); font-weight: 600; }
`;

export type PreviewCardOptions = {
  document: Document;
  /** Per-viewer convenience only (the automatic-start preference); may be unavailable. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  actions: PreviewPreparationActions;
  detection: Pick<InstallDetectionActions, "dispatch" | "snapshot">;
  /** Where the game folder and WolvenKit CLI are set, in the host's own words. */
  setupPlace: string;
  /** Opens the host's setup form; without it the card names `setupPlace` instead. */
  openSetup?: () => void;
  /** Saves a detected game folder through the host's settings. */
  useGameFolder(path: string): Promise<void>;
};

export function mountPreviewCard(options: PreviewCardOptions) {
  const { document: doc, actions } = options;
  const style = doc.createElement("style");
  style.textContent = STYLE;
  doc.head.append(style);
  const card = doc.createElement("section");
  card.id = "preview-card";
  card.setAttribute("aria-label", "3D preview");
  card.hidden = true;
  card.innerHTML = '<h2 id="preview-card-title"></h2><p id="preview-card-body"></p>' +
    '<progress id="preview-card-progress" max="1" hidden></progress><p id="preview-card-step" role="status" aria-live="polite"></p>' +
    '<div class="preview-card-actions"><button type="button" id="preview-card-later">Not now</button>' +
    '<button type="button" id="preview-card-primary"></button></div>';
  doc.body.append(card);
  const part = <T extends HTMLElement>(id: string) => card.querySelector(`#${id}`) as T;
  const title = part("preview-card-title"), body = part("preview-card-body");
  const bar = part<HTMLProgressElement>("preview-card-progress"), step = part("preview-card-step");
  const primary = part<HTMLButtonElement>("preview-card-primary"), later = part<HTMLButtonElement>("preview-card-later");
  let detectedGame: string | null = null, detectionTried = false, dismissed = false;
  const autostart = () => { try { return options.storage?.getItem(AUTOSTART_KEY) !== "off"; } catch { return true; } };
  const setAutostart = (on: boolean) => {
    try { if (on) options.storage?.removeItem(AUTOSTART_KEY); else options.storage?.setItem(AUTOSTART_KEY, "off"); }
    catch { /* Convenience only. */ }
  };
  let attempted = !autostart();

  async function detectGame() {
    if (detectionTried) return;
    detectionTried = true;
    const outcome = await options.detection.dispatch({ kind: "detect.gameInstalls" });
    const candidates = outcome.ok ? options.detection.snapshot().games?.candidates ?? [] : [];
    detectedGame = candidates.length === 1 ? candidates[0]!.root : null;
    render();
  }

  function render() {
    const state = actions.snapshot();
    if (!state) return;
    if (state.phase === "ready") { card.hidden = true; return; }
    if (state.phase === "needs-setup" && state.needs.includes("game")) void detectGame();
    const view = previewView(state, detectedGame, options.setupPlace);
    card.hidden = !view.visible || (dismissed && state.phase !== "preparing");
    title.textContent = view.title;
    body.textContent = view.body;
    bar.hidden = view.progress === null;
    if (view.progress !== null) bar.value = view.progress;
    // Without a host setup form, the Studio's own panel is where the paths go.
    const setupElsewhere = view.primary?.action === "setup" && !options.openSetup;
    step.textContent = view.step ?? (setupElsewhere ? `Set it in ${options.setupPlace}.` : "");
    primary.hidden = !view.primary || setupElsewhere;
    primary.textContent = view.primary?.label ?? "";
    primary.dataset.action = view.primary?.action ?? "";
    later.hidden = state.phase === "preparing";
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
    await actions.dispatch({ kind: "preview.refresh" });
    await maybeStart();
  }

  async function run(action: string | undefined) {
    primary.disabled = true;
    try {
      if (action === "cancel") { setAutostart(false); await actions.dispatch({ kind: "preview.cancel" }); }
      else if (action === "setup") options.openSetup?.();
      else if (action === "use-game" && detectedGame) {
        await options.useGameFolder(detectedGame);
        await refresh();
      } else if (action === "prepare" || action === "retry") {
        setAutostart(true); attempted = true;
        const outcome = await actions.dispatch({ kind: "preview.prepare" });
        if (!outcome.ok) step.textContent = outcome.message;
      }
    } catch (error) { step.textContent = (error as Error)?.message || "That didn't work. Try again."; }
    finally { primary.disabled = false; render(); }
  }
  primary.addEventListener("click", () => void run(primary.dataset.action));
  later.addEventListener("click", () => { dismissed = true; card.hidden = true; });
  actions.subscribe(render);
  void refresh();
  return { refresh };
}
