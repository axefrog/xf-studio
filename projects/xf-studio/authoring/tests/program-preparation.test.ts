import { expect, test, spyOn } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { headSurface, recordingRenderer } from "./fixtures/recording-gl";
import { createSkinMaterial, skinParameters } from "../src/materials/render/skin-material";
import { extendSkin, fullSkinDepthMaterial } from "../src/materials/render/skin";
import { createSkinScatter } from "../src/platform/scene/skin-scatter";
import { traceProgramPreparation, type ProgramPreparationEntry } from "../src/materials/render/linked-programs";
import { createLightingSetupStage } from "../src/preview/render/lighting-setup-stage";
import { tempDir } from "./temp-dir";

// Exercise the exact committed dependency patch without writing to the shared node_modules junction.
const patch = readFileSync(resolve(import.meta.dir, "../patches/three@0.186.0.patch"), "utf8");
const hunks: { before: string; after: string }[] = [];
for (const line of patch.split("\n")) {
  if (line.startsWith("@@ ")) hunks.push({ before: "", after: "" });
  else if (hunks.length && /^[ +\-]/.test(line)) {
    const hunk = hunks.at(-1)!;
    if (!line.startsWith("+")) hunk.before += line.slice(1) + "\n";
    if (!line.startsWith("-")) hunk.after += line.slice(1) + "\n";
  }
}
const modulePath = resolve(import.meta.dir, "../node_modules/three/build/three.module.js");
let original = readFileSync(modulePath, "utf8").replaceAll("\r\n", "\n");
for (const hunk of hunks) {
  if (original.includes(hunk.after)) original = original.replace(hunk.after, hunk.before);
  else if (!original.includes(hunk.before)) throw Error("Three dependency no longer matches its committed patch.");
}
let candidate = original;
for (const hunk of hunks) {
  if (candidate.split(hunk.before).length !== 2) throw Error("Three patch hunk is ambiguous.");
  candidate = candidate.replace(hunk.before, hunk.after);
}
const core = pathToFileURL(resolve(import.meta.dir, "../node_modules/three/build/three.core.js")).href;
const scratch = tempDir("program-preparation-", import.meta.dir);
const load = (source: string, name: string): Promise<typeof THREE> => {
  const file = resolve(scratch, name + ".mjs");
  writeFileSync(file, source.replaceAll("'./three.core.js'", JSON.stringify(core)));
  return import(pathToFileURL(file).href);
};
const [stock, patched] = await Promise.all([load(original, "stock"), load(candidate, "patched")]);

function disposeRenderer(renderer: THREE.WebGLRenderer) {
  // Three's animation owner takes Bun's `self`, which has no browser frame methods.
  const previous = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame ??= () => {};
  try { renderer.dispose(); }
  finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    else globalThis.cancelAnimationFrame = previous;
  }
}

function diagnostics(Renderer: typeof THREE.WebGLRenderer, ok: boolean, callback = false, enabled = true) {
  const fixture = recordingRenderer(Renderer), { renderer, compile } = fixture;
  const gl = renderer.getContext();
  const calls = { programLog: 0, shaderLog: 0, linkStatus: 0, uniforms: 0, attributes: 0, deletes: 0, callback: 0 };
  const parameter = gl.getProgramParameter.bind(gl);
  gl.getProgramParameter = (program, name) => {
    if (name === gl.LINK_STATUS) { calls.linkStatus++; return ok; }
    if (name === gl.ACTIVE_UNIFORMS || name === gl.ACTIVE_ATTRIBUTES) return 1;
    return parameter(program, name);
  };
  gl.getProgramInfoLog = () => { calls.programLog++; return ok ? "" : "link failed"; };
  gl.getShaderInfoLog = () => { calls.shaderLog++; return ok ? "" : "shader failed"; };
  gl.getShaderParameter = () => ok;
  gl.getActiveUniform = () => { calls.uniforms++; return { name: "uProbe", size: 1, type: gl.FLOAT }; };
  gl.getUniformLocation = () => ({});
  gl.getActiveAttrib = () => { calls.attributes++; return { name: "position", size: 1, type: gl.FLOAT_VEC3 }; };
  gl.getAttribLocation = () => 0;
  gl.deleteShader = () => { calls.deletes++; };
  renderer.debug.checkShaderErrors = enabled;
  if (callback) renderer.debug.onShaderError = () => { calls.callback++; };
  compile(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: "broken-or-working" })));
  const program = renderer.info.programs![0]! as NonNullable<typeof renderer.info.programs>[number] & { diagnostics?: unknown };
  const uniforms = program.getUniforms(), attributes = program.getAttributes();
  expect(program.getUniforms()).toBe(uniforms);
  expect(program.getAttributes()).toBe(attributes);
  disposeRenderer(renderer);
  return { calls, diagnostics: program.diagnostics };
}

