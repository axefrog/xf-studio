// This device bootstrap is intentionally outside shared Studio presentation.
// It adds the desktop first-run welcome, About (version, licences, build setup),
// the host-owned workspace storage, and then starts the shared Studio composition
// root (`src/studio-startup.ts`) with those desktop host services.
import { createBrowserLocalSetup } from "../src/browser-local-setup-device";
import { createBrowserPreviewPreparation } from "../src/preview-preparation";
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
const aboutButton = document.createElement("button");
aboutButton.id = "desktop-about-open";
aboutButton.type = "button";
aboutButton.textContent = "About";
aboutButton.setAttribute("aria-label", "About XF Studio");
const about = document.createElement("dialog");
about.id = "desktop-about";
about.innerHTML = '<h2>About XF Studio</h2><p>Customise Cyberpunk 2077. Eye makeup is the first supported feature.</p><p id="desktop-version"></p><p id="desktop-build"></p><p id="desktop-preview-note"></p><p>Your library and settings are saved in:</p><code id="desktop-data-path"></code><p id="desktop-setup-readiness"></p><p id="desktop-update" role="status"></p><div id="desktop-update-actions" hidden><button type="button" data-update-action="check">Check for update</button><button type="button" data-update-action="download">Download update</button><button type="button" data-update-action="applyAndRestart">Apply and restart</button></div><div class="desktop-about-actions"><button id="desktop-setup-open" type="button">Build setup</button><button id="desktop-licences-open" type="button">Licences</button></div><form method="dialog"><button type="submit">Close</button></form>';
about.querySelector("#desktop-version").textContent = capabilities.metadataStatus === "ready" ?
  `Version ${capabilities.version}` : "Installed version unavailable";
about.querySelector("#desktop-build").textContent = capabilities.metadataStatus === "ready" ?
  `Build ${capabilities.buildHash}` : "This installation looks damaged. Reinstall XF Studio to repair it.";
about.querySelector("#desktop-preview-note").textContent = capabilities.previewAssets === "ready" ? "" :
  "The 3D head preview is built from your own Cyberpunk 2077 files. The UV editor, library and Check work without it.";
