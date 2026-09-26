/**
 * Host adapter: decodes one resource out of an archive natively and reports the outcome as data, never as a thrown error, so the
 * same code serves an in-process decoder and a worker (native-decode-worker.ts). A worker gives decoding a time budget: a resource
 * that takes too long is abandoned by terminating the worker, and the caller falls back to WolvenKit. Memory is bounded by the
 * per-resource caps (limits.ts); Bun ignores worker heap limits, so the caps, not the runtime, keep a hostile file small, and
 * terminating a worker releases everything it allocated.
 */
import { createHash } from "node:crypto";
import type { NativeArchive, NativeArchivePool } from "./archive-reader";
import { Cr2wFile } from "./cr2w-file";
import type { Decompress } from "./kark";
import { DecodeSession, DEFAULT_LIMITS, type DefaultedProperty, type NativeLimits, type NativeNote } from "./limits";
import { classifyNativeFailure, type NativeFailureKind } from "./native-errors";
import { readResourceJson } from "./resource-document";

export interface NativeDecodeRequest {
  /** The archive's path (the resolver's `MountedArchive.id`). */
  readonly archivePath: string;
  /** Depot hash, decimal. */
  readonly hash: string;
  /** Also look the resource's depot path up in the archive's own name list (the reference carried only a hash). */
  readonly needName: boolean;
}

export type NativeDecodeOutcome =
  | { readonly ok: true; readonly document: unknown; readonly extractedSha256: string; readonly root: string; readonly name: string | null;
    readonly notes: readonly NativeNote[]; readonly defaulted: readonly DefaultedProperty[] }
  | { readonly ok: false; readonly kind: NativeFailureKind; readonly message: string; readonly errorName?: string; readonly stack?: string };

export interface NativeDecodeOptions {
  /** Root classes the reader has been verified on; any other root is `not-verified`. */
  readonly roots: ReadonlySet<string>;
  readonly limits?: NativeLimits;
  /** Written as `Header.XfsNativeReader`. */
  readonly identity: string;
}

/** A way to decode resources natively: in this process, or in a worker with a time budget. */
export interface NativeDecoder {
  readonly identity: string;
  decode(request: NativeDecodeRequest): Promise<NativeDecodeOutcome>;
  close(): void;
}

const nameMaps = new WeakMap<NativeArchive, Map<string, string>>();
/** A hash's path from the archive's own name list (built once per parsed archive; a replaced archive is a new object). */
function nameOf(archive: NativeArchive, hash: string, depotHash: (path: string) => string): string | null {
  let byHash = nameMaps.get(archive);
  if (!byHash) {
    byHash = new Map();
    try { for (const name of archive.names()) byHash.set(depotHash(name), name); } catch { /* no usable name list */ }
    nameMaps.set(archive, byHash);
  }
  return byHash.get(hash) ?? null;
}

/** Read, check and decode one resource; every failure is returned with its kind. */
export function decodeFromPool(pool: NativeArchivePool, decompress: Decompress, request: NativeDecodeRequest, options: NativeDecodeOptions,
  depotHash: (path: string) => string): NativeDecodeOutcome {
  try {
    const bytes = pool.read(request.archivePath, request.hash);
    if (!bytes) return { ok: false, kind: "not-indexed", message: "The archive does not list the resource." };
    const session = new DecodeSession(options.limits ?? DEFAULT_LIMITS);
    const root = new Cr2wFile(bytes, session).exports[0]?.className;
    if (!root || !options.roots.has(root)) return { ok: false, kind: "not-verified", message: `Root class ${root ?? "(none)"} is not verified.` };
    const document = readResourceJson(bytes, decompress, { buffers: "trim", header: { XfsNativeReader: options.identity } }, session);
    return { ok: true, document, extractedSha256: createHash("sha256").update(bytes).digest("hex"), root,
      name: request.needName ? nameOf(pool.get(request.archivePath), request.hash, depotHash) : null, notes: session.notes, defaulted: session.defaultedProperties };
  } catch (error) {
    const kind = classifyNativeFailure(error);
    const failure = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return { ok: false, kind, message: String(failure?.message ?? error), errorName: typeof failure?.name === "string" ? failure.name : undefined,
      stack: kind === "internal" && typeof failure?.stack === "string" ? failure.stack : undefined };
  }
}

/** Decodes on the calling thread (tests, the differential tools, and hosts without workers). */
export class InProcessDecoder implements NativeDecoder {
  constructor(private readonly pool: NativeArchivePool, private readonly decompress: Decompress, private readonly options: NativeDecodeOptions,
    private readonly depotHash: (path: string) => string, private readonly onClose: () => void = () => {}) {}
  get identity() { return this.options.identity; }
  async decode(request: NativeDecodeRequest): Promise<NativeDecodeOutcome> { return decodeFromPool(this.pool, this.decompress, request, this.options, this.depotHash); }
  close(): void { this.onClose(); }
}

