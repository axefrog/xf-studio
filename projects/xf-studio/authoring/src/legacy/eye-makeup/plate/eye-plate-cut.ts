import { idListSha256, selectedFaceIds, type EyePlateRecipe } from "./eye-plate-recipe";

/**
 * Pure byte-level cut of the expanded eye plate from WolvenKit's JSON form of the
 * installed head mesh and morph target. Every retained vertex, index and morph-diff
 * byte is copied from the game resource; nothing is decoded and re-quantized, so the
 * plate keeps the head's exact positions, shading, UVs, colour and skin bytes in both
 * the mesh and the morph's embedded base buffer.
 */
// WolvenKit JSON is an external, loosely typed document model.
export type WkJson = any;

export const VERTEX_ELEMENT_BYTES: Readonly<Record<string, number>> = {
  PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4,
  PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16,
};
const DIFF_BYTES = 12;

export type VertexElement = { usage: string; usageIndex: number; type: string; stream: number; offset: number; size: number };
export type PlateSelection = {
  /** Ascending head vertex IDs; plate vertex i is head vertex vertexIds[i]. */
  vertexIds: number[];
  /** Compact triangle indices in native face order and winding. */
  faces: Uint32Array;
  faceIds: number[];
};

const align16 = (value: number) => Math.ceil(value / 16) * 16;
const bytes = (base64: string) => Buffer.from(base64, "base64");
const clone = <T>(value: T): T => structuredClone(value);
const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const resourceRef = (path: string) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: path }, Flags: "Default" });

function onlyChunk(header: WkJson, recipe: EyePlateRecipe): WkJson {
  const chunks = header?.renderChunkInfos;
  if (!Array.isArray(chunks) || chunks.length !== 1 || recipe.selection.renderChunk !== 0)
    throw Error("The head resource no longer has the single render chunk this recipe was audited against.");
  const chunk = chunks[0];
  if (chunk.chunkIndices?.pe !== "IBCT_IndexUShort" || chunk.chunkIndices?.teOffset !== 0)
    throw Error("The head resource uses an unsupported index buffer layout.");
  return chunk;
}

/** Per-vertex elements with their byte offsets inside each stream row. */
export function vertexElements(layout: WkJson): VertexElement[] {
  const cursor = new Map<number, number>();
  const result: VertexElement[] = [];
  for (const element of layout.elements.Elements) {
    if (element.streamType !== "ST_PerVertex") continue;
    const size = VERTEX_ELEMENT_BYTES[element.type];
    if (!size) throw Error(`Unsupported vertex element type ${element.type}.`);
    const offset = cursor.get(element.streamIndex) ?? 0;
    result.push({ usage: element.usage, usageIndex: element.usageIndex, type: element.type, stream: element.streamIndex, offset, size });
    cursor.set(element.streamIndex, offset + size);
  }
  const strides: number[] = layout.slotStrides.Elements;
  for (const [stream, size] of cursor) if (strides[stream] !== size)
    throw Error(`Vertex stream ${stream} stride ${strides[stream]} does not match its elements (${size}).`);
  return result;
}

/** Resolve the recipe's triangle selection against a render blob's actual index buffer. */
export function selectPlate(blob: WkJson, recipe: EyePlateRecipe): PlateSelection {
  const header = blob.header;
  const chunk = onlyChunk(header, recipe);
  const raw = bytes(blob.renderBuffer.Bytes);
  const indexCount: number = chunk.numIndices;
  if (indexCount % 3 !== 0 || header.indexBufferOffset + indexCount * 2 > raw.length)
    throw Error("The head index buffer is malformed.");
  const faceIds = selectedFaceIds(recipe);
  if (faceIds[faceIds.length - 1] >= indexCount / 3) throw Error("The recipe selects triangles beyond the head index buffer.");
  const native = faceIds.flatMap(face => [0, 1, 2].map(corner => raw.readUInt16LE(header.indexBufferOffset + (face * 3 + corner) * 2)));
  const vertexIds = [...new Set(native)].sort((a, b) => a - b);
  if (vertexIds.length !== recipe.selection.vertexCount || idListSha256(vertexIds) !== recipe.selection.vertexIdsSha256)
    throw Error("The head triangle order differs from the audited selection.");
  const compact = new Map(vertexIds.map((id, index) => [id, index]));
  return { vertexIds, faceIds, faces: Uint32Array.from(native, id => compact.get(id)!) };
}

