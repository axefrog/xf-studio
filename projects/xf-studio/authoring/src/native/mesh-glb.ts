/**
 * A mesh or morph target resource as the GLB the preview has always been served: WolvenKit 9.0.1's `uncook` export (`MeshOnly`, the
 * LOD filter on, garment support on, no materials), rebuilt from the decoded render blob (mesh-blob.ts, morph-blob.ts). Pure.
 * knowledge/archive-format.md §11 lists the conventions with their evidence; tools/native-mesh-oracle.ts compares the result with
 * WolvenKit's GLBs vertex for vertex.
 *
 * Conventions (WolvenKit's, studied as documentation in its `MeshTools`, `MorphTargetTools` and `RigTools`, and checked against its
 * output; no code is taken from it):
 * - **Chunks.** Only chunks whose `lodMask` is exactly 1 are exported, one glTF mesh and node each, named `submesh_NN_LOD_1` by chunk
 *   index (the preview's `chunkOfMesh` reads it). A chunk whose first triangle recurs later (a double-sided copy) keeps only the
 *   triangles whose face normal points against its vertices' mean normal, and its name gains `_doubled`.
 * - **Space.** Z-up left-handed to Y-up right-handed: (x, y, z) → (x, z, −y) for positions, normals, tangents, bone translations,
 *   rotations and deltas; triangle winding swapped (i1, i0, i2). Normals and tangents are normalised after the swap; a tangent's w is
 *   1, −1 or 0 from its top two bits.
 * - **UVs.** The first set flipped (v → 1 − v), the second as stored. Colours as bytes / 255.
 * - **Skin.** Joints and weights in sets of four (JOINTS_0/WEIGHTS_0, then _1); weights bytes / 255, renormalised to sum 1 (a vertex
 *   weighing nothing is bound to joint 0). The joints are the mesh's bones (a morph target's: its base mesh's), one node each under an
 *   `Armature` node, placed at the inverse of the bone's rig matrix; the count is `bonePositions`' (the joints the rig matrices give
 *   when the file lists fewer positions than its skin addresses).
 * - **Garment support.** A chunk with a garment-support offset gets it as the morph target `GarmentSupport`, and a mesh with garment
 *   flags gets `_GARMENTSUPPORTWEIGHT` and `_GARMENTSUPPORTCAP` (x = weight / 255 and cap, w = 1).
 * - **Morph targets.** One glTF target per morph target, named `<name>_<region>` in `extras.targetNames`: position, normal and tangent
 *   deltas. They are written sparse (the vertices a target moves), with the same values WolvenKit writes densely.
 * - `extras.materialNames` lists each mesh appearance's material for the chunk (a short list repeats its tail, as WolvenKit fills it).
 *
 * The arithmetic is single precision at every step, so the vertex data is bit-identical to WolvenKit's; the joints' transforms and
 * inverse bind matrices are computed in double precision and differ from WolvenKit's by float rounding (oracle: §11.4).
 */
import { GlbWriter, type GltfJson } from "../glb";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { arrayOf, decodeChunk, DEFAULT_MESH_LIMITS, fieldOf, meshBlob, type DecodedChunk, type MeshBlob, type MeshLimits, nameText, objectAt, vector4 } from "./mesh-blob";
import { chunkDeltas, morphTargetLayout } from "./morph-blob";
import { RedBuffer, type RedDocument, type RedObject } from "./red-model";

const f = Math.fround;

/** A mesh's bones as WolvenKit places them: names and, per joint, translation and rotation in glTF space. */
export interface MeshRig { readonly names: readonly string[]; readonly translations: Float32Array; readonly rotations: Float32Array }

