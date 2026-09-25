/**
 * Host adapter for the character resolver: finds the mounted archives and `.xl` files of a launch route,
 * reads RDAR indexes, and extracts resources to JSON with WolvenKit CLI into an ignored cache
 * (default `authoring/data/resolver-cache/`). All filesystem and process access lives here; the domain
 * modules (archive-precedence, archivexl-config, cco-model, resource-graph, character-resolver) are pure.
 *
 * Read-only towards the game and MO2: archives are opened for reading and WolvenKit writes only into the
 * cache directory. Cache entries are keyed by (depot hash, archive path+size+mtime fingerprint, WolvenKit
 * identity) and store
 * the serialized JSON with base64 buffers trimmed, plus the SHA-256 of the extracted resource bytes.
 * WolvenKit runs through the shared runner (`wolvenkit-cli.ts`: time limit, exit and log rules, missing
 * .NET), one batch at a time per cache folder, in a unique batch folder.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { type ArchiveFile, buildMountPlan, DepotIndex, type MountedArchive, type MountPlan } from "./archive-precedence";
import { type ArchiveXlConfig, readArchiveXlConfig, type XlDocument } from "./archivexl-config";
import { depotHash, type DepotRef } from "./depot-path";
import { depotPathRegex } from "./eye-plate-wolvenkit";
import { writeFileAtomic } from "./derived-cache";
import { defaultLocalSettings, type LocalSettings } from "./local-settings";
import { readRdarIndexCount, readRdarIndexHashes } from "./rdar-index-fs";
import { type FetchedResource, type ResourceFetchPort, ResourceGraph } from "./resource-graph";
import { discoverSources, listingStamp, pathStamp, type SourceCandidate, type WatchedPath } from "./source-discovery";
import { folderStampMode, type FolderStampMode } from "./volume-info";
import { runWolvenKit, type WolvenKitRun, WolvenKitRunError, type WolvenKitRunOptions, wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

export interface InstallationOptions {
  readonly gameRoot: string;
  readonly launchRoute: "direct" | "mo2";
  readonly mo2Root?: string | null;
  readonly mo2ProfileId?: string | null;
  readonly manualModRoot?: string | null;
  readonly wolvenKitCli: string;
  readonly cacheDir: string;
  readonly log?: (message: string) => void;
  /** How folders are stamped (default: by the volume's file system, volume-info.ts). A test seam. */
  readonly folderStamps?: (root: string) => FolderStampMode;
}

export interface Installation {
  readonly plan: MountPlan;
  readonly depot: DepotIndex;
  readonly xl: ArchiveXlConfig;
  readonly graph: ResourceGraph;
  readonly fetcher: WolvenKitFetcher;
  readonly summary: {
    readonly route: "direct" | "mo2";
    readonly scanComplete: boolean;
    readonly scanIssues: readonly string[];
    /** Blocking scan issues that may hide an archive, `.xl` or modlist file (see SourceIssue.mayHideSources). */
    readonly scanGaps: readonly string[];
    /**
     * What could not be read at open time and may read next time (PIPE-57): an archive index, a folder or entry the scan could not
     * inspect, an `.xl` file. An installation with any is opened again after a while (installation-registry.ts).
     */
    readonly readErrors?: readonly string[];
    readonly mountedArchives: number;
    readonly unmountedArchives: number;
    readonly indexErrors: readonly string[];
    /** Mounted archives whose RDAR index could not be read, with their lookup rank (0 is searched first). */
    readonly unreadIndexes: readonly UnreadIndex[];
    readonly xlFiles: number;
    readonly xlIssues: readonly string[];
    readonly ep1Installed: boolean;
    readonly modOrder: MountPlan["modOrder"];
  };
  /**
   * Everything the opened answer depends on, stamped when it was read (source-discovery.ts `WatchedPath`): the scanned
   * folders and candidate files, the MO2 settings and mod list, the game's ArchiveXL bundle and executable. When every
   * stamp still matches, opening again would give the same answer (installation-registry.ts). Absent for synthetic
   * installations, which are never re-checked.
   */
  readonly watch?: readonly WatchedPath[];
}

export interface UnreadIndex { readonly id: string; readonly name: string; readonly providerName: string; readonly rank: number; readonly error: string }

const lower = (value: string) => value.toLowerCase();
const XL_LOCATIONS = [/^red4ext\/plugins\/archivexl\/bundle\/.+\.xl$/, /^archive\/pc\/mod\/.+\.xl$/];

