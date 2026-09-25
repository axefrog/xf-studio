import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DerivedCache, fileSha256 } from "./derived-cache";
import { depotHash, sanitizeDepotPath } from "./depot-path";

/**
 * Generic export of game resources into renderer formats: any `.mesh` or `.morphtarget`
 * becomes a GLB (with skin, bones and morph targets as WolvenKit exports them) plus the
 * mesh's materials resolved through their `.mi` chains; any `.xbm` becomes a PNG.
 * Results are cached per resource, keyed by its depot-path hash and the identity of the
 * archive source it was read from, so any consumer (the core preview today; resolved
 * skin, hair, piercings and other characters later) reuses the same exports.
 *
 * This module holds the port, the cache and the WolvenKit-backed implementation; callers
 * decide what to export and how to interpret it.
 */
/** 2: entries are published only when complete, and keyed by the exporting tool's identity. */
export const GAME_ASSET_EXPORT_VERSION = 2;

/** Where resources are read from: today the game's content archives; later a resolver's winning archive. */
export type ExportSource = {
  /** Archive file or directory WolvenKit reads (absolute). */
  archivePath: string;
  /** Stable identity of that source's bytes, e.g. path|size|mtime of each archive. */
  fingerprint: string;
  /** Game folder WolvenKit loads for dependent resources (linked meshes, material chains). */
  gameRoot: string;
};
export type ExportedGeometry = {
  depotPath: string; hash: string;
  /** The raw resource and its SHA-256. */
  raw: string; rawSha256: string;
  glb: string | null; glbSha256: string | null;
  /** WolvenKit's `.Material.json` for meshes: every material resolved through its `.mi` chain. */
  materials: string | null; materialsSha256: string | null;
  /**
   * Every output the resource kind needs was produced (mesh: raw, GLB and materials; morph target: raw and GLB).
   * Only complete exports are cached; an incomplete one is returned uncached so the caller can explain it,
   * and the next request runs the tool again.
   */
  complete: boolean;
  cached: boolean;
};
export type ExportedTexture = { depotPath: string; hash: string; png: string; pngSha256: string; cached: boolean };

/**
 * Typed failures an exporter's tool adapter reports. Consumers map them to their own codes and
 * messages; anything else thrown by an export is a storage or programming failure, not the tool's.
 */
export type ExportFailureCode = "tool_missing" | "runtime_missing" | "tool_failed" | "cancelled";
export class GameAssetExportError extends Error {
  constructor(readonly code: ExportFailureCode, message: string, readonly output = "") { super(message); }
}

/** The tool behind an exporter: `key` separates cache entries per tool build, `label` names it in records. */
export type ExportTool = { key: string; label: string };

export interface GameAssetExportSession {
  /** The exporting tool, for provenance records. */
  readonly tool: ExportTool;
  /** Export meshes/morph targets (and their materials); missing resources are absent from the result. */
  geometry(depotPaths: readonly string[]): Promise<Map<string, ExportedGeometry>>;
  /** Decode textures to PNG; missing resources are absent from the result. */
  textures(depotPaths: readonly string[]): Promise<Map<string, ExportedTexture>>;
  /**
   * Which depot paths the source's own archive indexes contain, or null when that can't be read.
   * Tells "not in the game files" apart from "the tool did not export it".
   */
  present(depotPaths: readonly string[]): Set<string> | null;
  /** Remove the session's private work files (cache entries stay). */
  close(): void;
}
export interface GameAssetExporter {
  open(source: ExportSource, signal?: AbortSignal): GameAssetExportSession;
}

/** The one process call this module needs: uncook `depotPaths` from `source` into `outDir`, keeping depot-relative paths. */
export type UncookRun = (input: { source: ExportSource; depotPaths: string[]; outDir: string; withMaterials: boolean; signal?: AbortSignal }) => Promise<void>;
export type GameAssetExporterOptions = {
  /** Identity of the exporting tool; part of every cache key. */
  tool?: ExportTool;
  /** Archive index lookup: which decimal depot hashes the source contains. May throw when unreadable. */
  contains?: (source: ExportSource, hashes: readonly string[]) => Set<string>;
};
const UNKNOWN_TOOL: ExportTool = { key: "unknown", label: "an unidentified exporter" };

