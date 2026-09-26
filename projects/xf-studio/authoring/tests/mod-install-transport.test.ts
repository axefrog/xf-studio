import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModInstallTransport, declaredResources, installedDuplicates } from "../src/mod-install-transport";
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
      // The game's folder is shared by every mod; an MO2 mod's folder is its own, so there the other file arrives later.
      const unrelated = () => { mkdirSync(f.target, { recursive: true }); writeFileSync(join(f.target, "unrelated.archive"), "keep me"); };
      if (route === "direct") unrelated();
      const plan = f.transport.preflight("first");
      expect(plan.route).toBe(route);
      expect(plan.files).toHaveLength(2);
      const receipt = f.transport.install("first");
      if (route === "mo2") unrelated();
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
    expect(f.transport.recover()).toEqual({ recovered: true, conflicts: [], direction: "back" });
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

test("MO2 install targets the instance's configured mod and profile directories", () => {
  const f = fixture("mo2");
  try {
    const data = join(f.root, "mo2-data");
    mkdirSync(join(data, "staged"), { recursive: true });
    mkdirSync(join(data, "profiles", "2025 (again)"), { recursive: true });
    writeFileSync(join(data, "profiles", "2025 (again)", "modlist.txt"), "+Other Mod\n");
    writeFileSync(join(f.mo2, "ModOrganizer.ini"), ["[General]", "gameName=Cyberpunk 2077", "[Settings]",
      `base_directory=${data.replaceAll("\\", "/")}`, "mod_directory=%BASE_DIR%/staged"].join("\r\n"));
    f.candidate("first", "one");
    const transport = createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot, settings: f.settings });
    const expected = join(data, "staged", EYE_MAKEUP_MOD.modName, "archive", "pc", "mod");
    expect(transport.preflight("first").target).toBe(expected);
    transport.install("first");
    expect(existsSync(join(expected, "xfs_test.archive"))).toBe(true);
    expect(existsSync(f.target)).toBe(false);
    transport.uninstall();
  } finally { f.cleanup(); }
});

/** A local-package-2 candidate: one product with its archive and feature namespaces. */
function productCandidate(store: string, candidateId: string, options: { archive: string; modName: string; features: { feature: string; namespace: string }[] }) {
  const folder = join(store, candidateId), payload = join(folder, "archive", "pc", "mod");
  mkdirSync(payload, { recursive: true });
  const files = [`${options.archive}.archive`, `${options.archive}.archive.xl`].map((name, index) => {
    const body = `${candidateId}-${index}`;
    writeFileSync(join(payload, name), body);
    return { path: `archive/pc/mod/${name}`, sha256: digest(body), bytes: Buffer.byteLength(body) };
  });
  writeFileSync(join(folder, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-2", productId: "11111111-2222-4333-8444-555555555555",
    modName: options.modName, nameSource: "derived", archive: options.archive, features: options.features, files, verifiedUnpackedFiles: 2,
    installed: false, gameRenderingVerified: false }));
}

test("the transport reads local-package-2 candidates and records their feature namespaces", () => {
  const f = fixture("direct");
  try {
    productCandidate(f.store, "product", { archive: "xfs_cabc", modName: EYE_MAKEUP_MOD.modName,
      features: [{ feature: "eye-makeup", namespace: "xfs_cabc" }] });
    expect(f.transport.preflight("product").files.map(file => file.path)).toEqual(["archive/pc/mod/xfs_cabc.archive", "archive/pc/mod/xfs_cabc.archive.xl"]);
    expect(f.transport.install("product").features).toEqual([{ feature: "eye-makeup", namespace: "xfs_cabc" }]);
    // A product of another mod belongs in that mod's folder: this transfer refuses it.
    productCandidate(f.store, "lips", { archive: "xfs_mdef", modName: "XF Lip Artistry", features: [{ feature: "lips", namespace: "xfs_clips" }] });
    expect(() => f.transport.preflight("lips")).toThrow("This build is the mod “XF Lip Artistry”");
  } finally { f.cleanup(); }
});

