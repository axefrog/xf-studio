// Synthetic, asset-free stand-ins for WolvenKit's JSON form of the head mesh and morph target.
// Layout mirrors the audited head: skinned stream 0 with ExtraData, UV, shading, colour/UV1,
// a light-blocker stream and an unused per-instance stream.
import { idListSha256, parseEyePlateRecipe, type EyePlateRecipe } from "../src/eye-plate-recipe";

const layoutElements = [
  [0, "PT_Short4N", "PS_Position", 0], [0, "PT_UByte4", "PS_SkinIndices", 0], [0, "PT_UByte4", "PS_SkinIndices", 1],
  [0, "PT_UByte4N", "PS_SkinWeights", 0], [0, "PT_UByte4N", "PS_SkinWeights", 1], [1, "PT_Float16_2", "PS_TexCoord", 0],
  [2, "PT_Dec4", "PS_Normal", 0], [2, "PT_Dec4", "PS_Tangent", 0], [3, "PT_Color", "PS_Color", 0], [3, "PT_Float16_2", "PS_TexCoord", 1],
  [0, "PT_Float16_4", "PS_ExtraData", 0],
] as const;
const strides = [32, 4, 8, 8, 4, 0, 0, 64];
const align16 = (value: number) => Math.ceil(value / 16) * 16;

/** A 3×3 grid of vertices (8 triangles). Every byte encodes (vertex, stream, offset) so copies are traceable. */
export const GRID_TRIANGLES = [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4], [3, 4, 7], [3, 7, 6], [4, 5, 8], [4, 8, 7]];
export const VERTEX_COUNT = 9;

function renderBlob(seed: number) {
  const offsets: number[] = [];
  let cursor = 0;
  const parts: Buffer[] = [];
  for (let stream = 0; stream < 5; stream++) {
    const start = align16(cursor);
    if (start > cursor) parts.push(Buffer.alloc(start - cursor));
    offsets.push(start);
    const block = Buffer.alloc(strides[stream] * VERTEX_COUNT);
    for (let index = 0; index < block.length; index++) block[index] = (seed + stream * 37 + index * 7) & 0xff;
    parts.push(block);
    cursor = start + block.length;
  }
  const indexOffset = align16(cursor);
  const indices = Buffer.alloc(GRID_TRIANGLES.length * 6);
  GRID_TRIANGLES.flat().forEach((vertex, at) => indices.writeUInt16LE(vertex, at * 2));
  const raw = Buffer.concat([...parts, Buffer.alloc(indexOffset - cursor), indices]);
  return {
    $type: "rendRenderMeshBlob",
    header: {
      $type: "rendRenderMeshBlobHeader", bonePositions: [], indexBufferOffset: indexOffset, indexBufferSize: indices.length,
      quantizationOffset: { $type: "Vector4", W: 1, X: 0, Y: -0.02, Z: 1.6 }, quantizationScale: { $type: "Vector4", W: 0, X: 0.1, Y: 0.13, Z: 0.18 },
      renderChunkInfos: [{ $type: "rendChunk", chunkIndices: { $type: "rendIndexBufferChunk", pe: "IBCT_IndexUShort", teOffset: 0 },
        chunkVertices: { $type: "rendVertexBufferChunk", byteOffsets: { Elements: offsets },
          vertexLayout: { $type: "GpuWrapApiVertexLayoutDesc", hash: 1084518123, slotMask: 159, slotStrides: { Elements: strides },
            elements: { Elements: [
              ...layoutElements.map(([streamIndex, type, usage, usageIndex]) => ({ $type: "GpuWrapApiVertexPackingPackingElement",
                streamIndex, streamType: "ST_PerVertex", type, usage, usageIndex })),
              { $type: "GpuWrapApiVertexPackingPackingElement", streamIndex: 7, streamType: "ST_PerInstance", type: "PT_Float4", usage: "PS_InstanceTransform", usageIndex: 0 },
              { $type: "GpuWrapApiVertexPackingPackingElement", streamIndex: 4, streamType: "ST_PerVertex", type: "PT_Float1", usage: "PS_LightBlockerIntensity", usageIndex: 0 },
              { $type: "GpuWrapApiVertexPackingPackingElement", streamIndex: 0, streamType: "ST_Invalid", type: "PT_Invalid", usage: "PS_Invalid", usageIndex: 0 },
            ] } } },
        lodMask: 1, numIndices: GRID_TRIANGLES.length * 3, numVertices: VERTEX_COUNT, vertexFactory: 30 }],
      renderLODs: [0], vertexBufferSize: cursor, version: 20,
    },
    renderBuffer: { BufferId: "1", Flags: 4063232, Bytes: raw.toString("base64") },
  };
}

