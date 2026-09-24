import { type Layer } from "./recipe";
import { type LayerCommand } from "./layer-stack";
import { type LayerAction } from "./editor-actions";
import { createTrustedAuthoringCore } from "./trusted-authoring-core";
import { createBrowserWorkspaceSession, captureBrowserPanels, loadBrowserWorkspace } from "./browser-workspace-device";
import { createBrowserFileDevice } from "./browser-file-device";
import { layerList } from "./layer-ui";
import { setupSidebars } from "./sidebar-ui";
import { setupContextMenus } from "./context-menu";
import type { createScene } from "./scene";
import { type StudioAction } from "./studio-application";
import { createTrustedStudioBootstrap } from "./trusted-studio-bootstrap";
import { UIPreferenceActions } from "./ui-preferences";
import { type StudioFileAction } from "./studio-file-operations";
import { bindControlEdit } from "./control-edit-ui";
import { setupFields } from "./field-ui";
import type { PigmentCommand } from "./pigment-edit";
import type { SoftnessCommand } from "./softness-edit";
import { type RecipeAction } from "./recipe-actions";
import { setupSoftness } from "./softness-ui";
import { setupPreviewQuality } from "./preview-quality-ui";
import type { PreviewQualityActions } from "./preview-quality-actions";
import type { GlitterStats } from "./raster-processor";
import { setupPigment } from "./pigment-ui";
import { setupPathControls } from "./path-ui";
import type { PathCommand } from "./bezier-path";
import type { createUVEditor } from "./uv-editor";
import { createBrowserViewportDevice } from "./browser-viewport-device";
import { createBrowserPreviewDevice, previewOpticalKey } from "./browser-preview-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import { createTrustedPreviewServices } from "./trusted-preview-services";
import { ViewportAttachment } from "./viewport-attachment";
import type { PreviewActions } from "./preview-actions";
import { setupCollections } from "./collection-ui";
import { CollectionApplication } from "./collection-application";
import { collectionTransport } from "./collection-transport";
import { setupMotionControls } from "./motion-ui";
import type { MotionActions } from "./motion-actions";
import type { SavedAppearanceActions, SavedAppearanceState } from "./saved-appearance-actions";
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
import {maskAlphaKey} from "./makeup-dependencies";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
setupContextMenus(document);
const status = (text: string) => {
  $("status").textContent = text;
};
const verification = new URLSearchParams(location.search).has("verify");
const restored = loadBrowserWorkspace(localStorage, verification);
const workspace = restored.state;
const uiPreferences = new UIPreferenceActions(workspace.uiPreferences);
const initialTextureSize = workspace.preview.textureSize;
let qualityActions: PreviewQualityActions;
const core = createTrustedAuthoringCore(workspace, {
  resetStack: previous => previewCoordinator.syncStack(previous),
  selectedCollection: () => collectionApp?.workspaceSnapshot()?.selected ?? "draft",
  controlAction: action => dispatchRecipeAction(action),
});
const { document: authoring, geometry, presentation, layers: layerActions,
  recipe: recipeActions, app } = core;
