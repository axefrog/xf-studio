import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter, type AdapterContext, type ChunkTextures } from "../src/character-material-adapters";
import { bakeGradientRamp, createEyeMaterial, EYE_FLAT_ROUGHNESS, eyeParameters, eyeSampleCoordinates, gradientColourAt, GRADIENT_RAMP_SIZE,
  IRIS_MASK_ENCODING, irisBaseColour, irisCoordinate, patchEyeShader, patchEyeShellShader, shellAlpha, shellLuminance, shellParameters,
  shellRoughness, shellSpecular, type EyeballHandle, type EyeShellHandle } from "../src/eye-material";
import type { RenderChunkMaterial, RenderGradientStop, RenderTexture } from "../src/render-detail";

// The resolved stops of two vanilla profiles (knowledge/eye-rendering.md §1.1), sorted as the record carries them.
const LIGHT_BLUE: RenderGradientStop[] = [{ value: 0, color: [22, 22, 22, 255] }, { value: 0.785713971, color: [130, 192, 229, 255] },
  { value: 1, color: [255, 255, 255, 255] }];
const RED: RenderGradientStop[] = [{ value: 0.207, color: [22, 8, 0, 255] }, { value: 0.298, color: [216, 0, 4, 255] }, { value: 0.576, color: [255, 135, 0, 255] }];
const srgb = (linear: number) => Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));

describe("iris colour ramp", () => {
  test("stops interpolate linearly in their 8-bit values and clamp beyond the ends", () => {
    expect(gradientColourAt(LIGHT_BLUE, 0)).toEqual([22, 22, 22, 255]);
    expect(gradientColourAt(LIGHT_BLUE, 0.785713971)).toEqual([130, 192, 229, 255]);
    expect(gradientColourAt(LIGHT_BLUE, 1.5)).toEqual([255, 255, 255, 255]);
    const half = gradientColourAt(LIGHT_BLUE, 0.785713971 / 2);
    expect(half.map(Math.round)).toEqual([76, 107, 126, 255]);
    // Before the first stop the first colour holds (red starts at 0.207).
    expect(gradientColourAt(RED, 0.1)).toEqual([22, 8, 0, 255]);
    expect(gradientColourAt(RED, 0.2525).map(Math.round)).toEqual([119, 4, 2, 255]);
  });

  test("the baked ramp holds the gradient at texel centres", () => {
    const ramp = bakeGradientRamp(LIGHT_BLUE);
    expect(ramp.length).toBe(GRADIENT_RAMP_SIZE * 4);
    for (const i of [0, 64, 201, 255]) {
      const expected = gradientColourAt(LIGHT_BLUE, (i + 0.5) / GRADIENT_RAMP_SIZE).map(Math.round);
      expect([...ramp.subarray(i * 4, i * 4 + 4)]).toEqual(expected);
    }
  });

  test("the mask's R is read raw by default; the decoded reading darkens every gradient eye (test ask 9)", () => {
    expect(IRIS_MASK_ENCODING).toBe("raw");
    expect(irisCoordinate(0.345)).toBe(0.345);
    expect(irisCoordinate(0.345, "decoded")).toBeCloseTo(0.098, 3);
    // Iris texel at the mask's median R, full coverage: a mid blue raw, a dark slate decoded.
    const raw = irisBaseColour([0.8, 0.8, 0.8], 0.345, 1, LIGHT_BLUE).map(srgb);
    const decoded = irisBaseColour([0.8, 0.8, 0.8], 0.345, 1, LIGHT_BLUE, "decoded").map(srgb);
    expect(raw).toEqual([69, 97, 113]);
    expect(decoded).toEqual([35, 43, 48]);
    // Red eyes: bright red-orange raw, near-black decoded.
    expect(irisBaseColour([0, 0, 0], 0.345, 1, RED).map(srgb)).toEqual([223, 23, 3]);
    expect(irisBaseColour([0, 0, 0], 0.345, 1, RED, "decoded").map(srgb)).toEqual([22, 8, 0]);
    // The mask's A blends the ramp over the albedo (0 outside the iris ring).
    expect(irisBaseColour([0.8, 0.5, 0.2], 0.345, 0, LIGHT_BLUE)).toEqual([0.8, 0.5, 0.2]);
  });
});

