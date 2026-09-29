/**
 * Host adapter: textures and layer masks exported by XF Studio's own reader first (src/native/texture-decode.ts, mlmask.ts), and by
 * WolvenKit per resource when the reader can't answer one. It wraps any `GameAssetExporter` (the WolvenKit one in production): geometry
 * passes through untouched, and each texture and `.mlmask` of a single-archive source is decoded natively, in the texture decode workers,
 * to the PNGs the preview is served. Only the mip the preview takes is decoded (the largest at or under `maxSide`), so an 8192² body map
 * costs neither WolvenKit's full-size conversion nor the host's halving (PIPE-104). A mask's layers are texel for texel WolvenKit 9.0.1's
 * (PREV-190: masks were the one thing a cold hairstyle still launched WolvenKit for, 3.3–3.8 s).
 * - **Lanes.** A batch's textures and masks are decoded by up to `lanes()` workers side by side (each its own decoder), largest first.
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
import { type ExportAnswer, type ExportBase, type ExportedMask, type ExportedTexture, GameAssetExportCache, GameAssetExportError, type ExportKind, type ExportOptions, type ExportRequest,
  type ExportSource, type GameAssetExporter, type GameAssetExportSession } from "./game-asset-export";
import type { NativeDecoder } from "./native/native-decode";
import type { NativeFailureKind } from "./native/native-errors";
import { NATIVE_READER_DATA, openNativeDecoderAsync, type OpenedDecoder } from "./native/native-fetch-port";
import { NATIVE_MASK_VERSION, NATIVE_TEXTURE_VERSION, type NativeMaskOutcome, type NativeTextureOutcome, type NativeTextureRequest } from "./native/texture-decode";
import { nativeRouteStamp } from "./resolver-host";

/**
 * The texture reader's identity in cache keys: its output rules (texture-decode.ts `NATIVE_TEXTURE_VERSION`) and the resource reader's
 * version and data hash, which decide how the texture resource reads (NATIVE-61).
 */
export const NATIVE_TEXTURE_IDENTITY = `xfs-native-texture:${NATIVE_TEXTURE_VERSION}:${NATIVE_READER_DATA}`;
/** The mask reader's identity in cache keys: its output rules (`NATIVE_MASK_VERSION`) and the resource reader's. */
export const NATIVE_MASK_IDENTITY = `xfs-native-mask:${NATIVE_MASK_VERSION}:${NATIVE_READER_DATA}`;
/** Time budget per texture in the worker: a 4096² BC7 mip decodes and compresses in about a second; far above that on a loaded machine. */
export const NATIVE_TEXTURE_TIMEOUT_MS = 60_000;

/** What decodes textures and layer masks: a native decoder's methods (a worker in production). */
export type TextureDecoder = Pick<NativeDecoder, "decodeTexture" | "decodeMask">;
/** Textures this exporter answered: decoded now, from its cache, or handed to the wrapped exporter (by the native refusal's kind). */
export type NativeTextureStats = { decoded: number; cached: number; fellBack: number; readonly byKind: Partial<Record<NativeFailureKind, number>>;
  /** Wall time of the native decodes, in ms. */ decodeMs: number;
  /** Wall time of the wrapped exporter's runs (WolvenKit), in ms, beside the decodes. */ innerMs: number;
  /** Layer masks: decoded now, from the cache, handed to the wrapped exporter. */ masks: { decoded: number; cached: number; fellBack: number } };
export type NativeFirstExporter = GameAssetExporter & { readonly nativeTextures: NativeTextureStats };

