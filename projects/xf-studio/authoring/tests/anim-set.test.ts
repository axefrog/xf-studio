// The native animation decoder (src/native/anim-set.ts) over synthetic sets and rigs written from the format (no game data): the clip
// index, the key block in a data chunk and inline, rotation rebuilding, sampling, the rig's bone table, and hostile input.
import { describe, expect, test } from "bun:test";
import { clipSampler, decodeAnimClip, readAnimRig, readAnimSetIndex, sampleClip } from "../src/native/anim-set";
import { NativeMalformedError, NativeUnsupportedError } from "../src/native/native-errors";
import { animSet, rig, SIMD_FRAMES, simdBlock } from "./fixtures/anim-set";

const noDecompress = () => { throw Error("nothing here is compressed"); };
describe("animation sets", () => {
  test("the index lists every clip's name, length, buffer kind and type without reading keys", () => {
    const index = readAnimSetIndex(animSet());
    expect(index.rig).toBe("base\\characters\\base_entities\\woman_base\\woman_base.rig");
    expect(index.clips.map(c => [c.name, c.buffer, c.frames, c.animationType, c.motionExtraction, c.animatedKeys])).toEqual([
      ["moving", "compressed", 31, "AdditiveFromRefPose", false, 4], ["inline", "compressed", 2, "Normal", false, 4],
      ["keyless", "compressed", 2, "Normal", true, 0], ["simd", "simd", SIMD_FRAMES, "Normal", false, SIMD_FRAMES * 2]]);
  });

  test("keys decode from the set's data chunk: rotations rebuilt, raw and constant floats exact, times in seconds", () => {
    const clip = decodeAnimClip(animSet(), "moving", noDecompress)!;
    expect(clip.counts).toEqual({ compressed: 2, raw: 2, const: 3, track: 2, constTrack: 1 });
    const [r0, r1] = clip.keys.filter(k => k.channel === "rotation");
    expect(r0!.stored).toBe("compressed");
    // Quantised to 16 bits: within one step of the written quaternion.
    r0!.value.forEach((c, i) => expect(Math.abs(c - [0, 0, Math.SQRT1_2, Math.SQRT1_2][i]!)).toBeLessThan(5e-5));
    expect(r1!.time).toBeCloseTo(1, 6);
    r1!.value.forEach((c, i) => expect(Math.abs(c - [0, 0, 0, 1][i]!)).toBeLessThan(5e-5));
    expect(clip.keys.filter(k => k.channel === "position").map(k => k.value)).toEqual([[0, 0, 1], [0, 0, 2]]);
    const negative = clip.constKeys.find(k => k.joint === 1 && k.channel === "rotation")!;
    negative.value.forEach((c, i) => expect(c).toBeCloseTo([0, 0, 0.6, -0.8][i]!, 6));
    expect(Math.hypot(...negative.value)).toBeCloseTo(1, 6);
    expect(clip.trackKeys.map(k => [k.track, k.value])).toEqual([[0, 0], [0, 1]]);
    expect(clip.constTrackKeys).toEqual([{ track: 1, time: 0, value: 0.5 }]);
  });

  test("an inline key buffer decodes the same; a keyless clip decodes empty; an absent clip is null", () => {
    expect(decodeAnimClip(animSet(), "inline", noDecompress)!.keys.length).toBe(4);
    expect(decodeAnimClip(animSet(), "keyless", noDecompress)!.keys).toEqual([]);
    expect(decodeAnimClip(animSet(), "absent", noDecompress)).toBeNull();
  });

  for (const bits of [16, 12, 0]) test(`a SIMD clip (${bits ? `rotations in ${bits} bits` : "float rotations"}) decodes every frame; unchanging channels become constants`, () => {
    const clip = decodeAnimClip(animSet({ simdBits: bits }), "simd", noDecompress)!;
    expect(clip.buffer).toBe("simd");
    expect(clip.frames).toBe(SIMD_FRAMES);
    const step = 1 / (SIMD_FRAMES - 1), tolerance = bits === 12 ? 1e-3 : bits ? 5e-5 : 1e-7;
    // Joint 1 turns and moves on every frame; joint 0 holds identity and its copied translation; both scales are the constant.
    const turning = clip.keys.filter(k => k.joint === 1 && k.channel === "rotation");
    expect(turning.map(k => k.time)).toEqual([0, step, 2 * step].map(t => expect.closeTo(t, 6)) as never);
    turning[0]!.value.forEach((c, i) => expect(Math.abs(c - [0, 0, Math.SQRT1_2, Math.SQRT1_2][i]!)).toBeLessThan(tolerance));
    turning[2]!.value.forEach((c, i) => expect(Math.abs(c - [0, 0, 0, 1][i]!)).toBeLessThan(tolerance));
    expect(clip.keys.filter(k => k.joint === 1 && k.channel === "position").map(k => k.value[0])).toEqual([0, 0.5, 1]);
    expect(clip.keys.every(k => k.stored === "simd" && k.joint === 1)).toBe(true);
    expect(clip.constKeys.find(k => k.joint === 0 && k.channel === "position")!.value).toEqual([0, 0, 5]);
    expect(clip.constKeys.filter(k => k.channel === "scale").map(k => k.value)).toEqual([[1, 1, 1], [1, 1, 1]]);
    const still = clip.constKeys.find(k => k.joint === 0 && k.channel === "rotation")!.value;
    still.forEach((c, i) => expect(Math.abs(c - [0, 0, 0, 1][i]!)).toBeLessThan(tolerance));
    expect(clip.trackKeys.map(k => k.value)).toEqual([0, 0.5, 1]);
    expect(clip.constTrackKeys).toEqual([{ track: 1, time: 0, value: 0.25 }]);
    // Sampled halfway between frames 0 and 1: the translation and the turn in between (an eighth turn less a sixteenth).
    const mid = sampleClip(clip, step / 2).joints.get(1)!;
    expect(mid.translation![0]).toBeCloseTo(0.25, 6);
    expect(mid.rotation![2]).toBeCloseTo(Math.sin(Math.PI * 3 / 16), 2);
  });

  test("a SIMD block shorter than its header declares is refused as malformed", () => {
    expect(() => decodeAnimClip(animSet({ simdBlock: simdBlock(16).slice(0, 40) }), "simd", noDecompress)).toThrow(NativeMalformedError);
  });

  test("a prepared sampler gives what sampleClip gives at every time", () => {
    const clip = decodeAnimClip(animSet(), "moving", noDecompress)!, sampler = clipSampler(clip);
    for (const t of [-1, 0, 0.25, 0.5, 0.99, 1, 3]) expect(sampler(t)).toEqual(sampleClip(clip, t));
  });

  test("sampling interpolates between keys (slerp for rotations), holds a constant, and an animated channel wins over a constant one", () => {
    const clip = decodeAnimClip(animSet(), "moving", noDecompress)!;
    const mid = sampleClip(clip, 0.5);
    const hips = mid.joints.get(2)!;
    expect(hips.translation![2]).toBeCloseTo(1.5, 5);
    // Halfway from a quarter turn to identity: an eighth turn about Z.
    expect(hips.rotation![2]).toBeCloseTo(Math.sin(Math.PI / 8), 3);
    expect(hips.rotation![3]).toBeCloseTo(Math.cos(Math.PI / 8), 3);
    expect(mid.joints.get(1)!.translation).toEqual([0.5, -0.25, 3]);
    expect(mid.tracks.get(0)).toBeCloseTo(0.5, 5);
    expect(mid.tracks.get(1)).toBe(0.5);
    // Times outside the clip clamp to its ends.
    expect(sampleClip(clip, -1).joints.get(2)!.translation![2]).toBeCloseTo(1, 6);
    expect(sampleClip(clip, 9).joints.get(2)!.translation![2]).toBeCloseTo(2, 6);
    expect(mid.joints.has(0)).toBe(false);
  });

  test("the rig's bone table follows its properties: parents and reference transforms", () => {
    const read = readAnimRig(rig());
    expect(read.bones).toEqual(["Root", "Trajectory", "Hips"]);
    expect(read.parents).toEqual([-1, 0, 0]);
    expect(read.reference[2]).toEqual({ translation: [0, 0, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    expect(read.tracks).toEqual(["a", "b"]);
    expect(read.referenceTracks).toEqual([1, 0]);
    expect(read.aPose).toBeUndefined();
    // The A pose, when the rig has one per bone; a left-out component is its default.
    const posed = readAnimRig(rig(undefined, { aPose: true })).aPose!;
    expect(posed[2]!.translation[2]).toBeCloseTo(2.1, 6);
    expect(posed[2]!.translation.slice(0, 2)).toEqual([0, 0]);
    posed[2]!.rotation.forEach((c, i) => expect(c).toBeCloseTo([0, 0, Math.SQRT1_2, Math.SQRT1_2][i]!, 6));
    expect(posed[2]!.scale).toEqual([1, 1, 1]);
  });

  test("hostile input is refused as malformed: counts past the block, a missing chunk, channel 3, a short bone table", () => {
    expect(() => decodeAnimClip(animSet({ counts: { compressed: 1000 } }), "moving", noDecompress)).toThrow(NativeMalformedError);
    expect(() => decodeAnimClip(animSet({ chunkIndex: 5 }), "moving", noDecompress)).toThrow(NativeMalformedError);
    expect(() => decodeAnimClip(animSet({ channel3: true }), "moving", noDecompress)).toThrow(NativeMalformedError);
    const short = rig().slice(0, -8);
    expect(() => readAnimRig(short)).toThrow();
    expect(() => readAnimSetIndex(rig())).toThrow(NativeUnsupportedError);
  });
});
