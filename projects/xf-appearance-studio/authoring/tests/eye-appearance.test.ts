import { describe, expect, test } from "bun:test";
import { parseEyeManifest, prepareEyeAppearances, resolveEyeAsset, verifyEyeBytes, type EyeAsset } from "../src/eye-appearance";

const bytes = new TextEncoder().encode("abc");
const asset: EyeAsset = {
  resourceHash: "7132639559252259433", definition: "eye_16_diffuse", label: "Fixture eye",
  url: "/assets/eyes/fixture.png", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  width: 512, height: 512,
  providers: [{ name: "Fixture", author: "Test", version: "1", url: "https://example.test/source" }],
};
const manifest = (entries: EyeAsset[] = [asset]) => ({ schema: "xfs/local-eye-assets-1", entries });
const ref = { resourceHash: asset.resourceHash, definition: asset.definition };

describe("local saved-eye diffuse resolution", () => {
  test("requires both app identity and appearance definition, not names or texture filename", () => {
    expect(resolveEyeAsset([asset], [{ ...ref }])).toEqual([asset]);
    expect(resolveEyeAsset([asset], [{ ...ref, resourceHash: "123" }])).toEqual([]);
    expect(resolveEyeAsset([asset], [{ ...ref, definition: "eye_17_diffuse" }])).toEqual([]);
    expect(resolveEyeAsset([asset], [{ ...ref, definition: "EYE_16_DIFFUSE" }])).toEqual([]);
  });

  test("preloaded synchronous switching cannot retain a previous save's successful map", async () => {
    let loads = 0;
    const texture = { id: "decoded fixture" };
    const prepared = await prepareEyeAppearances(async () => { loads++; return texture; }, {
      manifest: async () => manifest(), bytes: async () => bytes,
    });
    expect(prepared.select().status.reason).toBe("no-save");
    for (let i = 0; i < 20; i++) {
      const matched = prepared.select([ref, ref]); // Duplicate saved references are not ambiguity.
      expect(matched.texture).toBe(texture);
      expect(matched.status.kind).toBe("matched");
      expect(matched.status.asset?.providers[0].name).toBe("Fixture");
      const other = prepared.select([{ ...ref, definition: "different" }]);
      expect(other.texture).toBeUndefined();
      expect(other.status.reason).toBe("unresolved");
    }
    expect(loads).toBe(1);
  });

  test("missing manifest, missing image and failed decoder all remain explicit reference states", async () => {
    const missingManifest = await prepareEyeAppearances(async () => ({}), {
      manifest: async () => { throw Error("not installed"); }, bytes: async () => bytes,
    });
    expect(missingManifest.select([ref])).toEqual({ status: {
      kind: "reference", reason: "unavailable", message: "Local eye assets are unavailable; using the reference eye texture.", error: "not installed",
    } });
    for (const stage of ["image", "decode"]) {
      const prepared = await prepareEyeAppearances(async () => { throw Error("decode failed"); }, {
        manifest: async () => manifest(), bytes: async () => { if (stage === "image") throw Error("image missing"); return bytes; },
      });
      expect(prepared.select([ref]).texture).toBeUndefined();
      expect(prepared.select([ref]).status.reason).toBe("unavailable");
      expect(prepared.select([ref]).status.error).toBe(stage === "image" ? "image missing" : "decode failed");
    }
  });

  test("image digest is checked before decoder and changed local bytes cannot masquerade as provenance", async () => {
    await expect(verifyEyeBytes(bytes, asset.sha256)).resolves.toBeUndefined();
    let decoded = false;
    const prepared = await prepareEyeAppearances(async () => { decoded = true; return {}; }, {
      manifest: async () => manifest(), bytes: async () => new TextEncoder().encode("abd"),
    });
    expect(decoded).toBe(false);
    expect(prepared.select([ref]).status.error).toContain("SHA-256");
    expect(prepared.select([ref]).texture).toBeUndefined();
  });

  test("conflicting matches fall back instead of choosing an arbitrary eye", async () => {
    const second = { ...asset, definition: "another_eye" };
    const prepared = await prepareEyeAppearances(async () => ({}), {
      manifest: async () => manifest([asset, second]), bytes: async () => bytes,
    });
    expect(prepared.select([ref, second]).status.reason).toBe("ambiguous");
    expect(prepared.select([ref, second]).texture).toBeUndefined();
  });

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
});
