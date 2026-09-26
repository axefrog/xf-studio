import { emptyRecipe, type Recipe } from "./engines/layered-makeup/recipe";
import { readRecipe as parseRecipe } from "./recipe-schema";
import { parseSavedV, type SavedV } from "./save-reader";
import { liveFeatureStates, liveMemory, livePart, parseCollectionWorkspace, readCollectionWorkspaceV1, withLiveFeatures, withLiveMemory,
  writeCollectionWorkspace,
  type CollectionWorkspace, type DocumentModel, type RestoreWarnings } from "./collection-workspace";
import { isNewerData, LOOK_HISTORY_1, LOOK_MEMORY, type LookMemory, type PartEnvelope } from "./platform/api";
import type { DocumentHistory } from "./authoring-document";
import { emptyLookHistory } from "./platform/core/look-history";
import type { NewerPolicy } from "./platform/core/document";
import type { LiveFeatureState } from "./platform/core/live-features";
import { parseFieldSelection, type FieldSelection } from "./engines/layered-makeup/field-selection";
import { defaultUVView, parseUVView, type UVView } from "./uv-view";
import { DEFAULT_PREVIEW_TEXTURE_SIZE, parsePreviewTextureSize, type PreviewTextureSize } from "./preview-quality";
import { MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE } from "./camera-framing";
import {parseGlitterChoices, type GlitterChoices} from "./engines/layered-makeup/glitter-model";
import { defaultUIPreferences, parseUIPreferences, type UIPreferences } from "./ui-preferences";
import { isCreatorName } from "./creator-names";
import { storedCharacterOf, type StoredCharacter } from "./character-context-actions";
import { DEFAULT_CREATOR_LIGHTING, DEFAULT_LIGHTING_PRESET, LIGHTING_PRESETS, validCreatorLighting, type CreatorLightingOptions,
  type LightingPreset } from "./creator-lighting";
import { DEFAULT_STUDIO_LIGHTS, sameStudioLights, STUDIO_EXPOSURE_RANGE, validStudioLights, type StudioLights } from "./studio-lighting";

export type CameraState = { position: number[]; target: number[]; fov: number };
export type LibraryState = { selected: string; name: string; current?: { id: string; revision: number } };
export type PreviewState = {
  textureSize: PreviewTextureSize;
  camera?: CameraState;
  eyeShape: number;
  surface: boolean; wire: boolean; brows: boolean; lashes: boolean; hair: boolean; piercings: boolean; normals: boolean;
  /**
   * Retired: the earlier opt-in for the eye's own roughness (off unless chosen). Read and written back unchanged, so a workspace keeps
   * its stored bytes; nothing uses it now (`eyeOwnRoughness`).
   */
  eyeOptics: boolean;
  /**
   * Whether the eyes use their own roughness (`preview.setEyeOptics`). Absent means on, so every workspace, including one that stored
   * the retired opt-in off, starts with the game's roughness; written only once the viewer changes it.
   */
  eyeOwnRoughness?: boolean;
  /**
   * Whether the V's body shows (body, arms, hands, feet and their decals). Absent means shown: it is written only once the viewer
   * changes it, so a workspace that never did keeps its stored bytes.
   */
  body?: boolean;
  /**
   * Whether the V's body draws as the game draws it with nudity allowed (`preview.setUncensored`; knowledge/body-rendering.md §3): the
   * uncensored skin, nipples and genitals as chosen, and no censorship underwear. Absent means off, the game's censored look under its
   * underwear cover: it is written only once the viewer changes it.
   */
  uncensored?: boolean;
  /**
   * Retired: the piercing style an earlier build tried on the V (`character.tryChoice`): a switcher choice and a definition of the option
   * it activates. Read so an untouched workspace writes it back unchanged, and so the character context can turn it into the matching
   * Piercings choices once the catalogue is ready (CORE-74); nothing writes new values here.
   */
  piercingStyle: string; piercingDefinition: string;
  /**
   * The character context (character-context-actions.ts): the V's source and the creator choices set on it. Present only once
   * something was set, so a workspace that never used the creator controls keeps its stored bytes.
   */
  character?: StoredCharacter;
  exposure: number; lightAngle: number; blink: number; blinkPlaying: boolean;
  /** Viewport lighting preset; the studio stage is the default. `exposure`, `lightAngle` and `studioLights` belong to it. */
  lightingPreset: LightingPreset;
  /**
   * The studio stage's strengths, key elevation and tint (studio-lighting.ts). Stored only when it differs from the original rig,
   * so a workspace that never adjusts it keeps its stored bytes, and one saved before these controls loads the original rig.
   */
  studioLights: StudioLights;
  /** The creator preset's diagnostic switches and its exposure scalar. */
  creatorLighting: CreatorLightingOptions;
  idle: boolean; idleTime: number; idlePaused: boolean; idleBody: boolean; idleFace: boolean;
};
export const WORKSPACE_1 = "xfas/workspace-1";
export const WORKSPACE_2 = "xfs/workspace-2";
/**
 * The live workspace. The editor fields (`recipe` … `fieldSelection`) are the one live document's
 * state (eye makeup's part and editor memory) and `glitterChoices` is eye makeup's feature-wide
 * memory; `serializeWorkspace` stores them per feature (`xfs/workspace-2`).
 */
