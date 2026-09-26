/**
 * Per-resource budgets of the native reader and the session that enforces them while one resource is decoded. Pure.
 *
 * Every size the reader allocates comes from the file, so each is checked against a cap before anything is allocated, and the work
 * a small file can cause (decoded values, JSON values written, nesting) is counted. The defaults are the largest values measured on
 * real resources times a margin (tools/native-limits.ts prints the measurements). A resource over a cap is refused with
 * `NativeBudgetError`, and the caller falls back to another reader, so a cap that is too tight costs speed, never correctness.
 */
import { NativeBudgetError } from "./native-errors";

export interface NativeLimits {
  /** The extracted file read from the archive: the decompressed body plus its buffers as stored. */
  readonly maxResourceBytes: number;
  /** The decompressed CR2W body. */
  readonly maxBodyBytes: number;
  /** One buffer, stored or decompressed. */
  readonly maxBufferBytes: number;
  /**
   * Everything one resource decompresses or decodes to text (body, parsed buffers, names and strings), plus 4 bytes per string-pool
   * entry for the pool's terminator index.
   */
  readonly maxDecodedBytes: number;
  /** Values decoded (properties, array elements, objects). */
  readonly maxNodes: number;
  /** Values written to the JSON document (object keys and array elements, defaults included). */
  readonly maxJsonNodes: number;
  /**
   * JSON values per decoded value beyond `jsonNodesAllowance`: defaults let a few bytes ask for a large object, so the document may
   * outgrow the decoded data only by this factor.
   */
  readonly maxJsonNodesPerValue: number;
  readonly jsonNodesAllowance: number;
  /** Object nesting while decoding, deriving and writing. */
  readonly maxDepth: number;
  /** One entry of a CR2W string pool (a name or an import path). */
  readonly maxNameBytes: number;
  /**
   * Names decoded (distinct string-pool entries and package names). Each is a string and a slot (~150 bytes measured per distinct
   * pool entry), so a pool of many empty or one-byte entries is budgeted by count, not only by its bytes.
   */
  readonly maxNames: number;
  /** A CR2W string pool (table 0) as a whole; its terminator index also counts against `maxDecodedBytes`, 4 bytes per entry. */
  readonly maxStringPoolBytes: number;
  /** One archive's index block (entries, segments and dependencies), read whole and kept while the archive is pooled. */
  readonly maxIndexBytes: number;
  /** The index blocks an archive pool keeps at once; the least recently used are dropped (and re-read when needed) past it. */
  readonly maxPooledIndexBytes: number;
  /** An archive's custom-data block (the `LXRS` file-name list), stored or decompressed. */
  readonly maxNameListBytes: number;
}

/**
 * Defaults, from tools/native-limits.ts on game 2.31 and the reference mod list (1,157 archives, 647,849 entries; the resolver's
 * 1,722 distinct cached resources and the 406 verified-class resources whose body is 1 MiB or more). Measured maximum → cap:
 * verified resource 32.8 MiB → 128 MiB; verified body 31.8 MiB → 128 MiB; any buffer in any archive 85.3 MiB (largest parsed
 * buffer 11.1 MiB) → 128 MiB; decoded names and parsed buffers 15.6 MiB → 64 MiB; values 0.6 M in the resources the resolver
 * reads → 8 M (a few large world meshes of 33 M fall back to WolvenKit, which keeps one decode's memory near 1 GB at worst);
 * JSON values 1.3 M → 16 M, and at most 8 per decoded value past 2^20 (measured 0.97); nesting 11 → 128; name 159 bytes → 1 KiB;
 * names 314 K (one mesh) → 2 M; string pool 2.7 MiB (any class; bodies under 1 MiB hold smaller ones) → 16 MiB; name list 0.37 MiB → 16 MiB; one archive index
 * 28.6 MiB → 128 MiB; all 1,157 archive indexes together 96.2 MiB → 512 MiB pooled. Details:
 * research/backlog/native-archive-reader.md#budgets.
 */
