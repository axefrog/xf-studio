/** Preserve the original 1 mm close-up plane; recover depth precision at longer viewing distances. */
export const previewNearPlane = (orbitDistance: number) => Math.min(.005, Math.max(.001, orbitDistance * .01));

/** A conservative one-metre sphere encloses the preview head and optional hair. */
export function previewClipPlanes(orbitDistance: number, cameraToHeadCentre: number) {
  const near = Math.max(previewNearPlane(orbitDistance), cameraToHeadCentre - 1);
  const far = Math.max(10, cameraToHeadCentre + 1.2);
  return { near, far };
}
