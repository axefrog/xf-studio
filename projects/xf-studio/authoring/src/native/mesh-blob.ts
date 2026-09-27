/**
 * A mesh resource's render blob (`rendRenderMeshBlob`): its header, per-chunk vertex layouts and the vertex and index streams, decoded
 * from the red model (red-model.ts). Pure. knowledge/archive-format.md §12 documents the layout and the evidence.
 *
 * - `CMesh.renderResourceBlob` (and `MorphTargetMesh.blob.baseBlob`) is a handle to a `rendRenderMeshBlob`: `header` and
 *   `renderBuffer`, one buffer holding every chunk's vertex streams (`vertexBufferSize` bytes) followed by the index streams
 *   (`indexBufferOffset`, `indexBufferSize`).
 * - `header.renderChunkInfos` lists one `rendChunk` per render chunk: `numVertices`, `numIndices`, `lodMask`, `vertexFactory`, the
 *   index chunk (`pe`: the index type, `teOffset`: where its indices start past `indexBufferOffset`) and the vertex chunk:
 *   `byteOffsets` (where each stream of the chunk starts in the buffer, by stream index) and `vertexLayout` (`elements`, each a usage,
 *   usage index, packing type and stream index; `slotStrides`, the stride of each stream).
 * - Inside a stream, elements lie back to back in list order, each as wide as its packing type. Positions are `PT_Short4N` with
 *   the header's `quantizationScale` and `quantizationOffset`; normals and tangents are `PT_Dec4` (10:10:10:2); UVs `PT_Float16_2`;
 *   colours `PT_Color` (4 bytes); skin indices `PT_UByte4` and weights `PT_UByte4N`, one element of each per four influences; the
 *   garment-support offset (`PS_ExtraData` on stream 0) `PT_Float16_4`.
 *
 * Every stream read is checked against the buffer before anything is allocated. Only the packing types above are decoded for the
 * usages the preview draws, as the character meshes store them (game 2.31 and the mods of the reference setup); another type is
 * refused as unsupported, so the caller falls back to WolvenKit. Values are returned as stored (the game's Z-up, left-handed space);
 * mesh-glb.ts applies WolvenKit's export conventions.
 */
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { learnedDefault } from "./red-defaults";
import { RedBuffer, RedHandle, RedObject } from "./red-model";

/** Caps of a mesh decode, besides the reader's resource caps (limits.ts). */
export interface MeshLimits {
  /** Render chunks one blob may list. */
  readonly maxChunks: number;
  /** Bones one mesh may list. */
  readonly maxBones: number;
  /** Morph targets one morph target resource may list. */
  readonly maxTargets: number;
  /** Targets times the base blob's chunks (each target counts and writes something per chunk; NATIVE-59). */
  readonly maxTargetChunks: number;
  /** Indices one chunk may list. */
  readonly maxIndices: number;
  /**
   * Bytes one decode may hold at its peak: the decoded chunks, their glTF form, the writer's copies and the GLB, with the morph deltas
   * (mesh-glb.ts `estimateBytes`, estimated before anything is allocated; NATIVE-58).
   */
  readonly maxOutputBytes: number;
}
/**
 * Measured on the 559 cached WolvenKit exports of the reference setup (519 meshes, 40 morph targets): at most 23 chunks, 254 bones,
 * 105 targets, 65,447 vertices and 385,512 indices in a chunk, 504,036 LOD 1 vertices in a mesh (a hair mod's, about 330 MB at the
 * decode's peak), and a 64 MB WolvenKit GLB. Each cap is above that.
 */
export const DEFAULT_MESH_LIMITS: MeshLimits = Object.freeze({ maxChunks: 1024, maxBones: 4096, maxTargets: 1024, maxTargetChunks: 16_384, maxIndices: 4_000_000,
  maxOutputBytes: 512 * 2 ** 20 });

