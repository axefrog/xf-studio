import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { decodeSrgbByte } from "../src/decal-underlay";
import { gbufferColour, type Rgb } from "../src/face-decal-material";
import { flatSurface, planPresetExport } from "../src/finish-export";
import { createMakeupStack, type PlateUnderlay } from "../src/makeup-stack";
import { accumulateComposite, compositeTargetSize, createPlateLightMaterial, EMPTY_COMPOSITE, MODE1_FULL_TILT, patchPlateLightShader, plateBlendWindow,
  plateDrawnAlpha, plateSurface, residualForward, unfadeFacet, type PlateComposite, type PlateSkin, type PlateSurface, type PlateTexel } from "../src/plate-blend";
import { mergeFlatSample, type MergedSample } from "../src/preset-compiler";
import { initialRecipe, type Layer } from "../src/recipe";
import { previewFacetChains } from "../src/route-mip-chains";
import { skinParameters } from "../src/skin-material";

const hex = (value: string): Rgb => [1, 3, 5].map(i => decodeSrgbByte(parseInt(value.slice(i, i + 2), 16))) as Rgb;
const texel = (colour: string, coverage: number, finish: "matte" | "regular" | "metallic" | "glossy" = "matte"): PlateTexel =>
  ({ colour: hex(colour), coverage, ...flatSurface(finish)! });
const composite = (layers: PlateTexel[]) => layers.reduce<PlateComposite>((below, layer) => accumulateComposite(below, layer),
  { ...EMPTY_COMPOSITE, sqrtColour: [0, 0, 0] });
/** The export: the preset compiler's merge of the layers, then one `mesh_decal` blend over the skin in square-root space. */
function exported(skin: PlateSkin, layers: PlateTexel[]): PlateSurface {
  let merged: MergedSample = { color: [0, 0, 0], roughness: 0, metalness: 0, coverage: 0 };
  for (const layer of layers) merged = mergeFlatSample(merged, { color: [...layer.colour] as Rgb, roughness: layer.roughness, metalness: layer.metalness }, layer.coverage);
  return { colour: gbufferColour(merged.color, merged.coverage, skin.colour), roughness: merged.coverage * merged.roughness + (1 - merged.coverage) * skin.roughness,
    metalness: merged.coverage * merged.metalness + (1 - merged.coverage) * skin.metalness };
}
/**
 * A stand-in for a deferred light that is deliberately not linear in roughness or metalness (a diffuse term that dims with
 * roughness and switches its wrap off above metalness 0.1, plus a lobe that sharpens as roughness falls).
 */
const light = (surface: PlateSurface): Rgb => surface.colour.map(c =>
  c * (1 - surface.metalness) * (1 - 0.3 * surface.roughness) * (surface.metalness > 0.1 ? 0.8 : 1) + 0.02 / (surface.roughness ** 2 + 0.05)) as Rgb;
/** The preview's framebuffer: the lit skin, then the plate's one residual "over". */
function preview(skin: PlateSkin, layers: PlateTexel[]) {
  const merged = composite(layers), surface = plateSurface(skin, merged);
  const under = light({ colour: [...skin.colour] as Rgb, roughness: skin.roughness, metalness: skin.metalness });
  const drawn = residualForward(light(surface), under, plateDrawnAlpha(skin, merged));
  return { surface, drawn, pixel: under.map((u, k) => drawn.alpha * drawn.colour[k]! + (1 - drawn.alpha) * u) as Rgb };
}
const SKIN: PlateSkin = { colour: hex("#d6aa96"), roughness: 0.6, metalness: 0 };
const STACKS: PlateTexel[][] = [
  [texel("#6d4a7e", 0.6), texel("#e8c872", 0.5, "regular")],
  [texel("#905774", 0.85), texel("#201b29", 0.4), texel("#d4ae86", 0.7, "regular"), texel("#328c94", 0.2, "metallic")],
  [texel("#ffffff", 0.3, "glossy"), texel("#000000", 0.9)],
  [texel("#ff0000", 1), texel("#00ff00", 0.5), texel("#0000ff", 0.25)],
];

