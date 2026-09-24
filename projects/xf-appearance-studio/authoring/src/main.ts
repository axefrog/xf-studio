import {
  MAX_LAYERS,
  parseRecipe,
  type Recipe,
  type Layer,
} from "./recipe";
import { type LayerCommand } from "./layer-stack";
import { applyLayerAction, layerCapability, RecipeHistory, type LayerAction } from "./editor-actions";
import { layerList } from "./layer-ui";
import { setupSidebars } from "./sidebar-ui";
import { setupContextMenus } from "./context-menu";
import { createScene } from "./scene";
import { createSurfaceEditor } from "./surface-editor";
import { layerRenderQueue } from "./layer-render-queue";
import { createRasterClient } from "./raster-client";
import { selectedWarp, type FieldSelection } from "./field-selection";
import { setupFields } from "./field-ui";
import type { PigmentCommand } from "./pigment-edit";
import type { SoftnessCommand } from "./softness-edit";
import { RecipeActions, type RecipeAction } from "./recipe-actions";
import { setupSoftness } from "./softness-ui";
import { assessPreviewQuality, type PreviewTextureSize } from "./preview-quality";
import { setupPreviewQuality } from "./preview-quality-ui";
import type { RasterResponse,GlitterStats } from "./raster-processor";
import { setupPigment } from "./pigment-ui";
import { setupPathControls, type PathCommand } from "./path-ui";
import { createUVEditor } from "./uv-editor";
import { ViewportAdapter } from "./viewport-adapter";
import { PreviewActions } from "./preview-actions";
import { setupCollections } from "./collection-ui";
import { setupMotionControls } from "./motion-ui";
import { readSavedV, type SavedV } from "./save-reader";
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
let textureSize = workspace.preview.textureSize;
let qualityError = "";
let qualityBlocked = false;
type PreviewOptics = NonNullable<Extract<RasterResponse, {data: unknown}>["optics"]>;
type PreviewAlbedo = NonNullable<Extract<RasterResponse, {data: unknown}>["albedo"]>;
let initialOptics: ({ key: string; data?: PreviewOptics; albedo?:PreviewAlbedo } | undefined)[] = [];
const opticalKey = (layer: Layer, size: number) => isIrregular(layer.flakes) && layer.finish === "glitter"
  ? studioIrregularOpticalKey(layer.flakes,size)
  : JSON.stringify([canonicalFinish(layer.finish), layer.flakes ?? defaultFlakes(), size]);
