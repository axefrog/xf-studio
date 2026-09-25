import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkFrameworkVersions, compareVersions, EYE_ARTISTRY_REQUIREMENTS, FRAMEWORKS, frameworkModNames,
  normaliseVersion } from "../src/framework-versions";
import { createWindowsDetectionHost } from "../src/install-detection-host";
import { evaluateLocalReadiness } from "../src/local-settings-readiness";
import { defaultLocalSettings, parseLocalSettings } from "../src/local-settings";
import { fixedFileVersion, readPeFileVersion } from "../src/pe-version";

/** A minimal PE image: DOS header, one `.rsrc` section and a VS_VERSIONINFO with the given version. */
function fakePe(version: [number, number, number, number]): Uint8Array {
  const bytes = new Uint8Array(512), data = new DataView(bytes.buffer);
  bytes.set([0x4d, 0x5a]); data.setUint32(0x3c, 64, true);
  data.setUint32(64, 0x00004550, true); data.setUint16(70, 1, true); data.setUint16(84, 0, true);
  bytes.set([...".rsrc"].map(ch => ch.charCodeAt(0)), 88);
  data.setUint32(88 + 16, 256, true); data.setUint32(88 + 20, 256, true);
  let at = 256 + 6;
  for (const ch of "VS_VERSION_INFO") { data.setUint16(at, ch.charCodeAt(0), true); at += 2; }
  at += 2; at += (4 - ((at - 256) % 4)) % 4;
  data.setUint32(at, 0xfeef04bd, true); data.setUint32(at + 4, 0x00010000, true);
  data.setUint32(at + 8, (version[0] << 16) | version[1], true); data.setUint32(at + 12, (version[2] << 16) | version[3], true);
  return bytes;
}
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const snapshot = (root: string): string[] => readdirSync(root, { recursive: true }).map(String).sort()
  .map(path => `${path}:${statSync(join(root, path)).isFile() ? readFileSync(join(root, path)).length : "dir"}`);

test("PE version resources are read from the resource section only", () => {
  const image = fakePe([1, 27, 3, 17607]);
  expect(fixedFileVersion(image.subarray(256))).toBe("1.27.3.17607");
  const reads: [number, number][] = [];
  expect(readPeFileVersion((offset, length) => { reads.push([offset, length]); return image.subarray(offset, offset + length); }))
    .toBe("1.27.3.17607");
  expect(reads.at(-1)).toEqual([256, 256]);
  expect(readPeFileVersion(() => new TextEncoder().encode("not a PE file".padEnd(64)))).toBeNull();
  expect(readPeFileVersion(() => null)).toBeNull();
});

