// Independent checks of the diagnostic Glitter route's supplied chains. Pure: no IO.
//
// Nothing here imports the builder (src/glitter-route.ts, src/glitter-region.ts). The route's nested levels are *drawn*
// from a flake catalogue, so they cannot be re-derived from level 0 the way the flat chains are; instead this module
// restates the published properties every level must have, from the preset's own recipe and glitter knob:
//
// - Coverage: the diffuse alpha chain is exactly the flat route's coverage-space chain of level 0's alpha
//   (unitByte(√mean((a/255)²))), so the decal covers exactly what the pigment layers cover; flakes appear only
//   where that coverage is non-zero.
// - Regions: a region's UV rectangle is its layer's outline bounds (restated in resource-checks.ts) clipped to the
//   window; its texels at a width × height level are [floor(a·n), ceil(b·n)), and flakes or tilted normals appear only
//   within a margin of them.
// - Tilt: no normal tilts beyond the largest tilt maximum of the knob.
// - Density: a nested region's level-0 mask mean is within half and 1.6 times its authored cover.
// - Resolved flakes: in a nested region, every connected flake (8-connected, fully covered texels, one region)
//   holds at least 2.3 texels² of mask, the least a 2-texel hexagon can hold (2.6); a 1-texel flake cannot.
// - Nesting: most flakes of a coarser nested level sit on a flake of the finer level: at least half of the component
//   centroids land on a finer-level flake texel (mask ≥ ½). Merged neighbours pull some centroids into gaps (about
//   70–80 % land on the board build); an independently drawn level would score near the flake cover (about 15 %).
// - BOX regions: every lower level inside the region is the plain 2×2 BOX chain of the level-0 bytes (mask,
//   normal X/Y, roughness, metalness and linear diffuse RGB), byte for byte.
// - Sheen: at levels that draw no flakes in a nested region, its fully covered texels' roughness and metalness are
//   the base surface moved toward ((r_f²)² + E[sin²θ])^¼ and the flake metalness by the authored cover (± 1 byte).
// - Flake contents (PIPE-68), on every texel whose mask is 255 inside exactly one region (nested regions on every
//   level, BOX regions at level 0): roughness and metalness within one byte of the region's flake values, diffuse the
//   flake colour, most flakes tilted, and the tangent (X, Y) one of the region's catalogue flakes near the texel, ± 1
//   byte. The catalogue (seeded xoshiro128**, draw order, mirror across u = ½) is restated below; it pins the tangent
//   frame's signs and the flakes' places, which no statistic can.
// - Pigment (PIPE-68): at level 0, fully covered texels without flakes carry a pigment within the active layers'
//   colours (per sRGB channel, ± 1 byte), moved toward the flake colour by the region's restated sheen share, and the
//   knob's base roughness and metalness moved the same way.
// - Accent (head-UV mask): content only inside its layer's bounds, resolved components, and at least three quarters
//   of the level-0 accent components away from the feathered edge with centroids within one window texel of a
//   level-0 flake texel (mask ≥ ½). verify-build.ts adds its stored rows and its placement at the plate's UVs.
import { clipUvRect, ensure, GLITTER_REGION_RULES, restatedFlakeCount, restatedOutline, type Node, type UvRect, type VerifierGlitter } from "./resource-checks";
import type { VerifierWindow } from "./uv-window";

export const GLITTER_CHECK_LIMITS = Object.freeze({ minComponentMass: 2.3, nestedShare: .5, accentOnFlakes: .75, coverLow: .5, coverHigh: 1.6,
  capMm: 1.2, dilateTexels: 2, mmPerU: GLITTER_REGION_RULES.mmPerU, mmPerV: GLITTER_REGION_RULES.mmPerV,
  /** Flake texels whose tangent must be a nearby catalogue flake's, and flake texels that must be tilted (σ ≥ 1°). */
  normalMatch: .99, tiltedShare: .5 });
const unitByte = (v: number) => Math.floor((v < 0 ? 0 : v > 1 ? 1 : v) * 255 + .5);
const decodeSrgb = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const encodeSrgb = (v: number) => (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v < 0 ? 0 : v, 1 / 2.4) - .055);
const unorm = (b: number) => b / 255 * 2 - 1;
const hexBytes = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