export type NativeFirstExporterOptions = {
  /** The exporter's cache folder (the wrapped exporter's, so budgets and Clear cover both). */
  cacheRoot: string;
  /** The largest texture side served (character-detail-service.ts `SERVED_TEXTURE_MAX`). */
  maxSide: number;
  /**
   * The game folder's texture decoder for a lane (0 first), or null when there is none (then every texture and mask goes to the wrapped
   * exporter; a lane without one is simply not used).
   */
  decoder: (gameRoot: string, lane: number) => Promise<TextureDecoder | null>;
  /** How many lanes decode side by side now (default 1): the host asks for more only while memory allows. */
  lanes?: () => number;
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
  const maskCache = new GameAssetExportCache(options.cacheRoot, { key: NATIVE_MASK_IDENTITY, label: "XF Studio's mask reader" });
  const stats: NativeTextureStats = { decoded: 0, cached: 0, fellBack: 0, byKind: {}, decodeMs: 0, innerMs: 0, masks: { decoded: 0, cached: 0, fellBack: 0 } };
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
  const layersOf = (files: Record<string, string> | null) => {
    if (!files?.["mask.json"]) return null;
    const layers: string[] = [];
    for (let index = 0; files[`layer-${index}.png`]; index++) layers.push(files[`layer-${index}.png`]!);
    return layers.length ? layers : null;
  };
  const cachedMask = (depotPath: string, source: ExportSource): ExportedMask | null => {
    const layers = layersOf(maskCache.read(depotPath, source));
    return layers ? { depotPath, hash: depotHash(depotPath), layers, cached: true } : null;
  };

  type Job = { kind: "textures" | "masks"; source: ExportSource; depotPath: string; index: number };
  type Decoded = { textures: Map<string, ExportedTexture>[]; masks: Map<string, ExportedMask>[]; refused: Job[] };
  /**
   * Decode `jobs` natively into per-request maps, on up to `lanes()` decoders side by side (each lane one worker, serial within it); the
   * jobs a reader refused are returned for the wrapped exporter. Stops with `cancelled` between resources once `signal` aborts.
   */
  const decodeJobs = async (jobs: readonly Job[], requests: number, signal?: AbortSignal): Promise<Decoded> => {
    const out: Decoded = { textures: Array.from({ length: requests }, () => new Map()), masks: Array.from({ length: requests }, () => new Map()), refused: [] };
    if (!jobs.length) return out;
    const gameRoot = jobs[0]!.source.gameRoot;
    const wanted = Math.max(1, Math.min(options.lanes?.() ?? 1, jobs.length));
    const decoders = (await Promise.all(Array.from({ length: wanted }, (_, lane) => options.decoder(gameRoot, lane).catch(() => null))))
      .filter((decoder): decoder is TextureDecoder => !!decoder);
    const refuse = (job: Job, kind: NativeFailureKind) => {
      if (job.kind === "masks") stats.masks.fellBack++; else stats.fellBack++;
      stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
      out.refused.push(job);
    };
    if (!decoders.length) { for (const job of jobs) refuse(job, "unavailable"); return out; }
    const queue = [...jobs];
    const works: string[] = [];
    const lane = async (decoder: TextureDecoder) => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (signal?.aborted) throw new GameAssetExportError("cancelled", "The export was cancelled.");
        const began = performance.now();
        const label = `${job.source.archivePath.split(/[\\/]/).pop()}: ${job.depotPath}`;
        if (job.kind === "masks") {
          let outcome: NativeMaskOutcome;
          if (!decoder.decodeMask) outcome = { ok: false, kind: "unavailable", message: "This decoder doesn't read layer masks." };
          else {
            try { outcome = await decoder.decodeMask({ archivePath: job.source.archivePath, hash: depotHash(job.depotPath), timeoutMs: options.timeoutMs ?? NATIVE_TEXTURE_TIMEOUT_MS }); }
            catch (error) { outcome = { ok: false, kind: "internal", message: String((error as Error)?.message ?? error), stack: (error as Error)?.stack }; }
          }
          stats.decodeMs += performance.now() - began;
          if (!outcome.ok) { onFallback(outcome.kind, label, outcome.message, outcome.stack); refuse(job, outcome.kind); continue; }
          const work = maskCache.createWork(), name = depotHash(job.depotPath), files: Record<string, string> = {};
          works.push(work);
          mkdirSync(work, { recursive: true });
          outcome.mask.layers.forEach((layer, index) => { const file = join(work, `${name}-${index}.png`); writeFileSync(file, layer.png); files[`layer-${index}.png`] = file; });
          const meta = join(work, `${name}.json`);
          writeFileSync(meta, JSON.stringify({ reader: NATIVE_MASK_IDENTITY, depotPath: job.depotPath, layers: outcome.mask.layers.map(layer => [layer.width, layer.height]),
            extractedSha256: outcome.mask.extractedSha256 }));
          files["mask.json"] = meta;
          const written = maskCache.write(job.depotPath, job.source, files);
          out.masks[job.index]!.set(job.depotPath, { depotPath: job.depotPath, hash: depotHash(job.depotPath), layers: layersOf(written) ?? [], cached: false });
          stats.masks.decoded++;
          continue;
        }
        const request: NativeTextureRequest = { archivePath: job.source.archivePath, hash: depotHash(job.depotPath), maxSide: options.maxSide,
          timeoutMs: options.timeoutMs ?? NATIVE_TEXTURE_TIMEOUT_MS };
        let outcome: NativeTextureOutcome;
        if (!decoder.decodeTexture) outcome = { ok: false, kind: "unavailable", message: "This decoder doesn't read textures." };
        else {
          try { outcome = await decoder.decodeTexture(request); }
          catch (error) { outcome = { ok: false, kind: "internal", message: String((error as Error)?.message ?? error), stack: (error as Error)?.stack }; }
        }
        stats.decodeMs += performance.now() - began;
        if (!outcome.ok) { onFallback(outcome.kind, label, outcome.message, outcome.stack); refuse(job, outcome.kind); continue; }
        const { texture } = outcome;
        const work = cache.createWork(), name = depotHash(job.depotPath), png = join(work, `${name}.png`), meta = join(work, `${name}.json`);
        works.push(work);
        mkdirSync(work, { recursive: true });
        writeFileSync(png, texture.png);
        writeFileSync(meta, JSON.stringify({ reader: NATIVE_TEXTURE_IDENTITY, depotPath: job.depotPath, width: texture.width, height: texture.height, gameWidth: texture.gameWidth,
          gameHeight: texture.gameHeight, mip: texture.mip, format: texture.format, isGamma: texture.isGamma, extractedSha256: texture.extractedSha256 }));
        out.textures[job.index]!.set(job.depotPath, answerOf(job.depotPath, cache.write(job.depotPath, job.source, { "texture.png": png, "texture.json": meta }), false));
        stats.decoded++;
      }
    };
    try { await Promise.all(decoders.map(lane)); }
    finally { for (const work of works) { try { cache.remove(work); } catch { /* Best effort. */ } } }
    return out;
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
    has(kind: ExportKind, depotPath: string, source: ExportSource, base?: ExportBase) {
      if (kind === "textures" && singleArchive(source) && cache.present(depotPath, source, ["texture.png", "texture.json"])) return true;
      if (kind === "masks" && singleArchive(source) && maskCache.present(depotPath, source, ["mask.json", "layer-0.png"])) return true;
      return inner.has?.(kind, depotPath, source, base) ?? false;
    },
    async exportAll(requests, signal, exportOptions) {
      // Cached native answers first; what is left of each single-archive source is decoded natively beside the wrapped exporter's run
      // for geometry and other sources' textures and masks, and what the reader refuses goes to the wrapped exporter afterwards.
      const nativeTextures = requests.map(() => new Map<string, ExportedTexture>()), nativeMasks = requests.map(() => new Map<string, ExportedMask>());
      const jobs: Job[] = [];
      const passed = requests.map((request, index): ExportRequest => {
        if ((!request.textures.length && !request.masks.length) || !singleArchive(request.source)) return request;
        for (const depotPath of new Set(request.textures)) {
          const hit = cached(depotPath, request.source);
          if (hit) { nativeTextures[index]!.set(depotPath, hit); stats.cached++; } else jobs.push({ kind: "textures", source: request.source, depotPath, index });
        }
        for (const depotPath of new Set(request.masks)) {
          const hit = cachedMask(depotPath, request.source);
          if (hit) { nativeMasks[index]!.set(depotPath, hit); stats.masks.cached++; } else jobs.push({ kind: "masks", source: request.source, depotPath, index });
        }
        return { ...request, textures: [], masks: [] };
      });
      const settle = <T>(work: Promise<T>) => work.then(value => ({ value }), (error: unknown) => ({ error }));
      const [first, decodedOutcome] = await Promise.all([settle(innerAll(passed, signal, exportOptions)), settle(decodeJobs(jobs, requests.length, signal))]);
      if ("error" in first) throw first.error;
      if ("error" in decodedOutcome) throw decodedOutcome.error;
      const answers = first.value, decoded = decodedOutcome.value;
      if (decoded.refused.length) {
        const byIndex = new Map<number, { textures: string[]; masks: string[] }>();
        for (const job of decoded.refused) {
          const entry = byIndex.get(job.index) ?? { textures: [], masks: [] };
          entry[job.kind].push(job.depotPath);
          byIndex.set(job.index, entry);
        }
        const order = [...byIndex.keys()];
        const again = order.map((index): ExportRequest => ({ source: requests[index]!.source, geometry: [], textures: byIndex.get(index)!.textures, masks: byIndex.get(index)!.masks }));
        const fallback = await innerAll(again, signal, exportOptions);
        order.forEach((index, at) => {
          const answer = fallback[at]!;
          for (const [path, texture] of answer.textures) answers[index]!.textures.set(path, texture);
          for (const [path, mask] of answer.masks) answers[index]!.masks.set(path, mask);
          if (answer.failed && !answers[index]!.failed) answers[index]!.failed = answer.failed;
        });
      }
      requests.forEach((_, index) => {
        for (const [path, texture] of nativeTextures[index]!) answers[index]!.textures.set(path, texture);
        for (const [path, texture] of decoded.textures[index]!) answers[index]!.textures.set(path, texture);
        for (const [path, mask] of nativeMasks[index]!) answers[index]!.masks.set(path, mask);
        for (const [path, mask] of decoded.masks[index]!) answers[index]!.masks.set(path, mask);
      });
      return answers;
    },
    open(source, signal): GameAssetExportSession {
      const session = inner.open(source, signal);
      return {
        tool: session.tool,
        present: depotPaths => session.present(depotPaths),
        geometry: depotPaths => session.geometry(depotPaths),
        async masks(depotPaths) {
          if (!singleArchive(source)) return session.masks(depotPaths);
          const out = new Map<string, ExportedMask>(), jobs: Job[] = [];
          for (const depotPath of new Set(depotPaths)) {
            const hit = cachedMask(depotPath, source);
            if (hit) { out.set(depotPath, hit); stats.masks.cached++; } else jobs.push({ kind: "masks", source, depotPath, index: 0 });
          }
          const decoded = await decodeJobs(jobs, 1, signal);
          for (const [path, mask] of decoded.masks[0]!) out.set(path, mask);
          if (decoded.refused.length) for (const [path, mask] of await session.masks(decoded.refused.map(job => job.depotPath))) out.set(path, mask);
          return out;
        },
        async textures(depotPaths) {
          if (!singleArchive(source)) return session.textures(depotPaths);
          const out = new Map<string, ExportedTexture>(), jobs: Job[] = [];
          for (const depotPath of new Set(depotPaths)) {
            const hit = cached(depotPath, source);
            if (hit) { out.set(depotPath, hit); stats.cached++; } else jobs.push({ kind: "textures", source, depotPath, index: 0 });
          }
          const decoded = await decodeJobs(jobs, 1, signal);
          for (const [path, texture] of decoded.textures[0]!) out.set(path, texture);
          if (decoded.refused.length) for (const [path, texture] of await session.textures(decoded.refused.map(job => job.depotPath))) out.set(path, texture);
          return out;
        },
        close: () => session.close(),
      };
    },
  };
}

