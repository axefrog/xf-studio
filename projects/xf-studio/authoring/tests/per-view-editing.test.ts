/**
 * Per-view editing (experiment 044 chunk P2-iii, decision D3): one editor document follows the drawn view's look, over the real scene runtime
 * owner, head attachment, preview device and makeup stacks, with fake scenes and a raster worker the test answers.
 *
 * - **No frame of the leaving head ever holds the new look's layers.** While a view of another look is made ready, the head on screen keeps
 *   exactly the canvases of its own look, slot by slot, though the document already shows the other look and its masks complete.
 * - **Back before the takeover** shows the first look again with no raster: the head on screen's hold gives its masks back.
 * - **A warm look keeps its makeup**: switching back to a warm head of another look rasters nothing and presents nothing (no slot changes,
 *   no composite pending), and its makeup goes with its head.
 * - **Gestures settle on the look they began on**: a gesture open across a look switch is committed to that look, and the next frame of it is
 *   refused rather than applied to the other look.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { createBrowserSceneHeads, type SceneHeadsPorts } from "../src/preview/browser/browser-scene-heads";
import { layeredPreviewWiring, type LayeredSurfaceWiring } from "../src/preview/browser/layered-preview-wiring";
import { CharacterContextActions } from "../src/character/character-context-actions";
import { AuthoringDocument, type DocumentState } from "./fixtures/makeup-document";
import { createBrowserPreviewDevice } from "../src/legacy/eye-makeup/browser/browser-preview-device";
import type { RasterPort } from "../src/legacy/eye-makeup/browser/raster-client";
import type { LayeredMakeupSurface } from "../src/engines/layered-makeup/render/makeup-stack";
import type { Recipe } from "../src/engines/layered-makeup/recipe";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { namedCore } from "./fixtures/named-targets";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { emptyLookHistory } from "../src/platform/core/look-history";
import { createMakeupStack, EYE_RASTER_REGION, freshWorkspace, initialRecipe } from "./fixtures/eye-region";
import { creator, harness } from "./fixtures/fake-heads";
import { vHistory } from "./fixtures/character-steps";

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

/** Two looks of one layer stack each: B's layers are other layers (other IDs and colours). */
const LOOK_A: Recipe = initialRecipe();
const LOOK_B: Recipe = { ...initialRecipe(), layers: initialRecipe().layers.map((layer, i) => ({ ...layer, id: `b-${i + 1}`, color: "#3060c0" })) };
const stateOf = (recipe: Recipe): DocumentState => ({ recipe: structuredClone(recipe), active: 0, selected: 0, fieldSelection: {}, history: emptyLookHistory() });

/** A raster worker that keeps each request until the test answers it (a complete mask of the requested size). */
function rasterWorker() {
  const posted: { i: number; version: number; size: number }[] = [];
  const worker: RasterPort = { onmessage: null, onerror: null, terminate() {},
    postMessage(message) { if (!("cancel" in message)) posted.push(message as never); } };
  return { worker, posted, requests: () => posted.length,
    /** Answer every request, including those dispatched as earlier ones complete. */
    drain() {
      for (let n = 0; n < 100; n++) {
        const next = posted.find(item => !(item as { answered?: boolean }).answered);
        if (!next) return;
        (next as { answered?: boolean }).answered = true;
        worker.onmessage?.({ data: { i: next.i, version: next.version, size: next.size, ms: 1, data: new Uint8ClampedArray(next.size * next.size * 4) } } as MessageEvent);
      }
    } };
}

