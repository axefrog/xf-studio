/**
 * Several features and several products through the real export host (feature-module platform §6): eye makeup's
 * exporter beside a stub second feature (lips), merged into one mod by default and split into two when the
 * collection's package plan says so; the namespace-duplication and cross-feature conflict refusals; the manifest
 * reader for versions 1 and 2.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProductCommand } from "../src/platform/export/product-builder";
import { checkProducts } from "../src/platform/export/product-check";
import { duplicatedNamespaces, readPackageManifest } from "../src/platform/export/manifest";
import { verifyProductBuildResult } from "../src/platform/export/product-host";
import { archiveXlText, ExportRefusal, NEWER_PLAN_MESSAGE, NOTHING_PACKAGED_REASON, PACKAGE_PLAN_1, resultOmissions, type FeatureExporter,
  type PackageBuildResult, type PackageCheckResult } from "../src/platform/api";
import { describePackageCheck } from "../src/package-filter";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { EYE_MAKEUP_EXPORTER as EYE_EXPORTER } from "../src/features/eye-makeup/export";
import { packagePlateRecord, type EyePlateManifest } from "../src/eye-plate-service";
import { plateReachInput } from "../src/plate-uv-footprint-io";
import { eyeEntry, fakeEyeVerifier, fakeTools, fakeVerifierTools, FOOTPRINT, LIPS, LIPS_ENTRY, LIPS_EXPORTER, sha, writePlate } from "./fixtures/product-fixture";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-product-export-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const OTHER = "11111111-2222-4333-8444-555555555555";
const key = (id: string) => id.replaceAll("-", "");

/** The four-preset fixture as collection-2 looks, each also holding a lips part. */
function looks(packagePlan?: unknown) {
  return { schema: "xfs/collection-2", id: fixture.id, name: fixture.name, ...(packagePlan ? { packagePlan } : {}),
    presets: fixture.presets.map((preset: { id: string; name: string; revision: number; recipe: unknown }) => ({ id: preset.id, name: preset.name,
      revision: preset.revision, parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: preset.recipe },
        [LIPS]: { schema: "xfs/lips-part-1", body: { shades: ["#aa3355"] } } } })) };
}

async function build(collection: unknown) {
  const { result, calls, seen } = await buildWithPlan(collection);
  return { result, calls, seen };
}

/** A Build through the real export host, and the host's own plan of it (which the result gate compares with). */
async function buildWithPlan(collection: unknown) {
  const dir = resolve(root, crypto.randomUUID());
  mkdirSync(join(dir, "game"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  const { plate, manifestFile, manifest } = writePlate(dir);
  writeFileSync(join(dir, "tools", "WolvenKit.CLI.exe"), "fixture");
  const source = JSON.stringify(collection);
  writeFileSync(join(dir, "collection.json"), source);
  const calls: string[] = [], packed = new Map<string, string>(), seen: Parameters<ReturnType<typeof fakeEyeVerifier>["verify"]>[0][] = [];
  const exporters = [eyeEntry(fakeEyeVerifier(seen)), LIPS_ENTRY];
  const result = await runProductCommand({ exporters, collection: join(dir, "collection.json"),
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { directory: plate, manifest: manifestFile } },
    wolvenkit: join(dir, "tools", "WolvenKit.CLI.exe"), gamepath: join(dir, "game"), appRoot: resolve(import.meta.dir, ".."),
    buildRoot: join(dir, "build"), distRoot: join(dir, "dist"), tools: () => fakeTools(calls, packed), verifierTools: () => fakeVerifierTools(packed) }) as PackageBuildResult;
  // The host's own plan of the same snapshot on the same plate: the result gate must accept the builder's answer.
  const expected = checkProducts({ collection, exporters, diagnostics: false, preflight: false, collectionSha256: sha(source),
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { ...plateReachInput(FOOTPRINT), record: packagePlateRecord(manifest as unknown as EyePlateManifest) } } });
  verifyProductBuildResult(result, expected, join(dir, "dist"));
  return { result, calls, seen, planned: expected, root: join(dir, "dist") };
}

