import { expect, test } from "bun:test";
import { parseHairManifest, selectSavedHair, verifyHairBytes } from "../src/hair-preview";
import { attachHairColor, attachHairVertexRed, hairProfileTexture, sampleHairGradient } from "../src/hair-shading";
import { bakeHairProfile, resolveHairMaterial } from "../src/hair-colour-model";
import * as THREE from "three";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import type { SavedV } from "../src/save-reader";

const digest = "a".repeat(64);
const manifest = { schema: "xfs/local-hair-assets-1", entries: [{
  resourceHash: "14407260537193084196", definition: "38_ash_brown", label: "Resolved style",
  parts: [{ url: "/assets/hair/part1.glb", sha256: digest }, { url: "/assets/hair/part2.glb", sha256: digest }],
  alpha: { url: "/assets/hair/strands.png", sha256: digest },
}] };
const save = (hash: string, definition: string) => ({ groups: { head: [
  { name: "hairs", appearances: [{ resourceHash: hash, definition }] },
] } }) as SavedV;

test("saved hair matches exact 64-bit app hash and definition in hairs group", () => {
  const entries = parseHairManifest(manifest);
  expect(selectSavedHair(entries, save("14407260537193084196", "38_ash_brown"))?.label).toBe("Resolved style");
  expect(selectSavedHair(entries, save("14407260537193084196", "01_blonde_platinum"))).toBeUndefined();
  expect(selectSavedHair(entries, save("14407260537193084195", "38_ash_brown"))).toBeUndefined();
  expect(selectSavedHair(entries)).toBeUndefined();
});

test("two resolved styles switch by the new save identity without retaining the previous hair", () => {
  const second = { ...manifest.entries[0], resourceHash: "11883473447972092899",
    definition: "01_black", label: "Second style" };
  const entries = parseHairManifest({ ...manifest, entries: [manifest.entries[0], second] });
  const firstSave = save("14407260537193084196", "38_ash_brown");
  const secondSave = save("11883473447972092899", "01_black");
  expect(selectSavedHair(entries, firstSave)).toBe(entries[0]);
  expect(selectSavedHair(entries, secondSave)).toBe(entries[1]);
  expect(selectSavedHair(entries, save("11883473447972092899", "wrong"))).toBeUndefined();
  expect(selectSavedHair(entries, firstSave)).toBe(entries[0]);
});

test("local manifest rejects duplicate identities, unsafe asset URLs and bad digests", async () => {
  expect(() => parseHairManifest({ ...manifest, entries: [manifest.entries[0], manifest.entries[0]] })).toThrow();
  expect(() => parseHairManifest({ ...manifest, entries: [{ ...manifest.entries[0], alpha: { url: "https://remote.invalid/a.png", sha256: digest } }] })).toThrow();
  expect(() => parseHairManifest({ ...manifest, entries: [{ ...manifest.entries[0], parts: [{ url: "/assets/hair/part1.glb", sha256: "bad" }] }] })).toThrow();
  const bytes = new TextEncoder().encode("local asset");
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  await expect(verifyHairBytes(bytes, actual)).resolves.toBeUndefined();
  await expect(verifyHairBytes(bytes, digest)).rejects.toThrow();
});

test("optional hair visibility survives workspace restore and older drafts default on", () => {
  const state = freshWorkspace(); state.preview.hair = false;
  expect(parseWorkspace(JSON.parse(JSON.stringify(state))).preview.hair).toBe(false);
  const old = JSON.parse(JSON.stringify(state)); delete old.preview.hair;
  expect(parseWorkspace(old).preview.hair).toBe(true);
});

test("resolved CCXL profile requires separate verified strand and cap sources", () => {
  const png = (name: string) => ({ url: `/assets/hair/${name}.png`, sha256: digest });
  const complete = { ...manifest, schema: "xfs/local-hair-assets-2", entries: [{
    ...manifest.entries[0], strandId: png("id"), strandGradient: png("root"),
    capMask: png("cap_mask"), capGradient: png("cap_gradient"),
    profile: { sourceSha256: digest, id: [
      { value: 0.1, color: [20, 30, 40] }, { value: 1, color: [100, 110, 120] },
    ], rootToTip: [
      { value: 0, color: [1, 2, 3] }, { value: 1, color: [50, 60, 70] },
    ] },
  }] };
  expect(parseHairManifest(complete)[0]?.profile?.id).toHaveLength(2);
  expect(() => parseHairManifest({ ...complete, entries: [{ ...complete.entries[0], capMask: undefined }] })).toThrow();
  expect(() => parseHairManifest({ ...complete, entries: [{ ...complete.entries[0], strandId: png("..\\outside") }] })).toThrow();
  expect(() => parseHairManifest({ ...complete, entries: [{ ...complete.entries[0], profile: {
    ...complete.entries[0].profile, id: [{ value: 0.8, color: [1, 2, 3] }, { value: 0.2, color: [4, 5, 6] }],
  } }] })).toThrow();
});

