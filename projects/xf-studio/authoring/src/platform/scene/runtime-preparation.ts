import * as THREE from "three";
import type { LinkedProgram } from "../../materials/render/linked-programs";
import { uploadStep, uploadUnfinished } from "../../character/render/character-detail-loader";
import { PREPARE_FRAME_MS } from "./character-renderer";
import { isDrawable } from "./drawables";
import { linkPacer } from "./link-pacing";
import { gpuDrained, gpuGate } from "./gpu-gate";
import { markPhase } from "../../character/character-timing";
import { morphGeometry, morphTextureSteps } from "./morph-textures";

/**
 * Preparing a scene runtime before it is shown (profiles phase 4a-v, experiments/043-scene-runtimes §11): what its first shown frame would
 * otherwise do on the page's thread, done ahead while the runtime is hidden, in small steps between frames, so no step blocks the page for
 * long and the first shown frame finds everything ready.
 *
 * 1. **Programs.** Everything the next frame draws (meshes, and the points and lines of overlays) is compiled for every pass it is drawn in
 *    (the lighting stage's `prepare`: the forward scene, the scatter and contact variants, the shadow depth variants), then whatever the
 *    runtime will add once shown (`extra`: the on-head editor's guides), then the display's own passes. With KHR_parallel_shader_compile
 *    the driver links them on its own threads and the preparation asks, once a frame and without waiting, how many are done. Without it a
 *    fence stands in: once the GPU process has worked through what was sent, the links have been made, and asking no longer waits long.
 *    Then each program's first use (its uniforms and attributes read back, a synchronous round trip) is taken, a few per frame.
 * 2. **Textures.** The maps those programs sample, and the core head's own, uploaded a few per frame, a large one in bands of rows (a 4096²
 *    map whole took 35–63 ms). Then the morph-target textures Three would build at each morph mesh's first draw, made ahead a few layers at
 *    a time and handed to Three (morph-textures.ts: the head's took 50–102 ms inside a draw on real data).
 * 3. **Warm-up, in pieces.** Hidden draws on the renderer device (`warmUp`): whatever only a draw makes (Three's draw-time programs,
 *    the driver's own shader variants and pipeline state, frame-sized targets, small uploads) is made there, and the shown runtime is drawn
 *    again in the same task, so the canvas never shows it. The GPU process presents no frame while it makes a draw's shader variants, so
 *    one draw of a whole cold scene held the screen still for all of them at once (33–36 s on real data, experiment 043 §11). Each piece
 *    draws only some of the scene (`warmUp(only)`), and the next waits, a frame at a time, for a fence on the last: frames are presented
 *    between pieces, the shown V and the progress line with them. Pieces start with one drawable and double while the GPU keeps up. A
 *    build the GPU process makes at a draw holds presentation for its whole length, so none may be long: no program draws into several
 *    targets at once (ANGLE builds such a pixel shader at its first draw, 1–6 s for a skin variant), and no float vertex input is fed
 *    integers (it builds such a vertex shader at its first draw, 25–70 ms each; experiment 043 §12). A last draw of everything follows
 *    (what only the whole frame makes), and its fence.
 *
 * Every step checks the signal: an abort stops at the next step and rejects with `signal.reason` (links already sent finish on the
 * driver's threads either way), the wait for a link slot included. Progress goes to `report` as the stage, how far into it, and what it
 * waits on. A lost context is one such abort: `acrossContextLoss` runs the preparation under the signal of the context's generation
 * (context-generation.ts) and starts it again after the restore. Its fences are deleted when it ends, however it ends.
 */
export type RuntimePreparationStage = "programs" | "textures" | "warm-up";
export type RuntimePreparationReport = { stage: RuntimePreparationStage; fraction: number; waiting: "driver" | "gpu" | null };
/** What a preparation did, as evidence: programs compiled and taken, maps uploaded, frames waited, and whether links were asked in parallel. */
export type RuntimePreparationResult = { programs: number; uploads: number; frames: number; parallel: boolean; warmedUp: boolean };

