import { test, expect } from "bun:test";
import * as THREE from "three";
import { IdleAnimation } from "../src/idle-animation";

test("facial movement composes before head rotation, with its own clock and exact restore", () => {
  const body = new THREE.Group(), head = new THREE.Bone(); head.name="Head";body.add(head);
  const facial = new THREE.Group(), faceHead = new THREE.Bone(), lip = new THREE.Bone();
  faceHead.name="Head";lip.name="lip";lip.position.x=1;faceHead.add(lip);facial.add(faceHead);
  const preview = new THREE.Group(), target = new THREE.Bone(); target.name="lip";target.position.x=1;
  preview.add(target);preview.updateMatrixWorld(true);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
  const bodyClip = new THREE.AnimationClip("body",.4,[new THREE.QuaternionKeyframeTrack("Head.quaternion",[0,.4],[...turn.toArray(),...turn.toArray()])]);
  const faceClip = new THREE.AnimationClip("face",2,[new THREE.VectorKeyframeTrack("lip.position",[0,1,2],[1,0,0,2,0,0,1,0,0])]);
  const idle = new IdleAnimation(body,bodyClip,[target],{lip:"Head"},{source:facial,clip:faceClip});
  idle.setEnabled(true);
  for(let i=0;i<7;i++) idle.update(.1);
  expect(target.position.x).toBeCloseTo(0,6);
  expect(target.position.y).toBeCloseTo(1.7,6); // Face does not reset at body's .4s loop.
  idle.seek(4.7); // Restore a workspace well beyond either loop's first cycle.
  expect(idle.time).toBe(4.7);
  expect(target.position.y).toBeCloseTo(1.7,6);
  idle.setEnabled(false);
  expect(target.position.toArray()).toEqual([1,0,0]);
  expect(target.quaternion.toArray()).toEqual([0,0,0,1]);
});

test("decoded motion follows inherited drivers, carries unskinned eyes and restores exactly", () => {
  const source = new THREE.Group(), driver = new THREE.Bone();
  driver.name = "Head"; driver.position.set(0,2,0); source.add(driver);
  const target = new THREE.Group(), lid = new THREE.Bone(), eyes = new THREE.Object3D();
  lid.name = "lid"; lid.position.set(1,2,0); eyes.name = "eyes"; eyes.position.set(0,2,1);
  target.add(lid,eyes); target.updateMatrixWorld(true);
  const clip = new THREE.AnimationClip("idle",2,[new THREE.VectorKeyframeTrack("Head.position",[0,1,2],[0,2,0, 0,3,0, 0,2,0])]);
  const idle = new IdleAnimation(source,clip,[lid,eyes],{lid:"Head",eyes:"Head"});
  expect(idle.unmapped).toEqual([]);
  const original = [lid.position.clone(),eyes.position.clone()];
  idle.setEnabled(true);
  for(let i=0;i<5;i++) idle.update(.1);
  expect(lid.position.y).toBeCloseTo(2.5,6);
  expect(eyes.position.y).toBeCloseTo(2.5,6);
  expect(lid.position.x).toBe(1);
  idle.setEnabled(false);
  expect(lid.position.toArray()).toEqual(original[0].toArray());
  expect(eyes.position.toArray()).toEqual(original[1].toArray());
  idle.update(.1);
  expect(lid.position.toArray()).toEqual(original[0].toArray());
  idle.setEnabled(true);
  expect(idle.time).toBe(0);
});

