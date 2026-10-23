/**
 * Browser page for tests/webgl-scene-runtimes.test.ts (profiles phases 4a-v and 4a-vi, experiments/043-scene-runtimes §11–§13): the S2 gate
 * table's synthetic half (T2), and scene runtimes prepared before they are shown, on one renderer device, on synthetic heads (no game
 * files), under `SceneResidency` with the production ports' shape: build, then the runtime's `prepare` (programs compiled ahead, maps
 * uploaded, one hidden warm-up draw), then show. The authored
 * makeup layer reaches each runtime as in production: the preview device fills the hidden surface before it is prepared and connects it at
 * show (browser-head-attachment.ts), never set on the stack by the probe. A fresh Chrome
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
 * 6b. The superseding subject change (4a-iv's T2, moved here from the renderer device probe so each S2 row has one place): female shown,
 *    male wanted (his core slow to load), female again 150 ms later: female stays shown, the male build stops within 100 ms and is never
 *    built. A build whose last step can't be stopped, finishing after it was superseded, is disposed and never shown (the generation check).
 *    The least recently shown runtime is evicted past the budget. Then a V in a scene of its own is opened and closed (`close(scene)`):
 *    the GPU objects and Three's programs are back where they were.
 * 6c. The morph-target texture (4a-vi): a geometry the size of the real head's morph targets (6,800 vertices, 105 targets of position and
 *    normal deltas), made ahead in steps (morph-textures.ts, as a preparation runs them) as a first load does, before any morph mesh was
 *    drawn on the renderer, its program compiled ahead, then drawn; then its twin drawn as Three builds it at the draw: each step's time,
 *    the first draw's, Three's draw, and whether Three kept the texture made ahead, byte for byte its own.
 * 7. A context lost while a cold V's programs link (after 6, since a lost context's objects are never deleted): its preparation starts
 *    again once the context is back, and the V is shown and draws.
 * 5. (After 4.) A lighting setup never drawn, asked of the shown V (profiles phase 4a-v-b): it is staged and prepared while the setup before
 *    stays drawn, pixel for pixel, then takes over; the longest main-thread task from the change to 1 s after; links and programs made in
 *    its first frame; the frames presented while it was prepared; a newer setup asked meanwhile replacing it; and the setup drawn asked
 *    again stopping a preparation.
 * 8. (After 7.) A context lost in the middle of GPU work, each recovering (4a-v-b review): a large map's banded upload (it starts again
 *    from its bitmap and every texel is the bitmap's, with no GL error); a V's details waiting for a link slot (the wait ends with the
 *    context's generation, before the restore, and the V is shown); a lighting change prepared on the shown V (restarted after the restore,
 *    it takes over with nothing to link). Then a setup prepared before the loss, asked again, is staged and prepared again (Three dropped its
 *    programs with the context), never drawn at once; and a setup prepared since, asked in the very task the context is lost in (its
 *    event still queued), is staged too.
 * The cold V's warm-up (2) and the setup's (5) are drawn in pieces, with frames presented between them (`warmUpFrames`). Throughout, the
 * context records every fragment shader it is given, every framebuffer attachment and every draw-buffer list (`singleOutput`): every
 * program writes one output, into one colour attachment (experiment 043 §12).
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
import { AuthoringDocument } from "../src/app/authoring/authoring-document";
import { createBrowserPreviewDevice } from "../src/legacy/eye-makeup/browser/browser-preview-device";
import { offerUploadSource, uploadStep, UPLOAD_BITMAP_OPTIONS } from "../src/character/render/character-detail-loader";
import { gpuGate } from "../src/platform/scene/gpu-gate";
import { morphTextures, morphTextureSteps } from "../src/platform/scene/morph-textures";
import { EYE_RASTER_REGION, freshWorkspace } from "./fixtures/eye-region";
import { multipleOutputs, type RecordedAttachment, type RecordedShader } from "./fixtures/single-output";

type Counts = { gl: GlObjectCounts; programs: string[] };
type Want = ResidencyWant & { body: "female" | "male"; record: "a" | "b"; lighting: "studio" | "creator" | "many" };
export type SceneRuntimesProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string; parallel: boolean;
  first: { prepareMs: number; longestTaskMs: number; result: RuntimePreparationResult | null };
  cold: { wantToShownMs: number; showToPresentedMs: number; longestTaskMs: number; tasksOver50: number; framesBeforeShown: number; warmUps: number;
    canvasUnchanged: boolean; firstFrame: { links: number; programs: number; uploads: number }; result: RuntimePreparationResult | null;
    /** Frames presented during its warm-up, and the longest wait between two of them (the GPU process presents none while it builds a draw's shaders). */
    warmUpFrames: number; warmUpFrameGapMs: number;
    /** The longest wait between two presented frames from the want to the show (4a-v-c). */
    frameGapMs: number };
  /** 5: a lighting setup prepared on the shown V. */
  setup: { staged: boolean; tookOverMs: number; longestTaskMs: number; tasksOver50: number; unchangedUntilTakeover: boolean; checks: number;
    firstFrame: { links: number; programs: number; frames: number }; changedAfter: boolean; warmUps: number; warmUpFrames: number; warmUpFrameGapMs: number;
    frameGapMs: number; progress: { change: string; stage: string; fraction: number }[]; prepared: boolean;
    replaced: { adopted: string[]; final: string }; back: { stoppedMs: number; staged: boolean; source: string; preparing: boolean } };
  warm: { switchesMs: number[]; builds: number; preparations: number };
  cancel: { stage: string; cancelMs: number; superseded: string; drawn: number; canvasUnchanged: boolean; disposed: boolean; before: Counts; after: Counts };
  /** The context lost while the V's programs linked: how the want ended, the restarts the preparation reported, and the frames it drew once shown. */
  contextLoss: { outcome: string; stage: string; restarts: number; frames: number; events: string[] };
  /** 8: a context lost in the middle of GPU work, each recovering (4a-v-b review). */
  recovery: {
    /** A 2048² map's banded upload: steps before the loss and after it, texels read back (top, middle, bottom row), the GL error after, the bitmap closed. */
    bands: { before: number; after: number; texels: number[][]; expected: number[]; error: number; errors: string[]; closed: boolean };
    /** A V's details waiting for a link slot (`admission`; `compile` without the extension): from the lost event to the details stopping. */
    admission: { trigger: string; viaAdmit: boolean; stopMs: number; restoredAfterStop: boolean; outcome: string; frames: number };
    /** A lighting change on the shown V lost while prepared; then a setup prepared before the loss, asked again. */
    staged: { stage: string; restarts: number; tookOver: boolean; prepared: boolean; firstFrame: { links: number; programs: number };
      before: { staged: boolean; tookOver: boolean; firstFrame: { links: number; programs: number } };
      /** A setup prepared in this generation, asked in the task the context was lost in (its event still queued). */
      queued: { staged: boolean; tookOver: boolean; firstFrame: { links: number; programs: number } } };
  };
  /** 6b: the superseding subject change, a late result, eviction, and a subject closed. */
  supersede: { superseded: string; back: string; shown: string; built: string[]; cancelMs: number; canvasUnchanged: boolean;
    late: { outcome: string; built: boolean; disposed: boolean; frames: number }; shownKeys: string[]; warm: string[]; evicted: string[]; residents: string[] };
  closeSubject: { before: Counts; opened: Counts; after: Counts; shownAfter: boolean };
  /** 6c: the first morph texture on a renderer made ahead in steps and drawn, against Three's own build of its twin at a draw. */
  morph: { vertices: number; targets: number; patched: boolean; threeDrawMs: number; steps: number; stepMaxMs: number; totalMs: number; drawMs: number;
    handed: boolean; identical: boolean; tasksOver50: number;
    /** Diagnostics: the long tasks from the first step to our draw, each against when the steps began (`at`), and each step's start. */
    tasks: { at: number; ms: number }[]; stepsAt: number[] };
  /** What the context showed of programs with several outputs and targets with several colour attachments (none), and how much it saw. */
  singleOutput: { issues: string[]; fragments: number; attachments: number };
  progress: Record<string, { stage: string; fraction: number; waiting: string | null }[]>;
  /** Diagnostics: GL calls that blocked the page for 20 ms or more, with where they came from, and each link with the stage it ran in. */
  slow: { call: string; ms: number; stage: string; via: string }[];
  links: { stage: string; via: string }[];
  /** Diagnostics: GPU objects made after the baseline and still alive once everything closed, with the stack that made each. */
  leaks: { kind: string; stack?: string }[];
  /** Diagnostics: programs the warm-up made (each with the start of its cache key): none when preparation compiled everything ahead. */
  warmUpPrograms: { key: string; name: string; diff: string[] }[];
  /** Diagnostics: the uploads of the cold V's first shown frame, and every map uploaded ahead (with the stage that uploaded it). */
  firstFrameUploads: string[];
  initTextures: string[];
  /** Diagnostics: tasks of 30 ms and more, with the stage reported last before each began. */
  longTasks: { ms: number; stage: string; at: number }[];
  stages: { at: number; label: string }[];
  /** Diagnostics: each warm-up draw and each show, in ms on the page's thread, and the device's frame times. */
  timings: { warmUps: number[]; warmUpLinks: number[]; shows: number[]; cpuFrame: unknown; prefilters: number[]; builds: number[] };
  /** Uploads during a later, steady frame of the same V (per-frame data such as bone matrices), to compare with its first. */
  steadyUploads: number;
  baseline: Counts; closed: Counts;
};
const probe: SceneRuntimesProbe = { ok: false, errors: [], renderer: "", parallel: true, first: null as never, cold: null as never, warm: null as never,
  cancel: null as never, setup: null as never, supersede: null as never, closeSubject: null as never, morph: null as never, singleOutput: null as never, contextLoss: null as never, recovery: null as never, progress: {}, slow: [], links: [], leaks: [], warmUpPrograms: [], firstFrameUploads: [], initTextures: [], longTasks: [], stages: [], timings: { warmUps: [], warmUpLinks: [], shows: [], cpuFrame: null, prefilters: [], builds: [] }, steadyUploads: -1, baseline: null as never, closed: null as never };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
