import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const hq = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../tools/build_collection_package.py");
const fixture = resolve(hq, "experiments/005-preset-collection/editor-collection.json");
const run = (collection: string, outputRoot?: string) => Bun.spawnSync([
  "python", script, "--collection", collection, "--check",
  ...(outputRoot ? ["--output-root", outputRoot] : []),
], { cwd: hq, stdout: "pipe", stderr: "pipe" });

test("package preflight accepts a Studio collection without writing a package", () => {
  const result = run(fixture);
  expect(result.exitCode).toBe(0);
  const summary = JSON.parse(result.stdout.toString());
  expect(summary.ready).toBe(true);
  expect(summary.presets).toHaveLength(4);
  expect(summary.presets[0].appearance).toStartWith("xfs_");
});

test("package preflight rejects unsupported optical finishes before packaging", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "xfs-package-check-"));
  try {
    const collection = JSON.parse(readFileSync(fixture, "utf8"));
    collection.presets[0].recipe.layers[0].finish = "glitter";
    const file = resolve(dir, "glitter.json");
    writeFileSync(file, JSON.stringify(collection));
    const result = run(file);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("glitter");
    expect(result.stderr.toString()).toContain("No package was installed or promoted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("package output cannot target a game/mod directory outside project dist", () => {
  const result = run(fixture, resolve(tmpdir(), "xfs-unrelated-mod-path"));
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("inside");
  expect(result.stderr.toString()).toContain("No package was installed or promoted");
});
