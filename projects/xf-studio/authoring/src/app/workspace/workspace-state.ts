import { parseSavedV, type SavedV } from "../../saves/save-reader";
import { liveFeatureStates, starterParts, parseCollectionWorkspace, readCollectionWorkspaceV1, withLiveFeatures,
  writeCollectionWorkspace,
  type CollectionWorkspace, type DocumentModel, type RestoreWarnings } from "./collection-workspace";
import { isNewerData, LOOK_HISTORY_1, LOOK_MEMORY, type LookMemory, type PartEnvelope } from "../../platform/api";
import type { LookHistoryData } from "../../platform/api/history";
import type { DocumentState } from "../authoring/authoring-document";
import { emptyLookHistory } from "../../platform/core/look-history";
import type { NewerPolicy } from "../../platform/core/document";
import type { LiveFeatureState } from "../../platform/core/live-features";
import { defaultUVView, parseUVView, type UVView } from "../../legacy/eye-makeup/uv-view";
import { DEFAULT_PREVIEW_TEXTURE_SIZE, parsePreviewTextureSize, type PreviewTextureSize } from "../../legacy/eye-makeup/preview/preview-quality";
import { defaultUIPreferences, parseUIPreferences, type UIPreferences } from "../ui-preferences";
import { isCreatorName } from "../../character/creator-names";
import { storedPoseOf, validIdleClip } from "../../animation/scene-motion";
import { DEFAULT_IDLE } from "../../animation/idle-catalogue";
import { migrationMarkOf, workspaceProfilesOf, type MigrationMark, type WorkspaceProfiles } from "../profiles/profile-session";
import { storedCharacterOf, type StoredCharacter } from "../../character/character-context-actions";
import { DEFAULT_CREATOR_LIGHTING, DEFAULT_LIGHTING_PRESET, LIGHTING_PRESETS, readCreatorLighting, storedCreatorLighting, type CreatorLightingOptions,
  type LightingPreset } from "../../preview/creator-lighting";
import { DEFAULT_STUDIO_LIGHTS, sameStudioLights, STUDIO_EXPOSURE_RANGE, STUDIO_KEY_ANGLE_RANGE, validStudioLights, type StudioLights } from "../../preview/studio-lighting";
import { parseSetupLibrary, rigKindOf, type SetupLibrary } from "../../preview/lighting-setups";
import type { ViewGraphData } from "../../platform/api/view-graph";
import { parseTransitions, type StoredTransitions } from "../../platform/core/transition-settings";
import { parseViewGraph } from "../../platform/core/view-graph";
import { EYE_SHAPE_RANGE, HAIR_LOOK_RANGE, inRange, recoverScenes, STUDIO_VIEW_GRAPH_RULES, validCameraPose, viewSettingsReset,
  VIEW_SETTINGS_RESET } from "../../preview/preview-view-graph";

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
   * Whether the scene simulates its V's dangles (hair and worn items with physics; `motion.setPhysics`, hair-physics-plan.md §3.6). Absent
   * means off, the default until the in-game calibration: it is written only once the viewer changes it.
   */
  physics?: boolean;
  /**
   * The Rendering options (the Preview quality panel; how the view draws, never the looks or the export): the skin's screen-space scatter
   * (`preview.setSkinScatter`; absent means on), the lights' shadow maps on the V (`preview.setFaceShadows`; absent means on) and the
   * strands' Hair look, 0 Crisp … 1 Game-like (`preview.setHairLook`; absent means Crisp). Each is written only once the viewer changes it.
   */
  skinScatter?: boolean;
  faceShadows?: boolean;
  hairLook?: number;
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
  /**
   * The lighting setup shown and the person's own setups (lighting-setups.ts). Present only while the person has setups of their own:
   * otherwise `lightingPreset` and the studio stage say exactly which built-in shows, and a workspace that never made one keeps its
   * bytes. When present it decides the lighting, and the legacy fields are its approximation for builds before setups.
   */
  lightingSetups?: SetupLibrary;
  /**
   * The legacy motion fields: `blink` and `blinkPlaying` above, the idle's on/off, phase, pause and contributions, `idleClip` and `pose`.
   * The motion lives in the view graph's scene nodes (animation/scene-motion.ts). These are read once, into the main view's scene when its
   * node holds no motion (a workspace saved before the move), and written back exactly as read, so a build before the move opens the
   * motion as it was at the upgrade.
   */
  idle: boolean; idleTime: number; idlePaused: boolean; idleBody: boolean; idleFace: boolean;
  /** Which of the game's preview idles played (idle-catalogue.ts); absent: the default, the creator's close-up. */
  idleClip?: string;
  /** The photo-mode pose V held (pose-library-design.md decision Q9): its TweakDB record and label. */
  pose?: { id: string; label: string };
  /**
   * How a held expression's changes animate (platform/core/transition-settings.ts, `transition.set`): per source, on or off, the
   * duration and the curve. View state of the subject's motion, like the blink; present only while a source differs from the default.
   */
  transitions?: StoredTransitions;
};
export const WORKSPACE_1 = "xfas/workspace-1";
export const WORKSPACE_2 = "xfs/workspace-2";
/**
 * The live workspace: registered parts/editor memory, the look's shared history, feature-wide
 * preferences and view state. The concrete makeup editor's released in-memory projection lives in
 * `makeup-workspace.ts`; it is not required to load or store a workspace.
 */
