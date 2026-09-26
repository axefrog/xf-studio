// Diagnostic Glitter export route: resolved glint flakes in `mesh_decal` on the plate-local window, with
// nested flake mips and an optional emissive accent. Pure: no IO, no UI, no WolvenKit.
//
// This is the primary route of knowledge/glitter-in-game.md §3 and the fallback accent of §4, as measured
// offline in experiments/018-glitter-route (make_maps.py is the Python design reference; this is an
// independent TypeScript implementation of the same rules, with its own random stream, so the flake draws
// differ from the Python fixture's while the statistics and the nesting rules are the same). Only a
// collection's diagnostic `glitter` knob reaches it (export-diagnostics.ts); the Glitter finish itself
// still has no export route.
//
// Maps (4096 × 1024 over the plate window, full non-square chains):
// - diffuse: RGB is the pigment (the preset's flat-finish layers), mixed linearly toward the flake colour by
//   flake coverage and by the sheen share (below); alpha is √coverage with the flat route's coverage-space
//   chain, so the decal's coverage is exactly the pigment layers'.
// - roughness, metalness: the knob's base surface under the pigment, composited toward each flake's values.
// - normal: each flake's constant tangent X, Y, dilated to the flake's bounding box plus two texels (a flake's
//   own footprint always wins over a neighbour's dilation) so filter taps never average a flake with flat.
// - flakes (NormalAlphaTex): flake coverage, antialiased (4 × 4 samples per texel) and clipped by the region
//   layer's coverage; it carries each flake's shape.
//
// Nested mips (per region, 018 §Method): level L re-draws each flake at width max(w, 2 texels of L) and keeps
// the prefix, in stable key order, whose enlarged area covers cover × 0.7^(L − L*), L* being the first level
// that enlarges the median flake; no representative wider than 1.2 mm is drawn. Lower keys draw on top, so the
// flakes kept at a coarse level are the same flakes, at the same places, as at finer levels. Flake area no
// longer represented becomes sheen: inside the region, the pigment's roughness moves toward
// ((r_f²)² + E[sin²θ])^¼, and its metalness and colour toward the flake's, by the unrepresented share.
// A region with `mips: "box"` keeps its nested level 0 but takes every lower level from the plain 2×2 BOX
// chain of the level-0 bytes (the comparison 018's board asks for).
//
// A region's UV bounds are its layer's outline bounds clipped to the plate window (glitter-region.ts), and its
// catalogue is sized over them within a flake budget. Region membership at each level is the texel rectangle those
// bounds touch, [floor(a·n), ceil(b·n)) in window texels. The independent verifier restates all three.
import type { GlitterDiagnostic, GlitterFlakes } from "./export-diagnostics";
import { ACCENT_TEXTURE_SIZE, GLITTER_WINDOW_TEXTURE, planPresetExport } from "./engines/layered-makeup/finish-export";
import { flatMipChain, mipDimensions, reducePlanes } from "./engines/layered-makeup/flat-mip-chain";
import type { UvWindow } from "./engines/layered-makeup/plate-uv-window";
import { compileFlatPreset } from "./engines/layered-makeup/preset-compiler";
import { checkFlakeBudget, clipRect, flakeCount, HEX_AREA, layerOutlineBounds, MM_PER_UV, rectMm, type RectUv } from "./glitter-region";
import { parseRecipe, raster, rasterWindow, type Recipe } from "./engines/layered-makeup/recipe";

export { MM_PER_UV } from "./glitter-region";
/** Nesting constants of experiment 018's design. */
export const GLITTER_NESTING = { retention: .7, capMm: 1.2, minTexels: 2, dilateTexels: 2, supersamples: 4 } as const;

const HEX = Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)] as const);
const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const unitByte = (v: number) => Math.floor(clip01(v) * 255 + .5);
const srgbDecode = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const srgbEncode = (v: number) => (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - .055);
const unorm = (b: number) => b / 255 * 2 - 1;
const hexLinear = (color: string) => [1, 3, 5].map(i => srgbDecode(parseInt(color.slice(i, i + 2), 16) / 255));

/** Seeded xoshiro128** stream (splitmix32-seeded), for reproducible catalogues. */
export function randomStream(seed: number): () => number {
  let s = seed >>> 0;
  const split = () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
  let a = split(), b = split(), c = split(), d = split();
  return () => {
    const r = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)), 9) >>> 0, t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = (d << 11) | (d >>> 21);
    return r / 4294967296;
  };
}

