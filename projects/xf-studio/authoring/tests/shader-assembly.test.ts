/**
 * The Studio's combined shader hooks through Three r186's own program assembly, without a GPU (PREV-195): a real `WebGLRenderer` over a
 * recording WebGL 2 context builds each program exactly as it would for the driver (parameters, `onBeforeCompile` hooks, includes,
 * prefixes, the program cache), and the text it would compile is checked for what broke programs before (a declaration twice, an
 * include left unresolved, a macro redefined, unbalanced conditionals). The same renderer's program cache shows that the finish
 * stand-ins compile the very programs a layer switches to, so compiling them ahead is never wasted. The render smoke test
 * (`bun run smoke:render`) compiles them for real in a GPU browser.
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { glslDeclarations, glslIssues } from "./fixtures/glsl-check";
import { headSurface, recordingRenderer } from "./fixtures/recording-gl";
import { extendSkin, fullSkinDepthMaterial } from "../src/materials/render/skin";
import { createSkinMaterial, skinParameters, contactShadowUniforms } from "../src/materials/render/skin-material";
import { createSkinScatter } from "../src/platform/scene/skin-scatter";
import { createContactShadows } from "../src/platform/scene/contact-shadow";
import { createMakeupStack, initialRecipe } from "./fixtures/eye-region";
import { defaultDirectGlintFlakes } from "../src/engines/layered-makeup/direct-glint-settings";

/** Every program must pass the text check, and must be built with the hooks' code live (not a replace that found no marker). */
function checked(programs: { vertex: string; fragment: string }[], label: string) {
  for (const [index, program] of programs.entries()) for (const [stage, text] of Object.entries(program))
    expect(glslIssues(text), `${label} program ${index} ${stage}`).toEqual([]);
  return programs;
}

const map = () => { const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1); texture.needsUpdate = true; return texture; };

test("the glsl check finds a declaration twice, an unresolved include, a redefined macro and an unclosed #if, and reads Three's own programs clean", () => {
  expect(glslIssues("attribute vec4 joints_1;\n#ifdef USE_SKINNING\nattribute vec4 joints_1;\n#endif\n#define USE_SKINNING\n")).toEqual([]);
  expect(glslIssues("#define USE_SKINNING\n#ifdef USE_SKINNING\nattribute vec4 joints_1;\n#endif\nattribute vec4 joints_1;")).toEqual(['"joints_1" is declared 2 times']);
  expect(glslIssues("#include <common>")).toEqual(["#include <common> left unresolved"]);
  expect(glslIssues("#define A 1\n#define A 2")).toEqual(["#define A redefined"]);
  expect(glslIssues("#if 1\nfloat a;")).toEqual(["an #if is never closed"]);
  expect(glslIssues("float f(float x) { return x; }\nfloat f(vec2 x) { return x.x; }\nfloat f(float y) { return y; }")).toEqual(["f(float) is defined 2 times"]);
  expect(glslIssues("#define N 2\n#if N > 1 && defined( N )\nfloat a;\n#else\nfloat a;\n#endif\nstruct S { float x; };\nstruct T { float x; } t;")).toEqual([]);
  const { compile } = recordingRenderer();
  const plain = checked(compile(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ clearcoat: 1, iridescence: 1 }))), "stock physical");
  expect(plain).toHaveLength(1);
  // 8474bb3's failure, rebuilt: a skinned program whose hooks declare the second joint attributes twice is caught in Three's own text.
  const broken = headSurface(), material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 joints_1;\nattribute vec4 joints_1;");
  };
  const [program] = compile(broken, material);
  expect(glslIssues(program!.vertex)).toEqual(['"joints_1" is declared 2 times']);
});

