// Shimmer diagnosis and redesign evidence (experiment 030). Offline and deterministic; reads no game files.
//
//   bun experiments/030-shimmer-grain/diagnose.ts          # result.json (tracked, asset-free)
//   bun experiments/030-shimmer-grain/diagnose.ts --png    # also PNG texture crops and renders into ignored generated/
//
// Input: the in-game preset *Shimmer · strong* (experiment 017's collection, staged since session 2): on the left
// lid a Satin control, Board 2's fine Shimmer (128 cells, density 0.65, tilt 0.65) and the strong Shimmer (64 cells,
// density 0.8, tilt 1), in the plum pigment, compiled on the 2048 × 512 plate window exactly as Build does.
//
// "as built" is the faceted route that sessions 2 to 4 saw: the classic facet field sampled per window texel
// (a copy of the retired `shimmerFacetSampler`, checked byte for byte against the compiler before the rework).
// "grain" is whatever `compilePreset` builds now. Both go through the export's own mip chain
// (`facetedMipChain`) and a small deferred-light model of `mesh_decal` mode 1 on the skin class:
// gate saturate(50 − 50z) on the filtered normal, encoded lerp onto a flat skin normal, two GGX lobes at
// roughness × 0.966 and × 1.597, F0 = lerp(0.04, albedo, metalness), Lambert diffuse × (1 − metalness).
// No SSS, TAA, upscaler, bloom or environment light: a forecast of what the maps can do, not of the game.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePreset } from "../../projects/xf-studio/authoring/tests/fixtures/eye-region";
import { plateUvWindow, type UvWindow } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/plate-uv-window";
import { facetedMipChain } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/route-mip-chains";
import { mipDimensions } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/flat-mip-chain";
import { encodePng } from "../../projects/xf-studio/authoring/src/png";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "../..");
const png = process.argv.includes("--png"), out = join(here, "generated");
/** The built-in plate's stored UV0 bounds (game 2.31), as tests/plate-uv-window.test.ts records them. */
const BUILT_IN = { uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 };
const W = 2048, H = 512, window: UvWindow = plateUvWindow(BUILT_IN);
/** Area-weighted medians over the plate (experiment 018): millimetres per unit of head UV. */
const MM_U = 569, MM_V = 405;
const texelMm = { u: (window.u1 - window.u0) / W * MM_U, v: (window.v1 - window.v0) / H * MM_V };
/** Estimated screen pixel footprints on the lid [hypothesis]: a creator eye close-up and photo-mode face framing
 * (about face-filling at 1600 px; experiment 018 put face framing near its 0.25 mm level). DLSS renders fewer
 * internal pixels, so its footprints are about twice these. */
const FRAMINGS = [{ id: "eye-close-up", mmPerPixel: .1 }, { id: "face-framing", mmPerPixel: .22 }] as const;

const collection = JSON.parse(readFileSync(join(root, "experiments/017-plate-depth/depth-candidate.collection.json"), "utf8"));
const preset = collection.presets.find((p: { name: string }) => p.name === "Shimmer · strong");
type Rect = [number, number, number, number];
/** The left lid's three stripes (Satin control | fine | strong): measured over their fully covered interiors
 * (`rect`), and, for the as-built variant, drawn with the retired facets over their whole extent (`full`; the
 * strong stripe is the top layer where they overlap). */
const STRIPES: { id: string; rect: Rect; full: Rect; flakes?: { cells: number; density: number; tilt: number; seed: number } }[] = [
  { id: "satin", rect: [.304, .216, .344, .244], full: [.300, .212, .346, .248] },
  { id: "fine", rect: [.352, .216, .392, .244], full: [.346, .212, .394, .248], flakes: { cells: 128, density: .65, tilt: .65, seed: 2077 } },
  { id: "strong", rect: [.400, .216, .440, .244], full: [.394, .212, .444, .248], flakes: { cells: 64, density: .8, tilt: 1, seed: 2078 } },
];

