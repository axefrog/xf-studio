// Native mesh reader (phase 4): the render blob's layout and its refusals, WolvenKit's GLB conventions (space, UVs, skin, double-sided
// chunks, garment support, material names, joints), morph targets (sparse deltas, mapping padding, base-mesh joints), the worker's
// geometry message, the native-first exporter and a mutation fuzz. Synthetic data only; the real-data comparison with WolvenKit's GLBs
// is tools/native-mesh-oracle.ts (knowledge/archive-format.md §11).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveExportSource, type ExportAnswer, type ExportRequest, type GameAssetExporter } from "../src/game-asset-export";
import { accessorFloats, parseGlb, readAccessor, type Glb } from "../src/glb";
import { createNativeGeometryExporter, NATIVE_MESH_IDENTITY, type GeometryDecoder } from "../src/native-geometry-export";
import { NativeDecoders } from "../src/native-texture-export";
import { NativeArchivePool } from "../src/native/archive-reader";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { decodeGeometryFromPool, MESH_READ_LIMITS } from "../src/native/mesh-decode";
import { dec4, halfToFloat } from "../src/native/mesh-blob";
import { meshGeometry, morphGeometry } from "../src/native/mesh-glb";
import { InProcessDecoder, WorkerDecoder } from "../src/native/native-decode";
import { classifyNativeFailure } from "../src/native/native-errors";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Bytes, Cr2wBuilder, prop, v, type Prop } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const tempRoot = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-mesh-")); roots.push(root); return root; };
const f = Math.fround;

// ---------------------------------------------------------------------------------------------------------------------------------
// A synthetic render blob: chunks of skinned vertices in the character layout (stream 0 position + skin (+ garment offset), 1 UV0,
// 2 normal + tangent, 3 colour + UV1), 16-bit indices after the vertex data.

type Vertex = { p: [number, number, number]; n: number; t: number; uv0: [number, number]; uv1: [number, number]; color: [number, number, number, number];
  joints: number[]; weights: number[]; extra?: [number, number, number] };
type ChunkSpec = { vertices: Vertex[]; indices: number[]; lod?: number; influences?: 4 | 8; extra?: boolean; indexType?: string; positionType?: string };

const half = (value: number) => { // float → half bits (exact for the test's values)
  const f32 = new Float32Array([value]), u = new Uint32Array(f32.buffer)[0]!;
  const sign = (u >>> 16) & 0x8000, exp = ((u >>> 23) & 0xff) - 127 + 15, mant = (u >>> 13) & 0x3ff;
  return value === 0 ? sign : sign | (exp << 10) | mant;
};
const packDec4 = (x: number, y: number, z: number, w: number) => ((Math.round((x + 1) * 1023 / 2)) | (Math.round((y + 1) * 1023 / 2) << 10) | (Math.round((z + 1) * 1023 / 2) << 20) | (w << 30)) >>> 0;
const SCALE: [number, number, number] = [0.5, 0.5, 2], OFFSET: [number, number, number] = [0, 0, 1];

function renderBuffer(chunks: ChunkSpec[]) {
  const vertex = new Bytes(), index = new Bytes();
  const layouts = chunks.map(chunk => {
    const k = chunk.influences ?? 8, stride0 = 8 + 2 * k + (chunk.extra ? 8 : 0);
    const offsets = [0, 0, 0, 0, 0];
    offsets[0] = vertex.length;
    for (const vtx of chunk.vertices) {
      for (let c = 0; c < 3; c++) vertex.i16(Math.round((vtx.p[c]! - OFFSET[c]!) / SCALE[c]! * 32767));
      vertex.i16(32767);
      for (let e = 0; e < k; e++) vertex.u8(vtx.joints[e] ?? 0);
      for (let e = 0; e < k; e++) vertex.u8(vtx.weights[e] ?? 0);
      if (chunk.extra) { for (const value of vtx.extra ?? [0, 0, 0]) vertex.u16(half(value)); vertex.u16(0); }
    }
    offsets[1] = vertex.length;
    for (const vtx of chunk.vertices) vertex.u16(half(vtx.uv0[0])).u16(half(vtx.uv0[1]));
    offsets[2] = vertex.length;
    for (const vtx of chunk.vertices) vertex.u32(vtx.n).u32(vtx.t);
    offsets[3] = vertex.length;
    for (const vtx of chunk.vertices) vertex.bytes(vtx.color).u16(half(vtx.uv1[0])).u16(half(vtx.uv1[1]));
    return { offsets, stride0, k };
  });
  const vertexSize = vertex.length;
  const indexOffsets = chunks.map(chunk => { const at = index.length; for (const i of chunk.indices) index.u16(i); return at; });
  const buffer = new Uint8Array(vertexSize + index.length);
  buffer.set(vertex.done()); buffer.set(index.done(), vertexSize);
  return { buffer, vertexSize, indexSize: index.length, layouts, indexOffsets };
}