export type WorkspaceState = {
  schema: typeof WORKSPACE_2;
  recipe: Recipe; active: number; selected: number;
  /**
   * The live look's Undo history: `LookHistoryData` when read or captured by this build; eye
   * makeup's whole recipes, oldest first, are accepted too (fresh workspaces and tests build one so).
   */
  history: DocumentHistory;
  /** Present (true) only when older Undo entries than the oldest kept one were dropped. */
  historyTrimmed?: boolean;
  uvView: UVView;
  fieldSelection: FieldSelection;
  glitterChoices: GlitterChoices;
  savedV?: SavedV;
  preview: PreviewState;
  library: LibraryState;
  collections?: CollectionWorkspace;
  uiPreferences: UIPreferences;
  /**
   * 3D preview setup preference: whether the preview may start preparing by itself once nothing is
   * missing (off after the person cancelled a run). Absent means on. Kept in the workspace so it
   * follows the verification scope and survives the desktop's changing loopback port.
   */
  previewSetup?: { autostart: boolean };
  /**
   * Entries of features this build does not register (from a newer build), carried unchanged:
   * the loose look's other parts and memory, and other features' workspace memory.
   */
  otherFeatures?: { parts?: Record<string, PartEnvelope>; memory?: LookMemory; features?: Record<string, unknown> };
  /**
   * The live look's other registered features (their parts and editor memory), beside the live document's
   * fields above; present only when the composition registers features beside the live one (step 5).
   */
  liveFeatures?: Record<string, LiveFeatureState>;
  /** Present when the selected look is locked (it holds a newer build's data): why, in plain words. Never stored. */
  liveLocked?: string;
};
/**
 * The stored `xfs/workspace-2` document. Editor memory is per feature: `look` is the editor
 * when no collection draft owns it (absent when `collections` is present, whose selected look
 * restores the editor), `features` is each feature's workspace-wide memory, and each collection
 * look's memory is kept by feature beside it. View state (camera, UV view, preferences) is as in workspace-1.
 */
