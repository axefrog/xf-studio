// The desktop app carries XF Studio's texture compressor (PIPE-130): the prepared build tools and every Electrobun build in this
// checkout hold `app/native/xfs_bcn.dll`, listed in their manifest with its SHA-256, and those bytes load and compress a block. It runs
// against what exists: nothing is built here. `XFS_REQUIRE_PACKAGED_BCN=1` (set by CI after `build:canary`) makes an absent build a
// failure instead of a skip. verify-canary.ts checks the same inside the update archive itself.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BUILD_TOOLS_SCHEMA, bcnEntry, builderEntry } from "../build";
import { checkBcnLibrary, loadBcnLibrary } from "../../src/native/write/bcn";

const desktop = resolve(import.meta.dir, "..");
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
/** The prepared build tools, and each Electrobun build's `Resources/app/build-tools` (build/<channel>-win-x64/<bundle>/). */
function packagedToolFolders(): string[] {
  const found = isDir(join(desktop, "build-tools")) ? [join(desktop, "build-tools")] : [];
  const builds = join(desktop, "build");
  for (const target of isDir(builds) ? readdirSync(builds) : [])
    for (const bundle of isDir(join(builds, target)) ? readdirSync(join(builds, target)) : []) {
      const tools = join(builds, target, bundle, "Resources", "app", "build-tools");
      if (isDir(tools)) found.push(tools);
    }
  return found;
}
const folders = packagedToolFolders();
const required = process.env.XFS_REQUIRE_PACKAGED_BCN === "1";

test.skipIf(!required && (process.platform !== "win32" || folders.length === 0))("the packaged app contains its texture compressor, and it loads", () => {
  expect(folders.length, "no prepared build tools or Electrobun build in this checkout").toBeGreaterThan(0);
  expect(process.platform).toBe("win32");
  for (const folder of folders) {
    const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
    expect(manifest.schema).toBe(BUILD_TOOLS_SCHEMA);
    expect(Object.keys(manifest.files).sort(), folder).toEqual([bcnEntry, builderEntry].sort());
    const dll = join(folder, ...bcnEntry.split("/"));
    expect(existsSync(dll), dll).toBe(true);
    expect(createHash("sha256").update(readFileSync(dll)).digest("hex"), dll).toBe(manifest.files[bcnEntry]);
    const library = loadBcnLibrary(dll);
    try { checkBcnLibrary(library); } finally { library.close(); }
  }
});
