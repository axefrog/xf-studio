// Independent restatement of the plate-local UV window for the package verifier. Pure.
//
// Restated on purpose instead of imported from the builder (src/plate-uv-window.ts, src/finish-export.ts):
//
// - Game sampling (decompiled `mesh_decal` pixel program 16098255505177109230, UVRotation 0): for the
//   vertex UV as stored in the mesh, t = UVScale·(uv − 0.5) + 0.5 + UVOffset, then sign(t)·frac(|t|),
//   sampled with a wrapping sampler; texture row 0 is t_v = 0.
// - Storage: WolvenKit's XBM import stores image rows bottom to top (its export flips them back), so the
//   compiler's image row y sits at stored t_v = 1 − (y + ½)/height. This verifier checks that flip on every
//   build by decoding a stored BC4 level itself.
// - Authoring: the Studio's UV is glTF UV0, v = 1 − stored V.
// - Window rule: the plate's stored UV0 bounds, each axis widened by 1/64 of the window span on each side
//   and clamped to [0, 1];
//   flat and faceted presets use 2048 × 512 maps over it, head-UV presets 1024², the Fresnel gradient 16².
// - The window constants map the window's stored-UV rectangle onto t ∈ [0, 1] with image rows in natural
//   authored order, so UVScaleX = 1/(u1 − u0), UVOffsetX = −UVScaleX·((u0 + u1)/2 − ½), and in authored v
//   UVScaleY = 1/(v1 − v0), UVOffsetY = UVScaleY·((v0 + v1)/2 − ½).
import { ensure, type Node } from "./resource-checks";

export const VERIFIER_UV_MARGIN = 1 / 64;

export interface VerifierWindow { readonly u0: number; readonly u1: number; readonly v0: number; readonly v1: number }
export interface PlateUvSamples {
  /** Stored UV0 of each sample point (vertices, then points inside every triangle). */
  readonly uv: Float64Array;
  readonly bounds: { readonly uMin: number; readonly uMax: number; readonly vMin: number; readonly vMax: number };
}

const SIZES: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4,
  PT_Color: 4, PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16 };
function half(bits: number): number {
  const exponent = (bits >> 10) & 31, mantissa = bits & 1023, sign = bits >> 15 ? -1 : 1;
  return exponent === 0 ? sign * mantissa / 16777216 : exponent === 31 ? NaN : sign * (1024 + mantissa) * 2 ** (exponent - 25);
}
/** Barycentric points taken inside each triangle, besides its vertices. */
const INSIDE: readonly (readonly [number, number])[] = [[1 / 3, 1 / 3], [2 / 3, 1 / 6], [1 / 6, 2 / 3], [1 / 6, 1 / 6], [.5, .25], [.25, .5]];
/**
 * A dense barycentric grid (every (i, j)/12 with i + j ≤ 12, 91 points per triangle), for a sparse mask such as a
 * glitter accent, whose flakes a few points per triangle would mostly miss.
 */
export const DENSE_INSIDE: readonly (readonly [number, number])[] = Array.from({ length: 13 }, (_, i) =>
  Array.from({ length: 13 - i }, (_, j) => [i / 12, j / 12] as const)).flat();