/** Bytes of each packing type this reader knows the width of. */
const PACKING_BYTES: Readonly<Record<string, number>> = {
  PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_Float16_2: 4, PT_Float16_4: 8, PT_UShort1: 2, PT_UShort2: 4, PT_UShort4: 8,
  PT_UShort4N: 8, PT_Short1: 2, PT_Short2: 4, PT_Short4: 8, PT_Short4N: 8, PT_UInt1: 4, PT_UInt2: 8, PT_UInt3: 12, PT_UInt4: 16, PT_Int1: 4,
  PT_Int2: 8, PT_Int3: 12, PT_Int4: 16, PT_Color: 4, PT_UByte1: 1, PT_UByte1F: 1, PT_UByte4: 4, PT_UByte4N: 4, PT_Byte4N: 4, PT_Dec4: 4,
  PT_Index16: 2, PT_Index32: 4,
};
/** The one packing type decoded for each usage the preview draws. */
const DECODED: Readonly<Record<string, string>> = {
  PS_Position: "PT_Short4N", PS_Normal: "PT_Dec4", PS_Tangent: "PT_Dec4", PS_TexCoord: "PT_Float16_2", PS_Color: "PT_Color",
  PS_SkinIndices: "PT_UByte4", PS_SkinWeights: "PT_UByte4N", PS_ExtraData: "PT_Float16_4",
};
/** Streams of per-vertex data (0–4 in the files seen); stream 7 carries per-instance data the preview never reads. */
const VERTEX_STREAMS = 5;
/** Elements a vertex layout holds (`GpuWrapApiVertexLayoutDesc.elements` is `static:32`; NATIVE-65). */
const LAYOUT_ELEMENTS = 32;
/** UV sets decoded: the GLB carries two, `TEXCOORD_0` and `TEXCOORD_1` (NATIVE-65: every set was decoded, then all but two dropped). */
const UV_SETS = 2;

