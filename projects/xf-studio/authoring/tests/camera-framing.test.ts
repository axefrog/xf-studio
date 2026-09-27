import { expect, test } from "bun:test";
import * as THREE from "three";
import { BODY_FRAME, BODY_SUBJECT, bodyCameraDistance, CAMERA_DISTANCE_RANGE, frontCameraDistance, HEAD_SUBJECT, orbitDistanceLimits,
  subjectFitDistance, SURFACE_CLEARANCE, surfaceAnchoredDistance } from "../src/camera-framing";
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
  expect(distance).toBeLessThan(orbitDistanceLimits({ fov: 10, aspect: 320 / 660, target: [0, 1.67, .005], subjects: [HEAD_SUBJECT] }).max);
  const clip = previewClipPlanes(distance, distance);
  expect(clip.near).toBeGreaterThan(2);
  expect(clip.near).toBeLessThan(distance - 1e-3);
  expect(clip.far).toBeGreaterThan(distance + 1);
});

test("lens changes report both orbit and surface-clearance limits", () => {
  const limits = { min: .1, max: 5 };
  const far = surfaceAnchoredDistance([0, 1.67, -.55], [0, 1.67, .005],
    [0, 1.67, -.09], 90, 10, limits);
  expect(far.distance).toBe(5);
  expect(far.limited).toBe(true);
  const close = surfaceAnchoredDistance([0, 1.67, -.1], [0, 1.67, 0],
    [0, 1.67, -.095], 10, 90, limits);
  expect(close.limited).toBe(true);
  expect(close.distance).toBeCloseTo(.105, 10);
});

/** The largest |NDC| of the whole-body frame's box corners, seen by a frontal camera at this orbit distance (below 1: inside the view). */
function bodyExtent(fov: number, aspect: number, distance: number) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, .01, 1000);
  camera.position.set(0, BODY_FRAME.targetHeight, -distance); camera.lookAt(0, BODY_FRAME.targetHeight, 0); camera.updateMatrixWorld(true);
  let worst = 0;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-BODY_FRAME.halfDepth, BODY_FRAME.halfDepth]) {
    const p = new THREE.Vector3(x * BODY_FRAME.halfWidth, BODY_FRAME.targetHeight + y * BODY_FRAME.halfHeight, z).project(camera);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
  }
  return worst;
}

test("a narrow lens in a tall pane can zoom out past the whole body, and Whole body frames it", () => {
  // The report: at 15° in a pane about 3:4 the old fixed 5-unit clamp stopped short of the whole body.
  for (const fov of [10, 15, 30, 60, 90]) for (const aspect of [.25, .5, .75, 1, 16 / 9]) {
    const body = bodyCameraDistance(fov, aspect);
    const limits = orbitDistanceLimits({ fov, aspect, target: [0, BODY_FRAME.targetHeight, .005], subjects: [HEAD_SUBJECT, BODY_SUBJECT],
      framing: [frontCameraDistance(fov, aspect), body] });
    expect(body).toBeLessThan(CAMERA_DISTANCE_RANGE.max);
    expect(limits.max).toBeGreaterThanOrEqual(body);
    expect(limits.max).toBeLessThanOrEqual(CAMERA_DISTANCE_RANGE.max);
    // At the whole-body distance the body is inside the view with room to spare; at the farthest orbit it is smaller still.
    expect(bodyExtent(fov, aspect, body)).toBeLessThan(1 / BODY_FRAME.margin + 1e-9);
    expect(bodyExtent(fov, aspect, limits.max)).toBeLessThan(bodyExtent(fov, aspect, body) + 1e-9);
  }
  const report = orbitDistanceLimits({ fov: 15, aspect: .75, target: [0, 1.67, .005], subjects: [HEAD_SUBJECT, BODY_SUBJECT] });
  expect(report.max).toBeGreaterThan(bodyCameraDistance(15, .75));
  expect(bodyCameraDistance(15, .75)).toBeGreaterThan(5);
});

test("the farthest orbit fits every subject sphere from any direction, around a panned target too", () => {
  for (const fov of [10, 15, 45, 90]) for (const aspect of [.3, .75, 2]) for (const target of [[0, 1.67, .005], [.4, 1.2, -.3]] as const) {
    const distance = subjectFitDistance(fov, aspect, target, [HEAD_SUBJECT, BODY_SUBJECT]);
    for (const direction of [[0, 0, -1], [1, 0, 0], [.3, .8, -.5]] as const) {
      const d = new THREE.Vector3(...direction).normalize();
      const camera = new THREE.PerspectiveCamera(fov, aspect, .01, 1000);
      const [tx, ty, tz] = target;
      camera.position.set(tx, ty, tz).addScaledVector(d, distance); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld(true);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const subject of [HEAD_SUBJECT, BODY_SUBJECT]) {
        const centre = new THREE.Vector3(...subject.centre);
        // Wholly inside: each side plane leaves the whole sphere on its inner side.
        for (const plane of frustum.planes.slice(0, 4)) expect(plane.distanceToPoint(centre)).toBeGreaterThan(subject.radius);
      }
    }
  }
});

