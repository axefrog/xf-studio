/** Canvas backing pixels are independent of CSS drawing and hit-test coordinates. */
export function canvasResolution(width: number, height: number, devicePixelRatio: number) {
  const cssWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const cssHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  return { cssWidth, cssHeight, dpr, pixelWidth, pixelHeight,
    scaleX: pixelWidth / cssWidth, scaleY: pixelHeight / cssHeight };
}