type Dims = { width: number; height: number };
type Rect = UvRect;
/** Level dimensions of a complete chain (both sides halve; a side at 1 stays 1). */
export const levelDims = (width: number, height: number): Dims[] =>
  Array.from({ length: Math.log2(Math.max(width, height)) + 1 }, (_, L) => ({ width: Math.max(1, width >>> L), height: Math.max(1, height >>> L) }));

/** Split a concatenated chain into levels. */
export function splitChain(data: Uint8Array, width: number, height: number, bytesPerTexel: number, levels: number, label: string): Uint8Array[] {
  const dims = levelDims(width, height);
  ensure(levels === dims.length, `${label} records ${levels} levels, not the ${dims.length} of a complete ${width}x${height} chain`);
  const out: Uint8Array[] = [];
  let offset = 0;
  for (const d of dims) { const n = d.width * d.height * bytesPerTexel; out.push(data.subarray(offset, offset + n)); offset += n; }
  ensure(offset === data.length, `${label} holds ${data.length} bytes, not a complete ${width}x${height} chain`);
  return out;
}

/** A region layer's outline bounds clipped to the window (restated), with the outline's margins. */
export function regionRect(recipe: Node, id: string, window: VerifierWindow): Rect & { padU: number; padV: number; width: number } {
  const layer = (recipe?.layers ?? []).find((l: Node) => l?.id === id);
  ensure(layer && Array.isArray(layer.points), `Glitter region layer ${id} is not in the recipe`);
  const outline = restatedOutline(layer, `Glitter region ${id}`), rect = clipUvRect(outline, window);
  ensure(rect, `Glitter region ${id} lies outside the plate window`);
  return { ...rect, padU: outline.padU, padV: outline.padV, width: outline.width };
}
/** Texel rectangle a UV rectangle touches at one level over the window: [floor(a·n), ceil(b·n)), clamped. */
export function texelRect(rect: Rect, window: VerifierWindow, dims: Dims, margin = 0) {
  const fx = (u: number) => (u - window.u0) / (window.u1 - window.u0) * dims.width, fy = (v: number) => (v - window.v0) / (window.v1 - window.v0) * dims.height;
  const c = (v: number, n: number) => Math.max(0, Math.min(n, v));
  return { x0: c(Math.floor(fx(rect.u0)) - margin, dims.width), x1: c(Math.ceil(fx(rect.u1)) + margin, dims.width),
    y0: c(Math.floor(fy(rect.v0)) - margin, dims.height), y1: c(Math.ceil(fy(rect.v1)) + margin, dims.height) };
}

/** 8-connected components of mask > 0: texel lists. */
export function components(mask: Uint8Array, dims: Dims): number[][] {
  const seen = new Uint8Array(mask.length), out: number[][] = [], { width: w, height: h } = dims;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const list: number[] = [], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const t = stack.pop()!, x = t % w, y = (t - x) / w;
      list.push(t);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    out.push(list);
  }
  return out;
}

/** E[sin²θ] of |N(0, σ)| truncated at the maximum and redrawn uniformly below it (degrees), restated. */
export function restatedTiltVariance(sigma: number, max: number): number {
  if (sigma <= 0) return 0;
  const n = 4000, h = max / n, s2 = (d: number) => Math.sin(d * Math.PI / 180) ** 2;
  let p = 0, e = 0, u = 0;
  for (let i = 0; i <= n; i++) {
    const d = i * h, w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * h / 3, g = 2 / (sigma * Math.sqrt(2 * Math.PI)) * Math.exp(-d * d / (2 * sigma * sigma));
    p += w * g; e += w * g * s2(d); u += w * s2(d);
  }
  return e + Math.max(0, 1 - p) * u / max;
}

/** The published seeded stream, restated: xoshiro128** seeded by four splitmix32 draws, returning r / 2³². */
export function restatedRandom(seed: number): () => number {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
  let a = next(), b = next(), c = next(), d = next();
  return () => {
    const five = Math.imul(b, 5), out = Math.imul((five << 7) | (five >>> 25), 9) >>> 0, t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = (d << 11) | (d >>> 21);
    return out / 4294967296;
  };
}
/** A region's catalogue as far as the content checks need it: centres (window mm), widths, aspects and tangents. */
export interface RestatedCatalogue { cx: Float64Array; cy: Float64Array; width: Float64Array; aspect: Float64Array; nx: Float64Array; ny: Float64Array }
/**
 * The published draw order per flake: tilt |N(0, σ)| (Box–Muller of 1 − r, r), redrawn uniformly below the maximum
 * when above it; azimuth; centre x, y over the rectangle; width size·e^{σ_w N}; rotation; aspect 1 + 0.4 r; key.
 */