/** How a worker gets its decompressor: the game's Oodle library, or (the tests' own worker only) a stand-in codec by name. */
export type WorkerDecompressor = { readonly gameRoot: string; readonly trustedSha256?: string } | { readonly test: string };

/** What a worker is told at start. */
export interface WorkerInit {
  readonly type: "init";
  readonly decompressor: WorkerDecompressor;
  readonly roots: readonly string[];
  readonly limits: NativeLimits;
  readonly identity: string;
}

export interface WorkerDecoderOptions {
  readonly decompressor: WorkerDecompressor;
  readonly roots: ReadonlySet<string>;
  readonly limits?: NativeLimits;
  readonly identity: string;
  /** Wall-clock budget per resource, from the moment the worker receives it. */
  readonly timeoutMs?: number;
  /** The worker script (defaults to native-decode-worker.ts next to this module). */
  readonly script?: URL | string;
}

/** Default time budget per resource: far above the slowest real decode (see the backlog page's budget table). */
export const DEFAULT_DECODE_TIMEOUT_MS = 10_000;

type Pending = { request: NativeDecodeRequest; resolve: (outcome: NativeDecodeOutcome) => void };

/**
 * Decodes in a worker, one resource at a time, each within `timeoutMs`. A resource over its time budget, or a worker that dies,
 * answers `over-budget` or `internal` and the worker is replaced before the next resource.
 */
export class WorkerDecoder implements NativeDecoder {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private readonly queue: Pending[] = [];
  private busy: { pending: Pending; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private closed = false;
  /** Workers started (1 + replacements after timeouts or crashes). */
  started = 0;

  constructor(private readonly options: WorkerDecoderOptions) {}
  get identity() { return this.options.identity; }

  decode(request: NativeDecodeRequest): Promise<NativeDecodeOutcome> {
    if (this.closed) return Promise.resolve({ ok: false, kind: "internal", message: "The native decoder is closed." });
    return new Promise(resolve => { this.queue.push({ request, resolve }); this.pump(); });
  }

  private spawn(): void {
    const worker = new Worker(this.options.script ?? new URL("./native-decode-worker.ts", import.meta.url));
    this.started++;
    this.worker = worker;
    const init: WorkerInit = { type: "init", decompressor: this.options.decompressor, roots: [...this.options.roots], limits: this.options.limits ?? DEFAULT_LIMITS, identity: this.options.identity };
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (event: MessageEvent) => {
        const message = event.data as { type: string; message?: string };
        if (message.type === "ready") { worker.removeEventListener("message", onReady); resolve(); }
        else if (message.type === "init-failed") { worker.removeEventListener("message", onReady); reject(new Error(message.message)); }
      };
      worker.addEventListener("message", onReady);
    });
    worker.addEventListener("message", event => {
      const message = event.data as { type: string; outcome?: NativeDecodeOutcome };
      if (message.type === "outcome" && this.busy) this.finish(message.outcome!);
    });
    worker.addEventListener("error", event => { this.fail(`The native decoder worker failed: ${(event as ErrorEvent).message}`); });
    worker.addEventListener("close", () => { if (this.worker === worker) this.fail("The native decoder worker exited."); });
    worker.postMessage(init);
  }

  private pump(): void {
    if (this.busy || this.closed || !this.queue.length) return;
    if (!this.worker) this.spawn();
    const pending = this.queue.shift()!;
    const worker = this.worker!;
    // The budget starts once the worker is ready: a cold start (library load, JIT) is not charged to the resource.
    this.busy = { pending, timer: null };
    this.ready!.then(() => {
      if (this.busy?.pending !== pending || this.worker !== worker) return;
      this.busy.timer = setTimeout(() => this.timeout(worker), this.options.timeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS);
      worker.postMessage({ type: "decode", request: pending.request });
    }, error => { if (this.busy?.pending === pending) this.fail(`The native decoder could not start: ${(error as Error).message}`, "internal"); });
  }

  private finish(outcome: NativeDecodeOutcome): void {
    const busy = this.busy!;
    if (busy.timer) clearTimeout(busy.timer);
    this.busy = null;
    busy.pending.resolve(outcome);
    this.pump();
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null; this.ready = null;
    if (worker) void worker.terminate();
  }

  private timeout(worker: Worker): void {
    if (this.worker !== worker || !this.busy) return;
    this.stopWorker();
    this.finish({ ok: false, kind: "over-budget", message: `Decoding took longer than ${this.options.timeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS} ms and was abandoned.` });
  }

  private fail(message: string, kind: NativeFailureKind = "internal"): void {
    this.stopWorker();
    if (this.busy) this.finish({ ok: false, kind, message });
  }

  close(): void {
    this.closed = true;
    this.stopWorker();
    if (this.busy) { if (this.busy.timer) clearTimeout(this.busy.timer); this.busy.pending.resolve({ ok: false, kind: "internal", message: "The native decoder was closed." }); this.busy = null; }
    for (const pending of this.queue.splice(0)) pending.resolve({ ok: false, kind: "internal", message: "The native decoder was closed." });
  }
}