// ---- The route as built (sessions 2–4): the classic facet field at window texels ----
function random(x: number, y: number, seed: number) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function asBuiltFacet(p: { cells: number; density: number; tilt: number; seed: number }, texelsU: number, texelsV: number) {
  const cells = p.cells * 2, radius = 0.39 / cells;
  return (u: number, v: number) => {
    const cx = Math.min(cells - 1, Math.max(0, Math.floor(u * cells))), cy = Math.min(cells - 1, Math.max(0, Math.floor(v * cells)));
    let a = 0, nx = 0, ny = 0, nz = 1;
    if (random(cx, cy, p.seed) < p.density) {
      const px = (cx + 0.5 + (random(cx, cy, p.seed + 1) - 0.5) * 0.3) / cells;
      const py = (cy + 0.5 + (random(cx, cy, p.seed + 2) - 0.5) * 0.3) / cells;
      const azimuth = random(cx, cy, p.seed + 4) * Math.PI * 2;
      const angle = Math.sqrt(random(cx, cy, p.seed + 5)) * p.tilt * 0.4;
      nx = Math.sin(angle) * Math.cos(azimuth); ny = Math.sin(angle) * Math.sin(azimuth); nz = Math.cos(angle);
      const du = u - px, dv = v - py, d = Math.hypot(du, dv);
      const ramp = d > 0 ? Math.hypot(du / d * texelsU, dv / d * texelsV) : Math.max(texelsU, texelsV);
      a = Math.max(0, Math.min(1, 0.5 + (radius - d) * ramp));
    }
    const vx = nx * a, vy = ny * a, vz = 1 + (nz - 1) * a, len = Math.hypot(vx, vy, vz);
    return [Math.round(((vx / len) * 0.5 + 0.5) * 255), Math.round(((vy / len) * 0.5 + 0.5) * 255),
      Math.round((0.48 * (1 - a) + 0.32 * a) * 255), Math.round(a * 0.35 * 255)];
  };
}

type Maps = { diffuse: Uint8Array; roughness: Uint8Array; metalness: Uint8Array; normal: Uint8Array };
const texelUv = (x: number, y: number) => [window.u0 + (x + .5) / W * (window.u1 - window.u0), window.v0 + (y + .5) / H * (window.v1 - window.v0)];
const inside = (r: Rect, u: number, v: number) => u >= r[0] && u < r[2] && v >= r[1] && v < r[3];
const stripeTexels = (r: Rect) => {
  const list: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [u, v] = texelUv(x, y); if (inside(r, u, v)) list.push(y * W + x); }
  return list;
};

const compiled = compilePreset(preset.recipe, { kind: "window", width: W, height: H, window });
const now: Maps = { diffuse: compiled.maps.diffuse!, roughness: compiled.maps.roughness!, metalness: compiled.maps.metalness!, normal: compiled.maps.normal! };
// The as-built maps: today's compile with the Shimmer stripes redrawn by the retired sampler. Before the rework the
// compiler's own output equalled the sampler on every fully covered stripe texel (`asBuiltEqualsCompiler` was true at
// commit 5e84330); after it the flag is false by design.
const built: Maps = { diffuse: now.diffuse, roughness: now.roughness.slice(), metalness: now.metalness.slice(), normal: now.normal.slice() };
let asBuiltEqualsCompiler = true;
for (const stripe of STRIPES) {
  if (!stripe.flakes) continue;
  const sample = asBuiltFacet(stripe.flakes, W / (window.u1 - window.u0), H / (window.v1 - window.v0)), interior = new Set(stripeTexels(stripe.rect));
  for (const t of stripeTexels(stripe.full)) {
    const [u, v] = texelUv(t % W, Math.floor(t / W)), [nx, ny, r, m] = sample(u, v);
    if (interior.has(t) && (built.normal[t * 2] !== nx || built.normal[t * 2 + 1] !== ny || built.roughness[t] !== r || built.metalness[t] !== m)) asBuiltEqualsCompiler = false;
    built.normal[t * 2] = nx; built.normal[t * 2 + 1] = ny; built.roughness[t] = r; built.metalness[t] = m;
  }
}

