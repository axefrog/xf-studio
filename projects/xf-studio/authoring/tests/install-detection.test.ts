import { expect, test } from "bun:test";
import { join, resolve, sep } from "node:path";
import { decodeQSettingsValue, describeMo2Instance, parseMo2Modlist, parseNxmHandlerIni,
  parseQSettingsIni } from "../src/mo2-instance";
import { detectGameInstalls, detectMo2Instances, parseRegQuery, parseVdf, steamInstallDir, steamLibraryPaths,
  type DetectionHostPort } from "../src/install-detection";

// Synthetic, asset-free fixtures. Paths are placeholders under a fake drive, never a real machine.
const root = resolve("/xfs-fixture");
const p = (...parts: string[]) => join(root, ...parts);
const exe = (game: string) => join(game, "bin", "x64", "Cyberpunk2077.exe");

function fakeHost(files: Record<string, string>, registry: Record<string, string>, env: Record<string, string> = {},
  platform = "win32"): DetectionHostPort & { queries: string[] } {
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
    readText: (path, max) => { const text = table.get(norm(path)); return text !== undefined && text.length <= max ? text : null; },
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
