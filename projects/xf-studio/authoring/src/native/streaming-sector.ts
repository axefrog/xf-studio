/** Offline W0 sector adapter. Layout: WolvenKit 11720772 worldStreamingSector appendix, worldNodeDataReader and
 * CollisionReader (studied as documentation). Deliberately separate from the resolver's verified read path.
 * Cooked meshes retain their type/hash; no dimensions are invented. All counts are bounded before allocation. */
import { Cr2wFile } from "./cr2w-file";
import { Cr2wDecoder } from "./cr2w-reader";
import type { Decompress } from "./kark";
import { DecodeSession } from "./limits";
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { RedBuffer } from "./red-model";
import { Cursor, readVarString } from "./red-values";

export const SECTOR_READER_VERSION = 3;
export type SectorVector = [number, number, number];
export type SectorQuaternion = [number, number, number, number];
export interface SectorPlacement {
  position: SectorVector; positionW: number; orientation: SectorQuaternion; scale: SectorVector;
  pivot: SectorVector; bounds: { min: SectorVector; max: SectorVector };
  id: string; questPrefabRefHash: string; ukHash1: string; cookedPrefabData: string;
  maxStreamingDistance: number; ukFloat1: number; nodeIndex: number;
  unknown16: number[]; unknown64: string[];
}
export interface SectorAppendix { version: number; nodeData: RedBuffer | null; nodes: number[]; nodeRefs: string[]; variantIndices: number[]; persistentNodeIndex: number }
export type CollisionType = "Box" | "Sphere" | "Capsule" | "ConvexMesh" | "TriangleMesh";
export interface CollisionShape {
  type: CollisionType; position: SectorVector; rotation: SectorQuaternion; size?: SectorVector; hash?: string;
  materials: string[]; preset: string; proxyType: number; uk1: number; uk2: number; uk3: number;
}
export interface CollisionActor { position: SectorVector; orientation: SectorQuaternion; scale: SectorVector; shapes: CollisionShape[]; uk1: number; uk2: string }
export interface CollisionCounts { numActors: number; numShapeInfos: number; numShapePositions: number; numShapeRotations: number; numScales: number; numMaterials: number; numPresets: number; numShapeIndices: number; numMaterialIndices: number }
export interface SectorCollisionData extends SectorAppendix { nodeTypes: string[]; placements: { nodeIndex: number }[]; collisions: { nodeIndex: number; sectorHash: string; actors: CollisionActor[] }[] }
export interface StreamingSector extends SectorCollisionData { placements: SectorPlacement[] }

const finite = (c: Cursor) => { const f = c.f32(); if (!Number.isFinite(f)) throw new NativeMalformedError(`Non-finite sector transform/dimension at byte ${c.pos - 4}.`); return f; };
const vector = (c: Cursor): SectorVector => [finite(c), finite(c), finite(c)];
const quaternion = (c: Cursor): SectorQuaternion => [finite(c), finite(c), finite(c), finite(c)];
function count(c: Cursor, width: number, session: DecodeSession): number {
  const first = c.u8(); let n = first & 63, more = !!(first & 64), factor = 64, extra = 0;
  if (first & 128) throw new NativeMalformedError("Negative sector array count.");
  while (more) { if (++extra > 4) throw new NativeMalformedError("Sector VLQ overflow."); const b = c.u8(); n += (b & 127) * factor; factor *= 128; more = !!(b & 128); }
  if (n > 0x7fffffff || n * width > c.remaining) throw new NativeMalformedError("Sector array does not fit its record.");
  session.nodes(n); return n;
}

