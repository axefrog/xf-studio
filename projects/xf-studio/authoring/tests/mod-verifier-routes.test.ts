import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
// Test-only use of the builder side: it writes the supplied chains and resources that the
// independent verifier must reproduce from its own restated specification.
import { encodeDds, flatMipChain } from "../src/flat-mip-chain";
import { facetedMipChain, maskMipChain, normalRgba, uniformMipChain } from "../src/route-mip-chains";
import { planCollection } from "../src/preset-collection";
import { preparePackageCollection } from "../src/package-filter";
import { FINISH_EXPORT } from "../src/finish-export";
import { archiveXlDeclaration, HandleCounter, rewritePlateMesh, rewritePlateMorph } from "../src/package-resources";
import { archiveKey } from "../src/mod-verifier/resource-inventory";
import { componentId, VERIFIER_FINISHES } from "../src/mod-verifier/resource-checks";
import { verifyBuild, type ToolResult, type VerifierTools } from "../src/mod-verifier/verify-build";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { liftPlate } from "../src/plate-lift";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe } from "./eye-plate-fixture";

// Synthetic, asset-free fixture in the style of mod-verifier.test.ts: archive members and plate inputs
// hold their WolvenKit JSON as text, the fake `serialize` derives documents from the hash-checked bytes
// and the fake `export` returns each texture's decoded DDS. The builder's conversions are never written.
const SIZE = 16, GRADIENT = 16;
const game = { model: "game-matched-1" } as const;
const layer = (id: string, finish: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, enabled: true, color: "#6d4a7e", finish, opacity: 1, feather: .01, symmetry: false, pathMode: "catmull-rom",
  points: [[.2, .2], [.8, .2], [.8, .6], [.2, .6]].map(([u, v]) => ({ u, v, weight: 1 })), fields: [],
  strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" }, ...extra });
const collection = { schema: "xfas/collection-1", id: "11111111-2222-4333-8444-555555555555", name: "Routes", presets: [
  { id: "11111111-2222-4333-8444-000000000001", name: "Flat", revision: 1,
    recipe: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer("a", "matte"), layer("b", "glossy", { optics: game })] } },
  { id: "11111111-2222-4333-8444-000000000002", name: "Faceted", revision: 1,
    recipe: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer("c", "shimmer", { optics: game })] } },
  { id: "11111111-2222-4333-8444-000000000003", name: "Shift", revision: 1,
    recipe: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer("d", "iridescent", { color: "#3a2350",
      optics: { ...game, shift: { color: "#3fd4c2", strength: .8 } } })] } },
] };
type Plan = ReturnType<typeof planCollection>;
/** The packaged collection the host prepared, after its JSON round trip to the builder. */
const packaged = JSON.parse(JSON.stringify(preparePackageCollection(collection).packaged));
const cname = (s: string) => ({ $type: "CName", $storage: "string", $value: s });
const ref = (s: string, soft = false) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: s.replaceAll("/", "\\") }, Flags: soft ? "Soft" : "Default" });
const doc = (root: unknown) => ({ Header: {}, Data: { Version: 195, RootChunk: root } });
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const write = (path: string, data: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };

/** Deterministic synthetic base maps: a soft blob with varied surface and facet normals. */
function maps(route: string) {
  const n = SIZE * SIZE, diffuse = new Uint8Array(n * 4), roughness = new Uint8Array(n), metalness = new Uint8Array(n), normal = new Uint8Array(n * 2);
  const mask = new Uint8Array(n), gradient = new Uint8Array(GRADIENT * GRADIENT * 4);
  for (let t = 0; t < GRADIENT * GRADIENT; t++) gradient.set([0x3a, 0x23, 0x50, 255], t * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = y * SIZE + x, alpha = Math.max(0, Math.min(1, 1.6 - Math.hypot(x - 7, y - 5) / 4));
    diffuse.set([110, 70, 130, Math.round(Math.sqrt(alpha) * 255)], t * 4);
    roughness[t] = 60 + x * 4; metalness[t] = route === "faceted" ? 40 : 0; mask[t] = Math.round(alpha * 255);
    normal.set([128 + ((x * 37 + y * 11) % 50) - 25, 128 + ((x * 13 + y * 29) % 50) - 25], t * 2);
  }
  return { diffuse, roughness, metalness, normal, mask, gradient };
}
/** Rewrite an RGBA DDS chain as the RG8 (DXGI 49) chain WolvenKit exports for BC5 normals. */
function rg8(levels: readonly Uint8Array[], side: number) {
  const xy = levels.map(level => level.filter((_, i) => i % 4 < 2)), out = new Uint8Array(148 + xy.reduce((n, l) => n + l.length, 0));
  out.set(encodeDds(levels, side, "rgba8-unorm").subarray(0, 148));
  new DataView(out.buffer).setUint32(128, 49, true); new DataView(out.buffer).setUint32(20, side * 2, true);
  let o = 148; for (const level of xy) { out.set(level, o); o += level.length; }
  return out;
}