about.querySelector("#desktop-data-path").textContent = capabilities.userDataPath;
const updateStatus = about.querySelector("#desktop-update");
const updateActions = about.querySelector("#desktop-update-actions");
async function refreshUpdate() {
  try {
    const response = await fetch("/api/desktop/update");
    if (!response.ok) throw Error("Update state unavailable.");
    showUpdate(await response.json());
  } catch { updateStatus.textContent = "Update state unavailable. Restart XF Studio and retry."; }
}
function showUpdate(state) {
  updateStatus.textContent = state.phase === "unavailable" ? state.reason :
    state.available ? `${state.phase}: ${state.available.version} (${state.available.buildHash})` :
    state.phase === "idle" ? "No update is currently selected. Check only when you choose to." :
    state.reason || `Update ${state.phase}.`;
  updateActions.hidden = state.phase === "unavailable";
  for (const button of updateActions.querySelectorAll("button")) {
    button.disabled = button.dataset.updateAction === "check" ? !state.canCheck :
      button.dataset.updateAction === "download" ? !state.canDownload : !state.canApplyAndRestart;
  }
}
for (const button of updateActions.querySelectorAll("button")) button.addEventListener("click", async () => {
  const action = button.dataset.updateAction;
  if (action === "applyAndRestart" && !confirm("Apply the downloaded XF Studio update and restart now?")) return;
  updateStatus.textContent = action === "check" ? "Checking for an update…" :
    action === "download" ? "Downloading update…" : "Applying update and restarting…";
  for (const item of updateActions.querySelectorAll("button")) item.disabled = true;
  try {
    const response = await fetch("/api/desktop/update", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "xfs/desktop-update-action-1", action }) });
    if (!response.ok) throw Error("Update action was refused.");
    showUpdate(await response.json());
  } catch { await refreshUpdate(); }
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
document.body.append(aboutButton, about, licences);
aboutButton.addEventListener("click", () => { about.showModal(); void refreshUpdate(); });
const setup = document.createElement("dialog");
setup.id = "desktop-setup";
setup.innerHTML = '<h2>Build setup</h2><p>Building the ' + EYE_MAKEUP_MOD.modName + ' mod files needs your game folder and the WolvenKit CLI. You don&#39;t need any of this to design looks or run Check. These paths stay on this computer, and you can change them any time from About.</p><form id="desktop-setup-form"><div id="desktop-setup-fields"></div><p id="desktop-setup-status" role="status"></p><div class="desktop-setup-actions"><button type="button" id="desktop-setup-restore" hidden>Restore previous settings</button><button type="button" id="desktop-setup-defer" hidden>Skip for now</button><button type="submit" id="desktop-setup-save">Save</button><button type="button" id="desktop-setup-close">Close</button></div></form>';
const welcome = document.createElement("dialog");
welcome.id = "desktop-welcome";
welcome.innerHTML = '<div class="desktop-first-run"><span class="brand-mark" aria-hidden="true">XF</span><h1>Welcome to XF Studio</h1><p>XF Studio customises Cyberpunk 2077. Eye makeup is the first supported feature: design looks in layers, keep them in your library, and run Check to see which can become mod files.</p><p>The 3D head preview is built from your own Cyberpunk 2077 files the first time you open XF Studio. It changes nothing in your game. The UV editor, library and Check work fully without it.</p><p>Building the ' + EYE_MAKEUP_MOD.modName + ' mod files needs your game folder and the WolvenKit CLI. You can set them up later under About → Build setup.</p><p id="desktop-welcome-status" role="status"></p><div class="desktop-intake-actions"><button type="button" id="desktop-welcome-start">Start designing</button><button type="button" id="desktop-welcome-setup">Build setup</button></div></div>';
document.body.append(setup, welcome);
const descriptors = [
  ["gameRoot", "Cyberpunk 2077 game folder"],
  ["launchRoute", "How you install mods"],
  ["manualModRoot", "Optional direct mod folder"],
  ["mo2Root", "Mod Organizer 2 instance folder"],
  ["mo2ProfileId", "Mod Organizer 2 profile"],
  ["wolvenKitCli", "WolvenKit CLI executable"],
  ["bunExecutable", "Optional Bun executable"],
];
const fieldsRoot = setup.querySelector("#desktop-setup-fields");
const controls = new Map();
for (const [name, labelText] of descriptors) {
  const label = document.createElement("label");
  label.textContent = labelText;
  label.dataset.field = name;
  const control = name === "launchRoute" ? document.createElement("select") : document.createElement("input");
  control.name = name;
  if (name === "launchRoute") {
    for (const [value, text] of [["direct", "Game folder"], ["mo2", "Mod Organizer 2"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      control.append(option);
    }
  } else {
    control.type = "text";
    control.autocomplete = "off";
  }
  label.append(control);
  fieldsRoot.append(label);
  controls.set(name, control);
}
const setupStatus = setup.querySelector("#desktop-setup-status");
const saveSetup = setup.querySelector("#desktop-setup-save");
const restoreSetup = setup.querySelector("#desktop-setup-restore");
const deferSetup = setup.querySelector("#desktop-setup-defer");
saveSetup.disabled = true;
const aboutReadiness = about.querySelector("#desktop-setup-readiness");
const setupActions = createBrowserLocalSetup();
let setupView;
function showRoute() {
  const mo2 = controls.get("launchRoute").value === "mo2";
  for (const name of ["mo2Root", "mo2ProfileId"]) fieldsRoot.querySelector(`[data-field="${name}"]`).hidden = !mo2;
  fieldsRoot.querySelector('[data-field="manualModRoot"]').hidden = mo2;
}
controls.get("launchRoute").addEventListener("change", showRoute);
function showSetup(view) {
  setupView = view;
  for (const [name, control] of controls) control.value = view.fields[name] ?? "";
  showRoute();
  const recovery = view.source === "backup";
  restoreSetup.hidden = !recovery;
  deferSetup.hidden = view.source !== "new";
  saveSetup.disabled = recovery;
  const pathIssues = view.readiness.sourceDiscovery.issues.map(issue => issue.reason);
  const buildReady = view.readiness.build.ready;
  const pathStatus = pathIssues.length ? pathIssues.join(" ") : "The game folder was found.";
  setupStatus.textContent = recovery ? "Your settings file is damaged. Restore the previous copy before editing." :
    `${pathStatus} Check works without any of these. Build ${buildReady ? "is ready." : "isn't set up yet."}`;
  aboutReadiness.textContent = recovery ? "Build settings need repair: open Build setup." :
    `Check is ready. Build ${buildReady ? "is set up." : "isn't set up yet: it needs your game folder and the WolvenKit CLI."}`;
}
async function setupAction(action) {
  const result = await setupActions.dispatch(action);
  if (!result.ok) throw Error(result.message);
  showSetup(setupActions.snapshot().view);
}
async function openSetup() {
  setupStatus.textContent = "Loading build setup…";
  saveSetup.disabled = true;
  setup.showModal();
  await initialSetup.catch(() => {});
  try { await setupAction({ kind: "setup.refresh" }); }
  catch { setupStatus.textContent = "Build setup couldn't be loaded. Restart XF Studio and try again."; }
}
about.querySelector("#desktop-setup-open").addEventListener("click", () => { about.close(); void openSetup(); });
setup.querySelector("#desktop-setup-close").addEventListener("click", () => setup.close());
// Skipping stores the untouched defaults through the same validated action, so
// the welcome does not return on every launch; Check never needs these paths.
async function deferBuildSetup() {
  if (setupView?.source !== "new") return;
  await setupAction({ kind: "setup.save", fields: setupView.fields });
}
deferSetup.addEventListener("click", async () => {
  deferSetup.disabled = true;
  try { await deferBuildSetup(); setup.close(); }
  catch (error) { setupStatus.textContent = error.message; }
  finally { deferSetup.disabled = false; }
});
const welcomeStart = welcome.querySelector("#desktop-welcome-start");
welcomeStart.addEventListener("click", async () => {
  welcomeStart.disabled = true;
  try { await initialSetup.catch(() => {}); await deferBuildSetup(); welcome.close(); }
  catch (error) { welcome.querySelector("#desktop-welcome-status").textContent = error.message; }
  finally { welcomeStart.disabled = false; }
});
welcome.querySelector("#desktop-welcome-setup").addEventListener("click", () => { welcome.close(); void openSetup(); });
setup.querySelector("#desktop-setup-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!setupView || setupView.source === "backup") return;
  saveSetup.disabled = true;
  const fields = { ...setupView.fields };
  for (const [name, control] of controls) fields[name] = name === "launchRoute" ? control.value : control.value.trim() || null;
  try { await setupAction({ kind: "setup.save", fields }); }
  catch (error) { setupStatus.textContent = error.message; }
  finally { saveSetup.disabled = setupView?.source === "backup"; }
});
restoreSetup.addEventListener("click", async () => {
  restoreSetup.disabled = true;
  try { await setupAction({ kind: "setup.restorePrevious" }); }
  catch (error) { setupStatus.textContent = error.message; }
  finally { restoreSetup.disabled = false; }
});
const initialSetup = setupAction({ kind: "setup.refresh" });
void initialSetup.then(() => {
  // A fresh install gets the plain-language welcome; damaged settings open
  // Build setup for recovery. Existing users reach Build setup from About.
  if (setupView?.source === "new") welcome.showModal();
  else if (setupView?.source === "backup") setup.showModal();
}).catch(() => { aboutReadiness.textContent = "Build setup couldn't be loaded. Check still works."; });
// Once any settings form saves, the Build setup dialog shows the saved view.
setupActions.subscribe(() => { const view = setupActions.snapshot().view; if (view && !setup.open) showSetup(view); });
let previewReady = false;
let flushRequest = null;
window.addEventListener("xfs-desktop-close-flush", () => flushRequest?.());
void import("/build/studio-startup.js").then(({ startStudio }) => startStudio({
  storage: workspaceStorage,
  // The desktop host file (16 MB limit) holds more than browser storage.
  storageBudget: 12_000_000,
  previewPreparation: createBrowserPreviewPreparation("/api/desktop/preview"),
  localSetup: setupActions,
  setupPlace: "Build setup",
  openSetup: () => void openSetup(),
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
