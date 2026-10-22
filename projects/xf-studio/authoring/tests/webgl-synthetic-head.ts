/**
 * A synthetic V for the real-GPU probe pages (no game files): a small skinned core head with one facial target, its eye plate and a rigid
 * eye; a synthetic idle; and character records loaded through the host's detail loader (a skin on `skin.mt` the core head wears, eyes on
 * `eye.mt`, a face decal on `mesh_decal.mt`). Shared by tests/webgl-scene-host-probe-page.ts and tests/webgl-scene-dispose-probe-page.ts.
 */
import * as THREE from "three";
import type { LoadedCoreDetail } from "../src/character/render/core-detail-loader";
import type { IdleAnimation } from "../src/animation/render/idle-animation";
import { GlbWriter } from "../src/formats/glb";
import { CHARACTER_DETAIL_ASSETS, CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type CoreDetail, type RenderComponent, type RenderTexture } from "../src/character/render-detail";

const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");

/** The quads the synthetic head and every decal share, so a decal lies exactly on the head. */
export const QUADS = [0, 1, 2].map(c => [c * 0.1, 1.6, 0, c * 0.1 + 0.05, 1.6, 0, c * 0.1, 1.65, 0, c * 0.1 + 0.05, 1.65, 0]);

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

export async function png(colour: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(8, 8), context = canvas.getContext("2d")!;
  context.fillStyle = colour; context.fillRect(0, 0, 8, 8);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** A skinned mesh on one bone with the facial target the head carries; `sets` influence sets of four (the game's heads carry two). */
function skinned(positions: number[], name: string, sets = 1): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(count).fill([0, 0, -1]).flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(headUvs(count), 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4));
  // Further sets as the core loader leaves them (`joints_n`/`weights_n`, all weight on the first set), read by skin.ts `skinSets`.
  for (let n = 1; n < sets; n++) {
    geometry.setAttribute(`joints_${n}`, new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute(`weights_${n}`, new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4));
  }
  geometry.setIndex(quadIndices(count));
  const morph = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
  morph.name = "h001_eyes";
  geometry.morphAttributes.position = [morph];
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.updateMorphTargets();
  return mesh;
}

/**
 * The synthetic core head: head and plate share the head's quads (the plate is a head cut), and a rigid eye. `influenceSets` (default 1)
 * gives the head and plate more skin influence sets, which changes their programs (the skin extension and the full-skin shadow depth).
 */
export function syntheticCore(options: { influenceSets?: number } = {}): LoadedCoreDetail {
  const root = new THREE.Group(), bone = new THREE.Bone();
  bone.name = "Head";
  root.add(bone);
  const sets = options.influenceSets ?? 1;
  const head = skinned(QUADS.flat(), "head", sets), plate = skinned(QUADS.flat(), "plate", sets);
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
  return { record, body: "female", gltf: { scene: root } as unknown as LoadedCoreDetail["gltf"], meshes: [head, plate, eyes], head, surfaces: new Map([["plate", plate]]), eyes,
    textures: { "head.albedo": canvasTexture("#c8a090"), "eyes.albedo": canvasTexture("#604030"), "head.normal": canvasTexture("#8080ff"),
      "head.roughness": canvasTexture("#a0a0a0") } };
}

/** A synthetic idle: it animates while enabled and not paused, and asks for frames on each change, as the game idle does. */
export function syntheticIdle() {
  const idle = { enabled: false, paused: false, time: 0, bindings: [], unmapped: [], clip: { name: "probe", duration: 1 }, facial: undefined,
    bodyEnabled: true, faceEnabled: true, onChange: undefined as undefined | (() => void),
    update(seconds: number) { idle.time += seconds; }, seek(seconds: number) { idle.time = seconds; },
    setEnabled(enabled: boolean) { idle.enabled = enabled; idle.onChange?.(); }, setPaused(paused: boolean) { idle.paused = paused; idle.onChange?.(); },
    attach() {}, detach() {}, setContributions() {},
    offsetAt(_name: string, _time: number, out = new THREE.Vector3()) { return out.set(0, 0, 0); } };
  return idle as unknown as IdleAnimation;
}

/**
 * Two synthetic Vs' character records (A and B) and the fetcher that serves their files, as the host's detail loader reads them: each V has
 * a skin the core head wears, eyes and a face decal, each with its own textures.
 */
export async function syntheticRecords(): Promise<{ fetcher: (url: string) => Promise<Response>; recordA: CharacterDetail; recordB: CharacterDetail }> {
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
  return { fetcher,
    recordA: await withSkin(await record("a", "#336699", "#aa2222"), "a", "#c09080"),
    recordB: await withSkin(await record("b", "#669933", "#2222aa"), "b", "#a07060") };
}
