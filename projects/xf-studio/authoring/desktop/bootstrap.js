// This device bootstrap is intentionally outside shared Studio presentation.
// It adds the desktop first-run welcome, About (version, licences, updates; opened
// from the Studio's Help panel and command palette), the host-owned workspace storage,
// and then starts the shared Studio composition root (`src/studio-startup.ts`) with
// those desktop host services. Settings have one form, the Studio's Game & tools (UI-03).
import { createBrowserLocalSetup, desktopFolderPicker } from "../src/browser-local-setup-device";
import { createBrowserPreviewPreparation } from "../src/preview-preparation";
import { createBrowserWolvenKitSetup } from "../src/wolvenkit-setup";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";
const capabilities = await fetch("/api/desktop/capabilities").then(response => response.json());
if (capabilities.schema !== "xfs/desktop-capabilities-1") throw Error("Desktop host capabilities are unavailable.");
// The loopback port changes on each launch, so WebView localStorage alone does
// not survive a full desktop restart. Load the host-owned draft before Studio
// constructs its services; keep the browser copy for same-process reloads.
const verification = new URLSearchParams(location.search).has("verify");
const workspaceKey = verification ? "xfas.workspace.verification.v1" : "xfas.workspace.v1";
const workspaceEndpoint = `/api/desktop/workspace${verification ? "?verify=1" : ""}`;
const workspaceAlert = message => {
  let alert = document.getElementById("desktop-workspace-error");
  if (!message) { alert?.remove(); return; }
  if (!alert) {
    alert = document.createElement("p");
    alert.id = "desktop-workspace-error";
    alert.setAttribute("role", "alert");
    document.body.append(alert);
  }
  alert.textContent = message;
};
// Installed before anything can fail, so the host's close handshake always gets an answer.
window.xfDesktopWorkspaceError = workspaceAlert;
window.xfDesktopWorkspaceFlush = async () => {};
const workspaceResponse = await fetch(workspaceEndpoint, { cache: "no-store" });
if (!workspaceResponse.ok) {
  // A damaged workspace, or one written by a newer XF Studio, must never brick the app.
  let kept = "";
  try { kept = (await workspaceResponse.json()).file ?? ""; } catch { /* Plain error. */ }
  const root = document.getElementById("studio");
  const box = document.createElement("div");
  box.className = "boot-failed";
  box.setAttribute("role", "alert");
  box.style.cssText = "display:grid;justify-items:start;gap:12px;max-width:560px;margin:15vh auto;padding:24px;" +
    "font:14px/1.5 'Segoe UI',sans-serif;text-transform:none;letter-spacing:normal;color:#f0f2f2;background:#20272f;border:1px solid #59616b";
  const title = Object.assign(document.createElement("strong"), { textContent: "Your last session couldn't be opened." });
  const text = Object.assign(document.createElement("p"), { textContent:
    "XF Studio's saved workspace is damaged or was written by a newer version, so nothing was changed. " +
    "Start fresh to continue: the old workspace file is kept beside it, and your saved library is not affected." });
  const status = Object.assign(document.createElement("p"), { textContent: kept ? `Saved workspace file: ${kept}` : "" });
  const fresh = Object.assign(document.createElement("button"), { type: "button", textContent: "Start fresh" });
  fresh.onclick = async () => {
    fresh.disabled = true;
    const response = await fetch(`/api/desktop/workspace/start-fresh${verification ? "?verify=1" : ""}`, { method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (response.ok) {
      const { keptAs } = await response.json();
      try { localStorage.removeItem(workspaceKey); } catch { /* Storage unavailable. */ }
      status.textContent = `Your old workspace was kept as ${keptAs}. Starting fresh…`;
      location.reload();
    } else { status.textContent = "XF Studio couldn't set the old workspace aside. Restart XF Studio and try again."; fresh.disabled = false; }
  };
  box.append(title, text, status, fresh);
  root?.removeAttribute("aria-busy");
  root?.replaceChildren(box);
  throw Error("Saved desktop workspace is unreadable; waiting for the user to start fresh.");
}
const workspaceDocument = await workspaceResponse.json();
if (workspaceDocument.schema !== "xfs/desktop-workspace-1" ||
    (workspaceDocument.workspace !== null && typeof workspaceDocument.workspace !== "string"))
  throw Error("Desktop workspace response is invalid.");
let localCopy = null;
try { localCopy = localStorage.getItem(workspaceKey); } catch { /* Storage unavailable. */ }
let workspaceText = workspaceDocument.workspace ?? localCopy;
// Autosave: at most one host write in flight; the newest draft wins. The host file is the
// source of truth on desktop, so browser storage failures never block it.
let pendingText = null, inFlight = null, lastSaveFailed = false;
const SAVE_FAILED = "Your latest changes could not be saved. Keep this window open and export your collection from the Library panel.";
async function postWorkspace(text, headers = {}) {
  const response = await fetch(workspaceEndpoint, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ workspace: text }),
    keepalive: new TextEncoder().encode(text).length < 60_000 });
  if (!response.ok) throw Error(SAVE_FAILED);
}
function saveWorkspace(text) {
  pendingText = text;
  if (!inFlight) inFlight = (async () => {
    while (pendingText !== null) {
      const next = pendingText; pendingText = null;
      try { await postWorkspace(next); lastSaveFailed = false; workspaceAlert(""); }
      catch (error) { lastSaveFailed = true; workspaceAlert(error.message); }
    }
    inFlight = null;
  })();
  return inFlight;
}
window.xfDesktopWorkspaceFlush = async updateNonce => {
  window.dispatchEvent(new Event("xfs-desktop-close-flush"));
  if (inFlight) await inFlight;
  if (lastSaveFailed && workspaceText !== null) await saveWorkspace(workspaceText);
  if (lastSaveFailed) throw Error(SAVE_FAILED);
  if (updateNonce !== undefined) {
    if (typeof updateNonce !== "string" || !/^[0-9a-f-]{36}$/.test(updateNonce) || workspaceText === null)
      throw Error("The update workspace snapshot is unavailable.");
    await postWorkspace(workspaceText, { "X-XFS-Update-Flush": updateNonce }).catch(() => {
      throw Error("The update workspace snapshot could not be saved.");
    });
  }
};
const workspaceStorage = {
  getItem(key) {
    if (key === workspaceKey) return workspaceText;
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    if (key === workspaceKey) { workspaceText = value; saveWorkspace(value); }
    // Same-process reload convenience only; a full or blocked browser store is not an error here.
    try { localStorage.setItem(key, value); } catch { /* The host file already has it. */ }
  },
};
if (workspaceDocument.workspace === null && workspaceText !== null) saveWorkspace(workspaceText);
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/about.css";
document.head.append(stylesheet);
// About has no button of its own over the panels (UI-87): the Studio offers it in its Help panel and command palette.
const about = document.createElement("dialog");
about.id = "desktop-about";
about.setAttribute("aria-labelledby", "desktop-about-title");
about.innerHTML = '<h2 id="desktop-about-title">About XF Studio</h2><p>Customise Cyberpunk 2077. Eye makeup is the first supported feature.</p><p id="desktop-version"></p><p id="desktop-build"></p><p id="desktop-preview-note"></p><p>Your library and settings are saved in:</p><code id="desktop-data-path"></code><p id="desktop-setup-readiness"></p><p id="desktop-wolvenkit-note"></p><p id="desktop-update" role="status"></p><div id="desktop-update-actions" hidden><button type="button" data-update-action="check">Check for an update</button><button type="button" data-update-action="download">Download the update</button><button type="button" data-update-action="applyAndRestart">Restart to update…</button></div><div id="desktop-update-confirm" class="desktop-update-confirm" role="group" aria-labelledby="desktop-update-confirm-text" hidden><p id="desktop-update-confirm-text">Restart XF Studio now to finish updating? Your work is saved first.</p><button type="button" id="desktop-update-restart">Restart now</button><button type="button" id="desktop-update-later">Not now</button></div><div class="desktop-about-actions"><button id="desktop-setup-open" type="button">Game &amp; tools</button><button id="desktop-licences-open" type="button">Licences</button><button id="desktop-wolvenkit-licence" type="button">WolvenKit licence</button></div><form method="dialog"><button type="submit">Close</button></form>';
about.querySelector("#desktop-version").textContent = capabilities.metadataStatus === "ready" ?
  `Version ${capabilities.version}` : "Installed version unavailable";
