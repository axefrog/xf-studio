// Independent check of the packaged eye plate's geometry against the plate input. Pure.
//
// Restated on purpose instead of imported from the builder (src/plate-lift.ts): the packaged plate
// must be the input plate with one render chunk per planned lift, where each chunk's positions are
// the input positions moved `lift` along the input's own shading normals, and each morph row's
// position delta gains lift·(normalize(n + Δn) − n). Everything else must be the input's bytes:
// skin indices and weights, normals, tangents, UVs, colours, indices, morph mappings and every
// morph normal/tangent delta. The mesh and morph base buffers must be identical.
//
// The render blobs and the morph blob are compared with the input as whole objects. The only fields
// allowed to differ are the ones the lift must change, and each is re-derived here, never copied from
// the package: the chunk list (byte offsets, index offsets), topology, buffer sizes and offsets, the
// morph counts, starts and totals, the mapping buffer (the input's, once per chunk) and the per-target
// delta quantization (the input's, or exactly the range of the lifted deltas). Encoded positions and
// deltas are checked against the re-derived values within half a quantization step and an absolute cap.
import { ensure, firstDifference, HANDLE_KEYS, sameJson, type Node } from "./resource-checks";

/** The production lift, restated: vanilla 2.31 face decals sit 0.40 mm outside the head. */
export const VERIFIER_PLATE_LIFT_MM = 0.4;
/**
 * Absolute caps on encoding error (mm), independent of any quantization: the head's own position step
 * leaves about 3 µm, and the real plate's widest re-quantized delta range about 8 µm.
 */
export const VERIFIER_MAX_POSITION_ERROR_MM = 0.01;
export const VERIFIER_MAX_MORPH_DELTA_ERROR_MM = 0.02;

const SIZES: Record<string, number> = { PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4,
  PT_Color: 4, PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16 };
const XYZ = ["X", "Y", "Z"] as const;
const vec = (v: Node) => XYZ.map(axis => Number(v?.[axis]));
const align16 = (value: number) => Math.ceil(value / 16) * 16;
/** WolvenKit stores these header values as float32: equal to the re-derived value up to float32 rounding. */
const sameFloat32 = (actual: number, want: number) => Number.isFinite(actual) && Math.abs(actual - want) <= 2 ** -22 * Math.abs(want) + 1e-12;

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

/**
 * The lifted blob's buffer layout, restated (vanilla multi-chunk decals): per chunk, each used stream's
 * block in stream order at 16-byte alignment; then the index buffer at 16-byte alignment with one run
 * of the input's indices per chunk, whose `teOffset` is that run's byte offset.
 */
function liftedLayout(src: Chunk, chunks: number) {
  const streams = [...new Set(src.layout.map(e => e.stream))].sort((a, b) => a - b).filter(stream => src.strides[stream] > 0);
  const byteOffsets: number[][] = [], vertexRanges: [number, number][] = [];
  let cursor = 0;
  for (let k = 0; k < chunks; k++) {
    const offsets = src.offsets.map(() => 0);
    for (const stream of streams) {
      const start = align16(cursor);
      offsets[stream] = start;
      cursor = start + src.strides[stream] * src.vertices;
      vertexRanges.push([start, cursor]);
    }
    byteOffsets.push(offsets);
  }
  const indexBytes = src.info.numIndices * 2, indexBufferOffset = align16(cursor);
  return { byteOffsets, vertexRanges, indexBytes, vertexBufferSize: cursor, indexBufferOffset,
    indexBufferSize: indexBytes * chunks, length: indexBufferOffset + indexBytes * chunks };
}
type LiftedLayout = ReturnType<typeof liftedLayout>;

/**
 * The input render blob with the lift's layout fields re-derived. The buffer bytes are taken from the
 * package here and checked separately (length, zero padding, then every vertex and index).
 */
