// Does a preset's makeup reach the eye plate? Pure and browser-safe (no IO, no hashing).
//
// The plate covers only part of the head atlas: its UV rectangle is about 0.45 × 0.15 of the atlas and has
// holes (the eye openings). A preset drawn entirely elsewhere is invisible in game, and the independent
// verifier refuses its window map, so Check and Build omit it as a reported omission (PIPE-33). The test
// samples the plate where the verifier does, at every vertex and six points inside every triangle, and
// asks whether any exportable layer's own coverage reaches at least PLATE_REACH_MIN_BYTE / 255 at one of them.
import { planPresetExport } from "./engines/layered-makeup/finish-export";
import { plateSamplePoints, type PlateUvFootprint } from "./engines/layered-makeup/plate-uv-window";
import { layerCoverageSampler, type Recipe } from "./engines/layered-makeup/recipe";

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

/** Sample points per footprint object, computed once per plate. */
const pointCache = new WeakMap<PlateUvFootprint, Float64Array>();

/** True when any exportable active layer of `recipe` reaches the plate at one of its sample points. */
export function presetReachesPlate(recipe: Pick<Recipe, "layers">, footprint: PlateUvFootprint): boolean {
  let points = pointCache.get(footprint);
  if (!points) { points = plateSamplePoints(footprint); pointCache.set(footprint, points); }
  for (const layer of planPresetExport(recipe).included) {
    const sample = layerCoverageSampler(layer);
    for (let i = 0; i < points.length; i += 2) if (Math.round(255 * sample(points[i], points[i + 1])) >= PLATE_REACH_MIN_BYTE) return true;
  }
  return false;
}
