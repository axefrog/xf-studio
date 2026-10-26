import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { resolveVortexDataFolders, splitVortexCommandLine, vortexLastRunUserData, vortexStartupUserData, type VortexDataFacts } from "../src/installation/vortex-data";
import { gatherVortexDataFacts, parseVortexLaunchSnapshots, readWindowsVortexLaunches, VORTEX_LAUNCH_SCRIPT } from "../src/installation/host/vortex-data-host";
import { inspectVortexSetup, readVortexStateFolder } from "../src/installation/host/vortex-host";
import { readVortexMultiUser, stateFromPairs } from "../src/installation/vortex-state";
import { tempDir } from "./temp-dir";

const fixtures = join(import.meta.dir, "fixtures", "vortex");
const facts: VortexDataFacts = JSON.parse(readFileSync(join(fixtures, "data-discovery.json"), "utf8"));
const sandbox = join(fixtures, "sandbox-023");
const put = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };

test("Vortex data leads follow process, shortcut, startup, shared, last log, default order", () => {
  const candidates = resolveVortexDataFolders(facts, win32);
  expect(candidates.map(row => [row.source, row.path, row.kind])).toEqual([
    ["process", "C:\\Fixture\\Live Data", "custom"],
    ["shortcut", "C:\\Fixture\\Shortcut Data", "custom"],
    ["startup", "C:\\Fixture\\Startup Data", "custom"],
    ["shared", "C:\\Fixture\\ProgramData\\vortex", "shared"],
    ["last-run-log", "C:\\Fixture\\Previous Data", "custom"],
    ["default", "C:\\Fixture\\Roaming\\Vortex", "user"],
  ]);
  expect(candidates[0]?.reason).toContain("--user-data");
  expect(resolveVortexDataFolders({ ...facts, sharedMultiUser: false }, win32).some(row => row.source === "shared")).toBe(false);
  expect(resolveVortexDataFolders({ ...facts, userMultiUser: false }, win32).some(row => row.source === "shared")).toBe(false);
  expect(resolveVortexDataFolders({ ...facts, platform: "posix" }, win32).some(row => row.source === "shared")).toBe(false);
  const defaultLog = resolveVortexDataFolders({ platform: "win32", appData: facts.appData, lastRunUserData: "C:/Fixture/Roaming/Vortex" }, win32);
  expect(defaultLog.map(row => [row.source, row.kind])).toEqual([["last-run-log", "user"]]);
});

test("launch precedence, rejection of relative paths, last CLI option, termination, and case-insensitive deduplication", () => {
  const only = (args: string) => resolveVortexDataFolders({ ...facts, processes: [], shortcuts: [{ target: "C:/Fixture/App/Vortex.exe", arguments: args }] }, win32);
  expect(only('--user-data old --user-data="C:/Fixture/Data Space"')[0]?.path).toBe("C:\\Fixture\\Data Space");
  expect(only('--user-data="../Data Space"')[0]?.source).toBe("startup");
  expect(only('-- --user-data C:/ignored')[0]?.path).toBe(facts.startupUserData!);
  expect(only("")[0]?.source).toBe("shortcut");
  expect(only('--user-data "C:/Fixture/Startup Data/"').filter(row => row.path.toLowerCase().includes("startup data"))).toHaveLength(1);
  const defaults = resolveVortexDataFolders({ ...facts, startupUserData: undefined, userMultiUser: true,
    processes: [{ executable: "C:/Fixture/App/Vortex.exe", commandLine: '"C:/Fixture/App/Vortex.exe"' }] }, win32);
  expect([defaults[0]?.source, defaults[0]?.kind]).toEqual(["process", "shared"]);
  expect(only("--user-data")[0]?.source).toBe("startup");
  expect(only('--user-data "unfinished')[0]?.source).toBe("startup");
});

