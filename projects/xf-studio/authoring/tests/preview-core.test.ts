import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessorFloats, GlbWriter, parseGlb, readAccessor } from "../src/glb";
import { decodePng, encodePng } from "../src/png";
import { adaptMap, checkMap } from "../src/preview-core-maps";
import { appearanceMaterials, decodedTexturePath, parseMaterialExport, resolveTextureParameter } from "../src/preview-core-materials";
import { assemblePreviewGlb, bindPoseDeviation, plateSelection, verifyPreviewGlb } from "../src/preview-core-assemble";
import { ensurePreviewCore, PreviewCoreCache, PreviewCoreError, previewCoreReadiness } from "../src/preview-core-service";
import { uncookArguments } from "../src/game-asset-export-wolvenkit";
import { createGameAssetExporter, GameAssetExportError, gameContentSource } from "../src/game-asset-export";
import { PREVIEW_CORE_FILES } from "../src/preview-core-recipe";
import {
  EYE_MORPH_LIFT, eyeGlb, eyeMorphGlb, fakeUncook, fixturePlateRecipe, fixturePreviewRecipe, headGlb, HEAD_TRIANGLES, HEAD_VERTICES, materialExports, plateVertexIds,
} from "./preview-core-fixture";

const roots: string[] = [];
const temporary = (label: string) => { const root = mkdtempSync(join(tmpdir(), `xfs-preview-${label}-`)); roots.push(root); return root; };
/** Each scenario gets its own export cache, so one fake's exports never leak into another. */
const fresh = (fake: { exporter: (root: string) => any }) => fake.exporter(temporary("exports"));
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
/** A stand-in game folder: readiness only needs the content archive directory to exist. */
function gameFolder() {
  const root = temporary("game");
  const content = join(root, "archive", "pc", "content");
  require("node:fs").mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "basegame_4_appearance.archive"), "archive");
  return root;
}

test("PNG codec round-trips RGB and RGBA and rejects corruption", () => {
  const data = new Uint8Array(4 * 3 * 4).map((_, i) => (i * 37) & 255);
  const image = { width: 4, height: 3, data };
  const rgba = decodePng(encodePng(image, { alpha: true }));
  expect(Buffer.compare(Buffer.from(rgba.data), Buffer.from(data))).toBe(0);
  const rgb = decodePng(encodePng(image, { alpha: false }));
  for (let p = 0; p < 12; p++) expect([...rgb.data.subarray(p * 4, p * 4 + 4)]).toEqual([data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!, 255]);
  expect(Buffer.compare(Buffer.from(encodePng(image, { alpha: false })), Buffer.from(encodePng(image, { alpha: false })))).toBe(0);
  const broken = encodePng(image, { alpha: true });
  broken[40] ^= 0xff;
  expect(() => decodePng(broken)).toThrow();
  expect(() => decodePng(new Uint8Array(40))).toThrow("Not a PNG");
});

test("map adapters keep colour, rebuild normal Z and move roughness R into every channel", () => {
  const data = Uint8Array.from([200, 100, 50, 7, 128, 128, 0, 255, 255, 128, 0, 255, 60, 0, 240, 255]);
  const image = { width: 2, height: 2, data };
  expect([...adaptMap(image, "colour-copy").data.subarray(0, 4)]).toEqual([200, 100, 50, 255]);
  const normal = adaptMap(image, "packed-normal").data;
  expect([...normal.subarray(4, 8)]).toEqual([128, 128, 255, 255]);
  expect([...normal.subarray(8, 12)]).toEqual([255, 128, 128, 255]);
  expect([...adaptMap(image, "red-to-grey").data.subarray(12, 16)]).toEqual([60, 60, 60, 255]);
  expect(checkMap(image, "colour-copy")[0]).toMatch(/square power of two/);
  const flat = { width: 256, height: 256, data: new Uint8Array(256 * 256 * 4).fill(9) };
  expect(checkMap(flat, "colour-copy")).toContain("map has no variation");
});

