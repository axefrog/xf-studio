/**
 * Captures `tests/golden/workspace-v1-observable.json` from the code checked out. It was run
 * once on the pre-migration code (step 1, commit 9dbf576); rerun it only to review a deliberate change.
 *   bun tests/fixtures/capture-workspace-golden.ts
 */
import { writeFileSync } from "node:fs";
import { digest, observeRoundTrips } from "./workspace-observable";
import { damagedWorkspaceV1, largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1 } from "./workspace-v1-fixtures";

const summarise = (fixture: unknown) => {
  const result = observeRoundTrips(fixture);
  return { warning: result.warning, first: digest(result.first), levels: result.levels.map(digest) };
};
const golden = {
  capturedFrom: process.argv[2] ?? "working tree",
  small: summarise(smallWorkspaceV1()),
  loose: summarise(looseWorkspaceV1()),
  large: summarise(largeWorkspaceV1()),
  damaged: summarise(damagedWorkspaceV1()),
};
writeFileSync(new URL("../golden/workspace-v1-observable.json", import.meta.url), JSON.stringify(golden, null, 1) + "\n");
console.log(`small ${golden.small.first}; loose ${golden.loose.first}; large ${golden.large.first}`);
