/** Worker-side region isolation. A selected card keeps its own full mip chain even after atlas cells would merge. */
import { measureFilteredCoverage, type AtlasMipCoverage, type HairAtlas, type HairAtlasLevel, type HairAtlasRegion } from "./textures";

export type HairStripKind = "dense" | "clump" | "wisp" | "flyaway" | "curl";
export type HairAtlasStrip = {
  key: string; kinds: HairStripKind[]; lengthClass: "long" | "short"; mirrored: boolean; fibreCount: number; density: number;
  atlasUV: HairAtlasRegion["uv"]; levels: HairAtlasLevel[]; coverage: AtlasMipCoverage[];
};
export type PreparedHairAtlas = { schema: "xfs/hair-atlas-strips-1"; seed: number; alphaCutoff: number; strips: HairAtlasStrip[] };
export type HairStripQuery = { kind?: HairStripKind; lengthClass?: "long" | "short"; mirrored?: boolean };
const srgb = (b: number) => { const v = b / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const encode = (v: number) => Math.round(255 * (v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055));
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const coverage = (v: number, cutoff: number) => clamp((clamp((v - cutoff) / (1 - cutoff)) - .008843138) / (.16535948 * 5));
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgb(i));
const empty = (width: number, height: number): HairAtlasLevel => ({ width, height, alpha: new Uint8Array(width * height),
  id: new Uint8Array(width * height), gradient: new Uint8Array(width * height), flow: new Uint8Array(width * height * 3) });

function crop(map: HairAtlasLevel, r: HairAtlasRegion["rect"]): HairAtlasLevel {
  const out = empty(r.width, r.height);
  for (let y = 0; y < r.height; y++) for (const key of ["alpha", "id", "gradient", "flow"] as const) {
    const channels = key === "flow" ? 3 : 1, start = ((r.y + y) * map.width + r.x) * channels;
    out[key].set(map[key].subarray(start, start + r.width * channels), y * r.width * channels);
  }
  return out;
}

/** Area filtering handles odd/NPOT dimensions without dropping the last source row or column. */
function halve(previous: HairAtlasLevel, alpha: Float32Array, signal?: AbortSignal): { map: HairAtlasLevel; raw: Float32Array } {
  const out = empty(Math.max(1, previous.width >> 1), Math.max(1, previous.height >> 1)), raw = new Float32Array(out.width * out.height);
  const sx = previous.width / out.width, sy = previous.height / out.height;
  for (let y = 0; y < out.height; y++) {
    if (y % 32 === 0) signal?.throwIfAborted();
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < out.width; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx, k = y * out.width + x;
      let a = 0, id = 0, gradient = 0, fr = 0, fg = 0;
      let padId = 0, padGradient = 0, padR = 0, padG = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
        if (px >= previous.width || py >= previous.height) continue;
        const area = Math.max(0, Math.min(x1, px + 1) - Math.max(x0, px)) * Math.max(0, Math.min(y1, py + 1) - Math.max(y0, py));
        const from = py * previous.width + px, w = alpha[from]! * area;
        a += w; id += previous.id[from]! * w; gradient += previous.gradient[from]! * w;
        fr += LINEAR[previous.flow[from * 3]!]! * w; fg += LINEAR[previous.flow[from * 3 + 1]!]! * w;
        padId += previous.id[from]! * area; padGradient += previous.gradient[from]! * area;
        padR += LINEAR[previous.flow[from * 3]!]! * area; padG += LINEAR[previous.flow[from * 3 + 1]!]! * area;
      }
      raw[k] = a / (sx * sy);
      // Retain a positive footprint for compensation even when a very sparse mean falls below one byte.
      out.alpha[k] = a > 0 ? Math.max(1, Math.round(raw[k]! * 255)) : 0;
      if (a > 0) {
        out.id[k] = Math.round(id / a); out.gradient[k] = Math.round(gradient / a);
        out.flow[k * 3] = encode(fr / a); out.flow[k * 3 + 1] = encode(fg / a);
      } else {
        // Carry the region's padded attributes through empty footprints; transparent black makes filtering halos.
        const area = sx * sy;
        out.id[k] = Math.round(padId / area); out.gradient[k] = Math.round(padGradient / area);
        out.flow[k * 3] = encode(padR / area); out.flow[k * 3 + 1] = encode(padG / area);
      }
    }
  }
  return { map: out, raw };
}

