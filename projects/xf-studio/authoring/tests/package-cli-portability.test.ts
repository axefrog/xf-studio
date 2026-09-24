import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const hq = resolve(app, "../../..");
const script = join(app, "tools", "build_collection_package.py");
const fixture = join(hq, "experiments", "005-preset-collection", "editor-collection.json");
const study = join(hq, "experiments", "005-preset-collection");

test("CLI Check accepts host-supplied roots and confines output to its private dist root", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-portable-cli-"));
  const work = join(root, "work");
  const dist = join(root, "dist");
  mkdirSync(work);
  try {
    const base = ["python", script, "--collection", fixture, "--bun", process.execPath,
      "--app-root", app, "--study-root", join(root, "unavailable-study"), "--work-root", work,
      "--build-root", join(root, "build"), "--dist-root", dist,
      "--bake-script", join(root, "unavailable-bake.ts"), "--check", "--machine-result"];
    const check = Bun.spawnSync(base, { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(check.exitCode).toBe(0);
    const result = new TextDecoder().decode(check.stdout).trim();
    expect(JSON.parse(result.slice("XFS_PACKAGE_RESULT=".length)).ready).toBe(true);
    const outside = Bun.spawnSync([...base, "--output-root", join(root, "outside")],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(outside.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(outside.stderr)).toContain("Output must be inside");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Experiment 005 invokes a supplied bake entry from a supplied work root", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-portable-bake-"));
  try {
    const appRoot = join(root, "app");
    const workRoot = join(root, "work");
    const plate = join(root, "plate");
    const game = join(root, "game");
    const output = join(root, "intermediate");
    for (const path of [appRoot, workRoot, plate, game]) mkdirSync(path);
    for (const name of ["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"]) writeFileSync(join(plate, name), "fixture");
    const fakeWolvenkit = join(root, "WolvenKit.CLI.exe");
    writeFileSync(fakeWolvenkit, "fixture");
    const bake = join(appRoot, "bake.ts");
    writeFileSync(bake, "console.log('portable bake entry reached from ' + process.cwd());");
    const result = Bun.spawnSync(["python", join(study, "build.py"), "--collection", fixture,
      "--output", output, "--plate", plate, "--wolvenkit", fakeWolvenkit,
      "--bun", process.execPath, "--gamepath", game, "--app-root", appRoot,
      "--work-root", workRoot, "--bake-script", bake, "--no-latest"],
      { cwd: workRoot, stdout: "pipe", stderr: "pipe" });
    // The small test bake deliberately writes no compiled plan; only path dispatch is in scope.
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(join(output, "logs", "bake.log"), "utf8")).toContain(`portable bake entry reached from ${workRoot}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Build refuses a game destination before writing and accepts separate private roots", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-private-roots-"));
  try {
    const work = join(root, "work"), game = join(root, "game"), plate = join(root, "plate");
    const tools = join(root, "tools"), scripts = join(root, "scripts");
    for (const path of [work, game, plate, tools, scripts]) mkdirSync(path);
    // The host-derived built-in plate uses the xfs_ stem; the other test covers the legacy override name.
    for (const name of ["xfs_eye_plate.mesh", "xfs_eye_plate.morphtarget"]) writeFileSync(join(plate, name), "fixture");
    const fakeWolvenkit = join(tools, "WolvenKit.CLI.exe");
    writeFileSync(fakeWolvenkit, "fixture");
    const bake = join(scripts, "bake.ts");
    writeFileSync(bake, "console.log('private bake reached')");
    const build = join(root, "private", "build"), dist = join(root, "private", "dist");
    const base = ["python", script, "--collection", fixture, "--bun", process.execPath,
      "--app-root", app, "--study-root", study, "--work-root", work,
      "--build-root", build, "--plate", plate, "--wolvenkit", fakeWolvenkit,
      "--gamepath", game, "--bake-script", bake, "--machine-result"];
    const refused = Bun.spawnSync([...base, "--dist-root", join(game, "archive", "pc", "mod")],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(refused.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(refused.stderr)).toContain("overlaps configured game root");
    expect(existsSync(build)).toBe(false);
    expect(existsSync(join(game, "archive"))).toBe(false);
    const refusedIntermediate = Bun.spawnSync([...base, "--build-root", join(game, "generated"), "--dist-root", dist],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(refusedIntermediate.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(refusedIntermediate.stderr)).toContain("Build root overlaps configured game root");
    expect(existsSync(join(game, "generated"))).toBe(false);
    writeFileSync(join(plate, "xfas_eye_plate.mesh"), "fixture");
    writeFileSync(join(plate, "xfas_eye_plate.morphtarget"), "fixture");
    const ambiguous = Bun.spawnSync([...base, "--dist-root", dist], { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(ambiguous.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(ambiguous.stderr)).toContain("exactly one mesh/morphtarget pair");
    for (const name of ["xfas_eye_plate.mesh", "xfas_eye_plate.morphtarget"]) rmSync(join(plate, name));
    const mismatched = join(root, "plate-manifest.json");
    writeFileSync(mismatched, JSON.stringify({ schema: "xfs/eye-plate-cache-1", files: { mesh: { sha256: "0".repeat(64) }, morph: { sha256: "0".repeat(64) } } }));
    const wrongManifest = Bun.spawnSync([...base, "--dist-root", dist, "--plate-manifest", mismatched], { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(wrongManifest.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(wrongManifest.stderr)).toContain("does not match the plate resources");
    expect(existsSync(build)).toBe(false);
    const privateAttempt = Bun.spawnSync([...base, "--dist-root", dist],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    // The fake bake has no compiled plan; reaching it proves the root gate accepted private paths.
    expect(privateAttempt.exitCode).not.toBe(0);
    const intermediate = readdirSync(build).find(name => !name.startsWith("source-"));
    expect(intermediate).toBeDefined();
    expect(readFileSync(join(build, intermediate!, "logs", "bake.log"), "utf8")).toContain("private bake reached");
    expect(existsSync(dist)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a linked output directory cannot escape the dist root", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-linked-output-"));
  try {
    const dist = join(root, "dist"), outside = join(root, "outside"), work = join(root, "work");
    for (const path of [dist, outside, work]) mkdirSync(path);
    const link = join(dist, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    const check = Bun.spawnSync(["python", script, "--collection", fixture, "--bun", process.execPath,
      "--app-root", app, "--study-root", study, "--work-root", work,
      "--dist-root", dist, "--output-root", link, "--check"],
      { cwd: work, stdout: "pipe", stderr: "pipe" });
    expect(check.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(check.stderr)).toContain("linked directory");
    expect(existsSync(join(outside, "manifest.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