test("Windows command lines preserve quoted spaces, escaped quotes and trailing backslashes", () => {
  expect(splitVortexCommandLine(String.raw`"C:\App Space\Vortex.exe" --user-data="C:\Data Space\\" --profile fixture`))
    .toEqual([String.raw`C:\App Space\Vortex.exe`, "--user-data=C:\\Data Space\\", "--profile", "fixture"]);
  expect(splitVortexCommandLine(String.raw`--user-data "C:\with\"quote"`)).toEqual(["--user-data", 'C:\\with"quote']);
  expect(splitVortexCommandLine('--user-data ""')).toEqual(["--user-data", ""]);
});

test("startup settings and storage log use Vortex's actual field and message; newest line wins", () => {
  expect(vortexStartupUserData('{"userData":"C:/Fixture/Data","storeVersion":"2.9.0"}')).toBe("C:/Fixture/Data");
  for (const text of ["broken", "null", '{"user-data":"C:/wrong"}', '{"userData":false}']) expect(vortexStartupUserData(text)).toBeUndefined();
  expect(vortexLastRunUserData("2026 [INFO] [MAIN] using C:/Fixture/Old as the storage directory \r\n2026 [INFO] [MAIN] using C:/Fixture/New Data as the storage directory \r\n"))
    .toBe("C:/Fixture/New Data");
  expect(vortexLastRunUserData("2026 [DEBG] using C:/wrong as the storage directory\n")).toBeUndefined();
});

test("multi-user flag is user###multiUser in the base/shared database, with missing distinct from false", () => {
  expect(readVortexMultiUser(stateFromPairs([["user###multiUser", "true"]]).state)).toBe(true);
  expect(readVortexMultiUser(stateFromPairs([["user###multiUser", "false"]]).state)).toBe(false);
  expect(readVortexMultiUser({})).toBeUndefined();
});

test("host gathers startup and only the last 256 KB of the base log, with injected launch facts", async () => {
  const base = tempDir("vortex-data-facts-"), appData = join(base, "Roaming");
  put(join(appData, "Vortex", "startup.json"), '{"userData":"C:/Fixture/Startup"}');
  put(join(appData, "Vortex", "vortex.log"), "[INFO] [MAIN] using C:/Fixture/TooOld as the storage directory\n" + "x".repeat(300 * 1024));
  const env = (name: string) => ({ APPDATA: appData, USERPROFILE: base } as Record<string, string>)[name];
  const signal = new AbortController().signal;
  const read = () => gatherVortexDataFacts(env, signal, async (roots, received) => {
    expect(received).toBe(signal); expect(roots.some(root => root.includes("Desktop"))).toBe(true);
    return { processes: facts.processes };
  });
  expect((await read()).lastRunUserData).toBeUndefined();
  put(join(appData, "Vortex", "vortex.log"), "x".repeat(300 * 1024) + "\n[INFO] [MAIN] using C:/Fixture/Recent as the storage directory \r\n");
  const result = await read();
  expect(result.startupUserData).toBe("C:/Fixture/Startup");
  expect(result.lastRunUserData).toBe("C:/Fixture/Recent");
});

test("host and state reads propagate AbortSignal cancellation", async () => {
  const controller = new AbortController();
  const pending = gatherVortexDataFacts(() => undefined, controller.signal, async (_roots, signal) => {
    controller.abort(new Error("fixture cancelled")); signal.throwIfAborted(); return {};
  });
  if (process.platform === "win32") await expect(pending).rejects.toThrow("fixture cancelled"); else await pending;
  controller.abort(new Error("fixture cancelled"));
  await expect(readWindowsVortexLaunches([], controller.signal)).rejects.toThrow("fixture cancelled");
  await expect(inspectVortexSetup("C:/Fixture/Game", () => undefined, { signal: controller.signal })).rejects.toThrow("fixture cancelled");
  await expect(readVortexStateFolder({ path: "C:/Fixture/Data", kind: "custom" }, "cyberpunk2077", { signal: controller.signal })).rejects.toThrow("fixture cancelled");
});