export type StoredWorkspace = Omit<WorkspaceState, "schema" | "recipe" | "active" | "selected" | "history" | "historyTrimmed" |
  "fieldSelection" | "glitterChoices" | "collections" | "otherFeatures" | "preview"> & {
  schema: typeof WORKSPACE_2;
  /** The preview state; `studioLights` only when it differs from the original rig. */
  preview: Omit<PreviewState, "studioLights"> & { studioLights?: StudioLights };
  look?: { parts: Record<string, PartEnvelope>; memory: Record<string, unknown> };
  features: Record<string, unknown>;
  collections?: ReturnType<typeof writeCollectionWorkspace>;
};
export function freshWorkspace(recipe: Recipe): WorkspaceState {
  return {
    schema: WORKSPACE_2, recipe, active: 0, selected: 0, history: emptyLookHistory(),
    uvView: defaultUVView(), fieldSelection: {}, glitterChoices: {},
    preview: { textureSize: DEFAULT_PREVIEW_TEXTURE_SIZE, eyeShape: 9, surface: true, wire: false, brows: true, lashes: true, hair: true,
      piercings: true, piercingStyle: "", piercingDefinition: "",
      normals: true, eyeOptics: false, exposure: 1.2, lightAngle: 329, blink: 0, blinkPlaying: false,
      lightingPreset: DEFAULT_LIGHTING_PRESET, creatorLighting: { ...DEFAULT_CREATOR_LIGHTING },
      studioLights: { ...DEFAULT_STUDIO_LIGHTS }, idle: false, idleTime: 0,
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
 * Reads the stored `xfs/workspace-2` and, losslessly, `xfas/workspace-1` (its recipe, editor
 * memory and Undo histories become eye makeup's part and memory; `glitterChoices` becomes eye
 * makeup's feature memory). With `warnings`, damaged recovery drafts and removed presets are
 * dropped (and noted) instead of failing the restore; the current draft must always parse.
 *
 * Data from a newer build (a part schema or layer model this build does not know, anywhere: the
 * current draft, recovery drafts, removed presets, Undo histories) is never dropped as damage.
 * It is refused with `NewerDataError`, so the stored workspace stays protected, unless `newer` is
 * `omit`: then the newer entries are left out of a view that must never be written back
 * (`loadWorkspace` opens it read-only). The current draft's own looks are always required.
 */
export function parseWorkspace(value: unknown, model: DocumentModel, warnings?: RestoreWarnings,
  newer: NewerPolicy = "refuse"): WorkspaceState {
  const v = value as Record<string, unknown> & Partial<WorkspaceState>;
  if (!v || (v.schema as string) !== WORKSPACE_1 && v.schema !== WORKSPACE_2) throw Error("Unsupported workspace version");
  // `keep` locks looks inside collection drafts only; the loose editor and workspace-1 drafts refuse newer data as before.
  const strict: NewerPolicy = newer === "keep" ? "refuse" : newer;
  const state = (v.schema as string) === WORKSPACE_1 ? readEditorV1(v, model) : readEditorV2(v as unknown as StoredWorkspace, model, strict);
  state.uiPreferences = parseUIPreferences(v.uiPreferences);
  state.uvView = parseUVView(v.uvView);
  if (v.savedV !== undefined) state.savedV = parseSavedV(v.savedV);
  const p = v.preview;
  if (p && typeof p === "object") {
    state.preview.textureSize = parsePreviewTextureSize(p.textureSize);
    for (const key of ["surface", "wire", "brows", "lashes", "hair", "piercings", "normals", "eyeOptics", "blinkPlaying", "idle", "idlePaused", "idleBody", "idleFace"] as const)
      if (typeof p[key] === "boolean") state.preview[key] = p[key];
    if (typeof p.eyeOwnRoughness === "boolean") state.preview.eyeOwnRoughness = p.eyeOwnRoughness;
    if (typeof p.body === "boolean") state.preview.body = p.body;
    if (typeof p.uncensored === "boolean") state.preview.uncensored = p.uncensored;
    // The retired tried piercing style (the shared creator name rule): written back unchanged, and migrated by the character context.
    if (isCreatorName(p.piercingStyle, true) && isCreatorName(p.piercingDefinition, true)) {
      state.preview.piercingStyle = p.piercingStyle; state.preview.piercingDefinition = p.piercingDefinition;
    }
    // The character context: the V's source and the choices set on it, validated; anything unreadable is dropped.
    const character = storedCharacterOf((p as { character?: unknown }).character);
    if (character) state.preview.character = character;
    for (const [key, min, max] of [["eyeShape", 0, 21], ["exposure", STUDIO_EXPOSURE_RANGE.min, STUDIO_EXPOSURE_RANGE.max], ["lightAngle", 0, 360],
      ["blink", 0, 1], ["idleTime", 0, Number.MAX_SAFE_INTEGER]] as const)
      if (finite(p[key], min, max)) state.preview[key] = p[key];
    state.preview.eyeShape = Math.round(state.preview.eyeShape);
    if (LIGHTING_PRESETS.includes(p.lightingPreset)) state.preview.lightingPreset = p.lightingPreset;
    if (validCreatorLighting(p.creatorLighting)) state.preview.creatorLighting = { intensity: p.creatorLighting.intensity,
      cone: p.creatorLighting.cone, exposure: p.creatorLighting.exposure };
    // All or nothing: a damaged or partial rig falls back to the original one.
    const lights = (p as { studioLights?: unknown }).studioLights;
    if (validStudioLights(lights)) state.preview.studioLights = { environment: lights.environment, key: lights.key,
      elevation: lights.elevation, fill: lights.fill, rim: lights.rim, neutral: lights.neutral };
    if (state.preview.idle) { state.preview.blinkPlaying = false; state.preview.blink = 0; }
    else state.preview.idlePaused = false;
    const c = p.camera, vector = (x: unknown): x is number[] =>
      Array.isArray(x) && x.length === 3 && x.every(n => finite(n, -100, 100));
    if (c && vector(c.position) && vector(c.target) && finite(c.fov, 10, 90)) {
      const distance = Math.hypot(...c.position.map((n, i) => n - c.target[i]));
      if (distance >= MIN_CAMERA_DISTANCE - .001 && distance <= MAX_CAMERA_DISTANCE + .001) state.preview.camera = structuredClone(c);
    }
  }
  if (v.previewSetup && typeof v.previewSetup === "object" && typeof v.previewSetup.autostart === "boolean")
    state.previewSetup = { autostart: v.previewSetup.autostart };
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
    state.collections = (v.schema as string) === WORKSPACE_1 ? readCollectionWorkspaceV1(v.collections, model, warnings, strict)
      : parseCollectionWorkspace(v.collections, model, warnings, newer);
    // The selected look restores the editor; any loose editor copy is ignored.
    const preset = state.collections.collection.presets.find(p => p.id === state.collections!.selected);
    const recipe = livePart(preset, model);
    state.recipe = recipe ? structuredClone(recipe) : emptyRecipe();
    const lookMemory = preset ? state.collections.memory[preset.id] : undefined, memory = liveMemory(lookMemory, model);
    state.active = memory.active; state.selected = memory.selected; state.history = structuredClone(memory.history);
    const others = liveFeatureStates(preset, lookMemory, model);
    if (others) state.liveFeatures = others; else delete state.liveFeatures;
    if (preset?.locked) state.liveLocked = preset.locked; else delete state.liveLocked;
    if (memory.historyTrimmed) state.historyTrimmed = true; else delete state.historyTrimmed;
    state.fieldSelection = structuredClone(memory.fieldSelection ?? {});
  }
  return state;
}

/** Workspace-1's top-level editor: the recipe, its selection, Undo history and the Glitter/shift memory. */
function readEditorV1(v: Record<string, unknown>, model: DocumentModel): WorkspaceState {
  const recipe = parseRecipe(v.recipe), state = freshWorkspace(recipe);
  state.fieldSelection = parseFieldSelection(v.fieldSelection, recipe);
  state.glitterChoices = parseGlitterChoices(v.glitterChoices);
  if (Number.isInteger(v.active) && finite(v.active, 0, recipe.layers.length - 1)) state.active = v.active as number;
  if (recipe.layers.length && Number.isInteger(v.selected) && finite(v.selected, 0, recipe.layers[state.active].points.length - 1))
    state.selected = v.selected as number;
  const history: Recipe[] = [];
  if (Array.isArray(v.history)) for (const item of v.history.slice(-80)) {
    try { history.push(parseRecipe(item)); } catch { /* One damaged undo entry must not lose the draft. */ }
  }
  const trimmed = v.historyTrimmed === true || (Array.isArray(v.history) && v.history.length > 80);
  // The look history holds the recipes (as the live document keeps them).
  state.history = liveMemory(withLiveMemory(undefined, { active: 0, selected: 0, history, historyTrimmed: trimmed }, model), model).history;
  if (trimmed) state.historyTrimmed = true;
  return state;
}

/** Workspace-2's loose look (the editor without a collection) and each feature's workspace memory. */
function readEditorV2(v: StoredWorkspace, model: DocumentModel, newer: NewerPolicy): WorkspaceState {
  const { parts: registry, live: LIVE } = model;
  const look = v.look && typeof v.look === "object" ? v.look : undefined;
  const parts: Record<string, PartEnvelope> = {};
  if (look?.parts && typeof look.parts === "object")
    for (const [feature, part] of Object.entries(look.parts)) parts[feature] = registry.readPart(feature, part);
  const memory = registry.readMemory(look?.memory, { parts }, newer);
  const recipe = livePart({ parts }, model) ?? emptyRecipe(), state = freshWorkspace(recipe);
  const live = liveMemory(memory, model);
  state.active = live.active; state.selected = live.selected; state.history = live.history;
  state.fieldSelection = live.fieldSelection ?? {};
  if (live.historyTrimmed) state.historyTrimmed = true;
  const features = registry.readFeatureWide(v.features);
  state.glitterChoices = (features[LIVE] as { choices?: GlitterChoices } | undefined)?.choices ?? {};
  // The loose look's other registered features are live documents too (step 5); only unregistered ones are carried.
  const others = liveFeatureStates({ parts }, memory, model);
  if (others) {
    state.liveFeatures = others;
    for (const feature of Object.keys(others)) { delete parts[feature]; delete memory[feature]; }
  }
  delete parts[LIVE]; delete memory[LIVE]; delete memory[LOOK_MEMORY]; delete features[LIVE];
  const other = { ...(Object.keys(parts).length ? { parts } : {}), ...(Object.keys(memory).length ? { memory } : {}),
    ...(Object.keys(features).length ? { features } : {}) };
  if (Object.keys(other).length) state.otherFeatures = other;
  return state;
}

/**
 * The stored `xfs/workspace-2` form of a live workspace: the editor and its memory per feature,
 * collection looks with their parts and per-feature memory, each part and Undo history in the
 * oldest part schema that holds it. Nothing is trimmed here; the storage budget
 * (`workspace-budget.ts`) decides what is kept before this runs. The result shares structure
 * with `state`; serialize it at once.
 */
export function serializeWorkspace(state: WorkspaceState, model: DocumentModel,
  /** `lookLevel`: Undo histories with steps in the look-level form (the storage budget's choice, CORE-39). */
  options: { lookLevel?: boolean } = {}): StoredWorkspace {
  const { parts: registry, live: LIVE } = model;
  const { schema: _schema, recipe, active, selected, history, historyTrimmed, fieldSelection, glitterChoices, collections,
    otherFeatures, liveFeatures, liveLocked: _locked, ...view } = state;
  const features = registry.writeFeatureWide({ ...otherFeatures?.features, [LIVE]: { choices: glitterChoices } });
  // The loose look: the live document, the other live features (when registered) and unregistered entries carried as they came.
  const loose = collections ? undefined : withLiveFeatures({ id: "", name: "", revision: 1,
    parts: { ...otherFeatures?.parts, [LIVE]: registry.envelope(LIVE, recipe) } },
    withLiveMemory(otherFeatures?.memory, { active, selected, fieldSelection, history, ...(historyTrimmed ? { historyTrimmed: true } : {}) }, model),
    liveFeatures, model);
  const look = loose && {
    parts: registry.minimalLook({ id: "", name: "", revision: 1, parts: loose.parts }, false).parts,
    memory: registry.writeMemory(loose.memory, options) };
  // The studio rig is stored only when adjusted: workspaces that never touch it keep their bytes (studio-lighting.ts).
  const { studioLights, ...preview } = view.preview;
  const storedPreview = sameStudioLights(studioLights, DEFAULT_STUDIO_LIGHTS) ? preview : view.preview;
  return { schema: WORKSPACE_2, ...(look ? { look } : {}), features, ...view, preview: storedPreview,
    ...(collections ? { collections: writeCollectionWorkspace(collections, model, options) } : {}) };
}

/**
 * Whether a stored workspace keeps any look's Undo history in the look-level form
 * (`xfs/look-history-1`). Such a workspace already opens read-only in builds before the look history,
 * so a host that writes it again keeps that form for every history (CORE-39).
 */
export function storesLookLevelHistory(value: unknown): boolean {
  const record = (item: unknown): Record<string, unknown> | undefined =>
    item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
  const look = (memory: unknown) => Object.values(record(memory) ?? {}).some(entry => record(entry)?.partSchema === LOOK_HISTORY_1);
  const draft = (item: unknown) => {
    const value = record(item);
    return !!value && (Object.values(record(value.memory) ?? {}).some(look) ||
      (Array.isArray(value.removed) && value.removed.some(entry => look(record(entry)?.memory))));
  };
  const stored = record(value), collections = record(stored?.collections);
  return look(record(stored?.look)?.memory) || draft(collections) || draft(collections?.previous) ||
    (Array.isArray(collections?.older) && collections.older.some(draft));
}

export function workspaceKeys(verification: boolean) {
  return {
    workspace: verification ? "xfas.workspace.verification.v1" : "xfas.workspace.v1",
    legacy: verification ? "eye-artistry.verification.v1" : "eye-artistry.recipe.v1",
  };
}

export type LoadedWorkspace = { state: WorkspaceState; writable: boolean; error?: string;
  /** Damaged non-current entries that were dropped; the rest of the workspace was restored. */
  warning?: string;
  /**
   * The workspace holds data from a newer XF Studio: `state` is a read-only view without it (the
   * current draft when that is readable, else a fresh one) and the stored workspace is never replaced.
   */
  newer?: true };

/** What the protected status says when a newer build's data keeps the workspace read-only. */
export const NEWER_WORKSPACE_MESSAGE = "Parts of this workspace were saved by a newer version of XF Studio, so it opened " +
  "without them and changes are not autosaved. Update XF Studio to keep working on it";

/**
 * Never replace unreadable saved work automatically. Storage errors stay visible to the UI. A
 * workspace holding a newer build's data anywhere opens read-only: its current draft is shown
 * when this build can read it, and nothing is ever written over the stored workspace.
 */
/** The live feature's first-run part (its codec's starter): what a fresh or unreadable workspace shows. */
const liveStarter = (model: DocumentModel) => model.parts.feature(model.live)!.part.starter() as Recipe;

export function loadWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, model: DocumentModel): LoadedWorkspace {
  const keys = workspaceKeys(verification);
  let error: string | undefined, newer = false;
  try {
    const raw = storage.getItem(keys.workspace);
    if (raw !== null) {
      const value = JSON.parse(raw), warnings: RestoreWarnings = [];
      try {
        // A look holding a newer build's data is kept verbatim and locked; everything else stays editable.
        const state = parseWorkspace(value, model, warnings, "keep");
        return { state, writable: true, ...(warnings.length ? { warning: restoreWarning(warnings) } : {}) };
      } catch (e) {
        if (!isNewerData(e)) throw e;
        newer = true;
        // Read-only view: the current draft without the newer build's entries (throws when the draft itself is newer).
        const state = parseWorkspace(value, model, [], "omit");
        return { state, writable: false, newer: true, error: NEWER_WORKSPACE_MESSAGE };
      }
    }
  } catch (e) {
    error = newer ? NEWER_WORKSPACE_MESSAGE : `Workspace could not be restored: ${(e as Error).message}`;
    if (newer) return { state: freshWorkspace(liveStarter(model)), writable: false, newer: true, error };
  }
  // The fallback shows the small authored contour. Saved workspaces and legacy
  // recipe-only drafts still pass through their existing parsers unchanged.
  let state = freshWorkspace(liveStarter(model));
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
