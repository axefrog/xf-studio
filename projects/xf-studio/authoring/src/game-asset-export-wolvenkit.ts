import { depotPathRegex } from "./eye-plate-wolvenkit";
import { createGameAssetExporter, GameAssetExportError, type GameAssetExporter, type UncookRun } from "./game-asset-export";
import { archiveSourceContains } from "./rdar-index-fs";
import { runWolvenKit, wolvenKitIdentity, wolvenKitIdentityKey, WolvenKitRunError } from "./wolvenkit-cli";

/**
 * Process adapter: game asset export's WolvenKit command. One `uncook` call exports the named
 * resources; with materials it also passes the game folder, so WolvenKit resolves linked meshes,
 * rigs and `.mi` chains and decodes every texture those use. The shared runner owns the process.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export function uncookArguments(archivePath: string, depotPaths: readonly string[], outDir: string, gameRoot: string | null): string[] {
  return ["uncook", archivePath, "-o", outDir, "-r", depotPathRegex(depotPaths), "-u", "--uext", "png",
    "--mesh-export-type", "MeshOnly", ...(gameRoot ? ["-gp", gameRoot] : []), "-v", "Minimal"];
}

export function createWolvenKitUncook(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): UncookRun {
  return async ({ source, depotPaths, outDir, withMaterials, signal }) => {
    const args = uncookArguments(source.archivePath, depotPaths, outDir, withMaterials ? source.gameRoot : null);
    // WolvenKit logs per-file material warnings on success; the exporter checks the exported files instead.
    try { await runWolvenKit(cli, args, { signal, timeoutMs, keep: 64_000 }); }
    catch (error) {
      if (!(error instanceof WolvenKitRunError)) throw error;
      const code = error.code === "tool_timeout" ? "tool_failed" : error.code;
      throw new GameAssetExportError(code, error.message, error.output);
    }
  };
}

/**
 * The WolvenKit-backed exporter: its cache is keyed by this CLI's identity (version and content hash),
 * so upgrading or replacing WolvenKit never reuses another build's exports, and it can ask the
 * source's own archive indexes whether a resource exists at all.
 */
export function createWolvenKitGameAssetExporter(cacheRoot: string, cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): GameAssetExporter {
  const identity = cli ? wolvenKitIdentity(cli) : null;
  return createGameAssetExporter(cacheRoot, createWolvenKitUncook(cli, timeoutMs), {
    tool: { key: wolvenKitIdentityKey(identity), label: identity?.version ? `WolvenKit CLI ${identity.version}` : "WolvenKit CLI" },
    contains: (source, hashes) => archiveSourceContains(source.archivePath, hashes),
  });
}
