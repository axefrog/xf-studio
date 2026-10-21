import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CATALOGUE_PATH, renderCatalogue } from "../tools/action-catalogue";

test("the action catalogue is current with the registry (bun tools/action-catalogue.ts)", () => {
  expect(readFileSync(CATALOGUE_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(renderCatalogue());
});
