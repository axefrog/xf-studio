// XF Studio's facial solver (src/engines/facial-rig/solver.ts) on a small synthetic rig and setup built here, stage by stage as the
// clean-room specification describes them (research/animation/facial-solver-spec.md §4), plus its refusals and compile options. The
// parity with the IO Suite on the game's own setups is tests/facial-solver-oracle.test.ts (opt-in).
import { describe, expect, test } from "bun:test";
import { compileFacialRig, composeLocalPose, createFacialPose, ENVELOPE_NAMES, FacialSetupError, type FacialTrace, solveFace, solveFaceFrames,
  WEIGHT_EPSILON } from "../src/engines/facial-rig/solver";
import { bakeClips, bakedRest, bakeFrames, bindFromRigMatrix, clipFrame, clipTimes, eyeShapeSeats, introFrames } from "../src/engines/facial-rig/bake";
import { inAppSolver } from "../src/facial-host";

type Q = [number, number, number, number];
const quat = (axis: [number, number, number], radians: number): Q => {
  const s = Math.sin(radians / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(radians / 2)];
};
const MAIN = ["a", "b", "c", "d", "e"];
const E = ENVELOPE_NAMES.length, M = MAIN.length, O = 2, W = 2;
/** Tracks: 13 envelopes, 5 main (a–e), 2 overrides, 5 lipsync pose outputs, 2 wrinkles. */
const TRACKS = [...ENVELOPE_NAMES, ...MAIN, "aOverride", "bOverride", ...MAIN.map(n => `${n}Lipsync`), "aWrnkl", "bWrnkl"];
const REFERENCE = TRACKS.map((name, i) => i < E ? ([0, 1, 2, 5, 6, 7, 8].includes(i) ? 1 : 0) : name.endsWith("Override") ? 1 : 0);
const track = (name: string) => TRACKS.indexOf(name);
const A = track("a"), B = track("b"), C = track("c"), D = track("d"), EE = track("e");

type Transform = { bone: number; q: Q; t?: [number, number, number] };
function poseBuffer(poses: Transform[][], scales: (null | [number, number, number])[] = []) {
  const Transforms: unknown[] = [], Poses: unknown[] = [], Scales: unknown[] = [];
  poses.forEach((list, i) => {
    const scale = scales[i];
    Poses.push({ TransformIdx: Transforms.length, ScaleIdx: Scales.length, NumTransforms: list.length, IsScale: scale ? 1 : 0, Flag1: 0, Flag2: 0, Flag3: 0 });
    for (const t of list) {
      Transforms.push({ Rotation: { $type: "Quaternion", i: t.q[0], j: t.q[1], k: t.q[2], r: t.q[3] }, Translation: { $type: "Vector3", X: t.t?.[0] ?? 0, Y: t.t?.[1] ?? 0, Z: t.t?.[2] ?? 0 },
        Bone: t.bone, JointRegion: 0, Unknown: 0 });
      if (scale) Scales.push({ $type: "Quaternion", i: scale[0], j: scale[1], k: scale[2], r: 1 });
    }
  });
  return { Poses, Transforms, Scales };
}
const empty = () => ({ EnvelopesPerTrackMapping: [], GlobalLimits: [], InfluencedPoses: [], InfluenceIndices: [], UpperLowerFace: [], LipsyncPosesSides: [],
  GlobalCorrectiveEntries: [], InbetweenCorrectiveEntries: [], CorrectiveInfluencedPoses: [], CorrectiveInfluenceIndices: [], AllMainPoses: [],
  AllMainPosesInbetweens: [], AllMainPosesInbetweenScopeMultipliers: [], Wrinkles: [] });
const X: [number, number, number] = [1, 0, 0], Z: [number, number, number] = [0, 0, 1];

/**
 * A face part with: a (2 in-betweens at 0.5 and 1: joint 1 turns 20° then 40° about X), b (joint 1 turns 30° about Z, moves 1 mm), c (joint 2,
 * a scale pose), d (joint 2 moves 2 mm), e (joint 1 turns 10° about X). Envelopes: a type 0, b type 2 (muted by muzzleEyes), c type 3, d type 1,
 * e type 5 at LOD 1. Influence: d reduced by a (linear) and b reduced by e (exponential). Upper/lower: b upper, d lower. Correctives: 0 = a × b
 * (joint 2 moves 3 mm); 1 = b with flag 1 (never at LOD 0); 2 = in-between 0 of a (joint 2 moves 1 mm); corrective influence: 2 reduced by 0.
 */