export type RuntimePreparationPorts = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The lighting stage's compile ahead (lighting-setup-stage.ts), an object's in steps of about one program each. */
  lighting: {
    prepareSteps(object: THREE.Object3D, camera: THREE.Camera): { steps: (() => void)[]; programs(): readonly LinkedProgram[];
      result(): { ready: Promise<void>; textures: THREE.Texture[]; programs(): readonly LinkedProgram[] } };
    prepareDisplay(): { ready: Promise<void>; programs(): readonly LinkedProgram[] };
  };
  /**
   * Before the scene is compiled: the feature renderers' own passes made ready and their GPU state current (feature-renderers.ts
   * `prepare`), so their surfaces are compiled as the first frame draws them.
   */
  features?(signal?: AbortSignal): Promise<void> | void;
  /** Maps to upload besides those the compiled programs sample (the core head's). */
  textures?(): Iterable<THREE.Texture>;
  /** Wait for the next animation frame, then a task of its own (work between frames, never inside one). */
  frame(): Promise<void>;
  /**
   * One hidden warm-up draw (the renderer device's `warmUp`), of everything, or with only `only` (and what holds them) visible; false when it
   * couldn't draw.
   */
  warmUp(only?: ReadonlySet<THREE.Object3D>): boolean;
  /** Objects the runtime adds once shown (the on-head editor's guides), compiled with the scene though not in it. */
  extra?(): Iterable<THREE.Object3D>;
  /** Other work made ahead for the first shown frame (the on-head editor's parts), each step in a frame's turn of its own, after the maps. */
  work?(): Iterable<() => void>;
  signal?: AbortSignal;
  report?(report: RuntimePreparationReport): void;
  /** The clock steps are paced by (default `performance.now`). */
  now?(): number;
  /** Main-thread time a step may take before waiting for the next frame (default `PREPARE_FRAME_MS`). */
  budget?: number;
  /** Compile and link the programs only (another lighting setup a view of the scene shows: no uploads, no warm-up). */
  programsOnly?: boolean;
};

/** Frames a fence is waited for at most (about two seconds at 60 Hz), so a lost context never holds a preparation up for good. */
const FENCE_FRAMES = 120;

