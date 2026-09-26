import { parseCollection, type PresetCollection } from "./preset-collection";
import type { PackageExperimental, PackageOmission } from "./package-filter";
import type { EyePlateHeadRecord } from "./eye-plate-head-source";
import type { ExportRoute } from "./engines/layered-makeup/finish-export";
import type { PresetDiagnostics } from "./export-diagnostics";
import type { PlateUvRecord } from "./plate-reach";

export type PackageAction = "check" | "build";
/**
 * A packaged preset's stable identity and its export route (results from before routes were recorded lack `route`).
 * `diagnostics` appears only on a prepared test candidate's presets that carry diagnostic knobs (export-diagnostics.ts).
 */
export type PackagePresetIdentity = { id: string; revision: number; appearance: string; route?: ExportRoute; diagnostics?: PresetDiagnostics };
/** `modName`/`selectorLabel` come from the shared mod-branding module via the export plan. */
export type PackageCheck = { ready: true; collectionId: string; namespace: string; modName: string; selectorLabel: string; presets: PackagePresetIdentity[];
  originalPresetCount: number; omissions: PackageOmission[]; packagedCollectionSha256: string;
  /** Included layers whose finish adapter still needs in-game confirmation. */
  experimental?: PackageExperimental[];
  /**
   * The packaged eye plate's lifts in millimetres, one render chunk each: `[0.4]` unless a diagnostic candidate
   * asks for others. Always set by Check; answers from older hosts lack it.
   */
  plateLiftsMm?: number[];
  /**
   * The eye plate whose UV footprint decided which presets reach it: the plate the host last prepared, or null
   * when none has been prepared yet (Build then judges against the plate it packages). Older answers lack it.
   */
  plateUv?: PlateUvRecord | null;
  /**
   * Plain notes for the user about this Check, e.g. that plate reach is judged at Build when no plate was prepared
   * for this route yet (PIPE-36). Older answers lack it.
   */
  notes?: string[] };
/**
 * Which eye plate was packaged: the built-in plate derived from the installed game (with the head resources it
 * was cut from: base game, installed mods or the base-game escape hatch), or a developer override.
 */
export type PackagePlate = { source: "derived"; recipeId: string; recipeRevision: number; sourceRevision: string; cacheKey: string;
  meshSha256: string; morphSha256: string; head?: EyePlateHeadRecord } | { source: "override"; meshSha256: string; morphSha256: string };
export type PackageBuild = { package: string; manifest: string; modName: string; selectorLabel: string;
  archiveSha256: string; presetCount: number; plate?: PackagePlate;
  originalPresetCount: number; omissions: PackageOmission[]; packagedCollectionSha256: string;
  experimental?: PackageExperimental[];
  /** As in Check; results from before lifts were recorded lack it. */
  plateLiftsMm?: number[];
  /** The packaged plate's UV footprint, which decided the plate-reach omissions; results from before it was recorded lack it. */
  plateUv?: PlateUvRecord;
  installed: false; gameRenderingVerified: false };
/** The error code the package CLI reports on its machine error line (`XFS_PACKAGE_ERROR=`), if any. */
export function packageErrorCode(stderr: string): string | null {
  const line = stderr.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_ERROR="));
  if (!line) return null;
  try { const code = (JSON.parse(line.slice("XFS_PACKAGE_ERROR=".length)) as { code?: unknown }).code; return typeof code === "string" ? code : null; }
  catch { return null; }
}

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
