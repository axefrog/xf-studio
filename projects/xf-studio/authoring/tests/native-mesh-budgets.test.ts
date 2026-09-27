// The native mesh reader's budgets against crafted render blobs (the code-health reviews at 9f71a56, NATIVE-58 and NATIVE-59, and at
// 62637f4, NATIVE-65 and NATIVE-66, scaled down from their reproductions): chunks can't share one vertex range, the output estimate is
// the decode's real peak, targets times chunks is capped, a fixed array holds at most its size, a vertex layout at most 32 elements of
// which two UV sets are decoded, and morph targets can't all read one range. Red models built directly (no CR2W), synthetic data only.
import { expect, test } from "bun:test";
import { DecodeSession } from "../src/native/limits";
import { decodeChunk, DEFAULT_MESH_LIMITS, meshBlob, type MeshLimits } from "../src/native/mesh-blob";
import { NativeMalformedError } from "../src/native/native-errors";
import { Cursor, readValue, type ValueContext } from "../src/native/red-values";
import { meshGeometry, morphGeometry } from "../src/native/mesh-glb";
import { chunkDeltas, morphTargetLayout } from "../src/native/morph-blob";
import { classifyNativeFailure } from "../src/native/native-errors";
import { RedBuffer, RedHandle, RedObject, type RedDocument } from "../src/native/red-model";

const O = (type: string, fields: Record<string, unknown>) => new RedObject(type, fields);
const v4 = (x: number) => O("Vector4", { X: x, Y: x, Z: x, W: x });
const kind = (run: () => unknown) => { try { run(); return "ok"; } catch (error) { return classifyNativeFailure(error); } };

/** A render blob of `chunks` chunks of `vertices` positions (8 bytes each), each at `offsetOf(chunk)`, with one triangle per chunk. */
function blob(chunks: number, vertices: number, offsetOf: (chunk: number) => number, lodOf: (chunk: number) => number = () => 1) {
  const stride = 8, vbytes = Math.max(...Array.from({ length: chunks }, (_, c) => offsetOf(c))) + vertices * stride, ibytes = 6;
  const buffer = new Uint8Array(vbytes + ibytes);
  new DataView(buffer.buffer).setUint16(vbytes + 2, 1, true);
  new DataView(buffer.buffer).setUint16(vbytes + 4, 2, true);
  const element = O("GpuWrapApieVertexPackingPackingElement", { usage: "PS_Position", type: "PT_Short4N", streamType: "ST_PerVertex", streamIndex: 0, usageIndex: 0 });
  const chunk = (c: number) => O("rendChunk", { numVertices: vertices, numIndices: 3, lodMask: lodOf(c), vertexFactory: 0,
    chunkIndices: O("rendIndexBufferChunk", { pe: "IBCT_IndexUShort", teOffset: 0 }),
    chunkVertices: O("rendVertexBufferChunk", { byteOffsets: { Elements: [offsetOf(c), 0, 0, 0, 0] },
      vertexLayout: O("GpuWrapApiVertexLayoutDesc", { elements: { Elements: [element] }, slotStrides: { Elements: [stride, 0, 0, 0, 0] } }) }) });
  const header = O("rendRenderMeshBlobHeader", { vertexBufferSize: vbytes, indexBufferOffset: vbytes, indexBufferSize: ibytes, quantizationScale: v4(1),
    quantizationOffset: v4(0), bonePositions: [], renderChunkInfos: Array.from({ length: chunks }, (_, c) => chunk(c)) });
  return new RedHandle(O("rendRenderMeshBlob", { header: new RedHandle(header), renderBuffer: new RedBuffer(0, buffer.length, () => buffer) }));
}
const mesh = (renderResourceBlob: RedHandle): RedDocument => ({ root: O("CMesh", { renderResourceBlob, parameters: [], appearances: [] }) }) as unknown as RedDocument;

