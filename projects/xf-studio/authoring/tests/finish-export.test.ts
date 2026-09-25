import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRESNEL_PRESET_RULE, fresnelConstants, layerExport, planPresetExport } from "../src/finish-export";
import { facetedMipChain, maskMipChain } from "../src/route-mip-chains";
import { flatMipChain } from "../src/flat-mip-chain";
import { compileFacetedPreset, compileFlatPreset, compileFresnelPreset, compilePreset, GRADIENT_SIZE, UnsupportedMaterialError } from "../src/preset-compiler";
import { describePackageExperimental, preparePackageCollection } from "../src/package-filter";
import { planCollection } from "../src/preset-collection";
import { HandleCounter, rewritePlateMesh } from "../src/package-resources";
import { plateUvWindow, uvTransformConstants } from "../src/plate-uv-window";
import { initialRecipe, parseRecipe, raster, type Layer, type Recipe } from "../src/recipe";
import { facetedReference, maskReference } from "../src/mod-verifier/texture-checks";
import { expectedMaterialValues } from "../src/mod-verifier/resource-checks";

const board = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/016-finish-board/finish-board.collection.json"), "utf8"));
const game = { model: "game-matched-1" } as const;
const shift = { color: "#3fd4c2", strength: .8 };
function recipe(...layers: Partial<Layer>[]): Recipe {
  const base = initialRecipe().layers[0];
  return parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left",
    layers: layers.map((layer, i) => ({ ...structuredClone(base), id: `l${i}`, enabled: true, opacity: .9, ...layer })) });
}

test("each finish has one honest export status; earlier preview models and Glitter are refused", () => {
  const base = initialRecipe().layers[0];
  expect(layerExport({ ...base, finish: "matte" })).toMatchObject({ exportable: true, route: "flat", experimental: false });
  expect(layerExport({ ...base, finish: "satin" })).toMatchObject({ exportable: true, route: "flat" });
  expect(layerExport({ ...base, finish: "glossy" })).toMatchObject({ exportable: false, reason: expect.stringContaining("clear coat") });
  expect(layerExport({ ...base, finish: "glossy", optics: game })).toMatchObject({ exportable: true, route: "flat", experimental: true });
  expect(layerExport({ ...base, finish: "shimmer", optics: game })).toMatchObject({ exportable: true, route: "faceted", experimental: true });
  expect(layerExport({ ...base, finish: "iridescent", optics: game })).toMatchObject({ exportable: false });
  expect(layerExport({ ...base, finish: "iridescent", optics: { ...game, shift } })).toMatchObject({ exportable: true, route: "fresnel" });
  expect(layerExport({ ...base, finish: "glitter" })).toMatchObject({ exportable: false, reason: expect.stringContaining("Glitter") });
});

test("game-matched optics are recipe-11 only and carry a shift colour only on Colour-shifting layers", () => {
  const layer = { ...initialRecipe().layers[0], finish: "glossy" as const, optics: game };
  expect(() => parseRecipe({ schema: "xfs/recipe-10", uv: "gltf-uv0-top-left", layers: [layer] })).toThrow("game-matched");
  expect(parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer] }).schema).toBe("xfs/recipe-11");
  expect(() => parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [{ ...layer, optics: { ...game, shift } }] })).toThrow();
  expect(() => parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [{ ...layer, finish: "iridescent" }] })).toThrow();
  expect(() => parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [{ ...layer, finish: "matte" }] })).toThrow();
  expect(() => parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left",
    layers: [{ ...layer, finish: "iridescent", optics: { ...game, shift: { ...shift, strength: 2 } } }] })).toThrow();
});

test("a colour-shift preset must be one pigment; otherwise only its colour-shift layers are left out", () => {
  const cs = { finish: "iridescent" as const, optics: { ...game, shift }, color: "#3a2350" };
  expect(planPresetExport(recipe(cs, cs)).route).toBe("fresnel");
  const mixed = planPresetExport(recipe({ finish: "matte" }, cs));
  expect(mixed.route).toBe("flat");
  expect(mixed.included.map(l => l.id)).toEqual(["l0"]);
  expect(mixed.excluded).toEqual([{ layer: expect.objectContaining({ id: "l1" }), reason: FRESNEL_PRESET_RULE }]);
  const two = planPresetExport(recipe(cs, { ...cs, optics: { ...game, shift: { ...shift, strength: .2 } } }));
  expect(two.included).toEqual([]);
  expect(two.excluded).toHaveLength(2);
  expect(planPresetExport(recipe({ finish: "matte" }, { finish: "shimmer", optics: game })).route).toBe("faceted");
  expect(() => compileFlatPreset(recipe({ finish: "matte" }, cs), 32)).toThrow(UnsupportedMaterialError);
});

