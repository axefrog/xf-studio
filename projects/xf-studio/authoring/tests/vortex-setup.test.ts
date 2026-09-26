import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { defaultLocalSettings } from "../src/local-settings";
import { discoverSources } from "../src/source-discovery";
import { inspectVortexSetup, readVortexManifests } from "../src/vortex-host";
import { readVortexGameState, resolveVortexInstallPath, stateFromPairs } from "../src/vortex-state";

const fixtures = join(import.meta.dir, "fixtures", "vortex");
const withFolder = (run: (base: string) => void) => {
  const base = mkdtempSync(join(tmpdir(), "xfs-vortex-test-"));
  try { run(base); } finally { rmSync(base, { recursive: true, force: true }); }
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

test("inspecting a Vortex setup matches the deploying installation by instance id and reads its state backup", () => withFolder(base => {
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
  const setup = inspectVortexSetup(game, env);
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
  const none = inspectVortexSetup(join(base, "elsewhere"), () => undefined);
  expect([none.deployed, none.state, none.stagingPath, none.instanceMatches]).toEqual([false, null, null, null]);
}));

test("Vortex parsing modules stay pure", () => {
  const IMPORTS = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const name of ["vortex-deployment", "vortex-state", "leveldb-read"]) {
    const text = readFileSync(join(import.meta.dir, "..", "src", `${name}.ts`), "utf8");
    for (const match of text.matchAll(IMPORTS)) expect(match[1] ?? match[2], `${name}`).not.toMatch(/^node:|-host$|^\.\/source-discovery$/);
  }
});