function setup(options: { correctiveInfluenceType?: number; influenceType?: number } = {}) {
  const face = {
    ...empty(),
    EnvelopesPerTrackMapping: [{ Track: A, Envelope: 0, LevelOfDetail: 0 }, { Track: B, Envelope: 2, LevelOfDetail: 0 }, { Track: C, Envelope: 3, LevelOfDetail: 0 },
      { Track: D, Envelope: 1, LevelOfDetail: 0 }, { Track: EE, Envelope: 5, LevelOfDetail: 1 }],
    GlobalLimits: [{ Track: A, Envelope: 1, Min: 0.2, Mid: 0.4, Max: 0.8, IsCachable: 0 }],
    InfluencedPoses: [{ Track: D, NumInfluences: 1, Type: 0 }, { Track: B, NumInfluences: 1, Type: options.influenceType ?? 1 }],
    InfluenceIndices: [A, EE],
    UpperLowerFace: [{ Track: A, Part: 0, Unknown: 0 }, { Track: B, Part: 1, Unknown: 0 }, { Track: D, Part: 2, Unknown: 0 }],
    LipsyncPosesSides: [{ Track: A, Side: 0, Unknown: 0 }, { Track: B, Side: 1, Unknown: 0 }],
    AllMainPoses: [{ Track: A, NumInbetweens: 2, Unknown: 0 }, { Track: B, NumInbetweens: 1, Unknown: 0 }, { Track: C, NumInbetweens: 1, Unknown: 0 },
      { Track: D, NumInbetweens: 1, Unknown: 0 }, { Track: EE, NumInbetweens: 1, Unknown: 0 }],
    AllMainPosesInbetweens: [0.5, 1, 1, 1, 1, 1], AllMainPosesInbetweenScopeMultipliers: [2],
    GlobalCorrectiveEntries: [{ Index: 0, Track: A, Unknown: 0 }, { Index: 1, Track: B, Unknown: 1 }, { Index: 0, Track: B, Unknown: 0 }],
    InbetweenCorrectiveEntries: [{ Index: 2, Track: 0, Unknown: 0 }],
    CorrectiveInfluencedPoses: [{ Index: 2, NumInfluences: 1, Type: options.correctiveInfluenceType ?? 0 }], CorrectiveInfluenceIndices: [0],
    Wrinkles: [A, B],
  };
  const main = poseBuffer([[{ bone: 1, q: quat(X, 20 * Math.PI / 180) }], [{ bone: 1, q: quat(X, 40 * Math.PI / 180) }],
    [{ bone: 1, q: quat(Z, 30 * Math.PI / 180), t: [0.001, 0, 0] }], [{ bone: 2, q: [0, 0, 0, 1] }], [{ bone: 2, q: [0, 0, 0, 1], t: [0, 0.002, 0] }],
    [{ bone: 1, q: quat(X, 10 * Math.PI / 180) }]], [null, null, null, [0.5, -0.25, 0], null, null]);
  const corrective = poseBuffer([[{ bone: 2, q: [0, 0, 0, 1], t: [0, 0, 0.003] }], [{ bone: 2, q: [0, 0, 0, 1], t: [0.01, 0, 0] }],
    [{ bone: 2, q: [0, 0, 0, 1], t: [0.001, 0, 0] }]]);
  const none = poseBuffer([]);
  return {
    $type: "animFacialSetup", version: 8,
    info: { tracksMapping: { numEnvelopes: E, numMainPoses: M, numLipsyncOverrides: O, numWrinkles: W },
      face: { numAllMainPoses: 5, numAllCorrectives: 3, wrinkleStartingIndex: track("aWrnkl") } },
    bakedData: { Data: { LipsyncOverridesIndexMapping: [A, B], JointRegions: [255, 0, 0], Face: face, Eyes: { ...empty(), Wrinkles: [A, B] }, Tongue: { ...empty(), Wrinkles: [A, B] } } },
    mainPosesData: { Data: { Face: main, Eyes: none, Tongue: none } },
    correctivePosesData: { Data: { Face: corrective, Eyes: none, Tongue: none } },
    faceCorrectiveNames: ["a__b__Corr", "b__Corr", "a0__Corr"], tongueCorrectiveNames: [],
  };
}
const identity = { Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: 0, Y: 0, Z: 0, W: 0 }, Scale: { X: 1, Y: 1, Z: 1, W: 0 } };
const RIG = { $type: "animRig", boneNames: ["root", "lid", "cheek"], boneParentIndexes: [-1, 0, 0],
  boneTransforms: [identity, { ...identity, Translation: { X: 0.01, Y: 0, Z: 0.1, W: 0 } }, { ...identity, Translation: { X: -0.01, Y: 0.02, Z: 0.1, W: 0 } }],
  trackNames: TRACKS, referenceTracks: REFERENCE };

