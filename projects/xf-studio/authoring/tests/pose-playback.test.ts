/**
 * Pose playback (pose-library-design.md §5.2, P2): the host's moving-clip frames, a pose sample as a body clip in glTF axes with its
 * placement, the idle's rig playing it with a held expression lent over the posed head, and the motion service's body source (shown at
 * once, superseded by newer choices, rolled back on failure, left for Still or an idle).
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { IdleAnimation } from "../src/idle-animation";
import { FaceDriver } from "../src/platform/scene/face-driver";
import { composePreviewMotion } from "../src/preview-motion";
import { poseClip, rotationToGltf, translationToGltf } from "../src/pose-clip";
import { clipMotion } from "../src/pose-catalogue-host";
import type { PoseSample } from "../src/pose-catalogue";
import { MotionActions, type MotionPort } from "../src/motion-actions";
import { freshWorkspace } from "./fixtures/eye-region";
import type { AnimClip, AnimRig } from "../src/native/anim-set";

const identity = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const quarterZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).toArray();
/** A three-joint sample: Root, Hips 1 m up (game Z), Head above it turned a quarter about the game's up axis. */
function sample(extra: Partial<PoseSample> = {}): PoseSample {
  return { schema: "xfs/pose-sample-1", id: "PhotoModePoses.test", clip: { name: "test", set: "set.anims", frames: 2, duration: 0.033 }, time: 0, rig: "woman_base.rig",
    joints: [
      { bone: "Root", parent: null, translation: [0, 0, 0], ...identity, keyed: false },
      { bone: "Hips", parent: "Root", translation: [0, -0.04, 1], ...identity, keyed: true },
      { bone: "Head", parent: "Hips", translation: [0, 0, 0.6], rotation: quarterZ, scale: [1, 1, 1], keyed: true },
    ], tracks: {}, ...extra };
}

test("game-space samples become glTF-axes tracks: translations and rotation axes (x, z, −y); a held pose is one key in a 1 s clip", () => {
  expect(translationToGltf([1, 2, 3])).toEqual([1, 3, -2]);
  expect(rotationToGltf([0.1, 0.2, 0.3, 0.9])).toEqual([0.1, 0.3, -0.2, 0.9]);
  const { clip, moves, start } = poseClip(sample());
  expect(moves).toBe(false); expect(start).toBe(0); expect(clip.duration).toBe(1);
  const hips = clip.tracks.find(track => track.name === "Hips.position")!;
  expect([...hips.times]).toEqual([0]);
  expect([...hips.values].map(v => +v.toFixed(6))).toEqual([0, 1, 0.04]);
  // A rotation about the game's up (Z) is a rotation about glTF's up (Y).
  const head = clip.tracks.find(track => track.name === "Head.quaternion")!;
  const q = new THREE.Quaternion().fromArray([...head.values]);
  const turned = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  expect(turned.x).toBeCloseTo(0, 6); expect(turned.z).toBeCloseTo(-1, 6);
});

test("the record's placement moves the whole character through Root; a moving pose loops its changing channels from animationTime", () => {
  const placed = poseClip(sample(), { offset: [0, 0, 0.35], rotation: [0, 0, 90] });
  const root = placed.clip.tracks.find(track => track.name === "Root.position")!;
  expect([...root.values].map(v => +v.toFixed(6))).toEqual([0, 0.35, 0]);
  const rootTurn = new THREE.Quaternion().fromArray([...placed.clip.tracks.find(track => track.name === "Root.quaternion")!.values]);
  expect(new THREE.Vector3(1, 0, 0).applyQuaternion(rootTurn).z).toBeCloseTo(-1, 6);
  const moving = poseClip(sample({ time: 0.5, motion: { rate: 2, frames: 3, channels: [{ bone: "Hips", channel: "translation", values: [0, 0, 1, 0, 0, 1.1, 0, 0, 1.2] }] } }));
  expect(moving.moves).toBe(true); expect(moving.clip.duration).toBe(1); expect(moving.start).toBe(0.5);
  const hips = moving.clip.tracks.find(track => track.name === "Hips.position")!;
  expect([...hips.times]).toEqual([0, 0.5, 1]);
  expect([...hips.values].filter((_, i) => i % 3 === 1).map(v => +v.toFixed(6))).toEqual([1, 1.1, 1.2]);
  // Channels that don't change stay one key.
  expect([...moving.clip.tracks.find(track => track.name === "Head.quaternion")!.times]).toEqual([0]);
});

