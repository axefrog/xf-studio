/**
 * Fixed-camera captures of the saved brows, lashes and hair in an isolated
 * `?verify=1` workspace with disposable data and a throwaway Chrome profile.
 *
 *   bun tools/hair-colour-look.ts <private save copy> <out dir under evidence/screenshots> [port]
 *
 * Set XFS_ASSET_OVERLAY to serve regenerated private manifests. For each view it
 * writes all-details, no-brows, no-lashes and no-hair frames so that the pixels a
 * detail changes can be measured (tools/hair-colour-stats.py). Outputs are private
 * renders of local assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [save, outArg, portArg = "4391"] = process.argv.slice(2);
if (!save || !outArg) throw Error("Usage: bun tools/hair-colour-look.ts <save copy> <out dir> [port]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +portArg;
const views = {
  face: { position: [0, 1.705, -0.42], target: [0, 1.695, 0], fov: 30 },
  eye: { position: [-0.034, 1.712, -0.2], target: [-0.034, 1.706, 0], fov: 30 },
  hair: { position: [-0.38, 1.74, -0.5], target: [0, 1.66, 0], fov: 30 },
};
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 120000);
  await page.chooseFiles([resolve(save)]);
  // A file chooser only opens with user activation; mark this evaluation as a user gesture.
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`,
    awaitPromise: true, userGesture: true });
  await page.wait(6000);
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: false },
    { kind: "preview.setHair", enabled: true }, { kind: "preview.setExposure", value: 1.2 }, { kind: "preview.setKeyAngle", degrees: 0 }])
    await run(action);
  // Provenance notes the presentation shows (brow blend, lash profile provider, hair status).
  const evidence = await page.evaluate(`[...document.querySelectorAll("p, span, div")].map(e => e.childElementCount ? "" : e.textContent ?? "")
    .filter(t => /lash profile|Arkhe|hair styles|Some details/.test(t)).slice(0, 6)`);
  for (const [name, camera] of Object.entries(views)) {
    for (const [variant, toggles] of Object.entries({
      all: { brows: true, lashes: true, hair: true }, "no-brows": { brows: false, lashes: true, hair: true },
      "no-lashes": { brows: true, lashes: false, hair: true }, "no-hair": { brows: true, lashes: true, hair: false },
    })) {
      await run({ kind: "preview.setDetail", detail: "brows", enabled: toggles.brows });
      await run({ kind: "preview.setDetail", detail: "lashes", enabled: toggles.lashes });
      await run({ kind: "preview.setHair", enabled: toggles.hair });
      await run({ kind: "camera.restore", camera });
      await page.wait(1500);
      await page.screenshot(resolve(out, `${name}-${variant}.png`));
    }
  }
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), views,
    overlay: !!process.env.XFS_ASSET_OVERLAY, status: evidence,
    console: page.console.filter(m => m.type === "error" || m.type === "warning").slice(0, 40) }, null, 2));
  console.log(`Wrote captures to ${out}`);
} finally { await page.close(); server.kill(); }
