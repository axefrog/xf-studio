/** The minimal example keeps running without any Studio code (design §9 risks: the engine must not drift). */
import { expect, test } from "bun:test";
import { join } from "node:path";

test("bun examples/minimal runs", () => {
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "examples", "minimal", "index.ts")], { cwd: join(import.meta.dir, "..") });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  expect(run.stdout.toString()).toContain("simulation: every step held");
}, 60_000);
