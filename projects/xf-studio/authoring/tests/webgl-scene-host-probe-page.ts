/**
 * Browser page for tests/webgl-scene-host.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context). It starts the
 * real scene host (platform/scene/scene-host.ts) on a synthetic head (a small skinned head with one facial target, its eye plate and
 * a rigid eye; no game files) with eye makeup's renderer and a synthetic second feature, then measures:
 * 1. Render on demand: frames drawn while nothing changes, per request, per burst of requests, per layer change, while a (synthetic)
 *    idle plays and after it pauses, and how often the feature renderers' `beforeDraw` ran.
 * 2. Disposal: `renderer.info.memory` (geometries, textures) before any V, with V A, V B, A again, and none; and with makeup layers
 *    and after they are cleared. The V's are real character records loaded through the host's detail loader (a skin on `skin.mt` the
 *    core head wears, eyes on `eye.mt`, a face decal on `mesh_decal.mt`), so their loader-owned resources are what is released.
 * 3. Robustness (PREV-98): the resolved skin on the core head and eye makeup lit with its light; a renderer whose methods throw
 *    (reported once, the others and the host draw on); a lost and restored WebGL context (the composite redraws, frames draw).
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneRuntime } from "../src/platform/scene/scene-host";
import { createRendererDevice } from "../src/platform/scene/renderer-device";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import type { CharacterDetail } from "../src/character/render-detail";
import { STUDIO_RENDERERS } from "../src/compose/renderers";
import { EYE_MAKEUP_RENDERER } from "../src/features/eye-makeup/render";
import { featureId } from "../src/platform/api";
import type { FeatureRendererFactory } from "../src/platform/api/scene";
import { initialRecipe } from "./fixtures/eye-region";
import { syntheticCore, syntheticIdle, syntheticRecords } from "./webgl-synthetic-head";

type Memory = { geometries: number; textures: number };
export type SceneHostProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  features: string[];
  frames: { settled: boolean; idleWindow: number; oneRequest: number; burst: number; layerChange: number; idlePlaying: number; idlePaused: number;
    idleOff: number; beforeDrawPerFrame: boolean; cheekFrames: number };
  memory: { empty: Memory; a: Memory; b: Memory; aAgain: Memory; none: Memory; layers: Memory; layersCleared: Memory;
    /** B shown with A's parts kept for later, then with them released. */
    bKeepingA: Memory; bReleased: Memory };
  limits: { a: unknown; b: unknown };
  character: { a: unknown; b: unknown; none: unknown };
  skin: { mode: unknown; plateSkinLight: unknown; drawn: unknown; defaultAfter: unknown };
  faulty: { reports: string[]; evidence: unknown; framesDrawn: number };
  context: { events: string[]; framesAfter: number; compositeDrawsBefore: number; compositeDrawsAfter: number; plateDrawn: unknown };
  bands: unknown;
  disposed: { canvases: number; features: number; kept: number; hidden: boolean };
};
const probe: SceneHostProbe = { ok: false, errors: [], renderer: "", features: [],
  frames: {} as SceneHostProbe["frames"], memory: {} as SceneHostProbe["memory"], limits: { a: null, b: null },
  character: { a: null, b: null, none: null }, skin: { mode: null, plateSkinLight: null, drawn: null, defaultAfter: null },
  faulty: { reports: [], evidence: null, framesDrawn: -1 },
  context: { events: [], framesAfter: -1, compositeDrawsBefore: -1, compositeDrawsAfter: -1, plateDrawn: null },
  bands: null, disposed: { canvases: -1, features: -1, kept: -1, hidden: false } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A second feature's plate: a head-cut surface of its own on the rig, in its own draw-order band, drawn each frame it is asked to. */
function cheekFeature(counter: { beforeDraw: number }): FeatureRendererFactory {
  return { feature: featureId("cheek-makeup"), renderSlots: 2, create(host) {
    const { head } = host.anchors();
    const material = new THREE.MeshStandardMaterial({ color: 0xaa3355, transparent: true, opacity: 0.4, depthWrite: false });
    const surface = new THREE.SkinnedMesh(head.geometry, material);
    surface.bind(head.skeleton, head.bindMatrix);
    surface.morphTargetDictionary = { ...head.morphTargetDictionary };
    surface.morphTargetInfluences = [0];
    surface.renderOrder = host.renderBand.order(0);
    const detach = host.attach(surface, { morphs: true });
    // It replaces a creator option these V's don't use, so their parts all stay drawn.
    host.supersede([{ slot: "face", options: ["probe_lips"] }]);
    return { beforeDraw: () => { counter.beforeDraw++; }, dispose() { detach(); material.dispose(); } };
  } };
}

/** A renderer whose methods throw: the host reports each once and draws on (PREV-94). */
const faultyFeature: FeatureRendererFactory = { feature: featureId("faulty"), create() {
  return { beforeDraw() { throw Error("lost its target"); }, setNormals() { throw Error("no normals"); }, evidence() { throw Error("no evidence"); },
    dispose() {} };
} };

try {
  const element = document.createElement("div");
  element.style.cssText = "width:96px;height:96px";
  document.body.append(element);
  const counter = { beforeDraw: 0 };
  const idle = syntheticIdle();
  const loadMotion: MotionLoader = async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." });
  const contextEvents: string[] = [];
  // The window's renderer device and one scene runtime on it, shown (as the viewport device does).
  const device = createRendererDevice(element, { onContext: event => { contextEvents.push(event); } });
  const host = await createSceneRuntime(device, { renderers: [...STUDIO_RENDERERS, cheekFeature(counter), faultyFeature], loadCore: async () => syntheticCore(),
    loadMotion, loadLut: async () => ({ lut: null, source: null as never }),
    onRendererError: (feature, method, error) => { probe.faulty.reports.push(`${feature}.${method}: ${(error as Error).message}`); } });
  device.show(host.slot);
  const gl = host.renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  host.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  probe.features = host.features();
  probe.bands = host.featureBands();
  const frames = () => host.frameTiming().frames;
  const settle = async () => { for (let i = 0; i < 200 && host.frameTiming().running; i++) await sleep(10); await sleep(50); };
  const memory = (): Memory => ({ geometries: host.renderer.info.memory.geometries, textures: host.renderer.info.memory.textures });

  // 1. Render on demand.
  await settle();
  probe.frames.settled = !host.frameTiming().running;
  let start = frames();
  await sleep(400);
  probe.frames.idleWindow = frames() - start;
  const drawsBefore = counter.beforeDraw;
  start = frames();
  host.requestRender();
  await settle();
  probe.frames.oneRequest = frames() - start;
  start = frames();
  for (let i = 0; i < 10; i++) host.requestRender();
  await settle();
  probe.frames.burst = frames() - start;
  const makeup = host.feature(EYE_MAKEUP_RENDERER)!;
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  makeup.layers.setCanvases([mask], ["probe"]);
  await settle();
  start = frames();
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  await settle();
  probe.frames.layerChange = frames() - start;
  start = frames();
  host.setIdle(true);
  await sleep(300);
  probe.frames.idlePlaying = frames() - start;
  host.setIdlePaused(true);
  await settle();
  start = frames();
  await sleep(300);
  probe.frames.idlePaused = frames() - start;
  host.setIdlePaused(false);
  host.setIdle(false);
  await settle();
  start = frames();
  await sleep(300);
  probe.frames.idleOff = frames() - start;
  probe.frames.cheekFrames = counter.beforeDraw - drawsBefore;
  // beforeDraw runs exactly once per drawn frame, never on its own.
  const total = frames(), draws = counter.beforeDraw;
  host.requestRender();
  await settle();
  probe.frames.beforeDrawPerFrame = counter.beforeDraw - draws === frames() - total && frames() - total === 1;
  // The faulty renderer threw on every drawn frame and on the normals toggle: reported once each, and every frame above still drew.
  host.setNormals(true);
  await settle();
  probe.faulty.evidence = host.featureEvidence().faulty;
  probe.faulty.framesDrawn = frames();

  // 2. Disposal: V switches through the host's detail loader.
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.memory.empty = memory();
  const { fetcher, recordA, recordB } = await syntheticRecords();
  let shown: Awaited<ReturnType<typeof host.details.load>> | null = null;
  // Another V releases what the previous one kept, as the page's device does (browser-character-detail-device.ts `clear`).
  const show = async (next: CharacterDetail | null, release = true) => {
    if (release) { host.setCharacterDetails(null); host.releaseKeptParts(); shown = null; }
    const loaded = next ? await host.details.load(next, { fetcher, reuse: shown }) : null;
    const placed = host.setCharacterDetails(loaded);
    shown = loaded;
    host.requestRender(); await settle();
    return { placed: placed.limits, problems: loaded?.problems ?? [], limits: loaded?.limits ?? [] };
  };
  probe.limits.a = await show(recordA);
  probe.character.a = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.memory.a = memory();
  probe.skin.mode = (host.characterDetailsEvidence() as unknown as { skin: { mode: string } }).skin.mode;
  // Eye makeup lights its plate with the drawn skin's own light once a layer draws on it.
  makeup.layers.setCanvases([mask], ["lit"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  probe.skin.plateSkinLight = (makeup.evidence() as { plate: { skinLight: unknown } }).plate.skinLight;
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.limits.b = await show(recordB);
  probe.character.b = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.memory.b = memory();
  await show(recordA);
  probe.memory.aAgain = memory();
  // A change on one V keeps what it removed for later (the part pool); releasing it returns to what the shown V costs.
  await show(recordB, false);
  probe.memory.bKeepingA = memory();
  host.releaseKeptParts(); host.requestRender(); await settle();
  probe.memory.bReleased = memory();
  await show(null);
  probe.character.none = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.skin.defaultAfter = (host.characterDetailsEvidence() as unknown as { skin: { mode: string } }).skin.mode;
  probe.memory.none = memory();
  // Makeup layers allocate and release their own textures the same way.
  makeup.layers.setCanvases([mask, mask], ["one", "two"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  makeup.layers.updateLayer(1, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  probe.memory.layers = memory();
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.memory.layersCleared = memory();
  // 3. A lost WebGL context comes back: the host redraws, and eye makeup's composite draws again on the next frame (PREV-98).
  await show(recordA);
  makeup.layers.setCanvases([mask], ["restored"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  const compositeDraws = () => (makeup.evidence() as { plate: { compositeDraws: { layerDraws: number } } }).plate.compositeDraws.layerDraws;
  probe.context.compositeDrawsBefore = compositeDraws();
  const lose = host.renderer.getContext().getExtension("WEBGL_lose_context");
  if (lose) {
    const waitFor = async (event: string) => { for (let i = 0; i < 300 && !contextEvents.includes(event); i++) await sleep(10); };
    lose.loseContext(); await waitFor("lost");
    lose.restoreContext(); await waitFor("restored");
    await settle();
    const before = frames();
    host.requestRender(); await settle();
    probe.context.framesAfter = frames() - before;
    probe.context.compositeDrawsAfter = compositeDraws();
    probe.context.plateDrawn = (makeup.evidence() as { plate: { drawn: unknown } }).plate.drawn;
  }
  probe.context.events = [...contextEvents];
  probe.skin.drawn = host.characterDetailsEvidence().components.map(item => item.slot);
  makeup.layers.setCanvases([], []);
  await show(null);
  // 3. Teardown: every renderer goes with the runtime, which leaves the device's canvas (hidden); the canvas goes with the device.
  host.dispose();
  const kept = element.querySelectorAll("canvas").length, hidden = device.canvas.style.display === "none";
  device.dispose();
  probe.disposed = { canvases: element.querySelectorAll("canvas").length, features: host.features().length, kept, hidden };
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