export type WorkspaceState = {
  schema: typeof WORKSPACE_2;
  /**
   * The live look's shared Undo history, independent of any feature's part shape.
   */
  history: LookHistoryData;
  /** Present (true) only when older Undo entries than the oldest kept one were dropped. */
  historyTrimmed?: boolean;
  uvView: UVView;
  savedV?: SavedV;
  preview: PreviewState;
  /**
   * The view graph (`xfs/view-graph-1`, research/authoring/view-graph-design.md §3.5): present only when it differs from the
   * default one-view graph, so a workspace that never adds a view keeps its bytes. Its main view always mirrors `preview`.
   */
  views?: ViewGraphData;
  library: LibraryState;
  collections?: CollectionWorkspace;
  uiPreferences: UIPreferences;
  /**
   * 3D preview setup preference: whether the preview may start preparing by itself once nothing is
   * missing (off after the person cancelled a run). Absent means on. Kept in the workspace so it
   * follows the verification scope and survives the desktop's changing loopback port. `declined`: the person chose Not now on
   * the setup card, so it stays closed (the head pane keeps the next step) until they ask for it again. Absent means not declined.
   */
  previewSetup?: { autostart: boolean; declined?: true };
  /**
   * Entries of features this build does not register (from a newer build), carried unchanged:
   * the loose look's other parts and memory, and other features' workspace memory.
   */
  otherFeatures?: { parts?: Record<string, PartEnvelope>; memory?: LookMemory; features?: Record<string, unknown> };
  /**
   * All registered features of the live look: their parsed parts and editor memory. A sparse,
   * empty look adds no entries, and no primary feature is required.
   */
  liveFeatures?: Record<string, LiveFeatureState>;
  /** Workspace-wide preferences, parsed by each registered feature's codec; unknown entries are carried. */
  featureMemory?: Record<string, unknown>;
  /** Present when the selected look is locked (it holds a newer build's data): why, in plain words. Never stored. */
  liveLocked?: string;
  /**
   * The profiles migration's mark (profiles design §8 step 1) and the profile sessions it built (§1.1, `app/profiles/profile-session.ts`).
   * Kept as stored; an older build drops both when it saves, so the next upgrade migrates again (§2.4).
   */
  migration?: MigrationMark;
  profiles?: WorkspaceProfiles;
};
/**
 * The stored `xfs/workspace-2` document. Editor memory is per feature: `look` is the editor
 * when no collection draft owns it (absent when `collections` is present, whose selected look
 * restores the editor), `features` is each feature's workspace-wide memory, and each collection
 * look's memory is kept by feature beside it. View state (camera, UV view, preferences) is as in workspace-1.
 */
