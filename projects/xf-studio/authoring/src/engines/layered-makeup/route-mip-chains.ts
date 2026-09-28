// Complete mip chains for the faceted and Fresnel decal routes. Pure: no IO.
//
// The published specification (restated independently in mod-verifier/texture-checks.ts):
//
// Faceted (mesh_decal, NormalsBlendingMode 1)
// - diffuse, metalness: exactly the flat coverage-space chain (flat-mip-chain.ts).
// - normal: level 0 is the compiler's X/Y bytes. Lower levels are the plain 2x2 BOX mean of the
//   UNORM-decoded X and Y (x = byte/255*2-1), re-encoded as floor(clip01(x*.5+.5)*255+.5).
//   Shorter averaged vectors reconstruct a larger Z in the shader, so its mode-1 alpha,
//   saturate(50 - 50z), fades unresolved facets out and the skin normal returns.
// - roughness: level 0 is the compiler's bytes. Lower levels widen the flat chain's
//   coverage-weighted mean roughness r by the variance v of the facet vectors lost to averaging:
//   v = max(0, E[x^2+y^2] - (E[x]^2 + E[y]^2)) from plain BOX means of base-level moments, and
//   byte = floor(clip01(((r*r)*(r*r) + v) ** 0.25)*255+.5) where coverage > 0, else 0.
//   GGX alpha = r^2, so alpha'^2 = alpha^2 + v: the Beckmann-style slope variance of unresolved
//   facets becomes a broader highlight instead of vanishing (a Toksvig/LEAN-style approximation).
// Fresnel (mesh_decal_gradientmap_recolor_blendable)
// - mask: linear coverage, so each lower level is the plain BOX mean of byte/255, re-encoded.
// - gradient: uniform; every level repeats the base texel.
//
// Every 2x2 mean uses the flat chain's float order ((a + b) + c) + d, divided by 4. Non-square maps
// (the plate-local window) follow the flat chain's rule: once one side reaches 1, each further level is
// the two-texel mean (a + b) / 2 along the other side.
import { destinationContributions, reduceContributions, reducePlanes, flatMipChain, mipDimensions, mipLevelCount, CONTRIBUTION_CHANNELS } from "./flat-mip-chain";

const clip01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v: number) => Math.floor(clip01(v) * 255 + .5);
const unorm = (b: number) => b / 255 * 2 - 1;


export interface FacetedMipChain {
  readonly diffuse: readonly Uint8Array[];
  readonly roughness: readonly Uint8Array[];
  readonly metalness: readonly Uint8Array[];
  /** Two bytes (X, Y) per texel. */
  readonly normal: readonly Uint8Array[];
}

export function facetedMipChain(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, normal: Uint8Array,
  width: number, height = width): FacetedMipChain {
  const dims = mipDimensions(width, height);
  const texels = width * height;
  if (normal.length !== texels * 2) throw new RangeError("Normal map byte length does not match size");
  const flat = flatMipChain(diffuse, roughness, metalness, width, height);
  // Moments: x, y, x^2 + y^2 per base texel.
  let moments: Float64Array<ArrayBufferLike> = new Float64Array(texels * 3);
  for (let i = 0; i < texels; i++) {
    const x = unorm(normal[i * 2]), y = unorm(normal[i * 2 + 1]);
    moments[i * 3] = x; moments[i * 3 + 1] = y; moments[i * 3 + 2] = x * x + y * y;
  }
  let contributions = destinationContributions(diffuse, roughness, metalness, width, height);
  const rough: Uint8Array[] = [roughness.slice()], normals: Uint8Array[] = [normal.slice()];
  for (let level = 1; level < dims.length; level++) {
    const { width: w, height: h } = dims[level - 1];
    contributions = reduceContributions(contributions, w, h);
    moments = reducePlanes(moments, w, h, 3);
    const n = dims[level].width * dims[level].height, r = new Uint8Array(n), nb = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) {
      const mx = moments[i * 3], my = moments[i * 3 + 1], variance = Math.max(0, moments[i * 3 + 2] - (mx * mx + my * my));
      nb[i * 2] = toByte(mx * .5 + .5); nb[i * 2 + 1] = toByte(my * .5 + .5);
      const o = i * CONTRIBUTION_CHANNELS, coverage = contributions[o + 5];
      if (coverage > 0) {
        const mean = clip01(contributions[o + 3] / coverage);
        r[i] = toByte(Math.pow((mean * mean) * (mean * mean) + variance, .25));
      }
    }
    rough.push(r); normals.push(nb);
  }
  return { diffuse: flat.diffuse, roughness: rough, metalness: flat.metalness, normal: normals };
}