/** Cursor starts immediately after the ordinary property terminator; size counts itself. */
export function readSectorAppendix(c: Cursor, buffer: (c: Cursor) => RedBuffer | null, session = new DecodeSession()): SectorAppendix {
  const version = c.i32(), start = c.pos, size = c.i32();
  if (version !== 62) throw new NativeUnsupportedError(`Streaming sector version ${version} is not verified.`);
  if (size < 4 || start + size !== c.end) throw new NativeMalformedError("Sector appendix size disagrees with its export.");
  const nodeData = buffer(c), nodes: number[] = [], nodeRefs: string[] = [], variantIndices: number[] = [];
  // Charge before decoding strings, whose JS allocations can be larger than their on-disk bytes.
  session.bytes(c.remaining * 2, "sector appendix arrays and strings");
  for (let i = count(c, 4, session); i > 0; i--) { const n = c.i32(); if (n <= 0) throw new NativeMalformedError("Null sector node handle."); nodes.push(n - 1); }
  for (let i = count(c, 1, session); i > 0; i--) { const at = c.pos, s = readVarString(c); session.bytes(c.pos - at, "sector node refs"); nodeRefs.push(s); }
  for (let i = count(c, 4, session); i > 0; i--) variantIndices.push(c.i32());
  const persistentNodeIndex = c.i32();
  if (c.remaining) throw new NativeMalformedError("Unknown sector appendix bytes.");
  return { version, nodeData, nodes, nodeRefs, variantIndices, persistentNodeIndex };
}

export function readSectorPlacements(bytes: Uint8Array, nodes: number, session = new DecodeSession()): SectorPlacement[] {
  if (bytes.length % 144) throw new NativeMalformedError("Sector placements are not a multiple of 144 bytes.");
  const n = bytes.length / 144; session.nodes(n * 48); session.bytes(n * 256, "decoded placements");
  const c = new Cursor(bytes), out: SectorPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const position = vector(c), positionW = finite(c); const orientation = quaternion(c), scale = vector(c), pivot = vector(c);
    const bounds = { min: vector(c), max: vector(c) };
    const id = c.u64().toString(), questPrefabRefHash = c.u64().toString(), ukHash1 = c.u64().toString(), cookedPrefabData = c.u64().toString();
    // Vanilla uses +infinity here (WolvenKit 9.0.1 writes "+inf"); it is a streaming-distance sentinel, never a drawing transform.
    const maxStreamingDistance = c.f32();
    if (Number.isNaN(maxStreamingDistance) || maxStreamingDistance === -Infinity) throw new NativeMalformedError("Invalid maximum streaming distance.");
    const ukFloat1 = finite(c), nodeIndex = c.u16();
    if (nodeIndex >= nodes) throw new NativeMalformedError("Placement references a missing sector node.");
    out.push({ position, positionW, orientation, scale, pivot, bounds, id, questPrefabRefHash, ukHash1, cookedPrefabData, maxStreamingDistance, ukFloat1, nodeIndex,
      unknown16: [c.u16(), c.u16(), c.u16()], unknown64: [c.u64().toString(), c.u64().toString()] });
  }
  return out;
}

