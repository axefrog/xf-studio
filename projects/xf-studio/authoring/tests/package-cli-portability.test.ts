import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = join(import.meta.dir, "..");
const hq = join(app, "../../..");
const script = join(app, "tools", "build_collection_package.ts");
const fixture = join(hq, "experiments", "005-preset-collection", "editor-collection.json");
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("CLI Check accepts host-supplied roots and confines output to its private dist root", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-portable-cli-"));
  const work = join(root, "work");
  const dist = join(root, "dist");
  mkdirSync(work);
  try {
    const base = [process.execPath, script, "--collection", fixture, "--app-root", app,
      "--build-root", join(root, "build"), "--dist-root", dist, "--check", "--machine-result"];
    const check = Bun.spawnSync(base, { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(check.exitCode).toBe(0);
    const result = text(check.stdout).trim();
    expect(JSON.parse(result.slice("XFS_PACKAGE_RESULT=".length)).ready).toBe(true);
    const outside = Bun.spawnSync([...base, "--output-root", join(root, "outside")],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(outside.exitCode).not.toBe(0);
    expect(text(outside.stderr)).toContain("Output must be inside");
    expect(text(outside.stderr)).toContain('XFS_PACKAGE_ERROR={"code":"package_root_unsafe"');
    const unknown = Bun.spawnSync([...base, "--study-root", root], { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(unknown.exitCode).not.toBe(0);
    expect(text(unknown.stderr)).toContain("Unsupported argument: --study-root");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Build refuses a game destination before writing and accepts separate private roots", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-private-roots-"));
  try {
    const work = join(root, "work"), game = join(root, "game"), plate = join(root, "plate"), tools = join(root, "tools");
    for (const path of [work, game, plate, tools]) mkdirSync(path);
    // The host-derived built-in plate uses the xfs_ stem; the legacy override name is covered below.
    for (const name of ["xfs_eye_plate.mesh", "xfs_eye_plate.morphtarget"]) writeFileSync(join(plate, name), "fixture");
    const fakeWolvenkit = join(tools, "WolvenKit.CLI.exe");
    writeFileSync(fakeWolvenkit, "fixture");
    const build = join(root, "private", "build"), dist = join(root, "private", "dist");
    const base = [process.execPath, script, "--collection", fixture, "--app-root", app,
      "--build-root", build, "--plate", plate, "--wolvenkit", fakeWolvenkit, "--gamepath", game, "--machine-result"];
    const refused = Bun.spawnSync([...base, "--dist-root", join(game, "archive", "pc", "mod")],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(refused.exitCode).not.toBe(0);
    expect(text(refused.stderr)).toContain("overlaps configured game root");
    expect(existsSync(build)).toBe(false);
    expect(existsSync(join(game, "archive"))).toBe(false);
    const refusedIntermediate = Bun.spawnSync([...base, "--build-root", join(game, "generated"), "--dist-root", dist],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(refusedIntermediate.exitCode).not.toBe(0);
    expect(text(refusedIntermediate.stderr)).toContain("Build root overlaps configured game root");
    expect(existsSync(join(game, "generated"))).toBe(false);
    writeFileSync(join(plate, "xfas_eye_plate.mesh"), "fixture");
    writeFileSync(join(plate, "xfas_eye_plate.morphtarget"), "fixture");
    const ambiguous = Bun.spawnSync([...base, "--dist-root", dist], { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(ambiguous.exitCode).not.toBe(0);
    expect(text(ambiguous.stderr)).toContain("exactly one mesh/morphtarget pair");
    for (const name of ["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"]) rmSync(join(plate, name));
    const mismatched = join(root, "plate-manifest.json");
    writeFileSync(mismatched, JSON.stringify({ schema: "xfs/eye-plate-cache-1", files: { mesh: { sha256: "0".repeat(64) }, morph: { sha256: "0".repeat(64) } } }));
    const wrongManifest = Bun.spawnSync([...base, "--dist-root", dist, "--plate-manifest", mismatched], { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(wrongManifest.exitCode).not.toBe(0);
    expect(text(wrongManifest.stderr)).toContain("does not match the plate resources");
    expect(existsSync(build)).toBe(false);
    const privateAttempt = Bun.spawnSync([...base, "--dist-root", dist], { cwd: work, stdout: "pipe", stderr: "pipe" });
    // The fake WolvenKit cannot convert anything; reaching the in-process bake proves the root gate accepted private paths.
    expect(privateAttempt.exitCode).not.toBe(0);
    expect(text(privateAttempt.stderr)).toContain("No package was installed or promoted");
    const intermediate = readdirSync(build).find(name => !name.startsWith("source-"));
    expect(intermediate).toBeDefined();
    expect(readFileSync(join(build, intermediate!, "logs", "bake.log"), "utf8")).toContain("Compiled 4 authored presets");
    // The filtered snapshot is removed after use, and nothing reached dist.
    expect(readdirSync(build).filter(name => name.startsWith("source-"))).toEqual([]);
    expect(existsSync(dist)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);

test("a linked output directory cannot escape the dist root", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-linked-output-"));
  try {
    const dist = join(root, "dist"), outside = join(root, "outside"), work = join(root, "work");
    for (const path of [dist, outside, work]) mkdirSync(path);
    const link = join(dist, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    const check = Bun.spawnSync([process.execPath, script, "--collection", fixture, "--app-root", app,
      "--dist-root", dist, "--output-root", link, "--check"],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(check.exitCode).not.toBe(0);
    expect(text(check.stderr)).toContain("linked directory");
    expect(existsSync(join(outside, "manifest.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
