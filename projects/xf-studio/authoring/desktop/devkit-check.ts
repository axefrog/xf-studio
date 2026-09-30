import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import hutchConfig from "./hutch.config";

/**
 * The desktop typecheck extends the Electrobun SDK type devkit that `bun run prepare:devkit` writes into `.hutch/` (ignored, one per
 * checkout). A devkit prepared for another Electrobun release types the config differently: 2.0.1's `build.cottontail` has no
 * `capabilities`, which 2.0.2's has (`api/config/ElectrobunConfig.ts` in the 2.0.2 release), so a stale devkit's errors look like code
 * errors (DESK-16). This names the real cause before `tsc` runs. Returns the problem, or null.
 */
export function devkitIssue(root = import.meta.dir, wanted = hutchConfig.electrobun.version): string | null {
  const lock = resolve(root, ".hutch", "dependencies.lock");
  const prepare = "run `bun run prepare:devkit` in projects/xf-studio/authoring/desktop.";
  if (!existsSync(lock)) return `The Electrobun type devkit is missing: ${prepare}`;
  let objects: Array<{ type?: string; version?: string }> = [];
  try { objects = JSON.parse(readFileSync(lock, "utf8")).objects ?? []; } catch { return `The Electrobun type devkit's lock can't be read: ${prepare}`; }
  const found = objects.find(item => item.type === "electrobun")?.version;
  return found === wanted ? null
    : `The Electrobun type devkit is for Electrobun ${found ?? "an unknown release"}, but this checkout builds with ${wanted}: ${prepare}`;
}

if (import.meta.main) {
  const issue = devkitIssue();
  if (issue) { console.error(issue); process.exit(1); }
}
