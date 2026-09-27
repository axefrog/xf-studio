/**
 * Animation sets (`.anims`, `animAnimSet`) and rigs (`.rig`, `animRig`): the clip index, the game's compressed key format, and sampling
 * a clip on its rig. Pure apart from the injected decompressor. Written from the format itself (knowledge/poses.md §3 and
 * knowledge/archive-format.md §11); WolvenKit (GPL-3.0) is only documentation and the parity oracle (`tools/anim-oracle.ts`).
 *
 * Only the properties a pose needs are read, record by record, so a set whose other classes hold values the generic reader refuses (curve
 * data in some clips' extra tracks) still lists and decodes; every record's size bounds its value, and every count the key block declares is
 * checked against its bytes before anything is allocated.
 *
 * Layout [resource: the photo-mode sets of game 2.31; source: the key layout in WolvenKit `animAnimationBufferCompressed.cs` and RED4ext.SDK
 * `animKeyFrames.hpp`, read as documentation]:
 * - `animAnimSet.animations` → `animAnimSetEntry.animation` → `animAnimation {name, duration, animationType, animBuffer, motionExtraction}`;
 *   `animationDataChunks[i].buffer` are the set's key blocks.
 * - `animAnimationBufferCompressed` counts its keys (`numAnimKeys`, `numAnimKeysRaw`, `numConstAnimKeys`, `numTrackKeys`,
 *   `numConstTrackKeys`) and finds them in `inplaceCompressedBuffer` (inline, possibly a `KARK` Oodle stream), `defferedBuffer`, or the
 *   set's chunk `dataAddress.unkIndex` at `fsetInBytes`, `zeInBytes` long. Omitted address fields are 0xFFFFFFFF (none).
 * - The block, little-endian: animated keys of 10 bytes (u16 time normalised to the clip's duration, u16 bits: joint 0-12, channel 13-14
 *   (position, rotation, scale), rotation w sign 15; three u16 quantised to [-1, 1]); raw keys of 16 bytes (the same 4-byte head, three
 *   float32); constant keys of 16 bytes (the u16 bits first, then the u16 time, three float32); float-track keys of 8 bytes (u16 time,
 *   u16 track, float32); constant track keys of 8 bytes (u16 track, u16 time, float32).
 * - A rotation stores (x, y, z) = q.xyz / sqrt(2 − d) with d = 1 − |w|: it is rebuilt as xyz·sqrt(2 − d), w = 1 − d with d = x² + y² + z²
 *   (a unit quaternion by construction), negated when the sign bit is set.
 * - `animRig`: `boneNames`, `trackNames`, `referenceTracks`, then after its properties one i16 parent index per bone and one reference
 *   transform per bone (translation xyzw, rotation xyzw, scale xyzw: twelve float32).
 */
import { Cr2wError, Cr2wFile } from "./cr2w-file";
import { decodeSegment, type Decompress, KARK_HEADER_SIZE, KARK_MAGIC } from "./kark";
import { DecodeSession } from "./limits";
import { NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { Cursor } from "./red-values";

/** Version of the decoder's output; part of the clip cache identity. */
export const ANIM_DECODER_VERSION = 3;

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];
export interface RigTransform { readonly translation: Vec3; readonly rotation: Quat; readonly scale: Vec3 }
export interface AnimRig {
  readonly bones: readonly string[];
  /** Parent bone index per bone (−1 for a root). */
  readonly parents: readonly number[];
  /** Local reference transform per bone. */
  readonly reference: readonly RigTransform[];
  /**
   * The rig's A pose, local to each parent (`aPoseLS`), when it holds one per bone: the pose the body meshes are bound in and the rest
   * WolvenKit's clip export gives the skeleton's nodes [resource: `woman_base.rig`; offline: the idle export's nodes].
   */
  readonly aPose?: readonly RigTransform[];
  readonly tracks: readonly string[];
  readonly referenceTracks: readonly number[];
}
export interface AnimClipInfo {
  readonly name: string;
  /** Seconds (the buffer's own duration). */
  readonly duration: number;
  readonly frames: number;
  readonly joints: number;
  readonly tracks: number;
  /** `compressed` (decoded here), `simd` or another buffer class (not decoded), or null when the clip has no buffer. */
  readonly buffer: "compressed" | "simd" | string | null;
  readonly animationType: string;
  readonly motionExtraction: boolean;
  /**
   * Keys that change over the clip (compressed and raw), as the buffer counts them: 0 for a clip whose every channel is constant. A SIMD
   * clip counts every frame of every joint (frames × joints; 0 for a single frame).
   */
  readonly animatedKeys: number;
}
export interface AnimSetIndex {
  /** The set's rig path, lower-case with backslashes (null when it names none). */
  readonly rig: string | null;
  readonly clips: readonly AnimClipInfo[];
}
export type KeyChannel = "position" | "rotation" | "scale";
export interface JointKey {
  readonly joint: number;
  readonly channel: KeyChannel;
  readonly time: number;
  readonly value: readonly number[];
  /** How the file stores it: quantised to 16 bits (`compressed`), float32 (`raw`, `const`), or a SIMD clip's frame (`simd`). */
  readonly stored: "compressed" | "raw" | "const" | "simd";
}
export interface TrackKey { readonly track: number; readonly time: number; readonly value: number }
export interface AnimClip extends AnimClipInfo {
  /** Animated keys (the compressed and raw lists, in file order). */
  readonly keys: readonly JointKey[];
  /** One value per joint channel that doesn't change. */
  readonly constKeys: readonly JointKey[];
  readonly trackKeys: readonly TrackKey[];
  readonly constTrackKeys: readonly TrackKey[];
  readonly counts: { readonly compressed: number; readonly raw: number; readonly const: number; readonly track: number; readonly constTrack: number };
}

