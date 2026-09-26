import { expect, test } from "bun:test";
import { FRESNEL_PRESET_RULE, planPresetExport } from "../src/engines/layered-makeup/finish-export";
import { glitterModel, glitterModels, parseGlitterChoices } from "../src/engines/layered-makeup/glitter-model";
import { historyLabel } from "../src/history-labels";
import { type Recipe } from "../src/engines/layered-makeup/recipe";
import { recipeFile } from "../src/recipe-schema";

/** The schema the recipe is written in: the in-memory recipe has none (part-2), so no action can change one. */
const written = (recipe: Recipe) => { expect(recipe).not.toHaveProperty("schema"); return recipeFile(recipe)!.schema; };
import { StudioApplication, type StudioAction } from "../src/studio-application";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { STUDIO_COMPOSITION, STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { initialRecipe, freshWorkspace } from "./fixtures/eye-region";
import { readRecipe as parseRecipe } from "../src/recipe-schema";

// Finish, game-optics and Glitter-model actions through the application (CORE-16/17/18/21).

function fixture(recipe: Recipe = initialRecipe()) {
  const workspace = freshWorkspace(recipe);
  const core = createTrustedAuthoringCore(workspace, { resetStack: () => {}, selectedCollection: () => "preset-a" }, STUDIO_COMPOSITION);
  const layer = (index: number) => core.document.recipe.layers[index];
  const ok = (action: StudioAction) => {
    const capability = core.app.capability(action);
    expect(capability).toMatchObject({ available: true });
    const result = core.app.dispatch(action);
    expect(result).toMatchObject({ ok: true });
  };
  return { ...core, workspace, layer, ok };
}
const shown = (recipe: Recipe) => { for (const layer of recipe.layers) layer.enabled = true; return recipe; };

test("Glitter models can be chosen beside a game-matched Glossy layer without refusing or downgrading", () => {
  const f = fixture(shown(initialRecipe()));
  f.ok({ kind: "layer.setFinish", layerId: f.layer(0).id, finish: "glossy" });
  expect(written(f.document.recipe)).toBe("xfs/recipe-11");
  const optics = structuredClone(f.layer(0).optics);
  f.ok({ kind: "layer.setFinish", layerId: f.layer(1).id, finish: "glitter" });
  for (const model of ["fine", "clustered", "direct", "irregular", "classic", "fine"] as const) {
    f.ok({ kind: "glitter.selectModel", layerId: f.layer(1).id, model });
    expect(glitterModel(f.layer(1).flakes)).toBe(model);
    expect(written(f.document.recipe)).toBe("xfs/recipe-11");
    expect(f.layer(0).optics).toEqual(optics);
  }
});

test("Direct Glitter beside Fine Glitter keeps the newer schema both layers need", () => {
  const f = fixture(shown(initialRecipe()));
  f.ok({ kind: "layer.setFinish", layerId: f.layer(0).id, finish: "shimmer" });
  for (const index of [1, 2]) f.ok({ kind: "layer.setFinish", layerId: f.layer(index).id, finish: "glitter" });
  f.ok({ kind: "glitter.selectModel", layerId: f.layer(1).id, model: "fine" });
  f.ok({ kind: "glitter.selectModel", layerId: f.layer(2).id, model: "direct" });
  expect(written(f.document.recipe)).toBe("xfs/recipe-11");
  expect([glitterModel(f.layer(1).flakes), glitterModel(f.layer(2).flakes)]).toEqual(["fine", "direct"]);
  // Without game-matched optics the same pair needs recipe-10 (Fine), never Direct's recipe-8.
  const g = fixture(shown(initialRecipe()));
  for (const index of [1, 2]) g.ok({ kind: "layer.setFinish", layerId: g.layer(index).id, finish: "glitter" });
  g.ok({ kind: "glitter.selectModel", layerId: g.layer(1).id, model: "fine" });
  g.ok({ kind: "glitter.selectModel", layerId: g.layer(2).id, model: "direct" });
  g.ok({ kind: "glitter.selectModel", layerId: g.layer(2).id, model: "clustered" });
  expect(written(g.document.recipe)).toBe("xfs/recipe-10");
  expect(parseRecipe(g.document.recipe)).toEqual(g.document.recipe);
});

test("no edit pins a schema: removing or changing the last game-matched layer writes the oldest schema again", () => {
  const f = fixture(shown(initialRecipe()));
  f.ok({ kind: "layer.setFinish", layerId: f.layer(0).id, finish: "iridescent" });
  expect(written(f.document.recipe)).toBe("xfs/recipe-11");
  f.ok({ kind: "layer.setFinish", layerId: f.layer(0).id, finish: "matte" });
  // The layer's model decides; nothing else in the recipe needs recipe-11 any more.
  expect(written(f.document.recipe)).toBe("xfs/recipe-7");
  f.ok({ kind: "layer.setFinish", layerId: f.layer(1).id, finish: "glossy" });
  expect(written(f.document.recipe)).toBe("xfs/recipe-11");
  f.ok({ kind: "layer.edit", command: { kind: "remove", id: f.layer(1).id } });
  expect(f.document.recipe.layers.some(layer => layer.optics)).toBe(false);
  expect(written(f.document.recipe)).toBe("xfs/recipe-7");
  expect(recipeFile({ uv: "gltf-uv0-top-left", layers: [] })!.schema).toBe("xfs/recipe-7");
});

test("every finish and Glitter model the application offers is also applied", () => {
  const finishes = ["matte", "regular", "metallic", "shimmer", "glitter", "glossy", "iridescent"] as const;
  for (const neighbour of finishes) {
    const f = fixture(shown(initialRecipe()));
    f.ok({ kind: "layer.setFinish", layerId: f.layer(0).id, finish: neighbour });
    if (neighbour === "glitter") f.ok({ kind: "glitter.selectModel", layerId: f.layer(0).id, model: "fine" });
    for (const finish of finishes) {
      const action: StudioAction = { kind: "layer.setFinish", layerId: f.layer(1).id, finish };
      if (f.app.capability(action).available) expect(f.app.dispatch(action)).toMatchObject({ ok: true });
      if (finish !== "glitter") continue;
      for (const model of glitterModels) {
        const choose: StudioAction = { kind: "glitter.selectModel", layerId: f.layer(1).id, model };
        if (f.app.capability(choose).available) expect(f.app.dispatch(choose)).toMatchObject({ ok: true });
      }
    }
  }
});

test("re-selecting the current finish changes nothing and records no Undo step", () => {
  const f = fixture();
  const id = f.layer(0).id;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "iridescent" });
  f.ok({ kind: "layer.setShift", layerId: id, key: "strength", value: .2 });
  const before = JSON.stringify(f.document.recipe), depth = f.app.history().depth;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "iridescent" });
  expect(JSON.stringify(f.document.recipe)).toBe(before);
  expect(f.app.history().depth).toBe(depth);
  // Satin and its stored alias are the same finish.
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "regular" });
  const satin = f.app.history().depth;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "satin" });
  expect(f.app.history().depth).toBe(satin);
});

