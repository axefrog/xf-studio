// This device bootstrap is intentionally outside shared Studio presentation.
// It adds the desktop first-run welcome, About (version, licences, build setup)
// and, for maintainers only, a bounded intake for prepared core preview files.
// Community installs never see the intake: the host reports previewIntake=false.
import { createBrowserLocalSetup } from "../src/browser-local-setup-device";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";
import { NO_3D_PREVIEW_YET } from "../src/alpha-availability";
const capabilities = await fetch("/api/desktop/capabilities").then(response => response.json());
if (capabilities.schema !== "xfs/desktop-capabilities-1") throw Error("Desktop host capabilities are unavailable.");
// The loopback port changes on each launch, so WebView localStorage alone does
// not survive a full desktop restart. Load the host-owned draft before Studio
// constructs its services; keep the browser copy for same-process reloads.
const verification = new URLSearchParams(location.search).has("verify");
const workspaceKey = verification ? "xfas.workspace.verification.v1" : "xfas.workspace.v1";
const workspaceEndpoint = `/api/desktop/workspace${verification ? "?verify=1" : ""}`;
const failWorkspaceBoot = message => {
  const root = document.getElementById("studio");
  root?.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error", textContent: message }));
  throw Error(message);
};
const workspaceResponse = await fetch(workspaceEndpoint, { cache: "no-store" });
if (!workspaceResponse.ok) failWorkspaceBoot("Your saved workspace could not be restored. Its file was kept unchanged; restart XF Studio to try again.");
const workspaceDocument = await workspaceResponse.json();
if (workspaceDocument.schema !== "xfs/desktop-workspace-1" ||
    (workspaceDocument.workspace !== null && typeof workspaceDocument.workspace !== "string"))
  failWorkspaceBoot("Desktop workspace response is invalid.");
