/**
 * Feature-module platform step 3 (`xfs/eye-makeup-part-2`, CORE-09): what must not change when
 * the recipe-level model gate goes. Everything is read through interfaces that exist before and
 * after the change (`parseRecipe`, `applyRecipeAction`, the collection readers, the workspace
 * restore), and recipe schema tags are removed before hashing, because the in-memory recipe no
 * longer has one: every layer, optical model and setting is still compared. Rendering is
 * compared byte for byte (masks, compiled export maps) and by the preview's texture identities.
 * `tests/golden/part-2-parity.json` was captured from the step-2 code by
 *   bun tests/fixtures/capture-part-2-golden.ts <label>
 */
import { createHash } from "node:crypto";
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes } from "../../src/direct-glint-settings";
import { defaultFlakes } from "../../src/finish";
import { planPresetExport } from "../../src/finish-export";
import { maskAlphaKey, previewOpticalKey } from "../../src/makeup-dependencies";
import { preparePackageCollection } from "../../src/package-filter";
import { compilePreset } from "../../src/preset-compiler";
import { parseCollection, planCollection } from "../../src/preset-collection";
import { initialRecipe, newLayerTemplate, parseRecipe, raster, type Layer } from "../../src/recipe";
import { applyRecipeAction, type RecipeAction } from "../../src/recipe-actions";
import type { GlitterChoices } from "../../src/glitter-model";
import { STUDIO_PARTS } from "../../src/compose/studio-registry";
import { COLLECTION_FIXTURES, readFixture } from "./capture-plan-golden";
import { canonical, digest, observeRoundTrips } from "./workspace-observable";
import { damagedWorkspaceV1, glitterRecipe, largeWorkspaceV1, looseWorkspaceV1, opticsRecipe, recipe3,
  smallWorkspaceV1 } from "./workspace-v1-fixtures";

const UV = "gltf-uv0-top-left";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A deep copy with the `schema` tag of every recipe (an object with the recipe UV convention and layers) removed. */
export function withoutRecipeSchemas<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutRecipeSchemas) as T;
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>, recipe = input.uv === UV && Array.isArray(input.layers);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !(recipe && key === "schema"))
    .map(([key, item]) => [key, withoutRecipeSchemas(item)])) as T;
}
export const contentDigest = (value: unknown) => digest(withoutRecipeSchemas(value));

/** One recipe file per schema, as the build that wrote each schema stored it. */
export function recipeSchemaFixtures(): [string, unknown][] {
  const legacy = readFixture("005-preset-collection/collection.json").presets[0].recipe;
  const editor = readFixture("005-preset-collection/editor-collection.json").presets[0].recipe;
  const v3 = recipe3("v3") as { layers: Record<string, unknown>[] };
  const v4 = { ...v3, schema: "xfs/recipe-4", layers: v3.layers.map(layer => ({ ...layer, strength: { mode: "smooth-boundary", blend: 0.0005 } })) };
  const current = { schema: "xfs/recipe-7", ...initialRecipe() };
  const v5 = { ...current, schema: "xfs/recipe-5", layers: current.layers.map(({ softness: _s, ...layer }) =>
    ({ ...layer, points: layer.points.map(({ feather: _f, ...point }) => point) })) };
  const glitter = (schema: string, flakes: object) => ({ ...current, schema,
    layers: current.layers.map((layer, i) => i === 1 ? { ...layer, finish: "glitter", flakes } : layer) });
  return [["eye-artistry/recipe-1", legacy], ["xfs/recipe-2", editor], ["xfs/recipe-3", v3], ["xfs/recipe-4", v4],
    ["xfs/recipe-5", v5], ["xfs/recipe-6", { ...current, schema: "xfs/recipe-6" }],
    ["xfs/recipe-7", glitter("xfs/recipe-7", { model: "irregular-planar-1", count: 200000, radius: 0.00045, spread: 0.7, tilt: 0.35, seed: 7, color: "#d6b69e" })],
    ["xfs/recipe-8", glitter("xfs/recipe-8", defaultDirectGlintFlakes())],
    ["xfs/recipe-9", glitter("xfs/recipe-9", defaultClusteredGlintFlakes())],
    ["xfs/recipe-10", glitterRecipe("ten")], ["xfs/recipe-11", opticsRecipe("eleven")]];
}

/** A recipe-7 file: classic Glitter beside a Glossy layer that keeps its earlier (pre-game-matched) study. */
function earlyGlossRecipe() {
  const base = newLayerTemplate();
  const layer = (id: string, patch: Partial<Layer>): Layer => ({ ...base, id, name: id, ...patch });
  return { schema: "xfs/recipe-7", uv: UV, layers: [
    layer("e-gloss", { finish: "glossy", color: "#aa3355" }),
    layer("e-glit", { finish: "glitter", color: "#ddcc88", flakes: { ...defaultFlakes(), density: 0.3 } }),
    layer("e-matte", { finish: "matte", color: "#223344", opacity: 0.5 }),
  ] };
}

