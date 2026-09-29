// The camera as the tools model it (bridge 0.6): a pinhole with the game's camera pose, used to put things where the
// camera looks (showroom.spawn's placement on the view ray) and to project world points into the frame without a game
// call per point (scene.report's bounds, margins and pre-capture checks).
//
// Frame units are framing.ts's: offsets from the window's centre in window heights, x to the right, y downwards, so a
// point is in frame when |y| <= 0.5 and |x| <= aspect / 2.
//
// Scale: the game's own projection decides it. scene.read projects three calibration points (1 m ahead of the camera, and
// 10 cm up and right of that) through CameraSystem.ProjectPoint; the vertical scale they give is exact for that frame,
// whatever the field of view means. Without them the model reads the field of view as vertical [hypothesis: framing's
// runtime fits are consistent with it, but no reading has settled it; calibrate() reports which axis the game's projection
// matches].

import { screenSpace, type ScreenPoint, type SubjectReading } from "../api/framing.ts";

export type Vec3 = [number, number, number];
export type CameraPose = { position: Vec3; forward: Vec3; right: Vec3; up: Vec3; fov: number; aspect: number };
/** Projections of the calibration points: 1 m ahead of the camera (center), then 10 cm along camera up and right. */
export type Calibration = { center: ScreenPoint; up: ScreenPoint; right: ScreenPoint; far?: ScreenPoint };
export type CameraModel = CameraPose & {
  /** Window heights per unit of (lateral / depth): 1 / (2 tan(vfov / 2)) for a vertical field of view. */
  scale: number;
  by: "game" | "fov";
  fov_axis?: "vertical" | "horizontal" | "neither";
  /** Only when the game's horizontal and vertical scales differ by more than 5 %. */
  pixel_aspect?: number;
};
export type Projected = { x: number; y: number; depth: number; in_frame: boolean; behind: boolean };

const DEG = Math.PI / 180;
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalise = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Reads {x, y, z} or [x, y, z]. */
export function vec(value: unknown): Vec3 | null {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n))) return [value[0], value[1], value[2]];
  const o = value as { x?: number; y?: number; z?: number } | null;
  if (o && typeof o.x === "number" && typeof o.y === "number" && typeof o.z === "number") return [o.x, o.y, o.z];
  return null;
}

/** A camera pose from a bridge answer (showroom.anchor's camera, scene.read's camera, photo.subject's camera). */
export function poseOf(raw: unknown): CameraPose | null {
  const c = raw as Record<string, unknown> | null;
  if (!c) return null;
  const position = vec(c.position), forward = vec(c.forward);
  if (!position || !forward) return null;
  const f = normalise(forward);
  // Right and up from the game when given; otherwise level: right horizontal, up completing the frame.
  let right = vec(c.right);
  let up = vec(c.up);
  if (!right) {
    const h = Math.hypot(f[0], f[1]) || 1;
    right = [f[1] / h, -f[0] / h, 0];
  }
  if (!up) up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const fov = typeof c.fov === "number" && c.fov > 0 ? c.fov : 60;
  const aspect = typeof c.aspect === "number" && c.aspect > 0 ? c.aspect : 16 / 9;
  return { position, forward: f, right: normalise(right), up: normalise(up), fov, aspect };
}

/** The model from the field of view alone (read as vertical). */
export function modelFromFov(pose: CameraPose): CameraModel {
  return { ...pose, scale: 1 / (2 * Math.tan((pose.fov * DEG) / 2)), by: "fov" };
}

/**
 * The model calibrated by the game's own projection of the three calibration points. Also says which axis the game's
 * field of view describes, by comparing the calibrated scale with the vertical and horizontal readings of the fov.
 */
