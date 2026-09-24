import { expect, test } from "bun:test";
import { NATIVE_EYE_SOURCE, parseNativeEyeManifest, validateNativeEyeParts, verifyNativeEyeBytes } from "../src/native-eye-intake";

const manifest = {
  schema: "xfs/local-native-eye-1", status: "staged-research-only",
  source: NATIVE_EYE_SOURCE,
  asset: { url: "/assets/native-eye/eye-h091.glb", sha256: NATIVE_EYE_SOURCE.glbSha256, bytes: 2048 },
  limitation: "morph-bind-and-material-policy-unproven",
} as const;
const bones = Array.from({ length: 55 }, (_, i) => `other_${i}`).concat("l_J_eye_JNT", "r_J_eye_JNT");
const morphs = Array.from({ length: 21 }, (_, i) => `h${String(i * 10 + 11).padStart(3, "0")}_eyes`);
const parts = [
  { name: "submesh_00_LOD_1_doubled", vertices: 12393, bones, morphs },
  { name: "submesh_01_LOD_1", vertices: 668, bones, morphs },
  { name: "submesh_02_LOD_1", vertices: 152, bones, morphs },
];

test("native eye manifest pins exact source and remains research-only", () => {
  expect(parseNativeEyeManifest(manifest)).toEqual(manifest);
  for (const altered of [
    { ...manifest, status: "ready" },
    { ...manifest, source: { ...NATIVE_EYE_SOURCE, morphSha256: "0".repeat(64) } },
    { ...manifest, asset: { ...manifest.asset, url: "/assets/native-eye/../head.glb" } },
    { ...manifest, asset: { ...manifest.asset, bytes: 64 * 1024 * 1024 } },
  ]) expect(() => parseNativeEyeManifest(altered)).toThrow();
  const detached = parseNativeEyeManifest(manifest);
  expect(detached).not.toBe(manifest);
  expect(detached.asset).not.toBe(manifest.asset);
});

test("native eye intake requires the full three-part eye/eyelash/wetness geometry", () => {
  expect(() => validateNativeEyeParts(parts)).not.toThrow();
  expect(() => validateNativeEyeParts(parts.slice(1))).toThrow();
  expect(() => validateNativeEyeParts([parts[0]!, parts[0]!, parts[2]!])).toThrow();
  expect(() => validateNativeEyeParts([{ ...parts[0]!, vertices: 662 }, parts[1]!, parts[2]!])).toThrow();
  expect(() => validateNativeEyeParts([{ ...parts[0]!, morphs: morphs.filter(m => m !== "h091_eyes") }, parts[1]!, parts[2]!])).toThrow();
  expect(() => validateNativeEyeParts([{ ...parts[0]!, bones: bones.slice(1) }, parts[1]!, parts[2]!])).toThrow();
});

test("native eye bytes require complete GLB header and pinned digest before any use", async () => {
  const parsed = parseNativeEyeManifest(manifest);
  await expect(verifyNativeEyeBytes(new Uint8Array(2048), parsed)).rejects.toThrow("complete GLB");
  const glb = new Uint8Array(2048);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  await expect(verifyNativeEyeBytes(glb, parsed)).rejects.toThrow("SHA-256");
  await expect(verifyNativeEyeBytes(glb.subarray(0, 1024), parsed)).rejects.toThrow("length");
});
