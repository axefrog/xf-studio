import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// Test-only use of the builder side: it writes the supplied chains and resources that the
// independent verifier must reproduce from its own restated specification.
import { encodeDds, flatMipChain } from "../src/flat-mip-chain";
import { facetedMipChain, maskMipChain, normalRgba, uniformMipChain } from "../src/route-mip-chains";
import { planCollection } from "../src/preset-collection";
import { HandleCounter, rewritePlateMesh } from "../src/package-resources";
import { archiveKey } from "../src/mod-verifier/resource-inventory";
import { componentId } from "../src/mod-verifier/resource-checks";
import { verifyBuild } from "../src/mod-verifier/verify-build";

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

function makeBuild(tamper?: (build: string, plan: ReturnType<typeof planCollection>) => void) {
  const build = mkdtempSync(resolve(tmpdir(), "xfs-verifier-routes-"));
  const plan = planCollection(collection);
  const blob = { renderResourceBlob: { Data: { v: 1 } }, boneNames: [cname("root")], boneRigMatrices: [], boundingBox: {} };
  const sourceMesh = { ...structuredClone(blob), appearances: [], materialEntries: [], localMaterialBuffer: {} };
  const targets = Array.from({ length: 105 }, (_, i) => ({ name: cname(`t${i}`) }));
  const mesh = rewritePlateMesh(doc(structuredClone(sourceMesh)), plan, new HandleCounter()).Data.RootChunk;
  const morph = { blob: { Data: {} }, targets, baseMesh: ref(plan.mesh) };
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
    headGroups: [{ options: [cname(plan.selector)] }] };
  const setup: Record<string, [number, string]> = { diffuse: [1, "TCM_QualityColor"], gradient: [1, "TCM_QualityColor"], roughness: [0, "TCM_QualityR"],
    metalness: [0, "TCM_QualityR"], mask: [0, "TCM_QualityR"], normal: [0, "TCM_Normalmap"] };
  const xbm: Record<string, unknown> = {};
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
      write(join(build, "input", group, `${preset.appearance}_${channel}.dds`), encodeDds(chains[channel], side, format));
      // A lossless "decode"; the normal export is two-channel.
      const decoded = channel === "normal" ? chains[channel].map(level => level.filter((_, i) => i % 4 < 2)) : chains[channel];
      const exported = encodeDds(decoded.map(l => channel === "normal" ? Uint8Array.from({ length: l.length * 2 }, (_, i) => i % 4 < 2 ? l[(i >> 2) * 2 + (i % 4)] : 0) : l), side, format);
      if (channel === "normal") { // Rewrite as an RG8 (DXGI 49) DDS.
        const levels = decoded, payload = levels.reduce((n, l) => n + l.length, 0), out = new Uint8Array(148 + payload);
        out.set(exported.subarray(0, 148)); new DataView(out.buffer).setUint32(128, 49, true); new DataView(out.buffer).setUint32(20, side * 2, true);
        let o = 148; for (const l of levels) { out.set(l, o); o += l.length; }
        write(join(build, "export-dds", `${preset.appearance}_${channel}.dds`), out);
      } else write(join(build, "export-dds", `${preset.appearance}_${channel}.dds`), exported);
      xbm[preset.textures[channel as keyof typeof preset.textures]!] = { width: side, height: side,
        setup: { hasMipchain: 1, isGamma: setup[channel][0], compression: setup[channel][1] } };
      return { channel, file, bytes: m[channel].length, sha256: sha(m[channel]), side };
    });
    return { id: preset.id, revision: 1, size: SIZE, route: preset.route, maps: records };
  });
  const name = (path: string) => path.slice(path.lastIndexOf("/") + 1) + ".json";
  for (const [path, root] of [[plan.mesh, mesh], [plan.morph, morph], [plan.app, app], [plan.customization, cc], ...Object.entries(xbm)] as [string, unknown][])
    write(join(build, "roundtrip", name(path)), JSON.stringify(doc(root)));
  write(join(build, "source-json/xfs_eye_plate.mesh.json"), JSON.stringify(doc(sourceMesh)));
  write(join(build, "source-json/xfs_eye_plate.morphtarget.json"), JSON.stringify(doc({ blob: { Data: {} }, targets })));
  const resources = [plan.mesh, plan.morph, plan.app, plan.customization, ...plan.presets.flatMap(p => Object.values(p.textures) as string[])];
  const artifacts = resources.map(path => { const data = `payload:${path}`; write(join(build, "archive", path), data);
    return { path, bytes: data.length, sha256: sha(data), depotPathHash64: archiveKey(path) }; }).sort((a, b) => (a.path < b.path ? -1 : 1));
  const archive = new TextEncoder().encode("synthetic archive");
  write(join(build, "package/archive/pc/mod", `${plan.namespace}.archive`), archive);
  write(join(build, "package/archive/pc/mod", `${plan.namespace}.archive.xl`), `female: ${plan.customization.replaceAll("/", "\\")} ${plan.app.replaceAll("/", "\\")}`);
  write(join(build, "build.json"), JSON.stringify({ plan, compiled, artifacts, plateStem: "xfs_eye_plate", archiveSha256: sha(archive) }));
  tamper?.(build, plan);
  return build;
}
const run = (build: string) => verifyBuild({ build, wolvenkit: "unused",
  unbundle: (_a, output) => { cpSync(join(build, "archive"), output, { recursive: true }); return { exitCode: 0, stdout: "ok", stderr: "" }; } });

