// Experiment 024: the scripted CCXL piercing probe (see README.md). Pure: WolvenKit JSON and numbers in,
// WolvenKit JSON and text out; no file or process access (build.ts owns that).
//
// Three owned pieces are generated procedurally (a lobe hoop, a septum ring and a nostril stud), placed where
// the vanilla piercing banks put theirs (the vanilla geometry is read as calibration data only; none of it is
// copied), and fitted to the installed head the way the feasibility study proposes:
//
// - Skin: every vertex of a piece carries the skin index and weight bytes of one head vertex, the anchor, copied
//   verbatim (eight influences, the head's own bone list), so the piece moves rigidly with the skin at that point.
// - Morphs: for every head morph target that moves the anchor, every piece vertex gets the anchor's own 12-byte
//   diff row with the head's quantization kept, so its decoded position delta equals the anchor's exactly. The
//   normal and tangent deltas are the vanilla piercing banks' "no change" word, so the piece translates rigidly.
//   The head's target list (with its per-target rig matrices) is kept, as the eye plate and PRC's linked meshes do;
//   one variant keeps only the `ear` targets, as the vanilla ear banks do (feasibility check 5).
//
// Materials are the vanilla piercing `.mi` files referenced by depot path from local instances, exactly as the
// vanilla banks do; nothing is redistributed. The creator side is two new rows per area (ears, nose) after the
// vanilla Piercings row, joining the `face` and `character_customization` groups.
import { createHash } from "node:crypto";
import { vertexElements, type VertexElement, type WkJson } from "../../projects/xf-studio/authoring/src/eye-plate-cut";
import { cname, componentId, HandleCounter, resourceRef } from "../../projects/xf-studio/authoring/src/package-resources";
import { archiveXlText } from "../../projects/xf-studio/authoring/src/platform/api";

// ---------------------------------------------------------------------------------------------------------------
// The fixture's identity and content

export const MOD_NAME = "XF Piercings Probe";
export const DEPOT = "axefrog/appearance_studio/probes/piercings_024";
export const CUSTOMIZATION = `${DEPOT}/xfs_probe_piercings_pwa.inkcharcustomization`;
export const HEAD = {
  mesh: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\h0_000_pwa_c__basehead.mesh",
  morph: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa__morphs.morphtarget",
} as const;
/** Vanilla piercing banks read for calibration only (where vanilla places a lobe hoop, a septum ring and a nostril piece). */
export const BANKS = {
  ears: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_01.mesh",
  nose: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_03.mesh",
} as const;
/** Vanilla piercing finishes, referenced by path (the banks' own local instances point at these). */
export const MATERIALS = {
  silver: "base\\characters\\common\\character_customisation_items\\earrings\\i1_000_base_01__silver.mi",
  gold: "base\\characters\\common\\character_customisation_items\\earrings\\i1_000_base_01__gold.mi",
} as const;
export type Finish = keyof typeof MATERIALS;
/** Head groups the rows join, like vanilla `piercings_NN`: the creator puppet and the player's face controller. */
export const GROUPS = ["character_customization", "face"] as const;
/** The morph normal/tangent delta word the vanilla piercing banks use for "no change" (511 per field, top bits 01). */
export const NEUTRAL_DELTA_WORD = 0x5ff7fdff;
/** Vertex usages the head carries that a piece does not (as the eye plate drops them). */
export const DROP_USAGES = ["PS_ExtraData", "PS_LightBlockerIntensity"] as const;
/** Eight-influence skinned layout, as the vanilla 8-influence bank chunks and the eye plate use. */
export const VERTEX_FACTORY = 4;

export type PieceId = "hoop" | "septum" | "stud";
export interface PieceSpec {
  readonly id: PieceId;
  readonly stem: string;
  readonly site: string;
  readonly shape: { kind: "ring"; wireMm: number; tubeSides: number; segments: number } |
    { kind: "stud"; diameterMm: number; heightMm: number; rings: number; segments: number };
  /** Vanilla bank chunk whose placement calibrates the site; `mirror` flips it to V's other side. */
  readonly calibration: { bank: keyof typeof BANKS; chunk: number; mirror: boolean };
}
export const PIECES: readonly PieceSpec[] = [
  { id: "hoop", stem: "xfs_probe_hoop", site: "ear.left.lobe1",
    shape: { kind: "ring", wireMm: 1.2, tubeSides: 12, segments: 48 }, calibration: { bank: "ears", chunk: 2, mirror: false } },
  { id: "septum", stem: "xfs_probe_septum", site: "septum",
    shape: { kind: "ring", wireMm: 1.2, tubeSides: 12, segments: 48 }, calibration: { bank: "nose", chunk: 0, mirror: false } },
  { id: "stud", stem: "xfs_probe_stud", site: "nostril.right",
    shape: { kind: "stud", diameterMm: 2.5, heightMm: 0.7, rings: 10, segments: 16 }, calibration: { bank: "nose", chunk: 1, mirror: true } },
];

