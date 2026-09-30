/**
 * One virtual-file precedence rule (PIPE-06), written from knowledge/mod-loading.md rule 1: on MO2, the overwrite
 * folder, then the first `modlist.txt` row, wins; disabled rows are not mounted; an MO2 file over a physical
 * game-folder file is expected to win (a hypothesis: MO2's VFS overlays the game folder); on a direct launch only the
 * game folder is seen. Every consumer (the mount plan, loose files, the source inventory, the framework check and the
 * script-bundle search) orders copies by it.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMountPlan, visibleCopy, type ArchiveFile, type VirtualCopy } from "../src/archive-precedence";
import { mo2ProviderFolders, parseMo2Modlist } from "../src/mo2-instance";
import { discoverSources } from "../src/source-discovery";
import { gameFileProviders } from "../src/saves-host-sources";
import { defaultLocalSettings } from "../src/local-settings";

const copy = (id: string, extra: Partial<VirtualCopy> = {}): VirtualCopy =>
  ({ id, provider: "game", providerName: id, active: true, priority: null, ...extra });
const mod = (name: string, priority: number, active = true) => copy(name, { provider: "mo2-mod", priority, active });
const overwrite = (priority: number) => copy("Overwrite", { provider: "mo2-overwrite", priority });

test("MO2's overwrite wins, then the highest-priority (first-listed) mod; disabled copies are never visible", () => {
  const list = parseMo2Modlist("+First\n-Disabled\n+Last\n");
  const [first, disabled, last] = list.entries.map(entry => mod(entry.name, entry.priority, entry.enabled));
  expect(visibleCopy([last!, first!, disabled!], "x").visible?.id).toBe("First");
  expect(visibleCopy([last!, first!, overwrite(list.overwritePriority)], "x").visible?.id).toBe("Overwrite");
  expect(visibleCopy([disabled!], "x").visible).toBeNull();
  const chosen = visibleCopy([disabled!, last!], "x");
  expect(chosen.visible?.id).toBe("Last");
  expect(chosen.shadowed.map(item => item.id)).toEqual(["Disabled"]);
  expect(chosen.ambiguities).toEqual([]);
});

test("an MO2 copy over the game folder wins, marked as the documented hypothesis; the game folder over a manual root likewise", () => {
  const over = visibleCopy([copy("game"), mod("Mod", 0)], "archive/pc/mod/x.archive");
  expect(over.visible?.id).toBe("Mod");
  expect(over.ambiguities.map(item => [item.code, item.grade])).toEqual([["vfs-mo2-over-game-folder", "hypothesis"]]);
  const manual = visibleCopy([copy("manual", { provider: "manual" }), copy("game")], "x");
  expect(manual.visible?.id).toBe("game");
  expect(manual.ambiguities.map(item => item.code)).toEqual(["vfs-game-manual-collision"]);
});

test("the answer never depends on the order copies were found in", () => {
  const copies = [copy("game"), copy("manual", { provider: "manual" }), mod("B", 1), mod("A", 2), overwrite(3), mod("C", 0, false)];
  const answers = new Set<string>();
  for (let i = 0; i < copies.length; i++) {
    const rotated = [...copies.slice(i), ...copies.slice(0, i)];
    answers.add(JSON.stringify([visibleCopy(rotated, "x").visible?.id, visibleCopy(rotated.reverse(), "x").shadowed.map(item => item.id)]));
  }
  expect([...answers]).toEqual([JSON.stringify(["Overwrite", ["A", "B", "game", "manual", "C"]])]);
});

test("the mount plan takes the same copy as the rule", () => {
  const files: ArchiveFile[] = [
    { id: "g", virtualPath: "archive/pc/mod/x.archive", provider: "game", providerName: "game", active: true, priority: null },
    { id: "m", virtualPath: "archive/pc/mod/x.archive", provider: "mo2-mod", providerName: "Mod", active: true, priority: 4 }];
  const plan = buildMountPlan(files, null);
  expect(plan.archives.map(archive => archive.id)).toEqual([visibleCopy(files, "x").visible!.id]);
  expect(plan.ambiguities.map(item => item.code)).toContain("vfs-mo2-over-game-folder");
});

test("MO2 provider folders: overwrite, enabled mods by priority, then the game; separators, foreign rows and path-like names never joined", () => {
  const list = parseMo2Modlist("+High\n+Tools_separator\n*DLC Entry\n-Off\n+../../escape\n+Low\n");
  const folders = mo2ProviderFolders(list, { mods: "C:\MO2\mods", overwrite: "C:\MO2\overwrite" }, "C:\Game");
  expect(folders.map(folder => folder.folder)).toEqual(["C:\MO2\overwrite", join("C:\MO2\mods", "High"), join("C:\MO2\mods", "Low"), "C:\Game"]);
});

test("the source inventory, the script-bundle search and the resolver agree on a loose file's visible copy", () => {
  const base = mkdtempSync(join(tmpdir(), "xfs-precedence-"));
  try {
    const game = join(base, "game"), mo2 = join(base, "mo2");
    const put = (path: string, text = "x") => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
    put(join(game, "bin", "x64", "Cyberpunk2077.exe"));
    put(join(game, "archive", "pc", "mod", "same.xl"));
    put(join(mo2, "profiles", "Profile", "modlist.txt"), "+Mod\n");
    put(join(mo2, "mods", "Mod", "archive", "pc", "mod", "same.xl"));
    put(join(base, "outside", "r6", "cache", "final.redscripts"));
    const settings = { ...defaultLocalSettings(), gameRoot: game, launchRoute: "mo2" as const, mo2Root: mo2, mo2ProfileId: "Profile" };
    const found = discoverSources(settings);
    const assessment = found.looseFiles.find(row => row.virtualPath.endsWith("same.xl"))!;
    // Before, an MO2 copy over the game folder was left unchosen here while the resolver read the MO2 copy.
    expect(assessment.sourceDerivedFirst?.providerName).toBe("Mod");
    expect(assessment.confidence).toBe("ambiguous");
    expect(assessment.sourceDerivedFirst?.physicalPath)
      .toBe(visibleCopy(assessment.contenders.map(item => ({ ...item, id: item.physicalPath })), "x").visible!.physicalPath);
    expect(gameFileProviders(settings)).toEqual([join(mo2, "overwrite"), join(mo2, "mods", "Mod"), game]);
    // The script-bundle search never joins a foreign row or one that climbs out of the mods folder (it did before).
    put(join(mo2, "profiles", "Profile", "modlist.txt"), "+Mod\n*DLC\n+../outside\n");
    expect(gameFileProviders(settings)).toEqual([join(mo2, "overwrite"), join(mo2, "mods", "Mod"), game]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