test("PIPE-23: the one-pigment rule counts exportable layers only, so Glitter beside a colour shift is left out alone", () => {
  const cs = { finish: "iridescent" as const, optics: { ...game, shift }, color: "#3a2350" };
  const withGlitter = planPresetExport(recipe({ finish: "glitter" }, cs, { finish: "glossy" }));
  expect(withGlitter.route).toBe("fresnel");
  expect(withGlitter.included.map(l => l.id)).toEqual(["l1"]);
  // Glitter and the earlier-model Glossy are reported with their own reasons, in recipe order.
  expect(withGlitter.excluded.map(item => item.layer.id)).toEqual(["l0", "l2"]);
  expect(withGlitter.excluded[0].reason).toContain("Glitter");
  expect(withGlitter.excluded[1].reason).toContain("clear coat");
  expect(withGlitter.excluded.some(item => item.reason === FRESNEL_PRESET_RULE)).toBe(false);
  // Partial export keeps the colour-shift preset and names only the omitted layers.
  const collection = structuredClone(board);
  collection.presets = [{ ...collection.presets[2], recipe: recipe(cs, { finish: "glitter" }) }];
  const prepared = preparePackageCollection(collection);
  expect(prepared.omissions.map(item => item.kind === "layer" ? [item.layerId, item.finish] : item.kind)).toEqual([["l1", "glitter"]]);
  expect(planCollection(prepared.packaged).presets.map(p => p.route)).toEqual(["fresnel"]);
  // An exportable non-colour-shift layer still breaks the one-pigment rule.
  const mixed = planPresetExport(recipe({ finish: "glitter" }, cs, { finish: "matte" }));
  expect(mixed.route).toBe("flat");
  expect(mixed.excluded.map(item => [item.layer.id, item.reason === FRESNEL_PRESET_RULE])).toEqual([["l0", false], ["l1", true]]);
});

test("glossy is a flat low-roughness dielectric and flat-only output is unchanged by the new routes", () => {
  const flat = recipe({ finish: "glossy", optics: game });
  const baked = compileFlatPreset(flat, 64), mask = raster(flat.layers[0], 64);
  let checked = 0;
  for (let p = 0; p < 64 * 64; p++) if (mask[p * 4 + 3] > 200) { expect(baked.roughness[p]).toBe(31); expect(baked.metalness[p]).toBe(0); checked++; }
  expect(checked).toBeGreaterThan(10);
  const compiled = compilePreset(recipe({ finish: "matte" }, { finish: "metallic" }), 64);
  expect(compiled.route).toBe("flat");
  expect(Object.keys(compiled.maps)).toEqual(["diffuse", "roughness", "metalness"]);
});

test("faceted presets add facet normals only where Shimmer covers, flat elsewhere", () => {
  const r = recipe({ finish: "matte", opacity: 1 }, { finish: "shimmer", optics: game, opacity: 1, points: initialRecipe().layers[1].points });
  const c = compileFacetedPreset(r, 512);
  const shimmerMask = raster(r.layers[1], 512), matteMask = raster(r.layers[0], 512);
  let tilted = 0;
  for (let p = 0; p < 512 * 512; p++) {
    const tilt = Math.abs(c.normal[p * 2] - 128) + Math.abs(c.normal[p * 2 + 1] - 128);
    if (!shimmerMask[p * 4 + 3]) expect(tilt).toBe(0);
    else if (tilt > 10) tilted++;
    if (!shimmerMask[p * 4 + 3] && !matteMask[p * 4 + 3]) expect(c.diffuse[p * 4 + 3]).toBe(0);
  }
  expect(tilted).toBeGreaterThan(20);
});

