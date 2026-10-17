/**
 * Experimental CPU strand-atlas kernel. Pure, deterministic and worker-safe; no live registrations.
 * Rows run root-to-tip downwards; UVs use the same image convention (upload with flipY=false).
 * All four maps come from one sampled fibre population. See research/hair/hair-lab-textures.md.
 */
import { filterStrandId, type StrandIdSampling } from "./strand-id-filter";
import { DEFAULT_STRAND_ID_TARGETS } from "./strand-id-targets";

export type AtlasRect = { x: number; y: number; width: number; height: number };
export type HairCardType = "dense" | "clump" | "wisp" | "single";
export type HairAtlasRegionDescription = {
  key: string; type: HairCardType; variant: "straight" | "wave" | "curl";
  /** Cell including its transparent alpha gutter. Cells may not overlap. */
  rect: AtlasRect; padding: number; count: number;
  /** Fibre diameter as a fraction of the unpadded region width. */
  width: number; clumps: number; clumpStrength: number;
  /** Fraction of usable height, before root jitter. */
  length: [number, number]; rootJitter: number;
  /** Fractions of intrinsic length over which width grows/shrinks to zero. */
  rootTaper: number; tipTaper: number;
  wave: { amplitude: number; cycles: number }; frizz: { amplitude: number; cycles: number };
  /** Monotone inverse-CDF samples at evenly spaced quantiles, linear 0..1. */
  idQuantiles: number[];
  /** Optional artist thickness envelope, evenly spaced in intrinsic distance; multiplies the end tapers. */
  widthProfile?: number[];
  /** Bake for a mesh tangent opposite increasing image U, with UVs unchanged. Consumer must honour this basis. */
  mirrored?: boolean;
  lengthClass?: "long" | "short";
  idSampling?: StrandIdSampling;
  idHistogram?: readonly number[];
};
export type HairAtlasDescription = {
  schema: "xfs/hair-atlas-1"; width: number; height: number; seed: number; alphaCutoff: number;
  regions: HairAtlasRegionDescription[];
};
export type AtlasFibrePoint = { x: number; y: number; s: number; width: number };
export type AtlasFibre = { key: string; region: string; id: number; points: AtlasFibrePoint[] };
export type HairAtlasLevel = {
  width: number; height: number; alpha: Uint8Array; id: Uint8Array; gradient: Uint8Array; flow: Uint8Array;
};
export type AtlasMipCoverage = { level: number; target: number; raw: number; corrected: number; scale: number; saturated: boolean };
export type HairAtlasRegion = {
  key: string; type: HairCardType; variant: HairAtlasRegionDescription["variant"];
  rect: AtlasRect; cell: AtlasRect; padding: number; fibreCount: number;
  uv: { u0: number; u1: number; v0: number; v1: number };
  density: number; coverage: AtlasMipCoverage[]; mirrored: boolean;
  direction: { rmsRadians: number; flippedRmsRadians: number; recommendedMirrored: boolean };
  lengthClass: "long" | "short"; idDistributionError?: number;
};
export type HairAtlas = {
  schema: HairAtlasDescription["schema"]; seed: number; alphaCutoff: number;
  encoding: { alpha: "linear-r8"; id: "linear-r8"; gradient: "linear-r8"; flow: "srgb-rgb8" };
  levels: HairAtlasLevel[]; regions: HairAtlasRegion[]; maxSafeMip: number;
  flowError: { maxRadians: number; rmsRadians: number; unsupportedFraction: number; bestPerRegionRmsRadians: number };
};
export type AtlasProgress = { phase: "fibres" | "raster" | "measure" | "padding" | "filter" | "mips"; completed: number; total: number; level?: number };
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
const byte = (v: number) => Math.round(clamp(v) * 255);
// Numerical encoding contract from knowledge/hair-shading.md. Keep this isolated feature independent
// of legacy scene modules; the offline tests/probe compare it with the Studio's decoded colour model.
const coverage = (v: number, cutoff: number) => clamp((clamp((v - cutoff) / (1 - cutoff)) - .008843138) / (5 * .16535948));
const srgbToLinear = (value8: number) => { const c = value8 / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const linearToSrgb8 = (v: number) => { const c = clamp(v); return 255 * (c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055); };
const hairStrandRandom = (id: number) => { const fract = (v: number) => v - Math.floor(v); return fract(fract(id * .06711056 + id * .00583715) * 52.982918); };
const POPCOUNT = Uint8Array.from({ length: 65536 }, (_, i) => { let n = 0; while (i) { n += i & 1; i >>>= 1; } return n; });
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));
const CONE_MIN = .01;

