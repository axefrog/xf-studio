import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packagePresetIdentities } from "../src/package-filter";
import { parseCollection } from "../src/preset-collection";
import { verifyPackageBuildResult } from "../src/package-result-verifier";
import { preparePackageCollection } from "./fixtures/eye-exporter";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** A staged candidate for `value` under `dist/candidate`, with the manifest and build result the builder writes. */
function candidate(dist: string, value: unknown = fixture) {
  const final = join(dist, "candidate");
  mkdirSync(final, { recursive: true });
  const collection = parseCollection(value);
  const prepared = preparePackageCollection(value);
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
    presets: packagePresetIdentities(prepared.plan), plateLiftsMm: prepared.plan.plate.liftsMm,
    verifiedPresetCount: prepared.packaged.presets.length, files: [
      { path: `archive/pc/mod/${archiveName}`, bytes: 15, sha256: archiveHash },
      { path: `archive/pc/mod/${xlName}`, bytes: 10, sha256: sha("xl fixture") }],
    installed: false, gameRenderingVerified: false };
  const built = { package: final, manifest: manifestPath, modName: prepared.plan.modName,
    selectorLabel: prepared.plan.selectorLabel, archiveSha256: archiveHash,
    presetCount: prepared.packaged.presets.length, originalPresetCount: collection.presets.length,
    omissions, packagedCollectionSha256: packagedHash, plateLiftsMm: prepared.plan.plate.liftsMm,
    installed: false as const, gameRenderingVerified: false as const };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { final, collection, prepared, source, manifest, manifestPath, built, payloadRoot, xlName };
}
/** A junction (Windows) or directory link; null when this account cannot create one. */
function link(target: string, path: string): string | null {
  try { symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir"); return path; }
  catch (error) { if (String(error).includes("EPERM")) return null; throw error; }
}

test("final package identity verification works under a relocated host-owned dist root", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-portable-package-"))); // Canonical: CI temp folders use 8.3 short names.
  try {
    const dist = join(root, "private", "packages");
    const { final, collection, prepared, source, manifest, manifestPath, built, payloadRoot, xlName } = candidate(dist);
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).not.toThrow();
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, join(root, "other"))).toThrow("outside the local dist");
    expect(() => verifyPackageBuildResult({ ...built, archiveSha256: "b".repeat(64) }, collection, prepared, source, dist)).toThrow("does not match");
    expect(() => verifyPackageBuildResult({ ...built, modName: "XF Studio" }, collection, prepared, source, dist)).toThrow("does not match");
    expect(() => verifyPackageBuildResult(built, collection, prepared, source + " ", dist)).toThrow("does not match");
    writeFileSync(join(payloadRoot, xlName), "changed XL");
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("payload");
    writeFileSync(join(payloadRoot, xlName), "xl fixture");
    const linked = link(final, join(dist, "linked"));
    if (linked) expect(() => verifyPackageBuildResult({ ...built, package: linked, manifest: join(linked, "manifest.json") },
      collection, prepared, source, dist)).toThrow("outside the local dist");
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, installed: true }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    // PIPE-24: the manifest must record each preset's route as the host's own filter planned it.
    for (const presets of [manifest.presets.map(({ route: _route, ...rest }) => rest),
      manifest.presets.map((p, i) => i ? p : { ...p, route: p.route === "flat" ? "faceted" : "flat" })]) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, presets }));
      expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    }
    // PIPE-30: the plate lifts are recorded in the manifest and the build result.
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, plateLiftsMm: undefined }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyPackageBuildResult({ ...built, plateLiftsMm: [0] }, collection, prepared, source, dist)).toThrow("does not match");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a diagnostic candidate's lifts and per-preset knobs are recorded, so it cannot pass as a production package", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-diagnostic-package-")));
  try {
    const [first, second] = fixture.presets.map((p: { id: string }) => p.id);
    const value = { ...fixture, diagnostics: { schema: "xfs/export-diagnostics-1", presets: {
      [first]: { plateLiftMm: 0 }, [second]: { surface: { RoughnessMetalnessAlpha: 0 } } } } };
    const dist = join(root, "dist");
    const { collection, prepared, source, manifest, manifestPath, built } = candidate(dist, value);
    expect(manifest.plateLiftsMm).toEqual([0, 0.4]);
    expect(manifest.presets[0]).toMatchObject({ id: first, diagnostics: { plateLiftMm: 0 } });
    expect(manifest.presets[1]).toMatchObject({ id: second, diagnostics: { surface: { RoughnessMetalnessAlpha: 0 } } });
    expect(manifest.presets.slice(2).every(p => !("diagnostics" in p))).toBe(true);
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).not.toThrow();
    // The same files described as a production package are refused.
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, presets: manifest.presets.map(({ diagnostics: _d, ...rest }) => rest) }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, plateLiftsMm: [0.4] }));
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("does not match");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("containment: an outside path reaching in through a junction is refused; a missing manifest is the plain error", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-contained-package-")));
  try {
    const dist = join(root, "dist");
    const { collection, prepared, source, built, manifestPath } = candidate(dist);
    mkdirSync(join(root, "outside"));
    // Its canonical path is inside dist, but the path itself is not below dist.
    const through = link(dist, join(root, "outside", "door"));
    if (through) {
      for (const pkg of [join(through, "candidate"), join(root, "outside", "door", "candidate")])
        expect(() => verifyPackageBuildResult({ ...built, package: pkg, manifest: join(pkg, "manifest.json") },
          collection, prepared, source, dist)).toThrow("Package result is outside the local dist directory.");
      const named = link(join(dist, "candidate"), join(root, "outside", "candidate"));
      if (named) expect(() => verifyPackageBuildResult({ ...built, package: named, manifest: join(named, "manifest.json") },
        collection, prepared, source, dist)).toThrow("outside the local dist");
    }
    rmSync(manifestPath);
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, dist)).toThrow("Package result is outside the local dist directory.");
    expect(() => verifyPackageBuildResult({ ...built, package: join(dist, "missing"), manifest: join(dist, "missing", "manifest.json") },
      collection, prepared, source, dist)).toThrow("Package result is outside the local dist directory.");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The Windows 8.3 short form of an existing path, or null when the volume has none. */
