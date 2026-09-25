import { expect, test } from "bun:test";
import * as THREE from "three";
import { activeEyeShape, GAME_BLINK_SCHEMA, GameBlink, parseGameBlink, type GameBlinkDescription } from "../src/game-blink";
import { MotionActions, type MotionPort } from "../src/motion-actions";
import { freshWorkspace } from "../src/workspace-state";

/**
 * A miniature facial rig shaped like the game's: the upper lid row hangs under a lid root at the eye centre and the lash
 * joint under the row, while the preview's skeletons are flat (every bone directly under its mesh's root, world-oriented).
 */
const CENTRE = new THREE.Vector3(0, 1, 0);
const ROW = new THREE.Vector3(0, 0.01, -0.012), LASH = new THREE.Vector3(0, 0, -0.002), LOWER = new THREE.Vector3(0, -0.01, -0.012);
/** The lid root's full closure: the upper row swings onto the lower row. */
const CLOSED = new THREE.Quaternion().setFromUnitVectors(ROW.clone().normalize(), LOWER.clone().normalize());
const SHIFT = new THREE.Vector3(0.002, -0.001, 0.0005);

function rig() {
  const source = new THREE.Group();
  const face = Object.assign(new THREE.Bone(), { name: "face_root_JNT" });
  const root = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_up_root_1_JNT" }); root.position.copy(CENTRE);
  const row = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_up_rowA_1_JNT" }); row.position.copy(ROW);
  const lash = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_lashes_up_rowA_1_JNT" }); lash.position.copy(LASH);
  const eye = Object.assign(new THREE.Bone(), { name: "l_J_eye_JNT" }); eye.position.copy(CENTRE);
  const lower = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_dn_rowA_1_JNT" }); lower.position.copy(CENTRE).add(LOWER);
  source.add(face); face.add(root, eye, lower); root.add(row); row.add(lash);
  const identity = [0, 0, 0, 1];
  // As the bake writes them: local rest composed with the solved delta; the root is the only moving joint here.
  const closure = new THREE.AnimationClip("eye_blink_closure", 1, [
    new THREE.QuaternionKeyframeTrack(`${root.name}.quaternion`, [0, 1], [...identity, ...CLOSED.toArray()]),
    new THREE.VectorKeyframeTrack(`${root.name}.position`, [0, 1], [...CENTRE.toArray(), ...CENTRE.toArray()])]);
  const clip = new THREE.AnimationClip("additive__blink_normal__01", .5, [
    new THREE.QuaternionKeyframeTrack(`${root.name}.quaternion`, [0, .1, .5], [...identity, ...CLOSED.toArray(), ...identity])]);
  const bind = (at: THREE.Vector3) => [...at.toArray(), 0, 0, 0, 1] as [number, number, number, number, number, number, number];
  const description: GameBlinkDescription = { schema: GAME_BLINK_SCHEMA,
    closure: { animation: closure.name, tracks: ["eye_l_blink", "eye_r_blink"], steps: 1 },
    clip: { animation: clip.name, source: "base\\animations\\facial\\generic\\interactive_scene\\generic_facial_additives.anims", duration: .5, sampleRate: 60 },
    shapes: { h091: { "l_J_eye_JNT": bind(CENTRE.clone().add(SHIFT)), "l_J_eye_lid_up_root_1_JNT": bind(CENTRE.clone().add(SHIFT)) } } };
  return { source, description, closure, clip };
}
/** Flat preview bones at the rig's world rest, like the exported head and a detail's own skeleton copy. */
function flat(names: [string, THREE.Vector3][]) {
  const root = new THREE.Group();
  const bones = names.map(([name, at]) => { const bone = Object.assign(new THREE.Bone(), { name }); bone.position.copy(at); root.add(bone); return bone; });
  root.updateMatrixWorld(true);
  return { root, bones };
}
const rowRest = CENTRE.clone().add(ROW), lashRest = rowRest.clone().add(LASH);
function setup() {
  const { source, description, closure, clip } = rig();
  const head = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest], ["l_J_eye_lid_dn_rowA_1_JNT", CENTRE.clone().add(LOWER)], ["unrelated_bone", new THREE.Vector3(1, 1, 1)]]);
  const blink = new GameBlink(source, parseGameBlink(description, [closure, clip]), head.bones);
  return { blink, head, description, closure, clip };
}
const world = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
/** A two-vertex skinned mesh bound whole to `bone` (for checking that skinned vertices, not just bones, follow). */
function skinnedPoint(bone: THREE.Bone, at: THREE.Vector3) {
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([...at.toArray(), ...at.toArray()], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  bone.parent!.add(mesh); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]), new THREE.Matrix4());
  return mesh;
}

