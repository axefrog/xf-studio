// NATIVE-75: which texture compressor the package builder may load. In the desktop app only a copy its build-tools manifest lists, bound to
// the manifest's hash, and never a developer's XFS_BCN_LIBRARY; in the source tree that switch, then the built copy bound to the hash its
// xfs_bcn.json records. A candidate whose bytes differ from its hash, or whose hash is unknown, is never loaded, and the Build falls back to
// WolvenKit with the reason.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_TOOLS_SCHEMA, bcnCandidates, bcnEntry, builderEntry } from "../src/packaged-build-tools";
import { loadNativeWriterLibraries } from "../src/native-resource-tools";
import type { BcnLibrary } from "../src/native/write/bcn";
import * as desktopBuild from "../desktop/build";

const files = (entries: Record<string, string>) => (path: string) => entries[path.replaceAll("\\", "/")] ?? null;
const slashes = (items: readonly { path: string; sha256?: string | null }[]) => items.map(item => ({ ...item, path: item.path.replaceAll("\\", "/") }));
const hex = "ab".repeat(32);

test("a packaged run loads only a compressor its manifest lists, bound to its hash, and ignores XFS_BCN_LIBRARY", () => {
  const env = { XFS_BCN_LIBRARY: "/elsewhere/other.dll" };
  const manifest = (listed: Record<string, string>) => files({ "/tools/manifest.json": JSON.stringify({ schema: BUILD_TOOLS_SCHEMA, files: listed }) });
  // Today's desktop app packages no compressor: none may load, whatever the environment says.
  expect(bcnCandidates("/tools", "/tools/app", env, manifest({ [builderEntry]: "0".repeat(64) }))).toEqual([]);
  expect(slashes(bcnCandidates("/tools", "/tools/app", env, manifest({ [builderEntry]: "0".repeat(64), [bcnEntry]: hex }))))
    .toEqual([{ path: "/tools/app/native/xfs_bcn.dll", sha256: hex }]);
  expect(bcnCandidates("/tools", "/tools/app", env, manifest({ [bcnEntry]: "x" }))).toEqual([]);
  // The desktop reads the same manifest names.
  expect(desktopBuild.BUILD_TOOLS_SCHEMA).toBe(BUILD_TOOLS_SCHEMA);
  expect(desktopBuild.builderEntry).toBe(builderEntry);
});

test("the source tree takes a developer's XFS_BCN_LIBRARY, then the built copy bound to its recorded hash", () => {
  const built = "/src/authoring/data/tools/xfs-bcn";
  expect(slashes(bcnCandidates("/src/authoring", "/src/authoring", { XFS_BCN_LIBRARY: "/dev/xfs_bcn.dll" },
    files({ [`${built}/xfs_bcn.json`]: JSON.stringify({ contract: 1, sha256: hex }) }))))
    .toEqual([{ path: "/dev/xfs_bcn.dll" }, { path: `${built}/xfs_bcn.dll`, sha256: hex }]);
  // No record (or an unreadable one): the built copy's hash is unknown, so it won't load.
  expect(slashes(bcnCandidates("/src/authoring", "/src/authoring", {}, files({})))).toEqual([{ path: `${built}/xfs_bcn.dll`, sha256: null }]);
  expect(bcnCandidates("/src/authoring", "/src/authoring", {}, files({ [`${built}/xfs_bcn.json`]: "{" }))[0]!.sha256).toBeNull();
  // Another manifest in the app root (not the build tools') changes nothing.
  expect(bcnCandidates("/src/authoring", "/src/authoring", {}, files({ "/src/authoring/manifest.json": "{\"schema\":\"other\"}" })).length).toBe(1);
});

test("a compressor whose bytes differ from its hash, or whose hash is unknown, is not loaded; the right bytes are", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-bcn-bind-"));
  try {
    const dll = join(root, "xfs_bcn.dll");
    writeFileSync(dll, "MZ built bytes");
    const good = createHash("sha256").update(readFileSync(dll)).digest("hex");
    const loaded: string[] = [];
    const load = { oodle: () => { throw Error("no Oodle here"); }, isFile: () => true,
      bcn: (path: string) => { loaded.push(path); return { path, compress: () => new Uint8Array(), close() {} } as BcnLibrary; },
      sha256: (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex") };
    expect(loadNativeWriterLibraries(root, [{ path: dll, sha256: "0".repeat(64) }], load).bcn)
      .toEqual({ unavailable: "XF Studio's texture compressor differs from the one that was built." });
    expect(loadNativeWriterLibraries(root, [{ path: dll, sha256: null }], load).bcn)
      .toEqual({ unavailable: "XF Studio's texture compressor has no record of its build; build it again with tools/build-native-bcn.ts." });
    // No hash function at all: a bound candidate is still refused.
    expect("unavailable" in loadNativeWriterLibraries(root, [{ path: dll, sha256: good }], { ...load, sha256: undefined }).bcn).toBe(true);
    expect(loaded).toEqual([]);
    expect("unavailable" in loadNativeWriterLibraries(root, [{ path: dll, sha256: good }], load).bcn).toBe(false);
    // A developer's explicit library is loaded as given.
    expect("unavailable" in loadNativeWriterLibraries(root, [{ path: dll }], load).bcn).toBe(false);
    expect(loaded).toEqual([dll, dll]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the builder CLI takes its compressor candidates from bcnCandidates, with a hash function", () => {
  const cli = readFileSync(join(import.meta.dir, "..", "tools", "build_collection_package.ts"), "utf8");
  expect(cli).toContain("bcnCandidates(appRoot, app, process.env,");
  expect(cli).toContain("sha256: path => createHash(\"sha256\")");
  expect(cli).not.toMatch(/process\.env\.XFS_BCN_LIBRARY/);
});
