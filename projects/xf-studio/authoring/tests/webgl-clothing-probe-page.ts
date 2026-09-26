/**
 * Browser page for tests/webgl-clothing.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context). It starts the real scene
 * host on a synthetic head (no game files) and loads a synthetic V through the host's detail loader: a two-chunk body on `skin.mt` whose
 * torso chunk the record leaves out (as the host does when a worn item's tag hides it), and two garments on `multilayered.mt` (a one-layer
 * stack, baked by the layered adapter), both from one exported file (so their geometry is shared, and each must get its own body shape key),
 * coincident with the body's legs row.
 * It measures:
 * 1. Drawing: every program compiles; the garments draw; where two layers coincide the higher layer score wins the depth test (its colour
 *    shows), and the inner layer wins over the body; the left-out body chunk draws nothing (the empty stage shows there).
 * 2. Shape: a garment without shape keys of its own follows the body's applied shape (`xfs_body_shape`).
 * 3. The Body toggle hides the clothes with the body and shows them again unchanged, with no GPU memory released or added.
 * 4. Disposal: `renderer.info.memory` before any V, with the clothes, after a switch to the V without them and back, and with none, twice
 *    (the layered bake keeps one kit per renderer, so the second round must end where the first did).
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneHost } from "../src/platform/scene/scene-host";
import type { LoadedCoreDetail } from "../src/core-detail-loader";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import { GlbWriter } from "../src/glb";
import { CHARACTER_DETAIL_ASSETS, CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type CoreDetail, type RenderComponent, type RenderLayer,
  type RenderTexture } from "../src/render-detail";

type Memory = { geometries: number; textures: number };
type Colour = [number, number, number];
export type ClothingProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  drawn: { slots: string[]; problems: unknown; limits: unknown; notes: string[]; bakes: string[] };
  /** Pixels read at fixed points of the whole-body view: the empty stage, the body only, and with the clothes. */
  colours: { overlapWithClothes: Colour; overlapEmpty: Colour; legsWithClothes: Colour; legsBodyOnly: Colour; torsoWithClothes: Colour; torsoEmpty: Colour };
  shapes: { garmentKeys: string[]; garment: number | null };
  hidden: { clothesHidden: boolean; memorySame: boolean; shownAgainSame: boolean };
  /** A clothing change that re-masks the body: the body loads again, the garments (same body shape) are kept (PREV-106). */
  reuse: { garmentsKept: boolean; bodyLoaded: boolean; reused: number };
  memory: { empty: Memory; withClothes: Memory; bodyOnly: Memory; clothesAgain: Memory; none: Memory; noneAgain: Memory };
};
const probe: ClothingProbe = { ok: false, errors: [], renderer: "", drawn: { slots: [], problems: null, limits: null, notes: [], bakes: [] },
  colours: {} as ClothingProbe["colours"], shapes: { garmentKeys: [], garment: null },
  hidden: { clothesHidden: false, memorySame: false, shownAgainSame: false }, reuse: { garmentsKept: false, bodyLoaded: false, reused: 0 },
  memory: {} as ClothingProbe["memory"] };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");
const quadIndices = (count: number) => Array.from({ length: count / 4 }, (_, q) => [q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3]).flat();
/** One quad facing −z from `y0` to `y1`, `width` wide, at depth `z`. */
const quad = (y0: number, y1: number, width = 0.4, z = 0) => [-width / 2, y0, z, width / 2, y0, z, -width / 2, y1, z, width / 2, y1, z];

/**
 * A WolvenKit-shaped export with one mesh per chunk (`submesh_0N_LOD_1`), skinned to a flat `Hips` joint under an armature, with the named
 * shape keys (each pushing the torso rows 3 cm forward).
 */
