// This device bootstrap is intentionally outside shared Studio presentation.
// This desktop-only bootstrap offers a bounded intake for prepared core
// preview outputs. Optional known-hash matches do not establish ownership.
import { createBrowserLocalSetup } from "../src/browser-local-setup-device";
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
if (!workspaceResponse.ok) failWorkspaceBoot("Private desktop workspace could not be restored; its file was preserved.");
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
    if (!response.ok) throw Error("Private desktop workspace could not be saved. Keep this window open and export your collection.");
  }).catch(error => { workspaceAlert(error.message); });
}
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
about.innerHTML = '<h2>About XF Studio</h2><p id="desktop-version"></p><p id="desktop-build"></p><p>Private data folder</p><code id="desktop-data-path"></code><p id="desktop-setup-readiness"></p><p id="desktop-update" role="status"></p><div id="desktop-update-actions" hidden><button type="button" data-update-action="check">Check for update</button><button type="button" data-update-action="download">Download update</button><button type="button" data-update-action="applyAndRestart">Apply and restart</button></div><button id="desktop-setup-open" type="button">Local setup</button><form method="dialog"><button type="submit">Close</button></form>';
about.querySelector("#desktop-version").textContent = capabilities.metadataStatus === "ready" ?
  `Version ${capabilities.version} · ${capabilities.channel}` : "Installed version unavailable";
about.querySelector("#desktop-build").textContent = capabilities.metadataStatus === "ready" ?
  `Build ${capabilities.buildHash}` : "This installation needs repair before its version can be trusted.";
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
document.body.append(aboutButton, about);
aboutButton.addEventListener("click", () => { about.showModal(); void refreshUpdate(); });
const setup = document.createElement("dialog");
setup.id = "desktop-setup";
setup.innerHTML = '<h2>Local setup</h2><p>These paths stay in this Windows account. You can set them now and change them later.</p><form id="desktop-setup-form"><div id="desktop-setup-fields"></div><p id="desktop-setup-status" role="status"></p><div class="desktop-setup-actions"><button type="button" id="desktop-setup-restore" hidden>Restore previous settings</button><button type="submit" id="desktop-setup-save">Save setup</button><button type="button" id="desktop-setup-close">Close</button></div></form>';
document.body.append(setup);
const descriptors = [
  ["gameRoot", "Cyberpunk 2077 game folder"],
  ["launchRoute", "Mod source route"],
  ["manualModRoot", "Optional direct mod folder"],
  ["mo2Root", "Mod Organizer 2 instance folder"],
  ["mo2ProfileId", "Mod Organizer 2 profile"],
  ["plateInput", "Private plate input folder"],
  ["wolvenKitCli", "WolvenKit CLI executable"],
  ["pythonExecutable", "Optional Python executable"],
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
  saveSetup.disabled = recovery;
  const pathIssues = view.readiness.sourceDiscovery.issues.map(issue => issue.reason);
  const pathStatus = pathIssues.length ? pathIssues.join(" ") : "Game and mod source paths pass the current presence checks.";
  setupStatus.textContent = recovery ? "The current settings file is damaged. Restore the previous copy before editing." :
    `${pathStatus} Mod export Check uses the collection alone. Build ${view.readiness.build.ready ? "is ready" : "needs its configured tools and inputs"}.`;
  aboutReadiness.textContent = recovery ? "Local setup needs recovery." :
    `Local setup: ${view.source === "new" ? "not saved" : pathIssues.length ? "paths need attention" : "paths saved"}. Mod export Check is available; Build ${view.readiness.build.ready ? "is ready" : "needs its configured tools and inputs"}.`;
}
async function setupAction(action) {
  const result = await setupActions.dispatch(action);
  if (!result.ok) throw Error(result.message);
  showSetup(setupActions.snapshot().view);
}
async function openSetup() {
  setupStatus.textContent = "Loading local setup…";
  saveSetup.disabled = true;
  setup.showModal();
  await initialSetup.catch(() => {});
  try { await setupAction({ kind: "setup.refresh" }); }
  catch { setupStatus.textContent = "Local setup is unavailable. Restart XF Studio and retry."; }
}
about.querySelector("#desktop-setup-open").addEventListener("click", () => { about.close(); void openSetup(); });
setup.querySelector("#desktop-setup-close").addEventListener("click", () => setup.close());
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
void initialSetup.catch(() => { aboutReadiness.textContent = "Local setup is unavailable."; });
if (capabilities.previewAssets !== "ready") {
  const intakeButton = document.createElement("button");
  intakeButton.id = "desktop-intake-open";
  intakeButton.type = "button";
  intakeButton.textContent = "Enable 3D preview";
  const root = document.createElement("dialog");
  root.id = "desktop-intake";
  root.innerHTML = '<div class="desktop-first-run"><span class="brand-mark" aria-hidden="true">XF</span><h1>UV editor is ready</h1><p>You can edit makeup shapes, use Undo, save collections, export masks and run Check without 3D preview files. Head and saved-V controls will become available after you import your own prepared assets.</p><label class="desktop-intake-label">Prepared preview folder<input id="desktop-intake-folder" type="text" autocomplete="off" placeholder="C:\\path\\to\\prepared-assets"></label><div class="desktop-intake-actions"><button type="button" id="desktop-intake-inspect">Inspect folder</button><button type="button" id="desktop-intake-import" disabled>Import valid files</button></div><p id="desktop-intake-status" aria-live="polite">The host checks five core preview files before copying them.</p><p>The imported files stay in your private data folder:</p><code id="desktop-asset-path"></code><p>A recorded hash match is optional and does not verify ownership, source provenance or game fidelity. This installer includes no game or mod files. Build needs separately configured host tools and plate inputs.</p><div class="desktop-intake-actions"><button type="button" id="desktop-setup-open-inline">Configure local setup</button><button type="button" id="desktop-intake-close">Continue in UV editor</button></div></div>';
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
  root.showModal();
}
document.documentElement.dataset.desktopPreviewAssets = capabilities.previewAssets;
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