describe("the plate's arithmetic", () => {
  test("Board 5: black Matte at 25/50/75 % leaves (1 − a)² of the skin, not 1 − a", () => {
    for (const [byte, predicted] of [[64, 0.56], [128, 0.25], [191, 0.06]] as const) {
      const a = byte / 255, { colour } = plateSurface(SKIN, composite([texel("#000000", a)]));
      colour.forEach((c, k) => expect(c / SKIN.colour[k]!).toBeCloseTo((1 - a) ** 2, 9));
      expect(Math.abs(colour[1]! / SKIN.colour[1]! - predicted)).toBeLessThan(0.01);
    }
  });

  test("the composite over the skin is the export's merged decal over the skin: colour, roughness and metalness", () => {
    for (const layers of STACKS) {
      const got = plateSurface(SKIN, composite(layers)), want = exported(SKIN, layers);
      got.colour.forEach((c, k) => expect(c).toBeCloseTo(want.colour[k]!, 9));
      expect(got.roughness).toBeCloseTo(want.roughness, 9);
      expect(got.metalness).toBeCloseTo(want.metalness, 9);
    }
  });

  test("the one plate shows the blended surface lit once, however the light bends with roughness and metalness", () => {
    for (const layers of STACKS) {
      const { surface, drawn, pixel } = preview(SKIN, layers), want = light(exported(SKIN, layers));
      pixel.forEach((p, k) => expect(p).toBeCloseTo(want[k]!, 9));
      expect(surface.roughness).toBeCloseTo(exported(SKIN, layers).roughness, 9);
      expect(drawn.colour.every(c => c >= 0)).toBe(true);
    }
  });

  test("lighting each layer on its own and mixing afterwards is not the same picture", () => {
    // Glossy over Matte at half coverage each: the G-buffer holds one roughness in between, lit once.
    const layers = [texel("#6d4a7e", 1), texel("#6d4a7e", 0.5, "glossy")];
    const once = light(exported(SKIN, layers));
    const separately = light({ colour: exported(SKIN, layers).colour, roughness: 0.88, metalness: 0 }).map((v, k) =>
      0.5 * v + 0.5 * light({ colour: exported(SKIN, layers).colour, roughness: 0.12, metalness: 0 })[k]!);
    expect(Math.abs(once[0]! - separately[0]!)).toBeGreaterThan(0.05);
  });

  test("the drawn alpha keeps the skin's texel detail where the square-root blend keeps it, and rises only to keep the colour positive", () => {
    // Black at 50 %: a quarter of the skin shows, so the plate draws at 75 % over the skin as drawn.
    expect(plateDrawnAlpha(SKIN, composite([texel("#000000", 0.5)]))).toBeCloseTo(0.75, 9);
    // A surface much darker in its light than the skin under it needs a higher alpha than the colour solve's.
    const raised = residualForward([0.1, 0.1, 0.1], [0.8, 0.8, 0.8], 0.5);
    expect(raised.alpha).toBeCloseTo(1 - 0.1 / 0.8, 9);
    expect(raised.colour[0]).toBeCloseTo(0, 9);
    expect(residualForward([0.4, 0.4, 0.4], [0.2, 0.2, 0.2], 0).alpha).toBe(0);
    // Unlit darkness under and over: nothing to raise.
    expect(residualForward([0, 0, 0], [0, 0, 0], 0.3).alpha).toBeCloseTo(0.3, 9);
  });

  test("Metallic crosses the engine's SSS switch (metalness 0.1) at about 15 % coverage over dielectric skin", () => {
    const metal = (a: number) => plateSurface(SKIN, composite([texel("#6d4a7e", a, "metallic")])).metalness;
    expect(metal(0.14)).toBeLessThan(0.1);
    expect(metal(0.16)).toBeGreaterThan(0.1);
  });

  test("the composite undoes the mode-1 fade the preview's facet maps carry, so the plate fades the merged normal once", () => {
    // One texel per facet, through the preview chain's own level-0 encoding.
    const facets = [[0.3, 0.1], [0.15, -0.05], [-0.12, 0.09], [0.07, 0.04], [0, 0], [0.25, 0]];
    const size = 4, normal = new Uint8Array(size * size * 4).fill(128), surface = new Uint8Array(size * size * 4).fill(255);
    const toByte = (v: number) => Math.floor(Math.min(1, Math.max(0, v * 0.5 + 0.5)) * 255 + 0.5);
    facets.forEach(([x, y], i) => { normal[i * 4] = toByte(x!); normal[i * 4 + 1] = toByte(y!); });
    const level0 = previewFacetChains(normal, surface, size).normal[0]!;
    facets.forEach(([x, y], i) => {
      const [ux, uy] = unfadeFacet(level0[i * 4]! / 255 * 2 - 1, level0[i * 4 + 1]! / 255 * 2 - 1);
      const tilt = Math.hypot(x!, y!), step = 2 / 255;
      // Whole facets come back to the byte; faded ones to within the byte step magnified by the fade's slope (below a tilt of 0.1 the
      // map keeps too few bits to say more, and the game fades such facets to a sixth or less).
      const tolerance = tilt >= MODE1_FULL_TILT ? step : tilt > 0.1 ? 2 * step : 0.05;
      expect(Math.abs(ux - x!)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(uy - y!)).toBeLessThanOrEqual(tolerance);
    });
    // The encoding's zero stays flat.
    expect(unfadeFacet(128 / 255 * 2 - 1, 127 / 255 * 2 - 1)).toEqual([0, 0]);
  });

  test("the plate's UV window and the composite's texel counts", () => {
    expect(plateBlendWindow(undefined)).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
    const window = plateBlendWindow([0.3, 0.2, 0.75, 0.35, 0.5, 0.3], 0.01);
    for (const [key, value] of Object.entries({ u0: 0.29, v0: 0.19, u1: 0.76, v1: 0.36 })) expect(window[key as keyof typeof window]).toBeCloseTo(value, 9);
    expect(compositeTargetSize(1024, window, 4096)).toEqual({ width: 482, height: 175 });
    expect(compositeTargetSize(4096, { u0: 0, v0: 0, u1: 1, v1: 1 }, 2048)).toEqual({ width: 2048, height: 2048 });
  });
});