const TYPES: CollisionType[] = ["Box", "Sphere", "Capsule", "ConvexMesh", "TriangleMesh"];
export function readCollisionActors(bytes: Uint8Array, counts: CollisionCounts, session = new DecodeSession()): CollisionActor[] {
  for (const n of Object.values(counts)) if (!Number.isInteger(n) || n < 0 || n > 65535) throw new NativeMalformedError("Invalid collision table count.");
  const n = counts, expected = n.numActors * 48 + n.numShapeInfos * 32 + n.numShapePositions * 12 + n.numShapeRotations * 16 + n.numScales * 12 + n.numMaterials * 8 + n.numPresets * 8 + n.numShapeIndices * 4 + n.numMaterialIndices;
  if (expected !== bytes.length) throw new NativeMalformedError(`Collision tables require ${expected} bytes, got ${bytes.length}.`);
  session.nodes(n.numActors * 16 + n.numShapeInfos * 32); session.bytes(expected * 3, "decoded collision tables");
  const c = new Cursor(bytes, n.numActors * 48 + n.numShapeInfos * 32);
  const positions = Array.from({ length: n.numShapePositions }, () => vector(c));
  const rotations = Array.from({ length: n.numShapeRotations }, () => quaternion(c));
  const scales = Array.from({ length: n.numScales }, () => vector(c));
  const materials = Array.from({ length: n.numMaterials }, () => c.u64().toString());
  const presets = Array.from({ length: n.numPresets }, () => c.u64().toString());
  c.take(n.numShapeIndices * 4); const materialIndices = c.take(n.numMaterialIndices);
  const pick = <T>(xs: ArrayLike<T>, i: number): T => { if (i < 0 || i >= xs.length) throw new NativeMalformedError("Collision table index out of range."); return xs[i]; };
  c.pos = n.numActors * 48;
  const shapes: CollisionShape[] = [];
  for (let i = 0; i < n.numShapeInfos; i++) {
    const type = TYPES[c.view.getInt16(c.pos + 12, true)];
    if (!type) throw new NativeUnsupportedError("Unknown collision shape type.");
    let size: SectorVector | undefined, hash: string | undefined;
    if (type === "ConvexMesh" || type === "TriangleMesh") { hash = c.u64().toString(); finite(c); } else size = vector(c);
    c.i16(); const uk1 = c.i16(), start = c.i16(), length = c.i16();
    if (start < 0 || length < 0 || start + length > materialIndices.length) throw new NativeMalformedError("Invalid collision material range.");
    session.nodes(length);
    const shapeMaterials = Array.from({ length }, (_, j) => pick(materials, materialIndices[start + j]));
    const pi = c.i16(), ri = c.i16();
    const position: SectorVector = pi === -1 ? [0, 0, 0] : pick(positions, pi);
    const rotation: SectorQuaternion = ri === -1 ? [0, 0, 0, 1] : pick(rotations, ri);
    const preset = pick(presets, c.u8()), proxyType = c.u8(), uk2 = c.u16(), uk3 = c.u32();
    if (size && size.some(x => x < 0)) throw new NativeMalformedError("Negative collision dimension.");
    shapes.push({ type, size, hash, position, rotation, materials: shapeMaterials, preset, proxyType, uk1, uk2, uk3 });
  }
  c.pos = 0; const actors: CollisionActor[] = [];
  for (let i = 0; i < n.numActors; i++) {
    const position: SectorVector = [c.i32() / 131072, c.i32() / 131072, c.i32() / 131072]; c.i32();
    const orientation = quaternion(c), start = c.u16(), length = c.u16(), si = c.i16(), uk1 = c.i16(), uk2 = c.u64().toString();
    if (start + length > shapes.length) throw new NativeMalformedError("Invalid actor shape range.");
    session.nodes(length); session.bytes(length * 8, "actor shape references");
    actors.push({ position, orientation, scale: si === -1 ? [1, 1, 1] : pick(scales, si), shapes: shapes.slice(start, start + length), uk1, uk2 });
  }
  return actors;
}

