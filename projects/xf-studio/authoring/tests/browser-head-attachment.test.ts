import { layeredPreviewWiring, type LayeredSurfaceWiring } from "../src/preview/browser/layered-preview-wiring";
import { expect, spyOn, test } from "bun:test";
import { CharacterDetailActions } from "../src/character/character-detail-actions";
import { buildBrowserHead, createHeadDetailRequester, startHeadDetails } from "../src/preview/browser/browser-head-attachment";
import { DEFAULT_CHARACTER } from "../src/character/character-detail-request";
import { CHARACTER_DETAIL_SCHEMA } from "../src/character/render-detail";
import * as detailDevice from "../src/character/browser/browser-character-detail-device";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import type { CameraState } from "../src/app/workspace/makeup-workspace";
import { contextOf, harness } from "./fixtures/fake-heads";
import * as THREE from "three";
import { AuthoringDocument } from "./fixtures/makeup-document";
import { createBrowserPreviewDevice } from "../src/legacy/eye-makeup/browser/browser-preview-device";
import type { RasterPort } from "../src/legacy/eye-makeup/browser/raster-client";
import type { LayeredMakeupSurface } from "../src/engines/layered-makeup/render/makeup-stack";
import { createMakeupStack, EYE_RASTER_REGION, freshWorkspace } from "./fixtures/eye-region";

// PREV-20: everything wired to a head is released together when a later step fails, so "Try again" starts clean: no doubled theme
// bindings, service attachments, subscriptions, camera listeners, surface editors or leftover canvases.

const nothingAttached = { savedV: undefined, preview: undefined, motion: undefined, characterDetails: undefined };
const detailTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("requester acquisition revokes its previous lease synchronously; releasing an old lease cannot revoke the new one", () => {
  const owner = createHeadDetailRequester(), first = owner.acquire();
  let stopped = false;
  first.signal.addEventListener("abort", () => { stopped = true; });
  const second = owner.acquire();
  expect(stopped).toBe(true); expect(first.signal.aborted).toBe(true); expect(second.id).toBe(first.id);
  first.release(); expect(second.signal.aborted).toBe(false);
  const concurrent = createHeadDetailRequester().acquire();
  expect(concurrent.id).not.toBe(second.id);
  second.release(); concurrent.release();
});

