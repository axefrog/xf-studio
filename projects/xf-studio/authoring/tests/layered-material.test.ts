import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { accumulateLayer, bakeOrder, BAKE_SIZE, colourMaskLevels, EMPTY_ACCUMULATOR, globalNormal, layerBakeParameters, layeredBakeSize, layeredGlobals,
  layerMapUv, levels, microblendContrastFactor, reorientedNormal, resolveSurface, uvDomain, type LayerAccumulator, type LayerBakeParameters,
  type LayerSamples } from "../src/layered-material";
import type { RenderLayer, RenderLayered, RenderTexture } from "../src/render-detail";

// The layered bake's arithmetic against the decompiled 2.31 `multilayered` G-buffer program (knowledge/materials-and-shaders.md §4.6).
// Values are the vanilla earring templates' own (silver_brushed_01_300, as serialized by WolvenKit 9.0.1) where the test says so.

const texture = (size = 4): RenderTexture => ({ file: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), sources: [], depotPath: "base\\t.xbm",
  width: size, height: size, isGamma: false });
const layer = (overrides: Partial<RenderLayer> = {}): RenderLayer => ({ template: null, opacity: 1, matTile: 1, tilingMultiplier: 1, offsetU: 0, offsetV: 0,
  mbTile: 1, microblendContrast: 1, microblendNormalStrength: 0, microblendOffsetU: 0, microblendOffsetV: 0, colorScale: [1, 1, 1], normalStrength: 1,
  roughLevelsIn: [1, 0], roughLevelsOut: [1, 0], metalLevelsIn: [1, 0], metalLevelsOut: [1, 0], colorMaskLevelsIn: [1, 0], colorMaskLevelsOut: [0, 0],
  names: { colorScale: "null_null", normalStrength: "null", roughLevelsIn: "null", roughLevelsOut: "null", metalLevelsIn: "null", metalLevelsOut: "null" },
  textures: {}, ...overrides });
const params = (index: number, overrides: Partial<RenderLayer> = {}): LayerBakeParameters => layerBakeParameters(layer(overrides), index);
const samples = (overrides: Partial<LayerSamples> = {}): LayerSamples => ({ colour: [1, 1, 1], normal: [0, 0], roughness: 0.5, metalness: 0.5,
  microblend: [0.5, 0.5, 1, 1], mask: 1, ...overrides });
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, digits));

describe("levels and colour", () => {
  test("levels are a clamped scale/bias chain; (1, 0) is identity", () => {
    expect(levels(0.37, [1, 0], [1, 0])).toBeCloseTo(0.37, 9);
    // silver_brushed `roughLevelsIn "null"` (the 30…220 input range) and `roughLevelsOut "970fd0"`.
    const r = 0.5;
    expect(levels(r, [1.342, -0.1578], [0.2975, 0.2235])).toBeCloseTo((r * 1.342 - 0.1578) * 0.2975 + 0.2235, 6);
    expect(levels(0, [1.342, -0.1578], [0.2975, 0.2235])).toBeCloseTo(0.2235, 6);
    expect(levels(1, [1.342, -0.1578], [0.2975, 0.2235])).toBeCloseTo(0.2975 + 0.2235, 6);
    // An inverting out pair (`metalLevelsOut` (−1, 1)) and clamping of both stages.
    expect(levels(0.25, [1, 0], [-1, 1])).toBeCloseTo(0.75, 9);
    expect(levels(2, [1, 0], [1, 0])).toBe(1);
    expect(levels(-1, [1, 0], [1, 0])).toBe(0);
  });

  test("colour-mask levels: an Out pair of (0, 0) tints everywhere; any other pair is the program's chain", () => {
    expect(colourMaskLevels([1, 0], [0, 0])).toEqual({ in: [0, 1], out: [0, 1] });
    expect(levels(0.3, [0, 1], [0, 1])).toBe(1);
    expect(colourMaskLevels([2, -0.5], [1, 0])).toEqual({ in: [2, -0.5], out: [1, 0] });
    const tinted = accumulateLayer(EMPTY_ACCUMULATOR, params(0, { colorScale: [0.97, 0.96, 0.92] }), samples({ colour: [0.5, 0.5, 0.5] }), true);
    close(tinted.colour, [0.485, 0.48, 0.46]);
    // Where the colour mask is 0 the map shows untinted.
    const untinted = accumulateLayer(EMPTY_ACCUMULATOR, params(0, { colorScale: [0.2, 0.2, 0.2], colorMaskLevelsIn: [1, 0], colorMaskLevelsOut: [0, 0.0001] }),
      samples({ colour: [0.5, 0.5, 0.5], roughness: 0 }), true);
    close(untinted.colour, [0.5 * (1 + (0.2 - 1) * 0.0001), 0.5 * (1 + (0.2 - 1) * 0.0001), 0.5 * (1 + (0.2 - 1) * 0.0001)]);
  });
});