/** One region's flakes in window millimetres (x from the window's u0, y from its authored v0). */
export interface Catalogue {
  readonly cx: Float64Array; readonly cy: Float64Array; readonly width: Float64Array; readonly rot: Float64Array;
  readonly aspect: Float64Array; readonly nx: Float64Array; readonly ny: Float64Array; readonly key: Float64Array;
  readonly areaMm2: number;
}
/**
 * Flake catalogue of one region (`rect` already clipped to the window): log-normal widths, hexagon-like facets,
 * |N(0, σ)| tilts truncated at the maximum.
 */
export function flakeCatalogue(rect: RectUv, window: UvWindow, f: GlitterFlakes): Catalogue {
  const { x0, x1, y0, y1, area } = rectMm(rect, window), n = flakeCount(rect, window, f), random = randomStream(f.seed);
  const gauss = () => { const u = 1 - random(), v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const arrays = Array.from({ length: 8 }, () => new Float64Array(n));
  const [cx, cy, width, rot, aspect, nx, ny, key] = arrays;
  for (let i = 0; i < n; i++) {
    let tilt = Math.abs(gauss() * f.tiltSigmaDeg);
    if (tilt > f.tiltMaxDeg) tilt = random() * f.tiltMaxDeg;
    const azimuth = random() * 2 * Math.PI, s = Math.sin(tilt * Math.PI / 180);
    cx[i] = x0 + random() * (x1 - x0); cy[i] = y0 + random() * (y1 - y0);
    width[i] = f.sizeMm * Math.exp(f.sizeSigma * gauss()); rot[i] = random() * Math.PI; aspect[i] = 1 + random() * .4;
    nx[i] = s * Math.cos(azimuth); ny[i] = s * Math.sin(azimuth); key[i] = random();
  }
  return { cx, cy, width, rot, aspect, nx, ny, key, areaMm2: area };
}

/** The same flakes mirrored across u = ½ (the other lid): positions mirrored in UV, rotation and tangent X negated. */
export function mirrorCatalogue(c: Catalogue, window: UvWindow): Catalogue {
  const span = (1 - 2 * window.u0) * MM_PER_UV.u;
  return { ...c, cx: c.cx.map(x => span - x), rot: c.rot.map(r => -r), nx: c.nx.map(x => -x) };
}

/** E[sin²θ] of the tilt distribution (degrees): |N(0, σ)| below the maximum, redrawn uniformly when above it. */
export function tiltVariance(sigmaDeg: number, maxDeg: number): number {
  const steps = 4000, h = maxDeg / steps, sin2 = (d: number) => Math.sin(d * Math.PI / 180) ** 2;
  if (sigmaDeg <= 0) return 0;
  const g = (d: number) => 2 / (sigmaDeg * Math.sqrt(2 * Math.PI)) * Math.exp(-d * d / (2 * sigmaDeg * sigmaDeg));
  let inside = 0, weighted = 0, uniform = 0;
  for (let i = 0; i <= steps; i++) {
    const d = i * h, w = (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * h / 3;
    inside += w * g(d); weighted += w * g(d) * sin2(d); uniform += w * sin2(d);
  }
  return weighted + Math.max(0, 1 - inside) * uniform / maxDeg;
}
/** Roughness a region's unrepresented flakes widen toward: GGX α² + slope variance, back to roughness. */
export const sheenRoughness = (f: GlitterFlakes) => ((f.roughness ** 2) ** 2 + tiltVariance(f.tiltSigmaDeg, f.tiltMaxDeg)) ** .25;

/** Texel rectangle [x0, x1) × [y0, y1) a region's UV bounds touch at a width × height level over the window. */
export function regionTexels(rect: RectUv, window: UvWindow, width: number, height: number) {
  const fx = (u: number) => (u - window.u0) / (window.u1 - window.u0) * width, fy = (v: number) => (v - window.v0) / (window.v1 - window.v0) * height;
  const clampTo = (v: number, n: number) => Math.max(0, Math.min(n, v));
  return { x0: clampTo(Math.floor(fx(rect.u0)), width), x1: clampTo(Math.ceil(fx(rect.u1)), width),
    y0: clampTo(Math.floor(fy(rect.v0)), height), y1: clampTo(Math.ceil(fy(rect.v1)), height) };
}

/** Owner of a texel whose normal no flake has claimed. */
const NO_OWNER = 0xffffffff;
/**
 * Raster planes of one level: flake coverage and (with `material`) premultiplied flake values and the normal's owner.
 * The planes are allocated once at level-0 size and reused as views for every level (PIPE-75).
 */
class Canvas {
  w = 0; h = 0;
  mask!: Float32Array; rough!: Float32Array; metal!: Float32Array; col!: Float32Array; nx!: Float32Array; ny!: Float32Array;
  /** Normal owner per texel: a flake's global stamping rank (lower wins), offset by the flake total where it only dilates. */
  owner!: Uint32Array;
  private readonly store: { mask: Float32Array; rough?: Float32Array; metal?: Float32Array; col?: Float32Array; nx?: Float32Array; ny?: Float32Array; owner?: Uint32Array };
  constructor(capacity: number, readonly material: boolean) {
    this.store = { mask: new Float32Array(capacity), ...(material ? { rough: new Float32Array(capacity), metal: new Float32Array(capacity),
      col: new Float32Array(capacity * 3), nx: new Float32Array(capacity), ny: new Float32Array(capacity), owner: new Uint32Array(capacity) } : {}) };
  }
  /** Cleared views for a w × h level. */
  level(w: number, h: number): this {
    const n = w * h, s = this.store;
    this.w = w; this.h = h;
    this.mask = s.mask.subarray(0, n).fill(0);
    if (this.material) {
      this.rough = s.rough!.subarray(0, n).fill(0); this.metal = s.metal!.subarray(0, n).fill(0); this.col = s.col!.subarray(0, n * 3).fill(0);
      this.nx = s.nx!.subarray(0, n).fill(0); this.ny = s.ny!.subarray(0, n).fill(0); this.owner = s.owner!.subarray(0, n).fill(NO_OWNER);
    }
    return this;
  }
}

type Stamp = { cx: number; cy: number; width: number; rot: number; aspect: number; nx: number; ny: number; rank: number;
  rough: number; metal: number; col: readonly number[] };
/**
 * Draw one flake (a hexagon of `width` mm, stretched by `aspect` and rotated) on a canvas whose texels are
 * tu × tv mm, "over" what is there, with coverage clipped by `clip` (0–255 per texel; null = none). With
 * `normals`, the flake of lowest stamping rank within the flake's box plus the dilation owns the normal, a flake's
 * own footprint (`total` added to the rank elsewhere) always before a neighbour's dilation.
 */
function stamp(canvas: Canvas, s: Stamp, tu: number, tv: number, clip: Uint8Array | null, normals: boolean, total = 0) {
  const r = s.width / 2, c = Math.cos(s.rot), sn = Math.sin(s.rot), px: number[] = [], py: number[] = [];
  for (const [hx, hy] of HEX) { const x = hx * r * s.aspect, y = hy * r; px.push((x * c - y * sn + s.cx) / tu); py.push((x * sn + y * c + s.cy) / tv); }
  const dilate = normals ? GLITTER_NESTING.dilateTexels : 0;
  let minX = px[0], maxX = px[0], minY = py[0], maxY = py[0];
  for (let i = 1; i < 6; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]); }
  const bx0 = Math.max(0, Math.floor(minX) - dilate), bx1 = Math.min(canvas.w, Math.ceil(maxX) + dilate);
  const by0 = Math.max(0, Math.floor(minY) - dilate), by1 = Math.min(canvas.h, Math.ceil(maxY) + dilate);
  if (bx0 >= bx1 || by0 >= by1) return;
  // Edge equations oriented inward.
  const edges: number[] = [];
  let signed = 0;
  for (let i = 0; i < 6; i++) signed += px[i] * py[(i + 1) % 6] - px[(i + 1) % 6] * py[i];
  const orient = signed >= 0 ? 1 : -1;
  for (let i = 0; i < 6; i++) {
    const ax = px[i], ay = py[i], bx = px[(i + 1) % 6], by = py[(i + 1) % 6];
    edges.push(-(by - ay) * orient, (bx - ax) * orient, ((by - ay) * ax - (bx - ax) * ay) * orient);
  }
  const ss = GLITTER_NESTING.supersamples, inv = 1 / (ss * ss), material = canvas.material;
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    let inside = 0;
    for (let sy = 0; sy < ss; sy++) {
      const yy = y + (sy + .5) / ss;
      for (let sx = 0; sx < ss; sx++) {
        const xx = x + (sx + .5) / ss;
        let ok = true;
        for (let e = 0; e < 18; e += 3) if (edges[e] * xx + edges[e + 1] * yy + edges[e + 2] < 0) { ok = false; break; }
        if (ok) inside++;
      }
    }
    const t = y * canvas.w + x, cov = inside * inv * (clip ? clip[t] / 255 : 1);
    if (cov > 0) {
      const keep = 1 - cov;
      if (material) {
        canvas.rough[t] = canvas.rough[t] * keep + s.rough * cov;
        canvas.metal[t] = canvas.metal[t] * keep + s.metal * cov;
        for (let k = 0; k < 3; k++) canvas.col[t * 3 + k] = canvas.col[t * 3 + k] * keep + s.col[k] * cov;
      }
      canvas.mask[t] = canvas.mask[t] + (1 - canvas.mask[t]) * cov;
    }
    if (normals) {
      const priority = cov > 0 ? s.rank : s.rank + total;
      if (priority < canvas.owner[t]) { canvas.owner[t] = priority; canvas.nx[t] = s.nx; canvas.ny[t] = s.ny; }
    }
  }
}

