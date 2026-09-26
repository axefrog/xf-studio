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
  /**
   * Root classes this request may decode besides the decoder's own (a host reading one resource of a kind the resolver doesn't, e.g.
   * the clothing host's `JsonResource` preset, through the route's decoder).
   */
  readonly roots?: readonly string[];
  /**
   * For a `JsonResource` root: the payload classes (the class its `root` handle holds) this request accepts. Any other payload is
   * `not-verified`, so a caller that asks for the creator's on-screen texts (`localizationPersistenceOnScreenEntries`) never takes a
   * document of a kind the reader was not checked on. Absent: any payload (the clothing preset, which only the native reader reads).
   */
  readonly payloads?: readonly string[];
  /** This request's time budget in a worker, when it is not the decoder's (a much larger resource than the resolver reads). */
  readonly timeoutMs?: number;
  /**
   * `background`: a worker decodes it only when no other request waits (the creator catalogue's hundreds of text reads never hold up
   * a V's resolution, whose reads come one chain level at a time).
   */
  readonly priority?: "background";
}

export type NativeDecodeOutcome =
  | { readonly ok: true; readonly document: unknown; readonly extractedSha256: string; readonly root: string; readonly name: string | null;
    readonly notes: readonly NativeNote[]; readonly defaulted: readonly DefaultedProperty[] }
  | { readonly ok: false; readonly kind: NativeFailureKind; readonly message: string; readonly errorName?: string; readonly stack?: string;
    /** An `unavailable` answer that will not change this session (the worker failed to start too often; NATIVE-29). */
    readonly lasting?: boolean };

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

/** The class a `JsonResource` document's `root` handle holds (`Data.RootChunk.root.Data.$type`), or null. */
export function jsonPayloadClass(document: unknown): string | null {
  const type = (document as { Data?: { RootChunk?: { root?: { Data?: { $type?: unknown } } } } } | null)?.Data?.RootChunk?.root?.Data?.$type;
  return typeof type === "string" ? type : null;
}

/** Read, check and decode one resource; every failure is returned with its kind. */
export function decodeFromPool(pool: NativeArchivePool, decompress: Decompress, request: NativeDecodeRequest, options: NativeDecodeOptions,
  depotHash: (path: string) => string): NativeDecodeOutcome {
  try {
    const bytes = pool.read(request.archivePath, request.hash);
    if (!bytes) return { ok: false, kind: "not-indexed", message: "The archive does not list the resource." };
    const session = new DecodeSession(options.limits ?? DEFAULT_LIMITS);
    const root = new Cr2wFile(bytes, session).exports[0]?.className;
    if (!root || !(options.roots.has(root) || request.roots?.includes(root))) return { ok: false, kind: "not-verified", message: `Root class ${root ?? "(none)"} is not verified.` };
    const document = readResourceJson(bytes, decompress, { buffers: "trim", header: { XfsNativeReader: options.identity } }, session);
    if (root === "JsonResource" && request.payloads) {
      const payload = jsonPayloadClass(document);
      if (!payload || !request.payloads.includes(payload)) return { ok: false, kind: "not-verified", message: `JsonResource payload ${payload ?? "(none)"} is not verified.` };
    }
    return { ok: true, document, extractedSha256: createHash("sha256").update(bytes).digest("hex"), root,
      name: request.needName ? nameOf(pool.get(request.archivePath), request.hash, depotHash) : null, notes: session.notes, defaulted: session.defaultedProperties };
  } catch (error) {
    const kind = classifyNativeFailure(error);
    const failure = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return { ok: false, kind, message: String(failure?.message ?? error), errorName: typeof failure?.name === "string" ? failure.name : undefined,
      stack: kind === "internal" && typeof failure?.stack === "string" ? failure.stack : undefined };
  }
}

/** What a closed decoder answers: `unavailable`, so the resource falls back and is read again later (NATIVE-28). */
const CLOSED = "The native decoder was closed.";

