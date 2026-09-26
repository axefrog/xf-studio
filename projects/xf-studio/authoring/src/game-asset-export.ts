import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DerivedCache, fileSha256, writeFileAtomic } from "./derived-cache";
import { depotHash, sanitizeDepotPath } from "./depot-path";
import { hostFailure, hostTrace } from "./diagnostics/host-log";

/**
 * Generic export of game resources into renderer formats: any `.mesh` or `.morphtarget`
 * becomes a GLB (with skin, bones and morph targets as WolvenKit exports them) plus the
 * mesh's materials resolved through their `.mi` chains; any `.xbm` becomes a PNG; any `.mlmask`
 * (a layered material's mask) becomes one greyscale PNG per mask layer, in layer order.
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
  /**
   * When the tool could not write the resource as it is and the GLB came from a repaired copy (`GameAssetExporterOptions.repairGeometry`):
   * one plain line saying what the copy changed. Null for a direct export.
   */
  repair?: string | null;
};
export type ExportedTexture = { depotPath: string; hash: string; png: string; pngSha256: string; cached: boolean };
/** A `.mlmask` decoded into one PNG per mask layer (index = layer), as WolvenKit writes them (`<name>_layers/<name>_<i>.png`). */
export type ExportedMask = { depotPath: string; hash: string; layers: string[]; cached: boolean };

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
  /** Decode layered-material masks (`.mlmask`) to one PNG per layer; missing resources are absent from the result. */
  masks(depotPaths: readonly string[]): Promise<Map<string, ExportedMask>>;
  /**
   * Which depot paths the source's own archive indexes contain, or null when that can't be read.
   * Tells "not in the game files" apart from "the tool did not export it".
   */
  present(depotPaths: readonly string[]): Set<string> | null;
  /** Remove the session's private work files (cache entries stay). */
  close(): void;
}
/** What one batch asks of one source (archive): the geometry, textures and masks to export from it. */
export type ExportRequest = { readonly source: ExportSource; readonly geometry: readonly string[]; readonly textures: readonly string[]; readonly masks: readonly string[];
  /**
   * Geometry needs WolvenKit's materials file too (the core preview's head and eyes). Without it (the character details, which resolve
   * materials themselves), a mesh or morph target is exported without the game folder: the same GLB, byte for byte, without decoding
   * every texture its materials name [resource: a CCXL hair mesh and a vanilla morph target, WolvenKit 9.0.1], seconds sooner. A GLB
   * that doesn't come out that way is exported again with the game folder.
   */
  readonly materials?: boolean };
export type ExportAnswer = { geometry: Map<string, ExportedGeometry>; textures: Map<string, ExportedTexture>; masks: Map<string, ExportedMask>;
  /** The tool failed on this source (its launch, retried alone when it shared one); what the cache already had is still answered. */
  failed?: GameAssetExportError };
export type ExportOptions = { /** Background work (a prefetch): the tool runs at a lower process priority. */ readonly lowPriority?: boolean };
export type ExportKind = "geometry" | "textures" | "masks";
export interface GameAssetExporter {
  /** The exporting tool, for provenance records (also each session's). */
  readonly tool?: ExportTool;
  open(source: ExportSource, signal?: AbortSignal): GameAssetExportSession;
  /**
   * Export every kind from every source in as few tool launches as possible (one, when the sources' requested resources don't
   * collide): the answers in `requests` order. Missing resources are absent. Optional: a caller without it opens a session per source.
   */
  exportAll?(requests: readonly ExportRequest[], signal?: AbortSignal, options?: ExportOptions): Promise<ExportAnswer[]>;
  /** Whether a usable cache entry exists for a resource (no hashing: its files are present at their recorded sizes). */
  has?(kind: ExportKind, depotPath: string, source: ExportSource): boolean;
}

/** The one process call this module needs: uncook `depotPaths` from `source` into `outDir`, keeping depot-relative paths. */
/**
 * One export call. By default the resources are selected by depot path. `byHash` selects the single resource by
 * its depot hash instead and writes it as `<hash>.<ext>` in `outDir`: archives built without path names (many older
 * mods) list only hashes, so a path pattern finds nothing in them.
 */
export type UncookRun = (input: { source: ExportSource; depotPaths: string[]; outDir: string; withMaterials: boolean; signal?: AbortSignal;
  byHash?: boolean;
  /** Every archive the launch reads (`exportAll`'s batch; `source` alone otherwise). Their requested resources never collide. */
  sources?: readonly ExportSource[];
  lowPriority?: boolean }) => Promise<void>;