function checkLiftedBlob(label: string, packaged: Node, source: Node, src: Chunk, layout: LiftedLayout, lifts: number) {
  ensure(packaged && typeof packaged === "object", `${label} is missing`);
  const expected = structuredClone(source), header = expected.header;
  header.renderChunkInfos = Array.from({ length: lifts }, (_, k) => {
    const chunk = structuredClone(src.info);
    chunk.chunkVertices.byteOffsets.Elements = layout.byteOffsets[k];
    chunk.chunkIndices.teOffset = k * layout.indexBytes;
    return chunk;
  });
  if (Array.isArray(header.topology) && header.topology.length === 1) header.topology = Array.from({ length: lifts }, () => structuredClone(header.topology[0]));
  Object.assign(header, { vertexBufferSize: layout.vertexBufferSize, indexBufferOffset: layout.indexBufferOffset, indexBufferSize: layout.indexBufferSize });
  if (expected.renderBuffer && typeof expected.renderBuffer === "object") expected.renderBuffer.Bytes = packaged.renderBuffer?.Bytes;
  const differs = firstDifference(packaged, expected, HANDLE_KEYS);
  ensure(differs === null, `${label} ${differs} differs from the input`);
  const raw = Buffer.from(String(packaged.renderBuffer.Bytes ?? ""), "base64");
  ensure(raw.length === layout.length, `${label} buffer holds ${raw.length} bytes, not the ${layout.length} of the lifted layout`);
  const used = new Uint8Array(layout.indexBufferOffset);
  for (const [from, to] of layout.vertexRanges) used.fill(1, from, to);
  for (let at = 0; at < used.length; at++) ensure(used[at] || raw[at] === 0, `${label} buffer padding at byte ${at} is not zero`);
}

export type PlateGeometryReport = {
  liftsMm: number[]; chunks: number; vertices: number; morphTargets: number; morphRows: number;
  /** Morph targets whose delta quantization is the range of the lifted deltas instead of the input's. */
  requantizedTargets: number;
  maxPositionErrorMm: number; maxMorphDeltaErrorMm: number;
  nonPositionBytesExact: true; meshMorphBaseIdentical: true; morphShadingDeltasExact: true;
  /** The render and morph blobs equal the input outside the re-derived lift fields. */
  blobsMatchInput: true; meshQuantizationRetained: true;
};

/**
 * `source*` are the verifier's own serializations of the plate inputs; `mesh`/`morph` the packaged
 * resources. Throws on the first failure.
 */