/**
 * Global stamping rank of every region's flakes: key order, ties to the flake stamped first (lower region, then the
 * higher catalogue index, as the key-ordered prefix is stamped from its end). A lower rank owns a shared texel's normal.
 */
function stampingRanks(catalogues: readonly Catalogue[]): Uint32Array[] {
  let total = 0;
  for (const c of catalogues) total += c.key.length;
  const region = new Uint8Array(total), index = new Uint32Array(total), key = new Float64Array(total);
  let o = 0;
  catalogues.forEach((c, r) => { for (let i = 0; i < c.key.length; i++, o++) { region[o] = r; index[o] = i; key[o] = c.key[i]; } });
  const order = Uint32Array.from({ length: total }, (_, i) => i)
    .sort((a, b) => key[a] - key[b] || region[a] - region[b] || index[b] - index[a]);
  const ranks = catalogues.map(c => new Uint32Array(c.key.length));
  order.forEach((entry, rank) => { ranks[region[entry]][index[entry]] = rank; });
  return ranks;
}

/** Indices of the flakes represented at one level: the key-ordered prefix covering the level's target, capped in width. */
function represented(c: Catalogue, order: Uint32Array, widths: Float64Array, targetMm2: number, capMm: number) {
  const out: number[] = [];
  let sum = 0;
  for (const i of order) {
    sum += HEX_AREA * widths[i] ** 2 * c.aspect[i];
    if (sum > targetMm2) break;
    if (widths[i] <= capMm) out.push(i);
  }
  return out;
}

