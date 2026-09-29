import { MM_PER_UV } from "../src/glitter-region";
import { expect, test } from "bun:test";
import { coverage, createRasterJob, raster, rasterWindow, type Layer, type Recipe } from "../src/engines/layered-makeup/recipe";
import { editLayers } from "../src/engines/layered-makeup/layer-stack";
import { CLASSIC_FLAKES, GAME_MATCHED_OPTICS, LayerModelRegistry } from "../src/engines/layered-makeup/layer-models";
import { rasterRegion, type LayeredMakeupRegion, type Mirror } from "../src/engines/layered-makeup/region";
import { studioIrregularOpticalKey } from "../src/engines/layered-makeup/makeup-dependencies";
import { defaultStudioIrregularFlakes } from "../src/engines/layered-makeup/flake-field";
import { finishCatalogue, glitterModelCatalogue } from "../src/engines/layered-makeup/finish-catalogue";
import { compileFlatPreset } from "../src/engines/layered-makeup/preset-compiler";
import { EYE_MAKEUP_REGION, initialRecipe, newLayerTemplate, starterRecipe } from "../src/features/eye-makeup/region";

// The layered-makeup engine holds no region of its own (CORE-75): a feature hands it one. These checks run the engine
// on a region other than eye makeup's, and pin that eye makeup's region reproduces what the engine used to hard-code.

const layer = (): Layer => ({ ...initialRecipe().layers[0], enabled: true, symmetry: true, fields: [] });
const sampled = (l: Layer, size: number, mirror: Mirror) => {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = Math.round(255 * coverage((x + .5) / size, (y + .5) / size, l, mirror));
  return out;
};
/** A skin scale of another region (the engine's rasters require one; these unmottled layers never read it). */
const SKIN = { mmPerUv: { u: 300, v: 300 }, texelMm: .1 };
const alpha = (rgba: Uint8ClampedArray) => Uint8Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3]);

test("eye makeup's region is what the engine used to hard-code", () => {
  expect(EYE_MAKEUP_REGION.mirror).toEqual({ axis: "u", centre: .5 });
  expect(EYE_MAKEUP_REGION.fineGlitter).toEqual({ id: "eye-region-global-ids-1", regions: [
    { minU: .2, maxU: .5, minV: .12, maxV: .36 }, { minU: .5, maxU: .8, minV: .12, maxV: .36 }] });
  expect(EYE_MAKEUP_REGION.textures).toEqual({ window: { width: 2048, height: 512 }, glitterWindow: { width: 4096, height: 1024 }, accent: 2048, head: 1024 });
  expect(EYE_MAKEUP_REGION.starter()).toEqual(starterRecipe());
  expect(EYE_MAKEUP_REGION.newLayer()).toEqual(newLayerTemplate());
  expect(starterRecipe().layers.map(l => l.name)).toEqual(["Eye makeup"]);
  // The user-facing words the engine used to say.
  expect(finishCatalogue(EYE_MAKEUP_REGION.wording).find(item => item.id === "iridescent")!.description)
    .toBe("The colour turns toward a chosen shift colour as the lid curves away from view.");
  expect(glitterModelCatalogue(EYE_MAKEUP_REGION.wording).find(item => item.id === "irregular")!.summary)
    .toBe("Flakes of varied shape and size. Dense settings cover the eye UV area and can lose their sparkle from further away.");
  expect(rasterRegion(EYE_MAKEUP_REGION)).toEqual({ mirror: EYE_MAKEUP_REGION.mirror, skin: EYE_MAKEUP_REGION.skin,
    fineGlitter: EYE_MAKEUP_REGION.fineGlitter, opticsWindow: EYE_MAKEUP_REGION.opticsWindow, wording: { area: "the eye UV area" } });
  // Mottle's skin scale: the plate measure the glitter route uses, and the plate window's texel.
  expect(EYE_MAKEUP_REGION.skin).toEqual({ mmPerUv: MM_PER_UV, texelMm: .13 });
});

