import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadCharacterDetails } from "../src/character-detail-loader";
import { storeChunkGeometry } from "../src/character-detail-service";
import { GlbWriter, keepGlbMeshes, parseGlb, readAccessor } from "../src/glb";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type RenderComponent } from "../src/render-detail";
import { characterDetailsEvidence } from "../src/scene-evidence";
import { restoreFirstWeights } from "../src/skin";

const root = mkdtempSync(join(tmpdir(), "xfs-chunk-geometry-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * A WolvenKit-shaped morph mesh: `chunks` skinned render chunks named `submesh_<nn>_LOD_1`, each a quad with POSITION,
 * NORMAL, TANGENT, UV, joints and float weights, and two facial targets with POSITION/NORMAL/TANGENT deltas that move
 * only the chunk's first vertex (dense, as WolvenKit writes them).
 */
function morphMesh(chunks = 3): Uint8Array {
  const writer = new GlbWriter();
  const meshes = [], nodes: object[] = [{ name: "Root" }];
  for (let c = 0; c < chunks; c++) {
    const x = c * 0.1;
    const position = writer.add(Float32Array.from([x, 1.6, 0, x + 0.05, 1.6, 0, x, 1.65, 0, x + 0.05, 1.65, 0]), "VEC3", { bounds: true, target: 34962 });
    const normal = writer.add(Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]), "VEC3");
    const tangent = writer.add(Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), "VEC4");
    const uv = writer.add(Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]), "VEC2");
    const joints = writer.add(new Uint16Array(16), "VEC4");
    const weights = writer.add(Float32Array.from([0.7, 0.3, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4");
    const indices = writer.add(Uint16Array.from([0, 1, 2, 1, 3, 2]), "SCALAR", { target: 34963 });
    const delta = (value: number) => Float32Array.from([value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const targets = [0.001 * (c + 1), 0].map(value => ({ POSITION: writer.add(delta(value), "VEC3", { bounds: true }),
      NORMAL: writer.add(delta(value / 2), "VEC3"), TANGENT: writer.add(delta(value / 4), "VEC3") }));
    meshes.push({ name: `submesh_${String(c).padStart(2, "0")}_LOD_1`, extras: { targetNames: ["h001_eyes", "h002_nose"] },
      primitives: [{ attributes: { POSITION: position, NORMAL: normal, TANGENT: tangent, TEXCOORD_0: uv, JOINTS_0: joints, WEIGHTS_0: weights },
        indices, material: 0, targets }] });
    nodes.push({ name: `submesh_${String(c).padStart(2, "0")}_LOD_1`, mesh: c, skin: 0 });
  }
  const inverse = writer.add(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), "MAT4");
  (nodes[0] as { children?: number[] }).children = [];
  return writer.toGlb({ asset: { version: "2.0", generator: "fixture" }, scene: 0, scenes: [{ nodes: [0, ...meshes.map((_, i) => i + 1)] }],
    nodes, meshes, materials: [{ name: "m" }], skins: [{ joints: [0], inverseBindMatrices: inverse }] });
}

describe("only the drawn chunks are served (PREV-53)", () => {
  test("the chunk copy keeps the chosen meshes exactly, stores facial deltas sparsely and leaves out tangent deltas", async () => {
    const whole = morphMesh(3), copy = keepGlbMeshes(whole, mesh => mesh.name === "submesh_01_LOD_1");
    const source = parseGlb(whole), kept = parseGlb(copy);
    expect(copy.byteLength).toBeLessThan(whole.byteLength / 2);
    expect(kept.json.meshes.map((mesh: { name: string }) => mesh.name)).toEqual(["submesh_01_LOD_1"]);
    // Nodes, the skin and the scene are unchanged; a dropped chunk's node stays, empty.
    expect(kept.json.nodes).toHaveLength(source.json.nodes.length);
    expect(kept.json.nodes[1]).toEqual({ name: "submesh_00_LOD_1" });
    expect(kept.json.nodes[2]).toEqual({ name: "submesh_01_LOD_1", mesh: 0, skin: 0 });
    expect(kept.json.meshes[0].extras.targetNames).toEqual(["h001_eyes", "h002_nose"]);
    const before = source.json.meshes[1].primitives[0], after = kept.json.meshes[0].primitives[0];
    for (const name of Object.keys(before.attributes))
      expect(Array.from(readAccessor(kept, after.attributes[name]).array)).toEqual(Array.from(readAccessor(source, before.attributes[name]).array));
    expect(Array.from(readAccessor(kept, after.indices).array)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(after.targets.map((target: object) => Object.keys(target).sort())).toEqual([["NORMAL", "POSITION"], ["NORMAL", "POSITION"]]);
    // Sparse against zero: only the moved vertex is stored; an unmoved target stores nothing.
    expect(kept.json.accessors[after.targets[0].POSITION].sparse.count).toBe(1);
    expect(kept.json.accessors[after.targets[1].POSITION].sparse).toBeUndefined();
    for (const k of [0, 1]) for (const name of ["POSITION", "NORMAL"])
      expect(Array.from(readAccessor(kept, after.targets[k][name]).array)).toEqual(Array.from(readAccessor(source, before.targets[k][name]).array));
    // The copy is deterministic.
    expect(keepGlbMeshes(whole, mesh => mesh.name === "submesh_01_LOD_1")).toEqual(copy);

    // What the renderer reads from it is what it read from the whole file: the chunk, its facial shapes and its own weights.
    const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
    const skinned: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) skinned.push(object); });
    expect(skinned.map(mesh => mesh.name)).toEqual(["submesh_01_LOD_1"]);
    expect(Object.keys(skinned[0]!.morphTargetDictionary!)).toEqual(["h001_eyes", "h002_nose"]);
    expect(skinned[0]!.geometry.morphAttributes.position![0]!.getX(0)).toBeCloseTo(0.002, 7);
    expect(Array.from(restoreFirstWeights(buffer).get("submesh_01_LOD_1")!.slice(0, 4))).toEqual([Math.fround(0.7), Math.fround(0.3), 0, 0]);
  });

  test("the store keys the copy by the export's hash and chunk list, and serves a file it can't read whole", () => {
    const store = join(root, "store"), exported = join(root, "export.glb");
    writeFileSync(exported, morphMesh(3));
    const first = storeChunkGeometry(store, exported, [2, 0, 2]);
    expect(first.trimmed).toBe(true);
    const copy = parseGlb(new Uint8Array(require("node:fs").readFileSync(join(store, "files", first.file))));
    expect(copy.json.meshes.map((mesh: { name: string }) => mesh.name)).toEqual(["submesh_00_LOD_1", "submesh_02_LOD_1"]);
    expect(first.sha256).toBe(createHash("sha256").update(require("node:fs").readFileSync(join(store, "files", first.file))).digest("hex"));
    const keys = readdirSync(join(store, "chunks"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}-0_2-v1\.json$/);
    // Made once: the same export and chunks reuse the stored copy.
    const stamp = statSync(join(store, "chunks", keys[0]!)).mtimeMs;
    expect(storeChunkGeometry(store, exported, [0, 2])).toEqual(first);
    expect(statSync(join(store, "chunks", keys[0]!)).mtimeMs).toBe(stamp);
    // Another chunk list is another copy.
    expect(storeChunkGeometry(store, exported, [1]).file).not.toBe(first.file);
    // Not a GLB: stored whole, and said so.
    const odd = join(root, "odd.glb");
    writeFileSync(odd, "glTF but not really");
    const whole = storeChunkGeometry(store, odd, [0]);
    expect(whole.trimmed).toBe(false);
    expect(existsSync(join(store, "files", whole.file))).toBe(true);
  });
});

