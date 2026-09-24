import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModInstallTransport } from "../src/mod-install-transport";
import { defaultLocalSettings } from "../src/local-settings";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";

const digest = (body: string) => createHash("sha256").update(body).digest("hex");
function fixture(route: "direct" | "mo2") {
  const root = mkdtempSync(join(tmpdir(), "xfs-install-"));
  const game = join(root, "game"), mo2 = join(root, "mo2"), store = join(root, "candidates");
  const profileId = "2025 (again)";
  mkdirSync(join(game, "bin", "x64"), { recursive: true });
  mkdirSync(join(game, "archive", "pc"), { recursive: true });
  writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  mkdirSync(join(mo2, "mods"), { recursive: true });
  mkdirSync(join(mo2, "profiles", profileId), { recursive: true });
  writeFileSync(join(mo2, "profiles", profileId, "modlist.txt"), "+Other Mod\n");
  mkdirSync(store);
  const settings = defaultLocalSettings();
  settings.gameRoot = game; settings.mo2Root = mo2; settings.mo2ProfileId = profileId;
  settings.launchRoute = route; settings.installMode = route;
  const receiptsRoot = join(root, "receipts");
  const transport = createModInstallTransport({ candidateStore: store, receiptsRoot, settings });
  const target = route === "direct" ? join(game, "archive", "pc", "mod") :
    join(mo2, "mods", EYE_MAKEUP_MOD.modName, "archive", "pc", "mod");
  function candidate(candidateId: string, version: string) {
    const folder = join(store, candidateId), payload = join(folder, "archive", "pc", "mod");
    mkdirSync(payload, { recursive: true });
    const files = ["xfs_test.archive", "xfs_test.archive.xl"].map((name, index) => {
      const body = `${version}-${index}`;
      writeFileSync(join(payload, name), body);
      return { path: `archive/pc/mod/${name}`, sha256: digest(body), bytes: Buffer.byteLength(body) };
    });
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-1",
      namespace: "xfs_test", verifiedUnpackedFiles: 2, installed: false,
      gameRenderingVerified: false, files }));
  }
  return { root, store, receiptsRoot, target, game, mo2, settings, transport, candidate,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

for (const route of ["direct", "mo2"] as const) {
  test(`${route} installs and removes exactly the verified pair`, () => {
    const f = fixture(route);
    try {
      f.candidate("first", "one");
      mkdirSync(f.target, { recursive: true });
      writeFileSync(join(f.target, "unrelated.archive"), "keep me");
      const plan = f.transport.preflight("first");
      expect(plan.route).toBe(route);
      expect(plan.files).toHaveLength(2);
      const receipt = f.transport.install("first");
      expect(receipt.files.map(x => readFileSync(join(f.target, x.path.split("/").at(-1)!), "utf8")))
        .toEqual(["one-0", "one-1"]);
      expect(f.transport.receipt()?.candidateId).toBe("first");
      f.transport.uninstall();
      expect(f.transport.receipt()).toBeNull();
      expect(existsSync(join(f.target, "xfs_test.archive"))).toBe(false);
      expect(readFileSync(join(f.target, "unrelated.archive"), "utf8")).toBe("keep me");
      expect(readFileSync(join(f.mo2, "profiles", "2025 (again)", "modlist.txt"), "utf8")).toBe("+Other Mod\n");
    } finally { f.cleanup(); }
  });
}

test("existing unowned or edited files block install, update and uninstall", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one"); f.candidate("second", "two");
    mkdirSync(f.target);
    writeFileSync(join(f.target, "xfs_test.archive"), "someone else's file");
    expect(() => f.transport.preflight("first")).toThrow("unowned or changed");
    rmSync(join(f.target, "xfs_test.archive"));
    f.transport.install("first");
    writeFileSync(join(f.target, "xfs_test.archive.xl"), "user edit");
    expect(() => f.transport.install("second")).toThrow("unowned or changed");
    expect(() => f.transport.uninstall()).toThrow("unowned or changed");
    expect(() => f.transport.receipt()).toThrow("unowned or changed");
    expect(readFileSync(join(f.target, "xfs_test.archive.xl"), "utf8")).toBe("user edit");
  } finally { f.cleanup(); }
});

test("MO2 accepts a real profile name while rejecting traversal and separators", () => {
  const f = fixture("mo2");
  try {
    f.candidate("first", "one");
    expect(f.transport.preflight("first").route).toBe("mo2");
    for (const profileId of ["../2025 (again)", "..", "other/profile", "other\\profile", "bad."]) {
      expect(() => createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot,
        settings: { ...f.settings, mo2ProfileId: profileId } })).toThrow("Configured MO2 instance and profile are missing");
    }
  } finally { f.cleanup(); }
});

test("update can roll back to the preceding owned pair", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one"); f.candidate("second", "two");
    f.transport.install("first");
    expect(f.transport.install("second").rollback?.prior.candidateId).toBe("first");
    expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe("two-0");
    expect(f.transport.rollback().candidateId).toBe("first");
    expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe("one-0");
    expect(readFileSync(join(f.target, "xfs_test.archive.xl"), "utf8")).toBe("one-1");
  } finally { f.cleanup(); }
});

