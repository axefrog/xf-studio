// The desktop app carries XF Studio's texture compressor (PIPE-130): the prepared build tools and the packaged app (the canary update
// archive in artifacts/, which the setup installs byte for byte) hold `app/native/xfs_bcn.dll`, listed in their manifest with its
// SHA-256, and those bytes load and compress a block (bcn-check.ts, in a process of its own so the file can be removed afterwards).
// It runs against what exists: nothing is built here. `XFS_REQUIRE_PACKAGED_BCN=1` (set by CI after `build:canary`) makes a missing
// packaged app a failure instead of a skip.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import config from "../electrobun.config";
import { BUILD_TOOLS_SCHEMA, bcnEntry, builderEntry } from "../build";

const desktop = resolve(import.meta.dir, "..");
const bundle = `${config.app.name.replaceAll(" ", "")}-canary`;
const archive = join(desktop, "artifacts", `canary-win-x64-${bundle}.tar.zst`);
const prepared = join(desktop, "build-tools");
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const required = process.env.XFS_REQUIRE_PACKAGED_BCN === "1";
// Windows' own bsdtar reads .tar.zst; a GNU tar earlier on PATH cannot.
const tar = process.env.SystemRoot && existsSync(join(process.env.SystemRoot, "System32", "tar.exe")) ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";

function checkTools(folder: string) {
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
  expect(manifest.schema).toBe(BUILD_TOOLS_SCHEMA);
  expect(Object.keys(manifest.files).sort(), folder).toEqual([bcnEntry, builderEntry].sort());
  const dll = join(folder, ...bcnEntry.split("/"));
  expect(existsSync(dll), dll).toBe(true);
  expect(createHash("sha256").update(readFileSync(dll)).digest("hex"), dll).toBe(manifest.files[bcnEntry]);
  const check = spawnSync(process.execPath, [join(desktop, "bcn-check.ts"), dll], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  expect(`${check.stdout}${check.stderr}`, dll).toContain("XFS_BCN_OK");
}

test.skipIf(!required && (process.platform !== "win32" || !isDir(prepared)))("the prepared build tools carry the texture compressor, and it loads", () => {
  checkTools(prepared);
});

test.skipIf(!required && (process.platform !== "win32" || !existsSync(archive)))("the packaged app contains its texture compressor, and it loads", () => {
  expect(existsSync(archive), archive).toBe(true);
  const scratch = mkdtempSync(join(tmpdir(), "xfs-packaged-bcn-"));
  try {
    const tools = `${bundle}/Resources/app/build-tools`;
    const unpack = spawnSync(tar, ["-xf", archive, "-C", scratch, `${tools}/manifest.json`, `${tools}/${builderEntry}`, `${tools}/${bcnEntry}`],
      { encoding: "utf8", windowsHide: true });
    expect(unpack.status, unpack.stderr).toBe(0);
    checkTools(join(scratch, ...tools.split("/")));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60_000);