export interface GlitterRegionStats { layer: string; mips: "nested" | "box"; catalogue: number; represented: number; minWidthTexels: number | null; targetCover: number; maskMean: number }
export interface GlitterChains {
  readonly width: number; readonly height: number;
  readonly diffuse: Uint8Array[]; readonly roughness: Uint8Array[]; readonly metalness: Uint8Array[];
  /** Two bytes (X, Y) per texel. */
  readonly normal: Uint8Array[];
  readonly flakes: Uint8Array[];
  /** The emissive accent's head-UV mask chain (ACCENT_TEXTURE_SIZE square), when the knob asks for one. */
  readonly accent?: Uint8Array[];
  readonly stats: { level: number; width: number; height: number; texelMm: [number, number]; regions: GlitterRegionStats[] }[];
  readonly accentStats?: { layer: string; share: number; flakes: number; levels: { level: number; represented: number }[] };
}

/**
 * Compile one preset through the diagnostic Glitter route: its layers (flat finishes only) are the pigment, and
 * the knob's regions add flakes. `window` is the packaged plate's window.
 */
export function compileGlitterPreset(value: unknown, knob: GlitterDiagnostic, window: UvWindow,
  dims: { width: number; height: number } = GLITTER_WINDOW_TEXTURE): GlitterChains {
  const recipe: Recipe = parseRecipe(value), plan = planPresetExport(recipe);
  if (plan.excluded.length || plan.route !== "flat") throw Error("The diagnostic Glitter route needs a preset of flat-finish pigment layers only.");
  const { width: W, height: H } = dims;
  // Pigment: the flat merge on the window, with the knob's base surface wherever it covers.
  const flat = compileFlatPreset(recipe, { kind: "window", width: W, height: H, window });
  const base = { r: unitByte(knob.base.roughness), m: unitByte(knob.base.metalness) };
  for (let t = 0; t < W * H; t++) if (flat.diffuse[t * 4 + 3]) { flat.roughness[t] = base.r; flat.metalness[t] = base.m; }
  const pigment = flatMipChain(flat.diffuse, flat.roughness, flat.metalness, W, H);
  const levelDims = mipDimensions(W, H);

  const layers = new Map(plan.included.map(layer => [layer.id, layer]));
  const regions = knob.regions.map(region => {
    const layer = layers.get(region.layer);
    if (!layer) throw Error(`Glitter region layer ${region.layer} is not an active layer of this preset.`);
    // The layer's outline bounds, clipped to the plate window before the catalogue is sized (PIPE-69, PIPE-72).
    const rect = clipRect(layerOutlineBounds(layer), window);
    if (!rect) throw Error(`Glitter region ${region.layer} lies outside the eye plate's window.`);
    return { region, layer, rect };
  });
  const catalogues = new Map<string, Catalogue>();
  for (const { region, rect } of regions) if (region.flakes) {
    checkFlakeBudget(flakeCount(rect, window, region.flakes), region.layer, "this preset");
    catalogues.set(region.layer, flakeCatalogue(rect, window, region.flakes));
  }
  const flakesOf = (layer: string) => knob.regions.find(r => r.layer === layer)!.flakes
    ?? knob.regions.find(r => r.layer === knob.regions.find(q => q.layer === layer)!.mirrorOf)!.flakes!;
  for (const { region } of regions) if (region.mirrorOf) catalogues.set(region.layer, mirrorCatalogue(catalogues.get(region.mirrorOf)!, window));

  const t0 = Math.max((window.u1 - window.u0) * MM_PER_UV.u / W, (window.v1 - window.v0) * MM_PER_UV.v / H);
  const out = { diffuse: [] as Uint8Array[], roughness: [] as Uint8Array[], metalness: [] as Uint8Array[], normal: [] as Uint8Array[], flakes: [] as Uint8Array[] };
  const stats: GlitterChains["stats"] = [];
  const orderOf = new Map([...catalogues].map(([layer, c]) => [layer, Uint32Array.from({ length: c.key.length }, (_, i) => i).sort((a, b) => c.key[a] - c.key[b])]));
  const regionCatalogues = regions.map(({ region }) => catalogues.get(region.layer)!), ranks = stampingRanks(regionCatalogues);
  let total = 0;
  for (const c of regionCatalogues) total += c.key.length;

  // Working planes, allocated once at level-0 size and reused as views for every level (PIPE-75).
  const canvasStore = new Canvas(W * H, true), clipStore = new Uint8Array(W * H);
  const colStore = new Float32Array(W * H * 3), roughStore = new Float32Array(W * H), metalStore = new Float32Array(W * H), touchedStore = new Uint8Array(W * H);
  levelDims.forEach(({ width: w, height: h }, L) => {
    const tu = (window.u1 - window.u0) * MM_PER_UV.u / w, tv = (window.v1 - window.v0) * MM_PER_UV.v / h, t = Math.max(tu, tv);
    const canvas = canvasStore.level(w, h), levelStats: GlitterRegionStats[] = [];
    // Region stamping: nested regions on every level, BOX regions on level 0 only (their lower levels are replaced).
    regions.forEach(({ region, layer }, r) => {
      const f = flakesOf(region.layer), c = regionCatalogues[r], rank = ranks[r];
      const first = Math.max(0, Math.floor(Math.log2(f.sizeMm / (2 * t0))) + 1);
      const target = f.cover * GLITTER_NESTING.retention ** Math.max(0, L - first);
      const widths = c.width.map(d => Math.max(d, GLITTER_NESTING.minTexels * t));
      const keep = region.mips === "box" && L > 0 ? [] : represented(c, orderOf.get(region.layer)!, widths, target * c.areaMm2, GLITTER_NESTING.capMm);
      if (keep.length) {
        const clip = clipStore.subarray(0, w * h), coverage = rasterWindow(layer, w, h, window);
        for (let p = 0; p < w * h; p++) clip[p] = coverage[p * 4 + 3];
        const col = hexLinear(f.color);
        for (let k = keep.length - 1; k >= 0; k--) {
          const i = keep[k];
          stamp(canvas, { cx: c.cx[i], cy: c.cy[i], width: widths[i], rot: c.rot[i], aspect: c.aspect[i], nx: c.nx[i], ny: c.ny[i], rank: rank[i],
            rough: f.roughness, metal: f.metalness, col }, tu, tv, clip, true, total);
        }
      }
      let narrowest = Infinity;
      for (const i of keep) if (widths[i] < narrowest) narrowest = widths[i];
      levelStats.push({ layer: region.layer, mips: region.mips, catalogue: c.key.length, represented: keep.length,
        minWidthTexels: keep.length ? Math.round(narrowest / t * 100) / 100 : null,
        targetCover: Math.round(target * 1e4) / 1e4, maskMean: 0 });
    });
    // Sheen per region, then the flakes over it.
    const n = w * h, pd = pigment.diffuse[L], pr = pigment.roughness[L], pm = pigment.metalness[L];
    const col = colStore.subarray(0, n * 3), rough = roughStore.subarray(0, n), metal = metalStore.subarray(0, n), touched = touchedStore.subarray(0, n).fill(0);
    for (let p = 0; p < n; p++) { for (let k = 0; k < 3; k++) col[p * 3 + k] = srgbDecode(pd[p * 4 + k] / 255); rough[p] = pr[p] / 255; metal[p] = pm[p] / 255; }
    regions.forEach(({ region, rect }, r) => {
      const f = flakesOf(region.layer), box = regionTexels(rect, window, w, h);
      let sum = 0, count = 0;
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { sum += canvas.mask[y * w + x]; count++; }
      const shown = count ? sum / count : 0, share = Math.max(0, f.cover - shown) / Math.max(1e-6, 1 - shown);
      levelStats[r].maskMean = Math.round(shown * 1e4) / 1e4;
      const sheen = sheenRoughness(f), fc = hexLinear(f.color);
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
        const p = y * w + x;
        touched[p] = 1;
        rough[p] = rough[p] * (1 - share) + sheen * share;
        metal[p] = metal[p] * (1 - share) + f.metalness * share;
        for (let k = 0; k < 3; k++) col[p * 3 + k] = col[p * 3 + k] * (1 - share) + fc[k] * share;
      }
    });
    const diffuse = pd.slice(), roughness = pr.slice(), metalness = pm.slice(), normal = new Uint8Array(n * 2).fill(128), flakes = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (canvas.owner[p] !== NO_OWNER) { normal[p * 2] = unitByte(canvas.nx[p] * .5 + .5); normal[p * 2 + 1] = unitByte(canvas.ny[p] * .5 + .5); }
      // Flakes only where the pigment covers (its alpha chain), so the flake mask never reaches past the decal.
      const m = pd[p * 4 + 3] ? canvas.mask[p] : 0;
      if (!touched[p] && !m) continue;
      flakes[p] = unitByte(m);
      roughness[p] = unitByte(rough[p] * (1 - m) + canvas.rough[p]);
      metalness[p] = unitByte(metal[p] * (1 - m) + canvas.metal[p]);
      for (let k = 0; k < 3; k++) diffuse[p * 4 + k] = unitByte(srgbEncode(col[p * 3 + k] * (1 - m) + canvas.col[p * 3 + k]));
    }
    out.diffuse.push(diffuse); out.roughness.push(roughness); out.metalness.push(metalness); out.normal.push(normal); out.flakes.push(flakes);
    stats.push({ level: L, width: w, height: h, texelMm: [Math.round(tu * 1e4) / 1e4, Math.round(tv * 1e4) / 1e4], regions: levelStats });
  });

  // BOX regions: every lower level from the plain 2×2 BOX chain of the level-0 bytes, inside the region's texels.
  const boxRegions = regions.filter(({ region }) => region.mips === "box");
  if (boxRegions.length) {
    const planes: [string, (level: number) => Uint8Array, number, number, (b: number) => number, (v: number) => number][] = [
      ["flakes", L => out.flakes[L], 1, 0, b => b / 255, v => v],
      ["normalX", L => out.normal[L], 2, 0, unorm, v => v * .5 + .5], ["normalY", L => out.normal[L], 2, 1, unorm, v => v * .5 + .5],
      ["roughness", L => out.roughness[L], 1, 0, b => b / 255, v => v], ["metalness", L => out.metalness[L], 1, 0, b => b / 255, v => v],
      ...[0, 1, 2].map(k => [`diffuse${k}`, (L: number) => out.diffuse[L], 4, k, (b: number) => srgbDecode(b / 255), srgbEncode] as
        [string, (level: number) => Uint8Array, number, number, (b: number) => number, (v: number) => number]),
    ];
    for (const [, bytesOf, stride, offset, decode, encode] of planes) {
      let level: Float64Array<ArrayBufferLike> = Float64Array.from({ length: W * H }, (_, p) => decode(bytesOf(0)[p * stride + offset]));
      for (let L = 1; L < levelDims.length; L++) {
        level = reducePlanes(level, levelDims[L - 1].width, levelDims[L - 1].height, 1);
        const { width: w, height: h } = levelDims[L], target = bytesOf(L);
        for (const { rect } of boxRegions) {
          const box = regionTexels(rect, window, w, h);
          for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) target[(y * w + x) * stride + offset] = unitByte(encode(level[y * w + x]));
        }
      }
    }
  }

  let accent: Uint8Array[] | undefined, accentStats: GlitterChains["accentStats"];
  if (knob.accent) {
    const { layer: id, share } = knob.accent, c = catalogues.get(id)!, layer = layers.get(id)!;
    const chosen = [...orderOf.get(id)!].filter(i => c.key[i] < share);
    const size0 = ACCENT_TEXTURE_SIZE, head0 = Math.max(MM_PER_UV.u / size0, MM_PER_UV.v / size0);
    const area = (widths: number[]) => widths.reduce((sum, d, k) => sum + HEX_AREA * d * d * c.aspect[chosen[k]], 0);
    const a0 = area(chosen.map(i => Math.max(c.width[i], GLITTER_NESTING.minTexels * head0)));
    accent = []; accentStats = { layer: id, share, flakes: chosen.length, levels: [] };
    // Mask only: the accent draws no material and no normals.
    const accentCanvas = new Canvas(size0 * size0, false), accentClip = new Uint8Array(size0 * size0);
    for (let L = 0, size = size0; size >= 1; L++, size >>= 1) {
      const hu = MM_PER_UV.u / size, hv = MM_PER_UV.v / size, t = Math.max(hu, hv);
      const widths = chosen.map(i => Math.max(c.width[i], GLITTER_NESTING.minTexels * t));
      const target = a0 * GLITTER_NESTING.retention ** L, keep: number[] = [];
      let sum = 0;
      for (let k = 0; k < chosen.length; k++) { sum += HEX_AREA * widths[k] ** 2 * c.aspect[chosen[k]]; if (sum > target) break; if (widths[k] <= GLITTER_NESTING.capMm) keep.push(k); }
      const canvas = accentCanvas.level(size, size);
      if (keep.length) {
        const coverage = raster(layer, size), clip = accentClip.subarray(0, size * size);
        for (let p = 0; p < size * size; p++) clip[p] = coverage[p * 4 + 3];
        // Head texels: x = u·size, y = v·size (authored v); window millimetres shift by the window's origin.
        const ox = window.u0 * MM_PER_UV.u, oy = window.v0 * MM_PER_UV.v;
        for (let k = keep.length - 1; k >= 0; k--) {
          const i = chosen[keep[k]];
          stamp(canvas, { cx: c.cx[i] + ox, cy: c.cy[i] + oy, width: widths[keep[k]], rot: c.rot[i], aspect: c.aspect[i], nx: 0, ny: 0, rank: 0,
            rough: 0, metal: 0, col: [0, 0, 0] }, hu, hv, clip, false);
        }
      }
      accent.push(Uint8Array.from(canvas.mask, unitByte));
      accentStats.levels.push({ level: L, represented: keep.length });
    }
  }
  return { width: W, height: H, ...out, ...(accent ? { accent } : {}), stats, ...(accentStats ? { accentStats } : {}) };
}
