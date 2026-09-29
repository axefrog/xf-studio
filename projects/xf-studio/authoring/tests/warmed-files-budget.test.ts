/**
 * Files the page's warm start read ahead (character-warm-start.ts) count against the load's byte budget as the load's own reads do
 * (PREV-199): a warmed geometry or texture used to be taken without its bytes, so a load could hold more than `MAX_BYTES` once warmed.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadCharacterDetails, parseDetailGeometry, type WarmedFiles } from "../src/character-detail-loader";
import { GlbWriter } from "../src/glb";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type RenderComponent } from "../src/render-detail";

/** One skinned quad chunk, as WolvenKit names render chunks. */
function quadMesh(): Uint8Array {
  const writer = new GlbWriter();
  const position = writer.add(Float32Array.from([0, 1.6, 0, 0.05, 1.6, 0, 0, 1.65, 0, 0.05, 1.65, 0]), "VEC3", { bounds: true, target: 34962 });
  const normal = writer.add(Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]), "VEC3");
  const uv = writer.add(Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]), "VEC2");
  const joints = writer.add(new Uint16Array(16), "VEC4");
  const weights = writer.add(Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4");
  const indices = writer.add(Uint16Array.from([0, 1, 2, 1, 3, 2]), "SCALAR", { target: 34963 });
  const inverse = writer.add(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), "MAT4");
  return writer.toGlb({ asset: { version: "2.0", generator: "fixture" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "Root", children: [] }, { name: "submesh_00_LOD_1", mesh: 0, skin: 0 }],
    meshes: [{ name: "submesh_00_LOD_1", primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv, JOINTS_0: joints, WEIGHTS_0: weights },
      indices, material: 0 }] }], materials: [{ name: "m" }], skins: [{ joints: [0], inverseBindMatrices: inverse }] });
}

test("a warmed geometry's bytes count against the load's byte budget", async () => {
  const bytes = quadMesh(), sha256 = createHash("sha256").update(bytes).digest("hex"), file = `${sha256}.glb`;
  const component: RenderComponent = { id: "face:makeupCheeks_05:hx:1", slot: "face", option: "makeupCheeks_05", definition: "makeupCheeks_05", component: "hx",
    geometry: { file, sha256, depotPath: "base\\fixture\\hx.mesh", depotHash: "1", morphTargets: false, sources: [] }, renderChunks: 1, chunks: [0],
    materials: [{ chunk: 0, name: "m", template: "base\\materials\\mesh_decal_emissive.mt", templateName: null, materialPriority: "EMP_Normal", scalars: {}, colours: {},
      textures: {}, profiles: {}, skinProfiles: {}, gradients: {} }] };
  const record: CharacterDetail = { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: "a".repeat(64), origin: "game-files",
    character: { source: "save", bodyGender: "female" }, provenance: { label: "fixture", notes: [] }, components: [component],
    slots: [{ slot: "face", state: "shown", label: "fixture" }] };
  const load = async (warmedBytes: number) => {
    let fetched = 0;
    const parsed = await parseDetailGeometry(bytes.slice().buffer as ArrayBuffer);
    const warmed: WarmedFiles = { bytes: () => undefined, texture: () => undefined,
      geometry: name => name === file ? Promise.resolve({ ...parsed, bytes: warmedBytes }) : undefined };
    const loaded = await loadCharacterDetails(record, { anisotropy: 1, context: () => ({ overMakeup: false, profileEncoding: "srgb-decoded" }), warmed,
      fetcher: async () => { fetched++; return new Response(bytes.slice()); } });
    return { loaded, fetched };
  };
  // Within the budget: taken as read ahead, nothing fetched again.
  const small = await load(bytes.byteLength);
  expect(small.fetched).toBe(0);
  expect(small.loaded.problems).toEqual([]);
  expect(small.loaded.components).toHaveLength(1);
  // Read ahead from a file larger than the load may hold (as the loader's own read would have been): refused as the load's own is.
  const large = await load(300 * 1024 * 1024);
  expect(large.loaded.components).toHaveLength(0);
  expect(large.loaded.problems.map(problem => problem.slot)).toEqual(["face"]);
});
