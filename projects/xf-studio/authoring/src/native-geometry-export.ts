/**
 * Host adapter: meshes and morph targets exported by XF Studio's own reader first (src/native/mesh-decode.ts), and by WolvenKit per
 * resource when the reader can't answer one (phase 4 of the native reader). It wraps any `GameAssetExporter` (in production the native
 * texture exporter around WolvenKit's): textures and layer masks pass through, and each mesh or morph target of a single-archive source
 * asked for without WolvenKit's materials file (the character details, which resolve materials themselves) is decoded natively, in a
 * decode worker of its own, to the GLB the preview has always been served, with the extracted resource as its `raw` file.
 *
 * - **The same GLB.** The vertex data is WolvenKit's, bit for bit, and the structure (chunk meshes and names, joints, skin, targets,
 *   extras) is the same; morph deltas are stored sparse. knowledge/archive-format.md §12 has the conventions and the oracle.
 * - **Cache.** Native GLBs live in the exporter's own cache folder (so the prepared-files budget and Clear cover them), keyed by the depot
 *   hash, the archive's fingerprint and the mesh reader's identity (`NATIVE_MESH_IDENTITY`), never WolvenKit's.
 * - **A morph target's skin** comes from its base mesh where the game finds it: the request's `bases` (the resolver's winning archive
 *   for the effective base mesh), else the path the file names in its own archive. The entry records which (`baseKey`: the base
 *   archive's fingerprint and the path's hash), and an entry made from another base is decoded again.
 * - **Fallback per resource.** A resource the reader refuses (a layout or parameter it doesn't decode, a damaged file, over a budget, the
 *   worker down) is exported by the wrapped exporter, in one extra launch for all of a batch's refusals. Refusals are counted by kind;
 *   unexpected ones go to the diagnostics log.
 * - **Changes against WolvenKit's GLB:** a morph target whose winning archive lacks its base mesh gets its skin (WolvenKit's per-archive
 *   export finds none); on the reference route the nails morph mod, the facial-rig fix's head and earring morphs and two piercing morphs.
 * - **Not read natively:** a folder of archives (the core preview's game content source) and geometry asked for with WolvenKit's
 *   materials file (the core preview's head and eyes); both go to the wrapped exporter.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { depotHash } from "./depot-path";
import { hostFailure } from "./diagnostics/host-log";
import { archiveExportSource, type ExportAnswer, type ExportBase, type ExportedGeometry, GameAssetExportCache, GameAssetExportError, type ExportKind, type ExportOptions, type ExportRequest,
  type ExportSource, type GameAssetExporter, type GameAssetExportSession } from "./game-asset-export";
import { NATIVE_MESH_VERSION, type NativeGeometryOutcome, type NativeGeometryRequest } from "./native/mesh-decode";
import type { NativeDecoder } from "./native/native-decode";
import type { NativeFailureKind } from "./native/native-errors";

/** The mesh reader's identity in cache keys: its output rules (mesh-decode.ts `NATIVE_MESH_VERSION`). */
export const NATIVE_MESH_IDENTITY = `xfs-native-mesh:${NATIVE_MESH_VERSION}`;
/** Time budget per mesh in the worker: the slowest real one (a CCXL lash's morph target) takes about half a second. */
export const NATIVE_GEOMETRY_TIMEOUT_MS = 60_000;

export type GeometryDecoder = Pick<NativeDecoder, "decodeGeometry">;
/** Meshes this exporter answered: decoded now, from its cache, or handed to the wrapped exporter (by the native refusal's kind). */
export type NativeGeometryStats = { decoded: number; cached: number; fellBack: number; readonly byKind: Partial<Record<NativeFailureKind, number>>;
  /** Wall time of the native decodes, in ms. */ decodeMs: number;
  /** Wall time of the wrapped exporter's runs, in ms, beside the decodes. */ innerMs: number };
export type NativeGeometryExporter = GameAssetExporter & { readonly nativeGeometry: NativeGeometryStats };

export type NativeGeometryExporterOptions = {
  /** The exporter's cache folder (the wrapped exporter's, so budgets and Clear cover both). */
  cacheRoot: string;
  /** The game folder's mesh decoder, or null when there is none (then every mesh goes to the wrapped exporter). */
  decoder: (gameRoot: string) => Promise<GeometryDecoder | null>;
  timeoutMs?: number;
  /** Told each refusal; by default unexpected kinds go to the diagnostics log. */
  onFallback?: (kind: NativeFailureKind, resource: string, message: string, stack?: string) => void;
};