/** Quantisation and clipping precede bilinear sampling. The clamped domain remains valid at 1xN and 1x1. */
function compensate(map: HairAtlasLevel, cutoff: number, target: number): Omit<AtlasMipCoverage, "level" | "target"> {
  const { width, height, alpha } = map, histogram = new Map<number, number>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = alpha[y * width + x]!;
    for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
      const nx = Math.max(0, Math.min(width - 1, x + dx)), ny = Math.max(0, Math.min(height - 1, y + dy));
      let b = alpha[y * width + nx]!, c = alpha[ny * width + x]!; if (b > c) [b, c] = [c, b];
      const packed = (a | b << 8 | c << 16 | alpha[ny * width + nx]! << 24) >>> 0;
      histogram.set(packed, (histogram.get(packed) ?? 0) + 1);
    }
  }
  const tuples = [...histogram], lookup = Float64Array.from({ length: 4081 }, (_, i) => coverage(i / 4080, cutoff)), scaled = new Uint8Array(256);
  const evaluate = (scale: number) => {
    for (let i = 0; i < 256; i++) scaled[i] = Math.min(255, Math.round(i * scale));
    let sum = 0;
    for (const [key, n] of tuples) sum += n * lookup[9 * scaled[key & 255]! + 3 * scaled[key >>> 8 & 255]!
      + 3 * scaled[key >>> 16 & 255]! + scaled[key >>> 24]!]!;
    return sum / (width * height * 4);
  };
  const raw = evaluate(1), maximum = evaluate(256); let low = 0, high = 256, scale = 1, corrected = raw;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2, value = evaluate(middle);
    if (Math.abs(value - target) < Math.abs(corrected - target)) { corrected = value; scale = middle; }
    if (value < target) low = middle; else high = middle;
  }
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(255, Math.round(alpha[i]! * scale));
  return { raw, corrected, scale, saturated: target > maximum + 1e-9 };
}

/** Return value is a complete transferable CPU set. No Three objects, files, globals or implicit resource cache. */
export function* hairAtlasStripSteps(atlas: HairAtlas, signal?: AbortSignal): Generator<{ region: string; level: number }, PreparedHairAtlas> {
  signal?.throwIfAborted();
  const source = atlas.levels[0];
  if (!source || !Number.isFinite(atlas.alphaCutoff) || atlas.alphaCutoff < 0 || atlas.alphaCutoff >= 1
    || source.alpha.length !== source.width * source.height || source.id.length !== source.alpha.length
    || source.gradient.length !== source.alpha.length || source.flow.length !== source.alpha.length * 3) throw Error("Invalid source atlas.");
  const strips: HairAtlasStrip[] = [], keys = new Set<string>();
  for (const region of [...atlas.regions].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) {
    signal?.throwIfAborted(); yield { region: region.key, level: 0 }; signal?.throwIfAborted();
    const r = region.rect;
    if (keys.has(region.key) || !Object.values(r).every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1
      || r.x + r.width > source.width || r.y + r.height > source.height) throw Error("Invalid atlas strip rectangle.");
    keys.add(region.key);
    const first = crop(source, r), levels = [first], full = { x: 0, y: 0, width: first.width, height: first.height };
    const target = measureFilteredCoverage(first.alpha, first.width, full, atlas.alphaCutoff);
    const records: AtlasMipCoverage[] = [{ level: 0, target, raw: target, corrected: target, scale: 1, saturated: false }];
    let raw: Float32Array = Float32Array.from(first.alpha, v => v / 255);
    while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
      signal?.throwIfAborted(); yield { region: region.key, level: levels.length }; signal?.throwIfAborted();
      const next = halve(levels.at(-1)!, raw, signal); raw = next.raw;
      const correction = compensate(next.map, atlas.alphaCutoff, target);
      records.push({ level: levels.length, target, ...correction }); levels.push(next.map);
    }
    const kinds: HairStripKind[] = [region.type === "single" ? "flyaway" : region.type];
    if (region.variant === "curl") kinds.push("curl");
    strips.push({ key: region.key, kinds, lengthClass: region.lengthClass ?? "long", mirrored: region.mirrored,
      atlasUV: { ...region.uv }, fibreCount: region.fibreCount, density: region.density, levels, coverage: records });
  }
  return { schema: "xfs/hair-atlas-strips-1", seed: atlas.seed, alphaCutoff: atlas.alphaCutoff, strips };
}
export function prepareHairAtlasStrips(atlas: HairAtlas, signal?: AbortSignal): PreparedHairAtlas {
  const work = hairAtlasStripSteps(atlas, signal); let next = work.next(); while (!next.done) next = work.next(); return next.value;
}
export function selectHairAtlasStrip(atlas: PreparedHairAtlas, query: HairStripQuery, variation = 0): HairAtlasStrip | null {
  if (!Number.isFinite(variation)) throw Error("Invalid strip variation.");
  const candidates = atlas.strips.filter(r => (!query.kind || r.kinds.includes(query.kind))
    && (!query.lengthClass || r.lengthClass === query.lengthClass) && (query.mirrored === undefined || r.mirrored === query.mirrored));
  return candidates.length ? candidates[Math.abs(Math.trunc(variation)) % candidates.length]! : null;
}
