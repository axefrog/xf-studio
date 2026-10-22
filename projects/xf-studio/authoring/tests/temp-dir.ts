import { afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test that needs a scratch folder makes it here, never with `mkdtempSync` directly, so the folder is removed when the
 * scope that made it ends (the file when called at its top level, the test when called inside one) and cannot pile up in the
 * system temp folder. Close any SQLite database, server or watcher in the folder before that point: Windows will not delete a
 * folder with an open handle, and a writer that is still alive can recreate files after the removal. So the removal is retried
 * briefly, and `bunfig.toml` preloads a sweep (`temp-dir-sweep.ts`) that removes every folder once more when the whole run ends.
 */
const removal = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const;
const made = new Set<string>();

/** A new folder `<prefix><random>` under `parent` (the system temp folder by default), removed after the calling scope. */
export function tempDir(prefix: string, parent: string = tmpdir()): string {
  const dir = mkdtempSync(join(parent, prefix));
  made.add(dir);
  // Bun refuses a hook inside a concurrent test (it throws); that folder is left to the end-of-run sweep.
  try { afterAll(() => remove(dir)); } catch { /* swept at the end of the run */ }
  return dir;
}

const remove = (dir: string) => rm(dir, removal).catch(() => { /* still held open: the end-of-run sweep tries once more */ });

/** Remove every folder made so far (again): the end-of-run sweep. */
export const sweepTempDirs = () => Promise.all([...made].map(remove)).then(() => undefined);
