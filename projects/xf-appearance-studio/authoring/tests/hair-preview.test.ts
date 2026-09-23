import { expect, test } from "bun:test";
import { parseHairManifest, selectSavedHair, verifyHairBytes } from "../src/hair-preview";
import { attachHairColor, sampleHairGradient } from "../src/hair-shading";
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

test("strand and cap pigments use distinct source samplers while leaving alpha-map cutout in place", () => {
  const map = new THREE.Texture();
  for (const kind of ["strand", "cap"] as const) {
    const material = new THREE.MeshStandardMaterial({ alphaMap: map });
    if (kind === "strand") attachHairColor(material, {
      kind, id: map, gradient: map, idPalette: map, rootPalette: map,
    });
    else attachHairColor(material, { kind, mask: map, gradient: map });
    const shader = { uniforms: {}, vertexShader: "", fragmentShader:
      "#include <common>\n#include <map_fragment>\n#include <alphamap_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("#include <alphamap_fragment>");
    expect(shader.fragmentShader).toContain("vAlphaMapUv");
    expect(shader.fragmentShader).toContain(kind === "strand" ? "xfsRootPalette" : "xfsCapGradient");
    material.dispose();
  }
  map.dispose();
});