function openSector(bytes: Uint8Array, decompress: Decompress, session: DecodeSession) {
  if (bytes.length > session.limits.maxResourceBytes) throw new NativeBudgetError("Sector exceeds the resource byte budget.");
  const file = new Cr2wFile(bytes, session), root = file.exports[0];
  if (root?.className !== "worldStreamingSector") throw new NativeUnsupportedError("Not a worldStreamingSector.");
  const decoder = new Cr2wDecoder(file, decompress), c = new Cursor(bytes, root.dataOffset, root.dataOffset + root.dataSize);
  if (c.u8() !== 0) throw new NativeMalformedError("Invalid sector property lead.");
  while (c.u16() !== 0) { c.u16(); const size = c.u32(); if (size < 4) throw new NativeMalformedError("Invalid sector property size."); c.take(size - 4); }
  const appendix = readSectorAppendix(c, c2 => decoder.buffer(c2, false, "worldStreamingSector.nodeData"), session);
  return { file, decoder, appendix };
}
function validateVariants(appendix: SectorAppendix, placements: number) {
  let previous = -1;
  for (const index of appendix.variantIndices) { if (index < previous || index < 0 || index > placements) throw new NativeMalformedError("Invalid sector variant range."); previous = index; }
}
const COUNT_FIELDS = ["numActors", "numShapeInfos", "numShapePositions", "numShapeRotations", "numScales", "numMaterials", "numPresets", "numShapeIndices", "numMaterialIndices"] as const;
/** The collision-only caller skips unrelated filter/debug properties, retaining strict record windows and stored types for what it reads. */
function collisionFields(file: Cr2wFile, decoder: Cr2wDecoder, index: number): Record<string, unknown> {
  const entry = file.exports[index], c = new Cursor(file.bytes, entry.dataOffset, entry.dataOffset + entry.dataSize), fields: Record<string, unknown> = {};
  if (c.u8() !== 0) throw new NativeMalformedError("Invalid collision property lead.");
  for (;;) {
    const ni = c.u16(); if (!ni) break;
    const name = file.name(ni), type = file.name(c.u16()), size = c.u32();
    if (size < 4 || size - 4 > c.remaining) throw new NativeMalformedError("Invalid collision property window.");
    const value = c.span(c.pos, c.pos + size - 4); c.take(size - 4);
    if (COUNT_FIELDS.includes(name as typeof COUNT_FIELDS[number])) {
      if (type !== "Uint16") throw new NativeUnsupportedError(`Unverified collision count type ${type}.`);
      fields[name] = value.u16();
    } else if (name === "sectorHash") {
      if (type !== "Uint64") throw new NativeUnsupportedError(`Unverified collision sector-hash type ${type}.`);
      fields.sectorHash = value.u64().toString();
    } else if (name === "compiledData") {
      if (type !== "DataBuffer") throw new NativeUnsupportedError(`Unverified collision buffer type ${type}.`);
      fields.compiledData = decoder.buffer(value, false, "worldCollisionNode.compiledData");
    } else continue;
    if (value.remaining) throw new NativeMalformedError("Collision property has unread bytes.");
  }
  if (c.remaining) throw new NativeUnsupportedError("Unknown collision-node trailing data.");
  return fields;
}
function collisions(file: Cr2wFile, decoder: Cr2wDecoder, appendix: SectorAppendix, session: DecodeSession, geometryOnly: boolean) {
  const collisions: StreamingSector["collisions"] = [], nodeTypes: string[] = [];
  for (const [nodeIndex, index] of appendix.nodes.entries()) {
    const entry = file.exports[index]; if (!entry) throw new NativeMalformedError("Sector references a missing node export.");
    nodeTypes.push(entry.className);
    if (entry.className !== "worldCollisionNode") continue;
    const fields = geometryOnly ? collisionFields(file, decoder, index) : decoder.exportObject(index).fields, counts = {} as CollisionCounts;
    for (const key of COUNT_FIELDS) counts[key] = Number(fields[key] ?? 0);
    const buffer = fields.compiledData;
    if (!(buffer instanceof RedBuffer)) { if (counts.numActors || counts.numShapeInfos) throw new NativeMalformedError("Missing collision buffer."); continue; }
    collisions.push({ nodeIndex, sectorHash: String(fields.sectorHash ?? "0"), actors: readCollisionActors(buffer.bytes(), counts, session) });
  }
  return { nodeTypes, collisions };
}

/** Ordinary node properties use the established decoder; only the sector appendix has a separate entry point. */
export function readStreamingSector(bytes: Uint8Array, decompress: Decompress, session = new DecodeSession()): StreamingSector {
  const { file, decoder, appendix } = openSector(bytes, decompress, session);
  const placements = readSectorPlacements(appendix.nodeData?.bytes() ?? new Uint8Array(), appendix.nodes.length, session);
  validateVariants(appendix, placements.length);
  return { ...appendix, placements, ...collisions(file, decoder, appendix, session, false) };
}

/** W0's bulk path: actors already carry world poses, so only placement node indexes are needed to select default variants.
 * The full entry point above remains the oracle. Both paths decode identical collision records and refuse unknown layouts.
 */
export function readStreamingSectorCollisions(bytes: Uint8Array, decompress: Decompress, session = new DecodeSession()): SectorCollisionData {
  const { file, decoder, appendix } = openSector(bytes, decompress, session), data = appendix.nodeData?.bytes() ?? new Uint8Array();
  if (data.length % 144) throw new NativeMalformedError("Sector placements are not a multiple of 144 bytes.");
  const n = data.length / 144; session.nodes(n); session.bytes(n * 24, "placement node indexes");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), placements: { nodeIndex: number }[] = [];
  for (let i = 0; i < n; i++) {
    const nodeIndex = view.getUint16(i * 144 + 120, true);
    if (nodeIndex >= appendix.nodes.length) throw new NativeMalformedError("Placement references a missing sector node.");
    placements.push({ nodeIndex });
  }
  validateVariants(appendix, n);
  return { ...appendix, placements, ...collisions(file, decoder, appendix, session, true) };
}