test("colour-shift presets write linear coverage, a uniform base colour and normalised shift constants", () => {
  const r = recipe({ finish: "iridescent", optics: { ...game, shift }, color: "#3a2350", opacity: .5 });
  const c = compileFresnelPreset(r, 64), mask = raster(r.layers[0], 64);
  for (let p = 0; p < 64 * 64; p++) expect(Math.abs(c.mask[p] - mask[p * 4 + 3])).toBeLessThanOrEqual(1);
  expect(c.gradient.length).toBe(GRADIENT_SIZE * GRADIENT_SIZE * 4);
  expect([...c.gradient.subarray(0, 4)]).toEqual([0x3a, 0x23, 0x50, 255]);
  const k = fresnelConstants(shift);
  expect(Math.max(k.FresnelColor.Red, k.FresnelColor.Green, k.FresnelColor.Blue)).toBe(255);
  expect(k.FresnelColorIntensity).toBeCloseTo(2 * .8 * ((0xd4 / 255 + .055) / 1.055) ** 2.4, 5);
  expect(fresnelConstants({ ...shift, strength: 0 }).FresnelColorIntensity).toBe(0);
});

test("route mip chains agree byte for byte with the verifier's independent references on the finish board", () => {
  const shimmer = compileFacetedPreset(board.presets[1].recipe, 256);
  const chain = facetedMipChain(shimmer.diffuse, shimmer.roughness, shimmer.metalness, shimmer.normal, 256);
  const reference = facetedReference(shimmer.diffuse, shimmer.roughness, shimmer.metalness, shimmer.normal, 256);
  expect(chain.roughness).toEqual(reference.roughness);
  expect(chain.normal).toEqual(reference.normalXY);
  const flat = flatMipChain(shimmer.diffuse, shimmer.roughness, shimmer.metalness, 256);
  let widened = 0;
  for (let level = 1; level < chain.roughness.length; level++)
    chain.roughness[level].forEach((value, t) => { expect(value).toBeGreaterThanOrEqual(flat.roughness[level][t]); if (value > flat.roughness[level][t]) widened++; });
  expect(widened).toBeGreaterThan(50);
  const shiftPreset = compileFresnelPreset(board.presets[2].recipe, 256);
  expect(maskMipChain(shiftPreset.mask, 256)).toEqual(maskReference(shiftPreset.mask, 256));
});