test("a feature namespace already installed in another XF mod is refused (no duplicated looks in game)", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one"); // local-package-1: eye makeup, namespace xfs_test
    f.transport.install("first");
    // The same eye makeup, split into another mod placed through a second target (MO2), would appear twice in game.
    const mo2 = createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot,
      settings: { ...f.settings, launchRoute: "mo2", installMode: "mo2" }, modName: "XF Night" });
    productCandidate(f.store, "moved", { archive: "xfs_m123", modName: "XF Night", features: [{ feature: "eye-makeup", namespace: "xfs_test" }] });
    expect(() => mo2.preflight("moved")).toThrow("already installed in another XF mod (xfs_test)");
    // After the first mod is uninstalled, the move can be placed.
    f.transport.uninstall();
    expect(mo2.preflight("moved").files).toHaveLength(2);
  } finally { f.cleanup(); }
});

test("an MO2 folder of the mod's name that XF Studio didn't create is never written into (PIPE-90)", () => {
  const f = fixture("mo2");
  try {
    f.candidate("first", "one");
    const folder = join(f.mo2, "mods", EYE_MAKEUP_MOD.modName);
    // An empty tree (an interrupted first install) is fine; someone else's mod of that name is refused in plain words.
    mkdirSync(join(folder, "archive", "pc", "mod"), { recursive: true });
    expect(f.transport.preflight("first").route).toBe("mo2");
    writeFileSync(join(folder, "readme.txt"), "someone else's mod");
    expect(() => f.transport.preflight("first")).toThrow(`already has a mod called “${EYE_MAKEUP_MOD.modName}” that XF Studio didn't put there`);
    expect(() => f.transport.install("first")).toThrow("didn't put there");
    expect(readdirSync(join(folder, "archive", "pc", "mod"))).toEqual([]);
    // Once installed (our receipt), later files beside ours don't make it foreign.
    rmSync(join(folder, "readme.txt"));
    f.transport.install("first");
    writeFileSync(join(folder, "readme.txt"), "added later");
    expect(f.transport.preflight("first").replacingOwned).toBe(true);
  } finally { f.cleanup(); }
});

test("a renamed mod's name flows through the transport, checked as a folder name (PIPE-90)", () => {
  const f = fixture("mo2");
  try {
    const folder = join(f.store, "night"), payload = join(folder, "archive", "pc", "mod");
    mkdirSync(payload, { recursive: true });
    const files = ["xfs_test.archive", "xfs_test.archive.xl"].map(name => {
      writeFileSync(join(payload, name), name);
      return { path: `archive/pc/mod/${name}`, sha256: digest(name), bytes: name.length };
    });
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({ schema: "xfs/local-package-2", productId: "0ec3546e-3fac-43e7-8c19-a65d20383d41",
      modName: "XF Night Looks", archive: "xfs_test", features: [{ feature: "eye-makeup", namespace: "xfs_test" }], files,
      verifiedUnpackedFiles: 2, installed: false, gameRenderingVerified: false }));
    expect(() => f.transport.preflight("night")).toThrow("this transfer places");
    const named = createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot, settings: f.settings, modName: "XF Night Looks" });
    expect(named.preflight("night").target).toBe(join(f.mo2, "mods", "XF Night Looks", "archive", "pc", "mod"));
    for (const unsafe of ["..", "a/b", "..\\x", " padded", "CON"])
      expect(() => createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot, settings: f.settings, modName: unsafe }))
        .toThrow("can't be used as a mod folder");
  } finally { f.cleanup(); }
});

