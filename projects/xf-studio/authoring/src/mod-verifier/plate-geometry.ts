// Independent check of the packaged eye plate's geometry against the plate input. Pure.
//
// Restated on purpose instead of imported from the builder (src/plate-lift.ts): the packaged plate
// must be the input plate with one render chunk per planned lift, where each chunk's positions are
// the input positions moved `lift` along the input's own shading normals, and each morph row's
// position delta gains lift·(normalize(n + Δn) − n). Everything else must be the input's bytes:
// skin indices and weights, normals, tangents, UVs, colours, indices, morph mappings and every
// morph normal/tangent delta. The mesh and morph base buffers must be identical.
import { ensure, type Node } from "./resource-checks";

/** The production lift, restated: vanilla 2.31 face decals sit 0.40 mm outside the head. */
export const VERIFIER_PLATE_LIFT_MM = 0.4;

const SIZES: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4,
  PT_Color: 4, PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16 };
const XYZ = ["X", "Y", "Z"] as const;
const vec = (v: Node) => XYZ.map(axis => Number(v?.[axis]));

type Layout = { usage: string; type: string; stream: number; at: number; size: number }[];
type Chunk = { raw: Buffer; layout: Layout; strides: number[]; offsets: number[]; vertices: number; indices: Buffer; info: Node };

function readChunks(blob: Node, label: string): { chunks: Chunk[]; scale: number[]; offset: number[]; header: Node } {
  const header = blob?.header;
  ensure(Array.isArray(header?.renderChunkInfos) && header.renderChunkInfos.length > 0, `${label} has no render chunks`);
  const raw = Buffer.from(String(blob.renderBuffer?.Bytes ?? ""), "base64");
  const chunks = header.renderChunkInfos.map((info: Node, index: number) => {
    const layoutDesc = info.chunkVertices.vertexLayout, used = new Map<number, number>(), layout: Layout = [];
    for (const e of layoutDesc.elements.Elements) {
      if (e.streamType !== "ST_PerVertex") continue;
      const size = SIZES[e.type];
      ensure(size, `${label} chunk ${index} has an unknown element type ${e.type}`);
      const at = used.get(e.streamIndex) ?? 0;
      layout.push({ usage: `${e.usage}:${e.usageIndex}`, type: e.type, stream: e.streamIndex, at, size });
      used.set(e.streamIndex, at + size);
    }
    const strides: number[] = layoutDesc.slotStrides.Elements, offsets: number[] = info.chunkVertices.byteOffsets.Elements;
    for (const [stream, size] of used) ensure(strides[stream] === size, `${label} chunk ${index} stream ${stream} stride differs from its elements`);
    ensure(info.chunkIndices?.pe === "IBCT_IndexUShort", `${label} chunk ${index} does not use 16-bit indices`);
    const start = header.indexBufferOffset + info.chunkIndices.teOffset, bytes = info.numIndices * 2;
    ensure(start >= header.vertexBufferSize && start + bytes <= raw.length, `${label} chunk ${index} indices lie outside the buffer`);
    for (const e of layout) ensure(offsets[e.stream] + info.numVertices * strides[e.stream] <= header.vertexBufferSize,
      `${label} chunk ${index} vertices lie outside the vertex buffer`);
    return { raw, layout, strides, offsets, vertices: info.numVertices, indices: raw.subarray(start, start + bytes), info };
  });
  return { chunks, scale: vec(header.quantizationScale), offset: vec(header.quantizationOffset), header };
}

const element = (chunk: Chunk, usage: string, vertex: number) => {
  const e = chunk.layout.find(item => item.usage === usage)!;
  const from = chunk.offsets[e.stream] + vertex * chunk.strides[e.stream] + e.at;
  return chunk.raw.subarray(from, from + e.size);
};
const tenBits = (word: number) => [0, 10, 20].map(shift => (word >>> shift) & 0x3ff);
const unit = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(c => c / l); };
const shadingNormal = (word: number) => unit(tenBits(word).map(q => q * 2 / 1023 - 1));

export type PlateGeometryReport = {
  liftsMm: number[]; chunks: number; vertices: number; morphTargets: number; morphRows: number;
  maxPositionErrorMm: number; maxMorphDeltaErrorMm: number;
  nonPositionBytesExact: true; meshMorphBaseIdentical: true; morphShadingDeltasExact: true;
};