test("by default two features merge into one XF Looks mod: one pack, one merged declaration, each feature verified on its subset", async () => {
  const { result, calls, seen } = await build(looks());
  expect(result.products).toHaveLength(1);
  const [product] = result.products;
  expect(product).toMatchObject({ productId: fixture.id, isDefault: true, modName: "XF Looks", nameSource: "derived", archive: `xfs_c${key(fixture.id)}` });
  expect(product.features.map(feature => [feature.feature, feature.selectorLabel, feature.selector])).toEqual([
    ["eye-makeup", "XF", "own"], [LIPS, "XF Lips", "vanilla"]]);
  // Framework requirements take the highest version per framework.
  expect(product.requirements).toEqual({ ArchiveXL: "1.28.0", game: "2.31" });
  expect(calls.filter(call => call === "pack")).toHaveLength(1);
  // The eye verifier sees the whole unpacked product and knows it is not alone.
  expect(seen[0].unpacked.features).toBe(2);
  expect(seen[0].unpacked.files).toHaveLength(16 + 1 + 4);
  const manifest = JSON.parse(readFileSync(product.manifest, "utf8"));
  expect(manifest.features.map((feature: { feature: string; namespace: string }) => [feature.feature, feature.namespace]))
    .toEqual([["eye-makeup", `xfs_c${key(fixture.id)}`], [LIPS, `xfs_c${key(fixture.id)}_lips`]]);
  expect(manifest.verifiedUnpackedFiles).toBe(21);
  const xl = readFileSync(join(product.package, "archive", "pc", "mod", `${product.archive}.archive.xl`), "utf8");
  expect((Bun.YAML.parse(xl) as { resource: { scope: Record<string, string[]> } }).resource.scope["player_customization.app"]).toHaveLength(2);
  expect(readPackageManifest(manifest, "eye-makeup").features.map(feature => feature.feature)).toEqual(["eye-makeup", LIPS]);
}, 60_000);

test("splitting lips into its own mod builds two verified products; eye makeup's archive is unchanged by the move", async () => {
  const split = await build(looks({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS] }] }));
  expect(split.result.products.map(product => [product.productId, product.modName, product.archive, product.features.map(feature => feature.feature)]))
    .toEqual([[fixture.id, "XF Eye Artistry", `xfs_c${key(fixture.id)}`, ["eye-makeup"]],
      [OTHER, "XF Lip Artistry", `xfs_m${key(OTHER)}`, [LIPS]]]);
  expect(split.calls.filter(call => call === "pack")).toHaveLength(2);
  const [eyes, lips] = split.result.products;
  // Eye makeup alone declares exactly its own fragment; its namespace and looks are the same as in the merged mod.
  const eyesXl = readFileSync(join(eyes.package, "archive", "pc", "mod", `${eyes.archive}.archive.xl`), "utf8");
  expect(eyesXl).toStartWith("customizations:\r\n  female: ");
  expect(readFileSync(join(lips.package, "archive", "pc", "mod", `${lips.archive}.archive.xl`), "utf8"))
    .toBe(archiveXlText({ scope: { "player_customization.app": [`axefrog/xf_studio/${key(fixture.id)}/lips/xfs_lips.app`] } }));
  const merged = await build(looks());
  expect(eyes.features[0]).toEqual(merged.result.products[0].features[0]);
  // Each candidate folder is its own mod: the two manifests name disjoint namespaces.
  const manifests = split.result.products.map(product => readPackageManifest(JSON.parse(readFileSync(product.manifest, "utf8")), "eye-makeup"));
  expect(duplicatedNamespaces(manifests[1], [manifests[0]])).toEqual([]);
}, 90_000);

