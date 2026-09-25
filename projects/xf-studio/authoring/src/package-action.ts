import { parseCollection, type PresetCollection } from "./preset-collection";
import type { PackageExperimental, PackageOmission } from "./package-filter";

export type PackageAction = "check" | "build";
/** `modName`/`selectorLabel` come from the shared mod-branding module via the export plan. */
export type PackageCheck = { ready: true; collectionId: string; namespace: string; modName: string; selectorLabel: string; presets: { id: string; revision: number; appearance: string }[];
  originalPresetCount: number; omissions: PackageOmission[]; packagedCollectionSha256: string;
  /** Included layers whose finish adapter still needs in-game confirmation. */
  experimental?: PackageExperimental[] };
/** Which eye plate was packaged: the built-in plate derived from the installed game, or a developer override. */
export type PackagePlate = { source: "derived"; recipeId: string; recipeRevision: number; sourceRevision: string; cacheKey: string;
  meshSha256: string; morphSha256: string } | { source: "override"; meshSha256: string; morphSha256: string };
export type PackageBuild = { package: string; manifest: string; modName: string; selectorLabel: string;
  archiveSha256: string; presetCount: number; plate?: PackagePlate;
  originalPresetCount: number; omissions: PackageOmission[]; packagedCollectionSha256: string;
  experimental?: PackageExperimental[];
  installed: false; gameRenderingVerified: false };
export class PackageRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Presentation-independent request contract; the server decides every filesystem and tool path. */
export async function requestPackage(action: PackageAction, collection: PresetCollection): Promise<PackageCheck | PackageBuild> {
  const response = await fetch("/api/package", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, collection: parseCollection(collection) }) });
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new PackageRequestError("transport", "Restart the studio server to enable local package builds.");
  const result = await response.json();
  if (!response.ok) throw new PackageRequestError(result.code ?? "package_failed", result.error ?? "Package request failed.");
  return result;
}
