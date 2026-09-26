/**
 * Browser page for tests/webgl-scene-host.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context). It starts the
 * real scene host (platform/scene/scene-host.ts) on a synthetic head (a small skinned head with one facial target, its eye plate and
 * a rigid eye; no game files) with eye makeup's renderer and a synthetic second feature, then measures:
 * 1. Render on demand: frames drawn while nothing changes, per request, per burst of requests, per layer change, while a (synthetic)
 *    idle plays and after it pauses, and how often the feature renderers' `beforeDraw` ran.
 * 2. Disposal: `renderer.info.memory` (geometries, textures) before any V, with V A, V B, A again, and none; and with makeup layers
 *    and after they are cleared. The V's are real character records loaded through the host's detail loader (a skin on `skin.mt` the
 *    core head wears, eyes on `eye.mt`, a face decal on `mesh_decal.mt`), so their loader-owned resources are what is released.
 * 3. Robustness (PREV-98): the resolved skin on the core head and eye makeup lit with its light; a renderer whose methods throw
 *    (reported once, the others and the host draw on); a lost and restored WebGL context (the composite redraws, frames draw).
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneHost } from "../src/platform/scene/scene-host";
import type { LoadedCoreDetail } from "../src/core-detail-loader";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import type { IdleAnimation } from "../src/idle-animation";
import { GlbWriter } from "../src/glb";
import { CHARACTER_DETAIL_ASSETS, CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type CoreDetail, type RenderComponent, type RenderTexture } from "../src/render-detail";
import { STUDIO_RENDERERS } from "../src/compose/renderers";
import { EYE_MAKEUP_RENDERER } from "../src/features/eye-makeup/render";
import { featureId } from "../src/platform/api";
import type { FeatureRendererFactory } from "../src/platform/api/scene";
import { initialRecipe } from "./fixtures/eye-region";

type Memory = { geometries: number; textures: number };
export type SceneHostProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  features: string[];
  frames: { settled: boolean; idleWindow: number; oneRequest: number; burst: number; layerChange: number; idlePlaying: number; idlePaused: number;
    idleOff: number; beforeDrawPerFrame: boolean; cheekFrames: number };
  memory: { empty: Memory; a: Memory; b: Memory; aAgain: Memory; none: Memory; layers: Memory; layersCleared: Memory };
  limits: { a: unknown; b: unknown };
  character: { a: unknown; b: unknown; none: unknown };
  skin: { mode: unknown; plateSkinLight: unknown; drawn: unknown; defaultAfter: unknown };
  faulty: { reports: string[]; evidence: unknown; framesDrawn: number };
  context: { events: string[]; framesAfter: number; compositeDrawsBefore: number; compositeDrawsAfter: number; plateDrawn: unknown };
  bands: unknown;
  disposed: { canvases: number; features: number };
};
const probe: SceneHostProbe = { ok: false, errors: [], renderer: "", features: [],
  frames: {} as SceneHostProbe["frames"], memory: {} as SceneHostProbe["memory"], limits: { a: null, b: null },
  character: { a: null, b: null, none: null }, skin: { mode: null, plateSkinLight: null, drawn: null, defaultAfter: null },
  faulty: { reports: [], evidence: null, framesDrawn: -1 },
  context: { events: [], framesAfter: -1, compositeDrawsBefore: -1, compositeDrawsAfter: -1, plateDrawn: null },
  bands: null, disposed: { canvases: -1, features: -1 } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");

/** The quads the synthetic head and every decal share, so a decal lies exactly on the head. */
const QUADS = [0, 1, 2].map(c => [c * 0.1, 1.6, 0, c * 0.1 + 0.05, 1.6, 0, c * 0.1, 1.65, 0, c * 0.1 + 0.05, 1.65, 0]);

/** The synthetic head's UVs and triangles (skinned() below), so a skin chunk can be the same surface as the core head. */
const headUvs = (count: number) => Array.from({ length: count }, (_, i) => [(i % 2) * 0.5 + 0.25, 0.2 + Math.floor(i / 2) * 0.05]).flat();
const quadIndices = (count: number) => Array.from({ length: count / 4 }, (_, q) => [q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2]).flat();

