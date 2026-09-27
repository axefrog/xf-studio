/**
 * The plate edge on the forehead (PREV ledger: the plate-seam row): close-up captures of the expanded eye plate's top boundary above the
 * brows, with a dark smoky Matte layer whose soft edge reaches the plate's top, in an isolated `?verify=1` workspace (throwaway Chrome
 * profile) on an already running server, under both lighting families with the skin scatter on, off (the wrap) and bare, plus a
 * no-makeup frame. For each frame it writes the crop and a vertical luminance profile (linear Rec. 709 luminance per row, averaged over
 * a column band) across the edge, and the largest row-to-row step inside the edge band.
 *
 *   bun tools/plate-seam-look.ts <out dir under evidence/screenshots> <port> [save copy|-] [--ui]
 *
 * The save copy (a `sav.dat`) is read in the browser only; outputs are private renders of local game assets: keep them in the ignored
 * evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng, encodePng, type RgbaImage } from "../src/png";
import { launch } from "./cdp";

const argv = process.argv.slice(2), uiAt = argv.indexOf("--ui"), ui = uiAt >= 0 && !!argv.splice(uiAt, 1);
const [outArg, portArg, saveArg = "-"] = argv;
if (!outArg || !portArg) throw Error("Usage: bun tools/plate-seam-look.ts <out dir> <port> [save copy|-]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });

const point = (u: number, v: number) => ({ u, v, weight: 1, handles: { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } });
// A soft smoky wash whose feather runs past the plate's top edge (as a wide-feathered wash above the crease does): black Matte at 0.6.
const smoky = { id: "seam-smoky", name: "Smoky", enabled: true, color: "#000000", finish: "matte", opacity: 0.6, feather: 0.06, symmetry: true,
  pathMode: "bezier", points: [point(0.328, 0.201), point(0.431, 0.201), point(0.431, 0.238), point(0.328, 0.238)], fields: [],
  strength: { mode: "smooth-boundary", blend: 0.0005 }, softness: { mode: "uniform" } };
const recipes: Record<string, unknown> = { bare: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [] },
  smoky: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [smoky] } };
// `SEAM_RECIPES=name=path,...`: more recipes (a private copy of a real look, never committed).
for (const entry of (process.env.SEAM_RECIPES ?? "").split(",").filter(Boolean)) {
  const [name, path] = entry.split("=");
  recipes[name!] = JSON.parse(readFileSync(resolve(path!), "utf8"));
}
for (const [name, recipe] of Object.entries(recipes)) writeFileSync(resolve(out, `${name}.recipe.json`), JSON.stringify(recipe));

// The left brow (V's right) and the forehead above it, from the front.
const camera = process.env.SEAM_CAMERA ? JSON.parse(process.env.SEAM_CAMERA) : { position: [0.032, 1.708, -0.25], target: [0.032, 1.708, -0.068], fov: 10 };
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1100, height: 760, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`Promise.resolve(window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)}))`);
const settle = async (ms = 1500) => {
  await page.wait(ms);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 60000).catch(() => undefined);
  await page.wait(400);
};
const linear = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luma = (d: Uint8Array, i: number) => 0.2126 * linear(d[i]!) + 0.7152 * linear(d[i + 1]!) + 0.0722 * linear(d[i + 2]!);

frames: try {
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
  if (ui) {
    // `--ui`: the editor as the person sees it with each recipe (the Layers row's flag and the UV map's marked plate edge), then stop.
    for (const recipe of Object.keys(recipes)) {
      await page.chooseFiles([resolve(out, `${recipe}.recipe.json`)]);
      await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
      await page.wait(4000);
      await page.evaluate(`document.getElementById("dock-tab-uv")?.click()`);
      await settle();
      await page.screenshot(resolve(out, `ui-${recipe}.png`));
      const flags = await page.evaluate(`[...document.querySelectorAll(".item-row")].map(row => { const flag = row.querySelector(".finish-flag");
        return flag && !flag.hidden ? { name: row.querySelector(".item-name")?.textContent, reason: flag.dataset.reason, title: flag.title } : null; }).filter(Boolean)`);
      console.log(recipe, JSON.stringify(flags));
    }
    break frames;
  }
  await page.evaluate(`(() => { const g = document.getElementById("dock-tab-head")?.closest("[data-group]");
    if (g) window.xfStudioShell.dock.toggleMaximize(g.dataset.group); })()`);
  await page.wait(3000);
  const rect = await page.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
    const g = document.getElementById("dock-tab-head")?.closest("[data-group]") ?? document;
    const c = [...g.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const results: Record<string, unknown> = {};
  const capture = async (name: string) => {
    await settle();
    const file = resolve(out, `${name}.png`);
    await page.screenshot(file, rect);
    const image = decodePng(readFileSync(file));
    // Rows of the middle fifth of the columns: the profile across the (horizontal) plate edge.
    const x0 = Math.floor(image.width * 0.4), x1 = Math.floor(image.width * 0.6);
    const rows: number[] = [];
    for (let y = 0; y < image.height; y++) {
      let sum = 0;
      for (let x = x0; x < x1; x++) sum += luma(image.data, (y * image.width + x) * 4);
      rows.push(Math.round(sum / (x1 - x0) * 1e5) / 1e5);
    }
    results[name] = { rows };
    images[name] = image;
  };
  const images: Record<string, RgbaImage> = {};
  for (const recipe of Object.keys(recipes)) {
    await page.chooseFiles([resolve(out, `${recipe}.recipe.json`)]);
    await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
    await page.wait(4000);
    for (const preset of ["creator", "studio"] as const) {
      await run({ kind: "preview.setLightingPreset", preset });
      await run({ kind: "camera.restore", camera });
      for (const mode of [true, false, "bare"] as const) {
        await page.evaluate(`window.xfStudioCreatorRig.scatter(${JSON.stringify(mode)})`);
        await capture(`${recipe}-${preset}-${mode === true ? "scatter" : mode === false ? "wrap" : "bare"}`);
      }
      await page.evaluate(`window.xfStudioCreatorRig.scatter(true)`);
    }
    await run({ kind: "preview.setLightingPreset", preset: "creator" });
    await run({ kind: "preview.setCreatorShadows", enabled: false });
    await capture(`${recipe}-creator-noshadow`);
    await run({ kind: "preview.setCreatorShadows", enabled: true });
  }
  // What the makeup does to each pixel: luminance over the bare frame's, written as grey (1 = mid grey, ±0.25 = black or white), so
  // the plate's edge shows as a line wherever the ratio steps there. `edge` per frame: the largest row-to-row step of the ratio profile.
  const ratios: Record<string, { rows: number[]; edge: { row: number; step: number } }> = {};
  for (const name of Object.keys(images)) {
    if (name.startsWith("bare-")) continue;
    const bare = images[name.replace(/^[^-]+-/, "bare-")], made = images[name]!;
    if (!bare || bare.width !== made.width || bare.height !== made.height) continue;
    const { width, height } = made, grey = new Uint8Array(width * height * 4), rows: number[] = [];
    const x0 = Math.floor(width * 0.4), x1 = Math.floor(width * 0.6);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, ratio = luma(made.data, i) / Math.max(1e-4, luma(bare.data, i));
        const g = Math.max(0, Math.min(255, Math.round(128 + (ratio - 1) * 512)));
        grey[i] = grey[i + 1] = grey[i + 2] = g; grey[i + 3] = 255;
        if (x >= x0 && x < x1) sum += ratio;
      }
      rows.push(Math.round(sum / (x1 - x0) * 1e4) / 1e4);
    }
    let edge = { row: 0, step: 0 };
    for (let y = 1; y < rows.length; y++) if (Math.abs(rows[y]! - rows[y - 1]!) > Math.abs(edge.step)) edge = { row: y, step: Math.round((rows[y]! - rows[y - 1]!) * 1e4) / 1e4 };
    ratios[name] = { rows, edge };
    writeFileSync(resolve(out, `${name}.ratio.png`), encodePng({ width, height, data: grey }, { alpha: false }));
    console.log(name.padEnd(28), "largest row step of the ratio", edge.step, "at row", edge.row);
  }
  writeFileSync(resolve(out, "profiles.json"), JSON.stringify({ date: new Date().toISOString(), camera, rect, results, ratios,
    plateBlend: await page.evaluate(`window.xfStudioSceneEvidence?.()?.plateBlend ?? null`),
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 40) }, null, 1));
  console.log("wrote", Object.keys(results).length, "frames to", out);
} finally { await page.close(); }
