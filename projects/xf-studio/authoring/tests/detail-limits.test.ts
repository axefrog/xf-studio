import { expect, test } from "bun:test";
import { DETAIL_LIMITS } from "../src/detail-limits";
import { characterDetailLine, DETAIL_LIMIT_TEXT } from "../src/studio-ui/panels/preview";

test("renderer limit codes are worded only by the presentation, one plain sentence each (UI-38)", () => {
  expect(Object.keys(DETAIL_LIMIT_TEXT).sort()).toEqual([...DETAIL_LIMITS].sort());
  const line = characterDetailLine({ phase: "ready", source: "save", message: "", progress: null, slots: [
    { slot: "skin", state: "shown", label: "Pale", limits: ["head-shape", "skin-glow"] },
    { slot: "brows", state: "shown", label: "Style 3" },
    { slot: "lashes", state: "shown", label: "Default" },
    { slot: "hair", state: "unavailable", label: "", limits: ["skin-glow"] },
  ] });
  expect(line.done).toBe(true);
  expect(line.text).toContain(DETAIL_LIMIT_TEXT["head-shape"]);
  // Each sentence once; a slot that isn't shown says nothing about how it would be drawn.
  expect(line.text.split(DETAIL_LIMIT_TEXT["skin-glow"]).length).toBe(2);
  expect(line.text).toMatch(/^Skin: Pale · Eyebrows: Style 3 · Eyelashes: Default · Hair: not shown\. An installed mod/);
});

test("renderer and device modules carry codes, not the sentences", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  for (const file of ["scene.ts", "head-skin-placement.ts", "character-material-adapters.ts", "character-detail-loader.ts", "browser-character-detail-device.ts"]) {
    const source = readFileSync(resolve(import.meta.dir, "..", "src", file), "utf8");
    for (const text of Object.values(DETAIL_LIMIT_TEXT)) expect({ file, found: source.includes(text) }).toEqual({ file, found: false });
  }
});
