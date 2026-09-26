import type { EyePlateHeadRecord } from "./eye-plate-head-source";
import type { ExportRoute } from "./engines/layered-makeup/finish-export";
import type { PresetDiagnostics } from "./export-diagnostics";
import type { PackageBuildResult, PackageCheckResult } from "./platform/api";

export type PackageAction = "check" | "build";
/**
 * A packaged eye-makeup preset's stable identity and its export route (results from before routes were recorded lack `route`).
 * `diagnostics` appears only on a prepared test candidate's presets that carry diagnostic knobs (export-diagnostics.ts).
 */
export type PackagePresetIdentity = { id: string; revision: number; appearance: string; route?: ExportRoute; diagnostics?: PresetDiagnostics };
/**
 * Which eye plate was packaged: the built-in plate derived from the installed game (with the head resources it
 * was cut from: base game, installed mods or the base-game escape hatch), or a developer override. Eye makeup's
 * feature report records it in its `details.plate`.
 */
export type PackagePlate = { source: "derived"; recipeId: string; recipeRevision: number; sourceRevision: string; cacheKey: string;
  meshSha256: string; morphSha256: string; head?: EyePlateHeadRecord } | { source: "override"; meshSha256: string; morphSha256: string };

export class PackageRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Presentation-independent request contract: the collection's stored form (with its package plan); the server
 * decides every filesystem and tool path, and answers every product the collection builds.
 */
export async function requestPackage(action: PackageAction, collection: unknown): Promise<PackageCheckResult | PackageBuildResult> {
  const response = await fetch("/api/package", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, collection }) });
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new PackageRequestError("transport", "Restart the studio server to enable local package builds.");
  const result = await response.json();
  if (!response.ok) throw new PackageRequestError(result.code ?? "package_failed", result.error ?? "Package request failed.");
  return result;
}
