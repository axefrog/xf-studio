// Independent checks of the diagnostic Glitter route's supplied chains. Pure: no IO.
//
// Nothing here imports the builder (src/glitter-route.ts). The route's nested levels are *drawn* from a flake
// catalogue, so they cannot be re-derived from level 0 the way the flat chains are; instead this module restates
// the published properties every level must have, from the preset's own recipe and glitter knob:
//
// - Coverage: the diffuse alpha chain is exactly the flat route's coverage-space chain of level 0's alpha
//   (unitByte(√mean((a/255)²))), so the decal covers exactly what the pigment layers cover; flakes appear only
//   where that coverage is non-zero.
// - Regions: a region's texels at a width × height level over the window are [floor(a·n), ceil(b·n)) of its
//   layer's control-point bounds (restated), and flakes or tilted normals appear only within a margin of them.
// - Resolved flakes: in a nested region, every connected flake (8-connected, fully covered texels, one region)
//   holds at least 2.3 texels² of mask, the least a 2-texel hexagon can hold (2.6); a 1-texel flake cannot.
// - Nesting: most flakes of a coarser nested level sit on a flake of the finer level: at least half of the component
//   centroids land on a finer-level flake texel (mask ≥ ½). Merged neighbours pull some centroids into gaps (about
//   70–80 % land on the board build); an independently drawn level would score near the flake cover (about 15 %).
// - Tilt: no normal tilts beyond the largest tilt maximum of the knob.
// - Density: a nested region's level-0 mask mean is within half and 1.6 times its authored cover.
// - BOX regions: every lower level inside the region is the plain 2×2 BOX chain of the level-0 bytes (mask,
//   normal X/Y, roughness, metalness and linear diffuse RGB), byte for byte.
// - Sheen: at levels that draw no flakes in a nested region, its fully covered texels' roughness and metalness are
//   the base surface moved toward ((r_f²)² + E[sin²θ])^¼ and the flake metalness by the authored cover (± 1 byte).
// - Accent (head-UV mask): content only inside its layer's bounds, resolved components, and at least three quarters
//   of the level-0 accent components' centroids within one window texel of a level-0 flake texel (mask ≥ ½).
import { ensure, type Node, type VerifierGlitter } from "./resource-checks";
import type { VerifierWindow } from "./uv-window";

export const GLITTER_CHECK_LIMITS = Object.freeze({ minComponentMass: 2.3, nestedShare: .5, accentOnFlakes: .75, coverLow: .5, coverHigh: 1.6,
  capMm: 1.2, dilateTexels: 2, mmPerU: 569, mmPerV: 405 });
const unitByte = (v: number) => Math.floor((v < 0 ? 0 : v > 1 ? 1 : v) * 255 + .5);
const decodeSrgb = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const encodeSrgb = (v: number) => (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v < 0 ? 0 : v, 1 / 2.4) - .055);
const unorm = (b: number) => b / 255 * 2 - 1;

type Dims = { width: number; height: number };
type Rect = { u0: number; v0: number; u1: number; v1: number };
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

