/**
 * Fixed-camera captures of the V's resolved body (knowledge/body-rendering.md) in an isolated `?verify=1` workspace with disposable
 * data and a throwaway Chrome profile: the default V, or a save, framed as the head view and the whole-body view under both lighting
 * presets, with the idle paused at a fixed phase and with the body hidden, plus the scene's body evidence and GPU memory.
 *
 *   bun tools/body-look.ts <out dir under evidence/screenshots> [port] [save copy|-] [choices.json]
 *
 * `choices.json` holds creator choices to set on the V: `[{ "part": "body", "option": "body_tattoo", "choice": "01" }, …]` (the
 * character context's `character.setOptions` changes).
 * Outputs are private renders of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4393", saveArg, choicesFile] = process.argv.slice(2);
const save = saveArg && saveArg !== "-" ? saveArg : undefined;
if (!outArg) throw Error("Usage: bun tools/body-look.ts <out dir> [port] [save copy] [ui-state.json]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const views: Record<string, object | "body"> = {
  head: { position: [0, 1.62, -0.75], target: [0, 1.6, 0], fov: 30 },
  body: "body",
  side: { position: [-3.2, 1.05, -1.6], target: [0, 0.93, 0], fov: 30 },
  hands: { position: [-0.95, 1.2, -0.75], target: [-0.42, 1.08, -0.05], fov: 30 },
};
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const bodyReady = `(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.some(c => c.slot === "body"); })()`;
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  if (save) {
    await page.chooseFiles([resolve(save)]);
    await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
  }
  if (choicesFile) {
    const changes = JSON.parse(readFileSync(resolve(choicesFile), "utf8")) as { part: string; option: string; choice: string }[];
    await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "character.setOptions", changes: ${JSON.stringify(changes)} }).available`, 240000);
    await page.waitFor(bodyReady, 900000);
    const before = await page.evaluate(`window.xfStudioSceneEvidence().characterDetails.identity`);
    console.log(JSON.stringify(await run({ kind: "character.setOptions", changes })));
    // The V with the choices set: a new record, with its body.
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence()?.characterDetails; return !!e && e.identity !== ${JSON.stringify(before)} &&
      e.components.some(c => c.slot === "body"); })()`, 900000);
  }
  await page.waitFor(bodyReady, 900000);
  await page.wait(4000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setExposure", value: 1.2 },
    { kind: "preview.setKeyAngle", degrees: 0 }]) await run(action).catch(() => undefined);
  const shots: string[] = [];
  const capture = async (name: string) => { await page.wait(1500); await page.screenshot(resolve(out, `${name}.png`)); shots.push(name); };
  for (const preset of ["studio", "creator"] as const) {
    await run({ kind: "preview.setLightingPreset", preset });
    for (const [name, camera] of Object.entries(views)) {
      await run({ kind: "motion.setIdle", enabled: false });
      await run(camera === "body" ? { kind: "camera.body" } : { kind: "camera.restore", camera });
      await capture(`${preset}-${name}-bind`);
      if (name === "head" || name === "body") {
        // The idle at a fixed phase (paused), so the body stands as the creator's close-up clip poses it.
        await run({ kind: "motion.setIdle", enabled: true }).catch(() => undefined);
        await page.wait(2000);
        await run({ kind: "motion.setPaused", paused: true }).catch(() => undefined);
        await capture(`${preset}-${name}-idle`);
      }
    }
  }
  await run({ kind: "motion.setIdle", enabled: false });
  await run({ kind: "preview.setLightingPreset", preset: "studio" });
  await run({ kind: "camera.body" });
  await run({ kind: "preview.setBody", enabled: false });
  await capture("studio-body-hidden");
  const hiddenMemory = await page.evaluate(`window.xfStudioSceneEvidence()?.characterDetails?.memory ?? null`);
  await run({ kind: "preview.setBody", enabled: true });
  await page.wait(1000);
  const evidence = await page.evaluate(`(() => { const e = window.xfStudioSceneEvidence(); return { characterDetails: e.characterDetails, frames: e.frames }; })()`);
  const status = await page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.authoring.previewState().assets?.characterDetails ?? window.xfStudioPresentation.status?.snapshot?.() ?? null))`).catch(() => null);
  const gpu = await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), save: save ? "(private save copy)" : null, choices: choicesFile ? JSON.parse(readFileSync(resolve(choicesFile), "utf8")) : null,
    gpu, shots, hiddenMemory, evidence, status, console: page.console.filter(m => m.type === "error" || m.type === "exception" || m.type === "warning").slice(0, 60) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
