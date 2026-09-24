import { type Recipe, type Layer } from "./recipe";
import { type LayerCommand } from "./layer-stack";
import { type LayerAction } from "./editor-actions";
import { AuthoringLayerActions } from "./authoring-layer-actions";
import { AuthoringDocument } from "./authoring-document";
import type { ReadonlyDeep } from "./read-only";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringPresentation } from "./authoring-presentation";
import { WorkspacePersistence } from "./workspace-persistence";
import { WorkspaceComposer } from "./workspace-composer";
import { layerList } from "./layer-ui";
import { setupSidebars } from "./sidebar-ui";
import { setupContextMenus } from "./context-menu";
import { createScene } from "./scene";
import { createSurfaceEditor } from "./surface-editor";
import { AuthoringRenderScheduler } from "./authoring-render-scheduler";
import { AuthoringGestures } from "./authoring-gestures";
import { AuthoringControlEdits } from "./authoring-control-edits";
import { StudioApplication, type StudioAction } from "./studio-application";
import { AuthoringPreviewCoordinator } from "./authoring-preview-coordinator";
import { StudioFileOperations, type StudioFileAction, type StudioFileKind } from "./studio-file-operations";
import { bindControlEdit } from "./control-edit-ui";
import { createRasterClient } from "./raster-client";
import { setupFields } from "./field-ui";
import type { PigmentCommand } from "./pigment-edit";
import type { SoftnessCommand } from "./softness-edit";
import { RecipeActions, type RecipeAction } from "./recipe-actions";
import { setupSoftness } from "./softness-ui";
import { setupPreviewQuality } from "./preview-quality-ui";
import type { PreviewQualityActions } from "./preview-quality-actions";
import type { RasterResponse,GlitterStats } from "./raster-processor";
import { setupPigment } from "./pigment-ui";
import { setupPathControls, type PathCommand } from "./path-ui";
import { createUVEditor } from "./uv-editor";
import { ViewportAdapter } from "./viewport-adapter";
import { PreviewActions } from "./preview-actions";
import { setupCollections } from "./collection-ui";
import { setupMotionControls } from "./motion-ui";
import { MotionActions } from "./motion-actions";
import { SavedAppearanceActions, type SavedAppearanceState } from "./saved-appearance-actions";
import { loadWorkspace, workspaceKeys, type WorkspaceState } from "./workspace-state";
import {
  canonicalFinish,
  defaultFlakes,
  isIrregular,
  finishLabel,
  finishDescription,
} from "./finish";
import {FLAKE_LIMITS} from "./flake-field";
import {isDirectGlint} from "./direct-glint-settings";
import {glitterModel, type GlitterModel} from "./glitter-model";
import {studioIrregularOpticalKey,maskAlphaKey} from "./makeup-dependencies";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
setupContextMenus(document);
const status = (text: string) => {
  $("status").textContent = text;
};
const verification = new URLSearchParams(location.search).has("verify");
const restored = loadWorkspace({ getItem: key => localStorage.getItem(key) }, verification);
const workspace = restored.state;
const initialTextureSize = workspace.preview.textureSize;
let qualityActions: PreviewQualityActions;
type PreviewOptics = NonNullable<Extract<RasterResponse, {data: unknown}>["optics"]>;
type PreviewAlbedo = NonNullable<Extract<RasterResponse, {data: unknown}>["albedo"]>;
let initialOptics: ({ key: string; data?: PreviewOptics; albedo?:PreviewAlbedo } | undefined)[] = [];
const opticalKey = (layer: ReadonlyDeep<Layer>, size: number) => isIrregular(layer.flakes) && layer.finish === "glitter"
  ? studioIrregularOpticalKey(layer.flakes,size)
  : JSON.stringify([canonicalFinish(layer.finish), layer.flakes ?? defaultFlakes(), size]);
const authoring = new AuthoringDocument({ recipe: workspace.recipe, active: workspace.active,
  selected: workspace.selected, fieldSelection: workspace.fieldSelection, history: workspace.history });
const geometry = new AuthoringGeometry(authoring);
const presentation = new AuthoringPresentation(authoring, geometry);
const glitterChoices = workspace.glitterChoices;
const glitterMeasurements=new Map<string,{opticalKey:string;maskKey:string;stats:GlitterStats}>();
let presetLibrary: ReturnType<typeof setupCollections> | undefined;
function checkpoint() {
  authoring.checkpoint();
}
const canvases = Array.from({ length: authoring.recipe.layers.length }, () => {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c;
});
function emptyPreviewCanvases() {
  return authoring.recipe.layers.map(() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; return canvas; });
}
let viewer: Awaited<ReturnType<typeof createScene>> | undefined;
let previewActions: PreviewActions | undefined;
let motionActions: MotionActions | undefined;
let savedAppearance: SavedAppearanceActions | undefined;
// Presentation reads use a versioned detached view; only application and
// renderer services below retain trusted access to the live document recipe.
const current = () => presentation.layer();
function showGlitterMeasurement(){
  const layer=current();
  if(!layer || layer.finish!=="glitter" || !isIrregular(layer.flakes))return;
  const prior=glitterMeasurements.get(layer.id);
  const valid=prior?.opticalKey===opticalKey(layer,previewCoordinator.size) &&
    prior.maskKey===maskAlphaKey(layer,previewCoordinator.size);
  const note=$("irregular-visible-note");
  const scope=layer.flakes.count>FLAKE_LIMITS.count?"retained in the eye UV regions":"generated across the UV atlas";
  note.textContent=valid
    ? `${prior.stats.maskCentres.toLocaleString()} approximate flake centres in this painted shape from ${prior.stats.regionRetained.toLocaleString()} ${scope}. ${prior.stats.coveredPixels.toLocaleString()} painted texture pixels contain any flake coverage at ${previewCoordinator.size}²; these are not visible screen glints.`
    : "Calculating flakes in this painted shape. Field density is not a visible flake count.";
}
const currentField = () => presentation.selectedField();
function selectField(id: string) {
  const l = current(); if (l) dispatchRecipeAction({ kind: "field.select", layerId: l.id, fieldId: id });
}
const panel = document.querySelector<HTMLElement>(".properties")!;
const layersPanel = document.querySelector<HTMLElement>(".layers-panel")!;
const viewport = new ViewportAdapter();
const sidebars = setupSidebars(workspace.panels, () => { persist(); viewport.resize(); });
const layout = (): WorkspaceState["panels"] => ({ ...sidebars.snapshot(),
  lighting: $<HTMLDetailsElement>("lighting-panel").open,
  previewQuality: $<HTMLDetailsElement>("quality-panel").open,
  layersScroll: layersPanel.scrollTop, propertiesScroll: panel.scrollTop, pageX: scrollX, pageY: scrollY });