test("the V's skin, its scatter input and contact caster variants, and the head's second extension assemble cleanly (PREV-191, PREV-195)", () => {
  const { renderer, compile, programKey } = recordingRenderer();
  const head = headSurface(), textures = { albedo: map(), normal: map(), roughness: map(), detailNormal: map(), microDetail: map(), tintMask: map(), secondary: map() };
  const { material } = createSkinMaterial(textures, skinParameters({ scalars: {}, colours: {}, skinProfiles: {} }));
  // The skin chunk extends it, then the core head wears it (a second extension for the same skin sets changes nothing).
  const chunk = headSurface();
  extendSkin(chunk, material);
  const version = material.version;
  extendSkin(head, material);
  expect(material.version).toBe(version);
  head.material = material;
  const [forward] = checked(compile(head), "skin");
  expect(forward!.vertex).toContain("fullSkin += getBoneMatrix(joints_1.w) * weights_1.w;");
  expect(glslDeclarations(forward!.vertex).variables.has("joints_1")).toBe(true);
  expect(forward!.fragment).toContain("xfsTint");
  // Its scatter input: one program per target (S0 to S2), each writing one output (experiment 043 §12).
  const scatter = createSkinScatter(renderer).variantsOf(material);
  expect(scatter).toHaveLength(3);
  for (const [target, variant] of scatter.entries()) {
    const [program] = checked(compile(head, variant), `skin scatter input S${target}`);
    expect(program!.fragment).not.toMatch(/layout\s*\(\s*location\s*=\s*[1-9]/);
    expect(program!.fragment).toContain("xfsScatterWrite(");
  }
  head.castShadow = true;
  head.customDepthMaterial = fullSkinDepthMaterial(head);
  const caster = createContactShadows(renderer, contactShadowUniforms).casterMaterial(head);
  expect(caster).toBe(head.customDepthMaterial);
  const [depth] = checked(compile(head, caster), "contact caster");
  expect(depth!.vertex).toContain("fullSkin += getBoneMatrix(joints_1.x)");
  // A skin whose skin sets differ from the head's (a resolved chunk with one set): the head's extension builds its own program.
  const single = headSurface();
  single.geometry.deleteAttribute("joints_1"); single.geometry.deleteAttribute("weights_1");
  const other = createSkinMaterial(textures, skinParameters({ scalars: {}, colours: {}, skinProfiles: {} })).material;
  extendSkin(single, other);
  single.material = other;
  compile(single);
  const firstKey = programKey(other);
  extendSkin(head, other);
  head.material = other;
  // Re-extended for the head: the head's own skin program (the one built above), never the chunk's reused.
  expect(compile(head)).toHaveLength(0);
  expect(programKey(other)).not.toBe(firstKey);
  expect(programKey(other)).toBe(programKey(material));
});

test("eye makeup's layer slots (tint, glint, flake maps), the lit plate and the finish stand-ins assemble cleanly, and a finish choice after the prewarm links nothing (PREV-188, PREV-195)", async () => {
  const { renderer, compile, programKey } = recordingRenderer();
  const anchor = headSurface();
  const stack = createMakeupStack(anchor, 1);
  const scatter = createSkinScatter(renderer);
  const variants = (mesh: THREE.Mesh, label: string) => {
    for (const [target, variant] of scatter.variantsOf(mesh.material as THREE.Material).entries()) checked(compile(mesh, variant), `${label} scatter input S${target}`);
  };
  // The lit plate (plate-blend.ts), with its skin light.
  checked(compile(stack.plate), "lit plate");
  variants(stack.plate, "lit plate");
  // The stand-ins, compiled as the prewarm does.
  const standIns: THREE.Mesh[] = [];
  await stack.prewarmFinishes(async object => { standIns.push(object as THREE.Mesh); });
  expect(standIns).toHaveLength(2);
  const [glintStandIn, flakeStandIn] = standIns;
  for (const [index, mesh] of standIns.entries()) { checked(compile(mesh), `stand-in ${index}`); variants(mesh, `stand-in ${index}`); }
  // A layer slot (its Colour-shifting tint always installed) as Matte, then each finish the stand-ins stand for.
  stack.setCanvases([{ width: 32, height: 32 } as HTMLCanvasElement], ["a"]);
  const slot = stack.plates[0]!, material = stack.materials[0]!, layer = initialRecipe().layers[0]!;
  stack.updateLayer(0, { ...layer, finish: "matte" });
  const [matte] = checked(compile(slot), "slot matte");
  expect(matte!.fragment).toContain("uniform vec3 xfsShiftColor;");
  stack.updateLayer(0, { ...layer, finish: "iridescent", optics: { model: "game-matched-1", shift: { color: "#3fd4c2", strength: .8 } } });
  expect(compile(slot)).toHaveLength(0);
  // The default Glitter model (direct glints and the clear coat): the glint stand-in's program, so nothing links.
  stack.updateLayer(0, { ...layer, finish: "glitter", flakes: defaultDirectGlintFlakes() }, undefined, undefined, true);
  expect(compile(slot)).toHaveLength(0);
  expect(programKey(material)).toBe(programKey(glintStandIn!.material as THREE.Material));
  // Classic Glitter's flake maps: the flake stand-in's program.
  stack.updateLayer(0, { ...layer, finish: "glitter", flakes: undefined }, { size: 32, normal: new Uint8Array(32 * 32 * 4), surface: new Uint8Array(32 * 32 * 4) });
  expect(material.normalMap).not.toBeNull();
  expect(compile(slot)).toHaveLength(0);
  expect(programKey(material)).toBe(programKey(flakeStandIn!.material as THREE.Material));
  variants(slot, "slot");
  stack.dispose();
});
