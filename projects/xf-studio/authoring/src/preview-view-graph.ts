/**
 * The Studio's view graph over the workspace's preview (research/authoring/view-graph-design.md §3.1, §3.5): the node state the
 * composition gives the platform's graph service (`platform/core/view-graph.ts`), the default one-view graph derived from the
 * workspace's `preview` block, and the mirror back into it.
 *
 * Persistence rule: the main view's nodes are always mirrored into the legacy `preview` fields (camera, lighting, toggles), so a
 * build before the graph reads the main view exactly as before; the graph itself (`WorkspaceState.views`) is written only when it
 * differs from the default one-view graph, so a workspace that never adds a view keeps its bytes. On read, the legacy fields win
 * for the main view's nodes: the main view looks exactly as the `preview` block says (no appearance change).
 */
import { MAIN_VIEW, VIEW_GRAPH_1, type NodeCodec, type ViewGraphData, type ViewGraphRules, type ViewRecord } from "./platform/api/view-graph";
import { parseViewGraph, ViewGraph } from "./platform/core/view-graph";
import type { CameraState, PreviewState } from "./workspace-state";
import { DEFAULT_CREATOR_LIGHTING, LIGHTING_PRESETS, readCreatorLighting, type CreatorLightingOptions, type LightingPreset } from "./creator-lighting";
import { STUDIO_EXPOSURE_RANGE, STUDIO_KEY_ANGLE_RANGE, validStudioLights, type StudioLights } from "./studio-lighting";
import { DEFAULT_SETUP_LIBRARY, legacyStudioStage, migrateLegacyLighting, parseSetupLibrary, rigKindOf, type SetupLibrary } from "./lighting-setups";
import { CAMERA_DISTANCE_RANGE } from "./camera-framing";

/**
 * A character scene's state: the head's eye shape, the V's material studies and body mode (design §3.1), and whether its dangles simulate
 * (`physics`: one setting per scene, so every view of the scene shows the same hair; hair-physics-plan.md §3.6).
 */
export type SceneState = { eyeShape: number; normals: boolean; eyeOwnRoughness?: boolean; uncensored?: boolean; physics?: boolean };
/** An orbit camera's pose in the scene's neutral subject space (absent until one is saved). Aspect belongs to each view. */
export type CameraNodeState = { pose?: CameraState };
/**
 * A light rig's settings (lighting-setups.ts): the setup shown, the person's own setups, and the calibration the built-in Character
 * creator is read with. The node's kind is the display the shown setup draws through (`studio`: ACES; `creator`: the game's grade).
 * `exposure`, `lightAngle` and `studioLights` are the legacy mirror, recomputed from the setups on every edit so builds before setups
 * read a studio stage (`legacyStudioStage`); they are read only from a node stored before setups, which they migrate.
 */
export type LightsState = SetupLibrary & { creatorLighting: CreatorLightingOptions; exposure: number; lightAngle: number; studioLights: StudioLights };
/** The content filter: which character slots show (design §3.1). */
export type DisplayState = { brows: boolean; lashes: boolean; hair: boolean; piercings: boolean; body?: boolean };
/** Each view tool's on/off state, by tool ID (`eye-makeup.surface`). */
export type ToolsState = { on: Record<string, boolean> };

/**
 * The legacy `preview` fields that hold view tools: eye makeup's Surface controls and Plate wireframe (migration debt: the
 * workspace mirror names them until the `preview` block is retired; the tools themselves are eye makeup's contributions).
 */
export const LEGACY_TOOL_FIELDS = { surface: "eye-makeup.surface", wire: "eye-makeup.wire" } as const;
/** The default graph's node IDs (design §3.2's example). */
export const DEFAULT_NODES = { scene: "s1", camera: "c1", lights: "l1", display: "d1", tools: "t1" } as const;

const bool = (value: unknown): value is boolean => typeof value === "boolean";
const optional = <T>(value: unknown, check: (x: unknown) => x is T) => value === undefined || check(value);
/** A finite number within `[min, max]`. */
export const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/**
 * The ranges a stored preview holds (CORE-96): the node codecs below and `parseWorkspace`'s legacy `preview` fields enforce the same
 * ones, so a value one refuses the other refuses too. The eye shape is rounded to its index; `EYE_SHAPE_RANGE.max` is the female
 * creator's 22 choices, the most any head offers.
 */
export const EYE_SHAPE_RANGE = Object.freeze({ min: 0, max: 21 });
export const CAMERA_FOV_RANGE = Object.freeze({ min: 10, max: 90 });
/** How far a stored camera's position and target may lie from the subject's origin, in metres. */
export const CAMERA_COORDINATE_LIMIT = 100;
/**
 * A camera pose a workspace may hold: finite vectors within bounds, a lens in range, and an orbit distance within the range any view's
 * scene-derived limits lie in (camera-framing.ts), so a pose saved at the farthest reach of a narrow lens, a tall pane or the whole
 * body stays valid.
 */
