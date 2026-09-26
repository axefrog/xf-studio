import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { localEyePlate, localPackageAdapter, type PackageTools } from "../src/package-server";
import { runProductBuild } from "../src/platform/export/product-host";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import type { EyePlateTools } from "../src/eye-plate-service";

const noHead: EyePlateTools = {
  async extract() { /* The game's content archives contain no head resource. */ },
  async serialize() { throw Error("unreachable"); },
  async deserialize() { throw Error("unreachable"); },
};
const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));

test("localhost Build prepares the built-in plate before starting the builder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-package-plate-"));
  try {
    const game = join(dir, "game"), cli = join(dir, "WolvenKit.CLI.exe");
    mkdirSync(join(game, "bin", "x64"), { recursive: true });
    mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
    writeFileSync(join(game, "bin", "x64", "Cyberpunk2077.exe"), "");
    writeFileSync(cli, "");
    let runs = 0;
    const build = (tools: PackageTools) => runProductBuild({ ...localPackageAdapter({ exporters: STUDIO_EXPORTERS, tools,
      prerequisites: current => ({ [EYE_PLATE_PREREQUISITE]: localEyePlate(current, () => noHead) }) }),
      runBuilder: async () => { runs++; return { exitCode: 1, stdout: "", stderr: "", stopped: null }; } }, fixture, new AbortController().signal);
    const tools: PackageTools = { bun: join(dir, "never-started", "bun.exe"), plate: "", plateCache: join(dir, "cache"), wolvenkit: cli, gamepath: game };
    // Bun runs the builder and is checked first; with a real one, plate preparation fails before any builder process starts.
    expect(await build(tools)).toMatchObject({ ok: false, code: "package_build_unavailable", message: expect.stringContaining("Bun executable") });
    const missing = await build({ ...tools, bun: process.execPath });
    expect(missing).toMatchObject({ ok: false, code: "plate_source_missing", message: expect.stringContaining("verify the game files") });
    expect(await build({ ...tools, bun: process.execPath, plate: join(dir, "absent") }))
      .toMatchObject({ ok: false, message: expect.stringContaining("XFS_PACKAGE_PLATE developer override") });
    expect(runs).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