test("material exports resolve one appearance chunk to a texture depot path", () => {
  const doc = parseMaterialExport(materialExports().head);
  expect(appearanceMaterials(doc, "default")).toEqual(["01_ca_pale"]);
  expect(resolveTextureParameter(doc, "default", 0, "Roughness")).toMatchObject({ material: "01_ca_pale", depotPath: "base\\fixture\\textures\\head_rm01.xbm" });
  expect(() => resolveTextureParameter(doc, "default", 1, "Albedo")).toThrow("no chunk 1");
  expect(() => resolveTextureParameter(doc, "missing", 0, "Albedo")).toThrow("is missing");
  expect(() => resolveTextureParameter(doc, "default", 0, "Blick")).toThrow("no texture");
  // `default` must not match `default_red3`, and `default0` plus `default12` would be ambiguous.
  expect(() => appearanceMaterials(parseMaterialExport({ Materials: [], Appearances: { default0: ["a"], default12: ["b"] } }), "default")).toThrow("ambiguous");
  expect(appearanceMaterials(parseMaterialExport({ Materials: [], Appearances: { default_red3: ["x"], default0: ["a"] } }), "default")).toEqual(["a"]);
  expect(() => resolveTextureParameter(parseMaterialExport({ Materials: [{ Name: "m", Data: { Albedo: "..\\evil.xbm" } }], Appearances: { a0: ["m"] } }), "a", 0, "Albedo")).toThrow();
  expect(decodedTexturePath("base\\a\\b.xbm")).toEqual(["base", "a", "b.png"]);
  expect(() => parseMaterialExport({})).toThrow();
});

test("GLB writer and reader round-trip dense and sparse accessors deterministically", () => {
  const build = () => {
    const writer = new GlbWriter();
    const dense = writer.add(Float32Array.from([1, 2, 3, 4, 5, 6]), "VEC3", { bounds: true });
    const sparse = writer.addSparse(Float32Array.from([0, 0, 0, 0.5, 0, -1, 0, 0, 0]), "VEC3");
    const empty = writer.addSparse(new Float32Array(6), "VEC3");
    return { bytes: writer.toGlb({ asset: { version: "2.0" } }), dense, sparse, empty };
  };
  const { bytes, dense, sparse, empty } = build();
  expect(Buffer.compare(Buffer.from(bytes), Buffer.from(build().bytes))).toBe(0);
  const glb = parseGlb(bytes);
  expect(glb.json.accessors[dense]).toMatchObject({ min: [1, 2, 3], max: [4, 5, 6] });
  expect([...readAccessor(glb, sparse).array]).toEqual([0, 0, 0, 0.5, 0, -1, 0, 0, 0]);
  expect(glb.json.accessors[sparse].sparse.count).toBe(1);
  expect([...readAccessor(glb, empty).array]).toEqual([0, 0, 0, 0, 0, 0]);
  expect(glb.json.accessors[empty].sparse).toBeUndefined();
  expect(() => parseGlb(bytes.subarray(0, 30))).toThrow();
});