test("namespace duplication is refused: a feature in two mods, or an installed mod already holding a feature's namespace", () => {
  const twice = looks({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS] },
    { id: "22222222-2222-4333-8444-555555555555", features: [LIPS] }] });
  const refused = (() => { try { checkProducts({ collection: twice, exporters: [eyeEntry(), LIPS_ENTRY], prerequisites: {}, diagnostics: false,
    preflight: false, collectionSha256: "0" }); } catch (error) { return error as { code: string; message: string }; } })();
  expect(refused?.code).toBe("namespace_duplicated");
  expect(refused?.message).toContain("can go into only one mod");
  // Installing a product whose feature namespace another installed XF mod already holds (a move not yet replaced).
  const installed = [{ features: [{ feature: "eye-makeup", namespace: `xfs_c${key(fixture.id)}` }] }];
  expect(duplicatedNamespaces({ features: [{ feature: "eye-makeup", namespace: `xfs_c${key(fixture.id)}` }] }, installed))
    .toEqual([`xfs_c${key(fixture.id)}`]);
  // Two features claiming one namespace or one depot path are refused at Check, whatever products they ship in.
  const clash: FeatureExporter = { ...LIPS_EXPORTER as FeatureExporter, plan: input => {
    const outcome = LIPS_EXPORTER.plan(input);
    return { ...outcome, check: { ...outcome.check, namespace: `xfs_c${key(fixture.id)}` } };
  } };
  const conflict = (() => { try { checkProducts({ collection: looks(), exporters: [eyeEntry(), { ...LIPS_ENTRY, exporter: clash }], prerequisites: {},
    diagnostics: false, preflight: false, collectionSha256: "0" }); } catch (error) { return error as ExportRefusal; } })()!;
  // The person sees the features' labels in plain words; the namespace is kept for the host log (PIPE-93).
  expect(conflict).toMatchObject({ code: "package_conflict", message: expect.stringContaining("Eye makeup and Lip makeup would use the same names in the game's files") });
  expect(String(conflict.message).includes("xfs_c")).toBe(false);
  expect(conflict.detail).toBe(`eye-makeup and lips use the same namespace xfs_c${key(fixture.id)}.`);
  // Two features writing one depot path: the same, with the path in the detail only.
  const writes: FeatureExporter = { ...LIPS_EXPORTER as FeatureExporter, plan: input => {
    const outcome = LIPS_EXPORTER.plan(input), eyes = EYE_EXPORTER.plan(input);
    return { ...outcome, inventory: [...outcome.inventory, eyes.inventory[0]].sort() };
  } };
  const path = (() => { try { checkProducts({ collection: looks(), exporters: [eyeEntry(), { ...LIPS_ENTRY, exporter: writes }], prerequisites: {},
    diagnostics: false, preflight: false, collectionSha256: "0" }); } catch (error) { return error as ExportRefusal; } })()!;
  expect(String(path.message)).toContain("Eye makeup and Lip makeup would write the same game file");
  expect(String(path.message).includes("/")).toBe(false);
  expect(String(path.detail)).toContain("both write axefrog/");
});

test("a feature with nothing to package is reported and left out; the other still builds", () => {
  const collection = looks();
  for (const look of collection.presets) look.parts["eye-makeup"].body = { ...look.parts["eye-makeup"].body as object,
    layers: (look.parts["eye-makeup"].body as { layers: { finish: string }[] }).layers.map(layer => ({ ...layer, finish: "glitter" })) };
  const { result } = checkProducts({ collection, exporters: [eyeEntry(), LIPS_ENTRY], prerequisites: {}, diagnostics: false, preflight: true,
    collectionSha256: "0" }) as { result: PackageCheckResult };
  expect(result.products.map(product => [product.modName, product.features.map(feature => feature.feature)])).toEqual([["XF Looks", [LIPS]]]);
  expect(result.omissions).toEqual([expect.objectContaining({ kind: "feature", feature: "eye-makeup", label: "Eye makeup" })]);
});