function hash(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
}
function random(seed: number, index: number, channel: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ seed ^ Math.imul(channel + 1, 0x85ebca6b);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
function quantile(values: readonly number[], t: number): number {
  const position = clamp(t) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(position));
  return mix(values[i]!, values[i + 1]!, position - i);
}
function inside(region: HairAtlasRegionDescription): AtlasRect {
  const r = region.rect, p = region.padding;
  return { x: r.x + p, y: r.y + p, width: r.width - 2 * p, height: r.height - 2 * p };
}
const reduced = (r: AtlasRect, level: number): AtlasRect => ({ x: r.x / 2 ** level, y: r.y / 2 ** level,
  width: r.width / 2 ** level, height: r.height / 2 ** level });

/** The actual decoded shader direction for RGB8 Flow, at a declared material strength. */
export function decodeHairFlow(r: number, g: number, _b: number, strength = 1): [number, number] {
  const x = Math.max(strength * (2 * srgbToLinear(r) - 1), CONE_MIN);
  const y = Math.max(strength * (2 * srgbToLinear(g) - 2) + 1, CONE_MIN), n = Math.hypot(x, y);
  return [x / n, y / n];
}

/** Nearest supported unoriented axis at FlowStrength=1, including byte quantisation error. */
export function encodeHairFlow(dx: number, dy: number, mirrored = false): { rgb: [number, number, number]; errorRadians: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) === 0) throw Error("Invalid fibre direction.");
  if (mirrored) dx = -dx;
  const n = Math.hypot(dx, dy); dx /= n; dy /= n;
  // Select the equivalent axis in/nearest the positive quadrant; mixed-sign axes hit a cone boundary.
  if (dx + dy < 0) { dx = -dx; dy = -dy; }
  let angle = Math.atan2(dy, dx);
  angle = clamp(angle, Math.atan(CONE_MIN), Math.atan(1 / CONE_MIN));
  // Scale the longest coefficient to 1: this makes the cone boundary exactly representable.
  const cx = Math.cos(angle), cy = Math.sin(angle), largest = Math.max(cx, cy);
  const rgb: [number, number, number] = [Math.round(linearToSrgb8((1 + cx / largest) / 2)),
    Math.round(linearToSrgb8((1 + cy / largest) / 2)), 0];
  const decoded = decodeHairFlow(...rgb);
  return { rgb, errorRadians: Math.acos(clamp(Math.abs(dx * decoded[0] + dy * decoded[1]))) };
}

