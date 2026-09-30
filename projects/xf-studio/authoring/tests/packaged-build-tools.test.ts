// PIPE-130 / deep review 9 (NATIVE-Low): which texture compressor the package builder may load. In the desktop app only the packaged
// copy, bound to the build-tools manifest's hash, and never a developer's XFS_BCN_LIBRARY; in the source tree that switch, then the
// built one. A candidate whose bytes differ from its hash is never loaded, and the Build falls back to WolvenKit with the reason.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_TOOLS_SCHEMA, bcnCandidates, bcnEntry } from "../src/packaged-build-tools";
import { loadNativeWriterLibraries } from "../src/native-resource-tools";
import type { BcnLibrary } from "../src/native/write/bcn";

const files = (entries: Record<string, string>) => (path: string) => entries[path.replaceAll("\\", "/")] ?? null;
const hex = "ab".repeat(32);

test("a packaged run binds the compressor to its manifest and ignores XFS_BCN_LIBRARY", () => {
  const manifest = JSON.stringify({ schema: BUILD_TOOLS_SCHEMA, files: { "app/tools/build.js": "0".repeat(64), [bcnEntry]: hex } });
  const env = { XFS_BCN_LIBRARY: "/elsewhere/evil.dll" };
  const packaged = bcnCandidates("/tools", "/tools/app", env, files({ "/tools/manifest.json": manifest }));
  expect(packaged.map(item => ({ ...item, path: item.path.replaceAll("\\", "/") }))).toEqual([{ path: "/tools/app/native/xfs_bcn.dll", sha256: hex }]);
  // A packaged manifest without the compressor (XFS_BCN=skip) allows none, and neither does one with a malformed hash.
  expect(bcnCandidates("/tools", "/tools/app", env, files({ "/tools/manifest.json": JSON.stringify({ schema: BUILD_TOOLS_SCHEMA, files: {} }) }))).toEqual([]);
  expect(bcnCandidates("/tools", "/tools/app", env, files({ "/tools/manifest.json": JSON.stringify({ schema: BUILD_TOOLS_SCHEMA, files: { [bcnEntry]: "x" } }) }))).toEqual([]);
});

test("the source tree takes a developer's XFS_BCN_LIBRARY, then the built library, unbound", () => {
  const source = bcnCandidates("/src/authoring", "/src/authoring", { XFS_BCN_LIBRARY: "/dev/xfs_bcn.dll" }, files({}));
  expect(source.map(item => ({ ...item, path: item.path.replaceAll("\\", "/") })))
    .toEqual([{ path: "/dev/xfs_bcn.dll" }, { path: "/src/authoring/data/tools/xfs-bcn/xfs_bcn.dll" }]);
  // Another manifest in an app root (not the build tools') changes nothing.
  expect(bcnCandidates("/src/authoring", "/src/authoring", {}, files({ "/src/authoring/manifest.json": "{\"schema\":\"other\"}" })).length).toBe(1);
});

test("a compressor whose bytes differ from its manifest hash is not loaded; the right bytes are", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-bcn-bind-"));
  try {
    const dll = join(root, "app", "native", "xfs_bcn.dll");
    mkdirSync(join(root, "app", "native"), { recursive: true });
    writeFileSync(dll, "MZ packaged bytes");
    const good = createHash("sha256").update(readFileSync(dll)).digest("hex");
    const loaded: string[] = [];
    const load = { oodle: () => { throw Error("no Oodle here"); }, isFile: () => true,
      bcn: (path: string) => { loaded.push(path); return { path, compress: () => new Uint8Array(), close() {} } as BcnLibrary; },
      sha256: (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex") };
    const refused = loadNativeWriterLibraries(root, [{ path: dll, sha256: "0".repeat(64) }], load);
    expect(refused.bcn).toEqual({ unavailable: "XF Studio's texture compressor differs from the one this app was built with." });
    expect(loaded).toEqual([]);
    // No hash function at all: a bound candidate is still refused.
    expect("unavailable" in loadNativeWriterLibraries(root, [{ path: dll, sha256: good }], { ...load, sha256: undefined }).bcn).toBe(true);
    const accepted = loadNativeWriterLibraries(root, [{ path: dll, sha256: good }], load);
    expect("unavailable" in accepted.bcn).toBe(false);
    expect(loaded).toEqual([dll]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
