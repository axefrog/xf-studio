import { expect, test } from "bun:test";
import * as THREE from "three";
import { frontCameraDistance, MAX_CAMERA_DISTANCE, surfaceAnchoredDistance } from "../src/camera-framing";
import { previewClipPlanes } from "../src/camera-depth";

test("surface plane keeps its off-centre projection through lens changes", () => {
  for (const aspect of [320 / 660, 504 / 660, 16 / 9])
    for (const [oldFov, newFov] of [[30, 10], [10, 30], [60, 90], [90, 60]]) {
      const target = new THREE.Vector3(.04, 1.7, .02);
      const oldPosition = new THREE.Vector3(.11, 1.75, -.65);
      const direction = oldPosition.clone().sub(target).normalize();
      const forward = direction.clone().negate();
      const anchor = oldPosition.clone().addScaledVector(forward, .45);
      const frame = surfaceAnchoredDistance(oldPosition.toArray(), target.toArray(), anchor.toArray(), oldFov, newFov);
      expect(frame.limited).toBe(false);
      const newDistance = frame.distance;
      const newPosition = target.clone().addScaledVector(direction, newDistance);
      const makeCamera = (fov: number, position: THREE.Vector3) => {
        const camera = new THREE.PerspectiveCamera(fov, aspect, .001, 10);
        camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true);
        return camera;
      };
      const before = makeCamera(oldFov, oldPosition), after = makeCamera(newFov, newPosition);
      const right = new THREE.Vector3(1, 0, 0).addScaledVector(forward, -forward.x).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      for (const x of [-.03, 0, .03]) for (const y of [-.025, 0, .025]) {
        const point = anchor.clone().addScaledVector(right, x).addScaledVector(up, y);
        const a = point.clone().project(before), b = point.clone().project(after);
        expect(Math.abs(a.x - b.x)).toBeLessThan(1e-12);
        expect(Math.abs(a.y - b.y)).toBeLessThan(1e-12);
      }
    }
});

test("narrow Front view fits within the supported orbit and retains a precise near plane", () => {
  const distance = frontCameraDistance(10, 320 / 660);
  expect(distance).toBeGreaterThan(3);
  expect(distance).toBeLessThan(MAX_CAMERA_DISTANCE);
  const clip = previewClipPlanes(distance, distance);
  expect(clip.near).toBeGreaterThan(2);
  expect(clip.near).toBeLessThan(distance - 1e-3);
  expect(clip.far).toBeGreaterThan(distance + 1);
});

test("lens changes report both orbit and surface-clearance limits", () => {
  const far = surfaceAnchoredDistance([0, 1.67, -.55], [0, 1.67, .005],
    [0, 1.67, -.09], 90, 10);
  expect(far.distance).toBe(MAX_CAMERA_DISTANCE);
  expect(far.limited).toBe(true);
  const close = surfaceAnchoredDistance([0, 1.67, -.1], [0, 1.67, 0],
    [0, 1.67, -.095], 10, 90);
  expect(close.limited).toBe(true);
  expect(close.distance).toBeCloseTo(.105, 10);
});
