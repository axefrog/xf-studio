/**
 * The desktop's writable build folders (PIPE-08): refused when one is a link, or when it overlaps a configured input,
 * however that input is written (a Windows 8.3 short name included).
 */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateBuildRootsIssue } from "../desktop/build";

function shortName(path: string): string | null {
  if (process.platform !== "win32") return null;
  const result = spawnSync("cmd.exe", ["/d", "/c", `for %I in ("${path}") do @echo %~sI`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
  const text = result.stdout?.trim();
  return result.status === 0 && text && text.toLowerCase() !== path.toLowerCase() ? text : null;
}

test("private build folders: separate inputs pass, a linked folder or an overlapping input is refused", () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-build-roots-")));
  try {
    const data = join(dir, "user data folder"), game = join(dir, "game"), elsewhere = join(dir, "elsewhere");
    for (const path of [data, game, elsewhere]) mkdirSync(path, { recursive: true });
    expect(privateBuildRootsIssue(data, [game])).toBeNull();
    // An input inside a writable folder, or holding one.
    mkdirSync(join(data, "package-work", "tools"), { recursive: true });
    expect(privateBuildRootsIssue(data, [join(data, "package-work", "tools")])).toMatch(/overlaps/);
    expect(privateBuildRootsIssue(data, [dir])).toMatch(/overlaps/);
    // The same folder written as its 8.3 short name still overlaps.
    const short = shortName(data);
    if (short) expect(privateBuildRootsIssue(data, [short])).toMatch(/overlaps/);
    // A writable folder that is a link leads the Build's writes elsewhere.
    symlinkSync(elsewhere, join(data, "package-staging"), process.platform === "win32" ? "junction" : "dir");
    expect(privateBuildRootsIssue(data, [game])).toMatch(/linked path/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
