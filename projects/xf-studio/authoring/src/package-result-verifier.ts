import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { PackageBuild } from "./package-action";
import type { PresetCollection } from "./preset-collection";
import type { preparePackageCollection } from "./package-filter";

/** Verify the tool's final identity against the host-owned snapshot and output root. */
export function verifyPackageBuildResult(
  built: PackageBuild,
  collection: PresetCollection,
  prepared: ReturnType<typeof preparePackageCollection>,
  sourceJson: string,
  distRoot: string,
): void {
  const final = resolve(built.package ?? "");
  const manifestPath = resolve(built.manifest ?? "");
  const root = resolve(distRoot);
  if (!final.startsWith(root + sep) || manifestPath !== resolve(final, "manifest.json") || !statSync(manifestPath).isFile())
    throw Error("Package result is outside the local dist directory.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sourceHash = createHash("sha256").update(sourceJson).digest("hex");
  const packagedHash = createHash("sha256").update(JSON.stringify(prepared.packaged)).digest("hex");
  const identities = prepared.plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance }));
  if (manifest.schema !== "xfs/local-package-1" || manifest.collectionId !== collection.id ||
      manifest.collectionSha256 !== sourceHash || manifest.packagedCollectionSha256 !== packagedHash ||
      manifest.originalPresetCount !== collection.presets.length ||
      JSON.stringify(manifest.omissions) !== JSON.stringify(prepared.omissions) ||
      manifest.namespace !== prepared.plan.namespace || JSON.stringify(manifest.presets) !== JSON.stringify(identities) ||
      manifest.verifiedPresetCount !== prepared.packaged.presets.length ||
      built.archiveSha256 !== manifest.files?.[0]?.sha256 || built.presetCount !== prepared.packaged.presets.length ||
      built.originalPresetCount !== collection.presets.length || built.packagedCollectionSha256 !== packagedHash ||
      JSON.stringify(built.omissions) !== JSON.stringify(prepared.omissions) ||
      built.installed !== false || built.gameRenderingVerified !== false ||
      manifest.installed !== false || manifest.gameRenderingVerified !== false)
    throw Error("Package manifest does not match this collection snapshot.");
}
