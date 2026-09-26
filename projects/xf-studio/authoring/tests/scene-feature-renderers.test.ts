import { expect, test } from "bun:test";
import * as THREE from "three";
import { createFeatureRenderers, type FeatureRendererContext } from "../src/platform/scene/feature-renderers";
import { featureId } from "../src/platform/api";
import type { FeatureRenderer, FeatureRendererFactory, SceneHostPort, SurfaceUnderlay } from "../src/platform/api/scene";
import { EYE_MAKEUP_RENDERER, EYE_PLATE_SURFACE, eyeMakeupRenderer } from "../src/features/eye-makeup/render";
import { initialRecipe } from "./fixtures/eye-region";

// Feature-module platform step 7: the scene host's feature renderers, through their scene ports only. Eye makeup's renderer is
// driven here exactly as the host drives it (frames, skin changes, context restores, display toggles), and a synthetic second
// feature adds a surface of its own beside it (a later cheek or lips plate), so more than one plate can share the head.

/** A head rig without a GPU: a head and the eye plate (a copy of its UV band) under one root, both with one facial target. */
function rig() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0.25, 0.5, 0.75, 0.5, 0.25, 0.625], 2));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  const root = new THREE.Group(), head = new THREE.SkinnedMesh(geometry.clone()), plate = new THREE.SkinnedMesh(geometry);
  for (const mesh of [head, plate]) { mesh.morphTargetDictionary = { h091_eyes: 0 }; mesh.morphTargetInfluences = [0]; }
  head.morphTargetInfluences![0] = 1;
  root.add(head, plate);
  return { root, head, plate };
}

/** The renderer's offscreen passes, counted (the composite draws into its targets through `render`). */
function gpu() {
  let target: unknown = null;
  const stats = { draws: 0 };
  const renderer = { capabilities: { maxTextureSize: 4096, getMaxAnisotropy: () => 8 }, extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget: (next: unknown) => { target = next; }, getClearColor: (out: THREE.Color) => out,
    getClearAlpha: () => 1, setClearColor: () => {}, clear: () => {}, render: () => { stats.draws++; } } as unknown as THREE.WebGLRenderer;
  return { renderer, stats };
}

function context(parts = rig()) {
  const { renderer, stats } = gpu();
  const skinListeners = new Set<() => void>(), frameListeners = new Set<(dt: number) => void>();
  const state = { frames: 0, light: null as null | { lobes: { roughness0: number; roughness1: number; weight: number }; wrap: [number, number, number] },
    underlays: 0, underlayFails: false };
  const underlay = (surface: THREE.Mesh): SurfaceUnderlay => {
    state.underlays++;
    if (state.underlayFails) throw Error("not over the head");
    const n = surface.geometry.getAttribute("position").count;
    return { colour: new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.4), 3), roughness: new THREE.BufferAttribute(new Float32Array(n).fill(0.6), 1),
      metalness: new THREE.BufferAttribute(new Float32Array(n), 1), evidence: { surface: "core-head" } };
  };
  const ctx: FeatureRendererContext = { renderer, head: parts.head, surfaces: new Map([[EYE_PLATE_SURFACE, parts.plate]]),
    skin: { light: () => state.light, underlay, subscribe: listener => { skinListeners.add(listener); return () => { skinListeners.delete(listener); }; } },
    character: () => ({ identity: null, drawn: [] }), subscribeCharacter: () => () => {},
    lighting: () => ({ preset: "studio" }), subscribeLighting: () => () => {},
    requestFrame: () => { state.frames++; },
    onFrame: listener => { frameListeners.add(listener); return () => { frameListeners.delete(listener); }; } };
  const skinChanged = () => { for (const listener of skinListeners) listener(); };
  return { ctx, parts, state, stats, skinListeners, frameListeners, skinChanged };
}

const COMPLETE = { size: 16, normal: new Uint8Array(16 * 16 * 4), surface: new Uint8Array(16 * 16 * 4) };

