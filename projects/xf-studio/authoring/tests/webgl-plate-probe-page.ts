/**
 * Browser page for tests/webgl-plate-composite.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context).
 * 1. The plate composite's faceted chain against the export's (PREV-57): Shimmer at partial coverage over Glossy at 50 % (and each
 *    alone at the edges), drawn by the makeup stack's own layer materials into the composite, read back at levels 0 and 2, against
 *    `facetedMipChain` of the bytes the preset compiler would write for the same texels. Half-float and forced 8-bit targets.
 * 2. Mip generations per composite update (PREV-61): twelve layers, counted at `generateMipmap`.
 * 3. The studio environment: the light-probe fallback's harmonics recomputed from the room, and its diffuse light against the
 *    prefiltered environment's on a white matte quad.
 * 4. A lost and restored context (PREV-58), last: the plate and an environment-lit surface before, after without the restore hooks,
 *    and after them; and a baked layered part (PREV-62) the same way, re-baked by the scene's restore path.
 * Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LightProbeGenerator } from "three/addons/lights/LightProbeGenerator.js";
import { flatSurface } from "../src/finish-export";
import { createMakeupStack, type PlateUnderlay } from "../src/makeup-stack";
import { FULL_WINDOW } from "../src/plate-blend";
import { createPlateComposite, type CompositeTextures } from "../src/plate-composite";
import { initialRecipe, type Layer } from "../src/recipe";
import { facetedMipChain } from "../src/route-mip-chains";
import { createStudioEnvironment, ROOM_ENVIRONMENT_SH } from "../src/studio-environment";
import { createLayeredMaterial, layerBakeParameters, layeredContextRestored } from "../src/layered-material";
import type { RenderLayer } from "../src/render-detail";
import { readTextureLevel } from "./webgl-harness-page";

export type ChainComparison = { level: number; roughnessMaxError: number; normalMaxError: number; coverageMaxError: number; texels: number };
export type PlateCompositeProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string; halfFloat: boolean;
  /** Per precision: the GPU chain against the export's, in byte units (bytes × 1, floats × 255). */
  chains: { precision: "half-float" | "8-bit"; levels: ChainComparison[] }[];
  /** The finding's case at one facet texel: Shimmer 50 % over Glossy 50 %. */
  facet: { exportLevel0: number; previewLevel0: number; exportLevel2: number; previewLevel2: number; earlierLevel0: number };
  mips: { layers: number; perUpdate: number; draws: { layerDraws: number; resolves: number; levelDraws: number } };
  environment: { shMaxError: number; probe: number[]; pmrem: number[] };
  restore: { before: { plate: number[]; skin: number[] }; unhooked: { plate: number[]; skin: number[] }; hooked: { plate: number[]; skin: number[] } };
  /** A baked layered part lit on a quad: before the loss, after it without the restore path, after the scene's restore path. */
  layered: { before: number[]; unhooked: number[]; hooked: number[]; states: string[] };
};
const probe: PlateCompositeProbe = { ok: false, errors: [], renderer: "", halfFloat: false, chains: [],
  facet: { exportLevel0: 0, previewLevel0: 0, exportLevel2: 0, previewLevel2: 0, earlierLevel0: 0 }, mips: { layers: 0, perUpdate: 0, draws: { layerDraws: 0, resolves: 0, levelDraws: 0 } },
  environment: { shMaxError: 0, probe: [], pmrem: [] },
  restore: { before: { plate: [], skin: [] }, unhooked: { plate: [], skin: [] }, hooked: { plate: [], skin: [] } },
  layered: { before: [], unhooked: [], hooked: [], states: [] } };