/**
 * A WolvenKit-shaped skinned chunk mesh (`submesh_00_LOD_1`) over the given quads, with one facial target. With `head`, it is the synthetic
 * head's own surface (its UVs, triangles and an unmoved target), which the core head can wear (core-head skin placement).
 */
function chunkGlb(quad: number[], head = false): Uint8Array {
  const writer = new GlbWriter();
  const count = quad.length / 3;
  const position = writer.add(Float32Array.from(quad), "VEC3", { bounds: true, target: 34962 });
  const normal = writer.add(Float32Array.from(Array.from({ length: count }, () => [0, 0, -1]).flat()), "VEC3");
  const uv = writer.add(Float32Array.from(head ? headUvs(count) : [0, 0, 1, 0, 0, 1, 1, 1]), "VEC2");
  const joints = writer.add(new Uint16Array(count * 4), "VEC4");
  const weights = writer.add(Float32Array.from(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()), "VEC4");
  const indices = writer.add(Uint16Array.from(quadIndices(count)), "SCALAR", { target: 34963 });
  const target = writer.add(Float32Array.from(head ? new Array(count * 3).fill(0) : [0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "VEC3", { bounds: !head });
  const inverse = writer.add(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), "MAT4");
  return writer.toGlb({ asset: { version: "2.0", generator: "probe" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "Root" }, { name: "submesh_00_LOD_1", mesh: 0, skin: 0 }],
    meshes: [{ name: "submesh_00_LOD_1", extras: { targetNames: ["h001_eyes"] },
      primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv, JOINTS_0: joints, WEIGHTS_0: weights }, indices, material: 0,
        targets: [{ POSITION: target }] }] }],
    materials: [{ name: "m" }], skins: [{ joints: [0], inverseBindMatrices: inverse }] });
}

async function png(colour: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(8, 8), context = canvas.getContext("2d")!;
  context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** A skinned mesh on one bone with the facial target the head carries. */
function skinned(positions: number[], name: string): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(count).fill([0, 0, -1]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(headUvs(count), 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
  geometry.setIndex(quadIndices(count));
  const morph = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
  morph.name = "h001_eyes";
  geometry.morphAttributes.position = [morph];
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.updateMorphTargets();
  return mesh;
}

/** The synthetic core head: head and plate share the head's quads (the plate is a head cut), and a rigid eye. */
function syntheticCore(): LoadedCoreDetail {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "Head";
  root.add(bone);
  const head = skinned(QUADS.flat(), "head"), plate = skinned(QUADS.flat(), "plate");
  for (const mesh of [head, plate]) { root.add(mesh); mesh.bind(new THREE.Skeleton([bone])); mesh.frustumCulled = false; }
  const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshStandardMaterial());
  eyes.name = "eyes"; eyes.position.set(0.05, 1.62, -0.01);
  root.add(eyes);
  const canvasTexture = (colour: string) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!; context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
    const texture = new THREE.CanvasTexture(canvas); texture.flipY = false;
    return texture;
  };
  const record = { schema: "xfs/render-detail-1", detail: "core-head", identity: "probe", origin: "game-files", provenance: { label: "probe", notes: [] },
    geometry: { file: "probe.glb", sha256: "", nodes: { head: "head", plate: "plate", eyes: "eyes" }, morphs: [] },
    textures: {} } as unknown as CoreDetail;
  return { record, gltf: { scene: root } as unknown as LoadedCoreDetail["gltf"], meshes: [head, plate, eyes], head, surfaces: new Map([["plate", plate]]), eyes,
    textures: { "head.albedo": canvasTexture("#c8a090"), "eyes.albedo": canvasTexture("#604030"), "head.normal": canvasTexture("#8080ff"),
      "head.roughness": canvasTexture("#a0a0a0") } };
}