/** The game-folder ArchiveXL bundle is outside source discovery's `archive/pc` scan. Its folder and files are watched too. */
function gameBundleFiles(gameRoot: string, watched: WatchedPath[], byListing: boolean): SourceCandidate[] {
  const bundle = join(gameRoot, "red4ext", "plugins", "ArchiveXL", "Bundle");
  const stamp = (path: string) => { try { return pathStamp(lstatSync(path)); } catch { return pathStamp(null); } };
  const folder = stamp(bundle);
  let listed = folder;
  if (byListing && folder.startsWith("dir|")) try { listed = listingStamp(readdirSync(bundle, { withFileTypes: true })); } catch { /* stamped by time */ }
  watched.push({ path: bundle, stamp: listed });
  if (!existsSync(bundle) || lstatSync(bundle).isSymbolicLink()) return [];
  const now = new Date().toISOString();
  return readdirSync(bundle).filter(name => /\.(archive|xl)$/i.test(name)).map(name => {
    const physicalPath = join(bundle, name), stat = statSync(physicalPath);
    watched.push({ path: physicalPath, stamp: stamp(physicalPath) });
    return { id: `game:bundle:${lower(name)}`, provider: "game", providerName: "Installed game", route: "direct", profileId: null,
      virtualPath: `red4ext/plugins/ArchiveXL/Bundle/${name}`, physicalPath, kind: /\.xl$/i.test(name) ? "archive-xl" : "archive",
      active: true, priority: null, priorityEvidence: null, sizeBytes: stat.size, modifiedMs: stat.mtimeMs, sha256: null,
      discoveredAt: now, limitations: [] } satisfies SourceCandidate;
  });
}

const toArchiveFile = (candidate: SourceCandidate): ArchiveFile => ({ id: candidate.physicalPath, virtualPath: candidate.virtualPath,
  provider: candidate.provider, providerName: candidate.providerName, active: candidate.active, priority: candidate.priority });

/** Visible winner of each loose virtual file (same VFS rule as archives). */
function visibleLoose(candidates: readonly SourceCandidate[]): SourceCandidate[] {
  const byPath = new Map<string, SourceCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.active) continue;
    const key = lower(candidate.virtualPath);
    byPath.set(key, [...(byPath.get(key) ?? []), candidate]);
  }
  return [...byPath.values()].map(copies => {
    const mo2 = copies.filter(c => c.provider.startsWith("mo2-")).sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
    return mo2[0] ?? copies[0]!;
  });
}