export interface NativeGeometry {
  readonly glb: Uint8Array;
  /** Meshes (LOD 1 chunks) written, their vertices and the morph targets per mesh. */
  readonly meshes: number;
  readonly vertices: number;
  readonly targets: number;
  readonly joints: number;
  /** Plain lines on what the reader did differently from reading the file as it stands (the joint count taken from the rig). */
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rig

/** A `Matrix` struct (rows X, Y, Z, W; System.Numerics row-vector layout) as 16 doubles, row-major. */
function matrixOf(value: unknown): number[] | null {
  const object = objectAt(value);
  if (!object) return null;
  return ["X", "Y", "Z", "W"].flatMap(row => vector4(fieldOf(object, row)));
}

/** Inverse of a 4×4 row-major matrix, or null when it is singular. */
function invert4(m: readonly number[]): number[] | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m as number[];
  const b00 = a00! * a11! - a01! * a10!, b01 = a00! * a12! - a02! * a10!, b02 = a00! * a13! - a03! * a10!, b03 = a01! * a12! - a02! * a11!;
  const b04 = a01! * a13! - a03! * a11!, b05 = a02! * a13! - a03! * a12!, b06 = a20! * a31! - a21! * a30!, b07 = a20! * a32! - a22! * a30!;
  const b08 = a20! * a33! - a23! * a30!, b09 = a21! * a32! - a22! * a31!, b10 = a21! * a33! - a23! * a31!, b11 = a22! * a33! - a23! * a32!;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const d = 1 / det;
  return [
    (a11! * b11 - a12! * b10 + a13! * b09) * d, (a02! * b10 - a01! * b11 - a03! * b09) * d, (a31! * b05 - a32! * b04 + a33! * b03) * d, (a22! * b04 - a21! * b05 - a23! * b03) * d,
    (a12! * b08 - a10! * b11 - a13! * b07) * d, (a00! * b11 - a02! * b08 + a03! * b07) * d, (a32! * b02 - a30! * b05 - a33! * b01) * d, (a20! * b05 - a22! * b02 + a23! * b01) * d,
    (a10! * b10 - a11! * b08 + a13! * b06) * d, (a01! * b08 - a00! * b10 - a03! * b06) * d, (a30! * b04 - a31! * b02 + a33! * b00) * d, (a21! * b02 - a20! * b04 - a23! * b00) * d,
    (a11! * b07 - a10! * b09 - a12! * b06) * d, (a00! * b09 - a01! * b07 + a02! * b06) * d, (a31! * b01 - a30! * b03 - a32! * b00) * d, (a20! * b03 - a21! * b01 + a22! * b00) * d,
  ];
}

/** The rotation of a row-vector matrix as a unit quaternion (x, y, z, w), by the usual largest-diagonal method. */
function quaternionOf(m: readonly number[]): [number, number, number, number] {
  const m11 = m[0]!, m12 = m[1]!, m13 = m[2]!, m21 = m[4]!, m22 = m[5]!, m23 = m[6]!, m31 = m[8]!, m32 = m[9]!, m33 = m[10]!;
  let x: number, y: number, z: number, w: number;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1), inv = 0.5 / s;
    w = s * 0.5; x = (m23 - m32) * inv; y = (m31 - m13) * inv; z = (m12 - m21) * inv;
  } else if (m11 >= m22 && m11 >= m33) {
    const s = Math.sqrt(1 + m11 - m22 - m33), inv = 0.5 / s;
    x = 0.5 * s; y = (m12 + m21) * inv; z = (m13 + m31) * inv; w = (m23 - m32) * inv;
  } else if (m22 > m33) {
    const s = Math.sqrt(1 + m22 - m11 - m33), inv = 0.5 / s;
    x = (m21 + m12) * inv; y = 0.5 * s; z = (m32 + m23) * inv; w = (m31 - m13) * inv;
  } else {
    const s = Math.sqrt(1 + m33 - m11 - m22), inv = 0.5 / s;
    x = (m31 + m13) * inv; y = (m32 + m23) * inv; z = 0.5 * s; w = (m12 - m21) * inv;
  }
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

/**
 * The rig of a `CMesh` with render blob `blob`: one joint per `bonePositions` entry (or per bone name when the skin addresses more
 * joints than positions and the names cover them: `needed`), each at the inverse of its rig matrix, else at its stored position
 * unrotated. Null when the mesh lists no bone positions. The note says when the count came from the names.
 */
