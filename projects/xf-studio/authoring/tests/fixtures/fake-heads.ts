import { layeredPreviewWiring, type LayeredSurfaceWiring } from "../../src/preview/browser/layered-preview-wiring";
import { createLayeredEditorAdapters } from "../../src/preview/browser/layered-editor-adapters";
/**
 * Scene runtime heads over fake scenes (tests/browser-head-attachment.test.ts, tests/browser-scene-heads.test.ts): the real head
 * attachment and viewport device, with scenes that only record what is asked of them.
 */
import { createBrowserViewportDevice } from "../../src/preview/browser/browser-viewport-device";
import type { HeadAttachmentPorts, HeadServices } from "../../src/preview/browser/browser-head-attachment";
import type { createSceneRuntime } from "../../src/platform/scene/scene-host";
import type { createSurfaceEditor } from "../../src/legacy/eye-makeup/browser/surface-editor";
import { CharacterContextActions } from "../../src/character/character-context-actions";
import type { CharacterHistoryHome } from "../../src/character/character-history";
import { createStudioViewGraph } from "../../src/preview/preview-view-graph";
import type { CameraState } from "../../src/app/workspace/makeup-workspace";
import { freshWorkspace, EYE_REGION } from "./eye-region";

/** The creator catalogue host never answers here: a context stays loading. */
export const creator = { panel: () => new Promise<never>(() => {}), page: () => new Promise<never>(() => {}), view: () => new Promise<never>(() => {}),
  preset: () => new Promise<never>(() => {}), wait: async () => {} };
/** A V's context as its owner makes it (`stored`: the V's stored form); it outlives every head. */
export const contextOf = (stored?: unknown, history?: CharacterHistoryHome) =>
  new CharacterContextActions({ showSave: () => {}, creator, ...(history ? { history } : {}) }, stored ? { stored } : {});

type Listener = () => void;
const noop = () => {};

/** A built scene: a counted resource in the head host, a camera-controls event target and a camera, and a dispose that releases it. */
export function fakeScene(host: { canvases: number }, log: string[], body: "female" | "male" = "female", id = 0) {
  host.canvases++;
  const controls = new Set<Listener>(), unprepared = new Set<Listener>();
  let camera: CameraState = { position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 };
  const known: Record<string, unknown> = {
    body, id, slot: { id, body },
    evidence: { idle: { available: false, error: "No idle in this test." } },
    hair: [], details: {}, piercingStyles: [], idle: undefined,
    eyeShapeOptions: () => ({ choices: [{ index: 0, label: "Base" }] }),
    cameraState: () => structuredClone(camera),
    restoreCamera: (next: CameraState) => { camera = structuredClone(next); log.push(`camera:${id}:${next.fov}`); },
    controls: {
      addEventListener: (_type: string, listener: Listener) => controls.add(listener),
      removeEventListener: (_type: string, listener: Listener) => controls.delete(listener),
    },
    dispose: () => { host.canvases--; log.push(`scene:dispose:${id}`); },
    onUnprepared: (listener: Listener) => { unprepared.add(listener); return () => { unprepared.delete(listener); }; },
    lighting: { setPreset: noop, setCreatorOptions: noop, setBodySex: noop, subscribe: () => noop,
      camera: () => ({ position: [0, 1.62, -1.2], target: [0, 1.62, 0], fov: 15 }),
      status: () => ({ preset: "studio", sex: "female", defaultExposure: 1, lut: { phase: "idle", source: null } }) },
  };
  // Every other scene method is a no-op; `then` stays undefined so the scene isn't mistaken for a promise.
  const scene = new Proxy(known, { get: (target, key) => key in target ? target[key as string] : key === "then" ? undefined : noop });
  return { scene: scene as unknown as Awaited<ReturnType<typeof createSceneRuntime>>, controls, orbit(fov: number) { camera = { ...camera, fov }; },
    /** The scene's own members (a test replaces `prepare` or `prepared` here). */
    known,
    /** The scene says it needs preparing (a lighting setup staged while shown, scene-host.ts `onUnprepared`). */
    unprepare() { for (const listener of [...unprepared]) listener(); } };
}