const element = (usage: string, type: string, stream: number, usageIndex = 0, streamType?: string) => v.struct([prop("type", "GpuWrapApiVertexPackingePackingType", v.enum(type)),
  prop("usage", "GpuWrapApiVertexPackingePackingUsage", v.enum(usage)), ...(usageIndex ? [prop("usageIndex", "Uint8", v.u8(usageIndex))] : []),
  ...(stream ? [prop("streamIndex", "Uint8", v.u8(stream))] : []), ...(streamType ? [prop("streamType", "GpuWrapApiVertexPackingEStreamType", v.enum(streamType))] : [])]);
const staticList = (items: ((w: Bytes, f: Cr2wBuilder) => void)[]) => v.array(items);
const vector4 = (x: number, y: number, z: number, w: number) => v.struct([prop("X", "Float", v.f32(x)), prop("Y", "Float", v.f32(y)), prop("Z", "Float", v.f32(z)), prop("W", "Float", v.f32(w))]);

/** A `rendRenderMeshBlob` export's properties for `chunks` (the buffer registered in `file`). */
function blobProps(file: Cr2wBuilder, chunks: ChunkSpec[], bones: number): Prop[] {
  const data = renderBuffer(chunks);
  const buffer = file.buffer(data.buffer);
  const chunkInfos = chunks.map((chunk, i) => {
    const layout = data.layouts[i]!, k = layout.k;
    const elements = [element("PS_Position", chunk.positionType ?? "PT_Short4N", 0), ...Array.from({ length: k / 4 }, (_, s) => element("PS_SkinIndices", "PT_UByte4", 0, s)),
      ...Array.from({ length: k / 4 }, (_, s) => element("PS_SkinWeights", "PT_UByte4N", 0, s)), element("PS_TexCoord", "PT_Float16_2", 1), element("PS_Normal", "PT_Dec4", 2),
      element("PS_Tangent", "PT_Dec4", 2), element("PS_Color", "PT_Color", 3), element("PS_TexCoord", "PT_Float16_2", 3, 1),
      ...(chunk.extra ? [element("PS_ExtraData", "PT_Float16_4", 0)] : []), element("PS_InstanceTransform", "PT_Float4", 7, 0, "ST_PerInstance"),
      element("PS_Invalid", "PT_Invalid", 0, 0, "ST_Invalid")];
    return v.struct([
      prop("chunkVertices", "rendVertexBufferChunk", v.struct([
        prop("vertexLayout", "GpuWrapApiVertexLayoutDesc", v.struct([prop("elements", "static:32,GpuWrapApiVertexPackingPackingElement", staticList(elements)),
          prop("slotStrides", "static:8,Uint8", staticList([layout.stride0, 4, 8, 8, 0, 0, 0, 64].map(s => v.u8(s))))])),
        prop("byteOffsets", "static:5,Uint32", staticList(layout.offsets.map(o => v.u32(o))))])),
      prop("chunkIndices", "rendIndexBufferChunk", v.struct([prop("pe", "GpuWrapApieIndexBufferChunkType", v.enum(chunk.indexType ?? "IBCT_IndexUShort")),
        ...(data.indexOffsets[i] ? [prop("teOffset", "Uint32", v.u32(data.indexOffsets[i]!))] : [])])),
      prop("numVertices", "Uint16", v.u16(chunk.vertices.length)), prop("numIndices", "Uint32", v.u32(chunk.indices.length)),
      prop("vertexFactory", "Uint8", v.u8(k === 8 ? 4 : 3)), prop("lodMask", "Uint8", v.u8(chunk.lod ?? 1))]);
  });
  return [prop("header", "rendRenderMeshBlobHeader", v.struct([
    prop("bonePositions", "array:Vector4", v.array(Array.from({ length: bones }, (_, b) => vector4(0.1 * b, 0, 1, 1)))),
    prop("renderChunkInfos", "array:rendChunk", v.array(chunkInfos)),
    prop("quantizationScale", "Vector4", vector4(...SCALE, 0)), prop("quantizationOffset", "Vector4", vector4(...OFFSET, 1)),
    prop("vertexBufferSize", "Uint32", v.u32(data.vertexSize)), prop("indexBufferSize", "Uint32", v.u32(data.indexSize)),
    prop("indexBufferOffset", "Uint32", v.u32(data.vertexSize))])),
    prop("renderBuffer", "DataBuffer", v.buffer(buffer))];
}

/** A translation-only rig matrix (System.Numerics row layout): the bone sits at (x, y, z), so the matrix translates by its negation. */
const rigMatrix = (x: number, y: number, z: number) => v.struct([prop("X", "Vector4", vector4(1, 0, 0, 0)), prop("Y", "Vector4", vector4(0, 1, 0, 0)),
  prop("Z", "Vector4", vector4(0, 0, 1, 0)), prop("W", "Vector4", vector4(-x, -y, -z, 1))]);

