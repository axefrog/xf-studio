import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
// Test-only use of the builder side (bake, mip and resource code): it writes the supplied chains and resources that
// the independent verifier must accept, and the tampered copies it must refuse.
import { parseExportDiagnostics } from "../src/export-diagnostics";
import { FINISH_EXPORT, layerExport } from "../src/engines/layered-makeup/finish-export";
import { encodeDds } from "../src/engines/layered-makeup/flat-mip-chain";
import { flakeCatalogue, randomStream, tiltVariance } from "../src/glitter-route";
import { referenceCrop } from "../src/package-bake";
import { archiveXlDeclaration, HandleCounter, rewritePlateMesh, rewritePlateMorph } from "../src/package-resources";
import { liftPlate } from "../src/plate-lift";
import { planCollection } from "../src/preset-collection";
import { normalRgba } from "../src/engines/layered-makeup/route-mip-chains";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { checkGlitterChains, levelDims, restatedTiltVariance } from "../src/mod-verifier/glitter-checks";
import { archiveKey } from "../src/mod-verifier/resource-inventory";
import { componentId, glitterOf } from "../src/mod-verifier/resource-checks";
import { expectedChain } from "../src/mod-verifier/texture-checks";
import { verifyBuild, type ToolResult, type VerifierTools } from "../src/mod-verifier/verify-build";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";
import { encodedBc4, plateWindow, storedBc4 } from "./window-fixture";
import { presetCoverage } from "./fixtures/eye-region";
import { compileGlitterPreset, mirrorCatalogue, bakeCollection, preparePackageCollection } from "./fixtures/eye-exporter";

// Asset-free: a synthetic plate with plate-like UVs, Satin pigment rectangles and generated flakes.
const CUT = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
const WINDOW = plateWindow(CUT);
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } };
const patch = (id: string, [u0, v0, u1, v1]: number[], finish = "regular") => ({
  id, name: id, enabled: true, color: "#6d4a7e", finish, opacity: 1, feather: .004, symmetry: false, pathMode: "bezier",
  points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => ({ u, v, weight: 1, handles: structuredClone(corner) })),
  fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" } });
const LEFT = [.31, .21, .49, .29], RIGHT = [.51, .21, .69, .29];
const FLAKES = { sizeMm: .2, sizeSigma: .35, cover: .08, tiltSigmaDeg: 25, tiltMaxDeg: 50, roughness: .22, metalness: .85, color: "#e8c46a", seed: 2077 };
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });
const ID = (n: number) => `0210a5e5-2e55-4c02-9d0b-00000000000${n}`;
function collection(extra: Record<string, unknown> = {}) {
  return { schema: "xfas/collection-1", id: "0210a5e5-2e55-4c02-9d0b-0000000000c0", name: "Glitter test", presets: [
    { id: ID(1), name: "Accent and BOX", revision: 1, recipe: recipe([patch("left", LEFT), patch("right", RIGHT)]) },
    { id: ID(2), name: "Nested only", revision: 1, recipe: recipe([patch("left2", LEFT)]) },
  ], diagnostics: { schema: "xfs/export-diagnostics-1", presets: {
    [ID(1)]: { glitter: { base: { roughness: .5, metalness: 0 }, regions: [{ layer: "left", mips: "nested", flakes: FLAKES },
      { layer: "right", mips: "box", mirrorOf: "left" }], accent: { layer: "left", share: .08, ev: 0 } } },
    [ID(2)]: { glitter: { base: { roughness: .5, metalness: 0 }, regions: [{ layer: "left2", mips: "nested", flakes: { ...FLAKES, seed: 7 } }] } },
  } }, ...extra };
}

// ---- Maps, mips and the knob ----

test("the random stream is deterministic and uniform enough", () => {
  const a = randomStream(1), b = randomStream(1), values = Array.from({ length: 20000 }, () => a());
  expect(values.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  expect(Math.abs(mean - .5)).toBeLessThan(.01);
  expect(values.every(v => v >= 0 && v < 1)).toBe(true);
});

test("tilt variance matches its restatement and a sampled estimate", () => {
  for (const [sigma, max] of [[10, 20], [25, 50], [40, 70]]) {
    expect(Math.abs(tiltVariance(sigma, max) - restatedTiltVariance(sigma, max))).toBeLessThan(1e-12);
    const random = randomStream(sigma), n = 200000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const g = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      let t = Math.abs(g * sigma);
      if (t > max) t = random() * max;
      sum += Math.sin(t * Math.PI / 180) ** 2;
    }
    expect(Math.abs(tiltVariance(sigma, max) - sum / n)).toBeLessThan(.003);
  }
});