/** Reject excessive work before allocating. Caller-owned descriptions are never changed. */
export function validateHairAtlas(d: HairAtlasDescription): void {
  const bounded = (n: number, low: number, high: number) => Number.isFinite(n) && n >= low && n <= high;
  const integer = (n: number, low: number, high: number) => Number.isInteger(n) && bounded(n, low, high);
  const power = (n: number) => integer(n, 32, 4096) && (n & n - 1) === 0;
  if (d.schema !== "xfs/hair-atlas-1" || !power(d.width) || !power(d.height) || d.width * d.height > 4096 ** 2
    || !integer(d.seed, 0, 0xffffffff) || !bounded(d.alphaCutoff, 0, .95) || !Array.isArray(d.regions)
    || !d.regions.length || d.regions.length > 64) throw Error("Invalid hair atlas description.");
  const keys = new Set<string>(); let work = 0, fibres = 0;
  for (const r of d.regions) {
    const c = r.rect, p = r.padding;
    if (typeof r.key !== "string" || !r.key.length || r.key.length > 128 || keys.has(r.key)
      || !["dense", "clump", "wisp", "single"].includes(r.type) || !["straight", "wave", "curl"].includes(r.variant)
      || !c || !integer(c.x, 0, d.width) || !integer(c.y, 0, d.height) || !integer(c.width, 8, d.width)
      || !integer(c.height, 8, d.height) || c.x + c.width > d.width || c.y + c.height > d.height
      || !integer(p, 1, Math.floor((Math.min(c.width, c.height) - 4) / 2)) || !integer(r.count, 1, 4096)
      || !bounded(r.width, .0001, .15) || !integer(r.clumps, 1, 256) || !bounded(r.clumpStrength, 0, 1)
      || !Array.isArray(r.length) || r.length.length !== 2 || !bounded(r.length[0], .1, 1) || !bounded(r.length[1], r.length[0], 1)
      || !bounded(r.rootJitter, 0, .4) || !bounded(r.rootTaper, .001, .4) || !bounded(r.tipTaper, .001, .9)
      || !r.wave || !bounded(r.wave.amplitude, 0, .3) || !bounded(r.wave.cycles, 0, 16)
      || !r.frizz || !bounded(r.frizz.amplitude, 0, .1) || !bounded(r.frizz.cycles, 0, 64)
      || r.mirrored !== undefined && typeof r.mirrored !== "boolean"
      || r.lengthClass !== undefined && !["long", "short"].includes(r.lengthClass)
      || r.idSampling !== undefined && (!integer(r.idSampling.size, 1, 16) || !bounded(r.idSampling.background, 0, 1))
      || r.idHistogram !== undefined && (!r.idSampling || !Array.isArray(r.idHistogram) || r.idHistogram.length !== 16
        || r.idHistogram.some(v => !bounded(v, 0, 1)) || r.idHistogram.reduce((a, b) => a + b, 0) <= 0)
      || r.widthProfile !== undefined && (!Array.isArray(r.widthProfile) || r.widthProfile.length < 2
        || r.widthProfile.length > 33 || r.widthProfile.some(v => !bounded(v, 0, 1)) || !r.widthProfile.some(v => v > 0))
      || !Array.isArray(r.idQuantiles) || r.idQuantiles.length < 2 || r.idQuantiles.length > 257
      || r.idQuantiles.some((v, i) => !bounded(v, 0, 1) || i > 0 && v < r.idQuantiles[i - 1]!)) throw Error(`Invalid atlas region: ${r.key}`);
    keys.add(r.key); fibres += r.count;
    // Supersampled scanlines times estimated horizontal footprint. Bound both wide fibres and long atlases.
    work += r.count * c.height * 4 * (2 + c.width * r.width);
  }
  if (fibres > 12000 || work > 250_000_000) throw Error("Hair atlas exceeds the offline work budget.");
  for (let i = 0; i < d.regions.length; i++) for (let j = 0; j < i; j++) {
    const a = d.regions[i]!.rect, b = d.regions[j]!.rect;
    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
      throw Error("Atlas region cells overlap.");
  }
}

function* sampleSteps(d: HairAtlasDescription, signal?: AbortSignal): Generator<AtlasProgress, AtlasFibre[]> {
  const out: AtlasFibre[] = [], regions = [...d.regions].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const total = regions.reduce((n, r) => n + r.count, 0);
  for (const r of regions) {
    const rect = inside(r), seed = hash(r.key, d.seed);
    // Stratify the requested ID distribution, then shuffle it independently of root position and draw order.
    const order = Array.from({ length: r.count }, (_, i) => i).sort((a, b) => random(seed, a, 5) - random(seed, b, 5) || a - b);
    const rank = new Uint16Array(r.count); order.forEach((index, position) => { rank[index] = position; });
    for (let i = 0; i < r.count; i++) {
      if (i % 16 === 0) { signal?.throwIfAborted(); yield { phase: "fibres", completed: out.length, total }; signal?.throwIfAborted(); }
      const rand = (channel: number) => random(seed, i, channel);
      const root = (i + rand(0)) / r.count, group = Math.min(r.clumps - 1, Math.floor(root * r.clumps));
      const centre = (group + .3 + .4 * random(seed, group, 19)) / r.clumps;
      const start = r.rootJitter * rand(1), end = start + mix(...r.length, rand(2)) * (1 - start);
      const phase = rand(3) * Math.PI * 2, groupPhase = random(seed, group, 20) * Math.PI * 2;
      const count = Math.max(48, Math.ceil(Math.max(r.wave.cycles, r.frizz.cycles) * 12));
      const points: AtlasFibrePoint[] = []; let distance = 0;
      for (let j = 0; j <= count; j++) {
        const t = j / count, clump = r.clumpStrength * smooth(t / .7);
        const margin = r.width * .7 + r.wave.amplitude + r.frizz.amplitude;
        const x = mix(margin, 1 - margin, mix(root, centre, clump)) + r.wave.amplitude * Math.sin(t * r.wave.cycles * Math.PI * 2 + groupPhase)
          + r.frizz.amplitude * (Math.sin(t * r.frizz.cycles * Math.PI * 2 + phase) * .7
            + Math.sin(t * r.frizz.cycles * 1.713 * Math.PI * 2 + phase * 2.17) * .3);
        // Keep a real margin inside the content box, so clamp never clips the fibre's width.
        const px = rect.x + x * rect.width;
        const py = rect.y + (start + (end - start) * t) * (rect.height - 1);
        if (j) distance += Math.hypot(px - points[j - 1]!.x, py - points[j - 1]!.y);
        points.push({ x: px, y: py, s: distance, width: 0 });
      }
      for (const p of points) {
        p.s /= distance;
        p.width = r.width * rect.width * (.75 + .5 * rand(4)) * smooth(p.s / r.rootTaper)
          * smooth((1 - p.s) / r.tipTaper) * (r.widthProfile ? quantile(r.widthProfile, p.s) : 1);
      }
      out.push({ key: `${r.key}:${i}`, region: r.key, id: quantile(r.idQuantiles, (rank[i]! + rand(23)) / r.count), points });
    }
  }
  return out;
}