test("NATIVE-58: chunks pointing at one vertex range are refused before anything is decoded", () => {
  // The review's reproduction, scaled down: every chunk at offset 0 of a buffer holding one chunk's vertices.
  expect(kind(() => meshGeometry(mesh(blob(8, 1000, () => 0))))).toBe("malformed");
  expect(() => meshGeometry(mesh(blob(8, 1000, () => 0)))).toThrow(/LOD 1 chunks read 64000 vertex bytes \(8000 distinct\) of a 8000-byte vertex buffer/);
  // The same chunks in ranges of their own decode; a few chunks may share a stream (the vanilla earrings' instanced copies do), and a
  // LOD 2 chunk LOD 1's range (as hair meshes' do).
  expect(meshGeometry(mesh(blob(8, 1000, c => c * 8000))).vertices).toBe(8000);
  expect(meshGeometry(mesh(blob(2, 1000, () => 0))).vertices).toBe(2000);
  expect(meshGeometry(mesh(blob(2, 1000, () => 0, c => c ? 2 : 1))).vertices).toBe(1000);
  // Distinct ranges past the buffer are refused however few chunks read them.
  expect(kind(() => meshGeometry(mesh(blob(2, 1000, c => c * 4000))))).toBe("malformed");
});

test("NATIVE-58: the output budget counts the decode's peak, about 640 bytes a vertex, not the GLB's 150", () => {
  const limits: MeshLimits = { ...DEFAULT_MESH_LIMITS, maxOutputBytes: 1_000_000 };
  // 2,000 vertices: 1.28 MB at the peak (under the old estimate 0.3 MB, which let it through).
  expect(kind(() => meshGeometry(mesh(blob(2, 1000, c => c * 8000)), limits))).toBe("over-budget");
  expect(kind(() => meshGeometry(mesh(blob(1, 1000, () => 0)), limits))).toBe("ok");
});

/** A morph target over a base blob of `chunks` one-triangle chunks, with `targets` targets that move nothing. */
function morph(chunks: number, targets: number): RedDocument {
  const baseBlob = blob(chunks, 3, c => c * 24);
  const header = O("rendRenderMorphTargetMeshBlobHeader", { numTargets: targets, targetStartsInVertexDiffs: Array(targets).fill(0),
    targetStartsInVertexDiffsMapping: Array(targets).fill(0), targetPositionDiffScale: Array.from({ length: targets }, () => v4(1)),
    targetPositionDiffOffset: Array.from({ length: targets }, () => v4(0)), numVertexDiffsInEachChunk: Array.from({ length: targets }, () => Array(chunks).fill(0)),
    numVertexDiffsMappingInEachChunk: Array.from({ length: targets }, () => Array(chunks).fill(0)) });
  return { root: O("MorphTargetMesh", { blob: new RedHandle(O("rendRenderMorphTargetMeshBlob", { baseBlob, header: new RedHandle(header), diffsBuffer: null, mappingBuffer: null })),
    targets: Array.from({ length: targets }, (_, i) => O("MorphTargetMeshEntry", { name: { $value: `t${i}` }, regionName: { $value: "r" } })) }) } as unknown as RedDocument;
}

test("NATIVE-59: targets times chunks is capped before any header table is walked", () => {
  // The review's 1024 × 1024 (about 100 MB of empty accessors), scaled: the cap sits at 16,384.
  expect(DEFAULT_MESH_LIMITS.maxTargetChunks).toBe(16_384);
  expect(kind(() => morphGeometry(morph(128, 129), null))).toBe("over-budget");
  expect(() => morphGeometry(morph(128, 129), null)).toThrow(/129 targets on 128 chunks/);
  const small: MeshLimits = { ...DEFAULT_MESH_LIMITS, maxTargetChunks: 16 };
  expect(kind(() => morphGeometry(morph(8, 4), null, small))).toBe("over-budget");
  expect(morphGeometry(morph(8, 2), null, small).targets).toBe(2);
});