/** A region layer's control-point bounds in authored UV (restated). */
export function layerBounds(recipe: Node, id: string): Rect & { feather: number } {
  const layer = (recipe?.layers ?? []).find((l: Node) => l?.id === id);
  ensure(layer && Array.isArray(layer.points), `Glitter region layer ${id} is not in the recipe`);
  const us = layer.points.map((p: Node) => p.u), vs = layer.points.map((p: Node) => p.v);
  return { u0: Math.min(...us), v0: Math.min(...vs), u1: Math.max(...us), v1: Math.max(...vs), feather: Number(layer.feather) || 0 };
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

export interface GlitterChainReport {
  levels: { level: number; width: number; height: number; components: number; minComponentMass: number | null; nestedOnFiner: number | null }[];
  regionCover: { layer: string; mips: string; level0MaskMean: number }[];
  boxTexelsChecked: number; sheenTexelsChecked: number; maxTiltSine: number;
}

/**
 * Check a glitter preset's supplied chains (baked bytes, which the supplied DDS must equal) under the restated
 * properties above. `chains` hold diffuse (RGBA), roughness, metalness, normal (XY) and flakes per level.
 */
export function checkGlitterChains(name: string, recipe: Node, glitter: VerifierGlitter, window: VerifierWindow, size: Dims,
  chains: Record<"diffuse" | "roughness" | "metalness" | "normal" | "flakes", Uint8Array[]>, expectedAlpha: Uint8Array[]): GlitterChainReport {
  const dims = levelDims(size.width, size.height), limits = GLITTER_CHECK_LIMITS;
  const regions = glitter.regions.map(region => ({ ...region, rect: layerBounds(recipe, region.layer) }));
  // Coverage: the flat route's alpha chain, and flakes only where it covers.
  dims.forEach((d, L) => {
    const diffuse = chains.diffuse[L], flakes = chains.flakes[L], alpha = expectedAlpha[L];
    for (let t = 0; t < d.width * d.height; t++) {
      ensure(diffuse[4 * t + 3] === alpha[t], `Glitter diffuse alpha of ${name} level ${L} is not the pigment's coverage chain`);
      ensure(!flakes[t] || diffuse[4 * t + 3], `Glitter flakes of ${name} level ${L} reach outside the pigment's coverage`);
    }
  });
  // Tilt: every normal within the largest tilt maximum (plus byte rounding).
  const maxSine = Math.sin(Math.max(...regions.map(r => r.flakes.tiltMaxDeg)) * Math.PI / 180) + .006;
  let worstSine = 0;
  for (const level of chains.normal) for (let t = 0; t < level.length; t += 2) worstSine = Math.max(worstSine, Math.hypot(unorm(level[t]), unorm(level[t + 1])));
  ensure(worstSine <= maxSine, `A glitter normal of ${name} tilts beyond the knob's maximum (sine ${worstSine.toFixed(4)} > ${maxSine.toFixed(4)})`);

  const levels: GlitterChainReport["levels"] = [];
  const regionIndex = (d: Dims, margin = 0) => {
    const index = new Int16Array(d.width * d.height).fill(-1), count = new Uint8Array(d.width * d.height);
    regions.forEach((region, r) => {
      const box = texelRect(region.rect, window, d, margin);
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { index[y * d.width + x] = r; count[y * d.width + x]++; }
    });
    return { index, count };
  };
  let previous: { dims: Dims; flakes: Uint8Array } | undefined;
  dims.forEach((d, L) => {
    const tu = (window.u1 - window.u0) * limits.mmPerU / d.width, tv = (window.v1 - window.v0) * limits.mmPerV / d.height;
    // Outside the regions (plus a flake's reach and the dilation) the normal is flat and there are no flakes.
    const margin = Math.ceil(.75 * limits.capMm / Math.min(tu, tv)) + limits.dilateTexels + 1;
    const near = regionIndex(d, margin).index, inside = regionIndex(d);
    const normal = chains.normal[L], flakes = chains.flakes[L], alpha = chains.diffuse[L];
    for (let t = 0; t < d.width * d.height; t++) if (near[t] < 0)
      ensure(!flakes[t] && normal[2 * t] === 128 && normal[2 * t + 1] === 128, `Glitter flakes or normals of ${name} level ${L} lie outside every region`);
    // Resolved, nested flakes in nested regions: components wholly inside one nested region, fully covered.
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
      `A glitter flake of ${name} level ${L} holds ${minMass?.toFixed(2)} texels², less than a resolved (2-texel) flake`);
    const nestedOnFiner = counted ? onFiner / counted : null;
    ensure(nestedOnFiner === null || counted < 20 || nestedOnFiner >= limits.nestedShare,
      `Glitter flakes of ${name} level ${L} are not nested in level ${L - 1} (${(100 * (nestedOnFiner ?? 0)).toFixed(1)} % on a finer flake)`);
    levels.push({ level: L, width: d.width, height: d.height, components: all.length, minComponentMass: minMass === null ? null : Math.round(minMass * 100) / 100,
      nestedOnFiner: nestedOnFiner === null ? null : Math.round(nestedOnFiner * 1000) / 1000 });
    previous = { dims: d, flakes };
  });

  // Density at level 0.
  const regionCover = regions.map(region => {
    const box = texelRect(region.rect, window, dims[0]);
    let sum = 0, n = 0;
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
      const t = y * dims[0].width + x;
      if (chains.diffuse[0][4 * t + 3] === 255) { sum += chains.flakes[0][t] / 255; n++; }
    }
    const mean = n ? sum / n : 0;
    ensure(region.mips === "box" || (mean >= limits.coverLow * region.flakes.cover && mean <= limits.coverHigh * region.flakes.cover),
      `Glitter region ${region.layer} of ${name} covers ${mean.toFixed(3)} at level 0, not about its authored ${region.flakes.cover}`);
    return { layer: region.layer, mips: region.mips, level0MaskMean: Math.round(mean * 1e4) / 1e4 };
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
            ensure(chain[L][t * stride + offset] === unitByte(encode(level[t])), `Glitter BOX region ${region.layer} of ${name} level ${L} is not the BOX chain of level 0`);
            boxTexels++;
          }
        }
      }
    }
  }

  // Sheen at levels without flakes in a nested region.
  let sheenTexels = 0;
  dims.forEach((d, L) => {
    const inside = regionIndex(d);
    regions.forEach((region, r) => {
      if (region.mips !== "nested") return;
      const rect = texelRect(region.rect, window, d);
      let any = false;
      for (let y = rect.y0; y < rect.y1 && !any; y++) for (let x = rect.x0; x < rect.x1; x++) if (chains.flakes[L][y * d.width + x]) { any = true; break; }
      if (any) return;
      const f = region.flakes, c = f.cover, sheen = ((f.roughness ** 2) ** 2 + restatedTiltVariance(f.tiltSigmaDeg, f.tiltMaxDeg)) ** .25;
      const baseR = unitByte(glitter.base.roughness) / 255, baseM = unitByte(glitter.base.metalness) / 255;
      const wantR = unitByte(baseR * (1 - c) + sheen * c), wantM = unitByte(baseM * (1 - c) + f.metalness * c);
      for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) {
        const t = y * d.width + x;
        if (inside.count[t] !== 1 || inside.index[t] !== r || chains.diffuse[L][4 * t + 3] !== 255) continue;
        ensure(Math.abs(chains.roughness[L][t] - wantR) <= 1 && Math.abs(chains.metalness[L][t] - wantM) <= 1,
          `Glitter sheen of ${region.layer} in ${name} level ${L} is ${chains.roughness[L][t]}/${chains.metalness[L][t]}, expected about ${wantR}/${wantM}`);
        sheenTexels++;
      }
    });
  });
  return { levels, regionCover, boxTexelsChecked: boxTexels, sheenTexelsChecked: sheenTexels, maxTiltSine: Math.round(worstSine * 1e4) / 1e4 };
}

