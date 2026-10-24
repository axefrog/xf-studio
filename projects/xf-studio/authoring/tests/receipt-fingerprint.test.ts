import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./temp-dir";
import { fileFingerprint } from "../src/installation/host/file-fingerprint";
import { defaultLocalSettings } from "../src/setup/local-settings";
import { hashingSettled, involvedMods, ownInstallOf, readOwnInstalls, type InvolvedArchive, type OwnInstall } from "../src/diagnostics/host/mod-identity";

test("receipts require full hash or a matching bounded fingerprint; old receipts remain unconfirmed", async () => {
  const root = tempDir("receipt-fingerprint-"), folder = join(root, "archive", "pc", "mod"), receipts = join(root, "receipts");
  mkdirSync(folder, { recursive: true }); mkdirSync(receipts);
  const settings = { ...defaultLocalSettings(), gameRoot: root };
  const path = join(folder, "own.archive"), bytes = Buffer.alloc(200_000, 42);
  writeFileSync(path, bytes);
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), fingerprint = fileFingerprint(path);
  const install: OwnInstall = { folder, build: "test", installedAt: "", files: [{ folder, name: "own.archive", bytes: bytes.length, sha256, fingerprint }] };
  const archive: InvolvedArchive = { name: "own.archive", path, group: "mod", bytes: bytes.length, sha256, modified: null, won: 1, lost: 0, identifiedBy: "sha-256" };
  const mod = { kind: "manual" as const, archives: [archive] };
  expect(ownInstallOf(mod, [install])).toBe(install);
  archive.sha256 = null; archive.fingerprint = fingerprint;
  expect(ownInstallOf(mod, [install])).toBe(install);
  const old = { ...install, files: install.files.map(({ fingerprint: _, ...entry }) => entry) };
  expect(ownInstallOf(mod, [old])).toBeNull();
  // Budget expires after the cheap read: recognition does not require a full-file hash.
  let ticks = 0;
  const partial = await involvedMods([{ archive: "own.archive", provider: "Installed game", group: "mod", alternatives: [] }],
    settings, () => undefined, { ownInstalls: [install], hashBudgetMs: 10, now: () => ++ticks < 3 ? 0 : 10 });
  expect(partial[0]).toMatchObject({ status: "built-by-xf-studio", archives: [{ sha256: null }] });
  await hashingSettled();
  bytes[bytes.length - 1] = 43; writeFileSync(path, bytes);
  archive.fingerprint = fileFingerprint(path);
  expect(ownInstallOf(mod, [install])).toBeNull();
  archive.sha256 = "0".repeat(64); archive.fingerprint = fingerprint;
  expect(ownInstallOf(mod, [install])).toBeNull(); // a full hash always takes precedence
  writeFileSync(join(folder, "old.archive"), bytes);
  writeFileSync(join(receipts, `${"a".repeat(24)}.json`), JSON.stringify({ schema: "xfs/install-receipt-1", target: folder, candidateId: "test",
    files: [{ path: "archive/pc/mod/old.archive", bytes: bytes.length, sha256 }] }));
  const read = readOwnInstalls([receipts]);
  expect(read).toHaveLength(1);
  expect(read[0]!.files[0]!.fingerprint).toBeUndefined();
  const found = await involvedMods([{ archive: "old.archive", provider: "Installed game", group: "mod", alternatives: [] }],
    settings, () => undefined, { ownInstalls: read, hashBudgetMs: 0 });
  expect(found[0]).toMatchObject({ status: "local-only", receiptIdentity: "unconfirmed" });
  await hashingSettled();
});
