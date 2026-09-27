/**
 * Mottle's actions through the application (vector engine extensions §8.4): `effect.mottle.set` and
 * `effect.mottle.preset`, their capabilities, Undo steps and labels, and the recipe schema they lead to.
 */
import { expect, test } from "bun:test";
import { mottlePreset, mottleSeed, nextMottleSeed } from "../src/engines/layered-makeup/mottle";
import type { Recipe } from "../src/engines/layered-makeup/recipe";
import { recipeFile } from "../src/recipe-schema";
import type { StudioAction } from "../src/studio-application";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { historyLabel } from "../src/history-labels";

function fixture(recipe: Recipe = initialRecipe()) {
  const core = createTrustedAuthoringCore(freshWorkspace(recipe), { resetStack: () => {}, selectedCollection: () => "preset-a" }, STUDIO_COMPOSITION);
  const layer = () => core.document.recipe.layers[0];
  const ok = (action: StudioAction) => {
    expect(core.app.capability(action)).toMatchObject({ available: true });
    expect(core.app.dispatch(action)).toMatchObject({ ok: true });
  };
  const refused = (action: StudioAction, reason: string) =>
    expect(core.app.capability(action)).toMatchObject({ available: false, reason });
  return { ...core, layer, ok, refused };
}

test("turning mottle on starts from Powder with a seed from the layer ID; off restores the layer byte for byte", () => {
  const f = fixture(), id = f.layer().id, before = JSON.stringify(f.layer());
  expect(recipeFile(f.document.recipe)!.schema).toBe("xfs/recipe-7");
  f.ok({ kind: "effect.mottle.enable", layerId: id, enabled: true });
  expect(f.layer().effects).toEqual({ mottle: mottlePreset("powder", mottleSeed(id)) });
  expect(recipeFile(f.document.recipe)!.schema).toBe("xfs/recipe-12");
  expect(f.app.history().undo).toMatchObject({ label: "Turn on mottle", actionKind: "effect.mottle.enable", layerId: id });
  // Turning it on again changes nothing and records nothing.
  const depth = f.document.undoDepth;
  expect(f.app.dispatch({ kind: "effect.mottle.enable", layerId: id, enabled: true })).toMatchObject({ ok: true });
  expect(f.document.undoDepth).toBe(depth);
  f.ok({ kind: "effect.mottle.enable", layerId: id, enabled: false });
  expect(JSON.stringify(f.layer())).toBe(before);
  expect(recipeFile(f.document.recipe)!.schema).toBe("xfs/recipe-7");
  // Undo brings the mottle back, Redo takes it off again.
  f.ok({ kind: "history.undo" });
  expect(f.layer().effects?.mottle?.model).toBe("mottle-1");
  f.ok({ kind: "history.redo" });
  expect(JSON.stringify(f.layer())).toBe(before);
});

test("settings need mottle on; streak settings need streaks; values are range-checked", () => {
  const f = fixture(), id = f.layer().id;
  f.refused({ kind: "effect.mottle.set", layerId: id, key: "amount", value: .5 }, "Turn on mottle first.");
  f.ok({ kind: "effect.mottle.preset", layerId: id, preset: "cream" });
  expect(f.layer().effects!.mottle).toEqual(mottlePreset("cream", mottleSeed(id)));
  f.refused({ kind: "effect.mottle.set", layerId: id, key: "angle", value: 30 }, "Choose angled streaks to set their angle.");
  f.refused({ kind: "effect.mottle.set", layerId: id, key: "length", value: 3 }, "Turn on streaks to set their length.");
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "streaks", value: "angle" });
  expect(f.layer().effects!.mottle!.streaks).toEqual({ mode: "angle", angle: 90, length: 4 });
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "angle", value: 30 });
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "length", value: 6 });
  // Switching to edge streaks keeps the length; back to angle remembers nothing it did not keep.
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "streaks", value: "edge" });
  expect(f.layer().effects!.mottle!.streaks).toEqual({ mode: "edge", length: 6 });
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "streaks", value: "off" });
  expect(f.layer().effects!.mottle).not.toHaveProperty("streaks");
  for (const [key, value] of [["amount", 1.5], ["grain", .1], ["clumping", -1], ["seed", 1.5], ["where", "centre"]] as const)
    expect(f.app.capability({ kind: "effect.mottle.set", layerId: id, key, value }).available).toBe(false);
  // A preset keeps the layer's seed.
  f.ok({ kind: "effect.mottle.set", layerId: id, key: "seed", value: nextMottleSeed(mottleSeed(id)) });
  f.ok({ kind: "effect.mottle.preset", layerId: id, preset: "mascara" });
  expect(f.layer().effects!.mottle).toEqual(mottlePreset("mascara", nextMottleSeed(mottleSeed(id))));
});