export function restatedCatalogue(rect: Rect, window: VerifierWindow, f: VerifierGlitter["regions"][number]["flakes"]): RestatedCatalogue {
  const x0 = (rect.u0 - window.u0) * GLITTER_REGION_RULES.mmPerU, x1 = (rect.u1 - window.u0) * GLITTER_REGION_RULES.mmPerU;
  const y0 = (rect.v0 - window.v0) * GLITTER_REGION_RULES.mmPerV, y1 = (rect.v1 - window.v0) * GLITTER_REGION_RULES.mmPerV;
  const n = restatedFlakeCount(rect, window, f), random = restatedRandom(f.seed);
  ensure(n <= GLITTER_REGION_RULES.maxFlakes, `A glitter region would hold about ${n} flakes, more than ${GLITTER_REGION_RULES.maxFlakes}`);
  const gauss = () => { const u = 1 - random(), v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const out: RestatedCatalogue = { cx: new Float64Array(n), cy: new Float64Array(n), width: new Float64Array(n), aspect: new Float64Array(n),
    nx: new Float64Array(n), ny: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    let tilt = Math.abs(gauss() * f.tiltSigmaDeg);
    if (tilt > f.tiltMaxDeg) tilt = random() * f.tiltMaxDeg;
    const azimuth = random() * 2 * Math.PI, s = Math.sin(tilt * Math.PI / 180);
    out.cx[i] = x0 + random() * (x1 - x0); out.cy[i] = y0 + random() * (y1 - y0);
    out.width[i] = f.sizeMm * Math.exp(f.sizeSigma * gauss()); random(); out.aspect[i] = 1 + random() * .4;
    out.nx[i] = s * Math.cos(azimuth); out.ny[i] = s * Math.sin(azimuth); random();
  }
  return out;
}
/** The same flakes on the other lid: centres mirrored across u = ½ in UV, tangent X negated. */
export const restatedMirror = (c: RestatedCatalogue, window: VerifierWindow): RestatedCatalogue =>
  ({ ...c, cx: c.cx.map(x => (1 - 2 * window.u0) * GLITTER_REGION_RULES.mmPerU - x), nx: c.nx.map(x => -x) });

/** Catalogue flakes by grid cell (window mm), for "a flake near this texel". */
function flakeGrid(c: RestatedCatalogue, cell: number) {
  const cells = new Map<number, number[]>(), key = (x: number, y: number) => x * 100003 + y;
  for (let i = 0; i < c.cx.length; i++) {
    const k = key(Math.floor(c.cx[i] / cell), Math.floor(c.cy[i] / cell));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  return (x: number, y: number) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell), out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const list = cells.get(key(gx + dx, gy + dy)); if (list) out.push(...list); }
    return out;
  };
}

export interface GlitterChainReport {
  levels: { level: number; width: number; height: number; components: number; minComponentMass: number | null; nestedOnFiner: number | null }[];
  regionCover: { layer: string; mips: string; level0MaskMean: number }[];
  boxTexelsChecked: number; sheenTexelsChecked: number; maxTiltSine: number;
  /** Flake contents: fully covered flake texels checked, the least share whose tangent is a nearby catalogue flake's, and the least tilted share. */
  flakeTexelsChecked: number; minNormalMatch: number | null; minTiltedShare: number | null;
  /** Level-0 pigment texels (no flakes, fully covered) checked against the layers' colours and the base surface. */
  pigmentTexelsChecked: number;
}

/**
 * Check a glitter preset's supplied chains (baked bytes, which the supplied DDS must equal) under the restated
 * properties above. `chains` hold diffuse (RGBA), roughness, metalness, normal (XY) and flakes per level.
 */
