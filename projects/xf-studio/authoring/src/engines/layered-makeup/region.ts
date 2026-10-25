/**
 * Where a feature's layered makeup lives (feature-module platform §9): the region config a feature hands the
 * layered-makeup engine. The engine holds no region of its own: the starter and new-layer shapes, the mirror of
 * symmetric layers, fine Glitter's UV scope, the export texture grids, the layer models it validates and the words
 * it uses for the area all come from here. Eye makeup's is `features/eye-makeup/region.ts`; lip or cheek makeup
 * would supply their own.
 */
import type { FlakeRegion } from "./flake-field";
import type { LayerModelRegistry } from "./layer-models";
import type { Layer, Recipe } from "./recipe";
import type { SkinScale } from "./mottle";
import type { UvWindow } from "./plate-uv-window";
import type { ContributedStarter, StarterShape } from "./starter-shape";
export type { SkinScale } from "./mottle";

/**
 * The line a symmetric layer is mirrored across: `u = centre` (a mirror left to right in UV) or `v = centre`.
 * Eye makeup mirrors across the face's centre line, u = ½.
 */
export type Mirror = Readonly<{ axis: "u" | "v"; centre: number }>;

/**
 * Fine Glitter's fixed UV scope: dense flake catalogues are generated only inside these regions, so a fine layer
 * must stay inside them. `id` names the scope in the exact cache key (with the regions' bounds), so two regions
 * never share a catalogue.
 */
export type FineGlitterScope = Readonly<{ id: string; regions: readonly FlakeRegion[] }>;

export type TextureGrid = Readonly<{ width: number; height: number }>;
/** The export texture grids of each route (finish-export.ts). */
export type RegionTextures = Readonly<{
  /** The flat and faceted routes' plate-local window. */
  window: TextureGrid;
  /** The diagnostic Glitter route's window. */
  glitterWindow: TextureGrid;
  /** The emissive accent's head-UV mask side. */
  accent: number;
  /** The head-UV atlas side (the Fresnel route and head-UV diagnostics). */
  head: number;
}>;

/** The region's words in user-facing text. */
export type RegionWording = Readonly<{
  /** The region's UV area, as a noun phrase: "the eye UV area". */
  area: string;
  /** The surface a finish is seen on, as a noun phrase: "the lid". */
  surface: string;
}>;

export interface LayeredMakeupRegion {
  /** The feature this region belongs to (its `FeatureId`). */
  readonly id: string;
  /** The layer models this feature's layers may hold; every engine edit and read validates with it. */
  readonly models: LayerModelRegistry;
  readonly mirror: Mirror;
  /** Millimetres on the skin per unit UV and the export texel size: mottle's grain is set in skin millimetres. */
  readonly skin: SkinScale;
  readonly fineGlitter: FineGlitterScope;
  /**
   * The head-UV rectangle over which the browser preview bakes true-to-scale optical detail: game-matched Shimmer's grain,
   * one cell per texel (shimmer-grain.ts `previewGrainGrid`: edges on the grain grid, power-of-two sides). It must cover
   * the surface's UVs; outside it the preview has no grain.
   */
  readonly opticsWindow: UvWindow;
  readonly textures: RegionTextures;
  readonly wording: RegionWording;
  /**
   * The UV rectangle the layered surface covers (eye makeup: the plate's). A contributed starter's contour, with its feather, stays
   * inside it, away from the surface's edge.
   */
  readonly area: UvWindow;
  /** The starters the feature contributes (read-only, in menu order) and the one a new layer takes when nothing else is chosen. */
  readonly starters: readonly ContributedStarter[];
  readonly defaultStarter: string;
  /** First-run content: a new look's part (its one layer takes `shape`, else the default starter's). */
  starter(shape?: StarterShape): Recipe;
  /** The contour a newly added or reset layer starts from (its ID and name are set by the edit): `shape`, else the default starter's. */
  newLayer(shape?: StarterShape): Layer;
}

/** The plain-data part of a region a raster worker needs: it crosses a worker boundary with each request. */
export type RasterRegion = Readonly<{ mirror: Mirror; skin: SkinScale; fineGlitter: FineGlitterScope; opticsWindow: UvWindow; wording: Pick<RegionWording, "area"> }>;
export const rasterRegion = (region: Pick<LayeredMakeupRegion, "mirror" | "skin" | "fineGlitter" | "opticsWindow" | "wording">): RasterRegion =>
  ({ mirror: region.mirror, skin: region.skin, fineGlitter: region.fineGlitter, opticsWindow: region.opticsWindow, wording: { area: region.wording.area } });

/** Where a symmetric layer's sample at (u, v) is mirrored to. */
export function mirrored(mirror: Mirror): (u: number, v: number) => [number, number] {
  const twice = 2 * mirror.centre;
  return mirror.axis === "u" ? (u, v) => [twice - u, v] : (u, v) => [u, twice - v];
}