test("a timed-out shortcut scan keeps already gathered process/shortcut evidence", () => {
  const processOnly = JSON.stringify({ processes: facts.processes, shortcuts: [] });
  const withShortcut = JSON.stringify({ processes: facts.processes, shortcuts: facts.shortcuts });
  expect(parseVortexLaunchSnapshots(processOnly + '\n{"processes":')).toEqual({ processes: facts.processes, shortcuts: [] });
  expect(parseVortexLaunchSnapshots(processOnly + "\n" + withShortcut + '\n{"processes":')).toEqual({ processes: facts.processes, shortcuts: facts.shortcuts });
  expect(parseVortexLaunchSnapshots('{"processes":[null,{},1],"shortcuts":[false,{}]}')).toEqual({ processes: [], shortcuts: [] });
});

test.skipIf(process.platform !== "win32")("Windows adapter reads an arbitrarily named fixture shortcut and process command line", async () => {
  const base = tempDir("vortex-shortcut-"), target = join(base, "App Space", "Vortex.exe"), custom = join(base, "Données Space");
  const script = String.raw`
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $env:XFS_VORTEX_FIXTURE_ROOT 'My mods.lnk'))
    $link.TargetPath = $env:XFS_VORTEX_FIXTURE_TARGET
    $link.Arguments = '--user-data "' + $env:XFS_VORTEX_FIXTURE_DATA + '"'
    $link.Save()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    function Get-CimInstance {
      param($ClassName, $Filter)
      [pscustomobject]@{ ProcessId = 123; ExecutablePath = $env:XFS_VORTEX_FIXTURE_TARGET;
        CommandLine = '"' + $env:XFS_VORTEX_FIXTURE_TARGET + '" --user-data "' + $env:XFS_VORTEX_FIXTURE_DATA + '"' }
    }
  ` + VORTEX_LAUNCH_SCRIPT;
  const child = Bun.spawn(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, XFS_VORTEX_SHORTCUT_ROOTS: JSON.stringify([base]), XFS_VORTEX_FIXTURE_ROOT: base,
      XFS_VORTEX_KNOWN_FOLDERS: "0",
      XFS_VORTEX_FIXTURE_TARGET: target, XFS_VORTEX_FIXTURE_DATA: custom },
    stdout: "pipe", stderr: "pipe", timeout: 4000,
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exit, stderr).toBe(0);
  const result = JSON.parse(stdout.replace(/^\uFEFF/, "").trim().split(/\r?\n/).at(-1)!);
  expect(result.shortcuts.filter((row: { target: string }) => row.target === target)).toEqual([{ target, arguments: `--user-data "${custom}"` }]);
  expect(result.processes).toEqual([{ executable: target, commandLine: `"${target}" --user-data "${custom}"` }]);
});

