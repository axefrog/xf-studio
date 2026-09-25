import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { decodeSrgbByte } from "../src/decal-underlay";
import { gbufferColour, type Rgb } from "../src/face-decal-material";
import { flatSurface } from "../src/finish-export";
import { installFresnelTint } from "../src/fresnel-tint";
import { createMakeupStack, type PlateUnderlay } from "../src/makeup-stack";
import { accumulatePrefix, belowTargetSize, EMPTY_PREFIX, installPlateBlend, patchPlateBlendShader, plateBlendWindow, plateForward,
  type PlatePrefix, type PlateSkin, type PlateTexel } from "../src/plate-blend";
import { mergeFlatSample, type MergedSample } from "../src/preset-compiler";
import { initialRecipe, type Layer } from "../src/recipe";

const hex = (value: string): Rgb => [1, 3, 5].map(i => decodeSrgbByte(parseInt(value.slice(i, i + 2), 16))) as Rgb;
const texel = (colour: string, coverage: number, finish: "matte" | "regular" | "metallic" | "glossy" = "matte"): PlateTexel =>
  ({ colour: hex(colour), coverage, ...flatSurface(finish)! });

/** The preview's framebuffer: skin, then each layer's solved forward "over" in linear light, as the plates draw. */
function preview(skin: PlateSkin, layers: PlateTexel[]) {
  let colour: Rgb = [...skin.colour] as Rgb, below: PlatePrefix = { ...EMPTY_PREFIX, sqrtColour: [0, 0, 0] };
  for (const layer of layers) {
    const drawn = plateForward(skin, below, layer);
    colour = colour.map((c, k) => drawn.alpha * drawn.colour[k]! + (1 - drawn.alpha) * c) as Rgb;
    below = accumulatePrefix(below, layer);
  }
  return { colour, below };
}
/** The export: the preset compiler's merge of the layers, then one `mesh_decal` blend over the skin in square-root space. */
function exported(skin: PlateSkin, layers: PlateTexel[]) {
  let merged: MergedSample = { color: [0, 0, 0], roughness: 0, metalness: 0, coverage: 0 };
  for (const layer of layers) merged = mergeFlatSample(merged, { color: [...layer.colour] as Rgb, roughness: layer.roughness, metalness: layer.metalness }, layer.coverage);
  return { colour: gbufferColour(merged.color, merged.coverage, skin.colour), roughness: merged.coverage * merged.roughness + (1 - merged.coverage) * skin.roughness,
    metalness: merged.coverage * merged.metalness + (1 - merged.coverage) * skin.metalness };
}
const SKIN: PlateSkin = { colour: hex("#d6aa96"), roughness: 0.6, metalness: 0 };

