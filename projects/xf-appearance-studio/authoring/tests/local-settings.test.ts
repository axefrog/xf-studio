import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLocalSettings, migrateLocalSettings, parseLocalSettings } from "../src/local-settings";
import { evaluateLocalReadiness, packageToolPaths } from "../src/local-settings-readiness";
import { LocalSettingsStore } from "../src/local-settings-store";

const withDirectory = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-settings-test-"));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("local settings are path-free by default, strict and separate from portable data", () => {
  const defaults = defaultLocalSettings();
  expect(defaults.gameRoot).toBeNull();
  expect(defaults.plateInput).toBeNull();
  expect(defaults.updates.checkAutomatically).toBe(false);
  expect(parseLocalSettings(defaults)).toEqual(defaults);
  expect(() => parseLocalSettings({ ...defaults, token: "private" })).toThrow("unsupported field");
  expect(() => parseLocalSettings({ ...defaults, gameRoot: "../game" })).toThrow("absolute path");
  expect(() => parseLocalSettings({ ...defaults, mo2ProfileId: "../other" })).toThrow("single directory");
  expect(() => parseLocalSettings({ ...defaults, sourceCache: { ...defaults.sourceCache, maxBytes: 0 } })).toThrow("limit");
  expect(() => parseLocalSettings({ ...defaults, schema: "xfs/local-settings-2" })).toThrow("version");
});

test("explicit v0 migration preserves known local paths and rejects unknown fields", () => withDirectory(dir => {
  const old = { schema: "xfs/local-settings-0", gamePath: join(dir, "game"), mo2Path: join(dir, "mo2"),
    mo2Profile: "Default", platePath: join(dir, "plate"), wolvenKitPath: join(dir, "cli.exe") };
  const migrated = migrateLocalSettings(old);
  expect(migrated.migrated).toBe(true);
  expect(migrated.settings.launchRoute).toBe("mo2");
  expect(migrated.settings.mo2ProfileId).toBe("Default");
  expect(migrated.settings.gameRoot).toBe(old.gamePath);
  expect(() => migrateLocalSettings({ ...old, credential: "secret" })).toThrow("unsupported field");
}));

test("atomic save retains previous-good settings and rejects a stale revision", () => withDirectory(dir => {
  const store = new LocalSettingsStore(dir);
  expect(store.load().source).toBe("new");
  const one = store.save({ ...defaultLocalSettings(), gameRoot: join(dir, "game") }, 0);
  expect(one.revision).toBe(1);
  const two = store.save({ ...one, gameRoot: join(dir, "other") }, 1);
  expect(two.revision).toBe(2);
  expect(JSON.parse(readFileSync(store.backup, "utf8")).gameRoot).toBe(join(dir, "game"));
  expect(() => store.save({ ...two }, 1)).toThrow("changed");
  writeFileSync(store.file, "{broken");
  const recovered = store.load();
  expect(recovered.source).toBe("backup");
  expect(recovered.settings.gameRoot).toBe(join(dir, "game"));
  expect(() => store.save({ ...recovered.settings }, 1)).toThrow("recovery");
  expect(store.restorePrevious().gameRoot).toBe(join(dir, "game"));
  expect(store.load().source).toBe("primary");
  writeFileSync(store.file, "{broken");
  writeFileSync(store.backup, "{broken");
  expect(() => store.load()).toThrow("unreadable");
}));

test("readiness distinguishes Check, build and route evidence without exposing private paths", () => withDirectory(dir => {
  const defaults = defaultLocalSettings();
  const blank = evaluateLocalReadiness(defaults);
  expect(blank.check.ready).toBe(true);
  expect(blank.build.issues.map(x => x.code)).toContain("plate_unset");
  expect(blank.install.issues.map(x => x.code)).toContain("install_host_unavailable");
  expect(blank.updates.ready).toBe(false);
  const game = join(dir, "game"), mo2 = join(dir, "mo2"), plate = join(dir, "plate"), cli = join(dir, "cli.exe");
  mkdirSync(join(game, "bin", "x64"), { recursive: true });
  mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "");
  mkdirSync(join(mo2, "mods"), { recursive: true });
  mkdirSync(join(mo2, "profiles", "Default"), { recursive: true });
  writeFileSync(join(mo2, "profiles", "Default", "modlist.txt"), "+Example\n");
  mkdirSync(plate);
  writeFileSync(cli, "");
  const configured = parseLocalSettings({ ...defaults, gameRoot: game, launchRoute: "mo2", mo2Root: mo2,
    mo2ProfileId: "Default", plateInput: plate, wolvenKitCli: cli, installMode: "mo2" });
  const readiness = evaluateLocalReadiness(configured, { installer: true, updater: false });
  expect(readiness.sourceDiscovery.ready).toBe(true);
  expect(readiness.sourceDiscovery.limits.join(" ")).toContain("not prove a runtime winner");
  expect(readiness.build.ready).toBe(true);
  expect(readiness.install.ready).toBe(true);
  expect(JSON.stringify(readiness)).not.toContain(dir);
  expect(packageToolPaths(configured, { XFS_PACKAGE_PLATE: join(dir, "override") }).plate).toBe(join(dir, "override"));
  expect(packageToolPaths(configured, {}).gamepath).toBe(game);
  const unavailable = evaluateLocalReadiness(parseLocalSettings({ ...configured,
    sourceCache: { ...configured.sourceCache, directory: join(dir, "missing", "cache") },
    preview: { cacheDirectory: join(dir, "missing", "preview"), outputDirectory: cli },
    installMode: "direct",
  }), { installer: true, updater: false });
  expect(unavailable.sourceCache.issues[0]?.code).toBe("source_cache_unavailable");
  expect(unavailable.previewStorage.issues.map(x => x.code)).toEqual(["preview_cache_unavailable", "preview_output_unavailable"]);
  expect(unavailable.install.issues.map(x => x.code)).toContain("install_route_mismatch");
}));
