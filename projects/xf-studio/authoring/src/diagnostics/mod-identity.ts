/**
 * Which mods a problem involves, identified well enough to reproduce the setup without shipping their files (docs/diagnostics.md
 * §Your mod setup). From the load-order winners the rolling window recorded, every archive that supplied or lost a resource the
 * V used is traced back to the mod that provides it, with:
 *
 * - the mod's name, version and source where the mod manager recorded one (MO2 `meta.ini`: `modid`, `fileid`, `version`,
 *   `installationFile`, `repository`, `url`; for a Vortex mod, the Nexus mod and file IDs and version in Vortex's state, else its
 *   staging folder name from the deployment manifest: knowledge/vortex.md), else nothing;
 * - each archive's file name, size and SHA-256, so the identical file can be fetched and checked.
 *
 * **The game folder is not one mod (DIAG-05).** Source discovery names everything in the game folder "Installed game". Its base-game
 * archives (`content`, `ep1`) become the one "Cyberpunk 2077" entry, identified by the game's version and never located or hashed;
 * an archive Vortex deployed goes with its Vortex mod; every other archive there is its own entry, since nothing records which mod
 * put it there. Archives are looked for only where the game loads them (`archive/pc/mod`, REDmod's `mods/`), never by walking the
 * whole game folder.
 *
 * **Hashing is bounded in time (DIAG-11).** Archives are hashed smallest first within `hashBudgetMs`; the rest are identified by size
 * and date, and hashed afterwards in the background, one at a time, so preparing the report again includes them. Progress is reported
 * as it goes.
 *
 * A mod with a Nexus Mods mod and file ID is **re-downloadable**; one with only a mod ID or a page is **findable**; anything else is
 * **local only**, and only a small local-only mod may be offered, unticked, for inclusion (`MOD_FILE_LIMIT`). Host-only (reads files).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { LocalSettings } from "../local-settings";
import { describeMo2Instance, parseQSettingsIni } from "../mo2-instance";
import { inspectVortexSetup, readVortexManifests, type VortexSetup } from "../vortex-host";

/** A local-only mod may be offered for inclusion up to this size (all its involved archives together). */
export const MOD_FILE_LIMIT = 5 * 1024 * 1024;
/** A report file's whole size limit (under GitHub's 25 MB attachment limit). */
export const REPORT_LIMIT = 20 * 1024 * 1024;
/** Archives larger than this, or beyond the total, are identified by size and date instead of hashed. */
const HASH_FILE_LIMIT = 2 * 1024 ** 3;
const HASH_TOTAL_LIMIT = 6 * 1024 ** 3;
/** How long one report spends hashing before it identifies the rest by size and date. */
export const HASH_BUDGET_MS = 10_000;
/** The game folder's provider name in source discovery, and the base game's entry. */
const GAME = "Installed game", BASE_GAME = "\u0000base-game", GAME_FILE = "\u0000game-file\u0000";

export type ModStatus = "re-downloadable" | "findable" | "local-only" | "base-game";
export type ModSource = { site: "nexusmods"; modId: string | null; fileId: string | null; url: string | null; installationFile: string | null }
  | { site: "other"; url: string | null; repository: string | null; installationFile: string | null }
  | { site: "vortex"; staging: string; modId: string | null };
export type InvolvedArchive = { name: string; group: string | null; bytes: number | null; sha256: string | null; modified: string | null;
  /** How many of the V's resources it supplied, and how many it lost to another archive. */
  won: number; lost: number;
  /** How the report identifies it: its SHA-256, its size and date (too large, or out of time), the game's version, or not found. */
  identifiedBy: "sha-256" | "size and date" | "game version" | "not found";
  /** Private: where it is, for the report's optional file; never sent to the page. */
  path: string | null };
export type IdentityOptions = {
  /** Time for hashing in this call (default `HASH_BUDGET_MS`); what doesn't fit is hashed later in the background. */
  hashBudgetMs?: number;
  /** Called as archives are hashed: how many are done of how many need it. */
  progress?: (done: number, total: number) => void;
  now?: () => number;
};
export type InvolvedMod = { name: string; kind: "mo2-mod" | "mo2-overwrite" | "vortex-mod" | "game-folder" | "manual" | "base-game" | "unknown";
  version: string | null; source: ModSource | null; status: ModStatus; archives: InvolvedArchive[] };