type MeshOptions = { chunks: ChunkSpec[]; bones?: string[]; bonePositions?: number; appearances?: string[][]; garment?: "support" | "flags" | "short"; cloth?: boolean };
function meshResource(o: MeshOptions): Uint8Array {
  const file = new Cr2wBuilder();
  const bones = o.bones ?? ["Root", "Spine"];
  const appearances = o.appearances ?? [["mat_a", "mat_b"]];
  // Export 0 is the CMesh; appearances, parameters and the blob follow.
  const params: number[] = [];
  const mesh: Prop[] = [];
  file.export("CMesh", mesh);
  const appearanceIndexes = appearances.map((list, i) => file.export("meshMeshAppearance", [prop("name", "CName", v.cname(`app${i}`)),
    prop("chunkMaterials", "array:CName", v.array(list.map(name => v.cname(name))))]));
  if (o.garment) params.push(file.export("meshMeshParamGarmentSupport", [prop("customMorph", "Bool", v.bool(true))]));
  if (o.garment === "flags" || o.garment === "short") {
    const chunks = o.chunks.map(chunk => {
      const n = chunk.vertices.length * (o.garment === "short" ? 2 : 4);
      const flags = file.buffer(Uint8Array.from({ length: n }, (_, i) => i % 4 === 0 ? 51 : i % 4 === 1 ? 3 : 0));
      return v.struct([prop("numVertices", "Uint32", v.u32(chunk.vertices.length)), prop("garmentFlags", "DataBuffer", v.buffer(flags))]);
    });
    params.push(file.export("garmentMeshParamGarment", [prop("chunks", "array:garmentMeshParamGarmentChunkData", v.array(chunks))]));
  }
  if (o.cloth) params.push(file.export("meshMeshParamCloth", []));
  const blob = file.export("rendRenderMeshBlob", blobProps(file, o.chunks, o.bonePositions ?? bones.length));
  mesh.push(prop("parameters", "array:handle:meshMeshParameter", v.array(params.map(i => v.handle(i)))),
    prop("appearances", "array:handle:meshMeshAppearance", v.array(appearanceIndexes.map(i => v.handle(i)))),
    prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(blob)),
    prop("boneNames", "array:CName", v.array(bones.map(name => v.cname(name)))),
    prop("boneRigMatrices", "array:Matrix", v.array(bones.map((_, b) => rigMatrix(0.1 * b, 0.2, 1.5)))));
  return file.build();
}

type Target = { name: string; region: string; perChunk: { vertices: number[]; deltas: [number, number, number][]; normal?: number; stored?: number }[] };
function morphResource(o: { chunks: ChunkSpec[]; baseMesh: string; targets: Target[] }): Uint8Array {
  const file = new Cr2wBuilder();
  const root: Prop[] = [];
  file.export("MorphTargetMesh", root);
  const baseBlob = file.export("rendRenderMeshBlob", blobProps(file, o.chunks, 2));
  const diffs = new Bytes(), mapping = new Bytes();
  const starts: number[] = [], mapStarts: number[] = [], counts: number[][] = [], mapCounts: number[][] = [];
  for (const target of o.targets) {
    starts.push(diffs.length / 12); mapStarts.push(mapping.length / 4);
    const c: number[] = [], m: number[] = [];
    for (const chunk of target.perChunk) {
      c.push(chunk.deltas.length); m.push(chunk.stored ?? Math.ceil(chunk.vertices.length / 2));
      if (chunk.stored === 0) continue; // A slip in the counts: nothing is stored for the chunk.
      for (const d of chunk.deltas) diffs.u32(((d[0]! & 0x3ff) | ((d[1]! & 0x3ff) << 10) | ((d[2]! & 0x3ff) << 20)) >>> 0).u32(chunk.normal ?? packDec4(0, 0, 0, 0)).u32(packDec4(0.5, 0, 0, 0));
      for (const vertex of chunk.vertices) mapping.u16(vertex);
      if (chunk.vertices.length % 2) mapping.u16(0xffff);
    }
    counts.push(c); mapCounts.push(m);
  }
  const diffBuffer = file.buffer(diffs.done()), mapBuffer = file.buffer(mapping.done());
  const blob = file.export("rendRenderMorphTargetMeshBlob", [
    prop("header", "rendRenderMorphTargetMeshBlobHeader", v.struct([prop("numTargets", "Uint32", v.u32(o.targets.length)),
      prop("targetStartsInVertexDiffs", "array:Uint32", v.array(starts.map(s => v.u32(s)))),
      prop("targetStartsInVertexDiffsMapping", "array:Uint32", v.array(mapStarts.map(s => v.u32(s)))),
      prop("targetPositionDiffScale", "array:Vector4", v.array(o.targets.map(() => vector4(1023, 1023, 1023, 0)))),
      prop("targetPositionDiffOffset", "array:Vector4", v.array(o.targets.map(() => vector4(-1, 0, 0, 0)))),
      prop("numVertexDiffsInEachChunk", "array:array:Uint32", v.array(counts.map(list => v.array(list.map(n => v.u32(n)))))),
      prop("numVertexDiffsMappingInEachChunk", "array:array:Uint32", v.array(mapCounts.map(list => v.array(list.map(n => v.u32(n))))))])),
    prop("diffsBuffer", "DataBuffer", v.buffer(diffBuffer)), prop("mappingBuffer", "DataBuffer", v.buffer(mapBuffer)),
    prop("baseBlob", "handle:IRenderResourceBlob", v.handle(baseBlob))]);
  const baseImport = file.import(o.baseMesh);
  root.push(prop("baseMesh", "rRef:CMesh", v.ref(baseImport)),
    prop("targets", "array:MorphTargetMeshEntry", v.array(o.targets.map(t => v.struct([prop("name", "CName", v.cname(t.name)), prop("regionName", "CName", v.cname(t.region))])))),
    prop("blob", "handle:IRenderResourceBlob", v.handle(blob)));
  return file.build();
}