test("catalogues follow the recipe statistics and mirror across u = ½", () => {
  const rect = { u0: .31, v0: .21, u1: .49, v1: .29 }, c = flakeCatalogue(rect, WINDOW.window, FLAKES);
  const widths = [...c.width].sort((a, b) => a - b), median = widths[widths.length >> 1];
  expect(Math.abs(median - .2)).toBeLessThan(.01);
  const tilts = [...c.nx].map((x, i) => Math.asin(Math.hypot(x, c.ny[i])) * 180 / Math.PI);
  expect(Math.max(...tilts)).toBeLessThanOrEqual(50 + 1e-9);
  const hexArea = 3 * Math.sqrt(3) / 8, area = [...c.width].reduce((s, d, i) => s + hexArea * d * d * c.aspect[i], 0);
  expect(Math.abs(area / c.areaMm2 - FLAKES.cover) / FLAKES.cover).toBeLessThan(.1);
  const m = mirrorCatalogue(c, WINDOW.window);
  const uOf = (x: number) => WINDOW.window.u0 + x / 569;
  expect(Math.abs(uOf(m.cx[0]) - (1 - uOf(c.cx[0])))).toBeLessThan(1e-12);
  expect(m.nx[0]).toBe(-c.nx[0]);
  expect(m.key).toEqual(c.key);
});

test("glitter maps: coverage from the pigment, resolved nested flakes, sheen below, deterministic", () => {
  const prepared = preparePackageCollection(collection()), plan = prepared.plan, preset = plan.presets[1];
  const dims = { width: 1024, height: 256 };
  const a = compileGlitterPreset(preset.recipe, preset.diagnostics!.glitter!, WINDOW.window, dims);
  const b = compileGlitterPreset(preset.recipe, preset.diagnostics!.glitter!, WINDOW.window, dims);
  expect(a.flakes.map(l => createHash("sha256").update(l).digest("hex"))).toEqual(b.flakes.map(l => createHash("sha256").update(l).digest("hex")));
  expect(a.diffuse.length).toBe(levelDims(1024, 256).length);
  // Level 0 draws the catalogue; the represented counts only shrink and end in sheen.
  const counts = a.stats.map(s => s.regions[0].represented);
  expect(counts[0]).toBeGreaterThan(1000);
  for (let L = 1; L < counts.length; L++) expect(counts[L]).toBeLessThanOrEqual(counts[L - 1]);
  expect(counts.at(-1)).toBe(0);
  expect(a.stats.every(s => s.regions[0].minWidthTexels === null || s.regions[0].minWidthTexels >= 2)).toBe(true);
  // The independent verifier's restated properties hold for the builder's chains.
  const glitter = glitterOf(preset as never)!;
  const alpha = expectedChain(a.diffuse[0], a.roughness[0], a.metalness[0], dims.width, dims.height).chain.diffuse
    .map(level => Uint8Array.from({ length: level.length / 4 }, (_, t) => level[4 * t + 3]));
  const report = checkGlitterChains(preset.name, preset.recipe, glitter, WINDOW.window, dims, a, alpha);
  expect(report.levels[0].minComponentMass).toBeGreaterThanOrEqual(2.3);
  expect(report.sheenTexelsChecked).toBeGreaterThan(0);
  // A 1-texel speck, a flake outside the pigment and an independently redrawn level are all refused.
  const speck = { ...a, flakes: a.flakes.map(l => l.slice()) };
  const lonely = findIsolated(speck.flakes[0], a.diffuse[0], dims);
  speck.flakes[0][lonely] = 255;
  expect(() => checkGlitterChains(preset.name, preset.recipe, glitter, WINDOW.window, dims, speck, alpha)).toThrow(/less than a resolved/);
  const outside = { ...a, flakes: a.flakes.map(l => l.slice()) };
  outside.flakes[0][0] = 200;
  expect(() => checkGlitterChains(preset.name, preset.recipe, glitter, WINDOW.window, dims, outside, alpha)).toThrow(/outside the pigment's coverage/);
  const redrawn = compileGlitterPreset(preset.recipe, { ...preset.diagnostics!.glitter!, regions: [{ ...preset.diagnostics!.glitter!.regions[0],
    flakes: { ...FLAKES, seed: 99 } }] }, WINDOW.window, dims);
  const mixed = { ...a, flakes: a.flakes.map((l, L) => (L === 1 ? redrawn.flakes[1] : l)) };
  expect(() => checkGlitterChains(preset.name, preset.recipe, glitter, WINDOW.window, dims, mixed, alpha)).toThrow(/not nested/);
}, 60_000);

/** A covered texel whose 5 × 5 neighbourhood has no flakes. */
function findIsolated(flakes: Uint8Array, diffuse: Uint8Array, { width, height }: { width: number; height: number }) {
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    if (diffuse[4 * (y * width + x) + 3] !== 255) continue;
    let empty = true;
    for (let dy = -2; dy <= 2 && empty; dy++) for (let dx = -2; dx <= 2; dx++) if (flakes[(y + dy) * width + x + dx]) { empty = false; break; }
    if (empty) return y * width + x;
  }
  throw Error("no isolated texel");
}