let workspaceText = workspaceDocument.workspace ?? localStorage.getItem(workspaceKey);
let saveQueue = Promise.resolve();
const workspaceAlert = message => {
  let alert = document.getElementById("desktop-workspace-error");
  if (!alert) {
    alert = document.createElement("p");
    alert.id = "desktop-workspace-error";
    alert.setAttribute("role", "alert");
    document.body.append(alert);
  }
  alert.textContent = message;
};
function saveWorkspace(text) {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const response = await fetch(workspaceEndpoint, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: text }),
      keepalive: new TextEncoder().encode(text).length < 60_000 });
    if (!response.ok) throw Error("Your latest changes could not be saved. Keep this window open and export your collection from the Library panel.");
  });
  void saveQueue.catch(error => { workspaceAlert(error.message); });
}
window.xfDesktopWorkspaceError = workspaceAlert;
window.xfDesktopWorkspaceFlush = async updateNonce => {
  window.dispatchEvent(new Event("xfs-desktop-close-flush"));
  await saveQueue;
  if (updateNonce !== undefined) {
    if (typeof updateNonce !== "string" || !/^[0-9a-f-]{36}$/.test(updateNonce) || workspaceText === null)
      throw Error("The update workspace snapshot is unavailable.");
    const response = await fetch(workspaceEndpoint, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-XFS-Update-Flush": updateNonce },
      body: JSON.stringify({ workspace: workspaceText }) });
    if (!response.ok) throw Error("The update workspace snapshot could not be saved.");
  }
};
window.xfDesktopWorkspaceStorage = {
  getItem(key) { return key === workspaceKey ? workspaceText : localStorage.getItem(key); },
  setItem(key, value) {
    localStorage.setItem(key, value);
    if (key === workspaceKey) { workspaceText = value; saveWorkspace(value); }
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
  NO_3D_PREVIEW_YET;
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
setup.innerHTML = '<h2>Build setup</h2><p>Building the ' + EYE_MAKEUP_MOD.modName + ' mod files still needs a developer setup for now. You don&#39;t need any of this to design looks or run Check. These paths stay on this computer, and you can change them any time from About.</p><form id="desktop-setup-form"><div id="desktop-setup-fields"></div><p id="desktop-setup-status" role="status"></p><div class="desktop-setup-actions"><button type="button" id="desktop-setup-restore" hidden>Restore previous settings</button><button type="button" id="desktop-setup-defer" hidden>Skip for now</button><button type="submit" id="desktop-setup-save">Save</button><button type="button" id="desktop-setup-close">Close</button></div></form>';
const welcome = document.createElement("dialog");
welcome.id = "desktop-welcome";
welcome.innerHTML = '<div class="desktop-first-run"><span class="brand-mark" aria-hidden="true">XF</span><h1>Welcome to XF Studio</h1><p>XF Studio customises Cyberpunk 2077. Eye makeup is the first supported feature: design looks in layers on the UV map, keep them in your library, and run Check to see which can become mod files.</p><p><strong>The 3D head preview is built from your own Cyberpunk 2077 installation, and XF Studio can&#39;t do that yet.</strong> For now, design in the UV map; everything else works.</p><p>Building the ' + EYE_MAKEUP_MOD.modName + ' mod files still needs a developer setup. You can find it later under About → Build setup.</p><p id="desktop-welcome-status" role="status"></p><div class="desktop-intake-actions"><button type="button" id="desktop-welcome-start">Start designing</button><button type="button" id="desktop-welcome-setup">Build setup</button></div></div>';
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
    `Check is ready. Build ${buildReady ? "is set up." : "isn't set up yet; it needs a developer setup for now."}`;
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
// Developer-only: the five prepared preview files come from a maintainer
// pipeline that community users cannot run, so the host hides this intake.
if (capabilities.previewIntake && capabilities.previewAssets !== "ready") {
  const intakeButton = document.createElement("button");
  intakeButton.id = "desktop-intake-open";
  intakeButton.type = "button";
  intakeButton.textContent = "Enable 3D preview";
  const root = document.createElement("dialog");
  root.id = "desktop-intake";
  root.innerHTML = '<div class="desktop-first-run"><span class="brand-mark" aria-hidden="true">XF</span><h1>Developer preview files</h1><p>Import the five prepared core preview files to switch on the 3D head. The UV editor, library and Check work without them.</p><label class="desktop-intake-label">Prepared preview folder<input id="desktop-intake-folder" type="text" autocomplete="off" placeholder="C:\\path\\to\\prepared-assets"></label><div class="desktop-intake-actions"><button type="button" id="desktop-intake-inspect">Inspect folder</button><button type="button" id="desktop-intake-import" disabled>Import valid files</button></div><p id="desktop-intake-status" aria-live="polite">The host checks five core preview files before copying them.</p><p>The imported files stay in your private data folder:</p><code id="desktop-asset-path"></code><p>A recorded hash match is only a diagnostic. This installer includes no game or mod files.</p><div class="desktop-intake-actions"><button type="button" id="desktop-setup-open-inline">Build setup</button><button type="button" id="desktop-intake-close">Continue in UV editor</button></div></div>';
  document.body.append(intakeButton, root);
  intakeButton.addEventListener("click", () => root.showModal());
  root.querySelector("#desktop-intake-close").addEventListener("click", () => root.close());
  root.querySelector("#desktop-asset-path").textContent = `${capabilities.userDataPath}\\preview-assets`;
  root.querySelector("#desktop-setup-open-inline").addEventListener("click", () => void openSetup());
  const folder = root.querySelector("#desktop-intake-folder");
  const inspect = root.querySelector("#desktop-intake-inspect");
  const importButton = root.querySelector("#desktop-intake-import");
  const status = root.querySelector("#desktop-intake-status");
  if (capabilities.previewAssets === "incomplete") status.textContent =
    "The private preview folder exists but its five core files are incomplete or invalid. Intake preserves that folder; inspect or move it yourself before importing.";
  let inspected = "";
  folder.addEventListener("input", () => { inspected = ""; importButton.disabled = true; });
  async function intake(action) {
    inspect.disabled = true;
    importButton.disabled = true;
    status.textContent = action === "inspect" ? "Checking prepared files…" : "Copying verified files…";
    try {
      const response = await fetch("/api/desktop/assets/intake", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, folder: folder.value.trim() }) });
      const result = await response.json();
      if (!result.files) throw Error(result.error || "Intake failed.");
      if (!result.ready) {
        inspected = "";
        status.textContent = `Files need attention: ${result.files.filter(file => file.status !== "matched")
          .map(file => `${file.name} (${file.status})`).join(", ")}.`;
      } else if (action === "inspect") {
        inspected = folder.value.trim();
        importButton.disabled = false;
        const known = result.files.filter(file => file.matchesKnownOutput).length;
        status.textContent = `Five core files passed structural checks. ${known} match the recorded output hashes. Import copies them into private app data; source ownership is unverified.`;
      } else {
        status.textContent = "Core preview files imported. Opening the editor…";
        location.reload();
      }
    } catch (error) { status.textContent = error.message || "Intake failed."; }
    finally { inspect.disabled = false; if (action === "inspect" && inspected) importButton.disabled = false; }
  }
  inspect.addEventListener("click", () => void intake("inspect"));
  importButton.addEventListener("click", () => { if (inspected === folder.value.trim()) void intake("import"); });
}
document.documentElement.dataset.desktopPreviewAssets = capabilities.previewAssets;
document.documentElement.dataset.desktopPreviewIntake = capabilities.previewIntake ? "enabled" : "disabled";
void import("/build/studio-main.js").catch(error => {
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
    studio?.classList.contains("studio-ready") ? capabilities.previewAssets === "ready" ? "interactive" : "uv-only" : "starting";
  void fetch("/api/desktop/smoke", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema: "xfs/desktop-smoke-1", state, webgl2, worker }) });
};
setTimeout(report, 3000);
setTimeout(report, 12000);
