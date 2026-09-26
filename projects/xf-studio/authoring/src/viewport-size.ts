/** A viewport's drawable size, or undefined while its host is hidden or collapsed (zero or non-finite). */
export type ViewportSize = { width: number; height: number };

export function visibleViewportSize(width: number, height: number): ViewportSize | undefined {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : undefined;
}

/** The aspect a hidden viewport keeps: its host's when visible, otherwise the last one (or square). */
export function retainedViewportAspect(width: number, height: number, previous: number): number {
  const size = visibleViewportSize(width, height);
  return size ? size.width / size.height : Number.isFinite(previous) && previous > 0 ? previous : 1;
}
