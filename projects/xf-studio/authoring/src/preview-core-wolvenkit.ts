import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { depotPathRegex } from "./eye-plate-wolvenkit";
import { runProcessTree } from "./process-tree";
import type { PreviewCoreTools } from "./preview-core-service";

/**
 * Process adapter: the only place the 3D preview derivation starts WolvenKit CLI.
 * One `uncook` call with the game path does everything: WolvenKit exports the morph target
 * with its linked head mesh and rig, the eye mesh with its skin, both meshes' materials
 * resolved through their `.mi` chains, and every texture those materials use as PNG.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export class PreviewToolError extends Error {
  constructor(readonly code: "preview_tool_failed" | "preview_tool_missing" | "preview_cancelled", message: string, readonly output = "") { super(message); }
}

export function previewUncookArguments(gameRoot: string, archiveDirectory: string, depotPaths: readonly string[], outDir: string): string[] {
  return ["uncook", resolve(gameRoot, archiveDirectory), "-o", outDir, "-r", depotPathRegex(depotPaths), "-u",
    "--uext", "png", "--mesh-export-type", "MeshOnly", "-gp", gameRoot, "-v", "Minimal"];
}

export function createWolvenKitPreviewTools(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): PreviewCoreTools {
  return {
    async uncook({ gameRoot, archiveDirectory, depotPaths, outDir, signal }) {
      if (!cli || !existsSync(cli) || !statSync(cli).isFile())
        throw new PreviewToolError("preview_tool_missing", "XF Studio needs WolvenKit CLI to read your game files, and it isn't set up yet.");
      if (signal?.aborted) throw new PreviewToolError("preview_cancelled", "Preparing the 3D preview was cancelled.");
      const result = await runProcessTree(cli, previewUncookArguments(gameRoot, archiveDirectory, depotPaths, outDir), { signal, timeoutMs, keep: 64_000 });
      const output = (result.stdout + result.stderr).slice(-4000);
      if (result.stopped === "cancelled") throw new PreviewToolError("preview_cancelled", "Preparing the 3D preview was cancelled.", output);
      if (result.stopped === "timeout") throw new PreviewToolError("preview_tool_failed", `${basename(cli)} exceeded its time limit.`, output);
      // WolvenKit logs per-file material warnings on success; the service checks the exported files instead.
      if (result.error || result.exitCode !== 0 || /Unhandled exception/i.test(output))
        throw new PreviewToolError("preview_tool_failed", `${basename(cli)} uncook failed${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}.`, output);
    },
  };
}