/** Glitter fixtures: a recipe file and the edits a person makes to it, in order. */
export function glitterFixtures(): { name: string; file: unknown; actions: RecipeAction[] }[] {
  const select = (layerId: string, model: string) => ({ kind: "glitter.selectModel", layerId, model }) as RecipeAction;
  return [
    { name: "models beside game-matched Glossy (recipe-11)", file: opticsRecipe("g"), actions: [
      select("g-glit", "direct"), { kind: "glitter.setDirect", layerId: "g-glit", key: "density", value: 0.61 },
      select("g-glit", "clustered"), select("g-glit", "fine"), select("g-glit", "irregular"),
      { kind: "glitter.setIrregular", layerId: "g-glit", key: "spread", value: 0.42 },
      select("g-glit", "classic"), { kind: "glitter.setClassic", layerId: "g-glit", key: "density", value: 0.77 },
      select("g-glit", "direct"), { kind: "layer.setOpacity", layerId: "g-gloss", opacity: 0.5 },
      { kind: "layer.setFinish", layerId: "g-glit", finish: "matte" }, { kind: "layer.setFinish", layerId: "g-glit", finish: "glitter" },
      select("g-glit", "direct")] },
    { name: "recipe-7 Glitter beside an earlier-study Glossy", file: earlyGlossRecipe(), actions: [
      select("e-glit", "fine"), { kind: "layer.useGameOptics", layerId: "e-gloss" }, select("e-glit", "classic"),
      { kind: "layer.setFinish", layerId: "e-gloss", finish: "matte" }, select("e-glit", "irregular"),
      { kind: "layer.setFinish", layerId: "e-matte", finish: "iridescent" },
      { kind: "layer.setShift", layerId: "e-matte", key: "strength", value: 0.25 }, select("e-glit", "clustered")] },
    { name: "every model side by side (recipe-10)", file: glitterRecipe("t"), actions: [
      select("t-fine", "classic"), select("t-irr", "direct"), select("t-dir", "fine"), select("t-fine", "fine"),
      { kind: "layer.setFinish", layerId: "t-matte", finish: "glossy" }, select("t-irr", "irregular")] },
  ];
}

/** Everything that renders from one recipe: masks, preview texture identities, the export plan and the compiled export. */
function rendering(recipe: { layers: Layer[] }, maskSizes: readonly number[]) {
  // Glitter has no export route: the compiled preset is what the package filter keeps (the plan's included layers).
  const plan = planPresetExport(recipe);
  let compiled: unknown;
  try {
    const result = compilePreset({ ...recipe, layers: plan.included }, 512);
    compiled = { route: result.route, maps: Object.fromEntries(Object.entries(result.maps).map(([name, map]) => [name, sha(map as Uint8Array)])),
      metadata: digest(result.metadata) };
  } catch (error) { compiled = { error: (error as Error).message }; }
  return {
    layers: recipe.layers.map(layer => ({ optical: previewOpticalKey(layer, 1024), alpha: maskAlphaKey(layer, 1024),
      masks: maskSizes.map(size => sha(new Uint8Array(raster(layer, size).buffer))) })),
    plan: digest(plan), compiled,
  };
}

/** The observable of every fixture on the code checked out. */
export function part2Observation(workspace = true) {
  const recipes = Object.fromEntries(recipeSchemaFixtures().map(([schema, file]) => {
    const recipe = parseRecipe(JSON.parse(JSON.stringify(file)));
    return [schema, { recipe: contentDigest(recipe), ...rendering(recipe, [512, 1024, 2048]) }];
  }));
  const glitter = Object.fromEntries(glitterFixtures().map(({ name, file, actions }) => {
    let state = { recipe: parseRecipe(JSON.parse(JSON.stringify(file))), active: 0, selected: 0, fieldSelection: {} };
    let choices: GlitterChoices = {};
    const steps = [{ action: "open", recipe: contentDigest(state.recipe), ...rendering(state.recipe, [512]) }];
    for (const action of actions) {
      const result = applyRecipeAction(state, action, choices, "preset");
      state = result.state; choices = result.choices;
      steps.push({ action: `${action.kind} ${canonical(action)}`, recipe: contentDigest(state.recipe), changed: result.changed,
        choices: digest(choices), ...rendering(state.recipe, [512]) } as never);
    }
    return [name, steps];
  }));
  const collections = Object.fromEntries(COLLECTION_FIXTURES.map(path => {
    const file = readFixture(path), looks = STUDIO_PARTS.readCollection(file);
    const routes = { direct: file, minimal: JSON.parse(JSON.stringify(STUDIO_PARTS.writeMinimal(looks))),
      "collection-2": JSON.parse(JSON.stringify(STUDIO_PARTS.write(looks))) };
    const diagnostic = "diagnostics" in file;
    return [path, Object.fromEntries(Object.entries(routes).map(([route, value]) => [route, {
      parsed: contentDigest(parseCollection(value)),
      // Diagnostic export knobs exist only in prepared experiment files (collection-1).
      ...(route === "direct" || !diagnostic ? { plan: contentDigest(planCollection(value)),
        packaged: contentDigest(preparePackageCollection(value)) } : {}),
    }]))];
  }));
  const summarise = (fixture: unknown) => {
    const result = observeRoundTrips(fixture);
    return { warning: result.warning, first: contentDigest(result.first), levels: result.levels.map(contentDigest) };
  };
  return { recipes, glitter, collections, ...(workspace ? { workspace: { small: summarise(smallWorkspaceV1()),
    loose: summarise(looseWorkspaceV1()), large: summarise(largeWorkspaceV1()), damaged: summarise(damagedWorkspaceV1()) } } : {}) };
}
