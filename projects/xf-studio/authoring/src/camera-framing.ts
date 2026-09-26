/** Orbit bounds shared by controls and workspace validation (far enough to frame the whole body at the default lens). */
export const MIN_CAMERA_DISTANCE = .1;
export const MAX_CAMERA_DISTANCE = 5;

export type Point3 = readonly [number, number, number];

export function frontCameraDistance(fov: number, aspect: number): number {
  return Math.max(.55, .13 / (Math.tan(fov * Math.PI / 360) * aspect));
}

/**
 * The whole-body view: the orbit target at the body's middle height, and a margin around a standing V about 1.9 m tall and 1.7 m
 * wide at the hands (the arms' bind pose), in the neutral space the head views use.
 */
export const BODY_FRAME = Object.freeze({ targetHeight: .93, halfHeight: .97, halfWidth: .85, margin: 1.06 });
/** The orbit distance that fits the whole body in a view of this vertical field of view (degrees) and aspect. */
export function bodyCameraDistance(fov: number, aspect: number): number {
  const half = Math.tan(fov * Math.PI / 360);
  return Math.max(BODY_FRAME.halfHeight / half, BODY_FRAME.halfWidth / (half * Math.max(aspect, 1e-3))) * BODY_FRAME.margin;
}

/**
 * Keep the plane through a visible surface hit at the same projected scale
 * and location when the lens changes. The target and view direction remain
 * fixed; the caller applies the new orbit distance along that direction.
 */
export function surfaceAnchoredDistance(
  position: Point3, target: Point3, anchor: Point3,
  oldFov: number, newFov: number,
): { distance: number; limited: boolean } {
  const delta = target.map((v, i) => v - position[i]) as number[];
  const distance = Math.hypot(...delta);
  if (!Number.isFinite(distance) || distance < MIN_CAMERA_DISTANCE || oldFov === newFov)
    return { distance, limited: false };
  const depth = anchor.reduce((sum, v, i) => sum + (v - position[i]) * delta[i] / distance, 0);
  if (!Number.isFinite(depth) || depth <= 0) return { distance, limited: false };
  const ratio = Math.tan(oldFov * Math.PI / 360) / Math.tan(newFov * Math.PI / 360);
  // Widening a lens can otherwise put the near plane through the anchor.
  const minimum = Math.max(MIN_CAMERA_DISTANCE, distance - depth + .01);
  const desired = distance + depth * (ratio - 1);
  return { distance: Math.min(MAX_CAMERA_DISTANCE, Math.max(minimum, desired)),
    limited: desired < minimum || desired > MAX_CAMERA_DISTANCE };
}