type Winner = { archive: unknown; provider: unknown; group: unknown; alternatives: unknown };
const ALTERNATIVE = /^(.+?) \(([a-z0-9-]+), (.+)\)$/i;

/** The mods behind a resolution's winners and losers, each archive counted once. */
export async function involvedMods(winners: readonly Winner[] | null, settings: LocalSettings | null,
  env: (name: string) => string | undefined = name => process.env[name], options: IdentityOptions = {}): Promise<InvolvedMod[]> {
  if (!winners) return [];
  const mo2 = mo2Folders(settings);
  // Vortex's state is read only for a game folder Vortex has deployed into.
  const vortex = settings?.gameRoot && readVortexManifests(settings.gameRoot).deployment ? inspectVortexSetup(settings.gameRoot, env) : null;
  // Source discovery names a Vortex-deployed file's provider after its Vortex mod (the manifest's `source`).
  const vortexMods = new Set([...(vortex?.deployment?.byPath.values() ?? [])].map(entry => entry.file.source));
  /** Which entry an archive belongs to: its provider, except in the game folder (see the module note). */
  const entryOf = (provider: string, archive: string, group: string | null) => {
    if (provider !== GAME) return provider;
    if (group === "content" || group === "ep1") return BASE_GAME;
    const staging = vortex?.deployment?.byPath.get(`archive/pc/mod/${archive}`.toLowerCase())?.file.source;
    if (staging) { vortexMods.add(staging); return staging; }
    return `${GAME_FILE}${archive}`;
  };
  const byMod = new Map<string, { group: string | null; archives: Map<string, { group: string | null; won: number; lost: number }> }>();
  const add = (provider: string, archive: string, group: string | null, won: boolean) => {
    const key = entryOf(provider, archive, group);
    let mod = byMod.get(key);
    if (!mod) { mod = { group, archives: new Map() }; byMod.set(key, mod); }
    const entry = mod.archives.get(archive) ?? { group, won: 0, lost: 0 };
    if (won) entry.won++; else entry.lost++;
    mod.archives.set(archive, entry);
  };
  for (const winner of winners) {
    if (typeof winner.archive === "string" && typeof winner.provider === "string")
      add(winner.provider, winner.archive, typeof winner.group === "string" ? winner.group : null, true);
    for (const text of Array.isArray(winner.alternatives) ? winner.alternatives : []) {
      const match = typeof text === "string" ? ALTERNATIVE.exec(text) : null;
      if (match) add(match[3]!, match[1]!, match[2]!, false);
    }
  }
  const mods: InvolvedMod[] = [];
  const stamps = new Map<InvolvedArchive, number>();
  for (const [name, mod] of [...byMod].sort(([a], [b]) => a.localeCompare(b))) {
    const kind = name === BASE_GAME ? "base-game" : name.startsWith(GAME_FILE) ? "game-folder" : vortexMods.has(name) ? "vortex-mod" : modKind(name, mo2);
    const meta = kind === "mo2-mod" && mo2 ? readMeta(join(mo2.mods, name)) : null;
    const archives: InvolvedArchive[] = [];
    for (const [archive, entry] of [...mod.archives].sort(([a], [b]) => a.localeCompare(b))) {
      // The base game's archives are identified by the game's version: never located, never hashed.
      const path = kind === "base-game" ? null : locate(kind, name, archive, settings, mo2);
      let bytes: number | null = null, modified: string | null = null, stamp = 0;
      if (path) try { const stat = statSync(path); bytes = stat.size; modified = new Date(stat.mtimeMs).toISOString(); stamp = stat.mtimeMs; }
      catch { /* Reported without size. */ }
      const item: InvolvedArchive = { name: archive, group: entry.group, bytes, sha256: null, modified, won: entry.won, lost: entry.lost,
        identifiedBy: kind === "base-game" ? "game version" : bytes === null ? "not found" : "size and date", path: bytes === null ? null : path };
      if (bytes !== null) stamps.set(item, stamp);
      archives.push(item);
    }
    const staging = kind === "vortex-mod" ? name : null;
    const identity = staging ? vortex?.state?.game.mods.get(staging) ?? null : null;
    const source = meta ? metaSource(meta) : staging ? vortexSource(staging, identity) : null;
    const status: ModStatus = kind === "base-game" ? "base-game"
      : source?.site === "nexusmods" && source.modId && source.fileId ? "re-downloadable"
      : source && (source.site === "vortex" ? source.modId : source.site === "nexusmods" ? source.modId || source.url : source.url || source.repository) ? "findable"
      : "local-only";
    mods.push({ name: kind === "base-game" ? "Cyberpunk 2077 (the game's own files)" : kind === "game-folder" ? `${name.slice(GAME_FILE.length)} (in the game folder)`
      : kind === "vortex-mod" ? identity?.name ?? name : name, kind,
      version: meta?.get("version") || identity?.version || null, source, status, archives });
  }
  await fingerprint(stamps, options);
  return mods;
}

