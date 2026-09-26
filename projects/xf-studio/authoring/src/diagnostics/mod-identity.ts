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
/** Archives larger than this are identified by size and date instead of hashed. */
const HASH_FILE_LIMIT = 2 * 1024 ** 3;
const HASH_TOTAL_LIMIT = 6 * 1024 ** 3;

export type ModStatus = "re-downloadable" | "findable" | "local-only" | "base-game";
export type ModSource = { site: "nexusmods"; modId: string | null; fileId: string | null; url: string | null; installationFile: string | null }
  | { site: "other"; url: string | null; repository: string | null; installationFile: string | null }
  | { site: "vortex"; staging: string; modId: string | null };
export type InvolvedArchive = { name: string; group: string | null; bytes: number | null; sha256: string | null; modified: string | null;
  /** How many of the V's resources it supplied, and how many it lost to another archive. */
  won: number; lost: number;
  /** Private: where it is, for the report's optional file; never sent to the page. */
  path: string | null };
export type InvolvedMod = { name: string; kind: "mo2-mod" | "mo2-overwrite" | "vortex-mod" | "game-folder" | "manual" | "base-game" | "unknown";
  version: string | null; source: ModSource | null; status: ModStatus; archives: InvolvedArchive[] };

type Winner = { archive: unknown; provider: unknown; group: unknown; alternatives: unknown };
const ALTERNATIVE = /^(.+?) \(([a-z0-9-]+), (.+)\)$/i;

/** The mods behind a resolution's winners and losers, each archive counted once. */
export async function involvedMods(winners: readonly Winner[] | null, settings: LocalSettings | null,
  env: (name: string) => string | undefined = name => process.env[name]): Promise<InvolvedMod[]> {
  if (!winners) return [];
  const byMod = new Map<string, { group: string | null; archives: Map<string, { group: string | null; won: number; lost: number }> }>();
  const add = (provider: string, archive: string, group: string | null, won: boolean) => {
    let mod = byMod.get(provider);
    if (!mod) { mod = { group, archives: new Map() }; byMod.set(provider, mod); }
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
  const mo2 = mo2Folders(settings);
  // Vortex's state is read only for a game folder Vortex has deployed into.
  const vortex = settings?.gameRoot && readVortexManifests(settings.gameRoot).deployment ? inspectVortexSetup(settings.gameRoot, env) : null;
  // Source discovery names a Vortex-deployed file's provider after its Vortex mod (the manifest's `source`).
  const vortexMods = new Set([...(vortex?.deployment?.byPath.values() ?? [])].map(entry => entry.file.source));
  let hashed = 0;
  const mods: InvolvedMod[] = [];
  for (const [name, mod] of [...byMod].sort(([a], [b]) => a.localeCompare(b))) {
    const kind = vortexMods.has(name) ? "vortex-mod" : modKind(name, mod.archives, mo2);
    const folder = kind === "mo2-mod" && mo2 ? join(mo2.mods, name) : kind === "mo2-overwrite" && mo2 ? mo2.overwrite
      : kind === "manual" && settings?.manualModRoot ? settings.manualModRoot
      : (kind === "game-folder" || kind === "vortex-mod") && settings?.gameRoot ? settings.gameRoot : null;
    const meta = kind === "mo2-mod" && folder ? readMeta(folder) : null;
    const archives: InvolvedArchive[] = [];
    for (const [archive, entry] of [...mod.archives].sort(([a], [b]) => a.localeCompare(b))) {
      const path = kind === "base-game" || !folder ? null : findFile(folder, archive);
      let bytes: number | null = null, modified: string | null = null, sha256: string | null = null;
      if (path) try {
        const stat = statSync(path);
        bytes = stat.size; modified = new Date(stat.mtimeMs).toISOString();
        if (stat.size <= HASH_FILE_LIMIT && hashed + stat.size <= HASH_TOTAL_LIMIT) { sha256 = await sha256Of(path, stat.size, stat.mtimeMs); hashed += stat.size; }
      } catch { /* Reported without size. */ }
      archives.push({ name: archive, group: entry.group, bytes, sha256, modified, won: entry.won, lost: entry.lost, path });
    }
    const staging = kind === "vortex-mod" ? name : kind === "game-folder"
      ? archives.map(item => vortex?.deployment?.byPath.get(`archive/pc/mod/${item.name}`.toLowerCase())?.file.source).find(Boolean) ?? null : null;
    const identity = staging ? vortex?.state?.game.mods.get(staging) ?? null : null;
    const source = meta ? metaSource(meta) : staging ? vortexSource(staging, identity) : null;
    const status: ModStatus = kind === "base-game" ? "base-game"
      : source?.site === "nexusmods" && source.modId && source.fileId ? "re-downloadable"
      : source && (source.site === "vortex" ? source.modId : source.site === "nexusmods" ? source.modId || source.url : source.url || source.repository) ? "findable"
      : "local-only";
    mods.push({ name: kind === "base-game" ? "Cyberpunk 2077 (the game's own files)" : kind === "vortex-mod" ? identity?.name ?? name : name, kind,
      version: meta?.get("version") || identity?.version || null, source, status, archives });
  }
  return mods;
}

function modKind(name: string, archives: Map<string, { group: string | null }>, mo2: ReturnType<typeof mo2Folders>): InvolvedMod["kind"] {
  const groups = [...archives.values()].map(item => item.group);
  if (name === "Installed game") return groups.every(group => group === "content" || group === "ep1") ? "base-game" : "game-folder";
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
async function sha256Of(path: string, size: number, modified: number): Promise<string> {
  const key = `${path}|${size}|${modified}`;
  const known = hashes.get(key);
  if (known) return known;
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  const digest = hasher.digest("hex");
  hashes.set(key, digest);
  return digest;
}
