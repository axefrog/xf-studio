import { expect, test } from "bun:test";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCameraSettle } from "../src/platform/scene/camera-settle";
import { createRenderScheduler } from "../src/render-scheduler";

/** A manual frame clock: `step()` runs the pending animation frame, like one display refresh. */
function manualClock() {
  let pending: (() => void) | undefined, handle = 0, time = 0;
  return {
    clock: { request(callback: () => void) { pending = callback; return ++handle; }, cancel() { pending = undefined; }, now: () => time },
    step(ms = 16) { time += ms; const run = pending; pending = undefined; run?.(); return !!run; },
    drain(limit = 2000) { let n = 0; while (n < limit && this.step()) n++; return n; },
  };
}

/** The scene host's wiring, without a renderer: damped orbit controls at the closest framing, `change` requesting frames. */
function viewport(withSettle: boolean) {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  camera.position.set(0, 1.67, -0.25);
  const controls = new OrbitControls(camera);
  controls.target.set(0, 1.67, 0.005);
  controls.enableDamping = true;
  controls.update();
  const settle = createCameraSettle(camera, controls.target);
  const clock = manualClock();
  const scheduler = createRenderScheduler({ clock: clock.clock, animating: () => withSettle && settle.settling,
    frame() { controls.update(); settle.step(); } });
  controls.addEventListener("change", () => scheduler.invalidate());
  return { camera, controls, clock, scheduler };
}

/** Where a released damped orbit ends up: every remaining step played out. */
function restingAzimuth(controls: OrbitControls) {
  for (let i = 0; i < 2000; i++) controls.update();
  return controls.getAzimuthalAngle();
}

test("a small damped orbit keeps drawing until it settles, with no pointer event after the release", () => {
  const { controls, clock, scheduler } = viewport(true);
  // A small drag released: the controls hold the rest of the turn and play it out through their damping.
  controls.rotateLeft(0.01);
  scheduler.invalidate();
  const frames = clock.drain();
  expect(scheduler.running).toBe(false);
  const settled = controls.getAzimuthalAngle();
  // Nothing visible is left for a later, unrelated frame to play: under a hundredth of a millimetre of camera travel.
  expect(Math.abs(restingAzimuth(controls) - settled) * controls.getDistance()).toBeLessThan(1e-5);
  expect(frames).toBeGreaterThan(10);
  expect(frames).toBeLessThan(1000);
});

test("without watching the camera the loop stopped early: the controls' change threshold left visible motion for the next frame", () => {
  const { controls, clock, scheduler } = viewport(false);
  controls.rotateLeft(0.01);
  scheduler.invalidate();
  clock.drain();
  expect(scheduler.running).toBe(false);
  const stopped = controls.getAzimuthalAngle();
  // The symptom: the next unrelated frame (the pointer over a panel) moves the camera on.
  expect(Math.abs(restingAzimuth(controls) - stopped) * controls.getDistance()).toBeGreaterThan(1e-3);
});

test("a still camera stops the loop after the frame that was asked for", () => {
  const { clock, scheduler } = viewport(true);
  scheduler.invalidate();
  expect(clock.drain()).toBe(1);
  expect(scheduler.running).toBe(false);
});

test("a camera two views share settles for both: each view's loop reads the one camera's settle", () => {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
  camera.position.set(0, 1.67, -0.25);
  const controls = new OrbitControls(camera);
  controls.target.set(0, 1.67, 0.005);
  controls.enableDamping = true;
  controls.update();
  const settle = createCameraSettle(camera, controls.target);
  const clock = manualClock();
  const drawn = { a: 0, b: 0 };
  // One loop draws every view that shows the camera; both follow its settle.
  const scheduler = createRenderScheduler({ clock: clock.clock, animating: () => settle.settling,
    frame() { controls.update(); settle.step(); drawn.a++; drawn.b++; } });
  controls.addEventListener("change", () => scheduler.invalidate());
  controls.rotateLeft(0.01);
  scheduler.invalidate();
  clock.drain();
  expect(drawn.a).toBe(drawn.b);
  expect(Math.abs(restingAzimuth(controls) - controls.getAzimuthalAngle()) * controls.getDistance()).toBeLessThan(1e-5);
});
