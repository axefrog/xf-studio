/**
 * Browser page for tests/webgl-display.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context).
 * 1. Compiles and draws every shader variant of the renderer's own materials: the face decal family (plain, double
 *    diffuse, gradient recolour; with and without the skin underlay and skin light), the brows, skin, eyeball and
 *    wetness shell, and the display passes (PREV-56).
 * 2. Measures the studio display against the linear solve (PREV-50): a decal drawn with the forward "over" colour and
 *    alpha that `forwardDecal` solves over a known skin must show the colour of the game's square-root-space blend,
 *    drawn as one opaque surface through the same display. Also records the old direct path for comparison.
 * Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createDoubleDiffuseDecalMaterial } from "../src/brow-material";
import { createEyeMaterial, createEyeShellMaterial, eyeParameters, gradientTexture, shellParameters } from "../src/eye-material";
import { createFaceDecalMaterial, decalColourUnits, faceDecalParameters, forwardDecal, gbufferColour, type Rgb } from "../src/face-decal-material";
import type { DecalKind } from "../src/render-templates";
import { createLinearDisplay, linearTargetSupported } from "../src/linear-display";
import { createSkinMaterial, skinParameters } from "../src/skin-material";
import { stageBackdropPixels } from "../src/stage-backdrop";

type Probe = { ok: boolean; linear: boolean; renderer: string; errors: string[]; programs: string[];
  blends: { name: string; target: number[]; studio: number[]; creator: number[]; creatorTarget: number[]; direct: number[] }[];
  opaque: { studio: number[]; direct: number[] }; backdrop: { studio: number[]; direct: number[] }; failure?: string };
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
  probe.ok = true;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: Probe }).probe = probe;