function shortPath(path: string): string | null {
  // Unquoted: Bun escapes quotes inside cmd arguments. Temp folders rarely contain spaces; skip when they do.
  if (process.platform !== "win32" || /[\s&^|<>()]/.test(path)) return null;
  const run = Bun.spawnSync(["cmd", "/d", "/c", `for %I in (${path}) do @echo %~sI`], { stdout: "pipe", stderr: "pipe" });
  const short = run.stdout.toString().trim();
  return run.exitCode === 0 && short && short.toLowerCase() !== path.toLowerCase() ? short : null;
}

test("a dist root named by its 8.3 short form accepts the builder's long-form result (as on CI runners)", () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-long-named-package-folder-")));
  try {
    const dist = join(root, "private-packages-with-a-long-name");
    const { collection, prepared, source, built } = candidate(dist);
    const short = shortPath(dist);
    if (!short) return; // 8.3 names are disabled on this volume; CI covers the case.
    // The builder names its result by the canonical (long) path; the host passes the short one, and the reverse.
    expect(() => verifyPackageBuildResult(built, collection, prepared, source, short)).not.toThrow();
    const shortFinal = join(short, "candidate");
    expect(() => verifyPackageBuildResult({ ...built, package: shortFinal, manifest: join(shortFinal, "manifest.json") },
      collection, prepared, source, short)).not.toThrow();
    expect(() => verifyPackageBuildResult({ ...built, package: shortFinal, manifest: join(shortFinal, "manifest.json") },
      collection, prepared, source, dist)).toThrow("outside the local dist");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
