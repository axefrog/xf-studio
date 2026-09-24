import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { preparePackageCollection } from "../src/package-filter";
import { parseCollection } from "../src/preset-collection";
import { verifyPackageBuildResult } from "../src/package-result-verifier";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("final package identity verification works under a relocated host-owned dist root", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-portable-package-"));
  try {
    const dist = join(root, "private", "packages");
    const final = join(dist, "candidate");
    mkdirSync(final, { recursive: true });
    const collection = parseCollection(fixture);
    const prepared = preparePackageCollection(collection);
    const source = JSON.stringify(collection);
    const packagedHash = sha(JSON.stringify(prepared.packaged));
    const omissions = prepared.omissions;
    const archiveHash = "a".repeat(64);
    const manifestPath = join(final, "manifest.json");
    const manifest = { schema: "xfs/local-package-1", collectionId: collection.id,
      collectionSha256: sha(source), packagedCollectionSha256: packagedHash,
      originalPresetCount: collection.presets.length, omissions, namespace: prepared.plan.namespace,
      presets: prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance })),
      verifiedPresetCount: prepared.packaged.presets.length, files: [{ sha256: archiveHash }],
      installed: false, gameRenderingVerified: false };
    const built = { package: final, manifest: manifestPath, archiveSha256: archiveHash,
      presetCount: prepared.packaged.presets.length, originalPresetCount: collection.presets.length,
      omissions, packagedCollectionSha256: packagedHash, installed: false as const, gameRenderingVerified: false as const };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).not.toThrow();
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, join(root, "other"))).toThrow("outside the local dist");
    expect(() => verifyPackageBuildResult({ ...built, archiveSha256: "b".repeat(64) }, collection, prepared, source, dist)).toThrow("does not match");
    expect(() => verifyPackageBuildResult(built, collection, prepared, source + " ", dist)).toThrow("does not match");
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, installed: true }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