test("source profile stops interpolate independently, including duplicate final positions", () => {
  const stops = [
    { value: 0.2, color: [0, 10, 20] as [number, number, number] },
    { value: 0.6, color: [100, 110, 120] as [number, number, number] },
    { value: 1, color: [200, 210, 220] as [number, number, number] },
    { value: 1, color: [250, 250, 250] as [number, number, number] },
  ];
  expect(sampleHairGradient(stops, 0)).toEqual([0, 10, 20]);
  expect(sampleHairGradient(stops, 0.4)).toEqual([50, 60, 70]);
  expect(sampleHairGradient(stops, 0.8)).toEqual([150, 160, 170]);
  expect(sampleHairGradient(stops, 1)).toEqual([250, 250, 250]);
});

test("strand and cap pigments use distinct source samplers; strands replace the alpha-map cutout", () => {
  const map = new THREE.Texture();
  for (const kind of ["strand", "cap"] as const) {
    const material = new THREE.MeshStandardMaterial({ alphaMap: map });
    if (kind === "strand") attachHairColor(material, {
      kind, id: map, gradient: map, profile: map, sampleCount: 127, material: resolveHairMaterial({ alphaCutoff: 0 }),
    });
    else attachHairColor(material, { kind, mask: map, gradient: map });
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <map_fragment>\n#include <alphamap_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("vAlphaMapUv");
    if (kind === "strand") {
      // Truncated lookup into the baked two-row profile, luminance-switched overlay, vertex-red shadow, red-channel coverage.
      expect(shader.fragmentShader).toContain("texelFetch(xfsProfile");
      expect(shader.fragmentShader).toContain("vec3(0.3, 0.59, 0.11)");
      expect(shader.fragmentShader).toContain("texture2D(alphaMap, vAlphaMapUv).r");
      expect(shader.fragmentShader).not.toContain("#include <alphamap_fragment>");
      expect(shader.vertexShader).toContain("vXfsVertexRed = xfsVertexRed");
      expect(shader.uniforms.xfsAlphaCutoff!.value).toBe(0);
    } else {
      expect(shader.fragmentShader).toContain("#include <alphamap_fragment>");
      expect(shader.fragmentShader).toContain("xfsCapGradient");
    }
    material.dispose();
  }
  map.dispose();
});

test("v3 manifests carry the profile sample count and validated material-instance parameters", () => {
  const png = (name: string) => ({ url: `/assets/hair/${name}.png`, sha256: digest });
  const entry = { ...manifest.entries[0], strandId: png("id"), strandGradient: png("root"),
    capMask: png("cap_mask"), capGradient: png("cap_gradient"),
    profile: { sourceSha256: digest, sampleCount: 127, id: [{ value: 0, color: [1, 2, 3] }, { value: 1, color: [4, 5, 6] }],
      rootToTip: [{ value: 0, color: [7, 8, 9] }, { value: 1, color: [10, 11, 12] }] },
    material: { alphaCutoff: 0, shadowStrength: 0.9, shadowMin: -0.4 } };
  const [parsed] = parseHairManifest({ schema: "xfs/local-hair-assets-3", entries: [entry] });
  expect(parsed!.profile!.sampleCount).toBe(127);
  expect(parsed!.material).toEqual(resolveHairMaterial({ alphaCutoff: 0, shadowStrength: 0.9, shadowMin: -0.4 }));
  expect(() => parseHairManifest({ schema: "xfs/local-hair-assets-3", entries: [{ ...entry, material: undefined }] })).toThrow();
  expect(() => parseHairManifest({ schema: "xfs/local-hair-assets-3", entries: [{ ...entry, material: { tint: 1 } }] })).toThrow();
  expect(() => parseHairManifest({ schema: "xfs/local-hair-assets-3", entries: [{ ...entry,
    profile: { ...entry.profile, sampleCount: 1 } }] })).toThrow();
  // Legacy v2 stays readable and reports no material; the scene uses (and labels) hair.mt template defaults.
  const [legacy] = parseHairManifest({ schema: "xfs/local-hair-assets-2", entries: [{ ...entry, material: undefined,
    profile: { ...entry.profile, sampleCount: undefined } }] });
  expect(legacy!.material).toBeUndefined();
  expect(legacy!.profile!.sampleCount).toBeUndefined();
});

test("profile texture holds the exact baked ID and root-to-tip rows the shader fetches", () => {
  const rgb = (r: number, g: number, b: number) => [r, g, b] as [number, number, number];
  const profile = { id: [{ value: 0, color: rgb(0, 0, 0) }, { value: 1, color: rgb(255, 255, 255) }],
    rootToTip: [{ value: 0, color: rgb(255, 0, 0) }, { value: 1, color: rgb(0, 0, 255) }] };
  const texture = hairProfileTexture(profile, 5, "srgb-decoded");
  const data = texture.image.data as Float32Array, id = bakeHairProfile(profile.id, 5), root = bakeHairProfile(profile.rootToTip, 5);
  expect(texture.image.width).toBe(5); expect(texture.image.height).toBe(2);
  expect(texture.magFilter).toBe(THREE.NearestFilter);
  expect([...data.slice(8, 11)]).toEqual([...id.slice(6, 9)]);
  expect([...data.slice((5 + 4) * 4, (5 + 4) * 4 + 3)]).toEqual([...root.slice(12, 15)]);
  texture.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array([0.25, 0, 0, 1, 0.75, 0, 0, 1]), 4));
  expect(attachHairVertexRed(geometry)).toBe(true);
  expect([...(geometry.getAttribute("xfsVertexRed").array as Float32Array)]).toEqual([0.25, 0.75]);
});
