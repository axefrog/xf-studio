/**
 * Browser page for tests/webgl-body.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context). It starts the real scene
 * host (platform/scene/scene-host.ts) on a synthetic head (no game files) and loads a synthetic V with a body through the host's detail
 * loader: a body skin on `skin.mt` with a breast shape the record applies, the game's underwear cover (a `mesh_decal` garment with no
 * shape keys of its own) over it, and a rigid nails part (a mesh exported without its skin). It measures:
 * 1. Drawing: the whole-body view frames the body, and the body's pixels differ from the empty stage; the body's shape key is on, the
 *    cover follows it (`xfs_body_shape`), the cover blends against the body skin (no linear fallback), the nails' bone follows.
 * 2. The visibility toggle: hidden, the body's pixels are the empty stage's again, with no GPU memory released or added; shown again, the
 *    frame is the first one.
 * 3. The depth range covers the body only while it shows (the head views keep their planes).
 * 4. Disposal: `renderer.info.memory` before any V, with the V, after a switch to a V without a body and back, and with none.
 * Results land in `window.probe` as plain data.
 */
import * as THREE from "three";
import { createSceneHost } from "../src/platform/scene/scene-host";
import type { LoadedCoreDetail } from "../src/core-detail-loader";
import type { MotionLoader } from "../src/platform/scene/head-rig";
import { GlbWriter } from "../src/glb";
import { CHARACTER_DETAIL_ASSETS, CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type CoreDetail, type RenderComponent, type RenderTexture } from "../src/render-detail";

type Memory = { geometries: number; textures: number };
export type BodyProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string;
  drawn: { bodyPixels: number; differs: boolean; slots: string[]; problems: unknown; limits: unknown; notes: string[] };
  shapes: { body: number | null; cover: number | null; coverKeys: string[] };
  hidden: { differsFromEmpty: boolean; memorySame: boolean; shownAgainSame: boolean };
  depth: { bodyNear: number; bodyFar: number; hiddenNear: number; hiddenFar: number; feetDistance: number };
  memory: { empty: Memory; withBody: Memory; headOnly: Memory; bodyAgain: Memory; none: Memory };
  rigid: { bones: number; follows: boolean };
};
const probe: BodyProbe = { ok: false, errors: [], renderer: "",
  drawn: { bodyPixels: 0, differs: false, slots: [], problems: null, limits: null, notes: [] }, shapes: { body: null, cover: null, coverKeys: [] },
  hidden: { differsFromEmpty: true, memorySame: false, shownAgainSame: false },
  depth: { bodyNear: -1, bodyFar: -1, hiddenNear: -1, hiddenFar: -1, feetDistance: -1 },
  memory: {} as BodyProbe["memory"], rigid: { bones: 0, follows: false } };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");
/** Quads wound to face −z, where the V faces the front camera (as the game's meshes are). */
const quadIndices = (count: number) => Array.from({ length: count / 4 }, (_, q) => [q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3]).flat();

/** A body-sized quad strip standing from the feet to the shoulders, facing the whole-body camera (−z). */
const BODY_QUADS = [0, 1, 2, 3].map(row => [-0.2, row * 0.35, 0, 0.2, row * 0.35, 0, -0.2, row * 0.35 + 0.35, 0, 0.2, row * 0.35 + 0.35, 0]).flat();
/** The underwear cover: the body's second row again, 0.4 mm in front of it. */
const COVER_QUAD = [-0.2, 0.35, -0.0004, 0.2, 0.35, -0.0004, -0.2, 0.7, -0.0004, 0.2, 0.7, -0.0004];
/** The nails: a small quad near the right hand of the rig. */
const NAILS_QUAD = [0.28, 0.7, -0.01, 0.3, 0.7, -0.01, 0.28, 0.72, -0.01, 0.3, 0.72, -0.01];

/**
 * A WolvenKit-shaped chunk mesh (`submesh_00_LOD_1`): skinned to two flat joints under an armature (a driven `Hips` and a helper joint,
 * as the body's exports list every joint flat) unless `rigid`, with the named shape keys (each pushing the second row 3 cm forward).
 */