export function sampleAtlasFibres(d: HairAtlasDescription, signal?: AbortSignal): AtlasFibre[] {
  signal?.throwIfAborted(); validateHairAtlas(d);
  const steps = sampleSteps(d, signal); let next = steps.next(); while (!next.done) next = steps.next(); return next.value;
}
function level(width: number, height: number): HairAtlasLevel {
  const count = width * height;
  return { width, height, alpha: new Uint8Array(count), id: new Uint8Array(count), gradient: new Uint8Array(count), flow: new Uint8Array(count * 3) };
}

function validateFibres(d: HairAtlasDescription, fibres: readonly AtlasFibre[]): void {
  if (fibres.length > 12000) throw Error("Too many atlas fibres.");
  const regions = new Map(d.regions.map(r => [r.key, inside(r)])), keys = new Set<string>(); let points = 0, work = 0;
  for (const f of fibres) {
    const r = regions.get(f.region); points += f.points.length;
    if (!r || keys.has(f.key) || !Number.isFinite(f.id) || f.id < 0 || f.id > 1 || f.points.length < 2
      || f.points.length > 1024 || f.points[0]!.s !== 0 || f.points.at(-1)!.s !== 1) throw Error("Invalid atlas fibre.");
    keys.add(f.key);
    for (let i = 0; i < f.points.length; i++) {
      const p = f.points[i]!, previous = f.points[i - 1];
      if (![p.x, p.y, p.s, p.width].every(Number.isFinite) || p.x < r.x || p.x > r.x + r.width
        || p.y < r.y || p.y > r.y + r.height || p.width < 0 || p.width > r.width * .25
        || p.s < 0 || p.s > 1 || previous && (p.y <= previous.y || p.s <= previous.s)) throw Error("Invalid fibre polyline.");
      if (previous) work += (p.y - previous.y) * 4 * (2 + Math.max(p.width, previous.width) * Math.hypot(1, (p.x - previous.x) / (p.y - previous.y)));
    }
  }
  if (points > 1_000_000 || work > 250_000_000) throw Error("Too many fibre samples or raster operations.");
}

