import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PackageBuildError, runPackageCommand, type PackageCommandOptions } from "../src/package-build-service";
import type { PackageResourceTools } from "../src/package-build-wolvenkit";
import { VERIFICATION_LIMITS, type VerificationReport, type VerifyBuildOptions } from "../src/mod-verifier/verify-build";
import { preparePackageCollection } from "../src/package-filter";
import { verifyPackageBuildResult } from "../src/package-result-verifier";
import type { PackageBuild } from "../src/package-action";
import type { EyePlateManifest } from "../src/eye-plate-service";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe } from "./eye-plate-fixture";

const PLATE = derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh");

const app = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(resolve(app, "../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-package-service-"))); // Canonical: CI temp folders use 8.3 short names.
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
        // A real single-chunk plate cut from the synthetic head, which the builder lifts.
        writeFileSync(join(output, stem + ".mesh.json"), JSON.stringify(PLATE.mesh));
        writeFileSync(join(output, stem + ".morphtarget.json"), JSON.stringify(PLATE.morph));
      }
      return step("serialize");
    },
    async deserialize(input, output) {
      for (const file of readdirSync(input)) writeFileSync(join(output, file.replace(/\.json$/, "")), readFileSync(join(input, file)));
      return step("deserialize");
    },
    async pack(_input, output) { writeFileSync(join(output, "archive.archive"), "packed fixture"); return step("pack"); },
  };
}

function fakeVerify(overrides: Partial<VerificationReport> = {}, seen: VerifyBuildOptions[] = []) {
  return (options: VerifyBuildOptions): VerificationReport => {
    seen.push(options);
    const build = JSON.parse(readFileSync(join(options.build, "build.json"), "utf8"));
    const xl = readFileSync(join(options.build, "package", "archive", "pc", "mod", build.plan.namespace + ".archive.xl"));
    return { presetCount: build.plan.presets.length, archiveSha256: build.archiveSha256, archiveXlSha256: sha(xl),
      plateInputs: { mesh: sha(readFileSync(options.plate!.mesh)), morph: sha(readFileSync(options.plate!.morph)) },
      unpackedFilesVerified: build.artifacts.length, limits: [...VERIFICATION_LIMITS], installed: false,
      presetRoutes: build.plan.presets.map((p: { id: string; route: string }) => ({ id: p.id, route: p.route })),
      plateGeometry: { liftsMm: build.plan.plate.liftsMm },
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
    source: { revisionId: "cp2077-2.31" }, verification: { morphTargets: 105 },
    files: { mesh: { sha256: sha("mesh fixture") }, morph: { sha256: sha("morph fixture") } } };
  writeFileSync(join(dir, "plate-manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(tools, "WolvenKit.CLI.exe"), "fixture");
  const source = JSON.stringify(collection);
  writeFileSync(join(dir, "collection.json"), source);
  const calls: string[] = [];
  const verified: VerifyBuildOptions[] = [];
  const options: PackageCommandOptions = { collection: join(dir, "collection.json"), plate, plateManifest: join(dir, "plate-manifest.json"),
    wolvenkit: join(tools, "WolvenKit.CLI.exe"), gamepath: game, appRoot: app, buildRoot: join(dir, "build"), distRoot: join(dir, "dist"),
    tools: () => fakeTools(calls), verify: fakeVerify({}, verified) };
  return { dir, options, calls, verified, source, manifest: manifest as unknown as EyePlateManifest };
}

test("Build promotes only a verified candidate with the full local-package manifest", async () => {
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  const { dir, options, calls, verified, source, manifest } = setup(collection);
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
  // Each packaged preset records the route the verifier re-derived from its recipe.
  expect(written.presets).toEqual(prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route })));
  // The plate lifts are recorded (the production lift; a diagnostic candidate records its own and each preset's knobs).
  expect(written.plateLiftsMm).toEqual([0.4]);
  expect(result.plateLiftsMm).toEqual([0.4]);
  expect(written.limits).toEqual([...VERIFICATION_LIMITS]);
  expect(readdirSync(join(result.package, "archive", "pc", "mod")).sort())
    .toEqual([`${prepared.plan.namespace}.archive`, `${prepared.plan.namespace}.archive.xl`]);
  expect(readFileSync(join(result.package, "archive", "pc", "mod", `${prepared.plan.namespace}.archive.xl`), "utf8"))
    .toContain("\r\nresource:\r\n");
  // No PNG copies, round trip or texture export: the independent verifier converts the unbundled members itself.
  const intermediate = join(dir, "build", basename(result.package));
  for (const folder of [["input", "colour"], ["export"], ["export-dds"], ["roundtrip"]])
    expect(existsSync(join(intermediate, ...folder))).toBe(false);
  expect(JSON.parse(readFileSync(join(intermediate, "build.json"), "utf8")).plateStem).toBe("xfs_eye_plate");
  // The plate is serialized first: its UVs decide the texture window the bake compiles into.
  expect(calls).toEqual(["serialize", "import", "import", "deserialize", "deserialize", "deserialize", "pack"]);
  // The verifier receives WolvenKit tools, the packaged collection, the host's plate files and hashes and the recipe's morph count.
  expect(verified).toHaveLength(1);
  expect(typeof verified[0].tools.exportTextures).toBe("function");
  expect(verified[0].packagedCollection).toEqual(JSON.parse(JSON.stringify(prepared.packaged)));
  expect(verified[0]).toMatchObject({ morphTargets: 105, plate: {
    mesh: join(options.plate!, "xfs_eye_plate.mesh"), morph: join(options.plate!, "xfs_eye_plate.morphtarget"),
    meshSha256: sha("mesh fixture"), morphSha256: sha("morph fixture") } });
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
  const otherPlate = setup();
  const plateError = await runPackageCommand({ ...otherPlate.options,
    verify: fakeVerify({ plateInputs: { mesh: "0".repeat(64), morph: "0".repeat(64) } }) }).catch(e => e);
  expect(plateError.message).toContain("does not match the build");
  const otherRoute = setup();
  const routeError = await runPackageCommand({ ...otherRoute.options, verify: fakeVerify({ presetRoutes: [] }) }).catch(e => e);
  expect(routeError.message).toContain("does not match the build");
  const otherLift = setup();
  const liftError = await runPackageCommand({ ...otherLift.options, verify: fakeVerify({ plateGeometry: { liftsMm: [0] } as VerificationReport["plateGeometry"] }) }).catch(e => e);
  expect(liftError.message).toContain("does not match the build");
  const otherXl = setup();
  const xlError = await runPackageCommand({ ...otherXl.options, verify: fakeVerify({ archiveXlSha256: "0".repeat(64) }) }).catch(e => e);
  expect(xlError.message).toContain("differs from the verified files");
  expect(readdirSync(join(otherXl.dir, "dist"))).toEqual([]);
  // Seven fake Builds, each baking the fixture into 2048 x 512 window maps (about 3 s each locally).
}, 180_000);

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