test("re-selecting Glossy keeps an earlier-model layer; only Use game-matched model switches it", () => {
  const recipe = initialRecipe(); recipe.layers[0].finish = "glossy";
  const f = fixture(recipe), id = f.layer(0).id;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "glossy" });
  expect(f.layer(0).optics).toBeUndefined();
  expect(written(f.document.recipe)).toBe("xfs/recipe-7");
  f.ok({ kind: "layer.useGameOptics", layerId: id });
  expect(f.layer(0).optics).toEqual({ model: "game-matched-1" });
  expect(written(f.document.recipe)).toBe("xfs/recipe-11");
});

test("Colour-shift settings are remembered when switching away and back, like Glitter models", () => {
  const f = fixture(), id = f.layer(0).id;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "iridescent" });
  f.ok({ kind: "layer.setShift", layerId: id, key: "color", value: "#ff2040" });
  f.ok({ kind: "layer.setShift", layerId: id, key: "strength", value: .35 });
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "glossy" });
  expect(f.layer(0).optics).toEqual({ model: "game-matched-1" });
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "iridescent" });
  expect(f.layer(0).optics?.shift).toEqual({ color: "#ff2040", strength: .35 });
  // Editor memory, not the recipe: it survives the workspace round trip under the preset's key.
  expect(f.workspace.glitterChoices[`preset-a/${id}`]?.shift).toEqual({ color: "#ff2040", strength: .35 });
  expect(parseGlitterChoices(JSON.parse(JSON.stringify(f.workspace.glitterChoices)))[`preset-a/${id}`]?.shift)
    .toEqual({ color: "#ff2040", strength: .35 });
  expect(parseGlitterChoices({ "preset-a/x": { shift: { color: "red", strength: 2 } } })).toEqual({});
  // Undo restores the recipe; the memory is unaffected.
  expect(f.app.dispatch({ kind: "history.undo" })).toMatchObject({ ok: true });
  expect(f.layer(0).finish).toBe("glossy");
});