test("nested target bones receive a world transform once, and unmapped controls are reported", () => {
  const source = new THREE.Group(), driver = new THREE.Bone(); driver.name="Head"; source.add(driver);
  const target = new THREE.Group(), parent = new THREE.Bone(), child = new THREE.Bone(), unknown = new THREE.Bone();
  parent.name="face";child.name="lid";unknown.name="unknown";
  parent.position.x=2;child.position.x=1;parent.add(child);target.add(parent,unknown);target.updateMatrixWorld(true);
  const clip = new THREE.AnimationClip("idle",2,[new THREE.VectorKeyframeTrack("Head.position",[0,1,2],[0,0,0,0,1,0,0,0,0])]);
  const idle = new IdleAnimation(source,clip,[child,parent,unknown],{face:"Head",lid:"face"});
  expect(idle.unmapped).toEqual(["unknown"]);idle.setEnabled(true);idle.update(.1);
  expect(child.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(.1,6);
  expect(child.position.y).toBeCloseTo(0,6);
  expect(child.getWorldPosition(new THREE.Vector3()).x).toBeCloseTo(3,6);
});

// The body turns around the origin; facial tracks independently translate named
// children. This supplies an analytic expectation rather than another copy of
// the adapter's matrix-composition algorithm.
function contributionFixture() {
  const body = new THREE.Group(), driver = new THREE.Bone();
  driver.name = "Head"; body.add(driver);
  const face = new THREE.Group(), faceHead = new THREE.Bone();
  faceHead.name = "Head"; face.add(faceHead);
  const offsets = { jaw: [.15, -.08, .12], eye: [.01, .04, -.02], lid: [0, -.1, .03] } as const;
  const locals = { jaw: [.6, -.2, .3], eye: [.2, .4, .1], lid: [.2, .43, .1] } as const;
  const faceTracks: THREE.KeyframeTrack[] = [];
  for (const name of ["jaw", "eye", "lid"] as const) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.fromArray(locals[name]); faceHead.add(bone);
    faceTracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, [0, 1.5, 3], [
      ...locals[name], ...locals[name].map((v, i) => v + offsets[name][i]!), ...locals[name],
    ]));
  }
  const quarterTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const clip = new THREE.AnimationClip("body", 2, [new THREE.QuaternionKeyframeTrack("Head.quaternion",
    [0, 1, 2], [0, 0, 0, 1, ...quarterTurn.toArray(), 0, 0, 0, 1])]);
  const faceClip = new THREE.AnimationClip("face", 3, faceTracks);
  const preview = new THREE.Group(), targets: THREE.Bone[] = [];
  for (let duplicate = 0; duplicate < 2; duplicate++) {
    const head = new THREE.Bone(); head.name = "Head";
    head.position.set(.3, .7, -.2); head.rotation.z = .11; head.scale.setScalar(1.2);
    preview.add(head);
    for (const name of ["jaw", "eye", "lid"] as const) {
      const bone = new THREE.Bone(); bone.name = name; bone.position.fromArray(locals[name]);
      bone.rotation.z = -.07; bone.scale.setScalar(.8); head.add(bone); targets.push(bone);
    }
    // Deliberately provide children before parents, with duplicate names in the
    // two target rigs, as happens with independent head/detail skeletons.
    targets.push(head);
  }
  preview.updateMatrixWorld(true);
  const originals = targets.map(bone => ({
    position: bone.position.toArray(), rotation: bone.quaternion.toArray(), scale: bone.scale.toArray(),
    world: bone.getWorldPosition(new THREE.Vector3()).toArray(),
  }));
  const idle = new IdleAnimation(body, clip, targets, { jaw: "Head", eye: "Head", lid: "Head" }, { source: face, clip: faceClip });
  return { idle, targets, originals, offsets };
}

function expectCloseVector(actual: readonly number[], expected: readonly number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
}

test("all body/facial subsets match independent transforms across separate loops and duplicate rigs", () => {
  const { idle, targets, originals, offsets } = contributionFixture();
  expect(idle.bodyEnabled).toBe(true); expect(idle.faceEnabled).toBe(true); expect(idle.paused).toBe(false);
  idle.setEnabled(true); idle.seek(4.75); idle.setPaused(true);
  for (const [body, face] of [[true, true], [false, true], [true, false], [false, false], [true, true]] as const) {
    idle.setContributions({ body, face });
    expect(idle.time).toBe(4.75); expect(idle.paused).toBe(true);
    const angle = body ? .75 * Math.PI / 2 : 0;
    for (const [i, bone] of targets.entries()) {
      const initial = originals[i]!.world;
      const movement = bone.name === "Head" || !face ? [0, 0, 0] : offsets[bone.name as keyof typeof offsets];
      const x = initial[0]! + movement[0]! * (5 / 6), y = initial[1]! + movement[1]! * (5 / 6);
      expectCloseVector(bone.getWorldPosition(new THREE.Vector3()).toArray(), [
        x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle),
        initial[2]! + movement[2]! * (5 / 6),
      ]);
      const expectedRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle + (bone.name === "Head" ? .11 : .04));
      expectCloseVector(bone.getWorldQuaternion(new THREE.Quaternion()).toArray(), expectedRotation.toArray());
    }
    for (let i = 0; i < 4; i++) expectCloseVector(targets[i]!.matrixWorld.elements, targets[i + 4]!.matrixWorld.elements);
  }
  idle.setContributions({ body: false });
  expect(idle.faceEnabled).toBe(true);
  const structural = targets.filter(bone => bone.name === "Head").map(bone => bone.matrixWorld.clone());
  const features = targets.filter(bone => bone.name !== "Head").map(bone => bone.matrixWorld.clone());
  idle.seek(5.2);
  targets.filter(bone => bone.name === "Head").forEach((bone, i) => expectCloseVector(bone.matrixWorld.elements, structural[i]!.elements));
  targets.filter(bone => bone.name !== "Head").forEach((bone, i) => expect(bone.matrixWorld.equals(features[i]!)).toBe(false));
});

