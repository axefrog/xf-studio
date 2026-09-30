/** Pure Mod Organizer 2 instance and profile interpretation. No filesystem, registry or process access.
 *
 * Behaviour follows MO2 2.5.2 source: `PathSettings` (settings.cpp) for `%BASE_DIR%` and default
 * directories, `GameSettings` for `[General]` keys, `InstanceManager` for global/portable layout and
 * `Profile::refreshModStatus`/`doWriteModlist` (profile.cpp) for `modlist.txt` priority. Evidence and
 * limits are recorded in research/authoring/source-discovery-foundation.md.
 */
import { isAbsolute, join, resolve } from "node:path";
import { compareCopies, type VirtualCopy } from "./archive-precedence";

export type IniSections = ReadonlyMap<string, ReadonlyMap<string, string>>;

const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
  "\"": "\"", "'": "'", "?": "?", "\\": "\\", ";": ";", ",": "," };

/** Decode one QSettings INI value the way QSettings::iniUnescapedStringList and stringToVariant do
 * for the string-like values MO2 stores (plain, quoted, `@ByteArray(...)`, `@@` escapes). An unquoted
 * `;` starts a comment. A QStringList (unquoted comma list) is returned as its comma-joined text. */
export function decodeQSettingsValue(raw: string): string {
  let out = "", quoted = false;
  const text = raw.trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\"") { quoted = !quoted; continue; }
    if (ch === ";" && !quoted) { out = out.trimEnd(); break; }
    if (ch !== "\\" || i + 1 >= text.length) { out += ch; continue; }
    const next = text[++i]!;
    if (next === "x") {
      let hex = "";
      while (hex.length < 4 && /[0-9a-fA-F]/.test(text[i + 1] ?? "")) hex += text[++i];
      out += hex ? String.fromCharCode(parseInt(hex, 16)) : "x";
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(text[i + 1] ?? "")) oct += text[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += escapes[next] ?? next;
  }
  if (out.startsWith("@@")) return out.slice(1);
  const typed = /^@(ByteArray|String)\(([\s\S]*)\)$/.exec(out);
  return typed ? typed[2]! : out;
}

/** QSettings INI keys and sections are case-insensitive on Windows; both are lower-cased here. */
export function parseQSettingsIni(text: string): IniSections {
  const sections = new Map<string, Map<string, string>>();
  let current = sections.get("general") ?? new Map<string, string>();
  sections.set("general", current);
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const section = /^\[(.*)\]$/.exec(trimmed);
    if (section) {
      const name = decodeURIComponent(section[1]!.replace(/%(?![0-9a-fA-F]{2})/g, "%25")).toLowerCase();
      current = sections.get(name) ?? new Map<string, string>();
      sections.set(name, current);
      continue;
    }
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim().replaceAll("\\", "/").toLowerCase();
    if (!current.has(key)) current.set(key, decodeQSettingsValue(line.slice(equals + 1)));
  }
  return sections;
}

export interface Mo2InstancePaths {
  readonly base: string;
  readonly mods: string;
  readonly profiles: string;
  readonly overwrite: string;
  readonly downloads: string;
}
export type Mo2InstanceKind = "global" | "portable" | "configured";
export interface Mo2InstanceDescription {
  readonly kind: Mo2InstanceKind;
  /** Global instance folder name, or the folder name of a portable/configured instance. */
  readonly name: string;
  /** Directory containing ModOrganizer.ini (the instance's data directory). */
  readonly root: string;
  readonly iniFound: boolean;
  readonly gameName: string | null;
  readonly gamePath: string | null;
  readonly managesCyberpunk: boolean;
  readonly selectedProfile: string | null;
  readonly paths: Mo2InstancePaths;
  /** Name suffixes MO2's virtual filesystem hides, e.g. `.mohidden`. */
  readonly skipFileSuffixes: readonly string[];
  readonly skipDirectories: readonly string[];
  /** Profile folders that contain a modlist.txt; filled by an adapter that can list directories. */
  readonly profiles: readonly string[];
}

const BASE_DIR = "%BASE_DIR%";
const defaultDirs = { mods: "mods", profiles: "profiles", overwrite: "overwrite", downloads: "downloads" } as const;
const settingKeys = { mods: "mod_directory", profiles: "profiles_directory", overwrite: "overwrite_directory",
  downloads: "download_directory" } as const;
const list = (value: string | undefined, fallback: readonly string[]) => value === undefined ? fallback :
  value.split(",").map(item => item.trim()).filter(Boolean);

