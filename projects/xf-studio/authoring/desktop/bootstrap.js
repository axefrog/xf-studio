// This device bootstrap is intentionally outside shared Studio presentation.
// A release needs a guided, provenance-checked asset intake; this spike offers
// only a clear missing-input state and a private user-data location.
import { createBrowserLocalSetup } from "../src/browser-local-setup-device";
const capabilities = await fetch("/api/desktop/capabilities").then(response => response.json());
if (capabilities.schema !== "xfs/desktop-capabilities-1") throw Error("Desktop host capabilities are unavailable.");
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
about.innerHTML = '<h2>About XF Studio</h2><p id="desktop-version"></p><p id="desktop-build"></p><p>Private data folder</p><code id="desktop-data-path"></code><p id="desktop-setup-readiness"></p><p id="desktop-update"></p><button id="desktop-setup-open" type="button">Local setup</button><form method="dialog"><button type="submit">Close</button></form>';
about.querySelector("#desktop-version").textContent = capabilities.metadataStatus === "ready" ?
  `Version ${capabilities.version} · ${capabilities.channel}` : "Installed version unavailable";
about.querySelector("#desktop-build").textContent = capabilities.metadataStatus === "ready" ?
  `Build ${capabilities.buildHash}` : "This installation needs repair before its version can be trusted.";
about.querySelector("#desktop-data-path").textContent = capabilities.userDataPath;
about.querySelector("#desktop-update").textContent = capabilities.updater ? "Updates available through this desktop host." :
  "Updates are unavailable in this desktop trial.";
document.body.append(aboutButton, about);
aboutButton.addEventListener("click", () => about.showModal());
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
    `${pathStatus} Mod export checks and builds are unavailable in this desktop trial.`;
  aboutReadiness.textContent = recovery ? "Local setup needs recovery." :
    `Local setup: ${view.source === "new" ? "not saved" : pathIssues.length ? "paths need attention" : "paths saved"}. Mod export is unavailable in this desktop trial.`;
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
if (capabilities.previewAssets === "missing") {
  const root = document.getElementById("studio");
  root.removeAttribute("aria-busy");
  root.innerHTML = '<div class="boot desktop-first-run" role="status"><span class="brand-mark" aria-hidden="true">XF</span><h1>Welcome to XF Studio</h1><p>Configure your game and mod paths now or later. To open the editor, add your prepared preview assets to the private folder below, then restart the app.</p><code id="desktop-asset-path"></code><p>This desktop trial includes no game or mod files. Mod export is not yet available here.</p><button type="button" id="desktop-setup-open-inline">Configure local setup</button></div>';
  root.querySelector("#desktop-asset-path").textContent = `${capabilities.userDataPath}\\preview-assets`;
  root.querySelector("#desktop-setup-open-inline").addEventListener("click", () => void openSetup());
} else {
  void import("/build/studio-main.js").catch(error => {
    const root = document.getElementById("studio");
    root.removeAttribute("aria-busy");
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
      textContent: "XF Studio desktop could not load its editor. Restart XF Studio and retry." }));
    console.error("XF desktop editor import failed");
  });
}
const report = () => {
  const studio = document.getElementById("studio");
  if (studio?.classList.contains("studio-ready")) studio.removeAttribute("aria-busy");
  let webgl2 = false;
  try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch { /* Missing GPU. */ }
  let worker = false;
  try { const probe = new Worker("/build/raster-worker.js", { type: "module" }); worker = true; probe.terminate(); }
  catch { /* Missing worker support. */ }
  const state = document.querySelector(".boot-error") ? "error" :
    capabilities.previewAssets === "missing" ? "missing-assets" :
    studio?.classList.contains("studio-ready") ? "interactive" : "starting";
  void fetch("/api/desktop/smoke", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schema: "xfs/desktop-smoke-1", state, webgl2, worker }) });
};
setTimeout(report, 3000);
setTimeout(report, 12000);
