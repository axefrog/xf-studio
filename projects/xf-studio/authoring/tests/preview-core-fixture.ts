// Synthetic, asset-free stand-ins for WolvenKit's exports of the installed head, eye mesh,
// resolved materials and decoded textures. Shapes follow the real exports; values are made up.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GlbWriter } from "../src/glb";
import { encodePng } from "../src/png";
import { idListSha256, sha256Hex, type EyePlateRecipe } from "../src/eye-plate-recipe";
import { PREVIEW_CORE_RECIPE, type PreviewCoreRecipe } from "../src/preview-core-recipe";
import { createGameAssetExporter, type GameAssetExporter, type UncookRun } from "../src/game-asset-export";
import { depotHash } from "../src/depot-path";

export const GRID = 5;
export const HEAD_VERTICES = GRID * GRID;
export const HEAD_TRIANGLES = (GRID - 1) * (GRID - 1) * 2;
export const PLATE_FACES: [number, number][] = [[2, 5], [10, 11]];

function headIndices(): Uint32Array {
  const out: number[] = [];
  for (let y = 0; y < GRID - 1; y++) for (let x = 0; x < GRID - 1; x++) {
    const a = y * GRID + x, b = a + 1, c = a + GRID, d = c + 1;
    out.push(a, c, b, b, c, d);
  }
  return Uint32Array.from(out);
}

export function plateVertexIds(): number[] {
  const indices = headIndices();
  const faces = PLATE_FACES.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, i) => first + i));
  return [...new Set(faces.flatMap(face => [indices[face * 3]!, indices[face * 3 + 1]!, indices[face * 3 + 2]!]))].sort((a, b) => a - b);
}

export const SOURCE_BYTES = { mesh: Buffer.from("synthetic head mesh"), morph: Buffer.from("synthetic head morph"), eye: Buffer.from("synthetic eye mesh") };

export function fixturePlateRecipe(overrides: Partial<{ meshSha256: string }> = {}): EyePlateRecipe {
  const faces = PLATE_FACES.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, i) => first + i));
  const vertexIds = plateVertexIds();
  return {
    schema: "xfs/eye-plate-recipe-1", id: "fixture-plate", revision: 1, description: "Synthetic plate",
    source: { archiveDirectory: "archive/pc/content", meshDepotPath: "base\\fixture\\head.mesh", morphDepotPath: "base\\fixture\\head_morphs.morphtarget",
      supported: [{ id: "fixture-1", label: "Fixture 1.0", meshSha256: overrides.meshSha256 ?? sha256Hex(SOURCE_BYTES.mesh), morphSha256: sha256Hex(SOURCE_BYTES.morph) }] },
    selection: { renderChunk: 0, faceCount: faces.length, vertexCount: vertexIds.length, morphTargetCount: 2,
      faceIdsSha256: idListSha256(faces), vertexIdsSha256: idListSha256(vertexIds),
      topology: { componentVertexCounts: [vertexIds.length], boundaryEdges: 0, boundaryLoops: 0, nonManifoldEdges: 0 },
      faceRangesInclusive: PLATE_FACES },
    output: { stem: "xfs_fixture", appearance: "xfs_fixture", dropVertexUsages: [], vertexFactory: 0, baseMaterial: "base\\fixture.mt", morphBaseTexture: "base\\fixture.xbm" },
  };
}
export const fixturePreviewRecipe = (plate: EyePlateRecipe): PreviewCoreRecipe => ({ ...PREVIEW_CORE_RECIPE, plateRecipeId: plate.id });

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A bone-bound head with two facial morph targets, shaped like WolvenKit's morph target export. */
export function headGlb(): Uint8Array {
  const writer = new GlbWriter();
  const positions = new Float32Array(HEAD_VERTICES * 3), normals = new Float32Array(HEAD_VERTICES * 3), uvs = new Float32Array(HEAD_VERTICES * 2);
  const joints0 = new Uint16Array(HEAD_VERTICES * 4), weights0 = new Float32Array(HEAD_VERTICES * 4);
  const joints1 = new Uint16Array(HEAD_VERTICES * 4), weights1 = new Float32Array(HEAD_VERTICES * 4);
  const tangents = new Float32Array(HEAD_VERTICES * 4);
  const morphA = new Float32Array(HEAD_VERTICES * 3), morphB = new Float32Array(HEAD_VERTICES * 3), zero = new Float32Array(HEAD_VERTICES * 3);
  for (let v = 0; v < HEAD_VERTICES; v++) {
    const x = v % GRID, y = Math.floor(v / GRID);
    positions.set([-0.1 + x * 0.05, 1.6 + y * 0.05, (x % 2) * 0.04], v * 3);
    normals.set([0, 0, -1], v * 3);
    uvs.set([x / (GRID - 1), y / (GRID - 1)], v * 2);
    joints0.set([0, 1, 0, 0], v * 4); weights0.set([0.5, 0.25, 0, 0], v * 4);
    joints1.set([1, 0, 0, 0], v * 4); weights1.set([0.25, 0, 0, 0], v * 4);
    tangents.set([1, 0, 0, 1], v * 4);
    if (v % 3 === 0) morphA.set([0, 0.001 * v, 0], v * 3);
    if (v === 7) morphB.set([0.002, 0, 0], v * 3);
  }
  const attributes = {
    POSITION: writer.add(positions, "VEC3", { bounds: true }), NORMAL: writer.add(normals, "VEC3"), TANGENT: writer.add(tangents, "VEC4"),
    TEXCOORD_0: writer.add(uvs, "VEC2"), JOINTS_0: writer.add(joints0, "VEC4"), WEIGHTS_0: writer.add(weights0, "VEC4"),
    JOINTS_1: writer.add(joints1, "VEC4"), WEIGHTS_1: writer.add(weights1, "VEC4"),
  };
  const targets = [morphA, morphB].map(delta => ({ POSITION: writer.add(delta, "VEC3", { bounds: true }), NORMAL: writer.add(zero, "VEC3"), TANGENT: writer.add(zero, "VEC3") }));
  const indices = writer.add(headIndices(), "SCALAR");
  const ibm = writer.add(Float32Array.from([...IDENTITY, ...IDENTITY]), "MAT4");
  return writer.toGlb({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 3] }],
    nodes: [{ name: "Armature", children: [1] }, { name: "Head", children: [2] }, { name: "l_eye_JNT" }, { name: "submesh_00_LOD_1", mesh: 0, skin: 0 }],
    skins: [{ joints: [1, 2], inverseBindMatrices: ibm }],
    meshes: [{ name: "submesh_00_LOD_1", primitives: [{ attributes, indices, targets }], extras: { targetNames: ["h011_eyes", "h012_nose"] } }],
  });
}

