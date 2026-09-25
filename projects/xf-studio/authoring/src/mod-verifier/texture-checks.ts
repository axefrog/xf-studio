// Independent texture arithmetic for the package verifier. Pure: no IO.
//
// This file must not import the compiler's mip or colour code (flat-mip-chain.ts,
// preset-compiler.ts). It restates the published flat mesh-decal contract from the
// specification so that a compiler regression cannot also change the expected
// values: coverage = (alpha/255)^2; colour contributes sqrt(linear sRGB) * coverage;
// roughness and metalness contribute value * coverage; each lower mip averages the
// four finer contributions and re-encodes them. Supplied chains are compared to
// this reference byte for byte, so the float order is part of the specification:
// the 2x2 average is ((top-left + top-right) + bottom-left) + bottom-right, over 4.
// Non-square maps (the plate-local window) halve both sides until one reaches 1; each
// further level is the two-texel average (first + second) / 2 along the other side.

export type VerifierChannel = "diffuse" | "roughness" | "metalness";

/** Contribution planes of one level (separate planes, unlike the compiler's interleaving). */
export interface ContributionPlanes {
  readonly width: number;
  readonly height: number;
  /** Premultiplied sqrt-linear red, green, blue; roughness; metalness; coverage. */
  readonly planes: readonly [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array, Float64Array];
}

const decodeSrgb = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const encodeSrgb = (v: number) => (v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v < 0 ? 0 : v, 1 / 2.4) - .055);
const unitByte = (v: number) => Math.floor((v < 0 ? 0 : v > 1 ? 1 : v) * 255 + .5);

const SQRT_LINEAR = (() => {
  const table = new Float64Array(256);
  for (let value = 0; value < 256; value++) table[value] = Math.sqrt(decodeSrgb(value / 255));
  return table;
})();

/** Contributions of decoded bytes: RGBA diffuse and single-channel roughness/metalness. */
export function contributionsOf(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, width: number, height = width): ContributionPlanes {
  const n = width * height;
  if (diffuse.length !== n * 4 || roughness.length !== n || metalness.length !== n)
    throw new Error(`Texture byte lengths do not match a ${width}x${height} level`);
  const planes = [0, 1, 2, 3, 4, 5].map(() => new Float64Array(n)) as unknown as ContributionPlanes["planes"];
  const [red, green, blue, rough, metal, cover] = planes;
  for (let t = 0; t < n; t++) {
    const alpha = diffuse[4 * t + 3] / 255, coverage = alpha * alpha;
    red[t] = SQRT_LINEAR[diffuse[4 * t]] * coverage;
    green[t] = SQRT_LINEAR[diffuse[4 * t + 1]] * coverage;
    blue[t] = SQRT_LINEAR[diffuse[4 * t + 2]] * coverage;
    rough[t] = roughness[t] / 255 * coverage;
    metal[t] = metalness[t] / 255 * coverage;
    cover[t] = coverage;
  }
  return { width, height, planes };
}

/** Average separate planes of a width x height level down one mip level (the rule in the header). */
function averagePlanes(planes: readonly Float64Array<ArrayBufferLike>[], width: number, height: number): Float64Array<ArrayBufferLike>[] {
  if ((width < 2 && height < 2) || (width > 1 && width % 2) || (height > 1 && height % 2))
    throw new Error(`Cannot halve a ${width}x${height} level`);
  if (width > 1 && height > 1) {
    const halfWidth = width / 2, halfHeight = height / 2;
    return planes.map(source => {
      const target = new Float64Array(halfWidth * halfHeight);
      for (let row = 0; row < halfHeight; row++) {
        const top = 2 * row * width, bottom = top + width;
        for (let column = 0; column < halfWidth; column++) {
          const left = 2 * column;
          target[row * halfWidth + column] = (((source[top + left] + source[top + left + 1]) + source[bottom + left]) + source[bottom + left + 1]) / 4;
        }
      }
      return target;
    });
  }
  // A single row or column: pairs of consecutive texels.
  const count = width * height / 2;
  return planes.map(source => {
    const target = new Float64Array(count);
    for (let t = 0; t < count; t++) target[t] = (source[2 * t] + source[2 * t + 1]) / 2;
    return target;
  });
}
const halfDims = (width: number, height: number) => ({ width: Math.max(1, width / 2), height: Math.max(1, height / 2) });

