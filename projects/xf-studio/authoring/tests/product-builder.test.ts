import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runProductCommand, type ProductCommandOptions } from "../src/platform/export/product-builder";
import { verifyProductBuildResult } from "../src/platform/export/product-host";
import { checkProducts } from "../src/platform/export/product-check";
import { ExportRefusal, PrerequisiteStale, type PackageBuildResult, type PackageCheckResult } from "../src/platform/api";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { VERIFICATION_LIMITS } from "../src/features/eye-makeup/verify";
import { packagePlateRecord, type EyePlateManifest } from "../src/eye-plate-service";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { OFF_PLATE_REASON } from "../src/package-filter";
import { preparePackageCollection } from "./fixtures/eye-exporter";
import { eyeEntry, fakeEyeVerifier, fakeTools, fakeVerifierTools, FOOTPRINT, sha, writePlate } from "./fixtures/product-fixture";

const app = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(resolve(app, "../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-product-builder-"))); // Canonical: CI temp folders use 8.3 short names.
afterAll(() => rmSync(root, { recursive: true, force: true }));

function setup(collection: unknown = fixture, recordFootprint = true) {
  const dir = resolve(root, crypto.randomUUID());
  const game = join(dir, "game"), tools = join(dir, "tools");
  for (const path of [game, tools]) mkdirSync(path, { recursive: true });
  const { plate, manifestFile, manifest } = writePlate(dir, recordFootprint);
  writeFileSync(join(tools, "WolvenKit.CLI.exe"), "fixture");
  const source = JSON.stringify(collection);
  writeFileSync(join(dir, "collection.json"), source);
  const calls: string[] = [], packed = new Map<string, string>(), verified: Parameters<ReturnType<typeof fakeEyeVerifier>["verify"]>[0][] = [];
  const options: ProductCommandOptions = { exporters: [eyeEntry(fakeEyeVerifier(verified))], collection: join(dir, "collection.json"),
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { directory: plate, manifest: manifestFile } },
    wolvenkit: join(tools, "WolvenKit.CLI.exe"), gamepath: game, appRoot: app, buildRoot: join(dir, "build"), distRoot: join(dir, "dist"),
    tools: () => fakeTools(calls, packed), verifierTools: () => fakeVerifierTools(packed) };
  return { dir, options, calls, verified, source, packed, manifest: manifest as unknown as EyePlateManifest, plate, manifestFile };
}
/** The host's own plan of a collection on the fixture plate (what the result gate compares with). */
const hostPlan = (collection: unknown, source: string, manifest: EyePlateManifest) => checkProducts({ collection, exporters: [eyeEntry()],
  prerequisites: { [EYE_PLATE_PREREQUISITE]: { ...plateReachInput(FOOTPRINT), record: packagePlateRecord(manifest) } },
  diagnostics: false, preflight: false, collectionSha256: sha(source) });

