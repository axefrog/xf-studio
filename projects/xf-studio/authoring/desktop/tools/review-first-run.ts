/**
 * Asset-free visual check of the desktop first-run flow through its real loopback host:
 * the community welcome, the 3D preview card, UV-only workflows, About → Licences and Build
 * setup, then a data folder holding hand-placed preview files (never served). Run
 * `bun run prepare:static` first.
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { launch } from "../../tools/cdp";
import { createDesktopServer } from "../server";

const directory = mkdtempSync(resolve(tmpdir(), "xfs-desktop-first-run-"));
const screenshots = resolve(import.meta.dir, "../../evidence/screenshots");
const game = resolve(directory, "sample-game");
mkdirSync(resolve(game, "bin", "x64"), { recursive: true });
mkdirSync(resolve(game, "archive", "pc"), { recursive: true });
writeFileSync(resolve(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
const server = createDesktopServer(resolve(import.meta.dir, "../static"), resolve(directory, "user-data"),
  { version: "0.1.0", channel: "dev", buildHash: "fixture", metadataStatus: "ready" });
let browser: Awaited<ReturnType<typeof launch>> | undefined;
try {
  browser = await launch(server.url + "&verify=1", { width: 900, height: 650, debugPort: 9438, scheme: "dark" });
  await browser.waitFor("document.querySelector('#desktop-welcome')?.open");
  const firstRun = await browser.evaluate(`({ setupOpen: document.querySelector('#desktop-setup').open,
    welcome: document.querySelector('#desktop-welcome').textContent })`);
  if (firstRun.setupOpen || !firstRun.welcome.includes("3D head preview is built from your own Cyberpunk 2077 files"))
    throw Error(`Desktop first run did not lead with the community welcome: ${JSON.stringify(firstRun)}`);
  await browser.screenshot(resolve(screenshots, "desktop-welcome-first-run.png"));
  await browser.evaluate("document.querySelector('#desktop-welcome-start').click()");
  await browser.waitFor("!document.querySelector('#desktop-welcome').open");
  const deferred = await browser.evaluate(`(async () => {
    const response = await fetch('/api/local-settings');
    const view = await response.json();
    return { source: view.source, gameRoot: view.fields.gameRoot, check: view.readiness.check.ready };
  })()`);
  if (deferred.source !== "primary" || deferred.gameRoot !== null || !deferred.check)
    throw Error(`Deferring setup changed an unexpected setting or disabled Check: ${JSON.stringify(deferred)}`);
  await browser.evaluate("document.documentElement.dataset.testReload = 'before'; location.reload()");
  await browser.waitFor("!document.documentElement.dataset.testReload && document.querySelector('#studio.studio-ready') && !document.querySelector('#desktop-setup').open && !document.querySelector('#desktop-welcome').open");
  await browser.waitFor("document.querySelector('#studio.studio-ready') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'error'");
  const uvOnly = await browser.evaluate(`(() => {
    const port = window.xfStudioPresentation, layer = port.editor.layer();
    const before = layer.color;
    const changed = port.authoring.dispatch({ kind: 'layer.setColor', layerId: layer.id, color: '#123456' });
    const color = port.editor.layer().color;
    const undo = port.authoring.dispatch({ kind: 'recipe.undo' });
    return { uv: port.viewport.snapshot().uv.phase, head: port.viewport.snapshot().head,
      readiness: port.previewReadiness.snapshot().phase,
      camera: port.authoring.capability({ kind: 'camera.front' }),
      mask: port.files.capability({ kind: 'mask.export' }),
      check: port.files.capability({ kind: 'package.check' }),
      color, before, changed, undo, restored: port.editor.layer().color,
      headFetches: performance.getEntriesByType('resource').filter(item => item.name.endsWith('/assets/head.glb')).length };
  })()`);
  if (uvOnly.uv !== "ready" || uvOnly.head.phase !== "error" || uvOnly.headFetches ||
    !/3D (?:head )?preview/.test(uvOnly.head.error) ||
    uvOnly.camera.code !== "asset_unavailable" || !uvOnly.mask.available || !uvOnly.check.available ||
    !uvOnly.changed.ok || uvOnly.color !== "#123456" || !uvOnly.undo.ok || uvOnly.restored !== uvOnly.before)
    throw Error(`UV-only first run failed: ${JSON.stringify(uvOnly)}`);
  const downloads = resolve(directory, "downloads");
  await browser.downloadTo(downloads);
  const workflows = await browser.evaluate(`(async () => {
    const port = window.xfStudioPresentation;
    const mask = await port.files.execute({ kind: 'mask.export' });
    const saved = await port.library.execute({ kind: 'save' });
    const check = await port.files.execute({ kind: 'package.check' });
    return { mask: { ok: mask.ok, code: mask.code }, saved: { ok: saved.ok, kind: saved.result?.kind },
      check: { ok: check.ok, kind: check.result?.kind, message: check.message } };
  })()`);
  let maskDownloaded = false;
  for (let i = 0; i < 40; i++) {
    maskDownloaded = readdirSync(downloads).some(name => /^xfs-.*-alpha\.png$/.test(name));
    if (maskDownloaded) break;
    await Bun.sleep(100);
  }
  if (!workflows.mask.ok || !workflows.saved.ok || workflows.saved.kind !== "saved" ||
    !workflows.check.ok || workflows.check.kind !== "packageCheck" || !maskDownloaded)
    throw Error(`UV-only workflows failed: ${JSON.stringify(workflows)}`);
  await browser.screenshot(resolve(screenshots, "desktop-uv-only-editor.png"));
  await browser.evaluate("document.querySelector('#desktop-about-open').click()");
  const aboutText = await browser.evaluate("document.querySelector('#desktop-about').textContent");
  if (!aboutText.includes("built from your own Cyberpunk 2077 files") || /Private|Local setup|canary/.test(aboutText))
    throw Error(`About wording regressed: ${aboutText}`);
  await browser.screenshot(resolve(screenshots, "desktop-about.png"));
  await browser.evaluate("document.querySelector('#desktop-licences-open').click()");
  await browser.waitFor("document.querySelector('#desktop-licence-text').textContent.includes('MIT License')");
  await browser.evaluate("document.querySelector('[data-licence-doc=\"THIRD_PARTY_NOTICES.md\"]').click()");
  await browser.waitFor("document.querySelector('#desktop-licence-text').textContent.includes('JavaScriptCore')");
  await browser.screenshot(resolve(screenshots, "desktop-licences.png"));
  await browser.evaluate("document.querySelector('#desktop-licences').close()");
  // The preview card names the missing game folder and opens Build setup.
  await browser.waitFor("document.querySelector('#preview-card')?.hidden === false && document.querySelector('#preview-card-primary')?.dataset.action === 'setup'");
  await browser.screenshot(resolve(screenshots, "desktop-first-run.png"));
  await browser.evaluate("document.querySelector('#preview-card-primary').click()");
  await browser.waitFor("document.querySelector('#desktop-setup').open && document.querySelector('#desktop-setup-status').textContent.includes('Check works')");
  await browser.screenshot(resolve(screenshots, "desktop-build-setup.png"));
  await browser.evaluate(`document.querySelector('input[name="gameRoot"]').value = ${JSON.stringify(game)};
    document.querySelector('#desktop-setup-save').click()`);
  await browser.waitFor("document.querySelector('#desktop-setup-status').textContent.includes('game folder was found')");
  const state = await browser.evaluate(`({
    intro: document.querySelector('.boot')?.textContent,
    setup: document.querySelector('#desktop-setup-status')?.textContent,
    game: document.querySelector('input[name="gameRoot"]')?.value,
    errors: document.querySelectorAll('.boot-error').length
  })`);
  if (state.game !== game || state.errors || !state.setup.includes("Check works"))
    throw Error(`Desktop first-run setup did not render and persist accurately: ${JSON.stringify(state)}`);
  await browser.screenshot(resolve(screenshots, "desktop-build-setup-saved.png"));
  await browser.viewport(390, 700);
  await browser.screenshot(resolve(screenshots, "desktop-build-setup-narrow.png"));
  await browser.colorScheme("light");
  await browser.screenshot(resolve(screenshots, "desktop-build-setup-light.png"));
  if (browser.console.some(entry => entry.type === "exception")) throw Error("Desktop first run raised a browser exception.");
  const csp = browser.console.filter(entry => /Content Security Policy/i.test(entry.text ?? ""));
  if (csp.length) throw Error(`The page's CSP blocked something: ${JSON.stringify(csp.slice(0, 3))}`);
  await browser.close(); browser = undefined;
  // Preview files placed by hand in the data folder are ignored: the head comes only from the game.
  const partialData = resolve(directory, "hand-placed-data");
  mkdirSync(resolve(partialData, "preview-assets"), { recursive: true });
  writeFileSync(resolve(partialData, "preview-assets", "head.glb"), "hand-placed fixture");
  const partialServer = createDesktopServer(resolve(import.meta.dir, "../static"), partialData,
    { version: "0.1.0", channel: "dev", buildHash: "fixture", metadataStatus: "ready" });
  try {
    browser = await launch(partialServer.url + "&verify=1", { width: 900, height: 650, debugPort: 9440 });
    await browser.waitFor("document.querySelector('#studio.studio-ready') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'error'");
    const handPlaced = await browser.evaluate(`({ uv: window.xfStudioPresentation.viewport.snapshot().uv.phase,
      reason: window.xfStudioPresentation.viewport.snapshot().head.error,
      headFetches: performance.getEntriesByType('resource').filter(item => item.name.endsWith('/assets/head.glb')).length })`);
    if (handPlaced.uv !== "ready" || !/3D (?:head )?preview/.test(handPlaced.reason) || handPlaced.headFetches)
      throw Error(`Hand-placed preview files changed the UV-only startup: ${JSON.stringify(handPlaced)}`);
  } finally { await browser?.close(); browser = undefined; partialServer.stop(); }
  console.log("Desktop first-run browser review passed; screenshots are in the ignored evidence directory.");
} finally {
  await browser?.close();
  server.stop();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected temporary review directory.");
  rmSync(directory, { recursive: true, force: true });
}
