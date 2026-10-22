/**
 * Browser page for tests/webgl-scene-dispose.test.ts (profiles phase 4a-i, experiments/043-scene-runtimes): the real scene host on a
 * renderer it doesn't own, built and disposed five times over one WebGL 2 context. Each cycle builds the host on the synthetic head
 * (tests/webgl-synthetic-head.ts) with the composition's feature renderers, shows a synthetic V through the host's detail loader, draws
 * eye makeup layers, lights the V with the game's creator rig (shadow maps, the grading pass) and a studio setup (the room's environment),
 * plays the idle, and then disposes the host as it is (no V or layers cleared first). Odd cycles use a head with two influence sets, so
 * their programs differ from the even cycles'. The GPU objects the context holds are counted by
 * wrapping its `create*`/`delete*` calls (tests/webgl-gl-objects.ts), beside `renderer.info`. Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneHost } from "../src/platform/scene/scene-host";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import { STUDIO_RENDERERS } from "../src/compose/renderers";
import { EYE_MAKEUP_RENDERER } from "../src/features/eye-makeup/render";
import { DEFAULT_CREATOR_LIGHTING } from "../src/preview/creator-lighting";
import { lightingSource } from "../src/preview/lighting-setups";
import { initialRecipe } from "./fixtures/eye-region";
import { countGlObjects, type GlObjectCounts } from "./webgl-gl-objects";
import { syntheticCore, syntheticIdle, syntheticRecords } from "./webgl-synthetic-head";

/** One program the renderer holds: its shader name, a hash of its cache key, how many materials use it, and whether it is a full-skin shadow depth program. */
export type ProgramUse = { name: string; key: string; usedTimes: number; fullSkinDepth: boolean };
type Counts = { gl: GlObjectCounts; geometries: number; textures: number; programs: number; uses: ProgramUse[] };
export type SceneDisposeProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  /** Before any host was built (the renderer alone, after one empty draw). */
  baseline: Counts;
  /** Per cycle: while the V shows, and after the host was disposed. */
  cycles: { influenceSets: number; shown: Counts; disposed: Counts; framesDrawn: number; drawn: string[];
    /** With `?stacks`: each GPU object the cycle made that is still alive after its disposal, with the stack that made it. */
    left?: { kind: string; stack?: string }[] }[];
  /** The canvas still in the page after the last host went (the renderer's own; the host never moves or removes it). */
  canvases: number;
};
const probe: SceneDisposeProbe = { ok: false, errors: [], renderer: "", baseline: null as never, cycles: [], canvases: -1 };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  const element = document.createElement("div");
  element.style.cssText = "width:96px;height:96px";
  document.body.append(element);
  // The context the host is given, made as the host makes its own (opaque, no multisampling or depth: the passes draw into targets).
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  const stacks = new URLSearchParams(location.search).has("stacks");
  const counter = countGlObjects(gl, { stacks });
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, depth: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  element.append(canvas);
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  // Each program by its cache key (hashed, FNV-1a) with its use count: a material that outlives its scene keeps its program's count up, even
  // when an identical program means nothing new is made, so object counts alone can't see it.
  const hash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const uses = (): ProgramUse[] => (renderer.info.programs ?? []).map(program => {
    const { name, cacheKey, usedTimes } = program as unknown as { name: string; cacheKey: string; usedTimes: number };
    return { name, key: hash(cacheKey), usedTimes, fullSkinDepth: cacheKey.includes("full-skin-depth") };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const counts = (): Counts => ({ gl: counter.live(), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0, uses: uses() });
  // The renderer's own first-use state (its default vertex array and the like) comes with any draw, so the baseline includes one.
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  probe.baseline = counts();
  const { fetcher, recordA } = await syntheticRecords();
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  for (let cycle = 0; cycle < 5; cycle++) {
    const mark = counter.mark();
    const idle = syntheticIdle();
    const loadMotion: MotionLoader = async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." });
    // Odd cycles show a head with two influence sets: its skin and shadow depth programs differ, so a program kept by a material that
    // outlived its scene would show as an extra program, not only as a higher use count.
    const influenceSets = cycle % 2 ? 2 : 1;
    const host = await createSceneHost(element, { renderer, renderers: STUDIO_RENDERERS, loadCore: async () => syntheticCore({ influenceSets }), loadMotion,
      loadLut: async () => ({ lut: null, source: null as never }) });
    const settle = async () => { for (let i = 0; i < 200 && host.frameTiming().running; i++) await sleep(10); await sleep(50); };
    const draw = async () => { host.requestRender(); await settle(); };
    await draw();
    host.setCharacterDetails(await host.details.load(recordA, { fetcher, reuse: null }));
    await draw();
    const makeup = host.feature(EYE_MAKEUP_RENDERER)!;
    makeup.layers.setCanvases([mask, mask], ["one", "two"]);
    makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
    makeup.layers.updateLayer(1, initialRecipe().layers[0]!, undefined, undefined, true);
    await draw();
    host.setSkinScatter(true); host.setFaceShadows(true);
    host.setLighting({ kind: "game", calibration: { ...DEFAULT_CREATOR_LIGHTING } });
    await draw();
    host.setLighting(lightingSource({ setup: "soft", setups: [] }, { ...DEFAULT_CREATOR_LIGHTING }));
    await draw();
    host.setIdle(true);
    await sleep(150);
    host.setIdle(false);
    await settle();
    const shown = counts(), framesDrawn = host.frameTiming().frames;
    const drawn = host.characterDetailsEvidence().components.map(item => item.slot);
    host.dispose();
    // Anything a disposal hands back late (a pass finishing its frame) has had its frame.
    await new Promise(resolve => requestAnimationFrame(resolve));
    await sleep(50);
    probe.cycles.push({ influenceSets, shown, disposed: counts(), framesDrawn, drawn, ...(stacks ? { left: counter.aliveSince(mark) } : {}) });
  }
  probe.canvases = element.querySelectorAll("canvas").length;
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
