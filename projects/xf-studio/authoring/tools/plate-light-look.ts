/**
 * Board 1 under the preview's lighting: fixed-camera captures of experiment 016's flat-finish board (Matte, Satin, Glossy on the
 * left lid; Metallic, Glossy, Matte on the right) in an isolated `?verify=1` workspace with disposable data and a throwaway Chrome
 * profile, under both lighting presets and several studio key-light angles, with per-stripe luminance statistics.
 *
 *   bun tools/plate-light-look.ts <out dir under evidence/screenshots> [port] [light|dark]
 *
 * Each stripe is found from its own key frame (that stripe alone, black Matte) against a bare frame (no layers). Per stripe
 * and frame it writes the median, 95th percentile and maximum of linear luminance (Rec. 709 weights on sRGB-decoded pixels), and
 * the bare skin's median at the same pixels. Outputs are private renders of local game assets: keep them in the ignored
 * evidence/screenshots tree.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../src/png";
import { launch, startServer } from "./cdp";

const [outArg, portArg = "4461", schemeArg = "dark"] = process.argv.slice(2);
if (!outArg || (schemeArg !== "light" && schemeArg !== "dark"))
  throw Error("Usage: bun tools/plate-light-look.ts <out dir> [port] [light|dark]");
const out = resolve(outArg), port = +portArg, scheme: "light" | "dark" = schemeArg;
mkdirSync(out, { recursive: true });

type Layer = Record<string, unknown> & { name: string; finish: string; color: string };
const collection = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/016-finish-board/finish-board.collection.json"), "utf8"));
const board: { schema: string; uv: string; layers: Layer[] } = collection.presets[0].recipe;
const keyRecipe = (layer: Layer) => ({ ...board, layers: [{ ...layer, finish: "matte", optics: undefined, color: "#000000" }] });
const recipes: Record<string, unknown> = { bare: { ...board, layers: [] }, board,
  ...Object.fromEntries(board.layers.map((layer, i) => [`key${i}`, keyRecipe(layer)])) };
for (const [name, recipe] of Object.entries(recipes)) writeFileSync(resolve(out, `${name}.recipe.json`), JSON.stringify(recipe));

const camera = { position: [0, 1.706, -0.36], target: [0, 1.703, 0], fov: 22 };
const frames: { name: string; preset: "studio" | "creator"; angle?: number }[] = [
  { name: "studio-0", preset: "studio", angle: 0 }, { name: "studio-60", preset: "studio", angle: 60 },
  { name: "studio-300", preset: "studio", angle: 300 }, { name: "creator", preset: "creator" },
];

const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 2400, height: 900, scheme, debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const settle = async () => {
  await page.wait(1500);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 30000);
  await page.wait(300);
};
async function importRecipe(name: string) {
  await page.chooseFiles([resolve(out, `${name}.recipe.json`)]);
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
  await page.wait(2500);
}
const canvasRect = () => page.evaluate(`(() => { const c = document.querySelector("#device-head canvas") ?? [...document.querySelectorAll("canvas")]
  .sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);

const linear = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luma = (d: Uint8Array, i: number) => 0.2126 * linear(d[i]!) + 0.7152 * linear(d[i + 1]!) + 0.0722 * linear(d[i + 2]!);
const percentile = (values: number[], p: number) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };

try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 180000);
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setHair", enabled: false }])
    await run(action).catch(() => undefined);
  await page.wait(8000); // the default V's details
  const rect = await canvasRect();
  const images: Record<string, ReturnType<typeof decodePng>> = {};
  for (const recipe of Object.keys(recipes)) {
    await importRecipe(recipe);
    for (const frame of recipe.startsWith("key") ? frames.slice(0, 1) : frames) {
      await run({ kind: "preview.setLightingPreset", preset: frame.preset });
      if (frame.angle !== undefined) await run({ kind: "preview.setKeyAngle", degrees: frame.angle });
      await run({ kind: "camera.restore", camera });
      await settle();
      const file = resolve(out, `${recipe}-${frame.name}.png`);
      await page.screenshot(file, rect);
      images[`${recipe}-${frame.name}`] = decodePng(readFileSync(file));
    }
  }
  // Stripe masks: where the stripe's own key frame darkens the bare frame, and its 5 × 5 neighbourhood agrees (feathered edges,
  // seams with the next stripe and the lashes in front drop out).
  const bare = images["bare-studio-0"]!, { width, height } = bare;
  const label = new Int8Array(width * height).fill(-1);
  board.layers.forEach((_, i) => {
    const key = images[`key${i}-studio-0`]!;
    for (let p = 0; p < width * height; p++) if (luma(bare.data, p * 4) - luma(key.data, p * 4) > 0.05) label[p] = label[p] === -1 ? i : -2;
  });
  const inner = new Int8Array(width * height).fill(-1);
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const l = label[y * width + x]!;
    if (l < 0) continue;
    let same = true;
    for (let dy = -2; dy <= 2 && same; dy++) for (let dx = -2; dx <= 2; dx++) if (label[(y + dy) * width + x + dx] !== l) { same = false; break; }
    if (same) inner[y * width + x] = l;
  }
  const stats = board.layers.map((layer, i) => {
    const pixels: number[] = [];
    inner.forEach((l, p) => { if (l === i) pixels.push(p); });
    const per = Object.fromEntries(frames.map(frame => {
      const made = images[`board-${frame.name}`]!, skin = images[`bare-${frame.name}`]!;
      const values = pixels.map(p => luma(made.data, p * 4)), under = pixels.map(p => luma(skin.data, p * 4));
      const round = (v: number) => Math.round(v * 10000) / 10000;
      return [frame.name, { median: round(percentile(values, .5)), p95: round(percentile(values, .95)), max: round(Math.max(0, ...values)),
        bareMedian: round(percentile(under, .5)), bareP95: round(percentile(under, .95)) }];
    }));
    return { stripe: layer.name, finish: layer.finish, pixels: pixels.length, frames: per };
  });
  const evidence = await page.evaluate(`window.xfStudioSceneEvidence?.()?.plateBlend ?? null`);
  const gpu = await page.evaluate(`(() => { const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown"; })()`);
  writeFileSync(resolve(out, "stats.json"), JSON.stringify({ date: new Date().toISOString(), scheme, gpu, camera, frames, stats, plateBlend: evidence,
    console: page.console.filter(m => m.type === "error" || m.type === "warning").slice(0, 40) }, null, 2));
  for (const s of stats) console.log(s.stripe.padEnd(28), String(s.pixels).padStart(6), Object.entries(s.frames)
    .map(([name, f]) => `${name} ${f.median.toFixed(3)}/${f.p95.toFixed(3)} (bare ${f.bareMedian.toFixed(3)})`).join("  "));
} finally { await page.close(); server.kill(); }