describe("the loader parses each geometry file once", () => {
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const component = (option: string, file: string, hash: string, chunks: number[]): RenderComponent => ({
    id: `face:${option}:hx_shared:1`, slot: "face", option, definition: option, component: "hx_shared",
    geometry: { file, sha256: hash, depotPath: "base\\fixture\\hx_shared.mesh", depotHash: "1", morphTargets: true, sources: [] },
    renderChunks: 3, chunks, materials: chunks.map(chunk => ({ chunk, name: "m", template: "base\\materials\\mesh_decal_emissive.mt", templateName: null,
      materialPriority: "EMP_Normal", scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {} })) });
  const record = (components: RenderComponent[]): CharacterDetail => ({ schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: "a".repeat(64),
    origin: "game-files", character: { source: "save", bodyGender: "female" }, provenance: { label: "fixture", notes: [] }, components,
    slots: [{ slot: "face", state: "shown", label: "fixture" }], choices: [] });

  test("two components drawing one file share one parse and its geometry, each with its own objects and skeleton", async () => {
    const bytes = morphMesh(3), file = `${sha(bytes)}.glb`;
    let fetches = 0, parses = 0;
    const parse = GLTFLoader.prototype.parse;
    GLTFLoader.prototype.parse = function (...args: Parameters<typeof parse>) { parses++; return parse.apply(this, args); };
    try {
      const loaded = await loadCharacterDetails(record([component("makeupCheeks_05", file, sha(bytes), [0, 1]), component("cyberware_01", file, sha(bytes), [1])]), {
        anisotropy: 1, context: () => ({ overMakeup: false, profileEncoding: "srgb-decoded" }),
        fetcher: async () => { fetches++; return new Response(bytes.slice()); } });
      expect([fetches, parses]).toEqual([1, 1]);
      expect(loaded.problems).toEqual([]);
      const [a, b] = loaded.components;
      expect(a!.root).not.toBe(b!.root);
      expect(a!.meshes.map(mesh => mesh.name)).toEqual(["detail_face_submesh_00_LOD_1", "detail_face_submesh_01_LOD_1"]);
      expect(b!.meshes.map(mesh => mesh.name)).toEqual(["detail_face_submesh_01_LOD_1"]);
      // Chunk 1 is drawn by both from one geometry, as two objects with their own skeletons and weights.
      expect(b!.meshes[0]).not.toBe(a!.meshes[1]);
      expect(b!.meshes[0]!.geometry).toBe(a!.meshes[1]!.geometry);
      expect(b!.meshes[0]!.skeleton).not.toBe(a!.meshes[1]!.skeleton);
      expect(b!.meshes[0]!.geometry.getAttribute("skinWeight").getX(0)).toBeCloseTo(0.7, 6);
      let disposed = 0;
      a!.meshes[1]!.geometry.addEventListener("dispose", () => disposed++);
      loaded.dispose();
      expect(disposed).toBeGreaterThan(0);
      expect(a!.root.parent).toBeNull();
    } finally { GLTFLoader.prototype.parse = parse; }
  });
});

