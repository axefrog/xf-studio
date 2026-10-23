import { expect, test } from "bun:test";
import { AuthoringControlEdits } from "../src/app/authoring/authoring-control-edits";
import { AuthoringDocument } from "../src/app/authoring/authoring-document";
import { registeredEditing } from "./gesture-test-adapter";
import { WorkspaceComposer } from "../src/app/workspace/workspace-composer";
import { planLayerPreview, previewCapacity } from "../src/legacy/eye-makeup/preview/authoring-preview-policy";
import { assessPreviewQuality } from "../src/legacy/eye-makeup/preview/preview-quality";
import { RecipeActions } from "../src/legacy/eye-makeup/authoring-eye-makeup";
import { freshWorkspace } from "./fixtures/eye-region";
import { eyeMakeupPort } from "./fixtures/eye-region";

test("form edits group a slider gesture into one Undo and Escape restores its starting value", () => {
  // Escape restores the start through the look scope, which resets the preview's layers once per restore.
  let restores = 0;
  const document = new AuthoringDocument(freshWorkspace(), undefined, { resetStack: () => restores++ });
  const actions = new RecipeActions(() => ({ recipe: document.recipe, active: document.active,
    selected: document.selected, fieldSelection: document.fieldSelection }),
  (next, effect) => document.applyActionState(next, effect), document, {}, () => "draft");
  const edits = new AuthoringControlEdits(document, registeredEditing(eyeMakeupPort(document, actions)).controls);
  const layer = document.recipe.layers[0], original = layer.opacity;
  edits.begin("opacity", layer.id);
  edits.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: .55 });
  edits.edit("opacity", layer.id, { kind: "layer.setOpacity", layerId: layer.id, opacity: .6 });
  edits.commit("opacity");
  expect(document.recipe.layers[0].opacity).toBe(.6);
  expect(document.history.state().depth).toBe(1);
  expect(document.history.undo()).toBe(true);
  expect(document.recipe.layers[0].opacity).toBe(original);
  document.recipe = freshWorkspace().recipe;
  restores = 0;

  const next = document.recipe.layers[0];
  edits.begin("opacity", next.id);
  edits.edit("opacity", next.id, { kind: "layer.setOpacity", layerId: next.id, opacity: .7 });
  edits.cancel("opacity");
  expect(restores).toBe(1);
  expect(document.recipe.layers[0].opacity).toBe(original);
});

test("empty and stale form transactions cannot consume an unrelated Undo entry", () => {
  let restores = 0;
  const document = new AuthoringDocument(freshWorkspace(), undefined, { resetStack: () => restores++ });
  const edits = new AuthoringControlEdits(document, () => false);
  const layer = document.recipe.layers[0];
  edits.begin("weight", layer.id); edits.commit("weight");
  expect(document.history.state().depth).toBe(0);
  edits.begin("weight", layer.id);
  document.recipe = structuredClone(document.recipe);
  edits.cancel("weight");
  expect(restores).toBe(0);
  expect(document.history.state().depth).toBe(1);
});

test("workspace composer keeps pre-preview restoration safe, later uses typed snapshots, and writes the motion fields back as read", () => {
  const workspace = freshWorkspace(), document = new AuthoringDocument(workspace);
  workspace.preview.blink = .25; workspace.preview.idleFace = false; workspace.preview.idleClip = "inventory";
  const preview = { ...workspace.preview, wire: true,
    camera: { position: [0, 0, 1], target: [0, 0, 0], fov: 42 } };
  const composer = new WorkspaceComposer(workspace, {
    editor: () => document.export(), uvView: () => workspace.uvView,
    savedV: () => workspace.savedV, collections: () => workspace.collections,
    quality: () => 512, preview: () => preview,
  });
  const early = composer.capture();
  expect(early.preview.textureSize).toBe(512);
  expect(early.preview.wire).toBe(false);
  composer.setPreviewReady();
  const ready = composer.capture();
  expect(ready.preview.wire).toBe(true);
  expect(ready.preview.camera?.fov).toBe(42);
  // The motion lives in the scene node (scene-motion.ts): the legacy fields stay as they were read, for builds before the move.
  expect(ready.preview).toMatchObject({ blink: .25, idleFace: false, idleClip: "inventory", idle: false });
  expect("panels" in ready).toBe(false);
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
    quality: () => 512, preview: () => undefined,
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
