import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, readdirSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { PackageBuild } from "./package-action";
import type { PresetCollection } from "./preset-collection";
import type { preparePackageCollection } from "./package-filter";
import type { EyePlateManifest } from "./eye-plate-service";

function fileSha256(path: string): string {
  const digest = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), handle = openSync(path, "r");
  try { let count: number; while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0)
    digest.update(buffer.subarray(0, count)); }
  finally { closeSync(handle); }
  return digest.digest("hex");
}

/**
 * Verify the tool's final identity against the host-owned snapshot and output root. When the host
 * prepared the built-in eye plate, the manifest and result must name exactly that verified plate.
 */
export function verifyPackageBuildResult(
  built: PackageBuild,
  collection: PresetCollection,
  prepared: ReturnType<typeof preparePackageCollection>,
  sourceJson: string,
  distRoot: string,
  expectedPlate?: EyePlateManifest,
): void {
  const final = resolve(built.package ?? "");
  const manifestPath = resolve(built.manifest ?? "");
  const root = resolve(distRoot);
  if (!final.startsWith(root + sep) || manifestPath !== resolve(final, "manifest.json") || !statSync(manifestPath).isFile())
    throw Error("Package result is outside the local dist directory.");
  const canonicalRoot = realpathSync(root);
  const canonicalFinal = realpathSync(final);
  if (!canonicalFinal.startsWith(canonicalRoot + sep) || lstatSync(final).isSymbolicLink() ||
      realpathSync(manifestPath) !== resolve(canonicalFinal, "manifest.json") || lstatSync(manifestPath).isSymbolicLink())
    throw Error("Package result is outside the local dist directory or uses a linked path.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceHash = createHash("sha256").update(sourceJson).digest("hex");
  const packagedHash = createHash("sha256").update(JSON.stringify(prepared.packaged)).digest("hex");
  const identities = prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance }));
  const names = [prepared.plan.namespace + ".archive", prepared.plan.namespace + ".archive.xl"];
  const expectedFiles = names.map(name => `archive/pc/mod/${name}`);
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2 ||
      manifest.files.some((entry: any, index: number) => entry?.path !== expectedFiles[index] ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
        typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)))
    throw Error("Package manifest does not match this collection snapshot.");
  const inventory = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error("Package contains a linked path.");
    if (entry.isDirectory()) return inventory(path);
    if (!entry.isFile()) throw Error("Package contains an unexpected file type.");
    return [path.slice(final.length + 1).replaceAll("\\", "/")];
  });
  if (JSON.stringify(inventory(final).sort()) !== JSON.stringify(["manifest.json", ...expectedFiles].sort()))
    throw Error("Package contains unexpected files.");
  for (const entry of manifest.files) {
    const payload = resolve(final, entry.path);
    if (!realpathSync(payload).startsWith(canonicalFinal + sep) ||
        statSync(payload).size !== entry.bytes ||
        fileSha256(payload) !== entry.sha256)
      throw Error("Package payload does not match its manifest.");
  }
  if (manifest.schema !== "xfs/local-package-1" || manifest.collectionId !== collection.id ||
      manifest.collectionSha256 !== sourceHash || manifest.packagedCollectionSha256 !== packagedHash ||
      manifest.originalPresetCount !== collection.presets.length ||
      JSON.stringify(manifest.omissions) !== JSON.stringify(prepared.omissions) ||
      JSON.stringify(manifest.experimental ?? []) !== JSON.stringify(prepared.experimental) ||
      manifest.namespace !== prepared.plan.namespace ||
      manifest.modName !== prepared.plan.modName || manifest.selectorLabel !== prepared.plan.selectorLabel ||
      built.modName !== prepared.plan.modName || built.selectorLabel !== prepared.plan.selectorLabel ||
      JSON.stringify(manifest.presets) !== JSON.stringify(identities) ||
      manifest.verifiedPresetCount !== prepared.packaged.presets.length ||
      built.archiveSha256 !== manifest.files?.[0]?.sha256 || built.presetCount !== prepared.packaged.presets.length ||
      built.originalPresetCount !== collection.presets.length || built.packagedCollectionSha256 !== packagedHash ||
      JSON.stringify(built.omissions) !== JSON.stringify(prepared.omissions) ||
      JSON.stringify(built.experimental ?? []) !== JSON.stringify(prepared.experimental) ||
      built.installed !== false || built.gameRenderingVerified !== false ||
      manifest.installed !== false || manifest.gameRenderingVerified !== false)
    throw Error("Package manifest does not match this collection snapshot.");
  if (expectedPlate) {
    const plate = { source: "derived", recipeId: expectedPlate.recipeId, recipeRevision: expectedPlate.recipeRevision,
      sourceRevision: expectedPlate.source.revisionId, cacheKey: expectedPlate.cacheKey,
      meshSha256: expectedPlate.files.mesh.sha256, morphSha256: expectedPlate.files.morph.sha256 };
    if (JSON.stringify(manifest.plate) !== JSON.stringify(plate) || JSON.stringify(built.plate) !== JSON.stringify(plate))
      throw Error("Package was not built from the prepared eye plate.");
  }
}