test("successful links read no info logs; uniforms, attributes and shader deletion still happen exactly once", () => {
  const baseline = diagnostics(stock.WebGLRenderer, true), result = diagnostics(patched.WebGLRenderer, true);
  expect(baseline.calls).toMatchObject({ programLog: 1, shaderLog: 2, linkStatus: 1 });
  expect(result.calls).toEqual({ programLog: 0, shaderLog: 0, linkStatus: 1, uniforms: 1, attributes: 1, deletes: 2, callback: 0 });
  expect(result.diagnostics).toBeUndefined();
});

test("failed links keep Three's exact default error message, logs and diagnostic object", () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const baseline = diagnostics(stock.WebGLRenderer, false), messages = [...error.mock.calls];
    error.mockClear();
    const result = diagnostics(patched.WebGLRenderer, false);
    expect(messages).toHaveLength(1);
    expect(error.mock.calls).toEqual(messages);
    expect(result.diagnostics).toEqual(baseline.diagnostics);
    expect(result.diagnostics).toMatchObject({ runnable: false, programLog: "link failed" });
    expect(result.calls).toMatchObject({ programLog: 1, shaderLog: 4, uniforms: 1, attributes: 1, deletes: 2 });
  } finally { error.mockRestore(); }
});

test("failed links retain the custom error callback and disabled checking still reads no status or logs", () => {
  for (const Renderer of [stock.WebGLRenderer, patched.WebGLRenderer]) {
    expect(diagnostics(Renderer, false, true).calls).toMatchObject({ callback: 1, programLog: 1, shaderLog: 2 });
    expect(diagnostics(Renderer, true, false, false).calls).toMatchObject({ linkStatus: 0, programLog: 0, shaderLog: 0, uniforms: 1, attributes: 1 });
  }
});

const lightReplacement = (source: string) => new Function("return (" +
  source.slice(source.indexOf("function replaceLightNums("), source.indexOf("function replaceClippingPlaneNums(")) + ")")() as
  (source: string, parameters: Record<string, number>) => string;

test("one-pass light substitution is byte-identical for all tokens, overlapping names, embedded names and varied counts", () => {
  const before = lightReplacement(original), after = lightReplacement(candidate);
  const names = ["SunLights", "DirLights", "SpotLights", "SpotLightMaps", "RectAreaLights", "PointLights", "HemiLights", "SunLightShadows",
    "DirLightShadows", "SpotLightShadowsWithMaps", "SpotLightShadows", "PointLightShadows"];
  const tokens = [...new Set(original.slice(original.indexOf("function replaceLightNums("), original.indexOf("function replaceClippingPlaneNums("))
    .match(/NUM_[A-Z_]+/g))];
  expect(tokens).toHaveLength(13);
  const input = tokens.map(token => `${token} prefix_${token}_suffix ${token}`).join("\n") + "\nNUM_UNKNOWN NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS_EXTRA";
  for (let n = 0; n < 64; n++) {
    const parameters = Object.fromEntries(names.map((name, index) => [`num${name}`, (n * 7 + index) % 17]));
    expect(after(input, parameters)).toBe(before(input, parameters));
    expect(after("no light placeholders here", parameters)).toBe("no light placeholders here");
  }
});

