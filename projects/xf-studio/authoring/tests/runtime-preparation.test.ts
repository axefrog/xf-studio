import { expect, test } from "bun:test";
import * as THREE from "three";
import { createLightingSetupStage } from "../src/preview/render/lighting-setup-stage";
import type { StudioEnvironment } from "../src/preview/render/studio-environment";
import { acrossContextLoss, prepareRuntime } from "../src/platform/scene/runtime-preparation";
import { SceneResidency, type ResidencyWant } from "../src/preview/scene-residency";
import { slowUploadRenderer, uploadMaps } from "./fixtures/slow-upload-renderer";

/**
 * Preparing a scene runtime ahead (profiles phase 4a-v, experiments/043-scene-runtimes §11) without a GPU: what compiling ahead may and
 * may not change, how a lost context restarts a preparation, and how a superseded one lets go.
 */

const room = (_renderer: THREE.WebGLRenderer, scene: THREE.Scene): StudioEnvironment => {
  scene.environment = new THREE.Texture();
  return { mode: "pmrem", lights: [], restore: () => {}, dispose: () => {} };
};

/** A renderer that records what each compile saw: the material a mesh wore, and the depth material's side at that moment. */
function compilingRenderer() {
  const seen: { mesh: string; material: string; side: THREE.Side }[] = [];
  const properties = new WeakMap<object, object>();
  const renderer = {
    render: () => {}, setRenderTarget: () => {}, setClearColor: () => {}, getRenderTarget: () => null,
    shadowMap: { enabled: false, type: 0, autoUpdate: true, needsUpdate: false },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(8, 8),
    getContext: () => ({ deleteShader: () => {} }),
    capabilities: { isWebGL2: true, maxSamples: 4 },
    extensions: { has: () => true },
    properties: { get: (object: object) => properties.get(object) ?? properties.set(object, {}).get(object)! },
    compileAsync(object: THREE.Object3D) {
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) seen.push({ mesh: mesh.name, material: material.name, side: material.side });
      });
      return Promise.resolve();
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, seen };
}

test("compiling ahead leaves every mesh's material and its own depth material as they were, side included (4a-v review 3)", async () => {
  const scene = new THREE.Scene();
  const skin = new THREE.MeshStandardMaterial({ name: "skin", side: THREE.FrontSide });
  const depth = new THREE.MeshDepthMaterial({ name: "skin-depth", side: THREE.BackSide });
  const head = new THREE.Mesh(new THREE.BoxGeometry(), skin);
  head.name = "head"; head.castShadow = true; head.customDepthMaterial = depth;
  const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: "plain", side: THREE.DoubleSide }));
  plain.name = "plain"; plain.castShadow = true;
  scene.add(head, plain);
  const { renderer, seen } = compilingRenderer();
  const stage = createLightingSetupStage({ scene, renderer, loadLut: () => new Promise(() => {}), createEnvironment: room });
  // The stage's own renderer state on the renderer, as a frame would put it (shadow maps on for the setup's casting lights).
  stage.applyRendererState();
  const fields = (material: THREE.Material) => {
    const own = material as unknown as Record<string, unknown>;
    return Object.fromEntries(["visible", "wireframe", "side", "alphaMap", "alphaTest", "map", "clipShadows", "clippingPlanes", "clipIntersection",
      "displacementMap", "displacementScale", "displacementBias", "wireframeLinewidth", "linewidth"].map(field => [field, own[field]]));
  };
  const before = { head: head.material, plain: plain.material, custom: head.customDepthMaterial, depth: fields(depth), skin: fields(skin), plainFields: fields(plain.material) };
  for (let i = 0; i < 2; i++) {
    const prepared = stage.prepare(scene, new THREE.PerspectiveCamera());
    await prepared.ready;
    expect({ head: head.material, plain: plain.material, custom: head.customDepthMaterial }).toEqual({ head: before.head, plain: before.plain, custom: before.custom });
    expect(head.material).toBe(before.head);
    expect(head.customDepthMaterial).toBe(depth);
    expect(fields(depth)).toEqual(before.depth);
    expect(fields(skin)).toEqual(before.skin);
    expect(fields(plain.material as THREE.Material)).toEqual(before.plainFields);
  }
  // It still compiled the shadow depth variants with the depth material, as Three's shadow pass will pick them: under the skin (its
  // side turned over), and inside the contact prepass from the depth material as it is drawn (BackSide, turned over to FrontSide), then
  // as the next redraw turns it back (PREV-208).
  const depthCompiles = seen.filter(entry => entry.material === "skin-depth");
  expect(new Set(depthCompiles.map(entry => entry.side))).toEqual(new Set([THREE.BackSide, THREE.FrontSide]));
  stage.dispose();
});