test("reusing an incoming requester disposes its old service and preload before the new service can send", async () => {
  const owner = createHeadDetailRequester(), signals: AbortSignal[] = [];
  let preloadSignal: AbortSignal | undefined;
  const port = spyOn(detailDevice, "createBrowserCharacterDetailDevice").mockImplementation(() => ({
    request: async (_request, signal) => {
      if (signals.length) { expect(signals[0]!.aborted).toBe(true); expect(preloadSignal?.aborted).toBe(true); }
      signals.push(signal);
      return { key: "ready", phase: "ready", message: "", progress: null, record: "prepared.json" };
    },
    poll: async () => { throw Error("No polling needed."); }, clear() {}, wait: async () => {}, show: async () => ({ slots: [] }),
    preload: async (_request, signal) => {
      preloadSignal = signal;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  }));
  const old = startHeadDetails(DEFAULT_CHARACTER, undefined, owner, false), outer = new AbortController();
  let next: ReturnType<typeof startHeadDetails> | undefined;
  try {
    await old.initial!.promise;
    const preload = old.actions.preload({ ...DEFAULT_CHARACTER, body: false }, outer.signal);
    expect(preloadSignal?.aborted).toBe(false);
    next = startHeadDetails(DEFAULT_CHARACTER, undefined, owner, false);
    await next.initial!.promise; await preload;
    expect(outer.signal.aborted).toBe(false);
    const count = signals.length;
    await old.actions.setCharacter({ ...DEFAULT_CHARACTER, body: false });
    expect(signals).toHaveLength(count);
    old.dispose(); expect(signals[1]!.aborted).toBe(false);
  } finally { next?.dispose(); old.dispose(); outer.abort(); port.mockRestore(); }
});

test("aborting an owned preload clears its polling timer before release finishes", async () => {
  const originalSet = setTimeout, originalClear = clearTimeout;
  const timers: ReturnType<typeof setTimeout>[] = [], live = new Set<unknown>();
  const set = spyOn(globalThis, "setTimeout").mockImplementation(Object.assign((...args: Parameters<typeof setTimeout>) => {
    const timer = originalSet(...args); timers.push(timer); live.add(timer); return timer;
  }, originalSet));
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((...args: Parameters<typeof clearTimeout>) => {
    live.delete(args[0]); originalClear(...args);
  });
  const controller = new AbortController();
  let sends = 0;
  const device = detailDevice.createBrowserCharacterDetailDevice({ details: {}, setCharacterDetails() {}, prepareDetails: async () => {} } as never,
    async () => { sends++; return Response.json({ key: "a".repeat(32), phase: "preparing", message: "", progress: null,
      recordSchema: CHARACTER_DETAIL_SCHEMA, record: null }); });
  try {
    const preload = device.preload!(DEFAULT_CHARACTER, controller.signal);
    for (let step = 0; step < 50 && !live.size; step++) await Promise.resolve();
    expect(live.size).toBe(1); expect(sends).toBe(1);
    controller.abort(); await preload;
    expect(live.size).toBe(0); expect(sends).toBe(1);
  } finally { controller.abort(); set.mockRestore(); clear.mockRestore(); for (const timer of timers) originalClear(timer); }
});

test("a failed speculative V retries at the validated setup handoff, places once and deduplicates identical requests", async () => {
  let configured = false, requests = 0, placements = 0;
  const port = spyOn(detailDevice, "createBrowserCharacterDetailDevice").mockImplementation(() => ({
    request: async () => { requests++; return { key: "a", phase: configured ? "ready" : "failed", message: "Choose a game folder.",
      progress: null, record: configured ? "prepared.json" : null }; },
    poll: async () => { throw Error("No polling needed."); }, clear() {}, wait: async () => {},
    show: async () => { placements++; return { slots: [] }; },
  }));
  const h = harness();
  const request = h.ports.character.context.detailRequest();
  const primed = startHeadDetails(request);
  let head: Awaited<ReturnType<typeof buildBrowserHead>> | undefined;
  try {
    await detailTurn();
    expect(primed.actions.snapshot().phase).toBe("preparing"); expect(requests).toBe(1);
    configured = true;
    head = await buildBrowserHead({ ...h.ports, initialDetails: primed });
    await head.prepare(new AbortController().signal, () => {});
    expect(head.characterDetails).toBe(primed.actions);
    expect(head.characterDetails.snapshot().phase).toBe("ready");
    expect([requests, placements]).toEqual([2, 1]);
    await head.characterDetails.setCharacter(request!);
    expect([requests, placements]).toEqual([2, 1]);
  } finally { head?.dispose(); primed.dispose(); port.mockRestore(); }
});

test.each(["ready", "failed"] as const)("an initial %s reply after adoption keeps preparation on its transaction and places once", async initial => {
  const old = Promise.withResolvers<import("../src/character/character-detail-actions").HostCharacterState>();
  const fresh = Promise.withResolvers<import("../src/character/character-detail-actions").HostCharacterState>();
  const signals: AbortSignal[] = [], phases: string[] = [];
  let placements = 0, prepared = false;
  const port = spyOn(detailDevice, "createBrowserCharacterDetailDevice").mockImplementation(() => ({
    request: async (_request, signal) => { signals.push(signal); return signals.length === 1 ? old.promise : fresh.promise; },
    poll: async () => { throw Error("No polling needed."); }, clear() {}, wait: async () => {},
    show: async () => { placements++; return { slots: [] }; },
  }));
  const h = harness(), request = h.ports.character.context.detailRequest(), primed = startHeadDetails(request);
  const off = primed.actions.subscribe(() => phases.push(primed.actions.snapshot().phase));
  let head: Awaited<ReturnType<typeof buildBrowserHead>> | undefined;
  try {
    head = await buildBrowserHead({ ...h.ports, initialDetails: primed });
    const preparation = head.prepare(new AbortController().signal, () => {}).then(() => { prepared = true; });
    old.resolve({ key: "old", phase: initial, message: initial === "failed" ? "Choose a game folder." : "", progress: null,
      record: initial === "ready" ? "prepared.json" : null });
    await detailTurn();
    expect(phases).not.toContain("failed");
    if (initial === "failed") {
      expect(signals).toHaveLength(2); expect(signals[1]).toBe(signals[0]);
      expect(prepared).toBe(false); expect(placements).toBe(0);
      fresh.resolve({ key: "fresh", phase: "ready", message: "", progress: null, record: "prepared.json" });
    }
    expect(h.drawn).toHaveLength(0);
    await preparation;
    expect(prepared).toBe(true); expect(placements).toBe(1); expect(signals).toHaveLength(initial === "failed" ? 2 : 1);
    head.show(); expect(h.drawn).toHaveLength(1);
  } finally { off(); head?.dispose(); primed.dispose(); port.mockRestore(); }
});

test("the V is asked for before the core head's motion settles, then preparation joins that request", async () => {
  const entered = Promise.withResolvers<void>(), motion = Promise.withResolvers<void>();
  const h = harness({ build: async () => { entered.resolve(); await motion.promise; } });
  const requests: unknown[] = [];
  const set = spyOn(CharacterDetailActions.prototype, "setCharacter").mockImplementation(async request => { requests.push(request); });
  let head: Awaited<ReturnType<typeof buildBrowserHead>> | undefined;
  try {
    const pending = buildBrowserHead(h.ports);
    await entered.promise;
    expect(requests).toHaveLength(1);
    expect(h.scenes).toHaveLength(0);
    expect(h.drawn).toHaveLength(0);
    motion.resolve(); head = await pending;
    await head.prepare(new AbortController().signal, () => {});
    expect(requests).toHaveLength(1);
    expect(h.drawn).toHaveLength(0);
  } finally { motion.resolve(); head?.dispose(); set.mockRestore(); }
});

test("a head step failing as the head is shown releases every connection it made, and showing again connects once", async () => {
  const h = harness({ failPresent: [1] });
  const head = await buildBrowserHead(h.ports);
  // Built hidden: nothing reaches the application or the canvas yet.
  expect(h.attached).toEqual({});
  expect(h.drawn).toEqual([]);
  expect(() => head.show()).toThrow("A layer could not be shown.");
  expect(head.shown).toBe(false);
  // The head mounts no on-head editor of its own (the scene editors mount the view's: scene-editors.ts).
  expect(h.log).toEqual([]);
  expect(h.viewport.scene()).toBeUndefined();
  expect(h.viewport.surfaceEditor()).toBeUndefined();
  expect(h.connected).toBeUndefined();
  expect(h.attached).toEqual(nothingAttached);
  expect(h.scenes[0]!.controls.size).toBe(0);
  expect(h.host.canvases).toBe(1);

  // Shown again: exactly one of everything.
  head.show();
  expect(head.shown).toBe(true);
  expect(h.viewport.scene()).toBe(head.scene);
  expect(h.connected).toBe(h.surfaces.get(head.scene));
  expect(h.attached).toEqual({ savedV: head.savedAppearance, preview: head.preview, motion: head.motion, characterDetails: head.characterDetails });
  expect(h.preferenceListeners.size).toBe(2); // The stage theme and the research tools preference (PREV-194).
  expect(h.schemeListeners.size).toBe(1);
  expect(h.scenes[0]!.controls.size).toBe(1);
  const before = h.persisted;
  for (const listener of h.scenes[0]!.controls) listener();
  expect(h.persisted).toBe(before + 1);

  // Disposed (twice): hidden first, then everything goes, once.
  head.dispose(); head.dispose();
  expect(h.host.canvases).toBe(0);
  expect(h.log).toEqual(["scene:dispose:1"]);
  expect(h.preferenceListeners.size).toBe(0);
  expect(h.attached).toEqual(nothingAttached);
});

test("a scene that fails to build attaches nothing, an aborted build rejects with the abort, and the next build starts clean", async () => {
  const h = harness({ failBuild: [1] });
  await expect(buildBrowserHead(h.ports)).rejects.toThrow("The head could not be read.");
  expect(h.host.canvases).toBe(0);
  expect(h.attached).toEqual({});
  expect(h.preferenceListeners.size).toBe(0);
  const controller = new AbortController();
  controller.abort();
  await expect(buildBrowserHead(h.ports, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  const head = await buildBrowserHead(h.ports);
  head.show();
  expect(h.host.canvases).toBe(1);
  expect(h.preferenceListeners.size).toBe(2);
  expect(h.viewport.scene()).toBe(head.scene);
  head.dispose();
});

test("every composed layered surface is connected and presented while its head is shown, and all are let go on hide (UI-76)", async () => {
  const h = harness();
  const events: string[] = [];
  const second: LayeredSurfaceWiring = { feature: "cheek-makeup",
    surface: scene => ({ layers: {}, surface: { name: `cheek:${h.scenes.length}` }, maxTextureSize: 4096, scene }) as never,
    preview: {
      connectScene: () => { events.push("cheek:connect"); return { accepted: true } as ReturnType<LayeredSurfaceWiring["preview"]["connectScene"]>; },
      disconnectScene: () => { events.push("cheek:disconnect"); },
      presentInitialLayers: () => { events.push("cheek:present"); },
      fillScene: () => { events.push("cheek:fill"); }, holdsCurrent: () => true, releaseScene: () => { events.push("cheek:release"); },
    } };
  const head = await buildBrowserHead({ ...h.ports, layered: [...h.ports.layered, layeredPreviewWiring(second)] });
  expect(events).toEqual([]);
  head.show();
  expect(h.connected).toBe(h.surfaces.get(head.scene));
  expect(events).toEqual(["cheek:connect", "cheek:present"]);
  head.hide();
  expect(events).toEqual(["cheek:connect", "cheek:present", "cheek:disconnect"]);
  expect(h.connected).toBeUndefined();
  head.dispose();
  // A surface whose renderer isn't composed, and two on-head editors, are refused and leave nothing behind.
  await expect(buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring({ ...second, surface: () => undefined })] })).rejects.toThrow("The cheek-makeup renderer is not composed.");
  await expect(buildBrowserHead({ ...h.ports, layered: [...h.ports.layered, layeredPreviewWiring({ ...second, edited: true })] }))
    .rejects.toThrow("Only one layered surface can carry the on-head editor.");
  expect(h.host.canvases).toBe(0);
  expect(h.viewport.scene()).toBeUndefined();
});

