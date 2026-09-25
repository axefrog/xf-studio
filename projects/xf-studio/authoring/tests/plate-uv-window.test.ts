import { expect, test } from "bun:test";
import { bakeFlakes, shimmerFacetSampler } from "../src/finish";
import { HEAD_TEXTURE_SIZE, ROUTE_UV_WINDOW, WINDOW_TEXTURE } from "../src/finish-export";
import { flatMipChain, mipDimensions } from "../src/flat-mip-chain";
import { REFERENCE_GRID, referenceCrop } from "../src/package-bake";
import { halfToNumber, HEAD_UV_WINDOW, PLATE_UV_MARGIN, plateUvBounds, plateUvWindow, uvTransformConstants } from "../src/plate-uv-window";
import { texelUv } from "./window-fixture";
import { compilePreset, presetCoverage } from "../src/preset-compiler";
import { planCollection } from "../src/preset-collection";
import { initialRecipe, raster, rasterWindow, type Layer } from "../src/recipe";
import { facetedMipChain, maskMipChain } from "../src/route-mip-chains";
import { VERIFIER_HEAD_TEXTURE, VERIFIER_ROUTE_WINDOW, VERIFIER_WINDOW_TEXTURE } from "../src/mod-verifier/resource-checks";
import { facetedReference, maskReference } from "../src/mod-verifier/texture-checks";
import { expectedUvConstants, expectedWindow, storedBc4Level0, VERIFIER_UV_MARGIN } from "../src/mod-verifier/uv-window";
import { VERIFIER_REFERENCE_GRID } from "../src/mod-verifier/verify-build";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";

/** The built-in plate's stored UV0 bounds (game 2.31), as the builder and the verifier decode them. */
const BUILT_IN = { uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 };

test("the plate window: margins, constants and the shader mapping put authored rows in natural order", () => {
  const window = plateUvWindow(BUILT_IN), uv = uvTransformConstants(window);
  expect(window.u0).toBeCloseTo(0.26588095, 7); expect(window.u1).toBeCloseTo(0.73387491, 7);
  expect(window.v0).toBeCloseTo(0.17637191, 7); expect(window.v1).toBeCloseTo(0.32606949, 7);
  // Each axis keeps 62/64 of its texels on the plate.
  expect((BUILT_IN.uMax - BUILT_IN.uMin) / (window.u1 - window.u0)).toBeCloseTo(1 - 2 * PLATE_UV_MARGIN, 12);
  expect([uv.UVScaleX, uv.UVOffsetX, uv.UVScaleY, uv.UVOffsetY].map(x => Math.round(x * 1e6) / 1e6)).toEqual([2.13678, 0.000261, 6.680135, -1.661879]);
  const { width: W, height: H } = WINDOW_TEXTURE;
  for (const [x, y] of [[0, 0], [2047, 0], [0, 511], [1234, 321], [77, 400]]) {
    const [u, v] = texelUv(window, W, H, x, y), V = 1 - v;                                  // authored → stored V
    const tu = uv.UVScaleX * (u - .5) + .5 + uv.UVOffsetX, tv = uv.UVScaleY * (V - .5) + .5 + uv.UVOffsetY;
    // The game reads stored texel (tu·W − ½, tv·H − ½); WolvenKit stored image row y at row H − 1 − y.
    expect(tu * W - .5).toBeCloseTo(x, 6);
    expect(tv * H - .5).toBeCloseTo(H - 1 - y, 6);
  }
  // The head atlas is the identity window, and a plate reaching the atlas edge clamps to it.
  expect(uvTransformConstants(HEAD_UV_WINDOW)).toEqual({ UVScaleX: 1, UVOffsetX: -0, UVScaleY: 1, UVOffsetY: 0 });
  expect(plateUvWindow({ uMin: -2, uMax: 3, vMin: 0, vMax: 1 })).toEqual({ u0: 0, u1: 1, v0: 0, v1: 1 });
});

