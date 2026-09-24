import { idListSha256, sha256Hex, selectedFaceIds, type EyePlateRecipe, type EyePlateTopology } from "./eye-plate-recipe";

/**
 * Independent verifier for a derived eye plate. It reads the plate resources as WolvenKit
 * serialized them *after* conversion to CR2W, decodes both plate and head buffers with
 * its own element reader (no code shared with the cut), and requires every retained
 * vertex element, index and morph-diff row to equal the native head bytes.
 */
type Doc = any; // WolvenKit JSON document model.

const ELEMENT_BYTES: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8,
  PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4, PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16 };
const SKIN_USAGES = ["PS_SkinIndices", "PS_SkinWeights"];

type Decoded = { vertices: number; rows: Map<string, Buffer[]>; triangles: number[][]; quantization: string; factory: number };

function decode(blob: Doc): Decoded {
  const header = blob.header;
  if (header.renderChunkInfos.length !== 1) throw Error("expected one render chunk");
  const chunk = header.renderChunkInfos[0];
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  const layout = chunk.chunkVertices.vertexLayout;
  const strides: number[] = layout.slotStrides.Elements;
  const offsets: number[] = chunk.chunkVertices.byteOffsets.Elements;
  const used = new Map<number, number>();
  const rows = new Map<string, Buffer[]>();
  for (const element of layout.elements.Elements) {
    if (element.streamType !== "ST_PerVertex") continue;
    const size = ELEMENT_BYTES[element.type];
    const at = used.get(element.streamIndex) ?? 0;
    used.set(element.streamIndex, at + size);
    const key = `${element.usage}:${element.usageIndex}:${element.type}`;
    rows.set(key, Array.from({ length: chunk.numVertices }, (_, vertex) => {
      const from = offsets[element.streamIndex] + vertex * strides[element.streamIndex] + at;
      if (from + size > header.vertexBufferSize) throw Error(`${key} lies outside the vertex buffer`);
      return raw.subarray(from, from + size);
    }));
  }
  for (const [stream, size] of used) if (strides[stream] !== size) throw Error(`stream ${stream} stride mismatch`);
  if (chunk.chunkIndices.pe !== "IBCT_IndexUShort" || header.indexBufferSize !== chunk.numIndices * 2 ||
      header.indexBufferOffset + header.indexBufferSize > raw.length || header.indexBufferOffset < header.vertexBufferSize)
    throw Error("index buffer layout is invalid");
  const triangles: number[][] = [];
  for (let face = 0; face < chunk.numIndices / 3; face++)
    triangles.push([0, 1, 2].map(corner => raw.readUInt16LE(header.indexBufferOffset + (face * 3 + corner) * 2)));
  if (triangles.some(face => face.some(index => index >= chunk.numVertices))) throw Error("index out of range");
  return { vertices: chunk.numVertices, rows, triangles, factory: chunk.vertexFactory,
    quantization: JSON.stringify([header.quantizationScale, header.quantizationOffset]) };
}

type Diff = { vertex: number; row: Buffer };
function diffs(blob: Doc): { targets: Diff[][]; quantization: string[] } {
  const header = blob.header;
  const all = Buffer.from(blob.diffsBuffer.Bytes, "base64");
  const maps = Buffer.from(blob.mappingBuffer.Bytes, "base64");
  const targets: Diff[][] = [];
  const quantization: string[] = [];
  for (let target = 0; target < header.numTargets; target++) {
    const count = header.numVertexDiffsInEachChunk[target][0];
    if (header.numVertexDiffsMappingInEachChunk[target][0] !== Math.ceil(count / 2)) throw Error(`target ${target} mapping count`);
    const diffStart = header.targetStartsInVertexDiffs[target] * 12, mapStart = header.targetStartsInVertexDiffsMapping[target] * 4;
    targets.push(Array.from({ length: count }, (_, index) => ({ vertex: maps.readUInt16LE(mapStart + index * 2),
      row: all.subarray(diffStart + index * 12, diffStart + index * 12 + 12) })));
    quantization.push(JSON.stringify([header.targetPositionDiffOffset[target], header.targetPositionDiffScale[target]]));
  }
  return { targets, quantization };
}

