import { expect, test } from "bun:test";
import { join, resolve, sep } from "node:path";
import { decodeQSettingsValue, describeMo2Instance, parseMo2Modlist, parseNxmHandlerIni,
  parseQSettingsIni } from "../src/mo2-instance";
import { detectGameInstalls, detectMo2Instances, parseEpicInstallList, parseEpicManifest, parseGamingRoot,
  parseMountedDrives, parseRegQuery, parseVdf, steamInstallDir, steamLibraryPaths, XBOX_UNSUPPORTED_MESSAGE,
  type DetectionHostPort } from "../src/install-detection";

// Synthetic, asset-free fixtures. Paths are placeholders under a fake drive, never a real machine.
const root = resolve("/xfs-fixture");
const p = (...parts: string[]) => join(root, ...parts);
const exe = (game: string) => join(game, "bin", "x64", "Cyberpunk2077.exe");

function fakeHost(files: Record<string, string | Uint8Array>, registry: Record<string, string>, env: Record<string, string> = {},
  platform = "win32", drives: string[] = []): DetectionHostPort & { queries: string[] } {
  const norm = (path: string) => resolve(path).toLowerCase();
  const table = new Map(Object.entries(files).map(([path, text]) => [norm(path), text]));
  const children = (path: string, kind: "dir" | "file") => {
    const prefix = resolve(path) + sep, names = new Map<string, string>();
    for (const file of Object.keys(files).map(file => resolve(file))) {
      if (!file.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const rest = file.slice(prefix.length).split(sep);
      if (kind === "file" ? rest.length === 1 : rest.length > 1) names.set(rest[0]!.toLowerCase(), rest[0]!);
    }
    return [...names.values()];
  };
  const queries: string[] = [];
  return { platform, queries, env: name => env[name],
    registry: async (key, recursive) => { queries.push(`${key}${recursive ? " /s" : ""}`); return registry[key] ?? null; },
    readText: (path, max) => { const text = table.get(norm(path)); return typeof text === "string" && text.length <= max ? text : null; },
    readBinary: (path, max) => { const bytes = table.get(norm(path)); return bytes instanceof Uint8Array && bytes.length <= max ? bytes : null; },
    drives: async () => drives,
    isFile: path => table.has(norm(path)),
    directories: path => { const list = children(path, "dir"); return list.length ? list : null; },
    files: path => { const list = children(path, "file"); return list.length ? list : null; } };
}

test("QSettings values decode MO2's @ByteArray, escapes, quotes and comments", () => {
  expect(decodeQSettingsValue("@ByteArray(X:\\\\Games\\\\Cyberpunk 2077)")).toBe("X:\\Games\\Cyberpunk 2077");
  expect(decodeQSettingsValue("\"a;b, c\"")).toBe("a;b, c");
  expect(decodeQSettingsValue("value ; trailing comment")).toBe("value");
  expect(decodeQSettingsValue("@@literal")).toBe("@literal");
  const ini = parseQSettingsIni("[General]\r\ngameName=Cyberpunk 2077\r\n[handlers]\r\n1\\executable=X:\\\\MO2\\\\ModOrganizer.exe\r\n");
  expect(ini.get("general")?.get("gamename")).toBe("Cyberpunk 2077");
  expect(ini.get("handlers")?.get("1/executable")).toBe("X:\\MO2\\ModOrganizer.exe");
});

test("MO2 paths default to %BASE_DIR%/<name> and honour configured overrides", () => {
  const plain = describeMo2Instance("[General]\ngameName=Cyberpunk 2077\nselected_profile=@ByteArray(Main)\n",
    p("mo2"), "portable", "mo2", ["Main"]);
  expect(plain.paths).toEqual({ base: p("mo2"), mods: p("mo2", "mods"), profiles: p("mo2", "profiles"),
    overwrite: p("mo2", "overwrite"), downloads: p("mo2", "downloads") });
  expect(plain.managesCyberpunk).toBe(true);
  expect(plain.selectedProfile).toBe("Main");
  expect(plain.skipFileSuffixes).toEqual([".mohidden"]);
  expect(plain.skipDirectories).toEqual([".git"]);
  const custom = describeMo2Instance(`[Settings]\nbase_directory=${p("data").replaceAll("\\", "/")}\n` +
    `mod_directory=%BASE_DIR%/staged\noverwrite_directory=${p("elsewhere", "over").replaceAll("\\", "\\\\")}\n`,
  p("mo2"), "global", "Cyberpunk 2077");
  expect(custom.paths.base).toBe(p("data"));
  expect(custom.paths.mods).toBe(p("data", "staged"));
  expect(custom.paths.profiles).toBe(p("data", "profiles"));
  expect(custom.paths.overwrite).toBe(p("elsewhere", "over"));
  expect(custom.managesCyberpunk).toBe(false);
});

test("modlist.txt is highest priority first; separators, foreign rows and duplicates follow MO2", () => {
  const list = parseMo2Modlist("# generated\r\n+Top\r\n-Disabled\r\n+GROUP_separator\r\n*DLC\r\nBare\r\n+Top\r\n+overwrite\r\n");
  expect(list.entries.map(row => [row.name, row.enabled, row.kind, row.priority])).toEqual([
    ["Top", true, "mod", 4], ["Disabled", false, "mod", 3], ["GROUP_separator", true, "separator", 2],
    ["DLC", true, "foreign", 1], ["Bare", true, "mod", 0]]);
  expect(list.overwritePriority).toBe(5);
  expect(list.notes).toEqual([{ code: "duplicate_ignored", line: 7 }, { code: "overwrite_row_ignored", line: 8 }]);
});

test("download handler ini lists handler executables", () => {
  expect(parseNxmHandlerIni("[handlers]\nsize=2\n1\\games=cyberpunk2077\n1\\executable=X:\\\\MO2\\\\ModOrganizer.exe\n" +
    "2\\executable=X:\\\\Other\\\\tool.exe\n2\\games=\"a,b\"\n")).toEqual([
    { executable: "X:\\MO2\\ModOrganizer.exe", games: ["cyberpunk2077"] },
    { executable: "X:\\Other\\tool.exe", games: ["a", "b"] }]);
});

test("reg query and Valve KeyValues parsers handle current and legacy layouts", () => {
  const reg = parseRegQuery("\r\nHKEY_CURRENT_USER\\Software\\Classes\\nxm\\shell\\open\\command\r\n" +
    "    (Default)    REG_SZ    \"X:\\MO2\\nxmhandler.exe\" \"%1\"\r\n\r\n");
  expect(reg[0]!.values[0]).toEqual({ name: "", type: "REG_SZ", data: "\"X:\\MO2\\nxmhandler.exe\" \"%1\"" });
  expect(steamLibraryPaths(parseVdf('"libraryfolders"\n{\n "0"\n {\n  "path" "X:\\\\Steam"\n  "apps" { "1" "2" }\n }\n' +
    ' "1" { "path" "Y:\\\\Lib" }\n}\n'))).toEqual(["X:\\Steam", "Y:\\Lib"]);
  expect(steamLibraryPaths(parseVdf('"LibraryFolders"\n{\n "TimeNextStatsReport" "1"\n "1" "Z:\\\\Old"\n}\n')))
    .toEqual(["Z:\\Old"]);
  expect(steamInstallDir(parseVdf('"AppState" { "appid" "1091500" "installdir" "Cyberpunk 2077" }'))).toBe("Cyberpunk 2077");
  expect(steamInstallDir(parseVdf('"AppState" { "installdir" "..\\\\escape" }'))).toBeNull();
});

test("game detection confirms every Steam, GOG, Epic and MO2 lead by executable and merges evidence", async () => {
  const steamGame = p("steamlib", "steamapps", "common", "Cyberpunk 2077"), gogGame = p("gog", "Cyberpunk 2077");
  const host = fakeHost({
    [p("steam", "steamapps", "libraryfolders.vdf")]: `"libraryfolders" { "0" { "path" "${p("steam").replaceAll("\\", "\\\\")}" } "1" { "path" "${p("steamlib").replaceAll("\\", "\\\\")}" } }`,
    [p("steamlib", "steamapps", "appmanifest_1091500.acf")]: '"AppState" { "installdir" "Cyberpunk 2077" }',
    [exe(steamGame)]: "", [exe(gogGame)]: "",
    [p("programdata", "Epic", "EpicGamesLauncher", "Data", "Manifests", "A.item")]:
      JSON.stringify({ DisplayName: "Cyberpunk 2077", AppName: "Ginger", InstallLocation: p("epic", "Missing"),
        LaunchExecutable: "bin/x64/Cyberpunk2077.exe" }),
    [p("programdata", "Epic", "EpicGamesLauncher", "Data", "Manifests", "B.item")]:
      JSON.stringify({ DisplayName: "Other", InstallLocation: p("epic", "Other"), LaunchExecutable: "Other.exe" }),
  }, {
    "HKCU\\Software\\Valve\\Steam": `HKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    ${p("steam").replaceAll("\\", "/")}\r\n`,
    "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games": [
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1423049311",
      "    gameName    REG_SZ    Cyberpunk 2077", `    path    REG_SZ    ${gogGame}`, "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1256837418",
      "    gameName    REG_SZ    Cyberpunk 2077: Phantom Liberty", `    path    REG_SZ    ${gogGame}`, "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1",
      "    gameName    REG_SZ    Another Game", `    path    REG_SZ    ${p("gog", "Another")}`, ""].join("\r\n"),
  }, { ProgramData: p("programdata") });
  const mo2 = { schema: "xfs/mo2-instance-detection-1" as const, supported: true, issues: [], limitations: [],
    instances: [describeMo2Instance(`[General]\ngameName=Cyberpunk 2077\ngamePath=@ByteArray(${gogGame.replaceAll("\\", "\\\\")})\n`,
      p("mo2"), "portable", "mo2")] };
  const result = await detectGameInstalls(host, mo2);
  expect(result.candidates.map(row => [row.root, row.evidence.map(e => e.source)])).toEqual([
    [gogGame, ["gog", "gog", "mo2"]], [steamGame, ["steam"]]]);
  expect(result.rejected).toEqual([{ root: p("epic", "Missing"), source: "epic" }]);
  expect(host.queries).toContain("HKLM\\SOFTWARE\\GOG.com\\Games /s");
  const other = await detectGameInstalls(fakeHost({}, {}, {}, "linux"));
  expect(other.supported).toBe(false);
  expect(other.issues[0]?.code).toBe("unsupported_platform");
});

const utf16 = (text: string) => { const bytes = new Uint8Array(text.length * 2); text.split("").forEach((ch, i) => {
  bytes[i * 2] = ch.charCodeAt(0) & 0xff; bytes[i * 2 + 1] = ch.charCodeAt(0) >> 8; }); return bytes; };
/** A `.GamingRoot` as the Xbox app writes it (layout observed on two drives): "RGBX", uint32 1, NUL-terminated UTF-16LE paths. */
const gamingRoot = (...paths: string[]) => new Uint8Array([...new TextEncoder().encode("RGBX"), 1, 0, 0, 0,
  ...paths.flatMap(path => [...utf16(path), 0, 0])]);
const vdfPath = (path: string) => path.replaceAll("\\", "\\\\");
const bom = "\uFEFF";

test("Xbox, drive, Epic and BOM/CRLF inputs parse the way their writers lay them out", () => {
  expect(parseGamingRoot(gamingRoot("XboxGames"))).toEqual(["XboxGames"]);
  expect(parseGamingRoot(gamingRoot("Games\\GamePass"))).toEqual(["Games\\GamePass"]);
  expect(parseGamingRoot(gamingRoot("..\\escape", "C:\\absolute", "\\rooted", "Ok"))).toEqual(["Ok"]);
  expect(parseGamingRoot(new TextEncoder().encode("not a gaming root"))).toBeNull();
  expect(parseMountedDrives(["", "HKEY_LOCAL_MACHINE\\SYSTEM\\MountedDevices",
    "    \\DosDevices\\C:    REG_BINARY    444D494F3A49443A", "    \\??\\Volume{6c1de7f1-04e5}    REG_BINARY    5F003F00",
    "    \\DosDevices\\f:    REG_BINARY    6E320983", ""].join("\r\n"))).toEqual(["C:\\", "F:\\"]);
  expect(parseEpicManifest(`${bom}{\r\n\t"InstallLocation": "X:\\\\Epic\\\\Cyberpunk2077",\r\n\t"bIsIncompleteInstall": true\r\n}`))
    .toMatchObject({ installLocation: "X:\\Epic\\Cyberpunk2077", incomplete: true });
  expect(parseEpicManifest('{"InstallLocation": ""}')).toBeNull();
  expect(parseEpicInstallList(`${bom}{"InstallationList":[{"InstallLocation":"X:\\\\A","AppName":"a"},{"AppName":"b"}]}`))
    .toEqual([{ appName: "a", installLocation: "X:\\A" }]);
  expect(parseEpicInstallList("{ not json")).toEqual([]);
  expect(steamInstallDir(parseVdf(`${bom}"AppState"\r\n{\r\n\t"appid"\t\t"1091500"\r\n\t"InstallDir"\t\t"Cyberpunk 2077"\r\n}\r\n`)))
    .toBe("Cyberpunk 2077");
});

test("Steam detection survives registry, library-file, manifest-case, BOM/CRLF and unicode variations", async () => {
  const steam = p("Program Files (x86)", "Steam"), library = p("Bibliothèque ゲーム");
  const game = join(library, "steamapps", "common", "Cyberpunk 2077");
  const host = fakeHost({
    // Only the config\ copy of libraryfolders.vdf exists, with a BOM, CRLF endings and a unicode library.
    [p("Program Files (x86)", "Steam", "config", "libraryfolders.vdf")]:
      `${bom}"libraryfolders"\r\n{\r\n\t"0"\r\n\t{\r\n\t\t"path"\t\t"${vdfPath(steam)}"\r\n\t}\r\n\t"1"\r\n\t{\r\n\t\t"path"\t\t"${vdfPath(library)}"\r\n\t}\r\n}\r\n`,
    // The manifest is in the second library; its installdir key and value differ in case from the folder on disk.
    [join(library, "steamapps", "appmanifest_1091500.acf")]: `${bom}"AppState"\r\n{\r\n\t"InstallDir"\t\t"cyberpunk 2077"\r\n}\r\n`,
    [exe(game)]: "",
  }, {
    // HKCU SteamPath came back through the console code page with a lost character; HKLM InstallPath is intact.
    "HKCU\\Software\\Valve\\Steam": "HKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/st?am\r\n",
    "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam": `HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam\r\n    InstallPath    REG_SZ    ${steam}\r\n`,
  });
  const result = await detectGameInstalls(host);
  expect(result.candidates.map(row => [row.root, row.evidence])).toEqual([[game, [{ source: "steam", detail: "Steam app 1091500" }]]]);
  expect(result.issues.map(row => [row.source, row.code])).toEqual([["steam", "registry_text_unreadable"]]);

  // No registry record at all: the default Program Files folder is still searched.
  const fallback = await detectGameInstalls(fakeHost({
    [p("pf86", "Steam", "steamapps", "appmanifest_1091500.acf")]: '"AppState" { "installdir" "Cyberpunk 2077" }',
    [exe(p("pf86", "Steam", "steamapps", "common", "Cyberpunk 2077"))]: "",
  }, {}, { "ProgramFiles(x86)": p("pf86") }));
  expect(fallback.candidates.map(row => row.root)).toEqual([p("pf86", "Steam", "steamapps", "common", "Cyberpunk 2077")]);
});

test("Epic detection skips unfinished installs, follows moved installs and keeps several copies apart", async () => {
  const data = p("relocated", "EpicData"), manifests = join(data, "Manifests");
  const moved = p("games", "Cyberpunk2077"), second = p("epic2", "Cyberpunk2077"), unfinished = p("epic", "Downloading");
  const item = (fields: Record<string, unknown>) => `{\r\n${Object.entries(fields)
    .map(([name, value]) => `\t"${name}": ${JSON.stringify(value)}`).join(",\r\n")}\r\n}`;
  const host = fakeHost({
    [join(manifests, "A.item")]: item({ DisplayName: "Cyberpunk 2077", AppName: "fixture-app", InstallLocation: p("epic", "OldPlace"),
      LaunchExecutable: "bin/x64/Cyberpunk2077.exe", bIsIncompleteInstall: false }),
    [join(manifests, "B.item")]: item({ DisplayName: "Cyberpunk 2077", AppName: "fixture-app-2", InstallLocation: second,
      LaunchExecutable: "bin\\x64\\Cyberpunk2077.exe", bIsIncompleteInstall: false }),
    [join(manifests, "C.item")]: item({ DisplayName: "Cyberpunk 2077: Phantom Liberty", AppName: "fixture-dlc", InstallLocation: second,
      LaunchExecutable: "", bIsIncompleteInstall: false }),
    [join(manifests, "D.item")]: `${bom}${item({ DisplayName: "Cyberpunk 2077", AppName: "fixture-app-3", InstallLocation: unfinished,
      LaunchExecutable: "bin/x64/Cyberpunk2077.exe", bIsIncompleteInstall: true })}`,
    [p("programdata", "Epic", "UnrealEngineLauncher", "LauncherInstalled.dat")]: JSON.stringify({ InstallationList: [
      { InstallLocation: moved, AppName: "fixture-app" }, { InstallLocation: unfinished, AppName: "fixture-app-3" },
      { InstallLocation: p("epic", "Unrelated"), AppName: "other-game" }] }),
    [exe(moved)]: "", [exe(second)]: "", [exe(unfinished)]: "", [p("epic", "Unrelated", "Game.exe")]: "",
  }, { "HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher":
    `HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher\r\n    AppDataPath    REG_SZ    ${data}${sep}\r\n` },
  { ProgramData: p("programdata") });
  const result = await detectGameInstalls(host);
  expect(result.candidates.map(row => [row.root, row.evidence.map(e => e.detail)])).toEqual([
    [second, ["Epic app fixture-app-2", "Epic app fixture-dlc"]], [moved, ["Epic install list (fixture-app)"]]]);
  expect(result.rejected).toEqual([{ root: p("epic", "OldPlace"), source: "epic" }, { root: unfinished, source: "epic" }]);
  expect(result.issues.map(row => row.code)).toEqual(["install_incomplete"]);
});

test("Xbox app copies are recognised from library folders and packages, reported plainly and never offered", async () => {
  const xbox = p("c", "XboxGames", "Cyberpunk 2077", "Content"), gog = p("f", "GamePass", "Cyberpunk 2077 GOG");
  const host = fakeHost({
    [p("c", ".GamingRoot")]: gamingRoot("XboxGames"), [p("f", ".GamingRoot")]: gamingRoot("GamePass"),
    [join(xbox, "MicrosoftGame.config")]: "", [exe(xbox)]: "",
    [p("f", "GamePass", "Other Game", "Content", "MicrosoftGame.config")]: "",
    // A GOG copy that happens to sit inside an Xbox library folder is not an Xbox app install.
    [exe(gog)]: "",
  }, { "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games": ["HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1423049311",
    `    path    REG_SZ    ${gog}`, ""].join("\r\n") }, {}, "win32", [p("c"), p("f"), p("empty")]);
  const mo2 = { schema: "xfs/mo2-instance-detection-1" as const, supported: true, issues: [], limitations: [], instances: [
    describeMo2Instance(`[General]\ngameName=Cyberpunk 2077\ngamePath=@ByteArray(${xbox.replaceAll("\\", "\\\\")})\n`, p("mo2"), "portable", "mo2"),
    describeMo2Instance(`[General]\ngameName=Cyberpunk 2077\ngamePath=@ByteArray(${p("WindowsApps", "Pkg").replaceAll("\\", "\\\\")})\n`,
      p("mo2b"), "portable", "mo2b")] };
  const result = await detectGameInstalls(host, mo2);
  expect(result.candidates.map(row => row.root)).toEqual([gog]);
  expect(result.unsupported.map(row => [row.source, row.root])).toEqual([["xbox", xbox], ["xbox", p("WindowsApps", "Pkg")]]);
  expect(result.unsupported[0]!.message).toBe(XBOX_UNSUPPORTED_MESSAGE);
  expect(XBOX_UNSUPPORTED_MESSAGE).toMatch(/XF Eye Artistry needs ArchiveXL/);
  expect(XBOX_UNSUPPORTED_MESSAGE).toMatch(/Install Cyberpunk 2077 from Steam, GOG or Epic Games, then choose that folder\.$/);
  expect(result.issues.map(row => [row.source, row.code])).toEqual([["xbox", "store_unsupported"]]);
  expect(result.rejected).toEqual([]);

  // Only a Gaming Services package registration (for example a WindowsApps install): no folder to name.
  const packaged = await detectGameInstalls(fakeHost({}, { "HKLM\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Package": [
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Package",
    "    Fixture.Cyberpunk2077_1.0.0.0_x64__fixture    REG_SZ    {00000000-0000-0000-0000-000000000000}#Fixture.Cyberpunk2077_fixture",
    "    Fixture.OtherGame_1.0.0.0_x64__fixture    REG_SZ    {00000000-0000-0000-0000-000000000001}#Fixture.OtherGame_fixture", ""].join("\r\n") }));
  expect(packaged.unsupported.map(row => [row.root, row.detail]))
    .toEqual([[null, "Xbox app package Fixture.Cyberpunk2077_1.0.0.0_x64__fixture"]]);
  expect(packaged.candidates).toEqual([]);
});

test("MO2 detection finds global instances and portable instances named by the download handler", async () => {
  const local = p("local");
  const host = fakeHost({
    [p("local", "ModOrganizer", "Cyberpunk 2077", "ModOrganizer.ini")]: "[General]\ngameName=Cyberpunk 2077\n",
    [p("local", "ModOrganizer", "Cyberpunk 2077", "profiles", "Default", "modlist.txt")]: "",
    [p("local", "ModOrganizer", "Skyrim", "ModOrganizer.ini")]: "[General]\ngameName=Skyrim Special Edition\n",
    [p("local", "ModOrganizer", "nxmhandler.log")]: "",
    [p("portable", "ModOrganizer.ini")]: "[General]\ngameName=Cyberpunk 2077\nselected_profile=@ByteArray(Main)\n",
    [p("portable", "nxmhandler.exe")]: "",
    [p("portable", "nxmhandler.ini")]: `[handlers]\n1\\executable=${p("second", "ModOrganizer.exe").replaceAll("\\", "\\\\")}\n`,
    [p("portable", "profiles", "Main", "modlist.txt")]: "+A\n",
    [p("portable", "profiles", "Main", "settings.ini")]: "",
    [p("portable", "profiles", "Empty", "settings.ini")]: "",
    [p("second", "ModOrganizer.ini")]: "[General]\ngameName=Cyberpunk 2077\n",
  }, { "HKCU\\Software\\Classes\\nxm\\shell\\open\\command":
    `HKEY_CURRENT_USER\\Software\\Classes\\nxm\\shell\\open\\command\r\n    (Default)    REG_SZ    "${p("portable", "nxmhandler.exe")}" "%1"\r\n` },
  { LOCALAPPDATA: local });
  const result = await detectMo2Instances(host);
  expect(result.instances.map(row => [row.kind, row.name, row.managesCyberpunk])).toEqual([
    ["global", "Cyberpunk 2077", true], ["portable", "portable", true], ["portable", "second", true],
    ["global", "Skyrim", false]]);
  expect(result.instances.find(row => row.name === "portable")?.profiles).toEqual(["Main"]);
  expect(result.instances.find(row => row.name === "portable")?.selectedProfile).toBe("Main");
});