test("the manifest reader accepts local-package-1 (eye makeup's one-feature form) and local-package-2", () => {
  const files = (archive: string) => [{ path: `archive/pc/mod/${archive}.archive`, sha256: "a".repeat(64), bytes: 10 },
    { path: `archive/pc/mod/${archive}.archive.xl`, sha256: "b".repeat(64), bytes: 5 }];
  const v1 = readPackageManifest({ schema: "xfs/local-package-1", collectionId: fixture.id, namespace: `xfs_c${key(fixture.id)}`, modName: "XF Eye Artistry",
    files: files(`xfs_c${key(fixture.id)}`), verifiedUnpackedFiles: 16, installed: false, gameRenderingVerified: false }, "eye-makeup");
  expect(v1).toMatchObject({ schema: "xfs/local-package-1", archive: `xfs_c${key(fixture.id)}`, features: [{ feature: "eye-makeup", namespace: `xfs_c${key(fixture.id)}` }] });
  const v2 = readPackageManifest({ schema: "xfs/local-package-2", productId: OTHER, modName: "XF Lip Artistry", archive: `xfs_m${key(OTHER)}`,
    features: [{ feature: LIPS, namespace: "xfs_clips" }], files: files(`xfs_m${key(OTHER)}`), verifiedUnpackedFiles: 3, installed: false,
    gameRenderingVerified: false }, "eye-makeup");
  expect(v2).toMatchObject({ productId: OTHER, archive: `xfs_m${key(OTHER)}`, features: [{ feature: LIPS, namespace: "xfs_clips" }] });
  expect(() => readPackageManifest({ schema: "xfs/local-package-2", productId: OTHER, modName: "X", archive: "xfs_m1",
    features: [], files: files("xfs_m1"), verifiedUnpackedFiles: 3, installed: false, gameRenderingVerified: false }, "eye-makeup")).toThrow();
  expect(() => readPackageManifest({ schema: "xfs/local-package-1", namespace: "xfs_c1", files: files("xfs_c1"), verifiedUnpackedFiles: 1,
    installed: true, gameRenderingVerified: false }, "eye-makeup")).toThrow();
  expect(() => readPackageManifest({ schema: "xfs/local-package-1", namespace: "xfs_c1", files: files("xfs_c2"), verifiedUnpackedFiles: 1,
    installed: false, gameRenderingVerified: false }, "eye-makeup")).toThrow("unexpected file");
});

// ---------------------------------------------------------------------------------------------
// Looks that hold one feature only, and omissions decided once (PIPE-88, PIPE-95)
// ---------------------------------------------------------------------------------------------

const HAIR_ONLY = "66666666-2222-4333-8444-555555555555";
const glitter = (recipe: { layers: { finish: string }[] }) => ({ ...recipe, layers: recipe.layers.map(layer => ({ ...layer, finish: "glitter" })) });
/**
 * Mixed looks: [0] eye makeup and lips; [1] eye makeup only, none of it exportable; [2] lips only; [3] eye makeup
 * (none exportable) and lips; and a hair-only look (no exporter).
 */
