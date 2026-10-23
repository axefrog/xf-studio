import { expect, test } from "bun:test";
import * as THREE from "three";
import { createLightingSetupStage } from "../src/preview/render/lighting-setup-stage";
import type { StudioEnvironment } from "../src/preview/render/studio-environment";
import { acrossContextLoss, prepareRuntime } from "../src/platform/scene/runtime-preparation";
import { SceneResidency, type ResidencyWant } from "../src/preview/scene-residency";

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
