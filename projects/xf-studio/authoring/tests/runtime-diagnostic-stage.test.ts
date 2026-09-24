import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRuntimeDiagnostic, stageRuntimeDiagnostic } from "../src/runtime-diagnostic-stage";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xfs-runtime-diagnostic-"));
  const gameRoot = join(root, "game"), mo2Root = join(root, "source-mo2");
  const candidateStore = join(root, "candidates"), candidateId = "build_1";
  const profileId = "2025 (again)";
  const profile = join(mo2Root, "profiles", profileId);
  const payload = join(candidateStore, candidateId, "archive", "pc", "mod");
  mkdirSync(join(gameRoot, "bin", "x64"), { recursive: true });
  mkdirSync(join(gameRoot, "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(gameRoot, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  mkdirSync(join(mo2Root, "mods"), { recursive: true });
  mkdirSync(profile, { recursive: true });
  const original = "+Other Mod\r\n+ArchiveXL\r\n+XF Eye Artistry CCXL - Dev\r\n-Unused Mod\r\n";
  writeFileSync(join(profile, "modlist.txt"), original);
  writeFileSync(join(profile, "plugins.txt"), "*fixture.esm\n");
  writeFileSync(join(profile, "loadorder.txt"), "fixture.esm\n");
  writeFileSync(join(profile, "settings.ini"), "selected=true\n");
  mkdirSync(join(mo2Root, "mods", "ArchiveXL"));
  writeFileSync(join(mo2Root, "mods", "ArchiveXL", "meta.ini"), "version=1.26.3.0\n");
  mkdirSync(payload, { recursive: true });
  const files = ["xfs_fixture.archive", "xfs_fixture.archive.xl"].map((name, index) => {
    const content = `candidate-${index}`;
    writeFileSync(join(payload, name), content);
    return { path: `archive/pc/mod/${name}`, sha256: hash(content), bytes: Buffer.byteLength(content) };
  });
  writeFileSync(join(candidateStore, candidateId, "manifest.json"), JSON.stringify({
    schema: "xfs/local-package-1", namespace: "xfs_fixture", verifiedUnpackedFiles: 5,
    verifiedPresetCount: 2, omissions: [], installed: false, gameRenderingVerified: false, files,
  }));
  const options = { gameRoot, mo2Root, candidateStore, candidateId, profileId, stagingRoot: join(root, "staging") };
  return { root, options, original, files, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("dry-run verifies the candidate and profile without creating a stage or changing the source", () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.options.mo2Root, "profiles", f.options.profileId, "modlist.txt"), "utf8");
    const plan = planRuntimeDiagnostic(f.options);
    expect(plan.presetCount).toBe(2);
    expect(plan.verifiedUnpackedFiles).toBe(5);
    expect(plan.sourceProfileLegacyEnabled).toBe(true);
    expect(plan.frameworkMetadataVersions.ArchiveXL).toBe("1.26.3.0");
    expect(plan.exactFilenameConflicts).toEqual([]);
    expect(existsSync(f.options.stagingRoot)).toBe(false);
    expect(readFileSync(join(f.options.mo2Root, "profiles", f.options.profileId, "modlist.txt"), "utf8"))
      .toBe(before);
  } finally { f.cleanup(); }
});

test("explicit staging copies profile metadata and uses the trusted transport only in the isolated root", () => {
  const f = fixture();
  try {
    const options = { ...f.options, stagingRoot: join(f.root, "private", "scratch", "stage") };
    const result = stageRuntimeDiagnostic(options);
    const stagedList = readFileSync(join(result.stagedProfile, "modlist.txt"), "utf8");
    expect(stagedList).toContain("-XF Eye Artistry CCXL - Dev\r\n");
    expect(stagedList).toContain(`+${EYE_MAKEUP_MOD.modName}\r\n`);
    expect(stagedList).not.toContain("XF Studio");
    expect(result.receipt.target).toBe(join(result.stagedMo2, "mods", EYE_MAKEUP_MOD.modName, "archive", "pc", "mod"));
    expect(readFileSync(join(result.stagedProfile, "settings.ini"), "utf8")).toBe("selected=true\n");
    expect(readFileSync(join(result.stagedProfile, "plugins.txt"), "utf8")).toBe("*fixture.esm\n");
    expect(readFileSync(join(result.stagedProfile, "loadorder.txt"), "utf8")).toBe("fixture.esm\n");
    expect(readFileSync(join(f.options.mo2Root, "profiles", f.options.profileId, "modlist.txt"), "utf8"))
      .toBe(f.original);
    for (const entry of f.files) {
      const file = entry.path.split("/").at(-1)!;
      expect(readFileSync(join(result.receipt.target, file), "utf8")).toBe(
        readFileSync(join(f.options.candidateStore, f.options.candidateId, ...entry.path.split("/")), "utf8"));
      expect(existsSync(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName, "archive", "pc", "mod", file))).toBe(false);
    }
    expect(result.receipt.target.startsWith(options.stagingRoot)).toBe(true);
  } finally { f.cleanup(); }
});

test("tampering, source filename conflicts, and unsafe staging destinations stop before writes", () => {
  const f = fixture();
  try {
    const name = "xfs_fixture.archive";
    const conflicting = join(f.options.gameRoot, "archive", "pc", "mod", name);
    writeFileSync(conflicting, "existing");
    expect(planRuntimeDiagnostic(f.options).exactFilenameConflicts).toContain(`Direct game archive already has ${name}`);
    expect(() => stageRuntimeDiagnostic(f.options)).toThrow("Exact filename conflicts");
    rmSync(conflicting);
    expect(() => planRuntimeDiagnostic({ ...f.options, stagingRoot: join(f.options.mo2Root, "scratch") }))
      .toThrow("outside every source root");
    writeFileSync(join(f.options.candidateStore, f.options.candidateId, "archive", "pc", "mod", name), "tampered");
    expect(() => planRuntimeDiagnostic(f.options)).toThrow("Candidate payload differs");
    expect(existsSync(f.options.stagingRoot)).toBe(false);
  } finally { f.cleanup(); }
});

test("a legacy XF Studio folder or entry is recognised as an earlier XF Eye Artistry install", () => {
  const f = fixture();
  try {
    const modlist = join(f.options.mo2Root, "profiles", f.options.profileId, "modlist.txt");
    mkdirSync(join(f.options.mo2Root, "mods", "XF Studio"));
    writeFileSync(modlist, f.original + "-XF Studio\r\n");
    const plan = planRuntimeDiagnostic(f.options);
    expect(plan.sourceLegacyModFolder).toBe("XF Studio");
    expect(plan.sourceProfileLegacyModEntryPresent).toBe(true);
    expect(plan.sourceProfileModEntryPresent).toBe(false);
    expect(plan.cautions.some(text => text.includes("legacy folder \"XF Studio\"") && text.includes("refuses"))).toBe(true);
    writeFileSync(modlist, f.original + "+XF Studio\r\n");
    expect(() => planRuntimeDiagnostic(f.options)).toThrow("under its earlier name \"XF Studio\"");
    writeFileSync(modlist, f.original + `+${EYE_MAKEUP_MOD.modName}\r\n`);
    expect(() => planRuntimeDiagnostic(f.options)).toThrow(`already enables ${EYE_MAKEUP_MOD.modName}`);
    expect(existsSync(f.options.stagingRoot)).toBe(false);
  } finally { f.cleanup(); }
});
