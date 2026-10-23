/**
 * Browser page for tests/webgl-scene-preparation.test.ts (profiles phase 4a-v, experiments/043-scene-runtimes §11): scene runtimes prepared
 * before they are shown, on one renderer device, on synthetic heads (no game files), under `SceneResidency` with the production ports'
 * shape: build, then the runtime's `prepare` (programs compiled ahead, maps uploaded, one hidden warm-up draw), then show. A fresh Chrome
 * profile per run, so the browser's program cache starts cold. With `?parallel=off` the page behaves like a browser without
 * KHR_parallel_shader_compile (the fallback). It measures:
 * 1. The first V (nothing shown yet): how long its preparation takes and the longest main-thread task meanwhile.
 * 2. A cold V (another body under the game's creator rig: programs never linked in this page) wanted while the first is shown: the longest
 *    main-thread task from the want to 1 s after it is shown; that the shown V's pixels never change and the new V draws no frame until it
 *    is shown; the programs linked and the maps uploaded during its first shown frame; the time from the want to that frame.
 * 3. Warm switches between the two (both prepared): the time from the want to the first presented frame.
 * 4. Cancel: a third V (a setup with more lights: new programs) superseded while its programs are being prepared: the time from the
 *    superseding want to the preparation stopping, nothing of it drawn, and the GPU objects back where they were once it is disposed.
 * 5. Every progress state, per want: stages and fractions, which must only move forward.
 * 6. Closing everything: the GPU objects and Three's programs back at the baseline (4a-i's gate, with preparation).
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneRuntime, type SceneHostOptions, type SceneRuntime } from "../src/platform/scene/scene-host";
import { createRendererDevice } from "../src/platform/scene/renderer-device";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import { STUDIO_RENDERERS } from "../src/compose/renderers";
import { EYE_MAKEUP_RENDERER } from "../src/features/eye-makeup/render";
import { DEFAULT_CREATOR_LIGHTING } from "../src/preview/creator-lighting";
import { studioStageSetup, type LightingSource } from "../src/preview/lighting-setups";
import { DEFAULT_STUDIO_STAGE } from "../src/preview/studio-lighting";
import { initialRecipe } from "./fixtures/eye-region";
import { countGlObjects, type GlObjectCounts } from "./webgl-gl-objects";
import { SceneResidency, type PreparationState, type ResidencyWant } from "../src/preview/scene-residency";
import { syntheticCore, syntheticIdle, syntheticRecords } from "./webgl-synthetic-head";
import type { RuntimePreparationResult } from "../src/platform/scene/runtime-preparation";

type Counts = { gl: GlObjectCounts; programs: string[] };
type Want = ResidencyWant & { body: "female" | "male"; record: "a" | "b"; lighting: "studio" | "creator" | "many" };
export type ScenePreparationProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string; parallel: boolean;
  first: { prepareMs: number; longestTaskMs: number; result: RuntimePreparationResult | null };
  cold: { wantToShownMs: number; showToPresentedMs: number; longestTaskMs: number; tasksOver50: number; framesBeforeShown: number; warmUps: number;
    canvasUnchanged: boolean; firstFrame: { links: number; programs: number; uploads: number }; result: RuntimePreparationResult | null };
  warm: { switchesMs: number[]; builds: number; preparations: number };
  cancel: { stage: string; cancelMs: number; superseded: string; drawn: number; canvasUnchanged: boolean; disposed: boolean; before: Counts; after: Counts };
  progress: Record<string, { stage: string; fraction: number; waiting: string | null }[]>;
  /** Diagnostics: GL calls that blocked the page for 20 ms or more, with where they came from, and each link with the stage it ran in. */
  slow: { call: string; ms: number; stage: string; via: string }[];
  links: { stage: string; via: string }[];
  /** Diagnostics: GPU objects made after the baseline and still alive once everything closed, with the stack that made each. */
  leaks: { kind: string; stack?: string }[];
  /** Diagnostics: programs the warm-up made, each against the programs of the same name made before it (their cache keys' differing parts). */
  warmUpPrograms: { key: string; name: string; diff: string[] }[];
  baseline: Counts; closed: Counts;
};
const probe: ScenePreparationProbe = { ok: false, errors: [], renderer: "", parallel: true, first: null as never, cold: null as never, warm: null as never,
  cancel: null as never, progress: {}, slow: [], links: [], leaks: [], warmUpPrograms: [], baseline: null as never, closed: null as never };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

