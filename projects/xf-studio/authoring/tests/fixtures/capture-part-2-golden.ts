/**
 * Captures `tests/golden/part-2-parity.json` from the code checked out: see `part-2-parity.ts`.
 * It was run once on the step-2 code (before part-2); rerun it only to review a deliberate change.
 *   bun tests/fixtures/capture-part-2-golden.ts "<label>"
 */
import { writeFileSync } from "node:fs";
import { part2Observation } from "./part-2-parity";

const golden = { capturedFrom: process.argv[2] ?? "working tree", ...part2Observation() };
writeFileSync(new URL("../golden/part-2-parity.json", import.meta.url), JSON.stringify(golden, null, 1) + "\n");
console.log(Object.keys(golden.recipes).length, "recipe schemas;", Object.keys(golden.glitter).length, "Glitter fixtures;",
  Object.keys(golden.collections).length, "collections");