about.querySelector("#desktop-build").textContent = capabilities.metadataStatus === "ready" ?
  `Build ${capabilities.buildHash}` : "This installation looks damaged. Reinstall XF Studio to repair it.";
about.querySelector("#desktop-preview-note").textContent = capabilities.previewAssets === "ready" ? "" :
  "The 3D head preview is built from your own Cyberpunk 2077 files. The UV editor, library and Check work without it.";
about.querySelector("#desktop-data-path").textContent = capabilities.userDataPath;
// WolvenKit is a separate program XF Studio downloads (with consent) and runs; it is not shipped.
async function openLink(link) {
  const response = await fetch("/api/desktop/open-link", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link }) });
  if (!response.ok) throw Error("XF Studio couldn't open that page in your browser. Try again.");
}
const wolvenKitNote = about.querySelector("#desktop-wolvenkit-note");
async function refreshWolvenKitNote() {
  let status = "";
  try {
    const state = await fetch("/api/desktop/wolvenkit", { cache: "no-store" }).then(response => response.json());
    if (state.schema === "xfs/wolvenkit-setup-1") status = ` ${state.message}`;
  } catch { /* The note still explains the tool. */ }
  wolvenKitNote.textContent = "The 3D preview and Build use WolvenKit CLI, a separate free program (GPL-3.0) by the WolvenKit team. " +
    "XF Studio downloads it from WolvenKit's official release only when you allow it; it isn't part of XF Studio." + status;
}
about.querySelector("#desktop-wolvenkit-licence").addEventListener("click", () => void openLink("wolvenkit-licence").catch(error => {
  wolvenKitNote.textContent = error.message; }));
