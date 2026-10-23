import { expect, test } from "bun:test";
import { buildBrowserHead, type LayeredSurfaceWiring } from "../src/preview/browser/browser-head-attachment";
import { MAIN_VIEW } from "../src/platform/api/view-graph";
import type { CameraState } from "../src/app/workspace/workspace-state";
import { contextOf, harness } from "./fixtures/fake-heads";
import * as THREE from "three";
import { AuthoringDocument } from "../src/app/authoring/authoring-document";
import { createBrowserPreviewDevice } from "../src/legacy/eye-makeup/browser/browser-preview-device";
import type { RasterPort } from "../src/legacy/eye-makeup/browser/raster-client";
import { createMakeupStack, EYE_RASTER_REGION, freshWorkspace } from "./fixtures/eye-region";

// PREV-20: everything wired to a head is released together when a later step fails, so "Try again" starts clean: no doubled theme
// bindings, service attachments, subscriptions, camera listeners, surface editors or leftover canvases.

const nothingAttached = { savedV: undefined, preview: undefined, motion: undefined, characterDetails: undefined };

test("a head step failing as the head is shown releases every connection it made, and showing again connects once", async () => {
  const h = harness({ failPresent: [1] });
  const head = await buildBrowserHead(h.ports);
  // Built hidden: nothing reaches the application or the canvas yet.
  expect(h.attached).toEqual({});
  expect(h.drawn).toEqual([]);
  expect(() => head.show()).toThrow("A layer could not be shown.");
  expect(head.shown).toBe(false);
  expect(h.log).toEqual(["surface:cancel", "surface:dispose"]);
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
  expect(h.log).toEqual(["surface:cancel", "surface:dispose", "surface:cancel", "surface:dispose", "scene:dispose:1"]);
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

test("every composed layered surface is connected and presented while its head is shown, the on-head editor mounts on one, and all are let go on hide (UI-76)", async () => {
  const h = harness();
  const events: string[] = [];
  const second: LayeredSurfaceWiring = { feature: "cheek-makeup",
    surface: scene => ({ layers: {}, surface: { name: `cheek:${h.scenes.length}` }, maxTextureSize: 4096, scene }) as never,
    preview: {
      connectScene: () => { events.push("cheek:connect"); return { accepted: true } as ReturnType<LayeredSurfaceWiring["preview"]["connectScene"]>; },
      disconnectScene: () => { events.push("cheek:disconnect"); },
      presentInitialLayers: () => { events.push("cheek:present"); },
      fillScene: () => { events.push("cheek:fill"); }, releaseScene: () => { events.push("cheek:release"); },
    } };
  const head = await buildBrowserHead({ ...h.ports, layered: [...h.ports.layered, second] });
  expect(events).toEqual([]);
  head.show();
  expect(h.connected).toBe(h.surfaces.get(head.scene));
  expect(events).toEqual(["cheek:connect", "cheek:present"]);
  expect(h.viewport.surfaceEditor()).toBeDefined();
  head.hide();
  expect(events).toEqual(["cheek:connect", "cheek:present", "cheek:disconnect"]);
  expect(h.connected).toBeUndefined();
  expect(h.viewport.surfaceEditor()).toBeUndefined();
  head.dispose();
  // A surface whose renderer isn't composed, and two on-head editors, are refused and leave nothing behind.
  await expect(buildBrowserHead({ ...h.ports, layered: [{ ...second, surface: () => undefined }] })).rejects.toThrow("The cheek-makeup renderer is not composed.");
  await expect(buildBrowserHead({ ...h.ports, layered: [...h.ports.layered, { ...second, editor: {} as NonNullable<LayeredSurfaceWiring["editor"]> }] }))
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
  const wiring: LayeredSurfaceWiring = { feature: "eye-makeup", preview: device,
    surface: scene => { const stack = stackOf(scene); return { layers: stack, surface: stack.plate, maxTextureSize: 4096 }; } };
  /** What a frame would compile, composite or upload for a stack: its slots' materials and textures, their versions, and its blend. */
  const state = (scene: unknown) => {
    const stack = stackOf(scene);
    return { materials: [...stack.materials], textures: [...stack.textures], images: stack.textures.map(texture => texture.image),
      versions: [...stack.materials.map(material => material.version), ...stack.textures.map(texture => texture.version)],
      dirty: stack.blendDiagnostics().dirty, visible: stack.plates.map(plate => plate.visible) };
  };
  return { device, publish, stackOf, wiring, state, paints, canvas: () => device.canvases[0]! };
}

test("4a-v: a cold V's authored makeup is on its surface before its scene is prepared, and its first shown frame has nothing left to compile, composite or upload", async () => {
  const h = harness(), makeup = layeredMakeup();
  // The authored layer's mask, completed while no head is shown.
  makeup.publish();
  const head = await buildBrowserHead({ ...h.ports, layered: [makeup.wiring] });
  let atPrepare: ReturnType<typeof makeup.state> | undefined;
  // The scene's preparation, as scene-host.ts does it for the plate: the feature renderers bring the stack up to date ahead (its composite).
  (head.scene as unknown as { prepare(): Promise<void> }).prepare = async () => {
    makeup.stackOf(head.scene).prepareBlend({} as THREE.WebGLRenderer);
    atPrepare = makeup.state(head.scene);
  };
  await head.prepare(new AbortController().signal, () => {});
  // Preparation saw the authored layer: one slot, its mask the completed 512² canvas, drawn.
  expect(atPrepare?.textures).toHaveLength(1);
  expect((atPrepare!.images[0] as HTMLCanvasElement).width).toBe(512);
  expect(atPrepare!.visible).toEqual([true]);
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
  const shownHead = await buildBrowserHead({ ...h.ports, layered: [makeup.wiring] });
  shownHead.show();
  const hidden = await buildBrowserHead({ ...h.ports, layered: [makeup.wiring] });
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