test("the verifier's restated window rule, grids and constants agree with the builder's", () => {
  expect(VERIFIER_UV_MARGIN).toBe(PLATE_UV_MARGIN);
  expect(VERIFIER_WINDOW_TEXTURE).toEqual({ ...WINDOW_TEXTURE });
  expect(VERIFIER_HEAD_TEXTURE).toBe(HEAD_TEXTURE_SIZE);
  expect(VERIFIER_ROUTE_WINDOW).toEqual(ROUTE_UV_WINDOW);
  expect(REFERENCE_GRID).toBeGreaterThanOrEqual(VERIFIER_REFERENCE_GRID);
  const builder = plateUvWindow(BUILT_IN), verifier = expectedWindow(BUILT_IN);
  for (const key of ["u0", "u1", "v0", "v1"] as const) expect(verifier[key]).toBeCloseTo(builder[key], 14);
  const a = uvTransformConstants(builder), b = expectedUvConstants(verifier);
  for (const key of Object.keys(a) as (keyof typeof a)[]) expect(b[key]).toBeCloseTo(a[key], 12);
  const crop = referenceCrop(builder);
  expect(crop.x0 / crop.grid).toBeLessThan(builder.u0); expect((crop.x0 + crop.width) / crop.grid).toBeGreaterThan(builder.u1);
});

test("plate UV bounds come from the stored half-float UV0 of every chunk", () => {
  expect([0x3c00, 0x3800, 0x3555, 0x0001, 0x8000].map(halfToNumber)).toEqual([1, .5, 0.333251953125, 2 ** -24, -0]);
  const plate = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "a\\b.mesh"), plateLikeUv);
  expect(plateUvBounds(plate.mesh.Data.RootChunk)).toEqual({ uMin: .300048828125, uMax: .7001953125, vMin: .7001953125, vMax: .7998046875 });
  expect(() => plateUvBounds({ renderResourceBlob: { Data: { header: { renderChunkInfos: [] } } } })).toThrow("no render chunks");
});

const layer = (extra: Partial<Layer> = {}): Layer => ({ ...initialRecipe().layers[0], opacity: 1, enabled: true, ...extra } as Layer);

test("rasterWindow is raster's evaluator on another grid: identical bytes on the head window, same shape in the plate window", () => {
  for (const extra of [{}, { symmetry: true }, { feather: .0005 }]) {
    const l = layer(extra as Partial<Layer>);
    expect(rasterWindow(l, 256, 256, HEAD_UV_WINDOW)).toEqual(raster(l, 256));
  }
  const l = layer(), window = plateUvWindow(BUILT_IN), fine = rasterWindow(l, 512, 128, window), head = raster(l, 2048);
  // Texel centres of the 512 × 128 window that coincide with 2048 head texel centres agree exactly... to rounding.
  let compared = 0, worst = 0;
  for (let y = 0; y < 128; y += 7) for (let x = 0; x < 512; x += 13) {
    const [u, v] = texelUv(window, 512, 128, x, y), hx = Math.round(u * 2048 - .5), hy = Math.round(v * 2048 - .5);
    if (Math.abs(hx - (u * 2048 - .5)) > .05 || Math.abs(hy - (v * 2048 - .5)) > .05) continue;
    worst = Math.max(worst, Math.abs(fine[(y * 512 + x) * 4 + 3] - head[(hy * 2048 + hx) * 4 + 3])); compared++;
  }
  expect(compared).toBeGreaterThan(0);
  expect(worst).toBeLessThanOrEqual(8);
  expect(() => rasterWindow(l, 0, 8, window)).toThrow("size");
});