/**
 * Hash the located archives, smallest first, within the time budget (DIAG-11). Known hashes (same path, size and date) cost nothing;
 * what doesn't fit keeps its size and date here and is hashed in the background for the next report.
 */
async function fingerprint(stamps: Map<InvolvedArchive, number>, options: IdentityOptions) {
  const now = options.now ?? Date.now, started = now(), budget = options.hashBudgetMs ?? HASH_BUDGET_MS;
  let total = 0;
  const wanted = [...stamps].filter(([item]) => item.bytes! <= HASH_FILE_LIMIT).sort(([a], [b]) => a.bytes! - b.bytes!)
    .filter(([item]) => (total += item.bytes!) <= HASH_TOTAL_LIMIT);
  let done = 0;
  options.progress?.(0, wanted.length);
  for (const [item, stamp] of wanted) {
    const key = hashKey(item.path!, item.bytes!, stamp);
    const known = hashes.get(key);
    if (known) item.sha256 = known;
    else if (now() - started < budget) {
      try { item.sha256 = await sha256Of(item.path!, item.bytes!, stamp); } catch { /* Unreadable now: size and date. */ }
    } else hashLater(item.path!, item.bytes!, stamp);
    if (item.sha256) item.identifiedBy = "sha-256";
    options.progress?.(++done, wanted.length);
  }
}

function modKind(name: string, mo2: ReturnType<typeof mo2Folders>): InvolvedMod["kind"] {
  if (name === "Manual files") return "manual";
  if (mo2 && existsSync(join(mo2.mods, name))) return "mo2-mod";
  if (mo2 && /overwrite/i.test(name)) return "mo2-overwrite";
  return "unknown";
}

function mo2Folders(settings: LocalSettings | null) {
  if (!settings?.mo2Root) return null;
  let ini: string | null = null;
  try { ini = readFileSync(join(settings.mo2Root, "ModOrganizer.ini"), "utf8"); } catch { /* Default layout. */ }
  const { paths } = describeMo2Instance(ini, settings.mo2Root, "configured", "instance");
  return { mods: paths.mods, overwrite: paths.overwrite };
}

function readMeta(folder: string): Map<string, string> | null {
  try { return parseQSettingsIni(readFileSync(join(folder, "meta.ini"), "utf8")).get("general") as Map<string, string> ?? null; }
  catch { return null; }
}
function metaSource(meta: Map<string, string>): ModSource | null {
  const text = (key: string) => { const value = meta.get(key)?.trim(); return value && value !== "0" && value !== "-1" ? value : null; };
  const repository = text("repository"), url = text("url"), modId = text("modid"), installationFile = text("installationfile");
  const fileId = text("fileid") ?? nexusFileIdFromNxm(meta);
  if ((repository ?? "Nexus").toLowerCase() === "nexus" && (modId || fileId))
    return { site: "nexusmods", modId, fileId, url: url ?? (modId ? `https://www.nexusmods.com/cyberpunk2077/mods/${modId}` : null),
      installationFile: installationFile ? basename(installationFile.replace(/\\/g, "/")) : null };
  if (repository || url || installationFile)
    return { site: "other", url, repository, installationFile: installationFile ? basename(installationFile.replace(/\\/g, "/")) : null };
  return null;
}
/** Some MO2 versions keep the file ID only in the `[installedFiles]` list (`1\fileid=…`). */
function nexusFileIdFromNxm(meta: Map<string, string>): string | null {
  for (const [key, value] of meta) if (/fileid$/i.test(key) && /^\d+$/.test(value) && value !== "0") return value;
  return null;
}

