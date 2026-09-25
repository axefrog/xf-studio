import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { depotPathRegex } from "./eye-plate-wolvenkit";
import type { UncookRun } from "./game-asset-export";
import { runProcessTree } from "./process-tree";

/**
 * Process adapter: the only place game asset export starts WolvenKit CLI. One `uncook` call
 * exports the named resources; with materials it also passes the game folder, so WolvenKit
 * resolves linked meshes, rigs and `.mi` chains and decodes every texture those use.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export class ExportToolError extends Error {
  constructor(readonly code: "preview_tool_failed" | "preview_tool_missing" | "preview_cancelled", message: string, readonly output = "") { super(message); }
}

export function uncookArguments(archivePath: string, depotPaths: readonly string[], outDir: string, gameRoot: string | null): string[] {
  return ["uncook", archivePath, "-o", outDir, "-r", depotPathRegex(depotPaths), "-u", "--uext", "png",
    "--mesh-export-type", "MeshOnly", ...(gameRoot ? ["-gp", gameRoot] : []), "-v", "Minimal"];
}

export function createWolvenKitUncook(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): UncookRun {
  return async ({ source, depotPaths, outDir, withMaterials, signal }) => {
    if (!cli || !existsSync(cli) || !statSync(cli).isFile())
      throw new ExportToolError("preview_tool_missing", "XF Studio needs WolvenKit CLI to read your game files, and it isn't set up yet.");
    if (signal?.aborted) throw new ExportToolError("preview_cancelled", "Preparing the 3D preview was cancelled.");
    const args = uncookArguments(source.archivePath, depotPaths, outDir, withMaterials ? source.gameRoot : null);
    const result = await runProcessTree(cli, args, { signal, timeoutMs, keep: 64_000 });
    const output = (result.stdout + result.stderr).slice(-4000);
    if (result.stopped === "cancelled") throw new ExportToolError("preview_cancelled", "Preparing the 3D preview was cancelled.", output);
    if (result.stopped === "timeout") throw new ExportToolError("preview_tool_failed", `${basename(cli)} exceeded its time limit.`, output);
    // WolvenKit logs per-file material warnings on success; callers check the exported files instead.
    if (result.error || result.exitCode !== 0 || /Unhandled exception/i.test(output))
      throw new ExportToolError("preview_tool_failed", `${basename(cli)} uncook failed${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}.`, output);
  };
}
