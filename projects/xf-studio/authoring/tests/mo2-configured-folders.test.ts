/**
 * The route fingerprint and the runtime diagnostics find an MO2 instance's folders where its ModOrganizer.ini puts them,
 * not at the default `mods`/`profiles`/`overwrite` below the instance (PIPE-05).
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeStamps } from "../src/route-fingerprint";
import { planRuntimeDiagnostic } from "../src/runtime-diagnostic-stage";

/** An instance whose ini keeps its profiles, mods and overwrite in folders of their own names. */
function movedInstance(root: string) {
  const mo2 = join(root, "mo2"), profiles = join(mo2, "Profiles2"), mods = join(mo2, "Mods2"), overwrite = join(mo2, "Overwrite2");
  mkdirSync(join(profiles, "Play"), { recursive: true }); mkdirSync(mods, { recursive: true }); mkdirSync(overwrite, { recursive: true });
  writeFileSync(join(mo2, "ModOrganizer.ini"), ["[General]", "gameName=Cyberpunk 2077", "[Settings]",
    "profiles_directory=%BASE_DIR%/Profiles2", "mod_directory=%BASE_DIR%/Mods2", "overwrite_directory=%BASE_DIR%/Overwrite2"].join("\r\n"));
  writeFileSync(join(profiles, "Play", "modlist.txt"), "+Other Mod\r\n");
  return { mo2, profiles, mods, overwrite };
}

test("the route fingerprint follows a profile's mod list and the overwrite folder where the ini puts them", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-mo2-folders-"));
  try {
    const game = join(root, "game");
    mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
    const instance = movedInstance(root);
    const route = { gameRoot: game, launchRoute: "mo2" as const, mo2Root: instance.mo2, mo2ProfileId: "Play" };
    const before = routeStamps(route);
    expect(before[2]).not.toBe("missing");   // before, the default profiles folder was stamped: always "missing"
    expect(before[3]).not.toBe("missing");
    // Switching a mod on in that profile changes the fingerprint.
    writeFileSync(join(instance.profiles, "Play", "modlist.txt"), "+Other Mod\r\n+New Mod\r\n");
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(instance.profiles, "Play", "modlist.txt"), later, later);
    expect(routeStamps(route)[2]).not.toBe(before[2]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the diagnostic plan reads the source profile and mods from the folders the ini names", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-mo2-folders-"));
  try {
    const game = join(root, "game"), store = join(root, "candidates"), payload = join(store, "build_1", "archive", "pc", "mod");
    mkdirSync(join(game, "bin", "x64"), { recursive: true }); mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
    const instance = movedInstance(root);
    mkdirSync(payload, { recursive: true });
    const files = ["xfs_fixture.archive", "xfs_fixture.archive.xl"].map((name, index) => {
      const content = `candidate-${index}`;
      writeFileSync(join(payload, name), content);
      return { path: `archive/pc/mod/${name}`, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length };
    });
    writeFileSync(join(store, "build_1", "manifest.json"), JSON.stringify({ schema: "xfs/local-package-1", namespace: "xfs_fixture",
      verifiedUnpackedFiles: 5, verifiedPresetCount: 2, omissions: [], installed: false, gameRenderingVerified: false, files }));
    // An enabled mod in the moved mods folder already holds one of the build's file names.
    mkdirSync(join(instance.mods, "Other Mod", "archive", "pc", "mod"), { recursive: true });
    writeFileSync(join(instance.mods, "Other Mod", "archive", "pc", "mod", "xfs_fixture.archive"), "other");
    const plan = planRuntimeDiagnostic({ gameRoot: game, mo2Root: instance.mo2, candidateStore: store, candidateId: "build_1",
      profileId: "Play", stagingRoot: join(root, "staging") });
    expect(plan.sourceProfileEnabledMods).toBe(1);
    expect(plan.exactFilenameConflicts).toEqual(["Enabled MO2 mod Other Mod has xfs_fixture.archive"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