/** Most keys one clip may declare, and most clips a set may list (the largest vanilla sets are far below either). */
const MAX_KEYS = 4_000_000, MAX_CLIPS = 100_000;
const CHANNELS: readonly KeyChannel[] = ["position", "rotation", "scale"];
const NONE = 0xffffffff;

interface Field { readonly type: string; readonly cursor: Cursor }

/** Selective reading of one CR2W file's exports: each export's property records by name, decoded only when asked. */
class Records {
  readonly file: Cr2wFile;
  private readonly cache = new Map<number, { className: string; fields: Map<string, Field>; tail: Cursor }>();
  constructor(bytes: Uint8Array, session: DecodeSession) { this.file = new Cr2wFile(bytes, session); }

  /** The export's class and records (index is 0-based). */
  export(index: number) {
    let known = this.cache.get(index);
    if (known) return known;
    const entry = this.file.exports[index];
    if (!entry) throw new Cr2wError(`CR2W export ${index} does not exist.`);
    const cursor = new Cursor(this.file.bytes, entry.dataOffset, entry.dataOffset + entry.dataSize, this.file.view);
    const fields = this.body(cursor, entry.className);
    known = { className: entry.className, fields, tail: cursor.span(cursor.pos, cursor.end) };
    this.cache.set(index, known);
    return known;
  }
  /** A property list: 0x00, records (u16 name, u16 type, u32 size counting itself, value), u16 0. */
  body(cursor: Cursor, owner: string): Map<string, Field> {
    const lead = cursor.u8();
    if (lead !== 0) throw new Cr2wError(`${owner}: property list starts with ${lead}, not 0.`);
    const fields = new Map<string, Field>();
    for (;;) {
      const nameIndex = cursor.u16();
      if (nameIndex === 0) return fields;
      const type = this.file.name(cursor.u16());
      const start = cursor.pos, size = cursor.u32();
      if (size < 4 || start + size > cursor.end) throw new Cr2wError(`${owner}.${this.file.name(nameIndex)}: record size ${size} is out of range.`);
      fields.set(this.file.name(nameIndex), { type, cursor: cursor.span(cursor.pos, start + size) });
      cursor.pos = start + size;
    }
  }
  private field(fields: Map<string, Field>, name: string, types: readonly string[]): Cursor | null {
    const field = fields.get(name);
    if (!field) return null;
    if (!types.includes(field.type)) throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not ${types.join(" or ")}.`);
    return field.cursor.span(field.cursor.pos, field.cursor.end);
  }
  uint(fields: Map<string, Field>, name: string, fallback = 0): number {
    const field = fields.get(name);
    if (!field) return fallback;
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    switch (field.type) {
      case "Uint8": return c.u8();
      case "Uint16": return c.u16();
      case "Uint32": return c.u32();
      case "Int8": return c.i8();
      case "Int16": return c.i16();
      case "Int32": return c.i32();
      case "Bool": return c.u8() ? 1 : 0;
      default: throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not an integer.`);
    }
  }
  float(fields: Map<string, Field>, name: string, fallback = 0): number {
    const c = this.field(fields, name, ["Float"]);
    return c ? c.f32() : fallback;
  }
  cname(fields: Map<string, Field>, name: string, fallback = ""): string {
    const field = fields.get(name);
    if (!field) return fallback;
    if (field.type !== "CName" && !/^[A-Za-z]/.test(field.type)) throw new NativeUnsupportedError(`${name} is stored as ${field.type}.`);
    return this.file.name(field.cursor.span(field.cursor.pos, field.cursor.end).u16());
  }
  /** A handle's export index (0-based), or −1 for null. */
  handle(fields: Map<string, Field>, name: string): number {
    const c = fields.get(name);
    if (!c) return -1;
    if (!/^w?handle:/.test(c.type)) throw new NativeUnsupportedError(`${name} is stored as ${c.type}, not a handle.`);
    return c.cursor.span(c.cursor.pos, c.cursor.end).i32() - 1;
  }
  handles(fields: Map<string, Field>, name: string): number[] {
    const field = fields.get(name);
    if (!field) return [];
    if (!/^array:w?handle:/.test(field.type)) throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a handle list.`);
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    const count = c.u32();
    if (count * 4 > c.remaining || count > MAX_CLIPS) throw new NativeMalformedError(`${name}: ${count} handles cannot fit.`);
    return Array.from({ length: count }, () => c.i32() - 1);
  }
  names(fields: Map<string, Field>, name: string): string[] {
    const field = fields.get(name);
    if (!field) return [];
    if (field.type !== "array:CName") throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a name list.`);
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    const count = c.u32();
    if (count * 2 > c.remaining) throw new NativeMalformedError(`${name}: ${count} names cannot fit.`);
    return Array.from({ length: count }, () => this.file.name(c.u16()));
  }
  floats(fields: Map<string, Field>, name: string): number[] {
    const field = fields.get(name);
    if (!field) return [];
    if (field.type !== "array:Float") throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a float list.`);
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    const count = c.u32();
    if (count * 4 > c.remaining) throw new NativeMalformedError(`${name}: ${count} floats cannot fit.`);
    return Array.from({ length: count }, () => c.f32());
  }
  /** An `rRef`/`raRef` path, lower-case with backslashes, or null. */
  reference(fields: Map<string, Field>, name: string): string | null {
    const field = fields.get(name);
    if (!field) return null;
    if (!/^ra?Ref:/.test(field.type)) throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a reference.`);
    const index = field.cursor.span(field.cursor.pos, field.cursor.end).u16();
    if (index === 0) return null;
    const entry = this.file.imports[index - 1];
    if (!entry) throw new Cr2wError(`CR2W import ${index - 1} does not exist.`);
    return entry.path.replace(/^['"/\\ ]+|['"/\\ ]+$/g, "").toLowerCase().replace(/[/\\]+/g, "\\") || null;
  }
  /**
   * An `array:QsTransform` (each a struct of `Translation` and `Scale` Vector4s, `X`…`W`, and a `Rotation` Quaternion, `i` `j` `k` `r`; a
   * left-out component is its default, 0, or 1 for the rotation's `r` and the scale), or none when absent.
   */
  transforms(fields: Map<string, Field>, name: string): RigTransform[] {
    const field = fields.get(name);
    if (!field) return [];
    if (field.type !== "array:QsTransform") throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a transform list.`);
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    const count = c.u32();
    if (count > c.remaining) throw new NativeMalformedError(`${name}: ${count} transforms cannot fit.`);
    const out: RigTransform[] = [];
    for (let i = 0; i < count; i++) {
      const transform = this.body(c, name);
      const read = (key: string, names: readonly string[], fallbacks: readonly number[]) => {
        const inner = this.struct(transform, key);
        return names.map((component, k) => inner ? this.float(inner, component, fallbacks[k]) : fallbacks[k]!);
      };
      const t = read("Translation", ["X", "Y", "Z"], [0, 0, 0]), r = read("Rotation", ["i", "j", "k", "r"], [0, 0, 0, 1]);
      const s = read("Scale", ["X", "Y", "Z"], [1, 1, 1]);
      out.push({ translation: [t[0]!, t[1]!, t[2]!], rotation: [r[0]!, r[1]!, r[2]!, r[3]!], scale: [s[0]!, s[1]!, s[2]!] });
    }
    return out;
  }
  /** A nested struct value's records. */
  struct(fields: Map<string, Field>, name: string): Map<string, Field> | null {
    const field = fields.get(name);
    return field ? this.body(field.cursor.span(field.cursor.pos, field.cursor.end), name) : null;
  }
  /** The `buffer` of each `animAnimDataChunk` in a list: a buffer-table index (0-based), or −1. */
  chunkBuffers(fields: Map<string, Field>, name: string): number[] {
    const field = fields.get(name);
    if (!field) return [];
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    const count = c.u32();
    if (count > c.remaining) throw new NativeMalformedError(`${name}: ${count} chunks cannot fit.`);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = this.body(c, name);
      const buffer = chunk.get("buffer");
      if (!buffer) { out.push(-1); continue; }
      if (buffer.type !== "serializationDeferredDataBuffer") throw new NativeUnsupportedError(`A data chunk's buffer is stored as ${buffer.type}.`);
      out.push(buffer.cursor.span(buffer.cursor.pos, buffer.cursor.end).u16() - 1);
    }
    return out;
  }
  /** A `DataBuffer` or deferred buffer value's bytes (decompressed as the buffer table says), or null when empty or absent. */
  buffer(fields: Map<string, Field>, name: string, decompress: Decompress): Uint8Array | null {
    const field = fields.get(name);
    if (!field) return null;
    const c = field.cursor.span(field.cursor.pos, field.cursor.end);
    if (field.type === "DataBuffer") {
      const value = c.u32();
      if (value === 0x80000000) return null;
      if (value < 0x80000000) return c.take(value);
      return this.file.bufferBytes((value ^ 0x80000000) - 1, decompress);
    }
    if (field.type === "serializationDeferredDataBuffer" || field.type === "DeferredDataBuffer") {
      const value = c.u16();
      return value === 0 ? null : this.file.bufferBytes(value - 1, decompress);
    }
    throw new NativeUnsupportedError(`${name} is stored as ${field.type}, not a buffer.`);
  }
}

