import { expect, test } from "bun:test";
import * as THREE from "three";
import { createFeatureRenderers, type FeatureRendererContext } from "../src/platform/scene/feature-renderers";
import { featureId } from "../src/platform/api";
import { renderBand, type FeatureRenderer, type FeatureRendererFactory, type SceneHostPort, type SurfaceUnderlay } from "../src/platform/api/scene";
import { EYE_MAKEUP_RENDERER, EYE_PLATE_SURFACE } from "../src/features/eye-makeup/render";
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
  const skinListeners = new Set<() => void>(), frameListeners = new Set<(dt: number) => void>(),
    characterListeners = new Set<() => void>(), lightingListeners = new Set<() => void>();
  const state = { frames: 0, light: null as null | { lobes: { roughness0: number; roughness1: number; weight: number }; wrap: [number, number, number] },
    underlays: 0, underlayFails: false, superseded: 0, reports: [] as string[], rig: [] as string[] };
  const underlay = (surface: THREE.Mesh): SurfaceUnderlay => {
    state.underlays++;
    if (state.underlayFails) throw Error("not over the head");
    const n = surface.geometry.getAttribute("position").count;
    return { colour: new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.4), 3), roughness: new THREE.BufferAttribute(new Float32Array(n).fill(0.6), 1),
      metalness: new THREE.BufferAttribute(new Float32Array(n), 1), evidence: { surface: "core-head" } };
  };
  const listen = <T>(set: Set<T>) => (listener: T) => { set.add(listener); return () => { set.delete(listener); }; };
  const ctx: FeatureRendererContext = { renderer, head: parts.head, surfaces: new Map([[EYE_PLATE_SURFACE, parts.plate]]),
    skin: { light: () => state.light, underlay, subscribe: listen(skinListeners) },
    character: () => ({ identity: null, drawn: [] }), subscribeCharacter: listen(characterListeners),
    lighting: () => ({ preset: "studio" }), subscribeLighting: listen(lightingListeners),
    requestFrame: () => { state.frames++; },
    onFrame: listen(frameListeners),
    rig: { attach: bones => state.rig.push(`attach:${bones.map(bone => bone.name).join(",")}`),
      detach: bones => state.rig.push(`detach:${bones.map(bone => bone.name).join(",")}`) },
    supersededChanged: () => { state.superseded++; },
    report: (feature, method, error) => state.reports.push(`${feature}.${method}: ${(error as Error).message}`) };
  const skinChanged = () => { for (const listener of skinListeners) listener(); };
  return { ctx, parts, state, stats, skinListeners, frameListeners, characterListeners, lightingListeners, skinChanged };
}

const COMPLETE = { size: 16, normal: new Uint8Array(16 * 16 * 4), surface: new Uint8Array(16 * 16 * 4) };

test("eye makeup's renderer draws on the core record's eye plate through its port, and every layer change requests a frame", () => {
  const { ctx, parts, state, stats, skinListeners } = context();
  const before = parts.root.children.length;
  const features = createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER]);
  // UI-77: the renderer comes back typed by the factory that made it.
  const eye = features.get(EYE_MAKEUP_RENDERER)!;
  expect(eye.surface).toBe(parts.plate);
  expect(eye.maxTextureSize).toBe(4096);
  // The lit plate joined the head rig beside the anchor surface.
  expect(parts.root.children.length).toBe(before + 1);
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
  expect(skinListeners.size).toBe(0);
});

test("eye makeup reads the platform's plate and never changes it; its meshes draw a geometry of their own over the plate's buffers (PREV-97)", () => {
  const { ctx, parts } = context();
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  let disposed = 0;
  material.addEventListener("dispose", () => { disposed++; });
  parts.plate.material = material; parts.plate.visible = false;
  const attributes = Object.keys(parts.plate.geometry.attributes).sort();
  const features = createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER]);
  const eye = features.get(EYE_MAKEUP_RENDERER)!;
  eye.layers.setCanvases([{ width: 16, height: 16 } as HTMLCanvasElement], ["a"]);
  eye.layers.updateLayer(0, initialRecipe().layers[0]!, COMPLETE, undefined, true);
  features.beforeDraw();
  // The skin underlay landed on the stack's geometry, which shares the plate's buffers and facial influences.
  const layer = eye.plates[0]!;
  expect(layer.geometry).not.toBe(parts.plate.geometry);
  expect(layer.geometry.getAttribute("position")).toBe(parts.plate.geometry.getAttribute("position"));
  expect(layer.geometry.morphAttributes.position![0]).toBe(parts.plate.geometry.morphAttributes.position![0]);
  expect(layer.morphTargetInfluences).toBe(parts.plate.morphTargetInfluences);
  expect(layer.skeleton).toBe(parts.plate.skeleton);
  expect(Object.keys(layer.geometry.attributes)).toContain("xfsUnderlay");
  features.dispose();
  // The plate is exactly as the platform left it: its material (not disposed), visibility and attributes.
  expect(parts.plate.material).toBe(material);
  expect(disposed).toBe(0);
  expect(parts.plate.visible).toBe(false);
  expect(Object.keys(parts.plate.geometry.attributes).sort()).toEqual(attributes);
});

