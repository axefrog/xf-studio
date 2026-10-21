/**
 * Localhost entry for the XF Studio page: the shared composition root with the host's workspace file and
 * the local server's 3D preview preparation. The desktop bootstrap starts the same root with its
 * own host services instead of loading this entry.
 */
import { LOCALHOST_SETUP_PLACE } from "./alpha-availability";
import { createBrowserPreviewPreparation } from "./preview-preparation";
import { startStudio } from "./studio-startup";
import { createBrowserDesktopApp } from "./browser-desktop-app-device";
import { createBrowserWolvenKitSetup } from "./wolvenkit-setup";
import { browserExperiments } from "./compose/experiments";
import { openHostWorkspace, startFreshWorkspace } from "./host-workspace-device";
import { workspaceKeys } from "./workspace-state";
import { showWorkspaceUnreadable } from "./studio-ui/workspace-unreadable";

const verification = new URLSearchParams(location.search).has("verify");
let browser: Storage | null = null, session: Storage | null = null;
try { browser = localStorage; session = sessionStorage; } catch { /* Browser storage blocked: the host file still keeps the workspace. */ }
// The draft is loaded (with any journalled draft the host lacks, and an earlier build's browser draft, handed over) before the
// Studio builds its services.
const opening = await openHostWorkspace({ fetch: (input, init) => fetch(input, init), verification, key: workspaceKeys(verification).workspace,
  browser, session, locks: navigator.locks ?? null }).catch(() => null);
if (!opening) {
  const root = document.getElementById("studio")!;
  root.removeAttribute("aria-busy");
  root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
    textContent: "XF Studio couldn't load its saved workspace. Check that the local server is running, then reload the page." }));
} else if (!opening.ok) {
  // A damaged workspace, or one written by a newer XF Studio, must never brick the page.
  showWorkspaceUnreadable(document.getElementById("studio")!, { file: opening.file, startFresh: () => startFreshWorkspace(fetch, verification),
    reload: () => location.reload() });
} else {
  const { workspace } = opening;
  void startStudio({
    storage: workspace.storage,
    experiments: (verification, signal) => browserExperiments(location.search, fetch, signal, verification),
    previewPreparation: createBrowserPreviewPreparation("/api/preview-core"),
    wolvenKitSetup: createBrowserWolvenKitSetup("/api/wolvenkit"),
    setupPlace: LOCALHOST_SETUP_PLACE,
    // Localhost-only: offer the desktop app (a verification workspace checks it too, but never starts anything).
    desktopApp: createBrowserDesktopApp(verification ? "/api/verification/desktop-app" : "/api/desktop-app"),
  });
}
