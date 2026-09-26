/**
 * The resolver's native-first fetch port: reads a resource natively and falls back to another port (WolvenKit, resolver-host.ts
 * `WolvenKitFetcher`) per resource. The resolver host opens one decoder per installation route and wraps each cache folder's WolvenKit
 * fetcher in this port (resolver-host.ts `ResolverFetcher`); research/backlog/native-archive-reader.md has the plan and measurements.
 *
 * - A resource is served natively when its archive indexes it, its root class is one the native reader has been verified on
 *   (`NATIVE_ROOTS`, from the differential harness tools/native-cr2w-diff.ts) and decoding succeeds within its budgets. Anything
 *   else goes to the fallback port, which keeps its own cache and rules, and is counted by kind (native-errors.ts): not-indexed,
 *   not-verified, unsupported, malformed, decompress, over-budget, io, unavailable (the worker could not start), and internal (a
 *   reader bug, kept with its stack and optionally rethrown so it is never mistaken for an ordinary fallback).
 * - Decoding runs through a `NativeDecoder` (native-decode.ts): in-process, or in a worker whose time budget abandons a resource
 *   that runs too long (then WolvenKit answers it). Hosts open it with `openNativeDecoderAsync`, which never blocks the event loop;
 *   the synchronous `openNativeReader`/`openNativeDecoder` are for command-line tools.
 * - The answer carries the same `extractedSha256` the fallback would (the native bytes are identical to WolvenKit's extraction),
 *   so provenance and render records do not depend on which reader answered. It also carries `notes` (a property stored with a
 *   type the RTTI disagrees with, e.g. a mod's `castShadows` stored as `Bool`) and `defaulted` (watched properties the file left
 *   out, e.g. `rendChunk.renderMask`, which the document can only show as 0), which the resource graph reads.
 * - Native answers are not cached: a read and decode takes well under 10 ms for all but the largest morph targets. What is kept is
 *   only *that* a resource was answered natively (`NativeAnswerLedger`, so a later session knows a prepared choice needs no
 *   WolvenKit), keyed by (depot hash, archive fingerprint, `NativeReader.identity`), never by the WolvenKit identity, so a WolvenKit
 *   update does not invalidate native answers and a reader change does not reuse old ones.
 * - Native answers are not `fresh`: the resource graph's prefetch exists to batch WolvenKit launches, which native reads don't need.
 * - A fallback whose native failure may not repeat (`unavailable`, `io`) counts as transient when the fallback also
 *   fails, so the resource graph reads it again later instead of settling on the fallback's lasting failure.
 */
import { createHash } from "node:crypto";
import type { MountedArchive } from "../archive-precedence";
import { depotHash, type DepotRef } from "../depot-path";
import type { FetchedResource, ResourceFetchPort } from "../resource-graph";
import { NativeArchivePool } from "./archive-reader";
import type { Decompress } from "./kark";
import { DEFAULT_LIMITS, type DefaultedProperty, type NativeLimits, type NativeNote } from "./limits";
import { InProcessDecoder, type NativeDecodeOutcome, type NativeDecoder, WorkerDecoder } from "./native-decode";
import { NATIVE_FAILURE_KINDS, type NativeFailureKind } from "./native-errors";
import { loadGameOodle, type OodleLibrary, openGameOodle, type OodleVerifier, type OodleVerifierSync } from "./oodle";
import { NATIVE_READER_VERSION } from "./resource-document";
import rttiClassHashes from "./rtti-class-hashes.json";
import rttiSubset from "./rtti-subset.json";
import rttiDefaults from "./rtti-defaults.json";

/** Root classes whose documents matched the reference JSON on every resolver field in the differential harness. */
export const NATIVE_ROOTS: ReadonlySet<string> = new Set(["gameuiCharacterCustomizationInfoResource", "CMaterialInstance", "appearanceAppearanceResource",
  "CMesh", "MorphTargetMesh", "CBitmapTexture", "entEntityTemplate", "CMaterialTemplate", "CHairProfile", "CSkinProfile", "CGradient",
  "Multilayer_Setup", "Multilayer_LayerTemplate"]);

/** A native answer: a `FetchedResource` plus what the JSON document cannot say. */
export interface NativeFetchedResource extends FetchedResource {
  readonly notes: readonly NativeNote[];
  readonly defaulted: readonly DefaultedProperty[];
}

export interface NativeReader {
  readonly pool: NativeArchivePool;
  readonly decompress: Decompress;
  /** Reader identity for cache keys: output rules version, RTTI slice and learned defaults, and the Oodle library. */
  readonly identity: string;
  /** SHA-256 of the Oodle library that was checked and loaded. */
  readonly oodleSha256: string;
  close(): void;
}

