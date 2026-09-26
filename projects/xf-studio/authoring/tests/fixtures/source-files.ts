/**
 * One cached scan of the source tree for the whole-repo tests (architecture and presentation boundaries, branding). Under a loaded
 * machine these tests timed out at Bun's 5 s default because each walked the tree and read every file again, and the branding scan
 * descended into desktop build output and dependency folders only to filter them afterwards. Here a directory walk prunes what it
 * never scans before descending, never follows a junction or symbolic link (a worktree's `.hutch` points into another checkout), and
 * each file is read once per test process.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const texts = new Map<string, string>();
const listings = new Map<string, readonly string[]>();

/** A file's text, read once. */
export function sourceText(path: string): string {
  let text = texts.get(path);
  if (text === undefined) { text = readFileSync(path, "utf8"); texts.set(path, text); }
  return text;
}

/**
 * Every file under `dir` whose name matches `include`, not descending into directories named in `prune` (nor any directory that is a
 * junction or symbolic link). Listed once per argument set.
 */
export function sourceFiles(dir: string, include: RegExp = /\.ts$/, prune: readonly string[] = []): readonly string[] {
  const key = JSON.stringify([dir, include.source, include.flags, prune]);
  let listed = listings.get(key);
  if (!listed) {
    const walk = (at: string): string[] => readdirSync(at, { withFileTypes: true }).flatMap(entry => {
      const path = join(at, entry.name);
      if (entry.isDirectory()) return prune.includes(entry.name) ? [] : walk(path);
      return entry.isFile() && include.test(entry.name) ? [path] : [];
    });
    listed = Object.freeze(walk(dir));
    listings.set(key, listed);
  }
  return listed;
}