/** The steps of the repair route, so a failed repair says where it stopped (PIPE-86). `tool`: a tool failure outside a named step. */
export type GeometryRepairStep = "serialize" | "deserialize" | "pack" | "uncook" | "tool";
/**
 * What the repair route did with one mesh (PIPE-86): `repaired` (the GLB, the materials file and one plain line on what the copy
 * changed), `not-applicable` (no known repair fits this mesh), or `failed` at a step (the tool failed there or wrote nothing). Either
 * of the last two leaves the original outcome standing.
 */
export type GeometryRepairOutcome =
  | { readonly outcome: "repaired"; readonly glb: string; readonly materials: string | null; readonly detail: string }
  | { readonly outcome: "not-applicable"; readonly detail: string }
  | { readonly outcome: "failed"; readonly step: GeometryRepairStep; readonly detail: string };
/**
 * A second route for a mesh the tool read (`raw`) but could not write as a GLB: export a repaired copy into `workDir` (mesh-export-repair.ts).
 * A tool failure is a `failed` outcome. Cancellation, a missing tool or runtime, and anything that isn't the tool's own failure (a full
 * disk, a bug) are thrown, never reported as the tool's (PIPE-86).
 */
export type GeometryRepair = (input: { source: ExportSource; depotPath: string; raw: string; workDir: string; signal?: AbortSignal;
  /** Background work (a prefetch): the tool runs at a lower process priority. */ lowPriority?: boolean }) =>
  Promise<GeometryRepairOutcome>;
export type GameAssetExporterOptions = {
  /** Identity of the exporting tool; part of every cache key. */
  tool?: ExportTool;
  /** Archive index lookup: which decimal depot hashes the source contains. May throw when unreadable. */
  contains?: (source: ExportSource, hashes: readonly string[]) => Set<string>;
  /** Repair route for a mesh whose GLB the tool could not write. */
  repairGeometry?: GeometryRepair;
  /** Told each repair's outcome (default: the diagnostics window's `wolvenkit/repair` event, and a warning in the log for a failed one). */
  onRepair?: (depotPath: string, outcome: GeometryRepairOutcome) => void;
  /**
   * Identity of `repairGeometry` (its version). With the tool's key it identifies every lasting outcome (a settled "nothing exported",
   * a lasting partial export): one recorded without this repair, or by another version of it, is tried again.
   */
  repairKey?: string;
};
/** The cache file that records a repaired export's plain line (`ExportedGeometry.repair`). */
const REPAIR_NOTE = "repair.txt";
const UNKNOWN_TOOL: ExportTool = { key: "unknown", label: "an unidentified exporter" };
/** How many by-hash launches one session runs at once (each WolvenKit call selects one resource by its hash). */
export const BY_HASH_CONCURRENCY = 4;

/**
 * Run `task` over `items` with at most `limit` in flight. The first failure stops new work, waits for the running
 * tasks to settle, and is rethrown (so a cancellation or a tool failure surfaces once, after its siblings stopped).
 */
export async function forEachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0, failure: { error: unknown } | null = null;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++]!;
      try { await task(item); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
}

const depotFile = (root: string, depotPath: string) => join(root, ...depotPath.split("\\"));
const glbFor = (depotPath: string) => /\.mesh$/i.test(depotPath) ? depotPath.replace(/\.mesh$/i, ".glb") : `${depotPath}.glb`;
const materialsFor = (depotPath: string) => /\.mesh$/i.test(depotPath) ? depotPath.replace(/\.mesh$/i, ".Material.json") : null;
const pngFor = (depotPath: string) => depotPath.replace(/\.xbm$/i, ".png");
/** At most this many mask layers are read (the engine's layer limit is 20). */
export const MAX_MASK_LAYERS = 32;
/** WolvenKit's mask layers for an exported `.mlmask` at `file` (`<dir>/<stem>_layers/<stem>_<i>.png`), in order, stopping at the first gap. */
export function maskLayerFiles(file: string): string[] {
  const stem = file.replace(/\.mlmask$/i, ""), name = stem.split(/[\\/]/).pop()!;
  const layers: string[] = [];
  for (let index = 0; index < MAX_MASK_LAYERS; index++) {
    const layer = join(`${stem}_layers`, `${name}_${index}.png`);
    if (!existsSync(layer)) break;
    layers.push(layer);
  }
  return layers;
}
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
  files: Record<string, { sha256: string; bytes: number }>;
  /**
   * A partial geometry export (the GLB without its materials file) from clean runs, counted: served from the cache from the
   * `PARTIAL_RUNS`th (a lasting property of that resource and WolvenKit build, as the resolver's `not-written` markers are).
   */
  partialRuns?: number;
  /** The exporter identity (tool and repair route) that counted `partialRuns`; another identity's count is void (`lastingIdentity`). */
  partialIdentity?: string;
  /** A repaired export (its files include `repair.txt`): the identity that made it. Another identity's repair is exported again (PIPE-85). */
  repairIdentity?: string };
