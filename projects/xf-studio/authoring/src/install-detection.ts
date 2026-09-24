/** Pure Cyberpunk 2077 install and MO2 instance detection over a narrow host port.
 * The port (see install-detection-host.ts) owns registry, filesystem and environment access;
 * everything here is parsing and policy, testable with synthetic fixtures. Detection is
 * read-only: it never launches the game or MO2, and never writes to either.
 */
import { basename, dirname, join, resolve } from "node:path";
import { describeMo2Instance, parseNxmHandlerIni, type Mo2InstanceDescription } from "./mo2-instance";

export const STEAM_APP_ID = "1091500";
/** GOG product ID of the base game, observed in a GOG Galaxy registry entry whose gameName is
 * "Cyberpunk 2077". Phantom Liberty and REDmod register their own IDs against the same path, so
 * detection confirms every GOG path by executable instead of trusting any single ID. */
export const GOG_BASE_PRODUCT_ID = "1423049311";
export const GAME_EXECUTABLE = ["bin", "x64", "Cyberpunk2077.exe"] as const;

export type RegistryValue = { readonly name: string; readonly type: string; readonly data: string };
export type RegistryKey = { readonly key: string; readonly values: readonly RegistryValue[] };

export interface DetectionHostPort {
  readonly platform: string;
  env(name: string): string | undefined;
  /** Raw `reg query` output for a fixed key, or null when the key is absent or unreadable. */
  registry(key: string, recursive?: boolean): Promise<string | null>;
  /** Bounded UTF-8 text read; null when missing, not a regular file or larger than maxBytes. */
  readText(path: string, maxBytes: number): string | null;
  isFile(path: string): boolean;
  /** Immediate child directory names, or null when unreadable. */
  directories(path: string): readonly string[] | null;
  /** Immediate child file names, or null when unreadable. */
  files(path: string): readonly string[] | null;
}

export type GameInstallSource = "steam" | "gog" | "epic" | "mo2";
export interface GameInstallEvidence { readonly source: GameInstallSource; readonly detail: string }
export interface GameInstallCandidate {
  readonly root: string;
  /** Every source that pointed here; one install is often registered by several. */
  readonly evidence: readonly GameInstallEvidence[];
  /** `bin/x64/Cyberpunk2077.exe` exists under root. Unconfirmed paths are never offered. */
  readonly executableFound: true;
}
export interface DetectionIssue { readonly source: string; readonly code: string; readonly detail: string }
export interface GameInstallDetection {
  readonly schema: "xfs/game-install-detection-1";
  readonly supported: boolean;
  readonly candidates: readonly GameInstallCandidate[];
  /** Registered locations that did not contain the game executable. */
  readonly rejected: readonly { readonly root: string; readonly source: GameInstallSource }[];
  readonly issues: readonly DetectionIssue[];
  readonly limitations: readonly string[];
}
export interface Mo2Detection {
  readonly schema: "xfs/mo2-instance-detection-1";
  readonly supported: boolean;
  readonly instances: readonly Mo2InstanceDescription[];
  readonly issues: readonly DetectionIssue[];
  readonly limitations: readonly string[];
}

const iniBytes = 4 * 1024 * 1024;
const manifestBytes = 4 * 1024 * 1024;
const key = (path: string) => resolve(path).toLowerCase();

/** Parse `reg query` text output into keys and values. Value names may contain spaces;
 * `(Default)` is reported as the empty name. */