export function validCameraPose(value: unknown): value is CameraState {
  const c = value as Partial<CameraState> | undefined;
  const vector = (x: unknown): x is number[] => Array.isArray(x) && x.length === 3 &&
    x.every(n => inRange(n, -CAMERA_COORDINATE_LIMIT, CAMERA_COORDINATE_LIMIT));
  if (!c || typeof c !== "object" || !vector(c.position) || !vector(c.target) || !inRange(c.fov, CAMERA_FOV_RANGE.min, CAMERA_FOV_RANGE.max)) return false;
  const target = c.target;
  const distance = Math.hypot(...c.position.map((n, i) => n - target[i]!));
  return distance >= CAMERA_DISTANCE_RANGE.min - .001 && distance <= CAMERA_DISTANCE_RANGE.max + .001;
}

const scene: NodeCodec = { kinds: ["character"], parse: state => {
  const s = state as Partial<SceneState>;
  if (!inRange(s.eyeShape, EYE_SHAPE_RANGE.min, EYE_SHAPE_RANGE.max) || !bool(s.normals) || !optional(s.eyeOwnRoughness, bool) ||
    !optional(s.uncensored, bool) || !optional(s.physics, bool)) return;
  return { eyeShape: Math.round(s.eyeShape), normals: s.normals, ...(s.eyeOwnRoughness === undefined ? {} : { eyeOwnRoughness: s.eyeOwnRoughness }),
    ...(s.uncensored === undefined ? {} : { uncensored: s.uncensored }), ...(s.physics === undefined ? {} : { physics: s.physics }) };
} };
const camera: NodeCodec = { kinds: ["orbit"], parse: state => {
  if (state.pose !== undefined && !validCameraPose(state.pose)) return;
  return state.pose === undefined ? {} : { pose: { position: [...(state.pose as CameraState).position], target: [...(state.pose as CameraState).target],
    fov: (state.pose as CameraState).fov } };
} };
const lights: NodeCodec = { kinds: [...LIGHTING_PRESETS], parse: (state, kind) => {
  const s = state as Partial<LightsState>;
  const creatorLighting = readCreatorLighting(s.creatorLighting);
  if (!creatorLighting) return;
  let library: SetupLibrary | undefined;
  if (s.setup !== undefined || s.setups !== undefined) library = parseSetupLibrary({ setup: s.setup, setups: s.setups });
  else {
    // A node stored before setups: its preset and studio stage migrate (a stage no built-in matches becomes one user setup).
    if (!inRange(s.exposure, STUDIO_EXPOSURE_RANGE.min, STUDIO_EXPOSURE_RANGE.max) ||
      !inRange(s.lightAngle, STUDIO_KEY_ANGLE_RANGE.min, STUDIO_KEY_ANGLE_RANGE.max) || !validStudioLights(s.studioLights)) return;
    library = migrateLegacyLighting(kind === "creator" ? "creator" : "studio", { lights: s.studioLights, exposure: s.exposure, angle: s.lightAngle });
  }
  // The kind is the shown setup's display: a node whose kind disagrees is damaged.
  return library && rigKindOf(library) === kind ? lightsNodeState(library, creatorLighting) : undefined;
} };
/** A lights node's state for a library and calibration, with the legacy mirror derived from them. */
export function lightsNodeState(library: SetupLibrary, creatorLighting: CreatorLightingOptions): LightsState {
  const stage = legacyStudioStage(library);
  return { setup: library.setup, setups: structuredClone(library.setups) as LightsState["setups"], creatorLighting: { ...creatorLighting },
    exposure: stage.exposure, lightAngle: stage.angle, studioLights: { ...stage.lights } };
}
/**
 * The lights a workspace's `preview` block holds: its setups when it stores them (`lightingSetups`, only while the person has setups of
 * their own), else its legacy preset and studio stage, migrated. Unreadable lighting gives Soft studio.
 */
export function previewLights(preview: PreviewState): LightsState {
  return (lights.parse(storedLights(preview), previewRig(preview)) as LightsState | undefined) ??
    lightsNodeState(DEFAULT_SETUP_LIBRARY, readCreatorLighting(preview.creatorLighting) ?? DEFAULT_CREATOR_LIGHTING);
}
/** The lights fields as the `preview` block stores them (the legacy stage, and the setups when present). */
const storedLights = (preview: PreviewState) => ({ exposure: preview.exposure, lightAngle: preview.lightAngle, studioLights: { ...preview.studioLights },
  creatorLighting: { ...preview.creatorLighting },
  ...(preview.lightingSetups ? structuredClone({ setup: preview.lightingSetups.setup, setups: preview.lightingSetups.setups }) : {}) });