/**
 * One native decoder per game folder, opened when first asked for (a worker of its own, so a long texture or mesh never holds up the
 * resolver's reads) and opened again when the game's Oodle library changes. One that couldn't be opened for a reason that may pass is
 * tried again after a minute; `XFS_NATIVE_READER=0` turns it off (WolvenKit exports everything). The worker releases the library after
 * a minute idle (native-decode.ts), and the next request starts another. The texture exporter keeps one set, the mesh exporter
 * (native-geometry-export.ts) another, so textures and meshes decode side by side.
 */
/**
 * How long a texture or mesh worker may sit idle before it exits. Such a worker keeps 60–190 MB (its heap and the archive indexes it read)
 * until it exits, and its work comes in bursts (a V, one click's parts), so it goes after 15 s rather than the resolver decoder's minute
 * (DESK-08). Starting one again costs about 35 ms with its first texture, against the hundreds of milliseconds a new part takes anyway.
 */
export const MEDIA_WORKER_IDLE_MS = 15_000;

export class NativeDecoders {
  private readonly decoders = new Map<string, { stamp: string; opened: Promise<OpenedDecoder>; at: number }>();
  constructor(private readonly options: { script?: string | URL; open?: (gameRoot: string) => Promise<OpenedDecoder>; log?: (message: string) => void;
    env?: Record<string, string | undefined>;
    /** Time budget per request in the worker (default: a texture's). */ timeoutMs?: number;
    /** How long a worker may sit idle before it exits (default: `MEDIA_WORKER_IDLE_MS`). */ idleMs?: number;
    /** What the decoder reads, for the log line when it can't be opened (default: textures). */ label?: { reader: string; what: string };
    /** An environment variable that turns this reader alone off when "0" (besides `XFS_NATIVE_READER`), for comparisons. */ offSwitch?: string } = {}) {}

