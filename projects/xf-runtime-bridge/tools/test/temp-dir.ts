// Scratch folders for the bridge's tests (0.8.9): the Studio's helper (projects/xf-studio/authoring/tests/temp-dir.ts),
// adopted as it is, so no test leaves an xfb-* folder in the system temp folder.
import { afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Every test that needs a scratch folder makes it here, never with `mkdtempSync` directly, so the folder is removed when the
 * scope that made it ends (the file when called at its top level, the test when called inside one) and cannot pile up in the
 * system temp folder. Stop any self-test host, window or watcher using the folder before that point: Windows will not
 * delete a folder with an open handle. So the removal is retried briefly, and `bunfig.toml` preloads a sweep
 * (`temp-dir-sweep.ts`) that removes every folder once more when the whole run ends.
 */
const removal = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const;
const made = new Set<string>();

/** A new folder `<prefix><random>` under `parent` (the system temp folder by default), removed after the calling scope. */
export function tempDir(prefix: string, parent: string = tmpdir()): string {
  const dir = mkdtempSync(join(parent, prefix));
  made.add(dir);
  // Bun refuses a hook in some places (a concurrent test, a hook); that folder is left to the end-of-run sweep.
  try {
    afterAll(() => remove(dir));
  } catch {
    /* swept at the end of the run */
  }
  return dir;
}

/**
 * A folder for something that removes it itself when it stops (the self-test host's runtime folder): only the end-of-run
 * sweep backs it up. A scope hook would delete it under a host started in a beforeAll.
 */
export function sweptDir(prefix: string, parent: string = tmpdir()): string {
  const dir = mkdtempSync(join(parent, prefix));
  made.add(dir);
  return dir;
}

const remove = (dir: string) =>
  rm(dir, removal).catch(() => {
    /* still held open: the end-of-run sweep tries once more */
  });

/** Remove every folder made so far (again): the end-of-run sweep. */
export const sweepTempDirs = () => Promise.all([...made].map(remove)).then(() => undefined);
