import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocalPackage, type PackageTools } from "../src/package-server";
import type { EyePlateTools } from "../src/eye-plate-service";

const noHead: EyePlateTools = {
  async extract() { /* The game's content archives contain no head resource. */ },
  async serialize() { throw Error("unreachable"); },
  async deserialize() { throw Error("unreachable"); },
};

test("localhost Build prepares the built-in plate before starting the builder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-package-plate-"));
  try {
    const game = join(dir, "game"), cli = join(dir, "WolvenKit.CLI.exe");
    mkdirSync(join(game, "bin", "x64"), { recursive: true });
    mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "");
    writeFileSync(cli, "");
    const tools: PackageTools = { python: join(dir, "never-started", "python.exe"), bun: process.execPath, plate: "",
      plateCache: join(dir, "cache"), wolvenkit: cli, gamepath: game };
    // Python is checked first; with a real one configured, plate preparation fails before any builder process starts.
    await expect(runLocalPackage("build", join(dir, "collection.json"), tools, () => noHead)).rejects.toThrow("Python executable");
    const missing = await runLocalPackage("build", join(dir, "collection.json"), { ...tools, python: "python" }, () => noHead).catch(error => error);
    expect(missing.code).toBe("plate_source_missing");
    expect(missing.message).toContain("verify the game files");
    await expect(runLocalPackage("build", join(dir, "collection.json"), { ...tools, python: "python", plate: join(dir, "absent") }, () => noHead))
      .rejects.toThrow("XFS_PACKAGE_PLATE developer override");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