/** Stored setups decide the rig (a build before setups only ever writes `lightingPreset` without them). */
const previewRig = (preview: PreviewState): LightingPreset => preview.lightingSetups ? rigKindOf(preview.lightingSetups) : preview.lightingPreset;
const display: NodeCodec = { parse: state => {
  const s = state as Partial<DisplayState>;
  if (!bool(s.brows) || !bool(s.lashes) || !bool(s.hair) || !bool(s.piercings) || !optional(s.body, bool)) return;
  return { brows: s.brows, lashes: s.lashes, hair: s.hair, piercings: s.piercings, ...(s.body === undefined ? {} : { body: s.body }) };
} };
const tools: NodeCodec = { parse: state => {
  const on = state.on as Record<string, unknown> | undefined;
  if (!on || typeof on !== "object" || Array.isArray(on) || Object.keys(on).length > 64) return;
  const entries = Object.entries(on);
  if (!entries.every(([id, value]) => /^[a-z0-9][a-z0-9.-]{0,63}$/.test(id) && bool(value))) return;
  return { on: Object.fromEntries(entries) };
} };

/** The platform's rules for the Studio's graph: the codecs above, and a character scene seen by an orbit camera under either rig. */
export const STUDIO_VIEW_GRAPH_RULES: ViewGraphRules = Object.freeze({
  codecs: { scene, camera, lights, display, tools },
  scenes: [{ kind: "character", cameras: ["orbit"], rigs: [...LIGHTING_PRESETS] }],
});

/** The main view's node states as the legacy `preview` block holds them. */
function mainNodes(preview: PreviewState) {
  const lights = previewLights(preview);
  return {
    scene: { eyeShape: preview.eyeShape, normals: preview.normals, ...(preview.eyeOwnRoughness === undefined ? {} : { eyeOwnRoughness: preview.eyeOwnRoughness }),
      ...(preview.uncensored === undefined ? {} : { uncensored: preview.uncensored }),
      ...(preview.physics === undefined ? {} : { physics: preview.physics }) } satisfies SceneState,
    camera: (preview.camera ? { pose: structuredClone(preview.camera) } : {}) satisfies CameraNodeState,
    // Read through the codec, so the node holds the setups (a workspace saved before them migrates here).
    lights: lights satisfies LightsState,
    display: { brows: preview.brows, lashes: preview.lashes, hair: preview.hair, piercings: preview.piercings,
      ...(preview.body === undefined ? {} : { body: preview.body }) } satisfies DisplayState,
    tools: { on: { [LEGACY_TOOL_FIELDS.surface]: preview.surface, [LEGACY_TOOL_FIELDS.wire]: preview.wire } } satisfies ToolsState,
    rig: rigKindOf(lights),
  };
}

/** The default graph: one view (`main`) over the workspace's preview (design §3.5). */
export function defaultViewGraph(preview: PreviewState): ViewGraphData {
  const nodes = mainNodes(preview);
  return { schema: VIEW_GRAPH_1, views: [{ id: MAIN_VIEW, kind: "3d", ...DEFAULT_NODES }],
    scenes: [{ id: DEFAULT_NODES.scene, kind: "character", ...nodes.scene }], cameras: [{ id: DEFAULT_NODES.camera, kind: "orbit", ...nodes.camera }],
    lights: [{ id: DEFAULT_NODES.lights, kind: nodes.rig, ...nodes.lights }], display: [{ id: DEFAULT_NODES.display, ...nodes.display }],
    tools: [{ id: DEFAULT_NODES.tools, ...nodes.tools }], focused: MAIN_VIEW };
}

/**
 * The graph a workspace holds: its stored `views` when valid (with the main view's nodes taken from the legacy `preview` fields,
 * which always mirror them), else the default one-view graph.
 */
export function workspaceViewGraph(preview: PreviewState, stored: ViewGraphData | undefined): ViewGraphData {
  const parsed = stored && parseViewGraph(stored, STUDIO_VIEW_GRAPH_RULES);
  if (!parsed) return defaultViewGraph(preview);
  const main = parsed.views.find(view => view.id === MAIN_VIEW) as ViewRecord, nodes = mainNodes(preview);
  // The legacy fields hold only Surface controls and Plate wireframe: every other tool the main view has stays as stored (CORE-97).
  const storedTools = parsed.tools.find(node => node.id === main.tools)?.on as ToolsState["on"] | undefined;
  const tools: ToolsState = { on: { ...storedTools, ...nodes.tools.on } };
  const overlay = <T extends { id: string; kind?: string }>(list: readonly T[], id: string, state: object, kind?: string) =>
    list.map(node => node.id === id ? { id, ...(node.kind === undefined ? {} : { kind: kind ?? node.kind }), ...state } : node);
  return parseViewGraph({ ...parsed, scenes: overlay(parsed.scenes, main.scene, nodes.scene),
    cameras: overlay(parsed.cameras, main.camera, nodes.camera), lights: overlay(parsed.lights, main.lights, nodes.lights, nodes.rig),
    display: overlay(parsed.display, main.display, nodes.display), tools: overlay(parsed.tools, main.tools, tools) },
  STUDIO_VIEW_GRAPH_RULES) ?? defaultViewGraph(preview);
}

