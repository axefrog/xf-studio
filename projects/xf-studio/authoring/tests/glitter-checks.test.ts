import { expect, test } from "bun:test";
// Test-only use of the builder side (glitter route, region rules, planning) against the independent verifier's
// restatements: the verifier must accept the builder's chains and refuse every tampered copy (PIPE-68..73, PIPE-76).
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { clipRect, flakeCount, layerOutlineBounds, MAX_REGION_FLAKES } from "../src/glitter-region";
import { checkGlitterChains, levelDims, restatedCatalogue } from "../src/mod-verifier/glitter-checks";
import { glitterOf, restatedOutline } from "../src/mod-verifier/resource-checks";
import { expectedChain } from "../src/mod-verifier/texture-checks";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";
import { plateWindow } from "./window-fixture";
import { readRecipe as parseRecipe } from "../src/recipe-schema";
import { raster } from "./fixtures/eye-region";
import { compileGlitterPreset, preparePackageCollection, preflightPackageCollection } from "./fixtures/eye-exporter";

const CUT = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
const WINDOW = plateWindow(CUT).window;
const corner = (inU = 0, inV = 0, outU = 0, outV = 0) => ({ mode: "corner", in: { u: inU, v: inV }, out: { u: outU, v: outV } });
const patch = (id: string, [u0, v0, u1, v1]: number[], extra: Record<string, unknown> = {}) => ({
  id, name: id, enabled: true, color: "#6d4a7e", finish: "regular", opacity: 1, feather: .004, symmetry: false, pathMode: "bezier",
  points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => ({ u, v, weight: 1, handles: corner() })),
  fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" }, ...extra });
const LEFT = [.31, .21, .49, .29];
const FLAKES = { sizeMm: .2, sizeSigma: .35, cover: .08, tiltSigmaDeg: 25, tiltMaxDeg: 50, roughness: .22, metalness: .85, color: "#e8c46a", seed: 2077 };
const ID = "0210a5e5-2e55-4c02-9d0b-000000000001";
const collection = (layers: unknown[], glitter: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  schema: "xfas/collection-1", id: "0210a5e5-2e55-4c02-9d0b-0000000000c1", name: "Glitter checks",
  presets: [{ id: ID, name: "Nested", revision: 1, recipe: { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers } }],
  diagnostics: { schema: "xfs/export-diagnostics-1", presets: { [ID]: { glitter: { base: { roughness: .5, metalness: 0 }, ...glitter }, ...extra } } } });
const DIMS = { width: 1024, height: 256 };
type Chains = ReturnType<typeof compileGlitterPreset>;

/** Plan one glitter preset and compile it on the fixture window at 1024 × 256. */
function compiled(layers: unknown[], regions: unknown[]) {
  const preset = preparePackageCollection(collection(layers, { regions })).plan.presets[0];
  const chains = compileGlitterPreset(preset.recipe, preset.diagnostics!.glitter!, WINDOW, DIMS);
  const alpha = expectedChain(chains.diffuse[0], chains.roughness[0], chains.metalness[0], DIMS.width, DIMS.height).chain.diffuse
    .map(level => Uint8Array.from({ length: level.length / 4 }, (_, t) => level[4 * t + 3]));
  const verify = (c: Chains = chains) => checkGlitterChains(preset.name, preset.recipe, glitterOf(preset as never)!, WINDOW, DIMS, c, alpha);
  return { preset, chains, verify };
}
const NESTED = compiled([patch("left", LEFT)], [{ layer: "left", mips: "nested", flakes: FLAKES }]);
const each = (chain: Uint8Array[], edit: (level: Uint8Array, L: number) => Uint8Array) => chain.map((level, L) => edit(level.slice(), L));

test("PIPE-68: the verifier reads the flakes' contents and accepts the builder's", () => {
  const report = NESTED.verify();
  expect(report.flakeTexelsChecked).toBeGreaterThan(1000);
  expect(report.minNormalMatch).toBe(1);
  expect(report.minTiltedShare!).toBeGreaterThan(.9);
  expect(report.pigmentTexelsChecked).toBeGreaterThan(10000);
});