/** Read a rig: bone names, parents, reference pose and track names. */
export function readAnimRig(bytes: Uint8Array, session = new DecodeSession()): AnimRig {
  const records = new Records(bytes, session);
  const root = records.export(0);
  if (root.className !== "animRig") throw new NativeUnsupportedError(`A ${root.className} is not a rig.`);
  const bones = records.names(root.fields, "boneNames");
  const tail = root.tail;
  if (tail.remaining !== bones.length * (2 + 48)) throw new NativeMalformedError(`The rig's bone table holds ${tail.remaining} bytes for ${bones.length} bones.`);
  const parents = bones.map(() => tail.i16());
  const reference = bones.map(() => {
    const t = [tail.f32(), tail.f32(), tail.f32()] as const; tail.f32();
    const r = [tail.f32(), tail.f32(), tail.f32(), tail.f32()] as const;
    const s = [tail.f32(), tail.f32(), tail.f32()] as const; tail.f32();
    return { translation: t, rotation: r, scale: s };
  });
  for (const [i, parent] of parents.entries()) if (parent >= bones.length || parent < -1 || parent === i) throw new NativeMalformedError(`Bone ${i} names parent ${parent}.`);
  const aPose = records.transforms(root.fields, "aPoseLS");
  return { bones, parents, reference, ...(aPose.length === bones.length ? { aPose } : {}), tracks: records.names(root.fields, "trackNames"),
    referenceTracks: records.floats(root.fields, "referenceTracks") };
}

