import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planRuntimeDiagnostic, stageRuntimeDiagnostic } from "../src/runtime-diagnostic-stage";
import { planRuntimePromotion, promoteRuntimeDiagnostic, recoverRuntimePromotion,
  rollbackRuntimePromotion } from "../src/runtime-diagnostic-promotion";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xfs-promotion-"));
  const gameRoot = join(root, "game"), mo2Root = join(root, "real-mo2");
  const candidateStore = join(root, "candidates"), candidateId = "build_1";
  const profileId = "Existing Profile", newProfileId = "XF Eye Artistry diagnostic";
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
  writeFileSync(join(sourceProfile, "archives.txt"), "");
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
    expect(plan.files).toHaveLength(7);
    expect(plan.files.find(item => item.target === join(plan.newProfile, "archives.txt")))
      .toMatchObject({ bytes: 0, sha256: hash("") });
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
      .toBe(`+Other Mod\r\n+${EYE_MAKEUP_MOD.modName}\r\n-XF Eye Artistry CCXL - Dev\r\n-Unused Mod\r\n`);
    expect(preview.dedicatedMod).toBe(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName));
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
    expect(readFileSync(join(preview.newProfile, "plugins.txt"), "utf8")).toBe("*fixture.esm\n");
    expect(readFileSync(join(preview.newProfile, "loadorder.txt"), "utf8")).toBe("fixture.esm\n");
    expect(readFileSync(join(preview.newProfile, "archives.txt"), "utf8")).toBe("");
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
    const stageFile = join(f.options.stagingRoot, "mo2", "mods", EYE_MAKEUP_MOD.modName, "archive", "pc", "mod", "xfs_fixture.archive");
    writeFileSync(stageFile, "tampered");
    expect(() => planRuntimePromotion(f.options)).toThrow("Staged payload differs");
    writeFileSync(stageFile, "candidate-0");
    writeFileSync(join(f.sourceProfile, "settings.ini"), "changed");
    expect(() => planRuntimePromotion(f.options)).toThrow("Source profile metadata changed");
    writeFileSync(join(f.sourceProfile, "settings.ini"), "private fixture settings\n");
    writeFileSync(join(f.options.gameRoot, "archive", "pc", "mod", "xfs_fixture.archive"), "collision");
    expect(() => planRuntimePromotion(f.options)).toThrow("Direct game archive collision");
    rmSync(join(f.options.gameRoot, "archive", "pc", "mod", "xfs_fixture.archive"));
    mkdirSync(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName.toLowerCase()));
    expect(() => planRuntimePromotion(f.options)).toThrow("Destination already exists");
    rmSync(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName.toLowerCase()), { recursive: true });
    // The 25 September diagnostic created "XF Studio": the same mod, so never add a second copy.
    mkdirSync(join(f.options.mo2Root, "mods", "xf studio"));
    expect(() => planRuntimePromotion(f.options)).toThrow("legacy folder \"xf studio\"");
    expect(() => promoteRuntimeDiagnostic(f.options)).toThrow("legacy folder");
    expect(existsSync(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName))).toBe(false);
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
    expect(existsSync(join(f.options.mo2Root, "mods", EYE_MAKEUP_MOD.modName))).toBe(false);
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
    expect(readFileSync(join(preview.newProfile, "archives.txt"), "utf8")).toBe("");
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
    expect(existsSync(join(preview.newProfile, "archives.txt"))).toBe(false);
    expect(existsSync(preview.dedicatedMod)).toBe(false);
    expect(readFileSync(join(f.sourceProfile, "modlist.txt"), "utf8")).toBe(f.sourceList);
    expect(readFileSync(join(f.options.mo2Root, "mods", "Other Mod", "keep.txt"), "utf8"))
      .toBe("untouched");
  } finally { f.cleanup(); }
});

test("a promotion recorded under the legacy XF Studio folder can still be rolled back", () => {
  const f = fixture();
  try {
    const preview = promoteRuntimeDiagnostic(f.options);
    // Rewrite this promotion as the pre-branding tool recorded it: same files, legacy folder name.
    const legacyMod = join(f.options.mo2Root, "mods", "XF Studio");
    renameSync(preview.dedicatedMod, legacyMod);
    const receipt = join(f.options.stagingRoot, "promotion-receipt.json");
    const record = JSON.parse(readFileSync(receipt, "utf8"));
    record.preview.dedicatedMod = legacyMod;
    record.preview.stageMod = join(f.options.stagingRoot, "mo2", "mods", "XF Studio");
    writeFileSync(receipt, JSON.stringify(record, null, 2) + "\n");
    rollbackRuntimePromotion(f.options);
    expect(existsSync(legacyMod)).toBe(false);
    expect(existsSync(preview.newProfile)).toBe(false);
    expect(readFileSync(join(f.options.mo2Root, "mods", "Other Mod", "keep.txt"), "utf8")).toBe("untouched");
    // Any other folder name in a record is still refused.
    record.preview.dedicatedMod = join(f.options.mo2Root, "mods", "Other Mod");
    record.preview.stageMod = join(f.options.stagingRoot, "mo2", "mods", "Other Mod");
    writeFileSync(join(f.options.stagingRoot, "promotion-journal.json"), JSON.stringify(record));
    expect(() => recoverRuntimePromotion(f.options)).toThrow("Promotion record target mismatch");
    expect(readFileSync(join(f.options.mo2Root, "mods", "Other Mod", "keep.txt"), "utf8")).toBe("untouched");
  } finally { f.cleanup(); }
});

