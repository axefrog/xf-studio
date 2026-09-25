import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PackageBuildError, runPackageCommand, type PackageCommandOptions } from "../src/package-build-service";
import type { PackageResourceTools } from "../src/package-build-wolvenkit";
import { VERIFICATION_LIMITS, type VerificationReport } from "../src/mod-verifier/verify-build";
import { preparePackageCollection } from "../src/package-filter";
import { verifyPackageBuildResult } from "../src/package-result-verifier";
import type { PackageBuild } from "../src/package-action";
import type { EyePlateManifest } from "../src/eye-plate-service";

const app = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(resolve(app, "../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = mkdtempSync(join(tmpdir(), "xfs-package-service-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Stands in for WolvenKit: writes one placeholder resource per converted input, so the path gate sees the real plan. */
function fakeTools(calls: string[]): PackageResourceTools {
  const step = (name: string, exitCode = 0) => { calls.push(name); return { exitCode, log: `${name} ok` }; };
  return {
    async importTextures(input, output) {
      for (const file of readdirSync(input)) writeFileSync(join(output, file.replace(/\.dds$/, ".xbm")), readFileSync(join(input, file)));
      return step("import", 3);
    },
    async serialize(input, output) {
      if (readdirSync(input).some(name => name.endsWith(".mesh") && !name.includes("collection"))) {
        const stem = readdirSync(input).find(name => name.endsWith(".mesh"))!.replace(/\.mesh$/, "");
        writeFileSync(join(output, stem + ".mesh.json"), JSON.stringify({ Header: {}, Data: { RootChunk: {
          appearances: [], materialEntries: [], localMaterialBuffer: { materials: [], rawData: "x", rawDataHeaders: [1] } } } }));
        writeFileSync(join(output, stem + ".morphtarget.json"), JSON.stringify({ Header: {}, Data: { RootChunk: {} } }));
      }
      return step("serialize");
    },
    async deserialize(input, output) {
      for (const file of readdirSync(input)) writeFileSync(join(output, file.replace(/\.json$/, "")), readFileSync(join(input, file)));
      return step("deserialize");
    },
    async exportTextures() { return step("export"); },
    async pack(_input, output) { writeFileSync(join(output, "archive.archive"), "packed fixture"); return step("pack"); },
  };
}

function fakeVerify(overrides: Partial<VerificationReport> = {}) {
  return (options: { build: string }): VerificationReport => {
    const build = JSON.parse(readFileSync(join(options.build, "build.json"), "utf8"));
    return { presetCount: build.plan.presets.length, archiveSha256: build.archiveSha256,
      unpackedFilesVerified: build.artifacts.length, limits: [...VERIFICATION_LIMITS], installed: false,
      gameRenderingVerified: false, ...overrides } as VerificationReport;
  };
}

function setup(collection: unknown = fixture) {
  const dir = resolve(root, crypto.randomUUID());
  const plate = join(dir, "plate"), game = join(dir, "game"), tools = join(dir, "tools");
  for (const path of [plate, game, tools]) mkdirSync(path, { recursive: true });
  writeFileSync(join(plate, "xfs_eye_plate.mesh"), "mesh fixture");
  writeFileSync(join(plate, "xfs_eye_plate.morphtarget"), "morph fixture");
  const manifest = { schema: "xfs/eye-plate-cache-1", recipeId: "xfs-expanded-eye-plate", recipeRevision: 1, cacheKey: "c".repeat(64),
    source: { revisionId: "cp2077-2.31" },
    files: { mesh: { sha256: sha("mesh fixture") }, morph: { sha256: sha("morph fixture") } } };
  writeFileSync(join(dir, "plate-manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(tools, "WolvenKit.CLI.exe"), "fixture");
  const source = JSON.stringify(collection);
  writeFileSync(join(dir, "collection.json"), source);
  const calls: string[] = [];
  const options: PackageCommandOptions = { collection: join(dir, "collection.json"), plate, plateManifest: join(dir, "plate-manifest.json"),
    wolvenkit: join(tools, "WolvenKit.CLI.exe"), gamepath: game, appRoot: app, buildRoot: join(dir, "build"), distRoot: join(dir, "dist"),
    tools: () => fakeTools(calls), verify: fakeVerify() };
  return { dir, options, calls, source, manifest: manifest as unknown as EyePlateManifest };
}

test("Build promotes only a verified candidate with the full local-package manifest", async () => {
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  const { dir, options, calls, source, manifest } = setup(collection);
  const result = await runPackageCommand(options) as PackageBuild;
  const prepared = preparePackageCollection(collection);
  // The shared host gate accepts it, including the exact prepared-plate identity.
  verifyPackageBuildResult(result, prepared.source, prepared, source, join(dir, "dist"), { ...manifest,
    files: { mesh: { sha256: sha("mesh fixture") }, morph: { sha256: sha("morph fixture") } } } as EyePlateManifest);
  const written = JSON.parse(readFileSync(result.manifest, "utf8"));
  expect(written).toMatchObject({ schema: "xfs/local-package-1", modName: prepared.plan.modName, selectorLabel: prepared.plan.selectorLabel,
    collectionSha256: sha(source), originalPresetCount: 4, verifiedPresetCount: 3, verifiedUnpackedFiles: 13,
    omissions: prepared.omissions, installed: false, gameRenderingVerified: false,
    plate: { source: "derived", cacheKey: "c".repeat(64), sourceRevision: "cp2077-2.31" } });
  expect(written.limits).toEqual([...VERIFICATION_LIMITS]);
  expect(readdirSync(join(result.package, "archive", "pc", "mod")).sort())
    .toEqual([`${prepared.plan.namespace}.archive`, `${prepared.plan.namespace}.archive.xl`]);
  expect(readFileSync(join(result.package, "archive", "pc", "mod", `${prepared.plan.namespace}.archive.xl`), "utf8"))
    .toContain("\r\nresource:\r\n");
  // No PNG copies or PNG export: the TypeScript verifier reads the raw maps and the DDS export.
  const intermediate = join(dir, "build", basename(result.package));
  expect(existsSync(join(intermediate, "input", "colour"))).toBe(false);
  expect(existsSync(join(intermediate, "export"))).toBe(false);
  expect(JSON.parse(readFileSync(join(intermediate, "build.json"), "utf8")).plateStem).toBe("xfs_eye_plate");
  expect(calls).toEqual(["import", "import", "serialize", "deserialize", "deserialize", "deserialize", "serialize", "export", "pack"]);
  expect(readdirSync(join(dir, "build")).filter(name => name.startsWith("source-"))).toEqual([]);
  expect(readdirSync(join(dir, "dist")).filter(name => name.startsWith(".staging-"))).toEqual([]);
}, 60_000);

test("a failed or mismatched independent verification publishes no candidate", async () => {
  const failing = setup();
  failing.options = { ...failing.options, verify: () => { throw Error("tampered mip byte"); } };
  const error = await runPackageCommand(failing.options).catch(e => e);
  expect(error).toBeInstanceOf(PackageBuildError);
  expect(error.code).toBe("package_verification_failed");
  expect(error.message).toContain("tampered mip byte");
  expect(existsSync(join(failing.dir, "dist"))).toBe(false);
  const mismatched = setup();
  const wrong = await runPackageCommand({ ...mismatched.options, verify: fakeVerify({ presetCount: 3 }) }).catch(e => e);
  expect(wrong.message).toContain("does not match the build");
  expect(existsSync(join(mismatched.dir, "dist"))).toBe(false);
}, 60_000);

test("a cancelled Build stops before conversion and publishes nothing", async () => {
  const { dir, options, calls } = setup();
  const controller = new AbortController();
  const pending = runPackageCommand({ ...options, signal: controller.signal });
  controller.abort();
  const error = await pending.catch(e => e);
  expect(error.code).toBe("package_build_cancelled");
  expect(calls).toEqual([]);
  expect(existsSync(join(dir, "dist"))).toBe(false);
  expect(readdirSync(join(dir, "build")).filter(name => name.startsWith("source-"))).toEqual([]);
}, 60_000);

test("Check needs no plate, WolvenKit or game and writes nothing", async () => {
  const { dir, options } = setup();
  const result = await runPackageCommand({ collection: options.collection, check: true, appRoot: app,
    buildRoot: options.buildRoot, distRoot: options.distRoot });
  expect(result).toMatchObject({ ready: true, originalPresetCount: 4 });
  expect(existsSync(join(dir, "build"))).toBe(false);
  expect(existsSync(join(dir, "dist"))).toBe(false);
});
