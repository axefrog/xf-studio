/**
 * Minimal binary glTF 2.0 reader and writer for host-side asset derivation. It reads
 * tightly scoped inputs (WolvenKit's exports) and writes deterministic GLBs: the same
 * document and arrays always produce the same bytes. No rendering or scene logic lives here.
 */

// glTF JSON is an external, loosely typed document model.
export type GltfJson = any;

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
export const COMPONENT = { BYTE: 5120, UNSIGNED_BYTE: 5121, SHORT: 5122, UNSIGNED_SHORT: 5123, UNSIGNED_INT: 5125, FLOAT: 5126 } as const;
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
export const TYPE_WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export type Glb = { json: GltfJson; bin: Uint8Array };
export type AccessorArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;
export type Accessor = { array: AccessorArray; width: number; count: number; componentType: number; normalized: boolean };

export function parseGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
    throw Error("Not a binary glTF 2.0 file.");
  if (view.getUint32(8, true) !== bytes.byteLength) throw Error("The GLB length header does not match the file.");
  let offset = 12, json: GltfJson, bin: Uint8Array = new Uint8Array(0);
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength) throw Error("A GLB chunk runs past the end of the file.");
    const chunk = bytes.subarray(offset, offset + length);
    if (type === JSON_CHUNK && json === undefined) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === BIN_CHUNK && bin.byteLength === 0) bin = chunk;
    offset += length;
  }
  if (!json || json.asset?.version !== "2.0") throw Error("The GLB has no glTF 2.0 JSON chunk.");
  return { json, bin };
}

const ARRAY_TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array } as const;

/** Read `count` elements of `width` components from a buffer view into a new typed array. */
function readView(glb: Glb, viewIndex: number, byteOffset: number, componentType: number, width: number, count: number, label: string): AccessorArray {
  const size = COMPONENT_BYTES[componentType];
  const Type = ARRAY_TYPES[componentType as 5120];
  if (!size || !Type) throw Error(`${label} has an unsupported component type.`);
  const view = glb.json.bufferViews?.[viewIndex];
  if (!view) throw Error(`${label} names a missing buffer view.`);
  const stride = view.byteStride ?? width * size;
  const start = (view.byteOffset ?? 0) + byteOffset;
  const out = new Type(count * width);
  if (count === 0) return out;
  if (start + (count - 1) * stride + width * size > glb.bin.byteLength) throw Error(`${label} runs past the binary chunk.`);
  const data = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  const read = ({ 5120: (o: number) => data.getInt8(o), 5121: (o: number) => data.getUint8(o),
    5122: (o: number) => data.getInt16(o, true), 5123: (o: number) => data.getUint16(o, true),
    5125: (o: number) => data.getUint32(o, true), 5126: (o: number) => data.getFloat32(o, true) } as Record<number, (o: number) => number>)[componentType]!;
  for (let item = 0; item < count; item++)
    for (let k = 0; k < width; k++) out[item * width + k] = read(start + item * stride + k * size);
  return out;
}

/** Copy one accessor (dense or sparse) out of the binary chunk. */
export function readAccessor(glb: Glb, index: number): Accessor {
  const accessor = glb.json.accessors?.[index];
  if (!accessor) throw Error(`Accessor ${index} is missing.`);
  const width = TYPE_WIDTH[accessor.type];
  if (!width) throw Error(`Accessor ${index} has an unsupported type.`);
  const count: number = accessor.count;
  const label = `Accessor ${index}`;
  const out = accessor.bufferView !== undefined
    ? readView(glb, accessor.bufferView, accessor.byteOffset ?? 0, accessor.componentType, width, count, label)
    : new ARRAY_TYPES[accessor.componentType as 5120](count * width);
  if (accessor.sparse) {
    const { count: changed, indices, values } = accessor.sparse;
    const at = readView(glb, indices.bufferView, indices.byteOffset ?? 0, indices.componentType, 1, changed, `${label} sparse indices`);
    const replacement = readView(glb, values.bufferView, values.byteOffset ?? 0, accessor.componentType, width, changed, `${label} sparse values`);
    for (let item = 0; item < changed; item++) {
      const target = at[item]!;
      if (target >= count) throw Error(`${label} has a sparse index out of range.`);
      for (let k = 0; k < width; k++) out[target * width + k] = replacement[item * width + k]!;
    }
  }
  return { array: out, width, count, componentType: accessor.componentType, normalized: !!accessor.normalized };
}