export function checkGlitterChains(name: string, recipe: Node, glitter: VerifierGlitter, window: VerifierWindow, size: Dims,
  chains: Record<"diffuse" | "roughness" | "metalness" | "normal" | "flakes", Uint8Array[]>, expectedAlpha: Uint8Array[]): GlitterChainReport {
  const dims = levelDims(size.width, size.height), limits = GLITTER_CHECK_LIMITS;
  const regions = glitter.regions.map(region => ({ ...region, rect: regionRect(recipe, region.layer, window) }));
  // Coverage: the flat route's alpha chain, and flakes only where it covers.
  dims.forEach((d, L) => {
    const diffuse = chains.diffuse[L], flakes = chains.flakes[L], alpha = expectedAlpha[L];
    for (let t = 0; t < d.width * d.height; t++) {
      if (diffuse[4 * t + 3] !== alpha[t]) ensure(false, `Glitter diffuse alpha of ${name} level ${L} is not the pigment's coverage chain`);
      if (flakes[t] && !diffuse[4 * t + 3]) ensure(false, `Glitter flakes of ${name} level ${L} reach outside the pigment's coverage`);
    }
  });
  // Tilt: every normal within the largest tilt maximum (plus byte rounding).
  let maxTilt = 0;
  for (const region of regions) maxTilt = Math.max(maxTilt, region.flakes.tiltMaxDeg);
  const maxSine = Math.sin(maxTilt * Math.PI / 180) + .006;
  let worstSine = 0;
  for (const level of chains.normal) for (let t = 0; t < level.length; t += 2) worstSine = Math.max(worstSine, Math.hypot(unorm(level[t]), unorm(level[t + 1])));
  ensure(worstSine <= maxSine, `A glitter normal of ${name} tilts beyond the knob's maximum (sine ${worstSine.toFixed(4)} > ${maxSine.toFixed(4)})`);

  const regionIndex = (d: Dims, margin = 0) => {
    const index = new Int16Array(d.width * d.height).fill(-1), count = new Uint8Array(d.width * d.height);
    regions.forEach((region, r) => {
      const box = texelRect(region.rect, window, d, margin);
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { index[y * d.width + x] = r; count[y * d.width + x]++; }
    });
    return { index, count };
  };
  const insideOf = dims.map(d => regionIndex(d));
  // Outside the regions (plus a flake's reach and the dilation) the normal is flat and there are no flakes.
  dims.forEach((d, L) => {
    const tu = (window.u1 - window.u0) * limits.mmPerU / d.width, tv = (window.v1 - window.v0) * limits.mmPerV / d.height;
    const margin = Math.ceil(.75 * limits.capMm / Math.min(tu, tv)) + limits.dilateTexels + 1;
    const near = regionIndex(d, margin).index, normal = chains.normal[L], flakes = chains.flakes[L];
    for (let t = 0; t < d.width * d.height; t++) if (near[t] < 0 && (flakes[t] || normal[2 * t] !== 128 || normal[2 * t + 1] !== 128))
      ensure(false, `Glitter flakes or normals of ${name} level ${L} lie outside every region`);
  });

  // Density at level 0.
  const level0Mean = regions.map(region => {
    const box = texelRect(region.rect, window, dims[0]);
    let sum = 0, n = 0;
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
      const t = y * dims[0].width + x;
      if (chains.diffuse[0][4 * t + 3] === 255) { sum += chains.flakes[0][t] / 255; n++; }
    }
    return n ? sum / n : 0;
  });
  const regionCover = regions.map((region, r) => {
    const mean = level0Mean[r];
    ensure(region.mips === "box" || (mean >= limits.coverLow * region.flakes.cover && mean <= limits.coverHigh * region.flakes.cover),
      `Glitter region ${region.layer} of ${name} covers ${mean.toFixed(3)} at level 0, not about its authored ${region.flakes.cover}`);
    return { layer: region.layer, mips: region.mips, level0MaskMean: Math.round(mean * 1e4) / 1e4 };
  });

  // Resolved, nested flakes in nested regions: components wholly inside one nested region, fully covered.
  const levels: GlitterChainReport["levels"] = [];
  let previous: { dims: Dims; flakes: Uint8Array } | undefined;
  dims.forEach((d, L) => {
    const inside = insideOf[L], flakes = chains.flakes[L], alpha = chains.diffuse[L];
    const all = components(flakes, d);
    let minMass: number | null = null, onFiner = 0, counted = 0;
    for (const list of all) {
      const r = inside.index[list[0]];
      if (r < 0 || regions[r].mips !== "nested" || !list.every(t => inside.index[t] === r && inside.count[t] === 1 && alpha[4 * t + 3] === 255)) continue;
      let mass = 0, sx = 0, sy = 0;
      for (const t of list) { const m = flakes[t] / 255, x = t % d.width; mass += m; sx += m * (x + .5); sy += m * ((t - x) / d.width + .5); }
      minMass = minMass === null ? mass : Math.min(minMass, mass);
      if (previous) {
        const px = Math.min(previous.dims.width - 1, Math.floor(sx / mass / d.width * previous.dims.width));
        const py = Math.min(previous.dims.height - 1, Math.floor(sy / mass / d.height * previous.dims.height));
        counted++;
        if (previous.flakes[py * previous.dims.width + px] >= 128) onFiner++;
      }
    }
    ensure(minMass === null || minMass >= limits.minComponentMass,
      () => `A glitter flake of ${name} level ${L} holds ${minMass?.toFixed(2)} texels², less than a resolved (2-texel) flake`);
    const nestedOnFiner = counted ? onFiner / counted : null;
    ensure(nestedOnFiner === null || counted < 20 || nestedOnFiner >= limits.nestedShare,
      () => `Glitter flakes of ${name} level ${L} are not nested in level ${L - 1} (${(100 * (nestedOnFiner ?? 0)).toFixed(1)} % on a finer flake)`);
    levels.push({ level: L, width: d.width, height: d.height, components: all.length, minComponentMass: minMass === null ? null : Math.round(minMass * 100) / 100,
      nestedOnFiner: nestedOnFiner === null ? null : Math.round(nestedOnFiner * 1000) / 1000 });
    previous = { dims: d, flakes };
  });

  // BOX regions: the plain BOX chain of the level-0 bytes, byte for byte.
  let boxTexels = 0;
  const box = regions.filter(r => r.mips === "box");
  if (box.length) {
    const planes: [Uint8Array[], number, number, (b: number) => number, (v: number) => number][] = [
      [chains.flakes, 1, 0, b => b / 255, v => v], [chains.normal, 2, 0, unorm, v => v * .5 + .5], [chains.normal, 2, 1, unorm, v => v * .5 + .5],
      [chains.roughness, 1, 0, b => b / 255, v => v], [chains.metalness, 1, 0, b => b / 255, v => v],
      ...[0, 1, 2].map(k => [chains.diffuse, 4, k, (b: number) => decodeSrgb(b / 255), encodeSrgb] as [Uint8Array[], number, number, (b: number) => number, (v: number) => number]),
    ];
    for (const [chain, stride, offset, decode, encode] of planes) {
      let level = Float64Array.from({ length: dims[0].width * dims[0].height }, (_, t) => decode(chain[0][t * stride + offset]));
      for (let L = 1; L < dims.length; L++) {
        const { width: pw, height: ph } = dims[L - 1], d = dims[L], next = new Float64Array(d.width * d.height);
        if (pw > 1 && ph > 1) {
          for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
            const a = 2 * y * pw + 2 * x;
            next[y * d.width + x] = (((level[a] + level[a + 1]) + level[a + pw]) + level[a + pw + 1]) / 4;
          }
        } else for (let t = 0; t < next.length; t++) next[t] = (level[2 * t] + level[2 * t + 1]) / 2;
        level = next;
        for (const region of box) {
          const r = texelRect(region.rect, window, d);
          for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
            const t = y * d.width + x;
            if (chain[L][t * stride + offset] !== unitByte(encode(level[t])))
              ensure(false, `Glitter BOX region ${region.layer} of ${name} level ${L} is not the BOX chain of level 0`);
            boxTexels++;
          }
        }
      }
    }
  }

  // Sheen at levels without flakes in a nested region.
  let sheenTexels = 0;
  const sheenOf = (f: VerifierGlitter["regions"][number]["flakes"]) => ((f.roughness ** 2) ** 2 + restatedTiltVariance(f.tiltSigmaDeg, f.tiltMaxDeg)) ** .25;
  const baseR = unitByte(glitter.base.roughness) / 255, baseM = unitByte(glitter.base.metalness) / 255;
  dims.forEach((d, L) => {
    const inside = insideOf[L];
    regions.forEach((region, r) => {
      if (region.mips !== "nested") return;
      const rect = texelRect(region.rect, window, d);
      let any = false;
      for (let y = rect.y0; y < rect.y1 && !any; y++) for (let x = rect.x0; x < rect.x1; x++) if (chains.flakes[L][y * d.width + x]) { any = true; break; }
      if (any) return;
      const f = region.flakes, c = f.cover, sheen = sheenOf(f);
      const wantR = unitByte(baseR * (1 - c) + sheen * c), wantM = unitByte(baseM * (1 - c) + f.metalness * c);
      for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
        const t = y * d.width + x;
        if (inside.count[t] !== 1 || inside.index[t] !== r || chains.diffuse[L][4 * t + 3] !== 255) continue;
        if (Math.abs(chains.roughness[L][t] - wantR) > 1 || Math.abs(chains.metalness[L][t] - wantM) > 1)
          ensure(false, `Glitter sheen of ${region.layer} in ${name} level ${L} is ${chains.roughness[L][t]}/${chains.metalness[L][t]}, expected about ${wantR}/${wantM}`);
        sheenTexels++;
      }
    });
  });

  // Flake contents: fully covered flake texels inside one region carry that region's flake material and a catalogue tangent.
  const catalogues: RestatedCatalogue[] = [];
  regions.forEach((region, r) => {
    if (region.mirrorOf === undefined) catalogues[r] = restatedCatalogue(region.rect, window, region.flakes);
  });
  regions.forEach((region, r) => {
    if (region.mirrorOf !== undefined) catalogues[r] = restatedMirror(catalogues[regions.findIndex(other => other.layer === region.mirrorOf)], window);
  });
  let flakeTexels = 0, minNormalMatch: number | null = null, minTiltedShare: number | null = null;
  const layerColours = (recipe?.layers ?? []).filter((l: Node) => l?.enabled && l.opacity > 0).map((l: Node) => hexBytes(String(l.color)));
  dims.forEach((d, L) => {
    const tu = (window.u1 - window.u0) * limits.mmPerU / d.width, tv = (window.v1 - window.v0) * limits.mmPerV / d.height;
    const reach = .75 * limits.capMm + Math.hypot(tu, tv), inside = insideOf[L];
    const { flakes, normal, roughness, metalness, diffuse } = { flakes: chains.flakes[L], normal: chains.normal[L], roughness: chains.roughness[L],
      metalness: chains.metalness[L], diffuse: chains.diffuse[L] };
    regions.forEach((region, r) => {
      if (region.mips === "box" && L > 0) return;
      const f = region.flakes, wantR = unitByte(f.roughness), wantM = unitByte(f.metalness), colour = hexBytes(f.color);
      // Diffuse at a fully covered flake: the flake colour, mixed with at most 0.5/255 of the pigment underneath.
      const e = 1 - 254.5 / 255, fc = colour.map(b => decodeSrgb(b / 255));
      const colourRange = [0, 1, 2].map(k => {
        const options = [fc[k], ...layerColours.map((p: number[]) => fc[k] * (1 - e) + decodeSrgb(p[k] / 255) * e), fc[k] * (1 - e), fc[k] * (1 - e) + e]
          .map(v => unitByte(encodeSrgb(v)));
        return [Math.min(...options) - 1, Math.max(...options) + 1];
      });
      const near = flakeGrid(catalogues[r], reach), c = catalogues[r], rect = texelRect(region.rect, window, d);
      let checked = 0, matched = 0, tilted = 0;
      for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
        const t = y * d.width + x;
        if (flakes[t] !== 255 || inside.count[t] !== 1 || inside.index[t] !== r || diffuse[4 * t + 3] !== 255) continue;
        checked++;
        if (Math.abs(roughness[t] - wantR) > 1 || Math.abs(metalness[t] - wantM) > 1)
          ensure(false, `Glitter flakes of ${region.layer} in ${name} level ${L} are ${roughness[t]}/${metalness[t]}, not their ${wantR}/${wantM}`);
        for (let k = 0; k < 3; k++) if (diffuse[4 * t + k] < colourRange[k][0] || diffuse[4 * t + k] > colourRange[k][1])
          ensure(false, `Glitter flakes of ${region.layer} in ${name} level ${L} are not their colour ${f.color}`);
        const X = normal[2 * t], Y = normal[2 * t + 1];
        if (X !== 128 || Y !== 128) tilted++;
        const px = (x + .5) * tu, py = (y + .5) * tv;
        for (const i of near(px, py)) {
          if (Math.hypot(c.cx[i] - px, c.cy[i] - py) > reach) continue;
          if (Math.abs(X - unitByte(c.nx[i] * .5 + .5)) <= 1 && Math.abs(Y - unitByte(c.ny[i] * .5 + .5)) <= 1) { matched++; break; }
        }
      }
      if (!checked) return;
      flakeTexels += checked;
      const match = matched / checked, tiltShare = tilted / checked;
      ensure(match >= limits.normalMatch, () => `Glitter flake normals of ${region.layer} in ${name} level ${L} are not their flakes' tilts ` +
        `(${(100 * match).toFixed(1)} % match a nearby flake of the region's catalogue)`);
      minNormalMatch = minNormalMatch === null ? match : Math.min(minNormalMatch, match);
      if (f.tiltSigmaDeg >= 1) {
        ensure(tiltShare >= limits.tiltedShare, () => `Glitter flakes of ${region.layer} in ${name} level ${L} are flat (${(100 * tiltShare).toFixed(1)} % tilted)`);
        minTiltedShare = minTiltedShare === null ? tiltShare : Math.min(minTiltedShare, tiltShare);
      }
    });
  });

  // Level-0 pigment outside flakes: the layers' colours and the base surface, moved by the region's restated sheen share.
  let pigmentTexels = 0;
  {
    const d = dims[0], inside = insideOf[0];
    const lo = [0, 1, 2].map(k => Math.min(...layerColours.map((p: number[]) => p[k]))), hi = [0, 1, 2].map(k => Math.max(...layerColours.map((p: number[]) => p[k])));
    ensure(layerColours.length > 0, `Glitter preset ${name} has no active pigment layer`);
    // share = (cover − shown) / (1 − shown), shown the region's level-0 mask mean over its whole rectangle (± 1/510 from bytes).
    const shares = regions.map(region => {
      const rect = texelRect(region.rect, window, d);
      let sum = 0, n = 0;
      for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) { sum += chains.flakes[0][y * d.width + x] / 255; n++; }
      const shown = n ? sum / n : 0, share = Math.max(0, region.flakes.cover - shown) / Math.max(1e-6, 1 - shown);
      return [Math.max(0, share - .003), Math.min(1, share + .003)];
    });
    const ranges = [...regions.map((region, r) => ({ f: region.flakes, s: shares[r] })), { f: null, s: [0, 0] }].map(({ f, s }) => {
      const fc = f ? hexBytes(f.color).map(b => decodeSrgb(b / 255)) : [0, 0, 0], sheen = f ? sheenOf(f) : 0, fm = f ? f.metalness : 0;
      const span = (values: number[]) => [Math.min(...values) - 1, Math.max(...values) + 1];
      return {
        colour: [0, 1, 2].map(k => span(s.flatMap(share => [lo[k], hi[k]].map(b => unitByte(encodeSrgb(decodeSrgb(b / 255) * (1 - share) + fc[k] * share)))))),
        rough: span(s.map(share => unitByte(baseR * (1 - share) + sheen * share))), metal: span(s.map(share => unitByte(baseM * (1 - share) + fm * share))),
      };
    });
    const outside = ranges.length - 1;
    for (let t = 0; t < d.width * d.height; t++) {
      if (chains.flakes[0][t] || chains.diffuse[0][4 * t + 3] !== 255 || inside.count[t] > 1) continue;
      const range = ranges[inside.count[t] ? inside.index[t] : outside];
      let ok = chains.roughness[0][t] >= range.rough[0] && chains.roughness[0][t] <= range.rough[1] &&
        chains.metalness[0][t] >= range.metal[0] && chains.metalness[0][t] <= range.metal[1];
      for (let k = 0; k < 3 && ok; k++) ok = chains.diffuse[0][4 * t + k] >= range.colour[k][0] && chains.diffuse[0][4 * t + k] <= range.colour[k][1];
      if (!ok) ensure(false, `Glitter pigment of ${name} at level 0 is not its layers' colour and base surface ` +
        `(${Array.from(chains.diffuse[0].subarray(4 * t, 4 * t + 3)).join(", ")}; ${chains.roughness[0][t]}/${chains.metalness[0][t]})`);
      pigmentTexels++;
    }
  }
  return { levels, regionCover, boxTexelsChecked: boxTexels, sheenTexelsChecked: sheenTexels, maxTiltSine: Math.round(worstSine * 1e4) / 1e4,
    flakeTexelsChecked: flakeTexels, minNormalMatch: minNormalMatch === null ? null : Math.round(minNormalMatch * 1e4) / 1e4,
    minTiltedShare: minTiltedShare === null ? null : Math.round(minTiltedShare * 1e4) / 1e4, pigmentTexelsChecked: pigmentTexels };
}

