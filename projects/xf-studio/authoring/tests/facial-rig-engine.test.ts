/**
 * The facial-rig engine (research/animation/expression-editor-design.md §3, §9 "Engine"): the vocabulary from a synthetic rig and
 * setup mapping (no game data), the mirror map, vectors, the clip decoder and solved poses in the preview's axes.
 */
import { expect, test } from "bun:test";
import { buildVocabulary, controlGroup, controlLabel, isDirectionPair, mirrorName, pairKey } from "../src/engines/facial-rig/vocabulary";
import { denseTracks, f32, mirrorVector, normaliseVector, sameVector, vectorIssue, withControl } from "../src/engines/facial-rig/vector";
import { animBufferLength, clipControlVector, clipValuesAt, decodeClipTracks, sampleTrack } from "../src/engines/facial-rig/anim-tracks";
import { posedLocals, quatToGltf, rigRestFromRed, vecToGltf } from "../src/engines/facial-rig/pose";

/** A small rig: 3 envelopes, then main poses in the player rig's naming, then 2 override tracks. */
const MAIN = ["eye_l_brows_raise_in", "eye_r_brows_raise_in", "eye_l_dir_in", "eye_r_dir_in", "lips_l_corner_up", "lips_r_corner_up",
  "jaw_mid_open", "jaw_mid_shift_l", "jaw_mid_shift_r", "neck_l_turn", "neck_r_turn", "eye_l_pupil_wide", "tongue_mid_tip_l", "tongue_mid_tip_r",
  "lips_l_corner_up_in_sticky_cutScene", "lips_r_corner_up_in_sticky_cutScene", "mystery_control"];
const TRACKS = ["faceEnvelope", "upperFace", "lowerFace", ...MAIN, "a_AnimOverrideWeight", "b_AnimOverrideWeight"];
const REFERENCE = TRACKS.map((_, index) => index < 3 || index >= 3 + MAIN.length ? 1 : 0);
const vocabulary = () => buildVocabulary({ rig: "rig.rig", setup: "setup.facialsetup", trackNames: TRACKS, referenceTracks: REFERENCE,
  mapping: { numEnvelopes: 3, numMainPoses: MAIN.length } });

test("the mirror map swaps standalone side words and is an involution; centre controls mirror to themselves", () => {
  for (const name of [...MAIN, "head_neck_l_tilt", "lips_mid_shift_r", "face_gravity_l", "lips_apart_up"]) expect(mirrorName(mirrorName(name))).toBe(name);
  expect(mirrorName("eye_l_brows_raise_in")).toBe("eye_r_brows_raise_in");
  expect(mirrorName("jaw_mid_shift_l")).toBe("jaw_mid_shift_r");
  expect(mirrorName("jaw_mid_open")).toBe("jaw_mid_open");
  // "l" inside a word is not a side ("lips", "lateral").
  expect(mirrorName("lips_l_lateral_l")).toBe("lips_r_lateral_r");
  expect(pairKey("eye_l_brows_raise_in")).toBe("eye_brows_raise_in");
  expect(pairKey("jaw_mid_open")).toBeNull();
  expect([isDirectionPair("eye_l_brows_raise_in"), isDirectionPair("jaw_mid_shift_l"), isDirectionPair("neck_l_turn"), isDirectionPair("eye_l_dir_in")])
    .toEqual([false, true, true, true]);
});