export function meshRig(mesh: RedObject, blob: MeshBlob, needed = 0): { rig: MeshRig | null; note: string | null } {
  const names = arrayOf(fieldOf(mesh, "boneNames")).map(nameText);
  const matrices = arrayOf(fieldOf(mesh, "boneRigMatrices"));
  let count = blob.bonePositions.length, note: string | null = null;
  if (needed > count && names.length > count && needed <= names.length) {
    note = `its render data lists ${count} bone position${count === 1 ? "" : "s"} for ${names.length} bones, so the other ${names.length - count} joints are placed from the bones' own rig matrices`;
    count = names.length;
  }
  if (!count) return { rig: null, note: null };
  if (names.length < count) throw new NativeMalformedError(`The mesh lists ${count} bone positions but names ${names.length} bones.`);
  const translations = new Float32Array(count * 3), rotations = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const matrix = i < matrices.length ? matrixOf(matrices[i]) : null;
    const inverse = matrix ? invert4(matrix.map(f)) : null;
    if (inverse) {
      const [qx, qy, qz, qw] = quaternionOf(inverse);
      translations.set([inverse[12]!, inverse[14]!, -inverse[13]!], i * 3);
      rotations.set([qx, qz, -qy, qw], i * 4);
    } else {
      const position = blob.bonePositions[i] ?? [0, 0, 0, 1];
      translations.set([position[0], position[2], -position[1]], i * 3);
      rotations.set([0, 0, 0, 1], i * 4);
    }
  }
  return { rig: { names: names.slice(0, count), translations, rotations }, note };
}

/** Inverse bind matrices (column-major glTF order) of joints at `rig`'s transforms: the inverse of each joint's rotation and translation. */
function inverseBindMatrices(rig: MeshRig): Float32Array {
  const count = rig.names.length, out = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const [x, y, z, w] = rig.rotations.subarray(i * 4, i * 4 + 4) as unknown as number[];
    const [tx, ty, tz] = rig.translations.subarray(i * 3, i * 3 + 3) as unknown as number[];
    // Rotation matrix R (column-vector convention); the inverse of [R | t] is [Rᵀ | −Rᵀt].
    const r = [
      [1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)],
      [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)],
      [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)],
    ];
    const o = i * 16;
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) out[o + col * 4 + row] = r[col]![row]!; // (Rᵀ)[row][col] = R[col][row]
    for (let row = 0; row < 3; row++) out[o + 12 + row] = -(r[0]![row]! * tx! + r[1]![row]! * ty! + r[2]![row]! * tz!);
    out[o + 15] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chunks in glTF space

interface GltfChunk {
  name: string;
  chunk: number;
  positions: Float32Array;
  normals: Float32Array | null;
  tangents: Float32Array | null;
  colors: Float32Array | null;
  uv0: Float32Array | null;
  uv1: Float32Array | null;
  /** Influences written: 0, 4 or 8. */
  influences: number;
  joints: Uint16Array;
  weights: Float32Array;
  garmentMorph: Float32Array | null;
  garmentWeight: Float32Array | null;
  garmentCap: Float32Array | null;
  /** Triangle indices in file order (after the double-sided filter); written with the winding swapped. */
  indices: Uint16Array;
}

/** (x, y, z) → normalize(x, z, −y) in single precision, as System.Numerics does it (|v| = √((x² + y²) + z²), then each / |v|). */
function swapNormalize(x: number, y: number, z: number, out: Float32Array, at: number): void {
  const a = x, b = z, c = f(-y);
  const length = f(Math.sqrt(f(f(f(a * a) + f(b * b)) + f(c * c))));
  out[at] = f(a / length); out[at + 1] = f(b / length); out[at + 2] = f(c / length);
}

