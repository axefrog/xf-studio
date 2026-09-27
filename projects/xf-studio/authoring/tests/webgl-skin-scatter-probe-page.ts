/**
 * Browser page for tests/webgl-skin-scatter.test.ts (bundled there, run in headless Chrome with a real WebGL 2 context): the skin scatter's
 * GPU passes (platform/scene/skin-scatter.ts) on a synthetic scene, against the CPU reference of the same passes
 * (skin-scatter-kernel.ts `referenceScatter`) run on the GPU's own input targets.
 *
 * The scene, seen by a perspective camera 0.3 m away: a skin strip folded at a vertical crease, its left face turned toward a
 * directional light and its right face away from it (a hard terminator); a Standard quad in front of part of the unlit face (an
 * occluder, class 0); and a Metallic face decal lit as skin across the crease in a horizontal band (metalness 1 over the skin).
 * Results land in `window.probe` as plain numbers. Nothing here reads game files.
 */
import * as THREE from "three";
import { createFaceDecalMaterial, faceDecalParameters } from "../src/face-decal-material";
import { createSkinMaterial, skinParameters } from "../src/skin-material";
import { passParticipation } from "../src/platform/api/scene";
import { createSkinScatter } from "../src/platform/scene/skin-scatter";
import { referenceScatter, scatterSlot, type ScatterQuality } from "../src/platform/scene/skin-scatter-kernel";
import { createLinearDisplay } from "../src/linear-display";
import { readTextureLevel } from "./webgl-harness-page";

export type ScatterProbe = {
  ok: boolean; errors: string[]; failure?: string; renderer: string;
  /** Largest |GPU Δ − reference Δ| over the frame, and the largest |Δ| (for scale). */
  parity: { maxGap: number; maxDelta: number; pixels: number };
  /** Occluder pixels (from an independent mask render), how many carry class 1 or any Δ, and Δ on the unlit skin beside the occluder. */
  bleed: { occluderPixels: number; classed: number; scattered: number; outsideClass: number; besideOccluder: number };
  /** The Metallic decal band: pixels, how many carry Δ, its S1 colour and alphas, and the skin's S1 alpha elsewhere. */
  metal: { pixels: number; scattered: number; s1: number[]; s0Alpha: number; skinSlotByte: number };
  /** Δ just past the terminator on the unlit face (red, green, blue), and Δ over albedo 8 px past it (how much of each channel reaches that far). */
  spread: { first: number[]; far: number[] };
  /** The wrap gate while the scatter runs and after it is switched off; every mesh's material after the pass. */
  gates: { active: number; off: number; restored: boolean };
  /** Sum of |Δ(low) − Δ(high)| over the frame. */
  qualityDifference: number;
  /** The creator display with and without Δ: the largest byte difference on the lit face and on the unlit face near the crease. */
  display: { lit: number; unlit: number };
};
const probe: ScatterProbe = { ok: false, errors: [], renderer: "", parity: { maxGap: 0, maxDelta: 0, pixels: 0 },
  bleed: { occluderPixels: 0, classed: 0, scattered: 0, outsideClass: 0, besideOccluder: 0 }, metal: { pixels: 0, scattered: 0, s1: [], s0Alpha: 0, skinSlotByte: 0 },
  spread: { first: [], far: [] }, gates: { active: -1, off: -1, restored: false }, qualityDifference: 0, display: { lit: 0, unlit: 0 } };
(window as unknown as { probe?: ScatterProbe }).probe = undefined;