const SIZE = 16;
/** The finding's case: Shimmer at 50 % over Glossy at 50 %. */
const FACET_TEXEL = 5 * SIZE + 5;
/** A deterministic generator, so a failure repeats. */
function random(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const unorm = (b: number) => b / 255 * 2 - 1;

function maskCanvas(alpha: (x: number, y: number) => number, size = SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels[(y * size + x) * 4 + 3] = alpha(x, y);
  canvas.getContext("2d")!.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas;
}

try {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true })!;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 64, false);
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  /** Record a WebGL error left by the section just run. */
  const check = (section: string) => { const error = gl.getError(); if (error !== gl.NO_ERROR) probe.errors.push(`WebGL error ${error} after ${section}`); };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  camera.position.set(0, 0, 5);

  /** A skinned quad carrying the skin under it, and the makeup stack over it (as tests/webgl-probe-page.ts). */
  const plateIn = (scene: THREE.Scene) => {
    const geometry = new THREE.PlaneGeometry(2, 2), count = 4;
    geometry.translate(0, 0, 0.01);
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
    const bone = new THREE.Bone(), anchor = new THREE.SkinnedMesh(geometry);
    scene.add(bone, anchor);
    anchor.bind(new THREE.Skeleton([bone]));
    const stack = createMakeupStack(anchor, 1);
    const fill = (value: number, size: number) => new THREE.BufferAttribute(new Float32Array(count * size).fill(value), size);
    const underlay = (): PlateUnderlay => ({ colour: fill(0.4, 3), roughness: fill(0.6, 1), metalness: fill(0, 1) });
    stack.setUnderlaySource(underlay);
    return stack;
  };
  const base = initialRecipe().layers[0]!;
  const GAME = { model: "game-matched-1" } as const;

  // 1. The faceted chain. Glossy at 50 % over the rows y ≥ 4, then Shimmer over the columns x < 12 at coverage 0.3–1 (50 % on the
  //    finding's texel), with facets tilted 0.25–0.7 at random azimuths (past the mode-1 fade, so the preview's faded maps carry
  //    them whole) and roughness 0.2–0.5. Texels outside both stay flat, as the export's.
  const next = random(2077), texels = SIZE * SIZE;
  const shimmerAlpha = new Uint8Array(texels), normal = new Uint8Array(texels * 4), surface = new Uint8Array(texels * 4);
  for (let p = 0; p < texels; p++) {
    const x = p % SIZE, tilt = 0.25 + 0.45 * next(), azimuth = 2 * Math.PI * next();
    shimmerAlpha[p] = x < 12 ? (p === FACET_TEXEL ? 128 : Math.round(255 * (0.3 + 0.7 * next()))) : 0;
    const nx = tilt * Math.cos(azimuth), ny = tilt * Math.sin(azimuth);
    normal.set([byte(nx * .5 + .5), byte(ny * .5 + .5), byte(Math.sqrt(1 - tilt * tilt) * .5 + .5), 255], p * 4);
    surface.set([255, byte(0.2 + 0.3 * next()), byte(0.1 * next()), 255], p * 4);
  }
  const glossyAlpha = (x: number, y: number) => y >= 4 ? 128 : 0;
  const scene = new THREE.Scene();
  const stack = plateIn(scene);
  stack.setCanvases([maskCanvas(glossyAlpha), maskCanvas((x, y) => shimmerAlpha[y * SIZE + x]!)]);
  stack.updateLayer(0, { ...base, id: "glossy", finish: "glossy", optics: GAME });
  stack.updateLayer(1, { ...base, id: "shimmer", finish: "shimmer", optics: GAME }, { size: SIZE, normal, surface });
  stack.prepareBlend(renderer);
  if (stack.blendDiagnostics().plate.route !== "faceted") throw Error("The probe's stack is not the faceted route.");
  check("the stack's composite");

  // The export's bytes for the same texels (preset-compiler.ts `accumulate` and `encodeSurface`), then its chain.
  const glossy = flatSurface("glossy")!;
  let earlierLevel0 = 0;
  const diffuse = new Uint8Array(texels * 4), roughness = new Uint8Array(texels), metalness = new Uint8Array(texels), normals = new Uint8Array(texels * 2).fill(byte(.5));
  for (let p = 0; p < texels; p++) {
    const x = p % SIZE, y = Math.floor(p / SIZE);
    let r = 0, m = 0, c = 0, nx = 0, ny = 0, moment = 0;
    for (const layer of [{ a: glossyAlpha(x, y) / 255, r: glossy.roughness, m: glossy.metalness, nx: 0, ny: 0 },
      { a: shimmerAlpha[p]! / 255, r: surface[p * 4 + 1]! / 255, m: surface[p * 4 + 2]! / 255, nx: unorm(normal[p * 4]!), ny: unorm(normal[p * 4 + 1]!) }]) {
      if (!layer.a) continue;
      const keep = 1 - layer.a;
      r = layer.r * layer.a + r * keep; m = layer.m * layer.a + m * keep; c = layer.a + c * keep;
      nx = layer.nx * layer.a + nx * keep; ny = layer.ny * layer.a + ny * keep;
      moment = (layer.nx ** 2 + layer.ny ** 2) * layer.a + moment * keep;
    }
    // The earlier composite kept each layer's facet moment, so this texel's roughness was widened even at level 0 (PREV-57).
    if (p === FACET_TEXEL) earlierLevel0 = ((r / c) ** 4 + Math.max(0, moment / c - ((nx / c) ** 2 + (ny / c) ** 2))) ** 0.25;
    if (!c) continue;
    diffuse.set([128, 128, 128, byte(Math.sqrt(c))], p * 4);
    roughness[p] = byte(r / c); metalness[p] = byte(m / c);
    normals[p * 2] = byte(nx / c * .5 + .5); normals[p * 2 + 1] = byte(ny / c * .5 + .5);
  }
  const chain = facetedMipChain(diffuse, roughness, metalness, normals, SIZE);

  const compare = (textures: CompositeTextures, float: boolean, level: number): ChainComparison => {
    const scale = float ? 255 : 1, size = { width: SIZE, height: SIZE };
    const rough = readTextureLevel(renderer, textures.roughness, size, level, float).data;
    const merged = readTextureLevel(renderer, textures.normal, size, level, float).data;
    const cover = readTextureLevel(renderer, textures.colour, size, level, float).data;
    const n = Math.max(1, SIZE >> level) ** 2;
    let roughnessMaxError = 0, normalMaxError = 0, coverageMaxError = 0;
    for (let i = 0; i < n; i++) {
      roughnessMaxError = Math.max(roughnessMaxError, Math.abs(rough[i * 4]! * scale - chain.roughness[level]![i]!));
      for (let k = 0; k < 2; k++) normalMaxError = Math.max(normalMaxError, Math.abs(merged[i * 4 + k]! * scale - chain.normal[level]![i * 2 + k]!));
      // The colour map's alpha is √coverage.
      coverageMaxError = Math.max(coverageMaxError, Math.abs(Math.sqrt(Math.max(0, cover[i * 4 + 3]! * scale / 255)) * 255 - chain.diffuse[level]![i * 4 + 3]!));
    }
    return { level, roughnessMaxError, normalMaxError, coverageMaxError, texels: n };
  };
  const layers = stack.materials.slice();
  for (const precision of ["auto", "8-bit"] as const) {
    const composite = createPlateComposite(FULL_WINDOW, { precision });
    const textures = composite.update(renderer, layers, SIZE);
    if (precision === "auto") probe.halfFloat = composite.halfFloat;
    probe.chains.push({ precision: composite.halfFloat ? "half-float" : "8-bit", levels: [0, 2].map(level => compare(textures, composite.halfFloat, level)) });
    if (precision === "auto") {
      const at = FACET_TEXEL, level2 = (5 >> 2) * (SIZE >> 2) + (5 >> 2);
      probe.facet = { exportLevel0: chain.roughness[0]![at]! / 255, previewLevel0: readTextureLevel(renderer, textures.roughness, { width: SIZE, height: SIZE }, 0, true).data[at * 4]!,
        exportLevel2: chain.roughness[2]![level2]! / 255, previewLevel2: readTextureLevel(renderer, textures.roughness, { width: SIZE, height: SIZE }, 2, true).data[level2 * 4]!,
        earlierLevel0 };
    }
    composite.dispose();
    check(`the ${precision} chain`);
  }

  // 2. Mip generations per update with twelve layers: once the masks are uploaded, only the merged target's three.
  const many = plateIn(new THREE.Scene());
  const finishes = ["matte", "regular", "metallic", "glossy"] as const;
  many.setCanvases(Array.from({ length: 12 }, (_, i) => maskCanvas(() => 40 + 15 * i)));
  for (let i = 0; i < 12; i++) many.updateLayer(i, { ...base, id: `layer-${i}`, finish: finishes[i % 4]!, ...(finishes[i % 4] === "glossy" ? { optics: GAME } : {}) });
  many.prepareBlend(renderer);
  let generations = 0;
  const generate = gl.generateMipmap;
  gl.generateMipmap = function (target: GLenum) { generations++; return generate.call(this, target); };
  const drawsBefore = many.blendDiagnostics().plate.compositeDraws;
  many.contextRestored(); // marks the blend dirty, as an edit does
  many.prepareBlend(renderer);
  gl.generateMipmap = generate;
  const drawsAfter = many.blendDiagnostics().plate.compositeDraws;
  probe.mips = { layers: many.blendDiagnostics().plate.slots.length, perUpdate: generations,
    draws: { layerDraws: drawsAfter.layerDraws - drawsBefore.layerDraws, resolves: drawsAfter.resolves - drawsBefore.resolves, levelDraws: drawsAfter.levelDraws - drawsBefore.levelDraws } };
  many.setCanvases([]);
  check("twelve layers");

  // 3. The environment fallback: the room's harmonics recomputed, and a white matte quad lit by each form of the room alone.
  const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 100, cube).update(renderer, new RoomEnvironment());
  const sh = (await LightProbeGenerator.fromCubeRenderTarget(renderer, cube)).sh.coefficients.map(v => v.x);
  cube.dispose();
  probe.environment.shMaxError = Math.max(...sh.map((value, i) => Math.abs(value - ROOM_ENVIRONMENT_SH[i]!)));
  const target = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true });
  const renderLinear = (scene: THREE.Scene, x = 32) => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixel = new Float32Array(4);
    gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.FLOAT, pixel);
    renderer.setRenderTarget(null);
    return [...pixel.slice(0, 3)];
  };
  const white = () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  const prefiltered = new THREE.Scene();
  prefiltered.add(white());
  createStudioEnvironment(renderer, prefiltered);
  const lightProbe = new THREE.Scene();
  lightProbe.add(white());
  const light = new THREE.LightProbe();
  light.sh.coefficients.forEach((coefficient, i) => coefficient.setScalar(ROOM_ENVIRONMENT_SH[i]!));
  lightProbe.add(light);
  probe.environment.pmrem = renderLinear(prefiltered);
  probe.environment.probe = renderLinear(lightProbe);
  check("the environment");

  // 4. Lost and restored context: black Matte at 75 % over the left half of a matte skin quad lit by the studio environment.
  const lit = new THREE.Scene();
  const skinQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ color: 0xc89a82, roughness: 0.6 }));
  lit.add(skinQuad);
  const environment = createStudioEnvironment(renderer, lit);
  const plate = plateIn(lit);
  plate.setCanvases([maskCanvas(x => x < SIZE / 2 ? 191 : 0)]);
  plate.updateLayer(0, { ...base, id: "black", color: "#000000", finish: "matte" });
  const measure = () => { plate.prepareBlend(renderer); return { plate: renderLinear(lit, 16), skin: renderLinear(lit, 48) }; };
  probe.restore.before = measure();
  check("the lit plate");
  // A layered part: a one-layer gold-ish stack of constant maps, baked, lit by one light on its own quad.
  const constant = (rgba: number[]) => { const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1); t.needsUpdate = true; return t; };
  const goldLayer: RenderLayer = { template: null, opacity: 1, matTile: 1, tilingMultiplier: 1, offsetU: 0, offsetV: 0, mbTile: 1, microblendContrast: 1,
    microblendNormalStrength: 0, microblendOffsetU: 0, microblendOffsetV: 0, colorScale: [1, 0.8, 0.4], normalStrength: 0, roughLevelsIn: [1, 0], roughLevelsOut: [1, 0],
    metalLevelsIn: [1, 0], metalLevelsOut: [1, 0], colorMaskLevelsIn: [1, 0], colorMaskLevelsOut: [0, 0],
    names: { colorScale: "", normalStrength: "", roughLevelsIn: "", roughLevelsOut: "", metalLevelsIn: "", metalLevelsOut: "" }, textures: {} };
  const part = createLayeredMaterial({ layers: [{ parameters: layerBakeParameters(goldLayer, 0), textures: { color: constant([230, 230, 230, 255]),
    roughness: constant([140, 140, 140, 255]), metalness: constant([0, 0, 0, 255]) } }], domain: { min: [0, 0], max: [1, 1] }, size: 8,
    globals: { ratio: 1, normalIntensity: 1, normalUvScale: [1, 1], normalUvBias: [0, 0] } });
  const partScene = new THREE.Scene();
  partScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), part.material));
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(0, 0, 1); partScene.add(key);
  part.handle.bake(renderer);
  probe.layered.states.push(part.handle.state);
  probe.layered.before = renderLinear(partScene, 32);
  check("the baked layered part");
  const lose = gl.getExtension("WEBGL_lose_context")!;
  // Resolved a task after the event, once its dispatch (and the browser's bookkeeping after it) has finished.
  const event = (name: string) => new Promise<void>(resolve => canvas.addEventListener(name, () => setTimeout(resolve, 0), { once: true }));
  const lost = event("webglcontextlost");
  lose.loseContext();
  await lost;
  const restored = event("webglcontextrestored");
  lose.restoreContext();
  await restored;
  gl.getError(); // Clears CONTEXT_LOST_WEBGL, which the loss itself reports once.
  probe.restore.unhooked = measure();
  check("drawing without the restore hooks");
  // The layered part still says baked, but its maps died with the context.
  probe.layered.states.push(part.handle.state);
  probe.layered.unhooked = renderLinear(partScene, 32);
  check("drawing the layered part without the restore path");
  // The scene's restore path (scene.ts `restored`): forget the renderer's shared bakes, reset each handle, bake again.
  layeredContextRestored(renderer);
  part.handle.contextRestored();
  probe.layered.states.push(part.handle.state);
  part.handle.bake(renderer);
  probe.layered.states.push(part.handle.state);
  probe.layered.hooked = renderLinear(partScene, 32);
  check("the re-baked layered part");
  environment.restore();
  check("the environment's restore");
  plate.contextRestored();
  probe.restore.hooked = measure();
  check("the restored context");
  // Not disposed: Three.js's dispose listener from before the loss would delete the lost context's objects (a harmless error).
  probe.ok = true;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: PlateCompositeProbe }).probe = probe;
