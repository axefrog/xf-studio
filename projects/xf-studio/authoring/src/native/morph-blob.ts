/**
 * A `.morphtarget` resource's targets: names and regions, and per target and chunk the sparse vertex deltas. Pure.
 * knowledge/archive-format.md §12 documents the layout and the evidence.
 *
 * - `MorphTargetMesh.targets` lists one `MorphTargetMeshEntry` per target (`name`, `regionName`, `faceRegion`) and `baseMesh` names the
 *   mesh whose bones the targets move with. `blob` is a `rendRenderMorphTargetMeshBlob`: `baseBlob` (a render mesh blob, mesh-blob.ts:
 *   the shape the targets apply to), `diffsBuffer`, `mappingBuffer` and `header`.
 * - `header.numTargets` (else the entry count), and per target: `targetStartsInVertexDiffs` and `…Mapping` (where its diffs and its
 *   mapping start), `targetPositionDiffScale` and `…Offset`, and per chunk `numVertexDiffsInEachChunk` and
 *   `numVertexDiffsMappingInEachChunk`.
 * - A diff is 12 bytes: the position delta (three unsigned 10-bit fields, each /1023 · scale + offset), the normal delta and the tangent
 *   delta (10:10:10:2, each field ·2/1023 − 1). A chunk's diffs follow the previous chunk's.
 * - The mapping holds one u16 vertex index per diff. Its per-chunk count is stored halved and rounded up (two indices per u32), so
 *   a chunk with an odd number of diffs carries one padding entry, and the next chunk's mapping starts at the rounded-up position.
 *
 * Counts, starts and sizes are checked against the buffers before anything is read. What a diff decodes to is WolvenKit's reading
 * [source: WolvenKit `MorphTargetTools`, studied as documentation; resource: tools/native-mesh-oracle.ts]; the chunk a count belongs to
 * is its index in the base blob's chunk list.
 */
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { arrayOf, countOf, DEFAULT_MESH_LIMITS, dec4, fieldOf, meshBlob, type MeshBlob, type MeshLimits, nameText, objectAt, vector4 } from "./mesh-blob";
import { RedBuffer, type RedObject } from "./red-model";

const f = Math.fround;
const DIFF_BYTES = 12;

export interface MorphTargetInfo {
  readonly name: string;
  readonly region: string;
  readonly faceRegion: string;
  readonly start: number;
  readonly mappingStart: number;
  readonly scale: readonly [number, number, number, number];
  readonly offset: readonly [number, number, number, number];
  /** Diffs and stored (halved) mapping counts per chunk of the base blob. */
  readonly diffs: readonly number[];
  readonly mappings: readonly number[];
}
export interface MorphTargetLayout {
  /** `baseMesh`'s depot path, or its hash when the file names it by hash (`#<decimal>`); null when empty. */
  readonly baseMesh: string | null;
  readonly base: MeshBlob;
  readonly targets: readonly MorphTargetInfo[];
  readonly diffsBuffer: () => Uint8Array;
  readonly mappingBuffer: () => Uint8Array;
}

/** A buffer value's bytes (decompressed on first use), or empty for an absent buffer. */
function bufferBytes(value: unknown, what: string): { size: number; bytes: () => Uint8Array } {
  if (value === null || value === undefined) return { size: 0, bytes: () => new Uint8Array(0) };
  if (!(value instanceof RedBuffer)) throw new NativeMalformedError(`The morph target's ${what} is not a buffer.`);
  let bytes: Uint8Array | null = null;
  return { size: value.memSize, bytes: () => {
    if (bytes) return bytes;
    const read = value.bytes();
    if (read.length !== value.memSize) throw new NativeMalformedError(`The morph target's ${what} decompressed to ${read.length} bytes; its table says ${value.memSize}.`);
    return (bytes = read);
  } };
}

const countList = (value: unknown, what: string): number[] => arrayOf(value).map(item => {
  if (typeof item !== "number" || !Number.isInteger(item) || item < 0) throw new NativeMalformedError(`The morph target's ${what} holds ${String(item)}.`);
  return item;
});

/** The depot path a reference value names (`#hash` when only its hash is known), or null. */
export function referencePath(value: unknown): string | null {
  const path = (value as { DepotPath?: { $storage?: unknown; $value?: unknown } } | null)?.DepotPath;
  if (!path || typeof path.$value !== "string" || path.$value === "" || path.$value === "0") return null;
  return path.$storage === "uint64" ? `#${path.$value}` : path.$value;
}