test("Build promotes only a verified candidate per product with the full local-package-2 manifest", async () => {
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  const { dir, options, calls, verified, source, manifest, plate } = setup(collection);
  const result = await runProductCommand(options) as PackageBuildResult;
  const prepared = preparePackageCollection(collection, plateReachInput(FOOTPRINT));
  // The shared host gate accepts it: the same products, looks, omissions and prepared-plate identity as the host's own plan.
  verifyProductBuildResult(result, hostPlan(collection, source, manifest), join(dir, "dist"));
  expect(result.products).toHaveLength(1);
  const [product] = result.products;
  expect(product).toMatchObject({ productId: collection.id, modName: "XF Eye Artistry", nameSource: "derived", isDefault: true,
    archive: prepared.plan.namespace, installed: false, gameRenderingVerified: false });
  const written = JSON.parse(readFileSync(product.manifest, "utf8"));
  // Whole looks left out are the product's (decided once by the host); the feature keeps its own layers (PIPE-88).
  const wholeLooks = prepared.omissions.filter(item => item.kind === "preset"), own = prepared.omissions.filter(item => item.kind !== "preset");
  expect(written.omissions).toEqual(wholeLooks);
  expect(written).toMatchObject({ schema: "xfs/local-package-2", productId: collection.id, modName: prepared.plan.modName,
    archive: prepared.plan.namespace, collectionSha256: sha(source), originalPresetCount: 4, verifiedUnpackedFiles: 13,
    installed: false, gameRenderingVerified: false, requirements: { ArchiveXL: "1.27.3", game: "2.31" } });
  const [feature] = written.features;
  expect(feature).toMatchObject({ feature: "eye-makeup", exporter: "eye-makeup/mesh-decal", namespace: prepared.plan.namespace,
    selectorLabel: prepared.plan.selectorLabel, selector: "own", omissions: own,
    packagedSha256: sha(JSON.stringify(prepared.packaged)), planSha256: sha(JSON.stringify(prepared.plan)),
    details: { plateLiftsMm: [0.4], plateUv: prepared.plateUv, plate: { source: "derived", cacheKey: "c".repeat(64), sourceRevision: "cp2077-2.31" } },
    verification: { presetCount: 3, verifiedFiles: 13, limits: [...VERIFICATION_LIMITS] } });
  // Each packaged preset records the route the verifier re-derived from its recipe.
  expect(feature.presets).toEqual(prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route })));
  expect(readdirSync(join(product.package, "archive", "pc", "mod")).sort())
    .toEqual([`${prepared.plan.namespace}.archive`, `${prepared.plan.namespace}.archive.xl`]);
  // A product holding only eye makeup declares exactly what the eye-makeup builder always declared.
  expect(readFileSync(join(product.package, "archive", "pc", "mod", `${prepared.plan.namespace}.archive.xl`), "utf8")).toBe(
    ["customizations:", "  female: " + prepared.plan.customization.replaceAll("/", "\\"), "resource:", "  scope:",
      "    player_customization.app:", "      - " + prepared.plan.app.replaceAll("/", "\\"), ""].join("\r\n"));
  const intermediate = join(dir, "build", basename(product.package));
  expect(JSON.parse(readFileSync(join(intermediate, "features", "eye-makeup", "build.json"), "utf8")).plateStem).toBe("xfs_eye_plate");
  // The plate is serialized first (its UVs decide the texture window), every resource document converts in one launch
  // (PIPE-130), and the host packs once.
  expect(calls).toEqual(["serialize", "import", "import", "deserialize", "pack"]);
  // The feature verifier gets its work folder, the unpacked product, WolvenKit tools, the packaged snapshot and the plate.
  expect(verified).toHaveLength(1);
  expect(typeof verified[0].tools.exportTextures).toBe("function");
  expect(verified[0].packaged).toEqual(JSON.parse(JSON.stringify(prepared.packaged)));
  expect(verified[0].unpacked.files).toHaveLength(13);
  expect(verified[0].unpacked.features).toBe(1);
  expect(verified[0].prerequisites[EYE_PLATE_PREREQUISITE]).toMatchObject({ mesh: join(realpathSync.native(plate), "xfs_eye_plate.mesh"),
    morphTargets: 105, record: { meshSha256: sha("mesh fixture"), morphSha256: sha("morph fixture") } });
  expect(readdirSync(join(dir, "dist")).filter(name => name.startsWith(".staging-"))).toEqual([]);
}, 60_000);

test("a failed or mismatched independent verification publishes no candidate", async () => {
  const failing = setup();
  const error = await runProductCommand({ ...failing.options, exporters: [eyeEntry({ exporterId: "eye-makeup/mesh-decal",
    verify: () => { throw Error("tampered mip byte"); } })] }).catch(e => e);
  expect(error).toBeInstanceOf(ExportRefusal);
  expect(error.code).toBe("package_verification_failed");
  expect(error.message).toContain("tampered mip byte");
  expect(existsSync(join(failing.dir, "dist"))).toBe(false);
  for (const overrides of [{ presetCount: 3 }, { report: { plateInputs: { mesh: "0".repeat(64), morph: "0".repeat(64) } } },
    { report: { presetRoutes: [] } }, { report: { plateGeometry: { liftsMm: [0] } } }]) {
    const run = setup();
    const wrong = await runProductCommand({ ...run.options, exporters: [eyeEntry(fakeEyeVerifier([], overrides))] }).catch(e => e);
    expect(wrong.message).toContain("does not match the build");
    expect(existsSync(join(run.dir, "dist"))).toBe(false);
  }
  // An archive whose unbundled members differ from the features' records is refused by the product verifier.
  const tampered = setup();
  const tools = fakeVerifierTools(tampered.packed);
  const altered = { ...tools, unbundle: (archive: string, output: string) => {
    const result = tools.unbundle(archive, output);
    writeFileSync(join(output, "extra.xbm"), "x");
    return result;
  } };
  const extra = await runProductCommand({ ...tampered.options, verifierTools: () => altered }).catch(e => e);
  expect(extra.code).toBe("package_verification_failed");
  expect(extra.message).toContain("unpacked");
  // Six fake Builds, each baking the fixture into 2048 x 512 window maps (about 3 s each locally).
}, 180_000);