/** One morph resource per piece and region set; the hoop also gets an `ear`-only twin (feasibility check 5). */
export interface MorphSpec { readonly stem: string; readonly piece: PieceId; readonly regions: "all" | readonly string[] }
export const MORPHS: readonly MorphSpec[] = [
  { stem: "xfs_probe_hoop", piece: "hoop", regions: "all" },
  { stem: "xfs_probe_hoop_ear", piece: "hoop", regions: ["ear"] },
  { stem: "xfs_probe_septum", piece: "septum", regions: "all" },
  { stem: "xfs_probe_stud", piece: "stud", regions: "all" },
];

export interface LookPart { readonly morph: string; readonly finish: Finish }
export interface Look { readonly name: string; readonly label: string; readonly parts: readonly LookPart[] }
export interface Row { readonly option: string; readonly label: string; readonly index: number; readonly app: string; readonly off: string; readonly looks: readonly Look[] }
/**
 * Own rows per area, right after the vanilla Piercings block (female 290-305; 306-309 are free before teeth at 310 in
 * vanilla 2.31). Build confirms both indices, names, slots and labels are free on the installation it reads.
 */
export const ROWS: readonly Row[] = [
  { option: "xfs_probe_piercings_ears", label: "XF Ears", index: 306, app: `${DEPOT}/xfs_probe_piercings_ears.app`, off: "xfs_probe_ears_off",
    looks: [
      { name: "xfs_probe_ears_hoop", label: "Probe hoop", parts: [{ morph: "xfs_probe_hoop", finish: "silver" }] },
      { name: "xfs_probe_ears_hoop_ear_only", label: "Probe hoop (ear targets only)", parts: [{ morph: "xfs_probe_hoop_ear", finish: "silver" }] },
    ] },
  { option: "xfs_probe_piercings_nose", label: "XF Nose", index: 307, app: `${DEPOT}/xfs_probe_piercings_nose.app`, off: "xfs_probe_nose_off",
    looks: [
      { name: "xfs_probe_nose_stud", label: "Probe nostril stud", parts: [{ morph: "xfs_probe_stud", finish: "silver" }] },
      { name: "xfs_probe_nose_septum", label: "Probe septum ring", parts: [{ morph: "xfs_probe_septum", finish: "silver" }] },
      { name: "xfs_probe_nose_stud_gold_septum", label: "Probe stud + gold septum",
        parts: [{ morph: "xfs_probe_stud", finish: "silver" }, { morph: "xfs_probe_septum", finish: "gold" }] },
    ] },
];

export const meshPath = (piece: PieceId) => `${DEPOT}/models/${PIECES.find(p => p.id === piece)!.stem}.mesh`;
export const morphPath = (stem: string) => `${DEPOT}/models/${stem}.morphtarget`;
/** Every resource the archive holds, forward slashes (the packed member paths). */
export function plannedPaths(): string[] {
  return [...PIECES.map(p => meshPath(p.id)), ...MORPHS.map(m => morphPath(m.stem)), ...ROWS.map(r => r.app), CUSTOMIZATION].sort();
}
export const componentName = (part: LookPart) => `${part.morph}_${part.finish}`;

// ---------------------------------------------------------------------------------------------------------------
// Small vector maths

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mm = (value: number) => Math.round(value * 1e6) / 1e3;

/** Eigen-decomposition of a symmetric 3x3 matrix (Jacobi); eigenvalues ascending with their unit vectors. */
export function symmetricEigen(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map(row => [...row]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map(i => a[i][i]), vectors: order.map(i => unit([v[0][i], v[1][i], v[2][i]])) };
}

// ---------------------------------------------------------------------------------------------------------------
// Render blobs: decode (head, banks) and encode (pieces)

const AXES = ["X", "Y", "Z"] as const;
const align16 = (value: number) => Math.ceil(value / 16) * 16;