test("the Shimmer facet sampler reproduces the head-UV bake and sharpens edges to the window's texels", () => {
  const flakes = { cells: 128, density: .65, tilt: .65, seed: 2077 }, size = 512;           // cell size exactly 2 texels
  const bake = bakeFlakes(size, "shimmer", flakes), sample = shimmerFacetSampler(flakes, size, size);
  for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 5) {
    const f = sample((x + .5) / size, (y + .5) / size), i = (y * size + x) * 4;
    expect([f.normalX, f.normalY, f.roughness, f.metalness]).toEqual([bake.normal[i], bake.normal[i + 1], bake.surface[i + 1], bake.surface[i + 2]]);
  }
  // At window density a facet's edge ramps over one window texel: more fully tilted texels, fewer partial ones.
  const window = plateUvWindow(BUILT_IN), dense = shimmerFacetSampler(flakes, 2048 / (window.u1 - window.u0), 512 / (window.v1 - window.v0));
  const coarse = shimmerFacetSampler(flakes, 1024, 1024);
  let denseEdge = 0, coarseEdge = 0;
  for (let k = 0; k < 4000; k++) {
    const u = .3 + .14 * (k % 80) / 80, v = .21 + .035 * Math.floor(k / 80) / 50;
    const m = (f: { metalness: number }) => f.metalness > 0 && f.metalness < Math.round(.35 * 255);
    if (m(dense(u, v))) denseEdge++;
    if (m(coarse(u, v))) coarseEdge++;
  }
  expect(denseEdge).toBeLessThan(coarseEdge / 2);
});

test("window compiles: each route's grid, head-UV Fresnel, and coverage that matches the head raster", () => {
  const window = plateUvWindow(BUILT_IN), space = { kind: "window" as const, ...WINDOW_TEXTURE, window };
  const flat = { schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer()] };
  const compiled = compilePreset(flat, space);
  expect(compiled).toMatchObject({ route: "flat", space: { kind: "window", width: 2048, height: 512 } });
  expect(compiled.dims.diffuse).toEqual({ width: 2048, height: 512 });
  expect((compiled.metadata as { limitations: string[] }).limitations.join(" ")).toContain("Plate-local UV window");
  const shift = { ...flat, layers: [layer({ finish: "iridescent", optics: { model: "game-matched-1", shift: { color: "#3fd4c2", strength: .5 } } } as Partial<Layer>)] };
  expect(compilePreset(shift, space, 64)).toMatchObject({ route: "fresnel", space: { kind: "head", size: 64 } });
  // The window's coverage agrees with a fine head-UV coverage reference at the same authored points.
  const crop = referenceCrop(window), reference = presetCoverage(flat, crop);
  let worst = 0;
  for (let y = 3; y < 512; y += 31) for (let x = 5; x < 2048; x += 97) {
    const [u, v] = texelUv(window, 2048, 512, x, y), a = compiled.maps.diffuse![(y * 2048 + x) * 4 + 3] / 255;
    const rx = Math.round(u * crop.grid - .5) - crop.x0, ry = Math.round(v * crop.grid - .5) - crop.y0;
    worst = Math.max(worst, Math.abs(a * a - reference[ry * crop.width + rx] / 255));
  }
  expect(worst).toBeLessThan(.2);
  expect(() => compilePreset(flat, { kind: "window", width: 2048, height: 500, window })).toThrow("powers of two");
});

test("non-square chains: faceted and mask chains halve to 1x1 and equal the verifier's references", () => {
  expect(mipDimensions(2048, 512).map(d => `${d.width}x${d.height}`)).toEqual(["2048x512", "1024x256", "512x128", "256x64", "128x32",
    "64x16", "32x8", "16x4", "8x2", "4x1", "2x1", "1x1"]);
  let s = 5;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
  for (const [w, h] of [[64, 16], [8, 32]]) {
    const n = w * h, diffuse = Uint8Array.from({ length: n * 4 }, next), roughness = Uint8Array.from({ length: n }, next);
    const metalness = Uint8Array.from({ length: n }, next), normal = Uint8Array.from({ length: n * 2 }, () => 128 + (next() >> 2) - 32);
    const chain = facetedMipChain(diffuse, roughness, metalness, normal, w, h), reference = facetedReference(diffuse, roughness, metalness, normal, w, h);
    expect(chain.roughness).toEqual(reference.roughness);
    expect(chain.normal).toEqual(reference.normalXY);
    expect(chain.diffuse).toEqual(flatMipChain(diffuse, roughness, metalness, w, h).diffuse);
    expect(maskMipChain(roughness, w, h)).toEqual(maskReference(roughness, w, h));
  }
});

