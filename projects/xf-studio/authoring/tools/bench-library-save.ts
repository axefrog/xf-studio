/**
 * Library save timing (research/backlog/performance.md, "Library saves"): 200 saves of the starter look through
 * `LookLibrary` into a throwaway library, the same body the installed-app measure posts (desktop/tools/measure-installed-start.ts),
 * without the HTTP hop. "full" emulates the library before library-durability.ts (WAL with SQLite's default
 * `synchronous=FULL`: a disk flush in every commit); "normal" is the library now (`synchronous=NORMAL`, one flush after
 * the saves). Also times the flush itself, since it now runs on the host's thread a few seconds after the last save.
 *   bun tools/bench-library-save.ts [folder] [saves]
 * `folder` is where the throwaway library goes (default: the temp folder); a disk's flush cost differs a lot between drives.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { LookLibrary } from "../src/library-store";
import { LibraryDurability } from "../src/platform/graph-adapters/library-durability";
import { hostClock } from "../src/platform/graph-adapters/host-sources";
import { starterRecipe } from "../src/features/eye-makeup/region";
import { recipeFile } from "../src/recipe-schema";

const root = resolve(process.argv[2] ?? tmpdir()), saves = Number(process.argv[3] ?? 200);
const recipe = recipeFile(starterRecipe());
const ms = (value: number) => +value.toFixed(2);

for (const mode of ["full", "normal"] as const) {
  const dir = mkdtempSync(join(root, "xfs-save-bench-"));
  const life = new AbortController();
  try {
    const path = join(dir, "library.sqlite");
    const durability = new LibraryDurability(path, { clock: hostClock(), signal: life.signal });
    const library = new LookLibrary(path, durability);
    // The library as it was: every commit waits for the disk.
    if (mode === "full") (library as unknown as { db: Database }).db.exec("PRAGMA synchronous=FULL;");
    durability.flush();
    const times: number[] = [];
    const started = performance.now();
    for (let i = 0; i < saves; i++) {
      const at = performance.now();
      library.save({ name: `Timing look ${i}`, recipe });
      times.push(performance.now() - at);
    }
    const total = performance.now() - started;
    const flushAt = performance.now();
    durability.flush();
    const flush = performance.now() - flushAt;
    // One save then its flush: the cost a single edit's flush adds, a few seconds later.
    library.save({ name: "One more", recipe });
    const oneAt = performance.now();
    durability.flush();
    const one = performance.now() - oneAt;
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ mode, folder: root, saves, totalMs: Math.round(total), medianMs: ms(times[Math.floor(saves / 2)]),
      p95Ms: ms(times[Math.floor(saves * 0.95)]), maxMs: ms(times[saves - 1]), flushAfterAllMs: ms(flush), flushAfterOneMs: ms(one) }));
    library.close();
  } finally { life.abort(); rmSync(dir, { recursive: true, force: true }); }
}
