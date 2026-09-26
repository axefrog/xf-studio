// Crop regions for captures: a pixel rectangle, a normalised (0-1) rectangle, or a named region.
//
// Named regions are defined in units of the window HEIGHT, placed relative to the window's centre,
// so they frame the same part of the picture on 16:9, 21:9 and 32:9 windows: the game keeps its
// vertical field of view and widens the picture sideways on wider screens (Hor+).
//
// The photo-mode regions (face, eyes, head-and-shoulders) are centred: photo.frame puts its target
// (the face, the eyes, the head and shoulders) at the centre of the window at a known size, and
// these regions match those framings. cc-eyes is for the character creator's own camera, which the
// bridge can't move: it was measured from the first session's creator captures (26 September 2026,
// 3840x1600, the eyes zoom with the XF row selected; eyes centred about 0.09 window heights left of
// the centre and 0.03 below it, with about +-0.02 of idle drift).

import type { Rect } from "./image.ts";

export type RegionSpec =
  | { name: NamedRegion }
  | { pixels: Rect }
  | { normalized: Rect };

export const NAMED_REGIONS = {
  full: "The whole game window.",
  "center-16x9": "The central 16:9 area: on an ultrawide window, the part a 16:9 screen would show.",
  "head-and-shoulders": "A centred area around V's head and shoulders in the photo-mode face framing.",
  face: "A centred area around V's face, matching photo.frame's face framing.",
  eyes: "A centred band across both of V's eyes and brows, matching photo.frame's eyes framing.",
  "cc-eyes": "V's eyes and brows in the character creator's eyes zoom (the creator's own camera, not photo mode).",
} as const;
export type NamedRegion = keyof typeof NAMED_REGIONS;

// Centre: dx is the horizontal offset from the window's centre in window heights (so it holds on any
// aspect ratio), cy the vertical centre as a fraction of the height. Size in window heights.
type Shape = { dx: number; cy: number; w: number; h: number };
const SHAPES: Record<Exclude<NamedRegion, "full" | "center-16x9">, Shape> = {
  // photo.frame spans: head-and-shoulders 0.8 m, face 0.36 m, eyes 0.2 m of the window height.
  "head-and-shoulders": { dx: 0, cy: 0.5, w: 0.9, h: 0.96 },
  face: { dx: 0, cy: 0.5, w: 0.5, h: 0.62 },
  eyes: { dx: 0, cy: 0.5, w: 0.62, h: 0.28 },
  // Measured: eyes midpoint at about (1777, 846) of 3840x1600 over three creator captures (drift
  // +-25 px sideways, +-15 px up and down); the lower bands of the Depth presets reach 965 px and the
  // brows 750 px, so 0.46 x 0.2 heights holds both eyes, brows and lower bands with margin.
  "cc-eyes": { dx: -0.0875, cy: 0.531, w: 0.46, h: 0.2 },
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
  const shape = (SHAPES as Record<string, Shape | undefined>)[name];
  if (!shape) throw new RangeError(`unknown region "${name}"; use one of ${Object.keys(NAMED_REGIONS).join(", ")}`);
  const w = Math.min(width, shape.w * height);
  const h = Math.min(height, shape.h * height);
  const cx = width / 2 + shape.dx * height;
  return clampRect({ x: cx - w / 2, y: shape.cy * height - h / 2, width: w, height: h }, width, height);
}

export function describeRegion(spec: RegionSpec | undefined): string {
  if (!spec) return "full";
  if ("name" in spec) return spec.name;
  if ("pixels" in spec) return "pixels";
  return "normalized";
}
