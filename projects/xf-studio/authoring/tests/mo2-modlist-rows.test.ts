/**
 * One MO2 `modlist.txt` row reader (PIPE-10): the parser, the placement and the diagnostic staging and promotion read rows
 * the same way, as MO2 does (spaces around a row ignored, `+`/no prefix enabled, `-` disabled, `*` foreign, `_separator`
 * rows carry no files), and a rewrite changes only the sign of the rows it switches.
 */
import { expect, test } from "bun:test";
import { mo2ModlistRows, parseMo2Modlist, splitMo2ModlistLines } from "../src/mo2-instance";
import { disableMo2Mods, mo2ModlistEntry } from "../src/mo2-placement";
import { diagnosticModlist, enabledMo2Mods } from "../src/runtime-diagnostic-stage";
import { EYE_MAKEUP_MOD } from "../src/mod-branding";

const LIST = "# written by MO2\r\n+High\nPlain\r\n-Off\n*DLC\n+Tools_separator\n  +Padded  \r\n+High\n";

test("every reader sees the same rows", () => {
  const rows = mo2ModlistRows(LIST).filter(row => row !== null);
  expect(rows.map(row => [row!.index, row!.prefix, row!.name])).toEqual([[1, "+", "High"], [2, "", "Plain"], [3, "-", "Off"], [4, "*", "DLC"],
    [5, "+", "Tools_separator"], [6, "+", "Padded"], [7, "+", "High"]]);
  const parsed = parseMo2Modlist(LIST);
  expect(parsed.entries.map(entry => [entry.name, entry.enabled, entry.kind, entry.line]))
    .toEqual([["High", true, "mod", 2], ["Plain", true, "mod", 3], ["Off", false, "mod", 4], ["DLC", true, "foreign", 5],
      ["Tools_separator", true, "separator", 6], ["Padded", true, "mod", 7]]);
  expect(parsed.notes).toEqual([{ code: "duplicate_ignored", line: 8 }]);
  expect(mo2ModlistEntry(LIST, "padded")).toBe("+");
  expect(mo2ModlistEntry(LIST, "Off")).toBe("-");
  const { bom, lines, endings } = splitMo2ModlistLines(`﻿${LIST}`);
  expect([bom, lines.length, endings.slice(0, 3)]).toEqual(["﻿", 8, ["\r\n", "\n", "\r\n"]]);
});

test("the diagnostics count enabled mods as MO2 does: unprefixed rows count, separators, foreign and disabled rows don't", () => {
  // Before, only lines starting with "+" counted, so "Plain" and a padded row were missed and a separator was counted.
  expect(enabledMo2Mods(LIST)).toEqual(["High", "Plain", "Padded"]);
});

test("switching mods off changes only their sign, whatever the line endings, padding or case", () => {
  const predecessor = EYE_MAKEUP_MOD.predecessorMods[0];
  const text = `+Keep\r\n  +${predecessor}  \r\n${predecessor.toLowerCase()}\n-Already\n`;
  expect(disableMo2Mods(text, [predecessor])).toBe(`+Keep\r\n  -${predecessor}  \r\n-${predecessor.toLowerCase()}\n-Already\n`);
  // The diagnostic clone's list: our mod added, the predecessor switched off even on a line whose ending differs from the rest
  // (before, a file with any CRLF was split on CRLF only, so an LF row was never switched off).
  const source = `+Other\r\n+${predecessor}\n`;
  const clone = diagnosticModlist(source, [], EYE_MAKEUP_MOD.modName);
  expect(parseMo2Modlist(clone).entries.map(entry => [entry.name, entry.enabled]))
    .toEqual([["Other", true], [EYE_MAKEUP_MOD.modName, true], [predecessor, false]]);   // placed beside its predecessor
});