test("NATIVE-59: each chunk's diff and mapping starts are running sums, read without re-summing", () => {
  const document = morph(4, 2);
  const header = (document.root.fields.blob as RedHandle).target!.fields.header as RedHandle;
  // Target 1 moves one vertex on chunks 1 and 3 (two mapping entries a chunk, one of them padding): its starts step over them.
  const fields = header.target!.fields as Record<string, unknown>;
  fields.numVertexDiffsInEachChunk = [[0, 0, 0, 0], [0, 1, 0, 1]];
  fields.numVertexDiffsMappingInEachChunk = [[0, 0, 0, 0], [0, 1, 0, 1]];
  const diffs = new Uint8Array(24), mapping = new Uint8Array(8);
  new DataView(diffs.buffer).setUint32(12, 1023, true);
  new DataView(mapping.buffer).setUint16(4, 2, true);
  const blobFields = (document.root.fields.blob as RedHandle).target!.fields as Record<string, unknown>;
  blobFields.diffsBuffer = new RedBuffer(0, diffs.length, () => diffs);
  blobFields.mappingBuffer = new RedBuffer(0, mapping.length, () => mapping);
  const layout = morphTargetLayout(document.root);
  expect([layout.targets[1]!.diffStarts, layout.targets[1]!.mappingStarts]).toEqual([[0, 0, 1, 1], [0, 0, 2, 2]]);
  expect(Array.from(chunkDeltas(layout, 1, 1).vertices)).toEqual([0]);
  expect(Array.from(chunkDeltas(layout, 1, 3).vertices)).toEqual([2]);
  expect(chunkDeltas(layout, 1, 3).positions[0]).toBe(1);
});

test("NATIVE-65: a fixed array stores at most its size, whatever count the file gives", () => {
  const ctx = { session: new DecodeSession() } as unknown as ValueContext;
  const stored = (count: number, bytes: number) => { const out = new Uint8Array(4 + bytes); new DataView(out.buffer).setUint32(0, count, true); return new Cursor(out); };
  expect(readValue(ctx, stored(8, 8), "static:8,Uint8", "L.slotStrides")).toEqual({ Elements: [0, 0, 0, 0, 0, 0, 0, 0] });
  expect(readValue(ctx, stored(2, 2), "static:8,Uint8", "L.slotStrides")).toEqual({ Elements: [0, 0] });
  expect(() => readValue(ctx, stored(9, 9), "static:8,Uint8", "L.slotStrides")).toThrow(NativeMalformedError);
  expect(() => readValue(ctx, stored(2001, 2001), "static:32,Uint8", "L.elements")).toThrow(/2001 elements stored where it holds 32/);
  expect(() => readValue(ctx, stored(5, 10), "[4]Uint16", "C.samples")).toThrow(/5 elements stored where it holds 4/);
});

/** One chunk of `vertices` vertices in one stream: positions, then `extra` elements of the given usages (4 bytes each), one triangle. */
function layoutBlob(vertices: number, extra: { usage: string; type: string }[]) {
  const stride = 8 + 4 * extra.length, vbytes = vertices * stride, ibytes = 6;
  const buffer = new Uint8Array(vbytes + ibytes);
  new DataView(buffer.buffer).setUint16(vbytes + 2, 1, true);
  new DataView(buffer.buffer).setUint16(vbytes + 4, 2, true);
  const element = (usage: string, type: string, usageIndex: number) => O("GpuWrapApiVertexPackingPackingElement", { usage, type, streamType: "ST_PerVertex", streamIndex: 0, usageIndex });
  const counts = new Map<string, number>();
  const elements = [element("PS_Position", "PT_Short4N", 0), ...extra.map(({ usage, type }) => { const i = counts.get(usage) ?? 0; counts.set(usage, i + 1); return element(usage, type, i); })];
  const chunk = O("rendChunk", { numVertices: vertices, numIndices: 3, lodMask: 1, vertexFactory: 0, chunkIndices: O("rendIndexBufferChunk", { pe: "IBCT_IndexUShort", teOffset: 0 }),
    chunkVertices: O("rendVertexBufferChunk", { byteOffsets: { Elements: [0, 0, 0, 0, 0] },
      vertexLayout: O("GpuWrapApiVertexLayoutDesc", { elements: { Elements: elements }, slotStrides: { Elements: [stride, 0, 0, 0, 0] } }) }) });
  const header = O("rendRenderMeshBlobHeader", { vertexBufferSize: vbytes, indexBufferOffset: vbytes, indexBufferSize: ibytes, quantizationScale: v4(1),
    quantizationOffset: v4(0), bonePositions: [], renderChunkInfos: [chunk] });
  return new RedHandle(O("rendRenderMeshBlob", { header: new RedHandle(header), renderBuffer: new RedBuffer(0, buffer.length, () => buffer) }));
}
const uvSets = (count: number) => Array.from({ length: count }, () => ({ usage: "PS_TexCoord", type: "PT_Float16_2" }));