/** Resolve MO2's configurable directories exactly as PathSettings does: `[Settings] base_directory`
 * defaults to the ini's directory, and each directory defaults to `%BASE_DIR%/<name>`. */
export function resolveMo2Paths(ini: IniSections, root: string): Mo2InstancePaths {
  const settings = ini.get("settings") ?? new Map<string, string>();
  const base = resolve(root, settings.get("base_directory") || root);
  const path = (key: keyof typeof defaultDirs) => {
    const configured = settings.get(settingKeys[key]) || `${BASE_DIR}/${defaultDirs[key]}`;
    const substituted = configured.split(BASE_DIR).join(base);
    return isAbsolute(substituted) ? resolve(substituted) : resolve(root, substituted);
  };
  return { base, mods: path("mods"), profiles: path("profiles"), overwrite: path("overwrite"),
    downloads: path("downloads") };
}

/** Describe an instance from its ModOrganizer.ini text (or null for a bare default-layout folder). */
export function describeMo2Instance(text: string | null, root: string, kind: Mo2InstanceKind,
  name: string, profiles: readonly string[] = []): Mo2InstanceDescription {
  const ini = text === null ? new Map() as IniSections : parseQSettingsIni(text);
  const general = ini.get("general") ?? new Map<string, string>();
  const settings = ini.get("settings") ?? new Map<string, string>();
  const gameName = general.get("gamename") || null;
  const gamePath = general.get("gamepath") || null;
  return { kind, name, root: resolve(root), iniFound: text !== null, gameName,
    gamePath: gamePath ? resolve(gamePath) : null,
    managesCyberpunk: gameName?.trim().toLowerCase() === "cyberpunk 2077",
    selectedProfile: general.get("selected_profile") || null,
    paths: resolveMo2Paths(ini, root),
    // Settings::skipFileSuffixes/skipDirectories defaults.
    skipFileSuffixes: list(settings.get("skip_file_suffixes"), [".mohidden"]).map(item => item.toLowerCase()),
    skipDirectories: list(settings.get("skip_directories"), [".git"]).map(item => item.toLowerCase()),
    profiles: [...profiles].sort((a, b) => a.localeCompare(b)) };
}

/** Parse the `[handlers]` array of MO2's download handler ini (downloadhandler.ini, formerly nxmhandler.ini). */
export function parseNxmHandlerIni(text: string): { executable: string; games: string[] }[] {
  const handlers = parseQSettingsIni(text).get("handlers") ?? new Map<string, string>();
  const rows = new Map<string, { executable: string; games: string[] }>();
  for (const [key, value] of handlers) {
    const match = /^(\d+)\/(executable|games)$/.exec(key);
    if (!match) continue;
    const row = rows.get(match[1]!) ?? { executable: "", games: [] };
    if (match[2] === "executable") row.executable = value;
    else row.games = value.split(",").map(game => game.trim()).filter(Boolean);
    rows.set(match[1]!, row);
  }
  return [...rows.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, row]) => row)
    .filter(row => row.executable);
}

export type Mo2ModlistEntryKind = "mod" | "separator" | "foreign";
export interface Mo2ModlistEntry {
  readonly name: string;
  readonly enabled: boolean;
  readonly kind: Mo2ModlistEntryKind;
  /** 1-based line number in modlist.txt. */
  readonly line: number;
  /** MO2 priority: larger wins. The first listed row has the highest priority among listed mods. */
  readonly priority: number;
}
export interface Mo2Modlist {
  /** Entries in file order (highest priority first). */
  readonly entries: readonly Mo2ModlistEntry[];
  /** Overwrite always ranks above every listed mod. */
  readonly overwritePriority: number;
  readonly notes: readonly { code: "duplicate_ignored" | "overwrite_row_ignored"; line: number }[];
}

/**
 * A `modlist.txt` exactly as written (INSTALL-05): each line's text (trailing spaces kept) and its own line ending (CRLF, LF,
 * or none for a last line without one), with a BOM kept aside. Every reader and writer of the list splits it here (PIPE-10).
 */
export function splitMo2ModlistLines(text: string): { bom: string; lines: string[]; endings: string[] } {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = text.slice(bom.length);
  const lines: string[] = [], endings: string[] = [];
  const breaks = /\r?\n/g;
  let start = 0, match: RegExpExecArray | null;
  while ((match = breaks.exec(body))) { lines.push(body.slice(start, match.index)); endings.push(match[0]); start = match.index + match[0].length; }
  if (start < body.length) { lines.push(body.slice(start)); endings.push(""); }
  return { bom, lines, endings };
}