/** Stored UV0 of every vertex and six points (or `inside`) inside every triangle of each render chunk of a mesh RootChunk. */
export function plateUvSamples(meshRoot: Node, inside: readonly (readonly [number, number])[] = INSIDE): PlateUvSamples {
  const blob = meshRoot?.renderResourceBlob?.Data, infos = blob?.header?.renderChunkInfos;
  ensure(Array.isArray(infos) && infos.length > 0, "The packaged plate has no render chunks for its UVs");
  const raw = Buffer.from(String(blob.renderBuffer?.Bytes ?? ""), "base64"), points: number[] = [];
  for (const info of infos) {
    const layout = info.chunkVertices.vertexLayout, used = new Map<number, number>();
    let uv: { stream: number; at: number } | undefined;
    for (const e of layout.elements.Elements) {
      if (e.streamType !== "ST_PerVertex") continue;
      ensure(SIZES[e.type], `The packaged plate has an unknown element type ${e.type}`);
      const at = used.get(e.streamIndex) ?? 0;
      if (e.usage === "PS_TexCoord" && e.usageIndex === 0) { ensure(e.type === "PT_Float16_2", "The packaged plate's UV0 is not two halves"); uv = { stream: e.streamIndex, at }; }
      used.set(e.streamIndex, at + SIZES[e.type]);
    }
    ensure(uv, "The packaged plate has no UV0");
    const stride = layout.slotStrides.Elements[uv.stream], base = info.chunkVertices.byteOffsets.Elements[uv.stream];
    const vertex = (v: number) => { const at = base + v * stride + uv!.at; return [half(raw.readUInt16LE(at)), half(raw.readUInt16LE(at + 2))]; };
    for (let v = 0; v < info.numVertices; v++) points.push(...vertex(v));
    ensure(info.chunkIndices?.pe === "IBCT_IndexUShort", "The packaged plate does not use 16-bit indices");
    const start = blob.header.indexBufferOffset + info.chunkIndices.teOffset;
    for (let i = 0; i + 2 < info.numIndices; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => vertex(raw.readUInt16LE(start + (i + k) * 2)));
      for (const [s, t] of inside) points.push(a[0] + s * (b[0] - a[0]) + t * (c[0] - a[0]), a[1] + s * (b[1] - a[1]) + t * (c[1] - a[1]));
    }
  }
  const uv = Float64Array.from(points);
  ensure(uv.every(Number.isFinite), "The packaged plate has a non-finite UV");
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < uv.length; i += 2) { uMin = Math.min(uMin, uv[i]); uMax = Math.max(uMax, uv[i]); vMin = Math.min(vMin, uv[i + 1]); vMax = Math.max(vMax, uv[i + 1]); }
  return { uv, bounds: { uMin, uMax, vMin, vMax } };
}

/** The window the restated rule gives for stored bounds, in authored (glTF) UV. */
export function expectedWindow(bounds: PlateUvSamples["bounds"]): VerifierWindow {
  const spanU = (bounds.uMax - bounds.uMin) / (1 - 2 * VERIFIER_UV_MARGIN), spanV = (bounds.vMax - bounds.vMin) / (1 - 2 * VERIFIER_UV_MARGIN);
  const window = { u0: Math.max(0, bounds.uMin - VERIFIER_UV_MARGIN * spanU), u1: Math.min(1, bounds.uMax + VERIFIER_UV_MARGIN * spanU),
    v0: Math.max(0, 1 - bounds.vMax - VERIFIER_UV_MARGIN * spanV), v1: Math.min(1, 1 - bounds.vMin + VERIFIER_UV_MARGIN * spanV) };
  ensure(window.u1 > window.u0 && window.v1 > window.v0, "The plate's UVs span no area inside the atlas");
  return window;
}

/** The four `mesh_decal` constants the window's material must carry. */
export function expectedUvConstants(window: VerifierWindow): Record<"UVScaleX" | "UVOffsetX" | "UVScaleY" | "UVOffsetY", number> {
  const sx = 1 / (window.u1 - window.u0), sy = 1 / (window.v1 - window.v0);
  return { UVScaleX: sx, UVOffsetX: -sx * ((window.u0 + window.u1) / 2 - .5), UVScaleY: sy, UVOffsetY: sy * ((window.v0 + window.v1) / 2 - .5) };
}

/** Same window within `tolerance` on every edge. */
export const sameWindow = (a: Node, b: VerifierWindow, tolerance = 1e-12) =>
  !!a && (["u0", "u1", "v0", "v1"] as const).every(key => typeof a[key] === "number" && Math.abs(a[key] - b[key]) <= tolerance);

/** The shader's wrap of one transformed coordinate. */
const wrapT = (t: number) => Math.sign(t) * (Math.abs(t) % 1);