export interface AccentReport { levels: { level: number; components: number; minComponentMass: number | null }[]; onFlakes: number; components: number; flakeComponents: number }

/**
 * The accent's head-UV mask chain (size² per level): content only inside its layer's bounds (plus a flake's reach),
 * resolved components away from the feathered edge, and most level-0 components on a level-0 window flake.
 */
export function checkAccentChain(name: string, recipe: Node, glitter: VerifierGlitter, window: VerifierWindow, accent: Uint8Array[],
  size: number, windowFlakes: Uint8Array, windowDims: Dims): AccentReport {
  const limits = GLITTER_CHECK_LIMITS, layer = glitter.accent!.layer, rect = layerBounds(recipe, layer);
  const levels: AccentReport["levels"] = [];
  let level0: number[][] = [];
  accent.forEach((mask, L) => {
    const n = Math.max(1, size >>> L), head = { u0: 0, u1: 1, v0: 0, v1: 1 }, d = { width: n, height: n };
    const reach = Math.ceil(.75 * limits.capMm / Math.min(limits.mmPerU / n, limits.mmPerV / n)) + 1;
    const near = texelRect(rect, head, d, reach), core = texelRect({ u0: rect.u0 + rect.feather, u1: rect.u1 - rect.feather, v0: rect.v0 + rect.feather, v1: rect.v1 - rect.feather }, head, d, -2);
    for (let t = 0; t < mask.length; t++) {
      const x = t % n, y = (t - x) / n;
      ensure(!mask[t] || (x >= near.x0 && x < near.x1 && y >= near.y0 && y < near.y1), `Glitter accent of ${name} level ${L} lies outside its layer`);
    }
    const all = components(mask, d);
    let minMass: number | null = null;
    for (const list of all) {
      if (!list.every(t => { const x = t % n, y = (t - x) / n; return x >= core.x0 && x < core.x1 && y >= core.y0 && y < core.y1; })) continue;
      const mass = list.reduce((sum, t) => sum + mask[t] / 255, 0);
      minMass = minMass === null ? mass : Math.min(minMass, mass);
    }
    ensure(minMass === null || minMass >= limits.minComponentMass, `A glitter accent flake of ${name} level ${L} holds ${minMass?.toFixed(2)} texels², less than a resolved flake`);
    levels.push({ level: L, components: all.length, minComponentMass: minMass === null ? null : Math.round(minMass * 100) / 100 });
    if (L === 0) level0 = all;
  });
  // Level-0 accent components sit on window flakes: centroid → authored UV → the window's level-0 flake mask (3 × 3 search).
  let on = 0;
  for (const list of level0) {
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
  const onFlakes = level0.length ? on / level0.length : 0;
  ensure(level0.length > 0, `Glitter accent of ${name} draws nothing at level 0`);
  ensure(onFlakes >= limits.accentOnFlakes, `Glitter accent of ${name} is not drawn on its flakes (${(100 * onFlakes).toFixed(1)} % of components)`);
  const regionRect = texelRect(rect, window, windowDims);
  const flakeMask = new Uint8Array(windowFlakes.length);
  for (let y = regionRect.y0; y < regionRect.y1; y++) for (let x = regionRect.x0; x < regionRect.x1; x++) flakeMask[y * windowDims.width + x] = windowFlakes[y * windowDims.width + x];
  const flakeComponents = components(flakeMask, windowDims).length;
  return { levels, onFlakes: Math.round(onFlakes * 1000) / 1000, components: level0.length, flakeComponents };
}
