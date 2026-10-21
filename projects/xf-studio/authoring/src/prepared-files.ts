/**
 * Host adapter: the one owner of the game files XF Studio prepared for the 3D preview on this computer (`PreparedFiles`, one per host
 * process): their size, one disk budget and "Clear prepared game files". Prepared files are derived from the player's own game and mods
 * and are all re-creatable. Each host registers its share as a partition: the user's character (`character`: the resolver's JSON, the
 * store and manifests; `exports`; `previews`), the baseline reference characters (`reference`, capped), the facial cache and the idles.
 *
 * **Budget.** Evictable files (exports, extracted JSON, choice previews) are kept within one byte budget by evicting the least recently
 * used first (their use time is the modification time of an export's `entry.json` or a file, set when it is used: `markUsed`). Choice
 * previews go the same way (PREV-157), so pictures a style or turntable version bump orphaned go first once the budget is reached.
 * Anything used by this process is never evicted, so a V on screen, its tried choices, the pictures shown and a running preparation keep
 * their files; the budget can be exceeded by what this session uses, and eviction then stops. A capped partition keeps within its cap
 * and never evicts another's files, so references can never evict the user's V (HAIR-03). The resolver's failure markers, archive
 * indexes and creator texts are small and kept. The store and manifests are removed only by Clear. The exports' work folders are outside
 * both (an export may be writing into one); one left over by a crash is swept with the budget check once it is an hour old
 * (`sweepStaleWork`, PREV-198).
 *
 * **When.** The budget check is work done ahead (an `ahead` job of the host's scheduler, platform/core/jobs.ts): at most once a minute,
 * one at a time, never beside a person's change. Clear is a person's job that runs alone, once every other job's work let go.
 */
import { utimesSync } from "node:fs";
import { lstat, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { hostFailure } from "./diagnostics/host-log";
import { hostClock, type Clock } from "./platform/core/clock";
import type { JobScheduler } from "./platform/core/jobs";

/** Default budget for the evictable prepared files together. */
export const PREPARED_BUDGET_BYTES = 8 * 1024 ** 3;
/**
 * The baseline reference characters' share of the budget (HAIR-03): an eighth of it, at most 256 MB. Their partition keeps within it and
 * never evicts anything else; the other partitions share what is left. Unlimited stays unlimited.
 */
export function referenceCap(total = PREPARED_BUDGET_BYTES): number {
  if (total === Infinity) return Infinity;
  if (!Number.isFinite(total) || total <= 0) throw Error("Invalid prepared-file budget.");
  return Math.min(256 * 1024 ** 2, total / 8);
}
/** The prepared files' size on disk, in all and by partition. */
export type PreparedSize = { bytes: number; partitions: Record<string, number> };

/**
 * The prepared files' budget from `XFS_PREPARED_BUDGET_GB` (CORE-113): `off` (or `0`, the older spelling) never evicts, which a
 * verification server borrowing another checkout's warm caches relies on; a positive number of gigabytes sets it. Unset gives the
 * default (undefined); anything else is reported through `warn` and ignored, so a typo never silently turns eviction off.
 */
export function preparedBudgetFrom(value: string | undefined, warn: (message: string) => void = () => {}): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const text = value.trim().toLowerCase();
  if (text === "off" || text === "0") return Infinity;
  const gigabytes = Number(text);
  if (Number.isFinite(gigabytes) && gigabytes > 0) return gigabytes * 1024 ** 3;
  warn(`XFS_PREPARED_BUDGET_GB must be "off" or a positive number of gigabytes; "${value}" is ignored and the default budget is used.`);
  return undefined;
}

/**
 * How many file-system calls the prepared files' checks keep in flight, all of them together (PREV-125): a size count walks every
 * prepared file (tens of thousands), and several walks at once (the prefetcher's count, the budget check after a batch or a change, a
 * folder per export entry) filled the runtime's I/O threads, so a person's request (reading a record, checking the mod setup) waited.
 */