export type StoredWorkspace = Omit<WorkspaceState, "schema" | "history" | "historyTrimmed" | "collections" | "otherFeatures" | "preview" |
  "liveFeatures" | "liveLocked" | "featureMemory"> & {
  schema: typeof WORKSPACE_2;
  /** The preview state; `studioLights` only when it differs from the original rig. */
  preview: Omit<PreviewState, "studioLights"> & { studioLights?: StudioLights };
  look?: { parts: Record<string, PartEnvelope>; memory: Record<string, unknown> };
  features: Record<string, unknown>;
  collections?: ReturnType<typeof writeCollectionWorkspace>;
};
export function freshWorkspace(document: DocumentState = {}): WorkspaceState {
  return {
    schema: WORKSPACE_2, history: document.history ?? emptyLookHistory(),
    ...(document.features && Object.keys(document.features).length ? { liveFeatures: document.features } : {}),
    uvView: defaultUVView(),
    preview: { textureSize: DEFAULT_PREVIEW_TEXTURE_SIZE, eyeShape: 9, surface: true, wire: false, brows: true, lashes: true, hair: true,
      piercings: true, piercingStyle: "", piercingDefinition: "",
      normals: true, eyeOptics: false, exposure: 1.2, lightAngle: 329, blink: 0, blinkPlaying: false,
      lightingPreset: DEFAULT_LIGHTING_PRESET, creatorLighting: { ...DEFAULT_CREATOR_LIGHTING },
      studioLights: { ...DEFAULT_STUDIO_LIGHTS }, idle: false, idleTime: 0,
      idlePaused: false, idleBody: true, idleFace: true },
    library: { selected: "", name: "Preset 1" },
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
    if (typeof p.physics === "boolean") state.preview.physics = p.physics;
    const transitions = parseTransitions((p as { transitions?: unknown }).transitions);
    if (transitions) state.preview.transitions = transitions;
    if (typeof p.skinScatter === "boolean") state.preview.skinScatter = p.skinScatter;
    if (typeof p.faceShadows === "boolean") state.preview.faceShadows = p.faceShadows;
    if (inRange(p.hairLook, HAIR_LOOK_RANGE.min, HAIR_LOOK_RANGE.max)) state.preview.hairLook = p.hairLook;
    // The legacy motion fields (read once into the main scene's node while it holds none: animation/scene-motion.ts), by the node's rules.
    if (validIdleClip(p.idleClip) && p.idleClip !== DEFAULT_IDLE) state.preview.idleClip = p.idleClip;
    const pose = storedPoseOf(p.pose);
    if (pose) state.preview.pose = pose;
    // The retired tried piercing style (the shared creator name rule): written back unchanged, and migrated by the character context.
    if (isCreatorName(p.piercingStyle, true) && isCreatorName(p.piercingDefinition, true)) {
      state.preview.piercingStyle = p.piercingStyle; state.preview.piercingDefinition = p.piercingDefinition;
    }
    // The character context: the V's source and the choices set on it, validated; anything unreadable is dropped.
    const character = storedCharacterOf((p as { character?: unknown }).character);
    if (character) state.preview.character = character;
    // The same ranges as the view graph's node codecs (CORE-96).
    for (const [key, min, max] of [["eyeShape", EYE_SHAPE_RANGE.min, EYE_SHAPE_RANGE.max], ["exposure", STUDIO_EXPOSURE_RANGE.min, STUDIO_EXPOSURE_RANGE.max],
      ["lightAngle", STUDIO_KEY_ANGLE_RANGE.min, STUDIO_KEY_ANGLE_RANGE.max],
      ["blink", 0, 1], ["idleTime", 0, Number.MAX_SAFE_INTEGER]] as const)
      if (finite(p[key], min, max)) state.preview[key] = p[key];
    state.preview.eyeShape = Math.round(state.preview.eyeShape);
    if (LIGHTING_PRESETS.includes(p.lightingPreset)) state.preview.lightingPreset = p.lightingPreset;
    // Options saved before the shadow switch read with shadows on.
    const creatorLighting = readCreatorLighting(p.creatorLighting);
    if (creatorLighting) state.preview.creatorLighting = creatorLighting;
    // All or nothing: a damaged or partial rig falls back to the original one.
    const lights = (p as { studioLights?: unknown }).studioLights;
    if (validStudioLights(lights)) state.preview.studioLights = { environment: lights.environment, key: lights.key,
      elevation: lights.elevation, fill: lights.fill, rim: lights.rim, neutral: lights.neutral };
    // The person's own setups (a damaged one is dropped alone, PREV-161); they decide the preset (the legacy fields only approximate them for older builds).
    const setups = parseSetupLibrary((p as { lightingSetups?: unknown }).lightingSetups);
    if (setups?.setups.length) { state.preview.lightingSetups = setups; state.preview.lightingPreset = rigKindOf(setups); }
    if (state.preview.idle) { state.preview.blinkPlaying = false; state.preview.blink = 0; }
    else state.preview.idlePaused = false;
    if (validCameraPose(p.camera)) state.preview.camera = structuredClone(p.camera);
  }
  // The profiles migration's mark and sessions (profiles design §8): kept when they read, else left for the migration to make again.
  // A scene's damaged optional setting is recovered alone, never costing the graph, and the restore says which settings were reset
  // (`recoverScenes`): the session's scenes are what the Studio shows.
  const report = (settings: readonly string[]) => warnings?.push(viewSettingsReset(settings));
  const mark = migrationMarkOf(v.migration), profiles = workspaceProfilesOf(v.profiles);
  if (mark) state.migration = mark;
  if (profiles) state.profiles = { ...profiles, sessions: Object.fromEntries(Object.entries(profiles.sessions).map(([id, session]) =>
    [id, { ...session, views: recoverScenes(session.views as unknown as ViewGraphData, report) as unknown as typeof session.views }])) };
  // The legacy graph (frozen since phase 1: written back as read): a damaged one is left out, and the default graph over `preview` stands in.
  // It is what the Studio shows only until the migration has made a session, so only then does a reset setting in it get a note.
  const shown = !Object.keys(state.profiles?.sessions ?? {}).length;
  const views = v.views && typeof v.views === "object"
    ? parseViewGraph(recoverScenes(v.views as ViewGraphData, shown ? report : undefined), STUDIO_VIEW_GRAPH_RULES) : undefined;
  if (views) state.views = views;
  if (v.previewSetup && typeof v.previewSetup === "object" && typeof v.previewSetup.autostart === "boolean")
    state.previewSetup = { autostart: v.previewSetup.autostart, ...(v.previewSetup.declined === true ? { declined: true as const } : {}) };
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
    const memory = preset ? state.collections.memory[preset.id] : undefined;
    state.history = structuredClone(model.parts.lookHistory(memory));
    const features = liveFeatureStates(preset, memory, model);
    if (features) state.liveFeatures = features; else delete state.liveFeatures;
    if (preset?.locked) state.liveLocked = preset.locked; else delete state.liveLocked;
    if (state.history.trimmed) state.historyTrimmed = true; else delete state.historyTrimmed;
  }
  return state;
}