/** Clean runs that exported a mesh without its materials file before the partial export is served from the cache. */
export const PARTIAL_RUNS = 2;
/** Paths this process already marked as used (the disk budget evicts the least recently used by their modification time). */
const touched = new Set<string>();
/** Mark a cache entry (its `entry.json`, or a cache file) as used now, once per process. */
export function touchUsed(path: string): void {
  if (touched.has(path)) return;
  touched.add(path);
  try { const now = new Date(); utimesSync(path, now, now); } catch { /* Advisory. */ }
}
/** Whether this process used (read or wrote) a cache entry: the disk budget never evicts one (prepared-files.ts). */
export const usedThisSession = (path: string) => touched.has(path);

/** Persistent per-resource cache in host-owned private storage. */
export class GameAssetExportCache extends DerivedCache {
  /**
   * Identity of the exporter's lasting outcomes: the tool and its repair route. A settled "nothing exported" or a lasting partial entry
   * counts only under the identity that recorded it, so a repair added later (the ponytail's mesh, mesh-export-repair.ts) or a changed
   * one is never blocked by what an exporter without it settled.
   */
  readonly lastingIdentity: string;
  constructor(root: string, private readonly tool: ExportTool = UNKNOWN_TOOL, repairKey = "none") {
    super(root, "game asset export");
    this.lastingIdentity = `${tool.key}|repair:${repairKey}`;
  }
  /** A meta's partial run count under the current identity: a complete entry counts as settled, another identity's partial count as 0. */
  /** Whether an entry is usable under the current identity: a repaired export only under the repair route that made it. */
  private current(meta: EntryMeta): boolean {
    return !meta.files[REPAIR_NOTE] || meta.repairIdentity === this.lastingIdentity;
  }
  private runsOf(meta: EntryMeta): number {
    if (meta.partialRuns === undefined) return PARTIAL_RUNS;
    return meta.partialIdentity === this.lastingIdentity ? meta.partialRuns : 0;
  }
  private sourceKey(source: ExportSource) {
    return createHash("sha256").update(`${GAME_ASSET_EXPORT_VERSION}|${this.tool.key}|${source.fingerprint}`).digest("hex").slice(0, 16);
  }
  entryDirectory(depotPath: string, source: ExportSource) { return this.entry(join("resources", `${depotHash(depotPath)}-${this.sourceKey(source)}`)); }
  private meta(depotPath: string, source: ExportSource): EntryMeta | null {
    try {
      const meta = this.readJson(join(this.entryDirectory(depotPath, source), "entry.json")) as EntryMeta;
      return meta.schema === "xfs/game-asset-export-1" && meta.version === GAME_ASSET_EXPORT_VERSION && meta.hash === depotHash(depotPath) &&
        meta.source === this.sourceKey(source) ? meta : null;
    } catch { return null; }
  }
  /**
   * A verified entry's files, or null. Every file is re-hashed, so a damaged entry is never used. A partial geometry entry counts only
   * from its `PARTIAL_RUNS`th clean run. A hit marks the entry as used (`touchUsed`).
   */
  read(depotPath: string, source: ExportSource): Record<string, string> | null {
    const directory = this.entryDirectory(depotPath, source);
    try {
      const meta = this.meta(depotPath, source);
      if (!meta || !this.current(meta) || this.runsOf(meta) < PARTIAL_RUNS) return null;
      const out: Record<string, string> = {};
      for (const [name, file] of Object.entries(meta.files)) {
        const path = join(directory, name);
        if (!existsSync(path) || statSync(path).size !== file.bytes || fileSha256(path) !== file.sha256) return null;
        out[name] = path;
      }
      touchUsed(join(directory, "entry.json"));
      return out;
    } catch { return null; }
  }
  /** Whether `read` would find the entry with `required` files (present at their recorded sizes, not re-hashed): a cheap readiness check. */
  present(depotPath: string, source: ExportSource, required: readonly string[] = []): boolean {
    if (this.settledNone(depotPath, source)) return true;
    const meta = this.meta(depotPath, source);
    if (!meta || !this.current(meta) || this.runsOf(meta) < PARTIAL_RUNS || !required.every(name => meta.files[name])) return false;
    const directory = this.entryDirectory(depotPath, source);
    return Object.entries(meta.files).every(([name, file]) => { try { return statSync(join(directory, name)).size === file.bytes; } catch { return false; } });
  }
  private noneFile(depotPath: string, source: ExportSource) { return `${this.entryDirectory(depotPath, source)}.none.json`; }
  /**
   * Clean launches so far that exported nothing for this resource (WolvenKit can't uncook it: a CCXL mesh it fails on). From the
   * `PARTIAL_RUNS`th it is settled: not asked for again until the archive, WolvenKit or the repair route changes (the archive and
   * WolvenKit are in the key, the repair route in the marker's `identity`), as the resolver's `not-written` markers are. A marker
   * recorded under another `lastingIdentity` counts 0.
   */
  noneRuns(depotPath: string, source: ExportSource): number {
    try {
      const marker = this.readJson(this.noneFile(depotPath, source)) as { runs?: unknown; identity?: unknown };
      if (marker.identity !== this.lastingIdentity) return 0;
      const runs = Number(marker.runs);
      return Number.isInteger(runs) ? runs : 0;
    } catch { return 0; }
  }
  settledNone(depotPath: string, source: ExportSource): boolean { return this.noneRuns(depotPath, source) >= PARTIAL_RUNS; }
  /** Count one more clean launch that exported nothing for this resource (advisory). */
  markNone(depotPath: string, source: ExportSource): void {
    try {
      this.ensure();
      mkdirSync(join(this.root, "resources"), { recursive: true });
      writeFileAtomic(this.noneFile(depotPath, source), JSON.stringify({ depotPath, identity: this.lastingIdentity,
        runs: this.noneRuns(depotPath, source) + 1, at: new Date().toISOString() }));
    } catch { /* Tried again next time. */ }
  }
  /** Clean runs so far that exported this resource only partly (0 when none). */
  partialRuns(depotPath: string, source: ExportSource): number {
    const meta = this.meta(depotPath, source);
    return meta?.partialRuns !== undefined ? this.runsOf(meta) : 0;
  }
  /** Copy `files` (name → source path) into a new entry, replacing any older one atomically. `partialRuns` marks a partial geometry export. */
  write(depotPath: string, source: ExportSource, files: Record<string, string>, partialRuns?: number): Record<string, string> {
    const directory = this.entryDirectory(depotPath, source);
    const staging = `${directory}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    const meta: EntryMeta = { schema: "xfs/game-asset-export-1", version: GAME_ASSET_EXPORT_VERSION, depotPath, hash: depotHash(depotPath),
      source: this.sourceKey(source), files: {}, ...(partialRuns ? { partialRuns, partialIdentity: this.lastingIdentity } : {}),
      ...(files[REPAIR_NOTE] ? { repairIdentity: this.lastingIdentity } : {}) };
    for (const [name, from] of Object.entries(files)) {
      copyFileSync(from, join(staging, name));
      meta.files[name] = { sha256: fileSha256(from), bytes: statSync(from).size };
    }
    this.writeJson(join(staging, "entry.json"), meta);
    if (existsSync(directory)) this.remove(directory);
    try { renameSync(staging, directory); }
    catch (error) {
      // Another export of the same resource (a prefetch beside a person's own change) published it first: keep theirs.
      this.remove(staging);
      if (!existsSync(join(directory, "entry.json"))) throw error;
    }
    touched.delete(join(directory, "entry.json"));
    touchUsed(join(directory, "entry.json"));
    return Object.fromEntries(Object.keys(files).map(name => [name, join(directory, name)]));
  }
}

/** Most archives one `exportAll` launch reads (their paths share the command line with the selection). */
export const MAX_SOURCES_PER_LAUNCH = 24;

/** Exporter over one `UncookRun` implementation and a persistent cache. */
export function createGameAssetExporter(cacheRoot: string, run: UncookRun, options: GameAssetExporterOptions = {}): GameAssetExporter {
  const tool = options.tool ?? UNKNOWN_TOOL;
  const cache = new GameAssetExportCache(cacheRoot, tool, options.repairGeometry ? options.repairKey ?? "unversioned" : "none");
  const reportRepair = options.onRepair ?? ((depotPath: string, outcome: GeometryRepairOutcome) => {
    hostTrace().event("wolvenkit", "repair", { depotPath, outcome: outcome.outcome, step: outcome.outcome === "failed" ? outcome.step : null, detail: outcome.detail });
    if (outcome.outcome === "failed")
      hostFailure("wolvenkit", "mesh_repair_failed", `The repaired copy of ${depotPath} couldn't be exported (${outcome.step}): ${outcome.detail}`, undefined, "warn");
  });
  const hashOf = (path: string | undefined) => path ? fileSha256(path) : null;
  /** The files a geometry export needs: with materials, `requiredGeometryFiles`; without, the raw resource and its GLB. */
  const required = (depotPath: string, materials: boolean) => materials ? requiredGeometryFiles(depotPath) : ["raw", "export.glb"];
  const repairOf = (files: Record<string, string>) => {
    if (!files[REPAIR_NOTE]) return null;
    try { return readFileSync(files[REPAIR_NOTE]!, "utf8").trim().slice(0, 400) || null; } catch { return null; }
  };
  const geometryFiles = (depotPath: string, files: Record<string, string>, cached: boolean, materials = true): ExportedGeometry => ({
    depotPath, hash: depotHash(depotPath), raw: files.raw!, rawSha256: fileSha256(files.raw!),
    glb: files["export.glb"] ?? null, glbSha256: hashOf(files["export.glb"]),
    materials: files["materials.json"] ?? null, materialsSha256: hashOf(files["materials.json"]),
    complete: required(depotPath, materials).every(name => !!files[name]), cached, repair: repairOf(files) });
  /**
   * The tool read a mesh but could not write its GLB (e.g. WolvenKit refusing a skin it built too small): export a repaired copy
   * (`GameAssetExporterOptions.repairGeometry`) under `repairRoot`. Adds the GLB, the materials file when missing and the repair's note.
   */
  const repair = async (source: ExportSource, depotPath: string, files: Record<string, string>, repairRoot: string, signal?: AbortSignal,
    lowPriority?: boolean) => {
    if (files["export.glb"] || !/\.mesh$/i.test(depotPath) || !options.repairGeometry) return;
    const repairDir = join(repairRoot, depotHash(depotPath));
    mkdirSync(repairDir, { recursive: true });
    let outcome: GeometryRepairOutcome;
    try { outcome = await options.repairGeometry({ source, depotPath, raw: files.raw!, workDir: repairDir, signal, lowPriority }); }
    catch (error) {
      // Only the tool's own failure leaves the original outcome standing; anything else is not WolvenKit's fault and is thrown (PIPE-86).
      if (!(error instanceof GameAssetExportError) || error.code !== "tool_failed") throw error;
      outcome = { outcome: "failed", step: "tool", detail: error.message };
    }
    if (outcome.outcome === "repaired" && !existsSync(outcome.glb)) outcome = { outcome: "failed", step: "uncook", detail: "the repaired copy's GLB is missing" };
    reportRepair(depotPath, outcome);
    if (outcome.outcome !== "repaired") return;
    const repaired = outcome;
    files["export.glb"] = repaired.glb;
    if (!files["materials.json"] && repaired.materials && existsSync(repaired.materials)) files["materials.json"] = repaired.materials;
    const note = join(repairDir, REPAIR_NOTE);
    writeFileSync(note, repaired.detail);
    files[REPAIR_NOTE] = note;
  };
  const present = (source: ExportSource, depotPaths: readonly string[]): Set<string> | null => {
    if (!options.contains) return null;
    try {
      const found = options.contains(source, depotPaths.map(depotHash));
      return new Set(depotPaths.filter(depotPath => found.has(depotHash(depotPath))));
    } catch { return null; }
  };
  const emptyAnswer = (): ExportAnswer => ({ geometry: new Map(), textures: new Map(), masks: new Map() });
  type Needed = { geometry: string[]; textures: string[]; masks: string[] };
  const cachedLayers = (files: Record<string, string> | null) => {
    if (!files) return null;
    const layers: string[] = [];
    for (let index = 0; files[`layer-${index}.png`]; index++) layers.push(files[`layer-${index}.png`]!);
    return layers.length ? layers : null;
  };
  const storeTexture = (answer: ExportAnswer, source: ExportSource, depotPath: string, png: string, fresh: boolean) => {
    const files = fresh ? cache.write(depotPath, source, { "texture.png": png }) : { "texture.png": png };
    answer.textures.set(depotPath, { depotPath, hash: depotHash(depotPath), png: files["texture.png"]!, pngSha256: fileSha256(files["texture.png"]!), cached: !fresh });
  };
  const storeMask = (answer: ExportAnswer, source: ExportSource, depotPath: string, layers: string[], fresh: boolean) => {
    const names = layers.map((_, index) => `layer-${index}.png`);
    const files = fresh ? cache.write(depotPath, source, Object.fromEntries(names.map((name, index) => [name, layers[index]!]))) : null;
    answer.masks.set(depotPath, { depotPath, hash: depotHash(depotPath), layers: files ? names.map(name => files[name]!) : layers, cached: !fresh });
  };
  /** What the cache already answers for a request; the rest is returned as needed. Only a complete (or lasting partial) entry is a hit. */
  const fromCache = (request: ExportRequest, answer: ExportAnswer, decoded: string | null = null): Needed => {
    const needed: Needed = { geometry: [], textures: [], masks: [] }, materials = request.materials ?? false;
    // A resource WolvenKit settled on exporting nothing for is not asked for again (absent from the answer, as a missing one is).
    const settled = (depotPath: string) => cache.settledNone(depotPath, request.source);
    for (const depotPath of new Set(request.geometry)) {
      checkDepotPath(depotPath);
      if (settled(depotPath)) continue;
      const cached = cache.read(depotPath, request.source);
      // A lasting partial entry answers too (its GLB is served; `complete` says what is missing).
      const lasting = !!cached && cache.partialRuns(depotPath, request.source) >= PARTIAL_RUNS;
      if (cached && (required(depotPath, materials).every(name => cached[name]) || (lasting && cached.raw && cached["export.glb"])))
        answer.geometry.set(depotPath, geometryFiles(depotPath, cached, true, materials));
      else needed.geometry.push(depotPath);
    }
    for (const depotPath of new Set(request.textures)) {
      checkDepotPath(depotPath);
      if (settled(depotPath)) continue;
      const cached = cache.read(depotPath, request.source)?.["texture.png"];
      // Textures WolvenKit decoded while resolving this session's materials are reused before a second launch.
      const already = decoded && depotFile(decoded, pngFor(depotPath));
      if (cached) storeTexture(answer, request.source, depotPath, cached, false);
      else if (already && existsSync(already)) storeTexture(answer, request.source, depotPath, already, true);
      else needed.textures.push(depotPath);
    }
    for (const depotPath of new Set(request.masks)) {
      checkDepotPath(depotPath);
      if (settled(depotPath)) continue;
      const cached = cachedLayers(cache.read(depotPath, request.source));
      if (cached) storeMask(answer, request.source, depotPath, cached, false); else needed.masks.push(depotPath);
    }
    return needed;
  };
  /**
   * Take one launch's outputs in `outDir` for a request's needed resources into the cache. Everything answered points into the cache,
   * never into the launch's work folder (which is removed): a complete export as before, and a partial one (the GLB without its
   * materials file) as a partial entry counting its clean runs (`PARTIAL_RUNS`). With `repairing`, a mesh the tool read but wrote no
   * GLB for goes through the repair route first (`repair`); without it (a launch retried with the game folder next) it doesn't yet.
   * Returns the textures and masks not found by name.
   */
  const collect = async (source: ExportSource, needed: Needed, outDir: string, answer: ExportAnswer, needMaterials = true,
    { repairing = true, signal, lowPriority }: { repairing?: boolean; signal?: AbortSignal; lowPriority?: boolean } = {}): Promise<{ textures: string[]; masks: string[] }> => {
    for (const depotPath of needed.geometry) {
      const raw = depotFile(outDir, depotPath);
      if (!existsSync(raw)) continue;
      const files: Record<string, string> = { raw };
      const glb = depotFile(outDir, glbFor(depotPath)), materials = materialsFor(depotPath);
      if (existsSync(glb)) files["export.glb"] = glb;
      if (materials && existsSync(depotFile(outDir, materials))) files["materials.json"] = depotFile(outDir, materials);
      if (repairing) await repair(source, depotPath, files, join(outDir, "repair"), signal, lowPriority);
      const complete = required(depotPath, needMaterials).every(name => files[name]);
      // Without a GLB there is nothing to serve; a GLB without the materials file it was asked for is kept as a partial entry.
      const written = complete ? cache.write(depotPath, source, files)
        : files["export.glb"] ? cache.write(depotPath, source, files, cache.partialRuns(depotPath, source) + 1) : files;
      answer.geometry.set(depotPath, geometryFiles(depotPath, written, false, needMaterials));
    }
    const unnamed = { textures: [] as string[], masks: [] as string[] };
    for (const depotPath of needed.textures) {
      const png = depotFile(outDir, pngFor(depotPath));
      if (existsSync(png)) storeTexture(answer, source, depotPath, png, true); else unnamed.textures.push(depotPath);
    }
    for (const depotPath of needed.masks) {
      const layers = maskLayerFiles(depotFile(outDir, depotPath));
      if (layers.length) storeMask(answer, source, depotPath, layers, true); else unnamed.masks.push(depotPath);
    }
    return unnamed;
  };
  /**
   * Not found by path: the archive may list hashes only. Ask for each missing texture or mask by its hash, but only when the source's
   * own index says it is there: an unreadable index would otherwise cost one launch per resource that may not exist at all (PREV-55).
   * WolvenKit selects one resource per `--hash` call, so the calls run a few at a time, each into its own folder.
   */
  const byHash = async (source: ExportSource, unnamed: { textures: string[]; masks: string[] }, outDir: string, answer: ExportAnswer, signal?: AbortSignal) => {
    const all = [...unnamed.textures, ...unnamed.masks];
    const inIndex = all.length ? present(source, all) : null;
    const wanted = inIndex ? all.filter(depotPath => inIndex.has(depotPath)) : [];
    await forEachLimited(wanted, BY_HASH_CONCURRENCY, async depotPath => {
      const hashDir = join(outDir, "by-hash", depotHash(depotPath));
      mkdirSync(hashDir, { recursive: true });
      await run({ source, depotPaths: [depotPath], outDir: hashDir, withMaterials: false, signal, byHash: true });
      if (/\.mlmask$/i.test(depotPath)) {
        const layers = maskLayerFiles(join(hashDir, `${depotHash(depotPath)}.mlmask`));
        if (layers.length) storeMask(answer, source, depotPath, layers, true);
      } else {
        const png = join(hashDir, `${depotHash(depotPath)}.png`);
        if (existsSync(png)) storeTexture(answer, source, depotPath, png, true);
      }
    });
  };
  const anyNeeded = (needed: Needed) => needed.geometry.length + needed.textures.length + needed.masks.length > 0;
  const neededPaths = (needed: Needed) => [...needed.geometry, ...needed.textures, ...needed.masks];

  return {
    tool,
    has(kind, depotPath, source) {
      if (kind === "geometry") return cache.present(depotPath, source, ["raw", "export.glb"]);
      if (kind === "textures") return cache.present(depotPath, source, ["texture.png"]);
      return cache.present(depotPath, source, ["layer-0.png"]);
    },
    async exportAll(requests, signal, exportOptions = {}) {
      const answers = requests.map(emptyAnswer);
      const pending: { index: number; request: ExportRequest; needed: Needed; hashes: string[] }[] = [];
      requests.forEach((request, index) => {
        const needed = fromCache(request, answers[index]!);
        if (anyNeeded(needed)) pending.push({ index, request, needed, hashes: neededPaths(needed).map(depotHash) });
      });
      if (!pending.length) return answers;
      // One launch reads several archives when none of them holds a resource another is asked for (outputs are written by depot
      // path, so two copies would overwrite each other) and they share the game folder. An unreadable index keeps an archive apart.
      const holds = (source: ExportSource, hashes: readonly string[]) => {
        if (!options.contains) return true;
        try { return options.contains(source, hashes).size > 0; } catch { return true; }
      };
      const launches: (typeof pending)[] = [];
      for (const item of pending) {
        const fits = launches.find(group => group.length < MAX_SOURCES_PER_LAUNCH && group[0]!.request.source.gameRoot === item.request.source.gameRoot &&
          group.every(other => resolve(other.request.source.archivePath).toLowerCase() !== resolve(item.request.source.archivePath).toLowerCase() &&
            !holds(other.request.source, item.hashes) && !holds(item.request.source, other.hashes)));
        if (fits) fits.push(item); else launches.push([item]);
      }
      const work = cache.createWork();
      const lowPriority = exportOptions.lowPriority;
      let serial = 0;
      // One launch over a group; a tool failure of a shared launch is retried per source, so one archive can't fail the others.
      const launch = async (group: typeof pending, withGame = false): Promise<void> => {
        const outDir = join(work, `launch-${serial++}`);
        mkdirSync(outDir, { recursive: true });
        try {
          await run({ source: group[0]!.request.source, sources: group.map(item => item.request.source),
            depotPaths: [...new Set(group.flatMap(item => neededPaths(item.needed)))], outDir,
            withMaterials: withGame || group.some(item => item.needed.geometry.length > 0 && (item.request.materials ?? false)), signal, lowPriority });
        } catch (error) {
          if (!(error instanceof GameAssetExportError) || error.code !== "tool_failed") throw error;
          if (group.length > 1) { for (const item of group) await launch([item], withGame); return; }
          answers[group[0]!.index]!.failed = error;
          return;
        }
        // Geometry exported without the game folder that came out without a GLB: once more with it.
        const again: typeof pending = [];
        for (const item of group) {
          const final = withGame || !!item.request.materials;
          const unnamed = await collect(item.request.source, item.needed, outDir, answers[item.index]!, item.request.materials ?? false, { repairing: final, signal, lowPriority });
          const missing = final ? [] : item.needed.geometry.filter(path => !answers[item.index]!.geometry.get(path)?.glb);
          if (missing.length) again.push({ ...item, needed: { geometry: missing, textures: [], masks: [] }, hashes: missing.map(depotHash) });
          try { await byHash(item.request.source, unnamed, join(outDir, `source-${item.index}`), answers[item.index]!, signal); }
          catch (error) {
            if (!(error instanceof GameAssetExportError) || error.code !== "tool_failed") throw error;
            answers[item.index]!.failed = error;
          }
        }
        if (again.length) await launch(again, true);
      };
      try {
        for (const group of launches) await launch(group);
        // What clean launches (and the retries) exported nothing for is counted, so it settles instead of launching every time.
        for (const item of pending) {
          const answer = answers[item.index]!;
          if (answer.failed) continue;
          for (const path of item.needed.geometry) if (!answer.geometry.get(path)?.glb) cache.markNone(path, item.request.source);
          for (const path of item.needed.textures) if (!answer.textures.has(path)) cache.markNone(path, item.request.source);
          for (const path of item.needed.masks) if (!answer.masks.has(path)) cache.markNone(path, item.request.source);
        }
      } finally { try { cache.remove(work); } catch { /* Best effort. */ } }
      return answers;
    },
    open(source, signal) {
      let work: string | null = null;
      const workDir = () => (work ??= cache.createWork());
      // Textures WolvenKit decoded while resolving materials are reused before a second uncook.
      const decoded = () => work ? join(work, "geometry") : null;
      const one = async (kind: ExportKind, depotPaths: readonly string[]): Promise<ExportAnswer> => {
        const answer = emptyAnswer();
        // A session's geometry comes with WolvenKit's materials file (the core preview reads it).
        const request: ExportRequest = { source, geometry: kind === "geometry" ? depotPaths : [], textures: kind === "textures" ? depotPaths : [],
          masks: kind === "masks" ? depotPaths : [], materials: true };
        const needed = fromCache(request, answer, kind === "textures" ? decoded() : null);
        if (!anyNeeded(needed)) return answer;
        const outDir = join(workDir(), kind);
        mkdirSync(outDir, { recursive: true });
        await run({ source, depotPaths: neededPaths(needed), outDir, withMaterials: kind === "geometry", signal });
        const unnamed = await collect(source, needed, outDir, answer, true, { signal });
        await byHash(source, unnamed, outDir, answer, signal);
        return answer;
      };
      return {
        tool,
        present: depotPaths => present(source, depotPaths),
        async geometry(depotPaths) { return (await one("geometry", depotPaths)).geometry; },
        async textures(depotPaths) { return (await one("textures", depotPaths)).textures; },
        async masks(depotPaths) { return (await one("masks", depotPaths)).masks; },
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