test("NATIVE-65: a vertex layout holds at most 32 elements, and only the two UV sets the GLB carries are decoded", () => {
  // The review's 2,000 UV sets (a 96 MB buffer cost 315 MB), scaled: past the layout's 32 elements it is refused before decoding.
  expect(kind(() => meshGeometry(mesh(layoutBlob(100, uvSets(2000)))))).toBe("malformed");
  expect(() => meshBlob(layoutBlob(100, uvSets(32)))).toThrow(/lists 33 elements \(a layout holds 32\)/);
  // Within it, every set but the first two is left alone.
  const blob = meshBlob(layoutBlob(100, uvSets(31)));
  const decoded = decodeChunk(blob, blob.chunks[0]!, blob.buffer());
  expect(decoded.uvs).toHaveLength(2);
  expect(decoded.uvs[0]!.length).toBe(200);
  expect(meshGeometry(mesh(layoutBlob(100, uvSets(31)))).vertices).toBe(100);
});

test("NATIVE-65: the output estimate counts a skin of more than eight influences", () => {
  // 31 skin-index elements: 124 influences, 232 decoded bytes a vertex past the 640 the estimate held for every layout.
  const skin = Array.from({ length: 31 }, () => ({ usage: "PS_SkinIndices", type: "PT_UByte4" }));
  const tight: MeshLimits = { ...DEFAULT_MESH_LIMITS, maxOutputBytes: 700_000 }, room: MeshLimits = { ...DEFAULT_MESH_LIMITS, maxOutputBytes: 900_000 };
  expect(kind(() => meshGeometry(mesh(layoutBlob(1000, skin)), tight))).toBe("over-budget");
  expect(kind(() => meshGeometry(mesh(layoutBlob(1000, skin)), room))).not.toBe("over-budget");
  // Eight influences cost what they did.
  expect(kind(() => meshGeometry(mesh(layoutBlob(1000, skin.slice(0, 2))), { ...DEFAULT_MESH_LIMITS, maxOutputBytes: 650_000 }))).not.toBe("over-budget");
});

test("NATIVE-66: morph targets reading one range together are refused before any delta is read", () => {
  /** `targets` targets over a one-chunk base, each reading the same `diffs` diffs from the start of buffers that hold them once. */
  const shared = (targets: number, diffs: number) => {
    const document = morph(1, targets);
    const blobFields = (document.root.fields.blob as RedHandle).target!.fields as Record<string, unknown>;
    const fields = (blobFields.header as RedHandle).target!.fields as Record<string, unknown>;
    fields.numVertexDiffsInEachChunk = Array.from({ length: targets }, () => [diffs]);
    fields.numVertexDiffsMappingInEachChunk = Array.from({ length: targets }, () => [Math.ceil(diffs / 2)]);
    const diffBytes = new Uint8Array(diffs * 12), mappingBytes = new Uint8Array(Math.ceil(diffs / 2) * 4);
    blobFields.diffsBuffer = new RedBuffer(0, diffBytes.length, () => diffBytes);
    blobFields.mappingBuffer = new RedBuffer(0, mappingBytes.length, () => mappingBytes);
    return document;
  };
  // The review's targets sharing one range (about 14 s), scaled: 64 targets on 10,000 diffs.
  const began = performance.now();
  expect(kind(() => morphGeometry(shared(64, 10_000), null))).toBe("malformed");
  expect(() => morphTargetLayout(shared(64, 10_000).root)).toThrow(/read 30000 diffs of a 10000-diff buffer/);
  expect(performance.now() - began).toBeLessThan(1000);
  // Targets reading their own ranges, or two sharing one, still decode.
  expect(morphGeometry(shared(2, 10_000), null).targets).toBe(2);
});
