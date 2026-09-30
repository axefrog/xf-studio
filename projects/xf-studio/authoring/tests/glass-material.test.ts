import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { materialAdapter } from "../src/character-material-adapters";
import { createGlassMaterial, glassGrazingPower, glassParameters, glassTransmittance, patchGlassShader } from "../src/glass-material";
import { renderTemplate } from "../src/render-templates";

// glass_onesided.mt's transmission pass (research/materials/shader-metal-glass.md §4.3, rank 3 of §7): the arithmetic against the
// decompiled program's formulas, the Gorilla Arms pane's values (§5), and the blend that multiplies what is behind the pane.

describe("glass_onesided.mt (research/materials/shader-metal-glass.md §4)", () => {
  test("the template is known by its own name and vanilla path; every input is optional; glass.mt is still not drawn", () => {
    const byName = renderTemplate("mod\\copy\\pane.mt", "glass_onesided"), byPath = renderTemplate("base\\materials\\glass_onesided.mt");
    expect(byName?.adapter).toBe("glass");
    expect(byPath).toBe(byName);
    expect(byName!.required).toEqual([]);
    expect(renderTemplate("base\\materials\\glass.mt")).toBeUndefined();
    expect(materialAdapter("base\\materials\\glass_onesided.mt", "glass_onesided", "body")?.id).toBe("glass");
  });

  test("parameters: colours sRGB-decoded, the template's defaults otherwise; the Gorilla Arms pane reflects nothing", () => {
    const defaults = glassParameters({}, {});
    expect(defaults.opacity).toBe(1);
    expect(defaults.fresnelBias).toBe(1);
    expect(defaults.tint[0]).toBeCloseTo(((229 / 255 + 0.055) / 1.055) ** 2.4, 6);
    expect(defaults.specular).toEqual([1, 1, 1]);
    // Shader-metal-glass §5: TintColor (240, 235, 228), GlassSpecularColor black.
    const arms = glassParameters({ IOR: 1.32, NormalStrength: 4.45, GlassRoughnessBias: 0, BlurRadius: 1 },
      { TintColor: [240, 235, 228, 255], GlassSpecularColor: [0, 0, 0, 255] });
    expect(arms.tint.map(v => +v.toFixed(2))).toEqual([0.87, 0.83, 0.78]);
    expect(arms.specular).toEqual([0, 0, 0]);
  });

  test("the transmittance: the tint facing the view, darker and more saturated at grazing angles, scaled by Opacity", () => {
    // FresnelBias 0 → p 0.5, 1 → 1.5, 2 → 4.
    expect([0, 1, 2].map(glassGrazingPower)).toEqual([0.5, 1.5, 4]);
    const p = { opacity: 1, fresnelBias: 1, maskOpacity: 0 }, tint = [0.87, 0.83, 0.78];
    // Head-on: the tint itself.
    expect(glassTransmittance(tint, 1, p).map(v => +v.toFixed(6))).toEqual(tint);
    // At grazing (n·V 0): f = 1, so 0.75 · tint^1.5.
    const grazing = glassTransmittance(tint, 0, p);
    tint.forEach((t, k) => expect(grazing[k]).toBeCloseTo(0.75 * t ** 1.5, 6));
    // Between: f = saturate((1 − 0.6) · 1.25)^1.5 = 0.5^1.5.
    const f = 0.5 ** 1.5, mid = glassTransmittance(tint, 0.6, p);
    tint.forEach((t, k) => expect(mid[k]).toBeCloseTo(t + (0.75 * t ** 1.5 - t) * f, 6));
    // Opacity 0: the pane is invisible; the mask layer blocks what it covers.
    expect(glassTransmittance(tint, 1, { ...p, opacity: 0 })).toEqual([1, 1, 1]);
    expect(glassTransmittance(tint, 1, { ...p, maskOpacity: 1 }, 1)).toEqual([0, 0, 0]);
  });

  test("the pass multiplies what is behind it by T: custom blend Zero/SrcColor, depth tested without writing, front faces, no tone mapping", () => {
    const material = createGlassMaterial({}, glassParameters({}, { TintColor: [240, 235, 228, 255] }));
    expect([material.blending, material.blendSrc, material.blendDst]).toEqual([THREE.CustomBlending, THREE.ZeroFactor, THREE.SrcColorFactor]);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.toneMapped).toBe(false);
    const shader = patchGlassShader({ vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    const tail = shader.fragmentShader.slice(shader.fragmentShader.indexOf("#include <dithering_fragment>"));
    expect(tail).toContain("gl_FragColor = vec4( mix( vec3( 1.0 ), xfsShifted * ( 1.0 - xfsW ), xfsGlassParams.x ), 1.0 );");
    expect(shader.vertexShader).toContain("vXfsGlassUv = uv;");
    // Through the adapter: a pane that reflects says what isn't drawn, and no pane casts.
    const adapter = materialAdapter("base\\materials\\glass_onesided.mt", "glass_onesided", "body")!;
    const chunk = { chunk: 0, name: "glass", template: "base\\materials\\glass_onesided.mt", templateName: "glass_onesided", materialPriority: null,
      scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {} };
    const made = adapter.create(chunk, () => undefined, new THREE.Mesh(), { slot: "body", overMakeup: false, profileEncoding: "srgb-decoded" });
    expect(made.notes.join(" ")).toContain("reflection isn't drawn");
    expect(made.material.userData.xfsCastsNoShadow).toBe(true);
    const clear = adapter.create({ ...chunk, colours: { GlassSpecularColor: [0, 0, 0, 255] } }, () => undefined, new THREE.Mesh(),
      { slot: "body", overMakeup: false, profileEncoding: "srgb-decoded" });
    expect(clear.notes).toEqual([]);
  });
});