const workspaceComposer = new WorkspaceComposer(workspace, {
  editor: () => authoring.export(), uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
  savedV: () => savedAppearance?.snapshot().savedV ?? workspace.savedV,
  collections: () => presetLibrary?.snapshot() ?? workspace.collections,
  quality: () => qualityActions?.snapshot().size ?? initialTextureSize,
  preview: () => previewActions?.snapshot(), motion: () => motionActions?.snapshot(),
  sidebar: () => sidebars.snapshot(), layout,
});
function snapshot(): WorkspaceState { return workspaceComposer.capture(); }
const workspacePersistence = new WorkspacePersistence({ storage: localStorage,
  key: workspaceKeys(verification).workspace, writable: restored.writable,
  restoreError: restored.error, capture: snapshot });
workspacePersistence.subscribe(state => { $("save-state").textContent = state.message; });
authoring.subscribe(() => workspacePersistence.request());
function flushWorkspace() { workspacePersistence.flush(); }
function persist() { workspacePersistence.request(); }
window.addEventListener("pagehide", flushWorkspace);
window.addEventListener("scroll", persist);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushWorkspace(); });
// UI adapters trigger one snapshot after their own handlers update state.
document.addEventListener("input", persist);
document.addEventListener("change", persist);
document.addEventListener("click", persist);
$("lighting-panel").addEventListener("toggle", persist);
$("quality-panel").addEventListener("toggle", persist);
$<HTMLDetailsElement>("quality-panel").open = workspace.panels.previewQuality;
panel.addEventListener("scroll", persist);
layersPanel.addEventListener("scroll", persist);
let uvEditor: ReturnType<typeof createUVEditor> | undefined;
let refreshFields: (() => void) | undefined;
let refreshPigment: (() => void) | undefined;
let refreshSoftness: (() => void) | undefined;
let refreshQuality: (() => void) | undefined;
let refreshPath: (() => void) | undefined;
function drawUV() { uvEditor?.draw(); }
const paintLayerList = layerList($("layers"), {
  select(i) { const layer = presentation.recipe().layers[i]; if (layer)
    dispatchRecipeAction({ kind: "layer.select", layerId: layer.id }); },
  rename(i) { const layer = presentation.recipe().layers[i]; if (!layer) return;
    dispatchRecipeAction({ kind: "layer.select", layerId: layer.id });
    input("layer-name").focus(); input("layer-name").select(); },
  toggle(i, enabled) { const layer = presentation.recipe().layers[i]; if (layer)
    dispatchLayer({ kind: "layer.setEnabled", id: layer.id, enabled }); },
  edit: changeLayers,
});
function layerCards() { paintLayerList(presentation.recipe(), presentation.active); }
function replaceRecipe(next: Recipe, nextActive = 0) {
  authoring.replaceRecipe(next, nextActive);
  resetStackResources();
}
function resetStackResources() {
  previewCoordinator.resetStack();
}
function changeLayers(command: LayerCommand) {
  dispatchLayer({ kind: "layer.edit", command });
}
function dispatchLayer(action: LayerAction) {
  try {
    applyLayerCommand(action);
  } catch (error) { status((error as Error).message); sync(); }
}
function applyLayerCommand(action: LayerAction) {
  layerActions.dispatch(action);
}
const layerActions = new AuthoringLayerActions(authoring, resetStackResources);
$("layer-add").onclick = () => changeLayers({ kind: "add" });
$("layer-copy").onclick = () => { const layer = current(); if (layer) changeLayers({ kind: "duplicate", id: layer.id }); };
const layerName = input("layer-name");
function commitLayerName() {
  const layer = current();
  if (layer && layerName.value !== layer.name)
    changeLayers({ kind: "rename", id: layer.id, name: layerName.value });
}
layerName.onchange = layerName.onblur = commitLayerName;
layerName.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commitLayerName(); } };
function sync() {
  presetLibrary?.refreshSummary();
  refreshFields?.();
  refreshPigment?.();
  refreshSoftness?.();
  refreshQuality?.();
  refreshPath?.();
  const l = current();
  $("layer-count").textContent = String(presentation.recipe().layers.length).padStart(2, "0");
  $<HTMLFieldSetElement>("layer-properties").disabled = !l;
  $("layer-properties").inert = !l;
  $<HTMLButtonElement>("export").disabled = !l;
  $<HTMLButtonElement>("layer-add").disabled = !app.capability({ kind: "layer.edit", command: { kind: "add" } }).available;
  $<HTMLButtonElement>("layer-copy").disabled = !l || !app.contextCapability({ kind: "layer", id: l.id },
    { kind: "layer.edit", command: { kind: "duplicate", id: l.id } }).available;
  $<HTMLButtonElement>("undo").disabled = !authoring.canUndo;
  if (!l) { $("active-name").textContent = "Add a makeup layer"; layerCards(); return; }
  input("layer-name").value = l.name;
  $("active-name").textContent = l.name;
  $("point-label").textContent = `Point ${presentation.selected + 1} / ${l.points.length}`;
  input("color").value = l.color;
  input("symmetry").checked = l.symmetry;
  $<HTMLSelectElement>("finish").value = canonicalFinish(l.finish);
  $("finish-note").textContent = finishDescription(l.finish);
  $("flake-controls").hidden = !["shimmer", "glitter"].includes(
    canonicalFinish(l.finish),
  );
  $("glitter-suite").hidden = l.finish !== "glitter";
  if (l.finish === "glitter") {
    const model = glitterModel(l.flakes);
    $<HTMLSelectElement>("glitter-model").value = model;
    $("glitter-model-summary").textContent = {
      classic: "Original reflective flake map; existing classic recipes retain this look.",
      irregular: "Irregular flakes are baked into a texture. Dense settings cover the eye UV area and can lose sparkle at face distance.",
      direct: "Fine facets and occasional larger flashes respond to the preview light.",
      clustered: "Fine facets gather in soft clusters over a continuous sheen.",
      fine: "Denser tiny speckles with a sparse population of larger flashes; can look frosty.",
    }[model];
  }
  $("flake-legacy").hidden = l.finish === "glitter" && (isIrregular(l.flakes) || isDirectGlint(l.flakes));
  $("flake-legacy-title").textContent = l.finish === "glitter" ? "CLASSIC REFLECTIVE FLAKES" : "SHIMMER FLAKES";
  $("flake-irregular").hidden = !(isIrregular(l.flakes) && l.finish === "glitter");
  $("flake-direct").hidden = !(isDirectGlint(l.flakes) && l.finish === "glitter");
  const flakes = (l.flakes ? { ...l.flakes } : defaultFlakes()) as NonNullable<Layer["flakes"]>;
  for (const id of ["cells", "density", "tilt"] as const) {
    const legacy = isIrregular(flakes) || isDirectGlint(flakes) ? defaultFlakes() : flakes;
    input("flake-" + id).value = String(legacy[id]);
    $("flake-" + id + "-value").textContent =
      id === "cells" ? String(legacy[id]) : `${Math.round(legacy[id] * 100)}%`;
  }
  if (isIrregular(flakes)) for (const id of ["count","radius","spread","tilt","color"] as const) {
    if(id==="radius") {
      input("irregular-radius").min=flakes.count>FLAKE_LIMITS.count?".00025":".0004";
      input("irregular-radius").max=flakes.count>FLAKE_LIMITS.count?".0006":".003";
    }
    input("irregular-"+id).value=String(id==="count"?Math.round(flakes.count/5000):flakes[id]);
    if(id!=="color") $("irregular-"+id+"-value").textContent=id==="count"?`${Math.round(flakes.count/5000)}%`:id==="radius"?`${(flakes[id]*100).toFixed(3)}% UV`:`${Math.round(flakes[id]*100)}%`;
  }
  if(isIrregular(flakes))showGlitterMeasurement();
  if(isDirectGlint(flakes)){
    $("direct-density-label").textContent=flakes.model==="uv-cell-direct-1"?"Facet density":"Maximum facet density";
  }
  if(isDirectGlint(flakes))for(const id of ["density","fineShare","strength","color"] as const){
    input("direct-"+id).value=String(flakes[id]);
    if(id!=="color")$("direct-"+id+"-value").textContent=id==="strength"?flakes.strength.toFixed(1):`${Math.round(flakes[id]*100)}%`;
  }
  for (const [id, value] of Object.entries({
    weight: l.points[presentation.selected].weight,
    opacity: l.opacity,
  })) {
    input(id).value = String(value);
    $(id + "-value").textContent =
      id === "feather" || id === "radius"
        ? `${(value * 100).toFixed(2)}% UV`
        : `${Math.round(value * 100)}%`;
  }
  $<HTMLButtonElement>("remove").disabled = !app.contextCapability({ kind: "point", layerId: l.id, index: presentation.selected },
    { kind: "point.remove", layerId: l.id, index: presentation.selected }).available;
  $<HTMLButtonElement>("undo").disabled = !authoring.canUndo;
  layerCards();
}
let previewCoordinator: AuthoringPreviewCoordinator;
const maskClient = createRasterClient(() => new Worker("/build/raster-worker.js", { type: "module" }),
  result => previewCoordinator.publish(result), reason => previewCoordinator.fail(reason));
