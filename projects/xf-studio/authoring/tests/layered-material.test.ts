import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { accumulateLayer, bakeOrder, BAKE_SIZE, bakeSurface, colourMaskLevels, createLayeredMaterial, EMPTY_ACCUMULATOR, globalNormal, layerBakeParameters,
  layeredBakeSize, layeredContextRestored, layeredGlobals, layerMapUv, levels, microblendContrastFactor, reorientedNormal, resolveSurface, stackProblems, uvDomain,
  type LayerAccumulator, type LayerBakeParameters, type LayerSamples } from "../src/layered-material";
import { MAX_SETUP_LAYERS, MAX_TABLE_ENTRIES, readSetup, readTemplate } from "../src/layered-setup";
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

describe("bake size, sharing and failure (PREV-63, PREV-65, PREV-66)", () => {
  test("the bake is sized by the part's own surface: a stud gets the smallest bake, an eyeball about 1024, whatever its mask", () => {
    const stack: RenderLayered = { setup: { depotPath: "s", archive: null, sha256: null }, mask: null, ratio: 1, useNormal: true,
      layers: [layer(), layer({ textures: { mask: texture(2048) } })] };
    const unit = { min: [0, 0] as [number, number], max: [1, 1] as [number, number] };
    // A 4 mm stud whose UVs fill half the unit square: 20 texels a millimetre over its surface is well under the smallest bake.
    expect(layeredBakeSize(stack, unit, { worldArea: 16e-6, uvArea: 0.5 })).toBe(BAKE_SIZE.min);
    // An eyeball (radius 12 mm, about 1.8 cm² in view) whose UVs fill three quarters of its domain.
    expect(layeredBakeSize(stack, unit, { worldArea: 1.8e-3, uvArea: 0.75 })).toBe(1024);
    // The largest bake still caps a large part.
    expect(layeredBakeSize(stack, unit, { worldArea: 0.05, uvArea: 0.5 })).toBe(BAKE_SIZE.max);
    // The surface is measured from the triangles, with the mesh's own scale.
    const geometry = new THREE.PlaneGeometry(0.01, 0.01);
    const mesh = new THREE.Mesh(geometry);
    mesh.scale.setScalar(2);
    const surface = bakeSurface(mesh)!;
    expect(surface.worldArea).toBeCloseTo(4e-4, 9);
    expect(surface.uvArea).toBeCloseTo(1, 9);
    expect(bakeSurface(new THREE.Mesh(new THREE.BufferGeometry()))).toBeNull();
  });

  /** A renderer stand-in: enough of the WebGL renderer for the bake, with the program diagnostics, framebuffer status and error it reports. */
  function fakeRenderer(options: { runnable?: boolean; framebuffer?: number; error?: number; halfFloat?: boolean } = {}) {
    const materials: THREE.Material[] = [];
    let error = options.error ?? 0;
    const gl = { NO_ERROR: 0, FRAMEBUFFER: 0x8d40, FRAMEBUFFER_COMPLETE: 0x8cd5,
      getError: () => { const e = error; error = 0; return e; }, checkFramebufferStatus: () => options.framebuffer ?? 0x8cd5 };
    let target: THREE.WebGLRenderTarget | null = null;
    const renderer = {
      capabilities: { isWebGL2: true }, extensions: { has: (name: string) => options.halfFloat !== false || name === "OES_texture_float_linear" },
      getContext: () => gl, getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
      autoClear: true, getClearColor: (colour: THREE.Color) => colour, getClearAlpha: () => 1, setClearColor: () => {},
      render: (scene: THREE.Scene) => { scene.traverse(object => { if (object instanceof THREE.Mesh) materials.push(object.material as THREE.Material); });
        if (options.error) error = options.error; },
      properties: { get: () => ({ currentProgram: { diagnostics: { runnable: options.runnable ?? true, programLog: "ERROR: 0:12: 'xfsTiled' : no matching function" } } }) },
    };
    return { renderer: renderer as unknown as THREE.WebGLRenderer, materials };
  }
  const input = (size = 8) => ({ layers: [{ parameters: params(0), textures: {} }], domain: { min: [0, 0] as [number, number], max: [1, 1] as [number, number] },
    size, globals: { ratio: 1, normalIntensity: 1, normalUvScale: [1, 1] as [number, number], normalUvBias: [0, 0] as [number, number] } });

  test("a bake that fails on the GPU is reported as failed with its reason, never as baked with black maps (PREV-65)", () => {
    for (const [options, reason] of [[{ runnable: false }, /failed to build/], [{ framebuffer: 0x8cd6 }, /incomplete \(0x8cd6\)/],
      [{ error: 0x502 }, /WebGL error 0x502/], [{ halfFloat: false }, /half-float render targets are unavailable/]] as const) {
      const made = createLayeredMaterial(input());
      expect(made.handle.bake(fakeRenderer(options).renderer)).toBe(false);
      expect(made.handle.state).toBe("failed");
      expect(made.handle.evidence().error).toMatch(reason);
      expect(made.material.visible).toBe(false);
    }
    const good = createLayeredMaterial(input());
    expect(good.handle.bake(fakeRenderer().renderer)).toBe(true);
    expect(good.material.visible).toBe(true);
    // Colour with roughness in alpha, the normal with metalness in alpha: two packed 8-bit maps.
    expect(good.material.roughnessMap).toBe(good.material.map);
    expect(good.material.metalnessMap).toBe(good.material.normalMap);
    expect(good.handle.target!.textures.map(texture => [texture.type, texture.colorSpace])).toEqual([[THREE.UnsignedByteType, THREE.SRGBColorSpace],
      [THREE.UnsignedByteType, THREE.NoColorSpace]]);
    expect(good.handle.evidence()).toMatchObject({ state: "baked", bytes: Math.round(8 * 8 * 8 * 4 / 3), shared: false });
  });

  test("the bake programs are made once per renderer; identical stacks share one bake; the maps go with the last user (PREV-66, PREV-63)", () => {
    const { renderer, materials } = fakeRenderer();
    const a = createLayeredMaterial(input()), b = createLayeredMaterial(input()), c = createLayeredMaterial(input(16));
    a.handle.bake(renderer);
    const passes = new Set(materials);
    b.handle.bake(renderer); c.handle.bake(renderer);
    // Every bake drew with the same three programs (clear, layer pass, resolve).
    expect(new Set(materials).size).toBe(passes.size);
    expect(passes.size).toBe(3);
    // The identical stack shares the first bake's maps; another size bakes its own.
    expect(b.handle.target).toBe(a.handle.target);
    expect(b.handle.evidence()).toMatchObject({ shared: true, bytes: 0 });
    expect(c.handle.target).not.toBe(a.handle.target);
    let disposed = 0;
    a.handle.target!.addEventListener("dispose", () => disposed++);
    a.material.dispose();
    expect(disposed).toBe(0);
    b.material.dispose();
    expect(disposed).toBe(1);
  });

  test("a restored context bakes the part again: the handle hides it and goes back to pending (PREV-62)", () => {
    const { renderer } = fakeRenderer();
    const made = createLayeredMaterial(input());
    made.handle.bake(renderer);
    const before = made.handle.target;
    layeredContextRestored(renderer);
    made.handle.contextRestored();
    expect(made.handle.state).toBe("pending");
    expect(made.material.visible).toBe(false);
    expect(made.handle.target).toBeNull();
    expect(made.handle.bake(renderer)).toBe(true);
    expect(made.handle.target).not.toBe(before);
    expect(made.material.visible).toBe(true);
    // A failed bake stays failed.
    const failed = createLayeredMaterial(input());
    failed.handle.bake(fakeRenderer({ runnable: false }).renderer);
    failed.handle.contextRestored();
    expect(failed.handle.state).toBe("failed");
  });
});