try {
  if (new URLSearchParams(location.search).get("parallel") === "off") {
    // A browser without KHR_parallel_shader_compile (the fallback): Three then links on first use, and the preparation waits on fences.
    const prototype = WebGL2RenderingContext.prototype, getExtension = prototype.getExtension, supported = prototype.getSupportedExtensions;
    prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
      return name === "KHR_parallel_shader_compile" ? null : (getExtension as (this: WebGL2RenderingContext, name: string) => unknown).call(this, name);
    } as typeof prototype.getExtension;
    prototype.getSupportedExtensions = function (this: WebGL2RenderingContext) { return (supported.call(this) ?? []).filter(name => name !== "KHR_parallel_shader_compile"); };
  }
  // Long tasks on the page's thread, as the browser reports them (50 ms and more).
  const tasks: { start: number; duration: number }[] = [];
  new PerformanceObserver(list => { for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration }); })
    .observe({ type: "longtask", buffered: true });
  const longest = (from: number, to: number) => tasks.filter(task => task.start + task.duration >= from && task.start <= to)
    .reduce((max, task) => Math.max(max, task.duration), 0);
  const over50 = (from: number, to: number) => tasks.filter(task => task.start + task.duration >= from && task.start <= to && task.duration > 50).length;

  const element = document.createElement("div");
  element.style.cssText = "width:160px;height:120px";
  document.body.append(element);
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  const counter = countGlObjects(gl, { stacks: true });
  /** The stage the want in flight reported last (diagnostics). */
  let stageLabel = "setup";
  const stageNow = () => stageLabel;
  let beforeWarmUp: { key: string; programs: Set<{ name: string; cacheKey: string }> } | null = null;
  // Links and uploads, counted at the context (a draw that links or uploads shows here).
  const calls = { links: 0, uploads: 0 };
  {
    const context = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
    const link = context.linkProgram!.bind(gl);
    const via = () => (new Error().stack ?? "").split("\n").slice(3, 14).map(line => line.trim().replace(/^at /, "").replace(/ \(.*$/, "")).join(" < ");
    context.linkProgram = (...args: unknown[]) => { calls.links++; if (probe.links.length < 200) probe.links.push({ stage: stageNow(), via: via() }); return link(...args); };
    for (const name of ["getProgramParameter", "getShaderParameter", "getUniformLocation", "getActiveUniform", "getActiveAttrib", "getAttribLocation",
      "getProgramInfoLog", "getShaderInfoLog", "getError", "readPixels", "getSyncParameter", "clientWaitSync", "getParameter", "drawElements", "drawArrays", "finish"]) {
      const original = context[name]!.bind(gl);
      context[name] = (...args: unknown[]) => {
        const start = performance.now();
        try { return original(...args); }
        finally { const ms = performance.now() - start; if (ms >= 20 && probe.slow.length < 60) probe.slow.push({ call: name, ms, stage: stageNow(), via: via() }); }
      };
    }
    for (const name of ["texImage2D", "texSubImage2D", "texStorage2D", "texImage3D", "texSubImage3D", "texStorage3D", "compressedTexImage2D"]) {
      const original = context[name]!.bind(gl);
      context[name] = (...args: unknown[]) => { calls.uploads++; return original(...args); };
    }
  }
  const device = createRendererDevice(element, { context: gl }), renderer = device.renderer;
  probe.parallel = renderer.extensions.has("KHR_parallel_shader_compile");
  renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const counts = (): Counts => ({ gl: counter.live(), programs: (renderer.info.programs ?? [])
    .map(program => { const { name, usedTimes } = program as unknown as { name: string; usedTimes: number }; return `${name}:${usedTimes}`; }).sort() });
  const checksum = () => {
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, out = new Uint8Array(width * height * 4);
    renderer.setRenderTarget(null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    let h = 0x811c9dc5; for (const byte of out) { h ^= byte; h = Math.imul(h, 0x01000193); }
    return `${out.length}:${(h >>> 0).toString(16)}`;
  };
  const settle = async () => { for (let i = 0; i < 300 && device.stats().running; i++) await sleep(10); await sleep(30); };
  const motion = (): MotionLoader => { const idle = syntheticIdle(); return async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." }); };
  const { fetcher, recordA, recordB } = await syntheticRecords();
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  const studio = studioStageSetup(DEFAULT_STUDIO_STAGE);
  const lightingOf = (kind: Want["lighting"]): LightingSource => kind === "creator" ? { kind: "game", calibration: { ...DEFAULT_CREATOR_LIGHTING } }
    : kind === "studio" ? { kind: "setup", setup: studio }
    // More lights than any setup drawn before in this page: programs nobody has linked yet.
    : { kind: "setup", setup: { ...studio, lights: [...studio.lights, ...[0, 1].map(i => ({ ...studio.lights[1]!, id: `extra${i}`, name: `Extra ${i}`,
      type: "spot" as const, position: [0.4 - i * 0.8, 1.9, -0.8] as [number, number, number], intensity: 2, angle: 0.5, penumbra: 0.3, decay: 2, distance: 0 }))] } };

  /** What each want's preparation did, and where it stopped. */
  const results = new Map<string, RuntimePreparationResult>();
  const runtimes = new Map<SceneRuntime, string>();
  let stopped = null as { key: string; stage: string; at: number } | null;
  let current = null as { key: string; stage: string } | null;
  const residency = new SceneResidency<Want, SceneRuntime>({
    build: async (want, signal, progress) => {
      progress({ stage: "build" });
      const options: SceneHostOptions = { renderers: STUDIO_RENDERERS, loadCore: async () => ({ ...syntheticCore(), body: want.body }), loadMotion: motion(),
        loadLut: async () => ({ lut: null, source: null as never }), body: want.body, signal };
      const runtime = await createSceneRuntime(device, options);
      runtimes.set(runtime, want.key);
      runtime.setLighting(lightingOf(want.lighting));
      const makeup = runtime.feature(EYE_MAKEUP_RENDERER)!;
      makeup.layers.setCanvases([mask], ["one"]);
      makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
      return runtime;
    },
    prepare: async (runtime, want, signal, progress) => {
      try {
        // The V's details, made ready for their first frame and placed, as the head's own preparation does.
        progress({ stage: "details", fraction: 0, waiting: "files" });
        const loaded = await runtime.details.load(want.record === "a" ? recordA : recordB, { fetcher, reuse: null, signal });
        await runtime.prepareDetails(loaded, signal);
        signal.throwIfAborted();
        runtime.setCharacterDetails(loaded);
        progress({ stage: "details", fraction: 1 });
        results.set(want.key, await runtime.prepare({ signal, report: report => { current = { key: want.key, stage: report.stage }; progress(report); } }));
      } catch (error) {
        if (signal.aborted) stopped = { key: want.key, stage: current?.key === want.key ? current.stage : "details", at: performance.now() };
        throw error;
      }
    },
    prepared: runtime => runtime.prepared(),
    show: runtime => { device.show(runtime.slot); runtime.requestRender(); },
    hide: () => {},
    dispose: runtime => { runtimes.delete(runtime); runtime.dispose(); },
  }, { warm: 1 });
  residency.subscribe(() => {
    const state: PreparationState | null = residency.preparation();
    if (state) (probe.progress[state.key] ??= []).push({ stage: state.stage, fraction: state.fraction, waiting: state.waiting });
    const label = state ? `${state.key}:${state.stage}` : "idle";
    type Program = { name: string; cacheKey: string };
    const programs = () => (renderer.info.programs ?? []) as unknown as Program[];
    if (state?.stage === "warm-up" && !stageLabel.endsWith(":warm-up")) beforeWarmUp = { key: state.key, programs: new Set(programs()) };
    if (beforeWarmUp && !label.startsWith(beforeWarmUp.key)) {
      const before = beforeWarmUp;
      for (const program of programs()) if (!before.programs.has(program)) {
        const parts = program.cacheKey.split(",");
        const peers = [...before.programs].filter(other => other.name === program.name);
        const scored = [...before.programs].map(peer => { const theirs = peer.cacheKey.split(","); const d = parts.map((part, i) => part === theirs[i] ? "" : `${i}:${part}|${theirs[i]}`).filter(Boolean); return { d, name: peer.name }; })
          .sort((x, y) => x.d.length - y.d.length).slice(0, 2);
        const diff = [`KEY ${program.cacheKey.slice(0, 700)}`, ...scored.map(entry => `vs ${entry.name}: ${entry.d.join(" ").slice(0, 400)}`)];
        void peers;
        probe.warmUpPrograms.push({ key: before.key, name: program.name, diff });
      }
      beforeWarmUp = null;
    }
    stageLabel = label;
  });
  const want = (subject: string, body: Want["body"], record: Want["record"], lighting: Want["lighting"]): Want =>
    ({ scene: "s1", key: `s1|${subject}|${body}|${lighting}`, body, record, lighting });
  /** Want `target`; resolves with the time from the want to the first presented frame of it (the frame after the one that drew it). */
  const switchTo = async (target: Want) => {
    const start = performance.now();
    const runtime = await residency.want(target);
    for (let i = 0; i < 600 && runtime.frameTiming().frames === 0; i++) await frame();
    await frame();
    return { runtime, ms: performance.now() - start };
  };

  // 0. The baseline: what lives as long as the renderer, after one runtime was built, shown and disposed.
  renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  {
    const warm = await createSceneRuntime(device, { renderers: STUDIO_RENDERERS, loadCore: async () => syntheticCore(), loadMotion: motion(),
      loadLut: async () => ({ lut: null, source: null as never }) });
    device.show(warm.slot); warm.requestRender(); await settle();
    warm.dispose(); await sleep(50);
  }
  probe.baseline = counts();
  const baselineMark = counter.mark();

  // 1. The first V, with nothing shown: built, prepared (every program cold), then shown.
  const a = want("v1", "female", "a", "studio");
  {
    const start = performance.now();
    const { ms } = await switchTo(a);
    probe.first = { prepareMs: ms, longestTaskMs: longest(start, performance.now()), result: results.get(a.key) ?? null };
    await settle();
  }

  // 2. A cold V wanted while the first is shown: the other body under the game's creator rig.
  const b = want("v2", "male", "b", "creator");
  {
    const before = checksum();
    const start = performance.now();
    const pending = residency.want(b);
    const runtime = await pending;
    // Shown now, before its first frame: the canvas still holds the first V's pixels, and this one has drawn nothing yet.
    const shownAt = performance.now(), framesBefore = runtime.frameTiming().frames, warmUps = runtime.slot.warmUps;
    const unchanged = checksum() === before;
    const at = { ...calls, programs: counter.made().program };
    for (let i = 0; i < 600 && runtime.frameTiming().frames === 0; i++) await frame();
    const firstFrame = { links: calls.links - at.links, programs: counter.made().program - at.programs, uploads: calls.uploads - at.uploads };
    await frame();
    const presented = performance.now();
    await sleep(1000);
    probe.cold = { wantToShownMs: presented - start, showToPresentedMs: presented - shownAt, longestTaskMs: longest(start, presented + 1000),
      tasksOver50: over50(start, presented + 1000), framesBeforeShown: framesBefore, warmUps, canvasUnchanged: unchanged, firstFrame,
      result: results.get(b.key) ?? null };
    await settle();
  }

  // 3. Warm switches between the two prepared Vs.
  {
    const preparedBefore = results.size, builds = runtimes.size, switchesMs: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (const target of [a, b]) { const { ms } = await switchTo(target); switchesMs.push(ms); await settle(); }
    }
    probe.warm = { switchesMs, builds: runtimes.size - builds, preparations: results.size - preparedBefore };
  }

  // 4. Cancel: a third V under more lights, superseded (by B again, warm) while its programs are prepared.
  {
    await switchTo(b); await settle();
    const before = counts(), canvasBefore = checksum();
    const c = want("v3", "female", "a", "many");
    const toC = residency.want(c).then(() => "shown", (error: Error) => error.name);
    for (let i = 0; i < 2000 && !(current?.key === c.key && current.stage === "programs"); i++) await sleep(1);
    let made: SceneRuntime | undefined;
    for (const [runtime, key] of runtimes) if (key === c.key) made = runtime;
    const asked = performance.now();
    await residency.want(b);
    const superseded = await toC;
    const stoppedAt = stopped?.key === c.key ? stopped.at : NaN;
    await settle(); await sleep(100);
    probe.cancel = { stage: stopped?.key === c.key ? stopped.stage : "none", cancelMs: stoppedAt - asked, superseded,
      drawn: made ? made.frameTiming().frames : -1, canvasUnchanged: checksum() === canvasBefore, disposed: made ? !runtimes.has(made) : false,
      before, after: counts() };
  }

  // 6. Everything goes: back to the baseline.
  residency.dispose();
  await sleep(100);
  probe.closed = counts();
  probe.leaks = counter.aliveSince(baselineMark).map(({ kind, stack }) => ({ kind, stack: stack?.split("\n").slice(0, 12).map(line => line.trim()).join(" < ") }));
  device.dispose();
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
