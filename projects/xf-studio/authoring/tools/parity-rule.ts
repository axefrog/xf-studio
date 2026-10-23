/**
 * The scene parity rule (experiment 043 §8, revised for GPU noise; tools/scene-parity.ts `compare`): a frame passes when it differs from a
 * base capture by at most one channel step (1/255) on fewer than 0.01 % of its pixels. Two captures of one build differ by about that
 * much, so byte identity can't be asked of a GPU path that isn't deterministic; anything more is a real change.
 */
export const PARITY_MAX_STEP = 1;
export const PARITY_MAX_SHARE = 0.0001;

/** How a frame differs from a base: `size` when their sizes do, else the differing pixels, the largest channel step and the pixels compared. */
export type FrameDifference = { size: string | null; pixels: number; max: number; total: number };

/** Whether a frame's difference from a base is within the rule's noise (an identical frame is). */
export function withinNoise(diff: FrameDifference): boolean {
  return !diff.size && (diff.pixels === 0 || (diff.max <= PARITY_MAX_STEP && diff.pixels < PARITY_MAX_SHARE * diff.total));
}