describe("the plate material", () => {
  const standard = () => ({ vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} });
  const count = (text: string, part: string) => text.split(part).length - 1;

  test("the skin under the plate is lit in its own scope before the plate's light, and the residual sits just before the output", () => {
    for (const skinLight of [true, false]) {
      const f = patchPlateLightShader(standard(), { skinLight }).fragmentShader;
      expect(count(f, "#include <lights_physical_fragment>")).toBe(2);
      expect(count(f, "#include <lights_fragment_begin>")).toBe(2);
      const under = f.indexOf("vec3 normal = nonPerturbedNormal;"), main = f.lastIndexOf("#include <lights_physical_fragment>");
      expect(under).toBeGreaterThan(f.indexOf("#include <normal_fragment_begin>"));
      expect(under).toBeLessThan(main);
      expect(f.indexOf("xfsUnderLight = reflectedLight")).toBeLessThan(main);
      expect(f.indexOf("outgoingLight = max( ( outgoingLight")).toBeLessThan(f.indexOf("#include <opaque_fragment>"));
      // Both lights take the image-based light through the skin's lobes, or both through Three's own.
      expect(count(f, "xfsSkinIBL( geometryViewDir")).toBe(skinLight ? 2 : 0);
      expect(count(f, "#include <lights_fragment_maps>")).toBe(skinLight ? 0 : 2);
      expect(count(f, "#define RE_Direct RE_Direct_XfsSkin")).toBe(skinLight ? 1 : 0);
      // The Colour-shifting tint is compiled only for the Fresnel route and is added to the decal colour before the square root.
      expect(f.indexOf("xfsDecal += xfsShiftColor")).toBeLessThan(f.indexOf("vec3 xfsRoot"));
      expect(f.slice(0, f.indexOf("xfsDecal += xfsShiftColor"))).toContain("#ifdef XFS_PLATE_FRESNEL");
    }
  });

  test("the skin light and the Fresnel route recompile only on a change; the normals toggle is a uniform", () => {
    const { material, handle } = createPlateLightMaterial();
    const shader = { ...standard(), uniforms: {} as Record<string, THREE.IUniform> };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).not.toContain("RE_Direct_XfsSkin");
    const version = material.version, key = material.customProgramCacheKey();
    const skin = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
    handle.setSkinLight(skin); handle.setSkinLight(skin);
    expect(material.version).toBe(version + 1);
    expect(material.customProgramCacheKey()).not.toBe(key);
    expect((shader.uniforms.xfsLobes!.value as THREE.Vector3).toArray()).toEqual([skin.lobes.roughness0, skin.lobes.roughness1, skin.lobes.weight]);
    handle.setFresnel({ color: "#3fd4c2", strength: 0.5 }); handle.setFresnel({ color: "#3fd4c2", strength: 0.8 });
    expect(material.defines?.XFS_PLATE_FRESNEL).toBe("");
    expect(shader.uniforms.xfsShiftIntensity!.value).toBeCloseTo(1.6, 9);
    expect(material.version).toBe(version + 2);
    handle.setFresnel(null);
    expect(material.defines?.XFS_PLATE_FRESNEL).toBeUndefined();
    handle.setNormals(false);
    expect(shader.uniforms.xfsPlateNormals!.value).toBe(0);
    material.dispose();
  });

  test("a changed Three.js chunk is refused, not silently skipped", () => {
    const shader = standard();
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", "");
    expect(() => patchPlateLightShader(shader, { skinLight: false })).toThrow(/opaque_fragment/);
  });
});

