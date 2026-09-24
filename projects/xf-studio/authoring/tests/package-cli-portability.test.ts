import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
