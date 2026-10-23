import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as THREE from "three";
import { headSurface, RECORDED_GL, recordingRenderer } from "./fixtures/recording-gl";
import { LATER_FRAG_DATA, LATER_OUTPUT, multipleOutputs, stripComments } from "./fixtures/single-output";
import { createSkinMaterial, skinParameters, contactShadowUniforms } from "../src/materials/render/skin-material";
import { createSkinScatter } from "../src/platform/scene/skin-scatter";
import { createContactShadows, setContactShadows } from "../src/platform/scene/contact-shadow";
import { createLinearDisplay } from "../src/preview/render/linear-display";
import { createPlateComposite } from "../src/engines/layered-makeup/render/plate-composite";
import { createLayeredMaterial, layerBakeParameters } from "../src/materials/render/layered-material";
import type { RenderLayer } from "../src/character/render-detail";

/**
 * Every program the Studio draws writes one output, into a target with one colour attachment (profiles phase 4a-v-c, experiment 043 §12).
 * ANGLE on Direct3D 11 links a program for its first output only and builds one that writes several again at its first draw, on the GPU
 * process's main thread, presenting no frame meanwhile: 1–6 s for a skin scatter variant on real data. A pass that needs several targets
 * draws once per target instead (skin-scatter.ts, layered-material.ts, plate-composite.ts).
 *
 * Two checks (Sol's review of 4a-v-c found the first one's line-by-line scan blind to a multiline `layout` and to options passed in a
 * variable):
 *
 * - **What the renderer builds and binds.** The passes that once drew to several targets (the skin scatter's input, the makeup composite, the
 *   layered bake) and the frame's other targets (contact shadows, the scene-linear display) are drawn by a real Three renderer over a
 *   recording context (tests/fixtures/recording-gl.ts). Every fragment shader it assembles declares one output at location 0, every
 *   framebuffer gets colour attachment 0 only, and no draw-buffer list names two. The T2 probe (`tests/webgl-scene-runtimes.test.ts`) holds
 *   the same rule over a whole runtime's life on a real GPU.
 * - **The source, as a tripwire** for passes the first check doesn't draw: no shader text declares an output past location 0, wherever its
 *   lines break, and no module that makes a render target passes a `count` option to anything.
 */