/** Linear coverage mask chain. */
export function maskMipChain(mask: Uint8Array, width: number, height = width): Uint8Array[] {
  const dims = mipDimensions(width, height);
  if (mask.length !== width * height) throw new RangeError("Mask byte length does not match size");
  let level: Float64Array<ArrayBufferLike> = Float64Array.from(mask, b => b / 255);
  const chain: Uint8Array[] = [mask.slice()];
  for (let i = 1; i < dims.length; i++) {
    level = reducePlanes(level, dims[i - 1].width, dims[i - 1].height, 1);
    chain.push(Uint8Array.from(level, toByte));
  }
  return chain;
}

/** Uniform RGBA texture chain: every level repeats texel 0. */
export function uniformMipChain(rgba: Uint8Array, size: number): Uint8Array[] {
  mipLevelCount(size);
  if (rgba.length !== size * size * 4) throw new RangeError("Uniform map byte length does not match size");
  const texel = rgba.subarray(0, 4);
  for (let i = 4; i < rgba.length; i += 4) if (rgba[i] !== texel[0] || rgba[i + 1] !== texel[1] || rgba[i + 2] !== texel[2] || rgba[i + 3] !== texel[3])
    throw new RangeError("Gradient map is not uniform");
  const chain: Uint8Array[] = [];
  for (let side = size; side >= 1; side >>= 1) {
    const level = new Uint8Array(side * side * 4);
    for (let i = 0; i < level.length; i += 4) level.set(texel, i);
    chain.push(level);
  }
  return chain;
}