test("PIPE-68: flat normals, reset flake material, negated Y, a flipped V and a grey pigment all fail", () => {
  const a = NESTED.chains, isFlake = (L: number, t: number) => a.flakes[L][t] > 0;
  const cases: [string, Chains, RegExp][] = [
    ["all-flat normals", { ...a, normal: a.normal.map(l => new Uint8Array(l.length).fill(128)) }, /are flat|not their flakes' tilts/],
    ["flake roughness and metalness reset to the base", { ...a,
      roughness: each(a.roughness, (l, L) => l.map((v, t) => (isFlake(L, t) ? 128 : v))),
      metalness: each(a.metalness, (l, L) => l.map((v, t) => (isFlake(L, t) ? 0 : v))) }, /are \d+\/\d+, not their 56\/217/],
    ["normal Y negated", { ...a, normal: each(a.normal, l => l.map((v, i) => (i % 2 && v !== 128 ? 255 - v : v))) }, /not their flakes' tilts/],
    ["flakes and normals V-flipped", { ...a, flakes: each(a.flakes, (l, L) => flipRows(l, L, 1)), normal: each(a.normal, (l, L) => flipRows(l, L, 2)) },
      /Glitter/],
    ["grey pigment and flakes", { ...a, diffuse: each(a.diffuse, l => l.map((v, i) => (i % 4 === 3 ? v : 128))) }, /not their colour/],
    ["grey pigment between flakes", { ...a, diffuse: each(a.diffuse, (l, L) => l.map((v, i) => (i % 4 === 3 || isFlake(L, i >> 2) ? v : 128))) },
      /pigment of Nested at level 0 is not its layers' colour/],
  ];
  for (const [label, chains, message] of cases) expect(() => NESTED.verify(chains), label).toThrow(message);
});

/** A level's rows reversed (`stride` bytes per texel). */
function flipRows(level: Uint8Array, L: number, stride: number) {
  const { width, height } = levelDims(DIMS.width, DIMS.height)[L], out = new Uint8Array(level.length), row = width * stride;
  for (let y = 0; y < height; y++) out.set(level.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

test("PIPE-76: tilt, density and sheen tampering fail", () => {
  const a = NESTED.chains;
  // A normal beyond the knob's 50° maximum.
  const tilt = { ...a, normal: each(a.normal, (l, L) => { if (L === 0) { const t = a.flakes[0].findIndex(v => v === 255); l[2 * t] = 255; l[2 * t + 1] = 128; } return l; }) };
  expect(() => NESTED.verify(tilt)).toThrow(/tilts beyond the knob's maximum/);
  // No flakes at level 0: the region covers nothing.
  expect(() => NESTED.verify({ ...a, flakes: each(a.flakes, (l, L) => (L === 0 ? l.fill(0) : l)) })).toThrow(/covers 0\.000 at level 0/);
  // A flake-free level's sheen moved by ten bytes.
  const free = a.flakes.findIndex(level => level.every(v => v === 0));
  expect(free).toBeGreaterThan(0);
  const sheen = { ...a, roughness: each(a.roughness, (l, L) => (L === free ? l.map((v, t) => (a.diffuse[L][4 * t + 3] === 255 ? v + 10 : v)) : l)) };
  expect(() => NESTED.verify(sheen)).toThrow(/Glitter sheen of left/);
});

test("PIPE-72: a region is its layer's outline bounds, and the verifier restates them exactly", () => {
  const curved = patch("curved", LEFT, { points: [
    { u: .31, v: .23, weight: 1, handles: corner(0, 0, .02, -.04) }, { u: .49, v: .23, weight: 1, handles: corner(-.02, -.04, 0, 0) },
    { u: .49, v: .29, weight: 1, handles: corner() }, { u: .31, v: .29, weight: 1, handles: corner() }] });
  const catmull = { ...patch("catmull", [.3, .2, .5, .3]), pathMode: "catmull-rom",
    points: [[.3, .2], [.5, .21], [.52, .3], [.29, .28]].map(([u, v]) => ({ u, v, weight: 1 })) };
  const soft = { ...patch("soft", LEFT, { softness: { mode: "boundary", blend: .0001 } }),
    points: patch("soft", LEFT).points.map((p, i) => ({ ...p, feather: [.004, .02, .01, .004][i] })) };
  const warped = patch("warped", LEFT, { fields: [{ id: "w", u: .4, v: .25, du: .03, dv: -.02, radius: .05 }] });
  for (const raw of [curved, catmull, soft, warped]) {
    const layer = parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [raw] }).layers[0];
    const builder = layerOutlineBounds(layer), verifier = restatedOutline(raw, "test");
    expect({ u0: verifier.u0, v0: verifier.v0, u1: verifier.u1, v1: verifier.v1 }, raw.id).toEqual(builder);
    // Every texel the layer covers lies inside its outline bounds.
    const size = 1024, coverage = raster(layer, size);
    let outside = 0, covered = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (coverage[(y * size + x) * 4 + 3]) {
      covered++;
      const u = (x + .5) / size, v = (y + .5) / size;
      if (u < builder.u0 || u > builder.u1 || v < builder.v0 || v > builder.v1) outside++;
    }
    expect(covered, raw.id).toBeGreaterThan(100);
    expect(outside, raw.id).toBe(0);
  }
  // The curved lid's bulge above its knots (v < 0.23) gets flakes, and the verifier accepts them.
  const bulge = compiled([curved], [{ layer: "curved", mips: "nested", flakes: FLAKES }]);
  bulge.verify();
  const row = Math.floor((.225 - WINDOW.v0) / (WINDOW.v1 - WINDOW.v0) * DIMS.height);
  let flakesAbove = 0;
  for (let y = 0; y < row; y++) for (let x = 0; x < DIMS.width; x++) if (bulge.chains.flakes[0][y * DIMS.width + x] === 255) flakesAbove++;
  expect(flakesAbove).toBeGreaterThan(10);
});

test("PIPE-69: the region is clipped to the window before sizing, and an oversized catalogue is refused in plan and verifier", () => {
  // A layer reaching past the window: its catalogue is sized over the clipped rectangle only.
  const wide = patch("wide", [.1, .21, .49, .29]);
  const clipped = compiled([wide], [{ layer: "wide", mips: "nested", flakes: FLAKES }]);
  const layer = parseRecipe({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [wide] }).layers[0];
  const rect = clipRect(layerOutlineBounds(layer), WINDOW)!;
  expect(rect.u0).toBe(WINDOW.u0);
  expect(clipped.chains.stats[0].regions[0].catalogue).toBe(flakeCount(rect, WINDOW, FLAKES));
  expect(restatedCatalogue(rect, WINDOW, FLAKES).cx.length).toBe(flakeCount(rect, WINDOW, FLAKES));
  clipped.verify();
  // Finest flakes at the widest cover over a whole-lid layer: refused at planning (so Check and Build agree) with a plain reason.
  const huge = collection([patch("lid", [.2, .15, .8, .35])], { regions: [{ layer: "lid", mips: "nested", flakes: { ...FLAKES, sizeMm: .05, sizeSigma: 0, cover: .6 } }] });
  expect(() => preflightPackageCollection(huge)).toThrow(new RegExp(`more than the ${MAX_REGION_FLAKES.toLocaleString("en-US")} one region may hold`));
  // The verifier's restated rules refuse the same knob.
  const planned = preparePackageCollection(collection([patch("lid", LEFT)], { regions: [{ layer: "lid", mips: "nested", flakes: FLAKES }] })).plan.presets[0];
  const oversized = { ...planned, recipe: { ...planned.recipe, layers: [patch("lid", [.2, .15, .8, .35])] },
    diagnostics: { glitter: { ...planned.diagnostics!.glitter!, regions: [{ layer: "lid", mips: "nested", flakes: { ...FLAKES, sizeMm: .05, sizeSigma: 0, cover: .6 } }] } } };
  expect(() => glitterOf(oversized as never)).toThrow(/more than 200000/);
});

test("PIPE-71: Check refuses a symmetric region layer, as Build would", () => {
  const mirrored = collection([patch("left", LEFT, { symmetry: true })], { regions: [{ layer: "left", mips: "nested", flakes: FLAKES }] });
  expect(() => preflightPackageCollection(mirrored)).toThrow(/mirrored by symmetry; give each lid its own layer/);
  expect(() => preparePackageCollection(mirrored)).toThrow(/mirrored by symmetry/);
});

test("PIPE-73: the verifier restates the knob's tilt and layout rules", () => {
  const preset = NESTED.preset;
  const knob = (flakes: Record<string, unknown>) => ({ ...preset, diagnostics: { glitter: { ...preset.diagnostics!.glitter!, regions: [{ layer: "left", mips: "nested", flakes }] } } });
  expect(glitterOf(knob(FLAKES) as never)).toBeDefined();
  expect(() => glitterOf(knob({ ...FLAKES, tiltSigmaDeg: 40, tiltMaxDeg: 9 }) as never)).toThrow(/tilt maximum too small for its spread/);
  expect(() => glitterOf({ ...preset, diagnostics: { ...preset.diagnostics, uvSpace: "head" } } as never)).toThrow(/surface override or head UV/);
  expect(() => glitterOf({ ...preset, diagnostics: { ...preset.diagnostics, surface: { RoughnessBias: .1 } } } as never)).toThrow(/surface override or head UV/);
});