function chunksGlb(chunks: number[][], targets: string[] = []): Uint8Array {
  const writer = new GlbWriter();
  const json: Record<string, unknown> = { asset: { version: "2.0", generator: "probe" }, scene: 0, materials: [{ name: "m" }] };
  const meshes: object[] = [], nodes: object[] = [{ name: "Armature", children: [1] }, { name: "Hips" }];
  const inverse = writer.add(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), "MAT4");
  chunks.forEach((points, chunk) => {
    const count = points.length / 3;
    const position = writer.add(Float32Array.from(points), "VEC3", { bounds: true, target: 34962 });
    const normal = writer.add(Float32Array.from(Array.from({ length: count }, () => [0, 0, -1]).flat()), "VEC3");
    const uv = writer.add(Float32Array.from(Array.from({ length: count }, (_, i) => [(i % 2) * 0.9 + 0.05, Math.floor(i / 2) * 0.9 + 0.05]).flat()), "VEC2");
    const indices = writer.add(Uint16Array.from(quadIndices(count)), "SCALAR", { target: 34963 });
    const shape = (i: number) => points[i * 3 + 1]! >= 0.7 ? [0, 0, -0.03] : [0, 0, 0];
    const morphs = targets.map(() => writer.add(Float32Array.from(Array.from({ length: count }, (_, i) => shape(i)).flat()), "VEC3", { bounds: true }));
    const attributes: Record<string, number> = { POSITION: position, NORMAL: normal, TEXCOORD_0: uv,
      JOINTS_0: writer.add(new Uint16Array(count * 4), "VEC4"), WEIGHTS_0: writer.add(Float32Array.from(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()), "VEC4") };
    const name = `submesh_${String(chunk).padStart(2, "0")}_LOD_1`;
    meshes.push({ name, ...(targets.length ? { extras: { targetNames: targets } } : {}),
      primitives: [{ attributes, indices, material: 0, ...(targets.length ? { targets: morphs.map(POSITION => ({ POSITION })) } : {}) }] });
    nodes.push({ name, mesh: chunk, skin: 0 });
  });
  json.scenes = [{ nodes: [0, ...chunks.map((_, chunk) => 2 + chunk)] }];
  json.nodes = nodes; json.meshes = meshes;
  json.skins = [{ joints: [1], inverseBindMatrices: inverse }];
  return writer.toGlb(json);
}

async function png(colour: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(8, 8), context = canvas.getContext("2d")!;
  context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** A tiny synthetic core head at the head's height (the body stands below it). */
function syntheticCore(): LoadedCoreDetail {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "Head"; root.add(bone);
  const skinnedMesh = (name: string) => {
    const geometry = new THREE.PlaneGeometry(0.12, 0.16).translate(0, 1.62, 0);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3)];
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = name; mesh.morphTargetDictionary = { h001_eyes: 0 }; mesh.morphTargetInfluences = [0];
    root.add(mesh); mesh.bind(new THREE.Skeleton([bone])); mesh.frustumCulled = false;
    return mesh;
  };
  const head = skinnedMesh("head"), plate = skinnedMesh("plate");
  const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshStandardMaterial());
  eyes.name = "eyes"; eyes.position.set(0.03, 1.64, -0.01); root.add(eyes);
  const texture = (colour: string) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!; context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
    const out = new THREE.CanvasTexture(canvas); out.flipY = false; return out;
  };
  const record = { schema: "xfs/render-detail-1", detail: "core-head", identity: "probe", origin: "game-files", provenance: { label: "probe", notes: [] },
    geometry: { file: "probe.glb", sha256: "", nodes: { head: "head", plate: "plate", eyes: "eyes" }, morphs: [] }, textures: {} } as unknown as CoreDetail;
  return { record, gltf: { scene: root } as unknown as LoadedCoreDetail["gltf"], meshes: [head, plate, eyes], head, surfaces: new Map([["plate", plate]]), eyes,
    textures: { "head.albedo": texture("#c8a090"), "eyes.albedo": texture("#604030"), "head.normal": texture("#8080ff"), "head.roughness": texture("#a0a0a0") } };
}