test("real Three assembles identical sources and cache keys for skin, scatter, depth and physical variants", () => {
  const assemble = (Renderer: typeof THREE.WebGLRenderer) => {
    const fixture = recordingRenderer(Renderer), { renderer, compile, programKey } = fixture;
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const head = headSurface();
    const skin = createSkinMaterial({ albedo: texture, normal: texture, roughness: texture, detailNormal: texture,
      microDetail: texture, tintMask: texture, secondary: texture }, skinParameters({ scalars: {}, colours: {}, skinProfiles: {} })).material;
    extendSkin(head, skin); head.material = skin;
    const scatter = createSkinScatter(renderer);
    const materials = [skin, ...scatter.variantsOf(skin), fullSkinDepthMaterial(head),
      new THREE.MeshPhysicalMaterial({ clearcoat: 1, iridescence: 1, side: THREE.DoubleSide, transparent: true })];
    for (const [i, material] of materials.entries()) {
      const light = new THREE.DirectionalLight();
      fixture.scene.add(light); // Vary light counts as well as materials.
      compile(head, material);
      if (i === 0) compile(head, material);
    }
    const result = { shaders: fixture.shaders, keys: materials.map(programKey) };
    scatter.dispose(); disposeRenderer(renderer);
    return result;
  };
  const baseline = assemble(stock.WebGLRenderer), result = assemble(patched.WebGLRenderer);
  expect(result.shaders.length).toBeGreaterThan(12);
  expect(result).toEqual(baseline);
});

test("scatter occluders already share one program across the three passes, while skin target programs remain distinct", () => {
  const { renderer, compile, programKey } = recordingRenderer(patched.WebGLRenderer);
  const scatter = createSkinScatter(renderer), mesh = headSurface();
  extendSkin(mesh, mesh.material as THREE.MeshStandardMaterial);
  const variants = scatter.variantsOf(mesh.material as THREE.Material);
  expect(variants).toHaveLength(3);
  expect(variants.flatMap(material => compile(mesh, material))).toHaveLength(1);
  expect(new Set(variants.map(programKey)).size).toBe(1);
  const texture = new THREE.Texture();
  const skin = createSkinMaterial({ albedo: texture, normal: texture, roughness: texture, detailNormal: texture,
    microDetail: texture, tintMask: texture, secondary: texture }, skinParameters({ scalars: {}, colours: {}, skinProfiles: {} })).material;
  extendSkin(mesh, skin);
  const skinVariants = scatter.variantsOf(skin);
  expect(skinVariants.flatMap(material => compile(mesh, material))).toHaveLength(3);
  expect(new Set(skinVariants.map(programKey)).size).toBe(3);
  scatter.dispose(); disposeRenderer(renderer);
});

test("the opt-in preparation inventory reports passes, material identities and exact Three keys without GL reads", async () => {
  const { renderer, scene, camera } = recordingRenderer(patched.WebGLRenderer);
  const head = headSurface(); head.name = "probe-head"; head.castShadow = true; head.customDepthMaterial = fullSkinDepthMaterial(head);
  scene.add(head);
  const stage = createLightingSetupStage({ scene, renderer, loadLut: () => new Promise(() => {}),
    createEnvironment: () => ({ mode: "pmrem", lights: [], restore() {}, dispose() {} }) });
  const scope = globalThis as typeof globalThis & { __xfsProgramPreparation?: (entry: ProgramPreparationEntry) => void };
  const previous = scope.__xfsProgramPreparation, entries: ProgramPreparationEntry[] = [];
  scope.__xfsProgramPreparation = entry => entries.push(entry);
  try {
    const prepared = stage.prepare(head, camera); await prepared.ready;
    expect(new Set(entries.map(entry => entry.pass))).toEqual(new Set(["forward", "scatter-s0", "scatter-s1", "scatter-s2", "contact-depth",
      "shadow-forward", "shadow-contact-1", "shadow-contact-2"]));
    expect(entries.every(entry => entry.object === "probe-head" && entry.programs.some(program => program.current && program.cacheKey.length > 0))).toBe(true);
    const gl = renderer.getContext(), get = gl.getProgramParameter;
    gl.getProgramParameter = () => { throw Error("The inventory must not query GL."); };
    traceProgramPreparation(renderer, head, "repeat");
    gl.getProgramParameter = get;
    expect(entries.at(-1)!.pass).toBe("repeat");
    scope.__xfsProgramPreparation = () => { throw Error("diagnostics only"); };
    expect(() => traceProgramPreparation(renderer, head, "throwing-consumer")).not.toThrow();
  } finally { scope.__xfsProgramPreparation = previous; stage.dispose(); disposeRenderer(renderer); }
});
