/**
 * Measures where the eye sits on the eye plate's UV (the numbers `EYE_LANDMARKS` in src/features/eye-makeup/starters.ts restates), from the
 * game's own eye makeup. Read-only towards the game; prints JSON.
 *
 *   bun tools/eye-landmarks.ts [--male] [--head <path to a prepared preview's head.glb>]
 *
 * Game folder, launch route and WolvenKit come from the Studio's saved setup; the caches are this checkout's (`data/preview-cache`,
 * `data/resolver-cache`, or XFS_PREVIEW_CORE_CACHE and XFS_RESOLVER_CACHE); the styles it prepares are written there, so point them at a scratch copy.
 * The head comes from a prepared 3D preview in the same folder, or `--head`.
 *
 * Method (knowledge/face-makeup.md, "Landmarks of the eye in UV"):
 * - The vanilla character creator's 36 eye makeup styles are 36 textures (`hx_eyes_makeup_01_dNN`, RGBA, the alpha is the coverage) on ONE decal
 *   mesh whose UV is its own (both eyes overlap). Its vertices lie 0.40 mm over the head's, one to one, so each is matched to the nearest head
 *   vertex and takes its head UV; each style's alpha is then rasterised through the decal's triangles into head UV, exactly where the game
 *   paints it (the two default bodies share the head UV, so they give the same coverage).
 * - **Upper lash line (lid edge):** per u, the lowest covered v above the slit, median over the lid washes and clean liners (01, 03, 04, 05, 13, 14, 18, 19; styles with a lower prong or a graphic tail are left out). **Crease (the lid's
 *   fold):** the highest covered v of the lid washes (01, 03, 04, 13, 18, 19), median. **Lower lash line:** the first covered v below the slit of the
 *   lower-lid styles. Coverage is alpha above 0.5.
 * - **The slit and corners:** the plate's eye opening (`uvHoleBridges`): its rims fold onto each other in UV; the corners are the rim vertices
 *   nearest and farthest from the face's centre line.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { characterRequestOf } from "../src/character/character-detail-request";
import { CharacterDetailHost, type CharacterDetailSettings } from "../src/character/host/character-detail-host";
import { uvHoleBridges } from "../src/legacy/eye-makeup/browser/surface-map";
import { LocalSettingsStore } from "../src/setup/host/local-settings-store";

const male = process.argv.includes("--male"), body = male ? "male" : "female";
const headArg = process.argv.includes("--head") ? process.argv[process.argv.indexOf("--head") + 1] : undefined;
const data = resolve(import.meta.dir, "..", "data");
const cacheRoot = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(data, "preview-cache"));
const settings = new LocalSettingsStore().load().settings;
const hostSettings: CharacterDetailSettings = { gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root,
  mo2ProfileId: settings.mo2ProfileId, manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli };
const host = new CharacterDetailHost({ cacheRoot, resolverCache: resolve(process.env.XFS_RESOLVER_CACHE || resolve(data, "resolver-cache")), settings: () => hostSettings,
  log: () => {} });
await host.refresh();
await host.creator.ensure(body);

// 1. Prepare each style on the default V (a style already prepared is read from the cache), then read its decal's files from the records.
for (let n = 1; n <= 36; n++) {
  const key = String(n).padStart(2, "0");
  host.request(characterRequestOf({ bodyGender: body, saved: null }, [{ part: "head", option: "makeupEyes", choice: key, activates: [`makeupEyes_${key}`] }], ["head"]));
  await host.settled();
}
const files = resolve(cacheRoot, "characters", "files"), records = resolve(cacheRoot, "characters", "records");
const styles = new Map<number, { geometry: string; alpha: string }>();
for (const name of readdirSync(records)) {
  const text = readFileSync(resolve(records, name), "utf8");
  if (!text.includes("makeupEyes_")) continue;
  for (const component of JSON.parse(text).components ?? []) {
    const option = /^makeupEyes_(\d+)$/.exec(component.option ?? "");
    if (!option || /pma/.test(component.component) !== male) continue;
    const texture = component.materials?.[0]?.textures?.DiffuseTexture?.file;
    if (texture && component.geometry?.file) styles.set(Number(option[1]), { geometry: component.geometry.file, alpha: texture });
  }
}
if (styles.size !== 36) throw Error(`Only ${styles.size} of the 36 eye makeup styles were prepared.`);

// 2. The decal's head UV, vertex by vertex.
const load = async (path: string) => (await new GLTFLoader().parseAsync(await Bun.file(path).arrayBuffer(), "")).scene;
const meshes = (scene: THREE.Object3D) => { const found: THREE.Mesh[] = []; scene.traverse(item => { if ((item as THREE.Mesh).isMesh) found.push(item as THREE.Mesh); }); return found; };
const headFile = headArg ? resolve(headArg) : readdirSync(cacheRoot).filter(name => name.startsWith(`xfs-preview-core-${body}-average`)).map(name => resolve(cacheRoot, name, "assets", "head.glb"))[0];
if (!headFile) throw Error("No prepared 3D preview for this body.");
const head = await load(headFile), skin = meshes(head).find(mesh => mesh.name === "head")!;
head.updateMatrixWorld(true);
const hp = skin.geometry.getAttribute("position"), hu = skin.geometry.getAttribute("uv"), heads: number[][] = [];
for (let i = 0; i < hp.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(hp, i).applyMatrix4(skin.matrixWorld); heads.push([p.x, p.y, p.z, hu.getX(i), hu.getY(i)]); }
const cell = 0.004, grid = new Map<string, number[]>(), cellKey = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
heads.forEach((h, i) => { const key = cellKey(h[0]!, h[1]!, h[2]!); (grid.get(key) ?? grid.set(key, []).get(key)!).push(i); });
const nearestUv = (p: THREE.Vector3) => {
  let best = -1, distance = Infinity;
  const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
  for (let r = 1; r <= 4 && best < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++)
    for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { const h = heads[i]!, d = Math.hypot(h[0]! - p.x, h[1]! - p.y, h[2]! - p.z); if (d < distance) { distance = d; best = i; } }
  return { uv: [heads[best]![3]!, heads[best]![4]!], distance };
};
const geometry = [...new Set([...styles.values()].map(style => style.geometry))];
if (geometry.length !== 1) throw Error("The styles do not share one decal mesh.");
const decal = await load(resolve(files, geometry[0]!)), mesh = meshes(decal)[0]!;
decal.updateMatrixWorld(true);
const dp = mesh.geometry.getAttribute("position"), du = mesh.geometry.getAttribute("uv"), index = Array.from(mesh.geometry.index!.array);
const decalUv: number[][] = [], headUv: number[][] = [], lifts: number[] = [];
for (let i = 0; i < dp.count; i++) {
  const { uv, distance } = nearestUv(new THREE.Vector3().fromBufferAttribute(dp, i).applyMatrix4(mesh.matrixWorld));
  decalUv.push([du.getX(i), du.getY(i)]); headUv.push(uv); lifts.push(distance);
}
lifts.sort((a, b) => a - b);

// 3. Each style's alpha, through the decal's triangles, into head UV (u 0.27 to 0.5, v 0.17 to 0.33: the u < ½ eye).
function png(path: string) {
  const bytes = readFileSync(path);
  let at = 8, width = 0, height = 0; const parts: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.toString("latin1", at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw Error("Only 8-bit RGBA PNGs."); }
    if (type === "IDAT") parts.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * 4, out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, row = y * stride, source = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[row + x - 4]! : 0, b = y ? out[row - stride + x]! : 0, c = x >= 4 && y ? out[row - stride + x - 4]! : 0, v = raw[source + x]!;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[row + x] = (v + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { width, height, alpha: (x: number, y: number) => out[(y * width + x) * 4 + 3]! / 255 };
}
const U0 = 0.27, U1 = 0.5, V0 = 0.17, V1 = 0.33, W = 920, H = Math.floor(W * (V1 - V0) / (U1 - U0));
function raster(file: string) {
  const texture = png(resolve(files, file)), out = new Float32Array(W * H);
  for (let t = 0; t < index.length; t += 3) {
    const ids = [index[t]!, index[t + 1]!, index[t + 2]!], hp3 = ids.map(i => headUv[i]!), dp3 = ids.map(i => decalUv[i]!);
    if (hp3.some(p => !Number.isFinite(p[0]!)) || Math.min(...hp3.map(p => p[0]!)) > 0.5 || Math.max(...hp3.map(p => p[0]!)) < U0) continue;
    const px = hp3.map(p => (p[0]! - U0) / (U1 - U0) * W), py = hp3.map(p => (p[1]! - V0) / (V1 - V0) * H);
    const [ax, bx, cx] = px as [number, number, number], [ay, by, cy] = py as [number, number, number], den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(H - 1, Math.ceil(Math.max(ay, by, cy))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const X = x + 0.5, Y = y + 0.5, w1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den, w2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den, w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
        const u = w1 * dp3[0]![0]! + w2 * dp3[1]![0]! + w3 * dp3[2]![0]!, v = w1 * dp3[0]![1]! + w2 * dp3[1]![1]! + w3 * dp3[2]![1]!;
        const value = texture.alpha(Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width))), Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height))));
        if (value > out[y * W + x]!) out[y * W + x] = value;
      }
  }
  return out;
}
const coverage = new Map<number, Float32Array>();
for (const [n, style] of styles) coverage.set(n, raster(style.alpha));
const vOf = (y: number) => V0 + y / H * (V1 - V0), column = (n: number, u: number) => { const x = Math.floor((u - U0) / (U1 - U0) * W), c = coverage.get(n)!; return (y: number) => c[y * W + x]! > 0.5; };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1]! : NaN; };
const round = (value: number) => Math.round(value * 10000) / 10000;
const SLIT_LIMIT = 0.2562, WASHES = [1, 3, 4, 13, 18, 19], UPPER = [1, 3, 4, 5, 13, 14, 18, 19], LOWER = [7, 10, 15, 18, 19, 20, 22, 27, 34];
const crease: number[][] = [], upperLashLine: number[][] = [], lowerLashLine: number[][] = [];
for (let u = 0.43; u > 0.3495; u -= 0.01) {
  const tops: number[] = [], edges: number[] = [], lowers: number[] = [];
  for (const n of WASHES) { const c = column(n, u), ys = [...Array(H).keys()].filter(y => c(y) && vOf(y) < SLIT_LIMIT); if (ys.length) tops.push(vOf(ys[0]!)); }
  for (const n of UPPER) { const c = column(n, u), ys = [...Array(H).keys()].filter(y => c(y) && vOf(y) < SLIT_LIMIT); if (ys.length) edges.push(vOf(ys.at(-1)!)); }
  for (const n of LOWER) { const c = column(n, u), ys = [...Array(H).keys()].filter(y => c(y) && vOf(y) > SLIT_LIMIT); if (ys.length) lowers.push(vOf(ys[0]!)); }
  crease.push([round(u), round(median(tops))]); upperLashLine.push([round(u), round(median(edges))]); lowerLashLine.push([round(u), round(median(lowers))]);
}

// 4. The slit and the corners, from the plate.
const plate = meshes(head).find(item => item.name === "makeup_plate")!, pg = plate.geometry, pu = pg.getAttribute("uv"), pos = pg.getAttribute("position");
const world = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(plate.matrixWorld);
const rim = [...new Set(uvHoleBridges(pg).flat())].filter(i => pu.getX(i) < 0.5).map(i => ({ u: pu.getX(i), v: pu.getY(i), x: Math.abs(world(i).x) }));
const inner = rim.reduce((a, b) => a.x < b.x ? a : b), outer = rim.reduce((a, b) => a.x > b.x ? a : b);
const slit = rim.sort((a, b) => b.u - a.u).filter((point, i, all) => !i || Math.abs(point.u - all[i - 1]!.u) > 0.003).map(point => [round(point.u), round(point.v)]);
let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
for (let i = 0; i < pu.count; i++) { u0 = Math.min(u0, pu.getX(i)); u1 = Math.max(u1, pu.getX(i)); v0 = Math.min(v0, pu.getY(i)); v1 = Math.max(v1, pu.getY(i)); }
console.log(JSON.stringify({ body, decalVertices: dp.count, liftMm: { median: round(lifts[lifts.length >> 1]! * 1000), max: round(lifts.at(-1)! * 1000) },
  innerCorner: [round(inner.u), round(inner.v)], outerCorner: [round(outer.u), round(outer.v)], slit, upperLashLine, crease, lowerLashLine,
  plate: { u0: round(u0), u1: round(u1), v0: round(v0), v1: round(v1) } }));
process.exit(0);
