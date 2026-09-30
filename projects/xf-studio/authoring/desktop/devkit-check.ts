import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import hutchConfig from "./hutch.config";

/**
 * The desktop typecheck extends the Electrobun SDK type devkit that `bun run prepare:devkit` writes into `.hutch/`. A devkit prepared
 * for another Electrobun release types the config differently (2.0.1's has no `build.cottontail.capabilities`, which 2.0.2's has), so
 * its errors look like code errors. This names the real cause first. Returns the problem, or null.
 */
export function devkitIssue(root = import.meta.dir, wanted = hutchConfig.electrobun.version): string | null {
  const lock = resolve(root, ".hutch", "dependencies.lock");
  if (!existsSync(lock)) return "The Electrobun type devkit is missing: run `bun run prepare:devkit` in projects/xf-studio/authoring/desktop.";
  const objects: Array<{ type?: string; version?: string }> = JSON.parse(readFileSync(lock, "utf8")).objects ?? [];
  const found = objects.find(item => item.type === "electrobun")?.version;
  return found === wanted ? null
    : `The Electrobun type devkit is for Electrobun ${found ?? "an unknown release"}, but this checkout builds with ${wanted}: run \`bun run prepare:devkit\` in projects/xf-studio/authoring/desktop.`;
}

if (import.meta.main) {
  const issue = devkitIssue();
  if (issue) { console.error(issue); process.exit(1); }
}
