import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageRuntimeDiagnostic } from "../src/runtime-diagnostic-stage";
import { planRuntimePromotion, promoteRuntimeDiagnostic, recoverRuntimePromotion,
  rollbackRuntimePromotion } from "../src/runtime-diagnostic-promotion";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xfs-promotion-"));
  const gameRoot = join(root, "game"), mo2Root = join(root, "real-mo2");
  const candidateStore = join(root, "candidates"), candidateId = "build_1";
  const profileId = "Existing Profile", newProfileId = "XF Studio diagnostic";
  const sourceProfile = join(mo2Root, "profiles", profileId);
  const payload = join(candidateStore, candidateId, "archive", "pc", "mod");
  mkdirSync(join(gameRoot, "bin", "x64"), { recursive: true });
  mkdirSync(join(gameRoot, "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(gameRoot, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  mkdirSync(join(mo2Root, "mods", "Other Mod"), { recursive: true });
  writeFileSync(join(mo2Root, "mods", "Other Mod", "keep.txt"), "untouched");
  mkdirSync(sourceProfile, { recursive: true });
  const sourceList = "+Other Mod\r\n+XF Eye Artistry CCXL - Dev\r\n-Unused Mod\r\n";
  writeFileSync(join(sourceProfile, "modlist.txt"), sourceList);
  writeFileSync(join(sourceProfile, "plugins.txt"), "*fixture.esm\n");
  writeFileSync(join(sourceProfile, "loadorder.txt"), "fixture.esm\n");
  writeFileSync(join(sourceProfile, "settings.ini"), "private fixture settings\n");
  writeFileSync(join(mo2Root, "ModOrganizer.ini"), "selected_profile=old\n");
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
  const options = { gameRoot, mo2Root, candidateStore, candidateId, profileId, newProfileId,
    stagingRoot: join(root, "ignored-stage") };
  stageRuntimeDiagnostic(options);
  return { root, options, sourceProfile, sourceList, files,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("default preview is read-only and spells out every exact promoted file", () => {
  const f = fixture();
  try {
    const plan = planRuntimePromotion(f.options);
    expect(plan.files).toHaveLength(6);
    expect(plan.files.map(item => item.target)).toContain(join(plan.newProfile, "modlist.txt"));
    expect(plan.files.map(item => item.target)).toContain(join(plan.newProfile, "plugins.txt"));
    expect(plan.files.map(item => item.target)).toContain(join(plan.newProfile, "loadorder.txt"));
    expect(plan.files.map(item => item.target)).toContain(join(plan.dedicatedMod, "archive", "pc", "mod", "xfs_fixture.archive.xl"));
    expect(existsSync(plan.newProfile)).toBe(false);
    expect(existsSync(plan.dedicatedMod)).toBe(false);
    expect(existsSync(join(f.options.stagingRoot, "promotion-receipt.json"))).toBe(false);
  } finally { f.cleanup(); }
});

test("explicit promotion creates only new owned paths and rollback removes only unchanged owned paths", () => {
  const f = fixture();
  try {
    const preview = promoteRuntimeDiagnostic(f.options);
    expect(readFileSync(join(preview.newProfile, "modlist.txt"), "utf8"))
      .toBe("+Other Mod\r\n-XF Eye Artistry CCXL - Dev\r\n-Unused Mod\r\n+XF Studio\r\n");
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
    expect(readFileSync(join(preview.newProfile, "plugins.txt"), "utf8")).toBe("*fixture.esm\n");
    expect(readFileSync(join(preview.newProfile, "loadorder.txt"), "utf8")).toBe("fixture.esm\n");
    expect(readFileSync(join(f.options.mo2Root, "ModOrganizer.ini"), "utf8"))
      .toBe("selected_profile=old\n");
    expect(readFileSync(join(f.options.mo2Root, "mods", "Other Mod", "keep.txt"), "utf8"))
      .toBe("untouched");
    expect(() => planRuntimePromotion(f.options)).toThrow("journal or receipt exists");
    rollbackRuntimePromotion(f.options);
    expect(existsSync(preview.newProfile)).toBe(false);
    expect(existsSync(preview.dedicatedMod)).toBe(false);
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
  } finally { f.cleanup(); }
});

test("source/stage drift, collisions, and existing destination refuse before writes", () => {
  const f = fixture();
  try {
    const stageFile = join(f.options.stagingRoot, "mo2", "mods", "XF Studio", "archive", "pc", "mod", "xfs_fixture.archive");
    writeFileSync(stageFile, "tampered");
    expect(() => planRuntimePromotion(f.options)).toThrow("Staged payload differs");
    writeFileSync(stageFile, "candidate-0");
    writeFileSync(join(f.sourceProfile, "settings.ini"), "changed");
    expect(() => planRuntimePromotion(f.options)).toThrow("Source profile metadata changed");
    writeFileSync(join(f.sourceProfile, "settings.ini"), "private fixture settings\n");
    writeFileSync(join(f.options.gameRoot, "archive", "pc", "mod", "xfs_fixture.archive"), "collision");
    expect(() => planRuntimePromotion(f.options)).toThrow("Direct game archive collision");
    rmSync(join(f.options.gameRoot, "archive", "pc", "mod", "xfs_fixture.archive"));
    mkdirSync(join(f.options.mo2Root, "mods", "xf studio"));
    expect(() => planRuntimePromotion(f.options)).toThrow("Destination already exists");
    expect(existsSync(join(f.options.mo2Root, "profiles", f.options.newProfileId))).toBe(false);
  } finally { f.cleanup(); }
});

test("stage and every source root must be disjoint, including equality", () => {
  const f = fixture();
  try {
    const stage = f.options.stagingRoot;
    const cases = [
      { stagingRoot: f.options.mo2Root },
      { stagingRoot: join(f.options.mo2Root, "scratch") },
      { mo2Root: join(stage, "mo2") },
      { stagingRoot: f.options.candidateStore },
      { stagingRoot: join(f.options.candidateStore, "scratch") },
      { candidateStore: stage },
      { stagingRoot: f.options.gameRoot },
      { stagingRoot: join(f.options.gameRoot, "scratch") },
      { gameRoot: join(stage, "mo2") },
    ];
    for (const change of cases) {
      const options = { ...f.options, ...change };
      expect(() => planRuntimePromotion(options)).toThrow("outside every source root");
      expect(() => promoteRuntimeDiagnostic(options)).toThrow("outside every source root");
    }
    expect(existsSync(join(f.options.mo2Root, "profiles", f.options.newProfileId))).toBe(false);
    expect(existsSync(join(f.options.mo2Root, "mods", "XF Studio"))).toBe(false);
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
  } finally { f.cleanup(); }
});

test("missing trusted stage receipt and changed source candidate block promotion", () => {
  const f = fixture();
  try {
    const receiptDir = join(f.options.stagingRoot, "receipts");
    const receiptName = readdirSync(receiptDir).find(name => name.endsWith(".json"))!;
    const receipt = join(receiptDir, receiptName);
    const originalReceipt = readFileSync(receipt);
    rmSync(receipt);
    expect(() => planRuntimePromotion(f.options)).toThrow("trusted stage transport receipt");
    writeFileSync(receipt, originalReceipt);
    writeFileSync(join(f.options.candidateStore, f.options.candidateId,
      "archive", "pc", "mod", "xfs_fixture.archive"), "changed");
    expect(() => planRuntimePromotion(f.options)).toThrow("Candidate payload differs");
    expect(existsSync(join(f.options.mo2Root, "profiles", f.options.newProfileId))).toBe(false);
  } finally { f.cleanup(); }
});

test("changed promoted content blocks rollback and keeps the user's changes", () => {
  const f = fixture();
  try {
    const preview = promoteRuntimeDiagnostic(f.options);
    const changed = join(preview.newProfile, "settings.ini");
    writeFileSync(changed, "user edit");
    expect(() => rollbackRuntimePromotion(f.options)).toThrow("Owned files changed");
    expect(readFileSync(changed, "utf8")).toBe("user edit");
    expect(existsSync(preview.dedicatedMod)).toBe(true);
  } finally { f.cleanup(); }
});

test("completed rename with leftover journal is finalized", () => {
  const f = fixture();
  try {
    // Simulate a crash after writing the receipt, before removing the journal.
    const preview = promoteRuntimeDiagnostic(f.options);
    const receipt = join(f.options.stagingRoot, "promotion-receipt.json");
    const journal = join(f.options.stagingRoot, "promotion-journal.json");
    const saved = readFileSync(receipt);
    writeFileSync(journal, saved);
    expect(recoverRuntimePromotion(f.options)).toBe("completed");
    expect(existsSync(journal)).toBe(false);
    expect(existsSync(preview.newProfile)).toBe(true);
  } finally { f.cleanup(); }
});

test("partial promotion recovery removes only matching created content", () => {
  const f = fixture();
  try {
    const preview = promoteRuntimeDiagnostic(f.options);
    const receipt = join(f.options.stagingRoot, "promotion-receipt.json");
    const journal = join(f.options.stagingRoot, "promotion-journal.json");
    writeFileSync(journal, readFileSync(receipt));
    rmSync(receipt);
    rmSync(preview.newProfile, { recursive: true });
    expect(recoverRuntimePromotion(f.options)).toBe("reverted");
    expect(existsSync(preview.dedicatedMod)).toBe(false);
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
    expect(readFileSync(join(f.options.mo2Root, "mods", "Other Mod", "keep.txt"), "utf8"))
      .toBe("untouched");
  } finally { f.cleanup(); }
});
