import { initialRecipe, parseRecipe, type Recipe } from "./recipe";
import { parseSavedV, type SavedV } from "./save-reader";
import { parseCollectionWorkspace, emptyMemory, emptyRecipe, type CollectionWorkspace } from "./collection-workspace";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { defaultUVView, parseUVView, type UVView } from "./uv-view";
import { DEFAULT_PREVIEW_TEXTURE_SIZE, parsePreviewTextureSize, type PreviewTextureSize } from "./preview-quality";

export type CameraState = { position: number[]; target: number[]; fov: number };
export type LibraryState = { selected: string; name: string; current?: { id: string; revision: number } };
export type PreviewState = {
  textureSize: PreviewTextureSize;
  camera?: CameraState;
  eyeShape: number;
  surface: boolean; wire: boolean; brows: boolean; lashes: boolean; normals: boolean;
  exposure: number; lightAngle: number; blink: number; blinkPlaying: boolean;
  idle: boolean; idleTime: number; idlePaused: boolean; idleBody: boolean; idleFace: boolean;
};
export type WorkspaceState = {
  schema: "xfas/workspace-1";
  recipe: Recipe; active: number; selected: number; history: Recipe[];
  uvView: UVView;
  fieldSelection: FieldSelection;
  savedV?: SavedV;
  preview: PreviewState;
  library: LibraryState;
  collections?: CollectionWorkspace;
  panels: { lighting: boolean; previewQuality: boolean; layersScroll: number; propertiesScroll: number; pageX: number; pageY: number;
    sidebarLeft: number; sidebarRight: number };
};
export function freshWorkspace(recipe = initialRecipe()): WorkspaceState {
  return {
    schema: "xfas/workspace-1", recipe, active: 0, selected: 0, history: [],
    uvView: defaultUVView(), fieldSelection: {},
    preview: { textureSize: DEFAULT_PREVIEW_TEXTURE_SIZE, eyeShape: 9, surface: true, wire: false, brows: true, lashes: true,
      normals: true, exposure: 1.2, lightAngle: 329, blink: 0, blinkPlaying: false, idle: false, idleTime: 0,
      idlePaused: false, idleBody: true, idleFace: true },
    library: { selected: "", name: "Untitled look" },
    panels: { lighting: false, previewQuality: false, layersScroll: 0, propertiesScroll: 0, pageX: 0, pageY: 0, sidebarLeft: 260, sidebarRight: 350 },
  };
}
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);

/** A versioned workspace is one atomic document; recipe files remain portable makeup only. */
export function parseWorkspace(value: unknown): WorkspaceState {
  const v = value as WorkspaceState;
  if (!v || v.schema !== "xfas/workspace-1") throw Error("Unsupported workspace version");
  const recipe = parseRecipe(v.recipe), state = freshWorkspace(recipe);
  state.uvView = parseUVView(v.uvView);
  state.fieldSelection = parseFieldSelection(v.fieldSelection, recipe);
  if (Number.isInteger(v.active) && finite(v.active, 0, recipe.layers.length - 1)) state.active = v.active;
  if (recipe.layers.length && Number.isInteger(v.selected) && finite(v.selected, 0, recipe.layers[state.active].points.length - 1)) state.selected = v.selected;
  if (Array.isArray(v.history)) for (const item of v.history.slice(-80)) {
    try { state.history.push(parseRecipe(item)); } catch { /* One damaged undo entry must not lose the draft. */ }
  }
  if (v.savedV !== undefined) state.savedV = parseSavedV(v.savedV);
  const p = v.preview;
  if (p && typeof p === "object") {
    state.preview.textureSize = parsePreviewTextureSize(p.textureSize);
    for (const key of ["surface", "wire", "brows", "lashes", "normals", "blinkPlaying", "idle", "idlePaused", "idleBody", "idleFace"] as const)
      if (typeof p[key] === "boolean") state.preview[key] = p[key];
    for (const [key, min, max] of [["eyeShape", 0, 21], ["exposure", .5, 2], ["lightAngle", 0, 360],
      ["blink", 0, 1], ["idleTime", 0, Number.MAX_SAFE_INTEGER]] as const)
      if (finite(p[key], min, max)) state.preview[key] = p[key];
    state.preview.eyeShape = Math.round(state.preview.eyeShape);
    if (state.preview.idle) { state.preview.blinkPlaying = false; state.preview.blink = 0; }
    else state.preview.idlePaused = false;
    const c = p.camera, vector = (x: unknown): x is number[] =>
      Array.isArray(x) && x.length === 3 && x.every(n => finite(n, -100, 100));
    if (c && vector(c.position) && vector(c.target) && finite(c.fov, 10, 90)) {
      const distance = Math.hypot(...c.position.map((n, i) => n - c.target[i]));
      if (distance >= .099 && distance <= 1.201) state.preview.camera = structuredClone(c);
    }
  }
  if (v.library) {
    if (typeof v.library.name === "string" && v.library.name.length <= 120) state.library.name = v.library.name;
    if (uuid(v.library.selected)) state.library.selected = v.library.selected;
    const c = v.library.current;
    if (c && uuid(c.id) && Number.isSafeInteger(c.revision) && c.revision >= 1)
      state.library.current = { id: c.id, revision: c.revision };
  }
  if (v.panels) {
    for (const [key, min] of [["sidebarLeft", 220], ["sidebarRight", 280]] as const)
      if (finite(v.panels[key], min, Number.MAX_SAFE_INTEGER)) state.panels[key] = v.panels[key];
    if (typeof v.panels.lighting === "boolean") state.panels.lighting = v.panels.lighting;
    if (typeof v.panels.previewQuality === "boolean") state.panels.previewQuality = v.panels.previewQuality;
    for (const key of ["layersScroll", "propertiesScroll", "pageX", "pageY"] as const)
      if (finite(v.panels[key], 0, 100000)) state.panels[key] = v.panels[key];
  }
  if (v.collections !== undefined) {
    state.collections = parseCollectionWorkspace(v.collections);
    const preset = state.collections.collection.presets.find(p => p.id === state.collections!.selected);
    state.recipe = preset ? structuredClone(preset.recipe) : emptyRecipe();
    const memory = preset ? state.collections.editors[preset.id] ?? emptyMemory() : emptyMemory();
    state.active = memory.active; state.selected = memory.selected; state.history = memory.history;
    state.fieldSelection = memory.fieldSelection ?? {};
  }
  return state;
}

export function workspaceKeys(verification: boolean) {
  return {
    workspace: verification ? "xfas.workspace.verification.v1" : "xfas.workspace.v1",
    legacy: verification ? "eye-artistry.verification.v1" : "eye-artistry.recipe.v1",
  };
}

/** Never replace unreadable saved work automatically. Storage errors stay visible to the UI. */
export function loadWorkspace(storage: Pick<Storage, "getItem">, verification: boolean) {
  const keys = workspaceKeys(verification);
  let error: string | undefined;
  try {
    const raw = storage.getItem(keys.workspace);
    if (raw !== null) return { state: parseWorkspace(JSON.parse(raw)), writable: true };
  } catch (e) { error = `Workspace could not be restored: ${(e as Error).message}`; }
  let state = freshWorkspace();
  try {
    const legacy = storage.getItem(keys.legacy);
    if (legacy !== null) state = freshWorkspace(parseRecipe(JSON.parse(legacy)));
  } catch (e) { error ??= `Saved draft could not be restored: ${(e as Error).message}`; }
  return { state, writable: !error, error };
}