/** Every animation frame's time while `recording` is set (frames presented: the GPU process presents none while it builds shaders). */
const frameTimes: number[] = [];
let recording = false;
const recordFrames = (time: number) => { if (recording) frameTimes.push(time); requestAnimationFrame(recordFrames); };
requestAnimationFrame(recordFrames);
const longestGap = (from: number, to: number) => {
  const times = frameTimes.filter(time => time >= from && time <= to);
  return Math.max(0, ...times.slice(1).map((time, i) => time - times[i]!), times.length ? Math.max(times[0]! - from, to - times[times.length - 1]!) : to - from);
};

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
  /** The page's own tasks: the probe's pixel reads (they wait for the GPU), which aren't the preparation's. */
  const own: { start: number; end: number }[] = [];
  /** A task's own length: its duration less the probe's pixel reads inside it. */
  const length = (task: { start: number; duration: number }) => task.duration - own.filter(span => span.start >= task.start - 1 && span.end <= task.start + task.duration + 1)
    .reduce((sum, span) => sum + span.end - span.start, 0);
  const within = (from: number, to: number) => tasks.filter(task => task.start + task.duration >= from && task.start <= to)
    .map(task => ({ start: task.start, duration: length(task) }));
  const longest = (from: number, to: number) => within(from, to).reduce((max, task) => Math.max(max, task.duration), 0);
  const over50 = (from: number, to: number) => within(from, to).filter(task => task.duration > 50).length;

  const element = document.createElement("div");
  element.style.cssText = "width:160px;height:120px";
  document.body.append(element);
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  const counter = countGlObjects(gl, { stacks: true });
  /** The stage the want in flight reported last (diagnostics). */
  let stageLabel = "setup";
  const stageNow = () => stageLabel;
  const stageLog: { at: number; label: string }[] = [];
  let beforeWarmUp: { key: string; programs: Set<{ name: string; cacheKey: string }> } | null = null;
  // Links and uploads, counted at the context (a draw that links or uploads shows here).
  const calls = { links: 0, uploads: 0 };
  const recorded = { shaders: [] as RecordedShader[], attachments: [] as RecordedAttachment[], drawBuffers: [] as number[][] };
  let watchUploads = false;
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
        finally { const ms = performance.now() - start; if (ms >= 10 && probe.slow.length < 80) probe.slow.push({ call: name, ms, stage: stageNow(), via: via() }); }
      };
    }
    // The single-output rule, as the driver is asked (fixtures/single-output.ts): fragment shaders, framebuffer attachments, draw buffers.
    const types = new WeakMap<object, number>();
    const createShader = context.createShader!.bind(gl), shaderSource = context.shaderSource!.bind(gl);
    context.createShader = (...args: unknown[]) => { const made = createShader(...args) as object | null; if (made) types.set(made, args[0] as number); return made; };
    context.shaderSource = (...args: unknown[]) => {
      if (types.get(args[0] as object) === gl.FRAGMENT_SHADER) recorded.shaders.push({ stage: "fragment", source: args[1] as string });
      return shaderSource(...args);
    };
    for (const name of ["framebufferTexture2D", "framebufferTextureLayer", "framebufferRenderbuffer"]) {
      const original = context[name]!.bind(gl);
      context[name] = (...args: unknown[]) => { recorded.attachments.push({ call: name, attachment: args[1] as number }); return original(...args); };
    }
    const drawBuffers = context.drawBuffers!.bind(gl);
    context.drawBuffers = (...args: unknown[]) => { recorded.drawBuffers.push([...(args[0] as number[])]); return drawBuffers(...args); };
    for (const name of ["texImage2D", "texSubImage2D", "texStorage2D", "texImage3D", "texSubImage3D", "texStorage3D", "compressedTexImage2D"]) {
      const original = context[name]!.bind(gl);
      context[name] = (...args: unknown[]) => { calls.uploads++; if (watchUploads && probe.firstFrameUploads.length < 20) probe.firstFrameUploads.push(`${name} ${via()}`); return original(...args); };
    }
  }
  const contextEvents: string[] = [], contextTimes: number[] = [];
  const device = createRendererDevice(element, { context: gl, onContext: event => { contextEvents.push(event); contextTimes.push(performance.now()); } }),
    renderer = device.renderer;
  probe.parallel = renderer.extensions.has("KHR_parallel_shader_compile");
  {
    const fromScene = THREE.PMREMGenerator.prototype.fromScene;
    THREE.PMREMGenerator.prototype.fromScene = function (this: THREE.PMREMGenerator, ...args: Parameters<typeof fromScene>) {
      const start = performance.now();
      try { return fromScene.apply(this, args); } finally { probe.timings.prefilters.push(performance.now() - start); }
    };
    const create = createSceneRuntime;
    void create;
  }
  {
    const warmUp = device.warmUp.bind(device);
    device.warmUp = (slot, draw) => {
      const start = performance.now(), links = calls.links;
      try { return warmUp(slot, draw); } finally { probe.timings.warmUps.push(performance.now() - start); probe.timings.warmUpLinks.push(calls.links - links); }
    };
  }
  {
    const init = renderer.initTexture.bind(renderer);
    renderer.initTexture = (texture: THREE.Texture) => {
      const image = texture.image as { width?: number; height?: number } | undefined;
      probe.initTextures.push(`${stageNow()}|${texture.name}|${texture.uuid.slice(0, 8)}|${image?.width}x${image?.height}|${texture.constructor.name}`);
      return init(texture);
    };
  }
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
    const start = performance.now();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    own.push({ start, end: performance.now() });
    let h = 0x811c9dc5; for (const byte of out) { h ^= byte; h = Math.imul(h, 0x01000193); }
    return `${out.length}:${(h >>> 0).toString(16)}`;
  };
  const settle = async () => { for (let i = 0; i < 300 && device.stats().running; i++) await sleep(10); await sleep(30); };
  const motion = (): MotionLoader => { const idle = syntheticIdle(); return async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." }); };
  const { fetcher, recordA, recordB } = await syntheticRecords();
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  // The authored makeup as production feeds it: the preview device (a raster worker that never answers) holding one completed 512² mask.
  const layers = createBrowserPreviewDevice({ region: EYE_RASTER_REGION, document: new AuthoringDocument(freshWorkspace()), initialSize: 512,
    makeWorker: () => ({ onmessage: null, onerror: null, postMessage() {}, terminate() {} }), frame: run => run(), refresh: () => {}, refreshSelection: () => {},
    refreshQuality: () => {}, drawUV: () => {}, report: () => {}, measurement: () => {} });
  {
    const data = new Uint8ClampedArray(512 * 512 * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    if (!layers.coordinator.publish({ i: 0, size: 512, version: 1, ms: 1, data })) throw Error("The probe's mask wasn't taken.");
  }
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
  /** Restarts the preparations reported after a lost context (`acrossContextLoss`: the programs stage again, waiting on the GPU). */
  let restarts = 0;
  /** When each want's details preparation (`prepareDetails`) ended. */
  const detailsSettled = new Map<string, number>();
  /**
   * 6b's plans per want: a core that takes `core` ms to load (stopping at once when its build is aborted), and a last step of `held` ms that
   * can't be stopped (the build returns its runtime after it was superseded). When a build was aborted, every runtime built and disposed
   * (with the frames it drew), and every runtime shown, by key.
   */
  const plans = new Map<string, { core?: number; held?: number }>(), aborted = new Map<string, number>();
  const builtLog: string[] = [], disposedLog: { key: string; frames: number }[] = [], shownLog: string[] = [];
  const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
  const ports: ConstructorParameters<typeof SceneResidency<Want, SceneRuntime>>[0] = {
    build: async (want, signal, progress) => {
      progress({ stage: "build" });
      const plan = plans.get(want.key);
      const options: SceneHostOptions = { renderers: STUDIO_RENDERERS, loadCore: async (_renderer, _body, coreSignal) => {
        if (plan?.core) await wait(plan.core, coreSignal);
        return { ...syntheticCore(), body: want.body };
      }, loadMotion: motion(), loadLut: async () => ({ lut: null, source: null as never }), body: want.body, signal };
      const built = performance.now();
      let runtime: SceneRuntime;
      try { runtime = await createSceneRuntime(device, options); }
      catch (error) { if (signal.aborted) aborted.set(want.key, performance.now()); throw error; }
      probe.timings.builds.push(performance.now() - built);
      runtimes.set(runtime, want.key);
      builtLog.push(want.key);
      // A last step that can't be stopped: the runtime comes back whether or not the want was superseded meanwhile.
      if (plan?.held) await wait(plan.held);
      runtime.setLighting(lightingOf(want.lighting));
      // Shown, a lighting change it isn't prepared for prepares it again (browser-scene-heads.ts does the same).
      runtime.onUnprepared(() => { if (residency.shown() === runtime) void residency.refresh().catch(() => {}); });
      return runtime;
    },
    prepare: async (runtime, want, signal, progress) => {
      try {
        // The V's details, made ready for their first frame and placed, as the head's own preparation does.
        progress({ stage: "details", fraction: 0, waiting: "files" });
        const loaded = await runtime.details.load(want.record === "a" ? recordA : recordB, { fetcher, reuse: null, signal });
        try { await runtime.prepareDetails(loaded, signal); } finally { detailsSettled.set(want.key, performance.now()); }
        signal.throwIfAborted();
        runtime.setCharacterDetails(loaded);
        progress({ stage: "details", fraction: 1 });
        // The authored makeup on the hidden surface, as the head's preparation fills it.
        layers.fillScene(runtime.feature(EYE_MAKEUP_RENDERER)!);
        results.set(want.key, await runtime.prepare({ signal, report: report => {
          if (report.stage === "programs" && report.waiting === "gpu") restarts++;
          current = { key: want.key, stage: report.stage }; progress(report);
        } }));
      } catch (error) {
        if (signal.aborted) stopped = { key: want.key, stage: current?.key === want.key ? current.stage : "details", at: performance.now() };
        throw error;
      }
    },
    prepared: runtime => runtime.prepared(),
    prepareShown: async (runtime, _want, signal, progress) => { await runtime.prepare({ signal, report: report => {
      if (report.stage === "programs" && report.waiting === "gpu") restarts++;
      current = { key: `shown:${report.stage}`, stage: report.stage }; progress(report);
    } }); },
    show: runtime => {
      const start = performance.now();
      // As the head's show connects its surface: it keeps what it was filled with, brought up to date.
      const makeup = runtime.feature(EYE_MAKEUP_RENDERER)!;
      layers.connectScene(makeup); layers.presentInitialLayers();
      device.show(runtime.slot); runtime.requestRender(); probe.timings.shows.push(performance.now() - start);
      shownLog.push(runtimes.get(runtime) ?? "?");
    },
    hide: runtime => layers.disconnectScene(runtime.feature(EYE_MAKEUP_RENDERER)!),
    dispose: runtime => {
      disposedLog.push({ key: runtimes.get(runtime) ?? "?", frames: runtime.frameTiming().frames });
      layers.releaseScene(runtime.feature(EYE_MAKEUP_RENDERER)!); runtimes.delete(runtime); runtime.dispose();
    },
  };
  let residency = new SceneResidency<Want, SceneRuntime>(ports, { warm: 1 });
  /** Each preparation's own list of progress states (a want, or a change of the shown V: `|shown`), numbered in the order they began. */
  let progressList: string | null = null, preparations = 0;
  const follow = () => {
    const state: PreparationState | null = residency.preparation();
    if (!state) progressList = null;
    else {
      progressList ??= `${state.key}${state.change === "shown" ? "|shown" : ""}#${++preparations}`;
      (probe.progress[progressList] ??= []).push({ stage: state.stage, fraction: state.fraction, waiting: state.waiting });
    }
    const label = state ? `${state.key}:${state.stage}` : "idle";
    type Program = { name: string; cacheKey: string };
    const programs = () => (renderer.info.programs ?? []) as unknown as Program[];
    if (state?.stage === "warm-up" && !stageLabel.endsWith(":warm-up")) beforeWarmUp = { key: state.key, programs: new Set(programs()) };
    if (beforeWarmUp && !label.startsWith(beforeWarmUp.key)) {
      const before = beforeWarmUp;
      for (const program of programs()) if (!before.programs.has(program)) {
        const diff = [program.cacheKey.slice(0, 300)];
        probe.warmUpPrograms.push({ key: before.key, name: program.name, diff });
      }
      beforeWarmUp = null;
    }
    stageLabel = label;
    stageLog.push({ at: performance.now(), label });
  };
  residency.subscribe(follow);
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
    // With a V and a makeup layer composited, so the shared 1×1 maps of the layered-makeup engine and of the V's materials (they live as
    // long as the renderer) are in it.
    warm.setCharacterDetails(await warm.details.load(recordA, { fetcher, reuse: null }));
    const makeup = warm.feature(EYE_MAKEUP_RENDERER)!;
    makeup.layers.setCanvases([mask], ["one"]);
    makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
    await warm.prepare();
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
    frameTimes.length = 0; recording = true;
    const pending = residency.want(b);
    const runtime = await pending;
    // Shown now, before its first frame: the canvas still holds the first V's pixels, and this one has drawn nothing yet.
    const shownAt = performance.now(), framesBefore = runtime.frameTiming().frames, warmUps = runtime.slot.warmUps;
    recording = false;
    const warmUpFrom = stageLog.find(entry => entry.label === `${b.key}:warm-up`)?.at ?? shownAt;
    const warmUpFrames = frameTimes.filter(time => time >= warmUpFrom && time <= shownAt).length, warmUpFrameGapMs = longestGap(warmUpFrom, shownAt);
    const frameGapMs = longestGap(start, shownAt);
    stageLog.push({ at: performance.now(), label: "probe:shown" });
    const unchanged = checksum() === before;
    const at = { ...calls, programs: counter.made().program };
    watchUploads = true;
    for (let i = 0; i < 600 && runtime.frameTiming().frames === 0; i++) await frame();
    watchUploads = false;
    stageLog.push({ at: performance.now(), label: "probe:first-frame-drawn" });
    const firstFrame = { links: calls.links - at.links, programs: counter.made().program - at.programs, uploads: calls.uploads - at.uploads };
    await frame();
    const presented = performance.now();
    stageLog.push({ at: presented, label: "probe:presented" });
    // A later frame of the same V, drawn on request: what every frame uploads (bone matrices), to set the first frame against.
    {
      const before = calls.uploads;
      runtime.requestRender();
      const drawn = runtime.frameTiming().frames;
      for (let i = 0; i < 60 && runtime.frameTiming().frames === drawn; i++) await frame();
      probe.steadyUploads = calls.uploads - before;
      probe.timings.cpuFrame = device.stats().cpuFrame;
    }
    await sleep(1000);
    probe.cold = { wantToShownMs: presented - start, showToPresentedMs: presented - shownAt, longestTaskMs: longest(start, presented + 1000),
      tasksOver50: over50(start, presented + 1000), framesBeforeShown: framesBefore, warmUps, canvasUnchanged: unchanged, firstFrame,
      result: results.get(b.key) ?? null, warmUpFrames, warmUpFrameGapMs, frameGapMs };
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

  // 5. A lighting setup never drawn, asked of the shown V (B): staged and prepared while the setup before stays drawn, then taken over.
  {
    await settle();
    const runtime = residency.shown()!;
    /** The studio setup with `n` spot lights more than any setup drawn before (the first casting a shadow): programs nobody has linked yet. */
    const spots = (n: number): LightingSource => ({ kind: "setup", setup: { ...studio, lights: [...studio.lights, ...Array.from({ length: n }, (_, i) => ({
      ...studio.lights[1]!, id: `spot${n}-${i}`, name: `Spot ${i}`, type: "spot" as const, position: [0.5 - i * 0.3, 1.8, -0.9] as [number, number, number],
      intensity: 1.5, angle: 0.5, penumbra: 0.3, decay: 2, distance: 0, shadows: i === 0 }))] } });
    const key = (source: LightingSource) => JSON.stringify(source);
    // Every setup the runtime's lighting takes, with the GPU calls and frames at that moment (an adopted staged setup goes through here).
    const adopted: { key: string; links: number; programs: number; frames: number; at: number }[] = [];
    const setSource = runtime.lighting.setSource.bind(runtime.lighting);
    runtime.lighting.setSource = next => {
      adopted.push({ key: key(next), links: calls.links, programs: counter.made().program, frames: runtime.frameTiming().frames, at: performance.now() });
      setSource(next);
    };
    const before = checksum(), target = spots(4), progress: SceneRuntimesProbe["setup"]["progress"] = [];
    const warmUpsBefore = runtime.slot.warmUps;
    frameTimes.length = 0; recording = true;
    const start = performance.now();
    runtime.setLighting(target);
    const staged = runtime.lightingEvidence().staged;
    let unchangedUntilTakeover = true, checks = 0, warmUpFrom = 0;
    for (let i = 0; i < 20000 && !adopted.some(entry => entry.key === key(target)); i++) {
      await frame();
      const state = residency.preparation();
      if (state) { progress.push({ change: state.change, stage: state.stage, fraction: state.fraction }); if (state.stage === "warm-up" && !warmUpFrom) warmUpFrom = performance.now(); }
      // The setup before, drawn as it was, until the new one takes over (a few checks; each reads the canvas back).
      if (i % 20 === 5 && !adopted.some(entry => entry.key === key(target))) { checks++; if (checksum() !== before) unchangedUntilTakeover = false; }
    }
    const took = adopted.find(entry => entry.key === key(target));
    for (let i = 0; i < 120 && took && runtime.frameTiming().frames === took.frames; i++) await frame();
    await frame();
    recording = false;
    const firstFrame = { links: calls.links - (took?.links ?? 0), programs: counter.made().program - (took?.programs ?? 0), frames: runtime.frameTiming().frames - (took?.frames ?? 0) };
    const changedAfter = checksum() !== before;
    await sleep(1000);
    const tookAt = took?.at ?? NaN;
    probe.setup = { staged, tookOverMs: tookAt - start, longestTaskMs: longest(start, tookAt + 1000), tasksOver50: over50(start, tookAt + 1000), unchangedUntilTakeover, checks,
      firstFrame, changedAfter, warmUps: runtime.slot.warmUps - warmUpsBefore,
      warmUpFrames: frameTimes.filter(time => time >= warmUpFrom && time <= tookAt).length, warmUpFrameGapMs: warmUpFrom ? longestGap(warmUpFrom, tookAt) : -1,
      frameGapMs: longestGap(start, tookAt), progress, prepared: runtime.prepared(), replaced: null as never, back: null as never };
    // A newer setup asked while one is being prepared replaces it: only the newest is ever drawn.
    {
      const x = spots(5), y = spots(6), from = adopted.length;
      runtime.setLighting(x);
      for (let i = 0; i < 4000 && residency.preparation()?.stage !== "programs"; i++) await sleep(1);
      runtime.setLighting(y);
      for (let i = 0; i < 20000 && key(runtime.lighting.source) !== key(y); i++) await frame();
      probe.setup.replaced = { adopted: adopted.slice(from).map(entry => entry.key === key(x) ? "x" : entry.key === key(y) ? "y" : "other"),
        final: key(runtime.lighting.source) === key(y) ? "y" : "other" };
      await settle();
    }
    // The setup drawn, asked again while another is being prepared: the preparation stops, and nothing changes.
    {
      const drawnNow = runtime.lighting.source;
      runtime.setLighting(spots(7));
      for (let i = 0; i < 4000 && residency.preparation()?.stage !== "programs"; i++) await sleep(1);
      const asked = performance.now();
      runtime.setLighting(drawnNow);
      for (let i = 0; i < 2000 && residency.preparation(); i++) await sleep(1);
      probe.setup.back = { stoppedMs: performance.now() - asked, staged: runtime.lightingEvidence().staged, source: key(runtime.lighting.source) === key(drawnNow) ? "drawn" : "other",
        preparing: !!residency.preparation() };
      await settle();
    }
    runtime.lighting.setSource = setSource;
  }

  // 6. Everything goes: back to the baseline.
  residency.dispose();
  await sleep(100);
  probe.closed = counts();

  // 6b. The superseding subject change, a late result, eviction, and a subject closed (see the header).
  {
    residency = new SceneResidency<Want, SceneRuntime>(ports, { warm: 1 });
    residency.subscribe(follow);
    const f = want("v1", "female", "a", "studio"), m = want("v1", "male", "b", "studio"), late = want("v9", "male", "b", "studio"), f2 = want("v2", "female", "b", "studio");
    builtLog.length = 0; disposedLog.length = 0; shownLog.length = 0;
    await switchTo(f); await settle();
    const canvas = checksum();
    // Female shown; male wanted, his core 600 ms; female again 150 ms later.
    plans.set(m.key, { core: 600 });
    const toMale = residency.want(m).then(() => "shown", (error: Error) => error.name);
    await sleep(150);
    const asked = performance.now();
    const back = await residency.want(f).then(() => "shown");
    const superseded = await toMale;
    await settle();
    // A build whose last step can't be stopped, superseded on it: it comes back late, and is disposed, never shown.
    plans.set(late.key, { held: 400 });
    const toLate = residency.want(late).then(() => "shown", (error: Error) => error.name);
    for (let i = 0; i < 4000 && !builtLog.includes(late.key); i++) await sleep(1);
    await residency.want(f);
    const lateOutcome = await toLate;
    await sleep(100); await settle();
    const lateDisposed = disposedLog.find(entry => entry.key === late.key);
    const canvasUnchanged = checksum() === canvas;
    const supersede = { superseded, back, shown: runtimes.get(residency.shown()!) ?? "", cancelMs: (aborted.get(m.key) ?? NaN) - asked, canvasUnchanged,
      late: { outcome: lateOutcome, built: builtLog.includes(late.key), disposed: !!lateDisposed, frames: lateDisposed?.frames ?? -1 } };
    // Male built and shown (female warm), then a second feminine V: the least recently shown (female v1) is evicted.
    plans.delete(m.key);
    await switchTo(m); await settle();
    const warm = residency.snapshot().residents.map(item => `${item.key}:${item.state}`);
    const disposedBefore = disposedLog.length;
    await switchTo(f2); await settle();
    probe.supersede = { ...supersede, built: [...builtLog], shownKeys: [...shownLog], warm, evicted: disposedLog.slice(disposedBefore).map(entry => entry.key),
      residents: residency.snapshot().residents.map(item => `${item.key}:${item.state}`) };
    residency.dispose();
    await sleep(100);
    // A V in a scene of its own, opened and closed.
    const before = counts();
    residency = new SceneResidency<Want, SceneRuntime>(ports, { warm: 1 });
    residency.subscribe(follow);
    await switchTo({ ...want("v10", "female", "a", "studio"), scene: "s2", key: "s2|v10|female|studio" }); await settle();
    const opened = counts();
    residency.close("s2");
    await sleep(100);
    probe.closeSubject = { before, opened, after: counts(), shownAfter: residency.shown() !== undefined };
    residency.dispose();
    await sleep(50);
  }

  // 6c. The morph-target texture: Three's build at the draw, then its twin made ahead in steps and drawn.
  {
    const vertices = 6800, targets = 105;
    const geometry = () => {
      const made = new THREE.BufferGeometry();
      made.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).map((_, i) => (i % 97) * 1e-3), 3));
      made.setIndex(Array.from({ length: vertices - 2 }, (_, i) => [i, i + 1, i + 2]).flat());
      const deltas = (seed: number) => new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).map((_, i) => Math.sin(seed * 31 + i) * 1e-3), 3);
      made.morphAttributes.position = Array.from({ length: targets }, (_, t) => deltas(t));
      made.morphAttributes.normal = Array.from({ length: targets }, (_, t) => deltas(t + 1000));
      return made;
    };
    const material = new THREE.MeshBasicMaterial(), target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const meshOf = (made: THREE.BufferGeometry) => { const mesh = new THREE.Mesh(made, material); mesh.updateMorphTargets(); mesh.frustumCulled = false; return mesh; };
    const camera = new THREE.PerspectiveCamera();
    const theirs = geometry(), ours = geometry(), a = meshOf(theirs), b = meshOf(ours);
    const drawOnly = (mesh: THREE.Mesh) => {
      const scene = new THREE.Scene(); scene.add(mesh);
      renderer.setRenderTarget(target);
      const start = performance.now();
      renderer.render(scene, camera);
      const ms = performance.now() - start;
      renderer.setRenderTarget(null);
      return ms;
    };
    // The first load: the program compiled ahead (a morph program, the same for both; linked, not yet drawn), and no morph mesh drawn on
    // this renderer before (the synthetic heads have none): the morph texture is made ahead like any other's.
    const patched = !!morphTextures(renderer);
    {
      const scene = new THREE.Scene(); scene.add(b);
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(null);
      scene.remove(b);
      await settle();
    }
    // Ahead, as a preparation runs the steps: a frame let through whenever a step used its share, each upload once the GPU caught up.
    const steps = morphTextureSteps(renderer, ours);
    const gate = gpuGate(renderer), times: number[] = [], stepsAt: number[] = [];
    const started = performance.now();
    if (steps) for (let done = false; !done;) {
      await frame();
      while (!gate.idle()) await frame();
      const start = performance.now();
      done = steps.step();
      times.push(performance.now() - start); stepsAt.push(start - started);
      gate.mark();
    }
    while (!gate.idle()) await frame();
    gate.dispose();
    const totalMs = performance.now() - started;
    await frame();
    const made = morphTextures(renderer)?.get(ours);
    // The first draw: the program's first use, and the morph texture found ready.
    const drawMs = drawOnly(b), drawnAt = performance.now();
    const kept = morphTextures(renderer)?.get(ours);
    const morphTasks = within(started, drawnAt).map(task => ({ at: task.start - started, ms: task.duration })), tasksOver50 = over50(started, drawnAt);
    await settle();
    // Three's own build of the twin, at its draw.
    await frame();
    const threeDrawMs = drawOnly(a);
    const own = morphTextures(renderer)?.get(theirs);
    // The comparison below is the probe's own work, in a task of its own after the draws.
    await frame();
    const left = (made?.texture.image.data ?? new Float32Array()) as Float32Array, right = (own?.texture.image.data ?? new Float32Array(1)) as Float32Array;
    let identical = left.length === right.length;
    for (let i = 0; identical && i < left.length; i++) if (left[i] !== right[i]) identical = false;
    await sleep(200);
    probe.morph = { vertices, targets, patched, threeDrawMs, steps: times.length, stepMaxMs: Math.max(0, ...times), totalMs, drawMs,
      handed: !!made && kept === made, identical, tasksOver50, tasks: morphTasks, stepsAt };
    theirs.dispose(); ours.dispose(); material.dispose(); target.dispose();
    await sleep(50);
  }

  // 7. The context lost while a cold V's programs link (the masculine head under more lights: never linked here), then restored.
  {
    residency = new SceneResidency<Want, SceneRuntime>(ports, { warm: 1 });
    residency.subscribe(follow);
    const lose = gl.getExtension("WEBGL_lose_context")!;
    const waitFor = async (event: string) => { for (let i = 0; i < 300 && !contextEvents.includes(event); i++) await sleep(10); };
    const d = want("v4", "male", "b", "many");
    const toD = residency.want(d).then(() => "shown", (error: Error) => error.name);
    for (let i = 0; i < 4000 && !(current?.key === d.key && current.stage === "programs"); i++) await sleep(1);
    const stage = current?.key === d.key ? current.stage : "none";
    restarts = 0;
    lose.loseContext(); await waitFor("lost");
    await sleep(200);
    lose.restoreContext(); await waitFor("restored");
    const outcome = await Promise.race([toD, sleep(180_000).then(() => "timeout")]);
    let made: SceneRuntime | undefined;
    for (const [runtime, key] of runtimes) if (key === d.key) made = runtime;
    for (let i = 0; i < 600 && made && made.frameTiming().frames === 0; i++) await frame();
    probe.contextLoss = { outcome, stage, restarts, frames: made ? made.frameTiming().frames : -1, events: [...contextEvents] };
    residency.dispose();
    await sleep(100);
  }
  // 8. A context lost in the middle of GPU work, each recovering (4a-v-b review).
  {
    const lose = gl.getExtension("WEBGL_lose_context")!;
    const count = (event: string) => contextEvents.filter(entry => entry === event).length;
    const waitFor = async (event: string, n: number) => { for (let i = 0; i < 300 && count(event) < n; i++) await sleep(10); };
    /** Lose the context, wait 200 ms, restore it. */
    const cycle = async () => {
      const lost = count("lost"), restored = count("restored");
      lose.loseContext(); await waitFor("lost", lost + 1); await sleep(200);
      lose.restoreContext(); await waitFor("restored", restored + 1);
    };
    probe.recovery = { bands: null as never, admission: null as never, staged: null as never };

    // 8a. A 2048² map's banded upload, lost after its storage and two bands. The bitmap and the texture's own image differ in colour, so
    // the texels say which one filled it: the bitmap, when the upload starts again from it after the restore.
    {
      const size = 2048;
      const paint = (colour: string) => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
        const context = canvas.getContext("2d")!; context.fillStyle = colour; context.fillRect(0, 0, size, size);
        return canvas;
      };
      const bitmap = await createImageBitmap(paint("#3080c0"), UPLOAD_BITMAP_OPTIONS);
      const texture = new THREE.Texture(paint("#c04020"));
      texture.needsUpdate = true;
      offerUploadSource(texture, bitmap);
      const gate = gpuGate(renderer);
      const errors: string[] = [];
      let steps = 0;
      gl.getError();
      const step = async () => {
        while (!gate.idle()) await frame();
        const done = uploadStep(texture, renderer);
        const error = errors.length ? Number(errors[0]!.split(":")[0]) : gl.getError();
        steps++;
        if (error) errors.push(`${error}:step${steps}:${done}`);
        gate.mark();
        return done;
      };
      let before = 0;
      while (before < 3 && !(await step())) before++;
      await cycle();
      { const error = gl.getError(); if (error) errors.push(`${error}:restored`); }
      let after = 1;
      while (after < 40 && !(await step())) after++;
      while (!gate.idle()) await frame();
      gate.dispose();
      const error = gl.getError();
      const handle = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture ?? null;
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, 0);
      const texels = [0, size / 2, size - 1].map(row => { const out = new Uint8Array(4); gl.readPixels(7, row, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return [...out]; });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      renderer.resetState();
      texture.dispose();
      probe.recovery.bands = { before, after, texels, expected: [0x30, 0x80, 0xc0, 255], error, errors, closed: bitmap.width === 0 };
    }

    // 8b. A V's details lost while they wait for a link slot (with the extension; without it, while they compile): the wait ends with the
    // context's generation, before the restore, and the V is shown once the context is back.
    residency = new SceneResidency<Want, SceneRuntime>(ports, { warm: 1 });
    residency.subscribe(follow);
    const e = want("v5", "female", "a", "studio");
    {
      let trigger = "", viaAdmit = false;
      const hook = (kind: string) => {
        if (trigger || stageNow() !== `${e.key}:details`) return;
        const stack = new Error().stack ?? "";
        if (kind === "admission" && !stack.includes("admit")) return;
        trigger = kind; viaAdmit = stack.includes("admit");
        lose.loseContext();
      };
      const context = gl as unknown as Record<string, (...args: unknown[]) => unknown>;
      const parameter = context.getProgramParameter!, link = context.linkProgram!;
      // COMPLETION_STATUS_KHR: a link asked whether it is done (the link pacer's admission, with the extension).
      context.getProgramParameter = (...args: unknown[]) => { if (args[1] === 0x91b1) hook("admission"); return parameter(...args); };
      context.linkProgram = (...args: unknown[]) => { if (!probe.parallel) hook("compile"); return link(...args); };
      const lost = count("lost"), restored = count("restored");
      const toE = residency.want(e).then(() => "shown", (error: Error) => error.name);
      for (let i = 0; i < 60_000 && !trigger; i++) await sleep(1);
      context.getProgramParameter = parameter; context.linkProgram = link;
      await waitFor("lost", lost + 1);
      const lostAt = contextTimes[contextEvents.lastIndexOf("lost")] ?? NaN;
      for (let i = 0; i < 2000 && !detailsSettled.has(e.key); i++) await sleep(1);
      const stoppedAt = detailsSettled.get(e.key) ?? NaN;
      await sleep(200);
      const restoredAfterStop = count("restored") === restored;
      lose.restoreContext(); await waitFor("restored", restored + 1);
      const outcome = await Promise.race([toE, sleep(90_000).then(() => "timeout")]);
      let made: SceneRuntime | undefined;
      for (const [runtime, key] of runtimes) if (key === e.key) made = runtime;
      for (let i = 0; i < 600 && made && made.frameTiming().frames === 0; i++) await frame();
      probe.recovery.admission = { trigger, viaAdmit, stopMs: stoppedAt - lostAt, restoredAfterStop, outcome, frames: made ? made.frameTiming().frames : -1 };
      await settle();
    }

    // 8c. A lighting change on the shown V, lost while it is prepared: restarted after the restore, it takes over with nothing to link. Then
    // the setup drawn before the loss (prepared then) asked again: staged and prepared again, never drawn at once.
    {
      const runtime = residency.shown();
      const key = (source: LightingSource) => JSON.stringify(source);
      const spots = (n: number): LightingSource => ({ kind: "setup", setup: { ...studio, lights: [...studio.lights, ...Array.from({ length: n }, (_, i) => ({
        ...studio.lights[1]!, id: `late${n}-${i}`, name: `Late ${i}`, type: "spot" as const, position: [0.6 - i * 0.3, 1.7, -0.9] as [number, number, number],
        intensity: 1.2, angle: 0.45, penumbra: 0.3, decay: 2, distance: 0, shadows: i === 0 }))] } });
      /** Ask `source` of the shown V; resolves once it is drawn, with the links and programs made in its first frame under it. */
      const takeOver = async (shown: SceneRuntime, source: LightingSource, during?: () => Promise<void>, first?: () => void) => {
        let adopted: { links: number; programs: number; frames: number } | null = null;
        const setSource = shown.lighting.setSource.bind(shown.lighting);
        shown.lighting.setSource = next => {
          if (key(next) === key(source)) adopted = { links: calls.links, programs: counter.made().program, frames: shown.frameTiming().frames };
          setSource(next);
        };
        try {
          first?.();
          shown.setLighting(source);
          const staged = shown.lightingEvidence().staged;
          await during?.();
          for (let i = 0; i < 20_000 && !adopted; i++) await frame();
          const took = adopted as { links: number; programs: number; frames: number } | null;
          for (let i = 0; i < 120 && took && shown.frameTiming().frames === took.frames; i++) await frame();
          await frame();
          return { staged, tookOver: !!took && key(shown.lighting.source) === key(source),
            firstFrame: { links: took ? calls.links - took.links : -1, programs: took ? counter.made().program - took.programs : -1 } };
        } finally { shown.lighting.setSource = setSource; }
      };
      const none = { links: -1, programs: -1 };
      probe.recovery.staged = { stage: "none", restarts: 0, tookOver: false, prepared: false, firstFrame: none, before: { staged: false, tookOver: false, firstFrame: none },
        queued: { staged: false, tookOver: false, firstFrame: none } };
      if (runtime) {
        const drawnBefore = runtime.lighting.source;
        // Prepared and drawn in this generation: the game's creator rig.
        await takeOver(runtime, lightingOf("creator"));
        await settle();
        let stage = "none";
        restarts = 0;
        const lost = await takeOver(runtime, spots(3), async () => {
          for (let i = 0; i < 60_000 && !(residency.preparation()?.change === "shown" && residency.preparation()?.stage === "programs"); i++) await sleep(1);
          stage = residency.preparation()?.stage ?? "none";
          await cycle();
        });
        await settle();
        Object.assign(probe.recovery.staged, { stage, restarts, tookOver: lost.tookOver, prepared: runtime.prepared(), firstFrame: lost.firstFrame });
        // The setup drawn before the loss: its programs went with the context, so it is staged and prepared again.
        const again = await takeOver(runtime, drawnBefore);
        probe.recovery.staged.before = { staged: again.staged, tookOver: again.tookOver, firstFrame: again.firstFrame };
        await settle();
        // Lost, its event still queued, and in the same task a setup prepared in this generation asked: the context's loss is read there
        // and then, so it is staged, not drawn at once; it takes over after the restore with nothing to link.
        const lostBefore = count("lost"), restoredBefore = count("restored");
        const queued = await takeOver(runtime, spots(3), async () => {
          await waitFor("lost", lostBefore + 1); await sleep(200);
          lose.restoreContext(); await waitFor("restored", restoredBefore + 1);
        }, () => lose.loseContext());
        probe.recovery.staged.queued = { staged: queued.staged, tookOver: queued.tookOver, firstFrame: queued.firstFrame };
        await settle();
      }
    }
    residency.dispose();
    await sleep(100);
  }
  probe.stages = stageLog.map(entry => ({ at: Math.round(entry.at), label: entry.label }));
  probe.longTasks = tasks.filter(task => task.duration >= 30).map(task => ({ ms: Math.round(task.duration), at: Math.round(task.start),
    stage: [...stageLog].reverse().find(entry => entry.at <= task.start)?.label ?? "before" }));
  probe.singleOutput = { issues: multipleOutputs(recorded.shaders, recorded.attachments, recorded.drawBuffers),
    fragments: recorded.shaders.length, attachments: recorded.attachments.length };
  probe.leaks = counter.aliveSince(baselineMark).map(({ kind, stack }) => ({ kind, stack: stack?.split("\n").slice(0, 30).map(line => line.trim()).join(" < ") }));
  device.dispose();
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