test("a stage prepared under the legacy folder name must be staged again", () => {
  const f = fixture();
  try {
    const planFile = join(f.options.stagingRoot, "diagnostic-plan.json");
    const plan = JSON.parse(readFileSync(planFile, "utf8"));
    plan.stageReceipt.target = join(f.options.stagingRoot, "mo2", "mods", "XF Studio", "archive", "pc", "mod");
    writeFileSync(planFile, JSON.stringify(plan, null, 2) + "\n");
    expect(() => planRuntimePromotion(f.options)).toThrow(`Stage again so the promoted mod is named "${EYE_MAKEUP_MOD.modName}"`);
    expect(existsSync(join(f.options.mo2Root, "profiles", f.options.newProfileId))).toBe(false);
  } finally { f.cleanup(); }
});

/** A version-2 candidate of a renamed mod, with a real declaration (as a product Build writes it). */
function renamedFixture(modName = "XF Night Looks") {
  const root = mkdtempSync(join(tmpdir(), "xfs-promotion-renamed-"));
  const gameRoot = join(root, "game"), mo2Root = join(root, "real-mo2"), candidateStore = join(root, "candidates"), candidateId = "build_2";
  const profileId = "Existing Profile", sourceProfile = join(mo2Root, "profiles", profileId);
  mkdirSync(join(gameRoot, "bin", "x64"), { recursive: true });
  mkdirSync(join(gameRoot, "archive", "pc", "mod"), { recursive: true });
  writeFileSync(join(gameRoot, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  mkdirSync(join(mo2Root, "mods"), { recursive: true });
  mkdirSync(sourceProfile, { recursive: true });
  writeFileSync(join(sourceProfile, "modlist.txt"), "+Other Mod\r\n");
  const archive = "xfs_c0ec3546e3fac43e78c19a65d20383d41", payload = join(candidateStore, candidateId, "archive", "pc", "mod");
  const xl = "customizations:\r\n  female: axefrog\\looks\\xfs_collection.inkcharcustomization\r\n";
  mkdirSync(payload, { recursive: true });
  const files = [[`${archive}.archive`, "archive bytes"], [`${archive}.archive.xl`, xl]].map(([name, content]) => {
    writeFileSync(join(payload, name), content);
    return { path: `archive/pc/mod/${name}`, sha256: hash(content), bytes: Buffer.byteLength(content) };
  });
  writeFileSync(join(candidateStore, candidateId, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-2",
    productId: "0ec3546e-3fac-43e7-8c19-a65d20383d41", modName, nameSource: "plan", archive, omissions: [],
    features: [{ feature: "eye-makeup", namespace: archive, omissions: [], verification: { presetCount: 2 } }],
    files, verifiedUnpackedFiles: 5, installed: false, gameRenderingVerified: false }));
  const options = { gameRoot, mo2Root, candidateStore, candidateId, profileId, newProfileId: "Night diagnostic", stagingRoot: join(root, "stage") };
  return { root, options, xl, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a renamed mod stages and promotes under its own name (PIPE-90)", () => {
  const f = renamedFixture();
  try {
    const staged = stageRuntimeDiagnostic(f.options);
    expect(staged.plan.modName).toBe("XF Night Looks");
    expect(readdirSync(join(staged.stagedMo2, "mods"))).toEqual(["XF Night Looks"]);
    expect(readFileSync(join(staged.stagedProfile, "modlist.txt"), "utf8")).toContain("+XF Night Looks");
    const preview = promoteRuntimeDiagnostic(f.options);
    expect(preview).toMatchObject({ modName: "XF Night Looks", dedicatedMod: join(f.options.mo2Root, "mods", "XF Night Looks") });
    expect(readFileSync(join(preview.dedicatedMod, "archive", "pc", "mod", "xfs_c0ec3546e3fac43e78c19a65d20383d41.archive.xl"), "utf8")).toBe(f.xl);
    rollbackRuntimePromotion(f.options);
    expect(existsSync(preview.dedicatedMod)).toBe(false);
  } finally { f.cleanup(); }
});

test("a build already installed in another mod is refused at staging and at promotion, whichever stage installed it (PIPE-90)", () => {
  const f = renamedFixture();
  try {
    stageRuntimeDiagnostic(f.options);
    // Another stage promoted the same looks as "XF Looks" (a merged mod of the same collection) meanwhile.
    const other = join(f.options.mo2Root, "mods", "XF Looks", "archive", "pc", "mod");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "xfs_mffff.archive.xl"), "customizations:\r\n  female:\r\n    - axefrog\\looks\\xfs_collection.inkcharcustomization\r\n" +
      "    - axefrog\\looks\\lips.inkcharcustomization\r\n");
    expect(() => planRuntimePromotion(f.options)).toThrow("already installed in the Mod Organizer 2 mod “XF Looks”");
    expect(() => promoteRuntimeDiagnostic(f.options)).toThrow("already installed");
    expect(existsSync(join(f.options.mo2Root, "mods", "XF Night Looks"))).toBe(false);
    // A new stage sees it before anything is staged.
    const again = { ...f.options, stagingRoot: join(f.root, "stage-2") };
    expect(planRuntimeDiagnostic(again).duplicateInstalls).toEqual(["the Mod Organizer 2 mod “XF Looks”"]);
    expect(() => stageRuntimeDiagnostic(again)).toThrow("already installed");
    expect(existsSync(again.stagingRoot)).toBe(false);
    // A mod declaring other resources is not a duplicate.
    writeFileSync(join(other, "xfs_mffff.archive.xl"), "customizations:\r\n  female: axefrog\\other\\xfs_collection.inkcharcustomization\r\n");
    expect(planRuntimeDiagnostic(again).duplicateInstalls).toEqual([]);
  } finally { f.cleanup(); }
});