function toGltf(decoded: DecodedChunk, garment: boolean): GltfChunk {
  const n = decoded.chunk.numVertices;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = decoded.positions[i * 3]!; positions[i * 3 + 1] = decoded.positions[i * 3 + 2]!; positions[i * 3 + 2] = f(-decoded.positions[i * 3 + 1]!);
  }
  let normals: Float32Array | null = null, tangents: Float32Array | null = null;
  if (decoded.normals) {
    normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) swapNormalize(decoded.normals[i * 4]!, decoded.normals[i * 4 + 1]!, decoded.normals[i * 4 + 2]!, normals, i * 3);
  }
  if (decoded.tangents) {
    tangents = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      swapNormalize(decoded.tangents[i * 4]!, decoded.tangents[i * 4 + 1]!, decoded.tangents[i * 4 + 2]!, tangents, i * 4);
      tangents[i * 4 + 3] = decoded.tangents[i * 4 + 3]!;
    }
  }
  let colors: Float32Array | null = null;
  if (decoded.colors) { colors = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) colors[i] = f(decoded.colors[i]! / 255); }
  const [first, second] = decoded.uvs;
  let uv0: Float32Array | null = null;
  if (first) { uv0 = new Float32Array(first); for (let i = 1; i < uv0.length; i += 2) uv0[i] = f(f(uv0[i]! * -1) + 1); }
  const uv1 = second ? new Float32Array(second) : null;
  // Skin: bytes / 255, renormalised in single precision; a vertex weighing nothing is bound wholly to joint 0.
  const k = decoded.influences, influences = k >= 8 ? 8 : k >= 4 ? 4 : 0;
  const joints = new Uint16Array(n * influences), weights = new Float32Array(n * influences);
  const row = new Float32Array(k);
  for (let i = 0; i < n && k; i++) {
    let sum = 0;
    for (let e = 0; e < k; e++) { row[e] = f(decoded.weights[i * k + e]! / 255); sum = f(sum + row[e]!); }
    const first = decoded.joints[i * k]!;
    let joint0 = first;
    if (sum === 0) { joint0 = 0; row[0] = 1; sum = 1; }
    const scale = f(1 / sum);
    for (let e = 0; e < influences; e++) {
      joints[i * influences + e] = e === 0 ? joint0 : decoded.joints[i * k + e]!;
      weights[i * influences + e] = f(row[e]! * scale);
    }
  }
  let garmentMorph: Float32Array | null = null;
  if (garment && decoded.extra) {
    garmentMorph = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      garmentMorph[i * 3] = decoded.extra[i * 3]!; garmentMorph[i * 3 + 1] = decoded.extra[i * 3 + 2]!; garmentMorph[i * 3 + 2] = f(-decoded.extra[i * 3 + 1]!);
    }
  }
  return { name: `submesh_${String(decoded.chunk.index).padStart(2, "0")}_LOD_${decoded.chunk.lodMask}`, chunk: decoded.chunk.index, positions, normals, tangents,
    colors, uv0, uv1, influences, joints, weights, garmentMorph, garmentWeight: null, garmentCap: null, indices: removeDoubleFaces(decoded, positions, normals) };
}

/** Normalize(x, y, z) in single precision (as `swapNormalize`, without the swap). */
function normalized(x: number, y: number, z: number): [number, number, number] {
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  return [f(x / length), f(y / length), f(z / length)];
}

/**
 * A double-sided chunk (its first triangle's vertices recur in a later triangle) keeps only the triangles whose face normal, in file
 * winding, points against the mean of their vertices' normals; any other chunk keeps all. The result is the chunk's indices to write.
 */
