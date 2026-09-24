/** Orbit bounds shared by controls and workspace validation. */
export const MIN_CAMERA_DISTANCE = .1;
export const MAX_CAMERA_DISTANCE = 3.5;

export type Point3 = readonly [number, number, number];

export function frontCameraDistance(fov: number, aspect: number): number {
  return Math.max(.55, .13 / (Math.tan(fov * Math.PI / 360) * aspect));
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
