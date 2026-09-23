/** Preserve the original 1 mm close-up plane; recover depth precision at longer viewing distances. */
export const previewNearPlane = (orbitDistance: number) => Math.min(.005, Math.max(.001, orbitDistance * .01));
