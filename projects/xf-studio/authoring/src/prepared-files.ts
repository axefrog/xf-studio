/**
 * Host adapter: the game files XF Studio prepared for the 3D preview on this computer, their size, a disk budget and "Clear prepared
 * game files". Prepared files are derived from the player's own game and mods and are all re-creatable:
 * - `exports`: the game-asset exporter's cache (GLBs, textures, mask layers), one folder per resource and archive identity;
 * - `resolver`: the resolver's extracted JSON (`json/`), one file per resource, archive identity and WolvenKit identity, and the empty
 *   markers of resources the native reader answered (`native/`, resolver-host.ts `NativeAnswerFiles`);
 * - `store`: the content-addressed files and records the preview loads (`files/`, `records/`, `chunks/`);
 * - `manifests`: what each prepared request depended on (choice-manifest.ts);
 * - `previews`: choice preview images and sources (choice-preview-host.ts), counted by their store and removed by Clear with it.
 *
 * **Budget.** Exports and extracted JSON are kept within a byte budget by evicting the least recently used first (their use time is the
 * modification time of an export's `entry.json` or a JSON file, set when a cache hit uses it: game-asset-export.ts `touchUsed`).
 * Choice preview images and sources are evicted the same way (PREV-157; their use time is set when the store serves or keeps one), so
 * pictures a style or turntable version bump orphaned go first once the budget is reached. Anything used by this process is never
 * evicted, so a V on screen, its tried choices, the pictures shown and a running preparation keep their files; the budget can be
 * exceeded by what this session uses, and eviction then stops. The resolver's failure markers, archive indexes and creator texts are
 * small and kept. The store and manifests are removed only by Clear. The exports' work folders are outside both (an export may be
 * writing into one); one left over by a crash is swept with the budget check once it is an hour old (`sweepStaleWork`, PREV-198).
 */
import { lstat, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { usedThisSession } from "./game-asset-export";
import { hostClock } from "./platform/graph-adapters/host-sources";

export type PreparedRoots = { exports: string; resolver: string; store: string; manifests: string;
  /** Choice previews (`images/*.webp`, `sources/*.json`): evicted with the budget; their size is counted and cleared by their store. */
  previews?: string };
/** Default budget for exports and extracted JSON together. */
export const PREPARED_BUDGET_BYTES = 8 * 1024 ** 3;
export type PreparedSize = { bytes: number; exports: number; resolver: number; store: number; manifests: number };

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

/** The prepared files' size on disk, by kind. */
export async function preparedSize(roots: PreparedRoots): Promise<PreparedSize> {
  const [exports, resolver, store, manifests] = await Promise.all([folderBytes(roots.exports, exportsSkip), folderBytes(join(roots.resolver, "json"), name => !name.endsWith(".json")),
    folderBytes(roots.store), folderBytes(roots.manifests)]);
  return { bytes: exports + resolver + store + manifests, exports, resolver, store, manifests };
}

type Evictable = { path: string; usedMs: number; bytes: number; folder: boolean };
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
async function jsonEntries(root: string): Promise<Evictable[]> { return fileEntries(join(root, "json"), ".json"); }
/** Choice preview images and sources, file by file. */
async function previewEntries(root: string | undefined): Promise<Evictable[]> {
  if (!root) return [];
  return [...await fileEntries(join(root, "images"), ".webp"), ...await fileEntries(join(root, "sources"), ".json")];
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

/**
 * Keep exports, extracted JSON and choice previews within `budget` bytes: the least recently used go first, never one this process used. Returns what was
 * removed and the size after. Under budget (the usual case) it only counts their size: nothing is listed entry by entry (PREV-125).
 */
export async function evictPrepared(roots: PreparedRoots, budget = PREPARED_BUDGET_BYTES): Promise<{ removed: number; freed: number; bytes: number }> {
  await sweepStaleWork(roots.exports);
  const counted = (await Promise.all([folderBytes(roots.exports, exportsSkip), folderBytes(join(roots.resolver, "json"), name => !name.endsWith(".json")),
    roots.previews ? folderBytes(roots.previews, name => name.endsWith(".tmp")) : 0]))
    .reduce((sum, bytes) => sum + bytes, 0);
  if (counted <= budget) return { removed: 0, freed: 0, bytes: counted };
  const entries = [...await exportEntries(roots.exports), ...await jsonEntries(roots.resolver), ...await previewEntries(roots.previews)];
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0), removed = 0, freed = 0;
  if (bytes <= budget) return { removed, freed, bytes };
  entries.sort((a, b) => a.usedMs - b.usedMs);
  for (const entry of entries) {
    if (bytes <= budget) break;
    if (usedThisSession(entry.folder ? join(entry.path, "entry.json") : entry.path)) continue;
    if (entry.folder) { if (!await removeTree(entry.path)) continue; }
    else try { await limited(() => rm(entry.path, { force: true })); } catch { continue; }
    bytes -= entry.bytes; freed += entry.bytes; removed++;
  }
  return { removed, freed, bytes };
}

/**
 * Remove every prepared file (exports, extracted JSON, the preview's store and the manifests). The caller forgets what it derived from
 * them (the preparation caches, the served states), so the next preparation reads the game files again. Folders a running WolvenKit
 * writes into are skipped when they can't be removed.
 */
export async function clearPrepared(roots: PreparedRoots): Promise<{ freed: number }> {
  const before = await preparedSize(roots);
  const remove = async (path: string) => { await removeTree(path); /* What is in use is kept. */ };
  const children = async (folder: string, keep: (name: string) => boolean = () => false) => {
    let names: string[];
    try { names = await limited(() => readdir(folder)); } catch { return; }
    await eachBounded(names.filter(name => !keep(name)).map(name => join(folder, name)), remove);
  };
  await Promise.all([children(roots.exports, name => name.startsWith(".work-")), children(join(roots.resolver, "json"), name => name.endsWith(".failed")),
    children(join(roots.resolver, "native")),
    children(roots.store), children(roots.manifests)]);
  const after = await preparedSize(roots);
  return { freed: Math.max(0, before.bytes - after.bytes) };
}