/**
 * A synthetic second feature (a cheek plate): its own surface, cut here as a copy of the head, joins the rig with `morphs` and
 * follows the V's facial shape; it draws in its own render-order band, listens for frames and restores, and supersedes the lips decal.
 */
function cheekRenderer(log: string[], slots = 4): FeatureRendererFactory<FeatureRenderer & { surface: THREE.SkinnedMesh; group: THREE.Group; port: SceneHostPort }> {
  return { feature: featureId("cheek-makeup"), renderSlots: slots, create(host) {
    const { head } = host.anchors();
    const group = new THREE.Group();
    const surface = new THREE.SkinnedMesh(head.geometry, new THREE.MeshStandardMaterial({ transparent: true }));
    surface.morphTargetDictionary = { ...head.morphTargetDictionary };
    surface.morphTargetInfluences = [0];
    surface.name = "cheek_plate";
    surface.renderOrder = host.renderBand.order(0);
    group.add(surface);
    const detach = host.attach(group, { morphs: true });
    const offFrame = host.onFrame(() => log.push("cheek:frame"));
    const offRestore = host.onContextRestored(() => log.push("cheek:restored"));
    host.supersede([{ slot: "face", options: ["lips"] }]);
    return { surface, group, port: host,
      beforeDraw: () => log.push("cheek:beforeDraw"),
      setNormals: enabled => log.push(`cheek:normals:${enabled}`),
      evidence: () => ({ surface: surface.name }),
      dispose() { offFrame(); offRestore(); detach(); (surface.material as THREE.Material).dispose(); log.push("cheek:dispose"); } };
  } };
}

test("a second feature adds its own surface through the port beside eye makeup's plate, in its own draw-order band", () => {
  const { ctx, parts, frameListeners, state } = context();
  const log: string[] = [];
  const before = parts.root.children.length;
  const cheekFactory = cheekRenderer(log);
  const features = createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER, cheekFactory]);
  expect(features.features() as string[]).toEqual(["eye-makeup", "cheek-makeup"]);
  const cheek = features.get(cheekFactory)!;
  const eye = features.get(EYE_MAKEUP_RENDERER)!;
  eye.layers.setCanvases([{ width: 16, height: 16 } as HTMLCanvasElement], ["a"]);
  // Both surfaces are on the head rig at once: eye makeup's lit plate and layer, and the cheek plate.
  expect(parts.root.children.length).toBe(before + 3);
  expect(cheek.group.parent).toBe(parts.head.parent);
  // PREV-91: eye makeup's 32 layer slots take 10 to 41; the cheek's band starts after them.
  expect(features.bands()).toEqual({ "eye-makeup": { first: 10, slots: 32 }, "cheek-makeup": { first: 42, slots: 4 } });
  expect(eye.plates[0]!.renderOrder).toBe(10);
  expect(cheek.surface.renderOrder).toBe(42);
  expect(() => cheek.port.renderBand.order(4)).toThrow("outside");
  // The cheek plate took the V's facial shape as it joined, and follows it as the head's surfaces do.
  expect(cheek.surface.morphTargetInfluences).toEqual([1]);
  expect(features.followers()).toEqual([cheek.surface]);
  // The host fans its frame preparation, display toggles and restores out to both, in composition order.
  features.beforeDraw();
  features.setNormals(false);
  features.contextRestored();
  expect(log).toEqual(["cheek:beforeDraw", "cheek:normals:false", "cheek:restored"]);
  expect(frameListeners.size).toBe(1);
  // PREV-89: it supersedes only the lips decal's components, and saying so while being created needs no separate notice.
  expect(features.superseded()).toEqual([{ slot: "face", options: ["lips"] }]);
  expect(state.superseded).toBe(0);
  expect(features.evidence()).toMatchObject({ "eye-makeup": { plate: {} }, "cheek-makeup": { surface: "cheek_plate" } });
  // A feature's port is the scene port and nothing more: no host internals.
  expect(Object.keys(cheek.port).sort()).toEqual(["anchors", "attach", "character", "feature", "lighting", "onContextRestored", "onFrame",
    "renderBand", "renderer", "requestFrame", "skin", "subscribeCharacter", "subscribeLighting", "supersede"]);
  expect(cheek.port.feature as string).toBe("cheek-makeup");
  // UI-77: a different factory for the same feature is not this renderer.
  expect(features.get(cheekRenderer([]))).toBeUndefined();
  features.dispose();
  expect(log.at(-1)).toBe("cheek:dispose");
  expect(parts.root.children.length).toBe(before);
  expect(frameListeners.size).toBe(0);
  // Its supersede list goes with it, and the host is told.
  expect(features.superseded()).toEqual([]);
  expect(state.superseded).toBe(1);
});