test("the head is its V's body's core: a masculine V's is prepared first (with the build's signal), and one that can't be shows the feminine head", async () => {
  const h = harness();
  const prepared: string[] = [], notices: string[] = [];
  const signals: AbortSignal[] = [];
  const head = await buildBrowserHead({ ...h.ports, character: { body: "male", context: contextOf({ origin: "default", bodyGender: "male", choices: [] }) },
    prepareCore: async (body, signal) => { prepared.push(body); signals.push(signal); }, notice: text => notices.push(text) });
  expect(prepared).toEqual(["male"]);
  expect(signals).toHaveLength(1);
  expect(h.bodies).toEqual(["male"]);
  expect(head.body).toBe("male");
  expect(notices).toEqual([]);
  head.dispose();

  // The masculine head can't be prepared: the feminine head is built with a plain notice; the head is still the masculine V's.
  const fallback = await buildBrowserHead({ ...h.ports, character: { body: "male", context: contextOf({ origin: "default", bodyGender: "male", choices: [] }) },
    prepareCore: async () => { throw Error("A newer game patch."); }, notice: text => notices.push(text) });
  expect(h.bodies).toEqual(["male", "female"]);
  expect(fallback.body).toBe("male");
  expect(notices).toEqual(["The masculine V's head couldn't be prepared from your Cyberpunk 2077 files, so the feminine head is shown. A newer game patch."]);
  fallback.dispose();

  // A preparation stopped by the build's abort (a newer change superseded it) is no fallback: the build rejects with the abort.
  const controller = new AbortController();
  const stopped = buildBrowserHead({ ...h.ports, character: { body: "male", context: contextOf() },
    prepareCore: (_body, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))) }, controller.signal);
  controller.abort();
  await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
  expect(h.bodies).toEqual(["male", "female"]);
});