test("the vocabulary is the setup's main-pose block, with groups, labels, partners and plain notes", () => {
  const v = vocabulary();
  expect(v.main).toEqual({ start: 3, count: MAIN.length });
  expect(v.controls.map(control => control.name)).toEqual(MAIN);
  const byName = new Map(v.controls.map(control => [control.name, control]));
  expect(byName.get("eye_l_brows_raise_in")).toMatchObject({ group: "brows", label: "Inner brow raise", text: "Inner brow raise, left", side: "left",
    partner: "eye_r_brows_raise_in", pair: "eye_brows_raise_in", direction: false, track: 3 });
  expect(byName.get("jaw_mid_open")).toMatchObject({ group: "jaw", side: null, partner: null, pair: null });
  // A direction pair names its direction in the label and starts unlinked.
  expect(byName.get("jaw_mid_shift_l")).toMatchObject({ text: "Jaw shift left", direction: true });
  expect(byName.get("eye_l_dir_in")).toMatchObject({ group: "gaze", direction: true });
  expect(byName.get("eye_l_pupil_wide")?.note).toContain("pupil");
  // A control whose partner the rig lacks stays alone; unknown names still get a readable label and a group.
  expect(byName.get("eye_l_pupil_wide")).toMatchObject({ partner: null, side: null });
  expect(byName.get("tongue_mid_tip_l")?.group).toBe("advanced");
  expect(byName.get("lips_l_corner_up_in_sticky_cutScene")?.group).toBe("advanced");
  expect(byName.get("mystery_control")).toMatchObject({ group: "other", label: "Mystery control" });
  expect(controlGroup("lips_l_nasolabialDeepener")).toBe("cheeks");
  expect(controlLabel("neck_l_turn")).toBe("Neck turn");
  expect(() => buildVocabulary({ rig: "r", setup: "s", trackNames: TRACKS, referenceTracks: REFERENCE, mapping: { numEnvelopes: 3, numMainPoses: 99 } }))
    .toThrow("doesn't fit");
  expect(() => buildVocabulary({ rig: "r", setup: "s", trackNames: TRACKS, referenceTracks: [1], mapping: { numEnvelopes: 3, numMainPoses: 2 } }))
    .toThrow("reference");
});

test("vectors are sparse, float32, clamped and validated; dense tracks add to the reference and clamp main poses", () => {
  expect(vectorIssue({ jaw_mid_open: 1.2 })).toContain("0 to 1");
  expect(vectorIssue({ "bad name": 0.1 })).toContain("isn't a face control");
  expect(vectorIssue({ jaw_mid_open: Number.NaN })).toBeDefined();
  expect(normaliseVector({ lips_l_corner_up: 0.3, jaw_mid_open: 0 })).toEqual({ lips_l_corner_up: f32(0.3) });
  const set = withControl({ jaw_mid_open: 0.2 }, "lips_l_corner_up", 0.4);
  expect(set).toEqual({ jaw_mid_open: f32(0.2), lips_l_corner_up: f32(0.4) });
  expect(withControl(set, "jaw_mid_open", 0)).toEqual({ lips_l_corner_up: f32(0.4) });
  expect(sameVector(set, { lips_l_corner_up: f32(0.4), jaw_mid_open: f32(0.2) })).toBe(true);
  const v = vocabulary();
  const { tracks, skipped } = denseTracks(v, { jaw_mid_open: 0.5, lips_l_corner_up: 0.9, unknown_thing: 0.3 }, new Map([[9, 0.4], [0, -0.5]]));
  expect(skipped).toEqual(["unknown_thing"]);
  expect(tracks[0]).toBeCloseTo(0.5);           // an envelope takes an additive delta unclamped
  expect(tracks[9]).toBeCloseTo(0.9);           // jaw_mid_open 0.5 + 0.4
  expect(tracks[7]).toBeCloseTo(0.9);           // lips_l_corner_up
  expect(tracks.at(-1)).toBe(1);               // override weights rest at 1
  expect(denseTracks(v, { lips_l_corner_up: 0.9 }, new Map([[7, 0.5]])).tracks[7]).toBe(1);
  const pairs = v.controls.flatMap(control => control.partner && control.side ? [{ name: control.name, partner: control.partner, side: control.side, direction: control.direction }] : []);
  expect(mirrorVector({ lips_l_corner_up: 0.3, jaw_mid_shift_l: 0.5 }, "left", pairs)).toEqual({ jaw_mid_shift_l: f32(0.5), lips_l_corner_up: f32(0.3), lips_r_corner_up: f32(0.3) });
});

/** A synthetic compressed buffer: `joint` constant keys (16 bytes each, content irrelevant), animated then constant track keys. */
function buffer(constJoints: number, keyed: [number, number, number][], constant: [number, number][], duration: number) {
  const bytes = new Uint8Array(constJoints * 16 + (keyed.length + constant.length) * 8), view = new DataView(bytes.buffer);
  let at = constJoints * 16;
  for (const [time, track, value] of keyed) { view.setUint16(at, Math.round(time / duration * 65535), true); view.setUint16(at + 2, track, true); view.setFloat32(at + 4, value, true); at += 8; }
  for (const [track, value] of constant) { view.setUint16(at, track, true); view.setUint16(at + 2, 0, true); view.setFloat32(at + 4, value, true); at += 8; }
  return { bytes, counts: { animKeys: 0, animKeysRaw: 0, constAnimKeys: constJoints, trackKeys: keyed.length, constTrackKeys: constant.length } };
}