export function checkPlateGeometry(sourceMesh: Node, sourceMorph: Node, mesh: Node, morph: Node, liftsMm: readonly number[]): PlateGeometryReport {
  ensure(liftsMm.length > 0 && liftsMm.every(l => Number.isFinite(l) && l >= 0 && l <= 1), "Planned plate lifts are invalid");
  const lifts = liftsMm.length;
  const input = readChunks(sourceMesh.renderResourceBlob?.Data, "Plate input mesh");
  ensure(input.chunks.length === 1, "Plate input must hold one render chunk");
  const inputBase = readChunks(sourceMorph.blob?.Data?.baseBlob?.Data, "Plate input morph base");
  ensure(inputBase.chunks.length === 1 && input.chunks[0].raw.equals(inputBase.chunks[0].raw), "Plate input mesh and morph base differ");
  const src = input.chunks[0], n = src.vertices;

  // Whole blobs first, so every offset read below is a re-derived one.
  const layout = liftedLayout(src, lifts);
  checkLiftedBlob("Packaged plate mesh", mesh.renderResourceBlob?.Data, sourceMesh.renderResourceBlob.Data, src, layout, lifts);
  checkLiftedBlob("Packaged plate morph base", morph.blob?.Data?.baseBlob?.Data, sourceMorph.blob.Data.baseBlob.Data, inputBase.chunks[0], layout, lifts);
  const packaged = readChunks(mesh.renderResourceBlob.Data, "Packaged plate mesh");
  const base = readChunks(morph.blob.Data.baseBlob.Data, "Packaged plate morph base");
  ensure(packaged.chunks[0].raw.equals(base.chunks[0].raw), "Packaged plate mesh and morph base differ");

  const normals = Array.from({ length: n }, (_, v) => shadingNormal(element(src, "PS_Normal:0", v).readUInt32LE(0)));
  const positions = Array.from({ length: n }, (_, v) => {
    const bytes = element(src, "PS_Position:0", v);
    return [0, 1, 2].map(k => Math.max(-1, bytes.readInt16LE(k * 2) / 32767) * input.scale[k] + input.offset[k]);
  });
  // The whole-blob comparison fixed the quantization to the input's, so the step is the head's own.
  const positionTolerance = input.scale.map(s => s / 32767 / 2 + 1e-9);
  let maxPositionError = 0;
  packaged.chunks.forEach((chunk, k) => {
    const lift = liftsMm[k] / 1000;
    ensure(chunk.indices.equals(src.indices), `Packaged plate chunk ${k} triangles differ from the input`);
    for (let v = 0; v < n; v++) {
      for (const e of src.layout) {
        const got = element(chunk, e.usage, v), want = element(src, e.usage, v);
        if (e.usage === "PS_Position:0") {
          ensure(got.readInt16LE(6) === want.readInt16LE(6), `Packaged plate chunk ${k} vertex ${v} position W differs`);
          for (let a = 0; a < 3; a++) {
            const decoded = Math.max(-1, got.readInt16LE(a * 2) / 32767) * input.scale[a] + input.offset[a];
            const error = Math.abs(decoded - (positions[v][a] + lift * normals[v][a]));
            ensure(error <= positionTolerance[a], `Packaged plate chunk ${k} vertex ${v} is not lifted ${liftsMm[k]} mm along its normal`);
            ensure(error * 1000 <= VERIFIER_MAX_POSITION_ERROR_MM, `Packaged plate chunk ${k} vertex ${v} position error exceeds ${VERIFIER_MAX_POSITION_ERROR_MM} mm`);
            maxPositionError = Math.max(maxPositionError, error);
          }
        } else ensure(got.equals(want), `Packaged plate chunk ${k} ${e.usage} bytes differ from the input at vertex ${v}`);
      }
    }
  });

  // Morph rows: per target, one run per chunk, each the input run with lifted position deltas.
  const inBlob = sourceMorph.blob.Data, outBlob = morph.blob?.Data, ih = inBlob.header, oh = outBlob?.header;
  ensure(oh && typeof oh === "object", "Packaged plate morph has no blob header");
  const targets: number = ih.numTargets;
  ensure(Number.isSafeInteger(targets) && targets >= 0 && [ih.numVertexDiffsInEachChunk, ih.numVertexDiffsMappingInEachChunk,
    ih.targetStartsInVertexDiffs, ih.targetStartsInVertexDiffsMapping, ih.targetPositionDiffScale, ih.targetPositionDiffOffset]
    .every(list => Array.isArray(list) && list.length === targets), "Plate input morph header is inconsistent");
  ensure(Array.isArray(oh.targetPositionDiffScale) && oh.targetPositionDiffScale.length === targets &&
    Array.isArray(oh.targetPositionDiffOffset) && oh.targetPositionDiffOffset.length === targets, "Packaged morph target count differs from the input");
  const inDiffs = Buffer.from(String(inBlob.diffsBuffer?.Bytes ?? ""), "base64"), inMaps = Buffer.from(String(inBlob.mappingBuffer?.Bytes ?? ""), "base64");
  const outDiffs = Buffer.from(String(outBlob.diffsBuffer?.Bytes ?? ""), "base64");
  // Re-derived counts, starts and totals: each target's input run repeated once per chunk, targets in order.
  const counts: number[] = [], maps: number[] = [];
  for (let t = 0; t < targets; t++) {
    ensure(ih.numVertexDiffsInEachChunk[t]?.length === 1 && ih.numVertexDiffsMappingInEachChunk[t]?.length === 1,
      "Plate input morph must hold one chunk per target");
    counts.push(ih.numVertexDiffsInEachChunk[t][0]); maps.push(ih.numVertexDiffsMappingInEachChunk[t][0]);
    const i0 = ih.targetStartsInVertexDiffs[t] * 12, m0 = ih.targetStartsInVertexDiffsMapping[t] * 4;
    ensure(i0 + counts[t] * 12 <= inDiffs.length && m0 + maps[t] * 4 <= inMaps.length && counts[t] <= maps[t] * 2,
      `Plate input morph target ${t} lies outside its buffers`);
  }
  const starts: number[] = [], mapStarts: number[] = [];
  let totalRows = 0, totalMaps = 0;
  for (let t = 0; t < targets; t++) {
    starts.push(totalRows); mapStarts.push(totalMaps);
    totalRows += counts[t] * lifts; totalMaps += maps[t] * lifts;
  }
  ensure(outDiffs.length === totalRows * 12, `Packaged morph holds ${outDiffs.length / 12} rows, not the ${totalRows} lifted input rows`);
  const expectedMaps = Buffer.concat(Array.from({ length: targets }, (_, t) => {
    const m0 = ih.targetStartsInVertexDiffsMapping[t] * 4, run = inMaps.subarray(m0, m0 + maps[t] * 4);
    return Buffer.concat(Array.from({ length: lifts }, () => run));
  }));

  let rows = 0, maxDeltaError = 0, requantizedTargets = 0;
  for (let t = 0; t < targets; t++) {
    const count = counts[t], i0 = ih.targetStartsInVertexDiffs[t] * 12, m0 = ih.targetStartsInVertexDiffsMapping[t] * 4;
    const inScale = vec(ih.targetPositionDiffScale[t]), inOffset = vec(ih.targetPositionDiffOffset[t]);
    // The lifted deltas this target must encode, per chunk and row.
    const lifted = liftsMm.map(liftMm => Array.from({ length: count }, (_, r) => {
      const inRow = inDiffs.subarray(i0 + r * 12, i0 + r * 12 + 12), v = inMaps.readUInt16LE(m0 + r * 2), n0 = normals[v];
      ensure(n0, `Plate input morph target ${t} row ${r} names vertex ${v}, outside the plate`);
      const moved = unit(tenBits(inRow.readUInt32LE(4)).map((q, a) => n0[a] + q * 2 / 1023 - 1)), inQ = tenBits(inRow.readUInt32LE(0));
      return [0, 1, 2].map(a => inQ[a] / 1023 * inScale[a] + inOffset[a] + liftMm / 1000 * (moved[a] - n0[a]));
    }));
    // Quantization: the input's, or exactly the lifted deltas' range (never a wider, looser one).
    const outScaleV = oh.targetPositionDiffScale[t], outOffsetV = oh.targetPositionDiffOffset[t];
    if (!sameJson(outScaleV, ih.targetPositionDiffScale[t]) || !sameJson(outOffsetV, ih.targetPositionDiffOffset[t])) {
      const xyzFree = (v: Node) => ({ ...v, X: 0, Y: 0, Z: 0 });
      ensure(sameJson(xyzFree(outScaleV), xyzFree(ih.targetPositionDiffScale[t])) && sameJson(xyzFree(outOffsetV), xyzFree(ih.targetPositionDiffOffset[t])),
        `Packaged morph target ${t} quantization differs from the input outside X, Y and Z`);
      const all = lifted.flat();
      for (let a = 0; a < 3; a++) {
        const low = Math.min(...all.map(d => d[a])), high = Math.max(...all.map(d => d[a]));
        ensure(sameFloat32(vec(outOffsetV)[a], low) && sameFloat32(vec(outScaleV)[a], Math.max(high - low, 1e-9)),
          `Packaged morph target ${t} is re-quantized to a range other than its lifted deltas`);
      }
      requantizedTargets++;
    }
    const outScale = vec(outScaleV), outOffset = vec(outOffsetV);
    // Half a step, plus float32 storage of the step and offset.
    const tolerance = outScale.map((s, a) => s / 1023 / 2 + 2 ** -23 * (Math.abs(s) + Math.abs(outOffset[a])) + 1e-9);
    lifted.forEach((chunk, k) => {
      const o0 = (starts[t] + k * count) * 12;
      chunk.forEach((want, r) => {
        const inRow = inDiffs.subarray(i0 + r * 12, i0 + r * 12 + 12), outRow = outDiffs.subarray(o0 + r * 12, o0 + r * 12 + 12);
        ensure(outRow.subarray(4).equals(inRow.subarray(4)), `Packaged morph target ${t} chunk ${k} row ${r} shading deltas differ`);
        ensure((outRow.readUInt32LE(0) >>> 30) === (inRow.readUInt32LE(0) >>> 30), `Packaged morph target ${t} chunk ${k} row ${r} flag bits differ`);
        const outQ = tenBits(outRow.readUInt32LE(0));
        for (let a = 0; a < 3; a++) {
          const error = Math.abs(outQ[a] / 1023 * outScale[a] + outOffset[a] - want[a]);
          ensure(error <= tolerance[a], `Packaged morph target ${t} chunk ${k} row ${r} delta is not the lifted input delta`);
          ensure(error * 1000 <= VERIFIER_MAX_MORPH_DELTA_ERROR_MM,
            `Packaged morph target ${t} chunk ${k} row ${r} delta error exceeds ${VERIFIER_MAX_MORPH_DELTA_ERROR_MM} mm`);
          maxDeltaError = Math.max(maxDeltaError, error);
        }
        rows++;
      });
    });
  }

  // The whole morph blob: the input's, with the re-derived counts, starts, totals, mapping and base.
  const expected = structuredClone(inBlob), header = expected.header;
  Object.assign(header, {
    numVertexDiffsInEachChunk: counts.map(count => liftsMm.map(() => count)),
    numVertexDiffsMappingInEachChunk: maps.map(count => liftsMm.map(() => count)),
    targetStartsInVertexDiffs: starts, targetStartsInVertexDiffsMapping: mapStarts, numDiffs: totalRows, numDiffsMapping: totalMaps,
    // Checked above against the input or the lifted range.
    targetPositionDiffScale: oh.targetPositionDiffScale, targetPositionDiffOffset: oh.targetPositionDiffOffset,
  });
  expected.baseBlob = { ...expected.baseBlob, Data: outBlob.baseBlob.Data }; // compared whole above
  expected.diffsBuffer = { ...expected.diffsBuffer, Bytes: outBlob.diffsBuffer?.Bytes }; // every row checked above
  const outMaps = Buffer.from(String(outBlob.mappingBuffer?.Bytes ?? ""), "base64");
  ensure(outMaps.length === expectedMaps.length, `Packaged morph mapping holds ${outMaps.length} bytes, not the ${expectedMaps.length} of the lifted input`);
  expected.mappingBuffer = { ...expected.mappingBuffer, Bytes: expectedMaps.toString("base64") };
  const differs = firstDifference(outBlob, expected, HANDLE_KEYS);
  ensure(differs === null, `Packaged plate morph ${differs} differs from the input`);

  return { liftsMm: [...liftsMm], chunks: lifts, vertices: n, morphTargets: targets, morphRows: rows, requantizedTargets,
    maxPositionErrorMm: Math.round(maxPositionError * 1e9) / 1e6, maxMorphDeltaErrorMm: Math.round(maxDeltaError * 1e9) / 1e6,
    nonPositionBytesExact: true, meshMorphBaseIdentical: true, morphShadingDeltasExact: true, blobsMatchInput: true, meshQuantizationRetained: true };
}
