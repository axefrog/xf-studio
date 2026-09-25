import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  canonicalJson, EYE_PLATE_RECIPE, eyePlateCacheKey, eyePlateCacheName, idListSha256, parseEyePlateRecipe, selectedFaceIds,
  supportedEyePlateSource,
} from "../src/eye-plate-recipe";
import { cutMorphBlob, derivePlateDocuments, selectPlate } from "../src/eye-plate-cut";
import { plateTopology, verifyEyePlate } from "../src/eye-plate-verify";
import { contentFingerprint, EyePlateCache, eyePlateReadiness } from "../src/eye-plate-cache";
import { cachedPlateReach, EyePlateError, ensureEyePlate, type EyePlateTools } from "../src/eye-plate-service";
import { plateUvFootprint } from "../src/plate-uv-window";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { depotPathRegex } from "../src/eye-plate-wolvenkit";
import { FIXTURE_DIFFS, fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe } from "./eye-plate-fixture";

const withDirectory = async (run: (dir: string) => Promise<void> | void) => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-eye-plate-"));
  try { await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const clone = <T>(value: T): T => structuredClone(value);

test("the shipped recipe is asset-free, audited and self-consistent", () => {
  const recipe = EYE_PLATE_RECIPE;
  expect(recipe.selection.faceCount).toBe(3010);
  expect(recipe.selection.vertexCount).toBe(1620);
  expect(recipe.selection.morphTargetCount).toBe(105);
  expect(idListSha256(selectedFaceIds(recipe))).toBe(recipe.selection.faceIdsSha256);
  expect(recipe.source.supported.map(item => item.label)).toEqual(["Cyberpunk 2077 2.31"]);
  expect(recipe.output.stem.startsWith("xfs_")).toBe(true);
  // Only IDs, ranges, hashes and names: no coordinates, buffers or base64 payloads.
  const text = readFileSync(join(import.meta.dir, "../src/eye-plate-recipe.json"), "utf8");
  expect(text.length).toBeLessThan(8000);
  expect(text).not.toMatch(/Bytes|base64|\d+\.\d{3,}/);
});

test("recipe validation rejects drift, overlap and unknown fields", () => {
  const base = JSON.parse(readFileSync(join(import.meta.dir, "../src/eye-plate-recipe.json"), "utf8"));
  expect(parseEyePlateRecipe(clone(base))).toEqual(EYE_PLATE_RECIPE);
  const variant = (edit: (value: any) => void) => { const value = clone(base); edit(value); return () => parseEyePlateRecipe(value); };
  expect(variant(value => { value.schema = "xfs/eye-plate-recipe-2"; })).toThrow("unsupported schema");
  expect(variant(value => { value.extra = true; })).toThrow("exactly");
  expect(variant(value => { value.selection.faceRangesInclusive[1] = [850, 903]; })).toThrow("non-overlapping");
  expect(variant(value => { value.selection.faceRangesInclusive[0] = [807, 900]; })).toThrow("faceCount");
  expect(variant(value => { value.selection.faceIdsSha256 = "0".repeat(64); })).toThrow("faceIdsSha256");
  expect(variant(value => { value.source.supported = []; })).toThrow("at least one");
  expect(variant(value => { value.source.supported[0].meshSha256 = "E877"; })).toThrow("hash");
  expect(variant(value => { value.output.stem = "xfas_eye_plate"; })).toThrow("stem");
  expect(variant(value => { value.source.meshDepotPath = "C:\\Users\\someone\\head.mesh"; })).toThrow("depot path");
  expect(variant(value => { value.selection.topology.componentVertexCounts = [20, 20, 790]; })).toThrow("vertexCount");
});

test("cache keys follow recipe content and exact source revisions", () => {
  const recipe = EYE_PLATE_RECIPE;
  const source = recipe.source.supported[0];
  const key = eyePlateCacheKey(recipe, source);
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(eyePlateCacheKey(recipe, { ...source })).toBe(key);
  expect(eyePlateCacheKey(recipe, { ...source, morphSha256: "f".repeat(64) })).not.toBe(key);
  expect(eyePlateCacheKey({ ...recipe, revision: recipe.revision + 1 }, source)).not.toBe(key);
  expect(eyePlateCacheKey({ ...recipe, output: { ...recipe.output, vertexFactory: 30 } }, source)).not.toBe(key);
  expect(eyePlateCacheName(recipe, key)).toBe(`xfs-expanded-eye-plate-r1-${key.slice(0, 16)}`);
  expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  expect(supportedEyePlateSource(recipe, source)?.id).toBe("cp2077-2.31");
  expect(supportedEyePlateSource(recipe, { ...source, meshSha256: "0".repeat(64) })).toBeNull();
});

test("the cut copies native bytes, keeps native order and drops only head-only streams", () => {
  const recipe = fixtureRecipe();
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const before = JSON.stringify([mesh, morph]);
  const plate = derivePlateDocuments(mesh, morph, recipe, "xfs\\eye_plate\\xfs_eye_plate.mesh");
  expect(JSON.stringify([mesh, morph])).toBe(before); // Inputs are never mutated.
  expect(plate.selection.vertexIds).toEqual([0, 1, 3, 4, 6, 7]);
  expect([...plate.selection.faces]).toEqual([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  const root = plate.mesh.Data.RootChunk;
  const chunk = root.renderResourceBlob.Data.header.renderChunkInfos[0];
  expect(chunk.vertexFactory).toBe(4);
  expect(chunk.chunkVertices.vertexLayout.slotStrides.Elements).toEqual([24, 4, 8, 8, 0, 0, 0, 64]);
  expect(chunk.chunkVertices.vertexLayout.slotMask).toBe(143);
  expect(chunk.chunkVertices.vertexLayout.elements.Elements.map((e: any) => e.usage)).not.toContain("PS_ExtraData");
  expect(root.parameters).toEqual([]);
  expect(root.localMaterialBuffer.materials).toHaveLength(1);
  expect(root.localMaterialBuffer.materials[0].baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal.mt");
  expect(plate.mesh.Header.ArchiveFileName).toBeUndefined(); // No private source path leaks into the plate.
  const morphRoot = plate.morph.Data.RootChunk;
  expect(morphRoot.baseMesh.DepotPath.$value).toBe("xfs\\eye_plate\\xfs_eye_plate.mesh");
  expect(morphRoot.blob.Data.textureDiffsBuffer).toBeNull();
  // Target 0 keeps head vertices 0, 3, 6 (plate 0, 2, 4); target 1 keeps 1, 4, 7 (plate 1, 3, 5).
  expect(morphRoot.blob.Data.header.numVertexDiffsInEachChunk).toEqual([[3], [3]]);
  expect(morphRoot.blob.Data.header.numVertexDiffsMappingInEachChunk).toEqual([[2], [2]]);
  expect(morphRoot.blob.Data.header.targetStartsInVertexDiffs).toEqual([0, 3]);
  const maps = Buffer.from(morphRoot.blob.Data.mappingBuffer.Bytes, "base64");
  expect(Array.from({ length: maps.length / 2 }, (_, at) => maps.readUInt16LE(at * 2))).toEqual([0, 2, 4, 0, 1, 3, 5, 0]);
  const report = verifyEyePlate(recipe, mesh, morph, plate.mesh, plate.morph);
  expect(report.exactNativeSkinBytesMesh && report.exactNativeSkinBytesMorphBase && report.exactMorphDiffRows).toBe(true);
  expect(report.droppedVertexElements).toEqual(["PS_ExtraData:0:PT_Float16_4", "PS_LightBlockerIntensity:0:PT_Float1"]);
  expect(report.morphDiffs).toBe(6);
});

test("the cut refuses a head whose triangles no longer match the audited selection", () => {
  const recipe = fixtureRecipe();
  const mesh = fixtureHeadMesh();
  const blob = mesh.Data.RootChunk.renderResourceBlob.Data;
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  raw.writeUInt16LE(8, blob.header.indexBufferOffset + 2); // Triangle 0 now references another vertex.
  blob.renderBuffer.Bytes = raw.toString("base64");
  expect(() => selectPlate(blob, recipe)).toThrow("audited selection");
  const morph = fixtureHeadMorph();
  morph.Data.RootChunk.blob.Data.header.numTargets = 3;
  expect(() => cutMorphBlob(morph.Data.RootChunk.blob.Data, selectPlate(fixtureHeadMesh().Data.RootChunk.renderResourceBlob.Data, recipe), recipe))
    .toThrow("morph target count");
});

test("independent verification rejects re-quantized, re-weighted or reordered plates", () => {
  const recipe = fixtureRecipe();
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const plate = derivePlateDocuments(mesh, morph, recipe, "xfs\\eye_plate\\xfs_eye_plate.mesh");
  const tamper = (edit: (mesh: any, morph: any) => void) => {
    const next = { mesh: clone(plate.mesh), morph: clone(plate.morph) };
    edit(next.mesh, next.morph);
    return () => verifyEyePlate(recipe, mesh, morph, next.mesh, next.morph);
  };
  const editBytes = (blob: any, at: (raw: Buffer, header: any) => void) => {
    const raw = Buffer.from(blob.renderBuffer.Bytes, "base64"); at(raw, blob.header); blob.renderBuffer.Bytes = raw.toString("base64");
  };
  expect(tamper(m => { m.Data.RootChunk.renderResourceBlob.Data.header.quantizationScale.X = 0.05; })).toThrow("quantization");
  // Skin weight byte of plate vertex 1 in the morph base buffer only (stream 0 offset 16).
  expect(tamper((_, t) => editBytes(t.Data.RootChunk.blob.Data.baseBlob.Data, raw => { raw[24 + 16] ^= 1; })))
    .toThrow("mesh and morph-base skin bytes differ");
  expect(tamper(m => editBytes(m.Data.RootChunk.renderResourceBlob.Data, (raw, header) => {
    const first = raw.readUInt16LE(header.indexBufferOffset); raw.writeUInt16LE(raw.readUInt16LE(header.indexBufferOffset + 2), header.indexBufferOffset);
    raw.writeUInt16LE(first, header.indexBufferOffset + 2);
  }))).toThrow("native order and winding");
  expect(tamper((_, t) => { const d = t.Data.RootChunk.blob.Data; const raw = Buffer.from(d.diffsBuffer.Bytes, "base64"); raw[0] ^= 1; d.diffsBuffer.Bytes = raw.toString("base64"); }))
    .toThrow("morph target 0");
  expect(tamper((_, t) => { t.Data.RootChunk.targets.reverse(); })).toThrow("names or order");
});

test("topology counts components, boundary loops and non-manifold edges", () => {
  expect(plateTopology([[0, 1, 2], [0, 2, 3]], 4)).toEqual({ componentVertexCounts: [4], boundaryEdges: 4, boundaryLoops: 1, nonManifoldEdges: 0 });
  expect(plateTopology([[0, 1, 2], [3, 4, 5]], 6).componentVertexCounts).toEqual([3, 3]);
  expect(() => plateTopology([[0, 1, 2], [0, 1, 3], [0, 1, 4]], 5)).toThrow("closed loops");
});

test("WolvenKit extraction matches depot paths literally", () => {
  const regex = new RegExp(depotPathRegex(["base\\a.b\\c(d).mesh", "base\\x.morphtarget"]));
  expect(regex.test("base\\a.b\\c(d).mesh")).toBe(true);
  expect(regex.test("base\\aXb\\c(d).mesh")).toBe(false);
  expect(regex.test("base\\x.morphtarget.bak")).toBe(false);
});

/** Fake WolvenKit: "resources" are JSON documents, so the whole service runs without the game. */
function fakeTools(sources: { mesh?: unknown; morph?: unknown }, recipe = fixtureRecipe(), calls: string[] = []): EyePlateTools {
  const place = (root: string, depot: string, value: unknown) => {
    const path = join(root, ...depot.split("\\")); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value));
  };
  return {
    async extract({ outDir, depotPaths }) {
      calls.push("extract");
      expect(depotPaths).toEqual([recipe.source.meshDepotPath, recipe.source.morphDepotPath]);
      if (sources.mesh) place(outDir, recipe.source.meshDepotPath, sources.mesh);
      if (sources.morph) place(outDir, recipe.source.morphDepotPath, sources.morph);
    },
    async serialize({ file, outDir }) {
      calls.push("serialize");
      const json = join(outDir, basename(file) + ".json");
      writeFileSync(json, readFileSync(file)); return json;
    },
    async deserialize({ jsonDir, outDir, names }) {
      calls.push("deserialize");
      for (const name of names) writeFileSync(join(outDir, name), readFileSync(join(jsonDir, name + ".json")));
    },
  };
}
const hashedRecipe = (mesh: unknown, morph: unknown) => {
  const digest = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
  const base = fixtureRecipe();
  return parseEyePlateRecipe({ ...base, source: { ...base.source, supported: [{ id: "fixture-1", label: "Fixture 1",
    meshSha256: digest(mesh), morphSha256: digest(morph) }] } });
};
const fakeGame = (dir: string) => {
  const game = join(dir, "game");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  writeFileSync(join(game, "archive", "pc", "content", "basegame_4_appearance.archive"), "archive");
  return game;
};

test("the service derives, verifies, caches and reuses the plate", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = hashedRecipe(mesh, morph);
  const calls: string[] = [];
  const game = fakeGame(dir), cacheRoot = join(dir, "cache");
  const first = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe, calls) });
  expect(first.reused).toBe(false);
  expect(basename(first.meshFile)).toBe("xfs_eye_plate.mesh");
  expect(readdirSync(first.directory).sort()).toEqual(["xfs_eye_plate.mesh", "xfs_eye_plate.morphtarget"]);
  expect(first.manifest.verification.exactNativeSkinBytesMorphBase).toBe(true);
  expect(first.manifest.source.revisionId).toBe("fixture-1");
  expect(readdirSync(cacheRoot).filter(name => name.startsWith(".work-"))).toEqual([]);
  expect(eyePlateReadiness(cacheRoot, game, recipe).issue).toBeNull();
  calls.length = 0;
  const second = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe, calls) });
  expect(second.reused).toBe(true);
  expect(calls).toEqual([]); // Unchanged inputs reuse the verified plate without reading the head again.
  // A damaged cache entry is detected by its manifest hashes and rebuilt.
  writeFileSync(first.meshFile, "damaged");
  const repaired = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe) });
  expect(repaired.reused).toBe(false);
  expect(readFileSync(repaired.meshFile, "utf8")).not.toBe("damaged");
}));

