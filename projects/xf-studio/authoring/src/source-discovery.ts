import { lstatSync, opendirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseLocalSettings, type LocalSettings } from "./local-settings";
import { describeMo2Instance, parseMo2Modlist } from "./mo2-instance";

/** Physical inventory only. An archive has no known depot members until an index adapter examines it. */
export type SourceFileKind = "archive" | "archive-xl" | "loose-customization" | "archive-modlist";
export type SourceProviderKind = "game" | "manual" | "mo2-mod" | "mo2-overwrite";
export type SourceConfidence = "observed" | "source-derived" | "ambiguous" | "unknown";

export interface SourceCandidate {
  readonly id: string;
  readonly provider: SourceProviderKind;
  readonly providerName: string;
  readonly route: "direct" | "mo2";
  readonly profileId: string | null;
  /** Case-preserving path relative to the game's virtual root, with forward slashes. */
  readonly virtualPath: string;
  /** Absolute local file path. Private host metadata; never serialize into a portable collection. */
  readonly physicalPath: string;
  readonly kind: SourceFileKind;
  readonly active: boolean;
  readonly priority: number | null;
  readonly priorityEvidence: string | null;
  readonly sizeBytes: number;
  readonly modifiedMs: number;
  /** Absent until a separate, bounded fingerprint/index stage reads the file. */
  readonly sha256: null;
  readonly discoveredAt: string;
  readonly limitations: readonly string[];
}

/**
 * A blocking issue makes the scan incomplete; a non-blocking one records MO2's own deterministic handling.
 * `mayHideSources` is false only when the issue concerns one skipped entry known not to be (or hold) an
 * archive, `.xl` or modlist file, e.g. a symbolic link to a text file.
 */
export interface SourceIssue { readonly code: string; readonly detail: string; readonly blocking: boolean; readonly mayHideSources?: boolean }
export interface LooseFileAssessment {
  readonly virtualPath: string;
  readonly contenders: readonly SourceCandidate[];
  /** Source-derived selected file, never a claim about a game launch. */
  readonly sourceDerivedFirst: SourceCandidate | null;
  readonly runtimeObservedWinner: null;
  readonly confidence: SourceConfidence;
  readonly reason: string;
}
export interface SourceDiscovery {
  readonly route: "direct" | "mo2";
  readonly profileId: string | null;
  readonly discoveredAt: string;
  readonly complete: boolean;
  readonly candidates: readonly SourceCandidate[];
  readonly looseFiles: readonly LooseFileAssessment[];
  readonly issues: readonly SourceIssue[];
  readonly limitations: readonly string[];
}
export interface ScanLimits {
  /** Total filesystem entries across every configured root. */
  readonly maxEntries?: number;
  readonly maxDepth?: number;
  readonly maxProfileBytes?: number;
}

const extensions: Record<string, SourceFileKind> = {
  ".archive": "archive", ".xl": "archive-xl", ".inkcharcustomization": "loose-customization",
};
const defaults = { maxEntries: 150_000, maxDepth: 12, maxProfileBytes: 4 * 1024 * 1024 };
const archiveLimit = "Archive members, hash winners, ArchiveXL patches/merges, REDmod, and actual game loading are unresolved.";
const safeName = (name: string) => name !== "." && name !== ".." && name.trim() === name &&
  !/[\\/:\x00-\x1f]/.test(name) && !name.endsWith(".") && name.length <= 255;