test("assembly builds head, plate and eyes from the exports with the plate recipe's rows", () => {
  const plate = fixturePlateRecipe();
  const { glb, report } = assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb());
  expect(report.head).toEqual({ vertices: HEAD_VERTICES, triangles: HEAD_TRIANGLES, joints: 2, morphTargets: 2, influenceSets: 2 });
  expect(report.plate).toEqual({ vertices: plateVertexIds().length, triangles: 6, morphTargets: 2 });
  expect(report.eyes).toMatchObject({ vertices: 6, triangles: 2, uv0Min: [-1.5, 0], uv0Max: [1.5, 0.30000001192092896], morphTargets: 1 });
  const out = parseGlb(glb);
  const names = out.json.nodes.filter((node: any) => node.mesh !== undefined).map((node: any) => [node.name, node.skin]);
  expect(names).toEqual([["head", 0], ["makeup_plate", 0], ["eyes", undefined]]);
  const head = out.json.meshes[0].primitives[0];
  expect(Object.keys(head.attributes)).not.toContain("TANGENT");
  expect(Object.keys(head.targets[0])).toEqual(["POSITION", "NORMAL"]);
  expect(out.json.meshes[1].extras.targetNames).toEqual(["h011_eyes", "h012_nose"]);
  // Plate morph rows are the head's rows for the selected vertices.
  const headMorph = accessorFloats(readAccessor(out, head.targets[0].POSITION));
  const plateMorph = accessorFloats(readAccessor(out, out.json.meshes[1].primitives[0].targets[0].POSITION));
  plateVertexIds().forEach((row, index) => expect(plateMorph[index * 3 + 1]).toBe(headMorph[row * 3 + 1]!));
  // The eyes carry the eye component's own shape keys, paired with the head's by name and region.
  expect(out.json.meshes[2].extras.targetNames).toEqual(["h011_eyes"]);
  expect(out.json.meshes[2].weights).toEqual([0]);
  const eyeLift = accessorFloats(readAccessor(out, out.json.meshes[2].primitives[0].targets[0].POSITION));
  for (let vertex = 0; vertex < 6; vertex++) expect(eyeLift[vertex * 3 + 1]).toBeCloseTo(EYE_MORPH_LIFT, 7);
  expect(out.json.skins[0].joints.map((joint: number) => out.json.nodes[joint].name)).toEqual(["Head", "l_eye_JNT"]);
  expect(Buffer.compare(Buffer.from(glb), Buffer.from(assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb()).glb))).toBe(0);
  expect(verifyPreviewGlb(glb, plate)).toEqual(report);
});

test("assembly refuses a head whose triangles differ from the audited plate or an eye off its bind pose", () => {
  const plate = fixturePlateRecipe();
  const shifted = { ...plate, selection: { ...plate.selection, faceRangesInclusive: [[3, 6], [10, 11]] as [number, number][] } };
  const head = parseGlb(headGlb());
  const indices = Uint32Array.from(readAccessor(head, head.json.meshes[0].primitives[0].indices).array);
  expect(plateSelection(indices, plate).vertexIds).toEqual(plateVertexIds());
  expect(() => plateSelection(indices, shifted)).toThrow("differ from the audited eye plate selection");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), shifted, "submesh_01_LOD_1", eyeMorphGlb())).toThrow();
  expect(bindPoseDeviation(parseGlb(eyeGlb()), 0)).toBeLessThan(1e-6);
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb({ offsetBind: true }), plate, "submesh_01_LOD_1", eyeMorphGlb())).toThrow("bind pose");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_09_LOD_1", eyeMorphGlb())).toThrow("no submesh_09_LOD_1");
  // The eye morph must be based on the eye mesh itself, and each of its targets must pair with a head target.
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb({ shiftBase: true }))).toThrow("base geometry is not the eye mesh");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb({ names: ["h091_eyes"] }))).toThrow("no matching head target");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb({ names: ["eyeshape"] }))).toThrow("has no region");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), plate, "submesh_01_LOD_1", eyeMorphGlb({ names: [] }))).toThrow("no uniquely named");
  expect(() => assemblePreviewGlb(headGlb(), eyeGlb(), { ...plate, selection: { ...plate.selection, morphTargetCount: 3 } }, "submesh_01_LOD_1", eyeMorphGlb())).toThrow("morph target count");
});