previewCoordinator = new AuthoringPreviewCoordinator(authoring, initialTextureSize, {
  maxTextureSize: () => viewer?.renderer.capabilities.maxTextureSize ?? 4096,
  resourceSize: i => canvases[i]?.width ?? 0,
  needsOptics: (i, layer, size) => viewer ? viewer.needsOptics(i, layer, size)
    : initialOptics[i]?.key !== opticalKey(layer, size),
  needsPresentationMaps: (i, layer, size) => !!viewer &&
    (viewer.needsOptics(i, layer, size) || viewer.needsAlbedo(i, layer, size)),
  queue: () => maskClient.diagnostics(),
  reset: () => maskClient.reset(),
  replaceResources: () => {
    // Dispose the previous tier or stack before allocating its replacement.
    canvases.splice(0, canvases.length, ...emptyPreviewCanvases());
    initialOptics = [];
    viewer?.setLayerCanvases(canvases);
  },
  releaseDisabled: (i, layer) => {
    if (canvases[i].width !== 1) {
      const empty = document.createElement("canvas"); empty.width = empty.height = 1;
      canvases[i] = empty; viewer?.setLayerCanvas(i, empty);
    }
    initialOptics[i] = undefined; viewer?.updateLayer(i, layer);
  },
  request: (i, layer, priority, size, needsOptics) => maskClient.request(i, layer, priority, size, needsOptics),
  updateLayer: (i, layer) => { viewer?.updateLayer(i, layer); },
  publish: ({ i, data, size, optics, albedo, glitterStats }, layer) => {
    if (canvases[i].width !== size) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
      canvases[i] = canvas;
    }
    canvases[i]
      .getContext("2d")!
      .putImageData(new ImageData(data, size, size), 0, 0);
    viewer?.setLayerCanvas(i, canvases[i]);
    if (viewer) { viewer.updateLayer(i, layer, optics, albedo, true); initialOptics[i] = undefined; }
    else if (optics || albedo) {
      const key=opticalKey(layer,size), prior=initialOptics[i];
      initialOptics[i] = { key, data:optics ?? (prior?.key===key?prior.data:undefined), albedo };
    }
    else if (!layer.enabled || !["shimmer", "glitter"].includes(canonicalFinish(layer.finish))) initialOptics[i] = undefined;
    if(glitterStats && layer.finish==="glitter" && isIrregular(layer.flakes)){
      glitterMeasurements.set(layer.id,{opticalKey:opticalKey(layer,size),maskKey:maskAlphaKey(layer,size),stats:glitterStats});
      if(i===authoring.active)showGlitterMeasurement();
    }
    drawUV();
  },
  renderAll: order => renderScheduler.renderAll(order),
  refresh: () => { sync(); drawUV(); persist(); },
  refreshQuality: () => { refreshQuality?.(); },
  report: status,
});
qualityActions = previewCoordinator.quality;
qualityActions.subscribe(() => { refreshQuality?.(); persist(); });
refreshQuality = setupPreviewQuality({ choices: $("quality-options"), note: $("quality-state"), retry: $<HTMLButtonElement>("quality-rebuild") },
  { current: () => qualityActions.snapshot().size, describe: () => previewCoordinator.describeQuality(),
    set: size => { dispatchStudio({ kind: "quality.set", size }); },
    rebuild: () => { dispatchStudio({ kind: "quality.rebuild" }); } });