/** A synthetic idle: it animates while enabled and not paused, and asks for frames on each change, as the game idle does. */
function syntheticIdle() {
  const idle = { enabled: false, paused: false, time: 0, bindings: [], unmapped: [], clip: { name: "probe", duration: 1 }, facial: undefined,
    bodyEnabled: true, faceEnabled: true, onChange: undefined as undefined | (() => void),
    update(seconds: number) { idle.time += seconds; }, seek(seconds: number) { idle.time = seconds; },
    setEnabled(enabled: boolean) { idle.enabled = enabled; idle.onChange?.(); }, setPaused(paused: boolean) { idle.paused = paused; idle.onChange?.(); },
    attach() {}, detach() {}, setContributions() {} };
  return idle as unknown as IdleAnimation;
}

/** A second feature's plate: a head-cut surface of its own on the rig, in its own draw-order band, drawn each frame it is asked to. */
function cheekFeature(counter: { beforeDraw: number }): FeatureRendererFactory {
  return { feature: featureId("cheek-makeup"), renderSlots: 2, create(host) {
    const { head } = host.anchors();
    const material = new THREE.MeshStandardMaterial({ color: 0xaa3355, transparent: true, opacity: 0.4, depthWrite: false });
    const surface = new THREE.SkinnedMesh(head.geometry, material);
    surface.bind(head.skeleton, head.bindMatrix);
    surface.morphTargetDictionary = { ...head.morphTargetDictionary };
    surface.morphTargetInfluences = [0];
    surface.renderOrder = host.renderBand.order(0);
    const detach = host.attach(surface, { morphs: true });
    // It replaces a creator option these V's don't use, so their parts all stay drawn.
    host.supersede([{ slot: "face", options: ["probe_lips"] }]);
    return { beforeDraw: () => { counter.beforeDraw++; }, dispose() { detach(); material.dispose(); } };
  } };
}

/** A renderer whose methods throw: the host reports each once and draws on (PREV-94). */
const faultyFeature: FeatureRendererFactory = { feature: featureId("faulty"), create() {
  return { beforeDraw() { throw Error("lost its target"); }, setNormals() { throw Error("no normals"); }, evidence() { throw Error("no evidence"); },
    dispose() {} };
} };