describe("front-to-back coverage", () => {
  test("two half-covering layers over the bottom layer take 0.5, 0.5 and 0 (not a lerp stack's 0.5, 0.25, 0.25)", () => {
    const red = params(2, { colorScale: [1, 0, 0], opacity: 0.5 }), green = params(1, { colorScale: [0, 1, 0], opacity: 0.5 }), blue = params(0, { colorScale: [0, 0, 1] });
    let acc: LayerAccumulator = EMPTY_ACCUMULATOR;
    acc = accumulateLayer(acc, red, samples(), false);
    acc = accumulateLayer(acc, green, samples(), false);
    acc = accumulateLayer(acc, blue, samples(), true);
    close(acc.colour, [0.5, 0.5, 0]);
    expect(acc.remaining).toBe(0);
    // Once nothing remains, the program skips the rest: the bottom layer adds nothing, not even to the edge sum.
    expect(acc.sumA).toBeCloseTo(1, 9);
  });

  test("the bottom layer ignores its mask; a masked layer with no mask there is skipped; leftover coverage stays black", () => {
    const top = params(1, { opacity: 1 }), bottom = params(0, { opacity: 0.6, colorScale: [1, 1, 1] });
    const skipped = accumulateLayer(EMPTY_ACCUMULATOR, top, samples({ mask: 0 }), false);
    expect(skipped).toEqual(EMPTY_ACCUMULATOR);
    const base = accumulateLayer(skipped, bottom, samples({ mask: 0, colour: [1, 1, 1], roughness: 1, metalness: 1 }), true);
    close(base.colour, [0.6, 0.6, 0.6]);
    expect(base.remaining).toBeCloseTo(0.4, 9);
    // Roughness and metalness accumulate by the same shares: the uncovered 0.4 contributes zero.
    expect(base.roughness).toBeCloseTo(0.6, 9);
    expect(base.metalness).toBeCloseTo(0.6, 9);
  });

  test("bake order: masked layers with data from the highest index down, then the bottom; opacity 0 and maskless layers add nothing", () => {
    const stack: RenderLayered = { setup: { depotPath: "s", archive: null, sha256: null }, mask: null, ratio: 1, useNormal: true, layers: [
      layer(), layer({ opacity: 0, textures: { mask: texture() } }), layer({ textures: { mask: texture() } }), layer({ textures: {} }),
      layer({ opacity: 0.07, textures: { mask: texture() } })] };
    expect(bakeOrder(stack).map(entry => entry.index)).toEqual([4, 2, 0]);
    expect(bakeOrder({ ...stack, layers: [layer({ opacity: 0 }), ...stack.layers.slice(1)] }).map(entry => entry.index)).toEqual([4, 2]);
  });
});

