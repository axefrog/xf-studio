/**
 * A child process for the crash test in `library-durability.test.ts`: opens a library file through the Studio's stores
 * (WAL, `synchronous=NORMAL`, the host clock's flush schedule) and saves looks, collections and graph entries in a loop
 * until it is killed, printing one line per committed save ("look <n>" after the commit returned).
 *   bun tests/fixtures/library-writer.ts <library.sqlite>
 */
import { openLibraryDatabase } from "../../src/library-files";
import { LookLibrary } from "../../src/library-store";
import { hostClock } from "../../src/platform/core/clock";
import { initialRecipe } from "./eye-region";

const path = process.argv[2];
if (!path) throw Error("Usage: bun tests/fixtures/library-writer.ts <library.sqlite>");
const life = new AbortController();
// The file's one owner, as the hosts open it, with a fast flush schedule so kills also land during checkpoints.
const database = openLibraryDatabase(path, { clock: hostClock(), signal: life.signal, timing: { quietMs: 20, maxMs: 50, retryMaxMs: 200 } });
const library = new LookLibrary(database);
const recipe = initialRecipe();
// Several layers make each commit span many pages, so a kill often lands mid-write.
for (let i = 0; i < 6; i++) recipe.layers.push({ ...structuredClone(recipe.layers[0]), id: crypto.randomUUID() });
let n = 0;
for (;;) {
  const saved = library.save({ name: `Look ${n}`, recipe });
  process.stdout.write(`look ${n} ${saved.id}\n`);
  n++;
  // Let the flush timers run now and then, so kills also land during a checkpoint.
  if (n % 7 === 0) await Bun.sleep(1);
}