function chunkGlb(quad: number[], targets: string[], rigid = false): Uint8Array {
  const writer = new GlbWriter(), count = quad.length / 3;
  const position = writer.add(Float32Array.from(quad), "VEC3", { bounds: true, target: 34962 });
  const normal = writer.add(Float32Array.from(Array.from({ length: count }, () => [0, 0, -1]).flat()), "VEC3");
  const uv = writer.add(Float32Array.from(Array.from({ length: count }, (_, i) => [(i % 2) * 0.9 + 0.05, (Math.floor(i / 2) / Math.max(1, count / 2 - 1)) * 0.9 + 0.05]).flat()), "VEC2");
  const indices = writer.add(Uint16Array.from(quadIndices(count)), "SCALAR", { target: 34963 });
  const shape = (i: number) => quad[i * 3 + 1]! >= 0.35 && quad[i * 3 + 1]! <= 0.7 ? [0, 0, -0.03] : [0, 0, 0];
  const morphs = targets.map(() => writer.add(Float32Array.from(Array.from({ length: count }, (_, i) => shape(i)).flat()), "VEC3", { bounds: true }));
  const attributes: Record<string, number> = { POSITION: position, NORMAL: normal, TEXCOORD_0: uv };
  const json: Record<string, unknown> = { asset: { version: "2.0", generator: "probe" }, scene: 0, materials: [{ name: "m" }] };
  if (rigid) {
    json.scenes = [{ nodes: [0] }];
    json.nodes = [{ name: "submesh_00_LOD_1", mesh: 0 }];
  } else {
    attributes.JOINTS_0 = writer.add(new Uint16Array(count * 4), "VEC4");
    attributes.WEIGHTS_0 = writer.add(Float32Array.from(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()), "VEC4");
    const inverse = writer.add(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.1, -0.5, 0, 1]), "MAT4");
    json.scenes = [{ nodes: [0, 3] }];
    json.nodes = [{ name: "Armature", children: [1, 2] }, { name: "Hips" }, { name: "l_helper_JNT", translation: [0.1, 0.5, 0] }, { name: "submesh_00_LOD_1", mesh: 0, skin: 0 }];
    json.skins = [{ joints: [1, 2], inverseBindMatrices: inverse }];
  }
  json.meshes = [{ name: "submesh_00_LOD_1", ...(targets.length ? { extras: { targetNames: targets } } : {}),
    primitives: [{ attributes, indices, material: 0, ...(targets.length ? { targets: morphs.map(POSITION => ({ POSITION })) } : {}) }] }];
  return writer.toGlb(json);
}