const iniBytes = 4 * 1024 * 1024;
const key = (path: string) => path.replaceAll("\\", "/").toLowerCase();
const portable = (path: string) => path.split(sep).join("/");
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const linkedAncestor = (path: string): boolean => {
  let current = resolve(path);
  while (true) {
    try { if (lstatSync(current).isSymbolicLink()) return true; }
    catch { /* a missing ancestor is reported by the caller */ }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};
const kindOf = (path: string): SourceFileKind | null => {
  if (key(path) === "archive/pc/mod/modlist.txt") return "archive-modlist";
  const lower = path.toLowerCase();
  return Object.entries(extensions).find(([suffix]) => lower.endsWith(suffix))?.[1] ?? null;
};

/** No data extraction, writes, or process launch. A fresh call re-reads the selected route. */
export function discoverSources(input: LocalSettings, requested: ScanLimits = {}): SourceDiscovery {
  const settings = parseLocalSettings(input);
  const limits = { ...defaults, ...requested };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1 || value > (name === "maxProfileBytes" ? 16 * 1024 * 1024 : 1_000_000))
      throw Error(`Invalid ${name} scan limit.`);
  const route = settings.launchRoute;
  const profileId = route === "mo2" ? settings.mo2ProfileId : null;
  const discoveredAt = new Date().toISOString();
  const candidates: SourceCandidate[] = [];
  const issues: SourceIssue[] = [];
  let entries = 0;
  let complete = true;
  const issue = (code: string, detail: string) => { issues.push({ code, detail, blocking: true }); complete = false; };
  const note = (code: string, detail: string) => { issues.push({ code, detail, blocking: false }); };
  let skipDirectories: readonly string[] = [];

  const scan = (root: string, provider: SourceProviderKind, providerName: string, active: boolean,
    priority: number | null, prefix = "", profile: string | null = null, evidence: string | null = null) => {
    const absoluteRoot = resolve(root);
    let rootStat;
    try { rootStat = lstatSync(absoluteRoot); }
    catch { issue("source_root_missing", `${provider} source root is unavailable.`); return; }
    if (!rootStat.isDirectory() || linkedAncestor(absoluteRoot)) {
      issue("source_root_invalid", `${provider} source root must be a real directory.`); return;
    }
    const walk = (dir: string, depth: number) => {
      if (depth > limits.maxDepth) { issue("scan_depth_exceeded", `${provider} scan depth limit reached.`); return; }
      let handle;
      try { handle = opendirSync(dir); }
      catch { issue("directory_unreadable", `${provider} directory could not be read.`); return; }
      try { while (true) {
        const entry = handle.readSync();
        if (!entry) break;
        const name = entry.name;
        if (++entries > limits.maxEntries) { issue("scan_entries_exceeded", "Source scan entry limit reached."); return; }
        const path = join(dir, name);
        if (!inside(absoluteRoot, path)) { issue("path_escape", "A source entry escaped its configured root."); continue; }
        let stat;
        try { stat = lstatSync(path); }
        catch { issue("entry_unreadable", `${provider} entry could not be inspected.`); continue; }
        if (stat.isSymbolicLink()) {
          // Links are never followed; only the target's type is read, to tell whether it could hold sources.
          let directory = true;
          try { directory = statSync(path).isDirectory(); } catch { /* A broken link is judged by its name. */ }
          const sourceLike = directory || kindOf(prefix + portable(relative(absoluteRoot, path))) !== null;
          issues.push({ code: "symlink_skipped", detail: `${provider} symbolic link was skipped.`, blocking: true, mayHideSources: sourceLike });
          complete = false;
          continue;
        }
        if (stat.isDirectory()) {
          // MO2's virtual filesystem hides configured directory names (e.g. `.git`) inside mods and overwrite.
          if (provider.startsWith("mo2-") && skipDirectories.includes(name.toLowerCase())) continue;
          walk(path, depth + 1); if (entries > limits.maxEntries) return; continue;
        }
        if (!stat.isFile()) continue;
        const virtualPath = prefix + portable(relative(absoluteRoot, path));
        const kind = kindOf(virtualPath);
        if (!kind) continue;
        candidates.push({ id: `${provider}:${providerName}:${key(virtualPath)}:${path}`,
          provider, providerName, route, profileId: profile, virtualPath, physicalPath: path, kind, active,
          priority, priorityEvidence: evidence,
          sizeBytes: stat.size, modifiedMs: stat.mtimeMs, sha256: null, discoveredAt,
          limitations: kind === "archive" ? [archiveLimit] : ["Physical presence and selected-route activation do not establish runtime loading."],
        });
      } } catch { issue("directory_unreadable", `${provider} directory could not be read.`); }
      finally { handle.closeSync(); }
    };
    walk(absoluteRoot, 0);
  };

  if (!settings.gameRoot) issue("game_root_unset", "Select a game root.");
  else scan(join(settings.gameRoot, "archive", "pc"), "game", "Installed game", true, null, "archive/pc/");
  // A separate manual root has the same install tree shape as a game root.
  if (settings.manualModRoot) scan(join(settings.manualModRoot, "archive", "pc"), "manual", "Manual files", true,
    null, "archive/pc/");

  if (route === "mo2") {
    if (!settings.mo2Root || !profileId) issue("mo2_unconfigured", "MO2 root and profile are required.");
    else {
      // Resolve the instance's configured directories as MO2 does; a folder without
      // ModOrganizer.ini uses MO2's defaults (<root>/mods, profiles, overwrite).
      const iniPath = join(settings.mo2Root, "ModOrganizer.ini");
      let iniText: string | null = null;
      try {
        const stat = lstatSync(iniPath);
        if (stat.isFile() && !linkedAncestor(iniPath) && stat.size <= iniBytes) iniText = readFileSync(iniPath, "utf8");
        else issue("mo2_ini_unreadable", "The MO2 instance settings file is linked, not a file, or too large.");
      } catch { /* A bare default-layout folder has no ModOrganizer.ini. */ }
      const instance = describeMo2Instance(iniText, settings.mo2Root, "configured", basename(settings.mo2Root));
      skipDirectories = instance.skipDirectories;
      const listing = join(instance.paths.profiles, profileId, "modlist.txt");
      let text = "";
      try {
        const stat = lstatSync(listing);
        if (!stat.isFile() || linkedAncestor(listing) || stat.size > limits.maxProfileBytes)
          throw Error("Profile list is missing, linked, or exceeds its byte limit.");
        text = readFileSync(listing, "utf8");
      } catch { issue("profile_unreadable", "Selected MO2 modlist is unavailable or exceeds its byte limit."); }
      const modlist = parseMo2Modlist(text);
      for (const entry of modlist.notes)
        note(entry.code === "duplicate_ignored" ? "profile_duplicate_mod" : "profile_overwrite_row",
          `MO2 ignores modlist row ${entry.line}${entry.code === "duplicate_ignored" ? " (a repeated mod keeps its first row)" : ""}.`);
      for (const entry of modlist.entries) {
        // Separators carry no files; foreign rows are game-plugin entries outside the mods directory.
        if (entry.kind !== "mod") continue;
        if (!safeName(entry.name)) { issue("profile_row_invalid", `Invalid MO2 profile row ${entry.line}.`); continue; }
        scan(join(instance.paths.mods, entry.name), "mo2-mod", entry.name, entry.enabled, entry.priority, "", profileId,
          `MO2 modlist.txt row ${entry.line}; MO2 writes the list highest priority first, so earlier rows win`);
      }
      // A missing overwrite directory is valid for an otherwise healthy instance.
      try { if (lstatSync(instance.paths.overwrite).isDirectory()) scan(instance.paths.overwrite, "mo2-overwrite",
        "MO2 overwrite", true, modlist.overwritePriority, "", profileId, "MO2 overwrite ranks above every profile mod"); }
      catch { /* optional */ }
    }
  }

  candidates.sort((a, b) => a.virtualPath.localeCompare(b.virtualPath) || a.provider.localeCompare(b.provider) ||
    a.physicalPath.localeCompare(b.physicalPath));
  const groups = new Map<string, SourceCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.kind === "archive") continue;
    const id = key(candidate.virtualPath);
    const group = groups.get(id) ?? [];
    group.push(candidate); groups.set(id, group);
  }
  const looseFiles: LooseFileAssessment[] = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => {
    const contenders = rows.slice().sort((a, b) => a.id.localeCompare(b.id));
    const active = contenders.filter(c => c.active);
    let selected: SourceCandidate | null = null;
    let reason = "No active candidate in the selected route.";
    if (!complete) reason = "Incomplete scan prevents a precedence conclusion.";
    else if (active.length === 1) { selected = active[0]!; reason = "Only one active physical candidate in the scanned roots."; }
    else if (active.length > 1 && active.every(c => c.provider === "mo2-mod" || c.provider === "mo2-overwrite")) {
      const ordered = active.slice().sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
      if (ordered[0]!.priority !== ordered[1]!.priority) {
        selected = ordered[0]!; reason = "MO2 virtual-file priority from the selected modlist/overwrite.";
      }
    } else if (active.length > 1) reason = "Game, manual, and MO2 mounts need a separate precedence model.";
    return { virtualPath: contenders[0]!.virtualPath, contenders, sourceDerivedFirst: selected,
      runtimeObservedWinner: null, confidence: selected ? "source-derived" : active.length > 1 && complete
        ? "ambiguous" : "unknown", reason };
  });
  return { route, profileId, discoveredAt, complete, candidates, looseFiles, issues,
    limitations: [archiveLimit, "MO2 '+' is activation intent, not a loaded-file or archive-resource winner.",
      "The selected route is a configuration choice, not evidence of a particular game launch.",
      "No content hashes or archive indexes are read by this bounded inventory."],
  };
}
