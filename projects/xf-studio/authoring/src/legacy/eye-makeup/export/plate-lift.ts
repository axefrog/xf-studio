// Decal lift for the packaged eye plate. Pure: WolvenKit JSON in, WolvenKit JSON out; no IO.
//
// The built-in plate is an exact cut of the head (same vertex bytes), so it coincides with the
// skin it is drawn over. Vanilla face decals do not: the 2.31 female eye-makeup, lip, freckle and
// pimple meshes are the head's own vertices pushed 0.40 mm out along the head's vertex normals
// (median residual 5 µm), and their morph targets keep that offset along each target's normal
// (experiments/017-plate-depth). The legacy eye-makeup generator's build and a community eyeshadow mod
// reuse the vanilla eye-makeup mesh byte for byte. A coincident plate relies on the decal pass's
// depth bias alone and broke up into skin-coloured patches at close range in game (25 September).
//
// The lift moves only positions: base positions become p + L·n (n = the head's stored shading
// normal), and every morph row's position delta gains L·(normalize(n + Δn) − n), so the offset
// follows the target's own shading normal like the vanilla decals. Skin indices and weights,
// normals, tangents, UVs, colours, triangle order and every morph normal/tangent delta stay the
// head's bytes. Mesh and morph base buffers receive identical bytes. A lift of 0 reproduces the
// input exactly.
//
// Several lifts produce one render chunk per lift (a diagnostic comparison inside one selector);
// each preset's mesh appearance then binds its own chunk and hides the others.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Production lift in millimetres: the vanilla face-decal offset. */
export const PLATE_LIFT_MM = 0.4;
/** Largest lift the builder accepts (diagnostics included). */
export const MAX_PLATE_LIFT_MM = 1;

const ELEMENT_BYTES: Readonly<Record<string, number>> = {
  PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4,
  PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16,
};
const align16 = (value: number) => Math.ceil(value / 16) * 16;
const AXES = ["X", "Y", "Z"] as const;

type Element = { usage: string; type: string; stream: number; offset: number; size: number };
function elements(layout: Json): Element[] {
  const cursor = new Map<number, number>(), out: Element[] = [];
  for (const e of layout.elements.Elements) {
    if (e.streamType !== "ST_PerVertex") continue;
    const size = ELEMENT_BYTES[e.type];
    if (!size) throw Error(`Unsupported vertex element type ${e.type}.`);
    const offset = cursor.get(e.streamIndex) ?? 0;
    out.push({ usage: e.usage, type: e.type, stream: e.streamIndex, offset, size });
    cursor.set(e.streamIndex, offset + size);
  }
  return out;
}