export interface DecodedChunk {
  readonly count: number;
  readonly positions: V3[];
  readonly normals: V3[];
  /** Per-vertex row offsets per stream, to copy raw element bytes. */
  readonly elements: VertexElement[];
  readonly strides: number[];
  readonly offsets: number[];
  readonly indices: number[];
}
export function decodeDec4(word: number): V3 {
  return unit([0, 10, 20].map(shift => ((word >>> shift) & 0x3ff) * 2 / 1023 - 1) as V3);
}
export function encodeDec4(v: V3, w: number): number {
  const field = (x: number) => Math.max(0, Math.min(1023, Math.round((Math.max(-1, Math.min(1, x)) + 1) * 1023 / 2)));
  return (field(v[0]) | (field(v[1]) << 10) | (field(v[2]) << 20) | ((w & 3) << 30)) >>> 0;
}
/** IEEE half from a number (round to nearest even; finite inputs well inside the half range). */
export function toHalf(value: number): number {
  const f = new Float32Array([value]), i = new Uint32Array(f.buffer)[0];
  const sign = (i >>> 16) & 0x8000, exp = ((i >>> 23) & 0xff) - 127 + 15, mant = i & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    const m = (mant | 0x800000) >> (1 - exp);
    return sign | ((m + 0x1000 + ((m >> 13) & 1) - 1) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  let half = sign | (exp << 10) | (mant >> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half++;
  return half;
}

/** Decode one render chunk of a blob (positions dequantized with the blob's header, normals from Dec4). */
export function decodeChunk(blob: WkJson, chunkIndex: number): DecodedChunk {
  const header = blob.header, chunk = header.renderChunkInfos[chunkIndex];
  if (chunk.chunkIndices?.pe !== "IBCT_IndexUShort") throw Error("Only 16-bit index buffers are supported.");
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  const layout = chunk.chunkVertices.vertexLayout, elements = vertexElements(layout);
  const strides: number[] = layout.slotStrides.Elements, offsets: number[] = chunk.chunkVertices.byteOffsets.Elements;
  const position = elements.find(e => e.usage === "PS_Position"), normal = elements.find(e => e.usage === "PS_Normal");
  if (position?.type !== "PT_Short4N" || normal?.type !== "PT_Dec4") throw Error("Expected Short4N positions and Dec4 normals.");
  const q = AXES.map(axis => Number(header.quantizationScale[axis])), o = AXES.map(axis => Number(header.quantizationOffset[axis]));
  const count: number = chunk.numVertices, positions: V3[] = [], normals: V3[] = [];
  for (let v = 0; v < count; v++) {
    const at = offsets[position.stream] + v * strides[position.stream] + position.offset;
    positions.push([0, 1, 2].map(k => Math.max(-1, raw.readInt16LE(at + k * 2) / 32767) * q[k] + o[k]) as V3);
    normals.push(decodeDec4(raw.readUInt32LE(offsets[normal.stream] + v * strides[normal.stream] + normal.offset)));
  }
  const indexStart = header.indexBufferOffset + chunk.chunkIndices.teOffset;
  const indices = Array.from({ length: chunk.numIndices }, (_, i) => raw.readUInt16LE(indexStart + i * 2));
  return { count, positions, normals, elements, strides, offsets, indices };
}

/** Raw bytes of one vertex's element (e.g. its skin indices), from a decoded chunk's blob. */
export function elementBytes(blob: WkJson, chunk: DecodedChunk, vertex: number, usage: string, usageIndex = 0): Buffer {
  const element = chunk.elements.find(e => e.usage === usage && e.usageIndex === usageIndex);
  if (!element) throw Error(`The head has no ${usage}/${usageIndex}.`);
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  const at = chunk.offsets[element.stream] + vertex * chunk.strides[element.stream] + element.offset;
  return Buffer.from(raw.subarray(at, at + element.size));
}
/** The eight-influence skin bytes (indices 0/1, weights 0/1) of one vertex, in layout order. */
export const SKIN_ELEMENTS = [["PS_SkinIndices", 0], ["PS_SkinIndices", 1], ["PS_SkinWeights", 0], ["PS_SkinWeights", 1]] as const;
export function skinBytes(blob: WkJson, chunk: DecodedChunk, vertex: number): Buffer {
  return Buffer.concat(SKIN_ELEMENTS.map(([usage, index]) => elementBytes(blob, chunk, vertex, usage, index)));
}

/** Winding the head uses: +1 when a triangle's (b−a)×(c−a) points along its vertex normals, −1 when against. */
export function headWinding(head: DecodedChunk): 1 | -1 {
  let agree = 0, total = 0;
  for (let t = 0; t < head.indices.length; t += 3) {
    const [a, b, c] = [head.indices[t], head.indices[t + 1], head.indices[t + 2]];
    const face = cross(sub(head.positions[b], head.positions[a]), sub(head.positions[c], head.positions[a]));
    const n = add(add(head.normals[a], head.normals[b]), head.normals[c]);
    if (length(face) < 1e-14) continue;
    total++; if (dot(face, n) > 0) agree++;
  }
  return agree * 2 >= total ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------------------------
// Sites, anchors and piece geometry

export interface Geometry { positions: V3[]; normals: V3[]; tangents: V3[]; uvs: [number, number][]; indices: number[] }
export interface Calibration {
  readonly bank: string; readonly chunk: number; readonly mirror: boolean; readonly vertices: number;
  readonly centreMm: V3; readonly axis: V3; readonly radiusMm: number;
}
export interface SolvedPiece {
  readonly spec: PieceSpec;
  readonly calibration: Calibration;
  readonly anchor: { vertex: number; positionMm: V3; normal: V3; distanceMm: number; rule: string };
  readonly geometry: Geometry;
  readonly boundsMm: { min: V3; max: V3 };
}

/** Where the vanilla chunk sits: centre, plane axis (smallest spread) and mean in-plane radius (a ring's centreline). */
export function calibrate(bank: DecodedChunk, spec: PieceSpec): Calibration & { points: V3[] } {
  const points = bank.positions.map(p => spec.calibration.mirror ? [-p[0], p[1], p[2]] as V3 : p);
  const centre = scale(points.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / points.length);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) { const d = sub(p, centre); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j] / points.length; }
  const axis = symmetricEigen(cov).vectors[0];
  const radius = points.reduce((s, p) => { const d = sub(p, centre); return s + length(sub(d, scale(axis, dot(d, axis)))); }, 0) / points.length;
  return { bank: BANKS[spec.calibration.bank], chunk: spec.calibration.chunk, mirror: spec.calibration.mirror, vertices: points.length,
    centreMm: centre.map(mm) as V3, axis: axis.map(v => Math.round(v * 1e4) / 1e4) as V3, radiusMm: mm(radius), points };
}

/** In-plane frame of a ring: e1 points down the plane (so the ring hangs), e2 completes it. */
function ringFrame(axis: V3): [V3, V3] {
  let e1 = sub([0, 0, -1], scale(axis, dot([0, 0, -1], axis)));
  if (length(e1) < 1e-6) e1 = sub([1, 0, 0], scale(axis, axis[0]));
  e1 = unit(e1);
  return [e1, unit(cross(axis, e1))];
}

function torus(centre: V3, axis: V3, radius: number, tube: number, segments: number, sides: number): Geometry {
  const [e1, e2] = ringFrame(axis), g: Geometry = { positions: [], normals: [], tangents: [], uvs: [], indices: [] };
  for (let i = 0; i <= segments; i++) {
    const theta = 2 * Math.PI * i / segments, dir = add(scale(e1, Math.cos(theta)), scale(e2, Math.sin(theta)));
    const tangent = unit(add(scale(e1, -Math.sin(theta)), scale(e2, Math.cos(theta))));
    for (let j = 0; j <= sides; j++) {
      const phi = 2 * Math.PI * j / sides, normal = unit(add(scale(dir, Math.cos(phi)), scale(axis, Math.sin(phi))));
      g.positions.push(add(add(centre, scale(dir, radius)), scale(normal, tube)));
      g.normals.push(normal); g.tangents.push(tangent); g.uvs.push([i / segments, 0.15 * j / sides]);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = (i + 1) * (sides + 1) + j;
    g.indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  return g;
}

/** A flattened ellipsoid centred on the skin (its lower half is inside the head), axis along the skin normal. */
function stud(centre: V3, axis: V3, radius: number, height: number, rings: number, segments: number): Geometry {
  const [e1, e2] = ringFrame(axis), g: Geometry = { positions: [], normals: [], tangents: [], uvs: [], indices: [] };
  for (let i = 0; i <= rings; i++) {
    const phi = -Math.PI / 2 + Math.PI * i / rings;
    for (let j = 0; j <= segments; j++) {
      const theta = 2 * Math.PI * j / segments, radial = add(scale(e1, Math.cos(theta)), scale(e2, Math.sin(theta)));
      g.positions.push(add(add(centre, scale(radial, radius * Math.cos(phi))), scale(axis, height * Math.sin(phi))));
      g.normals.push(unit(add(scale(radial, Math.cos(phi) / radius), scale(axis, Math.sin(phi) / height))));
      g.tangents.push(unit(add(scale(e1, -Math.sin(theta)), scale(e2, Math.cos(theta)))));
      g.uvs.push([j / segments, 0.15 * i / rings]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = (i + 1) * (segments + 1) + j;
    g.indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  return g;
}

/** Drop zero-area triangles and orient every triangle like the head (its face normal against or along its vertex normals). */
function orient(g: Geometry, winding: 1 | -1): Geometry {
  const indices: number[] = [];
  for (let t = 0; t < g.indices.length; t += 3) {
    let [a, b, c] = [g.indices[t], g.indices[t + 1], g.indices[t + 2]];
    const face = cross(sub(g.positions[b], g.positions[a]), sub(g.positions[c], g.positions[a]));
    if (length(face) < 1e-13) continue;
    const n = add(add(g.normals[a], g.normals[b]), g.normals[c]);
    if (Math.sign(dot(face, n)) !== winding) [b, c] = [c, b];
    indices.push(a, b, c);
  }
  return { ...g, indices };
}

/**
 * Place and shape one piece from its vanilla calibration and choose its anchor head vertex:
 * - a ring keeps the vanilla ring's centre, plane and centreline radius, with this piece's own wire; its anchor is the head
 *   vertex nearest the ring's centreline (where the ring passes through the skin);
 * - a stud sits on the head vertex nearest the (mirrored) vanilla nostril piece whose normal faces most outward to that side,
 *   centred on the skin along that vertex's normal; the anchor is that vertex.
 */
export function solvePiece(spec: PieceSpec, head: DecodedChunk, bank: DecodedChunk, winding: 1 | -1): SolvedPiece {
  const { points, ...calibration } = calibrate(bank, spec);
  const centre = scale(calibration.centreMm, 1e-3) as V3, axis = calibration.axis;
  let geometry: Geometry, anchor: SolvedPiece["anchor"];
  if (spec.shape.kind === "ring") {
    const radius = calibration.radiusMm / 1000, [e1, e2] = ringFrame(axis);
    const line = Array.from({ length: 720 }, (_, i) => {
      const theta = 2 * Math.PI * i / 720;
      return add(centre, scale(add(scale(e1, Math.cos(theta)), scale(e2, Math.sin(theta))), radius));
    });
    let best = -1, bestDistance = Infinity;
    head.positions.forEach((p, v) => {
      if (Math.abs(p[0] - centre[0]) > 0.03 || Math.abs(p[1] - centre[1]) > 0.03 || Math.abs(p[2] - centre[2]) > 0.03) return;
      for (const q of line) { const d = length(sub(p, q)); if (d < bestDistance) { bestDistance = d; best = v; } }
    });
    if (best < 0) throw Error(`No head vertex lies near the ${spec.site} site.`);
    geometry = torus(centre, axis, radius, spec.shape.wireMm / 2000, spec.shape.segments, spec.shape.tubeSides);
    anchor = { vertex: best, positionMm: head.positions[best].map(mm) as V3, normal: head.normals[best].map(v => Math.round(v * 1e4) / 1e4) as V3,
      distanceMm: mm(bestDistance), rule: "head vertex nearest the ring's centreline" };
  } else {
    const side = Math.sign(centre[0]) || 1;
    const near = head.positions.map((p, v) => ({ v, d: Math.min(...points.map(q => length(sub(p, q)))) }))
      .filter(item => item.d < 0.0025).sort((x, y) => x.d - y.d);
    const pool = near.length ? near : head.positions.map((p, v) => ({ v, d: length(sub(p, centre)) })).sort((x, y) => x.d - y.d).slice(0, 5);
    const chosen = pool.reduce((best, item) => head.normals[item.v][0] * side > head.normals[best.v][0] * side ? item : best, pool[0]);
    const at = head.positions[chosen.v], normal = head.normals[chosen.v];
    geometry = stud(at, normal, spec.shape.diameterMm / 2000, spec.shape.heightMm / 1000, spec.shape.rings, spec.shape.segments);
    anchor = { vertex: chosen.v, positionMm: at.map(mm) as V3, normal: normal.map(v => Math.round(v * 1e4) / 1e4) as V3, distanceMm: 0,
      rule: `head vertex within 2.5 mm of the ${spec.calibration.mirror ? "mirrored " : ""}vanilla piece whose normal faces most to V's ${side < 0 ? "left" : "right"}` };
  }
  geometry = orient(geometry, winding);
  const min = [0, 1, 2].map(k => Math.min(...geometry.positions.map(p => p[k]))) as V3;
  const max = [0, 1, 2].map(k => Math.max(...geometry.positions.map(p => p[k]))) as V3;
  return { spec, calibration, anchor, geometry, boundsMm: { min: min.map(mm) as V3, max: max.map(mm) as V3 } };
}

// ---------------------------------------------------------------------------------------------------------------
// Piece resources

/**
 * The piece's render blob: the head blob's header and bones with this piece's vertices in the head's quantization.
 * Stream layout = the head's minus DROP_USAGES (the eye plate's layout; vertex factory 4). Skin bytes are the anchor's.
 */
export function pieceRenderBlob(headBlob: WkJson, head: DecodedChunk, piece: SolvedPiece): WkJson {
  const header = headBlob.header, chunk = header.renderChunkInfos[0];
  const layout = chunk.chunkVertices.vertexLayout;
  const kept = head.elements.filter(e => !(DROP_USAGES as readonly string[]).includes(e.usage));
  const q = AXES.map(axis => Number(header.quantizationScale[axis])), o = AXES.map(axis => Number(header.quantizationOffset[axis]));
  const g = piece.geometry, count = g.positions.length;
  if (count > 65535) throw Error("A piece exceeds the 16-bit index range.");
  const skin = new Map(SKIN_ELEMENTS.map(([usage, index]) => [`${usage}/${index}`, elementBytes(headBlob, head, piece.anchor.vertex, usage, index)]));
  const positionW = elementBytes(headBlob, head, piece.anchor.vertex, "PS_Position").readInt16LE(6);
  const streams = [...new Set(head.elements.map(e => e.stream))].sort((a, b) => a - b);
  const strides = [...layout.slotStrides.Elements as number[]], offsets = (chunk.chunkVertices.byteOffsets.Elements as number[]).map(() => 0);
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const stream of streams) {
    const inStream = kept.filter(e => e.stream === stream), stride = inStream.reduce((sum, e) => sum + e.size, 0);
    strides[stream] = stride;
    if (!stride) continue;
    const start = align16(cursor);
    if (start > cursor) parts.push(Buffer.alloc(start - cursor));
    offsets[stream] = start;
    const block = Buffer.alloc(stride * count);
    for (let v = 0; v < count; v++) {
      let at = v * stride;
      for (const e of inStream) {
        const key = `${e.usage}/${e.usageIndex}`;
        if (e.usage === "PS_Position") {
          for (let k = 0; k < 3; k++) {
            const normalised = (g.positions[v][k] - o[k]) / q[k];
            if (Math.abs(normalised) > 1) throw Error(`${piece.spec.id} leaves the head's position range.`);
            block.writeInt16LE(Math.round(normalised * 32767), at + k * 2);
          }
          block.writeInt16LE(positionW, at + 6);
        } else if (skin.has(key)) skin.get(key)!.copy(block, at);
        else if (e.usage === "PS_TexCoord" && e.type === "PT_Float16_2") {
          const [u, w] = e.usageIndex === 0 ? g.uvs[v] : [0, 0];
          block.writeUInt16LE(toHalf(u), at); block.writeUInt16LE(toHalf(w), at + 2);
        } else if (e.usage === "PS_Normal" && e.type === "PT_Dec4") block.writeUInt32LE(encodeDec4(g.normals[v], 1), at);
        else if (e.usage === "PS_Tangent" && e.type === "PT_Dec4") block.writeUInt32LE(encodeDec4(g.tangents[v], 0), at);
        else if (e.usage === "PS_Color" && e.type === "PT_Color") block.writeUInt32LE(0, at);
        else throw Error(`No piece value for vertex element ${key} (${e.type}).`);
        at += e.size;
      }
    }
    parts.push(block);
    cursor = start + block.length;
  }
  const vertexBufferSize = cursor, indexBufferOffset = align16(vertexBufferSize);
  const indices = Buffer.alloc(g.indices.length * 2);
  g.indices.forEach((index, i) => indices.writeUInt16LE(index, i * 2));
  const blob = structuredClone(headBlob);
  const out = blob.header, outChunk = out.renderChunkInfos[0], outLayout = outChunk.chunkVertices.vertexLayout;
  outLayout.elements.Elements = layout.elements.Elements.filter((e: WkJson) => !(DROP_USAGES as readonly string[]).includes(e.usage));
  outLayout.slotStrides.Elements = strides;
  outLayout.slotMask = strides.reduce((mask, stride, stream) => stride > 0 ? mask | (1 << stream) : mask, 0);
  outLayout.hash = 0; // WolvenKit writes zero for a layout it rebuilt; the eye plate ships the same way.
  outChunk.chunkVertices.byteOffsets.Elements = offsets;
  outChunk.numVertices = count;
  outChunk.numIndices = g.indices.length;
  outChunk.vertexFactory = VERTEX_FACTORY;
  out.vertexBufferSize = vertexBufferSize;
  out.indexBufferOffset = indexBufferOffset;
  out.indexBufferSize = indices.length;
  // Head topology/micromap/custom data describe the head's own triangles; a piece has none (as the vanilla banks).
  if (Array.isArray(out.topology)) out.topology = out.topology.map(() => ({ $type: "rendTopologyData", data: [], dataStride: 0, metadata: [], metadataStride: 0 }));
  for (const key of ["topologyData", "topologyMetadata", "opacityMicromaps", "customData"]) if (Array.isArray(out[key])) out[key] = [];
  blob.renderBuffer.Bytes = Buffer.concat([...parts, Buffer.alloc(indexBufferOffset - vertexBufferSize), indices]).toString("base64");
  return blob;
}

const vector4 = (v: V3, w: number) => ({ $type: "Vector4", W: w, X: v[0], Y: v[1], Z: v[2] });
const document = (source: WkJson, root: WkJson) => ({
  Header: { WolvenKitVersion: source.Header.WolvenKitVersion, WKitJsonVersion: source.Header.WKitJsonVersion,
    GameVersion: source.Header.GameVersion, DataType: source.Header.DataType },
  Data: { Version: source.Data.Version, BuildVersion: source.Data.BuildVersion, RootChunk: root, EmbeddedFiles: [] },
});
/** A vanilla-shaped local instance whose base is a vanilla piercing `.mi` (referenced, never shipped). */
const vanillaFinish = (finish: Finish) => ({ $type: "CMaterialInstance", audioTag: cname("None"), baseMaterial: resourceRef(MATERIALS[finish]),
  cookingPlatform: "PLATFORM_None", enableMask: 0, metadata: null, resourceVersion: 4, values: [] });
export const FINISHES: readonly Finish[] = ["silver", "gold"];

/** Piece mesh: the head's root (bones, rig, LOD info), the piece blob, one mesh appearance per vanilla finish. */
export function pieceMeshDocument(headMesh: WkJson, blob: WkJson, piece: SolvedPiece): WkJson {
  const source = headMesh.Data.RootChunk;
  if (source.$type !== "CMesh") throw Error("The head mesh resource has an unexpected type.");
  const root = { ...source };
  root.appearances = FINISHES.map((finish, i) => ({ HandleId: String(i), Data: { $type: "meshMeshAppearance", chunkMaterials: [cname(finish)], name: cname(finish), tags: [] } }));
  root.materialEntries = FINISHES.map((finish, index) => ({ $type: "CMeshMaterialEntry", index, isLocalInstance: 1, name: cname(finish) }));
  root.localMaterialBuffer = { ...source.localMaterialBuffer, materials: FINISHES.map(vanillaFinish), rawData: null, rawDataHeaders: [] };
  root.parameters = [];
  root.inplaceResources = [];
  for (const key of ["externalMaterials", "preloadExternalMaterials", "preloadLocalMaterialInstances", "localMaterialInstances"])
    if (key in root) root[key] = [];
  // A tight box (plus 10 mm for morph travel), like the vanilla banks; a hash of the piece's own bytes, never the head's.
  const margin = 10;
  root.boundingBox = { $type: "Box", Min: vector4(piece.boundsMm.min.map(v => (v - margin) / 1000) as V3, 1), Max: vector4(piece.boundsMm.max.map(v => (v + margin) / 1000) as V3, 1) };
  root.geometryHash = createHash("sha256").update(blob.renderBuffer.Bytes).digest().readBigUInt64LE(0).toString();
  root.renderResourceBlob = { HandleId: String(FINISHES.length), Data: blob };
  return document(headMesh, root);
}

export interface AnchorRows { target: number; name: string; region: string; row: Buffer }
/** The anchor vertex's diff row in each head target that moves it (the head's quantization applies). */
export function anchorRows(headMorph: WkJson, vertex: number): AnchorRows[] {
  const root = headMorph.Data.RootChunk, blob = root.blob.Data, header = blob.header;
  const diffs = Buffer.from(blob.diffsBuffer.Bytes, "base64"), mapping = Buffer.from(blob.mappingBuffer.Bytes, "base64");
  const rows: AnchorRows[] = [];
  for (let t = 0; t < header.numTargets; t++) {
    const counts: number[] = header.numVertexDiffsInEachChunk[t];
    if (counts.length !== 1) throw Error("The head morph uses an unsupported chunk layout.");
    const d0 = header.targetStartsInVertexDiffs[t], m0 = header.targetStartsInVertexDiffsMapping[t] * 4;
    for (let i = 0; i < counts[0]; i++) if (mapping.readUInt16LE(m0 + i * 2) === vertex) {
      rows.push({ target: t, name: root.targets[t].name.$value, region: root.targets[t].regionName.$value, row: Buffer.from(diffs.subarray((d0 + i) * 12, (d0 + i + 1) * 12)) });
      break;
    }
  }
  return rows;
}
/** Decoded position delta of a diff row under target `t`'s quantization, in metres. */
export function rowDelta(header: WkJson, t: number, row: Buffer): V3 {
  const word = row.readUInt32LE(0);
  return AXES.map((axis, k) => ((word >>> (10 * k)) & 0x3ff) / 1023 * Number(header.targetPositionDiffScale[t][axis]) + Number(header.targetPositionDiffOffset[t][axis])) as V3;
}

/**
 * Piece morph target: the head's targets (all, or only `regions`), each carrying the anchor's position delta on every piece
 * vertex that the head moves at the anchor, with neutral normal/tangent deltas; base blob = the piece mesh's blob.
 */
export function pieceMorphDocument(headMorph: WkJson, blob: WkJson, piece: SolvedPiece, spec: MorphSpec): WkJson {
  const source = headMorph.Data.RootChunk;
  if (source.$type !== "MorphTargetMesh") throw Error("The head morph resource has an unexpected type.");
  const header = source.blob.Data.header;
  const keep = source.targets.map((t: WkJson, i: number) => ({ t, i }))
    .filter(({ t }: { t: WkJson }) => spec.regions === "all" || spec.regions.includes(t.regionName.$value)).map(({ i }: { i: number }) => i) as number[];
  const byTarget = new Map(anchorRows(headMorph, piece.anchor.vertex).map(r => [r.target, r.row]));
  const count = piece.geometry.positions.length, outDiffs: Buffer[] = [], outMaps: Buffer[] = [];
  const perDiffs: number[] = [], perMaps: number[] = [];
  for (const t of keep) {
    const row = byTarget.get(t);
    if (!row) { perDiffs.push(0); perMaps.push(0); continue; }
    const out = Buffer.alloc(12);
    out.writeUInt32LE(row.readUInt32LE(0), 0);
    out.writeUInt32LE(NEUTRAL_DELTA_WORD, 4);
    out.writeUInt32LE(NEUTRAL_DELTA_WORD, 8);
    for (let v = 0; v < count; v++) outDiffs.push(out);
    const padded = count % 2 ? count + 1 : count, map = Buffer.alloc(padded * 2);
    for (let v = 0; v < count; v++) map.writeUInt16LE(v, v * 2);
    outMaps.push(map);
    perDiffs.push(count); perMaps.push(padded / 2);
  }
  let diffStart = 0, mapStart = 0;
  const outHeader = {
    ...header,
    numTargets: keep.length,
    numVertexDiffsInEachChunk: perDiffs.map(value => [value]),
    numVertexDiffsMappingInEachChunk: perMaps.map(value => [value]),
    targetStartsInVertexDiffs: perDiffs.map(value => { const start = diffStart; diffStart += value; return start; }),
    targetStartsInVertexDiffsMapping: perMaps.map(value => { const start = mapStart; mapStart += value; return start; }),
    targetPositionDiffOffset: keep.map(t => header.targetPositionDiffOffset[t]),
    targetPositionDiffScale: keep.map(t => header.targetPositionDiffScale[t]),
    // Head skin-normal texture deltas address the head's normal atlas; a piece has none (as the vanilla banks and the plate).
    targetTextureDiffsData: keep.map(() => ({ $type: "rendRenderMorphTargetMeshBlobTextureData",
      ...Object.fromEntries(["targetDiffOffset", "targetDiffScale", "targetDiffsDataOffset", "targetDiffsDataSize",
        "targetDiffsMipLevelCounts", "targetDiffsWidth"].map(key => [key, { Elements: [] }])) })),
  };
  outHeader.numDiffs = diffStart;
  outHeader.numDiffsMapping = mapStart;
  // The base blob is the piece mesh's blob; buffer IDs stay the morph resource's own (they are per-file references).
  const headBase = source.blob.Data.baseBlob;
  const base = { ...headBase, Data: { ...headBase.Data, header: blob.header, renderBuffer: { ...headBase.Data.renderBuffer, Bytes: blob.renderBuffer.Bytes } } };
  const outBlob = { ...source.blob.Data, header: outHeader, baseBlob: base,
    diffsBuffer: { ...source.blob.Data.diffsBuffer, Bytes: Buffer.concat(outDiffs).toString("base64") },
    mappingBuffer: { ...source.blob.Data.mappingBuffer, Bytes: Buffer.concat(outMaps).toString("base64") }, textureDiffsBuffer: null };
  const root = { ...source, baseMesh: resourceRef(meshPath(spec.piece)), baseMeshAppearance: cname("silver"),
    baseTexture: resourceRef("engine\\textures\\editor\\normal.xbm"), targets: keep.map(t => source.targets[t]),
    blob: { ...source.blob, Data: outBlob } };
  return document(headMorph, root);
}

// ---------------------------------------------------------------------------------------------------------------
// Creator resources

/** The chunk mask the runtime-proven XF Eye Artistry component uses (every chunk of a one-chunk mesh). */
const FULL_CHUNK_MASK = "9223372036854775807";
const cr2w = (root: WkJson) => ({
  Header: { WolvenKitVersion: "8.17.4", WKitJsonVersion: "0.0.9", GameVersion: 2310, DataType: "CR2W" },
  Data: { Version: 195, BuildVersion: 0, RootChunk: root, EmbeddedFiles: [] },
});

/** One row's `.app`: an Off appearance that draws nothing, then one appearance per look with one component per part. */
export function appDocument(row: Row): WkJson {
  const handles = new HandleCounter();
  const off = { $type: "appearanceAppearanceDefinition", name: cname(row.off), components: [],
    partsOverrides: [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: [] }] };
  const looks = row.looks.map(look => {
    const components = look.parts.map(part => ({ $type: "entMorphTargetSkinnedMeshComponent", name: cname(componentName(part)),
      id: componentId(componentName(part)), isEnabled: 1, version: 1, autoHideDistance: 50, chunkMask: FULL_CHUNK_MASK, forceLODLevel: -1,
      meshAppearance: cname(part.finish), morphResource: resourceRef(morphPath(part.morph)),
      parentTransform: handles.handle({ $type: "entHardTransformBinding", bindName: cname("root"), enabled: 1 }),
      skinning: handles.handle({ $type: "entSkinningBinding", bindName: cname("root"), enabled: 1 }) }));
    return { $type: "appearanceAppearanceDefinition", name: cname(look.name), components,
      partsOverrides: [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: look.parts.map(part => ({
        $type: "appearancePartComponentOverrides", componentName: cname(componentName(part)), meshAppearance: cname(part.finish),
        chunkMask: FULL_CHUNK_MASK, visualScale: { $type: "Vector3", X: 1, Y: 1, Z: 1 } })) }],
      resolvedDependencies: [...new Set(look.parts.map(part => part.morph))].map(stem => resourceRef(morphPath(stem), true)),
      visualTags: { $type: "redTagList", tags: [cname("Female")] } };
  });
  return cr2w({ $type: "appearanceAppearanceResource", cookingPlatform: "PLATFORM_PC",
    appearances: [off, ...looks].map(definition => handles.handle(definition)) });
}

/** The female creator resource: one appearance option per row (Off first), both in `face` and `character_customization`. */
export function customizationDocument(): WkJson {
  const handles = new HandleCounter();
  const options = ROWS.map(row => handles.handle({ $type: "gameuiAppearanceInfo", name: cname(row.option), uiSlot: cname(row.option),
    localizedName: row.label, enabled: 1, hidden: 0, index: row.index, defaultIndex: 0,
    editTags: ["NewGame", "HairDresser", "Ripperdoc"], randomizeCategory: "FaceModification", useThumbnails: 0,
    resource: resourceRef(row.app, true), definitions: [
      { $type: "gameuiIndexedAppearanceDefinition", name: cname(row.off), index: 0, localizedName: "Common-Off" },
      ...row.looks.map((look, i) => ({ $type: "gameuiIndexedAppearanceDefinition", name: cname(look.name), index: i + 1, localizedName: look.label })),
    ] }));
  return cr2w({ $type: "gameuiCharacterCustomizationInfoResource", cookingPlatform: "PLATFORM_PC", headCustomizationOptions: options,
    headGroups: GROUPS.map(group => ({ $type: "gameuiOptionsGroup", name: cname(group), options: ROWS.map(row => cname(row.option)) })) });
}

/** The `.archive.xl`: the female creator resource only (no scope, fix, patch, copy or link). */
export const xlText = () => archiveXlText({ customizations: { female: [CUSTOMIZATION] } });

/** Compact JSON with non-ASCII escaped, as the Studio's resource builder writes it. */
export const resourceJson = (value: unknown) =>
  JSON.stringify(value).replace(/[\u0080-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";