export function calibrate(pose: CameraPose, calibration: Calibration | null | undefined): CameraModel {
  if (!calibration) return modelFromFov(pose);
  const reading = {
    camera: { aspect: pose.aspect },
    screen: { center: calibration.center, target: calibration.center, up: calibration.up, right: calibration.right },
  } as unknown as SubjectReading;
  const space = screenSpace(reading);
  const c = space.toFrame(calibration.center), u = space.toFrame(calibration.up), r = space.toFrame(calibration.right);
  const sy = Math.hypot(u.x - c.x, u.y - c.y) / 0.1;
  const sx = Math.hypot(r.x - c.x, r.y - c.y) / 0.1;
  if (!(sy > 1e-4) || !Number.isFinite(sy)) return modelFromFov(pose);
  const vertical = 1 / (2 * Math.tan((pose.fov * DEG) / 2));
  // A horizontal fov F_h gives tan(vfov/2) = tan(F_h/2) / aspect.
  const horizontal = pose.aspect / (2 * Math.tan((pose.fov * DEG) / 2));
  const near = (a: number, b: number) => Math.abs(a - b) / b < 0.03;
  const axis = near(sy, vertical) ? "vertical" : near(sy, horizontal) ? "horizontal" : "neither";
  // Square pixels: both axes should agree (sx is kept as a check); the vertical one is what the frame's height is measured in.
  return { ...pose, scale: sy, by: "game", fov_axis: axis, ...(sx > 0 && Math.abs(sx - sy) / sy > 0.05 ? { pixel_aspect: r4(sx / sy) } : {}) };
}

/** A world point in frame units. depth is the distance along the view; points behind the camera are never in frame. */
export function project(model: CameraModel, point: Vec3): Projected {
  const d = sub(point, model.position);
  const depth = dot(d, model.forward);
  if (depth <= 1e-4) return { x: 0, y: 0, depth: r4(depth), in_frame: false, behind: true };
  const x = (dot(d, model.right) / depth) * model.scale;
  const y = (-dot(d, model.up) / depth) * model.scale;
  return { x: r4(x), y: r4(y), depth: r4(depth), in_frame: Math.abs(y) <= 0.5 && Math.abs(x) <= model.aspect / 2, behind: false };
}

/** The world point at frame position (x, y) and a distance along the view ray through it (distance measured from the camera). */
export function onRay(model: CameraModel, distance: number, at: { x: number; y: number } = { x: 0, y: 0 }): Vec3 {
  const dir = normalise(add(add(model.forward, scale(model.right, at.x / model.scale)), scale(model.up, -at.y / model.scale)));
  return add(model.position, scale(dir, distance)).map(r4) as Vec3;
}

export type Bounds = { left: number; right: number; top: number; bottom: number; points: number; behind: number };
/** The screen bounds of a set of world points (frame units), and how many of them fell behind the camera. */
export function boundsOf(model: CameraModel, points: readonly Vec3[]): Bounds | null {
  const shown = points.map((p) => project(model, p));
  const front = shown.filter((p) => !p.behind);
  if (!front.length) return null;
  return {
    left: r4(Math.min(...front.map((p) => p.x))),
    right: r4(Math.max(...front.map((p) => p.x))),
    top: r4(Math.min(...front.map((p) => p.y))),
    bottom: r4(Math.max(...front.map((p) => p.y))),
    points: points.length,
    behind: shown.length - front.length,
  };
}

/**
 * How much of a screen box is inside the frame (0-1 of its area) and its margins to each window edge in window heights
 * (negative: past the edge). The frame spans x in [-aspect/2, aspect/2] and y in [-0.5, 0.5].
 */
export function framing(bounds: Bounds, aspect: number) {
  const half = aspect / 2;
  const w = Math.max(bounds.right - bounds.left, 1e-6), h = Math.max(bounds.bottom - bounds.top, 1e-6);
  const ix = Math.max(0, Math.min(bounds.right, half) - Math.max(bounds.left, -half));
  const iy = Math.max(0, Math.min(bounds.bottom, 0.5) - Math.max(bounds.top, -0.5));
  return {
    fraction_in_frame: r4((ix * iy) / (w * h)),
    margins: { left: r4(bounds.left + half), right: r4(half - bounds.right), top: r4(bounds.top + 0.5), bottom: r4(0.5 - bounds.bottom) },
    size: { width: r4(w), height: r4(h) },
    centre: { x: r4((bounds.left + bounds.right) / 2), y: r4((bounds.top + bounds.bottom) / 2) },
  };
}

/** The pitch (degrees, up positive) and heading of a direction. */
export const pitchOf = (f: Vec3) => Math.asin(Math.max(-1, Math.min(1, normalise(f)[2]))) / DEG;