/** A context as the renderer device reports it: lost and restored on demand (renderer-device.ts `contextSignal`, `contextReady`). */
function fakeContext() {
  let life = new AbortController(), lost = false;
  const waiting = new Set<() => void>();
  return {
    gl: { isContextLost: () => lost } as unknown as WebGL2RenderingContext,
    contextSignal: () => life.signal,
    contextReady: (signal?: AbortSignal) => lost ? new Promise<void>((resolve, reject) => {
      waiting.add(resolve);
      signal?.addEventListener("abort", () => { waiting.delete(resolve); reject(signal.reason); }, { once: true });
    }) : Promise.resolve(),
    lose() { lost = true; life.abort(new DOMException("The WebGL context was lost.", "ContextLostError")); },
    restore() { lost = false; life = new AbortController(); for (const resume of [...waiting]) resume(); waiting.clear(); },
    get lost() { return lost; },
  };
}

test("a context lost while a V's programs link: the preparation drops them, starts again after the restore, and the V is shown (4a-v review 2)", async () => {
  const context = fakeContext();
  // Programs made before the loss never finish linking (the restored context doesn't know their handles); those made after do at once.
  const made: { generation: number; polls: number }[] = [];
  let generation = 0;
  const renderer = { getContext: () => context.gl, extensions: { has: () => true }, properties: { get: () => ({}) }, initTexture: () => {} } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  const program = () => {
    const entry = { generation, polls: 0 };
    made.push(entry);
    const born = generation;
    return { getUniforms: () => ({}), getAttributes: () => ({}), isReady: () => { entry.polls++; return born > 0; } };
  };
  const lighting = { prepareSteps: () => { const linked = program(); return { steps: [], programs: () => [linked], result: () => ({ ready: Promise.resolve(), textures: [], programs: () => [linked] }) }; },
    prepareDisplay: () => ({ ready: Promise.resolve(), programs: () => [] }) };
  const frame = () => new Promise<void>(resolve => setTimeout(resolve, 1));
  const shown: string[] = [];
  const residency = new SceneResidency<ResidencyWant, string>({
    build: async want => want.key,
    prepare: async (_runtime, _want, signal, progress) => {
      await acrossContextLoss(context, attempt => prepareRuntime({ renderer, scene, camera: new THREE.PerspectiveCamera(), lighting, frame,
        warmUp: () => !context.lost, signal: attempt, report: report => progress(report) }), { signal, report: report => progress(report) });
    },
    show: runtime => shown.push(runtime), hide: () => {}, dispose: () => {},
  });
  const wanted = residency.want({ scene: "s1", key: "v" });
  // Linking: the first attempt's program polled, never ready.
  for (let i = 0; i < 200 && !(made[0]?.polls ?? 0); i++) await frame();
  expect(made.map(entry => entry.generation)).toEqual([0]);
  context.lose();
  await frame(); await frame();
  // While lost it waits for the restore, holding no program and asking nothing more of the lost ones.
  const polls = made[0]!.polls;
  await frame(); await frame();
  expect(made[0]!.polls).toBe(polls);
  expect(shown).toEqual([]);
  expect(residency.preparation()?.waiting).toBe("gpu");
  generation = 1; context.restore();
  await expect(wanted).resolves.toBe("v");
  expect(shown).toEqual(["v"]);
  // Started again from the beginning, against the restored context: a new program, linked.
  expect(made.map(entry => entry.generation)).toEqual([0, 1]);
  residency.dispose();
});

