import { expect, test } from "bun:test";
import { attachBrowserHead, type HeadAttachmentPorts, type HeadServices } from "../src/browser-head-attachment";
import { createBrowserViewportDevice } from "../src/browser-viewport-device";
import type { createSceneHost } from "../src/platform/scene/scene-host";
import type { createSurfaceEditor } from "../src/surface-editor";
import { freshWorkspace } from "../src/workspace-state";

// PREV-20: everything wired to a loaded head is released together when a later step fails, so
// "Try again" starts clean: no doubled theme bindings, service attachments, subscriptions,
// camera listeners, surface editors or leftover canvases.

type Listener = () => void;
const noop = () => {};

/** A loaded scene: a canvas in the head host, a camera-controls event target, and a dispose that removes the canvas. */
function fakeScene(host: { canvases: number }, log: string[]) {
  host.canvases++;
  const controls = new Set<Listener>();
  const known: Record<string, unknown> = {
    evidence: { idle: { available: false, error: "No idle in this test." } },
    hair: [], details: {}, piercingStyles: [], idle: undefined,
    eyeShapeOptions: () => ({ choices: [{ index: 0, label: "Base" }] }),
    cameraState: () => ({ position: [0, 1.67, -1], target: [0, 1.67, 0], fov: 30 }),
    controls: {
      addEventListener: (_type: string, listener: Listener) => controls.add(listener),
      removeEventListener: (_type: string, listener: Listener) => controls.delete(listener),
    },
    dispose: () => { host.canvases--; log.push("scene:dispose"); },
    lighting: { setPreset: noop, setCreatorOptions: noop, setBodySex: noop, subscribe: () => noop,
      camera: () => ({ position: [0, 1.62, -1.2], target: [0, 1.62, 0], fov: 15 }),
      status: () => ({ preset: "studio", sex: "female", defaultExposure: 1, lut: { phase: "idle", source: null } }) },
  };
  // Every other scene method is a no-op; `then` stays undefined so the scene isn't mistaken for a promise.
  const scene = new Proxy(known, { get: (target, key) => key in target ? target[key as string] : key === "then" ? undefined : noop });
  return { scene: scene as unknown as Awaited<ReturnType<typeof createSceneHost>>, controls };
}

function harness(plan: { failLoad?: number[]; failPresent?: number[] }) {
  const log: string[] = [];
  const host = { canvases: 0, clientWidth: 600, clientHeight: 400, contains: () => false };
  const scenes: ReturnType<typeof fakeScene>[] = [];
  let loads = 0, presents = 0, persisted = 0;
  const viewport = createBrowserViewportDevice({
    headHost: host as unknown as HTMLElement, uvHost: { clientWidth: 1, clientHeight: 1, contains: () => false } as unknown as HTMLElement,
    queryContext: () => { throw Error("No hit expected"); },
    sceneFactory: (async () => {
      loads++;
      // A failed load releases what it made itself (createScene does), so it leaves no canvas.
      if (plan.failLoad?.includes(loads)) throw Error("The head could not be read.");
      const made = fakeScene(host, log);
      scenes.push(made);
      return made.scene;
    }) as unknown as typeof createSceneHost,
    surfaceFactory: (() => ({ resize: noop, cancelInput: noop, inputCapture: () => false, hitAt: () => undefined,
      setEnabled: noop, dispose: () => log.push("surface:dispose") })) as unknown as typeof createSurfaceEditor,
    window: { addEventListener: noop },
  });
  const preferenceListeners = new Set<Listener>(), schemeListeners = new Set<Listener>();
  const attached: HeadServices = {};
  let connected: unknown;
  const surfaces = new Map<unknown, ReturnType<HeadAttachmentPorts["layeredMakeup"]>>();
  const ports: HeadAttachmentPorts = {
    workspace: freshWorkspace(), viewport,
    // The composition root reads the layered-makeup surface from eye makeup's renderer; here, one per scene.
    layeredMakeup: scene => surfaces.get(scene) ?? surfaces.set(scene, { layers: {}, surface: {}, maxTextureSize: 4096 } as unknown as
      ReturnType<HeadAttachmentPorts["layeredMakeup"]>).get(scene)!,
    preview: {
      connectScene: scene => { connected = scene; return { accepted: true } as ReturnType<HeadAttachmentPorts["preview"]["connectScene"]>; },
      disconnectScene: scene => { if (connected === scene) connected = undefined; },
      presentInitialLayers: () => { presents++; if (plan.failPresent?.includes(presents)) throw Error("A layer could not be shown."); },
    },
    preferences: { snapshot: () => ({ theme: "dark" }), subscribe: listener => { preferenceListeners.add(listener); return () => { preferenceListeners.delete(listener); }; } },
    colourScheme: { matches: true, addEventListener: (_type, listener) => schemeListeners.add(listener), removeEventListener: (_type, listener) => schemeListeners.delete(listener) },
    attach: services => Object.assign(attached, services),
    surface: {} as HeadAttachmentPorts["surface"],
    persist: () => { persisted++; }, changed: noop,
    // The creator catalogue host never answers here: the context stays loading.
    creator: { panel: () => new Promise(() => {}), page: () => new Promise(() => {}), view: () => new Promise(() => {}), preset: () => new Promise(() => {}),
      wait: async () => {} },
  };
  return { log, host, scenes, viewport, ports, attached, preferenceListeners, schemeListeners,
    get connected() { return connected; }, surfaces, get persisted() { return persisted; }, get loads() { return loads; } };
}

