import {expect, test} from "bun:test";
import {glitterModel, parseGlitterChoices, selectGlitterModel, type GlitterChoices, type GlitterModel} from "../src/engines/layered-makeup/glitter-model";
import {recipeFile} from "../src/recipe-schema";
import { initialRecipe } from "./fixtures/eye-region";
import { readRecipe as parseRecipe } from "../src/recipe-schema";

test("all Glitter studies are selectable without changing other layers or old recipes", () => {
  let recipe = initialRecipe(); recipe.layers[0].finish = "glitter";
  const unchanged = structuredClone(recipe.layers[1]);
  const choices: GlitterChoices = {};
  // The in-memory recipe has no schema to move; written out, it takes the oldest schema that holds
  // the model now chosen (classic again needs only recipe-7: nothing is pinned).
  for (const [model, schema] of [["irregular", "xfs/recipe-7"], ["direct", "xfs/recipe-8"],
    ["clustered", "xfs/recipe-9"], ["fine", "xfs/recipe-10"], ["classic", "xfs/recipe-7"]] as const) {
    recipe = selectGlitterModel(recipe, recipe.layers[0].id, model, choices);
    expect(glitterModel(recipe.layers[0].flakes)).toBe(model);
    expect(recipe).not.toHaveProperty("schema");
    expect(recipeFile(recipe)!.schema).toBe(schema);
    expect(parseRecipe(recipe)).toEqual(recipe);
    expect(parseRecipe(recipeFile(recipe))).toEqual(recipe);
    expect(recipe.layers[1]).toEqual(unchanged);
  }
});

test("switching back restores each model's own values, including after workspace parsing", () => {
  let recipe = initialRecipe(); recipe.layers[0].finish = "glitter";
  const choices: GlitterChoices = {};
  recipe = selectGlitterModel(recipe, recipe.layers[0].id, "direct", choices, "preset-a");
  const direct = recipe.layers[0].flakes!;
  if (!("strength" in direct)) throw Error("Expected direct model");
  direct.strength = 4;
  recipe = selectGlitterModel(recipe, recipe.layers[0].id, "fine", choices, "preset-a");
  const fine = recipe.layers[0].flakes!;
  if (!("strength" in fine)) throw Error("Expected fine model");
  fine.strength = 12;
  const restored = parseGlitterChoices(JSON.parse(JSON.stringify(choices)));
  recipe = selectGlitterModel(recipe, recipe.layers[0].id, "direct", restored, "preset-a");
  expect((recipe.layers[0].flakes as typeof direct).strength).toBe(4);
  recipe = selectGlitterModel(recipe, recipe.layers[0].id, "fine", restored, "preset-a");
  expect((recipe.layers[0].flakes as typeof fine).strength).toBe(12);
  expect(selectGlitterModel(recipe, recipe.layers[0].id, "fine" as GlitterModel, restored)).toBe(recipe);
});

test("saved inactive choices reject malformed settings", () => {
  expect(parseGlitterChoices({"preset-a/layer-1": {direct: {model:"uv-cell-direct-1", strength:Infinity},
    classic: {cells: 0}, fine: {model:"uv-cell-direct-3", density:0}}})).toEqual({});
});

test("a classic recipe-6 can select irregular flakes without invalid schema", () => {
  const file = { schema: "xfs/recipe-6", ...initialRecipe() }; file.layers[0].finish = "glitter";
  const recipe = parseRecipe(file);
  const selected = selectGlitterModel(recipe, recipe.layers[0].id, "irregular", {});
  expect(recipeFile(selected)!.schema).toBe("xfs/recipe-7");
  expect(parseRecipe(selected)).toEqual(selected);
  expect(file.schema).toBe("xfs/recipe-6");
});
