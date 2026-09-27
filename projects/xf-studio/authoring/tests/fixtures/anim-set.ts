/**
 * Synthetic animation sets and rigs for the native animation decoder's tests (no game data), written from the format
 * (src/native/anim-set.ts): a clip keyed in a data chunk (a quarter turn to identity on joint 2, positions 1 → 2, constants, float tracks),
 * the same keys inline, a keyless clip, a SIMD clip, and a record the generic reader refuses.
 */
import { Bytes, Cr2wBuilder, prop, v } from "./native-cr2w";

const quantise = (value: number) => Math.round((value + 1) / 2 * 65535);
/** A unit quaternion as the format stores it: xyz / sqrt(2 − d), d = 1 − |w|, and the sign of w. */
function storedRotation([x, y, z, w]: readonly number[]) {
  const d = 1 - Math.abs(w!), scale = 1 / Math.sqrt(2 - d);
  return { xyz: [x! * scale, y! * scale, z! * scale], negative: w! < 0 };
}
const bits = (joint: number, channel: number, negative = false) => joint | channel << 13 | (negative ? 0x8000 : 0);
const time = (seconds: number, duration: number) => Math.round(seconds / duration * 65535);

/** A key block: compressed keys, raw keys, constant keys, track keys and constant track keys, in the format's order. */
function keyBlock(duration: number) {
  const w = new Bytes();
  // Compressed: joint 2 rotation at t = 0 and t = duration (a quarter turn about Z, then identity).
  const q0 = [0, 0, Math.SQRT1_2, Math.SQRT1_2], q1 = [0, 0, 0, 1];
  for (const [t, q] of [[0, q0], [duration, q1]] as const) {
    const s = storedRotation(q);
    w.u16(time(t, duration)).u16(bits(2, 1, s.negative));
    for (const c of s.xyz) w.u16(quantise(c));
  }
  // Raw: joint 2 position at both ends.
  for (const [t, p] of [[0, [0, 0, 1]], [duration, [0, 0, 2]]] as const) { w.u16(time(t, duration)).u16(bits(2, 0)); for (const c of p) w.f32(c); }
  // Constant: joint 1 position, joint 1 rotation with a negative w (the sign bit), joint 2 position (animated keys win over it).
  w.u16(bits(1, 0)).u16(0).f32(0.5).f32(-0.25).f32(3);
  const neg = storedRotation([0, 0, 0.6, -0.8]);
  w.u16(bits(1, 1, neg.negative)).u16(0); for (const c of neg.xyz) w.f32(c);
  w.u16(bits(2, 0)).u16(0).f32(9).f32(9).f32(9);
  // Track keys: track 0 goes 0 → 1; constant track 1 = 0.5.
  w.u16(time(0, duration)).u16(0).f32(0);
  w.u16(time(duration, duration)).u16(0).f32(1);
  w.u16(1).u16(0).f32(0.5);
  return { bytes: w.done(), counts: { compressed: 2, raw: 2, const: 3, track: 2, constTrack: 1 } };
}

/**
 * A SIMD key block (three frames over one second, two joints, rotations quantised to `bits`, or float32 when 0), written from the layout in
 * anim-set.ts: joint 0 holds identity and a copied translation (0, 0, 5); joint 1 turns from a quarter turn about Z to identity and moves
 * along X (0, 0.5, 1) through an evaluated lane (the other three lanes are padding, −1); scales constant; track 0 goes 0 → 1, track 1 holds 0.25.
 */
