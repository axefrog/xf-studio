/** Measurements from a brow-only, transparent screen pass at one fixed pose/camera. */
export function browScreenMetrics(rgba: Uint8ClampedArray, width: number, height: number) {
  if (rgba.length !== width * height * 4) throw Error("Brow screen buffer dimensions mismatch");
  let visible10 = 0, visible50 = 0, strongRgb = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const alpha = rgba[i + 3]!;
    if (alpha > 25) {
      visible10++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (alpha > 127) {
      visible50++;
      strongRgb += (rgba[i]! + rgba[i + 1]! + rgba[i + 2]!) / 3;
    }
  }
  return { visible10, visible50,
    strongMeanRgb: visible50 ? strongRgb / visible50 : 0,
    bounds: maxX < 0 ? "empty" : `${minX},${minY}–${maxX},${maxY}` };
}
