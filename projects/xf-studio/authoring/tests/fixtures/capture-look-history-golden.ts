/**
 * Captures `tests/golden/look-history-parity.json` from the code checked out. It was run once on the
 * code before the look history (commit 0885ba6, migration step 4); rerun it only to review a deliberate change.
 *   bun tests/fixtures/capture-look-history-golden.ts 0885ba6
 */
import { writeFileSync } from "node:fs";
import { observeHistories, observeStored, session } from "./look-history-parity";
import { digest, restore } from "./workspace-observable";
import { damagedWorkspaceV1, largeWorkspaceV1, looseWorkspaceV1, smallWorkspaceV1, withPreferences } from "./workspace-v1-fixtures";

const fixtures = { small: smallWorkspaceV1, loose: looseWorkspaceV1, large: largeWorkspaceV1, damaged: damagedWorkspaceV1,
  preferences: () => withPreferences(smallWorkspaceV1()) };
const summarise = (fixture: unknown) => {
  const loaded = restore(fixture);
  if (!loaded.writable) throw Error(loaded.error);
  const stored = observeStored(loaded.state);
  return { histories: digest(observeHistories(restore(fixture).state)), stored,
    // The workspace-2 text this code stores, restored and walked again (what older workspace-2 files hold).
    session: digest(session(fixture)), sessionFromStored: digest(session(JSON.parse(JSON.stringify(
      JSON.parse(storedText(loaded.state)))))) };
};
function storedText(state: Parameters<typeof observeStored>[0]) {
  return (require("../../src/workspace-budget") as typeof import("../../src/workspace-budget"))
    .encodeWorkspaceAt(state, 0, (require("../../src/compose/studio-registry") as typeof import("../../src/compose/studio-registry")).STUDIO_DOCUMENTS).encoded;
}
const golden: Record<string, unknown> = { capturedFrom: process.argv[2] ?? "working tree" };
for (const [name, fixture] of Object.entries(fixtures)) golden[name] = summarise(fixture());
writeFileSync(new URL("../golden/look-history-parity.json", import.meta.url), JSON.stringify(golden, null, 1) + "\n");
console.log(JSON.stringify(golden, null, 1).slice(0, 2000));
