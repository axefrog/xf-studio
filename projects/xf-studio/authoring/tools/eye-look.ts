/**
 * Fixed-camera captures of V's eyes in an isolated `?verify=1` workspace (throwaway Chrome profile, disposable workspace data):
 * the default V, then each supplied save copy, from three views (both eyes, one eye, a three-quarter side view for the iris
 * depth), under the studio stage at several key-light angles and under the character creator preset, with the eye's own
 * roughness switch on and off. It also records the scene's eye evidence and console errors. Used for the eye plan's before/after
 * captures (knowledge/eye-rendering.md §6.5, ranks 4–5): run it on the code before a change and after it into two folders.
 *
 *   bun tools/eye-look.ts <out dir under evidence/screenshots> [port] [save copy ...]
 *
 * Outputs are private renders of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg, ...saves] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/eye-look.ts <out dir> [port] [save copy ...]");
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = +(portArg || "4481");
const views = {
  eyes: { position: [0, 1.692, -0.4], target: [0, 1.691, -0.05], fov: 14 },
  eye: { position: [-0.03, 1.693, -0.26], target: [-0.03, 1.691, -0.06], fov: 12 },
  side: { position: [-0.15, 1.7, -0.19], target: [-0.03, 1.691, -0.06], fov: 14 },
};
/** Studio key-light angles (degrees; 329 is the stage's default), then the creator preset's fixed rig. */
const keyAngles = [329, 30, 90];
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const detailsReady = `(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && (e.characterDetails?.components?.length ?? 0) > 0
  && !document.querySelector('[role=status]')?.textContent?.includes('Preparing your V'); })()`;
const settle = async () => {
  await page.waitFor("window.xfStudioPresentation.previewReadiness.snapshot().phase === 'ready'", 120000);
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().lighting?.lut.phase !== 'loading'", 60000);
  await page.wait(800);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 30000);
  await page.wait(300);
};
const report: Record<string, unknown> = { date: new Date().toISOString(), views, keyAngles, subjects: {} };
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 180000);
  const canvas = await page.evaluate(`(() => { const r = document.querySelector('#device-head canvas').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  for (const [index, subject] of ["default", ...saves].entries()) {
    if (index) {
      await page.chooseFiles([resolve(subject)]);
      await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
      await page.wait(3000);
    }
    await page.waitFor(detailsReady, 240000).catch(error => console.log("details:", error.message));
    await page.wait(2000);
    const label = index ? `save${index}` : "default";
    for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: false },
      { kind: "preview.setHair", enabled: false }, { kind: "preview.setExposure", value: 1.2 }])
      await run(action).catch(() => undefined);
    const frames: string[] = [];
    const evidence: Record<string, unknown> = {};
    for (const optics of [true, false]) {
      await run({ kind: "preview.setEyeOptics", enabled: optics });
      for (const light of [...keyAngles.map(angle => ({ preset: "studio", angle })), { preset: "creator", angle: null }]) {
        await run({ kind: "preview.setLightingPreset", preset: light.preset });
        if (light.angle !== null) await run({ kind: "preview.setKeyAngle", degrees: light.angle });
        for (const [view, camera] of Object.entries(views)) {
          await run({ kind: "camera.restore", camera });
          await settle();
          const name = `${label}-${view}-${light.preset}${light.angle === null ? "" : `-${light.angle}`}-${optics ? "own" : "flat"}`;
          await page.screenshot(resolve(out, `${name}.png`), canvas);
          frames.push(name);
        }
        evidence[`${light.preset}-${optics ? "own" : "flat"}`] = await page.evaluate(`window.xfStudioSceneEvidence()?.characterDetails?.eyes ?? null`);
      }
    }
    await run({ kind: "preview.setLightingPreset", preset: "studio" });
    await run({ kind: "preview.setKeyAngle", degrees: 329 });
    (report.subjects as Record<string, unknown>)[label] = { frames, evidence };
  }
  report.console = page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 40);
  writeFileSync(resolve(out, "evidence.json"), JSON.stringify(report, null, 2));
  console.log(`Captured ${Object.values(report.subjects as Record<string, { frames: string[] }>).reduce((n, s) => n + s.frames.length, 0)} frames in ${out}`);
} finally { await page.close(); server.kill(); }