/** Area-average a level to the next mip level. */
export function halve(level: ContributionPlanes): ContributionPlanes {
  const planes = averagePlanes(level.planes, level.width, level.height) as unknown as ContributionPlanes["planes"];
  return { ...halfDims(level.width, level.height), planes };
}

/** Encode contributions back to bytes by un-premultiplying present texels. */
export function bytesOf(level: ContributionPlanes): Record<VerifierChannel, Uint8Array> {
  const n = level.width * level.height, [red, green, blue, rough, metal, cover] = level.planes;
  const diffuse = new Uint8Array(4 * n), roughness = new Uint8Array(n), metalness = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const coverage = cover[t];
    diffuse[4 * t + 3] = unitByte(Math.sqrt(coverage));
    if (!(coverage > 0)) continue;
    [red, green, blue].forEach((plane, channel) => {
      let straight = plane[t] / coverage;
      straight = straight < 0 ? 0 : straight > 1 ? 1 : straight;
      diffuse[4 * t + channel] = unitByte(encodeSrgb(straight * straight));
    });
    roughness[t] = unitByte(rough[t] / coverage);
    metalness[t] = unitByte(metal[t] / coverage);
  }
  return { diffuse, roughness, metalness };
}

/** Reference chain: base bytes verbatim, then encoded area averages. */
export function expectedChain(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, width: number, height = width) {
  const chain: Record<VerifierChannel, Uint8Array[]> = { diffuse: [diffuse], roughness: [roughness], metalness: [metalness] };
  const ideal: ContributionPlanes[] = [contributionsOf(diffuse, roughness, metalness, width, height)];
  while (ideal[ideal.length - 1].width > 1 || ideal[ideal.length - 1].height > 1) {
    const next = halve(ideal[ideal.length - 1]);
    ideal.push(next);
    const encoded = bytesOf(next);
    for (const channel of ["diffuse", "roughness", "metalness"] as const) chain[channel].push(encoded[channel]);
  }
  return { chain, ideal };
}

/** NumPy-compatible pairwise float64 summation (blocks of 8, recursive halves above 128). */
function pairwiseSum(values: Float64Array, start: number, count: number): number {
  if (count < 8) {
    let sum = -0;
    for (let i = 0; i < count; i++) sum += values[start + i];
    return sum;
  }
  if (count <= 128) {
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map(k => values[start + k]);
    let i = 8;
    for (; i < count - (count % 8); i += 8) for (let k = 0; k < 8; k++) r[k] += values[start + i + k];
    let sum = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < count; i++) sum += values[start + i];
    return sum;
  }
  let half = Math.floor(count / 2);
  half -= half % 8;
  return pairwiseSum(values, start, half) + pairwiseSum(values, start + half, count - half);
}

export interface ErrorStats { readonly mean: number; readonly p95: number; readonly max: number }

/** Mean, 95th percentile (NumPy's default linear method) and maximum. */
export function errorStats(values: Float64Array): ErrorStats {
  const n = values.length;
  if (!n) throw new Error("No values to summarise");
  const sorted = Float64Array.from(values).sort();
  const q = 95 / 100, virtual = (n - 1) * q;
  const lower = Math.min(Math.max(Math.floor(virtual), 0), n - 1), upper = Math.min(lower + 1, n - 1);
  const t = virtual - Math.floor(virtual), a = sorted[lower], b = sorted[upper], difference = b - a;
  const p95 = t >= .5 ? b - difference * (1 - t) : a + difference * t;
  return { mean: pairwiseSum(values, 0, n) / n, p95, max: sorted[n - 1] };
}

