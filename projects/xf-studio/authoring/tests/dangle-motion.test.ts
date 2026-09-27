import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { IdleAnimation } from "../src/idle-animation";
import { DANGLE_SPEC, type DangleSpec, type Transform } from "../src/dangle-spec";
import { DANGLE_FRAME } from "../src/dangle-motion";
import { composePreviewMotion } from "../src/preview-motion";

// A V in glTF space (Y up) and a hair part whose dangle rig is in the game's (Z up): game (x, y, z) = glTF (x, −z, y).
const gl = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
/** V's joints: Root → Spine3 → Neck → Neck1 → Head, and the shoulders under Spine3 (game positions). */
const V_JOINTS: [string, string | null, [number, number, number]][] = [["Root", null, [0, 0, 0]], ["Spine3", "Root", [0, 0, 1.35]],
  ["LeftShoulder", "Spine3", [0.08, 0, 1.4]], ["RightShoulder", "Spine3", [-0.08, 0, 1.4]], ["Neck", "Spine3", [0, 0, 1.5]], ["Neck1", "Neck", [0, 0, 1.55]], ["Head", "Neck1", [0, 0, 1.6]]];
/** A strand of three chain joints hanging from Head, behind it and 6 cm apart, ending near the right shoulder (where nearest-segment binding went wrong). */
const CHAIN: [string, [number, number, number]][] = [["dyng_a_01", [-0.02, 0.08, 1.62]], ["dyng_a_02", [-0.04, 0.09, 1.56]], ["dyng_a_03", [-0.06, 0.09, 1.50]]];

function source(turn: number) {
  const root = new THREE.Group(), bones = new Map<string, THREE.Bone>();
  for (const [name, parent, at] of V_JOINTS) {
    const bone = new THREE.Bone(); bone.name = name;
    const p = gl(...at), parentAt = parent ? gl(...V_JOINTS.find(j => j[0] === parent)![2]) : new THREE.Vector3();
    bone.position.copy(p.sub(parentAt));
    (parent ? bones.get(parent)! : root).add(bone);
    bones.set(name, bone);
  }
  // The head turns about the vertical by `turn` radians and back over 2 s.
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  const clip = new THREE.AnimationClip("idle", 2, [new THREE.QuaternionKeyframeTrack("Head.quaternion", [0, 1, 2], [...q0.toArray(), ...q1.toArray(), ...q0.toArray()])]);
  return { root, clip };
}
/** The hair part's exported skeleton: every joint flat under its armature, as WolvenKit exports it. */
function hairBones() {
  const armature = new THREE.Group(), bones: THREE.Bone[] = [];
  for (const [name, , at] of V_JOINTS.filter(j => ["Neck1", "Head"].includes(j[0]))) { const b = new THREE.Bone(); b.name = name; b.position.copy(gl(...at)); armature.add(b); bones.push(b); }
  for (const [name, at] of CHAIN) { const b = new THREE.Bone(); b.name = name; b.position.copy(gl(...at)); armature.add(b); bones.push(b); }
  armature.updateMatrixWorld(true);
  return { armature, bones };
}
const at = (p: [number, number, number]): Transform => [p[0], p[1], p[2], 0, 0, 0, 1];
/** The part's dangle spec: the base joints and the chain from its rig; with a simulation unless `rigid`. */
function hairSpec(rigid = false): DangleSpec {
  const names = [...V_JOINTS.map(j => j[0]), ...CHAIN.map(c => c[0])];
  const positions = [...V_JOINTS.map(j => j[2]), ...CHAIN.map(c => c[1])];
  const parents = [...V_JOINTS.map(j => j[1] ? names.indexOf(j[1]) : -1), names.indexOf("Head"), names.indexOf("dyng_a_01"), names.indexOf("dyng_a_02")];
  const joints = names.map((name, i) => ({ name, parent: parents[i]!,
    local: at(parents[i]! < 0 ? positions[i]! : positions[i]!.map((v, k) => v - positions[parents[i]!]![k]!) as [number, number, number]) }));
  const chain = CHAIN.map(c => names.indexOf(c[0]));
  return { schema: DANGLE_SPEC, rig: "hair_dangle.rig", graph: "hair_dangle.animgraph", joints, reference: positions.map(at), notes: [],
    simulation: rigid ? null : { substepTime: 0.01, iterations: 1, alpha: 1, lookAt: true, gravity: 9.81, externalForce: [0, 0, 0], externalLinked: false,
      particles: chain.map((joint, i) => ({ joint, free: i > 0, mass: 0.4, damping: 1, pull: 0, radius: 0, height: 0, axis: [0.5, 0, 0], projection: "shortest" as const })),
      constraints: [{ kind: "link", a: 0, b: 1, type: "fixed", lower: 100, upper: 100, lookAt: [1, 0, 0] }, { kind: "link", a: 1, b: 2, type: "fixed", lower: 100, upper: 100, lookAt: [1, 0, 0] }],
      shapes: [{ joint: names.indexOf("RightShoulder"), frame: at([0, 0, 0]), radius: 0.03, extents: [0, 0, 0] }] } };
}
function setup(options: { turn?: number; rigid?: boolean; dangles?: boolean } = {}) {
  const { root, clip } = source(options.turn ?? Math.PI / 2);
  const hair = hairBones();
  const idle = new IdleAnimation(root, clip, [], {});
  if (options.dangles !== false) idle.setDangles([{ key: "hair:0", spec: hairSpec(options.rigid), bones: hair.bones }]);
  idle.attach(hair.bones);
  const bone = (name: string) => hair.bones.find(b => b.name === name)!;
  const world = (name: string) => { hair.armature.updateMatrixWorld(true); return bone(name).getWorldPosition(new THREE.Vector3()); };
  return { idle, hair, bone, world };
}