/** Bilinear sample of a single-plane level at continuous texel coordinates (texel centres at integers), wrapping. */
function bilinear(plane: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => plane[(((j % height) + height) % height) * width + (((i % width) + width) % width)];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * `covered`: samples where either side has coverage (≥ 1/255), over which the errors are taken. `drawn`: samples
 * where the game's map has coverage. `authored`: samples where the authored reference reaches at least
 * `REFERENCE_REACH` (the Studio's plate-reach threshold, 2/255, restated).
 */
export interface MappingStats { readonly samples: number; readonly covered: number; readonly drawn: number; readonly authored: number;
  readonly mean: number; readonly p99: number; readonly farShare: number }
/** Authored coverage at a sample that counts as the makeup reaching it (the Studio omits presets that reach no sample at 2/255). */
export const REFERENCE_REACH = 2 / 255;

/** A head-UV coverage reference: texels [x0, x0 + width) × [y0, y0 + height) of a grid² head atlas. */
export interface ReferenceCrop { readonly grid: number; readonly x0: number; readonly y0: number; readonly width: number; readonly height: number }

/**
 * What the game draws at each plate sample against what was authored there. `coverage` is the decoded
 * (row-order restored) level-0 coverage of a width × height map, `constants` the packaged material's UV
 * transform, `reference` the authored head-UV coverage (bytes over `crop`). A sample's stored UV (U, V)
 * samples the map at t = shader(U, V), i.e. image row (1 − t_v)·height, and the reference at authored
 * (U, 1 − V). Returns error statistics over samples where either side is covered.
 */
export function mappingStats(coverage: Float64Array, width: number, height: number, constants: Record<string, number>,
  reference: Uint8Array, crop: ReferenceCrop, samples: PlateUvSamples): MappingStats {
  const errors: number[] = [];
  let far = 0, drawn = 0, reached = 0;
  for (let i = 0; i < samples.uv.length; i += 2) {
    const U = samples.uv[i], V = samples.uv[i + 1];
    const tu = wrapT(constants.UVScaleX * (U - .5) + .5 + constants.UVOffsetX), tv = wrapT(constants.UVScaleY * (V - .5) + .5 + constants.UVOffsetY);
    const game = bilinear(coverage, width, height, tu * width - .5, (1 - tv) * height - .5);
    const rx = U * crop.grid - .5 - crop.x0, ry = (1 - V) * crop.grid - .5 - crop.y0;
    ensure(rx >= 0 && ry >= 0 && rx < crop.width - 1 && ry < crop.height - 1, "A plate sample lies outside the coverage reference");
    const authored = bilinear(reference, crop.width, crop.height, rx, ry) / 255;
    if (game >= 1 / 255) drawn++;
    if (authored >= REFERENCE_REACH) reached++;
    if (game < 1 / 255 && authored < 1 / 255) continue;
    const error = Math.abs(game - authored);
    errors.push(error);
    if (error > .5) far++;
  }
  const sorted = Float64Array.from(errors).sort(), n = sorted.length;
  return { samples: samples.uv.length / 2, covered: n, drawn, authored: reached, mean: n ? errors.reduce((a, b) => a + b, 0) / n : 0,
    p99: n ? sorted[Math.min(n - 1, Math.floor(.99 * (n - 1)))] : 0, farShare: n ? far / n : 0 };
}

/**
 * Search range of the offset estimate (window texels), its coarse-to-fine steps, and the least evidence it needs
 * (PIPE-39): samples with authored content (≥ 1/255), and edge strength, the spread of the total error over the
 * coarse shifts in coverage units (how much misplacing the content would cost). Below either the estimate is not
 * made. Calibrated on lossless bakes of the lid layer over the built-in plate's window: a preset that barely reaches
 * the plate (13 content samples, edge 2.5) and very faint makeup (1 % opacity, edge 2.5 one-sided and 4.4 mirrored;
 * 0.5 %, edge 0.9) gave spurious estimates of 0.2-0.5 texel, while presets with at least 100 content samples and
 * edge 24 estimated exactly 0.
 */
export const OFFSET_SEARCH = Object.freeze({ range: 8, steps: [1, 1 / 4, 1 / 16] as readonly number[], minContentSamples: 24, minEdge: 8 });

/**
 * Signed estimate of how far the game's map content sits from the authored content at the plate samples, in
 * texels of the window map (u: image columns, v: image rows; positive = towards a larger column or row). It
 * shifts only the game-side lookup by (su, sv) and takes the shift with the least total absolute difference from
 * the authored reference: a joint search (a diagonal edge couples the axes) over whole texels within ±range,
 * refined twice around the best. Among equal errors the shift nearest zero wins, so an edge along one axis
 * reports 0 on it. The mean-error gate tolerates small misregistrations (a 6-texel shift of fine lines passes
 * it); this estimate bounds them. `null` when there is too little to align (see `OFFSET_SEARCH`), so the estimate
 * would be noise.
 */
export function mappingOffset(coverage: Float64Array, width: number, height: number, constants: Record<string, number>,
  reference: Uint8Array, crop: ReferenceCrop, samples: PlateUvSamples, search = OFFSET_SEARCH): { u: number | null; v: number | null } {
  // Texels with content, as a summed-area table: a sample far from all content can never differ under any shift.
  const sat = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) for (let x = 0, row = 0; x < width; x++) {
    row += coverage[y * width + x] > 0 ? 1 : 0;
    sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row;
  }
  const anyContent = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1);
    return x1 > x0 && y1 > y0 && sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0] > 0;
  };
  const gx: number[] = [], gy: number[] = [], authored: number[] = [], reach = search.range + 2;
  for (let i = 0; i < samples.uv.length; i += 2) {
    const U = samples.uv[i], V = samples.uv[i + 1];
    const tu = wrapT(constants.UVScaleX * (U - .5) + .5 + constants.UVOffsetX), tv = wrapT(constants.UVScaleY * (V - .5) + .5 + constants.UVOffsetY);
    const x = tu * width - .5, y = (1 - tv) * height - .5;
    const rx = U * crop.grid - .5 - crop.x0, ry = (1 - V) * crop.grid - .5 - crop.y0;
    ensure(rx >= 0 && ry >= 0 && rx < crop.width - 1 && ry < crop.height - 1, "A plate sample lies outside the coverage reference");
    const a = bilinear(reference, crop.width, crop.height, rx, ry) / 255;
    const near = anyContent(Math.floor(x) - reach, Math.floor(y) - reach, Math.floor(x) + reach + 2, Math.floor(y) + reach + 2);
    if (!a && !near) continue;
    gx.push(x); gy.push(y); authored.push(a);
  }
  const error = (su: number, sv: number) => {
    let sum = 0;
    for (let i = 0; i < gx.length; i++) sum += Math.abs(bilinear(coverage, width, height, gx[i] + su, gy[i] + sv) - authored[i]);
    return sum;
  };
  const content = authored.reduce((n, a) => n + (a >= 1 / 255 ? 1 : 0), 0);
  if (content < search.minContentSamples) return { u: null, v: null };
  let best = { u: 0, v: 0, e: error(0, 0) }, least = best.e, most = best.e;
  const tolerance = () => 1e-9 * Math.max(1, best.e);
  for (const [level, step] of search.steps.entries()) {
    const radius = level === 0 ? search.range : search.steps[level - 1], k = Math.round(radius / step), cu = best.u, cv = best.v;
    for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) {
      const u = cu + a * step, v = cv + b * step;
      if (Math.abs(u) > search.range || Math.abs(v) > search.range) continue;
      const e = error(u, v);
      if (level === 0) { least = Math.min(least, e); most = Math.max(most, e); }
      if (e < best.e - tolerance() || (e <= best.e + tolerance() && Math.hypot(u, v) < Math.hypot(best.u, best.v))) best = { u, v, e };
    }
    if (level === 0 && !(most - least >= search.minEdge && most - least > 1e-9 * Math.max(1, most))) return { u: null, v: null };
  }
  return { u: best.u, v: best.v };
}