/** One line of the list that names an entry: its 0-based line, its prefix as written, and the name. */
export interface Mo2ModlistRow { readonly index: number; readonly prefix: "" | "+" | "-" | "*"; readonly name: string }

/**
 * Each line as MO2 reads it (`Profile::refreshModStatus`): surrounding spaces ignored, blank and `#` lines name nothing,
 * `+`, `-` or `*` is a prefix and the rest (trimmed) the name. Null for a line that names nothing. The one row reader
 * (PIPE-10): `parseMo2Modlist`, the placement and the diagnostics all read rows through it.
 */
export function mo2ModlistRows(text: string): (Mo2ModlistRow | null)[] {
  return splitMo2ModlistLines(text).lines.map((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return null;
    const prefix = (["+", "-", "*"] as const).find(sign => line[0] === sign) ?? "";
    const name = (prefix ? line.slice(1) : line).trim();
    return name ? { index, prefix, name } : null;
  });
}

/** Interpret modlist.txt as Profile::refreshModStatus does. MO2 writes the list in reverse priority
 * order, so the FIRST row wins conflicts against later rows; `-` disables, `+`/`*`/no prefix enables
 * (`*` marks a foreign, unmanaged entry), a repeated name keeps its first row, and names ending in
 * `_separator` are separators that carry no files. Unlisted mods are not part of this profile's state. */
export function parseMo2Modlist(text: string): Mo2Modlist {
  const rows: Omit<Mo2ModlistEntry, "priority">[] = [];
  const notes: { code: "duplicate_ignored" | "overwrite_row_ignored"; line: number }[] = [];
  const seen = new Set<string>();
  for (const row of mo2ModlistRows(text)) {
    if (!row) continue;
    const { name, prefix } = row, line = row.index + 1;
    if (name.toLowerCase() === "overwrite") { notes.push({ code: "overwrite_row_ignored", line }); continue; }
    // MO2 compares names exactly here; mod folder names are unique case-insensitively on Windows.
    if (seen.has(name)) { notes.push({ code: "duplicate_ignored", line }); continue; }
    seen.add(name);
    rows.push({ name, enabled: prefix !== "-", line,
      kind: prefix === "*" ? "foreign" : /_separator$/i.test(name) ? "separator" : "mod" });
  }
  return { entries: rows.map((row, index) => ({ ...row, priority: rows.length - index - 1 })),
    overwritePriority: rows.length, notes };
}

/** A modlist row names one folder in MO2's mods folder: never a path, `.`/`..`, a padded or dot-ended name, or a control character. */
export const isMo2ModFolderName = (name: string) => name !== "." && name !== ".." && name.trim() === name &&
  !/[\\/:\x00-\x1f]/.test(name) && !name.endsWith(".") && name.length > 0 && name.length <= 255;

/** A folder that can provide game files, as a copy of every virtual path below it. */
export interface ProviderFolder extends VirtualCopy {
  /** The folder the game's paths are joined to (the copy's id). */
  readonly folder: string;
}

/**
 * The folders that can provide a game file on the MO2 route, in the order their copies shadow each other, visible
 * first (`compareCopies`, knowledge/mod-loading.md rule 1; PIPE-06): MO2's overwrite, the profile's enabled mods by
 * priority, then the game folder when given. Separators and foreign (`*`) rows carry no files, and a row that isn't a
 * single folder name is left out, so no path is ever joined outside the mods folder.
 */
export function mo2ProviderFolders(modlist: Mo2Modlist, paths: Pick<Mo2InstancePaths, "mods" | "overwrite">, gameRoot?: string | null): ProviderFolder[] {
  const folder = (provider: ProviderFolder["provider"], providerName: string, path: string, priority: number | null): ProviderFolder =>
    ({ id: path, folder: path, provider, providerName, active: true, priority });
  return [folder("mo2-overwrite", "Overwrite", paths.overwrite, modlist.overwritePriority),
    ...modlist.entries.filter(entry => entry.kind === "mod" && entry.enabled && isMo2ModFolderName(entry.name))
      .map(entry => folder("mo2-mod", entry.name, join(paths.mods, entry.name), entry.priority)),
    ...(gameRoot ? [folder("game", "Game folder", gameRoot, null)] : [])].sort(compareCopies);
}