describe("P1: each dangle chain follows its own rig parent (PREV-110)", () => {
  test("without its dangle rig a flat-exported chain joint binds to the nearest body segment, and a head turn shears the strand", () => {
    const { idle, world } = setup({ dangles: false });
    idle.setEnabled(true);
    idle.seek(1); // Head turned 90°
    // The strand's tip sits by the right shoulder's segment, so it doesn't turn with the head.
    expect(world("dyng_a_03").distanceTo(gl(-0.06, 0.09, 1.50))).toBeLessThan(1e-9);
    expect(world("dyng_a_01").distanceTo(gl(-0.06, 0.09, 1.50))).toBeGreaterThan(0.05);
  });

  test("with it, the whole chain turns with Head as one rigid piece", () => {
    const { idle, world } = setup({ rigid: true });
    idle.setEnabled(true);
    idle.seek(1);
    // A 90° turn about the vertical through Head: game (x, y) → (−y, x) about Head's axis.
    for (const [name, p] of CHAIN) {
      const expected = gl(-p[1], p[0], p[2]);
      expect(world(name).distanceTo(expected)).toBeLessThan(1e-6);
    }
    idle.setEnabled(false);
    for (const [name, p] of CHAIN) expect(world(name).distanceTo(gl(...p))).toBeLessThan(1e-12);
  });
});

describe("P3: the simulation on the motion clock", () => {
  test("is off by default; on, the chain falls from its rigid shape and its root stays on the head", () => {
    const { idle, world } = setup();
    idle.setEnabled(true);
    idle.update(0.5);
    const rigid = world("dyng_a_03").clone();
    idle.setPhysics(true);
    expect(idle.physicsEnabled).toBe(true);
    idle.update(0.1);
    // The tip hangs lower than its authored place; the fixed root joint sits where the head puts it.
    expect(world("dyng_a_03").y).toBeLessThan(rigid.y - 0.005);
    idle.setPhysics(false);
    idle.update(0);
    expect(world("dyng_a_03").distanceTo(rigid)).toBeLessThan(0.05);
  });

  test("gives the same state at a motion time whatever the display's frame rate", () => {
    const run = (fps: number) => {
      const { idle, world } = setup();
      idle.setPhysics(true);
      idle.setEnabled(true);
      for (let i = 0; i < Math.round(1.5 * fps); i++) idle.update(1 / fps);
      return CHAIN.map(([name]) => world(name).toArray());
    };
    const sixty = run(60);
    expect(run(144)).toEqual(sixty);
    expect(run(30)).toEqual(sixty);
  });

  test("seeking re-simulates from the loop's start: the same state as playing there", () => {
    const played = (() => {
      const { idle, world } = setup(); idle.setPhysics(true); idle.setEnabled(true);
      for (let i = 0; i < 90; i++) idle.update(1 / 60);
      return CHAIN.map(([name]) => world(name).toArray());
    })();
    const { idle, world } = setup(); idle.setPhysics(true); idle.setEnabled(true);
    idle.seek(90 * DANGLE_FRAME);
    const sought = CHAIN.map(([name]) => world(name).toArray());
    sought.forEach((p, i) => p.forEach((v, k) => expect(Math.abs(v - played[i]![k]!)).toBeLessThan(1e-9)));
  });

  test("with the idle off, physics settles the strand on V's bind pose; off again, it is back at its authored shape", () => {
    const { idle, world } = setup();
    idle.setPhysics(true);
    expect(world("dyng_a_03").y).toBeLessThan(gl(-0.06, 0.09, 1.50).y - 0.005);
    idle.setPhysics(false);
    for (const [name, p] of CHAIN) expect(world(name).distanceTo(gl(...p))).toBeLessThan(1e-12);
  });

  test("pausing the idle freezes the hair where it is; the display stops drawing; a paused seek shows the motion at that time", () => {
    const { idle, world } = setup();
    const motion = composePreviewMotion(idle, undefined);
    idle.setPhysics(true);
    motion.setIdle(true);
    for (let i = 0; i < 18; i++) motion.advance(1 / 60);
    const moving = world("dyng_a_03").clone();
    idle.setPaused(true);
    expect(world("dyng_a_03").toArray()).toEqual(moving.toArray());
    expect(motion.animating()).toBe(false);
    motion.advance(0.5);
    expect(world("dyng_a_03").toArray()).toEqual(moving.toArray());
    idle.seek(0.5);
    idle.seek(18 * DANGLE_FRAME);
    expect(world("dyng_a_03").distanceTo(moving)).toBeLessThan(1e-9);
  });

  test("a graph the solver doesn't run hangs rigid with physics on", () => {
    const { idle, world } = setup({ rigid: true });
    idle.setPhysics(true);
    idle.setEnabled(true);
    idle.seek(1);
    expect(idle.simulatedDangles).toBe(false);
    const [name, p] = CHAIN[2]!;
    expect(world(name).distanceTo(gl(-p[1], p[0], p[2]))).toBeLessThan(1e-6);
  });
});
