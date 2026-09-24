import { AuthoringControlEdits } from "./authoring-control-edits";
import { AuthoringDocument } from "./authoring-document";
import { AuthoringLayerActions } from "./authoring-layer-actions";
import { AuthoringGestures } from "./authoring-gestures";
import { CollectionService } from "./collection-service";
import { collectionDraft } from "./collection-workspace";
import { PreviewQualityActions } from "./preview-quality-actions";
import { RecipeActions } from "./recipe-actions";
import { StudioApplication } from "./studio-application";
import { freshWorkspace } from "./workspace-state";

/** Small replaceable-presentation fixture: no current sidebar, scene, worker or storage. */
const initial = freshWorkspace(), documentState = new AuthoringDocument(initial);
const undo = () => { const recipe = documentState.undoRecipe();
  if (recipe) documentState.replaceRecipe(recipe,
    recipe.layers.findIndex(layer => layer.id === documentState.recipe.layers[documentState.active]?.id)); };
let collection: CollectionService;
const recipe = new RecipeActions(() => ({ recipe: documentState.recipe, active: documentState.active,
  selected: documentState.selected, fieldSelection: documentState.fieldSelection }),
(next, effect) => documentState.applyActionState(next, effect), documentState, {},
() => collection?.snapshot()?.selected ?? "fixture", index => documentState.gestureChanged(index));
const gestures = new AuthoringGestures(documentState, recipe, undo);
const controls = new AuthoringControlEdits(documentState, action => { recipe.dispatch(action); }, undo);
const quality = new PreviewQualityActions(512, { assess: () => ({ accepted: true }), replace: () => {} });
const layerActions = new AuthoringLayerActions(documentState, () => {});
const app = new StudioApplication({ document: documentState, recipe, gestures, controls, quality,
  layer: action => layerActions.dispatch(action) });
const presetId = crypto.randomUUID(), collectionId = crypto.randomUUID();
collection = new CollectionService(collectionDraft({ schema: "xfas/collection-1", id: collectionId,
  name: "Fixture collection", presets: [{ id: presetId, name: "Fixture preset", revision: 1,
    recipe: documentState.export().recipe }] }), initial.library,
() => documentState.export(), editor => documentState.restore({ ...editor,
  fieldSelection: editor.fieldSelection ?? {} }), {
  list: async () => [], get: async () => { throw Error("Fixture has no saved library."); },
  save: async () => { throw Error("Fixture does not write SQLite."); },
  package: async () => { throw Error("Fixture does not build files."); },
});
app.attach({ collection });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (message: string) => { $("message").textContent = message; };
function run(action: Parameters<StudioApplication["dispatch"]>[0]) {
  const result = app.dispatch(action);
  show(result.ok ? `Applied ${action.kind}` : `${result.code}: ${result.message}`);
}
function paint() {
  const snapshot = app.snapshot(), layer = snapshot.document.recipe.layers[snapshot.document.active];
  const draft = snapshot.collection?.draft;
  const point = layer && { kind: "point", layerId: layer.id, index: 0 } as const;
  const remove = point && app.actionsFor(point).find(item => item.action.kind === "point.remove");
  $("state").textContent = JSON.stringify({ presetCount: draft?.collection.presets.length ?? 0,
    selectedPreset: draft?.selected, layerCount: snapshot.document.recipe.layers.length,
    pointCount: layer?.points.length ?? 0, opacity: layer?.opacity,
    undoDepth: snapshot.document.history.length, quality: snapshot.quality?.size,
    removePoint: remove?.capability,
    finishChoices: layer && app.choicesFor({ kind: "layer", id: layer.id }, "layer.setFinish", "finish")
      .map(choice => ({ value: choice.value, available: choice.capability.available })),
    actionCount: app.actionKinds().length,
    descriptorCount: Object.keys(app.actionDescriptors()).length }, null, 2);
  $<HTMLInputElement>("opacity").value = String(layer?.opacity ?? 0);
  $<HTMLButtonElement>("undo").disabled = !documentState.canUndo;
}
app.subscribe(paint);
$("duplicate-preset").onclick = () => {
  const id = collection.view().draft?.selected;
  if (id) run({ kind: "preset.edit", command: { kind: "copy", id } });
};
$("add-layer").onclick = () => run({ kind: "layer.edit", command: { kind: "add" } });
$("remove-point").onclick = () => {
  const layer = documentState.snapshot().recipe.layers[documentState.active];
  if (layer) run({ kind: "point.remove", layerId: layer.id, index: 0 });
};
$("quality").onclick = () => run({ kind: "quality.set", size: 1024 });
$("undo").onclick = undo;
$("refresh").onclick = () => void app.execute({ kind: "refresh" }).then(outcome =>
  show(outcome.ok ? "Refreshed the fixture library" : `${outcome.code}: ${outcome.message}`));
const opacity = $<HTMLInputElement>("opacity");
opacity.onpointerdown = () => { const layer = documentState.snapshot().recipe.layers[documentState.active];
  if (layer) app.controlBegin("opacity", layer.id); };
opacity.oninput = () => { const layer = documentState.snapshot().recipe.layers[documentState.active];
  if (layer) app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer.id, opacity: +opacity.value }); };
opacity.onchange = () => app.controlCommit("opacity");
opacity.onkeydown = event => { if (event.key === "Escape") { app.controlCancel("opacity"); event.preventDefault(); } };
paint();
