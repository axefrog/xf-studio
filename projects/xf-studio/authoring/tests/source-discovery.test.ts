import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLocalSettings } from "../src/local-settings";
import { discoverSources } from "../src/source-discovery";

const fixture = (run: (base: string) => void) => {
  const base = mkdtempSync(join(tmpdir(), "xfs-source-test-"));
  try { run(base); } finally { rmSync(base, { recursive: true, force: true }); }
};
const put = (path: string, content = "fixture") => {
  mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content);
};

test("direct route includes game and manual roots while excluding staged MO2", () => fixture(base => {
  const game = join(base, "game"), manual = join(base, "manual"), mo2 = join(base, "mo2");
  put(join(game, "archive", "pc", "content", "base.archive"));
  put(join(game, "archive", "pc", "mod", "local.archive"));
  put(join(manual, "archive", "pc", "mod", "custom.xl"));
  put(join(mo2, "mods", "Staged", "archive", "pc", "mod", "hidden.xl"));
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, manualModRoot: manual,
    mo2Root: mo2, launchRoute: "direct" });
  expect(result.complete).toBe(true);
  expect(result.candidates.map(x => x.provider).sort()).toEqual(["game", "game", "manual"]);
  expect(result.candidates.map(x => x.virtualPath)).toContain("archive/pc/content/base.archive");
  expect(result.candidates.some(x => x.physicalPath.includes("hidden.xl"))).toBe(false);
  expect(result.candidates.every(x => x.sha256 === null && x.sizeBytes > 0)).toBe(true);
  expect(result.looseFiles[0]?.runtimeObservedWinner).toBeNull();
}));

test("MO2 profile keeps disabled candidates and derives only virtual loose priority", () => fixture(base => {
  const game = join(base, "game"), mo2 = join(base, "mo2");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  put(join(mo2, "profiles", "Profile", "modlist.txt"), "# comment\n-Disabled\n+Low\n+High\n");
  for (const name of ["Disabled", "Low", "High"])
    put(join(mo2, "mods", name, "archive", "pc", "mod", "same.xl"), name);
  put(join(mo2, "overwrite", "archive", "pc", "mod", "same.xl"), "overwrite");
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "mo2",
    mo2Root: mo2, mo2ProfileId: "Profile" });
  expect(result.complete).toBe(true);
  expect(result.candidates).toHaveLength(4);
  expect(result.candidates.find(x => x.providerName === "Disabled")?.active).toBe(false);
  const assessment = result.looseFiles[0]!;
  expect(assessment.contenders).toHaveLength(4);
  expect(assessment.sourceDerivedFirst?.provider).toBe("mo2-overwrite");
  expect(assessment.confidence).toBe("source-derived");
  expect(assessment.runtimeObservedWinner).toBeNull();
  expect(result.limitations.join(" ")).toContain("activation intent");
}));

test("game/manual collision and archive contents remain unresolved", () => fixture(base => {
  const game = join(base, "game"), manual = join(base, "manual");
  put(join(game, "archive", "pc", "mod", "same.xl"));
  put(join(manual, "archive", "pc", "mod", "same.xl"));
  put(join(game, "archive", "pc", "mod", "same.archive"));
  put(join(manual, "archive", "pc", "mod", "same.archive"));
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, manualModRoot: manual });
  expect(result.looseFiles).toHaveLength(1);
  expect(result.looseFiles[0]?.confidence).toBe("ambiguous");
  expect(result.looseFiles[0]?.sourceDerivedFirst).toBeNull();
  expect(result.candidates.filter(x => x.kind === "archive")).toHaveLength(2);
}));

test("bounded scan and invalid profile rows cannot yield a precedence conclusion", () => fixture(base => {
  const game = join(base, "game"), mo2 = join(base, "mo2");
  put(join(game, "archive", "pc", "mod", "one.xl"));
  put(join(mo2, "profiles", "Profile", "modlist.txt"), "+../escape\n+Safe\n");
  put(join(mo2, "mods", "Safe", "archive", "pc", "mod", "one.xl"));
  let result = discoverSources({ ...defaultLocalSettings(), gameRoot: game, launchRoute: "mo2",
    mo2Root: mo2, mo2ProfileId: "Profile" });
  expect(result.complete).toBe(false);
  expect(result.issues.map(x => x.code)).toContain("profile_row_invalid");
  expect(result.candidates.every(x => !x.physicalPath.includes("escape"))).toBe(true);
  expect(result.looseFiles[0]?.sourceDerivedFirst).toBeNull();
  result = discoverSources({ ...defaultLocalSettings(), gameRoot: game }, { maxEntries: 1 });
  expect(result.complete).toBe(false);
  expect(result.issues.map(x => x.code)).toContain("scan_entries_exceeded");
}));

test("links are skipped and never traversed", () => fixture(base => {
  const game = join(base, "game"), outside = join(base, "outside");
  put(join(outside, "secret.xl"));
  mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
  symlinkSync(outside, join(game, "archive", "pc", "mod", "linked"), "dir");
  const result = discoverSources({ ...defaultLocalSettings(), gameRoot: game });
  expect(result.complete).toBe(false);
  expect(result.issues.map(x => x.code)).toContain("symlink_skipped");
  expect(result.candidates).toHaveLength(0);
}));