/**
 * `source*` are the verifier's own serializations of the plate inputs; `mesh`/`morph` the packaged
 * resources. Throws on the first failure.
 */
export function checkPlateGeometry(sourceMesh: Node, sourceMorph: Node, mesh: Node, morph: Node, liftsMm: readonly number[]): PlateGeometryReport {
  ensure(liftsMm.length > 0 && liftsMm.every(l => Number.isFinite(l) && l >= 0 && l <= 1), "Planned plate lifts are invalid");
  const input = readChunks(sourceMesh.renderResourceBlob?.Data, "Plate input mesh");
  ensure(input.chunks.length === 1, "Plate input must hold one render chunk");
  const inputBase = readChunks(sourceMorph.blob?.Data?.baseBlob?.Data, "Plate input morph base");
  ensure(inputBase.chunks.length === 1 && input.chunks[0].raw.equals(inputBase.chunks[0].raw), "Plate input mesh and morph base differ");
  const src = input.chunks[0], n = src.vertices;
  const packaged = readChunks(mesh.renderResourceBlob?.Data, "Packaged plate mesh");
  const base = readChunks(morph.blob?.Data?.baseBlob?.Data, "Packaged plate morph base");
  ensure(packaged.chunks.length === liftsMm.length, `Packaged plate has ${packaged.chunks.length} chunks for ${liftsMm.length} planned lifts`);
  ensure(packaged.chunks[0].raw.equals(base.chunks[0].raw) && JSON.stringify([packaged.scale, packaged.offset]) === JSON.stringify([base.scale, base.offset]) &&
    base.chunks.length === packaged.chunks.length && base.chunks.every((c, k) => JSON.stringify(c.info) === JSON.stringify(packaged.chunks[k].info)),
  "Packaged plate mesh and morph base differ");
  const normals = Array.from({ length: n }, (_, v) => shadingNormal(element(src, "PS_Normal:0", v).readUInt32LE(0)));
  const positions = Array.from({ length: n }, (_, v) => {
    const bytes = element(src, "PS_Position:0", v);
    return [0, 1, 2].map(k => Math.max(-1, bytes.readInt16LE(k * 2) / 32767) * input.scale[k] + input.offset[k]);
  });
  const layoutKey = (c: Chunk) => JSON.stringify(c.layout.map(e => [e.usage, e.type, e.stream, e.size]));
  let maxPositionError = 0;
  packaged.chunks.forEach((chunk, k) => {
    const info = chunk.info, lift = liftsMm[k] / 1000;
    ensure(layoutKey(chunk) === layoutKey(src) && JSON.stringify(chunk.strides) === JSON.stringify(src.strides),
      `Packaged plate chunk ${k} vertex layout differs from the input`);
    for (const field of ["numVertices", "numIndices", "vertexFactory", "lodMask", "renderMask", "baseRenderMask"])
      ensure(JSON.stringify(info[field]) === JSON.stringify(src.info[field]), `Packaged plate chunk ${k} ${field} differs from the input`);
    ensure(chunk.indices.equals(src.indices), `Packaged plate chunk ${k} triangles differ from the input`);
    const tolerance = packaged.scale.map(s => s / 32767 / 2 + 1e-9);
    for (let v = 0; v < n; v++) {
      for (const e of src.layout) {
        const got = element(chunk, e.usage, v), want = element(src, e.usage, v);
        if (e.usage === "PS_Position:0") {
          ensure(got.readInt16LE(6) === want.readInt16LE(6), `Packaged plate chunk ${k} vertex ${v} position W differs`);
          for (let a = 0; a < 3; a++) {
            const decoded = Math.max(-1, got.readInt16LE(a * 2) / 32767) * packaged.scale[a] + packaged.offset[a];
            const error = Math.abs(decoded - (positions[v][a] + lift * normals[v][a]));
            ensure(error <= tolerance[a], `Packaged plate chunk ${k} vertex ${v} is not lifted ${liftsMm[k]} mm along its normal`);
            maxPositionError = Math.max(maxPositionError, error);
          }
        } else ensure(got.equals(want), `Packaged plate chunk ${k} ${e.usage} bytes differ from the input at vertex ${v}`);
      }
    }
  });

  // Morph rows: per target, one run per chunk, each the input run with lifted position deltas.
  const inBlob = sourceMorph.blob.Data, outBlob = morph.blob?.Data, ih = inBlob.header, oh = outBlob?.header;
  ensure(oh?.numTargets === ih.numTargets, "Packaged plate morph target count differs from the input");
  const inDiffs = Buffer.from(inBlob.diffsBuffer.Bytes, "base64"), inMaps = Buffer.from(inBlob.mappingBuffer.Bytes, "base64");
  const outDiffs = Buffer.from(outBlob.diffsBuffer.Bytes, "base64"), outMaps = Buffer.from(outBlob.mappingBuffer.Bytes, "base64");
  let rows = 0, maxDeltaError = 0;
  for (let t = 0; t < ih.numTargets; t++) {
    const count = ih.numVertexDiffsInEachChunk[t][0], maps = ih.numVertexDiffsMappingInEachChunk[t][0];
    ensure(ih.numVertexDiffsInEachChunk[t].length === 1, "Plate input morph must hold one chunk per target");
    ensure(JSON.stringify(oh.numVertexDiffsInEachChunk[t]) === JSON.stringify(liftsMm.map(() => count)) &&
      JSON.stringify(oh.numVertexDiffsMappingInEachChunk[t]) === JSON.stringify(liftsMm.map(() => maps)),
    `Packaged morph target ${t} does not repeat the input rows once per chunk`);
    const inScale = vec(ih.targetPositionDiffScale[t]), inOffset = vec(ih.targetPositionDiffOffset[t]);
    const outScale = vec(oh.targetPositionDiffScale[t]), outOffset = vec(oh.targetPositionDiffOffset[t]);
    const tolerance = outScale.map(s => s / 1023 / 2 + 1e-9);
    const i0 = ih.targetStartsInVertexDiffs[t] * 12, m0 = ih.targetStartsInVertexDiffsMapping[t] * 4;
    let o0 = oh.targetStartsInVertexDiffs[t] * 12, p0 = oh.targetStartsInVertexDiffsMapping[t] * 4;
    const inMap = inMaps.subarray(m0, m0 + maps * 4);
    liftsMm.forEach((liftMm, k) => {
      const lift = liftMm / 1000;
      ensure(outMaps.subarray(p0, p0 + maps * 4).equals(inMap), `Packaged morph target ${t} chunk ${k} mapping differs from the input`);
      for (let r = 0; r < count; r++) {
        const inRow = inDiffs.subarray(i0 + r * 12, i0 + r * 12 + 12), outRow = outDiffs.subarray(o0 + r * 12, o0 + r * 12 + 12);
        ensure(outRow.length === 12 && outRow.subarray(4).equals(inRow.subarray(4)), `Packaged morph target ${t} chunk ${k} row ${r} shading deltas differ`);
        ensure((outRow.readUInt32LE(0) >>> 30) === (inRow.readUInt32LE(0) >>> 30), `Packaged morph target ${t} chunk ${k} row ${r} flag bits differ`);
        const v = inMap.readUInt16LE(r * 2), n0 = normals[v];
        const moved = unit(tenBits(inRow.readUInt32LE(4)).map((q, a) => n0[a] + q * 2 / 1023 - 1));
        const inQ = tenBits(inRow.readUInt32LE(0)), outQ = tenBits(outRow.readUInt32LE(0));
        for (let a = 0; a < 3; a++) {
          const want = inQ[a] / 1023 * inScale[a] + inOffset[a] + lift * (moved[a] - n0[a]);
          const error = Math.abs(outQ[a] / 1023 * outScale[a] + outOffset[a] - want);
          ensure(error <= tolerance[a], `Packaged morph target ${t} chunk ${k} row ${r} delta is not the lifted input delta`);
          maxDeltaError = Math.max(maxDeltaError, error);
        }
        rows++;
      }
      o0 += count * 12; p0 += maps * 4;
    });
  }
  ensure(outDiffs.length === rows * 12, "Packaged morph holds rows beyond the lifted input rows");
  return { liftsMm: [...liftsMm], chunks: liftsMm.length, vertices: n, morphTargets: ih.numTargets, morphRows: rows,
    maxPositionErrorMm: Math.round(maxPositionError * 1e9) / 1e6, maxMorphDeltaErrorMm: Math.round(maxDeltaError * 1e9) / 1e6,
    nonPositionBytesExact: true, meshMorphBaseIdentical: true, morphShadingDeltasExact: true };
}