test("pause holds pose and phase, seek still applies, and resume matches direct sampling", () => {
  const { idle, targets } = contributionFixture();
  const reference = contributionFixture();
  idle.setEnabled(true); reference.idle.setEnabled(true);
  idle.seek(5.95); idle.setPaused(true);
  const held = targets.map(bone => bone.matrixWorld.toArray());
  for (const dt of [.016, .1, 10, Infinity, NaN, -.1]) idle.update(dt);
  expect(idle.time).toBe(5.95);
  targets.forEach((bone, i) => expect(bone.matrixWorld.toArray()).toEqual(held[i]!));
  idle.seek(11.975); reference.idle.seek(11.975);
  expect(idle.paused).toBe(true);
  targets.forEach((bone, i) => expectCloseVector(bone.matrixWorld.elements, reference.targets[i]!.matrixWorld.elements));
  idle.setEnabled(true); // Redundant enable from UI restoration must not restart.
  expect(idle.time).toBe(11.975); expect(idle.paused).toBe(true);
  // Cross both loop boundaries together when resuming.
  idle.setPaused(false); idle.update(.075); reference.idle.seek(12.05);
  expect(idle.time).toBeCloseTo(12.05, 12);
  targets.forEach((bone, i) => expectCloseVector(bone.matrixWorld.elements, reference.targets[i]!.matrixWorld.elements));
});

test("disabling restores exact captured locals, resets pause/clock and retains selected contributions", () => {
  for (const [body, face] of [[true, true], [false, true], [true, false], [false, false]] as const) {
    const { idle, targets, originals } = contributionFixture();
    idle.setEnabled(true); idle.seek(4.75); idle.setPaused(true); idle.setContributions({ body, face });
    idle.setEnabled(false);
    expect(idle.time).toBe(0); expect(idle.paused).toBe(false);
    expect(idle.bodyEnabled).toBe(body); expect(idle.faceEnabled).toBe(face);
    for (const [i, bone] of targets.entries()) {
      expect(bone.position.toArray()).toEqual(originals[i]!.position);
      expect(bone.quaternion.toArray()).toEqual(originals[i]!.rotation);
      expect(bone.scale.toArray()).toEqual(originals[i]!.scale);
    }
    idle.setPaused(true); idle.update(10); idle.setEnabled(false);
    expect(idle.paused).toBe(false); expect(idle.time).toBe(0);
    idle.setEnabled(true);
    expect(idle.time).toBe(0); expect(idle.paused).toBe(false);
    expect(idle.bodyEnabled).toBe(body); expect(idle.faceEnabled).toBe(face);
  }
});

test("clock rejects nonfinite/negative increments and caps suspension catch-up at one tenth second", () => {
  const { idle } = contributionFixture();
  idle.setEnabled(true); idle.seek(3.5);
  for (const dt of [NaN, Infinity, -Infinity, -1]) idle.update(dt);
  expect(idle.time).toBe(3.5);
  idle.update(10); expect(idle.time).toBe(3.6);
  idle.setContributions({ body: false, face: false });
  idle.update(.05); expect(idle.time).toBe(3.65);
  idle.seek(NaN); expect(idle.time).toBe(0);
  idle.seek(-1); expect(idle.time).toBe(0);
});

test("a flat helper joint of a driven skeleton follows the rig segment it sits on; a still bone and a lone bone stay unbound", () => {
  // The clip's rig: an arm and its forearm, the arm turning a quarter about z at t = 1.
  const source = new THREE.Group(), arm = new THREE.Bone(), fore = new THREE.Bone();
  arm.name = "Arm"; fore.name = "ForeArm"; arm.position.set(0.2, 1.4, 0); fore.position.set(0, -0.3, 0); arm.add(fore); source.add(arm);
  const quarter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).toArray();
  const clip = new THREE.AnimationClip("idle", 2, [new THREE.QuaternionKeyframeTrack("Arm.quaternion", [0, 1, 2], [0, 0, 0, 1, ...quarter, 0, 0, 0, 1])]);
  // The body's export: every joint flat under its armature, a helper joint on the arm with no joint parent, and a rigid part's still bone.
  const armature = new THREE.Group(), joint = (name: string, x: number, y: number, z: number) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z); armature.add(bone); return bone; };
  const tArm = joint("Arm", 0.2, 1.4, 0), tFore = joint("ForeArm", 0.2, 1.1, 0), helper = joint("l_twist_JNT", 0.2, 1.25, 0.02);
  const still = joint("xfs_rigid_part", 0.2, 1.25, 0); still.userData.xfsStill = true;
  const lone = new THREE.Bone(); lone.name = "lone_JNT"; lone.position.set(0.2, 1.25, 0); new THREE.Group().add(lone);
  armature.updateMatrixWorld(true); lone.parent!.updateMatrixWorld(true);
  const idle = new IdleAnimation(source, clip, [tArm, tFore, helper, still, lone], {});
  expect(idle.unmapped.sort()).toEqual(["lone_JNT", "xfs_rigid_part"]);
  expect(idle.bindings.find(binding => binding.bone === helper)!.driver).toBe(arm);
  idle.setEnabled(true); idle.seek(1); armature.updateMatrixWorld(true);
  // Around the arm's pivot a quarter turn: (0, −0.15, 0.02) from it becomes (0.15, 0, 0.02).
  const at = helper.getWorldPosition(new THREE.Vector3());
  expect(at.x).toBeCloseTo(0.35, 5); expect(at.y).toBeCloseTo(1.4, 5); expect(at.z).toBeCloseTo(0.02, 5);
  expect(still.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0.2, 1.25, 0]);
});
