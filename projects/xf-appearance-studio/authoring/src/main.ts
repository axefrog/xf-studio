import {
  MAX_LAYERS,
  parseRecipe,
  clamp,
  type Recipe,
  type Layer,
} from "./recipe";
import { editLayers, type LayerCommand } from "./layer-stack";
import { layerList } from "./layer-ui";
import { setupSidebars } from "./sidebar-ui";
import { setupContextMenus } from "./context-menu";
import { createScene } from "./scene";
import { createSurfaceEditor } from "./surface-editor";
import { layerRenderQueue } from "./layer-render-queue";
import { createRasterClient } from "./raster-client";
import { selectedWarp, type FieldSelection } from "./field-selection";
import { setupFields } from "./field-ui";
import { editPigment, type PigmentCommand } from "./pigment-edit";
import { editSoftness, type SoftnessCommand } from "./softness-edit";
import { setupSoftness } from "./softness-ui";
import { assessPreviewQuality, type PreviewTextureSize } from "./preview-quality";
import { setupPreviewQuality } from "./preview-quality-ui";
import type { RasterResponse,GlitterStats } from "./raster-processor";
import { setupPigment } from "./pigment-ui";
import { convertToBezier, setPointMode } from "./bezier-path";
import { setupPathControls, type PathCommand } from "./path-ui";
import { createUVEditor } from "./uv-editor";
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
import {defaultStudioIrregularFlakes,FLAKE_LIMITS} from "./flake-field";
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
const glitterMeasurements=new Map<string,{opticalKey:string;maskKey:string;stats:GlitterStats}>();
let fieldSelection: FieldSelection = workspace.fieldSelection;
const history: string[] = workspace.history.map(r => JSON.stringify(r));
let workspaceReady = false, previewRestored = false, persistTimer: ReturnType<typeof setTimeout> | undefined;
let presetLibrary: ReturnType<typeof setupCollections> | undefined;
function checkpoint() {
  const s = JSON.stringify(recipe);
  if (history.at(-1) !== s) history.push(s);
  if (history.length > 80) history.shift();
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
  const l = current(); if (!l?.fields.some(f => f.id === id)) return;
  fieldSelection = { ...fieldSelection, [l.id]: id }; sync(); drawUV(); persist();
}
const panel = document.querySelector<HTMLElement>(".properties")!;
const layersPanel = document.querySelector<HTMLElement>(".layers-panel")!;
const sidebars = setupSidebars(workspace.panels, persist);
function snapshot(): WorkspaceState {
  // Editing/recipe autosave still works if preview assets fail or are still loading.
  const editing = { recipe, active, selected, fieldSelection, uvView: uvEditor?.snapshot() ?? workspace.uvView, history: history.map(s => JSON.parse(s)), savedV,
    library: workspace.library, collections: presetLibrary?.snapshot() ?? workspace.collections };
  if (!previewRestored) return { ...workspace, ...editing, preview: { ...workspace.preview, textureSize },
    panels: { ...workspace.panels, ...sidebars.snapshot(), previewQuality: $<HTMLDetailsElement>("quality-panel").open } };
  return {
    schema: "xfas/workspace-1", ...editing,
    preview: {
      textureSize,
      camera: viewer?.cameraState() ?? workspace.preview.camera, eyeShape: +$<HTMLSelectElement>("eye-shape").value,
      surface: input("surface-controls").checked, wire: input("wire").checked,
      brows: input("brows").checked, lashes: input("lashes").checked, hair: input("hair").checked,
      piercings: input("piercings").checked, piercingStyle: $<HTMLSelectElement>("piercing-style").value,
      piercingDefinition: $<HTMLSelectElement>("piercing-colour").value, normals: input("normals").checked,
      exposure: +input("exposure").value, lightAngle: +input("light-angle").value,
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
  select(i) { active = i; selected = 0; sync(); drawUV(); persist(); },
  rename(i) { active = i; selected = 0; sync(); drawUV(); persist(); input("layer-name").focus(); input("layer-name").select(); },
  toggle(i, enabled) { checkpoint(); recipe.layers[i].enabled = enabled; render(i); },
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
  try {
    const next = editLayers(recipe, current()?.id, command);
    checkpoint(); replaceRecipe(next.recipe, next.active);
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
  $<HTMLButtonElement>("undo").disabled = history.length === 0;
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
  $("flake-legacy").hidden = isIrregular(l.flakes) && l.finish === "glitter";
  $("flake-irregular").hidden = !(isIrregular(l.flakes) && l.finish === "glitter");
  $("flake-opt-in").hidden = l.finish !== "glitter" || isIrregular(l.flakes);
  const flakes = l.flakes ?? defaultFlakes();
  for (const id of ["cells", "density", "tilt"] as const) {
    const legacy = isIrregular(flakes) ? defaultFlakes() : flakes;
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
  $<HTMLButtonElement>("undo").disabled = history.length === 0;
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
    if (viewer) { viewer.updateLayer(i, layer, optics, albedo); initialOptics[i] = undefined; }
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
  const needsOptics = layer.enabled && ["shimmer", "glitter"].includes(canonicalFinish(layer.finish)) &&
    (viewer ? viewer.needsOptics(i, layer, size) : initialOptics[i]?.key !== opticalKey(layer, size));
  maskClient.request(i, layer, i === active, size, needsOptics);
  viewer?.updateLayer(i, recipe.layers[i]);
  persist();
  sync();
  drawUV();
}
const scheduleLayer = layerRenderQueue(() => recipe.layers, run => requestAnimationFrame(run), render);
function schedule() { scheduleLayer(current()); }

function undo() {
  const s = history.pop();
  if (!s) return;
  const next = parseRecipe(JSON.parse(s));
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
    if (id === "color") l.color = control.value;
    else if (id === "weight") l.points = editPigment(l, { kind: "point-strength", index: selected, value: +control.value }).points;
    else l.opacity = +control.value;
    schedule();
  };
}
input("symmetry").onchange = () => {
  checkpoint();
  current().symmetry = input("symmetry").checked;
  render();
};
$<HTMLSelectElement>("finish").onchange = () => {
  checkpoint();
  const l=current(), finish=$<HTMLSelectElement>("finish").value as Layer["finish"];
  if (finish!=="glitter" && isIrregular(l.flakes)) l.flakes=defaultFlakes();
  l.finish = finish;
  render();
};
for (const id of ["cells", "density", "tilt"] as const) {
  const control = input("flake-" + id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", checkpoint);
  control.oninput = () => {
    const l = current();
    if (isIrregular(l.flakes)) return;
    l.flakes ??= defaultFlakes();
    l.flakes[id] = +control.value;
    schedule();
  };
}
$("flake-opt-in").onclick = () => {
  const l=current(); if (!l || l.finish!=="glitter" || isIrregular(l.flakes)) return;
  checkpoint(); l.flakes=defaultStudioIrregularFlakes(); render();
};
for (const id of ["count","radius","spread","tilt","color"] as const) {
  const control=input("irregular-"+id);
  control.addEventListener("pointerdown",checkpoint);
  control.addEventListener("keydown",checkpoint);
  control.oninput=()=>{
    const l=current(); if(!l || !isIrregular(l.flakes))return;
    const next={...l.flakes};
    if(id==="color") next.color=control.value;
    else if(id==="count")next.count=+control.value*5000;
    else next[id]=+control.value;
    try {parseRecipe({...recipe,layers:recipe.layers.map(layer=>layer===l?{...layer,flakes:next}:layer)});}
    catch {status("This amount and flake size exceed the fine Glitter preview range. Reduce size before raising amount.");sync();return;}
    l.flakes=next;
    schedule();
  };
}
function changePath(command: PathCommand) {
  const layer = current(); if (!layer) return;
  try {
    const next = command.kind === "enable-bezier" ? convertToBezier(layer) : setPointMode(layer, command.index, command.mode);
    if (JSON.stringify(next) === JSON.stringify(layer)) return;
    checkpoint(); Object.assign(layer, next); schedule(); sync(); persist();
  } catch (error) { status((error as Error).message); sync(); }
}
refreshPath = setupPathControls({
  enable: $("path-enable"), modes: $("point-modes"), note: $("path-note"),
  aligned: $("point-aligned"), symmetric: $("point-symmetric"), corner: $("point-corner"),
}, { layer: current, selected: () => selected, edit: changePath });
function changePigment(command: PigmentCommand) {
  const layer = current(); if (!layer) return;
  try {
    Object.assign(layer, editPigment(layer, command)); schedule(); sync(); persist();
  } catch (error) { status((error as Error).message); sync(); }
}
refreshPigment = setupPigment({
  smooth: input("smooth-strength"), blend: input("strength-blend"),
  value: $("strength-blend-value"), note: $("strength-note"),
}, { layer: current, begin: checkpoint, edit: changePigment });
function changeSoftness(command: SoftnessCommand) {
  const layer = current(); if (!layer) return;
  try {
    Object.assign(layer, editSoftness(layer, command)); schedule(); sync(); persist();
  } catch (error) { status((error as Error).message); sync(); }
}
refreshSoftness = setupSoftness({
  variable: input("variable-softness"), width: input("feather"), label: $("feather-label"),
  value: $("feather-value"), note: $("softness-note"),
}, { layer: current, selected: () => selected, begin: checkpoint, edit: changeSoftness });
refreshFields = setupFields({
  list: $("field-list"), add: $("field-add"), remove: $("field-remove"), clear: $("clear-field"),
  reach: input("radius"), value: $("radius-value"), note: $("field-note"),
}, { layer: current, selected: currentField, select: selectField, begin: checkpoint, change: schedule });
$("reset").onclick = () => { if (current()) changeLayers({ kind: "reset", id: current().id }); };
$("remove").onclick = () => {
  if (current().points.length <= 3) return;
  checkpoint();
  current().points.splice(selected, 1);
  selected = Math.min(selected, current().points.length - 1);
  render();
};
uvEditor = createUVEditor($<HTMLCanvasElement>("uv"), {
  both: $("uv-both"), single: $("uv-single"), other: $("uv-other"), fit: $("uv-fit"), note: $("uv-view-note"),
}, {
  recipe: () => recipe, layer: current, selected: () => selected,
  selectedField: () => currentField()?.id, selectField, canvases: () => canvases,
  albedo: () => viewer?.albedo.image as HTMLImageElement | undefined,
  select: index => { selected = index; sync(); }, begin: checkpoint, change: schedule,
  cancel: undo, persist, message: status,
}, workspace.uvView);
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
presetLibrary = setupCollections(() => ({ recipe, active, selected, fieldSelection, history: history.map(s => JSON.parse(s)) }), editor => {
  history.splice(0, history.length, ...editor.history.map(r => JSON.stringify(r)));
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
  $("v-card").hidden = false;
  $("v-summary").textContent =
    `${result.applied.length} facial regions applied. ${result.appearanceReferences} appearance references read. Game ${(v.gameVersion / 1000).toFixed(2)}.`;
}
function setupPiercingControls() {
  const style = $<HTMLSelectElement>("piercing-style"), colour = $<HTMLSelectElement>("piercing-colour"),
    styles = viewer!.piercingStyles;
  if (!styles.length) {
    $("piercing-note").textContent = `Piercing preview unavailable: ${viewer!.evidence.piercingError}; ${viewer!.evidence.prcError}.`;
    return;
  }
  $("piercing-note").textContent = viewer!.prcManifest
    ? "Vanilla and private PRC preview choices change only this viewport. PRC slot 72 has source geometry and approximate silver shading; other active PRC slots await linked-mesh export."
    : "A preview choice changes only this viewport. PRC resources are unavailable; vanilla material colours remain approximate.";
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
    if (!entry) { viewer!.setPiercingPreview("", ""); return; }
    for (const choice of entry.choices) {
      const option = document.createElement("option");
      option.value = choice.definition; option.textContent = `${choice.index}. ${choice.label}`; colour.append(option);
    }
    colour.value = entry.choices.some(c => c.definition === preferred) ? preferred : entry.choices[0]!.definition;
    viewer!.setPiercingPreview(entry.id, colour.value);
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
    normals: preview.normals })) input(id).checked = checked;
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
    select: (i) => {
      selected = i;
      sync();
      drawUV();
      persist();
    },
    begin: checkpoint,
    change: schedule,
    cancel: undo,
    message: status,
  });
  surface.setEnabled(input("surface-controls").checked);
  input("surface-controls").onchange = () =>
    surface.setEnabled(input("surface-controls").checked);
  for (let i = 0; i < recipe.layers.length; i++) {
    const stored = initialOptics[i];
    if (initialQuality.accepted && !(recipe.layers[i].finish==="glitter" && isIrregular(recipe.layers[i].flakes) && canvases[i].width<32))
      viewer.updateLayer(i, recipe.layers[i], stored?.key === opticalKey(recipe.layers[i], canvases[i].width) ? stored.data : undefined,
        stored?.key === opticalKey(recipe.layers[i], canvases[i].width) ? stored.albedo : undefined);
    initialOptics[i] = undefined;
  }
  $("loading").hidden = true;
  drawUV();
  $("front").onclick = () => viewer!.front();
  input("wire").onchange = () => viewer!.setWire(input("wire").checked);
  for (const name of ["brows", "lashes"]) {
    input(name).disabled = !viewer.details[name];
    input(name).checked &&= !!viewer.details[name];
    viewer.setDetail(name, input(name).checked);
    input(name).onchange = () => viewer!.setDetail(name, input(name).checked);
  }
  if (!savedV) input("hair").disabled = true;
  viewer.setHair(input("hair").checked);
  input("hair").onchange = () => viewer!.setHair(input("hair").checked);
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
  shape.onchange = () => viewer!.eyeShape(+shape.value);
  input("exposure").oninput = () =>
    viewer!.setExposure(+input("exposure").value);
  input("light-angle").oninput = () =>
    viewer!.setLightAngle(+input("light-angle").value);
  input("normals").onchange = () =>
    viewer!.setNormals(input("normals").checked);
  input("fov").oninput = () => {
    viewer!.setFov(+input("fov").value);
    $("fov-value").textContent = `${input("fov").value}°`;
  };
  // Motion is restored before the neutral-space camera, applying its offset once.
  if (preview.camera) viewer.restoreCamera(preview.camera);
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