let recipe = workspace.recipe, active = workspace.active, selected = workspace.selected;
const glitterChoices = workspace.glitterChoices;
const glitterMeasurements=new Map<string,{opticalKey:string;maskKey:string;stats:GlitterStats}>();
let fieldSelection: FieldSelection = workspace.fieldSelection;
const history = new RecipeHistory(workspace.history);
let workspaceReady = false, previewRestored = false, persistTimer: ReturnType<typeof setTimeout> | undefined;
let presetLibrary: ReturnType<typeof setupCollections> | undefined;
function checkpoint() {
  history.checkpoint(recipe);
}
const canvases = Array.from({ length: recipe.layers.length }, () => {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c;
});
function emptyPreviewCanvases() {
  return recipe.layers.map(() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; return canvas; });
}
let viewer: Awaited<ReturnType<typeof createScene>> | undefined;
let previewActions: PreviewActions | undefined;
let savedV: SavedV | undefined = workspace.savedV;
const current = () => recipe.layers[active];
function showGlitterMeasurement(){
  const layer=current();
  if(!layer || layer.finish!=="glitter" || !isIrregular(layer.flakes))return;
  const prior=glitterMeasurements.get(layer.id);
  const valid=prior?.opticalKey===opticalKey(layer,textureSize) &&
    prior.maskKey===maskAlphaKey(layer,textureSize);
  const note=$("irregular-visible-note");
  const scope=layer.flakes.count>FLAKE_LIMITS.count?"retained in the eye UV regions":"generated across the UV atlas";
  note.textContent=valid
    ? `${prior.stats.maskCentres.toLocaleString()} approximate flake centres in this painted shape from ${prior.stats.regionRetained.toLocaleString()} ${scope}. ${prior.stats.coveredPixels.toLocaleString()} painted texture pixels contain any flake coverage at ${textureSize}²; these are not visible screen glints.`
    : "Calculating flakes in this painted shape. Field density is not a visible flake count.";
}
const currentField = () => selectedWarp(current(), fieldSelection);
function selectField(id: string) {
  const l = current(); if (l) dispatchRecipeAction({ kind: "field.select", layerId: l.id, fieldId: id });
}
const panel = document.querySelector<HTMLElement>(".properties")!;
const layersPanel = document.querySelector<HTMLElement>(".layers-panel")!;
const viewport = new ViewportAdapter();
const sidebars = setupSidebars(workspace.panels, () => { persist(); viewport.resize(); });
function snapshot(): WorkspaceState {
  // Editing/recipe autosave still works if preview assets fail or are still loading.
  const editing = { recipe, active, selected, fieldSelection, uvView: uvEditor?.snapshot() ?? workspace.uvView, history: history.snapshot(), savedV,
    glitterChoices, library: workspace.library, collections: presetLibrary?.snapshot() ?? workspace.collections };
  if (!previewRestored) return { ...workspace, ...editing, preview: { ...workspace.preview, textureSize },
    panels: { ...workspace.panels, ...sidebars.snapshot(), previewQuality: $<HTMLDetailsElement>("quality-panel").open } };
  const previewConfig = previewActions?.snapshot();
  return {
    schema: "xfas/workspace-1", ...editing,
    preview: {
      textureSize,
      camera: previewConfig?.camera ?? viewer?.cameraState() ?? workspace.preview.camera, eyeShape: +$<HTMLSelectElement>("eye-shape").value,
      surface: previewConfig?.surface ?? input("surface-controls").checked,
      wire: previewConfig?.wire ?? input("wire").checked,
      brows: previewConfig?.brows ?? input("brows").checked,
      lashes: previewConfig?.lashes ?? input("lashes").checked,
      hair: previewConfig?.hair ?? input("hair").checked,
      piercings: input("piercings").checked, piercingStyle: $<HTMLSelectElement>("piercing-style").value,
      piercingDefinition: $<HTMLSelectElement>("piercing-colour").value,
      normals: previewConfig?.normals ?? input("normals").checked,
      eyeOptics: previewConfig?.eyeOptics ?? input("eye-optics").checked,
      exposure: previewConfig?.exposure ?? +input("exposure").value,
      lightAngle: previewConfig?.lightAngle ?? +input("light-angle").value,
      blink: +input("blink").value, blinkPlaying: $("play").getAttribute("aria-pressed") === "true",
      idle: viewer?.idle?.enabled ?? workspace.preview.idle,
      idleTime: viewer?.idle?.time ?? workspace.preview.idleTime,
      idlePaused: viewer?.idle?.paused ?? workspace.preview.idlePaused,
      idleBody: viewer?.idle?.bodyEnabled ?? workspace.preview.idleBody,
      idleFace: viewer?.idle?.faceEnabled ?? workspace.preview.idleFace,
    },
    panels: { ...sidebars.snapshot(), lighting: $<HTMLDetailsElement>("lighting-panel").open,
      previewQuality: $<HTMLDetailsElement>("quality-panel").open,
      layersScroll: layersPanel.scrollTop, propertiesScroll: panel.scrollTop, pageX: scrollX, pageY: scrollY },
  };
}
function flushWorkspace() {
  clearTimeout(persistTimer);
  if (!workspaceReady) return;
  if (!restored.writable) {
    $("save-state").textContent = `${restored.error}. Original storage kept; export your recipe before closing.`;
    return;
  }
  try {
    localStorage.setItem(workspaceKeys(verification).workspace, JSON.stringify(snapshot()));
    $("save-state").textContent = "Workspace saved in this browser";
  } catch {
    $("save-state").textContent = "Browser storage unavailable — save a recipe";
  }
}
function persist() {
  if (!workspaceReady) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flushWorkspace, 180);
}
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
  select(i) { dispatchRecipeAction({ kind: "layer.select", layerId: recipe.layers[i].id }); },
  rename(i) { dispatchRecipeAction({ kind: "layer.select", layerId: recipe.layers[i].id });
    input("layer-name").focus(); input("layer-name").select(); },
  toggle(i, enabled) { dispatchLayer({ kind: "layer.setEnabled", id: recipe.layers[i].id, enabled }); },
  edit: changeLayers,
});
function layerCards() { paintLayerList(recipe, active); }
function replaceRecipe(next: Recipe, nextActive = 0) {
  recipe = next; active = Math.max(0, Math.min(nextActive, recipe.layers.length - 1)); selected = 0;
  maskClient.reset();
  initialOptics = [];
  // A structure change cannot reuse an in-flight mask or an old slot's pixels.
  canvases.splice(0, canvases.length, ...recipe.layers.map(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; return canvas;
  }));
  viewer?.setLayerCanvases(canvases);
  for (let i = 0; i < recipe.layers.length; i++) render(i);
  sync(); drawUV(); persist();
}
function changeLayers(command: LayerCommand) {
  dispatchLayer({ kind: "layer.edit", command });
}
function dispatchLayer(action: LayerAction) {
  try {
    const capability = layerCapability(recipe, action);
    if (!capability.available) throw Error(capability.reason);
    const next = applyLayerAction(recipe, current()?.id, action);
    checkpoint();
    if (next.structure) replaceRecipe(next.recipe, next.active);
    else { recipe = next.recipe; render(next.changed); }
  } catch (error) { status((error as Error).message); sync(); }
}
$("layer-add").onclick = () => changeLayers({ kind: "add" });
$("layer-copy").onclick = () => { if (current()) changeLayers({ kind: "duplicate", id: current().id }); };
const layerName = input("layer-name");
function commitLayerName() {
  if (current() && layerName.value !== current().name)
    changeLayers({ kind: "rename", id: current().id, name: layerName.value });
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
  $("layer-count").textContent = String(recipe.layers.length).padStart(2, "0");
  $<HTMLFieldSetElement>("layer-properties").disabled = !l;
  $("layer-properties").inert = !l;
  $<HTMLButtonElement>("export").disabled = !l;
  $<HTMLButtonElement>("layer-add").disabled = recipe.layers.length >= MAX_LAYERS;
  $<HTMLButtonElement>("layer-copy").disabled = !l || recipe.layers.length >= MAX_LAYERS;
  $<HTMLButtonElement>("undo").disabled = !history.canUndo;
  if (!l) { $("active-name").textContent = "Add a makeup layer"; layerCards(); return; }
  input("layer-name").value = l.name;
  $("active-name").textContent = l.name;
  $("point-label").textContent = `Point ${selected + 1} / ${l.points.length}`;
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
  const flakes = l.flakes ?? defaultFlakes();
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
    weight: l.points[selected].weight,
    opacity: l.opacity,
  })) {
    input(id).value = String(value);
    $(id + "-value").textContent =
      id === "feather" || id === "radius"
        ? `${(value * 100).toFixed(2)}% UV`
        : `${Math.round(value * 100)}%`;
  }
  $<HTMLButtonElement>("remove").disabled = l.points.length <= 3;
  $<HTMLButtonElement>("undo").disabled = !history.canUndo;
  layerCards();
}
let lastRaster = 0;
const maskClient = createRasterClient(() => new Worker("/build/raster-worker.js", { type: "module" }),
  ({ i, data, ms, size, optics, albedo, glitterStats }) => {
    if (!recipe.layers[i]) return;
    const layer = recipe.layers[i];
    if (size !== (layer.enabled ? textureSize : 1)) return;
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
      if(i===active)showGlitterMeasurement();
    }
    lastRaster = ms;
    drawUV();
    refreshQuality?.();
    status(`Live makeup · ${size}² · ${Math.round(ms)} ms · layer ${i + 1}`);
  }, reason => { qualityBlocked = true; qualityError = reason ?? "Texture calculation failed. Rebuild the preview or edit again to retry."; status(qualityError); refreshQuality?.(); });