const quad = (): Vertex[] => [
  { p: [0, 0, 1], n: packDec4(0, 0, 1, 0), t: packDec4(1, 0, 0, 3), uv0: [0, 0.25], uv1: [0.5, 0.75], color: [255, 0, 51, 255], joints: [0, 1, 0, 0, 0, 0, 0, 0], weights: [128, 127] },
  { p: [0.25, 0, 1], n: packDec4(0, 0, 1, 0), t: packDec4(1, 0, 0, 0), uv0: [1, 0.25], uv1: [0, 0], color: [0, 0, 0, 0], joints: [1], weights: [255] },
  { p: [0.25, 0.5, 1.5], n: packDec4(0.6, 0, 0.8, 0), t: packDec4(0, 1, 0, 0), uv0: [1, 1], uv1: [0, 0], color: [0, 0, 0, 0], joints: [5], weights: [0] },
  { p: [0, 0.5, 2], n: packDec4(0, 0, 1, 0), t: packDec4(1, 0, 0, 0), uv0: [0, 1], uv1: [0, 0], color: [0, 0, 0, 0], joints: [1, 0], weights: [1, 1] },
];
const values = (glb: Glb, index: number) => Array.from(accessorFloats(readAccessor(glb, index)));
const read = (bytes: Uint8Array) => readCr2w(bytes, fakeDecompress, new DecodeSession(MESH_READ_LIMITS));

test("10:10:10:2 and half floats decode as WolvenKit reads them", () => {
  const out = new Float32Array(4);
  dec4(0, out, 0); expect(Array.from(out)).toEqual([-1, -1, -1, 1]);
  dec4(packDec4(1, 1, 1, 3), out, 0); expect(Array.from(out)).toEqual([1, 1, 1, -1]);
  dec4((511 | (1 << 30)) >>> 0, out, 0); expect(out[0]).toBe(f(f(f(511 * 2) * f(1 / 1023)) - 1)); expect(out[3]).toBe(0);
  expect([halfToFloat(0x3c00), halfToFloat(0xc000), halfToFloat(0x0001), halfToFloat(0x7c00)]).toEqual([1, -2, 2 ** -24, Infinity]);
  expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
});