test("the host sends a moving clip's changing channels at every frame, rounded, and nothing for a clip without animated keys", () => {
  const rig: AnimRig = { bones: ["Root", "Hips"], parents: [-1, 0], tracks: [], referenceTracks: [],
    reference: [{ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, { translation: [0, 0, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }] };
  const base = { name: "c", duration: 1, frames: 3, joints: 2, tracks: 0, buffer: "compressed", animationType: "Normal", motionExtraction: false,
    constKeys: [], trackKeys: [], constTrackKeys: [], counts: { compressed: 2, raw: 0, const: 0, track: 0, constTrack: 0 } };
  const clip: AnimClip = { ...base, animatedKeys: 2, keys: [
    { joint: 1, channel: "position", time: 0, value: [0, 0, 1], stored: "compressed" }, { joint: 1, channel: "position", time: 1, value: [0, 0, 1.2000004], stored: "compressed" }] };
  const motion = clipMotion(clip, rig)!;
  expect(motion.rate).toBe(2); expect(motion.frames).toBe(3);
  expect(motion.channels).toEqual([{ bone: "Hips", channel: "translation", values: [0, 0, 1, 0, 0, 1.1, 0, 0, 1.2] }]);
  expect(clipMotion({ ...clip, keys: [], animatedKeys: 0 }, rig)).toBeNull();
});

/** The idle's clip rig (Hips → Head) and a face rig on the head: the preview's bones sit at the rig's rest. */
function rig() {
  const source = new THREE.Group(), root = Object.assign(new THREE.Bone(), { name: "Root" }), hips = Object.assign(new THREE.Bone(), { name: "Hips" }),
    headJoint = Object.assign(new THREE.Bone(), { name: "Head" });
  hips.position.set(0, 1, 0.04); headJoint.position.set(0, 0.6, 0); source.add(root); root.add(hips); hips.add(headJoint);
  const preview = new THREE.Group(), head = Object.assign(new THREE.Bone(), { name: "Head" }), lip = Object.assign(new THREE.Bone(), { name: "lip" });
  head.position.set(0, 1.6, 0.04); lip.position.set(0, 1.5, 0.14); preview.add(head, lip); preview.updateMatrixWorld(true);
  const idleClip = new THREE.AnimationClip("idle", 2, [new THREE.VectorKeyframeTrack("Hips.position", [0, 1, 2], [0, 1, 0.04, 0, 1.01, 0.04, 0, 1, 0.04])]);
  const faceSource = new THREE.Group(), faceLip = Object.assign(new THREE.Bone(), { name: "lip" });
  faceLip.position.set(0, 1.5, 0.14); faceSource.add(faceLip);
  const faceClip = new THREE.AnimationClip("face", 2, [new THREE.VectorKeyframeTrack("lip.position", [0, 2], [0, 1.5, 0.14, 0, 1.5, 0.14])]);
  const idle = new IdleAnimation(source, idleClip, [head, lip], { lip: "Head" }, { source: faceSource, clip: faceClip });
  const face = new FaceDriver([head, lip]);
  face.setRig([{ name: "lip", parent: -1, t: [0, 1.5, 0.14], r: [0, 0, 0, 1], s: [1, 1, 1] }]);
  return { idle, face, head, lip };
}
const world = (bone: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

test("a pose plays on the idle's rig; a held expression is lent and composed over the posed head, and taken back when the pose ends", () => {
  const { idle, face, head, lip } = rig();
  const motion = composePreviewMotion(idle, undefined, face);
  // The expression moves the lip down 1 cm while nothing else plays.
  face.hold({ frames: [new Map([[0, { t: [0, 1.49, 0.14], r: [0, 0, 0, 1] }]])] }); motion.faceChanged();
  expect(face.isApplied).toBe(true);
  expect(world(lip).y).toBeCloseTo(1.49, 6);
  // A pose turning the head a quarter about the up axis: the idle's rig plays it, the expression is lent and composed over the turned head.
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).toArray();
  const pose = poseClip(sample({ joints: [
    { bone: "Root", parent: null, translation: [0, 0, 0], ...identity, keyed: false },
    { bone: "Hips", parent: "Root", translation: [0, -0.04, 1], ...identity, keyed: true },
    { bone: "Head", parent: "Hips", translation: [0, 0, 0.6], rotation: turn, scale: [1, 1, 1], keyed: true }] }));
  idle.setClips(pose.clip, undefined, undefined, { pose: true, moves: pose.moves });
  expect(motion.poseChanged()).toBe(true);
  expect(idle.enabled && idle.posing).toBe(true);
  expect(face.isApplied).toBe(false); expect(face.isLent).toBe(true);
  // The lip sat 10 cm in front of the head (glTF +z) and 11 cm below it; the head turned about glTF's up: it is now 10 cm to the −x side.
  const at = world(lip);
  expect(at.y).toBeCloseTo(1.49, 5); expect(at.x).toBeCloseTo(0.1, 5); expect(at.z).toBeCloseTo(0.04, 5);
  expect(world(head).y).toBeCloseTo(1.6, 6);
  // A held pose with a lent static expression doesn't keep drawing.
  expect(motion.animating()).toBe(false);
  // Releasing the expression gives the pose the idle's face back (which moves, so the view keeps drawing).
  face.release(); motion.faceChanged();
  expect(face.isLent).toBe(false);
  expect(world(lip).y).toBeCloseTo(1.5, 6);
  expect(motion.animating()).toBe(true);
  // Back to the idle's own clip and off: every bone returns to its captured pose.
  idle.setClips(new THREE.AnimationClip("idle", 2, []));
  motion.setIdle(false);
  expect(world(lip).toArray().map(v => +v.toFixed(6))).toEqual([0, 1.5, 0.14]);
});

test("joint bounds cover the posed skeleton", () => {
  const { idle } = rig();
  idle.setClips(poseClip(sample()).clip, undefined, undefined, { pose: true, moves: false });
  idle.setEnabled(true);
  const box = idle.jointBounds();
  expect(box.max.y).toBeCloseTo(1.6, 6); expect(box.min.y).toBeCloseTo(0, 6);
});

function motionPort(calls: string[], options: { fail?: boolean } = {}) {
  let enabled = false;
  const port: MotionPort = {
    available: true, blink: { available: true },
    idle: { get enabled() { return enabled; }, time: 0, paused: false, bodyEnabled: true, faceEnabled: true, seek() {} },
    setIdle: value => { enabled = value; calls.push(`idle.${value}`); }, setIdlePaused() {}, setIdleContributions() {}, setBlink() {}, animateBlink() {},
    setPose: async pose => { calls.push(pose ? `pose.${pose.sample.id}` : "pose.none"); if (pose && options.fail) throw Error("no"); if (pose) enabled = true; },
  };
  return port;
}

test("the motion service holds a pose at once, lets a newer choice supersede it, rolls back on failure and leaves it for Still", async () => {
  const calls: string[] = [];
  const motion = new MotionActions(freshWorkspace().preview, motionPort(calls));
  let resolve!: (value: PoseSample) => void;
  const slow = new Promise<PoseSample>(done => { resolve = done; });
  const first = motion.holdPose({ id: "PhotoModePoses.a", label: "A", moves: false }, slow);
  // Shown at once, loading.
  expect(motion.snapshot().pose?.id).toBe("PhotoModePoses.a"); expect(motion.snapshot().poseLoading).toBe(true);
  const second = motion.holdPose({ id: "PhotoModePoses.b", label: "B", moves: false }, Promise.resolve(sample({ id: "PhotoModePoses.b" })));
  expect(await second).toBe(true);
  resolve(sample({ id: "PhotoModePoses.a" }));
  expect(await first).toBe(false);
  expect(calls).toEqual(["pose.PhotoModePoses.b"]);
  expect(motion.snapshot()).toMatchObject({ pose: { id: "PhotoModePoses.b", label: "B" }, poseLoading: false });
  // Blink is refused while a pose is held.
  expect(motion.capability({ kind: "motion.setBlink", value: 0.5 }).available).toBe(false);
  // Still: the idle goes off first, then the pose gives the idle its clips back.
  motion.dispatch({ kind: "motion.setIdle", enabled: false });
  expect(calls.slice(-2)).toEqual(["idle.false", "pose.none"]);
  expect(motion.snapshot().pose).toBeNull();
  // A failing pose puts the previous body source back and rejects.
  const failing = new MotionActions(freshWorkspace().preview, motionPort(calls, { fail: true }));
  await expect(failing.holdPose({ id: "PhotoModePoses.c", label: "C", moves: false }, Promise.resolve(sample()))).rejects.toThrow("no");
  expect(failing.snapshot().pose).toBeNull();
});

test("a stored pose waits for the Poses module and can be dropped; without a motion rig poses are refused in plain words", () => {
  const preview = { ...freshWorkspace().preview, pose: { id: "PhotoModePoses.a", label: "A" } };
  const motion = new MotionActions(preview, motionPort([]));
  expect(motion.pendingPose()).toEqual({ id: "PhotoModePoses.a", label: "A" });
  expect(motion.snapshot()).toMatchObject({ pose: { id: "PhotoModePoses.a" }, poseLoading: true });
  motion.dropPendingPose();
  expect(motion.snapshot().pose).toBeNull();
  const none = new MotionActions(freshWorkspace().preview, { ...motionPort([]), setPose: undefined });
  expect(none.poseCapability().reason).toContain("Poses play on V");
});

test("the held pose is view state in the workspace: stored with its label, restored, and dropped when unreadable", async () => {
  const { parseWorkspace, serializeWorkspace } = await import("../src/workspace-state");
  const { STUDIO_DOCUMENTS } = await import("../src/compose/studio-registry");
  const state = freshWorkspace();
  state.preview.pose = { id: "PhotoModePoses.idle_stand_01", label: "Standing" };
  const round = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS))), STUDIO_DOCUMENTS);
  expect(round.preview.pose).toEqual({ id: "PhotoModePoses.idle_stand_01", label: "Standing" });
  const bad = JSON.parse(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)));
  bad.preview.pose = { id: "no spaces allowed", label: "x" };
  expect(parseWorkspace(bad, STUDIO_DOCUMENTS).preview.pose).toBeUndefined();
});