test("BOX regions keep points only where nested mips re-draw them", () => {
  const plan = preparePackageCollection(collection()).plan, preset = plan.presets[0], dims = { width: 1024, height: 256 };
  const c = compileGlitterPreset(preset.recipe, preset.diagnostics!.glitter!, WINDOW.window, dims);
  // Level 1 (0.5 mm texels here): the nested (left) lid still has full-strength flakes; the BOX (right) lid's are averaged away.
  const bright = (level: number, half: "left" | "right") => {
    const { width, height } = levelDims(dims.width, dims.height)[level];
    let count = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((x < width / 2) === (half === "left") && c.flakes[level][y * width + x] >= 200) count++;
    return count;
  };
  // Identical (mirrored) level 0; one level down the BOX lid keeps far fewer full-strength flake texels.
  expect(Math.abs(bright(0, "left") - bright(0, "right")) / bright(0, "left")).toBeLessThan(.05);
  expect(bright(1, "left")).toBeGreaterThan(2 * bright(1, "right"));
  // The accent chain: resolved at level 0, nothing beyond the cap.
  expect(c.accent!.length).toBe(12);
  expect(c.accent![0].some(v => v === 255)).toBe(true);
  expect(c.accent!.slice(2).every(level => level.every(v => v === 0))).toBe(true);
}, 60_000);