function qualityAssessment(size = textureSize) {
  return assessPreviewQuality(recipe, size, viewer?.renderer.capabilities.maxTextureSize ?? 4096);
}
function describeQuality() {
  if (qualityError) return qualityError;
  const assessment = qualityAssessment(), queue = maskClient.diagnostics();
  if (!assessment.accepted) return assessment.error!;
  const pending = queue.queued + (queue.running ? 1 : 0);
  const waiting = recipe.layers.some((l,i) => l.enabled && (canvases[i]?.width !== textureSize ||
    (viewer && (viewer.needsOptics(i,l,textureSize) || viewer.needsAlbedo(i,l,textureSize)))));
  return `${pending || waiting ? "Updating" : "Ready"} · ${textureSize} × ${textureSize} · estimated generated-texture peak ${Math.ceil(assessment.estimatedBytes / 1048576)} MiB. Native assets and browser overhead are additional.`;
}
function setPreviewTextureSize(size: PreviewTextureSize) {
  const assessment = qualityAssessment(size);
  if (!assessment.accepted) { qualityError = assessment.error!; refreshQuality?.(); return; }
  textureSize = size; qualityError = ""; qualityBlocked = false; maskClient.reset();
  // Release the old quality's textures and CPU canvases before allocating the
  // next tier. A 4K-to-512 transition must not retain the old 4K bundle while
  // the target-only budget assesses the smaller replacement.
  canvases.splice(0,canvases.length,...emptyPreviewCanvases());
  initialOptics=[]; viewer?.setLayerCanvases(canvases);
  for (const i of [active, ...recipe.layers.map((_,i) => i).filter(i => i !== active)]) render(i);
  refreshQuality?.(); persist();
}
refreshQuality = setupPreviewQuality({ choices: $("quality-options"), note: $("quality-state"), retry: $<HTMLButtonElement>("quality-rebuild") },
  { current: () => textureSize, describe: describeQuality, set: setPreviewTextureSize, rebuild: () => setPreviewTextureSize(textureSize) });