function world() {
  const h = harness(), raster = rasterWorker();
  const authoring = new AuthoringDocument(freshWorkspace(LOOK_A));
  let look = "A";
  const createCanvas = (size: number) => ({ width: size, height: size, getContext: () => ({ putImageData() {} }) }) as unknown as HTMLCanvasElement;
  const device = createBrowserPreviewDevice({ region: EYE_RASTER_REGION, document: authoring, initialSize: 512, makeWorker: () => raster.worker,
    frame: run => run(), refresh() {}, refreshSelection() {}, refreshQuality() {}, drawUV() {}, report() {}, measurement() {},
    createCanvas, createPixels: (data, size) => ({ data, width: size, height: size }) as ImageData, look: () => look });
  // One makeup stack per scene, as a scene's feature renderer is.
  const stacks = new Map<unknown, ReturnType<typeof createMakeupStack>>(), surfaces = new Map<unknown, LayeredMakeupSurface>();
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
  const wiring: LayeredSurfaceWiring = { feature: "eye-makeup", preview: device, edited: true,
    surface: scene => surfaces.get(scene) ?? surfaces.set(scene, { layers: stackOf(scene), surface: stackOf(scene).plate, maxTextureSize: 4096 }).get(scene)! };
  // Two views, each on a scene of its own showing its own V and look.
  const graph = h.ports.graph!, side = graph.addView("main", {}, { label: "Side" });
  const views: Record<string, { scene: string; subject: string; look: string }> = { main: { scene: "s1", subject: "v1", look: "A" }, [side]: { scene: "s2", subject: "v2", look: "B" } };
  const contexts = new Map<string, CharacterContextActions>();
  const characters: SceneHeadsPorts["characters"] = {
    context: (id, ports) => contexts.get(id) ?? contexts.set(id, new CharacterContextActions({ ...ports, creator, history: vHistory(id).home },
      { stored: { origin: "default", bodyGender: "female", choices: [] } })).get(id)!,
    document: () => ({}) as never, decoded: () => null };
  const gate = { open: true, waiting: [] as (() => void)[] };
  const heads = createBrowserSceneHeads({
    head: { ...h.ports, layered: [layeredPreviewWiring(wiring)] },
    scenes: { view: () => "main", of: view => views[view]?.scene, has: scene => Object.values(views).some(view => view.scene === scene),
      subject: scene => Object.values(views).find(view => view.scene === scene)?.subject, ensureSubject: async scene => Object.values(views).find(view => view.scene === scene)!.subject,
      subscribe: () => () => {} },
    characters, prepareCore: async () => {}, pending() {}, notice() {}, shown() {}, previews: null,
    // The document follows the drawn view's look (decision D3), as the root's look editor does: the look's state, then the device.
    document: { shows: view => views[view]!.look === look,
      follow: view => { look = views[view]!.look; authoring.restore(stateOf(look === "A" ? LOOK_A : LOOK_B)); device.showLook(); } },
  });
  // Builds of the side scene wait while the gate is shut.
  const viewport = h.ports.viewport, build = viewport.buildHead.bind(viewport);
  viewport.buildHead = (async (body: Parameters<typeof build>[0], signal?: AbortSignal) => {
    if (!gate.open) await new Promise<void>((resolve, reject) => {
      gate.waiting.push(resolve);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return build(body, signal);
  }) as typeof build;
  /** Slot by slot, the canvas each layer of a head's stack shows. */
  const images = (scene: unknown) => stackOf(scene).textures.map(texture => texture.image as HTMLCanvasElement);
  const state = (scene: unknown) => { const stack = stackOf(scene);
    return { versions: [...stack.materials.map(material => material.version), ...stack.textures.map(texture => texture.version)], dirty: stack.blendDiagnostics().dirty }; };
  return { h, raster, authoring, device, heads, side, images, state, gate,
    open() { gate.open = true; for (const resolve of gate.waiting.splice(0)) resolve(); } };
}

test("T1: no frame of the leaving head ever holds the new look's layers, and back before the takeover the first look returns with no raster", async () => {
  const w = world();
  w.raster.drain();
  await w.heads.load();
  // Look A's masks are rastered and complete before any switch, so its hold is complete (an unfinished hold re-rasters on return).
  w.device.showLook(); w.raster.drain(); await settle();
  const first = w.heads.shown()!, aCanvases = [...w.device.canvases];
  // The head shows look A's masks, slot by slot.
  expect(w.images(first.scene)).toEqual(aCanvases);
  w.gate.open = false;
  const away = w.heads.show(w.side);
  // The document shows look B now, and its masks are rastered (they complete while the side head is still being made ready).
  expect(w.authoring.recipe.layers[0]!.id).toBe("b-1");
  w.raster.drain();
  await settle();
  expect(w.heads.shown()).toBe(first);
  // Every slot of the head on screen still holds look A's canvas; none of look B's.
  expect(w.images(first.scene)).toEqual(aCanvases);
  for (const canvas of w.device.canvases) expect(w.images(first.scene)).not.toContain(canvas);
  // Back before the takeover: the document shows look A again, from the hold, with no raster.
  const requests = w.raster.requests();
  await w.heads.show("main");
  await expect(away).rejects.toMatchObject({ name: "AbortError" });
  expect(w.authoring.recipe.layers[0]!.id).toBe("layer-1");
  expect(w.raster.requests()).toBe(requests);
  expect(w.device.queueDiagnostics()).toMatchObject({ queued: 0, running: null });
  expect([...w.device.canvases]).toEqual(aCanvases);
  expect(w.heads.shown()).toBe(first);
  expect(w.images(first.scene)).toEqual(aCanvases);
  // Following the document again: the next completed mask of look A reaches it.
  const edits = w.raster.requests();
  w.authoring.publishLayer({ ...w.authoring.recipe, layers: w.authoring.recipe.layers.map((layer, i) => i === 0 ? { ...layer, opacity: 0.5 } : layer) }, 0);
  w.raster.drain();
  expect(w.raster.requests()).toBeGreaterThan(edits);
  expect(w.images(first.scene)[0]).toBe(w.device.canvases[0]!);
  w.open();
  w.heads.dispose();
});

test("T1: switching back to a warm head of another look rasters, presents and composites nothing; its makeup goes with its head", async () => {
  const w = world();
  w.raster.drain();
  await w.heads.load();
  w.device.showLook(); w.raster.drain(); await settle();
  const first = w.heads.shown()!;
  // To the side view (look B): rastered once, made ready and shown.
  const toSide = w.heads.show(w.side);
  w.raster.drain();
  await toSide;
  for (let i = 0; i < 20 && w.heads.shown() === first; i++) { w.raster.drain(); await settle(); }
  const second = w.heads.shown()!;
  expect(second).not.toBe(first);
  const bCanvases = [...w.device.canvases];
  // Back to the main view (look A, warm): its makeup comes back with its head, nothing is rastered, nothing presented anew.
  const requests = w.raster.requests(), before = w.state(first.scene);
  await w.heads.show("main");
  expect(w.heads.shown()).toBe(first);
  expect(w.raster.requests()).toBe(requests);
  expect(w.state(first.scene)).toEqual(before);
  // And once more to look B, warm too.
  const requestsB = w.raster.requests(), beforeB = w.state(second.scene);
  await w.heads.show(w.side);
  expect([w.heads.shown(), w.raster.requests()]).toEqual([second, requestsB]);
  expect([...w.device.canvases]).toEqual(bCanvases);
  expect(w.state(second.scene)).toEqual(beforeB);
  // Released with their heads (all closed here), no look is held any more: showing a look again rasters it afresh.
  w.heads.dispose();
  expect(w.device.showLook()).toBe(false);
});

test("T1: a gesture open across a look switch settles on the look it began on; its next frame is refused, never applied to the other look", () => {
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(LOOK_A), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
  const { app, document } = core, layer = document.recipe.layers[0]!, u = layer.points[0]!.u;
  let settled: Recipe | undefined;
  // What the document holds as it is replaced (after the application settled what was open).
  document.onReplacing(() => { settled = structuredClone(document.recipe) as Recipe; });
  expect(app.beginGesture("uv", layer.id)).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + 0.002 } })).toBe(true);
  // The view of look B is drawn: the document shows look B (the look editor's restore).
  document.restore(stateOf(LOOK_B));
  expect(settled!.layers[0]!.points[0]!.u).toBeCloseTo(u + 0.002, 9);
  // The gesture is over: its next frame and its end change nothing of look B.
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + 0.004 } })).toBe(false);
  app.endGesture("uv");
  expect(document.recipe).toEqual(stateOf(LOOK_B).recipe);
});