/**
 * A head-UV mask (a glitter accent, no UV transform) where the game draws it on the plate, against its layer's
 * authored head-UV coverage (PIPE-74). A sample's stored UV (U, V) samples the size² mask at image row (1 − V)·size
 * and the reference at authored (U, 1 − V). `mass` is the mask's total over the samples, `outside` the part of it at
 * samples where the layer's coverage (the largest of the sample and its four neighbours one mask texel away, for
 * the mask's own antialiased edge) is below 1/255.
 */
export function headMaskPlacement(mask: Uint8Array, size: number, reference: Uint8Array, crop: ReferenceCrop, samples: PlateUvSamples) {
  let mass = 0, outside = 0, drawn = 0;
  const step = crop.grid / size;
  for (let i = 0; i < samples.uv.length; i += 2) {
    const U = samples.uv[i], V = samples.uv[i + 1];
    const a = bilinear(mask, size, size, wrapT(U) * size - .5, (1 - wrapT(V)) * size - .5) / 255;
    if (a < 1 / 255) continue;
    const rx = U * crop.grid - .5 - crop.x0, ry = (1 - V) * crop.grid - .5 - crop.y0;
    ensure(rx >= step && ry >= step && rx < crop.width - 1 - step && ry < crop.height - 1 - step, "A plate sample lies outside the accent's coverage reference");
    let authored = 0;
    for (const [dx, dy] of [[0, 0], [step, 0], [-step, 0], [0, step], [0, -step]])
      authored = Math.max(authored, bilinear(reference, crop.width, crop.height, rx + dx, ry + dy) / 255);
    mass += a; drawn++;
    if (authored < 1 / 255) outside += a;
  }
  return { samples: samples.uv.length / 2, drawn, mass, outsideShare: mass ? outside / mass : 0 };
}

