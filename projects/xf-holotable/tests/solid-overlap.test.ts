import { expect, test } from "bun:test";
import { ColliderOverlap, sameCollider, type ColliderPose } from "../src/solid-overlap.ts";
const collider = (level: number, x: number): ColliderPose => ({ id: `level${level}`, actor: `actor${level}`, actorShapes: 1, category: "Exterior", level,
  center: [x, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], kind: "box", size: [1, 2, 3] });

test("cross-level comparisons find sub-millimetre matches across spatial-cell boundaries and retain the first (lowest) level", () => {
  const index = new ColliderOverlap(), low = collider(0, 0.0096), high = collider(2, 0.0104);
  expect(index.add(low)).toBeUndefined(); expect(index.add(high)).toBe(low);
  expect(index.add(collider(3, 0.0105))).toBe(low);
  expect(index.add(collider(4, 0.012))).toBeUndefined();
});

test("geometry equality requires type, dimensions and rotation, and a cooked shape's identity", () => {
  const a = collider(0, 0), b = collider(1, 0);
  expect(sameCollider(a, { ...b, size: [1.0004, 2, 3] })).toBe(true);
  expect(sameCollider(a, { ...b, size: [1.001, 2, 3] })).toBe(false);
  const axes = (angle: number): ColliderPose["axes"] => [[Math.cos(angle), Math.sin(angle), 0], [-Math.sin(angle), Math.cos(angle), 0], [0, 0, 1]];
  expect(sameCollider(a, { ...b, axes: axes(0.00005) })).toBe(true);
  expect(sameCollider(a, { ...b, axes: axes(0.0002) })).toBe(false);
  expect(sameCollider(a, { ...b, kind: "sphere" })).toBe(false);
  const mesh: ColliderPose = { ...a, kind: "triangleMesh", size: undefined, hash: "42" };
  expect(sameCollider(mesh, { ...mesh, level: 2 })).toBe(true);
  expect(sameCollider(mesh, { ...mesh, hash: "43" })).toBe(false);
  const capsule: ColliderPose = { ...a, kind: "capsule", size: [1, 2, 0] };
  expect(sameCollider(capsule, { ...capsule, size: [1, 6, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 0.5]] })).toBe(false);
});
