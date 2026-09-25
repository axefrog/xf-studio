import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readArchiveXlConfig, settleDepotAdditions, type XlDocument } from "../src/archivexl-config";
import {
  applyHeadPatches, planHeadSource, plateRelevantProps, type HeadArchive, type HeadPatchSource, type HeadResourceSource,
  type HeadSourcePlan,
} from "../src/eye-plate-head-source";
import { parseEyePlateRecipe } from "../src/eye-plate-recipe";
import { EyePlateError, ensureEyePlate, eyePlateHeadOverride, packagePlateRecord, type EyePlateTools } from "../src/eye-plate-service";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe } from "./eye-plate-fixture";
import { cr2w, fixtureInstallation } from "./resolver-fixtures";

const MESH = "base\\fixture\\head.mesh", MORPH = "base\\fixture\\head.morphtarget";
const paths = { meshDepotPath: MESH, morphDepotPath: MORPH };
const withDirectory = async (run: (dir: string) => Promise<void> | void) => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-plate-head-"));
  try { await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const plan = (archives: Parameters<typeof fixtureInstallation>[0], xl: XlDocument[] = []) => {
  const { depot } = fixtureInstallation(archives, xl);
  const config = readArchiveXlConfig(xl);
  return planHeadSource(paths, depot, settleDepotAdditions(config, hash => depot.lookup(hash).winner !== null), config.paths);
};
const base = { virtualPath: "archive/pc/content/basegame_4_appearance.archive", files: { [MESH]: {}, [MORPH]: {} } };

test("the planner follows archive precedence: base game alone, or a mod's morph target over it", () => {
  const vanilla = plan([base]);
  expect(vanilla.modded).toBe(false);
  expect([vanilla.mesh?.archive.name, vanilla.morph?.archive.name]).toEqual(["basegame_4_appearance.archive", "basegame_4_appearance.archive"]);
  const modded = plan([base, { virtualPath: "archive/pc/mod/zz_rig_fix.archive", provider: "mo2-mod", providerName: "Rig Fix", priority: 5,
    files: { [MORPH]: {} } }]);
  expect(modded.modded).toBe(true);
  expect(modded.mesh?.baseGame).toBe(true);
  expect(modded.morph).toMatchObject({ baseGame: false, archive: { name: "zz_rig_fix.archive", group: "mod", provider: "Rig Fix" } });
  expect(modded.morph?.alternatives).toEqual(["basegame_4_appearance.archive (content, basegame_4_appearance.archive)"]);
  // The escape hatch still knows the base-game providers.
  expect(modded.baseGame.morph?.archive.name).toBe("basegame_4_appearance.archive");
  expect(plan([]).mesh).toBeNull();
});

test("only patches that can change plate data are planned; appearance-only patches are recorded as ignored", () => {
  const donor = { virtualPath: "archive/pc/mod/uv_framework.archive", provider: "mo2-mod" as const, providerName: "UV Framework", priority: 3,
    files: { "donor\\head_f.mesh": {}, "donor\\blob.mesh": {}, "donor\\morph.morphtarget": {} } };
  const xl = (patch: object): XlDocument => ({ id: "archive/pc/mod/x.xl", document: { resource: { patch } } });
  // Empty props on a mesh patch: appearances change, but an existing render blob is only replaced when named.
  const appearances = plan([base, donor], [xl({ "donor\\head_f.mesh": [MESH] })]);
  expect(appearances.modded).toBe(false);
  expect(appearances.patches).toEqual([]);
  expect(appearances.ignoredPatches).toMatchObject([{ target: "mesh", sourcePath: "donor\\head_f.mesh", declaredBy: "archive/pc/mod/x.xl" }]);
  const blob = plan([base, donor], [xl({ "donor\\blob.mesh": { props: ["renderResourceBlob"], targets: [MESH] } })]);
  expect(blob.modded).toBe(true);
  expect(blob.patches).toMatchObject([{ target: "mesh", sourcePath: "donor\\blob.mesh", mayChange: ["renderResourceBlob"],
    archive: { provider: "UV Framework" } }]);
  const morph = plan([base, donor], [xl({ "donor\\morph.morphtarget": [MORPH] })]);
  expect(morph.patches[0]?.mayChange).toEqual(["boundingBox", "targets", "baseTextureParamName"]);
  expect(plateRelevantProps("morph", { props: new Set(["blob"]) })).toEqual(["blob"]);
  expect(plateRelevantProps("morph", { props: new Set(["baseMesh"]) })).toEqual([]);
  // A patch resource provided only through ArchiveXL resource.copy is extracted from the copied entry.
  const copied = plan([base, donor], [{ id: "archive/pc/mod/y.xl", document: { resource: {
    copy: { "donor\\blob.mesh": ["copies\\blob_copy.mesh"] }, patch: { "copies\\blob_copy.mesh": { props: ["renderResourceBlob"], targets: [MESH] } } } } }]);
  expect(copied.patches[0]).toMatchObject({ sourcePath: "copies\\blob_copy.mesh", entryPath: "donor\\blob.mesh" });
});

test("patches apply as ArchiveXL applies them to plate data", () => {
  const head = cr2w({ $type: "MorphTargetMesh", blob: { HandleId: "0", Data: { v: 1 } }, boundingBox: { Min: { X: 0 }, Max: { X: 1 } },
    baseTextureParamName: { $value: "None" }, targets: [{ name: { $value: "a" }, regionName: { $value: "r" } }] });
  const patch = (props: string[]): HeadPatchSource => ({ target: "morph", sourcePath: "p.morphtarget", entryPath: "p.morphtarget",
    archive: { name: "p.archive", group: "mod", provider: "P", file: "p" }, declaredBy: "p.xl", props, order: 0, mayChange: [] });
  const source = cr2w({ $type: "MorphTargetMesh", blob: { HandleId: "0", Data: { v: 2 } }, boundingBox: { Min: { X: 0 }, Max: { X: 0 } },
    baseTextureParamName: { $value: "Normal" }, targets: [{ name: { $value: "a" }, regionName: { $value: "x" } }, { name: { $value: "b" } }] });
  const all = applyHeadPatches("morph", head, [{ patch: patch([]), document: source }]);
  // Empty props: the existing blob is kept (overwrite needs the explicit prop), an empty box is ignored,
  // targets merge by name and a named texture parameter is taken.
  expect(all.applied).toEqual([{ target: "morph", sourcePath: "p.morphtarget", declaredBy: "p.xl", changed: ["baseTextureParamName", "targets"] }]);
  expect(all.document.Data.RootChunk.blob.Data.v).toBe(1);
  expect(all.document.Data.RootChunk.targets.map((t: any) => [t.name.$value, t.regionName?.$value])).toEqual([["a", "x"], ["b", undefined]]);
  expect((head.Data.RootChunk as any).targets).toHaveLength(1); // Inputs are never mutated.
  expect(applyHeadPatches("morph", head, [{ patch: patch(["blob"]), document: source }]).document.Data.RootChunk.blob.Data.v).toBe(2);
  const mesh = cr2w({ $type: "CMesh", renderResourceBlob: { HandleId: "1", Data: { v: 1 } }, boneNames: ["a"], appearances: [] });
  const donor = cr2w({ $type: "CMesh", renderResourceBlob: { HandleId: "1", Data: { v: 3 } }, boneNames: ["b"], lodLevelInfo: [1] });
  const meshPatch = { ...patch(["renderResourceBlob"]), target: "mesh" as const };
  expect(applyHeadPatches("mesh", mesh, [{ patch: { ...meshPatch, props: [] }, document: donor }]).applied).toEqual([]);
  const replaced = applyHeadPatches("mesh", mesh, [{ patch: meshPatch, document: donor }]).document.Data.RootChunk;
  expect([replaced.renderResourceBlob.Data.v, replaced.boneNames, replaced.lodLevelInfo]).toEqual([3, ["b"], [1]]);
});

// ---- Service policy with a fake route resolver and fake WolvenKit ----
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const archive = (dir: string, name: string, group: HeadArchive["group"], provider: string): HeadArchive => {
  const file = join(dir, "archives", name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `archive ${name}`);
  return { name, group, provider, file };
};
const resource = (role: "mesh" | "morph", from: HeadArchive, depotPath = role === "mesh" ? MESH : MORPH): HeadResourceSource =>
  ({ role, depotPath, entryPath: depotPath, archive: from, baseGame: from.group === "content", alternatives: [], notes: [] });
/** Fake WolvenKit: each archive file maps depot paths to JSON documents. */
function tools(contents: Map<string, Record<string, unknown>>, calls: string[] = []): EyePlateTools {
  return {
    async extract({ archive: file, depotPaths, outDir }) {
      calls.push(`extract ${basename(file)}`);
      for (const path of depotPaths) {
        const document = contents.get(file)?.[path];
        if (!document) continue;
        const target = join(outDir, ...path.split("\\"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(document));
      }
    },
    async serialize({ file, outDir }) { calls.push("serialize"); const json = join(outDir, basename(file) + ".json"); writeFileSync(json, readFileSync(file)); return json; },
    async deserialize({ jsonDir, outDir, names }) {
      calls.push("deserialize");
      for (const name of names) writeFileSync(join(outDir, name), readFileSync(join(jsonDir, name + ".json")));
    },
  };
}
const recipeFor = (mesh: unknown, morph: unknown) => {
  const recipe = fixtureRecipe();
  return parseEyePlateRecipe({ ...recipe, source: { ...recipe.source, supported: [{ id: "fixture-1", label: "Fixture 1",
    meshSha256: sha(mesh), morphSha256: sha(morph) }] } });
};
const planOf = (mesh: HeadResourceSource, morph: HeadResourceSource, baseGame: { mesh: HeadResourceSource; morph: HeadResourceSource },
  patches: HeadPatchSource[] = []): HeadSourcePlan =>
  ({ mesh, morph, patches, ignoredPatches: [], baseGame, modded: !mesh.baseGame || !morph.baseGame || patches.length > 0 });

test("a mod's morph target with the audited topology is cut from, with provenance and its own cache key", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = recipeFor(mesh, morph);
  // Same geometry, different target metadata (as a morph fix that renames target bones does).
  const fixed = structuredClone(morph);
  fixed.Data.RootChunk.targets[0].boneNames = [{ $value: "jaw_unused" }];
  const content = archive(dir, "basegame_4_appearance.archive", "content", "Installed game");
  const mod = archive(dir, "zz_rig_fix.archive", "mod", "Rig Fix");
  const contents = new Map<string, Record<string, unknown>>([[content.file, { [MESH]: mesh, [MORPH]: morph }], [mod.file, { [MORPH]: fixed }]]);
  const baseGame = { mesh: resource("mesh", content), morph: resource("morph", content) };
  const cacheRoot = join(dir, "cache"), game = join(dir, "game");
  const vanilla = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: tools(contents),
    headSource: { resolve: async () => ({ plan: planOf(baseGame.mesh, baseGame.morph, baseGame), notes: ["fixture route"] }) } });
  expect(vanilla.manifest.head?.kind).toBe("base-game");
  expect(vanilla.manifest.source.revisionId).toBe("fixture-1");
  const calls: string[] = [];
  const derived = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: tools(contents, calls),
    headSource: { resolve: async () => ({ plan: planOf(baseGame.mesh, resource("morph", mod), baseGame), notes: [] }) } });
  expect(derived.reused).toBe(false);
  expect(calls.slice(0, 2).sort()).toEqual(["extract basegame_4_appearance.archive", "extract zz_rig_fix.archive"]);
  expect(derived.manifest.cacheKey).not.toBe(vanilla.manifest.cacheKey);
  expect(derived.manifest.source).toMatchObject({ revisionId: "installed-mods", label: "Installed head changed by Rig Fix", morphSha256: sha(fixed) });
  expect(derived.manifest.head).toEqual({ kind: "installed-mods", patches: [], ignoredPatches: [], resources: [
    { role: "mesh", depotPath: MESH, entryPath: MESH, archive: "basegame_4_appearance.archive", group: "content", provider: "Installed game",
      resourceSha256: sha(mesh), archiveSha256: null },
    { role: "morph", depotPath: MORPH, entryPath: MORPH, archive: "zz_rig_fix.archive", group: "mod", provider: "Rig Fix",
      resourceSha256: sha(fixed), archiveSha256: createHash("sha256").update(readFileSync(mod.file)).digest("hex") }] });
  expect(derived.manifest.limits.some(limit => limit.includes("installed mods"))).toBe(true);
  expect(JSON.stringify(derived.manifest)).not.toContain(dir); // No physical paths in provenance.
  // The plate carries the mod's target metadata; the package record carries the provenance.
  const plateMorph = JSON.parse(readFileSync(derived.morphFile, "utf8"));
  expect(plateMorph.Data.RootChunk.targets[0].boneNames).toEqual([{ $value: "jaw_unused" }]);
  expect(packagePlateRecord(derived.manifest)).toMatchObject({ sourceRevision: "installed-mods", head: { kind: "installed-mods" } });
  // A cache hit only re-extracts and hashes; an unpatched head is not serialized again.
  calls.length = 0;
  const again = await ensureEyePlate({ gameRoot: game, cacheRoot, recipe, tools: tools(contents, calls),
    headSource: { resolve: async () => ({ plan: planOf(baseGame.mesh, resource("morph", mod), baseGame), notes: [] }) } });
  expect(again.reused).toBe(true);
  expect(calls.filter(call => call === "serialize")).toEqual([]);
}));

