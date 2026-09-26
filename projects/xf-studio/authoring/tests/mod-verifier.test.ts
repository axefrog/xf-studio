import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
// Test-only use of the compiler: it writes the fixture's supplied chains, which the
// independent verifier must then reproduce from its own arithmetic.
import { encodeFlatDds, flatMipChain } from "../src/engines/layered-makeup/flat-mip-chain";
import { readDdsChain } from "../src/mod-verifier/dds-reader";
import { archiveKey, canonicalResourcePath, resourceRecords } from "../src/mod-verifier/resource-inventory";
import { componentId, sameJson } from "../src/mod-verifier/resource-checks";
import { errorStats, expectedChain } from "../src/mod-verifier/texture-checks";
import { verifyBuild, type ToolResult, type VerifierTools, type VerifyBuildOptions } from "../src/mod-verifier/verify-build";
import { oracleTest } from "./optional-oracles";
// Test-only use of the plate cut and lift: they make a real single-chunk plate and its packaged form,
// which the verifier's own decoder must accept (and reject when tampered).
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { liftPlate } from "../src/plate-lift";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";
import { coverageReference, plateWindow, storedBc4, texelUv, WINDOW_H, WINDOW_W } from "./window-fixture";

const verifierDir = resolve(import.meta.dir, "../src/mod-verifier");


test("the verifier imports nothing from the compiler or other Studio modules", () => {
  const files = readdirSync(verifierDir).filter(name => name.endsWith(".ts"));
  expect(files.sort()).toEqual(["dds-reader.ts", "glitter-checks.ts", "plate-geometry.ts", "resource-checks.ts", "resource-inventory.ts", "texture-checks.ts", "uv-window.ts", "verify-build.ts"]);
  for (const name of files) {
    const code = readFileSync(join(verifierDir, name), "utf8");
    const specifiers = [...code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
    for (const specifier of specifiers)
      expect(specifier, `${name} imports ${specifier}`).toMatch(/^(?:node:[a-z_]+|\.\/(?:dds-reader|glitter-checks|plate-geometry|resource-checks|resource-inventory|texture-checks|uv-window|verify-build))$/);
    expect(code, `${name} uses require()`).not.toMatch(/\brequire\s*\(/);
  }
});

// ---- Synthetic build fixture (all data invented; no game or private assets) ----
// Archive members and plate inputs hold their WolvenKit JSON as text, so the fake `serialize`
// derives each document from the very bytes the verifier hash-checked; the fake `export`
// supplies each texture's decoded DDS. The builder's own conversions are never written.
// Maps are the production 2048 × 512 plate-window maps over the synthetic plate's window.
const W = WINDOW_W, H = WINDOW_H;
const depot = "xfs/test/collection";
const presets = ["a1", "b2"].map((id, i) => ({
  id, name: `Look ${id}`, revision: 1, index: i + 1, appearance: `xfs_p${id}`, appAppearance: `xfs_cns__xfs_p${id}`,
  route: "flat", material: "@preset", plateChunk: 0, uvSpace: "plate-window",
  // Only the fields the verifier's route rules read; a Matte and a Metallic look are both flat.
  recipe: { layers: [{ id: `l${i}`, enabled: true, opacity: 1, finish: i ? "metallic" : "matte", color: "#406080" }] },
  textures: {
    diffuse: `${depot}/textures/xfs_p${id}_diffuse.xbm`, roughness: `${depot}/textures/xfs_p${id}_roughness.xbm`,
    metalness: `${depot}/textures/xfs_p${id}_metalness.xbm` },
}));
const plan = {
  schema: "xfas/export-plan-1", collectionId: "c", namespace: "xfs_cns", depot, selector: "xfs_cns", selectorLabel: "XF Test Artistry",
  component: "xfs_cns_makeup", offAppearance: "xfs_off", templateAppearance: "xfs_cns__xfs_template",
  app: `${depot}/xfs_collection.app`, customization: `${depot}/xfs_collection.inkcharcustomization`,
  mesh: `${depot}/models/xfs_eye_plate.mesh`, morph: `${depot}/models/xfs_eye_plate.morphtarget`, presets,
  plate: { liftsMm: [0.4] },
};
/** A real single-chunk plate cut from the synthetic head (with plate-like UVs), and its lifted form for the given lifts. */
const PLATE = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
const WINDOW = plateWindow(PLATE);
const PLATE_TARGETS = PLATE.morph.Data.RootChunk.targets.length;
const liftedPlate = (liftsMm: number[]) => liftPlate(PLATE.mesh, PLATE.morph, liftsMm);
const cname = (s: string) => ({ $type: "CName", $storage: "string", $value: s });
const ref = (s: string, soft = false) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: s.replaceAll("/", "\\") }, Flags: soft ? "Soft" : "Default" });
const doc = (root: unknown) => ({ Header: { WolvenKitVersion: "test" }, Data: { Version: 195, RootChunk: root } });
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const declaration = (p: typeof plan) =>
  `customizations:\r\n  female: ${p.customization.replaceAll("/", "\\")}\r\nresource:\r\n  scope:\r\n    player_customization.app:\r\n      - ${p.app.replaceAll("/", "\\")}\r\n`;

/** Authored coverage of look `seed`: a soft, lopsided blob on the synthetic plate (authored v = 1 − stored V). */
const blob = (seed: number) => (u: number, v: number) => {
  const d = Math.hypot((u - .42 - .12 * seed) / .05, (v - .24) / .025);
  return Math.max(0, Math.min(1, 1.6 - d)) * (u < .5 + .1 * seed ? 1 : .6);
};
/** `mirrored`: a builder that wrote the window's rows upside down (its maps are otherwise self-consistent). */
const mapSet = (seed: number, mirrored = false) => {
  const n = W * H, diffuse = new Uint8Array(n * 4), roughness = new Uint8Array(n), metalness = new Uint8Array(n), coverage = blob(seed);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y * W + x, alpha = Math.sqrt(coverage(...texelUv(WINDOW.window, W, H, x, mirrored ? H - 1 - y : y)));
    diffuse.set([40 + 20 * seed, 120, 200 - 30 * seed, Math.round(alpha * 255)], t * 4);
    // Uniform in each 4 × 4 block (its stored BC4 form is then exact) and varying down the rows, so a flip shows.
    roughness[t] = 60 + ((Math.floor(x / 4) * 5 + Math.floor(y / 4) * 11) % 150);
    metalness[t] = seed ? 200 : 0;
  }
  return { diffuse, roughness, metalness, chain: flatMipChain(diffuse, roughness, metalness, W, H), reference: coverageReference(WINDOW.window, coverage) };
};
const MAPS = [mapSet(0), mapSet(1)];
type MapSet = ReturnType<typeof mapSet>;
let maps = (seed: number): MapSet => MAPS[seed];
/** The window material constants every flat plate-window entry carries. */
const UV_VALUES = Object.entries(WINDOW.transform).map(([name, value]) => ({ $type: "Float", [name]: value }));

