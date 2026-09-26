import { depotHash } from "./depot-path";
import { depotPathRegex } from "./eye-plate-wolvenkit";
import { createGameAssetExporter, GameAssetExportError, type GameAssetExporter, type UncookRun } from "./game-asset-export";
import { archiveSourceContains } from "./rdar-index-fs";
import { COMMAND_LINE_LIMIT, commandLineArgumentLength, MAX_PATTERN_CHARS } from "./resolver-host";
import { runWolvenKit, wolvenKitIdentity, wolvenKitIdentityKey, WolvenKitRunError } from "./wolvenkit-cli";

/**
 * Process adapter: game asset export's WolvenKit command. One `uncook` call exports the named
 * resources; with materials it also passes the game folder, so WolvenKit resolves linked meshes,
 * rigs and `.mi` chains and decodes every texture those use. The shared runner owns the process.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export function uncookArguments(archivePath: string | readonly string[], depotPaths: readonly string[], outDir: string, gameRoot: string | null): string[] {
  return ["uncook", ...(typeof archivePath === "string" ? [archivePath] : archivePath), "-o", outDir, "-r", depotPathRegex(depotPaths), "-u", "--uext", "png",
    "--mesh-export-type", "MeshOnly", ...(gameRoot ? ["-gp", gameRoot] : []), "-v", "Minimal"];
}

/**
 * The selections of one export over `archives`: `depotPaths` split so each launch's whole command line (the CLI, every archive, the
 * pattern and the flags, as Windows quotes them) stays within its limit, and each pattern within `MAX_PATTERN_CHARS` (PIPE-61).
 */
export function uncookSelections(cli: string, archives: readonly string[], depotPaths: readonly string[], outDir: string, gameRoot: string | null): string[][] {
  const fixed = [cli, ...uncookArguments(archives, [], outDir, gameRoot)].reduce((sum, arg) => sum + commandLineArgumentLength(arg), 0);
  const budget = Math.min(MAX_PATTERN_CHARS, COMMAND_LINE_LIMIT - 512 - fixed);
  const selections: string[][] = [];
  let current: string[] = [], size = depotPathRegex([]).length + 3;
  for (const path of depotPaths) {
    const escaped = depotPathRegex([path]).length - depotPathRegex([]).length + 1;
    if (current.length && size + escaped > budget) { selections.push(current); current = []; size = depotPathRegex([]).length + 3; }
    current.push(path); size += escaped;
  }
  if (current.length) selections.push(current);
  return selections;
}

/** One resource by its depot hash (an archive without path names); WolvenKit writes `<hash>.<ext>`. */
export function uncookByHashArguments(archivePath: string, depotPath: string, outDir: string): string[] {
  return ["uncook", archivePath, "-o", outDir, "--hash", depotHash(depotPath), "-u", "--uext", "png", "-v", "Minimal"];
}

export function createWolvenKitUncook(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): UncookRun {
  return async ({ source, sources, depotPaths, outDir, withMaterials, signal, byHash, lowPriority }) => {
    const archives = (sources?.length ? sources : [source]).map(item => item.archivePath);
    const gameRoot = withMaterials ? source.gameRoot : null;
    const launches = byHash ? [uncookByHashArguments(source.archivePath, depotPaths[0]!, outDir)]
      : uncookSelections(cli ?? "", archives, depotPaths, outDir, gameRoot).map(selection => uncookArguments(archives, selection, outDir, gameRoot));
    // WolvenKit logs per-file material warnings on success; the exporter checks the exported files instead.
    try { for (const args of launches) await runWolvenKit(cli, args, { signal, timeoutMs, keep: 64_000, lowPriority }); }
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