const updateStatus = about.querySelector("#desktop-update");
const updateActions = about.querySelector("#desktop-update-actions");
const updateConfirm = about.querySelector("#desktop-update-confirm");
async function refreshUpdate() {
  try {
    const response = await fetch("/api/desktop/update");
    if (!response.ok) throw Error("Update state unavailable.");
    showUpdate(await response.json());
  } catch { updateStatus.textContent = "XF Studio couldn't check its update state. Restart XF Studio and try again."; }
}
/** The update state in plain words (UI-97): what it is, and what to do next. Build hashes and phase names stay out of it. */
function updateLine(state) {
  const next = state.available?.version;
  switch (state.phase) {
    case "unavailable": return state.reason || "Automatic updates are off. Download new versions from the XF Studio releases page on GitHub.";
    case "idle": return `You have XF Studio ${state.installed.version}. Check for an update whenever you like.`;
    case "checking": return "Checking for an update…";
    case "available": return `XF Studio ${next} is available. Download it when you're ready; nothing changes until you restart.`;
    case "downloading": return `Downloading XF Studio ${next}…`;
    case "ready": return `XF Studio ${next} is downloaded. Restart to finish updating; your work is saved first.`;
    case "applying": return "Restarting to finish the update…";
    default: return "The update didn't work, and nothing changed. Try again later, or download it from the XF Studio releases page on GitHub.";
  }
}
function showUpdate(state) {
  updateStatus.textContent = updateLine(state);
  updateActions.hidden = state.phase === "unavailable";
  if (state.phase !== "ready") updateConfirm.hidden = true;
  for (const button of updateActions.querySelectorAll("button")) {
    button.disabled = button.dataset.updateAction === "check" ? !state.canCheck :
      button.dataset.updateAction === "download" ? !state.canDownload : !state.canApplyAndRestart;
  }
}
async function updateAction(action) {
  updateConfirm.hidden = true;
  updateStatus.textContent = action === "check" ? "Checking for an update…" :
    action === "download" ? "Downloading the update…" : "Saving your work and restarting…";
  for (const item of updateActions.querySelectorAll("button")) item.disabled = true;
  try {
    const response = await fetch("/api/desktop/update", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "xfs/desktop-update-action-1", action }) });
    if (!response.ok) throw Error("Update action was refused.");
    showUpdate(await response.json());
  } catch { await refreshUpdate(); }
}
// Restarting asks first, inside About itself (no browser prompt; UI-97).
for (const button of updateActions.querySelectorAll("button")) button.addEventListener("click", () => {
  const action = button.dataset.updateAction;
  if (action === "applyAndRestart") { updateConfirm.hidden = false; about.querySelector("#desktop-update-restart").focus(); return; }
  void updateAction(action);
});
about.querySelector("#desktop-update-restart").addEventListener("click", () => void updateAction("applyAndRestart"));
about.querySelector("#desktop-update-later").addEventListener("click", () => {
  updateConfirm.hidden = true; updateActions.querySelector('[data-update-action="applyAndRestart"]').focus();
});
const licences = document.createElement("dialog");
licences.id = "desktop-licences";
licences.innerHTML = '<h2>Licences</h2><p>XF Studio is free software under the MIT licence. It includes third-party software, whose notices and licences are listed here.</p><div class="desktop-about-actions" role="group" aria-label="Licence document"><button type="button" data-licence-doc="LICENSE.txt" aria-pressed="true">XF Studio licence</button><button type="button" data-licence-doc="THIRD_PARTY_NOTICES.md" aria-pressed="false">Third-party notices</button></div><pre id="desktop-licence-text" tabindex="0"></pre><form method="dialog"><button type="submit">Close</button></form>';
const licenceText = licences.querySelector("#desktop-licence-text");
async function showLicence(name) {
  for (const item of licences.querySelectorAll("[data-licence-doc]"))
    item.setAttribute("aria-pressed", String(item.dataset.licenceDoc === name));
  licenceText.textContent = "Loading…";
  try {
    const response = await fetch(`/${name}`, { cache: "no-store" });
    if (!response.ok) throw Error();
    licenceText.textContent = await response.text();
  } catch { licenceText.textContent = "This document is missing from the installation. Reinstall XF Studio, or read it on the project's GitHub page."; }
}
for (const item of licences.querySelectorAll("[data-licence-doc]"))
  item.addEventListener("click", () => void showLicence(item.dataset.licenceDoc));
