import { expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { defaultLocalSettings } from "../src/local-settings";
import { discoverSources } from "../src/source-discovery";
import { compareWithDeployment } from "../src/vortex-deployment";
import { inspectVortexSetup, isLocalFolder, readVortexManifests, readVortexStateFolder } from "../src/vortex-host";
import { readVortexGameState, resolveVortexInstallPath, stateFromPairs } from "../src/vortex-state";

const fixtures = join(import.meta.dir, "fixtures", "vortex");
const withFolder = (run: (base: string) => void) => {
  const base = mkdtempSync(join(tmpdir(), "xfs-vortex-test-"));
  try { run(base); } finally { rmSync(base, { recursive: true, force: true }); }
};
const withFolderAsync = async (run: (base: string) => Promise<void>) => {
  const base = mkdtempSync(join(tmpdir(), "xfs-vortex-test-"));
  try { await run(base); } finally { rmSync(base, { recursive: true, force: true }); }
};
const put = (path: string, content = "fixture", timeMs?: number) => {
  mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content);
  if (timeMs !== undefined) utimesSync(path, timeMs / 1000, timeMs / 1000);
};

/** Vortex state keys as its database stores them: Redux paths joined by ###, JSON leaf values. */
const pairs: [string, string][] = [
  ["app###instanceId", JSON.stringify("fixture-instance-0001")],
  ["settings###profiles###activeProfileId", JSON.stringify("p1")],
  ["settings###profiles###lastActiveProfile###cyberpunk2077", JSON.stringify("p1")],
  ["settings###mods###activator###cyberpunk2077", JSON.stringify("hardlink_activator")],
  ["settings###gameMode###discovered###cyberpunk2077###path", JSON.stringify("C:\\Games\\Cyberpunk 2077")],
  ["persistent###profiles###p1###gameId", JSON.stringify("cyberpunk2077")],
  ["persistent###profiles###p1###name", JSON.stringify("Default")],
  ["persistent###profiles###p1###modState###XF Test Mod A###enabled", "false"],
  ["persistent###profiles###p1###modState###XF Test Mod B-9001-1-0-1727000000###enabled", "true"],
  ["persistent###profiles###p2###gameId", JSON.stringify("skyrimse")],
  ["persistent###mods###cyberpunk2077###XF Test Mod A###installationPath", JSON.stringify("XF Test Mod A")],
  ["persistent###mods###cyberpunk2077###XF Test Mod A###attributes###name", JSON.stringify("XF Test Mod A")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###installationPath", JSON.stringify("XF Test Mod B-9001-1-0-1727000000")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###logicalFileName", JSON.stringify("XF Test Mod B main file")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###modId", "9001"],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###fileId", "42"],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###source", JSON.stringify("nexus")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###version", JSON.stringify("1.0")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###attributes###downloadGame", JSON.stringify("cyberpunk2077")],
  ["persistent###mods###cyberpunk2077###XF Test Mod B-9001-1-0-1727000000###rules", JSON.stringify([{ type: "after", reference: { id: "XF Test Mod A" } }])],
];

test("reads the active profile, enabled mods and Nexus identities from Vortex's state keys", () => {
  const { state, problems } = stateFromPairs(pairs);
  expect(problems).toEqual([]);
  const game = readVortexGameState(state, "cyberpunk2077");
  expect(game.instanceId).toBe("fixture-instance-0001");
  expect(game.profile).toEqual({ id: "p1", name: "Default", lastActivated: null });
  expect(game.profileActive).toBe(true);
  expect(game.profiles.map(p => p.id)).toEqual(["p1"]);
  expect(game.deploymentMethod).toBe("hardlink_activator");
  const b = game.mods.get("XF Test Mod B-9001-1-0-1727000000")!;
  expect(b).toEqual({ id: "XF Test Mod B-9001-1-0-1727000000", name: "XF Test Mod B main file", version: "1.0",
    nexus: { gameDomain: "cyberpunk2077", modId: 9001, fileId: 42 }, source: "nexus", enabled: true });
  expect(game.mods.get("XF Test Mod A")?.enabled).toBe(false);
  expect(game.mods.get("XF Test Mod A")?.nexus).toBeNull();
  // Another game's active profile: fall back to this game's last active one, and say it isn't the active one.
  const other = readVortexGameState(stateFromPairs([...pairs, ["settings###profiles###activeProfileId", JSON.stringify("p2")]]).state, "cyberpunk2077");
  expect(other.profile?.id).toBe("p1");
  expect(other.profileActive).toBe(false);
});

test("a key naming an object's prototype never reaches Object.prototype, and inherited names read as absent (VORTEX-01)", () => {
  const hostile: [string, string][] = [...pairs,
    ["__proto__###polluted", "true"],
    ["persistent###mods###cyberpunk2077###__proto__###attributes###name", JSON.stringify("polluted")],
    ["persistent###mods###cyberpunk2077###constructor###prototype###polluted", "true"],
    ["persistent###profiles###p1###modState###__proto__###enabled", "true"],
    // A JSON leaf that carries `__proto__` as data, merged into a tree.
    ["persistent###mods###cyberpunk2077###XF Test Mod A###attributes", '{"__proto__":{"polluted":true},"version":"2.0"}'],
  ];
  try {
    const { state, problems } = stateFromPairs(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(problems.filter(problem => problem.includes("prototype"))).toHaveLength(4);
    const game = readVortexGameState(state, "cyberpunk2077");
    expect([...game.mods.keys()].sort()).toEqual(["XF Test Mod A", "XF Test Mod B-9001-1-0-1727000000"]);
    expect(game.mods.get("XF Test Mod A")?.version).toBe("2.0");
    // A mod folder named after an inherited property is simply not there.
    expect(readVortexGameState(stateFromPairs([["persistent###profiles###p1###gameId", JSON.stringify("cyberpunk2077")],
      ["settings###profiles###activeProfileId", JSON.stringify("toString")]]).state, "cyberpunk2077").profile).toBeNull();
    // A JSON backup's objects come from JSON.parse, which keeps "__proto__" as an own key: it is skipped too.
    const backup = JSON.parse('{"persistent":{"mods":{"cyberpunk2077":{"__proto__":{"attributes":{"name":"x"}},"ok":{"attributes":{"name":"ok"}}}}}}');
    expect([...readVortexGameState(backup, "cyberpunk2077").mods.keys()]).toEqual(["ok"]);
  } finally { delete (Object.prototype as Record<string, unknown>).polluted; }
});

test("resolves the staging folder setting as Vortex does", () => {
  const win = (...parts: string[]) => parts.join("\\");
  const abs = (path: string) => /^[a-z]:\\/i.test(path);
  expect(resolveVortexInstallPath(null, "cyberpunk2077", "C:\\Data\\Vortex", "me", win, abs)).toBe("C:\\Data\\Vortex\\cyberpunk2077\\mods");
  expect(resolveVortexInstallPath("D:\\Vortex Mods\\{Game}", "cyberpunk2077", "C:\\Data\\Vortex", "me", win, abs)).toBe("D:\\Vortex Mods\\cyberpunk2077");
  expect(resolveVortexInstallPath("{game}\\staging", "cyberpunk2077", "C:\\Data\\Vortex", "me", win, abs)).toBe("C:\\Data\\Vortex\\cyberpunk2077\\staging");
  expect(isAbsolute(resolveVortexInstallPath(null, "g", tmpdir(), "u", join, isAbsolute))).toBe(true);
});

test("source discovery attributes Vortex-deployed game files to their mods and watches the manifest", () => withFolder(base => {
  const game = join(base, "game");
  mkdirSync(game, { recursive: true });
  copyFileSync(join(fixtures, "cyberpunk-hardlink.vortex.deployment.json"), join(game, "vortex.deployment.json"));
  put(join(game, "archive", "pc", "content", "basegame_1_engine.archive"));
  put(join(game, "archive", "pc", "mod", "XF Test Shared.archive"), "B", 1727000000000);
  put(join(game, "archive", "pc", "mod", "xf_test_a.archive"), "A", 1727000000000);
  put(join(game, "archive", "pc", "mod", "Hand Installed.archive"), "manual");
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" });
  expect(result.complete).toBe(true);
  const byPath = new Map(result.candidates.map(c => [c.virtualPath, c]));
  expect(byPath.get("archive/pc/mod/XF Test Shared.archive")?.providerName).toBe("XF Test Mod B-9001-1-0-1727000000");
  expect(byPath.get("archive/pc/mod/XF Test Shared.archive")?.deployedBy?.state).toBe("deployed");
  expect(byPath.get("archive/pc/mod/xf_test_a.archive")?.deployedBy?.modId).toBe("XF Test Mod A");
  // The provider stays the physical game folder: Vortex files are real files there, so archive order is unchanged.
  expect(byPath.get("archive/pc/mod/xf_test_a.archive")?.provider).toBe("game");
  expect(byPath.get("archive/pc/mod/Hand Installed.archive")?.providerName).toBe("Installed game");
  expect(byPath.get("archive/pc/mod/Hand Installed.archive")?.deployedBy).toBeUndefined();
  expect(byPath.get("archive/pc/content/basegame_1_engine.archive")?.deployedBy).toBeUndefined();
  expect(result.watched.some(w => w.path === join(game, "vortex.deployment.json") && w.stamp.startsWith("file|"))).toBe(true);
}));

test("a game folder without Vortex watches for a first deployment and reports nothing", () => withFolder(base => {
  const game = join(base, "game");
  put(join(game, "archive", "pc", "mod", "a.archive"));
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" });
  expect(result.candidates[0]?.deployedBy).toBeUndefined();
  expect(result.watched.find(w => w.path === join(game, "vortex.deployment.json"))?.stamp).toBe("missing");
  expect(readVortexManifests(game).deployment).toBeNull();
  // A corrupt manifest is a non-blocking note, never a failed scan.
  put(join(game, "vortex.deployment.json"), "{ not json");
  const broken = discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" });
  expect(broken.complete).toBe(true);
  expect(broken.issues.map(i => [i.code, i.blocking])).toEqual([["vortex_manifest_unreadable", false]]);
}));

test("inspecting a Vortex setup matches the deploying installation by instance id and reads its state backup", () => withFolderAsync(async base => {
  const game = join(base, "Games", "Cyberpunk 2077"), appData = join(base, "AppData"), programData = join(base, "ProgramData");
  mkdirSync(game, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(fixtures, "cyberpunk-hardlink.vortex.deployment.json"), "utf8"));
  const staging = join(appData, "Vortex", "cyberpunk2077", "mods");
  writeFileSync(join(game, "vortex.deployment.json"), JSON.stringify({ ...manifest, stagingPath: staging, targetPath: game }));
  put(join(staging, "__vortex_staging_folder"), JSON.stringify({ instance: "fixture-instance-0001", game: "cyberpunk2077" }));
  // The shared (multi-user) data folder belongs to another installation; the per-user one deployed.
  const backup = (instance: string) => JSON.stringify({ ...stateFromPairs([...pairs,
    ["app###instanceId", JSON.stringify(instance)], ["settings###gameMode###discovered###cyberpunk2077###path", JSON.stringify(game)]]).state });
  put(join(appData, "Vortex", "temp", "state_backups_full", "hourly.json"), backup("fixture-instance-0001"));
  put(join(programData, "vortex", "temp", "state_backups_full", "hourly.json"), backup("another-instance"));
  const env = (name: string) => ({ APPDATA: appData, ProgramData: programData, USERNAME: "user" } as Record<string, string>)[name];
  const setup = await inspectVortexSetup(game, env);
  expect(setup.deployed).toBe(true);
  expect(setup.manifests).toEqual([{ fileName: "vortex.deployment.json", modType: "", deploymentMethod: "hardlink_activator",
    deploymentTimeMs: 1727000100000, files: 5, instance: "fixture-instance-0001" }]);
  expect(setup.state?.kind).toBe("user");
  expect(setup.state?.source).toBe("backup");
  expect(setup.instanceMatches).toBe(true);
  expect(setup.managesThisFolder).toBe(true);
  expect(setup.stagingPath).toBe(staging);
  expect(setup.stagingMarker).toEqual({ instance: "fixture-instance-0001", game: "cyberpunk2077" });
  expect(setup.state?.game.mods.get("XF Test Mod B-9001-1-0-1727000000")?.nexus?.modId).toBe(9001);
  // No Vortex at all: nothing deployed, no state, no guesses.
  const none = await inspectVortexSetup(join(base, "elsewhere"), () => undefined);
  expect([none.deployed, none.state, none.stagingPath, none.instanceMatches]).toEqual([false, null, null, null]);
}));

// Experiment 023: what Vortex 2.7.1 actually wrote in Windows Sandbox (tests/fixtures/vortex/sandbox-023).
const sandbox = join(fixtures, "sandbox-023");
const observedFiles = (JSON.parse(readFileSync(join(sandbox, "game-folder.json"), "utf8")).files as { path: string; modifiedMs: number }[])
  .map(file => ({ virtualPath: file.path, modifiedMs: file.modifiedMs }));

test("a real Vortex deployment and closed state database attribute every deployed file and nothing else", () => withFolderAsync(async base => {
  const game = join(base, "game"), appData = join(base, "AppData");
  mkdirSync(game, { recursive: true });
  copyFileSync(join(sandbox, "vortex.deployment.json"), join(game, "vortex.deployment.json"));
  cpSync(join(sandbox, "state.v2-closed"), join(appData, "Vortex", "state.v2"), { recursive: true });
  const setup = await inspectVortexSetup(game, name => ({ APPDATA: appData } as Record<string, string>)[name]);
  expect(setup.manifests.map(row => [row.deploymentMethod, row.files])).toEqual([["hardlink_activator", 6]]);
  expect([setup.state?.source, setup.state?.databaseMode, setup.state?.current, setup.state?.gaps]).toEqual(["database", "manifest", true, []]);
  expect(setup.instanceMatches).toBe(true);
  // The sandbox's staging folder carried no marker (state was seeded, bypassing Vortex's manage-game flow).
  expect(setup.stagingMarker).toBeNull();
  const game023 = setup.state!.game;
  expect(game023.profile?.id).toBe("xfstest");
  expect(game023.profileActive).toBe(true);
  // Installed from local archives: named as Vortex's Mods page shows them (the archive's file name), no version and no
  // Nexus ids, even for a Nexus-style file name.
  expect([...game023.mods.values()].map(mod => [mod.id, mod.name, mod.version, mod.nexus, mod.enabled])).toEqual([
    ["XF Test Mod A", "XF Test Mod A.zip", null, null, true],
    ["XF Test Mod B-9001-1-0-1727000000", "XF Test Mod B-9001-1-0-1727000000.zip", null, null, true],
    ["XF Test Mod D", "XF Test Mod D.zip", null, null, true],
  ]);
  const report = compareWithDeployment(setup.deployment!, observedFiles, ["archive/pc/"], game023.mods, setup.state!.current);
  expect(report.attributed.map(row => [row.virtualPath, row.attribution.modId, row.attribution.state])).toEqual([
    ["archive/pc/mod/Preexisting.archive", "XF Test Mod B-9001-1-0-1727000000", "deployed"],
    ["archive/pc/mod/XF Test Shared.archive", "XF Test Mod B-9001-1-0-1727000000", "deployed"],
    ["archive/pc/mod/xf_test_a.archive", "XF Test Mod A", "deployed"],
    ["archive/pc/mod/xf_test_a.archive.xl", "XF Test Mod A", "deployed"],
    ["archive/pc/mod/xf_test_b.archive", "XF Test Mod B-9001-1-0-1727000000", "deployed"],
    ["archive/pc/mod/xf_test_d.archive", "XF Test Mod D", "deployed"],
  ]);
  // Hand-placed files, the file another tool dropped in, and the original Vortex moved aside are all left unmanaged.
  expect(report.unmanaged).toEqual(["archive/pc/content/basegame_1_engine.archive", "archive/pc/mod/Hand Installed.archive",
    "archive/pc/mod/Preexisting.archive.vortex_backup", "archive/pc/mod/XF Eye Artistry.archive", "bin/x64/Cyberpunk2077.exe", "vortex.deployment.json"]);
  expect([report.missing, report.changed, report.stale]).toEqual([[], [], []]);
}));

test("state read while Vortex runs is marked incomplete, so its missing mods are not reported as uninstalled", () => withFolderAsync(async base => {
  const folder = join(base, "Vortex"), db = join(folder, "state.v2");
  cpSync(join(sandbox, "state.v2-live"), db, { recursive: true });
  // Stand-ins for the MANIFEST and log Vortex held open: present in the listing, not readable as files.
  mkdirSync(join(db, "MANIFEST-000034")); mkdirSync(join(db, "000036.log"));
  const state = (await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077"))!;
  expect([state.source, state.databaseMode, state.current]).toEqual(["database", "all-files", false]);
  expect(state.gaps[0]).toContain("Vortex appears to be running");
  expect(state.game.mods.size).toBe(0);
  const deployment = readVortexManifests(sandbox).deployment!;
  expect(compareWithDeployment(deployment, observedFiles, ["archive/pc/"], state.game.mods, state.current).stale).toEqual([]);
  // Treated as current, the same state would call every deployed mod uninstalled.
  expect(compareWithDeployment(deployment, observedFiles, ["archive/pc/"], state.game.mods, true).stale.map(row => row.reason))
    .toEqual(["not-installed", "not-installed", "not-installed"]);
}));

test("a game-folder file changed after Vortex deployed it keeps the game folder as its provider (VORTEX-03)", () => withFolder(base => {
  const game = join(base, "game");
  mkdirSync(game, { recursive: true });
  copyFileSync(join(fixtures, "cyberpunk-hardlink.vortex.deployment.json"), join(game, "vortex.deployment.json"));
  put(join(game, "archive", "pc", "mod", "XF Test Shared.archive"), "B", 1727000000000);
  // Replaced by hand a day after the deployment.
  put(join(game, "archive", "pc", "mod", "xf_test_a.archive"), "not A any more", 1727086400000);
  const byPath = new Map(discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "direct" }).candidates.map(c => [c.virtualPath, c]));
  expect(byPath.get("archive/pc/mod/XF Test Shared.archive")?.providerName).toBe("XF Test Mod B-9001-1-0-1727000000");
  const replaced = byPath.get("archive/pc/mod/xf_test_a.archive")!;
  expect([replaced.providerName, replaced.deployedBy?.state, replaced.deployedBy?.modId]).toEqual(["Installed game", "changed", "XF Test Mod A"]);
  expect(replaced.priorityEvidence).toContain("changed after it was deployed");
}));

