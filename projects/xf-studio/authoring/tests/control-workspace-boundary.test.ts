import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/authoring-control-edits";
import { AuthoringDocument } from "../src/authoring-document";
import { RecipeActions } from "../src/recipe-actions";
import { WorkspaceComposer } from "../src/workspace-composer";
import { planLayerPreview, previewCapacity } from "../src/authoring-preview-policy";
import { assessPreviewQuality } from "../src/preview-quality";
import { freshWorkspace } from "../src/workspace-state";

test("form edits group a slider gesture into one Undo and Escape restores its starting value", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const actions = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft");
  let restores = 0;
  const edits = new AuthoringControlEdits(document, action => { actions.dispatch(action); }, () => {
    restores++;
    const prior = document.undoRecipe();
    if (prior) document.recipe = prior;
  });
  const layer = document.recipe.layers[0], original = layer.opacity;
  edits.begin("opacity", layer.id);
  edits.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: .55 });
  edits.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: .6 });
  edits.commit("opacity");
  expect(document.recipe.layers[0].opacity).toBe(.6);
  expect(document.undoDepth).toBe(1);
  expect(document.undoRecipe()?.layers[0].opacity).toBe(original);
  document.recipe = freshWorkspace().recipe;

  const next = document.recipe.layers[0];
  edits.begin("opacity", next.id);
  edits.edit("opacity", next.id, { kind: "layer.setOpacity", layerId: next.id, opacity: .7 });
  edits.cancel("opacity");
  expect(restores).toBe(1);
  expect(document.recipe.layers[0].opacity).toBe(original);
});

test("empty and stale form transactions cannot consume an unrelated Undo entry", () => {
  const document = new AuthoringDocument(freshWorkspace());
  let restores = 0;
  const edits = new AuthoringControlEdits(document, () => {}, () => { restores++; });
  const layer = document.recipe.layers[0];
  edits.begin("weight", layer.id); edits.commit("weight");
  expect(document.undoDepth).toBe(0);
  edits.begin("weight", layer.id);
  document.recipe = structuredClone(document.recipe);
  edits.cancel("weight");
  expect(restores).toBe(0);
  expect(document.undoDepth).toBe(1);
});

test("workspace composer keeps pre-preview restoration safe and later uses typed snapshots", () => {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  workspace.panels.layersScroll = 99;
  const panels = { ...workspace.panels, layersScroll: 3, previewQuality: true, lighting: true,
    sidebarLeft: 300, sidebarRight: 400 };
  const preview = { ...workspace.preview, wire: true,
    camera: { position: [0, 0, 1], target: [0, 0, 0], fov: 42 } };
  const motion = { ...workspace.preview, available: true, blink: .4, blinkPlaying: false,
    idle: false, idleTime: 4, idlePaused: false, idleBody: true, idleFace: false };
  const composer = new WorkspaceComposer(workspace, {
    editor: () => document.export(), uvView: () => workspace.uvView,
    savedV: () => workspace.savedV, collections: () => workspace.collections,
    quality: () => 512, preview: () => preview, motion: () => motion,
    sidebar: () => ({ sidebarLeft: panels.sidebarLeft, sidebarRight: panels.sidebarRight }),
    layout: () => panels,
  });
  const early = composer.capture();
  expect(early.preview.textureSize).toBe(512);
  expect(early.preview.wire).toBe(false);
  expect(early.panels.layersScroll).toBe(99);
  expect(early.panels.sidebarLeft).toBe(300);
  composer.setPreviewReady();
  const ready = composer.capture();
  expect(ready.preview.wire).toBe(true);
  expect(ready.preview.camera?.fov).toBe(42);
  expect(ready.preview.blink).toBe(.4);
  expect(ready.preview.idleFace).toBe(false);
  expect(ready.panels.layersScroll).toBe(3);
  ready.recipe.layers[0].color = "#123456";
  expect(document.recipe.layers[0].color).not.toBe("#123456");
});

test("UV-only saves preserve stored camera and motion until a head actually loads", () => {
  const workspace = freshWorkspace();
  workspace.preview.camera = { position: [0, 0, 1], target: [0, 0, 0], fov: 42 };
  workspace.preview.idle = true;
  workspace.preview.idleTime = 8.5;
  workspace.preview.idlePaused = true;
  workspace.preview.idleBody = false;
  workspace.preview.idleFace = true;
  const composer = new WorkspaceComposer(workspace, {
    editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: [], fieldSelection: {} }),
    uvView: () => ({ ...workspace.uvView, span: .25 }),
    savedV: () => workspace.savedV, collections: () => workspace.collections,
    quality: () => 512, preview: () => undefined, motion: () => undefined,
    sidebar: () => ({ sidebarLeft: 260, sidebarRight: 350 }), layout: () => workspace.panels,
  });
  const saved = composer.capture();
  expect(saved.preview.camera).toEqual(workspace.preview.camera);
  expect(saved.preview).toMatchObject({ idle: true, idleTime: 8.5, idlePaused: true, idleBody: false, idleFace: true,
    textureSize: 512 });
  expect(saved.uvView.span).toBe(.25);
});

test("preview policy exposes capacity, active priority, optics and disabled placeholders", () => {
  const recipe = freshWorkspace().recipe;
  recipe.layers[0].finish = "shimmer";
  const accepted = assessPreviewQuality(recipe, 512, 4096);
  let opticsCalls = 0;
  const input = { recipe, index: 0, active: 0, size: 512 as const, assessment: accepted,
    blocked: false, opticsMissing: () => { opticsCalls++; return true; } };
  expect(previewCapacity(accepted).available).toBe(true);
  expect(planLayerPreview(input)).toMatchObject({ kind: "request", size: 512,
    priority: true, needsOptics: true });
  expect(opticsCalls).toBe(1);
  expect(planLayerPreview({ ...input, blocked: true })).toMatchObject({ kind: "recover" });
  expect(opticsCalls).toBe(1);
  recipe.layers[0].enabled = false;
  expect(planLayerPreview(input)).toMatchObject({ kind: "request", releaseDisabled: true,
    size: 1, needsOptics: false });
  const rejected = assessPreviewQuality(recipe, 512, 256);
  expect(previewCapacity(rejected).available).toBe(false);
  expect(planLayerPreview({ ...input, assessment: rejected })).toMatchObject({ kind: "unavailable",
    releaseDisabled: true, reason: rejected.error });
  expect(planLayerPreview({ ...input, index: 999 })).toEqual({ kind: "missing" });
});
