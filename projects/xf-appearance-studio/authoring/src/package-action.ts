import { parseCollection, type PresetCollection } from "./preset-collection";

export type PackageAction = "check" | "build";
export type PackageCheck = { ready: true; collectionId: string; namespace: string; presets: { id: string; revision: number; appearance: string }[] };
export type PackageBuild = { package: string; manifest: string; archiveSha256: string; presetCount: number;
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