const renderScheduler = new AuthoringRenderScheduler(authoring, {
  frame: run => requestAnimationFrame(run), render: i => previewCoordinator.render(i),
  refreshSelection: () => { sync(); drawUV(); persist(); },
});
const recipeActions = new RecipeActions(
  () => ({ recipe: authoring.recipe, active: authoring.active,
    selected: authoring.selected, fieldSelection: authoring.fieldSelection }),
  (next, effect) => authoring.applyActionState(next, effect),
  authoring, glitterChoices, () => presetLibrary?.snapshot()?.selected ?? "draft",
  (i, kind) => authoring.gestureChanged(i, kind));
function dispatchRecipeAction(action: RecipeAction, record = false) {
  try { recipeActions.dispatch(action, record); }
  catch (error) {
    status(action.kind === "glitter.setIrregular"
      ? "This amount and flake size exceed the fine Glitter preview range. Reduce size before raising amount."
      : (error as Error).message);
    sync();
  }
}

function undo() {
  const next = authoring.undoRecipe();
  if (!next) return;
  replaceRecipe(next, next.layers.findIndex(l => l.id === current()?.id));
}
const gestures = new AuthoringGestures(authoring, recipeActions, undo);
const controlEdits = new AuthoringControlEdits(authoring, action => dispatchRecipeAction(action), undo);
const app = new StudioApplication({ document: authoring, recipe: recipeActions,
  layer: applyLayerCommand, gestures, controls: controlEdits, quality: qualityActions });
const beginControl = (id: string) => { const layer = current(); if (layer) app.controlBegin(id, layer.id); };
const controlAction = (id: string, action: RecipeAction) => app.controlEdit(id, action);
function dispatchStudio(action: StudioAction) {
  const outcome = app.dispatch(action);
  if (!outcome.ok) { status(outcome.message); sync(); }
  return outcome;
}
function bindEdit(id: string, control: HTMLInputElement) {
  bindControlEdit(control, { begin: () => beginControl(id),
    commit: () => app.controlCommit(id), cancel: () => app.controlCancel(id) });
}
$("undo").onclick = undo;
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !((e.target as HTMLElement)?.matches("input:not([type=range]), textarea"))) {
    e.preventDefault();
    undo();
  }
});
for (const id of ["weight", "opacity", "color"]) {
  const control = input(id);
  bindEdit(id, control);
  control.oninput = () => {
    const l = current();
    if (!l) return;
    if (id === "color") controlAction(id, { kind: "layer.setColor", layerId: l.id, color: control.value });
    else if (id === "weight") controlAction(id, { kind: "pigment.edit", layerId: l.id,
      command: { kind: "point-strength", index: presentation.selected, value: +control.value } });
    else controlAction(id, { kind: "layer.setOpacity", layerId: l.id, opacity: +control.value });
  };
}
input("symmetry").onchange = () => {
  const l = current(); if (l) dispatchStudio({ kind: "layer.setSymmetry", layerId: l.id,
    symmetry: input("symmetry").checked });
};
$<HTMLSelectElement>("finish").onchange = () => {
  const l=current(); if (l) dispatchStudio({ kind: "layer.setFinish", layerId: l.id,
    finish: $<HTMLSelectElement>("finish").value as Layer["finish"] });
};
for (const id of ["cells", "density", "tilt"] as const) {
  const control = input("flake-" + id);
  bindEdit("flake-" + id, control);
  control.oninput = () => {
    const l = current();
    if (l) controlAction("flake-" + id, { kind: "glitter.setClassic", layerId: l.id, key: id, value: +control.value });
  };
}
$<HTMLSelectElement>("glitter-model").onchange = () => {
  const layer = current(), model = $<HTMLSelectElement>("glitter-model").value as GlitterModel;
  if (layer) dispatchStudio({ kind: "glitter.selectModel", layerId: layer.id, model });
};
for (const id of ["count","radius","spread","tilt","color"] as const) {
  const control=input("irregular-"+id);
  bindEdit("irregular-"+id, control);
  control.oninput=()=>{
    const l=current(); if(!l || !isIrregular(l.flakes))return;
    controlAction("irregular-"+id, { kind: "glitter.setIrregular", layerId: l.id, key: id,
      value: id === "color" ? control.value : id === "count" ? +control.value*5000 : +control.value });
  };
}
for(const id of ["density","fineShare","strength","color"] as const){
  const control=input("direct-"+id);
  bindEdit("direct-"+id, control);
  control.oninput=()=>{
    const l=current();if(!l)return;
    controlAction("direct-"+id, { kind: "glitter.setDirect", layerId: l.id, key: id,
      value: id === "color" ? control.value : +control.value });
  };
}
function changePath(command: PathCommand) {
  const layer = current(); if (layer) dispatchRecipeAction({ kind: "path.edit", layerId: layer.id, command }, true);
}
refreshPath = setupPathControls({
  enable: $("path-enable"), modes: $("point-modes"), note: $("path-note"),
  aligned: $("point-aligned"), symmetric: $("point-symmetric"), corner: $("point-corner"),
}, { layer: current, selected: () => presentation.selected, edit: changePath });
function changePigment(command: PigmentCommand) {
  const layer = current(); if (layer) controlAction(command.kind === "smooth-strength" ? "smooth-strength" : "strength-blend",
    { kind: "pigment.edit", layerId: layer.id, command });
}
refreshPigment = setupPigment({
  smooth: input("smooth-strength"), blend: input("strength-blend"),
  value: $("strength-blend-value"), note: $("strength-note"),
}, { layer: current, begin: beginControl, commit: id => app.controlCommit(id),
  cancel: id => app.controlCancel(id), edit: changePigment });