function fingerprint(path: string): string {
  const stat = statSync(path);
  return createHash("sha256").update(`${path}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 24);
}

/**
 * Parsed archive indexes and `.xl` files kept in memory by their file's identity (path, size and modification time), so
 * opening a route again after a mod change reads only what changed. Each open keeps only the entries it used.
 */
let indexMemo = new Map<string, BigUint64Array>();
type XlRead = { document?: unknown; error?: string; excludes: boolean };
let xlMemo = new Map<string, XlRead>();
const identity = (path: string, size: number, mtimeMs: number) => `${path}|${size}|${mtimeMs}`;

/**
 * Sorted depot hashes of an archive's index, cached per archive fingerprint. A cache file is written atomically
 * and trusted only when it holds exactly the entry count the archive's index declares; anything else (a file
 * left by an older, non-atomic write that was cut short) is deleted and read again (PREV-47).
 */
export function readArchiveIndex(path: string, cacheDir: string): BigUint64Array {
  const key = join(cacheDir, "index", `${fingerprint(path)}.u64`);
  if (existsSync(key)) {
    try {
      const bytes = readFileSync(key);
      if (bytes.byteLength === readRdarIndexCount(path) * 8) return new BigUint64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch { /* Unreadable: read the archive again below. */ }
    rmSync(key, { force: true });
  }
  const hashes = readRdarIndexHashes(path);
  try {
    mkdirSync(join(cacheDir, "index"), { recursive: true });
    writeFileAtomic(key, new Uint8Array(hashes.buffer, hashes.byteOffset, hashes.byteLength));
  } catch { /* Advisory: the index is used anyway and read again next time. */ }
  return hashes;
}

/** Replace base64 payloads with their length so cached JSON stays small; nothing else is altered. */
export function trimBuffers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimBuffers);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = key === "Bytes" && typeof item === "string" ? { $trimmedBase64Length: item.length } : trimBuffers(item);
  return out;
}

/**
 * The document without `Header.ArchiveFileName` (PIPE-60): the converter writes the temporary file it read there (a private path),
 * `uncook -s` writes none, and nothing reads it. Stripping it makes both routes store the same JSON.
 */
export function withoutArchiveFileName(document: unknown): unknown {
  const header = (document as { Header?: unknown } | null)?.Header;
  if (!header || typeof header !== "object" || !("ArchiveFileName" in header)) return document;
  const { ArchiveFileName: _dropped, ...rest } = header as Record<string, unknown>;
  return { ...(document as object), Header: rest };
}

interface Pending { archive: MountedArchive; ref: DepotRef; extension: string | null; resolve: (value: FetchedResource | null) => void }
type Queue = { archive: MountedArchive; items: Map<string, Pending> };

/** Time limit of one WolvenKit step (unbundle or convert) of a resolver batch. */
export const RESOLVER_STEP_TIMEOUT_MS = 10 * 60_000;
/**
 * Rule version of the `.failed` markers. A marker is written only when WolvenKit finished a batch cleanly
 * in the batch's own folder, the extracted resource was still there, and no readable JSON came out. It
 * records the WolvenKit identity that failed, and counts only for that identity (PREV-46): another WolvenKit
 * may convert the resource. Markers without this version (version 1 was written before PREV-29, when a
 * concurrent batch could delete the folder; version 2 did not record the identity) are ignored and removed.
 *
 * A resource the archive lists but WolvenKit writes nothing for, in launches that finished cleanly, gets a marker of kind
 * `not-written` counting those batches (PIPE-54). It becomes lasting at `NOT_WRITTEN_RUNS`: one clean miss may be a fluke of
 * that launch, a second in another batch is how that WolvenKit treats the resource. Like every marker it is keyed by the
 * archive's fingerprint and the WolvenKit identity, so a changed archive or another WolvenKit tries again.
 */
export const FAILED_MARKER_VERSION = 3;
/** Clean batches that wrote nothing for a resource before that is taken as lasting (PIPE-54). */
export const NOT_WRITTEN_RUNS = 2;

/**
 * One extraction lane per cache folder in this process. Every fetcher on that folder (the character
 * details, the grading LUT, the eye plate head source) runs its WolvenKit batches through it one at a
 * time, and a resource one fetcher is extracting is awaited by the others instead of extracted again.
 * Batch folders are unique (`mkdtemp`), so another process on the same cache cannot collide either.
 */
interface CacheLane { tail: Promise<void>; inflight: Map<string, Promise<FetchedResource | null>>;
  /** Cache files whose last answer was a null that may not repeat (`WolvenKitFetcher.transient`), whichever fetcher gave it. */
  transient: Set<string> }
const lanes = new Map<string, CacheLane>();
function laneFor(cacheDir: string): CacheLane {
  const key = process.platform === "win32" ? resolve(cacheDir).toLowerCase() : resolve(cacheDir);
  let lane = lanes.get(key);
  if (!lane) { lane = { tail: Promise.resolve(), inflight: new Map(), transient: new Set() }; lanes.set(key, lane); }
  return lane;
}

/** A depot path WolvenKit can select by pattern: plain path text, no ArchiveXL markers. */
const plainPath = (path: string | null): path is string => !!path && path.length <= 512 && !/[*{}<>|"?\0]/.test(path);
/** Most characters of one escaped selection pattern: a bound on the regex WolvenKit compiles, well under the command line. */
export const MAX_PATTERN_CHARS = 12_000;
/** Windows' command-line limit (`CreateProcess`), in characters, and the margin kept below it. */
export const COMMAND_LINE_LIMIT = 32_767;
const COMMAND_LINE_MARGIN = 512;
/** Most characters the archives of one launch take on its command line; a batch with more is split (PIPE-61). */
export const MAX_ARCHIVE_CHARS = 16_000;
/**
 * An argument's length on a Windows command line, with the space before it: quoted when it holds a space, tab or quote, each quote
 * escaped with a backslash, and backslashes doubled before a quote or the closing quote (the rules Node and Bun quote by).
 */
export function commandLineArgumentLength(arg: string): number {
  if (arg && !/[\s"]/.test(arg)) return arg.length + 1;
  let length = 3, slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") { slashes++; continue; }
    length += ch === "\"" ? slashes * 2 + 2 : slashes + 1;
    slashes = 0;
  }
  return length + slashes * 2;
}
/**
 * The selection patterns of an `uncook` launch over `archives` (PIPE-61): `paths` split so that each escaped pattern stays within
 * `MAX_PATTERN_CHARS` and each launch's whole command line (the CLI, the archives, the output folder, the pattern and the flags)
 * within `COMMAND_LINE_LIMIT`. Escaping is counted as `depotPathRegex` writes it.
 */
export function uncookPatterns(cli: string, archives: readonly string[], output: string, paths: readonly string[]): string[] {
  const fixed = [cli, "uncook", ...archives, "-o", output, "-r", "-u", "-s", "-v", "Minimal"].reduce((sum, arg) => sum + commandLineArgumentLength(arg), 0);
  // The pattern is quoted when a path holds a space (3 more characters); it never ends in a backslash (it ends in `)$`).
  const budget = Math.min(MAX_PATTERN_CHARS, COMMAND_LINE_LIMIT - COMMAND_LINE_MARGIN - fixed - 4);
  const empty = depotPathRegex([]).length, wrapper = "(?i)".length + empty;
  const patterns: string[] = [];
  let current: string[] = [], size = wrapper;
  for (const path of paths) {
    const escaped = depotPathRegex([path]).length - empty + 1;
    if (current.length && size + escaped > budget) { patterns.push(`(?i)${depotPathRegex(current)}`); current = []; size = wrapper; }
    current.push(path); size += escaped;
  }
  if (current.length) patterns.push(`(?i)${depotPathRegex(current)}`);
  return patterns;
}

/** Batched WolvenKit CLI extraction with a persistent JSON cache, shared safely by every fetcher on one cache folder. */
export class WolvenKitFetcher implements ResourceFetchPort {
  private readonly pending = new Map<string, Queue>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lane: CacheLane;
  /** The WolvenKit identity (`wolvenKitIdentityKey`) whose output this fetcher caches, and its short form in file names. */
  readonly tool: string;
  private readonly toolTag: string;
  /**
   * `transient` counts resources answered null for a reason that may not repeat (no lasting `.failed` marker: the tool
   * did not run cleanly, or its output was missing). A graph that saw one should not be kept for later preparations.
   */
  readonly stats = { cacheHits: 0, shared: 0, extracted: 0, cliCalls: 0, transient: 0, failures: [] as string[] };

  constructor(private readonly cli: string, private readonly cacheDir: string, private readonly contains: (archiveId: string, hash: string) => boolean,
    private readonly log: (message: string) => void = () => {}) {
    this.lane = laneFor(cacheDir);
    this.tool = wolvenKitIdentityKey(wolvenKitIdentity(cli));
    this.toolTag = createHash("sha256").update(this.tool).digest("hex").slice(0, 12);
  }

  /** Cache file of one resource: keyed by depot hash, archive fingerprint and WolvenKit identity (a WolvenKit update extracts again). */
  private cachePath(archive: MountedArchive, hash: string) { return join(this.cacheDir, "json", `${hash}-${fingerprint(archive.id)}-${this.toolTag}.json`); }

  /** A current marker of this WolvenKit for a cache file, or null (a stale or unreadable one is removed). */
  private marker(path: string): { kind?: string; runs?: number } | null {
    const marker = `${path}.failed`;
    if (!existsSync(marker)) return null;
    try {
      const known = JSON.parse(readFileSync(marker, "utf8"));
      if (known.markerVersion === FAILED_MARKER_VERSION && known.wolvenKit === this.tool) return known;
    } catch { /* unreadable: stale */ }
    rmSync(marker, { force: true });
    return null;
  }

  /** The cached answer: a resource, null for a lasting `.failed` marker, or undefined when WolvenKit must run. */
  private cached(path: string): FetchedResource | null | undefined {
    // A resource WolvenKit could not convert stays failed until its container or WolvenKit changes; one it wrote nothing for, once
    // that happened in `NOT_WRITTEN_RUNS` clean batches.
    const known = this.marker(path);
    if (known && (known.kind !== "not-written" || (known.runs ?? 0) >= NOT_WRITTEN_RUNS)) return null;
    if (!existsSync(path)) return undefined;
    try {
      const text = readFileSync(path, "utf8"), entry = JSON.parse(text);
      return { document: withoutArchiveFileName(entry.document), extractedSha256: entry.meta.extractedSha256, path: entry.meta.path, bytes: text.length };
    } catch { rmSync(path, { force: true }); return undefined; }
  }

  /** Whether the last null answer for this resource may not repeat (`ResourceFetchPort.transient`). */
  transient(archive: MountedArchive, ref: DepotRef): boolean { return this.lane.transient.has(this.cachePath(archive, ref.hash)); }

  fetch(archive: MountedArchive, ref: DepotRef, extension: string | null): Promise<FetchedResource | null> {
    const path = this.cachePath(archive, ref.hash);
    const cached = this.cached(path);
    if (cached !== undefined) { this.stats.cacheHits++; this.lane.transient.delete(path); return Promise.resolve(cached); }
    const inflight = this.lane.inflight.get(path);
    if (inflight) { this.stats.shared++; return inflight; }
    const promise = new Promise<FetchedResource | null>(resolve => {
      const queue = this.pending.get(archive.id) ?? { archive, items: new Map<string, Pending>() };
      queue.items.set(ref.hash, { archive, ref, extension, resolve });
      this.pending.set(archive.id, queue);
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.lane.tail = this.lane.tail.then(() => this.flush()); }, 30);
    });
    this.lane.inflight.set(path, promise);
    void promise.finally(() => { if (this.lane.inflight.get(path) === promise) this.lane.inflight.delete(path); });
    return promise;
  }

  private run(args: string[], options: Pick<WolvenKitRunOptions, "accept" | "failure"> = {}): Promise<WolvenKitRun> {
    this.stats.cliCalls++;
    return runWolvenKit(this.cli, args, { timeoutMs: RESOLVER_STEP_TIMEOUT_MS, keep: 16_000, ...options });
  }

  /**
   * Answer null: `lasting` when a marker records that the tool fails on this resource, otherwise a failure that may not repeat
   * (counted, and remembered for `transient`, so a graph that asked for it reads it again later).
   */
  private answerNull(archive: MountedArchive, item: Pending, lasting: boolean): void {
    const path = this.cachePath(archive, item.ref.hash);
    if (lasting) this.lane.transient.delete(path);
    else { this.stats.transient++; this.lane.transient.add(path); }
    item.resolve(null);
  }

  /** Extract everything queued. Never rejects, so the shared lane is never poisoned; every waiter is answered. */
  private async flush(): Promise<void> {
    const queues = [...this.pending.values()];
    this.pending.clear();
    if (!queues.length) return;
    const archiveChars = (batch: Queue[]) => batch.reduce((sum, other) => sum + commandLineArgumentLength(other.archive.id), 0);
    try {
      // Archives in one CLI call must not both contain a requested hash, or outputs would collide.
      const batches: Queue[][] = [];
      for (const queue of queues) {
        // Nor may one launch name more archives than its command line holds (PIPE-61).
        const fits = batches.find(batch => archiveChars(batch) + commandLineArgumentLength(queue.archive.id) <= MAX_ARCHIVE_CHARS &&
          batch.every(other =>
            ![...queue.items.keys()].some(hash => this.contains(other.archive.id, hash)) &&
            ![...other.items.keys()].some(hash => this.contains(queue.archive.id, hash))));
        if (fits) fits.push(queue); else batches.push([queue]);
      }
      for (const batch of batches) await this.extract(batch);
    } catch (error) {
      this.stats.failures.push(String(error));
      for (const queue of queues) for (const item of queue.items.values()) this.answerNull(queue.archive, item, false);
    }
    if (this.pending.size) await this.flush();
  }

  private async extract(queues: Queue[]): Promise<void> {
    // Another process may have cached some of these since they were queued.
    for (const queue of queues) for (const [hash, item] of [...queue.items]) {
      const cached = this.cached(this.cachePath(queue.archive, hash));
      if (cached === undefined) continue;
      this.stats.cacheHits++; queue.items.delete(hash);
      if (cached) { this.lane.transient.delete(this.cachePath(queue.archive, hash)); item.resolve(cached); }
      else this.answerNull(queue.archive, item, true);
    }
    const batch = queues.filter(queue => queue.items.size);
    if (!batch.length) return;
    mkdirSync(join(this.cacheDir, "tmp"), { recursive: true });
    const dir = mkdtempSync(join(this.cacheDir, "tmp", `batch-${process.pid}-`));
    const raw = join(dir, "raw");
    const answered = new Set<Pending>();
    const answer = (item: Pending, value: FetchedResource) => {
      answered.add(item); this.lane.transient.delete(this.cachePath(item.archive, item.ref.hash)); item.resolve(value);
    };
    const fail = (item: Pending, lasting: boolean) => { answered.add(item); this.answerNull(item.archive, item, lasting); };
    try {
      const hashes = [...new Set(batch.flatMap(queue => [...queue.items.keys()]))];
      const archives = batch.map(queue => queue.archive.id);
      this.log(`WolvenKit: extracting ${hashes.length} resource(s) from ${batch.length} archive(s)`);
      // Each output file by depot hash, with the folder it was written to and whether that step finished cleanly.
      const found = new Map<string, { file: string; path: string | null; bytes: number; clean: boolean }>();
      const walk = (root: string, folder: string, clean: boolean) => {
        for (const name of readdirSync(folder)) {
          const full = join(folder, name);
          if (lstatSync(full).isDirectory()) { walk(root, full, clean); continue; }
          if (name.endsWith(".json")) continue;
          const rel = relative(root, full).split(sep).join("\\");
          const numeric = /^(\d+)\.[^.\\]+$/.exec(rel);
          const hash = numeric ? BigInt(numeric[1]!).toString() : depotHash(rel);
          if (!found.has(hash)) found.set(hash, { file: full, path: numeric ? null : rel, bytes: statSync(full).size, clean });
        }
      };
      // Whether every extraction launch of this batch finished cleanly: only then does a resource it wrote nothing for count
      // towards a lasting `not-written` marker (PIPE-54).
      let extractedCleanly = true;
      const finished = (run: WolvenKitRun, step: string) => {
        const clean = run.exitCode === 0 && !/Unhandled exception/i.test(run.output);
        if (!clean) this.stats.failures.push(`WolvenKit ${step} did not finish cleanly (exit ${run.exitCode}); unconverted resources are retried next time.`);
        if (!clean && step !== "convert") extractedCleanly = false;
        return clean;
      };
      // Step 1, one launch: resources with a known depot path are extracted and serialized together (`uncook -u -s`, whose
      // JSON is the converter's). Missing ones are judged per file below, so any exit is accepted; a crash, time limit or
      // missing .NET throws.
      const named = [...new Set(batch.flatMap(queue => [...queue.items].filter(([hash, item]) => plainPath(item.ref.path) && depotHash(item.ref.path!) === hash)
        .map(([, item]) => item.ref.path!.replaceAll("/", "\\"))))];
      const serialized = join(dir, "serialized");
      for (const pattern of uncookPatterns(this.cli, archives, serialized, named)) {
        mkdirSync(serialized, { recursive: true });
        const run = await this.run(["uncook", ...archives, "-o", serialized, "-r", pattern, "-u", "-s", "-v", "Minimal"],
          { accept: () => true, failure: /(?!)/ });
        walk(serialized, serialized, finished(run, "uncook"));
      }
      // Step 2, only for what step 1 did not serialize (a reference without a path, an archive that lists hashes only, or
      // a resource step 1 wrote without JSON): extract by hash, then convert, as before step 1 existed.
      for (const [hash, hit] of found) if (!existsSync(`${hit.file}.json`)) found.delete(hash);
      const rest = hashes.filter(hash => !found.has(hash));
      if (rest.length) {
        mkdirSync(raw, { recursive: true });
        writeFileSync(join(dir, "hashes.txt"), rest.join("\n") + "\n");
        finished(await this.run(["unbundle", ...archives, "-o", raw, "--hash", join(dir, "hashes.txt")], { accept: () => true, failure: /(?!)/ }), "unbundle");
        const before = new Set(found.keys());
        walk(raw, raw, true);
        // Unnamed outputs get the expected extension so WolvenKit's converter recognises them.
        for (const queue of batch) for (const [hash, item] of queue.items) {
          const hit = found.get(hash);
          if (hit && !before.has(hash) && !hit.path && item.extension && !hit.file.endsWith(`.${item.extension}`)) {
            const renamed = `${hit.file.replace(/\.[^.\\/]+$/, "")}.${item.extension}`;
            renameSync(hit.file, renamed); hit.file = renamed;
          }
        }
        // The converter's own exit and log decide only whether a missing JSON may be recorded as a lasting failure.
        if (found.size > before.size) {
          const clean = finished(await this.run(["convert", "s", raw], { accept: () => true, failure: /(?!)/ }), "convert");
          for (const [hash, hit] of found) if (!before.has(hash)) hit.clean = clean;
        }
      }
      const store = (path: string, text: string) => { mkdirSync(join(this.cacheDir, "json"), { recursive: true }); writeFileAtomic(path, text); };
      for (const queue of batch) for (const [hash, item] of queue.items) {
        const hit = found.get(hash);
        let document: unknown = null;
        try { if (hit && existsSync(`${hit.file}.json`)) document = withoutArchiveFileName(trimBuffers(JSON.parse(readFileSync(`${hit.file}.json`, "utf8")))); }
        catch (error) { this.stats.failures.push(`${queue.archive.name}: ${item.ref.path ?? hash}: ${(error as Error).message}`); }
        if (hit && document) {
          const bytes = readFileSync(hit.file);
          const extractedSha256 = createHash("sha256").update(bytes).digest("hex");
          const path = hit.path ?? item.ref.path;
          // The document answers even when the cache write fails (disk full, a locked file); it is extracted again next time.
          const text = JSON.stringify({ meta: { hash, path, archive: queue.archive.name,
            group: queue.archive.group, wolvenKit: this.tool, extractedSha256, bytes: bytes.length, cachedAt: new Date().toISOString() }, document });
          try { store(this.cachePath(queue.archive, hash), text); rmSync(`${this.cachePath(queue.archive, hash)}.failed`, { force: true }); }
          catch (error) { this.stats.failures.push(`${queue.archive.name}: ${path ?? hash}: not cached: ${(error as Error).message}`); }
          this.stats.extracted++;
          answer(item, { document, extractedSha256, path, fresh: true, bytes: text.length });
          continue;
        }
        this.stats.failures.push(`${queue.archive.name}: ${item.ref.path ?? hash} was not extracted or converted.`);
        // Lasting only when the tool genuinely failed on this resource: a clean run, in this batch's own
        // folder, with the extracted file still there as unbundle wrote it.
        const intact = hit && existsSync(hit.file) && statSync(hit.file).size === hit.bytes;
        const marker = (fields: Record<string, unknown>) => {
          try {
            store(`${this.cachePath(queue.archive, hash)}.failed`, JSON.stringify({ markerVersion: FAILED_MARKER_VERSION, wolvenKit: this.tool, hash,
              path: hit?.path ?? item.ref.path, archive: queue.archive.name, ...fields, at: new Date().toISOString() }));
            return true;
          } catch { return false; } // Advisory: without the marker the resource is tried again next time.
        };
        let lasting = false;
        if (hit && hit.clean && intact) lasting = marker({ reason: "WolvenKit extracted the resource but produced no readable JSON." });
        else if (!hit && extractedCleanly) {
          // Nothing written, in launches that finished cleanly: counted per batch, lasting from the `NOT_WRITTEN_RUNS`th (PIPE-54).
          const known = this.marker(this.cachePath(queue.archive, hash));
          const runs = (known?.kind === "not-written" ? known.runs ?? 0 : 0) + 1;
          lasting = marker({ kind: "not-written", runs, reason: "The archive lists the resource, but WolvenKit wrote nothing for it." }) && runs >= NOT_WRITTEN_RUNS;
        }
        fail(item, lasting);
      }
    } catch (error) {
      this.stats.failures.push(error instanceof WolvenKitRunError ? `${error.code}: ${error.message}` : String(error));
      for (const queue of batch) for (const item of queue.items.values()) if (!answered.has(item)) fail(item, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

/**
 * A resource graph and fetcher over an opened route's archives, caching extracted resources in `cacheDir`. Every view
 * on one cache folder shares that folder's extraction lane, so views never extract the same resource twice.
 */
export function installationView(core: { depot: DepotIndex; xl: ArchiveXlConfig },
  options: Pick<InstallationOptions, "wolvenKitCli" | "cacheDir" | "log">): { graph: ResourceGraph; fetcher: WolvenKitFetcher } {
  const fetcher = new WolvenKitFetcher(options.wolvenKitCli, options.cacheDir, (archiveId, hash) => core.depot.archiveContains(archiveId, hash),
    options.log ?? (() => {}));
  return { graph: new ResourceGraph(core.depot, core.xl, fetcher), fetcher };
}

/** Scan issues that may read differently next time (a locked or briefly unreadable folder, entry, mod list or settings file). */
const UNREADABLE_ISSUES = new Set(["directory_unreadable", "entry_unreadable", "profile_unreadable", "mo2_ini_unreadable"]);

/** Discover the route's sources, mount archives, read indexes and `.xl` files, and open a resource graph. */
export function openInstallation(options: InstallationOptions): Installation {
  const log = options.log ?? (() => {});
  const settings: LocalSettings = { ...defaultLocalSettings(), gameRoot: options.gameRoot, launchRoute: options.launchRoute,
    mo2Root: options.mo2Root ?? null, mo2ProfileId: options.mo2ProfileId ?? null, manualModRoot: options.manualModRoot ?? null };
  const folderStamps = options.folderStamps ?? folderStampMode;
  const discovery = discoverSources(settings, { maxEntries: 1_000_000, maxDepth: 24 }, { folderStamps });
  const watch: WatchedPath[] = [...discovery.watched];
  const candidates = [...discovery.candidates, ...gameBundleFiles(options.gameRoot, watch, folderStamps(options.gameRoot) === "listing")];
  // The game's own version: an update replaces the executable (and usually its archives).
  const executable = join(options.gameRoot, "bin", "x64", "Cyberpunk2077.exe");
  let executableStat = null;
  try { executableStat = lstatSync(executable); } catch { /* Stamped as missing. */ }
  watch.push({ path: executable, stamp: pathStamp(executableStat) });
  const stamped = new Map(candidates.map(candidate => [candidate.physicalPath, candidate]));
  const nextIndexes = new Map<string, BigUint64Array>(), nextXl = new Map<string, XlRead>();
  const archives = candidates.filter(c => c.kind === "archive").map(toArchiveFile);
  const modlist = visibleLoose(candidates.filter(c => c.kind === "archive-modlist"))[0];
  const plan = buildMountPlan(archives, modlist ? readFileSync(modlist.physicalPath, "utf8") : null);
  log(`Mounted ${plan.archives.length} archives (${plan.unmounted.length} not mounted); reading indexes`);
  const indexes = new Map<string, BigUint64Array>();
  const indexErrors: string[] = [], unreadIndexes: UnreadIndex[] = [];
  for (const archive of plan.archives) {
    const known = stamped.get(archive.id), key = known ? identity(archive.id, known.sizeBytes, known.modifiedMs) : null;
    const memo = key ? indexMemo.get(key) : undefined;
    if (memo) { indexes.set(archive.id, memo); nextIndexes.set(key!, memo); continue; }
    try {
      const hashes = readArchiveIndex(archive.id, options.cacheDir);
      indexes.set(archive.id, hashes);
      if (key) nextIndexes.set(key, hashes);
    }
    catch (error) {
      indexErrors.push(`${archive.name}: ${(error as Error).message}`);
      unreadIndexes.push({ id: archive.id, name: archive.name, providerName: archive.providerName, rank: archive.rank, error: (error as Error).message });
    }
  }
  const depot = new DepotIndex(plan, indexes);
  const xlFiles = visibleLoose(candidates.filter(c => c.kind === "archive-xl"))
    .filter(c => XL_LOCATIONS.some(pattern => pattern.test(lower(c.virtualPath))))
    .sort((a, b) => {
      const bundle = (c: SourceCandidate) => lower(c.virtualPath).startsWith("red4ext/") ? 0 : 1;
      return bundle(a) - bundle(b) || (lower(a.virtualPath) < lower(b.virtualPath) ? -1 : lower(a.virtualPath) > lower(b.virtualPath) ? 1 : 0);
    });
  const xlIssues: string[] = [], xlReadErrors: string[] = [];
  const documents: XlDocument[] = [];
  for (const file of xlFiles) {
    const key = identity(file.physicalPath, file.sizeBytes, file.modifiedMs);
    let read = xlMemo.get(key);
    if (!read) {
      try {
        const text = readFileSync(file.physicalPath, "utf8");
        read = { document: Bun.YAML.parse(text), excludes: /!exclude\b/.test(text) };
      } catch (error) { read = { error: (error as Error).message, excludes: false }; }
    }
    nextXl.set(key, read);
    if (read.excludes) xlIssues.push(`${file.virtualPath}: uses !exclude; the YAML reader drops tags, so exclusions are treated as targets.`);
    // Each open gets its own copy of a remembered document.
    if (read.error === undefined) documents.push({ id: file.virtualPath, document: structuredClone(read.document) });
    else { xlIssues.push(`${file.virtualPath}: ${read.error}`); xlReadErrors.push(`${file.virtualPath}: ${read.error}`); }
  }
  indexMemo = nextIndexes; xlMemo = nextXl;
  const xl = readArchiveXlConfig(documents);
  const { graph, fetcher } = installationView({ depot, xl }, options);
  return { plan, depot, xl, graph, fetcher, watch, summary: { route: options.launchRoute, scanComplete: discovery.complete,
    scanIssues: discovery.issues.filter(issue => issue.blocking).map(issue => `${issue.code}: ${issue.detail}`),
    scanGaps: discovery.issues.filter(issue => issue.blocking && issue.mayHideSources !== false).map(issue => `${issue.code}: ${issue.detail}`),
    readErrors: [...indexErrors, ...xlReadErrors, ...discovery.issues.filter(issue => UNREADABLE_ISSUES.has(issue.code)).map(issue => `${issue.code}: ${issue.detail}`)],
    mountedArchives: plan.archives.length, unmountedArchives: plan.unmounted.length, indexErrors, unreadIndexes,
    xlFiles: documents.length, xlIssues: [...xlIssues, ...xl.issues], ep1Installed: plan.ep1Installed, modOrder: plan.modOrder } };
}
