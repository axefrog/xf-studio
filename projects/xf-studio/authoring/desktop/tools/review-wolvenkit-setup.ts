/**
 * End-to-end check of the community path on this computer, through the real loopback host and a fresh
 * data folder: the welcome, the detected game folder, consent to download WolvenKit from its official
 * GitHub release, the verified install, the 3D preview derived from the game files (the head appears)
 * and Build readiness turning green. Needs network access, an installed Cyberpunk 2077 and
 * `bun run prepare:static` first. Screenshots go to the ignored evidence folder.
 *   bun tools/review-wolvenkit-setup.ts [--no-dotnet] [--game <folder>]
 * `--no-dotnet` hides the .NET runtime from the setup service only (nothing on the computer changes),
 * to review the runtime guidance; it stops after that card.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { launch } from "../../tools/cdp";
import { createDesktopServer } from "../server";

const noDotNet = process.argv.includes("--no-dotnet");
const gameArgument = process.argv.includes("--game") ? process.argv[process.argv.indexOf("--game") + 1] : null;
const directory = mkdtempSync(resolve(tmpdir(), "xfs-wolvenkit-e2e-"));
const screenshots = resolve(import.meta.dir, "../../evidence/screenshots");
const opened: string[] = [];
const log: string[] = [];
const server = createDesktopServer(resolve(import.meta.dir, "../static"), resolve(directory, "user-data"),
  { version: "0.1.0", channel: "dev", buildHash: "e2e", metadataStatus: "ready" }, undefined, undefined, undefined, undefined, undefined, {
    openExternal: url => { opened.push(url); return true; },
    wolvenKit: noDotNet ? { dotnet: () => ({ root: null, source: null, frameworks: {} }) } : {},
  });
server.onReport(message => { log.push(message); console.log(`  host: ${message}`); });
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
let browser: Awaited<ReturnType<typeof launch>> | undefined;
const card = () => browser!.evaluate(`({ title: document.querySelector('#preview-card-title')?.textContent,
  body: document.querySelector('#preview-card-body')?.textContent, step: document.querySelector('#preview-card-step')?.textContent,
  hidden: document.querySelector('#preview-card')?.hidden, action: document.querySelector('#preview-card-primary')?.dataset.action,
  label: document.querySelector('#preview-card-primary')?.textContent, secondary: document.querySelector('#preview-card-secondary')?.textContent })`);
try {
  browser = await launch(server.url + "&verify=1", { width: 1280, height: 800, debugPort: 9446, scheme: "dark" });
  await browser.waitFor("document.querySelector('#desktop-welcome')?.open");
  await browser.evaluate("document.querySelector('#desktop-welcome-start').click()");
  await browser.waitFor("!document.querySelector('#desktop-welcome').open && document.querySelector('#studio.studio-ready')");
  // The card first offers the detected game folder (or, with none detected, Build setup).
  await browser.waitFor("['use-game', 'setup', 'wolvenkit-consent'].includes(document.querySelector('#preview-card-primary')?.dataset.action)", 30_000);
  let state = await card();
  console.log(`[${elapsed()}] card: ${state.title} → ${state.label}`);
  if (state.action === "use-game") await browser.evaluate("document.querySelector('#preview-card-primary').click()");
  else if (state.action === "setup") {
    if (!gameArgument) throw Error("No single game install was detected; pass --game <folder>.");
    await browser.evaluate(`(async () => { const view = await (await fetch('/api/local-settings')).json();
      await fetch('/api/local-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: view.revision, fields: { ...view.fields, gameRoot: ${JSON.stringify(gameArgument)} } }) }); })()`);
    await browser.evaluate("document.getElementById('desktop-setup').dispatchEvent(new Event('close'))");
  }
  await browser.waitFor("document.querySelector('#preview-card-primary')?.dataset.action === 'wolvenkit-consent'", 30_000);
  state = await card();
  console.log(`[${elapsed()}] card: ${state.title} — ${state.body}`);
  await browser.screenshot(resolve(screenshots, "desktop-wolvenkit-card.png"));
  await browser.evaluate("document.querySelector('#preview-card-primary').click()");
  await browser.waitFor("document.querySelector('#wolvenkit-consent')?.open");
  const consent = await browser.evaluate("document.querySelector('#wolvenkit-consent').innerText");
  for (const needed of ["Download WolvenKit 9.0.1?", "45 MB", "official release on GitHub", "GPL-3.0", "Nothing is installed in Windows", "Download (45 MB)"])
    if (!consent.includes(needed)) throw Error(`The consent dialog lacks "${needed}": ${consent}`);
  if (noDotNet && !consent.includes(".NET 10 Runtime")) throw Error("The consent dialog does not mention the missing .NET runtime.");
  await browser.screenshot(resolve(screenshots, `desktop-wolvenkit-consent${noDotNet ? "-no-dotnet" : ""}.png`));
  // Nothing is downloaded before the person agrees.
  if (log.some(line => /WolvenKit download|WolvenKit .* downloaded/.test(line))) throw Error("A download started before consent.");
  await browser.evaluate("document.querySelector('#wolvenkit-consent-confirm').click()");
  await browser.waitFor("document.querySelector('#preview-card-title')?.textContent.startsWith('Downloading WolvenKit')", 10_000);
  await browser.waitFor("parseFloat(document.querySelector('#preview-card-progress')?.value ?? 0) > 0.3", 300_000);
  state = await card();
  console.log(`[${elapsed()}] ${state.title} ${state.step}`);
  await browser.screenshot(resolve(screenshots, "desktop-wolvenkit-downloading.png"));
  if (noDotNet) {
    await browser.waitFor("document.querySelector('#preview-card-primary')?.dataset.action === 'runtime-install'", 300_000);
    state = await card();
    console.log(`[${elapsed()}] card: ${state.title} — ${state.body} [${state.label} | ${state.secondary}]`);
    await browser.screenshot(resolve(screenshots, "desktop-wolvenkit-needs-dotnet.png"));
    await browser.evaluate("document.querySelector('#preview-card-primary').click()");
    await browser.waitFor(`true`);
    await Bun.sleep(500);
    if (!opened.includes("https://aka.ms/dotnet/10.0/dotnet-runtime-win-x64.exe")) throw Error(`Microsoft's installer link was not opened: ${opened}`);
    const build = await browser.evaluate("fetch('/api/local-settings').then(r => r.json()).then(v => v.readiness.build)");
    console.log(`[${elapsed()}] Build readiness without .NET: ${JSON.stringify(build.issues.map((issue: { reason: string }) => issue.reason))}`);
    console.log(JSON.stringify({ result: "runtime guidance shown", opened }, null, 2));
  } else {
    // WolvenKit ready → the preview prepares itself → the head attaches without a reload.
    await browser.waitFor("window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 600_000);
    console.log(`[${elapsed()}] the 3D head is ready`);
    await Bun.sleep(1500);
    await browser.screenshot(resolve(screenshots, "desktop-wolvenkit-head-ready.png"));
    let build: { ready: boolean; issues: { reason: string }[] } = { ready: false, issues: [] };
    for (let i = 0; i < 60 && !build.ready; i++) {
      build = await browser.evaluate("fetch('/api/local-settings').then(r => r.json()).then(v => v.readiness.build)");
      if (!build.ready) await Bun.sleep(1000);
    }
    const capabilities = await browser.evaluate("fetch('/api/desktop/capabilities').then(r => r.json())");
    console.log(`[${elapsed()}] Build readiness: ${build.ready ? "ready" : JSON.stringify(build.issues)}; capabilities.packageBuild=${capabilities.packageBuild}; previewAssets=${capabilities.previewAssets}`);
    if (!build.ready || !capabilities.packageBuild || capabilities.previewAssets !== "ready") throw Error("Build readiness did not turn green.");
    const palette = await browser.evaluate("window.xfStudioPresentation.files.capability({ kind: 'package.build' })");
    if (!palette.available) throw Error(`Build is still unavailable in the Studio: ${JSON.stringify(palette)}`);
    await browser.evaluate("document.querySelector('#desktop-about-open').click()");
    await browser.waitFor("document.querySelector('#desktop-wolvenkit-note')?.textContent.includes('is ready')");
    await browser.evaluate("document.querySelector('#desktop-wolvenkit-licence').click()");
    await Bun.sleep(500);
    await browser.screenshot(resolve(screenshots, "desktop-wolvenkit-about.png"));
    if (!opened.includes("https://github.com/WolvenKit/WolvenKit/blob/9.0.1/LICENSE")) throw Error(`The licence link did not open: ${opened}`);
    await browser.evaluate("document.querySelector('#desktop-about').close()");
    if (process.argv.includes("--build")) {
      // A real Build of the starter look with XF Studio's own WolvenKit (plate derivation, packing, independent verification).
      const build = await browser.evaluate(`window.xfStudioPresentation.files.execute({ kind: 'package.build' })
        .then(outcome => ({ ok: outcome.ok, code: outcome.code, message: outcome.message, presets: outcome.result?.result?.presets?.length,
          archive: outcome.result?.result?.archive ?? outcome.result?.result?.package }))`);
      console.log(`[${elapsed()}] Build: ${JSON.stringify(build)}`);
      if (!build.ok) throw Error("Build with the downloaded WolvenKit failed.");
    }
    console.log(JSON.stringify({ result: "passed", seconds: (Date.now() - started) / 1000, opened,
      about: await browser.evaluate("document.querySelector('#desktop-wolvenkit-note').textContent") }, null, 2));
  }
  if (browser.console.some(entry => entry.type === "exception")) throw Error(`Browser exception: ${JSON.stringify(browser.console.filter(entry => entry.type === "exception"))}`);
} finally {
  await browser?.close();
  server.stop();
  rmSync(directory, { recursive: true, force: true });
}
