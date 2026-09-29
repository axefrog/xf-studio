// The Studio's glint models as game flakes: glitter flakes 2 (experiment 032). Pure: no IO.
//
// The Studio's good Glitter models (Direct-light glints, Clustered fine glints, Dense fine speckles: render/direct-glint.ts,
// recipe models uv-cell-direct-1/2/3) compute glints per fragment from hashed UV cells. The game can draw only what a
// `mesh_decal` texel holds: one normal, roughness, metalness and colour (knowledge/glitter-in-game.md). This module turns a
// layer's glint settings into the diagnostic Glitter route's flake statistics (export-diagnostics.ts `GlitterFlakes`), so a
// board preset reproduces what the Studio shows as faithfully as the decal allows:
//
// - Where each model puts its flakes: the model's own cell grid (1536 or 2304 cells per unit of head UV) and occupancy
//   (the authored density; for the clustered and fine models times their cluster envelope), converted to flakes per mm²
//   with the plate's millimetres per UV. The fine model's sparse large population (its 768-cell grid) and the direct and
//   clustered models' coarse share become the route's large population.
// - How big they are: the model's facet radii converted to widths, but never below two texels of the 4096 × 1024 window
//   (0.13 mm): the game's temporal filter keeps a glint of 2 × 2 pixels and dims a one-pixel one by an order of magnitude,
//   so the Studio's finest facets (about 0.06 mm) are drawn at 0.13 mm. The cover follows from count × area.
// - How they tilt: every flake at least 14° (above mode 1's ≈ 11.5° fade, with room for BC5's ≈ 1° error), then
//   |N(0, 16°)| up to 65°. The Studio's shader has 22 % flat facets and a tail to 65°; flat flakes in the game write no normal,
//   so they would take the skin's own highlight and read as paint printed on the lid, the session-6 verdict on board 1.
// - How they shine: the Studio's glint strength (0–16 on its control) becomes each flake's metalness and roughness, drawn
//   per flake: at full strength metalness 0.85–1 and roughness 0.20–0.34, at none 0.55–0.8 and 0.30–0.42. The Studio's
//   additive glint term has no energy bound; the game's GGX does, so strength buys a brighter, tighter lobe instead.
// - What lies underneath: the layer's own colour at the Studio's glint base surface (roughness 0.55, metalness 0). The
//   Studio adds a thin clear coat over it (0.4 at roughness 0.24); the G-buffer has no second lobe, so the export does not.
// - Clustering: the clustered and fine models' patchy occupancy becomes the route's cluster envelope, on the Studio's lattice
//   of 18 grid cells, with the model's floor.
import type { DirectGlintFlakes } from "./engines/layered-makeup/direct-glint-settings";
import type { GlitterFlakes } from "./export-diagnostics";
import { MM_PER_UV } from "./glitter-region";

/** Shared statistics of glitter flakes 2. */
export const GLITTER_FLAKES_2 = Object.freeze({
  /** The Studio's glint base surface (makeup-stack.ts: roughness .55 under a direct-glint layer, metalness of Satin). */
  base: Object.freeze({ roughness: .55, metalness: 0 }),
  tiltMinDeg: 14, tiltSigmaDeg: 16, tiltMaxDeg: 65,
  /** Two texels of the 4096 × 1024 window on the built-in plate (0.065 mm per texel). */
  minWidthMm: .13,
  sizeSigma: .25,
  /** Mean of the Studio's cluster smoothstep over its value noise, taken as ½ (the envelope redistributes; the count is set here). */
  clusterMean: .5,
  /** The Studio's cluster lattice: 18 cells of the model's grid. */
  clusterCells: 18,
  /** Most cover a region may take (the route's knob range is 0.6). */
  maxCover: .45,
});

