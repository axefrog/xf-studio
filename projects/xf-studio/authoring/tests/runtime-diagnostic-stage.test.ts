import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRuntimeDiagnostic, stageRuntimeDiagnostic } from "../src/runtime-diagnostic-stage";

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
    const result = stageRuntimeDiagnostic(f.options);
    const stagedList = readFileSync(join(result.stagedProfile, "modlist.txt"), "utf8");
    expect(stagedList).toContain("-XF Eye Artistry CCXL - Dev\r\n");
    expect(stagedList).toContain("+XF Studio\r\n");
    expect(readFileSync(join(result.stagedProfile, "settings.ini"), "utf8")).toBe("selected=true\n");
    expect(readFileSync(join(f.options.mo2Root, "profiles", f.options.profileId, "modlist.txt"), "utf8"))
      .toBe(f.original);
    for (const entry of f.files) {
      const file = entry.path.split("/").at(-1)!;
      expect(readFileSync(join(result.receipt.target, file), "utf8")).toBe(
        readFileSync(join(f.options.candidateStore, f.options.candidateId, ...entry.path.split("/")), "utf8"));
      expect(existsSync(join(f.options.mo2Root, "mods", "XF Studio", "archive", "pc", "mod", file))).toBe(false);
    }
    expect(result.receipt.target.startsWith(f.options.stagingRoot)).toBe(true);
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