const depotFile = (root: string, depotPath: string) => join(root, ...depotPath.split("\\"));
const glbFor = (depotPath: string) => /\.mesh$/i.test(depotPath) ? depotPath.replace(/\.mesh$/i, ".glb") : `${depotPath}.glb`;
const materialsFor = (depotPath: string) => /\.mesh$/i.test(depotPath) ? depotPath.replace(/\.mesh$/i, ".Material.json") : null;
const pngFor = (depotPath: string) => depotPath.replace(/\.xbm$/i, ".png");
/** The cache file names a complete geometry export must have, by resource kind. */
export const requiredGeometryFiles = (depotPath: string): readonly string[] =>
  /\.mesh$/i.test(depotPath) ? ["raw", "export.glb", "materials.json"] : ["raw", "export.glb"];

function checkDepotPath(depotPath: string): string {
  const clean = sanitizeDepotPath(depotPath);
  if (!clean || clean !== depotPath.toLowerCase() || /(^|\\)\.\.?(\\|$)|[:*?"<>|\0]/.test(clean))
    throw Error(`Not a plain depot path: ${depotPath}`);
  return clean;
}

type EntryMeta = { schema: "xfs/game-asset-export-1"; version: number; depotPath: string; hash: string; source: string;
  files: Record<string, { sha256: string; bytes: number }> };

/** Persistent per-resource cache in host-owned private storage. */
export class GameAssetExportCache extends DerivedCache {
  constructor(root: string, private readonly tool: ExportTool = UNKNOWN_TOOL) { super(root, "game asset export"); }
  private sourceKey(source: ExportSource) {
    return createHash("sha256").update(`${GAME_ASSET_EXPORT_VERSION}|${this.tool.key}|${source.fingerprint}`).digest("hex").slice(0, 16);
  }
  entryDirectory(depotPath: string, source: ExportSource) { return this.entry(join("resources", `${depotHash(depotPath)}-${this.sourceKey(source)}`)); }
  /** A verified entry's files, or null. Every file is re-hashed, so a damaged entry is never used. */
  read(depotPath: string, source: ExportSource): Record<string, string> | null {
    const directory = this.entryDirectory(depotPath, source);
    try {
      const meta = this.readJson(join(directory, "entry.json")) as EntryMeta;
      if (meta.schema !== "xfs/game-asset-export-1" || meta.version !== GAME_ASSET_EXPORT_VERSION || meta.hash !== depotHash(depotPath) ||
          meta.source !== this.sourceKey(source)) return null;
      const out: Record<string, string> = {};
      for (const [name, file] of Object.entries(meta.files)) {
        const path = join(directory, name);
        if (!existsSync(path) || statSync(path).size !== file.bytes || fileSha256(path) !== file.sha256) return null;
        out[name] = path;
      }
      return out;
    } catch { return null; }
  }
  /** Copy `files` (name → source path) into a new entry, replacing any older one atomically. */
  write(depotPath: string, source: ExportSource, files: Record<string, string>): Record<string, string> {
    const directory = this.entryDirectory(depotPath, source);
    const staging = `${directory}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    const meta: EntryMeta = { schema: "xfs/game-asset-export-1", version: GAME_ASSET_EXPORT_VERSION, depotPath, hash: depotHash(depotPath),
      source: this.sourceKey(source), files: {} };
    for (const [name, from] of Object.entries(files)) {
      copyFileSync(from, join(staging, name));
      meta.files[name] = { sha256: fileSha256(from), bytes: statSync(from).size };
    }
    this.writeJson(join(staging, "entry.json"), meta);
    if (existsSync(directory)) this.remove(directory);
    renameSync(staging, directory);
    return Object.fromEntries(Object.keys(files).map(name => [name, join(directory, name)]));
  }
}

/** Exporter over one `UncookRun` implementation and a persistent cache. */
export function createGameAssetExporter(cacheRoot: string, run: UncookRun, options: GameAssetExporterOptions = {}): GameAssetExporter {
  const tool = options.tool ?? UNKNOWN_TOOL;
  const cache = new GameAssetExportCache(cacheRoot, tool);
  return {
    open(source, signal) {
      let work: string | null = null;
      const workDir = () => (work ??= cache.createWork());
      // Textures WolvenKit decoded while resolving materials are reused before a second uncook.
      const decoded = () => work ? join(work, "geometry") : null;
      const hashOf = (path: string | undefined) => path ? fileSha256(path) : null;
      const geometryFiles = (depotPath: string, files: Record<string, string>, cached: boolean): ExportedGeometry => ({
        depotPath, hash: depotHash(depotPath), raw: files.raw!, rawSha256: fileSha256(files.raw!),
        glb: files["export.glb"] ?? null, glbSha256: hashOf(files["export.glb"]),
        materials: files["materials.json"] ?? null, materialsSha256: hashOf(files["materials.json"]),
        complete: requiredGeometryFiles(depotPath).every(name => !!files[name]), cached });
      return {
        tool,
        present(depotPaths) {
          if (!options.contains) return null;
          try {
            const found = options.contains(source, depotPaths.map(depotHash));
            return new Set(depotPaths.filter(depotPath => found.has(depotHash(depotPath))));
          } catch { return null; }
        },
        async geometry(depotPaths) {
          const out = new Map<string, ExportedGeometry>();
          const needed: string[] = [];
          for (const depotPath of depotPaths) {
            checkDepotPath(depotPath);
            const cached = cache.read(depotPath, source);
            // Only a complete entry is a hit; anything less runs the tool again.
            if (cached && requiredGeometryFiles(depotPath).every(name => cached[name])) out.set(depotPath, geometryFiles(depotPath, cached, true));
            else needed.push(depotPath);
          }
          if (!needed.length) return out;
          const outDir = join(workDir(), "geometry");
          mkdirSync(outDir, { recursive: true });
          await run({ source, depotPaths: needed, outDir, withMaterials: true, signal });
          for (const depotPath of needed) {
            const raw = depotFile(outDir, depotPath);
            if (!existsSync(raw)) continue;
            const files: Record<string, string> = { raw };
            const glb = depotFile(outDir, glbFor(depotPath)), materials = materialsFor(depotPath);
            if (existsSync(glb)) files["export.glb"] = glb;
            if (materials && existsSync(depotFile(outDir, materials))) files["materials.json"] = depotFile(outDir, materials);
            // A partial export (WolvenKit can exit 0 with per-file failures) is reported but never cached.
            const complete = requiredGeometryFiles(depotPath).every(name => files[name]);
            out.set(depotPath, geometryFiles(depotPath, complete ? cache.write(depotPath, source, files) : files, false));
          }
          return out;
        },
        async textures(depotPaths) {
          const out = new Map<string, ExportedTexture>();
          const store = (depotPath: string, png: string, fresh: boolean) => {
            const files = fresh ? cache.write(depotPath, source, { "texture.png": png }) : { "texture.png": png };
            out.set(depotPath, { depotPath, hash: depotHash(depotPath), png: files["texture.png"]!, pngSha256: fileSha256(files["texture.png"]!), cached: !fresh });
          };
          const needed: string[] = [];
          for (const depotPath of depotPaths) {
            checkDepotPath(depotPath);
            const cached = cache.read(depotPath, source)?.["texture.png"];
            const already = decoded() && depotFile(decoded()!, pngFor(depotPath));
            if (cached) store(depotPath, cached, false);
            else if (already && existsSync(already)) store(depotPath, already, true);
            else needed.push(depotPath);
          }
          if (!needed.length) return out;
          const outDir = join(workDir(), "textures");
          mkdirSync(outDir, { recursive: true });
          await run({ source, depotPaths: needed, outDir, withMaterials: false, signal });
          for (const depotPath of needed) {
            const png = depotFile(outDir, pngFor(depotPath));
            if (existsSync(png)) store(depotPath, png, true);
          }
          return out;
        },
        close() { if (work) { try { cache.remove(work); } catch { /* Best effort. */ } work = null; } },
      };
    },
  };
}

/** The game's own content archives as one export source (vanilla resources; no mods). */
export function gameContentSource(gameRoot: string): ExportSource {
  const archivePath = resolve(gameRoot, "archive", "pc", "content");
  let entries: string[] = [];
  try {
    entries = readdirSync(archivePath).filter(name => name.toLowerCase().endsWith(".archive")).sort().map(name => {
      const stat = statSync(join(archivePath, name));
      return `${name}|${stat.size}|${Math.trunc(stat.mtimeMs)}`;
    });
  } catch { entries = ["unavailable"]; }
  return { archivePath, gameRoot, fingerprint: createHash("sha256").update(`content\n${entries.join("\n")}`).digest("hex") };
}


/**
 * One mounted archive as an export source: the winning archive of a resolved resource (a mod archive in
 * MO2's virtual view, the ArchiveXL bundle or a base-game archive). Its fingerprint is the archive's own
 * path, size and modification time, so the per-resource cache key is (depot hash, container fingerprint).
 */
export function archiveExportSource(archivePath: string, gameRoot: string): ExportSource {
  const absolute = resolve(archivePath);
  let identity = "unavailable";
  try { const stat = statSync(absolute); identity = `${stat.size}|${Math.trunc(stat.mtimeMs)}`; } catch { /* Reported by the export itself. */ }
  return { archivePath: absolute, gameRoot, fingerprint: createHash("sha256").update(`archive\n${absolute.toLowerCase()}|${identity}`).digest("hex") };
}
