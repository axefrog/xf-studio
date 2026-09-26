import { expect, test } from "bun:test";
import * as THREE from "three";
import { BLINK_REPEAT_SECONDS, GAME_BLINK_DAMAGED, GAME_BLINK_MISSING, GAME_BLINK_NO_JOINTS, GAME_BLINK_OTHER_HEAD, GAME_BLINK_SCHEMA,
  GameBlink, loadGameBlink, parseGameBlink, type BlinkTimer, type GameBlinkDescription } from "../src/game-blink";
import { IdleAnimation } from "../src/idle-animation";
import { MotionActions, type MotionPort } from "../src/motion-actions";
import { composePreviewMotion } from "../src/preview-motion";
import { createRenderScheduler } from "../src/render-scheduler";
import { blinkNoteLine } from "../src/studio-ui/panels/preview";
import { freshWorkspace } from "../src/workspace-state";

/**
 * The idle and the blink composed as the scene composes them (preview-motion.ts), on a miniature rig shaped like the
 * game's: an upper lid row under a lid root at the eye centre, flat preview bones at the rig's world rest, a body rig
 * whose `Head` the idle moves, a render scheduler on a fake clock and a fake timer for Play blink's wake-up.
 */
const CENTRE = new THREE.Vector3(0, 1, 0);
const ROW = new THREE.Vector3(0, 0.01, -0.012), LASH = new THREE.Vector3(0, 0, -0.002), LOWER = new THREE.Vector3(0, -0.01, -0.012);
const CLOSED = new THREE.Quaternion().setFromUnitVectors(ROW.clone().normalize(), LOWER.clone().normalize());
const SHIFT = new THREE.Vector3(0.002, -0.001, 0.0005);
const rowRest = CENTRE.clone().add(ROW), lashRest = rowRest.clone().add(LASH);
const bind = (at: THREE.Vector3) => [...at.toArray(), 0, 0, 0, 1] as [number, number, number, number, number, number, number];

function rig() {
  const source = new THREE.Group();
  const face = Object.assign(new THREE.Bone(), { name: "face_root_JNT" });
  const root = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_up_root_1_JNT" }); root.position.copy(CENTRE);
  const row = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_up_rowA_1_JNT" }); row.position.copy(ROW);
  const lash = Object.assign(new THREE.Bone(), { name: "l_J_eye_lid_lashes_up_rowA_1_JNT" }); lash.position.copy(LASH);
  const eye = Object.assign(new THREE.Bone(), { name: "l_J_eye_JNT" }); eye.position.copy(CENTRE);
  source.add(face); face.add(root, eye); root.add(row); row.add(lash);
  const identity = [0, 0, 0, 1];
  const closure = new THREE.AnimationClip("eye_blink_closure", 1, [
    new THREE.QuaternionKeyframeTrack(`${root.name}.quaternion`, [0, 1], [...identity, ...CLOSED.toArray()])]);
  const clip = new THREE.AnimationClip("additive__blink_normal__01", .5, [
    new THREE.QuaternionKeyframeTrack(`${root.name}.quaternion`, [0, .1, .5], [...identity, ...CLOSED.toArray(), ...identity])]);
  const description: GameBlinkDescription = { schema: GAME_BLINK_SCHEMA,
    closure: { animation: closure.name, tracks: ["eye_l_blink", "eye_r_blink"], steps: 1 },
    clip: { animation: clip.name, source: "generic_facial_additives.anims", duration: .5, sampleRate: 60 },
    shapes: { h091: { "l_J_eye_JNT": bind(CENTRE.clone().add(SHIFT)), "l_J_eye_lid_up_root_1_JNT": bind(CENTRE.clone().add(SHIFT)) },
              h011: { "l_J_eye_JNT": bind(CENTRE.clone().sub(SHIFT)), "l_J_eye_lid_up_root_1_JNT": bind(CENTRE.clone().sub(SHIFT)) } },
    rig: { skeleton: "h0_000_pwa_c__basehead_skeleton.rig", setup: "h0_000_pwa_c__basehead_rigsetup.facialsetup", bodyGender: "female" } };
  return { source, description, closure, clip };
}
function flat(names: [string, THREE.Vector3][]) {
  const root = new THREE.Group();
  const bones = names.map(([name, at]) => { const bone = Object.assign(new THREE.Bone(), { name }); bone.position.copy(at); root.add(bone); return bone; });
  root.updateMatrixWorld(true);
  return { root, bones };
}
const pose = (bones: readonly THREE.Object3D[]) => bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);
const maxDifference = (a: number[][], b: number[][]) => Math.max(0, ...a.flatMap((row, i) => row.map((value, j) => Math.abs(value - b[i]![j]!))));
const world = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());

