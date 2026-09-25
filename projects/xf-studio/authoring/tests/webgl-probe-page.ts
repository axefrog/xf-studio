/**
 * Browser page for tests/webgl-display.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context).
 * 1. Compiles and draws every shader variant of the renderer's own materials: the face decal family (plain, double
 *    diffuse, gradient recolour; with and without the skin underlay and skin light), the brows, skin, eyeball and
 *    wetness shell, and the display passes (PREV-56).
 * 2. Measures the studio display against the linear solve (PREV-50): a decal drawn with the forward "over" colour and
 *    alpha that `forwardDecal` solves over a known skin must show the colour of the game's square-root-space blend,
 *    drawn as one opaque surface through the same display. Also records the old direct path for comparison.
 * 3. The authored makeup plate (plate-blend.ts), through the makeup stack itself, measured scene-linear in a half-float target:
 *    experiment 016's Board 5 (black Matte at 25, 50 and 75 % over skin) and two overlapping layers under a flat ambient light, against
 *    the square-root-space predictions and the export's merged decal; then, under the skin's own light with a key light and the room
 *    environment, the one lit plate against the blended G-buffer surface drawn as one opaque skin-lit quad (stacked finishes, Glossy,
 *    Metallic either side of the 0.1 SSS switch), and against the face decals' pass for a surface as rough as the skin.
 * Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createDoubleDiffuseDecalMaterial } from "../src/brow-material";
import { createEyeMaterial, createEyeShellMaterial, eyeParameters, gradientTexture, shellParameters } from "../src/eye-material";
import { createFaceDecalMaterial, decalColourUnits, faceDecalParameters, forwardDecal, gbufferColour, type Rgb } from "../src/face-decal-material";
import type { DecalKind } from "../src/render-templates";
import { createLinearDisplay, linearTargetSupported } from "../src/linear-display";
import { flatSurface } from "../src/finish-export";
import { createMakeupStack, type PlateUnderlay } from "../src/makeup-stack";
import { accumulateComposite, EMPTY_COMPOSITE, plateSurface, type PlateComposite, type PlateTexel } from "../src/plate-blend";
import { initialRecipe, type Layer } from "../src/recipe";
import { createSkinMaterial, patchSkinLight, skinLightUniforms, skinParameters } from "../src/skin-material";
import { stageBackdropPixels } from "../src/stage-backdrop";

type Probe = { ok: boolean; linear: boolean; renderer: string; errors: string[]; programs: string[];
  blends: { name: string; target: number[]; studio: number[]; creator: number[]; creatorTarget: number[]; direct: number[] }[];
  opaque: { studio: number[]; direct: number[] }; backdrop: { studio: number[]; direct: number[] }; failure?: string;
  plate?: PlateProbe };
/** The authored plate's measurements (section 4). */
export type PlateProbe = { steps: { coverage: number; sqrt: number[]; linear: number[] }[]; stack: { preview: number[]; target: number[]; linear: number[] };
  routes: string[]; once: { name: string; preview: number[]; truth: number[]; metalness: number; skinLight: boolean }[];
  parity: { plate: number[]; decal: number[] }; glossy: { plate: number[]; decal: number[]; truth: number[] } };
const probe: Probe = { ok: false, linear: false, renderer: "", errors: [], programs: [], blends: [], opaque: { studio: [], direct: [] }, backdrop: { studio: [], direct: [] } };
(window as unknown as { probe?: Probe }).probe = undefined;

function texture(rgba: number[], colour = false) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function quadGeometry(z: number) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.translate(0, 0, z);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("xfsUnderlay", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(0.4), 3));
  geometry.setAttribute("xfsUnderRoughness", new THREE.Float32BufferAttribute(new Float32Array(count).fill(0.6), 1));
  geometry.setAttribute("xfsUnderMetalness", new THREE.Float32BufferAttribute(new Float32Array(count), 1));
  geometry.computeTangents?.();
  return geometry;
}