export const DEFAULT_LIMITS: NativeLimits = Object.freeze({
  maxResourceBytes: 128 * 2 ** 20,
  maxBodyBytes: 128 * 2 ** 20,
  maxBufferBytes: 128 * 2 ** 20,
  maxDecodedBytes: 64 * 2 ** 20,
  maxNodes: 8_000_000,
  maxJsonNodes: 16_000_000,
  maxJsonNodesPerValue: 8,
  jsonNodesAllowance: 2 ** 20,
  maxDepth: 128,
  maxNameBytes: 1024,
  maxNames: 2_000_000,
  maxStringPoolBytes: 16 * 2 ** 20,
  maxNameListBytes: 16 * 2 ** 20,
  maxIndexBytes: 128 * 2 ** 20,
  maxPooledIndexBytes: 512 * 2 ** 20,
});

/** Something the reader noticed about a resource that the JSON document cannot say (its value is still readable). */
export type NativeNote =
  /** A property stored with a type other than the one the RTTI slice gives it; the value was decoded by the stored type. */
  | { readonly kind: "type-mismatch"; readonly property: string; readonly stored: string; readonly rtti: string; readonly count: number }
  /** An array record holding more elements than its count says; every element in the record was read (`declared` is the count). */
  | { readonly kind: "array-past-count"; readonly property: string; readonly declared: number; readonly stored: number; readonly count: number };

/** A watched property the file left out, so the document shows its default: where it was written. */
export interface DefaultedProperty { readonly property: string; readonly paths: readonly string[]; readonly count: number }

/** Properties whose omission the resolver needs to tell from a stored zero (knowledge/archive-format.md open question 3). */
export const DEFAULT_WATCHED_PROPERTIES: readonly string[] = ["rendChunk.renderMask"];

const MAX_NOTES = 64, MAX_PATHS = 256;

/** High-water marks of one decode, for measuring real resources against the caps. */
export interface NativeUsage { readonly decodedBytes: number; readonly nodes: number; readonly jsonNodes: number; readonly depth: number; readonly longestName: number; readonly names: number; readonly largestBuffer: number }

/** The budgets and findings of decoding one resource (a nested buffer shares its parent's session). */
export class DecodeSession {
  private decodedBytes = 0;
  private nodeCount = 0;
  private jsonNodeCount = 0;
  private depthNow = 0;
  private depthMax = 0;
  private longestName = 0;
  private nameCount = 0;
  private largestBuffer = 0;
  private readonly notesByKey = new Map<string, NativeNote & { count: number }>();
  private readonly defaultedByProperty = new Map<string, { property: string; paths: string[]; count: number }>();
  readonly watched: ReadonlySet<string>;

  constructor(readonly limits: NativeLimits = DEFAULT_LIMITS, watched: readonly string[] = DEFAULT_WATCHED_PROPERTIES) {
    this.watched = new Set(watched);
  }

  /** Count bytes decompressed or decoded; refuse past the cap. */
  bytes(count: number, what: string): void {
    this.decodedBytes += count;
    if (this.decodedBytes > this.limits.maxDecodedBytes) throw new NativeBudgetError(`Decoding ${what} passes the ${this.limits.maxDecodedBytes}-byte budget.`);
  }

  /** A string-pool entry or package name of `length` bytes, counted against the name budget as well as the decoded bytes. */
  name(length: number): void {
    if (length > this.limits.maxNameBytes) throw new NativeBudgetError(`A ${length}-byte name passes the ${this.limits.maxNameBytes}-byte cap.`);
    if (++this.nameCount > this.limits.maxNames) throw new NativeBudgetError(`The resource passes the ${this.limits.maxNames}-name budget.`);
    if (length > this.longestName) this.longestName = length;
    this.bytes(length, "names");
  }

  /** A buffer about to be decompressed. */
  buffer(size: number, what: string): void {
    if (size > this.limits.maxBufferBytes) throw new NativeBudgetError(`${what}: a ${size}-byte buffer passes the ${this.limits.maxBufferBytes}-byte cap.`);
    if (size > this.largestBuffer) this.largestBuffer = size;
    this.bytes(size, what);
  }

  /** Count decoded values. */
  nodes(count: number): void {
    this.nodeCount += count;
    if (this.nodeCount > this.limits.maxNodes) throw new NativeBudgetError(`The resource passes the ${this.limits.maxNodes}-value budget.`);
  }