/** A renderer stand-in that records the composite's draws (the stack only needs these calls). */
function fakeRenderer() {
  const calls: string[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    capabilities: { maxTextureSize: 4096 }, extensions: { has: () => true }, autoClear: true,
    getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; calls.push("target"); },
    getClearColor: (out: THREE.Color) => out.set(0x14181c), getClearAlpha: () => 1, setClearColor: () => {},
    clear: () => calls.push("clear"), render: () => calls.push("render"),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls, draws: () => calls.filter(call => call === "render").length };
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
const optics = (size: number) => ({ size, normal: new Uint8Array(size * size * 4), surface: new Uint8Array(size * size * 4) });
const GAME = { model: "game-matched-1" } as const;

describe("the makeup stack's plate", () => {
  test("the layers the export carries draw as one lit plate from one composite; Glitter keeps its own plate", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1);
    stack.setCanvases([0, 1, 2, 3].map(() => ({ width: 64, height: 64 }) as HTMLCanvasElement));
    const base = initialRecipe().layers[0]!;
    const layers: Layer[] = [{ ...base }, { ...base, finish: "regular" }, { ...base, finish: "glitter" }, { ...base, finish: "metallic" }];
    let reads = 0;
    stack.setUnderlaySource(() => { reads++; return underlay(); });
    const { renderer, draws } = fakeRenderer();
    expect(reads).toBe(0);
    layers.forEach((layer, i) => stack.updateLayer(i, layer, i === 2 ? optics(64) : undefined));
    stack.prepareBlend(renderer);
    expect(reads).toBe(1);
    expect(anchor.geometry.getAttribute("xfsUnderlay")).toBeDefined();
    const evidence = stack.blendDiagnostics();
    expect(evidence.plate).toMatchObject({ drawn: true, route: "flat", slots: [0, 1, 3], renderOrder: 10, skinLight: false, fresnel: false });
    // The window is the plate UVs (0.25–0.75 × 0.5–0.625) padded by 0.002: 33 × 9 of the 64-texel masks, half-float here.
    expect(evidence.plate.composite).toEqual({ width: 33, height: 9 });
    expect(evidence.halfFloat).toBe(true);
    expect(evidence.layers.map(layer => layer.ownPlate)).toEqual([false, false, true, false]);
    expect(stack.materials.map(material => material.visible)).toEqual([false, false, true, false]);
    // One draw per carried layer, one resolve of the merged decal, and one draw per level of its roughness chain (33 × 9: 6 levels).
    expect(evidence.plate.compositeDraws).toEqual({ layerDraws: 3, resolves: 1, levelDraws: 6 });
    expect(draws()).toBe(10);
    // Idle: nothing changed, nothing runs.
    stack.prepareBlend(renderer);
    expect(draws()).toBe(10);
    expect(reads).toBe(1);
    // A layer's mask changed: the composite is redrawn, the skin is not read again.
    stack.setLayerCanvas(0, { width: 64, height: 64 } as HTMLCanvasElement);
    stack.prepareBlend(renderer);
    expect(draws()).toBe(20);
    expect(reads).toBe(1);
    // A new skin is read once, on the next frame; its light arrives with it.
    stack.setUnderlaySource(() => { reads++; return underlay(); });
    stack.setSkinLight(skinParameters({ scalars: {}, colours: {}, skinProfiles: {} }));
    stack.prepareBlend(renderer);
    expect(reads).toBe(2);
    expect(stack.blendDiagnostics().plate.skinLight).toBe(true);
    // A disabled layer leaves the plate; the one below the others moves the plate's draw order with it.
    stack.updateLayer(0, { ...layers[0]!, enabled: false });
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate).toMatchObject({ slots: [1, 3], renderOrder: 11 });
    stack.setCanvases([]);
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate.drawn).toBe(false);
  });

  test("a Colour-shifting preset of one pigment is the Fresnel route; mixed with flat layers it keeps its own plate, as the export omits it", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1), { renderer } = fakeRenderer();
    const base = initialRecipe().layers[0]!;
    const shift: Layer = { ...base, finish: "iridescent", color: "#3a2350", optics: { ...GAME, shift: { color: "#3fd4c2", strength: 0.8 } } };
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement, { width: 32, height: 32 } as HTMLCanvasElement]);
    stack.setUnderlaySource(underlay);
    stack.updateLayer(0, shift); stack.updateLayer(1, { ...shift, id: "second" });
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate).toMatchObject({ drawn: true, route: "fresnel", slots: [0, 1], fresnel: true });
    stack.updateLayer(1, { ...base, id: "second", finish: "matte" });
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate).toMatchObject({ route: "flat", slots: [1], fresnel: false, renderOrder: 11 });
    expect(stack.blendDiagnostics().layers.map(layer => layer.ownPlate)).toEqual([true, false]);
    stack.setCanvases([]);
  });

  test("a game-matched Shimmer layer joins the composite with its facet maps; its earlier model stays on its own plate", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1), { renderer } = fakeRenderer();
    const base = initialRecipe().layers[0]!;
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement]);
    stack.setUnderlaySource(underlay);
    stack.updateLayer(0, { ...base, finish: "shimmer", optics: GAME }, optics(32));
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate).toMatchObject({ drawn: true, route: "faceted", slots: [0] });
    expect(stack.materials[0]!.normalMap).not.toBeNull();
    stack.updateLayer(0, { ...base, finish: "shimmer" }, optics(32));
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate.drawn).toBe(false);
    stack.setCanvases([]);
  });

  test("without the skin under the plate every layer keeps its own plate and linear blend", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1);
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement]);
    stack.setUnderlaySource(() => { throw Error("not over the head"); });
    stack.updateLayer(0, initialRecipe().layers[0]!);
    stack.prepareBlend(fakeRenderer().renderer);
    expect(stack.blendDiagnostics().plate.drawn).toBe(false);
    expect(stack.blendDiagnostics().layers[0]!.ownPlate).toBe(true);
    expect(anchor.geometry.getAttribute("xfsUnderlay")).toBeUndefined();
    stack.setCanvases([]);
  });

  test("the merged slots are the export plan's included layers across finishes, models, disabled and invisible layers", () => {
    const base = initialRecipe().layers[0]!;
    const shift = (color: string) => ({ ...GAME, shift: { color, strength: 0.8 } });
    const kinds: Record<string, Partial<Layer>> = {
      matte: { finish: "matte" }, satin: { finish: "regular" }, metallic: { finish: "metallic" },
      glossy: { finish: "glossy", optics: GAME }, earlierGlossy: { finish: "glossy" },
      shimmer: { finish: "shimmer", optics: GAME }, earlierShimmer: { finish: "shimmer" }, glitter: { finish: "glitter" },
      shiftA: { finish: "iridescent", color: "#3a2350", optics: shift("#3fd4c2") }, shiftB: { finish: "iridescent", color: "#3a2350", optics: shift("#d43f8a") },
      earlierShift: { finish: "iridescent" }, disabled: { finish: "matte", enabled: false }, invisible: { finish: "regular", opacity: 0 },
    };
    const presets: string[][] = [
      ["matte", "disabled", "invisible", "metallic", "satin"],
      ["earlierGlossy", "glossy", "earlierShimmer", "shimmer", "matte"],
      ["shiftA", "shiftA", "disabled"],
      ["shiftA", "matte", "shiftA"],
      ["shiftA", "shiftB"],
      ["glitter", "earlierShift", "invisible"],
      ["glitter", "satin", "shiftA", "glossy", "invisible", "shimmer"],
    ];
    const textured = new Set(["shimmer", "earlierShimmer", "glitter"]);
    for (const names of presets) {
      const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1), { renderer } = fakeRenderer();
      const layers = names.map((name, i): Layer => ({ ...base, id: `${name}-${i}`, ...kinds[name] }));
      stack.setCanvases(layers.map(() => ({ width: 32, height: 32 }) as HTMLCanvasElement));
      stack.setUnderlaySource(underlay);
      layers.forEach((layer, i) => stack.updateLayer(i, layer, textured.has(names[i]!) ? optics(32) : undefined));
      stack.prepareBlend(renderer);
      const plan = planPresetExport({ layers }), slots = plan.included.map(layer => layers.indexOf(layer));
      const { plate, layers: drawn } = stack.blendDiagnostics();
      expect({ names, slots: plate.slots }).toEqual({ names, slots });
      expect(plate.drawn).toBe(slots.length > 0);
      expect(plate.route).toBe(slots.length ? plan.route : null);
      // Every other enabled layer draws on its own plate; disabled ones draw nothing.
      expect(drawn.map(layer => layer.ownPlate)).toEqual(layers.map((layer, i) => layer.enabled && !slots.includes(i)));
      stack.setCanvases([]);
    }
  });

  test("a new skin of the same shape reuses the plate's underlay buffers; a different shape frees the old ones first (PREV-60)", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1), { renderer } = fakeRenderer();
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement]);
    stack.updateLayer(0, initialRecipe().layers[0]!);
    const names = ["xfsUnderlay", "xfsUnderRoughness", "xfsUnderMetalness"];
    const read = () => names.map(name => anchor.geometry.getAttribute(name) as THREE.BufferAttribute);
    let freed = 0;
    anchor.geometry.addEventListener("dispose", () => freed++);
    stack.setUnderlaySource(underlay);
    stack.prepareBlend(renderer);
    const first = read(), versions = first.map(attribute => attribute.version);
    // Another V with the same plate: the same attributes, new values, one upload each.
    const warmer = (): PlateUnderlay => ({ ...underlay(), colour: new THREE.BufferAttribute(new Float32Array(9).fill(0.55), 3) });
    stack.setUnderlaySource(warmer);
    stack.prepareBlend(renderer);
    expect(read()).toEqual(first);
    read().forEach((attribute, i) => expect(attribute).toBe(first[i]!));
    expect(first[0]!.getX(0)).toBeCloseTo(0.55, 6);
    first.forEach((attribute, i) => expect(attribute.version).toBe(versions[i]! + 1));
    expect(freed).toBe(0);
    // No skin under the plate: nothing reads the attributes, and they stay for the next skin.
    stack.setUnderlaySource(() => null);
    stack.prepareBlend(renderer);
    expect(stack.blendDiagnostics().plate.drawn).toBe(false);
    read().forEach((attribute, i) => expect(attribute).toBe(first[i]!));
    // A skin of another shape replaces them after the geometry's buffers are freed.
    const four = (): PlateUnderlay => ({ colour: new THREE.BufferAttribute(new Float32Array(12), 3), roughness: new THREE.BufferAttribute(new Float32Array(4), 1),
      metalness: new THREE.BufferAttribute(new Float32Array(4), 1) });
    stack.setUnderlaySource(four);
    stack.prepareBlend(renderer);
    expect(freed).toBe(1);
    expect(read()[0]!.count).toBe(4);
    stack.setCanvases([]);
  });

  test("a restored WebGL context redraws the composite on the next frame (PREV-58)", () => {
    const anchor = plateAnchor(), stack = createMakeupStack(anchor, 1), { renderer, draws } = fakeRenderer();
    stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement]);
    stack.setUnderlaySource(underlay);
    stack.updateLayer(0, initialRecipe().layers[0]!);
    stack.prepareBlend(renderer);
    const once = draws();
    stack.prepareBlend(renderer);
    expect(draws()).toBe(once);
    stack.contextRestored();
    expect(stack.blendDiagnostics().dirty).toBe(true);
    stack.prepareBlend(renderer);
    expect(draws()).toBe(2 * once);
    expect(stack.blendDiagnostics().dirty).toBe(false);
    stack.setCanvases([]);
  });
});