test("a clip's float tracks decode from its buffer; a static face reads as its first-frame main-pose weights", () => {
  const { bytes, counts } = buffer(3, [[0, 9, 0.2], [0.5, 9, 0.6], [0.25, 9, 0.4]], [[7, 0.3], [8, 0.25], [0, 0], [9, 0.99]], 0.5);
  expect(animBufferLength(counts)).toBe(bytes.byteLength);
  const clip = decodeClipTracks(bytes, counts, 0.5);
  // Keyed tracks sort by time and keep their keys; a constant key never replaces them.
  expect(clip.tracks.get(9)?.values.map(value => Math.round(value * 10) / 10)).toEqual([0.2, 0.4, 0.6]);
  expect(sampleTrack(clip.tracks.get(9)!, 0.125)).toBeCloseTo(0.3, 3);
  expect(clipValuesAt(clip, 1).get(9)).toBeCloseTo(0.6, 5);
  const v = vocabulary();
  expect(clipControlVector(clip, "AdditiveFromRefPose", v.tracks, v.reference, v.main))
    .toEqual({ jaw_mid_open: f32(0.2), lips_l_corner_up: f32(0.3), lips_r_corner_up: f32(0.25) });
  // `Additive` stores absolute values: the reference is subtracted (main poses rest at 0, so the weights are the same here).
  const absolute = buffer(0, [], [[7, 0.3]], 0.033);
  const lifted = clipControlVector(decodeClipTracks(absolute.bytes, absolute.counts, 0.033), "Additive", v.tracks, v.reference.map((r, i) => i === 7 ? 0.1 : r), v.main);
  expect(Object.keys(lifted)).toEqual(["lips_l_corner_up"]);
  expect(lifted.lips_l_corner_up).toBeCloseTo(0.2, 6);
  expect(() => decodeClipTracks(bytes.subarray(0, 10), counts, 0.5)).toThrow("shorter than its keys need");
});

test("rig rests and solved deltas convert from REDengine to glTF axes; untouched joints are left out", () => {
  expect(vecToGltf(1, 2, 3)).toEqual([1, 3, -2]);
  expect(quatToGltf(0.1, 0.2, 0.3, 0.9)).toEqual([0.1, 0.3, -0.2, 0.9]);
  const q = (i: number, j: number, k: number, r: number) => ({ i, j, k, r }), t = (X: number, Y: number, Z: number) => ({ X, Y, Z, W: 1 });
  const rest = rigRestFromRed({ boneNames: [{ $value: "root" }, { $value: "jaw" }], boneParentIndexes: [-1, 0],
    boneTransforms: [{ Rotation: q(0, 0, 0, 1), Translation: t(0, 0, 1.6), Scale: t(1, 1, 1) },
      { Rotation: q(0, 0, Math.SQRT1_2, Math.SQRT1_2), Translation: t(0, -0.05, 0), Scale: t(1, 1, 1) }] });
  expect(rest.joints[0]).toMatchObject({ name: "root", parent: -1, t: [0, 1.6, -0] });
  expect(rest.joints[1]!.r[1]).toBeCloseTo(Math.SQRT1_2);
  // The root is untouched; the jaw turns and moves: its rest rotation times the delta, its rest translation plus the rotated delta.
  const pose = { q: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1]), t: Float32Array.from([0, 0, 0, 0.01, 0, 0]) };
  const locals = posedLocals(rest, pose);
  expect([...locals.keys()]).toEqual([1]);
  const jaw = locals.get(1)!;
  // A +X delta in the jaw's frame (turned 90° about glTF Y) points along glTF −Z.
  expect(jaw.t[0]).toBeCloseTo(0, 6); expect(jaw.t[2]).toBeCloseTo(0.05 - 0.01, 6);
  expect(() => posedLocals(rest, { q: new Float32Array(4), t: new Float32Array(3) })).toThrow("doesn't match");
  expect(() => rigRestFromRed({ boneNames: [], boneParentIndexes: [], boneTransforms: [] })).toThrow("damaged");
});
