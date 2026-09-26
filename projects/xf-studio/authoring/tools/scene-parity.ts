/**
 * Makeup screenshot parity for scene refactors (feature-module platform step 7): fixed-camera captures of experiment 016's Board 1
 * (flat finishes), Board 2 (Shimmer), Board 3 (colour shift) and a Shimmer-over-Glossy look, under both lighting presets and at
 * the 1K and 2K preview sizes, in an isolated `?verify=1` workspace with disposable data and a throwaway Chrome profile.
 *
 *   bun tools/scene-parity.ts capture <out dir under evidence/screenshots> [port]
 *   bun tools/scene-parity.ts compare <after dir> <base dir> [<another base dir> …] [--ignore x0,y0,x1,y1]
 *
 * `--ignore` leaves one rectangle of every frame out of the comparison (inclusive pixel bounds), for a deliberate change to the viewport's
 * overlaid controls (a new toolbar button) that is not the 3D view; the report names it.
 *
 * Capture the code before the change (twice or more: the first creator frame can differ between runs of the same build by a few pixels
 * one step apart) and after it, then compare: every frame after must match one of the base captures pixel for pixel (PREV-98). Outputs
 * are private renders of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../src/png";
import { launch, startServer } from "./cdp";

const argv = process.argv.slice(2), ignoreAt = argv.indexOf("--ignore");
const ignore = ignoreAt >= 0 ? argv.splice(ignoreAt, 2)[1]!.split(",").map(Number) as [number, number, number, number] : null;
if (ignore && (ignore.length !== 4 || ignore.some(n => !Number.isInteger(n)))) throw Error("--ignore takes x0,y0,x1,y1");
const [mode, first, second, ...more] = argv;

/** How two frames differ: `size` when their sizes do, else the differing pixels and the largest channel step. */
function difference(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>) {
  if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}x${a.height} vs ${b.width}x${b.height}`, pixels: -1, max: 0 };
  let pixels = 0, max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const x = (i >> 2) % a.width, y = Math.floor((i >> 2) / a.width);
    if (ignore && x >= ignore[0] && x <= ignore[2] && y >= ignore[1] && y <= ignore[3]) continue;
    const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!));
    if (d) { pixels++; max = Math.max(max, d); }
  }
  return { size: null, pixels, max };
}

if (mode === "compare") {
  if (!first || !second) throw Error("Usage: bun tools/scene-parity.ts compare <after dir> <base dir> [<another base dir> …]");
  const bases = [second, ...more];
  const frames = readdirSync(resolve(first)).filter(file => file.endsWith(".png")).sort();
  let failed = 0;
  for (const file of frames) {
    const after = decodePng(readFileSync(resolve(first, file)));
    const results = bases.map(base => ({ base, ...difference(after, decodePng(readFileSync(resolve(base, file)))) }));
    const match = results.find(result => !result.size && result.pixels === 0);
    if (!match) failed++;
    const nearest = results.reduce((best, result) => result.size ? best : !best || result.pixels < best.pixels ? result : best, undefined as typeof results[number] | undefined);
    console.log(`${file.padEnd(40)} ${match ? `identical to ${bases.length > 1 ? match.base : "the base"}`
      : nearest ? `DIFFERS: ${nearest.pixels} pixels, max ${nearest.max} (nearest ${nearest.base})` : `DIFFERS: size ${results[0]!.size}`}`);
  }
  console.log(`${frames.length} frames, ${failed} match none of ${bases.length} base capture${bases.length > 1 ? "s" : ""}` +
    (ignore ? ` (pixels ${ignore[0]}–${ignore[2]} × ${ignore[1]}–${ignore[3]} left out)` : ""));
  process.exit(failed ? 1 : 0);
}

if (mode !== "capture" || !first) throw Error("Usage: bun tools/scene-parity.ts capture <out dir> [port]");
const out = resolve(first), port = +(second ?? "4471");
mkdirSync(out, { recursive: true });

type Layer = Record<string, unknown> & { id: string; name: string; finish: string };
const collection = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/016-finish-board/finish-board.collection.json"), "utf8"));
const boards: { schema: string; uv: string; layers: Layer[] }[] = collection.presets.map((preset: { recipe: unknown }) => preset.recipe);
const [board1, board2, board3] = boards as [typeof boards[0], typeof boards[0], typeof boards[0]];
const glossy = board1.layers.find(layer => layer.finish === "glossy")!, shimmer = board2.layers.find(layer => layer.finish === "shimmer")!;
// Shimmer over Glossy: the Glossy stripe, and the fine Shimmer with its own colour, flakes and optics on the same shape above it.
const shimmerOverGlossy = { ...board1, layers: [glossy, { ...glossy, id: "parity-shimmer", name: "Shimmer over Glossy", finish: shimmer.finish,
  color: shimmer.color, optics: shimmer.optics, flakes: shimmer.flakes }] };
const recipes: Record<string, unknown> = { bare: { ...board1, layers: [] }, board1, board2, board3, "shimmer-over-glossy": shimmerOverGlossy };
for (const [name, recipe] of Object.entries(recipes)) writeFileSync(resolve(out, `${name}.recipe.json`), JSON.stringify(recipe));

const camera = { position: [0, 1.706, -0.36], target: [0, 1.703, 0], fov: 22 };
const presets = ["studio", "creator"] as const;
const sizes = [1024, 2048] as const;

const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1600, height: 900, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const settle = async () => {
  await page.waitFor("window.xfStudioPresentation.previewReadiness.snapshot().phase === 'ready'", 120000);
  // The creator preset's grade arrives from the host after the preset turns on; the neutral grade shows until then.
  await page.waitFor("window.xfStudioPresentation.authoring.previewState().lighting?.lut.phase !== 'loading'", 60000);
  await page.wait(800);
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return e && !e.frames.running; })()", 30000);
  await page.wait(300);
};
async function importRecipe(name: string) {
  await page.chooseFiles([resolve(out, `${name}.recipe.json`)]);
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
  await page.wait(1500);
}
const canvasRect = () => page.evaluate(`(() => { const c = document.querySelector("#device-head canvas"); const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);

try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 180000);
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: false }, { kind: "preview.setHair", enabled: false }])
    await run(action).catch(() => undefined);
  // The default V's details (skin, eyes, brows, lashes) must be on before any frame is kept.
  await page.waitFor("(() => { const e = window.xfStudioSceneEvidence?.(); return !!e && e.characterDetails.components.length > 0; })()", 180000);
  await page.wait(2000);
  const rect = await canvasRect();
  const evidence: Record<string, unknown> = {};
  for (const size of sizes) {
    await run({ kind: "quality.set", size });
    for (const recipe of Object.keys(recipes)) {
      await importRecipe(recipe);
      for (const preset of presets) {
        await run({ kind: "preview.setLightingPreset", preset });
        await run({ kind: "camera.restore", camera });
        await settle();
        const name = `${recipe}-${preset}-${size}`;
        await page.screenshot(resolve(out, `${name}.png`), rect);
        evidence[name] = await page.evaluate(`window.xfStudioSceneEvidence()?.plateBlend ?? null`);
      }
    }
  }
  writeFileSync(resolve(out, "evidence.json"), JSON.stringify({ date: new Date().toISOString(), camera, rect, plateBlend: evidence,
    console: page.console.filter(m => m.type === "error" || m.type === "exception").slice(0, 40) }, null, 2));
  console.log(`Captured ${Object.keys(evidence).length} frames in ${out}`);
} finally { await page.close(); server.kill(); }