export function parseRegQuery(text: string): RegistryKey[] {
  const keys: { key: string; values: RegistryValue[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { keys.push({ key: line.trim(), values: [] }); continue; }
    const value = /^\s{2,}(.*?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/.exec(line);
    if (!value || !keys.length) continue;
    const name = value[1] === "(Default)" ? "" : value[1]!;
    keys.at(-1)!.values.push({ name, type: value[2]!, data: value[3] ?? "" });
  }
  return keys;
}
const registryValue = (keys: readonly RegistryKey[], name: string) => {
  for (const entry of keys) {
    const found = entry.values.find(value => value.name.toLowerCase() === name.toLowerCase());
    if (found) return found.data;
  }
  return null;
};

export type VdfNode = { [key: string]: string | VdfNode };
/** Parse Valve KeyValues text (libraryfolders.vdf, appmanifest_*.acf). Keys keep their case;
 * lookups through `vdfGet` are case-insensitive as Steam's are. */
export function parseVdf(text: string): VdfNode {
  let i = 0;
  const token = (): string | null => {
    while (i < text.length) {
      if (/\s/.test(text[i]!)) { i++; continue; }
      if (text.startsWith("//", i)) { while (i < text.length && text[i] !== "\n") i++; continue; }
      break;
    }
    if (i >= text.length) return null;
    const ch = text[i]!;
    if (ch === "{" || ch === "}") { i++; return ch; }
    if (ch === "\"") {
      let out = ""; i++;
      while (i < text.length && text[i] !== "\"") {
        if (text[i] === "\\" && i + 1 < text.length) {
          const next = text[i + 1]!; i += 2;
          out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        } else out += text[i++];
      }
      i++; return out;
    }
    let out = "";
    while (i < text.length && !/[\s{}"]/.test(text[i]!)) out += text[i++];
    return out;
  };
  const object = (): VdfNode => {
    const node: VdfNode = {};
    while (true) {
      const name = token();
      if (name === null || name === "}") return node;
      const value = token();
      if (value === null) return node;
      node[name] = value === "{" ? object() : value;
    }
  };
  return object();
}
export const vdfGet = (node: VdfNode | string | undefined, name: string): VdfNode | string | undefined => {
  if (!node || typeof node === "string") return undefined;
  const match = Object.keys(node).find(candidate => candidate.toLowerCase() === name.toLowerCase());
  return match === undefined ? undefined : node[match];
};

/** Library roots from libraryfolders.vdf (current `path` objects and the legacy numbered strings). */
export function steamLibraryPaths(vdf: VdfNode): string[] {
  const folders = vdfGet(vdf, "libraryfolders");
  if (!folders || typeof folders === "string") return [];
  const paths: string[] = [];
  for (const [name, value] of Object.entries(folders)) {
    if (!/^\d+$/.test(name)) continue;
    const path = typeof value === "string" ? value : vdfGet(value, "path");
    if (typeof path === "string" && path) paths.push(path);
  }
  return paths;
}
export function steamInstallDir(manifest: VdfNode): string | null {
  const installdir = vdfGet(vdfGet(manifest, "AppState"), "installdir");
  return typeof installdir === "string" && installdir && !/[\\/]|^\.\.?$/.test(installdir) ? installdir : null;
}

/** Epic Games Launcher `.item` manifest fields needed for detection, or null when not JSON. */
export function parseEpicManifest(text: string): { displayName: string; installLocation: string;
  launchExecutable: string; appName: string } | null {
  try {
    const value = JSON.parse(text.replace(/^﻿/, ""));
    if (!value || typeof value !== "object" || typeof value.InstallLocation !== "string") return null;
    const text_ = (field: unknown) => typeof field === "string" ? field : "";
    return { displayName: text_(value.DisplayName), installLocation: value.InstallLocation,
      launchExecutable: text_(value.LaunchExecutable), appName: text_(value.AppName) };
  } catch { return null; }
}
const epicLooksLikeCyberpunk = (manifest: NonNullable<ReturnType<typeof parseEpicManifest>>) =>
  manifest.launchExecutable.replaceAll("\\", "/").toLowerCase().endsWith("bin/x64/cyberpunk2077.exe") ||
  /cyberpunk\s*2077/i.test(manifest.displayName);

const unsupported = "Automatic detection reads Windows launcher records; enter the folder manually on this host.";

export async function detectGameInstalls(port: DetectionHostPort,
  mo2: Mo2Detection | null = null): Promise<GameInstallDetection> {
  const limitations = [
    "A launcher record and executable show where the game is installed, not which copy a launcher or MO2 will start.",
    "Detection does not read the game version, check file integrity or prove that mods load.",
  ];
  if (port.platform !== "win32") return { schema: "xfs/game-install-detection-1", supported: false,
    candidates: [], rejected: [], issues: [{ source: "host", code: "unsupported_platform", detail: unsupported }], limitations };
  const found = new Map<string, { root: string; evidence: GameInstallEvidence[] }>();
  const rejected: { root: string; source: GameInstallSource }[] = [];
  const issues: DetectionIssue[] = [];
  const offer = (root: string, source: GameInstallSource, detail: string) => {
    const absolute = resolve(root);
    if (!port.isFile(join(absolute, ...GAME_EXECUTABLE))) {
      if (!rejected.some(row => key(row.root) === key(absolute) && row.source === source))
        rejected.push({ root: absolute, source });
      return;
    }
    const entry = found.get(key(absolute)) ?? { root: absolute, evidence: [] };
    if (!entry.evidence.some(row => row.source === source && row.detail === detail)) entry.evidence.push({ source, detail });
    found.set(key(absolute), entry);
  };

  // Steam: SteamPath -> libraryfolders.vdf -> appmanifest_1091500.acf -> steamapps/common/<installdir>.
  const steamRoots: string[] = [];
  for (const [registryKey, name] of [["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"], ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]] as const) {
    const text = await port.registry(registryKey);
    const value = text ? registryValue(parseRegQuery(text), name) : null;
    if (value && !steamRoots.some(root => key(root) === key(value))) steamRoots.push(resolve(value));
  }
  const libraries: string[] = [];
  for (const steam of steamRoots) {
    if (!libraries.some(root => key(root) === key(steam))) libraries.push(steam);
    for (const file of [join(steam, "steamapps", "libraryfolders.vdf"), join(steam, "config", "libraryfolders.vdf")]) {
      const text = port.readText(file, manifestBytes);
      if (text === null) continue;
      for (const path of steamLibraryPaths(parseVdf(text)))
        if (!libraries.some(root => key(root) === key(path))) libraries.push(resolve(path));
    }
  }
  for (const library of libraries) {
    const text = port.readText(join(library, "steamapps", `appmanifest_${STEAM_APP_ID}.acf`), manifestBytes);
    if (text === null) continue;
    const installdir = steamInstallDir(parseVdf(text));
    if (!installdir) { issues.push({ source: "steam", code: "manifest_invalid", detail: "A Cyberpunk 2077 Steam manifest has no usable installdir." }); continue; }
    offer(join(library, "steamapps", "common", installdir), "steam", `Steam app ${STEAM_APP_ID}`);
  }

  // GOG: every product under GOG.com\Games (native and WOW6432Node views) whose path holds the executable.
  for (const registryKey of ["HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games", "HKLM\\SOFTWARE\\GOG.com\\Games"]) {
    const text = await port.registry(registryKey, true);
    if (!text) continue;
    for (const entry of parseRegQuery(text)) {
      const path = entry.values.find(value => value.name.toLowerCase() === "path")?.data;
      const id = basename(entry.key.replaceAll("\\", "/"));
      const name = entry.values.find(value => value.name.toLowerCase() === "gamename")?.data;
      const cyberpunk = id === GOG_BASE_PRODUCT_ID || /cyberpunk\s*2077/i.test(name ?? "");
      if (path && cyberpunk) offer(path, "gog", `GOG product ${id}${name ? ` (${name})` : ""}`);
    }
  }

  // Epic: launcher manifests under %ProgramData%.
  const programData = port.env("ProgramData");
  if (programData) {
    const manifests = join(programData, "Epic", "EpicGamesLauncher", "Data", "Manifests");
    for (const name of port.files(manifests) ?? []) {
      if (!name.toLowerCase().endsWith(".item")) continue;
      const text = port.readText(join(manifests, name), manifestBytes);
      const manifest = text === null ? null : parseEpicManifest(text);
      if (manifest && epicLooksLikeCyberpunk(manifest))
        offer(manifest.installLocation, "epic", `Epic app ${manifest.appName || "unknown"}`);
    }
  }

  // MO2: each instance managing Cyberpunk 2077 names the game folder it virtualizes.
  for (const instance of mo2?.instances ?? [])
    if (instance.managesCyberpunk && instance.gamePath)
      offer(instance.gamePath, "mo2", `MO2 ${instance.kind} instance "${instance.name}"`);

  const candidates = [...found.values()].map(entry => ({ root: entry.root, evidence: entry.evidence,
    executableFound: true as const })).sort((a, b) => b.evidence.length - a.evidence.length || a.root.localeCompare(b.root));
  return { schema: "xfs/game-install-detection-1", supported: true, candidates,
    rejected: rejected.filter(row => !found.has(key(row.root))), issues, limitations };
}

/** Find global instances under %LOCALAPPDATA%\ModOrganizer and portable instances named by the
 * download handler registration (downloadhandler.ini / legacy nxmhandler.ini, globally or beside the
 * registered nxmhandler.exe). A portable instance is an MO2 folder holding ModOrganizer.ini. */
export async function detectMo2Instances(port: DetectionHostPort): Promise<Mo2Detection> {
  const limitations = [
    "Instances are found from MO2's global instance folder and its registered download handler; an unregistered portable copy elsewhere must be chosen manually.",
    "A profile's enabled mods describe MO2's intended virtual files, not what a particular game launch loaded.",
  ];
  if (port.platform !== "win32") return { schema: "xfs/mo2-instance-detection-1", supported: false,
    instances: [], issues: [{ source: "host", code: "unsupported_platform", detail: unsupported }], limitations };
  const issues: DetectionIssue[] = [];
  const instances = new Map<string, Mo2InstanceDescription>();
  const add = (root: string, kind: "global" | "portable", name: string) => {
    const absolute = resolve(root);
    if (instances.has(key(absolute))) return;
    const text = port.readText(join(absolute, "ModOrganizer.ini"), iniBytes);
    if (text === null) return;
    const described = describeMo2Instance(text, absolute, kind, name);
    const profiles = (port.directories(described.paths.profiles) ?? [])
      .filter(profile => port.isFile(join(described.paths.profiles, profile, "modlist.txt")));
    if (!port.directories(described.paths.profiles))
      issues.push({ source: "mo2", code: "profiles_unreadable", detail: `Profiles of MO2 instance "${name}" could not be listed.` });
    instances.set(key(absolute), describeMo2Instance(text, absolute, kind, name, profiles));
  };
  const localAppData = port.env("LOCALAPPDATA");
  const globalRoot = localAppData ? join(localAppData, "ModOrganizer") : null;
  for (const name of globalRoot ? port.directories(globalRoot) ?? [] : []) add(join(globalRoot!, name), "global", name);

  const handlerDirs: string[] = globalRoot ? [globalRoot] : [];
  const command = await port.registry("HKCU\\Software\\Classes\\nxm\\shell\\open\\command");
  const commandLine = command ? registryValue(parseRegQuery(command), "") : null;
  const handlerExe = commandLine ? /^\s*"([^"]+)"|^\s*(\S+)/.exec(commandLine) : null;
  const handlerPath = handlerExe ? handlerExe[1] ?? handlerExe[2] ?? null : null;
  if (handlerPath && /nxmhandler\.exe$/i.test(handlerPath)) {
    handlerDirs.push(dirname(handlerPath));
    add(dirname(handlerPath), "portable", basename(dirname(handlerPath)));
  }
  for (const dir of handlerDirs) for (const file of ["downloadhandler.ini", "nxmhandler.ini"]) {
    const text = port.readText(join(dir, file), iniBytes);
    if (text === null) continue;
    for (const handler of parseNxmHandlerIni(text))
      if (/modorganizer\.exe$/i.test(handler.executable))
        add(dirname(handler.executable), "portable", basename(dirname(handler.executable)));
  }
  const ordered = [...instances.values()].sort((a, b) => Number(b.managesCyberpunk) - Number(a.managesCyberpunk) ||
    a.name.localeCompare(b.name));
  return { schema: "xfs/mo2-instance-detection-1", supported: true, instances: ordered, issues, limitations };
}