const header = { WolvenKitVersion: "8.17.4", WKitJsonVersion: "0.0.9", GameVersion: 2310, DataType: "CR2W", ArchiveFileName: "PRIVATE" };
const document = (root: any) => ({ Header: header, Data: { Version: 195, BuildVersion: 0, RootChunk: root, EmbeddedFiles: [] } });

export function fixtureHeadMesh() {
  return document({ $type: "CMesh", appearances: [{ HandleId: "0", Data: { $type: "meshMeshAppearance", name: { $value: "default" } } }],
    boneNames: [{ $type: "CName", $storage: "string", $value: "Root" }], boundingBox: { $type: "Box" },
    externalMaterials: [], localMaterialBuffer: { $type: "meshMeshMaterialBuffer", materials: [{ $type: "CMaterialInstance" }, { $type: "CMaterialInstance" }], rawData: { Data: {} }, rawDataHeaders: [{}] },
    materialEntries: [{}, {}], parameters: [{ HandleId: "63", Data: { $type: "meshMeshParamGarmentSupport" } }], inplaceResources: [],
    renderResourceBlob: { HandleId: "64", Data: renderBlob(11) } });
}

/** Two targets; diffs reference vertices inside and outside a selection, with an odd count to exercise mapping padding. */
export const FIXTURE_DIFFS = [[0, 2, 3, 6, 8], [1, 4, 7]];
export function fixtureHeadMorph() {
  const rows: Buffer[] = [], maps: Buffer[] = [];
  const starts: number[] = [], mapStarts: number[] = [];
  let diffCursor = 0, mapCursor = 0;
  FIXTURE_DIFFS.forEach((vertices, target) => {
    starts.push(diffCursor); mapStarts.push(mapCursor);
    for (const vertex of vertices) rows.push(Buffer.from(Array.from({ length: 12 }, (_, at) => (target * 97 + vertex * 13 + at) & 0xff)));
    const padded = vertices.length % 2 ? [...vertices, 0] : vertices;
    const map = Buffer.alloc(padded.length * 2);
    padded.forEach((vertex, at) => map.writeUInt16LE(vertex, at * 2));
    maps.push(map);
    diffCursor += vertices.length; mapCursor += padded.length / 2;
  });
  return document({ $type: "MorphTargetMesh", baseMesh: { DepotPath: { $value: "base\\head.mesh" } }, baseMeshAppearance: { $value: "default" },
    baseTexture: { DepotPath: { $value: "base\\head_n.xbm" } }, boundingBox: { $type: "Box" },
    targets: FIXTURE_DIFFS.map((_, target) => ({ $type: "MorphTargetMeshEntry", name: { $value: `h0${target}` }, regionName: { $value: "eyes" } })),
    blob: { HandleId: "0", Data: { $type: "rendRenderMorphTargetMeshBlob", baseBlob: { HandleId: "1", Data: renderBlob(11) },
      diffsBuffer: { BufferId: "1", Flags: 4063232, Bytes: Buffer.concat(rows).toString("base64") },
      mappingBuffer: { BufferId: "2", Flags: 4063232, Bytes: Buffer.concat(maps).toString("base64") },
      textureDiffsBuffer: { BufferId: "3", Flags: 4063232, Bytes: "AAAA" },
      header: { $type: "rendRenderMorphTargetMeshBlobHeader", numTargets: FIXTURE_DIFFS.length, numDiffs: diffCursor, numDiffsMapping: mapCursor,
        numVertexDiffsInEachChunk: FIXTURE_DIFFS.map(list => [list.length]),
        numVertexDiffsMappingInEachChunk: FIXTURE_DIFFS.map(list => [Math.ceil(list.length / 2)]),
        targetStartsInVertexDiffs: starts, targetStartsInVertexDiffsMapping: mapStarts,
        targetPositionDiffOffset: FIXTURE_DIFFS.map((_, t) => ({ $type: "Vector4", W: 0, X: -t, Y: 0, Z: 0 })),
        targetPositionDiffScale: FIXTURE_DIFFS.map(() => ({ $type: "Vector4", W: 0, X: 0.01, Y: 0.01, Z: 0.01 })),
        targetTextureDiffsData: FIXTURE_DIFFS.map(() => ({ $type: "rendRenderMorphTargetMeshBlobTextureData" })), version: 6 } } } });
}