/** An eye mesh export: a decoy chunk plus the eyeball chunk, skinned at its bind pose. */
export function eyeGlb(options: { offsetBind?: boolean } = {}): Uint8Array {
  const writer = new GlbWriter();
  const quad = (z: number) => {
    const positions = Float32Array.from([-0.03, 1.66, z, -0.01, 1.66, z, -0.03, 1.68, z, 0.01, 1.66, z, 0.03, 1.66, z, 0.01, 1.68, z]);
    return { POSITION: writer.add(positions, "VEC3", { bounds: true }), NORMAL: writer.add(new Float32Array(18).map((_, i) => i % 3 === 2 ? -1 : 0), "VEC3"),
      TEXCOORD_0: writer.add(Float32Array.from([-1.5, 0, -1.2, 0, -1.5, 0.3, 1.2, 0, 1.5, 0, 1.2, 0.3]), "VEC2"),
      JOINTS_0: writer.add(new Uint16Array(24), "VEC4"), WEIGHTS_0: writer.add(new Float32Array(24).map((_, i) => i % 4 === 0 ? 1 : 0), "VEC4") };
  };
  const decoy = quad(0.02), eyeball = quad(0.01);
  const indices = writer.add(Uint16Array.from([0, 1, 2, 3, 4, 5]), "SCALAR");
  const translation = [0, 1.67, 0.01];
  const ibm = writer.add(Float32Array.from([...IDENTITY.slice(0, 12), -translation[0]!, -translation[1]! + (options.offsetBind ? 0.01 : 0), -translation[2]!, 1]), "MAT4");
  return writer.toGlb({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 2, 3] }],
    nodes: [{ name: "Armature", children: [1] }, { name: "l_J_eye_JNT", translation }, { name: "submesh_00_LOD_1_doubled", mesh: 0, skin: 0 },
      { name: "submesh_01_LOD_1", mesh: 1, skin: 0 }],
    skins: [{ joints: [1], inverseBindMatrices: ibm }],
    meshes: [{ name: "submesh_00_LOD_1_doubled", primitives: [{ attributes: decoy, indices }] }, { name: "submesh_01_LOD_1", primitives: [{ attributes: eyeball, indices }] }],
  });
}

const TEXTURES = {
  headAlbedo: "base\\fixture\\textures\\head_d01.xbm", headNormal: "base\\fixture\\textures\\head_n01.xbm",
  headRoughness: "base\\fixture\\textures\\head_rm01.xbm", eyeAlbedo: "base\\fixture\\textures\\eye_d02.xbm",
};
export const materialExports = () => ({
  head: { Materials: [{ Name: "01_ca_pale", BaseMaterial: "base\\fixture\\pale.mi", MaterialTemplate: "base\\materials\\skin.mt",
    Data: { Albedo: TEXTURES.headAlbedo, Normal: TEXTURES.headNormal, Roughness: TEXTURES.headRoughness } }],
    Appearances: { default0: ["01_ca_pale"], "01_ca_pale1": ["01_ca_pale"] } },
  eye: { Materials: [{ Name: "eyelashes_MAT", Data: {} }, { Name: "gradient_brown", BaseMaterial: "base\\fixture\\brown.mi", Data: { Albedo: TEXTURES.eyeAlbedo } }],
    Appearances: { default0: ["default", "default"], gradient_brown1: ["eyelashes_MAT", "gradient_brown"] } },
});

