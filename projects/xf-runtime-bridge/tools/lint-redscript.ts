// Type-checks the redscript layer offline with the official redscript-cli (v0.5.31) against a
// COPY of the game's r6/cache/final.redscripts. Never point --bundle at the live game file.
//
//   bun tools/lint-redscript.ts --bundle <copy of final.redscripts> [--cli <redscript-cli.exe>]
//
// redscript-cli prints "Lint successful" and exits 0 even when it reports errors, so this
// wrapper fails on any ERROR line instead. Known gap: `cb` wrappers match by bare name, so a
// wrong @wrapMethod parameter list is not reported; wrap targets are copied from published mods.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const cli = option("--cli") ?? process.env.XFB_REDSCRIPT_CLI ?? "D:/Dev/tools/redscript-cli/0.5.31/redscript-cli.exe";
const bundle = option("--bundle") ?? process.env.XFB_REDSCRIPT_BUNDLE;
const sources = resolve(import.meta.dir, "..", "redscript");

if (!existsSync(cli)) {
  console.error(`redscript-cli not found at ${cli} (official release v0.5.31; see docs/toolchain.md)`);
  process.exit(2);
}
if (!bundle || !existsSync(bundle)) {
  console.error("pass --bundle <copy of the game's r6/cache/final.redscripts>");
  process.exit(2);
}

const result = spawnSync(cli, ["lint", "-s", sources, "-b", bundle], { encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);
const errors = output.split(/\r?\n/).filter((line) => line.includes("ERROR"));
if (result.status !== 0 || errors.length > 0) {
  console.error(`\nredscript lint FAILED (${errors.length} error line(s), exit ${result.status})`);
  process.exit(1);
}
console.log(`\nredscript lint passed: ${join("redscript")} against ${bundle}`);