const dataHash = createHash("sha256").update(JSON.stringify(rttiSubset)).update(JSON.stringify(rttiDefaults)).update(JSON.stringify(rttiClassHashes)).digest("hex").slice(0, 12);
export const nativeReaderIdentity = (decompressor: string) => `xfs-native:${NATIVE_READER_VERSION}:${dataHash}:${decompressor}`;

type Opened<T> = { reader: T } | { reader: null; reason: string };
type ReaderOptions = { limits?: NativeLimits };
type DecoderOptions = { timeoutMs?: number; limits?: NativeLimits; roots?: ReadonlySet<string>; script?: URL | string };

function readerOver(oodle: OodleLibrary, limits: NativeLimits = DEFAULT_LIMITS): NativeReader {
  const pool = new NativeArchivePool(oodle.decompress, 64, limits);
  return { pool, decompress: oodle.decompress, identity: nativeReaderIdentity(oodle.identity), oodleSha256: oodle.sha256, close: () => { pool.close(); oodle.close(); } };
}

/**
 * The native reader over a game installation, or the reason it can't be used (then every read goes to the fallback). Checking an
 * Oodle library whose hash is not on the known list runs PowerShell asynchronously, so a host's event loop never waits on it.
 */
export async function openNativeReaderAsync(gameRoot: string, options: ReaderOptions & { verify?: OodleVerifier } = {}): Promise<Opened<NativeReader>> {
  try { return { reader: readerOver(await openGameOodle(gameRoot, { verify: options.verify }), options.limits) }; }
  catch (error) { return { reader: null, reason: (error as Error).message }; }
}

/** `openNativeReaderAsync`, blocking while an unknown library's signature is checked: for command-line tools only. */
export function openNativeReader(gameRoot: string, options: ReaderOptions & { verify?: OodleVerifierSync } = {}): Opened<NativeReader> {
  try { return { reader: readerOver(loadGameOodle(gameRoot, { verify: options.verify }), options.limits) }; }
  catch (error) { return { reader: null, reason: (error as Error).message }; }
}

/** Decode on the calling thread with a reader's pool and decompressor. */
export function inProcessDecoder(reader: NativeReader, roots: ReadonlySet<string> = NATIVE_ROOTS, limits: NativeLimits = DEFAULT_LIMITS): NativeDecoder {
  return new InProcessDecoder(reader.pool, reader.decompress, { roots, limits, identity: reader.identity }, depotHash, () => reader.close());
}

function workerDecoderFor(gameRoot: string, opened: Opened<NativeReader>, options: DecoderOptions): { decoder: NativeDecoder } | { decoder: null; reason: string } {
  if (!opened.reader) return { decoder: null, reason: opened.reason };
  const { identity, oodleSha256 } = opened.reader;
  opened.reader.close();
  return { decoder: new WorkerDecoder({ decompressor: { gameRoot, trustedSha256: oodleSha256 }, roots: options.roots ?? NATIVE_ROOTS, limits: options.limits, identity, timeoutMs: options.timeoutMs, script: options.script }) };
}

/**
 * Decode in a worker with a time budget per resource. The library is checked here first (asynchronously), so a worker loads only
 * a library whose bytes match the checked hash.
 */
export async function openNativeDecoderAsync(gameRoot: string, options: DecoderOptions & { verify?: OodleVerifier } = {}):
  Promise<{ decoder: NativeDecoder } | { decoder: null; reason: string }> {
  return workerDecoderFor(gameRoot, await openNativeReaderAsync(gameRoot, { limits: options.limits, verify: options.verify }), options);
}

/** `openNativeDecoderAsync`, blocking while an unknown library's signature is checked: for command-line tools only. */
export function openNativeDecoder(gameRoot: string, options: DecoderOptions & { verify?: OodleVerifierSync } = {}):
  { decoder: NativeDecoder } | { decoder: null; reason: string } {
  return workerDecoderFor(gameRoot, openNativeReader(gameRoot, { limits: options.limits, verify: options.verify }), options);
}

/** Fallback counts by kind, plus a bounded sample of messages and the internal failures' stacks. */
export interface NativeFetchStats {
  native: number;
  fallback: number;
  readonly byKind: Record<NativeFailureKind, number>;
  /** Up to `SAMPLE_LIMIT` fallbacks with their resource and message (not-indexed and not-verified are counted only). */
  readonly samples: { kind: NativeFailureKind; resource: string; message: string }[];
  /** Up to `INTERNAL_LIMIT` reader bugs with their stacks. */
  readonly internal: { resource: string; message: string; stack?: string }[];
}

const SAMPLE_LIMIT = 32, INTERNAL_LIMIT = 8;
const QUIET: ReadonlySet<NativeFailureKind> = new Set(["not-indexed", "not-verified"]);