interface ClipEntry { info: AnimClipInfo; buffer: number }

function clipEntries(records: Records): { rig: string | null; entries: ClipEntry[]; chunks: number[] } {
  const root = records.export(0);
  if (root.className !== "animAnimSet") throw new NativeUnsupportedError(`A ${root.className} is not an animation set.`);
  const entries: ClipEntry[] = [];
  for (const entryIndex of records.handles(root.fields, "animations")) {
    if (entryIndex < 0) continue;
    const entry = records.export(entryIndex);
    const animationIndex = records.handle(entry.fields, "animation");
    if (animationIndex < 0) continue;
    const animation = records.export(animationIndex);
    const bufferIndex = records.handle(animation.fields, "animBuffer");
    const bufferExport = bufferIndex >= 0 ? records.export(bufferIndex) : null;
    const kind = !bufferExport ? null : bufferExport.className === "animAnimationBufferCompressed" ? "compressed"
      : bufferExport.className === "animAnimationBufferSimd" ? "simd" : bufferExport.className;
    const b = bufferExport?.fields;
    entries.push({ buffer: bufferIndex, info: {
      name: records.cname(animation.fields, "name"),
      duration: b ? records.float(b, "duration", records.float(animation.fields, "duration")) : records.float(animation.fields, "duration"),
      frames: b ? records.uint(b, "numFrames") : 0,
      joints: b ? records.uint(b, "numJoints") : 0,
      tracks: b ? records.uint(b, "numTracks") : 0,
      buffer: kind,
      animationType: records.cname(animation.fields, "animationType", "Normal"),
      motionExtraction: records.handle(animation.fields, "motionExtraction") >= 0,
      // A SIMD clip stores every frame of every joint; whether any of them changes is known only once decoded.
      animatedKeys: !b ? 0 : kind === "simd" ? (records.uint(b, "numFrames") > 1 ? records.uint(b, "numFrames") * records.uint(b, "numJoints") : 0)
        : records.uint(b, "numAnimKeys") + records.uint(b, "numAnimKeysRaw"),
    } });
  }
  return { rig: records.reference(root.fields, "rig"), entries, chunks: records.chunkBuffers(root.fields, "animationDataChunks") };
}

/** The set's rig and clip list (names, lengths, buffer kinds): what listing needs, without reading any key block. */
export function readAnimSetIndex(bytes: Uint8Array, session = new DecodeSession()): AnimSetIndex {
  const { rig, entries } = clipEntries(new Records(bytes, session));
  return { rig, clips: entries.map(entry => entry.info) };
}

const dequantise = (value: number) => (value / 65535) * 2 - 1;
function rotation(x: number, y: number, z: number, negative: boolean): Quat {
  const d = x * x + y * y + z * z, scale = Math.sqrt(Math.max(0, 2 - d)), w = 1 - d;
  return [x * scale, y * scale, z * scale, negative ? -w : w];
}