test("a cancelled Build stops before conversion and publishes nothing", async () => {
  const { dir, options, calls } = setup();
  const controller = new AbortController();
  const pending = runProductCommand({ ...options, signal: controller.signal });
  controller.abort();
  const error = await pending.catch(e => e);
  expect(error.code).toBe("package_build_cancelled");
  expect(calls).toEqual([]);
  expect(existsSync(join(dir, "dist"))).toBe(false);
}, 60_000);

test("Check needs no plate, WolvenKit or game and writes nothing", async () => {
  const { dir, options } = setup();
  const result = await runProductCommand({ ...options, check: true, prerequisites: {}, wolvenkit: undefined, gamepath: undefined }) as PackageCheckResult;
  expect(result).toMatchObject({ schema: "xfs/package-check-2", ready: true, originalPresetCount: 4, collectionId: fixture.id });
  expect(result.products.map(product => product.modName)).toEqual(["XF Eye Artistry"]);
  expect(existsSync(join(dir, "build"))).toBe(false);
  expect(existsSync(join(dir, "dist"))).toBe(false);
});

test("a collection carrying diagnostic knobs builds only with --diagnostics", async () => {
  const { options, dir } = setup({ ...fixture, diagnostics: { schema: "xfs/export-diagnostics-1", presets: {} } });
  const error = await runProductCommand({ ...options, check: true }).catch(e => e);
  expect(error.code).toBe("invalid_collection");
  expect(error.message).toContain("diagnostic export knobs");
  expect(existsSync(join(dir, "dist"))).toBe(false);
});

/** The fixture with its second preset moved below the eye plate (every point 0.4 lower in authored v). */
const offPlate = () => {
  const collection = structuredClone(fixture);
  for (const layer of collection.presets[1].recipe.layers)
    layer.points = layer.points.map((p: { v: number }) => ({ ...p, v: p.v + .4 }));
  return collection;
};

test("PIPE-33: Check with the prepared plate and Build both omit a preset that misses the plate, and record the plate", async () => {
  const collection = offPlate();
  const { dir, options, source, manifest } = setup(collection);
  const expected = preparePackageCollection(collection, plateReachInput(FOOTPRINT));
  expect(expected.omissions).toEqual([{ kind: "preset", presetId: collection.presets[1].id, presetName: collection.presets[1].name,
    reason: OFF_PLATE_REASON }]);
  // Check planned on the prepared plate's manifest agrees with Build; Check without a plate cannot judge it.
  const check = await runProductCommand({ ...options, check: true }) as PackageCheckResult;
  // A look no feature packages is left out whole: the host reports it once, in the result and the product (PIPE-88).
  expect(check.omissions).toEqual(expected.omissions);
  expect(check.products[0].omissions).toEqual(expected.omissions);
  expect(check.products[0].features[0].omissions).toEqual([]);
  expect(check.products[0].features[0].details.plateUv).toEqual(expected.plateUv);
  const blind = await runProductCommand({ ...options, check: true, prerequisites: {} }) as PackageCheckResult;
  expect(blind.omissions).toEqual([]);
  expect(blind.products[0].features[0].details.plateUv).toBeNull();
  const result = await runProductCommand(options) as PackageBuildResult;
  const feature = result.products[0].features[0];
  expect(result.omissions).toEqual(expected.omissions);
  expect(feature.omissions).toEqual([]);
  expect(feature.packagedSha256).toBe(check.products[0].features[0].packagedSha256);
  expect(feature.details.plateUv).toEqual(expected.plateUv!);
  const written = JSON.parse(readFileSync(result.products[0].manifest, "utf8"));
  expect(written.omissions).toEqual(expected.omissions);
  expect(written.features[0]).toMatchObject({ omissions: [], details: { plateUv: expected.plateUv }, verification: { presetCount: 3 } });
  verifyProductBuildResult(result, hostPlan(collection, source, manifest), join(dir, "dist"));
  // The host's gate refuses a result judged against another plate (or none).
  const unplanned = checkProducts({ collection, exporters: [eyeEntry()], prerequisites: {}, diagnostics: false, preflight: false,
    collectionSha256: sha(source) });
  expect(() => verifyProductBuildResult(result, unplanned, join(dir, "dist"))).toThrow("does not match this collection snapshot");
  // build.json records the footprint of the plate the builder serialized.
  const record = JSON.parse(readFileSync(join(dir, "build", basename(result.products[0].package), "features", "eye-makeup", "build.json"), "utf8"));
  expect(record.plateUv.footprintSha256).toBe(plateReachInput(FOOTPRINT).sha256);
}, 60_000);

