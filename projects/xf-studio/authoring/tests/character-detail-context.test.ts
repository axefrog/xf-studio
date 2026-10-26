import { expect, test } from "bun:test";
import * as THREE from "three";
import { CharacterDetailActions } from "../src/character/character-detail-actions";
import { DEFAULT_CHARACTER } from "../src/character/character-detail-request";
import { createBrowserCharacterDetailDevice } from "../src/character/browser/browser-character-detail-device";
import type { LoadedCoreDetail } from "../src/character/render/core-detail-loader";
import type { ParsedGeometry, WarmedFiles } from "../src/character/render/character-detail-loader";
import { CHARACTER_DETAIL_SCHEMA, DETAIL_SLOTS, type CharacterDetail } from "../src/character/render-detail";
import { beginContextGeneration, contextGeneration, endContextGeneration } from "../src/platform/scene/context-generation";
import { createSceneRuntime, type SceneDevice } from "../src/platform/scene/scene-host";
import { recordingRenderer } from "./fixtures/recording-gl";

// Exercise the actual scene-host loader, browser device and actions without Chrome or GPU work. Only the context's events and a
// delayed geometry parse are driven by the test: a generation abort must not become a permanent CharacterDetailActions failure.
function geometry(name = "submesh_00_LOD_1"): ParsedGeometry {
  const shape = new THREE.BufferGeometry();
  shape.setAttribute("position", new THREE.Float32BufferAttribute([0, 1.6, 0, 0.1, 1.6, 0, 0, 1.7, 0], 3));
  shape.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  shape.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  shape.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  shape.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  shape.setIndex([0, 1, 2]);
  const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(shape, new THREE.MeshStandardMaterial());
  bone.name = "Head"; mesh.name = name;
  mesh.bind(new THREE.Skeleton([bone]));
  const scene = new THREE.Group(); scene.add(bone, mesh);
  return { scene, weights: new Map([[name, weights]]) };
}

function core(): LoadedCoreDetail {
  const { scene } = geometry("head"), head = scene.getObjectByName("head") as THREE.SkinnedMesh;
  const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshStandardMaterial());
  scene.add(eyes);
  const texture = () => new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  return { body: "female", gltf: { scene } as LoadedCoreDetail["gltf"], meshes: [head, eyes], head, eyes, surfaces: new Map(),
    record: { identity: "fixture", origin: "game-files", provenance: { label: "fixture", notes: [] } } as unknown as LoadedCoreDetail["record"],
    textures: { "head.albedo": texture(), "head.normal": texture(), "head.roughness": texture(), "eyes.albedo": texture() } };
}

const hash = "a".repeat(64), file = `${hash}.json`;
const record: CharacterDetail = {
  schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: hash, origin: "game-files",
  character: { source: "default", bodyGender: "female" }, provenance: { label: "fixture", notes: [] },
  slots: DETAIL_SLOTS.map(slot => ({ slot, state: slot === "face" ? "shown" : "none", label: "Fixture" })),
  components: [{ id: "face:a", slot: "face", option: "a", definition: "a", component: "a",
    geometry: { file: "fixture.glb", sha256: hash, sources: [], depotPath: "fixture.mesh", depotHash: "1", morphTargets: false }, renderChunks: 1, chunks: [0],
    materials: [{ chunk: 0, name: "m", template: "base\\materials\\mesh_decal.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
      textures: { DiffuseTexture: { file: `${hash}.png`, sha256: hash, sources: [], depotPath: "fixture.png", width: 1, height: 1, isGamma: true } },
      profiles: {}, skinProfiles: {}, gradients: {} }] }],
};

