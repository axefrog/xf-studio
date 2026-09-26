/** Preserve the original 1 mm close-up plane; recover depth precision at longer viewing distances. */
export const previewNearPlane = (orbitDistance: number) => Math.min(.005, Math.max(.001, orbitDistance * .01));

/** A sphere about the body's middle that encloses the whole V (feet to hair, hands in the bind pose). */
export const BODY_ENVELOPE = Object.freeze({ centreHeight: .93, radius: 1.15 });

/**
 * The clip planes with the whole body in the depth range as well as the head (only while the body shows, so the head views keep
 * exactly the planes `previewClipPlanes` gives).
 */
export function bodyClipPlanes(head: { near: number; far: number }, orbitDistance: number, cameraToBodyCentre: number) {
  const near = Math.max(previewNearPlane(orbitDistance), Math.min(head.near, cameraToBodyCentre - BODY_ENVELOPE.radius));
  return { near, far: Math.max(head.far, cameraToBodyCentre + BODY_ENVELOPE.radius + .2) };
}

/** A conservative one-metre sphere encloses the preview head and optional hair. */
export function previewClipPlanes(orbitDistance: number, cameraToHeadCentre: number) {
  const near = Math.max(previewNearPlane(orbitDistance), cameraToHeadCentre - 1);
  const far = Math.max(10, cameraToHeadCentre + 1.2);
  return { near, far };
}