export const SIMD_FRAMES = 3;
export function simdBlock(bits: number) {
  const frames = SIMD_FRAMES, j4 = 4, w = new Bytes();
  const turn = (f: number) => { const angle = Math.PI / 4 * (1 - f / (frames - 1)); return [0, 0, Math.sin(angle), Math.cos(angle)]; };
  const rotations = (f: number) => [[0, 0, 0, 1], turn(f), [0, 0, 0, 1], [0, 0, 0, 1]];
  if (bits > 0) {
    const values: number[] = [];
    for (let f = 0; f < frames; f++) {
      const stored = rotations(f).map(q => storedRotation(q).xyz);
      for (let axis = 0; axis < 3; axis++) for (let lane = 0; lane < j4; lane++) values.push(stored[lane]![axis]!);
    }
    while (values.length % 4) values.push(0);
    const mask = 2 ** bits - 1, packed = new Uint8Array(Math.ceil(values.length * bits / 8 / 16) * 16);
    values.forEach((value, i) => {
      const code = Math.round((value + 1) / 2 * mask);
      for (let b = 0; b < bits; b++) if (code & (1 << b)) { const at = i * bits + b; packed[at >> 3] |= 1 << (at & 7); }
    });
    w.bytes(packed);
  } else {
    for (let f = 0; f < frames; f++) { const all = rotations(f); for (let axis = 0; axis < 4; axis++) for (let lane = 0; lane < j4; lane++) w.f32(all[lane]![axis]!); }
  }
  // Evaluated translations: one group of four lanes per frame, joint 1 in lane 0.
  for (let f = 0; f < frames; f++) for (let axis = 0; axis < 3; axis++) for (let lane = 0; lane < 4; lane++) w.f32(lane === 0 && axis === 0 ? f / (frames - 1) : 0);
  w.f32(1).f32(1).f32(1).f32(0);
  for (let f = 0; f < frames; f++) w.f32(f / (frames - 1)).f32(0.25).f32(0).f32(0);
  w.f32(0).f32(0).f32(5);
  w.i16(0);
  w.i16(1).i16(-1).i16(-1).i16(-1);
  return w.done();
}

/** A set (depot rig path `rigPath`) with a clip keyed in a data chunk, a second clip keyed inline, a keyless clip, a SIMD clip and a record the generic reader refuses. */
export function animSet(options: { chunkIndex?: number; counts?: Partial<ReturnType<typeof keyBlock>["counts"]>; channel3?: boolean; names?: readonly string[];
  rigPath?: string; simdBits?: number; simdBlock?: Uint8Array; simdFrames?: number; simdJoints?: number } = {}) {
  const duration = 1;
  const block = keyBlock(duration);
  const counts = { ...block.counts, ...options.counts };
  let bytes = block.bytes;
  if (options.channel3) { bytes = bytes.slice(); bytes[3] = bytes[3]! | 0x60; }
  const f = new Cr2wBuilder();
  const rig = f.import(options.rigPath ?? "base\\characters\\base_entities\\woman_base\\woman_base.rig");
  const chunk = f.buffer(Uint8Array.from([0xee, 0xee, 0xee, 0xee, ...bytes]));
  const numbers = (c: typeof counts, frames: number) => [prop("duration", "Float", v.f32(duration)), prop("numFrames", "Uint32", v.u32(frames)),
    prop("numJoints", "Uint16", v.u16(3)), prop("numTracks", "Uint16", v.u16(2)), prop("numAnimKeys", "Uint32", v.u32(c.compressed)),
    prop("numAnimKeysRaw", "Uint32", v.u32(c.raw)), prop("numConstAnimKeys", "Uint32", v.u32(c.const)), prop("numTrackKeys", "Uint32", v.u32(c.track)),
    prop("numConstTrackKeys", "Uint32", v.u32(c.constTrack))];
  const bufferA = f.export("animAnimationBufferCompressed", [...numbers(counts, 31), prop("dataAddress", "animAnimDataAddress", v.struct([
    prop("unkIndex", "Uint32", v.u32(options.chunkIndex ?? 0)), prop("fsetInBytes", "Uint32", v.u32(4)), prop("zeInBytes", "Uint32", v.u32(bytes.length))]))]);
  const bufferB = f.export("animAnimationBufferCompressed", [...numbers(block.counts, 2),
    prop("inplaceCompressedBuffer", "DataBuffer", w => { w.u32(block.bytes.length).bytes(block.bytes); })]);
  const bufferC = f.export("animAnimationBufferCompressed", [prop("duration", "Float", v.f32(0.5)), prop("numFrames", "Uint32", v.u32(2))]);
  const simdBits = options.simdBits ?? 16, simdBytes = options.simdBlock ?? simdBlock(simdBits);
  const bufferD = f.export("animAnimationBufferSimd", [prop("duration", "Float", v.f32(duration)), prop("numFrames", "Uint32", v.u32(options.simdFrames ?? SIMD_FRAMES)),
    prop("numJoints", "Uint16", v.u16(options.simdJoints ?? 2)), prop("numTracks", "Uint16", v.u16(2)), prop("numTranslationsToCopy", "Uint16", v.u16(1)),
    prop("numTranslationsToEvalAlignedToSimd", "Uint16", v.u16(4)), prop("quantizationBits", "Uint16", v.u16(simdBits)),
    prop("isScaleConstant", "Bool", v.bool(true)), prop("inplaceCompressedBuffer", "DataBuffer", w => { w.u32(simdBytes.length).bytes(simdBytes); })]);
  const animation = (name: string, buffer: number, extra: ReturnType<typeof prop>[] = []) => f.export("animAnimation",
    [prop("name", "CName", v.cname(name)), prop("duration", "Float", v.f32(duration)), prop("animBuffer", "handle:animIAnimationBuffer", v.handle(buffer)), ...extra]);
  // Curve data the generic reader refuses: skipped, since the decoder reads only the records it needs.
  const curve = prop("additionalTracks", "curveData:Float", w => { w.u32(7).u32(1).u32(2); });
  const [moving, inline, keyless, simd] = options.names ?? ["moving", "inline", "keyless", "simd"];
  const clips = [animation(moving!, bufferA, [curve, prop("animationType", "animAnimationType", v.enum("AdditiveFromRefPose"))]), animation(inline!, bufferB),
    animation(keyless!, bufferC, [prop("motionExtraction", "handle:animIMotionExtraction", v.handle(bufferC))]), animation(simd!, bufferD)];
  const entries = clips.map(clip => f.export("animAnimSetEntry", [prop("animation", "handle:animAnimation", v.handle(clip))]));
  const root = { className: "animAnimSet", props: [prop("animations", "array:handle:animAnimSetEntry", v.array(entries.map(e => v.handle(e)))),
    prop("animationDataChunks", "array:animAnimDataChunk", v.array([v.struct([prop("buffer", "serializationDeferredDataBuffer", w => { w.u16(chunk + 1); })])])),
    prop("rig", "rRef:animRig", v.ref(rig))], appendix: undefined };
  // The set is export 0.
  f.exports.unshift(root);
  // Shift handles: every export index moved by one, so rebuild with the root first.
  return rebuildWithRootFirst(f);
}
/** `Cr2wBuilder` numbers exports as added; the tests add the root last, so handles are renumbered here. */
function rebuildWithRootFirst(f: Cr2wBuilder): Uint8Array {
  const g = new Cr2wBuilder();
  g.names.splice(0, g.names.length, ...f.names);
  g.imports.push(...f.imports);
  g.buffers.push(...f.buffers);
  const shift = (write: ReturnType<typeof prop>["write"], type: string) => (w: Bytes, file: Cr2wBuilder) => {
    const inner = new Bytes();
    write(inner, file);
    const data = inner.done();
    if (/^handle:/.test(type)) { const view = new DataView(data.buffer); const value = view.getInt32(0, true); w.i32(value > 0 ? value + 1 : 0); return; }
    if (/^array:handle:/.test(type)) {
      const view = new DataView(data.buffer); const n = view.getUint32(0, true); w.u32(n);
      for (let i = 0; i < n; i++) { const value = view.getInt32(4 + i * 4, true); w.i32(value > 0 ? value + 1 : 0); }
      return;
    }
    w.bytes(data);
  };
  for (const entry of f.exports) g.exports.push({ className: entry.className, props: entry.props.map(p => prop(p.name, p.type, shift(p.write, p.type))), appendix: entry.appendix });
  // The root's handles already name the final indexes minus one (they were taken before the unshift), so they shift like the rest.
  return g.build();
}