/** Released workspace-1 input, read by the feature that claims its legacy part format. */
function readEditorV1(v: Record<string, unknown>, model: DocumentModel): WorkspaceState {
  const registry = model.parts, legacy = registry.legacyFeature();
  if (!legacy) throw Error("This version of XF Studio cannot read xfas/workspace-1 editors.");
  const module = registry.feature(legacy)!, schema = module.part.legacy!.schema;
  const part = module.part.parse({ schema, body: v.recipe }), parts = { [legacy]: registry.envelope(legacy, part) };
  const memory = registry.readFeatureMemory(legacy, { active: v.active, selected: v.selected, fieldSelection: v.fieldSelection },
    schema, v.history, v.historyTrimmed === true, { parts });
  const state = freshWorkspace({ features: liveFeatureStates({ parts }, memory, model), history: registry.lookHistory(memory) });
  const wide = registry.readFeatureWide({ [legacy]: { choices: v.glitterChoices } });
  if (Object.keys(wide).length) state.featureMemory = wide;
  if (state.history.trimmed) state.historyTrimmed = true;
  return state;
}

/** Workspace-2's loose look and every feature's workspace-wide preferences. */
function readEditorV2(v: StoredWorkspace, model: DocumentModel, newer: NewerPolicy): WorkspaceState {
  const registry = model.parts, look = v.look && typeof v.look === "object" ? v.look : undefined;
  const parts: Record<string, PartEnvelope> = {};
  if (look?.parts && typeof look.parts === "object")
    for (const [feature, part] of Object.entries(look.parts)) parts[feature] = registry.readPart(feature, part);
  const memory = registry.readMemory(look?.memory, { parts }, newer);
  const state = freshWorkspace({ features: liveFeatureStates({ parts }, memory, model), history: registry.lookHistory(memory) });
  if (state.history.trimmed) state.historyTrimmed = true;
  const features = registry.readFeatureWide(v.features);
  if (Object.keys(features).length) state.featureMemory = features;
  // Registered state belongs to live documents; unknown entries stay verbatim beside it.
  for (const feature of registry.features()) { delete parts[feature]; delete memory[feature]; }
  delete memory[LOOK_MEMORY];
  const other = { ...(Object.keys(parts).length ? { parts } : {}), ...(Object.keys(memory).length ? { memory } : {}) };
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
  const registry = model.parts;
  const { schema: _schema, history, historyTrimmed, collections, otherFeatures, liveFeatures, featureMemory, liveLocked: _locked, ...view } = state;
  const features = registry.writeFeatureWide({ ...otherFeatures?.features, ...featureMemory });
  const data = historyTrimmed && !history.trimmed ? { ...history, trimmed: true as const } : history;
  const loose = collections ? undefined : withLiveFeatures({ id: "", name: "", revision: 1, parts: { ...otherFeatures?.parts } },
    registry.withLookHistory(otherFeatures?.memory ?? {}, data), liveFeatures, model);
  const look = loose && {
    parts: registry.minimalLook({ id: "", name: "", revision: 1, parts: loose.parts }, false).parts,
    memory: registry.writeMemory(loose.memory, options) };
  // The studio rig is stored only when adjusted: workspaces that never touch it keep their bytes (studio-lighting.ts).
  // The creator calibration is stored as the untouched token at its defaults, and its shadow switch only when off (creator-lighting.ts).
  const { studioLights, ...preview } = { ...view.preview, creatorLighting: storedCreatorLighting(view.preview.creatorLighting) as CreatorLightingOptions };
  const storedPreview = sameStudioLights(studioLights, DEFAULT_STUDIO_LIGHTS) ? preview : { ...preview, studioLights };
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
const startingWorkspace = (model: DocumentModel) => {
  const features = liveFeatureStates({ parts: starterParts(model) }, undefined, model);
  return freshWorkspace({ features });
};

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
    if (newer) return { state: startingWorkspace(model), writable: false, newer: true, error };
  }
  // The fallback shows the small authored contour. Saved workspaces and legacy
  // recipe-only drafts still pass through their existing parsers unchanged.
  let state = startingWorkspace(model);
  try {
    const legacy = storage.getItem(keys.legacy);
    if (legacy !== null) {
      const feature = model.parts.legacyFeature();
      if (!feature) throw Error("This version of XF Studio cannot read the saved legacy draft.");
      const module = model.parts.feature(feature)!, part = module.part.parse({ schema: module.part.legacy!.schema, body: JSON.parse(legacy) });
      state = freshWorkspace({ features: { [feature]: { part, editor: module.editor.parse(undefined, part) } } });
    }
  } catch (e) { error ??= `Saved draft could not be restored: ${(e as Error).message}`; }
  return { state, writable: !error, error };
}

/** The restore's one notice: the drafts and presets dropped (counted when several), then each 3D view's reset settings, once each. */
function restoreWarning(warnings: RestoreWarnings) {
  const views = [...new Set(warnings.filter(line => line.startsWith(VIEW_SETTINGS_RESET)))], drafts = warnings.filter(line => !line.startsWith(VIEW_SETTINGS_RESET));
  const dropped = drafts.length === 1 ? drafts[0] : drafts.length ?
    `${drafts.length} damaged recovery drafts or removed presets could not be restored and were dropped; your current draft was restored.` : undefined;
  return [...(dropped ? [dropped] : []), ...views].join(" ");
}