test("a mesh becomes WolvenKit's GLB: LOD 1 chunks, space swap, UV flip, skin, winding, materials and joints", () => {
  const lod2: ChunkSpec = { vertices: quad(), indices: [0, 1, 2], lod: 2 };
  const glbBytes = meshGeometry(read(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2, 0, 2, 3] }, lod2, { vertices: quad(), indices: [0, 1, 2], influences: 4 }],
    appearances: [["skin@v1"], []] }))).glb;
  const glb = parseGlb(glbBytes), json = glb.json;
  expect(json.meshes.map((mesh: { name: string }) => mesh.name)).toEqual(["submesh_00_LOD_1", "submesh_02_LOD_1"]);
  expect(json.extras).toEqual({ experimentalMergedMeshes: false });
  expect(json.nodes[0]).toMatchObject({ name: "Armature", children: [1, 2] });
  expect(json.nodes.slice(1, 3).map((node: { name: string }) => node.name)).toEqual(["Root", "Spine"]);
  expect(json.scenes[0].nodes).toEqual([0, 3, 4]);
  expect(json.nodes[3]).toEqual({ name: "submesh_00_LOD_1", mesh: 0, skin: 0 });
  // Materials: each appearance's list padded over every chunk by repeating its tail; `@` suffixes cut; an empty list is "default".
  expect(json.meshes[0].extras).toEqual({ materialNames: ["skin", "default"] });
  expect(json.meshes[1].extras).toEqual({ materialNames: ["skin", "default"] });
  const primitive = json.meshes[0].primitives[0];
  expect(Object.keys(primitive.attributes)).toEqual(["POSITION", "NORMAL", "TANGENT", "COLOR_0", "TEXCOORD_0", "TEXCOORD_1", "JOINTS_0", "WEIGHTS_0", "JOINTS_1", "WEIGHTS_1"]);
  // Positions: short/32767 · scale + offset in single precision, then (x, z, −y).
  const q = (value: number, c: number) => f(f(f(Math.round((value - OFFSET[c]!) / SCALE[c]! * 32767) / 32767) * f(SCALE[c]!)) + f(OFFSET[c]!));
  const p = values(glb, primitive.attributes.POSITION);
  expect(p.slice(6, 9)).toEqual([q(0.25, 0), q(1.5, 2), f(-q(0.5, 1))]);
  // Normals normalised after the swap; tangent w from the top bits (3 → −1).
  const n = values(glb, primitive.attributes.NORMAL);
  expect(Math.hypot(n[6]!, n[7]!, n[8]!)).toBeCloseTo(1, 6);
  expect(n[7]).toBeGreaterThan(0.7); // the stored z (0.8) is glTF's y
  expect(values(glb, primitive.attributes.TANGENT).slice(0, 4).map(x => Math.round(x) + 0)).toEqual([1, 0, 0, -1]);
  expect(values(glb, primitive.attributes.TEXCOORD_0).slice(0, 2)).toEqual([0, 0.75]);
  expect(values(glb, primitive.attributes.TEXCOORD_1).slice(0, 2)).toEqual([0.5, 0.75]);
  expect(values(glb, primitive.attributes.COLOR_0).slice(0, 4)).toEqual([1, 0, f(51 / 255), 1]);
  // Weights renormalised; a vertex weighing nothing is bound wholly to joint 0; indices kept past the first four.
  const w = values(glb, primitive.attributes.WEIGHTS_0), j = Array.from(readAccessor(glb, primitive.attributes.JOINTS_0).array);
  expect(w[0]! + w[1]!).toBeCloseTo(1, 6);
  expect(j.slice(8, 12)).toEqual([0, 0, 0, 0]); expect(w.slice(8, 12)).toEqual([1, 0, 0, 0]);
  expect(w.slice(12, 14)).toEqual([0.5, 0.5]);
  // Winding swapped (i1, i0, i2).
  expect(Array.from(readAccessor(glb, primitive.indices).array)).toEqual([1, 0, 2, 2, 0, 3]);
  // Four influences write one set.
  expect(Object.keys(json.meshes[1].primitives[0].attributes)).not.toContain("JOINTS_1");
  // Joints at the inverse of the rig matrix, in glTF space; inverse bind matrices undo them.
  expect(json.nodes[2].translation.map((x: number) => Number(x.toFixed(6)))).toEqual([0.1, 1.5, -0.2]);
  const ibm = values(glb, json.skins[0].inverseBindMatrices);
  expect(ibm.slice(28, 31).map(x => Number(x.toFixed(6)))).toEqual([-0.1, -1.5, 0.2]);
  expect(json.accessors[json.skins[0].inverseBindMatrices].name).toBe("Bind Matrices");
});

test("a double-sided chunk keeps its outward faces and is named _doubled; garment support becomes a target and two attributes", () => {
  const glb = parseGlb(meshGeometry(read(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2, 2, 1, 0], extra: true }], garment: "flags" }))).glb);
  const mesh = glb.json.meshes[0];
  expect(mesh.name).toBe("submesh_00_LOD_1_doubled");
  expect(readAccessor(glb, mesh.primitives[0].indices).count).toBe(3);
  expect(mesh.extras.targetNames).toEqual(["GarmentSupport"]);
  expect(values(glb, mesh.primitives[0].attributes._GARMENTSUPPORTWEIGHT).slice(0, 4)).toEqual([f(51 / 255), 0, 0, 1]);
  expect(values(glb, mesh.primitives[0].attributes._GARMENTSUPPORTCAP).slice(0, 4)).toEqual([3, 0, 0, 1]);
  // Short garment flags are left out, with a note (WolvenKit needs a repaired copy for such a mesh).
  const short = meshGeometry(read(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2] }], garment: "short" })));
  expect(Object.keys(parseGlb(short.glb).json.meshes[0].primitives[0].attributes)).not.toContain("_GARMENTSUPPORTWEIGHT");
  expect(short.notes[0]).toContain("garment support data is shorter");
});

test("a skin addressing more joints than bone positions takes them from the rig matrices; one past the bones is refused", () => {
  const chunk: ChunkSpec = { vertices: quad().map(vertex => ({ ...vertex, joints: [2], weights: [255] })), indices: [0, 1, 2] };
  const made = meshGeometry(read(meshResource({ chunks: [chunk], bones: ["A", "B", "C"], bonePositions: 1 })));
  expect(made.joints).toBe(3);
  expect(made.notes[0]).toContain("lists 1 bone position for 3 bones");
  expect(() => meshGeometry(read(meshResource({ chunks: [chunk], bones: ["A", "B"], bonePositions: 2 })))).toThrow(/joint 2 of a rig of 2/);
});