export interface AccentReport { levels: { level: number; components: number; minComponentMass: number | null }[]; onFlakes: number; components: number;
  /** Level-0 components the on-flakes share is taken over: those away from the feathered edge (all, when none are). */
  judged: number; flakeComponents: number }

/**
 * The accent's head-UV mask chain (size² per level): content only inside its layer's bounds (plus a flake's reach),
 * resolved components away from the feathered edge, and most level-0 components on a level-0 window flake.
 */
export function checkAccentChain(name: string, recipe: Node, glitter: VerifierGlitter, window: VerifierWindow, accent: Uint8Array[],
  size: number, windowFlakes: Uint8Array, windowDims: Dims): AccentReport {
  const limits = GLITTER_CHECK_LIMITS, layer = glitter.accent!.layer, rect = regionRect(recipe, layer, window);
  // Full coverage: the outline's margins and a whole softness width inside it.
  const insetU = rect.padU + rect.width, insetV = rect.padV + rect.width;
  const levels: AccentReport["levels"] = [];
  let level0: number[][] = [], level0Core: number[][] = [];
  accent.forEach((mask, L) => {
    const n = Math.max(1, size >>> L), head = { u0: 0, u1: 1, v0: 0, v1: 1 }, d = { width: n, height: n };
    const reach = Math.ceil(.75 * limits.capMm / Math.min(limits.mmPerU / n, limits.mmPerV / n)) + 1;
    const near = texelRect(rect, head, d, reach), core = texelRect({ u0: rect.u0 + insetU, u1: rect.u1 - insetU, v0: rect.v0 + insetV, v1: rect.v1 - insetV }, head, d, -2);
    for (let t = 0; t < mask.length; t++) {
      if (!mask[t]) continue;
      const x = t % n, y = (t - x) / n;
      if (!(x >= near.x0 && x < near.x1 && y >= near.y0 && y < near.y1)) ensure(false, `Glitter accent of ${name} level ${L} lies outside its layer`);
    }
    const all = components(mask, d), inCore: number[][] = [];
    let minMass: number | null = null;
    for (const list of all) {
      if (!list.every(t => { const x = t % n, y = (t - x) / n; return x >= core.x0 && x < core.x1 && y >= core.y0 && y < core.y1; })) continue;
      inCore.push(list);
      const mass = list.reduce((sum, t) => sum + mask[t] / 255, 0);
      minMass = minMass === null ? mass : Math.min(minMass, mass);
    }
    ensure(minMass === null || minMass >= limits.minComponentMass, () => `A glitter accent flake of ${name} level ${L} holds ${minMass?.toFixed(2)} texels², less than a resolved flake`);
    levels.push({ level: L, components: all.length, minComponentMass: minMass === null ? null : Math.round(minMass * 100) / 100 });
    if (L === 0) { level0 = all; level0Core = inCore; }
  });
  // Level-0 accent components away from the feathered edge (where both masks fade) sit on window flakes:
  // centroid → authored UV → the window's level-0 flake mask (3 × 3 search).
  const judged = level0Core.length ? level0Core : level0;
  let on = 0;
  for (const list of judged) {
    let mass = 0, sx = 0, sy = 0;
    for (const t of list) { const m = accent[0][t] / 255, x = t % size; mass += m; sx += m * (x + .5); sy += m * ((t - x) / size + .5); }
    const u = sx / mass / size, v = sy / mass / size;
    const wx = Math.floor((u - window.u0) / (window.u1 - window.u0) * windowDims.width), wy = Math.floor((v - window.v0) / (window.v1 - window.v0) * windowDims.height);
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = wx + dx, y = wy + dy;
      if (x >= 0 && y >= 0 && x < windowDims.width && y < windowDims.height && windowFlakes[y * windowDims.width + x] >= 128) { hit = true; break; }
    }
    if (hit) on++;
  }
  const onFlakes = judged.length ? on / judged.length : 0;
  ensure(level0.length > 0, `Glitter accent of ${name} draws nothing at level 0`);
  ensure(onFlakes >= limits.accentOnFlakes, `Glitter accent of ${name} is not drawn on its flakes (${(100 * onFlakes).toFixed(1)} % of components)`);
  const regionBox = texelRect(rect, window, windowDims);
  const flakeMask = new Uint8Array(windowFlakes.length);
  for (let y = regionBox.y0; y < regionBox.y1; y++) for (let x = regionBox.x0; x < regionBox.x1; x++) flakeMask[y * windowDims.width + x] = windowFlakes[y * windowDims.width + x];
  const flakeComponents = components(flakeMask, windowDims).length;
  return { levels, onFlakes: Math.round(onFlakes * 1000) / 1000, components: level0.length, judged: judged.length, flakeComponents };
}