/** A clock for the render scheduler and a timer for the blink, both advanced by `run`. */
function fakeTime() {
  let now = 0, nextHandle = 1;
  const frames = new Map<number, () => void>(), timers = new Map<number, { at: number; callback: () => void }>();
  const clock = { request: (callback: () => void) => { const handle = nextHandle++; frames.set(handle, callback); return handle; },
    cancel: (handle: number) => { frames.delete(handle); }, now: () => now };
  const timer: BlinkTimer = { set: (callback, milliseconds) => { const handle = nextHandle++; timers.set(handle, { at: now + milliseconds, callback }); return handle; },
    clear: handle => { timers.delete(handle as number); } };
  return { clock, timer, timers,
    /** Advance `seconds` at 60 Hz: fire due timers, then draw the requested frame (if any). */
    run(seconds: number) {
      for (let step = 0; step < Math.round(seconds * 60); step++) {
        now += 1000 / 60;
        for (const [handle, entry] of [...timers]) if (entry.at <= now) { timers.delete(handle); entry.callback(); }
        const pending = [...frames];
        frames.clear();
        for (const [, callback] of pending) callback();
      }
    } };
}

/** The scene double: head bones, the idle on a body rig, the blink, their composition and a render-on-demand loop. */
function sceneDouble() {
  const { source, description, closure, clip } = rig();
  const head = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest], ["l_J_eye_JNT", CENTRE.clone()]]);
  const body = new THREE.Group(), driver = Object.assign(new THREE.Bone(), { name: "Head" }); body.add(driver);
  const idleClip = new THREE.AnimationClip("idle", 2, [new THREE.VectorKeyframeTrack("Head.position", [0, 1, 2], [0, 0, 0, .05, 0, 0, 0, 0, 0])]);
  const ancestry = { "l_J_eye_lid_up_rowA_1_JNT": "Head", "l_J_eye_JNT": "Head", "l_J_eye_lid_lashes_up_rowA_1_JNT": "Head" };
  const idle = new IdleAnimation(body, idleClip, head.bones, ancestry);
  const time = fakeTime();
  const blink = new GameBlink(source, parseGameBlink(description, [closure, clip]), head.bones, undefined, time.timer);
  const motion = composePreviewMotion(idle, blink);
  let frames = 0;
  const scheduler = createRenderScheduler({ clock: time.clock, animating: motion.animating, frame: dt => { frames++; motion.advance(dt); } });
  const disconnect = motion.connect(() => scheduler.invalidate());
  return { head, idle, blink, motion, scheduler, time, disconnect, frames: () => frames };
}

test("an eye-shape change under a paused idle keeps the idle's pose and re-seats the blink for later (PREV-80)", () => {
  const scene = sceneDouble();
  scene.motion.setIdle(true);
  scene.time.run(.5);
  scene.idle.setPaused(true);
  const posed = pose(scene.head.bones);
  expect(world(scene.head.bones[0]!).x).toBeGreaterThan(.01); // the idle moved the head
  scene.blink.setShape("h091");
  expect(maxDifference(posed, pose(scene.head.bones))).toBe(0);
  scene.blink.setShape(null);
  expect(maxDifference(posed, pose(scene.head.bones))).toBe(0);
  // A detail joining under the paused idle takes its pose, not the blink's editing pose.
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  scene.motion.attach(detail.bones);
  expect(maxDifference(posed, pose(scene.head.bones))).toBe(0);
  // Back to the blink: the seat taken under the idle applies when the lids close.
  scene.motion.setIdle(false);
  scene.blink.setShape("h091");
  scene.blink.setClosure(1);
  const pivot = CENTRE.clone().add(SHIFT);
  expect(world(scene.head.bones[0]!).distanceTo(rowRest.clone().sub(pivot).applyQuaternion(CLOSED).add(pivot))).toBeLessThan(1e-9);
});