/**
 * The clip's key block: inline (possibly a `KARK` Oodle stream), deferred, or in the set's data chunk at `dataAddress`. `need` is the byte
 * count the header declares; a clip that declares none may have no block at all.
 */
function keyBlock(records: Records, b: Map<string, Field>, name: string, chunks: readonly number[], decompress: Decompress, session: DecodeSession,
  need: number): Uint8Array {
  let block = records.buffer(b, "inplaceCompressedBuffer", decompress);
  if (block && block.length >= KARK_HEADER_SIZE) {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    if (view.getUint32(0, true) === KARK_MAGIC) block = decodeSegment(block, view.getUint32(4, true), decompress, session.limits.maxBufferBytes);
  }
  block ??= records.buffer(b, "defferedBuffer", decompress);
  if (!block) {
    const address = records.struct(b, "dataAddress");
    const chunk = address ? records.uint(address, "unkIndex", NONE) : NONE, offset = address ? records.uint(address, "fsetInBytes", NONE) : NONE,
      size = address ? records.uint(address, "zeInBytes", NONE) : NONE;
    if (chunk === NONE || offset === NONE || size === NONE) {
      if (need === 0) return new Uint8Array(0);
      throw new NativeMalformedError(`${name} has keys but no key data.`);
    }
    const bufferIndex = chunks[chunk];
    if (bufferIndex === undefined || bufferIndex < 0) throw new NativeMalformedError(`${name} names data chunk ${chunk}, which the set lacks.`);
    const data = records.file.bufferBytes(bufferIndex, decompress);
    if (offset + size > data.length) throw new NativeMalformedError(`${name}'s keys lie outside data chunk ${chunk}.`);
    block = data.subarray(offset, offset + size);
  }
  if (need > block.length) throw new NativeMalformedError(`${name} declares ${need} bytes of keys in a ${block.length}-byte block.`);
  return block;
}

/** Decode the first clip named `name` in a set (null when the set has none). Throws `NativeUnsupportedError` for another buffer class. */
export function decodeAnimClip(bytes: Uint8Array, name: string, decompress: Decompress, session = new DecodeSession()): AnimClip | null {
  const records = new Records(bytes, session);
  const { entries, chunks } = clipEntries(records);
  const entry = entries.find(candidate => candidate.info.name === name);
  if (!entry) return null;
  if (entry.info.buffer === "simd") return decodeSimdClip(records, entry, chunks, decompress, session);
  if (entry.info.buffer !== "compressed") throw new NativeUnsupportedError(`${name}: a ${entry.info.buffer ?? "missing"} animation buffer is not decoded.`);
  const b = records.export(entry.buffer).fields;
  const counts = { compressed: records.uint(b, "numAnimKeys"), raw: records.uint(b, "numAnimKeysRaw"), const: records.uint(b, "numConstAnimKeys"),
    track: records.uint(b, "numTrackKeys"), constTrack: records.uint(b, "numConstTrackKeys") };
  const total = counts.compressed + counts.raw + counts.const + counts.track + counts.constTrack;
  if (total > MAX_KEYS) throw new NativeMalformedError(`${name} declares ${total} keys.`);
  const need = counts.compressed * 10 + counts.raw * 16 + counts.const * 16 + counts.track * 8 + counts.constTrack * 8;
  const block = keyBlock(records, b, name, chunks, decompress, session, need);
  const c = new Cursor(block);
  const duration = entry.info.duration;
  const keys: JointKey[] = [], constKeys: JointKey[] = [], trackKeys: TrackKey[] = [], constTrackKeys: TrackKey[] = [];
  const head = (bits: number) => {
    const channel = CHANNELS[(bits >> 13) & 3];
    if (!channel) throw new NativeMalformedError(`${name} has a key of channel 3.`);
    return { joint: bits & 0x1fff, channel, negative: (bits & 0x8000) !== 0 };
  };
  const value = (channel: KeyChannel, x: number, y: number, z: number, negative: boolean) => channel === "rotation" ? rotation(x, y, z, negative) : [x, y, z] as const;
  for (let i = 0; i < counts.compressed; i++) {
    const time = c.u16() / 65535 * duration, h = head(c.u16());
    keys.push({ joint: h.joint, channel: h.channel, time, value: value(h.channel, dequantise(c.u16()), dequantise(c.u16()), dequantise(c.u16()), h.negative), stored: "compressed" });
  }
  for (let i = 0; i < counts.raw; i++) {
    const time = c.u16() / 65535 * duration, h = head(c.u16());
    keys.push({ joint: h.joint, channel: h.channel, time, value: value(h.channel, c.f32(), c.f32(), c.f32(), h.negative), stored: "raw" });
  }
  for (let i = 0; i < counts.const; i++) {
    const h = head(c.u16()), time = c.u16() / 65535 * duration;
    constKeys.push({ joint: h.joint, channel: h.channel, time, value: value(h.channel, c.f32(), c.f32(), c.f32(), h.negative), stored: "const" });
  }
  for (let i = 0; i < counts.track; i++) { const time = c.u16() / 65535 * duration, track = c.u16(); trackKeys.push({ track, time, value: c.f32() }); }
  for (let i = 0; i < counts.constTrack; i++) { const track = c.u16(), time = c.u16() / 65535 * duration; constTrackKeys.push({ track, time, value: c.f32() }); }
  return { ...entry.info, keys, constKeys, trackKeys, constTrackKeys, counts };
}