async function harness() {
  const { renderer } = recordingRenderer();
  // Use the lighting stage's supported probe fallback: this CPU test never draws or prefilters a room.
  renderer.extensions.has = () => false;
  let lost = false, restoreRuntime = () => {};
  const gl = renderer.getContext(); gl.isContextLost = () => lost;
  const waiting = new Set<() => void>();
  const device: SceneDevice = {
    renderer, measure: () => ({ width: 64, height: 64 }), resize: () => false, warmUp: () => false,
    stats: () => ({}) as ReturnType<SceneDevice["stats"]>,
    add: entry => {
      restoreRuntime = () => entry.contextRestored?.();
      return { shown: false, requestFrame() {}, remove() {} } as ReturnType<SceneDevice["add"]>;
    },
    contextSignal: () => contextGeneration(renderer),
    contextReady: signal => {
      signal?.throwIfAborted();
      if (!lost) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const done = () => { waiting.delete(resume); signal?.removeEventListener("abort", abort); };
        const resume = () => { done(); resolve(); };
        const abort = () => { done(); reject(signal!.reason); };
        waiting.add(resume); signal?.addEventListener("abort", abort, { once: true });
      });
    },
  };
  const runtime = await createSceneRuntime(device, { loadCore: async () => core(), loadMotion: async () => ({ idleError: "fixture", blinkError: "fixture" }),
    loadLut: async () => ({ lut: null, source: { kind: "neutral", depotPath: null, archive: null, group: null, provider: null,
      alternatives: [], rule: null, size: null, note: "fixture", skipped: [] } }) });
  const started = Promise.withResolvers<void>(), first = Promise.withResolvers<ParsedGeometry>();
  const generations: AbortSignal[] = [];
  const files: WarmedFiles = {
    bytes: () => undefined,
    texture: () => Promise.resolve({ image: { width: 1, height: 1 } as HTMLImageElement, bitmap: null, reduced: null }),
    geometry: () => { generations.push(contextGeneration(renderer)); started.resolve(); return generations.length === 1 ? first.promise : Promise.resolve(geometry()); },
  };
  // Preparation is independently covered by runtime-preparation: this regression stops at loading and placing real detail parts.
  const port = createBrowserCharacterDetailDevice({ ...runtime, prepareDetails: undefined }, async (_url, init) => init?.method === "POST"
    ? Response.json({ recordSchema: CHARACTER_DETAIL_SCHEMA, key: "fixture", phase: "ready", message: "", progress: null, record: file })
    : Response.json(record), { remember() {}, files });
  const actions = new CharacterDetailActions(port);
  return { actions, port, started: started.promise, generations, waiting,
    lose() { lost = true; endContextGeneration(renderer); },
    restore() { lost = false; beginContextGeneration(renderer); restoreRuntime(); for (const resume of [...waiting]) resume(); },
    finishFirst() { first.resolve(geometry()); },
    dispose() {
      actions.dispose(); port.clear(); runtime.dispose();
      // Three's animation teardown expects this browser global even though this renderer never started an animation loop.
      const cancelFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
      if (!cancelFrame) Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value() {} });
      try { renderer.dispose(); }
      finally { if (!cancelFrame) Reflect.deleteProperty(globalThis, "cancelAnimationFrame"); }
    },
  };
}

test("context loss mid-load waits for restoration, retries once in the new generation and reaches ready", async () => {
  const h = await harness();
  try {
    const pending = h.actions.setCharacter(DEFAULT_CHARACTER);
    await Promise.race([h.started, pending.then(() => { throw Error("The request ended before geometry loading."); })]);
    h.lose(); h.finishFirst();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.actions.snapshot().phase).toBe("preparing");
    expect(h.generations).toHaveLength(1);
    expect(h.waiting.size).toBe(1);
    h.restore();
    await pending;
    expect(h.actions.snapshot().phase).toBe("ready");
    expect(h.actions.snapshot().slots.find(slot => slot.slot === "face")?.state).toBe("shown");
    expect(h.generations).toHaveLength(2);
    expect(h.generations[0]!.aborted).toBe(true);
    expect(h.generations[1]!.aborted).toBe(false);
    expect(h.generations[1]).not.toBe(h.generations[0]);
    await h.actions.setCharacter(DEFAULT_CHARACTER);
    expect(h.generations).toHaveLength(2);
  } finally { h.dispose(); }
});

test("a requester cancelled before context loss never retries after restoration", async () => {
  const h = await harness();
  try {
    const pending = h.actions.setCharacter(DEFAULT_CHARACTER);
    await Promise.race([h.started, pending.then(() => { throw Error("The request ended before geometry loading."); })]);
    h.actions.dispose();
    h.lose(); h.finishFirst();
    await pending;
    h.restore();
    expect(h.generations).toHaveLength(1);
    expect(h.waiting.size).toBe(0);
    expect(h.actions.snapshot().phase).not.toBe("ready");
  } finally { h.dispose(); }
});

test("a requester cancelled while waiting for restoration stops waiting and never retries", async () => {
  const h = await harness();
  try {
    const pending = h.actions.setCharacter(DEFAULT_CHARACTER);
    await Promise.race([h.started, pending.then(() => { throw Error("The request ended before geometry loading."); })]);
    h.lose(); h.finishFirst();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.waiting.size).toBe(1);
    h.actions.dispose();
    await pending;
    expect(h.waiting.size).toBe(0);
    h.restore();
    expect(h.generations).toHaveLength(1);
    expect(h.actions.snapshot().phase).not.toBe("ready");
  } finally { h.dispose(); }
});
