/**
 * The singleton ratchet (profiles and graph design §7.1, boundary rule 5): the modules that assume one V, one save,
 * one live look, one layered surface, one subject or an implicit target. Each row names what it assumes and where;
 * the list may only shrink: a new module spelling one of these assumptions fails, and a row whose assumption is gone
 * fails until the row is removed (G2 empties the character rows, G5 the live-document and surface rows, G8 the scene
 * and preview rows, G3 the save row). No application service may add an implicit current V, look, preset, save,
 * surface or subject.
 */
import { expect, test } from "bun:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFiles, sourceText } from "./fixtures/source-files";
import { codeOnly } from "./fixtures/code-scan";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Each assumption: what spells it, and the modules that spell it today (with the slice that removes them). */
const SINGLETONS: readonly { readonly assumption: string; readonly pattern: RegExp; readonly modules: readonly string[]; readonly slice: string }[] = [
  { assumption: "one character context and one character history", slice: "G2",
    pattern: /\bclass\s+CharacterContextActions\b/, modules: ["character-context-actions"] },
  { assumption: "one saved V", slice: "G2",
    pattern: /\bclass\s+SavedAppearanceActions\b/, modules: ["saved-appearance-actions"] },
  { assumption: "one live look being edited (the model's one live feature)", slice: "G5",
    pattern: /\breadonly\s+live\s*:\s*string\b/, modules: ["collection-workspace"] },
  { assumption: "one layered surface", slice: "G5",
    pattern: /\bconst\s+liveSurface\b/, modules: ["studio-startup"] },
  { assumption: "the Save Explorer's one open save", slice: "G3",
    pattern: /\breadonly\s+open\s*:\s*\{\s*readonly\s+phase\b/, modules: ["features/save-explorer/actions"] },
  { assumption: "actions defaulting to the focused view", slice: "G8",
    pattern: /\bview\s*\?\?\s*this\.graph\.focused\(\)/, modules: ["preview-actions"] },
];

const modules = () => sourceFiles(SRC, /\.ts$/).filter(path => !path.endsWith(".d.ts"))
  .map(path => relative(SRC, path).replace(/\\/g, "/").replace(/\.ts$/, ""));
const spelling = (pattern: RegExp, texts: Readonly<Record<string, string>>) => Object.entries(texts).filter(([, text]) => pattern.test(text)).map(([name]) => name).sort();
const DISK = () => Object.fromEntries(modules().map(name => [name, codeOnly(sourceText(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))))]));

test("only the listed modules spell today's singleton assumptions (the list only shrinks)", () => {
  const texts = DISK();
  for (const item of SINGLETONS) expect([item.assumption, spelling(item.pattern, texts)]).toEqual([item.assumption, [...item.modules].sort()]);
});

test("the graph's own modules assume no current anything", () => {
  const texts = Object.fromEntries(Object.entries(DISK()).filter(([name]) => name.startsWith("platform/graph-") || name === "compose/graph"));
  expect(Object.keys(texts).length).toBeGreaterThan(3);
  for (const item of SINGLETONS) expect(spelling(item.pattern, texts)).toEqual([]);
  // Nor a module-level "current" node holder.
  expect(Object.entries(texts).filter(([, text]) => /\blet\s+current(?:V|Look|Preset|Save|Profile|Node)\b/.test(text)).map(([name]) => name)).toEqual([]);
});

test("the ratchet fails on an injected singleton", () => {
  const texts = { ...DISK(), "features/new-thing/actions": "export class CharacterContextActions {}" };
  expect(spelling(SINGLETONS[0].pattern, texts)).toContain("features/new-thing/actions");
});