test("the filter lists experimental finishes and names the preset rule; resources give each route its material", () => {
  const prepared = preparePackageCollection(board);
  expect(prepared.omissions).toEqual([]);
  expect(new Set(prepared.experimental.map(item => item.finish))).toEqual(new Set(["glossy", "shimmer", "iridescent"]));
  expect(describePackageExperimental(prepared.experimental)).toContain("not yet confirmed in game");
  const plan = planCollection(prepared.packaged);
  expect(plan.presets.map(p => p.route)).toEqual(["flat", "faceted", "fresnel", "fresnel", "flat", "flat"]);
  expect(Object.keys(plan.presets[1].textures)).toEqual(["diffuse", "roughness", "metalness", "normal"]);
  expect(Object.keys(plan.presets[2].textures)).toEqual(["mask", "gradient"]);
  const uv = uvTransformConstants(plateUvWindow({ uMin: .27, uMax: .73, vMin: .67, vMax: .82 }));
  expect(plan.presets.map(p => p.uvSpace)).toEqual(["plate-window", "plate-window", "head", "head", "plate-window", "plate-window"]);
  const mesh = rewritePlateMesh({ Data: { RootChunk: { localMaterialBuffer: {} } } }, plan, new HandleCounter(), uv).Data.RootChunk;
  // Window entries carry the UV transform; the gradient-recolour template has none, so Fresnel stays on head UV.
  const parameters = (i: number) => Object.assign({}, ...mesh.localMaterialBuffer.materials[i].values.map(({ $type: _t, ...rest }: Record<string, unknown>) => rest));
  for (const i of [0, 1]) expect([parameters(i).UVScaleX, parameters(i).UVOffsetX, parameters(i).UVScaleY, parameters(i).UVOffsetY])
    .toEqual([uv.UVScaleX, uv.UVOffsetX, uv.UVScaleY, uv.UVOffsetY]);
  for (const i of [2, 3]) expect(Object.keys(parameters(i)).filter(key => key.startsWith("UV"))).toEqual([]);
  expect(() => rewritePlateMesh({ Data: { RootChunk: { localMaterialBuffer: {} } } }, plan, new HandleCounter())).toThrow("UV window");
  expect(mesh.materialEntries.map((e: { name: { $value: string } }) => e.name.$value)).toEqual(["@preset", "@faceted",
    plan.presets[2].material, plan.presets[3].material]);
  const chunks = mesh.appearances.map((a: { Data: { chunkMaterials: { $value: string }[] } }) => a.Data.chunkMaterials.map(c => c.$value));
  expect(chunks).toEqual([[plan.presets[0].appearance + "@preset"], [plan.presets[1].appearance + "@faceted"],
    [plan.presets[2].appearance + plan.presets[2].material], [plan.presets[3].appearance + plan.presets[3].material], [], []]);
  const fresnel = mesh.localMaterialBuffer.materials[2];
  expect(fresnel.baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal_gradientmap_recolor_blendable.mt");
  const values = Object.assign({}, ...fresnel.values.map(({ $type: _t, ...rest }: Record<string, unknown>) => rest));
  // The verifier's independent restatement agrees with the builder's plan constants.
  const expected = expectedMaterialValues("fresnel", plan.presets[2]);
  for (const [key, want] of Object.entries(expected))
    if (typeof want === "number") expect(values[key]).toBeCloseTo(want, 6); else expect(values[key]).toEqual(want);
  expect(values.FadeOutOffset).toBe(1000);
  // A preset left with only an earlier-model Glossy layer is omitted whole.
  const older = structuredClone(board);
  delete older.presets[0].recipe.layers[2].optics; delete older.presets[0].recipe.layers[4].optics;
  const reduced = preparePackageCollection(older);
  expect(reduced.omissions.filter(item => item.kind === "layer").map(item => item.kind === "layer" && item.layerName))
    .toEqual(["Glossy (single lobe)", "Glossy (single lobe) right"]);
});

test("choosing a finish uses its game-matched model; earlier layers switch only by explicit action", async () => {
  const { applyRecipeAction, recipeActionCapability } = await import("../src/recipe-actions");
  const start = initialRecipe(), id = start.layers[0].id;
  let state = { recipe: start, active: 0, selected: 0, fieldSelection: {} };
  state = applyRecipeAction(state, { kind: "layer.setFinish", layerId: id, finish: "iridescent" }).state;
  expect(state.recipe.schema).toBe("xfs/recipe-11");
  expect(state.recipe.layers[0].optics).toEqual({ model: "game-matched-1", shift: { color: "#3fd4c2", strength: .6 } });
  state = applyRecipeAction(state, { kind: "layer.setShift", layerId: id, key: "strength", value: .25 }).state;
  expect(state.recipe.layers[0].optics?.shift?.strength).toBe(.25);
  expect(() => applyRecipeAction(state, { kind: "layer.setShift", layerId: id, key: "color", value: "teal" })).toThrow();
  state = applyRecipeAction(state, { kind: "layer.setFinish", layerId: id, finish: "matte" }).state;
  expect(state.recipe.layers[0].optics).toBeUndefined();
  // An earlier Glossy layer keeps its look until the explicit switch.
  const earlier = structuredClone(start); earlier.layers[0].finish = "glossy";
  const old = { recipe: earlier, active: 0, selected: 0, fieldSelection: {} };
  expect(recipeActionCapability(old, { kind: "layer.setShift", layerId: id, key: "strength", value: .5 }).available).toBe(false);
  const switched = applyRecipeAction(old, { kind: "layer.useGameOptics", layerId: id }).state;
  expect(switched.recipe.layers[0].optics).toEqual({ model: "game-matched-1" });
  expect(recipeActionCapability(switched, { kind: "layer.useGameOptics", layerId: id }).available).toBe(false);
  expect(recipeActionCapability(state, { kind: "layer.useGameOptics", layerId: id }).available).toBe(false);
});

test("CORE-20/CORE-08: one finish table feeds game optics, surfaces, the catalogue and the setFinish choices", async () => {
  const { FINISH_EXPORT, finishExportSummary, flatSurface, hasGameOptics } = await import("../src/finish-export");
  const { finishCatalogue } = await import("../src/finish-catalogue");
  const { ACTION_DESCRIPTORS } = await import("../src/studio-action-descriptors");
  const ids = finishCatalogue().map(item => item.id);
  expect([...ACTION_DESCRIPTORS["layer.setFinish"].payload.finish.values!]).toEqual([...ids, "satin"]);
  expect(new Set<string>(ids)).toEqual(new Set(Object.keys(FINISH_EXPORT)));
  expect(ids.filter(id => hasGameOptics(id))).toEqual(["shimmer", "glossy", "iridescent"]);
  expect(hasGameOptics("satin")).toBe(false);
  expect(flatSurface("satin")).toEqual(flatSurface("regular"));
  expect(flatSurface("shimmer")).toBeUndefined();
  for (const item of finishCatalogue()) expect(item.exportNote).toBe(finishExportSummary(item.id).note);
});