test("eye makeup's renderer draws on the core record's eye plate through its port, and every layer change requests a frame", () => {
  const { ctx, parts, state, stats, skinListeners } = context();
  const before = parts.root.children.length;
  const features = createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER]);
  const eye = eyeMakeupRenderer({ feature: id => features.get(id) })!;
  expect(eye.surface).toBe(parts.plate);
  expect(eye.maxTextureSize).toBe(4096);
  // The lit plate joined the head rig beside the anchor surface; the anchor itself is hidden.
  expect(parts.root.children.length).toBe(before + 1);
  expect(parts.plate.visible).toBe(false);
  expect(skinListeners.size).toBe(1);
  // Layer mutators request a frame; the readers do not.
  const frames = state.frames;
  eye.layers.setCanvases([{ width: 16, height: 16 } as HTMLCanvasElement], ["a"]);
  expect(parts.root.children.length).toBe(before + 2);
  expect(state.frames).toBeGreaterThan(frames);
  const afterSet = state.frames;
  eye.layers.needsOptics(0, initialRecipe().layers[0]!, 16);
  eye.layers.needsAlbedo(0, initialRecipe().layers[0]!, 16);
  expect(state.frames).toBe(afterSet);
  eye.layers.updateLayer(0, initialRecipe().layers[0]!, COMPLETE, undefined, true);
  expect(state.frames).toBe(afterSet + 1);
  // The composite is prepared only inside a drawn frame (beforeDraw), once per change: an unchanged stack draws nothing more.
  expect(stats.draws).toBe(0);
  features.beforeDraw();
  const once = stats.draws;
  expect(once).toBeGreaterThan(0);
  expect(state.underlays).toBe(1);
  for (let i = 0; i < 5; i++) features.beforeDraw();
  expect(stats.draws).toBe(once);
  expect((eye.evidence() as { plate: { drawn: boolean; skinLight: boolean }; source: object }).plate).toMatchObject({ drawn: true, skinLight: false });
  // A V switch: the skin's light arrives and the skin under the plate is read again on the next frame (not before).
  state.light = { lobes: { roughness0: 0.97, roughness1: 1.6, weight: 1 }, wrap: [0.3, 0.2, 0.2] };
  ctx.skin.subscribe(() => {});
  for (const listener of [...skinListeners]) listener();
  expect(state.underlays).toBe(1);
  features.beforeDraw();
  expect(state.underlays).toBe(2);
  expect((eye.evidence() as { plate: { skinLight: boolean }; source: object })).toMatchObject({ plate: { skinLight: true }, source: { evidence: { surface: "core-head" } } });
  // A plate not over the drawn head keeps a linear blend per layer and says why.
  state.underlayFails = true;
  for (const listener of [...skinListeners]) listener();
  features.beforeDraw();
  expect(eye.evidence()).toMatchObject({ source: { error: "not over the head" }, plate: { drawn: false } });
  state.underlayFails = false;
  for (const listener of [...skinListeners]) listener();
  features.beforeDraw();
  // A restored context redraws the composite on the next frame.
  const drawn = stats.draws;
  features.contextRestored();
  features.beforeDraw();
  expect(stats.draws).toBeGreaterThan(drawn);
  // Display toggles reach its own materials.
  features.setWireframe(true);
  expect(eye.materials[0]!.wireframe).toBe(true);
  features.setWireframe(false);
  // Disposal leaves the head rig as it found it: no layer, no lit plate, no skin subscription.
  features.dispose();
  expect(parts.root.children.length).toBe(before);
  expect(skinListeners.size).toBe(1);
});

/**
 * A synthetic second feature (a cheek plate): its own surface, cut here as a copy of the head, joins the rig with `morphs` and
 * follows the V's facial shape; it draws in its own render-order band, listens for frames and restores, and supersedes a slot.
 */
