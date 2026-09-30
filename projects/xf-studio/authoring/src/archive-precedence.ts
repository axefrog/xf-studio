/**
 * Archive mount order and per-resource precedence (knowledge/mod-loading.md, rule R1). Pure: callers pass
 * the physical files a source scan found and each archive's index hashes; nothing here knows about mods.
 *
 * Model, in lookup order (first provider of a hash wins):
 * 1. `archive/pc/mod/*.archive` — the game's mod group. Order: a visible `archive/pc/mod/modlist.txt`
 *    first-to-last, else first-alphabetical [source: MO2 basic_games Cyberpunk plugin and its maintainers'
 *    load-order guide; WolvenKit ArchiveManager searches mods first]. Native REDengine order is unread.
 * 2. ArchiveXL extra mod groups: its `red4ext/plugins/ArchiveXL/Bundle` directory, inserted as a Mod-scope
 *    group before the first non-mod group [source: ArchiveXL 1.27.3 ArchiveService::ResolveArchiveGroup].
 * 3. `archive/pc/ep1` when Phantom Liberty is installed, then 4. `archive/pc/content`
 *    [source: WolvenKit ArchiveManager.Lookup searches EP1 before base; native order unread].
 * Before any of this, an MO2 virtual path is collapsed to one physical file: overwrite, then the first
 * `modlist.txt` row [source: MO2 2.5.2 profile.cpp, see mo2-instance.ts]; an MO2 file over a physical
 * game-folder file is a hypothesis (MO2's VFS overlays the game folder).
 */
import { type Ambiguity, type RuleNote, note } from "./resolution-evidence";

export type ArchiveProvider = "game" | "manual" | "mo2-mod" | "mo2-overwrite";
/** One physical `.archive` (or loose modlist) file as found by source discovery. */
export interface ArchiveFile extends VirtualCopy {
  readonly id: string;
  /** Path relative to the game root, forward slashes, case preserved. */
  readonly virtualPath: string;
  readonly provider: ArchiveProvider;
  readonly providerName: string;
  readonly active: boolean;
  /** MO2 priority (larger wins); null outside MO2. */
  readonly priority: number | null;
}

export type MountGroup = "mod" | "archivexl-bundle" | "ep1" | "content";
const GROUP_ORDER: readonly MountGroup[] = ["mod", "archivexl-bundle", "ep1", "content"];

export interface MountedArchive {
  readonly id: string;
  readonly name: string;
  readonly virtualPath: string;
  readonly group: MountGroup;
  readonly provider: ArchiveProvider;
  readonly providerName: string;
  /** Global lookup rank: 0 is searched first. */
  readonly rank: number;
  /** Physical files hidden behind this virtual path (inactive or lower-priority MO2 copies). */
  readonly shadowed: readonly ArchiveFile[];
}

export interface UnmountedArchive { readonly file: ArchiveFile; readonly reason: string }

export interface MountPlan {
  readonly archives: readonly MountedArchive[];
  readonly unmounted: readonly UnmountedArchive[];
  readonly ep1Installed: boolean;
  readonly modOrder: "modlist" | "alphabetical";
  readonly rules: readonly RuleNote[];
  readonly ambiguities: readonly Ambiguity[];
}