type VortexIdentity = NonNullable<VortexSetup["state"]>["game"]["mods"] extends ReadonlyMap<string, infer T> ? T : never;
/**
 * A Vortex mod's source. Vortex records the Nexus Mods mod and file IDs of a download in its state (knowledge/vortex.md §3); without
 * readable state, the staging folder name is the downloaded archive's name, and a Nexus download is named
 * `<name>-<mod id>-<version parts>-<upload time>`. That is a naming convention, not a Vortex record, so the mod ID is taken from it only
 * when the name ends in such a time (nine or more digits), and it is reported as the staging name's, never as a file ID.
 */
function vortexSource(staging: string, identity: VortexIdentity | null): ModSource {
  const nexus = identity?.nexus;
  if (nexus && (nexus.modId || nexus.fileId)) {
    const modId = nexus.modId ? String(nexus.modId) : null;
    return { site: "nexusmods", modId, fileId: nexus.fileId ? String(nexus.fileId) : null,
      url: modId ? `https://www.nexusmods.com/${nexus.gameDomain ?? "cyberpunk2077"}/mods/${modId}` : null, installationFile: null };
  }
  return { site: "vortex", staging, modId: /-(\d+)(?:-\d+)*-\d{9,}$/.exec(staging)?.[1] ?? null };
}

/**
 * Where an involved archive is. A mod folder (MO2) is small and searched whole, bounded; the game and manual folders only where the
 * game loads archives from: `archive/pc/mod` (and a level or two below it) and REDmod's `mods/<mod>/archives`.
 */
function locate(kind: InvolvedMod["kind"], name: string, archive: string, settings: LocalSettings | null, mo2: ReturnType<typeof mo2Folders>): string | null {
  if (kind === "mo2-mod" && mo2) return findFile(join(mo2.mods, name), archive);
  if (kind === "mo2-overwrite" && mo2) return findFile(mo2.overwrite, archive);
  const root = kind === "manual" ? settings?.manualModRoot : kind === "game-folder" || kind === "vortex-mod" ? settings?.gameRoot : null;
  if (!root) return null;
  const direct = join(root, "archive", "pc", "mod", archive);
  if (existsSync(direct)) return direct;
  return searchFile(join(root, "archive", "pc", "mod"), archive.toLowerCase(), 2) ?? searchFile(join(root, "mods"), archive.toLowerCase(), 3);
}
function searchFile(folder: string, lower: string, depth: number): string | null {
  let entries: import("node:fs").Dirent[] = [];
  try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase() === lower) return join(folder, entry.name);
  if (depth <= 0) return null;
  for (const entry of entries.slice(0, 200)) if (entry.isDirectory()) {
    const found = searchFile(join(folder, entry.name), lower, depth - 1);
    if (found) return found;
  }
  return null;
}

/** A file by name under a mod's folder (archives live in `archive/pc/mod`, sometimes deeper), bounded. */
function findFile(root: string, name: string, depth = 0): string | null {
  if (depth > 6) return null;
  const direct = join(root, "archive", "pc", "mod", name);
  if (depth === 0 && existsSync(direct)) return direct;
  let entries: import("node:fs").Dirent[] = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const lower = name.toLowerCase();
  for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase() === lower) return join(root, entry.name);
  for (const entry of entries.slice(0, 200)) if (entry.isDirectory()) {
    const found = findFile(join(root, entry.name), name, depth + 1);
    if (found) return found;
  }
  return null;
}

const hashes = new Map<string, string>();
const hashKey = (path: string, size: number, modified: number) => `${path}|${size}|${modified}`;
/** Archives waiting to be hashed in the background, one at a time (at most `LATER_MAX` waiting). */
const later = new Map<string, () => Promise<unknown>>();
const LATER_MAX = 500;
let draining: Promise<void> | null = null;
function hashLater(path: string, size: number, modified: number) {
  const key = hashKey(path, size, modified);
  if (hashes.has(key) || later.has(key) || later.size >= LATER_MAX) return;
  later.set(key, () => sha256Of(path, size, modified));
  draining ??= (async () => {
    while (later.size) {
      const [next, work] = later.entries().next().value!;
      try { await work(); } catch { /* Unreadable: it stays identified by size and date. */ }
      later.delete(next);
    }
    draining = null;
  })();
}
/** Wait for the background hashing (tests). */
export const hashingSettled = async () => { while (draining) await draining; };
async function sha256Of(path: string, size: number, modified: number): Promise<string> {
  const key = hashKey(path, size, modified);
  const known = hashes.get(key);
  if (known) return known;
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  const digest = hasher.digest("hex");
  hashes.set(key, digest);
  return digest;
}
