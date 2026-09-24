/** Private-input browser regression: pass a prepared folder; no asset bytes enter this repository. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { launch } from "../../tools/cdp";
import { createDesktopServer } from "../server";

const prepared = process.argv[2];
if (!prepared) throw Error("Pass an absolute path to five privately prepared core preview files.");
const directory = mkdtempSync(resolve(tmpdir(), "xfs-desktop-ready-review-"));
let browser: Awaited<ReturnType<typeof launch>> | undefined;
let server: ReturnType<typeof createDesktopServer> | undefined;
try {
  const data = resolve(directory, "user-data");
  server = createDesktopServer(resolve(import.meta.dir, "../static"), data,
    { version: "0.1.0", channel: "dev", buildHash: "fixture", metadataStatus: "ready" });
  browser = await launch(server.url + "&verify=1", { width: 900, height: 650, debugPort: 9439, scheme: "dark" });
  await browser.waitFor("document.querySelector('#studio.studio-ready') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'error'");
  const before = await browser.evaluate(`(() => {
    const port = window.xfStudioPresentation, layer = port.editor.layer();
    const changed = port.authoring.dispatch({ kind: 'layer.setColor', layerId: layer.id, color: '#123456' });
    return { changed: changed.ok, layerId: layer.id };
  })()`);
  if (!before.changed) throw Error("UV edit before asset intake failed.");
  await browser.evaluate(`document.querySelector('#desktop-intake-folder').value = ${JSON.stringify(resolve(prepared))};
    document.querySelector('#desktop-intake-inspect').click()`);
  await browser.waitFor("!document.querySelector('#desktop-intake-import').disabled", 30000);
  await browser.evaluate("document.querySelector('#desktop-intake-import').click()");
  await browser.waitFor("document.documentElement.dataset.desktopPreviewAssets === 'ready' && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 60000);
  await browser.waitFor("window.xfStudioPresentation.previewReadiness.snapshot().phase === 'ready'", 60000);
  const state = await browser.evaluate(`(() => {
    const port = window.xfStudioPresentation;
    return { head: port.viewport.snapshot().head.phase, uv: port.viewport.snapshot().uv.phase,
      readiness: port.previewReadiness.snapshot().phase,
      camera: port.authoring.capability({ kind: 'camera.front' }),
      check: port.files.capability({ kind: 'package.check' }),
      intakeButton: !!document.querySelector('#desktop-intake-open'),
      assetMode: document.documentElement.dataset.desktopPreviewAssets,
      retainedColor: port.editor.layer().color,
      headFetches: performance.getEntriesByType('resource').filter(item => item.name.endsWith('/assets/head.glb')).length };
  })()`);
  if (state.head !== "ready" || state.uv !== "ready" || state.readiness !== "ready" ||
    !state.camera.available || !state.check.available || state.intakeButton || state.assetMode !== "ready" ||
    state.retainedColor !== "#123456" || !state.headFetches)
    throw Error(`Prepared-asset desktop regression failed: ${JSON.stringify(state)}`);
  await browser.screenshot(resolve(import.meta.dir, "../../evidence/screenshots/desktop-ready-assets.png"));
  console.log("Prepared-asset desktop browser review passed; screenshot remains ignored.");
} finally {
  await browser?.close();
  server?.stop();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected temporary review directory.");
  rmSync(directory, { recursive: true, force: true });
}