test("the prepared blink parses, and damaged or foreign data is refused in plain words", () => {
  const { description, closure, clip } = rig();
  const parsed = parseGameBlink(description, [clip, closure]);
  expect(parsed.closure.name).toBe("eye_blink_closure");
  expect(parsed.clip.duration).toBe(.5);
  expect(parsed.description.shapes?.h091?.["l_J_eye_JNT"]).toHaveLength(7);
  expect(() => parseGameBlink({ ...description, schema: "xfs/game-blink-0" }, [clip, closure])).toThrow("another version");
  expect(() => parseGameBlink(undefined, [clip, closure])).toThrow("another version");
  expect(() => parseGameBlink(description, [clip])).toThrow("missing its closure");
  expect(() => parseGameBlink(description, [closure])).toThrow("missing its clip");
  const half = new THREE.AnimationClip(closure.name, .5, [new THREE.QuaternionKeyframeTrack("x.quaternion", [0, .5], [0, 0, 0, 1, 0, 0, 0, 1])]);
  expect(() => parseGameBlink(description, [half, clip])).toThrow("doesn't run from open to closed");
  const broken = new THREE.AnimationClip(clip.name, .5, [new THREE.VectorKeyframeTrack("x.position", [0, .5], [0, NaN, 0, 0, 0, 0])]);
  expect(() => parseGameBlink(description, [closure, broken])).toThrow("invalid numbers");
  expect(() => parseGameBlink({ ...description, shapes: { h091: { eye: [0, 0, 0] } } }, [closure, clip])).toThrow("eye shapes are damaged");
  expect(() => parseGameBlink({ ...description, shapes: { h091: { eye: [0, 0, 0, 0, 0, 0, 2] } } }, [closure, clip])).toThrow("eye shapes are damaged");
});

test("the solved closure turns the upper lid about the eye centre until it meets the lower lid", () => {
  const { blink, head } = setup();
  const [row, lower, unrelated] = head.bones as [THREE.Bone, THREE.Bone, THREE.Bone];
  expect(blink.unmapped).toEqual(["unrelated_bone"]);
  const gap = () => world(row).distanceTo(world(lower));
  const open = gap();
  blink.setClosure(.5);
  expect(world(row).distanceTo(CENTRE)).toBeCloseTo(ROW.length(), 9); // a turn about the eye centre, not a slide
  expect(gap()).toBeLessThan(open);
  blink.setClosure(1);
  expect(gap()).toBeLessThan(1e-9);
  expect(world(unrelated).toArray()).toEqual([1, 1, 1]);
  // The retired study slid the row straight down by a fixed distance: it never turned about the eye, so at 100% the
  // row passed the lower lid (the reported intersections). The solved pose stops on it.
  expect(open).toBeGreaterThan(0.019);
});

test("lashes and brows on a detail's own skeleton follow the lid they hang from, vertices included", () => {
  const { blink, head } = setup();
  const [row] = head.bones as [THREE.Bone];
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  const [lash] = detail.bones as [THREE.Bone];
  const lashPoint = lashRest.clone().add(new THREE.Vector3(0, 0.001, -0.004)), lidPoint = rowRest.clone();
  const lashMesh = skinnedPoint(lash, lashPoint), lidMesh = skinnedPoint(row, lidPoint);
  blink.setClosure(1);
  // A detail loaded while the lids are closed binds in its neutral pose and closes at once (attach before any idle pose).
  blink.attach(detail.bones);
  const expected = (point: THREE.Vector3) => point.clone().sub(CENTRE).applyQuaternion(CLOSED).add(CENTRE);
  const vertex = (mesh: THREE.SkinnedMesh) => mesh.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  expect(vertex(lashMesh).distanceTo(expected(lashPoint))).toBeLessThan(1e-6); // float32 vertices
  expect(vertex(lidMesh).distanceTo(expected(lidPoint))).toBeLessThan(1e-6);
  // The lash keeps its place on the lid: same offset from the lid vertex, turned with it.
  const offset = vertex(lashMesh).sub(vertex(lidMesh));
  expect(offset.length()).toBeCloseTo(lashPoint.clone().sub(lidPoint).length(), 6);
  expect(vertex(lashMesh).distanceTo(lashPoint)).toBeGreaterThan(0.01);
  blink.detach(detail.bones);
  expect(lash.position.toArray()).toEqual(lashRest.toArray());
});