test("the glitter knob is validated, and only it reaches the route", () => {
  const ids = [ID(1)];
  const knob = collection().diagnostics.presets[ID(1)];
  expect(parseExportDiagnostics({ schema: "xfs/export-diagnostics-1", presets: { [ID(1)]: knob } }, ids)!.presets[ID(1)].glitter!.regions[1])
    .toEqual({ layer: "right", mips: "box", mirrorOf: "left" });
  const bad = (glitter: unknown) => () => parseExportDiagnostics({ schema: "xfs/export-diagnostics-1", presets: { [ID(1)]: { glitter } } }, ids);
  expect(bad({ ...knob.glitter, regions: [{ layer: "left", mips: "nested", flakes: { ...FLAKES, sizeMm: 3 } }] })).toThrow(/out of range/);
  expect(bad({ ...knob.glitter, regions: [{ layer: "left", mips: "sideways", flakes: FLAKES }] })).toThrow(/mips/);
  expect(bad({ ...knob.glitter, regions: [{ layer: "right", mips: "box", mirrorOf: "left" }] })).toThrow(/mirrors left/);
  expect(bad({ ...knob.glitter, accent: { layer: "nowhere", share: .08, ev: 0 } })).toThrow(/accent names a layer/);
  expect(() => parseExportDiagnostics({ schema: "xfs/export-diagnostics-1", presets: { [ID(1)]: { ...knob, uvSpace: "head" } } }, ids)).toThrow(/cannot be combined/);
  // The Glitter finish is still guarded: no route, omitted with its reason, even inside a glitter-knob preset.
  expect(FINISH_EXPORT.glitter.route).toBeNull();
  expect(layerExport({ finish: "glitter" } as never)).toMatchObject({ exportable: false });
  const withGlitterLayer = collection();
  withGlitterLayer.presets[1].recipe.layers.push({ ...patch("sparkle", LEFT, "glitter") });
  const prepared = preparePackageCollection(withGlitterLayer);
  expect(prepared.omissions).toEqual([expect.objectContaining({ kind: "layer", layerId: "sparkle", finish: "glitter" })]);
  expect(prepared.plan.presets[1].route).toBe("glitter");
  // A knob that names the omitted Glitter layer, or sits on a non-flat preset, is refused.
  const namesGlitter = collection();
  namesGlitter.presets[1].recipe.layers.push({ ...patch("sparkle", LEFT, "glitter") });
  namesGlitter.diagnostics.presets[ID(2)].glitter.regions = [{ layer: "sparkle", mips: "nested", flakes: FLAKES }];
  expect(() => preparePackageCollection(namesGlitter)).toThrow(/names layer sparkle/);
  const shimmer = collection();
  shimmer.presets[1].recipe.layers[0] = { ...patch("left2", LEFT, "shimmer"), optics: { model: "game-matched-1" } } as never;
  expect(() => preparePackageCollection(shimmer)).toThrow(/flat-finish pigment layers only/);
  // Without the knob the same layers stay on the production flat route, on one chunk.
  const plain = planCollection({ ...collection(), diagnostics: undefined });
  expect(plain.presets.map(p => p.route)).toEqual(["flat", "flat"]);
  expect(plain.plate).toEqual({ liftsMm: [.4] });
  expect(plain.presets.every(p => !("accentMaterial" in p))).toBe(true);
});