test("the idle takes over from an open, stopped blink and hands back the editing pose", () => {
  const scene = sceneDouble();
  const neutral = pose(scene.head.bones);
  scene.blink.setClosure(.8);
  expect(scene.motion.setIdle(true)).toBe(true);
  expect([scene.blink.closure, scene.blink.playing]).toEqual([0, false]);
  expect(scene.motion.setIdle(true)).toBe(false);
  scene.time.run(.3);
  expect(maxDifference(neutral, pose(scene.head.bones))).toBeGreaterThan(1e-3);
  scene.motion.setIdle(false);
  expect(maxDifference(neutral, pose(scene.head.bones))).toBe(0);
  // A detail joins the blink first, so a playing idle can't be captured as its neutral pose.
  scene.motion.setIdle(true); scene.time.run(.4);
  const detail = flat([["l_J_eye_lid_lashes_up_rowA_1_JNT", lashRest]]);
  scene.motion.attach(detail.bones);
  scene.motion.setIdle(false);
  expect(world(detail.bones[0]!).distanceTo(lashRest)).toBeLessThan(1e-12);
  scene.blink.setClosure(1);
  expect(world(detail.bones[0]!).distanceTo(lashRest.clone().sub(CENTRE).applyQuaternion(CLOSED).add(CENTRE))).toBeLessThan(1e-9);
  scene.motion.detach(detail.bones);
  expect(scene.blink.bindings.map(b => b.bone)).not.toContain(detail.bones[0]);
});

test("Play blink draws only while its clip plays and wakes once for each next blink (PREV-81)", () => {
  const scene = sceneDouble();
  scene.blink.setPlaying(true);
  scene.time.run(.6);
  // The 0.5 s clip at 60 Hz, plus the frame that shows its last pose; then the loop stops.
  const firstBlink = scene.frames();
  expect(firstBlink).toBeGreaterThanOrEqual(30);
  expect(firstBlink).toBeLessThanOrEqual(33);
  expect(scene.blink.animating).toBe(false);
  expect(scene.blink.playing).toBe(true);
  expect(scene.scheduler.running).toBe(false);
  expect(scene.time.timers.size).toBe(1);
  scene.time.run(1.7); // held between blinks: nothing drawn
  expect(scene.frames()).toBe(firstBlink);
  scene.time.run(.3); // past 2.45 s: the wake-up starts the next blink
  expect(scene.blink.animating).toBe(true);
  expect(scene.frames()).toBeGreaterThan(firstBlink + 5);
  expect(scene.time.timers.size).toBe(0);
  scene.time.run(2.45 * 4);
  // Six cycles cost about six clips' frames, where drawing the held pose too would cost the whole 14.7 s.
  expect(scene.frames()).toBeLessThan(6 * 34);
  // Frames drawn for other reasons during the hold advance the cycle; the pending wake-up then only asks for a frame.
  scene.blink.setPlaying(false); scene.blink.setPlaying(true);
  scene.time.run(.6);
  const before = scene.frames();
  let blinked = false;
  for (let i = 0; i < 150; i++) { scene.scheduler.invalidate(); scene.time.run(1 / 60); blinked ||= scene.blink.animating; } // a 2.5 s orbit
  expect(blinked).toBe(true);
  expect(scene.frames() - before).toBe(150);
  expect(scene.time.timers.size).toBeLessThanOrEqual(1);
  // Stopping clears the wake-up; disconnecting disposes it.
  scene.time.run(1);
  expect(scene.time.timers.size).toBe(1);
  scene.blink.setPlaying(false);
  expect(scene.time.timers.size).toBe(0);
  scene.blink.setPlaying(true); scene.time.run(.6);
  scene.disconnect();
  expect(scene.time.timers.size).toBe(0);
  expect(scene.blink.onChange).toBeUndefined();
  expect(BLINK_REPEAT_SECONDS).toBe(scene.blink.repeatSeconds);
});

test("no drift across thousands of scrubs, shape switches and played frames", () => {
  const { source, description, closure, clip } = rig();
  const head = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest], ["unrelated", new THREE.Vector3(0, 1.9, 0)]]);
  const blink = new GameBlink(source, parseGameBlink(description, [closure, clip]), head.bones, undefined, { set: () => 0, clear: () => {} });
  blink.setShape("h091"); blink.setClosure(.3);
  const first = pose(head.bones);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 5000; i++) {
    blink.setClosure(random());
    if (i % 7 === 0) blink.setShape(i % 2 ? "h011" : "h091");
    if (i % 11 === 0) { blink.setPlaying(true); blink.update(.07); }
  }
  blink.setShape("h091"); blink.setClosure(.3);
  expect(maxDifference(first, pose(head.bones))).toBeLessThan(1e-12);
  blink.setClosure(0);
  expect(pose(head.bones)).toEqual(pose(flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest], ["unrelated", new THREE.Vector3(0, 1.9, 0)]]).bones));
});