about.querySelector("#desktop-licences-open").addEventListener("click", () => {
  about.close(); licences.showModal(); void showLicence("LICENSE.txt");
});
document.body.append(about, licences);
function openAbout() {
  if (!about.open) about.showModal();
  void refreshUpdate(); void refreshWolvenKitNote();
  void setupAction({ kind: "setup.refresh" }).catch(() => {});
}
// Developer and review tools reach About the way the Studio does.
window.xfDesktopOpenAbout = openAbout;
const welcome = document.createElement("dialog");
welcome.id = "desktop-welcome";
welcome.innerHTML = '<div class="desktop-first-run"><span class="brand-mark" aria-hidden="true">XF</span><h1>Welcome to XF Studio</h1><p>XF Studio customises Cyberpunk 2077. Eye makeup is the first supported feature: design looks in layers, keep them in your library, and run Check to see which can become mod files.</p><p>The 3D head preview is built from your own Cyberpunk 2077 files the first time you open XF Studio. It changes nothing in your game. The UV editor, library and Check work fully without it.</p><p>Once the 3D preview is set up, you can also build your ' + EYE_MAKEUP_MOD.modName + ' mod files and add them to your mod manager. XF Studio asks before it downloads or installs anything.</p><p id="desktop-welcome-status" role="status"></p><div class="desktop-intake-actions"><button type="button" id="desktop-welcome-start">Start designing</button><button type="button" id="desktop-welcome-setup">Game &amp; tools</button></div></div>';
document.body.append(welcome);
const aboutReadiness = about.querySelector("#desktop-setup-readiness");
// One settings service and one form (the Studio's Game & tools, UI-03), with the desktop's own folder picker (UI-83).
const setupActions = createBrowserLocalSetup({ pickFolder: desktopFolderPicker, verification });
let setupView;
function showSetup(view) {
  setupView = view;
  const recovery = view.source === "backup";
  aboutReadiness.textContent = recovery ? "Your settings file is damaged: open Game & tools to restore the previous copy." :
    view.readiness.build.ready ? "Check is ready, and Build is set up." :
      `Check is ready. To build your mod files: ${view.readiness.build.issues[0]?.reason ?? "open Game & tools."}`;
}
async function setupAction(action) {
  // The Studio shares this settings service; wait for its own refresh rather than being refused as busy.
  await setupActions.idle();
  const result = await setupActions.dispatch(action);
  if (!result.ok) throw Error(result.message);
  showSetup(setupActions.snapshot().view);
}
// Game & tools lives in the Studio's Mod package panel; asked for before the Studio is up, it opens as soon as it is.
let studio = null, setupWanted = false;
function openGameSetup() {
  if (about.open) about.close();
  if (studio) studio.openGameSetup(); else setupWanted = true;
}
about.querySelector("#desktop-setup-open").addEventListener("click", openGameSetup);
// Starting to design stores the untouched defaults through the same validated action, so
// the welcome does not return on every launch; Check never needs these paths.
async function deferBuildSetup() {
  if (setupView?.source !== "new") return;
  await setupAction({ kind: "setup.save", fields: setupView.fields });
}
const welcomeStart = welcome.querySelector("#desktop-welcome-start");
welcomeStart.addEventListener("click", async () => {
  welcomeStart.disabled = true;
  try { await initialSetup.catch(() => {}); await deferBuildSetup(); welcome.close(); }
  catch (error) { welcome.querySelector("#desktop-welcome-status").textContent = error.message; }
  finally { welcomeStart.disabled = false; }
});
welcome.querySelector("#desktop-welcome-setup").addEventListener("click", async () => {
  await initialSetup.catch(() => {});
  try { await deferBuildSetup(); } catch { /* Game & tools says what is wrong. */ }
  welcome.close(); openGameSetup();
});
const initialSetup = setupAction({ kind: "setup.refresh" });
void initialSetup.then(() => {
  // A fresh install gets the plain-language welcome; damaged settings open Game & tools, which
  // offers to restore them. Everyone else reaches Game & tools from Mod package or About.
  if (setupView?.source === "new") welcome.showModal();
  else if (setupView?.source === "backup") openGameSetup();
}).catch(() => { aboutReadiness.textContent = "Your settings couldn't be loaded. Check still works; restart XF Studio to try again."; });
// About's readiness line follows every change Game & tools saves.
setupActions.subscribe(() => { const view = setupActions.snapshot().view; if (view) showSetup(view); });
let previewReady = false;
let flushRequest = null;
window.addEventListener("xfs-desktop-close-flush", () => flushRequest?.());
void import("/build/studio-startup.js").then(({ startStudio }) => startStudio({
  storage: workspaceStorage,
  // The desktop host file (16 MB limit) holds more than browser storage.
  storageBudget: 12_000_000,
  previewPreparation: createBrowserPreviewPreparation("/api/desktop/preview"),
  wolvenKitSetup: createBrowserWolvenKitSetup("/api/desktop/wolvenkit"),
  localSetup: setupActions,
  openLink,
  setupPlace: "Game & tools",
  about: openAbout,
  onMounted: shell => { studio = shell; if (setupWanted) { setupWanted = false; shell.openGameSetup(); } },
  onFlushRequest: flush => { flushRequest = flush; },
  onPreviewReady: () => { previewReady = true; },
})).catch(() => {
    const root = document.getElementById("studio");
    root.removeAttribute("aria-busy");
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
      textContent: "XF Studio desktop could not load its editor. Restart XF Studio and retry." }));
    console.error("XF desktop editor import failed");
});
const report = () => {
  const studio = document.getElementById("studio");
  if (studio?.classList.contains("studio-ready")) studio.removeAttribute("aria-busy");
  let webgl2 = false;
  try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch { /* Missing GPU. */ }
  let worker = false;
  try { const probe = new Worker("/build/raster-worker.js", { type: "module" }); worker = true; probe.terminate(); }
  catch { /* Missing worker support. */ }
  const state = document.querySelector(".boot-error") ? "error" :
    studio?.classList.contains("studio-ready") ? previewReady ? "interactive" : "uv-only" : "starting";
  void fetch("/api/desktop/smoke", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema: "xfs/desktop-smoke-1", state, webgl2, worker }) });
};
setTimeout(report, 3000);
setTimeout(report, 12000);