function removeDoubleFaces(decoded: DecodedChunk, positions: Float32Array, normals: Float32Array | null): Uint16Array & { doubled?: boolean } {
  const indices = decoded.indices;
  if (indices.length < 3 || !normals) return indices;
  const [i0, i1, i2] = [indices[0]!, indices[1]!, indices[2]!];
  let doubled = false;
  for (let j = 3; j < indices.length && !doubled; j += 3) {
    const a = indices[j]!, b = indices[j + 1]!, c = indices[j + 2]!;
    doubled = (i0 === a || i0 === b || i0 === c) && (i1 === a || i1 === b || i1 === c) && (i2 === a || i2 === b || i2 === c);
  }
  if (!doubled) return indices;
  const kept: number[] = [];
  const p = (v: number, k: number) => positions[v * 3 + k]!, q = (v: number, k: number) => normals[v * 3 + k]!;
  for (let j = 0; j < indices.length; j += 3) {
    const v0 = indices[j]!, v1 = indices[j + 1]!, v2 = indices[j + 2]!;
    const ax = f(p(v1, 0) - p(v0, 0)), ay = f(p(v1, 1) - p(v0, 1)), az = f(p(v1, 2) - p(v0, 2));
    const bx = f(p(v2, 0) - p(v1, 0)), by = f(p(v2, 1) - p(v1, 1)), bz = f(p(v2, 2) - p(v1, 2));
    const cross = normalized(f(f(ay * bz) - f(az * by)), f(f(az * bx) - f(ax * bz)), f(f(ax * by) - f(ay * bx)));
    const mean = normalized(f(f(f(q(v0, 0) + q(v1, 0)) + q(v2, 0)) / 3), f(f(f(q(v0, 1) + q(v1, 1)) + q(v2, 1)) / 3), f(f(f(q(v0, 2) + q(v1, 2)) + q(v2, 2)) / 3));
    const dot = f(f(f(cross[0] * mean[0]) + f(cross[1] * mean[1])) + f(cross[2] * mean[2]));
    if (dot <= 0) kept.push(v0, v1, v2);
  }
  return Object.assign(Uint16Array.from(kept), { doubled: true });
}