/** Shading normal of a PT_Dec4 word: three 10-bit fields, x·2/1023 − 1 each, normalised. */
export function decodeDec4Normal(word: number): [number, number, number] {
  const v = [0, 10, 20].map(shift => ((word >>> shift) & 0x3ff) * 2 / 1023 - 1);
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A morph normal delta: three 10-bit fields, x·2/1023 − 1 each (not normalised). */
const tenBitShifted = (word: number) => [0, 10, 20].map(shift => ((word >>> shift) & 0x3ff) * 2 / 1023 - 1);

type Decoded = {
  header: Json; chunk: Json; raw: Buffer; elements: Element[]; strides: number[]; offsets: number[];
  count: number; positions: Float64Array; normals: Float64Array; positionElement: Element;
};

function decodeSingleChunk(blob: Json, label: string): Decoded {
  const header = blob.header;
  if (!Array.isArray(header?.renderChunkInfos) || header.renderChunkInfos.length !== 1)
    throw Error(`The ${label} must hold exactly one render chunk before the lift.`);
  const chunk = header.renderChunkInfos[0];
  if (chunk.chunkIndices?.pe !== "IBCT_IndexUShort" || chunk.chunkIndices?.teOffset !== 0)
    throw Error(`The ${label} uses an unsupported index layout.`);
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  const layout = chunk.chunkVertices.vertexLayout, list = elements(layout);
  const strides: number[] = layout.slotStrides.Elements, offsets: number[] = chunk.chunkVertices.byteOffsets.Elements;
  const positionElement = list.find(e => e.usage === "PS_Position"), normal = list.find(e => e.usage === "PS_Normal");
  if (positionElement?.type !== "PT_Short4N" || normal?.type !== "PT_Dec4")
    throw Error(`The ${label} lacks Short4N positions or Dec4 normals.`);
  const count: number = chunk.numVertices;
  const scale = AXES.map(axis => Number(header.quantizationScale[axis])), offset = AXES.map(axis => Number(header.quantizationOffset[axis]));
  const positions = new Float64Array(count * 3), normals = new Float64Array(count * 3);
  for (let v = 0; v < count; v++) {
    const at = offsets[positionElement.stream] + v * strides[positionElement.stream] + positionElement.offset;
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = Math.max(-1, raw.readInt16LE(at + k * 2) / 32767) * scale[k] + offset[k];
    const n = decodeDec4Normal(raw.readUInt32LE(offsets[normal.stream] + v * strides[normal.stream] + normal.offset));
    normals.set(n, v * 3);
  }
  return { header, chunk, raw, elements: list, strides, offsets, count, positions, normals, positionElement };
}

export type PlateLiftReport = {
  liftsMm: number[]; chunks: number;
  /** The head's position quantization still covers every lifted position (a lift that leaves it is refused). */
  headQuantizationRetained: true;
  /** Morph targets whose delta quantization had to widen to hold the lifted deltas. */
  requantizedTargets: number;
  /** Largest distance between an intended lifted position and its encoded value, in mm. */
  maxPositionErrorMm: number;
};

/**
 * The head's position quantization, which the lifted plate must keep: the package verifier requires it
 * unchanged, so a lift that leaves it is refused rather than re-quantizing every position.
 */
function quantization(header: Json, lifted: Float64Array[]) {
  const scale = AXES.map(axis => Number(header.quantizationScale[axis])), offset = AXES.map(axis => Number(header.quantizationOffset[axis]));
  const fits = lifted.every(p => p.every((value, i) => Math.abs((value - offset[i % 3]) / scale[i % 3]) <= 1));
  if (!fits) throw Error("The lifted plate would leave the head's position range; lower the lift.");
  return { scale, offset };
}

/** Render blob with one chunk per lift; every non-position byte is the source's. */
function liftedBlob(source: Decoded, blob: Json, lifted: Float64Array[], q: { scale: number[]; offset: number[] }) {
  const { chunk, raw, strides, offsets, count, positionElement } = source;
  const streams = [...new Set(source.elements.map(e => e.stream))].sort((a, b) => a - b);
  const parts: Buffer[] = [];
  const chunkOffsets: number[][] = [];
  let cursor = 0, maxError = 0;
  for (const positions of lifted) {
    const byteOffsets = offsets.map(() => 0);
    for (const stream of streams) {
      const stride = strides[stream];
      if (!stride) continue;
      const start = align16(cursor);
      if (start > cursor) parts.push(Buffer.alloc(start - cursor));
      byteOffsets[stream] = start;
      const block = Buffer.from(raw.subarray(offsets[stream], offsets[stream] + stride * count));
      if (stream === positionElement.stream) for (let v = 0; v < count; v++) for (let k = 0; k < 3; k++) {
        const value = positions[v * 3 + k], normalised = Math.max(-1, Math.min(1, (value - q.offset[k]) / q.scale[k]));
        const encoded = Math.round(normalised * 32767);
        block.writeInt16LE(encoded, v * stride + positionElement.offset + k * 2);
        maxError = Math.max(maxError, Math.abs(Math.max(-1, encoded / 32767) * q.scale[k] + q.offset[k] - value));
      }
      parts.push(block);
      cursor = start + block.length;
    }
    chunkOffsets.push(byteOffsets);
  }
  const vertexBufferSize = cursor, indexBufferOffset = align16(vertexBufferSize);
  const indexBytes = chunk.numIndices * 2;
  const indices = raw.subarray(source.header.indexBufferOffset, source.header.indexBufferOffset + indexBytes);
  const buffer = Buffer.concat([...parts, Buffer.alloc(indexBufferOffset - vertexBufferSize), ...lifted.map(() => indices)]);
  const out = structuredClone(blob);
  const header = out.header;
  header.renderChunkInfos = lifted.map((_, k) => {
    const next = structuredClone(chunk);
    next.chunkVertices.byteOffsets.Elements = chunkOffsets[k];
    next.chunkIndices.teOffset = k * indexBytes; // A byte offset, as in vanilla multi-chunk decals.
    return next;
  });
  if (Array.isArray(header.topology) && header.topology.length === 1)
    header.topology = lifted.map(() => structuredClone(header.topology[0]));
  header.vertexBufferSize = vertexBufferSize;
  header.indexBufferOffset = indexBufferOffset;
  header.indexBufferSize = indexBytes * lifted.length;
  out.renderBuffer.Bytes = buffer.toString("base64");
  return { blob: out, maxError };
}

/**
 * Lift the plate by each of `liftsMm` (one chunk per value, in order). The mesh and morph documents
 * must be the single-chunk plate whose mesh and morph base buffers are byte-identical.
 */
export function liftPlate(meshDoc: Json, morphDoc: Json, liftsMm: readonly number[]): { mesh: Json; morph: Json; report: PlateLiftReport } {
  if (!liftsMm.length || liftsMm.some(mm => !Number.isFinite(mm) || mm < 0 || mm > MAX_PLATE_LIFT_MM))
    throw Error(`Plate lifts must be between 0 and ${MAX_PLATE_LIFT_MM} mm.`);
  const meshBlob = meshDoc.Data.RootChunk.renderResourceBlob.Data;
  const morphBlob = morphDoc.Data.RootChunk.blob.Data;
  const source = decodeSingleChunk(meshBlob, "plate mesh"), base = decodeSingleChunk(morphBlob.baseBlob.Data, "plate morph base");
  if (!source.raw.equals(base.raw) || JSON.stringify([source.header.quantizationScale, source.header.quantizationOffset]) !==
      JSON.stringify([base.header.quantizationScale, base.header.quantizationOffset]))
    throw Error("The plate mesh and morph base buffers differ; the lift needs the exact derived plate.");
  const lifts = liftsMm.map(mm => mm / 1000);
  const lifted = lifts.map(lift => source.positions.map((value, i) => value + lift * source.normals[i]));
  const q = quantization(source.header, lifted);
  const meshOut = liftedBlob(source, meshBlob, lifted, q), baseOut = liftedBlob(base, morphBlob.baseBlob.Data, lifted, q);

  // Morph diffs: one run per chunk inside each target, the source rows with re-encoded positions.
  const header = morphBlob.header;
  const diffs = Buffer.from(morphBlob.diffsBuffer.Bytes, "base64"), mapping = Buffer.from(morphBlob.mappingBuffer.Bytes, "base64");
  const outDiffs: Buffer[] = [], outMaps: Buffer[] = [];
  const counts: number[][] = [], mapCounts: number[][] = [], starts: number[] = [], mapStarts: number[] = [];
  const offsets: Json[] = structuredClone(header.targetPositionDiffOffset), scales: Json[] = structuredClone(header.targetPositionDiffScale);
  let diffCursor = 0, mapCursor = 0, requantizedTargets = 0;
  for (let t = 0; t < header.numTargets; t++) {
    const chunkDiffs: number[] = header.numVertexDiffsInEachChunk[t], chunkMaps: number[] = header.numVertexDiffsMappingInEachChunk[t];
    if (chunkDiffs.length !== 1 || chunkMaps.length !== 1) throw Error("The plate morph must hold one chunk per target before the lift.");
    const n = chunkDiffs[0], d0 = header.targetStartsInVertexDiffs[t] * 12, m0 = header.targetStartsInVertexDiffsMapping[t] * 4;
    const scale = AXES.map(axis => Number(header.targetPositionDiffScale[t][axis])), offset = AXES.map(axis => Number(header.targetPositionDiffOffset[t][axis]));
    const rows = Array.from({ length: n }, (_, i) => diffs.subarray(d0 + i * 12, d0 + i * 12 + 12));
    const vertices = Array.from({ length: n }, (_, i) => mapping.readUInt16LE(m0 + i * 2));
    const mapBytes = mapping.subarray(m0, m0 + chunkMaps[0] * 4);
    const deltas = lifts.map(lift => rows.map((row, i) => {
      const word = row.readUInt32LE(0), v = vertices[i];
      const n0 = [0, 1, 2].map(k => source.normals[v * 3 + k]), dn = tenBitShifted(row.readUInt32LE(4));
      const moved = n0.map((c, k) => c + dn[k]), length = Math.hypot(moved[0], moved[1], moved[2]) || 1;
      return [0, 1, 2].map(k => ((word >>> (10 * k)) & 0x3ff) / 1023 * scale[k] + offset[k] + lift * (moved[k] / length - n0[k]));
    }));
    // Keep the head's quantization when every lifted delta fits it; otherwise cover the lifted range.
    let qScale = scale, qOffset = offset;
    const all = deltas.flat();
    if (!all.every(d => d.every((value, k) => { const f = (value - offset[k]) / scale[k]; return f >= -0.5 / 1023 && f <= 1 + 0.5 / 1023; }))) {
      qOffset = [0, 1, 2].map(k => Math.min(...all.map(d => d[k])));
      qScale = [0, 1, 2].map(k => Math.max(Math.max(...all.map(d => d[k])) - qOffset[k], 1e-9));
      for (const [k, axis] of AXES.entries()) { offsets[t][axis] = qOffset[k]; scales[t][axis] = qScale[k]; }
      requantizedTargets++;
    }
    starts.push(diffCursor); mapStarts.push(mapCursor);
    for (const chunk of deltas) {
      chunk.forEach((delta, i) => {
        const row = Buffer.from(rows[i]);
        let word = row.readUInt32LE(0) & 0xc0000000;
        delta.forEach((value, k) => {
          const code = Math.max(0, Math.min(1023, Math.round((value - qOffset[k]) / qScale[k] * 1023)));
          word |= code << (10 * k);
        });
        row.writeUInt32LE(word >>> 0, 0);
        outDiffs.push(row);
      });
      outMaps.push(Buffer.from(mapBytes));
    }
    counts.push(lifts.map(() => n)); mapCounts.push(lifts.map(() => chunkMaps[0]));
    diffCursor += n * lifts.length; mapCursor += chunkMaps[0] * lifts.length;
  }
  const morph = structuredClone(morphDoc), mesh = structuredClone(meshDoc);
  const outBlob = morph.Data.RootChunk.blob.Data, outHeader = outBlob.header;
  outBlob.baseBlob = { ...outBlob.baseBlob, Data: baseOut.blob };
  outBlob.diffsBuffer.Bytes = Buffer.concat(outDiffs).toString("base64");
  outBlob.mappingBuffer.Bytes = Buffer.concat(outMaps).toString("base64");
  Object.assign(outHeader, { numVertexDiffsInEachChunk: counts, numVertexDiffsMappingInEachChunk: mapCounts,
    targetStartsInVertexDiffs: starts, targetStartsInVertexDiffsMapping: mapStarts, numDiffs: diffCursor, numDiffsMapping: mapCursor,
    targetPositionDiffOffset: offsets, targetPositionDiffScale: scales });
  mesh.Data.RootChunk.renderResourceBlob = { ...mesh.Data.RootChunk.renderResourceBlob, Data: meshOut.blob };
  return { mesh, morph, report: { liftsMm: [...liftsMm], chunks: lifts.length, headQuantizationRetained: true,
    requantizedTargets, maxPositionErrorMm: Math.round(meshOut.maxError * 1e9) / 1e6 } };
}
