/**
 * Eye makeup's region for the layered-makeup engine (feature-module platform §9): where its layers live on the
 * expanded eye plate. The engine holds no region of its own; everything eye-specific it needs comes from here.
 */
import type { FlakeRegion } from "../../engines/layered-makeup/flake-field";
import { convertToBezier } from "../../engines/layered-makeup/bezier-path";
import { DEFAULT_STRENGTH_BLEND, type Layer, type Recipe } from "../../engines/layered-makeup/recipe";
import type { LayeredMakeupRegion } from "../../engines/layered-makeup/region";
import { EYE_MAKEUP_FEATURE, LAYER_MODELS } from "../../recipe-schema";

/**
 * The historical four-layer sample recipe: an example and test fixture (the first build's startup recipe).
 * New looks start from `starter()`; keep this one intact for existing drafts and examples.
 */
export function initialRecipe(): Recipe {
  return {
    uv: "gltf-uv0-top-left",
    layers: Array.from({ length: 4 }, (_, i) => convertToBezier({
      id: `layer-${i + 1}`,
      name: ["Petal wash", "Fine wing", "Inner light", "Accent"][i],
      enabled: i === 0,
      color: ["#905774", "#201b29", "#d4ae86", "#328c94"][i],
      finish: i === 2 ? "regular" : "matte",
      opacity: 0.85,
      strength: { mode: "smooth-boundary", blend: DEFAULT_STRENGTH_BLEND },
      softness: { mode: "uniform" },
      feather: i === 1 ? 0.0015 : 0.012,
      symmetry: true,
      pathMode: "catmull-rom",
      points: (i === 1
        ? [
            [0.31, 0.241],
            [0.36, 0.231],
            [0.423, 0.242],
            [0.454, 0.255],
            [0.392, 0.249],
            [0.345, 0.246],
          ]
        : [
            [0.303, 0.231],
            [0.33, 0.206],
            [0.378, 0.206],
            [0.427, 0.229],
            [0.439, 0.253],
            [0.369, 0.235],
          ]
      ).map(([u, v]) => ({ u, v, weight: 1 })),
      fields: [{ id: `layer-${i + 1}-field-1`, u: 0.342, v: 0.223, du: 0, dv: 0, radius: 0.07 }],
    })),
  };
}
/** Starting contour for a newly added or reset layer: an upper-lid wash. */
export function newLayerTemplate(): Layer {
  const base = initialRecipe().layers[0];
  return convertToBezier({
    ...base,
    feather: 0.006,
    points: [
      [0.311, 0.236], // inner lid tip
      [0.335, 0.215], // inner upper edge
      [0.402, 0.214], // outer upper edge
      [0.434, 0.246], // outer lid tip
    ].map(([u, v]) => ({ u, v, weight: 1 })),
    fields: [],
    pathMode: "catmull-rom",
  });
}
/** First-run authored content: one layer of the new-layer contour. */
export function starterRecipe(): Recipe {
  const layer = newLayerTemplate();
  return { uv: "gltf-uv0-top-left", layers: [
    { ...layer, id: "layer-1", name: "Eye makeup" },
  ] };
}

/**
 * Fine Glitter's two regions: they cover the authored eye plate with margin. They are a deliberate operational
 * scope, not an image-space crop or a procedural tile.
 */
export const EYE_FINE_GLITTER_REGIONS: readonly FlakeRegion[] = Object.freeze([
  Object.freeze({minU:.20,maxU:.50,minV:.12,maxV:.36}),
  Object.freeze({minU:.50,maxU:.80,minV:.12,maxV:.36}),
]);

export const EYE_MAKEUP_REGION: LayeredMakeupRegion = Object.freeze({
  id: EYE_MAKEUP_FEATURE,
  models: LAYER_MODELS,
  // The face's centre line: a symmetric layer paints both lids.
  mirror: Object.freeze({ axis: "u", centre: 0.5 }),
  fineGlitter: Object.freeze({ id: "eye-region-global-ids-1", regions: EYE_FINE_GLITTER_REGIONS }),
  /**
   * `mesh_decal` transforms every texture UV by UVScale/UVOffset, so the flat and faceted routes spend their texels
   * on the plate-local window (plate-uv-window.ts): 2048 × 512, about 4.3 × 3.3 times the head atlas's linear density
   * on the plate (0.13 × 0.12 mm per texel against 0.56 × 0.40 mm). The diagnostic Glitter route's window is
   * 4096 × 1024, about 0.064 × 0.060 mm per texel on the lids (experiment 018). The emissive accent's head-UV mask
   * (its template has no UV transform) is 2048 square, about 0.28 × 0.20 mm per texel; the Fresnel route's gradient
   * recolour template has no UV transform either, so it stays on the 1024 head atlas.
   */
  textures: Object.freeze({ window: Object.freeze({ width: 2048, height: 512 }), glitterWindow: Object.freeze({ width: 4096, height: 1024 }),
    accent: 2048, head: 1024 }),
  wording: Object.freeze({ area: "the eye UV area", surface: "the lid" }),
  starter: starterRecipe,
  newLayer: newLayerTemplate,
});