test("the WolvenKit call uncooks exactly the named depot paths, with the game path only when materials are needed", () => {
  const args = uncookArguments("C:\\Game\\archive\\pc\\content", ["base\\a.mesh", "base\\b.morphtarget"], "C:\\out", "C:\\Game");
  expect(args.slice(0, 2)).toEqual(["uncook", "C:\\Game\\archive\\pc\\content"]);
  expect(args).toContain("MeshOnly");
  expect(args[args.indexOf("-gp") + 1]).toBe("C:\\Game");
  expect(args[args.indexOf("-r") + 1]).toBe("^(?:base\\\\a\\.mesh|base\\\\b\\.morphtarget)$");
  expect(args).not.toContain("-s");
  expect(uncookArguments("C:\\x.archive", ["base\\t.xbm"], "C:\\out", null)).not.toContain("-gp");
});

test("the export cache keys each resource by depot path and source, and rejects unsafe paths", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const fake = fakeUncook(plate, recipe), root = temporary("exports"), game = gameFolder();
  const texture = "base\\fixture\\textures\\head_d01.xbm";
  const session = fake.exporter(root).open(gameContentSource(game));
  const first = await session.geometry([recipe.eye.meshDepotPath, "base\\fixture\\absent.mesh"]);
  expect([...first.keys()]).toEqual([recipe.eye.meshDepotPath]);
  expect(first.get(recipe.eye.meshDepotPath)).toMatchObject({ cached: false, hash: expect.stringMatching(/^\d+$/) });
  // Textures WolvenKit decoded while resolving materials are reused without another call.
  expect((await session.textures([texture])).get(texture)?.cached).toBe(false);
  expect(fake.calls).toHaveLength(1);
  session.close();
  const again = fake.exporter(root).open(gameContentSource(game));
  expect((await again.geometry([recipe.eye.meshDepotPath])).get(recipe.eye.meshDepotPath)?.cached).toBe(true);
  expect((await again.textures([texture])).get(texture)?.cached).toBe(true);
  await expect(again.geometry(["base\\..\\escape.mesh"])).rejects.toThrow("Not a plain depot path");
  again.close();
  expect(fake.calls).toHaveLength(1);
  // A texture not decoded yet costs one texture-only call, without the game path.
  const other = fake.exporter(root).open(gameContentSource(game));
  expect((await other.textures(["base\\fixture\\textures\\eye_d02.xbm"])).size).toBe(1);
  expect(fake.calls.at(-1)?.withMaterials).toBe(false);
  other.close();
  // A changed game install is a different source: nothing cached is reused.
  writeFileSync(join(game, "archive", "pc", "content", "patch.archive"), "update");
  const updated = fake.exporter(root).open(gameContentSource(game));
  expect((await updated.geometry([recipe.eye.meshDepotPath])).get(recipe.eye.meshDepotPath)?.cached).toBe(false);
  updated.close();
});

test("the service derives, verifies, caches and reuses the preview core", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder();
  const steps: string[] = [];
  const fake = fakeUncook(plate, recipe), exporter = fake.exporter(temporary("exports"));
  const result = await ensurePreviewCore({ gameRoot: game, cacheRoot, exporter, recipe, plateRecipe: plate, progress: step => steps.push(step) });
  expect(result.reused).toBe(false);
  expect(steps).toEqual(["reading", "checking", "assembling", "maps", "verifying"]);
  expect(result.manifest.files.map(file => file.name)).toEqual([...PREVIEW_CORE_FILES]);
  for (const name of PREVIEW_CORE_FILES) expect(existsSync(join(result.directory, name))).toBe(true);
  expect(result.manifest.source.textures.map(texture => [texture.file, texture.material, texture.parameter])).toEqual([
    ["head-color.png", "01_ca_pale", "Albedo"], ["head-normal.png", "01_ca_pale", "Normal"],
    ["head-roughness.png", "01_ca_pale", "Roughness"], ["eye-color.png", "gradient_brown", "Albedo"]]);
  const normal = decodePng(readFileSync(join(result.directory, "head-normal.png")));
  expect(normal.data[2]).toBeGreaterThan(200);
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toMatchObject({ state: "ready", directory: result.directory });
  // One WolvenKit call with materials exported everything, including the decoded textures.
  expect(fake.calls.map(call => call.withMaterials)).toEqual([true]);
  const again = await ensurePreviewCore({ gameRoot: game, cacheRoot, exporter, recipe, plateRecipe: plate });
  expect(again.reused).toBe(true);
  expect(again.manifest.cacheKey).toBe(result.manifest.cacheKey);
  // A changed cached file is never served.
  writeFileSync(join(result.directory, "eye-color.png"), "tampered");
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toEqual({ state: "none" });
  expect(previewCoreReadiness(cacheRoot, gameFolder(), recipe, plate)).toEqual({ state: "none" });
  // Re-deriving reads every resource from the export cache without running WolvenKit again.
  expect((await ensurePreviewCore({ gameRoot: game, cacheRoot, exporter, recipe, plateRecipe: plate })).reused).toBe(false);
  expect(fake.calls).toHaveLength(1);
});