test("a slider drag is one Undo step labelled by the setting", () => {
  const f = fixture(), id = f.layer().id;
  f.ok({ kind: "effect.mottle.enable", layerId: id, enabled: true });
  const depth = f.document.undoDepth;
  expect(f.app.controlBegin("mottle-amount", id)).toBe(true);
  for (const value of [.5, .6, .7]) f.app.controlEdit("mottle-amount", { kind: "effect.mottle.set", layerId: id, key: "amount", value });
  f.app.controlCommit("mottle-amount");
  expect(f.document.undoDepth).toBe(depth + 1);
  expect(f.layer().effects!.mottle!.amount).toBe(.7);
  expect(f.app.history().undo).toMatchObject({ label: "Mottle amount", actionKind: "effect.mottle.set.amount" });
  expect(historyLabel({ kind: "effect.mottle.set", layerId: id, key: "seed", value: 3 }).label).toBe("Mottle pattern");
  expect(historyLabel({ kind: "effect.mottle.shuffle", layerId: id }).label).toBe("Shuffle mottle");
  expect(historyLabel({ kind: "effect.mottle.preset", layerId: id, preset: "sponge" }).label).toBe("Mottle preset");
});

test("Shuffle is a deterministic next seed, refused until mottle is on; the catalogue lists the presets as data", () => {
  const f = fixture(), id = f.layer().id;
  f.refused({ kind: "effect.mottle.shuffle", layerId: id }, "Turn on mottle first.");
  f.ok({ kind: "effect.mottle.enable", layerId: id, enabled: true });
  f.ok({ kind: "effect.mottle.shuffle", layerId: id });
  expect(f.layer().effects!.mottle!.seed).toBe(nextMottleSeed(mottleSeed(id)));
  expect(f.app.history().undo).toMatchObject({ label: "Shuffle mottle", actionKind: "effect.mottle.shuffle" });
  f.ok({ kind: "history.undo" });
  expect(f.layer().effects!.mottle!.seed).toBe(mottleSeed(id));
  const catalogue = f.app.mottleCatalogue();
  expect(catalogue.map(item => [item.id, item.label])).toEqual([["powder", "Powder"], ["cream", "Cream"], ["mascara", "Mascara smudge"], ["sponge", "Sponge"]]);
  expect(catalogue[2].look).toEqual({ amount: .75, grain: .3, clumping: .3, where: "edges", streaks: { mode: "edge", length: 5 } });
  // Data, not the engine's frozen constants.
  catalogue[0].look.amount = 0;
  expect(f.app.mottleCatalogue()[0].look.amount).toBe(.55);
});

test("mottle survives duplicate, and layer reset removes it", () => {
  const f = fixture(), id = f.layer().id;
  f.ok({ kind: "effect.mottle.preset", layerId: id, preset: "sponge" });
  f.ok({ kind: "layer.edit", command: { kind: "duplicate", id } });
  const copies = f.document.recipe.layers.filter(layer => layer.effects?.mottle);
  expect(copies).toHaveLength(2);
  f.ok({ kind: "layer.edit", command: { kind: "reset", id } });
  expect(f.document.recipe.layers.find(layer => layer.id === id)!.effects).toBeUndefined();
});