try {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  probe.linear = linearTargetSupported(context);
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 64, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(0, 0, 5);
  const display = createLinearDisplay(renderer);

  // 1. Every material variant, compiled and drawn once in a lit scene with an environment (as the app's).
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.DirectionalLight(0xffffff, 2));
  const white = () => texture([255, 255, 255, 255]), grey = () => texture([128, 128, 128, 200], true), flat = () => texture([128, 128, 255, 255]);
  const materials: THREE.Material[] = [];
  const skin = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
  for (const kind of ["mesh-decal", "double-diffuse", "gradient-recolor"] as DecalKind[])
    for (const underlay of [true, false]) for (const skinLight of [skin, null])
      materials.push(createFaceDecalMaterial({ diffuse: grey(), secondaryMask: white(), normal: flat(), normalAlpha: white(), roughness: white(),
        metalness: texture([0, 0, 0, 255]), secondaryDiffuse: grey(), gradient: texture([200, 120, 90, 255], true), mask: white() },
        faceDecalParameters(kind, { DiffuseAlpha: 0.5, RoughnessMetalnessAlpha: 0.4, NormalAlpha: 0.3, UseGradientMap: 1 }, { DiffuseColor: [120, 60, 50, 255] }),
        { underlay, skinLight }).material);
  for (const gbufferBlend of [true, false]) materials.push(createDoubleDiffuseDecalMaterial(grey(), white(), texture([90, 60, 40, 255], true), { gbufferBlend }));
  materials.push(createSkinMaterial({ albedo: grey(), normal: flat(), roughness: white(), detailNormal: flat(), microDetail: flat(),
    tintMask: texture([0, 0, 0, 255]), secondary: texture([0, 0, 0, 0]) }, skin).material);
  const ramp = gradientTexture([{ value: 0, color: [20, 20, 20, 255] }, { value: 1, color: [130, 190, 230, 255] }]);
  materials.push(createEyeMaterial({ albedo: grey(), roughness: white(), irisMask: white(), gradient: ramp }, eyeParameters({ scalars: {} })).material);
  materials.push(createEyeMaterial({ albedo: grey() }, eyeParameters({ scalars: {} })).material);
  materials.push(createEyeShellMaterial(white(), shellParameters({ scalars: {}, colours: {} })).material);
  materials.forEach((material, i) => scene.add(new THREE.Mesh(quadGeometry(-i * 0.01), material)));
  renderer.compile(scene, camera);
  display.render(scene, camera, "studio");
  display.render(scene, camera, "creator");
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const glError = gl.getError();
  if (glError !== gl.NO_ERROR) probe.errors.push(`WebGL error ${glError}`);
  probe.programs = (renderer.info.programs ?? []).map(program => program.name);
  for (const program of renderer.info.programs ?? []) {
    const diagnostics = (program as unknown as { diagnostics?: { runnable: boolean; programLog: string } }).diagnostics;
    if (diagnostics && !diagnostics.runnable) probe.errors.push(`${program.name}: ${diagnostics.programLog}`);
  }
  scene.traverse(object => { if (object instanceof THREE.Mesh) object.visible = false; });

  // 2. The blend: an opaque skin, and the solved forward decal over it, against the target drawn as one surface.
  const read = () => {
    const pixel = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel.slice(0, 3)];
  };
  const blendScene = new THREE.Scene();
  const backdropTexture = new THREE.DataTexture(stageBackdropPixels("dark", 16, 16), 16, 16);
  backdropTexture.colorSpace = THREE.SRGBColorSpace; backdropTexture.needsUpdate = true;
  blendScene.background = backdropTexture;
  const basic = (rgb: Rgb, opacity = 1) => {
    const material = new THREE.MeshBasicMaterial({ transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
    return material;
  };
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), basic([0, 0, 0]));
  const over = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), basic([0, 0, 0], 0.5));
  over.position.z = 0.001; over.renderOrder = 1;
  blendScene.add(under, over);
  const draw = (path: "studio" | "creator" | "direct") => {
    if (path === "direct") renderer.render(blendScene, camera); else display.render(blendScene, camera, path);
    return read();
  };
  // The reviewer's cases: a dark liner and the reference lipstick over lit skin (linear values; the pass is unlit here).
  const cases: { name: string; decal: Rgb; alpha: number; skin: Rgb }[] = [
    { name: "dark liner", decal: decalColourUnits([28, 20, 16]), alpha: 0.7, skin: decalColourUnits([214, 170, 150]) },
    { name: "lipstick", decal: decalColourUnits([106, 40, 40]), alpha: 0.4, skin: decalColourUnits([196, 146, 132]) },
    { name: "blush over", decal: decalColourUnits([180, 60, 70]), alpha: 0.25, skin: decalColourUnits([230, 190, 170]) },
  ];
  for (const item of cases) {
    const solved = forwardDecal(item.decal, item.alpha, item.skin);
    const target = gbufferColour(item.decal, item.alpha, item.skin);
    (under.material as THREE.MeshBasicMaterial).color.setRGB(...item.skin, THREE.LinearSRGBColorSpace);
    const overMaterial = over.material as THREE.MeshBasicMaterial;
    overMaterial.color.setRGB(...solved.color, THREE.LinearSRGBColorSpace);
    overMaterial.opacity = solved.alpha; overMaterial.transparent = true; overMaterial.needsUpdate = true;
    over.visible = true;
    const studio = draw("studio"), creator = draw("creator"), direct = draw("direct");
    // The target colour as one opaque surface through each display.
    over.visible = false;
    (under.material as THREE.MeshBasicMaterial).color.setRGB(...target, THREE.LinearSRGBColorSpace);
    probe.blends.push({ name: item.name, studio, creator, direct, target: draw("studio"), creatorTarget: draw("creator") });
  }
  // 3. Opaque parity and the backdrop: the studio display shows what drawing straight to the canvas showed.
  over.visible = false; under.visible = true;
  (under.material as THREE.MeshBasicMaterial).color.setRGB(0.42, 0.27, 0.2, THREE.LinearSRGBColorSpace);
  probe.opaque = { studio: draw("studio"), direct: draw("direct") };
  under.visible = false;
  probe.backdrop = { studio: draw("studio"), direct: draw("direct") };

  // 4. The authored plate, through the makeup stack itself: the composite and the one lit plate over a skin quad (plate-blend.ts).
  if (probe.linear) {
    const skinColour = decalColourUnits([214, 170, 150]);
    const count = 4;
    /** A skinned quad in front of the skin, bound to one bone at rest, carrying the skin under it as the plate's underlay. */
    const plateIn = (scene: THREE.Scene, roughness: number) => {
      const geometry = new THREE.PlaneGeometry(2, 2);
      geometry.translate(0, 0, 0.01);
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
      const bone = new THREE.Bone(), anchor = new THREE.SkinnedMesh(geometry);
      scene.add(bone, anchor);
      anchor.bind(new THREE.Skeleton([bone]));
      const stack = createMakeupStack(anchor, 1);
      const fill = (value: number, size: number) => new THREE.BufferAttribute(new Float32Array(count * size).fill(value), size);
      const underlay = (): PlateUnderlay => ({ colour: new THREE.BufferAttribute(Float32Array.from({ length: count * 3 }, (_, i) => skinColour[i % 3]!), 3),
        roughness: fill(roughness, 1), metalness: fill(0, 1) });
      return { stack, underlay };
    };
    const mask = (alpha: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(255);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = alpha;
      canvas.getContext("2d")!.putImageData(new ImageData(pixels, 4, 4), 0, 0);
      return canvas;
    };
    const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
    const renderLinear = (scene: THREE.Scene, stack: ReturnType<typeof createMakeupStack>) => {
      stack.prepareBlend(renderer);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      const pixel = new Float32Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      renderer.setRenderTarget(null);
      return [...pixel.slice(0, 3)];
    };
    const base = initialRecipe().layers[0]!;
    type Item = { color: string; alpha: number; finish?: "matte" | "regular" | "metallic" | "glossy" };
    const layer = (item: Item, i: number): Layer => ({ ...base, id: `probe-${i}`, enabled: true, color: item.color, finish: item.finish ?? "matte",
      opacity: 1, ...(item.finish === "glossy" ? { optics: { model: "game-matched-1" as const } } : {}) });
    const show = (stack: ReturnType<typeof createMakeupStack>, underlay: () => PlateUnderlay, items: Item[], squareRoot: boolean) => {
      stack.setUnderlaySource(squareRoot ? underlay : () => null);
      stack.setCanvases(items.map(item => mask(item.alpha)));
      items.forEach((item, i) => stack.updateLayer(i, layer(item, i)));
    };
    const texels = (items: Item[]): PlateTexel[] => items.map(item => ({ colour: decalColourUnits([1, 3, 5].map(i => parseInt(item.color.slice(i, i + 2), 16))),
      coverage: item.alpha / 255, ...flatSurface(item.finish ?? "matte")! }));
    const merged = (items: Item[]) => texels(items).reduce<PlateComposite>((below, texel) => accumulateComposite(below, texel), { ...EMPTY_COMPOSITE, sqrtColour: [0, 0, 0] });

    // 4a. A flat ambient light and no environment make every Matte surface's light proportional to its colour (standard light),
    // so ratios of scene-linear pixels are ratios of colours: Board 5's steps and a stacked pair against the export.
    const flatScene = new THREE.Scene();
    flatScene.add(new THREE.AmbientLight(0xffffff, 1));
    const matte = (rgb: Rgb) => { const m = new THREE.MeshPhysicalMaterial({ roughness: 0.88, metalness: 0 }); m.color.setRGB(...rgb, THREE.LinearSRGBColorSpace); return m; };
    const skinQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matte(skinColour));
    flatScene.add(skinQuad);
    const ambient = plateIn(flatScene, 0.88);
    ambient.stack.setCanvases([]);
    const bare = renderLinear(flatScene, ambient.stack);
    const ratio = (pixel: number[]) => pixel.map((value, k) => value / bare[k]!);
    const steps = [64, 128, 191].map(alpha => {
      show(ambient.stack, ambient.underlay, [{ color: "#000000", alpha }], true);
      const sqrt = ratio(renderLinear(flatScene, ambient.stack));
      show(ambient.stack, ambient.underlay, [{ color: "#000000", alpha }], false);
      return { coverage: alpha / 255, sqrt, linear: ratio(renderLinear(flatScene, ambient.stack)) };
    });
    const pair: Item[] = [{ color: "#6d4a7e", alpha: 153 }, { color: "#e8c872", alpha: 128 }];
    show(ambient.stack, ambient.underlay, pair, true);
    const previewPixel = renderLinear(flatScene, ambient.stack);
    show(ambient.stack, ambient.underlay, pair, false);
    const linearPixel = renderLinear(flatScene, ambient.stack);
    ambient.stack.setCanvases([]);
    (skinQuad.material as THREE.MeshPhysicalMaterial).color.setRGB(...plateSurface({ colour: skinColour, roughness: 0.88, metalness: 0 }, merged(pair)).colour,
      THREE.LinearSRGBColorSpace);
    const targetPixel = renderLinear(flatScene, ambient.stack);

    // 4b. The skin's own light (vanilla profile), a key light and the room environment: the one plate over a skin-lit quad must show
    // the blended G-buffer surface lit once, drawn as one opaque skin-lit quad; and, for a surface as rough as the skin, the face
    // decals' forward pass must agree with it.
    const skin = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
    const skinLit = (rgb: Readonly<Rgb>, roughness: number, metalness: number) => {
      const material = new THREE.MeshStandardMaterial({ roughness, metalness });
      material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
      const uniforms = skinLightUniforms(skin);
      material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); shader.fragmentShader = patchSkinLight(shader.fragmentShader); };
      material.customProgramCacheKey = () => "probe-skin-lit";
      return material;
    };
    const litScene = new THREE.Scene();
    litScene.environment = scene.environment;
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(0.35, 0.3, 1);
    litScene.add(sun);
    const SKIN_ROUGHNESS = 0.88;
    const litQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skinLit(skinColour, SKIN_ROUGHNESS, 0));
    litScene.add(litQuad);
    const lit = plateIn(litScene, SKIN_ROUGHNESS);
    lit.stack.setSkinLight(skin);
    const truth = (items: Item[]) => {
      lit.stack.setCanvases([]);
      const surface = plateSurface({ colour: skinColour, roughness: SKIN_ROUGHNESS, metalness: 0 }, merged(items));
      const previous = litQuad.material;
      litQuad.material = skinLit(surface.colour, surface.roughness, surface.metalness);
      const pixel = renderLinear(litScene, lit.stack);
      (litQuad.material as THREE.Material).dispose();
      litQuad.material = previous;
      return { pixel, metalness: surface.metalness };
    };
    const cases: { name: string; items: Item[] }[] = [
      { name: "plum Matte 60 % under gold Satin 50 %", items: pair.map((item, i) => ({ ...item, finish: i ? "regular" : "matte" })) },
      { name: "Glossy 100 %", items: [{ color: "#6d4a7e", alpha: 255, finish: "glossy" }] },
      { name: "Metallic 12 % (metalness 0.08: SSS kept)", items: [{ color: "#6d4a7e", alpha: 31, finish: "metallic" }] },
      { name: "Metallic 30 % (metalness 0.2: SSS skipped)", items: [{ color: "#6d4a7e", alpha: 77, finish: "metallic" }] },
      { name: "black Matte 50 %", items: [{ color: "#000000", alpha: 128 }] },
    ];
    const once = cases.map(item => {
      show(lit.stack, lit.underlay, item.items, true);
      const preview = renderLinear(litScene, lit.stack);
      const skinLight = lit.stack.blendDiagnostics().plate.skinLight;
      const expected = truth(item.items);
      return { name: item.name, preview, truth: expected.pixel, metalness: expected.metalness, skinLight };
    });
    // The face decals' pass for a single mesh_decal of the same colour and coverage (alpha² = the plate's coverage).
    const decalOver = (rgbBytes: number[], alphaByte: number, roughnessByte: number) => {
      const geometry = new THREE.PlaneGeometry(2, 2);
      geometry.translate(0, 0, 0.01);
      const vertices = geometry.getAttribute("position").count;
      geometry.setAttribute("xfsUnderlay", new THREE.Float32BufferAttribute(Array.from({ length: vertices * 3 }, (_, i) => skinColour[i % 3]!), 3));
      geometry.setAttribute("xfsUnderRoughness", new THREE.Float32BufferAttribute(new Float32Array(vertices).fill(SKIN_ROUGHNESS), 1));
      geometry.setAttribute("xfsUnderMetalness", new THREE.Float32BufferAttribute(new Float32Array(vertices), 1));
      const { material } = createFaceDecalMaterial({ diffuse: texture([...rgbBytes, alphaByte], true), secondaryMask: white(), normal: flat(),
        normalAlpha: white(), roughness: texture([roughnessByte, roughnessByte, roughnessByte, 255]), metalness: texture([0, 0, 0, 255]) },
        faceDecalParameters("mesh-decal", { DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1 }, { DiffuseColor: [255, 255, 255, 255] }),
        { underlay: true, skinLight: skin });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 5;
      lit.stack.setCanvases([]);
      litScene.add(mesh);
      const pixel = renderLinear(litScene, lit.stack);
      mesh.removeFromParent(); geometry.dispose(); material.dispose();
      return pixel;
    };
    const plum = [0x6d, 0x4a, 0x7e];
    // Coverage 0.36: the decal's alpha 153 squared, the plate's mask 92.
    const parityItem = (finish: "matte" | "glossy"): Item[] => [{ color: "#6d4a7e", alpha: 92, finish }];
    show(lit.stack, lit.underlay, parityItem("matte"), true);
    const parityPlate = renderLinear(litScene, lit.stack);
    const parityDecal = decalOver(plum, 153, 224);
    show(lit.stack, lit.underlay, parityItem("glossy"), true);
    const glossyPlate = renderLinear(litScene, lit.stack);
    const glossyDecal = decalOver(plum, 153, 31);
    const glossyTruth = truth(parityItem("glossy")).pixel;
    lit.stack.setCanvases([]);

    // 4c. Every plate variant compiles and draws: game-matched Shimmer's maps, a one-pigment Colour-shifting preset (Fresnel route),
    // and a Colour-shifting layer the export omits from a mixed preset (its own plate), with and without the skin light.
    const routes: string[] = [];
    for (const skinLight of [skin, null]) {
      lit.stack.setSkinLight(skinLight);
      lit.stack.setUnderlaySource(lit.underlay);
      const shimmerOptics = { size: 4, normal: new Uint8Array(64).fill(128), surface: new Uint8Array(64).fill(200) };
      const shift = { model: "game-matched-1" as const, shift: { color: "#3fd4c2", strength: 0.8 } };
      lit.stack.setCanvases([mask(153), mask(128)]);
      lit.stack.updateLayer(0, layer({ color: "#6d4a7e", alpha: 153 }, 0));
      lit.stack.updateLayer(1, { ...layer({ color: "#e8c872", alpha: 128 }, 1), finish: "shimmer", optics: { model: "game-matched-1" } }, shimmerOptics);
      renderLinear(litScene, lit.stack);
      routes.push(`${lit.stack.blendDiagnostics().plate.route}`);
      lit.stack.setCanvases([mask(200), mask(120)]);
      lit.stack.updateLayer(0, { ...layer({ color: "#3a2350", alpha: 200 }, 0), finish: "iridescent", optics: shift });
      lit.stack.updateLayer(1, { ...layer({ color: "#3a2350", alpha: 120 }, 1), finish: "iridescent", optics: shift });
      renderLinear(litScene, lit.stack);
      routes.push(`${lit.stack.blendDiagnostics().plate.route}`);
      lit.stack.updateLayer(1, layer({ color: "#6d4a7e", alpha: 120 }, 1));
      renderLinear(litScene, lit.stack);
      const diagnostics = lit.stack.blendDiagnostics();
      routes.push(`${diagnostics.plate.route}+${diagnostics.layers.filter(item => item.ownPlate).length} own`);
      lit.stack.setCanvases([]);
    }
    probe.plate = { steps, stack: { preview: previewPixel, target: targetPixel, linear: linearPixel }, routes, once,
      parity: { plate: parityPlate, decal: parityDecal }, glossy: { plate: glossyPlate, decal: glossyDecal, truth: glossyTruth } };
    target.dispose();
  }
  probe.ok = true;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: Probe }).probe = probe;