/** Each Studio model's populations, from render/direct-glint.ts: grid, radii (head UV) and occupancy envelope. */
const MODELS = {
  "uv-cell-direct-1": { grid: 1536, fine: [.00005, .0001], coarse: [.00018, .00014], floor: 1, large: null },
  "uv-cell-direct-2": { grid: 1536, fine: [.000055, .000065], coarse: [.00015, .00009], floor: .07, large: null },
  "uv-cell-direct-3": { grid: 2304, fine: [.000042, .00004], coarse: [.0001, .00007], floor: .48,
    large: { grid: 768, radius: [.00019, .00028], occupancy: [.12, .42] } },
} as const satisfies Record<DirectGlintFlakes["model"], unknown>;

/** Mean facet width (mm) of a radius range [a, a + b] in head UV: the polygon's mean extent is about 0.9 of its circumscribed diameter. */
const widthMm = ([a, b]: readonly [number, number]) => 2 * (a + b / 2) * .9 * (MM_PER_UV.u + MM_PER_UV.v) / 2;
const cellsPerMm2 = (grid: number) => grid * grid / (MM_PER_UV.u * MM_PER_UV.v);
const hexArea = (w: number) => 3 * Math.sqrt(3) / 8 * w * w * 1.2;
const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * The game flakes that reproduce a Studio glint layer: flake statistics for one diagnostic Glitter region (seeded by the
 * layer's own seed), and the base surface the region's pigment takes.
 */
export function studioGlitterFlakes(settings: DirectGlintFlakes): { base: { roughness: number; metalness: number }; flakes: GlitterFlakes } {
  const model = MODELS[settings.model], g = GLITTER_FLAKES_2;
  const envelope = model.floor + (1 - model.floor) * g.clusterMean;
  const perMm2 = cellsPerMm2(model.grid) * settings.density * envelope;
  const small = Math.max(g.minWidthMm, widthMm(model.fine)), coarse = Math.max(g.minWidthMm, widthMm(model.coarse));
  // Populations: the small facets (the fine share), and a large one (the coarse share, or for the fine model its large facets,
  // whose coarse share is still near two texels and joins the small population).
  let nSmall: number, nLarge: number, large: number;
  if (model.large) {
    nSmall = perMm2;
    const occ = model.large.occupancy[0] + (model.large.occupancy[1] - model.large.occupancy[0]) * g.clusterMean;
    nLarge = cellsPerMm2(model.large.grid) * settings.density * occ;
    large = Math.max(g.minWidthMm, widthMm(model.large.radius));
  } else {
    nSmall = perMm2 * settings.fineShare; nLarge = perMm2 * (1 - settings.fineShare); large = coarse;
  }
  const smallWidth = model.large ? (small * settings.fineShare + coarse * (1 - settings.fineShare)) : small;
  const count = nSmall + nLarge, largeShare = count > 0 ? nLarge / count : 0;
  const cover = Math.min(g.maxCover, Math.max(.01, count * ((1 - largeShare) * hexArea(smallWidth) + largeShare * hexArea(large)) * Math.exp(2 * g.sizeSigma ** 2)));
  const t = Math.max(0, Math.min(1, settings.strength / 16));
  const clustered = model.floor < 1;
  const flakes: GlitterFlakes = {
    sizeMm: round(smallWidth), sizeSigma: g.sizeSigma, cover: round(cover), tiltSigmaDeg: g.tiltSigmaDeg, tiltMaxDeg: g.tiltMaxDeg,
    roughness: round(.30 - .10 * t), metalness: round(.80 + .20 * t), color: settings.color.toLowerCase(), seed: settings.seed,
    tiltMinDeg: g.tiltMinDeg, roughnessMax: round(.42 - .08 * t), metalnessMin: round(.55 + .30 * t),
    ...(largeShare > 0 ? { largeShare: round(Math.min(.5, largeShare)), largeSizeMm: round(Math.max(large, smallWidth)) } : {}),
    ...(clustered ? { clusterMm: round(g.clusterCells / model.grid * (MM_PER_UV.u + MM_PER_UV.v) / 2, 3), clusterFloor: model.floor } : {}),
  };
  return { base: { ...g.base }, flakes };
}