const glitterMeasurements=new Map<string,{opticalKey:string;maskKey:string;stats:GlitterStats}>();
let presetLibrary: ReturnType<typeof setupCollections> | undefined;
let collectionApp: CollectionApplication | undefined;
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
  const valid=prior?.opticalKey===previewOpticalKey(layer,previewCoordinator.size) &&
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
let viewportAttachment: ViewportAttachment<HTMLElement> | undefined;
const sidebars = setupSidebars(workspace.panels, () => { persist(); viewportAttachment?.resize(); });
const lightingPanel = $<HTMLDetailsElement>("lighting-panel");
const qualityPanel = $<HTMLDetailsElement>("quality-panel");
const workspaceSession = createBrowserWorkspaceSession({
  workspace, verification, restored, storage: localStorage,
  capture: {
    editor: () => authoring.export(), uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
    savedV: () => savedAppearance?.snapshot().savedV ?? workspace.savedV,
    collections: () => collectionApp?.workspaceSnapshot() ?? workspace.collections,
    quality: () => qualityActions?.snapshot().size ?? initialTextureSize,
    preview: () => previewActions?.snapshot(), motion: () => motionActions?.snapshot(),
    uiPreferences: () => uiPreferences.snapshot(), sidebar: () => sidebars.snapshot(),
    layout: () => captureBrowserPanels({ sidebar: () => sidebars.snapshot(),
      lighting: lightingPanel, previewQuality: qualityPanel,
      layers: layersPanel, properties: panel, page: window }),
  },
  sources: [authoring, uiPreferences], window, document,
  scrollTargets: [panel, layersPanel], toggleTargets: [lightingPanel, qualityPanel],
  onStatus: state => { $("save-state").textContent = state.message; },
});
function flushWorkspace() { workspaceSession.flush(); }
function persist() { workspaceSession.request(); }
// UI adapters trigger one snapshot after their own handlers update state.
qualityPanel.open = workspace.panels.previewQuality;
let uvEditor: ReturnType<typeof createUVEditor> | undefined;
const headHost = $("viewport"), uvHost = $("uv");
const viewportDevice = createBrowserViewportDevice({
  headHost, uvHost, queryContext: hit => app.contextQuery(hit),
});
viewportAttachment = viewportDevice.attachment;
if (verification) Object.assign(window, { eyeArtistryViewportAttachment: viewportAttachment });
let refreshFields: (() => void) | undefined;
let refreshPigment: (() => void) | undefined;
let refreshSoftness: (() => void) | undefined;
let refreshQuality: (() => void) | undefined;
let refreshPath: (() => void) | undefined;
function drawUV() { viewportDevice.drawUV(); }
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
  $<HTMLButtonElement>("undo").disabled = !app.capability({ kind: "recipe.undo" }).available;
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
  $<HTMLButtonElement>("undo").disabled = !app.capability({ kind: "recipe.undo" }).available;
  layerCards();
}
const previewDevice = createBrowserPreviewDevice({
  document: authoring, initialSize: initialTextureSize,
  makeWorker: () => new Worker("/build/raster-worker.js", { type: "module" }),
  frame: run => requestAnimationFrame(run),
  refresh: () => { sync(); drawUV(); persist(); },
  refreshSelection: () => { sync(); drawUV(); persist(); },
  refreshQuality: () => { refreshQuality?.(); },
  drawUV, report: status,
  measurement: (layer, size, stats) => {
    glitterMeasurements.set(layer.id, { opticalKey: previewOpticalKey(layer, size),
      maskKey: maskAlphaKey(layer, size), stats });
    if (authoring.recipe.layers[authoring.active]?.id === layer.id) showGlitterMeasurement();
  },
});
const previewCoordinator = previewDevice.coordinator;
const canvases = previewDevice.canvases;
qualityActions = previewCoordinator.quality;
qualityActions.subscribe(() => { refreshQuality?.(); persist(); });
refreshQuality = setupPreviewQuality({ choices: $("quality-options"), note: $("quality-state"), retry: $<HTMLButtonElement>("quality-rebuild") },
  { current: () => qualityActions.snapshot().size, describe: () => previewCoordinator.describeQuality(),
    set: size => { dispatchStudio({ kind: "quality.set", size }); },
    rebuild: () => { dispatchStudio({ kind: "quality.rebuild" }); } });
function dispatchRecipeAction(action: RecipeAction, record = false) {
  try { recipeActions.dispatch(action, record); }
  catch (error) {
    status(action.kind === "glitter.setIrregular"
      ? "This amount and flake size exceed the fine Glitter preview range. Reduce size before raising amount."
      : (error as Error).message);
    sync();
  }
}

