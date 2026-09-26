/**
 * Fixed-camera captures of the V's head (hair, face and the mouth interior) in an isolated `?verify=1` workspace with disposable data and
 * a throwaway Chrome profile: the default V or a save, optionally with creator choices set, under both lighting presets, in the bind pose
 * and with the idle paused at several phases (the lips part in the idle, which shows whether the teeth follow the mouth).
 *
 *   bun tools/head-look.ts <out dir under evidence/screenshots> [port] [save copy|-] [choices.json|-] [--head-only]
 *
 * `--head-only` turns the body off before the V loads, so the host prepares the head alone (no body or clothes): a smaller run.
 * `choices.json` holds creator choices to set on the V: `[{ "part": "head", "option": "hairstyle", "choice": "12" }, …]` (the character
 * context's `character.setOptions` changes). Outputs are private renders of local game assets: keep them in the ignored
 * evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const args = process.argv.slice(2).filter(arg => arg !== "--head-only"), headOnly = process.argv.includes("--head-only");
const [outArg, portArg = "4394", saveArg, choicesArg] = args;
const choicesFile = choicesArg && choicesArg !== "-" ? choicesArg : undefined;
const save = saveArg && saveArg !== "-" ? saveArg : undefined;
if (!outArg) throw Error("Usage: bun tools/head-look.ts <out dir> [port] [save copy|-] [choices.json]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
const views: Record<string, { position: number[]; target: number[]; fov: number }> = {
  face: { position: [0, 1.68, -0.52], target: [0, 1.67, 0], fov: 30 },
  hair: { position: [-0.42, 1.74, -0.52], target: [0, 1.66, 0], fov: 30 },
  "hair-back": { position: [0.3, 1.7, 0.62], target: [0, 1.6, 0], fov: 32 },
  mouth: { position: [0, 1.628, -0.34], target: [0, 1.632, 0], fov: 20 },
  // From inside the head, behind the teeth (the head's skin is single-sided, so it doesn't hide them from here).
  "mouth-inside": { position: [0, 1.64, 0.04], target: [0, 1.632, -0.2], fov: 50 },
  "mouth-low": { position: [0.03, 1.57, -0.32], target: [0, 1.635, 0], fov: 22 },
};
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1400, height: 1000, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const detailsReady = `(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.some(c => c.slot === "hair"); })()`;
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  if (headOnly) await run({ kind: "preview.setBody", enabled: false });
  if (save) {
    await page.chooseFiles([resolve(save)]);
    await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
  }
  await page.waitFor(detailsReady, 900000);
  if (choicesFile) {
    const changes = JSON.parse(readFileSync(resolve(choicesFile), "utf8")) as { part: string; option: string; choice: string }[];
    await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "character.setOptions", changes: ${JSON.stringify(changes)} }).available`, 240000);
    const before = await page.evaluate(`window.xfStudioSceneEvidence().characterDetails.identity`);
    console.log(JSON.stringify(await run({ kind: "character.setOptions", changes })));
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence()?.characterDetails; return !!e && e.identity !== ${JSON.stringify(before)} &&
      e.components.some(c => c.slot === "hair"); })()`, 900000);
  }
  await page.wait(4000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setExposure", value: 1.2 },
    { kind: "preview.setKeyAngle", degrees: 0 }, { kind: "preview.setHair", enabled: true }]) await run(action).catch(() => undefined);
  const shots: string[] = [];
  const capture = async (name: string) => { await page.wait(1500); await page.screenshot(resolve(out, `${name}.png`)); shots.push(name); };
  for (const preset of ["studio", "creator"] as const) {
    await run({ kind: "preview.setLightingPreset", preset });
    for (const [name, camera] of Object.entries(views)) {
      await run({ kind: "motion.setIdle", enabled: false });
      await run({ kind: "camera.restore", camera });
      await capture(`${preset}-${name}-bind`);
    }
    // The idle at fixed phases (paused): its face track parts the lips.
    for (const name of ["face", "mouth"] as const) {
      await run({ kind: "camera.restore", camera: views[name] });
      for (const phase of [1, 2, 3, 4]) {
        await run({ kind: "motion.setIdle", enabled: true }).catch(() => undefined);
        await run({ kind: "motion.setPaused", paused: false }).catch(() => undefined);
        await page.wait(phase * 1300);
        await run({ kind: "motion.setPaused", paused: true }).catch(() => undefined);
        await capture(`${preset}-${name}-idle-${phase}`);
      }
    }
  }
  await run({ kind: "motion.setIdle", enabled: false });
  const evidence = await page.evaluate(`(() => { const e = window.xfStudioSceneEvidence(); return { characterDetails: e.characterDetails }; })()`);
  const slots = await page.evaluate(`JSON.parse(JSON.stringify(window.xfStudioPresentation.authoring.previewState().assets?.characterDetails?.slots ?? null))`).catch(() => null);
  const gpu = await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), save: save ? "(private save copy)" : null, headOnly,
    choices: choicesFile ? JSON.parse(readFileSync(resolve(choicesFile), "utf8")) : null, views, gpu, shots, slots, evidence,
    console: page.console.filter(m => m.type === "error" || m.type === "warning").slice(0, 40) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`);
} finally { await page.close(); server.kill(); }