export interface VertexElement {
  readonly usage: string;
  readonly usageIndex: number;
  readonly type: string;
  readonly stream: number;
  /** Byte offset inside one vertex of its stream. */
  readonly offset: number;
}
export interface MeshChunk {
  /** Position in `renderChunkInfos` (the chunk index the preview's records name). */
  readonly index: number;
  readonly lodMask: number;
  readonly vertexFactory: number;
  readonly numVertices: number;
  readonly numIndices: number;
  /** Where each vertex stream starts in the render buffer, by stream index. */
  readonly streamOffsets: readonly number[];
  /** Stride of each vertex stream, by stream index. */
  readonly strides: readonly number[];
  /** The per-vertex elements of streams 0–4, in list order. */
  readonly elements: readonly VertexElement[];
  /** Where the chunk's 16-bit indices start in the render buffer. */
  readonly indexOffset: number;
  /** Where each stream it uses starts and how many bytes it spans (every vertex at its stride, the last one's elements). */
  readonly vertexSpans: readonly (readonly [start: number, bytes: number])[];
}
export interface MeshBlob {
  readonly quantizationScale: readonly [number, number, number, number];
  readonly quantizationOffset: readonly [number, number, number, number];
  readonly vertexBufferSize: number;
  readonly indexBufferOffset: number;
  readonly indexBufferSize: number;
  /** `header.bonePositions` as stored (x, y, z, w per bone). */
  readonly bonePositions: readonly (readonly [number, number, number, number])[];
  readonly chunks: readonly MeshChunk[];
  /** The render buffer, decompressed on first use (within the decode session's caps). */
  readonly buffer: () => Uint8Array;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Red model helpers: a property the file left out is its class default (red-defaults.ts), else the type's zero.

export const fieldsOf = (value: unknown): Record<string, unknown> => value instanceof RedObject ? value.fields : {};
export const objectAt = (value: unknown): RedObject | null => value instanceof RedHandle ? value.target : value instanceof RedObject ? value : null;
/** A property's value, or its known default when the file left it out. */
export function fieldOf(object: RedObject | null, name: string): unknown {
  if (!object) return undefined;
  return Object.hasOwn(object.fields, name) ? object.fields[name] : learnedDefault(object.type, name);
}
/** A non-negative integer property (its default, else 0). */
export function countOf(object: RedObject | null, name: string, what: string): number {
  const value = fieldOf(object, name) ?? 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new NativeMalformedError(`The mesh's ${what} is not a count (${String(value)}).`);
  return value;
}
/**
 * A number property (its default, else 0). Floats arrive as the reader writes them (json-numbers.ts `float32Value`): a double that
 * rounds back to the stored float32, `"+inf"`/`"-inf"`, or null for NaN.
 */
export function numberOf(object: RedObject | null, name: string): number {
  const value = fieldOf(object, name) ?? 0;
  if (typeof value === "number") return value;
  if (value === "+inf") return Infinity;
  if (value === "-inf") return -Infinity;
  if (value === null) return NaN;
  throw new NativeMalformedError(`The mesh's ${object?.type}.${name} is not a number.`);
}
export const arrayOf = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
/** A `static:N,T` value's elements (`{Elements: [...]}`), or an empty list. */
export const elementsOf = (value: unknown): readonly unknown[] => {
  const elements = (value as { Elements?: unknown } | null)?.Elements;
  return Array.isArray(elements) ? elements : [];
};
/** A `Vector4` struct as four numbers (omitted members are their defaults). */
export function vector4(value: unknown): [number, number, number, number] {
  const object = objectAt(value);
  return [numberOf(object, "X"), numberOf(object, "Y"), numberOf(object, "Z"), numberOf(object, "W")];
}
/** A CName's text (`None` for an empty name). */
export function nameText(value: unknown): string {
  const text = (value as { $value?: unknown } | null)?.$value;
  return typeof text === "string" ? text : "None";
}
/** An enum value's member name (a file stores its member's name; an omitted one is its default). */
const enumText = (object: RedObject, name: string): string => {
  const value = fieldOf(object, name);
  return typeof value === "string" ? value : "";
};

// ---------------------------------------------------------------------------------------------------------------------------------

/** The render blob a `CMesh` or a morph target's base blob handle holds, checked against itself before any vertex is read. */
export function meshBlob(blobValue: unknown, limits: MeshLimits = DEFAULT_MESH_LIMITS): MeshBlob {
  const blob = objectAt(blobValue);
  if (!blob || blob.type !== "rendRenderMeshBlob") throw new NativeUnsupportedError(`The mesh has no render mesh blob (${blob?.type ?? "none"}).`);
  const header = objectAt(fieldOf(blob, "header"));
  if (!header) throw new NativeMalformedError("The render blob has no header.");
  const buffer = fieldOf(blob, "renderBuffer");
  if (!(buffer instanceof RedBuffer)) throw new NativeMalformedError("The render blob has no render buffer.");
  const vertexBufferSize = countOf(header, "vertexBufferSize", "vertex buffer size");
  const indexBufferOffset = countOf(header, "indexBufferOffset", "index buffer offset");
  const indexBufferSize = countOf(header, "indexBufferSize", "index buffer size");
  const total = buffer.memSize;
  if (vertexBufferSize > total || indexBufferOffset > total || indexBufferSize > total - indexBufferOffset)
    throw new NativeMalformedError(`The render blob's streams (${vertexBufferSize} vertex bytes, indices ${indexBufferOffset}+${indexBufferSize}) lie outside its ${total}-byte buffer.`);
  const bones = arrayOf(fieldOf(header, "bonePositions"));
  if (bones.length > limits.maxBones) throw new NativeBudgetError(`The mesh lists ${bones.length} bone positions (at most ${limits.maxBones}).`);
  const infos = arrayOf(fieldOf(header, "renderChunkInfos"));
  if (infos.length > limits.maxChunks) throw new NativeBudgetError(`The mesh lists ${infos.length} render chunks (at most ${limits.maxChunks}).`);
  const chunks = infos.map((info, index) => chunkLayout(objectAt(info), index, { vertexBufferSize, indexBufferOffset, indexBufferSize }, limits));
  let bytes: Uint8Array | null = null;
  return {
    quantizationScale: vector4(fieldOf(header, "quantizationScale")), quantizationOffset: vector4(fieldOf(header, "quantizationOffset")),
    vertexBufferSize, indexBufferOffset, indexBufferSize, bonePositions: bones.map(vector4), chunks,
    buffer: () => {
      if (bytes) return bytes;
      const read = buffer.bytes();
      if (read.length !== total) throw new NativeMalformedError(`The render buffer decompressed to ${read.length} bytes; its table says ${total}.`);
      return (bytes = read);
    },
  };
}

function chunkLayout(info: RedObject | null, index: number, sizes: { vertexBufferSize: number; indexBufferOffset: number; indexBufferSize: number }, limits: MeshLimits): MeshChunk {
  if (!info || info.type !== "rendChunk") throw new NativeMalformedError(`Render chunk ${index} is not a rendChunk.`);
  const numVertices = countOf(info, "numVertices", `chunk ${index} vertex count`), numIndices = countOf(info, "numIndices", `chunk ${index} index count`);
  if (numIndices > limits.maxIndices) throw new NativeBudgetError(`Chunk ${index} lists ${numIndices} indices (at most ${limits.maxIndices}).`);
  if (numIndices % 3) throw new NativeMalformedError(`Chunk ${index} lists ${numIndices} indices, not whole triangles.`);
  const indices = objectAt(fieldOf(info, "chunkIndices"));
  const indexType = indices ? enumText(indices, "pe") : "";
  if (indexType !== "IBCT_IndexUShort") throw new NativeUnsupportedError(`Chunk ${index} stores ${indexType || "no"} indices; only 16-bit indices are decoded.`);
  const indexOffset = sizes.indexBufferOffset + countOf(indices, "teOffset", `chunk ${index} index offset`);
  if (indexOffset + numIndices * 2 > sizes.indexBufferOffset + sizes.indexBufferSize)
    throw new NativeMalformedError(`Chunk ${index}'s ${numIndices} indices lie outside the index buffer.`);
  const vertices = objectAt(fieldOf(info, "chunkVertices"));
  const layout = objectAt(fieldOf(vertices, "vertexLayout"));
  const streamOffsets = elementsOf(fieldOf(vertices, "byteOffsets")).map(value => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1);
  const strides = elementsOf(fieldOf(layout, "slotStrides")).map(value => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1);
  const elements: VertexElement[] = [];
  const used = new Array<number>(VERTEX_STREAMS).fill(0);
  const stored = elementsOf(fieldOf(layout, "elements"));
  if (stored.length > LAYOUT_ELEMENTS) throw new NativeMalformedError(`Chunk ${index}'s vertex layout lists ${stored.length} elements (a layout holds ${LAYOUT_ELEMENTS}).`);
  for (const value of stored) {
    const element = objectAt(value);
    if (!element) continue;
    const usage = enumText(element, "usage"), type = enumText(element, "type"), streamType = enumText(element, "streamType");
    if (usage === "PS_Invalid" || usage === "" || streamType === "ST_Invalid") break;
    const stream = countOf(element, "streamIndex", `chunk ${index} stream index`);
    if (streamType === "ST_PerInstance") continue;
    if (stream >= VERTEX_STREAMS) throw new NativeUnsupportedError(`Chunk ${index} has per-vertex data in stream ${stream}.`);
    const size = PACKING_BYTES[type];
    if (!size) throw new NativeUnsupportedError(`Chunk ${index} has a ${usage} element packed as ${type || "nothing"}.`);
    if (DECODED[usage] && DECODED[usage] !== type) throw new NativeUnsupportedError(`Chunk ${index} packs ${usage} as ${type}; only ${DECODED[usage]} is decoded.`);
    elements.push({ usage, usageIndex: countOf(element, "usageIndex", `chunk ${index} usage index`), type, stream, offset: used[stream]! });
    used[stream]! += size;
  }
  // Every stream an element uses must lie inside the vertex buffer at its own stride.
  const vertexSpans: [number, number][] = [];
  for (let stream = 0; stream < VERTEX_STREAMS; stream++) {
    if (!used[stream]) continue;
    const start = streamOffsets[stream] ?? -1, stride = strides[stream] ?? -1;
    if (start < 0 || stride < used[stream]!) throw new NativeMalformedError(`Chunk ${index}'s stream ${stream} (${used[stream]} bytes a vertex) has stride ${stride} at ${start}.`);
    const span = numVertices ? (numVertices - 1) * stride + used[stream]! : 0;
    if (numVertices && start + span > sizes.vertexBufferSize) throw new NativeMalformedError(`Chunk ${index}'s stream ${stream} lies outside the vertex buffer.`);
    vertexSpans.push([start, span]);
  }
  if (!elements.some(element => element.usage === "PS_Position" && element.stream === 0))
    throw new NativeUnsupportedError(`Chunk ${index} has no positions in stream 0.`);
  return { index, lodMask: countOf(info, "lodMask", `chunk ${index} LOD mask`), vertexFactory: countOf(info, "vertexFactory", `chunk ${index} vertex factory`),
    numVertices, numIndices, streamOffsets, strides, elements, indexOffset, vertexSpans };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Decoding. Values stay as stored; the arithmetic is single precision (Math.fround at every step), as WolvenKit's C# does it, so a
// value converted by mesh-glb.ts is bit-identical to WolvenKit's where the conventions are the same.

const f = Math.fround;
/** Half-float bits to float32 (exact: every half is a float32). */
const HALF = (() => {
  const table = new Float32Array(65536);
  for (let bits = 0; bits < 65536; bits++) {
    const mantissa = bits & 0x3ff, exponent = (bits >> 10) & 0x1f, sign = bits >> 15 ? -1 : 1;
    table[bits] = exponent === 0 ? sign * 2 ** -14 * (mantissa / 1024)
      : exponent === 31 ? (mantissa ? NaN : sign * Infinity) : sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
  }
  return table;
})();
export const halfToFloat = (bits: number) => HALF[bits & 0xffff]!;

/** A 10:10:10:2 value as WolvenKit reads it: each 10-bit field to [-1, 1] (x·2/1023 − 1), and w 1, −1 or 0 from the top two bits. */
export function dec4(value: number, out: Float32Array, at: number): void {
  const scale = f(1 / 1023);
  out[at] = f(f(f((value & 0x3ff) * 2) * scale) - 1);
  out[at + 1] = f(f(f(((value >>> 10) & 0x3ff) * 2) * scale) - 1);
  out[at + 2] = f(f(f(((value >>> 20) & 0x3ff) * 2) * scale) - 1);
  const w = value >>> 30;
  out[at + 3] = w === 0 ? 1 : w === 3 ? -1 : 0;
}

/** One chunk's vertex data as stored (game space), plus its triangle indices in file order. */
export interface DecodedChunk {
  readonly chunk: MeshChunk;
  /** x, y, z per vertex, dequantised (short/32767 · scale + offset, in single precision). */
  readonly positions: Float32Array;
  /** Decoded 10:10:10:2 normals (x, y, z, w per vertex), not yet normalised; null without normals. */
  readonly normals: Float32Array | null;
  readonly tangents: Float32Array | null;
  /** The first two UV sets in usage-index order (u, v per vertex, as stored). */
  readonly uvs: readonly Float32Array[];
  /** Colour bytes (r, g, b, a per vertex); null without colours. */
  readonly colors: Uint8Array | null;
  /** Influences per vertex (4 per skin-index element) and the raw index and weight bytes (influences per vertex each). */
  readonly influences: number;
  readonly joints: Uint8Array;
  readonly weights: Uint8Array;
  /** The garment-support offset (x, y, z per vertex, half floats), when stream 0 carries `PS_ExtraData`; else null. */
  readonly extra: Float32Array | null;
  readonly indices: Uint16Array;
}

/** Decode one chunk's streams. `buffer` is the blob's render buffer. */
export function decodeChunk(blob: MeshBlob, chunk: MeshChunk, buffer: Uint8Array): DecodedChunk {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const n = chunk.numVertices;
  const find = (usage: string, usageIndex = 0) => chunk.elements.find(element => element.usage === usage && element.usageIndex === usageIndex) ?? null;
  const base = (element: VertexElement) => chunk.streamOffsets[element.stream]! + element.offset;
  const stride = (element: VertexElement) => chunk.strides[element.stream]!;

  const position = find("PS_Position")!;
  const positions = new Float32Array(n * 3);
  const [sx, sy, sz] = blob.quantizationScale, [ox, oy, oz] = blob.quantizationOffset;
  const scale = [f(sx), f(sy), f(sz)], offset = [f(ox), f(oy), f(oz)];
  for (let i = 0, at = base(position), step = stride(position); i < n; i++, at += step)
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = f(f(f(view.getInt16(at + k * 2, true) / 32767) * scale[k]!) + offset[k]!);

  const dec4Stream = (element: VertexElement | null): Float32Array | null => {
    if (!element) return null;
    const out = new Float32Array(n * 4);
    for (let i = 0, at = base(element), step = stride(element); i < n; i++, at += step) dec4(view.getUint32(at, true), out, i * 4);
    return out;
  };
  const uvs: Float32Array[] = [];
  const uvElements = chunk.elements.filter(element => element.usage === "PS_TexCoord").sort((a, b) => a.usageIndex - b.usageIndex).slice(0, UV_SETS);
  for (const element of uvElements) {
    const out = new Float32Array(n * 2);
    for (let i = 0, at = base(element), step = stride(element); i < n; i++, at += step) {
      out[i * 2] = halfToFloat(view.getUint16(at, true));
      out[i * 2 + 1] = halfToFloat(view.getUint16(at + 2, true));
    }
    uvs.push(out);
  }
  const color = find("PS_Color");
  let colors: Uint8Array | null = null;
  if (color) {
    colors = new Uint8Array(n * 4);
    for (let i = 0, at = base(color), step = stride(color); i < n; i++, at += step) colors.set(buffer.subarray(at, at + 4), i * 4);
  }
  // Skin: one PT_UByte4 index element and one PT_UByte4N weight element per four influences, in usage-index order.
  const indexElements = chunk.elements.filter(element => element.usage === "PS_SkinIndices").sort((a, b) => a.usageIndex - b.usageIndex);
  const weightElements = chunk.elements.filter(element => element.usage === "PS_SkinWeights").sort((a, b) => a.usageIndex - b.usageIndex);
  const influences = indexElements.length * 4;
  const joints = new Uint8Array(n * influences), weights = new Uint8Array(n * influences);
  indexElements.forEach((element, set) => {
    for (let i = 0, at = base(element), step = stride(element); i < n; i++, at += step) joints.set(buffer.subarray(at, at + 4), i * influences + set * 4);
  });
  weightElements.forEach((element, set) => {
    if (set >= indexElements.length) return;
    for (let i = 0, at = base(element), step = stride(element); i < n; i++, at += step) weights.set(buffer.subarray(at, at + 4), i * influences + set * 4);
  });
  const extraElement = chunk.elements.find(element => element.usage === "PS_ExtraData" && element.stream === 0) ?? null;
  let extra: Float32Array | null = null;
  if (extraElement) {
    extra = new Float32Array(n * 3);
    for (let i = 0, at = base(extraElement), step = stride(extraElement); i < n; i++, at += step)
      for (let k = 0; k < 3; k++) extra[i * 3 + k] = halfToFloat(view.getUint16(at + k * 2, true));
  }
  const indices = new Uint16Array(chunk.numIndices);
  for (let i = 0; i < chunk.numIndices; i++) indices[i] = view.getUint16(chunk.indexOffset + i * 2, true);
  return { chunk, positions, normals: dec4Stream(find("PS_Normal")), tangents: dec4Stream(find("PS_Tangent")), uvs, colors, influences, joints, weights, extra, indices };
}
