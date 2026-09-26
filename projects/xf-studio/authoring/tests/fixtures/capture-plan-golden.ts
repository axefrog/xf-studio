/**
 * Captures `tests/golden/collection-plans.json`: digests of `parseCollection`, `planCollection`
 * and the package filter for every committed collection fixture. It was run once on the
 * pre-migration code (commit 9dbf576); collection-1 inputs must keep these exact results.
 *   bun tests/fixtures/capture-plan-golden.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseCollection, planCollection } from "../../src/preset-collection";
import { digest } from "./workspace-observable";
import { preparePackageCollection } from "./eye-exporter";

export const COLLECTION_FIXTURES = ["005-preset-collection/collection.json", "005-preset-collection/editor-collection.json",
  "016-finish-board/finish-board.collection.json", "017-plate-depth/depth-candidate.collection.json",
  "019-uv-window/uv-window.collection.json", "020-session-2/session-2.collection.json"];
export const readFixture = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../../../../experiments/${path}`, import.meta.url), "utf8"));

if (import.meta.main) {
  const golden = Object.fromEntries(COLLECTION_FIXTURES.map(path => {
    const value = readFixture(path);
    return [path, { parsed: digest(parseCollection(value)), plan: digest(planCollection(value)),
      packaged: digest(preparePackageCollection(value)) }];
  }));
  writeFileSync(new URL("../golden/collection-plans.json", import.meta.url),
    JSON.stringify({ capturedFrom: process.argv[2] ?? "working tree", fixtures: golden }, null, 1) + "\n");
  console.log(Object.keys(golden).length, "fixtures");
}
