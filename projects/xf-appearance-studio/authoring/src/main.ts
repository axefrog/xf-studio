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
import { selectedWarp, type FieldSelection } from "./field-selection";
import { setupFields } from "./field-ui";
import { createUVEditor } from "./uv-editor";
import { setupCollections } from "./collection-ui";
import { setupMotionControls } from "./motion-ui";
import { readSavedV, type SavedV } from "./save-reader";
import { loadWorkspace, workspaceKeys, type WorkspaceState } from "./workspace-state";
import {
  canonicalFinish,
  defaultFlakes,
  finishLabel,
  finishDescription,
} from "./finish";
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
let recipe = workspace.recipe, active = workspace.active, selected = workspace.selected;
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
  c.width = c.height = 1024;
  return c;
});
let viewer: Awaited<ReturnType<typeof createScene>> | undefined;
let savedV: SavedV | undefined = workspace.savedV;
const current = () => recipe.layers[active];
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
  if (!previewRestored) return { ...workspace, ...editing, panels: { ...workspace.panels, ...sidebars.snapshot() } };
  return {
    schema: "xfas/workspace-1", ...editing,
    preview: {
      camera: viewer?.cameraState() ?? workspace.preview.camera, eyeShape: +$<HTMLSelectElement>("eye-shape").value,
      surface: input("surface-controls").checked, wire: input("wire").checked,
      brows: input("brows").checked, lashes: input("lashes").checked, normals: input("normals").checked,
      exposure: +input("exposure").value, lightAngle: +input("light-angle").value,
      blink: +input("blink").value, blinkPlaying: $("play").getAttribute("aria-pressed") === "true",
      idle: viewer?.idle?.enabled ?? workspace.preview.idle,
      idleTime: viewer?.idle?.time ?? workspace.preview.idleTime,
      idlePaused: viewer?.idle?.paused ?? workspace.preview.idlePaused,
      idleBody: viewer?.idle?.bodyEnabled ?? workspace.preview.idleBody,
      idleFace: viewer?.idle?.faceEnabled ?? workspace.preview.idleFace,
    },
    panels: { ...sidebars.snapshot(), lighting: $<HTMLDetailsElement>("lighting-panel").open,
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
panel.addEventListener("scroll", persist);
layersPanel.addEventListener("scroll", persist);
let uvEditor: ReturnType<typeof createUVEditor> | undefined;
let refreshFields: (() => void) | undefined;
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
  queue.clear(); versions.length = recipe.layers.length; versions.fill(0);
  // A structure change cannot reuse an in-flight mask or an old slot's pixels.
  canvases.splice(0, canvases.length, ...recipe.layers.map(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024; return canvas;
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
  const flakes = l.flakes ?? defaultFlakes();
  for (const id of ["cells", "density", "tilt"] as const) {
    input("flake-" + id).value = String(flakes[id]);
    $("flake-" + id + "-value").textContent =
      id === "cells" ? String(flakes[id]) : `${Math.round(flakes[id] * 100)}%`;
  }
  for (const [id, value] of Object.entries({
    weight: l.points[selected].weight,
    feather: l.feather,
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
const worker = new Worker("/build/raster-worker.js", { type: "module" }),
  queue = new Map<number, { version: number; layer: Layer }>(),
  versions = recipe.layers.map(() => 0);
let busy = false, requestVersion = 0;
function dispatch() {
  if (busy || !queue.size) return;
  const [i, job] = queue.entries().next().value!;
  queue.delete(i);
  busy = true;
  worker.postMessage({ i, ...job, size: 1024 });
}
worker.onmessage = (
  e: MessageEvent<{
    i: number;
    version: number;
    data: Uint8ClampedArray<ArrayBuffer>;
    ms: number;
  }>,
) => {
  const { i, version, data, ms } = e.data;
  busy = false;
  if (recipe.layers[i] && version === versions[i]) {
    canvases[i]
      .getContext("2d")!
      .putImageData(new ImageData(data, 1024, 1024), 0, 0);
    viewer?.updateLayer(i, recipe.layers[i]);
    lastRaster = ms;
    drawUV();
    status(`Live mask · 1024² · ${Math.round(ms)} ms · layer ${i + 1}`);
  }
  dispatch();
};
worker.onerror = () =>
  status("Mask worker failed — reload the editor to recover.");
function render(i = active) {
  if (!recipe.layers[i]) return;
  queue.set(i, {
    version: (versions[i] = ++requestVersion),
    layer: structuredClone(recipe.layers[i]),
  });
  dispatch();
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
for (const id of ["weight", "feather", "opacity", "color"]) {
  const control = input(id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", () => checkpoint());
  control.oninput = () => {
    const l = current();
    if (id === "color") l.color = control.value;
    else if (id === "weight") l.points[selected].weight = +control.value;
    else if (id === "feather") l.feather = +control.value;
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
  current().finish = $<HTMLSelectElement>("finish").value as Layer["finish"];
  render();
};
for (const id of ["cells", "density", "tilt"] as const) {
  const control = input("flake-" + id);
  control.addEventListener("pointerdown", checkpoint);
  control.addEventListener("keydown", checkpoint);
  control.oninput = () => {
    const l = current();
    l.flakes ??= defaultFlakes();
    l.flakes[id] = +control.value;
    schedule();
  };
}
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
  $("v-eyes").textContent = result.eyeAppearance.message;
  $("v-card").hidden = false;
  $("v-summary").textContent =
    `${result.applied.length} facial regions applied. ${result.appearanceReferences} appearance references read. Game ${(v.gameVersion / 1000).toFixed(2)}.`;
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
  viewer = await createScene($("viewport"), canvases);
  viewer.setLayerCanvases(canvases);
  if (savedV) showSavedV(savedV);
  const preview = workspace.preview;
  for (const [id, checked] of Object.entries({ "surface-controls": preview.surface, wire: preview.wire,
    brows: preview.brows, lashes: preview.lashes, normals: preview.normals })) input(id).checked = checked;
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
  for (let i = 0; i < recipe.layers.length; i++) viewer.updateLayer(i, recipe.layers[i]);
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
  if (viewer.evidence.detailErrors.length)
    $("detail-note").textContent =
      `Some details unavailable: ${viewer.evidence.detailErrors.join("; ")}`;
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
  viewer.renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.shiftKey || !current()) return;
      e.preventDefault();
      const uv = viewer!.pick(e);
      if (!uv) return;
      e.stopImmediatePropagation();
      checkpoint();
      const p = current().points[selected];
      p.u = current().symmetry && uv.x > 0.5 ? 1 - uv.x : uv.x;
      p.v = uv.y;
      render();
    },
    true,
  );
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