describe("the plate blend's arithmetic", () => {
  test("Board 5: black Matte at 25/50/75 % leaves (1 − a)² of the skin, not 1 − a", () => {
    // The raster's coverage bytes for the three opacities (experiment 016).
    for (const [byte, predicted] of [[64, 0.56], [128, 0.25], [191, 0.06]] as const) {
      const a = byte / 255, { colour } = preview(SKIN, [texel("#000000", a)]);
      colour.forEach((c, k) => expect(c / SKIN.colour[k]!).toBeCloseTo((1 - a) ** 2, 9));
      expect(Math.abs(colour[1]! / SKIN.colour[1]! - predicted)).toBeLessThan(0.01);
    }
  });

  test("stacked layers land on the export's merged decal over the skin, whatever overlaps", () => {
    const stacks: PlateTexel[][] = [
      [texel("#6d4a7e", 0.6), texel("#e8c872", 0.5, "regular")],
      [texel("#905774", 0.85), texel("#201b29", 0.4), texel("#d4ae86", 0.7, "regular"), texel("#328c94", 0.2, "metallic")],
      [texel("#ffffff", 0.3, "glossy"), texel("#000000", 0.9)],
      [texel("#ff0000", 1), texel("#00ff00", 0.5), texel("#0000ff", 0.25)],
    ];
    for (const layers of stacks) {
      const got = preview(SKIN, layers).colour, want = exported(SKIN, layers).colour;
      got.forEach((c, k) => expect(c).toBeCloseTo(want[k]!, 9));
    }
  });

  test("the layers-below prefix is the export's premultiplied accumulation, surface included", () => {
    const layers = [texel("#6d4a7e", 0.6), texel("#e8c872", 0.5, "regular"), texel("#328c94", 0.3, "metallic")];
    const { below } = preview(SKIN, layers), want = exported(SKIN, layers);
    expect(below.roughness + (1 - below.coverage) * SKIN.roughness).toBeCloseTo(want.roughness, 9);
    expect(below.metalness + (1 - below.coverage) * SKIN.metalness).toBeCloseTo(want.metalness, 9);
  });

  test("a layer writes its own surface at its coverage and keeps what is below for the rest of the drawn alpha", () => {
    const below = accumulatePrefix(EMPTY_PREFIX, texel("#6d4a7e", 1, "regular"));
    const drawn = plateForward(SKIN, below, texel("#000000", 0.5));
    expect(drawn.alpha).toBeCloseTo(0.75, 9);
    // Matte (0.88) for two thirds of the drawn alpha, Satin (0.38) from the layer below for the rest.
    expect(drawn.roughness).toBeCloseTo(0.38 + (0.88 - 0.38) * 0.5 / 0.75, 9);
  });

  test("the plate's UV window and the targets' texel counts", () => {
    expect(plateBlendWindow(undefined)).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
    const window = plateBlendWindow([0.3, 0.2, 0.75, 0.35, 0.5, 0.3], 0.01);
    for (const [key, value] of Object.entries({ u0: 0.29, v0: 0.19, u1: 0.76, v1: 0.36 })) expect(window[key as keyof typeof window]).toBeCloseTo(value, 9);
    expect(belowTargetSize(1024, window, 4096)).toEqual({ width: 482, height: 175 });
    expect(belowTargetSize(4096, { u0: 0, v0: 0, u1: 1, v1: 1 }, 2048)).toEqual({ width: 2048, height: 2048 });
  });
});

describe("the plate material", () => {
  const physical = () => ({ vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} });

  test("the solve sits just before the lighting, behind a define, and after a Colour-shifting tint", () => {
    const material = new THREE.MeshPhysicalMaterial();
    const blend = installPlateBlend(material);
    installFresnelTint(material);
    const shader = physical();
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    const f = shader.fragmentShader, solve = f.indexOf("xfsDrawn"), tint = f.indexOf("xfsShiftColor *"), light = f.indexOf("#include <lights_physical_fragment>");
    expect(tint).toBeGreaterThan(f.indexOf("#include <normal_fragment_maps>"));
    expect(tint).toBeLessThan(solve);
    expect(solve).toBeLessThan(light);
    expect(f.slice(0, solve)).toContain("#ifdef XFS_PLATE_SQRT");
    expect(shader.vertexShader).toContain("vXfsPlateUnder = xfsUnderlay;");
    expect(material.customProgramCacheKey()).toContain("xfs-plate-blend-1");
    // The define is the switch: set once, recompiled only on a change.
    const version = material.version;
    blend.setSquareRoot(true); blend.setSquareRoot(true);
    expect(material.defines?.XFS_PLATE_SQRT).toBe("");
    expect(material.version).toBe(version + 1);
    blend.setSquareRoot(false);
    expect(material.defines?.XFS_PLATE_SQRT).toBeUndefined();
  });

  test("a changed Three.js chunk is refused, not silently skipped", () => {
    const shader = physical();
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_fragment>", "");
    expect(() => patchPlateBlendShader(shader)).toThrow(/lights_physical_fragment/);
  });
});