/** Normalized-integer accessors decoded to floats in [0, 1] (or [-1, 1]); floats are returned as-is. */
export function accessorFloats(accessor: Accessor): Float32Array {
  if (accessor.array instanceof Float32Array) return accessor.array;
  if (!accessor.normalized) return Float32Array.from(accessor.array);
  const max = ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[accessor.componentType]!;
  return Float32Array.from(accessor.array, value => Math.max(value / max, -1));
}

/** Accumulates typed arrays into one 4-byte aligned binary buffer, one buffer view per accessor. */
export class GlbWriter {
  readonly accessors: GltfJson[] = [];
  readonly bufferViews: GltfJson[] = [];
  private parts: Uint8Array[] = [];
  private length = 0;
  add(array: AccessorArray, type: keyof typeof TYPE_WIDTH, options: { normalized?: boolean; target?: 34962 | 34963; bounds?: boolean } = {}): number {
    const width = TYPE_WIDTH[type]!;
    if (array.length % width) throw Error("Accessor data does not divide into whole elements.");
    const componentType = array instanceof Float32Array ? COMPONENT.FLOAT : array instanceof Uint32Array ? COMPONENT.UNSIGNED_INT :
      array instanceof Uint16Array ? COMPONENT.UNSIGNED_SHORT : array instanceof Uint8Array ? COMPONENT.UNSIGNED_BYTE :
      array instanceof Int16Array ? COMPONENT.SHORT : COMPONENT.BYTE;
    const viewIndex = this.view(array);
    if (options.target) this.bufferViews[viewIndex].target = options.target;
    const count = array.length / width;
    const accessor: GltfJson = { bufferView: viewIndex, componentType, count, type };
    if (options.normalized) accessor.normalized = true;
    if (options.bounds && count) {
      const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);
      for (let i = 0; i < array.length; i++) { const k = i % width; min[k] = Math.min(min[k], array[i]!); max[k] = Math.max(max[k], array[i]!); }
      accessor.min = min; accessor.max = max;
    }
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }
  private view(array: AccessorArray): number {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) { this.parts.push(new Uint8Array(padding)); this.length += padding; }
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength });
    this.parts.push(Uint8Array.from(bytes));
    this.length += bytes.byteLength;
    return this.bufferViews.length - 1;
  }
  /**
   * Float accessor stored sparsely against an implicit all-zero base: only rows with a
   * non-zero component are written. Suited to morph target deltas. Always records bounds.
   */
  addSparse(array: Float32Array, type: keyof typeof TYPE_WIDTH): number {
    const width = TYPE_WIDTH[type]!;
    const count = array.length / width;
    const rows: number[] = [];
    for (let row = 0; row < count; row++)
      for (let k = 0; k < width; k++) if (array[row * width + k] !== 0) { rows.push(row); break; }
    const min = Array(width).fill(0), max = Array(width).fill(0);
    for (const row of rows) for (let k = 0; k < width; k++) {
      const value = array[row * width + k]!;
      if (value < min[k]) min[k] = value;
      if (value > max[k]) max[k] = value;
    }
    const accessor: GltfJson = { componentType: COMPONENT.FLOAT, count, type, min, max };
    if (rows.length) {
      const indices = Uint32Array.from(rows), values = new Float32Array(rows.length * width);
      rows.forEach((row, index) => values.set(array.subarray(row * width, (row + 1) * width), index * width));
      accessor.sparse = { count: rows.length, indices: { bufferView: this.view(indices), componentType: COMPONENT.UNSIGNED_INT },
        values: { bufferView: this.view(values) } };
    }
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }
  /** Serialize `json` (accessors, bufferViews and buffers are filled in here) with the collected binary data. */
  toGlb(json: GltfJson): Uint8Array {
    const document = { ...json, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{ byteLength: this.length }] };
    const text = new TextEncoder().encode(JSON.stringify(document));
    const jsonLength = Math.ceil(text.byteLength / 4) * 4, binLength = Math.ceil(this.length / 4) * 4;
    const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.byteLength, true);
    view.setUint32(12, jsonLength, true); view.setUint32(16, JSON_CHUNK, true);
    out.set(text, 20); out.fill(0x20, 20 + text.byteLength, 20 + jsonLength);
    let offset = 20 + jsonLength;
    view.setUint32(offset, binLength, true); view.setUint32(offset + 4, BIN_CHUNK, true);
    offset += 8;
    for (const part of this.parts) { out.set(part, offset); offset += part.byteLength; }
    return out;
  }
}

