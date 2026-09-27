/**
 * Host adapter: the game files XF Studio prepared for the 3D preview on this computer, their size, a disk budget and "Clear prepared
 * game files". Prepared files are derived from the player's own game and mods and are all re-creatable:
 * - `exports`: the game-asset exporter's cache (GLBs, textures, mask layers), one folder per resource and archive identity;
 * - `resolver`: the resolver's extracted JSON (`json/`), one file per resource, archive identity and WolvenKit identity, and the empty
 *   markers of resources the native reader answered (`native/`, resolver-host.ts `NativeAnswerFiles`);
 * - `store`: the content-addressed files and records the preview loads (`files/`, `records/`, `chunks/`);
 * - `manifests`: what each prepared request depended on (choice-manifest.ts).
 *
 * **Budget.** Exports and extracted JSON are kept within a byte budget by evicting the least recently used first (their use time is the
 * modification time of an export's `entry.json` or a JSON file, set when a cache hit uses it: game-asset-export.ts `touchUsed`).
 * Anything used by this process is never evicted, so a V on screen, its tried choices and a running preparation keep their files; the
 * budget can be exceeded by what this session uses, and eviction then stops. The resolver's failure markers, archive indexes and
 * creator texts are small and kept. The store and manifests are removed only by Clear.
 */
import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { usedThisSession } from "./game-asset-export";

export type PreparedRoots = { exports: string; resolver: string; store: string; manifests: string };
/** Default budget for exports and extracted JSON together. */
export const PREPARED_BUDGET_BYTES = 8 * 1024 ** 3;
export type PreparedSize = { bytes: number; exports: number; resolver: number; store: number; manifests: number };

/**
 * How many file-system calls the prepared files' checks keep in flight, all of them together (PREV-125): a size count walks every
 * prepared file (tens of thousands), and several walks at once (the prefetcher's count, the budget check after a batch or a change, a
 * folder per export entry) filled the runtime's I/O threads, so a person's request (reading a record, checking the mod setup) waited.
 */
export const PREPARED_FS_CONCURRENCY = 16;
let fsActive = 0;
const fsWaiting: (() => void)[] = [];
/** The most calls in flight at once so far (tests read it). */
export const preparedFsStats = { peak: 0 };
/** Run one file-system call within the shared bound; a finished call hands its slot straight to the next waiting one. */
async function limited<T>(call: () => Promise<T>): Promise<T> {
  if (fsActive >= PREPARED_FS_CONCURRENCY) await new Promise<void>(resolve => fsWaiting.push(resolve));
  else fsActive++;
  preparedFsStats.peak = Math.max(preparedFsStats.peak, fsActive);
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
async function jsonEntries(root: string): Promise<Evictable[]> {
  const folder = join(root, "json");
  let names: string[];
  try { names = await limited(() => readdir(folder)); } catch { return []; }
  const out: Evictable[] = [];
  await eachBounded(names.filter(name => name.endsWith(".json")), async name => {
    const path = join(folder, name);
    try { const info = await limited(() => stat(path)); out.push({ path, usedMs: info.mtimeMs, bytes: info.size, folder: false }); } catch { /* Gone. */ }
  });
  return out;
}

/**
 * Keep exports and extracted JSON within `budget` bytes: the least recently used go first, never one this process used. Returns what was
 * removed and the size after. Under budget (the usual case) it only counts their size: nothing is listed entry by entry (PREV-125).
 */
export async function evictPrepared(roots: PreparedRoots, budget = PREPARED_BUDGET_BYTES): Promise<{ removed: number; freed: number; bytes: number }> {
  const counted = (await Promise.all([folderBytes(roots.exports, exportsSkip), folderBytes(join(roots.resolver, "json"), name => !name.endsWith(".json"))]))
    .reduce((sum, bytes) => sum + bytes, 0);
  if (counted <= budget) return { removed: 0, freed: 0, bytes: counted };
  const entries = [...await exportEntries(roots.exports), ...await jsonEntries(roots.resolver)];
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0), removed = 0, freed = 0;
  if (bytes <= budget) return { removed, freed, bytes };
  entries.sort((a, b) => a.usedMs - b.usedMs);
  for (const entry of entries) {
    if (bytes <= budget) break;
    if (usedThisSession(entry.folder ? join(entry.path, "entry.json") : entry.path)) continue;
    try { await limited(() => rm(entry.path, { recursive: entry.folder, force: true })); } catch { continue; }
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
  const remove = async (path: string) => { try { await limited(() => rm(path, { recursive: true, force: true })); } catch { /* In use: kept. */ } };
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
