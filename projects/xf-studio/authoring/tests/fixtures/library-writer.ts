/**
 * A child process for the crash test in `library-durability.test.ts`: opens a library file through the Studio's stores
 * (WAL, `synchronous=NORMAL`, the host clock's flush schedule) and saves looks, collections and graph entries in a loop
 * until it is killed, printing one line per committed save ("look <n>" after the commit returned).
 *   bun tests/fixtures/library-writer.ts <library.sqlite>
 */
import { LookLibrary } from "../../src/library-store";
import { LibraryDurability } from "../../src/platform/graph-adapters/library-durability";
import { hostClock } from "../../src/platform/graph-adapters/host-sources";
import { initialRecipe } from "./eye-region";

const path = process.argv[2];
if (!path) throw Error("Usage: bun tests/fixtures/library-writer.ts <library.sqlite>");
const life = new AbortController();
const durability = new LibraryDurability(path, { clock: hostClock(), signal: life.signal, timing: { quietMs: 20, maxMs: 50, retryMaxMs: 200 } });
const library = new LookLibrary(path, durability);
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
