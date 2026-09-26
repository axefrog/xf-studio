import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { depotHash } from "./depot-path";
import { depotPathRegex } from "./eye-plate-wolvenkit";
import { createGameAssetExporter, GameAssetExportError, type GameAssetExporter, type GeometryRepair, type UncookRun } from "./game-asset-export";
import { repairMeshForExport } from "./mesh-export-repair";
import type { JsonObject } from "./red-json";
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

/** One resource by its depot hash (an archive without path names); WolvenKit writes `<hash>.<ext>`. */
export function uncookByHashArguments(archivePath: string, depotPath: string, outDir: string): string[] {
  return ["uncook", archivePath, "-o", outDir, "--hash", depotHash(depotPath), "-u", "--uext", "png", "-v", "Minimal"];
}

export function createWolvenKitUncook(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): UncookRun {
  return async ({ source, depotPaths, outDir, withMaterials, signal, byHash }) => {
    const args = byHash ? uncookByHashArguments(source.archivePath, depotPaths[0]!, outDir)
      : uncookArguments(source.archivePath, depotPaths, outDir, withMaterials ? source.gameRoot : null);
    // WolvenKit logs per-file material warnings on success; the exporter checks the exported files instead.
    try { await runWolvenKit(cli, args, { signal, timeoutMs, keep: 64_000 }); }
    catch (error) {
      if (!(error instanceof WolvenKitRunError)) throw error;
      const code = error.code === "tool_timeout" ? "tool_failed" : error.code;
      throw new GameAssetExportError(code, error.message, error.output);
    }
  };
}

const toExportError = (error: unknown) => {
  if (!(error instanceof WolvenKitRunError)) return error;
  return new GameAssetExportError(error.code === "tool_timeout" ? "tool_failed" : error.code, error.message, error.output);
};

/**
 * The repair route for a mesh WolvenKit read but could not write as a GLB (game-asset-export.ts `GeometryRepair`): serialize the raw
 * mesh, apply the known repair (mesh-export-repair.ts), turn it back into a resource, pack it alone into a private archive at its own
 * depot path and uncook it from there exactly as before. Four launches, only for a mesh that failed; the result is cached like any
 * complete export. Nothing outside the session's work folder is written.
 */
export function createWolvenKitMeshRepair(cli: string | null, timeoutMs = DEFAULT_TIMEOUT_MS): GeometryRepair {
  return async ({ source, depotPath, raw, workDir, signal }) => {
    const run = async (args: string[]) => {
      try { await runWolvenKit(cli, args, { signal, timeoutMs, keep: 64_000 }); }
      catch (error) { throw toExportError(error); }
    };
    const name = basename(depotPath.split("\\").join("/"));
    const dirs = { raw: join(workDir, "raw"), json: join(workDir, "json"), fixedJson: join(workDir, "fixed-json"), fixed: join(workDir, "fixed"),
      pack: join(workDir, "pack"), archive: join(workDir, "archive"), out: join(workDir, "out") };
    for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
    copyFileSync(raw, join(dirs.raw, name));
    await run(["convert", "serialize", join(dirs.raw, name), "-o", dirs.json]);
    const serialized = join(dirs.json, `${name}.json`);
    if (!existsSync(serialized)) return null;
    const repair = repairMeshForExport(JSON.parse(readFileSync(serialized, "utf8")) as JsonObject);
    if (!repair) return null;
    writeFileSync(join(dirs.fixedJson, `${name}.json`), JSON.stringify(repair.document));
    await run(["convert", "deserialize", dirs.fixedJson, "-o", dirs.fixed]);
    if (!existsSync(join(dirs.fixed, name))) return null;
    const packed = join(dirs.pack, ...depotPath.split("\\"));
    mkdirSync(join(packed, ".."), { recursive: true });
    copyFileSync(join(dirs.fixed, name), packed);
    await run(["pack", dirs.pack, "-o", dirs.archive]);
    const archive = join(dirs.archive, "pack.archive");
    if (!existsSync(archive)) return null;
    await run(uncookArguments(archive, [depotPath], dirs.out, source.gameRoot));
    const stem = join(dirs.out, ...depotPath.replace(/\.mesh$/i, "").split("\\"));
    if (!existsSync(`${stem}.glb`)) return null;
    return { glb: `${stem}.glb`, materials: existsSync(`${stem}.Material.json`) ? `${stem}.Material.json` : null, detail: repair.detail };
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
    repairGeometry: createWolvenKitMeshRepair(cli, timeoutMs),
  });
}