export function rig(names: readonly string[] = ["Root", "Trajectory", "Hips"], options: { aPose?: boolean; parents?: readonly number[] } = {}) {
  const f = new Cr2wBuilder();
  const bones = [...names], parents = options.parents ?? bones.map((_, i) => i === 0 ? -1 : 0);
  // The A pose: each bone raised by 10 cm more than its reference, turned a quarter about Z (the scale left out: its default, 1).
  const aPose = options.aPose ? [prop("aPoseLS", "array:QsTransform", v.array(bones.map((_, i) => v.struct([
    prop("Translation", "Vector4", v.struct([prop("Z", "Float", v.f32(i + 0.1))])),
    prop("Rotation", "Quaternion", v.struct([prop("k", "Float", v.f32(Math.SQRT1_2)), prop("r", "Float", v.f32(Math.SQRT1_2))]))]))))] : [];
  f.export("animRig", [prop("boneNames", "array:CName", v.array(bones.map(b => v.cname(b)))), prop("trackNames", "array:CName", v.array(["a", "b"].map(t => v.cname(t)))),
    prop("referenceTracks", "array:Float", v.array([v.f32(1), v.f32(0)])), ...aPose], w => {
    for (const p of parents) w.i16(p);
    bones.forEach((_, i) => { w.f32(0).f32(0).f32(i).f32(0); w.f32(0).f32(0).f32(0).f32(1); w.f32(1).f32(1).f32(1).f32(0); });
  });
  return f.build();
}