test("PIPE-33: the cache records the plate's UV footprint for Check, and derives older entries again once", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = hashedRecipe(mesh, morph);
  const game = fakeGame(dir), cacheRoot = join(dir, "cache");
  const first = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe) });
  // The footprint of the finished plate resource, beside the manifest, bound by its hash, bounds and window.
  const footprint = plateUvFootprint(JSON.parse(readFileSync(first.meshFile, "utf8")).Data.RootChunk);
  expect(first.manifest.uv).toEqual(plateUvManifestRecord(footprint));
  expect(JSON.parse(readFileSync(join(dirname(first.manifestFile), PLATE_UV_FILE), "utf8"))).toEqual(footprint);
  expect(readdirSync(first.directory).sort()).toEqual(["xfs_eye_plate.mesh", "xfs_eye_plate.morphtarget"]);
  // Check finds it through the cache status for the same game folder and recipe only.
  const cached = cachedPlateReach(cacheRoot, game, recipe);
  expect(cached).toEqual({ plate: plateReachInput(footprint), manifestFile: first.manifestFile });
  expect(cachedPlateReach(cacheRoot, join(dir, "other-game"), recipe)).toBeNull();
  expect(cachedPlateReach(null, game, recipe)).toBeNull();
  // A damaged footprint is not planned on, and the entry is derived again.
  writeFileSync(join(dirname(first.manifestFile), PLATE_UV_FILE), JSON.stringify({ ...footprint, uv: footprint.uv.map(v => v + .01) }));
  expect(cachedPlateReach(cacheRoot, game, recipe)).toBeNull();
  const repaired = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe) });
  expect(repaired.reused).toBe(false);
  expect(cachedPlateReach(cacheRoot, game, recipe)?.plate.sha256).toBe(plateReachInput(footprint).sha256);
  // An entry cached before footprints were recorded is derived again once, with the same plate bytes.
  const { uv: _uv, ...older } = repaired.manifest;
  writeFileSync(repaired.manifestFile, JSON.stringify(older));
  expect(cachedPlateReach(cacheRoot, game, recipe)).toBeNull();
  const upgraded = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe) });
  expect(upgraded.reused).toBe(false);
  expect(upgraded.manifest.uv).toEqual(first.manifest.uv);
  expect(upgraded.manifest.files).toEqual(first.manifest.files);
}));

