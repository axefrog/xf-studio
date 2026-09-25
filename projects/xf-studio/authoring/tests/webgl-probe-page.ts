/**
 * Browser page for tests/webgl-display.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context).
 * 1. Compiles and draws every shader variant of the renderer's own materials: the face decal family (plain, double
 *    diffuse, gradient recolour; with and without the skin underlay and skin light), the brows, skin, eyeball and
 *    wetness shell, and the display passes (PREV-56).
 * 2. Measures the studio display against the linear solve (PREV-50): a decal drawn with the forward "over" colour and
 *    alpha that `forwardDecal` solves over a known skin must show the colour of the game's square-root-space blend,
 *    drawn as one opaque surface through the same display. Also records the old direct path for comparison.
 * 3. The authored makeup plate (plate-blend.ts), through the makeup stack itself: experiment 016's Board 5 (black Matte at 25, 50
 *    and 75 % over skin) and two overlapping layers, measured scene-linear in a half-float target under a flat ambient light, against
 *    the square-root-space predictions and the export's merged decal.
 * Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createDoubleDiffuseDecalMaterial } from "../src/brow-material";
import { createEyeMaterial, createEyeShellMaterial, eyeParameters, gradientTexture, shellParameters } from "../src/eye-material";
import { createFaceDecalMaterial, decalColourUnits, faceDecalParameters, forwardDecal, gbufferColour, type Rgb } from "../src/face-decal-material";
import type { DecalKind } from "../src/render-templates";
import { createLinearDisplay, linearTargetSupported } from "../src/linear-display";
import { createMakeupStack } from "../src/makeup-stack";
import { mergeFlatSample, type MergedSample } from "../src/preset-compiler";
import { initialRecipe, type Layer } from "../src/recipe";
import { createSkinMaterial, skinParameters } from "../src/skin-material";
import { stageBackdropPixels } from "../src/stage-backdrop";

type Probe = { ok: boolean; linear: boolean; renderer: string; errors: string[]; programs: string[];
  blends: { name: string; target: number[]; studio: number[]; creator: number[]; creatorTarget: number[]; direct: number[] }[];
  opaque: { studio: number[]; direct: number[] }; backdrop: { studio: number[]; direct: number[] }; failure?: string;
  plate?: { steps: { coverage: number; sqrt: number[]; linear: number[] }[]; stack: { preview: number[]; target: number[]; linear: number[] };
    variants: boolean[] } };
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

  // 4. The authored plate. A flat ambient light and no environment make every surface's light proportional to its colour, and every
  // surface (skin, layers, reference) is Matte, so ratios of scene-linear pixels are ratios of colours.
  if (probe.linear) {
    const plateScene = new THREE.Scene();
    plateScene.add(new THREE.AmbientLight(0xffffff, 1));
    const matte = (rgb: Rgb) => { const m = new THREE.MeshPhysicalMaterial({ roughness: 0.88, metalness: 0 }); m.color.setRGB(...rgb, THREE.LinearSRGBColorSpace); return m; };
    const skinColour = decalColourUnits([214, 170, 150]);
    const skinQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matte(skinColour));
    plateScene.add(skinQuad);
    // The plate: a skinned quad in front of the skin, bound to one bone at rest.
    const plateGeometry = new THREE.PlaneGeometry(2, 2);
    plateGeometry.translate(0, 0, 0.01);
    const count = plateGeometry.getAttribute("position").count;
    plateGeometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    plateGeometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
    const bone = new THREE.Bone(), anchor = new THREE.SkinnedMesh(plateGeometry);
    plateScene.add(bone, anchor);
    anchor.bind(new THREE.Skeleton([bone]));
    const stack = createMakeupStack(anchor, 1);
    const fill = (value: number, size: number) => new THREE.BufferAttribute(new Float32Array(count * size).fill(value), size);
    const underlay = () => ({ colour: new THREE.BufferAttribute(Float32Array.from({ length: count * 3 }, (_, i) => skinColour[i % 3]!), 3),
      roughness: fill(0.88, 1), metalness: fill(0, 1) });
    const mask = (alpha: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(255);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = alpha;
      canvas.getContext("2d")!.putImageData(new ImageData(pixels, 4, 4), 0, 0);
      return canvas;
    };
    const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
    const renderLinear = () => {
      stack.prepareBlend(renderer);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(plateScene, camera);
      const pixel = new Float32Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      renderer.setRenderTarget(null);
      return [...pixel.slice(0, 3)];
    };
    const base = initialRecipe().layers[0]!;
    const layer = (color: string, alpha: number): Layer => ({ ...base, enabled: true, color, finish: "matte", opacity: alpha / 255 });
    const show = (stackLayers: { color: string; alpha: number }[], squareRoot: boolean) => {
      stack.setUnderlaySource(squareRoot ? underlay : () => null);
      stack.setCanvases(stackLayers.map(item => mask(item.alpha)));
      stackLayers.forEach((item, i) => stack.updateLayer(i, layer(item.color, item.alpha)));
      return renderLinear();
    };
    stack.setCanvases([]);
    const bare = renderLinear();
    const ratio = (pixel: number[]) => pixel.map((value, k) => value / bare[k]!);
    const steps = [64, 128, 191].map(alpha => ({ coverage: alpha / 255, sqrt: ratio(show([{ color: "#000000", alpha }], true)),
      linear: ratio(show([{ color: "#000000", alpha }], false)) }));
    // Plum at 60 % under a pale gold at 50 %: the export's merged decal over the same skin, drawn as one opaque Matte surface.
    const pair = [{ color: "#6d4a7e", alpha: 153 }, { color: "#e8c872", alpha: 128 }];
    const previewPixel = show(pair, true), linearPixel = show(pair, false);
    // Every plate variant compiles and draws with the blend: game-matched Shimmer's maps and a Colour-shifting tint over the pair.
    stack.setUnderlaySource(underlay);
    stack.setCanvases([mask(153), mask(128), mask(200)]);
    const optics = { size: 4, normal: new Uint8Array(64).fill(128), surface: new Uint8Array(64).fill(200) };
    stack.updateLayer(0, layer("#6d4a7e", 153));
    stack.updateLayer(1, { ...layer("#e8c872", 128), finish: "shimmer", optics: { model: "game-matched-1" } }, optics);
    stack.updateLayer(2, { ...layer("#3a2350", 200), finish: "iridescent", optics: { model: "game-matched-1", shift: { color: "#3fd4c2", strength: 0.8 } } });
    renderLinear();
    const variants = stack.blendDiagnostics().layers.map(item => item.squareRoot);
    let merged: MergedSample = { color: [0, 0, 0], roughness: 0, metalness: 0, coverage: 0 };
    for (const item of pair) merged = mergeFlatSample(merged, { color: decalColourUnits([1, 3, 5].map(i => parseInt(item.color.slice(i, i + 2), 16))), roughness: 0.88, metalness: 0 }, item.alpha / 255);
    stack.setCanvases([]);
    (skinQuad.material as THREE.MeshPhysicalMaterial).color.setRGB(...gbufferColour(merged.color, merged.coverage, skinColour), THREE.LinearSRGBColorSpace);
    const targetPixel = renderLinear();
    probe.plate = { steps, stack: { preview: previewPixel, target: targetPixel, linear: linearPixel }, variants };
    target.dispose();
  }
  probe.ok = true;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: Probe }).probe = probe;