export function plateTopology(triangles: number[][], vertexCount: number): EyePlateTopology {
  const edges = new Map<string, number>();
  const neighbours = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const face of triangles) for (let corner = 0; corner < 3; corner++) {
    const a = face[corner], b = face[(corner + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
    neighbours[a].add(b); neighbours[b].add(a);
  }
  const walk = (graph: Set<number>[], seeds: Iterable<number>) => {
    const seen = new Set<number>(), sizes: number[] = [];
    for (const seed of seeds) {
      if (seen.has(seed)) continue;
      const stack = [seed]; seen.add(seed); let size = 0;
      while (stack.length) { size++; for (const next of graph[stack.pop()!]) if (!seen.has(next)) { seen.add(next); stack.push(next); } }
      sizes.push(size);
    }
    return sizes;
  };
  const boundary = [...edges].filter(([, uses]) => uses === 1).map(([key]) => key.split(",").map(Number));
  const boundaryGraph = Array.from({ length: vertexCount }, () => new Set<number>());
  for (const [a, b] of boundary) { boundaryGraph[a].add(b); boundaryGraph[b].add(a); }
  if (boundaryGraph.some(set => set.size !== 0 && set.size !== 2)) throw Error("open boundary does not form closed loops");
  return { componentVertexCounts: walk(neighbours, neighbours.keys()).sort((a, b) => a - b),
    boundaryEdges: boundary.length, boundaryLoops: walk(boundaryGraph, boundary.flat()).length,
    nonManifoldEdges: [...edges.values()].filter(uses => uses > 2).length };
}

export type EyePlateVerification = {
  schema: "xfs/eye-plate-verification-1";
  vertices: number; triangles: number; morphTargets: number; morphDiffs: number;
  exactVertexElements: string[]; droppedVertexElements: string[];
  exactNativeSkinBytesMesh: true; exactNativeSkinBytesMorphBase: true; meshMorphSkinRowsEqual: true;
  exactTriangles: true; exactMorphDiffRows: true; headQuantizationRetained: true;
  topology: EyePlateTopology; meshSkinRowsSha256: string; morphSkinRowsSha256: string;
};

/** Throws with every failed gate listed; returns an asset-free summary when all pass. */
export function verifyEyePlate(recipe: EyePlateRecipe, headMesh: Doc, headMorph: Doc, plateMesh: Doc, plateMorph: Doc): EyePlateVerification {
  const failures: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) failures.push(message); };
  const head = decode(headMesh.Data.RootChunk.renderResourceBlob.Data);
  const headBase = decode(headMorph.Data.RootChunk.blob.Data.baseBlob.Data);
  const mesh = decode(plateMesh.Data.RootChunk.renderResourceBlob.Data);
  const base = decode(plateMorph.Data.RootChunk.blob.Data.baseBlob.Data);
  const faceIds = selectedFaceIds(recipe);
  const selected = faceIds.map(face => head.triangles[face]);
  const vertexIds = [...new Set(selected.flat())].sort((a, b) => a - b);
  check(idListSha256(vertexIds) === recipe.selection.vertexIdsSha256, "selected head vertices differ from the recipe");
  const exact = new Set<string>(), dropped = new Set<string>();
  for (const [label, plate, source] of [["mesh", mesh, head], ["morph base", base, headBase]] as const) {
    check(plate.vertices === recipe.selection.vertexCount, `${label}: vertex count ${plate.vertices}`);
    check(plate.triangles.length === recipe.selection.faceCount, `${label}: triangle count ${plate.triangles.length}`);
    check(plate.factory === recipe.output.vertexFactory, `${label}: vertex factory ${plate.factory}`);
    check(plate.quantization === source.quantization, `${label}: position quantization differs from the head`);
    check(plate.triangles.every((face, index) => face.every((vertex, corner) => vertexIds[vertex] === selected[index][corner])),
      `${label}: triangles are not the selected native triangles in native order and winding`);
    for (const [key, rows] of source.rows) {
      const usage = key.split(":")[0];
      const plateRows = plate.rows.get(key);
      if (recipe.output.dropVertexUsages.includes(usage)) { check(!plateRows, `${label}: ${key} should be omitted`); dropped.add(key); continue; }
      if (!plateRows) { failures.push(`${label}: ${key} is missing`); continue; }
      const same = plateRows.every((row, vertex) => row.equals(rows[vertexIds[vertex]]));
      check(same, `${label}: ${key} bytes differ from the native head`);
      if (same) exact.add(key);
    }
    check(plate.rows.size === source.rows.size - dropped.size, `${label}: unexpected vertex elements`);
  }
  const skin = (decoded: Decoded) => Buffer.concat(Array.from({ length: decoded.vertices }, (_, vertex) =>
    Buffer.concat([...decoded.rows].filter(([key]) => SKIN_USAGES.includes(key.split(":")[0])).map(([, rows]) => rows[vertex]))));
  const meshSkin = skin(mesh), baseSkin = skin(base);
  check(meshSkin.length === recipe.selection.vertexCount * 16, "skin rows must hold eight influences per vertex");
  check(meshSkin.equals(baseSkin), "mesh and morph-base skin bytes differ");

  const headTargets = diffs(headMorph.Data.RootChunk.blob.Data);
  const plateTargets = diffs(plateMorph.Data.RootChunk.blob.Data);
  const names = (doc: Doc) => doc.Data.RootChunk.targets.map((target: Doc) => `${target.name.$value}_${target.regionName.$value}`);
  check(JSON.stringify(names(plateMorph)) === JSON.stringify(names(headMorph)), "morph target names or order differ");
  check(plateTargets.targets.length === recipe.selection.morphTargetCount, "morph target count differs");
  check(JSON.stringify(plateTargets.quantization) === JSON.stringify(headTargets.quantization), "morph delta quantization differs");
  const plateOf = new Map(vertexIds.map((id, index) => [id, index]));
  let morphDiffs = 0;
  headTargets.targets.forEach((target, index) => {
    const expected = target.filter(diff => plateOf.has(diff.vertex)).map(diff => ({ vertex: plateOf.get(diff.vertex)!, row: diff.row }));
    const actual = plateTargets.targets[index] ?? [];
    morphDiffs += actual.length;
    check(actual.length === expected.length && actual.every((diff, at) => diff.vertex === expected[at].vertex && diff.row.equals(expected[at].row)),
      `morph target ${index}: diff rows differ from the native head`);
  });
  check(plateMorph.Data.RootChunk.blob.Data.textureDiffsBuffer === null, "head texture diffs must be removed");
  const materials = plateMesh.Data.RootChunk.localMaterialBuffer.materials;
  check(materials.length === 1 && materials[0].baseMaterial.DepotPath.$value === recipe.output.baseMaterial, "plate material differs");
  check(plateMesh.Data.RootChunk.parameters.length === 0, "plate mesh must not carry head parameters");
  let topology: EyePlateTopology = { componentVertexCounts: [], boundaryEdges: 0, boundaryLoops: 0, nonManifoldEdges: 0 };
  try { topology = plateTopology(mesh.triangles, mesh.vertices); }
  catch (error) { failures.push(`topology: ${(error as Error).message}`); }
  check(JSON.stringify(topology) === JSON.stringify(recipe.selection.topology), "plate topology differs from the recipe");
  if (failures.length) throw Error(`Eye plate verification failed: ${failures.join("; ")}.`);
  return { schema: "xfs/eye-plate-verification-1", vertices: mesh.vertices, triangles: mesh.triangles.length,
    morphTargets: plateTargets.targets.length, morphDiffs, exactVertexElements: [...exact].sort(), droppedVertexElements: [...dropped].sort(),
    exactNativeSkinBytesMesh: true, exactNativeSkinBytesMorphBase: true, meshMorphSkinRowsEqual: true, exactTriangles: true,
    exactMorphDiffRows: true, headQuantizationRetained: true, topology,
    meshSkinRowsSha256: sha256Hex(meshSkin), morphSkinRowsSha256: sha256Hex(baseSkin) };
}
