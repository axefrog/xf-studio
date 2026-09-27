// Does a preset's makeup reach the eye plate? Pure and browser-safe (no IO, no hashing).
//
// The plate covers only part of the head atlas: its UV rectangle is about 0.45 × 0.15 of the atlas and has
// holes (the eye openings). A preset drawn entirely elsewhere is invisible in game, and the independent
// verifier refuses its window map, so Check and Build omit it as a reported omission (PIPE-33). The test
// samples the plate where the verifier does, at every vertex and six points inside every triangle, and
// asks whether any exportable layer's coverage reaches at least PLATE_REACH_MIN_BYTE / 255 at one of them.
//
// A mottled layer is judged on its mottled coverage as the verifier sees it (PIPE-113): mottle can break a soft
// edge up to nothing, so a preset whose only contact is such an edge would pass on its unmottled shape and then
// fail Build's verifier. The verifier reads the coverage reference, a head-atlas raster at
// COVERAGE_REFERENCE_GRID, bilinearly at each sample, so the test does the same with that raster's own texel
// values. Unmottled layers keep the point test (their coverage is smooth, and the threshold's margin covers
// interpolation between reference texels).
import { planPresetExport } from "./engines/layered-makeup/finish-export";
import { plateSamplePoints, type PlateUvFootprint } from "./engines/layered-makeup/plate-uv-window";
import { layerCoverageSampler, type Layer, type Recipe } from "./engines/layered-makeup/recipe";
import type { LayeredMakeupRegion } from "./engines/layered-makeup/region";

/**
 * Smallest coverage byte, at one plate sample, that counts as reaching the plate. The verifier counts a sample
 * once either side reaches 1/255; one step above keeps interpolation between reference texels from dropping a
 * kept preset below the verifier's threshold.
 */
export const PLATE_REACH_MIN_BYTE = 2;

/** The plate a Check or Build plans on: its footprint, and the SHA-256 the server side computed for it. */
export interface PlateReachInput { readonly footprint: PlateUvFootprint; readonly sha256: string }
/** What the manifest, Check and Build record about the plate they planned on. */
export type PlateUvRecord = { window: PlateUvFootprint["window"]; bounds: PlateUvFootprint["bounds"]; footprintSha256: string };
export const plateUvRecord = (plate: PlateReachInput): PlateUvRecord =>
  ({ window: plate.footprint.window, bounds: plate.footprint.bounds, footprintSha256: plate.sha256 });

/**
 * Head-atlas grid of the coverage reference the verifier compares window maps against (the package's
 * `REFERENCE_GRID`): its texels (about 0.14 × 0.10 mm on the lids) are at least as fine as the window's.
 */
export const COVERAGE_REFERENCE_GRID = 4096;

/** Sample points per footprint object, computed once per plate. */
const pointCache = new WeakMap<PlateUvFootprint, Float64Array>();

/**
 * True when any exportable active layer of `recipe` (mirrored across the region's `mirror`) reaches the plate at one
 * of its sample points; a mottled layer with its mottle (on the region's `skin`) as the coverage reference has it.
 */
export function presetReachesPlate(recipe: Pick<Recipe, "layers">, footprint: PlateUvFootprint,
  region: Pick<LayeredMakeupRegion, "mirror" | "skin">): boolean {
  let points = pointCache.get(footprint);
  if (!points) { points = plateSamplePoints(footprint); pointCache.set(footprint, points); }
  for (const layer of planPresetExport(recipe).included) {
    if (layer.enabled && layer.effects?.mottle) { if (mottledReach(layer, points, region)) return true; continue; }
    const sample = layerCoverageSampler(layer, region.mirror);
    for (let i = 0; i < points.length; i += 2) if (Math.round(255 * sample(points[i], points[i + 1])) >= PLATE_REACH_MIN_BYTE) return true;
  }
  return false;
}

/**
 * Whether a mottled layer's coverage reference reaches PLATE_REACH_MIN_BYTE at a sample: its bytes at the
 * reference raster's texel centres (the raster's own values, mottle sampled at that raster's spacing),
 * interpolated bilinearly at each sample as the verifier reads them.
 */
function mottledReach(layer: Layer, points: Float64Array, region: Pick<LayeredMakeupRegion, "mirror" | "skin">): boolean {
  const grid = COVERAGE_REFERENCE_GRID, spacing = { u: 1 / grid, v: 1 / grid };
  const sample = layerCoverageSampler(layer, region.mirror, { skin: region.skin, spacing }), bytes = new Map<number, number>();
  const at = (i: number, j: number) => {
    const key = j * grid + i;
    let value = bytes.get(key);
    if (value === undefined) { value = Math.round(255 * sample((i + .5) / grid, (j + .5) / grid)); bytes.set(key, value); }
    return value;
  };
  for (let p = 0; p < points.length; p += 2) {
    const x = points[p] * grid - .5, y = points[p + 1] * grid - .5, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const value = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
    if (value >= PLATE_REACH_MIN_BYTE) return true;
  }
  return false;
}
