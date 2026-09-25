import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
// Test-only use of the compiler: it writes the fixture's supplied chains, which the
// independent verifier must then reproduce from its own arithmetic.
import { encodeFlatDds, flatMipChain } from "../src/flat-mip-chain";
import { readDdsChain } from "../src/mod-verifier/dds-reader";
import { archiveKey, canonicalResourcePath, resourceRecords } from "../src/mod-verifier/resource-inventory";
import { componentId, sameJson } from "../src/mod-verifier/resource-checks";
import { errorStats, expectedChain } from "../src/mod-verifier/texture-checks";
import { verifyBuild, type ToolResult, type VerifierTools, type VerifyBuildOptions } from "../src/mod-verifier/verify-build";
import { oracleTest } from "./optional-oracles";

const verifierDir = resolve(import.meta.dir, "../src/mod-verifier");


test("the verifier imports nothing from the compiler or other Studio modules", () => {
  const files = readdirSync(verifierDir).filter(name => name.endsWith(".ts"));
  expect(files.sort()).toEqual(["dds-reader.ts", "resource-checks.ts", "resource-inventory.ts", "texture-checks.ts", "verify-build.ts"]);
  for (const name of files) {
    const code = readFileSync(join(verifierDir, name), "utf8");
    const specifiers = [...code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
    for (const specifier of specifiers)
      expect(specifier, `${name} imports ${specifier}`).toMatch(/^(?:node:[a-z_]+|\.\/(?:dds-reader|resource-checks|resource-inventory|texture-checks|verify-build))$/);
    expect(code, `${name} uses require()`).not.toMatch(/\brequire\s*\(/);
  }
});

// ---- Synthetic build fixture (all data invented; no game or private assets) ----
// Archive members and plate inputs hold their WolvenKit JSON as text, so the fake `serialize`
// derives each document from the very bytes the verifier hash-checked; the fake `export`
// supplies each texture's decoded DDS. The builder's own conversions are never written.
const SIZE = 16;
const depot = "xfs/test/collection";
const presets = ["a1", "b2"].map((id, i) => ({
  id, name: `Look ${id}`, revision: 1, index: i + 1, appearance: `xfs_p${id}`, appAppearance: `xfs_cns__xfs_p${id}`,
  route: "flat", material: "@preset",
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
};
const cname = (s: string) => ({ $type: "CName", $storage: "string", $value: s });
const ref = (s: string, soft = false) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: s.replaceAll("/", "\\") }, Flags: soft ? "Soft" : "Default" });
const doc = (root: unknown) => ({ Header: { WolvenKitVersion: "test" }, Data: { Version: 195, RootChunk: root } });
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const declaration = (p: typeof plan) =>
  `customizations:\r\n  female: ${p.customization.replaceAll("/", "\\")}\r\nresource:\r\n  scope:\r\n    player_customization.app:\r\n      - ${p.app.replaceAll("/", "\\")}\r\n`;

function maps(seed: number) {
  const n = SIZE * SIZE, diffuse = new Uint8Array(n * 4), roughness = new Uint8Array(n), metalness = new Uint8Array(n);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = y * SIZE + x;
    // Covered blob in the upper half with a soft edge, so orientation and partial texels are meaningful.
    const d = Math.hypot(x - 6 - seed, y - 4) / 5, alpha = y < 9 ? Math.max(0, Math.min(1, 1.6 - d)) : 0;
    diffuse.set([40 + 20 * seed, 120, 200 - 30 * seed, Math.round(alpha * 255)], t * 4);
    roughness[t] = 90 + x * 5;
    metalness[t] = seed ? 200 : 0;
  }
  return { diffuse, roughness, metalness };
}