test("the camera pose round-trips through hide and show: the hidden head writes it to the view's camera node, the head shown next reads it (D3)", async () => {
  const h = harness();
  const a = await buildBrowserHead(h.ports);
  a.show();
  // An orbit moves A's camera without writing the node.
  h.scenes[0]!.orbit(37);
  const node = () => h.graph.state<{ pose?: CameraState }>(MAIN_VIEW, "camera").pose;
  expect(node()?.fov).not.toBe(37);
  const b = await buildBrowserHead(h.ports);
  a.hide();
  expect(node()?.fov).toBe(37);
  b.show();
  expect(h.log).toContain("camera:2:37");
  expect(h.scenes[1]!.scene.cameraState().fov).toBe(37);
  // B orbits, then A is shown again: A takes B's pose.
  h.scenes[1]!.orbit(52);
  b.hide(); a.show();
  expect(h.scenes[0]!.scene.cameraState().fov).toBe(52);
  // Camera jumps and orbits record no View and lighting step.
  expect(h.graph.history().depth).toBe(0);
  a.dispose(); b.dispose();
});

/** A real preview device (a fake worker and canvases that count their paints) and a real makeup stack per scene, as the root wires them. */
function layeredMakeup() {
  const authoring = new AuthoringDocument(freshWorkspace());
  const worker: RasterPort = { onmessage: null, onerror: null, postMessage() {}, terminate() {} };
  const paints = new Map<unknown, number>();
  const createCanvas = (size: number) => {
    const canvas = { width: size, height: size, getContext: () => ({ putImageData: () => paints.set(canvas, (paints.get(canvas) ?? 0) + 1) }) };
    return canvas as unknown as HTMLCanvasElement;
  };
  const device = createBrowserPreviewDevice({ region: EYE_RASTER_REGION, document: authoring, initialSize: 512, makeWorker: () => worker,
    frame: run => run(), refresh: () => {}, refreshSelection: () => {}, refreshQuality: () => {}, drawUV: () => {}, report: () => {}, measurement: () => {},
    createCanvas, createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData });
  let version = 0;
  const publish = () => device.coordinator.publish({ i: 0, size: 512, version: ++version, ms: 1, data: new Uint8ClampedArray(512 * 512 * 4) });
  const stacks = new Map<unknown, ReturnType<typeof createMakeupStack>>();
  const stackOf = (scene: unknown) => {
    let stack = stacks.get(scene);
    if (!stack) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0.3, 0.3, 0.6, 0.3, 0.3, 0.6], 2));
      const anchor = new THREE.SkinnedMesh(geometry), root = new THREE.Group(); root.add(anchor);
      anchor.skeleton = new THREE.Skeleton([new THREE.Bone()], [new THREE.Matrix4()]);
      stack = createMakeupStack(anchor, 4);
      stacks.set(scene, stack);
    }
    return stack;
  };
  // One surface object per scene, as a scene's feature renderer is.
  const surfaces = new Map<unknown, LayeredMakeupSurface>();
  const wiring: LayeredSurfaceWiring = { feature: "eye-makeup", preview: device,
    surface: scene => surfaces.get(scene) ?? surfaces.set(scene, { layers: stackOf(scene), surface: stackOf(scene).plate, maxTextureSize: 4096 }).get(scene)! };
  /** What a frame would compile, composite or upload for a stack: its slots' materials and textures, their versions, and its blend. */
  const state = (scene: unknown) => {
    const stack = stackOf(scene);
    return { materials: [...stack.materials], textures: [...stack.textures], images: stack.textures.map(texture => texture.image),
      versions: [...stack.materials.map(material => material.version), ...stack.textures.map(texture => texture.version)],
      dirty: stack.blendDiagnostics().dirty, visible: stack.plates.map(plate => plate.visible) };
  };
  /** The first layer switched on or off, as an edit publishes it. */
  const setEnabled = (enabled: boolean) => {
    const recipe = authoring.recipe;
    authoring.publishLayer({ ...recipe, layers: recipe.layers.map((layer, i) => i === 0 ? { ...layer, enabled } : layer) }, 0);
  };
  return { device, publish, setEnabled, stackOf, wiring, state, paints, canvas: () => device.canvases[0]! };
}