/** Cut one render blob to the selected vertices, copying retained element bytes verbatim. */
export function cutRenderBlob(blob: WkJson, selection: PlateSelection, recipe: EyePlateRecipe): WkJson {
  const header = blob.header;
  const chunk = onlyChunk(header, recipe);
  const layout = chunk.chunkVertices.vertexLayout;
  const elements = vertexElements(layout);
  const drop = new Set(recipe.output.dropVertexUsages);
  const raw = bytes(blob.renderBuffer.Bytes);
  const sourceOffsets: number[] = chunk.chunkVertices.byteOffsets.Elements;
  const sourceStrides: number[] = layout.slotStrides.Elements;
  const kept = elements.filter(element => !drop.has(element.usage));
  const streams = [...new Set(elements.map(element => element.stream))].sort((a, b) => a - b);
  const strides = [...sourceStrides];
  const offsets = sourceOffsets.map(() => 0);
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const stream of streams) {
    const inStream = kept.filter(element => element.stream === stream);
    const stride = inStream.reduce((sum, element) => sum + element.size, 0);
    strides[stream] = stride;
    if (stride === 0) continue;
    if (stream >= offsets.length) throw Error("Vertex stream offsets are incomplete.");
    const start = align16(cursor);
    if (start > cursor) parts.push(Buffer.alloc(start - cursor));
    offsets[stream] = start;
    const block = Buffer.alloc(stride * selection.vertexIds.length);
    selection.vertexIds.forEach((vertex, row) => {
      let target = row * stride;
      for (const element of inStream) {
        const from = sourceOffsets[stream] + vertex * sourceStrides[stream] + element.offset;
        raw.copy(block, target, from, from + element.size);
        target += element.size;
      }
    });
    parts.push(block);
    cursor = start + block.length;
  }
  const vertexBufferSize = cursor;
  const indexBufferOffset = align16(vertexBufferSize);
  const indices = Buffer.alloc(selection.faces.length * 2);
  selection.faces.forEach((index, position) => indices.writeUInt16LE(index, position * 2));
  const buffer = Buffer.concat([...parts, Buffer.alloc(indexBufferOffset - vertexBufferSize), indices]);

  const result = clone(blob);
  const outHeader = result.header;
  const outChunk = outHeader.renderChunkInfos[0];
  const outLayout = outChunk.chunkVertices.vertexLayout;
  outLayout.elements.Elements = layout.elements.Elements.filter((element: WkJson) => !drop.has(element.usage));
  outLayout.slotStrides.Elements = strides;
  outLayout.slotMask = strides.reduce((mask, stride, stream) => stride > 0 ? mask | (1 << stream) : mask, 0);
  // WolvenKit writes zero for a layout it rebuilt; the engine accepts that for imported skinned meshes.
  outLayout.hash = drop.size ? 0 : layout.hash;
  outChunk.chunkVertices.byteOffsets.Elements = offsets;
  outChunk.numVertices = selection.vertexIds.length;
  outChunk.numIndices = selection.faces.length;
  outChunk.vertexFactory = recipe.output.vertexFactory;
  outHeader.vertexBufferSize = vertexBufferSize;
  outHeader.indexBufferOffset = indexBufferOffset;
  outHeader.indexBufferSize = indices.length;
  result.renderBuffer.Bytes = buffer.toString("base64");
  return result;
}