test("versions normalise to major.minor.patch and compare numerically", () => {
  expect(normaliseVersion("1.27.3.0")).toBe("1.27.3");
  expect(normaliseVersion("v1.37.1 [HEAD]")).toBe("1.37.1");
  expect(normaliseVersion("0.5")).toBe("0.5.0");
  expect(normaliseVersion("unknown")).toBeNull();
  expect(compareVersions("1.27.3", "1.9.10")).toBeGreaterThan(0);
  expect(compareVersions("1.26.3", "1.27.3")).toBeLessThan(0);
  expect(EYE_ARTISTRY_REQUIREMENTS.map(row => [row.framework, row.minimum]))
    .toEqual([["archivexl", "1.27.3"], ["red4ext", "1.29.0"], ["redscript", "0.5.31"]]);
  expect(FRAMEWORKS.map(row => row.name)).toEqual(["ArchiveXL", "TweakXL", "Codeware", "RED4ext", "redscript", "Cyber Engine Tweaks"]);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xfs-frameworks-"));
  const game = join(root, "game"), mo2 = join(root, "mo2");
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  put(join(game, "red4ext", "RED4ext.dll"), fakePe([1, 30, 0, 0]));
  put(join(game, "bin", "x64", "plugins", "cyber_engine_tweaks.asi"), fakePe([1, 37, 1, 0]));
  // Two ArchiveXL copies: MO2 uses the first listed (highest priority) one. Its metadata is stale.
  put(join(mo2, "mods", "ArchiveXL", "red4ext", "plugins", "ArchiveXL", "ArchiveXL.dll"), fakePe([1, 26, 3, 9]));
  put(join(mo2, "mods", "ArchiveXL", "meta.ini"), "[General]\nversion=1.27.3.0\n");
  put(join(mo2, "mods", "Old ArchiveXL", "red4ext", "plugins", "ArchiveXL", "ArchiveXL.dll"), fakePe([1, 20, 0, 0]));
  put(join(mo2, "mods", "redscript", "engine", "tools", "scc.exe"), "no version resource");
  put(join(mo2, "mods", "redscript", "meta.ini"), "[General]\nversion=0.5.31.0\n");
  put(join(mo2, "mods", "Disabled Codeware", "red4ext", "plugins", "Codeware", "Codeware.dll"), fakePe([1, 20, 5, 0]));
  put(join(mo2, "profiles", "Play", "modlist.txt"),
    "# header\r\n+ArchiveXL\r\n+Old ArchiveXL\r\n+redscript\r\n-Disabled Codeware\r\n-CORE_separator\r\n");
  return { root, game, mo2, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("each route reports what the game would load, with plain guidance and no private paths", () => {
  const f = fixture();
  try {
    const before = snapshot(f.root);
    const check = checkFrameworkVersions(createWindowsDetectionHost(), { gameRoot: f.game, launchRoute: "mo2",
      mo2Root: f.mo2, mo2ProfileId: "Play" });
    expect(snapshot(f.root)).toEqual(before);
    expect(check.selectedRoute).toBe("mo2");
    const [direct, mo2] = check.routes;
    expect(direct!.frameworks.filter(row => row.installed).map(row => `${row.name} ${row.version}`))
      .toEqual(["RED4ext 1.30.0", "Cyber Engine Tweaks 1.37.1"]);
    expect(direct!.verdicts.find(row => row.framework === "archivexl")?.message)
      .toBe("XF Eye Artistry needs ArchiveXL 1.27.3 or newer, and it isn't installed in the game folder. " +
        "Install it from Nexus Mods or GitHub.");

    const archiveXl = mo2!.frameworks.find(row => row.framework === "archivexl")!;
    expect(archiveXl).toMatchObject({ version: "1.26.3", versionSource: "file", fileVersion: "1.26.3",
      modManagerVersion: "1.27.3", provider: { kind: "mo2-mod", name: "ArchiveXL" }, hiddenCopies: ["Old ArchiveXL"] });
    expect(archiveXl.notes.join(" ")).toContain("Mod Organizer lists ArchiveXL 1.27.3, but the installed file is 1.26.3");
    expect(mo2!.frameworks.find(row => row.framework === "redscript"))
      .toMatchObject({ version: "0.5.31", versionSource: "mod-manager" });
    expect(mo2!.frameworks.find(row => row.framework === "codeware")?.installed).toBe(false);
    expect(mo2!.frameworks.find(row => row.framework === "red4ext")?.provider).toEqual({ kind: "game", name: "Game folder" });
    expect(mo2!.verdicts.map(row => [row.framework, row.status])).toEqual([["archivexl", "outdated"], ["red4ext", "ok"], ["redscript", "ok"]]);
    expect(mo2!.verdicts[0]!.message).toBe("XF Eye Artistry needs ArchiveXL 1.27.3 or newer; you have 1.26.3. " +
      "Update it in Mod Organizer 2 with the latest release from Nexus Mods or GitHub.");
    expect(mo2!.verdicts[0]!.links.map(link => link.url)).toEqual(["https://www.nexusmods.com/cyberpunk2077/mods/4198",
      "https://github.com/psiberx/cp2077-archive-xl/releases/latest"]);
    expect(mo2!.ready).toBe(false);
    expect(frameworkModNames(mo2!).sort()).toEqual(["ArchiveXL", "Old ArchiveXL", "redscript"]);
    expect(JSON.stringify(check)).not.toContain(f.root.replaceAll("\\", "\\\\"));

    // The same report drives the advisory readiness entry for the selected route; Check and Build stay independent.
    const settings = parseLocalSettings({ ...defaultLocalSettings(), gameRoot: f.game, launchRoute: "mo2", mo2Root: f.mo2,
      mo2ProfileId: "Play" });
    const readiness = evaluateLocalReadiness(settings, { updater: false, installer: false, frameworks: check });
    expect(readiness.frameworks.issues).toEqual([{ code: "framework_outdated", reason: mo2!.verdicts[0]!.message! }]);
    expect(readiness.frameworks.limits.join(" ")).toContain("installed more than once");
    expect(readiness.check.ready).toBe(true);
    expect(evaluateLocalReadiness(settings).frameworks.issues.map(row => row.code)).toEqual(["framework_check_unavailable"]);
  } finally { f.cleanup(); }
});

test("an unreadable route explains the next step instead of guessing", () => {
  const f = fixture();
  try {
    const port = createWindowsDetectionHost();
    const noGame = checkFrameworkVersions(port, { gameRoot: null, launchRoute: "direct", mo2Root: null, mo2ProfileId: null });
    expect(noGame.routes).toHaveLength(1);
    expect(noGame.routes[0]).toMatchObject({ available: false, ready: false,
      problem: "Choose your Cyberpunk 2077 game folder in Local setup so we can check your frameworks." });
    const noProfile = checkFrameworkVersions(port, { gameRoot: f.game, launchRoute: "mo2", mo2Root: f.mo2, mo2ProfileId: "Missing" });
    expect(noProfile.routes[1]).toMatchObject({ available: false,
      problem: "We couldn't read the Mod Organizer 2 profile \"Missing\". Check it still exists." });
    // redscript's compiler has no version resource, so a direct install has an unknown version.
    put(join(f.game, "engine", "tools", "scc.exe"), "no version resource");
    const direct = checkFrameworkVersions(port, { gameRoot: f.game, launchRoute: "direct", mo2Root: null, mo2ProfileId: null });
    expect(direct.routes[0]!.verdicts.find(row => row.framework === "redscript")).toMatchObject({ status: "unknown-version" });
  } finally { f.cleanup(); }
});