test("declared resources: what an ArchiveXL declaration registers, and installed mods holding part of a candidate (PIPE-90)", () => {
  expect(declaredResources("customizations:\r\n  female: A\\B.inkcharcustomization\r\n  male:\r\n    - a\\c.inkcharcustomization\r\n" +
    "resource:\r\n  scope:\r\n    player_customization.app:\r\n      - a\\b.app\r\n")).toEqual(["a/b.inkcharcustomization", "a/c.inkcharcustomization", "a/b.app"]);
  expect(declaredResources("not: [yaml")).toEqual([]);
  expect(declaredResources("candidate-1")).toEqual([]);
  const f = fixture("mo2");
  try {
    const place = (name: string, text: string) => {
      const dir = join(f.mo2, "mods", name, "archive", "pc", "mod");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "x.archive.xl"), text);
      return { label: name, folder: dir };
    };
    const places = [place("Same looks", "customizations:\r\n  female:\r\n    - a\\b.inkcharcustomization\r\n    - z\\z.inkcharcustomization\r\n"),
      place("Other looks", "customizations:\r\n  female: q\\r.inkcharcustomization\r\n"), { label: "Missing", folder: join(f.root, "none") }];
    expect(installedDuplicates("customizations:\r\n  female: a\\b.inkcharcustomization\r\n", places)).toEqual(["Same looks"]);
    expect(installedDuplicates("candidate-1", places)).toEqual([]);
  } finally { f.cleanup(); }
});

/** An update interrupted after `done` of its two renames: the journal a real install leaves (with the receipt it was about to write). */
function interrupt(f: ReturnType<typeof fixture>, next: string, done: 0 | 1 | 2) {
  const prior = f.transport.receipt()!;
  const backup = join(f.receiptsRoot, `${prior.targetId}-test-backup`); mkdirSync(backup);
  for (const entry of prior.files) writeFileSync(join(backup, entry.path.split("/").at(-1)!), readFileSync(join(f.target, entry.path.split("/").at(-1)!)));
  const files = JSON.parse(readFileSync(join(f.store, next, "manifest.json"), "utf8")).files as { path: string }[];
  const pending = { ...prior, candidateId: next, files, installedAt: new Date().toISOString(), rollback: { prior: { ...prior, rollback: null }, backup } };
  writeFileSync(join(f.receiptsRoot, `${prior.targetId}.journal.json`), JSON.stringify({ schema: "xfs/install-journal-1", targetId: prior.targetId,
    target: prior.target, names: files.map(x => x.path.split("/").at(-1)), next: files, prior, backup, pending }));
  for (const entry of files.slice(0, done)) writeFileSync(join(f.target, entry.path.split("/").at(-1)!), readFileSync(join(f.store, next, ...entry.path.split("/"))));
}

test("recovery follows the journal: finished when every new file is in place, undone when only some are, forgotten when all are gone (INSTALL-02)", () => {
  for (const [done, direction, archive, owner] of [[2, "forward", "two-0", "second"], [1, "back", "one-0", "first"]] as const) {
    const f = fixture("direct");
    try {
      f.candidate("first", "one"); f.candidate("second", "two");
      f.transport.install("first");
      interrupt(f, "second", done);
      expect(f.transport.pending()).toBe(true);
      expect(() => f.transport.preflight("second")).toThrow("interrupted install needs recovery");
      expect(f.transport.recover()).toEqual({ recovered: true, conflicts: [], direction });
      expect(f.transport.pending()).toBe(false);
      expect(readFileSync(join(f.target, "xfs_test.archive"), "utf8")).toBe(archive);
      expect(f.transport.receipt()!.candidateId).toBe(owner);
    } finally { f.cleanup(); }
  }
  const g = fixture("direct");
  try {
    g.candidate("first", "one"); g.candidate("second", "two");
    g.transport.install("first");
    interrupt(g, "second", 1);
    for (const name of ["xfs_test.archive", "xfs_test.archive.xl"]) rmSync(join(g.target, name));
    expect(g.transport.recover()).toEqual({ recovered: true, conflicts: [], direction: "cleared" });
    expect(g.transport.record()).toBeNull();
    expect(g.transport.preflight("second").replacingOwned).toBe(false);
  } finally { g.cleanup(); }
});