const compiled = compileFacialRig(RIG, setup());
const solve = (values: Record<string, number>, options: Parameters<typeof solveFace>[3] = {}, rig = compiled) => {
  const v = rig.referenceTracks();
  for (const [name, x] of Object.entries(values)) v[rig.trackIndex(name)] = name in Object.fromEntries(ENVELOPE_NAMES.map(n => [n, 1])) ? x : v[rig.trackIndex(name)]! + x;
  return solveFace(rig, v, createFacialPose(rig), options);
};
const angleAbout = (q: Float32Array, j: number) => 2 * Math.atan2(Math.hypot(q[j * 4]!, q[j * 4 + 1]!, q[j * 4 + 2]!), q[j * 4 + 3]!) * 180 / Math.PI;

describe("the facial solver on a synthetic setup", () => {
  test("neutral leaves every joint at rest and every wrinkle at 0", () => {
    const pose = solve({});
    expect([...pose.rotations]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect([...pose.translations].every(v => v === 0)).toBe(true);
    expect(pose.tracks[track("aWrnkl")]).toBe(0);
  });
  test("a single in-between control at 1 takes its pose whole; the result doesn't depend on the previous solve", () => {
    const rig = compiled, out = createFacialPose(rig), v = rig.referenceTracks();
    v[C] = 1; solveFace(rig, v, out);
    v[C] = 0; v[B] = 1; solveFace(rig, v, out);
    expect(angleAbout(out.rotations, 1)).toBeCloseTo(30, 4);
    expect(out.translations[3]).toBeCloseTo(0.001, 9);
    expect(out.translations[6]).toBe(0);
  });
  test("in-betweens cross-fade between thresholds; the first segment uses the first gap's multiplier", () => {
    const trace: FacialTrace = { parts: [] };
    solve({ a: 0.75 }, { trace });
    const face = trace.parts.find(p => p.part === "Face")!;
    expect([...face.inbetweens!.subarray(0, 2)]).toEqual([0.5, 0.5]);
    solve({ a: 0.25 }, { trace: (trace.parts = [], trace) });
    expect(trace.parts.at(-1)!.inbetweens![0]).toBeCloseTo(0.5, 6);
    // Two poses blended by sequential nlerp: 20° at 0.5 and 40° at 0.5 (not a slerp to 30°).
    const pose = solve({ a: 0.75 });
    const ten = Math.PI / 18, half20 = Math.hypot(Math.sin(ten) * 0.5, 0.5 + 0.5 * Math.cos(ten));
    const first = 2 * Math.atan2(Math.sin(ten) * 0.5 / half20, (0.5 + 0.5 * Math.cos(ten)) / half20);
    expect(angleAbout(pose.rotations, 1)).toBeGreaterThan(first * 180 / Math.PI);
  });
  test("a threshold edge: exactly 0.001 is off, 0.0011 is on (ε compared as float32)", () => {
    expect(WEIGHT_EPSILON).toBe(Math.fround(0.001));
    expect(solve({ c: 0.001 }).tracks[C]).toBe(0);
    expect(solve({ c: 0.0011 }).tracks[C]).toBeCloseTo(0.0011, 7);
  });
  test("muzzles mute their envelope types; an LOD above the solve LOD acts, one below doesn't", () => {
    expect(solve({ b: 1, muzzleEyes: 0.25 }).tracks[B]).toBeCloseTo(0.75, 6);
    expect(solve({ c: 1, muzzleBrows: 1 }).tracks[C]).toBe(0);
    expect(solve({ e: 1 }).tracks[EE]).toBe(1);
    expect(solve({ e: 1 }, { lod: 1, lodFade: 0.5 }).tracks[EE]).toBeCloseTo(0.5, 6);
    expect(solve({ e: 1 }, { lod: 2 }).tracks[EE]).toBe(0);
    // muzzleLips mutes nothing at the envelope stage by default (E2).
    expect(solve({ d: 1, muzzleLips: 1 }).tracks[D]).toBe(1);
  });
  test("speech limits bite only with lipSyncEnvelope and pull by muzzleLips toward the JALI cap", () => {
    expect(solve({ a: 1, muzzleLips: 1 }).tracks[A]).toBe(1);
    // jaliLips 1 → cap = Mid 0.4; muzzleLips 0.5 pulls halfway.
    expect(solve({ a: 1, muzzleLips: 0.5, lipSyncEnvelope: 1 }).tracks[A]).toBeCloseTo(0.7, 6);
    // jaliLips 1.5 → 0.4 + 0.5 × 0.4 = 0.6; jaliLips 0 → Min 0.2.
    expect(solve({ a: 1, muzzleLips: 1, lipSyncEnvelope: 1, jaliLips: 1.5 }).tracks[A]).toBeCloseTo(0.6, 6);
    expect(solve({ a: 1, muzzleLips: 1, lipSyncEnvelope: 1, jaliLips: 0 }).tracks[A]).toBeCloseTo(0.2, 6);
  });
  test("influences run twice: linear stays, exponential compounds", () => {
    expect(solve({ d: 1, a: 0.6 }).tracks[D]).toBeCloseTo(0.4, 6);
    expect(solve({ b: 1, e: 0.5 }).tracks[B]).toBeCloseTo(0.75 * 0.75, 6);
    expect(solve({ d: 1, a: 1 }).tracks[D]).toBe(0);
    const organic = compileFacialRig(RIG, setup({ influenceType: 2 }));
    expect(solve({ b: 1, e: 0.5 }, {}, organic).tracks[B]).toBeCloseTo(0.25 * 0.25, 6);
    const twice = compileFacialRig(RIG, setup(), { compat: { influencePasses: "second-only-if-lipsync" } });
    expect(solve({ b: 1, e: 0.5 }, {}, twice).tracks[B]).toBeCloseTo(0.75, 6);
  });
  test("upper and lower face scale their parts, clamped to 0–1", () => {
    expect(solve({ b: 1, upperFace: 0.5 }).tracks[B]).toBeCloseTo(0.5, 6);
    expect(solve({ b: 1, upperFace: 1.5 }).tracks[B]).toBe(1);
    expect(solve({ d: 1, lowerFace: 0.25 }).tracks[D]).toBeCloseTo(0.25, 6);
    expect(solve({ a: 1, lowerFace: 0 }).tracks[A]).toBe(1);
  });
  test("lipsync overrides scale by the override weight under lipSyncEnvelope; lipsync poses add ungated and clamp", () => {
    expect(solve({ a: 1, lipSyncEnvelope: 1, aOverride: -0.5 }).tracks[A]).toBeCloseTo(0.5, 6);
    expect(solve({ a: 1, aOverride: -0.5 }).tracks[A]).toBe(1);
    expect(solve({ aLipsync: 0.4 }).tracks[A]).toBeCloseTo(0.4, 6);
    expect(solve({ a: 0.8, aLipsync: 0.4 }).tracks[A]).toBe(1);
  });
  test("correctives multiply their drivers; the flag disables at LOD 0; corrective influences reduce", () => {
    const trace: FacialTrace = { parts: [] };
    solve({ a: 1, b: 0.5 }, { trace });
    const face = trace.parts.find(p => p.part === "Face")!;
    expect(face.correctivesBefore![0]).toBeCloseTo(0.5, 6);
    expect(face.correctivesBefore![1]).toBe(0);
    trace.parts = [];
    solve({ a: 0.5, b: 0.5 }, { trace });
    const again = trace.parts.find(p => p.part === "Face")!;
    // Corrective 2 follows in-between 0 of a (β = 1 at a = 0.5); reduced by corrective 0 (0.25) linearly: min(1, 0.75).
    expect(again.correctivesBefore![2]).toBeCloseTo(1, 6);
    expect(again.correctivesAfter![2]).toBeCloseTo(0.75, 6);
    const flagOff = compileFacialRig(RIG, setup(), { compat: { correctiveFlag: "ignore" } });
    trace.parts = [];
    solve({ b: 1 }, { trace }, flagOff);
    expect(trace.parts.find(p => p.part === "Face")!.correctivesBefore![1]).toBe(1);
  });
  test("corrective influence types 1–3 by bit, type 3 regrowing past a sum of 1", () => {
    const cases: [number, number][] = [[1, 1 - 0.25 * 0.25], [2, 0.75], [3, 0.75 * 0.75]];
    for (const [type, expected] of cases) {
      const rig = compileFacialRig(RIG, setup({ correctiveInfluenceType: type })), trace: FacialTrace = { parts: [] };
      solve({ a: 0.5, b: 0.5 }, { trace }, rig);
      expect(trace.parts.find(p => p.part === "Face")!.correctivesAfter![2]).toBeCloseTo(expected, 6);
    }
  });
  test("translations add; wrinkles are 1 − (1 − w)² of the processed weight", () => {
    const pose = solve({ a: 1, b: 1, d: 0.5 });
    // d 0.5 (reduced by a = 1 to 0): 0; corrective 0 (a × b = 1) moves joint 2 by 3 mm.
    expect(pose.translations[3 * 2 + 2]).toBeCloseTo(0.003, 9);
    expect(solve({ a: 0.5 }).tracks[track("aWrnkl")]).toBeCloseTo(0.75, 6);
  });
  test("scale poses are ignored by default and applied as 1 + w · value with scalePoses apply", () => {
    expect(createFacialPose(compiled).scales).toBeUndefined();
    const rig = compileFacialRig(RIG, setup(), { compat: { scalePoses: "apply" } });
    const pose = solve({ c: 0.5 }, {}, rig);
    expect([...pose.scales!.subarray(6, 9)]).toEqual([1.25, 0.875, 1]);
  });
  test("faceEnvelope gates the whole face only when asked", () => {
    expect(solve({ a: 1, faceEnvelope: 0 }).tracks[A]).toBe(1);
    const gate = compileFacialRig(RIG, setup(), { compat: { faceEnvelope: "gate" } });
    expect(solve({ a: 1, faceEnvelope: 0.5 }, {}, gate).tracks[A]).toBeCloseTo(0.5, 6);
  });
  test("many frames equal one at a time", () => {
    const T = TRACKS.length, frames = new Float32Array(T * 3);
    for (let f = 0; f < 3; f++) { frames.set(compiled.referenceTracks(), f * T); frames[f * T + A] = f / 2; frames[f * T + B] = 1 - f / 3; }
    const all = solveFaceFrames(compiled, frames), one = createFacialPose(compiled);
    for (let f = 0; f < 3; f++) {
      solveFace(compiled, frames.subarray(f * T, (f + 1) * T), one);
      expect([...all.rotations.subarray(f * 12, (f + 1) * 12)]).toEqual([...one.rotations]);
      expect([...all.tracks.subarray(f * T, (f + 1) * T)]).toEqual([...one.tracks]);
    }
  });
  test("local poses: rest then delta, in REDengine or glTF axes", () => {
    const turned = { ...RIG, boneTransforms: [identity, { Rotation: { i: 0, j: 0, k: Math.SQRT1_2, r: Math.SQRT1_2 }, Translation: { X: 0.01, Y: 0, Z: 0.1, W: 0 },
      Scale: { X: 2, Y: 1, Z: 1, W: 0 } }, identity] };
    const rig = compileFacialRig(turned, setup());
    expect(rig.warnings.some(w => w.includes("turned or scaled rest"))).toBe(true);
    const pose = solve({ b: 1 }, {}, rig), out = new Float32Array(30);
    composeLocalPose(rig, pose, out);
    // Translation delta (1 mm along X) scaled by 2 and turned 90° about Z by the rest: +2 mm along Y.
    expect(out[10]).toBeCloseTo(0.01, 7); expect(out[11]).toBeCloseTo(0.002, 7); expect(out[12]).toBeCloseTo(0.1, 7);
    composeLocalPose(rig, pose, out, "gltf");
    expect(out[10]).toBeCloseTo(0.01, 7); expect(out[11]).toBeCloseTo(0.1, 7); expect(out[12]).toBeCloseTo(-0.002, 7);
    expect([out[17], out[18], out[19]]).toEqual([2, 1, 1]);
  });
  test("refusals in plain words", () => {
    const pose = createFacialPose(compiled), v = compiled.referenceTracks();
    expect(() => solveFace(compiled, v.subarray(1), pose)).toThrow(FacialSetupError);
    v[A] = NaN;
    expect(() => solveFace(compiled, v, pose)).toThrow("invalid number");
    const { bakedData: _, ...noBaked } = setup();
    expect(() => compileFacialRig(RIG, noBaked)).toThrow("no baked data");
    expect(() => compileFacialRig({ ...RIG, trackNames: ["x", ...TRACKS.slice(1)] }, setup())).toThrow("envelopes");
    expect(() => compileFacialRig({ ...RIG, trackNames: TRACKS.slice(0, 20), referenceTracks: REFERENCE.slice(0, 20) }, setup())).toThrow("more controls");
    const badBone = setup();
    (badBone.mainPosesData.Data.Face.Transforms[0] as { Bone: number }).Bone = 9;
    expect(() => compileFacialRig(RIG, badBone)).toThrow("joint the face skeleton doesn't have");
    const unordered = setup();
    unordered.bakedData.Data.Face.AllMainPosesInbetweens = [1, 0.5, 1, 1, 1, 1];
    expect(() => compileFacialRig(RIG, unordered)).toThrow("in order");
  });
});

describe("face bakes from the solver", () => {
  const clip = (track: number, times: number[], values: number[], duration: number) => ({ duration, tracks: new Map([[track, { times, values }]]) });
  test("a clip's frames: reference plus its values; moving joints only, local in glTF axes after the rest", () => {
    const loop = clip(B, [0, 1], [0, 1], 1);
    expect(clipTimes(1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const frame = clipFrame(compiled, loop, 0.5);
    expect(frame[B]).toBeCloseTo(0.5, 6); expect(frame[track("upperFace")]).toBe(1);
    const times = clipTimes(1, 4), baked = bakeFrames(compiled, times.map(t => clipFrame(compiled, loop, t)), times);
    expect(baked.joints).toEqual([1]);
    const rest = bakedRest(compiled);
    // The lid (joint 1) rests at (0.01, 0, 0.1) REDengine = (0.01, 0.1, 0) glTF; at b = 1 it moves 1 mm along REDengine X.
    expect([...rest.local.subarray(10, 13)].map(v => +v.toFixed(6))).toEqual([0.01, 0.1, 0]);
    const last = baked.local.subarray(4 * 7, 4 * 7 + 7);
    expect(last[0]).toBeCloseTo(0.011, 7); expect(last[1]).toBeCloseTo(0.1, 7);
    const shared = bakeClips(compiled, [{ frames: [clipFrame(compiled, loop, 0)], times: [0] }, { frames: [solveFrame({ d: 1 })], times: [0] }]);
    expect(shared[0]!.joints).toEqual(shared[1]!.joints);
    expect(shared[0]!.joints).toEqual([2]);
  });
  test("a showcase before the loop: blended in, played, blended into the loop restarting underneath, then one wrapped pass of the loop", () => {
    const loop = clip(B, [0, 2], [0, 1], 2), intro = clip(D, [0, 1], [1, 1], 1);
    const { frames, times } = introFrames(compiled, intro, loop, { rate: 4, blend: 0.5, loopFrom: 1.5 });
    expect(times.at(-1)).toBeCloseTo(3.5, 9);
    const at = (t: number) => frames[Math.round(t * 4)]!;
    expect(at(0)[D]).toBe(0); expect(at(0.25)[D]).toBeCloseTo(0.5, 6); expect(at(0.5)[D]).toBe(1);
    // The showcase ends at 1 s: the loop restarts there underneath and the showcase fades out by 1.5 s.
    expect(at(1.25)[D]).toBeCloseTo(0.5, 6); expect(at(1.25)[B]).toBeCloseTo(0.125 / 2 * 1, 6);
    expect(at(1.5)[D]).toBe(0); expect(at(1.5)[B]).toBeCloseTo(0.25, 6);
    expect(at(3)[B]).toBeCloseTo(0, 6);
  });
  test("eye-shape seats: listed eye-region joints at their binds; unlisted joints on the eye joint follow it", () => {
    const names = ["root", "l_J_eye_JNT", "l_J_eye_lid_up_root_1_JNT", "l_J_eye_brows_rowA_0_JNT", "jaw"];
    const at = (x: number, y: number, z: number) => ({ Rotation: { i: 0, j: 0, k: 0, r: 1 }, Translation: { X: x, Y: y, Z: z, W: 0 }, Scale: { X: 1, Y: 1, Z: 1, W: 0 } });
    const rig = compileFacialRig({ ...RIG, boneNames: names, boneParentIndexes: [-1, 0, 0, 0, 0],
      boneTransforms: [at(0, 0, 0), at(0.03, -0.05, 1.7), at(0.03, -0.05, 1.7), at(0.02, -0.06, 1.75), at(0, -0.02, 1.6)] }, setup());
    // A rig matrix is the inverse of the world bind: a joint at p has W = −p.
    const moved = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
    const seats = eyeShapeSeats(bakedRest(rig), [255, 0, 0, 0, 3],
      [{ name: "h091", region: "eyes", bones: ["l_J_eye_JNT", "jaw"], matrices: [moved(0.032, -0.05, 1.7), moved(0, -0.02, 1.6)] },
       { name: "h092", region: "nose", bones: ["l_J_eye_JNT"], matrices: [moved(1, 1, 1)] }],
      [{ name: "h091", region: "eyes", bones: ["l_J_eye_brows_rowA_0_JNT"], matrices: [moved(0.02, -0.061, 1.75)] }]);
    expect(Object.keys(seats)).toEqual(["h091"]);
    expect(Object.keys(seats.h091!).sort()).toEqual(["l_J_eye_JNT", "l_J_eye_brows_rowA_0_JNT", "l_J_eye_lid_up_root_1_JNT"]);
    // glTF axes: (x, z, −y).
    expect(seats.h091!.l_J_eye_JNT!.slice(0, 3).map(v => +v.toFixed(6))).toEqual([0.032, 1.7, 0.05]);
    expect(seats.h091!.l_J_eye_lid_up_root_1_JNT!.slice(0, 3).map(v => +v.toFixed(6))).toEqual([0.032, 1.7, 0.05]);
    expect(seats.h091!.l_J_eye_brows_rowA_0_JNT!.slice(0, 3).map(v => +v.toFixed(6))).toEqual([0.02, 1.75, 0.061]);
    // A turned bind decomposes to its rotation: 90° about Z in REDengine is 90° about −Y... in glTF (0, −√½, 0, √½) up to sign.
    const turned = bindFromRigMatrix([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(turned[3 * 4 + 3]).toBe(1);
  });
  test("the in-app solver speaks the solver protocol", async () => {
    const solver = inAppSolver(compiled);
    expect(await solver.ready).toMatchObject({ ok: true });
    const answer = await solver.solve([solveFrame({ b: 1 }), solveFrame({})]);
    const q = new Float32Array(Buffer.from(answer.q, "base64").buffer.slice(0));
    expect(q.length).toBe(2 * 3 * 4);
    expect(q[4 + 3]).toBeCloseTo(Math.cos(15 * Math.PI / 180), 6);
    expect(q[12 + 7]).toBe(1);
    solver.dispose();
    expect(solver.exited).toBe(true);
    await expect(solver.solve([solveFrame({})])).rejects.toThrow("stopped");
    const broken = inAppSolver(() => compileFacialRig(RIG, {}));
    expect(await broken.ready).toMatchObject({ ok: false });
  });
});
function solveFrame(values: Record<string, number>) {
  const v = compiled.referenceTracks();
  for (const [name, x] of Object.entries(values)) v[compiled.trackIndex(name)]! += x;
  return v;
}