try {
  const element = document.createElement("div");
  element.style.cssText = "width:96px;height:96px";
  document.body.append(element);
  const counter = { beforeDraw: 0 };
  const idle = syntheticIdle();
  const loadMotion: MotionLoader = async () => ({ idle, idleError: "", blink: undefined, blinkError: "No blink in the probe." });
  const contextEvents: string[] = [];
  const host = await createSceneHost(element, { renderers: [...STUDIO_RENDERERS, cheekFeature(counter), faultyFeature], loadCore: async () => syntheticCore(),
    loadMotion, loadLut: async () => ({ lut: null, source: null as never }), onContext: event => { contextEvents.push(event); },
    onRendererError: (feature, method, error) => { probe.faulty.reports.push(`${feature}.${method}: ${(error as Error).message}`); } });
  const gl = host.renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  host.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  probe.features = host.features();
  probe.bands = host.featureBands();
  const frames = () => host.frameTiming().frames;
  const settle = async () => { for (let i = 0; i < 200 && host.frameTiming().running; i++) await sleep(10); await sleep(50); };
  const memory = (): Memory => ({ geometries: host.renderer.info.memory.geometries, textures: host.renderer.info.memory.textures });

  // 1. Render on demand.
  await settle();
  probe.frames.settled = !host.frameTiming().running;
  let start = frames();
  await sleep(400);
  probe.frames.idleWindow = frames() - start;
  const drawsBefore = counter.beforeDraw;
  start = frames();
  host.requestRender();
  await settle();
  probe.frames.oneRequest = frames() - start;
  start = frames();
  for (let i = 0; i < 10; i++) host.requestRender();
  await settle();
  probe.frames.burst = frames() - start;
  const makeup = host.feature(EYE_MAKEUP_RENDERER)!;
  const mask = document.createElement("canvas"); mask.width = mask.height = 16;
  mask.getContext("2d")!.fillRect(0, 0, 16, 16);
  makeup.layers.setCanvases([mask], ["probe"]);
  await settle();
  start = frames();
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  await settle();
  probe.frames.layerChange = frames() - start;
  start = frames();
  host.setIdle(true);
  await sleep(300);
  probe.frames.idlePlaying = frames() - start;
  host.setIdlePaused(true);
  await settle();
  start = frames();
  await sleep(300);
  probe.frames.idlePaused = frames() - start;
  host.setIdlePaused(false);
  host.setIdle(false);
  await settle();
  start = frames();
  await sleep(300);
  probe.frames.idleOff = frames() - start;
  probe.frames.cheekFrames = counter.beforeDraw - drawsBefore;
  // beforeDraw runs exactly once per drawn frame, never on its own.
  const total = frames(), draws = counter.beforeDraw;
  host.requestRender();
  await settle();
  probe.frames.beforeDrawPerFrame = counter.beforeDraw - draws === frames() - total && frames() - total === 1;
  // The faulty renderer threw on every drawn frame and on the normals toggle: reported once each, and every frame above still drew.
  host.setNormals(true);
  await settle();
  probe.faulty.evidence = host.featureEvidence().faulty;
  probe.faulty.framesDrawn = frames();

  // 2. Disposal: V switches through the host's detail loader.
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.memory.empty = memory();
  const files = new Map<string, Uint8Array>();
  const serve = async (bytes: Uint8Array) => { const sha = await hex(bytes), file = `${sha}.bin`; files.set(file, bytes); return { file, sha256: sha }; };
  const fetcher = async (url: string) => {
    const bytes = files.get(url.slice(CHARACTER_DETAIL_ASSETS.length));
    return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
  };
  const texture = async (colour: string): Promise<RenderTexture> => ({ ...await serve(await png(colour)), depotPath: `base\\probe\\${colour}.xbm`,
    width: 8, height: 8, isGamma: true, sources: [] });
  const component = async (slot: "eyes" | "face", option: string, quad: number[], template: string, parameter: string, colour: string): Promise<RenderComponent> => ({
    id: `${slot}:${option}:probe:1`, slot, option, definition: option, component: `probe_${slot}_${option}`,
    geometry: { ...await serve(chunkGlb(quad)), depotPath: `base\\probe\\${slot}_${option}.mesh`, depotHash: "1", morphTargets: true, sources: [] },
    renderChunks: 1, chunks: [0], materials: [{ chunk: 0, name: "m", template, templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
      textures: { [parameter]: await texture(colour) }, profiles: {}, skinProfiles: {}, gradients: {} }] } as RenderComponent);
  const record = async (identity: string, colour: string, second: string): Promise<CharacterDetail> => ({ schema: CHARACTER_DETAIL_SCHEMA, detail: "character",
    identity: identity.repeat(64), origin: "game-files", character: { source: "save", bodyGender: "female" }, provenance: { label: "probe", notes: [] },
    components: [await component("eyes", identity, [0.04, 1.61, -0.02, 0.06, 1.61, -0.02, 0.04, 1.63, -0.02, 0.06, 1.63, -0.02], "base\\materials\\eye.mt", "Albedo", colour),
      await component("face", identity, QUADS[1]!, "base\\materials\\mesh_decal.mt", "DiffuseTexture", second)],
    slots: [{ slot: "eyes", state: "shown", label: "probe" }, { slot: "face", state: "shown", label: "probe" }] } as CharacterDetail);
  // The skin the core head wears: the head's own surface on `skin.mt`, so it is placed on the core head (core-head placement).
  const skinComponent = async (identity: string, colour: string): Promise<RenderComponent> => ({
    id: `skin:${identity}:probe:1`, slot: "skin", option: `skin_${identity}`, definition: `skin_${identity}`, component: "probe_head",
    geometry: { ...await serve(chunkGlb(QUADS.flat(), true)), depotPath: `base\\probe\\head_${identity}.mesh`, depotHash: "2", morphTargets: true, sources: [] },
    renderChunks: 1, chunks: [0], materials: [{ chunk: 0, name: "skin", template: "base\\materials\\skin.mt", templateName: null, materialPriority: "EMP_Normal",
      scalars: {}, colours: {}, textures: { Albedo: await texture(colour), Normal: await texture("#8080ff"), Roughness: await texture("#a0a0a0") },
      profiles: {}, skinProfiles: {}, gradients: {} }] } as RenderComponent);
  const withSkin = async (detail: CharacterDetail, identity: string, colour: string): Promise<CharacterDetail> =>
    ({ ...detail, components: [await skinComponent(identity, colour), ...detail.components],
      slots: [{ slot: "skin", state: "shown", label: "probe" }, ...detail.slots] }) as CharacterDetail;
  const recordA = await withSkin(await record("a", "#336699", "#aa2222"), "a", "#c09080"),
    recordB = await withSkin(await record("b", "#669933", "#2222aa"), "b", "#a07060");
  let shown: Awaited<ReturnType<typeof host.details.load>> | null = null;
  const show = async (next: CharacterDetail | null) => {
    const loaded = next ? await host.details.load(next, { fetcher, reuse: shown }) : null;
    const placed = host.setCharacterDetails(loaded);
    shown = loaded;
    host.requestRender(); await settle();
    return { placed: placed.limits, problems: loaded?.problems ?? [], limits: loaded?.limits ?? [] };
  };
  probe.limits.a = await show(recordA);
  probe.character.a = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.memory.a = memory();
  probe.skin.mode = (host.characterDetailsEvidence() as unknown as { skin: { mode: string } }).skin.mode;
  // Eye makeup lights its plate with the drawn skin's own light once a layer draws on it.
  makeup.layers.setCanvases([mask], ["lit"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  probe.skin.plateSkinLight = (makeup.evidence() as { plate: { skinLight: unknown } }).plate.skinLight;
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.limits.b = await show(recordB);
  probe.character.b = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.memory.b = memory();
  await show(recordA);
  probe.memory.aAgain = memory();
  await show(null);
  probe.character.none = { drawn: host.characterDetailsEvidence().components.map(item => item.slot) };
  probe.skin.defaultAfter = (host.characterDetailsEvidence() as unknown as { skin: { mode: string } }).skin.mode;
  probe.memory.none = memory();
  // Makeup layers allocate and release their own textures the same way.
  makeup.layers.setCanvases([mask, mask], ["one", "two"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  makeup.layers.updateLayer(1, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  probe.memory.layers = memory();
  makeup.layers.setCanvases([], []);
  host.requestRender(); await settle();
  probe.memory.layersCleared = memory();
  // 3. A lost WebGL context comes back: the host redraws, and eye makeup's composite draws again on the next frame (PREV-98).
  await show(recordA);
  makeup.layers.setCanvases([mask], ["restored"]);
  makeup.layers.updateLayer(0, initialRecipe().layers[0]!, undefined, undefined, true);
  host.requestRender(); await settle();
  const compositeDraws = () => (makeup.evidence() as { plate: { compositeDraws: { layerDraws: number } } }).plate.compositeDraws.layerDraws;
  probe.context.compositeDrawsBefore = compositeDraws();
  const lose = host.renderer.getContext().getExtension("WEBGL_lose_context");
  if (lose) {
    const waitFor = async (event: string) => { for (let i = 0; i < 300 && !contextEvents.includes(event); i++) await sleep(10); };
    lose.loseContext(); await waitFor("lost");
    lose.restoreContext(); await waitFor("restored");
    await settle();
    const before = frames();
    host.requestRender(); await settle();
    probe.context.framesAfter = frames() - before;
    probe.context.compositeDrawsAfter = compositeDraws();
    probe.context.plateDrawn = (makeup.evidence() as { plate: { drawn: unknown } }).plate.drawn;
  }
  probe.context.events = [...contextEvents];
  probe.skin.drawn = host.characterDetailsEvidence().components.map(item => item.slot);
  makeup.layers.setCanvases([], []);
  await show(null);
  // 3. Teardown: the canvas and every renderer go with the host.
  host.dispose();
  probe.disposed = { canvases: element.querySelectorAll("canvas").length, features: host.features().length };
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