test("PIPE-33: a plate without a recorded footprint is read from its mesh; a footprint of another plate is stale", async () => {
  const { options, calls } = setup(offPlate(), false);
  const result = await runProductCommand(options) as PackageBuildResult;
  // One extra WolvenKit read of the plate mesh comes first; the omission is the same.
  expect(calls[0]).toBe("serialize");
  expect(calls.filter(call => call === "serialize")).toHaveLength(2);
  const feature = result.products[0].features[0];
  expect(result.omissions.map(item => item.kind === "preset" && item.reason)).toEqual([OFF_PLATE_REASON]);
  expect((feature.details.plateUv as { footprintSha256: string }).footprintSha256).toBe(plateReachInput(FOOTPRINT).sha256);
  // A manifest recording some other plate's footprint: the builder's own serialization disagrees, so nothing is built.
  const other = setup();
  const moved = { ...FOOTPRINT, uv: FOOTPRINT.uv.map((v, i) => i % 2 ? v : v + .001) };
  writeFileSync(join(other.dir, PLATE_UV_FILE), JSON.stringify(moved));
  writeFileSync(other.manifestFile, JSON.stringify({ ...other.manifest, uv: plateUvManifestRecord(moved) }));
  const error = await runProductCommand(other.options).catch(e => e);
  expect(error).toBeInstanceOf(PrerequisiteStale); // the hosts discard the cached plate and build once more (PIPE-37)
  expect(error.code).toBe("package_prerequisite_stale");
  expect(error.prerequisite).toBe(EYE_PLATE_PREREQUISITE);
  expect(error.message).toContain("recorded UV footprint differs from the plate itself");
  expect(existsSync(join(other.dir, "dist"))).toBe(false);
  // A damaged footprint file is a plain error, before anything is built.
  const damaged = setup();
  writeFileSync(join(damaged.dir, PLATE_UV_FILE), "{}");
  const damagedError = await runProductCommand(damaged.options).catch(e => e);
  expect(damagedError.code).toBe("package_plate_mismatch");
  expect(damagedError.message).toContain("recorded UV footprint is damaged");
  expect(existsSync(join(damaged.dir, "build"))).toBe(false); // nothing is written before the inputs are known good
}, 60_000);