test("a head step failing after the scene loaded releases every head connection, and Try again attaches once", async () => {
  const h = harness({ failPresent: [1] });
  await expect(attachBrowserHead(h.ports)).rejects.toThrow("A layer could not be shown.");
  // Nothing of the failed attempt stays connected.
  expect(h.host.canvases).toBe(0);
  expect(h.log).toEqual(["surface:dispose", "scene:dispose"]);
  expect(h.viewport.scene()).toBeUndefined();
  expect(h.viewport.surfaceEditor()).toBeUndefined();
  expect(h.connected).toBeUndefined();
  expect(h.attached).toEqual({ savedV: undefined, preview: undefined, motion: undefined, characterDetails: undefined, characterContext: undefined });
  expect(h.preferenceListeners.size).toBe(0);
  expect(h.schemeListeners.size).toBe(0);
  expect(h.scenes[0]!.controls.size).toBe(0);

  // Try again: exactly one of everything.
  const head = await attachBrowserHead(h.ports);
  expect(h.loads).toBe(2);
  expect(h.host.canvases).toBe(1);
  expect(h.viewport.scene()).toBe(head.scene);
  expect(h.connected).toBe(h.surfaces.get(head.scene));
  expect(h.attached).toEqual({ savedV: head.savedAppearance, preview: head.preview, motion: head.motion, characterDetails: head.characterDetails,
    characterContext: head.characterContext });
  expect(h.preferenceListeners.size).toBe(1);
  expect(h.schemeListeners.size).toBe(1);
  expect(h.scenes[1]!.controls.size).toBe(1);
  const before = h.persisted;
  for (const listener of h.scenes[1]!.controls) listener();
  expect(h.persisted).toBe(before + 1);

  // Unloading (a later reload) releases the head the same way, once.
  head.dispose(); head.dispose();
  expect(h.host.canvases).toBe(0);
  expect(h.log).toEqual(["surface:dispose", "scene:dispose", "surface:dispose", "scene:dispose"]);
  expect(h.preferenceListeners.size).toBe(0);
  expect(h.attached).toEqual({ savedV: undefined, preview: undefined, motion: undefined, characterDetails: undefined, characterContext: undefined });
});

test("a scene that fails to load attaches nothing, and the next load starts clean", async () => {
  const h = harness({ failLoad: [1] });
  await expect(attachBrowserHead(h.ports)).rejects.toThrow("The head could not be read.");
  expect(h.host.canvases).toBe(0);
  expect(h.attached).toEqual({});
  expect(h.preferenceListeners.size).toBe(0);
  const head = await attachBrowserHead(h.ports);
  expect(h.host.canvases).toBe(1);
  expect(h.preferenceListeners.size).toBe(1);
  expect(h.viewport.scene()).toBe(head.scene);
  // Loading again over a loaded head releases the old one first.
  await h.viewport.loadHead();
  expect(h.host.canvases).toBe(1);
  expect(h.log).toEqual(["surface:dispose", "scene:dispose"]);
});

test("releasing a head that a later load replaced leaves the current head loaded (UI-36)", async () => {
  const h = harness({});
  const first = await attachBrowserHead(h.ports);
  // A later load replaces the first head (and releases its scene)…
  const current = await h.viewport.loadHead();
  expect(h.log).toEqual(["surface:dispose", "scene:dispose"]);
  expect(h.host.canvases).toBe(1);
  // …so the first head's release must not unload the head that is now current.
  first.dispose();
  expect(h.viewport.scene()).toBe(current);
  expect(h.host.canvases).toBe(1);
  expect(h.log).toEqual(["surface:dispose", "scene:dispose"]);
  // The current head is still released by its own scene, once.
  h.viewport.unloadHead(first.scene);
  expect(h.viewport.scene()).toBe(current);
  h.viewport.unloadHead(current);
  h.viewport.unloadHead(current);
  expect(h.viewport.scene()).toBeUndefined();
  expect(h.host.canvases).toBe(0);
  expect(h.log).toEqual(["surface:dispose", "scene:dispose", "scene:dispose"]);
});
