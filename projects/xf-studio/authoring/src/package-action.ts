import type { EyePlateHeadRecord } from "./eye-plate-head-source";
import type { ExportRoute } from "./engines/layered-makeup/finish-export";
import type { PresetDiagnostics } from "./export-diagnostics";
import { PACKAGE_BUILD_STAGES, type PackageBuildProgress, type PackageBuildResult, type PackageCheckResult } from "./platform/api";

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

/** The running Build's stage, as the host reports it (PIPE-131), or null when none runs or the answer isn't one. */
export async function requestPackageProgress(): Promise<PackageBuildProgress | null> {
  const response = await packageRequest("/api/package/progress", { cache: "no-store" });
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("application/json")) return null;
  const build = (await response.json() as { build?: Partial<PackageBuildProgress> | null }).build;
  return build && (PACKAGE_BUILD_STAGES as readonly unknown[]).includes(build.stage) && Number.isInteger(build.step) && Number.isInteger(build.steps)
    ? { stage: build.stage!, step: build.step!, steps: build.steps!, ...Number.isInteger(build.looks) ? { looks: build.looks! } : {} } : null;
}

/**
 * The progress line for a Build's stage: which step of how many, and what it is doing, in plain words. Each fits the Mod
 * package panel's one line at its narrowest (about 37 characters beside the buttons of a wide panel) for up to 99 looks.
 */
export function packageBuildStageLine(progress: PackageBuildProgress): string {
  const looks = progress.looks === undefined ? "the looks" : progress.looks === 1 ? "1 look" : `${progress.looks} looks`;
  const doing: Record<PackageBuildProgress["stage"], string> = {
    prepare: "Reading your game files…",
    compose: `Painting ${looks}…`,
    convert: `Converting ${looks}…`,
    pack: "Packing the mod…",
    verify: "Checking the packed mod…",
  };
  return `Step ${progress.step} of ${progress.steps}: ${doing[progress.stage]}`;
}

/**
 * Presentation-independent request contract: the collection's stored form (with its package plan); the server
 * decides every filesystem and tool path, and answers every product the collection builds.
 */
/** The package routes' one network read. */
const packageRequest = (path: string, init: RequestInit) => fetch(path, init);

export async function requestPackage(action: PackageAction, collection: unknown): Promise<PackageCheckResult | PackageBuildResult> {
  const response = await packageRequest("/api/package", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, collection }) });
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new PackageRequestError("transport", "Restart XF Studio to build mod files.");
  const result = await response.json();
  if (!response.ok) throw new PackageRequestError(result.code ?? "package_failed", result.error ?? "Package request failed.");
  return result;
}