test("the range follows the scene: body off shrinks it, lens and aspect change it, and it never moves the camera", () => {
  const target = [0, 1.67, .005] as const;
  const head = orbitDistanceLimits({ fov: 15, aspect: .75, target, subjects: [HEAD_SUBJECT], framing: [frontCameraDistance(15, .75)] });
  const body = orbitDistanceLimits({ fov: 15, aspect: .75, target, subjects: [HEAD_SUBJECT, BODY_SUBJECT] });
  expect(head.max).toBeLessThan(body.max);
  expect(head.max).toBeGreaterThanOrEqual(frontCameraDistance(15, .75));
  // A wider lens or a wider pane needs less distance.
  expect(orbitDistanceLimits({ fov: 45, aspect: .75, target, subjects: [HEAD_SUBJECT] }).max).toBeLessThan(head.max);
  expect(orbitDistanceLimits({ fov: 15, aspect: 1.5, target, subjects: [HEAD_SUBJECT] }).max).toBeLessThan(head.max);
  // A pose beyond the range (a restored whole-body view with the body not yet loaded) stays where it is and can only come closer.
  const restored = orbitDistanceLimits({ fov: 15, aspect: .75, target, subjects: [HEAD_SUBJECT], current: body.max });
  expect(restored.max).toBeCloseTo(body.max, 12);
  // A pose closer than the surface allows stays too.
  const inside = orbitDistanceLimits({ fov: 15, aspect: .75, target, subjects: [HEAD_SUBJECT], surfaceDepth: .1, current: .05 });
  expect(inside.min).toBe(.05);
  // Never beyond the stored range, however narrow the pane.
  expect(orbitDistanceLimits({ fov: 10, aspect: .01, target, subjects: [BODY_SUBJECT] }).max).toBe(CAMERA_DISTANCE_RANGE.max);
});

test("the closest orbit stops in front of the head's surface, with the near plane well inside that clearance", async () => {
  const { previewNearPlane } = await import("../src/camera-depth");
  // Unpanned front view: the nose tip lies about .096 in front of the target (head z −.091, target z .005).
  const front = orbitDistanceLimits({ fov: 30, aspect: 1, target: [0, 1.67, .005], subjects: [HEAD_SUBJECT], surfaceDepth: .096 });
  expect(front.min).toBeCloseTo(.096 + SURFACE_CLEARANCE, 12);
  expect(previewNearPlane(front.min)).toBeLessThan(SURFACE_CLEARANCE / 5);
  // Panned onto the lower lid (surface .061 in front of the target): closer than the old fixed .1 clamp allowed.
  expect(orbitDistanceLimits({ fov: 10, aspect: 1, target: [.035, 1.67, .005], subjects: [HEAD_SUBJECT], surfaceDepth: .061 }).min).toBeLessThan(.1);
  // Nothing in the way (a target panned off the head, or the surface behind it): the range's own floor.
  expect(orbitDistanceLimits({ fov: 30, aspect: 1, target: [1, 1.67, 0], subjects: [HEAD_SUBJECT] }).min).toBe(CAMERA_DISTANCE_RANGE.min);
  expect(orbitDistanceLimits({ fov: 30, aspect: 1, target: [0, 1.67, 0], subjects: [HEAD_SUBJECT], surfaceDepth: -.02 }).min).toBe(CAMERA_DISTANCE_RANGE.min);
});

test("a stored pose at the farthest reach of any view stays valid, and one beyond the range does not", async () => {
  const { validCameraPose } = await import("../src/preview-view-graph");
  const far = orbitDistanceLimits({ fov: 10, aspect: .3, target: [0, BODY_FRAME.targetHeight, .005], subjects: [HEAD_SUBJECT, BODY_SUBJECT] }).max;
  expect(far).toBeGreaterThan(5);
  expect(validCameraPose({ position: [0, BODY_FRAME.targetHeight, -far], target: [0, BODY_FRAME.targetHeight, 0], fov: 10 })).toBe(true);
  expect(validCameraPose({ position: [0, 1.67, -.1], target: [0, 1.67, 0], fov: 30 })).toBe(true);
  expect(validCameraPose({ position: [0, 0, -(CAMERA_DISTANCE_RANGE.max + .5)], target: [0, 0, 0], fov: 30 })).toBe(false);
  expect(validCameraPose({ position: [0, 0, -.01], target: [0, 0, 0], fov: 30 })).toBe(false);
});
