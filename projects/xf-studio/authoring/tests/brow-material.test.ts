import { expect, test } from "bun:test";
import * as THREE from "three";
import { browCoverage, createSavedBrowMaterial, parseBrowManifest, sampleUnderlayAlbedo, verifyBrowImage } from "../src/brow-material";
import { srgbToLinear } from "../src/hair-colour-model";
import { extendSkin } from "../src/skin";

const image = (name: string) => ({ url: `/assets/brows/${name}.png`, sha256: "a".repeat(64), width: 32, height: 4 });
const manifest = { schema: "xfs/brow-preview-1", appearanceHash: "10685882159528859062",
  definition: "10_brown_ombre", primary: image("primary"), secondary: image("secondary"), gradient: image("gradient") } as const;

test("brow manifest binds only the audited saved appearance and local digest-addressed images", async () => {
  expect(parseBrowManifest(manifest)).toEqual(manifest);
  expect(() => parseBrowManifest({ ...manifest, definition: "another" })).toThrow();
  expect(() => parseBrowManifest({ ...manifest, primary: { ...image("primary"), url: "https://example.invalid/other.png" } })).toThrow();
  expect(() => parseBrowManifest({ ...manifest, gradient: { ...image("gradient"), sha256: "bad" } })).toThrow();
  const bytes = new TextEncoder().encode("private brow image");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
  await expect(verifyBrowImage(bytes.buffer as ArrayBuffer, digest)).resolves.toBeUndefined();
  await expect(verifyBrowImage(bytes.buffer as ArrayBuffer, "a".repeat(64))).rejects.toThrow();
});

test("2.31 brow coverage combines filtered primary and secondary alpha before squaring", () => {
  expect(browCoverage(0.5, 0)).toBe(0.25);
  expect(browCoverage(0, 0.5)).toBeCloseTo(0.1225);
  expect(browCoverage(0.5, 0.5)).toBeCloseTo(0.455625);
  // Two edge texels (0 and 1) filtered at their midpoint give 0.25, whereas
  // filtering already-squared texels gives 0.5. Keep the nonlinear step in GLSL.
  expect(browCoverage(0.5, 0)).not.toBe((browCoverage(0, 0) + browCoverage(1, 0)) / 2);
  const material = createSavedBrowMaterial(new THREE.Texture(), new THREE.Texture(), new THREE.Texture());
  const shader = { uniforms: {}, fragmentShader: "#include <map_pars_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>" };
  material.onBeforeCompile(shader as never, {} as never);
  expect(shader.fragmentShader).toContain("browPrimary.a");
  expect(shader.fragmentShader).toContain("browSecondary.a");
  expect(shader.fragmentShader).toContain("browCombined * browCombined");
  expect(shader.fragmentShader).not.toContain("#include <alphamap_fragment>");
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material);
  extendSkin(mesh, material);
  const skinnedShader = { uniforms: {}, vertexShader: "#include <common>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <skinning_vertex>",
    fragmentShader: "#include <map_pars_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>" };
  material.onBeforeCompile(skinnedShader as never, {} as never);
  expect(skinnedShader.fragmentShader).toContain("browCombined * browCombined");
  expect(skinnedShader.vertexShader).toContain("fullSkin");
});

test("G-buffer decal blend is opt-in, declared per vertex and keeps the squared coverage", () => {
  const material = createSavedBrowMaterial(new THREE.Texture(), new THREE.Texture(), new THREE.Texture(), { gbufferBlend: true });
  expect(material.defines).toHaveProperty("XFS_GBUFFER_DECAL");
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_pars_fragment>\n#include <map_fragment>\n#include <alphamap_fragment>" };
  material.onBeforeCompile(shader as never, {} as never);
  expect(shader.vertexShader).toContain("attribute vec3 xfsUnderlay");
  expect(shader.fragmentShader).toContain("sqrt(underlay)");
  expect(shader.fragmentShader).toContain("browCombined * browCombined");
  expect(material.customProgramCacheKey()).not.toBe(createSavedBrowMaterial(new THREE.Texture(), new THREE.Texture(),
    new THREE.Texture()).customProgramCacheKey());
});

test("underlay albedo samples the nearest source vertex UV bilinearly and decodes sRGB", () => {
  // 2x1 image: left texel 0, right texel 255 (red); UVs at texel centres and midway.
  const image = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 128, 64, 255]) };
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const uvs = new Float32Array([0.25, 0.5, 0.75, 0.5, 0.5, 0.5]);
  const target = new Float32Array([0.001, 0, 0, 0.999, 0.001, 0, 2, 0, 0.004, 5, 5, 5]);
  const { underlay, unmatched, maxMatchedDistance } = sampleUnderlayAlbedo(target, source, uvs, image, 0.01);
  expect(unmatched).toBe(1);
  expect(maxMatchedDistance).toBeCloseTo(0.004, 6);
  expect(underlay[0]).toBe(0);
  expect(underlay[3]).toBeCloseTo(1, 6);
  expect(underlay[4]).toBeCloseTo(srgbToLinear(128), 6);
  expect(underlay[6]).toBeCloseTo(0.5, 6);   // midway: filtered in linear space
});