function writeFile(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

type Mutation = (build: string, data: { mesh: any; morph: any; app: any; cc: any; xbm: Record<string, any>; plan: typeof plan }) => void;
/** A build directory plus the decoded DDS the fake export returns, by texture file name. */
type Fixture = { build: string; dds: Map<string, Uint8Array>; plate: { mesh: string; morph: string } };

/** `plate` is the single-chunk plate input (default: the fixture cut); the package holds its lifted form. */
function makeBuild(mutate?: Mutation, input: typeof PLATE = PLATE): Fixture {
  const build = mkdtempSync(resolve(tmpdir(), "xfs-verifier-"));
  const p = structuredClone(plan);
  const blob = { boneNames: [cname("root")], boneRigMatrices: [{ a: 1 }], boundingBox: { Min: 0, Max: 1 } };
  const plateRoot = input.mesh.Data.RootChunk, lifted = liftPlate(input.mesh, input.morph, p.plate.liftsMm);
  const sourceMesh = { ...structuredClone(blob), renderResourceBlob: structuredClone(plateRoot.renderResourceBlob), appearances: [], materialEntries: [] };
  const sourceMorph = structuredClone(input.morph.Data.RootChunk);
  const mesh = { ...structuredClone(blob), renderResourceBlob: { ...lifted.mesh.Data.RootChunk.renderResourceBlob, HandleId: "99" },
    appearances: p.presets.map((preset, i) => ({ HandleId: String(10 + i), Data: { $type: "meshMeshAppearance", name: cname(preset.appearance),
      chunkMaterials: i ? [] : [cname(p.presets[0].appearance + "@preset")] } })),
    materialEntries: [{ $type: "CMeshMaterialEntry", index: 0, isLocalInstance: 1, name: cname("@preset") }],
    localMaterialBuffer: { materials: [{ $type: "CMaterialInstance", baseMaterial: ref("base/materials/mesh_decal.mt"), values: [
      ...[["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]].map(([name, channel]) =>
        ({ $type: "rRef:ITexture", [name]: ref(`*${depot}/textures/{material}_${channel}.xbm`, true) })),
      ...Object.entries({ DiffuseAlpha: 1, NormalAlpha: 0, RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0,
        RoughnessScale: 1, MetalnessScale: 1, RoughnessBias: 0, MetalnessBias: 0 }).map(([name, value]) => ({ $type: "Float", [name]: value })),
      { $type: "Color", DiffuseColor: { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 } }, ...structuredClone(UV_VALUES)] }] } };
  const morph = { ...structuredClone(lifted.morph.Data.RootChunk), baseMesh: ref(p.mesh), baseMeshAppearance: cname(p.presets[0].appearance) };
  const id = componentId(p.component).toString();
  const component = { $type: "entMorphTargetSkinnedMeshComponent", name: cname(p.component), id, isEnabled: 1,
    meshAppearance: cname(p.presets[0].appearance), morphResource: ref(p.morph),
    localTransform: { Orientation: { i: 0, j: 0, k: 0, r: 1 } },
    parentTransform: { HandleId: "20", Data: { $type: "entHardTransformBinding", bindName: cname("root"), enabled: 1 } },
    skinning: { HandleRefId: "21" } };
  const app = { appearances: [
    { HandleId: "30", Data: { name: cname(p.offAppearance), components: [], partsOverrides: [{ componentsOverrides: [] }] } },
    { HandleId: "31", Data: { name: cname(p.templateAppearance), components: [component],
      partsOverrides: [{ componentsOverrides: [{ componentName: cname(p.component) }] }],
      compiledData: { Data: { CruidDict: { "0": id }, Chunks: [{ HandleId: "21", Data: { $type: "entSkinningBinding", bindName: cname("root"), enabled: 1 } }] } } } }] };
  const cc = { headCustomizationOptions: [{ HandleId: "40", Data: { $type: "gameuiAppearanceInfo", name: cname(p.selector), uiSlot: cname(p.selector),
    localizedName: p.selectorLabel, enabled: 1, hidden: 0, defaultIndex: 0, resource: ref(p.app, true),
    definitions: [{ name: cname(p.offAppearance), index: 0, localizedName: "Common-Off" },
      ...p.presets.map(preset => ({ name: cname(preset.appAppearance), index: preset.index, localizedName: preset.name }))] } }],
    headGroups: ["character_customization", "face"].map(group => ({ name: cname(group), options: [cname(p.selector)] })) };
  const xbm: Record<string, any> = {};
  p.presets.forEach((preset, i) => {
    for (const channel of ["diffuse", "roughness", "metalness"] as const)
      xbm[preset.textures[channel]] = { width: W, height: H, setup: { hasMipchain: 1, isGamma: channel === "diffuse" ? 1 : 0,
        compression: channel === "diffuse" ? "TCM_QualityColor" : "TCM_QualityR" },
        ...(channel === "roughness" ? { renderTextureResource: storedBc4(maps(i).roughness, W, H) } : {}) };
  });
  mutate?.(build, { mesh, morph, app, cc, xbm, plan: p });

  const dds = new Map<string, Uint8Array>();
  const compiled = p.presets.map((preset, i) => {
    const m = maps(i), chain = m.chain;
    const records = (["diffuse", "roughness", "metalness"] as const).map(channel => {
      const file = `${preset.appearance}_${channel}.raw`;
      writeFile(join(build, "baked", file), m[channel]);
      const encoded = encodeFlatDds(chain[channel], { width: W, height: H }, channel);
      writeFile(join(build, "input", channel === "diffuse" ? "dds-colour" : "dds-scalar", `${preset.appearance}_${channel}.dds`), encoded);
      dds.set(`${preset.appearance}_${channel}.dds`, encoded); // a lossless "decode"
      return { channel, file, bytes: m[channel].length, sha256: sha(m[channel]), width: W, height: H };
    });
    const referenceFile = `${preset.appearance}_reference.raw`;
    writeFile(join(build, "baked", referenceFile), m.reference.data);
    return { id: preset.id, revision: 1, route: "flat", uvSpace: "plate-window", width: W, height: H, window: WINDOW.window, maps: records,
      reference: { file: referenceFile, bytes: m.reference.data.length, sha256: sha(m.reference.data), ...m.reference.crop } };
  });
  const plate = { mesh: join(build, "plate", "xfs_eye_plate.mesh"), morph: join(build, "plate", "xfs_eye_plate.morphtarget") };
  writeFile(plate.mesh, JSON.stringify(doc(sourceMesh)));
  writeFile(plate.morph, JSON.stringify(doc(sourceMorph)));
  const plateInputs = [plate.mesh, plate.morph].map(path => ({ path, sha256: sha(readFileSync(path)) }));
  const members = [[p.mesh, mesh], [p.morph, morph], [p.app, app], [p.customization, cc], ...Object.entries(xbm)] as [string, unknown][];
  const artifacts = members.map(([path, root]) => {
    const data = JSON.stringify(doc(root));
    writeFile(join(build, "archive", path), data);
    return { path, bytes: data.length, sha256: sha(data), depotPathHash64: archiveKey(path) };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const archive = new TextEncoder().encode("synthetic archive");
  writeFile(join(build, "package/archive/pc/mod", `${p.namespace}.archive`), archive);
  writeFile(join(build, "package/archive/pc/mod", `${p.namespace}.archive.xl`), declaration(p));
  writeFile(join(build, "build.json"), JSON.stringify({ plan: p, compiled, plateStem: "xfs_eye_plate", plateInputs, artifacts,
    plateUv: WINDOW, archiveSha256: sha(archive), installed: false, gameRenderingVerified: false }));
  return { build, dds, plate };
}

type Hooks = {
  tamper?: (unpacked: string) => void;
  unbundle?: VerifierTools["unbundle"];
  serialize?: VerifierTools["serialize"];
  exportTextures?: VerifierTools["exportTextures"];
  options?: Partial<VerifyBuildOptions>;
};
const ok = (stdout = "ok"): ToolResult => ({ exitCode: 0, stdout, stderr: "" });
/** Fake WolvenKit: unbundle copies the generated tree, serialize parses member bytes, export returns fixture DDS. */
function fakeTools(fixture: Fixture, hooks: Hooks, calls: string[]): VerifierTools {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
  return {
    unbundle: hooks.unbundle ?? ((archive, output) => {
      calls.push(`unbundle ${archive}`);
      cpSync(join(fixture.build, "archive"), output, { recursive: true });
      hooks.tamper?.(output);
      return ok("Unbundled 10/10 entries.");
    }),
    serialize: hooks.serialize ?? ((input, output) => {
      calls.push(`serialize ${input}`);
      for (const file of files(input)) writeFileSync(join(output, basename(file) + ".json"), "\uFEFF" + readFileSync(file, "utf8"));
      return ok();
    }),
    exportTextures: hooks.exportTextures ?? ((input, output) => {
      calls.push(`export ${input}`);
      for (const file of files(input)) writeFileSync(join(output, basename(file).replace(/\.xbm$/, ".dds")), fixture.dds.get(basename(file).replace(/\.xbm$/, ".dds"))!);
      return ok();
    }),
  };
}

function run(fixture: Fixture, hooks: Hooks = {}, calls: string[] = []) {
  return verifyBuild({ build: fixture.build, tools: fakeTools(fixture, hooks, calls), ...hooks.options });
}

function expectFailure(message: RegExp, mutate?: Mutation, after?: (fixture: Fixture) => void, hooks?: Hooks, plate: typeof PLATE = PLATE) {
  const fixture = makeBuild(mutate, plate);
  try {
    after?.(fixture);
    expect(() => run(fixture, hooks)).toThrow(message);
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
}

test("a consistent synthetic build passes with the verify.py report shape plus self-sourced hashes", () => {
  const fixture = makeBuild(), { build } = fixture;
  try {
    // Stale builder conversions must be ignored: the verifier converts the unbundled members itself.
    writeFile(join(build, "roundtrip", "xfs_eye_plate.mesh.json"), "not json");
    writeFile(join(build, "export-dds", "xfs_pa1_diffuse.dds"), "not dds");
    writeFile(join(build, "source-json", "xfs_eye_plate.mesh.json"), "not json");
    const calls: string[] = [];
    const report = run(fixture, {}, calls);
    expect(Object.keys(report)).toEqual(["build", "presetCount", "selectorCount", "selectorOptionCount", "appDefinitions",
      "compiledComponentTemplates", "meshAppearances", "materialTemplates", "textureCount", "archiveBytes", "archiveSha256",
      "unpackedFilesVerified", "preservedMorphs", "plateGeometry", "plateUvWindow", "resolvedDynamicPaths", "decodedPixelChecks",
      "decodedMipChecks", "presetRoutes", "archiveXlSha256", "plateInputs", "installed", "gameRenderingVerified", "limits"]);
    expect(report).toMatchObject({ presetCount: 2, selectorOptionCount: 3, meshAppearances: 2, materialTemplates: 1, textureCount: 6,
      unpackedFilesVerified: 10, preservedMorphs: PLATE_TARGETS, installed: false, gameRenderingVerified: false,
      archiveXlSha256: sha(declaration(plan)),
      plateInputs: { mesh: sha(readFileSync(fixture.plate.mesh)), morph: sha(readFileSync(fixture.plate.morph)) } });
    expect(report.plateGeometry).toMatchObject({ liftsMm: [0.4], chunks: 1, nonPositionBytesExact: true, meshMorphBaseIdentical: true });
    expect(report.resolvedDynamicPaths[1]).toEqual({ appearance: "xfs_cns__xfs_pb2", chunkMaterial: "xfs_pb2@preset", textures: presets[1].textures });
    expect(report.decodedPixelChecks[0].coverageError).toEqual({ mean: 0, p95: 0, max: 0 });
    expect(report.decodedMipChecks[0].levels).toHaveLength(12);
    expect(report.decodedMipChecks[0].levels.at(-1)).toMatchObject({ width: 1, height: 1 });
    expect(report.decodedMipChecks[0].levels[1].partialTexels).toBeGreaterThan(0);
    // The window re-derived from the packaged plate, stored rows reversed, and the window maps agreeing with the authored content.
    expect(report.plateUvWindow.window).toEqual(WINDOW.window);
    for (const [key, value] of Object.entries(WINDOW.transform)) expect(report.plateUvWindow.constants[key]).toBeCloseTo(value, 12);
    const space = report.decodedPixelChecks[1] as { uvSpace: string; storedRows: string; mapping: { covered: number; mean: number; farShare: number } };
    expect(space).toMatchObject({ uvSpace: "plate-window", width: W, height: H, storedRows: "reversed" });
    expect(space.mapping.covered).toBeGreaterThan(0);
    expect(space.mapping.mean).toBeLessThan(.03);
    expect(space.mapping.farShare).toBe(0);
    // Every conversion ran on the verifier's own copies inside its work directory.
    const work = join(build, "verify");
    expect(calls).toEqual([`unbundle ${join(work, "archive", "xfs_cns.archive")}`, `serialize ${join(work, "unpacked")}`,
      `serialize ${join(work, "plate")}`, `export ${join(work, "unpacked", ...depot.split("/"), "textures")}`]);
    expect(readFileSync(join(work, "logs", "unbundle.log"), "utf8")).toContain("Unbundled");
    expect(() => run(fixture)).toThrow("work directory is not empty");
  } finally { rmSync(build, { recursive: true, force: true }); }
}, 30_000);

test("texture failures: supplied chain, baked input, decode drift and orientation", () => {
  const flipByte = (path: string, offset: number) => { const data = readFileSync(path); data[offset] ^= 0x40; writeFileSync(path, data); };
  expectFailure(/Supplied roughness mip chain/, undefined, f => flipByte(join(f.build, "input/dds-scalar/xfs_pa1_roughness.dds"), 148 + 256 + 3));
  expectFailure(/Baked diffuse map differs/, undefined, f => flipByte(join(f.build, "baked/xfs_pa1_diffuse.raw"), 10));
  expectFailure(/Decoded .*error too large|Decoded base/, undefined, f => {
    // Decoded (exported) roughness far from the source everywhere.
    const data = Uint8Array.from(f.dds.get("xfs_pa1_roughness.dds")!);
    for (let i = 148; i < 148 + W * H; i++) data[i] = 255 - data[i];
    f.dds.set("xfs_pa1_roughness.dds", data);
  });
  expectFailure(/orientation|error too large/, undefined, f => {
    const data = Buffer.from(f.dds.get("xfs_pa1_diffuse.dds")!), row = W * 4;
    const base = Buffer.from(data.subarray(148, 148 + H * row));
    for (let y = 0; y < H; y++) base.copy(data, 148 + y * row, (H - 1 - y) * row, (H - y) * row);
    f.dds.set("xfs_pa1_diffuse.dds", data);
  });
  expectFailure(/Unexpected DDS dimensions|size differs|Truncated|trailing/, undefined,
    f => f.dds.set("xfs_pb2_metalness.dds", f.dds.get("xfs_pb2_metalness.dds")!.subarray(0, 200)));
  expectFailure(/did not export/, undefined, undefined, { exportTextures: () => ok() });
  expectFailure(/export-textures-0 failed/, undefined, undefined, { exportTextures: () => ({ exitCode: 1, stdout: "", stderr: "" }) });
}, 30_000);

// Builds and tampers many packaged resources (about 1.3 s locally); slower CI runners need more than the 5 s default.
test("resource failures: names, links, buffers, component id, morph count and XBM metadata", () => {
  expectFailure(/XF-branded selector label/, (_b, d) => { d.plan.selectorLabel = "Makeup"; d.cc.headCustomizationOptions[0].Data.localizedName = "Makeup"; });
  // Only in `character_customization`, the selector shows in the creator but not in gameplay or photo mode (seen in game).
  expectFailure(/Head groups must be exactly character_customization and face/, (_b, d) => { d.cc.headGroups.pop(); });
  expectFailure(/does not list exactly the selector/, (_b, d) => { d.cc.headGroups[1].options = []; });
  expectFailure(/Morph targets differs/, (_b, d) => { d.morph.targets.pop(); });
  expectFailure(/Mesh boneNames differs/, (_b, d) => { d.mesh.boneNames = [cname("other")]; });
  expectFailure(/stable derived id/, (_b, d) => { d.app.appearances[1].Data.components[0].id = "12345"; });
  expectFailure(/exact unsigned integer/, (_b, d) => { d.app.appearances[1].Data.components[0].id = 2 ** 60; });
  expectFailure(/Off appearance/, (_b, d) => { d.app.appearances[0].Data.components = [{}]; });
  expectFailure(/skinning is not an enabled root/, (_b, d) => { d.app.appearances[1].Data.compiledData.Data.Chunks[0].Data.enabled = 0; });
  expectFailure(/Selector default must be Off/, (_b, d) => { d.cc.headCustomizationOptions[0].Data.defaultIndex = 1; });
  expectFailure(/label differs from the preset name/, (_b, d) => { d.cc.headCustomizationOptions[0].Data.definitions[2].localizedName = "x"; });
  expectFailure(/unexpected compression/, (_b, d) => { d.xbm[presets[0].textures.roughness].setup.compression = "TCM_None"; });
  expectFailure(/DiffuseColor/, (_b, d) => { d.mesh.localMaterialBuffer.materials[0].values.find((v: any) => v.DiffuseColor).DiffuseColor.Alpha = 0; });
  // The window's UV transform is re-derived from the packaged plate's own UVs.
  expectFailure(/UVOffsetY is .*expected/, (_b, d) => { d.mesh.localMaterialBuffer.materials[0].values.find((v: any) => "UVOffsetY" in v).UVOffsetY *= -1; });
  expectFailure(/UVScaleX is undefined/, (_b, d) => {
    const values = d.mesh.localMaterialBuffer.materials[0].values; values.splice(values.findIndex((v: any) => "UVScaleX" in v), 1); });
  expectFailure(/is 1024x1024, expected 2048x512/, (_b, d) => { Object.assign(d.xbm[presets[1].textures.metalness], { width: 1024, height: 1024 }); });
  expectFailure(/Only the seed appearance/, (_b, d) => { d.mesh.appearances[1].Data.chunkMaterials = [cname("x")]; });
  // The expected morph count comes from the plate recipe, not a constant.
  expectFailure(new RegExp(`Morph target count is ${PLATE_TARGETS}, not the plate recipe's ${PLATE_TARGETS + 1}`), undefined, undefined,
    { options: { morphTargets: PLATE_TARGETS + 1 } });
  expectFailure(/did not serialize/, undefined, undefined, { serialize: () => ok() });
}, 30_000);

test("archive failures: inventory, archive hash, structural declaration and unpacked members", () => {
  const xl = (f: Fixture, text: string) => writeFileSync(join(f.build, "package/archive/pc/mod/xfs_cns.archive.xl"), text);
  expectFailure(/differ from the plan/, undefined, f => writeFileSync(join(f.build, "archive", depot, "textures/xfs_extra.xbm"), "x"));
  expectFailure(/inventory changed after pack/, undefined, f => writeFileSync(join(f.build, "archive", plan.app), "changed"));
  expectFailure(/Packed archive differs/, undefined, f => writeFileSync(join(f.build, "package/archive/pc/mod/xfs_cns.archive"), "other"));
  expectFailure(/exactly customizations and resource/, undefined, f => xl(f, "customizations: {}\n"));
  expectFailure(/not valid YAML/, undefined, f => xl(f, "customizations: [\n"));
  // A substring match would accept these; the structural check does not.
  expectFailure(/exactly customizations and resource/, undefined, f => xl(f, declaration(plan) + "extra: 1\r\n"));
  expectFailure(/only the female list/, undefined, f => xl(f, declaration(plan).replace("  female:", "  male: x\r\n  female:")));
  expectFailure(/exactly the planned customization/, undefined, f => xl(f, declaration(plan).replace("female: ", "female: other\\")));
  expectFailure(/exactly the planned app/, undefined, f => xl(f, declaration(plan) + "      - other\\x.app\r\n"));
  expectFailure(/differs from its generated payload/, undefined, undefined, { tamper: out => writeFileSync(join(out, plan.mesh), "tampered") });
  expectFailure(/Unpacked 11 files/, undefined, undefined, { tamper: out => writeFileSync(join(out, depot, "xfs_extra.app"), "x") });
  expectFailure(/unbundle failed/, undefined, undefined, { unbundle: () => ({ exitCode: 0, stdout: "[ 0: Error ] boom", stderr: "" }) });
  expectFailure(/unbundle failed/, undefined, undefined, { unbundle: () => ({ exitCode: 1, stdout: "", stderr: "" }) });
  // An equivalent declaration in YAML's list form is accepted.
  const fixture = makeBuild();
  try {
    xl(fixture, declaration(plan).replace(`female: ${plan.customization.replaceAll("/", "\\")}`, `female:\r\n    - ${plan.customization.replaceAll("/", "\\")}`));
    expect(run(fixture).presetCount).toBe(2);
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
}, 30_000);

test("plate provenance: inputs must match the build record and the host, and must not change during verification", () => {
  expectFailure(/Plate mesh input differs from the build record/, undefined, f => writeFileSync(f.plate.mesh, JSON.stringify(doc({ changed: 1 }))));
  expectFailure(/Plate morph input is missing/, undefined, f => rmSync(f.plate.morph));
  const fixture = makeBuild();
  try {
    expect(() => run(fixture, { options: { plate: { ...fixture.plate, meshSha256: "0".repeat(64) } } }))
      .toThrow("Plate mesh input differs from the plate the host prepared");
    rmSync(join(fixture.build, "verify"), { recursive: true, force: true });
    // A plate input rewritten after the verifier copied it is caught by the closing comparison.
    let first = true;
    const serialize: VerifierTools["serialize"] = (input, output) => {
      if (first) { first = false; writeFileSync(fixture.plate.morph, "rewritten"); }
      for (const name of readdirSync(input, { recursive: true }) as string[]) {
        const file = join(input, name);
        if (statSync(file).isFile()) writeFileSync(join(output, basename(file) + ".json"), readFileSync(file, "utf8"));
      }
      return ok();
    };
    expect(() => run(fixture, { serialize })).toThrow("Plate morph input changed during verification");
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
}, 30_000);

test("the verifier's own inventory refuses noncanonical paths and computes WolvenKit keys", () => {
  expect(canonicalResourcePath("a/b_c.xbm")).toBe(true);
  for (const bad of ["", "/a.xbm", "a\\b.xbm", "A/b.xbm", "a/../b.xbm", "a/b.png", "12.xbm", "a/b.xbm.", "a/.xbm"]) expect(canonicalResourcePath(bad)).toBe(false);
  // FNV-1a 64 of the empty string is the offset basis; one byte follows the published algorithm.
  expect(BigInt(archiveKey("a.xbm"))).toBe([..."a.xbm"].reduce((h, c) => BigInt.asUintN(64, (h ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n), 0xcbf29ce484222325n));
  expect(archiveKey("a/b.xbm")).toBe(archiveKey("a/b.xbm"));
  const p = { mesh: "m/a.mesh", morph: "m/a.morphtarget", app: "m/a.app", customization: "m/a.inkcharcustomization", presets: [] };
  const files = ["m/a.app", "m/a.mesh", "m/a.morphtarget", "m/a.inkcharcustomization"].map(path => ({ path, bytes: 1, sha256: "x" }));
  expect(resourceRecords(files, p).map(r => r.path)).toEqual(["m/a.app", "m/a.inkcharcustomization", "m/a.mesh", "m/a.morphtarget"]);
  expect(() => resourceRecords(files.slice(1), p)).toThrow("missing m/a.app");
  expect(() => resourceRecords([...files, { path: "m/B.xbm", bytes: 1, sha256: "x" }], p)).toThrow("Noncanonical");
});

test("the DDS reader rejects malformed files", () => {
  const dds = encodeFlatDds(maps(0).chain.diffuse, { width: W, height: H }, "diffuse");
  expect(readDdsChain(dds, "diffuse").levels.map(l => l.length / 4)).toEqual([2048 * 512, 1024 * 256, 512 * 128, 256 * 64, 128 * 32, 64 * 16,
    32 * 8, 16 * 4, 8 * 2, 4, 2, 1]);
  expect(() => readDdsChain(dds, "roughness")).toThrow("format");
  expect(() => readDdsChain(dds.subarray(0, 100), "diffuse")).toThrow("header");
  expect(() => readDdsChain(new Uint8Array([...dds, 0]), "diffuse")).toThrow("trailing");
  const badCount = dds.slice(); new DataView(badCount.buffer).setUint32(28, 4, true);
  expect(() => readDdsChain(badCount, "diffuse")).toThrow("mip count");
  const badArray = dds.slice(); new DataView(badArray.buffer).setUint32(140, 2, true);
  expect(() => readDdsChain(badArray, "diffuse")).toThrow("format");
});

test("the independent reference chain equals the compiler chain on varied inputs, square and non-square", () => {
  for (const [w, h] of [[16, 16], [64, 16], [8, 32], [2048, 512]]) for (let seed = 0; seed < 3; seed++) {
    let s = seed * 7919 + w;
    const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
    const diffuse = Uint8Array.from({ length: w * h * 4 }, next), roughness = Uint8Array.from({ length: w * h }, next), metalness = Uint8Array.from({ length: w * h }, next);
    const compiler = flatMipChain(diffuse, roughness, metalness, w, h), { chain } = expectedChain(diffuse, roughness, metalness, w, h);
    for (const channel of ["diffuse", "roughness", "metalness"] as const) expect(chain[channel]).toEqual(compiler[channel] as Uint8Array[]);
    if (w === 2048) break;
  }
});

test("structural JSON equality ignores key order and only the named handle keys", () => {
  expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
  expect(sameJson([1, 2], [2, 1])).toBe(false);
  const ignore = new Set(["HandleId"]);
  expect(sameJson({ HandleId: "1", x: 1 }, { HandleId: "2", x: 1 }, ignore)).toBe(true);
  expect(sameJson({ HandleId: "1", x: 1 }, { x: 1 }, ignore)).toBe(true);
  expect(sameJson({ HandleId: "1", x: 1 }, { HandleId: "2", x: 1 })).toBe(false);
});

const python = process.env.XFS_PYTHON || "python";
const numpy = (() => {
  try { return Bun.spawnSync([python, "-c", "import numpy"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0; } catch { return false; }
})();
const numpyCase = oracleTest(numpy, "the NumPy statistics oracle needs Python with NumPy (set XFS_PYTHON).");

numpyCase("error statistics match NumPy's mean and default linear percentile", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "xfs-stats-"));
  try {
    const sizes = [1, 2, 7, 8, 20, 129, 1000, 54321];
    let s = 9;
    const arrays = sizes.map(n => Float64Array.from({ length: n }, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 2 ** 32) ** 6; }));
    arrays.forEach((a, i) => writeFileSync(join(dir, `${i}.bin`), a));
    const result = Bun.spawnSync([python, "-c", `
import json,sys,numpy as np
out=[]
for i in range(${sizes.length}):
    x=np.fromfile(sys.argv[1]+'/'+str(i)+'.bin',dtype=np.float64)
    out.append([float(x.mean()),float(np.percentile(x,95)),float(x.max())])
print(json.dumps(out))`, dir], { stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    const expected = JSON.parse(result.stdout.toString());
    arrays.forEach((a, i) => {
      const stats = errorStats(a);
      expect([stats.mean, stats.p95, stats.max]).toEqual(expected[i]);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("plate geometry: the packaged plate must be the input lifted along its normals, every other byte exact", () => {
  const bytesOf = (blob: any) => Buffer.from(blob.renderBuffer.Bytes, "base64");
  const setBytes = (blob: any, data: Buffer) => { blob.renderBuffer.Bytes = data.toString("base64"); };
  // The unlifted cut where the plan says 0.4 mm.
  expectFailure(/is not lifted 0.4 mm along its normal/, (_b, d) => {
    const flat = liftedPlate([0]);
    d.mesh.renderResourceBlob.Data = flat.mesh.Data.RootChunk.renderResourceBlob.Data;
    d.morph.blob = flat.morph.Data.RootChunk.blob;
  });
  // A skin weight byte (stream 0, after position and indices) changed in both buffers.
  expectFailure(/PS_SkinWeights:0 bytes differ from the input/, (_b, d) => {
    for (const blob of [d.mesh.renderResourceBlob.Data, d.morph.blob.Data.baseBlob.Data]) {
      const data = bytesOf(blob); data[16] ^= 1; setBytes(blob, data);
    }
  });
  expectFailure(/mesh and morph base differ/, (_b, d) => {
    const blob = d.morph.blob.Data.baseBlob.Data, data = bytesOf(blob); data[16] ^= 1; setBytes(blob, data);
  });
  expectFailure(/shading deltas differ/, (_b, d) => {
    const data = Buffer.from(d.morph.blob.Data.diffsBuffer.Bytes, "base64"); data[5] ^= 1;
    d.morph.blob.Data.diffsBuffer.Bytes = data.toString("base64");
  });
  expectFailure(/delta is not the lifted input delta/, (_b, d) => {
    const data = Buffer.from(d.morph.blob.Data.diffsBuffer.Bytes, "base64");
    data.writeUInt32LE((data.readUInt32LE(0) & 0xc0000000) | ((data.readUInt32LE(0) + 40) & 0x3fffffff), 0);
    d.morph.blob.Data.diffsBuffer.Bytes = data.toString("base64");
  });
  expectFailure(/Plan plate lifts \[0.2\] differ from the presets' lifts \[0.4\]/, (_b, d) => { d.plan.plate.liftsMm = [0.2]; });
}, 30_000);

// PIPE-28: the render and morph blobs are compared whole with the input; only the re-derived lift fields may differ.
test("plate blobs: every field the lift does not own must be the input's", () => {
  const renderBlobs = (d: Parameters<Mutation>[1]) => [d.mesh.renderResourceBlob.Data, d.morph.blob.Data.baseBlob.Data];
  const morphBlob = (d: Parameters<Mutation>[1]) => d.morph.blob.Data;
  expectFailure(/Packaged plate mesh header\.bonePositions differs from the input/,
    (_b, d) => { for (const b of renderBlobs(d)) b.header.bonePositions = [{ X: 1, Y: 0, Z: 0, W: 1 }]; });
  expectFailure(/Packaged plate mesh header\.renderLODs\[0\] differs from the input/, (_b, d) => { for (const b of renderBlobs(d)) b.header.renderLODs = [5]; });
  expectFailure(/Packaged plate mesh header\.version differs from the input/, (_b, d) => { for (const b of renderBlobs(d)) b.header.version = 21; });
  expectFailure(/Packaged plate mesh header\.renderChunkInfos\[0\]\.materialId differs from the input/,
    (_b, d) => { for (const b of renderBlobs(d)) b.header.renderChunkInfos[0].materialId = [3]; });
  // PIPE-29: the head's position quantization must stay the input's.
  expectFailure(/Packaged plate mesh header\.quantizationScale\.X differs from the input/,
    (_b, d) => { for (const b of renderBlobs(d)) b.header.quantizationScale.X *= 2; });
  expectFailure(/Packaged plate mesh buffer holds \d+ bytes, not the \d+ of the lifted layout/, (_b, d) => {
    for (const b of renderBlobs(d)) b.renderBuffer.Bytes = Buffer.concat([Buffer.from(b.renderBuffer.Bytes, "base64"), Buffer.alloc(16)]).toString("base64");
  });
  expectFailure(/Packaged plate morph base header\.renderLODs\[0\] differs from the input/,
    (_b, d) => { d.morph.blob.Data.baseBlob.Data.header.renderLODs = [5]; });
  expectFailure(/Packaged plate morph header\.version differs from the input/, (_b, d) => { morphBlob(d).header.version = 1; });
  expectFailure(/Packaged plate morph header\.numDiffs differs from the input/, (_b, d) => { morphBlob(d).header.numDiffs = 1; });
  expectFailure(/Packaged plate morph header\.numDiffsMapping differs from the input/, (_b, d) => { morphBlob(d).header.numDiffsMapping += 1; });
  expectFailure(/Packaged plate morph header\.targetTextureDiffsData differs from the input/, (_b, d) => { morphBlob(d).header.targetTextureDiffsData = []; });
  expectFailure(/Packaged plate morph textureDiffsBuffer differs from the input/,
    (_b, d) => { morphBlob(d).textureDiffsBuffer = { BufferId: "9", Flags: 0, Bytes: "AAAA" }; });
  expectFailure(/Packaged plate morph header\.targetStartsInVertexDiffs\[1\] differs from the input/,
    (_b, d) => { morphBlob(d).header.targetStartsInVertexDiffs[1] += 1; });
  expectFailure(/Packaged morph mapping holds \d+ bytes, not the \d+ of the lifted input/, (_b, d) => {
    const bytes = Buffer.from(morphBlob(d).mappingBuffer.Bytes, "base64");
    morphBlob(d).mappingBuffer.Bytes = Buffer.concat([bytes, Buffer.alloc(64, 7)]).toString("base64");
  });
  expectFailure(/Packaged plate morph mappingBuffer\.Bytes differs from the input/, (_b, d) => {
    const bytes = Buffer.from(morphBlob(d).mappingBuffer.Bytes, "base64"); bytes[bytes.length - 1] ^= 1;
    morphBlob(d).mappingBuffer.Bytes = bytes.toString("base64");
  });
  expectFailure(/Morph boundingBox differs from the source plate/, (_b, d) => { d.morph.boundingBox = { Min: 9, Max: 9 }; });
  expectFailure(/Morph baseTexture differs from the source plate/, (_b, d) => { d.morph.baseTexture = ref("base/other.xbm"); });
  expectFailure(/Morph baseMeshAppearance is not the seed appearance/, (_b, d) => { d.morph.baseMeshAppearance = cname("xfs_eye_plate"); });
  expectFailure(/Mesh boundingBox differs from the source plate/, (_b, d) => { d.mesh.boundingBox = { Min: 0, Max: 2 }; });
  expectFailure(/Mesh extraField differs from the source plate/, (_b, d) => { d.mesh.extraField = 1; });
}, 30_000);

// PIPE-29: re-quantized morph targets. The fixture cut's deltas fit its quantization after the lift, so this
// variant puts every delta at the bottom of its range; the lift then pushes some below it and the builder
// re-quantizes those targets to the lifted range (24 of 105 targets do so on the real plate).
const TIGHT: typeof PLATE = (() => {
  const plate = structuredClone(PLATE), blob = plate.morph.Data.RootChunk.blob.Data;
  const diffs = Buffer.from(blob.diffsBuffer.Bytes, "base64");
  for (let at = 0; at < diffs.length; at += 12) diffs.writeUInt32LE((diffs.readUInt32LE(at) & 0xc0000000) >>> 0, at);
  blob.diffsBuffer.Bytes = diffs.toString("base64");
  return plate;
})();
const axisValues = (v: any) => (["X", "Y", "Z"] as const).map(axis => Number(v[axis]));
/** Re-encode target `t`'s position deltas (every chunk) under a new quantization, as a builder choosing it would. */
function requantize(blob: any, t: number, scale: number[], offset: number[]) {
  const h = blob.header, diffs = Buffer.from(blob.diffsBuffer.Bytes, "base64");
  const oldScale = axisValues(h.targetPositionDiffScale[t]), oldOffset = axisValues(h.targetPositionDiffOffset[t]);
  const rows = h.numVertexDiffsInEachChunk[t].reduce((a: number, b: number) => a + b, 0);
  for (let r = 0; r < rows; r++) {
    const at = (h.targetStartsInVertexDiffs[t] + r) * 12, word = diffs.readUInt32LE(at);
    let next = word & 0xc0000000;
    for (let a = 0; a < 3; a++) {
      const decoded = ((word >>> (10 * a)) & 0x3ff) / 1023 * oldScale[a] + oldOffset[a];
      next |= Math.max(0, Math.min(1023, Math.round((decoded - offset[a]) / scale[a] * 1023))) << (10 * a);
    }
    diffs.writeUInt32LE(next >>> 0, at);
  }
  blob.diffsBuffer.Bytes = diffs.toString("base64");
  (["X", "Y", "Z"] as const).forEach((axis, a) => { h.targetPositionDiffScale[t][axis] = scale[a]; h.targetPositionDiffOffset[t][axis] = offset[a]; });
}

test("re-quantized morph targets: the range must be exactly the lifted deltas', and errors stay under an absolute cap", () => {
  const lifted = liftPlate(TIGHT.mesh, TIGHT.morph, [0.4]), inHeader = TIGHT.morph.Data.RootChunk.blob.Data.header;
  const outHeader = lifted.morph.Data.RootChunk.blob.Data.header;
  const changed = [...Array(inHeader.numTargets).keys()].filter(t =>
    JSON.stringify(outHeader.targetPositionDiffScale[t]) !== JSON.stringify(inHeader.targetPositionDiffScale[t]));
  expect(lifted.report.requantizedTargets).toBeGreaterThan(0);
  expect(changed).toHaveLength(lifted.report.requantizedTargets);
  const fixture = makeBuild(undefined, TIGHT);
  try {
    const report = run(fixture);
    expect(report.plateGeometry).toMatchObject({ requantizedTargets: lifted.report.requantizedTargets, blobsMatchInput: true, meshQuantizationRetained: true });
    expect(report.plateGeometry.maxMorphDeltaErrorMm).toBeGreaterThan(0);
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
  // A wider range than the lifted deltas need would loosen the half-step tolerance; the deltas still decode within it.
  const t = changed[0]!;
  expectFailure(/Packaged morph target \d+ is re-quantized to a range other than its lifted deltas/, (_b, d) => {
    const blob = d.morph.blob.Data, scale = axisValues(blob.header.targetPositionDiffScale[t]), offset = axisValues(blob.header.targetPositionDiffOffset[t]);
    requantize(blob, t, scale.map(s => s * 2), offset.map((o, a) => o - scale[a] / 2));
  }, undefined, undefined, TIGHT);
  // A target the lift did not need to re-quantize may not be widened either.
  expectFailure(/Packaged morph target 0 is re-quantized to a range other than its lifted deltas/, (_b, d) => {
    const blob = d.morph.blob.Data, scale = axisValues(blob.header.targetPositionDiffScale[0]), offset = axisValues(blob.header.targetPositionDiffOffset[0]);
    requantize(blob, 0, scale.map(s => s * 4), offset.map((o, a) => o - scale[a] * 2));
  });
  expectFailure(/Packaged morph target \d+ quantization differs from the input outside X, Y and Z/, (_b, d) => {
    d.morph.blob.Data.header.targetPositionDiffScale[t].W = 7;
  }, undefined, undefined, TIGHT);
  // The cap bounds the error whatever the quantization: an input whose own delta step is coarser than the cap is refused.
  const coarse = structuredClone(PLATE), coarseHeader = coarse.morph.Data.RootChunk.blob.Data.header;
  coarseHeader.targetPositionDiffScale[0] = { ...coarseHeader.targetPositionDiffScale[0], X: 0.2, Y: 0.2, Z: 0.2 };
  expectFailure(/Packaged morph target 0 chunk 0 row \d+ delta error exceeds 0.02 mm/, undefined, undefined, undefined, coarse);
}, 30_000);

/** Two lifts and a diagnostic surface: look a1 on the unlifted chunk with skin roughness kept, b2 on the production lift. */
const SURFACE = { RoughnessMetalnessAlpha: 0 };
const DIAG_ENTRY = "@flat_" + (() => {
  let hash = 0x811c9dc5;
  for (const c of JSON.stringify([["RoughnessMetalnessAlpha", 0]])) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
})();
const twoChunks: Mutation = (_b, d) => {
  const lifted = liftedPlate([0, 0.4]);
  d.plan.plate.liftsMm = [0, 0.4];
  Object.assign(d.plan.presets[0], { plateChunk: 0, material: DIAG_ENTRY, diagnostics: { plateLiftMm: 0, surface: SURFACE } });
  Object.assign(d.plan.presets[1], { plateChunk: 1 });
  d.mesh.renderResourceBlob.Data = lifted.mesh.Data.RootChunk.renderResourceBlob.Data;
  d.morph.blob = lifted.morph.Data.RootChunk.blob;
  d.mesh.appearances[0].Data.chunkMaterials = [cname(`xfs_pa1${DIAG_ENTRY}`), cname("xfs_hidden")];
  d.mesh.appearances[1].Data.chunkMaterials = [cname("xfs_hidden"), cname("xfs_pb2@preset")];
  const flat = d.mesh.localMaterialBuffer.materials[0], diag = structuredClone(flat);
  for (const item of diag.values) if ("RoughnessMetalnessAlpha" in item) item.RoughnessMetalnessAlpha = 0;
  d.mesh.materialEntries = [DIAG_ENTRY, "@preset", "xfs_hidden"].map((name, index) => ({ $type: "CMeshMaterialEntry", index, isLocalInstance: 1, name: cname(name) }));
  d.mesh.localMaterialBuffer.materials = [diag, flat, { $type: "CMaterialInstance", baseMaterial: ref("base/materials/mesh_decal.mt"),
    values: Object.entries({ DiffuseAlpha: 0, NormalAlpha: 0, RoughnessMetalnessAlpha: 0 }).map(([name, value]) => ({ $type: "Float", [name]: value })) }];
};

test("diagnostic lifts and surfaces: one chunk per lift, hidden chunks write nothing, overrides are restated", () => {
  const fixture = makeBuild(twoChunks);
  try {
    const collection = { presets: presets.map(p => ({ id: p.id, recipe: p.recipe })),
      diagnostics: { schema: "xfs/export-diagnostics-1", presets: { a1: { plateLiftMm: 0, surface: SURFACE } } } };
    const report = run(fixture, { options: { packagedCollection: collection } });
    expect(report.plateGeometry).toMatchObject({ liftsMm: [0, 0.4], chunks: 2 });
    expect(report.materialTemplates).toBe(3);
    expect(report.resolvedDynamicPaths[0].chunkMaterial).toBe(`xfs_pa1${DIAG_ENTRY}`);
    rmSync(join(fixture.build, "verify"), { recursive: true, force: true });
    // The host's packaged collection must carry exactly the same knobs.
    expect(() => run(fixture, { options: { packagedCollection: { ...collection, diagnostics: undefined } } }))
      .toThrow("diagnostics for preset Look a1 differ from the packaged collection");
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
  expectFailure(/Hidden chunk material must write nothing/, (b, d) => {
    twoChunks(b, d);
    d.mesh.localMaterialBuffer.materials[2].values[0].DiffuseAlpha = 1;
  });
  expectFailure(/Appearance xfs_pb2 must name @preset/, (b, d) => {
    twoChunks(b, d);
    d.mesh.appearances[1].Data.chunkMaterials = [cname("xfs_pb2@preset"), cname("xfs_hidden")];
  });
  expectFailure(/RoughnessMetalnessAlpha is 1, expected 0/, (b, d) => {
    twoChunks(b, d);
    for (const item of d.mesh.localMaterialBuffer.materials[0].values) if ("RoughnessMetalnessAlpha" in item) item.RoughnessMetalnessAlpha = 1;
  });
  expectFailure(/does not draw its lift's plate chunk/, (b, d) => { twoChunks(b, d); d.plan.presets[1].plateChunk = 0; });
  expectFailure(/2 chunks for 1 planned lifts|Plan plate lifts/, (b, d) => { twoChunks(b, d); d.plan.plate.liftsMm = [0.4]; });
}, 30_000);

test("plate-local window: stored row order, record window and texture space are checked, and misplaced content fails the mapping", () => {
  // A builder that rasterised the window upside down: every chain and hash is self-consistent, only the mapping disagrees.
  const mirrored = [mapSet(0, true), mapSet(1, true)], original = maps;
  maps = seed => mirrored[seed];
  try { expectFailure(/does not match its authored head-UV content at the plate's UVs/); } finally { maps = original; }
  // WolvenKit storing rows top to bottom would move every window map; the verifier decodes the stored BC4 level itself.
  expectFailure(/is not stored with reversed rows/, (_b, d) => {
    const rough = maps(0).roughness, flipped = new Uint8Array(rough.length);
    for (let y = 0; y < H; y++) flipped.set(rough.subarray((H - 1 - y) * W, (H - y) * W), y * W);
    d.xbm[presets[0].textures.roughness].renderTextureResource = storedBc4(flipped, W, H);
  });
  expectFailure(/has no stored texture data/, (_b, d) => { delete d.xbm[presets[1].textures.roughness].renderTextureResource; });
  const rewrite = (change: (build: any) => void) => (f: Fixture) => {
    const path = join(f.build, "build.json"), build = JSON.parse(readFileSync(path, "utf8"));
    change(build); writeFileSync(path, JSON.stringify(build));
  };
  expectFailure(/uses another UV window than the packaged plate's/, undefined, rewrite(b => { b.compiled[0].window.u0 += .001; }));
  expectFailure(/plate UV window differs from the one the packaged plate's UVs give/, undefined, rewrite(b => { b.plateUv.window.v1 -= .001; }));
  expectFailure(/has no head-UV coverage reference at least 4096/, undefined, rewrite(b => { b.compiled[1].reference.grid = 1024; }));
  expectFailure(/was built on head UV, but its route and diagnostics need plate-window/, (_b, d) => { d.plan.presets[0].uvSpace = "head"; });
  expectFailure(/invalid diagnostic uvSpace/, (_b, d) => { (d.plan.presets[0] as any).diagnostics = { uvSpace: "window" }; });
}, 30_000);