test("a mod that changes the head's topology blocks Build with a named, actionable message and an escape hatch", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = recipeFor(mesh, morph);
  const reshaped = structuredClone(morph);
  const blob = reshaped.Data.RootChunk.blob.Data.baseBlob.Data;
  const raw = Buffer.from(blob.renderBuffer.Bytes, "base64");
  raw.writeUInt16LE(8, blob.header.indexBufferOffset + 2); // A selected triangle now uses another vertex.
  blob.renderBuffer.Bytes = raw.toString("base64");
  const content = archive(dir, "basegame_4_appearance.archive", "content", "Installed game");
  const mod = archive(dir, "head_sculpt.archive", "mod", "Head Sculpt");
  const contents = new Map<string, Record<string, unknown>>([[content.file, { [MESH]: mesh, [MORPH]: morph }], [mod.file, { [MORPH]: reshaped }]]);
  const baseGame = { mesh: resource("mesh", content), morph: resource("morph", content) };
  const headSource = { resolve: async () => ({ plan: planOf(baseGame.mesh, resource("morph", mod), baseGame), notes: [] }) };
  const cacheRoot = join(dir, "cache");
  const blocked = await ensureEyePlate({ gameRoot: join(dir, "game"), cacheRoot, recipe, tools: tools(contents), headSource }).catch(error => error);
  expect(blocked).toBeInstanceOf(EyePlateError);
  expect(blocked.code).toBe("plate_source_modded");
  expect(blocked.message).toContain("Your installed head mod Head Sculpt changes the head's shape data in a way XF Eye Artistry doesn't support yet");
  expect(blocked.message).toContain("XFS_EYE_PLATE_HEAD=base-game");
  expect(blocked.detail).toContain("audited selection");
  expect(readdirSync(cacheRoot).filter(name => !name.startsWith("status"))).toEqual([]);
  // The escape hatch cuts from the base-game head and says so in the manifest.
  const override = await ensureEyePlate({ gameRoot: join(dir, "game"), cacheRoot, recipe, tools: tools(contents), headSource,
    headOverride: eyePlateHeadOverride({ XFS_EYE_PLATE_HEAD: "Base-Game " }) });
  expect(override.manifest.head?.kind).toBe("base-game-override");
  expect(override.manifest.head?.resources.map(item => item.archive)).toEqual(["basegame_4_appearance.archive", "basegame_4_appearance.archive"]);
  expect(override.manifest.source.revisionId).toBe("fixture-1");
  expect(override.manifest.limits.some(limit => limit.includes("XFS_EYE_PLATE_HEAD=base-game"))).toBe(true);
  expect(eyePlateHeadOverride({})).toBeUndefined();
}));

