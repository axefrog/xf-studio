/** Presentation-only collapse policy, measured from the bar itself. Sixteen pixels of expansion slack prevents boundary flicker. */
export type BarStage = 0 | 1 | 2;
export function playbackBarStage(previous: BarStage, width: number, full: number, viewCollapsed: number): BarStage {
  let next = previous;
  if (next === 2 && width >= viewCollapsed + 16) next = 1;
  if (next === 1 && width >= full + 16) next = 0;
  if (next === 0 && width < full) next = 1;
  if (next === 1 && width < viewCollapsed) next = 2;
  return next;
}