test("no invalid numbers across the closure, the played clip and eye shapes", () => {
  const { blink, head } = setup();
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  blink.attach(detail.bones);
  const finite = () => [...head.bones, ...detail.bones].every(bone => bone.matrixWorld.elements.every(Number.isFinite));
  for (const shape of [null, "h091", "not-baked"]) {
    blink.setShape(shape);
    for (let value = 0; value <= 1.0001; value += .05) { blink.setClosure(value); expect(finite()).toBe(true); }
    blink.setPlaying(true);
    for (let t = 0; t < 3; t += 1 / 30) { blink.update(1 / 30); expect(finite()).toBe(true); }
    blink.setPlaying(false);
  }
  blink.setClosure(NaN);
  expect(blink.closure).toBe(0);
  blink.setClosure(4);
  expect(blink.closure).toBe(1);
  expect(finite()).toBe(true);
});

test("an eye shape's joint binds move the lid's pivot with the eye; the base or an unknown shape keeps the base pivot", () => {
  const { blink, head } = setup();
  const [row] = head.bones as [THREE.Bone];
  blink.setClosure(1);
  const base = world(row);
  blink.setShape("h091");
  expect(blink.shape).toBe("h091");
  const pivot = CENTRE.clone().add(SHIFT);
  const expected = rowRest.clone().sub(pivot).applyQuaternion(CLOSED).add(pivot);
  expect(world(row).distanceTo(expected)).toBeLessThan(1e-9);
  expect(world(row).distanceTo(base)).toBeGreaterThan(1e-4);
  blink.setShape("not-baked");
  expect(blink.shape).toBe(null);
  expect(world(row).distanceTo(base)).toBeLessThan(1e-12);
  expect(activeEyeShape({ morphTargetDictionary: { h011_eyes: 0, h091_eyes: 1, h012_nose: 2 }, morphTargetInfluences: [0, 1, 1] })).toBe("h091");
  expect(activeEyeShape({ morphTargetDictionary: { h011_eyes: 0 }, morphTargetInfluences: [0] })).toBe(null);
  expect(activeEyeShape({})).toBe(null);
});

test("opening the lids, stopping Play blink and reset restore the captured pose exactly", () => {
  const { blink, head } = setup();
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  blink.attach(detail.bones);
  const bones = [...head.bones, ...detail.bones];
  const captured = bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);
  const current = () => bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);
  blink.setShape("h091");
  blink.setClosure(.6);
  expect(current()).not.toEqual(captured);
  blink.setClosure(0);
  expect(current()).toEqual(captured);
  blink.setPlaying(true); blink.update(.08);
  expect(current()).not.toEqual(captured);
  blink.setPlaying(false);
  expect(current()).toEqual(captured);
  blink.setClosure(.9); blink.reset();
  expect(current()).toEqual(captured);
  expect([blink.closure, blink.playing]).toEqual([0, false]);
  blink.setShape(null); blink.setClosure(.3); blink.setClosure(0);
  expect(current()).toEqual(captured);
});

test("Play blink follows the clip's timing, holds its last frame between blinks and repeats", () => {
  const { blink, head } = setup();
  const [row, lower] = head.bones as [THREE.Bone, THREE.Bone];
  blink.setPlaying(true);
  expect(blink.playing).toBe(true);
  blink.update(.1);
  expect(world(row).distanceTo(world(lower))).toBeLessThan(1e-9); // the clip closes fully at 0.1 s
  blink.update(.1); blink.update(.1); blink.update(.1); blink.update(.1);
  expect(world(row).distanceTo(rowRest)).toBeLessThan(1e-9); // open again at 0.5 s
  for (let i = 0; i < 20; i++) blink.update(.1); // clamped steps: 2.5 s in, a new cycle has started
  expect(blink.time).toBeCloseTo(2.5 - blink.repeatSeconds, 6);
  blink.update(1); // a long stall advances at most 0.1 s
  expect(blink.time).toBeCloseTo(2.6 - blink.repeatSeconds, 6);
});