describe("microblend and normals", () => {
  test("contrast crossfades the mask with the microblend's 1 − alpha; contrast 1 keeps the mask, 0 keeps the microblend", () => {
    expect(microblendContrastFactor(0.69)).toBe(0.69);
    const at = (contrast: number, mask: number, alpha: number) =>
      accumulateLayer(EMPTY_ACCUMULATOR, params(1, { microblendContrast: contrast }), samples({ mask, microblend: [0.5, 0.5, 1, alpha] }), false).sumA;
    expect(at(1, 0.3, 0.2)).toBeCloseTo(0.3, 9);
    expect(at(0, 0.3, 0.2)).toBeCloseTo(0.8, 9);
    expect(at(0.5, 0.3, 0.2)).toBeCloseTo(0.55, 9);
    // An opaque microblend at contrast 0 hides the layer (the community guide's warning).
    expect(at(0, 0.9, 1)).toBe(0);
  });

  test("microblend normals blend in at the mask's edges, weighted by what the layers above already covered", () => {
    const mb = params(1, { microblendNormalStrength: 1 });
    const edge = accumulateLayer(EMPTY_ACCUMULATOR, mb, samples({ mask: 0.5, microblend: [1, 0.5, 1, 1] }), false);
    expect(edge.microMix).toBeCloseTo(1, 9);
    close(edge.microNormal, [1, 0]);
    const inside = accumulateLayer(EMPTY_ACCUMULATOR, mb, samples({ mask: 1, microblend: [1, 0.5, 1, 1] }), false);
    expect(inside.microMix).toBe(0);
    close(inside.microNormal, [0, 0]);
  });

  test("layer normals add by coverage; the result lies over the mesh-wide normal (reoriented normal mapping)", () => {
    const acc = accumulateLayer(EMPTY_ACCUMULATOR, params(0, { normalStrength: 0.5 }), samples({ normal: [0.4, -0.2] }), true);
    close(acc.normal, [0.2, -0.1]);
    const flat = resolveSurface(acc);
    const z = Math.sqrt(1 - 0.04 - 0.01);
    close(flat.normal, [0.2, -0.1, z]);
    // Over a flat base the detail is unchanged; over a tilted base it is carried along.
    close(reorientedNormal([0, 0, 1], [0.6, 0, 0.8]), [0.6, 0, 0.8]);
    const tilted = reorientedNormal([0.6, 0, 0.8], [0, 0, 1]);
    close(tilted, [0.6, 0, 0.8]);
    // Intensity 0 flattens the mesh-wide normal; 1 keeps it.
    close(globalNormal([0.6, 0], 0), [0, 0, 1]);
    close(globalNormal([0.6, 0], 1), [0.6, 0, 0.8]);
  });
});

describe("where maps are read", () => {
  test("the game's tile and offset in its own rows, on the exported (row-flipped) images at the glTF UV", () => {
    // Tile 1, no offset: the glTF UV itself (inside a tile).
    close(layerMapUv([0.3, 0.7], 1, [0, 0]), [0.3, 0.7]);
    // Tile 2: twice as fine, counted from the game's own V (1 − glTF V).
    close(layerMapUv([0.3, 0.7], 2, [0, 0]), [0.6, 1 - 2 * 0.3]);
    // Tile 0.5 and an offset: half the texture, from the game's rows.
    close(layerMapUv([0.3, 0.7], 0.5, [0.1, 0.2]), [0.1 + 0.15, 1 - (0.2 + 0.5 * 0.3)]);
    // The setup's ratio scales U only.
    close(layerMapUv([0.25, 0.5], 1, [0, 0], 2), [0.5, 0.5]);
  });

  test("record → parameters: tiles multiply the template's multiplier; the bake covers the mesh's own UV range", () => {
    const p = layerBakeParameters(layer({ matTile: 0.5, tilingMultiplier: 3, opacity: 0.07, colorMaskLevelsOut: [0, 0], textures: { mask: texture() } }), 2);
    expect(p).toMatchObject({ index: 2, tile: 1.5, opacity: 0.07, colourMaskIn: [0, 1], colourMaskOut: [0, 1], maps: { mask: true, color: false } });
    const uv = new THREE.BufferAttribute(new Float32Array([0.1, 0.2, 0.9, 0.6, -1.6, 0.99]), 2);
    const domain = uvDomain(uv);
    expect(domain.min[0]).toBeLessThan(-1.6);
    expect(domain.max[1]).toBeGreaterThan(0.99);
    expect(uvDomain(undefined)).toEqual({ min: [0, 0], max: [1, 1] });
    const stack: RenderLayered = { setup: { depotPath: "s", archive: null, sha256: null }, mask: null, ratio: 1, useNormal: true,
      layers: [layer(), layer({ textures: { mask: texture(512) } })] };
    expect(layeredBakeSize(stack, { min: [0, 0], max: [1, 1] })).toBe(BAKE_SIZE.usual);
    expect(layeredBakeSize(stack, { min: [-1.7, -0.6], max: [2, 1] })).toBe(BAKE_SIZE.max);
    // A small UV island still gets the smallest bake (denser than the mask over it).
    expect(layeredBakeSize(stack, { min: [0, 0], max: [0.05, 0.05] })).toBe(BAKE_SIZE.min);
    expect(layeredGlobals({ scalars: { GlobalNormalIntensity: 0.5 } }, stack)).toEqual({ ratio: 1, normalIntensity: 0.5, normalUvScale: [1, 1], normalUvBias: [0, 0] });
  });
});