export function texturePng(size: number, kind: "colour" | "normal" | "roughness"): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const x = p % size, y = Math.floor(p / size);
    if (kind === "colour") data.set([180 + (x % 40), 120 + (y % 30), 100, 255], p * 4);
    else if (kind === "normal") data.set([118 + (x % 20), 120 + (y % 16), 0, 255], p * 4);
    else data.set([90 + (x % 100), 0, 240, 255], p * 4);
  }
  return encodePng({ width: size, height: size, data }, { alpha: true });
}

export type FakeExport = { exporter: (cacheRoot: string) => GameAssetExporter; calls: { depotPaths: string[]; withMaterials: boolean }[] };
/** A WolvenKit stand-in that writes the export tree the way `uncook` lays it out. */
/**
 * `omit: "head"` models a game whose archives lack the head; `"head-export"` a head the archives contain but the
 * tool did not export; `"head-mesh-glb"` a partial export (raw and materials without the mesh GLB). `index: false`
 * models an unreadable archive index.
 */
export function fakeUncook(plate: EyePlateRecipe, recipe: PreviewCoreRecipe, options: { omit?: "head" | "head-export" | "head-mesh-glb" | "eye-glb" | "material" | "textures";
  beforeWrite?: (signal?: AbortSignal) => Promise<void>; mesh?: Buffer; eye?: () => Uint8Array; textureSize?: number; index?: boolean;
  tool?: { key: string; label: string } } = {}): FakeExport {
  const calls: FakeExport["calls"] = [];
  const run: UncookRun = async ({ depotPaths, outDir, withMaterials, signal }) => {
    calls.push({ depotPaths: [...depotPaths], withMaterials });
    await options.beforeWrite?.(signal);
    const wanted = new Set(depotPaths);
    const write = (depot: string, bytes: Uint8Array | string) => { const file = join(outDir, ...depot.split("\\")); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
    const size = options.textureSize ?? 256;
    const textures = [[TEXTURES.headAlbedo, "colour"], [TEXTURES.headNormal, "normal"], [TEXTURES.headRoughness, "roughness"], [TEXTURES.eyeAlbedo, "colour"]] as const;
    if (withMaterials) {
      if (options.omit !== "head" && options.omit !== "head-export") {
        write(plate.source.meshDepotPath, options.mesh ?? SOURCE_BYTES.mesh); write(plate.source.morphDepotPath, SOURCE_BYTES.morph);
        if (options.omit !== "head-mesh-glb") write(plate.source.meshDepotPath.replace(/\.mesh$/, ".glb"), "synthetic head mesh glb");
      }
      write(recipe.eye.meshDepotPath, SOURCE_BYTES.eye);
      write(plate.source.morphDepotPath + ".glb", headGlb());
      if (options.omit !== "eye-glb") write(recipe.eye.meshDepotPath.replace(/\.mesh$/, ".glb"), (options.eye ?? eyeGlb)());
      const materials = materialExports();
      if (options.omit !== "material") {
        write(plate.source.meshDepotPath.replace(/\.mesh$/, ".Material.json"), JSON.stringify(materials.head));
        write(recipe.eye.meshDepotPath.replace(/\.mesh$/, ".Material.json"), JSON.stringify(materials.eye));
      }
      // Material export decodes every texture the materials use, like WolvenKit with the game path.
      if (options.omit !== "textures") for (const [depot, kind] of textures) write(depot.replace(/\.xbm$/, ".png"), texturePng(size, kind));
    } else if (options.omit !== "textures") {
      for (const [depot, kind] of textures) if (wanted.has(depot)) write(depot.replace(/\.xbm$/, ".png"), texturePng(size, kind));
    }
  };
  // The archive index lists every resource except a head the game lacks.
  const indexed = new Set([plate.source.meshDepotPath, plate.source.morphDepotPath, recipe.eye.meshDepotPath]
    .filter(depot => options.omit !== "head" || (depot !== plate.source.meshDepotPath && depot !== plate.source.morphDepotPath)).map(depotHash));
  return { calls, exporter: cacheRoot => createGameAssetExporter(cacheRoot, run, {
    tool: options.tool ?? { key: "fixture-tool:1", label: "Fixture exporter 1.0" },
    contains: (_source, hashes) => { if (options.index === false) throw Error("unreadable index"); return new Set(hashes.filter(hash => indexed.has(hash))); } }) };
}