test("an unsupported or missing head is reported plainly and blocks until the game changes", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder();
  const unsupported = ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate,
    exporter: fresh(fakeUncook(plate, recipe, { mesh: Buffer.from("patched head") })) });
  await expect(unsupported).rejects.toMatchObject({ code: "preview_source_unsupported" });
  await expect(unsupported).rejects.toThrow("newer game patch");
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toMatchObject({ state: "blocked", code: "preview_source_unsupported" });
  writeFileSync(join(game, "archive", "pc", "content", "patch.archive"), "update");
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toEqual({ state: "none" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { omit: "head" })) }))
    .rejects.toMatchObject({ code: "preview_source_missing" });
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toMatchObject({ state: "blocked", code: "preview_source_missing" });
  // A head the archives contain but the tool did not export is a retryable tool failure, never a block.
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { omit: "head-export" })) }))
    .rejects.toMatchObject({ code: "preview_tool_failed" });
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toEqual({ state: "none" });
  // So is a missing head when the archive index can't be read.
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate,
    exporter: fresh(fakeUncook(plate, recipe, { omit: "head", index: false })) })).rejects.toMatchObject({ code: "preview_tool_failed" });
  expect(previewCoreReadiness(cacheRoot, game, recipe, plate)).toEqual({ state: "none" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { omit: "eye-glb" })) }))
    .rejects.toMatchObject({ code: "preview_tool_failed" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { omit: "eye-morph" })) }))
    .rejects.toMatchObject({ code: "preview_source_missing" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate,
    exporter: fresh(fakeUncook(plate, recipe, { eyeMorph: () => eyeMorphGlb({ shiftBase: true }) })) })).rejects.toMatchObject({ code: "preview_verification_failed" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { omit: "material" })) }))
    .rejects.toMatchObject({ code: "preview_tool_failed" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { textureSize: 100 })) }))
    .rejects.toMatchObject({ code: "preview_verification_failed" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: fresh(fakeUncook(plate, recipe, { eye: () => eyeGlb({ offsetBind: true }) })) }))
    .rejects.toMatchObject({ code: "preview_verification_failed" });
  // Work directories are always removed.
  expect(require("node:fs").readdirSync(cacheRoot).filter((name: string) => name.startsWith(".work-"))).toEqual([]);
});

test("cancellation stops the derivation, records it and leaves no partial entry", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder();
  const controller = new AbortController();
  const exporter = fresh(fakeUncook(plate, recipe, { beforeWrite: async () => { controller.abort(); } }));
  const run = ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter, signal: controller.signal });
  await expect(run).rejects.toBeInstanceOf(PreviewCoreError);
  await expect(run).rejects.toMatchObject({ code: "preview_cancelled" });
  expect(new PreviewCoreCache(cacheRoot).readStatus()).toMatchObject({ state: "failed", code: "preview_cancelled" });
  expect(require("node:fs").readdirSync(cacheRoot).filter((name: string) => name !== "status.json")).toEqual([]);
});