/** The chunk's indices checked against its vertex count (an index past it would make an invalid GLB). */
function checkIndices(chunk: GltfChunk): void {
  const n = chunk.positions.length / 3;
  for (const index of chunk.indices) if (index >= n) throw new NativeMalformedError(`Chunk ${chunk.chunk} has an index (${index}) past its ${n} vertices.`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Writing

/** The appearance material names WolvenKit writes per chunk: each appearance's list padded to every chunk by repeating its tail. */
function materialNames(mesh: RedObject, chunkCount: number): string[][] {
  const lists: string[][] = [];
  for (const value of arrayOf(fieldOf(mesh, "appearances"))) {
    const appearance = objectAt(value);
    if (!appearance) continue;
    const list = arrayOf(fieldOf(appearance, "chunkMaterials")).map(nameText);
    if (!list.length) list.push("default");
    let start = list.indexOf(list[list.length - 1]!) + 1;
    if (start >= list.length) start = 0;
    while (list.length < chunkCount) list.push(list[start++]!);
    lists.push(list);
  }
  return lists;
}

function estimateBytes(chunks: readonly { numVertices: number; numIndices: number }[], perVertex: number): number {
  return chunks.reduce((sum, chunk) => sum + chunk.numVertices * perVertex + chunk.numIndices * 2, 0);
}

/** Write `chunks` as glTF meshes and nodes into `json` (after the rig's nodes). Returns the vertices written. */
function writeChunks(writer: GlbWriter, json: GltfJson, chunks: readonly GltfChunk[], skinned: boolean, extras: (chunk: GltfChunk) => GltfJson,
  targets: (chunk: GltfChunk) => GltfJson[] | null): number {
  let vertices = 0;
  for (const chunk of chunks) {
    checkIndices(chunk);
    const attributes: Record<string, number> = { POSITION: writer.add(chunk.positions, "VEC3", { bounds: true }) };
    if (chunk.normals) attributes.NORMAL = writer.add(chunk.normals, "VEC3");
    if (chunk.tangents) attributes.TANGENT = writer.add(chunk.tangents, "VEC4");
    if (chunk.colors) attributes.COLOR_0 = writer.add(chunk.colors, "VEC4");
    if (chunk.garmentWeight) attributes._GARMENTSUPPORTWEIGHT = writer.add(chunk.garmentWeight, "VEC4");
    if (chunk.garmentCap) attributes._GARMENTSUPPORTCAP = writer.add(chunk.garmentCap, "VEC4");
    if (chunk.uv0) attributes.TEXCOORD_0 = writer.add(chunk.uv0, "VEC2");
    if (chunk.uv1) attributes.TEXCOORD_1 = writer.add(chunk.uv1, "VEC2");
    if (skinned && chunk.influences) {
      const n = chunk.positions.length / 3;
      for (let set = 0; set < chunk.influences / 4; set++) {
        const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) for (let e = 0; e < 4; e++) {
          joints[i * 4 + e] = chunk.joints[i * chunk.influences + set * 4 + e]!;
          weights[i * 4 + e] = chunk.weights[i * chunk.influences + set * 4 + e]!;
        }
        attributes[`JOINTS_${set}`] = writer.add(joints, "VEC4");
        attributes[`WEIGHTS_${set}`] = writer.add(weights, "VEC4");
      }
    }
    const swapped = new Uint16Array(chunk.indices.length);
    for (let i = 0; i < swapped.length; i += 3) { swapped[i] = chunk.indices[i + 1]!; swapped[i + 1] = chunk.indices[i]!; swapped[i + 2] = chunk.indices[i + 2]!; }
    const primitive: GltfJson = { attributes, indices: writer.add(swapped, "SCALAR"), material: 0 };
    const morphs = targets(chunk);
    if (morphs?.length) primitive.targets = morphs;
    json.meshes.push({ extras: extras(chunk), name: chunk.name, primitives: [primitive] });
    const node: GltfJson = { name: chunk.name, mesh: json.meshes.length - 1 };
    if (skinned && chunk.influences) node.skin = 0;
    json.nodes.push(node);
    json.scenes[0].nodes.push(json.nodes.length - 1);
    vertices += chunk.positions.length / 3;
  }
  return vertices;
}

/** The document with the rig's `Armature` and joint nodes and its skin, when there is a rig. */
function startDocument(writer: GlbWriter, rig: MeshRig | null, extras: GltfJson | null): GltfJson {
  const json: GltfJson = { ...(extras ? { extras } : {}), asset: { generator: "XF Studio native mesh reader", version: "2.0" },
    materials: [{ name: "Default", doubleSided: true, pbrMetallicRoughness: {} }], meshes: [], nodes: [], scene: 0, scenes: [{ name: "Scene", nodes: [] }] };
  if (!rig) return json;
  const count = rig.names.length;
  json.nodes.push({ name: "Armature", children: Array.from({ length: count }, (_, i) => i + 1) });
  json.scenes[0].nodes.push(0);
  for (let i = 0; i < count; i++) {
    const rotation = Array.from(rig.rotations.subarray(i * 4, i * 4 + 4)), translation = Array.from(rig.translations.subarray(i * 3, i * 3 + 3));
    json.nodes.push({ name: rig.names[i], ...(rotation.join() === "0,0,0,1" ? {} : { rotation }), ...(translation.every(v => v === 0) ? {} : { translation }) });
  }
  const ibm = writer.add(inverseBindMatrices(rig), "MAT4", { bounds: true });
  writer.accessors[ibm].name = "Bind Matrices";
  json.skins = [{ inverseBindMatrices: ibm, joints: Array.from({ length: count }, (_, i) => i + 1) }];
  return json;
}

/** The highest joint index any LOD 1 chunk's skin addresses, plus one (0 without skin). */
function jointsNeeded(chunks: readonly GltfChunk[]): number {
  let needed = 0;
  for (const chunk of chunks) for (let i = 0; i < chunk.joints.length; i++) if (chunk.joints[i]! >= needed) needed = chunk.joints[i]! + 1;
  return needed;
}

function checkJoints(chunks: readonly GltfChunk[], rig: MeshRig | null): void {
  const count = rig?.names.length ?? 0, needed = jointsNeeded(chunks);
  if (rig && needed > count) throw new NativeUnsupportedError(`The skin addresses joint ${needed - 1} of a rig of ${count}.`);
}

const PARAMETERS_REFUSED = new Set(["meshMeshParamCloth", "meshMeshParamCloth_Graphical"]);

/** A `CMesh` document as WolvenKit's GLB (module comment). */
export function meshGeometry(document: RedDocument, limits: MeshLimits = DEFAULT_MESH_LIMITS): NativeGeometry {
  const mesh = document.root;
  if (mesh.type !== "CMesh") throw new NativeUnsupportedError(`A ${mesh.type} is not a mesh.`);
  const blob = meshBlob(fieldOf(mesh, "renderResourceBlob"), limits);
  const parameters = arrayOf(fieldOf(mesh, "parameters")).map(objectAt).filter((p): p is RedObject => !!p);
  const refused = parameters.find(parameter => PARAMETERS_REFUSED.has(parameter.type));
  if (refused) throw new NativeUnsupportedError(`Meshes with a ${refused.type} parameter are not decoded.`);
  const garmentParameter = parameters.find(parameter => parameter.type === "garmentMeshParamGarment") ?? null;
  const garmentSupport = parameters.some(parameter => parameter.type === "meshMeshParamGarmentSupport") || !!garmentParameter;
  const lod1 = blob.chunks.filter(chunk => chunk.lodMask === 1);
  if (estimateBytes(lod1, 150) > limits.maxOutputBytes) throw new NativeBudgetError("The mesh's geometry is larger than the reader writes.");
  const buffer = lod1.length ? blob.buffer() : new Uint8Array(0);
  const chunks = lod1.map(chunk => toGltf(decodeChunk(blob, chunk, buffer), garmentSupport));
  // Garment flags: support weight and cap bytes per vertex (four bytes a vertex; a chunk whose buffer is shorter is left without).
  const notes: string[] = [];
  if (garmentParameter) {
    const garmentChunks = arrayOf(fieldOf(garmentParameter, "chunks"));
    const short: number[] = [];
    for (const chunk of chunks) {
      const flags = fieldOf(objectAt(garmentChunks[chunk.chunk]), "garmentFlags");
      if (!(flags instanceof RedBuffer) || flags.memSize === 0) continue;
      const n = chunk.positions.length / 3;
      if (flags.memSize < n * 4) { short.push(chunk.chunk); continue; }
      const bytes = flags.bytes();
      if (bytes.length !== flags.memSize) throw new NativeMalformedError(`Chunk ${chunk.chunk}'s garment flags decompressed to ${bytes.length} bytes; the table says ${flags.memSize}.`);
      chunk.garmentWeight = new Float32Array(n * 4); chunk.garmentCap = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        chunk.garmentWeight[i * 4] = f(bytes[i * 4]! / 255); chunk.garmentWeight[i * 4 + 3] = 1;
        chunk.garmentCap[i * 4] = bytes[i * 4 + 1]!; chunk.garmentCap[i * 4 + 3] = 1;
      }
    }
    if (short.length) notes.push(`its garment support data is shorter than its vertices in chunk${short.length === 1 ? "" : "s"} ${short.join(", ")}, so that data is left out (the preview doesn't read it)`);
  }
  const { rig, note } = meshRig(mesh, blob, jointsNeeded(chunks));
  if (note) notes.push(note);
  checkJoints(chunks, rig);
  const writer = new GlbWriter();
  const json = startDocument(writer, rig, { experimentalMergedMeshes: false });
  const names = materialNames(mesh, blob.chunks.length);
  const vertices = writeChunks(writer, json, chunks.map(chunk => (chunk.indices as { doubled?: boolean }).doubled ? { ...chunk, name: `${chunk.name}_doubled` } : chunk), !!rig,
    chunk => ({ materialNames: names.map(list => (list[chunk.chunk] ?? "").split("@")[0]!), ...(chunk.garmentMorph ? { targetNames: ["GarmentSupport"] } : {}) }),
    chunk => chunk.garmentMorph ? [{ POSITION: writer.add(chunk.garmentMorph, "VEC3", { bounds: true }) }] : null);
  return { glb: writer.toGlb(json), meshes: chunks.length, vertices, targets: chunks.some(chunk => chunk.garmentMorph) ? 1 : 0, joints: rig?.names.length ?? 0, notes };
}

