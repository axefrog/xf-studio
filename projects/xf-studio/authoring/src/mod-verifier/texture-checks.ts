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

export type VerifierChannel = "diffuse" | "roughness" | "metalness";

/** Contribution planes of one square level (separate planes, unlike the compiler's interleaving). */
export interface ContributionPlanes {
  readonly side: number;
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
export function contributionsOf(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, side: number): ContributionPlanes {
  const n = side * side;
  if (diffuse.length !== n * 4 || roughness.length !== n || metalness.length !== n)
    throw new Error(`Texture byte lengths do not match a ${side}x${side} level`);
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
  return { side, planes };
}

/** Area-average a level to half size. */
export function halve(level: ContributionPlanes): ContributionPlanes {
  const side = level.side;
  if (side < 2 || side % 2) throw new Error(`Cannot halve a ${side}x${side} level`);
  const half = side / 2;
  const planes = level.planes.map(source => {
    const target = new Float64Array(half * half);
    for (let row = 0; row < half; row++) {
      const top = 2 * row * side, bottom = top + side;
      for (let column = 0; column < half; column++) {
        const left = 2 * column;
        target[row * half + column] = (((source[top + left] + source[top + left + 1]) + source[bottom + left]) + source[bottom + left + 1]) / 4;
      }
    }
    return target;
  }) as unknown as ContributionPlanes["planes"];
  return { side: half, planes };
}

/** Encode contributions back to bytes by un-premultiplying present texels. */
export function bytesOf(level: ContributionPlanes): Record<VerifierChannel, Uint8Array> {
  const n = level.side * level.side, [red, green, blue, rough, metal, cover] = level.planes;
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
export function expectedChain(diffuse: Uint8Array, roughness: Uint8Array, metalness: Uint8Array, side: number) {
  const chain: Record<VerifierChannel, Uint8Array[]> = { diffuse: [diffuse], roughness: [roughness], metalness: [metalness] };
  const ideal: ContributionPlanes[] = [contributionsOf(diffuse, roughness, metalness, side)];
  while (ideal[ideal.length - 1].side > 1) {
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
