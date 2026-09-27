import { BODY_ENVELOPE } from "./camera-depth";

export type Point3 = readonly [number, number, number];

/**
 * What any orbit may reach, and so what a stored pose may hold (CORE-96: the view graph's camera codec and `parseWorkspace` both
 * check it). The controls' limits at any moment come from the scene (`orbitDistanceLimits`) and always lie within this range; a
 * pose saved at the farthest distance any lens, pane and scene allowed therefore stays valid.
 */
export const CAMERA_DISTANCE_RANGE: Readonly<DistanceLimits> = Object.freeze({ min: .02, max: 100 });

/** A sphere that encloses something the camera frames, in the neutral subject space the stored cameras use. */
export type Subject = { readonly centre: Point3; readonly radius: number };
/**
 * The head with its neck and a typical hairstyle (the preview head spans x ±.091, y 1.492–1.800, z −.091–.129; the local hair's
 * positions reach y 1.834 and z .234: camera-zoom-design.md).
 */
export const HEAD_SUBJECT: Subject = Object.freeze({ centre: [0, 1.66, .04] as Point3, radius: .3 });
/** The whole V while the body shows (the depth range's envelope, camera-depth.ts). */
export const BODY_SUBJECT: Subject = Object.freeze({ centre: [0, BODY_ENVELOPE.centreHeight, 0] as Point3, radius: BODY_ENVELOPE.radius });
/** How much room the farthest orbit leaves around the subject. */
export const SUBJECT_MARGIN = 1.1;
/** How far in front of the head's surface the closest orbit stops: well beyond the close-up near plane (1 mm, camera-depth.ts) and the idle's and a blink's motion. */
export const SURFACE_CLEARANCE = .015;

const radians = (degrees: number) => degrees * Math.PI / 180;

export function frontCameraDistance(fov: number, aspect: number): number {
  return Math.max(.55, .13 / (Math.tan(fov * Math.PI / 360) * aspect));
}

/**
 * The whole-body view: the orbit target at the body's middle height, and a margin around a standing V about 1.9 m tall and 1.7 m
 * wide at the hands (the arms' bind pose), reaching up to `halfDepth` toward the camera (toes, chest), in the neutral space the head
 * views use.
 */
export const BODY_FRAME = Object.freeze({ targetHeight: .93, halfHeight: .97, halfWidth: .85, halfDepth: .15, margin: 1.06 });
/**
 * The orbit distance that fits the whole body in a view of this vertical field of view (degrees) and aspect: the frame's face nearest
 * the camera fits with the margin, so a wide lens's perspective can't push the feet or hands out of the view.
 */
export function bodyCameraDistance(fov: number, aspect: number): number {
  const half = Math.tan(fov * Math.PI / 360);
  return Math.max(BODY_FRAME.halfHeight / half, BODY_FRAME.halfWidth / (half * Math.max(aspect, 1e-3))) * BODY_FRAME.margin + BODY_FRAME.halfDepth;
}

/** Padding around a posed skeleton's joints (m): the body's own radius beyond them, the skull above `Head`, the feet below the ankles. */
export const POSED_PADDING = .2;
/** A box of posed joint positions (rig space, metres). */
export type JointBox = { readonly min: Point3; readonly max: Point3 };
/**
 * The whole-body view of a posed V (pose-library-design.md §5.3): the orbit target at the padded joints' centre, and the frontal distance
 * that fits their height and width with the whole-body margin, like `bodyCameraDistance` for a standing V.
 */
export function posedBodyFrame(fov: number, aspect: number, box: JointBox): { target: Point3; distance: number } {
  const half = Math.tan(fov * Math.PI / 360), pad = POSED_PADDING;
  const hh = (box.max[1] - box.min[1]) / 2 + pad, hw = (box.max[0] - box.min[0]) / 2 + pad, hd = (box.max[2] - box.min[2]) / 2 + pad;
  const target: Point3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  return { target, distance: Math.max(hh / half, hw / (half * Math.max(aspect, 1e-3))) * BODY_FRAME.margin + hd };
}
/** A sphere enclosing a posed V (padded joints), for the orbit's reach and the clip planes. */
export function posedBodySubject(box: JointBox): Subject {
  const centre: Point3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  return { centre, radius: Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2 + POSED_PADDING };
}