/**
 * A `MorphTargetMesh` document as WolvenKit's GLB (module comment). `baseMesh` is its base mesh's document when it could be read (the
 * joints come from it); without it the GLB has no skin, as WolvenKit writes it when it can't find the base mesh.
 */
export function morphGeometry(document: RedDocument, baseMesh: RedDocument | null, limits: MeshLimits = DEFAULT_MESH_LIMITS): NativeGeometry {
  const layout = morphTargetLayout(document.root, limits);
  const lod1 = layout.base.chunks.filter(chunk => chunk.lodMask === 1);
  if (estimateBytes(lod1, 150) > limits.maxOutputBytes) throw new NativeBudgetError("The morph target's geometry is larger than the reader writes.");
  const buffer = lod1.length ? layout.base.buffer() : new Uint8Array(0);
  const chunks = lod1.map(chunk => toGltf(decodeChunk(layout.base, chunk, buffer), false));
  let rig: MeshRig | null = null;
  const notes: string[] = [];
  const base = baseMesh?.root;
  if (base?.type === "CMesh" && objectAt(fieldOf(base, "renderResourceBlob"))?.type === "rendRenderMeshBlob") {
    const baseBlob = meshBlob(fieldOf(base, "renderResourceBlob"), limits);
    const made = meshRig(base, baseBlob, jointsNeeded(chunks));
    rig = made.rig;
    if (made.note) notes.push(`its base mesh ${made.note}`);
  }
  checkJoints(chunks, rig);
  const writer = new GlbWriter();
  const json = startDocument(writer, rig, null);
  const targetNames = layout.targets.map(target => `${target.name}_${target.region}`);
  let deltaBytes = 0;
  const vertices = writeChunks(writer, json, chunks.map(chunk => (chunk.indices as { doubled?: boolean }).doubled ? { ...chunk, name: `${chunk.name}_doubled` } : chunk), !!rig,
    () => ({ targetNames }),
    chunk => layout.targets.map((_, t) => {
      const deltas = chunkDeltas(layout, t, chunk.chunk);
      deltaBytes += deltas.vertices.length * 40;
      if (deltaBytes > limits.maxOutputBytes) throw new NativeBudgetError("The morph target's deltas are larger than the reader writes.");
      const count = chunk.positions.length / 3;
      const order = Array.from(deltas.vertices.keys()).sort((a, b) => deltas.vertices[a]! - deltas.vertices[b]!);
      const rows = Uint32Array.from(order, row => deltas.vertices[row]!);
      const pick = (source: Float32Array, width: number, swap: (v: Float32Array, at: number, out: Float32Array, to: number) => void) => {
        const out = new Float32Array(order.length * 3);
        order.forEach((row, i) => swap(source, row * width, out, i * 3));
        return out;
      };
      const swapped = (v: Float32Array, at: number, out: Float32Array, to: number) => { out[to] = v[at]!; out[to + 1] = v[at + 2]!; out[to + 2] = f(-v[at + 1]!); };
      const target: GltfJson = { POSITION: writer.addSparseRows(count, rows, pick(deltas.positions, 3, swapped), "VEC3") };
      if (chunk.normals) target.NORMAL = writer.addSparseRows(count, rows, pick(deltas.normals, 4, swapped), "VEC3");
      if (chunk.tangents) target.TANGENT = writer.addSparseRows(count, rows, pick(deltas.tangents, 4, swapped), "VEC3");
      return target;
    }));
  return { glb: writer.toGlb(json), meshes: chunks.length, vertices, targets: layout.targets.length, joints: rig?.names.length ?? 0, notes };
}
