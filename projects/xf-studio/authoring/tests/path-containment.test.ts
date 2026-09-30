/**
 * Path containment (PIPE-08): the one helper every host containment check uses, on Windows and POSIX paths, lexically
 * and through links.
 */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { HOST_REAL_PATHS } from "../src/host-real-paths";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalPath as canonicalWith, containmentKey, isBelow, isBelowReal as belowReal, isWithin, isWithinReal as withinReal, overlaps } from "../src/platform/api/path-containment";

const W = "win32" as const, P = "posix" as const;
// The host's own reads (PIPE-136: existence by lstat, so a link whose target is gone is seen).
const FS = HOST_REAL_PATHS;
const canonicalPath = (path: string) => canonicalWith(path, FS);
const isBelowReal = (child: string, root: string) => belowReal(child, root, FS);
const isWithinReal = (child: string, root: string) => withinReal(child, root, FS);

test("Windows: below, the same folder, and siblings that share a prefix", () => {
  expect(isWithin("C:\\root\\a\\b.txt", "C:\\root", W)).toBe(true);
  expect(isBelow("C:\\root\\a", "C:\\root", W)).toBe(true);
  expect(isWithin("C:\\root", "C:\\root", W)).toBe(true);
  expect(isBelow("C:\\root", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\rootx\\a", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\roo", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\", "C:\\root", W)).toBe(false);
});

test("Windows: case, mixed slashes and trailing separators don't change the answer", () => {
  expect(isBelow("c:/ROOT/Sub/file.txt", "C:\\Root", W)).toBe(true);
  expect(isBelow("C:\\root\\sub\\", "C:\\root\\", W)).toBe(true);
  expect(isWithin("C:\\root\\\\", "c:/root", W)).toBe(true);
  expect(isBelow("C:\\root\\", "C:\\root", W)).toBe(false);
  expect(isBelow("C:\\root\\\\sub//x", "C:/root//", W)).toBe(true);
});

test("Windows: `..` and `.` are folded before comparing, so an escape is refused", () => {
  expect(isWithin("C:\\root\\..\\other", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\root\\a\\..\\..\\root2\\x", "C:\\root", W)).toBe(false);
  expect(isWithin("C:/root/a/../b", "C:\\root", W)).toBe(true);
  expect(isWithin("C:\\root\\.\\a", "C:\\root", W)).toBe(true);
  expect(isWithin("C:\\root\\a\\..", "C:\\root", W)).toBe(true);
  expect(isBelow("C:\\root\\a\\..", "C:\\root", W)).toBe(false);
  // A root written with `..` is resolved too.
  expect(isBelow("C:\\x\\y", "C:\\x\\z\\..", W)).toBe(true);
});

test("Windows: drive letters and drive roots", () => {
  expect(isWithin("D:\\root\\a", "C:\\root", W)).toBe(false);
  expect(isWithin("d:\\x", "D:\\", W)).toBe(true);
  expect(isBelow("D:\\x", "d:/", W)).toBe(true);
  expect(isBelow("D:\\", "D:\\", W)).toBe(false);
  expect(isWithin("C:\\x", "D:\\", W)).toBe(false);
});

test("Windows: UNC shares compare whole, case-folded, with either slash", () => {
  expect(isBelow("\\\\Server\\Share\\a\\b", "\\\\server\\share", W)).toBe(true);
  expect(isBelow("//server/share/a", "\\\\SERVER\\share\\", W)).toBe(true);
  expect(isWithin("\\\\server\\share2\\a", "\\\\server\\share", W)).toBe(false);
  expect(isWithin("\\\\server2\\share\\a", "\\\\server\\share", W)).toBe(false);
  // `..` can't climb above a share, as on Windows itself: this names \\server\share\other\a.
  expect(isBelow("\\\\server\\share\\..\\other\\a", "\\\\server\\share", W)).toBe(true);
  expect(isWithin("C:\\share\\a", "\\\\server\\share", W)).toBe(false);
});

test("Windows: device prefixes of a drive or UNC path are removed; other device paths are never inside", () => {
  expect(isBelow("\\\\?\\C:\\root\\a", "C:\\root", W)).toBe(true);
  expect(isBelow("C:\\root\\a", "\\\\?\\c:\\root", W)).toBe(true);
  expect(isBelow("\\\\.\\C:\\root\\a", "C:\\root", W)).toBe(true);
  expect(isBelow("\\??\\C:\\root\\a", "C:\\root", W)).toBe(true);
  expect(isBelow("\\\\?\\UNC\\server\\share\\a", "\\\\server\\share", W)).toBe(true);
  expect(isWithin("\\\\?\\C:\\root\\..\\x", "C:\\root", W)).toBe(false);
  expect(isWithin("\\\\.\\pipe\\root", "\\\\.\\pipe", W)).toBe(false);
  expect(isWithin("\\\\?\\Volume{0}\\root\\a", "\\\\?\\Volume{0}\\root", W)).toBe(false);
});

test("Windows: segments of only dots and spaces (which Windows trims into something else) and NULs are never inside", () => {
  expect(isWithin("C:\\root\\...\\x", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\root\\.. \\x", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\root\\ \\x", "C:\\root", W)).toBe(false);
  expect(isWithin("C:\\root\\a\0\\x", "C:\\root", W)).toBe(false);
  expect(containmentKey("C:\\root\\. .", W)).toBeNull();
  // An ordinary name with dots or spaces in it is fine.
  expect(isBelow("C:\\root\\my file.v2.txt", "C:\\root", W)).toBe(true);
  expect(isBelow("C:\\root\\..hidden", "C:\\root", W)).toBe(true);
  expect(containmentKey("", W)).toBeNull();
});

test("relative paths, and Windows paths that depend on a current folder, are never compared", () => {
  expect(isWithin("root\\a", "root", W)).toBe(false);
  expect(isWithin("C:root\\a", "C:root", W)).toBe(false);
  expect(isWithin("\\root\\a", "\\root", W)).toBe(false);
  expect(isWithin("C:\\root\\a", "root", W)).toBe(false);
  expect(isWithin("root/a", "root", P)).toBe(false);
  expect(containmentKey("./x", P)).toBeNull();
});

test("POSIX: case matters, backslashes are ordinary characters, and `..` is folded", () => {
  expect(isBelow("/root/a", "/root", P)).toBe(true);
  expect(isWithin("/Root/a", "/root", P)).toBe(false);
  expect(isWithin("/root/../etc", "/root", P)).toBe(false);
  expect(isWithin("/rootx/a", "/root", P)).toBe(false);
  expect(isBelow("/root/a\\..\\..\\b", "/root", P)).toBe(true);
  expect(isBelow("/x", "/", P)).toBe(true);
  expect(isBelow("/root/", "/root", P)).toBe(false);
});

test("overlaps: either inside the other, or the same", () => {
  expect(overlaps("C:\\a", "C:\\a\\b", W)).toBe(true);
  expect(overlaps("C:\\a\\b", "C:\\A", W)).toBe(true);
  expect(overlaps("C:\\a", "c:\\a\\", W)).toBe(true);
  expect(overlaps("C:\\a", "C:\\ab", W)).toBe(false);
});

const folders: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "xfs-contain-")); folders.push(dir); return dir; };
const cleanup = () => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); };
/** A directory link: a junction on Windows (no privilege needed), a symbolic link elsewhere. */
const link = (target: string, path: string) => symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");