const lower = (value: string) => value.toLowerCase();
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** Case-insensitive ordinal comparison, the order MO2's guide describes as "alphabetical". */
export const alphabetical = (a: string, b: string) => { const x = lower(a), y = lower(b); return x < y ? -1 : x > y ? 1 : 0; };
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** One copy of a virtual file (an archive, an `.xl`, a tweak, a framework's file): who provides it and, in MO2, at what priority. */
export interface VirtualCopy {
  readonly id: string;
  readonly provider: ArchiveProvider;
  readonly providerName: string;
  readonly active: boolean;
  /** MO2 priority (larger wins); null outside MO2. */
  readonly priority: number | null;
}

const providerRank = (copy: VirtualCopy) => copy.provider.startsWith("mo2-") ? 0 : copy.provider === "game" ? 1 : 2;
/**
 * The one order in which copies of a virtual path shadow each other, visible first (knowledge/mod-loading.md, rule 1;
 * PIPE-06): active copies before disabled ones; MO2's (overwrite, then the first `modlist.txt` row, as priorities say)
 * before a physical copy [source: MO2 2.5.2 profile.cpp; over the game folder a hypothesis, since MO2's VFS overlays
 * it]; the game folder before a manual mod root [hypothesis]; then by id, so the answer never depends on scan order.
 */
export function compareCopies(a: VirtualCopy, b: VirtualCopy): number {
  return Number(b.active) - Number(a.active) || providerRank(a) - providerRank(b) || (b.priority ?? -1) - (a.priority ?? -1) || ordinal(a.id, b.id);
}

export interface VisibleCopy<T extends VirtualCopy> {
  /** The copy the game sees, or null when no copy is active. */
  readonly visible: T | null;
  /** Every other copy (disabled, or hidden behind the visible one). */
  readonly shadowed: readonly T[];
  /** Where the choice rests on a hypothesis. */
  readonly ambiguities: readonly Ambiguity[];
}

/** Which copy of one virtual path is visible, by `compareCopies`, with the ambiguities of that choice. */
export function visibleCopy<T extends VirtualCopy>(copies: readonly T[], subject: string): VisibleCopy<T> {
  const ordered = copies.slice().sort(compareCopies);
  const visible = ordered[0]?.active ? ordered[0] : null;
  const ambiguities: Ambiguity[] = [];
  if (visible) {
    const active = ordered.filter(copy => copy.active);
    const mo2 = active.filter(copy => copy.provider.startsWith("mo2-")), physical = active.filter(copy => !copy.provider.startsWith("mo2-"));
    if (mo2.length > 1 && mo2[0]!.priority === mo2[1]!.priority)
      ambiguities.push({ code: "vfs-equal-priority", subject, grade: "hypothesis", chosen: mo2[0]!.providerName,
        detail: "Two MO2 providers share a priority for one virtual path.", alternatives: mo2.slice(1).map(copy => copy.providerName) });
    if (mo2.length && physical.length)
      ambiguities.push({ code: "vfs-mo2-over-game-folder", subject, grade: "hypothesis", chosen: visible.providerName,
        alternatives: physical.map(copy => copy.providerName),
        detail: "An MO2 mod and a physical game-folder file provide the same virtual path; MO2's VFS is expected to overlay the game folder." });
    else if (physical.length > 1)
      ambiguities.push({ code: "vfs-game-manual-collision", subject, grade: "hypothesis", chosen: visible.providerName,
        alternatives: physical.slice(1).map(copy => copy.providerName), detail: "The game folder and a manual mod root both provide this path." });
  }
  return { visible, shadowed: ordered.filter(copy => copy !== visible), ambiguities };
}

function classify(virtualPath: string): MountGroup | { reason: string } {
  const path = lower(virtualPath);
  const parts = path.split("/");
  if (/^archive\/pc\/mod\/[^/]+\.archive$/.test(path)) return "mod";
  if (/^archive\/pc\/ep1\/[^/]+\.archive$/.test(path)) return "ep1";
  if (/^archive\/pc\/content\/[^/]+\.archive$/.test(path)) return "content";
  if (/^red4ext\/plugins\/archivexl\/bundle\/[^/]+\.archive$/.test(path)) return "archivexl-bundle";
  if (path.startsWith("archive/pc/mod/")) return { reason: "Archive in a subfolder of archive/pc/mod; whether the game mounts it is unmodelled." };
  if (path.startsWith("archive/pc/hot/")) return { reason: "archive/pc/hot (hot-reload folder) mount order is unmodelled." };
  if (parts[0] === "mods") return { reason: "REDmod archives are a later adapter." };
  if (parts[0] === "red4ext") return { reason: "Plugin-registered archive outside ArchiveXL's bundle; registration is unmodelled." };
  return { reason: "Not a mounted archive location." };
}

/**
 * Parse `archive/pc/mod/modlist.txt`: one archive file name per line, first line wins
 * [source: MO2 basic_games plugin writes this list; its guide says first listed wins].
 */
export function parseArchiveModlist(text: string): string[] {
  return text.replace(/^﻿/, "").split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("#")).map(lower);
}