/** Select the left two grid columns: triangles 0, 1, 4, 5 → vertices 0, 1, 3, 4, 6, 7. */
export const FIXTURE_FACES = [0, 1, 4, 5];
export function fixtureRecipe(overrides: Record<string, unknown> = {}): EyePlateRecipe {
  const vertices = [...new Set(FIXTURE_FACES.flatMap(face => GRID_TRIANGLES[face]))].sort((a, b) => a - b);
  return parseEyePlateRecipe({
    schema: "xfs/eye-plate-recipe-1", id: "fixture-plate", revision: 1, description: "Synthetic test plate.",
    source: { archiveDirectory: "archive/pc/content", meshDepotPath: "base\\fixture\\head.mesh", morphDepotPath: "base\\fixture\\head.morphtarget",
      supported: [{ id: "fixture-1", label: "Fixture 1", meshSha256: "a".repeat(64), morphSha256: "b".repeat(64) }] },
    selection: { renderChunk: 0, faceCount: FIXTURE_FACES.length, vertexCount: vertices.length, morphTargetCount: FIXTURE_DIFFS.length,
      faceIdsSha256: idListSha256(FIXTURE_FACES), vertexIdsSha256: idListSha256(vertices),
      topology: { componentVertexCounts: [vertices.length], boundaryEdges: 6, boundaryLoops: 1, nonManifoldEdges: 0 },
      faceRangesInclusive: [[0, 1], [4, 5]] },
    output: { stem: "xfs_eye_plate", appearance: "xfs_eye_plate", dropVertexUsages: ["PS_ExtraData", "PS_LightBlockerIntensity"],
      vertexFactory: 4, baseMaterial: "base\\materials\\mesh_decal.mt", morphBaseTexture: "engine\\textures\\editor\\normal.xbm" },
    ...overrides,
  });
}

/** Half-float bits of a number in [0, 1) (exact for the few values tests use). */
function halfBits(value: number): number {
  if (value === 0) return 0;
  const exponent = Math.floor(Math.log2(value)), mantissa = Math.round((value / 2 ** exponent - 1) * 1024);
  return ((exponent + 15) << 10) | mantissa;
}
/**
 * A derived plate whose UV0 (stored convention) is replaced by `uv(vertex)`, identically in the mesh render buffer and
 * the morph's embedded base buffer, so plate-local UV window tests see plate-like UVs (the synthetic head's UV bytes
 * are arbitrary). Returns new documents.
 */
export function withPlateUvs<T extends { mesh: any; morph: any }>(plate: T, uv: (vertex: number, count: number) => [number, number]): T {
  const out = structuredClone(plate);
  for (const blob of [out.mesh.Data.RootChunk.renderResourceBlob.Data, out.morph.Data.RootChunk.blob.Data.baseBlob.Data]) {
    const info = blob.header.renderChunkInfos[0], layout = info.chunkVertices.vertexLayout, raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
    const sizes: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4, PT_Float1: 4 };
    const used = new Map<number, number>();
    let at = -1, stream = -1;
    for (const e of layout.elements.Elements) {
      if (e.streamType !== "ST_PerVertex") continue;
      const offset = used.get(e.streamIndex) ?? 0;
      if (e.usage === "PS_TexCoord" && e.usageIndex === 0) { at = offset; stream = e.streamIndex; }
      used.set(e.streamIndex, offset + sizes[e.type]);
    }
    for (let v = 0; v < info.numVertices; v++) {
      const [u, w] = uv(v, info.numVertices), base = info.chunkVertices.byteOffsets.Elements[stream] + v * layout.slotStrides.Elements[stream] + at;
      raw.writeUInt16LE(halfBits(u), base); raw.writeUInt16LE(halfBits(w), base + 2);
    }
    blob.renderBuffer.Bytes = raw.toString("base64");
  }
  return out;
}
/** Plate-like stored UVs for the synthetic plate: a grid over u 0.30–0.70, stored V 0.70–0.80. */
export const plateLikeUv = (vertex: number, count: number): [number, number] => {
  const columns = Math.ceil(Math.sqrt(count)), column = vertex % columns, row = Math.floor(vertex / columns);
  return [.3 + .4 * column / Math.max(1, columns - 1), .7 + .1 * row / Math.max(1, Math.ceil(count / columns) - 1)];
};