test("real checks: a link inside the root that leads out is refused", () => {
  const dir = scratch();
  try {
    const root = join(dir, "root"), outside = join(dir, "outside");
    mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "x");
    link(outside, join(root, "door"));
    expect(isBelow(join(root, "door", "secret.txt"), root)).toBe(true);   // lexically inside
    expect(isBelowReal(join(root, "door", "secret.txt"), root)).toBe(false);
    expect(isWithinReal(join(root, "door"), root)).toBe(false);
    // A path not created yet below the link is refused as well.
    expect(isBelowReal(join(root, "door", "new", "file"), root)).toBe(false);
    expect(isBelowReal(join(root, "new", "file"), root)).toBe(true);
    expect(isWithinReal(root, root)).toBe(true);
    expect(isBelowReal(root, root)).toBe(false);
  } finally { cleanup(); }
});

test("real checks: an outside path that reaches in through a link is refused (PIPE-31); a root given as a link works", () => {
  const dir = scratch();
  try {
    const root = join(dir, "root"), outside = join(dir, "outside");
    mkdirSync(join(root, "inner"), { recursive: true }); mkdirSync(outside);
    writeFileSync(join(root, "inner", "file.txt"), "x");
    link(root, join(outside, "back"));
    expect(canonicalPath(join(outside, "back", "inner", "file.txt"))).toBe(canonicalPath(join(root, "inner", "file.txt")));
    expect(isBelowReal(join(outside, "back", "inner", "file.txt"), root)).toBe(false);
    // The root itself named through the link: paths written below it are fine.
    expect(isBelowReal(join(outside, "back", "inner", "file.txt"), join(outside, "back"))).toBe(true);
    // And a path written below the real root is inside the root named through the link.
    expect(isBelowReal(join(root, "inner", "file.txt"), join(outside, "back"))).toBe(true);
  } finally { cleanup(); }
});

test("real checks: a link whose target is gone is refused, never read as a folder not created yet (PIPE-136)", () => {
  const dir = scratch();
  try {
    const root = join(dir, "root"), outside = join(dir, "outside");
    mkdirSync(root); mkdirSync(outside);
    link(outside, join(root, "door"));
    rmSync(outside, { recursive: true, force: true });
    // existsSync follows the link and finds nothing: a check built on it read the dangling link as a folder to create (reproduced).
    expect(existsSync(join(root, "door"))).toBe(false);
    expect(withinReal(join(root, "door", "new", "file"), root, { exists: existsSync, realpath: realpathSync.native })).toBe(true);
    // The host's reads see the link, and its real path fails, so it is refused.
    expect(isBelowReal(join(root, "door", "new", "file"), root)).toBe(false);
    expect(isWithinReal(join(root, "door"), root)).toBe(false);
    expect(() => canonicalPath(join(root, "door", "new"))).toThrow("leads nowhere");
    expect(isBelowReal(join(root, "new", "file"), root)).toBe(true);
    rmSync(join(root, "door"), { recursive: false, force: true });
  } finally { cleanup(); }
});

/** The 8.3 short form of an existing path, or null where the volume has none. */
function shortName(path: string): string | null {
  if (process.platform !== "win32") return null;
  const result = spawnSync("cmd.exe", ["/d", "/c", `for %I in ("${path}") do @echo %~sI`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true });
  const text = result.stdout?.trim();
  return result.status === 0 && text && text.toLowerCase() !== path.toLowerCase() ? text : null;
}

test("real checks: a Windows 8.3 short-named root matches its long-form paths", () => {
  const dir = scratch();
  try {
    const root = join(dir, "a long folder name");
    mkdirSync(join(root, "inside"), { recursive: true });
    const short = shortName(root);
    if (!short) return;   // this volume keeps no short names
    expect(isBelow(join(root, "inside"), short)).toBe(false);   // lexically they differ
    expect(isBelowReal(join(root, "inside"), short)).toBe(true);
    expect(isBelowReal(join(short, "inside"), short)).toBe(true);
    expect(isBelowReal(join(dir, "elsewhere"), short)).toBe(false);
  } finally { cleanup(); }
});