test("4a-v: a cold V's authored makeup is on its surface before its scene is prepared, and its first shown frame has nothing left to compile, composite or upload", async () => {
  const h = harness(), makeup = layeredMakeup();
  // The authored layer's mask, completed while no head is shown.
  makeup.publish();
  const head = await buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring(makeup.wiring)] });
  let atPrepare: ReturnType<typeof makeup.state> | undefined;
  // The scene's preparation, as scene-host.ts does it for the plate: the feature renderers bring the stack up to date ahead (its composite).
  (head.scene as unknown as { prepare(): Promise<void> }).prepare = async () => {
    makeup.stackOf(head.scene).prepareBlend({} as THREE.WebGLRenderer);
    atPrepare = makeup.state(head.scene);
  };
  await head.prepare(new AbortController().signal, () => {});
  // Preparation saw the authored layers: a slot each, the first's mask the completed 512² canvas, drawn.
  expect(atPrepare?.textures).toHaveLength(makeup.device.canvases.length);
  expect((atPrepare!.images[0] as HTMLCanvasElement).width).toBe(512);
  expect(atPrepare!.visible[0]).toBe(true);
  expect(atPrepare!.dirty).toBe(false);
  head.show();
  // Shown: the same slots, materials, textures and images, no version moved (no program change, no upload), no composite pending.
  const shown = makeup.state(head.scene);
  expect(shown.materials).toEqual(atPrepare!.materials);
  for (const [i, material] of shown.materials.entries()) expect(material).toBe(atPrepare!.materials[i]!);
  for (const [i, texture] of shown.textures.entries()) expect(texture).toBe(atPrepare!.textures[i]!);
  expect(shown.images).toEqual(atPrepare!.images);
  expect(shown.versions).toEqual(atPrepare!.versions);
  expect(shown.dirty).toBe(false);
  // The live binding afterwards: the next completed mask reaches the shown surface (a new upload, a composite).
  makeup.publish();
  expect(makeup.state(head.scene).versions).not.toEqual(atPrepare!.versions);
  expect(makeup.state(head.scene).dirty).toBe(true);
  head.dispose();
});

