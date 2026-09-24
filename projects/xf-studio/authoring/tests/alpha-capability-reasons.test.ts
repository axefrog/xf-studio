import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { AuthoringGestures } from "../src/authoring-gestures";
import { applyLayerAction } from "../src/editor-actions";
import { RecipeActions } from "../src/recipe-actions";
import { StudioApplication, type StudioAction, type StudioTarget } from "../src/studio-application";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { freshWorkspace } from "../src/workspace-state";
import { BUILD_NEEDS_SETUP, NO_3D_PREVIEW_IN_ALPHA, USER_FACING_JARGON } from "../src/alpha-availability";

// Release gate for the community alpha: every catalogued action a user can reach
// is either available or explains itself in plain words. Nothing is silently
// disabled and no developer/evidence jargon reaches a reason.

function uvOnlyApp() {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  const undo = () => { const prior = document.undoRecipe(); if (!prior) return false; document.recipe = prior; return true; };
  const recipe = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft",
  index => document.gestureChanged(index));
  const gestures = new AuthoringGestures(document, recipe, undo);
  const controls = new AuthoringControlEdits(document, action => { recipe.dispatch(action); }, undo);
  const app = new StudioApplication({ document, recipe, gestures, controls, undo,
    layer: action => {
      const next = applyLayerAction(document.recipe, document.recipe.layers[document.active]?.id, action);
      document.checkpoint(); document.recipe = next.recipe;
    } });
  app.setPreviewUnavailable(NO_3D_PREVIEW_IN_ALPHA);
  return { app, document };
}

function expectExplained(label: string, capability: { available: boolean; reason?: string }) {
  if (capability.available) return;
  expect({ label, reason: capability.reason?.trim() || "(silent)" }).not.toEqual({ label, reason: "(silent)" });
  expect({ label, jargon: USER_FACING_JARGON.test(capability.reason!) }).toEqual({ label, jargon: false });
}

test("every target-offered action is available or explains itself in plain words", () => {
  const { app, document } = uvOnlyApp();
  const layer = document.recipe.layers[0];
  expect(app.dispatch({ kind: "field.add", layerId: layer.id }).ok).toBe(true);
  const field = document.recipe.layers[0].fields?.[0];
  const targets: StudioTarget[] = [{ kind: "workspace" }, { kind: "collection" },
    ...document.recipe.layers.map(item => ({ kind: "layer" as const, id: item.id })),
    { kind: "point", layerId: layer.id, index: 0 },
    ...(field ? [{ kind: "field" as const, layerId: layer.id, id: field.id }] : [])];
  let checked = 0;
  for (const target of targets) for (const info of app.actionsFor(target)) {
    expectExplained(`${target.kind} › ${JSON.stringify(info.action).slice(0, 80)}`, info.capability);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});

test("every head, camera, motion and saved-V action says the 3D preview is not in this alpha", () => {
  const { app } = uvOnlyApp();
  const kinds = Object.keys(ACTION_DESCRIPTORS).filter(kind => /^(preview|camera|motion|savedV)\./.test(kind));
  expect(kinds.length).toBeGreaterThan(10);
  for (const kind of kinds) {
    const capability = app.capability({ kind } as StudioAction);
    expect({ kind, capability }).toEqual({ kind, capability: { available: false, code: "asset_unavailable", reason: NO_3D_PREVIEW_IN_ALPHA } });
  }
});

test("layer order limits say where the layer already is", () => {
  const { app, document } = uvOnlyApp();
  const front = document.recipe.layers.at(-1)!, back = document.recipe.layers[0];
  const count = document.recipe.layers.length;
  expect(app.contextCapability({ kind: "layer", id: front.id }, { kind: "layer.edit", command: { kind: "move", id: front.id, to: count } }))
    .toMatchObject({ available: false, reason: "This layer is already at the front." });
  expect(app.contextCapability({ kind: "layer", id: back.id }, { kind: "layer.edit", command: { kind: "move", id: back.id, to: -1 } }))
    .toMatchObject({ available: false, reason: "This layer is already at the back." });
});

test("the alpha reasons themselves follow the wording policy", () => {
  for (const reason of [NO_3D_PREVIEW_IN_ALPHA, BUILD_NEEDS_SETUP]) expect(USER_FACING_JARGON.test(reason)).toBe(false);
});