function* rasterSteps(d: HairAtlasDescription, fibres: readonly AtlasFibre[], signal?: AbortSignal): Generator<AtlasProgress, HairAtlas> {
  signal?.throwIfAborted(); validateFibres(d, fibres);
  const base = level(d.width, d.height), masks = new Uint16Array(d.width * d.height);
  const rects = new Map(d.regions.map(r => [r.key, inside(r)]));
  const specifications = new Map(d.regions.map(r => [r.key, r]));
  const errors = new Map(d.regions.map(r => [r.key, { weight: 0, selected: 0, flipped: 0 }]));
  let errorSq = 0, errorMax = 0, errorWeight = 0, unsupported = 0;
  for (let index = 0; index < fibres.length; index++) {
    if (index % 16 === 0) { signal?.throwIfAborted(); yield { phase: "raster", completed: index, total: fibres.length }; signal?.throwIfAborted(); }
    const f = fibres[index]!, rect = rects.get(f.region)!, id = byte(f.id);
    for (let j = 1; j < f.points.length; j++) {
      const a = f.points[j - 1]!, b = f.points[j]!, dy = b.y - a.y, dx = b.x - a.x, slope = dx / dy;
      const mirrored = specifications.get(f.region)!.mirrored ?? false;
      const encoded = encodeHairFlow(dx, dy, mirrored), flipped = encodeHairFlow(dx, dy, !mirrored), weight = Math.hypot(dx, dy);
      errorMax = Math.max(errorMax, encoded.errorRadians); errorSq += encoded.errorRadians ** 2 * weight; errorWeight += weight;
      const regionError = errors.get(f.region)!;
      regionError.weight += weight; regionError.selected += encoded.errorRadians ** 2 * weight; regionError.flipped += flipped.errorRadians ** 2 * weight;
      if ((mirrored ? -dx : dx) < 0) unsupported += weight;
      const first = Math.max(rect.y * 4, Math.ceil(a.y * 4 - .5)), last = Math.min((rect.y + rect.height) * 4 - 1, Math.ceil(b.y * 4 - .5) - 1);
      for (let sy = first; sy <= last; sy++) {
        const y = (sy + .5) / 4, t = (y - a.y) / dy, x = mix(a.x, b.x, t);
        const halfWidth = mix(a.width, b.width, t) * .5 * Math.hypot(1, slope);
        if (halfWidth === 0) continue;
        const left = Math.max(rect.x * 4, Math.ceil((x - halfWidth) * 4 - .5));
        const right = Math.min((rect.x + rect.width) * 4 - 1, Math.floor((x + halfWidth) * 4 - .5));
        const py = sy >> 2, shift = (sy & 3) * 4, gradient = byte(mix(a.s, b.s, t));
        for (let px = left >> 2; px <= right >> 2 && left <= right; px++) {
          const lo = Math.max(left - px * 4, 0), hi = Math.min(right - px * 4, 3);
          const bits = (((1 << (hi - lo + 1)) - 1) << lo) << shift, k = py * d.width + px;
          masks[k] = masks[k]! | bits;
          // Painter order is shared by all attributes, including crossings and subpixel silhouettes.
          base.id[k] = id; base.gradient[k] = gradient;
          base.flow[k * 3] = encoded.rgb[0]; base.flow[k * 3 + 1] = encoded.rgb[1];
        }
      }
    }
  }
  for (let i = 0; i < masks.length; i++) base.alpha[i] = Math.round(POPCOUNT[masks[i]!]! * 255 / 16);
  const regions: HairAtlasRegion[] = [];
  const orderedRegions = [...d.regions].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const r of orderedRegions) {
    signal?.throwIfAborted(); yield { phase: "measure", completed: regions.length, total: orderedRegions.length }; signal?.throwIfAborted();
    const rect = inside(r);
    const idDistributionError = r.idSampling ? filterStrandId(base, r.rect, rect, d.alphaCutoff, r.idSampling, r.idHistogram, signal) : undefined;
    const stats = measureAtlasRegion(base, rect, d.alphaCutoff);
    const e = errors.get(r.key)!, mirrored = r.mirrored ?? false;
    regions.push({ key: r.key, type: r.type, variant: r.variant, rect, cell: { ...r.rect }, padding: r.padding,
      fibreCount: fibres.filter(f => f.region === r.key).length,
      uv: { u0: rect.x / d.width, u1: (rect.x + rect.width) / d.width, v0: rect.y / d.height, v1: (rect.y + rect.height) / d.height },
      density: stats.coverage, mirrored, lengthClass: r.lengthClass ?? "long",
      ...(idDistributionError === undefined ? {} : { idDistributionError }),
      direction: { rmsRadians: Math.sqrt(e.selected / (e.weight || 1)), flippedRmsRadians: Math.sqrt(e.flipped / (e.weight || 1)),
        recommendedMirrored: e.flipped < e.selected ? !mirrored : mirrored },
      coverage: [{ level: 0, target: stats.filteredCoverage, raw: stats.filteredCoverage, corrected: stats.filteredCoverage, scale: 1, saturated: false }] });
  }
  for (let i = 0; i < regions.length; i++) {
    signal?.throwIfAborted(); yield { phase: "padding", completed: i, total: regions.length }; signal?.throwIfAborted();
    padAttributes(base, regions[i]!.cell);
  }
  let maxSafeMip = 0;
  while (maxSafeMip < Math.log2(Math.min(d.width, d.height))) {
    const divisor = 2 ** (maxSafeMip + 1);
    if (regions.some(r => r.padding / divisor < 1 || Object.values(r.cell).some(v => v % divisor !== 0)
      || Object.values(r.rect).some(v => v % divisor !== 0) || Math.min(r.rect.width, r.rect.height) / divisor < 4)) break;
    maxSafeMip++;
  }
  const levels = [base]; let rawAlpha = base.alpha;
  for (let mip = 1; mip <= maxSafeMip; mip++) {
    const next = yield* downsampleSteps(levels.at(-1)!, rawAlpha, mip, signal); rawAlpha = next.alpha;
    next.alpha = next.alpha.slice();
    for (let index = 0; index < regions.length; index++) {
      signal?.throwIfAborted(); yield { phase: "mips", level: mip, completed: index, total: regions.length }; signal?.throwIfAborted();
      const r = regions[index]!;
      const rect = reduced(r.rect, mip), target = r.coverage[0]!.target;
      const correction = preserveCoverage(next.alpha, next.width, rect, d.alphaCutoff, target);
      r.coverage.push({ level: mip, target, ...correction });
      padAttributes(next, reduced(r.cell, mip));
    }
    levels.push(next);
  }
  return { schema: d.schema, seed: d.seed, alphaCutoff: d.alphaCutoff,
    encoding: { alpha: "linear-r8", id: "linear-r8", gradient: "linear-r8", flow: "srgb-rgb8" }, levels, regions, maxSafeMip,
    flowError: { maxRadians: errorMax, rmsRadians: Math.sqrt(errorSq / (errorWeight || 1)), unsupportedFraction: unsupported / (errorWeight || 1),
      bestPerRegionRmsRadians: Math.sqrt(regions.reduce((n, r) => { const e = errors.get(r.key)!; return n + Math.min(e.selected, e.flipped); }, 0) / (errorWeight || 1)) } };
}