/**
 * What remembers which resources were answered natively (resolver-host.ts keeps it on disk per cache folder). Its keys must include
 * the archive's identity and the reader's, never WolvenKit's.
 */
export interface NativeAnswerLedger {
  has(archive: MountedArchive, hash: string): boolean;
  add(archive: MountedArchive, hash: string): void;
}

/**
 * Native failure kinds that may not repeat on a later read: the decoder was down or the file system failed. A reader bug (`internal`)
 * is not one: it would repeat, and a graph dropped for it would be read again on every preparation.
 */
export const TRANSIENT_NATIVE_FAILURES: ReadonlySet<NativeFailureKind> = new Set(["unavailable", "io"]);

export interface NativeFirstOptions {
  /** Rethrow reader bugs (`internal` failures) instead of falling back, for tests and benches. */
  readonly strict?: boolean;
  /** Sees every fallback as it happens (diagnostics). */
  readonly onFallback?: (kind: NativeFailureKind, resource: string, message: string) => void;
  /** Records native answers, so `answeredNatively` holds across sessions. */
  readonly ledger?: NativeAnswerLedger;
}

/** A reader bug surfaced by a strict port (`strict: true`). */
export class NativeInternalError extends Error { override name = "NativeInternalError"; }

export class NativeFirstFetcher implements ResourceFetchPort {
  readonly stats: NativeFetchStats = { native: 0, fallback: 0, byKind: Object.fromEntries(NATIVE_FAILURE_KINDS.map(kind => [kind, 0])) as Record<NativeFailureKind, number>, samples: [], internal: [] };
  /** Resources the last answer for came from the fallback, with the native failure's kind (so the `transient` rule applies). */
  private readonly fellBack = new Map<string, NativeFailureKind>();

  constructor(private readonly decoder: NativeDecoder, private readonly fallback: ResourceFetchPort, private readonly options: NativeFirstOptions = {}) {}

  /** The native reader's identity (cache keys of anything derived from native answers). */
  get identity(): string { return this.decoder.identity; }

  private key(archive: MountedArchive, ref: DepotRef) { return `${archive.id}|${ref.hash}`; }

  private record(outcome: Extract<NativeDecodeOutcome, { ok: false }>, archive: MountedArchive, ref: DepotRef): void {
    const resource = `${archive.name}: ${ref.path ?? ref.hash}`;
    this.stats.byKind[outcome.kind]++;
    if (!QUIET.has(outcome.kind) && this.stats.samples.length < SAMPLE_LIMIT) this.stats.samples.push({ kind: outcome.kind, resource, message: outcome.message.slice(0, 300) });
    if (outcome.kind === "internal" && this.stats.internal.length < INTERNAL_LIMIT) this.stats.internal.push({ resource, message: outcome.message, stack: outcome.stack });
    this.options.onFallback?.(outcome.kind, resource, outcome.message);
    if (outcome.kind === "internal" && this.options.strict) throw new NativeInternalError(`${resource}: ${outcome.errorName ?? "Error"}: ${outcome.message}\n${outcome.stack ?? ""}`);
  }

  async fetch(archive: MountedArchive, ref: DepotRef, extension: string | null): Promise<NativeFetchedResource | FetchedResource | null> {
    const key = this.key(archive, ref);
    const outcome = await this.decoder.decode({ archivePath: archive.id, hash: ref.hash, needName: !ref.path });
    if (outcome.ok) {
      this.stats.native++;
      this.fellBack.delete(key);
      this.options.ledger?.add(archive, ref.hash);
      return { document: outcome.document, extractedSha256: outcome.extractedSha256, path: ref.path ?? outcome.name, fresh: false, notes: outcome.notes, defaulted: outcome.defaulted };
    }
    this.record(outcome, archive, ref);
    this.stats.fallback++;
    this.fellBack.set(key, outcome.kind);
    return this.fallback.fetch(archive, ref, extension);
  }

  /**
   * Whether the last null answer may not repeat: the fallback's own rule, or a native failure that may not repeat (the resource may
   * read natively next time). A native answer is never null.
   */
  transient(archive: MountedArchive, ref: DepotRef): boolean {
    const kind = this.fellBack.get(this.key(archive, ref));
    if (kind === undefined) return false;
    return TRANSIENT_NATIVE_FAILURES.has(kind) || (this.fallback.transient?.(archive, ref) ?? true);
  }

  /** Whether this resource was answered natively from this archive's current bytes by this reader (this session or, with a ledger, before). */
  answeredNatively(archive: MountedArchive, hash: string): boolean { return this.options.ledger?.has(archive, hash) ?? false; }

  close(): void { this.decoder.close(); }
}