const W = 256, H = 128;
function texture(rgba: number[], colour = false) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
/** A strip folded at x = 0: the left face (x from −0.03 to 0) turned toward −x, the right face (0 to 0.03) toward +x; y within ±`half`. */
function foldGeometry(half: number, lift = 0) {
  const left = new THREE.Vector3(-0.5, 0, 1).normalize(), right = new THREE.Vector3(0.8, 0, 0.6).normalize();
  // Each face lies in the plane through the crease with its normal; a point at x along the face has z = −x·n.x/n.z.
  const at = (x: number, normal: THREE.Vector3) => new THREE.Vector3(x, 0, -x * normal.x / normal.z).addScaledVector(normal, lift);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const face = (x0: number, x1: number, normal: THREE.Vector3) => {
    const a = at(x0, normal), b = at(x1, normal);
    const corners = [[a, -half], [b, -half], [b, half], [a, -half], [b, half], [a, half]] as const;
    for (const [point, y] of corners) { positions.push(point.x, y, point.z); normals.push(normal.x, normal.y, normal.z); uvs.push((point.x + 0.03) / 0.06, y / (2 * half) + 0.5); }
  };
  face(-0.03, 0, left); face(0, 0.03, right);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

try {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  document.body.append(canvas);
  const context = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })!;
  const info = context.getExtension("WEBGL_debug_renderer_info");
  probe.renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    probe.errors.push(`${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(vertex) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`.trim() || "shader error");
  };
  // A narrow lens (focal about 1220 px), so the kernel spans about 17 px at 0.3 m.
  const camera = new THREE.PerspectiveCamera(6, W / H, 0.05, 2);
  camera.position.set(0, 0, 0.3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-1, 0, 1);
  scene.add(light);
  const flat = () => texture([128, 128, 255, 255]);
  const skinParams = skinParameters({ scalars: {}, colours: {}, skinProfiles: {} });
  const skin = createSkinMaterial({ albedo: texture([200, 150, 120, 255], true), normal: flat(), roughness: texture([160, 0, 0, 255]),
    detailNormal: flat(), microDetail: flat(), tintMask: texture([0, 0, 0, 255]), secondary: texture([0, 0, 0, 0]) }, skinParams).material;
  const strip = new THREE.Mesh(foldGeometry(0.016), skin);
  scene.add(strip);
  // The occluder: a Standard quad in front of the unlit face, x from 0.003 to 0.03 (all y).
  const occluderGeometry = new THREE.PlaneGeometry(0.027, 0.04);
  occluderGeometry.translate(0.0165, 0, 0.005);
  const occluder = new THREE.Mesh(occluderGeometry, new THREE.MeshStandardMaterial({ color: 0x808080 }));
  scene.add(occluder);
  // The Metallic decal: the fold's shape in a band (y from −0.012 to −0.008), lit as skin, metalness 1 at full surface alpha.
  const bandGeometry = foldGeometry(0.002, 0.0004);
  bandGeometry.translate(0, -0.01, 0);
  const decal = createFaceDecalMaterial({ diffuse: texture([255, 255, 255, 255], true), secondaryMask: texture([255, 255, 255, 255]), normal: flat(),
    normalAlpha: texture([255, 255, 255, 255]), roughness: texture([255, 255, 255, 255]), metalness: texture([0, 0, 0, 255]) },
    faceDecalParameters("mesh-decal", { DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1, MetalnessBias: 1, RoughnessScale: 0.4 }, { DiffuseColor: [40, 80, 200, 255] }),
    { underlay: false, skinLight: skinParams }).material;
  decal.polygonOffset = true; decal.polygonOffsetFactor = -1; decal.polygonOffsetUnits = -4;
  const band = new THREE.Mesh(bandGeometry, decal);
  band.renderOrder = 2;
  scene.add(band);
  scene.updateMatrixWorld(true);

  const scatter = createSkinScatter(renderer);
  const run = (quality: ScatterQuality) => {
    scatter.setQuality(quality);
    if (!scatter.prepare(scene, true)) throw Error("the scatter did not run");
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const delta = scatter.render(scene, camera);
    if (!delta) throw Error("no delta");
    const targets = scatter.targets()!;
    return {
      s0: readTextureLevel(renderer, targets.s0, { width: W, height: H }, 0, true).data as Float32Array,
      s1: readTextureLevel(renderer, targets.s1, { width: W, height: H }, 0, false).data as Uint8Array,
      s2: readTextureLevel(renderer, targets.s2, { width: W, height: H }, 0, false).data as Uint8Array,
      delta: readTextureLevel(renderer, delta, { width: W, height: H }, 0, true).data as Float32Array,
    };
  };
  const materialsBefore = [strip.material, occluder.material, band.material];
  const high = run("high");
  probe.gates.active = passParticipation(skin)!.wrapGate!.value;
  probe.gates.restored = [strip.material, occluder.material, band.material].every((m, i) => m === materialsBefore[i]);

  // Parity: the CPU reference on the GPU's own inputs.
  const n = W * H, irradiance = new Float32Array(n * 3), albedo = new Float32Array(n * 3), classOne = new Uint8Array(n), depth = new Float32Array(n),
    metalness = new Float32Array(n), slot = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    for (let k = 0; k < 3; k++) { irradiance[p * 3 + k] = high.s0[p * 4 + k]!; albedo[p * 3 + k] = (high.s1[p * 4 + k]! / 255) ** 2; }
    classOne[p] = high.s0[p * 4 + 3]! > 0 ? 1 : 0; depth[p] = high.s0[p * 4 + 3]!; metalness[p] = high.s2[p * 4]! / 255;
    slot[p] = Math.max(0, Math.round(high.s1[p * 4 + 3]! / 255 * 8) - 1);
  }
  const focalPixels = camera.projectionMatrix.elements[5]! * H / 2;
  const reference = referenceScatter({ width: W, height: H, irradiance, albedo, classOne, depth, metalness, slot,
    slots: [scatterSlot(skinParams.scatter, "high")], focalPixels });
  for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) {
    const gpu = high.delta[p * 4 + k]!;
    probe.parity.maxGap = Math.max(probe.parity.maxGap, Math.abs(gpu - reference[p * 3 + k]!));
    probe.parity.maxDelta = Math.max(probe.parity.maxDelta, Math.abs(gpu));
  }
  probe.parity.pixels = classOne.reduce((sum, v) => sum + v, 0);

  // No bleed: an independent mask of the occluder (drawn alone, white on black), then Δ there.
  const maskTarget = new THREE.WebGLRenderTarget(W, H);
  const maskScene = new THREE.Scene();
  maskScene.add(new THREE.Mesh(occluderGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  renderer.setRenderTarget(maskTarget); renderer.setClearColor(0, 1); renderer.clear(); renderer.render(maskScene, camera); renderer.setRenderTarget(null);
  const mask = readTextureLevel(renderer, maskTarget.texture, { width: W, height: H }, 0, false).data as Uint8Array;
  const hasDelta = (p: number) => [0, 1, 2].some(k => high.delta[p * 4 + k] !== 0);
  let leftmostOccluder = W;
  for (let p = 0; p < n; p++) {
    if (!classOne[p] && hasDelta(p)) probe.bleed.outsideClass++;
    if (mask[p * 4]! < 128) continue;
    probe.bleed.occluderPixels++;
    if (classOne[p]) probe.bleed.classed++;
    if (hasDelta(p)) probe.bleed.scattered++;
    leftmostOccluder = Math.min(leftmostOccluder, p % W);
  }
  // Unlit skin in the two columns left of the occluder, away from the band (upper rows): Δ there shows the scatter reached the occluder's edge.
  for (let y = H - 30; y < H - 10; y++) for (const x of [leftmostOccluder - 2, leftmostOccluder - 1]) probe.bleed.besideOccluder = Math.max(probe.bleed.besideOccluder, high.delta[(y * W + x) * 4]!);

  // The Metallic band: S2 above 0.1 gates Δ off; its colour replaced S1, class and slot stayed the skin's.
  let s1Sum = [0, 0, 0, 0], s0Alpha = 0;
  for (let p = 0; p < n; p++) {
    if (high.s2[p * 4]! <= 0.1 * 255) continue;
    probe.metal.pixels++;
    if (hasDelta(p)) probe.metal.scattered++;
    s1Sum = s1Sum.map((v, k) => v + high.s1[p * 4 + k]!);
    s0Alpha = Math.max(s0Alpha, high.s0[p * 4 + 3]!);
  }
  probe.metal.s1 = s1Sum.map(v => v / Math.max(1, probe.metal.pixels));
  probe.metal.s0Alpha = s0Alpha;
  probe.metal.skinSlotByte = high.s1[((H - 20) * W + W / 4) * 4 + 3]!;

  // Spread on an upper row: the crease is where S0 red drops to zero; Δ just past it and how far each channel reaches.
  const row = H - 20;
  let crease = -1;
  for (let x = 1; x < W; x++) { const p = row * W + x; if (classOne[p] && classOne[p - 1] && high.s0[(p - 1) * 4]! > 0 && high.s0[p * 4] === 0) { crease = x; break; } }
  if (crease < 0) throw Error("no terminator found");
  probe.spread.first = [0, 1, 2].map(k => high.delta[(row * W + crease) * 4 + k]!);
  probe.spread.far = [0, 1, 2].map(k => high.delta[(row * W + crease + 8) * 4 + k]! / albedo[(row * W + crease + 8) * 3 + k]!);

  const low = run("low");
  for (let i = 0; i < n * 4; i++) probe.qualityDifference += Math.abs(low.delta[i]! - high.delta[i]!);

  // The creator display with and without Δ (neutral grade), read from the canvas.
  const display = createLinearDisplay(renderer);
  display.setExposure(1);
  const canvasPixels = () => { const out = new Uint8Array(W * H * 4); const gl = renderer.getContext(); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out); return out; };
  scatter.setQuality("high");
  scatter.prepare(scene, true);
  display.render(scene, camera, "creator", () => scatter.render(scene, camera));
  const withScatter = canvasPixels();
  scatter.setEnabled(false);
  scatter.prepare(scene, true);
  probe.gates.off = passParticipation(skin)!.wrapGate!.value;
  // With the scatter off the wrap comes back; hold it at zero for this comparison, so only Δ differs.
  passParticipation(skin)!.wrapGate!.value = 0;
  display.render(scene, camera, "creator");
  const without = canvasPixels();
  for (let x = 0; x < W; x++) {
    const p = row * W + x, diff = Math.max(...[0, 1, 2].map(k => Math.abs(withScatter[p * 4 + k]! - without[p * 4 + k]!)));
    if (x < crease - 20 && classOne[p]) probe.display.lit = Math.max(probe.display.lit, diff);
    if (x >= crease && x < crease + 6) probe.display.unlit = Math.max(probe.display.unlit, diff);
  }
  const gl = renderer.getContext();
  const glError = gl.getError();
  if (glError !== gl.NO_ERROR) probe.errors.push(`WebGL error ${glError}`);
  probe.ok = true;
} catch (error) {
  probe.failure = String((error as Error)?.stack ?? error);
}
(window as unknown as { probe?: ScatterProbe }).probe = probe;