test("4a-v: a surface filled ahead keeps its snapshot while a newer mask completes, and show brings only that slot up to date", async () => {
  const h = harness(), makeup = layeredMakeup();
  makeup.publish();
  const shownHead = await buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring(makeup.wiring)] });
  shownHead.show();
  const hidden = await buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring(makeup.wiring)] });
  await hidden.prepare(new AbortController().signal, () => {});
  const filled = makeup.state(hidden.scene), heldCanvas = filled.images[0];
  expect(heldCanvas).toBe(makeup.canvas());
  const paints = makeup.paints.get(heldCanvas) ?? 0;
  // A mask completes while the hidden head holds the canvas: it is painted on a new canvas, never over the held one.
  makeup.publish();
  expect(makeup.canvas()).not.toBe(heldCanvas);
  expect(makeup.paints.get(heldCanvas) ?? 0).toBe(paints);
  expect(makeup.state(hidden.scene).images[0]).toBe(heldCanvas);
  // The shown head follows it live.
  expect(makeup.state(shownHead.scene).images[0]).toBe(makeup.canvas());
  // Shown: the held slot takes the new mask (same slot, material and texture; the texture is uploaded again), nothing is rebuilt.
  shownHead.hide(); hidden.show();
  const after = makeup.state(hidden.scene);
  expect(after.materials[0]).toBe(filled.materials[0]!);
  expect(after.textures[0]).toBe(filled.textures[0]!);
  expect(after.images[0]).toBe(makeup.canvas());
  // Hidden again, then shown: it kept what it had, so nothing changes.
  hidden.hide();
  const kept = makeup.state(hidden.scene);
  shownHead.show(); shownHead.hide(); hidden.show();
  expect(makeup.state(hidden.scene).versions).toEqual(kept.versions);
  shownHead.dispose(); hidden.dispose();
});

test("4a final review: a warm head prepared before a layer was enabled is not prepared any more; prepared again, its show brings nothing new", async () => {
  const h = harness(), makeup = layeredMakeup(), signal = new AbortController().signal;
  // A is prepared and shown with its one layer off (no makeup), then B is shown and A goes warm.
  makeup.setEnabled(false);
  const a = await buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring(makeup.wiring)] });
  await a.prepare(signal, () => {});
  a.show();
  const b = await buildBrowserHead({ ...h.ports, layered: [layeredPreviewWiring(makeup.wiring)] });
  await b.prepare(signal, () => {});
  a.hide(); b.show();
  expect(a.prepared()).toBe(true);
  expect(makeup.state(a.scene).visible[0]).toBe(false);
  // The layer is enabled while B is shown (and its mask completes): A's surface holds the makeup as it was, so A is no longer prepared.
  makeup.setEnabled(true);
  makeup.publish();
  expect(b.prepared()).toBe(true);
  expect(a.prepared()).toBe(false);
  // Prepared again (as the runtime owner does before showing a warm head that isn't prepared): it holds the layer, drawn, before its show.
  await a.prepare(signal, () => {});
  expect(a.prepared()).toBe(true);
  const filled = makeup.state(a.scene);
  expect(filled.visible[0]).toBe(true);
  // Shown: the same slots, materials, textures and images, no version moved (no program change, no upload).
  b.hide(); a.show();
  const shown = makeup.state(a.scene);
  expect(shown.materials).toEqual(filled.materials);
  expect(shown.images).toEqual(filled.images);
  expect(shown.versions).toEqual(filled.versions);
  // A layer edited back while A is shown leaves B (warm, holding the layer on) stale in turn.
  makeup.setEnabled(false);
  expect(a.prepared()).toBe(true);
  expect(b.prepared()).toBe(false);
  a.dispose(); b.dispose();
});
