import { initialRecipe, parseRecipe, starterRecipe, type Recipe } from "./recipe";
import { parseSavedV, type SavedV } from "./save-reader";
import { parseCollectionWorkspace, emptyMemory, emptyRecipe, type CollectionWorkspace,
  type RestoreWarnings } from "./collection-workspace";
import { parseFieldSelection, type FieldSelection } from "./field-selection";
import { defaultUVView, parseUVView, type UVView } from "./uv-view";
import { DEFAULT_PREVIEW_TEXTURE_SIZE, parsePreviewTextureSize, type PreviewTextureSize } from "./preview-quality";
import { MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE } from "./camera-framing";
import {parseGlitterChoices, type GlitterChoices} from "./glitter-model";
import { defaultUIPreferences, parseUIPreferences, type UIPreferences } from "./ui-preferences";

export type CameraState = { position: number[]; target: number[]; fov: number };
export type LibraryState = { selected: string; name: string; current?: { id: string; revision: number } };
export type PreviewState = {
  textureSize: PreviewTextureSize;
  camera?: CameraState;
  eyeShape: number;
  surface: boolean; wire: boolean; brows: boolean; lashes: boolean; hair: boolean; piercings: boolean; normals: boolean; eyeOptics: boolean;
  piercingStyle: string; piercingDefinition: string;
  exposure: number; lightAngle: number; blink: number; blinkPlaying: boolean;
  idle: boolean; idleTime: number; idlePaused: boolean; idleBody: boolean; idleFace: boolean;
};
export type WorkspaceState = {
  schema: "xfas/workspace-1";
  recipe: Recipe; active: number; selected: number; history: Recipe[];
  uvView: UVView;
  fieldSelection: FieldSelection;
  glitterChoices: GlitterChoices;
  savedV?: SavedV;
  preview: PreviewState;
  library: LibraryState;
  collections?: CollectionWorkspace;
  uiPreferences: UIPreferences;
};
export function freshWorkspace(recipe = initialRecipe()): WorkspaceState {
  return {
    schema: "xfas/workspace-1", recipe, active: 0, selected: 0, history: [],
    uvView: defaultUVView(), fieldSelection: {}, glitterChoices: {},
    preview: { textureSize: DEFAULT_PREVIEW_TEXTURE_SIZE, eyeShape: 9, surface: true, wire: false, brows: true, lashes: true, hair: true,
      piercings: true, piercingStyle: "", piercingDefinition: "",
      normals: true, eyeOptics: false, exposure: 1.2, lightAngle: 329, blink: 0, blinkPlaying: false, idle: false, idleTime: 0,
      idlePaused: false, idleBody: true, idleFace: true },
    library: { selected: "", name: "Untitled look" },
    uiPreferences: defaultUIPreferences(),
  };
}
const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);

/**
 * A versioned workspace is one atomic document; recipe files remain portable makeup only.
 * With `warnings`, damaged recovery drafts and removed presets are dropped (and noted)
 * instead of failing the restore; the current draft must always parse.
 */
export function parseWorkspace(value: unknown, warnings?: RestoreWarnings): WorkspaceState {
  const v = value as WorkspaceState;
  if (!v || v.schema !== "xfas/workspace-1") throw Error("Unsupported workspace version");
  const recipe = parseRecipe(v.recipe), state = freshWorkspace(recipe);
  state.uiPreferences = parseUIPreferences(v.uiPreferences);
  state.uvView = parseUVView(v.uvView);
  state.fieldSelection = parseFieldSelection(v.fieldSelection, recipe);
  state.glitterChoices = parseGlitterChoices(v.glitterChoices);
  if (Number.isInteger(v.active) && finite(v.active, 0, recipe.layers.length - 1)) state.active = v.active;
  if (recipe.layers.length && Number.isInteger(v.selected) && finite(v.selected, 0, recipe.layers[state.active].points.length - 1)) state.selected = v.selected;
  if (Array.isArray(v.history)) for (const item of v.history.slice(-80)) {
    try { state.history.push(parseRecipe(item)); } catch { /* One damaged undo entry must not lose the draft. */ }
  }
  if (v.savedV !== undefined) state.savedV = parseSavedV(v.savedV);
  const p = v.preview;
  if (p && typeof p === "object") {
    state.preview.textureSize = parsePreviewTextureSize(p.textureSize);
    for (const key of ["surface", "wire", "brows", "lashes", "hair", "piercings", "normals", "eyeOptics", "blinkPlaying", "idle", "idlePaused", "idleBody", "idleFace"] as const)
      if (typeof p[key] === "boolean") state.preview[key] = p[key];
    if (typeof p.piercingStyle === "string" && p.piercingStyle.length <= 128) state.preview.piercingStyle = p.piercingStyle;
    if (typeof p.piercingDefinition === "string" && p.piercingDefinition.length <= 128) state.preview.piercingDefinition = p.piercingDefinition;
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
      if (distance >= MIN_CAMERA_DISTANCE - .001 && distance <= MAX_CAMERA_DISTANCE + .001) state.preview.camera = structuredClone(c);
    }
  }
  if (v.library) {
    if (typeof v.library.name === "string" && v.library.name.length <= 120) state.library.name = v.library.name;
    if (uuid(v.library.selected)) state.library.selected = v.library.selected;
    const c = v.library.current;
    if (c && uuid(c.id) && Number.isSafeInteger(c.revision) && c.revision >= 1)
      state.library.current = { id: c.id, revision: c.revision };
  }
  // Workspaces saved by earlier builds also hold the retired sidebar shell's `panels` (sidebar
  // widths, scroll positions, open sections). It is ignored here and not written again; the
  // Studio's dock layout lives in `uiPreferences`.
  if (v.collections !== undefined) {
    state.collections = parseCollectionWorkspace(v.collections, warnings);
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

export type LoadedWorkspace = { state: WorkspaceState; writable: boolean; error?: string;
  /** Damaged non-current entries that were dropped; the rest of the workspace was restored. */
  warning?: string };

/** Never replace unreadable saved work automatically. Storage errors stay visible to the UI. */
export function loadWorkspace(storage: Pick<Storage, "getItem">, verification: boolean): LoadedWorkspace {
  const keys = workspaceKeys(verification);
  let error: string | undefined;
  try {
    const raw = storage.getItem(keys.workspace);
    if (raw !== null) {
      const warnings: RestoreWarnings = [];
      const state = parseWorkspace(JSON.parse(raw), warnings);
      return { state, writable: true, ...(warnings.length ? { warning: restoreWarning(warnings) } : {}) };
    }
  } catch (e) { error = `Workspace could not be restored: ${(e as Error).message}`; }
  // The fallback shows the small authored contour. Saved workspaces and legacy
  // recipe-only drafts still pass through their existing parsers unchanged.
  let state = freshWorkspace(starterRecipe());
  try {
    const legacy = storage.getItem(keys.legacy);
    if (legacy !== null) state = freshWorkspace(parseRecipe(JSON.parse(legacy)));
  } catch (e) { error ??= `Saved draft could not be restored: ${(e as Error).message}`; }
  return { state, writable: !error, error };
}

function restoreWarning(warnings: RestoreWarnings) {
  return warnings.length === 1 ? warnings[0] :
    `${warnings.length} damaged recovery drafts or removed presets could not be restored and were dropped; your current draft was restored.`;
}