/** Refusals that are ordinary (a layout the reader doesn't decode, a resource another archive holds, the worker down). */
const QUIET: ReadonlySet<NativeFailureKind> = new Set(["not-indexed", "unsupported", "not-verified", "unavailable"]);
const defaultFallback = (kind: NativeFailureKind, resource: string, message: string, stack?: string) => {
  if (QUIET.has(kind)) return;
  const plain = `XF Studio's mesh reader couldn't read ${resource} (${kind}), so WolvenKit exports it: ${message.slice(0, 300)}`;
  if (kind === "internal") {
    const error = new Error(message);
    if (stack) error.stack = stack;
    hostFailure("character", "native_mesh_internal", plain, error, "warn");
  } else hostFailure("character", "native_mesh_fallback", plain, undefined, "warn");
};

const GEOMETRY_FILES = ["raw", "export.glb", "geometry.json"] as const;
const isGeometry = (depotPath: string) => /\.(mesh|morphtarget)$/i.test(depotPath);
/** Whether a source is one archive file (read natively) rather than a folder of archives. */
function singleArchive(source: ExportSource): boolean {
  if (!/\.archive$/i.test(source.archivePath)) return false;
  try { return statSync(source.archivePath).isFile(); } catch { return false; }
}
/** Whether a request's geometry may be read natively (one archive, no WolvenKit materials file). */
const nativeEligible = (request: Pick<ExportRequest, "source" | "materials">) => !request.materials && singleArchive(request.source);

/** What the reader records beside a GLB: its identity, the hashes (so a hit needs no second hashing) and its plain notes. */
type GeometryMeta = { reader: string; depotPath: string; rawSha256: string; glbSha256: string; root: string; meshes: number; vertices: number; targets: number;
  joints: number; baseMesh?: string; notes: string[];
  /** Which base mesh gave a morph target's skin: `own` (the path it names, in its own archive) or the base archive's fingerprint and path hash. */
  baseKey?: string };
/** The cache's name for where a morph target's base mesh is read. */
const baseKeyOf = (base: ExportBase | undefined, gameRoot: string) =>
  base ? `${archiveExportSource(base.archivePath, gameRoot).fingerprint}|${depotHash(base.depotPath)}` : "own";

/** A geometry answer is a WolvenKit-shaped one with the reader's notes (`readerNote`) instead of a repair line. */
export type NativeExportedGeometry = ExportedGeometry & { readerNote?: string | null };

