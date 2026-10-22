/**
 * Browser page for tests/webgl-renderer-device.test.ts (profiles phase 4a-ii, experiments/043-scene-runtimes): scene runtimes on one
 * renderer device, on synthetic heads (tests/webgl-synthetic-head.ts; no game files). It measures, on one WebGL 2 context whose GPU objects
 * are counted at the driver (tests/webgl-gl-objects.ts):
 * 1. Aborted builds: a build aborted before it starts, during the core head's load, during the rig's motion and during the feature
 *    renderers' creation rejects with the abort and leaves the context's GPU objects and Three's programs where they were.
 * 2. A hidden build: runtime B built, given a V and its parts prepared (programs compiled, maps uploaded) while A is shown draws no frame
 *    of its own and leaves the canvas's pixels unchanged.
 * 3. Shared renderer state (risk 4): A drawn, then B (another lighting setup with another exposure), then A again: A's pixels are
 *    byte-identical.
 * 4. Input: a wheel on the canvas moves the shown runtime's camera only.
 * 5. Disposal of both leaves the device drawing-ready, its canvas in place, and the GPU objects where the first disposal left them.
 * 6. A context lost and restored while a runtime is still being built (after its stage prefiltered the room, before its core loads):
 *    once shown, it draws byte-identically to the same runtime built on an undisturbed context.
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneRuntime, type SceneHostOptions, type SceneRuntime } from "../src/platform/scene/scene-host";
import { createRendererDevice } from "../src/platform/scene/renderer-device";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import type { FeatureRendererFactory } from "../src/platform/api/scene";
import { featureId } from "../src/platform/api";
import { STUDIO_RENDERERS } from "../src/compose/renderers";
import { EYE_MAKEUP_RENDERER } from "../src/features/eye-makeup/render";
import { DEFAULT_CREATOR_LIGHTING } from "../src/preview/creator-lighting";
import { studioStageSetup } from "../src/preview/lighting-setups";
import { DEFAULT_STUDIO_STAGE } from "../src/preview/studio-lighting";
import { initialRecipe } from "./fixtures/eye-region";
import { countGlObjects, type GlObjectCounts } from "./webgl-gl-objects";
import { syntheticCore, syntheticIdle, syntheticRecords } from "./webgl-synthetic-head";

type Counts = { gl: GlObjectCounts; programs: string[] };
export type RendererDeviceProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  /** After a runtime was built, shown, drawn and disposed once: what lives as long as the renderer is made. */
  warm: Counts;
  aborts: { step: string; error: string; after: Counts }[];
  hidden: { framesA: [number, number]; framesB: number; canvasBefore: string; canvasAfter: string; drawnB: string[];
    /** B's makeup composite draws before and after its renderer prepared it ahead, while hidden. */
    composite: [number, number] };
  aba: { a: string; b: string; aAgain: string; identical: boolean; framesBWhileHidden: number; framesAWhileB: number; bytes: number };
  input: { shownA: { a: boolean; b: boolean }; shownB: { a: boolean; b: boolean } };
  disposed: { counts: Counts; canvases: number; hidden: boolean; lost: boolean; drawsAgain: boolean };
  restoredWhileBuilding: { events: string[]; built: string; reference: string; identical: boolean };
};
const probe: RendererDeviceProbe = { ok: false, errors: [], renderer: "", warm: null as never, aborts: [], hidden: null as never, aba: null as never,
  input: null as never, disposed: null as never, restoredWhileBuilding: null as never };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  const element = document.createElement("div");
  element.style.cssText = "width:96px;height:96px";
  document.body.append(element);
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  const counter = countGlObjects(gl);
  const contextEvents: string[] = [];
  const device = createRendererDevice(element, { context: gl, onContext: event => { contextEvents.push(event); } }), renderer = device.renderer;
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const counts = (): Counts => ({ gl: counter.live(), programs: (renderer.info.programs ?? [])
    .map(program => { const { name, usedTimes } = program as unknown as { name: string; usedTimes: number }; return `${name}:${usedTimes}`; }).sort() });
  /** The canvas's pixels as drawn now (its buffer is preserved between frames). */
  const pixels = () => {
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, out = new Uint8Array(width * height * 4);
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  };
  const checksum = (bytes: Uint8Array) => { let h = 0x811c9dc5; for (const byte of bytes) { h ^= byte; h = Math.imul(h, 0x01000193); } return `${bytes.length}:${(h >>> 0).toString(16)}`; };
  const settle = async () => { for (let i = 0; i < 300 && device.stats().running; i++) await sleep(10); await sleep(50); };
  const lut = async () => ({ lut: null, source: null as never });
  const motion = (): MotionLoader => { const idle = syntheticIdle(); return async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." }); };
  const build = (options: SceneHostOptions = {}) => createSceneRuntime(device, { renderers: STUDIO_RENDERERS, loadCore: async () => syntheticCore(),
    loadMotion: motion(), loadLut: lut, ...options });
  const { fetcher, recordA, recordB } = await syntheticRecords();
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  /** Show a V with a makeup layer under a lighting setup, as the page would. */
  const dress = async (runtime: SceneRuntime, record: typeof recordA, exposure: number, loaded?: Awaited<ReturnType<SceneRuntime["details"]["load"]>>) => {
    runtime.setCharacterDetails(loaded ?? await runtime.details.load(record, { fetcher, reuse: null }));
    const makeup = runtime.feature(EYE_MAKEUP_RENDERER)!;
    makeup.layers.setCanvases([mask], ["one"]);
    makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
    runtime.setLighting({ kind: "setup", setup: { ...studioStageSetup(DEFAULT_STUDIO_STAGE), exposure } });
  };

  // 0. Warm-up: what the first scene leaves on the renderer for good (tests/webgl-scene-dispose.test.ts `RENDERER_LIFETIME`).
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  {
    const warm = await build();
    device.show(warm.slot);
    await dress(warm, recordA, 1.2);
    warm.setLighting({ kind: "game", calibration: { ...DEFAULT_CREATOR_LIGHTING } });
    warm.requestRender(); await settle();
    warm.dispose();
    await sleep(50);
  }
  probe.warm = counts();

  // 1. Aborted builds, at each step: nothing they made stays.
  const abortAt = async (step: string) => {
    const controller = new AbortController();
    const options: SceneHostOptions = { signal: controller.signal };
    if (step === "before") controller.abort();
    if (step === "core") options.loadCore = async () => { const core = syntheticCore(); controller.abort(); return core; };
    // A step that fails because of the abort (a fetch cut short) rejects with the abort, not with its own error.
    if (step === "core-failing") options.loadCore = async () => { controller.abort(); throw new TypeError("Failed to fetch"); };
    if (step === "motion") { const loaded = motion(); options.loadMotion = async (...args) => { const made = await loaded(...args); controller.abort(); return made; }; }
    if (step === "features") {
      // A renderer that aborts the build as it is made, with a mesh of its own on the rig: the next renderer is never made, and both go.
      const aborting: FeatureRendererFactory = { feature: featureId("aborting"), create(host) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial());
        const detach = host.attach(mesh);
        controller.abort();
        return { dispose() { detach(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } };
      } };
      options.renderers = [aborting, ...STUDIO_RENDERERS];
    }
    let error = "built";
    try { (await build(options)).dispose(); } catch (caught) { error = (caught as Error)?.name ?? String(caught); }
    await sleep(20);
    probe.aborts.push({ step, error, after: counts() });
  };
  for (const step of ["before", "core", "core-failing", "motion", "features"]) await abortAt(step);

  // 2. A shown; B built hidden, given a V and its parts prepared ahead, while A stays on the canvas.
  const a = await build();
  device.show(a.slot);
  await dress(a, recordA, 0.9);
  a.requestRender(); await settle();
  const shownA = pixels();
  const framesA0 = a.frameTiming().frames;
  const b = await build();
  const loaded = await b.details.load(recordB, { fetcher, reuse: null });
  await b.prepareDetails(loaded);
  await dress(b, recordB, 2.4, loaded);
  // The runtime composites only in a drawn frame, so B's makeup is composited ahead here, through its renderer's own preparation, on the
  // shared renderer while A is shown (preparing a whole runtime ahead is 4a-v's).
  const makeupB = b.feature(EYE_MAKEUP_RENDERER)!;
  const compositeDraws = () => (makeupB.evidence() as { plate: { compositeDraws: { layerDraws: number } } }).plate.compositeDraws.layerDraws;
  const compositeBefore = compositeDraws();
  makeupB.beforeDraw?.();
  const compositeAfter = compositeDraws();
  b.requestRender();
  await settle();
  probe.hidden = { framesA: [framesA0, a.frameTiming().frames], framesB: b.frameTiming().frames, canvasBefore: checksum(shownA), canvasAfter: checksum(pixels()),
    drawnB: b.characterDetailsEvidence().components.map(item => item.slot), composite: [compositeBefore, compositeAfter] };

  // 3. A, then B, then A: A's pixels are byte-identical (each draw opens with its own renderer state; risk 4).
  const framesBHidden = b.frameTiming().frames;
  device.show(b.slot);
  await settle();
  const shownB = pixels(), framesAWhileB = a.frameTiming().frames;
  device.show(a.slot);
  await settle();
  const again = pixels();
  probe.aba = { a: checksum(shownA), b: checksum(shownB), aAgain: checksum(again), identical: again.every((value, i) => value === shownA[i]),
    framesBWhileHidden: framesBHidden, framesAWhileB: framesAWhileB - framesA0, bytes: again.length };

  // 4. A wheel on the canvas reaches the shown runtime's camera only.
  const distance = (runtime: SceneRuntime) => { const state = runtime.cameraState(); return Math.hypot(...state.position.map((p, i) => p - state.target[i]!)); };
  const wheel = async () => {
    const before = { a: distance(a), b: distance(b) };
    const rect = device.canvas.getBoundingClientRect();
    device.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
    await settle();
    return { a: Math.abs(distance(a) - before.a) > 1e-6, b: Math.abs(distance(b) - before.b) > 1e-6 };
  };
  const inputA = await wheel();
  device.show(b.slot);
  await settle();
  const inputB = await wheel();
  probe.input = { shownA: inputA, shownB: inputB };

  // 5. Both go; the device stays, its canvas hidden, and draws again for the next runtime.
  a.dispose(); b.dispose();
  await sleep(50);
  const after = counts(), hidden = device.canvas.style.display === "none";
  const next = await build();
  device.show(next.slot);
  next.requestRender(); await settle();
  const drawsAgain = next.frameTiming().frames > 0, reference = pixels();
  next.dispose();
  probe.disposed = { counts: after, canvases: element.querySelectorAll("canvas").length, hidden, lost: gl.isContextLost(), drawsAgain };

  // 6. The same runtime again, with the context lost and restored while it is built: after its stage prefiltered the room (into a target
  // the loss empties), before its core loads. Shown, it draws as the undisturbed one did.
  const lose = gl.getExtension("WEBGL_lose_context")!;
  const waitFor = async (event: string) => { for (let i = 0; i < 300 && !contextEvents.includes(event); i++) await sleep(10); };
  const disturbed = await build({ loadCore: async () => {
    lose.loseContext(); await waitFor("lost");
    lose.restoreContext(); await waitFor("restored");
    return syntheticCore();
  } });
  device.show(disturbed.slot);
  disturbed.requestRender(); await settle();
  const built = pixels();
  probe.restoredWhileBuilding = { events: [...contextEvents], built: checksum(built), reference: checksum(reference),
    identical: built.length === reference.length && built.every((value, i) => value === reference[i]) };
  disturbed.dispose();
  device.dispose();
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