/** Keep each morph target's native diff rows for selected vertices, remapping only their vertex indices. */
export function cutMorphBlob(blob: WkJson, selection: PlateSelection, recipe: EyePlateRecipe): WkJson {
  const header = blob.header;
  const targets: number = header.numTargets;
  if (targets !== recipe.selection.morphTargetCount) throw Error("The head morph target count differs from the audited recipe.");
  const diffs = bytes(blob.diffsBuffer.Bytes);
  const mapping = bytes(blob.mappingBuffer.Bytes);
  const compact = new Map(selection.vertexIds.map((id, index) => [id, index]));
  const outDiffs: Buffer[] = [], outMapping: Buffer[] = [];
  const perTargetDiffs: number[] = [], perTargetMappings: number[] = [];
  for (let target = 0; target < targets; target++) {
    const chunkDiffs: number[] = header.numVertexDiffsInEachChunk[target];
    const chunkMappings: number[] = header.numVertexDiffsMappingInEachChunk[target];
    if (chunkDiffs.length !== 1 || chunkMappings.length !== 1) throw Error("The head morph uses an unsupported chunk layout.");
    const diffCount = chunkDiffs[0];
    if (chunkMappings[0] * 2 - (diffCount % 2) !== diffCount) throw Error("The head morph mapping count is inconsistent.");
    const diffStart = header.targetStartsInVertexDiffs[target] * DIFF_BYTES;
    const mappingStart = header.targetStartsInVertexDiffsMapping[target] * 4;
    const kept: number[] = [];
    for (let diff = 0; diff < diffCount; diff++) {
      const plateVertex = compact.get(mapping.readUInt16LE(mappingStart + diff * 2));
      if (plateVertex === undefined) continue;
      outDiffs.push(diffs.subarray(diffStart + diff * DIFF_BYTES, diffStart + (diff + 1) * DIFF_BYTES));
      kept.push(plateVertex);
    }
    const padded = kept.length % 2 ? [...kept, 0] : kept;
    const map = Buffer.alloc(padded.length * 2);
    padded.forEach((vertex, index) => map.writeUInt16LE(vertex, index * 2));
    outMapping.push(map);
    perTargetDiffs.push(kept.length);
    perTargetMappings.push(padded.length / 2);
  }
  const result = clone(blob);
  const outHeader = result.header;
  outHeader.numVertexDiffsInEachChunk = perTargetDiffs.map(value => [value]);
  outHeader.numVertexDiffsMappingInEachChunk = perTargetMappings.map(value => [value]);
  let diffStart = 0, mappingStart = 0;
  outHeader.targetStartsInVertexDiffs = perTargetDiffs.map(value => { const start = diffStart; diffStart += value; return start; });
  outHeader.targetStartsInVertexDiffsMapping = perTargetMappings.map(value => { const start = mappingStart; mappingStart += value; return start; });
  outHeader.numDiffs = diffStart;
  outHeader.numDiffsMapping = mappingStart;
  // Head skin-normal texture deltas address the head's normal atlas, not a cosmetic plate.
  outHeader.targetTextureDiffsData = Array.from({ length: targets }, () => ({
    $type: "rendRenderMorphTargetMeshBlobTextureData",
    ...Object.fromEntries(["targetDiffOffset", "targetDiffScale", "targetDiffsDataOffset", "targetDiffsDataSize",
      "targetDiffsMipLevelCounts", "targetDiffsWidth"].map(key => [key, { Elements: [] }])),
  }));
  result.textureDiffsBuffer = null;
  result.diffsBuffer.Bytes = Buffer.concat(outDiffs).toString("base64");
  result.mappingBuffer.Bytes = Buffer.concat(outMapping).toString("base64");
  result.baseBlob = { ...result.baseBlob, Data: cutRenderBlob(blob.baseBlob.Data, selection, recipe) };
  return result;
}