try {
  const element = document.createElement("div");
  element.style.cssText = "width:120px;height:160px";
  document.body.append(element);
  const loadMotion: MotionLoader = async () => ({ idle: undefined, idleError: "No idle in the probe.", blink: undefined, blinkError: "No blink in the probe." });
  const host = await createSceneHost(element, { renderers: [], loadCore: async () => syntheticCore(), loadMotion, loadLut: async () => ({ lut: null, source: null as never }) });
  const gl = host.renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  host.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
    probe.errors.push(`${context.getProgramInfoLog(program) ?? ""} ${context.getShaderInfoLog(vertex) ?? ""} ${context.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const settle = async () => { for (let i = 0; i < 200 && host.frameTiming().running; i++) await sleep(10); await sleep(50); };
  const memory = (): Memory => ({ geometries: host.renderer.info.memory.geometries, textures: host.renderer.info.memory.textures });
  const frame = () => {
    const canvas = host.renderer.domElement, context = document.createElement("canvas").getContext("2d")!;
    context.canvas.width = canvas.width; context.canvas.height = canvas.height;
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  };
  /** The frame's colour where a world point projects. */
  const at = (image: ImageData, point: [number, number, number]): Colour => {
    const v = new THREE.Vector3(...point).project(host.camera);
    const x = Math.round((v.x + 1) / 2 * (image.width - 1)), y = Math.round((1 - v.y) / 2 * (image.height - 1));
    const i = (y * image.width + x) * 4;
    return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
  };
  const same = (a: ImageData, b: ImageData) => a.data.every((value, i) => value === b.data[i]);

  const files = new Map<string, Uint8Array>();
  const serve = async (bytes: Uint8Array) => { const sha = await hex(bytes), file = `${sha}.bin`; files.set(file, bytes); return { file, sha256: sha }; };
  const fetcher = async (url: string) => {
    const bytes = files.get(url.slice(CHARACTER_DETAIL_ASSETS.length));
    return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
  };
  const texture = async (colour: string): Promise<RenderTexture> => ({ ...await serve(await png(colour)), depotPath: `base\\probe\\${colour.slice(1)}.xbm`,
    width: 8, height: 8, isGamma: true, sources: [] });
  const layer = async (colour: string): Promise<RenderLayer> => ({ template: { depotPath: "base\\probe\\cloth.mltemplate", archive: null, sha256: null },
    opacity: 1, matTile: 1, tilingMultiplier: 1, offsetU: 0, offsetV: 0, mbTile: 1, microblendContrast: 1, microblendNormalStrength: 0, microblendOffsetU: 0,
    microblendOffsetV: 0, colorScale: [1, 1, 1], normalStrength: 0, roughLevelsIn: [0, 1], roughLevelsOut: [0.5, 0.5], metalLevelsIn: [0, 1], metalLevelsOut: [0, 0],
    colorMaskLevelsIn: [0, 1], colorMaskLevelsOut: [0, 1], names: { colorScale: "white", normalStrength: "0", roughLevelsIn: "a", roughLevelsOut: "b", metalLevelsIn: "c",
      metalLevelsOut: "d" }, textures: { color: await texture(colour) } });
  const skinTextures = { Albedo: await texture("#e0b090"), Normal: await texture("#8080ff"), Roughness: await texture("#a0a0a0") };
  // Rows: legs 0–0.7, torso 0.7–1.4. The record leaves the torso chunk (0) out, as a worn item's `hide_Torso` makes the host do.
  const body: RenderComponent = { id: "body:body_color:probe_body:1", slot: "body", option: "body_color", definition: "body", component: "probe_body",
    geometry: { ...await serve(chunksGlb([quad(0.7, 1.4), quad(0, 0.7)], ["breast_big_breast"])), depotPath: "base\\probe\\body.mesh", depotHash: "7", morphTargets: false, sources: [] },
    renderChunks: 2, chunks: [1], materials: [{ chunk: 1, name: "m", template: "base\\materials\\skin.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {},
      colours: {}, textures: skinTextures, profiles: {}, skinProfiles: {}, gradients: {} }], morphs: ["breast_big_breast"] };
  const garment = async (name: string, area: string, layerScore: number, points: number[], colour: string): Promise<RenderComponent> => ({
    id: `clothing:${area}:${name}:8`, slot: "clothing", option: area, definition: name, component: name,
    geometry: { ...await serve(chunksGlb([points])), depotPath: `base\\probe\\${name}.mesh`, depotHash: String(8 + layerScore), morphTargets: false, sources: [] },
    renderChunks: 1, chunks: [0], materials: [{ chunk: 0, name: "ml", template: "engine\\materials\\multilayered.mt", templateName: "multilayered",
      materialPriority: "EMP_Normal", scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {},
      layered: { setup: { depotPath: `base\\probe\\${name}.mlsetup`, archive: null, sha256: null }, mask: null, ratio: 1, useNormal: false, layers: [await layer(colour)] } }],
    garment: { area, item: String(1000 + layerScore), layer: layerScore } });
  // Both layers cover the legs row exactly (coincident surfaces, which the body's carried-over shape moves alike).
  const inner = await garment("l1_probe_pants", "Legs", 60, quad(0, 0.7), "#d02020");
  const outer = await garment("t2_probe_coat", "OuterChest", 1120, quad(0, 0.7), "#2040d0");
  const record = (identity: string, components: RenderComponent[]): CharacterDetail => ({ schema: CHARACTER_DETAIL_SCHEMA, detail: "character",
    identity: identity.repeat(64), origin: "game-files", character: { source: "save", bodyGender: "female" }, provenance: { label: "probe", notes: [] },
    components, slots: [{ slot: "body", state: "shown", label: "probe" }, { slot: "clothing", state: components.length > 1 ? "shown" : "none", label: "probe" }] } as CharacterDetail);
  const withClothes = record("a", [body, outer, inner]), bodyOnly = record("b", [body]), innerOnly = record("c", [body, inner]);
  let shown: Awaited<ReturnType<typeof host.details.load>> | null = null;
  const show = async (next: CharacterDetail | null) => {
    const loaded = next ? await host.details.load(next, { fetcher, reuse: shown }) : null;
    host.setCharacterDetails(loaded);
    shown = loaded;
    host.requestRender(); await settle();
    return loaded;
  };

  host.frameBody();
  host.requestRender(); await settle();
  probe.memory.empty = memory();
  const empty = frame();
  const OVERLAP: [number, number, number] = [0, 0.5, 0], LEGS: [number, number, number] = [0, 0.3, 0], TORSO: [number, number, number] = [0, 1.1, 0];
  const loaded = await show(withClothes);
  const clothed = frame();
  probe.memory.withClothes = memory();
  const evidence = host.characterDetailsEvidence();
  probe.drawn.slots = evidence.components.map(item => item.slot);
  probe.drawn.problems = loaded?.problems ?? null;
  probe.drawn.limits = loaded?.limits ?? null;
  probe.drawn.notes = loaded?.notes ?? [];
  probe.drawn.bakes = loaded!.components.flatMap(item => (item.layered ?? []).map(entry => entry.handle.state));

  probe.colours.overlapWithClothes = at(clothed, OVERLAP); probe.colours.overlapEmpty = at(empty, OVERLAP);
  probe.colours.torsoWithClothes = at(clothed, TORSO); probe.colours.torsoEmpty = at(empty, TORSO);
  const coatMesh = loaded!.components.find(item => item.component.component === "t2_probe_coat")!.meshes[0]!;
  probe.shapes.garmentKeys = Object.keys(coatMesh.morphTargetDictionary ?? {});
  probe.shapes.garment = coatMesh.morphTargetInfluences?.[coatMesh.morphTargetDictionary?.xfs_body_shape ?? -1] ?? null;

  host.setBody(false);
  host.requestRender(); await settle();
  probe.hidden.clothesHidden = same(frame(), empty);
  probe.hidden.memorySame = JSON.stringify(memory()) === JSON.stringify(probe.memory.withClothes);
  host.setBody(true);
  host.requestRender(); await settle();
  probe.hidden.shownAgainSame = same(frame(), clothed);

  await show(innerOnly);
  probe.colours.legsWithClothes = at(frame(), LEGS);
  await show(bodyOnly);
  probe.memory.bodyOnly = memory();
  probe.colours.legsBodyOnly = at(frame(), LEGS);
  const again = await show(withClothes);
  probe.memory.clothesAgain = memory();
  // The same clothes with the torso chunk shown again (another item's hiding tag gone): the body's chunk mask changed, its shape didn't.
  const garments = again!.components.filter(item => item.component.slot === "clothing");
  const remasked: RenderComponent = { ...body, chunks: [0, 1], materials: [0, 1].map(chunk => ({ ...body.materials[0]!, chunk })) };
  const after = await show(record("d", [remasked, outer, inner]));
  probe.reuse = { garmentsKept: after!.components.filter(item => item.component.slot === "clothing").every(item => garments.includes(item)) && garments.length === 2,
    bodyLoaded: !again!.components.some(item => item.component.slot === "body" && after!.components.includes(item)), reused: after!.reused };
  await show(null);
  probe.memory.none = memory();
  // A second round: the layered bake keeps one kit per renderer for its life, so only growth between rounds is a leak.
  await show(withClothes);
  await show(null);
  probe.memory.noneAgain = memory();
  host.dispose();
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
