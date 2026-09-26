/**
 * Host adapter: textures exported by XF Studio's own reader first (src/native/texture-decode.ts), and by WolvenKit per resource when the
 * reader can't answer one. It wraps any `GameAssetExporter` (the WolvenKit one in production): geometry and layer masks pass through
 * untouched, and each texture of a single-archive source is decoded natively, in the texture decode worker, to the PNG the preview is
 * served. Only the mip the preview takes is decoded (the largest at or under `maxSide`), so an 8192² body map costs neither WolvenKit's
 * full-size conversion nor the host's halving (PIPE-104).
 *
 * - **Cache.** Native PNGs live in the exporter's own cache folder (so the prepared-files budget and Clear cover them), keyed by the depot
 *   hash, the archive's fingerprint and the texture reader's identity (`NATIVE_TEXTURE_IDENTITY`: its output version and the served
 *   size), never WolvenKit's. A texture WolvenKit answered stays in WolvenKit's entries.
 * - **Fallback per resource.** A texture the reader refuses (a format it doesn't decode, a damaged file, over a budget, the worker down)
 *   is exported by the wrapped exporter, in one extra launch for all of a batch's refusals. Refusals are counted by kind; unexpected ones
 *   go to the diagnostics log.
 * - **Sources.** Only a source that is one archive file (the character details' winning archives) is read natively; a folder of
 *   archives (the preview core's game content source) goes to the wrapped exporter.
 * - **Orientation and channels** are those of WolvenKit's PNGs (rows bottom-up, BC4 as grey, BC5 with blue 0), so a texture reads the
 *   same whichever reader answered; knowledge/archive-format.md §10 has the oracle comparison.
 */
import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileSha256 } from "./derived-cache";
import { depotHash } from "./depot-path";
import { hostFailure } from "./diagnostics/host-log";
import { type ExportAnswer, type ExportedTexture, GameAssetExportCache, GameAssetExportError, type ExportKind, type ExportOptions, type ExportRequest,
  type ExportSource, type GameAssetExporter, type GameAssetExportSession } from "./game-asset-export";
import type { NativeDecoder } from "./native/native-decode";
import type { NativeFailureKind } from "./native/native-errors";
import { openNativeDecoderAsync, type OpenedDecoder } from "./native/native-fetch-port";
import { NATIVE_TEXTURE_VERSION, type NativeTextureOutcome, type NativeTextureRequest } from "./native/texture-decode";
import { nativeRouteStamp } from "./resolver-host";

/** The texture reader's identity in cache keys: its output rules (texture-decode.ts `NATIVE_TEXTURE_VERSION`). */
export const NATIVE_TEXTURE_IDENTITY = `xfs-native-texture:${NATIVE_TEXTURE_VERSION}`;
/** Time budget per texture in the worker: a 4096² BC7 mip decodes and compresses in about a second; far above that on a loaded machine. */
export const NATIVE_TEXTURE_TIMEOUT_MS = 60_000;

/** What decodes textures: a native decoder's texture method (a worker in production). */
export type TextureDecoder = Pick<NativeDecoder, "decodeTexture">;
/** Textures this exporter answered: decoded now, from its cache, or handed to the wrapped exporter (by the native refusal's kind). */
export type NativeTextureStats = { decoded: number; cached: number; fellBack: number; readonly byKind: Partial<Record<NativeFailureKind, number>>;
  /** Wall time of the native decodes, in ms. */ decodeMs: number;
  /** Wall time of the wrapped exporter's runs (WolvenKit), in ms, beside the decodes. */ innerMs: number };
export type NativeFirstExporter = GameAssetExporter & { readonly nativeTextures: NativeTextureStats };

export type NativeFirstExporterOptions = {
  /** The exporter's cache folder (the wrapped exporter's, so budgets and Clear cover both). */
  cacheRoot: string;
  /** The largest texture side served (character-detail-service.ts `SERVED_TEXTURE_MAX`). */
  maxSide: number;
  /** The game folder's texture decoder, or null when there is none (then every texture goes to the wrapped exporter). */
  decoder: (gameRoot: string) => Promise<TextureDecoder | null>;
  timeoutMs?: number;
  /** Told each refusal; by default unexpected kinds go to the diagnostics log. */
  onFallback?: (kind: NativeFailureKind, resource: string, message: string, stack?: string) => void;
};

/** Refusals that are ordinary (a format or kind the reader doesn't decode, a resource another archive holds, the worker down). */
const QUIET: ReadonlySet<NativeFailureKind> = new Set(["not-indexed", "unsupported", "not-verified", "unavailable"]);
const defaultFallback = (kind: NativeFailureKind, resource: string, message: string, stack?: string) => {
  if (QUIET.has(kind)) return;
  const plain = `XF Studio's texture reader couldn't read ${resource} (${kind}), so WolvenKit exports it: ${message.slice(0, 300)}`;
  if (kind === "internal") {
    const error = new Error(message);
    if (stack) error.stack = stack;
    hostFailure("character", "native_texture_internal", plain, error, "warn");
  } else hostFailure("character", "native_texture_fallback", plain, undefined, "warn");
};