  async get(gameRoot: string): Promise<NativeDecoder | null> {
    const env = this.options.env ?? process.env;
    if (env.XFS_NATIVE_READER === "0" || (this.options.offSwitch && env[this.options.offSwitch] === "0")) return null;
    const stamp = nativeRouteStamp(gameRoot);
    let entry = this.decoders.get(gameRoot);
    if (entry && entry.stamp !== stamp) { this.closeEntry(entry); entry = undefined; }
    if (entry) {
      const settled = await entry.opened;
      if (settled.decoder || settled.permanent || Date.now() - entry.at < 60_000) return settled.decoder;
      entry = undefined;
    }
    const timeoutMs = this.options.timeoutMs ?? NATIVE_TEXTURE_TIMEOUT_MS;
    const idleMs = this.options.idleMs ?? MEDIA_WORKER_IDLE_MS;
    const open = this.options.open ?? (root => openNativeDecoderAsync(root, { timeoutMs, idleMs, ...(this.options.script ? { script: this.options.script } : {}) }));
    const opened = open(gameRoot).catch((error: unknown): OpenedDecoder => ({ decoder: null, reason: String((error as Error)?.message ?? error), permanent: false }));
    this.decoders.set(gameRoot, { stamp, opened, at: Date.now() });
    const settled = await opened;
    const label = this.options.label ?? { reader: "texture reader", what: "textures" };
    if (!settled.decoder) this.options.log?.(`XF Studio's ${label.reader} is off for this game folder, so WolvenKit exports ${label.what}: ${settled.reason}`);
    return settled.decoder;
  }

  private closeEntry(entry: { opened: Promise<OpenedDecoder> }): void { void entry.opened.then(settled => settled.decoder?.close()); }

  close(): void { for (const entry of this.decoders.values()) this.closeEntry(entry); this.decoders.clear(); }
}
/** The texture exporter's decoders (the name it had before meshes shared the class). */
export const NativeTextureDecoders = NativeDecoders;
export type NativeTextureDecoders = NativeDecoders;