test("layouts and parameters the reader doesn't decode are refused as unsupported; bad indices as malformed", () => {
  const kind = (bytes: Uint8Array) => { try { meshGeometry(read(bytes)); return "ok"; } catch (error) { return classifyNativeFailure(error); } };
  expect(kind(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2], indexType: "IBCT_IndexUInt" }] }))).toBe("unsupported");
  expect(kind(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2], positionType: "PT_Float3" }] }))).toBe("unsupported");
  expect(kind(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 2] }], cloth: true }))).toBe("unsupported");
  expect(kind(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1, 9] }] }))).toBe("malformed");
  expect(kind(meshResource({ chunks: [{ vertices: quad(), indices: [0, 1] }] }))).toBe("malformed");
});

const morphTargets = (): Target[] => [
  // Chunk 0: three diffs (odd: one padding entry), vertex 1 repeated (the first diff wins); chunk 1: none.
  { name: "h01", region: "nose", perChunk: [{ vertices: [2, 1, 1], deltas: [[1023, 0, 0], [512, 1023, 0], [0, 0, 1023]] }, { vertices: [], deltas: [] }] },
  // Chunk 0 counts a diff but no mapping (read as none, taking no room); chunk 1: one diff.
  { name: "h02", region: "mouth", perChunk: [{ vertices: [0], deltas: [[1023, 1023, 1023]], stored: 0 }, { vertices: [3], deltas: [[0, 1023, 0]] }] },
];

test("a morph target becomes WolvenKit's GLB: sparse deltas, first mapping wins, padding and empty mappings, joints from the base mesh", () => {
  const chunks: ChunkSpec[] = [{ vertices: quad(), indices: [0, 1, 2] }, { vertices: quad(), indices: [0, 2, 3] }];
  const morph = read(morphResource({ chunks, baseMesh: "base\\m\\head.mesh", targets: morphTargets() }));
  const base = read(meshResource({ chunks, bones: ["Root", "Spine"] }));
  const glb = parseGlb(morphGeometry(morph, base).glb), json = glb.json;
  expect(json.extras).toBeUndefined();
  expect(json.skins[0].joints.length).toBe(2);
  expect(json.meshes[0].extras).toEqual({ targetNames: ["h01_nose", "h02_mouth"] });
  const targets = json.meshes[0].primitives[0].targets;
  expect(Object.keys(targets[0])).toEqual(["POSITION", "NORMAL", "TANGENT"]);
  expect(json.accessors[targets[0].POSITION].sparse).toBeDefined();
  // Position delta: field/1023 · scale + offset (scale 1023, offset −1 on x), then (x, z, −y).
  const t0 = values(glb, targets[0].POSITION).map(x => x + 0);
  expect(t0.slice(3, 6)).toEqual([f(f(f(512 / 1023) * 1023) - 1), 0, -1023]); // vertex 1: its first diff (512, 1023, 0)
  expect(t0.slice(6, 9)).toEqual([1022, 0, 0]); // vertex 2: (1023, 0, 0)
  expect(t0.slice(0, 3)).toEqual([0, 0, 0]); // vertex 0: not moved
  const second = values(glb, json.meshes[1].primitives[0].targets[1].POSITION).map(x => x + 0);
  expect(second.slice(9, 12)).toEqual([-1, 0, -1023]);
  expect(values(glb, json.meshes[0].primitives[0].targets[1].POSITION).every(x => x === 0)).toBe(true);
  // Tangent deltas are three components (w dropped).
  expect(json.accessors[targets[0].TANGENT].type).toBe("VEC3");
  // Without the base mesh: no skin, no joints, as WolvenKit writes it.
  const bare = parseGlb(morphGeometry(morph, null).glb).json;
  expect(bare.skins).toBeUndefined();
  expect(Object.keys(bare.meshes[0].primitives[0].attributes)).not.toContain("JOINTS_0");
});

function geometryArchive(files: Record<string, Uint8Array>): string {
  const path = join(tempRoot(), "meshes.archive");
  writeFileSync(path, syntheticArchive(Object.entries(files).map(([depotPath, bytes]) => ({ path: depotPath, segments: splitSegments(bytes) }))));
  return path;
}
/** A resource file's archive segments: the body, then each buffer (the extracted file is the body followed by its buffers as stored). */
function splitSegments(bytes: Uint8Array): { bytes: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const objectsEnd = view.getUint32(24, true), buffersAt = view.getUint32(40 + 5 * 12, true), count = view.getUint32(40 + 5 * 12 + 4, true);
  const segments = [{ bytes: bytes.subarray(0, objectsEnd) }];
  for (let i = 0; i < count; i++) {
    const at = buffersAt + i * 24, offset = view.getUint32(at + 8, true), size = view.getUint32(at + 12, true);
    segments.push({ bytes: bytes.subarray(offset, offset + size) });
  }
  return segments;
}