test("an .xl render-blob patch is applied before the cut, and a patch that reshapes the head is refused", () => withDirectory(async dir => {
  const mesh = fixtureHeadMesh(), morph = fixtureHeadMorph();
  const recipe = recipeFor(mesh, morph);
  const content = archive(dir, "basegame_4_appearance.archive", "content", "Installed game");
  const framework = archive(dir, "uv_framework.archive", "mod", "UV Framework");
  const donorSame = structuredClone(mesh);
  donorSame.Data.RootChunk.boneNames = [{ $type: "CName", $storage: "string", $value: "PatchedRoot" }];
  const donorOther = structuredClone(mesh);
  const other = donorOther.Data.RootChunk.renderResourceBlob.Data, raw = Buffer.from(other.renderBuffer.Bytes, "base64");
  raw.writeUInt16LE(8, other.header.indexBufferOffset + 2);
  other.renderBuffer.Bytes = raw.toString("base64");
  const contents = new Map<string, Record<string, unknown>>([[content.file, { [MESH]: mesh, [MORPH]: morph }],
    [framework.file, { "donor\\same.mesh": donorSame, "donor\\other.mesh": donorOther }]]);
  const baseGame = { mesh: resource("mesh", content), morph: resource("morph", content) };
  const patchOf = (sourcePath: string): HeadPatchSource => ({ target: "mesh", sourcePath, entryPath: sourcePath, archive: framework,
    declaredBy: "archive/pc/mod/uv.xl", props: ["renderResourceBlob"], order: 0, mayChange: ["renderResourceBlob"] });
  const run = (patch: HeadPatchSource) => ensureEyePlate({ gameRoot: join(dir, "game"), cacheRoot: join(dir, "cache"), recipe, tools: tools(contents),
    headSource: { resolve: async () => ({ plan: planOf(baseGame.mesh, baseGame.morph, baseGame, [patch]), notes: [] }) } });
  const patched = await run(patchOf("donor\\same.mesh"));
  expect(patched.manifest.head).toMatchObject({ kind: "installed-mods",
    patches: [{ target: "mesh", source: "donor\\same.mesh", changed: ["renderResourceBlob"], provider: "UV Framework", resourceSha256: sha(donorSame) }] });
  expect(JSON.parse(readFileSync(patched.meshFile, "utf8")).Data.RootChunk.boneNames[0].$value).toBe("PatchedRoot");
  const refused = await run(patchOf("donor\\other.mesh")).catch(error => error);
  expect(refused.code).toBe("plate_source_modded");
  expect(refused.message).toContain("UV Framework");
}));