test("planning: flat and faceted presets use the window unless a diagnostic keeps them on head UV; Fresnel is always head UV", () => {
  const id = (n: number) => `22222222-3333-4444-8555-00000000000${n}`;
  const recipe = (extra: Partial<Layer> = {}) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers: [layer(extra)] });
  const shimmer = { finish: "shimmer", optics: { model: "game-matched-1" } } as Partial<Layer>;
  const shift = { finish: "iridescent", optics: { model: "game-matched-1", shift: { color: "#3fd4c2", strength: .5 } } } as Partial<Layer>;
  const collection = (diagnostics?: unknown) => ({ schema: "xfas/collection-1", id: "22222222-3333-4444-8555-000000000000", name: "Spaces",
    presets: [recipe(), recipe(), recipe(shimmer), recipe(shift)].map((r, i) => ({ id: id(i + 1), name: `P${i}`, revision: 1, recipe: r })), diagnostics });
  const plan = planCollection(collection({ schema: "xfs/export-diagnostics-1", presets: { [id(2)]: { uvSpace: "head" }, [id(3)]: { uvSpace: "head" } } }));
  expect(plan.presets.map(p => [p.uvSpace, p.material.startsWith("@fresnel_") ? "@fresnel" : p.material])).toEqual([
    ["plate-window", "@preset"], ["head", "@preset_head"], ["head", "@faceted_head"], ["head", "@fresnel"]]);
  expect(() => planCollection(collection({ schema: "xfs/export-diagnostics-1", presets: { [id(4)]: { uvSpace: "head" } } }))).toThrow("always on head UV");
  expect(() => planCollection(collection({ schema: "xfs/export-diagnostics-1", presets: { [id(1)]: { uvSpace: "window" } } }))).toThrow('must be "head"');
});

test("the verifier's BC4 decoder reads stored level 0 in both palette modes", () => {
  // One 8 × 4 level: block 0 uses the eight-value palette (r0 > r1), block 1 the six-value palette with 0 and 255.
  const indices = (codes: number[]) => { let bits = 0n; codes.forEach((c, i) => { bits |= BigInt(c) << BigInt(3 * i); });
    return Array.from({ length: 6 }, (_, k) => Number((bits >> BigInt(8 * k)) & 0xffn)); };
  const codes = Array.from({ length: 16 }, (_, i) => i % 8);
  const data = Buffer.from([200, 60, ...indices(codes), 60, 200, ...indices(codes)]);
  const xbm = { width: 8, height: 4, renderTextureResource: { renderResourceBlobPC: { Data: { header: { mipMapInfo: [{ layout: { rowPitch: 16 },
    placement: { offset: 0, size: 16 } }] }, textureData: { Bytes: data.toString("base64") } } } } };
  const level = storedBc4Level0(xbm, "probe");
  const eight = [200, 60, ...[2, 3, 4, 5, 6, 7].map(k => Math.round(((8 - k) * 200 + (k - 1) * 60) / 7))];
  const six = [60, 200, ...[2, 3, 4, 5].map(k => Math.round(((6 - k) * 60 + (k - 1) * 200) / 5)), 0, 255];
  expect([...level.data.subarray(0, 4)]).toEqual(eight.slice(0, 4));
  expect([...level.data.subarray(4, 8)]).toEqual(six.slice(0, 4));
  expect([...level.data.subarray(8, 12)]).toEqual(eight.slice(4, 8));
  expect([...level.data.subarray(12, 16)]).toEqual(six.slice(4, 8));
  expect(() => storedBc4Level0({ ...xbm, width: 16 }, "probe")).toThrow("not a BC4 block layout");
});