export const PREPARED_FS_CONCURRENCY = 16;
let fsActive = 0;
const fsWaiting: (() => void)[] = [];
/** The most calls in flight at once so far, and every call made (tests read them). */
export const preparedFsStats = { peak: 0, calls: 0 };
/** Run one file-system call within the shared bound; a finished call hands its slot straight to the next waiting one. */
async function limited<T>(call: () => Promise<T>): Promise<T> {
  if (fsActive >= PREPARED_FS_CONCURRENCY) await new Promise<void>(resolve => fsWaiting.push(resolve));
  else fsActive++;
  preparedFsStats.peak = Math.max(preparedFsStats.peak, fsActive);
  preparedFsStats.calls++;
  try { return await call(); } finally {
    const next = fsWaiting.shift();
    if (next) next(); else fsActive--;
  }
}
/** `work` over `items`, a bounded number at a time (every file-system call inside still takes a shared slot). */
async function eachBounded<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += PREPARED_FS_CONCURRENCY) await Promise.all(items.slice(i, i + PREPARED_FS_CONCURRENCY).map(work));
}

async function folderBytes(root: string, skip: (name: string) => boolean = () => false): Promise<number> {
  let total = 0;
  const folders = [root];
  while (folders.length) {
    const batch = folders.splice(0, PREPARED_FS_CONCURRENCY);
    const listed = await Promise.all(batch.map(folder => limited(() => readdir(folder, { withFileTypes: true })).then(entries => ({ folder, entries }), () => null)));
    const files: string[] = [];
    for (const item of listed) for (const entry of item?.entries ?? []) {
      if (skip(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(item!.folder, entry.name);
      if (entry.isDirectory()) folders.push(path); else files.push(path);
    }
    for (let i = 0; i < files.length; i += PREPARED_FS_CONCURRENCY) {
      const sizes = await Promise.all(files.slice(i, i + PREPARED_FS_CONCURRENCY).map(path => limited(() => lstat(path)).then(info => info.size, () => 0 /* Gone meanwhile. */)));
      for (const bytes of sizes) total += bytes;
    }
  }
  return total;
}
const exportsSkip = (name: string) => name.startsWith(".work-") || name.endsWith(".tmp");

/**
 * A work folder older than this is left over (PREV-198): an export's work folder lives for one batch (seconds; a WolvenKit launch writing
 * into one keeps its time current) and is removed when the batch ends, so one this old was orphaned by a crash or a stopped batch.
 */
export const STALE_WORK_MS = 60 * 60 * 1000;
/**
 * Remove the exports' leftover work folders (`.work-*` older than `STALE_WORK_MS`): they are outside the budget and Clear, which skip work
 * folders a running export may be writing into. Runs with the budget check, so at the first preparation after a start and at most once a
 * minute after. Returns how many were removed.
 */
export async function sweepStaleWork(exportsRoot: string, now = hostClock().now(), maxAgeMs = STALE_WORK_MS): Promise<number> {
  let names: string[];
  try { names = await limited(() => readdir(exportsRoot)); } catch { return 0; }
  let removed = 0;
  await eachBounded(names.filter(name => name.startsWith(".work-")), async name => {
    const path = join(exportsRoot, name);
    try {
      const info = await limited(() => lstat(path));
      if (!info.isDirectory() || now - info.mtimeMs < maxAgeMs) return;
    } catch { return; }
    if (await removeTree(path)) removed++;
  });
  return removed;
}

/**
 * Remove a file or a folder and everything in it, one file-system call per file and folder, each within the shared bound (PREV-140). A
 * recursive `rm` is one call to the bound but many inside the runtime, so Clear's `rm` of every export folder at once still filled its
 * I/O threads. A link is removed, never followed. Whatever can't be removed (in use) is kept; answers whether it is all gone.
 */
async function removeTree(path: string): Promise<boolean> {
  let entries: import("node:fs").Dirent[];
  try {
    // A link (a junction to a folder included) is removed itself: listing it would list, and then remove, what it points to.
    if (!(await limited(() => lstat(path))).isDirectory()) throw Object.assign(Error("not a folder"), { code: "ENOTDIR" });
    entries = await limited(() => readdir(path, { withFileTypes: true }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    try { await limited(() => rm(path, { force: true })); return true; }
    catch { try { await limited(() => rmdir(path)); return true; } catch { return false; } }
  }
  let all = true;
  await eachBounded(entries, async entry => {
    const child = join(path, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) { if (!await removeTree(child)) all = false; return; }
    try { await limited(() => rm(child, { force: true })); }
    catch { try { await limited(() => rmdir(child)); } catch { all = false; } }
  });
  if (!all) return false;
  try { await limited(() => rmdir(path)); return true; } catch { return false; }
}

export type Evictable = { path: string; usedMs: number; bytes: number; folder: boolean };
async function exportEntries(root: string): Promise<Evictable[]> {
  const resources = join(root, "resources");
  let names: string[];
  try { names = await limited(() => readdir(resources)); } catch { return []; }
  const out: Evictable[] = [];
  await eachBounded(names.filter(name => !name.endsWith(".tmp") && !name.includes(".tmp")), async name => {
    const folder = join(resources, name);
    try {
      const used = await limited(() => stat(join(folder, "entry.json")));
      out.push({ path: folder, usedMs: used.mtimeMs, bytes: await folderBytes(folder), folder: true });
    } catch { /* Not a published entry. */ }
  });
  return out;
}
async function fileEntries(folder: string, suffix: string): Promise<Evictable[]> {
  let names: string[];
  try { names = await limited(() => readdir(folder)); } catch { return []; }
  const out: Evictable[] = [];
  await eachBounded(names.filter(name => name.endsWith(suffix)), async name => {
    const path = join(folder, name);
    try { const info = await limited(() => stat(path)); out.push({ path, usedMs: info.mtimeMs, bytes: info.size, folder: false }); } catch { /* Gone. */ }
  });
  return out;
}
/** Remove a folder's children (each within the shared bound), except those `keep` names; what is in use is kept. */
async function removeChildren(folder: string, keep: (name: string) => boolean = () => false): Promise<void> {
  let names: string[];
  try { names = await limited(() => readdir(folder)); } catch { return; }
  await eachBounded(names.filter(name => !keep(name)).map(name => join(folder, name)), async path => { await removeTree(path); });
}

/**
 * One folder of prepared files: counted (`bytes`, cheap: no listing entry by entry, PREV-125), removed by Clear, and, when it lists its
 * entries, evicted least recently used first.
 */
export type PreparedSource = {
  readonly root: string;
  bytes(): Promise<number>;
  /** Its entries with their use time: present only for a source the budget evicts. */
  entries?(): Promise<Evictable[]>;
  clear(): Promise<void>;
  /** Work left over by a crash, removed with the budget check (PREV-198). */
  sweep?(): Promise<number>;
};
/** The exporter's cache (`exports/`): entries by resource, evicted whole; its work folders are outside the budget and Clear. */
export function exportsSource(root: string): PreparedSource {
  return { root, bytes: () => folderBytes(root, exportsSkip), entries: () => exportEntries(root), clear: () => removeChildren(root, name => name.startsWith(".work-")),
    sweep: () => sweepStaleWork(root) };
}
/** Files of one kind in one folder (the resolver's JSON, preview images), evicted file by file; `keep` names survive Clear (failure markers). */
export function filesSource(folder: string, suffix: string, keep?: (name: string) => boolean): PreparedSource {
  return { root: folder, bytes: () => folderBytes(folder, name => !name.endsWith(suffix)), entries: () => fileEntries(folder, suffix),
    clear: () => removeChildren(folder, keep) };
}
/** A folder counted and removed by Clear only (the store, the manifests). */
export function keptSource(root: string): PreparedSource {
  return { root, bytes: () => folderBytes(root), clear: () => removeChildren(root) };
}

/**
 * Where a character-detail host keeps its prepared files:
 * - `exports`: the game-asset exporter's cache (GLBs, textures, mask layers), one folder per resource and archive identity;
 * - `resolver`: the resolver's extracted JSON (`json/`) and the empty markers of resources the native reader answered (`native/`);
 * - `store`: the content-addressed files and records the preview loads; `manifests`: what each prepared request depended on;
 * - `previews`: choice preview images (`images/*.webp`) and sources (`sources/*.json`).
 */
export type PreparedRoots = { exports: string; resolver: string; store: string; manifests: string; previews?: string };
/** A host's prepared files as sources: those the budget evicts, and those only Clear removes. */
export function preparedSources(roots: PreparedRoots): { evictable: PreparedSource[]; kept: PreparedSource[] } {
  return {
    evictable: [exportsSource(roots.exports), filesSource(join(roots.resolver, "json"), ".json", name => name.endsWith(".failed")),
      ...roots.previews ? [filesSource(join(roots.previews, "images"), ".webp"), filesSource(join(roots.previews, "sources"), ".json")] : []],
    kept: [keptSource(roots.store), keptSource(roots.manifests), keptSource(join(roots.resolver, "native"))],
  };
}

/**
 * One owner's share of the prepared files. Its hooks: `stop` (Clear begins: stop the work that writes into them), `settle` (wait until
 * that work let go, for an owner whose work runs on a scheduler of its own) and `forget` (the files are gone: forget what was derived
 * from them). `own`: an owner that still counts and clears its own files (the facial host, until it moves onto the scheduler).
 */
export type PreparedPartition = {
  readonly name: string;
  readonly evictable?: readonly PreparedSource[];
  readonly kept?: readonly PreparedSource[];
  /** At most this many bytes of its evictable files: a capped partition evicts only its own, never another's (HAIR-03). */
  readonly cap?: number;
  stop?(): void;
  settle?(): Promise<void>;
  forget?(): void;
  readonly own?: { bytes(): Promise<number>; clear(): Promise<{ freed: number }> };
};

/** Paths this process used (read or wrote): the budget never evicts one. Their use time is their modification time, set once a process. */
const touched = new Set<string>();
/** Mark a prepared entry (an export's `entry.json`, a cache file, a preview) as used now, once per process (`again`: rewritten, so now again). */
export function markUsed(path: string, again = false): void {
  if (touched.has(path) && !again) return;
  touched.add(path);
  try { const now = new Date(); utimesSync(path, now, now); } catch { /* Advisory. */ }
}
/** Whether this process used a prepared entry (the budget never evicts one). */
export const usedThisSession = (path: string): boolean => touched.has(path);

/** How often, at most, the prepared files are checked against their budget. */
export const EVICT_INTERVAL_MS = 60_000;
export type EvictResult = { removed: number; freed: number; bytes: number };
const folderKey = (path: string) => process.platform === "win32" ? path.replace(/\\/g, "/").toLowerCase() : path;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * The one owner of the host process's prepared files: one budget over every partition, one eviction at a time (an `ahead` job), and
 * Clear (a `person` job that runs alone, once every other job's work let go: CORE-108, PREV-102). Everything here is re-creatable; Clear
 * never touches the library, the workspace or settings.
 */
export class PreparedFiles {
  readonly budget: number;
  readonly scheduler: JobScheduler;
  private readonly clock: Clock;
  private readonly log: (message: string) => void;
  private readonly partitions: PreparedPartition[] = [];
  private evictedAt = -Infinity;
  private evicting: Promise<void> | null = null;
  constructor(options: { budget?: number; scheduler: JobScheduler; clock?: Clock; log?: (message: string) => void }) {
    this.budget = options.budget ?? PREPARED_BUDGET_BYTES;
    if (!(this.budget > 0)) throw Error("Invalid prepared-file budget.");
    this.scheduler = options.scheduler;
    this.clock = options.clock ?? hostClock();
    this.log = options.log ?? (() => {});
  }

  /** Register a partition (replacing one of the same name). */
  partition(partition: PreparedPartition): { used(path: string): void; size(): Promise<number> } {
    const index = this.partitions.findIndex(item => item.name === partition.name);
    if (index >= 0) this.partitions[index] = partition; else this.partitions.push(partition);
    return { used: markUsed, size: () => this.partitionBytes(partition, new Set()) };
  }

  /** Each source once, however many partitions name its folder. */
  private sources(partition: PreparedPartition, seen: Set<string>, kinds: "evictable" | "all" = "all"): PreparedSource[] {
    const all = [...partition.evictable ?? [], ...kinds === "all" ? partition.kept ?? [] : []];
    return all.filter(source => { const key = folderKey(source.root); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  private async partitionBytes(partition: PreparedPartition, seen: Set<string>): Promise<number> {
    if (partition.own) { try { return await partition.own.bytes(); } catch { return 0; } }
    return this.bytesOf(this.sources(partition, seen));
  }
  private async bytesOf(sources: readonly PreparedSource[]): Promise<number> {
    return sum(await Promise.all(sources.map(source => source.bytes().catch(() => 0))));
  }

  /** The prepared files' size, in all and by partition. */
  async size(): Promise<PreparedSize> {
    const seen = new Set<string>(), partitions: Record<string, number> = {};
    let bytes = 0;
    for (const partition of this.partitions) {
      const size = await this.partitionBytes(partition, seen);
      partitions[partition.name] = (partitions[partition.name] ?? 0) + size;
      bytes += size;
    }
    return { bytes, partitions };
  }

  /**
   * Keep the evictable files within the budget: each capped partition within its cap, the rest within what the caps leave. The least
   * recently used go first, never one this process used, so the budget can be exceeded by what this session uses. Under budget (the
   * usual case) nothing is listed entry by entry (PREV-125). Leftover work folders are swept first (PREV-198).
   */
  async evict(): Promise<EvictResult> {
    const seen = new Set<string>();
    const groups = this.partitions.map(partition => ({ partition, sources: partition.own ? [] : this.sources(partition, seen, "evictable") }));
    for (const { sources } of groups) for (const source of sources) await source.sweep?.().catch(() => 0);
    const result: EvictResult = { removed: 0, freed: 0, bytes: 0 };
    const capped = groups.filter(group => group.partition.cap !== undefined && Number.isFinite(group.partition.cap));
    const shared = groups.filter(group => !capped.includes(group));
    const within = async (sources: PreparedSource[], budget: number) => {
      const counted = await this.bytesOf(sources);
      if (counted <= budget) { result.bytes += counted; return; }
      const entries = (await Promise.all(sources.map(source => source.entries?.().catch(() => [] as Evictable[]) ?? Promise.resolve([] as Evictable[])))).flat();
      let bytes = sum(entries.map(entry => entry.bytes));
      entries.sort((a, b) => a.usedMs - b.usedMs);
      for (const entry of entries) {
        if (bytes <= budget) break;
        if (usedThisSession(entry.folder ? join(entry.path, "entry.json") : entry.path)) continue;
        if (entry.folder) { if (!await removeTree(entry.path)) continue; }
        else try { await limited(() => rm(entry.path, { force: true })); } catch { continue; }
        bytes -= entry.bytes; result.freed += entry.bytes; result.removed++;
      }
      result.bytes += bytes;
    };
    for (const group of capped) await within(group.sources, group.partition.cap!);
    await within(shared.flatMap(group => group.sources), Math.max(0, this.budget - sum(capped.map(group => group.partition.cap!))));
    return result;
  }

  /** Check the files against the budget soon, as work prepared ahead (at most once a minute; one check at a time). */
  keepWithinBudget(): Promise<void> {
    if (this.evicting || this.clock.monotonic() - this.evictedAt < EVICT_INTERVAL_MS) return this.evicting ?? Promise.resolve();
    this.evictedAt = this.clock.monotonic();
    const want = this.scheduler.want("prepared/budget", { key: "prepared:evict", lane: "ahead", run: () => this.evict() });
    const evicting: Promise<void> = want.settled.then(outcome => {
      if (outcome.status === "done" && outcome.result.removed)
        this.log(`Prepared game files: removed ${outcome.result.removed} least recently used (${(outcome.result.freed / 1024 ** 2).toFixed(0)} MB).`);
      if (outcome.status === "failed") {
        this.log(`Prepared game files could not be checked against their budget: ${(outcome.error as Error)?.message ?? outcome.error}`);
        hostFailure("character", "prepared_budget_failed", "The prepared game files couldn't be checked against their space limit.", outcome.error, "warn");
      }
      // Stopped before it ran (Clear, or nothing wanted it): checked again next time.
      if (outcome.status === "superseded") this.evictedAt = -Infinity;
    }).finally(() => { if (this.evicting === evicting) this.evicting = null; });
    this.evicting = evicting;
    return evicting;
  }

  /**
   * "Clear prepared game files": every partition stops its work, then, once no other job runs and every job's work let go, every
   * prepared file is removed and what was derived from them forgotten, so the next preparation reads the game files again. What is in
   * use (a running WolvenKit's folder) is kept. A V on screen stays as it is until it is prepared again.
   */
  async clear(): Promise<{ freed: number }> {
    for (const partition of this.partitions) { try { partition.stop?.(); } catch { /* Clear goes on. */ } }
    const want = this.scheduler.want("prepared/clear", { key: "prepared:clear", lane: "person", exclusive: true, run: async () => {
      const partitions = [...this.partitions];
      for (const partition of partitions) { try { await partition.settle?.(); } catch { /* Settled as far as it could. */ } }
      let freed = 0;
      const seen = new Set<string>();
      for (const partition of partitions) {
        try {
          if (partition.own) { freed += (await partition.own.clear()).freed; continue; }
          const sources = this.sources(partition, seen);
          const before = await this.bytesOf(sources);
          for (const source of sources) await source.clear();
          freed += Math.max(0, before - await this.bytesOf(sources));
        } catch (error) { this.log(`Some prepared game files (${partition.name}) couldn't be cleared: ${(error as Error)?.message ?? error}`); }
      }
      for (const partition of partitions) { try { partition.forget?.(); } catch { /* Forgotten as far as it could. */ } }
      return { freed };
    } });
    const outcome = await want.settled;
    if (outcome.status === "failed") throw outcome.error;
    return outcome.status === "done" ? outcome.result : { freed: 0 };
  }
}