function writeFile(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

type Mutation = (build: string, data: { mesh: any; morph: any; app: any; cc: any; xbm: Record<string, any>; plan: typeof plan }) => void;
/** A build directory plus the decoded DDS the fake export returns, by texture file name. */
type Fixture = { build: string; dds: Map<string, Uint8Array>; plate: { mesh: string; morph: string } };

function makeBuild(mutate?: Mutation): Fixture {
  const build = mkdtempSync(resolve(tmpdir(), "xfs-verifier-"));
  const p = structuredClone(plan);
  const blob = { renderResourceBlob: { HandleId: "1", Data: { vertices: [1, 2, 3] } }, boneNames: [cname("root")],
    boneRigMatrices: [{ a: 1 }], boundingBox: { Min: 0, Max: 1 } };
  const sourceMesh = { ...structuredClone(blob), appearances: [], materialEntries: [] };
  const targets = Array.from({ length: 105 }, (_, i) => ({ name: cname(`t${i}`) }));
  const sourceMorph = { blob: { BufferId: "7", Data: { deltas: [0] } }, targets };
  const mesh = { ...structuredClone(blob), renderResourceBlob: { HandleId: "99", Data: { vertices: [1, 2, 3] } },
    appearances: p.presets.map((preset, i) => ({ HandleId: String(10 + i), Data: { $type: "meshMeshAppearance", name: cname(preset.appearance),
      chunkMaterials: i ? [] : [cname(p.presets[0].appearance + "@preset")] } })),
    materialEntries: [{ $type: "CMeshMaterialEntry", index: 0, isLocalInstance: 1, name: cname("@preset") }],
    localMaterialBuffer: { materials: [{ $type: "CMaterialInstance", baseMaterial: ref("base/materials/mesh_decal.mt"), values: [
      ...[["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]].map(([name, channel]) =>
        ({ $type: "rRef:ITexture", [name]: ref(`*${depot}/textures/{material}_${channel}.xbm`, true) })),
      ...Object.entries({ DiffuseAlpha: 1, NormalAlpha: 0, RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0,
        RoughnessScale: 1, MetalnessScale: 1, RoughnessBias: 0, MetalnessBias: 0 }).map(([name, value]) => ({ $type: "Float", [name]: value })),
      { $type: "Color", DiffuseColor: { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 } }] }] } };
  const morph = { ...structuredClone(sourceMorph), blob: { BufferId: "8", Data: { deltas: [0] } }, baseMesh: ref(p.mesh) };
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
  for (const preset of p.presets) for (const channel of ["diffuse", "roughness", "metalness"] as const)
    xbm[preset.textures[channel]] = { width: SIZE, height: SIZE, setup: { hasMipchain: 1, isGamma: channel === "diffuse" ? 1 : 0,
      compression: channel === "diffuse" ? "TCM_QualityColor" : "TCM_QualityR" } };
  mutate?.(build, { mesh, morph, app, cc, xbm, plan: p });

  const dds = new Map<string, Uint8Array>();
  const compiled = p.presets.map((preset, i) => {
    const m = maps(i), chain = flatMipChain(m.diffuse, m.roughness, m.metalness, SIZE);
    const records = (["diffuse", "roughness", "metalness"] as const).map(channel => {
      const file = `${preset.appearance}_${channel}.raw`;
      writeFile(join(build, "baked", file), m[channel]);
      const encoded = encodeFlatDds(chain[channel], SIZE, channel);
      writeFile(join(build, "input", channel === "diffuse" ? "dds-colour" : "dds-scalar", `${preset.appearance}_${channel}.dds`), encoded);
      dds.set(`${preset.appearance}_${channel}.dds`, encoded); // a lossless "decode"
      return { channel, file, bytes: m[channel].length, sha256: sha(m[channel]) };
    });
    return { id: preset.id, revision: 1, size: SIZE, route: "flat", maps: records };
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
    archiveSha256: sha(archive), installed: false, gameRenderingVerified: false }));
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

function expectFailure(message: RegExp, mutate?: Mutation, after?: (fixture: Fixture) => void, hooks?: Hooks) {
  const fixture = makeBuild(mutate);
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
      "unpackedFilesVerified", "preservedMorphs", "modelBuffersUnchanged", "resolvedDynamicPaths", "decodedPixelChecks",
      "decodedMipChecks", "presetRoutes", "archiveXlSha256", "plateInputs", "installed", "gameRenderingVerified", "limits"]);
    expect(report).toMatchObject({ presetCount: 2, selectorOptionCount: 3, meshAppearances: 2, materialTemplates: 1, textureCount: 6,
      unpackedFilesVerified: 10, preservedMorphs: 105, installed: false, gameRenderingVerified: false,
      archiveXlSha256: sha(declaration(plan)),
      plateInputs: { mesh: sha(readFileSync(fixture.plate.mesh)), morph: sha(readFileSync(fixture.plate.morph)) } });
    expect(report.resolvedDynamicPaths[1]).toEqual({ appearance: "xfs_cns__xfs_pb2", chunkMaterial: "xfs_pb2@preset", textures: presets[1].textures });
    expect(report.decodedPixelChecks[0].coverageError).toEqual({ mean: 0, p95: 0, max: 0 });
    expect(report.decodedMipChecks[0].levels).toHaveLength(5);
    expect(report.decodedMipChecks[0].levels[1].partialTexels).toBeGreaterThan(0);
    // Every conversion ran on the verifier's own copies inside its work directory.
    const work = join(build, "verify");
    expect(calls).toEqual([`unbundle ${join(work, "archive", "xfs_cns.archive")}`, `serialize ${join(work, "unpacked")}`,
      `serialize ${join(work, "plate")}`, `export ${join(work, "unpacked", ...depot.split("/"), "textures")}`]);
    expect(readFileSync(join(work, "logs", "unbundle.log"), "utf8")).toContain("Unbundled");
    expect(() => run(fixture)).toThrow("work directory is not empty");
  } finally { rmSync(build, { recursive: true, force: true }); }
});