function render(i = active) {
  if (!recipe.layers[i]) return;
  const layer = recipe.layers[i], assessment = qualityAssessment();
  if (!layer.enabled) {
    // Release large hidden resources immediately, even if a bake is being cancelled.
    if (canvases[i].width !== 1) {
      const empty = document.createElement("canvas"); empty.width = empty.height = 1;
      canvases[i] = empty; viewer?.setLayerCanvas(i, empty);
    }
    initialOptics[i] = undefined; viewer?.updateLayer(i, layer);
  }
  if (!assessment.accepted) {
    maskClient.reset(); qualityBlocked = true; qualityError = assessment.error!;
    status(qualityError); refreshQuality?.(); sync(); persist(); return;
  }
  if (qualityBlocked) {
    // Capacity/failure recovery rebuilds every potentially stale slot.
    qualityBlocked = false; qualityError = ""; maskClient.reset();
    for (const slot of [active, ...recipe.layers.map((_,slot) => slot).filter(slot => slot !== active)]) render(slot);
    return;
  }
  qualityError = "";
  const size = layer.enabled ? textureSize : 1;
  const needsOptics = layer.enabled && !isDirectGlint(layer.flakes) && ["shimmer", "glitter"].includes(canonicalFinish(layer.finish)) &&
    (viewer ? viewer.needsOptics(i, layer, size) : initialOptics[i]?.key !== opticalKey(layer, size));
  maskClient.request(i, layer, i === active, size, needsOptics);
  viewer?.updateLayer(i, recipe.layers[i]);
  persist();
  sync();
  drawUV();
}
const scheduleLayer = layerRenderQueue(() => recipe.layers, run => requestAnimationFrame(run), render);
function schedule() { scheduleLayer(current()); }
const recipeActions = new RecipeActions(
  () => ({ recipe, active, selected, fieldSelection }),
  (next, effect) => {
    recipe = next.recipe; active = next.active; selected = next.selected; fieldSelection = next.fieldSelection;
    if (effect.kind === "selection") { sync(); drawUV(); persist(); }
    else if (effect.kind === "immediate") render(effect.layerIndex);
    else if (effect.layerIndex !== active) render(effect.layerIndex);
    else { schedule(); sync(); persist(); }
  }, history, glitterChoices, () => presetLibrary?.snapshot()?.selected ?? "draft",
  i => scheduleLayer(recipe.layers[i]));
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
  const next = history.undo();
  if (!next) return;
  replaceRecipe(next, next.layers.findIndex(l => l.id === current()?.id));
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
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", () => checkpoint());
  control.oninput = () => {
    const l = current();
    if (!l) return;
    if (id === "color") dispatchRecipeAction({ kind: "layer.setColor", layerId: l.id, color: control.value });
    else if (id === "weight") dispatchRecipeAction({ kind: "pigment.edit", layerId: l.id,
      command: { kind: "point-strength", index: selected, value: +control.value } });
    else dispatchRecipeAction({ kind: "layer.setOpacity", layerId: l.id, opacity: +control.value });
  };
}
input("symmetry").onchange = () => {
  const l = current(); if (l) dispatchRecipeAction({ kind: "layer.setSymmetry", layerId: l.id,
    symmetry: input("symmetry").checked }, true);
};
$<HTMLSelectElement>("finish").onchange = () => {
  const l=current(); if (l) dispatchRecipeAction({ kind: "layer.setFinish", layerId: l.id,
    finish: $<HTMLSelectElement>("finish").value as Layer["finish"] }, true);
};
for (const id of ["cells", "density", "tilt"] as const) {
  const control = input("flake-" + id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", checkpoint);
  control.oninput = () => {
    const l = current();
    if (l) dispatchRecipeAction({ kind: "glitter.setClassic", layerId: l.id, key: id, value: +control.value });
  };
}
$<HTMLSelectElement>("glitter-model").onchange = () => {
  const layer = current(), model = $<HTMLSelectElement>("glitter-model").value as GlitterModel;
  if (layer) dispatchRecipeAction({ kind: "glitter.selectModel", layerId: layer.id, model }, true);
};
for (const id of ["count","radius","spread","tilt","color"] as const) {
  const control=input("irregular-"+id);
  control.addEventListener("pointerdown",checkpoint);
  control.addEventListener("keydown",checkpoint);
  control.oninput=()=>{
    const l=current(); if(!l || !isIrregular(l.flakes))return;
    dispatchRecipeAction({ kind: "glitter.setIrregular", layerId: l.id, key: id,
      value: id === "color" ? control.value : id === "count" ? +control.value*5000 : +control.value });
  };
}
for(const id of ["density","fineShare","strength","color"] as const){
  const control=input("direct-"+id);
  control.addEventListener("pointerdown",checkpoint);
  control.addEventListener("keydown",checkpoint);
  control.oninput=()=>{
    const l=current();if(!l)return;
    dispatchRecipeAction({ kind: "glitter.setDirect", layerId: l.id, key: id,
      value: id === "color" ? control.value : +control.value });
  };
}
function changePath(command: PathCommand) {
  const layer = current(); if (layer) dispatchRecipeAction({ kind: "path.edit", layerId: layer.id, command }, true);
}
refreshPath = setupPathControls({
  enable: $("path-enable"), modes: $("point-modes"), note: $("path-note"),
  aligned: $("point-aligned"), symmetric: $("point-symmetric"), corner: $("point-corner"),
}, { layer: current, selected: () => selected, edit: changePath });
function changePigment(command: PigmentCommand) {
  const layer = current(); if (layer) dispatchRecipeAction({ kind: "pigment.edit", layerId: layer.id, command });
}
refreshPigment = setupPigment({
  smooth: input("smooth-strength"), blend: input("strength-blend"),
  value: $("strength-blend-value"), note: $("strength-note"),
}, { layer: current, begin: checkpoint, edit: changePigment });
function changeSoftness(command: SoftnessCommand) {
  const layer = current(); if (layer) dispatchRecipeAction({ kind: "softness.edit", layerId: layer.id, command });
}
refreshSoftness = setupSoftness({
  variable: input("variable-softness"), width: input("feather"), label: $("feather-label"),
  value: $("feather-value"), note: $("softness-note"),
}, { layer: current, selected: () => selected, begin: checkpoint, edit: changeSoftness });
refreshFields = setupFields({
  list: $("field-list"), add: $("field-add"), remove: $("field-remove"), clear: $("clear-field"),
  reach: input("radius"), value: $("radius-value"), note: $("field-note"),
}, { layer: current, selected: currentField, select: selectField, begin: checkpoint, edit: dispatchRecipeAction });
$("reset").onclick = () => { if (current()) changeLayers({ kind: "reset", id: current().id }); };
$("remove").onclick = () => {
  const l = current(); if (l) dispatchRecipeAction({ kind: "point.remove", layerId: l.id, index: selected }, true);
};
uvEditor = createUVEditor($<HTMLCanvasElement>("uv"), {
  both: $("uv-both"), single: $("uv-single"), other: $("uv-other"), fit: $("uv-fit"), note: $("uv-view-note"),
}, {
  recipe: () => recipe, layer: current, selected: () => selected,
  selectedField: () => currentField()?.id, selectField, canvases: () => canvases,
  albedo: () => viewer?.albedo.image as HTMLImageElement | undefined,
  select: index => { const l = current(); if (l) dispatchRecipeAction({ kind: "point.select", layerId: l.id, index }); },
  begin: checkpoint, apply: action => recipeActions.applyGesture(action),
  cancel: undo, persist, message: status,
}, workspace.uvView);
viewport.attach("uv", uvEditor);
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  download(
    new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }),
    "xfs.recipe.json",
  );
  status("Recipe exported — editable shapes, colours and fields.");
};
$("load").onclick = () => input("file").click();
presetLibrary = setupCollections(() => ({ recipe, active, selected, fieldSelection, history: history.snapshot() }), editor => {
  history.restore(editor.history);
  fieldSelection = editor.fieldSelection ?? {};
  replaceRecipe(editor.recipe, editor.active);
  selected = Math.max(0, Math.min(editor.selected, (current()?.points.length ?? 1) - 1)); sync(); drawUV();
}, workspace.collections, workspace.library, persist, download);
input("file").onchange = async () => {
  const file = input("file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw Error("Recipe is too large.");
    const next = parseRecipe(JSON.parse(await file.text()));
    presetLibrary!.importRecipe(next, file.name.replace(/\.json$/i, ""));
    status(`Opened ${file.name}`);
  } catch (error) {
    status(`Could not open recipe: ${(error as Error).message}`);
  }
  input("file").value = "";
};
$("export").onclick = () => {
  if (!current()) return;
  const layer = structuredClone(current()),
    bake = new Worker("/build/raster-worker.js", { type: "module" });
  $<HTMLButtonElement>("export").disabled = true;
  status("Baking 2048² mask…");
  bake.onmessage = (e) => {
    const c = document.createElement("canvas");
    c.width = c.height = 2048;
    c.getContext("2d")!.putImageData(
      new ImageData(e.data.data, 2048, 2048),
      0,
      0,
    );
    bake.terminate();
    $<HTMLButtonElement>("export").disabled = !current();
    c.toBlob((blob) => {
      if (blob) {
        download(blob, `xfs-${layer.id}-alpha.png`);
        status("Exported 2048² white + alpha mask; palette remains separate.");
      }
    });
  };
  bake.onerror = () => {
    bake.terminate();
    $<HTMLButtonElement>("export").disabled = !current();
    status("Mask export failed.");
  };
  bake.postMessage({
    i: 0,
    version: 0,
    layer: { ...layer, enabled: true },
    size: 2048,
  });
};
$("open-v").onclick = () => {
  if (!viewer) {
    status("Wait for the preview assets to finish loading.");
    return;
  }
  input("v-file").click();
};
input("v-file").onchange = async () => {
  const file = input("v-file").files?.[0];
  if (!file || !viewer) return;
  try {
    if (file.size > 128 * 1024 * 1024)
      throw Error("Save is larger than the supported limit.");
    status("Reading saved appearance locally…");
    const v = readSavedV(new Uint8Array(await file.arrayBuffer()));
    showSavedV(v);
    const group = v.groups.head.find(g => g.name === "character_customization") ?? v.groups.head.find(g => g.name === "TPP");
    const eye = group?.morphs.find(m => m.region === "eyes");
    if (eye) shape.value = String(Math.floor(Number(eye.target.slice(1)) / 10));
    persist();
    status(
      "Saved facial shape applied. Remaining appearance assets still need resolving.",
    );
  } catch (error) {
    status(`Could not apply V: ${(error as Error).message}`);
  }
  input("v-file").value = "";
};
function showSavedV(v: SavedV) {
  const result = viewer!.applySavedV(v);
  savedV = v;
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
    `${result.applied.length} facial regions applied. ${result.appearanceReferences} appearance references read. Game ${(v.gameVersion / 1000).toFixed(2)}.`;
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
    if (!entry) { viewer!.setPiercingPreview("", ""); updatePiercingNote(); return; }
    for (const choice of entry.choices) {
      const option = document.createElement("option");
      option.value = choice.definition; option.textContent = `${choice.index}. ${choice.label}`; colour.append(option);
    }
    colour.value = entry.choices.some(c => c.definition === preferred) ? preferred : entry.choices[0]!.definition;
    viewer!.setPiercingPreview(entry.id, colour.value);
    updatePiercingNote();
  }
  style.value = styles.some(s => s.id === workspace.preview.piercingStyle) ? workspace.preview.piercingStyle : "";
  fillColours(workspace.preview.piercingDefinition);
  style.onchange = () => fillColours();
  colour.onchange = () => viewer!.setPiercingPreview(style.value, colour.value);
  viewer!.setPiercings(input("piercings").checked);
  input("piercings").onchange = () => viewer!.setPiercings(input("piercings").checked);
}
$("v-export").onclick = () => {
  if (savedV)
    download(
      new Blob([JSON.stringify(savedV, null, 2)], { type: "application/json" }),
      "v-appearance.json",
    );
};
const shape = $<HTMLSelectElement>("eye-shape");
for (let i = 0; i <= 21; i++) {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = i ? `Eye shape ${String(i).padStart(2, "0")}` : "Base mesh";
  o.selected = i === workspace.preview.eyeShape;
  shape.append(o);
}
for (let i = 0; i < recipe.layers.length; i++) render(i);
sync();
workspaceReady = true;
try {
  // Discover hardware limits before attaching any full-size generated texture.
  viewer = await createScene($("viewport"), emptyPreviewCanvases());
  const initialQuality = qualityAssessment();
  viewer.setLayerCanvases(initialQuality.accepted ? canvases : emptyPreviewCanvases());
  if (!initialQuality.accepted) {
    maskClient.reset(); qualityBlocked = true; qualityError = initialQuality.error!; refreshQuality?.();
  }
  if (savedV) showSavedV(savedV);
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
    layer: current,
    selected: () => selected,
    selectedField: () => currentField()?.id, selectField,
    select: (i) => { const l = current(); if (l) dispatchRecipeAction({ kind: "point.select", layerId: l.id, index: i }); },
    begin: checkpoint,
    apply: action => recipeActions.applyGesture(action),
    cancel: undo,
    message: status,
  });
  viewport.attach("surface", surface);
  surface.setEnabled(input("surface-controls").checked);
  input("surface-controls").onchange = () =>
    previewActions?.dispatch({ kind: "preview.setSurfaceControls", enabled: input("surface-controls").checked });
  for (let i = 0; i < recipe.layers.length; i++) {
    const stored = initialOptics[i];
    if (initialQuality.accepted && !(recipe.layers[i].finish==="glitter" &&
      (isIrregular(recipe.layers[i].flakes) || isDirectGlint(recipe.layers[i].flakes)) && canvases[i].width<32))
      viewer.updateLayer(i, recipe.layers[i], stored?.key === opticalKey(recipe.layers[i], canvases[i].width) ? stored.data : undefined,
        stored?.key === opticalKey(recipe.layers[i], canvases[i].width) ? stored.albedo : undefined,true);
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
  if (!savedV) input("hair").disabled = true;
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
  setupMotionControls(viewer, preview);
  previewActions = new PreviewActions({ ...preview, surface: input("surface-controls").checked,
    brows: input("brows").checked, lashes: input("lashes").checked, hair: input("hair").checked }, {
    cameraState: viewer.cameraState, front: viewer.front, setFov: viewer.setFov,
    endFovGesture: viewer.endFovGesture, restoreCamera: viewer.restoreCamera,
    setExposure: viewer.setExposure, setLightAngle: viewer.setLightAngle,
    setSurfaceControls: enabled => surface.setEnabled(enabled), setWire: viewer.setWire,
    setNormals: viewer.setNormals, setEyeOptics: viewer.setEyeOptics,
    setHair: viewer.setHair, setDetail: viewer.setDetail,
    availability: target => target === "hair" ? !savedV || !viewer!.hair.length ? "Saved hair preview is unavailable." : undefined
      : !viewer!.details[target] ? `${target} preview assets are unavailable.` : undefined,
  });
  previewActions.subscribe(persist);
  shape.onchange = () => viewer!.eyeShape(+shape.value);
  input("exposure").oninput = () =>
    previewActions!.dispatch({ kind: "preview.setExposure", value: +input("exposure").value });
  input("light-angle").oninput = () =>
    previewActions!.dispatch({ kind: "preview.setKeyAngle", degrees: +input("light-angle").value });
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
  previewRestored = true;
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
      recipe: structuredClone(recipe),
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
      lastRasterMs: lastRaster,
      frameTiming:viewer!.frameTiming(),
      rasterQueue: maskClient.diagnostics(),
      previewQuality: { requestedSize: textureSize, canvases: canvases.map(c => c.width),
        materials: viewer!.makeupDiagnostics(), assessment: qualityAssessment(), error: qualityError },
      savedV: savedV
        ? { gameVersion: savedV.gameVersion, evidence: savedV.evidence }
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