app.attach({ quality: qualityActions });
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
$("undo").onclick = () => { dispatchStudio({ kind: "recipe.undo" }); };
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !((e.target as HTMLElement)?.matches("input:not([type=range]), textarea"))) {
    e.preventDefault();
    dispatchStudio({ kind: "recipe.undo" });
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
uvEditor = viewportDevice.mountUV($<HTMLCanvasElement>("uv"), {
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
const studioBootstrap = createTrustedStudioBootstrap({
  workspace, core, preferences: uiPreferences, viewport: viewportAttachment,
  previewReadiness: previewCoordinator,
  transport: collectionTransport(verification ? "/api/verification/collections" : "/api/collections"),
  onEditorRestored: resetStackResources,
  onRecipeImported: () => { presetLibrary?.refresh(); persist(); },
  savedAppearance: {
    has: () => savedAppearance?.hasSavedV() ?? false,
    read: () => savedAppearance?.snapshot().savedV,
    load: bytes => savedAppearance!.dispatch({ kind: "savedV.load", bytes }),
    ready: () => !!viewer,
  },
  fileDevice: createBrowserFileDevice({ document, pickers: {
    recipe: input("file"), collection: input("collection-file"), savedV: input("v-file"),
  } }),
});
const fileOperations = studioBootstrap.files;
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
collectionApp = studioBootstrap.collection;
studioBootstrap.mount(port => {
  if (verification) Object.assign(window, { eyeArtistryStudioPresentation: port });
});
presetLibrary = setupCollections(collectionApp, persist, workspace.collections?.filesOpen);
void collectionApp.initialize().then(() => presetLibrary?.refresh());
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
    styles = previewActions!.piercingOptions();
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
  function fillColours(preferred = "", apply = true) {
    colour.replaceChildren();
    const entry = styles.find(s => s.id === style.value);
    colour.disabled = !entry;
    if (!entry) {
      if (apply) previewActions!.dispatch({ kind: "preview.setPiercingPreview", style: "", definition: "" });
      updatePiercingNote(); return;
    }
    for (const choice of entry.choices) {
      const option = document.createElement("option");
      option.value = choice.definition; option.textContent = `${choice.index}. ${choice.label}`; colour.append(option);
    }
    colour.value = entry.choices.some(c => c.definition === preferred) ? preferred : entry.choices[0]!.definition;
    if (apply) previewActions!.dispatch({ kind: "preview.setPiercingPreview", style: entry.id, definition: colour.value });
    updatePiercingNote();
  }
  const state = previewActions!.snapshot();
  style.value = state.piercingStyle;
  fillColours(state.piercingDefinition, false);
  style.onchange = () => fillColours();
  colour.onchange = () => previewActions!.dispatch({ kind: "preview.setPiercingPreview", style: style.value, definition: colour.value });
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
workspaceSession.activate();
try {
  // Discover hardware limits before attaching any full-size generated texture.
  viewer = await viewportDevice.loadHead(previewDevice.emptyCanvases());
  let surface: ReturnType<typeof viewportDevice.mountSurface> | undefined;
  const previewServices = createTrustedPreviewServices(workspace,
    createBrowserScenePreviewPorts(viewer, {
      setSurfaceControls: enabled => surface?.setEnabled(enabled),
      hasSavedAppearance: () => !!workspace.savedV || !!savedAppearance?.hasSavedV(),
    }));
  savedAppearance = previewServices.savedAppearance;
  app.attach({ savedV: savedAppearance });
  savedAppearance.subscribe(persist);
  previewDevice.connectScene(viewer);
  if (previewServices.restoredSavedAppearance) showSavedV(previewServices.restoredSavedAppearance);
  refreshEyeOpticsNote();
  $<HTMLDetailsElement>("lighting-panel").open = workspace.panels.lighting;
  surface = viewportDevice.mountSurface({
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
  const services = previewServices.finish();
  motionActions = services.motion;
  previewActions = services.preview;
  app.attach({ motion: motionActions, preview: previewActions });
  motionActions.subscribe(persist);
  previewActions.subscribe(persist);
  const initialPreview = previewActions.snapshot();
  for (const [id, checked] of Object.entries({ "surface-controls": initialPreview.surface, wire: initialPreview.wire,
    brows: initialPreview.brows, lashes: initialPreview.lashes, hair: initialPreview.hair,
    piercings: initialPreview.piercings, normals: initialPreview.normals,
    "eye-optics": initialPreview.eyeOptics })) input(id).checked = checked;
  input("blink").value = String(motionActions.snapshot().blink);
  input("exposure").value = String(initialPreview.exposure);
  input("light-angle").value = String(initialPreview.lightAngle);
  input("fov").value = String(initialPreview.camera.fov);
  $("fov-value").textContent = `${input("fov").value}°`;
  shape.value = String(initialPreview.eyeShape);
  setupMotionControls(motionActions);
  input("surface-controls").onchange = () =>
    previewActions?.dispatch({ kind: "preview.setSurfaceControls", enabled: input("surface-controls").checked });
  previewDevice.presentInitialLayers();
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
    input(name).onchange = () => previewActions!.dispatch({ kind: "preview.setDetail", detail: name, enabled: input(name).checked });
  }
  if (!savedAppearance.hasSavedV()) input("hair").disabled = true;
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
  setupPiercingControls();
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
  // Motion and neutral-space camera were restored in the trusted preview bootstrap.
  viewer.controls.addEventListener("change", persist);
  layersPanel.scrollTop = workspace.panels.layersScroll;
  panel.scrollTop = workspace.panels.propertiesScroll;
  window.scrollTo(workspace.panels.pageX, workspace.panels.pageY);
  workspaceSession.setPreviewReady();
  flushWorkspace();
  // Shift gestures belong to the surface editor's whole-shape rotation/scaling.
  // Read-only diagnostics for offline browser verification and future capture manifests.
  Object.assign(window, {
    eyeArtistryDiagnostics: () => ({
      ready: true,
      workspace: workspaceSession.snapshot(),
      surface: surface.diagnostics(),
      inputCapture: viewportDevice.capture(),
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
      rasterQueue: previewDevice.queueDiagnostics(),
      previewQuality: { requestedSize: previewCoordinator.size, canvases: canvases.map(c => c.width),
        materials: viewer!.makeupDiagnostics(), assessment: previewCoordinator.assess(), error: qualityActions.snapshot().error },
      savedV: savedAppearance!.snapshot().savedV
        ? { gameVersion: savedAppearance!.snapshot().savedV!.gameVersion, evidence: savedAppearance!.snapshot().savedV!.evidence }
        : null,
      activeMorphs: Object.entries(viewer!.head.morphTargetDictionary!)
        .filter(([n, i]) => viewer!.head.morphTargetInfluences![i] > 0)
        .map(([n]) => n),
      renderer: {
        near: viewer!.camera.near, far: viewer!.camera.far, aspect: viewer!.camera.aspect,
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
  viewportDevice.headReady();
} catch (error) {
  viewportDevice.failHead((error as Error).message);
  $("loading").textContent = `Preview unavailable: ${(error as Error).message}`;
  status("Asset or renderer error — see the preview message.");
  console.error(error);
  flushWorkspace();
}