const ceil = (value: number, step: number) => Math.ceil(value / step) * step;
/**
 * A SIMD clip (`animAnimationBufferSimd`): every frame of every joint, laid out for four-wide vector evaluation. Written from the layout
 * below [resource: `ui_female.anims` of game 2.31, whose body idles are SIMD; source: the order of the sections in WolvenKit's SIMD reader
 * (`AnimSIMD.cs` at 11720772), read as documentation only]. With F frames, J = numJoints − numExtraJoints joints and J4 that rounded up to a
 * multiple of four, E = numTranslationsToEvalAlignedToSimd, C = numTranslationsToCopy and T = numTracks, the block holds, in order:
 *
 * 1. **Rotations**, per frame, per group of four joints: the four x, the four y, the four z (and, unquantised, the four w). Quantised
 *    (`quantizationBits` q > 0): F·J4·3 values, rounded up to a multiple of four, packed q bits each from the least significant bit, value v
 *    meaning v / (2^q − 1) · 2 − 1, the section padded to 16 bytes; w is rebuilt as the compressed format's (xyz · sqrt(2 − d), w = 1 − d, so
 *    never negative), then normalised. Unquantised: float32.
 * 2. **Evaluated translations**: F·E·3 float32, per frame per group of four: x×4, y×4, z×4.
 * 3. **Scales**: one float32 (x, y, z, padding) for every joint and frame when `isScaleConstant`, else F·J4·3 float32 grouped as rotations.
 * 4. **Float tracks** (T > 0): one float32 for every track and frame when `isTrackConstant`, else per frame T float32 padded to a multiple
 *    of four.
 * 5. **Copied translations**: C × three float32, each one joint's on every frame.
 * 6. **Joint indices**: C int16 for the copied translations, then E int16 for the evaluated ones (−1 marks a padding lane).
 *
 * Frame i is at i · duration / (F − 1). A channel with the same value on every frame becomes a constant key, the others one key per frame
 * (`stored: "simd"`), so the sampler interpolates between frames as between compressed keys. A joint that neither translation list names
 * keeps the rig's reference translation when sampled [hypothesis: the engine starts the evaluation from the reference pose].
 */