/**
 * Level 0 of a BC4 (`TCM_QualityR`) XBM as stored, decoded here (the verifier's own decoder), in stored row
 * order. Reads the serialized `renderTextureResource` blob; returns bytes, width × height.
 */
export function storedBc4Level0(xbm: Node, label: string): { width: number; height: number; data: Uint8Array } {
  const width = xbm?.width, height = xbm?.height, blob = xbm?.renderTextureResource?.renderResourceBlobPC?.Data;
  const info = blob?.header?.mipMapInfo?.[0];
  ensure(Number.isInteger(width) && Number.isInteger(height) && info && typeof blob?.textureData?.Bytes === "string",
    `${label} has no stored texture data`);
  const raw = Buffer.from(blob.textureData.Bytes, "base64"), pitch = info.layout.rowPitch, offset = info.placement.offset;
  const blocksWide = Math.ceil(width / 4), blocksHigh = Math.ceil(height / 4);
  ensure(pitch === blocksWide * 8 && info.placement.size === pitch * blocksHigh && offset + info.placement.size <= raw.length,
    `${label} level 0 is not a BC4 block layout`);
  const data = new Uint8Array(width * height);
  for (let by = 0; by < blocksHigh; by++) for (let bx = 0; bx < blocksWide; bx++) {
    const at = offset + by * pitch + bx * 8, r0 = raw[at], r1 = raw[at + 1];
    const palette = [r0, r1];
    if (r0 > r1) for (let k = 2; k < 8; k++) palette.push(((8 - k) * r0 + (k - 1) * r1) / 7);
    else { for (let k = 2; k < 6; k++) palette.push(((6 - k) * r0 + (k - 1) * r1) / 5); palette.push(0, 255); }
    let bits = 0n;
    for (let k = 0; k < 6; k++) bits |= BigInt(raw[at + 2 + k]) << BigInt(8 * k);
    for (let texel = 0; texel < 16; texel++) {
      const x = bx * 4 + (texel & 3), y = by * 4 + (texel >> 2);
      if (x < width && y < height) data[y * width + x] = Math.round(palette[Number((bits >> BigInt(3 * texel)) & 7n)]);
    }
  }
  return { width, height, data };
}