type Mutation = (data: { mesh: any; xbm: Record<string, any>; plan: Plan }) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
function makeBuild(mutate?: Mutation, tamper?: (build: string, plan: Plan) => void, replan?: (plan: Plan) => void) {
  const build = mkdtempSync(resolve(tmpdir(), "xfs-verifier-routes-"));
  const plan = planCollection(collection);
  replan?.(plan);
  // A real single-chunk plate cut from the synthetic head, lifted as the builder lifts it.
  const cut = derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh");
  const blob = { renderResourceBlob: cut.mesh.Data.RootChunk.renderResourceBlob, boneNames: [cname("root")], boneRigMatrices: [], boundingBox: {} };
  const sourceMesh = { ...structuredClone(blob), appearances: [], materialEntries: [], localMaterialBuffer: {} };
  const sourceMorph = cut.morph.Data.RootChunk;
  const lifted = liftPlate(doc(structuredClone(sourceMesh)), cut.morph, plan.plate.liftsMm);
  const mesh = rewritePlateMesh(lifted.mesh, plan, new HandleCounter()).Data.RootChunk;
  const morph = rewritePlateMorph(lifted.morph, plan).Data.RootChunk;
  const id = componentId(plan.component).toString();
  const component = { $type: "entMorphTargetSkinnedMeshComponent", name: cname(plan.component), id, isEnabled: 1,
    meshAppearance: cname(plan.presets[0].appearance), morphResource: ref(plan.morph), localTransform: { Orientation: { i: 0, j: 0, k: 0, r: 1 } },
    parentTransform: { Data: { $type: "entHardTransformBinding", bindName: cname("root"), enabled: 1 } },
    skinning: { Data: { $type: "entSkinningBinding", bindName: cname("root"), enabled: 1 } } };
  const app = { appearances: [
    { Data: { name: cname(plan.offAppearance), components: [], partsOverrides: [{ componentsOverrides: [] }] } },
    { Data: { name: cname(plan.templateAppearance), components: [component], partsOverrides: [{ componentsOverrides: [{ componentName: cname(plan.component) }] }],
      compiledData: { Data: { CruidDict: { "0": id }, Chunks: [{}] } } } }] };
  const cc = { headCustomizationOptions: [{ Data: { $type: "gameuiAppearanceInfo", name: cname(plan.selector), uiSlot: cname(plan.selector),
    localizedName: plan.selectorLabel, enabled: 1, hidden: 0, defaultIndex: 0, resource: ref(plan.app, true),
    definitions: [{ name: cname(plan.offAppearance), index: 0 }, ...plan.presets.map(p => ({ name: cname(p.appAppearance), index: p.index, localizedName: p.name }))] } }],
    headGroups: ["character_customization", "face"].map(group => ({ name: cname(group), options: [cname(plan.selector)] })) };
  const setup: Record<string, [number, string]> = { diffuse: [1, "TCM_QualityColor"], gradient: [1, "TCM_QualityColor"], roughness: [0, "TCM_QualityR"],
    metalness: [0, "TCM_QualityR"], mask: [0, "TCM_QualityR"], normal: [0, "TCM_Normalmap"] };
  const xbm: Record<string, unknown> = {}, dds = new Map<string, Uint8Array>();
  const compiled = plan.presets.map(preset => {
    const m = maps(preset.route) as Record<string, Uint8Array>, chains: Record<string, readonly Uint8Array[]> = {};
    if (preset.route === "fresnel") Object.assign(chains, { mask: maskMipChain(m.mask, SIZE), gradient: uniformMipChain(m.gradient, GRADIENT) });
    else if (preset.route === "faceted") {
      const c = facetedMipChain(m.diffuse, m.roughness, m.metalness, m.normal, SIZE);
      Object.assign(chains, { diffuse: c.diffuse, roughness: c.roughness, metalness: c.metalness, normal: c.normal.map(normalRgba) });
    } else Object.assign(chains, flatMipChain(m.diffuse, m.roughness, m.metalness, SIZE));
    const records = Object.keys(preset.textures).map(channel => {
      const side = channel === "gradient" ? GRADIENT : SIZE, file = `${preset.appearance}_${channel}.raw`;
      write(join(build, "baked", file), m[channel]);
      const format = channel === "diffuse" || channel === "gradient" ? "rgba8-srgb" : channel === "normal" ? "rgba8-unorm" : "r8";
      const group = format === "rgba8-srgb" ? "dds-colour" : format === "r8" ? "dds-scalar" : "dds-normal";
      const supplied = encodeDds(chains[channel], side, format);
      write(join(build, "input", group, `${preset.appearance}_${channel}.dds`), supplied);
      dds.set(`${preset.appearance}_${channel}.dds`, channel === "normal" ? rg8(chains[channel], side) : supplied); // a lossless "decode"
      xbm[preset.textures[channel as keyof typeof preset.textures]!] = { width: side, height: side,
        setup: { hasMipchain: 1, isGamma: setup[channel][0], compression: setup[channel][1] } };
      return { channel, file, bytes: m[channel].length, sha256: sha(m[channel]), side };
    });
    return { id: preset.id, revision: 1, size: SIZE, route: preset.route, maps: records };
  });
  mutate?.({ mesh, xbm, plan });
  const plate = { mesh: join(build, "plate", "xfs_eye_plate.mesh"), morph: join(build, "plate", "xfs_eye_plate.morphtarget") };
  write(plate.mesh, JSON.stringify(doc(sourceMesh)));
  write(plate.morph, JSON.stringify(doc(sourceMorph)));
  const plateInputs = [plate.mesh, plate.morph].map(path => ({ path, sha256: sha(readFileSync(path)) }));
  const members = [[plan.mesh, mesh], [plan.morph, morph], [plan.app, app], [plan.customization, cc], ...Object.entries(xbm)] as [string, unknown][];
  const artifacts = members.map(([path, root]) => {
    const data = JSON.stringify(doc(root));
    write(join(build, "archive", path), data);
    return { path, bytes: data.length, sha256: sha(data), depotPathHash64: archiveKey(path) };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const archive = new TextEncoder().encode("synthetic archive");
  write(join(build, "package/archive/pc/mod", `${plan.namespace}.archive`), archive);
  write(join(build, "package/archive/pc/mod", `${plan.namespace}.archive.xl`), archiveXlDeclaration(plan));
  write(join(build, "build.json"), JSON.stringify({ plan, compiled, plateStem: "xfs_eye_plate", plateInputs, artifacts, archiveSha256: sha(archive) }));
  tamper?.(build, plan);
  return { build, dds };
}

const ok = (): ToolResult => ({ exitCode: 0, stdout: "ok", stderr: "" });
function run({ build, dds }: ReturnType<typeof makeBuild>, packagedCollection: unknown = packaged) {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
  const tools: VerifierTools = {
    unbundle: (_archive, output) => { cpSync(join(build, "archive"), output, { recursive: true }); return ok(); },
    serialize: (input, output) => { for (const file of files(input)) writeFileSync(join(output, basename(file) + ".json"), readFileSync(file, "utf8")); return ok(); },
    exportTextures: (input, output) => {
      for (const file of files(input)) writeFileSync(join(output, basename(file).replace(/\.xbm$/, ".dds")), dds.get(basename(file).replace(/\.xbm$/, ".dds"))!);
      return ok();
    },
  };
  // null runs without the host's collection: the verifier's own rules alone.
  return verifyBuild({ build, tools, ...(packagedCollection === null ? {} : { packagedCollection }) });
}

test("flat, faceted and Fresnel presets pass the self-sourcing verifier with route-aware checks", () => {
  const fixture = makeBuild();
  try {
    const report = run(fixture);
    expect(report).toMatchObject({ presetCount: 3, materialTemplates: 3, textureCount: 3 + 4 + 2 });
    expect(report.resolvedDynamicPaths.map(r => r.chunkMaterial.slice(r.chunkMaterial.indexOf("@")))).toEqual(["@preset", "@faceted",
      "@fresnel_11111111222243338444000000000003"]);
    expect(report.decodedPixelChecks[1]).toMatchObject({ route: "faceted" });
    expect(report.decodedPixelChecks[2]).toMatchObject({ route: "fresnel", outsideCoverageMax: 0 });
    expect(report.decodedMipChecks[1].levels.some(level => level.widenedRoughness)).toBe(true);
    expect(report.presetRoutes.map(item => item.route)).toEqual(["flat", "faceted", "fresnel"]);
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
});

test("route-specific tampering fails: widened roughness, normal chain, mask chain, base colour, constants and bindings", () => {
  const flip = (path: string, offset: number) => { const data = readFileSync(path); data[offset] ^= 0x10; writeFileSync(path, data); };
  const cases: [RegExp, Mutation | undefined, ((build: string, plan: Plan) => void) | undefined][] = [
    [/variance-widened/, undefined, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[1].appearance}_roughness.dds`), 148 + 256 + 5)],
    [/facet normal/, undefined, (b, p) => flip(join(b, "input/dds-normal", `${p.presets[1].appearance}_normal.dds`), 148 + 1024 + 9)],
    [/linear coverage/, undefined, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[2].appearance}_mask.dds`), 148 + 256 + 20)],
    [/not the preset base colour/, undefined, (b, p) => {
      const path = join(b, "baked", `${p.presets[2].appearance}_gradient.raw`), data = readFileSync(path); data[0] ^= 1; writeFileSync(path, data);
      const record = JSON.parse(readFileSync(join(b, "build.json"), "utf8"));
      record.compiled[2].maps[1].sha256 = sha(data); writeFileSync(join(b, "build.json"), JSON.stringify(record)); }],
    [/FresnelColorIntensity/, d => {
      d.mesh.localMaterialBuffer.materials[2].values.find((v: Record<string, unknown>) => "FresnelColorIntensity" in v).FresnelColorIntensity = 8; }, undefined],
    [/FadeOutOffset/, d => {
      d.mesh.localMaterialBuffer.materials[2].values.find((v: Record<string, unknown>) => "FadeOutOffset" in v).FadeOutOffset = .2; }, undefined],
    [/must name @faceted/, d => { d.mesh.appearances[1].Data.chunkMaterials = []; }, undefined],
    [/unexpected compression/, d => { d.xbm[d.plan.presets[1].textures.normal!].setup.compression = "TCM_QualityR"; }, undefined],
  ];
  for (const [message, mutate, tamper] of cases) {
    const fixture = makeBuild(mutate, tamper);
    try { expect(() => run(fixture)).toThrow(message); } finally { rmSync(fixture.build, { recursive: true, force: true }); }
  }
});

