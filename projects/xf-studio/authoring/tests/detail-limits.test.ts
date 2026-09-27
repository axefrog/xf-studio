import { expect, test } from "bun:test";
import { DETAIL_LIMITS, DETAIL_NOTICES } from "../src/detail-limits";
import { HOST_SLOT_LIMITS } from "../src/render-detail";
import { characterDetailLine, characterDetailRows, DETAIL_LIMIT_TEXT, DETAIL_NOTICE_TEXT } from "../src/studio-ui/panels/preview";

test("a host of another version is worded as one plain line from its code, never silence", () => {
  expect(Object.keys(DETAIL_NOTICE_TEXT).sort()).toEqual([...DETAIL_NOTICES].sort());
  const line = characterDetailLine({ phase: "failed", source: "save", message: "", notice: "version-skew", progress: null, updating: false, updateError: null, choices: 0, drawn: [], garmentTags: [], need: null, slots: [] });
  expect(line).toEqual({ done: true, text: DETAIL_NOTICE_TEXT["version-skew"] });
  expect(line.text).toContain("Restart");
});

test("renderer limit codes are worded only by the presentation, one plain sentence each (UI-38)", () => {
  expect(Object.keys(DETAIL_LIMIT_TEXT).sort()).toEqual([...DETAIL_LIMITS].sort());
  // The codes a host writes on a record's slot are limit codes too (PIPE-84).
  for (const code of HOST_SLOT_LIMITS) expect(DETAIL_LIMITS).toContain(code);
  const ready = { phase: "ready", source: "save", message: "", notice: null, progress: null, updating: false, updateError: null, choices: 0, drawn: [], garmentTags: [], need: null, slots: [
    { slot: "skin", state: "shown", label: "Pale", limits: ["head-shape", "skin-glow"] },
    { slot: "brows", state: "shown", label: "Style 3" },
    { slot: "lashes", state: "shown", label: "Default" },
    { slot: "hair", state: "unavailable", label: "", limits: ["skin-glow"], message: "Your V's hair couldn't be read." },
  ] } as const;
  // Ready details are a list, not a line (ui-copy-and-layout-review.md §3.10).
  expect(characterDetailLine(ready as never)).toEqual({ done: true, text: "" });
  const list = characterDetailRows(ready as never)!;
  expect(list.rows.map(row => [row.term, row.value])).toEqual([["Skin", "Pale"], ["Eyebrows", "Style 3"], ["Eyelashes", "Default"], ["Hair", "Not shown"]]);
  expect(list.rows[3]!.note).toBe("Your V's hair couldn't be read.");
  // Each sentence once; a slot that isn't shown says nothing about how it would be drawn.
  expect(list.limits).toEqual([DETAIL_LIMIT_TEXT["head-shape"], DETAIL_LIMIT_TEXT["skin-glow"]]);
});

test("renderer and device modules carry codes, not the sentences", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  for (const file of ["platform/scene/scene-host.ts", "platform/scene/character-renderer.ts", "platform/scene/head-rig.ts", "head-skin-placement.ts", "character-material-adapters.ts", "character-detail-loader.ts", "browser-character-detail-device.ts"]) {
    const source = readFileSync(resolve(import.meta.dir, "..", "src", file), "utf8");
    for (const text of Object.values(DETAIL_LIMIT_TEXT)) expect({ file, found: source.includes(text) }).toEqual({ file, found: false });
  }
});

test("face details: the slot reads as plain words, and a decal the preview can't draw is one sentence from its code", () => {
  const list = characterDetailRows({ phase: "ready", source: "save", message: "", notice: null, progress: null, updating: false, updateError: null, choices: 0, drawn: [], garmentTags: [], need: null, slots: [
    { slot: "skin", state: "shown", label: "senna, skin type 3" },
    { slot: "face", state: "shown", label: "cheeks (light brown), face cyberware", limits: ["decal-template"] },
  ] })!;
  expect(list.rows.map(row => [row.term, row.value])).toEqual([["Skin", "Senna, skin type 3"], ["Face details", "Cheeks (light brown), face cyberware"]]);
  expect(list.limits).toEqual([DETAIL_LIMIT_TEXT["decal-template"]]);
  // The decal family's modules carry codes too.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  for (const file of ["face-decal-material.ts", "decal-underlay.ts", "render-templates.ts"])
    expect(readFileSync(resolve(import.meta.dir, "..", "src", file), "utf8")).not.toContain(DETAIL_LIMIT_TEXT["decal-template"]);
});