test("leaving Glitter keeps the active model's settings for when that model is chosen again", () => {
  const f = fixture(), id = f.layer(0).id;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "glitter" });
  f.ok({ kind: "glitter.selectModel", layerId: id, model: "direct" });
  f.ok({ kind: "glitter.setDirect", layerId: id, key: "strength", value: 5 });
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "matte" });
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "glitter" });
  expect(glitterModel(f.layer(0).flakes)).toBe("classic");
  f.ok({ kind: "glitter.selectModel", layerId: id, model: "direct" });
  expect((f.layer(0).flakes as { strength: number }).strength).toBe(5);
});

test("layer export status follows the preset-level plan Check uses", () => {
  const recipe = initialRecipe();
  const f = fixture(recipe), [matte, shift] = [f.layer(0).id, f.layer(1).id];
  f.ok({ kind: "layer.setFinish", layerId: shift, finish: "iridescent" });
  f.ok({ kind: "layer.setEnabled", id: shift, enabled: true });
  f.ok({ kind: "layer.setEnabled", id: matte, enabled: false });
  // Colour-shift alone in its preset (the Matte layer is hidden): exportable.
  expect(f.app.layerExport(shift)).toMatchObject({ exportable: true, route: "fresnel" });
  // Matte beside it: Check leaves the Colour-shift layer out, and so does the Inspector.
  f.ok({ kind: "layer.setEnabled", id: matte, enabled: true });
  expect(f.layer(0).finish).toBe("matte");
  expect(f.app.layerExport(matte)).toMatchObject({ exportable: true, route: "flat" });
  expect(f.app.layerExport(shift)).toEqual({ exportable: false, reason: FRESNEL_PRESET_RULE, blockedBy: "preset" });
  const plan = planPresetExport(f.document.recipe);
  expect(plan.excluded.map(item => [item.layer.id, item.reason])).toEqual([[shift, FRESNEL_PRESET_RULE]]);
  // A hidden layer is judged as if shown.
  f.ok({ kind: "layer.setEnabled", id: shift, enabled: false });
  expect(f.app.layerExport(shift)).toMatchObject({ exportable: false, blockedBy: "preset" });
  // A finish that cannot export on its own says so as a layer-level reason.
  f.ok({ kind: "layer.setFinish", layerId: matte, finish: "glitter" });
  expect(f.app.layerExport(matte)).toMatchObject({ exportable: false, blockedBy: "layer" });
  expect(f.app.layerExport("missing")).toBeUndefined();
});

test("shift edits are labelled by what they change", () => {
  expect(historyLabel({ kind: "layer.setShift", layerId: "a", key: "color", value: "#112233" }).label).toBe("Shift colour");
  expect(historyLabel({ kind: "layer.setShift", layerId: "a", key: "strength", value: .4 }).label).toBe("Shift strength");
  const f = fixture(), id = f.layer(0).id;
  f.ok({ kind: "layer.setFinish", layerId: id, finish: "iridescent" });
  f.ok({ kind: "layer.setShift", layerId: id, key: "strength", value: .4 });
  expect(f.app.history().undo).toMatchObject({ label: "Shift strength", actionKind: "layer.setShift", layerId: id });
});

test("a host without user-level history reads the same timeline mapper", () => {
  const f = fixture(), id = f.layer(0).id;
  f.ok({ kind: "layer.setOpacity", layerId: id, opacity: .4 });
  const { history: _history, ...services } = { document: f.document, eyeMakeup: f.eyeMakeup,
    undo: f.undo, history: f.history, gestures: f.gestures, controls: f.controls };
  const bare = new StudioApplication(services, STUDIO_REGISTRY);
  expect(bare.historyTimeline()).toEqual({ ...f.app.historyTimeline(), redoCount: 0 });
  expect(bare.historyTimeline().steps.map(step => step.label)).toEqual(["Opacity"]);
});