export async function prepareRuntime(ports: RuntimePreparationPorts): Promise<RuntimePreparationResult> {
  const { renderer, scene, camera, lighting, signal } = ports;
  const now = ports.now ?? (() => performance.now()), budget = ports.budget ?? PREPARE_FRAME_MS;
  let started = now(), frames = 0;
  const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException("The preparation was stopped.", "AbortError"); };
  const frame = async () => { await ports.frame(); frames++; started = now(); check(); };
  /** Wait for the next frame once this step has had its share of the page's thread. */
  const pace = async () => { if (now() - started >= budget) await frame(); };
  const report = (stage: RuntimePreparationStage, fraction: number, waiting: RuntimePreparationReport["waiting"] = null) =>
    ports.report?.({ stage, fraction: Math.max(0, Math.min(1, fraction)), waiting });
  /** Wait, a frame at a time and never blocking, until the GPU has done what was sent so far; resolves with the frames waited. */
  const drained = (stage: RuntimePreparationStage, fraction: number, waiting: "driver" | "gpu") =>
    gpuDrained(renderer, { frame, frames: FENCE_FRAMES, waiting: () => report(stage, fraction, waiting) });
  check();

  // 1. Programs: the feature renderers' own passes, then every mesh the next frame draws, then the display's passes.
  report("programs", 0);
  await ports.features?.(signal);
  check();
  const drawables: THREE.Object3D[] = [];
  scene.traverseVisible(object => { if (isDrawable(object)) drawables.push(object); });
  const objects = [...drawables, ...ports.extra?.() ?? []];
  const compiled: { textures?: THREE.Texture[]; programs(): readonly LinkedProgram[] }[] = [];
  const parallel = renderer.extensions.has("KHR_parallel_shader_compile");
  let index = 0;
  const links = linkPacer({ parallel, frame, waiting: () => report("programs", 0.2 * index / objects.length, "driver") });
  for (; index < objects.length; index++) {
    const object = objects[index]!;
    // About one program per step (a mesh's own child meshes are compiled with it again; Three finds their programs made and only checks them),
    // and only a few linking at once (link-pacing.ts): the next step waits, a frame at a time, for the driver to finish one.
    const made = lighting.prepareSteps(object, camera);
    for (const step of made.steps) {
      await pace();
      await links.admit(signal);
      check();
      step();
      links.add(made.programs());
    }
    compiled.push(made.result());
    report("programs", 0.2 * (index + 1) / objects.length);
  }
  await pace();
  compiled.push(lighting.prepareDisplay());
  const programs = [...new Set(compiled.flatMap(entry => entry.programs()))];
  if (parallel) {
    // The driver links on its own threads; asking whether a link is done never waits.
    for (;;) {
      const ready = programs.filter(program => program.isReady?.() ?? true).length;
      report("programs", 0.2 + 0.6 * (programs.length ? ready / programs.length : 1), ready < programs.length ? "driver" : null);
      if (ready >= programs.length) break;
      await frame();
    }
  } else await drained("programs", 0.2, "driver");
  // Each program's first use, a few per frame: its uniforms and attributes read back from the driver.
  for (const [index, program] of programs.entries()) {
    await pace();
    program.getUniforms(); program.getAttributes();
    report("programs", 0.8 + 0.2 * (index + 1) / programs.length);
  }
  report("programs", 1);
  markPhase("run:programs");

  if (ports.programsOnly) return { programs: programs.length, uploads: 0, frames, parallel, warmedUp: false };
  // 2. Textures: the maps the programs sample, and the core head's own, a few per frame.
  const properties = renderer.properties;
  const needsUpload = (texture: THREE.Texture) => !(texture.version === 0 || !texture.image
    || (texture as { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true || (texture as THREE.DepthTexture).isDepthTexture
    || (texture as THREE.VideoTexture).isVideoTexture || (texture as THREE.CubeTexture).isCubeTexture
    || (properties.get(texture) as { __version?: number }).__version === texture.version) || uploadUnfinished(texture);
  const textures = [...new Set([...compiled.flatMap(entry => entry.textures ?? []), ...ports.textures?.() ?? []])].filter(needsUpload);
  const morphs = [...new Set(drawables.map(morphGeometry).filter(geometry => geometry !== undefined))];
  const steps = morphs.map(geometry => morphTextureSteps(renderer, geometry, { now, budget })).filter(made => made !== undefined);
  report("textures", 0);
  let uploads = 0;
  // Each upload sent only once the GPU process caught up with the last (gpu-gate.ts): none waits inside the call. Its last fence goes with it.
  const gate = gpuGate(renderer);
  const total = textures.length + steps.length;
  try {
    for (const [index, texture] of textures.entries()) {
      // A large map a band at a time (character-detail-loader.ts `uploadStep`), a frame let through whenever a step used up its share.
      let counted = false;
      while (needsUpload(texture)) {
        await pace();
        while (!gate.idle()) await frame();
        if (!counted) { uploads++; counted = true; }
        const done = uploadStep(texture, renderer);
        gate.mark();
        if (done) break;
      }
      report("textures", (index + 1) / total);
    }
    // The morph textures, all of them together a frame at a time: each frame fills what its share allows (memory only, never waiting on the
    // GPU) and sends uploads only when the GPU process caught up with the last frame's, then marks one fence for them all. One geometry after
    // another, each step behind its own fence, took 0.7–1.0 s for the head and seven small parts (experiment 044 §16).
    for (const live = [...steps]; live.length;) {
      const open = gate.idle();
      let sent = false;
      for (let worked = true; worked && live.length && now() - started < budget;) {
        worked = false;
        for (const made of [...live]) {
          if (made.uploading() && !open) continue;
          sent ||= made.uploading();
          worked = true;
          if (made.step()) { live.splice(live.indexOf(made), 1); uploads++; report("textures", (textures.length + steps.length - live.length) / total); }
          if (now() - started >= budget) break;
        }
      }
      if (sent) gate.mark();
      await frame();
    }
  } finally { for (const made of steps) made.dispose(); gate.dispose(); }
  report("textures", 1);
  markPhase("run:textures-done");
  for (const step of ports.work?.() ?? []) { await frame(); step(); }

  markPhase("run:work");
  // 3. The hidden warm-up, in pieces, each in a frame's turn of its own, the GPU finishing each before the next (see the header).
  await frame();
  report("warm-up", 0);
  let warmedUp = false;
  if (drawables.length > 1) {
    for (let at = 0, size = 1; at < drawables.length;) {
      await pace();
      const piece = new Set(drawables.slice(at, at + size));
      if (!ports.warmUp(piece)) break;
      warmedUp = true;
      at += piece.size;
      const waited = await drained("warm-up", 0.9 * at / drawables.length, "gpu");
      size = waited <= 1 ? size * 2 : waited > 3 ? 1 : size;
      check();
    }
  }
  await pace();
  if (ports.warmUp()) { warmedUp = true; await drained("warm-up", 0.95, "gpu"); }
  check();
  markPhase("run:warm-up");
  report("warm-up", 1);
  return { programs: programs.length, uploads, frames, parallel, warmedUp };
}

/** The renderer device's view of its context (renderer-device.ts `contextSignal`, `contextReady`). */
export type PreparationContext = {
  /** Aborts when the context is lost (aborted already while it is lost). */
  contextSignal(): AbortSignal;
  /** Resolves once the context is usable again and every runtime restored its own; rejects with `signal.reason` once aborted. */
  contextReady(signal?: AbortSignal): Promise<void>;
};

/**
 * Run a preparation (`attempt`) so that a lost context never leaves it waiting for good: a program compiled before the loss holds a handle
 * the restored context doesn't know, and its link never completes. Each attempt runs under the context's own signal as well as the
 * caller's, so a loss stops it at its next step, dropping every program it held; once the context is back the preparation starts again
 * from the beginning, against the restored renderer. Only the caller's abort (or a failure that isn't the loss) ends it unfinished.
 */
export async function acrossContextLoss<T>(context: PreparationContext, attempt: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; report?(report: RuntimePreparationReport): void } = {}): Promise<T> {
  for (;;) {
    options.signal?.throwIfAborted();
    const lost = context.contextSignal(), signal = options.signal ? AbortSignal.any([options.signal, lost]) : lost;
    try { return await attempt(signal); }
    catch (error) {
      if (options.signal?.aborted || !lost.aborted) throw error;
      options.report?.({ stage: "programs", fraction: 0, waiting: "gpu" });
      await context.contextReady(options.signal);
    }
  }
}
