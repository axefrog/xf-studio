/** Pure Cyberpunk 2077 install and MO2 instance detection over a narrow host port.
 * The port (see install-detection-host.ts) owns registry, filesystem and environment access;
 * everything here is parsing and policy, testable with synthetic fixtures. Detection is
 * read-only: it never launches the game or MO2, and never writes to either.
 */
import { basename, dirname, join, resolve } from "node:path";
import { describeMo2Instance, parseNxmHandlerIni, type Mo2InstanceDescription } from "./mo2-instance";
import { EYE_MAKEUP_MOD } from "./mod-branding";

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
  /** Bounded binary read; null when missing, not a regular file or larger than maxBytes. */
  readBinary(path: string, maxBytes: number): Uint8Array | null;
  /** Roots of this computer's local drives (for example `C:\`), from the host's mounted-volume list. */
  drives(): Promise<readonly string[]>;
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
/** A copy of the game from a store whose edition the mod's frameworks cannot load. Never offered as a candidate. */
export interface UnsupportedGameInstall {
  readonly source: "xbox";
  /** The folder, when the store's records name one; null when only a package registration was found. */
  readonly root: string | null;
  readonly detail: string;
  /** Plain-language explanation and the one next step, ready to show as is. */
  readonly message: string;
}
export interface GameInstallDetection {
  readonly schema: "xfs/game-install-detection-1";
  readonly supported: boolean;
  readonly candidates: readonly GameInstallCandidate[];
  /** Registered locations that did not contain the game executable, or that the launcher marks as incomplete. */
  readonly rejected: readonly { readonly root: string; readonly source: GameInstallSource }[];
  /** Installs recognised but not usable with the mod (currently the Xbox app / Microsoft Store). */
  readonly unsupported: readonly UnsupportedGameInstall[];
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

/** Epic Games Launcher `.item` manifest fields needed for detection, or null when not a manifest. */
export interface EpicManifest {
  readonly displayName: string;
  readonly installLocation: string;
  readonly launchExecutable: string;
  readonly appName: string;
  /** The launcher's `bIsIncompleteInstall`: a download or install that has not finished. */
  readonly incomplete: boolean;
}
const jsonText = (text: string) => JSON.parse(text.replace(/^﻿/, ""));
const stringField = (field: unknown) => typeof field === "string" ? field : "";
export function parseEpicManifest(text: string): EpicManifest | null {
  try {
    const value = jsonText(text);
    if (!value || typeof value !== "object" || typeof value.InstallLocation !== "string" || !value.InstallLocation) return null;
    return { displayName: stringField(value.DisplayName), installLocation: value.InstallLocation,
      launchExecutable: stringField(value.LaunchExecutable), appName: stringField(value.AppName),
      incomplete: value.bIsIncompleteInstall === true };
  } catch { return null; }
}
/** The launcher's second install list, `%ProgramData%\Epic\UnrealEngineLauncher\LauncherInstalled.dat`
 * (`InstallationList` rows of `AppName` and `InstallLocation`). Unreadable or malformed text gives no rows. */
export function parseEpicInstallList(text: string): { appName: string; installLocation: string }[] {
  try {
    const list: unknown = jsonText(text)?.InstallationList;
    if (!Array.isArray(list)) return [];
    return list.filter(row => row && typeof row.InstallLocation === "string" && row.InstallLocation)
      .map(row => ({ appName: stringField(row.AppName), installLocation: row.InstallLocation as string }));
  } catch { return []; }
}
const epicLooksLikeCyberpunk = (manifest: EpicManifest) =>
  manifest.launchExecutable.replaceAll("\\", "/").toLowerCase().endsWith("bin/x64/cyberpunk2077.exe") ||
  /cyberpunk\s*2077/i.test(manifest.displayName);

/** The Xbox app's default library folder name, checked on every drive besides any `.GamingRoot` names. */
export const XBOX_DEFAULT_LIBRARY = "XboxGames";
/** Parse a drive-root `.GamingRoot` file written by the Xbox app: the ASCII magic `RGBX`, a 32-bit
 * value (1 in every file observed), then NUL-terminated UTF-16LE library folders relative to the drive
 * root. Returns null for anything else; absolute or escaping paths are dropped. */
export function parseGamingRoot(bytes: Uint8Array): string[] | null {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RGBX") return null;
  const body = bytes.subarray(8, 8 + ((bytes.length - 8) & ~1));
  return new TextDecoder("utf-16le").decode(body).split("\0").map(path => path.trim())
    .filter(path => path && !/^[\\/]|:|(^|[\\/])\.\.([\\/]|$)/.test(path));
}
/** Local drive roots from `reg query HKLM\SYSTEM\MountedDevices` (value names such as `\DosDevices\C:`). */
export function parseMountedDrives(text: string): string[] {
  const letters = new Set<string>();
  for (const entry of parseRegQuery(text)) for (const value of entry.values) {
    const match = /^\\DosDevices\\([A-Z]):$/i.exec(value.name);
    if (match) letters.add(match[1]!.toUpperCase());
  }
  return [...letters].sort().map(letter => `${letter}:\\`);
}
/** What to tell someone whose copy comes from the Xbox app. Sources and limits:
 * research/authoring/source-discovery-foundation.md, "Store coverage". */
export const XBOX_UNSUPPORTED_MESSAGE = `This looks like the Xbox app copy of Cyberpunk 2077. ${EYE_MAKEUP_MOD.modName} ` +
  "needs ArchiveXL, which installs into the Windows PC edition of the game sold on Steam, GOG and the Epic Games Store. " +
  "The Xbox store sells Cyberpunk 2077 for Xbox consoles and cloud play. " +
  "Install Cyberpunk 2077 from Steam, GOG or Epic Games, then choose that folder.";
const cyberpunkFolder = /cyberpunk\s*2077/i;
const cyberpunkPackage = /cyberpunk\s*2077|cyberpunk2077/i;
/** Files an Xbox app install keeps in its `Content` folder (GDK and older UWP packages). */
const XBOX_CONTENT_MARKERS = ["MicrosoftGame.config", "appxmanifest.xml"] as const;
/** reg.exe prints in the console code page; a character outside it comes back as `?`, which no Windows path contains. */
const lossy = (value: string) => /[?�]/.test(value);

const unsupportedHost = "Automatic detection reads Windows launcher records; enter the folder manually on this host.";

export async function detectGameInstalls(port: DetectionHostPort,
  mo2: Mo2Detection | null = null): Promise<GameInstallDetection> {
  const limitations = [
    "A launcher record and executable show where the game is installed, not which copy a launcher or MO2 will start.",
    "Detection does not read the game version, check file integrity or prove that mods load.",
    "Xbox app copies are recognised from the Xbox app's library folders and package list, and are never offered.",
  ];
  if (port.platform !== "win32") return { schema: "xfs/game-install-detection-1", supported: false,
    candidates: [], rejected: [], unsupported: [], limitations,
    issues: [{ source: "host", code: "unsupported_platform", detail: unsupportedHost }] };
  const found = new Map<string, { root: string; evidence: GameInstallEvidence[] }>();
  const rejected: { root: string; source: GameInstallSource }[] = [];
  const unsupported: UnsupportedGameInstall[] = [];
  const issues: DetectionIssue[] = [];
  const reject = (absolute: string, source: GameInstallSource) => {
    if (!rejected.some(row => key(row.root) === key(absolute) && row.source === source)) rejected.push({ root: absolute, source });
  };
  const flagXbox = (root: string | null, detail: string) => {
    if (unsupported.some(row => root ? row.root !== null && key(row.root) === key(root) : row.detail === detail)) return;
    unsupported.push({ source: "xbox", root, detail, message: XBOX_UNSUPPORTED_MESSAGE });
  };
  const readable = (source: string, value: string) => {
    if (!lossy(value)) return true;
    issues.push({ source: source.toLowerCase(), code: "registry_text_unreadable",
      detail: `A ${source} registry path has characters this check can't read; choose the folder manually if it isn't found.` });
    return false;
  };

  // Xbox app / Microsoft Store: each drive's `.GamingRoot` names its library folders (plus the default
  // XboxGames); a game lives in <library>\<title>\Content. Found first so no other lead can offer one.
  const xboxLibraries: string[] = [];
  for (const drive of await port.drives()) {
    const bytes = port.readBinary(join(drive, ".GamingRoot"), 64 * 1024);
    for (const relative of [...(bytes ? parseGamingRoot(bytes) ?? [] : []), XBOX_DEFAULT_LIBRARY]) {
      const library = resolve(drive, relative);
      if (!xboxLibraries.some(row => key(row) === key(library)) && port.directories(library)) xboxLibraries.push(library);
    }
  }
  const xboxContent = (folder: string) => XBOX_CONTENT_MARKERS.some(name => port.isFile(join(folder, name)));
  const isXboxInstall = (absolute: string) => absolute.split(/[\\/]/).some(part => part.toLowerCase() === "windowsapps") ||
    (basename(absolute).toLowerCase() === "content" && xboxLibraries.some(row => key(row) === key(dirname(dirname(absolute)))) &&
      xboxContent(absolute));
  for (const library of xboxLibraries) for (const title of port.directories(library) ?? []) {
    const content = join(library, title, "Content");
    if (xboxContent(content) && (cyberpunkFolder.test(title) || port.isFile(join(content, ...GAME_EXECUTABLE))))
      flagXbox(content, `Xbox app library ${library}`);
  }
  if (!unsupported.length) {
    const packages = await port.registry("HKLM\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Package");
    for (const entry of packages ? parseRegQuery(packages) : [])
      for (const value of entry.values) if (cyberpunkPackage.test(value.name)) flagXbox(null, `Xbox app package ${value.name}`);
  }

  const offer = (root: string, source: GameInstallSource, detail: string) => {
    const absolute = resolve(root);
    if (isXboxInstall(absolute)) { flagXbox(absolute, `${detail} names an Xbox app folder`); return; }
    if (!port.isFile(join(absolute, ...GAME_EXECUTABLE))) { reject(absolute, source); return; }
    const entry = found.get(key(absolute)) ?? { root: absolute, evidence: [] };
    if (!entry.evidence.some(row => row.source === source && row.detail === detail)) entry.evidence.push({ source, detail });
    found.set(key(absolute), entry);
  };

  // Steam: SteamPath (HKCU) or InstallPath (HKLM), else the default Program Files folder ->
  // libraryfolders.vdf (steamapps\ and config\) -> appmanifest_1091500.acf in any library -> steamapps/common/<installdir>.
  const steamRoots: string[] = [];
  const addSteam = (value: string) => { if (!steamRoots.some(root => key(root) === key(value))) steamRoots.push(resolve(value)); };
  for (const [registryKey, name] of [["HKCU\\Software\\Valve\\Steam", "SteamPath"],
    ["HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"], ["HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath"]] as const) {
    const text = await port.registry(registryKey);
    const value = text ? registryValue(parseRegQuery(text), name) : null;
    if (value && readable("Steam", value)) addSteam(value);
  }
  for (const variable of ["ProgramFiles(x86)", "ProgramFiles"]) {
    const base = port.env(variable);
    if (base && port.directories(join(base, "Steam", "steamapps"))) addSteam(join(base, "Steam"));
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
    // Folder names compare without case on Windows; report the folder as it is spelled on disk.
    const common = join(library, "steamapps", "common");
    const onDisk = port.directories(common)?.find(name => name.toLowerCase() === installdir.toLowerCase()) ?? installdir;
    offer(join(common, onDisk), "steam", `Steam app ${STEAM_APP_ID}`);
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
      if (path && cyberpunk && readable("GOG", path)) offer(path, "gog", `GOG product ${id}${name ? ` (${name})` : ""}`);
    }
  }