test("a mesh read from an archive becomes its GLB with its raw file, in-process and in the worker; a morph target finds its base mesh there", async () => {
  const chunks: ChunkSpec[] = [{ vertices: quad(), indices: [0, 1, 2] }, { vertices: quad(), indices: [0, 2, 3] }];
  const mesh = meshResource({ chunks });
  const archive = geometryArchive({ "base\\m\\head.mesh": mesh, "base\\m\\head.morphtarget": morphResource({ chunks, baseMesh: "base\\m\\head.mesh", targets: morphTargets() }),
    "base\\m\\lonely.morphtarget": morphResource({ chunks, baseMesh: "base\\m\\elsewhere.mesh", targets: morphTargets() }) });
  const pool = new NativeArchivePool(fakeDecompress);
  const outcome = decodeGeometryFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\head.mesh") });
  if (!outcome.ok) throw new Error(outcome.message);
  expect(outcome.geometry.raw).toEqual(pool.read(archive, depotHash("base\\m\\head.mesh"))!);
  expect([outcome.geometry.root, outcome.geometry.meshes, outcome.geometry.joints]).toEqual(["CMesh", 2, 2]);
  const morph = decodeGeometryFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\head.morphtarget") });
  expect(morph.ok && [morph.geometry.baseMesh, morph.geometry.joints, morph.geometry.targets]).toEqual(["read", 2, 2]);
  const lonely = decodeGeometryFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\lonely.morphtarget") });
  expect(lonely.ok && [lonely.geometry.baseMesh, lonely.geometry.joints]).toEqual(["absent", 0]);
  const missing = decodeGeometryFromPool(pool, fakeDecompress, { archivePath: archive, hash: depotHash("base\\m\\none.mesh") });
  expect(missing.ok ? "ok" : missing.kind).toBe("not-indexed");
  const inProcess = new InProcessDecoder(pool, fakeDecompress, { roots: new Set(), identity: "test" }, depotHash);
  expect((await inProcess.decodeGeometry({ archivePath: archive, hash: depotHash("base\\m\\head.mesh") })).ok).toBe(true);
  inProcess.close();
  expect((await inProcess.decodeGeometry({ archivePath: archive, hash: depotHash("base\\m\\head.mesh") })).ok).toBe(false);

  const worker = new WorkerDecoder({ decompressor: { test: "fakeDecompress" }, roots: new Set(), identity: "test", script: new URL("./fixtures/native-decode-test-worker.ts", import.meta.url) });
  try {
    const answered = await worker.decodeGeometry({ archivePath: archive, hash: depotHash("base\\m\\head.morphtarget") });
    if (!answered.ok) throw new Error(answered.message);
    expect(parseGlb(answered.geometry.glb).json.meshes[0].extras.targetNames).toEqual(["h01_nose", "h02_mouth"]);
    expect(answered.geometry.raw.length).toBeGreaterThan(0);
  } finally { worker.close(); }
});