test("flat, faceted and Fresnel presets pass the independent verifier with route-aware checks", () => {
  const build = makeBuild();
  try {
    const report = run(build);
    expect(report).toMatchObject({ presetCount: 3, materialTemplates: 3, textureCount: 3 + 4 + 2 });
    expect(report.resolvedDynamicPaths.map(r => r.chunkMaterial.slice(r.chunkMaterial.indexOf("@")))).toEqual(["@preset", "@faceted",
      "@fresnel_11111111222243338444000000000003"]);
    expect(report.decodedPixelChecks[1]).toMatchObject({ route: "faceted" });
    expect(report.decodedPixelChecks[2]).toMatchObject({ route: "fresnel", outsideCoverageMax: 0 });
    expect(report.decodedMipChecks[1].levels.some(level => level.widenedRoughness)).toBe(true);
  } finally { rmSync(build, { recursive: true, force: true }); }
});

test("route-specific tampering fails: widened roughness, normal chain, mask chain, base colour and shift constants", () => {
  const flip = (path: string, offset: number) => { const data = readFileSync(path); data[offset] ^= 0x10; writeFileSync(path, data); };
  const cases: [RegExp, (build: string, plan: ReturnType<typeof planCollection>) => void][] = [
    [/variance-widened/, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[1].appearance}_roughness.dds`), 148 + 256 + 5)],
    [/facet normal/, (b, p) => flip(join(b, "input/dds-normal", `${p.presets[1].appearance}_normal.dds`), 148 + 1024 + 9)],
    [/linear coverage/, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[2].appearance}_mask.dds`), 148 + 256 + 20)],
    [/not the preset base colour/, (b, p) => {
      const path = join(b, "baked", `${p.presets[2].appearance}_gradient.raw`), data = readFileSync(path); data[0] ^= 1; writeFileSync(path, data);
      const record = JSON.parse(readFileSync(join(b, "build.json"), "utf8"));
      record.compiled[2].maps[1].sha256 = sha(data); writeFileSync(join(b, "build.json"), JSON.stringify(record)); }],
    [/FresnelColorIntensity/, (b, p) => {
      const path = join(b, "roundtrip", p.mesh.slice(p.mesh.lastIndexOf("/") + 1) + ".json"), mesh = JSON.parse(readFileSync(path, "utf8"));
      const values = mesh.Data.RootChunk.localMaterialBuffer.materials[2].values;
      values.find((v: Record<string, unknown>) => "FresnelColorIntensity" in v).FresnelColorIntensity = 8; writeFileSync(path, JSON.stringify(mesh)); }],
    [/must name @faceted/, (b, p) => {
      const path = join(b, "roundtrip", p.mesh.slice(p.mesh.lastIndexOf("/") + 1) + ".json"), mesh = JSON.parse(readFileSync(path, "utf8"));
      mesh.Data.RootChunk.appearances[1].Data.chunkMaterials = []; writeFileSync(path, JSON.stringify(mesh)); }],
    [/unexpected compression/, (b, p) => {
      const path = join(b, "roundtrip", p.presets[1].textures.normal!.split("/").pop() + ".json"), xbm = JSON.parse(readFileSync(path, "utf8"));
      xbm.Data.RootChunk.setup.compression = "TCM_QualityR"; writeFileSync(path, JSON.stringify(xbm)); }],
  ];
  for (const [message, tamper] of cases) {
    const build = makeBuild(tamper);
    try { expect(() => run(build)).toThrow(message); } finally { rmSync(build, { recursive: true, force: true }); }
  }
});