  // Epic: `.item` manifests in the launcher's data folder (the %ProgramData% default and the registered
  // AppDataPath), then the launcher's install list. An unfinished install is never offered.
  const programData = port.env("ProgramData");
  const epicData: string[] = programData ? [resolve(programData, "Epic", "EpicGamesLauncher", "Data")] : [];
  for (const registryKey of ["HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher", "HKLM\\SOFTWARE\\Epic Games\\EpicGamesLauncher"]) {
    const text = await port.registry(registryKey);
    const value = text ? registryValue(parseRegQuery(text), "AppDataPath") : null;
    if (value && readable("Epic", value) && !epicData.some(root => key(root) === key(value))) epicData.push(resolve(value));
  }
  const epicApps = new Set<string>(), unfinished = new Set<string>();
  for (const data of epicData) {
    const manifests = join(data, "Manifests");
    for (const name of port.files(manifests) ?? []) {
      if (!name.toLowerCase().endsWith(".item")) continue;
      const text = port.readText(join(manifests, name), manifestBytes);
      const manifest = text === null ? null : parseEpicManifest(text);
      if (!manifest || !epicLooksLikeCyberpunk(manifest)) continue;
      if (manifest.appName) epicApps.add(manifest.appName.toLowerCase());
      if (manifest.incomplete) {
        unfinished.add(key(manifest.installLocation));
        reject(resolve(manifest.installLocation), "epic");
        issues.push({ source: "epic", code: "install_incomplete", detail: "The Epic Games Launcher says a Cyberpunk 2077 " +
          "install hasn't finished. Let it finish, or verify the game in the launcher, then look again." });
        continue;
      }
      offer(manifest.installLocation, "epic", `Epic app ${manifest.appName || "unknown"}`);
    }
  }
  if (programData) {
    const text = port.readText(join(programData, "Epic", "UnrealEngineLauncher", "LauncherInstalled.dat"), manifestBytes);
    for (const row of text === null ? [] : parseEpicInstallList(text)) {
      if (unfinished.has(key(row.installLocation))) continue;
      if (epicApps.has(row.appName.toLowerCase()) || port.isFile(join(resolve(row.installLocation), ...GAME_EXECUTABLE)))
        offer(row.installLocation, "epic", `Epic install list (${row.appName || "unknown app"})`);
    }
  }

  // MO2: each instance managing Cyberpunk 2077 names the game folder it virtualizes.
  for (const instance of mo2?.instances ?? [])
    if (instance.managesCyberpunk && instance.gamePath)
      offer(instance.gamePath, "mo2", `MO2 ${instance.kind} instance "${instance.name}"`);

  if (unsupported.length) issues.push({ source: "xbox", code: "store_unsupported", detail: XBOX_UNSUPPORTED_MESSAGE });
  const candidates = [...found.values()].map(entry => ({ root: entry.root, evidence: entry.evidence,
    executableFound: true as const })).sort((a, b) => b.evidence.length - a.evidence.length || a.root.localeCompare(b.root));
  return { schema: "xfs/game-install-detection-1", supported: true, candidates,
    rejected: rejected.filter(row => !found.has(key(row.root))), unsupported, issues, limitations };
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
    instances: [], issues: [{ source: "host", code: "unsupported_platform", detail: unsupportedHost }], limitations };
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
