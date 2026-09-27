/**
 * The face driver and its place in the motion rules (platform/scene/face-driver.ts, preview-motion.ts; design §5.1, §5.3): a solved pose
 * drives every bone of the same name in world bind space, detail skeletons follow, releasing restores the captured pose exactly, a rig
 * from another head is refused, the idle wins while it plays, and the blink writes nothing while an expression is held.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { FACE_MASCULINE, FACE_OTHER_HEAD, FaceDriver } from "../src/platform/scene/face-driver";
import { composePreviewMotion, type ComposedBlink, type ComposedIdle } from "../src/preview-motion";

const JOINTS = [{ name: "face_root", parent: -1, t: [0, 1.6, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
  { name: "jaw", parent: 0, t: [0, -0.05, 0.02], r: [0, 0, 0, 1], s: [1, 1, 1] },
  { name: "lip", parent: 1, t: [0, -0.01, 0.03], r: [0, 0, 0, 1], s: [1, 1, 1] }];
/** The preview head's bones: flat under the scene at the rig's world rest (as the derived head is). */
function head() {
  const scene = new THREE.Group();
  const bones = [["face_root", [0, 1.6, 0]], ["jaw", [0, 1.55, 0.02]], ["lip", [0, 1.54, 0.05]]].map(([name, at]) => {
    const bone = Object.assign(new THREE.Bone(), { name: name as string }); bone.position.fromArray(at as number[]); scene.add(bone); return bone;
  });
  scene.updateMatrixWorld(true);
  return { scene, bones };
}
const world = (bone: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
const open = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3).toArray();
const pose = { frames: [new Map([[1, { t: [0, -0.05, 0.02], r: open }]])] };

test("a held pose moves the bones by name, children follow, and releasing restores the captured pose exactly", () => {
  const { bones } = head(), [, jaw, lip] = bones as [THREE.Bone, THREE.Bone, THREE.Bone];
  const before = bones.map(bone => bone.matrix.clone());
  const driver = new FaceDriver(bones);
  driver.setRig(JOINTS);
  driver.hold(pose);
  // Held but not applied: nothing moves until its owner applies it.
  expect(world(lip).toArray()).toEqual([0, 1.54, 0.05]);
  driver.setApplied(true);
  expect(world(jaw).distanceTo(new THREE.Vector3(0, 1.55, 0.02))).toBeLessThan(1e-6);
  // The lip turns with the jaw about the jaw joint.
  const expected = new THREE.Vector3(0, -0.01, 0.03).applyQuaternion(new THREE.Quaternion().fromArray(open)).add(new THREE.Vector3(0, 1.55, 0.02));
  expect(world(lip).distanceTo(expected)).toBeLessThan(1e-6);
  // A detail's own copy of the skeleton joins and follows.
  const detail = Object.assign(new THREE.Bone(), { name: "lip" }); detail.position.set(0, 1.54, 0.05); detail.updateMatrixWorld(true);
  driver.attach([detail]);
  expect(world(detail).distanceTo(expected)).toBeLessThan(1e-6);
  driver.release();
  bones.forEach((bone, index) => expect(bone.matrix.equals(before[index]!)).toBe(true));
  expect(world(detail).toArray()).toEqual([0, 1.54, 0.05]);
});

test("a rig whose joints sit elsewhere than this head's bones is refused and changes nothing", () => {
  const { bones } = head(), driver = new FaceDriver(bones);
  expect(() => driver.setRig(JOINTS.map(joint => joint.name === "jaw" ? { ...joint, t: [0, -0.06, 0.02] } : joint))).toThrow(FACE_OTHER_HEAD);
  expect(driver.ready).toBe(false);
});

test("a masculine V's head says his live expressions come later, not that the face data is another head's (CORE-107)", () => {
  const { bones } = head(), driver = new FaceDriver(bones, "male");
  expect(() => driver.setRig(JOINTS)).toThrow(FACE_MASCULINE);
  expect(driver.ready).toBe(false);
});

test("motion rules: the idle wins while it plays, a held expression mutes the blink, releasing gives the bones back", () => {
  const { bones } = head(), face = new FaceDriver(bones);
  face.setRig(JOINTS);
  const calls: string[] = [];
  let enabled = false;
  const idle: ComposedIdle = { get enabled() { return enabled; }, paused: false, onChange: undefined, update: () => { calls.push("idle.update"); },
    setEnabled: (value: boolean) => { enabled = value; calls.push(`idle.${value}`); }, attach: () => {}, detach: () => {} } as unknown as ComposedIdle;
  const blink = { animating: false, onChange: undefined, update: () => { calls.push("blink.update"); }, reset: () => { calls.push("blink.reset"); },
    attach: () => {}, detach: () => {}, dispose: () => {}, setMuted: (muted: boolean) => { calls.push(`blink.muted.${muted}`); } } as unknown as ComposedBlink;
  const motion = composePreviewMotion(idle, blink, face);
  face.hold(pose); motion.faceChanged();
  expect(face.isApplied).toBe(true);
  expect(calls).toContain("blink.muted.true");
  motion.advance(0.016);
  expect(calls).not.toContain("blink.update");
  // The idle takes the bones; the expression steps aside and comes back when it stops.
  motion.setIdle(true);
  expect(face.isApplied).toBe(false);
  motion.setIdle(false);
  expect(face.isApplied).toBe(true);
  face.release(); motion.faceChanged();
  expect(calls.at(-1)).toBe("blink.muted.false");
  motion.advance(0.016);
  expect(calls.at(-1)).toBe("blink.update");
});

test("a held clip (the blink over an expression) animates inside its frames and holds between repeats", () => {
  const { bones } = head(), face = new FaceDriver(bones);
  face.setRig(JOINTS);
  const shut = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5).toArray();
  face.hold({ frames: [new Map(), new Map([[1, { t: [0, -0.05, 0.02], r: shut }]]), new Map()], rate: 10, repeat: 1 });
  face.setApplied(true);
  expect(face.animating).toBe(true);
  face.update(0.1);
  expect(world(bones[2]!).z).not.toBeCloseTo(0.05, 4);
  face.update(0.1);
  expect(face.animating).toBe(false);
  face.dispose();
});
