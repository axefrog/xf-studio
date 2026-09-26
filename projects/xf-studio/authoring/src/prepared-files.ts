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

async function folderBytes(root: string, skip: (name: string) => boolean = () => false): Promise<number> {
  let total = 0;
  const walk = async (folder: string): Promise<void> => {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async entry => {
      if (skip(entry.name)) return;
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) return;
      if (entry.isDirectory()) return walk(path);
      // Read first, then add: `total += await …` would add to the total as it was before the await.
      try { const bytes = (await lstat(path)).size; total += bytes; } catch { /* Gone meanwhile. */ }
    }));
  };
  await walk(root);
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
  try { names = await readdir(resources); } catch { return []; }
  const out: Evictable[] = [];
  await Promise.all(names.filter(name => !name.endsWith(".tmp") && !name.includes(".tmp")).map(async name => {
    const folder = join(resources, name);
    try {
      const used = await stat(join(folder, "entry.json"));
      out.push({ path: folder, usedMs: used.mtimeMs, bytes: await folderBytes(folder), folder: true });
    } catch { /* Not a published entry. */ }
  }));
  return out;
}
async function jsonEntries(root: string): Promise<Evictable[]> {
  const folder = join(root, "json");
  let names: string[];
  try { names = await readdir(folder); } catch { return []; }
  const out: Evictable[] = [];
  await Promise.all(names.filter(name => name.endsWith(".json")).map(async name => {
    const path = join(folder, name);
    try { const info = await stat(path); out.push({ path, usedMs: info.mtimeMs, bytes: info.size, folder: false }); } catch { /* Gone. */ }
  }));
  return out;
}

/**
 * Keep exports and extracted JSON within `budget` bytes: the least recently used go first, never one this process used. Returns what was
 * removed and the size after.
 */
export async function evictPrepared(roots: PreparedRoots, budget = PREPARED_BUDGET_BYTES): Promise<{ removed: number; freed: number; bytes: number }> {
  const entries = [...await exportEntries(roots.exports), ...await jsonEntries(roots.resolver)];
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0), removed = 0, freed = 0;
  if (bytes <= budget) return { removed, freed, bytes };
  entries.sort((a, b) => a.usedMs - b.usedMs);
  for (const entry of entries) {
    if (bytes <= budget) break;
    if (usedThisSession(entry.folder ? join(entry.path, "entry.json") : entry.path)) continue;
    try { await rm(entry.path, { recursive: entry.folder, force: true }); } catch { continue; }
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
  const remove = async (path: string) => { try { await rm(path, { recursive: true, force: true }); } catch { /* In use: kept. */ } };
  const children = async (folder: string, keep: (name: string) => boolean = () => false) => {
    let names: string[];
    try { names = await readdir(folder); } catch { return; }
    await Promise.all(names.filter(name => !keep(name)).map(name => remove(join(folder, name))));
  };
  await Promise.all([children(roots.exports, name => name.startsWith(".work-")), children(join(roots.resolver, "json"), name => name.endsWith(".failed")),
    children(join(roots.resolver, "native")),
    children(roots.store), children(roots.manifests)]);
  const after = await preparedSize(roots);
  return { freed: Math.max(0, before.bytes - after.bytes) };
}