function decodeSimdClip(records: Records, entry: ClipEntry, chunks: readonly number[], decompress: Decompress, session: DecodeSession): AnimClip {
  const name = entry.info.name, b = records.export(entry.buffer).fields;
  const frames = records.uint(b, "numFrames"), joints = records.uint(b, "numJoints") - records.uint(b, "numExtraJoints");
  const tracks = records.uint(b, "numTracks"), evaluated = records.uint(b, "numTranslationsToEvalAlignedToSimd"), copied = records.uint(b, "numTranslationsToCopy");
  const q = records.uint(b, "quantizationBits"), scaleConstant = records.uint(b, "isScaleConstant") !== 0, trackConstant = records.uint(b, "isTrackConstant") !== 0;
  if (joints < 0) throw new NativeMalformedError(`${name} has more extra joints than joints.`);
  if (q > 16) throw new NativeMalformedError(`${name} quantises rotations to ${q} bits.`);
  if (evaluated % 4) throw new NativeMalformedError(`${name} evaluates ${evaluated} translations, not a multiple of four.`);
  const j4 = ceil(joints, 4), values = frames * j4 * 3;
  if (frames * (j4 + evaluated + copied + tracks) > MAX_KEYS) throw new NativeMalformedError(`${name} declares ${frames} frames of ${joints} joints.`);
  const rotationBytes = q > 0 ? ceil(ceil(values, 4) * q / 8, 16) : frames * j4 * 16;
  const trackBytes = tracks === 0 ? 0 : trackConstant ? 4 : frames * ceil(tracks, 4) * 4;
  const need = rotationBytes + frames * evaluated * 12 + (scaleConstant ? 16 : values * 4) + trackBytes + copied * 14 + evaluated * 2;
  const block = keyBlock(records, b, name, chunks, decompress, session, need);
  const c = new Cursor(block);
  const duration = entry.info.duration, step = frames > 1 ? duration / (frames - 1) : 0;
  // Every frame's value per joint channel (flat), folded into a constant key at the end when it never changes.
  const series = new Map<string, { joint: number; channel: KeyChannel; width: number; values: Float64Array }>();
  const lane = (joint: number, channel: KeyChannel, width: number) => {
    const id = `${joint}|${channel}`;
    let known = series.get(id);
    if (!known) { known = { joint, channel, width, values: new Float64Array(frames * width) }; series.set(id, known); }
    return known.values;
  };
  // 1. Rotations.
  if (q > 0) {
    const mask = 2 ** q - 1;
    const unpack = (index: number) => {
      const bit = index * q, at = bit >> 3;
      let word = 0;
      for (let k = 0; k < 3 && at + k < rotationBytes; k++) word |= block[at + k]! << (8 * k);
      return ((word >>> (bit & 7)) & mask) / mask * 2 - 1;
    };
    for (let f = 0; f < frames; f++) for (let g = 0; g < j4; g += 4) for (let l = 0; l < 4 && g + l < joints; l++) {
      const base = (f * j4 + g) * 3, r = rotation(unpack(base + l), unpack(base + 4 + l), unpack(base + 8 + l), false), n = Math.hypot(...r) || 1;
      lane(g + l, "rotation", 4).set([r[0] / n, r[1] / n, r[2] / n, r[3] / n], f * 4);
    }
    c.pos = rotationBytes;
  } else {
    for (let f = 0; f < frames; f++) for (let g = 0; g < j4; g += 4) {
      const group = Array.from({ length: 16 }, () => c.f32());
      for (let l = 0; l < 4 && g + l < joints; l++) lane(g + l, "rotation", 4).set([group[l]!, group[4 + l]!, group[8 + l]!, group[12 + l]!], f * 4);
    }
  }
  // 2. Evaluated translations (their joints are named at the end of the block).
  const evaluatedValues = Array.from({ length: frames * evaluated * 3 }, () => c.f32());
  // 3. Scales.
  if (scaleConstant) {
    const s = [c.f32(), c.f32(), c.f32()]; c.f32();
    for (let joint = 0; joint < joints; joint++) { const out = lane(joint, "scale", 3); for (let f = 0; f < frames; f++) out.set(s, f * 3); }
  } else {
    for (let f = 0; f < frames; f++) for (let g = 0; g < j4; g += 4) {
      const group = Array.from({ length: 12 }, () => c.f32());
      for (let l = 0; l < 4 && g + l < joints; l++) lane(g + l, "scale", 3).set([group[l]!, group[4 + l]!, group[8 + l]!], f * 3);
    }
  }
  // 4. Float tracks.
  const trackKeys: TrackKey[] = [], constTrackKeys: TrackKey[] = [];
  if (tracks > 0 && trackConstant) {
    const value = c.f32();
    for (let track = 0; track < tracks; track++) constTrackKeys.push({ track, time: 0, value });
  } else if (tracks > 0) {
    const perTrack = Array.from({ length: tracks }, () => new Float64Array(frames));
    for (let f = 0; f < frames; f++) {
      for (let track = 0; track < tracks; track++) perTrack[track]![f] = c.f32();
      c.pos += (ceil(tracks, 4) - tracks) * 4;
    }
    perTrack.forEach((all, track) => {
      if (all.every(value => value === all[0])) constTrackKeys.push({ track, time: 0, value: all[0] ?? 0 });
      else all.forEach((value, f) => trackKeys.push({ track, time: f * step, value }));
    });
  }
  // 5 and 6. Copied translations, then both joint lists.
  const copiedValues = Array.from({ length: copied * 3 }, () => c.f32());
  const copiedJoints = Array.from({ length: copied }, () => c.i16()), evaluatedJoints = Array.from({ length: evaluated }, () => c.i16());
  copiedJoints.forEach((joint, i) => {
    if (joint < 0 || joint >= joints) return;
    const out = lane(joint, "position", 3), value = copiedValues.slice(i * 3, i * 3 + 3);
    for (let f = 0; f < frames; f++) out.set(value, f * 3);
  });
  for (let f = 0; f < frames; f++) for (let g = 0; g < evaluated; g += 4) for (let l = 0; l < 4; l++) {
    const joint = evaluatedJoints[g + l]!;
    if (joint < 0 || joint >= joints) continue;
    const base = (f * evaluated + g) * 3;
    lane(joint, "position", 3).set([evaluatedValues[base + l]!, evaluatedValues[base + 4 + l]!, evaluatedValues[base + 8 + l]!], f * 3);
  }
  const keys: JointKey[] = [], constKeys: JointKey[] = [];
  const ordered = [...series.values()].sort((x, y) => x.joint - y.joint || CHANNELS.indexOf(x.channel) - CHANNELS.indexOf(y.channel));
  for (const { joint, channel, width, values: all } of ordered) {
    let constant = true;
    for (let i = width; i < all.length && constant; i++) constant = all[i] === all[i % width];
    if (constant) { constKeys.push({ joint, channel, time: 0, value: Array.from(all.subarray(0, width)), stored: "simd" }); continue; }
    for (let f = 0; f < frames; f++) keys.push({ joint, channel, time: f * step, value: Array.from(all.subarray(f * width, f * width + width)), stored: "simd" });
  }
  return { ...entry.info, joints, tracks, keys, constKeys, trackKeys, constTrackKeys,
    counts: { compressed: 0, raw: keys.length, const: constKeys.length, track: trackKeys.length, constTrack: constTrackKeys.length } };
}