test("failures are routed by their type: tool, runtime, storage and anything else", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder();
  const failing = (error: unknown) => createGameAssetExporter(temporary("exports"), async () => { throw error; });
  const run = (error: unknown) => ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: failing(error) });
  await expect(run(new GameAssetExportError("tool_missing", "no CLI"))).rejects.toMatchObject({ code: "preview_tool_missing" });
  await expect(run(new GameAssetExportError("runtime_missing", "no .NET", "You must install .NET")))
    .rejects.toMatchObject({ code: "preview_runtime_missing", message: expect.stringContaining(".NET runtime") });
  await expect(run(new GameAssetExportError("tool_failed", "exit 1"))).rejects.toMatchObject({ code: "preview_tool_failed" });
  await expect(run(new GameAssetExportError("cancelled", "stopped"))).rejects.toMatchObject({ code: "preview_cancelled" });
  // Storage failures are the data folder's, not WolvenKit's, and say so plainly.
  const full = run(Object.assign(Error("no space left on device"), { code: "ENOSPC" }));
  await expect(full).rejects.toMatchObject({ code: "preview_cache_unavailable", message: expect.stringContaining("free disk space") });
  await expect(run(Object.assign(Error("permission denied"), { code: "EACCES" }))).rejects.toMatchObject({ code: "preview_cache_unavailable" });
  const other = run(new TypeError("undefined is not a function"));
  await expect(other).rejects.toMatchObject({ code: "preview_failed" });
  await expect(other).rejects.not.toThrow(/WolvenKit/);
  expect(new PreviewCoreCache(cacheRoot).readStatus()).toMatchObject({ state: "failed", code: "preview_failed" });
});

test("an incomplete export is never cached, so the next attempt runs the tool again on the same export cache", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder(), exports = temporary("exports");
  // WolvenKit exits 0 but drops the eye GLB: the raw eye mesh must not be published as a complete entry.
  const partial = fakeUncook(plate, recipe, { omit: "eye-glb" });
  await expect(ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: partial.exporter(exports) }))
    .rejects.toMatchObject({ code: "preview_tool_failed" });
  const session = partial.exporter(exports).open(gameContentSource(game));
  const again = await session.geometry([recipe.eye.meshDepotPath]);
  expect(again.get(recipe.eye.meshDepotPath)).toMatchObject({ complete: false, cached: false });
  session.close();
  expect(partial.calls).toHaveLength(2);
  // A repaired tool on the same cache succeeds; complete entries are then reused.
  const complete = fakeUncook(plate, recipe);
  const result = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: complete.exporter(exports) });
  expect(complete.calls.length).toBeGreaterThan(0);
  const reused = complete.exporter(exports).open(gameContentSource(game));
  const cached = await reused.geometry([plate.source.meshDepotPath, plate.source.morphDepotPath, recipe.eye.meshDepotPath]);
  expect([...cached.values()].every(entry => entry.cached && entry.complete)).toBe(true);
  reused.close();
  expect(result.manifest.source).toMatchObject({ eyeGlbSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    headMaterialsSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  // A partial mesh export (no mesh GLB) is likewise not cached.
  const noMeshGlb = fakeUncook(plate, recipe, { omit: "head-mesh-glb" }), meshCache = temporary("exports");
  const first = noMeshGlb.exporter(meshCache).open(gameContentSource(game));
  expect((await first.geometry([plate.source.meshDepotPath])).get(plate.source.meshDepotPath)).toMatchObject({ complete: false });
  first.close();
  const second = noMeshGlb.exporter(meshCache).open(gameContentSource(game));
  await second.geometry([plate.source.meshDepotPath]);
  second.close();
  expect(noMeshGlb.calls).toHaveLength(2);
});