/** A `MorphTargetMesh` root's targets and buffers, checked against themselves before any delta is read. */
export function morphTargetLayout(root: RedObject, limits: MeshLimits = DEFAULT_MESH_LIMITS): MorphTargetLayout {
  if (root.type !== "MorphTargetMesh") throw new NativeUnsupportedError(`A ${root.type} is not a morph target.`);
  const blob = objectAt(fieldOf(root, "blob"));
  if (!blob || blob.type !== "rendRenderMorphTargetMeshBlob") throw new NativeUnsupportedError(`The morph target has no morph target blob (${blob?.type ?? "none"}).`);
  const base = meshBlob(fieldOf(blob, "baseBlob"), limits);
  const header = objectAt(fieldOf(blob, "header"));
  const entries = arrayOf(fieldOf(root, "targets"));
  let count = countOf(header, "numTargets", "target count");
  if (count === 0) count = entries.length;
  if (count === 0) throw new NativeMalformedError("The morph target lists no targets.");
  if (count > limits.maxTargets) throw new NativeBudgetError(`The morph target lists ${count} targets (at most ${limits.maxTargets}).`);
  if (entries.length < count) throw new NativeMalformedError(`The morph target counts ${count} targets and names ${entries.length}.`);
  const starts = countList(fieldOf(header, "targetStartsInVertexDiffs"), "diff starts");
  const mappingStarts = countList(fieldOf(header, "targetStartsInVertexDiffsMapping"), "mapping starts");
  const scales = arrayOf(fieldOf(header, "targetPositionDiffScale")), offsets = arrayOf(fieldOf(header, "targetPositionDiffOffset"));
  const diffCounts = arrayOf(fieldOf(header, "numVertexDiffsInEachChunk")), mappingCounts = arrayOf(fieldOf(header, "numVertexDiffsMappingInEachChunk"));
  if ([starts, mappingStarts, scales, offsets, diffCounts, mappingCounts].some(list => list.length < count))
    throw new NativeMalformedError(`The morph target's header tables are shorter than its ${count} targets.`);
  const diffs = bufferBytes(fieldOf(blob, "diffsBuffer"), "diffs buffer"), mapping = bufferBytes(fieldOf(blob, "mappingBuffer"), "mapping buffer");
  const chunks = base.chunks.length;
  const targets: MorphTargetInfo[] = [];
  for (let t = 0; t < count; t++) {
    const entry = objectAt(entries[t]);
    const perChunk = countList(diffCounts[t], `target ${t} diff counts`), perChunkMapping = countList(mappingCounts[t], `target ${t} mapping counts`);
    if (perChunk.length < chunks || perChunkMapping.length < chunks) throw new NativeMalformedError(`Target ${t} counts diffs for ${perChunk.length} of ${chunks} chunks.`);
    let diffEnd = starts[t]!, mappingEnd = mappingStarts[t]! * 2;
    for (let c = 0; c < chunks; c++) {
      const stored = perChunkMapping[c]!;
      // A chunk that counts diffs but no mapping is read as having none, and its count takes no room before the next chunk's diffs
      // (as WolvenKit reads it; a bookkeeping slip in some files).
      if (stored === 0) perChunk[c] = 0;
      const n = perChunk[c]!;
      if (stored * 2 - (n % 2) !== n && stored !== 0) throw new NativeMalformedError(`Target ${t} chunk ${c}: ${n} diffs but a mapping of ${stored * 2 - (n % 2)}.`);
      diffEnd += n;
      mappingEnd += stored * 2;
    }
    if (diffEnd * DIFF_BYTES > diffs.size || mappingEnd * 2 > mapping.size)
      throw new NativeMalformedError(`Target ${t}'s diffs or mapping lie outside their buffers.`);
    targets.push({ name: nameText(fieldOf(entry, "name")), region: nameText(fieldOf(entry, "regionName")),
      faceRegion: String(fieldOf(entry, "faceRegion") ?? "FACE_REGION_NONE"), start: starts[t]!, mappingStart: mappingStarts[t]!,
      scale: vector4(scales[t]), offset: vector4(offsets[t]), diffs: perChunk.slice(0, chunks), mappings: perChunkMapping.slice(0, chunks) });
  }
  return { baseMesh: referencePath(fieldOf(root, "baseMesh")), base, targets, diffsBuffer: diffs.bytes, mappingBuffer: mapping.bytes };
}

/** One target's deltas on one chunk: the vertices it moves (first mapping entry wins) and their deltas, in game space. */
export interface ChunkDeltas {
  /** Mapped vertex indices, in mapping order (a repeated index keeps its first diff). */
  readonly vertices: Uint16Array;
  /** Position deltas x, y, z per mapped vertex (dequantised, single precision). */
  readonly positions: Float32Array;
  /** Normal and tangent deltas x, y, z, w per mapped vertex (10:10:10:2 fields, ·2/1023 − 1). */
  readonly normals: Float32Array;
  readonly tangents: Float32Array;
}

/** Target `t`'s deltas on chunk `c` (vertex indices at or past the chunk's count are dropped). */
export function chunkDeltas(layout: MorphTargetLayout, t: number, c: number): ChunkDeltas {
  const target = layout.targets[t]!, chunk = layout.base.chunks[c]!;
  const n = target.mappings[c] ? target.diffs[c]! : 0;
  let diffAt = target.start, mapAt = target.mappingStart * 2;
  for (let p = 0; p < c; p++) { diffAt += target.diffs[p]!; mapAt += target.mappings[p]! * 2; }
  const diffs = layout.diffsBuffer(), mapping = layout.mappingBuffer();
  const dv = new DataView(diffs.buffer, diffs.byteOffset, diffs.byteLength), mv = new DataView(mapping.buffer, mapping.byteOffset, mapping.byteLength);
  const seen = new Uint8Array(chunk.numVertices);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const vertex = mv.getUint16((mapAt + i) * 2, true);
    if (vertex < chunk.numVertices && !seen[vertex]) { seen[vertex] = 1; keep.push(i); }
  }
  const vertices = new Uint16Array(keep.length), positions = new Float32Array(keep.length * 3);
  const normals = new Float32Array(keep.length * 4), tangents = new Float32Array(keep.length * 4);
  const [sx, sy, sz] = target.scale.map(f), [ox, oy, oz] = target.offset.map(f);
  const scale = [sx!, sy!, sz!], offset = [ox!, oy!, oz!];
  keep.forEach((i, row) => {
    vertices[row] = mv.getUint16((mapAt + i) * 2, true);
    const at = (diffAt + i) * DIFF_BYTES, packed = dv.getUint32(at, true);
    for (let k = 0; k < 3; k++) positions[row * 3 + k] = f(f(f(((packed >>> (10 * k)) & 0x3ff) / 1023) * scale[k]!) + offset[k]!);
    dec4(dv.getUint32(at + 4, true), normals, row * 4);
    dec4(dv.getUint32(at + 8, true), tangents, row * 4);
  });
  return { vertices, positions, normals, tangents };
}