export interface SampledJoint { translation?: Vec3; rotation?: Quat; scale?: Vec3 }
export interface ClipSample {
  /** Channels the clip keys, by joint index; a joint or channel it doesn't key keeps the rig's reference. */
  readonly joints: ReadonlyMap<number, SampledJoint>;
  readonly tracks: ReadonlyMap<number, number>;
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let wa = 1 - t, wb = t;
  if (dot < 0.9995) { const angle = Math.acos(dot), sin = Math.sin(angle); wa = Math.sin((1 - t) * angle) / sin; wb = Math.sin(t * angle) / sin; }
  const q = [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
  const n = Math.hypot(...q) || 1;
  return [q[0]! / n, q[1]! / n, q[2]! / n, q[3]! / n];
}

/**
 * The clip at `time` seconds (clamped to its length): each keyed channel interpolated linearly between the keys around `time` (rotations by
 * shortest-path slerp), a constant key otherwise; float tracks likewise. An animated key of a channel wins over a constant key of it.
 */
export function sampleClip(clip: AnimClip, time: number): ClipSample {
  return clipSampler(clip)(time);
}

/** A binary search: the first index whose key time is at or past `t` (the list's length when none is). */
function firstAtOrAfter(list: readonly { time: number }[], t: number): number {
  let low = 0, high = list.length;
  while (low < high) { const mid = (low + high) >> 1; if (list[mid]!.time < t) low = mid + 1; else high = mid; }
  return low;
}

/**
 * `sampleClip` for many times of one clip: the keys are grouped and sorted once (a SIMD idle has tens of thousands of frame keys, and
 * sampling every frame through `sampleClip` would regroup them all each time).
 */
export function clipSampler(clip: AnimClip): (time: number) => ClipSample {
  const groups = new Map<string, JointKey[]>();
  for (const key of clip.keys) { const id = `${key.joint}|${key.channel}`; const list = groups.get(id); if (list) list.push(key); else groups.set(id, [key]); }
  for (const list of groups.values()) list.sort((a, b) => a.time - b.time);
  const constants = clip.constKeys.filter(key => !groups.has(`${key.joint}|${key.channel}`));
  const trackGroups = new Map<number, TrackKey[]>();
  for (const key of clip.trackKeys) { const list = trackGroups.get(key.track); if (list) list.push(key); else trackGroups.set(key.track, [key]); }
  for (const list of trackGroups.values()) list.sort((a, b) => a.time - b.time);
  return time => {
    const t = Math.min(Math.max(time, 0), clip.duration);
    const joints = new Map<number, SampledJoint>();
    const put = (joint: number, channel: KeyChannel, value: readonly number[]) => {
      const entry = joints.get(joint) ?? {};
      if (channel === "rotation") entry.rotation = value as unknown as Quat; else if (channel === "position") entry.translation = value as unknown as Vec3; else entry.scale = value as unknown as Vec3;
      joints.set(joint, entry);
    };
    for (const key of constants) put(key.joint, key.channel, key.value);
    for (const list of groups.values()) {
      const { joint, channel } = list[0]!;
      let next = firstAtOrAfter(list, t);
      if (next >= list.length) next = list.length - 1;
      const after = list[next]!, before = list[Math.max(0, next - 1)]!;
      if (after === before || after.time <= before.time || t <= before.time) { put(joint, channel, t <= before.time ? before.value : after.value); continue; }
      const f = (t - before.time) / (after.time - before.time);
      put(joint, channel, channel === "rotation" ? slerp(before.value as unknown as Quat, after.value as unknown as Quat, f)
        : before.value.map((v, i) => v + (after.value[i]! - v) * f));
    }
    const tracks = new Map<number, number>();
    for (const key of clip.constTrackKeys) tracks.set(key.track, key.value);
    for (const [track, list] of trackGroups) {
      let next = firstAtOrAfter(list, t);
      if (next >= list.length) next = list.length - 1;
      const after = list[next]!, before = list[Math.max(0, next - 1)]!;
      tracks.set(track, after === before || after.time <= before.time || t <= before.time ? (t <= before.time ? before.value : after.value)
        : before.value + (after.value - before.value) * (t - before.time) / (after.time - before.time));
    }
    return { joints, tracks };
  };
}