test("export and preview caches are keyed by the exporting tool, which the manifest and render record name", async () => {
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const cacheRoot = temporary("cache"), game = gameFolder(), exports = temporary("exports");
  const older = fakeUncook(plate, recipe, { tool: { key: "wolvenkit:8.17.4:aaaa", label: "WolvenKit CLI 8.17.4" } });
  const first = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: older.exporter(exports) });
  expect(first.manifest.source.tool).toEqual({ key: "wolvenkit:8.17.4:aaaa", label: "WolvenKit CLI 8.17.4" });
  const record = JSON.parse(readFileSync(join(first.directory, "preview-core.json"), "utf8"));
  expect(record.provenance.tool).toBe("WolvenKit CLI 8.17.4");
  // Upgrading WolvenKit re-exports everything on the same export cache and gives the preview a new identity.
  const newer = fakeUncook(plate, recipe, { tool: { key: "wolvenkit:9.0.1:bbbb", label: "WolvenKit CLI 9.0.1" } });
  const second = await ensurePreviewCore({ gameRoot: game, cacheRoot, recipe, plateRecipe: plate, exporter: newer.exporter(exports) });
  expect(newer.calls).toHaveLength(1);
  expect(second.manifest.cacheKey).not.toBe(first.manifest.cacheKey);
  expect(second.manifest.source.tool.label).toBe("WolvenKit CLI 9.0.1");
});

test("the derived cache carries a render record that names, hashes and sources every core file", async () => {
  const { parseCoreDetail, CORE_TEXTURE_SLOTS, PREPARED_CORE_DETAIL } = await import("../src/render-detail");
  const plate = fixturePlateRecipe(), recipe = fixturePreviewRecipe(plate);
  const result = await ensurePreviewCore({ gameRoot: gameFolder(), cacheRoot: temporary("cache"), recipe, plateRecipe: plate,
    exporter: fresh(fakeUncook(plate, recipe)) });
  const record = parseCoreDetail(JSON.parse(readFileSync(join(result.directory, "preview-core.json"), "utf8")));
  expect(record).toMatchObject({ origin: "game-files", identity: result.manifest.cacheKey, geometry: { file: "head.glb" } });
  const hash = (name: string) => result.manifest.files.find(file => file.name === name)!.sha256;
  expect(record.geometry.sha256).toBe(hash("head.glb"));
  expect(record.geometry.sources.map(source => source.depotPath)).toEqual([plate.source.morphDepotPath, plate.source.meshDepotPath,
    recipe.eye.meshDepotPath, recipe.eye.morphDepotPath]);
  // Each mesh node names the morph resource its facial targets came from: the eyes use their own.
  expect(record.geometry.morphs?.map(entry => [entry.node, entry.depotPath])).toEqual([["head", plate.source.morphDepotPath],
    ["makeup_plate", plate.source.morphDepotPath], ["eyes", recipe.eye.morphDepotPath]]);
  expect(result.manifest.source.eyeMorphDepotPath).toBe(recipe.eye.morphDepotPath);
  expect(parseCoreDetail({ ...record, geometry: { ...record.geometry, morphs: undefined } }).geometry.morphs).toBeUndefined();
  expect(() => parseCoreDetail({ ...record, geometry: { ...record.geometry, morphs: [{ node: "eyes" }] } })).toThrow("morph 0 source");
  for (const slot of CORE_TEXTURE_SLOTS) expect(record.textures[slot].sha256).toBe(hash(record.textures[slot].file));
  expect(record.textures["head.roughness"].sources[0]).toMatchObject({ material: "01_ca_pale", parameter: "Roughness", adapter: "red-to-grey" });
  expect(parseCoreDetail(structuredClone(PREPARED_CORE_DETAIL)).origin).toBe("prepared");
  expect(() => parseCoreDetail({ ...record, geometry: { ...record.geometry, file: "../secret.glb" } })).toThrow("plain asset file name");
  expect(() => parseCoreDetail({ ...record, textures: { ...record.textures, "head.normal": { ...record.textures["head.normal"], sha256: "x" } } })).toThrow("hash");
});
