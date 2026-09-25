import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { preparePackageCollection } from "../src/package-filter";
import { parseCollection } from "../src/preset-collection";
import { verifyPackageBuildResult } from "../src/package-result-verifier";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("final package identity verification works under a relocated host-owned dist root", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-portable-package-"))); // Canonical: CI temp folders use 8.3 short names.
  try {
    const dist = join(root, "private", "packages");
    const final = join(dist, "candidate");
    mkdirSync(final, { recursive: true });
    const collection = parseCollection(fixture);
    const prepared = preparePackageCollection(collection);
    const source = JSON.stringify(collection);
    const packagedHash = sha(JSON.stringify(prepared.packaged));
    const omissions = prepared.omissions;
    const payloadRoot = join(final, "archive", "pc", "mod");
    mkdirSync(payloadRoot, { recursive: true });
    const archiveName = prepared.plan.namespace + ".archive";
    const xlName = prepared.plan.namespace + ".archive.xl";
    writeFileSync(join(payloadRoot, archiveName), "archive fixture");
    writeFileSync(join(payloadRoot, xlName), "xl fixture");
    const archiveHash = sha("archive fixture");
    const manifestPath = join(final, "manifest.json");
    const manifest = { schema: "xfs/local-package-1", collectionId: collection.id,
      collectionSha256: sha(source), packagedCollectionSha256: packagedHash,
      originalPresetCount: collection.presets.length, omissions, namespace: prepared.plan.namespace,
      modName: prepared.plan.modName, selectorLabel: prepared.plan.selectorLabel,
      presets: prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route })),
      verifiedPresetCount: prepared.packaged.presets.length, files: [
        { path: `archive/pc/mod/${archiveName}`, bytes: 15, sha256: archiveHash },
        { path: `archive/pc/mod/${xlName}`, bytes: 10, sha256: sha("xl fixture") }],
      installed: false, gameRenderingVerified: false };
    const built = { package: final, manifest: manifestPath, modName: prepared.plan.modName,
      selectorLabel: prepared.plan.selectorLabel, archiveSha256: archiveHash,
      presetCount: prepared.packaged.presets.length, originalPresetCount: collection.presets.length,
      omissions, packagedCollectionSha256: packagedHash, installed: false as const, gameRenderingVerified: false as const };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).not.toThrow();
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, join(root, "other"))).toThrow("outside the local dist");
    expect(() => verifyPackageBuildResult({ ...built, archiveSha256: "b".repeat(64) }, collection, prepared, source, dist)).toThrow("does not match");
    expect(() => verifyPackageBuildResult({ ...built, modName: "XF Studio" }, collection, prepared, source, dist)).toThrow("does not match");
    expect(() => verifyPackageBuildResult(built, collection, prepared, source + " ", dist)).toThrow("does not match");
    writeFileSync(join(payloadRoot, xlName), "changed XL");
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("payload");
    writeFileSync(join(payloadRoot, xlName), "xl fixture");
    const linked = join(dist, "linked");
    try {
      symlinkSync(final, linked, process.platform === "win32" ? "junction" : "dir");
      expect(() => verifyPackageBuildResult({ ...built, package: linked, manifest: join(linked, "manifest.json") },
        collection, prepared, source, dist)).toThrow("linked path");
    } catch (error) {
      // Windows accounts without symlink rights cannot create this fixture.
      if (!String(error).includes("EPERM")) throw error;
    }
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, installed: true }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    // PIPE-24: the manifest must record each preset's route as the host's own filter planned it.
    for (const presets of [manifest.presets.map(({ route: _route, ...rest }) => rest),
      manifest.presets.map((p, i) => i ? p : { ...p, route: p.route === "flat" ? "faceted" : "flat" })]) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, presets }));
      expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
