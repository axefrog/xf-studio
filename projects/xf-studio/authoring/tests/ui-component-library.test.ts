// The component library is documented in full (UI-113): every export of src/studio-ui/components has a style-guide entry with every
// field of its contract and a live specimen built by the production component, and the generated guide carries them.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as components from "../src/studio-ui/components";
import { LIBRARY } from "../src/studio-ui/style-guide/library";
import { LIBRARY_SPECIMENS } from "../src/studio-ui/style-guide/library-demo";

const guide = readFileSync(resolve(import.meta.dir, "..", "public", "style-guide.html"), "utf8");

test("every value the library exports is documented by an entry", () => {
  const documented = new Set(LIBRARY.flatMap(entry => entry.exports));
  expect(Object.keys(components).filter(name => !documented.has(name)).sort()).toEqual([]);
  expect([...documented].filter(name => !(name in components)).sort()).toEqual([]);
});

test("every entry states its whole contract and has a live specimen", () => {
  const fields = ["what", "anatomy", "variants", "states", "sizes", "when", "combine", "adapt", "drives", "a11y", "do", "avoid"] as const;
  const thin = LIBRARY.flatMap(entry => fields.filter(field => entry[field].trim().length < 3).map(field => `${entry.id}: ${field}`));
  expect(thin).toEqual([]);
  expect(LIBRARY.map(entry => entry.id).filter(id => !LIBRARY_SPECIMENS.includes(id))).toEqual([]);
  expect(new Set(LIBRARY.map(entry => entry.id)).size).toBe(LIBRARY.length);
});

test("the committed style guide carries the library section and every entry", () => {
  // Regenerate with: bun tools/build-style-guide.ts
  expect(guide.includes('id="library"')).toBe(true);
  expect(LIBRARY.filter(entry => !guide.includes(`id="${entry.id}"`)).map(entry => entry.id)).toEqual([]);
  expect(guide.includes('id="d-summon"')).toBe(true);
});