test("Vortex's state is read asynchronously, within a byte limit and a deadline, and kept for unchanged files (VORTEX-05)", () => withFolderAsync(async base => {
  const folder = join(base, "Vortex");
  cpSync(join(sandbox, "state.v2-closed"), join(folder, "state.v2"), { recursive: true });
  const pending = readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077");
  expect(pending).toBeInstanceOf(Promise);
  const full = (await pending)!;
  expect([full.source, full.current, full.game.mods.size]).toEqual(["database", true, 3]);
  // The same files again: the read is kept, not repeated.
  expect(await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077")).toBe(full);
  // A complete read kept is used even when time is short: it costs nothing.
  expect(await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077", { deadline: 0, now: () => 1 })).toBe(full);
  // Out of time before the first file of another folder: nothing is read, the state says why, and the partial read isn't kept.
  const other = join(base, "Other");
  cpSync(join(sandbox, "state.v2-closed"), join(other, "state.v2"), { recursive: true });
  const late = (await readVortexStateFolder({ path: other, kind: "user" }, "cyberpunk2077", { deadline: 0, now: () => 1 }))!;
  expect([late.current, late.game.mods.size]).toEqual([false, 0]);
  expect(late.gaps[0]).toContain("in the time a problem report allows");
  expect((await readVortexStateFolder({ path: other, kind: "user" }, "cyberpunk2077"))!.current).toBe(true);
  // Over the byte limit: the large files are left out, and the state says why.
  const small = (await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077", { maxStateBytes: 64 }))!;
  expect(small.current).toBe(false);
  expect(small.gaps).toContain("Vortex's state is larger than XF Studio reads, so some of it was left out.");
}));

test("a newer backup is read when the database is incomplete, even though the database lists mods (VORTEX-08)", () => withFolderAsync(async base => {
  const folder = join(base, "Vortex"), db = join(folder, "state.v2");
  cpSync(join(sandbox, "state.v2-closed"), db, { recursive: true });
  // A log Vortex holds open while it runs: the database reads with a gap, and still lists the three mods it had.
  mkdirSync(join(db, "000099.log"));
  const backupPath = join(folder, "temp", "state_backups_full", "hourly.json");
  const backup = stateFromPairs(pairs).state;
  const newest = Math.max(...readdirSync(db).map(name => statSync(join(db, name)).mtimeMs));
  put(backupPath, JSON.stringify(backup), newest + 60_000);
  const newer = (await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077"))!;
  expect([newer.source, newer.current]).toEqual(["backup", false]);
  expect(newer.game.mods.has("XF Test Mod B-9001-1-0-1727000000")).toBe(true);
  // A backup older than the database files read is not preferred over them.
  utimesSync(backupPath, (newest - 3_600_000) / 1000, (newest - 3_600_000) / 1000);
  const older = (await readVortexStateFolder({ path: folder, kind: "user" }, "cyberpunk2077"))!;
  expect([older.source, older.game.mods.size]).toEqual(["database", 3]);
  expect(older.gaps[0]).toContain("Vortex appears to be running");
}));

test("a staging folder that isn't on a local drive is never opened (VORTEX-06)", () => withFolderAsync(async base => {
  expect([String.raw`C:\Vortex\mods`, "d:/mods", "/home/x/mods"].map(isLocalFolder)).toEqual([true, true, true]);
  expect([String.raw`\\server\share\mods`, "//server/share/mods", String.raw`\\?\UNC\server\x`, String.raw`\\.\pipe\x`, "mods", ""]
    .map(isLocalFolder)).toEqual([false, false, false, false, false, false]);
  const game = join(base, "game"), share = String.raw`\\xfs-test.invalid\share\mods`;
  mkdirSync(game, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(fixtures, "cyberpunk-hardlink.vortex.deployment.json"), "utf8"));
  writeFileSync(join(game, "vortex.deployment.json"), JSON.stringify({ ...manifest, stagingPath: share }));
  const setup = await inspectVortexSetup(game, () => undefined);
  expect([setup.stagingPath, setup.stagingMarker]).toEqual([share, null]);
  expect(setup.problems).toContain("The staging folder isn't on a local drive, so XF Studio didn't look inside it.");
}));

test("the Vortex check tool leaves the profile's name out of what testers paste (VORTEX-07)", () => withFolder(base => {
  const game = join(base, "game"), appData = join(base, "AppData");
  mkdirSync(game, { recursive: true });
  copyFileSync(join(fixtures, "cyberpunk-hardlink.vortex.deployment.json"), join(game, "vortex.deployment.json"));
  const named = stateFromPairs([...pairs, ["persistent###profiles###p1###name", JSON.stringify("Jane Doe private profile")],
    ["settings###gameMode###discovered###cyberpunk2077###path", JSON.stringify(game)]]).state;
  put(join(appData, "Vortex", "temp", "state_backups_full", "hourly.json"), JSON.stringify(named));
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "tools", "vortex-check.ts"), "--game-root", game],
    { env: { ...process.env, APPDATA: appData, ProgramData: join(base, "none") } });
  const output = run.stdout.toString();
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  expect(JSON.parse(output).state.profileFound).toBe(true);
  expect(output).not.toContain("Jane Doe");
}));

test("Vortex parsing modules stay pure", () => {
  const IMPORTS = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const name of ["vortex-deployment", "vortex-state", "leveldb-read"]) {
    const text = readFileSync(join(import.meta.dir, "..", "src", `${name}.ts`), "utf8");
    for (const match of text.matchAll(IMPORTS)) expect(match[1] ?? match[2], `${name}`).not.toMatch(/^node:|-host$|^\.\/source-discovery$/);
  }
});