/** Extend only ID/gradient/Flow, including gutters. Alpha stays zero outside the fibre sample. */
function padAttributes(map: HairAtlasLevel, r: AtlasRect): void {
  const size = r.width * r.height, source = new Int32Array(size).fill(-1), distance = new Uint16Array(size).fill(65535);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const i = y * r.width + x, k = (y + r.y) * map.width + x + r.x;
    if (map.alpha[k]! > 0) { source[i] = i; distance[i] = 0; }
  }
  const inherit = (i: number, other: number) => {
    if (distance[other]! + 1 < distance[i]!) { distance[i] = distance[other]! + 1; source[i] = source[other]!; }
  };
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const i = y * r.width + x; if (x) inherit(i, i - 1); if (y) inherit(i, i - r.width);
  }
  for (let y = r.height - 1; y >= 0; y--) for (let x = r.width - 1; x >= 0; x--) {
    const i = y * r.width + x; if (x + 1 < r.width) inherit(i, i + 1); if (y + 1 < r.height) inherit(i, i + r.width);
    if (distance[i] === 0 || source[i]! < 0) continue;
    const s = source[i]!, from = (r.y + Math.floor(s / r.width)) * map.width + r.x + s % r.width;
    const to = (r.y + y) * map.width + r.x + x;
    map.id[to] = map.id[from]!; map.gradient[to] = map.gradient[from]!;
    map.flow.set(map.flow.subarray(from * 3, from * 3 + 3), to * 3);
  }
}

function* downsampleSteps(previous: HairAtlasLevel, rawAlpha: Uint8Array, mip: number, signal?: AbortSignal): Generator<AtlasProgress, HairAtlasLevel> {
  const out = level(previous.width / 2, previous.height / 2);
  for (let y = 0; y < out.height; y++) {
    if (y % 32 === 0) { signal?.throwIfAborted(); yield { phase: "filter", level: mip, completed: y, total: out.height }; signal?.throwIfAborted(); }
    for (let x = 0; x < out.width; x++) {
      const k = y * out.width + x; let alpha = 0, id = 0, gradient = 0, fr = 0, fg = 0, weight = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const from = (y * 2 + dy) * previous.width + x * 2 + dx, a = rawAlpha[from]!;
        // Alpha weights retain sub-cutoff fibres for a later compensated level.
        const w = a / 255; alpha += a; weight += w;
        id += previous.id[from]! * w; gradient += previous.gradient[from]! * w;
        fr += LINEAR[previous.flow[from * 3]!]! * w; fg += LINEAR[previous.flow[from * 3 + 1]!]! * w;
      }
      out.alpha[k] = Math.round(alpha / 4);
      if (weight) {
        out.id[k] = Math.round(id / weight); out.gradient[k] = Math.round(gradient / weight);
        out.flow[k * 3] = Math.round(linearToSrgb8(fr / weight)); out.flow[k * 3 + 1] = Math.round(linearToSrgb8(fg / weight));
      }
    }
  }
  return out;
}