/** Expand X/Y normal bytes to the RGBA8 UNORM rows WolvenKit imports (Z reconstructed, alpha opaque). */
export function normalRgba(xy: Uint8Array): Uint8Array {
  const n = xy.length / 2, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = unorm(xy[i * 2]), y = unorm(xy[i * 2 + 1]);
    out[i * 4] = xy[i * 2]; out[i * 4 + 1] = xy[i * 2 + 1];
    out[i * 4 + 2] = toByte(Math.sqrt(Math.max(0, 1 - x * x - y * y)) * .5 + .5); out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Browser preview of one game-matched Shimmer layer, following the faceted export route:
 * every level fades facet tilts as NormalsBlendingMode 1 does (alpha = saturate(50 - 50z), applied
 * here as a scale on X/Y against the flat plate normal), and lower levels widen roughness by the
 * unresolved facet variance exactly as the export chain does. Inputs are the export's two channels:
 * `normal` X, Y and `surface` roughness, metalness per texel of a width × height power-of-two map.
 * Output levels are the RGBA the preview uploads: normal (X, Y, Z, 255) and surface (0, roughness,
 * metalness, 255).
 *
 * A cooperative job (the raster worker drains it in slices, off the main thread): level 0 is encoded
 * from the bytes, level 1 is reduced straight from the bytes, and only the lower levels hold float
 * planes (x, y, x²+y², roughness, metalness), so a 2048 × 1024 grain peaks near 20 MB of planes.
 * Each advance unit is one texel written or reduced.
 */
export function createPreviewFacetChainJob(normal: Uint8Array, surface: Uint8Array, width: number, height = width) {
  const dims = mipDimensions(width, height), texels = width * height;
  if (normal.length !== texels * 2 || surface.length !== texels * 2) throw new RangeError("Preview facet maps do not match size");
  const normals: Uint8Array<ArrayBuffer>[] = [], surfaces: Uint8Array<ArrayBuffer>[] = [];
  let level = 0, cursor = 0, done = false;
  let planes: Float64Array<ArrayBufferLike> | undefined;
  let nb = new Uint8Array(texels * 4), sb = new Uint8Array(texels * 4);
  /** One texel of a level: its mean X, Y, the mean of x²+y², roughness and metalness. */
  const encode = (i: number, x: number, y: number, m2: number, r: number, metal: number, widen: boolean) => {
    const fade = clip01(50 - 50 * Math.sqrt(Math.max(0, 1 - x * x - y * y))), fx = x * fade, fy = y * fade, o = i * 4;
    nb[o] = toByte(fx * .5 + .5); nb[o + 1] = toByte(fy * .5 + .5); nb[o + 2] = toByte(Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)) * .5 + .5); nb[o + 3] = 255;
    const variance = widen ? Math.max(0, m2 - (x * x + y * y)) : 0;
    sb[o + 1] = toByte(Math.sqrt(Math.sqrt((r * r) * (r * r) + variance))); sb[o + 2] = toByte(metal); sb[o + 3] = 255;
  };
  const finishLevel = () => {
    normals.push(nb); surfaces.push(sb); level++; cursor = 0;
    if (level === dims.length) { done = true; planes = undefined; return; }
    const n = dims[level].width * dims[level].height;
    nb = new Uint8Array(n * 4); sb = new Uint8Array(n * 4);
    if (level === 1) planes = new Float64Array(n * 5);
    else planes = reducePlanes(planes!, dims[level - 1].width, dims[level - 1].height, 5);
  };
  return {
    get done() { return done; },
    get normal() { return normals; },
    get surface() { return surfaces; },
    advance(maxWork: number) {
      if (!(maxWork > 0)) throw Error("Invalid chain slice size.");
      let work = 0;
      while (!done && work < maxWork) {
        const { width: w, height: h } = dims[level], n = w * h;
        const end = Math.min(n, cursor + Math.max(1, Math.min(maxWork - work, n)));
        if (level === 0) {
          for (let i = cursor; i < end; i++) {
            const x = unorm(normal[i * 2]), y = unorm(normal[i * 2 + 1]);
            encode(i, x, y, 0, surface[i * 2] / 255, surface[i * 2 + 1] / 255, false);
          }
        } else if (level === 1) {
          // The plain box mean of the decoded base texels, in the flat chain's float order ((a + b) + c) + d.
          const pw = dims[0].width, square = pw > 1 && dims[0].height > 1, p = planes!;
          let sx = 0, sy = 0, sm = 0, sr = 0, sl = 0;
          const add = (t: number) => {
            const x = unorm(normal[t * 2]), y = unorm(normal[t * 2 + 1]);
            sx += x; sy += y; sm += x * x + y * y; sr += surface[t * 2] / 255; sl += surface[t * 2 + 1] / 255;
          };
          for (let i = cursor; i < end; i++) {
            sx = sy = sm = sr = sl = 0;
            if (square) {
              const row = (i / w) | 0, t = 2 * row * pw + 2 * (i - row * w);
              add(t); add(t + 1); add(t + pw); add(t + pw + 1);
            } else { add(2 * i); add(2 * i + 1); }
            const k = square ? 4 : 2, o = i * 5;
            p[o] = sx / k; p[o + 1] = sy / k; p[o + 2] = sm / k; p[o + 3] = sr / k; p[o + 4] = sl / k;
            encode(i, p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], true);
          }
        } else {
          const p = planes!;
          for (let i = cursor; i < end; i++) { const o = i * 5; encode(i, p[o], p[o + 1], p[o + 2], p[o + 3], p[o + 4], true); }
        }
        work += end - cursor; cursor = end;
        if (cursor === n) finishLevel();
      }
      return done;
    },
  };
}

/** Synchronous preview chains (tests and small maps); the worker drains `createPreviewFacetChainJob`. */
export function previewFacetChains(normal: Uint8Array, surface: Uint8Array, width: number, height = width): { normal: Uint8Array[]; surface: Uint8Array[] } {
  const job = createPreviewFacetChainJob(normal, surface, width, height);
  job.advance(Infinity);
  return { normal: job.normal, surface: job.surface };
}