test("inspection reads a custom process/shortcut/log database in place and reports why it won", async () => {
  const base = tempDir("vortex-custom-read-"), appData = join(base, "Roaming"), game = join(base, "Game");
  const custom = join(base, "Custom Data"), defaults = join(appData, "Vortex");
  cpSync(join(sandbox, "state.v2-closed"), join(custom, "state.v2"), { recursive: true });
  cpSync(join(sandbox, "state.v2-closed"), join(defaults, "state.v2"), { recursive: true });
  mkdirSync(game, { recursive: true }); cpSync(join(sandbox, "vortex.deployment.json"), join(game, "vortex.deployment.json"));
  const env = (name: string) => name === "APPDATA" ? appData : undefined;
  const target = join(base, "App", "Vortex.exe");
  const common = { platform: process.platform === "win32" ? "win32" : "posix", appData } as const;
  for (const dataFacts of [
    { ...common, processes: [{ executable: target, commandLine: `"${target}" --user-data "${custom}"` }] },
    { ...common, shortcuts: [{ target, arguments: `--user-data="${custom}"` }] },
    { ...common, lastRunUserData: custom },
  ]) {
    const setup = await inspectVortexSetup(game, env, { dataFacts });
    expect(setup.state?.folder).toBe(custom);
    expect([setup.state?.game.mods.size, setup.state?.current, setup.instanceMatches]).toEqual([3, true, true]);
    expect(setup.stateSelection?.matchedBy).toBe("instance");
    expect(setup.stateSelection?.candidate.source).toBe("processes" in dataFacts ? "process" : "shortcuts" in dataFacts ? "shortcut" : "last-run-log");
  }
  // Missing process data does not mask another readable candidate.
  const fallback = await inspectVortexSetup(game, env, { dataFacts: { ...common,
    processes: [{ executable: target, commandLine: `"${target}" --user-data "${join(base, "Missing")}"` }], lastRunUserData: custom } });
  expect(fallback.state?.folder).toBe(custom);
  // Matching the deploying instance outranks a stronger but unrelated launch lead.
  const unrelated = join(base, "Unrelated");
  put(join(unrelated, "temp", "state_backups_full", "hourly.json"), JSON.stringify({ app: { instanceId: "another-instance" },
    settings: { gameMode: { discovered: { cyberpunk2077: { path: game } } } } }));
  const matched = await inspectVortexSetup(game, env, { dataFacts: { ...common,
    processes: [{ executable: target, commandLine: `"${target}" --user-data "${unrelated}"` }], lastRunUserData: custom } });
  expect(matched.state?.folder).toBe(custom);
  expect(matched.stateSelection?.matchedBy).toBe("instance");
});

test("shared-mode base marker and shared false veto select the same folder as Vortex", async () => {
  const base = tempDir("vortex-shared-read-"), appData = join(base, "Roaming"), programData = join(base, "ProgramData"), game = join(base, "Game");
  mkdirSync(game, { recursive: true });
  const backup = (multiUser: boolean) => JSON.stringify({ user: { multiUser }, app: { instanceId: "fixture" }, settings: { gameMode: { discovered: { cyberpunk2077: { path: game } } } } });
  const userBackup = join(appData, "Vortex", "temp", "state_backups_full", "hourly.json");
  const sharedBackup = join(programData, "vortex", "temp", "state_backups_full", "hourly.json");
  put(userBackup, backup(true)); put(sharedBackup, backup(true));
  const env = (name: string) => ({ APPDATA: appData, ProgramData: programData } as Record<string, string>)[name];
  const dataFacts = { platform: "win32", appData, programData } as const;
  // Windows shared semantics are tested even on POSIX, with local native fixture paths.
  expect((await inspectVortexSetup(game, env, { dataFacts })).state?.kind).toBe("shared");
  put(sharedBackup, backup(false));
  expect((await inspectVortexSetup(game, env, { dataFacts })).state?.kind).toBe("user");
});

test("log discovery refuses backup-only folders and remote candidates", async () => {
  const base = tempDir("vortex-log-read-"), appData = join(base, "Roaming"), custom = join(base, "Old"), game = join(base, "Game");
  mkdirSync(game, { recursive: true });
  put(join(custom, "temp", "state_backups_full", "hourly.json"), JSON.stringify({ settings: { gameMode: { discovered: { cyberpunk2077: { path: game } } } } }));
  const dataFacts = { platform: process.platform === "win32" ? "win32" : "posix", appData, lastRunUserData: custom } as const;
  const inspect = (lastRunUserData: string) => inspectVortexSetup(game, () => undefined, { dataFacts: { ...dataFacts, lastRunUserData } });
  expect((await inspect(custom)).state).toBeNull();
  const remote = await inspect("//fixture.invalid/share/Vortex");
  expect(remote.state).toBeNull(); expect(remote.problems.some(text => text.includes("local drive"))).toBe(true);
});
