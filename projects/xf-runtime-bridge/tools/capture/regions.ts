// Crop regions for captures: a pixel rectangle, a normalised (0-1) rectangle, or a named region.
//
// Named regions are defined in units of the window HEIGHT and centred horizontally, so they
// frame the same part of the picture on 16:9, 21:9 and 32:9 windows: the game keeps its
// vertical field of view and widens the picture sideways on wider screens (Hor+). They assume
// the subject is centred, which is what the photo-mode `face` camera preset aims for; the first
// in-game session checks the framing and these numbers are tuned from its captures.

import type { Rect } from "./image.ts";

export type RegionSpec =
  | { name: NamedRegion }
  | { pixels: Rect }
  | { normalized: Rect };

export const NAMED_REGIONS = {
  full: "The whole game window.",
  "center-16x9": "The central 16:9 area: on an ultrawide window, the part a 16:9 screen would show.",
  "head-and-shoulders": "A centred area around V's head and shoulders in the photo-mode face framing.",
  face: "A centred area around V's face in the photo-mode face framing (the face camera preset).",
  eyes: "A centred band across V's eyes in the photo-mode face framing.",
} as const;
export type NamedRegion = keyof typeof NAMED_REGIONS;

// Centre (cx as a fraction of width, cy of height) and size in window heights.
const SHAPES: Record<Exclude<NamedRegion, "full" | "center-16x9">, { cx: number; cy: number; w: number; h: number }> = {
  "head-and-shoulders": { cx: 0.5, cy: 0.5, w: 0.9, h: 0.96 },
  face: { cx: 0.5, cy: 0.46, w: 0.5, h: 0.62 },
  eyes: { cx: 0.5, cy: 0.4, w: 0.5, h: 0.2 },
};

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const right = Math.max(x + 1, Math.min(width, Math.round(rect.x + rect.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round(rect.y + rect.height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** Resolves a region to a pixel rectangle inside a width x height image, clipped to its bounds. */
export function resolveRegion(spec: RegionSpec | undefined, width: number, height: number): Rect {
  if (!spec || ("name" in spec && spec.name === "full")) return { x: 0, y: 0, width, height };
  if ("pixels" in spec) {
    const r = spec.pixels;
    if (r.width <= 0 || r.height <= 0) throw new RangeError("the crop rectangle needs a positive width and height");
    if (r.x >= width || r.y >= height || r.x + r.width <= 0 || r.y + r.height <= 0) {
      throw new RangeError(`the crop rectangle lies outside the ${width}x${height} image`);
    }
    return clampRect(r, width, height);
  }
  if ("normalized" in spec) {
    const r = spec.normalized;
    for (const value of [r.x, r.y, r.width, r.height]) {
      if (!(value >= 0 && value <= 1)) throw new RangeError("normalised crop values must be between 0 and 1");
    }
    if (r.width <= 0 || r.height <= 0) throw new RangeError("the crop rectangle needs a positive width and height");
    return clampRect({ x: r.x * width, y: r.y * height, width: r.width * width, height: r.height * height }, width, height);
  }
  const name = spec.name;
  if (name === "center-16x9") {
    const w = Math.min(width, (height * 16) / 9);
    const h = Math.min(height, (width * 9) / 16);
    return clampRect({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }, width, height);
  }
  const shape = (SHAPES as Record<string, (typeof SHAPES)["face"] | undefined>)[name];
  if (!shape) throw new RangeError(`unknown region "${name}"; use one of ${Object.keys(NAMED_REGIONS).join(", ")}`);
  const w = Math.min(width, shape.w * height);
  const h = Math.min(height, shape.h * height);
  return clampRect({ x: shape.cx * width - w / 2, y: shape.cy * height - h / 2, width: w, height: h }, width, height);
}

export function describeRegion(spec: RegionSpec | undefined): string {
  if (!spec) return "full";
  if ("name" in spec) return spec.name;
  if ("pixels" in spec) return "pixels";
  return "normalized";
}