/** A renderer stand-in that records the "below" passes (the stack only needs these calls). */
function fakeRenderer() {
  const calls: string[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    capabilities: { maxTextureSize: 4096 }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; calls.push("target"); },
    getClearColor: (out: THREE.Color) => out.set(0x14181c), getClearAlpha: () => 1, setClearColor: () => {},
    clear: () => calls.push("clear"), render: () => calls.push("render"),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls };
}
function plateAnchor() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0.25, 0.5, 0.75, 0.5, 0.25, 0.625], 2));
  const anchor = new THREE.SkinnedMesh(geometry), root = new THREE.Group();
  root.add(anchor);
  return anchor;
}
const underlay = (): PlateUnderlay => ({ colour: new THREE.BufferAttribute(new Float32Array(9).fill(0.4), 3),
  roughness: new THREE.BufferAttribute(new Float32Array(3).fill(0.6), 1), metalness: new THREE.BufferAttribute(new Float32Array(3), 1) });

describe("the makeup stack's blend", () => {
  test("exportable layers blend in square-root space over the layers below; Glitter keeps its linear blend and stays out", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1);
    stack.setCanvases([0, 1, 2, 3].map(() => ({ width: 64, height: 64 }) as HTMLCanvasElement));
    const recipe = initialRecipe(), base = recipe.layers[0]!;
    const layers: Layer[] = [{ ...base }, { ...base, finish: "regular" }, { ...base, finish: "glitter" }, { ...base, finish: "metallic" }];
    let reads = 0;
    stack.setUnderlaySource(() => { reads++; return underlay(); });
    const { renderer, calls } = fakeRenderer();
    // Nothing is read before a frame needs it.
    expect(reads).toBe(0);
    layers.forEach((layer, i) => stack.updateLayer(i, layer, i === 2 ? { size: 64, normal: new Uint8Array(64 * 64 * 4), surface: new Uint8Array(64 * 64 * 4) } : undefined));
    stack.prepareBlend(renderer);
    expect(reads).toBe(1);
    expect(anchor.geometry.getAttribute("xfsUnderlay")).toBeDefined();
    const evidence = stack.blendDiagnostics();
    expect(evidence.layers.map(layer => layer.squareRoot)).toEqual([true, true, false, true]);
    // Layer 1 sees layer 0; Glitter is skipped; layer 3 sees layers 0 and 1 (two passes, each into its own target). The window is
    // the plate UVs (0.25–0.75 × 0.5–0.625) padded by 0.002: 33 × 9 of the 64-texel masks.
    expect(evidence.layers.map(layer => layer.below)).toEqual([null, { width: 33, height: 9 }, null, { width: 33, height: 9 }]);
    expect(calls.filter(call => call === "render")).toHaveLength(2);
    expect(evidence.belowBytes).toBeGreaterThan(0);
    // Idle: nothing changed, nothing runs.
    stack.prepareBlend(renderer);
    expect(calls.filter(call => call === "render")).toHaveLength(2);
    expect(reads).toBe(1);
    // A layer's mask changed: the targets are redrawn, the skin is not read again.
    stack.setLayerCanvas(0, { width: 64, height: 64 } as HTMLCanvasElement);
    stack.prepareBlend(renderer);
    expect(calls.filter(call => call === "render")).toHaveLength(4);
    expect(reads).toBe(1);
    // A new skin is read once, on the next frame.
    stack.setUnderlaySource(() => { reads++; return underlay(); });
    stack.prepareBlend(renderer);
    expect(reads).toBe(2);
    stack.setCanvases([]);
  });

  test("without the skin under the plate every layer keeps the linear blend", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1);
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement]);
    stack.setUnderlaySource(() => { throw Error("not over the head"); });
    stack.updateLayer(0, initialRecipe().layers[0]!);
    stack.prepareBlend(fakeRenderer().renderer);
    expect(stack.blendDiagnostics().layers[0]!.squareRoot).toBe(false);
    expect(anchor.geometry.getAttribute("xfsUnderlay")).toBeUndefined();
    stack.setCanvases([]);
  });
});