test("an unsupported or missing head explains itself and blocks readiness until the game changes", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = fixtureRecipe(); // Supported hashes are placeholders, so this installed head is "unsupported".
  const game = fakeGame(dir), cacheRoot = join(dir, "cache");
  const failure = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh, morph }, recipe) }).catch(error => error);
  expect(failure).toBeInstanceOf(EyePlateError);
  expect(failure.code).toBe("plate_source_unsupported");
  expect(failure.message).toContain("Fixture 1");
  expect(failure.message).toContain("Update XF Studio");
  expect(failure.message).not.toContain(dir);
  const readiness = eyePlateReadiness(cacheRoot, game, recipe);
  expect(readiness.issue?.code).toBe("plate_source_unsupported");
  expect(eyePlateReadiness(cacheRoot, join(dir, "other-game"), recipe).issue).toBeNull();
  expect(eyePlateReadiness(cacheRoot, game, { ...recipe, revision: 2 }).issue).toBeNull();
  // Updating or repairing the game changes the content archives and clears the stale block.
  const archive = join(game, "archive", "pc", "content", "basegame_4_appearance.archive");
  const before = contentFingerprint(game, recipe.source.archiveDirectory);
  writeFileSync(archive, "patched archive");
  utimesSync(archive, new Date(), new Date(Date.now() + 60_000));
  expect(contentFingerprint(game, recipe.source.archiveDirectory)).not.toBe(before);
  expect(eyePlateReadiness(cacheRoot, game, recipe).issue).toBeNull();
  const missing = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: fakeTools({ mesh }, recipe) }).catch(error => error);
  expect(missing.code).toBe("plate_source_missing");
  expect(eyePlateReadiness(cacheRoot, game, recipe).issue?.code).toBe("plate_source_missing");
  expect(new EyePlateCache(cacheRoot).readStatus()?.state).toBe("missing");
}));

test("cancellation and tool failures leave no partial cache entry", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = hashedRecipe(mesh, morph);
  const game = fakeGame(dir), cacheRoot = join(dir, "cache");
  const controller = new AbortController();
  const tools = fakeTools({ mesh, morph }, recipe);
  const cancelling: EyePlateTools = { ...tools, async serialize(input) { controller.abort(); return tools.serialize(input); } };
  const cancelled = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: cancelling, signal: controller.signal }).catch(error => error);
  expect(cancelled.code).toBe("plate_cancelled");
  const broken: EyePlateTools = { ...tools, async deserialize() { throw Object.assign(Error("convert failed"), { output: "WolvenKit log" }); } };
  const failed = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: broken }).catch(error => error);
  expect(failed.code).toBe("plate_tool_failed");
  expect(failed.detail).toContain("WolvenKit log");
  expect(readdirSync(cacheRoot).sort()).toEqual(["status.json"]);
  expect(existsSync(join(cacheRoot, eyePlateCacheName(recipe, eyePlateCacheKey(recipe, recipe.source.supported[0]))))).toBe(false);
  expect(FIXTURE_DIFFS).toHaveLength(2);
}));