describe("what the host could read (PREV-67) and hostile numbers (PIPE-43)", () => {
  const stack = (layers: RenderLayer[], mask: RenderLayered["mask"]): RenderLayered => ({ setup: { depotPath: "s", archive: null, sha256: null }, mask,
    ratio: 1, useNormal: true, layers });
  const maskRef = (layers: number) => ({ depotPath: "m", archive: "a", sha256: null, layers });
  test("the mask limit is only for a mask the host could not read, not for a mask with fewer layers than the setup", () => {
    const masked = layer({ textures: { mask: texture() } });
    // Three setup layers, a two-layer mask: layer 2 has no mask image and simply covers nothing, as in game.
    expect(stackProblems(stack([layer(), masked, layer()], maskRef(2)))).toEqual({ mask: false, templates: 0 });
    // The mask could not be read at all, or a layer inside its count lacks its image.
    expect(stackProblems(stack([layer(), layer()], maskRef(0)))).toEqual({ mask: true, templates: 0 });
    expect(stackProblems(stack([layer(), layer(), masked], maskRef(3)))).toEqual({ mask: true, templates: 0 });
    // The setup names no mask: nothing unread.
    expect(stackProblems(stack([layer(), layer()], null))).toEqual({ mask: false, templates: 0 });
  });

  test("a layer whose template could not be read is left out of the bake, and counted", () => {
    const unreadable = layer({ templateUnreadable: true, textures: { mask: texture() } });
    const layered = stack([layer(), unreadable, layer({ textures: { mask: texture() } })], maskRef(3));
    expect(bakeOrder(layered).map(entry => entry.index)).toEqual([2, 0]);
    expect(stackProblems(layered).templates).toBe(1);
    // An unreadable bottom layer is left out too: nothing under the masked layers.
    expect(bakeOrder(stack([layer({ templateUnreadable: true }), layer({ textures: { mask: texture() } })], maskRef(2))).map(entry => entry.index)).toEqual([1]);
  });

  test("the bake clamps every stored number to a plausible range: a tile of 1e38 can't make a coordinate NaN", () => {
    const p = layerBakeParameters(layer({ matTile: 1e38, tilingMultiplier: 1e38, offsetU: -1e30, opacity: 7, microblendContrast: Number.NaN,
      colorScale: [1e9, -3, Number.POSITIVE_INFINITY], normalStrength: -1e9, roughLevelsIn: [1e20, -1e20] }), 1);
    expect(p).toMatchObject({ tile: 256, offset: [-256, 0], opacity: 1, mbContrast: 1, colour: [16, 0, 1], normalStrength: -16, roughIn: [64, -64] });
    for (const value of [p.tile, ...p.offset, ...p.colour, ...layerMapUv([0.3, 0.7], p.tile, p.offset)]) expect(Number.isFinite(value)).toBe(true);
  });

  test("hostile setups and templates are read within bounds: numbers clamped, layers and override tables capped", () => {
    const setup = readSetup({ $type: "Multilayer_Setup", ratio: 1e38, useNormal: 1, layers: Array.from({ length: 50 }, () => ({
      material: { DepotPath: { $value: "base\\t.mltemplate" } }, opacity: 1e9, matTile: 1e38, mbTile: -1e38, offsetU: Number.NaN, microblendContrast: -5 })) })!;
    expect(setup.layers).toHaveLength(MAX_SETUP_LAYERS);
    expect(setup.ratio).toBe(64);
    expect(setup.layers[0]).toMatchObject({ opacity: 1, matTile: 256, mbTile: -256, offsetU: 0, microblendContrast: 0 });
    const entry = (n: string, v: number | { Elements: number[] }) => ({ n: { $value: n }, v });
    const template = readTemplate({ $type: "Multilayer_LayerTemplate", tilingMultiplier: 1e38, colorMaskLevelsIn: { Elements: [1e9, 0] },
      overrides: { colorScale: [...Array.from({ length: 5000 }, (_, i) => entry(`c${i}`, { Elements: [1e9, 0.5, -1] })), entry("late", { Elements: [1, 1, 1] })],
        normalStrength: [entry("n", 1e9)], roughLevelsOut: [entry("r", { Elements: [1e9, -1e9] })] } })!;
    expect(template.tilingMultiplier).toBe(256);
    expect(template.colorMaskLevelsIn).toEqual([64, 0]);
    expect(template.colorScale.size).toBe(MAX_TABLE_ENTRIES);
    expect(template.colorScale.has("late")).toBe(false);
    // A vanilla-sized table (a paint template holds 906 colours) is read whole.
    expect(template.colorScale.has("c905")).toBe(true);
    expect(template.colorScale.get("c0")).toEqual([16, 0.5, 0]);
    expect(template.normalStrength.get("n")).toBe(16);
    expect(template.levels.roughLevelsOut.get("r")).toEqual([64, -64]);
    expect(readSetup({ $type: "Other" })).toBeNull();
    expect(readTemplate(null)).toBeNull();
  });
});