describe("eye sampling rule", () => {
  test("colour, normal and mask are sampled at the folded U and flipped V; roughness at the raw UV", () => {
    // The character's left eye (pupil at U 1.5) uses the "right" parameters, the other eye (U −0.5) the "left".
    expect(eyeSampleCoordinates(1.5, 0.5)).toEqual({ side: "right", colour: [0.5, 0.5], roughness: [1.5, 0.5] });
    expect(eyeSampleCoordinates(-0.5, 0.5)).toEqual({ side: "left", colour: [0.5, 0.5], roughness: [-0.5, 0.5] });
    // Above the pupil in the mesh is below it in the texture: the earlier preview drew the eye upside down.
    expect(eyeSampleCoordinates(1.52, 0.4)).toEqual({ side: "right", colour: [expect.closeTo(0.52, 9), expect.closeTo(0.6, 9)], roughness: [1.52, 0.4] });
    expect(eyeSampleCoordinates(0, 0.3).side).toBe("left");
  });

  test("the shader patch follows the same rule on this Three.js build", () => {
    const shader = patchEyeShader({ fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    expect(shader.fragmentShader).toContain("float xfsEyeFu = xfsEyeUv.x + ( xfsEyeLeft ? 1.0 : -1.0 );");
    // Outside the iris the mesh coordinate, V-flipped; inside it the refracted iris-plane coordinate (ranks 4–5).
    expect(shader.fragmentShader).toContain("vec2 xfsEyeUvC = mix( vec2( xfsEyeFu, 1.0 - xfsEyeUv.y ), xfsEyeUvI, xfsEyeIris * xfsEyeHasAxis );");
    expect(shader.fragmentShader).toContain("textureGrad( map, xfsEyeUvC");
    expect(shader.fragmentShader).toContain("textureGrad( xfsIrisMask, xfsEyeUvC");
    expect(shader.fragmentShader).toContain("texture2D( xfsEyeRoughness, vMapUv ).r * xfsEyeSurface.x");
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(() => patchEyeShader({ fragmentShader: "void main() {}" })).toThrow("expects");
  });

  test("parameters: effective scalars, template defaults for the rest, metalness from Specularity", () => {
    const p = eyeParameters({ scalars: { RoughnessScale: 0.3, Specularity: 2, EyeHorizAngleLeft: -3.6 } });
    expect(p.roughnessScale).toBe(0.3);
    expect(p.metalness).toBe(1);
    expect(p.optics.EyeHorizAngleLeft).toBe(-3.6);
    expect(p.optics.IrisCoordFactor).toBeCloseTo(0.165, 3);
    expect(eyeParameters({ scalars: {} }).roughnessScale).toBeCloseTo(0.4934, 4);
  });
});

describe("wetness shell", () => {
  const vanilla = shellParameters({ scalars: { Intensity: 0.7, Exponent: 0.8 }, colours: { ShadowColor: [125, 58, 58, 255] } });
  test("the darkening: neutral grey from the colour's mean, 0.37 at full mask, nothing where the mask is black", () => {
    expect(shellLuminance([125, 58, 58])).toBeCloseTo(0.0942, 4);
    expect(vanilla).toMatchObject({ intensity: 0.7, exponent: 0.8, wetnessRoughness: 1, wetnessStrength: 4 });
    expect(shellAlpha(1, vanilla)).toBeCloseTo(0.366, 3);
    expect(shellAlpha(0, vanilla)).toBe(1);
    expect(shellAlpha(0.5, vanilla)).toBeCloseTo(1 - 0.7 * 0.5 ** 0.8 * (1 - 0.0941), 3);
    // Template defaults when the chain sets nothing.
    expect(shellParameters({ scalars: {}, colours: {} })).toMatchObject({ intensity: 1, exponent: expect.closeTo(2.2, 5) });
  });

  test("the tear-line highlight: wet roughness from G, GGX with the eye's visibility, no Fresnel or N·L", () => {
    expect(shellRoughness(106 / 255, vanilla)).toBeCloseTo(0.4157, 4);
    expect(shellRoughness(0, vanilla)).toBe(0.04);
    const r = 0.4157, a = r * r;
    // At the mirror direction, straight on: D = 1/(π a²), visibility 0.25 / (2(1 − a/2) + a).
    expect(shellSpecular(1, 1, 1, r)).toBeCloseTo((1 / (Math.PI * a * a)) * (0.25 / (2 * (1 - a / 2) + a)), 6);
    // Grazing light: no N·L factor, so the lobe stays finite and positive.
    expect(shellSpecular(0.9, 1, 0, r)).toBeGreaterThan(0);
    const shader = patchEyeShellShader({ fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    expect(shader.fragmentShader).toContain("gl_FragColor = vec4( reflectedLight.directSpecular * xfsShellStrength * xfsShellMask.b, xfsShellAlpha );");
    expect(shader.fragmentShader).toContain("#define RE_Direct RE_Direct_XfsShell");
    expect(shader.fragmentShader).not.toContain("#include <lights_fragment_maps>");
  });
});

describe("eye adapters", () => {
  const texture = (depotPath: string, isGamma = false): RenderTexture =>
    ({ file: `${"a".repeat(64)}.png`, sha256: "a".repeat(64), sources: [], depotPath, width: 4, height: 4, isGamma });
  const chunk = (template: string, textures: string[], extra: Partial<RenderChunkMaterial> = {}): RenderChunkMaterial => ({
    chunk: 1, name: "m", template, templateName: null, materialPriority: null, scalars: {}, colours: {}, profiles: {}, skinProfiles: {}, gradients: {},
    textures: Object.fromEntries(textures.map(name => [name, texture(`x\\${name}.xbm`, name !== "Roughness")])), ...extra });
  const requests: string[] = [];
  const textures: ChunkTextures = (parameter, use, wrap) => { requests.push(`${parameter}:${use}:${wrap}`); return new THREE.Texture(); };
  const context = (slot: AdapterContext["slot"] = "eyes"): AdapterContext => ({ slot, overMakeup: false, profileEncoding: "srgb-decoded" });
  const mesh = () => new THREE.Mesh(new THREE.BufferGeometry());
  const gradient = { IrisColorGradient: { depotPath: "g.gradient", archive: null, sha256: null, stops: LIGHT_BLUE } };

  test("a gradient eye: colour albedo, raw mask, data roughness, its own baked ramp; the handle switches the roughness", () => {
    requests.length = 0;
    const adapted = materialAdapter("base\\materials\\eye_gradient.mt")!.create(chunk("base\\materials\\eye_gradient.mt",
      ["Albedo", "Roughness", "IrisMask", "Normal", "NormalBubble"], { gradients: gradient, scalars: { RoughnessScale: 0.5 } }), textures, mesh(), context());
    // Gamma-flagged data (the mask, and the normal when its resource is gamma) is read raw by default; the bubble is data.
    expect(requests.sort()).toEqual(["Albedo:colour:repeat", "IrisMask:data:repeat", "Normal:data:repeat", "NormalBubble:data:repeat", "Roughness:data:repeat"]);
    const material = adapted.material as THREE.MeshStandardMaterial;
    expect(material.defines).toEqual({ XFS_EYE_GRADIENT: "" });
    expect(material.customProgramCacheKey()).toBe("xfs-eye-2-gradient");
    expect(material.roughness).toBe(EYE_FLAT_ROUGHNESS);
    expect(material.normalMap).toBeInstanceOf(THREE.Texture);
    const ramp = adapted.owned.find(t => t.name === "xfs_iris_gradient")!;
    expect(ramp.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(ramp.wrapS).toBe(THREE.ClampToEdgeWrapping);
    const handle = adapted.eye as EyeballHandle;
    // The eye's own roughness is on by default (sclera ≈ 0.05 in vanilla); the switch turns the earlier flat gloss back on.
    expect(handle).toMatchObject({ role: "eyeball", gradient: true, hasSourceRoughness: true, sourceRoughness: true });
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader as never, {} as never);
    expect((shader.uniforms.xfsEyeSurface!.value as THREE.Vector3).toArray()).toEqual([0.5, 1, 0]);
    handle.setSourceRoughness(false);
    expect(handle.sourceRoughness).toBe(false);
    expect((shader.uniforms.xfsEyeSurface!.value as THREE.Vector3).toArray()).toEqual([0.5, 0, 0]);
    // The vertex program carries the per-eye vectors, skinned with the eye; the indirect light gets the eye's ambient factor.
    expect(shader.vertexShader).toContain("xfsAxisObject = ( skinMatrix * vec4( xfsAxisObject, 0.0 ) ).xyz;");
    expect(shader.uniforms.xfsEyeAmbient!.value as number).toBeCloseTo(1.1, 9);
    // A gradient template without its ramp is not drawn wrongly.
    expect(() => materialAdapter("base\\materials\\eye_gradient.mt")!.create(chunk("base\\materials\\eye_gradient.mt", ["Albedo", "IrisMask"]),
      textures, mesh(), context())).toThrow("IrisColorGradient");
  });

  test("a texture-only eye has no mask or ramp; without a roughness map the switch keeps the flat roughness", () => {
    requests.length = 0;
    const adapted = materialAdapter("base\\materials\\eye.mt")!.create(chunk("base\\materials\\eye.mt", ["Albedo"]),
      (parameter, use, wrap) => parameter === "Albedo" ? textures(parameter, use, wrap) : undefined, mesh(), context());
    expect((adapted.material as THREE.MeshStandardMaterial).defines?.XFS_EYE_GRADIENT).toBeUndefined();
    const handle = adapted.eye as EyeballHandle;
    expect(handle.gradient).toBe(false);
    handle.setSourceRoughness(true);
    expect(handle.sourceRoughness).toBe(false);
    expect(adapted.notes[0]).toContain("flat preview roughness");
  });

  test("the shell: data mask, blended after opaque surfaces as out + dst · alpha, no depth write", () => {
    requests.length = 0;
    const adapted = materialAdapter("base\\materials\\eye_shadow.mt")!.create(chunk("base\\materials\\eye_shadow.mt", ["Mask"],
      { scalars: { Intensity: 0.7, Exponent: 0.8 }, colours: { ShadowColor: [125, 58, 58, 255] } }), textures, mesh(), context());
    expect(requests).toEqual(["Mask:data:clamp"]);
    const material = adapted.material as THREE.MeshStandardMaterial;
    expect([material.transparent, material.depthWrite, material.depthTest, material.side]).toEqual([true, false, true, THREE.DoubleSide]);
    expect([material.blending, material.blendSrc, material.blendDst]).toEqual([THREE.CustomBlending, THREE.OneFactor, THREE.SrcAlphaFactor]);
    expect((adapted.eye as EyeShellHandle).parameters.luminance).toBeCloseTo(0.0942, 4);
  });

  test("a layered design is hidden and says so with a code; elsewhere a generic layered code", () => {
    const eyes = materialAdapter("engine\\materials\\multilayered.mt")!.create(chunk("engine\\materials\\multilayered.mt", []), textures, mesh(), context());
    expect(eyes).toMatchObject({ hidden: true, limits: ["eye-design"] });
    const hair = materialAdapter("engine\\materials\\multilayered.mt")!.create(chunk("engine\\materials\\multilayered.mt", []), textures, mesh(), context("hair"));
    expect(hair.limits).toEqual(["layered-material"]);
  });

  test("the core fallback eye uses the same material without a mask", () => {
    const { material, handle } = createEyeMaterial({ albedo: new THREE.Texture() }, eyeParameters({ scalars: {} }));
    expect(material.name).toBe("xfs_eye");
    expect(handle.hasSourceRoughness).toBe(false);
  });
});