/** Decodes on the calling thread (tests, the differential tools, and hosts without workers). */
export class InProcessDecoder implements NativeDecoder {
  private closed = false;
  constructor(private readonly pool: NativeArchivePool, private readonly decompress: Decompress, private readonly options: NativeDecodeOptions,
    private readonly depotHash: (path: string) => string, private readonly onClose: () => void = () => {}) {}
  get identity() { return this.options.identity; }
  async decode(request: NativeDecodeRequest): Promise<NativeDecodeOutcome> {
    if (this.closed) return { ok: false, kind: "unavailable", message: CLOSED };
    return decodeFromPool(this.pool, this.decompress, request, this.options, this.depotHash);
  }
  close(): void { if (!this.closed) { this.closed = true; this.onClose(); } }
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

/** One resource to decode; the worker echoes `id` with its outcome. */
export interface WorkerDecodeMessage { readonly type: "decode"; readonly id: number; readonly request: NativeDecodeRequest }

/** What a worker sends: whether it started, and one outcome per decode message, carrying that message's id. */
export type WorkerReply =
  | { readonly type: "ready" }
  | { readonly type: "init-failed"; readonly message: string }
  | { readonly type: "outcome"; readonly id: number; readonly outcome: NativeDecodeOutcome };

/** The part of a `Worker` the decoder uses, so a test can drive one by hand. */
export interface DecodeWorker {
  postMessage(message: WorkerInit | WorkerDecodeMessage): void;
  addEventListener(type: "message" | "error" | "close", listener: (event: any) => void): void;
  terminate(): unknown;
}

export interface WorkerDecoderOptions {
  readonly decompressor: WorkerDecompressor;
  readonly roots: ReadonlySet<string>;
  readonly limits?: NativeLimits;
  readonly identity: string;
  /** Wall-clock budget per resource, from the moment the worker receives it. */
  readonly timeoutMs?: number;
  /** How long a worker may take to report ready (starting Bun, loading and hashing the library). */
  readonly startTimeoutMs?: number;
  /** After a worker fails to start, how long every resource is answered `unavailable` before one new start is tried. */
  readonly restartDelayMs?: number;
  /** Consecutive start failures after which the decoder stays `unavailable` for the rest of the session. */
  readonly maxStartFailures?: number;
  /** The worker script (defaults to native-decode-worker.ts next to this module). */
  readonly script?: URL | string;
  /** Starts a worker (tests inject one; the default is `new Worker(script)`). */
  readonly createWorker?: () => DecodeWorker;
}

/** Default time budget per resource: far above the slowest real decode (see the backlog page's budget table). */
export const DEFAULT_DECODE_TIMEOUT_MS = 10_000;
/** Default start budget: a cold worker is ready in well under a second. */
export const DEFAULT_WORKER_START_TIMEOUT_MS = 15_000;
export const DEFAULT_WORKER_RESTART_DELAY_MS = 60_000;
export const DEFAULT_WORKER_MAX_START_FAILURES = 3;

type Pending = { request: NativeDecodeRequest; resolve: (outcome: NativeDecodeOutcome) => void };

/**
 * Decodes in a worker, one resource at a time, each within `timeoutMs`; a `background` request waits until no other does. A resource over its time budget, or a worker that dies,
 * answers `over-budget` or `internal` and the worker is replaced before the next resource.
 *
 * Only the current worker is heard: every message, error and exit is checked against it, and an outcome must carry the id of the
 * resource in progress, so a late answer from a replaced worker, or a stale one, is dropped and never given to the next resource.
 *
 * A worker that fails to start (reports `init-failed`, exits or errors before it is ready, or is not ready within `startTimeoutMs`)
 * is not restarted for every request: resources are answered `unavailable`, so they fall back to WolvenKit, for `restartDelayMs`,
 * then one new start is tried. After `maxStartFailures` consecutive failures the decoder stays unavailable for the session.
 */
export class WorkerDecoder implements NativeDecoder {
  private current: { worker: DecodeWorker; ready: boolean; startTimer: ReturnType<typeof setTimeout> | null } | null = null;
  private readonly queue: Pending[] = [];
  /** Requests marked `background`, decoded only while `queue` is empty. */
  private readonly backgroundQueue: Pending[] = [];
  private busy: { pending: Pending; id: number; sent: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private nextId = 1;
  private closed = false;
  private startFailures = 0;
  private unavailableUntil = 0;
  private unavailableReason = "";
  /** Workers started (1 + replacements after timeouts, crashes or start retries). */
  started = 0;

  constructor(private readonly options: WorkerDecoderOptions) {}
  get identity() { return this.options.identity; }

  decode(request: NativeDecodeRequest): Promise<NativeDecodeOutcome> {
    // A decoder closed while a route still holds it (the game's library changed, or the host let the game folder go) answers like one
    // that is down: the resource falls back and is read again later, never counted as a reader bug (NATIVE-28).
    if (this.closed) return Promise.resolve({ ok: false, kind: "unavailable", message: CLOSED });
    return new Promise(resolve => { (request.priority === "background" ? this.backgroundQueue : this.queue).push({ request, resolve }); this.pump(); });
  }

  private spawn(): void {
    const worker = this.options.createWorker?.()
      ?? new Worker(this.options.script ?? new URL("./native-decode-worker.ts", import.meta.url)) as unknown as DecodeWorker;
    this.started++;
    const startMs = this.options.startTimeoutMs ?? DEFAULT_WORKER_START_TIMEOUT_MS;
    const current: NonNullable<WorkerDecoder["current"]> = { worker, ready: false, startTimer: null };
    this.current = current;
    current.startTimer = setTimeout(() => this.startFailed(worker, `The native decoder worker did not start within ${startMs} ms.`), startMs);
    worker.addEventListener("message", event => this.onMessage(worker, (event as MessageEvent).data as WorkerReply));
    worker.addEventListener("error", event => this.onExit(worker, `The native decoder worker failed: ${(event as ErrorEvent).message}`));
    worker.addEventListener("close", () => this.onExit(worker, "The native decoder worker exited."));
    const init: WorkerInit = { type: "init", decompressor: this.options.decompressor, roots: [...this.options.roots], limits: this.options.limits ?? DEFAULT_LIMITS, identity: this.options.identity };
    worker.postMessage(init);
  }

  private onMessage(worker: DecodeWorker, message: WorkerReply): void {
    const current = this.current;
    if (current?.worker !== worker || !message || typeof message !== "object") return;
    if (message.type === "ready") {
      if (current.ready) return;
      if (current.startTimer) clearTimeout(current.startTimer);
      current.ready = true; current.startTimer = null;
      this.startFailures = 0;
      this.send();
    } else if (message.type === "init-failed") {
      this.startFailed(worker, `The native decoder could not start: ${message.message}`);
    } else if (message.type === "outcome") {
      if (this.busy?.sent && message.id === this.busy.id) this.finish(message.outcome);
    }
  }

  /** An error or exit: before ready it is a start failure; after, the resource in progress (if any) fails and the worker is replaced. */
  private onExit(worker: DecodeWorker, message: string): void {
    const current = this.current;
    if (current?.worker !== worker) return;
    if (!current.ready) { this.startFailed(worker, message); return; }
    this.stopWorker();
    if (this.busy) this.finish({ ok: false, kind: "internal", message });
  }

  private startFailed(worker: DecodeWorker, message: string): void {
    if (this.current?.worker !== worker || this.current.ready) return;
    this.stopWorker();
    this.startFailures++;
    const permanent = this.startFailures >= (this.options.maxStartFailures ?? DEFAULT_WORKER_MAX_START_FAILURES);
    this.unavailableUntil = permanent ? Infinity : Date.now() + (this.options.restartDelayMs ?? DEFAULT_WORKER_RESTART_DELAY_MS);
    this.unavailableReason = permanent ? `${message} It failed to start ${this.startFailures} times in a row, so it is off for this session.` : message;
    if (this.busy) this.finish({ ok: false, kind: "unavailable", message: this.unavailableReason, ...(permanent ? { lasting: true } : {}) });
  }

  private pump(): void {
    if (this.busy || this.closed || !(this.queue.length || this.backgroundQueue.length)) return;
    if (!this.current) {
      if (Date.now() < this.unavailableUntil) {
        const lasting = this.unavailableUntil === Infinity;
        for (const pending of [...this.queue.splice(0), ...this.backgroundQueue.splice(0)]) pending.resolve({ ok: false, kind: "unavailable", message: this.unavailableReason, ...(lasting ? { lasting } : {}) });
        return;
      }
      this.spawn();
    }
    this.busy = { pending: (this.queue.shift() ?? this.backgroundQueue.shift())!, id: this.nextId++, sent: false, timer: null };
    this.send();
  }

  /**
   * Send the resource in progress to the current worker once it is ready. The budget starts then: a cold start (library load,
   * JIT) is not charged to the resource.
   */
  private send(): void {
    const busy = this.busy, current = this.current;
    if (!busy || busy.sent || !current?.ready) return;
    const { worker } = current, id = busy.id;
    busy.sent = true;
    busy.timer = setTimeout(() => this.timeout(worker, id), this.budget(busy.pending.request));
    worker.postMessage({ type: "decode", id, request: busy.pending.request });
  }

  private finish(outcome: NativeDecodeOutcome): void {
    const busy = this.busy!;
    if (busy.timer) clearTimeout(busy.timer);
    this.busy = null;
    busy.pending.resolve(outcome);
    this.pump();
  }

  private stopWorker(): void {
    const current = this.current;
    this.current = null;
    if (!current) return;
    if (current.startTimer) clearTimeout(current.startTimer);
    void current.worker.terminate();
  }

  /** A request's time budget: its own, else the decoder's. */
  private budget(request: NativeDecodeRequest): number { return request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS; }

  private timeout(worker: DecodeWorker, id: number): void {
    if (this.current?.worker !== worker || this.busy?.id !== id) return;
    this.stopWorker();
    this.finish({ ok: false, kind: "over-budget", message: `Decoding took longer than ${this.budget(this.busy!.pending.request)} ms and was abandoned.` });
  }

  close(): void {
    this.closed = true;
    this.stopWorker();
    if (this.busy) { if (this.busy.timer) clearTimeout(this.busy.timer); this.busy.pending.resolve({ ok: false, kind: "unavailable", message: CLOSED }); this.busy = null; }
    for (const pending of [...this.queue.splice(0), ...this.backgroundQueue.splice(0)]) pending.resolve({ ok: false, kind: "unavailable", message: CLOSED });
  }
}
