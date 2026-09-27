import { expect, test } from "bun:test";
import * as THREE from "three";
import { BODY_SUBJECT, bodyCameraDistance, CAMERA_DISTANCE_RANGE, HEAD_SUBJECT, SURFACE_CLEARANCE, type Subject } from "../src/camera-framing";
import { createOrbitLimits, SceneOrbitControls } from "../src/platform/scene/orbit-limits";

/**
 * The scene host's orbit limits over the real OrbitControls (no DOM: the controls' programmatic dolly runs the same `update` as the
 * wheel; `dollyIn(s)` multiplies the distance by `s`, `dollyOut(s)` divides it). The head is a 9 cm sphere about the head's centre; its surface lies 9 cm in front of a target at the centre.
 */
function rig(options: { body?: boolean; aspect?: number; fov?: number } = {}) {
  const camera = new THREE.PerspectiveCamera(options.fov ?? 15, options.aspect ?? .75, .01, 1000);
  const centre = new THREE.Vector3(...HEAD_SUBJECT.centre);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.09, 48, 24), new THREE.MeshBasicMaterial());
  head.position.copy(centre);
  const scene = new THREE.Scene().add(head);
  camera.position.copy(centre).add(new THREE.Vector3(0, 0, -.6));
  const controls = new SceneOrbitControls(camera, null);
  controls.target.copy(centre);
  const state = { body: options.body ?? false, measures: 0, pending: [] as (() => void)[] };
  const limits = createOrbitLimits({ camera, controls,
    subjects: (): Subject[] => state.body ? [HEAD_SUBJECT, BODY_SUBJECT] : [HEAD_SUBJECT],
    framing: (fov, aspect) => state.body ? [bodyCameraDistance(fov, aspect)] : [],
    surfaces: () => [head], surfaceBounds: () => HEAD_SUBJECT,
    updateWorld: () => { state.measures++; scene.updateMatrixWorld(true); },
    timers: { set: callback => { state.pending.push(callback); return state.pending.length; }, clear: () => { state.pending.length = 0; } } });
  controls.update();
  const distance = () => camera.position.distanceTo(controls.target);
  return { camera, controls, limits, state, distance };
}

test("the wheel's dolly reaches the whole body at 15° in a 3:4 pane, and no farther than the scene needs", () => {
  const { controls, distance, limits } = rig({ body: true });
  controls.dollyOut(.001);
  expect(distance()).toBeGreaterThan(bodyCameraDistance(15, .75));
  expect(distance()).toBeCloseTo(limits.limits().max, 9);
  expect(distance()).toBeLessThan(CAMERA_DISTANCE_RANGE.max);
});

test("the range follows the pane's aspect and the body, and never pulls the camera in", () => {
  const { camera, controls, state, distance } = rig({ body: true });
  controls.dollyOut(.001);
  const wide = distance();
  // A taller pane needs more distance for the same lens.
  camera.aspect = .4; camera.updateProjectionMatrix();
  controls.dollyOut(.001);
  expect(distance()).toBeGreaterThan(wide);
  const tall = distance();
  // The body turns off: the camera stays, but can't go farther out, and once in it stays within the head's range.
  state.body = false;
  controls.update();
  expect(distance()).toBeCloseTo(tall, 9);
  controls.dollyOut(.5);
  expect(distance()).toBeCloseTo(tall, 9);
  controls.dollyIn(.001);
  controls.dollyOut(.001);
  expect(distance()).toBeLessThan(tall);
});

test("the closest orbit stops in front of the head's surface, measured once per orbit line and only within reach", () => {
  const { controls, state, distance, limits } = rig({ fov: 30 });
  // From out of reach, one huge step stops at the edge of reach unmeasured; the next measures and stops at the surface.
  controls.dispatchEvent({ type: "start" });
  controls.dollyIn(.001);
  controls.dispatchEvent({ type: "end" });
  expect(state.measures).toBe(0);
  expect(distance()).toBeCloseTo(1.5 * (.3 + SURFACE_CLEARANCE), 9);
  controls.dispatchEvent({ type: "start" });
  controls.dollyIn(.001);
  controls.dispatchEvent({ type: "end" });
  expect(distance()).toBeCloseTo(.09 + SURFACE_CLEARANCE, 3);
  expect(state.measures).toBe(1);
  // Another wheel step on the same line measures nothing.
  controls.dispatchEvent({ type: "start" }); controls.dollyIn(.5); controls.dispatchEvent({ type: "end" });
  expect(state.measures).toBe(1);
  // Far from the head nothing is measured, even on a new line.
  controls.dollyOut(.001);
  controls.target.x += .002; controls.update();
  const before = state.measures;
  controls.dispatchEvent({ type: "start" }); controls.dollyIn(.99); controls.dispatchEvent({ type: "end" });
  expect(state.measures).toBe(before);
  expect(limits.limits().max).toBeGreaterThan(distance() - 1e-9);
});

test("the surface on a new orbit line is measured once the camera rests, so the next zoom needn't", () => {
  const { camera, controls, state } = rig({ fov: 30 });
  camera.position.set(controls.target.x + .1, controls.target.y, controls.target.z - .3); controls.update();
  expect(state.pending.length).toBeGreaterThan(0);
  state.pending.splice(0).forEach(callback => callback());
  const measured = state.measures;
  expect(measured).toBe(1);
  controls.dispatchEvent({ type: "start" }); controls.dollyIn(.9); controls.dispatchEvent({ type: "end" });
  expect(state.measures).toBe(measured);
});

test("disposing releases the hook and the listeners", () => {
  const { controls, limits, state } = rig();
  limits.dispose();
  expect(controls.beforeUpdate).toBeUndefined();
  controls.dispatchEvent({ type: "start" });
  expect(state.measures).toBe(0);
});

test("a lens change from far measures the surface, so widening the lens isn't stopped at the edge of reach", () => {
  const { camera, controls, limits, state } = rig({ fov: 10 });
  camera.position.set(controls.target.x, controls.target.y, controls.target.z - 1.95); controls.update();
  expect(state.measures).toBe(0);
  expect(limits.limits().min).toBeGreaterThan(.4);
  expect(limits.limits(90).min).toBeCloseTo(.09 + SURFACE_CLEARANCE, 3);
  expect(state.measures).toBe(1);
});