/** A graph service for a workspace's preview (and its stored views, if any). */
export function createStudioViewGraph(preview: PreviewState, stored?: ViewGraphData) {
  return new ViewGraph(workspaceViewGraph(preview, stored), STUDIO_VIEW_GRAPH_RULES);
}

/**
 * Whether a graph is the default one-view graph: its structure is the default one and everything its main view holds is mirrored
 * into `preview`. A main view with a tool state the legacy fields can't hold (any tool but Surface controls and Plate wireframe)
 * is not the default, so the graph is stored and the state survives a save (CORE-97).
 */
export function isDefaultViewGraph(data: ViewGraphData): boolean {
  const [view, ...rest] = data.views;
  if (rest.length || !view || view.kind !== "3d" || view.id !== MAIN_VIEW || view.title !== undefined || data.focused !== MAIN_VIEW ||
    view.scene !== DEFAULT_NODES.scene || view.camera !== DEFAULT_NODES.camera || view.lights !== DEFAULT_NODES.lights ||
    view.display !== DEFAULT_NODES.display || view.tools !== DEFAULT_NODES.tools) return false;
  const mirrored = new Set<string>(Object.values(LEGACY_TOOL_FIELDS));
  const on = data.tools.find(node => node.id === DEFAULT_NODES.tools)?.on as Record<string, unknown> | undefined;
  return !!on && Object.keys(on).every(id => mirrored.has(id));
}

/** What the workspace stores for a graph: nothing for the default graph (its state is the mirrored `preview`), else the graph. */
export function storedViewGraph(graph: ViewGraph): ViewGraphData | undefined {
  const data = graph.data();
  return isDefaultViewGraph(data) ? undefined : data;
}

/**
 * A view's node states as the legacy `preview` fields (for the workspace mirror and `PreviewActions.snapshot`). With `active`, the
 * tools are what the device applies: the stored choices without the tools the presentation withdrew (UI-102).
 */
export function previewFields(graph: ViewGraph, view = MAIN_VIEW, options: { active?: boolean } = {}) {
  const scene = graph.state<SceneState>(view, "scene"), display = graph.state<DisplayState>(view, "display");
  const lights = graph.state<LightsState>(view, "lights");
  const tools = options.active ? graph.activeTools(view) : graph.state<ToolsState>(view, "tools").on;
  return { scene, display, lights, rig: graph.kind(view, "lights") as LightingPreset, camera: graph.state<CameraNodeState>(view, "camera").pose,
    surface: tools[LEGACY_TOOL_FIELDS.surface] === true, wire: tools[LEGACY_TOOL_FIELDS.wire] === true, tools };
}

/**
 * A view's node states in the workspace's `preview` shape, in the field order the workspace has always written (the legacy mirror):
 * what `PreviewActions.snapshot` publishes and what a head restores from. `camera` is the camera node's pose, when it has one.
 */
export function previewMirror(graph: ViewGraph, view = MAIN_VIEW) {
  const f = previewFields(graph, view);
  return { surface: f.surface, wire: f.wire, brows: f.display.brows, lashes: f.display.lashes, hair: f.display.hair,
    normals: f.scene.normals, ...(f.scene.eyeOwnRoughness === undefined ? {} : { eyeOwnRoughness: f.scene.eyeOwnRoughness }),
    eyeShape: f.scene.eyeShape, piercings: f.display.piercings, ...(f.display.body === undefined ? {} : { body: f.display.body }),
    ...(f.scene.uncensored === undefined ? {} : { uncensored: f.scene.uncensored }),
    ...(f.scene.physics === undefined ? {} : { physics: f.scene.physics }),
    exposure: f.lights.exposure, lightAngle: f.lights.lightAngle, lightingPreset: f.rig, creatorLighting: f.lights.creatorLighting,
    studioLights: f.lights.studioLights,
    // The setups are stored only while the person has their own: otherwise the legacy fields say exactly which built-in shows.
    ...(f.lights.setups.length ? { lightingSetups: { setup: f.lights.setup, setups: f.lights.setups } } : {}),
    ...(f.camera ? { camera: f.camera } : {}) };
}
