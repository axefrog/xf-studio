/**
 * The presentation-gap gate of G2 and G3 (experiment 043 §11–§13; `experiments/043-scene-runtimes/measure.ts`): while a preparation runs,
 * no more than `FRAME_GAP_MS` may pass between two presented frames, so the progress line and bar keep repainting.
 *
 * The samples are the page's animation-frame times. The window runs from the request to the first sample that shows the result (the new V,
 * or the new lighting setup taking over), and it includes the interval that ends there: a frame held back just before the takeover is a
 * frame the person waited for as much as any other (Sol's review of 4a-v-c: leaving it out passed a 1,000 ms gap).
 */
export const FRAME_GAP_MS = 100;

/**
 * The intervals between consecutive samples up to and including the one that ends at `shownIndex` (the first sample showing the result);
 * without one (the result never showed) every interval counts.
 */
export function preparationGaps(times: readonly number[], shownIndex: number | null): number[] {
  const last = shownIndex !== null && shownIndex > 0 ? Math.min(shownIndex, times.length - 1) : times.length - 1;
  const gaps: number[] = [];
  for (let i = 1; i <= last; i++) gaps.push(times[i]! - times[i - 1]!);
  return gaps;
}

/** Whether the samples pass the gate: no interval up to the takeover longer than `limit`. */
export function gapsPass(times: readonly number[], shownIndex: number | null, limit = FRAME_GAP_MS): boolean {
  return preparationGaps(times, shownIndex).every(gap => gap <= limit);
}