test("face decal evidence comes from the loaded decal entry, so a V switch in any order keeps it (PREV-51)", () => {
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3)));
  mesh.name = "detail_face_submesh_00_LOD_1";
  const surface = { maxMatchedDistance: 0.0004, unmatched: 0, source: "resolved-skin" as const, surface: "core-head" as const, roughness: "resolved-skin" as const };
  const face = { id: "face:lips:hx:1", slot: "face", option: "makeupLips_01", definition: "d", component: "hx", renderChunks: 1, chunks: [0],
    geometry: { file: "f", sha256: "s", depotPath: "p", depotHash: "1", morphTargets: true, sources: [] },
    materials: [{ chunk: 0, name: "m", template: "base\\materials\\mesh_decal.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
      textures: {}, profiles: {}, skinProfiles: {}, gradients: {} }] } as RenderComponent;
  const rootObject = new THREE.Group(); rootObject.add(mesh);
  const details = { record: { identity: "b".repeat(64), character: { source: "save" }, slots: [] }, problems: [], limits: [], notes: [], dispose() {},
    components: [{ component: face, root: rootObject, meshes: [mesh], bones: [],
      decals: [{ mesh, chunk: face.materials[0]!, handle: { parameters: {}, underlay: true, skinLight: true, setNormals() {} }, surface }] }] } as never;
  const evidence = characterDetailsEvidence({ details, skin: null, head: new THREE.Mesh() });
  expect(evidence.face[0]).toMatchObject({ mesh: mesh.name, underlay: true, surface });
});

test("an unskinned chunk (a framework's rigid linked mesh) is bound whole to one bone and stays where the export placed it", async () => {
  const { bindRigid } = await import("../src/character-detail-loader");
  const THREE = await import("three");
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 1.6, 0.1, 0.01, 1.6, 0.1, 0, 1.61, 0.1], 3));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = "submesh_00_LOD_1";
  mesh.position.set(0.002, 0, 0);
  root.add(mesh);
  const skinned = bindRigid(mesh, root);
  expect(skinned).toBeInstanceOf(THREE.SkinnedMesh);
  expect(skinned.name).toBe("submesh_00_LOD_1");
  expect(mesh.parent).toBeNull();
  expect(skinned.skeleton.bones).toHaveLength(1);
  expect(skinned.morphTargetInfluences).toHaveLength(1);
  // Every vertex fully on the one bone, and the same world position as before.
  expect([...geometry.getAttribute("skinWeight").array].filter((_, i) => i % 4 === 0)).toEqual([1, 1, 1]);
  root.updateMatrixWorld(true);
  skinned.skeleton.update();
  const at = skinned.getVertexPosition(1, new THREE.Vector3()).applyMatrix4(skinned.matrixWorld);
  expect(at.x).toBeCloseTo(0.012, 6);
  expect(at.y).toBeCloseTo(1.6, 6);
});
