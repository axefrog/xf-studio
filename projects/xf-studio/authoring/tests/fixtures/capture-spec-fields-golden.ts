/**
 * Captures `tests/golden/spec-fields.json` from the code checked out. It was run once on the code before
 * the action specs carried `units`, `limits` and `consequence` (step 5, after commit a0aa2b1); rerun it
 * only to review a deliberate change.
 *   bun tests/fixtures/capture-spec-fields-golden.ts a0aa2b1
 */
import { writeFileSync } from "node:fs";
import { observeSpecFields } from "./spec-fields";

const golden = { capturedFrom: process.argv[2] ?? "working tree", states: observeSpecFields() };
writeFileSync(new URL("../golden/spec-fields.json", import.meta.url), JSON.stringify(golden, null, 1) + "\n");
console.log(`${Object.keys(golden.states).length} states captured.`);