export function harness(plan: { failBuild?: number[]; failPresent?: number[]; build?: (body: "female" | "male", signal?: AbortSignal) => Promise<void> } = {}) {
  const log: string[] = [];
  const host = { canvases: 0, clientWidth: 600, clientHeight: 400, contains: () => false };
  const scenes: ReturnType<typeof fakeScene>[] = [];
  const bodies: string[] = [], drawn: unknown[] = [];
  let builds = 0, presents = 0, persisted = 0;
  const viewport = createBrowserViewportDevice({
    headHost: host as unknown as HTMLElement,
    queryContext: () => { throw Error("No hit expected"); },
    sceneFactory: (async (_device: unknown, options: { body?: "female" | "male"; signal?: AbortSignal }) => {
      const id = ++builds, body = options.body ?? "female";
      bodies.push(body);
      await plan.build?.(body, options.signal);
      options.signal?.throwIfAborted();
      // A failed build releases what it made itself (createSceneRuntime does), so it leaves no canvas.
      if (plan.failBuild?.includes(id)) throw Error("The head could not be read.");
      const made = fakeScene(host, log, body, id);
      scenes.push(made);
      return made.scene;
    }) as unknown as typeof createSceneRuntime,
    deviceFactory: (() => ({ show: (slot: unknown) => drawn.push(slot) })) as never,
    surface: createLayeredEditorAdapters(EYE_REGION, { surface: (() => ({ resize: noop, cancelInput: () => log.push("surface:cancel"), inputCapture: () => false, hitAt: () => undefined,
      setEnabled: (on: boolean) => log.push(`surface:enabled:${on}`), dispose: () => log.push("surface:dispose") })) as unknown as typeof createSurfaceEditor }).surface,
    window: { addEventListener: noop },
  });
  const preferenceListeners = new Set<Listener>(), schemeListeners = new Set<Listener>();
  const attached: HeadServices = {};
  let connected: unknown;
  type Surface = NonNullable<ReturnType<LayeredSurfaceWiring["surface"]>>;
  const surfaces = new Map<unknown, Surface>();
  const surfaceOf = (scene: unknown) => surfaces.get(scene) ?? surfaces.set(scene, { layers: {}, surface: {}, maxTextureSize: 4096 } as unknown as Surface).get(scene)!;
  const workspace = freshWorkspace(), graph = createStudioViewGraph(workspace.preview);
  const ports: HeadAttachmentPorts = {
    workspace, graph, viewport,
    // The scene editors wire the live feature's layered surface (its renderer's), the on-head editor's; here, one per scene.
    layered: [layeredPreviewWiring({ feature: "eye-makeup", surface: surfaceOf, edited: true, preview: {
      connectScene: scene => { connected = scene; return { accepted: true } as ReturnType<LayeredSurfaceWiring["preview"]["connectScene"]>; },
      disconnectScene: scene => { if (connected === scene) connected = undefined; },
      presentInitialLayers: () => { presents++; if (plan.failPresent?.includes(presents)) throw Error("A layer could not be shown."); },
      fillScene: noop, holdsCurrent: () => true, releaseScene: noop,
    } })],
    preferences: { snapshot: () => ({ theme: "dark" }), subscribe: listener => { preferenceListeners.add(listener); return () => { preferenceListeners.delete(listener); }; } },
    colourScheme: { matches: true, addEventListener: (_type, listener) => schemeListeners.add(listener), removeEventListener: (_type, listener) => schemeListeners.delete(listener) },
    attach: services => Object.assign(attached, services),
    persist: () => { persisted++; }, changed: noop,
    character: { body: "female", context: contextOf() },
  };
  return { log, host, scenes, viewport, ports, attached, preferenceListeners, schemeListeners, bodies, drawn, graph,
    get connected() { return connected; }, surfaces, get persisted() { return persisted; }, get builds() { return builds; } };
}