test("the native-first exporter reads meshes itself, caches them by its identity, and hands refusals, materials requests and folders to WolvenKit", async () => {
  const chunks: ChunkSpec[] = [{ vertices: quad(), indices: [0, 1, 2] }];
  const archive = geometryArchive({ "base\\m\\ok.mesh": meshResource({ chunks }), "base\\m\\cloth.mesh": meshResource({ chunks, cloth: true }),
    "base\\m\\short.mesh": meshResource({ chunks, garment: "short" }) });
  const cacheRoot = join(tempRoot(), "exports"), glbFile = join(tempRoot(), "wk.glb");
  writeFileSync(glbFile, "wk");
  const asked: ExportRequest[][] = [];
  const inner: GameAssetExporter & { nativeTextures: { decoded: number } } = {
    tool: { key: "wk", label: "WolvenKit" },
    nativeTextures: { decoded: 7 },
    open() { throw new Error("not used"); },
    async exportAll(requests) {
      asked.push(requests.map(request => ({ ...request })));
      return requests.map((request): ExportAnswer => ({ textures: new Map(), masks: new Map(),
        geometry: new Map(request.geometry.map(path => [path, { depotPath: path, hash: depotHash(path), raw: glbFile, rawSha256: "", glb: glbFile, glbSha256: "",
          materials: null, materialsSha256: null, complete: true, cached: false }])) }));
    },
  };
  const pool = new NativeArchivePool(fakeDecompress);
  let decodes = 0;
  const decoder: GeometryDecoder = { decodeGeometry: async request => { decodes++; return decodeGeometryFromPool(pool, fakeDecompress, request); } };
  const exporter = createNativeGeometryExporter(inner, { cacheRoot, decoder: async () => decoder, onFallback: () => {} });
  expect((exporter as unknown as { nativeTextures: { decoded: number } }).nativeTextures.decoded).toBe(7);
  const source = archiveExportSource(archive, tempRoot());
  const request: ExportRequest = { source, geometry: ["base\\m\\ok.mesh", "base\\m\\cloth.mesh", "base\\m\\short.mesh"], textures: ["base\\t\\a.xbm"], masks: [] };
  const [answer] = await exporter.exportAll!([request]);
  const ok = answer!.geometry.get("base\\m\\ok.mesh")! as { glb: string; raw: string; rawSha256: string; cached: boolean; complete: boolean; readerNote?: string | null };
  expect([ok.cached, ok.complete, ok.readerNote]).toEqual([false, true, null]);
  expect(parseGlb(new Uint8Array(readFileSync(ok.glb))).json.meshes[0].name).toBe("submesh_00_LOD_1");
  expect(new Uint8Array(readFileSync(ok.raw))).toEqual(pool.read(archive, depotHash("base\\m\\ok.mesh"))!);
  expect((answer!.geometry.get("base\\m\\short.mesh") as { readerNote?: string }).readerNote).toContain("garment support data is shorter");
  expect(answer!.geometry.get("base\\m\\cloth.mesh")!.glb).toBe(glbFile);
  // WolvenKit was asked for the textures (geometry removed), then for the refused mesh alone.
  expect(asked.map(run => run.map(item => [item.geometry, item.textures]))).toEqual([[[[], ["base\\t\\a.xbm"]]], [[["base\\m\\cloth.mesh"], []]]]);
  expect(exporter.nativeGeometry).toMatchObject({ decoded: 2, fellBack: 1, byKind: { unsupported: 1 } });
  expect(exporter.has!("geometry", "base\\m\\ok.mesh", source)).toBe(true);
  // A later exporter is served from the cache without decoding.
  const again = createNativeGeometryExporter(inner, { cacheRoot, decoder: async () => decoder, onFallback: () => {} });
  const [second] = await again.exportAll!([{ ...request, geometry: ["base\\m\\ok.mesh"], textures: [] }]);
  expect(second!.geometry.get("base\\m\\ok.mesh")!.cached).toBe(true);
  expect(decodes).toBe(3);
  expect(NATIVE_MESH_IDENTITY).toMatch(/^xfs-native-mesh:\d+$/);
  // Geometry asked for with WolvenKit's materials file, and a folder of archives, go to WolvenKit.
  asked.length = 0;
  await again.exportAll!([{ ...request, geometry: ["base\\m\\ok.mesh"], textures: [], materials: true }]);
  await again.exportAll!([{ ...request, source: { archivePath: tempRoot(), fingerprint: "f", gameRoot: tempRoot() }, geometry: ["base\\m\\ok.mesh"], textures: [] }]);
  expect(asked.map(run => run[0]!.geometry)).toEqual([["base\\m\\ok.mesh"], ["base\\m\\ok.mesh"]]);
  expect(decodes).toBe(3);
  // No decoder: WolvenKit exports every mesh. Cancelled between meshes.
  const none = createNativeGeometryExporter(inner, { cacheRoot: join(tempRoot(), "e2"), decoder: async () => null, onFallback: () => {} });
  const [plain] = await none.exportAll!([{ ...request, textures: [] }]);
  expect(plain!.geometry.get("base\\m\\ok.mesh")!.glb).toBe(glbFile);
  const controller = new AbortController();
  controller.abort();
  const cancelled = createNativeGeometryExporter(inner, { cacheRoot: join(tempRoot(), "e3"), decoder: async () => decoder, onFallback: () => {} });
  await expect(cancelled.exportAll!([{ ...request, textures: [] }], controller.signal)).rejects.toMatchObject({ code: "cancelled" });
});

test("mesh decoders log in their own words when they can't open", async () => {
  const lines: string[] = [];
  const decoders = new NativeDecoders({ env: {}, log: line => lines.push(line), label: { reader: "mesh reader", what: "meshes" },
    open: async () => ({ decoder: null, reason: "no library", permanent: true }) });
  expect(await decoders.get(tempRoot())).toBeNull();
  expect(lines).toEqual(["XF Studio's mesh reader is off for this game folder, so WolvenKit exports meshes: no library"]);
});

test("mutated meshes and morph targets never fail inside the reader", () => {
  let seed = 0x3e5b;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const chunks: ChunkSpec[] = [{ vertices: quad(), indices: [0, 1, 2, 2, 1, 0], extra: true }, { vertices: quad(), indices: [0, 2, 3], influences: 4 }];
  const base = meshResource({ chunks, garment: "flags" });
  const bases = [base, morphResource({ chunks, baseMesh: "base\\m\\head.mesh", targets: morphTargets() })];
  const baseDocument = read(base);
  const internal: string[] = [];
  let slowest = 0;
  for (let n = 0; n < 2400; n++) {
    const bytes = bases[n % bases.length]!.slice();
    for (let k = 1 + Math.floor(random() * 4); k > 0; k--) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
    const began = performance.now();
    try {
      const document = read(bytes);
      if (document.root.type === "MorphTargetMesh") morphGeometry(document, n % 4 === 1 ? baseDocument : null);
      else meshGeometry(document);
    } catch (error) { if (classifyNativeFailure(error) === "internal") internal.push(String((error as Error).stack ?? error)); }
    slowest = Math.max(slowest, performance.now() - began);
  }
  expect(internal.slice(0, 3)).toEqual([]);
  expect(slowest).toBeLessThan(2000);
});