/**
 * A copy of a GLB holding only the meshes `keep` selects (PREV-53): WolvenKit exports every render chunk of a mesh, but a
 * character detail draws only its visible chunks, and each chunk carries its own dense morph deltas (105 facial targets
 * in the head decals). Nodes whose mesh is dropped stay, empty, so node indices, skins and the scene graph are unchanged.
 * Kept accessors are copied as they are (component type, normalisation, bounds), except morph target deltas: POSITION
 * and NORMAL are stored sparsely against zero (most vertices of a facial target don't move), and TANGENT deltas, which
 * Three's loader never reads, are left out. Target names and their order are kept. Deterministic. Throws on anything it
 * does not copy (images, animations, extensions), so a caller can keep the whole file instead.
 */
export function keepGlbMeshes(bytes: Uint8Array, keep: (mesh: GltfJson, index: number) => boolean): Uint8Array {
  const glb = parseGlb(bytes), json = glb.json;
  if (json.extensionsUsed?.length || json.images?.length || json.animations?.length || (json.buffers?.length ?? 0) > 1)
    throw Error("The GLB uses parts the chunk copy does not carry.");
  const writer = new GlbWriter(), copied = new Map<number, number>();
  const copy = (index: number): number => {
    const known = copied.get(index);
    if (known !== undefined) return known;
    const source = json.accessors[index], accessor = readAccessor(glb, index);
    if (source.sparse) throw Error("The GLB has a sparse accessor outside morph targets.");
    const target = json.bufferViews[source.bufferView]?.target;
    const made = writer.add(accessor.array, source.type, { normalized: !!source.normalized, ...(target ? { target } : {}) });
    if (source.min) writer.accessors[made].min = source.min;
    if (source.max) writer.accessors[made].max = source.max;
    copied.set(index, made);
    return made;
  };
  const meshIndex = new Map<number, number>(), meshes: GltfJson[] = [];
  (json.meshes ?? []).forEach((mesh: GltfJson, index: number) => {
    if (!keep(mesh, index)) return;
    meshIndex.set(index, meshes.length);
    meshes.push({ ...mesh, primitives: mesh.primitives.map((primitive: GltfJson) => ({ ...primitive,
      attributes: Object.fromEntries(Object.entries<number>(primitive.attributes).map(([name, at]) => [name, copy(at)])),
      ...(primitive.indices !== undefined ? { indices: copy(primitive.indices) } : {}),
      ...(primitive.targets ? { targets: primitive.targets.map((target: Record<string, number>) => Object.fromEntries(Object.entries(target)
        .filter(([name]) => name !== "TANGENT")
        .map(([name, at]) => [name, name === "POSITION" || name === "NORMAL"
          ? writer.addSparse(accessorFloats(readAccessor(glb, at)), json.accessors[at].type) : copy(at)]))) } : {}) })) });
  });
  const nodes = (json.nodes ?? []).map((node: GltfJson) => {
    if (node.mesh === undefined) return node;
    const mapped = meshIndex.get(node.mesh);
    if (mapped !== undefined) return { ...node, mesh: mapped };
    const { mesh: _mesh, skin: _skin, weights: _weights, ...rest } = node;
    return rest;
  });
  const skins = json.skins?.map((skin: GltfJson) => skin.inverseBindMatrices === undefined ? skin : { ...skin, inverseBindMatrices: copy(skin.inverseBindMatrices) });
  const { accessors: _a, bufferViews: _v, buffers: _b, ...rest } = json;
  return writer.toGlb({ ...rest, meshes, nodes, ...(skins ? { skins } : {}) });
}