async function png(colour: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(8, 8), context = canvas.getContext("2d")!;
  context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** A tiny synthetic core head at the head's height (the body stands below it), with a rigid eye. */
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
  const pixels = () => {
    const canvas = host.renderer.domElement, context = document.createElement("canvas").getContext("2d")!;
    context.canvas.width = canvas.width; context.canvas.height = canvas.height;
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };

  const files = new Map<string, Uint8Array>();
  const serve = async (bytes: Uint8Array) => { const sha = await hex(bytes), file = `${sha}.bin`; files.set(file, bytes); return { file, sha256: sha }; };
  const fetcher = async (url: string) => {
    const bytes = files.get(url.slice(CHARACTER_DETAIL_ASSETS.length));
    return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
  };
  const texture = async (colour: string): Promise<RenderTexture> => ({ ...await serve(await png(colour)), depotPath: `base\\probe\\${colour.slice(1)}.xbm`,
    width: 8, height: 8, isGamma: true, sources: [] });
  const part = async (component: string, option: string, glb: Uint8Array, template: string, textures: Record<string, RenderTexture>, morphs: string[]): Promise<RenderComponent> => ({
    id: `body:${option}:${component}:1`, slot: "body", option, definition: option, component,
    geometry: { ...await serve(glb), depotPath: `base\\probe\\${component}.mesh`, depotHash: "7", morphTargets: false, sources: [] },
    renderChunks: 1, chunks: [0], materials: [{ chunk: 0, name: "m", template, templateName: null, materialPriority: "EMP_Normal", scalars: { DiffuseAlpha: 1 },
      colours: {}, textures, profiles: {}, skinProfiles: {}, gradients: {} }], morphs });
  const skinTextures = { Albedo: await texture("#e0b090"), Normal: await texture("#8080ff"), Roughness: await texture("#a0a0a0") };
  const body = await part("probe_body", "body_color", chunkGlb(BODY_QUADS, ["breast_big_breast", "breast_small_breast"]), "base\\materials\\skin.mt", skinTextures, ["breast_big_breast"]);
  const cover = await part("probe_cover", "underpants", chunkGlb(COVER_QUAD, []), "base\\materials\\mesh_decal.mt", { DiffuseTexture: await texture("#202020") }, []);
  const nails = await part("probe_nails", "nails_color_tpp", chunkGlb(NAILS_QUAD, [], true), "base\\materials\\skin.mt", { ...skinTextures, Albedo: await texture("#aa2244") }, []);
  const record = (identity: string, components: RenderComponent[]): CharacterDetail => ({ schema: CHARACTER_DETAIL_SCHEMA, detail: "character",
    identity: identity.repeat(64), origin: "game-files", character: { source: "save", bodyGender: "female" }, provenance: { label: "probe", notes: [] },
    components, slots: [{ slot: "body", state: components.length ? "shown" : "none", label: "probe" }] } as CharacterDetail);
  const withBody = record("a", [body, nails, cover]), headOnly = record("b", []);
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
  const empty = pixels();
  const hiddenPlanes = { near: host.camera.near, far: host.camera.far };
  const loaded = await show(withBody);
  const first = pixels();
  probe.memory.withBody = memory();
  probe.drawn.bodyPixels = changed(empty, first);
  probe.drawn.differs = probe.drawn.bodyPixels > 0;
  const evidence = host.characterDetailsEvidence();
  probe.drawn.slots = evidence.components.map(item => item.slot);
  probe.drawn.problems = loaded?.problems ?? null;
  probe.drawn.limits = loaded?.limits ?? null;
  probe.drawn.notes = loaded?.notes ?? [];
  const meshOf = (component: string) => loaded!.components.find(item => item.component.component === component)!.meshes[0]!;
  const bodyMesh = meshOf("probe_body"), coverMesh = meshOf("probe_cover"), nailsItem = loaded!.components.find(item => item.component.component === "probe_nails")!;
  probe.shapes.body = bodyMesh.morphTargetInfluences?.[bodyMesh.morphTargetDictionary?.breast_big_breast ?? -1] ?? null;
  probe.shapes.coverKeys = Object.keys(coverMesh.morphTargetDictionary ?? {});
  probe.shapes.cover = coverMesh.morphTargetInfluences?.[coverMesh.morphTargetDictionary?.xfs_body_shape ?? -1] ?? null;
  // The rigid nails get one bone at their centre, which follows the nearest rig segment (no still flag).
  probe.rigid.bones = nailsItem.bones.length;
  probe.rigid.follows = nailsItem.bones.some(bone => bone.userData.xfsFollow === true && bone.position.length() > 0.5);
  probe.depth.bodyNear = host.camera.near; probe.depth.bodyFar = host.camera.far;
  probe.depth.feetDistance = host.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
  probe.depth.hiddenNear = hiddenPlanes.near; probe.depth.hiddenFar = hiddenPlanes.far;

  host.setBody(false);
  host.requestRender(); await settle();
  const hidden = pixels();
  probe.hidden.differsFromEmpty = changed(empty, hidden) > 0;
  probe.hidden.memorySame = JSON.stringify(memory()) === JSON.stringify(probe.memory.withBody);
  host.setBody(true);
  host.requestRender(); await settle();
  probe.hidden.shownAgainSame = changed(first, pixels()) === 0;

  await show(headOnly);
  probe.memory.headOnly = memory();
  await show(withBody);
  probe.memory.bodyAgain = memory();
  await show(null);
  probe.memory.none = memory();
  host.dispose();
  probe.ok = probe.errors.length === 0;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
Object.assign(window, { probe });