function preserveCoverage(alpha: Uint8Array, width: number, r: AtlasRect, cutoff: number, target: number): Omit<AtlasMipCoverage, "level" | "target"> {
  const histogram = new Map<number, number>(), count = r.width * r.height * 4;
  // Four bilinear subtexel positions: weights are 9/16 at the centre, 3/16 at its two neighbours,
  // 1/16 at the diagonal. Store tuples so clipping/quantisation happens BEFORE filtering, as on a GPU.
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const k = y * width + x, a = alpha[k]!;
    for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
      let b = alpha[k + dx]!, c = alpha[k + dy * width]!; if (b > c) [b, c] = [c, b];
      const key = (a | b << 8 | c << 16 | alpha[k + dy * width + dx]! << 24) >>> 0;
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  }
  const entries = [...histogram], lookup = Float64Array.from({ length: 4081 }, (_, i) => coverage(i / 4080, cutoff));
  const scaled = new Uint8Array(256);
  const value = (scale: number) => {
    for (let i = 0; i < 256; i++) scaled[i] = Math.min(255, Math.round(i * scale));
    let sum = 0;
    for (const [key, n] of entries) sum += n * lookup[9 * scaled[key & 255]! + 3 * scaled[key >>> 8 & 255]!
      + 3 * scaled[key >>> 16 & 255]! + scaled[key >>> 24]!]!;
    return sum / count;
  };
  const raw = value(1), max = value(256); let low = 0, high = 256, scale = 1, corrected = raw;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2, c = value(middle);
    if (Math.abs(c - target) < Math.abs(corrected - target)) { scale = middle; corrected = c; }
    if (c < target) low = middle; else high = middle;
  }
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const k = y * width + x; alpha[k] = Math.min(255, Math.round(alpha[k]! * scale));
  }
  return { raw, corrected, scale, saturated: target > max + 1e-9 };
}

export type AtlasDistribution = { mean: number; histogram: number[] };
export type AtlasRegionStatistics = { coverage: number; filteredCoverage: number; alphaMean: number; id: AtlasDistribution; gradient: AtlasDistribution; shift: AtlasDistribution };
/** Integrated 2x2 subtexel bilinear coverage, including the transparent border around a content rectangle. */
export function measureFilteredCoverage(alpha: Uint8Array, width: number, r: AtlasRect, alphaCutoff: number): number {
  const height = alpha.length / width;
  if (![width, height, r.x, r.y, r.width, r.height].every(Number.isInteger) || width < 1 || height < 1
    || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 || r.x + r.width > width || r.y + r.height > height
    || !Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff >= 1) throw Error("Invalid filtered-coverage input.");
  const lookup = Float64Array.from({ length: 4081 }, (_, i) => coverage(i / 4080, alphaCutoff));
  let sum = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const k = y * width + x, row = y * width, above = Math.max(0, y - 1) * width, below = Math.min(height - 1, y + 1) * width;
    const left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1), a = 9 * alpha[k]!;
    sum += lookup[a + 3 * (alpha[row + left]! + alpha[above + x]!) + alpha[above + left]!]!
      + lookup[a + 3 * (alpha[row + right]! + alpha[above + x]!) + alpha[above + right]!]!
      + lookup[a + 3 * (alpha[row + left]! + alpha[below + x]!) + alpha[below + left]!]!
      + lookup[a + 3 * (alpha[row + right]! + alpha[below + x]!) + alpha[below + right]!]!;
  }
  return sum / (r.width * r.height * 4);
}
/** Weight distributions by resolved visibility, excluding the arbitrary padded background. */
export function measureAtlasRegion(map: HairAtlasLevel, r: AtlasRect, alphaCutoff: number): AtlasRegionStatistics {
  if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1
    || r.x + r.width > map.width || r.y + r.height > map.height) throw Error("Invalid measurement rectangle.");
  const id = { mean: 0, histogram: Array<number>(16).fill(0) }, gradient = { mean: 0, histogram: Array<number>(16).fill(0) }, shift = { mean: 0, histogram: Array<number>(16).fill(0) };
  let visible = 0, alphaMean = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const k = y * map.width + x, a = map.alpha[k]! / 255, w = coverage(a, alphaCutoff); visible += w; alphaMean += a;
    const iv = map.id[k]! / 255, gv = map.gradient[k]! / 255, sv = hairStrandRandom(iv);
    id.mean += iv * w; gradient.mean += gv * w; shift.mean += sv * w;
    id.histogram[Math.min(15, Math.floor(iv * 16))]! += w;
    gradient.histogram[Math.min(15, Math.floor(gv * 16))]! += w;
    shift.histogram[Math.min(15, Math.floor(sv * 16))]! += w;
  }
  for (const distribution of [id, gradient, shift]) {
    distribution.mean /= visible || 1; distribution.histogram = distribution.histogram.map(v => v / (visible || 1));
  }
  return { coverage: visible / (r.width * r.height),
    filteredCoverage: measureFilteredCoverage(map.alpha, map.width, r, alphaCutoff),
    alphaMean: alphaMean / (r.width * r.height), id, gradient, shift };
}