function cheekRenderer(log: string[]): FeatureRendererFactory<FeatureRenderer & { surface: THREE.SkinnedMesh; port: SceneHostPort }> {
  return { feature: featureId("cheek-makeup"), create(host) {
    const { head } = host.anchors();
    const surface = new THREE.SkinnedMesh(head.geometry, new THREE.MeshStandardMaterial({ transparent: true }));
    surface.morphTargetDictionary = { ...head.morphTargetDictionary };
    surface.morphTargetInfluences = [0];
    surface.name = "cheek_plate";
    surface.renderOrder = 50;
    const detach = host.attach(surface, { morphs: true });
    const offFrame = host.onFrame(() => log.push("cheek:frame"));
    const offRestore = host.onContextRestored(() => log.push("cheek:restored"));
    return { surface, port: host, supersedes: ["face"],
      beforeDraw: () => log.push("cheek:beforeDraw"),
      setNormals: enabled => log.push(`cheek:normals:${enabled}`),
      evidence: () => ({ surface: surface.name }),
      dispose() { offFrame(); offRestore(); detach(); (surface.material as THREE.Material).dispose(); log.push("cheek:dispose"); } };
  } };
}

test("a second feature adds its own surface through the port beside eye makeup's plate", () => {
  const { ctx, parts, frameListeners } = context();
  const log: string[] = [];
  const before = parts.root.children.length;
  const features = createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER, cheekRenderer(log)]);
  expect(features.features() as string[]).toEqual(["eye-makeup", "cheek-makeup"]);
  const cheek = features.get("cheek-makeup") as ReturnType<ReturnType<typeof cheekRenderer>["create"]>;
  const eye = eyeMakeupRenderer({ feature: id => features.get(id) })!;
  eye.layers.setCanvases([{ width: 16, height: 16 } as HTMLCanvasElement], ["a"]);
  // Both surfaces are on the head rig at once: eye makeup's lit plate and layer, and the cheek plate.
  expect(parts.root.children.length).toBe(before + 3);
  expect(cheek.surface.parent).toBe(parts.head.parent);
  // The cheek plate took the V's facial shape as it joined, and follows it as the head's surfaces do.
  expect(cheek.surface.morphTargetInfluences).toEqual([1]);
  expect(features.followers()).toEqual([cheek.surface]);
  // The host fans its frame preparation, display toggles and restores out to both, in composition order.
  features.beforeDraw();
  features.setNormals(false);
  features.contextRestored();
  expect(log).toEqual(["cheek:beforeDraw", "cheek:normals:false", "cheek:restored"]);
  expect(frameListeners.size).toBe(1);
  expect([...features.superseded()]).toEqual(["face"]);
  expect(features.evidence()).toMatchObject({ "eye-makeup": { plate: {} }, "cheek-makeup": { surface: "cheek_plate" } });
  // A feature's port is the scene port and nothing more: no host internals.
  expect(Object.keys(cheek.port).sort()).toEqual(["anchors", "attach", "character", "feature", "lighting", "onContextRestored", "onFrame",
    "renderer", "requestFrame", "skin", "subscribeCharacter", "subscribeLighting"]);
  expect(cheek.port.feature as string).toBe("cheek-makeup");
  features.dispose();
  expect(log.at(-1)).toBe("cheek:dispose");
  expect(parts.root.children.length).toBe(before);
  expect(frameListeners.size).toBe(0);
});

test("the host releases what a renderer left attached, and a failed creation releases the renderers made before it", () => {
  const { ctx, parts, frameListeners } = context();
  const before = parts.root.children.length;
  const careless: FeatureRendererFactory = { feature: featureId("careless"), create(host) {
    host.attach(new THREE.Mesh());
    host.onFrame(() => {});
    return { dispose() {} };
  } };
  const features = createFeatureRenderers(ctx, [careless]);
  expect(parts.root.children.length).toBe(before + 1);
  features.dispose();
  expect(parts.root.children.length).toBe(before);
  expect(frameListeners.size).toBe(0);
  const log: string[] = [];
  const broken: FeatureRendererFactory = { feature: featureId("broken"), create() { throw Error("no surface"); } };
  expect(() => createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER, cheekRenderer(log), broken])).toThrow("no surface");
  expect(log).toEqual(["cheek:dispose"]);
  expect(parts.root.children.length).toBe(before);
  // One renderer per feature.
  expect(() => createFeatureRenderers(ctx, [cheekRenderer(log), cheekRenderer(log)])).toThrow("two renderers");
  expect(parts.root.children.length).toBe(before);
});
