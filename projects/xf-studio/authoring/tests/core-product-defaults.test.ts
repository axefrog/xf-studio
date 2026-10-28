import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NO_PRODUCT, type ProductDefaults } from "../src/platform/api/product";
import { requirementsForProducts } from "../src/installation/framework-catalogue";
import { checkFrameworkVersions } from "../src/installation/framework-versions";
import { detectGameInstalls, type DetectionHostPort } from "../src/installation/install-detection";
import { inspectLocalPackageCandidate } from "../src/installation/host/mod-install-transport";
import { diagnosticModlist, diagnosticPlacement } from "../src/installation/host/runtime-diagnostic-stage";
import { tempDir } from "./temp-dir";

const product: ProductDefaults = { ...NO_PRODUCT, modName: "Synthetic mod", legacyFeature: "synthetic",
  legacyModFolders: ["Earlier synthetic"], predecessorMods: ["Predecessor synthetic"],
  unsupportedStoreMessage: "Synthetic store policy.", requirements: [{ framework: "cet", minimum: "1.0.0", reason: "Synthetic fixture." }] };

test("empty and synthetic product compositions supply framework and placement policy without makeup defaults", () => {
  const port = { readText: () => null, readBytes: () => null, isFile: () => false };
  const input = { gameRoot: null, launchRoute: "direct" as const, mo2Root: null, mo2ProfileId: null };
  expect(requirementsForProducts()).toEqual([]);
  expect(checkFrameworkVersions(port, input).requirements).toEqual([]);
  const synthetic = checkFrameworkVersions(port, input, product);
  expect([synthetic.mod, synthetic.requirements]).toEqual([product.modName, product.requirements]);
  const list = "+Other\n+Earlier synthetic\n+Predecessor synthetic\n";
  expect(diagnosticPlacement(list, [], undefined, product)).toMatchObject({ modName: product.modName, anchor: "Earlier synthetic" });
  expect(diagnosticModlist(list, [], undefined, product)).toContain("-Predecessor synthetic");
  expect(diagnosticModlist(list)).toContain("+Predecessor synthetic");
});

test("store detection uses the supplied product's message and preserves install evidence", async () => {
  const port: DetectionHostPort = { platform: "win32", env: () => undefined, drives: async () => [],
    readText: () => null, readBinary: () => null, isFile: () => false, directories: () => null, files: () => null,
    registry: async key => key === "HKLM\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Package"
      ? "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Package\r\n" +
        "    Fixture.Cyberpunk2077_1.0.0.0_x64__fixture    REG_SZ    {00000000-0000-0000-0000-000000000000}#Fixture.Cyberpunk2077_fixture\r\n" : null };
  const plain = await detectGameInstalls(port), synthetic = await detectGameInstalls(port, null, product);
  expect(synthetic.unsupported).toHaveLength(1);
  expect(synthetic.unsupported[0]!.message).toBe(product.unsupportedStoreMessage);
  expect(synthetic.issues.find(issue => issue.code === "store_unsupported")?.detail).toBe(product.unsupportedStoreMessage);
  expect(synthetic.unsupported.map(({ message, ...evidence }) => evidence))
    .toEqual(plain.unsupported.map(({ message, ...evidence }) => evidence));
});

test("released v1 candidate identities use the supplied product adapter", () => {
  const store = tempDir("xfs-product-candidate-"), folder = join(store, "candidate"), payload = join(folder, "archive", "pc", "mod");
  mkdirSync(payload, { recursive: true });
  const files = ["xfs_fixture.archive", "xfs_fixture.archive.xl"].map(name => {
    const bytes = new TextEncoder().encode(name);
    writeFileSync(join(payload, name), bytes);
    return { path: `archive/pc/mod/${name}`, bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
  });
  writeFileSync(join(folder, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-1", namespace: "xfs_fixture",
    verifiedUnpackedFiles: 2, installed: false, gameRenderingVerified: false, files }));
  expect(inspectLocalPackageCandidate(store, "candidate", product).manifest.features)
    .toEqual([{ feature: "synthetic", namespace: "xfs_fixture" }]);
});
