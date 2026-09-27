// The native mesh reader's budgets against crafted render blobs (the code-health review at 9f71a56, NATIVE-58 and NATIVE-59, scaled
// down from its reproductions): chunks can't share one vertex range, the output estimate is the decode's real peak, and targets times
// chunks is capped. Red models built directly (no CR2W), synthetic data only.
import { expect, test } from "bun:test";
import { DEFAULT_MESH_LIMITS, type MeshLimits } from "../src/native/mesh-blob";
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
