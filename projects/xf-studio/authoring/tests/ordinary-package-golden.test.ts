import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BAKED_FIXTURES, ORDINARY_FIXTURES, ordinaryDigests } from "./fixtures/capture-ordinary-golden";

// PIPE-76: ordinary (non-glitter) packages keep the plans, plate materials, appearances, ArchiveXL declarations and
// baked maps they had before the diagnostic Glitter route's cleanup. The digests were captured on the code before it
// (tests/fixtures/capture-ordinary-golden.ts); the plan golden (look-model.test.ts) pins the plans since step 1.
const golden = JSON.parse(readFileSync(new URL("./golden/ordinary-package.json", import.meta.url), "utf8")).fixtures;

test("the golden covers every ordinary fixture and bakes each ordinary route", () => {
  expect(Object.keys(golden).sort()).toEqual([...ORDINARY_FIXTURES].sort());
  expect(BAKED_FIXTURES.every(path => golden[path].maps && Object.keys(golden[path].maps).length > 20)).toBe(true);
});

for (const path of ORDINARY_FIXTURES) test(`ordinary package unchanged: ${path}`, async () => {
  expect(await ordinaryDigests(path, BAKED_FIXTURES.includes(path))).toEqual(golden[path]);
}, 120_000);
