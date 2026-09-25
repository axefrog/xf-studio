import { describe, expect, test } from "bun:test";
import { parseEyeManifest, roughnessRedToGreen, verifyEyeBytes, type EyeAsset } from "../src/eye-study-fixture";

// The render-fidelity study's historical saved-eye pair: strict parsing and digest checks only. The preview's eyes
// are resolved (render record v3), never read from this fixture.
const asset: EyeAsset = {
  resourceHash: "7132639559252259433", definition: "fixture_eye", label: "Fixture eye",
  url: "/assets/eyes/fixture.png", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  width: 512, height: 512,
  providers: [{ name: "Fixture", author: "Test", version: "1", url: "https://example.test/source" }],
};
const manifest = (entries: EyeAsset[] = [asset]) => ({ schema: "xfs/local-eye-assets-1", entries });

describe("render-fidelity study eye fixture", () => {
  test("malformed identities, duplicate mappings and external/traversal image paths are rejected", () => {
    expect(parseEyeManifest(manifest())).toEqual([asset]);
    expect(() => parseEyeManifest(manifest([asset, asset]))).toThrow("Duplicate");
    for (const patch of [
      { resourceHash: "18446744073709551616" }, { resourceHash: "07132639559252259433" },
      { url: "https://example.test/eyes.png" }, { url: "/assets/eyes/../fixture.png" },
      { url: "/assets/eyes/%2e%2e/fixture.png" }, { sha256: "bad" }, { width: 0 }, { height: 4097 },
      { providers: [] }, { definition: "" },
    ]) expect(() => parseEyeManifest(manifest([{ ...asset, ...patch }]))).toThrow();
  });

  test("version-2 roughness entries are checked; image digests are verified", async () => {
    const optical: EyeAsset = { ...asset, roughness: { url: "/assets/eyes/fixture-roughness.png", sha256: asset.sha256, width: 512, height: 512, scale: 0.493420988 } };
    expect(parseEyeManifest({ schema: "xfs/local-eye-assets-2", entries: [optical] })).toEqual([optical]);
    expect(() => parseEyeManifest({ schema: "xfs/local-eye-assets-1", entries: [optical] })).toThrow();
    await expect(verifyEyeBytes(new TextEncoder().encode("abc"), asset.sha256)).resolves.toBeUndefined();
    await expect(verifyEyeBytes(new TextEncoder().encode("abd"), asset.sha256)).rejects.toThrow("SHA-256");
  });

  test("the study's roughness channel adapter copies exact red bytes to Three's green channel", () => {
    const input = new Uint8Array([8, 43, 90, 255, 132, 4, 16, 255]);
    expect([...roughnessRedToGreen(input)]).toEqual([8, 8, 90, 255, 132, 132, 16, 255]);
    expect(() => roughnessRedToGreen(new Uint8Array(3))).toThrow();
  });
});