test("supersede lists change while a renderer runs, per component; the host is told only of real changes (PREV-89)", () => {
  const { ctx, state } = context();
  let port!: SceneHostPort;
  const brows: FeatureRendererFactory = { feature: featureId("brows"), create(host) { port = host; return { dispose() {} }; } };
  const features = createFeatureRenderers(ctx, [brows]);
  expect(features.superseded()).toEqual([]);
  // The V's brows are replaced only while the feature has brows of its own.
  port.supersede([{ slot: "brows" }]);
  expect(features.superseded()).toEqual([{ slot: "brows" }]);
  expect(state.superseded).toBe(1);
  port.supersede([{ slot: "brows" }]);
  expect(state.superseded).toBe(1);
  port.supersede([{ slot: "face", options: ["eyebrow_pencil"] }]);
  expect(features.superseded()).toEqual([{ slot: "face", options: ["eyebrow_pencil"] }]);
  port.supersede([]);
  expect(features.superseded()).toEqual([]);
  expect(state.superseded).toBe(3);
  expect(() => port.supersede([{ slot: "tail" as never }])).toThrow("not a character slot");
  features.dispose();
  expect(state.superseded).toBe(3);
});

test("meshes added under a morph-following attachment later take the V's shape and follow it; removed ones stop (PREV-93)", () => {
  const { ctx, parts } = context();
  const cheekFactory = cheekRenderer([]);
  const features = createFeatureRenderers(ctx, [cheekFactory]);
  const cheek = features.get(cheekFactory)!;
  const later = new THREE.SkinnedMesh(parts.head.geometry, new THREE.MeshBasicMaterial());
  later.morphTargetDictionary = { h091_eyes: 0 }; later.morphTargetInfluences = [0];
  cheek.group.add(later);
  // The next drawn frame brings it in with the head's current weights, before the renderers prepare.
  features.beforeDraw();
  expect(later.morphTargetInfluences).toEqual([1]);
  expect(features.followers()).toEqual([cheek.surface, later]);
  cheek.group.remove(later);
  expect(features.followers()).toEqual([cheek.surface]);
  features.dispose();
});

test("bones under an attachment with `rig` join the rig motion, and leave it on detach or disposal (PREV-90)", () => {
  const { ctx, state } = context();
  let detach!: () => void;
  const skeletal: FeatureRendererFactory = { feature: featureId("earrings"), create(host) {
    const root = new THREE.Group(), jaw = new THREE.Bone(), ear = new THREE.Bone();
    jaw.name = "Jaw"; ear.name = "l_ear"; jaw.add(ear); root.add(jaw);
    detach = host.attach(root, { rig: true });
    host.attach(new THREE.Group(), { rig: true });
    return { dispose() {} };
  } };
  const features = createFeatureRenderers(ctx, [skeletal]);
  expect(state.rig).toEqual(["attach:Jaw,l_ear", "attach:"]);
  detach(); detach();
  expect(state.rig).toEqual(["attach:Jaw,l_ear", "attach:", "detach:Jaw,l_ear"]);
  features.dispose();
  // An attachment with no bones has nothing to leave.
  expect(state.rig).toEqual(["attach:Jaw,l_ear", "attach:", "detach:Jaw,l_ear"]);
});