test("a preparation's own abort still ends it while the context is lost, and a failure that isn't the loss isn't retried", async () => {
  const context = fakeContext();
  context.lose();
  const controller = new AbortController();
  let attempts = 0;
  const stopped = acrossContextLoss(context, async signal => { attempts++; signal.throwIfAborted(); return "done"; }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(new DOMException("Superseded.", "AbortError"));
  await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
  expect(attempts).toBe(1);
  context.restore();
  attempts = 0;
  await expect(acrossContextLoss(context, async () => { attempts++; throw Error("A part couldn't be compiled."); })).rejects.toThrow("A part couldn't be compiled.");
  expect(attempts).toBe(1);
});

test("a renderer's context generation ends when its context is lost, already when a loss is found before its event, and a restore begins the next (4a-v-b review)", async () => {
  const { beginContextGeneration, contextGeneration, endContextGeneration } = await import("../src/platform/scene/context-generation");
  let lost = false;
  const renderer = { getContext: () => ({ isContextLost: () => lost }) };
  const first = contextGeneration(renderer);
  expect(contextGeneration(renderer)).toBe(first);
  expect(first.aborted).toBe(false);
  // Lost, its event still queued: the generation ends as soon as anyone asks.
  lost = true;
  expect(contextGeneration(renderer).aborted).toBe(true);
  expect(first.reason).toMatchObject({ name: "ContextLostError" });
  endContextGeneration(renderer);
  lost = false;
  beginContextGeneration(renderer);
  const second = contextGeneration(renderer);
  expect(second).not.toBe(first);
  expect(second.aborted).toBe(false);
  // A renderer no device drives (no context at all) has one generation.
  const standIn = {};
  expect(contextGeneration(standIn)).toBe(contextGeneration(standIn));
  expect(contextGeneration(standIn).aborted).toBe(false);
});

test("state kept with a generation is checked against the generation read again: a loss whose event is still queued fails the check, and a restore found by a read begins the next (4a-v-b review 2, finding 2)", async () => {
  const { beginContextGeneration, contextGeneration, endContextGeneration, inGeneration } = await import("../src/platform/scene/context-generation");
  let lost = false;
  const renderer = { getContext: () => ({ isContextLost: () => lost }) };
  const kept = contextGeneration(renderer);
  expect(inGeneration(renderer, kept)).toBe(true);
  // Lost; the event isn't told yet and nobody has asked, so the kept signal is still live.
  lost = true;
  expect(kept.aborted).toBe(false);
  // The check reads the generation again: it ends there and then, and the kept state no longer holds.
  expect(inGeneration(renderer, kept)).toBe(false);
  expect(kept.aborted).toBe(true);
  // Restored, its event not told yet: the next read begins the next generation, and the event's own begin keeps it.
  lost = false;
  const next = contextGeneration(renderer);
  expect([next === kept, next.aborted]).toEqual([false, false]);
  beginContextGeneration(renderer);
  expect(contextGeneration(renderer)).toBe(next);
  expect(inGeneration(renderer, kept)).toBe(false);
  expect(inGeneration(renderer, null)).toBe(false);
  // The device's lost event ends it as before.
  endContextGeneration(renderer); lost = true;
  expect(inGeneration(renderer, next)).toBe(false);
});

// ---- The morph textures are made together, one fence a round (experiment 044 §16) ----

/** A mesh drawing `targets` position targets of `vertices` vertices: a morph texture the preparation makes ahead. */
function morphMesh(vertices: number, targets: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.morphAttributes.position = Array.from({ length: targets }, () => new THREE.Float32BufferAttribute(new Float32Array(vertices * 3).fill(0.5), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.updateMorphTargets();
  return mesh;
}
/** The recording renderer with GPU fences the test controls: each is unsignalled until `release`d (or while `held`). */
async function fencedRenderer() {
  const { recordingRenderer } = await import("./fixtures/recording-gl");
  const { morphTextures } = await import("../src/platform/scene/morph-textures");
  const recording = recordingRenderer();
  const fences: { signalled: boolean }[] = [];
  const gl = { isContextLost: () => false, SYNC_GPU_COMMANDS_COMPLETE: 1, SYNC_STATUS: 2, UNSIGNALED: 3, SIGNALED: 4,
    fenceSync: () => { const fence = { signalled: false }; fences.push(fence); return fence; },
    getSyncParameter: (fence: { signalled: boolean }) => fence.signalled ? 4 : 3, deleteSync: () => {}, flush: () => {} };
  Object.defineProperty(recording.renderer, "getContext", { value: () => gl });
  return { recording, fences, morphTextures: morphTextures(recording.renderer)! };
}
const noLighting = { prepareSteps: () => ({ steps: [], programs: () => [], result: () => ({ ready: Promise.resolve(), textures: [], programs: () => [] }) }),
  prepareDisplay: () => ({ ready: Promise.resolve(), programs: () => [] }) };

test("runtime maps advance several bands per frame with slow fences and stop at the outstanding texel limit (PREV-196)", async () => {
  const { offerUploadSource } = await import("../src/character/render/character-detail-loader");
  const { UPLOAD_TEXELS } = await import("../src/platform/scene/gpu-upload-budget");
  const slow = slowUploadRenderer(), textures = uploadMaps();
  for (const texture of textures) offerUploadSource(texture, { width: 4096, height: 4096, close() {} } as ImageBitmap);
  try {
    const done = await prepareRuntime({ renderer: slow.renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
      lighting: noLighting, textures: () => textures, frame: slow.frame, now: slow.now, warmUp: () => false });
    expect(done.uploads).toBe(3);
    expect(slow.sends).toHaveLength(24);
    expect(slow.peak()).toBeLessThanOrEqual(UPLOAD_TEXELS);
    const first = slow.sends[0]!.frame;
    expect(slow.sends.filter(sent => sent.frame === first).length).toBeGreaterThan(1);
    expect(slow.sends.filter(sent => sent.frame > first && sent.frame < first + 15)).toEqual([]);
    expect(slow.sends.at(-1)!.frame).toBeLessThan(90);
  } finally { for (const texture of textures) texture.dispose(); }
  expect(slow.fences.every(fence => fence.deleted)).toBe(true);
});

test("a spent upload window with a fence that never signals fails closed at its wait deadline and releases its fences (PREV-196)", async () => {
  const { offerUploadSource } = await import("../src/character/render/character-detail-loader");
  const { UPLOAD_TEXELS, UPLOAD_WAIT_FRAMES } = await import("../src/platform/scene/gpu-upload-budget");
  const slow = slowUploadRenderer({ stuckAfterOpening: true }), textures = uploadMaps();
  for (const texture of textures) offerUploadSource(texture, { width: 4096, height: 4096, close() {} } as ImageBitmap);
  try {
    await expect(prepareRuntime({ renderer: slow.renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lighting: noLighting,
      textures: () => textures, frame: slow.frame, now: slow.now, warmUp: () => false })).rejects.toThrow("GPU did not complete");
    expect(slow.peak()).toBeLessThanOrEqual(UPLOAD_TEXELS);
    expect(slow.sends).toHaveLength(7);
    expect(slow.frames()).toBe(15 + UPLOAD_WAIT_FRAMES);
  } finally { for (const texture of textures) texture.dispose(); }
  expect(slow.fences.every(fence => fence.deleted)).toBe(true);
});

test("every morph texture is made in the same rounds, not one geometry's fences after another's: the frames follow the rounds, not the sum of the steps", async () => {
  const { recording, fences, morphTextures } = await fencedRenderer();
  const scene = new THREE.Scene(), meshes = Array.from({ length: 6 }, () => morphMesh(100, 40));
  scene.add(...meshes);
  let frames = 0, clock = 0;
  // A fence signals by the next frame; an upload costs 3 ms of the frame's 8 (two fit a round), a fill nothing.
  const sent = () => recording.volumes.length;
  const frame = async () => { frames++; clock += 20; for (const fence of fences) fence.signalled = true; await Promise.resolve(); };
  const done = await prepareRuntime({ renderer: recording.renderer, scene, camera: new THREE.PerspectiveCamera(), lighting: noLighting, frame,
    warmUp: () => false, now: () => clock + 3 * sent() });
  expect(done.uploads).toBe(6);
  for (const mesh of meshes) expect(morphTextures.get(mesh.geometry)).toMatchObject({ count: 40 });
  // Made one geometry after another, each of its three steps (allocate, fill, upload) behind a fence, it took 18 frames or more.
  expect(frames).toBeLessThan(10);
});

test("morph uploads wait for the GPU to catch up with the last round's, and go on once it has", async () => {
  const { recording, fences } = await fencedRenderer();
  const scene = new THREE.Scene(), meshes = Array.from({ length: 4 }, () => morphMesh(100, 40));
  scene.add(...meshes);
  const controller = new AbortController();
  let frames = 0, clock = 0, firstUpload = -1;
  const sent = () => recording.volumes.length;
  const seen: number[] = [];
  // Fences signal at the next frame until the first upload is sent; then none does for 6 frames.
  const frame = async () => {
    frames++; clock += 20;
    seen.push(sent());
    if (firstUpload < 0 && sent() > 0) firstUpload = frames;
    if (firstUpload < 0 || frames >= firstUpload + 6) for (const fence of fences) fence.signalled = true;
    if (frames > 200) controller.abort(new DOMException("Stopped.", "AbortError"));
    controller.signal.throwIfAborted();
    await Promise.resolve();
  };
  await prepareRuntime({ renderer: recording.renderer, scene, camera: new THREE.PerspectiveCamera(), lighting: noLighting, frame,
    warmUp: () => false, now: () => clock + 3 * sent(), signal: controller.signal });
  // The first round sent what fit its share; the closed fence then held every upload back for six frames, and the rest went once it opened.
  expect(firstUpload).toBeGreaterThan(0);
  const at = firstUpload - 1;
  expect(seen.slice(at, at + 5).every(count => count === seen[at])).toBe(true);
  expect(sent()).toBeGreaterThan(seen[at]!);
  expect(frames).toBeLessThan(60);
});