function changeSoftness(command: SoftnessCommand) {
  const layer = current(); if (layer) controlAction(command.kind === "variable-softness" ? "variable-softness" : "feather",
    { kind: "softness.edit", layerId: layer.id, command });
}
refreshSoftness = setupSoftness({
  variable: input("variable-softness"), width: input("feather"), label: $("feather-label"),
  value: $("feather-value"), note: $("softness-note"),
}, { layer: current, selected: () => presentation.selected, begin: beginControl,
  commit: id => app.controlCommit(id), cancel: id => app.controlCancel(id), edit: changeSoftness });
refreshFields = setupFields({
  list: $("field-list"), add: $("field-add"), remove: $("field-remove"), clear: $("clear-field"),
  reach: input("radius"), value: $("radius-value"), note: $("field-note"),
}, { layer: current, selected: currentField, select: selectField, begin: beginControl,
  commit: id => app.controlCommit(id), cancel: id => app.controlCancel(id),
  edit: (action, record) => action.kind === "field.setReach" ? controlAction("radius", action) : dispatchRecipeAction(action, record) });
$("reset").onclick = () => { const layer = current(); if (layer) changeLayers({ kind: "reset", id: layer.id }); };
$("remove").onclick = () => {
  const l = current(); if (l) dispatchStudio({ kind: "point.remove", layerId: l.id, index: presentation.selected });
};
uvEditor = createUVEditor($<HTMLCanvasElement>("uv"), {
  both: $("uv-both"), single: $("uv-single"), other: $("uv-other"), fit: $("uv-fit"), note: $("uv-view-note"),
}, {
  recipe: () => geometry.recipe(), layer: () => geometry.layer(), selected: () => presentation.selected,
  selectedField: () => currentField()?.id, selectField, canvases: () => canvases,
  albedo: () => viewer?.albedo.image as HTMLImageElement | undefined,
  select: index => { const l = current(); if (l) dispatchRecipeAction({ kind: "point.select", layerId: l.id, index }); },
  begin: () => { const layer = current(); if (layer) app.beginGesture("uv", layer.id); },
  apply: action => { const accepted = app.applyGesture("uv", action); if (accepted) geometry.recipe(); return accepted; },
  cancel: () => app.endGesture("uv", true), finish: () => app.endGesture("uv"), persist, message: status,
}, workspace.uvView);
viewport.attach("uv", uvEditor);
const fileOperations = new StudioFileOperations({
  pick: kind => new Promise(resolve => {
    const id: Record<StudioFileKind, string> = { recipe: "file", collection: "collection-file", savedV: "v-file" };
    const picker = input(id[kind]);
    const complete = () => {
      picker.removeEventListener("change", selected);
      picker.removeEventListener("cancel", cancelled);
      const file = picker.files?.[0]; picker.value = "";
      resolve(file ? { name: file.name, size: file.size, text: () => file.text(),
        bytes: async () => new Uint8Array(await file.arrayBuffer()) } : undefined);
    };
    const selected = () => complete(), cancelled = () => complete();
    picker.value = "";
    picker.addEventListener("change", selected, { once: true });
    picker.addEventListener("cancel", cancelled, { once: true });
    picker.click();
  }),
  download: (blob, name) => {
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  bakeMask: layer => new Promise((resolve, reject) => {
    const bake = new Worker("/build/raster-worker.js", { type: "module" });
    bake.onmessage = e => {
      try {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2048;
        canvas.getContext("2d")!.putImageData(new ImageData(e.data.data, 2048, 2048), 0, 0);
        bake.terminate();
        canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("Mask export failed.")));
      } catch (error) { bake.terminate(); reject(error); }
    };
    bake.onerror = () => { bake.terminate(); reject(Error("Mask export failed.")); };
    bake.postMessage({ i: 0, version: 0, layer: { ...layer, enabled: true }, size: 2048 });
  }),
}, {
  recipe: () => presentation.recipe(), selectedLayer: current,
  importRecipe: (recipe, name) => presetLibrary!.importRecipe(recipe, name),
  hasSavedV: () => savedAppearance?.hasSavedV() ?? false,
  savedV: () => savedAppearance?.snapshot().savedV,
  loadSavedV: bytes => savedAppearance!.dispatch({ kind: "savedV.load", bytes }),
  savedVReady: () => !!viewer,
  executeCollection: request => app.execute(request),
  recoverCollection: () => presetLibrary!.service.dispatch({ kind: "collection.undoOpen" }),
});
async function runFile(action: StudioFileAction) {
  const previousStatus = $("status").textContent ?? "";
  if (action.kind === "mask.export") status("Baking 2048² mask…");
  if (action.kind === "savedV.import" && viewer) status("Reading saved appearance locally…");
  const outcome = await fileOperations.execute(action);
  if (!outcome.ok) {
    if (outcome.code === "cancelled") status(previousStatus);
    else status(outcome.message);
    return;
  }
  if (action.kind === "savedV.import" && outcome.savedAppearance) {
    showSavedV(outcome.savedAppearance);
    if (outcome.savedAppearance.suggestedEyeShape !== undefined) {
      shape.value = String(outcome.savedAppearance.suggestedEyeShape);
      previewActions?.rememberEyeShape(outcome.savedAppearance.suggestedEyeShape);
    }
    persist();
  }
  if (action.kind !== "savedV.export") status(outcome.message);
}
fileOperations.subscribe(() => {
  $<HTMLButtonElement>("export").disabled = !fileOperations.capability({ kind: "mask.export" }).available;
});
$("save").onclick = () => void runFile({ kind: "recipe.export" });
$("load").onclick = () => void runFile({ kind: "recipe.import" });
$("export").onclick = () => void runFile({ kind: "mask.export" });
$("open-v").onclick = () => void runFile({ kind: "savedV.import" });
presetLibrary = setupCollections(() => authoring.export(), editor => {
  authoring.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} });
  resetStackResources();
}, workspace.collections, workspace.library, persist, fileOperations, app);
function showSavedV(state: Readonly<SavedAppearanceState>) {
  const { result, savedV } = state;
  if (!result || !savedV) return;
  $("v-details").textContent =
    result.matchedDetails.length === 2
      ? "Brows and lashes match the saved resource references; colours are approximate."
      : "Brows and lashes are reference styles, not a resolved match for this save.";
  $("v-hair").textContent = result.matchedHair
    ? "Saved hair mesh matched; colour, strand shading and physics are approximate."
    : "Saved hair is unresolved or its local assets are unavailable.";
  input("hair").disabled = !result.matchedHair;
  $("v-piercings").textContent = result.matchedPiercing
    ? "Saved vanilla piercing reference matched; materials and game lighting remain approximate."
    : "No matching vanilla piercing is selected in this save. You can try a viewport-only style below.";
  $("v-eyes").textContent = result.eyeAppearance.message;
  refreshEyeOpticsNote();
  $("v-card").hidden = false;
  $("v-summary").textContent =
    `${result.applied.length} facial regions applied. ${result.appearanceReferences} appearance references read. Game ${(savedV.gameVersion / 1000).toFixed(2)}.`;
}
function refreshEyeOpticsNote() {
  if (!viewer) return;
  const eye = viewer.eyeAppearance();
  $("eye-optics-note").textContent = eye.optics.active
    ? "Source roughness R × material scale. Browser study only; eye normals, refraction and game lighting remain unmatched."
    : !eye.optics.requested ? "Off: original diffuse-only eye preview. Enable for the exactly matched saved eye."
    : eye.optics.error ? `Source eye roughness unavailable: ${eye.optics.error}. Diffuse-only fallback is active.`
    : "No matching source roughness map is loaded. Diffuse-only fallback is active.";
}
function setupPiercingControls() {
  const style = $<HTMLSelectElement>("piercing-style"), colour = $<HTMLSelectElement>("piercing-colour"),
    styles = viewer!.piercingStyles;
  if (!styles.length) {
    $("piercing-note").textContent = `Piercing preview unavailable: ${viewer!.evidence.piercingError}; ${viewer!.evidence.prcError}.`;
    return;
  }
  function updatePiercingNote() {
    $("piercing-note").textContent = !viewer!.prcManifest
      ? "A preview choice changes only this viewport. PRC resources are unavailable; vanilla material colours remain approximate."
      : style.value === "prc_active_bank"
        ? "Private PRC preview: active candidate slots 50, 72 and 74 together. The stud's small second chunk stays approximate silver across framework colours; exact material response and game winners remain unverified. Viewport only."
        : style.value.startsWith("prc_")
          ? "Single PRC slot for inspection only; the game framework includes the active slots together. The stud's second chunk stays source-derived approximate silver; other colours and effective winners remain approximate or unresolved. Viewport only."
          : "Vanilla and private PRC choices change only this viewport. PRC has an aggregate active-slot view and separate diagnostic slot views; materials and runtime winners remain unverified.";
  }
  input("piercings").disabled = false;
  style.disabled = false;
  for (const entry of styles) {
    const option = document.createElement("option");
    option.value = entry.id; option.textContent = entry.label; style.append(option);
  }
  function fillColours(preferred = "") {
    colour.replaceChildren();
    const entry = styles.find(s => s.id === style.value);
    colour.disabled = !entry;
    if (!entry) {
      if (previewActions) previewActions.dispatch({ kind: "preview.setPiercingPreview", style: "", definition: "" });
      else viewer!.setPiercingPreview("", "");
      updatePiercingNote(); return;
    }
    for (const choice of entry.choices) {
      const option = document.createElement("option");
      option.value = choice.definition; option.textContent = `${choice.index}. ${choice.label}`; colour.append(option);
    }
    colour.value = entry.choices.some(c => c.definition === preferred) ? preferred : entry.choices[0]!.definition;
    if (previewActions) previewActions.dispatch({ kind: "preview.setPiercingPreview", style: entry.id, definition: colour.value });
    else viewer!.setPiercingPreview(entry.id, colour.value);
    updatePiercingNote();
  }
  style.value = styles.some(s => s.id === workspace.preview.piercingStyle) ? workspace.preview.piercingStyle : "";
  fillColours(workspace.preview.piercingDefinition);
  style.onchange = () => fillColours();
  colour.onchange = () => previewActions!.dispatch({ kind: "preview.setPiercingPreview", style: style.value, definition: colour.value });
  viewer!.setPiercings(input("piercings").checked);
  input("piercings").onchange = () => previewActions!.dispatch({ kind: "preview.setPiercings", enabled: input("piercings").checked });
}
$("v-export").onclick = () => void runFile({ kind: "savedV.export" });
const shape = $<HTMLSelectElement>("eye-shape");
for (let i = 0; i <= 21; i++) {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = i ? `Eye shape ${String(i).padStart(2, "0")}` : "Base mesh";
  o.selected = i === workspace.preview.eyeShape;
  shape.append(o);
}
for (let i = 0; i < authoring.recipe.layers.length; i++) previewCoordinator.render(i);
sync();
workspacePersistence.activate();
try {
  // Discover hardware limits before attaching any full-size generated texture.
  viewer = await createScene($("viewport"), emptyPreviewCanvases());
  savedAppearance = new SavedAppearanceActions({ apply: v => viewer!.applySavedV(v) });
  app.attach({ savedV: savedAppearance });
  savedAppearance.subscribe(persist);
  const initialQuality = previewCoordinator.assess();
  viewer.setLayerCanvases(initialQuality.accepted ? canvases : emptyPreviewCanvases());
  if (!initialQuality.accepted) {
    previewCoordinator.rejectInitialCapacity();
  }
  if (workspace.savedV) showSavedV(savedAppearance.dispatch({ kind: "savedV.restore", value: workspace.savedV }));
  const preview = workspace.preview;
  for (const [id, checked] of Object.entries({ "surface-controls": preview.surface, wire: preview.wire,
    brows: preview.brows, lashes: preview.lashes, hair: preview.hair, piercings: preview.piercings,
    normals: preview.normals, "eye-optics": preview.eyeOptics })) input(id).checked = checked;
  viewer.setEyeOptics(preview.eyeOptics);
  refreshEyeOpticsNote();
  setupPiercingControls();
  input("blink").value = String(preview.blink);
  input("exposure").value = String(preview.exposure);
  input("light-angle").value = String(preview.lightAngle);
  input("fov").value = String(preview.camera?.fov ?? 30);
  $("fov-value").textContent = `${input("fov").value}°`;
  viewer.eyeShape(+shape.value);
  viewer.setWire(preview.wire);
  viewer.setNormals(preview.normals);
  viewer.setExposure(preview.exposure);
  viewer.setLightAngle(preview.lightAngle);
  $<HTMLDetailsElement>("lighting-panel").open = workspace.panels.lighting;
  const surface = createSurfaceEditor(viewer, {
    layer: () => geometry.layer(),
    selected: () => presentation.selected,
    selectedField: () => currentField()?.id, selectField,
    select: (i) => { const l = current(); if (l) dispatchRecipeAction({ kind: "point.select", layerId: l.id, index: i }); },
    begin: () => { const layer = current(); if (layer) app.beginGesture("surface", layer.id); },
    apply: action => { const accepted = app.applyGesture("surface", action); if (accepted) geometry.recipe(); return accepted; },
    cancel: () => app.endGesture("surface", true),
    finish: () => app.endGesture("surface"),
    message: status,
  });
  viewport.attach("surface", surface);
  surface.setEnabled(input("surface-controls").checked);
  input("surface-controls").onchange = () =>
    previewActions?.dispatch({ kind: "preview.setSurfaceControls", enabled: input("surface-controls").checked });
  for (let i = 0; i < authoring.recipe.layers.length; i++) {
    const stored = initialOptics[i];
    if (initialQuality.accepted && !(authoring.recipe.layers[i].finish==="glitter" &&
      (isIrregular(authoring.recipe.layers[i].flakes) || isDirectGlint(authoring.recipe.layers[i].flakes)) && canvases[i].width<32))
      viewer.updateLayer(i, authoring.recipe.layers[i], stored?.key === opticalKey(authoring.recipe.layers[i], canvases[i].width) ? stored.data : undefined,
        stored?.key === opticalKey(authoring.recipe.layers[i], canvases[i].width) ? stored.albedo : undefined,true);
    initialOptics[i] = undefined;
  }
  $("loading").hidden = true;
  drawUV();
  $("front").onclick = () => {
    const limited = previewActions!.dispatch({ kind: "camera.front" }).limited;
    $("fov-help").textContent = limited
      ? "This pane is too narrow to fit the full Front view within the camera range. Widen the pane or increase FOV."
      : "Camera distance follows the viewed face area as lens angle changes. Game FOV numbers may use a different convention.";
  };
  input("wire").onchange = () => previewActions!.dispatch({ kind: "preview.setWire", enabled: input("wire").checked });
  for (const name of ["brows", "lashes"] as const) {
    input(name).disabled = !viewer.details[name];
    input(name).checked &&= !!viewer.details[name];
    viewer.setDetail(name, input(name).checked);
    input(name).onchange = () => previewActions!.dispatch({ kind: "preview.setDetail", detail: name, enabled: input(name).checked });
  }
  if (!savedAppearance.hasSavedV()) input("hair").disabled = true;
  viewer.setHair(input("hair").checked);
  input("hair").onchange = () => previewActions!.dispatch({ kind: "preview.setHair", enabled: input("hair").checked });
  if (viewer.evidence.hairError) $("hair-note").textContent =
    `${viewer.hair.length ? "Some local hair styles unavailable" : "Hair preview unavailable"}: ${viewer.evidence.hairError}`;
  if (viewer.evidence.detailErrors.length)
    $("detail-note").textContent =
      `Some details unavailable: ${viewer.evidence.detailErrors.join("; ")}`;
  else if (viewer.evidence.browMaterial === "saved-double-diffuse")
    $("detail-note").textContent = viewer.evidence.lashColor === "saved-profile-swatch-approximation"
      ? "Saved Arkhe brow maps · brown liquorice lash profile, colour preview approximate"
      : "Saved Arkhe brow maps + installed brown ombre gradient · lash shading approximate";
  motionActions = new MotionActions(preview, { get idle() { return viewer!.idle; },
    available: viewer.evidence.idle.available, error: viewer.evidence.idle.error,
    setIdle: viewer.setIdle, setIdlePaused: viewer.setIdlePaused,
    setIdleContributions: viewer.setIdleContributions, setBlink: viewer.setBlink,
    animateBlink: viewer.animateBlink });
  app.attach({ motion: motionActions });
  motionActions.restore();
  setupMotionControls(motionActions);
  motionActions.subscribe(persist);
  previewActions = new PreviewActions({ ...preview, surface: input("surface-controls").checked,
    brows: input("brows").checked, lashes: input("lashes").checked, hair: input("hair").checked,
    eyeShape: +shape.value, piercings: input("piercings").checked,
    piercingStyle: $<HTMLSelectElement>("piercing-style").value,
    piercingDefinition: $<HTMLSelectElement>("piercing-colour").value }, {
    cameraState: viewer.cameraState, front: viewer.front, setFov: viewer.setFov,
    endFovGesture: viewer.endFovGesture, restoreCamera: viewer.restoreCamera,
    setExposure: viewer.setExposure, setLightAngle: viewer.setLightAngle,
    setSurfaceControls: enabled => surface.setEnabled(enabled), setWire: viewer.setWire,
    setNormals: viewer.setNormals, setEyeOptics: viewer.setEyeOptics,
    setHair: viewer.setHair, setDetail: viewer.setDetail, setEyeShape: viewer.eyeShape,
    setPiercings: viewer.setPiercings, setPiercingPreview: viewer.setPiercingPreview,
    piercingOptions: () => viewer!.piercingStyles.map(style => ({ id: style.id,
      definitions: style.choices.map(choice => choice.definition) })),
    availability: target => target === "hair" ? !savedAppearance!.hasSavedV() || !viewer!.hair.length ? "Saved hair preview is unavailable." : undefined
      : !viewer!.details[target] ? `${target} preview assets are unavailable.` : undefined,
  });
  app.attach({ preview: previewActions });
  previewActions.subscribe(persist);
  shape.onchange = () => previewActions!.dispatch({ kind: "preview.setEyeShape", index: +shape.value });
  input("exposure").oninput = () =>
    dispatchStudio({ kind: "preview.setExposure", value: +input("exposure").value });
  input("light-angle").oninput = () =>
    dispatchStudio({ kind: "preview.setKeyAngle", degrees: +input("light-angle").value });
  input("normals").onchange = () =>
    previewActions!.dispatch({ kind: "preview.setNormals", enabled: input("normals").checked });
  input("eye-optics").onchange = () => {
    previewActions!.dispatch({ kind: "preview.setEyeOptics", enabled: input("eye-optics").checked });
    refreshEyeOpticsNote();
  };
  input("fov").oninput = () => {
    const limited = previewActions!.dispatch({ kind: "camera.setFov", degrees: +input("fov").value }).limited;
    $("fov-value").textContent = `${input("fov").value}°`;
    $("fov-help").textContent = limited
      ? "Framing reached the camera limit. Pan or use Front view to recover the subject."
      : "Camera distance follows the viewed face area as lens angle changes. Game FOV numbers may use a different convention.";
  };
  input("fov").onchange = () => previewActions!.dispatch({ kind: "camera.endFovGesture" });
  // Motion is restored before the neutral-space camera, applying its offset once.
  if (preview.camera) previewActions.dispatch({ kind: "camera.restore", camera: preview.camera });
  viewer.controls.addEventListener("change", persist);
  layersPanel.scrollTop = workspace.panels.layersScroll;
  panel.scrollTop = workspace.panels.propertiesScroll;
  window.scrollTo(workspace.panels.pageX, workspace.panels.pageY);
  workspaceComposer.setPreviewReady();
  flushWorkspace();
  // Shift gestures belong to the surface editor's whole-shape rotation/scaling.
  // Read-only diagnostics for offline browser verification and future capture manifests.
  Object.assign(window, {
    eyeArtistryDiagnostics: () => ({
      ready: true,
      workspace: snapshot(),
      surface: surface.diagnostics(),
      inputCapture: viewport.capture(),
      uv: uvEditor!.diagnostics(),
      recipe: structuredClone(presentation.recipe()),
      assets: viewer!.evidence,
      eyeAppearance: viewer!.eyeAppearance(),
      idle: { enabled: viewer!.idle?.enabled ?? false, time: viewer!.idle?.time ?? 0,
        paused: viewer!.idle?.paused ?? false, body: viewer!.idle?.bodyEnabled ?? true, face: viewer!.idle?.faceEnabled ?? true,
        targetPose: Object.fromEntries(["Head", "l_J_eye_JNT", "r_J_eye_JNT", "mid_J_jaw_JNT", "l_J_eye_lid_up_rowA_1_JNT"].map(name => {
          const binding = viewer!.idle?.bindings.find(b => b.bone.name === name);
          return [name, binding?.bone.matrixWorld.toArray() ?? null];
        })),
        facialPose: Object.fromEntries(["l_J_eye_JNT", "r_J_eye_JNT", "mid_J_jaw_JNT", "l_J_eye_lid_up_root_1_JNT"].map(name => {
          const bone = viewer!.idle?.facial?.source.getObjectByName(name);
          return [name, bone ? { position: bone.position.toArray(), rotation: bone.quaternion.toArray() } : null];
        })) },
      details: Object.fromEntries(
        Object.entries(viewer!.details).map(([name, d]) => [
          name,
          {
            visible: d.root.visible,
            activeMorphs: d.meshes.map((m) =>
              Object.entries(m.morphTargetDictionary ?? {})
                .filter(([, i]) => m.morphTargetInfluences![i] > 0)
                .map(([n]) => n),
            ),
          },
        ]),
      ),
      lastRasterMs: previewCoordinator.lastRasterMs,
      frameTiming:viewer!.frameTiming(),
      rasterQueue: maskClient.diagnostics(),
      previewQuality: { requestedSize: previewCoordinator.size, canvases: canvases.map(c => c.width),
        materials: viewer!.makeupDiagnostics(), assessment: previewCoordinator.assess(), error: qualityActions.snapshot().error },
      savedV: savedAppearance!.snapshot().savedV
        ? { gameVersion: savedAppearance!.snapshot().savedV!.gameVersion, evidence: savedAppearance!.snapshot().savedV!.evidence }
        : null,
      activeMorphs: Object.entries(viewer!.head.morphTargetDictionary!)
        .filter(([n, i]) => viewer!.head.morphTargetInfluences![i] > 0)
        .map(([n]) => n),
      renderer: {
        near: viewer!.camera.near, far: viewer!.camera.far,
        calls: viewer!.renderer.info.render.calls,
        triangles: viewer!.renderer.info.render.triangles,
      },
      plateLayers: viewer!.plates.map(m => ({ name: m.name, visible: m.visible, renderOrder: m.renderOrder, morphs: [...(m.morphTargetInfluences ?? [])] })),
      materials: viewer!.materials.map((m) => ({
        color: m.color.getHexString(),
        roughness: m.roughness,
        metalness: m.metalness,
        clearcoat: m.clearcoat,
        iridescence: m.iridescence,
        normalMap: Boolean(m.normalMap),
        roughnessMap: Boolean(m.roughnessMap),
        metalnessMap: Boolean(m.metalnessMap),
        emissive: m.emissive.getHexString(),
      })),
    }),
  });
  status("Ready · actual head & expanded plate · all skin weights retained");
} catch (error) {
  $("loading").textContent = `Preview unavailable: ${(error as Error).message}`;
  status("Asset or renderer error — see the preview message.");
  console.error(error);
  flushWorkspace();
}