test("the host releases what a renderer left behind, and a failed creation releases its own leftovers and the renderers before it (PREV-92)", () => {
  const { ctx, parts, frameListeners, skinListeners, characterListeners, lightingListeners, state } = context();
  const before = parts.root.children.length;
  const careless: FeatureRendererFactory = { feature: featureId("careless"), create(host) {
    host.attach(new THREE.Mesh());
    host.onFrame(() => {});
    host.skin.subscribe(() => {}); host.subscribeCharacter(() => {}); host.subscribeLighting(() => {});
    return { dispose() {} };
  } };
  const features = createFeatureRenderers(ctx, [careless]);
  expect(parts.root.children.length).toBe(before + 1);
  expect([skinListeners.size, characterListeners.size, lightingListeners.size, frameListeners.size]).toEqual([1, 1, 1, 1]);
  features.dispose();
  expect(parts.root.children.length).toBe(before);
  expect([skinListeners.size, characterListeners.size, lightingListeners.size, frameListeners.size]).toEqual([0, 0, 0, 0]);
  // A renderer that throws after attaching, subscribing, joining the rig and superseding leaves none of it behind.
  const log: string[] = [];
  const halfway: FeatureRendererFactory = { feature: featureId("halfway"), create(host) {
    const bone = new THREE.Bone(); bone.name = "Head";
    const root = new THREE.Group(); root.add(bone);
    host.attach(root, { rig: true, morphs: true });
    host.onFrame(() => {}); host.skin.subscribe(() => {}); host.subscribeCharacter(() => {}); host.subscribeLighting(() => {});
    host.supersede([{ slot: "brows" }]);
    throw Error("no surface");
  } };
  expect(() => createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER, cheekRenderer(log), halfway])).toThrow("no surface");
  expect(log).toEqual(["cheek:dispose"]);
  expect(parts.root.children.length).toBe(before);
  expect([skinListeners.size, characterListeners.size, lightingListeners.size, frameListeners.size]).toEqual([0, 0, 0, 0]);
  expect(state.rig).toEqual(["attach:Head", "detach:Head"]);
  // One renderer per feature, and draw-order slots within the feature-plate range.
  expect(() => createFeatureRenderers(ctx, [cheekRenderer(log), cheekRenderer(log)])).toThrow("two renderers");
  expect(() => createFeatureRenderers(ctx, [EYE_MAKEUP_RENDERER, cheekRenderer(log, 60)])).toThrow("draw order is full");
  expect(parts.root.children.length).toBe(before);
});

test("a renderer that throws is reported once and skipped; the other renderers still prepare and toggle (PREV-94)", () => {
  const { ctx, state } = context();
  const log: string[] = [];
  let failing = true;
  const broken: FeatureRendererFactory = { feature: featureId("broken"), create() {
    return { beforeDraw() { if (failing) throw Error("lost its texture"); log.push("broken:beforeDraw"); },
      setNormals() { throw Error("no normals"); }, evidence() { throw Error("no evidence"); }, dispose() {} };
  } };
  const features = createFeatureRenderers(ctx, [broken, cheekRenderer(log)]);
  features.beforeDraw(); features.beforeDraw();
  features.setNormals(true);
  expect(log).toEqual(["cheek:beforeDraw", "cheek:beforeDraw", "cheek:normals:true"]);
  expect(state.reports).toEqual(["broken.beforeDraw: lost its texture", "broken.setNormals: no normals"]);
  expect(features.evidence()).toMatchObject({ broken: { error: "no evidence" }, "cheek-makeup": { surface: "cheek_plate" } });
  // Once it works again it is heard from again if it fails later.
  failing = false; features.beforeDraw();
  failing = true; features.beforeDraw();
  expect(state.reports).toEqual(["broken.beforeDraw: lost its texture", "broken.setNormals: no normals", "broken.beforeDraw: lost its texture"]);
  features.dispose();
});

test("a render band hands out only its own slots", () => {
  const band = renderBand(42, 3);
  expect([band.order(0), band.order(2)]).toEqual([42, 44]);
  for (const index of [-1, 3, 1.5]) expect(() => band.order(index)).toThrow("outside");
  expect(() => renderBand(10, 0).order(0)).toThrow("outside");
});