test("everything but playback asks the viewport for a frame", () => {
  const { blink } = setup();
  let frames = 0;
  blink.onChange = () => frames++;
  blink.setClosure(.4); expect(frames).toBe(1);
  blink.setPlaying(true); expect(frames).toBe(2);
  blink.update(.05); expect(frames).toBe(2); // the scheduler's `animating` covers playback frames
  blink.setShape("h091"); expect(frames).toBe(3);
  blink.setShape("h091"); expect(frames).toBe(3); // unchanged shape: nothing to draw
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  blink.attach(detail.bones); expect(frames).toBe(4);
  blink.detach(detail.bones); expect(frames).toBe(5);
  blink.reset(); expect(frames).toBe(6);
});

test("blink commands say plainly why they are off: not prepared, or the idle is playing", () => {
  const noop = () => {};
  const port = (blink: MotionPort["blink"], enabled = false): MotionPort => ({ available: true, blink,
    idle: { enabled, time: 0, paused: false, bodyEnabled: true, faceEnabled: true, seek: noop },
    setIdle: noop, setIdlePaused: noop, setIdleContributions: noop, setBlink: noop, animateBlink: noop });
  const missing = new MotionActions(freshWorkspace().preview, port({ available: false, error: "The game's blink hasn't been prepared on this computer yet." }));
  expect(missing.capability({ kind: "motion.setBlink", value: .5 })).toMatchObject({ available: false, code: "asset_unavailable",
    reason: "The game's blink hasn't been prepared on this computer yet." });
  expect(missing.capability({ kind: "motion.playBlink", playing: true }).available).toBe(false);
  expect(missing.snapshot()).toMatchObject({ blinkAvailable: false });
  const idle = new MotionActions(freshWorkspace().preview, port({ available: true }, true));
  expect(idle.capability({ kind: "motion.setBlink", value: .5 })).toMatchObject({ available: false, reason: "Blink is off while the game idle plays: the idle blinks on its own." });
  const ready = new MotionActions(freshWorkspace().preview, port({ available: true }));
  expect(ready.capability({ kind: "motion.setBlink", value: .5 }).available).toBe(true);
  // A saved closure is not replayed onto a scene without the blink.
  const saved = { ...freshWorkspace().preview, blink: .7, blinkPlaying: true };
  const restoring = new MotionActions(saved, port({ available: false }));
  restoring.restore();
  expect(restoring.snapshot()).toMatchObject({ blink: 0, blinkPlaying: false });
});

test("the scene draws blink changes on demand and keeps its blink out of the idle's way", async () => {
  const source = await Bun.file(new URL("../src/scene.ts", import.meta.url)).text();
  // Slider and Play blink go through the scene's invalidating wrapper; playback keeps the scheduler animating.
  const wrapped = source.slice(source.indexOf('return { ...api, ...invalidating(api, ['));
  for (const name of ['"setBlink"', '"animateBlink"', '"eyeShape"', '"applySavedV"', '"setCharacterDetails"']) expect(wrapped).toContain(name);
  expect(source).toContain("animating: () => idle?.enabled ? !idle.paused : !!blink?.playing,");
  expect(source).toContain("if (blink) { const blinking = blink; blinking.onChange = invalidate;");
  // The blink captures a detail's neutral pose before a playing idle poses it, and the idle takes over from an open, stopped blink.
  expect(source.indexOf("blink?.attach(drawnDetails()")).toBeLessThan(source.indexOf("idle?.attach(drawnDetails()"));
  const setIdle = source.slice(source.indexOf("    setIdle: (enabled: boolean) => {"), source.indexOf("    setIdlePaused:"));
  expect(setIdle.indexOf("blink?.reset();")).toBeLessThan(setIdle.indexOf("idle.setEnabled(enabled);"));
  // No synthetic eyelid pose remains.
  expect(source).not.toMatch(/eye_lid_\(\?:lashes_\)\?/);
});
