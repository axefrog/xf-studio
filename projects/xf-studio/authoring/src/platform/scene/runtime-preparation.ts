import * as THREE from "three";
import type { LinkedProgram } from "../../preview/render/lighting-setup-stage";
import { uploadTexture } from "../../character/render/character-detail-loader";
import { PREPARE_FRAME_MS } from "./character-renderer";

/**
 * Preparing a scene runtime before it is shown (profiles phase 4a-v, experiments/043-scene-runtimes §11): what its first shown frame would
 * otherwise do on the page's thread, done ahead while the runtime is hidden, in small steps between frames, so no step blocks the page for
 * long and the first shown frame finds everything ready.
 *
 * 1. **Programs.** Every mesh the next frame draws is compiled for every pass it is drawn in (the lighting stage's `prepare`: the forward
 *    scene, the scatter and contact variants, the shadow depth variants), then the display's own passes. With KHR_parallel_shader_compile
 *    the driver links them on its own threads and the preparation asks, once a frame and without waiting, how many are done. Without it a
 *    fence stands in: once the GPU process has worked through what was sent, the links have been made, and asking no longer waits long.
 *    Then each program's first use (its uniforms and attributes read back, a synchronous round trip) is taken, a few per frame.
 * 2. **Textures.** The maps those programs sample, and the core head's own, uploaded a few per frame (a 4096² map takes about 40 ms).
 * 3. **Warm-up.** One hidden draw on the renderer device (`warmUp`): whatever only a draw makes (Three's draw-time programs, the driver's
 *    input layouts, frame-sized targets, small uploads) is made there, and the shown runtime is drawn again in the same task, so the canvas
 *    never shows it. A fence then waits for the GPU to finish it.
 *
 * Every step checks the signal: an abort stops at the next step and rejects with `signal.reason` (links already sent finish on the
 * driver's threads either way). Progress goes to `report` as the stage, how far into it, and what it waits on.
 */
export type RuntimePreparationStage = "programs" | "textures" | "warm-up";
export type RuntimePreparationReport = { stage: RuntimePreparationStage; fraction: number; waiting: "driver" | "gpu" | null };
/** What a preparation did, as evidence: programs compiled and taken, maps uploaded, frames waited, and whether links were asked in parallel. */
export type RuntimePreparationResult = { programs: number; uploads: number; frames: number; parallel: boolean; warmedUp: boolean };

export type RuntimePreparationPorts = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The lighting stage's compile ahead (lighting-setup-stage.ts). */
  lighting: {
    prepare(object: THREE.Object3D, camera: THREE.Camera): { ready: Promise<void>; textures: THREE.Texture[]; programs(): readonly LinkedProgram[] };
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
  /** The hidden warm-up draw (the renderer device's `warmUp`); false when it couldn't draw (the runtime is shown already). */
  warmUp(): boolean;
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
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let started = now(), frames = 0;
  const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException("The preparation was stopped.", "AbortError"); };
  const frame = async () => { await ports.frame(); frames++; started = now(); check(); };
  /** Wait for the next frame once this step has had its share of the page's thread. */
  const pace = async () => { if (now() - started >= budget) await frame(); };
  const report = (stage: RuntimePreparationStage, fraction: number, waiting: RuntimePreparationReport["waiting"] = null) =>
    ports.report?.({ stage, fraction: Math.max(0, Math.min(1, fraction)), waiting });
  /** Wait, a frame at a time and never blocking, until the GPU has done what was sent so far. */
  const drained = async (stage: RuntimePreparationStage, fraction: number, waiting: "driver" | "gpu") => {
    if (typeof gl.fenceSync !== "function" || gl.isContextLost()) return;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) return;
    gl.flush();
    try {
      for (let waited = 0; waited < FENCE_FRAMES && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED; waited++) {
        report(stage, fraction, waiting);
        await frame();
      }
    } finally { gl.deleteSync(fence); }
  };
  check();

  // 1. Programs: the feature renderers' own passes, then every mesh the next frame draws, then the display's passes.
  report("programs", 0);
  await ports.features?.(signal);
  check();
  const meshes: THREE.Mesh[] = [];
  scene.traverseVisible(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
  const compiled: { textures?: THREE.Texture[]; programs(): readonly LinkedProgram[] }[] = [];
  for (const [index, mesh] of meshes.entries()) {
    await pace();
    // One mesh per step (a mesh's own child meshes are compiled with it again; Three finds their programs made and only checks them).
    compiled.push(lighting.prepare(mesh, camera));
    report("programs", 0.2 * (index + 1) / meshes.length);
  }
  await pace();
  compiled.push(lighting.prepareDisplay());
  const programs = [...new Set(compiled.flatMap(entry => entry.programs()))];
  const parallel = renderer.extensions.has("KHR_parallel_shader_compile");
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

  if (ports.programsOnly) return { programs: programs.length, uploads: 0, frames, parallel, warmedUp: false };
  // 2. Textures: the maps the programs sample, and the core head's own, a few per frame.
  const properties = renderer.properties;
  const needsUpload = (texture: THREE.Texture) => !(texture.version === 0 || !texture.image
    || (texture as { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true || (texture as THREE.DepthTexture).isDepthTexture
    || (texture as THREE.VideoTexture).isVideoTexture || (texture as THREE.CubeTexture).isCubeTexture
    || (properties.get(texture) as { __version?: number }).__version === texture.version);
  const textures = [...new Set([...compiled.flatMap(entry => entry.textures ?? []), ...ports.textures?.() ?? []])].filter(needsUpload);
  report("textures", 0);
  let uploads = 0;
  for (const [index, texture] of textures.entries()) {
    await pace();
    if (!needsUpload(texture)) continue;
    uploadTexture(texture, map => renderer.initTexture(map));
    uploads++;
    report("textures", (index + 1) / textures.length);
  }
  report("textures", 1);

  // 3. The hidden warm-up draw, in a frame's turn of its own, then the GPU finishing it.
  await frame();
  report("warm-up", 0);
  const warmedUp = ports.warmUp();
  if (warmedUp) await drained("warm-up", 0.5, "gpu");
  check();
  report("warm-up", 1);
  return { programs: programs.length, uploads, frames, parallel, warmedUp };
}