const editBuild = (build: string, edit: (record: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const record = JSON.parse(readFileSync(join(build, "build.json"), "utf8"));
  edit(record);
  writeFileSync(join(build, "build.json"), JSON.stringify(record));
};

test("PIPE-24: the verifier re-derives each route from the recipe and fails on any disagreement", () => {
  const cases: [RegExp, ((build: string, plan: Plan) => void) | undefined, ((plan: Plan) => void) | undefined, unknown?][] = [
    // A Shimmer preset compiled, packed and declared consistently as flat: every resource check would pass.
    [/Faceted was built for the flat route, but its recipe needs the faceted route/, undefined, plan => {
      const shimmer = plan.presets[1];
      Object.assign(shimmer, { route: "flat", material: "@preset" });
      delete (shimmer.textures as Record<string, string>).normal;
    }],
    // The builder's route edited in build.json, or missing (which no longer counts as flat).
    [/Shift was built for the faceted route, but its recipe needs the fresnel route/, b => editBuild(b, r => { r.plan.presets[2].route = "faceted"; }), undefined],
    [/names no export route for preset Flat/, b => editBuild(b, r => { delete r.plan.presets[0].route; }), undefined],
    [/Compiled record for .* is missing its route, but its recipe needs the flat route/, b => editBuild(b, r => { delete r.compiled[0].route; }), undefined],
    [/Compiled record for .* is flat, but its recipe needs the faceted route/, b => editBuild(b, r => { r.compiled[1].route = "flat"; }), undefined],
    // A recipe edited to match a tampered route differs from the collection the host prepared.
    [/recipe for preset Faceted differs from the packaged collection/, b => editBuild(b, r => {
      r.plan.presets[1].recipe.layers[0].finish = "matte"; r.plan.presets[1].route = "flat"; }), undefined],
    // Without the host's collection, the verifier's own rules still refuse what no route can carry.
    [/packages a glitter layer, which no export route can draw/, b => editBuild(b, r => { r.plan.presets[0].recipe.layers[0].finish = "glitter"; }), undefined, null],
    [/packages a glossy layer without its game-matched model/, b => editBuild(b, r => { delete r.plan.presets[0].recipe.layers[1].optics; }), undefined, null],
    [/Shift is not one colour-shift pigment/, b => editBuild(b, r => { r.plan.presets[2].recipe.layers.push({ ...r.plan.presets[1].recipe.layers[0] }); }), undefined, null],
  ];
  for (const [message, tamper, replan, source] of cases) {
    const fixture = makeBuild(undefined, tamper, replan);
    try { expect(() => run(fixture, source === undefined ? packaged : source)).toThrow(message); }
    finally { rmSync(fixture.build, { recursive: true, force: true }); }
  }
});

test("CORE-20: the verifier's restated finish rules agree with the builder's finish table", () => {
  const builder = Object.fromEntries(Object.entries(FINISH_EXPORT).map(([id, rule]) => [id, { route: rule.route, gameOptics: rule.gameOptics }]));
  const { satin, ...restated } = VERIFIER_FINISHES;
  expect(restated).toEqual(builder);
  expect(satin).toEqual(builder.regular);
});