function mixed(packagePlan?: unknown) {
  const [a, b, c, d] = fixture.presets as { id: string; name: string; revision: number; recipe: { layers: { finish: string }[] } }[];
  const eye = (recipe: unknown) => ({ "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: recipe } });
  const lips = { [LIPS]: { schema: "xfs/lips-part-1", body: { shades: ["#aa3355"] } } };
  const look = (preset: typeof a, parts: Record<string, unknown>) => ({ id: preset.id, name: preset.name, revision: preset.revision, parts });
  return { schema: "xfs/collection-2", id: fixture.id, name: fixture.name, ...(packagePlan ? { packagePlan } : {}), presets: [
    look(a, { ...eye(a.recipe), ...lips }), look(b, eye(glitter(b.recipe))), look(c, lips), look(d, { ...eye(glitter(d.recipe)), ...lips }),
    { id: HAIR_ONLY, name: "Hair only", revision: 1, parts: { hair: { schema: "xfs/hair-part-1", body: {} } } }] };
}
const check = (collection: unknown) => checkProducts({ collection, exporters: [eyeEntry(), LIPS_ENTRY], prerequisites: {}, diagnostics: false,
  preflight: false, collectionSha256: "0" }).result;

test("a whole look is left out only when no feature packages anything of it; a feature lists only its own (PIPE-88)", () => {
  const [a, b, c, d] = fixture.presets as { id: string; name: string }[];
  const result = check(mixed());
  const whole = result.omissions.filter(item => item.kind === "preset").map(item => [item.presetId, item.kind === "preset" && item.reason]);
  // The eye-makeup-only look with nothing exportable is left out whole, with eye makeup's reason; the hair-only look too.
  expect(whole).toEqual([[b.id, "No active exportable layers remain."], [HAIR_ONLY, NOTHING_PACKAGED_REASON]]);
  // The lips-only look is packaged by lips, so nobody reports it; before, eye makeup called it a whole look "with no eye makeup".
  const [product] = result.products, [eyes, lips] = product.features;
  expect(lips.presets.map(look => look.id)).toEqual([a.id, c.id, d.id]);
  expect(eyes.presets.map(look => look.id)).toEqual([a.id]);
  expect(eyes.omissions.filter(item => item.kind === "preset").map(item => item.presetId)).toEqual([d.id]);
  expect(eyes.omissions.some(item => item.kind !== "feature" && item.presetId === c.id)).toBe(false);
  // In words: the eye makeup of a look lips packages is left out, not the look; layers name their feature.
  const words = describePackageCheck(result);
  expect(words).toContain(`left out the eye makeup of preset “${d.name}”: no active exportable layers remain`);
  expect(words).toContain(`omitted whole preset “${b.name}” because no exportable active layers remain`);
  expect(words).toContain("omitted eye makeup layer");
  expect(words).not.toContain(`“${c.name}” because it has no eye makeup`);
  expect(resultOmissions(result).filter(item => item.label).every(item => item.label === "Eye makeup")).toBe(true);
});

test("each product's manifest records only its own features' and looks' omissions (PIPE-88)", async () => {
  const [, b] = fixture.presets as { id: string }[];
  const split = check(mixed({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS] }] }));
  const [eyes, lips] = split.products;
  // The collection's omissions are listed once in the result; the eye-makeup mod owns its look and the looks no mod owns.
  expect(eyes.omissions).toEqual(split.omissions);
  expect(eyes.omissions.map(item => item.kind === "preset" || item.kind === "part" ? item.presetId : item.kind)).toEqual([b.id, HAIR_ONLY, HAIR_ONLY]);
  expect(lips.omissions).toEqual([]);
  // Built: the lips manifest no longer copies the eye-makeup mod's omissions.
  const built = await build(mixed({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS] }] }));
  const manifests = built.result.products.map(product => JSON.parse(readFileSync(product.manifest, "utf8")));
  expect(manifests.map(manifest => manifest.omissions.length)).toEqual([3, 0]);
  expect(manifests.map(manifest => readPackageManifest(manifest, "eye-makeup").omissionCount))
    .toEqual([3 + manifests[0].features[0].omissions.length, 0]);
  // A feature left out whole belongs to its own mod; when that mod builds nothing, to the first mod.
  const lipsless: FeatureExporter = { ...LIPS_EXPORTER as FeatureExporter, plan: () => { throw new ExportRefusal("no_exportable_content", "No lips."); } };
  const refused = checkProducts({ collection: mixed({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS] }] }),
    exporters: [eyeEntry(), { ...LIPS_ENTRY, exporter: lipsless }], prerequisites: {}, diagnostics: false, preflight: false, collectionSha256: "0" }).result;
  expect(refused.products.map(product => product.productId)).toEqual([fixture.id]);
  expect(refused.products[0].omissions.some(item => item.kind === "feature" && item.feature === LIPS)).toBe(true);
}, 90_000);

test("the result gate checks each feature's plan hash against the host's own plan (PIPE-95)", async () => {
  const { result, planned, root: dir } = await buildWithPlan(mixed());
  verifyProductBuildResult(result, planned, dir);
  const manifest = JSON.parse(readFileSync(result.products[0].manifest, "utf8"));
  manifest.features[1].planSha256 = "0".repeat(64);
  writeFileSync(result.products[0].manifest, JSON.stringify(manifest, null, 2) + "\n");
  expect(() => verifyProductBuildResult(result, planned, dir)).toThrow("does not match this collection snapshot");
}, 60_000);

test("a package plan this build can't use refuses Check and Build with its own code (CORE-91)", () => {
  const refusal = (packagePlan: unknown) => { try { check(mixed(packagePlan)); } catch (error) { return error as ExportRefusal; } };
  expect(refusal({ schema: "xfs/package-plan-2", products: [] })).toMatchObject({ code: "package_plan_newer", message: NEWER_PLAN_MESSAGE });
  expect(refusal({ schema: PACKAGE_PLAN_1, products: [{ id: OTHER, features: [LIPS], selectorLabels: {} }] })).toMatchObject({ code: "package_plan_newer" });
  expect(refusal({ schema: PACKAGE_PLAN_1, products: [{ id: "x", features: [] }] })).toMatchObject({ code: "package_plan_damaged" });
});
