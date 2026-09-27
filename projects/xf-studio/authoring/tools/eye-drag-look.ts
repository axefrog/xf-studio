/**
 * Drags an eyeliner point from the upper lash line across the eye opening to the lower lid on the default V, in an isolated
 * `?verify=1` workspace (throwaway Chrome profile, disposable workspace data), and captures a frame sequence. It checks the eye
 * opening drag fix (research/authoring/editor-invariants.md, "Eye openings"): the lash-line point near the outer corner must be
 * grabbable where it is drawn, follow the pointer over the eyeball and land on the lower lid, as one Undo step.
 *
 *   bun tools/eye-drag-look.ts <out dir under evidence/screenshots> [port]
 *
 * The recipe is built from the prepared preview's plate: an eyeliner along the upper lash line of the +x eye (the screen-left eye
 * seen from the front), its first point on the lash line three quarters of the way to the outer corner. Outputs are private renders
 * of local game assets: keep them in the ignored evidence/screenshots tree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { launch, startServer } from "./cdp";
import { uvHoleBridges } from "../src/surface-map";
import { initialRecipe } from "../src/features/eye-makeup/region";
import { portableRecipe } from "../src/recipe-schema";
import type { Layer } from "../src/engines/layered-makeup/recipe";

const [outArg, portArg = "4391"] = process.argv.slice(2);
if (!outArg) throw Error("Usage: bun tools/eye-drag-look.ts <out dir> [port]");
const out = resolve(outArg), port = +portArg;
mkdirSync(out, { recursive: true });

// The prepared preview's plate, at rest: where the lash line lies in UV.
const cache = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"));
const status = JSON.parse(await Bun.file(resolve(cache, "status.json")).text());
const gltf = await new GLTFLoader().parseAsync(await Bun.file(resolve(cache, status.cacheName, "assets", "head.glb")).arrayBuffer(), "");
const plate = gltf.scene.getObjectByName("makeup_plate") as THREE.Mesh;
gltf.scene.updateMatrixWorld(true);
const position = plate.geometry.getAttribute("position"), uv = plate.geometry.getAttribute("uv");
const world = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(plate.matrixWorld);
const rim = [...new Set(uvHoleBridges(plate.geometry).flat())].filter(i => world(i).x > 0);
const centre = rim.map(world).reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(rim.length);
const xs = rim.map(i => world(i).x), inner = Math.min(...xs), outer = Math.max(...xs);
const upper = rim.filter(i => world(i).y > centre.y);
const lowerY = Math.min(...rim.map(i => world(i).y));
const nearestUpper = (f: number) => upper.slice().sort((a, b) => Math.abs(world(a).x - (inner + (outer - inner) * f)) - Math.abs(world(b).x - (inner + (outer - inner) * f)))[0];
const nearestVertex = (p: THREE.Vector3) => {
  let best = 0, distance = Infinity;
  for (let i = 0; i < position.count; i++) { const d = world(i).distanceTo(p); if (d < distance) { distance = d; best = i; } }
  return best;
};
const uvOf = (i: number) => ({ u: uv.getX(i), v: uv.getY(i) });
const lash = [0.75, 0.93, 0.1, 0.3, 0.5].map(nearestUpper);
const above = [0.93, 0.75, 0.5, 0.3, 0.1].map(f => uvOf(nearestVertex(world(nearestUpper(f)).add(new THREE.Vector3(0, 0.0022, 0)))));
// Contour: the lash-line point (index 0), on to the outer end, back along the upper edge, down and along the lash line home.
const contour = [uvOf(lash[0]), uvOf(lash[1]), ...above, uvOf(lash[2]), uvOf(lash[3]), uvOf(lash[4])];
const recipe = initialRecipe();
const layer = recipe.layers[0] as Layer;
layer.pathMode = "bezier"; layer.symmetry = true; layer.fields = [];
layer.points = contour.map((p, i) => {
  const prev = contour[(i + contour.length - 1) % contour.length], next = contour[(i + 1) % contour.length];
  const t = { u: (next.u - prev.u) / 6, v: (next.v - prev.v) / 6 };
  return { ...p, weight: 1, handles: { in: { u: -t.u, v: -t.v }, out: t, mode: "symmetric" as const } };
});
recipe.layers = [layer];
const recipeFile = resolve(out, "eye-drag.recipe.json");
writeFileSync(recipeFile, JSON.stringify(portableRecipe(recipe), null, 2));

const camera = { position: [centre.x, centre.y + 0.001, centre.z - 0.15], target: [centre.x, centre.y, centre.z], fov: 12 };
const { server } = await startServer(port);
const page = await launch(`http://127.0.0.1:${port}/?verify=1`, { width: 1100, height: 800, scheme: "dark", debugPort: port + 5000 });
const run = (action: object) => page.evaluate(`window.xfStudioShell.runtime.dispatch(${JSON.stringify(action)})`);
const report: Record<string, unknown> = { date: new Date().toISOString(), camera, recipe: "eye-drag.recipe.json", frames: [] };
const contextAt = (x: number, y: number) => page.evaluate(`window.xfStudioPresentation.viewport.contextAt("head", ${x}, ${y}) ?? null`);
try {
  await page.waitFor("document.querySelector('.dock-group') && window.xfStudioPresentation?.viewport.snapshot().head.phase === 'ready'", 240000);
  // Head only (no body, clothes or hair): a smaller run, and nothing that matters to the lids.
  for (const action of [{ kind: "preview.setBody", enabled: false }, { kind: "preview.setHair", enabled: false }])
    await run(action).catch(error => console.log("action:", action.kind, error.message));
  await page.waitFor("window.xfStudioPresentation.previewReadiness.snapshot().phase === 'ready'", 180000);
  await page.chooseFiles([recipeFile]);
  await page.send("Runtime.evaluate", { expression: `window.xfStudioShell.runtime.file({ kind: "recipe.import" })`, awaitPromise: true, userGesture: true });
  await page.wait(1500);
  for (const action of [{ kind: "motion.setIdle", enabled: false }, { kind: "preview.setSurfaceControls", enabled: true },
    { kind: "camera.restore", camera }])
    await run(action).catch(error => console.log("action:", (action as { kind: string }).kind, error.message));
  const layerId = await page.evaluate(`window.xfStudioPresentation.feature("eye-makeup").view().layer()?.id ?? null`).catch(() => null);
  if (layerId) await run({ kind: "point.select", layerId, index: 0 }).catch(() => undefined);
  await page.wait(1500);
  const rect = await page.evaluate(`(() => { const r = document.querySelector('#device-head canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`) as { x: number; y: number; width: number; height: number };
  // Where the camera shows a world point (the head is at rest: idle off, default V's own face shapes aside).
  const view = new THREE.PerspectiveCamera(camera.fov, rect.width / rect.height, 0.01, 10);
  view.position.fromArray(camera.position); view.lookAt(new THREE.Vector3().fromArray(camera.target)); view.updateMatrixWorld();
  const screen = (p: THREE.Vector3) => { const s = p.clone().project(view); return [rect.x + (s.x + 1) / 2 * rect.width, rect.y + (1 - s.y) / 2 * rect.height]; };
  // Find the point where it is drawn: search outward from its rest projection for the pick, then take the pick region's centre.
  const [gx, gy] = screen(world(lash[0]));
  let found: number[] | undefined;
  for (let r = 0; r <= 90 && !found; r += 6)
    for (let a = 0; a < (r ? 2 * Math.PI : 0.1) && !found; a += r ? 6 / r : 1) {
      const x = gx + r * Math.cos(a), y = gy + r * Math.sin(a), hit = await contextAt(x, y) as { affordance?: string; target?: { index?: number } } | null;
      if (hit?.affordance === "point" && JSON.stringify(hit).includes('"index":0')) found = [x, y];
    }
  // Not pickable (the reported defect): still press where it rests, to record that nothing moves.
  const inside: number[][] = [];
  if (found) for (let dx = -14; dx <= 14; dx += 2) for (let dy = -14; dy <= 14; dy += 2) {
    const hit = await contextAt(found[0] + dx, found[1] + dy);
    if (hit?.affordance === "point" && JSON.stringify(hit).includes('"index":0')) inside.push([found[0] + dx, found[1] + dy]);
  }
  const start = inside.length ? [inside.reduce((s, p) => s + p[0], 0) / inside.length, inside.reduce((s, p) => s + p[1], 0) / inside.length] : [gx, gy];
  const [, endY] = screen(new THREE.Vector3(world(lash[0]).x, lowerY - 0.003, centre.z));
  const end = [start[0], endY];
  report.pick = { pickable: !!found, guess: [gx, gy], start, end, pickPixels: inside.length };
  const recipeNow = () => page.evaluate(`JSON.stringify(window.xfStudioPresentation.feature("eye-makeup").view().layer()?.points?.[0] ?? null)`);
  const depth = () => page.evaluate(`window.xfStudioPresentation.authoring.history().depth`);
  const depthBefore = await depth();
  const clip = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  await page.screenshot(resolve(out, "00-before.png"), clip);
  const steps = 40, frames = report.frames as unknown[];
  await page.mouse("mouseMoved", start[0], start[1], { button: "none", buttons: 0 });
  await page.wait(200);
  await page.mouse("mousePressed", start[0], start[1]);
  for (let i = 1; i <= steps; i++) {
    const x = start[0] + (end[0] - start[0]) * i / steps, y = start[1] + (end[1] - start[1]) * i / steps;
    await page.mouse("mouseMoved", x, y);
    await page.wait(40);
    if (i % 5 === 0) {
      await page.wait(250);
      const name = `${String(i / 5).padStart(2, "0")}-drag.png`;
      await page.screenshot(resolve(out, name), clip);
      frames.push({ name, pointer: [x, y], point: JSON.parse(await recipeNow() ?? "null") });
    }
  }
  await page.mouse("mouseReleased", end[0], end[1], { buttons: 0 });
  await page.wait(800);
  await page.mouse("mouseMoved", rect.x + 20, rect.y + 20, { button: "none", buttons: 0 });
  await page.wait(500);
  await page.screenshot(resolve(out, "99-after.png"), clip);
  report.after = JSON.parse(await recipeNow() ?? "null");
  report.undoSteps = (await depth() as number) - (depthBefore as number);
  report.undoLabel = await page.evaluate(`window.xfStudioPresentation.authoring.history().undo ?? null`);
  // Back up into the opening and release there: a control inside the opening draws on its bridge, over the eye. Captured in
  // both UI themes (the whole window) for the overlay's look.
  const opening = [start[0], (start[1] + end[1]) / 2 - (end[1] - start[1]) * 0.1];
  await page.drag(end as [number, number], opening as [number, number], { steps: 24 });
  await page.mouse("mouseMoved", rect.x + 20, rect.y + 20, { button: "none", buttons: 0 });
  await page.wait(800);
  report.inOpening = JSON.parse(await recipeNow() ?? "null");
  await page.screenshot(resolve(out, "opening-dark.png"));
  await page.colorScheme("light");
  await page.wait(800);
  await page.screenshot(resolve(out, "opening-light.png"));
  report.console = page.console.filter(entry => entry.type === "error" || entry.type === "warning").slice(0, 20);
} finally {
  writeFileSync(resolve(out, "report.json"), JSON.stringify(report, null, 2));
  await page.close();
  server.kill();
}
console.log(JSON.stringify({ pick: report.pick, after: report.after, undoSteps: report.undoSteps, frames: (report.frames as unknown[]).length }, null, 1));