test("a skeleton whose joints sit elsewhere is refused; details bound millimetres away still follow (PREV-82)", () => {
  const { source, description, closure, clip } = rig();
  const clips = parseGameBlink(description, [closure, clip]);
  // Another body type's head: the same names, the lid row 2 mm lower.
  const other = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest.clone().add(new THREE.Vector3(0, -.002, 0))]]);
  expect(() => new GameBlink(source, clips, other.bones)).toThrow(GAME_BLINK_OTHER_HEAD);
  // Within 0.1 mm (float noise, exporter rounding) is the same head.
  const near = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest.clone().add(new THREE.Vector3(0, .00005, 0))]]);
  const blink = new GameBlink(source, clips, near.bones);
  // Some hair meshes bind these joints millimetres away; they follow the head's rig in world space.
  const hair = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest.clone().add(new THREE.Vector3(.005, 0, 0))]]);
  blink.attach(hair.bones);
  blink.setClosure(1);
  const start = rowRest.clone().add(new THREE.Vector3(.005, 0, 0));
  expect(world(hair.bones[0]!).distanceTo(start.clone().sub(CENTRE).applyQuaternion(CLOSED).add(CENTRE))).toBeLessThan(1e-9);
  expect(() => parseGameBlink({ ...description, rig: { skeleton: "x", setup: "y", bodyGender: "other" } }, [closure, clip])).toThrow("rig description is damaged");
  expect(parseGameBlink({ ...description, rig: undefined }, [closure, clip]).description.rig).toBeUndefined(); // bakes before the rig was recorded
});

/** The miniature rig and its two animations as a GLB, the way the bake writes the local asset. */
function glb(description: unknown = rig().description) {
  const { source, closure, clip } = rig();
  const nodes: { name: string; translation?: number[]; children?: number[] }[] = [], index = new Map<THREE.Object3D, number>();
  source.traverse(node => { if (node === source) return; index.set(node, nodes.length); nodes.push({ name: node.name, translation: node.position.toArray() }); });
  for (const [node, i] of index) if (node.children.length) nodes[i]!.children = node.children.map(child => index.get(child)!);
  const chunks: Float32Array[] = [], accessors: object[] = [], bufferViews: object[] = [];
  let offset = 0;
  const accessor = (values: ArrayLike<number>, type: string, count: number) => {
    const data = Float32Array.from(values);
    chunks.push(data); bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength }); offset += data.byteLength;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count, type,
      ...(type === "SCALAR" ? { min: [Math.min(...data)], max: [Math.max(...data)] } : {}) });
    return accessors.length - 1;
  };
  const animations = [closure, clip].map(animation => {
    const channels: object[] = [], samplers: object[] = [];
    for (const track of animation.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const node = nodes.findIndex(entry => entry.name === parsed.nodeName), quaternion = parsed.propertyName === "quaternion";
      samplers.push({ input: accessor(track.times, "SCALAR", track.times.length),
        output: accessor(track.values, quaternion ? "VEC4" : "VEC3", track.times.length), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path: quaternion ? "rotation" : "translation" } });
    }
    return { name: animation.name, channels, samplers };
  });
  const json = { asset: { version: "2.0", extras: description }, scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i).filter(i => !nodes.some(entry => entry.children?.includes(i))) }],
    nodes, animations, accessors, bufferViews, buffers: [{ byteLength: offset }] };
  let text = new TextEncoder().encode(JSON.stringify(json));
  text = Uint8Array.from([...text, ...new Array((4 - text.length % 4) % 4).fill(0x20)]);
  const bin = new Uint8Array(offset); let at = 0;
  for (const chunk of chunks) { bin.set(new Uint8Array(chunk.buffer), at); at += chunk.byteLength; }
  const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  view.setUint32(20 + text.length, bin.length, true); view.setUint32(24 + text.length, 0x004e4942, true); out.set(bin, 28 + text.length);
  return out;
}