// ---- Texture statistics ----
const unorm = (b: number) => b / 255 * 2 - 1;
const tiltSine = (m: Maps, t: number) => Math.hypot(unorm(m.normal[t * 2]), unorm(m.normal[t * 2 + 1]));
const gate = (s: number) => Math.max(0, Math.min(1, 50 - 50 * Math.sqrt(Math.max(0, 1 - s * s))));
/** Normalised autocorrelation of a field over the stripe at lag (dx, dy) texels. */
function autocorrelation(field: (t: number) => number, texels: number[], dx: number, dy: number) {
  const set = new Set(texels), values = texels.map(field), mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  if (variance < 1e-12) return 0;
  let sum = 0, n = 0;
  for (const t of texels) { const o = t + dy * W + dx; if (set.has(o)) { sum += (field(t) - mean) * (field(o) - mean); n++; } }
  return sum / n / variance;
}
function textureStats(m: Maps, stripe: typeof STRIPES[number]) {
  const texels = stripeTexels(stripe.rect), tilted = texels.filter(t => tiltSine(m, t) > .05);
  const tilt = (t: number) => tiltSine(m, t), rough = texels.map(t => m.roughness[t] / 255), metal = texels.map(t => m.metalness[t] / 255);
  const spread = (xs: number[]) => { const mean = xs.reduce((a, b) => a + b, 0) / xs.length; return { mean: +mean.toFixed(4), sd: +Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length).toFixed(4) }; };
  // Lattice test: the as-built cell pitch in window texels (the facet cells are square in head UV).
  const pitch = stripe.flakes ? { u: Math.round(1 / (stripe.flakes.cells * 2) / ((window.u1 - window.u0) / W)), v: Math.round(1 / (stripe.flakes.cells * 2) / ((window.v1 - window.v0) / H)) } : undefined;
  let halfWidth = 0;
  while (halfWidth < 64 && autocorrelation(tilt, texels, halfWidth + 1, 0) > .5) halfWidth++;
  return {
    texels: texels.length, tiltedShare: +(tilted.length / texels.length).toFixed(4),
    meanTiltDeg: tilted.length ? +(tilted.reduce((a, t) => a + Math.asin(Math.min(1, tiltSine(m, t))), 0) / tilted.length * 180 / Math.PI).toFixed(2) : 0,
    meanGateOnTilted: tilted.length ? +(tilted.reduce((a, t) => a + gate(tiltSine(m, t)), 0) / tilted.length).toFixed(3) : 0,
    roughness: spread(rough), metalness: spread(metal),
    /** Width (texels, along U) over which a tilted patch stays correlated above 0.5: the visible dot size. */
    patchHalfWidthTexels: halfWidth, patchWidthMm: +((2 * halfWidth + 1) * texelMm.u).toFixed(2),
    /** Autocorrelation of tilt one as-built cell pitch away (1 = a perfect lattice, 0 = no lattice). */
    ...(pitch ? { latticePitchTexels: pitch, latticeCorrelation: { u: +autocorrelation(tilt, texels, pitch.u, 0).toFixed(3), v: +autocorrelation(tilt, texels, 0, pitch.v).toFixed(3) } } : {}),
  };
}

// ---- Render: the lid seen frontally at one framing, lit by one directional light ----
type Chain = ReturnType<typeof facetedMipChain>;
const dims = mipDimensions(W, H);
function sampleLevel(chain: Chain, level: number, x: number, y: number) {
  const { width: w, height: h } = dims[level], fx = x * w / W - .5, fy = y * h / H - .5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const acc = new Float64Array(6);
  for (const [dx, dy, wt] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]] as const) {
    const cx = (x0 + dx + w) % w, cy = (y0 + dy + h) % h, t = cy * w + cx;
    acc[0] += wt * unorm(chain.normal[level][t * 2]); acc[1] += wt * unorm(chain.normal[level][t * 2 + 1]);
    acc[2] += wt * chain.roughness[level][t] / 255; acc[3] += wt * chain.metalness[level][t] / 255;
    acc[4] += wt * chain.diffuse[level][t * 4 + 3] / 255;
    acc[5] += wt * chain.diffuse[level][t * 4 + 1] / 255;
  }
  return acc;
}
const srgbDecode = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const PIGMENT = [0x6d, 0x4a, 0x7e].map(b => srgbDecode(b / 255));
function ggx(r: number, nh: number, nl: number, nv: number) {
  const a = Math.max(.04, r) ** 2, a2 = a * a, d = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2);
  const k = a / 2, g = nl / (nl * (1 - k) + k) * (nv / (nv * (1 - k) + k));
  return d * g / (4 * nl * nv);
}
function shade(chain: Chain, x: number, y: number, lod: number, light: number[], specularOnly = false) {
  const l0 = Math.max(0, Math.min(dims.length - 1, Math.floor(lod))), l1 = Math.min(dims.length - 1, l0 + 1), f = Math.max(0, Math.min(1, lod - l0));
  const a = sampleLevel(chain, l0, x, y), b = sampleLevel(chain, l1, x, y), s = a.map((v, i) => v * (1 - f) + b[i] * f);
  const sine = Math.hypot(s[0], s[1]), z = Math.sqrt(Math.max(0, 1 - sine * sine)), alpha = gate(sine) * s[4];
  let n = [s[0] * alpha, s[1] * alpha, 1 + (z - 1) * alpha]; const len = Math.hypot(n[0], n[1], n[2]); n = n.map(c => c / len);
  const v = [0, 0, 1], h = [light[0], light[1], light[2] + 1], hl = Math.hypot(h[0], h[1], h[2]);
  const nl = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]), nv = Math.max(1e-3, n[2]);
  const nh = Math.max(0, (n[0] * h[0] + n[1] * h[1] + n[2] * h[2]) / hl), vh = Math.max(0, h[2] / hl);
  const r = s[2], m = s[3], out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const f0 = .04 * (1 - m) + PIGMENT[c] * m, fresnel = f0 + (1 - f0) * (1 - vh) ** 5;
    const spec = nl > 0 ? (ggx(r * .966, nh, nl, nv) + ggx(r * 1.597, nh, nl, nv)) * fresnel * nl * Math.PI : 0;
    out[c] = (specularOnly ? 0 : PIGMENT[c] * (1 - m) * nl) + spec;
  }
  return out;
}
const lightDir = (elevationDeg: number, azimuthDeg: number) => {
  const e = elevationDeg * Math.PI / 180, a = azimuthDeg * Math.PI / 180;
  return [Math.sin(e) * Math.cos(a), Math.sin(e) * Math.sin(a), Math.cos(e)];
};
/** Lights: A near the mirror direction (the sheen), B and C 35° off the normal and 10° apart in azimuth (twinkle). */
const LIGHTS = { A: lightDir(8, 0), B: lightDir(35, 30), C: lightDir(35, 40) };
const lid: Rect = [.300, .212, .444, .248];
const PROFILE_DEG = [0, 8, 16, 24, 32];

