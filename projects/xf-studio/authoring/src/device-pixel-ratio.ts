/**
 * The viewport's device pixel ratio (UI-46). The canvas draws at the display's ratio, capped so a 4K or
 * high-zoom display doesn't quadruple the fragment cost. Moving the window to another monitor or zooming the
 * page changes the ratio without resizing the host, so a ResizeObserver alone misses it; a
 * `(resolution: Ndppx)` media query matches only the ratio it was made for, so the watch re-arms for the
 * new ratio after each change. DOM-free apart from the injected `matchMedia`.
 */
export const MAX_PIXEL_RATIO = 2;

export const viewportPixelRatio = (devicePixelRatio: number) => Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);

export type PixelRatioEnvironment = {
  readonly devicePixelRatio: number;
  matchMedia(query: string): Pick<MediaQueryList, "addEventListener" | "removeEventListener">;
};

/** Call `onChange` with the new capped ratio whenever the device pixel ratio changes; returns the stop. */
export function watchDevicePixelRatio(environment: PixelRatioEnvironment, onChange: (pixelRatio: number) => void): () => void {
  let query: Pick<MediaQueryList, "addEventListener" | "removeEventListener"> | null = null, stopped = false;
  const listener = () => {
    arm();
    onChange(viewportPixelRatio(environment.devicePixelRatio));
  };
  function arm() {
    query?.removeEventListener("change", listener);
    query = null;
    if (stopped) return;
    query = environment.matchMedia(`(resolution: ${environment.devicePixelRatio}dppx)`);
    query.addEventListener("change", listener);
  }
  arm();
  return () => { stopped = true; query?.removeEventListener("change", listener); query = null; };
}
