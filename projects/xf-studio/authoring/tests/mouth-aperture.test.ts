// The lips' aperture (mouth-aperture.ts) and the scene's sampler (platform/scene/mouth-aperture-sampler.ts), PREV-147 step A: joints chosen by
// the facial setup's regions alone on a synthetic face; on the game's own face (a private, game-derived fixture written by experiment 034's
// check_aperture.ts, skipped where it isn't) the creator idle's breaths read 2.75 and 2.91 mm, as experiment 034 measured by joint name.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { FACE_REST_KEY, JOINT_REGION, lipParting, mouthAperture, mouthLipJoints, posedParting, type FaceRest } from "../src/mouth-aperture";
import { createMouthApertureSampler, headBones } from "../src/platform/scene/mouth-aperture-sampler";
import { faceMotionScene } from "../src/game-blink";
import { FACE_BAKE_VERSION, motionRest } from "../src/facial-host";

const { mouth, jaw, none } = JOINT_REGION;
/**
 * A small face in glTF axes (y up, facing −z), deliberately named nothing like the game's: a root, a head, a jaw under the head, and
 * around the mouth rings of joints above and below the lip line, outer lip joints on both sides, an inside joint hanging off each outer one
 * (which sits a little higher than its parent, as the game's upper inside joints do), and a corner out to the side.
 */
const JOINTS: [name: string, parent: string | null, position: [number, number, number], region: number][] = [
  ["root", null, [0, 0, 0], none],
  ["skull", "root", [0, 1.60, 0], none],
  ["chin_hinge", "skull", [0, 1.676, 0.006], jaw],
  ["ring_top_a", "skull", [-0.005, 1.638, -0.072], mouth], ["ring_top_b", "skull", [0.005, 1.638, -0.072], mouth],
  ["upper_a", "skull", [-0.005, 1.6275, -0.0714], mouth], ["upper_b", "skull", [0.004, 1.6272, -0.0716], mouth],
  ["upper_in_a", "upper_a", [-0.004, 1.6276, -0.065], mouth], ["upper_in_b", "upper_b", [0.004, 1.6273, -0.065], mouth],
  ["lower_a", "chin_hinge", [-0.005, 1.6203, -0.0693], mouth], ["lower_b", "chin_hinge", [0.004, 1.6197, -0.0695], mouth],
  ["lower_in_a", "lower_a", [-0.004, 1.6222, -0.064], mouth], ["lower_in_b", "lower_b", [0.004, 1.622, -0.064], mouth],
  ["ring_low_a", "chin_hinge", [-0.006, 1.6137, -0.0634], mouth], ["ring_low_b", "chin_hinge", [0.006, 1.6132, -0.0638], mouth],
  ["corner_a", "skull", [-0.028, 1.620, -0.050], mouth], ["corner_b", "skull", [0.028, 1.620, -0.050], mouth],
];
/** The rest as the host's record holds it: locals (translation from the parent, identity rotation, unit scale), parents first. */
function syntheticRest(): { rest: FaceRest; regions: number[] } {
  const names = JOINTS.map(j => j[0]), local = new Float32Array(JOINTS.length * 10);
  const parents = JOINTS.map(j => j[1] === null ? -1 : names.indexOf(j[1]));
  JOINTS.forEach(([, parent, p], i) => {
    const from = parent === null ? [0, 0, 0] : JOINTS[names.indexOf(parent)]![2];
    local.set([p[0] - from[0], p[1] - from[1], p[2] - from[2], 0, 0, 0, 1, 1, 1, 1], i * 10);
  });
  return { rest: { names, parents, local }, regions: JOINTS.map(j => j[3]) };
}
/** The rest with the jaw turned down by `degrees` about the head's side axis and the upper lip raised by `lift` metres. */
function posed(rest: FaceRest, degrees: number, lift = 0): FaceRest {
  const local = Float32Array.from(rest.local), jawAt = rest.names.indexOf("chin_hinge"), upper = ["upper_a", "upper_b"].map(n => rest.names.indexOf(n));
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), degrees * Math.PI / 180);
  local.set([q.x, q.y, q.z, q.w], jawAt * 10 + 3);
  for (const j of upper) local[j * 10 + 1] = local[j * 10 + 1]! + lift;
  return { ...rest, local };
}

