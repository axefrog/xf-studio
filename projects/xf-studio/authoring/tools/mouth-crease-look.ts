/**
 * The corner of the mouth (the lips' crease at the parting): close-up captures in an isolated `?verify=1` workspace (throwaway Chrome
 * profile) on an already running server, with no makeup, under the Character creator preset: as shown, with the head's normal map off,
 * without the character contact shadows, and (unless `--quick`) with the skin scatter off (the wrap) and bare, shadows off, each creator
 * light alone, the key alone without contact shadows, and the studio preset. Writes each crop and, with `--box x0,y0,x1,y1` (crop pixels),
 * the box's mean linear luminance and R/G per frame to `crease.json`.
 *
 *   bun tools/mouth-crease-look.ts <out dir under evidence/screenshots> <port> [save copy|-] [--box x0,y0,x1,y1] [--quick]
 *
 * `CREASE_CAMERA` (JSON {position, target, fov}) overrides the camera. Outputs are private renders of local game assets: keep them in the
 * ignored evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../src/png";
import { launch } from "./cdp";

const argv = process.argv.slice(2);
const boxAt = argv.indexOf("--box"), box = boxAt >= 0 ? argv.splice(boxAt, 2)[1]!.split(",").map(Number) : null;
const quickAt = argv.indexOf("--quick"), quick = quickAt >= 0 && !!argv.splice(quickAt, 1);
const [outArg, portArg, saveArg = "-"] = argv;
if (!outArg || !portArg) throw Error("Usage: bun tools/mouth-crease-look.ts <out dir> <port> [save copy|-] [--box x0,y0,x1,y1] [--quick]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "bare.recipe.json"), JSON.stringify({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [] }));

// V's right mouth corner (image left), from the front, about 3 cm across.
const camera = process.env.CREASE_CAMERA ? JSON.parse(process.env.CREASE_CAMERA)
  : { position: [0.012, 1.628, -0.24], target: [0.02, 1.624, -0.068], fov: 10 };
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1100, height: 760, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`Promise.resolve(window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)}))`);
const settle = async (ms = 1500) => {
  await page.wait(ms);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 60000).catch(() => undefined);
  await page.wait(400);
};
const linear = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 180000);
  if (saveArg !== "-") {
    const bytes = readFileSync(resolve(saveArg)).toString("base64");
    const before = await page.evaluate<string | null>(`window.xfStudioSceneEvidence()?.characterDetails?.identity ?? null`);
    await page.evaluate(`(async () => { const bin = atob(${JSON.stringify(bytes)}); const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () { if (this.type !== "file") return orig.call(this); HTMLInputElement.prototype.click = orig;
        const dt = new DataTransfer(); dt.items.add(new File([buf], "sav.dat")); this.files = dt.files; this.dispatchEvent(new Event("change", { bubbles: true })); };
      return window.xfStudioPresentation.files.execute({ kind: "savedV.import" }); })()`);
    await page.waitFor(`(() => { const e = window.xfStudioSceneEvidence()?.characterDetails; return !!e && e.identity !== ${JSON.stringify(before)} && !!e.skin; })()`, 600000);
  } else await page.waitFor(`!!window.xfStudioSceneEvidence()?.characterDetails?.skin`, 600000);
  await page.wait(3000);
  for (const action of [{ kind: "preview.setSurfaceControls", enabled: false }, { kind: "motion.setIdle", enabled: false },
    { kind: "preview.setHair", enabled: false }]) await run(action).catch(() => undefined);
  await page.chooseFiles([resolve(out, "bare.recipe.json")]);
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
  await page.wait(3000);
  await page.evaluate(`(() => { const g = document.getElementById("dock-tab-head")?.closest("[data-group]");
    if (g) window.xfStudioShell.dock.toggleMaximize(g.dataset.group); })()`);
  await page.wait(3000);
  const rect = await page.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
    const g = document.getElementById("dock-tab-head")?.closest("[data-group]") ?? document;
    const c = [...g.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const results: Record<string, { luminance: number; rg: number } | null> = {};
  const capture = async (name: string) => {
    await settle();
    const file = resolve(out, `${name}.png`);
    await page.screenshot(file, rect);
    if (!box) { results[name] = null; return; }
    const image = decodePng(readFileSync(file));
    let l = 0, r = 0, g = 0, n = 0;
    for (let y = box[1]!; y < box[3]!; y++) for (let x = box[0]!; x < box[2]!; x++) {
      const i = (y * image.width + x) * 4, R = linear(image.data[i]!), G = linear(image.data[i + 1]!), B = linear(image.data[i + 2]!);
      l += 0.2126 * R + 0.7152 * G + 0.0722 * B; r += R; g += G; n++;
    }
    results[name] = { luminance: Math.round(l / n * 1e5) / 1e5, rg: Math.round(r / Math.max(g, 1e-6) * 100) / 100 };
    console.log(name.padEnd(30), JSON.stringify(results[name]));
  };
  await run({ kind: "preview.setLightingPreset", preset: "creator" });
  await run({ kind: "camera.restore", camera });
  await capture("creator-scatter");
  // The head's normal map off (geometric normals): whether the crease's light comes from the map's detail or from the geometry.
  await run({ kind: "preview.setNormals", enabled: false });
  await capture("creator-nonormals");
  await run({ kind: "preview.setNormals", enabled: true });
  // Without the character contact shadows (PREV-147): what they take away.
  await page.evaluate(`window.xfStudioCreatorRig.contact?.(false)`);
  await capture("creator-nocontact");
  await page.evaluate(`window.xfStudioCreatorRig.contact?.(true)`);
  if (!quick) {
    for (const mode of [false, "bare"] as const) {
      await page.evaluate(`window.xfStudioCreatorRig.scatter(${JSON.stringify(mode)})`);
      await capture(`creator-${mode === false ? "wrap" : "bare"}`);
    }
    await page.evaluate(`window.xfStudioCreatorRig.scatter(true)`);
    await run({ kind: "preview.setCreatorShadows", enabled: false });
    await capture("creator-noshadow");
    await run({ kind: "preview.setCreatorShadows", enabled: true });
    const lights: { name: string }[] = await page.evaluate(`window.xfStudioCreatorRig.lights()`);
    for (const { name } of lights) {
      await page.evaluate(`window.xfStudioCreatorRig.solo(${JSON.stringify(name)})`);
      await capture(`solo-${name}`);
    }
    // The key alone without its contact shadows: what they take away (PREV-147).
    await page.evaluate(`window.xfStudioCreatorRig.solo("Main_Face")`);
    await page.evaluate(`window.xfStudioCreatorRig.contact?.(false)`);
    await capture("solo-Main_Face-nocontact");
    await page.evaluate(`window.xfStudioCreatorRig.solo(null)`);
    await page.evaluate(`window.xfStudioCreatorRig.contact?.(true)`);
    await page.evaluate(`window.xfStudioCreatorRig.solo(null)`);
    await run({ kind: "preview.setLightingPreset", preset: "studio" });
    await run({ kind: "camera.restore", camera });
    await capture("studio-scatter");
  }
  writeFileSync(resolve(out, "crease.json"), JSON.stringify({ date: new Date().toISOString(), camera, rect, box, results,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 40) }, null, 1));
} finally { await page.close(); }