/** What the source scan finds in one module's text. */
function sourceIssues(name: string, text: string): string[] {
  const code = stripComments(text), found: string[] = [];
  if (LATER_OUTPUT.test(code) || LATER_FRAG_DATA.test(code)) found.push(`${name}: a second output`);
  if (/WebGLMultipleRenderTargets|\bdrawBuffers\s*\(/.test(code)) found.push(`${name}: several draw buffers`);
  // A module that makes a render target passes no `count` (inline, or in an options object made elsewhere in it) and adds no textures.
  if (/RenderTarget\s*\(/.test(code) && (/[{,]\s*count\s*:/.test(code) || /\.textures\s*(?:\.push\s*\(|\[\s*[1-9])/.test(code)))
    found.push(`${name}: a render target with several colour attachments`);
  return found;
}

const SRC = resolve(import.meta.dir, "../src");
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);

const map = () => { const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1); texture.needsUpdate = true; return texture; };
const layer = (): RenderLayer => ({ template: null, opacity: 1, matTile: 1, tilingMultiplier: 1, offsetU: 0, offsetV: 0, mbTile: 1, microblendContrast: 1,
  microblendNormalStrength: 0, microblendOffsetU: 0, microblendOffsetV: 0, colorScale: [1, 1, 1], normalStrength: 1, roughLevelsIn: [1, 0], roughLevelsOut: [1, 0],
  metalLevelsIn: [1, 0], metalLevelsOut: [1, 0], colorMaskLevelsIn: [1, 0], colorMaskLevelsOut: [0, 0],
  names: { colorScale: "null_null", normalStrength: "null", roughLevelsIn: "null", roughLevelsOut: "null", metalLevelsIn: "null", metalLevelsOut: "null" },
  textures: {} });

test("what the renderer builds and binds for the passes that once wrote several targets, and the frame's other targets, writes one output into one attachment", () => {
  const recording = recordingRenderer(), { renderer, scene, camera } = recording;
  // The V's skin, drawn into the skin scatter's three input targets and its two blur targets.
  const head = headSurface(), textures = { albedo: map(), normal: map(), roughness: map(), detailNormal: map(), microDetail: map(), tintMask: map(), secondary: map() };
  head.material = createSkinMaterial(textures, skinParameters({ scalars: {}, colours: {}, skinProfiles: {} })).material;
  head.castShadow = true;
  scene.add(head.parent!);
  camera.position.set(0, 0, 2); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const scatter = createSkinScatter(renderer);
  expect(scatter.prepare(scene, true)).toBe(true);
  expect(scatter.render(scene, camera)).not.toBeNull();
  // The contact shadows' depth prepass, for a light flagged as the game flags its character lights (without one it draws nothing), and the
  // scene-linear display under both rigs.
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(1, 1, 2);
  setContactShadows(key, true);
  scene.add(key);
  const contact = createContactShadows(renderer, contactShadowUniforms);
  const before = { shaders: recording.shaders.length, attachments: recording.attachments.length };
  expect(contact.prepare(scene, camera)).toBe(true);
  expect(contact.evidence().lights).toBe(1);
  // The prepass built its caster depth program and bound its target (one colour attachment and its depth texture).
  const contactShaders = recording.shaders.slice(before.shaders), contactAttachments = recording.attachments.slice(before.attachments);
  expect(contactShaders.some(shader => shader.stage === "fragment")).toBe(true);
  expect(contactAttachments.map(item => item.attachment)).toEqual(expect.arrayContaining([RECORDED_GL.COLOR_ATTACHMENT0, RECORDED_GL.DEPTH_ATTACHMENT]));
  expect(multipleOutputs(contactShaders, contactAttachments, recording.drawBuffers)).toEqual([]);
  const display = createLinearDisplay(renderer);
  display.render(scene, camera, "creator");
  display.render(scene, camera, "studio");
  // The makeup composite: two layers into its accumulation, merged and roughness targets.
  const composite = createPlateComposite({ u0: 0, v0: 0, u1: 1, v1: 1 });
  composite.update(renderer, [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()], 8);
  // The layered bake (piercings, eyes): its accumulation and kept maps.
  const layered = createLayeredMaterial({ layers: [{ parameters: layerBakeParameters(layer(), 0), textures: {} }], domain: { min: [0, 0], max: [1, 1] },
    size: 8, globals: { ratio: 1, normalIntensity: 1, normalUvScale: [1, 1], normalUvBias: [0, 0] } });
  expect(layered.handle.bake(renderer)).toBe(true);
  // Each of them built programs and bound targets here, so the rule below was checked against something.
  const fragments = recording.shaders.filter(shader => shader.stage === "fragment");
  for (const name of ["xfs-skin-scatter-blur", "xfs-creator-display", "xfs-studio-display"])
    expect(fragments.some(shader => shader.source.includes(name)), name).toBe(true);
  expect(fragments.filter(shader => shader.source.includes("xfsScatterWrite(")).length).toBeGreaterThanOrEqual(3);
  expect(composite.stats.layerDraws).toBe(2);
  expect(recording.attachments.filter(item => item.attachment === RECORDED_GL.COLOR_ATTACHMENT0).length).toBeGreaterThanOrEqual(12);
  expect(multipleOutputs(recording.shaders, recording.attachments, recording.drawBuffers)).toEqual([]);
  composite.release(); scatter.dispose?.(); display.dispose(); contact.dispose?.();
});

test("the recorded check finds a multiline second output, and a target whose count comes through a separate options object", () => {
  const recording = recordingRenderer(), { renderer } = recording;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(quad);
  // A second output whose declaration breaks over lines.
  quad.material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
    fragmentShader: "layout(location = 0) out highp vec4 first;\nlayout(\n  location = 1\n) out highp vec4 second;\nvoid main() { first = vec4(1.0); second = vec4(0.0); }" });
  renderer.render(scene, camera);
  expect(multipleOutputs(recording.shaders, [], [])).toEqual(expect.arrayContaining([expect.stringContaining("an output past location 0"), expect.stringContaining("2 outputs")]));
  // A target given its colour attachments through an options object made beforehand.
  const options = { count: 3, depthBuffer: false };
  const target = new THREE.WebGLRenderTarget(4, 4, options);
  quad.material = new THREE.MeshBasicMaterial();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  expect(multipleOutputs([], recording.attachments, recording.drawBuffers)).toEqual(expect.arrayContaining(["framebufferTexture2D: colour attachment 1",
    "framebufferTexture2D: colour attachment 2", "drawBuffers: 3 buffers"]));
  target.dispose();
});

test("no source declares an output past location 0 or makes a render target with several colour attachments", () => {
  const found = sources(SRC).flatMap(file => sourceIssues(relative(SRC, file).replaceAll("\\", "/"), readFileSync(file, "utf8")));
  expect(found).toEqual([]);
});

test("the source scan finds both bypasses its first form missed: a multiline `layout`, and `count` in an options object made beforehand", () => {
  expect(sourceIssues("a.ts", "const f = `layout(\n  location = 2\n) out highp vec4 x;`;")).toEqual(["a.ts: a second output"]);
  expect(sourceIssues("b.ts", "const options = { count: 3 };\nconst t = new THREE.WebGLRenderTarget(w, h, options);"))
    .toEqual(["b.ts: a render target with several colour attachments"]);
  expect(sourceIssues("c.ts", "const t = new THREE.WebGLRenderTarget(w, h, { ...base, count: 2 });")).toEqual(["c.ts: a render target with several colour attachments"]);
  // A comment saying so is not a declaration; a single output and a one-attachment target pass.
  expect(sourceIssues("d.ts", "// layout(location = 1) out\nconst f = `layout(location = 0) out highp vec4 x;`;\nconst t = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });"))
    .toEqual([]);
});