/** Whether a source is one archive file (read natively) rather than a folder of archives. */
function singleArchive(source: ExportSource): boolean {
  if (!/\.archive$/i.test(source.archivePath)) return false;
  try { return statSync(source.archivePath).isFile(); } catch { return false; }
}

export function createNativeFirstExporter(inner: GameAssetExporter, options: NativeFirstExporterOptions): NativeFirstExporter {
  const cache = new GameAssetExportCache(options.cacheRoot, { key: `${NATIVE_TEXTURE_IDENTITY}|max${options.maxSide}`, label: "XF Studio's texture reader" });
  const stats: NativeTextureStats = { decoded: 0, cached: 0, fellBack: 0, byKind: {}, decodeMs: 0, innerMs: 0 };
  const onFallback = options.onFallback ?? defaultFallback;
  const answerOf = (depotPath: string, files: Record<string, string>, cached: boolean): ExportedTexture => {
    let gameSize: ExportedTexture["gameSize"];
    try {
      const meta = JSON.parse(readFileSync(files["texture.json"]!, "utf8")) as { gameWidth?: unknown; gameHeight?: unknown };
      if (typeof meta.gameWidth === "number" && typeof meta.gameHeight === "number") gameSize = { width: meta.gameWidth, height: meta.gameHeight };
    } catch { /* The size note is optional. */ }
    return { depotPath, hash: depotHash(depotPath), png: files["texture.png"]!, pngSha256: fileSha256(files["texture.png"]!), cached, ...(gameSize ? { gameSize } : {}) };
  };
  const cached = (depotPath: string, source: ExportSource): ExportedTexture | null => {
    const files = cache.read(depotPath, source);
    return files?.["texture.png"] && files["texture.json"] ? answerOf(depotPath, files, true) : null;
  };

  /**
   * Decode `paths` of one source natively, one at a time (the worker is serial), into `into`; returns the paths to hand to the wrapped
   * exporter. Stops with `cancelled` between textures once `signal` aborts.
   */
  const decodeAll = async (source: ExportSource, paths: readonly string[], into: Map<string, ExportedTexture>, signal?: AbortSignal): Promise<string[]> => {
    const rest: string[] = [];
    if (!paths.length) return rest;
    const decoder = await options.decoder(source.gameRoot).catch(() => null);
    if (!decoder?.decodeTexture) { stats.fellBack += paths.length; stats.byKind.unavailable = (stats.byKind.unavailable ?? 0) + paths.length; return [...paths]; }
    let work: string | null = null;
    try {
      for (const depotPath of paths) {
        if (signal?.aborted) throw new GameAssetExportError("cancelled", "The export was cancelled.");
        const request: NativeTextureRequest = { archivePath: source.archivePath, hash: depotHash(depotPath), maxSide: options.maxSide,
          timeoutMs: options.timeoutMs ?? NATIVE_TEXTURE_TIMEOUT_MS };
        const began = performance.now();
        let outcome: NativeTextureOutcome;
        try { outcome = await decoder.decodeTexture(request); }
        catch (error) { outcome = { ok: false, kind: "internal", message: String((error as Error)?.message ?? error), stack: (error as Error)?.stack }; }
        stats.decodeMs += performance.now() - began;
        if (!outcome.ok) {
          stats.fellBack++; stats.byKind[outcome.kind] = (stats.byKind[outcome.kind] ?? 0) + 1;
          onFallback(outcome.kind, `${source.archivePath.split(/[\\/]/).pop()}: ${depotPath}`, outcome.message, outcome.stack);
          rest.push(depotPath);
          continue;
        }
        const { texture } = outcome;
        work ??= cache.createWork();
        const name = depotHash(depotPath), png = join(work, `${name}.png`), meta = join(work, `${name}.json`);
        mkdirSync(work, { recursive: true });
        writeFileSync(png, texture.png);
        writeFileSync(meta, JSON.stringify({ reader: NATIVE_TEXTURE_IDENTITY, depotPath, width: texture.width, height: texture.height, gameWidth: texture.gameWidth,
          gameHeight: texture.gameHeight, mip: texture.mip, format: texture.format, isGamma: texture.isGamma, extractedSha256: texture.extractedSha256 }));
        into.set(depotPath, answerOf(depotPath, cache.write(depotPath, source, { "texture.png": png, "texture.json": meta }), false));
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

  return {
    tool: inner.tool,
    nativeTextures: stats,
    has(kind: ExportKind, depotPath: string, source: ExportSource) {
      if (kind === "textures" && singleArchive(source) && cache.present(depotPath, source, ["texture.png", "texture.json"])) return true;
      return inner.has?.(kind, depotPath, source) ?? false;
    },
    async exportAll(requests, signal, exportOptions) {
      // Cached native answers first; what is left of each single-archive source is decoded natively beside the wrapped exporter's run
      // for geometry, masks and other sources' textures, and what the reader refuses goes to the wrapped exporter afterwards.
      const native = requests.map(() => new Map<string, ExportedTexture>());
      const jobs: { index: number; paths: string[] }[] = [];
      const passed = requests.map((request, index): ExportRequest => {
        if (!request.textures.length || !singleArchive(request.source)) return request;
        const paths: string[] = [];
        for (const depotPath of new Set(request.textures)) {
          const hit = cached(depotPath, request.source);
          if (hit) { native[index]!.set(depotPath, hit); stats.cached++; } else paths.push(depotPath);
        }
        if (paths.length) jobs.push({ index, paths });
        return { ...request, textures: [] };
      });
      const decoding = (async () => {
        const refused: { index: number; paths: string[] }[] = [];
        for (const job of jobs) {
          const rest = await decodeAll(requests[job.index]!.source, job.paths, native[job.index]!, signal);
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
        const again = refused.map(({ index, paths }): ExportRequest => ({ source: requests[index]!.source, geometry: [], textures: paths, masks: [] }));
        const fallback = await innerAll(again, signal, exportOptions);
        refused.forEach(({ index }, at) => {
          const answer = fallback[at]!;
          for (const [path, texture] of answer.textures) answers[index]!.textures.set(path, texture);
          if (answer.failed && !answers[index]!.failed) answers[index]!.failed = answer.failed;
        });
      }
      native.forEach((textures, index) => { for (const [path, texture] of textures) answers[index]!.textures.set(path, texture); });
      return answers;
    },
    open(source, signal): GameAssetExportSession {
      const session = inner.open(source, signal);
      return {
        tool: session.tool,
        present: depotPaths => session.present(depotPaths),
        geometry: depotPaths => session.geometry(depotPaths),
        masks: depotPaths => session.masks(depotPaths),
        async textures(depotPaths) {
          if (!singleArchive(source)) return session.textures(depotPaths);
          const out = new Map<string, ExportedTexture>(), paths: string[] = [];
          for (const depotPath of new Set(depotPaths)) {
            const hit = cached(depotPath, source);
            if (hit) { out.set(depotPath, hit); stats.cached++; } else paths.push(depotPath);
          }
          const rest = await decodeAll(source, paths, out, signal);
          if (rest.length) for (const [path, texture] of await session.textures(rest)) out.set(path, texture);
          return out;
        },
        close: () => session.close(),
      };
    },
  };
}

/**
 * One texture decoder per game folder, opened when first asked for (a worker of its own, so a long texture never holds up the resolver's
 * reads) and opened again when the game's Oodle library changes. One that couldn't be opened for a reason that may pass is tried again
 * after a minute; `XFS_NATIVE_READER=0` turns it off (WolvenKit exports every texture). The worker releases the library after a minute
 * idle (native-decode.ts), and the next texture starts another.
 */
export class NativeTextureDecoders {
  private readonly decoders = new Map<string, { stamp: string; opened: Promise<OpenedDecoder>; at: number }>();
  constructor(private readonly options: { script?: string | URL; open?: (gameRoot: string) => Promise<OpenedDecoder>; log?: (message: string) => void;
    env?: Record<string, string | undefined> } = {}) {}

  async get(gameRoot: string): Promise<TextureDecoder | null> {
    if ((this.options.env ?? process.env).XFS_NATIVE_READER === "0") return null;
    const stamp = nativeRouteStamp(gameRoot);
    let entry = this.decoders.get(gameRoot);
    if (entry && entry.stamp !== stamp) { this.closeEntry(entry); entry = undefined; }
    if (entry) {
      const settled = await entry.opened;
      if (settled.decoder || settled.permanent || Date.now() - entry.at < 60_000) return settled.decoder;
      entry = undefined;
    }
    const open = this.options.open ?? (root => openNativeDecoderAsync(root, { timeoutMs: NATIVE_TEXTURE_TIMEOUT_MS, ...(this.options.script ? { script: this.options.script } : {}) }));
    const opened = open(gameRoot).catch((error: unknown): OpenedDecoder => ({ decoder: null, reason: String((error as Error)?.message ?? error), permanent: false }));
    this.decoders.set(gameRoot, { stamp, opened, at: Date.now() });
    const settled = await opened;
    if (!settled.decoder) this.options.log?.(`XF Studio's texture reader is off for this game folder, so WolvenKit exports textures: ${settled.reason}`);
    return settled.decoder;
  }

  private closeEntry(entry: { opened: Promise<OpenedDecoder> }): void { void entry.opened.then(settled => settled.decoder?.close()); }

  close(): void { for (const entry of this.decoders.values()) this.closeEntry(entry); this.decoders.clear(); }
}