test("the result gate keeps every result inside the local dist folder, through links and 8.3 names (PIPE-08, PIPE-31)", async () => {
  const { dir, options, source, manifest } = setup();
  const result = await runProductCommand(options) as PackageBuildResult;
  const planned = hostPlan(fixture, source, manifest), dist = join(dir, "dist");
  const [product] = result.products;
  const moved = (pkg: string) => ({ ...result, products: [{ ...product, package: pkg, manifest: join(pkg, "manifest.json") }] }) as PackageBuildResult;
  const link = (target: string, path: string) => symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
  verifyProductBuildResult(result, planned, dist);
  // The dist folder named through a link, or written in another case on Windows, is the same folder.
  const outside = join(dir, "outside");
  mkdirSync(outside);
  link(dist, join(outside, "dist-link"));
  verifyProductBuildResult(result, planned, join(outside, "dist-link"));
  if (process.platform === "win32") verifyProductBuildResult(result, planned, dist.toUpperCase());
  // An outside path that reaches the real package through a link is refused.
  expect(() => verifyProductBuildResult(moved(join(outside, "dist-link", basename(product.package))), planned, dist)).toThrow("outside the local dist");
  // A missing result is refused with the same plain error.
  expect(() => verifyProductBuildResult(moved(join(dist, "missing")), planned, dist)).toThrow("outside the local dist");
  // A dist root written as its 8.3 short name still holds the result's long-form path.
  if (process.platform === "win32") {
    const probe = spawnSync("cmd.exe", ["/d", "/c", `for %I in ("${dist}") do @echo %~sI`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
    const short = probe.status === 0 ? probe.stdout.trim() : "";
    if (short && short.toLowerCase() !== dist.toLowerCase()) verifyProductBuildResult(result, planned, short);
  }
  // A package folder inside dist that is a link leading out is refused.
  const away = join(outside, "away");
  renameSync(product.package, away);
  link(away, product.package);
  expect(() => verifyProductBuildResult(result, planned, dist)).toThrow(/outside the local dist/);
}, 60_000);

test("the manifest and build record say which writer made each file when the tools write natively (PIPE-130)", async () => {
  const { dir, options, calls, packed, source, manifest } = setup();
  // The fake tools, reporting every converted file and the pack as native except one texture WolvenKit made.
  const tools = () => {
    const base = fakeTools(calls, packed), native: string[] = [], wolvenkit: { file: string; reason: string }[] = [];
    return { ...base,
      async importTextures(input: string, output: string, settings: Parameters<typeof base.importTextures>[2]) {
        const step = await base.importTextures(input, output, settings);
        for (const name of readdirSync(input)) {
          const file = name.replace(/\.dds$/, ".xbm");
          if (native.length === 0 && wolvenkit.length === 0) wolvenkit.push({ file, reason: "test refusal" }); else native.push(file);
        }
        return step;
      },
      async deserialize(input: string | readonly string[], output: string) {
        const step = await base.deserialize(input, output);
        for (const folder of [input].flat()) for (const name of readdirSync(folder)) native.push(name.replace(/\.json$/, ""));
        return step;
      },
      async pack(input: string, output: string) { const step = await base.pack(input, output); native.push("archive"); return step; },
      writers: () => ({ native: [...native], wolvenkit: [...wolvenkit] }),
    };
  };
  const result = await runProductCommand({ ...options, tools }) as PackageBuildResult;
  // The host's result gate accepts a manifest that records its writers.
  verifyProductBuildResult(result, hostPlan(fixture, source, manifest), join(dir, "dist"));
  const written = JSON.parse(readFileSync(result.products[0]!.manifest, "utf8"));
  const writers = written.resourceWriters as { native: string[]; wolvenkit: { path: string; reason: string }[] };
  expect(writers.native).toContain("archive");
  expect(writers.native.filter(path => path !== "archive").every(path => path.includes("/"))).toBe(true);
  expect(writers.wolvenkit).toHaveLength(1);
  expect(writers.wolvenkit[0]!.path).toMatch(/\/textures\/.+\.xbm$/);
  expect(writers.wolvenkit[0]!.reason).toBe("test refusal");
  // Every packed resource is accounted for once.
  expect(writers.native.length - 1 + writers.wolvenkit.length).toBe(written.verifiedUnpackedFiles);
  // Without a report (WolvenKit's tools), the manifest has none.
  const plain = setup();
  const before = await runProductCommand(plain.options) as PackageBuildResult;
  expect(JSON.parse(readFileSync(before.products[0]!.manifest, "utf8")).resourceWriters).toBeUndefined();
  // Two whole Builds of the four-preset fixture: about 2 s locally, over the 5 s default on CI's Ubuntu runner.
}, 60_000);