function render(chain: Chain, mmPerPixel: number, light: number[] | "ambient") {
  const pw = Math.round((lid[2] - lid[0]) * MM_U / mmPerPixel), ph = Math.round((lid[3] - lid[1]) * MM_V / mmPerPixel);
  const lod = Math.log2(Math.max(mmPerPixel / texelMm.u, mmPerPixel / texelMm.v));
  const image = new Float64Array(pw * ph * 3);
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    const u = lid[0] + (px + .5) * mmPerPixel / MM_U, v = lid[1] + (py + .5) * mmPerPixel / MM_V;
    const x = (u - window.u0) / (window.u1 - window.u0) * W, y = (v - window.v0) / (window.v1 - window.v0) * H;
    // Ambient: unlit albedo × (1 − metalness), what shows whatever the light does.
    const c = light === "ambient" ? (() => { const s = sampleLevel(chain, Math.max(0, Math.round(lod)), x, y); return PIGMENT.map(p => p * (1 - s[3])); })()
      : shade(chain, x, y, lod, light);
    image.set(c, (py * pw + px) * 3);
  }
  return { pw, ph, lod, image };
}
const luminance = (img: Float64Array, i: number) => .2126 * img[i * 3] + .7152 * img[i * 3 + 1] + .0722 * img[i * 3 + 2];
function stripePixels(r: { pw: number; ph: number }, rect: Rect, mmPerPixel: number) {
  const list: number[] = [];
  for (let py = 0; py < r.ph; py++) for (let px = 0; px < r.pw; px++) {
    const u = lid[0] + (px + .5) * mmPerPixel / MM_U, v = lid[1] + (py + .5) * mmPerPixel / MM_V;
    if (inside(rect, u, v)) list.push(py * r.pw + px);
  }
  return list;
}
function imageStats(images: Record<string, ReturnType<typeof render>>, rect: Rect, mmPerPixel: number) {
  const px = stripePixels(images.A, rect, mmPerPixel), lum = (k: string) => px.map(i => luminance(images[k].image, i));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const cv = (xs: number[]) => { const m = mean(xs); return m > 0 ? Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / m : 0; };
  const b = lum("B"), c = lum("C");
  // Dot size on screen: along x, the lag (pixels) where the lit image's autocorrelation falls below 0.5.
  const w = images.B.pw, set = new Set(px), mb = mean(b), vb = mean(b.map(x => (x - mb) ** 2)), byIndex = new Map(px.map((i, k) => [i, b[k]]));
  let dot = 0;
  while (vb > 1e-12 && dot < 40) {
    let s = 0, n = 0;
    for (const i of px) if (set.has(i + dot + 1) && Math.floor((i + dot + 1) / w) === Math.floor(i / w)) { s += (byIndex.get(i)! - mb) * (byIndex.get(i + dot + 1)! - mb); n++; }
    if (s / n / vb <= .5) break;
    dot++;
  }
  return {
    sheenA: +mean(lum("A")).toFixed(4), litB: +mb.toFixed(4),
    /** Pattern that shows whatever the light does (albedo × (1 − metalness)): coefficient of variation. */
    staticContrast: +cv(lum("ambient")).toFixed(3),
    /** Pattern under one oblique light: coefficient of variation. */
    litContrastB: +cv(b).toFixed(3),
    /** How much of the image changes when the light moves 10°: mean |B − C| over mean B. */
    twinkle10deg: +(mean(b.map((x, i) => Math.abs(x - c[i]))) / Math.max(1e-9, mb)).toFixed(3),
    /** Visible pattern width on screen (pixels): twice the half-width at autocorrelation 0.5, plus one. */
    patternWidthPx: 2 * dot + 1,
  };
}
function toPng(r: ReturnType<typeof render>, scale: number) {
  const data = new Uint8Array(r.pw * r.ph * 4);
  const encode = (v: number) => { const t = v * scale / (1 + v * scale); return Math.round(255 * (t <= .0031308 ? t * 12.92 : 1.055 * t ** (1 / 2.4) - .055)); };
  for (let i = 0; i < r.pw * r.ph; i++) { for (let c = 0; c < 3; c++) data[i * 4 + c] = encode(r.image[i * 3 + c]); data[i * 4 + 3] = 255; }
  return encodePng({ width: r.pw, height: r.ph, data }, { alpha: false });
}
/** A crop of the tilt field (grey = tilt sine ×4) and metalness over the left lid, 2 px per texel. */
function textureCrop(m: Maps) {
  const x0 = Math.floor((lid[0] - window.u0) / (window.u1 - window.u0) * W), x1 = Math.ceil((lid[2] - window.u0) / (window.u1 - window.u0) * W);
  const y0 = Math.floor((lid[1] - window.v0) / (window.v1 - window.v0) * H), y1 = Math.ceil((lid[3] - window.v0) / (window.v1 - window.v0) * H);
  const w = (x1 - x0) * 2, h = (y1 - y0) * 4, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = x0 + (x >> 1), top = y < h / 2, ty = y0 + ((top ? y : y - h / 2) >> 1), t = ty * W + tx;
    const g = top ? Math.min(255, Math.round(tiltSine(m, t) * 4 * 255)) : m.metalness[t];
    data.set([g, g, g, 255], (y * w + x) * 4);
  }
  return encodePng({ width: w, height: h, data }, { alpha: false });
}