test("tampered candidates and path escapes fail before touching destination", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one");
    expect(() => f.transport.preflight("../first")).toThrow("Invalid candidate ID");
    const path = join(f.store, "first", "archive", "pc", "mod", "xfs_test.archive");
    writeFileSync(path, "tampered");
    expect(() => f.transport.install("first")).toThrow("Candidate payload differs");
    expect(existsSync(f.target)).toBe(false);
  } finally { f.cleanup(); }
});

test("interrupted paired swap is restored from a journal and verified backups", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one"); f.candidate("second", "two");
    const prior = f.transport.install("first");
    const backup = join(f.receiptsRoot, "test-backup"); mkdirSync(backup);
    for (const entry of prior.files) writeFileSync(join(backup, entry.path.split("/").at(-1)!),
      readFileSync(join(f.target, entry.path.split("/").at(-1)!)));
    const next = JSON.parse(readFileSync(join(f.store, "second", "manifest.json"), "utf8")).files;
    const receiptFile = readdirSync(f.receiptsRoot).find(name => name.endsWith(".json"))!;
    writeFileSync(join(f.receiptsRoot, receiptFile.replace(/\.json$/, ".journal.json")), JSON.stringify({
      schema: "xfs/install-journal-1", targetId: prior.targetId, target: prior.target,
      names: next.map((x: {path: string}) => x.path.split("/").at(-1)), next, prior, backup,
    }));
    writeFileSync(join(f.target, "xfs_test.archive"), "two-0");
    expect(f.transport.recover()).toEqual({ recovered: true, conflicts: [] });
    expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe("one-0");
    expect(readFileSync(join(f.target, "xfs_test.archive.xl"), "utf8")).toBe("one-1");
  } finally { f.cleanup(); }
});

test("recovery refuses a later edit instead of replacing it", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one"); f.candidate("second", "two");
    const prior = f.transport.install("first");
    const backup = join(f.receiptsRoot, "test-backup"); mkdirSync(backup);
    for (const entry of prior.files) writeFileSync(join(backup, entry.path.split("/").at(-1)!),
      readFileSync(join(f.target, entry.path.split("/").at(-1)!)));
    const next = JSON.parse(readFileSync(join(f.store, "second", "manifest.json"), "utf8")).files;
    const receiptFile = readdirSync(f.receiptsRoot).find(name => name.endsWith(".json"))!;
    writeFileSync(join(f.receiptsRoot, receiptFile.replace(/\.json$/, ".journal.json")), JSON.stringify({
      schema: "xfs/install-journal-1", targetId: prior.targetId, target: prior.target,
      names: next.map((x: {path: string}) => x.path.split("/").at(-1)), next, prior, backup,
    }));
    writeFileSync(join(f.target, "xfs_test.archive"), "edited after crash");
    expect(f.transport.recover().conflicts).toEqual([join(f.target, "xfs_test.archive")]);
    expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe("edited after crash");
    expect(() => f.transport.install("second")).toThrow("interrupted install needs recovery");
  } finally { f.cleanup(); }
});

test("stale process locks can be reclaimed for recovery", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one");
    const receipt = f.transport.install("first");
    writeFileSync(join(f.receiptsRoot, `${receipt.targetId}.lock`), JSON.stringify({ pid: 2147483647, started: 1 }));
    expect(f.transport.recover()).toEqual({ recovered: false, conflicts: [] });
    expect(existsSync(join(f.receiptsRoot, `${receipt.targetId}.lock`))).toBe(false);
  } finally { f.cleanup(); }
});

test("malformed private receipts and journals are rejected before file changes", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one");
    const receipt = f.transport.install("first");
    const receiptFile = join(f.receiptsRoot, `${receipt.targetId}.json`);
    const journalFile = join(f.receiptsRoot, `${receipt.targetId}.journal.json`);
    const original = readFileSync(receiptFile, "utf8");
    writeFileSync(receiptFile, JSON.stringify({ ...receipt, files: [{ path: "../../outside", sha256: digest("x"), bytes: 1 }] }));
    expect(() => f.transport.uninstall()).toThrow("Install receipt target or files mismatch");
    expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe("one-0");
    writeFileSync(receiptFile, original);
    writeFileSync(journalFile, JSON.stringify({ schema: "xfs/install-journal-1", targetId: receipt.targetId,
      target: receipt.target, names: ["../../outside", "xfs_test.archive.xl"], next: receipt.files,
      prior: receipt, backup: null }));
    expect(() => f.transport.recover()).toThrow("Install journal target or files mismatch");
    expect(readFileSync(join(f.target, "xfs_test.archive.xl"), "utf8")).toBe("one-1");
  } finally { f.cleanup(); }
});

test("an MO2 folder from an earlier XF Studio-named diagnostic blocks a second install beside it", () => {
  const f = fixture("mo2");
  try {
    f.candidate("first", "one");
    for (const legacy of EYE_MAKEUP_MOD.legacyModFolders) {
      mkdirSync(join(f.mo2, "mods", legacy.toLowerCase()));
      const transport = createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot, settings: f.settings });
      expect(() => transport.preflight("first")).toThrow(`earlier ${EYE_MAKEUP_MOD.modName} install under the legacy folder`);
      expect(() => transport.install("first")).toThrow("legacy folder");
      expect(transport.receipt()).toBeNull();
      expect(existsSync(f.target)).toBe(false);
      rmSync(join(f.mo2, "mods", legacy.toLowerCase()), { recursive: true });
    }
    expect(f.transport.preflight("first").target).toBe(f.target);
  } finally { f.cleanup(); }
});
