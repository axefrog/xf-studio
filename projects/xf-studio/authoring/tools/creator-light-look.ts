/**
 * Creator-lighting captures for calibration (knowledge/creator-lighting.md §12), in an isolated `?verify=1` workspace with disposable
 * data and a throwaway Chrome profile: the default V (or a save copy) under the Character creator preset at a creator page's camera,
 * idle off, the 3D view maximized, the viewport canvas only.
 *
 *   bun tools/creator-light-look.ts <out dir under evidence/screenshots> [port] [save copy|-] [--page face|hair] [--setup id] [--head-only] [--choices json] [--solo] [--variants] [--timing] [--scatter-ab] [--window WxH] [--dpr n]
 *
 * - always: `creator-all.png` (the preset as it ships) and `creator-no-shadows.png` (the same with the shadow switch off);
 *   with `--setup <id>` the studio stage in that setup instead (`studio-<id>-all.png`, `studio-<id>-no-shadows.png`);
 * - `--solo`: each rig light alone (`solo-<light>.png`), to split a region into per-light shares when refitting the calibration;
 * - `--variants`: the intensity and cone-reading switches;
 * - `--timing`: mean frame cost with shadows on and off, and the shadow-map size, into run.json;
 * - `--scatter-ab`: the same frame with the skin scatter off (`<prefix>-wrap.png`: the wrap stand-in) and bare (`<prefix>-bare.png`: no wrap and
 *   no scatter, so the difference from `<prefix>-all.png` is the scatter alone), and with `--timing` the frame cost
 *   with the scatter off, plus the scatter's evidence (targets, scissor, slots) in run.json;
 * - `--window WxH` and `--dpr n`: the page's size and device pixel ratio (defaults 1000×760 at 1), for frame costs at larger canvases.
 * Outputs are private renders of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, startServer } from "./cdp";

const argv = process.argv.slice(2), pageAt = argv.indexOf("--page");
const framing = pageAt >= 0 ? argv.splice(pageAt, 2)[1]! : "face";
// `--setup <id>`: the studio stage with one of its setups (soft, key, flat, rim, mirror) instead of the creator preset, same camera.
const setupAt = argv.indexOf("--setup"), setup = setupAt >= 0 ? argv.splice(setupAt, 2)[1]! : null;
// `--choices <json file>`: creator choices to set on the V first (`[{ "part": "head", "option": "skin_type", "choice": "05" }]`).
const choicesAt = argv.indexOf("--choices"), choicesFile = choicesAt >= 0 ? argv.splice(choicesAt, 2)[1]! : null;
// `--yaws -10,0,10`: also render the creator rig turned by each trial yaw (degrees), `creator-yaw<d>.png`, for fitting the rig's yaw.
const yawsAt = argv.indexOf("--yaws"), yaws = yawsAt >= 0 ? argv.splice(yawsAt, 2)[1]!.split(",").map(Number) : [];
const windowAt = argv.indexOf("--window"), [windowWidth, windowHeight] = windowAt >= 0 ? argv.splice(windowAt, 2)[1]!.split("x").map(Number) : [1000, 760];
const dprAt = argv.indexOf("--dpr"), dpr = dprAt >= 0 ? Number(argv.splice(dprAt, 2)[1]) : 1;
// `--casters a,b;c,d`: also render with each trial set of shadow-casting rig lights, `<prefix>-casters<i>.png` (knowledge §12.4).
const castersAt = argv.indexOf("--casters"), casterSets = castersAt >= 0 ? argv.splice(castersAt, 2)[1]!.split(";").map(set => set.split(",")) : [];
// `--scatter-scales 1,2,3`: also render the skin scatter at each trial screen scale, `<prefix>-scale<s>.png`, for fitting §11.6's unknown.
const scalesAt = argv.indexOf("--scatter-scales"), scatterScales = scalesAt >= 0 ? argv.splice(scalesAt, 2)[1]!.split(",").map(Number) : [];
const flags = new Set(argv.filter(a => a.startsWith("--")));
const [outArg, portArg = "4396", saveArg] = argv.filter(a => !a.startsWith("--"));
if (!outArg) throw Error("Usage: bun tools/creator-light-look.ts <out dir> [port] [save copy|-] [--page face|hair] [--solo] [--variants] [--timing]");
const out = resolve(outArg), port = +portArg, save = saveArg && saveArg !== "-" ? saveArg : undefined;
mkdirSync(out, { recursive: true });
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: windowWidth!, height: windowHeight!, scheme: "dark", debugPort: port + 5000 });
if (dpr !== 1) await page.send("Emulation.setDeviceMetricsOverride", { width: windowWidth, height: windowHeight, deviceScaleFactor: dpr, mobile: false });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  // `--head-only`: the body (and the clothes on it) off before the V loads, so the host prepares the head alone (a smaller run).
  if (flags.has("--head-only")) await run({ kind: "preview.setBody", enabled: false });
  if (save) {
    await page.chooseFiles([resolve(save)]);
    await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "savedV.import" })`, awaitPromise: true, userGesture: true });
  }
  await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.some(c => c.slot === "hair"); })()`, 900000);
  if (choicesFile) {
    const changes = JSON.parse(readFileSync(resolve(choicesFile), "utf8"));
    await page.waitFor(`window.xfStudioPresentation.authoring.capability({ kind: "character.setOptions", changes: ${JSON.stringify(changes)} }).available`, 240000);
    const before = await page.evaluate(`window.xfStudioSceneEvidence().characterDetails.identity`);
    console.log(JSON.stringify(await run({ kind: "character.setOptions", changes })));
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence()?.characterDetails; return !!e && e.identity !== ${JSON.stringify(before)} &&
      e.components.some(c => c.slot === "hair"); })()`, 900000);
  }
  await page.wait(3000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "motion.setIdle", enabled: false },
    { kind: "preview.setLightingPreset", preset: "creator" }, { kind: "camera.creatorFraming", page: framing }]) await run(action).catch(() => undefined);
  if (setup) await run({ kind: "preview.selectLightingSetup", setup });
  // The 3D view's group maximized, so the viewport fills the workspace; its canvas is the one inside that group.
  await page.evaluate(`(() => { const g = document.getElementById("dock-tab-head")?.closest("[data-group]");
    if (g) window.xfStudioShell.dock.toggleMaximize(g.dataset.group); })()`);
  await page.wait(4000);
  const rect = await page.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
    const g = document.getElementById("dock-tab-head")?.closest("[data-group]") ?? document;
    const c = [...g.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const shots: string[] = [];
  const capture = async (name: string) => { await page.wait(1200); await page.screenshot(resolve(out, `${name}.png`), rect); shots.push(name); };
  const prefix = setup ? `studio-${setup}` : "creator";
  await capture(`${prefix}-all`);
  const lights: { name: string; castShadow: boolean }[] = await page.evaluate(`window.xfStudioCreatorRig.lights()`);
  const timing: Record<string, number | null> = {};
  if (flags.has("--timing")) timing.shadowsOnMs = await page.evaluate(`window.xfStudioCreatorRig.frameMs(40)`);
  if (flags.has("--solo")) {
    for (const { name } of lights) {
      await page.evaluate(`window.xfStudioCreatorRig.solo(${JSON.stringify(name)})`);
      await capture(`solo-${name}`);
    }
    await page.evaluate(`window.xfStudioCreatorRig.solo(null)`);
  }
  for (const yaw of yaws) {
    await page.evaluate(`window.xfStudioCreatorRig.trialYaw(${yaw})`);
    await capture(`creator-yaw${yaw}`);
  }
  if (yaws.length) await page.evaluate(`window.xfStudioCreatorRig.trialYaw(null)`);
  const casterRuns: { set: string[]; drawn: string[] }[] = [];
  for (const [i, set] of casterSets.entries()) {
    await page.evaluate(`window.xfStudioCreatorRig.trialCasters(${JSON.stringify(set)})`);
    await capture(`${prefix}-casters${i}`);
    casterRuns.push({ set, drawn: await page.evaluate(`window.xfStudioCreatorRig.casters()`) });
  }
  if (casterSets.length) await page.evaluate(`window.xfStudioCreatorRig.trialCasters(null)`);
  let scatter: unknown = null;
  if (flags.has("--scatter-ab")) {
    scatter = await page.evaluate(`window.xfStudioCreatorRig.scatterEvidence()`);
    await page.evaluate(`window.xfStudioCreatorRig.scatter("bare")`);
    await capture(`${prefix}-bare`);
    await page.evaluate(`window.xfStudioCreatorRig.scatter(false)`);
    await capture(`${prefix}-wrap`);
    if (flags.has("--timing")) {
      // Alternate on and off six times, 60 frames each, and keep the minima: on a shared machine other work only ever adds time.
      const on: number[] = [], off: number[] = [], passes: number[] = [];
      for (let i = 0; i < 6; i++) for (const enabled of [true, false]) {
        await page.evaluate(`window.xfStudioCreatorRig.scatter(${enabled})`);
        await page.wait(200);
        (enabled ? on : off).push(await page.evaluate<number>(`window.xfStudioCreatorRig.frameMs(60)`));
        if (enabled) passes.push(await page.evaluate<number>(`window.xfStudioCreatorRig.scatterPassMs(30)`));
      }
      timing.scatterOnMs = Math.min(...on); timing.scatterOffMs = Math.min(...off); timing.scatterPassMs = Math.min(...passes);
      timing.scatterRuns = { on, off, passes } as never;
      await page.evaluate(`window.xfStudioCreatorRig.scatter(true)`);
      await page.wait(300);
      timing.scatterColdFrameMs = await page.evaluate<number>(`window.xfStudioCreatorRig.scatterColdFrameMs()`);
    }
    await page.evaluate(`window.xfStudioCreatorRig.scatter(true)`);
    await page.wait(500);
  }
  for (const scale of scatterScales) {
    await page.evaluate(`window.xfStudioCreatorRig.scatterScale(${scale})`);
    await capture(`${prefix}-scale${scale}`);
  }
  if (scatterScales.length) await page.evaluate(`window.xfStudioCreatorRig.scatterScale(null)`);
  await run({ kind: "preview.setCreatorShadows", enabled: false });
  await capture(`${prefix}-no-shadows`);
  if (flags.has("--timing")) timing.shadowsOffMs = await page.evaluate(`window.xfStudioCreatorRig.frameMs(40)`);
  await run({ kind: "preview.setCreatorShadows", enabled: true });
  if (flags.has("--variants")) {
    for (const [intensity, cone] of [["isotropic", "half"], ["cone", "full"], ["cone", "half"]] as const) {
      await run({ kind: "preview.setCreatorLighting", key: "intensity", value: intensity });
      await run({ kind: "preview.setCreatorLighting", key: "cone", value: cone });
      await capture(`variant-${intensity}-${cone}`);
    }
    await run({ kind: "preview.resetCreatorLighting" });
  }
  const gpu = await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  writeFileSync(resolve(out, "run.json"), JSON.stringify({ date: new Date().toISOString(), save: save ? "(private save copy)" : null, framing, rect, gpu,
    lights, shadowMapSize: await page.evaluate(`window.xfStudioCreatorRig.shadowMapSize()`), timing, shots, scatter, casterRuns, window: { width: windowWidth, height: windowHeight, dpr },
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 20) }, null, 2));
  console.log(`Wrote ${shots.length} captures to ${out}`, JSON.stringify(timing));
} finally { await page.close(); server.kill(); }