const variants = { "as-built": built, grain: now } as const;
const result: Record<string, unknown> = {
  preset: preset.name, window: { width: W, height: H, texelMm: { u: +texelMm.u.toFixed(4), v: +texelMm.v.toFixed(4) } },
  framings: FRAMINGS, lights: { A: "8° off the normal (near mirror: the sheen)", B: "35° off, azimuth 30°", C: "35° off, azimuth 40°" },
  asBuiltEqualsCompiler, variants: {},
};
if (png) mkdirSync(out, { recursive: true });
for (const [name, maps] of Object.entries(variants)) {
  const chain = facetedMipChain(maps.diffuse, maps.roughness, maps.metalness, maps.normal, W, H);
  const entry: Record<string, unknown> = { texture: Object.fromEntries(STRIPES.map(s => [s.id, textureStats(maps, s)])) };
  if (png) writeFileSync(join(out, `${name}-texture.png`), textureCrop(maps));
  for (const framing of FRAMINGS) {
    const images = { A: render(chain, framing.mmPerPixel, LIGHTS.A), B: render(chain, framing.mmPerPixel, LIGHTS.B),
      C: render(chain, framing.mmPerPixel, LIGHTS.C), ambient: render(chain, framing.mmPerPixel, "ambient") };
    // The sheen's angular profile: mean luminance per stripe as the light tilts away from the mirror direction.
    const profile = Object.fromEntries(STRIPES.map(s => [s.id, PROFILE_DEG.map(deg => {
      const r = render(chain, framing.mmPerPixel, lightDir(deg, 0)), px = stripePixels(r, s.rect, framing.mmPerPixel);
      return +(px.reduce((a, i) => a + luminance(r.image, i), 0) / px.length).toFixed(4);
    })]));
    entry[framing.id] = { lod: +images.A.lod.toFixed(2),
      stripes: Object.fromEntries(STRIPES.map(s => [s.id, imageStats(images, s.rect, framing.mmPerPixel)])),
      sheenProfile: { lightOffNormalDeg: PROFILE_DEG, ...profile } };
    if (png) for (const k of ["A", "B", "C", "ambient"] as const) writeFileSync(join(out, `${name}-${framing.id}-${k}.png`), toPng(images[k], k === "ambient" ? 4 : 2));
  }
  (result.variants as Record<string, unknown>)[name] = entry;
}
writeFileSync(join(here, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 1));