test("the raster mirrors a symmetric layer across the region's own line, exactly as its scalar coverage does", () => {
  const l = layer();
  for (const mirror of [{ axis: "u", centre: .5 }, { axis: "u", centre: .4 }, { axis: "v", centre: .3 }] as Mirror[]) {
    const size = 64, mask = alpha(raster(l, size, mirror, SKIN));
    expect(mask).toEqual(sampled(l, size, mirror));
    // The reflection is covered as the shape itself is.
    const twice = 2 * mirror.centre;
    for (const [u, v] of [[.35, .23], [.4, .22], [.33, .24]]) {
      const [mu, mv] = mirror.axis === "u" ? [twice - u, v] : [u, twice - v];
      expect(coverage(mu, mv, l, mirror)).toBeCloseTo(coverage(u, v, l, mirror), 12);
    }
  }
  // Another region's mirror paints elsewhere: the reflection of a u = ½ layer is not where a v = 0.3 mirror puts it.
  expect(alpha(raster(l, 64, { axis: "v", centre: .3 }, SKIN))).not.toEqual(alpha(raster(l, 64, { axis: "u", centre: .5 }, SKIN)));
  // A cooperative job gives the same bytes as the one-shot raster.
  const job = createRasterJob(l, 64, { axis: "v", centre: .3 }, SKIN);
  while (!job.advance(97));
  expect(alpha(job.data)).toEqual(alpha(raster(l, 64, { axis: "v", centre: .3 }, SKIN)));
});

test("a window raster samples the same coverage in the window as the head raster, for any mirror", () => {
  const l = layer(), area = { u0: .25, u1: .75, v0: 0, v1: .5 };
  for (const mirror of [{ axis: "u", centre: .5 }, { axis: "v", centre: .3 }] as Mirror[]) {
    const head = alpha(raster(l, 64, mirror, SKIN)), window = alpha(rasterWindow(l, 32, 32, area, mirror, SKIN));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) expect(window[y * 32 + x]).toBe(head[y * 64 + x + 16]);
  }
});

test("a new or reset layer takes the region's contour, and the region's models decide which layers are valid", () => {
  const lip: Layer = { ...layer(), pathMode: "catmull-rom", feather: .004, points: [{ u: .45, v: .7, weight: 1 }, { u: .55, v: .7, weight: 1 }, { u: .5, v: .76, weight: 1 }] };
  const region: Pick<LayeredMakeupRegion, "models" | "newLayer"> = { models: new LayerModelRegistry([CLASSIC_FLAKES]), newLayer: () => structuredClone(lip) };
  const base: Recipe = { uv: "gltf-uv0-top-left", layers: [] };
  const added = editLayers(base, undefined, { kind: "add", newId: "l1" }, region).recipe;
  expect(added.layers[0].points).toEqual(lip.points);
  expect(added.layers[0].name).toBe("Layer 1");
  // Game-matched optics are eye makeup's model; a region without it refuses such a layer.
  const glossy: Recipe = { uv: "gltf-uv0-top-left", layers: [{ ...lip, id: "g", finish: "glossy", optics: { model: "game-matched-1" } }] };
  expect(() => editLayers(glossy, "g", { kind: "rename", id: "g", name: "Gloss" }, region)).toThrow();
  const withOptics = { ...region, models: new LayerModelRegistry([CLASSIC_FLAKES, GAME_MATCHED_OPTICS]) };
  expect(editLayers(glossy, "g", { kind: "rename", id: "g", name: "Gloss" }, withOptics).recipe.layers[0].name).toBe("Gloss");
});

test("fine Glitter's cache key names the region's scope, so two regions never share a catalogue", () => {
  const settings = defaultStudioIrregularFlakes();
  const eye = studioIrregularOpticalKey(settings, 512, EYE_MAKEUP_REGION.fineGlitter);
  expect(eye).toContain("eye-region-global-ids-1");
  expect(eye).toContain("[[0.2,0.12,0.5,0.36],[0.5,0.12,0.8,0.36]]");
  const lips = studioIrregularOpticalKey(settings, 512, { id: "lip-region-1", regions: [{ minU: .4, maxU: .6, minV: .65, maxV: .8 }] });
  expect(lips).not.toBe(eye);
  // Below the fine threshold the catalogue is the whole unit square, whatever the region.
  const sparse = { ...settings, count: 1000, radius: .001 };
  expect(studioIrregularOpticalKey(sparse, 512, EYE_MAKEUP_REGION.fineGlitter))
    .toBe(studioIrregularOpticalKey(sparse, 512, { id: "lip-region-1", regions: [] }));
});

test("the compiler rasters with the region it is given", () => {
  const l = layer(), recipe: Recipe = { uv: "gltf-uv0-top-left", layers: [l] };
  const eye = compileFlatPreset(recipe, EYE_MAKEUP_REGION, 64), other = compileFlatPreset(recipe, { ...EYE_MAKEUP_REGION, mirror: { axis: "v", centre: .3 } }, 64);
  expect(other.diffuse).not.toEqual(eye.diffuse);
});
