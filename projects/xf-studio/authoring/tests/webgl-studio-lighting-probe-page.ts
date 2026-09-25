/**
 * Browser page for tests/webgl-studio-lighting.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context).
 * The studio rig (studio-light-rig.ts) lighting a head-sized sphere seen from the front, as the Studio frames the head:
 * 1. A Metallic makeup plate over the whole sphere, through the makeup stack's single lit pass (plate-blend.ts), lit with the
 *    standard light and with the skin's own light, and a plain glossy metal sphere as a control. For each, the brightest pixel's
 *    position under the key alone at several azimuths and elevations, and its value at two key strengths.
 * 2. The ambient term: the matte skin and the plate under the room environment alone, at two environment strengths.
 * Everything is read scene-linear (half float, or 8-bit linear without it). With `?hide=half-float` the environment is the room's
 * light probe (PREV-59). Results land in `window.probe` as plain data. Nothing here reads game files.
 */
import * as THREE from "three";
import { createMakeupStack, type PlateUnderlay } from "../src/makeup-stack";
import { initialRecipe, type Layer } from "../src/recipe";
import { skinParameters } from "../src/skin-material";
import { createStudioLightRig } from "../src/studio-light-rig";
import { DEFAULT_STUDIO_LIGHTS, STUDIO_LIGHT_TARGET, type StudioLights } from "../src/studio-lighting";
import { hideHalfFloatRendering } from "./webgl-harness-page";

export type Highlight = { x: number; y: number; peak: number };
export type SurfaceProbe = { azimuth: Record<string, Highlight>; elevation: Record<string, Highlight>; strength: { single: number; double: number } };
export type StudioLightingProbe = {
  ok: boolean; failure?: string; errors: string[]; renderer: string; environment: string; float: boolean;
  surfaces: Record<"plate" | "plateSkinLight" | "metal", SurfaceProbe>;
  ambient: Record<"skin" | "plate", { full: number; half: number; none: number }>;
};
const probe: StudioLightingProbe = { ok: false, errors: [], renderer: "", environment: "", float: false,
  surfaces: {} as StudioLightingProbe["surfaces"], ambient: {} as StudioLightingProbe["ambient"] };
const SIZE = 64;

try {
  if (new URLSearchParams(location.search).get("hide") === "half-float") hideHalfFloatRendering();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false, preserveDrawingBuffer: true })!;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const scene = new THREE.Scene();
  const rig = createStudioLightRig(renderer, scene);
  probe.environment = rig.environment.mode;
  probe.float = rig.environment.mode === "pmrem";
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, probe.float ? { type: THREE.HalfFloatType, depthBuffer: true }
    : { type: THREE.UnsignedByteType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true });

  // The head's centre, seen from the front (−Z) as the Studio's Front view does, filling most of the frame.
  const centre = new THREE.Vector3(...STUDIO_LIGHT_TARGET);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  camera.position.copy(centre).add(new THREE.Vector3(0, 0, -0.45));
  camera.lookAt(centre);

  // A skinned sphere: the plate's anchor, drawn as matte skin under it.
  const geometry = new THREE.SphereGeometry(0.1, 96, 64);
  geometry.translate(centre.x, centre.y, centre.z);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
  const skinMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  skinMaterial.color.setRGB(0.4, 0.4, 0.4, THREE.LinearSRGBColorSpace);
  const bone = new THREE.Bone(), anchor = new THREE.SkinnedMesh(geometry, skinMaterial);
  scene.add(bone, anchor);
  anchor.bind(new THREE.Skeleton([bone]));
  const stack = createMakeupStack(anchor, 1);
  const fill = (value: number, size: number) => new THREE.BufferAttribute(new Float32Array(count * size).fill(value), size);
  const underlay = (): PlateUnderlay => ({ colour: fill(0.4, 3), roughness: fill(0.9, 1), metalness: fill(0, 1) });
  stack.setUnderlaySource(underlay);
  const mask = document.createElement("canvas");
  mask.width = mask.height = 4;
  mask.getContext("2d")!.fillStyle = "#ffffff";
  mask.getContext("2d")!.fillRect(0, 0, 4, 4);
  const metallic: Layer = { ...initialRecipe().layers[0]!, id: "probe-metallic", enabled: true, color: "#c8c8c8", finish: "metallic", opacity: 1 };
  const showPlate = (on: boolean) => {
    if (on) { stack.setCanvases([mask]); stack.updateLayer(0, metallic); } else stack.setCanvases([]);
  };
  // The control: a plain glossy metal sphere in the same place.
  const metal = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.25, metalness: 1 }));
  metal.visible = false;
  scene.add(metal);

  const pixels = new (probe.float ? Float32Array : Uint8Array)(SIZE * SIZE * 4);
  const render = () => {
    stack.prepareBlend(renderer);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, probe.float ? gl.FLOAT : gl.UNSIGNED_BYTE, pixels);
    renderer.setRenderTarget(null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) probe.errors.push(`WebGL error ${error}`);
  };
  const scale = probe.float ? 1 : 1 / 255;
  const luminance = (i: number) => (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) * scale;
  /** The brightest pixel (x from the left, y from the bottom) and its linear luminance. */
  const highlight = (): Highlight => {
    let best = { x: 0, y: 0, peak: -1 };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const value = luminance((y * SIZE + x) * 4);
      if (value > best.peak) best = { x, y, peak: value };
    }
    return best;
  };
  const centreLuminance = () => {
    let sum = 0;
    for (let y = SIZE / 2 - 2; y < SIZE / 2 + 2; y++) for (let x = SIZE / 2 - 2; x < SIZE / 2 + 2; x++) sum += luminance((y * SIZE + x) * 4);
    return sum / 16;
  };
  const light = (lights: Partial<StudioLights>, azimuth: number) => { rig.setLights({ ...DEFAULT_STUDIO_LIGHTS, ...lights }); rig.setKeyAngle(azimuth); };
  // The key alone: no room, fill or rim.
  const keyOnly = (azimuth: number, elevation: number, key = 1) => { light({ environment: 0, fill: 0, rim: 0, key, elevation }, azimuth); render(); return highlight(); };
  const surface = (): SurfaceProbe => ({
    azimuth: Object.fromEntries([300, 330, 0, 30, 60].map(azimuth => [String(azimuth), keyOnly(azimuth, 20)])),
    elevation: Object.fromEntries([-20, 0, 20, 45, 70].map(elevation => [String(elevation), keyOnly(0, elevation)])),
    strength: { single: keyOnly(330, 20, 1).peak, double: keyOnly(330, 20, 2).peak },
  });
  const skin = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
  showPlate(true);
  stack.setSkinLight(null);
  probe.surfaces.plate = surface();
  stack.setSkinLight(skin);
  probe.surfaces.plateSkinLight = surface();
  stack.setSkinLight(null);
  showPlate(false);
  anchor.visible = false; metal.visible = true;
  probe.surfaces.metal = surface();
  metal.visible = false; anchor.visible = true;

  // The room alone at full, half and no strength.
  const ambient = () => Object.fromEntries(([["full", 1], ["half", 0.5], ["none", 0]] as const).map(([name, environment]) => {
    light({ environment, key: 0, fill: 0, rim: 0 }, 0); render(); return [name, centreLuminance()];
  })) as { full: number; half: number; none: number };
  probe.ambient.skin = ambient();
  showPlate(true);
  probe.ambient.plate = ambient();
  probe.ok = true;
} catch (error) {
  probe.failure = (error as Error).stack ?? String(error);
}
(window as unknown as { probe?: StudioLightingProbe }).probe = probe;