test("a recorded install whose files are gone is installed afresh, but a file XF Studio didn't put there still refuses (INSTALL-03)", () => {
  const f = fixture("mo2");
  try {
    f.candidate("first", "one"); f.candidate("second", "two");
    f.transport.install("first");
    const folder = join(f.mo2, "mods", EYE_MAKEUP_MOD.modName);
    // Removed in MO2: the whole folder goes.
    rmSync(folder, { recursive: true });
    expect(f.transport.preflight("second")).toMatchObject({ replacingOwned: false, reinstalling: true });
    expect(f.transport.install("second").rollback).toBeNull();
    // One file deleted by hand, MO2's meta.ini beside it: the other file is still ours (by hash) and is replaced.
    writeFileSync(join(folder, "meta.ini"), "[General]\n");
    rmSync(join(f.target, "xfs_test.archive"));
    expect(f.transport.preflight("first")).toMatchObject({ replacingOwned: false, reinstalling: true });
    // A file of that name someone else put there is never replaced.
    writeFileSync(join(f.target, "xfs_test.archive"), "someone else's");
    expect(() => f.transport.preflight("first")).toThrow("unowned or changed");
    rmSync(join(f.target, "xfs_test.archive"));
    writeFileSync(join(f.target, "xfs_test.archive.xl"), "edited");
    expect(() => f.transport.preflight("first")).toThrow("unowned or changed");
    // Other files in a folder whose install is gone make it someone else's.
    rmSync(join(f.target, "xfs_test.archive.xl"));
    writeFileSync(join(folder, "readme.txt"), "a mod someone else put here");
    expect(() => f.transport.preflight("first")).toThrow("didn't put there");
  } finally { f.cleanup(); }
});

test("a first install that fails before any file is in place leaves no empty mod folder behind (INSTALL-09)", () => {
  const f = fixture("mo2");
  try {
    f.candidate("first", "one");
    const failing = createModInstallTransport({ candidateStore: f.store, receiptsRoot: f.receiptsRoot, settings: f.settings,
      afterStaging: () => { throw Error("disk full"); } });
    expect(() => failing.install("first")).toThrow("disk full");
    expect(existsSync(join(f.mo2, "mods", EYE_MAKEUP_MOD.modName))).toBe(false);
    expect(readdirSync(join(f.mo2, "mods"))).toEqual([]);
    // Folders that were already there stay.
    mkdirSync(join(f.mo2, "mods", EYE_MAKEUP_MOD.modName, "archive"), { recursive: true });
    expect(() => failing.install("first")).toThrow("disk full");
    expect(readdirSync(join(f.mo2, "mods", EYE_MAKEUP_MOD.modName))).toEqual(["archive"]);
  } finally { f.cleanup(); }
});

test("a receipt from another receipts folder is adopted once, without its rollback, and set aside there (INSTALL-04)", () => {
  const f = fixture("direct");
  try {
    f.candidate("first", "one");
    const earlier = f.transport.install("first");
    const shared = createModInstallTransport({ candidateStore: f.store, receiptsRoot: join(f.root, "shared"), settings: f.settings });
    expect(shared.record()).toBeNull();
    expect(shared.adopt(f.transport.record()!)).toBe(true);
    f.transport.retire();
    expect(shared.receipt()).toMatchObject({ candidateId: "first", installedAt: earlier.installedAt, rollback: null });
    expect(f.transport.record()).toBeNull();
    expect(readdirSync(f.receiptsRoot).some(name => name.includes(".json.adopted-"))).toBe(true);
    expect(shared.adopt(earlier)).toBe(false);
    expect(shared.preflight("first").replacingOwned).toBe(true);
  } finally { f.cleanup(); }
});
