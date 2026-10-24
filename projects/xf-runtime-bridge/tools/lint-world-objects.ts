// The world-object rule as a source check (RB-113; research/runtime/runtime-bridge-design.md §4, knowledge/game-crashes.md
// §2.4). Session 7 crashed the game in the script VM's String + String operator with a null right operand, after natives
// on a door were used inline while building text. The rule: on a world object of unknown type the redscript layer keeps
// every native's answer in a local before any text is built. This check finds a call on such an object inside a line that
// concatenates strings.
//
// What counts as a world object here: a function parameter or a local declared as ref<> or wref<> of GameObject, Entity,
// gamePuppetBase, ScriptedPuppet, NPCPuppet or VehicleObject, and a local assigned with `as` one of those classes. V
// (PlayerPuppet) is a known type and isn't tracked. A line concatenates strings when it has a string literal next to a
// `+` or a `+=`.
//
//   bun tools/lint-world-objects.ts        exits 1 and lists every finding in redscript/*.reds
//
// tools/test/batch13.test.ts runs it over the sources and over fixtures.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CLASSES = "GameObject|Entity|gamePuppetBase|ScriptedPuppet|NPCPuppet|VehicleObject";
const TYPED = new RegExp(`\\b(\\w+)\\s*:\\s*w?ref<(?:${CLASSES})>`, "g");
const CAST = new RegExp(`\\blet\\s+(\\w+)\\s*=.*\\bas\\s+(?:${CLASSES})\\b`);
const FUNC = /^\s*(?:(?:public|private|protected|final|static|native|cb|override)\s+)*func\s+\w+/;
const CONCAT = /"\s*\+|\+\s*"|\+=/;

export type Finding = { file: string; line: number; variable: string; text: string };

/** Calls on world objects of unknown type inside a string-building line, per function. */
export function inlineNativeResults(source: string, file = "<source>"): Finding[] {
  const findings: Finding[] = [];
  let tracked = new Set<string>();
  const lines = source.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const text = raw.replace(/\/\/.*$/, "");
    if (FUNC.test(text)) tracked = new Set();
    for (const m of text.matchAll(TYPED)) tracked.add(m[1]!);
    const cast = CAST.exec(text);
    if (cast) tracked.add(cast[1]!);
    // Only calls outside string literals count; the literals stay as "" so a concatenation with one still shows.
    const code = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (!CONCAT.test(code)) return;
    for (const variable of tracked) {
      if (new RegExp(`\\b${variable}\\.\\w+\\s*\\(`).test(code)) findings.push({ file, line: index + 1, variable, text: raw.trim() });
    }
  });
  return findings;
}

export function lintRedscriptSources(dir = resolve(import.meta.dir, "..", "redscript")): Finding[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".reds"))
    .flatMap((name) => inlineNativeResults(readFileSync(join(dir, name), "utf8"), name));
}

if (import.meta.main) {
  const findings = [...lintRedscriptSources(), ...lintRedscriptSources(resolve(import.meta.dir, "..", "redscript-dm"))]; // 0.8.12: the toolkit's script too
  for (const f of findings) console.log(`${f.file}:${f.line}: '${f.variable}' is a world object; keep its native's answer in a local before building text: ${f.text}`);
  console.log(findings.length ? `\n${findings.length} finding(s)` : "world-object rule: no native results inline in string building");
  process.exit(findings.length ? 1 : 0);
}