  /** Count values written to JSON. */
  jsonNodes(count: number): void {
    this.jsonNodeCount += count;
    if (this.jsonNodeCount > this.limits.maxJsonNodes) throw new NativeBudgetError(`The document passes the ${this.limits.maxJsonNodes}-value budget.`);
    // The ratio needs the decoded count: it applies when this session also decoded the document (the normal path).
    if (this.nodeCount > 0 && this.jsonNodeCount > this.nodeCount * this.limits.maxJsonNodesPerValue + this.limits.jsonNodesAllowance)
      throw new NativeBudgetError(`The document outgrows its ${this.nodeCount} decoded values more than ${this.limits.maxJsonNodesPerValue}-fold.`);
  }

  /** Enter one level of object nesting (decode, derive or write); pair with `leave`. */
  enter(): void {
    if (++this.depthNow > this.limits.maxDepth) { this.depthNow--; throw new NativeBudgetError(`Objects nest deeper than ${this.limits.maxDepth} levels.`); }
    if (this.depthNow > this.depthMax) this.depthMax = this.depthNow;
  }

  leave(): void { this.depthNow--; }

  /** Record a property whose stored type disagrees with the RTTI slice. */
  typeMismatch(property: string, stored: string, rtti: string): void {
    const key = `${property}\u0000${stored}`;
    const known = this.notesByKey.get(key);
    if (known) { known.count++; return; }
    if (this.notesByKey.size < MAX_NOTES) this.notesByKey.set(key, { kind: "type-mismatch", property, stored, rtti, count: 1 });
  }

  /** Record an array record that held more elements than its count said (`declared`), all `stored` of which were read. */
  arrayPastCount(property: string, declared: number, stored: number): void {
    const key = `${property}\u0001past-count`;
    const known = this.notesByKey.get(key) as { count: number } | undefined;
    if (known) { known.count++; return; }
    if (this.notesByKey.size < MAX_NOTES) this.notesByKey.set(key, { kind: "array-past-count", property, declared, stored, count: 1 });
  }

  /** Record that a watched property was written as its default at `path` (built only when needed). */
  defaulted(property: string, path: () => string): void {
    let row = this.defaultedByProperty.get(property);
    if (!row) { row = { property, paths: [], count: 0 }; this.defaultedByProperty.set(property, row); }
    row.count++;
    if (row.paths.length < MAX_PATHS) row.paths.push(path());
  }

  get notes(): readonly NativeNote[] { return [...this.notesByKey.values()].map(note => ({ ...note })); }
  get defaultedProperties(): readonly DefaultedProperty[] { return [...this.defaultedByProperty.values()].map(row => ({ ...row, paths: [...row.paths] })); }
  get usage(): NativeUsage {
    return { decodedBytes: this.decodedBytes, nodes: this.nodeCount, jsonNodes: this.jsonNodeCount, depth: this.depthMax, longestName: this.longestName, names: this.nameCount, largestBuffer: this.largestBuffer };
  }
}

/** Limits with no effective cap, for measuring real resources (tools/native-limits.ts). */
export const UNLIMITED: NativeLimits = Object.freeze({
  maxResourceBytes: Number.MAX_SAFE_INTEGER, maxBodyBytes: Number.MAX_SAFE_INTEGER, maxBufferBytes: Number.MAX_SAFE_INTEGER,
  maxDecodedBytes: Number.MAX_SAFE_INTEGER, maxNodes: Number.MAX_SAFE_INTEGER, maxJsonNodes: Number.MAX_SAFE_INTEGER, maxJsonNodesPerValue: Number.MAX_SAFE_INTEGER,
  jsonNodesAllowance: Number.MAX_SAFE_INTEGER, maxDepth: 100_000,
  maxNameBytes: Number.MAX_SAFE_INTEGER, maxNames: Number.MAX_SAFE_INTEGER, maxStringPoolBytes: Number.MAX_SAFE_INTEGER, maxNameListBytes: Number.MAX_SAFE_INTEGER,
  maxIndexBytes: Number.MAX_SAFE_INTEGER, maxPooledIndexBytes: Number.MAX_SAFE_INTEGER,
});