test("damaged, foreign and missing blink assets are refused in plain words (UI-61)", async () => {
  const serve = (body: BodyInit, status = 200) => async () => new Response(body, { status });
  const head = () => flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest]]).bones;
  const good = glb();
  const loaded = await loadGameBlink(head(), serve(good));
  expect(loaded.bindings.length).toBe(1);
  expect(loaded.description.rig?.bodyGender).toBe("female");
  loaded.setClosure(1);
  expect(world(loaded.bindings[0]!.bone).distanceTo(rowRest.clone().sub(CENTRE).applyQuaternion(CLOSED).add(CENTRE))).toBeLessThan(1e-6);
  const cases: [string, () => Promise<Response>, string][] = [
    ["not found", serve("Not found", 404), GAME_BLINK_MISSING],
    ["network failure", async () => { throw Error("offline"); }, GAME_BLINK_MISSING],
    ["an HTML page", serve("<!doctype html><html></html>"), GAME_BLINK_DAMAGED],
    ["random bytes", serve(new Uint8Array(64).map((_, i) => i * 37)), GAME_BLINK_DAMAGED],
    ["a GLB cut in its header", serve(good.slice(0, 20)), GAME_BLINK_DAMAGED],
    ["a GLB cut in its data", serve(good.slice(0, good.length - 16)), GAME_BLINK_DAMAGED],
    ["another version", serve(glb({ schema: "xfs/game-blink-0" })), "another version"],
  ];
  for (const [name, fetcher, message] of cases)
    await expect(loadGameBlink(head(), fetcher), name).rejects.toThrow(message);
  await expect(loadGameBlink([Object.assign(new THREE.Bone(), { name: "not_a_face_bone" })], serve(good))).rejects.toThrow(GAME_BLINK_NO_JOINTS);
  await expect(loadGameBlink(flat([["l_J_eye_lid_up_rowA_1_JNT", new THREE.Vector3(0, 1.5, 0)]]).bones, serve(good))).rejects.toThrow(GAME_BLINK_OTHER_HEAD);
});

test("a saved Closure and Play blink come back on reload; the Motion note says why the blink is off or how often it repeats", () => {
  const { source, description, closure, clip } = rig();
  const head = flat([["l_J_eye_lid_up_rowA_1_JNT", rowRest]]);
  const blink = new GameBlink(source, parseGameBlink(description, [closure, clip]), head.bones, undefined, { set: () => 0, clear: () => {} });
  const noop = () => {};
  const port: MotionPort = { available: false, blink: { available: true, repeatSeconds: blink.repeatSeconds },
    setIdle: noop, setIdlePaused: noop, setIdleContributions: noop,
    setBlink: value => blink.setClosure(value), animateBlink: playing => blink.setPlaying(playing) };
  const held = new MotionActions({ ...freshWorkspace().preview, blink: .7, blinkPlaying: false }, port);
  held.restore();
  expect(held.snapshot()).toMatchObject({ blink: .7, blinkPlaying: false, blinkAvailable: true, blinkRepeatSeconds: 2.45 });
  expect(blink.closure).toBe(.7);
  const at70 = world(head.bones[0]!);
  expect(at70.distanceTo(rowRest)).toBeGreaterThan(.005);
  const playing = new MotionActions({ ...freshWorkspace().preview, blink: .7, blinkPlaying: true }, port);
  playing.restore();
  expect([blink.closure, blink.playing]).toEqual([.7, true]);
  playing.dispatch({ kind: "motion.playBlink", playing: false });
  expect(world(head.bones[0]!).distanceTo(at70)).toBeLessThan(1e-12); // stopping returns to the saved closure
  expect(blinkNoteLine(playing.snapshot())).toContain("repeated every 2.45 s (a Studio choice: the idle's average blink spacing)");
  // Not prepared: the reason comes from one place, whatever the port left out.
  const missing = new MotionActions(freshWorkspace().preview, { ...port, blink: { available: false } });
  expect(missing.snapshot().blinkError).toBe(GAME_BLINK_MISSING);
  expect(missing.capability({ kind: "motion.playBlink", playing: true }).reason).toBe(GAME_BLINK_MISSING);
  expect(blinkNoteLine(missing.snapshot())).toBe(`${GAME_BLINK_MISSING} It is made once from your own game files, like the idle.`);
  const damaged = new MotionActions(freshWorkspace().preview, { ...port, blink: { available: false, error: GAME_BLINK_DAMAGED } });
  expect(damaged.capability({ kind: "motion.setBlink", value: .2 }).reason).toBe(GAME_BLINK_DAMAGED);
});