test("plan and materials: @glitter on the window, the accent on its own chunk, hidden elsewhere", () => {
  const plan = preparePackageCollection(collection()).plan;
  expect(plan.plate).toEqual({ liftsMm: [.4, .4], accentChunk: 1 });
  expect(plan.presets.map(p => [p.route, p.material, p.accentMaterial, p.plateChunk, Object.keys(p.textures)])).toEqual([
    ["glitter", "@glitter", "@accent_0210a5e52e554c029d0b000000000001", 0, ["diffuse", "roughness", "metalness", "normal", "flakes", "accent"]],
    ["glitter", "@glitter", undefined, 0, ["diffuse", "roughness", "metalness", "normal", "flakes"]],
  ]);
  const lifted = liftPlate({ Data: { RootChunk: { ...structuredClone(CUT.mesh.Data.RootChunk), appearances: [], materialEntries: [], localMaterialBuffer: {} } } },
    CUT.morph, plan.plate.liftsMm);
  expect(lifted.report.chunks).toBe(2);
  const mesh = rewritePlateMesh(lifted.mesh, plan, new HandleCounter(), WINDOW.transform).Data.RootChunk;
  expect(mesh.materialEntries.map((e: any) => e.name.$value)).toEqual(["@glitter", "@accent_0210a5e52e554c029d0b000000000001", "xfs_hidden"]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const names = (i: number) => mesh.appearances[i].Data.chunkMaterials.map((c: any) => c.$value); // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(names(0)).toEqual([plan.presets[0].appearance + "@glitter", plan.presets[0].appearance + "@accent_0210a5e52e554c029d0b000000000001"]);
  expect(names(1)).toEqual([plan.presets[1].appearance + "@glitter", "xfs_hidden"]);
  const values = (i: number) => Object.assign({}, ...mesh.localMaterialBuffer.materials[i].values.map(({ $type: _t, ...rest }: any) => rest)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const glitter = values(0), accent = values(1);
  expect(mesh.localMaterialBuffer.materials[0].baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal.mt");
  expect(glitter).toMatchObject({ DiffuseAlpha: 1, NormalAlpha: 1, UseNormalAlphaTex: 1, NormalsBlendingMode: 1, RoughnessMetalnessAlpha: 1,
    UVScaleX: WINDOW.transform.UVScaleX, UVOffsetY: WINDOW.transform.UVOffsetY });
  expect(glitter.NormalAlphaTex.DepotPath.$value).toEndWith("{material}_flakes.xbm");
  expect(mesh.localMaterialBuffer.materials[1].baseMaterial.DepotPath.$value).toBe("base\\materials\\mesh_decal_emissive_subsurface.mt");
  expect(accent).toMatchObject({ EmissiveEV: 0, AlphaThreshold: 0, EmissiveColor: { Red: 0xe8, Green: 0xc4, Blue: 0x6a, Alpha: 255 },
    EmissiveMaskChannel: { $type: "Vector4", X: 1, Y: 0, Z: 0, W: 0 } });
  expect(accent.EmissiveMask.DepotPath.$value).toEndWith("{material}_accent.xbm");
});

// ---- The independent verifier on a synthetic glitter build ----

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const write = (path: string, data: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
const cname = (s: string) => ({ $type: "CName", $storage: "string", $value: s });
const ref = (s: string, soft = false) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: s.replaceAll("/", "\\") }, Flags: soft ? "Soft" : "Default" });
const doc = (root: unknown) => ({ Header: {}, Data: { Version: 195, RootChunk: root } });
const BYTES: Record<string, number> = { diffuse: 4, normal: 2, roughness: 1, metalness: 1, flakes: 1, accent: 1 };
/** Level 0 of a scalar map made uniform in 4 × 4 blocks (block mean), so a stored BC4 level encodes it exactly. */
function blockUniform(bytes: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(bytes.length);
  for (let by = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4) {
    let sum = 0;
    for (let k = 0; k < 16; k++) sum += bytes[(by + (k >> 2)) * width + bx + (k & 3)];
    for (let k = 0; k < 16; k++) out[(by + (k >> 2)) * width + bx + (k & 3)] = Math.round(sum / 16);
  }
  return out;
}
function rg8(levels: readonly Uint8Array[], dims: { width: number; height: number }) {
  const xy = levels.map(level => level.filter((_, i) => i % 4 < 2)), out = new Uint8Array(148 + xy.reduce((n, l) => n + l.length, 0));
  out.set(encodeDds(levels, dims, "rgba8-unorm").subarray(0, 148));
  new DataView(out.buffer).setUint32(128, 49, true);
  let o = 148; for (const level of xy) { out.set(level, o); o += level.length; }
  return out;
}

type Plan = ReturnType<typeof planCollection>;
const BAKED = (() => {
  const dir = mkdtempSync(resolve(tmpdir(), "xfs-glitter-bake-")), packaged = JSON.parse(JSON.stringify(preparePackageCollection(collection()).packaged));
  return { dir, packaged, result: bakeCollection(packaged, join(dir, "baked"), undefined, { window: WINDOW.window }) };
})();

async function makeBuild(mutate?: (d: { mesh: any; plan: Plan }) => void, tamper?: (build: string, plan: Plan) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { plan, records } = await BAKED.result, build = mkdtempSync(resolve(tmpdir(), "xfs-glitter-build-"));
  cpSync(join(BAKED.dir, "baked"), join(build, "baked"), { recursive: true });
  const sourceMesh = { renderResourceBlob: CUT.mesh.Data.RootChunk.renderResourceBlob, boneNames: [cname("root")], boneRigMatrices: [], boundingBox: {},
    appearances: [], materialEntries: [], localMaterialBuffer: {} };
  const lifted = liftPlate(doc(structuredClone(sourceMesh)), CUT.morph, plan.plate.liftsMm);
  const mesh = rewritePlateMesh(lifted.mesh, plan, new HandleCounter(), WINDOW.transform).Data.RootChunk;
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
  const xbm: Record<string, unknown> = {}, dds = new Map<string, Uint8Array>();
  plan.presets.forEach((preset, i) => {
    for (const map of records[i].maps) {
      const raw = new Uint8Array(readFileSync(join(build, "baked", map.file))), levels: Uint8Array[] = [];
      let offset = 0;
      for (const d of levelDims(map.width, map.height)) { const n = d.width * d.height * BYTES[map.channel]; levels.push(raw.slice(offset, offset + n)); offset += n; }
      const dims = { width: map.width, height: map.height }, channel = map.channel;
      const format = channel === "diffuse" ? "rgba8-srgb" : channel === "normal" ? "rgba8-unorm" : "r8";
      const group = format === "rgba8-srgb" ? "dds-colour" : format === "r8" ? "dds-scalar" : "dds-normal";
      const supplied = channel === "normal" ? levels.map(normalRgba) : levels;
      write(join(build, "input", group, `${preset.appearance}_${channel}.dds`), encodeDds(supplied, dims, format));
      // The fake export "decodes" losslessly, except that roughness level 0 is block-uniform like its stored BC4 level and
      // the accent's level 0 is its BC4 encoding decoded (both stored with reversed rows, as the verifier checks).
      const accentBc4 = channel === "accent" ? encodedBc4(levels[0], map.width, map.height) : undefined;
      const decoded = channel === "roughness" ? [blockUniform(levels[0], map.width, map.height), ...levels.slice(1)]
        : accentBc4 ? [accentBc4.decoded, ...levels.slice(1)] : supplied;
      dds.set(`${preset.appearance}_${channel}.dds`, channel === "normal" ? rg8(supplied, dims) : encodeDds(decoded, dims, format));
      const setup = channel === "diffuse" ? [1, "TCM_QualityColor"] : channel === "normal" ? [0, "TCM_Normalmap"] : [0, "TCM_QualityR"];
      xbm[preset.textures[channel]!] = { ...dims, setup: { hasMipchain: 1, isGamma: setup[0], compression: setup[1] },
        ...(channel === "roughness" ? { renderTextureResource: storedBc4(decoded[0], map.width, map.height) } : {}),
        ...(accentBc4 ? { renderTextureResource: accentBc4.renderTextureResource } : {}) };
    }
  });
  mutate?.({ mesh, plan });
  const plate = { mesh: join(build, "plate", "xfs_eye_plate.mesh"), morph: join(build, "plate", "xfs_eye_plate.morphtarget") };
  write(plate.mesh, JSON.stringify(doc(sourceMesh)));
  write(plate.morph, JSON.stringify(doc(CUT.morph.Data.RootChunk)));
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
  write(join(build, "build.json"), JSON.stringify({ plan, compiled: records, plateStem: "xfs_eye_plate", plateInputs, artifacts, plateUv: WINDOW, archiveSha256: sha(archive) }));
  tamper?.(build, plan);
  return { build, dds };
}
const ok = (): ToolResult => ({ exitCode: 0, stdout: "ok", stderr: "" });
function run({ build, dds }: Awaited<ReturnType<typeof makeBuild>>, packagedCollection: unknown = BAKED.packaged) {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
  const tools: VerifierTools = {
    unbundle: (_archive, output) => { cpSync(join(build, "archive"), output, { recursive: true }); return ok(); },
    serialize: (input, output) => { for (const file of files(input)) writeFileSync(join(output, basename(file) + ".json"), readFileSync(file, "utf8")); return ok(); },
    exportTextures: (input, output) => {
      for (const file of files(input)) writeFileSync(join(output, basename(file).replace(/\.xbm$/, ".dds")), dds.get(basename(file).replace(/\.xbm$/, ".dds"))!);
      return ok();
    },
  };
  return verifyBuild({ build, tools, ...(packagedCollection === null ? {} : { packagedCollection }) });
}
const editBuild = (build: string, edit: (record: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const record = JSON.parse(readFileSync(join(build, "build.json"), "utf8"));
  edit(record);
  writeFileSync(join(build, "build.json"), JSON.stringify(record));
};
/** Edit one archive member's RootChunk and record its new hash, as a builder that wrote it that way would. */
const editMember = (build: string, path: string, edit: (root: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const file = join(build, "archive", path), document = JSON.parse(readFileSync(file, "utf8"));
  edit(document.Data.RootChunk);
  const data = JSON.stringify(document);
  writeFileSync(file, data);
  editBuild(build, r => { Object.assign(r.artifacts.find((a: { path: string }) => a.path === path), { bytes: data.length, sha256: sha(data) }); });
};
/** Level 0 of a baked chain file. */
const readBakedLevel = (build: string, file: string, width: number, height: number, bytes: number) =>
  new Uint8Array(readFileSync(join(build, "baked", file))).slice(0, width * height * bytes);
const flipLevelRows = (level: Uint8Array, width: number, height: number) => {
  const out = new Uint8Array(level.length);
  for (let y = 0; y < height; y++) out.set(level.subarray((height - 1 - y) * width, (height - y) * width), y * width);
  return out;
};

test("a glitter build with an accent chunk passes the independent verifier", async () => {
  const fixture = await makeBuild();
  try {
    const report = run(fixture);
    expect(report.presetRoutes.map(r => r.route)).toEqual(["glitter", "glitter"]);
    expect(report).toMatchObject({ materialTemplates: 3, textureCount: 6 + 5, plateGeometry: { liftsMm: [.4, .4], chunks: 2 } });
    const pixel = report.decodedPixelChecks[0] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pixel.route).toBe("glitter");
    expect(pixel.chains.boxTexelsChecked).toBeGreaterThan(0);
    expect(pixel.accent.onFlakes).toBeGreaterThanOrEqual(.75);
    // PIPE-74: the accent's stored rows and its placement at the plate's UVs, on its own layer.
    expect(pixel.accent.storedRows).toBe("reversed");
    expect(pixel.accent.placement.drawn).toBeGreaterThan(20);
    expect(pixel.accent.placement.outsideShare).toBeLessThanOrEqual(.02);
    // PIPE-68: the chains' contents were read.
    expect(pixel.chains.minNormalMatch).toBe(1);
    expect(pixel.chains.pigmentTexelsChecked).toBeGreaterThan(0);
    expect(pixel.decoded.keptChain.every((row: any) => row.toSupplied < row.toBox)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(report.resolvedDynamicPaths[0].textures.accent).toBe((await BAKED.result).plan.presets[0].textures.accent);
  } finally { rmSync(fixture.build, { recursive: true, force: true }); }
}, 120_000);

test("glitter tampering fails: accent constants and binding, supplied chains, BOX rule, knob and route", async () => {
  const flip = (path: string, offset: number) => { const data = readFileSync(path); data[offset] ^= 0x40; writeFileSync(path, data); };
  const rebake = (build: string, plan: Plan, channel: string, edit: (data: Buffer) => void) => {
    const file = `${plan.presets[0].appearance}_${channel}.raw`, path = join(build, "baked", file), data = readFileSync(path);
    edit(data); writeFileSync(path, data);
    editBuild(build, r => { r.compiled[0].maps.find((m: any) => m.channel === channel).sha256 = sha(data); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const cases: [RegExp, ((d: { mesh: any; plan: Plan }) => void) | undefined, ((build: string, plan: Plan) => void) | undefined, unknown?][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    [/Accent material .* EmissiveEV/, d => { d.mesh.localMaterialBuffer.materials[1].values.find((v: any) => "EmissiveEV" in v).EmissiveEV = 4; }, undefined], // eslint-disable-line @typescript-eslint/no-explicit-any
    [/Seed appearance does not use the @glitter template/, d => { d.mesh.appearances[0].Data.chunkMaterials[1] = cname("xfs_hidden"); }, undefined],
    [/must name @glitter/, d => { d.mesh.appearances[1].Data.chunkMaterials[1] = d.mesh.appearances[0].Data.chunkMaterials[1]; }, undefined],
    [/Material @glitter UseNormalAlphaTex/, d => { d.mesh.localMaterialBuffer.materials[0].values.find((v: any) => "UseNormalAlphaTex" in v).UseNormalAlphaTex = 0; }, undefined], // eslint-disable-line @typescript-eslint/no-explicit-any
    [/Supplied flakes mip chain .* differs/, undefined, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[0].appearance}_flakes.dds`), 148 + 4096 * 1024 + 77)],
    [/Supplied accent mip chain .* differs/, undefined, (b, p) => flip(join(b, "input/dds-scalar", `${p.presets[0].appearance}_accent.dds`), 148 + 2048 * 2048 + 3)],
    [/BOX region right .* is not the BOX chain/, undefined, (b, p) => rebake(b, p, "flakes", data => {
      // One texel inside the right lid at level 1 (2048 × 512), then the supplied DDS no longer matters: the BOX rule fails first.
      const x = Math.floor((.6 - WINDOW.window.u0) / (WINDOW.window.u1 - WINDOW.window.u0) * 2048), y = Math.floor((.25 - WINDOW.window.v0) / (WINDOW.window.v1 - WINDOW.window.v0) * 512);
      data[4096 * 1024 + y * 2048 + x] ^= 0x20; })],
    [/Accent and BOX was built for the flat route, but its recipe needs the glitter route/, undefined, b => editBuild(b, r => { r.plan.presets[0].route = "flat"; })],
    [/diagnostics for preset Accent and BOX differ from the packaged collection/, undefined, undefined,
      (() => { const c = structuredClone(BAKED.packaged); c.diagnostics.presets[ID(1)].glitter.accent.ev = 1; return c; })()],
    [/Plan accent chunk undefined differs from the expected 1/, undefined, b => editBuild(b, r => { delete r.plan.plate.accentChunk; })],
    // PIPE-74: an accent stored in natural row order, and an accent sampled at the plate against another layer's coverage.
    [/accent is not stored with reversed rows/, undefined, (b, p) => editMember(b, p.presets[0].textures.accent!, xbm => {
      const level = readBakedLevel(b, `${p.presets[0].appearance}_accent.raw`, 2048, 2048, 1);
      xbm.renderTextureResource = encodedBc4(flipLevelRows(encodedBc4(level, 2048, 2048).decoded, 2048, 2048), 2048, 2048).renderTextureResource;
    })],
    [/accent of .* lies outside its layer at the plate's UVs/, undefined, (b, p) => {
      const packagedPreset = BAKED.packaged.presets[0], crop = referenceCrop(WINDOW.window);
      const data = presetCoverage({ ...packagedPreset.recipe, layers: packagedPreset.recipe.layers.filter((l: { id: string }) => l.id === "right") }, crop);
      const file = `${p.presets[0].appearance}_accent_reference.raw`;
      writeFileSync(join(b, "baked", file), data);
      editBuild(b, r => { r.compiled[0].accentReference.sha256 = sha(data); });
    }],
  ];
  for (const [message, mutate, tamper, source] of cases) {
    const fixture = await makeBuild(mutate, tamper);
    try { expect(() => run(fixture, source === undefined ? BAKED.packaged : source)).toThrow(message); }
    finally { rmSync(fixture.build, { recursive: true, force: true }); }
  }
}, 600_000);

test("PIPE-76: two bakes of the same collection are identical in every channel, the references and the records", async () => {
  const first = await BAKED.result, dir = mkdtempSync(resolve(tmpdir(), "xfs-glitter-rebake-"));
  try {
    const second = await bakeCollection(JSON.parse(JSON.stringify(BAKED.packaged)), dir, undefined, { window: WINDOW.window });
    const files = (records: typeof first.records) => records.flatMap(r => [...r.maps.map(m => [m.file, m.sha256]),
      ...[r.reference, r.accentReference].filter(x => x).map(x => [x!.file, x!.sha256])]);
    expect(files(second.records)).toEqual(files(first.records));
    expect(files(first.records).map(([file]) => file)).toEqual(expect.arrayContaining([
      `${first.plan.presets[0].appearance}_accent.raw`, `${first.plan.presets[0].appearance}_accent_reference.raw`,
      ...["diffuse", "roughness", "metalness", "normal", "flakes"].map(channel => `${first.plan.presets[1].appearance}_${channel}.raw`)]));
    for (const [file, hash] of files(second.records)) expect(sha(readFileSync(join(dir, file))), file).toBe(hash!);
    expect(readFileSync(join(dir, "compiled.json"), "utf8")).toBe(readFileSync(join(BAKED.dir, "baked", "compiled.json"), "utf8"));
    expect(readFileSync(join(dir, "plan.json"), "utf8")).toBe(readFileSync(join(BAKED.dir, "baked", "plan.json"), "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 300_000);

test("cleanup of the shared bake", async () => {
  await BAKED.result;
  rmSync(BAKED.dir, { recursive: true, force: true });
});