describe("the lips' aperture (mouth-aperture.ts)", () => {
  test("the lip joints come from the regions, the jaw's ancestry and the rest heights, never from names", () => {
    const { rest, regions } = syntheticRest();
    const lips = mouthLipJoints(rest, regions)!;
    expect([...lips.upper].sort()).toEqual(["upper_a", "upper_b"]);
    expect([...lips.lower].sort()).toEqual(["lower_a", "lower_b"]);
    expect(lips.frame).toBe("skull");
    expect(lips.up[1]).toBeCloseTo(1, 9);
    // The rest parting is the lips' own thickness at rest (about 7.3 mm here), not a gap.
    expect(lips.rest).toBeCloseTo(((1.6275 + 1.6272) - (1.6203 + 1.6197)) / 2, 6);
    // Without a mouth region, or regions that don't fit the rest, there is nothing to measure.
    expect(mouthLipJoints(rest, regions.map(r => r === mouth ? none : r))).toBeNull();
    expect(mouthLipJoints(rest, regions.slice(1))).toBeNull();
    // Without a jaw region nothing rides on the jaw, so there is no lower lip.
    expect(mouthLipJoints(rest, regions.map(r => r === jaw ? none : r))).toBeNull();
  });

  test("0 at rest, the jaw and a raised upper lip open it, never negative", () => {
    const { rest, regions } = syntheticRest();
    const lips = mouthLipJoints(rest, regions)!;
    expect(mouthAperture(posedParting(rest, lips), lips.rest)).toBe(0);
    // Turning the jaw down (negative about +x tips a point in front of the hinge, at −z, down) lowers the lower lip; lifting the upper adds.
    const open = mouthAperture(posedParting(posed(rest, -2), lips), lips.rest);
    expect(open).toBeGreaterThan(0.002);
    expect(mouthAperture(posedParting(posed(rest, -2, 0.001), lips), lips.rest)).toBeCloseTo(open + 0.001, 6);
    // Pressing the lips together reads as closed, not negative.
    expect(mouthAperture(posedParting(posed(rest, 2), lips), lips.rest)).toBe(0);
    expect(mouthAperture(Number.NaN, 0)).toBe(0);
    expect(lipParting([[0, 2, 0]], [[0, 1, 0], [0, 0, 0]], [0, 1, 0])).toBeCloseTo(1.5, 9);
  });

  test("the scene's sampler measures the head's posed bones in the head's frame, whatever moves the whole head", () => {
    const { rest, regions } = syntheticRest();
    const record = { names: rest.names, parents: rest.parents, local: Buffer.from(new Float32Array(rest.local).buffer).toString("base64"), regions };
    const faceScene = faceMotionScene(record);
    expect(faceScene.userData[FACE_REST_KEY].regions).toEqual(regions);
    // The drawn head: its own copy of the skeleton, turned and moved as a whole (the body's idle moves the head).
    const head = faceMotionScene({ names: rest.names, parents: rest.parents, local: record.local });
    const world = new THREE.Group(); world.add(head); world.rotation.y = 0.7; world.position.set(0.3, -0.1, 0.2); world.updateMatrixWorld(true);
    const bones: THREE.Object3D[] = []; head.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o); });
    let sources: (THREE.Object3D | null)[] = [null];
    const sampler = createMouthApertureSampler(() => bones, () => sources);
    // No record with regions yet: nothing to measure.
    expect(sampler.sample()).toBeNull();
    sources = [null, faceScene];
    expect(sampler.sample()).toBeCloseTo(0, 9);
    expect(sampler.lips?.frame).toBe("skull");
    const hinge = head.getObjectByName("chin_hinge")!;
    hinge.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -2 * Math.PI / 180);
    const expected = mouthAperture(posedParting(posed(rest, -2), sampler.lips!), sampler.lips!.rest);
    expect(sampler.sample()).toBeCloseTo(expected, 6);
    // A record without regions (an older host) is skipped.
    const older = faceMotionScene({ names: rest.names, parents: rest.parents, local: record.local });
    expect(older.userData[FACE_REST_KEY].regions).toBeUndefined();
    expect(createMouthApertureSampler(() => bones, () => [older]).sample()).toBeNull();
    // Another head's skeleton (none of these joints): refused, null.
    expect(createMouthApertureSampler(() => [new THREE.Bone()], () => [faceScene]).sample()).toBeNull();
    // A skinned head gives its skeleton's bones.
    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    skinned.bind(new THREE.Skeleton(bones as THREE.Bone[]));
    expect(headBones(skinned)).toHaveLength(bones.length);
  });
});

test("the host's face records carry the setup's regions where they fit the rest; the idle face cache's version moved with them", () => {
  const { rest, regions } = syntheticRest();
  const baked = { names: rest.names, parents: rest.parents, local: Float32Array.from(rest.local) };
  expect(motionRest(baked, regions).regions).toEqual(regions);
  expect(motionRest(baked).regions).toBeUndefined();
  expect(motionRest(baked, regions.slice(1)).regions).toBeUndefined();
  // Cached idle faces baked before the regions joined the record are baked again (the version is part of their key).
  expect(FACE_BAKE_VERSION).toBe(2);
});

// Game-derived (private): experiment 034's check_aperture.ts writes it from the installed game.
const FIXTURE = new URL("../data/private-fixtures/mouth-aperture.json", import.meta.url);
test.skipIf(!existsSync(FIXTURE))("on the game's player face the regions pick the midline lip joints, and the idle's breaths read 2.75 and 2.91 mm", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { rest: { names: string[]; parents: number[]; local: number[] }; regions: number[];
    frames: Record<string, number[]> };
  const rest: FaceRest = { names: fixture.rest.names, parents: fixture.rest.parents, local: Float32Array.from(fixture.rest.local) };
  const lips = mouthLipJoints(rest, fixture.regions)!;
  expect([...lips.upper].sort()).toEqual(["l_J_mug_lip_up_0_JNT", "r_J_mug_lip_up_0_JNT"]);
  expect([...lips.lower].sort()).toEqual(["l_J_mug_lip_dn_0_JNT", "r_J_mug_lip_dn_0_JNT"]);
  expect(lips.frame).toBe("Head");
  const at = (t: string) => mouthAperture(posedParting({ ...rest, local: Float32Array.from(fixture.frames[t]!) }, lips), lips.rest) * 1000;
  expect(at("0")).toBeCloseTo(0, 2);
  expect(Math.abs(at("2.4") - 2.75)).toBeLessThan(0.1);
  expect(Math.abs(at("14.4") - 2.91)).toBeLessThan(0.1);
});