const documentShell = (source: WkJson, root: WkJson) => ({
  Header: { WolvenKitVersion: source.Header.WolvenKitVersion, WKitJsonVersion: source.Header.WKitJsonVersion,
    GameVersion: source.Header.GameVersion, DataType: source.Header.DataType },
  Data: { Version: source.Data.Version, BuildVersion: source.Data.BuildVersion, RootChunk: root, EmbeddedFiles: [] },
});

/** Plate mesh document: head root fields and bones, the cut geometry and one decal material. */
export function buildPlateMesh(headMesh: WkJson, selection: PlateSelection, recipe: EyePlateRecipe): WkJson {
  const source = headMesh.Data.RootChunk;
  if (source.$type !== "CMesh") throw Error("The head mesh resource has an unexpected type.");
  const root = clone(source);
  const name = recipe.output.appearance;
  root.appearances = [{ HandleId: "0", Data: { $type: "meshMeshAppearance", chunkMaterials: [cname(name)], name: cname(name), tags: [] } }];
  root.materialEntries = [{ $type: "CMeshMaterialEntry", index: 0, isLocalInstance: 1, name: cname(name) }];
  root.localMaterialBuffer = { ...root.localMaterialBuffer, materials: [{ $type: "CMaterialInstance", audioTag: cname("None"),
    baseMaterial: resourceRef(recipe.output.baseMaterial), cookingPlatform: "PLATFORM_PC", enableMask: 1, metadata: null,
    resourceVersion: 4, values: [] }], rawData: null, rawDataHeaders: [] };
  // Garment-support parameters describe the head's own extra vertex data, which the plate omits.
  root.parameters = [];
  root.inplaceResources = [];
  for (const key of ["externalMaterials", "preloadExternalMaterials", "preloadLocalMaterialInstances", "localMaterialInstances"])
    if (key in root) root[key] = [];
  root.renderResourceBlob = { HandleId: "1", Data: cutRenderBlob(source.renderResourceBlob.Data, selection, recipe) };
  return documentShell(headMesh, root);
}

/** Plate morph document: native targets and diffs for selected vertices, based on the plate mesh. */
export function buildPlateMorph(headMorph: WkJson, selection: PlateSelection, recipe: EyePlateRecipe, meshDepotPath: string): WkJson {
  const source = headMorph.Data.RootChunk;
  if (source.$type !== "MorphTargetMesh") throw Error("The head morph resource has an unexpected type.");
  if (!Array.isArray(source.targets) || source.targets.length !== recipe.selection.morphTargetCount)
    throw Error("The head morph target list differs from the audited recipe.");
  const root = clone(source);
  root.baseMesh = resourceRef(meshDepotPath);
  root.baseMeshAppearance = cname(recipe.output.appearance);
  root.baseTexture = resourceRef(recipe.output.morphBaseTexture);
  root.blob = { ...root.blob, Data: cutMorphBlob(source.blob.Data, selection, recipe) };
  return documentShell(headMorph, root);
}

export type PlateDocuments = { mesh: WkJson; morph: WkJson; selection: PlateSelection };
/** Derive both plate documents; the mesh and morph base buffers must select identical native rows. */
export function derivePlateDocuments(headMesh: WkJson, headMorph: WkJson, recipe: EyePlateRecipe, meshDepotPath: string): PlateDocuments {
  const selection = selectPlate(headMesh.Data.RootChunk.renderResourceBlob.Data, recipe);
  const morphSelection = selectPlate(headMorph.Data.RootChunk.blob.Data.baseBlob.Data, recipe);
  if (JSON.stringify(morphSelection.vertexIds) !== JSON.stringify(selection.vertexIds) ||
      !morphSelection.faces.every((value, index) => value === selection.faces[index]))
    throw Error("The head mesh and morph base buffers disagree on the selected triangles.");
  return { selection, mesh: buildPlateMesh(headMesh, selection, recipe), morph: buildPlateMorph(headMorph, selection, recipe, meshDepotPath) };
}