/**
 * The orbit distance at which every subject fits in the view around `target`, from any direction: a sphere about the target that
 * encloses them all, inside the narrower of the view's half angles (vertical, or horizontal in a tall pane), with the margin.
 */
export function subjectFitDistance(fov: number, aspect: number, target: Point3, subjects: readonly Subject[]): number {
  const halfV = radians(fov) / 2, halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 1e-3));
  let reach = 0;
  for (const s of subjects) reach = Math.max(reach, Math.hypot(s.centre[0] - target[0], s.centre[1] - target[1], s.centre[2] - target[2]) + s.radius);
  return reach / Math.sin(Math.min(halfV, halfH)) * SUBJECT_MARGIN;
}

export type DistanceLimits = { min: number; max: number };
export type OrbitView = {
  /** Vertical field of view in degrees, and the viewport's width over height. */
  fov: number; aspect: number;
  /** The orbit target, in the subjects' space. */
  target: Point3;
  /** What the scene shows now (the head, and the body while it shows). */
  subjects: readonly Subject[];
  /** Distances the view's framing jumps use (Front view, Whole body): the range always reaches them. */
  framing?: readonly number[];
  /** How far in front of the target the head's surface lies along the orbit line (absent or not positive: nothing in the way). */
  surfaceDepth?: number;
  /** The current orbit distance. */
  current?: number;
};

/**
 * The orbit's distance limits, derived from the scene: the farthest lets every subject fit at this lens and aspect (with the margin)
 * and reaches the framing jumps; the closest stops `SURFACE_CLEARANCE` in front of the head's surface on the orbit line. Both lie
 * within `CAMERA_DISTANCE_RANGE`. Limits never move the camera: a current distance outside them (a restored pose, or a lens, pane
 * or scene that shrank the range) stays reachable, and the range closes as the user moves back into it.
 */
export function orbitDistanceLimits(view: OrbitView): DistanceLimits {
  const range = CAMERA_DISTANCE_RANGE;
  const fit = Math.max(subjectFitDistance(view.fov, view.aspect, view.target, view.subjects), ...(view.framing ?? []));
  let max = Math.min(range.max, Number.isFinite(fit) ? fit : range.max);
  let min: number = range.min;
  if (view.surfaceDepth !== undefined && Number.isFinite(view.surfaceDepth) && view.surfaceDepth > 0)
    min = Math.min(range.max, view.surfaceDepth + SURFACE_CLEARANCE);
  const current = view.current;
  if (current !== undefined && Number.isFinite(current)) {
    max = Math.max(max, Math.min(range.max, current));
    min = Math.min(min, Math.max(range.min, current));
  }
  return { min: Math.min(min, max), max };
}

/**
 * Keep the plane through a visible surface hit at the same projected scale
 * and location when the lens changes. The target and view direction remain
 * fixed; the caller applies the new orbit distance along that direction.
 * `limits` are the orbit's limits at the new lens (default: the whole range).
 */
export function surfaceAnchoredDistance(
  position: Point3, target: Point3, anchor: Point3,
  oldFov: number, newFov: number, limits: DistanceLimits = CAMERA_DISTANCE_RANGE,
): { distance: number; limited: boolean } {
  const delta = target.map((v, i) => v - position[i]) as number[];
  const distance = Math.hypot(...delta);
  if (!Number.isFinite(distance) || distance < CAMERA_DISTANCE_RANGE.min || oldFov === newFov)
    return { distance, limited: false };
  const depth = anchor.reduce((sum, v, i) => sum + (v - position[i]) * delta[i] / distance, 0);
  if (!Number.isFinite(depth) || depth <= 0) return { distance, limited: false };
  const ratio = Math.tan(oldFov * Math.PI / 360) / Math.tan(newFov * Math.PI / 360);
  // Widening a lens can otherwise put the near plane through the anchor.
  const minimum = Math.max(limits.min, distance - depth + .01);
  const desired = distance + depth * (ratio - 1);
  return { distance: Math.min(limits.max, Math.max(minimum, desired)),
    limited: desired < minimum || desired > limits.max };
}
