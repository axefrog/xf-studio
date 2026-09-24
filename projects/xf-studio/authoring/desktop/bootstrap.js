// This device bootstrap is intentionally outside shared Studio presentation.
// A release needs a guided, provenance-checked asset intake; this spike offers
// only a clear missing-input state and a private user-data location.
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
about.innerHTML = '<h2>About XF Studio</h2><p id="desktop-version"></p><p id="desktop-build"></p><p>Private data folder</p><code id="desktop-data-path"></code><p id="desktop-update"></p><form method="dialog"><button type="submit">Close</button></form>';
about.querySelector("#desktop-version").textContent = capabilities.metadataStatus === "ready" ?
  `Version ${capabilities.version} · ${capabilities.channel}` : "Installed version unavailable";
about.querySelector("#desktop-build").textContent = capabilities.metadataStatus === "ready" ?
  `Build ${capabilities.buildHash}` : "This installation needs repair before its version can be trusted.";
about.querySelector("#desktop-data-path").textContent = capabilities.userDataPath;
about.querySelector("#desktop-update").textContent = capabilities.updater ? "Updates available through this desktop host." :
  "Updates are unavailable in this desktop trial.";
document.body.append(aboutButton, about);
aboutButton.addEventListener("click", () => about.showModal());
if (capabilities.previewAssets === "missing") {
  const root = document.getElementById("studio");
  root.removeAttribute("aria-busy");
  root.innerHTML = '<div class="boot" role="status"><span class="brand-mark" aria-hidden="true">XF</span><span>Welcome to XF Studio. This desktop trial needs locally prepared preview assets before the editor can open. It does not include game or mod files. Place your own prepared assets in <code id="desktop-asset-path"></code>, then restart. About shows the version and private data location.</span></div>';
  root.querySelector("#desktop-asset-path").textContent = `${capabilities.userDataPath}\\preview-assets`;
} else {
  void import("/build/studio-main.js").catch(error => {
    const root = document.getElementById("studio");
    root.removeAttribute("aria-busy");
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
      textContent: `XF Studio desktop could not load its editor: ${error.message}` }));
    console.error("XF desktop editor import failed", error);
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