/** Resumable batches: worker adapters can return to their event loop between `next()` calls. */
export function* hairAtlasSteps(d: HairAtlasDescription, signal?: AbortSignal): Generator<AtlasProgress, HairAtlas> {
  signal?.throwIfAborted(); validateHairAtlas(d);
  const fibres = yield* sampleSteps(d, signal);
  return yield* rasterSteps(d, fibres, signal);
}
export function generateHairAtlas(d: HairAtlasDescription, signal?: AbortSignal): HairAtlas {
  const steps = hairAtlasSteps(d, signal); let next = steps.next(); while (!next.done) next = steps.next(); return next.value;
}
/** Explicit fibre fixture/bake boundary. Painter order is the supplied fibre order, back to front. */
export function rasterAtlasFibres(d: HairAtlasDescription, fibres: readonly AtlasFibre[], signal?: AbortSignal): HairAtlas {
  signal?.throwIfAborted(); validateHairAtlas(d);
  const steps = rasterSteps(d, fibres, signal); let next = steps.next(); while (!next.done) next = steps.next(); return next.value;
}

/** Independent fibre parameters plus documented aggregate ID targets; no reference texture pixels. */
export function defaultHairAtlas(size = 2048): HairAtlasDescription {
  if (!Number.isInteger(size) || size < 256 || size > 4096 || (size & size - 1)) throw Error("Default atlas size must be a power of two from 256 to 4096.");
  const scale = size / 2048, padding = Math.max(1, Math.round(8 * scale));
  const specs: [string, HairCardType, HairAtlasRegionDescription["variant"], number, number, number, number, number, number][] = [
    ["dense-a", "dense", "straight", 0, 0, 448, 1536, 170, .006],
    ["dense-b", "dense", "wave", 448, 0, 368, 1536, 155, .006],
    ["wisp-a", "wisp", "straight", 816, 0, 128, 1536, 42, .0054],
    ["clump-a", "clump", "wave", 944, 0, 256, 1536, 75, .007],
    ["wisp-b", "wisp", "wave", 1200, 0, 160, 1536, 40, .00585],
    ["wisp-c", "wisp", "straight", 1360, 0, 144, 1536, 40, .00565],
    ["wisp-d", "wisp", "curl", 1504, 0, 144, 1536, 36, .0057],
    ["clump-b", "clump", "wave", 1648, 0, 208, 1536, 39, .009],
    ["singles", "single", "curl", 1856, 0, 192, 1536, 8, .0092],
    ["short-wisp-a", "wisp", "wave", 0, 1536, 512, 512, 160, .0028],
    ["short-wisp-b", "wisp", "curl", 512, 1536, 448, 512, 200, .003],
    ["short-clump", "clump", "wave", 960, 1536, 512, 512, 300, .007],
    ["short-dense", "dense", "wave", 1472, 1536, 448, 512, 155, .006],
    ["short-single", "single", "straight", 1920, 1536, 128, 512, 36, .0091],
  ];
  return { schema: "xfs/hair-atlas-1", seed: 1701, width: size, height: size, alphaCutoff: 0,
    regions: specs.map(([key, type, variant, x, y, width, height, count, fibreWidth]) => ({ key, type, variant,
      rect: { x: x * scale, y: y * scale, width: width * scale, height: height * scale }, padding, count, width: fibreWidth,
      lengthClass: y ? "short" : "long", idSampling: { size: Math.max(1, size / 512), background: 104 / 255 }, idHistogram: DEFAULT_STRAND_ID_TARGETS[key],
      clumps: type === "dense" ? 7 : type === "single" ? 1 : 3, clumpStrength: type === "clump" ? .55 : .12,
      length: [.76, 1], rootJitter: .04, rootTaper: .06, tipTaper: y ? type === "dense" ? .35 : .5 : .32,
      wave: { amplitude: variant === "straight" ? .007 : .02, cycles: variant === "curl" ? 2.5 : 1.2 },
      frizz: { amplitude: .002, cycles: 6 },
      ...(y && type !== "dense" ? { widthProfile: [0, .05, .45, 1, .65, .1, .01, .001, 0] } : {}),
      idQuantiles: y && type !== "dense" ? [.18, .32, .38, .42, .46, .49, .52, .57, .65]
        : [.05, .19, .29, .36, .42, .47, .53, .59, .67, .77, .91] })) };
}