export function createNativeGeometryExporter(inner: GameAssetExporter, options: NativeGeometryExporterOptions): NativeGeometryExporter {
  const cache = new GameAssetExportCache(options.cacheRoot, { key: NATIVE_MESH_IDENTITY, label: "XF Studio's mesh reader" });
  const stats: NativeGeometryStats = { decoded: 0, cached: 0, fellBack: 0, byKind: {}, decodeMs: 0, innerMs: 0 };
  const onFallback = options.onFallback ?? defaultFallback;
  const answerOf = (depotPath: string, files: Record<string, string>, cachedHit: boolean, meta: GeometryMeta): NativeExportedGeometry => ({
    depotPath, hash: depotHash(depotPath), raw: files.raw!, rawSha256: meta.rawSha256, glb: files["export.glb"]!, glbSha256: meta.glbSha256,
    materials: null, materialsSha256: null, complete: true, cached: cachedHit, repair: null, readerNote: meta.notes.length ? meta.notes.join("; ") : null });
  const cached = (depotPath: string, source: ExportSource, base?: ExportBase): NativeExportedGeometry | null => {
    const files = cache.read(depotPath, source);
    if (!files || !GEOMETRY_FILES.every(name => files[name])) return null;
    try {
      const meta = JSON.parse(readFileSync(files["geometry.json"]!, "utf8")) as GeometryMeta;
      const baseKey = /\.morphtarget$/i.test(depotPath) ? baseKeyOf(base, source.gameRoot) : "own";
      return meta.reader === NATIVE_MESH_IDENTITY && (meta.baseKey ?? "own") === baseKey ? answerOf(depotPath, files, true, meta) : null;
    } catch { return null; }
  };

  /**
   * Decode `paths` of one source natively, one at a time (the worker is serial), into `into`; returns the paths to hand to the wrapped
   * exporter. Stops with `cancelled` between meshes once `signal` aborts.
   */
  const decodeAll = async (source: ExportSource, paths: readonly string[], into: Map<string, ExportedGeometry>, signal?: AbortSignal,
    bases: Readonly<Record<string, ExportBase>> = {}): Promise<string[]> => {
    const rest: string[] = [];
    if (!paths.length) return rest;
    const decoder = await options.decoder(source.gameRoot).catch(() => null);
    if (!decoder?.decodeGeometry) { stats.fellBack += paths.length; stats.byKind.unavailable = (stats.byKind.unavailable ?? 0) + paths.length; return [...paths]; }
    let work: string | null = null;
    try {
      for (const depotPath of paths) {
        if (signal?.aborted) throw new GameAssetExportError("cancelled", "The export was cancelled.");
        const base = /\.morphtarget$/i.test(depotPath) ? bases[depotPath.toLowerCase()] : undefined;
        const request: NativeGeometryRequest = { archivePath: source.archivePath, hash: depotHash(depotPath), timeoutMs: options.timeoutMs ?? NATIVE_GEOMETRY_TIMEOUT_MS,
          ...(base ? { base: { archivePath: base.archivePath, hash: depotHash(base.depotPath) } } : {}) };
        const began = performance.now();
        let outcome: NativeGeometryOutcome;
        try { outcome = await decoder.decodeGeometry(request); }
        catch (error) { outcome = { ok: false, kind: "internal", message: String((error as Error)?.message ?? error), stack: (error as Error)?.stack }; }
        stats.decodeMs += performance.now() - began;
        if (!outcome.ok) {
          stats.fellBack++; stats.byKind[outcome.kind] = (stats.byKind[outcome.kind] ?? 0) + 1;
          onFallback(outcome.kind, `${source.archivePath.split(/[\\/]/).pop()}: ${depotPath}`, outcome.message, outcome.stack);
          rest.push(depotPath);
          continue;
        }
        const { geometry } = outcome;
        work ??= cache.createWork();
        mkdirSync(work, { recursive: true });
        const name = depotHash(depotPath), raw = join(work, `${name}.raw`), glb = join(work, `${name}.glb`), metaFile = join(work, `${name}.json`);
        writeFileSync(raw, geometry.raw);
        writeFileSync(glb, geometry.glb);
        const meta: GeometryMeta = { reader: NATIVE_MESH_IDENTITY, depotPath, rawSha256: geometry.extractedSha256,
          glbSha256: createHash("sha256").update(geometry.glb).digest("hex"), root: geometry.root, meshes: geometry.meshes, vertices: geometry.vertices,
          targets: geometry.targets, joints: geometry.joints, ...(geometry.baseMesh ? { baseMesh: geometry.baseMesh } : {}), notes: [...geometry.notes],
          baseKey: /\.morphtarget$/i.test(depotPath) ? baseKeyOf(base, source.gameRoot) : "own" };
        writeFileSync(metaFile, JSON.stringify(meta));
        into.set(depotPath, answerOf(depotPath, cache.write(depotPath, source, { raw, "export.glb": glb, "geometry.json": metaFile }), false, meta));
        stats.decoded++;
      }
    } finally { if (work) { try { cache.remove(work); } catch { /* Best effort. */ } } }
    return rest;
  };

  /** The wrapped exporter over `requests`: its `exportAll`, or a session per source and kind. */
  const innerAll = async (requests: readonly ExportRequest[], signal?: AbortSignal, exportOptions?: ExportOptions): Promise<ExportAnswer[]> => {
    const began = performance.now();
    try { return await innerRun(requests, signal, exportOptions); } finally { stats.innerMs += performance.now() - began; }
  };
  const innerRun = async (requests: readonly ExportRequest[], signal?: AbortSignal, exportOptions?: ExportOptions): Promise<ExportAnswer[]> => {
    if (inner.exportAll) return inner.exportAll(requests, signal, exportOptions);
    return Promise.all(requests.map(async request => {
      const answer: ExportAnswer = { geometry: new Map(), textures: new Map(), masks: new Map() };
      if (!request.geometry.length && !request.textures.length && !request.masks.length) return answer;
      const session = inner.open(request.source, signal);
      try {
        if (request.geometry.length) answer.geometry = await session.geometry(request.geometry);
        if (request.textures.length) answer.textures = await session.textures(request.textures);
        if (request.masks.length) answer.masks = await session.masks(request.masks);
      } catch (error) {
        if (!(error instanceof GameAssetExportError) || error.code === "cancelled") throw error;
        answer.failed = error;
      } finally { session.close(); }
      return answer;
    }));
  };

  const exporter: NativeGeometryExporter = {
    tool: inner.tool,
    nativeGeometry: stats,
    has(kind: ExportKind, depotPath: string, source: ExportSource) {
      if (kind === "geometry" && isGeometry(depotPath) && singleArchive(source) && cache.present(depotPath, source, GEOMETRY_FILES)) return true;
      return inner.has?.(kind, depotPath, source) ?? false;
    },
    async exportAll(requests, signal, exportOptions) {
      // Cached native answers first; what is left of each eligible request's geometry is decoded natively beside the wrapped exporter's
      // run for everything else, and what the reader refuses goes to the wrapped exporter afterwards.
      const native = requests.map(() => new Map<string, ExportedGeometry>());
      const jobs: { index: number; paths: string[] }[] = [];
      const passed = requests.map((request, index): ExportRequest => {
        if (!request.geometry.length || !nativeEligible(request)) return request;
        const paths: string[] = [], other: string[] = [];
        for (const depotPath of new Set(request.geometry)) {
          if (!isGeometry(depotPath)) { other.push(depotPath); continue; }
          const hit = cached(depotPath, request.source, request.bases?.[depotPath.toLowerCase()]);
          if (hit) { native[index]!.set(depotPath, hit); stats.cached++; } else paths.push(depotPath);
        }
        if (paths.length) jobs.push({ index, paths });
        const { bases: _bases, ...rest } = request;
        return { ...rest, geometry: other };
      });
      const decoding = (async () => {
        const refused: { index: number; paths: string[] }[] = [];
        for (const job of jobs) {
          const rest = await decodeAll(requests[job.index]!.source, job.paths, native[job.index]!, signal, requests[job.index]!.bases);
          if (rest.length) refused.push({ index: job.index, paths: rest });
        }
        return refused;
      })();
      const settle = <T>(work: Promise<T>) => work.then(value => ({ value }), (error: unknown) => ({ error }));
      const [first, refusedOutcome] = await Promise.all([settle(innerAll(passed, signal, exportOptions)), settle(decoding)]);
      if ("error" in first) throw first.error;
      if ("error" in refusedOutcome) throw refusedOutcome.error;
      const answers = first.value;
      const refused = refusedOutcome.value;
      if (refused.length) {
        const again = refused.map(({ index, paths }): ExportRequest => ({ source: requests[index]!.source, geometry: paths, textures: [], masks: [],
          ...(requests[index]!.materials !== undefined ? { materials: requests[index]!.materials } : {}) }));
        const fallback = await innerAll(again, signal, exportOptions);
        refused.forEach(({ index }, at) => {
          const answer = fallback[at]!;
          for (const [path, geometry] of answer.geometry) answers[index]!.geometry.set(path, geometry);
          if (answer.failed && !answers[index]!.failed) answers[index]!.failed = answer.failed;
        });
      }
      native.forEach((geometry, index) => { for (const [path, value] of geometry) answers[index]!.geometry.set(path, value); });
      return answers;
    },
    open(source, signal): GameAssetExportSession {
      const session = inner.open(source, signal);
      return {
        tool: session.tool,
        present: depotPaths => session.present(depotPaths),
        textures: depotPaths => session.textures(depotPaths),
        masks: depotPaths => session.masks(depotPaths),
        async geometry(depotPaths) {
          // A session exports with WolvenKit's materials file (game-asset-export.ts), which the native reader doesn't write.
          return session.geometry(depotPaths);
        },
        close: () => session.close(),
      };
    },
  };
  // The texture reader's counts, when the wrapped exporter has one (the preparation's log line reads both).
  const textures = (inner as { nativeTextures?: unknown }).nativeTextures;
  if (textures) Object.defineProperty(exporter, "nativeTextures", { get: () => (inner as { nativeTextures?: unknown }).nativeTextures, enumerable: true });
  return exporter;
}