test("texture failures: supplied chain, baked input, decode drift and orientation", () => {
  const flipByte = (path: string, offset: number) => { const data = readFileSync(path); data[offset] ^= 0x40; writeFileSync(path, data); };
  expectFailure(/Supplied roughness mip chain/, undefined, f => flipByte(join(f.build, "input/dds-scalar/xfs_pa1_roughness.dds"), 148 + 256 + 3));
  expectFailure(/Baked diffuse map differs/, undefined, f => flipByte(join(f.build, "baked/xfs_pa1_diffuse.raw"), 10));
  expectFailure(/Decoded .*error too large|Decoded base/, undefined, f => {
    // Decoded (exported) roughness far from the source everywhere.
    const data = Uint8Array.from(f.dds.get("xfs_pa1_roughness.dds")!);
    for (let i = 148; i < 148 + SIZE * SIZE; i++) data[i] = 255 - data[i];
    f.dds.set("xfs_pa1_roughness.dds", data);
  });
  expectFailure(/orientation|error too large/, undefined, f => {
    const data = Buffer.from(f.dds.get("xfs_pa1_diffuse.dds")!), row = SIZE * 4;
    const base = Buffer.from(data.subarray(148, 148 + SIZE * row));
    for (let y = 0; y < SIZE; y++) base.copy(data, 148 + y * row, (SIZE - 1 - y) * row, (SIZE - y) * row);
    f.dds.set("xfs_pa1_diffuse.dds", data);
  });
  expectFailure(/Unexpected DDS dimensions|size differs|Truncated|trailing/, undefined,
    f => f.dds.set("xfs_pb2_metalness.dds", f.dds.get("xfs_pb2_metalness.dds")!.subarray(0, 200)));
  expectFailure(/did not export/, undefined, undefined, { exportTextures: () => ok() });
  expectFailure(/export-textures-0 failed/, undefined, undefined, { exportTextures: () => ({ exitCode: 1, stdout: "", stderr: "" }) });
});

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
  expectFailure(/DiffuseColor/, (_b, d) => { d.mesh.localMaterialBuffer.materials[0].values.at(-1).DiffuseColor.Alpha = 0; });
  expectFailure(/Only the seed appearance/, (_b, d) => { d.mesh.appearances[1].Data.chunkMaterials = [cname("x")]; });
  // The expected morph count comes from the plate recipe, not a constant.
  expectFailure(/Morph target count is 105, not the plate recipe's 104/, undefined, undefined, { options: { morphTargets: 104 } });
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
});

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
});

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
  const m = maps(0), chain = flatMipChain(m.diffuse, m.roughness, m.metalness, SIZE), dds = encodeFlatDds(chain.diffuse, SIZE, "diffuse");
  expect(readDdsChain(dds, "diffuse").levels.map(l => l.length)).toEqual([1024, 256, 64, 16, 4]);
  expect(() => readDdsChain(dds, "roughness")).toThrow("format");
  expect(() => readDdsChain(dds.subarray(0, 100), "diffuse")).toThrow("header");
  expect(() => readDdsChain(new Uint8Array([...dds, 0]), "diffuse")).toThrow("trailing");
  const badCount = dds.slice(); new DataView(badCount.buffer).setUint32(28, 4, true);
  expect(() => readDdsChain(badCount, "diffuse")).toThrow("mip count");
  const badArray = dds.slice(); new DataView(badArray.buffer).setUint32(140, 2, true);
  expect(() => readDdsChain(badArray, "diffuse")).toThrow("format");
});

test("the independent reference chain equals the compiler chain on varied inputs", () => {
  for (let seed = 0; seed < 3; seed++) {
    const m = maps(seed), compiler = flatMipChain(m.diffuse, m.roughness, m.metalness, SIZE), { chain } = expectedChain(m.diffuse, m.roughness, m.metalness, SIZE);
    for (const channel of ["diffuse", "roughness", "metalness"] as const) expect(chain[channel]).toEqual(compiler[channel] as Uint8Array[]);
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