/** Collapse virtual paths to their visible physical file and order the mounted archives. */
export function buildMountPlan(files: readonly ArchiveFile[], modlistText: string | null): MountPlan {
  const ambiguities: Ambiguity[] = [];
  const unmounted: UnmountedArchive[] = [];
  const rules: RuleNote[] = [
    note("vfs-mo2-priority", "source", "MO2 2.5.2 profile.cpp: overwrite, then the first modlist.txt row, wins a virtual path."),
    note("group-order", "source", "mod group, then ArchiveXL extra mod groups, then ep1, then content: WolvenKit ArchiveManager.Lookup and ArchiveXL ArchiveService insert order; native REDengine lookup not read."),
  ];
  const byVirtual = new Map<string, ArchiveFile[]>();
  for (const file of files) {
    if (!lower(file.virtualPath).endsWith(".archive")) continue;
    const key = lower(file.virtualPath);
    byVirtual.set(key, [...(byVirtual.get(key) ?? []), file]);
  }
  const visible: { file: ArchiveFile; shadowed: ArchiveFile[] }[] = [];
  for (const [key, copies] of byVirtual) {
    const chosen = visibleCopy(copies, key);
    if (!chosen.visible) { for (const file of copies) unmounted.push({ file, reason: "Disabled in the selected MO2 profile." }); continue; }
    ambiguities.push(...chosen.ambiguities);
    visible.push({ file: chosen.visible, shadowed: [...chosen.shadowed] });
  }

  const listed = modlistText === null ? null : parseArchiveModlist(modlistText);
  const modOrder: MountPlan["modOrder"] = listed ? "modlist" : "alphabetical";
  rules.push(listed
    ? note("mod-order-modlist", "source", "A visible archive/pc/mod/modlist.txt orders listed archives first-to-last; unlisted archives follow alphabetically (unlisted placement is a hypothesis).")
    : note("mod-order-alphabetical", "source", "MO2 basic_games Cyberpunk guide: without modlist.txt the first archive in alphabetical order wins; native collation unread, case-insensitive ordinal used."));

  const grouped = new Map<MountGroup, { file: ArchiveFile; shadowed: ArchiveFile[] }[]>();
  for (const entry of visible) {
    const group = classify(entry.file.virtualPath);
    if (typeof group !== "string") { unmounted.push({ file: entry.file, reason: group.reason }); continue; }
    grouped.set(group, [...(grouped.get(group) ?? []), entry]);
  }
  const ep1Installed = (grouped.get("ep1") ?? []).length > 0;
  const modKey = (name: string) => {
    const index = listed ? listed.indexOf(lower(name)) : -1;
    return index < 0 ? (listed ? listed.length : 0) : index;
  };
  const archives: MountedArchive[] = [];
  for (const group of GROUP_ORDER) {
    const entries = (grouped.get(group) ?? []).slice().sort((a, b) => {
      const an = baseName(a.file.virtualPath), bn = baseName(b.file.virtualPath);
      if (group === "mod" && listed) return modKey(an) - modKey(bn) || alphabetical(an, bn);
      return alphabetical(an, bn) || ordinal(a.file.virtualPath, b.file.virtualPath);
    });
    for (const entry of entries) archives.push({ id: entry.file.id, name: baseName(entry.file.virtualPath),
      virtualPath: entry.file.virtualPath, group, provider: entry.file.provider, providerName: entry.file.providerName,
      rank: archives.length, shadowed: entry.shadowed });
  }
  if (listed) {
    const names = new Set((grouped.get("mod") ?? []).map(entry => lower(baseName(entry.file.virtualPath))));
    const missing = listed.filter(name => !names.has(name));
    if (missing.length) ambiguities.push({ code: "modlist-names-missing", subject: "archive/pc/mod/modlist.txt", grade: "resource",
      detail: `${missing.length} listed archive name(s) are not visible in the mod group.` });
  }
  return { archives, unmounted, ep1Installed, modOrder, rules, ambiguities };
}

export interface DepotCandidate { readonly archive: MountedArchive }
export interface DepotLookup {
  readonly hash: string;
  readonly winner: MountedArchive | null;
  /** Every mounted provider, in lookup order (winner first). */
  readonly candidates: readonly MountedArchive[];
  readonly rule: RuleNote;
  readonly ambiguities: readonly Ambiguity[];
}