// ---- Faceted and Fresnel routes (the published specification, restated independently) ----
//
// Faceted: diffuse and metalness follow the flat chain above. Normal X/Y bytes decode as
// byte/255*2-1; each lower level is the plain 2x2 mean of the finer level's floats, encoded as
// unitByte(x*.5+.5). The supplied RGBA input adds B = unitByte(sqrt(max(0,1-x²-y²))*.5+.5) and A = 255.
// Roughness level 0 is verbatim; lower levels are unitByte(clip01(r̄⁴ + v)^¼) where coverage > 0,
// r̄ the flat chain's coverage-weighted mean and v = max(0, E[x²+y²] − E[x]² − E[y]²) from plain
// means of base-level moments. Fresnel: mask levels are plain means of byte/255; the gradient is uniform.

const unorm = (b: number) => b / 255 * 2 - 1;
const clip = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Expected faceted roughness chain, normal X/Y chain and the RGBA normal import chain. */
export function facetedReference(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, normalXY: Uint8Array, width: number, height = width) {
  const n = width * height;
  if (normalXY.length !== n * 2) throw new Error(`Normal byte length does not match a ${width}x${height} level`);
  const x = new Float64Array(n), y = new Float64Array(n), m2 = new Float64Array(n);
  for (let t = 0; t < n; t++) { x[t] = unorm(normalXY[2 * t]); y[t] = unorm(normalXY[2 * t + 1]); m2[t] = x[t] * x[t] + y[t] * y[t]; }
  let moments: Float64Array<ArrayBufferLike>[] = [x, y, m2], level = contributionsOf(diffuse, roughness, metalness, width, height);
  const roughChain: Uint8Array[] = [roughness.slice()], xyChain: Uint8Array[] = [normalXY.slice()];
  while (level.width > 1 || level.height > 1) {
    moments = averagePlanes(moments, level.width, level.height); level = halve(level);
    const count = level.width * level.height, r = new Uint8Array(count), xy = new Uint8Array(count * 2);
    const [mx, my, mm] = moments, cover = level.planes[5], rough = level.planes[3];
    for (let t = 0; t < count; t++) {
      xy[2 * t] = unitByte(mx[t] * .5 + .5); xy[2 * t + 1] = unitByte(my[t] * .5 + .5);
      if (cover[t] > 0) {
        const mean = clip(rough[t] / cover[t]), variance = Math.max(0, mm[t] - (mx[t] * mx[t] + my[t] * my[t]));
        r[t] = unitByte(Math.pow((mean * mean) * (mean * mean) + variance, .25));
      }
    }
    roughChain.push(r); xyChain.push(xy);
  }
  const rgba = xyChain.map(level => {
    const out = new Uint8Array(level.length * 2);
    for (let t = 0; t < level.length / 2; t++) {
      const a = unorm(level[2 * t]), b = unorm(level[2 * t + 1]);
      out.set([level[2 * t], level[2 * t + 1], unitByte(Math.sqrt(Math.max(0, 1 - a * a - b * b)) * .5 + .5), 255], 4 * t);
    }
    return out;
  });
  return { roughness: roughChain, normalXY: xyChain, normalInput: rgba };
}

/** Expected linear coverage mask chain. */
export function maskReference(mask: Uint8Array, width: number, height = width): Uint8Array[] {
  let plane: Float64Array<ArrayBufferLike>[] = [Float64Array.from(mask, b => b / 255)], w = width, h = height;
  const chain: Uint8Array[] = [mask.slice()];
  while (w > 1 || h > 1) { plane = averagePlanes(plane, w, h); ({ width: w, height: h } = halfDims(w, h)); chain.push(Uint8Array.from(plane[0], unitByte)); }
  return chain;
}

/** Expected uniform RGBA chain of one colour. */
export function uniformReference(rgba: readonly number[], side: number): Uint8Array[] {
  const chain: Uint8Array[] = [];
  for (let s = side; s >= 1; s >>= 1) { const level = new Uint8Array(s * s * 4); for (let t = 0; t < s * s; t++) level.set(rgba, 4 * t); chain.push(level); }
  return chain;
}