function contains(sorted: BigUint64Array, value: bigint): boolean {
  let low = 0, high = sorted.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1, item = sorted[mid]!;
    if (item === value) return true;
    if (item < value) low = mid + 1; else high = mid - 1;
  }
  return false;
}

/** Answers "which mounted archive supplies this hash" over indexes the adapter read (sorted ascending). */
export class DepotIndex {
  constructor(readonly plan: MountPlan, private readonly indexes: ReadonlyMap<string, BigUint64Array>) {}

  /** Does this mounted archive's own index list the hash? False when its index was not read. */
  archiveContains(archiveId: string, hash: string): boolean {
    const index = this.indexes.get(archiveId);
    return !!index && contains(index, BigInt(hash));
  }

  /** Does any mounted archive's index list the hash? `lookup(hash).winner !== null` without gathering every provider. */
  has(hash: string): boolean {
    const value = BigInt(hash);
    return this.plan.archives.some(archive => {
      const index = this.indexes.get(archive.id);
      return !!index && contains(index, value);
    });
  }

  lookup(hash: string): DepotLookup {
    const value = BigInt(hash);
    const candidates = this.plan.archives.filter(archive => {
      const index = this.indexes.get(archive.id);
      return !!index && contains(index, value);
    });
    const ambiguities: Ambiguity[] = [];
    const winner = candidates[0] ?? null;
    if (!winner) return { hash, winner, candidates, ambiguities,
      rule: note("absent", "resource", "No mounted archive index contains this hash.") };
    if (candidates.length === 1) return { hash, winner, candidates, ambiguities,
      rule: note("single-provider", "resource", `Only ${winner.name} (${winner.group}) indexes this hash.`) };
    const second = candidates[1]!;
    let rule: RuleNote;
    if (winner.group !== second.group) {
      rule = note(`${winner.group}-over-${second.group}`, "source",
        `${winner.name} (${winner.group}) is searched before ${second.name} (${second.group}); tool-source group order, native lookup unread.`);
      if ((winner.group === "mod" || winner.group === "archivexl-bundle") && candidates.some(c => c.group === "ep1" || c.group === "content"))
        ambiguities.push({ code: "mod-over-base-native-unread", subject: hash, grade: "source", chosen: winner.name,
          alternatives: candidates.filter(c => c.group === "ep1" || c.group === "content").map(c => c.name),
          detail: "A mod archive replaces a base-game resource: WolvenKit and ArchiveXL order mods first, but REDengine's own lookup is unread." });
    } else if (winner.group === "mod") {
      rule = note(this.plan.modOrder === "modlist" ? "mod-order-modlist" : "mod-order-alphabetical", "source",
        `${winner.name} precedes ${second.name} in the mod group (${this.plan.modOrder}); tool-source rule, native order unread.`);
      const sameGroup = candidates.filter(c => c.group === "mod");
      const names = sameGroup.map(c => c.name);
      if (new Set(names.map(lower)).size < names.length)
        ambiguities.push({ code: "duplicate-archive-basename", subject: hash, grade: "hypothesis", chosen: winner.id,
          detail: "Two mounted mod archives share a file name; their relative order is unknown.", alternatives: sameGroup.slice(1).map(c => c.id) });
      if (this.plan.modOrder === "alphabetical" && ordinal(winner.name, second.name) > 0)
        ambiguities.push({ code: "collation-sensitive-order", subject: hash, grade: "hypothesis", chosen: winner.name,
          alternatives: [second.name], detail: "Case-insensitive and ordinal (case-sensitive) collation disagree on which archive is first." });
    } else {
      rule = note(`${winner.group}-internal`, "hypothesis", `Several ${winner.group} archives index this hash; alphabetical first assumed.`);
      ambiguities.push({ code: "base-internal-collision", subject: hash, grade: "hypothesis", chosen: winner.name,
        alternatives: candidates.slice(1).filter(c => c.group === winner.group).map(c => c.name),
        detail: `Base-game ${winner.group} archives collide; their internal order is unread.` });
    }
    return { hash, winner, candidates, rule, ambiguities };
  }
}
